// Tiny icons of each rig for the menu's list.
// The camera is framed on the main parts (the charm / body). Chain links and rings are drawn
// but ignored when working out the zoom, so they don't shrink the charm; links above the frame get cropped.
import * as THREE from 'three';
import * as RC from '../lib/rig-core.js';

const api = window.rigApi || parent.rigApi;   // the inventory is an iframe inside the menu: the bridge lives on the parent
const SIZE = 168;
let renderer, scene, root, queue = Promise.resolve();

const isLink = (a) => a.kind !== 'model' && (a.shape === 'torus' || a.shape === 'ring' || /link|ring|loop|chain|hook/i.test(a.name || ''));

function init() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  RC.addDefaultLights(scene);
  RC.addEnvironment(renderer, scene);
  root = new THREE.Group();
  scene.add(root);
}

async function render(raw) {
  init();
  const rig = RC.normalizeRig(raw);
  const sim = RC.createSim(rig);
  sim.reset(new THREE.Vector3());
  const view = RC.createView(rig, { assetUrl: api.modelUrl, onModelError: () => {} }); view.noYaw = true; view.spinEnabled = false;   // menu previews always face the front
  root.add(view.root);
  if (RC.isParticles(rig)) sim.warm(3);
  view.update(sim);
  await view.ready;
  root.updateMatrixWorld(true);

  const all = [...rig.anchor.attachments, ...rig.segments.flatMap((s) => s.attachments)].filter((a) => a.visible !== false);
  const focus = all.filter((a) => !isLink(a));
  const box = new THREE.Box3();
  for (const sk of view.skins || []) { sk.obj.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); }); box.expandByObject(sk.obj, true); }   // skinned ragdolls: frame the whole body
  for (const a of (focus.length ? focus : all)) {
    const o = view.attObjects.get(a.id);
    if (o) box.expandByObject(o);
  }
  if (RC.isParticles(rig)) for (const q of sim.parts) if (q.on) { box.expandByPoint(q.pos); }
  let url = '';
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    // Compact charms are centred. Very tall things (a bare chain, a flail) show their hanging end instead
    // of shrinking to a thin line.
    const w = Math.max(sz.x, 0.2);
    const side = Math.max(w, Math.min(sz.y, Math.max(w * 2.2, 0.9)));
    const half = side / 2 * 1.2;
    const cy = sz.y <= side ? c.y : box.min.y - side * 0.1 + half;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, -100, 100);
    const pitch = Math.max(0, Math.min(80, Number(raw?.preview?.pitch) || 0)) * Math.PI / 180;   // optional: look down on it a little (shows a flat top)
    cam.position.set(c.x, cy + Math.sin(pitch) * 50, Math.cos(pitch) * 50);
    cam.lookAt(c.x, cy, 0);
    renderer.render(scene, cam);
    url = renderer.domElement.toDataURL('image/png');
  }
  view.dispose();
  return url;
}

// one at a time: they share a single renderer and scene
export function makeThumb(raw) {
  // a hung or failing thumbnail must never block the ones behind it: time out after 8 s and log why
  const withTimeout = (pr) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('thumbnail timed out')), 8000))]);
  const job = queue.then(() => withTimeout(render(raw))).catch((e) => { try { api.logDebug?.('THUMB FAIL ' + (raw?.name || raw?.id) + ': ' + (e && (e.stack || e.message) || e)); } catch {} return ''; });
  queue = job;
  return job;
}
