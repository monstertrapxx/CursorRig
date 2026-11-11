// The menu. Three pages in one window: home (a sideways strip of chains), profile (one chain's name and
// settings) and settings (things for the whole app).
import { makeThumb } from './thumbs.js';
import { topRing } from '../shared/ring.js';
import * as FO from '../shared/folders.js';
import { pickIconImage } from '../shared/foldericon.js';
import { IMPACT_STYLES } from '../shared/impact-styles.js';
import { ask } from '../shared/dialog.js';
import { pickPng, pngOrbitRig, pngEmitterRig, templateRig } from '../shared/custompng.js';
const api = window.rigApi;
const $ = (s) => document.querySelector(s);
const IS_MAC = navigator.platform.startsWith('Mac');

const FEEL_KEYS = ['scale', 'gravity', 'damping', 'opacity', 'windStrength', 'wind', 'floor', 'walls', 'orbitTilt', 'orbitRoll', 'orbitSpeed', 'orbitSize', 'orbitDir', 'orbitReal', 'impactOn', 'impactStyle', 'impactAmount', 'ringSize', 'ceiling', 'spin', 'spinAllow', 'anatomy', 'linkSize'];
const HEIGHT = { home: 372, profile: 594, settings: 392, hang: 372, about: 430 };   // window height (px) for each page
const fmt = {
  x: (v) => v.toFixed(2) + '×', int: (v) => String(Math.round(v)), f2: (v) => v.toFixed(2), f3: (v) => v.toFixed(3), pct: (v) => Math.round(v * 100) + '%', deg: (v) => Math.round(v) + '°/s',
};
const prettyKey = (acc) => (acc || '—').replace('CommandOrControl', IS_MAC ? '⌘' : 'Ctrl').replace('Alt', IS_MAC ? '⌥' : 'Alt').replace('Shift', IS_MAC ? '⇧' : 'Shift').replace(/\+/g, ' + ');

let settings = {};        // as the overlay sees them (global values + the equipped chain's own)
let globals = {};         // the raw global defaults
let rigs = [];
let selected = null;      // chain highlighted on the home strip
let view = 'home';
let profile = null;       // { id, rig, vals }
let query = '';
let cwd = null;           // the folder you are looking inside (null = the main menu itself)

const card = $('.card');
const strip = $('#strip');
import { createDrawer } from './drawer.js';
const drawer = createDrawer({ host: $('.view.home'), scroller: strip, api: { ...window.rigApi, loadRig: (id) => (String(id).startsWith('__tpl_') ? Promise.resolve(templateRig(id)) : window.rigApi.loadRig(id)) } });   // the "?" template icons are drawn from generated rigs

function set(patch) { Object.assign(settings, patch); Object.assign(globals, patch); api.setSettings(patch); }
const rigById = (id) => rigs.find((r) => r.id === id);
const favs = () => new Set(settings.favoriteRigs || []);

function setView(v) {
  view = v;
  card.dataset.view = v;
  api.setPanelHeight(v === 'profile' && profile?.rig?.type === 'orbit' ? 600 : HEIGHT[v]);
  if (v !== 'home') drawer.stop();
  if (v === 'home') { renderStrip(); requestAnimationFrame(() => strip.querySelector('.tile.sel, .item.sel, .slot.sel')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })); }
}

// ------------------------------------------------------------ chain icons
const thumbs = new Map();   // id -> { sig, url }
const pending = new Set();
let repaintTimer = null;
const sigOf = (r) => { const s = JSON.stringify({ ...r, feel: undefined }); let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + x; };

const libMode = () => (settings.libraryView === 'list' ? 'list' : settings.libraryView === 'drawer' || settings.libraryView === 'strip' ? 'drawer' : settings.lowPower ? 'list' : 'drawer');   // the picture-strip view is only the fallback when 3D can't start
const typeFilter = () => (['chain', 'orbit', 'particles'].includes(settings.libraryType) ? settings.libraryType : 'all');   // the three areas: Cursorchains, Cursorbits, Cursor Emitters
let drawerFailed = false;

async function ensureThumb(id, force = false) {
  if (!force && libMode() === 'list') return;   // the plain list never draws pictures (no 3D needed, good for older PCs)
  if (pending.has(id)) return;
  pending.add(id);
  try {
    const rig = String(id).startsWith('__tpl_') ? templateRig(id) : await api.loadRig(id);
    if (!rig) return;
    const sig = sigOf(rig);
    if (thumbs.get(id)?.sig === sig) return;
    thumbs.set(id, { sig, url: await makeThumb(rig) });
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(() => { renderStrip(); if (view === 'profile') paintProfileThumb(); }, 60);
  } finally { pending.delete(id); }
}

// ------------------------------------------------------------ home
const folders = () => settings.folders || [];
const setFolders = (f) => set({ folders: f });
function listed() {
  const f = favs(), q = query.trim().toLowerCase(), t = typeFilter();
  let list;
  if (q) list = rigs.filter((r) => r.name.toLowerCase().includes(q));          // searching looks everywhere
  else {
    list = rigs.filter((r) => t === 'all' || FO.rigType(r) === t);
    if (cwd) { const ids = new Set(FO.rigsIn(folders(), cwd)); list = list.filter((r) => ids.has(r.id)); }
    else list = list.filter((r) => !FO.folderOf(folders(), r.id));            // the area itself: chains that are in no folder
  }
  return list.sort((a, b) => (f.has(b.id) - f.has(a.id)) || a.name.localeCompare(b.name));
}
const shownFolders = () => (query.trim() ? [] : FO.childrenOf(folders(), cwd, typeFilter() === 'all' ? null : typeFilter()));
const rigExists = (id) => !!rigById(id);

// ---- dragging chains in the library: drop on a folder / crumb / Back to move them; hover over Back or a folder to go there
let dragging = null;
const okFor = (ids, folderId) => ids.filter((id) => rigExists(id) && FO.fits(folders(), folderId, rigById(id)));
function acceptDrop(el, getTarget, hover) {
  const clear = () => { el.classList.remove('drop'); if (el._ht) { clearTimeout(el._ht); el._ht = null; } };
  el.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop');
    if (hover && !el._ht) el._ht = setTimeout(() => { el._ht = null; hover(); }, 600);
  });
  el.addEventListener('dragleave', clear);
  el.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); clear();
    const tgt = getTarget(), want = (dragging || []).filter(rigExists); dragging = null;
    let fl = folders(), ids = want.filter((id) => FO.fits(fl, tgt, rigById(id)));
    if (tgt && ids.length < want.length) {      // wrong kind for this folder: offer to share the folder on all 3 tabs instead of refusing
      const root = FO.pathOf(fl, tgt)[0] || FO.getFolder(fl, tgt);
      const c = await ask('“' + root.name + '” only shows on one tab. Show it on all 3 tabs (Cursorchains, Cursorbits and Cursor Emitters) so these can go in it? Each tab will only list its own kind.', { buttons: [['No', 'cancel'], ['Show on all 3 tabs', 'ok']] });
      if (c.key === 'ok') { fl = FO.setFolderType(fl, root.id, 'all'); ids = want; }
    }
    if (!ids.length) return;
    await setFolders(FO.moveRigs(fl, ids, tgt)); renderStrip();
  });
}

