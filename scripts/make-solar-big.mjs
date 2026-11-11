// Generates default-rigs/bigsolar.json: a solar system with large planets. Run: node scripts/make-solar-big.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeRig, uid } from '../src/lib/rig-core.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'default-rigs');
const att = (shape, o) => ({ id: uid('att'), kind: 'primitive', shape, name: o.name || shape, metalness: 0, roughness: 0.75, ...o });
// name, orbit radius, size (diameter, rig units), colour, start angle
const P = [
  ['Mercury', 0.95, 0.2, '#a8a29a', 20],
  ['Venus', 1.3, 0.3, '#e3c07a', 120],
  ['Earth', 1.65, 0.32, '#4f8fe0', 200],
  ['Mars', 2.0, 0.26, '#d0623c', 300],
  ['Jupiter', 2.5, 0.55, '#d9a97a', 60],
  ['Saturn', 3.0, 0.48, '#e6cf96', 160],
  ['Uranus', 3.45, 0.38, '#8fd6dc', 250],
  ['Neptune', 3.85, 0.36, '#4568d8', 340],
];
const rings = [], segments = [];
P.forEach(([name, r, size, color, angle], k) => {
  const ring = { id: uid('ring'), name: name + ' orbit', radius: r, tilt: 46, node: -20, speed: Math.round(200 / r) / 100, trail: true, color: '#ffffff' };
  rings.push(ring);
  const seg = { id: uid('seg'), name, parent: null, length: 0.5, orbit: { ring: ring.id, angle, spin: 1.2 }, attachments: [att('sphere', { name, color, scale: [size, size, size] })] };
  if (name === 'Saturn') seg.attachments.push(att('torus', { name: 'rings', color: '#cdb98a', thickness: 0.1, rotation: [75, 0, 0], scale: [size * 2.1, size * 2.1, size * 2.1], opacity: 0.92 }));
  segments.push(seg);
});
const rig = normalizeRig({
  id: 'bigsolar', name: 'Big solar system', scale: 24, type: 'orbit',
  orbit: { baseSpeed: 0.7, maxSpeed: 9, sensitivity: 12, trailOpacity: 0.22, sway: 0.25, rings },
  anchor: { offset: [0, 0, 0], attachments: [att('sphere', { name: 'Sun', color: '#ffc83d', emissive: '#ff9a1f', emissiveIntensity: 1.3, scale: [0.6, 0.6, 0.6], roughness: 0.5, glow: 2.6 })] },
  segments,
});
fs.writeFileSync(path.join(out, 'bigsolar.json'), JSON.stringify(rig, null, 1));
console.log('wrote bigsolar', rig.segments.length, 'planets');
