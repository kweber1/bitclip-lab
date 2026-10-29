# bkpc — GPU punch-cancel clip search

CUDA/C++ port of the standing punch-cancel search in `bkclipsetup.js` (solve), with the movement engine (`bkmove.js`, the
states a punch cancel uses) and the collision resolver (`bkcol.js`, via the lab's OpenCL port `bkcl.cl`, regenerated as
`bkcol_port.h`).

- `pack.js <spots.json> <job.bin> [--pats none|single|early|LIST] [--cancel ..] [--hold ..] [--dirs 8] [--maxupd 40] [--nostand]`
  writes the room, the flat test floors, the acos table and the search grid.
- `bkpc job.bin out.txt` runs it on the GPU (`--cpu N` runs the first N cases on the CPU). Output lines:
  `s yi pi qi k holds clipAt clip endY x0bits z0bits` (indices into the job's spots / facings / A timings / lag patterns).
- `ref.js` runs the same job with the JavaScript engine in the same output format.
- Build: `build.cmd` (nvcc 11.8, `-fmad=false -prec-div=true -prec-sqrt=true -ftz=false`), or `g++ -x c++ bkpc.cu` for the CPU build.

GPU (RTX 4090) results are identical line for line to the CPU build on both checks below (about 50k cases/s).
`gpucheck.py` builds and runs those checks; `gpurun.py <name> <maxdist> <pats>` runs a job on every crack in all950.json within maxdist of the 260 door and writes `<name>_summary.txt`.

Checks (CPU build vs JavaScript): spot 1 with every single-lag pattern 42,912/42,912 identical results; 6 random cracks with
early-lag patterns 15,372/15,372 identical (start floats, holds, clip, final height).
Note: the JavaScript search shares one World (stored triangle) between cloned players; bkpc gives every replay its own,
which can differ next to walls.
