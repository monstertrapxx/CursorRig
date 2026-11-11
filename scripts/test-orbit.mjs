// Orbit rig checks: node scripts/test-orbit.mjs
import fs from 'fs';
import * as THREE from 'three';
import { normalizeRig, createSim, isOrbit } from '../src/lib/rig-core.js';

const rig = normalizeRig(JSON.parse(fs.readFileSync(new URL('../default-rigs/solarsystem.json', import.meta.url))));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
ok(isOrbit(rig) && rig.orbit.rings.length === 14 && rig.segments.length === 14, 'solar system loads (8 planets + 6 moons)');
ok(JSON.stringify(normalizeRig(rig)) === JSON.stringify(rig), 'normalizing twice changes nothing');
ok(rig.segments.every((s) => s.orbit && s.attachments.length), 'every planet has orbit data and a body');

const swayAsShipped = rig.orbit.sway;
const sim = createSim(rig);
const earth = sim.index.get(rig.segments.find((s) => s.name === 'Earth').id);
const c = new THREE.Vector3(3, -2, 0);
sim.reset(c);
const R = rig.orbit.rings[rig.segments.findIndex((x) => x.name === 'Earth')].radius;
const dist = () => sim.pos[earth].distanceTo(sim.pos[0]);
ok(Math.abs(dist() - R) < 1e-6, 'Earth sits on its orbit radius from the cursor');
const run = (sec, move) => { const a0 = sim.ang[earth]; for (let i = 0; i < sec * 60; i++) { if (move) c.x += move / 60; sim.step(1 / 60, c); } return sim.ang[earth] - a0; };
const idle = run(2, 0);
ok(Math.abs(dist() - R) < 1e-6, 'radius holds while orbiting');
const fast = run(2, 40);   // cursor sweeping at 40 units / second
ok(fast > idle * 8, `fast cursor orbits much faster (idle ${idle.toFixed(2)} rad / 2s, fast ${fast.toFixed(2)} rad / 2s)`);
ok(sim.factor > rig.orbit.maxSpeed * 0.8, 'speed factor reaches near the max');
run(8, 0);
const settled = sim.factor;
ok(settled < rig.orbit.baseSpeed * 1.5, `speed eases back down when the cursor stops (factor ${settled.toFixed(2)})`);
const p = sim.pos[earth].clone(); sim.step(1 / 60, c);
ok(sim.pos[earth].distanceTo(p) < 0.05, 'no sudden jumps when slow');
const before = c.clone(); sim.reset(new THREE.Vector3(50, 50, 0)); sim.step(1 / 60, new THREE.Vector3(50, 50, 0));
ok(sim.factor < rig.orbit.baseSpeed * 1.2, 'reset does not cause a speed spike');

// rings drift in angle (sway) but never change the planet's distance from the cursor
rig.orbit.sway = 0.7;   // turn wobble on for this check
const a0 = sim.dyn.get(rig.orbit.rings[2].id).tilt; run(3, 20);
ok(Math.abs(sim.dyn.get(rig.orbit.rings[2].id).tilt - a0) > 1, 'ring angles drift over time');
ok(Math.abs(dist() - R) < 1e-6, 'radius still holds with drifting angles');

// moons really circle their planet
const moon = sim.index.get(rig.segments.find((x) => x.name === 'Moon').id);
const mr = rig.orbit.rings.find((r) => r.id === rig.segments.find((x) => x.name === 'Moon').orbit.ring).radius;
ok(Math.abs(sim.pos[moon].distanceTo(sim.pos[earth]) - mr) < 1e-6, 'the Moon stays at its orbit radius from Earth');
ok(Math.abs(swayAsShipped) < 1e-9, 'the realistic solar system keeps fixed orbits (no wobble)');
process.exit(bad ? 1 : 0);
