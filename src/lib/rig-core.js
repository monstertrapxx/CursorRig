// Shared rig data model, physics and rendering.
// Used by both the desktop overlay and the editor.
//
// Coordinate system: rig units, Y up. A segment's local frame starts at its
// parent joint and the segment extends along local -Y for `length` units.
import * as THREE from 'three';
import { IMPACT_KEYS } from '../shared/impact-styles.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const FORMAT = 'cursor-rig';
export const VERSION = 1;
export const SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'ring', 'octahedron', 'star'];   // 'star' is new: older versions show it as a sphere
export const MODEL_EXTS = ['glb', 'gltf', 'obj', 'stl'];
export const FEEL_KEYS = ['scale', 'gravity', 'damping', 'opacity', 'windStrength', 'wind', 'floor', 'walls', 'orbitTilt', 'orbitRoll', 'orbitSpeed', 'orbitSize', 'orbitDir', 'orbitReal', 'impactOn', 'impactStyle', 'impactAmount', 'ringSize', 'ceiling', 'spinAllow', 'anatomy', 'linkSize'];   // the last four only matter to orbit chains
const FEEL_BOOL = ['wind', 'floor', 'walls', 'orbitReal', 'impactOn', 'ceiling'];
const FEEL_STR = { impactStyle: IMPACT_KEYS };
export function normalizeFeel(f) {
  const out = {};
  if (!f || typeof f !== 'object') return out;
  for (const k of FEEL_KEYS) {
    if (FEEL_STR[k] ? FEEL_STR[k].includes(f[k]) : FEEL_BOOL.includes(k) ? typeof f[k] === 'boolean' : Number.isFinite(f[k])) out[k] = f[k];
  }
  return out;
}

export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);
const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- data model

export function newAttachment(shape = 'sphere', o = {}) {
  return normalizeAttachment({ id: uid('att'), kind: 'primitive', shape, name: shape, ...o });
}

export function newSegment(parent = null, o = {}) {
  return normalizeSegment({ id: uid('seg'), parent, ...o });
}

export function newRig(name = 'New rig') {
  const rig = normalizeRig({ id: uid('rig'), name, segments: [], physics: { depthSway: 1.5 } });
  let parent = null;
  for (let i = 0; i < 6; i++) {
    const s = newSegment(parent, { name: 'seg ' + (i + 1), length: 0.6 });
    s.attachments.push(newAttachment('sphere', { position: [0, -0.6, 0], scale: [0.25, 0.25, 0.25], color: '#d9a441' }));
    rig.segments.push(s);
    parent = s.id;
  }
  return rig;
}

export const IMG_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;   // a picture uploaded by the user lives inside the rig as one of these
const goodImg = (v) => typeof v === 'string' && v.length < 700000 && IMG_RE.test(v);

export function normalizeAttachment(a) {
  return {
    id: a.id || uid('att'),
    name: a.name ?? (a.shape || 'part'),
    kind: a.kind === 'model' ? 'model' : 'primitive',
    shape: SHAPES.includes(a.shape) ? a.shape : 'sphere',
    model: a.model || null,
    fit: a.fit !== false,
    hitScale: a.hitScale > 0 ? Math.min(2, +a.hitScale) : 1,   // shrinks (or grows) this part's collision box: 1 = the model's own box
    useColor: a.kind === 'model' ? !!a.useColor : true,
    color: a.color || '#c8c8c8',
    metalness: a.metalness ?? 0.2,
    roughness: a.roughness ?? 0.5,
    opacity: a.opacity ?? 1,
    emissive: a.emissive || '#000000',
    emissiveIntensity: a.emissiveIntensity ?? 0,
    flatShading: !!a.flatShading,
    thickness: a.thickness ?? 0.3, // torus / ring tube thickness ratio
    position: a.position ? [...a.position] : [0, 0, 0],
    rotation: a.rotation ? [...a.rotation] : [0, 0, 0], // degrees, XYZ
    scale: a.scale ? [...a.scale] : [0.3, 0.3, 0.3],
    visible: a.visible !== false,
    ...(goodImg(a.image) ? { image: a.image } : {}),     // custom PNG: drawn as a flat picture that always faces the screen
    ...(a.noSpin ? { noSpin: true } : {}),             // never auto-spin this part (ragdoll limbs)
    ...(a.skin ? { skin: a.skin } : {}),               // skinned ragdoll: { bones: { segmentId: [x,y,z,w] } } - the model's bones follow those segments
    ...(a.spin ? { spin: a.spin } : {}),             // optional idle twist about the string (deg/s)
    ...(a.spinDrive ? { spinDrive: a.spinDrive } : {}), // extra twist that follows how fast the part moves sideways
    ...(a.glow > 0 ? { glow: a.glow } : {}), // optional soft halo, as a multiple of the part's size
  };
}

// Chain links packed on top of each other (spacing under a quarter of the link's own length, which the editor's old "add link" could produce) make the physics shake wildly, so such a link gets normal spacing.
function linkSpacing(s) {
  const len = s.length ?? 0.5;
  if (!/^link\b/i.test(String(s.name || ''))) return len;
  const at = s.attachments || [];
  if (at.length !== 1 || at[0].kind === 'model' || !Array.isArray(at[0].scale)) return len;
  const size = Math.max(...at[0].scale);
  return size > 0 && len / size < 0.25 ? Math.round(0.59 * size * 1e4) / 1e4 : len;
}
export function normalizeSegment(s) {
  return {
    id: s.id || uid('seg'),
    name: s.name || 'segment',
    parent: s.parent ?? null,
    length: linkSpacing(s),
    rest: s.rest ? [...s.rest] : [0, 0, 0, 1], // quaternion relative to parent frame
    stiffness: s.stiffness ?? 0,
    ...(s.limit > 0 ? { limit: Math.min(180, s.limit) } : {}),   // optional: most degrees this segment may bend away from its rest direction (ragdoll joints)
    mass: s.mass ?? 1,
    ...(s.bend && Array.isArray(s.bend.dir) ? { bend: { dir: s.bend.dir.slice(0, 3).map(Number), strength: Number(s.bend.strength ?? 0.5), relax: Number(s.bend.relax ?? 0) } } : {}),   // optional per-joint bend preference (the way a finger/elbow/knee folds)
    ...(s.radius > 0 ? { radius: s.radius } : {}),
    ...(s.sink > 0 ? { sink: s.sink } : {}),   // ragdoll root: the string attaches this far further down into the body (raises the body toward the chain)   // optional: collision radius, so ragdoll limbs push each other apart instead of clipping
    attachments: (s.attachments || []).map(normalizeAttachment),
    ...(s.orbit ? { orbit: { ring: s.orbit.ring ?? null, angle: s.orbit.angle ?? 0, spin: s.orbit.spin ?? 1.5,
      ...(s.orbit.trail ? { trail: normalizeTrail(s.orbit.trail) } : {}) } } : {}),
  };
}

export function normalizeRig(r) {
  const p = r.physics || {};
  return {
    format: FORMAT,
    version: VERSION,
    id: r.id || uid('rig'),
    name: r.name || 'Untitled rig',
    scale: r.scale ?? 40, // screen pixels per rig unit
    physics: {
      gravity: p.gravity ?? 30,
      damping: p.damping ?? 0.025,   // defaults match the Kuma/Kurimu keychain
      iterations: p.iterations ?? 14,
      substeps: p.substeps ?? 4,
      flatten: p.flatten ?? 0, // pull toward the cursor's depth plane (0 = free 3D swing)
      depthSway: p.depthSway ?? 1.5, // in-and-out drift when the cursor moves fast (0 = off); on at its maximum unless the rig says otherwise
      ...(p.relDamp > 0 ? { relDamp: Math.min(0.95, +p.relDamp) } : {}),   // see step(): damps only the motion between joints
      ...(p.lightDrag > 0 ? { lightDrag: Math.min(0.5, +p.lightDrag) } : {}),   // see step(): extra drag for light pieces only
      ...(p.yaw ? { yaw: true } : {}), // game-style ragdolls: the whole body can turn freely about the string (set by the ragdoll builder)
    },
    anchor: {
      offset: r.anchor?.offset ? [...r.anchor.offset] : [0, 0, 0],
      attachments: (r.anchor?.attachments || []).map(normalizeAttachment),
    },
    segments: (r.segments || []).map(normalizeSegment),
    ...(r.feel && Object.keys(normalizeFeel(r.feel)).length ? { feel: normalizeFeel(r.feel) } : {}),
    ...(r.impact && typeof r.impact === 'object' ? { impact: { on: !!r.impact.on, style: IMPACT_KEYS.includes(r.impact.style) ? r.impact.style : 'wood' } } : {}),   // this chain's own default for the impact particles (the menu can override it)
    ...(r.hang && (Number.isFinite(r.hang.x) || Number.isFinite(r.hang.y)) && (r.hang.x || r.hang.y) ? { hang: { x: Math.max(-300, Math.min(300, Math.round(+r.hang.x || 0))), y: Math.max(-300, Math.min(300, Math.round(+r.hang.y || 0))) } } : {}),   // this item's own centring offset (screen px), added to the global hang point
    ...(r.type === 'orbit' ? { type: 'orbit', orbit: normalizeOrbit(r.orbit) } : {}),
    ...(r.type === 'particles' ? { type: 'particles', particles: normalizeParticles(r.particles) } : {}),
  };
}

// Parents before children; segments whose parent is missing hang from the anchor.
export function orderSegments(rig) {
  const byId = new Map(rig.segments.map((s) => [s.id, s]));
  const kids = new Map();
  for (const s of rig.segments) {
    const p = s.parent && byId.has(s.parent) && s.parent !== s.id ? s.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(s);
  }
  const out = [];
  const seen = new Set();
  const visit = (pid) => {
    for (const s of kids.get(pid) || []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      visit(s.id);
    }
  };
  visit(null);
  return out; // cycles are dropped
}

export function descendants(rig, segId) {
  const out = [];
  const walk = (id) => {
    for (const s of rig.segments) if (s.parent === id) { out.push(s); walk(s.id); }
  };
  walk(segId);
  return out;
}

export function eulerDegToQuat(e) {
  const r = THREE.MathUtils.degToRad;
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r(e[0]), r(e[1]), r(e[2]), 'XYZ'));
}
export function quatToEulerDeg(q) {
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...q), 'XYZ');
  const d = THREE.MathUtils.radToDeg;
  return [d(e.x), d(e.y), d(e.z)].map((v) => Math.round(v * 100) / 100);
}

// ------------------------------------------------------------------- physics

export const DEFAULT_SPIN = 0;   // no automatic spin by default; models still turn when the cursor moves (spinDrive). The "Automatic spin" slider adds a constant slow turn.
const _tc = new THREE.Vector3(), _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _td = new THREE.Vector3(), _tq = new THREE.Quaternion();
// An oriented hit box for one attachment: centre and base rotation in the segment frame, half sizes in rig units.
// `size` is the part's size before its own scale (a unit cube for primitives, the fitted model otherwise).
// A model's real collision shape: the outline of its mesh as it turns about its own up axis (the model spins), as a short list of (distance from the axis, height) corners.
// Built from the actual vertices, so a lumpy rock collides like the rock it looks like instead of like the big box around it.
export function meshProfile(root) {
  const pts = [], v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pa = o.geometry.attributes.position;
    for (let k = 0; k < pa.count; k++) { v.fromBufferAttribute(pa, k).applyMatrix4(o.matrixWorld); pts.push([v.x, v.y, v.z]); }
  });
  return pts;
}
function profileFrom(pts, c, s) {      // pts in model space; c = centre of its box, s = fit scale: gives the outline in the part's own unit-sized space
  if (!pts.length) return null;
  const P = pts.map(([x, y, z]) => [Math.hypot((x - c.x) * s, (z - c.z) * s), (y - c.y) * s]);
  // outline of the (distance, height) cloud: lower and upper hull, each distance mirrored so the axis side closes it
  const all = P.concat(P.map(([r, y]) => [-r, y])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of all) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = all.length - 1; i >= 0; i--) { const p = all[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1)).filter((p) => p[0] >= -1e-6);
  const out = []; for (const p of hull) if (!out.some((q) => Math.abs(q[0] - p[0]) < 1e-4 && Math.abs(q[1] - p[1]) < 1e-4)) out.push([Math.max(0, p[0]), p[1]]);
  return out.length ? out : null;
}
export { profileFrom as _profileFrom };
function makeHullHit(a, prof) {
  const sc = a.scale || [1, 1, 1], hsc = a.hitScale > 0 ? a.hitScale : 1;
  const rs = Math.max(Math.abs(sc[0]), Math.abs(sc[2])) * hsc, ys = Math.abs(sc[1]) * hsc;
  const r = THREE.MathUtils.degToRad, rot = a.rotation || [0, 0, 0];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r(rot[0]), r(rot[1]), r(rot[2]), 'XYZ'));
  const c = new THREE.Vector3().fromArray(a.position || [0, 0, 0]);
  const pts = [];
  for (const [rad, y] of prof) {
    const turns = rad < 1e-4 ? 1 : 8;     // it turns about its up axis, so each corner stands for a whole ring of points
    for (let k = 0; k < turns; k++) { const t = k * Math.PI / 4; pts.push(new THREE.Vector3(Math.cos(t) * rad * rs, y * ys, Math.sin(t) * rad * rs).applyQuaternion(q).add(c)); }
  }
  return { pts };
}
function makeHit(a, size) {
  const sc = a.scale || [1, 1, 1];
  let hx = 0.5 * size[0] * Math.abs(sc[0]) * 0.9, hy = 0.5 * size[1] * Math.abs(sc[1]) * 0.9, hz = 0.5 * size[2] * Math.abs(sc[2]) * 0.9;
  if (!a.noSpin && (a.spin || a.spinDrive || a.kind === 'model')) { hx = hz = Math.hypot(hx, hz); }
  { const hsc = a.hitScale > 0 ? a.hitScale : 1; hx *= hsc; hy *= hsc; hz *= hsc; }   // it turns about its own up axis: use the box that covers every turn
  const r = THREE.MathUtils.degToRad, rot = a.rotation || [0, 0, 0];
  return {
    c: new THREE.Vector3().fromArray(a.position || [0, 0, 0]),
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r(rot[0]), r(rot[1]), r(rot[2]), 'XYZ')),
    h: new THREE.Vector3(hx, hy, hz),
  };
}


const SPAWN_Q = [   // how the old Kuma keychain was tilted: ring, first link, and the charm / body at the end of the chain
  new THREE.Quaternion(0.48404, -0.00312, -0.02558, 0.87467).normalize(),
  new THREE.Quaternion(0.07421, 0, 0, 0.99724).normalize(),
  new THREE.Quaternion(0.1297, -0.00037, -0.06508, 0.98941).normalize(),
];

