# Rode Shuffler Pro

Small offline Web GUI for exploring and remapping RØDECaster Duo / Pro II smart
pad layouts from `show-config.bin`.

## What it does today

- Uploads a `show-config.bin` and optionally validates a matching `.md5`.
- Walks the full binary tree to find the real root parse instead of relying on a
  hardcoded `SOUNDPADS` offset.
- Parses the real `SOUNDPADS` container and its child `PAD` objects.
- Reads names, type IDs, colour indices, file paths, trigger fields, and slot
  indices directly from the binary.
- Lays pads out in 2x3 banks for Duo and 2x4 banks for Pro II.
- Lets you drag/drop pads between slots.
- Exports a remapped `show-config.bin` plus a raw 16-byte `show-config.md5`.

## Current binary findings

- `SOUNDPADS` is a container node, not a flat object.
- The sample file starts with a short `Rodecaster` header and the first real
  structured root begins at byte `15`.
- Containers use `name + NUL + 0x00 0x01 + count`.
- Empty containers can use `name + NUL + 0x00 0x00`.
- Leaf objects such as `PAD` use `name + NUL + 0x01 + count`.
- The full sample tree contains `469` top-level roots and `5` containers, and
  the parser now walks cleanly through the entire file.
- Fields can use either a 1-byte or 2-byte payload length marker.
- On the attached Duo show, `padIdx` and `padTriggerControl` match for every pad
  and behave like the absolute slot position across the full 48-slot layout.

## Run it

Open [index.html](./index.html) directly in your browser.

No server is required for normal use. The app parses files, computes MD5, and
generates downloads entirely in the browser.

## Sources consulted

- RØDECaster Duo SMART pad guide:
  [rode.com/en-au/user-guides/rodecaster-duo/using-the-smart-pads](https://rode.com/en-au/user-guides/rodecaster-duo/using-the-smart-pads)
- RØDECaster Pro II SMART pad guide:
  [rode.com/cn-cn/user-guides/rodecaster-pro-ii/using-the-smart-pads](https://rode.com/cn-cn/user-guides/rodecaster-pro-ii/using-the-smart-pads)
- RØDE help article on show export/import:
  [help.rode.com/.../Exporting-and-Importing-Shows-with-R%C3%98DECaster-Pro-II-Duo-Using-MicroSD-Card-and-USB-Drives](https://help.rode.com/hc/en-us/articles/7985588962191-Exporting-and-Importing-Shows-with-R%C3%98DECaster-Pro-II-Duo-Using-MicroSD-Card-and-USB-Drives)
- RØDECaster Pro II / Duo release notes:
  [update.rode.com/notes/rcp2/](https://update.rode.com/notes/rcp2/)
