/**
 * Wire Packet Encapsulation, Zero-Knowledge Relay Slicing, and RFC 4303 Replay Defense.
 *
 * Core Principles:
 * 1. Zero-Knowledge Forwarding: Intermediary relay nodes mutate routing headers (ttl, copiesLeft)
 *    and forward the raw binary frame WITHOUT invoking asynchronous crypto or inspecting payload bytes.
 * 2. Clock-Independent Replay Protection: Employs an RFC 4303 64-packet sliding bitmask window
 *    per sender, immune to wall-clock drifting or reset RTC chips during grid blackouts.
 */

import {
  encodeEnvelope,
  decodeEnvelope,
  type EnvelopeData,
} from './Serializer';
import { sealPayload, unsealPayload, getNextSequenceNumber } from '../security/Crypto';

// ─── RFC 4303 Sliding Window Replay Defense ──────────────────────────────────

const WINDOW_SIZE = 64n;

interface SenderReplayState {
  maxSeq: number;
  bitmap: bigint; // 64-bit sliding window representation
}

export class ReplayFilter {
  private senderWindows = new Map<string, SenderReplayState>();
  private readonly maxSenders: number;

  constructor(maxSenders = 500) {
    this.maxSenders = maxSenders;
  }

  /**
   * Evaluates whether an incoming packet sequence number is valid and un-replayed.
   * Updates the sliding window state if accepted.
   *
   * @param senderId The originator UUID of the packet
   * @param seq The packet's monotonic sequence number
   * @returns true if accepted, false if dropped (duplicate or behind window)
   */
  public checkAndTrack(senderId: string, seq: number): boolean {
    let state = this.senderWindows.get(senderId);

    if (!state) {
      // First packet seen from this sender
      if (this.senderWindows.size >= this.maxSenders) {
        // Evict oldest sender
        const oldestKey = this.senderWindows.keys().next().value;
        if (oldestKey !== undefined) this.senderWindows.delete(oldestKey);
      }

      this.senderWindows.set(senderId, {
        maxSeq: seq,
        bitmap: 1n,
      });
      return true;
    }

    if (seq > state.maxSeq) {
      const diff = BigInt(seq - state.maxSeq);
      if (diff < WINDOW_SIZE) {
        state.bitmap = (state.bitmap << diff) | 1n;
      } else {
        state.bitmap = 1n;
      }
      state.maxSeq = seq;
      return true;
    }

    // Out of order packet or replayed packet
    const diff = BigInt(state.maxSeq - seq);
    if (diff >= WINDOW_SIZE) {
      // Behind the 64-packet window: reject as stale/replay
      return false;
    }

    const bitMask = 1n << diff;
    if ((state.bitmap & bitMask) !== 0n) {
      // Bit already set: reject as duplicate/replay
      return false;
    }

    // In-window, previously unseen out-of-order packet: accept and mark
    state.bitmap |= bitMask;
    return true;
  }

  public clear(): void {
    this.senderWindows.clear();
  }
}

// Global replay filter singleton for the wire engine
export const globalReplayFilter = new ReplayFilter();

// ─── Wire Packet Construction ───────────────────────────────────────────────

export interface CreateWirePacketOptions {
  packetId?: string;
  senderId: string;
  recipientId?: string;
  ttl?: number;
  copiesLeft?: number;
  type?: 'HEARTBEAT' | 'DATA' | 'ACK';
  plaintextPayload: Uint8Array;
  passphrase?: string;
}

/**
 * Creates and seals a wire packet:
 * 1. Encrypts plaintextPayload via AES-GCM with Composite IV if passphrase provided.
 * 2. Encapsulates routing header + sealed payload into a binary NetworkEnvelope.
 */
export async function createWirePacket(
  opts: CreateWirePacketOptions
): Promise<Uint8Array> {
  const packetId = opts.packetId || crypto.randomUUID();
  const sequenceNum = getNextSequenceNumber();

  let encryptedPayload = opts.plaintextPayload;
  if (opts.passphrase && opts.plaintextPayload.byteLength > 0) {
    encryptedPayload = await sealPayload(opts.plaintextPayload, opts.passphrase, opts.senderId);
  }

  const envelope: EnvelopeData = {
    packetId,
    sender: opts.senderId,
    recipient: opts.recipientId,
    ttl: opts.ttl ?? 5,
    copiesLeft: opts.copiesLeft ?? 6, // Spray-and-Wait DTN initial spray budget
    sequenceNum,
    type: opts.type ?? 'DATA',
    timestamp: Date.now(),
    encryptedPayload,
  };

  return encodeEnvelope(envelope);
}

