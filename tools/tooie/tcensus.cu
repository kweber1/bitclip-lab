// Claude 2026-11-11 (tcensus.cu): Banjo-Tooie (USA) bit-clip census for one room, on the graphics card (CUDA) or the CPU.
//  1. seams: edges shared by two different walkable floor triangles (flags & (0x400005 | 0x20020) == 0, n.y > 0.3), opaque and
//     transparent models together;
//  2. crack scan: EVERY float along each seam's major axis, +-3 floats across it, at the seam's floor height: the Tooie floor ray
//     (feet + 56 down to feet - 444, filter 0x400005, exact port of func_800AB0BC) misses every triangle within 5 units below
//     and 56 above -> crack. Cracks are kept one per 0.25 x 0.25 cell per seam (with the number of crack floats in the cell);
//  3. fall-in test on every kept crack: Banjo standing still on it (velocity 0, grounded), then 36 updates of falling with the
//     exact Tooie resolver (tcol.h), NTSC timing (2-VI updates of 1/30 s), once with no lag and once with a 3-VI update on each
//     of updates 1..8. Outcome per run: fell through and landed on a floor below / fell through into the void (no floor below at all) /
//     ejected (pushed back up onto the floor) / stuck (still in the floor after 36 updates) / water (the tracker met water) /
//     wall (a wall pushes Banjo off the spot on the first update: he cannot stand there).
//     Also counted: 5-pass holds (all 5 resolver passes hit: the "hold"), most passes hit in one update, updates sitting in the
//     crack (feet under the floor, sphere resting on it). Spots that walking in does not clip also get 42 jump drops (apex 92..174
//     above the floor, the tap..full Tooie jump): how many of them go through ("a jump is needed").
// Exhaustive mode (env TC_EVERY=1): every crack float gets the fall-in runs and the jump drops (no one-per-cell sampling); results are
// written as RUN lines: consecutive crack floats (same seam, same across offset) with identical outcomes collapsed into one line.
// TC_REGION="x y z r": only seams within r of the point. Every float near 0 is scanned (no 1e-5 steps) unless TC_ZEROSTEP=1.
// TC_ZEROPART=2: every float except those within [-1, 1] on a seam's major axis; TC_ZEROPART=1: only those (the two phases).
// T-junction seams (a floor edge lying along part of another floor triangle's edge) are scanned too.
// Output (text): ROOM, SEAM lines, SPOT lines (see write_out). Validated against BizHawk fall-in traces (bt_fallin.lua).
// Exhaustive mode speed-ups (all checked byte for byte against earlier builds on finished levels): crack floats are found on the card
// (one thread per float, its 7 across offsets; per-seam block candidate lists; precomputed triangle planes; a 2-unit box pre-check
// except on slivers) and compacted there in order; spots are made on the card; fall-in / jump runs go in large batches (variant-major
// thread order) while a worker thread counts the previous batch into cells; free-air updates and repeating states are skipped exactly.
// Build: nvcc -O3 -arch=sm_89 --fmad=false -prec-div=true -prec-sqrt=true -ftz=false -o tcensus tcensus.cu    (GPU)
//        g++ -x c++ -O2 -ffp-contract=off -fopenmp -DTCPU -o tcensus tcensus.cu -lm -lpthread               (CPU)
#ifndef TCPU
#define TCOL_CUDA
#endif
#include "tcol.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#include "troom.h"
#include <time.h>
static double T0; static double now(void) { return (double)clock() / CLOCKS_PER_SEC; }
#define LOG(...) do { fprintf(stderr, "[%.1f s] ", now() - T0); fprintf(stderr, __VA_ARGS__); fflush(stderr); } while (0)

#define NVAR 9          // run 0 = no lag, run k = 3-VI update on update k
#ifndef NUPD
#define NUPD 90
#endif
enum { O_LAND = 0, O_VOID = 1, O_EJECT = 2, O_STUCK = 3, O_WATER = 4, O_WALL = 5 };

typedef struct { int a, b; int ma, mb; float P[3], Q[3]; int axis; double nya, nyb; uint32_t k0, k1; uint32_t n1, n2, n3; uint32_t k2; float z0; int candoff, ncand; float ymin, ymax; int ivoff, ivn, ivwater; int boff, nb; double bm0, bstep; double dax, dot; float bm0f, binvf; } Seam;
// samples along the major axis: every float in [lo, -1), then steps of 1e-5 over [-1, 1] (floats are too dense there), then every float in (1, hi]
typedef struct { int seam; float x, y, z; int width; } Spot;
typedef struct { unsigned char out[NVAR], holds[NVAR], maxhits[NVAR], upd[NVAR], sits[NVAR]; float endy[NVAR]; } SpotRes;

// ---- float ordering keys (monotonic in value)
TD uint32_t fkey(float f) { uint32_t b; memcpy(&b, &f, 4); return (b & 0x80000000u) ? ~b : (b | 0x80000000u); }
TD float kfloat(uint32_t k) { uint32_t b = (k & 0x80000000u) ? (k & 0x7FFFFFFFu) : ~k; float f; memcpy(&f, &b, 4); return f; }
TD float fstep(float f, int n) { uint32_t k = fkey(f); return kfloat(k + (uint32_t)n); }

