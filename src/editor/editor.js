import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as RC from '../lib/rig-core.js';
import { createBuilder } from './builder.js';

const api = window.rigApi;
const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
};
const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p;
const deepCopy = (o) => JSON.parse(JSON.stringify(o));

// ----------------------------------------------------------------- state
let rig = null;
let savedSnapshot = '';
let lastSnapshot = '';
let undoStack = [], redoStack = [];
let sel = { type: 'rig' };
let gizmoMode = 'translate';
let simulating = false;
const collapsed = new Set();
let rigList = [];

// ----------------------------------------------------------------- scene
const vp = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
vp.prepend(renderer.domElement);
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
RC.addDefaultLights(scene);
RC.addEnvironment(renderer, scene);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500);
camera.position.set(4.5, -1.2, 10);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, -2.2, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.15;
const ORBIT_EDIT = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const ORBIT_SIM = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
orbit.mouseButtons = { ...ORBIT_EDIT };

const grid = new THREE.Group();
scene.add(grid);
const gridXZ = new THREE.GridHelper(20, 40, 0x3c4250, 0x262a33);
grid.add(gridXZ);
const axes = new THREE.AxesHelper(0.6);
axes.material.depthTest = false; axes.renderOrder = 5;
scene.add(axes);

// A red dot marks the point the chain hangs from. Where that sits relative to the real pointer is a
// global setting in the menu ("Set up your chain position"), not part of any one chain.
const anchorMark = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff2a2a, depthTest: false }));
anchorMark.renderOrder = 9;
anchorMark.userData.pickAnchor = true;
scene.add(anchorMark);
// Always the same size on screen, however far you zoom: a red dot with a white ring, cross-hairs and a label,
// so it is obvious where the mouse cursor connects and what to move to line a rig up with it.
anchorMark.onBeforeRender = (r, s, cam) => anchorMark.scale.setScalar(cam.position.distanceTo(anchorMark.position) * 0.343);
const markTex = (draw, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const markSprite = (map, sx, sy, center) => {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true, sizeAttenuation: false }));
  m.scale.set(sx, sy, 1); m.center.set(...center); m.renderOrder = 10; scene.add(m); return m;
};
const ringMark = markSprite(markTex((g, w, h) => {
  g.translate(w / 2, h / 2); g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 36, 0, 7); g.stroke();
  g.strokeStyle = '#ff2a2a'; g.lineWidth = 4;
  for (const [x, y] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { g.beginPath(); g.moveTo(x * 40, y * 40); g.lineTo(x * 62, y * 62); g.stroke(); }
}, 128, 128), 0.11, 0.11, [0.5, 0.5]);

let sim = null, view = null, bones = [];
const proxy = new THREE.Object3D();
scene.add(proxy);
const tc = new TransformControls(camera, renderer.domElement);
tc.setSize(0.8);
scene.add(tc.getHelper ? tc.getHelper() : tc);

const BONE_COLOR = new THREE.Color('#7d8799');
const BONE_SEL = new THREE.Color('#f2b134');
const BONE_CHILD = new THREE.Color('#b59660');
const BONE_HL = new THREE.Color('#22d3ee');

function boneMesh(len) {
  const w = Math.min(0.09, Math.max(0.025, len * 0.13));
  const geo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(w, -len * 0.18), new THREE.Vector2(0, -len)], 4);
  geo.rotateY(Math.PI / 4);
  const mat = new THREE.MeshBasicMaterial({ color: BONE_COLOR, transparent: true, opacity: 0.55, depthTest: false });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 6;
  const jointMat = new THREE.MeshBasicMaterial({ color: BONE_COLOR, transparent: true, opacity: 0.8, depthTest: false });
  const j = new THREE.Mesh(new THREE.SphereGeometry(w * 0.55, 10, 8), jointMat);
  j.position.y = -len;
  j.renderOrder = 6;
  m.add(j);
  return m;
}

// --------------------------------------------------------------- helpers
const segById = (id) => rig.segments.find((s) => s.id === id);
function findAtt(id) {
  for (const a of rig.anchor.attachments) if (a.id === id) return { att: a, seg: null, list: rig.anchor.attachments };
  for (const s of rig.segments) for (const a of s.attachments) if (a.id === id) return { att: a, seg: s, list: s.attachments };
  return null;
}
const nodeIndex = (segId) => (segId ? sim.index.get(segId) : 0);
const anchorPos = () => new THREE.Vector3(...rig.anchor.offset);

function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------- build / pose
function rebuild() {
  view?.dispose();
  sim = RC.createSim(rig);
  sim.reset(anchorPos());
  view = RC.createView(rig, { assetUrl: api.modelUrl, onModelError: (a) => toast(`Couldn't load model “${a.name}”`) });
  view.spinEnabled = !!(document.getElementById('chk-spin')?.checked);   // idle twist is for the live cursor: off while editing unless 'Show spin' is ticked
  scene.add(view.root);
  bones = [];
  view.groups.forEach((g, i) => {
    if (i === 0 || RC.isOrbit(rig)) return;
    const b = boneMesh(sim.len[i]);
    b.userData.boneSeg = g.userData.node.segId;
    b.visible = $('#chk-bones').checked;
    g.add(b);
    bones[i] = b;
  });
  view.update(sim);
  // Skinned (ragdoll) models finish loading after this point, and until the view updates once more their body sits un-posed at the cursor, away from its skeleton: pose it as soon as they are in.
  const vw = view; vw.ready?.then(() => { if (view === vw && sim) { vw.update(sim); updateMarkers(); } });
  updateMarkers();
  paintBones();
  attachGizmo();
  refreshChainPanel();
  refreshBuilder();
}

function repose() {
  // fast path: no structural change, only rest pose / lengths
  if (!sim) return rebuild();
  sim.reset(anchorPos());
  view.update(sim);
  updateMarkers();
}

function updateMarkers() {
  anchorMark.position.copy(sim.pos[0]);
  ringMark.position.copy(sim.pos[0]);
}

function placeGrid() {
  let minY = 0;
  if (sim) for (let i = 0; i < sim.n; i++) minY = Math.min(minY, sim.pos[i].y);
  gridXZ.position.y = Math.floor(minY - 0.6);
}

function paintBones() {
  if (!sim) return;
  const selSeg = sel.type === 'segment' ? sel.segId : null;
  const desc = selSeg ? new Set(RC.descendants(rig, selSeg).map((s) => s.id)) : new Set();
  const hs = chainOpen ? highlightIds() : null;
  bones.forEach((b) => {
    if (!b) return;
    const id = b.userData.boneSeg;
    let c = id === selSeg ? BONE_SEL : desc.has(id) ? BONE_CHILD : BONE_COLOR;
    let op = id === selSeg ? 0.85 : 0.5;
    if (hs) { if (hs.has(id)) { c = id === selSeg ? BONE_SEL : BONE_HL; op = 0.95; } else op = 0.14; }
    b.visible = $('#chk-bones').checked || !!(hs && hs.has(id));
    b.material.color.copy(c);
    b.children[0].material.color.copy(c);
    b.material.opacity = op; b.children[0].material.opacity = hs && !hs.has(id) ? 0.14 : 0.8;
  });
}

// ---------------------------------------------------------------- gizmo
let gizmoTarget = null;
let groupStart = null;
function attachGizmo() {
  tc.detach();
  gizmoTarget = null;
  if (simulating || !sim) return;
  const ids = selectedAttIds();
  if (ids.length > 1) {
    const items = ids.map((id) => ({ id, obj: view.attObjects.get(id) })).filter((x) => x.obj);
    if (items.length < 2) { multi = new Set(); return attachGizmo(); }
    const c = new THREE.Vector3();
    items.forEach((it) => { it.obj.updateWorldMatrix(true, false); it.world = it.obj.matrixWorld.clone(); c.add(new THREE.Vector3().setFromMatrixPosition(it.world)); });
    c.divideScalar(items.length);
    proxy.position.copy(c); proxy.quaternion.identity(); proxy.scale.set(1, 1, 1);
    proxy.updateMatrix();
    groupStart = { inv: proxy.matrix.clone().invert(), items };
    tc.setSpace('world');
    tc.setMode(gizmoMode);
    tc.attach(proxy);
    gizmoTarget = 'group';
  } else if (sel.type === 'attachment') {
    const obj = view.attObjects.get(sel.attId);
    if (!obj) return;
    tc.setSpace('local');
    tc.setMode(gizmoMode);
    tc.attach(obj);
    gizmoTarget = 'attachment';
  } else if (sel.type === 'segment' && !RC.isOrbit(rig)) {
    const i = nodeIndex(sel.segId);
    if (!i) return;
    const mode = gizmoMode === 'scale' ? 'rotate' : gizmoMode;
    proxy.position.copy(mode === 'translate' ? sim.pos[i] : sim.segStart(i));
    proxy.quaternion.copy(sim.rot[i]);
    proxy.scale.set(1, 1, 1);
    tc.setSpace(mode === 'translate' ? 'world' : 'local');
    tc.setMode(mode);
    tc.attach(proxy);
    gizmoTarget = 'segment';
  } else if (sel.type === 'anchor') {
    proxy.position.copy(sim.pos[0]);
    proxy.quaternion.identity();
    tc.setSpace('world');
    tc.setMode('translate');
    tc.attach(proxy);
    gizmoTarget = 'anchor';
  }
  paintModeButtons();
}

// Hold Shift while rotating with the gizmo: the rotation values click to whole 15 degree steps (0, 15, 30, 45 ... 90 ... 180), so equal, tidy angles are easy to hit.
// (The gizmo's own snap only counts from where the drag started, which gives odd numbers when a part starts at, say, 7 degrees, so the snapping is done on the final angles here.)
const ROT_SNAP_DEG = 15;
let shiftDown = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; }, true);
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; }, true);
window.addEventListener('blur', () => { shiftDown = false; });
renderer.domElement.addEventListener('pointerdown', (e) => { shiftDown = e.shiftKey; }, true);
renderer.domElement.addEventListener('pointermove', (e) => { shiftDown = e.shiftKey; }, true);
const snapDeg = (r) => THREE.MathUtils.degToRad(Math.round(THREE.MathUtils.radToDeg(r) / ROT_SNAP_DEG) * ROT_SNAP_DEG) + 0;
function snapRotationNow() {
  if (!shiftDown || tc.mode !== 'rotate' || !tc.dragging) return;
  if (gizmoTarget === 'attachment' && tc.object) {
    const o = tc.object; o.rotation.set(snapDeg(o.rotation.x), snapDeg(o.rotation.y), snapDeg(o.rotation.z));
  } else if (gizmoTarget === 'segment') {
    const s = segById(sel.segId); if (!s) return; const i = nodeIndex(s.id); const par = sim.parent[i];
    const rest = sim.rot[par].clone().invert().multiply(proxy.quaternion.clone());
    const e = new THREE.Euler().setFromQuaternion(rest, 'XYZ');
    e.set(snapDeg(e.x), snapDeg(e.y), snapDeg(e.z));
    proxy.quaternion.copy(sim.rot[par]).multiply(new THREE.Quaternion().setFromEuler(e));
  }
}
tc.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (!e.value) { const wasGroup = gizmoTarget === 'group'; try { api.logDebug?.('EDITOR drag ended target=' + gizmoTarget + ' changed=' + (snapshot() !== lastSnapshot)); } catch {} commit(); renderInspector(); if (wasGroup) attachGizmo(); }
});

tc.addEventListener('objectChange', () => {
  snapRotationNow();
  if (gizmoTarget === 'group' && groupStart) {
    proxy.updateMatrix();
    const delta = proxy.matrix.clone().multiply(groupStart.inv);
    const d = THREE.MathUtils.radToDeg;
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler();
    for (const it of groupStart.items) {
      const f = findAtt(it.id); if (!f) continue;
      const parent = it.obj.parent;
      parent.updateWorldMatrix(true, false);
      new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(delta.clone().multiply(it.world)).decompose(P, Q, S);
      it.obj.position.copy(P); it.obj.quaternion.copy(Q); it.obj.scale.copy(S);
      E.setFromQuaternion(Q, 'XYZ');
      f.att.position = P.toArray().map((v) => round(v));
      f.att.rotation = [E.x, E.y, E.z].map((v) => round(d(v), 2));
      f.att.scale = S.toArray().map((v) => round(Math.max(0.001, Math.abs(v))));
    }
    return;
  }
  if (gizmoTarget === 'attachment') {
    const f = findAtt(sel.attId); if (!f) return;
    const o = tc.object;
    const d = THREE.MathUtils.radToDeg;
    f.att.position = o.position.toArray().map((v) => round(v));
    f.att.rotation = [o.rotation.x, o.rotation.y, o.rotation.z].map((v) => round(d(v), 2));
    f.att.scale = o.scale.toArray().map((v) => round(Math.max(0.001, Math.abs(v))));
    liveInspector();
  } else if (gizmoTarget === 'segment') {
    const s = segById(sel.segId); const i = nodeIndex(s.id); const p = sim.parent[i];
    let world;
    if (tc.mode === 'translate') {
      const d = proxy.position.clone().sub(sim.pos[p]);
      const len = d.length();
      if (len < 0.01) return;
      s.length = round(len);
      const curDir = new THREE.Vector3(0, -1, 0).applyQuaternion(sim.rot[i]);
      world = new THREE.Quaternion().setFromUnitVectors(curDir, d.normalize()).multiply(sim.rot[i]);
      sim.len[i] = s.length;
    } else world = proxy.quaternion.clone();
    const rest = sim.rot[p].clone().invert().multiply(world).normalize();
    s.rest = rest.toArray().map((v) => round(v, 5));
    sim.restQ[i].copy(rest);
    sim.reset(anchorPos());
    view.update(sim);
    if (tc.mode === 'translate' && bones[i]) {
      // keep the bone mesh in sync with the new length
      const g = bones[i].parent; g.remove(bones[i]);
      bones[i] = boneMesh(sim.len[i]); bones[i].userData.boneSeg = s.id; g.add(bones[i]); paintBones();
    }
    updateMarkers();
    liveInspector();
  } else if (gizmoTarget === 'anchor') {
    rig.anchor.offset = proxy.position.toArray().map((v) => round(v));
    repose();
    liveInspector();
  }
});

