import {
  slicePayload,
  FragmentationManager,
  DEFAULT_ATT_MTU,
  REQUESTED_ATT_MTU,
} from '../network/BleTransport';

export interface StressResult {
  testName: string;
  passed: boolean;
  payloadSize: number;
  mtu: number;
  totalChunks: number;
  lossRate: number;
  outOfOrder: boolean;
  durationMs: number;
  details: string;
}

/**
 * Physical Radio Simulation & Asymmetric MTU Stress Harness.
 *
 * Simulates real-world disaster RF conditions:
 * - Asymmetric MTU pairings (iOS 185B vs budget Android 23B).
 * - Severe multi-path RF packet drops (10% to 50%).
 * - High-jitter out-of-order chunk arrivals.
 * - Sudden mid-transmission session aborts.
 */
export class BleStressHarness {
  /**
   * Generates pseudo-random binary payload of exact specified byte size.
   */
  public static generatePayload(sizeBytes: number): Uint8Array {
    const payload = new Uint8Array(sizeBytes);
    for (let i = 0; i < sizeBytes; i++) {
      payload[i] = (i * 31 + 17) % 256;
    }
    return payload;
  }

  /**
   * Tests asymmetric MTU transmission across varied MTU boundaries.
   */
  public static runAsymmetricMtuTest(
    payloadSize: number,
    senderMtu: number,
    receiverMtu: number
  ): StressResult {
    const start = performance.now();
    const payload = this.generatePayload(payloadSize);

    // The sender must slice using the receiver's negotiated ATT MTU limit
    const fragments = slicePayload(payload, receiverMtu);
    const manager = new FragmentationManager();

    let reassembled: Uint8Array | null = null;
    for (let i = 0; i < fragments.length; i++) {
      reassembled = manager.ingestFragment('asymmetric-peer', fragments[i]);
      if (i < fragments.length - 1 && reassembled !== null) {
        return {
          testName: `Asymmetric MTU (${senderMtu} -> ${receiverMtu})`,
          passed: false,
          payloadSize,
          mtu: receiverMtu,
          totalChunks: fragments.length,
          lossRate: 0,
          outOfOrder: false,
          durationMs: performance.now() - start,
          details: `Premature reassembly triggered at chunk ${i}/${fragments.length}`,
        };
      }
    }

    const passed = reassembled !== null && this.areBuffersEqual(reassembled, payload);

    return {
      testName: `Asymmetric MTU (${senderMtu} -> ${receiverMtu})`,
      passed,
      payloadSize,
      mtu: receiverMtu,
      totalChunks: fragments.length,
      lossRate: 0,
      outOfOrder: false,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
      details: passed
        ? `Successfully sliced into ${fragments.length} chunks and reassembled.`
        : 'Reassembled buffer content did not match source payload.',
    };
  }

  /**
   * Tests out-of-order chunk arrival reassembly.
   */
  public static runOutOfOrderTest(payloadSize: number, mtu: number): StressResult {
    const start = performance.now();
    const payload = this.generatePayload(payloadSize);
    const fragments = slicePayload(payload, mtu);

    if (fragments.length <= 1) {
      return {
        testName: 'Out-Of-Order Slicing',
        passed: true,
        payloadSize,
        mtu,
        totalChunks: 1,
        lossRate: 0,
        outOfOrder: false,
        durationMs: performance.now() - start,
        details: 'Single chunk, reordered automatically.',
      };
    }

    // Scramble chunk order deterministically (reverse / interleave)
    const indices = Array.from({ length: fragments.length }, (_, i) => i);
    indices.sort((a, b) => (b % 2) - (a % 2) || b - a);

    const manager = new FragmentationManager();
    let reassembled: Uint8Array | null = null;

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      reassembled = manager.ingestFragment('scramble-peer', fragments[idx]);
    }

    const passed = reassembled !== null && this.areBuffersEqual(reassembled, payload);

