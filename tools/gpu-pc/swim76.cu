// swim76.cu -- GPU search for the 640-room (MAP 0x76) No-Dive buoyancy launch (water switch skip), PAL.
// Surface swim (states 2D/2E) exactly as bkmove.js / the exact swim model (research/exact-swim-model-20261020/src/exact.h):
// stick -> swim speed, one-update yaw lag, BA_PHYSICS_NORMAL (accel 0.15), buoyancy +100/s (min 133.33), water clamp at
// surface - 70, collision + floor/water tracker from bkcol_port.h (d238 taken before the clamp), yaw (500 deg/s, 5/s), and the
// rail camera (dynamic camera 0x12, straight rail along z, look-ahead) that steers the stick.
// A real launch = feet above -98 with VY still > 2000 after the update (exact model, section 3).
//
// usage: swim76 room.bin arrivals.txt sticks.txt out.bin progress.txt [creep_sx creep_sy NK]
//   arrivals.txt: "x0 z0 parity vt" per line (start at rest at feet -445, VY 133.33; charge with stick neutral until VY >= vt,
//                 then creep with the creep stick until the slide (z grows > 1 per update past z -1340))
//   creep 999 999 = hold mode: no creep; state k = k neutral updates after the push, then the stick is held (SW_MAXS updates)
//   sticks.txt:   "sx sy" per line (the pull-back stick; 0 0 = neutral)
//   out:          GPU build: text summary (counts of launches per parity, k, stick over all slid arrivals); CPU build: per arrival: int32 slide flag, float slide VY, int32 parity at the slide, then NK x nsticks bytes (1 = launch),
//                 byte [k*nsticks + j] = switch to stick j k updates after the slide.
// CPU build (g++ -x c++): runs the first arrival list entries on the CPU (same output), for checks against the exact model.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <vector>
#include <chrono>
#include "bkcol_port.h"
#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA %s at %s:%d\n", cudaGetErrorString(e_), __FILE__, __LINE__); exit(1); } } while (0)
static FILE *fin;
static int rdi() { int v; if (fread(&v, 4, 1, fin) != 1) { fprintf(stderr, "short read\n"); exit(1); } return v; }
template <class T> static std::vector<T> rdv() { int n = rdi(); std::vector<T> v(n); if (n && fread(v.data(), sizeof(T), n, fin) != (size_t)n) { fprintf(stderr, "short read\n"); exit(1); } return v; }
struct HostRoom { std::vector<float> TF, CLF, PF, RF; std::vector<int> TI, CLI, CELLS, PI, PC, GR; };
static HostRoom read_room() { HostRoom r; r.TF = rdv<float>(); r.TI = rdv<int>(); r.CLI = rdv<int>(); r.CLF = rdv<float>(); r.CELLS = rdv<int>(); r.PF = rdv<float>(); r.PI = rdv<int>(); r.PC = rdv<int>(); r.GR = rdv<int>(); r.RF = rdv<float>(); return r; }
#ifdef __CUDACC__
template <class T> static T *up(const std::vector<T> &v) { T *p; size_t n = v.size() ? v.size() : 1; CK(cudaMalloc(&p, n * sizeof(T))); if (v.size()) CK(cudaMemcpy(p, v.data(), v.size() * sizeof(T), cudaMemcpyHostToDevice)); return p; }
#endif

#define BAD_DTOR_ (3.141592654 / 180.0)
#ifdef SW_NTSC
#define X_DT ((float)(2 * (1.0 / 60)))   // NTSC: 2 VI per update at 60 Hz, as bkmove dtOf(2)
#else
#define X_DT 0.04f
#endif
#define X_SDT ((float)(X_DT / 0.0333333))
#define X_ACCEL 0.15f
#define X_CAMX 0.0f
#define X_CAMY -500.0f
#ifdef SW_NTSC
#define X_CAMZ0 0xc445db9cu   // NTSC: settled rail camera z under the flat roof (native US 1.0 dump 2026-11-01)
#else
#define X_CAMZ0 0xc42d8d94u
#endif
typedef struct { float S[3], vel[3], yawI, tspeed, cam, camr, pyaw, B[3], camz, camu4, camt; int state, tick, grounded, hold; Tracker tr; World w; } SW;

static HD float x_normax(int in, int mn, int mx) { float unit = 1 / 80.f; if (in > 0) { in = in > mx ? mx : in < mn ? mn : in; in = ((in - mn) * 80) / (mx - mn); } else if (in < 0) { in = in < -mx ? -mx : in > -mn ? -mn : in; in = ((in + mn) * 80) / (mx - mn); } return unit * in; }
static HD float x_norm(float a) { if (a < 0.0) { a = x_norm(-a); a = 360.0 - a; } if (a >= 360.0) a -= 360.0 * (int)(a / 360.0); return a; }
static HD float x_dd(float a, float b) { float d = a - b; while (d > 180) d -= 360; while (d <= -180) d += 360; return d; }
static HD float x_mapf(float val, float in_min, float in_max, float out_min, float out_max) { float r;
  if (in_max != in_min) { if (out_min < out_max) { r = (((val - in_min) / (in_max - in_min)) * (out_max - out_min)) + out_min; if (r > out_max) return out_max; if (r < out_min) return out_min; }
    else { r = (((val - in_min) / (in_max - in_min)) * (out_max - out_min)) + out_min; if (r < out_max) return out_max; if (r > out_min) return out_min; } return r; } return out_max; }