function setGizmoMode(m) {
  gizmoMode = m;
  attachGizmo();
  paintModeButtons();
}
function paintModeButtons() {
  document.querySelectorAll('#gizmo-modes .btn').forEach((b) => {
    const m = b.dataset.mode;
    let eff = gizmoMode;
    if (sel.type === 'segment' && eff === 'scale') eff = 'rotate';
    if (sel.type === 'anchor') eff = 'translate';
    b.classList.toggle('on', m === eff && ['attachment', 'segment', 'anchor'].includes(sel.type) && !simulating);
    b.disabled = simulating || (sel.type === 'anchor' && m !== 'translate') || (sel.type === 'segment' && m === 'scale');
  });
}
document.querySelectorAll('#gizmo-modes .btn').forEach((b) => b.addEventListener('click', () => setGizmoMode(b.dataset.mode)));

// -------------------------------------------------------- history / dirty
function snapshot() { return JSON.stringify(rig); }
function commit() {
  const s = snapshot();
  if (s === lastSnapshot) return;
  try { api.logDebug?.('EDITOR changed ' + rig.id + ' ' + rig.segments.flatMap((x) => x.attachments.filter((a) => a.kind === 'model').map((a) => a.name + ' pos=' + JSON.stringify(a.position) + ' rot=' + JSON.stringify(a.rotation) + ' size=' + JSON.stringify(a.scale))).join(' | ') + ' segs=' + rig.segments.map((x) => x.name + ':' + x.length + ':' + JSON.stringify(x.rest)).join(',')); } catch {}
  undoStack.push(lastSnapshot);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  lastSnapshot = s;
  paintStatus();
}
function restore(s) {
  rig = RC.normalizeRig(JSON.parse(s));
  lastSnapshot = s;
  if (sel.type === 'segment' && !segById(sel.segId)) sel = { type: 'rig' };
  if (sel.type === 'attachment' && !findAtt(sel.attId)) sel = { type: 'rig' };
  rebuild(); renderTree(); renderInspector(); paintStatus();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
const isDirty = () => snapshot() !== savedSnapshot;

function paintStatus() {
  const st = $('#vp-status');
  st.innerHTML = '';
  st.append(h('span', { class: 'pill' }, rig.name));
  if (isDirty()) st.append(h('span', { class: 'pill dirty' }, '● unsaved'));
  if (simulating) st.append(h('span', { class: 'pill sim' }, 'SIMULATING'));
  $('#btn-save').classList.toggle('dirty', isDirty());
  $('#btn-undo').disabled = !undoStack.length;
  $('#btn-redo').disabled = !redoStack.length;
  document.title = `${isDirty() ? '• ' : ''}${rig.name} — Cursor Rig Editor`;
  $('#vp-hint').textContent = simulating
    ? 'Left-drag: move the cursor  ·  Right-drag: orbit  ·  Middle-drag: pan  ·  Space: stop'
    : 'Click: select  ·  Left-drag: orbit  ·  Right-drag: pan  ·  Wheel: zoom  ·  F: focus  ·  Del: delete';
}

// ---------------------------------------------------------- loading
async function refreshRigList(selectId) {
  rigList = await api.listRigs();
  const s = $('#rig-select');
  s.innerHTML = '';
  const ids = new Set(rigList.map((r) => r.id));
  if (rig && !ids.has(rig.id)) s.append(h('option', { value: rig.id }, rig.name + ' (unsaved)'));
  for (const r of rigList) s.append(h('option', { value: r.id }, r.name));
  s.value = selectId ?? rig?.id ?? '';
}

function paintTypeButtons() {
  const orbitMode = RC.isOrbit(rig);
  const pm = RC.isParticles(rig);
  $('#add-seg').style.display = pm ? 'none' : '';
  $('#add-part').style.display = pm ? 'none' : '';
  $('#add-seg').textContent = orbitMode ? '+ Planet' : '+ Segment';
  $('#add-seg').title = orbitMode ? 'Add a planet (select a planet first to add a moon to it)' : 'Add a segment under the selection';
  $('#add-chain').style.display = orbitMode || pm ? 'none' : '';
  $('#add-extend').style.display = $('#add-link').style.display = orbitMode || pm ? 'none' : '';
  $('#btn-check').style.display = orbitMode || pm ? 'none' : '';
}

function confirmDiscard() {
  return !rig || !isDirty() || confirm(`“${rig.name}” has unsaved changes. Discard them?`);
}

async function openRig(id) {
  let easyStart = false;
  let data;
  if (id === '__new__' || !id) {
    let kind = 'chain', copyOf = null;
    if (id === '__new__') {
      // 1. what kind of cursorchain, 2. start blank or from one you already have
      const t = await modal('New cursorchain', [
        { key: 'kind', label: 'Type', type: 'select', value: 'chain', options: [['chain', 'Cursorchain: hangs from the cursor and swings'], ['orbit', 'Cursorbit: bodies circle the cursor'], ['particles', 'Cursor Emitter: the cursor sheds petals, feathers and more']] },
        { type: 'note', title: 'Chain', text: 'Links, charms, tails, keychains: anything that dangles and swings.' },
        { type: 'note', title: 'Orbit', text: 'Planets, stars, moons: bodies on tilted rings that speed up when you move the mouse.' },
        { type: 'note', title: 'Particles', text: 'A stream of falling petals, feathers or sparks that drift away from the cursor.' },
      ], 'Next');
      if (t?.kind === 'orbit') kind = 'orbit';
      if (t?.kind === 'particles') kind = 'particles';
      if (t) {
        const have = ((await api.state()).rigs || []).filter((r) => (r.type || 'chain') === kind);
        const blank = kind === 'orbit' ? 'Blank orbit (sun and two planets)' : kind === 'particles' ? 'Cherry blossom petals' : 'Blank chain (six links)';
        const opts = [...(kind === 'chain' ? [['__easy', 'Easy keychain: ring, chain and a charm (use the Keychain builder to shape it)']] : []), ['', blank], ...(kind === 'particles' ? [['__feathers', 'Black feathers with a red trail'], ['__snow', 'Snow: unique snowflakes']] : []), ...have.map((r) => [r.id, 'Copy of: ' + r.name])];
        const v = await modal(kind === 'orbit' ? 'New orbit: start from' : kind === 'particles' ? 'New particles: start from' : 'New chain: start from', [{ key: 'tpl', label: 'Template', type: 'select', value: kind === 'chain' ? '__easy' : '', options: opts }], 'Create');
        copyOf = v?.tpl || null;
        if (copyOf === '__easy') { copyOf = null; easyStart = true; }
        if (copyOf === '__feathers') { copyOf = null; kind = 'particles:feathers'; }
        if (copyOf === '__snow') { copyOf = null; kind = 'particles:snow'; }
      }
    }
    if (copyOf) {
      const src = await api.loadRig(copyOf);
      data = src ? { ...JSON.parse(JSON.stringify(src)), id: RC.uid('rig'), name: src.name + ' copy' } : null;
    }
    if (!data) data = kind === 'orbit' ? RC.newOrbitRig('New orbit') : kind === 'particles' ? RC.newParticleRig('New petals', 'blossom') : kind === 'particles:feathers' ? RC.newParticleRig('New feathers', 'feathers') : kind === 'particles:snow' ? RC.newParticleRig('Snow', 'snow') : RC.newRig('New rig');
  } else data = await api.loadRig(id);
  if (!data) data = RC.newRig('New rig');
  rig = RC.normalizeRig(data);
  paintTypeButtons();
  savedSnapshot = (id === '__new__' || !id) ? '' : snapshot();
  lastSnapshot = snapshot();
  undoStack = []; redoStack = [];
  sel = { type: 'rig' };
  if (simulating) toggleSim(false);
  rebuild();
  placeGrid();
  frameAll();
  renderTree();
  renderInspector();
  await refreshRigList(rig.id);
  paintStatus();
  if (easyStart && builder) { builder.preset('keychain'); frameAll(); setTab('build'); }
  else setTab(tab);
}


// A segment's "rest" tilt only holds when its stiffness is above 0. With stiffness 0 (every normal chain) the chain just hangs straight under gravity
// on your cursor, so a tilt made with the Rotate/Move tool on a *segment* looked right in this editor but never showed on the desktop.
// Before saving we move that tilt onto the parts hanging from the segment, which the desktop does draw, so the saved chain looks exactly like the editor.
function bakeSegmentRests(r = rig) {
  if (RC.isOrbit(r) || RC.isParticles(r)) return false;
  if (r.segments.some((s) => (s.stiffness || 0) > 0)) return false;
  const kids = new Map(); r.segments.forEach((s) => { const k = s.parent || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(s); });
  let changed = false;
  const ID = new THREE.Quaternion();
  const walk = (parentId, R, o) => {
    for (const s of kids.get(parentId || '') || []) {
      const q = new THREE.Quaternion(...(s.rest || [0, 0, 0, 1])).normalize();
      const F = R.clone().multiply(q);
      const isId = F.angleTo(ID) < 1e-4 && o.lengthSq() < 1e-10;
      if (!isId) {
        for (const a of s.attachments || []) {
          const p = new THREE.Vector3(...a.position).applyQuaternion(F).add(o);
          const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(a.rotation[0]), THREE.MathUtils.degToRad(a.rotation[1]), THREE.MathUtils.degToRad(a.rotation[2]), 'XYZ'));
          const en = new THREE.Euler().setFromQuaternion(F.clone().multiply(qa), 'XYZ');
          a.position = p.toArray().map((v) => round(v));
          a.rotation = [en.x, en.y, en.z].map((v) => round(THREE.MathUtils.radToDeg(v), 2));
          changed = true;
        }
      }
      if (q.angleTo(ID) > 1e-6) { s.rest = [0, 0, 0, 1]; changed = true; }
      const L = s.length || 0;
      const endEd = new THREE.Vector3(0, -L, 0).applyQuaternion(F);
      walk(s.id, F, o.clone().add(endEd).sub(new THREE.Vector3(0, -L, 0)));
    }
  };
  walk('', ID.clone(), new THREE.Vector3());
  return changed;
}

