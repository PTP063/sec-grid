import { Capacitor } from '@capacitor/core';
import { BleClient, type BleDevice } from '@capacitor-community/bluetooth-le';
import type { ITransport } from './ITransport';

// ─── BLE Configuration Constants ─────────────────────────────────────────────

export const MESH_SERVICE_UUID = 'e0c00001-mesh-os00-0000-000000000000';
export const MESH_CHARACTERISTIC_UUID = 'e0c00002-mesh-os00-0000-000000000000';

export const DEFAULT_ATT_MTU = 23;
export const REQUESTED_ATT_MTU = 512;
export const ATT_HEADER_OVERHEAD = 3;
export const CHUNK_HEADER_SIZE = 2; // [TotalChunks, ChunkIndex]
export const TOTAL_HEADER_OVERHEAD = ATT_HEADER_OVERHEAD + CHUNK_HEADER_SIZE; // 5 bytes

export const SCAN_WINDOW_MS = 1_200;       // 1.2s active scan window
export const BASE_QUIET_WINDOW_MS = 3_800; // 3.8s base quiet window (~24% duty cycle)
export const MAX_QUIET_WINDOW_MS = 15_000; // Max backoff quiet interval when idle
export const REASSEMBLY_TIMEOUT_MS = 3_000; // 3-second fragment reassembly timeout
export const SESSION_TIMEOUT_MS = 5_000;   // 5-second ephemeral connect-and-harvest window

// ─── Fragmentation Types ─────────────────────────────────────────────────────

interface ReassemblySession {
  totalChunks: number;
  chunks: Map<number, Uint8Array>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Utility functions for packet fragmentation and reassembly.
 * Exported for isolated unit testing and wire verification.
 */
export function slicePayload(payload: Uint8Array, effectiveMtu: number): Uint8Array[] {
  const usableSize = Math.max(18, effectiveMtu - TOTAL_HEADER_OVERHEAD);
  const totalChunks = Math.ceil(payload.length / usableSize);

  if (totalChunks > 255) {
    throw new Error(`[BleTransport] Payload size (${payload.length}B) exceeds max 255 fragments`);
  }

  if (totalChunks === 0) {
    // 1 empty chunk
    return [new Uint8Array([1, 0])];
  }

  const fragments: Uint8Array[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * usableSize;
    const end = Math.min(start + usableSize, payload.length);
    const slice = payload.subarray(start, end);

    const fragment = new Uint8Array(CHUNK_HEADER_SIZE + slice.length);
    fragment[0] = totalChunks;
    fragment[1] = i;
    fragment.set(slice, CHUNK_HEADER_SIZE);
    fragments.push(fragment);
  }

  return fragments;
}

export class FragmentationManager {
  private sessions = new Map<string, ReassemblySession>();

  /**
   * Ingests an incoming fragment. Returns the reassembled complete frame if this fragment
   * completed a message, or null if more fragments are pending.
   */
  public ingestFragment(peerId: string, fragment: Uint8Array): Uint8Array | null {
    if (fragment.length < CHUNK_HEADER_SIZE) {
      console.warn('[FragmentationManager] Fragment too small, discarding:', fragment.length);
      return null;
    }

    const totalChunks = fragment[0];
    const chunkIndex = fragment[1];
    const payload = fragment.subarray(CHUNK_HEADER_SIZE);

    // Fast path: single-chunk frame (no fragmentation needed)
    if (totalChunks === 1 && chunkIndex === 0) {
      return payload;
    }

    if (chunkIndex >= totalChunks) {
      console.warn(`[FragmentationManager] Invalid chunk index ${chunkIndex}/${totalChunks}`);
      return null;
    }

    let session = this.sessions.get(peerId);
    if (!session) {
      const timer = setTimeout(() => {
        console.warn(`[FragmentationManager] Reassembly timeout for peer ${peerId}`);
        this.sessions.delete(peerId);
      }, REASSEMBLY_TIMEOUT_MS);

      session = {
        totalChunks,
        chunks: new Map(),
        timer,
      };
      this.sessions.set(peerId, session);
    } else if (session.totalChunks !== totalChunks) {
      // New message started before previous completed — reset buffer
      clearTimeout(session.timer);
      const timer = setTimeout(() => {
        this.sessions.delete(peerId);
      }, REASSEMBLY_TIMEOUT_MS);
      session = {
        totalChunks,
        chunks: new Map(),
        timer,
      };
      this.sessions.set(peerId, session);
    }

    session.chunks.set(chunkIndex, payload);

    if (session.chunks.size === session.totalChunks) {
      clearTimeout(session.timer);
      this.sessions.delete(peerId);

      // Reassemble in order
      let totalLength = 0;
      for (let i = 0; i < session.totalChunks; i++) {
        const c = session.chunks.get(i);
        if (!c) {
          console.error(`[FragmentationManager] Missing chunk ${i} during final assembly`);
          return null;
        }
        totalLength += c.length;
      }

      const completeFrame = new Uint8Array(totalLength);
      let offset = 0;
      for (let i = 0; i < session.totalChunks; i++) {
        const c = session.chunks.get(i)!;
        completeFrame.set(c, offset);
        offset += c.length;
      }

      return completeFrame;
    }

    return null;
  }