// Turning from the way a part hangs (pd) to the way it points (d). When it points back almost the opposite way (a long body shoved up by the floor) the shortest turn has no single
// axis and flipped about a different axis almost every frame, which made the part spin wildly. So in that case it turns half way round about the axis it was already using, then the small rest.
function stableArc(sim, i, pd, d, qa) {
  const fax = (sim._fax ||= [])[i] ||= new THREE.Vector3(0, 0, 1);
  const dot = Math.max(-1, Math.min(1, pd.dot(d)));
  if (dot < -0.9) {
    _fc.copy(fax).addScaledVector(pd, -fax.dot(pd));
    if (_fc.lengthSq() < 1e-6) { _fc.crossVectors(pd, _fx); if (_fc.lengthSq() < 1e-6) _fc.crossVectors(pd, _fy); }
    fax.copy(_fc.normalize());
    _fq.setFromAxisAngle(fax, Math.PI); _fp.copy(pd).negate(); qa.setFromUnitVectors(_fp, d).multiply(_fq);
  } else {
    qa.setFromUnitVectors(pd, d);
    _fc.crossVectors(pd, d); const cl = _fc.length();
    if (cl > 1e-4) fax.copy(_fc.divideScalar(cl));
  }
}
const _oq = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _fc = new THREE.Vector3(), _fp = new THREE.Vector3(), _fx = new THREE.Vector3(1, 0, 0), _fy = new THREE.Vector3(0, 1, 0), _fq = new THREE.Quaternion();
export class RigSim {
  constructor(rig) {
    this.setRig(rig);
  }

