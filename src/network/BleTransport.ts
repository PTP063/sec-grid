import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import type { ITransport } from './ITransport';
import { BleScheduler } from './BleScheduler';
import { BleTelemetry } from '../diagnostics/BleTelemetry';

// ─── BLE Configuration Constants ─────────────────────────────────────────────

export const MESH_SERVICE_UUID = 'e0c00001-mesh-os00-0000-000000000000';
export const MESH_CHARACTERISTIC_UUID = 'e0c00002-mesh-os00-0000-000000000000';
export const APPLE_COMPANY_ID = 0x004c; // Apple Inc. 16-bit Manufacturer Identifier

export const DEFAULT_ATT_MTU = 23;
export const REQUESTED_ATT_MTU = 512;
export const ATT_HEADER_OVERHEAD = 3;
export const CHUNK_HEADER_SIZE = 2; // [TotalChunks, ChunkIndex]
export const TOTAL_HEADER_OVERHEAD = ATT_HEADER_OVERHEAD + CHUNK_HEADER_SIZE; // 5 bytes

export const REASSEMBLY_TIMEOUT_MS = 3_000; // 3-second fragment reassembly timeout
export const SESSION_HARVEST_WAIT_MS = 1_500; // Ephemeral harvest observation window

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
  private receiveCallbacks: Set<(rawBytes: Uint8Array) => void> = new Set();
  private fragmentationManager = new FragmentationManager();

  // Diagnostics & Collision Avoidance Scheduler
  public readonly scheduler = new BleScheduler();
  public readonly telemetry = BleTelemetry.getInstance();

  // Outgoing queue for frames to be flushed during ephemeral peer connections
  private outgoingQueue: Uint8Array[] = [];
  private readonly maxQueueSize = 50;

  // Active MTUs per connected device (defaulting to 23)
  private deviceMtus = new Map<string, number>();

  // Currently connected device ID
  private currentConnectedDeviceId: string | null = null;

  constructor() {
    this.setupSchedulerHooks();
  }

  private setupSchedulerHooks(): void {
    this.scheduler.onStartScan = async () => {
      if (!this.isStarted || !Capacitor.isNativePlatform() || this.isScanning) return;
      try {
        this.isScanning = true;
        this.telemetry.recordScanStart();

        // Android scans for both standard service UUID and Apple manufacturer overflow packets
        await BleClient.requestLEScan(
          {
            services: [MESH_SERVICE_UUID],
            allowDuplicates: false,
          },
          (result) => {
            if (result.device?.deviceId) {
              if (result.rssi !== undefined) {
                this.telemetry.recordPeerRssi(result.device.deviceId, result.rssi);
              }
              this.scheduler.enqueueDiscoveredPeer(result.device.deviceId);
            }
          }
        );
      } catch (err) {
        console.warn('[BleTransport] LE scan start warning:', err);
        this.isScanning = false;
        this.telemetry.recordScanStop();
      }
    };

    this.scheduler.onStopScan = async () => {
      if (this.isScanning) {
        try {
          await BleClient.stopLEScan();
        } catch {}
        this.isScanning = false;
        this.telemetry.recordScanStop();
      }
    };

    this.scheduler.onExecuteSession = async (peerId: string) => {
      await this.executeEphemeralSession(peerId);
    };

    this.scheduler.onForceDisconnect = async (peerId: string) => {
      try {
        await BleClient.disconnect(peerId);
      } catch {}
      this.currentConnectedDeviceId = null;
      this.telemetry.recordConnectionStop(peerId);
    };
  }

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
      this.scheduler.start();
    } catch (err) {
      console.error('[BleTransport] Failed to initialize native BLE client:', err);
    }
  }

  public async stop(): Promise<void> {
    this.isStarted = false;
    this.scheduler.stop();

    if (this.isScanning) {
      try {
        await BleClient.stopLEScan();
      } catch {}
      this.isScanning = false;
      this.telemetry.recordScanStop();
    }

    if (this.currentConnectedDeviceId) {
      try {
        await BleClient.disconnect(this.currentConnectedDeviceId);
      } catch {}
      this.telemetry.recordConnectionStop(this.currentConnectedDeviceId);
      this.currentConnectedDeviceId = null;
    }

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

    this.scheduler.recordActivity();

    // If already in an active session, attempt immediate flush
    if (this.currentConnectedDeviceId) {
      this.flushQueueToDevice(this.currentConnectedDeviceId).catch((err) => {
        console.warn(`[BleTransport] Failed to flush to active device ${this.currentConnectedDeviceId}:`, err);
      });
    }
  }

  // ─── Ephemeral Connect-and-Harvest Session ──────────────────────────────────

  private async executeEphemeralSession(deviceId: string): Promise<void> {
    this.currentConnectedDeviceId = deviceId;
    this.telemetry.recordConnectionStart(deviceId);

    try {
      console.log(`[BleTransport] Establishing single-flight session with peer: ${deviceId}`);
      await BleClient.connect(deviceId, (disconnectedId) => {
        if (this.currentConnectedDeviceId === disconnectedId) {
          this.currentConnectedDeviceId = null;
          this.telemetry.recordConnectionStop(disconnectedId);
          console.log(`[BleTransport] Peer disconnected: ${disconnectedId}`);
        }
      });

      // Query negotiated MTU (Android automatically requests 512, iOS auto-negotiates)
      let effectiveMtu = DEFAULT_ATT_MTU;
      try {
        effectiveMtu = await BleClient.getMtu(deviceId);
        console.log(`[BleTransport] Negotiated ATT MTU: ${effectiveMtu} with peer ${deviceId}`);
      } catch {
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
            this.telemetry.recordChunkReceived(deviceId, rawChunk.length);

            const completeFrame = this.fragmentationManager.ingestFragment(deviceId, rawChunk);
            if (completeFrame) {
              this.telemetry.recordFrameCompleted(deviceId);
              this.emitReceive(completeFrame);
            }
          }
        );
      } catch (subErr) {
        console.warn(`[BleTransport] Could not subscribe to notifications on ${deviceId}:`, subErr);
      }

      // Flush queued envelopes to peer
      await this.flushQueueToDevice(deviceId);

      // Keep session open briefly to harvest incoming response notifications
      await new Promise((resolve) => setTimeout(resolve, SESSION_HARVEST_WAIT_MS));
    } finally {
      // Teardown GATT connection to free native stack handle
      try {
        await BleClient.disconnect(deviceId);
      } catch {}
      this.telemetry.recordConnectionStop(deviceId);
      this.currentConnectedDeviceId = null;
      this.deviceMtus.delete(deviceId);
    }
  }

  private async flushQueueToDevice(deviceId: string): Promise<void> {
    const mtu = this.deviceMtus.get(deviceId) ?? DEFAULT_ATT_MTU;

    for (const frame of this.outgoingQueue) {
      const fragments = slicePayload(frame, mtu);

      for (const fragment of fragments) {
        const start = Date.now();
        try {
          const dataView = new DataView(fragment.buffer, fragment.byteOffset, fragment.byteLength);
          // Use write with response to enforce link-layer flow control and prevent Fluoride buffer overflow
          await BleClient.write(
            deviceId,
            MESH_SERVICE_UUID,
            MESH_CHARACTERISTIC_UUID,
            dataView
          );
          const rtt = Date.now() - start;
          this.telemetry.recordChunkTransmission(deviceId, fragment.length, true, rtt);
        } catch (err) {
          console.warn(`[BleTransport] Write fragment failed on ${deviceId}:`, err);
          this.telemetry.recordChunkTransmission(deviceId, fragment.length, false);
          this.scheduler.recordGattError(deviceId);
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
