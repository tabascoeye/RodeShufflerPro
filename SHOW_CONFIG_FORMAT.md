# RODECaster show-config.bin format notes

These notes capture the parts of the format that the SPA currently depends on:
parsing pads, moving pads, duplicating pads, deleting pads, and keeping the
exported `.md5` in sync. The controlled samples in `example shows/` are much
cleaner than the earlier exploratory files, so the findings below prefer those
exports and delete older guesses where they conflict.

## Controlled sample set

All checked files parse as one complete node tree. The first real node starts at
byte `15`, the tree has `469` top-level roots, and there are no trailing bytes.
The matching `.md5` files are the raw 16-byte MD5 digest of `show-config.bin`.

| Show | Size | Pads | PADEFFECTS | Notes |
| --- | ---: | ---: | ---: | --- |
| `00_factory_fresh` | 104,554 | 22 | 17 | Fresh device factory show |
| `01_delete_applause` | 103,409 | 21 | 17 | Device-deleted simple sound pad |
| `02_delete_applause_and_large_robot` | 101,876 | 20 | 16 | Device-deleted one sound and one FX pad |
| `11_empty_from_same_factory` | 77,385 | 0 | 11 | Same factory lineage, all pads deleted |
| `12_empty_plus_one_sound_slot_8` | 78,585 | 1 | 11 | Added one sound pad at absolute slot `8` |
| `13_empty_plus_one_fx_slot_8` | 78,915 | 1 | 12 | Added one FX pad at absolute slot `8` |
| `14_empty_plus_one_censor_slot_8` | 78,489 | 1 | 11 | Added one mixer/censor pad at absolute slot `8` |
| `15_empty_plus_one_fx_slot_0` | 78,915 | 1 | 12 | Added one FX pad at absolute slot `0` with reverb/echo/megaphone/robot enabled |
| `15_test_fx_slot_0_padeffects_only_0` | 74,218 | 1 | 1 | SPA-generated import test keeping only the live `effectsIdx = 0` child |
| `16_test_added_2_fx` | 78,479 | 4 | 3 | Device accepted the one-entry PADEFFECTS test, then added one sound and two FX pads |

Root-level diffs from the controlled exports:

| Change | Root sections changed |
| --- | --- |
| `00_factory_fresh -> 01_delete_applause` | `SOUNDPADS` count `22 -> 21`, length `24618 -> 23473` |
| `01_delete_applause -> 02_delete_applause_and_large_robot` | `PADEFFECTS` count `17 -> 16`, length `7272 -> 6845`; `SOUNDPADS` count `21 -> 20`, length `23473 -> 22367` |
| `11_empty_from_same_factory -> 12_empty_plus_one_sound_slot_8` | `SOUNDPADS` count `0 -> 1`, length `12 -> 1211` |
| `11_empty_from_same_factory -> 13_empty_plus_one_fx_slot_8` | `PADEFFECTS` count `11 -> 12`, length `4710 -> 5137`; `SOUNDPADS` count `0 -> 1`, length `12 -> 1114` |
| `11_empty_from_same_factory -> 14_empty_plus_one_censor_slot_8` | `SOUNDPADS` count `0 -> 1`, length `12 -> 1115` |
| `11_empty_from_same_factory -> 15_empty_plus_one_fx_slot_0` | `PADEFFECTS` count `11 -> 12`, length `4710 -> 5137`; `SOUNDPADS` count `0 -> 1`, length `12 -> 1114` |
| `13_empty_plus_one_fx_slot_8 -> 15_empty_plus_one_fx_slot_0` | no root count/length changes; only field payloads differ |
| `15_test_fx_slot_0_padeffects_only_0 -> 16_test_added_2_fx` | `PADEFFECTS` count `1 -> 3`, length `440 -> 1294`; `SOUNDPADS` count `1 -> 4`, length `1114 -> 4521` |

Before the automatic cleanup pass was added, synthetic delete checks reproduced
the device exports byte-for-byte. This proved the separator/count rules below.
The current SPA intentionally removes orphan PADEFFECTS first, so current export
bytes can differ from the device's cruft-preserving exports while remaining
structurally cleaner.

| SPA operation | Device export matched |
| --- | --- |
| Remove `Applause` from `00_factory_fresh` | exactly equals `01_delete_applause` |
| Remove `Large Robot` from synthetic `01_delete_applause` | exactly equals `02_delete_applause_and_large_robot` |
| Remove `Large Robot` from device `01_delete_applause` | exactly equals `02_delete_applause_and_large_robot` |

## Node encoding

Nodes are named, null-terminated ASCII records.