  setRig(rig) {
    this.rig = rig;
    const segs = (this.segs = orderSegments(rig));
    const n = segs.length + 1;
    this.n = n;
    this.index = new Map();
    segs.forEach((s, k) => this.index.set(s.id, k + 1));
    this.parent = new Int32Array(n);
    this.len = new Float32Array(n);
    this.stiff = new Float32Array(n);
    this.lim = new Float32Array(n);
    this.invMass = new Float32Array(n);
    this.rad = new Float32Array(n);
    this.restQ = [new THREE.Quaternion()];
    this.parent[0] = -1;
    segs.forEach((s, k) => {
      const i = k + 1;
      this.parent[i] = s.parent && this.index.has(s.parent) ? this.index.get(s.parent) : 0;
      this.len[i] = Math.max(0.001, s.length - (s.sink > 0 ? s.sink : 0));
      this.stiff[i] = clamp(s.stiffness, 0, 0.995);
      this.lim[i] = s.limit > 0 ? s.limit * Math.PI / 180 : 0;
      this.invMass[i] = 1 / Math.max(0.01, s.mass);
      this.rad[i] = s.radius > 0 ? s.radius : 0;
      this.restQ.push(new THREE.Quaternion(...s.rest).normalize());
      // Anatomical bend preference (soft): knees fold backwards, elbows and hips lean forwards. A segment can set its own `bend: { dir: [x,y,z], strength }`.
      const nm = String(s.name || '').toLowerCase();
      let bd = null, bs = 0, br = 0;
      const winged = segs.some((x) => /wing/i.test(x.name || ''));
      if (s.bend && Array.isArray(s.bend.dir)) { bd = s.bend.dir; bs = s.bend.strength ?? 0.5; br = s.bend.relax ?? 0; }
      else if (winged) { /* birds: no human-style bend preference */ }
      else if (/shin|calf|lower leg/.test(nm)) { bd = [0, 0, -1]; bs = 0.35; br = 0; }
      else if (/thigh|upper leg/.test(nm)) { bd = [0, 0, 1]; bs = 0.2; br = 0; }
      else if (/forearm|lower arm/.test(nm)) { bd = [0, 0, 1]; bs = 0.3; br = 0; }
      if (bd && bs > 0) { (this.bendDir ||= [])[i] = new THREE.Vector3(...bd).normalize(); (this.bendW ||= new Float32Array(segs.length + 1))[i] = bs; (this.bendT ||= new Float32Array(segs.length + 1))[i] = Math.sin(br * Math.PI / 180); }
    });
    // Which parts may throw impact particles: only body/model parts, never the metal (rings, links) or string.
    // A segment with no parts (ragdoll bones) or any loaded model counts; a segment can force it with `impact: true/false`.
    this._fxOK = new Uint8Array(n);
    segs.forEach((s, k) => {
      const at = s.attachments || [];
      this._fxOK[k + 1] = s.impact === true ? 1 : s.impact === false ? 0 : (!at.length || at.some((a) => a.kind === 'model')) ? 1 : 0;
    });
    // self-collision pairs: capsules (parent point -> own point) that are 3+ joints apart in the tree, so arms and legs cannot pass through the body or each other
    this.colPairs = [];
    // trunk segments (head, chest, torso: 5+ segments hang below them) act as solid walls for the limbs, so a limb touching the body never drags the body itself
    const kids = new Int32Array(n); for (let i = 1; i < n; i++) { let p = this.parent[i]; while (p > 0) { kids[p]++; p = this.parent[p]; } }
    this.heavy = Array.from(kids, (c) => c >= 5);
    const skinnedRig = n > 8 || segs.some((sg) => (sg.attachments || []).some((at) => at.skin)) || !!(rig.physics && rig.physics.yaw);      // (a rig with many parts is a ragdoll or a long chain, not a single hanging object)
    this._keepOK = Uint8Array.from(kids, (c, i) => (i > 0 && c === 0 && !skinnedRig ? 1 : 0));      // only a plain part at the very end of a chain may keep its own twist (never ragdoll / skinned / many-part rigs: their twist has to follow the parent or the mesh wrings up)
    const anc = (i) => { const a = [i]; while (this.parent[a[a.length - 1]] > 0) a.push(this.parent[a[a.length - 1]]); return a; };
    for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (!(this.rad[i] > 0 && this.rad[j] > 0)) continue;
      const ai = anc(i), aj = anc(j); let d = 99;
      for (let x = 0; x < ai.length; x++) { const y = aj.indexOf(ai[x]); if (y >= 0) d = Math.min(d, x + y); }
      if (d >= 3) this.colPairs.push([i, j]);
    }
    // hit boxes: each node carries oriented boxes (in its segment's frame) around its parts, so the floor and
    // the screen sides stop the visible shape, not just the joint. Models add theirs once they have loaded.
    this.hit = Array.from({ length: n }, () => []);
    this.hitModels = new Map();
    segs.forEach((s, k) => (s.attachments || []).forEach((a) => {
      if (a.kind === 'primitive' && a.visible !== false) this.hit[k + 1].push(makeHit(a, [1, 1, 1]));
    }));
    this.pos = Array.from({ length: n }, () => new THREE.Vector3());
    this.prev = Array.from({ length: n }, () => new THREE.Vector3());
    this.rot = Array.from({ length: n }, () => new THREE.Quaternion());
    this._hitFrom = null;
    this._touch = new Uint8Array(n);
    this._reach = 0; this._cum = null; this._bk = null; this._fOK = false; this._lr = null;
    this._ceil = new Uint8Array(n);
    this._wall = new Int8Array(n);                // -1 / +1: pushed back by the left / right screen side this substep
    this._v0 = Array.from({ length: n }, () => new THREE.Vector3());   // each node's speed as it entered the substep (what a hit is judged by)
    this._impCD = new Float64Array(n).fill(-9);
    this.impacts = [];                              // hits on the floor or screen sides during the last step(): { x, y, z, nx, ny, speed, node }
    this.anchorFrom = new THREE.Vector3();
    this._clampTarget = new THREE.Vector3();
    this.t = 0;
    this.reset(this.pos[0].clone());
  }

  // Put every segment in its rest pose hanging from `anchor`.
  // `spawn` = true is only used when a keychain appears on the cursor: it starts out tilted the way the original Kuma keychain used to be saved, so it swings in
  // instead of just appearing. The saved rig itself stays straight (the editor and thumbnails reset without it).
  reset(anchor, spawn = false) {
    this._spawnAt = spawn ? this.t : undefined;
    this._fOK = false; this._bk = null; this._lr = null;
    this.pos[0].copy(anchor);
    this.prev[0].copy(anchor);
    this.anchorFrom.copy(anchor);
    this.rot[0].identity();
    const v = new THREE.Vector3();
    const spine = [];
    if (spawn) {   // the first segment hanging from the anchor, then the first child of each one after it
      let cur = -1;
      for (let i = 1; i < this.n; i++) if (this.parent[i] === 0) { cur = i; break; }
      while (cur > 0) {
        spine.push(cur); let nx = -1;
        for (let j = cur + 1; j < this.n; j++) if (this.parent[j] === cur) { nx = j; break; }
        cur = nx;
      }
    }
    // Spawn pose for every chain: Kuma's angle (about 70 degrees back from hanging straight down), but as ONE straight piece so nothing kinks or tangles on the way in.
    let smooth = null;
    if (spawn) smooth = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 70 * Math.PI / 180);   // every chain starts laid back (away from the screen) at about Kuma's angle, as one straight piece, and swings in
    const spawnQ = (i) => {
      const d = spine.indexOf(i);
      if (d < 0) return null;
      if (smooth) return d === 0 ? smooth : null;
      if (d === 0) return SPAWN_Q[0];
      if (d === 1) return SPAWN_Q[1];
      if (d === Math.min(4, spine.length - 1) && d >= 2) return SPAWN_Q[2];
      return null;
    };
    for (let i = 1; i < this.n; i++) {
      const p = this.parent[i];
      this.rot[i].multiplyQuaternions(this.rot[p], this.restQ[i]);
      if (spawn) { const q = spawnQ(i); if (q) this.rot[i].multiplyQuaternions(this.rot[p], q).multiply(this.restQ[i]); }
      v.copy(DOWN).multiplyScalar(this.len[i]).applyQuaternion(this.rot[i]);
      this.pos[i].copy(this.pos[p]).add(v);
      this.prev[i].copy(this.pos[i]);
    }
  }

  // Called by the view once a model is loaded: `size` is the model's own bounding-box size (unscaled).
  setModelHit(segId, a, size, prof) {
    const i = this.index.get(segId);
    if (!i || this.hitModels.has(a.id)) return;
    const m = Math.max(size[0], size[1], size[2], 1e-6);
    const box = prof && prof.length >= 3 && !a.skin ? makeHullHit(a, prof) : makeHit(a, [size[0] / m, size[1] / m, size[2] / m]);
    this.hitModels.set(a.id, box);
    this.hit[i].push(box);
  }

  // Shift the whole rig without adding velocity (e.g. scale change).
  translate(d) {
    for (let i = 0; i < this.n; i++) { this.pos[i].add(d); this.prev[i].add(d); }
    this.anchorFrom.add(d);
  }

  /**
   * opts: gravityScale, dampingAdd, wind (Vector3, units/s^2), floorY, minX, maxX,
   *       flatten (0..1 pull toward anchor Z plane)
   */
  step(dt, target, opts = {}) {
    this.impacts.length = 0;
    dt = Math.min(Math.max(dt, 0), 1 / 20);
    if (dt === 0) return;
    const ph = this.rig.physics;
    // opts.quality (0.25..1) trades accuracy for speed on slow computers
    const q = clamp(opts.quality ?? 1, 0.25, 1);
    const sub = Math.max(1, Math.round((ph.substeps | 0) * q));
    const iters = Math.max(1, Math.round((ph.iterations | 0) * (0.5 + 0.5 * q)));
    const h = dt / sub;
    const g = ph.gravity * (opts.gravityScale ?? 1);
    const damp = clamp(ph.damping + (opts.dampingAdd ?? 0), 0, 0.99);
    const keep = Math.pow(1 - damp, h * 60);
    const ax = (opts.wind?.x ?? 0), ay = (opts.wind?.y ?? 0) - g, az = (opts.wind?.z ?? 0);
    let flatten = opts.flatten ?? 0;
    // right after spawning the chain is laid back in depth: 'flatten' (pull toward the screen plane) would crush that pose in one frame and make it spaz, so it fades in only once the swing-in is under way
    if (this._spawnAt !== undefined) { const age = this.t - this._spawnAt; if (age < 3) flatten *= Math.max(0, Math.min(1, (age - 1) / 2)); }
    this._anat = opts.anatomy ?? 1;
    const { pos, prev, n, invMass, parent } = this;
    // internal damping: only the speed of a joint RELATIVE to its parent is damped, so jitter dies out without making the whole thing feel like it moves through water
    const relD = clamp(ph.relDamp ?? 0, 0, 0.95), kr = 1 - Math.pow(1 - relD, h * 60);
    if (relD > 0 && !this._vd) this._vd = Array.from({ length: n }, () => new THREE.Vector3());
    const ld = clamp(ph.lightDrag ?? 0, 0, 0.5);   // optional extra air drag on light pieces only (string, links): a heavy end swings freely while its string stays calm and does not fold up
    const v = new THREE.Vector3();
    // Depth sway: a flat chain driven by a flat cursor never leaves the screen plane, so the faster the
    // cursor moves, the more we nudge each joint (out of phase) toward/away from the viewer.
    const sway = ph.depthSway ?? 1.5;
    // ragdoll dolls (physics.yaw) react to much gentler cursor motion, so arms and legs swing front/back like a real doll
    const drive = sway > 0 ? clamp(this.anchorFrom.distanceTo(target) / dt / (ph.yaw ? 2.5 : 12), 0, 1) : 0;
    const bounded = Number.isFinite(opts.floorY) || Number.isFinite(opts.ceilY) || (Number.isFinite(opts.minX) && Number.isFinite(opts.maxX));
    // a cursor that is below the floor (e.g. over the Dock) can't drag the chain through it
    if (Number.isFinite(opts.floorY) && target.y < opts.floorY) target = this._clampTarget.copy(target).setY(opts.floorY);

    for (let s = 0; s < sub; s++) {
      this.t += h;
      pos[0].lerpVectors(this.anchorFrom, target, (s + 1) / sub);
      for (let i = 1; i < n; i++) {
        v.subVectors(pos[i], prev[i]).multiplyScalar(ld > 0 && invMass[i] > 1.2 ? keep * Math.pow(1 - ld, h * 60) : keep);
        if (relD > 0) { const pp = parent[i]; if (pp > 0) { const vp = this._vd[pp]; v.x -= (v.x - vp.x) * kr; v.y -= (v.y - vp.y) * kr; v.z -= (v.z - vp.z) * kr; } this._vd[i].copy(v); }
        if (bounded) this._v0[i].copy(v);
        prev[i].copy(pos[i]);
        pos[i].x += v.x + ax * h * h;
        pos[i].y += v.y + ay * h * h;
        const swayZ = drive > 0 ? (ph.yaw
          ? sway * g * 0.45 * drive * Math.sin(this.t * 2.2 + i * 0.8) * (0.6 + 0.4 * Math.sin(this.t * 1.1 + i * 1.3))   // dolls: limbs swing front/back freely
          : sway * g * 0.5 * drive * Math.sin(this.t * 2.3 + i * 1.7) * Math.sin(this.t * 1.4 + i * 2.9)) : 0;
        pos[i].z += v.z + (az + swayZ * (1 - 0.9 * (this._pile || 0))) * h * h;   // the in-and-out sway is dropped while it lies on the floor
      }
      if (bounded) { this._touch.fill(0); this._wall.fill(0); this._ceil.fill(0); }
      for (let it = 0; it < iters; it++) { this._solve(iters); if (bounded) this._contact(opts, false); }
      if (this.colPairs.length) this._collide(h);
      this._inextensible();
      // Real 3D buckling: a chain pushed down onto the floor is a compressed column, and a column never folds only left or right. It gives way toward or away from the screen too.
      // Pure screen-plane pushing has no sideways-in-depth force at all, so without this a pushed-down chain only ever fell left or right. The direction is picked at random when the pushing
      // starts and then kept (so it never flickers), and it is a gentle lean, strongest at the free end.
      if (Number.isFinite(opts.floorY)) {
        const reach = this._reach ||= (() => { const c = new Float32Array(n); let m = 0; for (let i = 1; i < n; i++) { c[i] = c[parent[i]] + this.len[i]; m = Math.max(m, c[i]); } this._cum = c; return m || 1; })();
        const span = pos[0].y - opts.floorY, comp = clamp((0.9 * reach - span) / (0.9 * reach), 0, 1);
        if (comp > 0.05) { if (!this._bk) this._bk = { z: (Math.random() < 0.5 ? -1 : 1) * (0.55 + 0.45 * Math.random()) }; this._bkOff = 0; }
        else if (this._bk) { this._bkOff = (this._bkOff || 0) + h; if (this._bkOff > 0.6) this._bk = null; }
        if (this._bk && comp > 0) {
          const a = this._bk.z * comp * g * 0.4;
          for (let i = 1; i < n; i++) if (!this._touch[i]) pos[i].z += a * (this._cum[i] / reach) * h * h;
        }
      }
      const flatNow = flatten;
      if (flatNow > 0) {
        const k = 1 - Math.pow(1 - clamp(flatNow, 0, 1), h * 10);
        for (let i = 1; i < n; i++) pos[i].z += (pos[0].z - pos[i].z) * k;
      }
      if (bounded) { this._contact(opts, true); this._noteImpacts(opts, h);
        let pile = false; for (let k = 1; k < n; k++) if (this._touch[k]) { pile = true; break; }
        this._pile = (this._pile || 0) + ((pile ? 1 : 0) - (this._pile || 0)) * Math.min(1, h * 12);
        if (pile) { for (let k = 1; k < n; k++) if (this._touch[k]) prev[k].lerp(pos[k], 0.2); }   // resting on the floor: bleed a little speed off only the parts touching it, so the rest keeps swinging normally and a pile still settles instead of shaking
      }
    }
    this.anchorFrom.copy(target);
    this._frames();
  }

  // closest distance between the capsule axes of segments i and j (also leaves the closest-point parameters in this._cs / this._ct)
  _capDist(i, j) {
    const { pos, parent } = this;
    const d1 = this._cd1 ||= new THREE.Vector3(), d2 = this._cd2 ||= new THREE.Vector3(), r = this._cr ||= new THREE.Vector3(), nrm = this._cn ||= new THREE.Vector3();
    const a0 = pos[parent[i]], a1 = pos[i], b0 = pos[parent[j]], b1 = pos[j];
    d1.subVectors(a1, a0); d2.subVectors(b1, b0); r.subVectors(a0, b0);
    const a = d1.dot(d1) || 1e-9, e = d2.dot(d2) || 1e-9, f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2);
    const den = a * e - b * b;
    let s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
    let t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    nrm.copy(d1).multiplyScalar(s).add(a0).sub(b0).addScaledVector(d2, -t);
    this._cs = s; this._ct = t;
    return nrm.length();
  }

  // Limb-vs-limb contact as a soft, damped spring (one pass per substep, like a force): the deeper two limbs overlap the harder they are pushed apart, so
  // resting contact settles calmly, nothing is ever snapped or shot away, and gravity and swing are not held back. Each pair's touching distance is capped
  // at 90% of how far apart the limbs are in the starting pose. Trunk segments (head, chest, torso) are solid walls: only the limbs move.
  _collide(h) {
    const { pos, prev, parent, rad, invMass, colPairs } = this;
    const nrm = this._cn, vv = this._cv ||= new THREE.Vector3();
    const w = (k) => (k === 0 ? 0 : invMass[k]);
    if (!this._pairR) this._pairR = colPairs.map(([i, j]) => Math.min(rad[i] + rad[j], this._capDist(i, j) * 0.9));
    const K = 1500, DAMP = 0.1, CAP = 0.01;
    for (let q = 0; q < colPairs.length; q++) {
      const i = colPairs[q][0], j = colPairs[q][1];
      const hi = this.heavy[i], hj = this.heavy[j]; if (hi && hj) continue;
      const dist = this._capDist(i, j), s = this._cs, t = this._ct, R = this._pairR[q];
      if (dist >= R) continue;
      if (dist < 1e-6) nrm.set(0, 0, 1); else nrm.divideScalar(dist);
      const ia = parent[i], jb = parent[j], fi = hi ? 0 : 1, fj = hj ? 0 : 1;
      const wa0 = fi * w(ia) * (1 - s) * (1 - s), wa1 = fi * w(i) * s * s, wb0 = fj * w(jb) * (1 - t) * (1 - t), wb1 = fj * w(j) * t * t;
      const tot = wa0 + wa1 + wb0 + wb1; if (tot < 1e-9) continue;
      const k = Math.min(K * (R - dist) * h * h, CAP) / tot;
      const nodes = [[ia, 1, fi * (1 - s)], [i, 1, fi * s], [jb, -1, fj * (1 - t)], [j, -1, fj * t]];
      for (const [x, sg, c] of nodes) {
        if (!x || !c) continue;
        pos[x].addScaledVector(nrm, sg * k * c * w(x));
        vv.subVectors(pos[x], prev[x]); const vn = vv.dot(nrm) * sg;     // damp only the speed heading into the other limb
        if (vn < 0) prev[x].addScaledVector(nrm, sg * vn * DAMP);
      }
    }
  }

  _solve(iters) {
    const { pos, prev, parent, len, stiff, lim, invMass, restQ, rot, n } = this;
    const d = new THREE.Vector3(), t = new THREE.Vector3(), pd = new THREE.Vector3(), lo = new THREE.Vector3();
    const qp = new THREE.Quaternion(), qa = new THREE.Quaternion();
    for (let i = 1; i < n; i++) {
      const p = parent[i];
      const wp = p === 0 ? 0 : invMass[p];
      const wi = invMass[i];
      qp.multiplyQuaternions(rot[p], restQ[i]);
      pd.copy(DOWN).applyQuaternion(qp);
      // bending: pull toward rest direction relative to parent frame
      if (stiff[i] > 0) {
        const k = 1 - Math.pow(1 - stiff[i], 1 / iters);
        t.copy(pd).multiplyScalar(len[i]).add(pos[p]).sub(pos[i]).multiplyScalar(k);
        const sum = wp * 0.5 + wi;
        pos[i].addScaledVector(t, wi / sum);
        if (wp) pos[p].addScaledVector(t, -(wp * 0.5) / sum);
      }
      // length constraint
      d.subVectors(pos[i], pos[p]);
      const L = d.length() || 1e-6;
      const sc = (L - len[i]) / L / (wp + wi);
      pos[p].addScaledVector(d, sc * wp);
      pos[i].addScaledVector(d, -sc * wi);
      if (this.bendW && this.bendW[i] > 0 && (this._anat ?? 1) > 0) {   // soft anatomical preference: the wrong way round is resisted a little and it never forces a pose
        const bw = this._bw ||= new THREE.Vector3();
        d.subVectors(pos[i], pos[p]); const Lb = d.length() || 1e-6; d.divideScalar(Lb);
        t.copy(d).addScaledVector(pd, -pd.dot(d));
        bw.copy(this.bendDir[i]).applyQuaternion(qp);
        const comp = t.dot(bw);
        const tgt = this.bendT[i] * this._anat;   // a relaxed, slightly bent pose toward the natural side
        if (comp < tgt) {
          const kb = 1 - Math.pow(1 - clamp(this.bendW[i] * this._anat, 0, 0.95), 1 / iters);
          const corr = (tgt - comp) * len[i] * kb, sm = wp * 0.5 + wi;
          pos[i].addScaledVector(bw, corr * wi / sm);
          if (wp) pos[p].addScaledVector(bw, -corr * (wp * 0.5) / sm);
        }
      }
      if (lim[i] > 0) {   // joint limit: keep the segment inside a cone around its rest direction, so limbs cannot fold into the body
        d.subVectors(pos[i], pos[p]); const Ld = d.length() || 1e-6; d.divideScalar(Ld);
        const c = Math.max(-1, Math.min(1, pd.dot(d)));
        if (Math.acos(c) > lim[i]) {
          t.copy(d).addScaledVector(pd, -c); const tl = t.length();
          if (tl > 1e-6) {
            t.divideScalar(tl); d.copy(pd).multiplyScalar(Math.cos(lim[i])).addScaledVector(t, Math.sin(lim[i]));
            lo.copy(pos[i]); pos[i].copy(pos[p]).addScaledVector(d, len[i]); lo.sub(pos[i]).negate(); prev[i].addScaledVector(lo, 0.9);
          }
        }
      }
      // frame (parallel transported from parent, so no twist drift)
      d.subVectors(pos[i], pos[p]).normalize();
      stableArc(this, i, pd, d, qa);
      rot[i].multiplyQuaternions(qa, qp);
    }
  }

  // Follow-the-leader pass: remove leftover stretch, root to tips. Part of the
  // correction is fed back into velocity damping so it doesn't add energy.
  _inextensible() {
    const { pos, prev, parent, len, n } = this;
    const d = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 1; i < n; i++) {
      const p = parent[i];
      d.subVectors(pos[i], pos[p]);
      const L = d.length();
      if (L < 1e-9) continue;
      c.copy(d).multiplyScalar(len[i] / L).add(pos[p]).sub(pos[i]);
      pos[i].add(c);
      prev[i].addScaledVector(c, 0.9);
    }
  }

  _frames() {
    const { pos, parent, restQ, rot, n } = this;
    const d = new THREE.Vector3(), pd = new THREE.Vector3();
    const qp = new THREE.Quaternion(), qa = new THREE.Quaternion();
    for (let i = 1; i < n; i++) {
      const p = parent[i];
      qp.multiplyQuaternions(rot[p], restQ[i]);
      pd.copy(DOWN).applyQuaternion(qp);
      d.subVectors(pos[i], pos[p]);
      if (d.lengthSq() < 1e-12) { rot[i].copy(qp); continue; }
      d.normalize();
      stableArc(this, i, pd, d, qa);      // (turning from the way the part hangs to the way it points; see stableArc)
      const lr = (this._lr ||= [])[i] ||= rot[i].clone();      // last frame's finished orientation (rot[] itself gets reworked by the solver in between)
      _oq.copy(lr);
      rot[i].multiplyQuaternions(qa, qp);
      // The twist of a part is handed down from its parent. When a little link in between swings through a half turn the twist suddenly jumped by up to 170 degrees, and a long part
      // (Longman) lying on the floor visibly spun round its own length. A jump that big is not real movement, so the part keeps the twist it had and only turns to the new direction.
      if (this._fOK && this._keepOK && this._keepOK[i]) {
        _dq.copy(rot[i]).multiply(_oq.clone().invert());
        if (2 * Math.acos(Math.min(1, Math.abs(_dq.w))) > 0.6) { _fp.copy(DOWN).applyQuaternion(_oq); qa.setFromUnitVectors(_fp, d); rot[i].multiplyQuaternions(qa, _oq); }
      }
      lr.copy(rot[i]);
    }
    this._fOK = true;
  }

  // Floor and screen sides. Each node is pushed so that the lowest / outermost point of its hit boxes stays
  // inside. `final` is the last pass of a substep: contact also removes the velocity into the surface (no
  // bounce, no energy gained), which is what used to make resting chains twitch.
  _contact(o, final) {
    const { pos, prev, parent, rot, hit, n } = this;
    const hasFloor = Number.isFinite(o.floorY);
    const hasWalls = Number.isFinite(o.minX) && Number.isFinite(o.maxX);
    const hasCeil = Number.isFinite(o.ceilY);
    const c = _tc, ax = _ta, ay = _tb, az = _td, q = _tq, touch = this._touch;
    for (let i = 1; i < n; i++) {
      const p = parent[i], P = pos[i];
      let lowY = P.y, lowX = P.x, highX = P.x, highY = P.y;
      for (const b of hit[i]) {
        if (b.pts) {      // the model's own outline: every corner of it, in the world
          for (const pt of b.pts) {
            c.copy(pt).applyQuaternion(rot[i]).add(pos[p]);
            if (c.y < lowY) lowY = c.y; if (c.y > highY) highY = c.y; if (c.x < lowX) lowX = c.x; if (c.x > highX) highX = c.x;
          }
          continue;
        }
        q.multiplyQuaternions(rot[i], b.q);
        ax.set(b.h.x, 0, 0).applyQuaternion(q); ay.set(0, b.h.y, 0).applyQuaternion(q); az.set(0, 0, b.h.z).applyQuaternion(q);
        c.copy(b.c).applyQuaternion(rot[i]).add(pos[p]);
        const ey = Math.abs(ax.y) + Math.abs(ay.y) + Math.abs(az.y);
        const ex = Math.abs(ax.x) + Math.abs(ay.x) + Math.abs(az.x);
        lowY = Math.min(lowY, c.y - ey); highY = Math.max(highY, c.y + ey);
        lowX = Math.min(lowX, c.x - ex); highX = Math.max(highX, c.x + ex);
      }
      if (hasFloor && lowY < o.floorY) {
        const dy = o.floorY - lowY;
        P.y += dy * (p === 0 ? 1 : 0.75);
        if (p > 0) { pos[p].y += dy * 0.25; touch[p] = 1; }
        touch[i] = 1;
      }
      if (hasCeil && p > 0 && highY > o.ceilY) {          // the top of the screen (the first links hang straight from the cursor, so they are left alone)
        const dy = highY - o.ceilY;
        P.y -= dy * 0.75; pos[p].y -= dy * 0.25; this._ceil[i] = 1; this._ceil[p] = 1;
      }
      if (hasWalls) {
        if (lowX < o.minX) { P.x += o.minX - lowX; this._wall[i] = -1; if (final) prev[i].x = P.x; }
        else if (highX > o.maxX) { P.x -= highX - o.maxX; this._wall[i] = 1; if (final) prev[i].x = P.x; }
      }
    }
    if (final) {
      for (let i = 1; i < n; i++) if (this._ceil[i] && pos[i].y - prev[i].y > 0) prev[i].y = pos[i].y;   // no upward speed left once it is against the ceiling
      // anything that touched the floor this substep loses its vertical speed (no bounce, no energy from the push)
      for (let i = 1; i < n; i++) {
        if (!touch[i]) continue;
        const P = pos[i];
        prev[i].y = P.y;
        prev[i].x += (P.x - prev[i].x) * 0.35;
        prev[i].z += (P.z - prev[i].z) * 0.35;
        const vx = P.x - prev[i].x, vz = P.z - prev[i].z;
        if (vx * vx + vz * vz < 1e-8) { prev[i].x = P.x; prev[i].z = P.z; }   // rest instead of jitter
        const pp = parent[i];
        if (pp > 0) {      // a part lying on the floor swings slowly around its joint (only the sideways motion between it and its parent is damped), so a dragged keychain does not flop over and whip about
          const Pp = pos[pp], pv = prev[pp];
          prev[i].x += ((P.x - prev[i].x) - (Pp.x - pv.x)) * 0.75; prev[i].z += ((P.z - prev[i].z) - (Pp.z - pv.z)) * 0.75;
        }
      }
    }
  }

  // Work out which nodes just smacked into the floor or a screen side hard enough to count (for the impact particles).
  _noteImpacts(o, h) {
    const { pos, n } = this;
    const thr = o.impactMin ?? 3.5, hasFloor = Number.isFinite(o.floorY);
    for (let i = 1; i < n && this.impacts.length < 8; i++) {
      if (!this._fxOK[i] || this.t - this._impCD[i] < 0.14) continue;
      const v = this._v0[i];
      let hit = null;
      if (hasFloor && this._touch[i] && v.y < 0 && -v.y / h > thr) hit = { x: pos[i].x, y: o.floorY, z: pos[i].z, nx: 0, ny: 1, speed: -v.y / h, node: i };
      else if (Number.isFinite(o.ceilY) && this._ceil[i] && v.y > 0 && v.y / h > thr) hit = { x: pos[i].x, y: o.ceilY, z: pos[i].z, nx: 0, ny: -1, speed: v.y / h, node: i };
      else if (this._wall[i] && v.x * this._wall[i] > 0 && Math.abs(v.x) / h > thr) hit = { x: this._wall[i] < 0 ? o.minX : o.maxX, y: pos[i].y, z: pos[i].z, nx: -this._wall[i], ny: 0, speed: Math.abs(v.x) / h, node: i };
      if (hit) { this.impacts.push(hit); this._impCD[i] = this.t; }
    }
  }

  // start point of segment i (= its parent's joint)
  segStart(i) { return this.pos[this.parent[i]]; }
}

