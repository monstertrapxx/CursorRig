# Cursor Rig: development notes

Technical notes for people working on the code. The user guide is README.md.

A transparent, click-through overlay that hangs a physics-simulated chain or rig from your mouse cursor, plus a 3D editor for building your own rigs out of segments and attached models.


## Run it

Ready-made Windows build: unzip `CursorRig-win32-x64.zip` and run `Cursor Rig.exe`. A small cursor-and-chain icon appears in the system tray.

From source (Windows, macOS or Linux, needs Node.js 18+):

```
npm install
npm start
```

## Using it

| | |
|---|---|
| **Ctrl + Alt + R** | Open / close the menu |
| **Ctrl + Alt + H** | Show / hide the rig |
| Tray icon | Left-click opens the menu; right-click has rigs, editor and Quit |

The overlay never takes clicks, so you can keep working normally. Both hotkeys can be changed in the menu.

**Menu:** pick a rig, open the editor, and adjust size, gravity, extra drag and opacity. Under *Screen*, "Rest on taskbar" lets the rig pile up on the taskbar, "Screen edges are walls" stops it at the sides, and "Wind" adds gusts. *Start with Windows* launches it at login.

## Editor

* **Hierarchy (left):** the *Cursor anchor* is the mouse tip. Segments hang from it and can branch: any segment can have several children (see *Wind chime*). Drag rows to re-parent segments or move parts between segments.
* **Viewport:** click to select. Left-drag orbits, right-drag pans, wheel zooms. The white pointer is drawn at real on-screen cursor size, so you can judge scale.
* **Gizmos:** `W` move, `E` rotate, `R` scale.
  * On a **part**, these edit its position, rotation and size within the segment.
  * On a **segment**, *Move* drags the joint, which changes its length and rest direction, and *Rotate* turns the rest direction.
  * On the **anchor**, *Move* offsets the rig from the pointer tip.
* **Segments:** set length, stiffness (0 is a loose rope, 0.9+ is nearly rigid, and stiff segments hold their rest angle), and mass.
* **Parts:** primitives (box, sphere, cylinder, cone, torus, capsule, ring, octahedron) or imported **.glb / .gltf / .obj / .stl** models. Models are auto-fitted into a 1-unit box by default, keep their own materials unless you tick *Override colour*, and are copied into the rigs folder.
* **+ Chain…** adds a run of N segments in one go, optionally with chain links that alternate 90°. **Copy down chain…** on a part repeats it on every segment below.
* **Simulate** (`Space`) previews the physics in the editor. Left-drag moves the "cursor", or tick *Auto-swing*.
* **Use on desktop** saves the rig and hangs it from your real cursor.
* `Ctrl+S` saves, `Ctrl+Shift+S` saves a copy, `Ctrl+Z` / `Ctrl+Y` undo and redo, `Ctrl+D` duplicates, `Del` deletes, `F` focuses the selection.
* **Export** writes a single `.cursorrig` file with its models embedded, for sharing. Use *Import* in the menu to load one.

Rigs live in `%APPDATA%\Cursor Rig\rigs` on Windows (`~/Library/Application Support/Cursor Rig/rigs` on macOS) (*Rigs folder* in the menu opens it). Each rig is plain JSON.

## How it works

* `main.js` creates a full-screen transparent, always-on-top, click-through window on whichever monitor the cursor is on. It polls the cursor position every 8 ms and sends it to that window.
* `src/lib/rig-core.js` is shared by the overlay and the editor:
  * The rig data model.
  * A position-based Verlet solver with substeps, mass-weighted length constraints, a bending pull toward each segment's rest angle, and a final pass that removes leftover stretch.
  * Segment frames that are parallel-transported, so attached models never spin or twist randomly.
* Rig units: 1 unit = *Pixels / unit* screen pixels (set per rig), multiplied by the menu's Size slider.

## Building installers

```
npm install --save-dev electron-builder
npm run dist:win      # NSIS installer + portable exe (build on Windows)
```

## Notes

* Exclusive-fullscreen games draw over everything, including this overlay. Borderless-windowed games work.
* On Windows the overlay is 1 px shorter than the screen on purpose. A topmost window that covers the screen exactly makes Windows treat it as a fullscreen app, which hides the taskbar.
* `npm run make-rigs` regenerates the sample rigs from `scripts/make-default-rigs.mjs`.

## Sharing (v0.2)

Export offers two formats; the file extension you pick decides:

* **`.cursorchain` (new):** a single ZIP with `manifest.json`, `rig.json` and the raw model files. Smaller than the original format, checksummed, and safe to open (path/size/extension checks). `rig.json` uses the same v1 rig schema as saved rigs.
* **`.cursorrig` (original):** unchanged JSON with models embedded as base64, so older versions of Cursor Rig can still open what you send.

Import accepts both (plus plain `.json`) and detects the format from the file contents. Run `npm test` to round-trip every rig through both formats.

## Compatibility with the original app

Same app id and name, so both versions use the same data folder: the same `rigs/*.json`, `rigs/models/` and `settings.json`. Rig format is still v1 and any future additions must be optional fields, so the older app keeps loading everything. Don't run both versions at once (they share a single-instance lock).

## Rig check

The editor's **Check** button looks for settings that make a rig look stiff or twitchy and offers one-click fixes (nothing changes unless you tick it):

* A part (e.g. a model) hanging far below a short, light segment such as the last chain link. This is the main cause of a charm that whips around or moves stiffly. The fix gives it its own weighted segment, like the tabby's charm, without moving it on screen.
* High stiffness on a segment that carries or sits above a model.
* A segment far heavier than the one it hangs from.
* High flatten.

It also runs when you press **Use on desktop** and nudges you if it finds a warning. `npm test` checks the rules against all sample rigs.

## Depth sway

A rig made only of flat chain links, driven by a cursor that only moves up/down/left/right, never leaves the screen plane, so it only swings side to side. **Depth sway** (Inspector, rig physics) adds a gentle toward/away-from-screen drift that grows with cursor speed. It defaults to 0 for existing rigs and 0.3 for new ones. Pair it with **Keep flat** at 0. The old app ignores the field, so rigs still open there.

## Per-chain settings and the chain list (v0.2)

* **Each chain remembers its own feel.** Size, Gravity, Extra drag, Opacity, Wind, taskbar and edge settings are saved inside the rig (`feel`, an optional field), so switching chains switches the settings too. A chain with no saved values uses your global ones, and **More settings > Reset this chain's settings** clears them. Stiffness and mass were already per segment. The field travels in `.cursorchain` and `.cursorrig` files; the original app ignores it.
* **The chain list** shows an icon of each chain (framed on the charm or body; links and rings are drawn but ignored when zooming), supports search, favourites (starred chains sort first), duplicate and delete.
* **Menu look:** a flat black, white and grey panel in Arial Narrow, semi-transparent, with a Dark / Light switch at the top of its settings. Only the chain icons have colour. This is the menu only; the editor still has the old look. How see-through the panel is: `--panel-alpha` at the top of `src/panel/panel.css`.

## Older computers and older Windows

* **Windows 10 and 11:** the normal build (`npm run dist:win`).
* **Windows 7 / 8 / 8.1 (and 32-bit PCs):** Electron 23 and newer need Windows 10, so run `npm run dist:win-legacy`. It builds with Electron 22 and three.js r160 (the last one that falls back to WebGL 1 on old graphics) and produces a 32-bit and a 64-bit zip in `dist-legacy/release`. Same app, same files. Transparent windows on Windows 7 need Aero turned on.
* **Performance mode** (menu > Settings > App) draws at about 30 frames a second, at standard resolution, with a simpler physics step. It switches itself on the first time the app runs on a PC with under 4 GB of memory, 2 or fewer processor cores, or a Windows older than 10.
* **Compatibility graphics** (same place) uses software drawing for graphics that can't run WebGL. If the overlay can't start its graphics, the app offers to restart in this mode itself. It is slower, and on some systems it can lose see-through windows, so it is a last resort.

## Editor: selecting several parts
- Shift/Ctrl/Cmd-click a part in the 3D view or the left-hand tree to add or remove it.
- Shift + drag in the 3D view draws a selection box (add Ctrl/Cmd to keep the current selection).
- Ctrl/Cmd+A selects every part.
- The move/rotate/scale gizmo then moves the whole group about its centre; Delete and Ctrl/Cmd+D act on all of them. One Undo reverts a whole group move.
- Segments are still selected one at a time.

