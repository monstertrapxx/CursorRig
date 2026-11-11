# Save pipeline, the "Save doesn't update my cursor" incident, and how to debug it

Read this before touching Save, the editor, the overlay, or spin. It records a bug that cost many hours.

## What the user reported (9 Nov 2026)
"I position Longman in the model editor, press Save, and the realtime cursor chain still shows a version from hours ago."

## What was actually wrong
**Save was never broken.** The app's own log proved every Save wrote the file, sent it to the cursor overlay, and the overlay rebuilt from exactly that file (same data, same model hash).

The real cause was a **rendering mismatch between the editor and the cursor**:
- Longman has an idle spin (`spin` 25 deg/s on his model part).
- The editor holds parts still. The cursor turns them.
- The spin used to rotate the part about **its own origin**. The user lines a part up under the string using a small offset (Longman: z -0.108). Spinning about the part's origin swung that offset around, so the head drifted away from the chain loop on the cursor. It looked like an old/wrong position even though it was the saved data.
- The editor default view is side-on; the cursor camera is straight-on (z is invisible there). Never assume "Desktop view" equals what the cursor shows. It is an interactive keychain: it must look right from every angle.

**Fix (src/lib/rig-core.js, spinners):** the twist is now about the string itself: `wrap.quaternion = R(ang) * base`, `wrap.position = R(ang) * basePos`. A part that is under the string in the editor stays under it while it turns. Applies to every model with a spin, in the cursor and the editor's "Show spin".

## Other real bugs found and fixed along the way
- Bone (segment) Move/Rotate edits only changed `rest`, which the sim ignores for stiffness-0 chains. `bakeSegmentRests()` in editor.js now bakes them into the attachments at Save.
- Unequipping left a frozen chain: the overlay canvas was never cleared (`needsClear` in overlay.js).
- Save now forces a rebuild of the cursor (`rigs:refresh` -> `sendActiveRig(true)`; overlay `setRigs` honours `force`), and the protocol handler sends `no-store` so models are never served stale.
- Save takes each part's position from what is on the editor screen (`EDITOR save check`), so screen and saved data can never disagree.
- Migrations in main.js (`sampleRev`): 11 re-copies Conker; 13 restores Longman's idle spin if it was switched off. Never turn a user's spin off without being asked.

## Rules so this never happens again
1. **When the user says "Save doesn't work", check the log first, before theorising.** Compare editor vs cursor for the *same data*. If the data is identical, the bug is in rendering, not saving.
2. The editor and the cursor must use the same code for anything that moves a part (rig-core). Any behaviour added to the cursor (spin, physics) must keep a part's editor position true.
3. Do not change user-visible behaviour (e.g. spin) unasked. Do not add unrequested features.
4. Keep the debug tooling below. Do not remove it.
5. Anything saved must be written through `saveRig` in main.js (it logs `WROTE`), then `rigsChanged`/`rigs:refresh`.

## Debug tooling (always on)
Log: `debug-log.txt` in the project folder, and a copy in the app data folder (`~/Library/Application Support/Cursor Rig/debug-log.txt`, survives renaming the project). Each line has the process id.
- `START pid=... app=... data=... sampleRev=...` which app copy is running.
- `SAVE from editor`, `SAVEJSON`, `WROTE <path> size mtime sha` the file written.
- `REFRESH after save ...`, `SEND rigs-active ...`, `OVERLAY READS ... sha`, `OVERLAY built ...` the cursor rebuilt from that file.
- `OVERLAY EDITOR save check: screen matches data` (or MISMATCH, which is then corrected).
- `EDITOR drag ended target=... changed=...` and `EDITOR changed ...` whether an edit registered at all.
- `MODEL ... fileHash` and `overlay loaded model` model files match between editor and cursor.
Screenshots the app takes itself (project folder): `debug-overlay-start.png` (9 s after launch), `debug-overlay-before-save.png` (the instant Save is pressed), `debug-overlay.png` and `debug-editor.png` (about 3 s after Save).
The editor's Save message names the file, time and app process, and says if no app answered.

## If it ever looks wrong again
1. Open `debug-log.txt`: is there a `SAVE from editor` / `WROTE` at the time you pressed Save? Is the sha different from before? No `EDITOR changed` = the editor registered no edit (look for "● unsaved" next to the name when you change something).
2. Compare `debug-overlay.png` with `debug-editor.png` for the same moment.
3. Only one copy of the app should run (`START pid=...`); quit it fully before restarting from `Start Cursor Rig.command`.