// ------------------------------------------------------------------ visuals

// A chunky, rounded five-point star, about 1 unit across and puffy front to back.
function starGeometry() {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 0.27 : 0.5, a = Math.PI / 2 + (k * Math.PI) / 5;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, outer: k % 2 === 0 });
  }
  const shape = new THREE.Shape();
  const n = pts.length;
  pts.forEach((v, k) => {
    const p = pts[(k + n - 1) % n], q = pts[(k + 1) % n];
    const t = v.outer ? 0.3 : 0.14;
    const a = { x: v.x + (p.x - v.x) * t, y: v.y + (p.y - v.y) * t };
    const b = { x: v.x + (q.x - v.x) * t, y: v.y + (q.y - v.y) * t };
    if (k === 0) shape.moveTo(a.x, a.y); else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(v.x, v.y, b.x, b.y);
  });
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.06, bevelSegments: 5, curveSegments: 10 });
  g.translate(0, 0, -0.07);
  g.computeVertexNormals();
  return g;
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.4)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grad; x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const geoCache = new Map();
function primitiveGeometry(shape, thickness) {
  const key = shape + ':' + (shape === 'torus' || shape === 'ring' ? thickness.toFixed(3) : '');
  if (geoCache.has(key)) return geoCache.get(key);
  let g;
  switch (shape) {
    case 'box': g = new THREE.BoxGeometry(1, 1, 1); break;
    case 'cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); break;
    case 'cone': g = new THREE.ConeGeometry(0.5, 1, 24); break;
    case 'torus': { const t = clamp(thickness, 0.02, 0.48); g = new THREE.TorusGeometry(0.5 - t / 2, t / 2, 14, 32); break; }
    case 'ring': { const t = clamp(thickness, 0.02, 0.48); g = new THREE.TorusGeometry(0.5 - t / 2, t / 2, 10, 48); g.scale(1, 1, 0.6); break; }
    case 'capsule': g = new THREE.CapsuleGeometry(0.25, 0.5, 8, 16); break;
    case 'octahedron': g = new THREE.OctahedronGeometry(0.5); break;
    case 'star': g = starGeometry(); break;
    default: g = new THREE.SphereGeometry(0.5, 24, 16);
  }
  geoCache.set(key, g);
  return g;
}

function makeMaterial(a) {
  return new THREE.MeshStandardMaterial({
    color: a.color,
    metalness: a.metalness,
    roughness: a.roughness,
    emissive: a.emissive,
    emissiveIntensity: a.emissiveIntensity,
    flatShading: a.flatShading,
    transparent: a.opacity < 1,
    opacity: a.opacity,
  });
}

const modelCache = new Map();
export function loadModelSource(url) {
  if (modelCache.has(url)) return modelCache.get(url);
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  const pr = new Promise((resolve, reject) => {
    const fail = (e) => reject(e);
    if (ext === 'glb' || ext === 'gltf') new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, fail);
    else if (ext === 'obj') new OBJLoader().load(url, resolve, undefined, fail);
    else if (ext === 'stl') new STLLoader().load(url, (geo) => {
      geo.computeVertexNormals();
      resolve(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#cccccc' })));
    }, undefined, fail);
    else reject(new Error('Unsupported model type: ' + ext));
  });
  modelCache.set(url, pr);
  pr.catch(() => modelCache.delete(url));
  return pr;
}

function applyTransform(obj, a) {
  obj.position.fromArray(a.position);
  const r = THREE.MathUtils.degToRad;
  obj.rotation.set(r(a.rotation[0]), r(a.rotation[1]), r(a.rotation[2]), 'XYZ');
  obj.scale.fromArray(a.scale);
  obj.visible = a.visible;
}

/**
 * Builds Three.js objects for a rig. One group per node (0 = anchor), each
 * placed at the segment start with the segment's frame. Attachments are
 * children of these groups.
 */
export class RigView {
  constructor(rig, { assetUrl = (n) => n, onModelError } = {}) {
    this.rig = rig;
    this.assetUrl = assetUrl;
    this.onModelError = onModelError;
    this.root = new THREE.Group();
    this.groups = [];
    this.attObjects = new Map(); // attId -> wrapper
    this.pending = [];
    this.disposed = false;
    this.build();
  }

  build() {
    const segs = orderSegments(this.rig);
    const anchor = new THREE.Group();
    anchor.userData.node = { segId: null, index: 0 };
    this.groups = [anchor];
    this.root.add(anchor);
    this.rig.anchor.attachments.forEach((a) => this._addAttachment(anchor, a, null));
    segs.forEach((s, k) => {
      const g = new THREE.Group();
      g.userData.node = { segId: s.id, index: k + 1 };
      this.groups.push(g);
      this.root.add(g);
      s.attachments.forEach((a) => this._addAttachment(g, a, s.id));
    });
    this.ready = Promise.allSettled(this.pending);
  }

  _addAttachment(group, a, segId) {
    const wrap = new THREE.Group();
    wrap.userData.att = { segId, attId: a.id };
    applyTransform(wrap, a);
    group.add(wrap);
    this.attObjects.set(a.id, wrap);
    if (!a.noSpin && (a.spin || a.spinDrive || a.kind === 'model')) { (this.spinners ||= []).push({ wrap, isModel: a.kind === 'model', base: wrap.quaternion.clone(), basePos: wrap.position.clone(), seg: segId, spin: a.spin ?? (a.kind === 'model' ? DEFAULT_SPIN : 0), drive: a.spinDrive ?? (a.kind === 'model' ? 0.5 : 0), ang: 0, w: 0, last: null }); }   // always starts facing the front, then turns with the cursor (or the Spin setting)
    if (a.glow > 0 && typeof document !== 'undefined') {
      const tint = a.emissive && a.emissive !== '#000000' ? a.emissive : a.color;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: tint, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      halo.scale.setScalar(a.glow);
      halo.renderOrder = 2;
      wrap.add(halo);
    }
    if (a.kind === 'primitive' && a.image) {      // a custom PNG: a flat, unlit picture (its own colours and transparency), 1 unit across its longest side
      const tex = new THREE.TextureLoader().load(a.image, (t) => {
        const w = t.image?.width || 1, h = t.image?.height || 1, k = 1 / Math.max(w, h);
        m.geometry.dispose(); m.geometry = new THREE.PlaneGeometry(w * k, h * k); m.visible = a.visible !== false;
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: a.opacity ?? 1, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      m.visible = false;
      wrap.add(m);
      return;
    }
    if (a.kind === 'primitive') {
      const m = new THREE.Mesh(primitiveGeometry(a.shape, a.thickness), makeMaterial(a));
      wrap.add(m);
      return;
    }
    if (!a.model) return;
    const pr = loadModelSource(this.assetUrl(a.model))
      .then((src) => {
        if (this.disposed) return;
        if (a.skin) { this._addSkin(src, a); return; }
        const obj = src.clone(true);
        if (a.useColor) {
          const mat = makeMaterial(a);
          obj.traverse((o) => { if (o.isMesh) o.material = mat; });
        } else if (a.opacity < 1) {
          obj.traverse((o) => {
            if (!o.isMesh) return;
            o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
              const c = m.clone(); c.transparent = true; c.opacity = a.opacity; return c;
            });
            if (o.material.length === 1) o.material = o.material[0];
          });
        }
        if (a.fit) {
          const box = new THREE.Box3().setFromObject(obj);
          const size = box.getSize(new THREE.Vector3());
          const c = box.getCenter(new THREE.Vector3());
          const s = 1 / Math.max(size.x, size.y, size.z, 1e-6);
          if (segId && a.visible !== false) (this.hits ||= new Map()).set(a.id, { segId, a, size: [size.x, size.y, size.z], prof: profileFrom(meshProfile(obj), c, s) });
          const holder = new THREE.Group();
          obj.position.sub(c);
          holder.add(obj);
          holder.scale.setScalar(s);
          wrap.add(holder);
        } else wrap.add(obj);
      })
      .catch((e) => this.onModelError?.(a, e));
    this.pending.push(pr);
  }

  // Skinned ragdoll model: one continuous mesh whose bones are driven by the rig's segments (every bone = segment frame * a fixed rotation).
  _addSkin(src, a) {
    const obj = SkeletonUtils.clone(src);
    const entry = { obj, a, bones: [] };
    obj.traverse((o) => {
      if (o.isSkinnedMesh) o.frustumCulled = false;
      if (o.isBone && a.skin.bones && a.skin.bones[o.name]) {
        const q = a.skin.bones[o.name];
        o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false;
        const L = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]));
        const off = a.skin.pos && a.skin.pos[o.name];   // optional: the bone's pivot sits this far from the start of its segment (in the segment's own frame)
        if (off) L.setPosition(off[0], off[1], off[2]);
        entry.bones.push({ bone: o, name: o.name, segId: (a.skin.drive && a.skin.drive[o.name]) || o.name, L });   // `drive`: a bone can follow a segment with a different id (used when a ragdoll is hung from another end)
      }
    });
    // 'sink' on a segment: the string attaches that far further along the segment, so move that bone's pivot (and the physics length, see the sim) the same distance
    const segBy = new Map(this.rig.segments.map((x) => [x.id, x]));
    obj.traverse((o) => {
      if (!o.isSkinnedMesh || !o.skeleton) return;
      o.skeleton.boneInverses = o.skeleton.boneInverses.map((m) => m.clone());   // the cloned skeleton can share these matrices with the cached model: without this, every extra view (menu preview, thumbnail, editor) pushed the head further and further (the stretched neck)
      for (const b of entry.bones) {
        const sg = segBy.get(b.segId); const idx = o.skeleton.bones.indexOf(b.bone);
        if (!(sg?.sink > 0) || idx < 0) continue;
        const inv = o.skeleton.boneInverses[idx]; const R = a.skin.bones[b.name];
        const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(new THREE.Quaternion(R[0], R[1], R[2], R[3]).invert());
        inv.elements[12] -= dir.x * sg.sink; inv.elements[13] -= dir.y * sg.sink; inv.elements[14] -= dir.z * sg.sink;
      }
    });
    obj.visible = a.visible !== false;
    this.root.add(obj);
    (this.skins ||= []).push(entry);
  }

  update(sim) {
    const { groups } = this;
    if (this.hits && sim.setModelHit && sim._hitFrom !== this) {
      for (const h of this.hits.values()) sim.setModelHit(h.segId, h.a, h.size, h.prof);
      let want = 0;
      for (const sg of this.rig.segments) for (const at of sg.attachments || []) if (at.kind === 'model' && at.model && at.visible !== false) want++;
      if (this.hits.size >= want) sim._hitFrom = this;
    }
    groups[0].position.copy(sim.pos[0]);
    groups[0].quaternion.copy(sim.rot[0]);
    for (let i = 1; i < groups.length && i < sim.n; i++) {
      groups[i].position.copy(sim.pos[sim.parent[i]]);
      groups[i].quaternion.copy(sim.rot[i]);
    }
    if (this.rig.physics.yaw && this.spinEnabled !== false && !this.noYaw) {     // ragdoll: free turning about the string, driven by cursor movement (plus the Automatic spin slider), keeps its angle when it stops
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - (this._ty || now)) / 1000)); this._ty = now;
      const Y = this._yawY ||= { ang: 0, w: 0, last: null, q: new THREE.Quaternion(), ax: new THREE.Vector3(0, 1, 0), v: new THREE.Vector3() };
      const p0 = sim.pos[0];
      const vr = Y.last ? (p0.x - Y.last) / dt : 0; Y.last = p0.x;
      Y.vf = (Y.vf ?? 0) + (vr - (Y.vf ?? 0)) * Math.min(1, dt * 10);   // smoothed cursor speed: raw frame-to-frame speed is spiky and made the doll twitch
      let pressedAny = false;   // pushed into the floor, a wall or the ceiling: the solver shoves it about every frame, and that must not make it spin
      for (let k = 1; k < sim.n; k++) { if ((sim._touch && sim._touch[k]) || (sim._wall && sim._wall[k]) || (sim._ceil && sim._ceil[k])) { pressedAny = true; break; } }
      Y.press = pressedAny ? Math.min(1, (Y.press || 0) + dt * 8) : Math.max(0, (Y.press || 0) - dt * 3);
      const vx = pressedAny ? 0 : Y.vf;
      const fs = Number.isFinite(this.spinFeel) ? this.spinFeel : 0;
      // doll twist: it mostly hangs facing the front; fast cursor flicks give it a spin that fades, then a weak twist spring brings it back round to the front (no spring while Automatic spin is on)
      const allow = Number.isFinite(this.spinAllow) ? Math.max(0, Math.min(1, this.spinAllow)) : 1;   // the menu's Spin allowance (1 = free to turn, 0 = never turns)
      const G = allow * 5, soft = Math.max(0.3, 1.1 - allow);   // Spin allowance: at 100% a cursor flick spins it right round, it coasts longer and is only gently pulled back round to its resting side; lower values turn less, 0 = never
      Y.w += Math.max(-40, Math.min(40, vx)) * 0.07 * dt * G;
      if (fs > 0) Y.w += (fs * allow * Math.PI / 180 - Y.w) * Math.min(1, dt * 1.5);
      else { const a = Y.ang - Math.round(Y.ang / 6.2832) * 6.2832; Y.w -= 3.0 * soft * a * dt * (1 - (Y.press || 0)); }   // no springing back round while pressed against something: it just holds its angle
      Y.w *= Math.exp(-(1.4 - 0.5 * allow + 30 * (Y.press || 0)) * dt);
      Y.w = Math.max(-10, Math.min(10, Y.w));
      Y.ang += Y.w * dt;
      if (allow <= 0) { Y.ang = 0; Y.w = 0; }
      // The twist is about the line from the cursor point (the big ring) down to the spot the doll hangs from, so the ring, the chain and the doll all turn
      // together from the cursor point, and nothing orbits around the cursor when it swings.
      if (this._dollIdx === undefined || (this._dollIdx < 0 && this.skins)) {
        const ids = new Set((this.skins || []).flatMap((sk) => sk.bones.map((b) => b.segId)));
        this._dollIdx = ids.size ? groups.findIndex((g, i) => i > 0 && ids.has(g.userData.node.segId)) : -1;
      }
      const hang = this._dollIdx > 0 ? sim.pos[sim.parent[this._dollIdx]] : sim.pos[Math.min(sim.n - 1, 1)];
      // The whole doll turns about the line from the cursor point to where it hangs. When the chain is bunched up or lying on the floor that line is tiny or flips about every frame,
      // and turning about it threw the whole rig round wildly: so the line is smoothed, ignored while the doll is pressed against something, and pulled back toward straight down when it lies sideways.
      const axT = Y.axT ||= new THREE.Vector3(), axS = Y.axS ||= new THREE.Vector3(0, -1, 0);
      axT.subVectors(hang, p0); const axL = axT.length();
      if (axL > 0.12 && !pressedAny) { axT.divideScalar(axL); axS.lerp(axT, Math.min(1, dt * 8)).normalize(); }
      Y.ax.copy(axS);
      if (Y.ax.y > -0.5) { const kk = Math.min(1, (Y.ax.y + 0.5) / 0.5); Y.ax.multiplyScalar(1 - kk); Y.ax.y -= kk; Y.ax.normalize(); }
      Y.q.setFromAxisAngle(Y.ax, Y.ang);
      groups[0].quaternion.premultiply(Y.q);
      for (let i = 1; i < groups.length && i < sim.n; i++) {
        Y.v.copy(groups[i].position).sub(p0).applyQuaternion(Y.q);
        groups[i].position.copy(p0).add(Y.v);
        groups[i].quaternion.premultiply(Y.q);
      }
    }
    if (this.skins) {
      const segGroup = this._segGroup ||= new Map(groups.map((g) => [g.userData.node.segId, g]));
      for (const sk of this.skins) {
        for (const b of sk.bones) {
          const g = segGroup.get(b.segId); if (!g) continue;
          g.updateMatrix();
          b.bone.matrixWorld.multiplyMatrices(this.root.matrixWorld, g.matrix).multiply(b.L);
        }
      }
    }
    if (this.spinners && this.spinEnabled !== false) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - (this._t || now)) / 1000)); this._t = now;
      const Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
      for (const sp of this.spinners) {
        const gi = this.groups.findIndex((g) => g.userData.node.segId === sp.seg);
        const p = sim.pos[gi < 0 ? 0 : gi];
        const vx0 = sp.last ? (p.x - sp.last.x) / dt : 0;
        (sp.last ||= new THREE.Vector3()).copy(p);
        // Sideways speed drives the turn, but only the smooth part of it: when a part is pushed into the floor, a wall or the ceiling the solver shoves it about
        // every frame, and that jitter must not make it spin. Touching = no cursor-driven turn at all, and the turn eases back to calm.
        sp.vf = (sp.vf || 0) + (vx0 - (sp.vf || 0)) * Math.min(1, dt * 10);
        const pi = gi < 0 ? 0 : gi, par = sim.parent ? sim.parent[pi] : -1;
        const pressed = !!((sim._touch && (sim._touch[pi] || (par >= 0 && sim._touch[par]))) || (sim._wall && (sim._wall[pi] || (par >= 0 && sim._wall[par]))) || (sim._ceil && (sim._ceil[pi] || (par >= 0 && sim._ceil[par]))));
        sp.press = pressed ? Math.min(1, (sp.press || 0) + dt * 12) : Math.max(0, (sp.press || 0) - dt * 1.5);   // contact with floor/walls flickers frame to frame, so it fades in quickly and out slowly: a flicker must not switch the spin back on
        const calm = sp.press;
        const vx = (Math.abs(sp.vf) < 1.5 ? 0 : sp.vf) * (1 - calm);
        const fs = this.spinFeel;   // the menu's Spin slider (degrees a second) overrides every model when it has been set
        const allow = Number.isFinite(this.spinAllow) ? Math.max(0, Math.min(1, this.spinAllow)) : 1;
        const baseSpin = (sp.isModel && Number.isFinite(fs) ? fs : sp.spin) || 0;
        const target = calm > 0.3 && !(baseSpin > 0) ? 0 : (baseSpin * (1 - 0.75 * calm) + sp.drive * Math.max(-40, Math.min(40, vx)) * 20 * 1.5) * Math.PI / 180 * allow;
        const still = !((sp.isModel && Number.isFinite(fs) ? fs : sp.spin) > 0);
        const settle = still && calm < 0.2 ? -2.2 * Math.max(0.3, 1.1 - allow) * Math.sin(sp.ang) * (Math.cos(sp.ang) < 0 ? 1.6 : 1) : 0;   // with no automatic spin a model eases back to face the screen FRONT (never the back, never edge-on)
        sp.w += (Math.max(-10, Math.min(10, target + settle)) - sp.w) * Math.min(1, dt * (3 + 17 * calm));
        sp.ang += sp.w * dt;
        if (allow <= 0) { sp.ang = 0; sp.w = 0; }
        q.setFromAxisAngle(Y, sp.ang);                       // twist about the string itself, so a part you lined up under the string in the editor stays under it while it turns
        sp.wrap.quaternion.copy(q).multiply(sp.base);
        sp.wrap.position.copy(sp.basePos).applyQuaternion(q);
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.root.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
      }
    });
    this.root.removeFromParent();
  }
}

