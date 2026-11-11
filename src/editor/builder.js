import * as RC from '../lib/rig-core.js';

const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p;

export const STYLES = {
  silver: { label: 'Silver', color: '#c9ccd2', metalness: 1, roughness: 0.3 },
  chrome: { label: 'Chrome', color: '#e8ecf2', metalness: 1, roughness: 0.08 },
  steel: { label: 'Steel', color: '#aab0ba', metalness: 0.9, roughness: 0.28 },
  gold: { label: 'Gold', color: '#d4a640', metalness: 0.95, roughness: 0.3 },
  rose: { label: 'Rose gold', color: '#d89a8c', metalness: 0.95, roughness: 0.32 },
  copper: { label: 'Copper', color: '#b87333', metalness: 0.9, roughness: 0.35 },
  bronze: { label: 'Bronze', color: '#9c6b3c', metalness: 0.85, roughness: 0.4 },
  black: { label: 'Black metal', color: '#2a2a2e', metalness: 0.9, roughness: 0.35 },
  plastic: { label: 'Red plastic', color: '#d9453b', metalness: 0.05, roughness: 0.5 },
};
export const CORDS = {
  natural: { label: 'Natural', color: '#d8c8a2' }, black: { label: 'Black', color: '#222225' }, red: { label: 'Red', color: '#c43c3c' },
  blue: { label: 'Blue', color: '#3d6fd8' }, white: { label: 'White', color: '#efefef' }, pink: { label: 'Pink', color: '#f08cb4' },
  leather: { label: 'Leather brown', color: '#7a5230' }, green: { label: 'Green', color: '#3f9b5a' }, yellow: { label: 'Yellow', color: '#e8c53d' },
  orange: { label: 'Orange', color: '#e8803a' }, purple: { label: 'Purple', color: '#8a5ad6' }, grey: { label: 'Grey', color: '#8d9098' },
  silver: { label: 'Silver', color: '#c9ccd2' }, gold: { label: 'Gold', color: '#d4a640' },
};

const att = (shape, o) => RC.newAttachment(shape, o);
const metalOf = (st) => ({ color: st.color, metalness: st.metalness, roughness: st.roughness });
const shade = (hex, f) => '#' + [1, 3, 5].map((i) => Math.round(Math.min(255, parseInt(hex.slice(i, i + 2), 16) * f)).toString(16).padStart(2, '0')).join('');
const P = (shape, name, position, scale, color, o = {}) => att(shape, { name, position, scale, color, metalness: 0.2, roughness: 0.5, ...o });
const GOLD = { metalness: 0.95, roughness: 0.3 };

// ---- ropes and strings. A string is a run of short equal pieces so it bends smoothly. make(len, {color, thick, bead, metal}, i) returns the parts of piece i.
// Every part is named "string:<type>..." so the builder knows what kind it is (older plain "string" parts still work).
const cyl = (key, len, o) => att('cylinder', { name: 'string:' + key, position: [0, round(-len / 2, 4), 0], scale: [o.thick, round(len * 1.02, 4), o.thick], color: o.color, metalness: o.metal ? 0.9 : 0, roughness: o.metal ? 0.3 : 0.9 });
export const CORD_TYPES = {
  string: { label: 'String', thick: 0.035, mass: 0.6, stiff: 0.04, make: (len, o) => [cyl('string', len, o)] },
  thread: { label: 'Thread (very thin)', thick: 0.012, mass: 0.3, stiff: 0, make: (len, o) => [cyl('thread', len, o)] },
  cord: { label: 'Cord (thicker)', thick: 0.06, mass: 0.7, stiff: 0.05, make: (len, o) => [cyl('cord', len, o)] },
  rope: { label: 'Rope (twisted bands)', thick: 0.09, mass: 0.9, stiff: 0.07, make: (len, o) => [cyl('rope', len, o),
    ...[1, 2].map((k) => att('torus', { name: 'string:rope-wrap', position: [0, round(-len * k / 3, 4), 0], rotation: [90, 0, 0], scale: [round(o.thick * 1.15, 4), round(o.thick * 1.15, 4), round(o.thick * 1.15, 4)], thickness: 0.3, color: shade(o.color, 0.78), metalness: 0, roughness: 0.95 }))] },
  leather: { label: 'Leather lace', thick: 0.05, mass: 0.7, stiff: 0.06, color: '#7a5230', make: (len, o) => [cyl('leather', len, o)] },
  ribbon: { label: 'Ribbon / strap (flat)', thick: 0.16, mass: 0.6, stiff: 0.03, make: (len, o) => [att('box', { name: 'string:ribbon', position: [0, round(-len / 2, 4), 0], scale: [o.thick, round(len * 1.02, 4), 0.014], color: o.color, metalness: 0, roughness: 0.8 })] },
  wire: { label: 'Wire cable (metal)', thick: 0.02, mass: 0.5, stiff: 0.12, color: '#c9ccd2', metal: true, make: (len, o) => [cyl('wire', len, o)] },
};
const cordSpec = (len, key = 'string', color = CORDS.natural.color, extra = {}) => {
  const T = CORD_TYPES[key]; const o = { color: T.color || color, thick: T.thick, metal: !!T.metal, ...extra };
  return { name: 'string', length: len, mass: T.mass, stiffness: T.stiff, parts: T.make(len, o, 0) };
};

