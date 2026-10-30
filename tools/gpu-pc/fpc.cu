// fpc.cu -- FP lobby shelf -> clip route search (GPU), using the bkmove port (bkmove_port.h).
// Start: Banjo standing on the y 891 shelf where the shock-pad jump leaves him (recording 20261029-190134).
// Travel move = first-person twirl k steps (k = -50..50, 3.6 deg each) + punch / barge tap / barge held, then wait to a full stop.
// Final move   = twirl kf, punch cancel (B, A on update c held h), Z (Beak Buster) on update z; success = Banjo falls through the
//                891 floor and lands on the tunnel floor (y < 50) behind the FP door.
// usage: fpc <room.bin> <holes.txt> <depth> <out.txt> [--cpu] [--test]
//   room.bin from pack.js (only the room part is used); holes.txt: "x z" per line (clip points above the tunnel)
// Build: nvcc -O3 -arch=sm_89 -fmad=false -prec-div=true -prec-sqrt=true -ftz=false -o fpc.exe fpc.cu
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <chrono>
#include "bkmove_port.h"

#ifdef __CUDACC__
#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA %s at %s:%d\n", cudaGetErrorString(e_), __FILE__, __LINE__); exit(1); } } while (0)
#endif
#define NK 101           // twirl -50..50
#define NM 3             // punch, barge tap, barge held
#define NCHILD (NK * NM)
#define NFIN (NK * 2 * 4 * 6) // twirl x A-on(1,2) x hold(3,6,9,12) x Z(6 timings)

static FILE *fin;
static int rdi() { int v; if (fread(&v, 4, 1, fin) != 1) { fprintf(stderr, "short read\n"); exit(1); } return v; }
template <class T> static std::vector<T> rdv() { int n = rdi(); std::vector<T> v(n); if (n && fread(v.data(), sizeof(T), n, fin) != (size_t)n) { fprintf(stderr, "short read\n"); exit(1); } return v; }
struct HostRoom { std::vector<float> TF, CLF, PF, RF; std::vector<int> TI, CLI, CELLS, PI, PC, GR; };
static HostRoom read_room() { HostRoom r; r.TF = rdv<float>(); r.TI = rdv<int>(); r.CLI = rdv<int>(); r.CLF = rdv<float>(); r.CELLS = rdv<int>(); r.PF = rdv<float>(); r.PI = rdv<int>(); r.PC = rdv<int>(); r.GR = rdv<int>(); r.RF = rdv<float>(); return r; }
template <class T> static const T *hp(const std::vector<T> &v) { static T dummy[1]; return v.size() ? v.data() : dummy; }
static Room host_room(const HostRoom &h) { Room r; r.TF = hp(h.TF); r.TI = hp(h.TI); r.CLI = hp(h.CLI); r.CLF = hp(h.CLF); r.CELLS = hp(h.CELLS); r.PF = hp(h.PF); r.PI = hp(h.PI); r.PC = hp(h.PC); r.GR = hp(h.GR); r.RF = hp(h.RF); return r; }
#ifdef __CUDACC__
template <class T> static const T *up(const std::vector<T> &v) { T *p; size_t n = v.size() ? v.size() : 1; CK(cudaMalloc(&p, n * sizeof(T))); if (v.size()) CK(cudaMemcpy(p, v.data(), v.size() * sizeof(T), cudaMemcpyHostToDevice)); return p; }
static Room dev_room(const HostRoom &h) { Room r; r.TF = up(h.TF); r.TI = up(h.TI); r.CLI = up(h.CLI); r.CLF = up(h.CLF); r.CELLS = up(h.CELLS); r.PF = up(h.PF); r.PI = up(h.PI); r.PC = up(h.PC); r.GR = up(h.GR); r.RF = up(h.RF); return r; }
#endif

