// bkpc.cu -- GPU (CUDA) standing punch-cancel clip search for one room. Port of bkclipsetup.js solve() + bkmove.js + bkcol.js.
// usage: bkpc <job.bin> <out.txt> [--clips] [--cpu N]  (--clips: write only clips, not holds)
// was: bkpc <job.bin> <out.txt> [--cpu N]  (--cpu: run the first N cases on the CPU instead, for checking)
// Build: nvcc -O3 -arch=sm_89 -fmad=false -prec-div=true -prec-sqrt=true -ftz=false -o bkpc.exe bkpc.cu
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <chrono>
#include "bkpc_search.h"

#ifdef __CUDACC__
#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA %s at %s:%d\n", cudaGetErrorString(e_), __FILE__, __LINE__); exit(1); } } while (0)
#endif

struct Blob { std::vector<char> d; };
static FILE *fin;
static int rdi() { int v; if (fread(&v, 4, 1, fin) != 1) { fprintf(stderr, "short read\n"); exit(1); } return v; }
template <class T> static std::vector<T> rdv() { int n = rdi(); std::vector<T> v(n); if (n && fread(v.data(), sizeof(T), n, fin) != (size_t)n) { fprintf(stderr, "short read\n"); exit(1); } return v; }
struct HostRoom { std::vector<float> TF, CLF, PF, RF; std::vector<int> TI, CLI, CELLS, PI, PC, GR; };
static HostRoom read_room() { HostRoom r; r.TF = rdv<float>(); r.TI = rdv<int>(); r.CLI = rdv<int>(); r.CLF = rdv<float>(); r.CELLS = rdv<int>(); r.PF = rdv<float>(); r.PI = rdv<int>(); r.PC = rdv<int>(); r.GR = rdv<int>(); r.RF = rdv<float>(); return r; }
#ifdef __CUDACC__
template <class T> static const T *up(const std::vector<T> &v) { T *p; size_t n = v.size() ? v.size() : 1; CK(cudaMalloc(&p, n * sizeof(T))); if (v.size()) CK(cudaMemcpy(p, v.data(), v.size() * sizeof(T), cudaMemcpyHostToDevice)); return p; }
#endif
template <class T> static const T *hp(const std::vector<T> &v) { static T dummy[1]; return v.size() ? v.data() : dummy; }
#ifdef __CUDACC__
static Room dev_room(const HostRoom &h) { Room r; r.TF = up(h.TF); r.TI = up(h.TI); r.CLI = up(h.CLI); r.CLF = up(h.CLF); r.CELLS = up(h.CELLS); r.PF = up(h.PF); r.PI = up(h.PI); r.PC = up(h.PC); r.GR = up(h.GR); r.RF = up(h.RF); return r; }
#endif
static Room host_room(const HostRoom &h) { Room r; r.TF = hp(h.TF); r.TI = hp(h.TI); r.CLI = hp(h.CLI); r.CLF = hp(h.CLF); r.CELLS = hp(h.CELLS); r.PF = hp(h.PF); r.PI = hp(h.PI); r.PC = hp(h.PC); r.GR = hp(h.GR); r.RF = hp(h.RF); return r; }

struct Rooms8 { Room r[8]; };
struct Case { int s, yi, pi, qi; };
static HD inline Case decode(long long id, const Job &J) { Case c; c.qi = (int)(id % J.npat); id /= J.npat; c.pi = (int)(id % J.nparam); id /= J.nparam; c.yi = (int)(id % J.nyaw); id /= J.nyaw; c.s = (int)id; return c; }

#ifdef __CUDACC__
__global__ void k_search(Room RR, Rooms8 FR, const unsigned short *ACOS, Job J, const double *spots, const float *yaws, const int *params, const int *pats,
                         long long first, long long n, Hit *hits, unsigned int *nhits, unsigned int maxhits, unsigned int *nbad) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= n) return; long long id = first + t;
  Case c = decode(id, J); Hit h[MAXUPD]; int bad = 0;
  int nh = pc_case(RR, FR.r[(int)spots[c.s * 4 + 3]], ACOS, J, spots[c.s * 4], spots[c.s * 4 + 1], spots[c.s * 4 + 2], yaws[c.yi], params[c.pi * 2], params[c.pi * 2 + 1], pats + c.qi * MAXLAG, h, &bad);
  if (bad) atomicAdd(nbad, 1u);
  for (int q = 0; q < nh; q++) { unsigned int k = atomicAdd(nhits, 1u); if (k < maxhits) { h[q].s = c.s; h[q].yi = c.yi; h[q].pi = c.pi; h[q].qi = c.qi; hits[k] = h[q]; } }
}