// one triangle of the line test (same code as line_model) -> 1 if the segment s..e hits it
TD int tri_line_hit(const TWorld *w, int mi, int k, const float *s, const float *e) {
  const TModel *M = w->m[mi]; const unsigned short *T = M->T + 3 * k; const short *A = M->V + 3 * T[0], *Bv = M->V + 3 * T[1], *Cv = M->V + 3 * T[2];
  float v0[3] = { (float)A[0], (float)A[1], (float)A[2] }, v1[3] = { (float)Bv[0], (float)Bv[1], (float)Bv[2] }, v2[3] = { (float)Cv[0], (float)Cv[1], (float)Cv[2] };
  float d[3]; vsub(d, e, s); float ab[3], ac[3], N[3]; vsub(ab, v1, v0); vsub(ac, v2, v0); vcross(N, ab, ac);
  if (100000.0f < fabsf_(N[0]) || 100000.0f < fabsf_(N[1]) || 100000.0f < fabsf_(N[2])) { N[0] = N[0] * 9.999999747e-06f; N[1] = N[1] * 9.999999747e-06f; N[2] = N[2] * 9.999999747e-06f; }
  float ls[3], le[3]; vsub(ls, s, v0); vsub(le, e, v0); float a = vdot(ls, N), b = vdot(le, N);
  if (0.0f <= a && 0.0f <= b) return 0; if (a <= 0.0f && b <= 0.0f) return 0;
  if ((M->TF[k] & 0x10000) && a < 0.0f) { N[0] = -N[0]; N[1] = -N[1]; N[2] = -N[2]; }
  float np = -vdot(v0, N); float nd = vdot(N, d); if (0.0f <= nd) return 0;
  float t = -(vdot(N, s) + np) / nd; if (t <= 0.0f) return 0; if (1.0f <= t) return 0;
  float cur[3] = { d[0] * t + s[0], d[1] * t + s[1], d[2] * t + s[2] };
  int pa = fabsf_(N[1]) < fabsf_(N[0]) ? 0 : 1; if (fabsf_(N[pa]) < fabsf_(N[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
  float f0 = cur[i1] - v0[i1], f1 = ab[i1], f2 = ac[i1], e0 = cur[i2] - v0[i2], e1 = ab[i2], e2 = ac[i2];
  float inv = 1.0f / (f1 * e2 - f2 * e1);
  float u = (f0 * e2 - f2 * e0) * inv; if (u < 0.0f || 1.0f < u) return 0;
  float ww = (f1 * e0 - f0 * e1) * inv; if (ww < 0.0f || 1.0f < ww) return 0; if (1.0f < u + ww) return 0;
  return 1;
}
// plane of each triangle, precomputed (the same exact integer products as below, in double): nx ny nz Ax Ay Az per triangle
#ifndef TCPU
__device__ const double *dPN[2];
#endif
static const double *HPN[2];
TD double plane_y(const TWorld *w, int mi, int k, double x, double z) {
#ifdef __CUDA_ARCH__
  const double *pn = dPN[mi];
#else
  const double *pn = HPN[mi];
#endif
  if (pn) { const double *q = pn + 6 * k; double nx = q[0], ny = q[1], nz = q[2]; if (ny == 0) return q[4]; return q[4] - (nx * (x - q[3]) + nz * (z - q[5])) / ny; }
  const TModel *M = w->m[mi]; const unsigned short *T = M->T + 3 * k; const short *A = M->V + 3 * T[0], *B = M->V + 3 * T[1], *C = M->V + 3 * T[2];
  double ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (ny == 0) return A[1];
  return A[1] - (nx * (x - A[0]) + nz * (z - A[2])) / ny;
}
// position of crack-scan sample j (major-axis float index), o (across offset -3..3) on seam S
TD void seam_point(const TWorld *w, const Seam *S, uint32_t j, int o, float *x, float *y, float *z) {
  float m; if (j < S->n1) m = kfloat(S->k0 + j); else if (j < S->n1 + S->n2) m = (float)((double)S->z0 + (double)(j - S->n1) * 1e-5); else m = kfloat(S->k2 + (j - S->n1 - S->n2));
  int ax = S->axis, ot = 2 - ax;   // axis 0 = x major, 2 = z major
  double t = ((double)m - S->P[ax]) / ((double)S->Q[ax] - S->P[ax]); double c = S->P[ot] + t * ((double)S->Q[ot] - S->P[ot]);
  float cf = fstep((float)c, o); float p[3]; p[ax] = m; p[ot] = cf;
  double yy = plane_y(w, S->ma, S->a, p[0], p[2]); *x = p[0]; *z = p[2]; *y = (float)yy; }
// candidates of one block of a seam (see "block candidates" in main): the triangles whose XZ box reaches that part of the seam
TD const int *block_cands(const Seam *S, const int *bcand, const int *bofs, float x, float z, int *n) {
  float m = S->axis == 0 ? x : z; float bf = floorf((m - S->bm0f) * S->binvf); int b = bf < 0.0f ? 0 : bf > (float)(S->nb - 1) ? S->nb - 1 : (int)bf;
  const int *o = bofs + 2 * (S->boff + b); *n = o[1]; return bcand + o[0]; }
// yy = this floor's height at (x, z) in double (= plane_y of the seam's triangle a, reused when the ray hits that triangle).
// Candidate entries: model << 24 | triangle, bit 30 = "unsafe" (a sliver where float rounding could pass the inside test far from
// the triangle; tested everywhere as before). For every other triangle a hit is only possible within ~0.02 of its XZ box, so a
// sample more than 2 units outside the box skips the test (same answer, no plane test).
TD int crack_at2(const TWorld *w, const Seam *S, const int *bcand, const int *bofs, float x, float y, float z, double yy) {
  float s[3] = { x, y + 56.0f, z }, e[3] = { x, y + -444.0f, z }; int nq; const int *cl = block_cands(S, bcand, bofs, x, z, &nq);
  for (int q = 0; q < nq; q++) { int c = cl[q]; int mi = (c >> 24) & 1, k = c & 0xFFFFFF;
    if (!(c & 0x40000000)) { const short *bb = w->m[mi]->BB + 6 * k; if (x < (float)bb[0] - 2.0f || (float)bb[1] + 2.0f < x || z < (float)bb[4] - 2.0f || (float)bb[5] + 2.0f < z) continue; }
    if (tri_line_hit(w, mi, k, s, e)) {
      // a hit counts only if it is this floor (within 5 below .. 56 above): the hit height
      double py = (mi == S->ma && k == S->a) ? yy : plane_y(w, mi, k, x, z); if (py >= (double)y - 5.0 && py <= (double)y + 56.0) return 0; } }
  return 1; }
TD float seam_m(const Seam *S, uint32_t j) {
  if (j < S->n1) return kfloat(S->k0 + j); if (j < S->n1 + S->n2) return (float)((double)S->z0 + (double)(j - S->n1) * 1e-5); return kfloat(S->k2 + (j - S->n1 - S->n2)); }
// crack test of samples o = o0..o1 (of -3..3) of float j of seam S -> r[o + 3] (1 = crack); the same numbers as seam_point + crack_at
TD void crack7(const TWorld *w, const Seam *S, const int *bcand, const int *bofs, uint32_t j, int o0, int o1, uint8_t *r) {
  float m = seam_m(S, j); int ax = S->axis, ot = 2 - ax;
  double t = ((double)m - S->P[ax]) / S->dax; double c = S->P[ot] + t * S->dot;
  for (int o = o0; o <= o1; o++) { float cf = fstep((float)c, o); float p[3]; p[ax] = m; p[ot] = cf; p[1] = 0.0f;
    double yy = plane_y(w, S->ma, S->a, p[0], p[2]); r[o + 3] = (uint8_t)crack_at2(w, S, bcand, bofs, p[0], (float)yy, p[2], yy); } }
// ---- fall-in simulation of one spot, one timing variant
// Free-air updates: iv = the seam's merged height intervals of every triangle within 40 units horizontally of the seam (the
// "air column"); when the falling sphere's whole vertical span this update (feet - 2 .. sphere top + 2) meets none of them, no
// sphere / line test can hit anything, so the resolver's result is exactly the floor-tracker step (floor_snap) alone.
TD int air_free(const float *iv, int ivn, float lo, float hi) {
  if (ivn < 0) return 0; for (int q = 0; q < ivn; q++) if (iv[2 * q] <= hi && iv[2 * q + 1] >= lo) return 0; return 1; }
TD int same5(const float *a, const float *b) { for (int i = 0; i < 5; i++) { uint32_t x, y; memcpy(&x, a + i, 4); memcpy(&y, b + i, 4); if (x != y) return 0; } return 1; }   // bit-identical
TD void fall_run2(const TWorld *w, float x, float y, float z, float drop, int lagupd, TAct *act, unsigned char *out, unsigned char *holds, unsigned char *maxh, unsigned char *upd, unsigned char *sits, float *endy, const float *iv, int ivn, int ivw) {
  float pos[3] = { x, y + drop, z }, vy = 0.0f; int gnd = drop == 0.0f ? 1 : 0; TTrack tr; memset(&tr, 0, sizeof tr); tr.posZ = 56.0f; tr.mode = 2;
  int nh = 0, mh = 0, touched = 0, ns = 0; int res = O_STUCK, k;
  // cycle fast-forward: from update kreg on, an update depends only on (pos, vy, gnd); when that state repeats after one or two
  // updates (Banjo held in place in the crack), every remaining update repeats too, so the rest of the 90 is added up exactly
  float hs[2][5]; int hheld[2], hsit[2], nhist = 0; const int kreg = lagupd > 1 ? lagupd + 1 : 2;
  for (k = 1; k <= NUPD; k++) {
    float dt = (k == lagupd) ? 0.050000004f : 0.033333335f;
    vy = vy + dt * -2700.0f; if (vy < -4000.0f) vy = -4000.0f;
    float disp[3] = { 0.0f, vy * dt, 0.0f }, tgt[3] = { pos[0], pos[1] + disp[1], pos[2] };
    TRes R;
    { float lo = (pos[1] < tgt[1] ? pos[1] : tgt[1]) - 2.0f, hi = (pos[1] > tgt[1] ? pos[1] : tgt[1]) + 80.0f + 35.0f + 2.0f;
      if (air_free(iv, ivn, lo, hi)) {
        if (!ivw && !gnd) { R.hits = 0; R.held = 0; R.held_flag = 0; R.last = TNONE; vcp(R.out, tgt); R.grounded = 0; }   // no water in the column: the tracker can neither snap nor see water
        else { float u0[3]; vcp(u0, tgt); int g = gnd; floor_snap(&tr, w, u0, disp, &g, TFILT_FLOOR);
          R.hits = 0; R.held = 0; R.held_flag = 0; R.last = TNONE; vcp(R.out, u0); R.grounded = g; } }
      else resolve(w, &tr, pos, tgt, disp, gnd, 80.0f, 35.0f, TFILT_FLOOR, &R, act); }
    int sitinc = (R.hits && R.out[1] == pos[1] && pos[1] < y - 1.0f) ? 1 : 0; ns += sitinc;   // sitting in the crack: feet under the floor, sphere resting on it
    vcp(pos, R.out); gnd = R.grounded; if (gnd && vy < 0.0f) vy = -1.0f;
    if (R.held) nh++; if (R.hits > mh) mh = R.hits; if (R.hits) touched = 1;
    if (k == 1 && drop == 0.0f && (pos[0] != x || pos[2] != z)) { res = O_WALL; break; }
    if (tr.water_seen) { res = O_WATER; break; }
    if (pos[1] < y - 115.0f && !R.hits) {   // the whole sphere is under the floor and free: through
      float a[3] = { pos[0], pos[1] + 1.0f, pos[2] }, b[3] = { pos[0], -30000.0f, pos[2] }, n[3] = { 0, 0, 0 };
      res = tri_ok(wline(w, a, b, n, TFILT_FLOOR)) ? O_LAND : O_VOID; break; }
    if (gnd && pos[1] >= y - 0.5f && (touched || k > 1) && (drop == 0.0f || vy == -1.0f)) { res = O_EJECT; break; }
    if (k >= kreg && k < NUPD) {
      float cur[5] = { pos[0], pos[1], pos[2], vy, (float)gnd };
      if (nhist >= 1 && same5(cur, hs[0])) {   // period 1
        int r = NUPD - k; nh += r * (R.held ? 1 : 0); ns += r * sitinc; k = NUPD + 1; break; }
      if (nhist >= 2 && same5(cur, hs[1]) && k - 1 >= kreg) {   // period 2: updates k+1, k+2, ... repeat k-1, k, ...
        int r = NUPD - k, a_ = (r + 1) / 2, b_ = r / 2; nh += a_ * hheld[0] + b_ * (R.held ? 1 : 0); ns += a_ * hsit[0] + b_ * sitinc;
        if (r % 2) { pos[0] = hs[0][0]; pos[1] = hs[0][1]; pos[2] = hs[0][2]; } k = NUPD + 1; break; }
      memcpy(hs[1], hs[0], sizeof hs[0]); hheld[1] = hheld[0]; hsit[1] = hsit[0]; memcpy(hs[0], cur, sizeof cur); hheld[0] = R.held ? 1 : 0; hsit[0] = sitinc; nhist++; }
    else if (k < kreg) { float cur[5] = { pos[0], pos[1], pos[2], vy, (float)gnd }; memcpy(hs[1], hs[0], sizeof hs[0]); hheld[1] = hheld[0]; hsit[1] = hsit[0]; memcpy(hs[0], cur, sizeof cur); hheld[0] = R.held ? 1 : 0; hsit[0] = sitinc; nhist++; }
  }
  *out = (unsigned char)res; *holds = (unsigned char)nh; *maxh = (unsigned char)mh; *upd = (unsigned char)(k > NUPD ? NUPD : k); *sits = (unsigned char)(ns > 255 ? 255 : ns); *endy = pos[1];
}

TD void fall_run(const TWorld *w, float x, float y, float z, int lagupd, TAct *act, unsigned char *out, unsigned char *holds, unsigned char *maxh, unsigned char *upd, unsigned char *sits, float *endy, const float *iv = 0, int ivn = -1, int ivw = 1) {
  fall_run2(w, x, y, z, 0.0f, lagupd, act, out, holds, maxh, upd, sits, endy, iv, ivn, ivw); }
// jump drops: Banjo coming down from a jump's apex onto the spot. Tooie jump (measured in BizHawk): tap A = apex 92 above the
// take-off floor, A held = 174.46; after the apex gravity is -2700 either way. NJ apex heights from 92 to 174 cover every
// arrival phase relative to the update boundaries (no lag).
#define NJ 42
TD float jump_h(int j) { return 92.0f + (float)j * 2.0f; }
typedef struct { unsigned char clip, voids, eject, stuck, hold, sitmax, other, pad; } JumpRes;
TD void jump_run(const TWorld *w, float x, float y, float z, int j, TAct *act, unsigned char *o, unsigned char *h, unsigned char *si, const float *iv = 0, int ivn = -1, int ivw = 1) {
  unsigned char m, u; float e; fall_run2(w, x, y, z, jump_h(j), 0, act, o, h, &m, &u, si, &e, iv, ivn, ivw); }
#ifndef TCPU
// ---- device copies of the world
__device__ TModel dM[2]; __device__ TWorld dW;
__global__ void k_crack2(const Seam *S, int nseam, const int *bcand, const int *bofs, const uint64_t *off, uint64_t base, uint8_t *out, uint64_t n) {
  uint64_t g0 = (base / 7 + (uint64_t)blockIdx.x * blockDim.x + threadIdx.x) * 7; if (g0 >= base + n) return;   // seam offsets are multiples of 7
  int lo = 0, hi = nseam - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= g0) lo = mid; else hi = mid - 1; }
  int o0 = g0 < base ? -3 + (int)(base - g0) : -3, o1 = g0 + 6 >= base + n ? -3 + (int)(base + n - 1 - g0) : 3; uint8_t r[7];
  crack7(&dW, S + lo, bcand, bofs, (uint32_t)((g0 - off[lo]) / 7), o0, o1, r); for (int o = o0; o <= o1; o++) out[g0 + 3 + o - base] = r[o + 3]; }
static unsigned crack_blocks(uint64_t base, uint64_t n) { return (unsigned)(((base + n - 1) / 7 - base / 7 + 1 + 255) / 256); }
__device__ const Seam *dSeams; __device__ const float *dIV;
#ifdef LB_MINB
#define KLB __launch_bounds__(64, LB_MINB)   // fewer registers per thread, more threads per SM (bench variants)
#else
#define KLB
#endif
__global__ void KLB k_jump(const Spot *P, const int *idx, int n, unsigned char *O) {
  // height-major: a warp gets 32 neighbouring floats at the same apex height (near-identical paths: little divergence)
  int id = blockIdx.x * blockDim.x + threadIdx.x; if (id >= n * NJ) return; int j = id / n, q = id % n; const Spot *s = P + idx[q]; TAct act[TMAXACT];
  id = q * NJ + j;   // output slot as before
  const Seam *S = dSeams ? dSeams + s->seam : 0;
  jump_run(&dW, s->x, s->y, s->z, j, act, O + 3 * (size_t)id, O + 3 * (size_t)id + 1, O + 3 * (size_t)id + 2, S ? dIV + 2 * S->ivoff : 0, S ? S->ivn : -1, S ? S->ivwater : 1); }
__global__ void KLB k_fall(const Spot *P, int n, SpotRes *R) {
  int id = blockIdx.x * blockDim.x + threadIdx.x; if (id >= n * NVAR) return; int v = id / n, sp = id % n; TAct act[TMAXACT];   // variant-major (see k_jump)
  const Seam *S = dSeams ? dSeams + P[sp].seam : 0;
  fall_run(&dW, P[sp].x, P[sp].y, P[sp].z, v, act, &R[sp].out[v], &R[sp].holds[v], &R[sp].maxhits[v], &R[sp].upd[v], &R[sp].sits[v], &R[sp].endy[v], S ? dIV + 2 * S->ivoff : 0, S ? S->ivn : -1, S ? S->ivwater : 1); }
static void upload(const TWorld *w) {
  TModel hm[2]; memset(hm, 0, sizeof hm); TWorld hw; memset(&hw, 0, sizeof hw); TModel *dmp; cudaGetSymbolAddress((void **)&dmp, dM);
  for (int i = 0; i < 2; i++) { if (!w->m[i]) continue; const TModel *M = w->m[i]; hm[i] = *M; void *p;
    cudaMalloc(&p, 6 * M->nv + 8); cudaMemcpy(p, M->V, 6 * M->nv, cudaMemcpyHostToDevice); hm[i].V = (short *)p;
    cudaMalloc(&p, 6 * M->nt + 8); cudaMemcpy(p, M->T, 6 * M->nt, cudaMemcpyHostToDevice); hm[i].T = (unsigned short *)p;
    cudaMalloc(&p, 4 * M->nt + 8); cudaMemcpy(p, M->TF, 4 * M->nt, cudaMemcpyHostToDevice); hm[i].TF = (unsigned *)p;
    cudaMalloc(&p, 4 * M->ncell + 8); cudaMemcpy(p, M->C, 4 * M->ncell, cudaMemcpyHostToDevice); hm[i].C = (unsigned short *)p;
    cudaMalloc(&p, 12 * M->nt + 12); cudaMemcpy(p, M->BB, 12 * M->nt, cudaMemcpyHostToDevice); hm[i].BB = (short *)p;
    if (HPN[i]) { cudaMalloc(&p, 48 * (size_t)M->nt + 48); cudaMemcpy(p, HPN[i], 48 * (size_t)M->nt, cudaMemcpyHostToDevice); const double *pd = (const double *)p; cudaMemcpyToSymbol(dPN, &pd, sizeof pd, sizeof pd * i); }
    hw.m[i] = dmp + i; }
  cudaMemcpyToSymbol(dM, hm, sizeof hm); cudaMemcpyToSymbol(dW, &hw, sizeof hw);
  cudaDeviceSetLimit(cudaLimitStackSize, 32768); }
#endif

static double tri_ny(const TWorld *w, int mi, int k) { const TModel *M = w->m[mi]; const unsigned short *T = M->T + 3 * k; const short *A = M->V + 3 * T[0], *B = M->V + 3 * T[1], *C = M->V + 3 * T[2];
  double ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; double L = sqrt(nx * nx + ny * ny + nz * nz); return L > 0 ? ny / L : 0; }
typedef struct { int x0, y0, z0, x1, y1, z1, m, k; } Edge;
static int ecmp(const void *a, const void *b) { const Edge *p = (const Edge *)a, *q = (const Edge *)b;
  if (p->x0 != q->x0) return p->x0 - q->x0; if (p->y0 != q->y0) return p->y0 - q->y0; if (p->z0 != q->z0) return p->z0 - q->z0;
  if (p->x1 != q->x1) return p->x1 - q->x1; if (p->y1 != q->y1) return p->y1 - q->y1; return p->z1 - q->z1; }
static int ecmp_full(const void *a, const void *b) { int c = ecmp(a, b); if (c) return c; const Edge *p = (const Edge *)a, *q = (const Edge *)b; if (p->m != q->m) return p->m - q->m; return p->k - q->k; }
static int same_tri(const TWorld *w, int ma, int a, int mb, int b) {   // same three corners (duplicates of one triangle in two cells)
  int va[3][3], vb[3][3]; for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) { va[j][i] = w->m[ma]->V[3 * w->m[ma]->T[3 * a + j] + i]; vb[j][i] = w->m[mb]->V[3 * w->m[mb]->T[3 * b + j] + i]; }
  for (int j = 0; j < 3; j++) { int f = 0; for (int l = 0; l < 3; l++) if (va[j][0] == vb[l][0] && va[j][1] == vb[l][1] && va[j][2] == vb[l][2]) f = 1; if (!f) return 0; } return 1; }

