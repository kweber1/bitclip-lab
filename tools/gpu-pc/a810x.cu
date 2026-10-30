// a810.cu -- NTSC 810 room: plain punch cancel at every crack spot with ambient (3/2) console lag, GPU.
// Engine: bkmove_port.h + bkcol_port.h built with -DBK_RATE=60 -DBK_CAP=0.05 (NTSC). The JS original matched the console
// lockstep brute 324/324 (24 clips). For each spot: the standing spot (facing yaw) whose claw update (d0 = 2 or 3 VI) lands
// exactly on the spot; then B on update 0, A on updates 1..K, frame lengths from the pattern; clip = y below -300.
// Patterns: alternation phase A (claw 3 VI) / phase B (claw 2 VI), and every single-update flip (updates 1..NF).
// usage: a810 room.bin spots.txt out.txt progress.txt [yaw] [alt|all3|all2|3then2|file patterns.txt]   spots.txt: "xbits zbits" (decimal or 0x hex) per line
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <chrono>
#include <string>
#include <algorithm>
#include "bkmove_port.h"
#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA %s at %s:%d\\n", cudaGetErrorString(e_), __FILE__, __LINE__); exit(1); } } while (0)
#define NU 45          // updates simulated from the claw
#define NF 34          // flip positions 1..NF-1 (0 = no flip)
#define NK 12
#define NCASE (2 * NF * NK)
static FILE *fin;
static int rdi() { int v; if (fread(&v, 4, 1, fin) != 1) { fprintf(stderr, "short read\n"); exit(1); } return v; }
template <class T> static std::vector<T> rdv() { int n = rdi(); std::vector<T> v(n); if (n && fread(v.data(), sizeof(T), n, fin) != (size_t)n) { fprintf(stderr, "short read\n"); exit(1); } return v; }
struct HostRoom { std::vector<float> TF, CLF, PF, RF; std::vector<int> TI, CLI, CELLS, PI, PC, GR; };
static HostRoom read_room() { HostRoom r; r.TF = rdv<float>(); r.TI = rdv<int>(); r.CLI = rdv<int>(); r.CLF = rdv<float>(); r.CELLS = rdv<int>(); r.PF = rdv<float>(); r.PI = rdv<int>(); r.PC = rdv<int>(); r.GR = rdv<int>(); r.RF = rdv<float>(); return r; }
template <class T> static const T *up(const std::vector<T> &v) { T *p; size_t n = v.size() ? v.size() : 1; CK(cudaMalloc(&p, n * sizeof(T))); if (v.size()) CK(cudaMemcpy(p, v.data(), v.size() * sizeof(T), cudaMemcpyHostToDevice)); return p; }
static Room dev_room(const HostRoom &h) { Room r; r.TF = up(h.TF); r.TI = up(h.TI); r.CLI = up(h.CLI); r.CLF = up(h.CLF); r.CELLS = up(h.CELLS); r.PF = up(h.PF); r.PI = up(h.PI); r.PC = up(h.PC); r.GR = up(h.GR); r.RF = up(h.RF); return r; }
HD static inline float fbits(unsigned u) { union { unsigned u; float f; } c; c.u = u; return c.f; }
HD static inline unsigned bitsf(float f) { union { unsigned u; float f; } c; c.f = f; return c.u; }
HD static inline float ulpf(float v, int k) { return fbits(bitsf(v) + k); }   // same sign region (all spots here are x<0, z>0 handled by sign of bits)
#ifdef __CUDACC__
__constant__ int G_MODE;
__constant__ int G_MOVE;
__constant__ int G_THR;
#else
static int G_MODE, G_MOVE, G_THR;
#endif
HD static int dtOf(int phase, int flip, int i) { if (G_MODE == 1) return 3; if (G_MODE == 2) return 2; if (G_MODE == 6) { if (i < flip) return 3; int j = i - flip, first = phase ? 2 : 3; return (j % 2 == 0) ? first : 5 - first; } /* 3s for N, then alternation */ if (G_MODE == 7) { if (i >= flip) return 3; int first = phase ? 2 : 3; return (i % 2 == 0) ? first : 5 - first; } /* alternation for N, then 3s */ if (G_MODE == 3) return i < flip ? 3 : 2; /* mode 3: 3-VI for the first N (= flip) updates from the claw, then 2-VI */ int first = phase ? 2 : 3; int d = (i % 2 == 0) ? first : 5 - first; if (flip && i == flip) d = 5 - d; return d; }
HD static void stand(const Room &R, const unsigned short *A, Player &P, float x, float z, float yaw) {
  pl_init(R, A, P, 0x93, x, 0.0f, z, yaw); Inp none = { 0, 0, 0, 0, 0 }; for (int i = 0; i < 10; i++) pl_step(R, A, P, none, 2); }
