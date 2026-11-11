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
#ifndef TCOL_H
#define TCOL_H
#ifdef TCOL_CUDA
#define TD __host__ __device__ static inline
#else
#define TD static inline
#include <math.h>
#include <string.h>
#endif

typedef struct {
  int nv, nt, ncell; const short *V; const unsigned short *T; const unsigned *TF; const unsigned short *C; const short *BB;   // BB: per triangle min x, max x, min y, max y, min z, max z (precomputed, for the cell scans)
  short h[11]; float gn;            // h = collision header (min xyz, max xyz, ystride, zstride, ncell, cell size, ntri); gn = vertex header [10]
} TModel;
typedef struct { const TModel *m[2]; } TWorld;   // m[0] opaque, m[1] transparent (either may be 0)
typedef struct { int m, i; } TTri;               // hit triangle: model 0/1, index; m < 0 = none
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
TD float vdot(const float *a, const float *b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
TD float vlsq(const float *a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; }
TD float vdsq(const float *a, const float *b) { float d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2]; return d0 * d0 + d1 * d1 + d2 * d2; }
TD void vcross(float *d, const float *a, const float *b) { float x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0]; d[0] = x; d[1] = y; d[2] = z; }
TD void vnorm(float *v) { float l = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; if (l != 0.0f) { float k = 1.0f / sqrtf(l); v[0] *= k; v[1] *= k; v[2] *= k; } }
TD void vgetnorm(float *d, const float *s) { float l = s[0] * s[0] + s[1] * s[1] + s[2] * s[2]; if (l != 0.0f) { float k = 1.0f / sqrtf(l); d[0] = s[0] * k; d[1] = s[1] * k; d[2] = s[2] * k; } else vcp(d, s); }
TD void vsetlen(float *v, float len) { float l = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; if (l != 0.0f) { float k = len / sqrtf(l); v[0] *= k; v[1] *= k; v[2] *= k; } }
TD int vnz(const float *a) { return a[0] != 0.0f || a[1] != 0.0f || a[2] != 0.0f; }
TD float fabsf_(float x) { return x < 0.0f ? -x : x; }
TD void triverts(const TWorld *w, TTri t, float v[3][3]) { const TModel *M = w->m[t.m]; const unsigned short *T = M->T + 3 * t.i;
  for (int k = 0; k < 3; k++) { const short *p = M->V + 3 * T[k]; v[k][0] = (float)p[0]; v[k][1] = (float)p[1]; v[k][2] = (float)p[2]; } }
TD unsigned triflags(const TWorld *w, TTri t) { return w->m[t.m]->TF[t.i]; }

// ---- cells (func_800AA7FC ints, func_800AA4D4 floats): fills [lo, hi] per axis; returns 0 when the model has no grid
TD int cdiv(int a, int b) { return a / b; }   // C division truncates toward zero, like MIPS div
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

