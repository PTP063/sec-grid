import * as protobuf from 'protobufjs';
import { schemaProtoStr } from '../proto/schema';

// ─── Public Types ─────────────────────────────────────────────────────────────

export const Priority = {
  LOW: 0,
  HIGH: 1,
  CRITICAL: 2,
} as const;
export type Priority = typeof Priority[keyof typeof Priority];

export const WirePacketType = {
  HEARTBEAT: 0,
  DATA: 1,
  ACK: 2,
} as const;
export type WirePacketType = typeof WirePacketType[keyof typeof WirePacketType];

export const TriageMethod = {
  MANUAL: 0,
  HEURISTIC: 1,
  MANUAL_OVERRIDE: 2,
} as const;
export type TriageMethod = typeof TriageMethod[keyof typeof TriageMethod];

export type TriageStatus = 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface TriageSOSData {
  id: string;
  sender: string;
  priority: Priority;
  medicalNeed: string;
  hazard: string;
  timestamp: number;
  status?: TriageStatus;
  triageMethod?: TriageMethod;
}

export interface EnvelopeData {
  packetId: string;
  sender: string;
  recipient?: string;
  ttl: number;
  copiesLeft: number;
  sequenceNum: number;
  type: 'HEARTBEAT' | 'DATA' | 'ACK';
  timestamp: number;
  encryptedPayload: Uint8Array;
}

// ─── UUID Binary Conversion (Zero-Copy / Minimal Allocation) ─────────────────

const HEX_LUT: string[] = [];
for (let i = 0; i < 256; ++i) {
  HEX_LUT[i] = (i < 16 ? '0' : '') + i.toString(16);
}

/**
 * Compacts a standard 36-character hyphenated UUID into a raw 16-byte buffer.
 */
export function uuidToBytes(uuid: string): Uint8Array {
  if (!uuid || uuid.length < 32) {
    return new Uint8Array(16);
  }
  const clean = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16) || 0;
  }
  return bytes;
}

/**
 * Reconstitutes a 36-character hyphenated UUID string from a 16-byte buffer.
 */
export function bytesToUuid(bytes: Uint8Array): string {
  if (!bytes || bytes.length < 16) {
    return '00000000-0000-0000-0000-000000000000';
  }
  return (
    HEX_LUT[bytes[0]] +
    HEX_LUT[bytes[1]] +
    HEX_LUT[bytes[2]] +
    HEX_LUT[bytes[3]] +
    '-' +
    HEX_LUT[bytes[4]] +
    HEX_LUT[bytes[5]] +
    '-' +
    HEX_LUT[bytes[6]] +
    HEX_LUT[bytes[7]] +
    '-' +
    HEX_LUT[bytes[8]] +
    HEX_LUT[bytes[9]] +
    '-' +
    HEX_LUT[bytes[10]] +
    HEX_LUT[bytes[11]] +
    HEX_LUT[bytes[12]] +
    HEX_LUT[bytes[13]] +
    HEX_LUT[bytes[14]] +
    HEX_LUT[bytes[15]]
  );
}

// ─── Protobuf Initializer & Type Accessors ───────────────────────────────────

let root: protobuf.Root | null = null;
let TriageSOSMessage: protobuf.Type | null = null;
let NetworkEnvelopeMessage: protobuf.Type | null = null;
let initPromise: Promise<void> | null = null;

export async function initSerializer(): Promise<void> {
  if (root) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      ensureInitialized();
    } catch (err) {
      initPromise = null;
      console.error('[Serializer] Protobuf schema parse failed:', err);
      throw err;
    }
  })();

  return initPromise;
}

function ensureInitialized(): void {
  if (!root) {
    root = protobuf.parse(schemaProtoStr).root;
    TriageSOSMessage = root.lookupType('TriageSOS');
    NetworkEnvelopeMessage = root.lookupType('NetworkEnvelope');
  }
}

export function isSerializerReady(): boolean {
  ensureInitialized();
  return TriageSOSMessage !== null && NetworkEnvelopeMessage !== null;
}

// ─── TriageSOS Encoders / Decoders ──────────────────────────────────────────

export function encodeTriage(data: TriageSOSData): Uint8Array {
  ensureInitialized();
  if (!TriageSOSMessage) {
    throw new Error('[Serializer] Not initialised — call initSerializer() first.');
  }

  const payload = {
    ...data,
    status: data.status || 'PENDING',
    triageMethod: data.triageMethod ?? TriageMethod.HEURISTIC,
    id: uuidToBytes(data.id),
    sender: uuidToBytes(data.sender),
  };

  const errMsg = TriageSOSMessage.verify(payload);
  if (errMsg) throw new Error(`[Serializer] Payload validation failed: ${errMsg}`);

  const message = TriageSOSMessage.create(payload);
  return TriageSOSMessage.encode(message).finish();
}

