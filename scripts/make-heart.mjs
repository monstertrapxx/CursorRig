// Generates default-rigs/heart.json: one glowing heart (default-rigs/models/heart.stl) orbiting the cursor, always facing you, with a white trail.
// Run: node scripts/make-heart.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeRig, uid } from '../src/lib/rig-core.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'default-rigs');
function make(id, name, model) {
  const ring = { id: uid('ring'), name: 'orbit', radius: 1.5, tilt: 62, node: -18, speed: 1.2, trail: false, color: '#ffffff' };
  const seg = { id: uid('seg'), name, parent: null, length: 0.5,
    orbit: { ring: ring.id, angle: 0, spin: 0, trail: { len: 50, width: 0.34, color: '#ffffff', alpha: 0.7 } },
    // the STL lies flat (thin along its Y axis, point toward -Z), so turn it to face the screen: X -90 degrees keeps the point downward
    attachments: [{ id: uid('att'), kind: 'model', model, name, fit: true, useColor: true, color: '#ff3b6b', emissive: '#ff1f55', emissiveIntensity: 1.1,
      metalness: 0, roughness: 0.35, rotation: [-90, 0, 0], scale: [1.5, 1.5, 1.5], glow: 3.2 }] };
  const rig = normalizeRig({
    id, name, scale: 40, type: 'orbit',
    orbit: { baseSpeed: 0.7, maxSpeed: 9, sensitivity: 12, sway: 0.2, trails: false, sunSpin: 0, rings: [ring] },
    segments: [seg],
  });
  fs.writeFileSync(path.join(out, id + '.json'), JSON.stringify(rig, null, 1));
  console.log('wrote', id);
}
make('heart', 'Heart', 'heart.stl');
make('febheart', 'Feb heart', 'febheart.stl');
