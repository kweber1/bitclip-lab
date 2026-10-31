// trot810.cu -- PAL 810 room: deep move search after the talon trot (GPU). Same rules and float steps as the CPU tool stagec.c:
// from each start state (post-trot stop, facing set by the in-trot first-person twirl), up to D moves, each one of
//   twirl TW m (first-person, m = -50..-1, 1..50, 3.6 deg steps, no-lag model), crouch-face CF to one of the 8 notches
//   (camera yaw = yaw from Banjo to the room's camera home), full punch P, punch cancel C1;
// then the final punch cancel (C1 from the current facing). A landing is a HIT when it equals a verified natural-lag clip crack
// (t1, bit-exact) or any red-line crack float (t2). Facing moves are never placed next to each other (two in a row = one).
// Thread = (state, first token, second token); it walks the rest of the tree itself.
// Tokens: 0..99 twirl, 100..107 CF, 108 P, 109 C1, 110 END.
// usage: trot810 states.txt t1.txt t2.txt D out.txt   (states: label xbits zbits yawbits ...; t1: "x z" decimals; t2: "xbits zbits r")
// CPU build (g++ -x c++): runs everything on the CPU (for checks against stagec).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <vector>
#include <string>
#include <algorithm>
#include <chrono>
#include "bkcol_port.h"
#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA %s at %s:%d\n", cudaGetErrorString(e_), __FILE__, __LINE__); exit(1); } } while (0)
#define NTOK 111
#define END 110
#define MAXT1 32
struct Ctx { int trottw; const unsigned short *A; const float *SX, *SZ, *SY; int ns; const uint *T1X, *T1Z; int n1; const unsigned long long *T2; int n2; float t1x[MAXT1], t1z[MAXT1]; int D;
  unsigned long long *best; unsigned long long *hits; unsigned int *nhits; };
