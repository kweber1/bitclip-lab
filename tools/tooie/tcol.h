// Claude 2026-11-11 (tcol.h): Banjo-Tooie (USA) player collision, ported from the ROM's asm (decomp github.com/mr-wiseguy/banjo-tooie)
// for the bit-clip census. Plain C that also builds as CUDA (define TCOL_CUDA). Every float operation is single precision in the
// game's order; build without FMA contraction (gcc -ffp-contract=off, nvcc --fmad=false) so results match the console bit for bit.
//   line test per model            func_800AB0BC   (normal scaled by 1e-5 when > 1e5; back faces skipped; 1/den barycentrics)
//   moving sphere per model        func_800AC638 + fast check func_800ABCE0 + iteration func_800AC100
//   static sphere per model        func_800AC978
//   map providers (opa, then xlu)  func_800BEF00 (line; opaque skipped for the water filter 0x1F00), func_800BF0E0, func_800BF228
//   floor tracker, mode 2          func_800C65E0 / func_800C6060 / func_800C5CC0 (500-unit ray pieces)
//   resolver                       func_800D4584 (+ func_800FAE44 fallback push 2.0, func_800FABF4 line, func_800D4400 floor snap,
//                                  func_800FB434, func_800FAF78 normal push, flat-floor edge push func_800F0410 of 2*(pass+1)^2)
// -DTX360: the Xbox 360 XBLA build (Banjo2_CPR.exe) instead. Same code, but its compiler fused multiply-adds (PPC fmadds / fmsubs /
// fnmsubs: one rounding) and summed dot products in another order. Every such spot, from the 360 asm (2026-11-12):
//   dot 0x8228CB40 = x*x' + (z*z' + y*y'), length^2 0x8228CE80 / normalize 0x8228D118 / set length 0x8228D1C8 / 0x8228DAD0 =
//   z*z + (x*x + y*y), distance^2 0x8228CBA0 = dx*dx + (dz*dz + dy*dy), cross 0x8228CA48 (one product of each component fused),
//   line test 0x82227850 (hit point d*t + s, barycentrics), moving sphere 0x822289D0 (bisection point), fast check 0x82228270,
//   iteration 0x82228630 and sphere 0x82228C88 (plane point, barycentrics, edge distance), resolver 0x82259E08 (|d|^2 inline in
//   y, z, x order), normal push 0x822C2018 (u0 + n*ph fused). fmaf() is correctly rounded on the CPU and the card.
#ifndef TCOL_H
#define TCOL_H
#ifdef TCOL_CUDA
#define TD __host__ __device__ static inline
#else
#define TD static inline
#include <math.h>
#include <string.h>
#endif
// per triangle, ready to load in 16-byte pieces (read-only cache on the card): TB = box and flags { minx maxx miny maxy } { minz maxz
// flags(bits) 0 }, TV4 = corners { v0x v0y v0z v1x } { v1y v1z v2x v2y } { v2z 0 0 0 }; exact copies of the shorts / flags
#ifdef TCOL_CUDA
typedef struct __align__(16) TF4_ { float x, y, z, w; } TF4;
#else
typedef struct alignas(16) TF4_ { float x, y, z, w; } TF4;
#endif
TD TF4 ldg4(const TF4 *p) {
#ifdef __CUDA_ARCH__
  float4 v = __ldg((const float4 *)p); TF4 r; r.x = v.x; r.y = v.y; r.z = v.z; r.w = v.w; return r;
#else
  return *p;
#endif
}
TD unsigned f2u(float f) { unsigned u; memcpy(&u, &f, 4); return u; }
typedef struct TBS_ { int c, st, n, pad; } TBS;   // finer-index segment: one cell's triangles in a bin (cell x | y << 8 | z << 16, relative)
TD TBS ldgs(const TBS *p) {
#ifdef __CUDA_ARCH__
  int4 v = __ldg((const int4 *)p); TBS r; r.c = v.x; r.st = v.y; r.n = v.z; r.pad = 0; return r;
#else
  return *p;
#endif
}
TD int ldgi(const int *p) {
#ifdef __CUDA_ARCH__
  return __ldg(p);
#else
  return *p;
#endif
}

typedef struct {
  int nv, nt, ncell; const short *V; const unsigned short *T; const unsigned *TF; const unsigned short *C; const short *BB; const float *TV; const struct TF4_ *TB, *TV4;
  int bix0[2], biz0[2], bnx[2], bnz[2]; float bgx0, bgx1, bgz0, bgz1; long bnseg[2], bnent[2]; const int *boff[2]; const struct TBS_ *bseg[2]; const int *bk[2];   // finer index (see FOR_QUERY_TRIS)   // BB: per triangle min x, max x, min y, max y, min z, max z (precomputed, for the cell scans)
  short h[11]; float gn;            // h = collision header (min xyz, max xyz, ystride, zstride, ncell, cell size, ntri); gn = vertex header [10]
} TModel;
typedef struct { const TModel *m[2]; } TWorld;   // m[0] opaque, m[1] transparent (either may be 0)
typedef struct { int m, i; } TTri;               // hit triangle: model 0/1, index; m < 0 = none
// timing build (-DTPROF, card only): cycles per thread spent in each part, summed per block in shared memory
#if defined(TPROF) && !defined(TCPU)
__shared__ unsigned long long tprof_s[64][8];
#endif
#if defined(TPROF) && defined(__CUDA_ARCH__)
#define TP_BEGIN(v) long long v = clock64()
#define TP_END(v, i) (tprof_s[threadIdx.x][i] += (unsigned long long)(clock64() - (v)))
#else
#define TP_BEGIN(v)
#define TP_END(v, i)
#endif
TD TTri tnone(void) { TTri t; t.m = -1; t.i = -1; return t; }
#define TNONE tnone()
TD int tri_ok(TTri t) { return t.m >= 0; }
TD int tri_eq(TTri a, TTri b) { return a.m == b.m && a.i == b.i; }

