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
#else
static int G_MODE;
#endif
HD static int dtOf(int phase, int flip, int i) { if (G_MODE == 1) return 3; if (G_MODE == 2) return 2; if (G_MODE == 3) return i < flip ? 3 : 2; /* mode 3: 3-VI for the first N (= flip) updates from the claw, then 2-VI */ int first = phase ? 2 : 3; int d = (i % 2 == 0) ? first : 5 - first; if (flip && i == flip) d = 5 - d; return d; }
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
__global__ void k_run(Room R, const unsigned short *A, const float *orig, const unsigned char *ok, int ns, float yaw, float *miny, const unsigned char *pat, int nc, const float *SP) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= (long long)ns * nc) return;
  int s = (int)(t / nc), c = (int)(t % nc); int K = c % NK + 1; c /= NK; int flip = c % NF; int ph = c / NF;
  if (G_MODE == 5) { // drop from rest at height h above the spot, recorded pattern; case = pattern * NK + height index (h = 80 * (K))
    const unsigned char *p = pat + (size_t)c * NU; float h = 80.0f * (float)K;
    Player P; float cx = SP[2 * s], cz = SP[2 * s + 1]; pl_init(R, A, P, 0x93, cx, h, cz, yaw); float m = 1e9f;
    for (int i = 0; i < NU + 30; i++) { Inp none = { 0, 0, 0, 0, 0 }; pl_step(R, A, P, none, p[i < NU ? i : NU - 1]); if (P.pos[1] < m) m = P.pos[1]; if (P.bad) break;
      if (P.grounded && P.pos[1] > -1.0f && P.pos[1] < 1.0f) break; }
    miny[t] = m; return; }
  if (G_MODE == 4) { // recorded pattern c (one length per update from the claw), A held K
    const unsigned char *p = pat + (size_t)c * NU; int phr = p[0] == 2 ? 1 : 0;
    if (!ok[2 * s + phr]) { miny[t] = 1e9f; return; }
    Player P; stand(R, A, P, orig[2 * (2 * s + phr)], orig[2 * (2 * s + phr) + 1], yaw); float m = 0;
    for (int i = 0; i < NU; i++) { Inp in = { i >= 1 && i <= K, i == 0, 0, 0, 0 }; pl_step(R, A, P, in, p[i]); if (P.pos[1] < m) m = P.pos[1]; if (P.bad) break; }
    miny[t] = m; return; }
  if (G_MODE == 1) { if (ph || flip) { miny[t] = 1e9f; return; } }   // all 3: claw is a 3-VI update (origin A), one pattern
  if (G_MODE == 2) { if (!ph || flip) { miny[t] = 1e9f; return; } }  // all 2: claw 2 VI (origin B)
  if (G_MODE == 3) { if (ph != (flip == 0 ? 1 : 0)) { miny[t] = 1e9f; return; } }  // 3s then 2s: claw 3 VI unless N = 0
  if (!ok[2 * s + ph]) { miny[t] = 1e9f; return; }
  Player P; stand(R, A, P, orig[2 * (2 * s + ph)], orig[2 * (2 * s + ph) + 1], yaw); float m = 0;
  for (int i = 0; i < NU; i++) { Inp in = { i >= 1 && i <= K, i == 0, 0, 0, 0 }; pl_step(R, A, P, in, dtOf(ph, flip, i)); if (P.pos[1] < m) m = P.pos[1]; if (P.bad) break; }
  miny[t] = m;
}
int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: a810 room.bin spots.txt out.txt progress.txt [yaw]\n"); return 1; }
  float yaw = argc > 5 ? (float)atof(argv[5]) : 45.0f; int mode = argc > 6 ? (!strcmp(argv[6], "all3") ? 1 : !strcmp(argv[6], "all2") ? 2 : !strcmp(argv[6], "3then2") ? 3 : !strcmp(argv[6], "file") ? 4 : !strcmp(argv[6], "drop") ? 5 : 0) : 0;
  std::vector<unsigned char> PAT; std::vector<std::string> PN;
  if (mode == 4 || mode == 5) { FILE *f = fopen(argv[7], "r"); char nm[128], ps[512];
    while (f && fscanf(f, "%127s %511s", nm, ps) == 2) { PN.push_back(nm); for (int i = 0; i < NU; i++) { int d = (i < (int)strlen(ps)) ? ps[i] - '0' : 2; PAT.push_back((unsigned char)(d == 3 ? 3 : 2)); } } if (f) fclose(f); }
  int nc = (mode == 4 || mode == 5) ? (int)PN.size() * NK : NCASE;
  fin = fopen(argv[1], "rb"); if (!fin || rdi() != 0x42504331) { fprintf(stderr, "bad room.bin\n"); return 1; }
  std::vector<unsigned short> acos = rdv<unsigned short>(); HostRoom hr = read_room(); fclose(fin);
  std::vector<float> sp; std::vector<unsigned> sb; { FILE *f = fopen(argv[2], "r"); char a[64], b[64];
    while (f && fscanf(f, "%63s %63s%*[^\n]", a, b) == 2) { unsigned xb = (unsigned)strtoul(a, 0, 0), zb = (unsigned)strtoul(b, 0, 0); sb.push_back(xb); sb.push_back(zb); sp.push_back(fbits(xb)); sp.push_back(fbits(zb)); } if (f) fclose(f); }
  int ns = (int)sp.size() / 2; FILE *fo = fopen(argv[3], "w"), *fp = fopen(argv[4], "w");
  fprintf(fp, "spots %d, cases per spot %d, yaw %.3f, patterns %zu\n", ns, nc, yaw, PN.size()); fflush(fp);
  auto t0 = std::chrono::steady_clock::now();
  CK(cudaDeviceSetLimit(cudaLimitStackSize, 32768)); CK(cudaMemcpyToSymbol(G_MODE, &mode, sizeof(int)));
  fprintf(fp, "mode %s\n", mode == 1 ? "all 3-VI updates" : mode == 2 ? "all 2-VI updates" : mode == 3 ? "3-VI for the first N updates (case f<N>, N = 0..33), then 2-VI" : mode == 4 ? "recorded patterns from file" : mode == 5 ? "drop from rest at h = 80..960 above the spot, recorded patterns" : "alternation + single flips"); fflush(fp);
  Room R = dev_room(hr); const unsigned short *dA = up(acos); const float *dS = up(sp);
  float *dO; unsigned char *dOk; CK(cudaMalloc(&dO, ns * 4 * sizeof(float))); CK(cudaMalloc(&dOk, ns * 2));
  k_origin<<<(ns * 2 + 63) / 64, 64>>>(R, dA, dS, ns, yaw, dO, dOk); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
  std::vector<float> O(ns * 4); std::vector<unsigned char> Ok(ns * 2); CK(cudaMemcpy(O.data(), dO, ns * 16, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(Ok.data(), dOk, ns * 2, cudaMemcpyDeviceToHost));
  int nok = 0; for (int i = 0; i < ns * 2; i++) nok += Ok[i];
  fprintf(fp, "standing spots found: %d of %d (spot x phase), %.0f s\n", nok, ns * 2, std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count()); fflush(fp);
  const int CH = 4000; float *dM; CK(cudaMalloc(&dM, (size_t)CH * nc * 4)); std::vector<float> M((size_t)CH * nc);
  unsigned char *dP = 0; if (PAT.size()) { CK(cudaMalloc(&dP, PAT.size())); CK(cudaMemcpy(dP, PAT.data(), PAT.size(), cudaMemcpyHostToDevice)); } else CK(cudaMalloc(&dP, 1));
  long long nclipCases = 0; int nclipSpots = 0;
  for (int s0 = 0; s0 < ns; s0 += CH) { int n = ns - s0 < CH ? ns - s0 : CH; long long nt = (long long)n * nc;
    k_run<<<(unsigned)((nt + 127) / 128), 128>>>(R, dA, dO + s0 * 4, dOk + s0 * 2, n, yaw, dM, dP, nc, dS + s0 * 2); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
    CK(cudaMemcpy(M.data(), dM, nt * 4, cudaMemcpyDeviceToHost));
    for (int s = 0; s < n; s++) { int si = s0 + s; std::vector<int> cl; for (int c = 0; c < nc; c++) if (M[(size_t)s * nc + c] < -300) cl.push_back(c);
      if (cl.empty()) continue; nclipSpots++; nclipCases += cl.size();
      fprintf(fo, "%d %08x %08x x %.7f z %.7f | clips %zu |", si, sb[2 * si], sb[2 * si + 1], sp[2 * si], sp[2 * si + 1], cl.size());
      for (int c : cl) { int K = c % NK + 1, cc = c / NK, flip = cc % NF, ph = cc / NF; if (mode == 4) fprintf(fo, " %s_K%d", PN[cc].c_str(), K); else if (mode == 5) fprintf(fo, " %s_H%d", PN[cc].c_str(), 80 * K); else fprintf(fo, " %c%s%d_K%d", ph ? 'B' : 'A', flip ? "f" : "", flip, K); }
      for (int ph = 0; ph < 2; ph++) if (Ok[2 * si + ph]) fprintf(fo, " | stand%c %.7f %.7f", ph ? 'B' : 'A', O[4 * si + 2 * ph], O[4 * si + 2 * ph + 1]);
      fprintf(fo, "\n"); }
    fflush(fo);
    fprintf(fp, "%d/%d spots, %d with a clip, %lld clipping cases, %.0f s\n", s0 + n, ns, nclipSpots, nclipCases, std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count()); fflush(fp); }
  fprintf(fp, "DONE\n"); fclose(fp); fclose(fo); return 0;
}
