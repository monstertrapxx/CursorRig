// Zips dist/win-unpacked into dist/Cursor-Rig-Windows-v<version>.zip for sending to someone: unzip anywhere writable, run "Cursor Rig.exe".
'use strict';
const fs = require('fs'), path = require('path'), { zipSync } = require('fflate');
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const src = path.join(root, 'dist', 'win-unpacked');
if (!fs.existsSync(src)) { console.error('dist/win-unpacked not found'); process.exit(1); }
const files = {};
const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name), r = rel + e.name; if (e.isDirectory()) walk(a, r + '/'); else files['Cursor Rig/' + r] = [new Uint8Array(fs.readFileSync(a)), { level: /\.(glb|png|jpg|zip)$/i.test(r) ? 0 : 6 }]; } };
walk(src, '');
const out = path.join(root, 'dist', `Cursor-Rig-Windows-v${pkg.version}.zip`);
fs.writeFileSync(out, Buffer.from(zipSync(files)));
console.log('Wrote ' + out + ' (' + (fs.statSync(out).size / 1048576).toFixed(0) + ' MB)');
