import { enLexicon } from './lexicons/en';
import { esLexicon } from './lexicons/es';
import { hiLexicon } from './lexicons/hi';

export const Priority = {
  LOW: 0,
  HIGH: 1,
  CRITICAL: 2,
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const TriageMethod = {
  MANUAL: 0,
  HEURISTIC: 1,
  MANUAL_OVERRIDE: 2,
} as const;
export type TriageMethod = (typeof TriageMethod)[keyof typeof TriageMethod];

export type HazardCategory = 'FIRE' | 'COLLAPSE' | 'FLOOD' | 'LIVE_WIRE' | 'GAS_LEAK' | 'NONE';

export interface VitalsInput {
  isAmbulatory?: boolean; // Can walk?
  isBreathing?: boolean; // Spontaneous breathing?
  respirationRate?: number; // Breaths/min (<10 or >30 is Critical)
  hasRadialPulse?: boolean; // Radial pulse present or cap refill <2s?
  canFollowCommands?: boolean; // Normal mental status?
}

export interface TriageResult {
  priority: Priority;
  triageMethod: TriageMethod;
  medicalNeed: string;
  hazard: string;
  hazardsDetected: HazardCategory[];
  isElevated: boolean;
  elevationReason?: string;
  matchedKeywords: string[];
  executionTimeMs: number;
}

// ─── Bitmask Flags for Zero-Allocation Evaluation ─────────────────────────────
const FLAG_CRITICAL = 1 << 0;
const FLAG_HIGH = 1 << 1;
const FLAG_LOW = 1 << 2;
const FLAG_HAZARD_FIRE = 1 << 3;
const FLAG_HAZARD_COLLAPSE = 1 << 4;
const FLAG_HAZARD_FLOOD = 1 << 5;
const FLAG_HAZARD_LIVE_WIRE = 1 << 6;
const FLAG_HAZARD_GAS_LEAK = 1 << 7;

// Pre-aggregated root list for bounded Damerau-Levenshtein
const ALL_CRITICAL_ROOTS = Array.from(
  new Set([...enLexicon.criticalRoots, ...esLexicon.criticalRoots, ...hiLexicon.criticalRoots])
);

// All regex patterns aggregated at module initialization
const ALL_CRITICAL_PATTERNS = [
  ...enLexicon.criticalPatterns,
  ...esLexicon.criticalPatterns,
  ...hiLexicon.criticalPatterns,
];

const ALL_HIGH_PATTERNS = [
  ...enLexicon.highPatterns,
  ...esLexicon.highPatterns,
  ...hiLexicon.highPatterns,
];

const ALL_LOW_PATTERNS = [
  ...enLexicon.lowPatterns,
  ...esLexicon.lowPatterns,
  ...hiLexicon.lowPatterns,
];

const ALL_HAZARD_PATTERNS: Record<Exclude<HazardCategory, 'NONE'>, RegExp[]> = {
  FIRE: [...enLexicon.hazardPatterns.FIRE, ...esLexicon.hazardPatterns.FIRE, ...hiLexicon.hazardPatterns.FIRE],
  COLLAPSE: [...enLexicon.hazardPatterns.COLLAPSE, ...esLexicon.hazardPatterns.COLLAPSE, ...hiLexicon.hazardPatterns.COLLAPSE],
  FLOOD: [...enLexicon.hazardPatterns.FLOOD, ...esLexicon.hazardPatterns.FLOOD, ...hiLexicon.hazardPatterns.FLOOD],
  LIVE_WIRE: [...enLexicon.hazardPatterns.LIVE_WIRE, ...esLexicon.hazardPatterns.LIVE_WIRE, ...hiLexicon.hazardPatterns.LIVE_WIRE],
  GAS_LEAK: [...enLexicon.hazardPatterns.GAS_LEAK, ...esLexicon.hazardPatterns.GAS_LEAK, ...hiLexicon.hazardPatterns.GAS_LEAK],
};

// ─── Bounded Damerau-Levenshtein Distance ($D \le 1$) ─────────────────────────

/**
 * Fast, allocation-free Damerau-Levenshtein check bounded to threshold <= 1.
 * Tests if `a` can be transformed to `b` with at most 1 insertion, deletion,
 * substitution, or transposition of adjacent characters.
 */
export function isDamerauLevenshteinOne(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (a === b) return true;

  // Single insertion / deletion
  if (la !== lb) {
    const longer = la > lb ? a : b;
    const shorter = la > lb ? b : a;
    let i = 0;
    let j = 0;
    let diffFound = false;

    while (i < longer.length && j < shorter.length) {
      if (longer[i] !== shorter[j]) {
        if (diffFound) return false;
        diffFound = true;
        i++; // skip one in longer
      } else {
        i++;
        j++;
      }
    }
    return true;
  }

  // Same length: either 1 substitution or 1 transposition
  let diffCount = 0;
  let firstDiff = -1;
  let secondDiff = -1;

  for (let k = 0; k < la; k++) {
    if (a[k] !== b[k]) {
      diffCount++;
      if (diffCount === 1) firstDiff = k;
      else if (diffCount === 2) secondDiff = k;
      else return false;
    }
  }

  if (diffCount === 1) return true; // 1 substitution
  if (diffCount === 2) {
    // Check transposition of adjacent characters
    return (
      secondDiff === firstDiff + 1 &&
      a[firstDiff] === b[secondDiff] &&
      a[secondDiff] === b[firstDiff]
    );
  }

  return false;
}

// ─── Text Normalization ───────────────────────────────────────────────────────

export function normalizeEmergencyText(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/['’]/g, '') // normalize contractions ("can't" -> "cant")
    .trim();
}

// ─── Core Deterministic Triage Evaluator ──────────────────────────────────────

export interface EvaluateOptions {
  manualPriority?: Priority;
  manualHazard?: HazardCategory;
  vitals?: VitalsInput;
  isResponder?: boolean;
  responderId?: string;
}

/**
 * Evaluates unstructured emergency text and optional structured vitals/vitals
 * against START/SALT mass-casualty protocols.
 *
 * Runs synchronously in < 0.5 ms with pre-compiled regexes and bounded Levenshtein.
 */
export function evaluateEmergencyTriage(text: string, options: EvaluateOptions = {}): TriageResult {
  const startHr = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const normalized = normalizeEmergencyText(text);

  let bitfield = 0;
  const matchedKeywords: string[] = [];
  const detectedHazards: HazardCategory[] = [];

  // 1. Evaluate START / SALT physiological vitals if present
  if (options.vitals) {
    const { isAmbulatory, isBreathing, respirationRate, hasRadialPulse, canFollowCommands } = options.vitals;

    if (isAmbulatory === true) {
      bitfield |= FLAG_LOW;
    } else {
      if (isBreathing === false) {
        bitfield |= FLAG_CRITICAL;
        matchedKeywords.push('Apnea / No Spontaneous Breathing');
      } else if (respirationRate !== undefined && (respirationRate < 10 || respirationRate > 30)) {
        bitfield |= FLAG_CRITICAL;
        matchedKeywords.push(`Severe Respiratory Distress (${respirationRate} bpm)`);
      } else if (hasRadialPulse === false) {
        bitfield |= FLAG_CRITICAL;
        matchedKeywords.push('Absent Radial Pulse / Circulatory Shock');
      } else if (canFollowCommands === false) {
        bitfield |= FLAG_CRITICAL;
        matchedKeywords.push('Altered Mental Status / Cannot Follow Commands');
      } else {
        bitfield |= FLAG_HIGH; // Non-ambulatory with stable vitals -> Delayed (Yellow)
        matchedKeywords.push('Non-Ambulatory / Delayed Treatment');
      }
    }
  }

  // 2. Direct Stem Regex Passes
  if (normalized.length > 0) {
    for (const pattern of ALL_CRITICAL_PATTERNS) {
      if (pattern.test(normalized)) {
        bitfield |= FLAG_CRITICAL;
        matchedKeywords.push(pattern.source.slice(0, 30));
        break;
      }
    }

    if (!(bitfield & FLAG_CRITICAL)) {
      for (const pattern of ALL_HIGH_PATTERNS) {
        if (pattern.test(normalized)) {
          bitfield |= FLAG_HIGH;
          matchedKeywords.push(pattern.source.slice(0, 30));
          break;
        }
      }
    }

    for (const pattern of ALL_LOW_PATTERNS) {
      if (pattern.test(normalized)) {
        bitfield |= FLAG_LOW;
        break;
      }
    }

    // 3. Bounded Damerau-Levenshtein Fallback for Typos / Degraded Input
    // If not already flagged CRITICAL, check un-matched tokens >= 5 chars against critical roots
    if (!(bitfield & FLAG_CRITICAL)) {
      const tokens = normalized.split(/[^a-z0-9]+/);
      for (const token of tokens) {
        if (token.length >= 5) {
          for (const root of ALL_CRITICAL_ROOTS) {
            if (isDamerauLevenshteinOne(token, root)) {
              bitfield |= FLAG_CRITICAL;
              matchedKeywords.push(`TypoMatch: "${token}" ~ "${root}"`);
              break;
            }
          }
          if (bitfield & FLAG_CRITICAL) break;
        }
      }
    }

    // 4. Hazard Extraction
    if (ALL_HAZARD_PATTERNS.FIRE.some((p) => p.test(normalized))) {
      bitfield |= FLAG_HAZARD_FIRE;
      detectedHazards.push('FIRE');
    }
    if (ALL_HAZARD_PATTERNS.COLLAPSE.some((p) => p.test(normalized))) {
      bitfield |= FLAG_HAZARD_COLLAPSE;
      detectedHazards.push('COLLAPSE');
    }
    if (ALL_HAZARD_PATTERNS.FLOOD.some((p) => p.test(normalized))) {
      bitfield |= FLAG_HAZARD_FLOOD;
      detectedHazards.push('FLOOD');
    }
    if (ALL_HAZARD_PATTERNS.LIVE_WIRE.some((p) => p.test(normalized))) {
      bitfield |= FLAG_HAZARD_LIVE_WIRE;
      detectedHazards.push('LIVE_WIRE');
    }
    if (ALL_HAZARD_PATTERNS.GAS_LEAK.some((p) => p.test(normalized))) {
      bitfield |= FLAG_HAZARD_GAS_LEAK;
      detectedHazards.push('GAS_LEAK');
    }
  }

  // 5. Derive Heuristic Priority
  let heuristicPriority: Priority = Priority.LOW;
  if (bitfield & FLAG_CRITICAL) {
    heuristicPriority = Priority.CRITICAL;
  } else if (bitfield & FLAG_HIGH) {
    heuristicPriority = Priority.HIGH;
  } else {
    heuristicPriority = Priority.LOW;
  }

  // 6. Manual Selection & Monotonic Escalation Resolution
  const manualPriority = options.manualPriority;
  let finalPriority: Priority;
  let triageMethod: TriageMethod;
  let isElevated = false;
  let elevationReason: string | undefined;

  if (manualPriority === undefined) {
    finalPriority = heuristicPriority;
    triageMethod = TriageMethod.HEURISTIC;
  } else if (heuristicPriority > manualPriority) {
    // Conflict: text detected life threat but manual selection was lower
    if (options.isResponder && options.responderId) {
      // Certified responder override permitted
      finalPriority = manualPriority;
      triageMethod = TriageMethod.MANUAL_OVERRIDE;
    } else {
      // Invariant: Unauthenticated/civilian input strictly monotonic upward
      finalPriority = heuristicPriority;
      triageMethod = TriageMethod.HEURISTIC;
      isElevated = true;
      elevationReason = `Elevated from ${manualPriority === Priority.LOW ? 'STABLE' : 'URGENT'} to ${
        finalPriority === Priority.CRITICAL ? 'CRITICAL' : 'URGENT'
      } based on detected trauma keywords`;
    }
  } else {
    finalPriority = manualPriority;
    triageMethod = TriageMethod.MANUAL;
  }

  // 7. Hazard Label Formatting
  if (options.manualHazard && options.manualHazard !== 'NONE' && !detectedHazards.includes(options.manualHazard)) {
    detectedHazards.unshift(options.manualHazard);
  }

  const hazardLabel = detectedHazards.length > 0 ? detectedHazards.join(' / ') : 'None';

  // 8. Medical Need Summary
  let medicalNeed = text.trim();
  if (!medicalNeed) {
    if (finalPriority === Priority.CRITICAL) medicalNeed = 'Immediate Life Threat / Catastrophic Trauma';
    else if (finalPriority === Priority.HIGH) medicalNeed = 'Urgent Non-Ambulatory Medical Assistance';
    else medicalNeed = 'Stable / Minor Injury or Supplies';
  }

  if (triageMethod === TriageMethod.MANUAL_OVERRIDE && options.responderId) {
    medicalNeed += ` [RESPONDER_OVERRIDE:${options.responderId.slice(0, 8)}]`;
  }

  const endHr = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    priority: finalPriority,
    triageMethod,
    medicalNeed: medicalNeed.slice(0, 140),
    hazard: hazardLabel.slice(0, 80),
    hazardsDetected: detectedHazards,
    isElevated,
    elevationReason,
    matchedKeywords,
    executionTimeMs: Math.max(0.01, Number((endHr - startHr).toFixed(3))),
  };
}
