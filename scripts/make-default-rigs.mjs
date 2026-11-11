import * as THREE from 'three';
// Generates the sample rigs shipped in default-rigs/. Run: node scripts/make-default-rigs.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeRig, eulerDegToQuat } from '../src/lib/rig-core.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'default-rigs');
fs.mkdirSync(out, { recursive: true });
let n = 0;
const id = (p) => `${p}_${(++n).toString(36)}`;
const r3 = (v) => Math.round(v * 1000) / 1000;
const q = (x, y, z) => eulerDegToQuat([x, y, z]).toArray().map((v) => Math.round(v * 1e5) / 1e5);
const part = (shape, o) => ({ id: id('att'), kind: 'primitive', shape, name: o.name || shape, ...o });

function write(rig) {
  const r = normalizeRig(rig);
  fs.writeFileSync(path.join(out, r.id + '.json'), JSON.stringify(r, null, 1));
  console.log('wrote', r.id, r.segments.length, 'segments');
}

// ---- 1. Steel chain
{
  const segs = []; let parent = null; const L = 0.42;
  for (let k = 0; k < 16; k++) {
    const s = { id: id('seg'), name: `link ${k + 1}`, parent, length: L, attachments: [
      part('torus', { name: 'link', position: [0, -L / 2, 0], rotation: [0, k % 2 ? 90 : 0, 0], scale: [L * 0.85, L * 1.5, L * 0.85].map(r3),
        thickness: 0.28, color: '#b9bec7', metalness: 0.9, roughness: 0.28 })] };
    segs.push(s); parent = s.id;
  }
  write({ id: 'chain', name: 'Steel chain', scale: 34, physics: { gravity: 34, damping: 0.015, iterations: 16, substeps: 4 },
    anchor: { attachments: [part('torus', { name: 'hook ring', position: [0, -0.05, 0], scale: [0.36, 0.36, 0.5], thickness: 0.35, color: '#9ea4ad', metalness: 0.9, roughness: 0.3 })] },
    segments: segs });
}

// ---- 2. Rope with lantern
{
  const segs = []; let parent = null; const L = 0.35;
  for (let k = 0; k < 10; k++) {
    const s = { id: id('seg'), name: `rope ${k + 1}`, parent, length: L, mass: 0.4, attachments: [
      part('cylinder', { name: 'rope', position: [0, -L / 2, 0], scale: [0.07, L * 1.05, 0.07].map(r3), color: '#a77b4f', roughness: 0.9, metalness: 0 })] };
    segs.push(s); parent = s.id;
  }
  segs.push({ id: id('seg'), name: 'lantern', parent, length: 0.9, mass: 6, stiffness: 0.6, attachments: [
    part('torus', { name: 'handle', position: [0, -0.12, 0], scale: [0.28, 0.28, 0.28], thickness: 0.18, color: '#2d2a26', metalness: 0.7, roughness: 0.4 }),
    part('cone', { name: 'cap', position: [0, -0.32, 0], scale: [0.55, 0.22, 0.55], color: '#2d2a26', metalness: 0.7, roughness: 0.4 }),
    part('cylinder', { name: 'glass', position: [0, -0.62, 0], scale: [0.38, 0.42, 0.38], color: '#ffcf70', emissive: '#ff9a2e', emissiveIntensity: 1.6, opacity: 0.85, roughness: 0.2 }),
    part('sphere', { name: 'flame', position: [0, -0.62, 0], scale: [0.14, 0.22, 0.14], color: '#fff2c4', emissive: '#ffd27a', emissiveIntensity: 3 }),
    part('cylinder', { name: 'base', position: [0, -0.86, 0], scale: [0.48, 0.08, 0.48], color: '#2d2a26', metalness: 0.7, roughness: 0.4 }),
  ] });
  write({ id: 'lantern', name: 'Rope lantern', scale: 36, physics: { gravity: 30, damping: 0.02, iterations: 14, substeps: 4 }, segments: segs });
}

