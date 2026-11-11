// Builds the update files:  node scripts/make-update-zip.js  [--base-url https://your-site/updates/]  [--with-modules]
// Write what is new in RELEASE-NOTES.txt (next to package.json) first; it is shown to people before they update.
// Output: dist/cursor-rig-update-v<version>.zip  (the version comes from package.json, bump it first).
// It holds the program's files only: your users' chains, models and settings live in their own data folder and are never in here.
// --with-modules also includes three.js and fflate (only needed when you upgrade those libraries).
'use strict';
const fs = require('fs'), path = require('path');
const { zipSync } = require('fflate');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const withModules = process.argv.includes('--with-modules');
const files = {};
const skip = /(^|\/)(\.DS_Store|debug-[^/]*|\.update-[^/]*|_to_delete)(\/|$)/;
const add = (rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) { for (const f of fs.readdirSync(abs)) add(path.posix.join(rel, f)); return; }
  if (skip.test(rel)) return;
  files[rel] = [new Uint8Array(fs.readFileSync(abs)), { level: /\.(glb|png|jpg|jpeg|zip)$/i.test(rel) ? 0 : 6, mtime: st.mtime }];
};
['main.js', 'preload.js', 'share.js', 'feel.js', 'updater.js', 'package.json', 'package-lock.json', 'README.md', 'Start Cursor Rig.command', 'Start Cursor Rig.bat', 'src', 'assets'].forEach(add);
if (withModules) ['node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js', 'node_modules/three/examples/jsm', 'node_modules/fflate'].forEach(add);
if (!files['main.js'] || !files['package.json']) { console.error('main.js / package.json not found'); process.exit(1); }
const out = path.join(root, 'dist'); fs.mkdirSync(out, { recursive: true });
const name = `cursor-rig-update-v${pkg.version}.zip`;
const zipBuf = Buffer.from(zipSync(files));
fs.writeFileSync(path.join(out, name), zipBuf);
const mb = (fs.statSync(path.join(out, name)).size / 1048576).toFixed(1);
// the small file the app reads to learn a new version exists. Upload it (and the zip) to your web host.
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
const base = (arg('--base-url') || '').replace(/\/?$/, '/');
let notes = ''; try { notes = fs.readFileSync(path.join(root, 'RELEASE-NOTES.txt'), 'utf8').trim(); } catch {}
// sign it: the app only installs an update whose signature matches (see scripts/make-keys.js). The key comes from the UPDATE_SIGNING_KEY
// environment variable (GitHub builds) or from .signing/update-private.pem on your computer.
let keyPem = process.env.UPDATE_SIGNING_KEY || '';
if (!keyPem) { try { keyPem = fs.readFileSync(path.join(root, '.signing', 'update-private.pem'), 'utf8'); } catch {} }
if (!keyPem) { console.error('No signing key. Run  npm run make-keys  once (an update without a signature would be refused by every copy of the app).'); process.exit(1); }
const sha = crypto.createHash('sha256').update(zipBuf).digest('hex');
const sigObj = { version: pkg.version, sha256: sha, sig: crypto.sign(null, Buffer.from('cursor-rig-update\n' + pkg.version + '\n' + sha), crypto.createPrivateKey(keyPem)).toString('base64') };
const pub = crypto.createPublicKey(crypto.createPrivateKey(keyPem)).export({ type: 'spki', format: 'der' }).toString('base64');
if (pkg.cursorRig && pkg.cursorRig.updateKey && pkg.cursorRig.updateKey !== pub) { console.error('The signing key does not match cursorRig.updateKey in package.json, so the app would refuse this update.'); process.exit(1); }
fs.writeFileSync(path.join(out, name + '.sig'), JSON.stringify(sigObj) + '\n');
const manifest = { version: pkg.version, notes, date: new Date().toISOString().slice(0, 10), zip: arg('--base-url') ? base + name : 'PUT-THE-WEB-ADDRESS-OF-THE-ZIP-HERE', sig: arg('--base-url') ? base + name + '.sig' : 'PUT-THE-WEB-ADDRESS-OF-THE-SIG-FILE-HERE' };
fs.writeFileSync(path.join(out, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote dist/update.json  (version ${pkg.version}${arg('--base-url') ? '' : ', edit "zip" to the zip\'s web address, or run again with --base-url https://your-site/updates/'})`);
console.log(`Wrote dist/${name}.sig  (the signature; upload it next to the zip)`);
console.log(`Wrote dist/${name}  (${Object.keys(files).length} files, ${mb} MB)`);
console.log('Next: upload both files to your web host (same folder), and make sure package.json cursorRig.updateUrl points at update.json.');
