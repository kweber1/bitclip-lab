// bkpc_search.h -- standing punch-cancel clip search for one (crack, facing, A timing, lag pattern), as in bkclipsetup.js solve():
// find the update the foot reaches the floor on a flat test floor, walk the x/z steps back from the crack to the exact start
// float, play the move in the real room from there (standing check first) and judge hold / clip.
#pragma once
#include "bkmove_port.h"

#define MAXUPD 40
#define MAXLAG 4
struct Job { int nspots, nyaw, nparam, npat, maxUpd, standCheck; };
struct Hit { int s, yi, pi, qi, k, holds, clipAt, clip; float endY, x0, z0, pad; };

static HD inline float nextF(float x, int dir) {
  union { float f; uint u; } c; c.f = x;
  if (x == 0) { c.u = dir > 0 ? 1u : 0x80000001u; return c.f; }
  if ((x > 0) == (dir > 0)) c.u++; else c.u--; return c.f;
}
// every float a near (target - inc) with f32(a + inc) == target, nearest first, at most keep
static HD int preimages(float target, float inc, int keep, float *out) {
  int n = 0; float base = (float)((double)target - (double)inc); float a = base;
  for (int i = 0; i < 48 && n < keep; i++) a = nextF(a, -1);
  float tmp[96]; int nt = 0; float b = a; for (int i = 0; i < 96; i++) { if ((b + inc) == target) tmp[nt++] = b; b = nextF(b, 1); }
  // stable sort by |p - base| (JS Array.sort is stable)
  for (int i = 1; i < nt; i++) { float v = tmp[i]; double dv = fabs((double)v - (double)base); int j = i - 1;
    while (j >= 0 && fabs((double)tmp[j] - (double)base) > dv) { tmp[j + 1] = tmp[j]; j--; } tmp[j + 1] = v; }
  for (int i = 0; i < nt && n < keep; i++) out[n++] = tmp[i];
  return n;
}
static HD int invertChain(float target, const float *incs, int ninc, int keep, float *outc) {
  float cands[16]; int nc = 1; cands[0] = target;
  for (int i = ninc - 1; i >= 0; i--) {
    float inc = incs[i]; float next[64]; int nn = 0;
    for (int c = 0; c < nc; c++) {
      if (inc == 0) { next[nn++] = cands[c]; continue; }
      float pre[8]; int np = preimages(cands[c], inc, keep, pre);
      for (int q = 0; q < np; q++) { int dup = 0; for (int j = 0; j < nn; j++) if (next[j] == pre[q]) { dup = 1; break; } if (!dup && nn < 64) next[nn++] = pre[q]; }
    }
    nc = nn < keep * 2 ? nn : keep * 2; for (int j = 0; j < nc; j++) cands[j] = next[j];
    if (!nc) return 0;
  }
  for (int j = 0; j < nc; j++) outc[j] = cands[j]; return nc;
}
static HD inline Inp pc_inp(int i, int c, int h) { Inp r; r.B = (i == 0); r.A = (i >= c && i < c + h); r.Z = 0; return r; }
static HD inline int has_lag(const int *lag, int i) { for (int q = 0; q < MAXLAG; q++) if (lag[q] == i) return 1; return 0; }

