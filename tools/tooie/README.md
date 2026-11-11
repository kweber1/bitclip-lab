# Banjo-Tooie bit-clip census tools

Builds `tooie/` (the Banjo-Tooie section of the lab). Nothing here contains game data; the ROM is read locally.

| file | what it does |
|---|---|
| `btassets.py` | Banjo-Tooie (USA) asset table + level-model reader (collision header, cells, triangles). `BT_ROM`, `BT_DEC` = the ROM and the decomp's decompressed ROM. |
| `bt_rooms.py` | every level's collision (one room per distinct opaque/transparent model pair) → `rooms/*.json`, `txt/*.txt`. `BT_DECOMP` = a checkout of github.com/mr-wiseguy/banjo-tooie (map names). |
| `mkroom.py` | room json → the plain-text room `tcensus` reads (original Tooie triangle flags). |
| `tcol.h` | **Tooie player collision, ported from the ROM's asm**: line test `func_800AB0BC`, moving sphere `func_800AC638` (+ `func_800ABCE0`, `func_800AC100`), sphere `func_800AC978`, floor tracker (mode 2), resolver `func_800D4584`. Plain C that also builds as CUDA. |
| `tcensus.cu` | the census for one room: seams → every float along each seam (Tooie floor ray) → cracks → fall-in runs (no lag + lag on update 1–8) → 42 jump landings for spots that don't go through. CPU: `g++ -x c++ -O2 -ffp-contract=off -fopenmp -DTCPU -o tcensus tcensus.cu -lm -lpthread`; GPU: `nvcc -O3 --fmad=false -prec-div=true -prec-sqrt=true -o tcensus tcensus.cu`. `TC_EVERY=1` = exhaustive mode (every crack float tested, results per 0.25 cell). |
| `tsim.c` | replays BizHawk fall-in traces through `tcol.h` and compares update by update. |
| `bt_fallin.lua` | BizHawk: put Banjo on each crack (exact floats), let him fall, log every resolver call. |
| `bt_jump.lua` | BizHawk: Tooie's jump profile (tap A: apex 92, held: 174.46; gravity −1350 while A is held going up, −2700 otherwise). |
| `tooie_census_run.py` | runs the GPU build on every room (checks GPU = CPU first). |
| `tooie_every_run.py` | the exhaustive census (`TC_EVERY=1`, `TC_ZEROPART=2`: every crack float except those within ±1 of 0 on a seam's long axis) on every room, with byte-for-byte checks of new builds against finished levels before they are used. |
| `site_build.py` | census output → `tooie/data/room-<map>.gz.wasm` + `tooie/data/index.json`. |

Validation (GI Basement, 625 cracks fallen into in BizHawk): every spot with nothing else moving Banjo (no fan, slope slide or prop) gives the same result update by update on 346 of 350 and the same outcome on all of them. The Kazooie collision code (`bkcol.js`) gave 188 of 625. Tooie changes several things: the fallback push is 2 units instead of the radius, there is a new flat-floor edge push of 2·(pass+1)² that also applies on slopes (n.y > 0.6), normals are scaled ×1e‑5 instead of ÷1e5, line tests skip back faces, and barycentrics use 1/den.
