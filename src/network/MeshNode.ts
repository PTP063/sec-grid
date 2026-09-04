import type {
  NodeMetadata,
  NetworkPacket,
  PacketListener,
  NodeListListener,
  PacketType,
} from './types';
import { DeduplicationCache } from './DeduplicationCache';
import { sealPayload, unsealPayload } from '../security/Crypto';
import { createWirePacket, relayWirePacket, unpackWirePacket } from './Envelope';
import type { ITransport } from './ITransport';
import { BleTransport } from './BleTransport';
import { BroadcastChannelTransport } from './BroadcastChannelTransport';
import { acquireWakeLock, initAudioKeepAlive } from '../utils/lifecycle';
import { Capacitor } from '@capacitor/core';

import Peer, { type DataConnection } from 'peerjs';

// ─── Constants ────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MIN = 2_000;
const HEARTBEAT_INTERVAL_MAX = 10_000;
const PRUNE_INTERVAL_MS = 2_500;
const PEER_TIMEOUT_MS = 25_000; // Tolerates up to 10s heartbeats + jitter

// ─── MeshNode ────────────────────────────────────────────────────────────────

/**
 * Event-driven P2P transport node backed by Native BLE (on mobile),
 * BroadcastChannel (in browsers), and fallback WebRTC (PeerJS).
 *
 * Responsibilities:
 * - Automatically initializes Native BleTransport when running in Capacitor,
 *   or BroadcastChannelTransport when running in desktop browsers.
 * - Broadcasts heartbeats so peers discover it.
 * - Prunes silent peers beyond PEER_TIMEOUT_MS.
 * - Relays multi-hop packets via zero-knowledge relay slicing.
 * - Wire-level deduplication via bounded cache.
 * - Enforces screen-off background persistence via wake locks and audio keep-alive.
 */
export class MeshNode {
  public readonly id: string;
  public readonly transport: ITransport;

  private readonly channel: BroadcastChannel;
  private readonly cache: DeduplicationCache;
  private readonly peers: Map<string, NodeMetadata>;
  private readonly webrtcConnections: Map<string, DataConnection>;

  private readonly packetListeners: Set<PacketListener<unknown>>;
  private readonly nodeListListeners: Set<NodeListListener>;
  private readonly peerjsIdListeners: Set<(id: string) => void>;

  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private currentHeartbeatInterval = HEARTBEAT_INTERVAL_MIN;
  private readonly pruneTimer: ReturnType<typeof setInterval>;
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;

  public peerjs: Peer | null = null;
  public peerjsId: string | null = null;
  public signalingServer?: { host: string; port: number; path: string };
  public encryptionKey: string;

  // Track total packets received for telemetry
  public packetsReceived = 0;
  public packetsSent = 0;

  constructor(
    channelName = 'mesh-network',
    signalingServer?: { host: string; port: number; path: string },
    encryptionKey = 'TACTICAL_MESH_KEY_01',
    customTransport?: ITransport
  ) {
    this.encryptionKey = encryptionKey;
    this.signalingServer = signalingServer;
    this.id = crypto.randomUUID();
    this.channel = new BroadcastChannel(channelName);
    this.cache = new DeduplicationCache();
    this.peers = new Map();
    this.webrtcConnections = new Map();

    this.packetListeners = new Set();
    this.nodeListListeners = new Set();
    this.peerjsIdListeners = new Set();

    // 1. Injected or Dynamic Transport Selection
    if (customTransport) {
      this.transport = customTransport;
    } else if (Capacitor.isNativePlatform()) {
      console.log('[MeshNode] Native platform detected: activating native BleTransport.');
      this.transport = new BleTransport();
    } else {
      console.log('[MeshNode] Desktop/Browser detected: activating BroadcastChannelTransport.');
      this.transport = new BroadcastChannelTransport(channelName);
    }

    // Subscribe to wire frames from the active transport
    this.transport.onReceive((rawBytes) => {
      this.handleIncomingWireBytes(rawBytes);
    });

    // Start transport loop
    this.transport.start().catch((err) => {
      console.warn('[MeshNode] Transport failed to start:', err);
    });

    // Wire native screen-off keep-alive hooks
    if (Capacitor.isNativePlatform()) {
      acquireWakeLock().catch(() => {});
      initAudioKeepAlive();
    }

    this.channel.onmessage = this.handleIncoming.bind(this);

    // Initialize WebRTC only if in browser environment or if signalingServer is explicitly supplied
    if (!Capacitor.isNativePlatform() || this.signalingServer) {
      this.initWebRTC();
    }

    // Send an immediate heartbeat so sibling tabs see us right away
    this.broadcast(null, 'HEARTBEAT');

    this.scheduleNextHeartbeat();
    this.pruneTimer = setInterval(() => this.pruneSilentPeers(), PRUNE_INTERVAL_MS);

    // If we have a local signaling server with discovery enabled, poll it
    if (this.signalingServer) {
      this.discoveryTimer = setInterval(() => this.pollForPeers(), 5000);
      this.pollForPeers();
    }
  }

