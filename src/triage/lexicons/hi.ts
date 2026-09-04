import type { LexiconConfig } from './en';

export const hiLexicon: LexiconConfig = {
  criticalPatterns: [
    /\b(khoon|khun|bleed(ing)?|rakt|bahut khoon|arterial)\b/i,
    /\b(saans nahi|sans band|dam ghut|dum ghutna|asphyxia|not breathing)\b/i,
    /\b(behosh|achetan|unresponsive|pulse nahi|dil ka daura|heart attack)\b/i,
    /\b(daba hua|dabi hui|debris ke neeche|malba|amputat|crushed)\b/i,
    /\b(buritara jala|severe burn|teesre degree)\b/i,
    /\b(baccha|shishu) (behosh|saans nahi|khoon)\b/i,
  ],

  highPatterns: [
    /\b(haddi toot(i|gayi)|fracture|pair toota|haath toota)\b/i,
    /\b(chal nahi sakta|hil nahi sakta|paralyzed|immobile)\b/i,
    /\b(gehra ghaav|chaku|deep cut|badi chot)\b/i,
    /\b(dhua|smoke|jal gaya|burns)\b/i,
    /\b(sir me chot|head injury|daura|seizure)\b/i,
    /\b(tez dard|severe pain|thand se kaanp)\b/i,
  ],

  lowPatterns: [
    /\b(chhoti chot|halki chot|minor cut|sprain|moch)\b/i,
    /\b(chal sakta hai|thik hai|stable)\b/i,
    /\b(paani|khana|kambal|madad|bandage|dawai|rashan)\b/i,
    /\b(sar dard|chakkar|kamzori|darr)\b/i,
  ],

  hazardPatterns: {
    FIRE: [
      /\b(aag|dhuan|blaze|explosion|dhamaka)\b/i,
    ],
    COLLAPSE: [
      /\b(makaan gir gaya|chhat gir gayi|malba|girna|collapse|rubble)\b/i,
    ],
    FLOOD: [
      /\b(baadh|paani bhar gaya|doob raha|flood|current)\b/i,
    ],
    LIVE_WIRE: [
      /\b(bijli ka taar|current lag gaya|live wire|short circuit)\b/i,
    ],
    GAS_LEAK: [
      /\b(gas leak|zehreelee gas|toxic smell|chemical spill)\b/i,
    ],
  },

  criticalRoots: [
    'khoon',
    'behosh',
    'saans',
    'malba',
    'daba',
    'bleeding',
    'crushed',
  ],
};
