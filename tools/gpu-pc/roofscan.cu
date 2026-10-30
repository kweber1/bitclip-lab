// roofscan.cu -- roof (ceiling) crack census + roof clip test on the GPU; reference tools/roof_ref.js (same float steps).
// usage: roofscan room.bin seams.txt out.txt progress.txt [cpuN]
//   seams.txt: "ax ay az bx by bz nybits seamid" per ceiling seam (ints, ny = f32 bits hex of the smaller |unit normal y|)
// env: RS_STEPS (samples per seam, default 20000), RS_NP (clip phases, default 16). Build -DBK_RATE=50 (PAL) / 60 (NTSC).
// out: one line per roof crack: seamid xbits ybits zbits clearbits beeClips flyClips
//   clearbits: 1 below r35, 2 below r25, 4 below r45, 8 above r35, 16 above r25, 32 above r45
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <chrono>
#include "bkcol_port.h"
#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA %s at %s:%d\n", cudaGetErrorString(e_), __FILE__, __LINE__); exit(1); } } while (0)
#ifndef BK_RATE
#define BK_RATE 50
#endif
#define FILT 0x5E0000u
static FILE *fin;
static int rdi() { int v; if (fread(&v, 4, 1, fin) != 1) { fprintf(stderr, "short read\n"); exit(1); } return v; }
template <class T> static std::vector<T> rdv() { int n = rdi(); std::vector<T> v(n); if (n && fread(v.data(), sizeof(T), n, fin) != (size_t)n) { fprintf(stderr, "short read\n"); exit(1); } return v; }
struct HostRoom { std::vector<float> TF, CLF, PF, RF; std::vector<int> TI, CLI, CELLS, PI, PC, GR; };
static HostRoom read_room() { HostRoom r; r.TF = rdv<float>(); r.TI = rdv<int>(); r.CLI = rdv<int>(); r.CLF = rdv<float>(); r.CELLS = rdv<int>(); r.PF = rdv<float>(); r.PI = rdv<int>(); r.PC = rdv<int>(); r.GR = rdv<int>(); r.RF = rdv<float>(); return r; }
#ifdef __CUDACC__
template <class T> static const T *up(const std::vector<T> &v) { T *p; size_t n = v.size() ? v.size() : 1; CK(cudaMalloc(&p, n * sizeof(T))); if (v.size()) CK(cudaMemcpy(p, v.data(), v.size() * sizeof(T), cudaMemcpyHostToDevice)); return p; }
#endif
static inline float fb(unsigned u) { union { unsigned u; float f; } c; c.u = u; return c.f; }
struct Seam { int a[3], b[3]; float ny; int id; };

// census of sample k of seam S: returns 0 = no crack, else 64 | clear bits; p = the sample point
HD static int census(const Room &R, const Seam &S, int steps, int k, float *p) {
  double t = (double)k / (double)steps; for (int j = 0; j < 3; j++) p[j] = (float)((double)S.a[j] + (double)(S.b[j] - S.a[j]) * t);
  float x = p[0], y = p[1], z = p[2]; World w; float n[3];
  { w.has_stored = 0; float a[3] = { x, y - 60.0f, z }, b[3] = { x, y + 140.0f, z }; if (bk_line(R, &w, a, b, n, FILT) >= 0) return 0; }
  double dx = (double)(S.b[0] - S.a[0]), dz = (double)(S.b[2] - S.a[2]); double L = sqrt(dx * dx + dz * dz); double px = dz / L, pz = -dx / L;
  for (int sg = -1; sg <= 1; sg += 2) { float xx = (float)((double)x + sg * 0.01 * px), zz = (float)((double)z + sg * 0.01 * pz);
    w.has_stored = 0; float a[3] = { xx, y - 60.0f, zz }, b[3] = { xx, y + 140.0f, zz }; if (bk_line(R, &w, a, b, n, FILT) < 0) return 0; }
  int bits = 64; const float rs[3] = { 35.0f, 25.0f, 45.0f };
  for (int up_ = 0; up_ < 2; up_++) for (int i = 0; i < 3; i++) { float q = (float)((double)rs[i] / (double)S.ny); q = q + 1.0f;
    float c[3] = { x, up_ ? y + q : y - q, z }; w.has_stored = 0; if (bk_sphere(R, &w, c, rs[i], n, FILT) < 0) bits |= 1 << (up_ * 3 + i); }
  return bits; }