  private scheduleNextHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.broadcast(null, 'HEARTBEAT');
      this.currentHeartbeatInterval = Math.min(
        this.currentHeartbeatInterval * 1.5,
        HEARTBEAT_INTERVAL_MAX
      );
      this.scheduleNextHeartbeat();
    }, this.currentHeartbeatInterval);
  }

  private initWebRTC() {
    try {
      if (this.signalingServer) {
        console.log(`[MeshNode] Connecting to local signaling bridge at ${this.signalingServer.host}:${this.signalingServer.port}`);
        this.peerjs = new Peer({
          host: this.signalingServer.host,
          port: this.signalingServer.port,
          path: this.signalingServer.path,
          secure: this.signalingServer.port === 443,
        });
      } else {
        this.peerjs = new Peer();
      }

      this.peerjs.on('open', (id) => {
        this.peerjsId = id;
        console.log('[MeshNode] WebRTC Online. ID:', id);
        for (const listener of this.peerjsIdListeners) {
          try { listener(id); } catch (err) { console.error('[MeshNode] PeerJsId listener threw:', err); }
        }
      });

      this.peerjs.on('connection', (conn) => {
        this.setupWebRTCConnection(conn);
      });

      this.peerjs.on('error', (err) => {
        console.warn('[MeshNode] WebRTC error:', err);
      });
    } catch (e) {
      console.warn('[MeshNode] WebRTC initialization skipped:', e);
    }
  }

  public onPeerJsId(listener: (id: string) => void): () => void {
    this.peerjsIdListeners.add(listener);
    if (this.peerjsId) listener(this.peerjsId);
    return () => this.peerjsIdListeners.delete(listener);
  }

  public connectToWebRTCPeer(targetPeerjsId: string) {
    if (!this.peerjs) return;
    const conn = this.peerjs.connect(targetPeerjsId);
    this.setupWebRTCConnection(conn);
  }

  private setupWebRTCConnection(conn: DataConnection) {
    conn.on('open', () => {
      console.log('[MeshNode] WebRTC Connected to:', conn.peer);
      this.webrtcConnections.set(conn.peer, conn);
    });

    conn.on('data', (data) => {
      if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        this.handleIncomingWireBytes(buffer);
      } else {
        const event = { data } as MessageEvent;
        this.handleIncoming(event);
      }
    });

    conn.on('close', () => {
      this.webrtcConnections.delete(conn.peer);
    });

    conn.on('error', () => {
      this.webrtcConnections.delete(conn.peer);
    });
  }

  private async pollForPeers() {
    if (!this.signalingServer || !this.peerjsId) return;
    try {
      const scheme = this.signalingServer.port === 443 ? 'https' : 'http';
      const url = `${scheme}://${this.signalingServer.host}:${this.signalingServer.port}${this.signalingServer.path}/peerjs/peers`;
      const res = await fetch(url);
      if (!res.ok) return;
      const peers: string[] = await res.json();

      for (const peerId of peers) {
        if (peerId !== this.peerjsId && !this.webrtcConnections.has(peerId)) {
          console.log('[MeshNode] Discovered new peer via Signaling Server:', peerId);
          this.connectToWebRTCPeer(peerId);
        }
      }
    } catch {
      // Ignore network errors on polling
    }
  }

  // ── Public broadcast ───────────────────────────────────────────────────────

  public async broadcast<T>(payload: T, type: PacketType = 'DATA', targetId?: string, ttl = 5): Promise<void> {
    const packetId = crypto.randomUUID();
    let finalPayload = payload;

    if (payload instanceof Uint8Array && this.encryptionKey) {
      try {
        finalPayload = (await sealPayload(payload, this.encryptionKey, this.id)) as unknown as T;

        // Construct standardized binary wire frame and dispatch across active native/browser transport
        const wireFrame = await createWirePacket({
          packetId,
          senderId: this.id,
          recipientId: targetId,
          ttl,
          type,
          plaintextPayload: payload,
          passphrase: this.encryptionKey,
        });

        this.transport.send(wireFrame).catch((err) => {
          console.warn('[MeshNode] Transport send error:', err);
        });
      } catch (err) {
        console.error('[MeshNode] Encryption failed, dropping packet:', err);
        return;
      }
    }

    const packet: NetworkPacket<T> = {
      header: { packetId, senderId: this.id, targetId, ttl, timestamp: Date.now(), type },
      payload: finalPayload,
    };
    this.cache.add(packetId);

    // Broadcast locally
    this.channel.postMessage(packet);

    // Broadcast over WebRTC
    for (const conn of this.webrtcConnections.values()) {
      try {
        conn.send(packet);
      } catch (err) {
        console.warn('[MeshNode] Failed to send over WebRTC:', err);
      }
    }

    if (type === 'DATA') {
      this.packetsSent++;
      this.currentHeartbeatInterval = HEARTBEAT_INTERVAL_MIN;
      this.scheduleNextHeartbeat();
    }
  }

  // ── Subscription API ───────────────────────────────────────────────────────

  /** Subscribe to incoming DATA packets. Returns an unsubscribe function. */
  public onMessage<T>(listener: PacketListener<T>): () => void {
    const l = listener as PacketListener<unknown>;
    this.packetListeners.add(l);
    return () => this.packetListeners.delete(l);
  }

  /**
   * Subscribe to changes in the active peer list.
   * The listener is called immediately with the current state.
   * Returns an unsubscribe function.
   */
  public onNodeListChange(listener: NodeListListener): () => void {
    this.nodeListListeners.add(listener);
    listener(this.getNodeList());
    return () => this.nodeListListeners.delete(listener);
  }

  // ── Peer list ─────────────────────────────────────────────────────────────

  public getNodeList(): NodeMetadata[] {
    const self: NodeMetadata = {
      id: this.id,
      status: 'ACTIVE',
      lastSeen: Date.now(),
      isSelf: true,
    };
    return [self, ...Array.from(this.peers.values())];
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  public destroy(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    clearInterval(this.pruneTimer);
    this.packetListeners.clear();
    this.nodeListListeners.clear();
    this.cache.destroy();
    this.channel.close();
    this.peerjs?.destroy();
    this.transport.stop().catch(() => {});
  }

  // ── Private Handlers ──────────────────────────────────────────────────────

  /**
   * Handles incoming raw binary wire packets from BLE or BroadcastChannel.
   * Relays without decrypting, and delivers locally if addressed to us.
   */
  public async handleIncomingWireBytes(buffer: Uint8Array): Promise<void> {
    // 1. Fast zero-knowledge relaying: mutate TTL/copiesLeft and re-broadcast with ZERO crypto!
    const relayed = relayWirePacket(buffer, this.id);
    if (relayed) {
      this.transport.send(relayed).catch(() => {});
      this.channel.postMessage(relayed);
      for (const conn of this.webrtcConnections.values()) {
        try {
          conn.send(relayed);
        } catch {}
      }
    }

    // 2. Unpack for local delivery if destination matches or broadcast
    const unpacked = await unpackWirePacket(buffer, this.encryptionKey, this.id);
    if (unpacked && unpacked.isForUs && unpacked.decryptedPayload) {
      this.touchPeer(unpacked.header.senderId);
      this.packetsReceived++;
      this.emitPacket({
        header: {
          packetId: unpacked.header.packetId,
          senderId: unpacked.header.senderId,
          targetId: unpacked.header.recipientId,
          ttl: unpacked.header.ttl,
          timestamp: unpacked.header.timestamp,
          type: unpacked.header.type,
        },
        payload: unpacked.decryptedPayload,
      });
    }
  }

  private async handleIncoming(event: MessageEvent): Promise<void> {
    const rawData = event.data;

    // Handle binary wire frames directly if transmitted over WebRTC / BroadcastChannel
    if (rawData instanceof Uint8Array || rawData instanceof ArrayBuffer) {
      const buffer = rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : rawData;
      await this.handleIncomingWireBytes(buffer);
      return;
    }

    const packet = event.data as NetworkPacket<unknown>;

    // Structural guard
    if (!packet?.header?.packetId) return;

    const { packetId, senderId, targetId, ttl, type } = packet.header;

    // Drop own packets (BroadcastChannel also sends to self in some engines)
    if (senderId === this.id) return;

    // Deduplication — drop if seen before
    if (this.cache.has(packetId)) return;
    this.cache.add(packetId);

    // Record peer presence (heartbeat OR data — both prove the peer is alive)
    this.touchPeer(senderId);

    if (type === 'DATA') {
      this.packetsReceived++;

      // Epidemic Gossip Protocol: Relay multi-hop traffic (SYNCHRONOUSLY, WITHOUT DECRYPTING)
      if (targetId === this.id) {
        // Do not relay packets explicitly targeting us
      } else if (ttl > 1) {
        const relayedPacket = {
          ...packet,
          header: { ...packet.header, ttl: ttl - 1 },
        };
        this.channel.postMessage(relayedPacket);
        for (const conn of this.webrtcConnections.values()) {
          try {
            conn.send(relayedPacket);
          } catch (err) {
            console.warn('[MeshNode] Failed to relay over WebRTC:', err);
          }
        }
      }

      // Deliver to local UI only if addressed to us or broadcast
      if (!targetId || targetId === this.id) {
        if (packet.payload instanceof Uint8Array && this.encryptionKey) {
          const decrypted = await unsealPayload(packet.payload, this.encryptionKey);
          if (decrypted) {
            this.emitPacket({ ...packet, payload: decrypted });
          } else {
            console.warn('[MeshNode] Packet dropped: Auth tag mismatch or payload corrupted.');
          }
        } else {
          this.emitPacket(packet);
        }
      }
    }
  }

  /**
   * Records or refreshes a peer's presence.
   */
  private touchPeer(peerId: string): void {
    const isNew = !this.peers.has(peerId);
    this.peers.set(peerId, {
      id: peerId,
      status: 'ACTIVE',
      lastSeen: Date.now(),
      isSelf: false,
    });
    if (isNew) {
      this.emitNodeList();
      // Instantly ack presence to the new peer to bypass background throttling
      this.broadcast(null, 'HEARTBEAT');
    }
  }

  /**
   * Removes peers whose last heartbeat is older than PEER_TIMEOUT_MS.
   */
  private pruneSilentPeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, meta] of this.peers) {
      if (now - meta.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitNodeList();
  }

  private emitPacket(packet: NetworkPacket<unknown>): void {
    for (const listener of this.packetListeners) {
      try { listener(packet); } catch (err) { console.error('[MeshNode] Packet listener threw:', err); }
    }
  }

  private emitNodeList(): void {
    const list = this.getNodeList();
    for (const listener of this.nodeListListeners) {
      try { listener(list); } catch (err) { console.error('[MeshNode] NodeList listener threw:', err); }
    }
  }
}