async function logModelHashes() { try { for (const sg of rig.segments) for (const a of sg.attachments) if (a.kind === 'model' && a.model) { const r = await fetch(api.modelUrl(a.model)); const b = await r.arrayBuffer(); const d = await crypto.subtle.digest('SHA-1', b); api.logDebug?.('editor loaded model ' + a.model + ' = ' + b.byteLength + 'b ' + [...new Uint8Array(d)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('')); } } catch (er) { api.logDebug?.('editor model hash failed ' + er.message); } }
async function save({ asCopy = false } = {}) {
  logModelHashes();
  try {   // does what is on the editor screen match the data about to be saved?
    const bad = [];
    for (const [id, o] of view.attObjects) { const f = findAtt(id); if (!f) continue; const p = o.position.toArray(); if (p.some((v, k) => Math.abs(v - f.att.position[k]) > 1e-3)) { bad.push(f.att.name + ' data=' + JSON.stringify(f.att.position) + ' screen=' + JSON.stringify(p.map((v) => +v.toFixed(4)))); f.att.position = p.map((v) => round(v)); } }   // what you see on screen is what gets saved
    api.logDebug?.('EDITOR save check: ' + (bad.length ? 'MISMATCH (saved the on-screen position) ' + bad.join(' | ') : 'screen matches data'));
  } catch (e) { api.logDebug?.('EDITOR save check failed ' + e.message); }
  if (asCopy) {
    rig.id = RC.uid('rig');
    rig.name = rig.name + ' copy';
  }
  const baked = bakeSegmentRests();
  if (baked) { rebuild(); renderTree(); renderInspector(); }
  const id = await api.saveRig(RC.normalizeRig(rig));
  rig.id = id;
  let live = null; try { live = await api.refreshActive?.(id); } catch (e) { live = { err: String(e && e.message || e) }; }   // make sure the cursor shows the saved version straight away
  savedSnapshot = lastSnapshot = snapshot();
  await refreshRigList(id);
  paintStatus();
  renderInspector();
  const where = live && live.saved ? ' [' + live.saved.file.split('/').slice(-3).join('/') + ' at ' + new Date(live.saved.mtime).toLocaleTimeString() + ', app process ' + live.pid + ']' : (live && live.err ? ' [could not reach the app: ' + live.err + ']' : ' [no answer from the app - this editor may belong to an older Cursor Rig window]');
  toast((asCopy ? 'Saved as a copy' : baked ? 'Saved - the tilt you made is now part of the model, so it shows on your cursor' : (live && live.equipped?.includes(id) ? 'Saved - your cursor chain is updated' : (live ? 'Saved (this chain is not the one equipped)' : 'Saved'))) + where, 9000);
  return id;
}

// ---------------------------------------------------------- operations
// Multi-select: `multi` holds the ids of every selected part; `sel` is the primary (last clicked) one.
let multi = new Set();
const selectedAttIds = () => (sel.type === 'attachment' ? (multi.size > 1 ? [...multi] : [sel.attId]) : []);
function select(s) {
  multi = new Set();
  refreshSel(s);
}
function selectMulti(ids) {
  ids = ids.filter((id) => findAtt(id));
  if (!ids.length) return select({ type: 'rig' });
  multi = new Set(ids);
  refreshSel({ type: 'attachment', attId: ids[ids.length - 1] });
  if (ids.length > 1) toast(ids.length + ' parts selected');
}
function toggleAtt(id) {
  const cur = new Set(selectedAttIds());
  cur.has(id) ? cur.delete(id) : cur.add(id);
  selectMulti([...cur]);
}
function selectAllParts() {
  const ids = [...rig.anchor.attachments.map((a) => a.id), ...rig.segments.flatMap((x) => x.attachments.map((a) => a.id))];
  selectMulti(ids);
}
function refreshSel(s) {
  sel = s;
  renderTree();
  renderInspector();
  paintBones();
  attachGizmo();
  paintModeButtons();
  if (chainOpen) refreshChainPanel();
}

const parentForNew = () => {
  if (sel.type === 'segment') return sel.segId;
  if (sel.type === 'attachment') return findAtt(sel.attId)?.seg?.id ?? null;
  return null;
};

function addPlanet() {
  const pid = parentForNew();
  const o = rig.orbit;
  let ring;
  if (pid || !o.rings.length) {   // a moon (or the first body) gets an orbit of its own
    const outer = Math.max(0, ...o.rings.map((r) => r.radius));
    ring = RC.normalizeRing({ name: (pid ? 'moon' : 'planet') + ' orbit', radius: pid ? 0.25 : round(outer + 0.5), tilt: round(55 + Math.random() * 20, 0), node: round(Math.random() * 40 - 20, 0), speed: pid ? 3 : 1, color: '#ffffff' });
    o.rings.push(ring);
  } else {
    const outer = o.rings.reduce((a, b) => (b.radius > a.radius ? b : a));
    ring = RC.normalizeRing({ name: 'orbit ' + (o.rings.length + 1), radius: round(outer.radius + 0.4), tilt: outer.tilt, node: outer.node, speed: round(outer.speed * 0.8), color: '#ffffff' });
    o.rings.push(ring);
  }
  const n = rig.segments.length + 1;
  const sg = RC.newSegment(pid, { name: (pid ? 'moon ' : 'planet ') + n, orbit: { ring: ring.id, angle: round(Math.random() * 360, 0), spin: 1.5 } });
  sg.attachments.push(RC.newAttachment('sphere', { name: sg.name, color: '#9ec5ff', scale: [0.14, 0.14, 0.14] }));
  rig.segments.push(sg);
  commit(); rebuild(); select({ type: 'segment', segId: sg.id });
}

function addSegment() {
  if (RC.isOrbit(rig)) return addPlanet();
  const pid = parentForNew();
  const p = pid ? segById(pid) : null;
  const s = RC.newSegment(pid, { name: 'segment ' + (rig.segments.length + 1), length: p ? p.length : 0.5 });
  rig.segments.push(s);
  commit(); rebuild(); placeGrid(); select({ type: 'segment', segId: s.id });
}


// Put segments in parent-first order (the physics builds the rig in array order).
function sortSegs() {
  const out = [], done = new Set(), left = rig.segments.slice();
  let guard = left.length + 5;
  while (left.length && guard--) {
    for (let k = 0; k < left.length;) {
      const s = left[k];
      if (!s.parent || done.has(s.parent) || !rig.segments.some((x) => x.id === s.parent)) { out.push(s); done.add(s.id); left.splice(k, 1); } else k++;
    }
  }
  rig.segments.splice(0, rig.segments.length, ...out, ...left);
}
const kidsOf = (id) => rig.segments.filter((s) => s.parent === id);
const lineTip = (s) => { let c = s, g = 500; for (let k = kidsOf(c.id)[0]; k && g--; k = kidsOf(c.id)[0]) c = k; return c; };
const isMetalish = (s) => s.attachments.length > 0 && !s.attachments.some((a) => a.kind === 'model');
// the link to copy when extending: this segment if it is a plain link, otherwise the nearest plain link above it
function linkTemplate(s) {
  for (let c = s, g = 500; c && g--; c = c.parent ? segById(c.parent) : null) if (isMetalish(c)) {
    // a shortened end link (made to meet the part below) is a poor thing to copy: use the longest link of the same run instead
    let best = c;
    for (let p = c.parent ? segById(c.parent) : null, g2 = 60; p && g2-- && isMetalish(p) && p.attachments.length === 1 && p.attachments[0].shape === c.attachments[0]?.shape; p = p.parent ? segById(p.parent) : null) if (p.length > best.length) best = p;
    return best;
  }
  return null;
}
// add `count` links hanging from `from`; mode 'after' puts them between `from` and what already hangs from it
function makeLinks(from, { count = 3, where = 'end', size = 100 } = {}) {
  const k = size / 100;
  const attach = where === 'after' || where === 'branch' ? from : lineTip(from);
  const tmpl = linkTemplate(attach) || linkTemplate(from);
  const moved = where === 'after' ? kidsOf(from.id) : [];   // 'branch' keeps everything where it is and adds a second chain
  let pid = attach.id; const made = [];
  for (let n = 0; n < count; n++) {
    const s = tmpl ? deepCopy(tmpl) : RC.newSegment(null, { length: 0.3 });
    s.id = RC.uid('seg'); s.parent = pid; s.name = 'link ' + (rig.segments.length + 1 + n);
    delete s.limit; delete s.radius; delete s.sink; delete s.orbit;
    s.length = round(Math.max(0.02, s.length * k));
    if (tmpl) { const pa = (s.attachments || []).find((x) => x.kind !== 'model' && x.scale && ['torus', 'ring'].includes(x.shape)); if (pa) s.length = Math.max(s.length, round(0.5 * Math.max(...pa.scale) * k)); }   // new links never sit closer than half a link length
    (s.attachments || []).forEach((a) => {
      a.id = RC.uid('att');
      a.position = a.position.map((v) => round(v * k)); a.scale = a.scale.map((v) => round(v * k));
      if (a.shape === 'torus' && (n + 1) % 2) a.rotation = [a.rotation[0], (a.rotation[1] + 90) % 180, a.rotation[2]];
    });
    if (n === 0 && where === 'branch') { const t = 35 * Math.PI / 360; s.rest = [0, 0, round(Math.sin(t), 5), round(Math.cos(t), 5)]; }   // swing the new branch to one side so it doesn't hide behind the old chain
    rig.segments.push(s); made.push(s); pid = s.id;
  }
  moved.forEach((m) => { m.parent = pid; });
  sortSegs();
  return made;
}
async function extendChain(quick, target, defWhere = 'end') {
  if (RC.isOrbit(rig) || RC.isParticles(rig)) return;
  let from = target || (sel.type === 'segment' ? segById(sel.segId) : sel.type === 'attachment' ? findAtt(sel.attId)?.seg : null);
  from ??= rig.segments.find((s) => !s.parent);
  if (!from) return addChain();
  let o = { count: 1, where: 'end', size: 100 };
  if (!quick) {
    o = await modal('Extend chain', [
      { key: 'count', label: 'Links to add', type: 'number', value: 3, min: 1, max: 100, step: 1 },
      { key: 'where', label: 'Add them', type: 'select', value: defWhere, options: [['end', 'At the end of this line'], ['after', 'Right after the selected part (the rest hangs below)'], ['branch', 'As a new branch hanging beside what is already there']] },
      { key: 'size', label: 'Link size %', type: 'number', value: 100, min: 20, max: 400, step: 5 },
      { type: 'note', title: 'Tip', text: 'New links copy the nearest plain link above (ring, link, string). "Right after" is how you add chain between two parts, for example between the ring and the head.' },
    ], 'Add');
    if (!o) return;
    o.count = Math.max(1, Math.min(100, o.count | 0 || 1));
  }
  const made = makeLinks(from, o);
  commit(); rebuild(); placeGrid(); renderTree(); select({ type: 'segment', segId: made[made.length - 1].id });
  toast(made.length + (made.length === 1 ? ' link added' : ' links added'));
}
// Resize the top ring/loop: its length and parts scale together, so everything hanging below follows and stays joined.
function topRingSection() {
  const top = rig.segments.find((s) => !s.parent);
  if (!top) return document.createComment('');
  const base = { len: top.length, atts: top.attachments.map((a) => ({ id: a.id, p: [...a.position], s: [...a.scale] })) };
  const apply = (k) => {
    k = Math.max(0.2, Math.min(5, k));
    top.length = round(base.len * k, 4);
    for (const b of base.atts) { const a = top.attachments.find((x) => x.id === b.id); if (a) { a.position = b.p.map((v) => round(v * k, 4)); a.scale = b.s.map((v) => round(v * k, 4)); } }
    rebuild();
  };
  let cur = 1;
  const once = (k) => { apply(k); commit(); renderInspector(); };
  return section('Top ring size',
    fNum('Ring size', () => cur, (v) => { cur = v; apply(v); }, { step: 0.05, min: 0.25, max: 3, prec: 2, slider: true, hint: 'Makes the top ring or loop bigger or smaller. Everything hanging from it moves with it, so the whole rig stays joined.' }),
    h('div', { class: 'ibtns' }, btn('Smaller', () => once(0.85)), btn('Bigger', () => once(1.18)), btn('Select it', () => select({ type: 'segment', segId: top.id }))),
    h('p', { class: 'note' }, 'Scales the very top piece (' + top.name + ') and moves everything below it along. The slider is relative to how it is now.'));
}

// ============================================================ Chains panel: find every chain run, highlight it with its bones,
// check it, and offer one-click fixes. It only ever adds or tidies segments, so a model's skinned bones are never touched.
let hl = null;                 // id of the chain being highlighted (its first link), or null
let chainOpen = false;
const isBodySeg = (s) => s.limit != null || s.radius != null || s.attachments.some((a) => a.skin);
const hasModel = (s) => s.attachments.some((a) => a.kind === 'model');
const isLinkSeg = (s) => !isBodySeg(s) && !hasModel(s);
function findChains() {
  if (RC.isOrbit(rig) || RC.isParticles(rig)) return [];
  const ids = new Set(rig.segments.map((s) => s.id));
  const parentOf = (s) => (s.parent && ids.has(s.parent) ? segById(s.parent) : null);
  const out = [];
  for (const s of rig.segments) {
    if (!isLinkSeg(s)) continue;
    const p = parentOf(s);
    if (p && isLinkSeg(p) && kidsOf(p.id).length === 1) continue;   // not the start of a run
    const links = [s];
    for (let c = s, g = 400; g--;) { const k = kidsOf(c.id); if (k.length !== 1 || !isLinkSeg(k[0])) break; links.push(k[0]); c = k[0]; }
    const tip = links[links.length - 1], after = kidsOf(tip.id);
    const holder = after.find((x) => !isLinkSeg(x));
    const end = holder ? { kind: 'model', name: (holder.attachments.find((a) => a.kind === 'model')?.name) || holder.name } : after.length > 1 ? { kind: 'fork', name: after.length + ' branches' } : after.length ? { kind: 'fork', name: 'more chain' } : { kind: 'free', name: 'free end' };
    out.push({ id: s.id, links, from: p, end, length: links.reduce((n, x) => n + x.length, 0) });
  }
  out.forEach((c, i) => { c.name = !c.from ? 'Main chain' : 'Chain from ' + c.from.name; if (out.filter((o) => o.name === c.name).length > 1) c.name += ' (' + (i + 1) + ')'; });
  return out;
}
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const mainPart = (s) => s.attachments.find((a) => a.kind !== 'model' && ['torus', 'cylinder', 'capsule', 'ring'].includes(a.shape));
function scaleSegParts(s, k) {
  s.length = round(Math.max(0.02, s.length * k), 4);
  s.attachments.forEach((a) => { if (a.kind === 'model') return; a.position = a.position.map((v) => round(v * k, 4)); a.scale = a.scale.map((v) => round(v * k, 4)); });
}
function chainIssues(c) {
  const out = [], L = c.links;
  const med = median(L.slice(L.length > 2 ? 1 : 0).map((s) => s.length));
  L.forEach((s, i) => {
    const part = mainPart(s);
    if (s.length < 0.03) out.push({ sev: 'bad', text: `“${s.name}” is almost zero length, so it will jitter`, fix: () => { s.length = 0.1; } });
    if (!s.attachments.length && L.some((x) => x.attachments.length)) out.push({ sev: 'warn', text: `“${s.name}” has no link shape (an invisible gap)`, fix: () => { const t = L.find((x) => x !== s && mainPart(x)); if (t) { const r = s.length / t.length; s.attachments = t.attachments.filter((a) => a.kind !== 'model').map((a) => { const d = deepCopy(a); d.id = RC.uid('att'); d.position = d.position.map((v) => round(v * r)); d.scale = d.scale.map((v) => round(v * r)); return d; }); } } });
    if (part && s.length >= 0.03) {
      if (Math.abs(part.position[1] + s.length / 2) > Math.max(0.02, s.length * 0.25)) out.push({ sev: 'warn', text: `“${s.name}”: the part is off-centre from its bone (leaves a gap)`, fix: () => { part.position = [part.position[0], round(-s.length / 2), part.position[2]]; } });
      if ((part.shape === 'cylinder' || part.shape === 'capsule') && (part.scale[1] < s.length * 0.6 || part.scale[1] > s.length * 1.6)) out.push({ sev: 'warn', text: `“${s.name}”: the part doesn't span its bone (gap or overlap)`, fix: () => { part.scale = [part.scale[0], round(s.length * 1.02), part.scale[2]]; } });
    }
    if (i > 0 && L.length > 2 && med > 0 && (s.length > med * 1.6 || s.length < med * 0.6)) out.push({ sev: 'warn', text: `“${s.name}” is a very different length to the rest`, fix: () => scaleSegParts(s, med / s.length) });
    if ((s.stiffness || 0) > 0.2) out.push({ sev: 'warn', text: `“${s.name}” is stiff, so the chain won't hang loosely`, fix: () => { s.stiffness = 0; } });
  });
  const tor = L.filter((s) => mainPart(s)?.shape === 'torus');
  if (tor.length > 2 && tor.every((s) => (mainPart(s).rotation[1] || 0) % 180 === (mainPart(tor[0]).rotation[1] || 0) % 180)) out.push({ sev: 'info', text: 'Links all face the same way (they look flat). Alternating twist looks like real chain', fix: () => tor.forEach((s, i) => { const p = mainPart(s); p.rotation = [p.rotation[0], i % 2 ? 90 : 0, p.rotation[2]]; }) });
  const mm = median(L.map((s) => s.mass));
  L.forEach((s) => { if (L.length > 2 && mm > 0 && s.mass > mm * 4) out.push({ sev: 'warn', text: `“${s.name}” is much heavier than the other links`, fix: () => { s.mass = mm; } }); });
  return out;
}
function rigIssues() {
  const out = [], ids = new Set(rig.segments.map((s) => s.id));
  rig.segments.forEach((s) => { if (s.parent && !ids.has(s.parent)) out.push({ sev: 'bad', text: `“${s.name}” is detached (its parent is missing), so it hangs from the top`, fix: () => { s.parent = null; } }); });
  rig.segments.forEach((s) => s.attachments.forEach((a) => { if (a.skin?.bones) { const miss = Object.keys(a.skin.bones).filter((id) => !ids.has((a.skin.drive && a.skin.drive[id]) || id)); if (miss.length) out.push({ sev: 'bad', text: `Model “${a.name}” is rigged to ${miss.length} bone(s) that no longer exist`, fix: null }); } }));
  return out;
}
const fixIssues = (list, label) => { const f = list.filter((i) => i.fix); if (!f.length) return; f.forEach((i) => i.fix()); sortSegs(); commit(); rebuild(); toast(label + ' (' + f.length + ' fixed)'); };
function highlightIds() { const c = hl && findChains().find((x) => x.id === hl); return c ? new Set(c.links.map((s) => s.id)) : null; }
function refreshChainPanel() {
  const box = $('#chain-panel'); if (!box) return;
  const chains = findChains();
  const all = [...rigIssues(), ...chains.flatMap(chainIssues)];
  const badge = $('#chain-badge'); if (badge) { badge.textContent = all.length ? String(all.length) : ''; badge.hidden = !all.length; }
  if (!chainOpen) return;
  if (hl && !chains.some((c) => c.id === hl)) hl = null;
  box.innerHTML = '';
  const head = h('div', { class: 'cp-head' }, h('b', {}, 'Chains'), h('span', { class: 'grow' }), h('button', { class: 'btn ghost mini', onclick: () => toggleChainPanel(false) }, '✕'));
  box.append(head);
  const body = h('div', { class: 'cp-body' }); box.append(body);
  const g = rigIssues();
  if (g.length) body.append(h('div', { class: 'cp-card bad' }, h('b', {}, 'Rig problems'), ...g.map((i) => h('div', { class: 'cp-issue bad' }, h('span', {}, i.text), i.fix ? btn('Fix', () => fixIssues([i], 'Fixed')) : null))));
  if (!chains.length) body.append(h('p', { class: 'note', style: 'display:block' }, 'No chains found in this rig. Select a part and use + Chain… to add one.'));
  chains.forEach((c) => {
    const iss = chainIssues(c), on = hl === c.id;
    const card = h('div', { class: 'cp-card' + (on ? ' on' : '') + (iss.length ? ' warn' : ' ok') });
    card.append(h('div', { class: 'cp-title', onclick: () => { hl = on ? null : c.id; paintBones(); refreshChainPanel(); if (!on) select({ type: 'segment', segId: c.links[0].id }); } },
      h('b', {}, c.name), h('span', { class: 'cp-meta' }, `${c.links.length} link${c.links.length === 1 ? '' : 's'} · ${round(c.length, 2)}u · → ${c.end.kind === 'model' ? c.end.name : c.end.name}`)));
    if (on) {
      card.append(h('div', { class: 'cp-links' }, ...c.links.map((s) => h('button', { class: 'cp-chip' + (sel.type === 'segment' && sel.segId === s.id ? ' sel' : ''), title: s.name, onclick: () => select({ type: 'segment', segId: s.id }) }, s.name.replace(/^link /, '#')))));
      const cur = sel.type === 'segment' && c.links.some((s) => s.id === sel.segId) ? segById(sel.segId) : c.links[c.links.length - 1];
      card.append(h('div', { class: 'ibtns' }, btn('+ Link', () => extendChain(true, cur)), btn('Extend…', () => extendChain(false, cur)), btn('Insert…', () => extendChain(false, cur, 'after')), btn('Branch…', () => extendChain(false, cur, 'branch'))));
      card.append(h('div', { class: 'ibtns' }, btn('Smaller', () => { c.links.forEach((s) => scaleSegParts(s, 0.85)); commit(); rebuild(); }), btn('Bigger', () => { c.links.forEach((s) => scaleSegParts(s, 1.18)); commit(); rebuild(); }), btn('Even out', () => { const m = median(c.links.map((s) => s.length)); c.links.forEach((s) => { if (m > 0 && s.length !== m) scaleSegParts(s, m / s.length); }); commit(); rebuild(); toast('Links evened out'); })));
    }
    if (iss.length) { card.append(...iss.map((i) => h('div', { class: 'cp-issue ' + i.sev }, h('span', {}, i.text), i.fix ? btn('Fix', () => fixIssues([i], 'Fixed')) : null))); if (iss.length > 1) card.append(h('div', { class: 'ibtns' }, btn('Fix all in this chain', () => fixIssues(iss, 'Chain tidied')))); }
    else card.append(h('div', { class: 'cp-good' }, '✓ Looks good'));
    body.append(card);
  });
  body.append(h('p', { class: 'note', style: 'display:block' }, 'Click a chain to highlight it and its bones. Tools only add or tidy chain pieces; a model\'s own skeleton is never changed.'));
}
// ---- keychain builder (the easy mode): see builder.js
let builder = null, tab = 'build';
const isChainRig = () => rig && !RC.isOrbit(rig) && !RC.isParticles(rig);
function refreshBuilder() { if (builder && tab === 'build' && isChainRig()) builder.render($('#builder')); }
function setTab(t) {      // 'build' = Keychain builder (default for cursorchains), 'tree' = Parts & bones
  if (t === 'build' && !isChainRig()) t = 'tree';
  tab = t;
  try { localStorage.setItem('rigEd.tab', t); } catch {}
  $('#builder').hidden = t !== 'build'; $('#tree-pane').hidden = t !== 'tree';
  document.querySelector('.body').classList.toggle('tab-build', t === 'build');
  document.querySelectorAll('#side-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  const bb = document.querySelector('#side-tabs [data-tab="build"]'); if (bb) bb.hidden = !isChainRig();
  refreshBuilder();
  window.dispatchEvent(new Event('resize'));      // the viewport changed width
}
const toggleBuilder = (on = tab !== 'build') => setTab(on ? 'build' : 'tree');
function initBuilder() {
  builder = createBuilder({
    h, btn, toast, sortSegs, getRig: () => rig,
    afterEdit: () => { commit(); rebuild(); placeGrid(); renderTree(); renderInspector(); },
    importModel: () => api.importModel(),
    selectSeg: (id) => select({ type: 'segment', segId: id }),
  });
  document.querySelectorAll('#side-tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
  let saved = 'build'; try { saved = localStorage.getItem('rigEd.tab') || 'build'; } catch {}
  tab = saved;
}
function toggleChainPanel(on = !chainOpen) {
  chainOpen = on; $('#chain-panel').hidden = !on; $('#btn-chains').classList.toggle('on', on);
  if (!on) { hl = null; paintBones(); }
  refreshChainPanel();
}

async function addChain() {
  const v = await modal('Add chain', [
    { key: 'count', label: 'Segments', type: 'number', value: 8, min: 1, max: 200, step: 1 },
    { key: 'length', label: 'Segment length', type: 'number', value: 0.4, min: 0.01, step: 0.05 },
    { key: 'taper', label: 'Taper (end length %)', type: 'number', value: 100, min: 5, max: 400, step: 5 },
    { key: 'stiffness', label: 'Stiffness', type: 'number', value: 0, min: 0, max: 0.99, step: 0.05 },
    { key: 'part', label: 'Part on each', type: 'select', value: 'torus', options: ['none', 'torus (chain link)', ...RC.SHAPES.filter((s) => s !== 'torus')].map((o) => [o.split(' ')[0], o]) },
    { key: 'alt', label: 'Alternate twist 90°', type: 'check', value: true },
  ], 'Add');
  if (!v) return;
  let pid = parentForNew();
  let first = null;
  const n = Math.max(1, Math.min(200, v.count | 0));
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : k / (n - 1);
    const len = round(v.length * (1 + (v.taper / 100 - 1) * t));
    const s = RC.newSegment(pid, { name: `link ${k + 1}`, length: len, stiffness: v.stiffness });
    if (v.part !== 'none') {
      const isLink = v.part === 'torus';
      const a = RC.newAttachment(v.part, {
        name: isLink ? 'link' : v.part,
        position: [0, round(-len / 2), 0],
        rotation: [0, v.alt && k % 2 ? 90 : 0, 0],
        scale: isLink ? [round(len * 0.85), round(len * 1.5), round(len * 0.85)] : [round(len * 0.6), round(len * 0.6), round(len * 0.6)],
        color: isLink ? '#b8bcc4' : '#d9a441', metalness: isLink ? 0.85 : 0.2, roughness: isLink ? 0.3 : 0.5, thickness: 0.28,
      });
      s.attachments.push(a);
    }
    rig.segments.push(s);
    first ??= s;
    pid = s.id;
  }
  commit(); rebuild(); placeGrid(); renderTree(); select({ type: 'segment', segId: first.id });
}

function targetSegForPart() {
  if (sel.type === 'segment') return segById(sel.segId);
  if (sel.type === 'attachment') return findAtt(sel.attId)?.seg ?? null;
  return null; // anchor
}

function addPart(shape) {
  const seg = targetSegForPart();
  const L = seg ? seg.length : 0.5;
  const sz = round(Math.max(0.1, Math.min(0.6, L * 0.6)));
  const a = RC.newAttachment(shape, {
    name: shape,
    position: [0, seg ? round(-L / 2) : 0, 0],
    scale: shape === 'cylinder' || shape === 'capsule' ? [round(sz * 0.5), round(L), round(sz * 0.5)] : [sz, sz, sz],
    color: '#d9a441',
  });
  if (shape === 'capsule') a.scale = [round(sz * 0.8), round(L), round(sz * 0.8)];
  (seg ? seg.attachments : rig.anchor.attachments).push(a);
  commit(); rebuild(); select({ type: 'attachment', attId: a.id });
}

async function importModelInto(existing) {
  const r = await api.importModel();
  if (!r) return;
  if (existing) {
    existing.model = r.name;
    commit(); rebuild(); renderInspector();
    return;
  }
  const seg = targetSegForPart();
  const L = seg ? seg.length : 0.5;
  const a = RC.newAttachment('box', {
    kind: 'model', model: r.name, name: r.original.replace(/\.[^.]+$/, ''), useColor: false,
    position: [0, seg ? round(-L / 2) : 0, 0], scale: [round(Math.max(0.3, L)), round(Math.max(0.3, L)), round(Math.max(0.3, L))],
  });
  (seg ? seg.attachments : rig.anchor.attachments).push(a);
  commit(); rebuild(); select({ type: 'attachment', attId: a.id });
  toast('Model imported');
}

function cloneSubtree(segId, newParent) {
  const map = new Map();
  const src = [segById(segId), ...RC.descendants(rig, segId)];
  const copies = src.map((s) => {
    const c = deepCopy(s);
    c.id = RC.uid('seg');
    map.set(s.id, c.id);
    c.attachments.forEach((a) => (a.id = RC.uid('att')));
    return c;
  });
  copies.forEach((c, k) => { c.parent = k === 0 ? newParent : map.get(src[k].parent); });
  return copies;
}

function duplicateSel() {
  if (sel.type === 'segment') {
    const s = segById(sel.segId);
    const copies = cloneSubtree(s.id, s.parent);
    copies[0].name = s.name + ' copy';
    rig.segments.push(...copies);
    commit(); rebuild(); select({ type: 'segment', segId: copies[0].id });
  } else if (sel.type === 'attachment') {
    const made = [];
    for (const id of selectedAttIds()) {
      const f = findAtt(id); if (!f) continue;
      const c = deepCopy(f.att);
      c.id = RC.uid('att'); c.name = f.att.name + ' copy';
      f.list.push(c); made.push(c.id);
    }
    commit(); rebuild(); selectMulti(made);
  }
}

function deleteSel() {
  if (sel.type === 'segment') {
    const s = segById(sel.segId);
    const gone = new Set([s.id, ...RC.descendants(rig, s.id).map((d) => d.id)]);
    if (gone.size > 1 && !confirm(`Delete “${s.name}” and the ${gone.size - 1} segment(s) below it?`)) return;
    rig.segments = rig.segments.filter((x) => !gone.has(x.id));
    const parent = s.parent;
    commit(); rebuild(); placeGrid();
    select(parent ? { type: 'segment', segId: parent } : { type: 'anchor' });
  } else if (sel.type === 'attachment') {
    let owner = null;
    for (const id of selectedAttIds()) {
      const f = findAtt(id); if (!f) continue;
      owner = f.seg;
      f.list.splice(f.list.indexOf(f.att), 1);
    }
    commit(); rebuild();
    select(owner ? { type: 'segment', segId: owner.id } : { type: 'anchor' });
  }
}

async function repeatDownChain(attId) {
  const f = findAtt(attId);
  if (!f?.seg) return;
  const below = RC.descendants(rig, f.seg.id);
  if (!below.length) return toast('No segments below this one');
  const v = await modal(`Copy “${f.att.name}” down the chain`, [
    { key: 'alt', label: 'Alternate twist 90°', type: 'check', value: f.att.shape === 'torus' },
    { key: 'fitLen', label: 'Scale to segment length', type: 'check', value: true },
    { key: 'replace', label: 'Replace parts already there', type: 'check', value: false },
  ], `Copy to ${below.length}`);
  if (!v) return;
  const depth = (s) => { let d = 0; let p = s; while (p && p.id !== f.seg.id) { p = segById(p.parent); d++; } return d; };
  for (const s of below) {
    if (v.replace) s.attachments = [];
    const c = deepCopy(f.att);
    c.id = RC.uid('att');
    if (v.fitLen && f.seg.length > 0) {
      const k = s.length / f.seg.length;
      c.position = c.position.map((x) => round(x * k));
      c.scale = c.scale.map((x) => round(x * k));
    }
    if (v.alt && depth(s) % 2 === 1) c.rotation[1] = round(c.rotation[1] + 90, 2);
    s.attachments.push(c);
  }
  commit(); rebuild(); renderTree(); toast(`Copied to ${below.length} segments`);
}

function reparentSegment(segId, newParent) {
  if (segId === newParent) return;
  if (newParent && RC.descendants(rig, segId).some((d) => d.id === newParent)) return toast("Can't move a segment under its own child");
  segById(segId).parent = newParent;
  commit(); rebuild(); placeGrid(); renderTree(); renderInspector();
}

function moveAttachment(attId, segId) {
  const f = findAtt(attId);
  if (!f) return;
  f.list.splice(f.list.indexOf(f.att), 1);
  (segId ? segById(segId).attachments : rig.anchor.attachments).push(f.att);
  commit(); rebuild(); renderTree(); renderInspector();
}

// ---------------------------------------------------------------- tree
const ICONS = {
  rig: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
  anchor: '<svg viewBox="0 0 24 24"><path d="M5 3l6 15 2-6 6-2z"/></svg>',
  seg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.5"/><path d="M12 7.5v9"/><circle cx="12" cy="19" r="2.5"/></svg>',
  primitive: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
  model: '<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4v10l-8 4-8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>',
};

let treeFilter = '';
function renderTree() {
  const tree = $('#tree');
  const scroll = tree.scrollTop;
  tree.innerHTML = '';
  const kids = new Map();
  for (const s of RC.orderSegments(rig)) {
    const p = s.parent && segById(s.parent) ? s.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(s);
  }
  const row = (o) => {
    if (treeFilter && o.cls !== 'rig' && !String(o.name).toLowerCase().includes(treeFilter)) return;   // the Find box hides everything that does not match
    const el = h('div', { class: `node ${o.cls}${o.selected ? ' sel' : ''}`, style: `padding-left:${8 + Math.min(o.depth, 10) * 14}px`, draggable: o.drag ? 'true' : null });
    const tw = h('span', { class: 'tw' }, o.toggle ? (o.open ? '▼' : '▶') : '');
    if (o.toggle) tw.addEventListener('click', (e) => { e.stopPropagation(); o.toggle(); });
    const ic = h('span', { class: 'ic' }); ic.innerHTML = ICONS[o.icon];
    el.append(tw, ic, h('span', { class: 'nm' }, o.name));
    if (o.meta) el.append(h('span', { class: 'mt' }, o.meta));
    el.addEventListener('click', o.onclick);
    if (o.drag) el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify(o.drag)); e.dataTransfer.effectAllowed = 'move'; });
    if (o.drop !== undefined) {
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault(); el.classList.remove('drop-target');
        try {
          const d = JSON.parse(e.dataTransfer.getData('text/plain'));
          if (d.seg) reparentSegment(d.seg, o.drop);
          else if (d.att) moveAttachment(d.att, o.drop);
        } catch {}
      });
    }
    tree.append(el);
  };
  row({ cls: 'rig', icon: 'rig', name: 'Rig settings', depth: 0, selected: sel.type === 'rig', onclick: () => select({ type: 'rig' }) });
  const attRows = (list, segId, depth) => list.forEach((a) => row({
    cls: 'att' + (a.visible ? '' : ' hidden'), icon: a.kind === 'model' ? 'model' : 'primitive', name: a.name, depth,
    meta: a.kind === 'model' ? 'model' : a.shape, selected: sel.type === 'attachment' && (sel.attId === a.id || multi.has(a.id)),
    drag: { att: a.id }, onclick: (e) => (e.shiftKey || e.ctrlKey || e.metaKey ? toggleAtt(a.id) : select({ type: 'attachment', attId: a.id })),
  }));
  const anchorOpen = !!treeFilter || !collapsed.has('anchor');
  row({ cls: 'anchor', icon: 'anchor', name: 'Cursor anchor', depth: 0, selected: sel.type === 'anchor', drop: null,
    open: anchorOpen, toggle: () => { collapsed.has('anchor') ? collapsed.delete('anchor') : collapsed.add('anchor'); renderTree(); },
    onclick: () => select({ type: 'anchor' }) });
  if (anchorOpen) {
    attRows(rig.anchor.attachments, null, 1);
    const walk = (pid, depth) => {
      for (const s of kids.get(pid) || []) {
        const hasKids = (kids.get(s.id) || []).length || s.attachments.length;
        const open = !!treeFilter || !collapsed.has(s.id);
        row({ cls: 'seg', icon: 'seg', name: s.name, depth, meta: RC.isOrbit(rig) ? (rig.orbit.rings.find((r) => r.id === s.orbit?.ring)?.name || '') : round(s.length, 2) + '',
          selected: sel.type === 'segment' && sel.segId === s.id, drag: { seg: s.id }, drop: s.id,
          open, toggle: hasKids ? () => { open ? collapsed.add(s.id) : collapsed.delete(s.id); renderTree(); } : null,
          onclick: () => select({ type: 'segment', segId: s.id }) });
        // linear runs (one child) stay at the same indent so long chains don't drift right
        const childDepth = (kids.get(s.id) || []).length > 1 || (kids.get(pid) || []).length > 1 ? depth + 1 : depth;
        if (open) { attRows(s.attachments, s.id, depth + 1); walk(s.id, childDepth); }
      }
    };
    walk(null, 1);
  }
  if (!rig.segments.length) tree.append(h('div', { class: 'empty' }, (RC.isParticles(rig) ? 'This is a particle emitter. Its settings are on the right. Particles follow the preview cursor.' : 'No segments yet. Select the cursor anchor and add a segment or a chain.')));
  tree.scrollTop = scroll;
  // keep selection visible
  tree.querySelector('.node.sel')?.scrollIntoView({ block: 'nearest' });
}

