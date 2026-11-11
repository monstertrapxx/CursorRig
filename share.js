// Sharing formats for Cursor Rig.
//
//  .crig  (universal, current)  ZIP archive that holds ONE item or a WHOLE FOLDER of items:
//              manifest.json   format info, kind ('item' | 'folder'), name, the item list, a folder tree, model checksums
//              rigs/<n>.json   every rig, in the same v1 schema as saved rigs
//              models/<file>   raw model files
//              Cursorchains, cursorbits and cursor emitters all use it. The older formats below still open.
//
//  .cursorrig  (legacy, unchanged)  JSON file: the rig + an `embedded` map of
//              model filename -> base64. Read and written by every version.
//
//  .cursorchain  (new)  ZIP archive:
//              manifest.json   format info, name, author, model checksums
//              rig.json        the rig, in the SAME v1 schema as saved rigs
//              models/<file>   raw model files (no base64 overhead)
//
// Because rig.json is the unchanged schema, a .cursorchain can always be
// downgraded to a .cursorrig (and vice versa) without losing anything.
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { zipSync, unzipSync, strToU8, strFromU8, Zip, ZipPassThrough, ZipDeflate } = require('fflate');

const KEY_FORMAT = 'cursor-rig-keychain';
const KEY_VERSION = 1;
const MODEL_EXTS = new Set(['.glb', '.gltf', '.obj', '.stl']);
const LIMITS = { files: 200, totalBytes: 150 * 1024 * 1024, jsonBytes: 8 * 1024 * 1024 };

const safeModelName = (n) => path.basename(String(n)).replace(/[^a-zA-Z0-9_.\-]/g, '_');
const hasModelExt = (n) => MODEL_EXTS.has(path.extname(n).toLowerCase());
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function modelNames(rig) {
  const set = new Set();
  const add = (a) => { if (a && a.kind === 'model' && a.model) set.add(a.model); };
  (rig.anchor?.attachments || []).forEach(add);
  (rig.segments || []).forEach((s) => (s.attachments || []).forEach(add));
  return [...set];
}

// ------------------------------------------------------------ legacy format

function packLegacy(rig, modelsDir) {
  const embedded = {};
  for (const m of modelNames(rig)) {
    try { embedded[m] = fs.readFileSync(path.join(modelsDir, path.basename(m))).toString('base64'); } catch {}
  }
  return Buffer.from(JSON.stringify({ ...rig, embedded }));
}

// -------------------------------------------------------------- new format

function packKeychain(rig, modelsDir, meta = {}) {
  const files = {};
  const models = [];
  for (const m of modelNames(rig)) {
    const name = path.basename(m);
    let data;
    try { data = fs.readFileSync(path.join(modelsDir, name)); } catch { continue; }
    files['models/' + name] = [new Uint8Array(data), { level: 6 }];
    models.push({ file: name, bytes: data.length, sha256: sha256(data) });
  }
  const manifest = {
    format: KEY_FORMAT,
    formatVersion: KEY_VERSION,
    rigSchema: rig.version ?? 1,
    name: rig.name || 'Untitled rig',
    author: meta.author || '',
    appVersion: meta.appVersion || '',
    created: new Date().toISOString(),
    models,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  files['rig.json'] = strToU8(JSON.stringify(rig));
  return Buffer.from(zipSync(files));
}

function unpackKeychain(buf) {
  let count = 0, total = 0;
  const entries = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      count++; total += f.originalSize;
      if (count > LIMITS.files) throw new Error('Keychain file has too many entries.');
      if (total > LIMITS.totalBytes) throw new Error('Keychain file is too large when unpacked.');
      return true;
    },
  });
  const need = (n) => { if (!entries[n]) throw new Error('Not a valid keychain file (missing ' + n + ').'); return entries[n]; };
  const mBytes = need('manifest.json'), rBytes = need('rig.json');
  if (mBytes.length > LIMITS.jsonBytes || rBytes.length > LIMITS.jsonBytes) throw new Error('Keychain file is malformed.');
  const manifest = JSON.parse(strFromU8(mBytes));
  if (manifest.format !== KEY_FORMAT) throw new Error('Not a Cursor Rig keychain file.');
  if (!(manifest.formatVersion >= 1)) throw new Error('Unreadable keychain version.');
  if (manifest.formatVersion > KEY_VERSION) throw new Error('This keychain was made with a newer Cursor Rig. Please update the app.');
  const rig = JSON.parse(strFromU8(rBytes));
  const models = {};
  for (const [p, data] of Object.entries(entries)) {
    if (!p.startsWith('models/') || p.endsWith('/')) continue;
    const name = safeModelName(p.slice('models/'.length));
    if (!hasModelExt(name)) continue; // ignore anything that is not a model
    const buf2 = Buffer.from(data);
    const listed = (manifest.models || []).find((m) => safeModelName(m.file) === name);
    if (listed?.sha256 && listed.sha256 !== sha256(buf2)) throw new Error('Model "' + name + '" is corrupted.');
    models[name] = buf2;
  }
  return { rig, manifest, models };
}

