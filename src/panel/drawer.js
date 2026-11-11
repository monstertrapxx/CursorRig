// The "drawer": your cursorchains hanging in a row, drawn live in 3D, scrolled left and right.
// One WebGL canvas sits behind the (transparent) scrolling slots. Only the chains that are actually on
// screen are built and simulated (about six at a time), so it stays light however many chains you own.
import * as THREE from 'three';
import * as RC from '../lib/rig-core.js';

export const SLOT = 150;
const MAX_LIVE = 12;      // the ones on screen plus a spare either side, so chains are already built when they scroll in
const MARGIN = SLOT * 2.2;
const FRAME_MS = 28;   // draw about 35 times a second: smooth enough for a menu, much lighter on weak graphics
const LABEL = 40;     // room for the name under each chain
const RAIL = 26;      // the rod the chains hang from

export function createDrawer({ host, scroller, api, quality = 1 }) {
  let renderer = null, scene, camera, running = false, raf = 0;
  const canvas = document.createElement('canvas');
  canvas.className = 'drawer-canvas';
  host.prepend(canvas);
  const rigCache = new Map();          // id -> raw rig json
  const live = new Map();              // id -> entry for the slots on screen
  let W = 0, H = 0, mouseX = -1e9, last = performance.now(), failed = false;

  function init() {
    if (renderer || failed) return;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (e) { failed = true; canvas.style.display = 'none'; return; }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    RC.addDefaultLights(scene);
    RC.addEnvironment(renderer, scene);
    camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);
    camera.position.z = 10;
  }

  function resize() {
    if (!renderer) return;
    const r = scroller.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.style.left = Math.round(r.left - hr.left) + 'px';
    canvas.style.top = Math.round(r.top - hr.top) + 'px';
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality < 1 ? 1 : 1.5));
    renderer.setSize(W, H, false);
    camera.right = W; camera.top = H; camera.updateProjectionMatrix();
    // sizes depend on the height, so refit what is already built
    for (const e of live.values()) fit(e);
  }

  async function raw(id) {
    if (!rigCache.has(id)) rigCache.set(id, api.loadRig(id));
    return rigCache.get(id);
  }

  async function build(id) {
    const data = await raw(id);
    if (!data || !live.has(id)) return;
    const rig = RC.normalizeRig(data);
    const sim = RC.createSim(rig);
    sim.reset(new THREE.Vector3());
    if (RC.isParticles(rig)) sim.warm(2.5);
    const view = RC.createView(rig, { assetUrl: api.modelUrl, onModelError: () => {} }); view.noYaw = true; view.spinEnabled = false;   // menu previews always face the front
    view.root.visible = false;
    scene.add(view.root);
    view.update(sim);
    const e = Object.assign(live.get(id), { rig, sim, view, s: 30, anchorY: H / 2, sway: 0, phase: Math.random() * 6.28, orbit: RC.isOrbit(rig) || RC.isParticles(rig), particles: RC.isParticles(rig), ready: false });
    fit(e);
    // the ring, links and model all appear together: nothing is drawn until the model has loaded (before, the ring and links showed first and the model popped in later, in a slightly different place)
    view.ready.then(() => { if (live.get(id) === e) { e.ready = true; fit(e); pose(e); } }, () => { if (live.get(id) === e) { e.ready = true; fit(e); } });
  }

  // scale the chain to the room it has, and work out where its anchor sits
  function fit(e) {
    if (!e.view) return;
    e.view.root.updateMatrixWorld(true);
    e.view.root.scale.setScalar(1); e.view.root.position.set(0, 0, 0); e.view.root.updateMatrixWorld(true);
    // skinned rigs: measure the POSED mesh, not the bind pose, so every preview's ring sits at the same height
    try { if (e.sim) e.view.update(e.sim); } catch (_) {}
    e.view.root.updateMatrixWorld(true);
    e.view.root.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.update(); });
    const box = new THREE.Box3().setFromObject(e.view.root, true);
    if (box.isEmpty()) { e.s = 30; e.anchorY = RAIL + 30; e.view.root.visible = !!e.ready; return; }
    const room = Math.max(40, H - RAIL - LABEL);
    if (e.orbit) {
      const R = e.particles ? 1.5 : Math.max(0.3, ...e.rig.orbit.rings.map((r) => r.radius)) + 0.4;
      e.s = Math.min((SLOT * 0.46) / R, (room / 2) / (R * 0.95), 90);
      e.anchorY = RAIL + room / 2;
    } else {
      const below = Math.max(0.2, -box.min.y), above = Math.max(0, box.max.y), half = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), 0.15);
      e.s = Math.min(room / (below + above + 0.15), (SLOT * 0.42) / half, 80);
      e.anchorY = RAIL + above * e.s;
    }
    e.view.root.visible = !!e.ready;
  }

  function sync() {
    const sl = scroller.scrollLeft;
    const want = [];
    scroller.querySelectorAll('.slot').forEach((el) => {
      const x = el.offsetLeft - sl;
      if (x + SLOT > -MARGIN && x < W + MARGIN) want.push({ id: el.dataset.id, cx: x + SLOT / 2 });
    });
    want.sort((a, b) => Math.abs(a.cx - W / 2) - Math.abs(b.cx - W / 2));   // keep the ones nearest the middle if there are too many
    want.length = Math.min(want.length, MAX_LIVE);
    const keep = new Set(want.map((w) => w.id));
    for (const [id, e] of live) if (!keep.has(id)) { e.view?.dispose(); live.delete(id); }
    for (const w of want) {
      let e = live.get(w.id);
      if (!e) { e = { id: w.id, cx: w.cx, hover: 0 }; live.set(w.id, e); build(w.id); }
      e.cx = w.cx;
    }
  }

  // put every chain exactly where its slot is right now (no physics): done on every scroll tick so chains never trail behind the rail
  function pose(e) {      // root position and size first, then the update: a skinned model reads the root's world matrix, and it used to be a frame old (the model lagged behind its ring and links)
    e.view.root.scale.setScalar(e.s);
    e.view.root.position.set(e.cx, H - e.anchorY, 0);
    e.view.root.updateMatrixWorld(true);
    e.view.update(e.sim);
  }
  function place() {
    sync();
    for (const e of live.values()) if (e.view && e.sim) pose(e);
  }
  let scrolled = false;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!renderer || document.hidden) return;
    if (scrolled) { scrolled = false; if (!W || !H) resize(); place(); if (now - last < FRAME_MS - 2) { renderer.render(scene, camera); } }
    if (now - last < FRAME_MS - 2) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!W || !H) resize();
    sync();
    for (const e of live.values()) {
      if (!e.sim) continue;
      const near = Math.abs(mouseX - e.cx) < SLOT / 2;
      const want = near && !e.orbit ? Math.max(-16, Math.min(16, (mouseX - e.cx) * 0.3)) : 0;
      e.hover += (want - e.hover) * Math.min(1, dt * 8);
      e.t = (e.t || 0) + dt;
      const px = Math.sin(e.t * 0.9 + e.phase) * 2.5 + e.hover;
      const tgt = e.particles ? new THREE.Vector3(Math.sin(e.t * 1.2 + e.phase) * 0.7, 0.9 + Math.sin(e.t * 2.1) * 0.2, 0) : new THREE.Vector3(e.orbit ? 0 : px / e.s, 0, 0);
      e.sim.step(dt, tgt, { quality, flatten: e.rig.physics.flatten });
      pose(e);
    }
    renderer.render(scene, camera);
  }

  scroller.addEventListener('scroll', () => { scrolled = true; }, { passive: true });
  scroller.addEventListener('pointermove', (ev) => { mouseX = ev.clientX - scroller.getBoundingClientRect().left; });
  scroller.addEventListener('pointerleave', () => { mouseX = -1e9; });
  new ResizeObserver(() => resize()).observe(scroller);

  return {
    start() { init(); if (failed) return false; canvas.style.display = ''; resize(); if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } return true; },
    stop() { running = false; cancelAnimationFrame(raf); canvas.style.display = 'none'; for (const e of live.values()) e.view?.dispose(); live.clear(); },
    forget(id) { rigCache.delete(id); const e = live.get(id); if (e) { e.view?.dispose(); live.delete(id); } },   // chain changed: rebuild it
    get failed() { return failed; },
  };
}
