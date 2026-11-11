// Generates default-rigs/saturn.json: just Saturn orbiting the cursor with a trail. Run: node scripts/make-saturn.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeRig, uid } from '../src/lib/rig-core.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'default-rigs');
const ring = { id: uid('ring'), name: 'orbit', radius: 1.5, tilt: 52, node: -18, speed: 1.1, trail: false, color: '#e8d6a0' };
const seg = { id: uid('seg'), name: 'Saturn', parent: null, length: 0.5,
  orbit: { ring: ring.id, angle: 0, spin: 0, trail: { len: 46, width: 0.3, color: '#b8975a', alpha: 0.62 } },
  attachments: [{ id: uid('att'), kind: 'model', model: 'solar-saturn.glb', name: 'Saturn', fit: true, useColor: false, scale: [1.5, 1.5, 1.5], metalness: 0, roughness: 0.8 }] };
const rig = normalizeRig({
  id: 'saturn', name: 'Saturn', scale: 40, type: 'orbit',
  orbit: { baseSpeed: 0.7, maxSpeed: 9, sensitivity: 12, sway: 0.25, trails: false, sunSpin: 0, rings: [ring] },
  segments: [seg],
});
fs.writeFileSync(path.join(out, 'saturn.json'), JSON.stringify(rig, null, 1));
console.log('wrote saturn');