static HD void x_hv(const unsigned short *A, float x1, float y1, float z1, float x2, float y2, float z2, float *o1, float *o2) {
  float dx = x2 - x1, dy = y2 - y1, dz = z2 - z1; float ft2 = dx * dx + dz * dz; float h = sqrtf(ft2);
  if (h > 0.01) { *o2 = ml_acosf(A, dx / h); if (dz < 0) *o2 = 180 - *o2; if (dx < 0) *o2 = 360 - *o2; } else *o2 = 0;
  float dist = sqrtf(dy * dy + ft2); if (dist > 0.01) { *o1 = ml_acosf(A, dy / dist); if (h < 0) *o1 = 180 - *o1; if (dy < 0) *o1 = 360 - *o1; } else *o1 = 0; }

// ---- exact rail camera (ncDynamicCam12, PAL MAP 0x76 tunnel rail: struct56s with 4 points, RDRAM 0x128D30, dumped 2026-11-02).
// x->camt = D_8037DBE0.unk8 (spline parameter, RAM 0x37E5B8), x->camu4 = unk4 (0x37E5B4). camt < 0 = old straight-rail model.
#ifdef __CUDACC__
__constant__ float RAILP[4][3] = { {0.0f, -500.0f, 655.0f}, {0.0f, -500.0f, -698.0f}, {0.0f, -500.0f, -1417.0f}, {0.0f, -500.0f, -2185.0f} };
#endif
static HD const float (*railp())[3] {
#ifdef __CUDA_ARCH__
  return RAILP;
#else
  static const float P[4][3] = { {0.0f, -500.0f, 655.0f}, {0.0f, -500.0f, -698.0f}, {0.0f, -500.0f, -1417.0f}, {0.0f, -500.0f, -2185.0f} }; return P;
#endif
}
// func_80340BE4(x, 4, 3, 3, pts, dst): Catmull-Rom, double coefficients stored to float, single-precision Horner, double final add
static HD void r_eval(float x, float d[3]) {
  const float (*P)[3] = railp(); const int length = 4; int a3; float f3, f1, f2;
  float cx = x < 0.0f ? 0.0f : (1.0f < x ? 1.0f : x); float temp = cx * (float)(length - 1); a3 = (int)temp; if (a3 > length - 1) a3 = length - 1; x = temp - (float)a3;
  if (a3 == 0) { for (int i = 0; i < 3; i++) { const float *p0 = P[0], *p1 = P[1], *p2 = P[2];
      f3 = (float)(-0.5 * p0[i] + 1.5 * p0[i] + -1.5 * p1[i] + 0.5 * p2[i]); f1 = (float)(1.0 * p0[i] + -2.5 * p0[i] + 2.0 * p1[i] + -0.5 * p2[i]); f2 = (float)(-0.5 * p0[i] + 0.0 * p0[i] + 0.5 * p1[i] + 0.0 * p2[i]);
      float h = f3 * x; h = h + f1; h = h * x; h = h + f2; h = h * x; d[i] = (float)(1.0 * p0[i] + (double)h); } return; }
  a3--;
  if (a3 == length - 2) { for (int i = 0; i < 3; i++) d[i] = P[length - 1][i]; return; }
  if (a3 == length - 3) { for (int i = 0; i < 3; i++) { const float *p0 = P[a3], *p1 = P[a3 + 1], *t0 = P[a3 + 2];
      f3 = (float)(-0.5 * p0[i] + 1.5 * p1[i] + -1.5 * t0[i] + 0.5 * t0[i]); f1 = (float)(1.0 * p0[i] + -2.5 * p1[i] + 2.0 * t0[i] + -0.5 * t0[i]); f2 = (float)(-0.5 * p0[i] + 0.0 * p1[i] + 0.5 * t0[i] + 0.0 * t0[i]);
      float h = f3 * x; h = h + f1; h = h * x; h = h + f2; h = h * x; d[i] = (float)(1.0 * p1[i] + (double)h); } return; }
  for (int i = 0; i < 3; i++) { const float *p0 = P[a3], *p1 = P[a3 + 1], *t0 = P[a3 + 2], *p3 = P[a3 + 3];
    f3 = (float)(-0.5 * p0[i] + 1.5 * p1[i] + -1.5 * t0[i] + 0.5 * p3[i]); f1 = (float)(1.0 * p0[i] + -2.5 * p1[i] + 2.0 * t0[i] + -0.5 * p3[i]); f2 = (float)(-0.5 * p0[i] + 0.0 * p1[i] + 0.5 * t0[i] + 0.0 * p3[i]);
    float h = f3 * x; h = h + f1; h = h * x; h = h + f2; h = h * x; d[i] = (float)(1.0 * p1[i] + (double)h); }
}
static HD float r_len(const float a[3], const float b[3]) { float v = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; v = v * v + dy * dy + dz * dz; return v != 0 ? sqrtf(v) : 0.0f; } // ml_vec3f_length
static HD float r_dist(const float a[3], const float b[3]) { float d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2]; return sqrtf(d0 * d0 + d1 * d1 + d2 * d2); } // ml_vec3f_distance
// func_80323A48 (arg4 = 1.0: no loop point): move from t by arc length arg3
static HD float r_move(float arg2, float arg3) {
  float spF4[3], spDC[3]; double spB8, var_f22, var_f24, var_f26 = 0.0, var_f28 = 0.01; int sp94;
  if (arg3 == 0.0f) return arg2;
  if (arg3 < 0.0f) { arg3 = -arg3; var_f28 = -var_f28; }
  spB8 = (double)arg2; r_eval((float)spB8, spF4);
  do {
    var_f24 = spB8 + var_f28;
    if (var_f28 > 0.0) { if (var_f24 >= 1.0) { var_f24 = 1.0; r_eval(1.0f, spDC); var_f22 = var_f26 + r_len(spF4, spDC); } else { r_eval((float)var_f24, spDC); var_f22 = var_f26 + r_len(spF4, spDC); } }
    else { if (var_f24 < 0.0) { var_f24 = 0; r_eval((float)var_f24, spDC); var_f22 = var_f26 + r_len(spF4, spDC); } else { r_eval((float)var_f24, spDC); var_f22 = var_f26 + r_len(spF4, spDC); } }
    float ad = (float)(arg3 - var_f22); if (ad < 0) ad = -ad; sp94 = ad < 0.1;
    if ((var_f22 < arg3) || sp94) { var_f26 = var_f22; spB8 = var_f24; spF4[0] = spDC[0]; spF4[1] = spDC[1]; spF4[2] = spDC[2];
      if (var_f28 > 0.0) { if (spB8 == 1.0) break; } else if (spB8 == 0.0) break; }
    else var_f28 *= 0.5;
    float aq = (float)var_f28; if (aq < 0) aq = -aq; if (!(!sp94 && (1e-7 < aq))) break;
  } while (1);
  return (float)spB8;
}
// func_8032429C
static HD float r_scan(const float p[3], float mn, float mx, float step) {
  float sp68[3]; mn = 0.0f > mn ? 0.0f : mn; mx = 1.0f < mx ? 1.0f : mx; float f24 = 1e+8f, f28 = mn, f20 = mn;
  for (;;) { r_eval(f20, sp68); float a = p[0] - sp68[0], b = p[1] - sp68[1], c = p[2] - sp68[2]; float f2 = a * a + b * b + c * c; if (f2 < f24) { f24 = f2; f28 = f20; }
    if (f20 == mx) break; f20 += step; if (f20 > mx) f20 = mx; }
  return f28; }