static HD float nrmf(float a) { if (a < 0.0) { a = nrmf(-a); a = 360.0 - a; } if (a >= 360.0) a -= 360.0 * (int)(a / 360.0); return a; }
static HD float camT(const unsigned short *A, float x, float z) { float dx = 355.620117f - x, dz = -357.104492f - z; float h = sqrtf(dx * dx + dz * dz); float o = ml_acosf(A, dx / h); if (dz < 0) o = 180 - o; if (dx < 0) o = 360 - o; return o; }
static HD float NA_(int n) { switch (n) { case 0: return 90.0f; case 1: return 45.0f; case 2: return 0.008999999612569809f; case 3: return 315.0f; case 4: return 270.0f; case 5: return 225.0f; case 6: return 179.99099731445312f; default: return 135.0f; } }
static HD void claw(float *x, float *z, float yaw, int nupd) {
  const float SC = (float)((double)0.04f / 0.0333333);
  float v2 = (float)(yaw * BAD_DTOR); float tmp = 0 * lib_sinf(0) + lib_cosf(0) * 160.0f; float tx = tmp * lib_sinf(v2) + lib_cosf(v2) * 0, tz = tmp * lib_cosf(v2) - lib_sinf(v2) * 0;
  float vx = 0, vz = 0;
  for (int i = 1; i <= 400; i++) { float Tx = i <= 19 ? tx : 0, Tz = i <= 19 ? tz : 0;
    float ax = Tx * 0.29f, bx = vx * 0.29f; ax = ax - bx; ax = ax * SC; vx += ax;
    float az = Tz * 0.29f, bz = vz * 0.29f; az = az - bz; az = az * SC; vz += az;
    float dx = vx, dz = vz; if (fabsf(vx) < 0.0001) vx = 0; if (fabsf(vz) < 0.0001) vz = 0;
    *x = *x + dx * 0.04f; *z = *z + dz * 0.04f;
    if (i >= nupd && nupd > 0) return; if (nupd == 0 && i > 19 && vx == 0 && vz == 0) return; }
}
static HD void apply(const Ctx &C, int k, float *x, float *z, float *yaw) {
  if (k < 100) { int m = k < 50 ? k - 50 : k - 49; float e = nrmf((float)(*yaw + 180.0)); int n = m < 0 ? -m : m; for (int i = 0; i < n; i++) e = (float)(e + (m < 0 ? -3.6 : 3.6)); e = nrmf(e); *yaw = nrmf((float)(e + 180.0)); }
  else if (k < 108) { float c = camT(C.A, *x, *z); *yaw = nrmf((float)((c + NA_(k - 100)) + 90.0)); }
  else if (k == 108) claw(x, z, *yaw, 0); else claw(x, z, *yaw, 1);
}
#ifdef ALLOWFF
static HD bool isF(int k) { return false; }
#else
static HD bool isF(int k) { return k < 108; }
#endif
// final punch cancel; route code = (state, path tokens packed 7 bits each, depth)
static HD void finalc(const Ctx &C, float x, float z, float yaw, int s, unsigned long long path, int depth) {
  float X = x, Z = z; claw(&X, &Z, yaw, 1); uint bx = fbits(X), bz = fbits(Z);
  unsigned long long code = ((unsigned long long)s << 40) | (path << 4) | (unsigned long long)depth;
  for (int k = 0; k < C.n1; k++) if (C.T1X[k] == bx && C.T1Z[k] == bz) {
#ifdef __CUDA_ARCH__
    unsigned int i = atomicAdd(C.nhits, 1u);
#else
    unsigned int i = (*C.nhits)++;
#endif
    if (i < 4096) { C.hits[2 * i] = code; C.hits[2 * i + 1] = (unsigned long long)k; } }
  { unsigned long long key = ((unsigned long long)bx << 32) | bz; int lo = 0, hi = C.n2 - 1; while (lo <= hi) { int m = (lo + hi) / 2; if (C.T2[m] == key) {
#ifdef __CUDA_ARCH__
      unsigned int i = atomicAdd(C.nhits, 1u);
#else
      unsigned int i = (*C.nhits)++;
#endif
      if (i < 4096) { C.hits[2 * i] = code; C.hits[2 * i + 1] = 1000ULL + m; } break; } if (C.T2[m] < key) lo = m + 1; else hi = m - 1; } }
  if (fabsf(X + 74.5f) > 8 || fabsf(Z - 629.8f) > 8) return;
  for (int k = 0; k < C.n1; k++) { float dx = X - C.t1x[k], dz = Z - C.t1z[k]; float d = sqrtf(dx * dx + dz * dz);
    unsigned long long v = ((unsigned long long)fbits(d) << 32) | 0; // distance bits; route kept separately
#ifdef __CUDA_ARCH__
    unsigned long long old = atomicMin(&C.best[2 * k], v); if (v < old) atomicExch(&C.best[2 * k + 1], code);
#else
    if (v < C.best[2 * k]) { C.best[2 * k] = v; C.best[2 * k + 1] = code; }
#endif
  }
}
static HD void dfs(const Ctx &C, float x, float z, float yaw, int s, unsigned long long path, int depth, int last) {
  if (depth >= C.D) return;
  for (int k = 0; k < 110; k++) { if (isF(k) && last >= 0 && isF(last)) continue;
    float x1 = x, z1 = z, y1 = yaw; apply(C, k, &x1, &z1, &y1); unsigned long long p = path | ((unsigned long long)k << (7 * depth));
    finalc(C, x1, z1, y1, s, p, depth + 1); dfs(C, x1, z1, y1, s, p, depth + 1, k); }
}
// in-trot first-person twirl (bkmove fpTwirl, checked 101/101 against the full-engine trot exit): state yaw y0 is the facing after
// the trot exit with no twirl; twirl m inside the trot gives flip(fpTwirl(flip(y0), m)).
static HD float n1f(float a) { if (a >= 360) a = (float)(a - 360); if (a < 0) a = (float)(a + 360); return a; }
static HD float trotTw(float y0, int m) { float q = (float)(y0 + 180) >= 360 ? (float)((double)y0 + 180 - 360) : (float)(y0 + 180);
  float sg = m < 0 ? -3.6f : 3.6f; float e = n1f((float)(q + 180)); int n = m < 0 ? -m : m; for (int i = 0; i < n; i++) e = n1f((float)(e + sg)); float y = n1f((float)(e + 180));
  float r = (float)(y + 180); if (r >= 360) r = (float)((double)r - 360); return r; }
