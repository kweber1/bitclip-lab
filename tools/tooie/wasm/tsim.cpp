// Claude 2026-11-11 (tsim.cpp): the Banjo-Tooie census for ONE 0.25 cell of one seam, for the viewer (WebAssembly) and for checking
// (native). Same code as tcensus.cu's reference path: tcol.h (the game's collision), the crack test over the seam's candidate
// triangles (filter 0x400005, seam box +-2), and per crack float the 9 fall-in runs (no lag, 3-VI update on update 1..8) and, when
// the no-lag walk-in ejects or sticks, the 42 jump drops; classified like tcensus classify(). Keep in sync with tcensus.cu.
// WebAssembly: clang++ --target=wasm32 -O2 -ffp-contract=off -ffreestanding -nostdlib -fno-exceptions -fno-rtti -std=c++17 -mnontrapping-fptoint -DTSIM_WASM -Iinclude
//              -Wl,--no-entry -Wl,--export-dynamic -o tsim.wasm tsim.cpp     (wasm floats are IEEE single/double, no fused ops)
// Native:      g++ -O2 -ffp-contract=off -DTSIM_NATIVE -o tsim tsim.cpp
// Xbox 360 (XBLA) version: add -DTX360 (-o tsim360.wasm): the 360 build's fused multiply-adds (see tcol.h; fmaf in include/math.h).
#ifndef TSIM_NATIVE
#include <stdint.h>
#include <string.h>
#define EXPORT(n) extern "C" __attribute__((export_name(n)))
extern "C" void *memcpy(void *d, const void *s, size_t n) { unsigned char *a = (unsigned char *)d; const unsigned char *b = (const unsigned char *)s; while (n--) *a++ = *b++; return d; }
extern "C" void *memset(void *d, int c, size_t n) { unsigned char *a = (unsigned char *)d; while (n--) *a++ = (unsigned char)c; return d; }
extern unsigned char __heap_base;
static unsigned long HEAP0 = 0, HP = 0;
static void *halloc(unsigned long n) { if (!HEAP0) HEAP0 = HP = ((unsigned long)&__heap_base + 15) & ~15ul; unsigned long p = HP; HP = (HP + n + 15) & ~15ul;
  unsigned long need = (HP + 65535) / 65536, have = __builtin_wasm_memory_size(0); if (need > have) __builtin_wasm_memory_grow(0, need - have); return (void *)p; }
#else
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#define EXPORT(n) extern "C"
static void *halloc(unsigned long n) { return calloc(1, n + 16); }
#endif
#include "../tcol.h"   // tools/tooie/tcol.h

#define NVAR 9
#define NUPD 90
enum { O_LAND = 0, O_VOID = 1, O_EJECT = 2, O_STUCK = 3, O_WATER = 4, O_WALL = 5 };
TD uint32_t fkey(float f) { uint32_t b; memcpy(&b, &f, 4); return (b & 0x80000000u) ? ~b : (b | 0x80000000u); }
TD float kfloat(uint32_t k) { uint32_t b = (k & 0x80000000u) ? (k & 0x7FFFFFFFu) : ~k; float f; memcpy(&f, &b, 4); return f; }
TD float fstep(float f, int n) { uint32_t k = fkey(f); return kfloat(k + (uint32_t)n); }

