// padscan.cu -- GPU scan for no-lag floor-crack clips from pads (reference: tools/padscan_ref.js, same float steps).
//  drop: Banjo falls from rest at height h above the crack spot (gravity -2700, terminal -4000) -- a shock-pad jump past its apex;
//        heights h = HMIN + k*HSTEP, k < NH.
//  bomb: beak bomb, BA_PHYSICS_UNK8 (pos += vel*dt, no gravity) at 4200 along a direction from dirs.txt, the line passing
//        through the crack spot; start 3+phase steps back up the line, phase = k/NP.
// A case clips when Banjo gets more than 150 under the crack's floor. Build with -DBK_RATE=50 (PAL dt 0.04) or 60 (NTSC).
// usage: padscan room.bin spots.txt dirs.txt out.txt progress.txt   (spots: "xbits ybits zbits" hex; dirs: "dxbits dybits dzbits" hex)
// env: PS_HMIN PS_HSTEP PS_NH PS_NP (defaults 60 0.5 1300 64)
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
static FILE *fin;
static int rdi() { int v; if (fread(&v, 4, 1, fin) != 1) { fprintf(stderr, "short read\n"); exit(1); } return v; }
template <class T> static std::vector<T> rdv() { int n = rdi(); std::vector<T> v(n); if (n && fread(v.data(), sizeof(T), n, fin) != (size_t)n) { fprintf(stderr, "short read\n"); exit(1); } return v; }
struct HostRoom { std::vector<float> TF, CLF, PF, RF; std::vector<int> TI, CLI, CELLS, PI, PC, GR; };
static HostRoom read_room() { HostRoom r; r.TF = rdv<float>(); r.TI = rdv<int>(); r.CLI = rdv<int>(); r.CLF = rdv<float>(); r.CELLS = rdv<int>(); r.PF = rdv<float>(); r.PI = rdv<int>(); r.PC = rdv<int>(); r.GR = rdv<int>(); r.RF = rdv<float>(); return r; }
#ifdef __CUDACC__
template <class T> static const T *up(const std::vector<T> &v) { T *p; size_t n = v.size() ? v.size() : 1; CK(cudaMalloc(&p, n * sizeof(T))); if (v.size()) CK(cudaMemcpy(p, v.data(), v.size() * sizeof(T), cudaMemcpyHostToDevice)); return p; }
#endif
static inline float fb(unsigned u) { union { unsigned u; float f; } c; c.u = u; return c.f; }

// returns 1 = clip; *minY = lowest feet height reached (relative to the floor), *upd = updates run
HD static int run(const Room &R, const unsigned short *A, float *pos, float *vel, float grav, float term, float dt, int maxU, float floorY, int stopOnGround, float *minY) {
  Tracker tr; tracker_init(&tr, pos); World w; w.has_stored = 0; int grounded = 0, hold = 0; float m = pos[1];
  for (int u = 0; u < maxU; u++) {
    if (absf(vel[0]) < 0.0001f) vel[0] = 0; if (absf(vel[2]) < 0.0001f) vel[2] = 0;
    if (grav != 0) { float g = dt * grav; vel[1] = vel[1] + g; if (vel[1] < term) vel[1] = term; }
    float a0 = vel[0] * dt, a1 = vel[1] * dt, a2 = vel[2] * dt; float tgt[3] = { pos[0] + a0, pos[1] + a1, pos[2] + a2 };
    Pred r; predict(R, A, &w, pos, tgt, grounded, hold, &tr, &r);
    pos[0] = r.result[0]; pos[1] = r.result[1]; pos[2] = r.result[2]; grounded = r.grounded; hold = r.hold_counter_after;
    if (grounded && vel[1] < 0 && grav != 0) vel[1] = -1.0f;
    if (pos[1] < m) m = pos[1];
    if (pos[1] < floorY - 150.0f) { *minY = m - floorY; return 1; }
    if (grounded && (stopOnGround || pos[1] > floorY - 5.0f)) { *minY = m - floorY; return 0; }
  }
  *minY = m - floorY; return 0;
}
#ifdef __CUDACC__
__global__
#endif
void k_drop(Room R, const unsigned short *A, const float *SP, int ns, float hmin, float hstep, int nh, float dt, unsigned char *out, int t0n) {
#ifdef __CUDACC__
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= (long long)ns * nh) return;
#else
  for (long long t = 0; t < (long long)t0n; t++) {
#endif
  int s = (int)(t / nh), k = (int)(t % nh); float cx = SP[3 * s], cy = SP[3 * s + 1], cz = SP[3 * s + 2];
  float h = (float)((double)hmin + (double)k * (double)hstep); float pos[3] = { cx, cy + h, cz }, vel[3] = { 0, 0, 0 }; float my;
  out[t] = (unsigned char)run(R, A, pos, vel, -2700.0f, -4000.0f, dt, 80, cy, 0, &my);
#ifndef __CUDACC__
  }