function paintCrumbs() {
  const box = $('#crumbs'); box.textContent = '';
  const t = typeFilter(), path = FO.pathOf(folders(), cwd);
  if (cwd && !query.trim()) {                      // where you are, inside the area: Cursorchains › Cursor Rig OG Pack
    const par = FO.getFolder(folders(), cwd)?.parent || null;
    const bk = document.createElement('button'); bk.className = 'crumb back'; bk.textContent = '‹ Back'; bk.title = 'Go back one folder. Drag a chain here and hold it to go back while you carry it.';
    bk.onclick = () => openFolder(par); acceptDrop(bk, () => par, () => openFolder(par)); box.append(bk);
    const b0 = document.createElement('button'); b0.className = 'crumb'; b0.textContent = t === 'all' ? 'All' : FO.areaName(t); b0.title = 'Back to the top of this area'; b0.onclick = () => openFolder(null); acceptDrop(b0, () => null, () => openFolder(null)); box.append(b0);
    path.forEach((f, i) => { const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '›'; box.append(sep);
      const b = document.createElement('button'); b.className = 'crumb' + (i === path.length - 1 ? ' here' : ''); b.textContent = f.name; b.onclick = () => openFolder(f.id); acceptDrop(b, () => f.id, null); box.append(b); });
  }
  $('#type-filter').hidden = !!cwd && !query.trim();      // inside a folder the path takes the tabs' place
  $('#f-rename').hidden = !cwd || !!query.trim();
  $('#f-new').hidden = !!query.trim() || t === 'all';
}
function openFolder(id) { cwd = id; query = ''; $('#search').value = ''; renderStrip(); strip.scrollLeft = 0; }
async function newFolder() {
  let type = cwd ? FO.typeOfFolder(folders(), cwd) : typeFilter();
  if (!type || (type === 'all' && !cwd)) {
    const c = await ask('Which kind of cursorchain is the new folder for?', { choices: FO.AREAS.map(([k, label]) => ({ label, key: k })), buttons: [['Cancel', 'cancel']] });
    if (c.key === 'cancel') return; type = c.key;
  }
  const r = await ask(cwd ? 'Name for the new folder inside ' + FO.getFolder(folders(), cwd)?.name : 'Name for the new folder in ' + FO.areaName(type), { value: 'New folder', buttons: [['Cancel', 'cancel'], ['Create', 'ok']] });
  if (r.key !== 'ok' || !r.text) return;
  const out = FO.addFolder(folders(), r.text, cwd, type); await setFolders(out.folders); renderStrip();
}
async function itemMenu(id) {
  const r = await ask('“' + (rigById(id)?.name || 'chain') + '”', { buttons: [['Cancel', 'cancel'], ['New folder', 'new'], ['Move to…', 'move']] });
  if (r.key === 'new') newFolder(); else if (r.key === 'move') { selected = id; moveSelected(); }
}
strip.addEventListener('contextmenu', (e) => { if (query.trim()) return; e.preventDefault(); ask(cwd ? 'In “' + (FO.getFolder(folders(), cwd)?.name || 'folder') + '”' : 'Library', { buttons: [['Cancel', 'cancel'], ['New folder', 'new']] }).then((r) => { if (r.key === 'new') newFolder(); }); });
acceptDrop(strip, () => cwd, null);
async function renameFolder(id) {
  const f = FO.getFolder(folders(), id); if (!f) return;
  const r = await ask('Rename folder', { value: f.name, buttons: [['Cancel', 'cancel'], ['Rename', 'ok']] });
  if (r.key !== 'ok' || !r.text) return;
  await setFolders(FO.renameFolder(folders(), id, r.text)); renderStrip();
}
async function folderMenu(id) {
  const f = FO.getFolder(folders(), id); if (!f) return;
  const empty = FO.countIn(folders(), id, rigExists) === 0 && FO.childrenOf(folders(), id, null).length === 0;
  const shared = f.type === 'all';
  const r = await ask(empty ? `Folder “${f.name}” (empty)` : `Folder “${f.name}”`, { buttons: [['Cancel', 'cancel'], ['Rename', 'rename'], ['Move…', 'move'], ['Set icon image…', 'icon'], ['Save as .crig…', 'crig'], shared ? ['Only show on one tab…', 'unshare'] : ['Show on all 3 tabs', 'share'], ...(f.icon ? [['Remove icon', 'noicon']] : []), ...(empty ? [['Delete empty folder', 'delete']] : [['Delete folder and everything in it…', 'nuke']])] });
  if (r.key === 'icon') { const img = await pickIconImage(); if (img) { await setFolders(FO.setFolderIcon(folders(), id, img)); renderStrip(); } return; }
  if (r.key === 'crig') { api.exportFolder(id); return; }
  if (r.key === 'noicon') { await setFolders(FO.setFolderIcon(folders(), id, null)); renderStrip(); return; }
  if (r.key === 'share') {
    const par = f.parent && FO.getFolder(folders(), f.parent);
    if (par && par.type !== 'all') { await ask('Move “' + f.name + '” out to the top level first: a folder can only be shared on all 3 tabs from the top.', { buttons: [['OK', 'ok']] }); return; }
    await setFolders(FO.setFolderType(folders(), id, 'all')); renderStrip(); return;
  }
  if (r.key === 'unshare') {
    const c = await ask('Which tab should “' + f.name + '” stay on? Anything of the other two kinds inside it goes back to the main menu of its own tab.', { choices: FO.AREAS.map(([k, label]) => ({ label, key: k })), buttons: [['Cancel', 'cancel']] });
    if (c.key === 'cancel') return;
    await setFolders(FO.setFolderType(folders(), id, c.key, rigById)); renderStrip(); return;
  }
  if (r.key === 'nuke') {
    const all = FO.everythingIn(folders(), id), ids = all.rigIds.filter(rigExists), nf = all.folderIds.length - 1;
    const r3 = await ask(`Delete “${f.name}”${nf ? ' and its ' + nf + ' sub-folder' + (nf === 1 ? '' : 's') : ''}, and permanently delete the ${ids.length} chain${ids.length === 1 ? '' : 's'} inside${shared ? ' (all kinds)' : ''}? This cannot be undone.`, { buttons: [['Cancel', 'cancel'], ['Delete everything', 'ok']] });
    if (r3.key !== 'ok') return;
    for (const rid of ids) { thumbs.delete(rid); await api.deleteRig(rid); }
    if (all.folderIds.includes(cwd)) cwd = f.parent || null;
    if (selected && ids.includes(selected)) selected = null;
    await setFolders(FO.removeFolders(folders(), all.folderIds)); renderStrip(); return;
  }
  if (r.key === 'rename') renameFolder(id);
  else if (r.key === 'move') {
    const bad = new Set(FO.descendantIds(folders(), id));
    const c = await pickFolder('Move “' + f.name + '” into…', (x) => !bad.has(x), f.parent, f.type || 'chain');
    if (c !== undefined) { await setFolders(FO.moveFolder(folders(), id, c)); renderStrip(); }
  } else if (r.key === 'delete') {
    const r2 = await ask(`Delete the empty folder “${f.name}”?`, { buttons: [['Cancel', 'cancel'], ['Delete folder', 'ok']] });
    if (r2.key === 'ok') { if (cwd === id) cwd = f.parent || null; await setFolders(FO.deleteFolder(folders(), id)); renderStrip(); }
  }
}
// choose a folder from the list; resolves null for "no folder", undefined if cancelled
async function pickFolder(title, allow = () => true, current = null, type = null) {
  const choices = [{ label: type ? FO.areaName(type) + ' (Home)' : 'Home', key: '__root', depth: 0, on: !current }, ...FO.flatTree(folders(), null, 0, type).filter((t) => allow(t.folder.id)).map((t) => ({ label: t.folder.name, key: t.folder.id, depth: t.depth + 1, on: t.folder.id === current }))];
  const r = await ask(title, { choices, buttons: [['Cancel', 'cancel']] });
  if (r.key === 'cancel') return undefined;
  return r.key === '__root' ? null : r.key;
}
async function moveSelected() {
  if (!selected) return;
  const cur = FO.folderOf(folders(), selected)?.id ?? null;
  const c = await pickFolder('Move “' + (rigById(selected)?.name || 'chain') + '” to…', () => true, cur, FO.rigType(rigById(selected)));
  if (c === undefined) return;
  await setFolders(FO.moveRigs(folders(), [selected], c)); renderStrip();
}