// returns number of hits written (0..MAXUPD), one per arrival that holds or clips
static HD int pc_case(const Room &RR, const Room &FR, const unsigned short *ACOS, const Job &J, double X, double Y, double Z, float yaw, int c, int h, const int *lag,
                      Hit *out, int *bad) {
  float tx = (float)X, ty = (float)Y, tz = (float)Z; int maxUpd = J.maxUpd; int nout = 0;
  // 1. arrivals on the flat floor (no lag)
  int arr[MAXUPD]; int na = 0;
  { Player P; pl_init(FR, ACOS, P, 0, 0.0f, ty, 0.0f, yaw); float prevY = P.pos[1];
    for (int i = 0; i < maxUpd; i++) { pl_step(FR, ACOS, P, pc_inp(i, c, h), 2); int moved = P.lastD[0] != 0 || P.lastD[2] != 0;
      if (((double)P.tgt[1] < Y && (double)prevY >= Y - 0.5 && i > 0) || (P.grounded && moved && i < 3)) { if (na < MAXUPD) arr[na++] = i; }
      prevY = P.pos[1]; }
    if (P.bad) *bad = 1; }
  for (int ai = 0; ai < na; ai++) {
    int k = arr[ai];
    // 2. x/z steps up to the arrival with this lag pattern, walked back from the crack
    float ix[MAXUPD], iz[MAXUPD];
    { Player P; pl_init(FR, ACOS, P, 0, 0.0f, ty, 0.0f, yaw);
      for (int i = 0; i <= k; i++) { pl_step(FR, ACOS, P, pc_inp(i, c, h), has_lag(lag, i) ? 3 : 2); ix[i] = P.lastD[0]; iz[i] = P.lastD[2]; } if (P.bad) *bad = 1; }
    float X0[16], Z0[16]; int nx = invertChain(tx, ix, k + 1, 3, X0), nz = invertChain(tz, iz, k + 1, 3, Z0);
    if (!nx || !nz) continue;
    if (J.standCheck) { Player Q; pl_init(RR, ACOS, Q, 0x71, X0[0], ty, Z0[0], yaw); int ok = 1;
      for (int q = 0; q < 6; q++) { Inp none = { 0, 0, 0 }; pl_step(RR, ACOS, Q, none, 2); if ((double)Q.pos[1] < (double)ty - 0.5 || Q.pos[0] != X0[0] || Q.pos[2] != Z0[0]) { ok = 0; break; } }
      if (!ok) continue; }
    // 3. the real room
    Player P; pl_init(RR, ACOS, P, 0x71, X0[0], ty, Z0[0], yaw);
    int fh = -1, clipAt = -1, holds = 0, popped = 0; float endY = 0;
    for (int i = 0; i <= k; i++) { pl_step(RR, ACOS, P, pc_inp(i, c, h), has_lag(lag, i) ? 3 : 2);
      double dd = hypot((double)P.pos[0] - X, (double)P.pos[2] - Z);
      if (P.held && dd < 3) { holds++; if (fh < 0) fh = i; } }
    if (P.tgt[0] != tx || P.tgt[2] != tz) continue;
    { double dd = hypot((double)P.pos[0] - X, (double)P.pos[2] - Z); if ((double)P.pos[1] < Y - 115 && dd < 60) clipAt = k; }
    endY = P.pos[1];
    for (int i = k + 1; i < maxUpd; i++) {
      pl_step(RR, ACOS, P, pc_inp(i, c, h), has_lag(lag, i) ? 3 : 2); endY = P.pos[1];
      double dd = hypot((double)P.pos[0] - X, (double)P.pos[2] - Z);
      if (P.held && dd < 3) { holds++; if (fh < 0) fh = i; }
      if (clipAt >= 0 && i > clipAt && (double)P.pos[1] >= Y - 60) popped = 1;
      if (clipAt < 0 && (double)P.pos[1] < Y - 115 && dd < 60) clipAt = i;
      if (clipAt >= 0 && (i > clipAt + 8 || (double)P.pos[1] < Y - 700)) break;
      if (fh < 0 && clipAt < 0 && i > k + 10) break;
      if (fh >= 0 && i > fh + 14) break;
    }
    if (P.bad) *bad = 1;
    int clip = clipAt >= 0 && !popped;
    if (!holds && !clip) continue;
    Hit &o = out[nout++]; o.k = k; o.holds = holds; o.clipAt = clipAt; o.clip = clip; o.endY = endY; o.x0 = X0[0]; o.z0 = Z0[0]; o.pad = 0;
  }
  return nout;
}