// ---- ml_* (core2 1EC8070.c)
TD void vcp(float *d, const float *s) { d[0] = s[0]; d[1] = s[1]; d[2] = s[2]; }
TD void vsub(float *d, const float *a, const float *b) { d[0] = a[0] - b[0]; d[1] = a[1] - b[1]; d[2] = a[2] - b[2]; }
TD void vsum(float *d, const float *a, const float *b) { d[0] = a[0] + b[0]; d[1] = a[1] + b[1]; d[2] = a[2] + b[2]; }
TD void vadd(float *d, const float *a) { d[0] += a[0]; d[1] += a[1]; d[2] += a[2]; }
TD void vsubin(float *d, const float *a) { d[0] -= a[0]; d[1] -= a[1]; d[2] -= a[2]; }
TD void vscl(float *d, const float *a, float s) { d[0] = a[0] * s; d[1] = a[1] * s; d[2] = a[2] * s; }
#ifndef TX360
TD float vdot(const float *a, const float *b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
TD float vlsq(const float *a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; }
TD float vlsq_r(const float *a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; }   // the resolver's inline |d|^2
TD float vdsq(const float *a, const float *b) { float d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2]; return d0 * d0 + d1 * d1 + d2 * d2; }
TD void vcross(float *d, const float *a, const float *b) { float x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0]; d[0] = x; d[1] = y; d[2] = z; }
TD float vlen2(const float *v) { return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; }
#define MADD(a, b, c) ((a) * (b) + (c))       // a*b + c  (N64: two roundings)
#define NMSUB(a, b, c) ((c) - (a) * (b))      // c - a*b
#define MSUB2(a, b, c, d) ((a) * (b) - (c) * (d))   // a*b - c*d
#define BDEN(a1, a2, b1, b2) ((a1) * (b2) - (a2) * (b1))   // barycentric denominator, u and w numerators (N64 order)
#define BU(a0, a2, b0, b2) ((a0) * (b2) - (a2) * (b0))
#define BW(a0, a1, b0, b1) ((a1) * (b0) - (a0) * (b1))
#else
TD float vdot(const float *a, const float *b) { float f = a[1] * b[1]; f = fmaf(a[2], b[2], f); return fmaf(a[0], b[0], f); }   // 0x8228CB40
TD float vlsq(const float *a) { float f = a[1] * a[1]; f = fmaf(a[0], a[0], f); return fmaf(a[2], a[2], f); }               // 0x8228CE80
TD float vlsq_r(const float *a) { float f = a[1] * a[1]; f = fmaf(a[2], a[2], f); return fmaf(a[0], a[0], f); }             // resolver inline
TD float vdsq(const float *a, const float *b) { float d1 = a[1] - b[1], d2 = a[2] - b[2], d0 = a[0] - b[0]; float f = d1 * d1; f = fmaf(d2, d2, f); return fmaf(d0, d0, f); }   // 0x8228CBA0
TD void vcross(float *d, const float *a, const float *b) {   // 0x8228CA48
  float x = fmaf(b[2], a[1], -(a[2] * b[1])), y = fmaf(a[2], b[0], -(b[2] * a[0])), z = fmaf(a[0], b[1], -(b[0] * a[1])); d[0] = x; d[1] = y; d[2] = z; }
TD float vlen2(const float *v) { float f = v[1] * v[1]; f = fmaf(v[0], v[0], f); return fmaf(v[2], v[2], f); }             // normalize / set length
#define MADD(a, b, c) fmaf((a), (b), (c))     // fmadds
#define NMSUB(a, b, c) fmaf(-(a), (b), (c))   // fnmsubs: c - a*b, one rounding
#define MSUB2(a, b, c, d) fmaf((a), (b), -((c) * (d)))   // fmsubs with the second product rounded
#define BDEN(a1, a2, b1, b2) MSUB2((b2), (a1), (a2), (b1))   // 360: b2*a1 - round(a2*b1)
#define BU(a0, a2, b0, b2) MSUB2((a0), (b2), (b0), (a2))     //      a0*b2 - round(b0*a2)
#define BW(a0, a1, b0, b1) MSUB2((b0), (a1), (a0), (b1))     //      b0*a1 - round(a0*b1)
#endif
TD void vnorm(float *v) { float l = vlen2(v); if (l != 0.0f) { float k = 1.0f / sqrtf(l); v[0] *= k; v[1] *= k; v[2] *= k; } }
TD void vgetnorm(float *d, const float *s) { float l = vlen2(s); if (l != 0.0f) { float k = 1.0f / sqrtf(l); d[0] = s[0] * k; d[1] = s[1] * k; d[2] = s[2] * k; } else vcp(d, s); }
TD void vsetlen(float *v, float len) { float l = vlen2(v); if (l != 0.0f) { float k = len / sqrtf(l); v[0] *= k; v[1] *= k; v[2] *= k; } }
TD int vnz(const float *a) { return a[0] != 0.0f || a[1] != 0.0f || a[2] != 0.0f; }
TD float fabsf_(float x) { return x < 0.0f ? -x : x; }
// TV: each triangle's corners as floats, precomputed (the exact short -> float conversions), one read instead of index + vertex reads
TD void tv4(const TModel *M, int k, float v[3][3]) { TF4 a = ldg4(M->TV4 + 3 * k), b = ldg4(M->TV4 + 3 * k + 1), c = ldg4(M->TV4 + 3 * k + 2);
  v[0][0] = a.x; v[0][1] = a.y; v[0][2] = a.z; v[1][0] = a.w; v[1][1] = b.x; v[1][2] = b.y; v[2][0] = b.z; v[2][1] = b.w; v[2][2] = c.x; }
TD void triverts(const TWorld *w, TTri t, float v[3][3]) { tv4(w->m[t.m], t.i, v); }
TD unsigned triflags(const TWorld *w, TTri t) { return w->m[t.m]->TF[t.i]; }

