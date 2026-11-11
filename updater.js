// Cursor Rig updater: checks the project's latest GitHub release and (for the folder + Start-script install) swaps in the new
// program files. Your chains, models and settings live in the per-user data folder and are never touched.
//
// The update zip is a plain zip of the app folder's files (see scripts/make-update-zip.js). Nothing is written until the whole
// zip has downloaded, been opened, and checked to be a Cursor Rig (package.json + main.js). Replaced files are backed up first.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

// "1.4.0" > "1.3.9"; a leading v is ignored; "1.4.0-beta" counts as older than "1.4.0".
function parseVer(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.*))?$/);
  if (!m) return null;
  return { n: [m[1], m[2], m[3], m[4]].map((x) => parseInt(x || '0', 10)), pre: m[5] || '' };
}
function cmpVer(a, b) {
  const A = parseVer(a), B = parseVer(b);
  if (!A || !B) return 0;
  for (let i = 0; i < 4; i++) if (A.n[i] !== B.n[i]) return A.n[i] > B.n[i] ? 1 : -1;
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  return A.pre === B.pre ? 0 : A.pre > B.pre ? 1 : -1;
}

// files the update never writes
const SKIP = [/^debug[-_]/i, /^\.update-/i, /^_to_delete\//i, /^\.git\//, /^node_modules\/electron\//, /^node_modules\/\.bin\//];

function request(url, { json = false, onProgress, dest, ua, redirects = 6, allowHttp = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return reject(new Error('Only secure (https) update addresses are allowed'));
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { headers: { 'User-Agent': ua || 'cursor-rig-updater', Accept: json ? 'application/vnd.github+json' : '*/*' }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!redirects) return reject(new Error('Too many redirects'));
        return resolve(request(new URL(res.headers.location, u).toString(), { json, onProgress, dest, ua, redirects: redirects - 1, allowHttp }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(res.statusCode === 404 ? 'No release found (404)' : res.statusCode === 403 ? 'GitHub is limiting requests right now, try again later' : 'Server answered ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      if (dest) {
        let got = 0; const out = fs.createWriteStream(dest);
        res.on('data', (c) => { got += c.length; if (total && onProgress) onProgress(got / total); });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', reject); res.on('error', reject);
      } else {
        const chunks = [];
        res.on('data', (c) => { chunks.push(c); if (chunks.length > 4000) req.destroy(new Error('Reply too large')); });
        res.on('end', () => { const buf = Buffer.concat(chunks); try { resolve(json ? JSON.parse(buf.toString('utf8')) : buf); } catch (e) { reject(new Error('Unreadable reply')); } });
      }
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

function create(opts) {
  const { appDir, currentVersion, repo, manifestUrl = '', packaged = false, publicKey = '', overlayDir = '', platform = process.platform, arch = process.arch, log = () => {}, relaunch = () => {}, openExternal = () => {}, apiBase = 'https://api.github.com', allowHttp = false } = opts;
  const configured = !!(repo || manifestUrl);
  const state = { status: configured ? 'idle' : 'unconfigured', current: currentVersion, latest: null, notes: '', url: '', publishedAt: '', mode: packaged && !overlayDir ? 'external' : 'inplace', error: '', progress: 0, checkedAt: 0, source: manifestUrl ? new URL(manifestUrl).host : repo || '' };
  const listeners = new Set();
  const set = (patch) => { Object.assign(state, patch); for (const f of listeners) { try { f({ ...state }); } catch {} } };
  let release = null, busy = false;

  const pickZip = (assets) => assets.find((a) => /\.zip$/i.test(a.name) && /update/i.test(a.name)) || null;
  const pickInstaller = (assets) => {
    const want = platform === 'darwin' ? /\.dmg$/i : platform === 'win32' ? /setup.*\.exe$|\.exe$/i : null;
    if (!want) return null;
    const all = assets.filter((a) => want.test(a.name) && !/blockmap/i.test(a.name));
    return all.find((a) => platform === 'darwin' && (arch === 'arm64' ? /arm64/i.test(a.name) : !/arm64/i.test(a.name))) || all[0] || null;
  };

  // A plain update.json on any web host (no GitHub needed):
  //   { "version": "0.3.0", "notes": "what's new", "page": "https://...", "date": "2026-11-10",
  //     "zip": "https://.../cursor-rig-update-v0.3.0.zip",      <- for the folder + Start-script install
  //     "mac": "https://.../Cursor-Rig.dmg", "macArm64": "...", "win": "https://.../Cursor-Rig-Setup.exe" }   <- for installed builds
  function fromManifest(m) {
    if (!m || typeof m !== 'object' || !parseVer(m.version)) throw new Error('update.json has no valid "version"');
    const ok = (u) => typeof u === 'string' && (/^https:\/\//i.test(u) || (allowHttp && /^http:\/\//i.test(u)));
    const assets = [];
    if (ok(m.zip)) assets.push({ name: 'cursor-rig-update.zip', browser_download_url: m.zip });
    if (ok(m.zip) && ok(m.sig)) assets.push({ name: 'cursor-rig-update.zip.sig', browser_download_url: m.sig });
    if (ok(m.mac)) assets.push({ name: 'Cursor-Rig.dmg', browser_download_url: m.mac });
    if (ok(m.macArm64)) assets.push({ name: 'Cursor-Rig-arm64.dmg', browser_download_url: m.macArm64 });
    if (ok(m.win)) assets.push({ name: 'Cursor-Rig-Setup.exe', browser_download_url: m.win });
    return { tag_name: String(m.version), body: String(m.notes || ''), html_url: ok(m.page) ? m.page : '', published_at: String(m.date || ''), assets };
  }

  async function check({ quiet = false } = {}) {
    if (!configured) { set({ status: 'unconfigured' }); return { ...state }; }
    if (busy) return { ...state };
    if (!quiet || state.status !== 'available') set({ status: 'checking', error: '' });
    try {
      const rel = manifestUrl ? fromManifest(await request(manifestUrl, { json: true, allowHttp, ua: 'cursor-rig/' + currentVersion })) : await request(`${apiBase}/repos/${repo}/releases/latest`, { json: true, allowHttp, ua: 'cursor-rig/' + currentVersion });
      const tag = rel.tag_name || rel.name || '';
      if (!parseVer(tag)) throw new Error('The latest release has no version number');
      release = rel;
      const newer = cmpVer(tag, currentVersion) > 0;
      set({ status: newer ? 'available' : 'uptodate', latest: tag.replace(/^v/i, ''), notes: String(rel.body || '').slice(0, 6000), url: rel.html_url || '', publishedAt: rel.published_at || '', checkedAt: Date.now(), error: '' });
      log('UPDATE check ' + (manifestUrl || repo) + ' latest=' + tag + ' current=' + currentVersion + ' -> ' + state.status);
    } catch (e) {
      set({ status: quiet && state.status === 'available' ? 'available' : 'error', error: e.message, checkedAt: Date.now() });
      log('UPDATE check failed: ' + e.message);
    }
    return { ...state };
  }

  // Every update must be signed with the author's private key (see scripts/make-keys.js). The signature covers the version and the SHA-256 of the
  // zip, so a changed file, a swapped zip or an old (replayed) update is refused before a single file is written.
  function verifySigned(zipBuf, sig, version) {
    if (!publicKey) throw new Error('This copy has no update key, so it will not install updates. Get the newest full download instead.');
    if (!sig || typeof sig !== 'object' || typeof sig.sig !== 'string') throw new Error('The update is not signed, so it was not applied');
    let key; try { key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }); } catch { throw new Error('The update key built into this copy is unreadable'); }
    const sha = crypto.createHash('sha256').update(zipBuf).digest('hex');
    if (String(sig.sha256 || '').toLowerCase() !== sha) throw new Error('The downloaded update does not match its signature, so it was not applied');
    if (String(sig.version || '').replace(/^v/i, '') !== String(version).replace(/^v/i, '')) throw new Error('The update signature is for a different version, so it was not applied');
    let good = false; try { good = crypto.verify(null, Buffer.from('cursor-rig-update\n' + String(version).replace(/^v/i, '') + '\n' + sha), key, Buffer.from(sig.sig, 'base64')); } catch {}
    if (!good) throw new Error('The update signature is not valid, so it was not applied');
  }

  // download the zip, check its signature, and put its files over the app folder (folder + Start-script / Windows folder installs)
  // or, for a packaged app (dmg / installer), into a new "program" folder the app starts from next time (the packaged files are never edited).
  async function installZip(asset, sigAsset, toOverlay) {
    const fflate = require('fflate');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-rig-update-'));
    const zipPath = path.join(tmp, 'update.zip');
    try {
      if (!sigAsset) throw new Error('This release has no signature file for its update, so it was not applied');
      set({ status: 'downloading', progress: 0, error: '' });
      const sig = await request(sigAsset.browser_download_url, { json: true, allowHttp, ua: 'cursor-rig/' + currentVersion });
      await request(asset.browser_download_url, { dest: zipPath, onProgress: (p) => set({ progress: p }), allowHttp, ua: 'cursor-rig/' + currentVersion });
      set({ status: 'installing', progress: 1 });
      const zipBuf = fs.readFileSync(zipPath);
      verifySigned(zipBuf, sig, state.latest);
      const files = fflate.unzipSync(new Uint8Array(zipBuf));
      let names = Object.keys(files).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX/'));
      // a zip made by zipping the folder itself has one top-level folder: step into it
      const tops = new Set(names.map((n) => n.split('/')[0]));
      let strip = '';
      if (!names.includes('main.js') && tops.size === 1 && names.every((n) => n.includes('/'))) strip = [...tops][0] + '/';
      const rel = (n) => n.slice(strip.length);
      const entries = names.map((n) => [rel(n), n]).filter(([r]) => r && !SKIP.some((re) => re.test(r)));
      for (const [r] of entries) {
        const norm = path.posix.normalize(r);
        if (norm.startsWith('..') || path.isAbsolute(norm) || /^[a-z]:/i.test(norm) || norm.includes('\0') || r.includes('\\')) throw new Error('The update contains an unsafe path, so it was not applied');
      }
      const rels = new Set(entries.map(([r]) => r));
      if (!rels.has('main.js') || !rels.has('package.json')) throw new Error('This zip is not a Cursor Rig update (no main.js / package.json)');
      let pkg; try { pkg = JSON.parse(Buffer.from(files[strip + 'package.json']).toString('utf8')); } catch { throw new Error('The update has an unreadable package.json'); }
      if (pkg.name !== 'cursor-rig') throw new Error('This zip is not a Cursor Rig update');
      if (String(pkg.version) !== String(state.latest) || cmpVer(pkg.version, currentVersion) <= 0) throw new Error('The update is not a newer version than this one, so it was not applied');
      const need = parseInt(pkg.cursorRig && pkg.cursorRig.minElectron, 10) || 0;
      if (toOverlay && need && parseInt(process.versions.electron, 10) < need) { openExternal(state.url); throw new Error('This update needs a newer Cursor Rig download (not just the in-app update). Its page was opened.'); }
      if (!toOverlay) {
        // back up what gets replaced, then write
        const backup = path.join(appDir, '.update-backup', currentVersion + '-to-' + (pkg.version || state.latest));
        let n = 0;
        for (const [r, orig] of entries) {
          const dst = path.join(appDir, r);
          if (!path.normalize(dst).startsWith(path.normalize(appDir + path.sep))) throw new Error('Unsafe path');
          try { if (fs.existsSync(dst) && fs.statSync(dst).isFile()) { fs.mkdirSync(path.dirname(path.join(backup, r)), { recursive: true }); fs.copyFileSync(dst, path.join(backup, r)); } } catch {}
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          const tmpDst = dst + '.updating';
          fs.writeFileSync(tmpDst, Buffer.from(files[orig]));
          fs.renameSync(tmpDst, dst);
          if (/\.(command|sh)$/i.test(r)) { try { fs.chmodSync(dst, 0o755); } catch {} }
          n++;
        }
        log('UPDATE installed ' + n + ' files -> ' + (pkg.version || '?') + ' (backup ' + backup + ')');
      } else {
        const dest = path.join(overlayDir, String(pkg.version)), stage = dest + '.new';
        fs.rmSync(stage, { recursive: true, force: true });
        for (const [r, orig] of entries) { const dst = path.join(stage, r); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, Buffer.from(files[orig])); }
        fs.rmSync(dest, { recursive: true, force: true }); fs.renameSync(stage, dest);
        const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(overlayDir, 'current.json'), 'utf8')).version; } catch { return null; } })();
        fs.writeFileSync(path.join(overlayDir, 'current.json.new'), JSON.stringify({ version: String(pkg.version), tries: 0, previous: prev, installed: new Date().toISOString() }));
        fs.renameSync(path.join(overlayDir, 'current.json.new'), path.join(overlayDir, 'current.json'));
        for (const d of fs.readdirSync(overlayDir)) if (/^\d/.test(d) && d !== String(pkg.version) && d !== prev) fs.rmSync(path.join(overlayDir, d), { recursive: true, force: true });   // keep this one and the one before it
        log('UPDATE installed ' + entries.length + ' files into ' + dest);
      }
      set({ status: 'ready', progress: 1 });
      return true;
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  }

  async function apply() {
    if (busy) return { ...state };
    if (!release || state.status !== 'available') { await check(); if (state.status !== 'available') return { ...state }; }
    busy = true;
    try {
      const assets = Array.isArray(release.assets) ? release.assets : [];
      if (!packaged || overlayDir) {
        const zip = pickZip(assets);
        const sigA = zip && assets.find((a) => a.name === zip.name + '.sig');
        if (zip) { await installZip(zip, sigA, !!packaged); return { ...state }; }
        // no update zip on this release: send the person to the release page instead
        openExternal(state.url); set({ status: 'available', error: 'This release has no update file, so its page was opened instead.' });
        return { ...state };
      }
      const inst = pickInstaller(assets);
      openExternal(inst ? inst.browser_download_url : state.url);
      set({ status: 'available', error: '' });
    } catch (e) {
      set({ status: 'error', error: e.message }); log('UPDATE failed: ' + e.message);
    } finally { busy = false; }
    return { ...state };
  }

  return { check, apply, getState: () => ({ ...state }), onChange: (f) => { listeners.add(f); return () => listeners.delete(f); }, restart: () => relaunch(), cmpVer };
}

module.exports = { create, cmpVer, parseVer };
