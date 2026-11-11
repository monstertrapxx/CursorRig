# Publishing an update (no GitHub needed)

Cursor Rig reads one small file, `update.json`, from any web address you control. When the version in it is newer than the
version someone is running, the **About** button (top right of the menu) gets a red dot and the About page shows an
**Update** button.

## One-time set up
1. Pick somewhere on the web that can hold two files (your own website, Neocities, any host with a public https address).
2. Open `package.json` and set `"cursorRig": { "updateUrl": "https://your-site/updates/update.json" }`.
   Also there: `"credit"` is the "By ..." line on the About page, and you can add `"homepage": "https://..."` for a project link.
3. (Optional) later, if you move to GitHub, set `"updateRepo": "your-name/your-repo"` instead. `updateUrl` wins if both are set.

## Each update
1. Make your changes, then bump `"version"` in `package.json` (for example `0.2.0` to `0.3.0`).
2. Write what's new in `RELEASE-NOTES.txt` (next to package.json). People read it before they update.
3. Run `npm run make-update -- --base-url https://your-site/updates/`  (add `--with-modules` only if you upgraded three.js or fflate).
   This writes `dist/cursor-rig-update-v0.3.0.zip` and `dist/update.json`.
4. Upload both files to that web folder. Done: people see the red dot within about 6 hours, or straight away if they press
   **Check for updates**.

`update.json` looks like this (you can edit it by hand):

    { "version": "0.3.0", "notes": "What's new", "date": "2026-11-10",
      "zip": "https://your-site/updates/cursor-rig-update-v0.3.0.zip",
      "page": "https://your-site/cursor-rig",
      "mac": "https://.../Cursor-Rig.dmg", "macArm64": "https://.../Cursor-Rig-arm64.dmg", "win": "https://.../Cursor-Rig-Setup.exe" }

`zip` is used by people running the folder + Start-script version. `mac` / `win` / `page` are used by installed (dmg / exe)
builds: their Update button opens that download instead, because an installed app never edits itself.

## What an update does
Downloads the zip, checks it really is a Cursor Rig (package.json name and main.js), backs up each file it replaces into
`.update-backup/`, writes the new files, then restarts. Chains, models, folders and settings live in each person's own data
folder and are never touched. An unsafe or foreign zip is rejected before anything is written.

## Windows friend build + GitHub updates (one-time)
1. On github.com/monsterTUBE make a PUBLIC repo named `cursor-rig` (package.json `cursorRig.updateRepo` is already `monsterTUBE/cursor-rig`; change it if you name it differently, then rebuild).
2. Send the friend `Cursor-Rig-Windows-v<version>.zip` (made by `npm run dist:win-folder`, or built for you in chat). He unzips it somewhere writable (Desktop/Documents, not Program Files) and runs `Cursor Rig.exe`. First launch makes a Desktop shortcut and makes double-clicking a .crig open the app. His chains/settings live in his AppData folder.
3. Each update: bump `version`, write RELEASE-NOTES.txt, run `npm run make-update`, then on GitHub make a Release tagged `v<version>` (matches package.json) with the notes and attach `dist/cursor-rig-update-v<version>.zip`. His About button then shows the red dot and Update.
Electron itself (the .exe) only changes if you send a fresh full zip; normal updates replace the app's own files.