// ---- chains: the kind of link. make(L, i, style) returns the parts of link i (L = link spacing). Links alternate a quarter turn so they interlock.
export const CHAIN_TYPES = {
  cable: { label: 'Cable chain (oval links)', mass: 0.2, make: (L, i, st) => [att('torus', { name: 'link:cable', position: [0, round(-L * 0.55, 4), 0], rotation: [0, i % 2 ? 90 : 0, 0], scale: [round(L * 0.9, 4), round(L * 1.65, 4), round(L * 0.9, 4)], thickness: 0.3, ...metalOf(st) })] },
  round: { label: 'Round links (rolo)', mass: 0.2, make: (L, i, st) => [att('torus', { name: 'link:round', position: [0, round(-L * 0.55, 4), 0], rotation: [0, i % 2 ? 90 : 0, 0], scale: [round(L * 1.25, 4), round(L * 1.25, 4), round(L * 1.25, 4)], thickness: 0.28, ...metalOf(st) })] },
  long: { label: 'Long links (paperclip)', mass: 0.2, make: (L, i, st) => [att('torus', { name: 'link:long', position: [0, round(-L * 0.5, 4), 0], rotation: [0, i % 2 ? 90 : 0, 0], scale: [round(L * 0.75, 4), round(L * 2, 4), round(L * 0.75, 4)], thickness: 0.22, ...metalOf(st) })] },
  heavy: { label: 'Heavy curb chain', mass: 0.35, make: (L, i, st) => [att('torus', { name: 'link:heavy', position: [0, round(-L * 0.55, 4), 0], rotation: [0, i % 2 ? 90 : 0, 0], scale: [round(L * 1.05, 4), round(L * 1.55, 4), round(L * 1.05, 4)], thickness: 0.42, ...metalOf(st) })] },
  ball: { label: 'Ball chain', mass: 0.15, make: (L, i, st) => [
    att('sphere', { name: 'link:ball', position: [0, round(-L, 4), 0], scale: [round(L * 0.78, 4), round(L * 0.78, 4), round(L * 0.78, 4)], ...metalOf(st) }),
    att('cylinder', { name: 'link:ball-pin', position: [0, round(-L * 0.5, 4), 0], scale: [round(L * 0.12, 4), round(L * 1.02, 4), round(L * 0.12, 4)], ...metalOf(st) })] },
};
const linkSpec = (L, i, st = STYLES.silver, key = 'cable') => ({ name: 'link', length: L, mass: CHAIN_TYPES[key].mass, parts: CHAIN_TYPES[key].make(L, i, st) });

// ---- rings, clasps and loops: the piece that attaches to your cursor (also available anywhere along the chain). Add another entry and it shows up in the menu.
// make(style, tag) returns the one segment that sits at the top ("top" tag: the builder treats it as the cursor piece).
const ringT = (key, name, len, sc, th, label, group = 'Rings') => ({ label, group, make: (st = STYLES.silver, tag = 'top') => ({ name, length: len, mass: 0.6, parts: [att('torus', { name: `${tag}:${key}`, position: [0, round(-len / 2, 4), 0], scale: sc, thickness: th, ...metalOf(st) })] }) });
export const TOPS = {
  ring: ringT('ring', 'key ring', 0.5, [0.5, 0.5, 0.5], 0.3, 'Key ring'),
  splitring: ringT('splitring', 'split ring', 0.5, [0.5, 0.5, 0.5], 0.09, 'Split ring (thin wire)'),
  oring: ringT('oring', 'thick ring', 0.45, [0.45, 0.45, 0.45], 0.46, 'Thick O-ring'),
  flatring: ringT('flatring', 'flat ring', 0.5, [0.5, 0.5, 0.2], 0.36, 'Flat band ring'),
  smallring: ringT('smallring', 'small ring', 0.34, [0.34, 0.34, 0.34], 0.3, 'Small ring'),
  bigring: ringT('bigring', 'large ring', 0.8, [0.8, 0.8, 0.8], 0.28, 'Large ring'),
  clip: { label: 'Carabiner clip', group: 'Clasps & hooks', make: (st = STYLES.silver, tag = 'top') => ({ name: 'clip', length: 0.62, mass: 0.7, parts: [
    att('torus', { name: `${tag}:clip`, position: [0, -0.31, 0], scale: [0.34, 0.6, 0.34], thickness: 0.22, ...metalOf(st) }),
    att('box', { name: 'clip gate', position: [0.06, -0.2, 0], scale: [0.05, 0.28, 0.05], ...metalOf(st), color: '#aeb2ba' }),
  ] }) },
  lobster: { label: 'Lobster clasp', group: 'Clasps & hooks', make: (st = STYLES.silver, tag = 'top') => ({ name: 'lobster clasp', length: 0.72, mass: 0.7, parts: [
    att('torus', { name: `${tag}:lobster`, position: [0, -0.3, 0], scale: [0.3, 0.6, 0.3], thickness: 0.22, ...metalOf(st) }),
    att('box', { name: 'clip gate', position: [0.15, -0.2, 0], scale: [0.07, 0.17, 0.08], ...metalOf(st), color: '#aeb2ba' }),
    att('torus', { name: `${tag}-eye`, position: [0, -0.64, 0], rotation: [0, 90, 0], scale: [0.17, 0.17, 0.17], thickness: 0.3, ...metalOf(st) }),
  ] }) },
  snap: { label: 'Swivel snap hook', group: 'Clasps & hooks', make: (st = STYLES.silver, tag = 'top') => ({ name: 'swivel hook', length: 0.74, mass: 0.7, parts: [
    att('torus', { name: `${tag}:snap`, position: [0, -0.22, 0], scale: [0.26, 0.46, 0.26], thickness: 0.2, ...metalOf(st) }),
    att('cylinder', { name: 'clip gate', position: [0, -0.5, 0], scale: [0.12, 0.1, 0.12], ...metalOf(st), color: '#aeb2ba' }),
    att('torus', { name: `${tag}-eye`, position: [0, -0.62, 0], rotation: [0, 90, 0], scale: [0.17, 0.17, 0.17], thickness: 0.3, ...metalOf(st) }),
  ] }) },
  loop: { label: 'String loop', group: 'Loops', make: (st, tag = 'top') => ({ name: 'string loop', length: 0.45, mass: 0.4, parts: [att('torus', { name: `${tag}:loop`, position: [0, -0.22, 0], scale: [0.4, 0.45, 0.4], thickness: 0.12, color: CORDS.natural.color, metalness: 0, roughness: 0.9 })] }) },
  ribbon: { label: 'Ribbon loop (flat)', group: 'Loops', make: (st, tag = 'top') => ({ name: 'ribbon loop', length: 0.55, mass: 0.4, parts: [att('torus', { name: `${tag}:ribbon`, position: [0, -0.27, 0], scale: [0.4, 0.55, 0.06], thickness: 0.4, color: CORDS.red.color, metalness: 0, roughness: 0.8 })] }) },
};

