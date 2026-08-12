import type {
  NodeMetadata,
  NetworkPacket,
  PacketListener,
  NodeListListener,
  PacketType,
} from './types';
import { DeduplicationCache } from './DeduplicationCache';

// ─── Constants ────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 2_000;
const PRUNE_INTERVAL_MS = 2_500;
const PEER_TIMEOUT_MS = 6_000;  // Slightly longer than heartbeat*2 for jitter tolerance

// ─── MeshNode ────────────────────────────────────────────────────────────────

/**
 * Event-driven P2P transport node backed by the browser's `BroadcastChannel` API.
 *
 * Responsibilities:
 * - Generates a stable UUID for this browser tab on construction.
 * - Broadcasts heartbeats at a fixed interval so peers can discover it.
 * - Prunes peers that have gone silent beyond `PEER_TIMEOUT_MS`.
 * - Routes incoming DATA packets to registered listeners.
 * - Relays targeted packets with TTL decrement (multi-hop mesh support).
 * - Deduplicates packets via a bounded TTL cache.
 *
 * Lifecycle: call `destroy()` on unmount to cleanly release all resources.
 */
export class MeshNode {
  public readonly id: string;

  private readonly channel: BroadcastChannel;
  private readonly cache: DeduplicationCache;
  private readonly peers: Map<string, NodeMetadata>;

  private readonly packetListeners: Set<PacketListener<unknown>>;
  private readonly nodeListListeners: Set<NodeListListener>;

  private readonly heartbeatTimer: ReturnType<typeof setInterval>;
  private readonly pruneTimer: ReturnType<typeof setInterval>;

  // Track total packets received for telemetry
  public packetsReceived = 0;
  public packetsSent = 0;

  constructor(channelName = 'mesh-network') {
    this.id = crypto.randomUUID();
    this.channel = new BroadcastChannel(channelName);
    this.cache = new DeduplicationCache();
    this.peers = new Map();

    this.packetListeners = new Set();
    this.nodeListListeners = new Set();

    this.channel.onmessage = this.handleIncoming.bind(this);

    // Send an immediate heartbeat so sibling tabs see us right away
    this.broadcast(null, 'HEARTBEAT');

    this.heartbeatTimer = setInterval(() => this.broadcast(null, 'HEARTBEAT'), HEARTBEAT_INTERVAL_MS);
    this.pruneTimer = setInterval(() => this.pruneSilentPeers(), PRUNE_INTERVAL_MS);
  }

  // ── Public broadcast ───────────────────────────────────────────────────────

  public broadcast<T>(payload: T, type: PacketType = 'DATA', targetId?: string, ttl = 5): void {
    const packetId = crypto.randomUUID();
    const packet: NetworkPacket<T> = {
      header: { packetId, senderId: this.id, targetId, ttl, timestamp: Date.now(), type },
      payload,
    };
    this.cache.add(packetId);
    this.channel.postMessage(packet);
    if (type === 'DATA') this.packetsSent++;
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
    clearInterval(this.heartbeatTimer);
    clearInterval(this.pruneTimer);
    this.packetListeners.clear();
    this.nodeListListeners.clear();
    this.cache.destroy();
    this.channel.close();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private handleIncoming(event: MessageEvent): void {
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
      // Deliver to local listeners only if broadcast or addressed to us
      if (!targetId || targetId === this.id) {
        this.emitPacket(packet);
      }
      // Multi-hop relay for packets addressed to another node
      if (targetId && targetId !== this.id && ttl > 1) {
        this.channel.postMessage({
          ...packet,
          header: { ...packet.header, ttl: ttl - 1 },
        });
      }
    }

    // ACK is handled here in future; HEARTBEAT just updates lastSeen above.
  }

  /**
   * Records or refreshes a peer's presence.
   * Only emits a nodeList event on *new* peers to avoid flooding listeners
   * with a rebuild on every heartbeat from existing peers.
   */
  private touchPeer(peerId: string): void {
    const isNew = !this.peers.has(peerId);
    this.peers.set(peerId, {
      id: peerId,
      status: 'ACTIVE',
      lastSeen: Date.now(),
      isSelf: false,
    });
    if (isNew) this.emitNodeList();
  }

  /**
   * Removes peers whose last heartbeat is older than PEER_TIMEOUT_MS.
   * Emits a nodeList event only when at least one peer was actually removed.
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