// Soft studio reflections so metal / chrome parts actually reflect something.
export function addEnvironment(renderer, scene, intensity = 0.7) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = intensity;
    pmrem.dispose();
  } catch (e) {
    return; // very old graphics can't build reflections; the rig just looks a little flatter
  }
  // the environment adds its own fill light, so tone the flat ambient down
  scene.traverse((o) => { if (o.isHemisphereLight) o.intensity *= 0.45; });
}

export function addDefaultLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x99bbff, 0.6);
  rim.position.set(4, -2, -5);
  scene.add(rim);
}

// ---------------------------------------------------------------- rig check
// Finds setups that make a rig look stiff or twitchy, and knows how to repair them.
// Rules come from simulating real rigs: a model sitting on a short, light segment
// (e.g. the last chain link) whips around, because its angle is read from a tiny link.

const hasModel = (s) => s.attachments.some((a) => a.kind === 'model');
const reachOf = (s) => Math.max(0, ...s.attachments.map((a) => Math.abs(a.position[1])));

export function checkRig(rig) {
  if (rig.type === 'orbit' || rig.type === 'particles') return [];
  const out = [];
  const byId = new Map(rig.segments.map((s) => [s.id, s]));
  for (const s of rig.segments) {
    // 1. a part hanging far beyond a short, light segment
    const far = s.attachments.filter((a) => Math.abs(a.position[1]) > s.length * 2 + 0.15);
    if (far.length && s.mass < 1.5 && s.length < 0.4) {
      const reach = Math.max(...far.map((a) => Math.abs(a.position[1])));
      out.push({
        id: 'loose-' + s.id, level: 'warn', segId: s.id, fix: 'weightedSegment',
        title: `“${s.name}” is carrying a part that hangs ${reach.toFixed(2)} below it`,
        detail: `This segment is only ${s.length} long and weighs ${s.mass}, so the part whips around and moves stiffly or twitchily. Give it its own heavier segment, like the tabby’s charm.`,
        fixLabel: 'Move it onto its own weighted segment',
      });
    }
    // 2. stiffness on the path to something heavy
    if (s.stiffness > 0.3) {
      // only when a model hangs from this segment or below it; stiff tails, arms and ropes on plain shapes are normal
      const carriesModel = hasModel(s) || descendants(rig, s.id).some(hasModel);
      if (carriesModel) out.push({
        id: 'stiff-' + s.id, level: 'warn', segId: s.id, fix: 'clearStiffness',
        title: `“${s.name}” has stiffness ${s.stiffness}`,
        detail: 'Stiff segments hold their rest angle, so anything hanging from this one swings stiffly. Use stiffness only on small extras such as a tail.',
        fixLabel: 'Set stiffness to 0',
      });
    }
    // 3. very heavy compared with what it hangs from
    const p = s.parent ? byId.get(s.parent) : null;
    if (p && s.mass / Math.max(p.mass, 0.01) > 40) out.push({
      id: 'ratio-' + s.id, level: 'info', segId: s.id, fix: null,
      title: `“${s.name}” is ${Math.round(s.mass / p.mass)}× heavier than “${p.name}”`,
      detail: 'Very large mass differences make the heavy end lag behind the cursor. The sample keychains stay under about 30×.',
    });
  }
  // 4. flatten pulls the swing toward the screen plane
  if ((rig.physics.flatten ?? 0) >= 0.3) out.push({
    id: 'flatten', level: 'info', segId: null, fix: 'flatten0',
    title: `Flatten is ${rig.physics.flatten}`,
    detail: 'High flatten squashes the swing toward a flat plane. Kuma uses 0; the samples use 0 to 0.2.',
    fixLabel: 'Set flatten to 0',
  });
  return out;
}

// Mutates `rig`. Returns true if something changed.
export function fixIssue(rig, issue) {
  const seg = rig.segments.find((s) => s.id === issue.segId);
  switch (issue.fix) {
    case 'clearStiffness': if (!seg) return false; seg.stiffness = 0; return true;
    case 'flatten0': rig.physics.flatten = 0; return true;
    case 'weightedSegment': {
      if (!seg) return false;
      const moving = seg.attachments.filter((a) => Math.abs(a.position[1]) > seg.length * 2 + 0.15);
      if (!moving.length) return false;
      const reach = Math.max(...moving.map((a) => Math.abs(a.position[1])));
      seg.attachments = seg.attachments.filter((a) => !moving.includes(a));
      moving.forEach((a) => { a.position[1] = Math.round((a.position[1] + seg.length) * 1000) / 1000; }); // same spot on screen
      const child = newSegment(seg.id, { name: 'charm', length: Math.min(1.2, Math.max(0.5, reach - seg.length + 0.1)), mass: 4, stiffness: 0 });
      child.attachments = moving;
      rig.segments.push(child);
      return true;
    }
  }
  return false;
}


// ------------------------------------------------------------ orbit rigs
// A rig with type "orbit" is a set of bodies (segments) circling the cursor on tilted rings, like a solar
// system. Each body is a normal segment with an extra `orbit: {ring, angle, spin}`. Old versions of the app
// ignore the extra fields and simply show the bodies hanging from the cursor.
export const isOrbit = (rig) => rig?.type === 'orbit';

export function normalizeRing(r = {}) {
  return {
    id: r.id || uid('ring'),
    name: r.name || 'orbit',
    radius: r.radius ?? 1,        // rig units
    tilt: r.tilt ?? 0,            // degrees, 0 = flat circle facing the viewer, 90 = edge-on
    node: r.node ?? 0,            // degrees, rolls the ring on screen
    speed: r.speed ?? 1,          // radians per second at speed factor 1 (negative = backwards)
    ...(Number.isFinite(r.realSpeed) ? { realSpeed: r.realSpeed } : {}),   // optional: the speed to use when the menu's "Realistic speeds" is on (planets in true proportion to each other)
    trail: r.trail !== false,     // draw the orbit line
    color: r.color || '#ffffff',  // orbit line colour
  };
}

export function normalizeOrbit(o = {}) {
  return {
    baseSpeed: o.baseSpeed ?? 0.7,     // speed factor when the cursor is still
    maxSpeed: o.maxSpeed ?? 9,          // speed factor when the cursor is moving fast
    sensitivity: o.sensitivity ?? 12,   // cursor speed (rig units / second) that counts as "fast"
    response: o.response ?? 3,          // how quickly orbits speed up
    settle: o.settle ?? 1.2,            // how slowly they ease back down
    sunSpin: o.sunSpin ?? 0.6,          // spin of whatever hangs on the anchor
    sway: o.sway ?? 0.2,                // how much the rings' angles drift and lean as you move (0 = fixed angles)
    trails: o.trails !== false,         // master switch for orbit lines
    trailOpacity: o.trailOpacity ?? 0.3,
    rings: (o.rings || []).map(normalizeRing),
  };
}

const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0), AX_Z = new THREE.Vector3(0, 0, 1);
const rad = (d) => (d * Math.PI) / 180;
// Rings are drawn in the XZ plane, then stood up to face the viewer (a flat circle on screen at tilt 0).
// Tilt leans the top of the ring away from the viewer (about 60 gives an open ellipse); roll turns it on screen.
const _q1 = new THREE.Quaternion();
function ringQuat(ring, out = new THREE.Quaternion()) {
  out.setFromAxisAngle(AX_Z, rad(ring.node));
  return out.multiply(_q1.setFromAxisAngle(AX_X, rad(ring.tilt + 90)));
}

export class OrbitSim {
  constructor(rig) { this.setRig(rig); }

  setRig(rig) {
    this.rig = rig;
    const segs = (this.segs = orderSegments(rig));
    const n = (this.n = segs.length + 1);
    this.index = new Map();
    segs.forEach((s, k) => this.index.set(s.id, k + 1));
    this.parent = new Int32Array(n);
    this.len = new Float32Array(n).fill(0.01);
    this.restQ = Array.from({ length: n }, () => new THREE.Quaternion());
    segs.forEach((s, k) => { this.parent[k + 1] = s.parent && this.index.has(s.parent) ? this.index.get(s.parent) : 0; });
    this.pos = Array.from({ length: n }, () => new THREE.Vector3());
    this.rot = Array.from({ length: n }, () => new THREE.Quaternion());
    this.ang = new Float64Array(n);
    this.spinAng = new Float64Array(n);
    this.anchorFrom = new THREE.Vector3();
    this.cursorSpeed = 0;
    this.factor = rig.orbit.baseSpeed;
    this.t = 0; this.phase = 0; this.lean = 0; this.dyn = new Map(); this.adj = { tilt: 0, roll: 0, speed: 1, size: 1 };
    this.reset(new THREE.Vector3());
  }

  segStart(i) { return this.pos[this.parent[i]].clone(); }

  reset(anchor) {
    this.pos[0].copy(anchor);
    this.anchorFrom.copy(anchor);
    this.cursorSpeed = 0;
    this.factor = this.rig.orbit.baseSpeed;
    this.spinAng.fill(0); this.phase = 0; this.lean = 0;
    this.segs.forEach((s, k) => { this.ang[k + 1] = rad(s.orbit?.angle ?? 0); });
    this._place();
  }

  // Each ring's angle drifts slowly (faster when the cursor is fast) and leans the way the cursor moves.
  _dyn() {
    const cfg = this.rig.orbit, sw = cfg.sway;
    this.dyn.clear();
    cfg.rings.forEach((r, k) => {
      this.dyn.set(r.id, {
        tilt: clamp(r.tilt + this.adj.tilt + sw * 26 * Math.sin(this.phase + k * 1.7), -85, 85),
        node: r.node + this.adj.roll + sw * (38 * Math.sin(this.phase * 0.63 + k * 2.3) + this.lean),
      });
    });
  }

  _place() {
    const cfg = this.rig.orbit;
    this._dyn();
    const rings = new Map(cfg.rings.map((r) => [r.id, r]));
    const v = new THREE.Vector3(), q = new THREE.Quaternion();
    this.rot[0].setFromAxisAngle(AX_Y, this.spinAng[0]);
    for (let i = 1; i < this.n; i++) {
      const s = this.segs[i - 1];
      const ring = rings.get(s.orbit?.ring);
      const base = this.pos[this.parent[i]];
      if (ring) {
        v.set(Math.cos(this.ang[i]) * ring.radius * this.adj.size, 0, Math.sin(this.ang[i]) * ring.radius * this.adj.size).applyQuaternion(ringQuat(this.dyn.get(ring.id) || ring, q));
        this.pos[i].copy(base).add(v);
      } else this.pos[i].copy(base);
      this.rot[i].setFromAxisAngle(AX_Y, this.spinAng[i]);
    }
  }