// ---- 3. Tail (stiff, curls slightly, low-poly)
{
  const segs = []; let parent = null; const N = 12;
  for (let k = 0; k < N; k++) {
    const t = k / (N - 1);
    const L = r3(0.42 - 0.18 * t);
    const w = r3(0.42 - 0.3 * t);
    const s = { id: id('seg'), name: `tail ${k + 1}`, parent, length: L, stiffness: r3(0.45 - 0.2 * t), mass: r3(1.4 - t),
      rest: k === 0 ? q(0, 0, 0) : q(0, 0, 6), attachments: [
        part('sphere', { name: 'fur', position: [0, -L / 2, 0], scale: [w, L * 1.6, w].map(r3), color: k % 3 === 2 ? '#2a2420' : '#e07b39', roughness: 0.85, flatShading: true }),
      ] };
    segs.push(s); parent = s.id;
  }
  segs.push({ id: id('seg'), name: 'tip', parent, length: 0.2, stiffness: 0.2, mass: 0.2, rest: q(0, 0, 6), attachments: [
    part('cone', { name: 'tip', position: [0, -0.12, 0], rotation: [180, 0, 0], scale: [0.18, 0.32, 0.18], color: '#f4efe6', flatShading: true, roughness: 0.85 })] });
  write({ id: 'tail', name: 'Fox tail', scale: 40, physics: { gravity: 24, damping: 0.04, iterations: 12, substeps: 4 }, segments: segs });
}

// ---- 4. Keychain
{
  const ring = { id: id('seg'), name: 'key ring', parent: null, length: 0.5, attachments: [
    part('torus', { name: 'ring', position: [0, -0.25, 0], scale: [0.5, 0.5, 0.5], thickness: 0.08, color: '#c9ccd2', metalness: 1, roughness: 0.25 })] };
  const key1 = { id: id('seg'), name: 'brass key', parent: ring.id, length: 1.1, mass: 2, stiffness: 0.15, rest: q(0, 0, 12), attachments: [
    part('torus', { name: 'bow', position: [0, -0.2, 0], scale: [0.38, 0.38, 0.5], thickness: 0.32, color: '#d4a640', metalness: 0.95, roughness: 0.3 }),
    part('box', { name: 'blade', position: [0, -0.68, 0], scale: [0.09, 0.62, 0.05], color: '#d4a640', metalness: 0.95, roughness: 0.3 }),
    part('box', { name: 'tooth', position: [0.08, -0.82, 0], scale: [0.1, 0.07, 0.05], color: '#d4a640', metalness: 0.95, roughness: 0.3 }),
    part('box', { name: 'tooth', position: [0.07, -0.95, 0], scale: [0.08, 0.06, 0.05], color: '#d4a640', metalness: 0.95, roughness: 0.3 }),
  ] };
  const key2 = { id: id('seg'), name: 'silver key', parent: ring.id, length: 0.95, mass: 1.6, stiffness: 0.15, rest: q(0, 30, -14), attachments: [
    part('box', { name: 'head', position: [0, -0.2, 0], scale: [0.34, 0.3, 0.06], color: '#3d6fd8', roughness: 0.5 }),
    part('box', { name: 'blade', position: [0, -0.62, 0], scale: [0.1, 0.55, 0.04], color: '#d0d4da', metalness: 1, roughness: 0.25 }),
  ] };
  const fob1 = { id: id('seg'), name: 'fob strap', parent: ring.id, length: 0.25, mass: 0.3, rest: q(0, -40, 0), attachments: [
    part('box', { name: 'strap', position: [0, -0.12, 0], scale: [0.08, 0.28, 0.03], color: '#1c1c1f', roughness: 0.9 })] };
  const fob2 = { id: id('seg'), name: 'charm', parent: fob1.id, length: 0.4, mass: 1.2, attachments: [
    part('octahedron', { name: 'gem', position: [0, -0.22, 0], scale: [0.34, 0.44, 0.34], color: '#ff5e7a', metalness: 0.1, roughness: 0.15, flatShading: true, emissive: '#5a0016', emissiveIntensity: 0.6 })] };
  write({ id: 'keychain', name: 'Keychain', scale: 58, physics: { gravity: 30, damping: 0.025, iterations: 12, substeps: 4, flatten: 0.05 },
    anchor: { attachments: [part('torus', { name: 'clip', position: [0, -0.04, 0], scale: [0.22, 0.22, 0.3], thickness: 0.3, color: '#9ea4ad', metalness: 1, roughness: 0.3 })] },
    segments: [ring, key1, key2, fob1, fob2] });
}