  public clear(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.timer);
    }
    this.sessions.clear();
  }
}

// ─── Native BLE Transport ────────────────────────────────────────────────────

export class BleTransport implements ITransport {
  private isStarted = false;
  private isScanning = false;
  private isConnecting = false;
  private receiveCallbacks: Set<(rawBytes: Uint8Array) => void> = new Set();
  private fragmentationManager = new FragmentationManager();

  // Outgoing queue for frames to be flushed during ephemeral peer connections
  private outgoingQueue: Uint8Array[] = [];
  private readonly maxQueueSize = 50;

  // Active MTUs per connected device (defaulting to 23)
  private deviceMtus = new Map<string, number>();

  // Duty cycling timer handles
  private dutyCycleTimer: ReturnType<typeof setTimeout> | null = null;
  private currentQuietWindowMs = BASE_QUIET_WINDOW_MS;

  // Peer rotation and active connection tracker
  private knownPeers = new Set<string>();
  private activeConnections = new Set<string>();

  public async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    if (!Capacitor.isNativePlatform()) {
      console.log('[BleTransport] Non-native environment detected. BLE radio idle.');
      return;
    }

    try {
      await BleClient.initialize();
      console.log('[BleTransport] BleClient initialized successfully.');
      this.scheduleNextDutyCycle();
    } catch (err) {
      console.error('[BleTransport] Failed to initialize native BLE client:', err);
    }
  }

  public async stop(): Promise<void> {
    this.isStarted = false;

    if (this.dutyCycleTimer) {
      clearTimeout(this.dutyCycleTimer);
      this.dutyCycleTimer = null;
    }

    if (this.isScanning) {
      try {
        await BleClient.stopLEScan();
      } catch {}
      this.isScanning = false;
    }

    // Disconnect any active connections
    for (const deviceId of this.activeConnections) {
      try {
        await BleClient.disconnect(deviceId);
      } catch {}
    }
    this.activeConnections.clear();
    this.deviceMtus.clear();
    this.fragmentationManager.clear();
    this.receiveCallbacks.clear();
  }

  public onReceive(callback: (rawBytes: Uint8Array) => void): void {
    this.receiveCallbacks.add(callback);
  }

  /**
   * Enqueues an outgoing encrypted Protobuf frame for delivery across adjacent peers.
   */
  public async send(rawBytes: Uint8Array): Promise<void> {
    if (this.outgoingQueue.length >= this.maxQueueSize) {
      this.outgoingQueue.shift(); // Evict oldest frame to prevent memory leaks
    }
    this.outgoingQueue.push(rawBytes);

    // Reset quiet interval backoff on new outgoing emergency traffic
    this.currentQuietWindowMs = BASE_QUIET_WINDOW_MS;

    // If already connected to active peers, flush immediately
    for (const deviceId of this.activeConnections) {
      this.flushQueueToDevice(deviceId).catch((err) => {
        console.warn(`[BleTransport] Failed to flush to active device ${deviceId}:`, err);
      });
    }
  }

  // ─── Asynchronous Time-Sliced Duty Cycling ─────────────────────────────────

  private scheduleNextDutyCycle(): void {
    if (!this.isStarted || !Capacitor.isNativePlatform()) return;

    // Phase 1: Active Scan Window (1.2s)
    this.dutyCycleTimer = setTimeout(async () => {
      await this.runScanWindow();

      // Phase 2: Quiet / Advertise-Only Window (3.8s -> 15s with backoff)
      if (this.isStarted) {
        this.dutyCycleTimer = setTimeout(() => {
          this.scheduleNextDutyCycle();
        }, this.currentQuietWindowMs);
      }
    }, 100);
  }

  private async runScanWindow(): Promise<void> {
    if (this.isConnecting || this.activeConnections.size > 0) {
      // Suspend scanning during active GATT transfer to prevent 2.4 GHz contention
      return;
    }

    let foundNewPeer = false;

    try {
      this.isScanning = true;
      await BleClient.requestLEScan(
        {
          services: [MESH_SERVICE_UUID],
          allowDuplicates: false,
        },
        (result) => {
          if (result.device?.deviceId) {
            foundNewPeer = true;
            this.handleDiscoveredPeer(result.device);
          }
        }
      );

      // Keep scanner alive for SCAN_WINDOW_MS
      await new Promise((resolve) => setTimeout(resolve, SCAN_WINDOW_MS));
    } catch (err) {
      console.warn('[BleTransport] LE scan warning:', err);
    } finally {
      if (this.isScanning) {
        try {
          await BleClient.stopLEScan();
        } catch {}
        this.isScanning = false;
      }

      // Adaptive backoff: increment quiet window if no peers found, reset if peers active
      if (foundNewPeer) {
        this.currentQuietWindowMs = BASE_QUIET_WINDOW_MS;
      } else {
        this.currentQuietWindowMs = Math.min(this.currentQuietWindowMs * 1.5, MAX_QUIET_WINDOW_MS);
      }
    }
  }

  // ─── Ephemeral Connect-and-Harvest Session ──────────────────────────────────

  private async handleDiscoveredPeer(device: BleDevice): Promise<void> {
    const deviceId = device.deviceId;
    if (this.activeConnections.has(deviceId) || this.isConnecting) return;

    this.isConnecting = true;
    this.knownPeers.add(deviceId);

    try {
      // Suspend scan immediately for radio focus
      if (this.isScanning) {
        try { await BleClient.stopLEScan(); } catch {}
        this.isScanning = false;
      }

      console.log(`[BleTransport] Establishing ephemeral session with peer: ${deviceId}`);
      await BleClient.connect(deviceId, (disconnectedId) => {
        this.activeConnections.delete(disconnectedId);
        this.deviceMtus.delete(disconnectedId);
        console.log(`[BleTransport] Peer disconnected: ${disconnectedId}`);
      });
      this.activeConnections.add(deviceId);

      // Query negotiated MTU (Android automatically requests 512, iOS auto-negotiates)
      let effectiveMtu = DEFAULT_ATT_MTU;
      try {
        effectiveMtu = await BleClient.getMtu(deviceId);
        console.log(`[BleTransport] Negotiated ATT MTU: ${effectiveMtu} with peer ${deviceId}`);
      } catch {
        // Fallback to conservative 23 if getMtu fails or unsupported
        console.log(`[BleTransport] MTU query unsupported, defaulting to ${DEFAULT_ATT_MTU}`);
      }
      this.deviceMtus.set(deviceId, effectiveMtu);

      // Subscribe to notifications for incoming triage envelopes
      try {
        await BleClient.startNotifications(
          deviceId,
          MESH_SERVICE_UUID,
          MESH_CHARACTERISTIC_UUID,
          (value: DataView) => {
            const rawChunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            const completeFrame = this.fragmentationManager.ingestFragment(deviceId, rawChunk);
            if (completeFrame) {
              this.emitReceive(completeFrame);
            }
          }
        );
      } catch (subErr) {
        console.warn(`[BleTransport] Could not subscribe to notifications on ${deviceId}:`, subErr);
      }

      // Flush queued envelopes to peer
      await this.flushQueueToDevice(deviceId);

      // Keep session open for SESSION_TIMEOUT_MS to harvest response notifications
      await new Promise((resolve) => setTimeout(resolve, SESSION_TIMEOUT_MS));
    } catch (err) {
      console.warn(`[BleTransport] Ephemeral session error with ${deviceId}:`, err);
    } finally {
      // Disconnect cleanly to free hardware connection slot
      try {
        await BleClient.disconnect(deviceId);
      } catch {}
      this.activeConnections.delete(deviceId);
      this.deviceMtus.delete(deviceId);
      this.isConnecting = false;
    }
  }

  private async flushQueueToDevice(deviceId: string): Promise<void> {
    const mtu = this.deviceMtus.get(deviceId) ?? DEFAULT_ATT_MTU;

    for (const frame of this.outgoingQueue) {
      const fragments = slicePayload(frame, mtu);

      for (const fragment of fragments) {
        try {
          const dataView = new DataView(fragment.buffer, fragment.byteOffset, fragment.byteLength);
          // Use write with response to ensure link-layer pacing and prevent controller buffer overflow
          await BleClient.write(
            deviceId,
            MESH_SERVICE_UUID,
            MESH_CHARACTERISTIC_UUID,
            dataView
          );
        } catch (err) {
          console.warn(`[BleTransport] Write fragment failed on ${deviceId}:`, err);
          return;
        }
      }
    }
  }

  private emitReceive(frame: Uint8Array): void {
    for (const cb of this.receiveCallbacks) {
      try {
        cb(frame);
      } catch (err) {
        console.error('[BleTransport] Receive callback error:', err);
      }
    }
  }
}
