# Bit-Clip Lab

A Banjo-Kazooie floor-crack ("bit clip") lab: a 3D viewer of every room's collision with every crack, 5-hit hold, slope clip and loading zone, plus exact simulators and route searches.

**Open it:** https://kweber1.github.io/bitclip-lab/

- Collision, movement and the collision resolver are bit-exact ports of the game (PAL and NTSC), checked against BizHawk.
- Route search (run-up + jump, run-up + any move, chain of moves) and the exact 810-method search run in your browser on all CPU cores; the exact search can also use the graphics card (WebGPU).
- Data: 88 rooms, extracted from the ROM (no game files are included; the room data is collision geometry and census results only).

Everything is static: the page runs entirely in the browser.