static int *BOFS = 0, NBOFS = 0;   // block candidates: (offset, count) per seam block
static int ZEROSTEP = 0, EVERY = 0, HAVEREG = 0, ZEROPART = 0, CRACKONLY = 0; static double REG[4];
static int in_region(const Seam *s) {   // distance from the region point to the seam segment
  if (!HAVEREG) return 1; double d[3], v[3], L2 = 0, t = 0; for (int c = 0; c < 3; c++) { v[c] = (double)s->Q[c] - s->P[c]; d[c] = REG[c] - s->P[c]; L2 += v[c] * v[c]; t += d[c] * v[c]; }
  t = L2 > 0 ? fmin(1, fmax(0, t / L2)) : 0; double q = 0; for (int c = 0; c < 3; c++) { double e = s->P[c] + t * v[c] - REG[c]; q += e * e; } return sqrt(q) <= REG[3]; }
// ---- air columns (see air_free): per seam, merged [ymin, ymax] of every triangle within 40 units (XZ) of the seam segment
static const Seam *HS = 0; static float *HIV = 0; static int NIV = 0;
static double seg_seg2(double ax, double az, double bx, double bz, double cx, double cz, double dx, double dz) {   // squared XZ distance of two segments
  auto pd = [](double px, double pz, double ax, double az, double bx, double bz) { double vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz, t = L > 0 ? ((px - ax) * vx + (pz - az) * vz) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; double ex = ax + t * vx - px, ez = az + t * vz - pz; return ex * ex + ez * ez; };
  auto cr = [](double ax, double az, double bx, double bz, double cx, double cz) { return (bx - ax) * (cz - az) - (bz - az) * (cx - ax); };
  double d1 = cr(ax, az, bx, bz, cx, cz), d2 = cr(ax, az, bx, bz, dx, dz), d3 = cr(cx, cz, dx, dz, ax, az), d4 = cr(cx, cz, dx, dz, bx, bz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  double m = pd(ax, az, cx, cz, dx, dz); double t; if ((t = pd(bx, bz, cx, cz, dx, dz)) < m) m = t; if ((t = pd(cx, cz, ax, az, bx, bz)) < m) m = t; if ((t = pd(dx, dz, ax, az, bx, bz)) < m) m = t; return m; }
static void build_air(const TWorld *w, Seam *S, int ns) {
  const char *e = getenv("TC_NOAIR"); int off = 0; static float tmp[2 * 65536]; HIV = (float *)malloc(sizeof(float) * 2 * 64); int cap = 32;
  for (int i = 0; i < ns; i++) { Seam *s = S + i; s->ivoff = off; s->ivn = -1; s->ivwater = 1; if (e && atoi(e)) continue; int water = 0;
    double ax = s->P[0], az = s->P[2], bx = s->Q[0], bz = s->Q[2], R = 40.0; int n = 0;
    double bx0 = fmin(ax, bx) - R, bx1 = fmax(ax, bx) + R, bz0 = fmin(az, bz) - R, bz1 = fmax(az, bz) + R;
    for (int mi = 0; mi < 2; mi++) { const TModel *M = w->m[mi]; if (!M) continue;
      for (int k = 0; k < M->nt; k++) { const short *v[3]; for (int j = 0; j < 3; j++) v[j] = M->V + 3 * M->T[3 * k + j];
        double mnx = fmin(v[0][0], fmin(v[1][0], v[2][0])), mxx = fmax(v[0][0], fmax(v[1][0], v[2][0])), mnz = fmin(v[0][2], fmin(v[1][2], v[2][2])), mxz = fmax(v[0][2], fmax(v[1][2], v[2][2]));
        if (mxx < bx0 || mnx > bx1 || mxz < bz0 || mnz > bz1) continue;
        // inside test (segment endpoint inside the triangle's XZ projection) or edge distance
        double best = 1e30; for (int j = 0; j < 3; j++) { double d = seg_seg2(ax, az, bx, bz, v[j][0], v[j][2], v[(j + 1) % 3][0], v[(j + 1) % 3][2]); if (d < best) best = d; }
        { double c0 = (v[1][0] - v[0][0]) * (az - v[0][2]) - (v[1][2] - v[0][2]) * (ax - v[0][0]), c1 = (v[2][0] - v[1][0]) * (az - v[1][2]) - (v[2][2] - v[1][2]) * (ax - v[1][0]), c2 = (v[0][0] - v[2][0]) * (az - v[2][2]) - (v[0][2] - v[2][2]) * (ax - v[2][0]);
          if ((c0 >= 0 && c1 >= 0 && c2 >= 0) || (c0 <= 0 && c1 <= 0 && c2 <= 0)) best = 0; }
        if (best > R * R) continue;
        if (M->TF[k] & TWATER) water = 1;
        float ylo = fminf(v[0][1], fminf(v[1][1], v[2][1])) - 1.0f, yhi = fmaxf(v[0][1], fmaxf(v[1][1], v[2][1])) + 1.0f;
        if (n < 65536) { tmp[2 * n] = ylo; tmp[2 * n + 1] = yhi; n++; } else { n = -1; break; } }
      if (n < 0) break; }
    if (n < 0) continue;   // too many: no skipping on this seam
    // sort by start and merge
    for (int a = 1; a < n; a++) { float l = tmp[2 * a], h = tmp[2 * a + 1]; int b = a - 1; while (b >= 0 && tmp[2 * b] > l) { tmp[2 * b + 2] = tmp[2 * b]; tmp[2 * b + 3] = tmp[2 * b + 1]; b--; } tmp[2 * b + 2] = l; tmp[2 * b + 3] = h; }
    int m = 0; for (int a = 0; a < n; a++) { if (m && tmp[2 * a] <= tmp[2 * (m - 1) + 1]) { if (tmp[2 * a + 1] > tmp[2 * (m - 1) + 1]) tmp[2 * (m - 1) + 1] = tmp[2 * a + 1]; } else { tmp[2 * m] = tmp[2 * a]; tmp[2 * m + 1] = tmp[2 * a + 1]; m++; } }
    while (off + m > cap) { cap *= 2; HIV = (float *)realloc(HIV, sizeof(float) * 2 * cap); }
    memcpy(HIV + 2 * off, tmp, sizeof(float) * 2 * m); s->ivoff = off; s->ivn = m; s->ivwater = water; off += m; }
  NIV = off; HS = S; LOG("air columns: %d intervals over %d seams%s\n", off, ns, (e && atoi(e)) ? " (disabled)" : ""); }
#ifndef TCPU
static void set_air_dev(Seam *dS) { float *d = 0; cudaMalloc(&d, sizeof(float) * 2 * (NIV + 1)); cudaMemcpy(d, HIV, sizeof(float) * 2 * (NIV + 1), cudaMemcpyHostToDevice);
  const Seam *ps = dS; const float *pf = d; cudaMemcpyToSymbol(dSeams, &ps, sizeof ps); cudaMemcpyToSymbol(dIV, &pf, sizeof pf); }
#endif
// ---- exhaustive mode: every crack float gets the 9 fall-in runs and (when walking in does not clip) the 42 jump drops.
// Crack floats are processed chunk by chunk. Each float is classified like the site does (walk / lag / jump / stuck / eject / wall /
// water, + void, + hold) and counted into its 0.25 x 0.25 cell of its seam; nothing is skipped. One line per cell:
//   CELL seam n walk void lag jump eject stuck wall water hold | x y z outs9 holds9 maxhits9 sits9 upd endy J42/...|-
// counts are crack floats; after "|" the full result of one float of the cell's best category (walk > lag > jump > stuck > eject >
// wall > water; the first such float), with its exact coordinates, for reproducing it.
#include <map>
#include <vector>
#include <thread>
#include <chrono>
#ifndef TCPU
#include <cub/device/device_select.cuh>
#endif
typedef struct { int seam, o; uint32_t j; } CF;
enum { C_WALK, C_VOID, C_LAG, C_JUMP, C_EJECT, C_STUCK, C_WALL, C_WATER, C_HOLD, C_N };
static const int CPRI[8] = { 0, 9, 1, 2, 4, 3, 5, 6 };   // priority by category index (lower = better); void is counted inside walk
typedef struct { uint64_t n, c[C_N]; int best; Spot rep; SpotRes rr; JumpRes rj; } CellAcc;
static int classify(const SpotRes *r, const JumpRes *J, int *hold) {
  int w0 = r->out[0], any = 0; for (int v = 0; v < NVAR; v++) if (r->out[v] == O_LAND || r->out[v] == O_VOID) any = 1;
  *hold = 0; for (int v = 0; v < NVAR; v++) if (r->holds[v]) *hold = 1; if (J->pad && J->hold) *hold = 1;
  if (w0 == O_LAND || w0 == O_VOID) return C_WALK; if (w0 == O_WALL) return C_WALL; if (w0 == O_WATER) return C_WATER;
  if (any) return C_LAG; if (J->pad && J->clip > 0) return C_JUMP; if (w0 == O_STUCK) return C_STUCK; return C_EJECT; }
static void cell_write(FILE *f, int seam, const CellAcc *A) {
  fprintf(f, "CELL %d %llu", seam, (unsigned long long)A->n); for (int c = 0; c < C_N; c++) fprintf(f, " %llu", (unsigned long long)A->c[c]);
  const SpotRes *r = &A->rr; fprintf(f, " | %.9g %.9g %.9g ", A->rep.x, A->rep.y, A->rep.z);
  for (int v = 0; v < NVAR; v++) fprintf(f, "%d", r->out[v]); fprintf(f, " ");
  for (int v = 0; v < NVAR; v++) fprintf(f, "%s%d", v ? "," : "", r->holds[v]); fprintf(f, " ");
  for (int v = 0; v < NVAR; v++) fprintf(f, "%d", r->maxhits[v] > 9 ? 9 : r->maxhits[v]); fprintf(f, " ");
  for (int v = 0; v < NVAR; v++) fprintf(f, "%s%d", v ? "," : "", r->sits[v]); fprintf(f, " %d %.3f", r->upd[0], r->endy[0]);
  const JumpRes *J = &A->rj; if (J->pad) fprintf(f, " J%d/%d:%d,%d,%d,%d,%d,%d\n", NJ, J->clip, J->voids, J->eject, J->stuck, J->other, J->hold, J->sitmax); else fprintf(f, " -\n"); }
// batches of crack floats: filled by the main thread, run (fall-in + jump drops) on the GPU, then counted into cells by a
// worker thread while the main thread fills and runs the next batch (two batch buffers). Floats keep their order, so the
// output is the same as one float at a time.
typedef struct { Spot *SP; CF *cf; SpotRes *RS; JumpRes *JR; int np; } Batch;
static double wnow(void) { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
#ifndef TCPU
__global__ void k_jacc(const unsigned char *O, int m, JumpRes *J) {   // the 42 jump drops of each float -> its JumpRes (as the host did)
  int q = blockIdx.x * blockDim.x + threadIdx.x; if (q >= m) return; JumpRes r = { 0, 0, 0, 0, 0, 0, 0, 0 };
  for (int j = 0; j < NJ; j++) { const unsigned char *o = O + 3 * ((size_t)q * NJ + j);
    if (o[0] == O_LAND || o[0] == O_VOID) r.clip++; if (o[0] == O_VOID) r.voids++; if (o[0] == O_EJECT) r.eject++; if (o[0] == O_STUCK) r.stuck++;
    if (o[0] == O_WATER || o[0] == O_WALL) r.other++; if (o[1]) r.hold++; if (o[2] > r.sitmax) r.sitmax = o[2]; }
  r.pad = 1; J[q] = r; }
__global__ void k_iota(uint32_t *a, uint32_t n) { uint32_t i = blockIdx.x * blockDim.x + threadIdx.x; if (i < n) a[i] = i; }
#endif
#ifndef TCPU
__global__ void k_spots(const uint32_t *sel, int nsel, uint64_t base, const Seam *S, int nseam, const uint64_t *off, Spot *P, CF *C) {   // crack floats -> spots (as the host did)
  int t = blockIdx.x * blockDim.x + threadIdx.x; if (t >= nsel) return; uint64_t g = base + sel[t];
  int lo = 0, hi = nseam - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= g) lo = mid; else hi = mid - 1; }
  uint64_t r = g - off[lo]; uint32_t j = (uint32_t)(r / 7); int o = (int)(r % 7) - 3; float x, y, z; seam_point(&dW, S + lo, j, o, &x, &y, &z);
  Spot sp; sp.seam = lo; sp.x = x; sp.y = y; sp.z = z; sp.width = 1; P[t] = sp; CF c; c.seam = lo; c.o = o; c.j = j; C[t] = c; }