async function makeCustomPng(kind) {      // pick a picture, turn it into the chosen kind of item, and switch it on
  const pic = await pickPng();
  if (!pic) return;
  try {
    const rig = kind === 'orbit' ? pngOrbitRig(pic.name, pic.uri, 1) : pngEmitterRig(pic.name, pic.uri);
    await api.saveRig(rig);
    await new Promise((r) => setTimeout(r, 400));          // let the library list pick the new item up
    selected = rig.id; await equip(rig.id, true);
  } catch (e) { api.logDebug('custom PNG failed: ' + (e && e.message)); }
}
function renderStrip() {
  const keep = strip.scrollLeft;
  const f = favs();
  strip.innerHTML = '';
  const list = listed();
  let mode = libMode();
  if (mode === 'drawer' && drawerFailed) mode = 'strip';
  strip.classList.toggle('list', mode === 'list');
  strip.classList.toggle('drawer', mode === 'drawer');
  card.dataset.lib = mode;
  document.querySelectorAll('#lib-view button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
  document.querySelectorAll('#type-filter button').forEach((b) => b.classList.toggle('on', b.dataset.t === typeFilter()));
  paintCrumbs();
  const subs = shownFolders();
  if (!list.length && !subs.length) strip.innerHTML = `<div class="empty">${query ? 'Nothing matches' : cwd ? 'This folder is empty. Move chains in with “Move to…” or from the Inventory.' : 'No chains yet. Press + New'}</div>`;
  if (!query && !cwd) {      // (only at the top of a tab, never inside a folder) the first icons: the real thing with a "?" picture. Double-click to choose your own PNG and make a cursorbit / cursor emitter from it
    for (const [kind, label] of [['orbit', 'Custom PNG Cursorbit'], ['particles', 'Custom PNG Emitter']]) {
      if (typeFilter() !== 'all' && typeFilter() !== kind) continue;
      const tid = kind === 'orbit' ? '__tpl_orbit' : '__tpl_particles';
      const t = document.createElement('div');
      t.dataset.id = tid;
      t.title = 'Double-click to choose a PNG and make your own ' + (kind === 'orbit' ? 'cursorbit that orbits the cursor' : 'cursor emitter that drifts off the cursor');
      if (mode === 'list') { t.className = 'item addpng'; t.innerHTML = '<span class="name"></span><span class="tag">double-click</span>'; }
      else if (mode === 'drawer') { t.className = 'slot addpng'; t.innerHTML = '<span class="name"></span>'; }
      else {
        t.className = 'tile addpng'; t.innerHTML = '<span class="thumb"></span><span class="name"></span>';
        const u = thumbs.get(tid)?.url;
        if (u) { const img = document.createElement('img'); img.src = u; img.alt = ''; t.querySelector('.thumb').appendChild(img); } else ensureThumb(tid);
      }
      t.querySelector('.name').textContent = label;
      t.addEventListener('dblclick', () => makeCustomPng(kind));
      strip.appendChild(t);
    }
  }
  for (const f of subs) {
    const tt = typeFilter(), n = FO.countIn(folders(), f.id, (x) => rigExists(x) && (tt === 'all' || FO.rigType(rigById(x)) === tt));
    const t = document.createElement('div');
    t.dataset.folder = f.id;
    t.title = f.name + ' (folder). Click to open, right-click for more.';
    if (mode === 'list') {
      t.className = 'item folder';
      t.innerHTML = '<span class="fico"></span><span class="name"></span><span class="tag"></span>';
    } else {
      t.className = 'fslot' + (mode === 'drawer' ? ' drawer' : '');
      t.innerHTML = '<span class="fbig"></span><span class="name"></span><span class="fn"></span>';
    }
    t.querySelector('.name').textContent = f.name;
    if (f.icon) { const ib = t.querySelector('.fbig, .fico'); if (ib) { ib.classList.add('img'); ib.style.backgroundImage = 'url("' + f.icon + '")'; } }
    const cnt = t.querySelector('.fn, .tag'); cnt.textContent = n === 1 ? '1 item' : n + ' items';
    t.addEventListener('click', () => openFolder(f.id));
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); folderMenu(f.id); });
    acceptDrop(t, () => f.id, () => openFolder(f.id));
    strip.appendChild(t);
  }
  for (const r of list) {
    const typeName = r.type || 'chain';
    if (mode === 'list') {
      const it = document.createElement('div');
      it.className = 'item';
      it.dataset.id = r.id;
      it.innerHTML = '<span class="dot" title="Equipped"></span><span class="name"></span><span class="tag"></span><span class="star">★</span>';
      it.querySelector('.name').textContent = r.name;
      it.querySelector('.tag').textContent = (query ? (FO.folderOf(folders(), r.id)?.name || 'Main menu') + ' · ' : '') + typeName + (typeName === 'chain' ? ' · ' + (r.segments ?? '') + ' links' : '');
      if (f.has(r.id)) it.classList.add('fav');
      it.addEventListener('click', () => select(r.id));
      it.addEventListener('dblclick', () => equip(r.id, !isEquipped(r.id)));
      strip.appendChild(it);
      continue;
    }
    const t = document.createElement('div');
    if (mode === 'drawer') {
      t.className = 'slot';
      t.dataset.id = r.id;
      t.innerHTML = '<span class="name"></span><span class="eq" title="Equipped"></span><span class="star">★</span>';
    } else {
      t.className = 'tile';
      t.dataset.id = r.id;
      t.innerHTML = '<span class="thumb"></span><span class="name"></span><span class="eq" title="Equipped"></span><span class="star">★</span>';
      const u = thumbs.get(r.id)?.url;
      if (u) { const img = document.createElement('img'); img.src = u; img.alt = ''; t.querySelector('.thumb').appendChild(img); } else ensureThumb(r.id);
    }
    t.querySelector('.name').textContent = r.name;
    t.title = r.name + ' (' + typeName + ')';
    if (f.has(r.id)) t.classList.add('fav');
    t.addEventListener('click', () => select(r.id));
    t.addEventListener('dblclick', () => equip(r.id, !isEquipped(r.id)));      // double-click = equip, or unequip when it is already on
    strip.appendChild(t);
  }
  strip.querySelectorAll('.tile:not(.addpng), .item:not(.folder):not(.addpng), .slot:not(.addpng)').forEach((t) => {
    t.draggable = true;
    t.addEventListener('dragstart', (e) => { dragging = [t.dataset.id]; e.dataTransfer.setData('text/plain', t.dataset.id); e.dataTransfer.effectAllowed = 'move'; t.classList.add('dragging'); });
    t.addEventListener('dragend', () => { t.classList.remove('dragging'); setTimeout(() => { dragging = null; }, 50); });
    t.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); select(t.dataset.id); itemMenu(t.dataset.id); });
  });
  strip.scrollLeft = keep;
  if (mode === 'drawer' && view === 'home') { if (!drawer.start()) { drawerFailed = true; renderStrip(); return; } } else drawer.stop();
  mark();
}

// classes only, so the strip doesn't jump when you click
const equippedIds = () => { const m = settings.activeRigs; return m ? Object.values(m).filter(Boolean) : [settings.activeRig].filter(Boolean); };   // one cursorchain, one cursorbit and one emitter can be on at once
const isEquipped = (id) => equippedIds().includes(id);
function mark() {
  strip.querySelectorAll('.tile, .item, .slot').forEach((t) => {
    t.classList.toggle('sel', t.dataset.id === selected);
    t.classList.toggle('active', isEquipped(t.dataset.id));
  });
  const r = rigById(selected);
  $('#sel-name').textContent = r ? r.name : '';
  const on = r && isEquipped(r.id);
  $('#sel-tag').textContent = on ? 'Equipped' : '';
  const eq = $('#equip');
  eq.textContent = on ? 'Unequip' : 'Equip';
  eq.title = on ? 'Take this one off your cursor' : 'Hang this from your cursor. You can have one cursorchain, one cursorbit and one cursor emitter on at the same time.';
  eq.classList.toggle('primary', !on);
  eq.disabled = !r;
  $('#edit').disabled = !r;
  $('#move').disabled = !r;
}

function select(id) {
  selected = id;
  mark();
  strip.querySelector('.tile.sel, .item.sel, .slot.sel')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}
async function equip(id, on = true) {
  if (!id) return;
  selected = id;
  const t = FO.rigType(rigById(id));
  settings.activeRigs = { ...(settings.activeRigs || {}), [t]: on ? id : null };   // show it at once; the app confirms right after
  if (on && t === 'chain') settings.activeRig = id;
  mark(); if (view === 'profile') paintProfileNote();
  await api.equipRig(id, on);
}

// ------------------------------------------------------------ profile
const labelFloor = () => (IS_MAC ? 'Rest on the Dock' : 'Rest on taskbar');

function slider({ label, min, max, step, f, get, input, change, hint }) {
  const el = document.createElement('div');
  el.className = 'slider';
  const span = document.createElement('span'); span.textContent = label;
  if (hint) { span.title = hint; el.title = hint; }
  const out = document.createElement('output');
  const r = Object.assign(document.createElement('input'), { type: 'range', min, max, step });
  const paint = () => { const v = parseFloat(r.value); out.textContent = fmt[f](v); r.style.setProperty('--p', ((v - min) / (max - min)) * 100 + '%'); };
  r.value = get(); paint();
  r.addEventListener('input', () => { paint(); input?.(parseFloat(r.value)); });
  if (change) r.addEventListener('change', () => change(parseFloat(r.value)));
  el.append(span, out, r);
  return el;
}
function selectRow(label, options, get, change, title) {
  const el = document.createElement('div');
  el.className = 'row'; if (title) el.title = title;
  const s = document.createElement('span'); s.textContent = label;
  const sel = document.createElement('select');
  for (const [k, name] of options) sel.append(Object.assign(document.createElement('option'), { value: k, textContent: name }));
  sel.value = get();
  sel.addEventListener('change', () => change(sel.value));
  el.append(s, sel);
  return el;
}
function toggle(label, get, change) {
  const el = document.createElement('div');
  el.className = 'row';
  const sw = document.createElement('label'); sw.className = 'switch';
  const i = Object.assign(document.createElement('input'), { type: 'checkbox' });
  i.checked = !!get();
  i.addEventListener('change', () => change(i.checked));
  sw.append(i, document.createElement('span'));
  const s = document.createElement('span'); s.textContent = label;
  el.append(s, sw);
  return el;
}