// ---- 5. Wind chime (branching mobile)
{
  const top = { id: id('seg'), name: 'cord', parent: null, length: 0.7, mass: 0.5, attachments: [
    part('cylinder', { name: 'cord', position: [0, -0.35, 0], scale: [0.03, 0.7, 0.03], color: '#ddd3c0', roughness: 1 })] };
  const disc = { id: id('seg'), name: 'disc', parent: top.id, length: 0.12, mass: 3, stiffness: 0.9, attachments: [
    part('cylinder', { name: 'disc', position: [0, -0.06, 0], scale: [1.5, 0.08, 1.5], color: '#6b4a2f', roughness: 0.7 })] };
  const segs = [top, disc];
  const colors = ['#9fd6e8', '#c9e89f', '#f2c48d', '#e8a6c9', '#b6aef2'];
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * 360;
    const arm = { id: id('seg'), name: `arm ${k + 1}`, parent: disc.id, length: 0.62, mass: 2.5, stiffness: 0.98, rest: q(0, ang, 90), attachments: [] };
    const str = { id: id('seg'), name: `string ${k + 1}`, parent: arm.id, length: 0.35 + 0.08 * k, mass: 0.15, rest: q(0, 0, -90), attachments: [
      part('cylinder', { name: 'thread', position: [0, -(0.35 + 0.08 * k) / 2, 0], scale: [0.015, 0.35 + 0.08 * k, 0.015].map(r3), color: '#ddd3c0' })] };
    const tl = 0.9 + 0.18 * (4 - k);
    const tube = { id: id('seg'), name: `tube ${k + 1}`, parent: str.id, length: r3(tl), mass: 0.6, attachments: [
      part('cylinder', { name: 'tube', position: [0, r3(-tl / 2), 0], scale: [0.14, r3(tl), 0.14], color: colors[k], metalness: 0.8, roughness: 0.22 })] };
    segs.push(arm, str, tube);
  }
  const clapStr = { id: id('seg'), name: 'clapper string', parent: disc.id, length: 1.1, mass: 0.2, attachments: [
    part('cylinder', { name: 'thread', position: [0, -0.55, 0], scale: [0.015, 1.1, 0.015], color: '#ddd3c0' })] };
  const clapper = { id: id('seg'), name: 'clapper', parent: clapStr.id, length: 0.9, mass: 1, attachments: [
    part('cylinder', { name: 'striker', position: [0, -0.08, 0], scale: [0.6, 0.06, 0.6], color: '#6b4a2f', roughness: 0.7 }),
    part('cylinder', { name: 'thread', position: [0, -0.4, 0], scale: [0.015, 0.6, 0.015], color: '#ddd3c0' }),
    part('box', { name: 'sail', position: [0, -0.74, 0], scale: [0.4, 0.32, 0.02], color: '#e8dcc2', roughness: 0.9 })] };
  segs.push(clapStr, clapper);
  write({ id: 'windchime', name: 'Wind chime', scale: 40, physics: { gravity: 30, damping: 0.03, iterations: 16, substeps: 4, flatten: 0 }, segments: segs });
}

