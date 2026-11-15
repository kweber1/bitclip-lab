# Banjo-Tooie bit-clip census tools

Builds `tooie/` (the Banjo-Tooie section of the lab). Nothing here contains game data; the ROM is read locally.

| file | what it does |
|---|---|
| `btassets.py` | Banjo-Tooie (USA) asset table + level-model reader (collision header, cells, triangles). `BT_ROM`, `BT_DEC` = the ROM and the decomp's decompressed ROM. |
| `bt_rooms.py` | every level's collision (one room per distinct opaque/transparent model pair) → `rooms/*.json`, `txt/*.txt`. `BT_DECOMP` = a checkout of github.com/mr-wiseguy/banjo-tooie (map names). |
| `mkroom.py` | room json → the plain-text room `tcensus` reads (original Tooie triangle flags). |
| `tcol.h` | **Tooie player collision, ported from the ROM's asm**: line test `func_800AB0BC`, moving sphere `func_800AC638` (+ `func_800ABCE0`, `func_800AC100`), sphere `func_800AC978`, floor tracker (mode 2), resolver `func_800D4584`. Plain C that also builds as CUDA. |
| `tcol.h -DTX360`, `tcensus.cu -DTX360`, `wasm/tsim.cpp -DTX360` | **Xbox 360 (XBLA) version**: the same code with the 360 build's fused multiply-adds and dot-product order, from `Banjo2_CPR.exe` (see `../tooie-xbox/`). Checked in Xenia on 85 exact floats. |
| `tcensus.cu` | the census for one room: seams → every float along each seam (Tooie floor ray) → cracks → fall-in runs (no lag + lag on update 1–8) → 42 jump landings for spots that don't go through. CPU: `g++ -x c++ -O2 -ffp-contract=off -fopenmp -DTCPU -o tcensus tcensus.cu -lm -lpthread`; GPU: `nvcc -O3 --fmad=false -prec-div=true -prec-sqrt=true -o tcensus tcensus.cu`. `TC_EVERY=1` = exhaustive mode (every crack float tested, results per 0.25 cell). |
| `tsim.c` | replays BizHawk fall-in traces through `tcol.h` and compares update by update. |
| `bt_fallin.lua` | BizHawk: put Banjo on each crack (exact floats), let him fall, log every resolver call. |
| `bt_jump.lua` | BizHawk: Tooie's jump profile (tap A: apex 92, held: 174.46; gravity −1350 while A is held going up, −2700 otherwise). |
| `tooie_census_run.py` | runs the GPU build on every room (checks GPU = CPU first). |
| `tooie_every_run.py` | the exhaustive census (`TC_EVERY=1`, `TC_ZEROPART=2`: every crack float except those within ±1 of 0 on a seam's long axis) on every room, with byte-for-byte checks of new builds against finished levels before they are used. |
| `site_build.py` | census output → `tooie/data/room-<map>.gz.wasm` + `tooie/data/index.json`. |
| `tcensus.cu` `TC_ZL=1` | **zero-line run** (2026-11-14): only the seams lying on x = 0 or z = 0, with the across offsets o × 1e-10 (o = ±1..3) instead of the ±3 float steps, which are denormals there. On such a seam one floor triangle (reference corner far from 0) loses a tiny offset in the subtraction while the other sees it exactly, so the floor ray can miss both a hair off the line; walking from a load-in point at z = 0 reaches it. |
| `tcensus.cu` `TC_ZEROPART=3` | **near-zero run** (2026-11-15, the user's choice): within ±1 of 0 on a seam's long axis (which phase A skips) every float with \|m\| ≥ 0.00001, and below that a ladder of ~1,050 floats (first, second, middle and last float of every power-of-two band down to the denormals, and ±0). Testing every float there would be ~1.8 trillion crack floats per version (79% within 1e-10 of 0, all acting like the same spot). `TC_ZPTEST=n` keeps only n floats per side next to ±0.00001 (GPU = CPU checks). |
| `trb_zl_patch.py` | adds a zero-line run (flag `zl`), a near-zero run (`zp`) or its zero-line pass (`zpzl`) to a published room file in place (merged cells: counts add up, the better category's float is kept; new cells appended; header and index counts; `zl: 1`). `tc_merge_zl.py` does the same on the census text files (for `site_build.py`). The viewer's float list (`wasm/tsim.cpp` `ts_zl`) scans zero-line seams a second time with those offsets when the room has `zl`. |

Validation (GI Basement, 625 cracks fallen into in BizHawk): every spot with nothing else moving Banjo (no fan, slope slide or prop) gives the same result update by update on 346 of 350 and the same outcome on all of them. The Kazooie collision code (`bkcol.js`) gave 188 of 625. Tooie changes several things: the fallback push is 2 units instead of the radius, there is a new flat-floor edge push of 2·(pass+1)² that also applies on slopes (n.y > 0.6), normals are scaled ×1e‑5 instead of ÷1e5, line tests skip back faces, and barycentrics use 1/den.
