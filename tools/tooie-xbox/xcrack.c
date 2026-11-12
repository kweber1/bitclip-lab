// Claude 2026-11-12 (xcrack.c): Banjo-Tooie floor-ray cracks, N64 math vs Xbox 360 XBLA math, on the seams of one room near a point.
// N64 = tcol.h's line test (separate multiply and add). 360 = the same test as compiled in Banjo2_CPR.exe (function 0x82227850):
// cross 0x8228CA48, dot 0x8228CB40, hit point and barycentrics with fused multiply-add (fmaf = PPC fmadds / fmsubs, one rounding).
// Build: gcc -O2 -ffp-contract=off -o xcrack xcrack.c -lm      Run: ./xcrack room.txt x y z r [maxlist]
#include "tcol.h"
#include "troom.h"
#include <stdint.h>
static void tv(const TModel *M, int k, float v[3][3]) { const unsigned short *T = M->T + 3 * k;
  for (int j = 0; j < 3; j++) for (int c = 0; c < 3; c++) v[j][c] = (float)M->V[3 * T[j] + c]; }
static void xcross(float *o, const float *a, const float *b) {   // 0x8228CA48
  float x = fmaf(b[2], a[1], -(a[2] * b[1])), y = fmaf(a[2], b[0], -(b[2] * a[0])), z = fmaf(a[0], b[1], -(b[0] * a[1])); o[0] = x; o[1] = y; o[2] = z; }
static float xdot(const float *a, const float *b) { float f = a[1] * b[1]; f = fmaf(a[2], b[2], f); return fmaf(a[0], b[0], f); }   // 0x8228CB40
// one triangle, the segment s..e: 1 = hit. x360 = 0 N64 order, 1 Xbox 360 order
static int tri_hit(const TModel *M, int k, const float *s, const float *e, int x360) {
  float v[3][3]; tv(M, k, v); float *v0 = v[0];
  float d[3], ab[3], ac[3], N[3]; vsub(d, e, s); vsub(ab, v[1], v0); vsub(ac, v[2], v0);
  if (x360) xcross(N, ab, ac); else vcross(N, ab, ac);
  if (100000.0f < fabsf_(N[0]) || 100000.0f < fabsf_(N[1]) || 100000.0f < fabsf_(N[2])) { N[0] *= 9.999999747e-06f; N[1] *= 9.999999747e-06f; N[2] *= 9.999999747e-06f; }
  float ls[3], le[3]; vsub(ls, s, v0); vsub(le, e, v0);
  float a = x360 ? xdot(ls, N) : vdot(ls, N), b = x360 ? xdot(le, N) : vdot(le, N);
  if (0.0f <= a && 0.0f <= b) return 0; if (a <= 0.0f && b <= 0.0f) return 0;
  if ((M->TF[k] & 0x10000) && a < 0.0f) { N[0] = -N[0]; N[1] = -N[1]; N[2] = -N[2]; }
  float np = -(x360 ? xdot(v0, N) : vdot(v0, N)), nd = x360 ? xdot(N, d) : vdot(N, d); if (0.0f <= nd) return 0;
  float t = x360 ? -((xdot(N, s) + np) / nd) : -(vdot(N, s) + np) / nd; if (t <= 0.0f) return 0; if (1.0f <= t) return 0;
  float cur[3]; for (int i = 0; i < 3; i++) cur[i] = x360 ? fmaf(d[i], t, s[i]) : d[i] * t + s[i];
  int pa = fabsf_(N[1]) < fabsf_(N[0]) ? 0 : 1; if (fabsf_(N[pa]) < fabsf_(N[2])) pa = 2; int i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
  float f0 = cur[i1] - v0[i1], f1 = ab[i1], f2 = ac[i1], e0 = cur[i2] - v0[i2], e1 = ab[i2], e2 = ac[i2], u, ww;
  if (x360) { float inv = 1.0f / fmaf(e2, f1, -(f2 * e1)); u = fmaf(f0, e2, -(e0 * f2)) * inv; if (u < 0.0f || 1.0f < u) return 0;
    ww = fmaf(e0, f1, -(f0 * e1)) * inv; }
  else { float inv = 1.0f / (f1 * e2 - f2 * e1); u = (f0 * e2 - f2 * e0) * inv; if (u < 0.0f || 1.0f < u) return 0; ww = (f1 * e0 - f0 * e1) * inv; }
  if (ww < 0.0f || 1.0f < ww) return 0; if (1.0f < u + ww) return 0; return 1; }
