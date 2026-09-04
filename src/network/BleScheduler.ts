/**
 * Autonomous Peer Discovery & Collision Avoidance Engine for Mesh·OS.
 *
 * Implements:
 * 1. Tiered Adaptive Jittered Duty-Cycling state machine (Normal 15%, Idle 5%, Surge 40%).
 * 2. Serialized FIFO Connection Queue with single-flight concurrency limiter (concurrency = 1).
 * 3. Strict 8-second session timeout with mandatory 400ms Fluoride stack recovery cooldown.
 * 4. Status 133 (GATT_ERROR / INSUFFICIENT_RESOURCES) 30-second peer backoff.
 */

export type SchedulerState = 'IDLE' | 'SCANNING' | 'CONNECTING' | 'TRANSFERRING' | 'COOLDOWN';
export type DutyCycleTier = 'NORMAL' | 'IDLE' | 'SURGE';

export interface SchedulerConfig {
  scanWindowNormalMs: number;
  quietWindowNormalMs: number;
  scanWindowIdleMs: number;
  quietWindowIdleMs: number;
  scanWindowSurgeMs: number;
  quietWindowSurgeMs: number;
  jitterRatio: number; // ±20% (0.20)
  sessionTimeoutMs: number; // 8s
  interSessionCooldownMs: number; // 400ms
  status133BackoffMs: number; // 30s
  peerRevisitCooldownMs: number; // 15s
  idleThresholdMs: number; // 5 min
  surgeDurationMs: number; // 90s
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  scanWindowNormalMs: 1_500,
  quietWindowNormalMs: 10_000,
  scanWindowIdleMs: 1_500,
  quietWindowIdleMs: 30_000,
  scanWindowSurgeMs: 2_000,
  quietWindowSurgeMs: 5_000,
  jitterRatio: 0.20,
  sessionTimeoutMs: 8_000,
  interSessionCooldownMs: 400,
  status133BackoffMs: 30_000,
  peerRevisitCooldownMs: 15_000,
  idleThresholdMs: 300_000,
  surgeDurationMs: 90_000,
};

export class BleScheduler {
  private config: SchedulerConfig;
  private state: SchedulerState = 'IDLE';
  private tier: DutyCycleTier = 'NORMAL';

  private isRunning = false;
  private lastActivityTimestamp = Date.now();
  private surgeUntilTimestamp = 0;

  // Timers
  private activeTimer: ReturnType<typeof setTimeout> | null = null;

  // Serialized FIFO connection queue
  private connectionQueue: string[] = [];
  private activePeer: string | null = null;
  private peerBlacklist = new Map<string, number>(); // peerId -> blacklistedUntil timestamp

