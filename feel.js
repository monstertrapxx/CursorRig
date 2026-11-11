// Per-chain "feel": the menu settings (size, gravity, drag...) saved inside each rig as `feel`.
// Optional field: rigs without it use the global defaults, and the older app simply ignores it.
'use strict';
const NUM = ['scale', 'gravity', 'damping', 'opacity', 'windStrength', 'orbitTilt', 'orbitRoll', 'orbitSpeed', 'orbitSize', 'orbitDir', 'impactAmount', 'ringSize', 'spin', 'spinAllow', 'anatomy', 'linkSize'];
const BOOL = ['wind', 'floor', 'walls', 'orbitReal', 'impactOn', 'ceiling'];
const STR = { impactStyle: ['wood', 'blood', 'sparks', 'dust'] };
const FEEL_KEYS = [...NUM, ...BOOL, ...Object.keys(STR)];

function pickFeel(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const k of NUM) if (Number.isFinite(o[k])) out[k] = o[k];
  for (const k of BOOL) if (typeof o[k] === 'boolean') out[k] = o[k];
  for (const k of Object.keys(STR)) if (STR[k].includes(o[k])) out[k] = o[k];
  return out;
}
const effective = (globalSettings, feel) => ({ ...globalSettings, ...pickFeel(feel) });

module.exports = { FEEL_KEYS, pickFeel, effective };