// ----------------------------------------------------------- inspector
const live = []; // fns re-reading values during gizmo drags
function liveInspector() { live.forEach((f) => f()); }

function scrubbable(labelEl, get, set, step) {
  labelEl.classList.add('scrub');
  labelEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const x0 = e.clientX; const v0 = get();
    labelEl.setPointerCapture(e.pointerId);
    const move = (ev) => set(v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 0.1 : 1));
    const up = () => { labelEl.removeEventListener('pointermove', move); labelEl.removeEventListener('pointerup', up); commit(); };
    labelEl.addEventListener('pointermove', move);
    labelEl.addEventListener('pointerup', up);
  });
}

function numInput(get, set, { step = 0.01, min = -Infinity, max = Infinity, prec = 3 } = {}) {
  const input = h('input', { type: 'number', step });
  const clampv = (v) => Math.min(max, Math.max(min, v));
  const read = () => { if (document.activeElement !== input) input.value = round(get(), prec); };
  input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) set(clampv(v)); });
  input.addEventListener('change', () => { commit(); read(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); e.stopPropagation(); });
  read();
  live.push(read);
  return { input, read, set: (v) => { set(clampv(round(v, prec))); read(); } };
}

function fNum(label, get, set, opts = {}) {
  const l = h('span', { class: 'fl', title: (opts.hint ? opts.hint + '  ' : '') + '(Drag the name to adjust)' }, label);
  const n = numInput(get, set, opts);
  let body = n.input;
  if (opts.slider) {
    const r = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step });
    const paint = () => { r.value = get(); r.style.setProperty('--p', ((get() - opts.min) / (opts.max - opts.min)) * 100 + '%'); };
    r.addEventListener('input', () => { set(parseFloat(r.value)); n.read(); paint(); });
    r.addEventListener('change', commit);
    n.input.addEventListener('input', paint);
    paint(); live.push(paint);
    body = h('div', { class: 'num-wrap' }, r, n.input);
  }
  scrubbable(l, get, (v) => n.set(v), opts.scrub ?? opts.step ?? 0.01);
  return h('div', { class: 'f' }, l, body);
}