async function openProfile(id) {
  const [rig, st] = await Promise.all([api.loadRig(id), api.state()]);
  if (!rig) return;
  globals = st.globals;
  const base = {}; for (const k of FEEL_KEYS) base[k] = globals[k];
  profile = { id, rig, vals: { ...base, ...(rig.feel || {}) }, dirty: false, touched: new Set(),
    orig: { feel: JSON.parse(JSON.stringify(rig.feel || {})), physics: { flatten: rig.physics?.flatten, depthSway: rig.physics?.depthSway },
      orbit: rig.orbit ? { sway: rig.orbit.sway, baseSpeed: rig.orbit.baseSpeed, maxSpeed: rig.orbit.maxSpeed } : undefined,
      particles: rig.particles ? { rate: rig.particles.rate, rateFast: rig.particles.rateFast, max: rig.particles.max } : undefined,
      hang: { x: rig.hang?.x || 0, y: rig.hang?.y || 0 } } };
  buildProfile();
  setView('profile');
}

function buildProfile() {
  const { id, rig, vals } = profile;
  $('#p-name').value = rig.name || '';
  paintProfileThumb(); paintProfileNote(); paintSave(); $('#p-unsaved').hidden = true; card.classList.remove('asking');
  $('#p-fav').textContent = favs().has(id) ? 'Remove favourite' : 'Favourite';
  const box = $('#p-controls');
  box.innerHTML = '';
  const feel = (key) => (v) => { profile.vals[key] = v; profile.touched.add(key); api.setFeel(id, { [key]: v }); markDirty(); };
  const phys = rig.physics || {};
  const sl = (label, key, min, max, step, f, hint) => slider({ label, min, max, step, f, hint, get: () => vals[key], input: feel(key) });
  const col1 = document.createElement('div'), col2 = document.createElement('div');
  col1.className = col2.className = 'pc';
  const type = rig.type || 'chain';
  col1.append(sl('Size', 'scale', 0.25, 4, 0.05, 'x', 'How big the whole cursorchain looks on your screen.'));
  if (type === 'chain' && (rig.segments || []).some((x) => /^link\b/i.test(x.name))) col1.append(slider({ label: 'Chain link size', min: 0.3, max: 4, step: 0.05, f: 'x', hint: 'Makes every link of the chain bigger or smaller (the key ring has its own slider). Everything hanging below moves with it.', get: () => (Number.isFinite(vals.linkSize) ? vals.linkSize : 1), input: feel('linkSize') }));
  if (type === 'chain' && topRing(rig)) col1.append(slider({ label: 'Key ring size', min: 0.4, max: 3, step: 0.05, f: 'x', hint: 'Makes the big metal key ring at the top bigger or smaller. Everything hanging from it moves with it.', get: () => (Number.isFinite(vals.ringSize) ? vals.ringSize : 1), input: feel('ringSize') }));
  if (type === 'orbit') col1.append(slider({ label: 'Orbit size', min: 0.1, max: 4, step: 0.05, f: 'x', hint: 'How wide the orbit is around the cursor (1x = as designed). Drag to make it as big or small as you like.', get: () => (Number.isFinite(vals.orbitSize) ? vals.orbitSize : 1), input: feel('orbitSize') }));
  if (type !== 'orbit') col1.append(
    sl('Gravity', 'gravity', 0, 3, 0.05, 'x', 'How strongly it is pulled down. Lower feels floaty, higher feels heavy.'),
    sl('Extra drag', 'damping', 0, 0.3, 0.005, 'f3', 'Air resistance. Higher settles faster and swings less.'),
    slider({ label: 'Automatic spin', min: 0, max: 90, step: 1, f: 'deg', hint: 'A constant slow turn about the string. 0 = off. Models still twist when you move the cursor.',
      get: () => vals.spin ?? (rig.segments || []).flatMap((x) => x.attachments || []).find((a) => a.kind === 'model')?.spin ?? 0, input: feel('spin') }),
    slider({ label: 'Spin allowance', min: 0, max: 1, step: 0.05, f: 'pct', hint: 'How much it is allowed to turn around the string. 100% = free to turn as the cursor moves (default), lower turns less, 0% = it never turns.',
      get: () => (Number.isFinite(vals.spinAllow) ? vals.spinAllow : 1), input: feel('spinAllow') }),
    slider({ label: 'Natural bending', min: 0, max: 1, step: 0.05, f: 'pct', hint: 'A soft preference for which way limbs bend, like a real body: knees bend backwards, elbows and hips bend forwards. It never holds a pose and limbs can still bend any way. 0% = off.',
      get: () => (Number.isFinite(vals.anatomy) ? vals.anatomy : 1), input: feel('anatomy') }));
  col1.append(sl('Opacity', 'opacity', 0.1, 1, 0.05, 'pct', 'How see-through it is.'));
  if (type === 'chain') col1.append(
    toggle('Impact particles', () => vals.impactOn ?? rig.impact?.on ?? false, (v) => feel('impactOn')(v)),
    selectRow('Impact style', IMPACT_STYLES, () => vals.impactStyle ?? rig.impact?.style ?? 'wood', (v) => feel('impactStyle')(v), 'What flies off when it smacks into the floor or the sides of the screen. Needs "Collide with floor", walls or ceiling switched on (right).'),
    slider({ label: 'Particle amount', min: 0, max: 3, step: 0.1, f: 'x', hint: 'How many particles each impact throws out (1x = normal, 0 = none, 3x = a big burst).', get: () => (Number.isFinite(vals.impactAmount) ? vals.impactAmount : 1), input: feel('impactAmount') }));
  const png = {      // sliders only for items made from your own picture; they rewrite the item itself
    orbit: type === 'orbit' && (rig.segments || []).some((x) => (x.attachments || []).some((at) => at.image)),
    emit: type === 'particles' && !!rig.particles?.image,
  };
  const cu = (label, min, max, step, f, hint, get, key) => { let cur = get(); return slider({ label, min, max, step, f, hint, get: () => cur, input: (v) => { cur = v; }, change: (v) => { api.patchRig(id, { custom: { [key]: v } }); } }); };
  const imgAtt = () => { for (const x of rig.segments || []) for (const at of x.attachments || []) if (at.image) return at; return null; };
  const live = (group, key) => ({ get: () => profile.rig[group]?.[key] ?? 0,
    input: (v) => { (profile.rig[group] ||= {})[key] = v; markDirty(); },
    change: () => api.patchRig(id, { [group]: { [key]: profile.rig[group][key] } }) });
  const ex = (label, group, key, min, max, step, f, hint) => slider({ label, min, max, step, f, hint, ...live(group, key) });
  const ps = (label, key, max, hint) => slider({ label, min: 0, max, step: 0.01, f: 'f2', hint, get: () => profile.rig.physics?.[key] ?? (key === 'depthSway' ? 1.5 : 0),
    input: (v) => { profile.rig.physics = profile.rig.physics || {}; profile.rig.physics[key] = v; markDirty(); } });
  if (type === 'orbit') {
    if (png.orbit) col1.append(
      cu('Pictures orbiting', 1, 24, 1, 'int', 'How many copies of your picture circle the cursor.', () => rig.segments.length, 'count'),
      cu('Picture size', 0.2, 5, 0.05, 'x', 'How big each picture is.', () => imgAtt()?.scale?.[0] ?? 1, 'size'),
      cu('Picture opacity', 0.1, 1, 0.05, 'pct', 'How see-through the pictures are.', () => imgAtt()?.opacity ?? 1, 'opacity'));
    col2.append(
      ex('Orbit wobble', 'orbit', 'sway', 0, 1.5, 0.05, 'f2', 'How much the orbit rings tilt and lean over time. 0 keeps every orbit on one fixed, clear path.'),
      ex('Idle speed', 'orbit', 'baseSpeed', 0, 3, 0.05, 'f2', 'How fast everything orbits while the cursor is still.'),
      ex('Fast speed', 'orbit', 'maxSpeed', 0, 20, 0.5, 'f2', 'How fast everything orbits while the cursor is moving quickly.'),
      ...((rig.orbit?.rings || []).some((r) => Number.isFinite(r.realSpeed)) ? [toggle('Realistic speeds', () => vals.orbitReal, (v) => feel('orbitReal')(v))] : []));
  } else if (type === 'particles') {
    col1.append(
      cu('Amount', 0, 8, 0.05, 'x', 'How many particles come out: the idle and fast emit rates together (1x = as made). Use this for a heavier or lighter stream.', () => { const P = rig.particles; return P._base && P._base.rate ? P.rate / P._base.rate : 1; }, 'amount'),
      cu('Particle size', 0.2, 4, 0.05, 'x', 'How big each particle is (1x = as made).', () => { const P = rig.particles; return P._base?.size?.[0] ? (P.size?.[0] ?? P._base.size[0]) / P._base.size[0] : 1; }, 'size'),
      cu('Burst speed', 0, 8, 0.05, 'x', 'How fast particles are thrown out of the cursor, and how much they inherit from how fast you move it (1x = as made).', () => { const P = rig.particles; return P._base?.launch ? (P.launch ?? P._base.launch) / P._base.launch : 1; }, 'burst'),
      cu('Spread', 0, 10, 0.05, 'x', 'How wide an area around the cursor they appear in (1x = as made).', () => { const P = rig.particles; return P._base?.spread ? (P.spread ?? P._base.spread) / P._base.spread : 1; }, 'spread'),
      cu('Lifetime', 0.3, 4, 0.05, 'x', 'How long each particle lasts before it fades (1x = as made).', () => { const P = rig.particles; return P._base?.life?.[0] ? (P.life?.[0] ?? P._base.life[0]) / P._base.life[0] : 1; }, 'life'),
      cu('Rise / fall', -4, 8, 0.1, 'f2', 'Gravity on the particles: 0 hangs in the air, higher falls faster, below 0 floats upward.', () => rig.particles.gravity ?? 0.7, 'gravity'),
      cu('Wobble', 0, 4, 0.05, 'f2', 'How much they sway side to side as they drift.', () => rig.particles.flutter ?? 0.5, 'flutter'),
      cu('Spin', 0, 6, 0.05, 'f2', 'How fast the particles turn as they drift.', () => rig.particles.tumble ?? 0.7, 'tumble'));
    col2.append(
      ex('Emit (idle)', 'particles', 'rate', 0, 60, 0.5, 'f2', 'How many particles appear per second while the cursor is still.'),
      ex('Emit (fast)', 'particles', 'rateFast', 0, 120, 1, 'f2', 'How many appear per second when the cursor moves quickly.'),
      ex('Max at once', 'particles', 'max', 4, 200, 1, 'f2', 'The most particles alive at once. Lower is lighter on older computers.'),
      sl('Wind strength', 'windStrength', 0, 1.5, 0.05, 'f2', 'How hard the wind blows the particles sideways when Wind is on.'),
      toggle('Wind', () => vals.wind, (v) => feel('wind')(v)),
      toggle('Collide with floor', () => vals.floor, (v) => feel('floor')(v)));
  } else {
    col2.append(
      ps('Keep flat', 'flatten', 1, 'Stops it swinging toward or away from the screen. Lower lets it swing in 3D.'),
      ps('Depth sway', 'depthSway', 1.5, 'A gentle in and out drift when you move the cursor fast.'),
      sl('Wind strength', 'windStrength', 0, 1.5, 0.05, 'f2', 'How hard the wind pushes when Wind is on.'),
      toggle('Wind', () => vals.wind, (v) => feel('wind')(v)),
      toggle('Collide with floor', () => vals.floor, (v) => feel('floor')(v)),
      toggle('Collide with walls', () => vals.walls, (v) => feel('walls')(v)),
      toggle('Collide with ceiling', () => vals.ceiling ?? false, (v) => feel('ceiling')(v)));
  }
  box.append(col1, col2);
  box.append(centreRow());
  if (type === 'orbit') {
    const wrap = document.createElement('div'); wrap.className = 'adj';
    const dflt = { orbitTilt: 0, orbitRoll: 0, orbitSpeed: 1, orbitSize: 1, orbitDir: 1 };
    const cur = (k) => (Number.isFinite(vals[k]) ? vals[k] : dflt[k]);
    const outs = [];
    const step = (label, key, hint, down, up, text) => {
      const g = document.createElement('div'); g.className = 'stp'; g.title = hint;
      const l = document.createElement('span'); l.textContent = label;
      const out = document.createElement('output'); const paint = () => { out.textContent = text(cur(key)); };
      const mk = (t, f, tip) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = t; b.title = tip; b.onclick = () => { feel(key)(+f(cur(key)).toFixed(3)); outs.forEach((o) => o()); }; return b; };
      paint(); outs.push(paint);
      g.append(l, mk('−', down, hint), out, mk('+', up, hint));
      return g;
    };
    wrap.append(
      step('Angle', 'orbitTilt', 'Tips every orbit more open or more edge-on. One press = 5 degrees.', (v) => Math.max(-90, v - 5), (v) => Math.min(90, v + 5), (v) => (v > 0 ? '+' : '') + Math.round(v) + '°'),
      step('Roll', 'orbitRoll', 'Turns every orbit around on screen. One press = 5 degrees.', (v) => Math.max(-180, v - 5), (v) => Math.min(180, v + 5), (v) => (v > 0 ? '+' : '') + Math.round(v) + '°'),
      step('Speed', 'orbitSpeed', 'Makes every orbit faster or slower, on top of the idle and fast speeds above.', (v) => Math.max(0.1, v / 1.2), (v) => Math.min(60, v * 1.2), (v) => v.toFixed(2) + '×'));
    const dirG = document.createElement('div'); dirG.className = 'stp'; dirG.title = 'Turns every orbit the other way round.';
    const dirL = document.createElement('span'); dirL.textContent = 'Direction';
    const dirB = document.createElement('button'); dirB.className = 'btn';
    const dirPaint = () => { dirB.textContent = cur('orbitDir') === -1 ? 'Reversed' : 'Normal'; };
    dirB.onclick = () => { feel('orbitDir')(cur('orbitDir') === -1 ? 1 : -1); dirPaint(); };
    dirPaint(); outs.push(dirPaint); dirG.append(dirL, dirB);
    wrap.append(dirG);
    const reset = document.createElement('button'); reset.className = 'btn ghost'; reset.textContent = 'Reset angles'; reset.title = 'Put angle, roll, speed and size back to normal';
    reset.onclick = () => { for (const k of Object.keys(dflt)) feel(k)(dflt[k]); outs.forEach((o) => o()); };
    wrap.append(reset);
    wrap.style.cssText = 'border-top:0;margin-top:0;padding-top:0';
    // ---- a picture of the orbit: drag the round dot to turn it, drag the square dot to tip it open or edge-on
    const orb = document.createElement('div'); orb.className = 'orb';
    const left = document.createElement('div'); left.className = 'orb-l';
    const S = 156, dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas'); cv.className = 'odiag'; cv.width = S * dpr; cv.height = S * dpr; cv.style.width = cv.style.height = S + 'px';
    cv.title = 'This is how the orbit looks on your screen. Drag the round dot to turn it. Drag the square dot to tip it open or edge-on. The dot in the middle is your cursor.';
    const rings = (rig.orbit?.rings || []).filter((r) => r.radius > 0);
    const main = rings.reduce((m, r) => (!m || r.radius > m.radius ? r : m), null);
    const maxR = Math.max(0.3, ...rings.map((r) => r.radius));
    const D = Math.PI / 180, wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
    const view = () => {
      const size = cur('orbitSize'), k = (S / 2 - 16) / (maxR * Math.max(1, size));
      const geo = (r) => { const tilt = Math.max(-85, Math.min(85, r.tilt + cur('orbitTilt'))), node = r.node + cur('orbitRoll'); const a = r.radius * size * k; return { a, b: a * Math.cos(tilt * D), tilt, node }; };
      return { k, geo };
    };
    const draw = () => {
      const g = cv.getContext('2d'), css = getComputedStyle(document.documentElement), ink = css.getPropertyValue('--text').trim() || '#fff', line = css.getPropertyValue('--line').trim() || '#888';
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S);
      const c = S / 2, { geo } = view();
      g.strokeStyle = line; g.lineWidth = 1; g.setLineDash([3, 4]);               // faint guides: face-on circle and the cross-hairs
      g.beginPath(); g.arc(c, c, c - 16, 0, 7); g.moveTo(8, c); g.lineTo(S - 8, c); g.moveTo(c, 8); g.lineTo(c, S - 8); g.stroke(); g.setLineDash([]);
      for (const r of rings) { const e = geo(r); g.strokeStyle = ink; g.globalAlpha = r === main ? 0.95 : 0.45; g.lineWidth = r === main ? 2 : 1.4; g.beginPath(); g.ellipse(c, c, e.a, Math.max(0.6, e.b), -e.node * D, 0, 7); g.stroke(); }
      g.globalAlpha = 1;
      g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(c, c, 3.5, 0, 7); g.fill();     // your cursor
      if (main) {
        const e = geo(main), n = e.node * D, hb = Math.max(e.b, 9);
        const R = [c + e.a * Math.cos(n), c - e.a * Math.sin(n)], T = [c - hb * Math.sin(n), c - hb * Math.cos(n)];
        g.fillStyle = ink; g.strokeStyle = css.getPropertyValue('--strong-ink').trim() || '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(R[0], R[1], 7, 0, 7); g.fill(); g.stroke();
        g.fillRect(T[0] - 6, T[1] - 6, 12, 12); g.strokeRect(T[0] - 6, T[1] - 6, 12, 12);
        cv._h = { R, T };
      }
    };
    let drag = null;
    const pt = (ev) => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * (S / r.width), (ev.clientY - r.top) * (S / r.height)]; };
    cv.addEventListener('pointerdown', (ev) => {
      if (!main) return;
      const [x, y] = pt(ev), h = cv._h || {}, d = (p) => Math.hypot(x - p[0], y - p[1]);
      drag = h.T && d(h.T) < 15 && (!h.R || d(h.T) < d(h.R)) ? 'tilt' : 'roll';      // not on a handle: turning is the natural drag
      cv.setPointerCapture(ev.pointerId); ev.preventDefault(); move(ev);
    });
    let busy = false;
    const move = (ev) => {
      if (!drag || !main) return;
      const [x, y] = pt(ev), c = S / 2, { k } = view(), size = cur('orbitSize');
      const e = view().geo(main);
      if (drag === 'roll') {
        let phi = Math.atan2(c - y, x - c) / D;
        if (Math.abs(wrap180(phi - e.node)) > 90) phi += 180;                          // the ellipse looks the same turned half way round
        feel('orbitRoll')(Math.round(wrap180(phi - main.node)));
      } else {
        const n = e.node * D, a = e.a || 1;
        const along = ((x - c) * -Math.sin(n) + (c - y) * Math.cos(n)) / a;            // 1 = face-on circle, 0 = edge-on
        const ratio = Math.max(0.0872, Math.min(1, Math.abs(along)));
        const tilt = Math.acos(ratio) / D * (e.tilt < 0 ? -1 : 1);
        feel('orbitTilt')(Math.round(Math.max(-90, Math.min(90, tilt - main.tilt))));
      }
      if (!busy) { busy = true; requestAnimationFrame(() => { busy = false; outs.forEach((o) => o()); }); }
    };
    cv.addEventListener('pointermove', move);
    const up = () => { drag = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    outs.push(draw);
    const tip = document.createElement('div'); tip.className = 'orb-tip'; tip.textContent = 'Drag ● to turn · drag ■ to tip';
    const pre = document.createElement('div'); pre.className = 'orb-pre';
    for (const [label, tilt, hint] of [['Face-on', 0, 'Orbits seen head-on, as a full circle'], ['Tilted', 45, 'Orbits tipped about half way'], ['Edge-on', 80, 'Orbits seen from the side, as a thin line']]) {
      const b = document.createElement('button'); b.className = 'btn chip'; b.textContent = label; b.title = hint;
      b.onclick = () => { if (main) feel('orbitTilt')(Math.round(tilt - main.tilt)); outs.forEach((o) => o()); };
      pre.append(b);
    }
    left.append(cv, tip, pre);
    orb.append(left, wrap);
    box.append(orb);
    draw();
  }
}

