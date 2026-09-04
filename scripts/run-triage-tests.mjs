import { runDeterministicTriageSuite } from '../src/test/DeterministicTriage.spec.ts';

console.log('================================================================');
console.log('   Mesh·OS: Deterministic START/SALT Emergency Triage Suite     ');
console.log('================================================================\n');

try {
  const results = await runDeterministicTriageSuite();
  let allPassed = true;

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const icon = res.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${icon}  Step ${i + 1}: ${res.name}`);
    console.log(`       Details: ${res.details}`);
    console.log(`       Duration: ${res.durationMs}ms\n`);
    if (!res.passed) allPassed = false;
  }

  console.log('----------------------------------------------------------------');
  const passCount = results.filter((r) => r.passed).length;
  console.log(`Summary: ${passCount} Passed, ${results.length - passCount} Failed.\n`);

  if (allPassed) {
    console.log('✅ ALL DETERMINISTIC TRIAGE PROTOCOL TESTS PASSED PERFECTLY\n');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED VERIFICATION\n');
    process.exit(1);
  }
} catch (err) {
  console.error('Fatal test runner exception:', err);
  process.exit(1);
}
