// Publishing a release:   npm run release        (npm run release -- --dry   only checks, changes nothing)
// 1. bump "version" in package.json   2. write what's new in RELEASE-NOTES.txt   3. commit   4. npm run release
// This tags the commit v<version> and pushes the tag. GitHub then builds the macOS and Windows apps, signs the update, and publishes the release.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const dry = process.argv.includes('--dry');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = 'v' + pkg.version;
const fail = (m) => { console.error('\nNot released: ' + m); process.exit(1); };
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const cr = pkg.cursorRig || {};
if (!/^[\w.-]+\/[\w.-]+$/.test(cr.updateRepo || '')) fail('set cursorRig.updateRepo in package.json to "your-github-name/your-repo-name".');
if (!cr.updateKey) fail('no update key yet. Run:  npm run make-keys');
let notes = ''; try { notes = fs.readFileSync(path.join(root, 'RELEASE-NOTES.txt'), 'utf8').trim(); } catch {}
if (!notes) fail('write what is new in RELEASE-NOTES.txt (people read it before they update).');
try { const pem = fs.readFileSync(path.join(root, '.signing', 'update-private.pem'), 'utf8'); const pub = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'der' }).toString('base64'); if (pub !== cr.updateKey) fail('.signing/update-private.pem does not match cursorRig.updateKey in package.json.'); } catch (e) { if (/^Not released/.test(String(e.message))) throw e; console.log('(note: .signing/update-private.pem is not on this computer; the GitHub secret UPDATE_SIGNING_KEY signs the update)'); }
try { git('rev-parse', '--is-inside-work-tree'); } catch { fail('this folder is not a git repository yet (see RELEASING.md, one-time set-up).'); }
if (git('status', '--porcelain')) fail('there are uncommitted changes. Commit them first (git add -A && git commit -m "' + tag + '").');
if (git('tag', '--list', tag)) fail(tag + ' already exists. Bump "version" in package.json.');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
console.log(`Ready to release ${tag} from ${branch} to github.com/${cr.updateRepo}`);
console.log('Notes:\n' + notes.split('\n').map((l) => '  ' + l).join('\n'));
if (dry) { console.log('\n(dry run: nothing was changed)'); process.exit(0); }
git('push', 'origin', branch);
git('tag', '-a', tag, '-m', tag);
git('push', 'origin', tag);
console.log(`\nPushed ${tag}. GitHub is building it now: github.com/${cr.updateRepo}/actions (about 10 minutes). The release appears at github.com/${cr.updateRepo}/releases`);