#endif
static int every_mode(TWorld *wp, Seam *S, int ns, int *cand, int nc, uint64_t *off, uint64_t total, const char *room, const char *outp) {
  TWorld &w = *wp; const int *bofs = BOFS; (void)bofs; char rp[1024]; snprintf(rp, sizeof rp, "%s.runs", outp); FILE *fr = fopen(rp, "w"); if (!fr) { fprintf(stderr, "cannot write %s\n", rp); return 2; }
  uint64_t ncracks = 0, nfall = 0, njump = 0; uint64_t *seamcr = (uint64_t *)calloc(ns + 1, 8);
  uint64_t CH = 1ull << 23; int BATCH = 1 << 20; const int FB = 1 << 18, JB = 1 << 17;
  { const char *e = getenv("TC_TESTCHUNK"); if (e && atoi(e) > 0) { CH = (uint64_t)atoi(e); BATCH = (int)(CH / 3) + 1; } }   // testing: small chunks and batches
  const int CAP = (int)CH;
  Batch B[2]; for (int k = 0; k < 2; k++) { B[k].SP = (Spot *)malloc(sizeof(Spot) * (CAP + 1)); B[k].cf = (CF *)malloc(sizeof(CF) * (CAP + 1));
    B[k].RS = (SpotRes *)malloc(sizeof(SpotRes) * (CAP + 1)); B[k].JR = (JumpRes *)malloc(sizeof(JumpRes) * (CAP + 1)); B[k].np = 0; }
  int *jidx = (int *)malloc(4 * (CAP + 1));
  std::map<int64_t, CellAcc> cells; int curseam = -1; uint64_t ncells = 0; uint64_t catn[C_N] = { 0 };   // owned by the worker while it runs
  int64_t lastkey = 0; CellAcc *lastA = 0;   // the previous float's cell (neighbouring floats share cells: skips most map lookups)
  double tcr = 0, tcrh = 0, tfa = 0, tju = 0, twait = 0, tagg = 0;
#ifndef TCPU
  upload(&w); Seam *dS; int *dC; uint64_t *dO; uint8_t *dB; cudaMalloc(&dS, sizeof(Seam) * (ns + 1)); cudaMemcpy(dS, S, sizeof(Seam) * ns, cudaMemcpyHostToDevice); set_air_dev(dS);
  cudaMalloc(&dC, 4 * (nc + 1)); cudaMemcpy(dC, cand, 4 * nc, cudaMemcpyHostToDevice); int *dBO; cudaMalloc(&dBO, 8 * (NBOFS + 1)); cudaMemcpy(dBO, BOFS, 8 * (size_t)NBOFS, cudaMemcpyHostToDevice); cudaMalloc(&dO, 8 * (ns + 1)); cudaMemcpy(dO, off, 8 * (ns + 1), cudaMemcpyHostToDevice); cudaMalloc(&dB, CH);
  uint32_t *dIota, *dSel, *hSel; int *dNsel; void *dTmp = 0; size_t tmpb = 0;
  cudaMalloc(&dIota, 4 * CH); cudaMalloc(&dSel, 4 * CH + 4); cudaMalloc(&dNsel, 8); cudaMallocHost(&hSel, 4 * CH + 4);
  k_iota<<<(unsigned)((CH + 255) / 256), 256>>>(dIota, (uint32_t)CH);
  cub::DeviceSelect::Flagged(dTmp, tmpb, dIota, dB, dSel, dNsel, (int)CH); cudaMalloc(&dTmp, tmpb + 16);
  Spot *dP, *dPB[2]; CF *dCF; SpotRes *dR; int *dI; unsigned char *dJ; JumpRes *dJR; JumpRes *hJR = (JumpRes *)malloc(sizeof(JumpRes) * (JB + 1));
  cudaMalloc(&dPB[0], sizeof(Spot) * (CAP + 1)); cudaMalloc(&dPB[1], sizeof(Spot) * (CAP + 1)); cudaMalloc(&dCF, sizeof(CF) * (CAP + 1)); dP = dPB[0]; cudaMalloc(&dR, sizeof(SpotRes) * (FB + 1)); cudaMalloc(&dI, 4 * (JB + 1)); cudaMalloc(&dJ, 3 * (size_t)NJ * JB + 3); cudaMalloc(&dJR, sizeof(JumpRes) * (JB + 1));
  { cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda setup: %s\n", cudaGetErrorString(er)); return 4; } }
  { cudaFuncAttributes a1, a2, a3; cudaFuncGetAttributes(&a1, k_crack2); cudaFuncGetAttributes(&a2, k_fall); cudaFuncGetAttributes(&a3, k_jump);
    LOG("kernels (registers / local bytes): crack %d/%d, fall-in %d/%d, jump %d/%d\n", a1.numRegs, (int)a1.localSizeBytes, a2.numRegs, (int)a2.localSizeBytes, a3.numRegs, (int)a3.localSizeBytes); }
#else
  uint8_t *buf = (uint8_t *)malloc(CH); unsigned char *JO = (unsigned char *)malloc(3 * (size_t)NJ * JB + 3);
#endif
  // worker: count a run batch into cells, in float order
  auto aggregate = [&](Batch *bt) { double t0 = wnow();
    for (int i = 0; i < bt->np; i++) { const CF *c = bt->cf + i; const Spot *sp = bt->SP + i; const SpotRes *rs = bt->RS + i; const JumpRes *jr = bt->JR + i;
      if (c->seam != curseam) { for (auto &kv : cells) { cell_write(fr, curseam, &kv.second); ncells++; } cells.clear(); curseam = c->seam; lastA = 0; }
      int64_t key = (int64_t)floor(sp->x / 0.25) * 4000003 + (int64_t)floor(sp->z / 0.25);
      if (!lastA || key != lastkey) { lastA = &cells[key]; lastkey = key; } CellAcc &A = *lastA;
      if (A.n == 0) { memset(&A, 0, sizeof A); A.best = 99; }
      int hold; int cat = classify(rs, jr, &hold); A.n++; A.c[cat]++; catn[cat]++; if (cat == C_WALK && rs->out[0] == O_VOID) { A.c[C_VOID]++; catn[C_VOID]++; }
      if (hold) { A.c[C_HOLD]++; catn[C_HOLD]++; }
      if (CPRI[cat] < A.best) { A.best = CPRI[cat]; A.rep = *sp; A.rr = *rs; A.rj = *jr; } }
    tagg += wnow() - t0; };
  // main: fall-in (9 runs per float) and jump drops (42 per float that does not get through walking in without lag)
  auto run = [&](Batch *bt) -> int { int np = bt->np; Spot *SP = bt->SP; SpotRes *RS = bt->RS; JumpRes *JR = bt->JR; double t0 = wnow();
#ifndef TCPU
    dP = dPB[bt - B];   // the batch's spots are already on the card (k_spots)
    for (int b = 0; b < np; b += FB) { int m = np - b < FB ? np - b : FB; k_fall<<<(m * NVAR + 63) / 64, 64>>>(dP + b, m, dR);
      cudaMemcpy(RS + b, dR, sizeof(SpotRes) * m, cudaMemcpyDeviceToHost);
      cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda fall: %s\n", cudaGetErrorString(er)); return 4; } }
#else
    #pragma omp parallel for schedule(dynamic, 16)
    for (int i = 0; i < np * NVAR; i++) { static __thread TAct act[TMAXACT]; int sp = i / NVAR, v = i % NVAR;
      fall_run(&w, SP[sp].x, SP[sp].y, SP[sp].z, v, act, &RS[sp].out[v], &RS[sp].holds[v], &RS[sp].maxhits[v], &RS[sp].upd[v], &RS[sp].sits[v], &RS[sp].endy[v], HIV + 2 * HS[SP[sp].seam].ivoff, HS[SP[sp].seam].ivn, HS[SP[sp].seam].ivwater); }
#endif
    nfall += np; double t1 = wnow(); tfa += t1 - t0;
    memset(JR, 0, sizeof(JumpRes) * np); int nj = 0; for (int i = 0; i < np; i++) { int oo = RS[i].out[0]; if (oo == O_EJECT || oo == O_STUCK) jidx[nj++] = i; }
    for (int b = 0; b < nj; b += JB) { int m = nj - b < JB ? nj - b : JB;
#ifndef TCPU
      cudaMemcpy(dI, jidx + b, 4 * m, cudaMemcpyHostToDevice);
      k_jump<<<(m * NJ + 63) / 64, 64>>>(dP, dI, m, dJ); k_jacc<<<(m + 63) / 64, 64>>>(dJ, m, dJR);
      cudaMemcpy(hJR, dJR, sizeof(JumpRes) * m, cudaMemcpyDeviceToHost);
      { cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda jump: %s\n", cudaGetErrorString(er)); return 4; } }
      for (int q = 0; q < m; q++) JR[jidx[b + q]] = hJR[q];
#else
      #pragma omp parallel for schedule(dynamic, 16)
      for (int i = 0; i < m * NJ; i++) { static __thread TAct act[TMAXACT]; int q = i / NJ, jj = i % NJ; const Spot *sp = SP + jidx[b + q];
        jump_run(&w, sp->x, sp->y, sp->z, jj, act, JO + 3 * (size_t)i, JO + 3 * (size_t)i + 1, JO + 3 * (size_t)i + 2, HIV + 2 * HS[sp->seam].ivoff, HS[sp->seam].ivn, HS[sp->seam].ivwater); }
      for (int q = 0; q < m; q++) { JumpRes *J = JR + jidx[b + q]; for (int jj = 0; jj < NJ; jj++) { unsigned char *r = JO + 3 * ((size_t)q * NJ + jj);
          if (r[0] == O_LAND || r[0] == O_VOID) J->clip++; if (r[0] == O_VOID) J->voids++; if (r[0] == O_EJECT) J->eject++; if (r[0] == O_STUCK) J->stuck++;
          if (r[0] == O_WATER || r[0] == O_WALL) J->other++; if (r[1]) J->hold++; if (r[2] > J->sitmax) J->sitmax = r[2]; } J->pad = 1; }
#endif
    }
    njump += nj; tju += wnow() - t1; return 0; };
  std::thread worker; int cur = 0; double tlast = wnow(); uint64_t done = 0;
  auto flush = [&]() -> int { Batch *bt = B + cur; if (!bt->np) return 0; int rc = run(bt); if (rc) return rc;
    double t0 = wnow(); if (worker.joinable()) worker.join(); twait += wnow() - t0;
    if (wnow() - tlast > 20) { tlast = wnow(); LOG("  samples %llu/%llu, crack floats %llu, fall-in %llu, jump drops %llu x %d, cells %llu; floats walk %llu lag %llu jump %llu\n", (unsigned long long)done, (unsigned long long)total, (unsigned long long)ncracks, (unsigned long long)nfall, (unsigned long long)njump, NJ, (unsigned long long)ncells, (unsigned long long)catn[C_WALK], (unsigned long long)catn[C_LAG], (unsigned long long)catn[C_JUMP]); }
    worker = std::thread(aggregate, bt); cur ^= 1; B[cur].np = 0; return 0; };
  for (uint64_t base = 0; base < total; base += CH) { uint64_t n = total - base < CH ? total - base : CH; int rc;
    if (B[cur].np + (int64_t)n > CAP && (rc = flush())) return rc;
    double t0 = wnow(); Batch *bt = B + cur; int np = bt->np; int si = 0; { int lo = 0, hi = ns - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= base) lo = mid; else hi = mid - 1; } si = lo; }
#ifndef TCPU
    k_crack2<<<crack_blocks(base, n), 256>>>(dS, ns, dC, dBO, dO, base, dB, n);
    cub::DeviceSelect::Flagged(dTmp, tmpb, dIota, dB, dSel, dNsel, (int)n); int nsel = 0; cudaMemcpy(&nsel, dNsel, 4, cudaMemcpyDeviceToHost);
    if (nsel) cudaMemcpy(hSel, dSel, 4 * (size_t)nsel, cudaMemcpyDeviceToHost);
    { cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda crack: %s\n", cudaGetErrorString(er)); return 4; } }
    double t1 = wnow(); tcr += t1 - t0;
    if (CRACKONLY) { for (int t = 0; t < nsel; t++) { uint64_t g = base + hSel[t]; while (si + 1 < ns && off[si + 1] <= g) si++; ncracks++; seamcr[si]++; } nsel = 0; }
    if (nsel) { k_spots<<<(nsel + 255) / 256, 256>>>(dSel, nsel, base, dS, ns, dO, dPB[cur] + np, dCF);
      cudaMemcpy(bt->SP + np, dPB[cur] + np, sizeof(Spot) * (size_t)nsel, cudaMemcpyDeviceToHost); cudaMemcpy(bt->cf + np, dCF, sizeof(CF) * (size_t)nsel, cudaMemcpyDeviceToHost);
      { cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda spots: %s\n", cudaGetErrorString(er)); return 4; } }
      for (int t = 0; t < nsel; t++) seamcr[bt->cf[np + t].seam]++; ncracks += nsel; np += nsel; }
    if (0) for (int t = 0; t < nsel; t++) { uint64_t id = hSel[t];
#else
    #pragma omp parallel for schedule(dynamic, 1024)
    for (int64_t G = (int64_t)(base / 7); G <= (int64_t)((base + n - 1) / 7); G++) { uint64_t g0 = (uint64_t)G * 7; int lo = 0, hi = ns - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= g0) lo = mid; else hi = mid - 1; }
      int o0 = g0 < base ? -3 + (int)(base - g0) : -3, o1 = g0 + 6 >= base + n ? -3 + (int)(base + n - 1 - g0) : 3; uint8_t r[7];
      crack7(&w, S + lo, cand, bofs, (uint32_t)((g0 - off[lo]) / 7), o0, o1, r); for (int o = o0; o <= o1; o++) buf[g0 + 3 + o - base] = r[o + 3]; }
    double t1 = wnow(); tcr += t1 - t0;
    if (CRACKONLY) { for (uint64_t id = 0; id < n; id++) if (buf[id]) { uint64_t g = base + id; while (si + 1 < ns && off[si + 1] <= g) si++; ncracks++; seamcr[si]++; } n = 0; }
    for (uint64_t id = 0; id < n; id++) { if (!buf[id]) continue;
#endif
      uint64_t g = base + id; while (si + 1 < ns && off[si + 1] <= g) si++;
      uint64_t r = g - off[si]; float x, y, z; uint32_t j = (uint32_t)(r / 7); int o = (int)(r % 7) - 3; seam_point(&w, S + si, j, o, &x, &y, &z); ncracks++; seamcr[si]++;
      bt->SP[np].seam = si; bt->SP[np].x = x; bt->SP[np].y = y; bt->SP[np].z = z; bt->SP[np].width = 1; bt->cf[np].seam = si; bt->cf[np].o = o; bt->cf[np].j = j; np++; }
    bt->np = np; done = base + CH < total ? base + CH : total; tcrh += wnow() - t1;
    if (bt->np >= BATCH && (rc = flush())) return rc; }
  { int rc = flush(); if (rc) return rc; } if (worker.joinable()) worker.join();
  for (auto &kv : cells) { cell_write(fr, curseam, &kv.second); ncells++; } cells.clear();
  fclose(fr);
  LOG("time: crack %.1f s (host %.1f), fall-in %.1f, jump drops %.1f, waiting for cell counting %.1f (counting %.1f)\n", tcr, tcrh, tfa, tju, twait, tagg);
  LOG("%llu crack floats, every one tested (%llu jump-drop floats), %llu cells; floats: walk %llu (void %llu) lag %llu jump %llu stuck %llu eject %llu wall %llu water %llu hold %llu\n", (unsigned long long)ncracks, (unsigned long long)njump, (unsigned long long)ncells,
      (unsigned long long)catn[C_WALK], (unsigned long long)catn[C_VOID], (unsigned long long)catn[C_LAG], (unsigned long long)catn[C_JUMP], (unsigned long long)catn[C_STUCK], (unsigned long long)catn[C_EJECT], (unsigned long long)catn[C_WALL], (unsigned long long)catn[C_WATER], (unsigned long long)catn[C_HOLD]);
  FILE *o = fopen(outp, "w"); fprintf(o, "ROOM %s seams %d samples %llu cracks %llu cells %llu every 1 zeropart %d\n", room, ns, (unsigned long long)total, (unsigned long long)ncracks, (unsigned long long)ncells, ZEROPART);
  for (int i = 0; i < ns; i++) fprintf(o, "SEAM %d %d:%d %d:%d %g %g %g %g %g %g %.4f %.4f %llu\n", i, S[i].ma, S[i].a, S[i].mb, S[i].b, S[i].P[0], S[i].P[1], S[i].P[2], S[i].Q[0], S[i].Q[1], S[i].Q[2], S[i].nya, S[i].nyb, (unsigned long long)seamcr[i]);
  fr = fopen(rp, "r"); { static char lb[1 << 16]; size_t k; while ((k = fread(lb, 1, sizeof lb, fr)) > 0) fwrite(lb, 1, k, o); } fclose(fr); remove(rp);
  fclose(o); fprintf(stderr, "done\n"); return 0; }
int main(int argc, char **argv) {
  { const char *e; ZEROSTEP = (e = getenv("TC_ZEROSTEP")) && atoi(e); EVERY = (e = getenv("TC_EVERY")) && atoi(e); ZEROPART = (e = getenv("TC_ZEROPART")) ? atoi(e) : 0; CRACKONLY = (e = getenv("TC_CRACKONLY")) && atoi(e);
    if ((e = getenv("TC_REGION")) && sscanf(e, "%lf %lf %lf %lf", REG, REG + 1, REG + 2, REG + 3) == 4) HAVEREG = 1; }
  if (argc < 3) { fprintf(stderr, "usage: tcensus room.txt out.txt [maxseams]\n"); return 1; }
  T0 = now(); TWorld w; load_world(argv[1], &w); int maxseams = argc > 3 ? atoi(argv[3]) : 1 << 30;
  for (int mi = 0; mi < 2; mi++) { const TModel *M = w.m[mi]; if (!M) continue; double *pn = (double *)malloc(sizeof(double) * 6 * (M->nt + 1));   // plane table (see plane_y)
    for (int k = 0; k < M->nt; k++) { const unsigned short *T = M->T + 3 * k; const short *A = M->V + 3 * T[0], *B = M->V + 3 * T[1], *C = M->V + 3 * T[2];
      double ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      double *q = pn + 6 * k; q[0] = uy * vz - uz * vy; q[1] = uz * vx - ux * vz; q[2] = ux * vy - uy * vx; q[3] = A[0]; q[4] = A[1]; q[5] = A[2]; }
    HPN[mi] = pn; }
#ifdef TCPU
  if (argc > 4 && !strcmp(argv[3], "--spots")) { FILE *sf = fopen(argv[4], "r"); float x, y, z; static TAct act[TMAXACT];
    while (fscanf(sf, "%f %f %f", &x, &y, &z) == 3) { printf("%.9g %.9g %.9g:", x, y, z); for (int v = 0; v < NVAR; v++) { unsigned char o, h, m, u, si; float e;
        fall_run(&w, x, y, z, v, act, &o, &h, &m, &u, &si, &e); printf(" %d/h%d/s%d/u%d/%.1f", o, h, si, u, e); } printf("\n"); } return 0; }
#endif
  // walkable floor triangles, unique geometry (cells repeat triangles)
  int ntot = (w.m[0] ? w.m[0]->nt : 0) + (w.m[1] ? w.m[1]->nt : 0); Edge *E = (Edge *)malloc(sizeof(Edge) * 3 * ntot); int ne = 0;
  for (int mi = 0; mi < 2; mi++) { const TModel *M = w.m[mi]; if (!M) continue;
    for (int k = 0; k < M->nt; k++) { if (M->TF[k] & (TFILT_FLOOR | TWATER)) continue; if (!(tri_ny(&w, mi, k) > 0.3)) continue;
      for (int j = 0; j < 3; j++) { const short *p = M->V + 3 * M->T[3 * k + j], *q = M->V + 3 * M->T[3 * k + (j + 1) % 3]; Edge e;
        int sw = (p[0] > q[0]) || (p[0] == q[0] && (p[2] > q[2] || (p[2] == q[2] && p[1] > q[1]))); const short *A = sw ? q : p, *B = sw ? p : q;
        e.x0 = A[0]; e.y0 = A[1]; e.z0 = A[2]; e.x1 = B[0]; e.y1 = B[1]; e.z1 = B[2]; e.m = mi; e.k = k; E[ne++] = e; } } }
  qsort(E, ne, sizeof(Edge), ecmp_full);
  Seam *S = (Seam *)malloc(sizeof(Seam) * (ne + 1)); int ns = 0;
  for (int i = 0; i < ne; ) { int j = i; while (j < ne && !ecmp(E + i, E + j)) j++;
    // all distinct (non-duplicate) triangle pairs on this edge: take the first triangle and every other distinct one
    for (int b = i + 1; b < j && ns < maxseams; b++) { if (same_tri(&w, E[i].m, E[i].k, E[b].m, E[b].k)) continue; int dupe = 0;
      for (int c = i + 1; c < b; c++) if (same_tri(&w, E[c].m, E[c].k, E[b].m, E[b].k)) dupe = 1; if (dupe) continue;
      Seam s; memset(&s, 0, sizeof s); s.ma = E[i].m; s.a = E[i].k; s.mb = E[b].m; s.b = E[b].k;
      s.P[0] = E[i].x0; s.P[1] = E[i].y0; s.P[2] = E[i].z0; s.Q[0] = E[i].x1; s.Q[1] = E[i].y1; s.Q[2] = E[i].z1;
      s.axis = fabs(s.Q[0] - s.P[0]) >= fabs(s.Q[2] - s.P[2]) ? 0 : 2; if (s.P[s.axis] == s.Q[s.axis]) continue;
      float lo = s.P[s.axis] < s.Q[s.axis] ? s.P[s.axis] : s.Q[s.axis], hi = s.P[s.axis] < s.Q[s.axis] ? s.Q[s.axis] : s.P[s.axis]; s.k0 = fkey(lo); s.k1 = fkey(hi);
      if (ZEROPART == 1) {   // only the floats within [-1, 1] (the near-zero phase of the exhaustive census)
        if (hi < -1.0f || lo > 1.0f) continue; float a_ = lo < -1.0f ? -1.0f : lo, b_ = hi > 1.0f ? 1.0f : hi; s.k0 = fkey(a_); s.n1 = fkey(b_) - s.k0 + 1; s.n2 = s.n3 = 0; }
      else if (ZEROPART == 2 && !(hi < -1.0f || lo > 1.0f)) {   // every float except those within [-1, 1]
        s.n1 = lo < -1.0f ? fkey(-1.0f) - s.k0 : 0; s.n2 = 0; s.z0 = 0; s.k2 = fkey(1.0f) + 1; s.n3 = hi > 1.0f ? s.k1 - s.k2 + 1 : 0; if (!s.n1 && !s.n3) continue; }
      else if (!ZEROSTEP || hi < -1.0f || lo > 1.0f) { s.n1 = s.k1 - s.k0 + 1; s.n2 = s.n3 = 0; }
      else { float a = lo < -1.0f ? -1.0f : lo, b = hi > 1.0f ? 1.0f : hi; s.n1 = lo < -1.0f ? fkey(-1.0f) - s.k0 : 0; s.z0 = a; s.n2 = (uint32_t)((b - a) / 1e-5) + 1;
        s.k2 = fkey(1.0f) + 1; s.n3 = hi > 1.0f ? s.k1 - s.k2 + 1 : 0; }
      s.nya = tri_ny(&w, s.ma, s.a); s.nyb = tri_ny(&w, s.mb, s.b); s.ymin = s.P[1] < s.Q[1] ? s.P[1] : s.Q[1]; s.ymax = s.P[1] < s.Q[1] ? s.Q[1] : s.P[1];
      if (!in_region(&s)) continue;
      S[ns++] = s; }
    i = j; }
  // T-junction seams: a floor edge that lies along part of another floor triangle's edge without sharing both corners. The seam
  // is the overlap of the two edges (exact integer collinearity).
  { int nt0 = ns;
    for (int i = 0; i < ne; i++) for (int b2 = i + 1; b2 < ne; b2++) { const Edge *A = E + i, *B = E + b2;
      if (B->x0 > A->x1) break;   // E sorted by x0; A spans x0..x1 (x0 <= x1)
      if (!ecmp(A, B) || same_tri(&w, A->m, A->k, B->m, B->k)) continue;
      long dx = A->x1 - A->x0, dy = A->y1 - A->y0, dz = A->z1 - A->z0;
      long ex0 = B->x0 - A->x0, ey0 = B->y0 - A->y0, ez0 = B->z0 - A->z0, ex1 = B->x1 - A->x0, ey1 = B->y1 - A->y0, ez1 = B->z1 - A->z0;
      if (dy * ez0 - dz * ey0 || dz * ex0 - dx * ez0 || dx * ey0 - dy * ex0) continue;
      if (dy * ez1 - dz * ey1 || dz * ex1 - dx * ez1 || dx * ey1 - dy * ex1) continue;
      double L2 = (double)dx * dx + (double)dy * dy + (double)dz * dz; if (L2 == 0) continue;
      double t0 = (ex0 * dx + ey0 * dy + ez0 * dz) / L2, t1 = (ex1 * dx + ey1 * dy + ez1 * dz) / L2; if (t0 > t1) { double t = t0; t0 = t1; t1 = t; }
      double lo_ = fmax(0.0, t0), hi_ = fmin(1.0, t1); if (hi_ - lo_ <= 1e-9) continue;
      if (fabs(lo_) < 1e-12 && fabs(hi_ - 1) < 1e-12 && fabs(t0) < 1e-12 && fabs(t1 - 1) < 1e-12) continue;   // same edge (handled above)
      Seam s; memset(&s, 0, sizeof s); s.ma = A->m; s.a = A->k; s.mb = B->m; s.b = B->k;
      // overlap endpoints are corners of A or B: integers
      int P0[3] = { (int)lround(A->x0 + lo_ * dx), (int)lround(A->y0 + lo_ * dy), (int)lround(A->z0 + lo_ * dz) }, Q0[3] = { (int)lround(A->x0 + hi_ * dx), (int)lround(A->y0 + hi_ * dy), (int)lround(A->z0 + hi_ * dz) };
      for (int c = 0; c < 3; c++) { s.P[c] = (float)P0[c]; s.Q[c] = (float)Q0[c]; }
      s.axis = fabs(s.Q[0] - s.P[0]) >= fabs(s.Q[2] - s.P[2]) ? 0 : 2; if (s.P[s.axis] == s.Q[s.axis]) continue;
      float lo = s.P[s.axis] < s.Q[s.axis] ? s.P[s.axis] : s.Q[s.axis], hi = s.P[s.axis] < s.Q[s.axis] ? s.Q[s.axis] : s.P[s.axis]; s.k0 = fkey(lo); s.k1 = fkey(hi);
      s.n1 = s.k1 - s.k0 + 1; s.n2 = s.n3 = 0;
      if (ZEROPART == 1) { if (hi < -1.0f || lo > 1.0f) continue; float a_ = lo < -1.0f ? -1.0f : lo, b_ = hi > 1.0f ? 1.0f : hi; s.k0 = fkey(a_); s.n1 = fkey(b_) - s.k0 + 1; }
      else if (ZEROPART == 2 && !(hi < -1.0f || lo > 1.0f)) { s.n1 = lo < -1.0f ? fkey(-1.0f) - s.k0 : 0; s.k2 = fkey(1.0f) + 1; s.n3 = hi > 1.0f ? s.k1 - s.k2 + 1 : 0; if (!s.n1 && !s.n3) continue; }
      s.nya = tri_ny(&w, s.ma, s.a); s.nyb = tri_ny(&w, s.mb, s.b); s.ymin = s.P[1] < s.Q[1] ? s.P[1] : s.Q[1]; s.ymax = s.P[1] < s.Q[1] ? s.Q[1] : s.P[1];
      if (!in_region(&s)) continue;
      if (ns >= ne) break; S[ns++] = s; }
    LOG("%d T-junction seams\n", ns - nt0); }
  // candidates per seam: every triangle the floor ray could hit near the seam (filter 0x400005)
  int capc = 1 << 20, nc = 0; int *cand = (int *)malloc(4 * capc);
  for (int i = 0; i < ns; i++) { Seam *s = S + i; s->candoff = nc;
    double bx0 = fmin(s->P[0], s->Q[0]) - 2, bx1 = fmax(s->P[0], s->Q[0]) + 2, bz0 = fmin(s->P[2], s->Q[2]) - 2, bz1 = fmax(s->P[2], s->Q[2]) + 2, by0 = s->ymin - 6, by1 = s->ymax + 57;
    for (int mi = 0; mi < 2; mi++) { const TModel *M = w.m[mi]; if (!M) continue;
      for (int k = 0; k < M->nt; k++) { if (M->TF[k] & TFILT_FLOOR) continue; int mnx = 1 << 30, mxx = -(1 << 30), mny = mnx, mxy = mxx, mnz = mnx, mxz = mxx;
        for (int j = 0; j < 3; j++) { const short *p = M->V + 3 * M->T[3 * k + j]; if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]; if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]; if (p[2] < mnz) mnz = p[2]; if (p[2] > mxz) mxz = p[2]; }
        if (mxx < bx0 || mnx > bx1 || mxz < bz0 || mnz > bz1 || mxy < by0 || mny > by1) continue;
        if (nc == capc) { capc *= 2; cand = (int *)realloc(cand, 4 * capc); } cand[nc++] = (mi << 24) | k; } }
    s->ncand = nc - s->candoff; }
  // block candidates: each seam is cut into nb blocks along its major axis (>= 8 units each, at most 512); a block keeps the seam's
  // candidates whose XZ box reaches the block's stretch of the seam, with the same 2-unit margin as above. A vertical ray at (x, z)
  // can only hit a triangle whose box holds (x, z), so every crack test gets the same answer from fewer triangles (long seams).
  { const char *e = getenv("TC_NOBLOCKS"); int noblk = e && atoi(e);
    int nbt = 0; for (int i = 0; i < ns; i++) { Seam *s = S + i; int ax = s->axis; double lo = fmin(s->P[ax], s->Q[ax]), hi = fmax(s->P[ax], s->Q[ax]);
      int nb = noblk ? 1 : (int)ceil((hi - lo) / 8.0); if (nb < 1) nb = 1; if (nb > 512) nb = 512; s->boff = nbt; s->nb = nb; s->bm0 = lo; s->bstep = (hi - lo) / nb;
      if (!(s->bstep > 0)) s->bstep = 1; nbt += nb;
      s->dax = (double)s->Q[ax] - s->P[ax]; s->dot = (double)s->Q[2 - ax] - s->P[2 - ax]; s->bm0f = (float)lo; s->binvf = (float)(1.0 / s->bstep); }
    int nunsafe = 0;
    BOFS = (int *)malloc(8 * (nbt + 1)); NBOFS = nbt; std::vector<int> bc; bc.reserve(nc + 1024); std::vector<std::vector<int> > lists;
    for (int i = 0; i < ns; i++) { Seam *s = S + i; int ax = s->axis, ot = 2 - ax; lists.assign(s->nb, std::vector<int>());
      double d = (double)s->Q[ax] - s->P[ax];
      for (int q = 0; q < s->ncand; q++) { int c = cand[s->candoff + q]; const TModel *M = w.m[c >> 24]; int k = c & 0xFFFFFF; int mn[3] = { 1 << 30, 1 << 30, 1 << 30 }, mx[3] = { -(1 << 30), -(1 << 30), -(1 << 30) };
        for (int j = 0; j < 3; j++) { const short *p = M->V + 3 * M->T[3 * k + j]; for (int a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; } }
        { // sliver test: float rounding in the inside test is ~7e-7 * L^3 / A (L longest edge, A largest normal component = projected
          // twice-area); unsafe when that could reach 0.02 units outside the box (100x below the 2-unit margin): keep it everywhere
          const short *A0 = M->V + 3 * M->T[3 * k], *A1 = M->V + 3 * M->T[3 * k + 1], *A2 = M->V + 3 * M->T[3 * k + 2];
          double ux = A1[0] - A0[0], uy = A1[1] - A0[1], uz = A1[2] - A0[2], vx = A2[0] - A0[0], vy = A2[1] - A0[1], vz = A2[2] - A0[2];
          double nx = fabs(uy * vz - uz * vy), ny = fabs(uz * vx - ux * vz), nz = fabs(ux * vy - uy * vx), Aa = fmax(nx, fmax(ny, nz));
          double wx = A2[0] - A1[0], wy = A2[1] - A1[1], wz = A2[2] - A1[2];
          double L = sqrt(fmax(ux * ux + uy * uy + uz * uz, fmax(vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz)));
          if (!(Aa > 0) || L * L * L / Aa > 2.8e4) { for (int b = 0; b < s->nb; b++) lists[b].push_back(c | 0x40000000); nunsafe++; continue; } }
        int b0 = (int)floor((mn[ax] - 2.0 - s->bm0) / s->bstep) - 1, b1 = (int)floor((mx[ax] + 2.0 - s->bm0) / s->bstep) + 1; if (b0 < 0) b0 = 0; if (b1 > s->nb - 1) b1 = s->nb - 1;
        for (int b = b0; b <= b1; b++) { double m0 = s->bm0 + b * s->bstep, m1 = b == s->nb - 1 ? fmax(s->P[ax], s->Q[ax]) : s->bm0 + (b + 1) * s->bstep;
          if (b == 0) m0 = fmin(s->P[ax], s->Q[ax]);
          double c0 = d != 0 ? s->P[ot] + (m0 - s->P[ax]) / d * ((double)s->Q[ot] - s->P[ot]) : s->P[ot], c1 = d != 0 ? s->P[ot] + (m1 - s->P[ax]) / d * ((double)s->Q[ot] - s->P[ot]) : s->Q[ot];
          double a0 = m0 - 2, a1 = m1 + 2, o0 = fmin(c0, c1) - 2, o1 = fmax(c0, c1) + 2;
          if (mx[ax] < a0 || mn[ax] > a1 || mx[ot] < o0 || mn[ot] > o1) continue; lists[b].push_back(c); } }
      for (int b = 0; b < s->nb; b++) { BOFS[2 * (s->boff + b)] = (int)bc.size(); BOFS[2 * (s->boff + b) + 1] = (int)lists[b].size(); bc.insert(bc.end(), lists[b].begin(), lists[b].end()); } }
    LOG("block candidates: %d blocks, %d entries (was %d), %d sliver entries kept everywhere\n", nbt, (int)bc.size(), nc, nunsafe);
    free(cand); nc = (int)bc.size(); cand = (int *)malloc(4 * (nc + 1)); memcpy(cand, bc.data(), 4 * (size_t)nc); }
  uint64_t *off = (uint64_t *)malloc(8 * (ns + 1)); uint64_t total = 0; for (int i = 0; i < ns; i++) { off[i] = total; total += ((uint64_t)S[i].n1 + S[i].n2 + S[i].n3) * 7; } off[ns] = total;
  LOG("%d seams, %d candidate entries, %llu crack samples\n", ns, nc, (unsigned long long)total);
  build_air(&w, S, ns);
  { const char *e = getenv("TC_MAXSAMPLES"); if (e && atoll(e) > 0 && (uint64_t)atoll(e) < total) total = (uint64_t)atoll(e); }   // testing: stop early
  if (EVERY) return every_mode(&w, S, ns, cand, nc, off, total, argv[1], argv[2]);
  // crack scan -> spots (one per seam and 0.25 cell)
  const int *bofs = BOFS; (void)bofs;
  int caps = 1 << 16, np = 0; Spot *SP = (Spot *)malloc(sizeof(Spot) * caps); uint64_t ncracks = 0; uint64_t *seamcr = (uint64_t *)calloc(ns + 1, 8);
  const uint64_t CH = 1ull << 27; uint8_t *buf = (uint8_t *)malloc(CH);
#ifndef TCPU
  upload(&w); Seam *dS; int *dC; uint64_t *dO; uint8_t *dB; cudaMalloc(&dS, sizeof(Seam) * (ns + 1)); cudaMemcpy(dS, S, sizeof(Seam) * ns, cudaMemcpyHostToDevice); set_air_dev(dS);
  cudaMalloc(&dC, 4 * (nc + 1)); cudaMemcpy(dC, cand, 4 * nc, cudaMemcpyHostToDevice); int *dBO; cudaMalloc(&dBO, 8 * (NBOFS + 1)); cudaMemcpy(dBO, BOFS, 8 * (size_t)NBOFS, cudaMemcpyHostToDevice); cudaMalloc(&dO, 8 * (ns + 1)); cudaMemcpy(dO, off, 8 * (ns + 1), cudaMemcpyHostToDevice); cudaMalloc(&dB, CH);
#endif
  int cur = -1; int64_t lastcell = INT64_MIN;
  for (uint64_t base = 0; base < total; base += CH) { uint64_t n = total - base < CH ? total - base : CH;
#ifndef TCPU
    k_crack2<<<crack_blocks(base, n), 256>>>(dS, ns, dC, dBO, dO, base, dB, n); cudaMemcpy(buf, dB, n, cudaMemcpyDeviceToHost);
    { cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda crack: %s\n", cudaGetErrorString(er)); return 4; } } LOG("  crack samples %llu/%llu\n", (unsigned long long)(base + n), (unsigned long long)total);
#else
    #pragma omp parallel for schedule(dynamic, 1024)
    for (int64_t G = (int64_t)(base / 7); G <= (int64_t)((base + n - 1) / 7); G++) { uint64_t g0 = (uint64_t)G * 7; int lo = 0, hi = ns - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= g0) lo = mid; else hi = mid - 1; }
      int o0 = g0 < base ? -3 + (int)(base - g0) : -3, o1 = g0 + 6 >= base + n ? -3 + (int)(base + n - 1 - g0) : 3; uint8_t r[7];
      crack7(&w, S + lo, cand, bofs, (uint32_t)((g0 - off[lo]) / 7), o0, o1, r); for (int o = o0; o <= o1; o++) buf[g0 + 3 + o - base] = r[o + 3]; }
#endif
    int si = 0; { int lo = 0, hi = ns - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= base) lo = mid; else hi = mid - 1; } si = lo; }
    for (uint64_t id = 0; id < n; id++) { if (!buf[id]) continue; uint64_t g = base + id; while (si + 1 < ns && off[si + 1] <= g) si++;
      uint64_t r = g - off[si]; float x, y, z; seam_point(&w, S + si, (uint32_t)(r / 7), (int)(r % 7) - 3, &x, &y, &z); ncracks++; seamcr[si]++;
      int64_t cell = ((int64_t)floor(x / 0.25) * 4000003 + (int64_t)floor(z / 0.25));
      if (si == cur && cell == lastcell) { SP[np - 1].width++; continue; }
      cur = si; lastcell = cell; if (np == caps) { caps *= 2; SP = (Spot *)realloc(SP, sizeof(Spot) * caps); }
      SP[np].seam = si; SP[np].x = x; SP[np].y = y; SP[np].z = z; SP[np].width = 1; np++; } }
  LOG("%llu crack floats, %d spots (one per seam and 0.25 cell)\n", (unsigned long long)ncracks, np);
  // fall-in tests
  SpotRes *RS = (SpotRes *)calloc(np + 1, sizeof(SpotRes));