// standing spot for spot (cx, cz) and claw length d0: returns 1 and (ox, oz)
HD static int origin(const Room &R, const unsigned short *A, float cx, float cz, float yaw, int d0, float *o) {
  Player P; stand(R, A, P, cx - 1.0f, cz - 1.0f, yaw); float sx = P.pos[0], sz = P.pos[2]; Inp b = { 0, 1, 0, 0, 0 }; pl_step(R, A, P, b, d0);
  float dx = P.pos[0] - sx, dz = P.pos[2] - sz;
  for (int r = 0; r <= 8; r++) for (int i = -r; i <= r; i++) for (int j = -r; j <= r; j++) { if (i > -r && i < r && j > -r && j < r) continue;
    float ox = ulpf(cx - dx, i), oz = ulpf(cz - dz, j); stand(R, A, P, ox, oz, yaw); if (P.pos[0] != ox || P.pos[2] != oz) continue;
    pl_step(R, A, P, b, d0); if (P.pos[0] == cx && P.pos[2] == cz) { o[0] = ox; o[1] = oz; return 1; } }
  return 0;
}
__global__ void k_origin(Room R, const unsigned short *A, const float *spots, int ns, float yaw, float *orig, unsigned char *ok) {
  int t = blockIdx.x * blockDim.x + threadIdx.x; if (t >= ns * 2) return; int s = t / 2, ph = t % 2;
  float o[2]; ok[t] = origin(R, A, spots[2 * s], spots[2 * s + 1], yaw, ph ? 2 : 3, o); orig[2 * t] = o[0]; orig[2 * t + 1] = o[1];
}
// ---- a810x: every lag pattern on updates 1..NB (bit i-1 = 3 VI), claw (update 0) = 2 VI (B registers only on a 2-VI update),
// after NB: alternation. Deep rule: the update after one whose target went below -THR takes 3 VI (console, 20/21).
// Each pattern is weighted by the natural Markov chain (after 2: 3 with P23; after 3: 3 with P33); forced updates weigh 1.
// Output per spot and A hold K: clip probability (sum of weights of clipping patterns) and the count.
#ifndef NB
#define NB 20
#endif
#define KMIN 2
#define NKX 8
__constant__ float G_P23, G_P33;
__device__ unsigned g_nd; __device__ unsigned g_dp[1 << 20]; __device__ float g_dw[1 << 20];
__global__ void k_x(Room R, const unsigned short *A, const float *orig, const unsigned char *ok, int ns, float yaw, float *prob, unsigned *cnt, const float *SPX) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; long long np = 1LL << NB; if (t >= (long long)ns * NKX * np) return;
  unsigned pat = (unsigned)(t % np); long long r = t / np; int K = (int)(r % NKX) + KMIN; int s = (int)(r / NKX);
  Player Q;
  if (G_MOVE == 1) { stand(R, A, Q, SPX[2 * s], SPX[2 * s + 1], yaw); if (Q.pos[0] != SPX[2 * s] || Q.pos[2] != SPX[2 * s + 1]) return; }
  else { if (!ok[2 * s + 1]) return; stand(R, A, Q, orig[2 * (2 * s + 1)], orig[2 * (2 * s + 1) + 1], yaw); }
  float prevy = 0, w = 1, m = 0; int prevd = 2;
#ifdef MC
  w = 1.0f / (float)np; unsigned rng = pat * 2654435761u + 12345u + (unsigned)K * 97u;