static double plane_y(const TModel *M, int k, double x, double z) { float v[3][3]; tv(M, k, v);
  double ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2], vx = v[2][0] - v[0][0], vy = v[2][1] - v[0][1], vz = v[2][2] - v[0][2];
  double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (ny == 0) return v[0][1]; return v[0][1] - (nx * (x - v[0][0]) + nz * (z - v[0][2])) / ny; }
static uint32_t fkey(float f) { uint32_t b; memcpy(&b, &f, 4); return (b & 0x80000000u) ? ~b : (b | 0x80000000u); }
static float kfloat(uint32_t k) { uint32_t b = (k & 0x80000000u) ? (k & 0x7FFFFFFFu) : ~k; float f; memcpy(&f, &b, 4); return f; }
static float fstep(float f, int n) { return kfloat(fkey(f) + (uint32_t)n); }
typedef struct { int m, k; } TR;
static TModel *Ms[2]; static TR cand[20000]; static int ncand;
// floor ray at (x, y, z): feet + 56 down to feet - 444, filter 0x400005; a crack if no triangle is hit within 5 below .. 56 above
static int crack(float x, float y, float z, int x360) { float s[3] = { x, y + 56.0f, z }, e[3] = { x, y - 444.0f, z };
  for (int q = 0; q < ncand; q++) { const TModel *M = Ms[cand[q].m]; int k = cand[q].k; if (M->TF[k] & 0x400005u) continue;
    if (tri_hit(M, k, s, e, x360)) { double py = plane_y(M, k, x, z); if (py >= (double)y - 5.0 && py <= (double)y + 56.0) return 0; } }
  return 1; }