  step(dt, target, opts = {}) {
    const cfg = this.rig.orbit;
    this.adj.tilt = opts.orbitTilt ?? 0; this.adj.roll = opts.orbitRoll ?? 0; this.adj.speed = opts.orbitSpeed ?? 1; this.adj.size = opts.orbitSize ?? 1; this.adj.dir = opts.orbitDir === -1 ? -1 : 1; this.adj.real = !!opts.orbitReal;
    dt = Math.max(1e-4, dt);
    const raw = this.anchorFrom.distanceTo(target) / dt;
    const vx = (target.x - this.anchorFrom.x) / dt;
    this.anchorFrom.copy(target);
    this.pos[0].copy(target);
    this.cursorSpeed += (raw - this.cursorSpeed) * (1 - Math.exp(-dt * 8));
    const k = clamp(this.cursorSpeed / Math.max(0.01, cfg.sensitivity), 0, 1);
    const goal = cfg.baseSpeed + (cfg.maxSpeed - cfg.baseSpeed) * k * (2 - k);
    const rate = goal > this.factor ? cfg.response : cfg.settle;
    this.factor += (goal - this.factor) * (1 - Math.exp(-dt * rate));
    this.t += dt;
    this.phase += dt * 0.35 * (0.6 + 0.4 * this.factor);
    this.lean += (clamp(vx * 1.2, -35, 35) - this.lean) * (1 - Math.exp(-dt * 3));
    const rings = new Map(cfg.rings.map((r) => [r.id, r]));
    this.spinAng[0] += cfg.sunSpin * this.factor * dt;
    for (let i = 1; i < this.n; i++) {
      const o = this.segs[i - 1].orbit;
      const ring = rings.get(o?.ring);
      if (ring) this.ang[i] += (this.adj.real && ring.realSpeed != null ? ring.realSpeed : ring.speed) * this.factor * this.adj.speed * (this.adj.dir ?? 1) * dt;
      this.spinAng[i] += (o?.spin ?? 0) * this.factor * dt;
    }
    this._place();
  }
}

export class OrbitView extends RigView {
  constructor(rig, opts) {
    super(rig, opts);
    this.trailRoot = new THREE.Group();
    this.root.add(this.trailRoot);
    const pts = [];
    for (let k = 0; k < 96; k++) pts.push(new THREE.Vector3(Math.cos((k / 96) * Math.PI * 2), 0, Math.sin((k / 96) * Math.PI * 2)));
    this.trailGeo = new THREE.BufferGeometry().setFromPoints(pts);
    this._initBodyTrails();
    this.trails = rig.orbit.rings.map((ring) => {
      const line = new THREE.LineLoop(this.trailGeo, new THREE.LineBasicMaterial({ color: ring.color, transparent: true, opacity: rig.orbit.trailOpacity, depthWrite: false }));
      line.userData.ringId = ring.id;
      line.renderOrder = -1;
      this.trailRoot.add(line);
      return line;
    });
  }

  // a soft ribbon that streams off a body as it orbits (set per body in the editor)
  _initBodyTrails() {
    const segs = orderSegments(this.rig);
    this.bodyTrails = [];
    segs.forEach((sg, k) => { if (sg.orbit?.trail && sg.orbit.trail.len > 1) this.bodyTrails.push({ node: k + 1, cfg: sg.orbit.trail }); });
    if (!this.bodyTrails.length) return;
    const maxLen = Math.max(...this.bodyTrails.map((b) => b.cfg.len));
    this.ribbons = new RibbonSet(this.bodyTrails.length, maxLen);
    this.bodyTrails.forEach((b, i) => this.ribbons.style(i, b.cfg));
    this.root.add(this.ribbons.mesh);
    this._rt = 0;
  }

  update(sim) {
    const { groups } = this;
    for (let i = 0; i < groups.length && i < sim.n; i++) {
      groups[i].position.copy(sim.pos[i]);
      groups[i].quaternion.copy(sim.rot[i]);
    }
    if (this.ribbons) {
      const rel = this._rel || (this._rel = new THREE.Vector3());
      const now = (sim.t ?? 0) * 1000;   // simulation time, so trails look the same at any frame rate
      if (now - this._rt >= 16 || now < this._rt) { this._rt = now; this.bodyTrails.forEach((b, i) => { if (b.node < sim.n) this.ribbons.push(i, rel.copy(sim.pos[b.node]).sub(sim.pos[sim.parent[b.node]])); }); }
      // trails are stored relative to what the body circles, so moving the cursor never smears them: they follow the orbit only
      this.bodyTrails.forEach((b, i) => { if (b.node < sim.n) this.ribbons.hist[i].origin.copy(sim.pos[sim.parent[b.node]]); });
      this.ribbons.rebuild();
    }
    const cfg = this.rig.orbit;
    const centre = new Map();
    for (let i = 1; i < sim.n; i++) {
      const rid = sim.segs[i - 1].orbit?.ring;
      if (rid && !centre.has(rid)) centre.set(rid, sim.pos[sim.parent[i]]);
    }
    this.trails.forEach((line, k) => {
      const ring = cfg.rings[k];
      const c = centre.get(ring.id);
      line.visible = !!c && cfg.trails && ring.trail && ring.radius > 0.001;
      if (!line.visible) return;
      line.position.copy(c);
      line.scale.setScalar(ring.radius * (sim.adj?.size ?? 1));
      ringQuat(sim.dyn?.get(ring.id) || ring, line.quaternion);
      line.material.color.set(ring.color);
      line.material.opacity = cfg.trailOpacity;
    });
  }

  dispose() {
    this.ribbons?.dispose();
    this.trails.forEach((l) => l.material.dispose());
    this.trailGeo.dispose();
    super.dispose();
  }
}

export const createSim = (rig) => (isOrbit(rig) ? new OrbitSim(rig) : isParticles(rig) ? new ParticleSim(rig) : new RigSim(rig));
export const createView = (rig, opts) => (isOrbit(rig) ? new OrbitView(rig, opts) : isParticles(rig) ? new ParticleView(rig, opts) : new RigView(rig, opts));

// New orbit rig with a sun and a couple of planets, ready to edit.
export function newOrbitRig(name = 'New orbit') {
  const rig = normalizeRig({ id: uid('rig'), name, scale: 40, type: 'orbit', orbit: {}, segments: [] });
  rig.anchor.attachments.push(newAttachment('sphere', { name: 'sun', color: '#ffc83d', emissive: '#ff9a1f', emissiveIntensity: 1.2, scale: [0.3, 0.3, 0.3] }));
  const r1 = normalizeRing({ name: 'inner orbit', radius: 0.8, tilt: 62, node: -20, speed: 1.8, color: '#9ec5ff' });
  const r2 = normalizeRing({ name: 'outer orbit', radius: 1.5, tilt: 66, node: -28, speed: 1, color: '#ffffff' });
  rig.orbit.rings.push(r1, r2);
  [[r1, '#9ec5ff', 0.12, 'planet 1'], [r2, '#ff8a5c', 0.18, 'planet 2']].forEach(([ring, color, size, nm]) => {
    const seg = newSegment(null, { name: nm, orbit: { ring: ring.id, angle: 0, spin: 1.5 } });
    seg.attachments.push(newAttachment('sphere', { name: nm, color, scale: [size, size, size] }));
    rig.segments.push(seg);
  });
  return rig;
}


// ======================================================================= ribbon trails
// Soft tapering ribbons that fade out along their length. Used behind orbiting bodies and by particles.
export function normalizeTrail(t = {}) {
  return { len: Math.max(2, Math.min(120, Math.round(t.len ?? 40))), width: t.width ?? 0.12, color: t.color || '#ffffff', alpha: t.alpha ?? 0.7,
    ...(t.rainbow ? { rainbow: true } : {}), ...(t.glitter ? { glitter: true } : {}), ...(t.square ? { square: true } : {}), ...(t.smoke ? { smoke: true } : {}) };   // rainbow = colour bands across the ribbon, glitter = twinkling white sparkles, square = keeps its full width right to the end
}

const _rc = new THREE.Vector3();
// Smooths a ribbon's points (two light passes, ends kept) so fast turns draw as curves, not corners. No allocation per frame.
const _sm = [[], []];
function smoothPts(P, n) {
  let src = P;
  for (let pass = 0; pass < 2; pass++) {
    const dst = _sm[pass];
    while (dst.length < n) dst.push(new THREE.Vector3());
    dst[0].copy(src[0]); dst[n - 1].copy(src[n - 1]);
    for (let i = 1; i < n - 1; i++) dst[i].copy(src[i - 1]).add(src[i + 1]).addScaledVector(src[i], 2).multiplyScalar(0.25);
    src = dst;
  }
  return src;
}