function fVec(label, arr, apply, { step = 0.01, prec = 3, min = -Infinity } = {}) {
  const l = h('span', { class: 'fl' }, label);
  const vec = h('div', { class: 'vec' });
  ['X', 'Y', 'Z'].forEach((ax, k) => {
    const n = numInput(() => arr()[k], (v) => { const a = arr(); a[k] = v; apply(); }, { step, prec, min });
    const b = h('b', {}, ax);
    scrubbable(b, () => arr()[k], (v) => n.set(v), step);
    vec.append(h('div', { class: 'ax' }, b, n.input));
  });
  return h('div', { class: 'f' }, l, vec);
}

function fText(label, get, set, hint) {
  const i = h('input', { type: 'text', value: get() });
  i.addEventListener('input', () => set(i.value));
  i.addEventListener('change', commit);
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); e.stopPropagation(); });
  return h('div', { class: 'f' }, h('span', { class: 'fl', title: hint || '' }, label), i);
}

function fSelect(label, options, get, set, hint) {
  const s = h('select', {}, options.map(([v, t]) => h('option', { value: v }, t)));
  s.value = get();
  s.addEventListener('change', () => { set(s.value); commit(); });
  return h('div', { class: 'f' }, h('span', { class: 'fl', title: hint || '' }, label), s);
}

function fColor(label, get, set, hint) {
  const c = h('input', { type: 'color', value: get() });
  const t = h('input', { type: 'text', value: get() });
  c.addEventListener('input', () => { t.value = c.value; set(c.value); });
  c.addEventListener('change', commit);
  t.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { c.value = t.value; set(t.value); commit(); } else t.value = get(); });
  t.addEventListener('keydown', (e) => e.stopPropagation());
  return h('div', { class: 'f' }, h('span', { class: 'fl', title: hint || '' }, label), h('div', { class: 'color-row' }, c, t));
}

function fCheck(label, get, set, hint) {
  const i = h('input', { type: 'checkbox' });
  i.checked = !!get();
  i.addEventListener('change', () => { set(i.checked); commit(); });
  return h('label', { class: 'check', title: hint || '' }, i, label);
}

const foldedSecs = new Set((() => { try { return JSON.parse(localStorage.getItem('rigEd.folded') || '[]'); } catch { return []; } })());
const saveFolded = () => { try { localStorage.setItem('rigEd.folded', JSON.stringify([...foldedSecs])); } catch {} };
const section = (title, ...kids) => {      // a group in the inspector: click its title to fold it (remembered)
  const lab = h('span', { class: 'label sec-h', title: 'Click to fold or open this group' }, title);
  const el = h('div', { class: 'isec' + (foldedSecs.has(title) ? ' folded' : '') }, lab, h('div', { class: 'sec-b' }, ...kids));
  lab.addEventListener('click', () => { const f = el.classList.toggle('folded'); if (f) foldedSecs.add(title); else foldedSecs.delete(title); saveFolded(); });
  return el;
};
const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, onclick }, label);

// ------------------------------------------------ orbit rigs: inspector pieces
function orbitSection() {
  const o = rig.orbit;
  const ringBoxes = o.rings.map((r) => section('Orbit: ' + r.name,
    fText('Name', () => r.name, (v) => { r.name = v; renderTree(); }),
    fNum('Radius', () => r.radius, (v) => { r.radius = v; repose(); }, { step: 0.01, min: 0, max: 50, prec: 2, scrub: 0.01, hint: 'How far this orbit is from the centre.' }),
    fNum('Tilt°', () => r.tilt, (v) => { r.tilt = v; repose(); }, { step: 1, min: -89, max: 89, prec: 0, slider: true, hint: '0 = a flat circle facing you. Higher leans it into a thinner ellipse.' }),
    fNum('Roll°', () => r.node, (v) => { r.node = v; repose(); }, { step: 1, min: -180, max: 180, prec: 0, slider: true, hint: 'Turns the whole orbit around on screen.' }),
    fNum('Speed', () => r.speed, (v) => { r.speed = v; }, { step: 0.05, min: -30, max: 30, prec: 2, scrub: 0.02, hint: 'How fast bodies go round this orbit. Negative goes backwards.' }),
    fCheck('Show line', () => r.trail, (v) => { r.trail = v; repose(); }),
    fColor('Line colour', () => r.color, (v) => { r.color = v; repose(); }),
    h('div', { class: 'ibtns' }, btn('Remove orbit', () => {
      rig.segments.forEach((sg) => { if (sg.orbit?.ring === r.id) sg.orbit.ring = null; });
      o.rings = o.rings.filter((x) => x.id !== r.id);
      commit(); rebuild(); renderInspector(); renderTree();
    }, 'danger'))));
  return h('div', {},
    section('Orbit motion',
      fNum('Idle speed', () => o.baseSpeed, (v) => { o.baseSpeed = v; }, { step: 0.01, min: 0, max: 3, prec: 2, slider: true, hint: 'How fast everything orbits while the cursor is still.' }),
      fNum('Orbit wobble', () => o.sway, (v) => { o.sway = v; }, { step: 0.05, min: 0, max: 1.5, prec: 2, slider: true, hint: 'How much the orbit rings tilt and lean over time. 0 keeps every orbit on one fixed, clear path.' }),
      fNum('Fast speed', () => o.maxSpeed, (v) => { o.maxSpeed = v; }, { step: 0.1, min: 0, max: 30, prec: 1, slider: true, hint: 'How fast everything orbits while the cursor is moving quickly.' }),
      fNum('Fast means', () => o.sensitivity, (v) => { o.sensitivity = v; }, { step: 0.5, min: 1, max: 80, prec: 1, scrub: 0.1, hint: 'How quickly the cursor must move to count as fast. Lower = speeds up with a gentle nudge.' }),
      fNum('Speed up', () => o.response, (v) => { o.response = v; }, { step: 0.1, min: 0.1, max: 20, prec: 1, scrub: 0.05, hint: 'How quickly the orbits speed up when you start moving.' }),
      fNum('Slow down', () => o.settle, (v) => { o.settle = v; }, { step: 0.1, min: 0.1, max: 20, prec: 1, scrub: 0.05, hint: 'How slowly the orbits ease back to idle speed after you stop.' }),
      fNum('Centre spin', () => o.sunSpin, (v) => { o.sunSpin = v; }, { step: 0.05, min: -10, max: 10, prec: 2, scrub: 0.02, hint: 'How fast the thing in the middle (sun, star) turns.' }),
      h('p', { class: 'note' }, 'Everything orbits at Idle speed when the cursor is still and eases up to Fast speed as the cursor moves. “Fast means” is how quickly the cursor must move (editor units per second) to count as fast. Press Space and tick Swing to preview.')),
    section('Orbit lines',
      fCheck('Show orbit lines', () => o.trails, (v) => { o.trails = v; repose(); }),
      fNum('Line strength', () => o.trailOpacity, (v) => { o.trailOpacity = v; repose(); }, { step: 0.01, min: 0.02, max: 1, prec: 2, slider: true })),
    ...ringBoxes,
    section('Add', h('div', { class: 'ibtns' }, btn('+ Orbit', () => {
      const outer = Math.max(0, ...o.rings.map((r) => r.radius));
      o.rings.push(RC.normalizeRing({ name: 'orbit ' + (o.rings.length + 1), radius: round(outer + 0.4), tilt: 60, node: -20, speed: 1 }));
      commit(); rebuild(); renderInspector();
    }), btn('+ Planet', addPlanet))));
}

