// Folders for the menu and the inventory. Pure functions: each takes the folder list and returns a new one.
// A folder is { id, name, parent: folderId|null, ids: [rigIds] }. A chain lives in at most one folder.
// Chains in no folder show on the main menu itself. Folders are saved in the app settings, never inside a chain file.

// The three kinds of cursorchain are the top-level areas. They are not folders: folders live inside an area.
export const AREAS = [['chain', 'Cursorchains'], ['orbit', 'Cursorbits'], ['particles', 'Cursor Emitters']];
export const areaName = (t) => (t === 'all' ? 'Shared folders' : (AREAS.find((a) => a[0] === t) || AREAS[0])[1]);
export const rigType = (r) => r?.type || 'chain';
export const typeOfFolder = (folders, id) => getFolder(folders, id)?.type || 'chain';

export const folderId = () => 'f_' + Math.random().toString(36).slice(2, 8);
const clean = (n) => String(n || '').trim().slice(0, 40);
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export const getFolder = (folders, id) => folders.find((f) => f.id === id) || null;
export const childrenOf = (folders, parent = null, type = null) => folders.filter((f) => (f.parent || null) === (parent || null) && (!type || (f.type || 'chain') === type || f.type === 'all')).sort(byName);   // a shared folder (type 'all') shows on every tab, but each tab only lists its own kind of chain inside it
export const folderOf = (folders, rigId) => folders.find((f) => (f.ids || []).includes(rigId)) || null;
export const rigsIn = (folders, id) => (getFolder(folders, id)?.ids || []);

export function pathOf(folders, id) {          // root first
  const out = []; let f = getFolder(folders, id), guard = 0;
  while (f && guard++ < 32) { out.unshift(f); f = getFolder(folders, f.parent); }
  return out;
}
export function descendantIds(folders, id) {   // the folder's own id plus every folder inside it
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const f of folders) if (f.parent === out[i] && !out.includes(f.id)) out.push(f.id);
  return out;
}
export function countIn(folders, id, exists = () => true) {   // chains inside, counting sub-folders
  const set = new Set();
  for (const d of descendantIds(folders, id)) for (const r of getFolder(folders, d)?.ids || []) if (exists(r)) set.add(r);
  return set.size;
}
export function flatTree(folders, parent = null, depth = 0, type = null) {  // [{ folder, depth }] in display order (type limits the top level)
  const out = [];
  for (const f of childrenOf(folders, parent, parent ? null : type)) { out.push({ folder: f, depth }); out.push(...flatTree(folders, f.id, depth + 1)); }
  return out;
}

export function addFolder(folders, name, parent = null, type = 'chain') {
  const f = { id: folderId(), name: clean(name) || 'New folder', parent: parent || null, type: parent ? typeOfFolder(folders, parent) : type, ids: [] };
  return { folders: [...folders, f], folder: f };
}
export const setFolderIcon = (folders, id, icon) => folders.map((f) => { if (f.id !== id) return f; const o = { ...f }; if (icon) o.icon = icon; else delete o.icon; return o; });
export const renameFolder = (folders, id, name) => folders.map((f) => (f.id === id && clean(name) ? { ...f, name: clean(name) } : f));

export function deleteFolder(folders, id) {    // nothing is lost: chains and sub-folders move up one level
  const f = getFolder(folders, id); if (!f) return folders;
  return folders.filter((x) => x.id !== id).map((x) => {
    if (x.parent === id) x = { ...x, parent: f.parent || null };
    if (x.id === f.parent) x = { ...x, ids: [...new Set([...(x.ids || []), ...(f.ids || [])])] };
    return x;
  });
}
export function moveRigs(folders, rigIds, target) {   // target null = out of every folder (back on the main menu)
  const set = new Set(rigIds);
  return folders.map((f) => {
    const kept = (f.ids || []).filter((i) => !set.has(i));
    return f.id === target ? { ...f, ids: [...new Set([...kept, ...rigIds])] } : { ...f, ids: kept };
  });
}
export function moveFolder(folders, id, target) {  // refuses to put a folder inside itself
  if (target && descendantIds(folders, id).includes(target)) return folders;
  return folders.map((f) => (f.id === id ? { ...f, parent: target || null } : f));
}

