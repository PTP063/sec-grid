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

export type TriageStatus = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface TriageSOSData {
  id:          string;
  sender:      string;
  priority:    Priority;
  medicalNeed: string;
  hazard:      string;
  timestamp:   number;
  status?:     TriageStatus;
}

// ─── Module-level state (singleton pattern) ───────────────────────────────────

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push((bytes[i] || 0).toString(16).padStart(2, '0'));
  }
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

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
  
  const payload = {
    ...data,
    status: data.status || 'PENDING',
    id: uuidToBytes(data.id),
    sender: uuidToBytes(data.sender),
  };

  const errMsg = TriageSOSMessage.verify(payload);
  if (errMsg) throw new Error(`[Serializer] Payload validation failed: ${errMsg}`);

  const message = TriageSOSMessage.create(payload);
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
  const obj = TriageSOSMessage.toObject(message, {
    enums:  Number,
    longs:  Number,
    defaults: true,
  });

  return {
    ...obj,
    status: (obj as { status?: string }).status || 'PENDING',
    id: bytesToUuid(message.id as Uint8Array),
    sender: bytesToUuid(message.sender as Uint8Array),
  } as unknown as TriageSOSData;
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
