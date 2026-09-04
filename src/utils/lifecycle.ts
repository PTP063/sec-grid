/**
 * Mobile Device Lifecycle & Keep-Alive Subsystem for Mesh·OS.
 *
 * Provides:
 * 1. Persistent Storage Assurance via navigator.storage.persist()
 * 2. Field Sentry Screen Wake Lock with auto-recovery on visibilitychange & battery guard
 * 3. Background Audio Keep-Alive with MediaSession metadata to defeat iOS/Android background freeze
 */

// ─── 1. Storage Durability ──────────────────────────────────────────────────

export interface PersistenceStatus {
  supported: boolean;
  persisted: boolean;
  quotaMB?: number;
  usageMB?: number;
}

/**
 * Requests and verifies that IndexedDB and CacheStorage are marked as 'persistent'
 * by the browser to prevent eviction under low storage pressure.
 */
export async function initDevicePersistence(): Promise<PersistenceStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) {
    console.warn('[Lifecycle] navigator.storage.persist not supported on this platform.');
    return { supported: false, persisted: false };
  }

  try {
    let isPersisted = await navigator.storage.persisted();
    if (!isPersisted) {
      isPersisted = await navigator.storage.persist();
    }

    let quotaMB: number | undefined;
    let usageMB: number | undefined;

    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota !== undefined) {
        quotaMB = Math.round(estimate.quota / (1024 * 1024));
      }
      if (estimate.usage !== undefined) {
        usageMB = Math.round(estimate.usage / (1024 * 1024));
      }
    }

    console.log(`[Lifecycle] Storage Persistence: ${isPersisted ? 'CONFIRMED' : 'BEST-EFFORT'} (Usage: ${usageMB ?? '?'}MB / ${quotaMB ?? '?'}MB)`);
    return {
      supported: true,
      persisted: isPersisted,
      quotaMB,
      usageMB,
    };
  } catch (err) {
    console.error('[Lifecycle] Storage persistence request failed:', err);
    return { supported: true, persisted: false };
  }
}

// ─── 2. Screen Wake Lock & Sentry Mode ──────────────────────────────────────

type WakeLockListener = (isActive: boolean, reason?: string) => void;

let wakeLockSentinel: any = null;
let isSentryModeRequested = false;
const wakeLockListeners = new Set<WakeLockListener>();

function notifyWakeLockListeners(isActive: boolean, reason?: string) {
  wakeLockListeners.forEach((l) => {
    try {
      l(isActive, reason);
    } catch (e) {
      console.error('[Lifecycle] WakeLock listener threw:', e);
    }
  });
}

/**
 * Checks battery status to prevent wake lock from draining emergency battery.
 * Returns true if battery is safe (> 20% or battery API unavailable).
 */
async function isBatterySafe(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !(navigator as any).getBattery) {
    return true; // Assume safe if unqueryable
  }
  try {
    const battery = await (navigator as any).getBattery();
    if (battery.charging) return true;
    return battery.level > 0.20; // At least 20% battery remaining
  } catch {
    return true;
  }
}

/**
 * Attempts to acquire the Screen Wake Lock.
 */
export async function acquireWakeLock(): Promise<boolean> {
  isSentryModeRequested = true;

  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    console.warn('[Lifecycle] Screen Wake Lock API not supported.');
    notifyWakeLockListeners(false, 'unsupported');
    return false;
  }

  // Safety check: do not acquire if battery is critically low
  const safe = await isBatterySafe();
  if (!safe) {
    console.warn('[Lifecycle] Battery below 20%. Aborting Screen Wake Lock.');
    notifyWakeLockListeners(false, 'low_battery');
    return false;
  }

  try {
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    console.log('[Lifecycle] Screen Wake Lock ACQUIRED (Field Sentry Active).');
    notifyWakeLockListeners(true);

    wakeLockSentinel.addEventListener('release', () => {
      console.log('[Lifecycle] Screen Wake Lock RELEASED by OS.');
      wakeLockSentinel = null;
      notifyWakeLockListeners(false, 'os_release');
    });

    return true;
  } catch (err) {
    console.warn('[Lifecycle] Failed to acquire Screen Wake Lock:', err);
    notifyWakeLockListeners(false, 'request_failed');
    return false;
  }
}

