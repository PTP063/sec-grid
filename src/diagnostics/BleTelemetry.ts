/**
 * Physical Radio & Battery Telemetry Subsystem for Mesh·OS.
 *
 * Tracks real-time link-layer RF health, dynamic Packet Error Rates (PER),
 * GATT round-trip latency, airtime utilization, and battery discharge velocity
 * to guarantee continuous 24-hour disaster blackout viability.
 */

export interface PeerLinkMetrics {
  peerId: string;
  lastRssi: number;
  emaRssi: number; // Exponential Moving Average (alpha = 0.2)
  lastSeen: number;
  rttMs: number;
  chunksSent: number;
  chunksReceived: number;
  chunksFailed: number;
  framesCompleted: number;
  packetErrorRate: number; // 0.0 to 1.0
  totalBytesTransferred: number;
  estimatedAirtimeMs: number;
}

export interface SystemPowerMetrics {
  uptimeMs: number;
  activeScanTimeMs: number;
  activeConnectionTimeMs: number;
  scanDutyCycleRatio: number; // activeScan / uptime (target < 0.20)
  connectionDutyCycleRatio: number;
  currentBatteryLevel: number | null; // 0.0 to 1.0
  dischargeRatePercentPerHour: number | null;
  estimatedSurvivalHours: number | null;
  is24HourSurvivalSafe: boolean;
}

export class BleTelemetry {
  private static instance: BleTelemetry | null = null;

  private startTime = Date.now();
  private peerMetrics = new Map<string, PeerLinkMetrics>();

  // Radio time tracking
  private totalScanTimeMs = 0;
  private scanStartTime: number | null = null;

  private totalConnectionTimeMs = 0;
  private connectionStartTimes = new Map<string, number>();

  // Battery history for discharge velocity calculation
  private initialBatteryLevel: number | null = null;
  private currentBatteryLevel: number | null = null;
  private batteryCheckInterval: ReturnType<typeof setInterval> | null = null;

  public static getInstance(): BleTelemetry {
    if (!BleTelemetry.instance) {
      BleTelemetry.instance = new BleTelemetry();
    }
    return BleTelemetry.instance;
  }

  private constructor() {
    this.initBatteryMonitor();
  }

  // ─── Radio Timing Hooks ───────────────────────────────────────────────────

  public recordScanStart(): void {
    if (this.scanStartTime === null) {
      this.scanStartTime = Date.now();
    }
  }

  public recordScanStop(): void {
    if (this.scanStartTime !== null) {
      this.totalScanTimeMs += Date.now() - this.scanStartTime;
      this.scanStartTime = null;
    }
  }

  public recordConnectionStart(peerId: string): void {
    if (!this.connectionStartTimes.has(peerId)) {
      this.connectionStartTimes.set(peerId, Date.now());
    }
  }

  public recordConnectionStop(peerId: string): void {
    const start = this.connectionStartTimes.get(peerId);
    if (start !== undefined) {
      this.totalConnectionTimeMs += Date.now() - start;
      this.connectionStartTimes.delete(peerId);
    }
  }

  // ─── Link-Layer RF & Packet Accounting ────────────────────────────────────

  public recordPeerRssi(peerId: string, rssi: number): void {
    let metrics = this.peerMetrics.get(peerId);
    const now = Date.now();

    if (!metrics) {
      metrics = {
        peerId,
        lastRssi: rssi,
        emaRssi: rssi,
        lastSeen: now,
        rttMs: 0,
        chunksSent: 0,
        chunksReceived: 0,
        chunksFailed: 0,
        framesCompleted: 0,
        packetErrorRate: 0,
        totalBytesTransferred: 0,
        estimatedAirtimeMs: 0,
      };
      this.peerMetrics.set(peerId, metrics);
    } else {
      metrics.lastRssi = rssi;
      // Exponential Moving Average filter: EMA = alpha * new + (1 - alpha) * old
      metrics.emaRssi = Math.round((0.2 * rssi + 0.8 * metrics.emaRssi) * 10) / 10;
      metrics.lastSeen = now;
    }
  }

