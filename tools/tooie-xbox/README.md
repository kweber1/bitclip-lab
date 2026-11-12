# Banjo-Tooie Xbox 360 (XBLA): how the Xbox census was made

The Xbox 360 port (`Banjo2_CPR.exe`, title 0x58410955) runs the N64 game's collision code on the N64 level collision (Spiral Mountain's collision and vertex data in the running game match the N64 ROM exactly, apart from animated water). Its PowerPC compiler fused multiply-adds (`fmadds`, `fmsubs`, `fnmsubs`: one rounding instead of two) and added dot products in another order. The cracks fall on different floats, so the Xbox census (`../tooie/tcensus.cu -DTX360`) uses the 360's exact operations.

| 360 function | what | fused / reordered |
|---|---|---|
| 0x8228CB40 | dot product | `x*x' + (z*z' + y*y')` |
| 0x8228CE80, 0x8228D118, 0x8228D1C8, 0x8228DAD0 | length², normalize, set length | `z*z + (x*x + y*y)` |
| 0x8228CBA0 | distance² | `dx*dx + (dz*dz + dy*dy)` |
| 0x8228CA48 | cross product | one product of each component fused |
| 0x82227850 | line test (N64 func_800AB0BC) | hit point `d*t + s`, barycentrics |
| 0x82228270 / 0x82228630 / 0x822289D0 / 0x82228C88 | sphere fast check, iteration, moving sphere, sphere (func_800ABCE0 / 800AC100 / 800AC638 / 800AC978) | plane point, barycentrics, edge distance, bisection point |
| 0x82259E08 | resolver (func_800D4584) | `|d|²` inline in y, z, x order |
| 0x822C2018 | normal push (func_800FAF78) | `u0 + n*ph` |
| 0x820BA934 | gravity | `vy + dt*g` |

Everything else (floor tracker 0x82246D28, ray pieces 0x82246B58, cell ranges, map providers 0x8224B660/B808/B920) has no fused operations.

## Checked in the game
In Xenia, Banjo's position was written at guest 0x003F0B8C and his vertical velocity at 0x003F0A68 (set to 0, as the census starts). Then his height was sampled every 4 ms. 85 exact floats near Spiral Mountain's start were tested, most of them chosen where the N64 and Xbox models disagree (N64 solid / Xbox falls through, and the reverse; N64 ejects / Xbox solid, and the reverse). Every one behaved as the Xbox model says, with the same lowest height where compared. The exception was five spots inside an object's push radius around (3724, 5212), where Banjo was moved away on the first update.

Caveat: Xenia rounds `fmadds` through double precision, while real hardware rounds once. The two can differ only in rare double-rounding cases.

## Files
* `xfun.py`: functions (`.pdata`), call graph, float constants, disassembly of the decrypted image (capstone).
* `xsym.py`: a function's float data flow written out symbolically, to compare its operation order with the N64 port.
* `xcrack.c`: floor-ray cracks with the N64 vs the 360 order, on a room's seams near a point.
The Xenia tools (position finder, teleport tester, collision dump, keyboard driving) are on the lab PC in `mods/sc64-crack-brute/xenia_*.py`.
