# Bit-Clip Lab — Banjo-Tooie

https://kweber1.github.io/bitclip-lab/tooie/

Every Banjo-Tooie (USA) level's floor cracks, from a GPU census with the game's own collision code ported from the ROM. Each crack is tested by standing still on it and falling in. That is done once with no lag and once with a lag frame on each of updates 1–8. If that never goes through, Banjo also jumps onto it (42 landing heights from a tap jump to a full jump).

Categories: **falls through (walk in)**, **falls through with a lag frame**, **jump needed**, **ejected**, **stuck in the floor**, **wall pushes off**, **water**. A **hold** means all 5 resolver passes hit in one update.

Data: `data/index.json` (all levels, filled in as the census finishes each one) and `data/room-<map>.gz.wasm` (gzipped JSON: collision mesh, seams, every crack spot with its exact floats and results). Tools: `../tools/tooie/`.