// func_803243D0 (no exact control-point match in practice)
static HD float r_closest(const float p[3]) {
  float s = 0.01f; float t = r_scan(p, 0.0f, 1.0f, s);
  for (int i = 0; i < 5; i++) { float lo = t - s, hi = t + s; s = (float)((s / 10.0) * 2); t = r_scan(p, lo, hi, s); }
  float a[3], b[3]; r_eval(t, a); r_eval(1.0f, b);
  float da = (p[0]-a[0])*(p[0]-a[0]) + (p[1]-a[1])*(p[1]-a[1]) + (p[2]-a[2])*(p[2]-a[2]); float db = (p[0]-b[0])*(p[0]-b[0]) + (p[1]-b[1])*(p[1]-b[1]) + (p[2]-b[2])*(p[2]-b[2]);
  return da < db ? t : 1.0f; }
// func_80323540 -> func_803232AC (arc length a..b in 15 steps)
static HD float r_arc(float a, float b) {
  float st = (b - a) / 15.0f; float sp6C[3], sp60[3]; float f22 = 0.0f;
  if ((b - a) < 1e-6) return 0.0f;
  float f20 = a; r_eval(f20, sp6C);
  while (f20 + st < b) { f20 += st; r_eval(f20, sp60); f22 += r_len(sp6C, sp60); sp6C[0] = sp60[0]; sp6C[1] = sp60[1]; sp6C[2] = sp60[2]; }
  r_eval(b, sp60); f22 += r_len(sp6C, sp60); return f22; }
