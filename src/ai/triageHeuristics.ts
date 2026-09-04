export const Priority = {
  LOW: 0,
  HIGH: 1,
  CRITICAL: 2,
} as const;
export type Priority = typeof Priority[keyof typeof Priority];

export interface TriageSOSData {
  id: string;
  sender: string;
  priority: Priority;
  medicalNeed: string;
  hazard: string;
  timestamp: number;
  status?: 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
}

/**
 * Deterministic, zero-latency Tier 1 Regex Heuristic Triage Parser.
 *
 * Executes in < 0.2ms with zero GPU/WASM overhead to preserve critical battery
 * reserves on mobile nodes during screen-off and ad-hoc disaster mesh operation.
 */
export function parseTriageHeuristics(text: string): TriageSOSData {
  const lower = text.toLowerCase();
  let priority: Priority = Priority.LOW;
  let medicalNeed = text.trim().slice(0, 120);
  let hazard = 'None';

  // 1. Critical Priority Regex Matching
  const criticalBleed = /\b(bleed(ing)?|hemorrhag(e|ic)?|arterial|blood)\b/i.test(lower);
  const criticalBreathing = /\b(not breathing|can't breathe|suffocat(ing|ion)?|asphyxia|chok(ing)?|airway)\b/i.test(lower);
  const criticalConscious = /\b(unconscious|unresponsive|passed out|coma|blackout)\b/i.test(lower);
  const criticalCardiac = /\b(cardiac|heart attack|pulseless|arrest)\b/i.test(lower);
  const criticalTrauma = /\b(crush(ed)?|amputat(ion|ed)?|trapped under|pinned)\b/i.test(lower);

  // 2. High Priority Regex Matching
  const highFracture = /\b(fracture|broken (bone|leg|arm|hip|neck|rib)|dislocat(ed|ion)?)\b/i.test(lower);
  const highBurns = /\b(burn(s|ed|t)?|scald|smoke inhal(ation)?)\b/i.test(lower);
  const highNeuro = /\b(concussion|seizure|head injury|stroke)\b/i.test(lower);
  const highWound = /\b(deep cut|stab(bed)?|puncture|gash|wound)\b/i.test(lower);
  const highSevere = /\b(chest pain|severe pain|asthma attack|hypothermi|heat stroke)\b/i.test(lower);

  // Priority Evaluation
  if (criticalBleed || criticalBreathing || criticalConscious || criticalCardiac || criticalTrauma) {
    priority = Priority.CRITICAL;
    const reasons: string[] = [];
    if (criticalBleed) reasons.push('Severe Hemorrhage');
    if (criticalBreathing) reasons.push('Respiratory Compromise');
    if (criticalConscious) reasons.push('Loss of Consciousness');
    if (criticalCardiac) reasons.push('Cardiac Distress');
    if (criticalTrauma) reasons.push('Traumatic Entrapment/Crush');
    medicalNeed = `${reasons.join(' & ')} - Immediate intervention required`;
  } else if (highFracture || highBurns || highNeuro || highWound || highSevere) {
    priority = Priority.HIGH;
    const reasons: string[] = [];
    if (highFracture) reasons.push('Suspected Fracture/Trauma');
    if (highBurns) reasons.push('Thermal Burn/Inhalation');
    if (highNeuro) reasons.push('Neurological/Head Trauma');
    if (highWound) reasons.push('Laceration/Penetrating Injury');
    if (highSevere) reasons.push('Acute Severe Pain/Exposure');
    medicalNeed = `${reasons.join(' & ')} - Urgent stabilization required`;
  } else {
    priority = Priority.LOW;
    medicalNeed = text.trim().slice(0, 120) || 'Minor injury or supply request';
  }

  // 3. Environmental Hazard Extraction
  if (/\b(fire|flame|smoke|blaze|explosion)\b/i.test(lower)) {
    hazard = 'Active Fire / Smoke / Gas';
  } else if (/\b(collaps(e|ed|ing)?|rubble|debris|falling rocks?|unstable)\b/i.test(lower)) {
    hazard = 'Structural Collapse / Falling Debris';
  } else if (/\b(flood(s|ed|ing)?|water rising|current|drown(ed|ing)?|submerged?)\b/i.test(lower)) {
    hazard = 'Rising Floodwater / Water Hazard';
  } else if (/\b(power lines?|electrocution|live wire|electrical)\b/i.test(lower)) {
    hazard = 'Downed Power Lines / Electrical';
  } else if (/\b(gas leak|chemical|fumes|toxic|spill)\b/i.test(lower)) {
    hazard = 'Chemical / Hazardous Material Spill';
  }

  return {
    id: crypto.randomUUID(),
    sender: 'heuristic-tier1',
    priority,
    medicalNeed: medicalNeed.slice(0, 120),
    hazard: hazard.slice(0, 120),
    timestamp: Date.now(),
  };
}