function planetInspector(s, box, title) {
  title.textContent = 'Planet';
  s.orbit ??= { ring: null, angle: 0, spin: 1.5 };
  const banned = new Set([s.id, ...RC.descendants(rig, s.id).map((d) => d.id)]);
  const parentOpts = [['', 'Cursor'], ...rig.segments.filter((x) => !banned.has(x.id)).map((x) => [x.id, x.name])];
  const ringOpts = [['', 'None (stays put)'], ...rig.orbit.rings.map((r) => [r.id, r.name])];
  box.append(
    section('Planet',
      fText('Name', () => s.name, (v) => { s.name = v; renderTree(); }),
      fSelect('Circles', parentOpts, () => s.parent || '', (v) => { reparentSegment(s.id, v || null); }),
      fSelect('On orbit', ringOpts, () => s.orbit.ring || '', (v) => { s.orbit.ring = v || null; repose(); renderTree(); }),
      fNum('Start angle°', () => s.orbit.angle, (v) => { s.orbit.angle = v; repose(); }, { step: 1, min: 0, max: 360, prec: 0, slider: true, hint: 'Where on its orbit this body starts.' }),
      fNum('Spin', () => s.orbit.spin, (v) => { s.orbit.spin = v; }, { step: 0.1, min: -30, max: 30, prec: 2, scrub: 0.05, hint: 'How fast this body turns on its own axis.' }),
      h('p', { class: 'note' }, 'Add parts to this planet with “+ Part” or “Import model…”. “Circles” lets a planet orbit another planet, like a moon.')),
    section('Trail',
      fNum('Length', () => s.orbit.trail?.len ?? 0, (v) => { setBodyTrail(s, { len: Math.round(v) }); }, { step: 1, min: 0, max: 120, prec: 0, slider: true, hint: 'A ribbon that streams off this body as it moves. 0 = no trail.' }),
      fNum('Width', () => s.orbit.trail?.width ?? 0.12, (v) => { setBodyTrail(s, { width: v }); }, { step: 0.01, min: 0.01, max: 1.5, prec: 2, slider: true, hint: 'How thick the trail is at the body.' }),
      fNum('Strength', () => s.orbit.trail?.alpha ?? 0.7, (v) => { setBodyTrail(s, { alpha: v }); }, { step: 0.05, min: 0.05, max: 1, prec: 2, slider: true, hint: 'How solid the trail looks.' }),
      fColor('Colour', () => s.orbit.trail?.color ?? '#ffffff', (v) => { setBodyTrail(s, { color: v }); }, 'Trail colour (ignored while Rainbow is on).'),
      fCheck('Rainbow', () => !!s.orbit.trail?.rainbow, (v) => { setBodyTrail(s, { rainbow: v }); }, 'Colour bands across the trail.'),
      fCheck('Glitter', () => !!s.orbit.trail?.glitter, (v) => { setBodyTrail(s, { glitter: v }); }, 'Twinkling white glitter and sparkles all over the trail.'),
      fCheck('Smoky', () => !!s.orbit.trail?.smoke, (v) => { setBodyTrail(s, { smoke: v }); }, 'A soft, wispy smoke trail: it fades in from the body, spreads out and drifts away with no hard edges.'),
      fCheck('Square ends', () => !!s.orbit.trail?.square, (v) => { setBodyTrail(s, { square: v }); }, 'The trail keeps its full width right to the end instead of tapering to a point.')),
    section('Actions', h('div', { class: 'ibtns' }, btn('+ Moon', addPlanet), btn('Duplicate', duplicateSel), btn('Delete', deleteSel, 'danger'))),
  );
}
function setBodyTrail(s, patch) {
  const t = { ...(s.orbit.trail || { len: 40, width: 0.12, color: '#ffffff', alpha: 0.7 }), ...patch };
  if (!(t.len > 1)) delete s.orbit.trail; else s.orbit.trail = RC.normalizeTrail(t);
  clearTimeout(setBodyTrail._t); setBodyTrail._t = setTimeout(() => { rebuild(); }, 150);
}

function particlesSection() {
  const P = rig.particles, reb = () => { rebuild(); };
  const N = (label, get, set, o, hint) => fNum(label, get, set, { slider: true, hint, ...o });
  return h('div', {},
    section('Particles',
      fSelect('Shape', [['petal', 'Petal'], ['feather', 'Feather'], ['snowflake', 'Snowflake (every one unique)']], () => P.shape, (v) => { P.shape = v; reb(); }, 'The kind of thing the cursor sheds.'),
      N('Max at once', () => P.max, (v) => { P.max = Math.round(v); }, { step: 1, min: 4, max: 200, prec: 0 }, 'The most particles alive at the same time. Lower is lighter on older computers.'),
      N('Emit (idle)', () => P.rate, (v) => { P.rate = v; }, { step: 0.5, min: 0, max: 80, prec: 1 }, 'How many appear per second while the cursor is still.'),
      N('Emit (fast)', () => P.rateFast, (v) => { P.rateFast = v; }, { step: 0.5, min: 0, max: 120, prec: 1 }, 'How many appear per second when the cursor moves quickly.'),
      N('Fast means', () => P.sensitivity, (v) => { P.sensitivity = v; }, { step: 0.5, min: 1, max: 80, prec: 1 }, 'How quickly the cursor must move to count as fast.'),
      N('Life min (s)', () => P.life[0], (v) => { P.life[0] = Math.min(v, P.life[1]); }, { step: 0.1, min: 0.3, max: 12, prec: 1 }, 'The shortest time a particle lasts.'),
      N('Life max (s)', () => P.life[1], (v) => { P.life[1] = Math.max(v, P.life[0]); }, { step: 0.1, min: 0.3, max: 12, prec: 1 }, 'The longest time a particle lasts.'),
      N('Size min', () => P.size[0], (v) => { P.size[0] = Math.min(v, P.size[1]); }, { step: 0.01, min: 0.05, max: 2, prec: 2 }, 'Smallest particle size.'),
      N('Size max', () => P.size[1], (v) => { P.size[1] = Math.max(v, P.size[0]); }, { step: 0.01, min: 0.05, max: 2, prec: 2 }, 'Biggest particle size.')),
    section('Movement',
      N('Gravity', () => P.gravity, (v) => { P.gravity = v; }, { step: 0.05, min: -3, max: 6, prec: 2 }, 'How strongly they fall. Negative floats up.'),
      N('Air drag', () => P.drag, (v) => { P.drag = v; }, { step: 0.05, min: 0, max: 6, prec: 2 }, 'How much the air slows them. Higher = floatier, slower falling.'),
      N('Flutter', () => P.flutter, (v) => { P.flutter = v; }, { step: 0.05, min: 0, max: 4, prec: 2 }, 'Side to side drifting as they fall.'),
      N('Tumble', () => P.tumble, (v) => { P.tumble = v; }, { step: 0.05, min: 0, max: 10, prec: 2 }, 'How fast they turn over as they fall.'),
      N('Spread', () => P.spread, (v) => { P.spread = v; }, { step: 0.01, min: 0, max: 2, prec: 2 }, 'How wide an area around the cursor they appear in.'),
      N('Launch', () => P.launch, (v) => { P.launch = v; }, { step: 0.05, min: 0, max: 4, prec: 2 }, 'How hard they are puffed out when they appear.'),
      N('Cursor push', () => P.push, (v) => { P.push = v; }, { step: 0.02, min: 0, max: 1.5, prec: 2 }, 'How much they inherit the cursor\'s motion, so a fast swipe throws them along.')),
    section('Colours',
      ...P.colors.map((c, i) => fColor('Colour ' + (i + 1), () => P.colors[i], (v) => { P.colors[i] = v; }, 'One of the colours picked at random for each particle.'))),
    section('Cursor trail',
      fCheck('Trail behind the cursor', () => P.cursorTrail.on, (v) => { P.cursorTrail.on = v; reb(); renderInspector(); }, 'A fading ribbon that follows the cursor itself (the black feathers use a red one).'),
      ...(P.cursorTrail.on ? [
        N('Length', () => P.cursorTrail.len, (v) => { P.cursorTrail.len = Math.round(v); }, { step: 1, min: 2, max: 120, prec: 0 }, 'How long the cursor trail is.'),
        N('Width', () => P.cursorTrail.width, (v) => { P.cursorTrail.width = v; }, { step: 0.01, min: 0.01, max: 1, prec: 2 }, 'How thick the cursor trail is.'),
        N('Strength', () => P.cursorTrail.alpha, (v) => { P.cursorTrail.alpha = v; }, { step: 0.05, min: 0.05, max: 1, prec: 2 }, 'How solid the trail looks.'),
        fColor('Colour', () => P.cursorTrail.color, (v) => { P.cursorTrail.color = v; }, 'Cursor trail colour.')] : [])),
    section('Trail',
      fCheck('Trail behind each one', () => P.trail.on, (v) => { P.trail.on = v; reb(); renderInspector(); }, 'Draws a fading ribbon behind every particle.'),
      ...(P.trail.on ? [
        N('Length', () => P.trail.len, (v) => { P.trail.len = Math.round(v); }, { step: 1, min: 2, max: 80, prec: 0 }, 'How long the trail is.'),
        N('Width', () => P.trail.width, (v) => { P.trail.width = v; }, { step: 0.01, min: 0.01, max: 0.6, prec: 2 }, 'How thick the trail is.'),
        N('Strength', () => P.trail.alpha, (v) => { P.trail.alpha = v; }, { step: 0.05, min: 0.05, max: 1, prec: 2 }, 'How solid the trail looks.'),
        fColor('Colour', () => P.trail.color, (v) => { P.trail.color = v; }, 'Trail colour.')] : []),
      h('p', { class: 'note' }, 'Particles are emitted from the red dot and follow the preview cursor around automatically. Trail changes apply after you let go of the slider.')),
  );
}

// ------------------------------------------------------------ quick presets and whole-body tools (ragdolls especially)
const isRagdoll = () => rig.segments.some((x) => x.attachments.some((a) => a.skin));
const bodySegs = () => rig.segments.filter((x) => x.limit != null || x.radius != null);   // the body's joints (not the key ring / links above it)
function applyPhysics(p, label) {
  Object.assign(rig.physics, p); rebuild(); commit(); renderInspector(); toast(label);
}
function scaleBody(kind, k, label) {
  const segs = bodySegs(); let n = 0;
  for (const sg of segs) {
    if (kind === 'stiff' && (sg.stiffness || 0) > 0) { sg.stiffness = round(Math.min(0.95, Math.max(0.01, sg.stiffness * k)), 3); n++; }
    else if (kind === 'limit' && sg.limit) { sg.limit = Math.round(Math.min(180, Math.max(5, sg.limit * k))); n++; }
    else if (kind === 'mass') { sg.mass = round(Math.min(50, Math.max(0.02, sg.mass * k)), 3); n++; }
  }
  if (!n) { toast('Nothing to change here'); return; }
  rebuild(); commit(); renderInspector(); toast(label + ' (' + n + ' parts)');
}
function shakeTest() { if (!simulating) toggleSim(true); simTime = 0; shakeUntil = performance.now() + 1600; toast('Shaking…'); }
function presetsSection() {
  const rows = [
    section('Quick presets',
      h('div', { class: 'ibtns' },
        btn('Floaty', () => applyPhysics(isRagdoll() ? { gravity: 12, damping: 0.04, depthSway: 6 } : { gravity: 16, damping: 0.02 }, 'Floaty: lighter gravity')),
        btn('Natural', () => applyPhysics(isRagdoll() ? { gravity: 18, damping: 0.05, depthSway: 5 } : { gravity: 34, damping: 0.02 }, 'Natural')),
        btn('Heavy', () => applyPhysics(isRagdoll() ? { gravity: 28, damping: 0.07, depthSway: 3 } : { gravity: 60, damping: 0.04 }, 'Heavy: stronger gravity'))),
      h('div', { class: 'ibtns' }, btn('Shake test', shakeTest)),
      h('p', { class: 'note' }, 'Presets set gravity and drag in one click. Shake test starts the simulation and waggles the cursor for a moment so you can feel the physics without grabbing it yourself.')),
  ];
  if (isRagdoll()) rows.push(section('Whole body',
    h('div', { class: 'ibtns' }, btn('Floppier', () => scaleBody('stiff', 0.7, 'Floppier joints')), btn('Stiffer', () => scaleBody('stiff', 1.4, 'Stiffer joints'))),
    h('div', { class: 'ibtns' }, btn('More limb freedom', () => scaleBody('limit', 1.25, 'More limb freedom')), btn('Less limb freedom', () => scaleBody('limit', 0.8, 'Less limb freedom'))),
    h('div', { class: 'ibtns' }, btn('Heavier body', () => scaleBody('mass', 1.3, 'Heavier body')), btn('Lighter body', () => scaleBody('mass', 0.77, 'Lighter body'))),
    h('p', { class: 'note' }, 'Changes every body joint at once (shoulders, hips, torso, arms, legs). Joints with stiffness 0 are already fully loose, so Floppier/Stiffer only affects the ones that hold the body together. Use Undo if it goes too far, then fine-tune a single part by clicking it in the list.')));
  return rows;
}
function copyPhysicsTo(src, targets, label) {
  for (const t of targets) { t.stiffness = src.stiffness; t.mass = src.mass; if (src.limit) t.limit = src.limit; }
  rebuild(); commit(); toast(label + ' (' + targets.length + ')');
}