function unpackLegacy(text) {
  const rig = JSON.parse(text);
  const models = {};
  for (const [name, b64] of Object.entries(rig.embedded || {})) {
    const n = safeModelName(name);
    if (hasModelExt(n)) models[n] = Buffer.from(b64, 'base64');
  }
  delete rig.embedded;
  return { rig, manifest: null, models };
}


// ------------------------------------------------------------ .crig (universal)

const CRIG_FORMAT = 'cursor-rig-crig';
const CRIG_VERSION = 1;
const CRIG_LIMITS = { files: 8000, totalBytes: 1500 * 1024 * 1024, jsonBytes: 8 * 1024 * 1024 };

// A folder tree as saved in a .crig: { name, type, icon?, ids: [rigId], folders: [ ...same ] }
function cleanTree(t, depth = 0) {
  if (!t || typeof t !== 'object' || depth > 8) return null;
  const out = {
    name: String(t.name || 'Folder').trim().slice(0, 40) || 'Folder',
    type: ['chain', 'orbit', 'particles', 'all'].includes(t.type) ? t.type : 'chain',      // 'all' = a shared folder (shows on all 3 tabs)
    ids: (Array.isArray(t.ids) ? t.ids : []).map(String).slice(0, 2000),
    folders: (Array.isArray(t.folders) ? t.folders : []).slice(0, 500).map((f) => cleanTree(f, depth + 1)).filter(Boolean),
  };
  if (typeof t.icon === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(t.icon) && t.icon.length < 700000) out.icon = t.icon;
  return out;
}

// A .crig can hold any mix: loose cursorchains, cursorbits and cursor emitters, and any number of packs (folders) of any kind.
// `folders` is the list of top-level packs; `folder` (the first one) is kept so older builds of this app still read single packs.
const treesOf = (opts) => (Array.isArray(opts.folders) ? opts.folders : opts.folder ? [opts.folder] : []).map((t) => cleanTree(t)).filter(Boolean);
function manifestOf(opts, trees, list, models) {
  const kinds = new Set(list.map((i) => i.type));
  return {
    format: CRIG_FORMAT, formatVersion: CRIG_VERSION,
    kind: trees.length === 1 && kinds.size === 1 && opts.kind !== 'collection' ? 'folder' : trees.length || kinds.size > 1 || list.length > 1 ? 'collection' : 'item',
    name: opts.name || trees[0]?.name || list[0]?.name || 'Cursor Rig', author: opts.author || '', appVersion: opts.appVersion || '',
    created: new Date().toISOString(), items: list, folder: trees[0] || null, folders: trees, models,
  };
}

