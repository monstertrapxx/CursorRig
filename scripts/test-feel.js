// Per-chain settings: validation + effective-settings merge. Usage: node scripts/test-feel.js
'use strict';
const assert = require('assert');
const { pickFeel, effective, FEEL_KEYS } = require('../feel.js');
assert.deepStrictEqual(pickFeel({ gravity: 2, wind: true, junk: 1, scale: 'x', floor: 'no', opacity: NaN }), { gravity: 2, wind: true });
assert.deepStrictEqual(pickFeel(null), {});
const g = { scale: 2.4, gravity: 1.85, wind: false, hotkeyMenu: 'X', activeRig: 'a' };
assert.deepStrictEqual(effective(g, { gravity: 0.5 }), { ...g, gravity: 0.5 });   // rig value wins, rest falls back to global
assert.deepStrictEqual(effective(g, undefined), g);
assert.strictEqual(FEEL_KEYS.length, 12);
console.log('feel OK');