// Hold a nudge button down to keep moving: one step at once, then after a short delay it repeats (quicker the longer you hold). A keyboard press (Enter/Space) is still a single step.
function holdRepeat(btn, step) {
  let delay = null, tick = null, n = 0;
  const stop = () => { clearTimeout(delay); clearTimeout(tick); delay = tick = null; };
  const run = (shift) => { step(shift); n++; tick = setTimeout(() => run(shift), n > 25 ? 25 : n > 12 ? 45 : 80); };
  btn.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); btn.setPointerCapture?.(e.pointerId); stop(); n = 0; step(e.shiftKey); const sh = e.shiftKey; delay = setTimeout(() => run(sh), 450); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) btn.addEventListener(ev, stop);
  btn.addEventListener('click', (e) => { if (e.detail === 0) step(e.shiftKey); });   // keyboard activation only: mouse clicks were handled on pointerdown
}

// This item's own centring: a small offset (screen pixels) saved inside the rig, added to the global hang point.
function centreRow() {
  const el = document.createElement('div'); el.className = 'centre';
  const lab = document.createElement('span'); lab.className = 'c-lab'; lab.textContent = 'Centre on cursor'; lab.title = 'Move this item against your mouse cursor. Saved inside this item\'s .crig file, so it stays when you share it. Hold Shift for bigger steps.';
  const out = document.createElement('output');
  const cur = () => profile.rig.hang || { x: 0, y: 0 };
  const paint = () => { out.textContent = `${cur().x}, ${cur().y}`; };
  const go = (dx, dy) => { const h = cur(), nx = Math.max(-300, Math.min(300, (h.x || 0) + dx)), ny = Math.max(-300, Math.min(300, (h.y || 0) + dy)); profile.rig.hang = { x: nx, y: ny }; markDirty(); paint(); api.patchRig(profile.id, { hang: profile.rig.hang }); };
  const mk = (t, dx, dy, tip) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = t; b.title = tip + ' - hold to keep moving'; holdRepeat(b, (shift) => { const k = shift ? 5 : 1; go(dx * k, dy * k); }); return b; };
  const reset = document.createElement('button'); reset.className = 'btn ghost'; reset.textContent = 'Reset'; reset.title = 'Back to the shared centre'; reset.onclick = () => { profile.rig.hang = { x: 0, y: 0 }; markDirty(); paint(); api.patchRig(profile.id, { hang: { x: 0, y: 0 } }); };
  const all = document.createElement('button'); all.className = 'link'; all.textContent = 'Shared centre for everything…'; all.title = 'Choose where on the mouse cursor everything hangs from'; all.onclick = () => openHang();
  paint();
  el.append(lab, mk('◀', -1, 0, 'Move left (Shift: 5 px)'), mk('▲', 0, -1, 'Move up (Shift: 5 px)'), mk('▼', 0, 1, 'Move down (Shift: 5 px)'), mk('▶', 1, 0, 'Move right (Shift: 5 px)'), out, reset, all);
  return el;
}