// ---- prebuilt charms and key parts (the shapes themselves come from the normal editor's + PART menu; objects come from imported models)
const eyelet = (st = STYLES.silver) => att('torus', { name: 'eyelet', position: [0, -0.04, 0], scale: [0.1, 0.13, 0.1], thickness: 0.35, ...metalOf(st) });
export const ITEMS = {
  fob: { label: 'Fob strap', eyelet: true, make: () => [{ name: 'fob strap', length: 0.5, mass: 0.4, parts: [P('box', 'fob', [0, -0.3, 0], [0.16, 0.44, 0.04], '#1c1c1f', { metalness: 0.2, roughness: 0.9 })] }] },
  tag: { label: 'Name tag', eyelet: true, make: () => [{ name: 'tag', length: 0.7, mass: 1.2, parts: [P('box', 'tag', [0, -0.4, 0], [0.55, 0.5, 0.05], '#c9ccd2', { metalness: 0.9, roughness: 0.3 })] }] },
  gem: { label: 'Gem charm', eyelet: true, make: () => [{ name: 'gem', length: 0.6, mass: 1.2, parts: [P('octahedron', 'gem', [0, -0.34, 0], [0.34, 0.44, 0.34], '#ff5e7a', { metalness: 0.1, roughness: 0.15 })] }] },
  bell: { label: 'Bell', eyelet: true, make: () => [{ name: 'bell', length: 0.55, mass: 1.2, parts: [
    P('sphere', 'bell', [0, -0.3, 0], [0.42, 0.42, 0.42], '#d4a640', GOLD), P('box', 'bell slit', [0, -0.34, 0.2], [0.3, 0.03, 0.06], '#2a2a2e', { metalness: 0, roughness: 0.6 })] }] },
  bead: { label: 'Bead', eyelet: true, make: () => [{ name: 'bead', length: 0.4, mass: 0.8, parts: [P('sphere', 'bead', [0, -0.22, 0], [0.3, 0.3, 0.3], '#6ea8ff', { metalness: 0.1, roughness: 0.25 })] }] },
  pompom: { label: 'Pom-pom', eyelet: true, make: () => [{ name: 'pom-pom', length: 0.6, mass: 0.7, parts: [P('sphere', 'pom-pom', [0, -0.34, 0], [0.55, 0.55, 0.55], '#f08cb4', { metalness: 0, roughness: 1, flatShading: true })] }] },
};
const makePiece = (key) => {
  const def = ITEMS[key]; const specs = def.make();
  if (def.eyelet) specs[0].parts.push(eyelet());
  specs[0].parts[0].name = 'piece:' + specs[0].parts[0].name;      // marks where a piece starts, so the builder lists each piece as its own section
  return specs;
};
// (kept for older callers) a plain shape as an item
const itemSeg = (shape, size = 0.5) => ({ name: shape === 'sphere' ? 'charm' : shape, length: size, mass: 1.2, parts: [att(shape, { name: 'charm', position: [0, round(-size / 2, 4), 0], scale: [round(size * 0.8, 4), round(size * 0.8, 4), round(size * 0.8, 4)], color: '#e8a838', metalness: 0.5, roughness: 0.4 })] });