```text
leaf node:              NAME 00 01 <field-count> <fields...>
counted container:      NAME 00 00 01 <child-count> <child nodes...>
empty container:        NAME 00 00 00
```

The parser's `node.end` points to the first byte after the node payload, before
the separator byte that follows sibling/root nodes. Those separators matter.

Observed child-container rules:

| Operation | Required byte behavior |
| --- | --- |
| Delete a child | Remove the child node plus its following `00` separator |
| Append to an empty container | Insert the new child plus one trailing `00` separator |
| Append to a non-empty container | Insert after the existing boundary separator, and add a new trailing separator |
| Replace a child | Replace only the node bytes; leave surrounding separators in place |

This separator rule was the missing piece for delete/import validity. Leaving
the separator behind made the root section lengths one byte too long for each
removed child.

The empty-container form is also important. `SOUNDPADS` with zero pads uses the
short header form and has no child-count byte. When changing between zero and
non-zero children, the container header must grow or shrink:

```text
empty:       SOUNDPADS 00 00 00
non-empty:   SOUNDPADS 00 00 01 <count>
```

The same count/header logic applies to `PADEFFECTS`, although the controlled
empty shows still contain its 11 baseline children.

## Field encoding

Fields are named, null-terminated records:

```text
FIELD_NAME 00 <length-marker> <payload-length> <payload>
```

Observed length markers:

| Marker | Meaning |
| --- | --- |
| `01` | one-byte payload length follows |
| `02` | two-byte little-endian payload length follows |

Observed payload tags:

| Payload | Meaning |
| --- | --- |
| `01` + 4 bytes | signed int32 little-endian |
| `04` + 8 bytes | float64 little-endian |
| `05` + bytes | UTF-8-ish string payload, usually null-terminated or padded |
| single byte `02` | boolean-like flag; often false, but field-dependent |
| single byte `03` | boolean-like flag; often true, but field-dependent |

Some payloads are still opaque bytes, such as `padProgressRequestSignal`.

## SOUNDPADS and PAD

`SOUNDPADS` is a container whose children are `PAD` leaf nodes. Empty pad slots
do not have placeholder PAD records; only occupied slots are physically present.

Important PAD fields:

| Field | Meaning |
| --- | --- |
| `padIdx` | Absolute 0-based pad slot across all banks |
| `padTriggerControl` | The absolute slot that triggers the pad |
| `padType` | Pad kind |
| `padName` | Display name |
| `padFilePath` | Sound file path for sound pads |
| `padColourIndex` | Color index |
| `padEffectInput` | Effect input/source selection; observed `19` and `20` distinguish otherwise identical FX pads |
| `padEffectTriggerMode` | Effect trigger behavior |

`padIdx` and `padTriggerControl` match in all controlled samples. Device-deleted
files keep slot gaps instead of renumbering remaining pads, so deletion must not
renumber other PAD nodes.

In `16_test_added_2_fx`, `Effect17` and `Effect18` are intentionally similar.
Their PAD nodes differ only in `padIdx`, `padTriggerControl`, `padName`,
`padColourIndex`, and `padEffectInput`. Their PADEFFECTS children differ only in
`effectsIdx`. This strongly places the selected input/source on the PAD, not in
the PADEFFECTS parameter node.

Observed pad types:

| `padType` | Sample names | Current SPA label |
| ---: | --- | --- |
| `1` | `Music_Bed`, `Sound9` | Sound |
| `2` | `Voice Disguise`, `Megaphone`, `Effect9` | Effect |
| `3` | `Censor`, `Ducking`, `Censor 9` | Mixer |
| `4` | `Trigger9` | Trigger |
| `6` | `Input 1`, `Scene A`, `Cut` | Action |

## PADEFFECTS relationship

`PADEFFECTS` appears before `SOUNDPADS`. It is a container of
`EFFECTS_PARAMETERS` leaf nodes. In the controlled samples each child is `426`
bytes and has `20` fields, including `effectsIdx`.

The zero-pad show still contains this 11-entry PADEFFECTS baseline:

```text
65, 11, 16, 17, 29, 18, 19, 21, 3, 0, 1
```

These baseline entries are preserved by device deletion. Deleting all factory
pads removes the six factory FX pad entries but leaves the baseline eleven. The
slot `0` FX sample proves that a baseline entry can also become the live
parameter entry for an FX pad: the slot `0` PAD has `padIdx = 0` and the
existing baseline `effectsIdx = 0` entry changes in place.

The device also accepted an SPA-generated file where all PADEFFECTS children
except the live `effectsIdx = 0` entry were removed. After adding one sound and
two FX pads on the device, the exported file contained only three PADEFFECTS
children: `0`, `16`, and `17`. The firmware did not recreate the full 11-entry
baseline list, so unused baseline PADEFFECTS entries are tolerated cruft rather
than required structure.

