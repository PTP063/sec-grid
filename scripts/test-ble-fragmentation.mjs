import assert from 'node:assert/strict';
import { slicePayload, FragmentationManager, DEFAULT_ATT_MTU } from '../src/network/BleTransport.ts';
import { parseTriageHeuristics } from '../src/ai/triageHeuristics.ts';

console.log('─── Starting BLE Fragmentation & Mobile Runtime Verification ───');

// 1. Single Chunk under 512 MTU
{
  console.log('\n[Test 1] Single chunk under negotiated 512 MTU:');
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const fragments = slicePayload(payload, 512);

  assert.equal(fragments.length, 1, 'Should slice into exactly 1 fragment');
  assert.equal(fragments[0][0], 1, 'Total chunks header should be 1');
  assert.equal(fragments[0][1], 0, 'Chunk index header should be 0');
  assert.deepEqual(fragments[0].subarray(2), payload, 'Payload slice should match original bytes');

  const manager = new FragmentationManager();
  const reassembled = manager.ingestFragment('peer-test-1', fragments[0]);
  assert.ok(reassembled !== null, 'Reassembled frame should not be null');
  assert.deepEqual(reassembled, payload, 'Reassembled frame should match original payload');
  console.log('  ✓ 512 MTU single chunk verified.');
}

// 2. Multi-Chunk under default 23-byte ATT MTU (18 bytes per chunk payload)
{
  console.log('\n[Test 2] Multi-chunk under default 23-byte ATT MTU (18B usable payload per chunk):');
  // 100 bytes should produce ceil(100 / 18) = 6 chunks
  const payload = new Uint8Array(100);
  for (let i = 0; i < 100; i++) payload[i] = (i * 7) % 256;

  const fragments = slicePayload(payload, DEFAULT_ATT_MTU);
  assert.equal(fragments.length, 6, '100 bytes at 18B/chunk must produce 6 fragments');

  // Verify chunk headers and sizes
  for (let i = 0; i < fragments.length; i++) {
    assert.equal(fragments[i][0], 6, `Fragment ${i} totalChunks must be 6`);
    assert.equal(fragments[i][1], i, `Fragment ${i} chunkIndex must be ${i}`);
    assert.ok(fragments[i].length <= 20, `Fragment ${i} size (${fragments[i].length}) must be <= 20 bytes (23 MTU - 3 ATT header)`);
  }

  const manager = new FragmentationManager();
  let result = null;
  for (let i = 0; i < fragments.length; i++) {
    result = manager.ingestFragment('peer-test-2', fragments[i]);
    if (i < fragments.length - 1) {
      assert.equal(result, null, `Intermediate fragment ${i} should return null`);
    }
  }

  assert.ok(result !== null, 'Final fragment must produce reassembled frame');
  assert.deepEqual(result, payload, 'Reassembled 100-byte frame must match original');
  console.log('  ✓ 23-byte ATT MTU 6-chunk slicing and reassembly verified.');
}

// 3. Out-of-Order Chunk Arrival
{
  console.log('\n[Test 3] Out-of-order chunk arrival reassembly:');
  const payload = new Uint8Array(250);
  for (let i = 0; i < 250; i++) payload[i] = (i * 13) % 256;

  const fragments = slicePayload(payload, 64); // 64 - 5 = 59B/chunk -> ceil(250 / 59) = 5 chunks
  assert.equal(fragments.length, 5);

  const manager = new FragmentationManager();
  // Feed chunks in scrambled order: [2, 0, 4, 1, 3]
  const order = [2, 0, 4, 1, 3];
  let finalResult = null;

  for (let idx = 0; idx < order.length; idx++) {
    const chunkIdx = order[idx];
    const res = manager.ingestFragment('peer-test-3', fragments[chunkIdx]);
    if (idx < order.length - 1) {
      assert.equal(res, null);
    } else {
      finalResult = res;
    }
  }

  assert.ok(finalResult !== null, 'Out-of-order chunks must assemble upon last piece');
  assert.deepEqual(finalResult, payload, 'Reassembled out-of-order frame must match');
  console.log('  ✓ Out-of-order chunk reassembly verified.');
}

// 4. Large Payload (1,500 bytes encrypted protobuf simulation)
{
  console.log('\n[Test 4] Large 1,500-byte payload at 247 MTU:');
  const payload = new Uint8Array(1500);
  crypto.getRandomValues(payload);

  const mtu = 247; // Common Android BLE 4.2 / 5.0 MTU
  const fragments = slicePayload(payload, mtu);
  const usable = mtu - 5; // 242 bytes
  const expectedChunks = Math.ceil(1500 / usable);
  assert.equal(fragments.length, expectedChunks);

  const manager = new FragmentationManager();
  let final = null;
  for (const frag of fragments) {
    final = manager.ingestFragment('peer-test-4', frag);
  }
  assert.deepEqual(final, payload, '1500-byte payload reassembly must match exactly');
  console.log(`  ✓ 1,500B frame reassembled across ${fragments.length} chunks.`);
}

// 5. Tier 1 Regex Heuristic Triage Parser Verification
{
  console.log('\n[Test 5] Tier 1 Regex Heuristic Parser validation:');

  const criticalInput = 'Collapsed building, person trapped with broken leg and severe bleeding from femoral artery';
  const criticalResult = parseTriageHeuristics(criticalInput);
  assert.equal(criticalResult.priority, 2, 'Severe bleeding + trapped must resolve to CRITICAL (2)');
  assert.ok(criticalResult.hazard.includes('Structural Collapse'), 'Must detect Structural Collapse hazard');
  assert.ok(criticalResult.medicalNeed.includes('Severe Hemorrhage'), 'Must identify Severe Hemorrhage');

  const highInput = 'Severe thermal burns from propane tank blaze, fractured wrist';
  const highResult = parseTriageHeuristics(highInput);
  assert.equal(highResult.priority, 1, 'Thermal burn + fracture must resolve to HIGH (1)');
  assert.ok(highResult.hazard.includes('Active Fire'), 'Must detect Fire hazard');

  const lowInput = 'Dizzy from the heat, need clean drinking water and a blanket for elderly person';
  const lowResult = parseTriageHeuristics(lowInput);
  assert.equal(lowResult.priority, 0, 'Dehydration/water request must resolve to LOW (0)');
  assert.equal(lowResult.hazard, 'None', 'No hazard detected');

  console.log('  ✓ Tier 1 Regex Heuristic parser validated across triage spectrum.');
}

console.log('\n─── ALL VERIFICATION TESTS PASSED SUCCESSFULLY ───\n');