int main(int argc, char **argv) {
  TWorld w; load_world(argv[1], &w); Ms[0] = (TModel *)w.m[0]; Ms[1] = (TModel *)w.m[1];
  float X = atof(argv[2]), Y = atof(argv[3]), Z = atof(argv[4]), R = atof(argv[5]); int maxl = argc > 6 ? atoi(argv[6]) : 20;
  // candidates: triangles whose box reaches the region (+60)
  for (int m = 0; m < 2; m++) { const TModel *M = Ms[m]; if (!M) continue;
    for (int k = 0; k < M->nt; k++) { const short *bb = M->BB + 6 * k; if (bb[1] < X - R - 60 || bb[0] > X + R + 60 || bb[5] < Z - R - 60 || bb[4] > Z + R + 60 || bb[3] < Y - 600 || bb[2] > Y + 600) continue;
      cand[ncand].m = m; cand[ncand].k = k; ncand++; } }
  fprintf(stderr, "%d candidate triangles\n", ncand);
  if (argc > 7 && !strcmp(argv[7], "classify")) {   // stdin: "xbits ybits zbits" per line -> class per line
    unsigned bx, by, bz; while (scanf("%x %x %x", &bx, &by, &bz) == 3) { float p[3]; memcpy(&p[0], &bx, 4); memcpy(&p[1], &by, 4); memcpy(&p[2], &bz, 4);
      int cn = crack(p[0], p[1], p[2], 0), cx = crack(p[0], p[1], p[2], 1); printf("%08X %08X %08X %s\n", bx, by, bz, cn && cx ? "BOTH" : cn ? "N64ONLY" : cx ? "X360ONLY" : "SOLID"); }
    return 0; }
  // seams: edges shared (by coordinates) by two walkable floor triangles (flags & 0x420025 == 0, n.y > 0.3), both edge ends within R
  long tot[4] = { 0, 0, 0, 0 }; int nseam = 0, listed[3] = { 0, 0, 0 };
  for (int a = 0; a < ncand; a++) for (int b = a + 1; b < ncand; b++) {
    const TModel *MA = Ms[cand[a].m], *MB = Ms[cand[b].m]; int ka = cand[a].k, kb = cand[b].k;
    if ((MA->TF[ka] | MB->TF[kb]) & 0x420025u) continue;
    float va[3][3], vb[3][3]; tv(MA, ka, va); tv(MB, kb, vb);
    double nya = plane_y(MA, ka, 0, 0), dummy = nya; (void)dummy;
    for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) {
      const float *P = va[i], *Q = va[(i + 1) % 3];
      const float *P2 = vb[j], *Q2 = vb[(j + 1) % 3];
      if (!(P[0] == Q2[0] && P[1] == Q2[1] && P[2] == Q2[2] && Q[0] == P2[0] && Q[1] == P2[1] && Q[2] == P2[2])) continue;
      // floor normals
      float ab[3], ac[3], n1[3], n2[3]; vsub(ab, va[1], va[0]); vsub(ac, va[2], va[0]); vcross(n1, ab, ac); vnorm(n1);
      vsub(ab, vb[1], vb[0]); vsub(ac, vb[2], vb[0]); vcross(n2, ab, ac); vnorm(n2);
      if (!(fabsf(n1[1]) > 0.3f && fabsf(n2[1]) > 0.3f)) continue;
      if (hypotf(P[0] - X, P[2] - Z) > R || hypotf(Q[0] - X, Q[2] - Z) > R) continue;
      nseam++; int ax = fabsf(Q[0] - P[0]) >= fabsf(Q[2] - P[2]) ? 0 : 2, ot = 2 - ax;
      float lo = P[ax] < Q[ax] ? P[ax] : Q[ax], hi = P[ax] < Q[ax] ? Q[ax] : P[ax]; long c[4] = { 0, 0, 0, 0 };
      for (uint32_t kk = fkey(lo) + 1; kk < fkey(hi); kk++) { float m = kfloat(kk); if (m > -1.0f && m < 1.0f) continue;
        double t = ((double)m - P[ax]) / ((double)Q[ax] - P[ax]); double cc = P[ot] + t * ((double)Q[ot] - P[ot]);
        for (int o = -3; o <= 3; o++) { float p[3]; p[ax] = m; p[ot] = fstep((float)cc, o); float y = (float)plane_y(MA, ka, p[0], p[2]);
          int cn = crack(p[0], y, p[2], 0), cx = crack(p[0], y, p[2], 1); int cls = cn * 2 + cx; c[cls]++;
          if (cls && listed[cls - 1] < maxl) { listed[cls - 1]++;
            uint32_t bx, by, bz; memcpy(&bx, &p[0], 4); memcpy(&by, &y, 4); memcpy(&bz, &p[2], 4);
            printf("%s %.6f %.6f %.6f  bits %08X %08X %08X  seam (%g %g %g)-(%g %g %g)\n", cls == 3 ? "BOTH" : cls == 2 ? "N64ONLY" : "X360ONLY", p[0], y, p[2], bx, by, bz, P[0], P[1], P[2], Q[0], Q[1], Q[2]); } } }
      fprintf(stderr, "seam (%g %g %g)-(%g %g %g): solid both %ld, crack both %ld, N64-only %ld, 360-only %ld\n", P[0], P[1], P[2], Q[0], Q[1], Q[2], c[0], c[3], c[2], c[1]);
      for (int q = 0; q < 4; q++) tot[q] += c[q]; } }
  fprintf(stderr, "%d seams: solid both %ld, crack both %ld, N64-only %ld, 360-only %ld\n", nseam, tot[0], tot[3], tot[2], tot[1]);
  return 0; }