// ---- copied from tcensus.cu: tri_line_hit, plane_y (table-free form, same numbers), seam_point, the fall-in state and runs
TD int tri_line_hit(const TWorld *w, int mi, int k, const float *s, const float *e) {
  const TModel *M = w->m[mi]; float vv[3][3]; tv4(M, k, vv); float v0[3] = { vv[0][0], vv[0][1], vv[0][2] }, v1[3] = { vv[1][0], vv[1][1], vv[1][2] }, v2[3] = { vv[2][0], vv[2][1], vv[2][2] };
  float d[3]; vsub(d, e, s); float ab[3], ac[3], N[3]; vsub(ab, v1, v0); vsub(ac, v2, v0); vcross(N, ab, ac);
  if (100000.0f < fabsf_(N[0]) || 100000.0f < fabsf_(N[1]) || 100000.0f < fabsf_(N[2])) { N[0] = N[0] * 9.999999747e-06f; N[1] = N[1] * 9.999999747e-06f; N[2] = N[2] * 9.999999747e-06f; }
  float ls[3], le[3]; vsub(ls, s, v0); vsub(le, e, v0); float a = vdot(ls, N), b = vdot(le, N);
  if (0.0f <= a && 0.0f <= b) return 0; if (a <= 0.0f && b <= 0.0f) return 0;
  if ((M->TF[k] & 0x10000) && a < 0.0f) { N[0] = -N[0]; N[1] = -N[1]; N[2] = -N[2]; }
  float np = -vdot(v0, N); float nd = vdot(N, d); if (0.0f <= nd) return 0;
  float t = -(vdot(N, s) + np) / nd; if (t <= 0.0f) return 0; if (1.0f <= t) return 0;
  float cur[3] = { MADD(d[0], t, s[0]), MADD(d[1], t, s[1]), MADD(d[2], t, s[2]) };
  int pa = fabsf_(N[1]) < fabsf_(N[0]) ? 0 : 1; if (fabsf_(N[pa]) < fabsf_(N[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
  float f0 = cur[i1] - v0[i1], f1 = ab[i1], f2 = ac[i1], e0 = cur[i2] - v0[i2], e1 = ab[i2], e2 = ac[i2];
  float inv = 1.0f / BDEN(f1, f2, e1, e2);
  float u = BU(f0, f2, e0, e2) * inv; if (u < 0.0f || 1.0f < u) return 0;
  float ww = BW(f0, f1, e0, e1) * inv; if (ww < 0.0f || 1.0f < ww) return 0; if (1.0f < u + ww) return 0;
  return 1;
}
TD double plane_y(const TWorld *w, int mi, int k, double x, double z) {
  const TModel *M = w->m[mi]; const unsigned short *T = M->T + 3 * k; const short *A = M->V + 3 * T[0], *B = M->V + 3 * T[1], *C = M->V + 3 * T[2];
  double ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (ny == 0) return A[1];
  return A[1] - (nx * (x - A[0]) + nz * (z - A[2])) / ny;
}
TD int air_free(const float *iv, int ivn, float lo, float hi) {
  if (ivn < 0) return 0; for (int q = 0; q < ivn; q++) if (iv[2 * q] <= hi && iv[2 * q + 1] >= lo) return 0; return 1; }
TD int same5(const float *a, const float *b) { for (int i = 0; i < 5; i++) { uint32_t x, y; memcpy(&x, a + i, 4); memcpy(&y, b + i, 4); if (x != y) return 0; } return 1; }
typedef struct { float pos[3], vy; int gnd; TTrack tr; int nh, mh, touched, ns; float hs[2][5]; int hheld[2], hsit[2], nhist; } FState;
TD void fs_init(FState *s, float x, float y, float z, float drop) {
  memset(s, 0, sizeof *s); s->pos[0] = x; s->pos[1] = y + drop; s->pos[2] = z; s->vy = 0.0f; s->gnd = drop == 0.0f ? 1 : 0; s->tr.posZ = 56.0f; s->tr.mode = 2; }
TD int fs_step(const TWorld *w, FState *s, float x, float y, float z, float drop, int lagupd, int kreg, int *kp, TAct *act, const float *iv, int ivn, int ivw) {
  int k = *kp; float *pos = s->pos;
  float dt = (k == lagupd) ? 0.050000004f : 0.033333335f;
  s->vy = MADD(dt, -2700.0f, s->vy); if (s->vy < -4000.0f) s->vy = -4000.0f;   // 360 (0x820BA934): fmadds
  float disp[3] = { 0.0f, s->vy * dt, 0.0f }, tgt[3] = { pos[0], pos[1] + disp[1], pos[2] };
  TRes R;
  { float lo = (pos[1] < tgt[1] ? pos[1] : tgt[1]) - 2.0f, hi = (pos[1] > tgt[1] ? pos[1] : tgt[1]) + 80.0f + 35.0f + 2.0f;
    if (air_free(iv, ivn, lo, hi)) {
      if (!ivw && !s->gnd) { R.hits = 0; R.held = 0; R.held_flag = 0; R.last = TNONE; vcp(R.out, tgt); R.grounded = 0; }
      else { float u0[3]; vcp(u0, tgt); int g = s->gnd; floor_snap(&s->tr, w, u0, disp, &g, TFILT_FLOOR);
        R.hits = 0; R.held = 0; R.held_flag = 0; R.last = TNONE; vcp(R.out, u0); R.grounded = g; } }
    else resolve(w, &s->tr, pos, tgt, disp, s->gnd, 80.0f, 35.0f, TFILT_FLOOR, &R, act); }
  int sitinc = (R.hits && R.out[1] == pos[1] && pos[1] < y - 1.0f) ? 1 : 0; s->ns += sitinc;
  vcp(pos, R.out); s->gnd = R.grounded; if (s->gnd && s->vy < 0.0f) s->vy = -1.0f;
  if (R.held) s->nh++; if (R.hits > s->mh) s->mh = R.hits; if (R.hits) s->touched = 1;
  if (k == 1 && drop == 0.0f && (pos[0] != x || pos[2] != z)) return O_WALL;
  if (s->tr.water_seen) return O_WATER;
  if (pos[1] < y - 115.0f && !R.hits) {
    float a[3] = { pos[0], pos[1] + 1.0f, pos[2] }, b[3] = { pos[0], -30000.0f, pos[2] }, n[3] = { 0, 0, 0 };
    return tri_ok(wline(w, a, b, n, TFILT_FLOOR)) ? O_LAND : O_VOID; }
  if (s->gnd && pos[1] >= y - 0.5f && (s->touched || k > 1) && (drop == 0.0f || s->vy == -1.0f)) return O_EJECT;
  if (k >= kreg && k < NUPD) {
    float cur[5] = { pos[0], pos[1], pos[2], s->vy, (float)s->gnd };
    if (s->nhist >= 1 && same5(cur, s->hs[0])) { int r = NUPD - k; s->nh += r * (R.held ? 1 : 0); s->ns += r * sitinc; *kp = NUPD + 1; return O_STUCK; }
    if (s->nhist >= 2 && same5(cur, s->hs[1]) && k - 1 >= kreg) {
      int r = NUPD - k, a_ = (r + 1) / 2, b_ = r / 2; s->nh += a_ * s->hheld[0] + b_ * (R.held ? 1 : 0); s->ns += a_ * s->hsit[0] + b_ * sitinc;
      if (r % 2) { pos[0] = s->hs[0][0]; pos[1] = s->hs[0][1]; pos[2] = s->hs[0][2]; } *kp = NUPD + 1; return O_STUCK; }
    memcpy(s->hs[1], s->hs[0], sizeof s->hs[0]); s->hheld[1] = s->hheld[0]; s->hsit[1] = s->hsit[0]; memcpy(s->hs[0], cur, sizeof cur); s->hheld[0] = R.held ? 1 : 0; s->hsit[0] = sitinc; s->nhist++; }
  else if (k < kreg) { float cur[5] = { pos[0], pos[1], pos[2], s->vy, (float)s->gnd }; memcpy(s->hs[1], s->hs[0], sizeof s->hs[0]); s->hheld[1] = s->hheld[0]; s->hsit[1] = s->hsit[0]; memcpy(s->hs[0], cur, sizeof cur); s->hheld[0] = R.held ? 1 : 0; s->hsit[0] = sitinc; s->nhist++; }
  return -1; }
TD void fs_finish(const FState *s, int res, int k, unsigned char *out, unsigned char *holds, unsigned char *maxh, unsigned char *upd, unsigned char *sits, float *endy) {
  *out = (unsigned char)res; *holds = (unsigned char)s->nh; *maxh = (unsigned char)s->mh; *upd = (unsigned char)(k > NUPD ? NUPD : k); *sits = (unsigned char)(s->ns > 255 ? 255 : s->ns); *endy = s->pos[1]; }
TD int fs_run(const TWorld *w, FState *s, float x, float y, float z, float drop, int lagupd, int k0, TAct *act, const float *iv, int ivn, int ivw, int *kend) {
  const int kreg = lagupd > 1 ? lagupd + 1 : 2; int res = O_STUCK, k;
  for (k = k0; k <= NUPD; k++) { int r = fs_step(w, s, x, y, z, drop, lagupd, kreg, &k, act, iv, ivn, ivw); if (r >= 0) { res = r; break; } }
  *kend = k; return res; }
TD void fall_run2(const TWorld *w, float x, float y, float z, float drop, int lagupd, TAct *act, unsigned char *out, unsigned char *holds, unsigned char *maxh, unsigned char *upd, unsigned char *sits, float *endy) {
  FState s; fs_init(&s, x, y, z, drop); int k; int res = fs_run(w, &s, x, y, z, drop, lagupd, 1, act, 0, -1, 1, &k);
  fs_finish(&s, res, k, out, holds, maxh, upd, sits, endy); }
#define NJ 42
TD float jump_h(int j) { return 92.0f + (float)j * 2.0f; }

// ---- world, seam, results
static TModel MODELS[2]; static TWorld W; static TAct ACT[TMAXACT];
typedef struct { float P[3], Q[3]; int ma, a, mb, b, axis; uint32_t k0, k1, n1, n3, k2; int *cand, ncand; } TSeam;
static TSeam SE;
// result of one float: out/holds/maxhits/upd/sits [9] each, endy[9], jump {clip voids eject stuck other hold sitmax ran}, category, hold
typedef struct { unsigned char out[NVAR], holds[NVAR], maxhits[NVAR], upd[NVAR], sits[NVAR], j[8], cat, hold, pad[2]; float endy[NVAR]; } TRes1;
enum { C_WALK, C_VOID, C_LAG, C_JUMP, C_EJECT, C_STUCK, C_WALL, C_WATER, C_HOLD };

EXPORT("ts_alloc") void *ts_alloc(int n) { return halloc((unsigned long)n); }
// model from ints: nv nt ncell gn h[11] V[3 nv] (a b c flags)[nt] C[2 ncell]  (= mkroom.py text); slot 0 opaque, 1 transparent; nv < 0 = none
EXPORT("ts_load") int ts_load(int slot, const int *d) {
  if (d[0] < 0) { W.m[slot] = 0; return 0; }
  TModel *M = &MODELS[slot]; memset(M, 0, sizeof *M); M->nv = d[0]; M->nt = d[1]; M->ncell = d[2]; M->gn = (float)(unsigned short)d[3]; const int *p = d + 4;
  for (int i = 0; i < 11; i++) M->h[i] = (short)*p++;
  short *V = (short *)halloc(6 * M->nv + 6); unsigned short *T = (unsigned short *)halloc(6 * M->nt + 6); unsigned *TF = (unsigned *)halloc(4 * M->nt + 4); unsigned short *C = (unsigned short *)halloc(4 * M->ncell + 4);
  for (int i = 0; i < 3 * M->nv; i++) V[i] = (short)*p++;
  for (int i = 0; i < M->nt; i++) { T[3 * i] = (unsigned short)p[0]; T[3 * i + 1] = (unsigned short)p[1]; T[3 * i + 2] = (unsigned short)p[2]; TF[i] = (unsigned)p[3]; p += 4; }
  for (int i = 0; i < 2 * M->ncell; i++) C[i] = (unsigned short)*p++;
  short *BB = (short *)halloc(12 * M->nt + 12);
  for (int i = 0; i < M->nt; i++) for (int c = 0; c < 3; c++) { short lo = V[3 * T[3 * i] + c], hi = lo;
      for (int j = 1; j < 3; j++) { short q = V[3 * T[3 * i + j] + c]; if (q < lo) lo = q; if (hi < q) hi = q; } BB[6 * i + 2 * c] = lo; BB[6 * i + 2 * c + 1] = hi; }
  float *TV = (float *)halloc(36 * M->nt + 36);
  for (int i = 0; i < M->nt; i++) for (int j = 0; j < 3; j++) for (int c = 0; c < 3; c++) TV[9 * i + 3 * j + c] = (float)V[3 * T[3 * i + j] + c];
  TF4 *TB = (TF4 *)halloc(32 * M->nt + 32), *TV4 = (TF4 *)halloc(48 * M->nt + 48);
  for (int i = 0; i < M->nt; i++) { float fl; memcpy(&fl, &TF[i], 4); TB[2 * i].x = BB[6 * i]; TB[2 * i].y = BB[6 * i + 1]; TB[2 * i].z = BB[6 * i + 2]; TB[2 * i].w = BB[6 * i + 3];
    TB[2 * i + 1].x = BB[6 * i + 4]; TB[2 * i + 1].y = BB[6 * i + 5]; TB[2 * i + 1].z = fl; TB[2 * i + 1].w = 0.0f;
    const float *q = TV + 9 * i; TV4[3 * i].x = q[0]; TV4[3 * i].y = q[1]; TV4[3 * i].z = q[2]; TV4[3 * i].w = q[3]; TV4[3 * i + 1].x = q[4]; TV4[3 * i + 1].y = q[5];
    TV4[3 * i + 1].z = q[6]; TV4[3 * i + 1].w = q[7]; TV4[3 * i + 2].x = q[8]; TV4[3 * i + 2].y = 0.0f; TV4[3 * i + 2].z = 0.0f; TV4[3 * i + 2].w = 0.0f; }
  M->V = V; M->T = T; M->TF = TF; M->C = C; M->BB = BB; M->TV = TV; M->TB = TB; M->TV4 = TV4;   // no finer index: FOR_QUERY_TRIS uses the cells (same triangles, same order)
  W.m[slot] = M; return M->nt; }
// the seam (from the room file: P, Q, model:triangle of both floors); phase A floats: every float on the major axis except |m| <= 1
EXPORT("ts_seam") int ts_seam(float p0, float p1, float p2, float q0, float q1, float q2, int ma, int a, int mb, int b) {
  TSeam *s = &SE; s->P[0] = p0; s->P[1] = p1; s->P[2] = p2; s->Q[0] = q0; s->Q[1] = q1; s->Q[2] = q2; s->ma = ma; s->a = a; s->mb = mb; s->b = b;
  s->axis = fabs((double)s->Q[0] - s->P[0]) >= fabs((double)s->Q[2] - s->P[2]) ? 0 : 2;
  float lo = s->P[s->axis] < s->Q[s->axis] ? s->P[s->axis] : s->Q[s->axis], hi = s->P[s->axis] < s->Q[s->axis] ? s->Q[s->axis] : s->P[s->axis]; s->k0 = fkey(lo); s->k1 = fkey(hi);
  s->n1 = s->k1 - s->k0 + 1; s->n3 = 0; s->k2 = 0;
  if (!(hi < -1.0f || lo > 1.0f)) { s->n1 = lo < -1.0f ? fkey(-1.0f) - s->k0 : 0; s->k2 = fkey(1.0f) + 1; s->n3 = hi > 1.0f ? s->k1 - s->k2 + 1 : 0; }
  // candidates: every triangle the floor ray could hit near the seam (filter 0x400005), as tcensus.cu
  float ymin = s->P[1] < s->Q[1] ? s->P[1] : s->Q[1], ymax = s->P[1] < s->Q[1] ? s->Q[1] : s->P[1];
  double bx0 = fmin(s->P[0], s->Q[0]) - 2, bx1 = fmax(s->P[0], s->Q[0]) + 2, bz0 = fmin(s->P[2], s->Q[2]) - 2, bz1 = fmax(s->P[2], s->Q[2]) + 2, by0 = ymin - 6, by1 = ymax + 57;
  int n = 0; for (int mi = 0; mi < 2; mi++) if (W.m[mi]) n += W.m[mi]->nt; s->cand = (int *)halloc(4 * n + 4); s->ncand = 0;
  for (int mi = 0; mi < 2; mi++) { const TModel *M = W.m[mi]; if (!M) continue;
    for (int k = 0; k < M->nt; k++) { if (M->TF[k] & TFILT_FLOOR) continue; int mnx = 1 << 30, mxx = -(1 << 30), mny = mnx, mxy = mxx, mnz = mnx, mxz = mxx;
      for (int j = 0; j < 3; j++) { const short *p = M->V + 3 * M->T[3 * k + j]; if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]; if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]; if (p[2] < mnz) mnz = p[2]; if (p[2] > mxz) mxz = p[2]; }
      if (mxx < bx0 || mnx > bx1 || mxz < bz0 || mnz > bz1 || mxy < by0 || mny > by1) continue;
      s->cand[s->ncand++] = (mi << 24) | k; } }
  return (int)(s->n1 + s->n3); }
static void seam_pt(uint32_t j, int o, float *x, float *y, float *z) {
  const TSeam *S = &SE; float m = j < S->n1 ? kfloat(S->k0 + j) : kfloat(S->k2 + (j - S->n1));
  int ax = S->axis, ot = 2 - ax; double t = ((double)m - S->P[ax]) / ((double)S->Q[ax] - S->P[ax]); double c = S->P[ot] + t * ((double)S->Q[ot] - S->P[ot]);
  float cf = fstep((float)c, o); float p[3]; p[ax] = m; p[ot] = cf; double yy = plane_y(&W, S->ma, S->a, p[0], p[2]); *x = p[0]; *z = p[2]; *y = (float)yy; }
static int crack_at(float x, float y, float z) {
  float s[3] = { x, y + 56.0f, z }, e[3] = { x, y + -444.0f, z };
  for (int q = 0; q < SE.ncand; q++) { int c = SE.cand[q]; int mi = (c >> 24) & 1, k = c & 0xFFFFFF;
    if (tri_line_hit(&W, mi, k, s, e)) { double py = plane_y(&W, mi, k, x, z); if (py >= (double)y - 5.0 && py <= (double)y + 56.0) return 0; } }
  return 1; }
// the seam's float indices j whose major coordinate is in 0.25 cell c of the major axis: [*j0, *j1)
EXPORT("ts_jrange") int ts_jrange(int c, uint32_t *out) {
  const TSeam *S = &SE; uint32_t a = fkey((float)c * 0.25f), b = fkey((float)(c + 1) * 0.25f);   // keys of the cell's floats: [a, b)
  uint32_t r0 = S->k0, r1 = S->k0 + S->n1, j0 = 0xFFFFFFFFu, j1 = 0;
  uint32_t lo = a > r0 ? a : r0, hi = b < r1 ? b : r1; if (lo < hi) { j0 = lo - S->k0; j1 = hi - S->k0; }
  if (S->n3) { uint32_t s0 = S->k2, s1 = S->k2 + S->n3, lo2 = a > s0 ? a : s0, hi2 = b < s1 ? b : s1;
    if (lo2 < hi2) { uint32_t q0 = S->n1 + (lo2 - S->k2), q1 = S->n1 + (hi2 - S->k2); if (j0 == 0xFFFFFFFFu) j0 = q0; j1 = q1; } }
  if (j0 == 0xFFFFFFFFu) { out[0] = out[1] = 0; return 0; } out[0] = j0; out[1] = j1; return (int)(j1 - j0); }
// crack floats of cell (cx, cz) among floats j0..j1-1 (all 7 across offsets): writes {j, o, x, y, z} (x y z as float bits), up to max
EXPORT("ts_scan") int ts_scan(int cx, int cz, uint32_t j0, uint32_t j1, uint32_t *out, int max) {
  int n = 0;
  for (uint32_t j = j0; j < j1; j++) for (int o = -3; o <= 3; o++) { float x, y, z; seam_pt(j, o, &x, &y, &z);
    if ((int)floor((double)x / 0.25) != cx || (int)floor((double)z / 0.25) != cz) continue;
    if (!crack_at(x, y, z)) continue;
    if (n < max) { uint32_t *q = out + 5 * n; q[0] = j; q[1] = (uint32_t)(o + 3); memcpy(q + 2, &x, 4); memcpy(q + 3, &y, 4); memcpy(q + 4, &z, 4); } n++; }
  return n; }
// every run of one crack float -> *r; returns the category (C_*), as tcensus classify()
EXPORT("ts_eval") int ts_eval(float x, float y, float z, TRes1 *r) {
  memset(r, 0, sizeof *r);
  for (int v = 0; v < NVAR; v++) fall_run2(&W, x, y, z, 0.0f, v, ACT, &r->out[v], &r->holds[v], &r->maxhits[v], &r->upd[v], &r->sits[v], &r->endy[v]);
  int w0 = r->out[0], any = 0, hold = 0; for (int v = 0; v < NVAR; v++) { if (r->out[v] == O_LAND || r->out[v] == O_VOID) any = 1; if (r->holds[v]) hold = 1; }
  if (w0 == O_EJECT || w0 == O_STUCK) { unsigned char *J = r->j;
    for (int j = 0; j < NJ; j++) { unsigned char o, h, m, u, si; float e; fall_run2(&W, x, y, z, jump_h(j), 0, ACT, &o, &h, &m, &u, &si, &e);
      if (o == O_LAND || o == O_VOID) J[0]++; if (o == O_VOID) J[1]++; if (o == O_EJECT) J[2]++; if (o == O_STUCK) J[3]++; if (o == O_WATER || o == O_WALL) J[4]++; if (h) J[5]++; if (si > J[6]) J[6] = si; }
    J[7] = 1; if (J[5]) hold = 1; }
  int cat = (w0 == O_LAND || w0 == O_VOID) ? C_WALK : w0 == O_WALL ? C_WALL : w0 == O_WATER ? C_WATER : any ? C_LAG : (r->j[7] && r->j[0] > 0) ? C_JUMP : w0 == O_STUCK ? C_STUCK : C_EJECT;
  r->cat = (unsigned char)cat; r->hold = (unsigned char)hold; return cat; }
EXPORT("ts_res_size") int ts_res_size(void) { return (int)sizeof(TRes1); }

#ifdef TSIM_NATIVE
// check: tsim room.txt tc.txt [max cells]  -> recompute CELL lines of the census for the first cells of a few seams and compare counts
#include <string.h>
static int *read_model_ints(FILE *f) { char w[16]; if (fscanf(f, "%15s", w) != 1) return 0; static int none[1] = { -1 }; if (!strcmp(w, "NOMODEL")) return none;
  int nv, nt, nc, gn; fscanf(f, "%d %d %d %d", &nv, &nt, &nc, &gn); int n = 4 + 11 + 3 * nv + 4 * nt + 2 * nc; int *d = (int *)malloc(4 * n); d[0] = nv; d[1] = nt; d[2] = nc; d[3] = gn;
  for (int i = 4; i < n; i++) { long long x; fscanf(f, "%lld", &x); d[i] = (int)(unsigned)x; } return d; }
int main(int argc, char **argv) {
  FILE *f = fopen(argv[1], "r"); int *m0 = read_model_ints(f), *m1 = read_model_ints(f); fclose(f); ts_load(0, m0); ts_load(1, m1);
  FILE *t = fopen(argv[2], "r"); static char line[1 << 16]; int maxc = argc > 3 ? atoi(argv[3]) : 50, every = argc > 4 ? atoi(argv[4]) : 1, done = 0, ok = 0, ln = 0;
  struct Sm { float P[3], Q[3]; int ma, a, mb, b; } *SM = (Sm *)calloc(200000, sizeof(Sm)); int ns = 0;
  while (fgets(line, sizeof line, t) && done < maxc) {
    if (!strncmp(line, "SEAM ", 5)) { int i, ma, a, mb, b; float P[3], Q[3]; sscanf(line + 5, "%d %d:%d %d:%d %f %f %f %f %f %f", &i, &ma, &a, &mb, &b, P, P + 1, P + 2, Q, Q + 1, Q + 2);
      SM[i].ma = ma; SM[i].a = a; SM[i].mb = mb; SM[i].b = b; memcpy(SM[i].P, P, 12); memcpy(SM[i].Q, Q, 12); if (i >= ns) ns = i + 1; continue; }
    if (strncmp(line, "CELL ", 5)) continue; if ((ln++ % every) != 0) continue;
    int seam; unsigned long long n, c[9]; float x, y, z; char *bar = strchr(line, '|');
    sscanf(line + 5, "%d %llu %llu %llu %llu %llu %llu %llu %llu %llu %llu", &seam, &n, c, c + 1, c + 2, c + 3, c + 4, c + 5, c + 6, c + 7, c + 8); sscanf(bar + 1, "%f %f %f", &x, &y, &z);
    const Sm *s = SM + seam; ts_seam(s->P[0], s->P[1], s->P[2], s->Q[0], s->Q[1], s->Q[2], s->ma, s->a, s->mb, s->b);
    int cx = (int)floor((double)x / 0.25), cz = (int)floor((double)z / 0.25); uint32_t jr[2]; ts_jrange(SE.axis == 0 ? cx : cz, jr);
    static uint32_t buf[5 << 22]; int nc = ts_scan(cx, cz, jr[0], jr[1], buf, 1 << 22);
    unsigned long long k[9] = { 0 }; TRes1 R;
    for (int q = 0; q < nc && q < (1 << 22); q++) { float px, py, pz; memcpy(&px, buf + 5 * q + 2, 4); memcpy(&py, buf + 5 * q + 3, 4); memcpy(&pz, buf + 5 * q + 4, 4);
      int cat = ts_eval(px, py, pz, &R); k[cat]++; if (cat == C_WALK && R.out[0] == O_VOID) k[C_VOID]++; if (R.hold) k[C_HOLD]++; }
    int same = (unsigned long long)nc == n; for (int i = 0; i < 9; i++) if (k[i] != c[i]) same = 0;
    done++; ok += same;
    if (!same) printf("DIFF seam %d cell %d %d: census n %llu %llu %llu %llu %llu %llu %llu %llu %llu %llu | here n %d %llu %llu %llu %llu %llu %llu %llu %llu %llu\n", seam, cx, cz, n, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], nc, k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7], k[8]);
  }
  printf("cells checked %d, identical %d\n", done, ok); return 0; }
#endif