/**
 * Releases the Screen Wake Lock and disables Sentry Mode.
 */
export async function releaseWakeLock(): Promise<void> {
  isSentryModeRequested = false;
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // Ignored
    }
    wakeLockSentinel = null;
  }
  notifyWakeLockListeners(false, 'user_released');
}

/**
 * Toggles Field Sentry Mode on or off.
 */
export async function toggleSentryMode(): Promise<boolean> {
  if (isSentryModeRequested && wakeLockSentinel) {
    await releaseWakeLock();
    return false;
  }
  return acquireWakeLock();
}

/**
 * Subscribes to Wake Lock state changes.
 */
export function onWakeLockChange(listener: WakeLockListener): () => void {
  wakeLockListeners.add(listener);
  listener(wakeLockSentinel !== null && !wakeLockSentinel.released);
  return () => wakeLockListeners.delete(listener);
}

// Automatically re-acquire Screen Wake Lock when tab becomes visible again
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && isSentryModeRequested && !wakeLockSentinel) {
      console.log('[Lifecycle] Visibility recovered: re-acquiring Screen Wake Lock...');
      await acquireWakeLock();
    }
  });
}

// ─── 3. Background Audio Keep-Alive ─────────────────────────────────────────

// Ultra-minimal 48-byte PCM 8kHz silent WAV base64 string
const SILENT_WAV_BASE64 =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';

let keepAliveAudio: HTMLAudioElement | null = null;
let isAudioKeepAliveInitialized = false;

/**
 * Configures the MediaSession metadata to register an active media session with mobile OSes.
 */
function setupMediaSession() {
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Mesh·OS Emergency Relay',
      artist: 'Tactical Mesh Grid',
      album: 'Zero-Infrastructure Bedrock',
    });

    // Provide empty action handlers so OS media controls show active status
    const dummyHandler = () => {};
    try {
      navigator.mediaSession.setActionHandler('play', dummyHandler);
      navigator.mediaSession.setActionHandler('pause', dummyHandler);
    } catch {
      // Ignore unsupported actions
    }
  }
}

/**
 * Initializes the inaudible background audio loop to keep WebRTC channels and timers alive
 * on iOS WebKit and Android OEM power managers.
 *
 * Bound to initial user touch/click interaction to respect browser autoplay policies.
 */
export function initAudioKeepAlive(): () => void {
  if (isAudioKeepAliveInitialized || typeof window === 'undefined') {
    return () => {};
  }
  isAudioKeepAliveInitialized = true;

  const startPlayback = async () => {
    // Battery check: suspend if battery is critically depleted (< 15%)
    if (typeof navigator !== 'undefined' && (navigator as any).getBattery) {
      try {
        const battery = await (navigator as any).getBattery();
        if (!battery.charging && battery.level < 0.15) {
          console.warn('[Lifecycle] Battery below 15%: Disabling background audio keep-alive.');
          return;
        }
      } catch {
        // Continue if check fails
      }
    }

    if (!keepAliveAudio) {
      keepAliveAudio = new Audio(SILENT_WAV_BASE64);
      keepAliveAudio.loop = true;
      keepAliveAudio.volume = 0.001; // Non-zero for WebKit media pipeline recognition
      keepAliveAudio.setAttribute('playsinline', 'true');
    }

    setupMediaSession();

    try {
      await keepAliveAudio.play();
      console.log('[Lifecycle] Background Audio Keep-Alive Loop: ACTIVE.');
    } catch (err) {
      console.debug('[Lifecycle] Autoplay block detected, awaiting next interaction:', err);
    }
  };

  // Wire into user gesture to unlock audio policy
  const unlockEvents = ['touchstart', 'pointerdown', 'keydown'];
  const handleInteraction = () => {
    startPlayback();
    unlockEvents.forEach((evt) => window.removeEventListener(evt, handleInteraction));
  };

  unlockEvents.forEach((evt) => window.addEventListener(evt, handleInteraction, { once: true, passive: true }));

  // Return teardown function
  return () => {
    if (keepAliveAudio) {
      keepAliveAudio.pause();
      keepAliveAudio.src = '';
      keepAliveAudio = null;
    }
    isAudioKeepAliveInitialized = false;
  };
}