static HD int settle(const Room &R, const unsigned short *A, Player &P) {
  int still = 0; Inp none = { 0, 0, 0 };
  for (int i = 0; i < 900; i++) { float p0 = P.pos[0], p1 = P.pos[1], p2 = P.pos[2]; pl_step(R, A, P, none, 2);
    if (P.bad) return 0;
    if (p0 == P.pos[0] && p1 == P.pos[1] && p2 == P.pos[2] && P.state == S_IDLE) still++; else still = 0;
    if (still >= 5) return P.pos[1] > 800; }
  return 0;
}
// travel move j = (k, m): twirl, then punch (B 1 update) / barge tap (Z 10, B on 5..6) / barge held (Z 30, B on 5..24), wait to a stop
static HD int travel(const Room &R, const unsigned short *A, Player &P, int j) {
  int k = j / NM - 50, m = j % NM; if (k) pl_fpTwirl(P, k);
  for (int i = 0; i < 40; i++) { Inp in = { 0, 0, 0 };
    if (m == 0) in.B = i < 1; else if (m == 1) { in.Z = i < 10; in.B = i >= 5 && i < 7; } else { in.Z = i < 30; in.B = i >= 5 && i < 25; }
    pl_step(R, A, P, in, 2); if (P.bad) return 0; }
  return settle(R, A, P);
}
static HD void finParams(int f, int &k, int &c, int &h, int &z) {
  const int HS[4] = { 3, 6, 9, 12 }; int zi = f % 6; f /= 6; h = HS[f % 4]; f /= 4; c = 1 + f % 2; f /= 2; k = f - 50;
  z = c + 2 + zi * 2; // Z on updates c+2 .. c+12
}
// final move; returns 1 and the landing position when Banjo goes through the 891 floor and lands below y 50
static HD int finalTry(const Room &R, const unsigned short *A, Player P, int f, float *land) {
  int k, c, h, z; finParams(f, k, c, h, z); if (k) pl_fpTwirl(P, k);
  for (int i = 0; i < 45; i++) { Inp in = { i >= c && i < c + h, i == 0, i == z }; pl_step(R, A, P, in, 2); if (P.bad) return 0;
    if (P.pos[1] < 891.0f - 115.0f) { Inp none = { 0, 0, 0 };
      for (int j = 0; j < 120; j++) { pl_step(R, A, P, none, 2); if (P.grounded) break; }
      if (P.grounded && P.pos[1] < 50) { land[0] = P.pos[0]; land[1] = P.pos[1]; land[2] = P.pos[2]; return 1; } return 0; } }
  return 0;
}
static HD int nearHole(const float *H, int nh, const float *p, float r) {
  for (int i = 0; i < nh; i++) { float dx = H[2 * i] - p[0], dz = H[2 * i + 1] - p[2]; if (dx * dx + dz * dz < r * r) return 1; } return 0;
}
#ifdef __CUDACC__
__global__ void k_expand(Room R, const unsigned short *A, const Player *par, long long npar, Player *kids, unsigned char *ok, const float *H, int nh) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= npar * NCHILD) return;
  Player P = par[t / NCHILD]; int j = (int)(t % NCHILD);
  int r = travel(R, A, P, j); kids[t] = P; ok[t] = r ? (nearHole(H, nh, P.pos, 4.0f) ? 2 : 1) : 0;
}
struct FHit { int kid, f; float land[3]; };
__global__ void k_final(Room R, const unsigned short *A, const Player *kids, const int *list, long long nl, FHit *hits, unsigned int *nhits) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= nl * NFIN) return;
  int kid = list[t / NFIN]; int f = (int)(t % NFIN); float land[3];
  if (finalTry(R, A, kids[kid], f, land)) { unsigned int q = atomicAdd(nhits, 1u); if (q < 4096) { hits[q].kid = kid; hits[q].f = f; hits[q].land[0] = land[0]; hits[q].land[1] = land[1]; hits[q].land[2] = land[2]; } }
}
#endif

int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: fpc room.bin holes.txt depth out.txt [--cpu] [--test]\n"); return 1; }
  int depth = atoi(argv[3]); int cpu = 0, test = 0; for (int i = 5; i < argc; i++) { if (!strcmp(argv[i], "--cpu")) cpu = 1; if (!strcmp(argv[i], "--test")) test = 1; }
  fin = fopen(argv[1], "rb"); if (!fin || rdi() != 0x42504331) { fprintf(stderr, "bad room.bin\n"); return 1; }
  std::vector<unsigned short> acos = rdv<unsigned short>(); HostRoom hr = read_room(); fclose(fin);
  std::vector<float> H; { FILE *fh = fopen(argv[2], "r"); float x, z; while (fh && fscanf(fh, "%f %f", &x, &z) == 2) { H.push_back(x); H.push_back(z); } if (fh) fclose(fh); }
  int nh = (int)H.size() / 2; fprintf(stderr, "holes %d depth %d\n", nh, depth);
  FILE *fo = fopen(argv[4], "w");
  Room Rh = host_room(hr); Player Pst; pl_init(Rh, acos.data(), Pst, 0x6F, 4368.150391f, 891.0f, 7161.559082f, 72.910614f);
  if (!settle(Rh, acos.data(), Pst)) { fprintf(stderr, "start does not settle\n"); return 1; }
  if (test) { // print the rest spot after each travel move from the start (compare with the JS engine)
    for (int j = 0; j < NCHILD; j += 7) { Player P = Pst; int r = travel(Rh, acos.data(), P, j);
      fprintf(fo, "%d %d %.6f %.6f %.6f %.6f %d\n", j / NM - 50, j % NM, P.pos[0], P.pos[1], P.pos[2], P.yaw, r); }
    fclose(fo); return 0; }
  auto t0 = std::chrono::steady_clock::now(); unsigned long long tot = 0, totNear = 0, totHits = 0;
