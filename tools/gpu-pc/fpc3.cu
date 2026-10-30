// fpc3.cu -- FP lobby shelf -> clip route search, deep, with merging of equal rest spots, face turns and the shelf camera
// (zoom camera node, state 0x11, bkcam_port.h cam11_update; checked against BizHawk). Every move starts with Banjo AND the camera stopped.
// Start: Banjo resting on the y 891 shelf after the shock-pad jump (recording 20261029-190134).
// Travel moves (each from a full stop, then wait to a full stop): first-person twirl k (-50..50) then
//   0 punch | 1 barge tap | 2 barge held | 3 punch cancel A@1 hold 3 | 4 punch cancel A@1 hold 12 | 5 punch cancel A@2 hold 3 | 6 punch cancel A@2 hold 12
// Rest spots are merged by (x, z, yaw mod 3.6): 1-unit cells, 0.25-unit cells within 6 of a crack seam; 10 yaw-phase bins.
// Final (from rests within 3 of a seam): twirl kf, punch cancel (B, A on c held h), Z on z; success = falls through 891, lands below y 50.
// usage: fpc2 <room.bin> <depth> <out.txt> <progress.txt> [maxFrontier]
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdarg.h>
#include <vector>
#include <unordered_set>
#include <algorithm>
#include <chrono>
#include "bkcam_port.h"
struct St { Player P; Cam C; };

#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA %s at %s:%d\n", cudaGetErrorString(e_), __FILE__, __LINE__); exit(1); } } while (0)
#define NK 101
#define NM 11
#define NFACE 8
#define NCHILD (NK * NM + NFACE)
#define NFIN (NK * 2 * 4 * 6)

static FILE *fin;
static int rdi() { int v; if (fread(&v, 4, 1, fin) != 1) { fprintf(stderr, "short read\n"); exit(1); } return v; }
template <class T> static std::vector<T> rdv() { int n = rdi(); std::vector<T> v(n); if (n && fread(v.data(), sizeof(T), n, fin) != (size_t)n) { fprintf(stderr, "short read\n"); exit(1); } return v; }
struct HostRoom { std::vector<float> TF, CLF, PF, RF; std::vector<int> TI, CLI, CELLS, PI, PC, GR; };
static HostRoom read_room() { HostRoom r; r.TF = rdv<float>(); r.TI = rdv<int>(); r.CLI = rdv<int>(); r.CLF = rdv<float>(); r.CELLS = rdv<int>(); r.PF = rdv<float>(); r.PI = rdv<int>(); r.PC = rdv<int>(); r.GR = rdv<int>(); r.RF = rdv<float>(); return r; }
template <class T> static const T *hp(const std::vector<T> &v) { static T dummy[1]; return v.size() ? v.data() : dummy; }
static Room host_room(const HostRoom &h) { Room r; r.TF = hp(h.TF); r.TI = hp(h.TI); r.CLI = hp(h.CLI); r.CLF = hp(h.CLF); r.CELLS = hp(h.CELLS); r.PF = hp(h.PF); r.PI = hp(h.PI); r.PC = hp(h.PC); r.GR = hp(h.GR); r.RF = hp(h.RF); return r; }
template <class T> static const T *up(const std::vector<T> &v) { T *p; size_t n = v.size() ? v.size() : 1; CK(cudaMalloc(&p, n * sizeof(T))); if (v.size()) CK(cudaMemcpy(p, v.data(), v.size() * sizeof(T), cudaMemcpyHostToDevice)); return p; }
static Room dev_room(const HostRoom &h) { Room r; r.TF = up(h.TF); r.TI = up(h.TI); r.CLI = up(h.CLI); r.CLF = up(h.CLF); r.CELLS = up(h.CELLS); r.PF = up(h.PF); r.PI = up(h.PI); r.PC = up(h.PC); r.GR = up(h.GR); r.RF = up(h.RF); return r; }