// func_802C11C8 + position: one rail update; target = (Px+B0, Py+60, Pz+B2)
static HD void r_update(SW *x) {
  float tg[3] = { x->S[0] + x->B[0], x->S[1] + 60.0f, x->S[2] + x->B[2] };
  float cp[3]; r_eval(x->camt, cp);
  float t = r_closest(tg), sp30;
  if (t == 0.0f || t == 1.0f) { sp30 = 0.0f; /* end-of-rail branch not needed inside the tunnel */ }
  else sp30 = (t < x->camt) ? r_arc(t, x->camt) : r_arc(x->camt, t);
  float t40 = r_move(x->camt, X_DT * 1000.0f), t3c = r_move(x->camt, X_DT * -1000.0f);
  float p64[3], p58[3]; r_eval(t40, p64); r_eval(t3c, p58);
  float sp48 = r_dist(tg, p64), sp44 = r_dist(tg, p58); float dd = sp48 - sp44; if (dd < 0) dd = -dd;
  if (dd > 3.0f) {
    float sp34 = (sp48 < sp44) ? 1.0f : -1.0f, sp38 = 0.0f;
    if (550.0f < sp30) sp38 = x_mapf(sp30, 550.0f, 650.0f, 0.0f, 1500.0f) * sp34; else if (sp30 < 500.0f) sp38 = x_mapf(sp30, 400.0f, 500.0f, 1500.0f, 0.0f) * -sp34;
    float a28 = x->camu4 < 0 ? -x->camu4 : x->camu4, a38 = sp38 < 0 ? -sp38 : sp38;
    if (a28 < a38) x->camu4 = (float)(x->camu4 + (sp38 - x->camu4) * 0.08); else x->camu4 = sp38;
    x->camt = r_move(x->camt, X_DT * x->camu4);
  }
  r_eval(x->camt, cp); x->camz = cp[2];
}
static HD void x_camupdate(const unsigned short *A, SW *x) {
  float dxp = x->S[0] - X_CAMX, dzp = x->S[2] - x->camz;
  float sp48 = x_mapf(absf((float)(x_norm(x->cam - x->pyaw) - 180.0)), 0.0f, 180.0f, 80.0f, 200.0f);
  float m = x_mapf(sqrtf(dxp * dxp + dzp * dzp), 300.0f, 450.0f, 0.0f, sp48);
  float yr = (float)(x->pyaw * BAD_DTOR_); float tmp = 0 * lib_sinf(0) + lib_cosf(0) * m; float A0 = tmp * lib_sinf(yr) + lib_cosf(yr) * 0, A2 = tmp * lib_cosf(yr) - lib_sinf(yr) * 0;
  float d0 = A0 - x->B[0], d2 = A2 - x->B[2]; d0 *= 0.08f; d2 *= 0.08f; x->B[0] += d0; x->B[2] += d2;
  if (x->camt >= 0.0f) { r_update(x); } else {
  float tz = x->S[2] + x->B[2];
  float sp30 = absf(tz - x->camz); float sp34 = (tz < x->camz) ? 1.0f : -1.0f; float sp38 = 0.0f;
  if (550.0f < sp30) sp38 = x_mapf(sp30, 550.0f, 650.0f, 0.0f, 1500.0f) * sp34; else if (sp30 < 500.0f) sp38 = x_mapf(sp30, 400.0f, 500.0f, 1500.0f, 0.0f) * -sp34;
  if (absf(x->camu4) < absf(sp38)) x->camu4 = (float)(x->camu4 + (sp38 - x->camu4) * 0.08); else x->camu4 = sp38;
  x->camz -= X_DT * x->camu4;
  }
  float t0, t1; x_hv(A, x->S[0], x->S[1] + 60.0f, x->S[2], X_CAMX, X_CAMY, x->camz, &t0, &t1);
  float d1 = x_dd(t1, x->cam); float s1 = d1 * X_DT * 5.0f; float q1 = s1 - x->camr; q1 = (float)(10.0f * (0.0333 * q1)); float R1 = x->camr + q1; float c1 = x->cam;
  if (absf(d1) < absf(R1) && R1 * d1 > 0.0f) { R1 = 0; c1 = t1; }
  x->camr = R1; x->cam = x_norm(c1 + R1);
}
static HD void x_yawupdate(SW *x) {
  float mx = 500.0f * X_DT; float dy = x->yawI - x->pyaw; if (180.0f < absf(dy)) dy += (dy < 0.0f) ? 360.0 : -360.0;
  float v = dy * 5.0f * X_DT; if (v < 0) { if (v < -mx) v = -mx; if (v > -0.1f) v = -0.1f; } else { if (v < 0.1f) v = 0.1f; if (v > mx) v = mx; }
  x->pyaw = (absf(v) <= absf(dy)) ? x->pyaw + v : x->yawI;
  if (x->pyaw < 360.0) { if (x->pyaw < 0.0) x->pyaw += 360.0; } else x->pyaw -= 360.0;
}
static HD void x_start(SW *x, float px, float py, float pz, float vy, int par) {
  memset(x, 0, sizeof *x); x->S[0] = px; x->S[1] = py; x->S[2] = pz; x->vel[1] = vy; union { unsigned u; float f; } c; c.u = X_CAMZ0; x->camz = c.f; x->camt = -1.0f;
  // tracker as the exact model's tracker_init_water: water -50, floor -700, deep-water mode 4
  tracker_init(&x->tr, x->S); x->tr.norm[1] = 1; x->tr.posX = -700.0f; x->tr.posY = -50.0f; x->tr.posZ = 56; x->tr.mode = 4; x->tr.unk59 = 1; x->tr.unk58 = 1; x->tr.unk5C = 1;
  VCP(x->tr.unk1C, x->S); VCP(x->tr.unk28, x->S); x->tr.has28 = 1; x->tick = par; x->w.has_stored = 0;
}
// one game update; returns 1 when the feet end above -98
static HD int x_step(RA, const unsigned short *A, SW *x, int sx, int sy) {
  float fx = x_normax(sx, 7, 59), fy = x_normax(sy, 7, 61); float sd = sqrtf(fx * fx + fy * fy), sang = 0;
  if (sd != 0.0f) { sang = ml_acosf(A, fy / sd); if (fx < 0.0f) sang = (float)(180.0f - sang); if (fy < 0.0f) sang = (float)(360.0f - sang); } if (sd > 1.0) sd = 1.0f;
  int zone; float zpos; if (sd <= 0.03f) { zone = 0; zpos = 0; } else { zone = 1; zpos = (sd - 0.03f) / (1.0f - 0.03f); }
  if (x->state == 0) { if (zone == 1) x->state = 1; } else { x->tspeed = zone == 0 ? 0.0f : zpos * (300.0f - 30.0f) + 30.0f; if (zone == 0) x->state = 2; }
  float tmp = 0 * lib_sinf(0) + lib_cosf(0) * x->tspeed; float v2 = (float)(x->yawI * BAD_DTOR_);
  float sp60[3] = { tmp * lib_sinf(v2) + lib_cosf(v2) * 0, 0, tmp * lib_cosf(v2) - lib_sinf(v2) * 0 };
  if (x->grounded) { float *n = x->tr.norm, u[3]; float l2 = sp60[0] * sp60[0] + sp60[1] * sp60[1] + sp60[2] * sp60[2];
    if (l2 != 0) { float inv = (float)(1.0 / sqrtf(l2)); u[0] = sp60[0] * inv; u[1] = sp60[1] * inv; u[2] = sp60[2] * inv; } else { u[0] = sp60[0]; u[1] = sp60[1]; u[2] = sp60[2]; }
    float dot = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
    if (dot != 0.0f) { float sc; if (dot < 0) { float sp40 = (float)(dot * 0.5); sc = (float)(1.0 + sp40); } else { float sp40 = (float)(dot * 0.2); sc = (float)(sp40 + 1.0); } sp60[0] *= sc; sp60[1] *= sc; sp60[2] *= sc; } }
  float a[3], b[3]; for (int i = 0; i < 3; i++) { a[i] = sp60[i] * X_ACCEL; b[i] = (i == 1 ? 0.0f : x->vel[i]) * X_ACCEL; a[i] = a[i] - b[i]; a[i] = a[i] * X_SDT; }
  x->vel[0] += a[0]; x->vel[1] += a[1]; x->vel[2] += a[2];
  float d[3] = { x->vel[0], 0.0f, x->vel[2] };
  if (absf(x->vel[0]) < 0.0001) x->vel[0] = 0; if (absf(x->vel[2]) < 0.0001) x->vel[2] = 0;
  x->vel[1] = x->vel[1] + X_DT * 100.0f; if (x->vel[1] < 133.33f) x->vel[1] = 133.33f;
  d[1] = d[1] + x->vel[1]; float E[3]; for (int i = 0; i < 3; i++) { d[i] = d[i] * X_DT; E[i] = x->S[i] + d[i]; }
  if (x->state == 1 && sd != 0.0f) x->yawI = x_norm((float)((x->cam + sang) + 90.0));
  x_yawupdate(x);
  float d238[3]; vsub(d238, E, x->S);
  if (x->tr.unk59 && E[1] > x->tr.posY - 70.0f) { E[1] = x->tr.posY - 70.0f; x->vel[1] = 1.0f; }
  x->tr.timer_odd = x->tick & 1; x->tick++;
  Pred r; predict_hrd(RP, A, &x->w, x->S, E, x->grounded, x->hold, &x->tr, &r, 80.0f, 35.0f, d238);
  x->S[0] = r.result[0]; x->S[1] = r.result[1]; x->S[2] = r.result[2]; x->grounded = r.grounded; x->hold = r.hold_counter_after;
  if (x->state == 2) x->state = 0;
  x_camupdate(A, x);
  return x->S[1] > -98.0f;
}
static HD int launched(RA, const unsigned short *A, SW *x, int sx, int sy, int maxs) {
  for (int s = 0; s < maxs; s++) { if (x_step(RP, A, x, sx, sy)) return x->vel[1] > 2000; if (x->vel[1] < 2.0f) return 0; } return 0; }
