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
// T-junction seams (a floor edge lying along part of another floor triangle's edge) are scanned too.
// Output (text): ROOM, SEAM lines, SPOT lines (see write_out). Validated against BizHawk fall-in traces (bt_fallin.lua).
// Build: nvcc -O3 --fmad=false -prec-div=true -prec-sqrt=true -o tcensus tcensus.cu    (GPU)
//        gcc -x c -O2 -ffp-contract=off -fopenmp -DTCPU -o tcensus tcensus.cu -lm          (CPU)
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

typedef struct { int a, b; int ma, mb; float P[3], Q[3]; int axis; double nya, nyb; uint32_t k0, k1; uint32_t n1, n2, n3; uint32_t k2; float z0; int candoff, ncand; float ymin, ymax; } Seam;
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
TD double plane_y(const TWorld *w, int mi, int k, double x, double z) {
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
TD int crack_at(const TWorld *w, const Seam *S, const int *cand, float x, float y, float z) {
  float s[3] = { x, y + 56.0f, z }, e[3] = { x, y + -444.0f, z };
  for (int q = 0; q < S->ncand; q++) { int c = cand[S->candoff + q]; if (tri_line_hit(w, c >> 24, c & 0xFFFFFF, s, e)) {
      // a hit counts only if it is this floor (within 5 below .. 56 above): compute the hit height
      const TModel *M = w->m[c >> 24]; int k = c & 0xFFFFFF; (void)M; double py = plane_y(w, c >> 24, k, x, z); if (py >= (double)y - 5.0 && py <= (double)y + 56.0) return 0; } }
  return 1; }
// ---- fall-in simulation of one spot, one timing variant
TD void fall_run2(const TWorld *w, float x, float y, float z, float drop, int lagupd, TAct *act, unsigned char *out, unsigned char *holds, unsigned char *maxh, unsigned char *upd, unsigned char *sits, float *endy) {
  float pos[3] = { x, y + drop, z }, vy = 0.0f; int gnd = drop == 0.0f ? 1 : 0; TTrack tr; memset(&tr, 0, sizeof tr); tr.posZ = 56.0f; tr.mode = 2;
  int nh = 0, mh = 0, touched = 0, ns = 0; int res = O_STUCK, k;
  for (k = 1; k <= NUPD; k++) {
    float dt = (k == lagupd) ? 0.050000004f : 0.033333335f;
    vy = vy + dt * -2700.0f; if (vy < -4000.0f) vy = -4000.0f;
    float disp[3] = { 0.0f, vy * dt, 0.0f }, tgt[3] = { pos[0], pos[1] + disp[1], pos[2] };
    TRes R; resolve(w, &tr, pos, tgt, disp, gnd, 80.0f, 35.0f, TFILT_FLOOR, &R, act);
    if (R.hits && R.out[1] == pos[1] && pos[1] < y - 1.0f) ns++;   // sitting in the crack: feet under the floor, sphere resting on it
    vcp(pos, R.out); gnd = R.grounded; if (gnd && vy < 0.0f) vy = -1.0f;
    if (R.held) nh++; if (R.hits > mh) mh = R.hits; if (R.hits) touched = 1;
    if (k == 1 && drop == 0.0f && (pos[0] != x || pos[2] != z)) { res = O_WALL; break; }
    if (tr.water_seen) { res = O_WATER; break; }
    if (pos[1] < y - 115.0f && !R.hits) {   // the whole sphere is under the floor and free: through
      float a[3] = { pos[0], pos[1] + 1.0f, pos[2] }, b[3] = { pos[0], -30000.0f, pos[2] }, n[3] = { 0, 0, 0 };
      res = tri_ok(wline(w, a, b, n, TFILT_FLOOR)) ? O_LAND : O_VOID; break; }
    if (gnd && pos[1] >= y - 0.5f && (touched || k > 1) && (drop == 0.0f || vy == -1.0f)) { res = O_EJECT; break; }
  }
  *out = (unsigned char)res; *holds = (unsigned char)nh; *maxh = (unsigned char)mh; *upd = (unsigned char)(k > NUPD ? NUPD : k); *sits = (unsigned char)(ns > 255 ? 255 : ns); *endy = pos[1];
}

TD void fall_run(const TWorld *w, float x, float y, float z, int lagupd, TAct *act, unsigned char *out, unsigned char *holds, unsigned char *maxh, unsigned char *upd, unsigned char *sits, float *endy) {
  fall_run2(w, x, y, z, 0.0f, lagupd, act, out, holds, maxh, upd, sits, endy); }
// jump drops: Banjo coming down from a jump's apex onto the spot. Tooie jump (measured in BizHawk): tap A = apex 92 above the
// take-off floor, A held = 174.46; after the apex gravity is -2700 either way. NJ apex heights from 92 to 174 cover every
// arrival phase relative to the update boundaries (no lag).
#define NJ 42
TD float jump_h(int j) { return 92.0f + (float)j * 2.0f; }
typedef struct { unsigned char clip, voids, eject, stuck, hold, sitmax, other, pad; } JumpRes;
TD void jump_run(const TWorld *w, float x, float y, float z, int j, TAct *act, unsigned char *o, unsigned char *h, unsigned char *si) {
  unsigned char m, u; float e; fall_run2(w, x, y, z, jump_h(j), 0, act, o, h, &m, &u, si, &e); }
#ifndef TCPU
// ---- device copies of the world
__device__ TModel dM[2]; __device__ TWorld dW;
__global__ void k_crack(const Seam *S, int nseam, const int *cand, const uint64_t *off, uint64_t total, uint64_t base, uint8_t *out, uint64_t n) {
  uint64_t id = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x; if (id >= n) return; uint64_t g = base + id;
  int lo = 0, hi = nseam - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= g) lo = mid; else hi = mid - 1; }
  const Seam *s = S + lo; uint64_t r = g - off[lo]; uint32_t j = (uint32_t)(r / 7); int o = (int)(r % 7) - 3;
  float x, y, z; seam_point(&dW, s, j, o, &x, &y, &z); out[id] = (uint8_t)crack_at(&dW, s, cand, x, y, z); }
