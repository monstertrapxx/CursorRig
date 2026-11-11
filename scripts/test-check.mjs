// Rig-check tests. Usage: node scripts/test-check.mjs [rigsDir ...]   (needs `npm install` first)
import fs from 'fs'; import path from 'path'; import assert from 'assert';
import { fileURLToPath } from 'url';
import { checkRig, fixIssue, normalizeRig } from '../src/lib/rig-core.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const dirs = process.argv.length > 2 ? process.argv.slice(2) : [path.join(here, '..', 'default-rigs')];
for (const dir of dirs) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const rig = normalizeRig(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const issues = checkRig(rig);
  console.log((rig.name + '').padEnd(26), issues.length ? issues.map((i) => i.level + ':' + i.id.split('-')[0]).join(', ') : 'clean');
  for (const i of issues.filter((x) => x.fix)) {                    // every fix must apply and clear its own warning
    const copy = normalizeRig(JSON.parse(JSON.stringify(rig)));
    assert.ok(fixIssue(copy, i), f + ': fix did nothing');
    assert.ok(!checkRig(copy).some((j) => j.id === i.id), f + ': warning still there after fix');
  }
}
console.log('checks OK');