// ---- line test, one model (func_800AB0BC). s, e: segment (e is moved to the hit); nout: normal of the hit (normalized at the end)
TD int line_model(const TWorld *w, int mi, const float *s, float *e, float *nout, unsigned filt, TTri *hit) {
  const TModel *M = w->m[mi]; int mn[3], mx[3]; float d[3]; int found = 0;
  for (int i = 0; i < 3; i++) { if (s[i] < e[i]) { mn[i] = (int)s[i]; mx[i] = (int)e[i]; } else { mn[i] = (int)e[i]; mx[i] = (int)s[i]; } mn[i] -= 1; mx[i] += 1; }
  vsub(d, e, s);
  for (int i = 0; i < 3; i++) { if ((float)mx[i] <= -M->gn) return 0; if (M->gn <= (float)mn[i]) return 0; }
  int ca[3], cb[3]; cell_range(M, mn, mx, ca, cb);
  FOR_CELL_TRIS(M, ca, cb, k, {
    unsigned fl = M->TF[k]; if (fl & filt) continue;
    { const short *bb = M->BB + 6 * k; if (bb[1] < mn[0] || mx[0] < bb[0] || bb[3] < mn[1] || mx[1] < bb[2] || bb[5] < mn[2] || mx[2] < bb[4]) continue; }
    const unsigned short *T = M->T + 3 * k; const short *A = M->V + 3 * T[0], *Bv = M->V + 3 * T[1], *Cv = M->V + 3 * T[2];
    float v0[3] = { (float)A[0], (float)A[1], (float)A[2] }, v1[3] = { (float)Bv[0], (float)Bv[1], (float)Bv[2] }, v2[3] = { (float)Cv[0], (float)Cv[1], (float)Cv[2] };
    float ab[3], ac[3], N[3]; vsub(ab, v1, v0); vsub(ac, v2, v0); vcross(N, ab, ac);
    if (100000.0f < fabsf_(N[0]) || 100000.0f < fabsf_(N[1]) || 100000.0f < fabsf_(N[2])) { N[0] = N[0] * 9.999999747e-06f; N[1] = N[1] * 9.999999747e-06f; N[2] = N[2] * 9.999999747e-06f; }
    float ls[3], le[3]; vsub(ls, s, v0); vsub(le, e, v0); float a = vdot(ls, N), b = vdot(le, N);
    if (0.0f <= a && 0.0f <= b) continue; if (a <= 0.0f && b <= 0.0f) continue;
    if ((fl & 0x10000) && a < 0.0f) { N[0] = -N[0]; N[1] = -N[1]; N[2] = -N[2]; }
    float np = -vdot(v0, N); float nd = vdot(N, d); if (0.0f <= nd) continue;
    float t = -(vdot(N, s) + np) / nd; if (t <= 0.0f) continue; if (1.0f <= t) continue;
    float cur[3] = { d[0] * t + s[0], d[1] * t + s[1], d[2] * t + s[2] };
    int pa = fabsf_(N[1]) < fabsf_(N[0]) ? 0 : 1; if (fabsf_(N[pa]) < fabsf_(N[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
    float f0 = cur[i1] - v0[i1], f1 = ab[i1], f2 = ac[i1], e0 = cur[i2] - v0[i2], e1 = ab[i2], e2 = ac[i2];
    float inv = 1.0f / (f1 * e2 - f2 * e1);
    float u = (f0 * e2 - f2 * e0) * inv; if (u < 0.0f || 1.0f < u) continue;
    float ww = (f1 * e0 - f0 * e1) * inv; if (ww < 0.0f || 1.0f < ww) continue; if (1.0f < u + ww) continue;
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
  FOR_CELL_TRIS(M, ca, cb, k, {
    unsigned fl = M->TF[k]; if (fl & filt) continue; if (n >= nact) continue;
    { const short *bb = M->BB + 6 * k; if (mx[0] < (float)bb[0] || (float)bb[1] < mn[0] || mx[1] < (float)bb[2] || (float)bb[3] < mn[1] || mx[2] < (float)bb[4] || (float)bb[5] < mn[2]) continue; }
    TAct *A = act + n; const unsigned short *T = M->T + 3 * k;
    for (int j = 0; j < 3; j++) { const short *p = M->V + 3 * T[j]; A->v[j][0] = (float)p[0]; A->v[j][1] = (float)p[1]; A->v[j][2] = (float)p[2]; }
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
    float pp[3] = { pos[0] - A->n[0] * th, pos[1] - A->n[1] * th, pos[2] - A->n[2] * th };
    int pa = fabsf_(A->n[1]) < fabsf_(A->n[0]) ? 0 : 1; if (fabsf_(A->n[pa]) < fabsf_(A->n[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
    float a0 = pp[i1] - A->v[0][i1], a1 = A->ab[i1], a2 = A->ac[i1], b0 = pp[i2] - A->v[0][i2], b1 = A->ab[i2], b2 = A->ac[i2];
    float den = a1 * b2 - a2 * b1;
    if (den == 0.0f) continue;
    float inv = 1.0f / den; float u = (a0 * b2 - a2 * b0) * inv;
    if (0.0f <= u && u <= 1.0f) { float ww = (a1 * b0 - a0 * b1) * inv; if (0.0f <= ww && ww <= 1.0f && u + ww <= 1.0f) { coll = q; vadd(nsum, A->n); continue; } }
    float s[3][3]; int hit = 0;
    for (int k = 0; k < 3; k++) { vsub(s[k], pos, A->v[k]); if (vlsq(s[k]) < r2) { coll = q; vadd(nsum, A->n); hit = 1; break; } }
    if (hit) continue;
    for (int k = 0; k < 3; k++) { float e[3]; vsub(e, A->v[(k + 1) % 3], A->v[k]); float el = vlsq(e); vnorm(e); float d0 = vdot(e, s[k]);
      if (0.0f <= d0 && d0 * d0 <= el) { float qv[3] = { s[k][0] - e[0] * d0, s[k][1] - e[1] * d0, s[k][2] - e[2] * d0 }; if (vlsq(qv) < r2) { coll = q; vadd(nsum, A->n); break; } } }
  }
  return coll;
}
// moving sphere, one model (func_800AC638): p2 is moved back to the last free bisection point; nout = normalized normal sum
TD int msphere_model(const TWorld *w, int mi, const float *p1, float *p2, float r, float *nout, int steps, unsigned filt, TTri *hit, TAct *act) {
  float vel[3]; vsub(vel, p2, p1); int n = fast_check(w, mi, p1, p2, vel, r + 0.5f, filt, act, TMAXACT); if (!n) return 0;
  float ns[3]; int c = iterate(act, n, p2, r, ns); if (c < 0) return 0;
  vcp(nout, ns); float dist[3]; vsub(dist, p2, p1); vcp(p2, p1); float st = 0.0f, en = 1.0f;
  for (int k = 0; k < steps; k++) { float cu = (st + en) * 0.5f; float cp[3] = { dist[0] * cu + p1[0], dist[1] * cu + p1[1], dist[2] * cu + p1[2] };
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
  FOR_CELL_TRIS(M, ca, cb, k, {
    unsigned fl = M->TF[k]; if (fl & filt) continue;
    { const short *bb = M->BB + 6 * k; if (mx[0] < (float)bb[0] || (float)bb[1] < mn[0] || mx[1] < (float)bb[2] || (float)bb[3] < mn[1] || mx[2] < (float)bb[4] || (float)bb[5] < mn[2]) continue; }
    const unsigned short *T = M->T + 3 * k; float v[3][3];
    for (int j = 0; j < 3; j++) { const short *p = M->V + 3 * T[j]; v[j][0] = (float)p[0]; v[j][1] = (float)p[1]; v[j][2] = (float)p[2]; }
    float ab[3], ac[3], N[3]; vsub(ab, v[1], v[0]); vsub(ac, v[2], v[0]); vcross(N, ab, ac); vnorm(N);
    if (N[0] == 0.0f && N[1] == 0.0f && N[2] == 0.0f) continue;
    float s0[3]; vsub(s0, pos, v[0]);
    if ((fl & 0x10000) && vdot(s0, N) < 0.0f) { N[0] = -N[0]; N[1] = -N[1]; N[2] = -N[2]; }
    float th = vdot(s0, N); if (rd <= fabsf_(th)) continue;
    float pp[3] = { pos[0] - N[0] * th, pos[1] - N[1] * th, pos[2] - N[2] * th };
    int pa = fabsf_(N[1]) < fabsf_(N[0]) ? 0 : 1; if (fabsf_(N[pa]) < fabsf_(N[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
    float a0 = pp[i1] - v[0][i1], a1 = ab[i1], a2 = ac[i1], b0 = pp[i2] - v[0][i2], b1 = ab[i2], b2 = ac[i2];
    float inv = 1.0f / (a1 * b2 - a2 * b1); float u = (a0 * b2 - a2 * b0) * inv;
    if (0.0f <= u && u <= 1.0f) { float ww = (a1 * b0 - a0 * b1) * inv; if (0.0f <= ww && ww <= 1.0f && u + ww <= 1.0f) { found = 1; hit->m = mi; hit->i = k; vadd(acc, N); continue; } }
    float s[3][3]; int h2 = 0;
    for (int j = 0; j < 3; j++) { vsub(s[j], pos, v[j]); if (vlsq(s[j]) < r2) { found = 1; hit->m = mi; hit->i = k; vadd(acc, N); h2 = 1; break; } }
    if (h2) continue;
    for (int j = 0; j < 3; j++) { float e[3]; vsub(e, v[(j + 1) % 3], v[j]); float el = vlsq(e); vnorm(e); float d0 = vdot(e, s[j]);
      if (0.0f <= d0 && d0 * d0 <= el) { float qv[3] = { s[j][0] - e[0] * d0, s[j][1] - e[1] * d0, s[j][2] - e[2] * d0 }; if (vlsq(qv) < r2) { found = 1; hit->m = mi; hit->i = k; vadd(acc, N); break; } } }
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
  unsigned filt = mfilt | TWATER; float old[3], tgt[3]; vcp(old, old_in); vcp(tgt, tgt_in); int gnd = grounded_in;
  R->hits = 0; R->held = 0; R->held_flag = 0; R->last = TNONE;
  // func_800FAE44: fallback = old pushed out of whatever the sphere at old touches (by 2.0 along the normal), old moved too
  float fb[3]; vcp(fb, old);
  { float c[3] = { old[0], old[1] + h, old[2] }, n[3] = { 0, 0, 0 }; TTri t = wsphere(w, c, r, n, filt);
    if (tri_ok(t)) { fb[0] = n[0] * 2.0f + old[0]; fb[1] = n[1] * 2.0f + old[1]; fb[2] = n[2] * 2.0f + old[2]; vcp(old, fb);
      float a[3], b[3], n2[3] = { 0, 0, 0 }; vcp(a, old); vcp(b, old); a[1] = a[1] + 100.0f; b[1] = b[1] - 500.0f;
      TTri t2 = wline(w, a, b, n2, filt);
      if (tri_ok(t2) && (!(n2[1] < 0.0f) || (triflags(w, t2) & 0x10000)) && old[1] < b[1]) old[1] = b[1]; } }
  TPass P[5]; int i = 0;
  for (i = 0; i < 5; i++) {
    TPass *c = P + i, *pv = i ? P + i - 1 : 0;
    if (i) { vcp(c->u0, pv->u0); vcp(c->uC, pv->uC); } else { vcp(c->u0, tgt); vcp(c->uC, old); }
    float keep[3]; vcp(keep, c->u0); float d[3]; vsub(d, c->u0, c->uC);
    c->line = TNONE;
    if (100.0f < vlsq(d)) {
      float y0 = c->u0[1]; float n44[3] = { 0, 0, 0 };
      // func_800FABF4 / func_800FAB50: line from old+h to new+h extended by r-1
      #define TLINE() do { float s34[3] = { c->uC[0], c->uC[1] + h, c->uC[2] }, s28[3] = { c->u0[0], c->u0[1] + h, c->u0[2] }; \
        float ext[3]; vsub(ext, s28, s34); vsetlen(ext, r - 1.0f); float s20[3]; vcp(s20, s28); vadd(s20, ext); \
        TTri lt = wline(w, s34, s20, n44, filt); if (tri_ok(lt)) { vsubin(s20, ext); c->u0[0] = s20[0]; c->u0[1] = s20[1] - h; c->u0[2] = s20[2]; } c->line = lt; } while (0)
      TLINE();
      if (tri_ok(c->line)) { float dn[3]; vcp(dn, d); vnorm(dn); if (0.0f < vdot(dn, n44)) { vcp(c->u0, keep); c->line = TNONE; } }
      if (tri_ok(c->line) && 0.0f <= n44[1] && n44[1] < 0.01999999955f) {
        float lim = tr->posZ - 1.0f; float yl = y0;
        if (lim <= fabsf_(y0 - c->u0[1])) { TLINE(); yl = c->u0[1]; }
        c->u0[1] = yl; }
      #undef TLINE
    }
    floor_snap(tr, w, c->u0, disp, &gnd, mfilt); c->gnd = gnd;
    c->c_old[0] = c->uC[0]; c->c_old[1] = c->uC[1] + h; c->c_old[2] = c->uC[2];
    c->c_new[0] = c->u0[0]; c->c_new[1] = c->u0[1] + h; c->c_new[2] = c->u0[2];
    c->n[0] = c->n[1] = c->n[2] = 0.0f;
    c->hit = wmsphere(w, c->c_old, c->c_new, r, c->n, 3, filt, act);
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
      c->u0[0] = c->u0[0] + ph * c->n[0]; c->u0[1] = c->u0[1] + ph * c->n[1]; c->u0[2] = c->u0[2] + ph * c->n[2]; }
  }
  if (i == 5) { R->held = 1; if (gnd == 0 && tri_ok(R->last) && tgt_in[1] < old[1]) R->held_flag = 1; vcp(R->out, fb); }
  else vcp(R->out, P[i].u0);
  R->grounded = gnd;
}
#endif
