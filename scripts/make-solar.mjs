// Generates default-rigs/solarsystem.json: a realistic solar system around the cursor. Run: node scripts/make-solar.mjs
// Realism: real planet order, colours and textured surfaces, Saturn's rings, orbits nearly in one plane (real inclinations),
// Kepler-style speeds (real period ratios, square-rooted so Neptune still visibly moves), the Moon, the four Galilean moons
// and Titan, planets spinning on their axes (Venus backwards), moons locked to face their planet. Distances and sizes are compressed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeRig, uid } from '../src/lib/rig-core.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'default-rigs');
const model = (name, size, extra = {}) => ({ id: uid('att'), kind: 'model', model: `solar-${name}.glb`, name, fit: true, useColor: false, scale: [size, size, size], metalness: 0, roughness: 0.8, ...extra });
const T0 = 58;           // how far the whole solar plane is tipped away from the viewer
const W0 = 0.9;          // Earth's angular speed at speed factor 1 (rad/s); the rest follow from the real orbital periods
const omega = (years) => +(W0 * Math.pow(1 / years, 0.5)).toFixed(3);
// name, orbit radius, size, real period (years), inclination, ascending node, start angle, spin (rad/s, - = backwards)
const P = [
  ['mercury', 0.85, 0.3, 0.241, 7.0, 48, 20, 0.25],
  ['venus', 1.25, 0.46, 0.615, 3.4, 77, 120, -0.2],
  ['earth', 1.7, 0.5, 1, 0, 0, 200, 4],
  ['mars', 2.15, 0.38, 1.881, 1.85, 50, 300, 3.9],
  ['jupiter', 2.95, 1.0, 11.86, 1.3, 100, 60, 9],
  ['saturn', 4.1, 1.9, 29.46, 2.5, 114, 160, 0],
  ['uranus', 5.0, 0.68, 84, 0.77, 74, 250, 0],
  ['neptune', 5.7, 0.66, 164.8, 1.77, 132, 340, 5],
];
// moons: parent, name, orbit radius around the parent, size, angular speed, start angle
const M = [
  ['earth', 'moon', 0.4, 0.14, 3.0, 40],
  ['jupiter', 'io', 0.62, 0.11, 5.0, 10], ['jupiter', 'europa', 0.72, 0.1, 3.5, 100], ['jupiter', 'ganymede', 0.82, 0.15, 2.5, 200], ['jupiter', 'callisto', 0.93, 0.14, 1.7, 290],
  ['saturn', 'titan', 1.3, 0.16, 1.4, 70],
];
const rings = [], segments = [], byName = {};
for (const [name, r, size, yrs, inc, node, angle, spin] of P) {
  const ring = { id: uid('ring'), name: name + ' orbit', radius: r, tilt: +(T0 + inc * Math.cos(node * Math.PI / 180)).toFixed(2), node: +(-inc * Math.sin(node * Math.PI / 180)).toFixed(2), speed: omega(yrs), trail: true, color: '#ffffff' };
  rings.push(ring);
  const seg = { id: uid('seg'), name: name[0].toUpperCase() + name.slice(1), parent: null, length: 0.5, orbit: { ring: ring.id, angle, spin }, attachments: [model(name, size)] };
  segments.push(seg); byName[name] = seg;
}
for (const [parent, name, r, size, w, angle] of M) {
  const ring = { id: uid('ring'), name: name + ' orbit', radius: r, tilt: T0, node: 0, speed: w, trail: false, color: '#ffffff' };
  rings.push(ring);
  segments.push({ id: uid('seg'), name: name[0].toUpperCase() + name.slice(1), parent: byName[parent].id, length: 0.5, orbit: { ring: ring.id, angle, spin: -w }, attachments: [model(name, size)] });
}
const rig = normalizeRig({
  id: 'solarsystem', name: 'Solar system', scale: 24, type: 'orbit',
  orbit: { baseSpeed: 0.7, maxSpeed: 9, sensitivity: 12, sway: 0, trailOpacity: 0.22, sunSpin: 0.15, rings },
  anchor: { offset: [0, 0, 0], attachments: [model('sun', 0.95, { emissive: '#ff9a1f', glow: 2.6 })] },
  segments,
});
fs.writeFileSync(path.join(out, 'solarsystem.json'), JSON.stringify(rig, null, 1));
console.log('wrote solarsystem', rig.segments.length, 'bodies');