#ifdef __CUDACC__
  if (!cpu) {
    CK(cudaDeviceSetLimit(cudaLimitStackSize, 32768));
    Room R = dev_room(hr); const unsigned short *dA = up(acos); const float *dH = up(H);
    std::vector<Player> level(1, Pst); std::vector<std::vector<int>> paths(1);
    const long long CH = 20000; // parents per kernel launch
    for (int d = 1; d <= depth; d++) {
      std::vector<Player> next; std::vector<std::vector<int>> npaths;
      for (long long b = 0; b < (long long)level.size(); b += CH) {
        long long np = std::min(CH, (long long)level.size() - b); long long nk = np * NCHILD;
        Player *dp, *dk; unsigned char *dok; CK(cudaMalloc(&dp, np * sizeof(Player))); CK(cudaMalloc(&dk, nk * sizeof(Player))); CK(cudaMalloc(&dok, nk));
        CK(cudaMemcpy(dp, level.data() + b, np * sizeof(Player), cudaMemcpyHostToDevice));
        k_expand<<<(unsigned)((nk + 127) / 128), 128>>>(R, dA, dp, np, dk, dok, dH, nh); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
        std::vector<unsigned char> ok(nk); CK(cudaMemcpy(ok.data(), dok, nk, cudaMemcpyDeviceToHost));
        std::vector<int> list; for (long long i = 0; i < nk; i++) if (ok[i] == 2) list.push_back((int)i);
        tot += nk; totNear += list.size();
        if (list.size()) { // finals for the children near a hole
          int *dl; FHit *dh; unsigned int *dn; CK(cudaMalloc(&dl, list.size() * 4)); CK(cudaMalloc(&dh, 4096 * sizeof(FHit))); CK(cudaMalloc(&dn, 4)); CK(cudaMemset(dn, 0, 4));
          CK(cudaMemcpy(dl, list.data(), list.size() * 4, cudaMemcpyHostToDevice));
          long long nt = (long long)list.size() * NFIN;
          for (long long s = 0; s < nt; s += (1LL << 24)) { /* one launch covers all; split only for the grid size */ }
          k_final<<<(unsigned)((nt + 127) / 128), 128>>>(R, dA, dk, dl, (long long)list.size(), dh, dn); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
          unsigned int nhit; CK(cudaMemcpy(&nhit, dn, 4, cudaMemcpyDeviceToHost));
          if (nhit) { std::vector<FHit> hh(nhit > 4096 ? 4096 : nhit); CK(cudaMemcpy(hh.data(), dh, hh.size() * sizeof(FHit), cudaMemcpyDeviceToHost));
            std::vector<Player> kk(1);
            for (auto &h : hh) { CK(cudaMemcpy(kk.data(), dk + h.kid, sizeof(Player), cudaMemcpyDeviceToHost)); long long pi = b + h.kid / NCHILD; int j = h.kid % NCHILD;
              int k, c, hd, z; finParams(h.f, k, c, hd, z);
              fprintf(fo, "HIT path"); for (int q : paths[pi]) fprintf(fo, " [%d %d]", q / NM - 50, q % NM); fprintf(fo, " [%d %d]", j / NM - 50, j % NM);
              fprintf(fo, " final twirl %d A+%d hold %d Z %d | rest %.6f %.6f %.6f yaw %.6f | lands %.3f %.3f %.3f\n", k, c, hd, z, kk[0].pos[0], kk[0].pos[1], kk[0].pos[2], kk[0].yaw, h.land[0], h.land[1], h.land[2]); fflush(fo); }
            totHits += nhit; }
          cudaFree(dl); cudaFree(dh); cudaFree(dn);
        }
        if (d < depth) { std::vector<Player> kk(nk); CK(cudaMemcpy(kk.data(), dk, nk * sizeof(Player), cudaMemcpyDeviceToHost));
          for (long long i = 0; i < nk; i++) if (ok[i]) { next.push_back(kk[i]); std::vector<int> pth = paths[b + i / NCHILD]; pth.push_back((int)(i % NCHILD)); npaths.push_back(pth); } }
        cudaFree(dp); cudaFree(dk); cudaFree(dok);
        double el = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        fprintf(stderr, "depth %d: parents %lld/%zu, moves %llu, near a hole %llu, hits %llu, %.0f s\n", d, b + np, level.size(), tot, totNear, totHits, el);
      }
      level.swap(next); paths.swap(npaths);
    }
    fclose(fo); fprintf(stderr, "DONE moves %llu near %llu hits %llu\n", tot, totNear, totHits); return 0;
  }
#endif
  fprintf(stderr, "CPU mode: only --test is supported\n"); fclose(fo); return 0;
}
