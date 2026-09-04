export interface LexiconConfig {
  criticalPatterns: RegExp[];
  highPatterns: RegExp[];
  lowPatterns: RegExp[];
  hazardPatterns: Record<'FIRE' | 'COLLAPSE' | 'FLOOD' | 'LIVE_WIRE' | 'GAS_LEAK', RegExp[]>;
  criticalRoots: string[];
}

export const enLexicon: LexiconConfig = {
  criticalPatterns: [
    /\b(bleed(ing)?|hemorrhag(e|ic)?|arterial|spurting|profuse(ly)?|blood loss)\b/i,
    /\b(not breathing|can('?t|not) breathe|asphyxi(a|at)?|suffocat(ing|ion)?|chok(ing)?|airway( obstruction)?|apnea|stridor)\b/i,
    /\b(unconscious|unresponsive|passed out|coma(tose)?|blacked? out|no pulse|pulseless|cardiac arrest|heart attack)\b/i,
    /\b(crush(ed)?|amputat(ion|ed)?|trapped( under| beneath)?|pinned( under| beneath)?|severed limb|open chest wound|sucking chest|flail chest)\b/i,
    /\b(third degree burn|3rd degree burn|full thickness burn|severe burns?( over \d+%)?)\b/i,
    /\b(infant|baby|child) (unresponsive|not breathing|choking|bleeding)\b/i,
  ],

  highPatterns: [
    /\b(fracture|broken (bone|leg|arm|hip|neck|rib|pelvis)|dislocat(ed|ion)?)\b/i,
    /\b(cannot walk|non-ambulatory|immobile|unable to move|paralyzed|spinal)\b/i,
    /\b(deep (laceration|cut|wound)|stab(bed)?|puncture( wound)?|gash)\b/i,
    /\b(second degree burn|2nd degree burn|scald(ed)?|smoke inhal(ation)?)\b/i,
    /\b(concussion|head (injury|trauma)|seizure|stroke|altered mental)\b/i,
    /\b(severe pain|hypothermi(a|c)?|heat stroke|dehydrat(ed|ion)?)\b/i,
  ],

  lowPatterns: [
    /\b(minor cut|scrape|scratch|bruise|abrasion|sprain)\b/i,
    /\b(ambulatory|can walk|walking wounded|mild|stable)\b/i,
    /\b(water|food|blanket|shelter|supplies|bandaid|bandage)\b/i,
    /\b(headache|nausea|dizzy|fatigue|anxious|scared)\b/i,
  ],

  hazardPatterns: {
    FIRE: [
      /\b(fire|flame|smoke|blaze|explosion|burning|conflagration)\b/i,
    ],
    COLLAPSE: [
      /\b(collaps(e|ed|ing)?|rubble|debris|falling (rocks?|debris|masonry)|unstable structur(e|al))\b/i,
    ],
    FLOOD: [
      /\b(flood(s|ed|ing)?|water rising|current|drown(ed|ing)?|submerged?|tsunami)\b/i,
    ],
    LIVE_WIRE: [
      /\b(power lines?|downed wire|electrocution|live wire|electrical arcing|sparking)\b/i,
    ],
    GAS_LEAK: [
      /\b(gas leak|chemical( spill)?|fumes|toxic|chlorine|ammonia|sulfur|smell gas)\b/i,
    ],
  },

  // Critical roots used for bounded Damerau-Levenshtein matching ($D <= 1)
  criticalRoots: [
    'bleeding',
    'hemorrhage',
    'arterial',
    'breathing',
    'breath',
    'suffocate',
    'asphyxia',
    'unconscious',
    'unresponsive',
    'pulseless',
    'cardiac',
    'crushed',
    'trapped',
    'amputation',
  ],
};
