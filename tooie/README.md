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