__global__ void k_jump(const Spot *P, const int *idx, int n, unsigned char *O) {
  int id = blockIdx.x * blockDim.x + threadIdx.x; if (id >= n * NJ) return; int q = id / NJ, j = id % NJ; const Spot *s = P + idx[q]; TAct act[TMAXACT];
  jump_run(&dW, s->x, s->y, s->z, j, act, O + 3 * (size_t)id, O + 3 * (size_t)id + 1, O + 3 * (size_t)id + 2); }
__global__ void k_fall(const Spot *P, int n, SpotRes *R) {
  int id = blockIdx.x * blockDim.x + threadIdx.x; if (id >= n * NVAR) return; int sp = id / NVAR, v = id % NVAR; TAct act[TMAXACT];
  fall_run(&dW, P[sp].x, P[sp].y, P[sp].z, v, act, &R[sp].out[v], &R[sp].holds[v], &R[sp].maxhits[v], &R[sp].upd[v], &R[sp].sits[v], &R[sp].endy[v]); }
static void upload(const TWorld *w) {
  TModel hm[2]; memset(hm, 0, sizeof hm); TWorld hw; memset(&hw, 0, sizeof hw); TModel *dmp; cudaGetSymbolAddress((void **)&dmp, dM);
  for (int i = 0; i < 2; i++) { if (!w->m[i]) continue; const TModel *M = w->m[i]; hm[i] = *M; void *p;
    cudaMalloc(&p, 6 * M->nv + 8); cudaMemcpy(p, M->V, 6 * M->nv, cudaMemcpyHostToDevice); hm[i].V = (short *)p;
    cudaMalloc(&p, 6 * M->nt + 8); cudaMemcpy(p, M->T, 6 * M->nt, cudaMemcpyHostToDevice); hm[i].T = (unsigned short *)p;
    cudaMalloc(&p, 4 * M->nt + 8); cudaMemcpy(p, M->TF, 4 * M->nt, cudaMemcpyHostToDevice); hm[i].TF = (unsigned *)p;
    cudaMalloc(&p, 4 * M->ncell + 8); cudaMemcpy(p, M->C, 4 * M->ncell, cudaMemcpyHostToDevice); hm[i].C = (unsigned short *)p;
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

static int ZEROSTEP = 0, EVERY = 0, HAVEREG = 0; static double REG[4];
static int in_region(const Seam *s) {   // distance from the region point to the seam segment
  if (!HAVEREG) return 1; double d[3], v[3], L2 = 0, t = 0; for (int c = 0; c < 3; c++) { v[c] = (double)s->Q[c] - s->P[c]; d[c] = REG[c] - s->P[c]; L2 += v[c] * v[c]; t += d[c] * v[c]; }
  t = L2 > 0 ? fmin(1, fmax(0, t / L2)) : 0; double q = 0; for (int c = 0; c < 3; c++) { double e = s->P[c] + t * v[c] - REG[c]; q += e * e; } return sqrt(q) <= REG[3]; }
// ---- exhaustive mode: every crack float gets the 9 fall-in runs and (when walking in does not clip) the 42 jump drops.
// Crack floats are processed chunk by chunk; consecutive crack floats of one seam and one across offset with identical outcomes are
// written as one RUN line:
//   RUN seam o n x0 y0 z0 x1 z1 outs9 holds9 maxhits9 sits9 upd endy J42/clip:voids,eject,stuck,other,hold,sitmax | -
// (outs9 / hold flags / jump counts identical over the run; maxhits, sits, upd, endy are the run's first float's)
typedef struct { int seam, o; uint32_t j; } CF;
typedef struct { int open; int seam, o; uint32_t j0, j1; uint64_t n; float x0, y0, z0, x1, z1; SpotRes r; JumpRes J; } RunAcc;
static int same_sig(const SpotRes *a, const JumpRes *ja, const SpotRes *b, const JumpRes *jb) {
  for (int v = 0; v < NVAR; v++) { if (a->out[v] != b->out[v]) return 0; if ((a->holds[v] > 0) != (b->holds[v] > 0)) return 0; }
  if (ja->pad != jb->pad) return 0; if (ja->pad && (ja->clip != jb->clip || ja->voids != jb->voids || ja->eject != jb->eject || ja->stuck != jb->stuck || ja->other != jb->other || ja->hold != jb->hold)) return 0;
  return 1; }
static void run_flush(FILE *f, RunAcc *R) {
  if (!R->open) return; SpotRes *r = &R->r; fprintf(f, "RUN %d %d %llu %.9g %.9g %.9g %.9g %.9g ", R->seam, R->o, (unsigned long long)R->n, R->x0, R->y0, R->z0, R->x1, R->z1);
  for (int v = 0; v < NVAR; v++) fprintf(f, "%d", r->out[v]); fprintf(f, " ");
  for (int v = 0; v < NVAR; v++) fprintf(f, "%s%d", v ? "," : "", r->holds[v]); fprintf(f, " ");
  for (int v = 0; v < NVAR; v++) fprintf(f, "%d", r->maxhits[v] > 9 ? 9 : r->maxhits[v]); fprintf(f, " ");
  for (int v = 0; v < NVAR; v++) fprintf(f, "%s%d", v ? "," : "", r->sits[v]); fprintf(f, " %d %.3f", r->upd[0], r->endy[0]);
  JumpRes *J = &R->J; if (J->pad) fprintf(f, " J%d/%d:%d,%d,%d,%d,%d,%d\n", NJ, J->clip, J->voids, J->eject, J->stuck, J->other, J->hold, J->sitmax); else fprintf(f, " -\n");
  R->open = 0; }
static int every_mode(TWorld *wp, Seam *S, int ns, int *cand, int nc, uint64_t *off, uint64_t total, const char *room, const char *outp) {
  TWorld &w = *wp; char rp[1024]; snprintf(rp, sizeof rp, "%s.runs", outp); FILE *fr = fopen(rp, "w"); if (!fr) { fprintf(stderr, "cannot write %s\n", rp); return 2; }
  uint64_t ncracks = 0, nruns = 0, nfall = 0, njump = 0; uint64_t *seamcr = (uint64_t *)calloc(ns + 1, 8);
  const uint64_t CH = 1ull << 23; uint8_t *buf = (uint8_t *)malloc(CH);
  Spot *SP = (Spot *)malloc(sizeof(Spot) * (CH + 1)); CF *cf = (CF *)malloc(sizeof(CF) * (CH + 1)); SpotRes *RS = (SpotRes *)malloc(sizeof(SpotRes) * (CH + 1));
  JumpRes *JR = (JumpRes *)malloc(sizeof(JumpRes) * (CH + 1)); int *jidx = (int *)malloc(4 * (CH + 1)); unsigned char *JO = (unsigned char *)malloc(3 * (size_t)NJ * (1 << 16) + 3);
  RunAcc acc[7]; memset(acc, 0, sizeof acc); int curseam = -1;
#ifndef TCPU
  upload(&w); Seam *dS; int *dC; uint64_t *dO; uint8_t *dB; cudaMalloc(&dS, sizeof(Seam) * (ns + 1)); cudaMemcpy(dS, S, sizeof(Seam) * ns, cudaMemcpyHostToDevice);
  cudaMalloc(&dC, 4 * (nc + 1)); cudaMemcpy(dC, cand, 4 * nc, cudaMemcpyHostToDevice); cudaMalloc(&dO, 8 * (ns + 1)); cudaMemcpy(dO, off, 8 * (ns + 1), cudaMemcpyHostToDevice); cudaMalloc(&dB, CH);
  Spot *dP; SpotRes *dR; int *dI; unsigned char *dJ; const int FB = 1 << 18, JB = 1 << 16;
  cudaMalloc(&dP, sizeof(Spot) * (CH + 1)); cudaMalloc(&dR, sizeof(SpotRes) * (FB + 1)); cudaMalloc(&dI, 4 * (JB + 1)); cudaMalloc(&dJ, 3 * (size_t)NJ * JB + 3);
#endif
  double tlast = now();
  for (uint64_t base = 0; base < total; base += CH) { uint64_t n = total - base < CH ? total - base : CH;
#ifndef TCPU
    k_crack<<<(unsigned)((n + 255) / 256), 256>>>(dS, ns, dC, dO, total, base, dB, n); cudaMemcpy(buf, dB, n, cudaMemcpyDeviceToHost);
    { cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda crack: %s\n", cudaGetErrorString(er)); return 4; } }
#else
    #pragma omp parallel for schedule(dynamic, 4096)
    for (int64_t id = 0; id < (int64_t)n; id++) { uint64_t g = base + id; int lo = 0, hi = ns - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= g) lo = mid; else hi = mid - 1; }
      uint64_t r = g - off[lo]; float x, y, z; seam_point(&w, S + lo, (uint32_t)(r / 7), (int)(r % 7) - 3, &x, &y, &z); buf[id] = (uint8_t)crack_at(&w, S + lo, cand, x, y, z); }
#endif
    // the crack floats of this chunk, in order
    int np = 0; int si = 0; { int lo = 0, hi = ns - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= base) lo = mid; else hi = mid - 1; } si = lo; }
    for (uint64_t id = 0; id < n; id++) { if (!buf[id]) continue; uint64_t g = base + id; while (si + 1 < ns && off[si + 1] <= g) si++;
      uint64_t r = g - off[si]; float x, y, z; uint32_t j = (uint32_t)(r / 7); int o = (int)(r % 7) - 3; seam_point(&w, S + si, j, o, &x, &y, &z); ncracks++; seamcr[si]++;
      SP[np].seam = si; SP[np].x = x; SP[np].y = y; SP[np].z = z; SP[np].width = 1; cf[np].seam = si; cf[np].o = o; cf[np].j = j; np++; }
    if (!np) continue;
    // fall-in: 9 runs per crack float
#ifndef TCPU
    cudaMemcpy(dP, SP, sizeof(Spot) * np, cudaMemcpyHostToDevice);
    for (int b = 0; b < np; b += FB) { int m = np - b < FB ? np - b : FB; k_fall<<<(m * NVAR + 63) / 64, 64>>>(dP + b, m, dR); cudaDeviceSynchronize();
      cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda fall: %s\n", cudaGetErrorString(er)); return 4; }
      cudaMemcpy(RS + b, dR, sizeof(SpotRes) * m, cudaMemcpyDeviceToHost); }
#else
    #pragma omp parallel for schedule(dynamic, 16)
    for (int i = 0; i < np * NVAR; i++) { static __thread TAct act[TMAXACT]; int sp = i / NVAR, v = i % NVAR;
      fall_run(&w, SP[sp].x, SP[sp].y, SP[sp].z, v, act, &RS[sp].out[v], &RS[sp].holds[v], &RS[sp].maxhits[v], &RS[sp].upd[v], &RS[sp].sits[v], &RS[sp].endy[v]); }
#endif
    nfall += np;
    // jump drops where walking in (no lag) does not take Banjo through
    memset(JR, 0, sizeof(JumpRes) * np); int nj = 0; for (int i = 0; i < np; i++) { int oo = RS[i].out[0]; if (oo == O_EJECT || oo == O_STUCK) jidx[nj++] = i; }
    for (int b = 0; b < nj; b += (1 << 16)) { int m = nj - b < (1 << 16) ? nj - b : (1 << 16);
#ifndef TCPU
      cudaMemcpy(dI, jidx + b, 4 * m, cudaMemcpyHostToDevice);
      k_jump<<<(m * NJ + 63) / 64, 64>>>(dP, dI, m, dJ); cudaDeviceSynchronize();
      { cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda jump: %s\n", cudaGetErrorString(er)); return 4; } }
      cudaMemcpy(JO, dJ, 3 * (size_t)m * NJ, cudaMemcpyDeviceToHost);
#else
      #pragma omp parallel for schedule(dynamic, 16)
      for (int i = 0; i < m * NJ; i++) { static __thread TAct act[TMAXACT]; int q = i / NJ, jj = i % NJ; const Spot *sp = SP + jidx[b + q];
        jump_run(&w, sp->x, sp->y, sp->z, jj, act, JO + 3 * (size_t)i, JO + 3 * (size_t)i + 1, JO + 3 * (size_t)i + 2); }
#endif
      for (int q = 0; q < m; q++) { JumpRes *J = JR + jidx[b + q]; for (int jj = 0; jj < NJ; jj++) { unsigned char *r = JO + 3 * ((size_t)q * NJ + jj);
          if (r[0] == O_LAND || r[0] == O_VOID) J->clip++; if (r[0] == O_VOID) J->voids++; if (r[0] == O_EJECT) J->eject++; if (r[0] == O_STUCK) J->stuck++;
          if (r[0] == O_WATER || r[0] == O_WALL) J->other++; if (r[1]) J->hold++; if (r[2] > J->sitmax) J->sitmax = r[2]; } J->pad = 1; } }
    njump += nj;
    // runs
    for (int i = 0; i < np; i++) { const CF *c = cf + i; if (c->seam != curseam) { for (int q = 0; q < 7; q++) { if (acc[q].open) nruns++; run_flush(fr, acc + q); } curseam = c->seam; }
      RunAcc *A = acc + (c->o + 3);
      if (A->open && A->j1 + 1 == c->j && same_sig(&A->r, &A->J, RS + i, JR + i)) { A->j1 = c->j; A->n++; A->x1 = SP[i].x; A->z1 = SP[i].z; continue; }
      if (A->open) nruns++; run_flush(fr, A);
      A->open = 1; A->seam = c->seam; A->o = c->o; A->j0 = A->j1 = c->j; A->n = 1; A->x0 = A->x1 = SP[i].x; A->y0 = SP[i].y; A->z0 = A->z1 = SP[i].z; A->r = RS[i]; A->J = JR[i]; }
    if (now() - tlast > 20) { tlast = now(); LOG("  samples %llu/%llu, crack floats %llu, fall-in %llu, jump drops %llu x %d, runs %llu\n", (unsigned long long)(base + n), (unsigned long long)total, (unsigned long long)ncracks, (unsigned long long)nfall, (unsigned long long)njump, NJ, (unsigned long long)nruns); }
  }
  for (int q = 0; q < 7; q++) { if (acc[q].open) nruns++; run_flush(fr, acc + q); }
  fclose(fr);
  LOG("%llu crack floats, every one tested (%llu jump-drop floats), %llu runs\n", (unsigned long long)ncracks, (unsigned long long)njump, (unsigned long long)nruns);
  FILE *o = fopen(outp, "w"); fprintf(o, "ROOM %s seams %d samples %llu cracks %llu runs %llu every 1\n", room, ns, (unsigned long long)total, (unsigned long long)ncracks, (unsigned long long)nruns);
  for (int i = 0; i < ns; i++) fprintf(o, "SEAM %d %d:%d %d:%d %g %g %g %g %g %g %.4f %.4f %llu\n", i, S[i].ma, S[i].a, S[i].mb, S[i].b, S[i].P[0], S[i].P[1], S[i].P[2], S[i].Q[0], S[i].Q[1], S[i].Q[2], S[i].nya, S[i].nyb, (unsigned long long)seamcr[i]);
  fr = fopen(rp, "r"); { static char lb[1 << 16]; size_t k; while ((k = fread(lb, 1, sizeof lb, fr)) > 0) fwrite(lb, 1, k, o); } fclose(fr); remove(rp);
  fclose(o); fprintf(stderr, "done\n"); return 0; }
