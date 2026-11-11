// Generates default-rigs/giantstars.json: one big glowing star circling the cursor with a trail of smaller stars behind it.
// Run: node scripts/make-stars.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeRig, uid } from '../src/lib/rig-core.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'default-rigs');
const ring = { id: uid('ring'), name: 'orbit', radius: 1.5, tilt: 62, node: -18, speed: 1.4, trail: false, color: '#ffe566' };
const COUNT = 5, segments = [];
for (let i = 0; i < COUNT; i++) {
  const k = i / (COUNT - 1), size = 0.85 - 0.65 * k, name = i ? 'trail star ' + i : 'lead star';
  segments.push({ id: uid('seg'), name, parent: null, length: 0.5, orbit: { ring: ring.id, angle: -i * 30, spin: 0.8, ...(i === 0 ? { trail: { len: 44, width: 0.42, color: '#ffd84a', alpha: 0.65 } } : { trail: { len: 18, width: size * 0.45, color: '#ffd84a', alpha: 0.4 } }) },
    attachments: [{ id: uid('att'), kind: 'primitive', shape: 'star', name, color: i ? '#ffe566' : '#ffd93a', emissive: '#ffb000', emissiveIntensity: 0.9,
      metalness: 0, roughness: 0.45, scale: [size, size, size], glow: i ? 2.2 : 3 }] });
}
const rig = normalizeRig({
  id: 'giantstars', name: 'Giant stars', scale: 30, type: 'orbit',
  orbit: { baseSpeed: 0.7, maxSpeed: 9, sensitivity: 12, trails: false, sunSpin: 0, sway: 0.3, rings: [ring] },
  segments,
});
fs.writeFileSync(path.join(out, 'giantstars.json'), JSON.stringify(rig, null, 1));
console.log('wrote giantstars', rig.segments.length, 'stars');