// items: [rig, ...]   opts: { name, folder: tree|null, appVersion, author }   -> Buffer (the .crig bytes)
function packCrig(items, modelsDir, opts = {}) {
  const files = {}, models = [], seen = new Set(), list = [];
  items.forEach((rig, i) => {
    const file = 'rigs/r' + i + '.json';
    files[file] = strToU8(JSON.stringify(rig));
    list.push({ file, id: rig.id, name: rig.name || 'Untitled', type: rig.type === 'orbit' || rig.type === 'particles' ? rig.type : 'chain' });
    for (const m of modelNames(rig)) {
      const name = path.basename(m);
      if (seen.has(name)) continue; seen.add(name);
      let data; try { data = fs.readFileSync(path.join(modelsDir, name)); } catch { continue; }
      files['models/' + name] = [new Uint8Array(data), { level: 0 }];   // glb/stl are already dense: store, don't squeeze
      models.push({ file: name, bytes: data.length, sha256: sha256(data) });
    }
  });
  const trees = treesOf(opts);
  files['manifest.json'] = strToU8(JSON.stringify(manifestOf(opts, trees, list, models), null, 1));
  return Buffer.from(zipSync(files));
}

// Same file as packCrig, but written straight to disk one model at a time, so a big pack (hundreds of cursors, lots of models)
// never has to sit in memory at once. onProgress(0..1) is called as it goes. Resolves with { items, models, bytes }.
function packCrigToFile(items, modelsDir, opts, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    let done = false, bytes = 0;
    const fail = (e) => { if (done) return; done = true; try { out.destroy(); } catch {} try { fs.unlinkSync(filePath); } catch {} reject(e); };
    out.on('error', fail);
    out.on('finish', () => { if (!done) { done = true; resolve({ items: items.length, models: models.length, bytes }); } });
    const models = [], seen = new Set(), list = [];
    const zip = new Zip((err, chunk, final) => {
      if (err) return fail(err);
      bytes += chunk.length;
      out.write(Buffer.from(chunk));
      if (final) out.end();
    });
    const addJson = (name, str) => { const f = new ZipDeflate(name, { level: 6 }); zip.add(f); f.push(strToU8(str), true); };
    try {
      items.forEach((rig, i) => {
        const file = 'rigs/r' + i + '.json';
        addJson(file, JSON.stringify(rig));
        list.push({ file, id: rig.id, name: rig.name || 'Untitled', type: rig.type === 'orbit' || rig.type === 'particles' ? rig.type : 'chain' });
      });
      const names = [];
      for (const rig of items) for (const m of modelNames(rig)) { const n = path.basename(m); if (!seen.has(n)) { seen.add(n); names.push(n); } }
      let k = 0;
      for (const name of names) {
        let data; try { data = fs.readFileSync(path.join(modelsDir, name)); } catch { continue; }
        const f = new ZipPassThrough('models/' + name); zip.add(f); f.push(new Uint8Array(data), true);
        models.push({ file: name, bytes: data.length, sha256: sha256(data) });
        k++; if (onProgress) onProgress(k / (names.length + 1));
      }
      const trees = treesOf(opts);
      addJson('manifest.json', JSON.stringify(manifestOf(opts, trees, list, models), null, 1));
      zip.end();
      if (onProgress) onProgress(1);
    } catch (e) { fail(e); }
  });
}