#endif
int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: bkpc job.bin out.txt [--cpu N] [--first F]\n"); return 1; }
  long long cpuN = -1, firstArg = 0; int clipsOnly = 0; for (int i = 3; i < argc; i++) { if (!strcmp(argv[i], "--clips")) clipsOnly = 1; if (!strcmp(argv[i], "--cpu") && i + 1 < argc) cpuN = atoll(argv[++i]); else if (!strcmp(argv[i], "--first") && i + 1 < argc) firstArg = atoll(argv[++i]); }
  fin = fopen(argv[1], "rb"); if (!fin) { fprintf(stderr, "cannot open %s\n", argv[1]); return 1; }
  if (rdi() != 0x42504331) { fprintf(stderr, "bad magic\n"); return 1; }
  std::vector<unsigned short> acos = rdv<unsigned short>();
  HostRoom hr = read_room(); int nflat = rdi(); std::vector<HostRoom> hf; for (int i = 0; i < nflat; i++) hf.push_back(read_room());
  Job J; J.maxUpd = rdi(); J.standCheck = rdi();
  std::vector<double> spots = rdv<double>(); std::vector<float> yaws = rdv<float>(); std::vector<int> params = rdv<int>(), pats = rdv<int>();
  fclose(fin);
  J.nspots = (int)(spots.size() / 4); J.nyaw = (int)yaws.size(); J.nparam = (int)(params.size() / 2); J.npat = (int)(pats.size() / MAXLAG);
  long long total = (long long)J.nspots * J.nyaw * J.nparam * J.npat;
  fprintf(stderr, "spots %d yaws %d params %d patterns %d -> %lld cases\n", J.nspots, J.nyaw, J.nparam, J.npat, total);
  FILE *fo = fopen(argv[2], "w"); if (!fo) { fprintf(stderr, "cannot write %s\n", argv[2]); return 1; }
  fprintf(fo, "# s yi pi qi k holds clipAt clip endY x0bits z0bits\n");
  auto t0 = std::chrono::steady_clock::now();
#ifndef __CUDACC__
  if (cpuN < 0) cpuN = total;
#endif
  if (cpuN >= 0) {
    Room R = host_room(hr); Rooms8 FRm; for (int i = 0; i < nflat && i < 8; i++) FRm.r[i] = host_room(hf[i]); long long n = cpuN < total - firstArg ? cpuN : total - firstArg; unsigned nb = 0, nh = 0;
    for (long long id = firstArg; id < firstArg + n; id++) { Case c = decode(id, J); Hit h[MAXUPD]; int bad = 0;
      int k = pc_case(R, FRm.r[(int)spots[c.s * 4 + 3]], acos.data(), J, spots[c.s * 4], spots[c.s * 4 + 1], spots[c.s * 4 + 2], yaws[c.yi], params[c.pi * 2], params[c.pi * 2 + 1], &pats[c.qi * MAXLAG], h, &bad);
      nb += bad; for (int q = 0; q < k; q++) { if (clipsOnly && !h[q].clip) continue; union { float f; unsigned u; } a, b; a.f = h[q].x0; b.f = h[q].z0;
        fprintf(fo, "%d %d %d %d %d %d %d %d %.6f %08X %08X\n", c.s, c.yi, c.pi, c.qi, h[q].k, h[q].holds, h[q].clipAt, h[q].clip, h[q].endY, a.u, b.u); nh++; } }
    double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    fprintf(stderr, "CPU: %lld cases, %u results, %u unsupported, %.1f s\n", n, nh, nb, s); fclose(fo); return 0;
  }
#ifndef __CUDACC__
  return 0;
#else
  CK(cudaDeviceSetLimit(cudaLimitStackSize, 32768));
  Room R = dev_room(hr); Rooms8 FRm; for (int i = 0; i < nflat && i < 8; i++) FRm.r[i] = dev_room(hf[i]); const unsigned short *dA = up(acos);
  const double *dS = up(spots); const float *dY = up(yaws); const int *dP = up(params), *dQ = up(pats);
  const unsigned int MAXH = 1u << 20; Hit *dH; CK(cudaMalloc(&dH, sizeof(Hit) * MAXH)); unsigned int *dN, *dB; CK(cudaMalloc(&dN, 4)); CK(cudaMalloc(&dB, 4));
  std::vector<Hit> hh(MAXH); long long done = firstArg; long long chunk = 1 << 14; unsigned long long totHits = 0, totBad = 0;
  while (done < total) {
    long long n = chunk < total - done ? chunk : total - done; CK(cudaMemset(dN, 0, 4)); CK(cudaMemset(dB, 0, 4));
    auto c0 = std::chrono::steady_clock::now();
    int threads = 128; long long blocks = (n + threads - 1) / threads;
    k_search<<<(unsigned)blocks, threads>>>(R, FRm, dA, J, dS, dY, dP, dQ, done, n, dH, dN, MAXH, dB);
    CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
    double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - c0).count();
    unsigned int nh, nb; CK(cudaMemcpy(&nh, dN, 4, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(&nb, dB, 4, cudaMemcpyDeviceToHost));
    if (nh > MAXH) { fprintf(stderr, "hit buffer overflow (%u)\n", nh); nh = MAXH; }
    if (nh) { CK(cudaMemcpy(hh.data(), dH, sizeof(Hit) * nh, cudaMemcpyDeviceToHost));
      for (unsigned q = 0; q < nh; q++) { const Hit &h = hh[q]; if (clipsOnly && !h.clip) continue; union { float f; unsigned u; } a, b; a.f = h.x0; b.f = h.z0;
        fprintf(fo, "%d %d %d %d %d %d %d %d %.6f %08X %08X\n", h.s, h.yi, h.pi, h.qi, h.k, h.holds, h.clipAt, h.clip, h.endY, a.u, b.u); } fflush(fo); }
    totHits += nh; totBad += nb; done += n;
    double el = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    fprintf(stderr, "%lld / %lld cases (%.1f%%), chunk %lld in %.2f s, results %llu, unsupported %llu, %.0f s elapsed\n", done, total, 100.0 * done / total, n, sec, totHits, totBad, el);
    if (sec < 0.4 && chunk < (1LL << 26)) chunk *= 2; else if (sec > 1.2 && chunk > 1024) chunk /= 2;
  }
  fclose(fo);
  fprintf(stderr, "DONE %llu results, %llu unsupported, %.0f s\n", totHits, totBad, std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count());
#endif
  return 0;
}
