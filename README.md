# Cursor Rig

Hang a physics-simulated keychain from your mouse cursor. Cursorchains swing and collide with your screen edges and the Dock or taskbar, cursorbits orbit the cursor, and cursor emitters shed petals, feathers and other drifting things. A built-in 3D editor lets you build your own from segments and models.

The overlay never takes clicks, so you keep working normally.

## Download

Get the latest from the **[Releases page](../../releases/latest)**:

| | File |
|---|---|
| **Mac, Apple Silicon (M1 and newer)** | `Cursor-Rig-<version>-arm64.dmg` |
| **Mac, Intel** | `Cursor-Rig-<version>-x64.dmg` |
| **Windows** | `Cursor-Rig-Setup-<version>.exe` (installer) or `Cursor-Rig-Portable-<version>.exe` |

Not sure which Mac you have? Apple menu > About This Mac. "Apple M1/M2/..." means Apple Silicon.

**Mac first launch:** open the `.dmg`, drag Cursor Rig into Applications, eject the disk image, then **right-click the app > Open** and choose Open again. The app is not notarized by Apple, so a normal double-click is blocked the first time. If macOS still says it is damaged, run `xattr -cr /Applications/Cursor\ Rig.app` in Terminal.

**Windows first launch:** SmartScreen may warn about an unknown publisher. Click *More info > Run anyway*.

## Your cursors

The app comes with **no cursors pre-loaded**. Cursor collections are separate `.crig` files, attached to the release or shared by other people. To add them, double-click a `.crig` file, or use **Import** in the menu. Folders inside a `.crig` come through as folders.

There are three kinds, each with its own tab:

* **Cursorchains:** hang from the cursor and swing with real physics.
* **Cursorbits:** orbit around the cursor, faster when you move faster.
* **Cursor emitters:** shed a stream of drifting things as you move.

Folders can hold one kind or be shared across all three. To pass things on, use **Share .crig** (or right-click a folder > Save as .crig).

## Using it

| | |
|---|---|
| **Ctrl + Alt + R** | Open / close the menu |
| **Ctrl + Alt + H** | Show / hide the rig |
| Tray / menu bar icon | Opens the menu; right-click for the editor and Quit |

Both hotkeys can be changed in the menu. The menu has the library, the inventory (search, sort, favourites, folders), size, gravity, extra drag, opacity, wind, and options for resting on the Dock or taskbar and using the screen edges as walls. *Performance mode* is there for older computers.

## Making your own

Open the **editor** from the menu to build a chain from segments, add primitives or import `.glb`, `.gltf`, `.obj` or `.stl` models, press Space to preview the physics, and use *Use on desktop* to hang it from your real cursor. **Check** points out settings that make a chain look stiff or twitchy. More detail is in [DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md).

## Updates

Updates arrive from inside the app (the About button shows a dot; press Update). Every update is cryptographically signed, so the app refuses anything that isn't from the author, and your cursors and settings are never touched.

## Your data

Everything lives in your own data folder:

* **Mac:** `~/Library/Application Support/Cursor Rig`
* **Windows:** `%APPDATA%\Cursor Rig`

Back that folder up if you have made cursors you care about. You can also use **Export all** in the menu to save everything as one `.crig`.

## Notes

* Exclusive-fullscreen games draw over everything, including the overlay. Borderless-windowed games work.
* Quit any other copy of Cursor Rig before starting this one: they share the same data folder.

## Running from source

Needs Node.js 18 or newer:

```
npm install
npm start
```

On Mac, double-clicking `Start Cursor Rig.command` does the same, and on Windows use `Start Cursor Rig.bat`. Building and publishing releases is covered in [RELEASING.md](RELEASING.md).