function unpackCrig(buf, preloaded) {
  let count = 0, total = 0;
  const entries = preloaded || unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      count++; total += f.originalSize;
      if (count > CRIG_LIMITS.files) throw new Error('This .crig has too many files in it.');
      if (total > CRIG_LIMITS.totalBytes) throw new Error('This .crig is too large when unpacked.');
      return true;
    },
  });
  if (!entries['manifest.json']) throw new Error('Not a valid .crig file (no manifest).');
  if (entries['manifest.json'].length > CRIG_LIMITS.jsonBytes) throw new Error('This .crig is malformed.');
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  if (manifest.format !== CRIG_FORMAT) throw new Error('Not a Cursor Rig .crig file.');
  if (!(manifest.formatVersion >= 1)) throw new Error('Unreadable .crig version.');
  if (manifest.formatVersion > CRIG_VERSION) throw new Error('This .crig was made with a newer Cursor Rig. Please update the app.');
  const items = [];
  for (const it of (manifest.items || []).slice(0, 2000)) {
    const f = String(it.file || '');
    if (!/^rigs\/r\d+\.json$/.test(f) || !entries[f]) continue;
    if (entries[f].length > CRIG_LIMITS.jsonBytes) throw new Error('A cursorchain inside this .crig is malformed.');
    const rig = JSON.parse(strFromU8(entries[f]));
    if (rig && typeof rig === 'object' && Array.isArray(rig.segments || [])) items.push(rig);
  }
  if (!items.length) throw new Error('This .crig has nothing in it.');
  const models = {};
  for (const [p, data] of Object.entries(entries)) {
    if (!p.startsWith('models/') || p.endsWith('/')) continue;
    const name = safeModelName(p.slice('models/'.length));
    if (!hasModelExt(name)) continue;
    const b = Buffer.from(data);
    const listed = (manifest.models || []).find((m) => safeModelName(m.file) === name);
    if (listed?.sha256 && listed.sha256 !== sha256(b)) throw new Error('Model "' + name + '" inside this .crig is corrupted.');
    models[name] = b;
  }
  const trees = (Array.isArray(manifest.folders) ? manifest.folders : manifest.folder ? [manifest.folder] : []).slice(0, 500).map((t) => cleanTree(t)).filter(Boolean);
  return { kind: manifest.kind === 'folder' || manifest.kind === 'collection' ? manifest.kind : 'item', name: String(manifest.name || items[0].name || 'Cursor Rig').slice(0, 80), items, folder: trees[0] || null, folders: trees, models, manifest };
}

// ---------------------------------------------------------------- import safety
// Everything that comes out of a file someone else made is treated as untrusted. A cursorchain is only DATA (numbers, colours,
// names, model file names), so the importer rebuilds it into plain data and throws away anything that isn't: odd keys, links,
// file paths, over-long text, absurd sizes, and model files that point at anything outside themselves.
const SAFE_LIMITS = { depth: 14, nodes: 250000, str: 2000, arr: 6000, num: 1e7, model: 250 * 1024 * 1024 };
const BAD_KEY = /^(__proto__|constructor|prototype)$/;
const BAD_URL = /^\s*(?:(?:https?|ftp|file|javascript|vbscript|data|blob|wss?|rigapp|chrome|about):|\/\/|\\\\|~\/|[a-z]:[\\/])/i;     // web / file / script addresses, network paths, home or drive paths
const IMG_URI = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function cleanText(s, max = SAFE_LIMITS.str) { return String(s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').slice(0, max); }

function cleanData(v, st, depth = 0) {
  if (++st.n > SAFE_LIMITS.nodes || depth > SAFE_LIMITS.depth) throw new Error('This file is too complicated to be a normal cursorchain, so it was not imported.');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(-SAFE_LIMITS.num, Math.min(SAFE_LIMITS.num, v)) : 0;
  if (typeof v === 'string') {
    if (IMG_URI.test(v) && v.length < 700000) return v;
    if (BAD_URL.test(v)) return '';
    return cleanText(v);
  }
  if (Array.isArray(v)) return v.slice(0, SAFE_LIMITS.arr).map((x) => cleanData(x, st, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).slice(0, 400)) {
      if (BAD_KEY.test(k) || k.length > 60) continue;
      o[cleanText(k, 60)] = cleanData(v[k], st, depth + 1);
    }
    return o;
  }
  return null;   // functions, undefined, symbols ...
}

function sanitizeRig(rig) {
  const out = cleanData(rig, { n: 0 });
  if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Error('Not a cursorchain.');
  const fix = (list) => (Array.isArray(list) ? list : []).filter((a) => {
    if (!a || typeof a !== 'object') return false;
    if (a.kind === 'model') {
      const n = safeModelName(a.model || '');
      if (!n || !hasModelExt(n)) return false;      // a model attachment that doesn't name a plain model file is dropped
      a.model = n;
    }
    return true;
  });
  if (out.anchor && typeof out.anchor === 'object') out.anchor.attachments = fix(out.anchor.attachments);
  out.segments = (Array.isArray(out.segments) ? out.segments : []).filter((s) => s && typeof s === 'object').map((s) => { s.attachments = fix(s.attachments); return s; });
  out.name = cleanText(out.name || 'Cursor Rig', 80).trim() || 'Cursor Rig';
  return out;
}

// A model must be a real model of its own type and must not reference files or web addresses.
function checkModel(name, buf) {
  const ext = path.extname(name).toLowerCase();
  if (buf.length > SAFE_LIMITS.model) throw new Error('Model "' + name + '" is too large.');
  const noExternal = (j) => {
    for (const k of ['buffers', 'images']) for (const x of (j[k] || [])) if (x && typeof x.uri === 'string' && !/^data:/i.test(x.uri)) throw new Error('Model "' + name + '" tries to load an outside file, so it was not imported.');
  };
  if (ext === '.glb') {
    if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('Model "' + name + '" is not a real .glb.');
    const len = buf.readUInt32LE(12);
    if (buf.toString('latin1', 16, 20) !== 'JSON' || len > buf.length) throw new Error('Model "' + name + '" is not a real .glb.');
    let j; try { j = JSON.parse(buf.toString('utf8', 20, 20 + len)); } catch { throw new Error('Model "' + name + '" is damaged.'); }
    noExternal(j);
  } else if (ext === '.gltf') {
    let j; try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('Model "' + name + '" is damaged.'); }
    noExternal(j);
  } else if (ext === '.obj' || ext === '.stl') { /* plain geometry, nothing that can reference other files is loaded */ }
  else throw new Error('Unsupported model type: ' + name);
}