// ---- cells (func_800AA7FC ints, func_800AA4D4 floats): fills [lo, hi] per axis; returns 0 when the model has no grid
TD int cdiv(int a, int b) {   // C division truncates toward zero, like MIPS div
#ifdef TSIM_WASM
  if (!b) return 0;   // a model without a cell grid (h[9] = 0): the range is never used (FOR_CELL_TRIS walks every triangle); WebAssembly would trap
#endif
  return a / b; }
TD void cell_range(const TModel *M, const int *mn, const int *mx, int *a, int *b) {
  for (int i = 0; i < 3; i++) { int s = M->h[9];
    int lo = mn[i] >= 0 ? cdiv(mn[i], s) : cdiv(mn[i], s) - 1, hi = mx[i] >= 0 ? cdiv(mx[i], s) : cdiv(mx[i], s) - 1;
    if (lo < M->h[i]) lo = M->h[i]; if (M->h[3 + i] < lo) lo = M->h[3 + i]; if (hi < M->h[i]) hi = M->h[i]; if (M->h[3 + i] < hi) hi = M->h[3 + i];
    a[i] = lo - M->h[i]; b[i] = hi - M->h[i]; } }
TD void cell_range_f(const TModel *M, const float *mn, const float *mx, int *a, int *b) {
  int mi[3], ma[3]; for (int i = 0; i < 3; i++) { mi[i] = (int)mn[i]; ma[i] = (int)mx[i]; }
  for (int i = 0; i < 3; i++) { int s = M->h[9];
    int lo = 0.0f <= mn[i] ? cdiv(mi[i], s) : cdiv(mi[i], s) - 1, hi = 0.0f <= mx[i] ? cdiv(ma[i], s) : cdiv(ma[i], s) - 1;
    if (lo < M->h[i]) lo = M->h[i]; if (M->h[3 + i] < lo) lo = M->h[3 + i]; if (hi < M->h[i]) hi = M->h[i]; if (M->h[3 + i] < hi) hi = M->h[3 + i];
    a[i] = lo - M->h[i]; b[i] = hi - M->h[i]; } }
// iterate the triangles of the cells in [a, b] (z outer, y, x inner): calls body(index) — a macro so it works on the GPU too
#define FOR_CELL_TRIS(M, a, b, IDX, ...) do { \
  if ((M)->h[9] == 0) { for (int IDX = 0; IDX < (M)->nt; IDX++) { __VA_ARGS__ } } else \
  for (int cz_ = (a)[2]; cz_ <= (b)[2]; cz_++) for (int cy_ = (a)[1]; cy_ <= (b)[1]; cy_++) for (int cx_ = (a)[0]; cx_ <= (b)[0]; cx_++) { \
    int ci_ = cz_ * (unsigned short)(M)->h[7] + cy_ * (unsigned short)(M)->h[6] + cx_; int st_ = (M)->C[2 * ci_], cn_ = (M)->C[2 * ci_ + 1]; \
    for (int IDX = st_; IDX < st_ + cn_; IDX++) { __VA_ARGS__ } } } while (0)

// ---- finer index (exact; the same triangles in the same order as FOR_CELL_TRIS). Per model, two XZ grids of overlapping bins:
// level 0 = 64-unit bins every 32 units (line tests), level 1 = 192-unit bins every 64 units (sphere tests). A bin lists, in the
// game's order (cell by cell, then each cell's own order), every triangle of every cell whose box reaches the bin. A query whose XZ
// box lies inside one bin walks that list, skipping entries of cells outside its cell range: every triangle it does not see has its
// box outside the bin, so the query's box test would have rejected it anyway. Other queries use the cells as before.
#define BIN_S(lv) ((lv) ? 64.0f : 32.0f)
#define BIN_B(lv) ((lv) ? 192.0f : 64.0f)
TD int bin_find(const TModel *M, int lv, float x0, float x1, float z0, float z1) {
  if (!M->boff[lv]) return -1; float S = BIN_S(lv), B = BIN_B(lv);
  if (!(x0 >= M->bgx0 + 1.0f && x1 <= M->bgx1 - 1.0f && z0 >= M->bgz0 + 1.0f && z1 <= M->bgz1 - 1.0f)) return -1;   // inside the cell grid: no clamped cell ranges
  float fx = floorf(x0 / S), fz = floorf(z0 / S); if (!(fx > -1.0e6f && fx < 1.0e6f && fz > -1.0e6f && fz < 1.0e6f)) return -1;
  if (x1 > fx * S + B || z1 > fz * S + B) return -1;   // does not fit in the bin starting at (fx, fz)
  int ix = (int)fx - M->bix0[lv], iz = (int)fz - M->biz0[lv]; if (ix < 0 || iz < 0 || ix >= M->bnx[lv] || iz >= M->bnz[lv]) return -1;
  return ix * M->bnz[lv] + iz; }
#define FOR_QUERY_TRIS(M, a, b, QX0, QX1, QZ0, QZ1, LV, IDX, ...) do { \
  int bi_ = bin_find(M, LV, (float)(QX0), (float)(QX1), (float)(QZ0), (float)(QZ1)); \
  if (bi_ >= 0) { const int *bo_ = (M)->boff[LV], *bk_ = (M)->bk[LV]; const TBS *bs_ = (M)->bseg[LV]; int se_ = ldgi(bo_ + bi_ + 1); \
    for (int s_ = ldgi(bo_ + bi_); s_ < se_; s_++) { TBS g_ = ldgs(bs_ + s_); int ex_ = g_.c & 255, ey_ = (g_.c >> 8) & 255, ez_ = g_.c >> 16; \
      if (ex_ < (a)[0] || ex_ > (b)[0] || ey_ < (a)[1] || ey_ > (b)[1] || ez_ < (a)[2] || ez_ > (b)[2]) continue; \
      for (int q_ = g_.st; q_ < g_.st + g_.n; q_++) { int IDX = ldgi(bk_ + q_); { __VA_ARGS__ } } } } \
  else FOR_CELL_TRIS(M, a, b, IDX, __VA_ARGS__); } while (0)