function renderInspector() {
  live.length = 0;
  const box = $('#inspector');
  box.innerHTML = '';
  const title = $('#insp-title');
  const reb = () => rebuild();

  if (sel.type === 'rig') {
    title.textContent = 'Rig settings';
    box.append(
      section('Rig',
        fText('Name', () => rig.name, (v) => { rig.name = v; paintStatus(); }),
        fNum('Pixels / unit', () => rig.scale, (v) => { rig.scale = v; updateMarkers(); }, { step: 1, min: 2, max: 400, prec: 1, scrub: 0.5 }),
        h('p', { class: 'note' }, 'How big one editor unit appears on your desktop. The red dot is the point the chain hangs from.'),
      ),
      RC.isOrbit(rig) ? orbitSection() : RC.isParticles(rig) ? particlesSection() : document.createComment(''),
      RC.isOrbit(rig) || RC.isParticles(rig) ? document.createComment('') : section('Physics',
        fNum('Gravity', () => rig.physics.gravity, (v) => { rig.physics.gravity = v; }, { step: 0.5, min: 0, max: 400, prec: 2, scrub: 0.2 }),
        fNum('Air drag', () => rig.physics.damping, (v) => { rig.physics.damping = v; }, { step: 0.005, min: 0, max: 0.9, prec: 3, slider: true }),
        fNum('String drag', () => rig.physics.lightDrag || 0, (v) => { if (v > 0) rig.physics.lightDrag = v; else delete rig.physics.lightDrag; }, { step: 0.01, min: 0, max: 0.3, prec: 2, slider: true, hint: 'Extra drag on the light pieces only (string, links). Higher = the string hangs calm and does not fold up or jiggle, but the swing is a little less lively. 0 = off.' }),
        fNum('Iterations', () => rig.physics.iterations, (v) => { rig.physics.iterations = Math.round(v); }, { step: 1, min: 1, max: 60, prec: 0, scrub: 0.1 }),
        fNum('Substeps', () => rig.physics.substeps, (v) => { rig.physics.substeps = Math.round(v); }, { step: 1, min: 1, max: 16, prec: 0, scrub: 0.05 }),
        fNum('Keep flat', () => rig.physics.flatten, (v) => { rig.physics.flatten = v; }, { step: 0.01, min: 0, max: 1, prec: 2, slider: true }),
        fNum('Depth sway', () => rig.physics.depthSway, (v) => { rig.physics.depthSway = v; }, { step: 0.01, min: 0, max: 1.5, prec: 2, slider: true }),
        h('p', { class: 'note' }, 'More iterations make long chains less stretchy. Keep flat stops the rig swinging toward/away from the screen; set it to 0 for 3D mobiles. Press Space to simulate.'),
      ),
      ...(RC.isOrbit(rig) || RC.isParticles(rig) ? [] : [topRingSection(), ...presetsSection()]),
      section('Info', h('p', { class: 'note' }, (RC.isParticles(rig) ? 'Particle emitter' : `${rig.segments.length} segments · ${rig.segments.reduce((n, s) => n + s.attachments.length, rig.anchor.attachments.length)} parts · id ${rig.id}`))),
    );
    return;
  }

  if (sel.type === 'anchor') {
    title.textContent = 'Cursor anchor';
    box.append(
      section('Anchor',
        fVec('Offset', () => rig.anchor.offset, () => repose(), { step: 0.01 }),
        h('p', { class: 'note' }, 'Where this chain hangs from, as a small extra shift from the shared hang point (the red dot; set up in the menu under Settings, Chain position) (Y up). Parts added here ride along with the cursor without swinging.'),
      ),
      section('Add', h('div', { class: 'ibtns' }, btn('+ Segment', addSegment), btn('+ Chain…', addChain), btn('Extend…', () => extendChain()))),
    );
    return;
  }

  if (sel.type === 'segment') {
    const s = segById(sel.segId);
    if (!s) return;
    if (RC.isOrbit(rig)) { planetInspector(s, box, title); return; }
    title.textContent = 'Segment';
    const i = nodeIndex(s.id);
    const restEuler = () => RC.quatToEulerDeg(s.rest);
    let eul = restEuler();
    const banned = new Set([s.id, ...RC.descendants(rig, s.id).map((d) => d.id)]);
    const parentOpts = [['', 'Cursor anchor'], ...rig.segments.filter((x) => !banned.has(x.id)).map((x) => [x.id, x.name])];
    live.push(() => { eul = restEuler(); });
    box.append(
      section('Segment',
        fText('Name', () => s.name, (v) => { s.name = v; renderTree(); }),
        fSelect('Parent', parentOpts, () => s.parent || '', (v) => { reparentSegment(s.id, v || null); }),
        fNum('Length', () => s.length, (v) => { s.length = v; rebuild(); renderTree(); }, { step: 0.01, min: 0.01, max: 100, scrub: 0.005 }),
        h('p', { class: 'note' }, `≈ ${Math.round(s.length * rig.scale)} px on screen`),
        fVec('Rest angle°', () => eul, () => {
          s.rest = RC.eulerDegToQuat(eul).toArray().map((v) => round(v, 5));
          sim.restQ[i].fromArray(s.rest); repose(); attachGizmo();
        }, { step: 1, prec: 2 }),
        h('p', { class: 'note' }, 'Direction relative to the parent segment. Only matters when stiffness is above 0. Use the Rotate gizmo or drag the joint with Move.'),
      ),
      section('Physics',
        fNum('Stiffness', () => s.stiffness, (v) => { s.stiffness = v; }, { step: 0.01, min: 0, max: 0.99, prec: 2, slider: true }),
        fNum('Mass', () => s.mass, (v) => { s.mass = v; }, { step: 0.1, min: 0.01, max: 100, prec: 2, scrub: 0.02 }),
        h('p', { class: 'note' }, 'Stiffness 0 = loose rope, 0.9+ = nearly rigid. Mass is relative to the other segments.'),
        h('div', { class: 'ibtns' },
          btn('Copy to child segments', () => copyPhysicsTo(s, RC.descendants(rig, s.id), 'Copied stiffness and mass to the segments below this one')),
          btn('Copy to all segments', () => copyPhysicsTo(s, rig.segments.filter((x) => x !== s), 'Copied stiffness and mass to every segment'))),
      ),
      ...(rig.segments.some((x) => x.attachments.some((a) => a.skin)) ? [section('Ragdoll joint',
        fNum('Joint limit°', () => s.limit || 0, (v) => { if (v > 0) s.limit = v; else delete s.limit; rebuild(); }, { step: 1, min: 0, max: 180, prec: 0, slider: true, hint: 'Most this part may bend away from its resting direction. 0 = no limit.' }),
        fNum('Collision size', () => s.radius || 0, (v) => { if (v > 0) s.radius = v; else delete s.radius; rebuild(); }, { step: 0.005, min: 0, max: 1, prec: 3, scrub: 0.002, hint: 'Thickness of this part for pushing other body parts away. 0 = does not collide.' }),
        ...(s.attachments.some((a) => a.skin) ? [fNum('Raise body', () => s.sink || 0, (v) => { if (v > 0) s.sink = v; else delete s.sink; rebuild(); }, { step: 0.01, min: 0, max: 2, prec: 3, scrub: 0.005, hint: 'Moves the whole body up toward the chain (the chain hooks on this far further down the head). Use it to close a gap between the chain and the head.' })] : []),
        h('p', { class: 'note' }, 'Ragdoll bodies are one skinned model: change these numbers, not the model attachment\'s position or rotation (those do nothing here).'),
      )] : []),
      section('Actions', h('div', { class: 'ibtns' },
        btn('+ Child segment', addSegment), btn('+ Link', () => extendChain(true)), btn('Extend chain…', () => extendChain()), btn('Duplicate branch', duplicateSel), btn('Delete', deleteSel, 'danger'))),
    );
    return;
  }

  if (sel.type === 'attachment') {
    const f = findAtt(sel.attId);
    if (!f) return;
    const a = f.att;
    title.textContent = a.kind === 'model' ? 'Model part' : 'Primitive part';
    const segOpts = [['', 'Cursor anchor'], ...rig.segments.map((x) => [x.id, x.name])];
    const transform = () => { const o = view.attObjects.get(a.id); if (o) { o.position.fromArray(a.position); const r = THREE.MathUtils.degToRad; o.rotation.set(r(a.rotation[0]), r(a.rotation[1]), r(a.rotation[2])); o.scale.fromArray(a.scale); } };
    let uniform = Math.abs(a.scale[0] - a.scale[1]) < 1e-6 && Math.abs(a.scale[1] - a.scale[2]) < 1e-6;

    const shapeSec = a.kind === 'primitive'
      ? section('Shape',
          fSelect('Shape', RC.SHAPES.map((s) => [s, s]), () => a.shape, (v) => { a.shape = v; reb(); renderTree(); attachGizmo(); }),
          (a.shape === 'torus' || a.shape === 'ring') ? fNum('Thickness', () => a.thickness, (v) => { a.thickness = v; reb(); }, { step: 0.01, min: 0.02, max: 0.48, prec: 2, slider: true }) : null)
      : section('Model',
          h('p', { class: 'note' }, h('b', {}, a.model || 'no file')),
          fCheck('Fit into 1 unit box', () => a.fit, (v) => { a.fit = v; reb(); }),
          fCheck('Override colour', () => a.useColor, (v) => { a.useColor = v; reb(); renderInspector(); }),
          h('div', { class: 'ibtns' }, btn('Replace file…', () => importModelInto(a))));

    const look = section('Look',
      (a.kind === 'primitive' || a.useColor) ? fColor('Colour', () => a.color, (v) => { a.color = v; reb(); }) : null,
      (a.kind === 'primitive' || a.useColor) ? fNum('Metalness', () => a.metalness, (v) => { a.metalness = v; reb(); }, { step: 0.01, min: 0, max: 1, prec: 2, slider: true }) : null,
      (a.kind === 'primitive' || a.useColor) ? fNum('Roughness', () => a.roughness, (v) => { a.roughness = v; reb(); }, { step: 0.01, min: 0, max: 1, prec: 2, slider: true }) : null,
      fNum('Opacity', () => a.opacity, (v) => { a.opacity = v; reb(); }, { step: 0.01, min: 0.05, max: 1, prec: 2, slider: true }),
      (a.kind === 'primitive' || a.useColor) ? fColor('Glow colour', () => a.emissive, (v) => { a.emissive = v; reb(); }) : null,
      (a.kind === 'primitive' || a.useColor) ? fNum('Glow', () => a.emissiveIntensity, (v) => { a.emissiveIntensity = v; reb(); }, { step: 0.05, min: 0, max: 5, prec: 2, slider: true }) : null,
      fNum('Soft halo', () => a.glow || 0, (v) => { a.glow = v; reb(); }, { step: 0.1, min: 0, max: 8, prec: 1, slider: true }),
      fNum('Idle spin (deg/s)', () => a.spin || 0, (v) => { if (v) a.spin = v; else delete a.spin; reb(); }, { step: 1, min: -360, max: 360, prec: 0, hint: 'How fast this part twirls on your cursor. 0 = it never turns. This is why a chain can look different on your cursor than here: the editor holds spinning parts still unless you tick "Show spin" at the top.' }),
      fNum('Spin when moving', () => a.spinDrive || 0, (v) => { if (v) a.spinDrive = v; else delete a.spinDrive; reb(); }, { step: 0.05, min: -5, max: 5, prec: 2, hint: 'Extra twirl that follows how fast you move the mouse sideways. 0 = none.' }),
      (a.kind === 'primitive' || a.useColor) ? fCheck('Flat shading (low-poly look)', () => a.flatShading, (v) => { a.flatShading = v; reb(); }) : null,
    );

    box.append(
      section('Part',
        fText('Name', () => a.name, (v) => { a.name = v; renderTree(); }),
        fSelect('Attached to', segOpts, () => f.seg?.id || '', (v) => moveAttachment(a.id, v || null)),
        fCheck('Visible', () => a.visible, (v) => { a.visible = v; transform(); const o = view.attObjects.get(a.id); if (o) o.visible = v; renderTree(); }),
      ),
      shapeSec,
      section('Transform',
        fVec('Position', () => a.position, transform, { step: 0.01 }),
        fVec('Rotation°', () => a.rotation, transform, { step: 1, prec: 2 }),
        uniform
          ? fNum('Size', () => a.scale[0], (v) => { a.scale = [v, v, v]; transform(); }, { step: 0.01, min: 0.001, prec: 3, scrub: 0.005 })
          : fVec('Scale', () => a.scale, transform, { step: 0.01, min: 0.001 }),
        fCheck('Uniform size', () => uniform, (v) => { uniform = v; if (v) a.scale = [a.scale[0], a.scale[0], a.scale[0]]; transform(); renderInspector(); }),
        h('p', { class: 'note' }, 'Local to the segment: it starts at the joint above and runs down −Y.'),
      ),
      look,
      section('Actions', h('div', { class: 'ibtns' },
        f.seg ? btn('Copy down chain…', () => repeatDownChain(a.id)) : null,
        btn('Duplicate', duplicateSel), btn('Delete', deleteSel, 'danger'))),
    );
  }
}

// ------------------------------------------------------------ rig check
async function runRigCheck() {
  const issues = RC.checkRig(RC.normalizeRig(rig));
  if (!issues.length) { await modal('Rig check', [{ type: 'note', title: 'No problems found', text: 'Nothing here should make this rig look stiff or twitchy.' }], 'OK'); return; }
  const fields = [];
  for (const i of issues) {
    fields.push({ type: 'note', level: i.level, title: i.title, text: i.detail });
    if (i.fix) fields.push({ key: i.id, type: 'check', label: i.fixLabel, value: i.fix === 'weightedSegment' });
  }
  const v = await modal(`Rig check: ${issues.length} thing${issues.length > 1 ? 's' : ''} to look at`, fields, 'Apply ticked fixes');
  if (!v) return;
  let n = 0;
  for (const i of issues) if (i.fix && v[i.id] && RC.fixIssue(rig, i)) n++;
  if (n) { commit(); rebuild(); renderTree(); select(sel); toast(`Applied ${n} fix${n > 1 ? 'es' : ''}`); }
}
$('#btn-check').onclick = runRigCheck;

