import { uuidToBytes, bytesToUuid } from '../network/Serializer';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DTN_SYNC_MAGIC_0 = 0xd7; // 'D'
export const DTN_SYNC_MAGIC_1 = 0x01; // Version 1
export const HEADER_SIZE = 4; // 2 bytes magic + 2 bytes entry count
export const ENTRY_SIZE = 32; // 16B UUID + 8B ackFloor + 8B activeBitmask
export const MAX_SYNC_FRAME_SIZE = 509; // Fits inside standard 512 MTU minus 3B ATT header
export const MAX_ENTRIES_PER_FRAME = Math.floor((MAX_SYNC_FRAME_SIZE - HEADER_SIZE) / ENTRY_SIZE); // 15 entries

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SenderStateVector {
  senderId: string;
  ackFloor: bigint; // Sequences <= ackFloor are permanently acknowledged and resolved
  activeBitmask: bigint; // 64-bit window tracking presence of sequences (ackFloor + 1) through (ackFloor + 64)
}

export type AntiEntropyVector = Map<string, SenderStateVector>;

export interface SyncDeltaResult {
  neededFromRemote: Map<string, bigint[]>; // Sequences local needs from remote (B \ A)
  sendableToRemote: Map<string, bigint[]>; // Sequences remote needs from local (A \ B)
  purgeableLocally: Map<string, bigint>;   // Senders where remote ackFloor is higher than local ackFloor
}

// ─── Codec & Vector Utilities ────────────────────────────────────────────────

/**
 * Serializes an AntiEntropyVector into an ultra-compact binary handshake frame.
 * Guaranteed to fit within the negotiated MTU (sub-512 bytes).
 */
export function encodeStateVector(vector: AntiEntropyVector): Uint8Array {
  const entries = Array.from(vector.values()).slice(0, MAX_ENTRIES_PER_FRAME);
  const totalLength = HEADER_SIZE + entries.length * ENTRY_SIZE;
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Magic bytes
  buffer[0] = DTN_SYNC_MAGIC_0;
  buffer[1] = DTN_SYNC_MAGIC_1;

  // Entry count (uint16 LE)
  view.setUint16(2, entries.length, true);

  let offset = HEADER_SIZE;
  for (const entry of entries) {
    // 16-byte UUID
    const uuidBytes = uuidToBytes(entry.senderId);
    buffer.set(uuidBytes, offset);
    offset += 16;

    // 8-byte AckFloor (BigUint64 LE)
    view.setBigUint64(offset, entry.ackFloor, true);
    offset += 8;

    // 8-byte ActiveBitmask (BigUint64 LE)
    view.setBigUint64(offset, entry.activeBitmask, true);
    offset += 8;
  }

  return buffer;
}

/**
 * Deserializes an incoming binary handshake frame into an AntiEntropyVector.
 */
export function decodeStateVector(rawBytes: Uint8Array): AntiEntropyVector {
  const result: AntiEntropyVector = new Map();

  if (rawBytes.length < HEADER_SIZE) {
    throw new Error(`[AntiEntropy] Frame too small: ${rawBytes.length}B < ${HEADER_SIZE}B`);
  }

  if (rawBytes[0] !== DTN_SYNC_MAGIC_0 || rawBytes[1] !== DTN_SYNC_MAGIC_1) {
    throw new Error(`[AntiEntropy] Invalid sync magic header: [0x${rawBytes[0].toString(16)}, 0x${rawBytes[1].toString(16)}]`);
  }

  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  const count = view.getUint16(2, true);

  let offset = HEADER_SIZE;
  for (let i = 0; i < count; i++) {
    if (offset + ENTRY_SIZE > rawBytes.length) {
      break; // Truncated buffer guard
    }

    const senderIdBytes = rawBytes.subarray(offset, offset + 16);
    const senderId = bytesToUuid(senderIdBytes);
    offset += 16;

    const ackFloor = view.getBigUint64(offset, true);
    offset += 8;

    const activeBitmask = view.getBigUint64(offset, true);
    offset += 8;

    result.set(senderId, { senderId, ackFloor, activeBitmask });
  }

  return result;
}

// ─── Delta Reconciliation Engine ─────────────────────────────────────────────

/**
 * Extracts active sequence numbers represented by a sender state vector.
 */