// The first-run layout. Only the two chain folders are made; Cursorchains, Cursorbits and Cursor Emitters are the areas themselves.
// Anything not listed, and anything new, stays loose in its area.
const OG = ['bead string', 'chrome flail', 'fox tail', 'keychain', 'rope lantern', 'steel chain', 'tabby cat keychain', 'wind chime', 'wooden ragdoll'];
export function starterFolders(rigs) {
  const norm = (r) => String(r.name || '').trim().toLowerCase();
  const pick = (test) => rigs.filter((r) => rigType(r) === 'chain' && test(norm(r))).map((r) => r.id);
  return [
    { id: 'f_og', name: 'Cursor Rig OG Pack', parent: null, type: 'chain', ids: pick((n) => OG.includes(n) || n.includes('mario') || n.includes('kuma')) },
    { id: 'f_kinsectz', name: 'Kinsectz Cursor Rig', parent: null, type: 'chain', ids: pick((n) => n.includes('wasp')) },
  ].filter((f) => f.ids.length);      // a fresh copy with nothing in it gets no folders at all
}
// Upgrade folders saved by the first folders update (where the three areas were made as folders).
export function migrateFolders(folders, rigs) {
  const old = new Set(['f_chains', 'f_bits', 'f_emit']);
  const byId = new Map(rigs.map((r) => [r.id, r]));
  let out = folders.filter((f) => !old.has(f.id)).map((f) => ({ ...f, parent: old.has(f.parent) ? null : f.parent }));
  const typeFor = (f) => {                                  // a folder takes the type of the chains inside it
    if (f.type) return f.type;
    const c = {}; for (const id of f.ids || []) { const t = rigType(byId.get(id)); c[t] = (c[t] || 0) + 1; }
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || 'chain';
  };
  out = out.map((f) => ({ ...f, type: typeFor(f) }));
  const by = new Map(out.map((f) => [f.id, f]));
  const own = (f) => { let g = f, n = 0; while (g.parent && by.get(g.parent) && n++ < 16) g = by.get(g.parent); return g.type; };
  out = out.map((f) => ({ ...f, type: f.parent ? own(f) : f.type }));
  const have = new Set(out.map((f) => f.id));
  for (const s of starterFolders(rigs)) if (!have.has(s.id)) out.push({ ...s, ids: s.ids.filter((id) => !out.some((f) => (f.ids || []).includes(id))) });
  return out;
}

// Chains made from the Bloody Shooting models (ids start with bs_) go in their own "Bloody Shooting" folder, once.
export function fileBloody(folders, rigs) {
  const ids = rigs.filter((r) => String(r.id).startsWith('bs_')).map((r) => r.id);
  if (!ids.length) return folders;
  const taken = new Set(folders.flatMap((f) => f.ids || []));
  const free = ids.filter((id) => !taken.has(id));
  if (folders.some((f) => f.id === 'f_bloody')) return folders.map((f) => (f.id === 'f_bloody' ? { ...f, ids: [...(f.ids || []), ...free] } : f));
  return [...folders, { id: 'f_bloody', name: 'Bloody Shooting', parent: null, type: 'chain', ids: free }];
}

// ---- shared folders and deleting a folder with everything in it
export const fits = (folders, folderId, rig) => { const t = folderId ? typeOfFolder(folders, folderId) : null; return !t || t === 'all' || rigType(rig) === t; };   // may this chain go in that folder?
export function setFolderType(folders, id, type, rigOf = () => null) {      // the folder and everything inside it takes the type; going from shared to one tab takes the other kinds of chain out (they go back to their own tab's main menu)
  const sub = new Set(descendantIds(folders, id));
  return folders.map((f) => (sub.has(f.id) ? { ...f, type, ids: type === 'all' ? (f.ids || []) : (f.ids || []).filter((r) => { const g = rigOf(r); return !g || rigType(g) === type; }) } : f));
}
export const removeFolders = (folders, ids) => { const gone = new Set(ids); return folders.filter((f) => !gone.has(f.id)); };
export function everythingIn(folders, id) {       // { folderIds, rigIds } for a folder, every sub-folder and every chain in them
  const folderIds = descendantIds(folders, id), rigIds = new Set();
  for (const d of folderIds) for (const r of getFolder(folders, d)?.ids || []) rigIds.add(r);
  return { folderIds, rigIds: [...rigIds] };
}