export class RibbonSet {
  constructor(count, pts) {
    this.count = count; this.pts = Math.max(2, pts);
    this.hist = Array.from({ length: count }, () => ({ origin: new THREE.Vector3(), p: [], len: this.pts, width: 0.1, color: new THREE.Color('#ffffff'), alpha: 0.7, rainbow: false, glitter: false, square: false, smoke: false }));
    const verts = count * this.pts * 2;
    this.pos = new Float32Array(verts * 3); this.col = new Float32Array(verts * 4); this.uvA = new Float32Array(verts * 4);   // side, distance along the ribbon, rainbow on, glitter on
    const idx = [];
    for (let t = 0; t < count; t++) for (let i = 0; i < this.pts - 1; i++) { const a = (t * this.pts + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('aUV', new THREE.BufferAttribute(this.uvA, 4));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uT: { value: 0 } },
      vertexShader: 'attribute vec4 aCol; attribute vec4 aUV; varying vec4 vC; varying vec4 vU; void main(){ vC = aCol; vU = aUV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'varying vec4 vC; varying vec4 vU; uniform float uT;',
        'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }',
        'vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }',
        'void main() {',
        ' vec3 c = vC.rgb; float a = vC.a;',
        ' if (vU.z > 1.5) {',
        '   float e = 1.0 - abs(vU.x); e = e * e * (3.0 - 2.0 * e);',               // smoke: soft edges, wispy drifting patches, never a hard line
        '   float n = vn(vec2(vU.x * 1.6 + uT * 0.12, vU.y * 2.4 - uT * 0.5)) * 0.65 + vn(vec2(vU.x * 3.7 - uT * 0.2, vU.y * 5.1 - uT * 0.8)) * 0.35;',
        '   a *= e * (0.35 + 1.05 * n); c = mix(c * 0.78, c, n);',
        ' } else if (vU.z > 0.5) { float s = clamp(vU.x * 0.5 + 0.5, 0.0, 0.9999) * 6.0; float b = floor(s); float fr = fract(s);',
        '   c = hsv((b + 0.5) / 6.0 * 0.82, 0.9, 1.0); c = mix(c, vec3(1.0), smoothstep(0.82, 1.0, fr) * 0.0); c *= 0.9 + 0.1 * smoothstep(0.0, 0.12, fr) * smoothstep(1.0, 0.88, fr); }',
        ' if (vU.w > 0.5) {',
        '   vec2 q = vec2(vU.x * 0.5 + 0.5, vU.y);',
        '   float spark = 0.0;',
        '   vec2 g = q * vec2(34.0, 34.0); vec2 id = floor(g); float r = h21(id); float tw = 0.5 + 0.5 * sin(uT * (2.5 + r * 7.0) + r * 40.0);',
        '   spark += step(0.78, r) * tw * 0.8;',                      // fine glitter grain
        '   vec2 g2 = q * vec2(9.0, 9.0); vec2 id2 = floor(g2); float r2 = h21(id2 + 3.1); vec2 d = fract(g2) - 0.5 - (vec2(h21(id2 + 7.0), h21(id2 + 11.0)) - 0.5) * 0.5;',
        '   float tw2 = pow(0.5 + 0.5 * sin(uT * (1.5 + r2 * 3.0) + r2 * 30.0), 2.0);',
        '   float st = exp(-min(abs(d.x), abs(d.y)) * 55.0) * max(0.0, 1.0 - length(d) * 3.2);',   // plus shaped white sparkle
        '   spark += step(0.45, r2) * tw2 * st * 1.4;',
        '   c = mix(c, vec3(1.0), clamp(spark, 0.0, 1.0)); a = max(a, clamp(spark, 0.0, 1.0) * 0.95 * step(0.03, vC.a));',
        ' }',
        ' gl_FragColor = vec4(c, a);',
        '#include <colorspace_fragment>',
        '}'].join('\n'),
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
  }
  style(i, t) { const h = this.hist[i]; h.len = Math.min(this.pts, t.len ?? this.pts); h.width = t.width ?? 0.1; h.color.set(t.color || '#ffffff'); h.alpha = t.alpha ?? 0.7; h.rainbow = !!t.rainbow; h.glitter = !!t.glitter; h.square = !!t.square; h.smoke = !!t.smoke; }
  clear(i) { this.hist[i].p.length = 0; }
  push(i, v) {
    const h = this.hist[i];
    if (h.p.length && h.p[0].distanceTo(v) > 3) h.p.length = 0;   // the cursor jumped: don't stretch a ribbon across the screen
    h.p.unshift(v.clone());
    if (h.p.length > h.len) h.p.pop();
  }
  rebuild() {
    const { pos, col, pts, uvA } = this;
    this.mesh.material.uniforms.uT.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    for (let t = 0; t < this.count; t++) {
      const h = this.hist[t], n = h.p.length;
      const P = n > 2 ? smoothPts(h.p, n) : h.p;
      let arc = 0;
      for (let i = 0; i < pts; i++) {
        const o = (t * pts + i) * 2;
        if (n < 2) { for (let k = 0; k < 2; k++) { const q = (o + k) * 3; pos[q] = pos[q + 1] = pos[q + 2] = 0; col[(o + k) * 4 + 3] = 0; } continue; }
        const j = Math.min(i, n - 1), a = P[Math.max(j - 1, 0)], b = P[Math.min(j + 1, n - 1)], c = _rc.copy(P[j]).add(h.origin);
        let dx = a.x - b.x, dy = a.y - b.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        if (i > 0 && i < n) arc += P[i].distanceTo(P[i - 1]);
        const f = i >= n ? 1 : j / (n - 1);
        const w = h.width * 0.5 * (h.smoke ? (0.45 + 1.1 * f) * (1 - f * f * f) : h.square ? Math.min(1, (1 - f) / 0.12 + 0.12) : Math.pow(1 - f, 0.8));   // square: full width until the very end
        const al = i >= n ? 0 : h.alpha * (h.smoke ? Math.min(1, f / 0.22) * (1 - f * f) * Math.pow(1 - f, 0.6) : h.square ? Math.min(1, 1.15 - Math.pow(f, 2.2)) : Math.pow(1 - f, 1.4));
        for (let k = 0; k < 2; k++) {
          const sg = k ? 1 : -1, q = (o + k) * 3;
          pos[q] = c.x - dy * w * sg; pos[q + 1] = c.y + dx * w * sg; pos[q + 2] = c.z;
          const r = (o + k) * 4; col[r] = h.color.r; col[r + 1] = h.color.g; col[r + 2] = h.color.b; col[r + 3] = al;
          uvA[r] = sg; uvA[r + 1] = arc; uvA[r + 2] = h.smoke ? 2 : h.rainbow ? 1 : 0; uvA[r + 3] = h.glitter ? 1 : 0;
        }
      }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aCol.needsUpdate = true; this.geo.attributes.aUV.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}

// ======================================================================= particles
export const isParticles = (rig) => rig?.type === 'particles';

export const PARTICLE_PRESETS = {
  image: { shape: 'image', max: 60, rate: 8, rateFast: 34, life: [2.0, 3.4], size: [0.55, 0.9], gravity: 0.7, drag: 1.6, flutter: 0.5, tumble: 0.7,
    spread: 0.15, launch: 0.5, push: 0.2, sensitivity: 12, colors: ['#ffffff'],
    trail: { on: false, len: 14, width: 0.05, color: '#ffffff', alpha: 0.4 },
    cursorTrail: { on: false, len: 30, width: 0.12, color: '#ffffff', alpha: 0.5 } },
  blossom: { shape: 'petal', max: 70, rate: 7, rateFast: 34, life: [2.6, 4.4], size: [0.3, 0.48], gravity: 1.3, drag: 1.7, flutter: 1.0, tumble: 2.2,
    spread: 0.12, launch: 0.5, push: 0.18, sensitivity: 12, colors: ['#ff5c9d', '#ff7db3', '#ff3f8a', '#ff9ac4'],
    trail: { on: false, len: 18, width: 0.05, color: '#ffb0cb', alpha: 0.5 },
    cursorTrail: { on: false, len: 30, width: 0.14, color: '#ffb0cb', alpha: 0.6 } },
  snow: { shape: 'snowflake', max: 60, rate: 6, rateFast: 26, life: [3.4, 5.6], size: [0.26, 0.46], gravity: 0.55, drag: 2.3, flutter: 1.15, tumble: 0.8,
    spread: 0.14, launch: 0.35, push: 0.2, sensitivity: 12, colors: ['#ffffff', '#eef7ff', '#dcecff', '#f7fbff'],
    trail: { on: false, len: 14, width: 0.03, color: '#ffffff', alpha: 0.4 },
    cursorTrail: { on: false, len: 30, width: 0.12, color: '#dcecff', alpha: 0.5 } },
  feathers: { shape: 'feather', max: 40, rate: 3, rateFast: 16, life: [2.4, 3.8], size: [0.75, 1.05], gravity: 1.1, drag: 1.9, flutter: 1.4, tumble: 1.1,
    spread: 0.1, launch: 0.5, push: 0.2, sensitivity: 12, colors: ['#050507', '#0a0a0d', '#08080b'],
    trail: { on: false, len: 24, width: 0.1, color: '#d4151b', alpha: 0.85 },
    cursorTrail: { on: true, len: 38, width: 0.2, color: '#d4151b', alpha: 0.9 } },
};

export function normalizeParticles(p = {}) {
  const b = PARTICLE_PRESETS[p.preset] || PARTICLE_PRESETS.blossom;
  const pair = (v, d) => (Array.isArray(v) && v.length >= 2 ? [+v[0], +v[1]] : [...d]);
  const t = { ...b.trail, ...(p.trail || {}) }, ct = { ...b.cursorTrail, ...(p.cursorTrail || {}) };
  return {
    shape: p.shape === 'image' ? (goodImg(p.image) ? 'image' : 'petal') : ['petal', 'feather', 'snowflake'].includes(p.shape) ? p.shape : b.shape,
    ...(goodImg(p.image) ? { image: p.image } : {}),     // custom PNG emitter: every particle is this picture
    max: Math.max(4, Math.min(200, Math.round(p.max ?? b.max))),
    rate: p.rate ?? b.rate, rateFast: p.rateFast ?? b.rateFast,
    life: pair(p.life, b.life), size: pair(p.size, b.size),
    gravity: p.gravity ?? b.gravity, drag: p.drag ?? b.drag, flutter: p.flutter ?? b.flutter, tumble: p.tumble ?? b.tumble,
    spread: p.spread ?? b.spread, launch: p.launch ?? b.launch, push: p.push ?? b.push, sensitivity: p.sensitivity ?? b.sensitivity,
    colors: Array.isArray(p.colors) && p.colors.length ? p.colors.slice(0, 6) : [...b.colors],
    trail: { on: !!t.on, len: Math.max(2, Math.min(80, Math.round(t.len))), width: t.width, color: t.color, alpha: t.alpha },
    cursorTrail: { on: !!ct.on, len: Math.max(2, Math.min(120, Math.round(ct.len))), width: ct.width, color: ct.color, alpha: ct.alpha },
  };
}

export function newParticleRig(name = 'New particles', preset = 'blossom') {
  const cfg = PARTICLE_PRESETS[preset] || PARTICLE_PRESETS.blossom;
  return normalizeRig({ id: uid('rig'), name, scale: 56, type: 'particles', particles: { ...cfg, preset }, segments: [] });
}

export class ParticleSim {
  constructor(rig) { this.setRig(rig); }
  setRig(rig) {
    this.rig = rig; this.cfg = rig.particles;
    this.segs = []; this.n = 1; this.index = new Map();
    this.parent = new Int32Array(1); this.len = new Float32Array(1).fill(0.01);
    this.restQ = [new THREE.Quaternion()]; this.pos = [new THREE.Vector3()]; this.rot = [new THREE.Quaternion()];
    this.parts = Array.from({ length: this.cfg.max }, () => ({ on: false, gen: 0, age: 0, life: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), size: 0.3, color: new THREE.Color(), ph: 0, rest: false, seed: 0 }));
    this.prevT = new THREE.Vector3(); this.cv = new THREE.Vector3(); this.acc = 0; this.t = 0; this.next = 0;
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3();
  }
  segStart() { return this.pos[0].clone(); }
  reset(anchor) {
    this.pos[0].copy(anchor); this.prevT.copy(anchor); this.cv.set(0, 0, 0); this.acc = 0;
    this.parts.forEach((p) => { p.on = false; p.gen++; });
  }
  warm(seconds = 3) {
    const base = this.pos[0].clone(), t = new THREE.Vector3();
    for (let i = 0; i < seconds * 30; i++) { t.set(base.x + Math.sin(i / 9) * 0.9, base.y + Math.cos(i / 14) * 0.2, base.z); this.step(1 / 30, t); }
  }
  _emit(at) {
    const C = this.cfg, r = Math.random;
    let p = null;
    for (let k = 0; k < this.parts.length; k++) { const c = this.parts[(this.next + k) % this.parts.length]; if (!c.on) { p = c; this.next = (this.next + k + 1) % this.parts.length; break; } }
    if (!p) return;
    p.on = true; p.gen++; p.age = 0; p.rest = false;
    p.life = C.life[0] + (C.life[1] - C.life[0]) * r();
    p.size = C.size[0] + (C.size[1] - C.size[0]) * r();
    p.ph = r() * 6.28; p.seed = (r() * 4294967296) >>> 0;   // the snowflake's own recipe: every one grows differently
    const a = r() * 6.28, d = Math.sqrt(r()) * C.spread;
    p.pos.set(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, at.z + (r() - 0.5) * 0.1);
    p.vel.set((r() - 0.5) * 2 * C.launch, r() * C.launch * 0.7, (r() - 0.5) * C.launch).addScaledVector(this.cv, C.push);
    // mostly turning in the screen plane with gentle flips, so they show their faces rather than edge-on slivers
    if (C.shape === 'image') {      // a picture only turns in the screen plane (the Spin slider is its turning speed)
      p.q.setFromEuler(new THREE.Euler(0, 0, r() * 6.28));
      p.w.set(0, 0, (r() < 0.5 ? -1 : 1) * C.tumble * (0.6 + 0.8 * r()));
    } else {
    p.q.setFromEuler(new THREE.Euler((r() - 0.5) * 1.6, (r() - 0.5) * 1.6, r() * 6.28));
    p.w.set((r() - 0.5) * 0.9, (r() - 0.5) * 0.9, (r() - 0.5) * 2.2).normalize().multiplyScalar(C.tumble * (0.5 + r()));
    }
    p.color.set(C.colors[Math.floor(r() * C.colors.length)]);
  }
  step(dt, target, opts = {}) {
    const C = this.cfg; dt = Math.min(0.05, Math.max(1e-4, dt)); this.t += dt;
    this._v.copy(target).sub(this.prevT).divideScalar(dt);
    this.cv.lerp(this._v, 1 - Math.exp(-dt * 10)); this.prevT.copy(target); this.pos[0].copy(target);
    const k = Math.min(1, this.cv.length() / Math.max(0.01, C.sensitivity));
    this.acc += (C.rate + (C.rateFast - C.rate) * k * (2 - k)) * dt;
    while (this.acc >= 1) { this.acc -= 1; this._emit(target); }
    const g = C.gravity * (opts.gravityScale ?? 1), drag = Math.exp(-C.drag * dt);
    for (const p of this.parts) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) { p.on = false; continue; }
      if (p.rest) continue;
      p.vel.y -= g * dt;
      const sw = Math.sin(p.age * (2.1 + (p.ph % 1.7)) + p.ph) * C.flutter;
      p.vel.x += sw * dt * 1.6; p.vel.z += Math.cos(p.age * 1.7 + p.ph) * C.flutter * dt * 0.6;
      if (opts.wind) { p.vel.x += opts.wind.x * dt * 0.16; p.vel.z += opts.wind.z * dt * 0.16; }   // the Wind strength slider sets how hard it blows
      p.vel.multiplyScalar(drag);
      p.pos.addScaledVector(p.vel, dt);
      const wl = p.w.length();
      if (wl > 1e-4) { this._q.setFromAxisAngle(this._v.copy(p.w).divideScalar(wl), wl * dt); p.q.premultiply(this._q).normalize(); }
      if (opts.floorY !== undefined && p.pos.y < opts.floorY) { p.pos.y = opts.floorY; p.rest = true; p.w.set(0, 0, 0); }
    }
  }
}

function petalGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5); s.bezierCurveTo(0.34, -0.4, 0.44, 0.16, 0.17, 0.42); s.lineTo(0.05, 0.46); s.lineTo(0, 0.38); s.lineTo(-0.05, 0.46); s.lineTo(-0.17, 0.42);
  s.bezierCurveTo(-0.44, 0.16, -0.34, -0.4, 0, -0.5);
  const g = new THREE.ShapeGeometry(s, 14);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) P.setZ(i, 0.5 * P.getX(i) * P.getX(i));    // a slight cup, like a real petal
  g.computeVertexNormals();
  return g;
}

// Unique snowflakes. Each flake is grown from its own random recipe (seed): a branching dendrite, a hexagonal plate with an outer ring, or a broad-leaved fern,
// always six-fold symmetric like the real thing, so no two are alike. `grow` fattens every bar a little (used for the pale outline drawn behind the flake).
function snowflakeGeometry(seed, color, grow = 0) {
  let a = seed >>> 0;
  const R = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pos = [], D = Math.PI / 180;
  const quad = (ax, ay, bx, by, w0, w1) => {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-6, nx = -dy / L, ny = dx / L; w0 += grow; w1 += grow * 0.7;
    pos.push(ax + nx * w0, ay + ny * w0, ax - nx * w0, ay - ny * w0, bx + nx * w1, by + ny * w1, ax - nx * w0, ay - ny * w0, bx - nx * w1, by - ny * w1, bx + nx * w1, by + ny * w1);
  };
  const arm = [];                                  // one arm along +Y: [ax, ay, bx, by, w0, w1]; branches are added on both sides so the arm is mirror-symmetric
  const both = (ax, ay, bx, by, w0, w1) => { arm.push([ax, ay, bx, by, w0, w1]); if (Math.abs(bx) > 1e-6 || Math.abs(ax) > 1e-6) arm.push([-ax, ay, -bx, by, w0, w1]); };
  const len = 0.42 + R() * 0.08, kind = R(), rings = [];
  let hub = 0.05 + R() * 0.04;
  if (kind < 0.5) {                                // dendrite: a stem with pairs of side branches, some with twigs of their own
    const n = 2 + Math.floor(R() * 4), wS = 0.018 + R() * 0.014;
    arm.push([0, 0, 0, len, wS, wS * 0.55]);
    for (let j = 0; j < n; j++) {
      const t = 0.2 + (j + R() * 0.6) / n * 0.62, bl = (0.1 + 0.2 * R()) * (1.25 - t), an = (44 + R() * 26) * D, y0 = t * len;
      const bx = Math.sin(an) * bl, by = y0 + Math.cos(an) * bl, wb = wS * (0.5 + R() * 0.3);
      both(0, y0, bx, by, wb, wb * 0.5);
      if (R() < 0.45) { const tl = bl * (0.35 + R() * 0.3), a2 = (an + (25 + R() * 25) * D); both(bx * 0.6, y0 + (by - y0) * 0.6, bx * 0.6 + Math.sin(a2) * tl, y0 + (by - y0) * 0.6 + Math.cos(a2) * tl, wb * 0.6, wb * 0.3); }
    }
    if (R() < 0.7) { const tl = 0.05 + R() * 0.07, an = (35 + R() * 25) * D; both(0, len, Math.sin(an) * tl, len + Math.cos(an) * tl, wS * 0.45, wS * 0.2); }
  } else if (kind < 0.78) {                        // plate: a solid hexagon, short arms, and an outer ring joining the arms
    hub = 0.12 + R() * 0.1; const wS = 0.016 + R() * 0.01;
    arm.push([0, 0, 0, len * (0.85 + R() * 0.15), wS, wS * 0.6]);
    const n = 1 + Math.floor(R() * 2);
    for (let j = 0; j < n; j++) { const t = 0.5 + (j + R() * 0.5) / n * 0.4, bl = (0.08 + 0.12 * R()), an = (50 + R() * 20) * D; both(0, t * len, Math.sin(an) * bl, t * len + Math.cos(an) * bl, wS * 0.6, wS * 0.3); }
    if (R() < 0.75) rings.push(hub + 0.06 + R() * 0.12);
    if (R() < 0.4) rings.push(len * (0.55 + R() * 0.2));
  } else {                                         // fern: a stem with broad pointed leaves
    const n = 2 + Math.floor(R() * 3), wS = 0.014 + R() * 0.01;
    arm.push([0, 0, 0, len, wS, wS * 0.5]);
    for (let j = 0; j < n; j++) {
      const t = 0.18 + (j + R() * 0.5) / n * 0.62, bl = (0.12 + 0.12 * R()) * (1.2 - t), an = (38 + R() * 22) * D, y0 = t * len, wl = 0.035 + R() * 0.03;
      both(0, y0, Math.sin(an) * bl, y0 + Math.cos(an) * bl, wl, 0.004);
    }
  }
  for (let k = 0; k < 6; k++) {
    const c = Math.cos(k * Math.PI / 3), sn = Math.sin(k * Math.PI / 3);
    for (const [ax, ay, bx, by, w0, w1] of arm) quad(ax * c - ay * sn, ax * sn + ay * c, bx * c - by * sn, bx * sn + by * c, w0, w1);
    for (const r of rings) { const k2 = k + 1, c2 = Math.cos(k2 * Math.PI / 3), s2 = Math.sin(k2 * Math.PI / 3); quad(-sn * r, c * r, -s2 * r, c2 * r, 0.011, 0.011); }
    const h0 = hub + grow * 1.5, c2 = Math.cos((k + 1) * Math.PI / 3), s2 = Math.sin((k + 1) * Math.PI / 3);      // hub: a hexagon, one triangle per side
    pos.push(0, 0, -sn * h0, c * h0, -s2 * h0, c2 * h0);
  }
  const n = pos.length / 2, P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), col = new THREE.Color(color);
  for (let i = 0; i < n; i++) { P[i * 3] = pos[i * 2]; P[i * 3 + 1] = pos[i * 2 + 1]; N[i * 3 + 2] = 1; C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}
