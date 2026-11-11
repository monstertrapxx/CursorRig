// Generates default-rigs/conker.json: a conker on a string. The model (default-rigs/models/conker.glb,
// a textured sphere) is made by scripts/make_conker.py. Run: node scripts/make-conker.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeRig, uid } from '../src/lib/rig-core.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'default-rigs');
const STRING = '#d8c8a2';
const att = (shape, o) => ({ id: uid('att'), kind: 'primitive', shape, name: o.name || shape, metalness: 0, roughness: 0.9, ...o });
const segments = [];
let parent = null;
const L = 0.45;
for (let k = 0; k < 6; k++) {
  const s = { id: uid('seg'), name: 'string ' + (k + 1), parent, length: L, mass: 0.6,
    attachments: [att('cylinder', { name: 'string', color: STRING, position: [0, -L / 2, 0], scale: [0.035, L * 1.02, 0.035] })] };
  segments.push(s); parent = s.id;
}
// the conker sits on its own heavy segment, with a small knot where the string enters
segments.push({ id: uid('seg'), name: 'conker', parent, length: 0.31, mass: 6, attachments: [
  att('sphere', { name: 'knot', color: STRING, position: [0, -0.02, 0], scale: [0.1, 0.1, 0.1] }),
  { id: uid('att'), kind: 'model', model: 'conker-nut2.glb', name: 'conker', fit: true, useColor: false, position: [0, -0.31, 0], rotation: [0, 0, 0], scale: [0.7, 0.7, 0.7], spin: 40, spinDrive: 0.8 },
] });
const rig = normalizeRig({ id: 'conker', name: 'Conker on a string', scale: 46, physics: { gravity: 34, damping: 0.02, iterations: 16, substeps: 6, flatten: 0.15, depthSway: 0.3 }, segments });
fs.writeFileSync(path.join(out, 'conker.json'), JSON.stringify(rig, null, 1));
console.log('wrote conker', rig.segments.length, 'segments');