// arrival: charge neutral to vt, creep to the slide; saves NK states (slide + k)
// SW_FULL mode (FS != 0): arrival line = "state_index W 0 0"; start from full state FS[17*idx] (as SW_TAS: x y z vx vy vz yawI cam tspeed
// pyaw B0 B2 camz camu4 camr state par), then exactly W neutral updates of charge (instead of charging to vt).
static HD int arrive(RA, const unsigned short *A, const float *AR, const float *FS, int i, int cx, int cy, int NK, SW *ks, float *slvy, int *slpar) {
  SW x;
  if (FS) { const float *v = FS + 17 * (int)AR[4 * i]; x_start(&x, v[0], v[1], v[2], v[4], (int)v[16]); x.vel[0] = v[3]; x.vel[2] = v[5]; x.yawI = v[6]; x.cam = v[7]; x.tspeed = v[8];
    x.pyaw = v[9]; x.B[0] = v[10]; x.B[2] = v[11]; if (v[12] >= 0.0f && v[12] <= 1.0f) { x.camt = v[12]; float cp[3]; r_eval(x.camt, cp); x.camz = cp[2]; } else x.camz = v[12]; x.camu4 = v[13]; x.camr = v[14]; x.state = (int)v[15];
    int W = (int)AR[4 * i + 1]; for (int n = 0; n < W; n++) if (x_step(RP, A, &x, 0, 0)) return 0; }
  else { x_start(&x, AR[4 * i], -445.0f, AR[4 * i + 1], 133.33f, (int)AR[4 * i + 2]); float vt = AR[4 * i + 3];
  for (int n = 0; x.vel[1] < vt && n < 6000; n++) if (x_step(RP, A, &x, 0, 0)) return 0; }
  if (x.S[2] > -1300) return 0;
  if (cx == 999) { *slvy = x.vel[1]; *slpar = x.tick & 1; for (int k = 0; k < NK; k++) { ks[k] = x; x_step(RP, A, &x, 0, 0); } return 1; } // hold mode: states at the push (+k neutral updates)
  int sl = 0; for (int s = 0; s < 3000; s++) { float zp = x.S[2]; if (x_step(RP, A, &x, cx, cy)) return 0; if (x.S[2] - zp > 1.0f && x.S[2] > -1340) { sl = 1; break; } }
  if (!sl) return 0; *slvy = x.vel[1]; *slpar = x.tick & 1;
  for (int k = 0; k < NK; k++) { ks[k] = x; x_step(RP, A, &x, cx, cy); }
  return 1;
}
#ifdef __CUDACC__
__global__ void k_arrive(Room R_, const unsigned short *A, const float *AR, const float *FS, int na, int cx, int cy, int NK, SW *KS, int *FL, float *VY, int *PAR) {
  int i = blockIdx.x * blockDim.x + threadIdx.x; if (i >= na) return;
  FL[i] = arrive(R_, A, AR, FS, i, cx, cy, NK, KS + (size_t)i * NK, VY + i, PAR + i); }