## Ragdolls (added after the save incident)
- Rig segments can have `limit` (degrees): the most a joint may bend away from its rest direction, so limbs cannot fold into the body. Implemented in `_solve` in `src/lib/rig-core.js`.
- Ragdoll part attachments carry `noSpin: true`, so the global spin default never turns limbs on their own.
- Parts are cut from the posed mesh by dominant skin weight; triangles that straddle two parts go into both so joints overlap instead of leaving gaps. Parts are stored in their own bone frame with the vertices already scaled, so the attachment scale must be `[1,1,1]` (scaling twice was what made the first Popoy ragdoll fall apart).
- Use light connector segments (mass about 0.3) and similar masses on limbs, so the chain does not stretch.
- Spin: models do not turn on their own by default. They still twist when the cursor moves (spinDrive 0.5), so e.g. the clay wasp can rotate. The menu slider "Automatic spin" (per chain, 0 to 90 deg/s) adds a constant slow turn; Longman keeps his own saved 25 deg/s.
- Floor: it sits at the very bottom of the screen, not above the Dock.

## Ragdoll rigs: what exists and how they were built

Ragdoll rigs (ids ending `_ragdoll`, plus `popoydameragdoll`) are made of one GLB per body part, each hung from its own rig segment (`fit:false`, `noSpin:true`, attachment scale `[1,1,1]`). Joints use the per-segment `limit` (degrees) so limbs cannot fold through the body. Rigs exist for: Popoy (Dame Tu Cosita), the 13 Bloody Shooting zombies, the Demon Boss, Crow, Duck and Rabbit. Models with no skeleton (Longman, OG Mario, Fatty, Edwin) cannot be made into ragdolls. Bad Santa and Ninja Gray are not done yet.

The scripts that built them are in `tools/ragdoll-builder/` (Python + bpy/trimesh/PIL; not used by the app at runtime): `glbdump.py` (dump skeleton and skin weights from a GLB), `ragdoll3.py` (3D part cutter and rig builder), `zombie.py` (humanoid spec, also used for the Demon), `animals.py` (bird and rabbit specs). Key rules: cut parts by dominant skin weight; triangles that straddle two parts go into both so joints overlap; store each part in its own bone frame; keep connector segments light (mass 0.3); the first listed segment is hung from the back of the body for animals. New default rig ids are seeded automatically on startup, and new model files are copied into the user's models folder if missing, so no migration is needed for brand-new rigs.

### Ragdoll behaviour notes (v3)
- "Ragdoll" here means a video-game ragdoll: limp body, free tumbling. Rigs carry `physics.yaw: true` (rig-core `RigView.update`): the whole body turns freely about the string, driven by cursor movement plus the Automatic spin slider, and keeps its angle when it stops. Flatten is 0.02 so limbs swing in 3D, not in a flat plane. Joint stiffness is low and limits are wide.
- Textures: trimesh already flips V when writing glTF, so do NOT flip UVs in the builder (that scrambled every texture in v1/v2).
- Popoy: bone 7/23 is the clavicle, 8/24 the real shoulder. The upper arm swings from bone 8; skin above the shoulder joint is kept with the torso. Cutting joints by a plane tore the chest and was reverted.

