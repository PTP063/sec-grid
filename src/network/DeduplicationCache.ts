/**
 * A bounded Map-based cache with TTL to track seen packet IDs.
 * Prevents infinite packet looping across tabs in the mesh network.
 */
export class DeduplicationCache {
  private cache: Map<string, number>;
  private defaultTtlMs: number;
  private maxItems: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  /**
   * Initializes the deduplication cache.
   * @param defaultTtlMs Time-to-live for cache entries in milliseconds. Default: 30 seconds.
   * @param maxItems Maximum number of items the cache can hold. Default: 1000.
   */
  constructor(defaultTtlMs: number = 30000, maxItems: number = 1000) {
    this.cache = new Map<string, number>();
    this.defaultTtlMs = defaultTtlMs;
    this.maxItems = maxItems;
    
    // Automatically drop/evict expired entries every 10 seconds
    this.cleanupInterval = setInterval(() => this.evictExpired(), 10000);
  }

  /**
   * Checks if a packet ID exists in the cache.
   * @param packetId The ID of the packet to check.
   * @returns true if the packet has been seen recently, false otherwise.
   */
  public has(packetId: string): boolean {
    if (!this.cache.has(packetId)) {
      return false;
    }
    const expiry = this.cache.get(packetId)!;
    if (Date.now() > expiry) {
      this.cache.delete(packetId);
      return false;
    }
    return true;
  }

  /**
   * Adds a packet ID to the cache.
   * Evicts older entries if the cache exceeds its maximum capacity.
   * @param packetId The ID of the packet to add.
   */
  public add(packetId: string): void {
    if (this.cache.has(packetId)) {
      return;
    }
    
    // Enforce maxItems limit by removing the oldest entry (Map maintains insertion order)
    if (this.cache.size >= this.maxItems) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(packetId, Date.now() + this.defaultTtlMs);
  }

  /**
   * Internal method to remove expired entries from the cache.
   */
  private evictExpired(): void {
    const now = Date.now();
    for (const [packetId, expiry] of this.cache.entries()) {
      if (now > expiry) {
        this.cache.delete(packetId);
      }
    }
  }

  /**
   * Cleans up the cache intervals. Should be called on teardown.
   */
  public destroy(): void {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}