// ─── Zero-Knowledge Relay Slicing ───────────────────────────────────────────

/**
 * Fast synchronous relay mutation:
 * Decodes the outer envelope routing header, decrements TTL, adjusts DTN spray copies,
 * and re-encodes the frame with the exact same ciphertext payload.
 *
 * NEVER invokes crypto.subtle or parses inner bytes.
 * Returns null if packet has expired (ttl <= 1).
 */
export function relayWirePacket(
  rawFrame: Uint8Array,
  localNodeId: string
): Uint8Array | null {
  try {
    const envelope = decodeEnvelope(rawFrame);

    // Drop own packets from relay loop
    if (envelope.sender === localNodeId) {
      return null;
    }

    // Do not relay expired packets
    if (envelope.ttl <= 1) {
      return null;
    }

    // Do not relay packets explicitly targeting us (terminal hop)
    if (envelope.recipient === localNodeId) {
      return null;
    }

    // Binary DTN Spray-and-Wait logic: halve copies for relay split
    const newCopies = envelope.copiesLeft > 1 ? Math.floor(envelope.copiesLeft / 2) : 1;

    const relayedEnvelope: EnvelopeData = {
      ...envelope,
      ttl: envelope.ttl - 1,
      copiesLeft: newCopies,
    };

    return encodeEnvelope(relayedEnvelope);
  } catch (err) {
    console.warn('[Envelope] Failed to parse frame for relay:', err);
    return null;
  }
}

// ─── Destination Packet Unpacking ───────────────────────────────────────────

export interface UnpackedWirePacket {
  header: {
    packetId: string;
    senderId: string;
    recipientId?: string;
    ttl: number;
    copiesLeft: number;
    sequenceNum: number;
    type: 'HEARTBEAT' | 'DATA' | 'ACK';
    timestamp: number;
  };
  isForUs: boolean;
  decryptedPayload: Uint8Array | null;
  rawEnvelope: EnvelopeData;
}

/**
 * Unpacks an incoming wire frame:
 * 1. Decodes outer envelope header.
 * 2. Runs RFC 4303 sliding window replay detection.
 * 3. If addressed to us or broadcast, unseals ciphertext via cached AES-GCM key.
 */
export async function unpackWirePacket(
  rawFrame: Uint8Array,
  passphrase: string,
  localNodeId: string,
  replayFilter: ReplayFilter = globalReplayFilter
): Promise<UnpackedWirePacket | null> {
  try {
    const envelope = decodeEnvelope(rawFrame);

    // Drop own frames
    if (envelope.sender === localNodeId) {
      return null;
    }

    // Check replay attack protection on DATA packets
    if (envelope.type === 'DATA') {
      const isFresh = replayFilter.checkAndTrack(envelope.sender, envelope.sequenceNum);
      if (!isFresh) {
        console.debug(`[Envelope] Dropped replayed frame ${envelope.packetId} from ${envelope.sender} (seq: ${envelope.sequenceNum})`);
        return null;
      }
    }

    const isForUs = !envelope.recipient || envelope.recipient === localNodeId;
    let decryptedPayload: Uint8Array | null = null;

    if (isForUs && envelope.encryptedPayload.byteLength > 0 && passphrase) {
      decryptedPayload = await unsealPayload(envelope.encryptedPayload, passphrase);
    } else if (isForUs) {
      decryptedPayload = envelope.encryptedPayload;
    }

    return {
      header: {
        packetId: envelope.packetId,
        senderId: envelope.sender,
        recipientId: envelope.recipient,
        ttl: envelope.ttl,
        copiesLeft: envelope.copiesLeft,
        sequenceNum: envelope.sequenceNum,
        type: envelope.type,
        timestamp: envelope.timestamp,
      },
      isForUs,
      decryptedPayload,
      rawEnvelope: envelope,
    };
  } catch (err) {
    console.warn('[Envelope] Unpack wire frame failed:', err);
    return null;
  }
}