## Skinned ragdolls (v4)
- Each ragdoll is ONE skinned GLB (`bsrag_*.glb`, `popoyrag.glb`) whose bones are the rig segments. Rig attachment field `skin.bones = { segmentId: [x,y,z,w] }`; RigView (`_addSkin`) sets every bone's world matrix from its segment each frame, so joints bend smoothly with no gaps.
- Do NOT rotate or move the ragdoll attachment or its parts in the editor: it breaks the bone/skin binding. To hang a character differently, rebuild it (see `tools/ragdoll-builder/askin.py build_rabbit_mouth`, `rot` argument).
- Free-dangling parameters: limb stiffness 0.01-0.06, limits 80-120 deg, spine stiff 0.9, damping 0.05, flatten 0.02, `physics.yaw=true` (whole body turns about the string; eases face-on when Automatic spin = 0).
- Textures: never flip UV V twice; the writer writes v = 1 - v_src.
- Builders: `tools/ragdoll-builder/` (skinrig.py, zskin.py, askin.py, popoy_skin.py). Migration `sampleRev` 17 reinstalls all ragdoll rigs/models.
- Default physics for rigs that don't specify them now match Kuma (damping 0.025, iterations 14, flatten 0).
- Ragdoll twist (v5): the body keeps its own turning momentum (cursor movement pushes it, ~0.5/s friction); no more snapping back to face the front. Automatic spin = constant turn.
- Bad Santa and Ninja Gray ragdolls: `badsanta_ragdoll.json`/`ninjagray_ragdoll.json` (built by `santa.py` and `nskin.py`; Bad Santa uses the zombie skeleton, Ninja Gray has its own bone names). Run `loosen.py` on any rebuilt rig.
- Limb collision (v6): optional per-segment `radius` (rig units). RigView sim builds capsule pairs (segments 3+ joints apart) and pushes them apart in `_collide()`. Radii are measured from the skinned model by `tools/ragdoll-builder/radii.py` (then capped by hand: torso 0.17, head 0.09, limbs 0.10). Humanoids only; animals have none.
- Twist (v6): ragdolls hang facing the front, a weak twist spring brings them back; fast cursor flicks spin them. Menu previews (drawer.js, thumbs.js) set `view.noYaw = true` so they always face front.
- Mouth-hung rabbit: hang point on the lower muzzle, spun about the string so the BACK faces the viewer (askin.py build_rabbit_mouth).
- v7: yaw now turns ONLY the doll about the vertical through its hang point (was every link about the anchor, which made the whole body circle); `_collide` shifts `prev` as well so it adds no energy; collision radii x0.8 in the sim; ragdoll rigs: scale 100, damping 0.05, depthSway 0.3 (out-of-screen swing), body masses x0.55 (total close to Kuma's so the top chain is not dragged stiff). `loosen.py` does the rig part once (flag `tuned7`).
- Thumbnails: `makeThumb` times out after 8 s and logs `THUMB FAIL <name>: <why>` to the debug log; the inventory retries blank thumbnails up to 3 times. Skinned ragdolls are framed from their skin object. If inventory previews are still blank, look for THUMB FAIL lines in the debug log.
- v8: collision touching distance per pair = min(sum of radii, 90% of the pair's distance in the starting pose); contact damping + shifted `prev` => idle jitter measured 0 on Santa/Ninja/zombies/Demon/Popoy (small residual on the female rigs). Radii now full measured size (p75 of the skin's distance from the bone axis; caps torso .22, head .10, limbs .14).
- Twist (v8): about the line from the cursor point (big ring) to the doll's hang point; the ring, chain and doll turn together, mostly facing front, with a weak spring back.
- Segment field `sink`: the chain hooks on this far further along the segment; the body rises toward the chain (physics length = length - sink and the bone's pivot moves the same amount). Demon head sink = 0.19 (horn tips were the hang point).
- Editor, ragdoll segment inspector: "Ragdoll joint" section with Joint limit, Collision size, and Raise body (on the doll's root segment). Don't touch the model attachment position/rotation.

## Ragdoll v9 notes
- Demon neck stretch: skinned models share bone-inverse matrices between clones of the cached GLB, so the `sink` shift stacked up with every extra view (menu preview, thumbnail, editor). `_addSkin` now copies the matrices first.
- Collision is a soft spring (K=1500, DAMP=0.1, CAP=0.01 in `_collide`); trunk segments are static walls. Fat rigs need damping 0.07 at gravity 18 or they shimmer when idle.
- Ragdoll gravity 18, depthSway 5; for `physics.yaw` rigs the depth sway reacts to gentler cursor speed so limbs swing front/back.
- Previews measure the posed mesh (`drawer.js fit`, `thumbs.js`); inventory thumbnails use `window.rigApi || parent.rigApi`.
- Ribbon trails (orbit bodies, emitters) now take `rainbow` (colour bands across), `glitter` (white twinkling grain + plus-shaped sparkles) and `square` (full width to the end) in the trail settings; editor has checkboxes under Trail. The sample "Rainbow Star" cursorbit uses all three.
- Migration revs: 23 ragdoll gravity/damping/swing, 24 tree+targets flipped upside down, 25 Hoodwink, Rainbow Star, clay wasp model (both eyes), Popoy ragdoll colours.