#ifndef TCPU
  { Spot *dP; SpotRes *dR; cudaMalloc(&dP, sizeof(Spot) * (np + 1)); cudaMalloc(&dR, sizeof(SpotRes) * (np + 1)); cudaMemcpy(dP, SP, sizeof(Spot) * np, cudaMemcpyHostToDevice);
    const int CHS = 1 << 12; for (int b = 0; b < np; b += CHS) { int m = np - b < CHS ? np - b : CHS; k_fall<<<(m * NVAR + 63) / 64, 64>>>(dP + b, m, dR + b); cudaDeviceSynchronize();
      cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda: %s\n", cudaGetErrorString(er)); return 4; } LOG("  fall-in %d/%d\n", b + m, np); }
    cudaMemcpy(RS, dR, sizeof(SpotRes) * np, cudaMemcpyDeviceToHost); }
#else
  #pragma omp parallel for schedule(dynamic, 16)
  for (int i = 0; i < np * NVAR; i++) { static __thread TAct act[TMAXACT]; int sp = i / NVAR, v = i % NVAR;
    fall_run(&w, SP[sp].x, SP[sp].y, SP[sp].z, v, act, &RS[sp].out[v], &RS[sp].holds[v], &RS[sp].maxhits[v], &RS[sp].upd[v], &RS[sp].sits[v], &RS[sp].endy[v], HIV + 2 * HS[SP[sp].seam].ivoff, HS[SP[sp].seam].ivn, HS[SP[sp].seam].ivwater); }
#endif
  // jump drops for the spots where walking in (no lag) does not take Banjo through
  JumpRes *JR = (JumpRes *)calloc(np + 1, sizeof(JumpRes)); int nj = 0; int *jidx = (int *)malloc(4 * (np + 1));
  for (int i = 0; i < np; i++) { int oo = RS[i].out[0]; if (oo == O_EJECT || oo == O_STUCK) jidx[nj++] = i; }
  LOG("jump drops: %d spots x %d apex heights\n", nj, NJ);
  { unsigned char *JO = (unsigned char *)malloc(3 * (size_t)nj * NJ + 3);
#ifndef TCPU
    Spot *dP2; int *dI; unsigned char *dJ; cudaMalloc(&dP2, sizeof(Spot) * (np + 1)); cudaMemcpy(dP2, SP, sizeof(Spot) * np, cudaMemcpyHostToDevice);
    cudaMalloc(&dI, 4 * (nj + 1)); cudaMemcpy(dI, jidx, 4 * nj, cudaMemcpyHostToDevice); cudaMalloc(&dJ, 3 * (size_t)nj * NJ + 3);
    const int CHJ = 1 << 10; for (int b = 0; b < nj; b += CHJ) { int m = nj - b < CHJ ? nj - b : CHJ; k_jump<<<(m * NJ + 63) / 64, 64>>>(dP2, dI + b, m, dJ + 3 * (size_t)b * NJ); cudaDeviceSynchronize();
      cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda jump: %s\n", cudaGetErrorString(er)); return 4; } if ((b / CHJ) % 16 == 0) LOG("  jumps %d/%d\n", b + m, nj); }
    cudaMemcpy(JO, dJ, 3 * (size_t)nj * NJ, cudaMemcpyDeviceToHost);
#else
    #pragma omp parallel for schedule(dynamic, 16)
    for (int i = 0; i < nj * NJ; i++) { static __thread TAct act[TMAXACT]; int q = i / NJ, j = i % NJ; const Spot *sp = SP + jidx[q];
      jump_run(&w, sp->x, sp->y, sp->z, j, act, JO + 3 * (size_t)i, JO + 3 * (size_t)i + 1, JO + 3 * (size_t)i + 2, HIV + 2 * HS[sp->seam].ivoff, HS[sp->seam].ivn, HS[sp->seam].ivwater); }
#endif
    for (int q = 0; q < nj; q++) { JumpRes *J = JR + jidx[q]; for (int j = 0; j < NJ; j++) { unsigned char *r = JO + 3 * ((size_t)q * NJ + j);
        if (r[0] == O_LAND || r[0] == O_VOID) J->clip++; if (r[0] == O_VOID) J->voids++; if (r[0] == O_EJECT) J->eject++; if (r[0] == O_STUCK) J->stuck++;
        if (r[0] == O_WATER || r[0] == O_WALL) J->other++; if (r[1]) J->hold++; if (r[2] > J->sitmax) J->sitmax = r[2]; } J->pad = 1; }
    free(JO); }
  FILE *o = fopen(argv[2], "w"); fprintf(o, "ROOM %s seams %d samples %llu cracks %llu spots %d\n", argv[1], ns, (unsigned long long)total, (unsigned long long)ncracks, np);
  for (int i = 0; i < ns; i++) fprintf(o, "SEAM %d %d:%d %d:%d %g %g %g %g %g %g %.4f %.4f %llu\n", i, S[i].ma, S[i].a, S[i].mb, S[i].b, S[i].P[0], S[i].P[1], S[i].P[2], S[i].Q[0], S[i].Q[1], S[i].Q[2], S[i].nya, S[i].nyb, (unsigned long long)seamcr[i]);
  for (int i = 0; i < np; i++) { SpotRes *r = RS + i; fprintf(o, "SPOT %d %.9g %.9g %.9g %d ", SP[i].seam, SP[i].x, SP[i].y, SP[i].z, SP[i].width);
    for (int v = 0; v < NVAR; v++) fprintf(o, "%d", r->out[v]); fprintf(o, " ");
    for (int v = 0; v < NVAR; v++) fprintf(o, "%s%d", v ? "," : "", r->holds[v]); fprintf(o, " ");
    for (int v = 0; v < NVAR; v++) fprintf(o, "%d", r->maxhits[v] > 9 ? 9 : r->maxhits[v]); fprintf(o, " ");
    for (int v = 0; v < NVAR; v++) fprintf(o, "%s%d", v ? "," : "", r->sits[v]); fprintf(o, " %d %.3f", r->upd[0], r->endy[0]);
    JumpRes *J = JR + i; if (J->pad) fprintf(o, " J%d/%d:%d,%d,%d,%d,%d,%d\n", NJ, J->clip, J->voids, J->eject, J->stuck, J->other, J->hold, J->sitmax); else fprintf(o, " -\n"); }
  fclose(o); fprintf(stderr, "done\n"); return 0;
}
