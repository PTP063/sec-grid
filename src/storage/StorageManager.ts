import type { EnvelopeData, TriageStatus } from '../network/Serializer';

export interface StorageRecord {
  envelope: EnvelopeData;
  byteSize: number;
  priority: number; // 2 = CRITICAL, 1 = HIGH, 0 = LOW
  status: TriageStatus;
  isLocalOrigin: boolean;
  insertedAt: number;
}

export interface StorageStats {
  totalBytes: number;
  quotaBytes: number;
  utilizationRatio: number; // totalBytes / quotaBytes
  recordCount: number;
  evictionCount: number;
}

export const DEFAULT_STORAGE_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB hard ceiling
export const RESOLVED_EVICTION_AGE_MS = 6 * 3600 * 1_000; // 6 hours

/**
 * Quota-Enforced Storage & Eviction Engine for Mesh·OS.
 *
 * Enforces a strict 50 MB storage boundary on low-end hardware, applying a
 * deterministic 4-tier eviction cascade to guarantee that local, un-replicated
 * CRITICAL emergency distress signals are NEVER evicted.
 */
export class StorageManager {
  private records = new Map<string, StorageRecord>(); // packetId -> StorageRecord
  private currentTotalBytes = 0;
  private readonly quotaBytes: number;
  private localNodeId: string;
  private totalEvictions = 0;

  constructor(localNodeId: string, quotaBytes = DEFAULT_STORAGE_QUOTA_BYTES) {
    this.localNodeId = localNodeId;
    this.quotaBytes = quotaBytes;
  }

  public setLocalNodeId(id: string): void {
    this.localNodeId = id;
  }

  /**
   * Commits an envelope to bounded storage, automatically triggering
   * eviction cascade if the quota would be exceeded.
   */
  public put(
    envelope: EnvelopeData,
    byteSize: number,
    priority = 1,
    status: TriageStatus = 'PENDING'
  ): boolean {
    const isLocalOrigin = envelope.sender === this.localNodeId;

    // Check if replacing existing record
    const existing = this.records.get(envelope.packetId);
    if (existing) {
      this.currentTotalBytes -= existing.byteSize;
    }

    // Check if incoming record causes quota overflow
    if (this.currentTotalBytes + byteSize > this.quotaBytes) {
      const bytesNeeded = (this.currentTotalBytes + byteSize) - this.quotaBytes;
      this.evict(bytesNeeded);
      if (this.currentTotalBytes + byteSize > this.quotaBytes) {
        // If still overflowing after eviction, reject if not local critical
        if (priority === 2 && isLocalOrigin) {
          // Emergency override: local critical must always be preserved!
          console.warn('[StorageManager] Storage saturated! Preserving local CRITICAL record.');
        } else {
          console.warn('[StorageManager] Storage saturated! Dropping non-critical packet:', envelope.packetId);
          return false;
        }
      }
    }

    this.records.set(envelope.packetId, {
      envelope: { ...envelope },
      byteSize,
      priority,
      status,
      isLocalOrigin,
      insertedAt: Date.now(),
    });
    this.currentTotalBytes += byteSize;

    return true;
  }

  public get(packetId: string): StorageRecord | undefined {
    return this.records.get(packetId);
  }

  public remove(packetId: string): boolean {
    const record = this.records.get(packetId);
    if (record) {
      this.currentTotalBytes -= record.byteSize;
      this.records.delete(packetId);
      return true;
    }
    return false;
  }

  public updateStatus(packetId: string, newStatus: TriageStatus): void {
    const record = this.records.get(packetId);
    if (record) {
      record.status = newStatus;
    }
  }

  /**
   * Deterministic 4-Tier Eviction Cascade:
   *
   * Tier 1: RESOLVED incidents older than RESOLVED_EVICTION_AGE_MS (6h).
   * Tier 2: Expired TTL packets (ttl <= 1) of LOW priority (priority 0).
   * Tier 3: Oldest HIGH priority packets with remaining copiesLeft > 1.
   * Invariant: NEVER evict un-replicated CRITICAL records originating from local device!
   */
  public evict(bytesToFree: number): number {
    let freedBytes = 0;
    const now = Date.now();

    // ── Tier 1: RESOLVED incidents older than 6 hours ──
    for (const [id, record] of this.records.entries()) {
      if (freedBytes >= bytesToFree) break;
      if (record.status === 'RESOLVED' && (now - record.insertedAt) > RESOLVED_EVICTION_AGE_MS) {
        freedBytes += record.byteSize;
        this.currentTotalBytes -= record.byteSize;
        this.records.delete(id);
        this.totalEvictions++;
      }
    }

    // ── Tier 2: Expired LOW priority packets (TTL <= 1) ──
    if (freedBytes < bytesToFree) {
      for (const [id, record] of this.records.entries()) {
        if (freedBytes >= bytesToFree) break;
        if (record.priority === 0 && record.envelope.ttl <= 1) {
          freedBytes += record.byteSize;
          this.currentTotalBytes -= record.byteSize;
          this.records.delete(id);
          this.totalEvictions++;
        }
      }
    }

    // ── Tier 3: Oldest non-local or replicated records (copiesLeft > 1) ──
    if (freedBytes < bytesToFree) {
      const candidates = Array.from(this.records.values())
        .filter((r) => {
          // Invariant Check: NEVER evict local CRITICAL
          if (r.priority === 2 && r.isLocalOrigin) return false;
          return r.envelope.copiesLeft > 1 || r.status === 'RESOLVED';
        })
        .sort((a, b) => a.insertedAt - b.insertedAt); // Oldest first

      for (const candidate of candidates) {
        if (freedBytes >= bytesToFree) break;
        freedBytes += candidate.byteSize;
        this.currentTotalBytes -= candidate.byteSize;
        this.records.delete(candidate.envelope.packetId);
        this.totalEvictions++;
      }
    }

    return freedBytes;
  }

  public getStats(): StorageStats {
    return {
      totalBytes: this.currentTotalBytes,
      quotaBytes: this.quotaBytes,
      utilizationRatio: Math.round((this.currentTotalBytes / this.quotaBytes) * 1000) / 1000,
      recordCount: this.records.size,
      evictionCount: this.totalEvictions,
    };
  }

  public clear(): void {
    this.records.clear();
    this.currentTotalBytes = 0;
    this.totalEvictions = 0;
  }
}