// ---- line test, one model (func_800AB0BC). s, e: segment (e is moved to the hit); nout: normal of the hit (normalized at the end)
TD int line_model(const TWorld *w, int mi, const float *s, float *e, float *nout, unsigned filt, TTri *hit) {
  const TModel *M = w->m[mi]; int mn[3], mx[3]; float d[3]; int found = 0;
  for (int i = 0; i < 3; i++) { if (s[i] < e[i]) { mn[i] = (int)s[i]; mx[i] = (int)e[i]; } else { mn[i] = (int)e[i]; mx[i] = (int)s[i]; } mn[i] -= 1; mx[i] += 1; }
  vsub(d, e, s);
  for (int i = 0; i < 3; i++) { if ((float)mx[i] <= -M->gn) return 0; if (M->gn <= (float)mn[i]) return 0; }
  int ca[3], cb[3]; cell_range(M, mn, mx, ca, cb);
  FOR_QUERY_TRIS(M, ca, cb, mn[0], mx[0], mn[2], mx[2], 0, k, {
    TF4 tb0 = ldg4(M->TB + 2 * k), tb1 = ldg4(M->TB + 2 * k + 1); unsigned fl = f2u(tb1.z); if (fl & filt) continue;
    if (tb0.y < (float)mn[0] || (float)mx[0] < tb0.x || tb0.w < (float)mn[1] || (float)mx[1] < tb0.z || tb1.y < (float)mn[2] || (float)mx[2] < tb1.x) continue;   // = the short box vs the int box
    float vv[3][3]; tv4(M, k, vv); float v0[3] = { vv[0][0], vv[0][1], vv[0][2] }, v1[3] = { vv[1][0], vv[1][1], vv[1][2] }, v2[3] = { vv[2][0], vv[2][1], vv[2][2] };
    float ab[3], ac[3], N[3]; vsub(ab, v1, v0); vsub(ac, v2, v0); vcross(N, ab, ac);
    if (100000.0f < fabsf_(N[0]) || 100000.0f < fabsf_(N[1]) || 100000.0f < fabsf_(N[2])) { N[0] = N[0] * 9.999999747e-06f; N[1] = N[1] * 9.999999747e-06f; N[2] = N[2] * 9.999999747e-06f; }
    float ls[3], le[3]; vsub(ls, s, v0); vsub(le, e, v0); float a = vdot(ls, N), b = vdot(le, N);
    if (0.0f <= a && 0.0f <= b) continue; if (a <= 0.0f && b <= 0.0f) continue;
    if ((fl & 0x10000) && a < 0.0f) { N[0] = -N[0]; N[1] = -N[1]; N[2] = -N[2]; }
    float np = -vdot(v0, N); float nd = vdot(N, d); if (0.0f <= nd) continue;
    float t = -(vdot(N, s) + np) / nd; if (t <= 0.0f) continue; if (1.0f <= t) continue;
    float cur[3] = { MADD(d[0], t, s[0]), MADD(d[1], t, s[1]), MADD(d[2], t, s[2]) };
    int pa = fabsf_(N[1]) < fabsf_(N[0]) ? 0 : 1; if (fabsf_(N[pa]) < fabsf_(N[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
    float f0 = cur[i1] - v0[i1], f1 = ab[i1], f2 = ac[i1], e0 = cur[i2] - v0[i2], e1 = ab[i2], e2 = ac[i2];
    float inv = 1.0f / BDEN(f1, f2, e1, e2);
    float u = BU(f0, f2, e0, e2) * inv; if (u < 0.0f || 1.0f < u) continue;
    float ww = BW(f0, f1, e0, e1) * inv; if (ww < 0.0f || 1.0f < ww) continue; if (1.0f < u + ww) continue;
    found = 1; hit->m = mi; hit->i = k; vcp(e, cur); vcp(nout, N);
    for (int i = 0; i < 3; i++) { if (s[i] < e[i]) { mn[i] = (int)s[i]; mx[i] = (int)e[i]; } else { mn[i] = (int)e[i]; mx[i] = (int)s[i]; } mn[i] -= 1; mx[i] += 1; }
    vsub(d, e, s);
  });
  if (found) vnorm(nout);
  return found;
}
// map line (func_800BEF00): opaque (unless the filter excludes all of 0x1F00), then transparent with the shortened end
TD TTri wline(const TWorld *w, const float *s, float *e, float *n, unsigned filt) {
  TTri o = TNONE, x = TNONE;
  if (w->m[1]) { if ((filt & 0x1F00) != 0x1F00 && w->m[0]) line_model(w, 0, s, e, n, filt, &o); if (line_model(w, 1, s, e, n, filt, &x)) return x; return o; }
  if (w->m[0]) line_model(w, 0, s, e, n, filt, &o); return o;
}

// ---- sphere tests: active list entry (func_800ABCE0)
typedef struct { float ab[3], ac[3], n[3], v[3][3]; TTri t; } TAct;
#ifndef TMAXACT
#define TMAXACT 160
#endif
// fast check: triangles of the cells around p1..p2 (+margin) that may touch the moving sphere
TD int fast_check(const TWorld *w, int mi, const float *p1, const float *p2, const float *vel, float margin, unsigned filt, TAct *act, int nact) {
  const TModel *M = w->m[mi]; float mn[3], mx[3];
  for (int i = 0; i < 3; i++) { if (p1[i] < p2[i]) { mn[i] = p1[i]; mx[i] = p2[i]; } else { mn[i] = p2[i]; mx[i] = p1[i]; } mn[i] = mn[i] - margin; mx[i] = mx[i] + margin; }
  for (int i = 0; i < 3; i++) { if (mx[i] <= -M->gn) return 0; if (M->gn <= mn[i]) return 0; }
  int ca[3], cb[3]; cell_range_f(M, mn, mx, ca, cb); int n = 0;
  FOR_QUERY_TRIS(M, ca, cb, mn[0], mx[0], mn[2], mx[2], 1, k, {
    TF4 tb0 = ldg4(M->TB + 2 * k), tb1 = ldg4(M->TB + 2 * k + 1); unsigned fl = f2u(tb1.z); if (fl & filt) continue; if (n >= nact) continue;
    if (mx[0] < tb0.x || tb0.y < mn[0] || mx[1] < tb0.z || tb0.w < mn[1] || mx[2] < tb1.x || tb1.y < mn[2]) continue;
    TAct *A = act + n; tv4(M, k, A->v);
    vsub(A->ab, A->v[1], A->v[0]); vsub(A->ac, A->v[2], A->v[0]); vcross(A->n, A->ab, A->ac); vnorm(A->n);
    if (fl & 0x10000) { float q[3]; vsub(q, p1, A->v[0]); if (vdot(q, A->n) < 0.0f) { A->n[0] = -A->n[0]; A->n[1] = -A->n[1]; A->n[2] = -A->n[2]; } }
    if (0.0f < vdot(A->n, vel)) continue;
    A->t.m = mi; A->t.i = k; n++;
  });
  return n;
}
// iteration (func_800AC100): does the sphere at pos touch any active triangle; nsum = sum of their normals; returns the last one
TD int iterate(const TAct *act, int n, const float *pos, float r, float *nsum) {
  int coll = -1; nsum[0] = nsum[1] = nsum[2] = 0.0f; float rd = r - 0.5f, r2 = r * r;
  for (int q = 0; q < n; q++) { const TAct *A = act + q; float s0[3]; vsub(s0, pos, A->v[0]); float th = vdot(s0, A->n);
    if (rd <= fabsf_(th)) continue;
    float pp[3] = { NMSUB(A->n[0], th, pos[0]), NMSUB(A->n[1], th, pos[1]), NMSUB(A->n[2], th, pos[2]) };
    int pa = fabsf_(A->n[1]) < fabsf_(A->n[0]) ? 0 : 1; if (fabsf_(A->n[pa]) < fabsf_(A->n[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
    float a0 = pp[i1] - A->v[0][i1], a1 = A->ab[i1], a2 = A->ac[i1], b0 = pp[i2] - A->v[0][i2], b1 = A->ab[i2], b2 = A->ac[i2];
    float den = BDEN(a1, a2, b1, b2);
    if (den == 0.0f) continue;
    float inv = 1.0f / den; float u = BU(a0, a2, b0, b2) * inv;
    if (0.0f <= u && u <= 1.0f) { float ww = BW(a0, a1, b0, b1) * inv; if (0.0f <= ww && ww <= 1.0f && u + ww <= 1.0f) { coll = q; vadd(nsum, A->n); continue; } }
    float s[3][3]; int hit = 0;
    for (int k = 0; k < 3; k++) { vsub(s[k], pos, A->v[k]); if (vlsq(s[k]) < r2) { coll = q; vadd(nsum, A->n); hit = 1; break; } }
    if (hit) continue;
    for (int k = 0; k < 3; k++) { float e[3]; vsub(e, A->v[(k + 1) % 3], A->v[k]); float el = vlsq(e); vnorm(e); float d0 = vdot(e, s[k]);
      if (0.0f <= d0 && d0 * d0 <= el) { float qv[3] = { NMSUB(e[0], d0, s[k][0]), NMSUB(e[1], d0, s[k][1]), NMSUB(e[2], d0, s[k][2]) }; if (vlsq(qv) < r2) { coll = q; vadd(nsum, A->n); break; } } }
  }
  return coll;
}
// moving sphere, one model (func_800AC638): p2 is moved back to the last free bisection point; nout = normalized normal sum
TD int msphere_model(const TWorld *w, int mi, const float *p1, float *p2, float r, float *nout, int steps, unsigned filt, TTri *hit, TAct *act) {
  float vel[3]; vsub(vel, p2, p1); int n = fast_check(w, mi, p1, p2, vel, r + 0.5f, filt, act, TMAXACT); if (!n) return 0;
  float ns[3]; int c = iterate(act, n, p2, r, ns); if (c < 0) return 0;
  vcp(nout, ns); float dist[3]; vsub(dist, p2, p1); vcp(p2, p1); float st = 0.0f, en = 1.0f;
  for (int k = 0; k < steps; k++) { float cu = (st + en) * 0.5f; float cp[3] = { MADD(dist[0], cu, p1[0]), MADD(dist[1], cu, p1[1]), MADD(dist[2], cu, p1[2]) };
    int c2 = iterate(act, n, cp, r, ns); if (c2 >= 0) { en = cu; c = c2; vcp(nout, ns); } else { st = cu; vcp(p2, cp); } }
  vnorm(nout); *hit = act[c].t; return 1;
}
TD TTri wmsphere(const TWorld *w, const float *p1, float *p2, float r, float *n, int steps, unsigned filt, TAct *act) {
  TTri o = TNONE, x = TNONE; if (w->m[0]) msphere_model(w, 0, p1, p2, r, n, steps, filt, &o, act);
  if (!w->m[1]) return o; if (msphere_model(w, 1, p1, p2, r, n, steps, filt, &x, act)) return x; return o; }
// static sphere, one model (func_800AC978)
TD int sphere_model(const TWorld *w, int mi, const float *pos, float r, float *nout, unsigned filt, TTri *hit) {
  const TModel *M = w->m[mi]; float rp = r + 0.5f; float mn[3] = { pos[0] - rp, pos[1] - rp, pos[2] - rp }, mx[3] = { pos[0] + rp, pos[1] + rp, pos[2] + rp };
  for (int i = 0; i < 3; i++) { if (mx[i] <= -M->gn) return 0; if (M->gn <= mn[i]) return 0; }
  int ca[3], cb[3]; cell_range_f(M, mn, mx, ca, cb); float acc[3] = { 0, 0, 0 }; int found = 0; float rd = r - 0.5f, r2 = r * r;
  FOR_QUERY_TRIS(M, ca, cb, mn[0], mx[0], mn[2], mx[2], 1, k, {
    TF4 tb0 = ldg4(M->TB + 2 * k), tb1 = ldg4(M->TB + 2 * k + 1); unsigned fl = f2u(tb1.z); if (fl & filt) continue;
    if (mx[0] < tb0.x || tb0.y < mn[0] || mx[1] < tb0.z || tb0.w < mn[1] || mx[2] < tb1.x || tb1.y < mn[2]) continue;
    float v[3][3]; tv4(M, k, v);
    float ab[3], ac[3], N[3]; vsub(ab, v[1], v[0]); vsub(ac, v[2], v[0]); vcross(N, ab, ac); vnorm(N);
    if (N[0] == 0.0f && N[1] == 0.0f && N[2] == 0.0f) continue;
    float s0[3]; vsub(s0, pos, v[0]);
    if ((fl & 0x10000) && vdot(s0, N) < 0.0f) { N[0] = -N[0]; N[1] = -N[1]; N[2] = -N[2]; }
    float th = vdot(s0, N); if (rd <= fabsf_(th)) continue;
    float pp[3] = { NMSUB(N[0], th, pos[0]), NMSUB(N[1], th, pos[1]), NMSUB(N[2], th, pos[2]) };
    int pa = fabsf_(N[1]) < fabsf_(N[0]) ? 0 : 1; if (fabsf_(N[pa]) < fabsf_(N[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
    float a0 = pp[i1] - v[0][i1], a1 = ab[i1], a2 = ac[i1], b0 = pp[i2] - v[0][i2], b1 = ab[i2], b2 = ac[i2];
    float inv = 1.0f / BDEN(a1, a2, b1, b2); float u = BU(a0, a2, b0, b2) * inv;
    if (0.0f <= u && u <= 1.0f) { float ww = BW(a0, a1, b0, b1) * inv; if (0.0f <= ww && ww <= 1.0f && u + ww <= 1.0f) { found = 1; hit->m = mi; hit->i = k; vadd(acc, N); continue; } }
    float s[3][3]; int h2 = 0;
    for (int j = 0; j < 3; j++) { vsub(s[j], pos, v[j]); if (vlsq(s[j]) < r2) { found = 1; hit->m = mi; hit->i = k; vadd(acc, N); h2 = 1; break; } }
    if (h2) continue;
    for (int j = 0; j < 3; j++) { float e[3]; vsub(e, v[(j + 1) % 3], v[j]); float el = vlsq(e); vnorm(e); float d0 = vdot(e, s[j]);
      if (0.0f <= d0 && d0 * d0 <= el) { float qv[3] = { NMSUB(e[0], d0, s[j][0]), NMSUB(e[1], d0, s[j][1]), NMSUB(e[2], d0, s[j][2]) }; if (vlsq(qv) < r2) { found = 1; hit->m = mi; hit->i = k; vadd(acc, N); break; } } }
  });
  if (found) vgetnorm(nout, acc);
  return found;
}
TD TTri wsphere(const TWorld *w, const float *pos, float r, float *n, unsigned filt) {
  TTri o = TNONE, x = TNONE; if (w->m[0]) sphere_model(w, 0, pos, r, n, filt, &o);
  if (!w->m[1]) return o; if (sphere_model(w, 1, pos, r, n, filt, &x)) return x; return o; }

// ---- floor tracker (mode 2 only; water switches the mode -> flagged)
typedef struct { float pos[3], prev[3], floor_y, water_y, posZ, n[3]; unsigned ffl; int mode, water_seen, grounded_tr; TTri ftri; } TTrack;
#define TFILT_FLOOR 0x00400005u
#define TFILT_WATERRAY 0x00001F00u
#define TWATER 0x00020020u
TD TTri tray(const TWorld *w, const float *p, float a1, float a2, unsigned filt, float *hy, float *hn) {
  float s[3], e[3]; vcp(s, p); s[1] = s[1] + a1; vcp(e, p); e[1] = e[1] + a2; float n[3] = { 0, 0, 0 };
  TTri t = wline(w, s, e, n, filt); *hy = e[1]; vcp(hn, n); return t; }
TD TTri tray500(const TWorld *w, const float *p, float a1, float a2, unsigned filt, float *hy, float *hn) {
  float d = a2 - a1; if (500.0f < fabsf_(d)) {
    TTri t; if (a1 < a2) { t = tray(w, p, a1, a1 + 500.0f, filt, hy, hn); if (!tri_ok(t)) t = tray(w, p, a1 + 500.0f - 1.0f, a2, filt, hy, hn); }
    else { t = tray(w, p, a1, a1 - 500.0f, filt, hy, hn); if (!tri_ok(t)) t = tray(w, p, a1 - 500.0f + 1.0f, a2, filt, hy, hn); }
    return t; }
  return tray(w, p, a1, a2, filt, hy, hn); }
TD void tr_floor(TTrack *tr, const TWorld *w, TTri t, float y, const float *n) { tr->floor_y = y; vcp(tr->n, n); tr->ftri = t; tr->ffl = triflags(w, t); }
TD void tr_nofloor(TTrack *tr) { tr->floor_y = -18000.0f; tr->n[0] = 0; tr->n[1] = 1; tr->n[2] = 0; tr->ftri = TNONE; tr->ffl = 0; }
TD void tr_update(TTrack *tr, const TWorld *w, const float *pos, unsigned filt) {
  vcp(tr->pos, pos); float hy, hn[3];
  TTri t = tray500(w, tr->pos, tr->posZ, -1300.0f, filt, &hy, hn);
  if (!tri_ok(t)) { tr_nofloor(tr); vcp(tr->prev, tr->pos); return; }
  if (triflags(w, t) & TWATER) { tr->water_seen = 1; t = tray500(w, tr->pos, tr->posZ, -450.0f, filt | TWATER, &hy, hn); if (!tri_ok(t)) tr_nofloor(tr); else if (0.0f <= hn[1]) tr_floor(tr, w, t, hy, hn); }
  else if (hn[1] < 0.0f && !(triflags(w, t) & 0x10000)) { float d = hy - tr->pos[1]; t = tray500(w, tr->pos, d - 1.0f, d - 1300.0f, filt | TWATER, &hy, hn); if (tri_ok(t)) tr_floor(tr, w, t, hy, hn); else tr_nofloor(tr); }
  else tr_floor(tr, w, t, hy, hn);
  vcp(tr->prev, tr->pos);
}

// ---- resolver (func_800D4584). old, tgt: feet; disp: this update's displacement (only its y sign is used); result in out.
typedef struct { int hits, held, grounded, held_flag; float out[3]; TTri last; } TRes;
typedef struct { float u0[3], uC[3], n[3], c_new[3], c_old[3]; TTri hit, line; int gnd; } TPass;
TD void floor_snap(TTrack *tr, const TWorld *w, float *p, const float *disp, int *gnd, unsigned mfilt) {
  tr_update(tr, w, p, mfilt); float fy = tr->floor_y; float n1 = tr->n[1]; int prev = *gnd; *gnd = 0;
  if (!(n1 < 0.432f)) { float y = p[1];
    if (y <= fy) { p[1] = fy; *gnd = 1; return; }
    if (prev != 0 && disp[1] < 0.0f) { if (n1 < 0.9f) { if (y < fy + 30.0f) { p[1] = fy; *gnd = 1; } } else if (y < fy + 5.0f) { p[1] = fy; *gnd = 1; } } } }
TD void nearest_seg(float *d, const float *a, const float *b, const float *p) {   // func_800F0274
  float df[3]; vsub(df, b, a); float l = vlsq(df); if (l < 0.009999999776f) { vcp(d, a); return; }
  l = sqrtf(l); float k = 1.0f / l; df[0] = df[0] * k; df[1] = df[1] * k; df[2] = df[2] * k;
  float d2[3]; vsub(d2, p, a); float dp = vdot(d2, df); if (dp <= 0.0f) { vcp(d, a); return; } if (l <= dp) { vcp(d, b); return; }
  vscl(d, df, dp); vadd(d, a); }
TD void nearest_edges(float *out, float v[3][3], const float *p) {          // func_800F0410
  float s0[3], s1[3], s2[3]; nearest_seg(s0, v[0], v[1], p); nearest_seg(s1, v[1], v[2], p); nearest_seg(s2, v[2], v[0], p);
  float a = vdsq(s0, p), b = vdsq(s1, p), c = vdsq(s2, p);
  if (a < b) { if (c < a) vcp(out, s2); else vcp(out, s0); } else if (c < b) vcp(out, s2); else vcp(out, s1); }
TD void project_plane(float *out, float v[3][3], const float *p) {          // func_800F0524 / func_800F03AC
  float e1[3], e2[3], n[3]; vsub(e1, v[1], v[0]); vsub(e2, v[2], v[0]); vcross(n, e1, e2); vnorm(n);
  float t[3]; vsub(t, p, v[0]); float k = vdot(n, t); vscl(t, n, k); vsub(out, p, t); }
TD int msphere_h(const TWorld *w, const float *A, float *Bf, float h, float r, float *n, int steps, unsigned filt, TAct *act, TTri *hit) {   // func_800FB434
  float a[3] = { A[0], A[1] + h, A[2] }, b[3] = { Bf[0], Bf[1] + h, Bf[2] }; TTri t = wmsphere(w, a, b, r, n, steps, filt, act);
  if (tri_ok(t)) { Bf[0] = b[0]; Bf[1] = b[1] - h; Bf[2] = b[2]; } *hit = t; return tri_ok(t); }
TD void resolve(const TWorld *w, TTrack *tr, const float *old_in, const float *tgt_in, const float *disp, int grounded_in,
                float h, float r, unsigned mfilt, TRes *R, TAct *act) {
  TP_BEGIN(tp_res); unsigned filt = mfilt | TWATER; float old[3], tgt[3]; vcp(old, old_in); vcp(tgt, tgt_in); int gnd = grounded_in;
  R->hits = 0; R->held = 0; R->held_flag = 0; R->last = TNONE;
  // func_800FAE44: fallback = old pushed out of whatever the sphere at old touches (by 2.0 along the normal), old moved too
  float fb[3]; vcp(fb, old);
  { float c[3] = { old[0], old[1] + h, old[2] }, n[3] = { 0, 0, 0 }; TP_BEGIN(tp_s); TTri t = wsphere(w, c, r, n, filt); TP_END(tp_s, 2);
    if (tri_ok(t)) { fb[0] = n[0] * 2.0f + old[0]; fb[1] = n[1] * 2.0f + old[1]; fb[2] = n[2] * 2.0f + old[2]; vcp(old, fb);
      float a[3], b[3], n2[3] = { 0, 0, 0 }; vcp(a, old); vcp(b, old); a[1] = a[1] + 100.0f; b[1] = b[1] - 500.0f;
      TP_BEGIN(tp_l); TTri t2 = wline(w, a, b, n2, filt); TP_END(tp_l, 3);
      if (tri_ok(t2) && (!(n2[1] < 0.0f) || (triflags(w, t2) & 0x10000)) && old[1] < b[1]) old[1] = b[1]; } }
  TPass P[5]; int i = 0;
  for (i = 0; i < 5; i++) {
    TPass *c = P + i, *pv = i ? P + i - 1 : 0;
    if (i) { vcp(c->u0, pv->u0); vcp(c->uC, pv->uC); } else { vcp(c->u0, tgt); vcp(c->uC, old); }
    float keep[3]; vcp(keep, c->u0); float d[3]; vsub(d, c->u0, c->uC);
    c->line = TNONE;
    if (100.0f < vlsq_r(d)) {
      float y0 = c->u0[1]; float n44[3] = { 0, 0, 0 };
      // func_800FABF4 / func_800FAB50: line from old+h to new+h extended by r-1
      #define TLINE() do { float s34[3] = { c->uC[0], c->uC[1] + h, c->uC[2] }, s28[3] = { c->u0[0], c->u0[1] + h, c->u0[2] }; \
        float ext[3]; vsub(ext, s28, s34); vsetlen(ext, r - 1.0f); float s20[3]; vcp(s20, s28); vadd(s20, ext); \
        TP_BEGIN(tp_l2); TTri lt = wline(w, s34, s20, n44, filt); TP_END(tp_l2, 3); if (tri_ok(lt)) { vsubin(s20, ext); c->u0[0] = s20[0]; c->u0[1] = s20[1] - h; c->u0[2] = s20[2]; } c->line = lt; } while (0)
      TLINE();
      if (tri_ok(c->line)) { float dn[3]; vcp(dn, d); vnorm(dn); if (0.0f < vdot(dn, n44)) { vcp(c->u0, keep); c->line = TNONE; } }
      if (tri_ok(c->line) && 0.0f <= n44[1] && n44[1] < 0.01999999955f) {
        float lim = tr->posZ - 1.0f; float yl = y0;
        if (lim <= fabsf_(y0 - c->u0[1])) { TLINE(); yl = c->u0[1]; }
        c->u0[1] = yl; }
      #undef TLINE
    }
    { TP_BEGIN(tp_f); floor_snap(tr, w, c->u0, disp, &gnd, mfilt); TP_END(tp_f, 4); } c->gnd = gnd;
    c->c_old[0] = c->uC[0]; c->c_old[1] = c->uC[1] + h; c->c_old[2] = c->uC[2];
    c->c_new[0] = c->u0[0]; c->c_new[1] = c->u0[1] + h; c->c_new[2] = c->u0[2];
    c->n[0] = c->n[1] = c->n[2] = 0.0f;
    { TP_BEGIN(tp_m); c->hit = wmsphere(w, c->c_old, c->c_new, r, c->n, 3, filt, act); TP_END(tp_m, 5); }
    if (!tri_ok(c->hit)) break;
    R->hits++; R->last = c->hit;
    if (i == 2 && tri_eq(c->hit, P[0].hit) && !tri_eq(pv->hit, c->hit)) { float s[3]; vsum(s, c->n, pv->n); vnorm(s); vcp(c->n, s); }
    if (i == 2 && tri_eq(c->hit, P[0].hit) && tri_eq(pv->hit, c->hit)) {
      float v[3][3]; triverts(w, c->hit, v); float pr[3]; project_plane(pr, v, c->u0); float dd[3]; vsub(dd, c->u0, pr); vsetlen(dd, r + 1.0f); vadd(pr, dd);
      if (!(triflags(w, c->hit) & 0x10000)) { TTri hh; msphere_h(w, pr, c->u0, h, r, c->n, 3, filt, act, &hh); c->hit = hh; }
      else vcp(c->u0, pr); }
    if (c->gnd == 0 && tri_ok(c->hit) && disp[1] < 0.0f && fabsf_(c->n[1]) < 0.009999999776f) {
      float v[3][3]; triverts(w, c->hit, v); float pr[3]; project_plane(pr, v, c->u0); float sc[3]; vscl(sc, c->n, r + 1.0f); float a[3]; vsum(a, pr, sc);
      TTri hh; msphere_h(w, a, pr, h, r, c->n, 3, filt, act, &hh); c->hit = hh; c->u0[0] = pr[0]; c->u0[2] = pr[2]; }
    if (0.6000000238f < c->n[1] && h != r && tri_ok(c->hit)) {
      float v[3][3]; triverts(w, c->hit, v); int push = 1;
      float q[3]; vcp(q, c->u0); float up[3] = { 0.0f, 1.0f, 0.0f };
      { float t0 = vdot(up, c->n); if (t0 != 0.0f) { float k = (vdot(c->n, v[0]) - vdot(q, c->n)) / t0; q[0] += up[0] * k; q[1] += up[1] * k; q[2] += up[2] * k;
          if (fabsf_(c->u0[1] - q[1]) < 0.009999999776f) push = 0; } }
      if (push) { float o[3]; vcp(o, c->uC); float ne[3]; nearest_edges(ne, v, c->c_new); float dir[3]; vsub(dir, o, ne); dir[1] = 0.0f; vnorm(dir);
        if (vnz(dir)) { vcp(c->n, dir); vcp(c->uC, old); float L = (float)(i + 1); vsetlen(dir, L * L * 2.0f); vadd(c->u0, dir); vadd(c->c_new, dir); } } }
    if (vnz(c->n)) {   // func_800FAF78
      float a[3], b[3], dd[3]; vsub(a, c->u0, c->uC); vsub(b, c->c_new, c->c_old); vsub(dd, a, b); float ph = -vdot(c->n, dd); if (ph < 5.0f) ph = 5.0f;
      c->u0[0] = MADD(c->n[0], ph, c->u0[0]); c->u0[1] = MADD(c->n[1], ph, c->u0[1]); c->u0[2] = MADD(c->n[2], ph, c->u0[2]); }
  }
  if (i == 5) { R->held = 1; if (gnd == 0 && tri_ok(R->last) && tgt_in[1] < old[1]) R->held_flag = 1; vcp(R->out, fb); }
  else vcp(R->out, P[i].u0);
  R->grounded = gnd; TP_END(tp_res, 1);
}
#endif
