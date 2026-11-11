// Builds the separate "starter pack" .crig from default-rigs/ (the cursorchains, cursorbits and cursor emitters that no longer ship inside the app):
//   npm run starter-crig        ->  release-extras/Cursor-Rig-Starter-Pack.crig
// Attach it to the GitHub release; people import it with Import in the menu (or just double-click it).
// To ship your own collection instead, use Export all in the app's menu and put that .crig in release-extras/.
'use strict';
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
const share = require(path.join(root, 'share.js'));
(async () => {
  const FO = await import(pathToFileURL(path.join(root, 'src/shared/folders.js')).href);
  const dir = path.join(root, 'default-rigs');
  if (!fs.existsSync(dir)) { console.error('default-rigs/ not found'); process.exit(1); }
  const rigs = [];
  for (const f of fs.readdirSync(dir).sort()) { if (!/\.json$/i.test(f)) continue; try { const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (r && r.id && Array.isArray(r.segments)) rigs.push(r); } catch {} }
  const folders = FO.fileBloody(FO.starterFolders(rigs), rigs);
  const tree = (f, depth = 0) => ({ name: f.name, type: f.type || 'chain', ids: (f.ids || []).filter((id) => rigs.some((r) => r.id === id)), folders: depth < 8 ? folders.filter((c) => c.parent === f.id).map((c) => tree(c, depth + 1)) : [], ...(f.icon ? { icon: f.icon } : {}) });
  const trees = folders.filter((f) => !f.parent).map((f) => tree(f)).filter((t) => t.ids.length || t.folders.length);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const buf = share.packCrig(rigs, path.join(dir, 'models'), { name: 'Cursor Rig Starter Pack', folders: trees, kind: 'collection', appVersion: pkg.version, author: (pkg.cursorRig && pkg.cursorRig.credit) || '' });
  const out = path.join(root, 'release-extras'); fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'Cursor-Rig-Starter-Pack.crig'); fs.writeFileSync(file, buf);
  console.log(`Wrote release-extras/Cursor-Rig-Starter-Pack.crig  (${rigs.length} items, ${trees.length} folders, ${(buf.length / 1048576).toFixed(1)} MB)`);
})();
