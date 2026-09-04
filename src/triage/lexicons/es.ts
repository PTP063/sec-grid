import type { LexiconConfig } from './en';

export const esLexicon: LexiconConfig = {
  criticalPatterns: [
    /\b(sangr(ado|ando|e)|hemorragi(a|ca)|arterial|desangr(ando|andose))\b/i,
    /\b(no respira|sin respiraci(o|ó)n|asfixi(a|ado|ada)|ahog(ado|andose)|falta de aire|paro respiratorio)\b/i,
    /\b(inconsciente|desmay(ado|ada)|sin pulso|paro card(i|í)aco|no responde|coma)\b/i,
    /\b(atrapad(o|a)|aplastad(o|a)|bajo escombros|amputaci(o|ó)n|aplastamiento|miembro amputado)\b/i,
    /\b(quemadura(s)? de tercer grado|quemaduras graves)\b/i,
    /\b(bebe|ni(n|ñ)(o|a)) (no respira|inconsciente|sangrando)\b/i,
  ],

  highPatterns: [
    /\b(fractura(do|da)?|hueso roto|(brazo|pierna|cadera|cuello|costilla) rot(o|a))\b/i,
    /\b(no puede caminar|inm(o|ó)vil|sin movimiento|paralizad(o|a))\b/i,
    /\b(corte profundo|herida profunda|pu(n|ñ)alad(a|o)|machetazo)\b/i,
    /\b(quemadura(s)? de segundo grado|inhalaci(o|ó)n de humo)\b/i,
    /\b(conmoci(o|ó)n|trauma craneal|convulsi(o|ó)n|derrame)\b/i,
    /\b(dolor severo|dolor agudo|hipotermia|golpe de calor)\b/i,
  ],

  lowPatterns: [
    /\b(corte leve|rasgu(n|ñ)o|rasp(o|ó)n|moret(o|ó)n|esguince)\b/i,
    /\b(puede caminar|ambulatorio|herido leve|estable)\b/i,
    /\b(agua|comida|manta|refugio|suministros|curita|venda)\b/i,
    /\b(dolor de cabeza|mareo|n(a|á)useas|ansiedad|miedo)\b/i,
  ],

  hazardPatterns: {
    FIRE: [
      /\b(fuego|incendio|humo|llamas?|explosi(o|ó)n|ardiendo)\b/i,
    ],
    COLLAPSE: [
      /\b(derrumbe|colapso|escombros|ca(i|í)da de rocas|estructura inestable)\b/i,
    ],
    FLOOD: [
      /\b(inundaci(o|ó)n|sube el agua|corriente|ahogamiento|crecida)\b/i,
    ],
    LIVE_WIRE: [
      /\b(cable(s)? el(e|é)ctrico(s)?|poste ca(i|í)do|electrocut(ado|acion)|chispas)\b/i,
    ],
    GAS_LEAK: [
      /\b(fuga de gas|qu(i|í)mico|humos t(o|ó)xicos|olor a gas|derrame qu(i|í)mico)\b/i,
    ],
  },

  criticalRoots: [
    'sangrado',
    'hemorragia',
    'inconsciente',
    'asfixia',
    'atrapado',
    'aplastado',
    'desangrando',
    'amputacion',
  ],
};