// ---- 6. Yo-yo / bead string (simple, playful)
{
  const segs = []; let parent = null;
  const colors = ['#ff6b5e', '#f2b134', '#7bd88f', '#6ea8ff', '#c792ea'];
  for (let k = 0; k < 9; k++) {
    const L = 0.38;
    const s = { id: id('seg'), name: `bead ${k + 1}`, parent, length: L, mass: 0.8, attachments: [
      part('cylinder', { name: 'thread', position: [0, -L / 2, 0], scale: [0.02, L, 0.02], color: '#eeeeee' }),
      part('sphere', { name: 'bead', position: [0, -L, 0], scale: [0.26, 0.26, 0.26], color: colors[k % colors.length], roughness: 0.25, metalness: 0.1 })] };
    segs.push(s); parent = s.id;
  }
  write({ id: 'beads', name: 'Bead string', scale: 38, physics: { gravity: 32, damping: 0.02, iterations: 12, substeps: 4 }, segments: segs });
}

// ---------------------------------------------------------------- batch 2
const deg = THREE.MathUtils.radToDeg;
const UP = new THREE.Vector3(0, 1, 0);
function pointAlong(d) { // Euler XYZ degrees that turn +Y onto direction d
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), 'XYZ');
  return [deg(e.x), deg(e.y), deg(e.z)].map((v) => Math.round(v * 100) / 100);
}
const v3 = (a) => a.map(r3);

// ---- 7. Chrome flail
{
  const chrome = { color: '#e8ecf2', metalness: 1, roughness: 0.08 };
  const segs = [];
  const handle = { id: id('seg'), name: 'handle', parent: null, length: 1.1, stiffness: 0.96, mass: 4, attachments: [
    part('sphere', { name: 'pommel', position: [0, -0.02, 0], scale: [0.26, 0.26, 0.26], ...chrome }),
    part('cylinder', { name: 'grip', position: [0, -0.5, 0], scale: [0.2, 0.8, 0.2], color: '#2a1d16', roughness: 0.85, metalness: 0 }),
    part('torus', { name: 'grip band', position: [0, -0.22, 0], rotation: [90, 0, 0], scale: [0.25, 0.25, 0.25], thickness: 0.22, ...chrome }),
    part('torus', { name: 'grip band', position: [0, -0.78, 0], rotation: [90, 0, 0], scale: [0.25, 0.25, 0.25], thickness: 0.22, ...chrome }),
    part('cylinder', { name: 'collar', position: [0, -0.98, 0], scale: [0.26, 0.2, 0.26], ...chrome }),
    part('torus', { name: 'eye', position: [0, -1.1, 0], scale: [0.16, 0.22, 0.16], thickness: 0.3, ...chrome }),
  ] };
  segs.push(handle);
  let parent = handle.id; const L = 0.3;
  for (let k = 0; k < 9; k++) {
    const s = { id: id('seg'), name: `link ${k + 1}`, parent, length: L, mass: 0.6, attachments: [
      part('torus', { name: 'link', position: [0, -L / 2, 0], rotation: [0, k % 2 ? 0 : 90, 0], scale: v3([L * 0.85, L * 1.5, L * 0.85]), thickness: 0.28, ...chrome })] };
    segs.push(s); parent = s.id;
  }
  const R = 0.42, C = -0.62;
  const ball = { id: id('seg'), name: 'spike ball', parent, length: 1.05, mass: 9, attachments: [
    part('torus', { name: 'ring', position: [0, -0.06, 0], scale: [0.18, 0.24, 0.18], thickness: 0.3, ...chrome }),
    part('cylinder', { name: 'boss', position: [0, -0.2, 0], scale: [0.16, 0.12, 0.16], ...chrome }),
    part('sphere', { name: 'ball', position: [0, C, 0], scale: [R * 2, R * 2, R * 2], ...chrome }),
  ] };
  // big spikes on the 12 icosahedron vertices, small ones on the 20 face centres
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.attributes.position;
  const verts = new Map(), faces = [];
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, i + j));
    tri.forEach((p) => verts.set(p.toArray().map((x) => x.toFixed(3)).join(), p));
    faces.push(tri[0].clone().add(tri[1]).add(tri[2]).normalize());
  }
  const spike = (d, h, w, name) => {
    const n = d.clone().normalize();
    const c = n.clone().multiplyScalar(R + h / 2 - 0.04).add(new THREE.Vector3(0, C, 0));
    ball.attachments.push(part('cone', { name, position: v3(c.toArray()), rotation: pointAlong(n), scale: v3([w, h, w]), ...chrome, roughness: 0.12 }));
  };
  // skip the vertex pointing straight up into the chain
  [...verts.values()].filter((v) => v.clone().normalize().y < 0.9).forEach((v) => spike(v, 0.42, 0.16, 'spike'));
  faces.filter((f) => f.y < 0.9).forEach((f) => spike(f, 0.24, 0.1, 'small spike'));
  segs.push(ball);
  write({ id: 'flail', name: 'Chrome flail', scale: 30, physics: { gravity: 36, damping: 0.012, iterations: 18, substeps: 5, flatten: 0.15 }, segments: segs });
}

