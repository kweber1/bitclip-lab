# Bit-Clip Lab — Banjo-Tooie

https://kweber1.github.io/bitclip-lab/tooie/

Every Banjo-Tooie (USA) level's floor cracks, from a GPU census with the game's own collision code ported from the ROM. Each crack is tested by standing still on it and falling in. That is done once with no lag and once with a lag frame on each of updates 1–8. If that never goes through, Banjo also jumps onto it (42 landing heights from a tap jump to a full jump).

Categories: **falls through (walk in)**, **falls through with a lag frame**, **jump needed**, **ejected**, **stuck in the floor**, **wall pushes off**, **water**. A **hold** means all 5 resolver passes hit in one update.

Data: `data/index.json` (all levels, filled in as the census finishes each one) and `data/room-<map>.gz.wasm` (gzipped JSON: collision mesh, seams, every crack spot with its exact floats and results). Tools: `../tools/tooie/`.

## Textures in the game look

The game look is drawn with **textures the Bit-Clip Lab paints itself** (`tooie/tex/`), not the game's art. For each original
texture only a short numeric description is measured: its colour ramp (overall and per quarter, so blends like grass into a path
keep their tones), contrast, transparency coverage, which way its lines run and how many repeat, and a guessed kind of surface
(noise, panel, brick, tiles, planks, slats, sign, water, cutout, glow). A procedural painter (`tools/tooie/btgen.py`) then makes a
new texture from that description, seeded by the texture id, at the original's size and tiling, so it sits on the level with the
game's own texture coordinates. Signs, faces and pictures come out as plain material. Untick *Textures (lab-made)* to see the
level with its vertex shading only.

### HD textures (BT Reloaded)

Where the [BT Reloaded](https://github.com/GhostlyDark/BT-Reloaded) HD pack by GhostlyDark and contributors has a replacement
for a texture, the viewer shows it by default (layer *HD where available*). Textures are matched the way GLideN64 matches
texture packs: the Rice checksum of the texture data and, for colour-indexed textures, of the used part of the palette
(`tools/tooie/btrice.py`). The images load straight from the pack's own GitHub repository (pinned commit); nothing from the pack
is copied into this repository. `tooie/data/hd.json` holds only the texture key -> pack file name list.

## Objects and enemies

Every map's objects are drawn in the view (layer *Objects & enemies*): collectables (notes, nests, Jiggies, Jinjos, honeycombs),
NPCs, enemies, pads, doors and other props. They come from BizHawk dumps of each map (`bt_objects.lua`, `bt_nodes.lua`):
the cube grid's spawn points (every actor the map can spawn, including enemies that have not spawned yet), the actors present
8 s after entering, and the static props. Each object with a known model is drawn with that model at its position, yaw and
scale, with the same lab-made / HD textures; the rest (triggers, spawners, ids whose model is not known yet) are small orange
markers (layer *Other objects (markers)*, on by default). Click an object for its id, model and exact position. Objects are not part of the crack census.

Floors that the level's display lists never draw (e.g. the Gatehouse mirror floor, drawn by a special effect in game) are filled
in grey from the collision so the game look has no holes.
