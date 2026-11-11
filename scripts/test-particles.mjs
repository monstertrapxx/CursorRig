// Particle cursorchain checks: node scripts/test-particles.mjs
import fs from 'fs';
import * as THREE from 'three';
import { normalizeRig, createSim, isParticles, newParticleRig, checkRig } from '../src/lib/rig-core.js';

let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
for (const id of ['blossom', 'feathers']) {
  const raw = JSON.parse(fs.readFileSync(new URL(`../default-rigs/${id}.json`, import.meta.url)));
  const rig = normalizeRig(raw);
  ok(isParticles(rig) && rig.particles.max > 0, `${id} loads as a particle rig`);
  ok(JSON.stringify(normalizeRig(rig)) === JSON.stringify(rig), `${id}: normalizing twice changes nothing`);
  ok(checkRig(rig).length === 0, `${id}: Rig Check has nothing to say`);
  const sim = createSim(rig);
  const c = new THREE.Vector3();
  sim.reset(c);
  for (let i = 0; i < 180; i++) sim.step(1 / 60, c);
  const idle = sim.parts.filter((p) => p.on).length;
  ok(idle > 0 && idle <= rig.particles.max, `${id}: emits while the cursor is still (${idle} alive)`);
  sim.reset(c);
  for (let i = 0; i < 180; i++) { c.x += 0.5; sim.step(1 / 60, c); }
  const fast = sim.parts.filter((p) => p.on).length;
  ok(fast > idle, `${id}: emits more when the cursor moves fast (${fast} vs ${idle})`);
  const lowest = Math.min(...sim.parts.filter((p) => p.on).map((p) => p.pos.y));
  ok(lowest < c.y, `${id}: particles fall below the cursor`);
  ok(sim.parts.every((p) => Number.isFinite(p.pos.x + p.pos.y + p.pos.z)), `${id}: no NaN positions`);
}
const fp = newParticleRig('x', 'feathers').particles;
ok(fp.cursorTrail.on === true && fp.trail.on === false, 'feathers: the red trail follows the cursor, not each feather');
process.exit(bad ? 1 : 0);