static HD void thread_(const Ctx &C, long long t) {
  int s = (int)(t / (NTOK * NTOK)); int r = (int)(t % (NTOK * NTOK)); int a1 = r / NTOK, a2 = r % NTOK;
  int b = C.trottw ? s / 101 : s; float x = C.SX[b], z = C.SZ[b], yaw = C.SY[b]; if (C.trottw && s % 101 != 50) yaw = trotTw(yaw, s % 101 - 50);
  if (a1 == END) { if (a2 == END) finalc(C, x, z, yaw, s, 0, 0); return; }
  if (C.D < 1) return;
  apply(C, a1, &x, &z, &yaw); unsigned long long p = (unsigned long long)a1;
  if (a2 == END) { finalc(C, x, z, yaw, s, p, 1); return; }
  if (C.D < 2 || (isF(a1) && isF(a2))) return;
  apply(C, a2, &x, &z, &yaw); p |= (unsigned long long)a2 << 7; finalc(C, x, z, yaw, s, p, 2);
  dfs(C, x, z, yaw, s, p, 2, a2);
}
#ifdef __CUDACC__
__global__ void k_run(Ctx C, long long t0, long long nt) { long long t = t0 + (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= t0 + nt) return; thread_(C, t); }
template <class T> static T *up(const std::vector<T> &v) { T *p; CK(cudaMalloc(&p, (v.size() ? v.size() : 1) * sizeof(T))); if (v.size()) CK(cudaMemcpy(p, v.data(), v.size() * sizeof(T), cudaMemcpyHostToDevice)); return p; }
#endif
static float fbf(uint u) { float f; memcpy(&f, &u, 4); return f; }
static std::string tokname(int k) { char b[32]; if (k < 100) { int m = k < 50 ? k - 50 : k - 49; snprintf(b, 32, "twirl %+d", m); } else if (k < 108) { const char *N[8] = { "U", "UR", "R", "DR", "D", "DL", "L", "UL" }; snprintf(b, 32, "crouch-face %s", N[k - 100]); } else snprintf(b, 32, k == 108 ? "punch" : "punch cancel"); return b; }
static std::string route(const std::vector<std::string> &lab, unsigned long long code) { int s = (int)(code >> 40); int d = (int)(code & 15); unsigned long long p = (code >> 4) & ((1ULL << 36) - 1);
  std::string r = lab[s]; for (int i = 0; i < d; i++) r += ", " + tokname((int)((p >> (7 * i)) & 127)); return r + ", final punch cancel"; }