// every shared edge of the flat y 891 floor above the tunnel (13 seams)
#define NSEG 13
__constant__ float SEG[NSEG][4] = { { 4411.0f, 6182.0f, 4694.0f, 6274.0f }, { 4694.0f, 6274.0f, 4877.0f, 5709.0f }, { 4411.0f, 6182.0f, 4877.0f, 5709.0f }, { 4595.0f, 5617.0f, 4877.0f, 5709.0f }, { 4411.0f, 6182.0f, 4595.0f, 5617.0f }, { 4877.0f, 5709.0f, 4969.0f, 5427.0f }, { 4687.0f, 5335.0f, 4969.0f, 5427.0f }, { 4687.0f, 5335.0f, 4877.0f, 5709.0f }, { 4595.0f, 5617.0f, 4687.0f, 5335.0f }, { 4404.0f, 5243.0f, 4595.0f, 5617.0f }, { 4319.0f, 6465.0f, 4602.0f, 6557.0f }, { 4319.0f, 6465.0f, 4411.0f, 6182.0f }, { 4319.0f, 6465.0f, 4694.0f, 6274.0f } };
static const float SEGH[NSEG][4] = { { 4411.0f, 6182.0f, 4694.0f, 6274.0f }, { 4694.0f, 6274.0f, 4877.0f, 5709.0f }, { 4411.0f, 6182.0f, 4877.0f, 5709.0f }, { 4595.0f, 5617.0f, 4877.0f, 5709.0f }, { 4411.0f, 6182.0f, 4595.0f, 5617.0f }, { 4877.0f, 5709.0f, 4969.0f, 5427.0f }, { 4687.0f, 5335.0f, 4969.0f, 5427.0f }, { 4687.0f, 5335.0f, 4877.0f, 5709.0f }, { 4595.0f, 5617.0f, 4687.0f, 5335.0f }, { 4404.0f, 5243.0f, 4595.0f, 5617.0f }, { 4319.0f, 6465.0f, 4602.0f, 6557.0f }, { 4319.0f, 6465.0f, 4411.0f, 6182.0f }, { 4319.0f, 6465.0f, 4694.0f, 6274.0f } };
HD static float segDist(const float S[NSEG][4], float x, float z) {
  float best = 1e30f;
  for (int i = 0; i < NSEG; i++) { float ax = S[i][0], az = S[i][1], dx = S[i][2] - ax, dz = S[i][3] - az;
    float t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : (t > 1 ? 1 : t);
    float ex = ax + t * dx - x, ez = az + t * dz - z; float d = sqrtf(ex * ex + ez * ez); if (d < best) best = d; }
  return best;
}