__global__ void k_branch(Room R_, const unsigned short *A, const SW *KS, const int *FL, int na, int NK, const int *ST, int ns, unsigned char *O, int maxs) {
  long long t = (long long)blockIdx.x * blockDim.x + threadIdx.x; if (t >= (long long)na * NK * ns) return;
  int i = (int)(t / ((long long)NK * ns)); int rem = (int)(t % ((long long)NK * ns)); int k = rem / ns, j = rem % ns;
  if (!FL[i]) { O[t] = 0; return; } SW x = KS[(size_t)i * NK + k]; O[t] = (unsigned char)launched(R_, A, &x, ST[2 * j], ST[2 * j + 1], maxs); }
#endif
int main(int argc, char **argv) {
  if (argc < 6) { fprintf(stderr, "usage: swim76 room.bin arrivals.txt sticks.txt out.bin progress.txt [cx cy NK] [cpuN]\n"); return 1; }
  int maxs = getenv("SW_MAXS") ? atoi(getenv("SW_MAXS")) : 150; // update limit per branch (hold mode: creep + exit, ~1500)
  int cx = argc > 6 ? atoi(argv[6]) : -70, cy = argc > 7 ? atoi(argv[7]) : -70, NK = argc > 8 ? atoi(argv[8]) : 20;
  fin = fopen(argv[1], "rb"); if (!fin || rdi() != 0x42504331) { fprintf(stderr, "bad room.bin\n"); return 1; }
  std::vector<unsigned short> acos = rdv<unsigned short>(); HostRoom hr = read_room(); fclose(fin);
  std::vector<float> AR; { FILE *f = fopen(argv[2], "r"); float a, b, c, d; while (f && fscanf(f, "%f %f %f %f", &a, &b, &c, &d) == 4) { AR.push_back(a); AR.push_back(b); AR.push_back(c); AR.push_back(d); } if (f) fclose(f); }
  std::vector<float> FSv; if (getenv("SW_FULL")) { FILE *f = fopen(getenv("SW_FULL"), "r"); float v; while (f && fscanf(f, "%f", &v) == 1) FSv.push_back(v); if (f) fclose(f);
    if (FSv.size() % 17) { fprintf(stderr, "SW_FULL: %zu floats, not a multiple of 17\n", FSv.size()); return 1; } }
  std::vector<int> ST; { FILE *f = fopen(argv[3], "r"); int a, b; while (f && fscanf(f, "%d %d", &a, &b) == 2) { ST.push_back(a); ST.push_back(b); } if (f) fclose(f); }
  int na = (int)AR.size() / 4, ns = (int)ST.size() / 2; FILE *fo = fopen(argv[4], "wb"), *fp = fopen(argv[5], "w");
  fprintf(fp, "arrivals %d sticks %d NK %d creep %d,%d\n", na, ns, NK, cx, cy); fflush(fp); auto T0 = std::chrono::steady_clock::now();
  std::vector<int> FLh; std::vector<float> VYh; std::vector<int> PARh; std::vector<unsigned char> Oh;
#ifdef __CUDACC__
  CK(cudaDeviceSetLimit(cudaLimitStackSize, 32768));
  Room R; R.TF = up(hr.TF); R.TI = up(hr.TI); R.CLI = up(hr.CLI); R.CLF = up(hr.CLF); R.CELLS = up(hr.CELLS); R.PF = up(hr.PF); R.PI = up(hr.PI); R.PC = up(hr.PC); R.GR = up(hr.GR); R.RF = up(hr.RF);
  unsigned short *dA = up(acos); int *dST = up(ST); float *dFS = FSv.size() ? up(FSv) : nullptr;
  const int CH = 8192; std::vector<long long> agg[2] = { std::vector<long long>((size_t)NK * ns, 0), std::vector<long long>((size_t)NK * ns, 0) }; long long nsl = 0, nany = 0, npar[2] = { 0, 0 }; long long nhit = 0; char hn[512]; snprintf(hn, sizeof hn, "%s.hits", argv[4]); FILE *fh = fopen(hn, "w"); // every launch: arrival k stick parity
  for (int a0 = 0; a0 < na; a0 += CH) { int n = na - a0 < CH ? na - a0 : CH; std::vector<float> sub(AR.begin() + 4 * a0, AR.begin() + 4 * (a0 + n)); float *dAR = up(sub);
    SW *dKS; CK(cudaMalloc(&dKS, sizeof(SW) * (size_t)n * NK)); int *dFL, *dPAR; float *dVY; CK(cudaMalloc(&dFL, 4 * n)); CK(cudaMalloc(&dPAR, 4 * n)); CK(cudaMalloc(&dVY, 4 * n));
    k_arrive<<<(n + 63) / 64, 64>>>(R, dA, dAR, dFS, n, cx, cy, NK, dKS, dFL, dVY, dPAR); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
    long long nt = (long long)n * NK * ns; unsigned char *dO; CK(cudaMalloc(&dO, nt));
    k_branch<<<(unsigned)((nt + 127) / 128), 128>>>(R, dA, dKS, dFL, n, NK, dST, ns, dO, maxs); CK(cudaGetLastError()); CK(cudaDeviceSynchronize());
    std::vector<int> fl(n), par(n); std::vector<float> vy(n); std::vector<unsigned char> o(nt);
    CK(cudaMemcpy(fl.data(), dFL, 4 * n, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(par.data(), dPAR, 4 * n, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(vy.data(), dVY, 4 * n, cudaMemcpyDeviceToHost)); CK(cudaMemcpy(o.data(), dO, nt, cudaMemcpyDeviceToHost));
    for (int i = 0; i < n; i++) for (size_t c = 0; c < (size_t)NK * ns; c++) if (o[(size_t)i * NK * ns + c] && nhit < 2000000) { fprintf(fh, "%d %d %d %d\n", a0 + i, (int)(c / ns), (int)(c % ns), par[i]); nhit++; }
    fflush(fh);
    for (int i = 0; i < n; i++) { if (!fl[i]) continue; nsl++; int any = 0; for (size_t c = 0; c < (size_t)NK * ns; c++) if (o[(size_t)i * NK * ns + c]) { agg[par[i]][c]++; any = 1; } nany += any; npar[par[i]]++; }
    cudaFree(dAR); cudaFree(dKS); cudaFree(dFL); cudaFree(dPAR); cudaFree(dVY); cudaFree(dO); fflush(fo);
    fprintf(fp, "%d/%d arrivals | slides %lld | with a win %lld | %.0f s\n", a0 + n, na, nsl, nany, std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count()); fflush(fp); }
  fclose(fh);
  // out (GPU build): text summary. line 1: arrivals slides any par0 par1 NK ns; then per parity p, per k: ns counts
  fprintf(fo, "%d %lld %lld %lld %lld %d %d\n", na, nsl, nany, npar[0], npar[1], NK, ns);
  for (int p = 0; p < 2; p++) for (int k = 0; k < NK; k++) { for (int j = 0; j < ns; j++) fprintf(fo, "%lld ", agg[p][(size_t)k * ns + j]); fprintf(fo, "\n"); }
#else
  Room R; R.TF = hr.TF.data(); R.TI = hr.TI.data(); R.CLI = hr.CLI.data(); R.CLF = hr.CLF.data(); R.CELLS = hr.CELLS.data(); R.PF = hr.PF.data(); R.PI = hr.PI.data(); R.PC = hr.PC.data(); R.GR = hr.GR.data(); R.RF = hr.RF.data();
  int N = argc > 9 ? atoi(argv[9]) : na; if (N > na) N = na; std::vector<SW> ks(NK);
  if (getenv("SW_EXITPOS")) { // CPU: for each hit line "arrival k stick parity" print the launch update's position (exit spot)
    FILE *f = fopen(getenv("SW_EXITPOS"), "r"); int ai, k, j, p; while (f && fscanf(f, "%d %d %d %d", &ai, &k, &j, &p) == 4) {
      float vy = 0; int par = 0; if (!arrive(R, acos.data(), AR.data(), FSv.size() ? FSv.data() : nullptr, ai, cx, cy, NK, ks.data(), &vy, &par)) { fprintf(fo, "%d %d %d noarrive\n", ai, k, j); continue; }
      SW x = ks[k]; int got = 0; for (int s = 0; s < maxs; s++) { if (x_step(R, acos.data(), &x, ST[2 * j], ST[2 * j + 1])) { got = x.vel[1] > 2000; break; } if (x.vel[1] < 2.0f) break; }
      fprintf(fo, "%d %d %d %d %.4f %.4f %.4f %.2f %.2f\n", ai, k, j, got, x.S[0], x.S[1], x.S[2], x.vel[1], vy); }
    if (f) fclose(f); fclose(fo); fclose(fp); return 0; }
  if (getenv("SW_RAILINV")) { unsigned zb = (unsigned)strtoul(getenv("SW_RAILINV"), 0, 16); float lo = 0.0f, hi = 1.0f;
    for (int it = 0; it < 60; it++) { float m = 0.5f * (lo + hi); float cp[3]; r_eval(m, cp); union { float f; unsigned u; } a; a.f = cp[2]; union { unsigned u; float f; } b; b.u = zb; if (cp[2] > b.f) lo = m; else hi = m; }
    union { float f; unsigned u; } t; t.f = lo; for (int d = -40; d <= 40; d++) { union { unsigned u; float f; } q; q.u = t.u + d; float cp[3]; r_eval(q.f, cp); union { float f; unsigned u; } z; z.f = cp[2]; if (z.u == zb) printf("t %.9g %08x\n", q.f, q.u); } return 0; }
  if (getenv("SW_TAS")) { // replay mode: argv[2] holds "x y z vx vy vz yawI cam tspeed pyaw B0 B2 camz camu4 camr state par" then "sx sy" per update
    FILE *f = fopen(getenv("SW_TAS"), "r"); SW x; float v[15]; int st, par; for (int i = 0; i < 15; i++) fscanf(f, "%f", &v[i]); fscanf(f, "%d %d", &st, &par);
    x_start(&x, v[0], v[1], v[2], v[4], par); x.vel[0] = v[3]; x.vel[2] = v[5]; x.yawI = v[6]; x.cam = v[7]; x.tspeed = v[8]; x.pyaw = v[9]; x.B[0] = v[10]; x.B[2] = v[11]; if (v[12] >= 0.0f && v[12] <= 1.0f) { x.camt = v[12]; float cp[3]; r_eval(x.camt, cp); x.camz = cp[2]; } else x.camz = v[12]; x.camu4 = v[13]; x.camr = v[14]; x.state = st;
    int sx, sy, u = 0; while (fscanf(f, "%d %d", &sx, &sy) == 2) { int r = x_step(R, acos.data(), &x, sx, sy); u++; fprintf(fo, "%d %08x %08x %08x %.9g %.9g %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x %08x\n", u, fbits(x.S[0]), fbits(x.S[1]), fbits(x.S[2]), x.vel[1], x.cam, fbits(x.cam), fbits(x.camz), fbits(x.camu4), fbits(x.camr), fbits(x.B[0]), fbits(x.B[2]), fbits(x.pyaw), fbits(x.yawI), fbits(x.vel[0]), fbits(x.vel[2]), fbits(x.tspeed)); if (r) break; }
    fclose(fo); fclose(fp); return 0; }
  for (int i = 0; i < N; i++) { float vy = 0; int par = 0; int fl = arrive(R, acos.data(), AR.data(), FSv.size() ? FSv.data() : nullptr, i, cx, cy, NK, ks.data(), &vy, &par);
    fwrite(&fl, 4, 1, fo); fwrite(&vy, 4, 1, fo); fwrite(&par, 4, 1, fo);
    for (int k = 0; k < NK; k++) for (int j = 0; j < ns; j++) { unsigned char c = 0; if (fl) { SW x = ks[k]; c = (unsigned char)launched(R, acos.data(), &x, ST[2 * j], ST[2 * j + 1], maxs); } fwrite(&c, 1, 1, fo); } }
#endif
  fprintf(fp, "DONE\n"); fclose(fp); fclose(fo); return 0;
}