function paintProfileThumb() {
  if (!profile) return;
  const t = $('#p-thumb'); t.innerHTML = '';
  const u = thumbs.get(profile.id)?.url;
  if (u) { const img = document.createElement('img'); img.src = u; img.alt = ''; t.appendChild(img); } else ensureThumb(profile.id, true);   // the profile always shows what you are editing
}
function paintProfileNote() {
  if (!profile) return;
  const on = isEquipped(profile.id);
  $('#p-equip').textContent = on ? 'Unequip' : 'Equip';
  $('#p-equip').classList.toggle('primary', !on);
  $('#p-note').textContent = on ? 'Changes show live' : 'Equip it to see changes live';
}

function markDirty() { if (profile && !profile.dirty) { profile.dirty = true; paintSave(); } }
function paintSave() {
  const b = $('#p-save'); const d = !!profile?.dirty;
  b.disabled = !d; b.textContent = d ? 'Save changes' : 'Saved ✓'; b.classList.toggle('primary', d);
}
async function saveProfile() {
  if (!profile) return;
  const name = $('#p-name').value.trim() || profile.rig.name;
  profile.rig.name = name; $('#p-name').value = name;
  const physics = { flatten: profile.rig.physics?.flatten, depthSway: profile.rig.physics?.depthSway };
  const pick = (o, ks) => (o ? Object.fromEntries(ks.map((k) => [k, o[k]])) : undefined);
  const orbit = pick(profile.rig.orbit, ['sway', 'baseSpeed', 'maxSpeed']), particles = pick(profile.rig.particles, ['rate', 'rateFast', 'max']);
  const hang = { x: profile.rig.hang?.x || 0, y: profile.rig.hang?.y || 0 };
  await api.patchRig(profile.id, { name, physics, orbit, particles, hang });
  const r = rigById(profile.id); if (r) r.name = name;
  const feelNow = { ...profile.orig.feel }; for (const k of profile.touched) feelNow[k] = profile.vals[k];
  profile.orig = { feel: feelNow, physics, orbit, particles, hang };
  profile.dirty = false; paintSave(); renderStrip();
}
async function discardProfile() {
  if (!profile) return;
  const { id, orig } = profile;
  await api.resetFeel(id);
  if (Object.keys(orig.feel).length) await api.setFeel(id, orig.feel);
  await api.patchRig(id, { physics: orig.physics, orbit: orig.orbit, particles: orig.particles, hang: orig.hang });
  profile.dirty = false;
}
$('#p-save').onclick = saveProfile;
$('#p-back').onclick = () => { if (profile?.dirty) { $('#p-unsaved').hidden = false; card.classList.add('asking'); } else setView('home'); };
$('#u-keep').onclick = () => { $('#p-unsaved').hidden = true; card.classList.remove('asking'); };
$('#u-save').onclick = async () => { await saveProfile(); $('#p-unsaved').hidden = true; card.classList.remove('asking'); setView('home'); };
$('#u-discard').onclick = async () => { await discardProfile(); $('#p-unsaved').hidden = true; card.classList.remove('asking'); setView('home'); };
$('#p-equip').onclick = () => equip(profile.id, !isEquipped(profile.id));
$('#p-editor').onclick = () => api.openEditor(profile.id);
$('#p-file').onclick = () => api.exportChain(profile.id);
$('#p-name').addEventListener('input', markDirty);
$('#p-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#p-fav').onclick = () => {
  const s = favs(); s.has(profile.id) ? s.delete(profile.id) : s.add(profile.id);
  set({ favoriteRigs: [...s] }); $('#p-fav').textContent = s.has(profile.id) ? 'Remove favourite' : 'Favourite'; renderStrip();
};
$('#p-dup').onclick = async () => { const id = await api.duplicateRig(profile.id); if (id) { selected = id; setView('home'); } };
$('#p-reset').onclick = async () => { await api.resetFeel(profile.id); await openProfile(profile.id); };
$('#p-del').onclick = () => {
  const r = rigById(profile.id);
  if (!confirm(`Delete “${r?.name || 'this chain'}”? This can't be undone.`)) return;
  thumbs.delete(profile.id); api.deleteRig(profile.id); profile = null; selected = null; setView('home');
};