function featherGeometry() {
  const s = new THREE.Shape(), N = 26;
  const half = (t, side) => (side > 0 ? 0.15 : 0.11) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.85) * (1 + 0.07 * Math.sin(t * 70 + side));
  s.moveTo(0, -0.3);
  for (let i = 1; i <= N; i++) { const t = i / N; s.lineTo(half(t, 1), -0.3 + t * 0.8); }
  for (let i = N - 1; i >= 1; i--) { const t = i / N; s.lineTo(-half(t, -1), -0.3 + t * 0.8); }
  const g = new THREE.ShapeGeometry(s);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) P.setZ(i, 0.35 * P.getX(i) * P.getX(i));
  g.computeVertexNormals();
  return g;
}

const _ip = new THREE.Vector3();
export class ParticleView extends RigView {
  constructor(rig, opts) {
    super(rig, opts);
    const C = rig.particles, M = C.max;
    this.mats = []; this.geos = [];
    const make = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, M); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; this.root.add(m); this.geos.push(geo); this.mats.push(mat); return m; };
    if (C.shape === 'snowflake') {
      // every flake is its own mesh with its own freshly grown crystal (plus a pale-blue outline copy behind it so it also shows on light backgrounds)
      this.flakeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.97, depthWrite: false });
      this.haloMat = new THREE.MeshBasicMaterial({ color: 0x8db8f5, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false });
      this.mats.push(this.flakeMat, this.haloMat); this.body = null;
      this.flakes = Array.from({ length: M }, () => {
        const halo = new THREE.Mesh(new THREE.BufferGeometry(), this.haloMat); halo.position.z = -0.003; halo.frustumCulled = false;
        const m = new THREE.Mesh(new THREE.BufferGeometry(), this.flakeMat); m.frustumCulled = false; m.visible = false; m.add(halo); m.userData.halo = halo; this.root.add(m); return m;
      });
      this.flakeGen = new Int32Array(M).fill(-1);
    } else if (C.shape === 'image' && C.image) {
      const tex = new THREE.TextureLoader().load(C.image, (t) => {
        const w = t.image?.width || 1, h = t.image?.height || 1, k = 1 / Math.max(w, h);
        const g = new THREE.PlaneGeometry(w * k, h * k); this.body.geometry.dispose(); this.body.geometry = g; this.geos.push(g);
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      this.imgFlat = true;
      this.body = make(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      this.mats.push(tex);
    } else if (C.shape === 'feather') {
      this.body = make(featherGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, envMapIntensity: 0.45, side: THREE.DoubleSide }));
      const quill = new THREE.PlaneGeometry(0.02, 0.86); quill.translate(0, -0.02, 0.004);
      this.quill = make(quill, new THREE.MeshStandardMaterial({ color: 0x1c1c21, roughness: 0.5, side: THREE.DoubleSide }));
    } else {
      this.body = make(petalGeometry(), new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.6, envMapIntensity: 0.4, side: THREE.DoubleSide }));
    }
    this.ribbons = C.trail.on ? new RibbonSet(M, C.trail.len) : null;
    if (this.ribbons) { for (let i = 0; i < M; i++) this.ribbons.style(i, C.trail); this.root.add(this.ribbons.mesh); }
    this.cursorRibbon = C.cursorTrail.on ? new RibbonSet(1, C.cursorTrail.len) : null;
    if (this.cursorRibbon) { this.cursorRibbon.style(0, C.cursorTrail); this.root.add(this.cursorRibbon.mesh); }
    this.gens = new Int32Array(M).fill(-1); this._o = new THREE.Object3D(); this._rt = 0;
    if (this.body) this.body.setColorAt(0, new THREE.Color(0xffffff));
  }
  _updateSnow(sim) {
    const tick = (sim.t ?? 0) * 1000 - this._rt >= 16 || (sim.t ?? 0) * 1000 < this._rt;
    if (tick) this._rt = (sim.t ?? 0) * 1000;
    sim.parts.forEach((p, i) => {
      const m = this.flakes[i];
      if (!p.on) { m.visible = false; if (this.ribbons && this.gens[i] !== -2) { this.ribbons.clear(i); this.gens[i] = -2; } return; }
      if (this.flakeGen[i] !== p.gen) {
        const halo = m.userData.halo; m.geometry.dispose(); halo.geometry.dispose();
        m.geometry = snowflakeGeometry(p.seed, p.color, 0); halo.geometry = snowflakeGeometry(p.seed, p.color, 0.012);
        this.flakeGen[i] = p.gen;
      }
      const fade = Math.min(1, p.age / 0.3) * Math.min(1, (p.life - p.age) / 0.9);
      m.visible = true; m.position.copy(p.pos); m.quaternion.copy(p.q); m.scale.setScalar(Math.max(1e-4, p.size * 2 * fade)); m.updateMatrix();
      if (this.ribbons) { if (this.gens[i] !== p.gen) { this.ribbons.clear(i); this.gens[i] = p.gen; } if (tick) this.ribbons.push(i, p.pos); }
    });
    this.ribbons?.rebuild();
    if (this.cursorRibbon) { if (tick) this.cursorRibbon.push(0, sim.pos[0]); this.cursorRibbon.rebuild(); }
  }
  update(sim) {
    super.update(sim);
    if (this.flakes) return this._updateSnow(sim);
    const o = this._o, now = (sim.t ?? 0) * 1000, tick = now - this._rt >= 16 || now < this._rt;
    if (tick) this._rt = now;
    sim.parts.forEach((p, i) => {
      if (!p.on) { o.position.set(0, 0, 0); o.scale.set(0, 0, 0); o.updateMatrix(); this._set(i, o); if (this.ribbons && this.gens[i] !== -2) { this.ribbons.clear(i); this.gens[i] = -2; } return; }
      const fade = Math.min(1, p.age / 0.3) * Math.min(1, (p.life - p.age) / 0.7);
      o.position.copy(p.pos);
      if (this.imgFlat) { const ax = _ip.set(1, 0, 0).applyQuaternion(p.q); o.quaternion.setFromAxisAngle(AX_Z, Math.atan2(ax.y, ax.x)); }   // a picture only turns in the screen plane, so it never goes edge-on
      else o.quaternion.copy(p.q);
      o.scale.setScalar(Math.max(1e-4, p.size * fade)); o.updateMatrix();
      this._set(i, o); this.body.setColorAt(i, p.color);
      if (this.ribbons) { if (this.gens[i] !== p.gen) { this.ribbons.clear(i); this.gens[i] = p.gen; } if (tick) this.ribbons.push(i, p.pos); }
    });
    this.body.instanceMatrix.needsUpdate = true; if (this.quill) this.quill.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    this.ribbons?.rebuild();
    if (this.cursorRibbon) { if (tick) this.cursorRibbon.push(0, sim.pos[0]); this.cursorRibbon.rebuild(); }
  }
  _set(i, o) { this.body.setMatrixAt(i, o.matrix); this.quill?.setMatrixAt(i, o.matrix); }
  dispose() {
    this.ribbons?.dispose(); this.cursorRibbon?.dispose(); this.geos.forEach((g) => g.dispose()); this.mats.forEach((m) => m.dispose());
    this.body?.dispose(); this.quill?.dispose();
    this.flakes?.forEach((m) => { m.geometry.dispose(); m.userData.halo.geometry.dispose(); });
    super.dispose();
  }
}

// ------------------------------------------------------------------ impact particles
// Little bursts where a chain smacks into the floor or a screen side: wood chips, blood mist, sparks or dust.
// Everything is in screen pixels (the overlay's units), drawn as one cheap point cloud.
export class ImpactFX {
  constructor(scene, pixelRatio = 1) {
    const N = this.N = 900;
    this.P = Array.from({ length: N }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, s0: 1, grow: 1, a0: 1, r: 0, spin: 0, grav: 0, drag: 0, shape: 0, c: [1, 1, 1], fade: 0.6 }));
    this.cur = 0; this.active = 0; this.budget = 0;
    this.aPos = new Float32Array(N * 3); this.aCol = new Float32Array(N * 4); this.aSize = new Float32Array(N); this.aRot = new Float32Array(N); this.aShape = new Float32Array(N);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.aCol, 4));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.aRot, 1));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.aShape, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uPR: { value: pixelRatio } },
      vertexShader: 'attribute vec4 aColor; attribute float aSize; attribute float aRot; attribute float aShape; varying vec4 vC; varying float vR; varying float vS; uniform float uPR;\nvoid main(){ vC = aColor; vR = aRot; vS = aShape; gl_PointSize = aSize * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec4 vC; varying float vR; varying float vS;\nvoid main(){ vec2 p = gl_PointCoord - 0.5; float a;\n'
        + ' if (vS < 0.5) { float d = length(p) * 2.0; a = clamp(1.0 - d, 0.0, 1.0); a = a * a * (3.0 - 2.0 * a); }\n'
        + ' else if (vS < 1.5) { float c = cos(vR), s = sin(vR); vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y); a = (abs(q.x) < 0.4 && abs(q.y) < 0.27) ? 1.0 : 0.0; }\n'
        + ' else { float d = length(p) * 2.0; a = 1.0 - smoothstep(0.8, 1.0, d); }\n'
        + ' if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, vC.a * a); }',
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 80;
    scene.add(this.points);
  }
  setPixelRatio(v) { this.mat.uniforms.uPR.value = v; }

  _add(o) {
    const p = this.P[this.cur]; this.cur = (this.cur + 1) % this.N;
    Object.assign(p, { on: true, age: 0, grow: 1, a0: 1, r: Math.random() * 6.28, spin: 0, grav: 0, drag: 0, shape: 0, fade: 0.6 }, o);
    p.s0 = o.size; this._dirty = true;
  }
  // x, y: where (screen pixels); nx, ny: which way the surface faces; speed: how hard (rig units/s); ppu: pixels per rig unit
  burst(style, x, y, nx, ny, speed, ppu, amount = 1) {
    if (this.budget <= 0) return; this.budget--;
    const AM = Math.max(0, Math.min(4, amount)), C = (n) => Math.round(n * AM);
    const k = Math.min(1.8, 0.55 + speed / 14), u = Math.max(0.6, Math.min(2, ppu / 46));
    const R = Math.random, base = Math.atan2(ny, nx);
    const dir = (spread) => { const a = base + (R() * 2 - 1) * spread; return [Math.cos(a), Math.sin(a)]; };
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    if (style === 'wood') {
      const cols = [[0.48, 0.29, 0.16], [0.66, 0.42, 0.23], [0.79, 0.6, 0.38], [0.35, 0.2, 0.1], [0.88, 0.75, 0.54]];
      for (let i = 0, n = C(14 * k + 4); i < n; i++) { const [dx, dy] = dir(1.25), sp = (70 + R() * 250) * k * u;
        this._add({ x, y, vx: dx * sp, vy: dy * sp, size: (3 + R() * 5.5) * u, c: pick(cols), shape: 1, grav: 950 * u, drag: 0.7, spin: (R() * 2 - 1) * 16, life: 0.55 + R() * 0.5, fade: 0.65 }); }
      for (let i = 0, n2 = C(6); i < n2; i++) { const [dx, dy] = dir(1.4), sp = (120 + R() * 280) * k * u;
        this._add({ x, y, vx: dx * sp, vy: dy * sp, size: (1.6 + R() * 1.6) * u, c: [0.9, 0.78, 0.55], shape: 2, grav: 800 * u, drag: 0.5, life: 0.4 + R() * 0.4, fade: 0.6 }); }
    } else if (style === 'blood') {
      for (let i = 0, n = C(14 * k + 6); i < n; i++) { const [dx, dy] = dir(1.5), sp = (25 + R() * 140) * k * u, m = R();
        this._add({ x, y, vx: dx * sp, vy: dy * sp, size: (10 + R() * 11) * u, grow: 2.4 + R(), c: [0.55 + m * 0.2, 0.01, 0.03 + m * 0.03], a0: 0.35 + R() * 0.25, shape: 0, grav: 60 * u, drag: 2.2, life: 0.5 + R() * 0.5, fade: 0.2 }); }
      for (let i = 0, n2 = C(7); i < n2; i++) { const [dx, dy] = dir(1.5), sp = (90 + R() * 270) * k * u;
        this._add({ x, y, vx: dx * sp, vy: dy * sp, size: (2 + R() * 2.6) * u, c: [0.45, 0.0, 0.02], a0: 0.95, shape: 2, grav: 900 * u, drag: 0.4, life: 0.6 + R() * 0.45, fade: 0.7 }); }
    } else if (style === 'sparks') {
      for (let i = 0, n = C(12 * k + 4); i < n; i++) { const [dx, dy] = dir(1.3), sp = (140 + R() * 300) * k * u;
        this._add({ x, y, vx: dx * sp, vy: dy * sp, size: (2 + R() * 2) * u, c: pick([[1, 0.9, 0.5], [1, 0.75, 0.3], [1, 1, 0.85]]), shape: 2, grav: 650 * u, drag: 0.8, life: 0.25 + R() * 0.3, fade: 0.4 }); }
    } else {   // dust
      for (let i = 0, n = C(8 * k + 4); i < n; i++) { const [dx, dy] = dir(1.5), sp = (20 + R() * 80) * k * u;
        this._add({ x, y, vx: dx * sp, vy: dy * sp, size: (10 + R() * 8) * u, grow: 2.2, c: [0.78, 0.74, 0.68], a0: 0.3 + R() * 0.15, shape: 0, grav: -15 * u, drag: 2, life: 0.7 + R() * 0.45, fade: 0.1 }); }
    }
  }
  update(dt) {
    this.budget = 5;
    if (!this.active && !this._dirty) return;
    let live = 0;
    for (let i = 0; i < this.N; i++) {
      const p = this.P[i];
      if (p.on) {
        p.age += dt;
        if (p.age >= p.life) { p.on = false; this.aSize[i] = 0; }
        else {
          const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; p.vy -= p.grav * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.spin * dt;
          const f = p.age / p.life, fa = f < p.fade ? 1 : 1 - (f - p.fade) / (1 - p.fade);
          this.aPos[i * 3] = p.x; this.aPos[i * 3 + 1] = p.y; this.aPos[i * 3 + 2] = 0;
          this.aCol[i * 4] = p.c[0]; this.aCol[i * 4 + 1] = p.c[1]; this.aCol[i * 4 + 2] = p.c[2]; this.aCol[i * 4 + 3] = p.a0 * Math.max(0, fa);
          this.aSize[i] = p.s0 * (1 + (p.grow - 1) * f); this.aRot[i] = p.r; this.aShape[i] = p.shape;
          live++;
        }
      }
    }
    this.active = live; this._dirty = live > 0;
    for (const n of ['position', 'aColor', 'aSize', 'aRot', 'aShape']) this.geo.attributes[n].needsUpdate = true;
  }
}
