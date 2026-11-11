// Builds Cursor Rig for Windows 7 / 8 / 8.1 (and any older PC).
//
// Electron 23+ needs Windows 10, so the old-Windows build uses Electron 22 (the last one that runs on
// Windows 7/8/8.1) and three.js r160 (the last version that still falls back to WebGL 1 on old graphics).
// The app code is the same; main.js and rig-core.js already handle the older versions.
//
//   npm run dist:win-legacy              build the zips (needs internet; run on Windows or macOS)
//   node scripts/build-legacy.js --prepare-only    just create dist-legacy/ and stop
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..');
const out = process.env.LEGACY_OUT || path.join(root, 'dist-legacy');
const prepareOnly = process.argv.includes('--prepare-only');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['main.js', 'preload.js', 'share.js', 'feel.js']) fs.copyFileSync(path.join(root, f), path.join(out, f));
// plain recursive copy (fs.cpSync copies folder permissions, which some synced/shared folders refuse)
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
};
for (const d of ['src', 'default-rigs', 'assets']) copyDir(path.join(root, d), path.join(out, d));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const legacy = {
  name: pkg.name, productName: pkg.productName, version: pkg.version + '-legacy', description: pkg.description,
  main: 'main.js', author: pkg.author, license: pkg.license,
  dependencies: { fflate: pkg.dependencies.fflate, three: '0.160.0' },
  devDependencies: { electron: '22.3.27', 'electron-builder': '24.13.3' },
  build: {
    ...pkg.build,
    directories: { output: 'release' },
    win: { icon: 'assets/icon.ico', target: [{ target: 'zip', arch: ['ia32', 'x64'] }], signAndEditExecutable: false },
    artifactName: '${productName}-legacy-${arch}.${ext}',
  },
};
delete legacy.build.mac; delete legacy.build.linux;
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(legacy, null, 2));
console.log('Prepared dist-legacy/ (Electron 22.3.27, three 0.160.0)');
if (prepareOnly) process.exit(0);

const run = (cmd) => cp.execSync(cmd, { cwd: out, stdio: 'inherit' });
run('npm install');
run('npx electron-builder --win zip --ia32 --x64');
console.log('Done: dist-legacy/release/ has a 32-bit and a 64-bit zip. Unzip and run "Cursor Rig.exe".');