## Orbit cursorchains (planets)
A second kind of cursorchain: bodies circle the cursor on tilted orbit rings, slowly when the cursor is still and faster (orbit and spin) the faster you move it, easing back down when you stop.
- Make one with the **+** button in the menu or editor and pick **Orbit**. The sample "Solar system" is added to your list automatically.
- In the editor, *Rig settings* holds the motion (idle speed, fast speed, how fast counts as fast, how quickly it speeds up and slows down) and a card for every orbit (radius, tilt, roll, speed, line colour). Each planet picks an orbit, a start angle and a spin, and carries ordinary parts and models. Choose a planet in "Circles" to make a moon.
- Press Space in the editor and tick Auto-swing to preview. Gravity, floor and wind do not apply to orbit chains.
- Saved as the usual rig JSON with `type: "orbit"` plus an `orbit` block and per-planet `orbit` data, so `.cursorchain` sharing works unchanged. The original app will still open the file but shows the planets hanging in a bundle.

## Chain position (where chains hang from)
One setting for every chain, not stored in any chain file: Settings > Chain position > Set up…, also shown the first time the app opens. A red dot follows your real pointer on screen; nudge it (arrow keys, Shift for bigger steps) until it sits at the bottom right of the arrow, or press a preset. Only sideways and up/down are set; depth is taken from the chain. Defaults differ slightly for Mac and Windows. A chain's own anchor offset in the editor is now just a small extra shift on top of this. The editor shows the hang point as a red dot instead of a pointer model.

## Giant stars, star shape and halos
- New **star** part shape (a chunky, rounded five-point star) and a per-part **Soft halo** glow (Look section in the editor). Older versions of the app show a star as a sphere and ignore the halo.
- Sample chain **Giant stars**: nine big glowing yellow stars on four orbits. Regenerate with `node scripts/make-stars.mjs`.

## Look
The menu and editor share one bare-bones retro look: square corners, plain 2px lines, monospace labels, selection shown by inverting. It follows Settings > Appearance (Dark / Light). Styles live at the end of `src/panel/panel.css` and in `src/editor/retro.css`.