Type-2 FX pads have a linked `EFFECTS_PARAMETERS` child where
`effectsIdx === padIdx`. In `00_factory_fresh`:

```text
FX pad slots:       8, 9, 10, 12, 13, 14
PADEFFECTS extras:  8, 9, 10, 12, 13, 14
```

Controlled add/delete behavior:

| Device action | PADEFFECTS behavior |
| --- | --- |
| Add sound at slot `8` | unchanged |
| Add mixer/censor at slot `8` | unchanged |
| Add FX at slot `8` | append one `EFFECTS_PARAMETERS` child with `effectsIdx = 8` |
| Add FX at slot `0` | append one `EFFECTS_PARAMETERS` child with `effectsIdx = 8`, and modify the existing baseline `effectsIdx = 0` entry |
| Import file with only live `effectsIdx = 0`, then add FX at slots `16` and `17` | keep `effectsIdx = 0`, append `16` and `17`, do not recreate the baseline list |
| Delete simple sound | unchanged |
| Delete FX pad | remove the matching non-baseline `EFFECTS_PARAMETERS` child |

Current SPA ownership rule:

- Link FX pads to the last `EFFECTS_PARAMETERS` child whose `effectsIdx` matches
  the pad slot.
- On load, remove every PADEFFECTS child that is not linked to a type-2 FX PAD.
- If multiple PADEFFECTS children share an `effectsIdx`, the linked child is the
  one used by the FX pad and the extras are removable cruft.
- If an FX pad lands on a slot that already has an unlinked PADEFFECTS entry,
  reuse/replace that entry instead of appending another duplicate.

The appended `effectsIdx = 8` entry in the slot `0` device sample is still not
fully explained. Since the device later accepted and continued from a pruned
one-entry PADEFFECTS file without recreating that `8` entry, it looks more like
cruft from the editing path than required data.

The effect `*On` fields also need special care. In the slot `0` sample the user
enabled reverb, echo, megaphone, and robot, and those fields changed from raw
single-byte value `03` to `02` in the baseline `effectsIdx = 0` entry. Other PAD
boolean fields still look like `03` means enabled/active, so the single-byte
`02`/`03` tags should not be treated as one global boolean semantic without
field context.

## Mutation rules for the SPA

Moves and swaps:

1. Keep PAD nodes physically present; moving a pad is mostly index patching.
2. Patch the moved PAD's `padIdx` and `padTriggerControl` to the new absolute
   slot.
3. If the PAD is type `2` and has a linked PADEFFECTS child, keep its
   `effectsIdx` consistent with the new slot.
4. Keep only PADEFFECTS entries that remain linked to type-2 FX pads.

Duplication:

1. Copy the whole source PAD node.
2. Patch the copied `padIdx` and `padTriggerControl` to the target slot.
3. Insert the copied PAD into `SOUNDPADS`, or replace the target PAD when
   overwriting an occupied slot.
4. Update the `SOUNDPADS` container header/count, including the zero/non-zero
   header form.
5. If duplicating a type-2 FX pad, copy its linked `EFFECTS_PARAMETERS` child and
   patch `effectsIdx` to the target slot.
6. Replace an existing target PADEFFECTS child when the target slot already has
   one. Append only when no target entry exists.

Deletion:

1. Physically remove the PAD node plus its following separator.
2. Update the `SOUNDPADS` container header/count.
3. If deleting a type-2 FX pad with a linked PADEFFECTS child, remove that child
   plus its separator and update the `PADEFFECTS` count.
4. Do not renumber remaining pads.

Do not update `INPUTSOURCE.inputId`; the samples keep it as an input identifier,
not a pad count.

## MD5 files

The matching `.md5` files contain the raw 16-byte MD5 digest of
`show-config.bin`. The app may accept a text hex digest when checking, but it
exports the raw 16-byte form used by the device samples.

## Open questions

- A direct device sample deleting the slot `0` FX pad from the pruned/imported
  lineage would show whether the device removes or restores the remaining
  `effectsIdx = 0` entry when no FX pad uses it anymore.
- More baseline-slot FX adds (`1`, `3`, `11`, `16`, `17`, `18`, `19`, `21`,
  `29`, or `65`) would show whether the extra appended `effectsIdx = 8` entry is
  specific to slot `0` or a general device quirk.
- The exact meaning of `padEffectInput` is not fully mapped. Factory effect pads
  use `0`, while some earlier one-pad experiments used other values.
- Pad type `6` is labeled from observed names and icons, but its full subtype
  model is still not mapped.
