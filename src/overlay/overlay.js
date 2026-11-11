import * as THREE from 'three';
import { topRing } from '../shared/ring.js';
import { createSim, createView, normalizeRig, addDefaultLights, addEnvironment, ImpactFX } from '../lib/rig-core.js';

const api = window.rigApi;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
} catch (e) {
  api.reportWebglFailed();   // main offers compatibility mode
  throw e;
}
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
addDefaultLights(scene);
addEnvironment(renderer, scene);
const fx = new ImpactFX(scene, renderer.getPixelRatio());   // wood chips / blood mist / sparks / dust where a chain hits the floor or screen sides
const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -20000, 20000);
camera.position.z = 5000;

// Up to three things hang from the cursor at once: one cursorchain, one cursorbit and one cursor emitter.
// Each has its own size, physics, wind and centring.
const TYPES = ['chain', 'orbit', 'particles'];
const slots = { chain: null, orbit: null, particles: null };   // { json, rig, sim, view, root, pxPerUnit, needsReset, target }

let bounds = null;     // {x,y,width,height,workArea}
let settings = null;
let cursor = null;     // global screen DIP
let t = 0;

function applyBounds() {
  if (!bounds) return;
  renderer.setPixelRatio(settings?.lowPower ? 1 : (window.devicePixelRatio || 1));
  renderer.setSize(bounds.width, bounds.height, false);
  renderer.domElement.style.width = bounds.width + 'px';
  renderer.domElement.style.height = bounds.height + 'px';
  camera.left = bounds.x;
  camera.right = bounds.x + bounds.width;
  camera.top = -bounds.y;
  camera.bottom = -(bounds.y + bounds.height);
  camera.updateProjectionMatrix();
}

// this slot's own settings: the global ones, with its rig's own size/gravity/wind... on top
function eff(type) { return { ...settings, ...(settings?.featGlobal || {}), ...(settings?.feels?.[type] || {}) }; }

function applyScale(type) {
  const s = slots[type]; if (!s) return;
  const px = (s.rig.scale ?? 40) * (eff(type).scale ?? 1);
  if (px !== s.pxPerUnit) { s.pxPerUnit = px; s.needsReset = true; }
  s.root.scale.setScalar(s.pxPerUnit);
  applyRing(type);
  applyLinks(type);
}
// every chain link's size (menu slider): lengthen/shorten each link's bone and scale its parts, so everything below follows
function applyLinks(type) {
  const s = slots[type]; if (!s?.links?.length) return;
  const k = Math.max(0.3, Math.min(4, eff(type).linkSize ?? 1));
  if (k === s.linkK) return;
  s.linkK = k;
  for (const L of s.links) {
    s.sim.len[L.i] = Math.max(0.001, L.len * k);
    for (const a of L.atts) { const ob = s.view.attObjects.get(a.id); if (!ob) continue; ob.position.copy(a.p).multiplyScalar(k); ob.scale.copy(a.s).multiplyScalar(k); }
  }
}
// the metal key ring's own size (menu slider): lengthen/shorten its bone and scale its parts, so everything below follows
function applyRing(type) {
  const s = slots[type]; if (!s?.ring) return;
  const k = Math.max(0.3, Math.min(4, eff(type).ringSize ?? 1));
  if (k === s.ring.k) return;
  s.ring.k = k;
  s.sim.len[s.ring.i] = Math.max(0.001, s.ring.len * k);
  for (const a of s.ring.atts) { const ob = s.view.attObjects.get(a.id); if (!ob) continue; ob.position.copy(a.p).multiplyScalar(k); ob.scale.copy(a.s).multiplyScalar(k); }
}