// ---- 8. Wooden ragdoll (artist's mannequin), hung by a string, limp limbs
{
  const wood = { color: '#c99a66', roughness: 0.6, metalness: 0 };
  const joint = { color: '#9a6b3e', roughness: 0.55, metalness: 0 };
  const segs = [];
  const add = (s) => { s.id = id('seg'); segs.push(s); return s.id; };
  const limb = (name, L, d) => part('capsule', { name, position: [0, r3(-L / 2), 0], scale: v3([d * 2, L, d * 2]), ...wood });
  const ball = (name, y, s) => part('sphere', { name, position: [0, y, 0], scale: [s, s, s], ...joint });

  const str = add({ name: 'string', parent: null, length: 0.7, mass: 0.2, attachments: [
    part('cylinder', { name: 'string', position: [0, -0.35, 0], scale: [0.025, 0.7, 0.025], color: '#efe6d2', roughness: 1 })] });
  const head = add({ name: 'head', parent: str, length: 0.62, mass: 1.5, attachments: [
    part('torus', { name: 'eyelet', position: [0, -0.02, 0], scale: [0.1, 0.12, 0.1], thickness: 0.3, color: '#9aa0a8', metalness: 1, roughness: 0.3 }),
    part('sphere', { name: 'head', position: [0, -0.32, 0], scale: [0.46, 0.56, 0.48], ...wood })] });
  const neck = add({ name: 'neck', parent: head, length: 0.16, stiffness: 0.85, mass: 1.5, attachments: [
    part('cylinder', { name: 'neck', position: [0, -0.06, 0], scale: [0.12, 0.2, 0.12], ...wood })] });
  const chest = add({ name: 'chest', parent: neck, length: 0.62, stiffness: 0.85, mass: 3, attachments: [
    part('sphere', { name: 'chest', position: [0, -0.26, 0], scale: [0.72, 0.62, 0.38], ...wood })] });
  const pelvis = add({ name: 'pelvis', parent: chest, length: 0.36, stiffness: 0.7, mass: 2.5, attachments: [
    ball('waist', -0.02, 0.26),
    part('sphere', { name: 'hips', position: [0, -0.22, 0], scale: [0.56, 0.36, 0.34], ...wood })] });

  for (const [side, sgn] of [['left', 1], ['right', -1]]) {
    const sh = add({ name: `${side} shoulder`, parent: neck, length: 0.36, stiffness: 0.98, mass: 4, rest: q(0, 0, 90 * sgn), attachments: [
      ball('shoulder', -0.36, 0.2)] });
    const up = add({ name: `${side} upper arm`, parent: sh, length: 0.5, mass: 0.6, rest: q(0, 0, -90 * sgn), attachments: [limb('upper arm', 0.5, 0.08)] });
    const fo = add({ name: `${side} forearm`, parent: up, length: 0.46, mass: 0.5, attachments: [ball('elbow', 0, 0.15), limb('forearm', 0.46, 0.07)] });
    add({ name: `${side} hand`, parent: fo, length: 0.2, mass: 0.3, attachments: [ball('wrist', 0, 0.11),
      part('sphere', { name: 'hand', position: [0, -0.12, 0], scale: [0.12, 0.24, 0.17], ...wood })] });

    const hip = add({ name: `${side} hip`, parent: pelvis, length: 0.16, stiffness: 0.98, mass: 4, rest: q(0, 0, 90 * sgn), attachments: [] });
    const th = add({ name: `${side} thigh`, parent: hip, length: 0.62, mass: 1, rest: q(0, 0, -90 * sgn), attachments: [ball('hip', 0, 0.2), limb('thigh', 0.62, 0.1)] });
    const sh2 = add({ name: `${side} shin`, parent: th, length: 0.58, mass: 0.8, attachments: [ball('knee', 0, 0.17), limb('shin', 0.58, 0.085)] });
    add({ name: `${side} foot`, parent: sh2, length: 0.12, mass: 0.4, stiffness: 0.6, attachments: [ball('ankle', 0, 0.13),
      part('sphere', { name: 'foot', position: [0, -0.06, 0.08], scale: [0.16, 0.12, 0.34], ...wood })] });
  }
  write({ id: 'ragdoll', name: 'Wooden ragdoll', scale: 34, physics: { gravity: 30, damping: 0.03, iterations: 18, substeps: 5, flatten: 0.3 }, segments: segs });
}