    return {
      testName: 'Out-Of-Order Chunk Arrival',
      passed,
      payloadSize,
      mtu,
      totalChunks: fragments.length,
      lossRate: 0,
      outOfOrder: true,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
      details: passed
        ? `Reassembled out-of-order chunks [${indices.join(',')}] successfully.`
        : 'Out-of-order assembly failed to reconstitute full frame.',
    };
  }

  /**
   * Simulates packet loss: drops chunks and verifies that corrupted or partial
   * payloads NEVER pass reassembly to upper layers.
   */
  public static runDroppedChunkSafetyTest(
    payloadSize: number,
    mtu: number,
    dropIndices: number[]
  ): StressResult {
    const start = performance.now();
    const payload = this.generatePayload(payloadSize);
    const fragments = slicePayload(payload, mtu);

    const manager = new FragmentationManager();
    let reassembled: Uint8Array | null = null;

    for (let i = 0; i < fragments.length; i++) {
      if (dropIndices.includes(i)) {
        continue; // Simulating dropped packet
      }
      reassembled = manager.ingestFragment('lossy-peer', fragments[i]);
    }

    // Since chunks were dropped, reassembled MUST be null (never leak partial data!)
    const passed = reassembled === null;
    manager.clear();

    return {
      testName: `Dropped Chunk Safety (Drops: [${dropIndices.join(',')}])`,
      passed,
      payloadSize,
      mtu,
      totalChunks: fragments.length,
      lossRate: dropIndices.length / fragments.length,
      outOfOrder: false,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
      details: passed
        ? 'Correctly suppressed incomplete frame from reaching WAL/UI.'
        : 'SAFETY VIOLATION: Incomplete frame was emitted by reassembly manager!',
    };
  }

  /**
   * Simulates mid-transmission abort followed immediately by a new frame from same peer.
   * Verifies stale chunk state is flushed and the new message completes cleanly.
   */
  public static runMidSessionAbortResetTest(): StressResult {
    const start = performance.now();
    const manager = new FragmentationManager();

    // Frame A: 4 chunks (aborted after chunk 1)
    const payloadA = this.generatePayload(200);
    const fragmentsA = slicePayload(payloadA, 64);
    manager.ingestFragment('abort-peer', fragmentsA[0]);
    manager.ingestFragment('abort-peer', fragmentsA[1]);

    // Abort! Peer disconnects and starts new Frame B with different chunk count
    const payloadB = this.generatePayload(450);
    const fragmentsB = slicePayload(payloadB, 64);

    let reassembledB: Uint8Array | null = null;
    for (const frag of fragmentsB) {
      reassembledB = manager.ingestFragment('abort-peer', frag);
    }

    const passed = reassembledB !== null && this.areBuffersEqual(reassembledB, payloadB);

    return {
      testName: 'Mid-Session Abort & State Reset',
      passed,
      payloadSize: payloadB.length,
      mtu: 64,
      totalChunks: fragmentsB.length,
      lossRate: 0,
      outOfOrder: false,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
      details: passed
        ? 'Stale reassembly session was safely flushed when new frame arrived.'
        : 'Failed to reset reassembly buffer on new frame sequence.',
    };
  }

  /**
   * Executes a full matrix sweep across sizes (64B to 4KB) and asymmetric MTUs (23, 185, 512).
   */
  public static runFullStressSuite(): StressResult[] {
    const results: StressResult[] = [];
    const sizes = [64, 128, 256, 512, 1024, 2048, 4096];
    const mtus = [DEFAULT_ATT_MTU, 185, REQUESTED_ATT_MTU];

    // 1. Asymmetric MTU matrix sweep
    for (const size of sizes) {
      for (const mtu of mtus) {
        results.push(this.runAsymmetricMtuTest(size, 512, mtu));
      }
    }

    // 2. Out-of-order sweeps
    for (const size of [256, 1024, 4096]) {
      for (const mtu of [DEFAULT_ATT_MTU, 185]) {
        results.push(this.runOutOfOrderTest(size, mtu));
      }
    }

    // 3. Dropped chunk safety checks
    results.push(this.runDroppedChunkSafetyTest(500, 64, [0])); // Drop first chunk
    results.push(this.runDroppedChunkSafetyTest(500, 64, [2])); // Drop middle chunk
    results.push(this.runDroppedChunkSafetyTest(500, 64, [7])); // Drop last chunk
    results.push(this.runDroppedChunkSafetyTest(1500, DEFAULT_ATT_MTU, [3, 14, 22])); // Multi-chunk loss

    // 4. Mid-session abort reset test
    results.push(this.runMidSessionAbortResetTest());

    return results;
  }

  private static areBuffersEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}
