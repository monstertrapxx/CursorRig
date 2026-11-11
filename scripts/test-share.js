// Round-trip tests for the sharing formats. Usage: node scripts/test-share.js [rigsDir]
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { zipSync, strToU8 } = require('fflate');
const share = require('../share.js');

const rigsDir = process.argv[2] || path.join(__dirname, '..', 'default-rigs');
const modelsDir = path.join(rigsDir, 'models');
const files = fs.readdirSync(rigsDir).filter((f) => f.endsWith('.json'));
let n = 0;

for (const f of files) {
  const rig = JSON.parse(fs.readFileSync(path.join(rigsDir, f), 'utf8'));
  const names = share.modelNames(rig).filter((m) => fs.existsSync(path.join(modelsDir, m)));

  // original format: byte-for-byte what the old app wrote, and readable by the old import logic
  const legacy = share.packLegacy(rig, modelsDir);
  const oldStyle = JSON.parse(legacy.toString('utf8'));        // what the old app does on import
  const embedded = oldStyle.embedded || {}; delete oldStyle.embedded;
  assert.deepStrictEqual(oldStyle, rig, f + ': legacy rig changed');
  assert.deepStrictEqual(Object.keys(embedded).sort(), names.sort(), f + ': legacy models differ');
  const l2 = share.unpackAny(legacy);
  assert.deepStrictEqual(l2.rig, rig);

  // new format round trip
  const key = share.packKeychain(rig, modelsDir, { appVersion: 'test' });
  assert.strictEqual(key[0], 0x50);                             // ZIP magic
  const k2 = share.unpackAny(key);
  assert.deepStrictEqual(k2.rig, rig, f + ': keychain rig changed');
  for (const m of names) assert.ok(fs.readFileSync(path.join(modelsDir, m)).equals(k2.models[m]), f + ': model ' + m + ' differs');
  assert.strictEqual(k2.manifest.format, share.KEY_FORMAT);
  n++;
}

// hostile / broken input
const rig0 = { id: 'x', name: 'x', segments: [] };
const man = (o) => strToU8(JSON.stringify({ format: share.KEY_FORMAT, formatVersion: 1, models: [], ...o }));
const mk = (extra, m = {}) => Buffer.from(zipSync({ 'manifest.json': man(m), 'rig.json': strToU8(JSON.stringify(rig0)), ...extra }));
let r = share.unpackAny(mk({ 'models/../../evil.glb': strToU8('a'), 'models/notes.exe': strToU8('b'), 'models/ok.stl': strToU8('c') }));
assert.deepStrictEqual(Object.keys(r.models).sort(), ['evil.glb', 'ok.stl']);          // path stripped, .exe ignored
assert.throws(() => share.unpackAny(mk({ 'models/a.glb': strToU8('zz') }, { models: [{ file: 'a.glb', sha256: '00' }] })), /corrupted/);
assert.throws(() => share.unpackAny(mk({}, { format: 'something-else' })), /Not a Cursor Rig keychain/);
assert.throws(() => share.unpackAny(mk({}, { formatVersion: 99 })), /newer Cursor Rig/);
assert.throws(() => share.unpackAny(Buffer.from(zipSync({ 'hello.txt': strToU8('hi') }))), /missing/);
console.log('OK:', n, 'rigs round-tripped through both formats; hostile-input checks passed');