static HD void stepS(const Room &R, const unsigned short *A, St &S, Inp in) { S.P.cam = S.C.rot[1]; pl_step(R, A, S.P, in, 2); cam11_update(A, S.C, S.P, 2); }
// wait until Banjo has stopped (position, IDLE, facing reached) and then the camera has stopped too
static HD int settle(const Room &R, const unsigned short *A, St &S) {
  int still = 0; Inp none = { 0, 0, 0, 0, 0 }; int i = 0;
  for (; i < 1200; i++) { float p0 = S.P.pos[0], p1 = S.P.pos[1], p2 = S.P.pos[2]; stepS(R, A, S, none);
    if (S.P.bad) return 0;
    if (p0 == S.P.pos[0] && p1 == S.P.pos[1] && p2 == S.P.pos[2] && S.P.state == S_IDLE && S.P.yaw == S.P.ideal) still++; else still = 0;
    if (still >= 5) break; }
  if (still < 5 || !(S.P.pos[1] > 800)) return 0;
  still = 0;
  for (; i < 2400; i++) { float c0 = S.C.pos[0], c1 = S.C.pos[1], c2 = S.C.pos[2], r0 = S.C.rot[0], r1 = S.C.rot[1]; stepS(R, A, S, none);
    if (S.P.bad) return 0;
    if (c0 == S.C.pos[0] && c1 == S.C.pos[1] && c2 == S.C.pos[2] && r0 == S.C.rot[0] && r1 == S.C.rot[1]) still++; else still = 0;
    if (still >= 10) return 1; }
  return 0;
}
// travel moves (twirl first, then):
//  0 punch | 1-4 punch cancel (A on update 1/2, A held 3/12 updates)
//  5 barge tap, Z held 10 | 6 barge tap, Z held 40 | 7 barge holding Z and B down a long time (B 40 updates)
//  8-10 punch, then hold Z (from update 1 / 4 / 10)
static HD void moveInp(int m, int i, Inp &in) {
  in.A = 0; in.B = 0; in.Z = 0;
  switch (m) {
    case 0: in.B = i < 1; break;
    case 1: in.B = i == 0; in.A = i >= 1 && i < 4; break;
    case 2: in.B = i == 0; in.A = i >= 1 && i < 13; break;
    case 3: in.B = i == 0; in.A = i >= 2 && i < 5; break;
    case 4: in.B = i == 0; in.A = i >= 2 && i < 14; break;
    case 5: in.Z = i < 10; in.B = i >= 5 && i < 7; break;
    case 6: in.Z = i < 40; in.B = i >= 5 && i < 7; break;
    case 7: in.Z = i < 50; in.B = i >= 5 && i < 45; break;
    case 8: in.B = i == 0; in.Z = i >= 1 && i < 40; break;
    case 9: in.B = i == 0; in.Z = i >= 4 && i < 40; break;
    case 10: in.B = i == 0; in.Z = i >= 10 && i < 40; break;
  }
}
// face turn d (0..7 = up, up-right, right, down-right, down, down-left, left, up-left; full stick): Z 2 updates, Z + stick 10, Z 3, let go
__constant__ int FACE_D[8][2] = { { 0, 127 }, { 127, 127 }, { 127, 0 }, { 127, -127 }, { 0, -127 }, { -127, -127 }, { -127, 0 }, { -127, 127 } };
static const int FACE_H[8][2] = { { 0, 127 }, { 127, 127 }, { 127, 0 }, { 127, -127 }, { 0, -127 }, { -127, -127 }, { -127, 0 }, { -127, 127 } };
static const char *FACE_N[8] = { "up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left" };
static HD int travel(const Room &R, const unsigned short *A, St &S, int j) {
  if (j >= NK * NM) { int d = j - NK * NM;
#ifdef __CUDA_ARCH__
    int sx = FACE_D[d][0], sy = FACE_D[d][1];
#else
    int sx = FACE_H[d][0], sy = FACE_H[d][1];
#endif
    for (int i = 0; i < 15; i++) { Inp in = { 0, 0, 1, (i >= 2 && i < 12) ? sx : 0, (i >= 2 && i < 12) ? sy : 0 }; stepS(R, A, S, in); if (S.P.bad) return 0; }
    return settle(R, A, S); }
  int k = j / NM - 50, m = j % NM; if (k) pl_fpTwirl(S.P, k);
  for (int i = 0; i < 70; i++) { Inp in; in.sx = 0; in.sy = 0; moveInp(m, i, in); stepS(R, A, S, in); if (S.P.bad) return 0; }
  return settle(R, A, S);
}
static HD void finParams(int f, int &k, int &c, int &h, int &z) {
  const int HS[4] = { 3, 6, 9, 12 }; int zi = f % 6; f /= 6; h = HS[f % 4]; f /= 4; c = 1 + f % 2; f /= 2; k = f - 50;
  z = c + 2 + zi * 2;
}
static HD int finalTry(const Room &R, const unsigned short *A, Player P, int f, float *land) {
  P.cam = 0;
  int k, c, h, z; finParams(f, k, c, h, z); if (k) pl_fpTwirl(P, k);
  for (int i = 0; i < 45; i++) { Inp in = { i >= c && i < c + h, i == 0, i == z, 0, 0 }; pl_step(R, A, P, in, 2); if (P.bad) return 0;
    if (P.pos[1] < 891.0f - 115.0f) { Inp none = { 0, 0, 0, 0, 0 };
      for (int j = 0; j < 120; j++) { pl_step(R, A, P, none, 2); if (P.grounded) break; }
      if (P.grounded && P.pos[1] < 50) { land[0] = P.pos[0]; land[1] = P.pos[1]; land[2] = P.pos[2]; return 1; } return 0; } }
  return 0;
}
HD static unsigned long long keyOf(const float *S4, float x, float z, float yaw, float sd) {
  float q = sd < 6.0f ? 4.0f : 1.0f;   // cells per unit
  long long qx = (long long)floorf(x * q), qz = (long long)floorf(z * q);
  float ph = fmodf(yaw, 3.6f); if (ph < 0) ph += 3.6f; int pb = (int)(ph / 0.36f); if (pb > 9) pb = 9;
  return ((unsigned long long)(qx & 0xFFFFF) << 40) ^ ((unsigned long long)(qz & 0xFFFFF) << 20) ^ ((unsigned long long)pb << 4) ^ (q > 2 ? 1ull : 0ull);
}
__global__ void k_expand(Room R, const unsigned short *A, const St *par, long long npar, St *kids, unsigned char *ok, unsigned long long *key, float *sd) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= npar * NCHILD) return;
  St S = par[t / NCHILD]; int j = (int)(t % NCHILD);
  int r = travel(R, A, S, j); kids[t] = S; ok[t] = r;
  if (r) { float d = segDist(SEG, S.P.pos[0], S.P.pos[2]); sd[t] = d; key[t] = keyOf(0, S.P.pos[0], S.P.pos[2], S.P.yaw, d); }
}
__global__ void k_gather(const St *kids, const long long *idx, long long n, St *out) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t < n) out[t] = kids[idx[t]];
}
struct FHit { int s, f; float land[3]; };
__global__ void k_final(Room R, const unsigned short *A, const St *st, long long ns, FHit *hits, unsigned int *nhits) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= ns * NFIN) return;
  int s = (int)(t / NFIN); int f = (int)(t % NFIN); float land[3];
  if (finalTry(R, A, st[s].P, f, land)) { unsigned int q = atomicAdd(nhits, 1u); if (q < 4096) { hits[q].s = s; hits[q].f = f; hits[q].land[0] = land[0]; hits[q].land[1] = land[1]; hits[q].land[2] = land[2]; } }
}

