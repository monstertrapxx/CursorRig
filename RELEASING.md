# Releasing Cursor Rig (GitHub, macOS + Windows, signed updates)

## Every release (about 2 minutes of your time)
1. Bump `"version"` in `package.json` (e.g. `0.2.0` to `0.3.0`).
2. Write what's new in `RELEASE-NOTES.txt` (people read it before they update).
3. Commit: `git add -A && git commit -m "v0.3.0"`
4. `npm run release`

That's it. `npm run release` checks everything, tags the commit `v0.3.0` and pushes the tag. GitHub then (about 10 minutes, nothing to do):
builds the **macOS** apps (Apple Silicon + Intel, `.dmg` and `.zip`), builds the **Windows** installer and portable `.exe`, signs the in-app
update, and publishes the release with your notes. Everything in `release-extras/*.crig` is attached too (that is where the Starter Pack goes).
`npm run release -- --dry` only checks.

## One-time set-up
1. Make a GitHub repo and set `"updateRepo": "your-name/your-repo"` in `package.json` (`cursorRig`). Push this folder to it
   (`default-rigs/` is git-ignored on purpose: the sample content is not part of the app).
2. `npm run make-keys` makes your update-signing key. The public half goes into `package.json` (`cursorRig.updateKey`).
   The private half is `.signing/update-private.pem`: **back it up, never share it, never commit it** (git ignores it).
   Lose it and people who already have the app can no longer receive updates; leak it and anyone can push code to your users.
3. On GitHub: repo > Settings > Secrets and variables > Actions > New repository secret. Name `UPDATE_SIGNING_KEY`, value = the whole text of `.signing/update-private.pem`.
4. Repo > Settings > Actions > General > Workflow permissions: "Read and write".

## What people get
- **Releases page downloads:** `Cursor-Rig-<v>-arm64.dmg` / `-x64.dmg` (macOS), `Cursor-Rig-Setup-<v>.exe` (Windows installer) and `Cursor-Rig-Portable-<v>.exe`.
  Zero cursorchains inside. The sample pack is the separate `Cursor-Rig-Starter-Pack.crig`: import it (menu > Import) or double-click it.
- **`.crig` files** show the Cursor Rig icon and open in the app (Mac: from the .dmg app; Windows: installer registers it, the portable exe and unzipped folder register it on first launch).
- **macOS first open:** the app is not notarized (that needs a paid Apple developer account), so the first time: right-click the app > Open.

## How updates work, and why they are safe
- The app checks your latest GitHub release (About button gets a red dot; **Update** installs it and restarts).
- Every update is `cursor-rig-update-v<v>.zip` plus a signature file. The signature covers the version and the SHA-256 of the zip and is made with your private key.
  The app has only the public key, so it refuses anything not signed by you, any altered file, and any old version replayed as new. Nothing is written until all checks pass.
- It replaces the **whole program** (every script, page, asset). Installed copies (dmg / installer / portable) are never edited in place:
  the update goes to a `program` folder in the user's own data folder and the app starts from it next time. If that version fails to start twice, the installed version takes over again.
- Chains, models, folders and settings are never touched.
- Not covered by an in-app update: the Electron runtime itself. If you raise the Electron version in `package.json`, set `"minElectron": <major>` under `cursorRig`; people on an older runtime are sent to the full download instead.
  (If you add/upgrade three.js or fflate, run the update build with `--with-modules`, i.e. change the `make-update-zip` line in `.github/workflows/release.yml`.)
- The folder + `Start Cursor Rig` way of running (Node installed) updates in place the same way, and installs new components on the next start if `package.json` changed.

## Without GitHub Actions (by hand)
`npm run make-update` writes the signed `dist/cursor-rig-update-v<v>.zip`, its `.sig` and `update.json`; `npm run dist:mac` / `npm run dist:win` build the apps (each only on its own OS);
`npm run starter-crig` rebuilds the Starter Pack from `default-rigs/`. To ship your own collection instead, use Export all in the app's menu and drop that `.crig` into `release-extras/`.