// ------------------------------------------------------------ settings
function applyTheme() {
  const theme = settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.theme === theme));
}
function syncSettings() {
  applyTheme();
  $('#visible').checked = !!settings.overlayVisible;
  document.querySelectorAll('.s-body .switch input[data-key]').forEach((i) => { i.checked = !!settings[i.dataset.key]; });
  document.querySelectorAll('.kbd-btn').forEach((b) => { if (!b.classList.contains('listening')) b.textContent = prettyKey(settings[b.dataset.key]); });
}
document.querySelectorAll('.s-body .switch input[data-key]').forEach((i) => i.addEventListener('change', () => set({ [i.dataset.key]: i.checked })));
document.querySelectorAll('#theme button').forEach((b) => b.addEventListener('click', () => { set({ theme: b.dataset.theme }); applyTheme(); }));
$('#visible').addEventListener('change', (e) => set({ overlayVisible: e.target.checked }));

document.querySelectorAll('.kbd-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.classList.add('listening');
    btn.textContent = 'Press keys…';
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') return done(null);
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const mods = [];
      if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      if (!mods.length) return;   // global hotkeys need a modifier
      const k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.code;
      done([...mods, k].join('+'));
    };
    const done = (acc) => {
      window.removeEventListener('keydown', onKey, true);
      btn.classList.remove('listening');
      if (acc) set({ [btn.dataset.key]: acc });
      syncSettings();
    };
    window.addEventListener('keydown', onKey, true);
  });
});

// ------------------------------------------------------------ chain position (same for every chain)
const HANG_BR = IS_MAC ? [10, 17] : [11, 19];   // roughly the bottom right of a normal arrow pointer
const clampHang = (v) => Math.max(-80, Math.min(80, Math.round(v)));
const BUILTIN = () => [{ id: 'tip', name: 'Pointer tip', x: 0, y: 0 }, { id: 'br', name: 'Bottom right', x: HANG_BR[0], y: HANG_BR[1] }, { id: 'ctr', name: 'Centre', x: Math.round(HANG_BR[0] / 2), y: Math.round(HANG_BR[1] / 2) }];
function paintHang() {
  const x = settings.hangX ?? 0, y = settings.hangY ?? 0;
  $('#h-read').textContent = `${x}, ${y}`;
  const box = $('#h-presets'); box.textContent = '';
  const saved = settings.hangPresets || [];
  for (const p of [...BUILTIN(), ...saved]) {
    const b = document.createElement('button'); b.className = 'btn chip' + (p.x === x && p.y === y ? ' on' : ''); b.textContent = p.name; b.title = `${p.x}, ${p.y}`;
    b.onclick = () => { set({ hangX: p.x, hangY: p.y }); paintHang(); };
    box.append(b);
    if (saved.includes(p)) { const d = document.createElement('button'); d.className = 'btn chip del'; d.textContent = '×'; d.title = 'Delete preset'; d.onclick = () => { set({ hangPresets: saved.filter((q) => q.id !== p.id) }); paintHang(); }; box.append(d); }
  }
}
function nudgeHang(dx, dy) { set({ hangX: clampHang((settings.hangX ?? 0) + dx), hangY: clampHang((settings.hangY ?? 0) + dy) }); paintHang(); }
function openHang() {
  set({ hangPreview: true, overlayVisible: true });
  setView('hang');
  paintHang();
}
function closeHang() {
  const first = !settings.hangSetupDone;
  set({ hangPreview: false, hangSetupDone: true });
  setView(first ? 'home' : 'settings');
}
document.querySelectorAll('.h-pad [data-n]').forEach((b) => { const [dx, dy] = b.dataset.n.split(',').map(Number); holdRepeat(b, (shift) => { const k = shift ? 5 : 1; nudgeHang(dx * k, dy * k); }); });
$('#h-default').onclick = () => { set({ hangX: IS_MAC ? 10 : 11, hangY: IS_MAC ? 17 : 19 }); paintHang(); };
$('#h-save').onclick = () => {
  const name = ($('#h-name').value || '').trim() || `Position ${(settings.hangPresets || []).length + 1}`;
  set({ hangPresets: [...(settings.hangPresets || []), { id: 'p' + Date.now().toString(36), name, x: settings.hangX ?? 0, y: settings.hangY ?? 0 }] });
  $('#h-name').value = ''; paintHang();
};
$('#h-done').onclick = closeHang;
$('#hang-open').onclick = openHang;
$('#centre').onclick = openHang;

// ------------------------------------------------------------ wiring
document.querySelectorAll('#lib-view button').forEach((b) => b.addEventListener('click', () => { drawerFailed = false; set({ libraryView: b.dataset.v }); renderStrip(); }));
document.querySelectorAll('#type-filter button').forEach((b) => b.addEventListener('click', () => { cwd = null; set({ libraryType: b.dataset.t }); renderStrip(); }));
$('#gear').onclick = () => setView('settings');