static std::vector<int> gParent, gMove;   // per state id
static FILE *fo, *fp;
static void say(const char *fmt, ...) { va_list a; va_start(a, fmt); vfprintf(fp, fmt, a); va_end(a); fflush(fp); }

int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage: fpc2 room.bin depth out.txt progress.txt [maxFrontier]\n"); return 1; }
  int depth = atoi(argv[2]); long long maxF = argc > 5 ? atoll(argv[5]) : 3000000;
  fin = fopen(argv[1], "rb"); if (!fin || rdi() != 0x42504331) { fprintf(stderr, "bad room.bin\n"); return 1; }
  std::vector<unsigned short> acos = rdv<unsigned short>(); HostRoom hr = read_room(); fclose(fin);
  fo = fopen(argv[3], "w"); fp = fopen(argv[4], "w");
  Room Rh = host_room(hr); St Pst; memset(&Pst, 0, sizeof Pst); pl_init(Rh, acos.data(), Pst.P, 0x6F, 4368.150391f, 891.0f, 7161.559082f, 72.910614f);
  { Cam &C = Pst.C; C.pos[0] = 3412.20458984375f; C.pos[1] = 1101.94140625f; C.pos[2] = 6867.93115234375f; C.rot[0] = 352.5479431152344f; C.rot[1] = 252.92703247070312f; C.rot[2] = 0;
    C.D9C8[0] = 6.713867605867563e-06f; C.D9C8[1] = -3.3569338029337814e-06f; C.D9E0[0] = 0.00010822456533787772f; C.D9E0[1] = 0; C.D9E0[2] = 0.00013955251779407263f;
    C.D9EC = 1.75f; C.D9F0 = 3.75f; C.D9D4 = 2.75f; C.D9D8 = 12.0f; }
  if (!settle(Rh, acos.data(), Pst)) { say("start does not settle\n"); return 1; }
  say("start %.6f %.6f %.6f yaw %.6f, seam dist %.1f, depth %d, max frontier %lld, sizeof(St) %d\n", Pst.P.pos[0], Pst.P.pos[1], Pst.P.pos[2], Pst.P.yaw, segDist(SEGH, Pst.P.pos[0], Pst.P.pos[2]), depth, maxF, (int)sizeof(St));
  auto t0 = std::chrono::steady_clock::now();
  CK(cudaDeviceSetLimit(cudaLimitStackSize, 32768));
  Room R = dev_room(hr); const unsigned short *dA = up(acos);
  std::unordered_set<unsigned long long> seen; seen.reserve(1 << 24);
  seen.insert(keyOf(0, Pst.P.pos[0], Pst.P.pos[2], Pst.P.yaw, segDist(SEGH, Pst.P.pos[0], Pst.P.pos[2])));
  std::vector<St> level(1, Pst); std::vector<int> levelId(1, 0); gParent.push_back(-1); gMove.push_back(-1);
  const long long CH = 2000;
  St *dp, *dk, *dg; unsigned char *dok; unsigned long long *dkey; float *dsd; long long *didx;
  CK(cudaMalloc(&dp, CH * sizeof(St))); CK(cudaMalloc(&dk, CH * NCHILD * sizeof(St))); CK(cudaMalloc(&dok, CH * NCHILD));
  CK(cudaMalloc(&dkey, CH * NCHILD * 8)); CK(cudaMalloc(&dsd, CH * NCHILD * 4)); CK(cudaMalloc(&didx, CH * NCHILD * 8)); CK(cudaMalloc(&dg, CH * NCHILD * sizeof(St)));
  FHit *dh; unsigned int *dn; CK(cudaMalloc(&dh, 4096 * sizeof(FHit))); CK(cudaMalloc(&dn, 4));
  unsigned long long tot = 0, totFin = 0, totHits = 0;
  std::vector<unsigned char> ok(CH * NCHILD); std::vector<unsigned long long> key(CH * NCHILD); std::vector<float> sd(CH * NCHILD);
  for (int d = 1; d <= depth && level.size(); d++) {
    std::vector<St> next; std::vector<int> nextId; std::vector<float> nextSd;
    for (long long b = 0; b < (long long)level.size(); b += CH) {
      { FILE *st = fopen("fpc2.stop", "r"); if (st) { fclose(st); say("stopped (fpc2.stop)\n"); fclose(fo); fclose(fp); return 0; } }
      long long np = std::min(CH, (long long)level.size() - b), nk = np * NCHILD;
      CK(cudaMemcpy(dp, level.data() + b, np * sizeof(St), cudaMemcpyHostToDevice));
      k_expand<<<(unsigned)((nk + 127) / 128), 128>>>(R, dA, dp, np, dk, dok, dkey, dsd); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
      CK(cudaMemcpy(ok.data(), dok, nk, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(key.data(), dkey, nk * 8, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(sd.data(), dsd, nk * 4, cudaMemcpyDeviceToHost));
      std::vector<long long> sel; for (long long i = 0; i < nk; i++) if (ok[i] && seen.insert(key[i]).second) sel.push_back(i);
      tot += nk;
      if (sel.size()) {
        CK(cudaMemcpy(didx, sel.data(), sel.size() * 8, cudaMemcpyHostToDevice));
        k_gather<<<(unsigned)((sel.size() + 127) / 128), 128>>>(dk, didx, (long long)sel.size(), dg); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
        std::vector<St> got(sel.size()); CK(cudaMemcpy(got.data(), dg, sel.size() * sizeof(St), cudaMemcpyDeviceToHost));
        std::vector<long long> nearI;   // indices in got near a seam
        for (size_t q = 0; q < sel.size(); q++) { long long i = sel[q]; int id = (int)gParent.size(); gParent.push_back(levelId[b + i / NCHILD]); gMove.push_back((int)(i % NCHILD));
          next.push_back(got[q]); nextId.push_back(id); nextSd.push_back(sd[i]); if (sd[i] <= 3.0f) nearI.push_back((long long)q); }
        // finals for the new rests near a seam (in chunks)
        for (size_t s0 = 0; s0 < nearI.size(); s0 += 2000) {
          size_t ns = std::min((size_t)2000, nearI.size() - s0); std::vector<St> fs(ns); for (size_t q = 0; q < ns; q++) fs[q] = got[nearI[s0 + q]];
          CK(cudaMemcpy(dp, fs.data(), ns * sizeof(St), cudaMemcpyHostToDevice)); CK(cudaMemset(dn, 0, 4));
          long long nt = (long long)ns * NFIN; k_final<<<(unsigned)((nt + 127) / 128), 128>>>(R, dA, dp, (long long)ns, dh, dn); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
          totFin += ns; unsigned int nhit; CK(cudaMemcpy(&nhit, dn, 4, cudaMemcpyDeviceToHost));
          if (nhit) { std::vector<FHit> hh(nhit > 4096 ? 4096 : nhit); CK(cudaMemcpy(hh.data(), dh, hh.size() * sizeof(FHit), cudaMemcpyDeviceToHost));
            for (auto &h : hh) { const Player &P = fs[h.s].P; int id = nextId[nextId.size() - got.size() + nearI[s0 + h.s]];
              std::vector<int> path; for (int x = id; gParent[x] >= 0; x = gParent[x]) path.push_back(gMove[x]); std::reverse(path.begin(), path.end());
              int k, c, hd, z; finParams(h.f, k, c, hd, z);
              fprintf(fo, "HIT depth %d path", d); for (int mv : path) { if (mv >= NK * NM) fprintf(fo, " [face %s]", FACE_N[mv - NK * NM]); else fprintf(fo, " [%d %d]", mv / NM - 50, mv % NM); }
              fprintf(fo, " final twirl %d A+%d hold %d Z %d | rest %.6f %.6f %.6f yaw %.6f | lands %.3f %.3f %.3f\n", k, c, hd, z, P.pos[0], P.pos[1], P.pos[2], P.yaw, h.land[0], h.land[1], h.land[2]); fflush(fo); }
            totHits += nhit; }
        }
      }
      if ((long long)next.size() > 2 * maxF) { // trim during the level to bound memory
        std::vector<int> ord(next.size()); for (size_t i = 0; i < ord.size(); i++) ord[i] = (int)i;
        std::nth_element(ord.begin(), ord.begin() + maxF, ord.end(), [&](int a, int b) { return nextSd[a] < nextSd[b]; });
        ord.resize(maxF); std::vector<St> n2; std::vector<int> i2; std::vector<float> s2; for (int i : ord) { n2.push_back(next[i]); i2.push_back(nextId[i]); s2.push_back(nextSd[i]); }
        next.swap(n2); nextId.swap(i2); nextSd.swap(s2); }
      double el = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      say("depth %d: parents %lld/%zu, moves %llu, new rests %zu, finals run on %llu rests, hits %llu, %.0f s\n", d, b + np, level.size(), tot, next.size(), totFin, totHits, el);
    }
    if ((long long)next.size() > maxF) { // keep the rests closest to a seam
      std::vector<int> ord(next.size()); for (size_t i = 0; i < ord.size(); i++) ord[i] = (int)i;
      std::nth_element(ord.begin(), ord.begin() + maxF, ord.end(), [&](int a, int b) { return nextSd[a] < nextSd[b]; });
      ord.resize(maxF); std::vector<St> n2; std::vector<int> i2; for (int i : ord) { n2.push_back(next[i]); i2.push_back(nextId[i]); }
      next.swap(n2); nextId.swap(i2); say("depth %d: frontier cut to the %lld rests closest to a seam\n", d, maxF); }
    level.swap(next); levelId.swap(nextId);
    say("depth %d done: frontier %zu, distinct rests so far %zu, hits %llu\n", d, level.size(), seen.size(), totHits);
  }
  fclose(fo); say("DONE moves %llu finals-rests %llu hits %llu\n", tot, totFin, totHits); fclose(fp); return 0;
}