// Run on EVERY imported package (.crig, .cursorchain, .cursorrig, .json): rebuild the rigs, check the models and the folder icons.
function sanitizePackage(pk) {
  pk.items = pk.items.map(sanitizeRig);
  for (const [n, b] of Object.entries(pk.models || {})) checkModel(n, b);
  const keepIcons = (t) => { if (t && typeof t.icon === 'string' && !IMG_URI.test(t.icon)) delete t.icon; (t?.folders || []).forEach(keepIcons); };
  keepIcons(pk.folder); (pk.folders || []).forEach(keepIcons);
  pk.name = cleanText(pk.name || 'Cursor Rig', 80).trim() || 'Cursor Rig';
  delete pk.manifest;
  return pk;
}

// Opens ANY supported file (.crig, .cursorchain, .cursorrig) and always answers in the same shape:
// { kind: 'item' | 'folder', name, items: [rig], folder: tree|null, models: { file: Buffer } }
function unpackFileRaw(buf) {
  if (buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b) {
    let count = 0, total = 0;
    const entries = unzipSync(new Uint8Array(buf), { filter: (f) => { count++; total += f.originalSize; if (count > CRIG_LIMITS.files) throw new Error('Too many files in this archive.'); if (total > CRIG_LIMITS.totalBytes) throw new Error('This file is too large when unpacked.'); return true; } });
    let fmt = null; try { fmt = JSON.parse(strFromU8(entries['manifest.json'] || new Uint8Array())).format; } catch {}
    if (fmt === CRIG_FORMAT) return unpackCrig(buf, entries);
    const k = unpackKeychain(buf);
    return { kind: 'item', name: k.rig.name || 'Cursor Rig', items: [k.rig], folder: null, models: k.models, manifest: k.manifest };
  }
  const l = unpackLegacy(buf.toString('utf8'));
  return { kind: 'item', name: l.rig.name || 'Cursor Rig', items: [l.rig], folder: null, models: l.models, manifest: null };
}

function unpackFile(buf) { return sanitizePackage(unpackFileRaw(buf)); }

// Detects the format from the bytes, not the extension (a ZIP starts with "PK").
function unpackAny(buf) {
  if (buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b) return unpackKeychain(buf);
  return unpackLegacy(buf.toString('utf8'));
}

module.exports = {
  KEY_FORMAT, KEY_VERSION, CRIG_FORMAT, CRIG_VERSION, modelNames, safeModelName,
  packLegacy, packKeychain, unpackKeychain, unpackLegacy, unpackAny, packCrig, packCrigToFile, unpackCrig, unpackFile, cleanTree, sanitizeRig, sanitizePackage, checkModel,
};