## Library, inventory and templates
- **Menu library** has two views (switch at the top): **3D** (your chains hang from a rod in a row, drawn live in 3D, scroll left and right; only the six or so on screen are drawn; if 3D can't start it falls back to flat pictures) and **List** (plain text, no 3D, best for older PCs; it is the default when Performance mode is on). A type filter shows All / Chains / Orbits. A chain's profile page has a **Save changes** button: edits preview live, and leaving with unsaved changes asks Save or Discard.
- **Inventory** (button next to Equip): a larger window with search, sort, card size, favourites, and **groups**. Make groups with +, drag chains onto them or tick them in the details panel. Shift/Ctrl-click for several, Ctrl/Cmd+A for all. Groups and favourites live in the app settings, not in chain files.
- **New cursorchain** asks for the type (Chain or Orbit) and then a template: blank, or a copy of any chain of that type you already have.
- Samples added: **Big solar system** (large planets), **Conker on a string** (textured model, `default-rigs/models/conker.glb`, made by `scripts/make_conker.py`). Sample models are copied into your models folder automatically.

- **Angle sway** (orbit chains): each ring's angle drifts slowly, faster when the cursor is fast, and leans the way the cursor moves, so orbits tilt through 3D instead of staying fixed. Set it per chain in the editor's Orbit section (0 = fixed angles).

- **Particles** (new cursorchain type): the cursor sheds a stream of drifting things. Samples: **Cherry blossom** (pink petals) and **Black feathers** (with a red trail behind each one). They emit more when you move fast, fall with air drag, flutter and tumble, and respond to Wind and "Rest on the Dock/taskbar". Edit shape, rate, life, size, gravity, flutter, colours and trail in the editor; "New cursorchain" offers Particles with both samples as templates. In a chain's profile you can change the emit rates and how many are alive at once.
- **Body trails** (orbit chains): any body can stream a soft fading ribbon as it orbits (editor: select a planet, then Trail). Saturn and the Giant stars use it.
- **Orbit wobble** (was Angle sway): 0 keeps every orbit on one clear fixed path. It is in the editor and in an orbit chain's profile. Hover any slider name for a short explanation.
- **Solar system** is now a realistic model: textured planets (generated textures, no photographs, `scripts/make_planets.py`), Saturn's rings with the Cassini division, the Moon, the four big moons of Jupiter and Titan, nearly flat orbits using the real inclinations, planets spinning on their axes (Venus backwards), and moons locked to face their planet. Speeds follow the real orbital period ratios, square-rooted so Neptune still visibly moves; distances and sizes are compressed so everything fits around a cursor. **Saturn** is a new orbit chain: just Saturn circling the cursor with a trail.

- **Orbit buttons** (orbit chains, profile page): Angle, Roll, Speed and Orbit size nudge every orbit at once with − / + buttons, live on the equipped chain, saved per chain with Save changes; "Reset angles" puts them back. Body trails (Saturn, Giant stars) are stored relative to the thing they circle, so moving the mouse never smears them, they only follow the orbit. The Black feathers' red trail follows the cursor itself (editor: Cursor trail); the feathers have none.

## App icon / logo

The logo has a transparent background. `assets/icon.png|icns|ico|icon256.png` are the app icons and `assets/tray*.png` the menu-bar/tray icons (macOS tray uses the black-ink template versions). The menu header shows the logo from `src/panel/logo.png` as a mask, so it follows the Dark/Light theme. macOS also sets the Dock icon from `assets/icon.png` at startup. The original icons are kept in `assets/previous-icon/`. After changing icons, quit and relaunch (or rebuild the installer) to see them in the Dock/taskbar.

## Folders and the inventory overlay

Folders are saved in the app settings (`folders`, see `src/shared/folders.js`), never inside a chain file, so sharing and the original app are unaffected. The menu shows the folders and the chains that are in no folder; click a folder to open it, use the breadcrumb to go back, right-click a folder to rename, move or delete it (deleting never deletes chains). First run files your known chains into: Cursorchains (Cursor Rig OG Pack, Kinsectz Cursor Rig), Cursorbits and Cursor Emitters; anything else, and anything new, stays on the main menu. The Inventory now opens on top of the menu (the menu window grows while it is open). Cursor Emitters have a Wind strength slider.

Update: Cursorchains, Cursorbits and Cursor Emitters are the three kinds of cursorchain (the tabs on the menu, and the lists in the Inventory), not folders. Folders live inside a kind (for example Cursor Rig OG Pack inside Cursorchains) and only hold chains of that kind. New chains stay loose in their kind.

Heart cursorbits: `heart` (HART.stl) and `febheart` (Febheart.stl, reduced to 16k triangles to stay light) are single glowing hearts that orbit the cursor, always face the screen and leave a white trail. Regenerate with `node scripts/make-heart.mjs`. The menu panel is now much more opaque (`--panel-alpha` in `panel.css`), and the List view scrolls with the mouse wheel.


## Floor, walls and gravity
- Chains now collide with the floor and screen sides using hit boxes around each visible part (models included), not just the joints, so the whole shape rests on the floor instead of sinking into it.
- Touching the floor removes the vertical speed, so resting chains no longer bounce or twitch. If the cursor is below the floor (e.g. over the Dock) the chain just lies on the floor.
- Gravity is back at the original default (1); the Gravity slider in the menu lowers it per chain if you want it floatier.



## Saving and the Save incident
Saving, the live cursor refresh, spin pivot and the built-in debug log/screenshots are documented in `SAVE-AND-DEBUGGING-NOTES.md`. Read it before changing the editor, the overlay or spin. Short version: Longman's spin turned about the part's own origin, not the string, so a part lined up in the editor drifted on the cursor; it now twists about the string.

## .crig files (the universal share file)
A `.crig` is one file for any cursorchain, cursorbit or cursor emitter, **or a whole folder of them**. It is a ZIP holding a `manifest.json`, one `rigs/rN.json` per item (same schema as saved rigs) and the raw model files, with the folder structure recorded when you save a folder.
* **Save:** profile page "Generate .crig file", Inventory "Share .crig", the editor's "Share file", and right-click a folder > "Save as .crig…".
* **Open:** double-click a `.crig` (installed builds register the extension and use the app icon) or use Import. Everything lands on **Home**: a single item loose, a folder as a folder with its items inside. Nothing is overwritten: same ids get new ones, and a different model with the same file name is kept alongside (renamed).
* `.crig` is the only type the app owns (it gets the app icon and opens Cursor Rig on double-click), and it covers cursorchains, cursorbits, cursor emitters and packs (folders) of any of them.
* Older/backup files (`.cursorchain`, `.cursorbit`, `.cursoremitter`, `.cursorrig`) are still accepted by Import (and when dropped on the app) but are not registered with the system, so they keep their normal icon.
* Double-click needs an installed build (dmg/exe from `npm run dist:mac` / `dist:win`); running from the folder with the Start script has no file association, but Import and drag-to-open from the command line work.