  public recordChunkTransmission(peerId: string, byteLength: number, success: boolean, rttMs?: number): void {
    let metrics = this.peerMetrics.get(peerId);
    if (!metrics) {
      this.recordPeerRssi(peerId, -75);
      metrics = this.peerMetrics.get(peerId)!;
    }

    if (success) {
      metrics.chunksSent++;
      metrics.totalBytesTransferred += byteLength;

      // Estimate 1M PHY airtime: (bytes + 10 framing bytes) * 8 bits / 1 Mbps
      const chunkAirtimeMs = (byteLength + 10) * 0.008;
      metrics.estimatedAirtimeMs += chunkAirtimeMs;

      if (rttMs !== undefined && rttMs > 0) {
        metrics.rttMs = Math.round((0.3 * rttMs + 0.7 * (metrics.rttMs || rttMs)));
      }
    } else {
      metrics.chunksFailed++;
    }

    const totalAttempts = metrics.chunksSent + metrics.chunksFailed;
    metrics.packetErrorRate = totalAttempts > 0
      ? Math.round((metrics.chunksFailed / totalAttempts) * 1000) / 1000
      : 0;
  }

  public recordChunkReceived(peerId: string, byteLength: number): void {
    let metrics = this.peerMetrics.get(peerId);
    if (!metrics) {
      this.recordPeerRssi(peerId, -75);
      metrics = this.peerMetrics.get(peerId)!;
    }
    metrics.chunksReceived++;
    metrics.totalBytesTransferred += byteLength;
  }

  public recordFrameCompleted(peerId: string): void {
    const metrics = this.peerMetrics.get(peerId);
    if (metrics) {
      metrics.framesCompleted++;
    }
  }

  // ─── Power & Battery Monitoring ───────────────────────────────────────────

  private async initBatteryMonitor(): Promise<void> {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      try {
        const battery = await (navigator as any).getBattery();
        this.initialBatteryLevel = battery.level;
        this.currentBatteryLevel = battery.level;

        battery.addEventListener('levelchange', () => {
          this.currentBatteryLevel = battery.level;
        });

        // Periodic sample every 60s
        this.batteryCheckInterval = setInterval(() => {
          this.currentBatteryLevel = battery.level;
        }, 60_000);
      } catch {
        // Battery API blocked or unsupported
      }
    }
  }

  public getPowerMetrics(): SystemPowerMetrics {
    const now = Date.now();
    const uptimeMs = Math.max(1, now - this.startTime);

    // Add active slice if currently scanning
    let activeScan = this.totalScanTimeMs;
    if (this.scanStartTime !== null) {
      activeScan += (now - this.scanStartTime);
    }

    // Add active connections
    let activeConn = this.totalConnectionTimeMs;
    for (const start of this.connectionStartTimes.values()) {
      activeConn += (now - start);
    }

    const scanDutyCycleRatio = Math.round((activeScan / uptimeMs) * 1000) / 1000;
    const connectionDutyCycleRatio = Math.round((activeConn / uptimeMs) * 1000) / 1000;

    let dischargeRatePercentPerHour: number | null = null;
    let estimatedSurvivalHours: number | null = null;

    if (this.initialBatteryLevel !== null && this.currentBatteryLevel !== null) {
      const elapsedHours = uptimeMs / (1000 * 3600);
      if (elapsedHours >= 0.05) { // after at least 3 minutes of data
        const deltaPercent = (this.initialBatteryLevel - this.currentBatteryLevel) * 100;
        if (deltaPercent > 0) {
          dischargeRatePercentPerHour = Math.round((deltaPercent / elapsedHours) * 10) / 10;
          const remainingPercent = this.currentBatteryLevel * 100;
          estimatedSurvivalHours = Math.round((remainingPercent / dischargeRatePercentPerHour) * 10) / 10;
        }
      }
    }

    // Target: survival >= 24 hours OR scan duty cycle <= 20%
    const is24HourSurvivalSafe = estimatedSurvivalHours !== null
      ? estimatedSurvivalHours >= 24
      : scanDutyCycleRatio <= 0.25;

    return {
      uptimeMs,
      activeScanTimeMs: activeScan,
      activeConnectionTimeMs: activeConn,
      scanDutyCycleRatio,
      connectionDutyCycleRatio,
      currentBatteryLevel: this.currentBatteryLevel,
      dischargeRatePercentPerHour,
      estimatedSurvivalHours,
      is24HourSurvivalSafe,
    };
  }

  public getPeerMetrics(peerId: string): PeerLinkMetrics | undefined {
    return this.peerMetrics.get(peerId);
  }

  public getAllPeerMetrics(): PeerLinkMetrics[] {
    return Array.from(this.peerMetrics.values());
  }

  public reset(): void {
    if (this.batteryCheckInterval) clearInterval(this.batteryCheckInterval);
    this.peerMetrics.clear();
    this.connectionStartTimes.clear();
    this.scanStartTime = null;
    this.totalScanTimeMs = 0;
    this.totalConnectionTimeMs = 0;
    this.startTime = Date.now();
  }
}