async function modelHash(name) { try { const r = await fetch(api.modelUrl(name)); const b = await r.arrayBuffer(); const d = await crypto.subtle.digest('SHA-1', b); return b.byteLength + 'b ' + [...new Uint8Array(d)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return 'fetch failed ' + e.message; } }
function clearSlot(type) {
  const s = slots[type]; if (!s) return;
  try { s.view?.dispose(); } catch (e) { console.warn('dispose', e); }
  s.root.removeFromParent(); slots[type] = null; needsClear = true;
}
let needsClear = true;     // the canvas must be wiped once when something is removed, or its last frame stays on screen

function setRigs(map) {
  const force = !!map?.force;
  for (const type of TYPES) {
    const json = map?.[type] || null;
    const key = json ? JSON.stringify(json) : null;
    if (!force && slots[type] && slots[type].key === key) continue;
    clearSlot(type);
    if (!json) continue;
    try {
      const rig = normalizeRig(json);
      const sim = createSim(rig);
      const view = createView(rig, { assetUrl: api.modelUrl, onModelError: (a, e) => console.warn('model', a.model, e) });
      const root = new THREE.Group(); // scaled to pixels
      root.add(view.root);
      scene.add(root);
      slots[type] = { key, rig, sim, view, root, pxPerUnit: 40, needsReset: true, target: new THREE.Vector3(), wind: new THREE.Vector3() };
      const rs = topRing(rig);
      if (rs) slots[type].ring = { k: 1, i: sim.index.get(rs.id), len: sim.len[sim.index.get(rs.id)], atts: rs.attachments.filter((a) => view.attObjects.get(a.id)).map((a) => { const ob = view.attObjects.get(a.id); return { id: a.id, p: ob.position.clone(), s: ob.scale.clone() }; }) };
      slots[type].links = rig.segments.filter((sg) => /^link\b/i.test(sg.name)).map((sg) => ({ i: sim.index.get(sg.id), len: sim.len[sim.index.get(sg.id)], atts: sg.attachments.filter((a) => view.attObjects.get(a.id)).map((a) => { const ob = view.attObjects.get(a.id); return { id: a.id, p: ob.position.clone(), s: ob.scale.clone() }; }) }));
      applyScale(type);
      setTimeout(() => { try { const rows = []; slots[type]?.view.attObjects.forEach((ob, id) => { if (!ob.parent) return; const q = new THREE.Quaternion(); ob.parent.getWorldQuaternion(q); const wp = ob.getWorldPosition(new THREE.Vector3()); rows.push(ob.name + ' parentQ=' + q.toArray().map((v) => v.toFixed(2)) + ' worldPos=' + wp.toArray().map((v) => v.toFixed(1))); }); api.logDebug?.('frames ' + type + ' scale=' + slots[type]?.pxPerUnit + ' :: ' + rows.slice(-4).join(' || ')); } catch {} }, 2500);
      rig.segments.forEach((sg) => sg.attachments.forEach((a) => { if (a.kind === 'model' && a.model) modelHash(a.model).then((h) => api.logDebug?.('overlay loaded model ' + a.model + ' = ' + h)); }));
      try { api.logDebug?.('built ' + type + ' ' + rig.id + ' ' + rig.segments.flatMap((x) => x.attachments.filter((a) => a.kind === 'model').map((a) => a.model + '@' + JSON.stringify(a.position))).join(' ')); } catch {}
    } catch (e) { console.warn('could not build', type, e); }
  }
  renderer.clear(); needsClear = true;
  applyOpacity();
}
const first = () => TYPES.map((k) => slots[k]).find(Boolean) || null;
const firstType = () => TYPES.find((k) => slots[k]) || 'chain';
function applyOpacity() { renderer.domElement.style.opacity = String(first() ? eff(firstType()).opacity ?? 1 : 1); }

// Where an item hangs from: the pointer position plus the global "hang point" (screen pixels, set in the menu),
// plus this item's own centring offset (rig.hang) and its anchor offset.
function cursorTarget(s, out) {
  const o = s.rig.anchor.offset, h = s.rig.hang || { x: 0, y: 0 };
  const hx = (settings?.hangX ?? 0) + (h.x || 0), hy = (settings?.hangY ?? 0) + (h.y || 0);
  return out.set((cursor.x + hx) / s.pxPerUnit + o[0], -(cursor.y + hy) / s.pxPerUnit + o[1], o[2]);
}
// red dot shown on screen while the position set-up page is open
const hangDot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff2a2a, depthTest: false }));
hangDot.renderOrder = 99; hangDot.visible = false;
scene.add(hangDot);   // in screen pixels (the camera is in pixels)

