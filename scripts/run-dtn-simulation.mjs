import { DtnSimulation } from '../src/test/DtnSimulation.spec.ts';

console.log('================================================================');
console.log('   Mesh·OS Phase 4: DTN Anti-Entropy & Data Mule Simulation     ');
console.log('================================================================\n');

const results = await DtnSimulation.runSimulation();
let failedCount = 0;

for (const r of results) {
  const statusStr = r.passed ? '✓ PASS' : '✗ FAIL';
  console.log(`${statusStr}  ${r.step}`);
  console.log(`       Details: ${r.details}\n`);
  if (!r.passed) {
    failedCount++;
  }
}

console.log('-'.repeat(64));
console.log(`Summary: ${results.length - failedCount} Passed, ${failedCount} Failed.`);

if (failedCount > 0) {
  console.error('\n❌ DTN SIMULATION SUITE ENCOUNTERED FAILURES');
  process.exit(1);
} else {
  console.log('\n✅ ALL DTN ANTI-ENTROPY SIMULATION TESTS PASSED PERFECTLY\n');
}