int main(int argc, char **argv) {
  if (argc < 6) { fprintf(stderr, "usage: trot810 states.txt t1.txt t2.txt D out.txt\n"); return 1; }
  std::vector<unsigned short> A(10001); for (int i = 0; i <= 10000; i++) A[i] = (unsigned short)(int)(sin(i * 0.009 * 3.14159265358979323846 / 180.0) * 65535);
  std::vector<std::string> lab; std::vector<float> SX, SZ, SY; { FILE *f = fopen(argv[1], "r"); char l[512], b[300]; unsigned a, c, d; int D0;
    while (f && fgets(l, sizeof l, f)) if (sscanf(l, "%299s %u %u %u %d", b, &a, &c, &d, &D0) >= 4) { lab.push_back(b); SX.push_back(fbf(a)); SZ.push_back(fbf(c)); SY.push_back(fbf(d)); } if (f) fclose(f); }
  std::vector<uint> T1X, T1Z; std::vector<float> t1x, t1z; { FILE *f = fopen(argv[2], "r"); float a, b; while (f && fscanf(f, "%f %f", &a, &b) == 2) { t1x.push_back(a); t1z.push_back(b); T1X.push_back(fbits(a)); T1Z.push_back(fbits(b)); } if (f) fclose(f); }
  std::vector<unsigned long long> T2; { FILE *f = fopen(argv[3], "r"); unsigned a, b; float r; while (f && fscanf(f, "%u %u %f", &a, &b, &r) == 3) T2.push_back(((unsigned long long)a << 32) | b); if (f) fclose(f); std::sort(T2.begin(), T2.end()); }
  int D = atoi(argv[4]); FILE *fo = fopen(argv[5], "w");
  int trottw = getenv("TROTTW") ? 1 : 0; if (trottw) { std::vector<std::string> l2; for (auto &L : lab) for (int m = -50; m <= 50; m++) { char b[32]; snprintf(b, 32, " in-trot twirl %+d", m); l2.push_back(L + b); } lab.swap(l2); }
  int ns = (int)lab.size(), n1 = (int)t1x.size(); long long nt = (long long)ns * NTOK * NTOK;
  fprintf(fo, "states %d targets %d red-line floats %d moves <= %d threads %lld\n", ns, n1, (int)T2.size(), D, nt); fflush(fo);
  Ctx C; memset(&C, 0, sizeof C); C.trottw = trottw; C.ns = ns; C.n1 = n1; C.n2 = (int)T2.size(); C.D = D; for (int k = 0; k < n1; k++) { C.t1x[k] = t1x[k]; C.t1z[k] = t1z[k]; }
  std::vector<unsigned long long> best(2 * n1, ~0ULL), hits(8192, 0); unsigned int nh = 0; auto T0 = std::chrono::steady_clock::now();
#ifdef __CUDACC__
  CK(cudaDeviceSetLimit(cudaLimitStackSize, 16384));
  C.A = up(A); C.SX = up(SX); C.SZ = up(SZ); C.SY = up(SY); C.T1X = up(T1X); C.T1Z = up(T1Z); C.T2 = up(T2); C.best = up(best); C.hits = up(hits);
  unsigned int *dn; CK(cudaMalloc(&dn, 4)); CK(cudaMemset(dn, 0, 4)); C.nhits = dn;
  const long long CHN = 1 << 20;
  for (long long t0 = 0; t0 < nt; t0 += CHN) { long long n = nt - t0 < CHN ? nt - t0 : CHN; k_run<<<(unsigned)((n + 127) / 128), 128>>>(C, t0, n); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
    CK(cudaMemcpy(&nh, dn, 4, cudaMemcpyDeviceToHost));
    fprintf(stderr, "%lld/%lld threads | hits %u | %.0f s\n", t0 + n, nt, nh, std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count()); }
  CK(cudaMemcpy(best.data(), C.best, best.size() * 8, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(hits.data(), C.hits, hits.size() * 8, cudaMemcpyDeviceToHost));
#else
  C.A = A.data(); C.SX = SX.data(); C.SZ = SZ.data(); C.SY = SY.data(); C.T1X = T1X.data(); C.T1Z = T1Z.data(); C.T2 = T2.data(); C.best = best.data(); C.hits = hits.data(); C.nhits = &nh;
  for (long long t = 0; t < nt; t++) thread_(C, t);
#endif
  if (nh > 4096) nh = 4096;
  fprintf(fo, "hits %u (%.0f s)\n", nh, std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count());
  for (unsigned i = 0; i < nh; i++) { unsigned long long k = hits[2 * i + 1]; fprintf(fo, "HIT %s %llu | %s\n", k >= 1000 ? "red-line" : "VERIFIED crack", k >= 1000 ? k - 1000 : k, route(lab, hits[2 * i]).c_str()); }
  for (int k = 0; k < n1; k++) { if (best[2 * k] == ~0ULL) { fprintf(fo, "NEAREST crack (%.7f, %.7f): none within 8\n", t1x[k], t1z[k]); continue; }
    fprintf(fo, "NEAREST crack (%.7f, %.7f): %.6f units | %s\n", t1x[k], t1z[k], fbf((uint)(best[2 * k] >> 32)), route(lab, best[2 * k + 1]).c_str()); }
  fclose(fo); return 0;
}
