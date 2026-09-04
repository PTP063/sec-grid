import { BleStressHarness } from '../src/test/BleStressHarness.ts';
import { BleTelemetry } from '../src/diagnostics/BleTelemetry.ts';

console.log('================================================================');
console.log('   Mesh·OS Phase 3: Hardware Verification & BLE Stress Suite    ');
console.log('================================================================\n');

const results = BleStressHarness.runFullStressSuite();
let failedCount = 0;

console.log(`Executed ${results.length} stress test permutations:\n`);

// Table format
console.log(
  'Test Name'.padEnd(38) +
  'Size'.padEnd(10) +
  'MTU'.padEnd(8) +
  'Chunks'.padEnd(10) +
  'Time'.padEnd(12) +
  'Status'
);
console.log('-'.repeat(86));

for (const r of results) {
  const statusStr = r.passed ? '✓ PASS' : '✗ FAIL';
  const sizeStr = `${r.payloadSize} B`;
  const mtuStr = `${r.mtu} B`;
  const chunksStr = `${r.totalChunks}`;
  const timeStr = `${r.durationMs} ms`;

  console.log(
    r.testName.padEnd(38) +
    sizeStr.padEnd(10) +
    mtuStr.padEnd(8) +
    chunksStr.padEnd(10) +
    timeStr.padEnd(12) +
    statusStr
  );

  if (!r.passed) {
    console.error(`  --> FAILURE DETAILS: ${r.details}`);
    failedCount++;
  }
}

console.log('-'.repeat(86));
console.log(`\nSummary: ${results.length - failedCount} Passed, ${failedCount} Failed.`);

// Telemetry Simulation Check
console.log('\n--- Link-Layer Telemetry & Power Profiling Verification ---');
const telemetry = BleTelemetry.getInstance();
telemetry.recordScanStart();
telemetry.recordPeerRssi('field-node-alpha', -82);
telemetry.recordPeerRssi('field-node-alpha', -86);
telemetry.recordConnectionStart('field-node-alpha');
telemetry.recordChunkTransmission('field-node-alpha', 180, true, 42);
telemetry.recordChunkTransmission('field-node-alpha', 180, false);
telemetry.recordChunkReceived('field-node-alpha', 180);
telemetry.recordFrameCompleted('field-node-alpha');
telemetry.recordConnectionStop('field-node-alpha');
telemetry.recordScanStop();

const metrics = telemetry.getPeerMetrics('field-node-alpha');
console.log('Node Alpha Link Metrics:');
console.log(`  - Filtered EMA RSSI: ${metrics.emaRssi} dBm (Edge-of-range: -85 dBm target)`);
console.log(`  - Packet Error Rate (PER): ${(metrics.packetErrorRate * 100).toFixed(1)}%`);
console.log(`  - Average GATT RTT: ${metrics.rttMs} ms`);
console.log(`  - Estimated Airtime: ${metrics.estimatedAirtimeMs.toFixed(3)} ms`);

const power = telemetry.getPowerMetrics();
console.log('\nSystem Power Profile:');
console.log(`  - Scan Duty Cycle: ${(power.scanDutyCycleRatio * 100).toFixed(2)}%`);
console.log(`  - Connection Duty Cycle: ${(power.connectionDutyCycleRatio * 100).toFixed(2)}%`);
console.log(`  - 24-Hour Blackout Survival Safe: ${power.is24HourSurvivalSafe ? 'YES (Duty Cycle < 25%)' : 'NO'}`);

if (failedCount > 0) {
  console.error('\n❌ STRESS TEST SUITE ENCOUNTERED FAILURES');
  process.exit(1);
} else {
  console.log('\n✅ ALL PHASE 3 VERIFICATION TESTS PASSED PERFECTLY\n');
}