// ------------------------------------------------------------ about + updates
let aboutInfo = null, upd = null;
const verText = (v) => 'version ' + v;
function paintUpdate(s) {
  upd = s; if (!s) return;
  const hasNew = s.status === 'available' || s.status === 'downloading' || s.status === 'installing' || s.status === 'ready';
  $('#about-dot').hidden = !(s.status === 'available');
  $('#about').title = s.status === 'available' ? 'About Cursor Rig: update ' + s.latest + ' is available' : 'About Cursor Rig and updates';
  const T = { unconfigured: ['Updates are not set up', 'This copy has no update source yet.'], checking: ['Checking for updates…', ''], idle: ['Not checked yet', ''], uptodate: ['You are up to date', 'You have the newest version (' + s.current + ').'],
    available: ['Update available: ' + s.latest, 'You have ' + s.current + '. The new version will replace the program files and restart. Your chains and settings are kept.'],
    downloading: ['Downloading ' + s.latest + '…', 'Please keep Cursor Rig open.'], installing: ['Installing…', ''], ready: ['Updated to ' + s.latest, 'Restarting Cursor Rig now…'], error: ['Could not check for updates', s.error || ''] };
  const [title, sub] = T[s.status] || ['', ''];
  $('#upd-title').textContent = title;
  $('#upd-sub').textContent = s.status === 'available' && s.error ? s.error : sub;
  $('#upd-dot').className = 'upd-dot' + (s.status === 'available' ? ' new' : s.status === 'downloading' || s.status === 'installing' || s.status === 'checking' ? ' busy' : s.status === 'error' || s.status === 'unconfigured' ? ' err' : '');
  $('#upd-bar').hidden = !(s.status === 'downloading' || s.status === 'installing'); $('#upd-fill').style.width = Math.round((s.progress || 0) * 100) + '%';
  const showNotes = s.status === 'available' && s.notes; $('#upd-notes').hidden = !showNotes; if (showNotes) $('#upd-notes').textContent = s.notes;
  $('#upd-go').hidden = s.status !== 'available';
  $('#upd-go').textContent = s.mode === 'external' ? 'Download ' + s.latest : 'Update to ' + s.latest;
  $('#upd-check').disabled = s.status === 'checking' || s.status === 'downloading' || s.status === 'installing' || s.status === 'ready' || s.status === 'unconfigured';
  $('#upd-note').textContent = s.status === 'unconfigured' ? 'To turn updates on, put the web address of your update.json in package.json under cursorRig.updateUrl (see PUBLISHING-UPDATES.md).' : s.checkedAt ? 'Last checked ' + new Date(s.checkedAt).toLocaleString() : '';
}
async function openAbout() {
  setView('about');
  try {
    aboutInfo = await api.aboutInfo();
    $('#a-name').textContent = aboutInfo.name; $('#a-ver').textContent = verText(aboutInfo.version);
    $('#a-desc').textContent = aboutInfo.description || '';
    $('#a-meta').textContent = [aboutInfo.credit && 'By ' + aboutInfo.credit, aboutInfo.license && aboutInfo.license + ' licence'].filter(Boolean).join(' · ');
    $('#a-home-row').hidden = !aboutInfo.homepage;
    $('#upd-auto').checked = !!aboutInfo.autoCheck;
    paintUpdate(aboutInfo.update);
  } catch (e) { $('#upd-title').textContent = 'About is unavailable'; }
}
$('#about').onclick = openAbout;
$('#a-back').onclick = () => setView('home');
$('#quit3').onclick = () => api.quit();
$('#a-data').onclick = () => api.openDataFolder();
$('#a-home').onclick = () => aboutInfo?.homepage && api.openLink(aboutInfo.homepage);
$('#upd-check').onclick = () => { paintUpdate({ ...(upd || {}), status: 'checking' }); api.checkUpdate().then(paintUpdate); };
$('#upd-go').onclick = () => api.applyUpdate().then(paintUpdate);
$('#upd-auto').onchange = (e) => set({ autoUpdateCheck: e.target.checked });
api.onUpdateState?.(paintUpdate);
api.aboutInfo?.().then((i) => { aboutInfo = i; paintUpdate(i.update); }).catch(() => {});
$('#s-back').onclick = () => setView('home');
$('#hide').onclick = () => api.hidePanel();
$('#quit').onclick = () => api.quit();
$('#quit2').onclick = () => api.quit();
$('#new').onclick = () => api.openEditor('__new__');
$('#import').onclick = async () => { const id = await api.importRig(); if (id) { selected = id; equip(id, true); } };
$('#folder').onclick = () => api.openDataFolder();
api.aboutInfo().then((i) => { if (i && i.samples === false) $('#defaults').style.display = 'none'; }).catch(() => {});
$('#defaults').onclick = () => { if (confirm('Restore the sample chains? Edits you made to them will be replaced.')) api.restoreDefaults(); };
$('#equip').onclick = () => equip(selected, !isEquipped(selected));
$('#f-new').onclick = newFolder;
$('#f-rename').onclick = () => cwd && renameFolder(cwd);
$('#move').onclick = moveSelected;

// ------------------------------------------------------------ inventory (opens on top of this menu)
let invOpen = false;
const INV_SIZE = [1120, 680];
function openInventory() {
  const f = $('#inv-frame');
  if (!f.getAttribute('src')) f.src = '../inventory/index.html?embed=1';
  invOpen = true; drawer.stop();
  api.setPanelSize(...INV_SIZE);
  $('#inv-layer').hidden = false; card.classList.add('inv-open');
  setTimeout(() => f.focus(), 50);
}
function closeInventory() {
  invOpen = false;
  $('#inv-layer').hidden = true; card.classList.remove('inv-open');
  api.setPanelSize(Math.max(760, settings.panelW || 760), HEIGHT[view] || HEIGHT.home);
  setView(view === 'home' ? 'home' : view);
}
$('#inv').onclick = openInventory;
api.onOpenInventory(() => { if (!invOpen) openInventory(); });
window.addEventListener('message', (e) => { if (e.data?.inv === 'close') closeInventory(); });
$('#edit').onclick = () => selected && openProfile(selected);
$('#search').addEventListener('input', (e) => { query = e.target.value; renderStrip(); });

// mouse wheel scrolls the strip sideways
strip.addEventListener('wheel', (e) => {
  if (strip.classList.contains('list')) return;       // the list scrolls up and down on its own
  // a mouse wheel scrolls up/down, a trackpad swipe sideways (or both): move the strip by whichever is larger
  const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const k = e.deltaMode === 1 ? 16 : 1;                // some mice report lines, not pixels
  if (d) { strip.scrollLeft += d * k; e.preventDefault(); }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (document.querySelector('.listening')) return;
  if (view === 'hang') {
    const k = e.shiftKey ? 5 : 1;
    const m = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[e.key];
    if (m) { e.preventDefault(); nudgeHang(...m); } else if (e.key === 'Escape' || e.key === 'Enter') closeHang();
    return;
  }
  if (e.key === 'Escape') { if (invOpen) { closeInventory(); return; } if (view === 'home') { if (query) { query = ''; $('#search').value = ''; renderStrip(); } else if (cwd) openFolder(FO.getFolder(folders(), cwd)?.parent || null); else api.hidePanel(); } else setView('home'); return; }
  if (view !== 'home' || e.target.matches('input')) return;
  const ids = listed().map((r) => r.id);
  const i = ids.indexOf(selected);
  if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && i < ids.length - 1) { e.preventDefault(); select(ids[i + 1]); }
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && i > 0) { e.preventDefault(); select(ids[i - 1]); }
  else if (e.key === 'Enter') equip(selected, true);
});

api.onSettings((s) => { const fo = JSON.stringify(settings.folders); settings = s; syncSettings(); mark(); if (view === 'profile') paintProfileNote(); if (JSON.stringify(s.folders) !== fo && view === 'home' && !invOpen) { if (cwd && !FO.getFolder(folders(), cwd)) cwd = null; renderStrip(); } });
api.onRigsChanged((d) => {
  rigs = d.rigs;
  rigs.forEach((r) => drawer.forget(r.id));   // a chain may have been edited: rebuild its live copy
  if (!rigById(selected)) selected = rigById(settings.activeRig) ? settings.activeRig : rigs[0]?.id ?? null;
  if (cwd && !FO.getFolder(folders(), cwd)) cwd = null;
  if (view === 'profile' && !rigById(profile?.id)) setView('home');
  renderStrip();
});

// ------------------------------------------------------------ start
const st = await api.state();
settings = st.settings; globals = st.globals; rigs = st.rigs;
if (st.platform === 'darwin') $('#row-login span').textContent = 'Open at login';
if (st.platform === 'linux') $('#row-login').remove();
selected = rigById(settings.activeRig) ? settings.activeRig : rigs[0]?.id ?? null;
syncSettings();
// first run of the folders update: file the known chains into the starter folders (new chains are never filed)
if (settings.foldersRev !== 2) {
  let f = settings.foldersSeeded ? FO.migrateFolders(folders(), rigs) : FO.starterFolders(rigs);
  if (!settings.foldersSeeded) for (const g of settings.groups || []) { const mem = (g.ids || []).filter((id) => rigExists(id) && !FO.folderOf(f, id)); if (!mem.length) continue; const o = FO.addFolder(f, g.name, null, FO.rigType(rigById(mem[0]))); f = FO.moveRigs(o.folders, mem.filter((id) => FO.rigType(rigById(id)) === o.folder.type), o.folder.id); }   // inventory groups become folders
  set({ folders: f, foldersSeeded: true, foldersRev: 2 });
}
// the Bloody Shooting chains are filed into their own folder the first time they show up (move or rename it freely after)
if (!settings.bloodyFiled && rigs.some((r) => String(r.id).startsWith('bs_'))) set({ folders: FO.fileBloody(folders(), rigs), bloodyFiled: true });
renderStrip();
api.setPanelHeight(HEIGHT.home);
if (!settings.hangSetupDone) openHang();   // first time: ask where chains should hang from


// ---- stretch the menu wider: drag the thin bar on its right-hand edge (width only; it never gets narrower than its normal size)
(function () {
  const grip = document.createElement('div');
  grip.className = 'w-grip'; grip.title = 'Drag to make this menu wider';
  card.appendChild(grip);
  let sx = 0, sw = 0, on = false;
  grip.addEventListener('pointerdown', (e) => { on = true; sx = e.screenX; sw = window.innerWidth; grip.setPointerCapture(e.pointerId); grip.classList.add('on'); e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => { if (on && !invOpen) api.setPanelWidth(Math.max(760, sw + (e.screenX - sx))); });
  const end = () => { if (!on) return; on = false; grip.classList.remove('on'); if (!invOpen) setTimeout(() => set({ panelW: Math.max(760, window.innerWidth) }), 60); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { api.setPanelWidth(760); setTimeout(() => set({ panelW: 760 }), 60); });
})();