export function decodeTriage(buffer: Uint8Array): TriageSOSData {
  ensureInitialized();
  if (!TriageSOSMessage) {
    throw new Error('[Serializer] Not initialised — call initSerializer() first.');
  }

  const message = TriageSOSMessage.decode(buffer);
  const obj = TriageSOSMessage.toObject(message, {
    enums: Number,
    longs: Number,
    defaults: true,
  });

  return {
    ...obj,
    status: ((obj as { status?: string }).status || 'PENDING') as TriageStatus,
    triageMethod: typeof (obj as { triageMethod?: number }).triageMethod === 'number'
      ? ((obj as { triageMethod: number }).triageMethod as TriageMethod)
      : TriageMethod.HEURISTIC,
    id: bytesToUuid(message.id as Uint8Array),
    sender: bytesToUuid(message.sender as Uint8Array),
  } as unknown as TriageSOSData;
}

// ─── NetworkEnvelope Encoders / Decoders (Zero-Knowledge Wire Frames) ─────────

const TYPE_TO_WIRE: Record<string, number> = {
  HEARTBEAT: WirePacketType.HEARTBEAT,
  DATA: WirePacketType.DATA,
  ACK: WirePacketType.ACK,
};

const WIRE_TO_TYPE: Record<number, 'HEARTBEAT' | 'DATA' | 'ACK'> = {
  [WirePacketType.HEARTBEAT]: 'HEARTBEAT',
  [WirePacketType.DATA]: 'DATA',
  [WirePacketType.ACK]: 'ACK',
};

export function encodeEnvelope(envelope: EnvelopeData): Uint8Array {
  ensureInitialized();
  if (!NetworkEnvelopeMessage) {
    throw new Error('[Serializer] Not initialised — call initSerializer() first.');
  }

  const payload = {
    packetId: uuidToBytes(envelope.packetId),
    sender: uuidToBytes(envelope.sender),
    recipient: envelope.recipient ? uuidToBytes(envelope.recipient) : new Uint8Array(0),
    ttl: envelope.ttl,
    copiesLeft: envelope.copiesLeft ?? 1,
    sequenceNum: envelope.sequenceNum ?? 0,
    type: TYPE_TO_WIRE[envelope.type] ?? WirePacketType.DATA,
    timestamp: envelope.timestamp || Date.now(),
    encryptedPayload: envelope.encryptedPayload || new Uint8Array(0),
  };

  const errMsg = NetworkEnvelopeMessage.verify(payload);
  if (errMsg) throw new Error(`[Serializer] Envelope validation failed: ${errMsg}`);

  const message = NetworkEnvelopeMessage.create(payload);
  return NetworkEnvelopeMessage.encode(message).finish();
}

export function decodeEnvelope(buffer: Uint8Array): EnvelopeData {
  ensureInitialized();
  if (!NetworkEnvelopeMessage) {
    throw new Error('[Serializer] Not initialised — call initSerializer() first.');
  }

  const message = NetworkEnvelopeMessage.decode(buffer);
  const obj = NetworkEnvelopeMessage.toObject(message, {
    enums: Number,
    longs: Number,
    defaults: true,
  });

  const recipientBytes = message.recipient as Uint8Array;
  const hasRecipient = recipientBytes && recipientBytes.length === 16 && !recipientBytes.every((b) => b === 0);

  return {
    packetId: bytesToUuid(message.packetId as Uint8Array),
    sender: bytesToUuid(message.sender as Uint8Array),
    recipient: hasRecipient ? bytesToUuid(recipientBytes) : undefined,
    ttl: obj.ttl ?? 0,
    copiesLeft: obj.copiesLeft ?? 1,
    sequenceNum: obj.sequenceNum ?? 0,
    type: WIRE_TO_TYPE[obj.type as number] ?? 'DATA',
    timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : Date.now(),
    encryptedPayload: (message.encryptedPayload as Uint8Array) || new Uint8Array(0),
  };
}

// ─── Compaction Benchmarking ────────────────────────────────────────────────

export function getCompressionRatio(jsonString: string, binary: Uint8Array): string {
  const jsonBytes = new TextEncoder().encode(jsonString).byteLength;
  const binaryBytes = binary.byteLength;

  if (jsonBytes === 0) return '—';

  const savedBytes = jsonBytes - binaryBytes;
  const pct = Math.max(0, (savedBytes / jsonBytes) * 100);

  return savedBytes > 0
    ? `↓${pct.toFixed(1)}% (${jsonBytes}B → ${binaryBytes}B)`
    : `±0% (${binaryBytes}B)`;
}

export function benchmarkCompaction(triage: TriageSOSData): {
  jsonBytes: number;
  protoBytes: number;
  savingsPct: number;
  summary: string;
} {
  const jsonStr = JSON.stringify(triage);
  const jsonBytes = new TextEncoder().encode(jsonStr).byteLength;
  const protoBytes = encodeTriage(triage).byteLength;
  const saved = jsonBytes - protoBytes;
  const pct = Math.max(0, (saved / jsonBytes) * 100);

  return {
    jsonBytes,
    protoBytes,
    savingsPct: Number(pct.toFixed(1)),
    summary: `JSON: ${jsonBytes}B | Proto: ${protoBytes}B (↓${pct.toFixed(1)}%)`,
  };
}