#endif
  for (int i = 0; i < NU; i++) {
    Inp in = { i >= 1 && i <= K, i == 0, 0, 0, 0 }; if (G_MOVE == 1) { in.A = i < K; in.B = 0; }
    int d; float p3;
    { const float T2[8] = { 0.85f, 0.13f, 0.39f, 0.78f, 0.99f, 1.0f, 1.0f, 0.26f }, T3[8] = { 0.03f, 0.20f, 0.05f, 0.05f, 0.28f, 0.26f, 0.78f, 0.0f };
      int b = prevy > -1 ? 0 : prevy > -20 ? 1 : prevy > -40 ? 2 : prevy > -60 ? 3 : prevy > -80 ? 4 : prevy > -95 ? 5 : prevy > -110 ? 6 : 7;
      p3 = prevd == 2 ? T2[b] : T3[b]; if (G_THR == 0) p3 = prevd == 2 ? G_P23 : G_P33; }
    if (i == 0 && G_MOVE != 1) d = 2;
#ifdef MC
    else { rng = rng * 1664525u + 1013904223u; unsigned h = rng ^ (rng >> 15); h *= 0x2c1b3c6du; h ^= h >> 12; d = ((float)(h >> 8) * (1.0f / 16777216.0f)) < p3 ? 3 : 2; }
#else
    else if (i <= NB) { int bb = (pat >> (i - 1)) & 1; d = bb ? 3 : 2; float q = bb ? p3 : 1.0f - p3; if (q <= 0.0f) return; w *= q; }
    else d = p3 >= 0.5f ? 3 : 2;
#endif
    float y0 = Q.pos[1]; pl_step(R, A, Q, in, d);
    float tgt = y0 + Q.vel[1] * Q.dt; prevy = (Q.pos[1] > tgt + 1.0f) ? tgt : Q.pos[1];
    if (Q.pos[1] < m) m = Q.pos[1]; prevd = d;
    if (Q.bad) break; if (m < -300) break;
    if (i > 8 && Q.grounded && Q.pos[1] > -1.0f && m > -1.0f && i > K + 6) break;  // never went under and back on the floor
  }
  if (m < -300) { atomicAdd(&prob[s * NKX + K - KMIN], w); atomicAdd(&cnt[s * NKX + K - KMIN], 1u);
    if (ns == 1) { unsigned j = atomicAdd(&g_nd, 1u); if (j < (1u << 20)) { g_dp[j] = pat | ((unsigned)K << 24); g_dw[j] = w; } } }
}
int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: a810x room.bin spots.txt out.txt progress.txt [yaw] [thr]\n"); return 1; }
  float yaw = argc > 5 ? (float)atof(argv[5]) : 45.0f; int thr = argc > 6 ? atoi(argv[6]) : 95; int mode = 0, move = getenv("A810_MOVE") ? atoi(getenv("A810_MOVE")) : 0;
  float p23 = getenv("P23") ? (float)atof(getenv("P23")) : 0.8824f, p33 = getenv("P33") ? (float)atof(getenv("P33")) : 0.0382f;
  fin = fopen(argv[1], "rb"); if (!fin || rdi() != 0x42504331) { fprintf(stderr, "bad room.bin\n"); return 1; }
  std::vector<unsigned short> acos = rdv<unsigned short>(); HostRoom hr = read_room(); fclose(fin);
  std::vector<float> sp; std::vector<unsigned> sb; { FILE *f = fopen(argv[2], "r"); char a[64], b[64];
    while (f && fscanf(f, "%63s %63s%*[^\n]", a, b) == 2) { unsigned xb = (unsigned)strtoul(a, 0, 0), zb = (unsigned)strtoul(b, 0, 0); sb.push_back(xb); sb.push_back(zb); sp.push_back(fbits(xb)); sp.push_back(fbits(zb)); } if (f) fclose(f); }
  int ns = (int)sp.size() / 2; FILE *fo = fopen(argv[3], "w"), *fp = fopen(argv[4], "w");
  fprintf(fp, "a810x: spots %d, yaw %.1f, thr %d, NB %d, P23 %.4f P33 %.4f\n", ns, yaw, thr, NB, p23, p33); fflush(fp);
  auto t0 = std::chrono::steady_clock::now();
  CK(cudaDeviceSetLimit(cudaLimitStackSize, 32768)); CK(cudaMemcpyToSymbol(G_MODE, &mode, sizeof(int))); CK(cudaMemcpyToSymbol(G_MOVE, &move, sizeof(int))); CK(cudaMemcpyToSymbol(G_THR, &thr, sizeof(int)));
  CK(cudaMemcpyToSymbol(G_P23, &p23, sizeof(float))); CK(cudaMemcpyToSymbol(G_P33, &p33, sizeof(float)));
  Room R = dev_room(hr); const unsigned short *dA = up(acos); const float *dS = up(sp);
  float *dO; unsigned char *dOk; CK(cudaMalloc(&dO, ns * 4 * sizeof(float))); CK(cudaMalloc(&dOk, ns * 2));
  k_origin<<<(ns * 2 + 63) / 64, 64>>>(R, dA, dS, ns, yaw, dO, dOk); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
  std::vector<float> O(ns * 4); std::vector<unsigned char> Ok(ns * 2); CK(cudaMemcpy(O.data(), dO, ns * 16, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(Ok.data(), dOk, ns * 2, cudaMemcpyDeviceToHost));
  float *dP; unsigned *dC; CK(cudaMalloc(&dP, ns * NKX * 4)); CK(cudaMalloc(&dC, ns * NKX * 4)); CK(cudaMemset(dP, 0, ns * NKX * 4)); CK(cudaMemset(dC, 0, ns * NKX * 4));
  const int CH = 16; float best = 0;
  for (int s0 = 0; s0 < ns; s0 += CH) { int n = ns - s0 < CH ? ns - s0 : CH; long long nt = (long long)n * NKX * (1LL << NB);
    k_x<<<(unsigned)((nt + 127) / 128), 128>>>(R, dA, dO + s0 * 4, dOk + s0 * 2, n, yaw, dP + s0 * NKX, dC + s0 * NKX, dS + s0 * 2); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
    std::vector<float> P(n * NKX); std::vector<unsigned> C(n * NKX); CK(cudaMemcpy(P.data(), dP + s0 * NKX, n * NKX * 4, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(C.data(), dC + s0 * NKX, n * NKX * 4, cudaMemcpyDeviceToHost));
    for (int s = 0; s < n; s++) { int si = s0 + s; for (int k = 0; k < NKX; k++) if (C[s * NKX + k]) { if (P[s * NKX + k] > best) best = P[s * NKX + k];
      fprintf(fo, "%08x %08x x %.7f z %.7f K %d p %.5f n %u standB %.7f %.7f\n", sb[2 * si], sb[2 * si + 1], sp[2 * si], sp[2 * si + 1], k + KMIN, P[s * NKX + k], C[s * NKX + k], O[4 * si + 2], O[4 * si + 3]); } }
    fflush(fo); fprintf(fp, "%d/%d spots, best p %.5f, %.0f s\n", s0 + n, ns, best, std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count()); fflush(fp); }
  if (ns == 1) { unsigned nd; CK(cudaMemcpyFromSymbol(&nd, g_nd, 4)); if (nd > (1u << 20)) nd = 1u << 20; std::vector<unsigned> dp(nd); std::vector<float> dw(nd);
    CK(cudaMemcpyFromSymbol(dp.data(), g_dp, nd * 4)); CK(cudaMemcpyFromSymbol(dw.data(), g_dw, nd * 4));
    std::vector<int> ix(nd); for (unsigned i = 0; i < nd; i++) ix[i] = i; std::sort(ix.begin(), ix.end(), [&](int a, int b) { return dw[a] > dw[b]; });
    for (unsigned q = 0; q < nd && q < 40; q++) { unsigned v = dp[ix[q]]; char ps[64]; ps[0] = '2'; for (int i = 1; i <= NB; i++) ps[i] = ((v >> (i - 1)) & 1) ? '3' : '2'; ps[NB + 1] = 0;
      fprintf(fo, "pattern K %u w %.5f %s\n", v >> 24, dw[ix[q]], ps); } }
  fprintf(fp, "DONE\n"); fclose(fp); fclose(fo); return 0;
}