#endif
}
#ifdef __CUDACC__
__global__
#endif
void k_bomb(Room R, const unsigned short *A, const float *SP, int ns, const float *D, int nd, int np, float dt, unsigned char *out, int t0n) {
#ifdef __CUDACC__
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= (long long)ns * nd * np) return;
#else
  for (long long t = 0; t < (long long)t0n; t++) {
#endif
  int s = (int)(t / ((long long)nd * np)); int rem = (int)(t % ((long long)nd * np)); int d = rem / np, k = rem % np;
  float c[3] = { SP[3 * s], SP[3 * s + 1], SP[3 * s + 2] }; float vel[3], step[3], pos[3];
  float back = (float)(3.0 + (double)k / (double)np);
  for (int i = 0; i < 3; i++) { vel[i] = D[3 * d + i] * 4200.0f; step[i] = vel[i] * dt; float sb = step[i] * back; pos[i] = c[i] - sb; }
  float my; out[t] = (unsigned char)run(R, A, pos, vel, 0.0f, 0.0f, dt, 12, c[1], 1, &my);
#ifndef __CUDACC__
  }
#endif
}
int main(int argc, char **argv) {
  if (argc < 6) { fprintf(stderr, "usage: padscan room.bin spots.txt dirs.txt out.txt progress.txt [cpuN]\n"); return 1; }
  float hmin = getenv("PS_HMIN") ? (float)atof(getenv("PS_HMIN")) : 60.0f, hstep = getenv("PS_HSTEP") ? (float)atof(getenv("PS_HSTEP")) : 0.5f;
  int nh = getenv("PS_NH") ? atoi(getenv("PS_NH")) : 1300, np = getenv("PS_NP") ? atoi(getenv("PS_NP")) : 64;
  float dt = (float)(2.0 / BK_RATE);
  fin = fopen(argv[1], "rb"); if (!fin || rdi() != 0x42504331) { fprintf(stderr, "bad room.bin\n"); return 1; }
  std::vector<unsigned short> acos = rdv<unsigned short>(); HostRoom hr = read_room(); fclose(fin);
  std::vector<float> sp, dd; { FILE *f = fopen(argv[2], "r"); char a[64], b[64], c[64]; while (f && fscanf(f, "%63s %63s %63s%*[^\n]", a, b, c) == 3) { sp.push_back(fb(strtoul(a, 0, 16))); sp.push_back(fb(strtoul(b, 0, 16))); sp.push_back(fb(strtoul(c, 0, 16))); } if (f) fclose(f); }
  { FILE *f = fopen(argv[3], "r"); char a[64], b[64], c[64]; while (f && fscanf(f, "%63s %63s %63s%*[^\n]", a, b, c) == 3) { dd.push_back(fb(strtoul(a, 0, 16))); dd.push_back(fb(strtoul(b, 0, 16))); dd.push_back(fb(strtoul(c, 0, 16))); } if (f) fclose(f); }
  int ns = (int)sp.size() / 3, nd = (int)dd.size() / 3; FILE *fo = fopen(argv[4], "w"), *fp = fopen(argv[5], "w");
  fprintf(fp, "rate %d dt %.9g spots %d drop heights %d (%.2f + k*%.3f) bomb dirs %d phases %d\n", BK_RATE, dt, ns, nh, hmin, hstep, nd, np); fflush(fp);
  auto T0 = std::chrono::steady_clock::now();
#ifdef __CUDACC__
  if (argc > 6) { fprintf(stderr, "cpu mode needs the g++ build\n"); return 1; }
  CK(cudaDeviceSetLimit(cudaLimitStackSize, 16384));
  Room R; R.TF = up(hr.TF); R.TI = up(hr.TI); R.CLI = up(hr.CLI); R.CLF = up(hr.CLF); R.CELLS = up(hr.CELLS); R.PF = up(hr.PF); R.PI = up(hr.PI); R.PC = up(hr.PC); R.GR = up(hr.GR); R.RF = up(hr.RF);
  const unsigned short *dA = up(acos); const float *dD = up(dd);
  const int CH = 256; unsigned char *dOut; size_t per = (size_t)nh > (size_t)nd * np ? (size_t)nh : (size_t)nd * np; CK(cudaMalloc(&dOut, CH * per)); std::vector<unsigned char> O(CH * per);
  long long totD = 0, totB = 0; int spD = 0, spB = 0;
  for (int s0 = 0; s0 < ns; s0 += CH) { int n = ns - s0 < CH ? ns - s0 : CH; std::vector<float> sub(sp.begin() + 3 * s0, sp.begin() + 3 * (s0 + n)); const float *dS = up(sub);
    long long nt = (long long)n * nh; std::vector<int> cd(n, 0); std::vector<int> fd(n, -1); std::vector<std::vector<int>> hl(n);
    if (nh) { k_drop<<<(unsigned)((nt + 127) / 128), 128>>>(R, dA, dS, n, hmin, hstep, nh, dt, dOut, 0); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
      CK(cudaMemcpy(O.data(), dOut, nt, cudaMemcpyDeviceToHost));
      for (int s = 0; s < n; s++) for (int k = 0; k < nh; k++) if (O[(size_t)s * nh + k]) { cd[s]++; if (fd[s] < 0) fd[s] = k; if (hl[s].size() < 64) hl[s].push_back(k); } }
    std::vector<std::vector<int>> bl(n);
    std::vector<int> cb(n, 0), fbk(n, -1);
    if (nd) { nt = (long long)n * nd * np; k_bomb<<<(unsigned)((nt + 127) / 128), 128>>>(R, dA, dS, n, dD, nd, np, dt, dOut, 0); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
      CK(cudaMemcpy(O.data(), dOut, nt, cudaMemcpyDeviceToHost));
      for (int s = 0; s < n; s++) for (int c = 0; c < nd * np; c++) if (O[(size_t)s * nd * np + c]) { cb[s]++; if (fbk[s] < 0) fbk[s] = c; if (bl[s].size() < 64) bl[s].push_back(c); } }
    for (int s = 0; s < n; s++) { int si = s0 + s; totD += cd[s]; totB += cb[s]; spD += cd[s] > 0; spB += cb[s] > 0;
      if (cd[s] || cb[s]) { fprintf(fo, "%d %.7f %.4f %.7f drop %d", si, sp[3 * si], sp[3 * si + 1], sp[3 * si + 2], cd[s]);
        if (cd[s]) { fprintf(fo, " h"); for (int k : hl[s]) fprintf(fo, " %d", k); }
        fprintf(fo, " bomb %d", cb[s]); if (cb[s]) { fprintf(fo, " c"); for (int c : bl[s]) fprintf(fo, " %d", c); } fprintf(fo, "\n"); } }
    cudaFree((void *)dS); fflush(fo);
    fprintf(fp, "%d/%d spots | drop: %d spots, %lld cases | bomb: %d spots, %lld cases | %.0f s\n", s0 + n, ns, spD, totD, spB, totB, std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count()); fflush(fp); }
#else
  // CPU check: first N cases of each kernel, printed one per line (compare with padscan_ref.js check)
  int N = argc > 6 ? atoi(argv[6]) : 100; Room R; R.TF = hr.TF.data(); R.TI = hr.TI.data(); R.CLI = hr.CLI.data(); R.CLF = hr.CLF.data(); R.CELLS = hr.CELLS.data(); R.PF = hr.PF.data(); R.PI = hr.PI.data(); R.PC = hr.PC.data(); R.GR = hr.GR.data(); R.RF = hr.RF.data();
  for (int t = 0; t < N && t < ns * nh; t++) { int s = t / nh, k = t % nh; float cy = sp[3 * s + 1]; float h = (float)((double)hmin + (double)k * (double)hstep);
    float pos[3] = { sp[3 * s], cy + h, sp[3 * s + 2] }, vel[3] = { 0, 0, 0 }, my; int c = run(R, acos.data(), pos, vel, -2700.0f, -4000.0f, dt, 80, cy, 0, &my);
    fprintf(fo, "D %d %d %d %08x %08x %08x\n", s, k, c, fbits(pos[0]), fbits(pos[1]), fbits(pos[2])); }
  for (int t = 0; t < N && t < ns * nd * np; t++) { int s = t / (nd * np), rem = t % (nd * np), d = rem / np, k = rem % np; float c3[3] = { sp[3 * s], sp[3 * s + 1], sp[3 * s + 2] }, vel[3], step[3], pos[3];
    float back = (float)(3.0 + (double)k / (double)np); for (int i = 0; i < 3; i++) { vel[i] = dd[3 * d + i] * 4200.0f; step[i] = vel[i] * dt; float sb = step[i] * back; pos[i] = c3[i] - sb; }
    float my; int c = run(R, acos.data(), pos, vel, 0.0f, 0.0f, dt, 12, c3[1], 1, &my); fprintf(fo, "B %d %d %d %d %08x %08x %08x\n", s, d, k, c, fbits(pos[0]), fbits(pos[1]), fbits(pos[2])); }
#endif
  fprintf(fp, "DONE\n"); fclose(fp); fclose(fo); return 0;
}