// roof clip: mode 0 = bee (h 50, r 25, normal updates), 1 = Banjo flying (h 60, r 45, first update long); phase k of np
HD static int clip(const Room &R, const unsigned short *A, const float *p, int mode, int k, int np) {
  float h = mode ? 60.0f : 50.0f, r = mode ? 45.0f : 25.0f, v = 1600.0f; float dtN = (float)(2.0 / BK_RATE), dtL = BK_RATE == 60 ? 0.05f : 0.06f;
  float dt0 = mode ? dtL : dtN; float mv = v * dt0; float s = mv * (float)((k + 0.5) / np);
  float pos[3] = { p[0], (p[1] - s) - h, p[2] }; Tracker tr; tracker_init(&tr, pos); World w; w.has_stored = 0; int g = 0, hold = 0;
  for (int u = 0; u < 7; u++) { float dt = u == 0 ? dt0 : dtN; float tgt[3] = { pos[0], pos[1] + v * dt, pos[2] }; Pred o; predict_hr(R, A, &w, pos, tgt, g, hold, &tr, &o, h, r);
    pos[0] = o.result[0]; pos[1] = o.result[1]; pos[2] = o.result[2]; g = o.grounded; hold = o.hold_counter_after; }
  return pos[1] > p[1] + 10.0f ? 1 : 0; }
#ifdef __CUDACC__
__global__ void k_census(Room R, const Seam *SS, int ns, int steps, long long base, long long n, int *out, float *pts) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= n) return; long long g = base + t; int s = (int)(g / (steps + 1)), k = (int)(g % (steps + 1));
  float p[3]; out[t] = census(R, SS[s], steps, k, p); pts[3 * t] = p[0]; pts[3 * t + 1] = p[1]; pts[3 * t + 2] = p[2]; }
__global__ void k_clip(Room R, const unsigned short *A, const float *P, int nc, int np, unsigned char *out) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= (long long)nc * 2 * np) return; int c = (int)(t / (2 * np)), rem = (int)(t % (2 * np));
  out[t] = (unsigned char)clip(R, A, P + 3 * c, rem / np, rem % np, np); }
#endif
int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: roofscan room.bin seams.txt out.txt progress.txt [cpuN]\n"); return 1; }
  int steps = getenv("RS_STEPS") ? atoi(getenv("RS_STEPS")) : 20000, np = getenv("RS_NP") ? atoi(getenv("RS_NP")) : 16;
  fin = fopen(argv[1], "rb"); if (!fin || rdi() != 0x42504331) { fprintf(stderr, "bad room.bin\n"); return 1; }
  std::vector<unsigned short> acos = rdv<unsigned short>(); HostRoom hr = read_room(); fclose(fin);
  std::vector<Seam> SS; { FILE *f = fopen(argv[2], "r"); Seam s; char nyb[64]; while (f && fscanf(f, "%d %d %d %d %d %d %63s %d", &s.a[0], &s.a[1], &s.a[2], &s.b[0], &s.b[1], &s.b[2], nyb, &s.id) == 8) { s.ny = fb(strtoul(nyb, 0, 16)); SS.push_back(s); } if (f) fclose(f); }
  int ns = (int)SS.size(); FILE *fo = fopen(argv[3], "w"), *fp = fopen(argv[4], "w");
  fprintf(fp, "rate %d seams %d steps %d phases %d\n", BK_RATE, ns, steps, np); fflush(fp); auto T0 = std::chrono::steady_clock::now();
  std::vector<int> cs; std::vector<float> cp; std::vector<int> cseam;