export function createBuilder(ctx) {
  const { h, btn, getRig, toast, afterEdit, importModel, selectSeg } = ctx;
  const rig = () => getRig();
  const seg = (id) => rig().segments.find((s) => s.id === id);
  const metalOfAtt = (a) => ({ color: a.color, metalness: a.metalness, roughness: a.roughness });
  const kids = (id) => rig().segments.filter((s) => s.parent === id);
  const hasModel = (s) => s.attachments.some((a) => a.kind === 'model');
  const prim = (s) => s.attachments.filter((a) => a.kind !== 'model');
  const isCord = (s) => !hasModel(s) && s.attachments.length >= 1 && s.attachments.every((a) => a.shape === 'cylinder' && a.scale[0] <= 0.09 && a.scale[2] <= 0.09);
  const isLink = (s) => !hasModel(s) && !isCord(s) && s.attachments.length === 1 && ['torus', 'ring'].includes(s.attachments[0].shape) && !s.limit && !s.radius;
  const nameKind = (s) => { const n = s.attachments[0]?.name || ''; return /^link(:|$)/.test(n) ? 'chain' : /^string(:|$)/.test(n) ? 'string' : null; };
  const kindOf = (s) => (hasModel(s) || /^piece:/.test(s.attachments[0]?.name || '') ? 'item' : nameKind(s) || (isCord(s) ? 'string' : isLink(s) ? 'chain' : 'item'));
  const typeOf = (s, pre, table, dflt) => { const m = new RegExp('^' + pre + ':(\\w+?)(?:-|$)').exec(s.attachments[0]?.name || ''); return m && table[m[1]] ? m[1] : dflt; };
  const topKeyOf = (s) => { for (const a of s.attachments) { const m = /^top:(\w+)/.exec(a.name || ''); if (m && TOPS[m[1]]) return m[1]; } return null; };
  const isTopSeg = (s) => !s.parent && !hasModel(s) && !/^(link|string)(:|$)/.test(s.attachments[0]?.name || '') && (!!topKeyOf(s) || s.attachments.some((a) => a.shape === 'torus' && (a.metalness ?? 0) >= 0.5 && Math.max(...a.scale) >= 0.3));

  // ---- read the main line of the rig as sections
  function read() {
    const r = rig(); if (!r || RC.isOrbit(r) || RC.isParticles(r)) return null;
    const idset = new Set(r.segments.map((s) => s.id));
    const root = r.segments.find((s) => !s.parent || !idset.has(s.parent));
    if (!root) return { top: null, sections: [], extra: 0, total: 0, root: null };
    let top = null, cur = root;
    if (isTopSeg(root)) { top = root; cur = kids(root.id)[0] || null; }
    const sections = [], main = new Set(top ? [top.id] : []);
    for (let g = 600; cur && g--;) {
      const kind = kindOf(cur);
      const last = sections[sections.length - 1];
      const sub = (x) => (kind === 'chain' ? typeOf(x, 'link', CHAIN_TYPES, 'cable') : kind === 'string' ? typeOf(x, 'string', CORD_TYPES, 'string') : '');
      if (last && last.kind === kind && sub(cur) === sub(last.segs[0]) && !(kind === 'item' && /^piece:/.test(cur.attachments[0]?.name || ''))) last.segs.push(cur); else sections.push({ kind, segs: [cur] });   // each ready-made piece or imported model is its own section
      main.add(cur.id);
      cur = kids(cur.id)[0] || null;
    }
    const extra = r.segments.filter((s) => !main.has(s.id)).length;
    const total = [...main].reduce((n, id) => n + (seg(id)?.length || 0), 0);
    return { top, sections, extra, total, root };
  }

  // ---- low-level edits
  function makeSeg(spec, parentId) {
    const s = RC.newSegment(parentId, { name: spec.name, length: spec.length, mass: spec.mass, stiffness: spec.stiffness ?? 0 });
    s.attachments = spec.parts.map((p) => ({ ...JSON.parse(JSON.stringify(p)), id: RC.uid('att') }));
    return s;
  }
  const finish = (msg) => { ctx.sortSegs(); afterEdit(); if (msg) toast(msg); };
  function addAfter(lastSeg, specs) {       // new segments hang from lastSeg; whatever hung from lastSeg moves down to the last new one
    const old = kids(lastSeg.id); let pid = lastSeg.id; const made = [];
    for (const sp of specs) { const s = makeSeg(sp, pid); rig().segments.push(s); made.push(s); pid = s.id; }
    old.forEach((k) => { k.parent = pid; });
    return made;
  }
  function removeSegs(list) {      // whatever hung from a removed segment moves up to the nearest segment that stays
    const kill = new Set(list.map((s) => s.id));
    const upper = (s) => { let p = s.parent; for (let g = 600; p && kill.has(p) && g--;) p = seg(p)?.parent ?? null; return p || null; };
    rig().segments.filter((s) => !kill.has(s.id) && s.parent && kill.has(s.parent)).forEach((s) => { s.parent = upper(s); });
    const keep = rig().segments.filter((s) => !kill.has(s.id));
    rig().segments.splice(0, rig().segments.length, ...keep);
  }
  function scaleSeg(s, k) {
    s.length = round(Math.max(0.02, s.length * k), 4);
    s.attachments.forEach((a) => { a.position = a.position.map((v) => round(v * k, 4)); if (a.kind !== 'model') a.scale = a.scale.map((v) => round(v * k, 4)); });
  }

  // ---- top piece
  function applyTop(spec) {
    const R = read();
    if (R.top) {
      const s = R.top; s.name = spec.name; s.length = spec.length; s.mass = spec.mass;
      s.attachments = spec.parts.map((p) => ({ ...JSON.parse(JSON.stringify(p)), id: RC.uid('att') }));
    } else {
      const roots = rig().segments.filter((s) => !s.parent);
      const s = makeSeg(spec, null); rig().segments.push(s);
      roots.forEach((r) => { r.parent = s.id; });
    }
    finish('Top piece changed');
  }
  async function setTop(key) {
    const R = read(); if (!R) return;
    if (key === 'none') { if (R.top) { removeSegs([R.top]); finish('The chain now starts right at your cursor'); } return; }
    if (key === 'custom') {
      const m = await importModel(); if (!m) return;
      const part = RC.newAttachment('box', { kind: 'model', model: m.name, name: 'top:custom', useColor: false, position: [0, -0.3, 0], scale: [0.6, 0.6, 0.6] });
      return applyTop({ name: 'top piece', length: 0.6, mass: 0.7, parts: [part] });
    }
    if (TOPS[key]) applyTop(TOPS[key].make());
  }
  function scaleTop(k) {
    const s = read()?.top; if (!s) return;
    scaleSeg(s, k); s.attachments.forEach((a) => { if (a.kind === 'model') a.scale = a.scale.map((v) => round(v * k, 4)); });
    finish();
  }
  const topParts = (s) => s.attachments.filter((a) => /^top:/.test(a.name || '') || /^top-eye$/.test(a.name || ''));
  const topMain = (s) => s.attachments.find((a) => /^top:/.test(a.name || ''));
  const setTopThick = (v) => { const s = read()?.top; if (!s) return; s.attachments.forEach((a) => { if (/^top:/.test(a.name || '') && a.shape === 'torus') a.thickness = round(v, 3); }); finish(); };
  const setTopSize = (v) => { const m = read()?.top && topMain(read().top); if (m && m.scale[0] > 0) scaleTop(v / m.scale[0]); };
  const RING_KEYS = ['ring', 'splitring', 'oring', 'flatring', 'smallring', 'bigring'];
  const hasDouble = (s) => s.attachments.some((a) => /^top2:/.test(a.name || ''));
  function toggleDouble() {
    const s = read()?.top; if (!s) return; const m = topMain(s); if (!m) return;
    if (hasDouble(s)) s.attachments = s.attachments.filter((a) => !/^top2:/.test(a.name || ''));
    else s.attachments.push({ ...JSON.parse(JSON.stringify(m)), id: RC.uid('att'), name: 'top2:' + m.name.slice(4), rotation: [0, 90, 0], scale: m.scale.map((v) => round(v * 0.9, 4)) });
    finish();
  }
  function styleTop(st) { const s = read()?.top; if (!s) return; prim(s).forEach((a) => { if (a.name === 'clip gate' || a.name === 'string loop') return; a.color = st.color; a.metalness = st.metalness; a.roughness = st.roughness; }); finish(); }

  // ---- sections
  // the closest two chain links may sit: about half the link's own length, so links can never pile up
  const minPitch = (atts) => { const a = (atts || []).find((x) => x.kind !== 'model' && x.scale); return a ? round(0.5 * Math.max(...a.scale), 4) : 0; };
  function setCount(sec, n) {
    n = Math.max(1, Math.min(200, Math.round(n) || 1));
    if (n > sec.segs.length) {
      const last = sec.segs[sec.segs.length - 1]; let turn = last.attachments[0]?.rotation?.[1] || 0; const specs = [];
      // copy a full-size link, not the last one: the last link is often shortened on purpose to meet the part below, and copying it packs the new links on top of each other
      const full = sec.kind === 'chain' ? sec.segs.reduce((a, s) => (s.length > a.length ? s : a), last) : last;
      for (let i = sec.segs.length; i < n; i++) {
        const c = JSON.parse(JSON.stringify(full)); turn = turn ? 0 : 90;      // each link sits turned 90 degrees from the one above it
        if (sec.kind === 'chain' && c.attachments[0]) c.attachments[0].rotation = [c.attachments[0].rotation[0], turn, c.attachments[0].rotation[2]];
        specs.push({ name: c.name, length: sec.kind === 'chain' ? Math.max(c.length, minPitch(c.attachments)) : c.length, mass: c.mass, stiffness: last.stiffness, parts: c.attachments });
      }
      addAfter(last, specs);
    } else if (n < sec.segs.length) removeSegs(sec.segs.slice(n));
    finish();
  }
  function setLinkSize(sec, len) { const f = sec.segs[0]; if (!f || !(len > 0)) return; const k = len / f.length; sec.segs.forEach((s) => scaleSeg(s, k)); finish(); }
  function scaleSection(sec, k) { sec.segs.forEach((s) => scaleSeg(s, k)); finish(); }
  function setStyle(sec, st) { sec.segs.forEach((s) => prim(s).forEach((a) => { a.color = st.color; a.metalness = st.metalness; a.roughness = st.roughness; })); finish(); }
  function setCord(sec, key) { sec.segs.forEach((s) => prim(s).forEach((a) => { if (!/beads-bead/.test(a.name)) a.color = CORDS[key].color; })); finish(); }
  const cordLength = (sec) => round(sec.segs.reduce((n, s) => n + s.length, 0), 3);
  const cordInfo = (sec) => { const f = sec.segs[0], m = prim(f)[0]; return { key: typeOf(f, 'string', CORD_TYPES, 'string'), L: cordLength(sec), color: m?.color || CORDS.natural.color, thick: m?.scale[0] ?? 0.035, bead: sec.segs.length && prim(f)[1] && /beads-bead/.test(prim(f)[1].name) ? (sec.bead || 'rainbow') : 'rainbow' }; };
  // rebuilds a string from its type, length, colour and thickness (a string is a short run of equal pieces so it bends smoothly; how many follows the length)
  function cordRebuild(sec, patch = {}) {
    const o = { ...cordInfo(sec), ...patch }; const T = CORD_TYPES[o.key];
    const L = Math.max(0.1, Math.min(40, o.L)), n = Math.max(1, Math.round(L / 0.3));
    let segs = sec.segs.slice();
    if (n > segs.length) { const last = segs[segs.length - 1]; segs = segs.concat(addAfter(last, Array.from({ length: n - segs.length }, () => ({ name: 'string', length: 0.3, mass: T.mass, parts: [] })))); }
    else if (n < segs.length) { removeSegs(segs.slice(n)); segs = segs.slice(0, n); }
    const len = round(L / segs.length, 4);
    segs.forEach((s, i) => { s.name = 'string'; s.length = len; s.mass = T.mass; s.stiffness = T.stiff; s.attachments = T.make(len, { color: o.color, thick: o.thick, bead: o.bead, metal: !!T.metal }, i).map((p) => ({ ...p, id: RC.uid('att') })); });
    finish();
  }
  const setCordLength = (sec, L) => cordRebuild(sec, { L });
  const setCordThick = (sec, t) => cordRebuild(sec, { thick: t });
  const setCordType = (sec, key) => { const T = CORD_TYPES[key]; cordRebuild(sec, { key, thick: T.thick, color: T.color || cordInfo(sec).color }); };
  const chainStyleOf = (sec) => { const a = prim(sec.segs[0])[0]; return a ? { color: a.color, metalness: a.metalness, roughness: a.roughness } : STYLES.silver; };
  function setChainType(sec, key) { const st = chainStyleOf(sec), T = CHAIN_TYPES[key]; sec.segs.forEach((s, i) => { s.mass = T.mass; s.attachments = T.make(s.length, i, st).map((p) => ({ ...p, id: RC.uid('att') })); }); finish(); }
  const hasEyelet = (sec) => sec.segs[0].attachments.some((a) => a.name === 'eyelet');
  function toggleEyelet(sec) { const f = sec.segs[0]; if (hasEyelet(sec)) f.attachments = f.attachments.filter((a) => a.name !== 'eyelet'); else f.attachments.push(eyelet()); finish(); }
  function itemSize(sec, k) { sec.segs.forEach((s) => s.attachments.forEach((a) => { a.scale = a.scale.map((v) => round(v * k, 4)); a.position = a.position.map((v) => round(v * k, 4)); })); finish(); }
  function deleteSection(sec) {
    const R = read(); const idx = R.sections.findIndex((x) => x.segs[0].id === sec.segs[0].id);
    let list = sec.segs.slice();
    if (sec.kind === 'item') {      // an item may carry limbs or extra parts that hang from it off the main line: they go with it
      const later = new Set(R.sections.slice(idx + 1).flatMap((x) => x.segs.map((s) => s.id)));
      const extra = sec.segs.flatMap((s) => RC.descendants(rig(), s.id)).filter((d) => !later.has(d.id) && !list.includes(d));
      list = list.concat(extra);
    }
    removeSegs(list); finish('Removed');
  }
  function move(sec, dir) {          // swap this section with the one above (-1) or below (+1), keeping everything else joined
    const R = read(); const i = R.sections.findIndex((x) => x.segs[0].id === sec.segs[0].id), j = i + dir; if (i < 0 || j < 0 || j >= R.sections.length) return;
    const S = dir > 0 ? R.sections[i] : R.sections[j], T = dir > 0 ? R.sections[j] : R.sections[i];   // "S then T" becomes "T then S"
    const A = S.segs[0].parent || null, Sf = S.segs[0], Sl = S.segs[S.segs.length - 1], Tf = T.segs[0], Tl = T.segs[T.segs.length - 1];
    const below = kids(Tl.id), sideBranches = kids(Sl.id).filter((k) => k.id !== Tf.id);
    Tf.parent = A; Sf.parent = Tl.id;
    below.forEach((b) => { b.parent = Sl.id; });
    sideBranches.forEach((b) => { b.parent = Sl.id; });
    finish();
  }
  // what: 'chain' | 'string' | 'model' | 'top:<ring key>' (a ring or clasp placed along the chain) | 'item:<prebuilt piece key>'
  async function addSection(kind, afterSec, what) {
    const R = read();
    const lastSeg = afterSec ? afterSec.segs[afterSec.segs.length - 1] : (R.sections.length ? R.sections[R.sections.length - 1].segs.slice(-1)[0] : (R.top || R.root));
    let specs;
    const ref = (R.sections.find((s) => s.kind === 'chain') || {}).segs?.[0];
    if (kind === 'chain') { const L = ref ? ref.length : 0.16; const ck = ref ? typeOf(ref, 'link', CHAIN_TYPES, 'cable') : 'cable'; const st = ref && prim(ref)[0] ? metalOfAtt(prim(ref)[0]) : STYLES.silver; specs = [0, 1, 2, 3].map((i) => linkSpec(L, i, st, ck)); }
    else if (kind === 'string') specs = [0, 1, 2].map(() => cordSpec(0.3));
    else if (kind === 'model') {
      const m = await importModel(); if (!m) return;
      const part = RC.newAttachment('box', { kind: 'model', model: m.name, name: 'piece:' + m.original.replace(/\.[^.]+$/, ''), useColor: false, position: [0, -0.4, 0], scale: [0.8, 0.8, 0.8] });
      specs = [{ name: part.name.slice(6), length: 0.8, mass: 1.5, parts: [part] }];
    } else if (kind === 'top' && TOPS[what]) specs = [TOPS[what].make(STYLES.silver, 'piece')];
    else if (kind === 'item' && ITEMS[what]) specs = makePiece(what);
    else return;
    if (!lastSeg) { let pid = null; for (const sp of specs) { const s = makeSeg(sp, pid); rig().segments.push(s); pid = s.id; } }
    else addAfter(lastSeg, specs);
    finish(kind === 'chain' ? 'Chain added' : kind === 'string' ? 'String added' : 'Piece added');
  }
  async function replaceModel(sec) {
    const m = await importModel(); if (!m) return;
    const a = sec.segs.flatMap((s) => s.attachments).find((x) => x.kind === 'model'); if (!a) return;
    a.model = m.name; a.name = (/^piece:/.test(a.name) ? 'piece:' : '') + m.original.replace(/\.[^.]+$/, ''); finish('Model replaced');
  }

  // ---- presets: a whole starting point in one click
  function preset(key) {
    const st = STYLES.silver, parts = [], links = (n, L = 0.16, k = 'cable') => Array.from({ length: n }, (_, i) => linkSpec(L, i, st, k)), cords = (n, k = 'string') => Array.from({ length: n }, () => cordSpec(0.3, k));
    if (key === 'keychain') parts.push(TOPS.ring.make(st), ...links(5), ...makePiece('tag'));
    else if (key === 'charm') parts.push(TOPS.loop.make(), ...cords(3), ...makePiece('bell'));
    else if (key === 'clip') parts.push(TOPS.clip.make(st), ...cords(5, 'cord'), ...makePiece('fob'));
    else if (key === 'chainonly') parts.push(...links(8, 0.2));
    const r = rig(); r.segments.splice(0, r.segments.length);
    let pid = null; for (const sp of parts) { const s = makeSeg(sp, pid); r.segments.push(s); pid = s.id; }
    finish('Started from a preset. Change anything below.');
  }

  // ---- UI
  const num = (value, onset, { min = 0, max = 999, step = 0.05, w = 64 } = {}) => {
    const i = h('input', { type: 'number', value: String(value), min, max, step, class: 'bd-num', style: `width:${w}px` });
    i.addEventListener('keydown', (e) => e.stopPropagation());
    i.addEventListener('change', () => { const v = parseFloat(i.value); if (Number.isFinite(v)) onset(Math.max(min, Math.min(max, v))); });
    return i;
  };
  const choose = (opts, value, onset) => {
    const s = h('select', { class: 'bd-sel' }, ...opts.map(([k, l]) => h('option', { value: k, ...(k === value ? { selected: true } : {}) }, l)));
    s.addEventListener('change', () => onset(s.value)); return s;
  };
  // a drop-down with headings: groups = [[heading | null, [[value, label], ...]], ...]
  const chooseG = (groups, value, onset) => {
    const opt = ([k, l]) => h('option', { value: k, ...(k === value ? { selected: true } : {}) }, l);
    const s = h('select', { class: 'bd-sel' }, ...groups.map(([g, list]) => (g ? h('optgroup', { label: g }, ...list.map(opt)) : list.map(opt))));
    s.addEventListener('change', () => onset(s.value)); return s;
  };
  const slider = (value, onset, { min, max, step }) => {
    const r = h('input', { type: 'range', min, max, step, value: String(Math.max(min, Math.min(max, value))), class: 'bd-range' });
    r.addEventListener('change', () => onset(parseFloat(r.value))); return r;
  };
  const row = (label, ...ctl) => h('div', { class: 'bd-row' }, h('span', { class: 'bd-lab' }, label), h('span', { class: 'bd-ctl' }, ...ctl));
  const check = (label, on, onset) => { const c = h('input', { type: 'checkbox', ...(on ? { checked: true } : {}) }); c.addEventListener('change', () => onset(c.checked)); return h('label', { class: 'bd-check' }, c, ' ' + label); };
  const icon = { chain: '⛓', string: '〰', item: '◆', top: '◯' };
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const styleKey = (s) => { const a = prim(s)[0]; return a ? (Object.entries(STYLES).find(([, v]) => same(v.color, a.color))?.[0] || '') : ''; };
  const cordKey = (s) => { const a = prim(s)[0]; return a ? (Object.entries(CORDS).find(([, v]) => same(v.color, a.color))?.[0] || '') : ''; };
  const byGroup = (table) => { const g = {}; for (const [k, v] of Object.entries(table)) (g[v.group || 'Other'] ||= []).push([k, v.label]); return g; };
  // "Add a piece": an imported model first (the main way to get your own objects in), then the prebuilt rings / clasps / charms
  const pieceMenu = (onpick) => {
    const tg = byGroup(TOPS), ig = { 'Charms & key parts': Object.entries(ITEMS).map(([k, v]) => [k, v.label]) };
    return chooseG([[null, [['', '+ Add a piece…'], ['model', 'Import a model…']]],
      ...Object.entries(tg).map(([g, list]) => ['Rings & clasps: ' + g, list.map(([k, l]) => ['top:' + k, l])]),
      ...Object.entries(ig).map(([g, list]) => [g, list.map(([k, l]) => ['item:' + k, l])])], '', (v) => { if (!v) return; if (v === 'model') onpick('model'); else { const [kk, w] = v.split(':'); onpick(kk, w); } });
  };

  function card(sec, i, R) {
    const first = sec.segs[0];
    const mname = sec.segs.flatMap((s) => s.attachments).find((a) => a.kind === 'model')?.name;
    const ck = typeOf(first, 'link', CHAIN_TYPES, 'cable'), sk = typeOf(first, 'string', CORD_TYPES, 'string');
    const title = sec.kind === 'chain' ? `${CHAIN_TYPES[ck].label.split(' (')[0]} · ${sec.segs.length} link${sec.segs.length === 1 ? '' : 's'}` : sec.kind === 'string' ? `${CORD_TYPES[sk].label.split(' (')[0]} · ${cordLength(sec)}u` : 'Piece: ' + String(mname || first.name).replace(/^piece:/, '') + (sec.segs.length > 1 ? ` (+${sec.segs.length - 1} parts)` : '');
    const head = h('div', { class: 'bd-head' }, h('span', { class: 'bd-ico' }, icon[sec.kind]), h('b', { class: 'bd-title', title: 'Click to select it in the viewport', onclick: () => selectSeg(first.id) }, title), h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost mini', title: 'Move this section up', ...(i === 0 ? { disabled: true } : {}), onclick: () => move(sec, -1) }, '↑'),
      h('button', { class: 'btn ghost mini', title: 'Move this section down', ...(i === R.sections.length - 1 ? { disabled: true } : {}), onclick: () => move(sec, 1) }, '↓'),
      h('button', { class: 'btn ghost mini danger', title: 'Remove this section', onclick: () => deleteSection(sec) }, '✕'));
    const body = h('div', { class: 'bd-body' });
    if (sec.kind === 'chain') {
      body.append(
        row('Type', choose(Object.entries(CHAIN_TYPES).map(([k, v]) => [k, v.label]), ck, (k) => setChainType(sec, k))),
        row('Links', h('button', { class: 'btn bd-pm', title: 'Remove the last link', ...(sec.segs.length <= 1 ? { disabled: true } : {}), onclick: () => setCount(sec, sec.segs.length - 1) }, '−'), num(sec.segs.length, (v) => setCount(sec, v), { min: 1, max: 200, step: 1, w: 52 }), h('button', { class: 'btn bd-pm', title: 'Add a link to the end', onclick: () => setCount(sec, sec.segs.length + 1) }, '+'), btn('+5', () => setCount(sec, sec.segs.length + 5))),
        row('Link size', num(round(first.length, 3), (v) => setLinkSize(sec, v), { min: 0.03, max: 3, step: 0.02 }), btn('Smaller', () => scaleSection(sec, 0.85)), btn('Bigger', () => scaleSection(sec, 1.18))),
        row('Style', choose([['', 'Custom'], ...Object.entries(STYLES).map(([k, v]) => [k, v.label])], styleKey(first), (k) => k && setStyle(sec, STYLES[k]))));
    } else if (sec.kind === 'string') {
      const info = cordInfo(sec), T = CORD_TYPES[info.key];
      body.append(row('Type', choose(Object.entries(CORD_TYPES).map(([k, v]) => [k, v.label]), info.key, (k) => setCordType(sec, k))),
        row('Length', num(info.L, (v) => setCordLength(sec, v), { min: 0.1, max: 40, step: 0.1 }), slider(Math.min(6, info.L), (v) => setCordLength(sec, v), { min: 0.1, max: 6, step: 0.05 })),
        row(info.key === 'ribbon' ? 'Width' : 'Thickness', num(round(info.thick, 3), (v) => setCordThick(sec, v), { min: 0.008, max: info.key === 'ribbon' ? 0.6 : 0.2, step: 0.005 })),
        row('Colour', choose([['', 'Custom'], ...Object.entries(CORDS).map(([k, v]) => [k, v.label])], cordKey(first), (k) => k && setCord(sec, k))));
    } else {
      body.append(row('Size', btn('Smaller', () => itemSize(sec, 0.85)), btn('Bigger', () => itemSize(sec, 1.18))),
        row('Loop', check('Hanging loop on top', hasEyelet(sec), () => toggleEyelet(sec))),
        h('div', { class: 'ibtns' }, mname ? btn('Replace model…', () => replaceModel(sec)) : null, btn('Select parts', () => selectSeg(first.id))));
    }
    body.append(h('div', { class: 'bd-addrow' }, h('span', {}, 'Add below:'), ...(sec.kind === 'chain' ? [] : [btn('+ Chain', () => addSection('chain', sec))]), ...(sec.kind === 'string' ? [] : [btn('+ String', () => addSection('string', sec))]), pieceMenu((k, w) => addSection(k, sec, w))));
    return h('div', { class: 'bd-card bd-' + sec.kind }, head, body);
  }

  function render(box) {
    box.innerHTML = '';
    const R = read();
    const body = h('div', { class: 'cp-body' }); box.append(body);
    if (!R) { body.append(h('p', { class: 'note', style: 'display:block' }, 'The builder is for cursorchains. Cursorbits and cursor emitters use the normal editor.')); return; }

    const topKey = R.top ? (topKeyOf(R.top) || (hasModel(R.top) ? 'custom' : 'ring')) : 'none';
    const tb = h('div', { class: 'bd-body' });
    const tgroups = Object.entries(byGroup(TOPS)).map(([g, list]) => [g, list]);
    tb.append(row('Piece', chooseG([...tgroups, ['More', [['custom', 'Your own model…'], ['none', 'Nothing: the chain starts at the cursor']]]], topKey, (k) => setTop(k))));
    if (R.top) {
      const m = topMain(R.top), torus = R.top.attachments.some((a) => /^top:/.test(a.name || '') && a.shape === 'torus');
      tb.append(row('Size', num(round(m ? m.scale[0] : R.top.length, 3), setTopSize, { min: 0.1, max: 4, step: 0.02 }), btn('Smaller', () => scaleTop(0.85)), btn('Bigger', () => scaleTop(1.18))));
      if (torus) tb.append(row('Thickness', slider(m?.thickness ?? 0.3, setTopThick, { min: 0.04, max: 0.48, step: 0.01 })));
      if (!hasModel(R.top)) tb.append(row('Style', choose([['', 'Custom'], ...Object.entries(STYLES).map(([k, v]) => [k, v.label])], (() => { const a = prim(R.top)[0]; return a ? (Object.entries(STYLES).find(([, v]) => same(v.color, a.color))?.[0] || '') : ''; })(), (k) => k && styleTop(STYLES[k]))));
      if (RING_KEYS.includes(topKey)) tb.append(row('Double', check('Second ring through it (split-ring look)', hasDouble(R.top), toggleDouble)));
    }
    body.append(h('div', { class: 'bd-card bd-top' }, h('div', { class: 'bd-head' }, h('span', { class: 'bd-ico' }, icon.top), h('b', { class: 'bd-title', title: 'Click to select it in the viewport', onclick: () => R.top && selectSeg(R.top.id) }, 'Attached to your cursor with')), tb));

    if (!R.sections.length) body.append(h('p', { class: 'note', style: 'display:block' }, 'Nothing hangs from it yet. Add a chain, a string or a piece below, or start from a preset.'));
    R.sections.forEach((s, i) => body.append(card(s, i, R)));

    body.append(h('div', { class: 'bd-card' }, h('div', { class: 'bd-head' }, h('b', {}, 'Add to the bottom'), h('span', { class: 'bd-meta' }, 'models you import, or ready-made pieces')),
      h('div', { class: 'ibtns' }, btn('+ Chain', () => addSection('chain')), btn('+ String', () => addSection('string')), pieceMenu((k, w) => addSection(k, null, w)))));
    body.append(h('div', { class: 'bd-card' }, h('div', { class: 'bd-head' }, h('b', {}, 'Start from a preset'), h('span', { class: 'bd-meta' }, 'replaces what is here')),
      h('div', { class: 'ibtns' }, btn('Keychain', () => preset('keychain')), btn('Charm on string', () => preset('charm')), btn('Clip + cord', () => preset('clip')), btn('Chain only', () => preset('chainonly')))));
    body.append(h('p', { class: 'note', style: 'display:block' }, `Total length ${round(R.total, 2)}u` + (R.extra ? ` · ${R.extra} more part${R.extra === 1 ? '' : 's'} hang off this line (branches, limbs): use the Hierarchy for those.` : '') + ' Your own objects come from imported models; plain shapes (box, cylinder, star…) are in the normal editor under + PART. Everything here is ordinary segments and parts, so every technical tool still works on it, and Ctrl+Z undoes any change.'));
  }
  return { render, read, setTop, setCount, setCordLength, setLinkSize, addSection, deleteSection, move, preset, setStyle, scaleTop, itemSize, setChainType, setCordType, setCord, setCordThick, setTopThick, toggleDouble, toggleEyelet };
}