int main(int argc, char **argv) {
  { const char *e; ZEROSTEP = (e = getenv("TC_ZEROSTEP")) && atoi(e); EVERY = (e = getenv("TC_EVERY")) && atoi(e);
    if ((e = getenv("TC_REGION")) && sscanf(e, "%lf %lf %lf %lf", REG, REG + 1, REG + 2, REG + 3) == 4) HAVEREG = 1; }
  if (argc < 3) { fprintf(stderr, "usage: tcensus room.txt out.txt [maxseams]\n"); return 1; }
  T0 = now(); TWorld w; load_world(argv[1], &w); int maxseams = argc > 3 ? atoi(argv[3]) : 1 << 30;
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
      if (!ZEROSTEP || hi < -1.0f || lo > 1.0f) { s.n1 = s.k1 - s.k0 + 1; s.n2 = s.n3 = 0; }
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
  uint64_t *off = (uint64_t *)malloc(8 * (ns + 1)); uint64_t total = 0; for (int i = 0; i < ns; i++) { off[i] = total; total += ((uint64_t)S[i].n1 + S[i].n2 + S[i].n3) * 7; } off[ns] = total;
  LOG("%d seams, %d candidate entries, %llu crack samples\n", ns, nc, (unsigned long long)total);
  if (EVERY) return every_mode(&w, S, ns, cand, nc, off, total, argv[1], argv[2]);
  // crack scan -> spots (one per seam and 0.25 cell)
  int caps = 1 << 16, np = 0; Spot *SP = (Spot *)malloc(sizeof(Spot) * caps); uint64_t ncracks = 0; uint64_t *seamcr = (uint64_t *)calloc(ns + 1, 8);
  const uint64_t CH = 1ull << 27; uint8_t *buf = (uint8_t *)malloc(CH);
#ifndef TCPU
  upload(&w); Seam *dS; int *dC; uint64_t *dO; uint8_t *dB; cudaMalloc(&dS, sizeof(Seam) * (ns + 1)); cudaMemcpy(dS, S, sizeof(Seam) * ns, cudaMemcpyHostToDevice);
  cudaMalloc(&dC, 4 * (nc + 1)); cudaMemcpy(dC, cand, 4 * nc, cudaMemcpyHostToDevice); cudaMalloc(&dO, 8 * (ns + 1)); cudaMemcpy(dO, off, 8 * (ns + 1), cudaMemcpyHostToDevice); cudaMalloc(&dB, CH);
#endif
  int cur = -1; int64_t lastcell = INT64_MIN;
  for (uint64_t base = 0; base < total; base += CH) { uint64_t n = total - base < CH ? total - base : CH;
#ifndef TCPU
    k_crack<<<(unsigned)((n + 255) / 256), 256>>>(dS, ns, dC, dO, total, base, dB, n); cudaMemcpy(buf, dB, n, cudaMemcpyDeviceToHost);
    { cudaError_t er = cudaGetLastError(); if (er != cudaSuccess) { fprintf(stderr, "cuda crack: %s\n", cudaGetErrorString(er)); return 4; } } LOG("  crack samples %llu/%llu\n", (unsigned long long)(base + n), (unsigned long long)total);
#else
    #pragma omp parallel for schedule(dynamic, 4096)
    for (int64_t id = 0; id < (int64_t)n; id++) { uint64_t g = base + id; int lo = 0, hi = ns - 1; while (lo < hi) { int mid = (lo + hi + 1) / 2; if (off[mid] <= g) lo = mid; else hi = mid - 1; }
      uint64_t r = g - off[lo]; float x, y, z; seam_point(&w, S + lo, (uint32_t)(r / 7), (int)(r % 7) - 3, &x, &y, &z); buf[id] = (uint8_t)crack_at(&w, S + lo, cand, x, y, z); }
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
    fall_run(&w, SP[sp].x, SP[sp].y, SP[sp].z, v, act, &RS[sp].out[v], &RS[sp].holds[v], &RS[sp].maxhits[v], &RS[sp].upd[v], &RS[sp].sits[v], &RS[sp].endy[v]); }
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
      jump_run(&w, sp->x, sp->y, sp->z, j, act, JO + 3 * (size_t)i, JO + 3 * (size_t)i + 1, JO + 3 * (size_t)i + 2); }
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
