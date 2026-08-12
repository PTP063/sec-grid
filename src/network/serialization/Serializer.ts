import * as protobuf from 'protobufjs';
// @ts-ignore — Vite raw string import, no @types needed
import schemaStr from './schema.proto?raw';

// ─── Public types ─────────────────────────────────────────────────────────────

export const Priority = {
  LOW: 0,
  HIGH: 1,
  CRITICAL: 2,
} as const;
export type Priority = typeof Priority[keyof typeof Priority];

export interface TriageSOSData {
  id:          string;
  sender:      string;
  priority:    Priority;
  medicalNeed: string;
  hazard:      string;
  timestamp:   number;
}

// ─── Module-level state (singleton pattern) ───────────────────────────────────

let root:             protobuf.Root | null = null;
let TriageSOSMessage: protobuf.Type | null = null;
// Guard against concurrent calls (e.g. React StrictMode double-invoke)
let initPromise:      Promise<void> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses the bundled protobuf schema and caches the message type.
 * Idempotent: safe to call from multiple components / StrictMode double-effects.
 */
export async function initSerializer(): Promise<void> {
  if (root) return;              // Already initialised — fast path
  if (initPromise) return initPromise; // Concurrent call — reuse in-flight promise

  initPromise = (async () => {
    try {
      root              = protobuf.parse(schemaStr).root;
      TriageSOSMessage  = root.lookupType('TriageSOS');
    } catch (err) {
      // Reset so callers can retry after a transient failure
      initPromise = null;
      console.error('[Serializer] Schema parse failed:', err);
      throw err;
    }
  })();

  return initPromise;
}

/** Returns true once the serializer has been successfully initialised. */
export function isSerializerReady(): boolean {
  return TriageSOSMessage !== null;
}

/**
 * Encodes a TriageSOSData object into a protobuf binary Uint8Array.
 * @throws if the serializer has not been initialised or the payload is invalid.
 */
export function encodeTriage(data: TriageSOSData): Uint8Array {
  if (!TriageSOSMessage) {
    throw new Error('[Serializer] Not initialised — call initSerializer() first.');
  }
  const errMsg = TriageSOSMessage.verify(data);
  if (errMsg) throw new Error(`[Serializer] Payload validation failed: ${errMsg}`);

  const message = TriageSOSMessage.create(data);
  return TriageSOSMessage.encode(message).finish();
}

/**
 * Decodes a protobuf binary buffer back into a typed TriageSOSData object.
 * @throws if the serializer has not been initialised or the buffer is corrupt.
 */
export function decodeTriage(buffer: Uint8Array): TriageSOSData {
  if (!TriageSOSMessage) {
    throw new Error('[Serializer] Not initialised — call initSerializer() first.');
  }
  const message = TriageSOSMessage.decode(buffer);
  return TriageSOSMessage.toObject(message, {
    enums:  Number,
    longs:  Number,
    defaults: true,
  }) as unknown as TriageSOSData;
}

/**
 * Computes a human-readable Protobuf vs JSON compression metric.
 *
 * Returns the number of bytes saved and percentage reduction.
 * Floors at 0% to avoid showing negative values for very short payloads.
 */
export function getCompressionRatio(jsonString: string, binary: Uint8Array): string {
  const jsonBytes   = new TextEncoder().encode(jsonString).byteLength;
  const binaryBytes = binary.byteLength;

  if (jsonBytes === 0) return '—';

  const savedBytes = jsonBytes - binaryBytes;
  const pct        = Math.max(0, (savedBytes / jsonBytes) * 100);

  return savedBytes > 0
    ? `↓${pct.toFixed(1)}%  (${jsonBytes}B → ${binaryBytes}B)`
    : `±0%  (${binaryBytes}B)`;
}