// --------------------------------------------------------------- modal
function modal(title, fields, okLabel = 'OK') {
  return new Promise((resolve) => {
    $('#modal-title').textContent = title;
    $('#modal-ok').textContent = okLabel;
    const body = $('#modal-body');
    body.innerHTML = '';
    const getters = {};
    for (const f of fields) {
      let input;
      if (f.type === 'note') {
        body.append(h('div', { class: 'note ' + (f.level || '') }, h('b', {}, f.title), h('div', {}, f.text)));
        continue;
      }
      if (f.type === 'check') {
        input = h('input', { type: 'checkbox' }); input.checked = f.value;
        body.append(h('label', { class: 'check' }, input, f.label));
        getters[f.key] = () => input.checked;
      } else if (f.type === 'select') {
        input = h('select', {}, f.options.map(([v, t]) => h('option', { value: v }, t)));
        input.value = f.value;
        body.append(h('div', { class: 'f' }, h('span', { class: 'fl' }, f.label), input));
        getters[f.key] = () => input.value;
      } else {
        input = h('input', { type: 'number', value: f.value, step: f.step ?? 'any', min: f.min, max: f.max });
        body.append(h('div', { class: 'f' }, h('span', { class: 'fl' }, f.label), input));
        getters[f.key] = () => parseFloat(input.value);
      }
    }
    const back = $('#modal');
    back.hidden = false;
    body.querySelector('input,select')?.focus();
    const close = (val) => {
      back.hidden = true;
      $('#modal-form').onsubmit = null; $('#modal-cancel').onclick = null; back.onkeydown = null;
      resolve(val);
    };
    $('#modal-form').onsubmit = (e) => { e.preventDefault(); close(Object.fromEntries(Object.entries(getters).map(([k, g]) => [k, g()]))); };
    $('#modal-cancel').onclick = () => close(null);
    back.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(null); };
  });
}

// ---------------------------------------------------------- simulation
const simCursor = new THREE.Vector3();
let simTime = 0;
let shakeUntil = 0;
let simDragging = false;
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

function toggleSim(on = !simulating) {
  simulating = on;
  $('#btn-sim').classList.toggle('on', on);
  $('#btn-sim span').textContent = on ? 'Stop' : 'Simulate';
  orbit.mouseButtons = on ? { ...ORBIT_SIM } : { ...ORBIT_EDIT };
  simCursor.set(0, 0, 0);
  simTime = 0;
  if (!on) repose();
  attachGizmo();
  paintModeButtons();
  paintStatus();
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}

// Shift + drag on empty space draws a selection box (Ctrl/Cmd+Shift adds to the current selection).
const marquee = document.createElement('div');
marquee.style.cssText = 'position:fixed;display:none;pointer-events:none;border:1px solid #fff;background:rgba(255,255,255,.12);z-index:50';
document.body.append(marquee);
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.shiftKey || simulating || tc.axis) return;
  e.stopImmediatePropagation();
  const x0 = e.clientX, y0 = e.clientY;
  const add = e.ctrlKey || e.metaKey;
  let boxed = false;
  const rect = (ev) => ({ l: Math.min(x0, ev.clientX), t: Math.min(y0, ev.clientY), r: Math.max(x0, ev.clientX), b: Math.max(y0, ev.clientY) });
  const move = (ev) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) boxed = true;
    if (!boxed) return;
    const q = rect(ev);
    Object.assign(marquee.style, { display: 'block', left: q.l + 'px', top: q.t + 'px', width: q.r - q.l + 'px', height: q.b - q.t + 'px' });
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    marquee.style.display = 'none';
    if (!boxed) return pick(ev);          // plain shift-click toggles one part
    const q = rect(ev);
    const cr = renderer.domElement.getBoundingClientRect();
    const hit = [];
    const v = new THREE.Vector3();
    for (const [id, obj] of view.attObjects) {
      if (!obj.visible || !findAtt(id)) continue;
      obj.getWorldPosition(v).project(camera);
      if (v.z > 1) continue;
      const px = cr.left + (v.x + 1) / 2 * cr.width, py = cr.top + (1 - v.y) / 2 * cr.height;
      if (px >= q.l && px <= q.r && py >= q.t && py <= q.b) hit.push(id);
    }
    selectMulti(add ? [...new Set([...selectedAttIds(), ...hit])] : hit);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}, true);

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  renderer.domElement.focus();
  down = { x: e.clientX, y: e.clientY, button: e.button };
  if (simulating && e.button === 0) {
    simDragging = true;
    $('#chk-swing').checked = false;
    renderer.domElement.setPointerCapture(e.pointerId);
    moveSimCursor(e);
  }
});
renderer.domElement.addEventListener('pointermove', (e) => { if (simDragging) moveSimCursor(e); });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (simDragging) { simDragging = false; return; }
  if (!down || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 4 || tc.dragging) return;
  pick(e);
});
function moveSimCursor(e) {
  setNdc(e);
  dragPlane.constant = 0;
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(dragPlane, p)) simCursor.copy(p);
}

function pick(e) {
  if (simulating) return;
  setNdc(e);
  if (ray.intersectObject(anchorMark, false).length) return select({ type: 'anchor' });
  const hits = ray.intersectObject(view.root, true);
  const showBones = $('#chk-bones').checked;
  const bone = showBones && hits.find((h) => findUp(h.object, 'boneSeg'));
  if (bone) return select({ type: 'segment', segId: findUp(bone.object, 'boneSeg') });
  for (const hit of hits) {
    const att = findUp(hit.object, 'att');
    if (att && hit.object.visible) return (e.ctrlKey || e.metaKey || e.shiftKey) ? toggleAtt(att.attId) : select({ type: 'attachment', attId: att.attId });
  }
  select({ type: 'rig' });
}
function findUp(o, key) {
  while (o) { if (o.userData?.[key] !== undefined) return o.userData[key]; o = o.parent; }
  return undefined;
}

// --------------------------------------------------------------- camera
function frameAll() {
  if (!sim) return;
  const box = new THREE.Box3();
  for (let i = 0; i < sim.n; i++) box.expandByPoint(sim.pos[i]);
  box.expandByPoint(new THREE.Vector3());
  if (RC.isOrbit(rig)) { const R = Math.max(0.5, ...rig.orbit.rings.map((r) => r.radius)); box.expandByPoint(new THREE.Vector3(R, R * 0.5, R)); box.expandByPoint(new THREE.Vector3(-R, -R * 0.5, -R)); }
  if (RC.isParticles(rig)) { box.expandByPoint(new THREE.Vector3(2.2, 0.4, 1)); box.expandByPoint(new THREE.Vector3(-2.2, -2.6, -1)); }
  box.expandByScalar(0.4);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = size / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1;
  const dir = new THREE.Vector3(0, 0, 1);   // straight on, exactly how it looks hanging from the desktop cursor
  orbit.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, Math.max(2, dist));
}
// "Desktop view": look at the rig straight on, the way it appears on your screen. Moving a part left/right or up/down shows on the desktop; moving it toward/away from the camera (depth) does not.
function desktopView() { frameAll(); toast('Desktop view: this is how it looks on your screen'); }
document.getElementById('btn-front')?.addEventListener('click', desktopView);
document.getElementById('chk-spin')?.addEventListener('change', (ev) => { if (view) view.spinEnabled = ev.target.checked; toast(ev.target.checked ? 'Showing the spin, like on your cursor' : 'Spin held still while you edit'); });
function focusSel() {
  let p = null;
  if (sel.type === 'segment') { const i = nodeIndex(sel.segId); p = sim.pos[i].clone().lerp(sim.segStart(i), 0.5); }
  else if (sel.type === 'attachment') { const o = view.attObjects.get(sel.attId); if (o) p = o.getWorldPosition(new THREE.Vector3()); }
  else if (sel.type === 'anchor') p = sim.pos[0].clone();
  if (!p) return frameAll();
  const off = camera.position.clone().sub(orbit.target);
  orbit.target.copy(p);
  camera.position.copy(p).add(off.setLength(Math.min(off.length(), 4)));
}

// ----------------------------------------------------------- main loop
function resize() {
  const r = vp.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(vp);

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (simulating && sim) {
    simTime += dt;
    if ($('#chk-swing').checked) simCursor.set(Math.sin(simTime * 1.6) * 2.2, Math.sin(simTime * 3.2) * 0.5, 0);
    if (shakeUntil > now) simCursor.set(Math.sin(simTime * 16) * 1.8, Math.sin(simTime * 21) * 0.7, 0);   // the 'Shake test' button
    const target = simCursor.clone().add(anchorPos());
    sim.step(dt, target, { flatten: rig.physics.flatten });
    view.update(sim);
    updateMarkers();
  }
  if (!simulating && sim && RC.isParticles(rig)) {
    simTime += dt;
    simCursor.set(Math.sin(simTime * 1.1) * 1.6, Math.sin(simTime * 2.3) * 0.35, 0);
    sim.step(dt, simCursor.clone().add(anchorPos()));
    view.update(sim);
  }
  orbit.update();
  renderer.render(scene, camera);
}

// -------------------------------------------------------------- wiring
const PART_ICONS = { box: '▣', sphere: '●', cylinder: '▮', cone: '▲', torus: '◯', capsule: '⬮', ring: '◎', octahedron: '◆', star: '★' };
// ---- organisation: Find box, fold/open all, inspector groups, hints, View menu
$('#tree-filter').addEventListener('input', (e) => { treeFilter = e.target.value.trim().toLowerCase(); renderTree(); });
$('#tree-fold').onclick = () => { collapsed.add('anchor'); for (const sg of rig.segments) collapsed.add(sg.id); renderTree(); };
$('#tree-unfold').onclick = () => { collapsed.clear(); renderTree(); };
$('#insp-fold').onclick = () => {
  const secs = [...document.querySelectorAll('#inspector .isec')];
  const anyOpen = secs.some((e) => !e.classList.contains('folded'));
  for (const e of secs) { const t = e.querySelector('.sec-h')?.textContent; if (!t) continue; e.classList.toggle('folded', anyOpen); if (anyOpen) foldedSecs.add(t); else foldedSecs.delete(t); }
  saveFolded(); $('#insp-fold').textContent = anyOpen ? 'Open groups' : 'Fold groups';
};
{
  let hints = false; try { hints = localStorage.getItem('rigEd.hints') === '1'; } catch {}
  $('#chk-hints').checked = hints; $('#inspector').classList.toggle('nohints', !hints);
  $('#chk-hints').addEventListener('change', (e) => { $('#inspector').classList.toggle('nohints', !e.target.checked); try { localStorage.setItem('rigEd.hints', e.target.checked ? '1' : '0'); } catch {} });
  $('#view-btn').onclick = (e) => { e.stopPropagation(); $('#view-menu').classList.toggle('open'); };
  $('#view-menu').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => $('#view-menu').classList.remove('open'));
}
RC.SHAPES.forEach((s) => $('#part-menu').append(h('button', { onclick: () => { $('#part-menu').classList.remove('open'); addPart(s); } }, h('span', {}, PART_ICONS[s] || '•'), s)));
$('#add-part').onclick = (e) => { e.stopPropagation(); $('#part-menu').classList.toggle('open'); };
document.addEventListener('click', () => $('#part-menu').classList.remove('open'));
$('#add-seg').onclick = addSegment;
$('#add-chain').onclick = addChain;
$('#btn-chains').onclick = () => toggleChainPanel();
$('#add-extend').onclick = () => extendChain();
$('#add-link').onclick = () => extendChain(true);
$('#add-model').onclick = () => importModelInto(null);

$('#rig-select').onchange = async (e) => {
  const id = e.target.value;
  if (!confirmDiscard()) { e.target.value = rig.id; return; }
  openRig(id);
};
$('#btn-new').onclick = () => { if (confirmDiscard()) openRig('__new__'); };
$('#btn-save').onclick = () => save();
$('#btn-saveas').onclick = () => save({ asCopy: true });
$('#btn-export').onclick = async () => { if (await api.exportRig(RC.normalizeRig(rig))) toast('Exported'); };
$('#btn-delete').onclick = async () => {
  if (!confirm(`Delete rig “${rig.name}”? This can't be undone.`)) return;
  await api.deleteRig(rig.id);
  const list = await api.listRigs();
  savedSnapshot = snapshot();
  openRig(list[0]?.id || '__new__');
};
$('#btn-undo').onclick = undo;
$('#btn-redo').onclick = redo;
$('#btn-sim').onclick = () => toggleSim();
$('#btn-use').onclick = async () => { const id = await save(); await api.equipRig(id, true); await api.setSettings({ overlayVisible: true }); toast('Now hanging from your cursor'); const n = RC.checkRig(RC.normalizeRig(rig)).filter((i) => i.level === 'warn').length; if (n) setTimeout(() => toast(`Rig check found ${n} possible problem${n > 1 ? 's' : ''}. Click Check.`), 2000); };
$('#chk-bones').onchange = (e) => { bones.forEach((b) => b && (b.visible = e.target.checked)); };
$('#chk-grid').onchange = (e) => { grid.visible = e.target.checked; axes.visible = e.target.checked; };

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || !$('#modal').hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save({ asCopy: e.shiftKey }); }
  else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); }
  else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllParts(); }
  else if (mod) return;
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
  else if (e.key === ' ') { e.preventDefault(); toggleSim(); }
  else if (e.key === 'w' || e.key === 'W') setGizmoMode('translate');
  else if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate');
  else if (e.key === 'r' || e.key === 'R') setGizmoMode('scale');
  else if (e.key === 'f' || e.key === 'F') focusSel();
  else if (e.key === 'Escape') select({ type: 'rig' });
});

api.onEditorSaveClose(async () => { try { await save(); api.closeEditor(); } catch { toast("Couldn't save, so the window stays open"); } });
window.addEventListener('beforeunload', (e) => { if (rig && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

api.onEditorOpenRig((id) => { if (id !== rig?.id && confirmDiscard()) openRig(id); });
api.onRigsChanged(() => refreshRigList());

// --------------------------------------------------------------- start
// follow the menu's Dark / Light setting
const applyTheme = (t) => { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; };
try { applyTheme((await api.state()).settings.theme); } catch {}
api.onSettings?.((s) => applyTheme(s.theme));
resize();
const startId = new URLSearchParams(location.search).get('rig');
initBuilder();
await openRig(startId || (await api.state()).settings.activeRig);
requestAnimationFrame(loop);
window.__editor = {
  get rig() { return rig; }, get builder() { return builder; }, toggleBuilder, get tc() { return tc; }, get proxy() { return proxy; }, select, selectMulti, selectAllParts, toggleSim, addChain, extendChain, findChains, chainIssues, toggleChainPanel, makeLinks, openRig, setGizmoMode, frameAll,
  attachModel(segIndex, name) { // dev/test helper
    const seg = rig.segments[segIndex];
    const a = RC.newAttachment('box', { kind: 'model', model: name, name, useColor: false, position: [0, -seg.length, 0], scale: [0.7, 0.7, 0.7] });
    seg.attachments.push(a); commit(); rebuild(); select({ type: 'attachment', attId: a.id });
  },
};
