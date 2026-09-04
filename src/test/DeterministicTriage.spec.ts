import {
  evaluateEmergencyTriage,
  Priority,
  TriageMethod,
} from '../triage/DeterministicTriage';
import { encodeTriage, decodeTriage } from '../network/Serializer';

export interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  durationMs: number;
}

export async function runDeterministicTriageSuite(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  function record(name: string, passed: boolean, details: string, start: number) {
    const durationMs = Number((performance.now() - start).toFixed(2));
    results.push({ name, passed, details, durationMs });
  }

  // ─── Test 1: Sub-Millisecond Execution Speed Benchmark ─────────────────────
  {
    const start = performance.now();
    const iterations = 500;
    const testStrings = [
      'Severe arterial bleeding from thigh wound, patient losing consciousness',
      'Broken arm and severe ankle sprain, unable to walk',
      'Minor scrape on left forearm, requesting water and blankets',
      'Toxic chlorine gas leak detected, building collapsing',
      'Victim trapped under heavy concrete rubble, breathing is labored',
    ];

    for (let i = 0; i < iterations; i++) {
      const str = testStrings[i % testStrings.length];
      evaluateEmergencyTriage(str);
    }
    const elapsed = performance.now() - start;
    const avgPerEvalMs = elapsed / iterations;

    record(
      'Sub-Millisecond Execution Speed',
      avgPerEvalMs < 0.5,
      `Executed ${iterations} triage passes in ${elapsed.toFixed(1)}ms (avg: ${avgPerEvalMs.toFixed(3)}ms/eval, ceiling: 0.5ms)`,
      start
    );
  }

  // ─── Test 2: START / SALT Protocol Life-Threat Classification ──────────────
  {
    const start = performance.now();
    const critRes = evaluateEmergencyTriage('Arterial bleeding with compound fracture');
    const unconRes = evaluateEmergencyTriage('Patient is unconscious and unresponsive');
    const apneaRes = evaluateEmergencyTriage('victim is not breathing and has no pulse');
    const crushRes = evaluateEmergencyTriage('Worker pinned under heavy collapsed beam');

    const highRes = evaluateEmergencyTriage('Deep laceration on thigh, severe pain, non-ambulatory');
    const lowRes = evaluateEmergencyTriage('Ambulatory walking wounded, minor scrape, needs bandage and water');

    const passed =
      critRes.priority === Priority.CRITICAL &&
      unconRes.priority === Priority.CRITICAL &&
      apneaRes.priority === Priority.CRITICAL &&
      crushRes.priority === Priority.CRITICAL &&
      highRes.priority === Priority.HIGH &&
      lowRes.priority === Priority.LOW;

    record(
      'START / SALT Emergency Classification',
      passed,
      `Critical, High, and Low tiers correctly partitioned according to mass-casualty protocols.`,
      start
    );
  }

  // ─── Test 3: Vitals-Based Physiological Triage ──────────────────────────────
  {
    const start = performance.now();
    const vitalsCrit = evaluateEmergencyTriage('Patient on ground', {
      vitals: { isAmbulatory: false, isBreathing: false },
    });
    const vitalsShock = evaluateEmergencyTriage('Pale patient', {
      vitals: { isAmbulatory: false, isBreathing: true, hasRadialPulse: false },
    });
    const vitalsWalking = evaluateEmergencyTriage('Walking survivor', {
      vitals: { isAmbulatory: true },
    });

    const passed =
      vitalsCrit.priority === Priority.CRITICAL &&
      vitalsShock.priority === Priority.CRITICAL &&
      vitalsWalking.priority === Priority.LOW;

    record(
      'Vitals-Based Physiological Scoring',
      passed,
      `Apnea and pulseless shock correctly mapped to CRITICAL; ambulatory status mapped to LOW.`,
      start
    );
  }

  // ─── Test 4: Typo & Degraded Lexicon Resilience (Damerau-Levenshtein) ────────
  {
    const start = performance.now();
    const typoBleed = evaluateEmergencyTriage('Victim has arterial hemarage on left arm');
    const typoUncon = evaluateEmergencyTriage('Person is unconcious on the floor');
    const typoBreathe = evaluateEmergencyTriage('Patient cant breth in dense smoke');
    const typoCrush = evaluateEmergencyTriage('Leg is crushd under concrete');

    const passed =
      typoBleed.priority === Priority.CRITICAL &&
      typoUncon.priority === Priority.CRITICAL &&
      typoBreathe.priority === Priority.CRITICAL &&
      typoCrush.priority === Priority.CRITICAL;

    record(
      'Typo Resilience via Bounded Levenshtein (D <= 1)',
      passed,
      `Caught misspelled keywords ("hemarage", "unconcious", "cant breth", "crushd") without dropping to LOW.`,
      start
    );
  }

  // ─── Test 5: Multilingual Emergency Classification (Spanish & Hindi) ───────
  {
    const start = performance.now();
    // Spanish
    const esCrit = evaluateEmergencyTriage('Victima con sangrado profuso y no respira');
    const esHaz = evaluateEmergencyTriage('Incendio en edificio con derrumbe de techo');

    // Hindi / Hinglish
    const hiCrit = evaluateEmergencyTriage('Bahut khoon beh raha hai aur behosh ho gaya');
    const hiHaz = evaluateEmergencyTriage('Bijli ka taar gir gaya aur makaan gir gaya');

    const passed =
      esCrit.priority === Priority.CRITICAL &&
      esHaz.hazardsDetected.includes('FIRE') &&
      esHaz.hazardsDetected.includes('COLLAPSE') &&
      hiCrit.priority === Priority.CRITICAL &&
      hiHaz.hazardsDetected.includes('LIVE_WIRE') &&
      hiHaz.hazardsDetected.includes('COLLAPSE');

    record(
      'Multilingual Triage & Hazard Extraction (ES & HI)',
      passed,
      `Spanish (sangrado/no respira/fuego) and Hindi (khoon/behosh/bijli ka taar) correctly classified.`,
      start
    );
  }

  // ─── Test 6: Monotonic Escalation & Responder Override Invariant ───────────
  {
    const start = performance.now();

    // 1. Civilian tries to select STABLE (LOW), but types severe trauma:
    const civilianResult = evaluateEmergencyTriage('trapped under rubble with arterial bleeding', {
      manualPriority: Priority.LOW,
      isResponder: false,
    });

    const isCivilianElevated =
      civilianResult.priority === Priority.CRITICAL &&
      civilianResult.isElevated === true &&
      civilianResult.triageMethod === TriageMethod.HEURISTIC;

    // 2. Certified Paramedic deliberately overrides to STABLE (LOW) for minor superficial bleeding:
    const responderResult = evaluateEmergencyTriage('superficial bleeding stopped with pressure, alert and stable', {
      manualPriority: Priority.LOW,
      isResponder: true,
      responderId: 'responder-alpha-99',
    });

    const isResponderOverridden =
      responderResult.priority === Priority.LOW &&
      responderResult.triageMethod === TriageMethod.MANUAL_OVERRIDE &&
      responderResult.medicalNeed.includes('RESPONDER_OVERRIDE');

    const passed = isCivilianElevated && isResponderOverridden;

    record(
      'Monotonic Escalation & Responder Override Policy',
      passed,
      `Civilian downgrade blocked (auto-elevated to CRITICAL); certified paramedic override permitted with audit tag.`,
      start
    );
  }

  // ─── Test 7: Protobuf Wire Roundtrip with TriageMethod ───────────────────────
  {
    const start = performance.now();
    const originalSOS = {
      id: crypto.randomUUID(),
      sender: crypto.randomUUID(),
      priority: Priority.CRITICAL,
      medicalNeed: 'Arterial bleed stabilized',
      hazard: 'FIRE / COLLAPSE',
      timestamp: Date.now(),
      status: 'PENDING' as const,
      triageMethod: TriageMethod.MANUAL_OVERRIDE,
    };

    const encoded = encodeTriage(originalSOS);
    const decoded = decodeTriage(encoded);

    const passed =
      decoded.id === originalSOS.id &&
      decoded.sender === originalSOS.sender &&
      decoded.priority === Priority.CRITICAL &&
      decoded.hazard === 'FIRE / COLLAPSE' &&
      decoded.triageMethod === TriageMethod.MANUAL_OVERRIDE;

    record(
      'Protobuf Wire Serialization with TriageMethod',
      passed,
      `Encoded to ${encoded.byteLength}B binary frame. Decoded matching triageMethod: MANUAL_OVERRIDE.`,
      start
    );
  }

  return results;
}