  // Hooks invoked by the scheduler
  public onStartScan: () => Promise<void> = async () => {};
  public onStopScan: () => Promise<void> = async () => {};
  public onExecuteSession: (peerId: string) => Promise<void> = async () => {};
  public onForceDisconnect: (peerId: string) => Promise<void> = async () => {};

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastActivityTimestamp = Date.now();
    this.transitionTo('IDLE');
    this.scheduleNextCycle();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    this.connectionQueue = [];
    this.activePeer = null;
    this.transitionTo('IDLE');
  }

  public getState(): SchedulerState {
    return this.state;
  }

  public getTier(): DutyCycleTier {
    return this.tier;
  }

  // ─── Urgency & State Triggers ─────────────────────────────────────────────

  /**
   * Surges the duty cycle to 40% (2s scan / 5s quiet) for 90 seconds
   * upon queuing or receiving a high-priority CRITICAL SOS packet.
   */
  public triggerEmergencySurge(): void {
    this.surgeUntilTimestamp = Date.now() + this.config.surgeDurationMs;
    this.lastActivityTimestamp = Date.now();
    this.updateTier();

    // If currently waiting in a long quiet window, awaken immediately
    if (this.state === 'IDLE' && this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
      this.scheduleNextCycle();
    }
  }

  /**
   * Notifies the scheduler of general mesh activity to prevent idle decay.
   */
  public recordActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Enqueues a discovered peer for a serialized ephemeral GATT session.
   */
  public enqueueDiscoveredPeer(peerId: string): boolean {
    const now = Date.now();
    const blacklistedUntil = this.peerBlacklist.get(peerId);

    if (blacklistedUntil && now < blacklistedUntil) {
      return false; // Skip blacklisted peer (error 133 or recent session)
    }

    if (this.activePeer === peerId || this.connectionQueue.includes(peerId)) {
      return false; // Already queued or active
    }

    this.connectionQueue.push(peerId);
    this.recordActivity();

    // If currently scanning or idle, process queue promptly
    if (this.state === 'SCANNING' || this.state === 'IDLE') {
      this.processQueue();
    }

    return true;
  }

  /**
   * Marks a peer as having encountered GATT status 133 or an unrecoverable failure,
   * applying an immediate 30-second backoff.
   */
  public recordGattError(peerId: string): void {
    const until = Date.now() + this.config.status133BackoffMs;
    this.peerBlacklist.set(peerId, until);
    console.warn(`[BleScheduler] Peer ${peerId} blacklisted for 30s due to GATT error.`);
  }

  // ─── Queue Processing & Concurrency Enforcement ────────────────────────────

  private async processQueue(): Promise<void> {
    if (!this.isRunning || this.activePeer !== null || this.state === 'CONNECTING' || this.state === 'TRANSFERRING') {
      return; // Single-flight concurrency: only 1 peer in flight at any time
    }

    // Clean expired blacklist entries
    const now = Date.now();
    for (const [id, until] of this.peerBlacklist.entries()) {
      if (now >= until) this.peerBlacklist.delete(id);
    }

    if (this.connectionQueue.length === 0) {
      return;
    }

    const nextPeer = this.connectionQueue.shift()!;
    this.activePeer = nextPeer;

    // 1. Suspend scanning immediately to grant the 2.4 GHz radio 100% focus
    if (this.state === 'SCANNING') {
      if (this.activeTimer) {
        clearTimeout(this.activeTimer);
        this.activeTimer = null;
      }
      try {
        await this.onStopScan();
      } catch {}
    }

    this.transitionTo('CONNECTING');

    // 2. Set strict 8-second watchdog timer to abort hung connections
    let sessionCompleted = false;
    const watchdog = setTimeout(async () => {
      if (!sessionCompleted) {
        console.warn(`[BleScheduler] Session watchdog expired (8s) for ${nextPeer}. Force-disconnecting.`);
        this.recordGattError(nextPeer);
        try {
          await this.onForceDisconnect(nextPeer);
        } catch {}
        this.finalizeSession(nextPeer);
      }
    }, this.config.sessionTimeoutMs);

    try {
      this.transitionTo('TRANSFERRING');
      await this.onExecuteSession(nextPeer);
      sessionCompleted = true;
      clearTimeout(watchdog);

      // Normal revisit cooldown (15s)
      this.peerBlacklist.set(nextPeer, Date.now() + this.config.peerRevisitCooldownMs);
    } catch (err) {
      sessionCompleted = true;
      clearTimeout(watchdog);
      console.warn(`[BleScheduler] Error during session with ${nextPeer}:`, err);
      this.recordGattError(nextPeer);
    } finally {
      this.finalizeSession(nextPeer);
    }
  }

  private finalizeSession(_peerId: string): void {
    this.activePeer = null;
    this.transitionTo('COOLDOWN');

    // 3. Mandatory 400ms Fluoride stack recovery cooldown before next connect/scan
    setTimeout(() => {
      if (!this.isRunning) return;

      if (this.connectionQueue.length > 0) {
        this.processQueue();
      } else {
        this.transitionTo('IDLE');
        this.scheduleNextCycle();
      }
    }, this.config.interSessionCooldownMs);
  }

  // ─── Cycle Scheduling with Jitter ──────────────────────────────────────────

  private scheduleNextCycle(): void {
    if (!this.isRunning || this.activePeer !== null) return;

    this.updateTier();

    let scanWindowMs: number;
    let quietWindowMs: number;

    switch (this.tier) {
      case 'SURGE':
        scanWindowMs = this.config.scanWindowSurgeMs;
        quietWindowMs = this.config.quietWindowSurgeMs;
        break;
      case 'IDLE':
        scanWindowMs = this.config.scanWindowIdleMs;
        quietWindowMs = this.config.quietWindowIdleMs;
        break;
      case 'NORMAL':
      default:
        scanWindowMs = this.config.scanWindowNormalMs;
        quietWindowMs = this.config.quietWindowNormalMs;
        break;
    }

    // Apply ±20% randomized jitter: interval * (1 + random * 2 * jitter - jitter)
    const jitterFactor = 1 + (Math.random() * 2 - 1) * this.config.jitterRatio;
    const jitteredQuietMs = Math.round(quietWindowMs * jitterFactor);

    // Schedule active scan window
    this.activeTimer = setTimeout(async () => {
      if (!this.isRunning || this.activePeer !== null) return;

      this.transitionTo('SCANNING');
      try {
        await this.onStartScan();
      } catch (err) {
        console.warn('[BleScheduler] onStartScan error:', err);
      }

      // Keep scanner alive for scanWindowMs unless a peer connection preempts it
      this.activeTimer = setTimeout(async () => {
        if (this.state === 'SCANNING') {
          try {
            await this.onStopScan();
          } catch {}
          this.transitionTo('IDLE');
          this.scheduleNextCycle();
        }
      }, scanWindowMs);
    }, jitteredQuietMs);
  }

  private updateTier(): void {
    const now = Date.now();
    if (now < this.surgeUntilTimestamp) {
      this.tier = 'SURGE';
    } else if (now - this.lastActivityTimestamp > this.config.idleThresholdMs) {
      this.tier = 'IDLE';
    } else {
      this.tier = 'NORMAL';
    }
  }

  private transitionTo(newState: SchedulerState): void {
    this.state = newState;
  }
}