#ifdef __CUDACC__
  Room R; R.TF = up(hr.TF); R.TI = up(hr.TI); R.CLI = up(hr.CLI); R.CLF = up(hr.CLF); R.CELLS = up(hr.CELLS); R.PF = up(hr.PF); R.PI = up(hr.PI); R.PC = up(hr.PC); R.GR = up(hr.GR); R.RF = up(hr.RF);
  const unsigned short *dA = up(acos); const Seam *dS = up(SS);
  long long total = (long long)ns * (steps + 1); const long long CH = 1 << 22; int *dO; float *dP; CK(cudaMalloc(&dO, CH * 4)); CK(cudaMalloc(&dP, CH * 12)); std::vector<int> O(CH); std::vector<float> PP(CH * 3);
  for (long long b = 0; b < total; b += CH) { long long n = total - b < CH ? total - b : CH; k_census<<<(unsigned)((n + 127) / 128), 128>>>(R, dS, ns, steps, b, n, dO, dP); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
    CK(cudaMemcpy(O.data(), dO, n * 4, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(PP.data(), dP, n * 12, cudaMemcpyDeviceToHost));
    for (long long i = 0; i < n; i++) if (O[i]) { cs.push_back(O[i]); cp.push_back(PP[3 * i]); cp.push_back(PP[3 * i + 1]); cp.push_back(PP[3 * i + 2]); cseam.push_back(SS[(b + i) / (steps + 1)].id); } }
  // dedupe identical points (seam samples can land on the same floats)
  fprintf(fp, "census done: %zu roof crack samples, %.0f s\n", cs.size(), std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count()); fflush(fp);
  int nc = (int)cs.size(); std::vector<unsigned char> C((size_t)nc * 2 * np);
  if (nc) { const float *dCP = up(cp); unsigned char *dC; CK(cudaMalloc(&dC, C.size())); long long n = (long long)nc * 2 * np; k_clip<<<(unsigned)((n + 127) / 128), 128>>>(R, dA, dCP, nc, np, dC); CK(cudaGetLastError()); CK(cudaDeviceSynchronize()); CK(cudaMemcpy(C.data(), dC, C.size(), cudaMemcpyDeviceToHost)); }
#else
  long long N = argc > 5 ? atoll(argv[5]) : 100000; Room R; R.TF = hr.TF.data(); R.TI = hr.TI.data(); R.CLI = hr.CLI.data(); R.CLF = hr.CLF.data(); R.CELLS = hr.CELLS.data(); R.PF = hr.PF.data(); R.PI = hr.PI.data(); R.PC = hr.PC.data(); R.GR = hr.GR.data(); R.RF = hr.RF.data();
  for (long long g = 0; g < (long long)ns * (steps + 1) && g < N; g++) { int s = (int)(g / (steps + 1)), k = (int)(g % (steps + 1)); float p[3]; int c = census(R, SS[s], steps, k, p); if (c) { cs.push_back(c); cp.push_back(p[0]); cp.push_back(p[1]); cp.push_back(p[2]); cseam.push_back(SS[s].id); } }
  int nc = (int)cs.size(); std::vector<unsigned char> C((size_t)nc * 2 * np); for (int c = 0; c < nc; c++) for (int m = 0; m < 2; m++) for (int k = 0; k < np; k++) C[(size_t)c * 2 * np + m * np + k] = (unsigned char)clip(R, acos.data(), &cp[3 * c], m, k, np);
#endif
  long long nb = 0, nf = 0;
  for (int c = 0; c < nc; c++) { int b = 0, f = 0; for (int k = 0; k < np; k++) { b += C[(size_t)c * 2 * np + k]; f += C[(size_t)c * 2 * np + np + k]; } nb += b > 0; nf += f > 0;
    fprintf(fo, "%d %08x %08x %08x %d %d %d\n", cseam[c], fbits(cp[3 * c]), fbits(cp[3 * c + 1]), fbits(cp[3 * c + 2]), cs[c] & 63, b, f); }
  fprintf(fp, "roof cracks %d, bee clip at %lld, flying Banjo (long update) clip at %lld, %.0f s\nDONE\n", nc, nb, nf, std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count());
  fclose(fp); fclose(fo); return 0; }
