// One-time set-up for signed updates:  npm run make-keys
// Makes a signing key pair. The PRIVATE key stays on your computer (.signing/update-private.pem, never uploaded, git ignores it).
// The PUBLIC key is written into package.json (cursorRig.updateKey): every copy of the app uses it to check that an update
// really came from you. An update that is not signed with your private key is refused, so nobody else can push code to your users.
// Keep a backup of the private key somewhere safe: if you lose it you can no longer push updates to people who already have the app.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const dir = path.join(root, '.signing'), priv = path.join(dir, 'update-private.pem');
const pkgFile = path.join(root, 'package.json');
if (fs.existsSync(priv) && !process.argv.includes('--force')) {
  const pub = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(priv))).export({ type: 'spki', format: 'der' }).toString('base64');
  console.log('A signing key already exists (.signing/update-private.pem). Public key:\n' + pub + '\nUse --force to replace it (people on the old key would stop getting updates).');
  process.exit(0);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.cursorRig = { ...(pkg.cursorRig || {}), updateKey: pub };
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
console.log('Made .signing/update-private.pem (keep it secret and back it up) and put the public key in package.json.');
console.log('For GitHub builds: copy the WHOLE contents of .signing/update-private.pem into a repository secret called UPDATE_SIGNING_KEY');
console.log('(GitHub > your repo > Settings > Secrets and variables > Actions > New repository secret).');