export function extractActiveSequences(vec: SenderStateVector): bigint[] {
  const seqs: bigint[] = [];
  for (let i = 0n; i < 64n; i++) {
    const mask = 1n << i;
    if ((vec.activeBitmask & mask) !== 0n) {
      seqs.push(vec.ackFloor + 1n + i);
    }
  }
  return seqs;
}

/**
 * Checks whether a specific sequence number is known / resolved by a state vector.
 */
export function isSequenceKnown(vec: SenderStateVector | undefined, seq: bigint): boolean {
  if (!vec) return false;
  if (seq <= vec.ackFloor) return true; // Below floor: permanently acknowledged or resolved

  const offset = seq - vec.ackFloor - 1n;
  if (offset >= 0n && offset < 64n) {
    const mask = 1n << offset;
    return (vec.activeBitmask & mask) !== 0n;
  }

  return false;
}

/**
 * Calculates the exact delta between a local state vector and a remote state vector.
 * Returns sequences Node A should push to Node B (A \ B) and sequences Node A needs (B \ A).
 */
export function calculateDelta(
  localVector: AntiEntropyVector,
  remoteVector: AntiEntropyVector
): SyncDeltaResult {
  const neededFromRemote = new Map<string, bigint[]>();
  const sendableToRemote = new Map<string, bigint[]>();
  const purgeableLocally = new Map<string, bigint>();

  // 1. Identify what local has that remote needs (A \ B)
  for (const [senderId, localVec] of localVector.entries()) {
    const remoteVec = remoteVector.get(senderId);
    const activeSeqs = extractActiveSequences(localVec);
    const missingOnRemote: bigint[] = [];

    for (const seq of activeSeqs) {
      if (!isSequenceKnown(remoteVec, seq)) {
        missingOnRemote.push(seq);
      }
    }

    if (missingOnRemote.length > 0) {
      sendableToRemote.set(senderId, missingOnRemote);
    }

    // Check if remote has acknowledged further than local
    if (remoteVec && remoteVec.ackFloor > localVec.ackFloor) {
      purgeableLocally.set(senderId, remoteVec.ackFloor);
    }
  }

  // 2. Identify what remote has that local needs (B \ A)
  for (const [senderId, remoteVec] of remoteVector.entries()) {
    const localVec = localVector.get(senderId);
    const activeSeqs = extractActiveSequences(remoteVec);
    const missingOnLocal: bigint[] = [];

    for (const seq of activeSeqs) {
      if (!isSequenceKnown(localVec, seq)) {
        missingOnLocal.push(seq);
      }
    }

    if (missingOnLocal.length > 0) {
      neededFromRemote.set(senderId, missingOnLocal);
    }
  }

  return {
    neededFromRemote,
    sendableToRemote,
    purgeableLocally,
  };
}

/**
 * Builder class for creating and maintaining a node's local AntiEntropyVector.
 */
export class VectorBuilder {
  private vector: AntiEntropyVector = new Map();

  public recordPacket(senderId: string, seq: bigint): void {
    let vec = this.vector.get(senderId);
    if (!vec) {
      vec = { senderId, ackFloor: 0n, activeBitmask: 0n };
      this.vector.set(senderId, vec);
    }

    if (seq <= vec.ackFloor) return; // Already resolved/below floor

    const offset = seq - vec.ackFloor - 1n;
    if (offset >= 0n && offset < 64n) {
      vec.activeBitmask |= (1n << offset);
    } else if (offset >= 64n) {
      // Shift floor forward if sequence leaps forward beyond window
      const shift = offset - 63n;
      vec.ackFloor += shift;
      vec.activeBitmask = (vec.activeBitmask >> shift) | (1n << 63n);
    }
  }

  public advanceAckFloor(senderId: string, newFloor: bigint): void {
    let vec = this.vector.get(senderId);
    if (!vec) {
      vec = { senderId, ackFloor: newFloor, activeBitmask: 0n };
      this.vector.set(senderId, vec);
      return;
    }

    if (newFloor <= vec.ackFloor) return;

    const diff = newFloor - vec.ackFloor;
    vec.ackFloor = newFloor;
    if (diff < 64n) {
      vec.activeBitmask = vec.activeBitmask >> diff;
    } else {
      vec.activeBitmask = 0n;
    }
  }

  public getVector(): AntiEntropyVector {
    return this.vector;
  }
}