api.onBounds((b) => { bounds = b; applyBounds(); });
api.onSettings((s) => {
  const prevLow = settings?.lowPower;
  settings = s;
  if (prevLow !== s.lowPower) applyBounds();
  TYPES.forEach(applyScale);
  applyOpacity();
});
api.onActiveRigs((map) => setRigs(map));
api.onCursor((p) => { cursor = p; });

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  if (settings?.lowPower && now - last < 31) return;   // performance mode: about 30 frames a second
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (settings?.hangPreview && cursor && bounds) {
    hangDot.visible = true;
    hangDot.scale.setScalar(2.5);
    hangDot.position.set(cursor.x + (settings.hangX ?? 0), -(cursor.y + (settings.hangY ?? 0)), 0);
  } else hangDot.visible = false;
  if (!settings?.overlayVisible || !cursor || !bounds || !first()) {
    if (hangDot.visible || needsClear) { renderer.render(scene, camera); needsClear = false; }   // render() clears first, so nothing is left behind
    return;
  }
  needsClear = false;
  t += dt;
  for (const type of TYPES) {
    const s = slots[type]; if (!s) continue;
    const S = eff(type);
    cursorTarget(s, s.target);
    if (s.needsReset) { s.sim.reset(s.target, s.rig.type !== 'orbit' && s.rig.type !== 'particles'); s.needsReset = false; }
    const opts = {
      gravityScale: (S.gravity ?? 1) * Math.max(0.5, Math.min(1.5, Math.pow(Math.max(0.2, S.scale ?? 1), -0.4))),   // the bigger the Size, the less gravity (in rig units): otherwise a big chain hangs taut and stiff because the cursor's swing shrinks next to it
      dampingAdd: S.damping ?? 0,
      flatten: s.rig.physics.flatten,
      anatomy: Number.isFinite(S.anatomy) ? S.anatomy : 1,
      quality: settings.lowPower ? 0.5 : 1,
      orbitTilt: S.orbitTilt, orbitRoll: S.orbitRoll, orbitSpeed: S.orbitSpeed, orbitSize: S.orbitSize, orbitDir: S.orbitDir, orbitReal: S.orbitReal,
    };
    if (S.wind) {
      const g = s.rig.physics.gravity * (S.windStrength ?? 0.4);
      const gust = 0.55 + 0.45 * Math.sin(t * 0.6) * Math.sin(t * 1.7 + 1.3) + 0.2 * Math.sin(t * 4.1);
      s.wind.set(g * gust, 0, g * 0.25 * Math.sin(t * 0.9));
      opts.wind = s.wind;
    }
    if (S.floor && bounds.workArea) opts.floorY = -((bounds.display || bounds).y + (bounds.display || bounds).height) / s.pxPerUnit;   // the very bottom of the screen (not the top of the Dock)
    if (S.ceiling) opts.ceilY = -(bounds.display || bounds).y / s.pxPerUnit;   // the very top of the screen
    if (S.walls) { opts.minX = bounds.x / s.pxPerUnit; opts.maxX = (bounds.x + bounds.width) / s.pxPerUnit; }
    if (s.view) { s.view.spinFeel = S.spin; s.view.spinAllow = Number.isFinite(S.spinAllow) ? S.spinAllow : 1; }
    s.sim.step(dt, s.target, opts);
    s.view.update(s.sim);
    const impactOn = S.impactOn ?? s.rig.impact?.on ?? false;
    if (impactOn && s.sim.impacts?.length) {
      const style = S.impactStyle ?? s.rig.impact?.style ?? 'wood';
      for (const im of s.sim.impacts) fx.burst(style, im.x * s.pxPerUnit, im.y * s.pxPerUnit, im.nx, im.ny, im.speed, s.pxPerUnit, Number.isFinite(S.impactAmount) ? S.impactAmount : 1);
    }
  }
  fx.setPixelRatio(renderer.getPixelRatio());
  fx.update(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// clear the canvas whenever we stop drawing
api.onSettings((s) => { if (!s.overlayVisible) renderer.clear(); });

api.resync();
