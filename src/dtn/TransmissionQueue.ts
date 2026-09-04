import type { EnvelopeData } from '../network/Serializer';
import { encodeEnvelope } from '../network/Serializer';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_SESSION_AIRTIME_BUDGET_BYTES = 50 * 1024; // 50 KB ceiling (~4.2s GATT window)
export const MAX_SESSION_RECORDS = 60; // Max ~60 triage envelopes per session

export interface QueuedEnvelope {
  envelope: EnvelopeData;
  priority: number; // 2 = CRITICAL, 1 = HIGH, 0 = LOW
  rawWireBytes?: Uint8Array;
  addedAt: number;
}

/**
 * In-memory Async Mutex lock to serialize anti-entropy state vector
 * updates and WAL transactions across concurrent Central/Peripheral bridges.
 */
export class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  public async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.locked = true;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Priority-Ordered DTN Transmission Queue.
 *
 * Implements:
 * 1. Strict priority sorting: CRITICAL (2) > HIGH (1) > LOW (0), then newest timestamp, then highest copiesLeft.
 * 2. Deterministic 50 KB session airtime budget enforcement.
 * 3. Atomic Compare-And-Swap (CAS) Spray-and-Wait copy splitting across bridge handshakes.
 * 4. Stateful per-peer session progress tracking to resume aborted syncs without byte waste.
 */
export class TransmissionQueue {
  private queue = new Map<string, QueuedEnvelope>(); // packetId -> QueuedEnvelope
  private peerSyncReceipts = new Map<string, Set<string>>(); // peerId -> Set of packetIds successfully synced
  public readonly mutex = new AsyncMutex();

  public enqueue(envelope: EnvelopeData, priority = 1): void {
    const existing = this.queue.get(envelope.packetId);
    if (!existing) {
      this.queue.set(envelope.packetId, {
        envelope: { ...envelope },
        priority,
        addedAt: Date.now(),
      });
    } else if (priority > existing.priority) {
      existing.priority = priority; // Escalate priority if newer triage is urgent
    }
  }

  public remove(packetId: string): void {
    this.queue.delete(packetId);
  }

  public get(packetId: string): QueuedEnvelope | undefined {
    return this.queue.get(packetId);
  }

  public getAll(): QueuedEnvelope[] {
    return Array.from(this.queue.values());
  }

  public size(): number {
    return this.queue.size;
  }

  /**
   * Builds an optimized, priority-sorted sync batch for a peer based on anti-entropy delta.
   * Enforces the 50 KB airtime budget and splits Spray-and-Wait copies atomically.
   *
   * @param peerId The target peer identifier
   * @param missingSequenceMap Senders and their specific sequence numbers the peer is missing
   * @returns Array of prepared raw wire frames and their corresponding packet IDs
   */
  public async prepareSyncBatch(
    peerId: string,
    missingSequenceMap: Map<string, bigint[]>
  ): Promise<{ frames: Uint8Array[]; packetIds: string[]; totalBytes: number }> {
    const release = await this.mutex.acquire();

    try {
      let receipts = this.peerSyncReceipts.get(peerId);
      if (!receipts) {
        receipts = new Set<string>();
        this.peerSyncReceipts.set(peerId, receipts);
      }

      // 1. Filter candidates matching missing sequences
      const candidates: QueuedEnvelope[] = [];
      for (const item of this.queue.values()) {
        const neededSeqs = missingSequenceMap.get(item.envelope.sender);
        if (neededSeqs && neededSeqs.includes(BigInt(item.envelope.sequenceNum))) {
          // Skip if already sent to this peer in this session
          if (!receipts.has(item.envelope.packetId)) {
            candidates.push(item);
          }
        }
      }

      // 2. Strict 3-tier Priority Comparator:
      // Priority (CRITICAL > HIGH > LOW) -> Timestamp (newest first) -> copiesLeft (highest first)
      candidates.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        if (b.envelope.timestamp !== a.envelope.timestamp) {
          return b.envelope.timestamp - a.envelope.timestamp;
        }
        return b.envelope.copiesLeft - a.envelope.copiesLeft;
      });

      // 3. Pack into 50 KB airtime budget
      const frames: Uint8Array[] = [];
      const packetIds: string[] = [];
      let totalBytes = 0;

      for (const item of candidates) {
        if (frames.length >= MAX_SESSION_RECORDS) break;

        // Atomically halve Spray-and-Wait copies: CAS on copiesLeft
        const localCopies = item.envelope.copiesLeft;
        const sendCopies = localCopies > 1 ? Math.floor(localCopies / 2) : 1;
        const retainedCopies = Math.max(1, localCopies - sendCopies);

        // Update local retained copies
        item.envelope.copiesLeft = retainedCopies;

        // Clone envelope with sendCopies for peer
        const outboundEnvelope: EnvelopeData = {
          ...item.envelope,
          copiesLeft: sendCopies,
        };

        const encodedFrame = encodeEnvelope(outboundEnvelope);
        if (totalBytes + encodedFrame.length > MAX_SESSION_AIRTIME_BUDGET_BYTES) {
          // Budget full: leave remaining items for subsequent contact windows
          break;
        }

        frames.push(encodedFrame);
        packetIds.push(item.envelope.packetId);
        totalBytes += encodedFrame.length;

        // Mark receipt
        receipts.add(item.envelope.packetId);
      }

      return { frames, packetIds, totalBytes };
    } finally {
      release();
    }
  }

  /**
   * Confirms successful delivery of packet IDs to a peer.
   */
  public acknowledgeDelivery(peerId: string, packetId: string): void {
    let receipts = this.peerSyncReceipts.get(peerId);
    if (!receipts) {
      receipts = new Set<string>();
      this.peerSyncReceipts.set(peerId, receipts);
    }
    receipts.add(packetId);
  }

  /**
   * Resets peer receipts (e.g. after a prolonged disconnection or cache purge).
   */
  public clearPeerReceipts(peerId: string): void {
    this.peerSyncReceipts.delete(peerId);
  }

  public clear(): void {
    this.queue.clear();
    this.peerSyncReceipts.clear();
  }
}