// ---- 9. Tabby cat keychain (original plush charm)
{
  const steel = { color: '#c9ccd2', metalness: 1, roughness: 0.2 };
  const fur = { color: '#7e7d86', roughness: 0.95, metalness: 0 };
  const stripe = { color: '#3e3d45', roughness: 0.95, metalness: 0 };
  const cream = { color: '#e6dccb', roughness: 0.95, metalness: 0 };
  const pink = { color: '#f2a2b4', roughness: 0.8, metalness: 0 };
  const black = { color: '#141416', roughness: 0.2, metalness: 0 };
  const segs = [];
  const add = (s) => { s.id = id('seg'); segs.push(s); return s.id; };

  const ring = add({ name: 'key ring', parent: null, length: 0.4, mass: 0.6, attachments: [
    part('torus', { name: 'split ring', position: [0, -0.2, 0], scale: [0.4, 0.4, 0.4], thickness: 0.09, ...steel })] });
  let parent = ring;
  for (let k = 0; k < 3; k++) {
    parent = add({ name: `link ${k + 1}`, parent, length: 0.14, mass: 0.2, attachments: [
      part('torus', { name: 'link', position: [0, -0.07, 0], rotation: [0, k % 2 ? 0 : 90, 0], scale: [0.11, 0.2, 0.11], thickness: 0.3, ...steel })] });
  }
  const cat = add({ name: 'cat', parent, length: 1.18, mass: 4, attachments: [
    part('torus', { name: 'loop', position: [0, -0.04, 0], scale: [0.1, 0.13, 0.1], thickness: 0.35, ...steel }),
    // head
    part('sphere', { name: 'head', position: [0, -0.36, 0], scale: [0.68, 0.54, 0.5], ...fur }),
    part('cone', { name: 'ear', position: [0.21, -0.12, 0], rotation: [0, 0, -18], scale: [0.2, 0.22, 0.12], ...fur }),
    part('cone', { name: 'ear', position: [-0.21, -0.12, 0], rotation: [0, 0, 18], scale: [0.2, 0.22, 0.12], ...fur }),
    part('cone', { name: 'inner ear', position: [0.2, -0.14, 0.04], rotation: [0, 0, -18], scale: [0.11, 0.14, 0.04], ...pink }),
    part('cone', { name: 'inner ear', position: [-0.2, -0.14, 0.04], rotation: [0, 0, 18], scale: [0.11, 0.14, 0.04], ...pink }),
    part('box', { name: 'forehead stripe', position: [0, -0.16, 0.18], rotation: [-30, 0, 0], scale: [0.05, 0.12, 0.03], ...stripe }),
    part('box', { name: 'forehead stripe', position: [0.09, -0.17, 0.17], rotation: [-30, 0, -12], scale: [0.04, 0.1, 0.03], ...stripe }),
    part('box', { name: 'forehead stripe', position: [-0.09, -0.17, 0.17], rotation: [-30, 0, 12], scale: [0.04, 0.1, 0.03], ...stripe }),
    part('sphere', { name: 'muzzle', position: [0, -0.45, 0.19], scale: [0.26, 0.17, 0.14], ...cream }),
    part('sphere', { name: 'eye', position: [0.13, -0.33, 0.21], scale: [0.09, 0.11, 0.06], ...black }),
    part('sphere', { name: 'eye', position: [-0.13, -0.33, 0.21], scale: [0.09, 0.11, 0.06], ...black }),
    part('sphere', { name: 'eye shine', position: [0.145, -0.31, 0.24], scale: [0.03, 0.03, 0.02], color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6 }),
    part('sphere', { name: 'eye shine', position: [-0.115, -0.31, 0.24], scale: [0.03, 0.03, 0.02], color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6 }),
    part('sphere', { name: 'nose', position: [0, -0.41, 0.26], scale: [0.06, 0.04, 0.04], ...pink }),
    // body
    part('sphere', { name: 'body', position: [0, -0.84, -0.02], scale: [0.54, 0.6, 0.46], ...fur }),
    part('sphere', { name: 'belly', position: [0, -0.86, 0.13], scale: [0.32, 0.4, 0.2], ...cream }),
    part('torus', { name: 'body stripe', position: [0, -0.7, -0.02], rotation: [90, 0, 0], scale: [0.5, 0.42, 0.5], thickness: 0.06, ...stripe }),
    part('torus', { name: 'body stripe', position: [0, -0.82, -0.02], rotation: [90, 0, 0], scale: [0.55, 0.46, 0.5], thickness: 0.06, ...stripe }),
    part('torus', { name: 'body stripe', position: [0, -0.94, -0.02], rotation: [90, 0, 0], scale: [0.5, 0.42, 0.5], thickness: 0.06, ...stripe }),
    part('sphere', { name: 'paw', position: [0.12, -0.74, 0.2], scale: [0.13, 0.11, 0.12], ...cream }),
    part('sphere', { name: 'paw', position: [-0.12, -0.74, 0.2], scale: [0.13, 0.11, 0.12], ...cream }),
    part('sphere', { name: 'foot', position: [0.15, -1.1, 0.1], scale: [0.16, 0.12, 0.2], ...cream }),
    part('sphere', { name: 'foot', position: [-0.15, -1.1, 0.1], scale: [0.16, 0.12, 0.2], ...cream }),
  ] });
  // curly tail from the bottom
  let t = cat;
  const curl = [100, 30, 30, 35, 40];
  curl.forEach((a, k) => {
    const L = r3(0.17 - k * 0.012);
    t = add({ name: `tail ${k + 1}`, parent: t, length: L, stiffness: 0.55, mass: 0.15, rest: q(0, 0, a), attachments: [
      part('sphere', { name: 'tail', position: [0, r3(-L / 2), 0], scale: v3([0.13 - k * 0.012, L * 1.6, 0.13 - k * 0.012]), ...(k % 2 ? stripe : fur) })] });
  });
  write({ id: 'catkeychain', name: 'Tabby cat keychain', scale: 46, physics: { gravity: 30, damping: 0.025, iterations: 14, substeps: 4, flatten: 0.2 }, segments: segs });
}
