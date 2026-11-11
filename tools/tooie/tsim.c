// Claude 2026-11-11 (tsim.c): Tooie collision model vs emulator fall-in traces. usage: tsim room.txt emu.txt [verbose spot]
#include "tcol.h"
#include "troom.h"
#include <string.h>
static TAct ACT[TMAXACT];
typedef struct { int vi, hits, held, gnd; float x, y, z; char st[8]; } EU;
int main(int argc, char **argv) {
  TWorld w; load_world(argv[1], &w); FILE *f = fopen(argv[2], "r"); int verbose = argc > 3 ? atoi(argv[3]) : -1;
  char tag[16], out[16]; int n, nu; double sx, sy, sz; int tot = 0, exact = 0, outagree = 0; int cnt[4][4] = { { 0 } };
  static EU U[400];
  while (fscanf(f, " S %d %lf %lf %lf %d %15s %15s", &n, &sx, &sy, &sz, &nu, tag, out) == 7) {
    for (int k = 0; k < nu; k++) if (fscanf(f, "%d %f %f %f %d %d %d %7s", &U[k].vi, &U[k].x, &U[k].y, &U[k].z, &U[k].hits, &U[k].held, &U[k].gnd, U[k].st) != 8) return 3;
    float pos[3] = { (float)sx, (float)sy, (float)sz }, v[3] = { 0, 0, 0 }; int gnd = 1; TTrack tr; memset(&tr, 0, sizeof tr); tr.posZ = 56.0f; tr.mode = 2;
    int first = -1; float y0 = pos[1]; float lasty = pos[1];
    for (int k = 0; k < nu; k++) {
      float dt = U[k].vi * 0.016666668f; if (dt > 0.050000004f) dt = 0.050000004f;
      v[1] = v[1] + dt * -2700.0f; if (v[1] < -4000.0f) v[1] = -4000.0f;
      float disp[3] = { v[0] * dt, v[1] * dt, v[2] * dt }, tgt[3] = { pos[0] + disp[0], pos[1] + disp[1], pos[2] + disp[2] };
      TRes R; resolve(&w, &tr, pos, tgt, disp, gnd, 80.0f, 35.0f, TFILT_FLOOR, &R, ACT);
      vcp(pos, R.out); gnd = R.grounded; if (gnd && v[1] < 0.0f) v[1] = -1.0f; lasty = pos[1];
      int ok = fabsf(pos[0] - U[k].x) < 2e-3f && fabsf(pos[1] - U[k].y) < 2e-3f && fabsf(pos[2] - U[k].z) < 2e-3f && R.hits == U[k].hits;
      if (n == verbose) printf("  %2d vi%d model (%.5f %.4f %.5f) hits %d held %d gnd %d floor %.2f | emu (%.5f %.4f %.5f) hits %d held %d gnd %d st %s %s\n", k + 1, U[k].vi, pos[0], pos[1], pos[2], R.hits, R.held, gnd, tr.floor_y,
        U[k].x, U[k].y, U[k].z, U[k].hits, U[k].held, U[k].gnd, U[k].st, ok ? "" : "<<");
      if (!ok && first < 0) first = k + 1;
    }
    tot++; if (first < 0) exact++;
    const char *mo = lasty < y0 - 115 ? "CLIP" : lasty >= y0 - 0.5f ? "EJECT" : "STUCK";
    const char *eo = !strcmp(out, "NOMISS") ? "EJECT" : out; if (!strcmp(mo, eo)) outagree++;
    if (verbose == -2) printf("SPOT %d %s %s emu %s model %s firstdiff %d\n", n, tag, "", out, mo, first);
  }
  printf("%d spots: trace equal %d, outcome agrees %d\n", tot, exact, outagree);
}
