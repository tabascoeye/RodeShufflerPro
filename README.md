# Rode Shuffler Pro

Offline browser app for rearranging RØDECaster Duo / Pro II Smart Pads inside a
`show-config.bin`.

The app parses the show file locally, displays the pad banks, lets you move,
duplicate, and delete pads, then exports a modified `show-config.bin` plus a
matching raw device-style `show-config.md5`.

## Use It

Open [index.html](./index.html) in a browser. No server, upload, or network
access is required.

1. Load a `show-config.bin`.
2. Drag pads to move or swap them.
3. Hold Alt/Option before dropping to duplicate a pad.
4. Select a pad and press Backspace/Delete to remove it.
5. Download the edited BIN and MD5 files.

## Current Behavior

- Auto-detects RØDECaster Duo vs Pro II from the parsed show.
- Cleans unlinked `PADEFFECTS` entries before editing.
- Keeps FX pads linked to their corresponding `EFFECTS_PARAMETERS` entries when
  moving, duplicating, deleting, or overwriting pads.
- Lets FX pads switch between wired mic, headset, and wireless mic inputs.
- Preserves empty slots as gaps instead of renumbering the remaining pads.

## File Format Notes

The binary format findings live in [SHOW_CONFIG_FORMAT.md](./SHOW_CONFIG_FORMAT.md).
Keep detailed parser discoveries there so the README can stay focused on using
the app.

## Project Shape

- [index.html](./index.html) is the static app shell.
- [src/app.js](./src/app.js) owns UI state and interactions.
- [src/rodecaster.js](./src/rodecaster.js) parses and mutates the show binary.
- [src/md5.js](./src/md5.js) generates the companion checksum file.
- [example shows/](./example%20shows/) contains device exports used for format
  research and regression checks.
