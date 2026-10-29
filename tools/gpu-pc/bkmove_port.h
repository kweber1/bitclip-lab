// bkmove_port.h -- C++/CUDA port of the parts of bkmove.js (Bit-Clip Lab movement engine) that a standing punch cancel
// uses: idle, claw (punch), jump, fall, landing, tumble/splat; physics, yaw, animation timer, slope timer, input edges.
// Same float/double steps as the JavaScript (Math.fround = one float rounding). Any other state sets P.bad = 1.
#pragma once
#include "bkcol_port.h"
#ifndef __CUDACC__
#define __constant__
#endif

#define S_IDLE 0x1
#define S_JUMP 0x5
#define S_CLAW 0x6
#define S_LANDING 0x20
#define S_FALL 0x2F
#define S_TUMBLE 0x3D
#define S_SPLAT 0x72
#define PH_NONE 0
#define PH_NORMAL 2
#define PH_LOCKED 4
#define PH_AIRBORN 6
#define A_ONCE 1
#define A_LOOP 2
#define A_STOPPED 4

static HD inline float F32(double x) { return (float)x; }
static HD float mlNormalizeAngle(float a) {
  if (a < 0.0) { a = mlNormalizeAngle(-a); a = (float)(360.0 - (double)a); }
  if (a >= 360.0) a = (float)((double)a - 360.0 * trunc((double)a / 360.0));
  return a;
}
static HD inline float ml_map_f(float v, float i0, float i1, float o0, float o1) {
  if (i1 != i0) { float r = ((v - i0) / (i1 - i0)) * (o1 - o0) + o0; // each op rounded to float (no fma: -fmad=false)
    if (o0 < o1) { if (r > o1) return o1; if (r < o0) return o0; } else { if (r < o1) return o1; if (r > o0) return o0; } return r; }
  return o1;
}
static HD inline float ml_interpolate_f(float t, float a, float b) { float d = b - a; float m = t * d; return m + a; }
static HD inline float ml_clamp_f(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static HD inline float ml_max_f(float a, float b) { return a > b ? a : b; }
static HD inline float ml_min_f(float a, float b) { return a < b ? a : b; }
#define BAD_DTOR_D (3.141592654 / 180.0)
static HD inline void rot_yaw(float yaw, float mag, float *o) {
  float v2 = (float)((double)yaw * BAD_DTOR_D);
  float tmp = (0.0f * lib_sinf(0.0f)) + (lib_cosf(0.0f) * mag);
  float s = lib_sinf(v2), c = lib_cosf(v2);
  o[0] = (tmp * s) + (c * 0.0f);
  o[1] = (0.0f * lib_cosf(0.0f)) - (lib_sinf(0.0f) * mag);
  o[2] = (tmp * c) - (s * 0.0f);
}
__constant__ static const float ACOS_DEG_D[91] = { 1.0f, 0.999848008f, 0.999391019f, 0.998629987f, 0.997564018f, 0.996195018f, 0.994521976f, 0.992546022f, 0.990267992f, 0.987688005f, 0.984808028f, 0.981626987f, 0.978147984f, 0.974370003f, 0.970296025f, 0.965925992f, 0.961261988f, 0.956305027f, 0.951057017f, 0.94551897f, 0.939692974f, 0.933579981f, 0.927183986f, 0.920504987f, 0.913545012f, 0.906307995f, 0.898793995f, 0.891007006f, 0.882947981f, 0.87462002f, 0.866024971f, 0.857167006f, 0.848047972f, 0.838671029f, 0.829038024f, 0.819151998f, 0.809017003f, 0.798636019f, 0.788011014f, 0.777145982f, 0.766044021f, 0.754710019f, 0.743144989f, 0.731353998f, 0.719340026f, 0.707107008f, 0.694657981f, 0.681998014f, 0.669130981f, 0.656059027f, 0.642787993f, 0.629320025f, 0.615661979f, 0.601814985f, 0.587785006f, 0.573575974f, 0.559193015f, 0.544638991f, 0.529919028f, 0.515038013f, 0.5f, 0.484809995f, 0.469471991f, 0.453990996f, 0.438371003f, 0.422618002f, 0.406737f, 0.390731007f, 0.374606997f, 0.358368009f, 0.342020005f, 0.325567991f, 0.309017003f, 0.292371988f, 0.275637001f, 0.258819014f, 0.241922006f, 0.224950999f, 0.207911998f, 0.190808997f, 0.173648f, 0.156434f, 0.139173001f, 0.121868998f, 0.104528002f, 0.0871559978f, 0.0697569996f, 0.0523359999f, 0.0348990001f, 0.0174519997f, 0.0f };
static HD float ml_acosf_deg(float x) {
#ifdef __CUDA_ARCH__
  const float *T = ACOS_DEG_D;
#else
  static const float T_[91] = { 1.0f, 0.999848008f, 0.999391019f, 0.998629987f, 0.997564018f, 0.996195018f, 0.994521976f, 0.992546022f, 0.990267992f, 0.987688005f, 0.984808028f, 0.981626987f, 0.978147984f, 0.974370003f, 0.970296025f, 0.965925992f, 0.961261988f, 0.956305027f, 0.951057017f, 0.94551897f, 0.939692974f, 0.933579981f, 0.927183986f, 0.920504987f, 0.913545012f, 0.906307995f, 0.898793995f, 0.891007006f, 0.882947981f, 0.87462002f, 0.866024971f, 0.857167006f, 0.848047972f, 0.838671029f, 0.829038024f, 0.819151998f, 0.809017003f, 0.798636019f, 0.788011014f, 0.777145982f, 0.766044021f, 0.754710019f, 0.743144989f, 0.731353998f, 0.719340026f, 0.707107008f, 0.694657981f, 0.681998014f, 0.669130981f, 0.656059027f, 0.642787993f, 0.629320025f, 0.615661979f, 0.601814985f, 0.587785006f, 0.573575974f, 0.559193015f, 0.544638991f, 0.529919028f, 0.515038013f, 0.5f, 0.484809995f, 0.469471991f, 0.453990996f, 0.438371003f, 0.422618002f, 0.406737f, 0.390731007f, 0.374606997f, 0.358368009f, 0.342020005f, 0.325567991f, 0.309017003f, 0.292371988f, 0.275637001f, 0.258819014f, 0.241922006f, 0.224950999f, 0.207911998f, 0.190808997f, 0.173648f, 0.156434f, 0.139173001f, 0.121868998f, 0.104528002f, 0.0871559978f, 0.0697569996f, 0.0523359999f, 0.0348990001f, 0.0174519997f, 0.0f };
  const float *T = T_;
#endif
  int sign = 1; if (x < 0) { sign = -1; x = -x; } int up = 0, lo = 91;
  for (;;) { int idx = (up + lo) / 2; if (x > T[idx]) lo = idx; else up = idx; if (up + 1 == lo) break; }
  if (up == 90) return 0;
  float res = ((x - T[up]) / (T[lo] - T[up])) + (float)up;
  return sign > 0 ? res : 180.0f - res;
}
__constant__ static const float FRICTION_D[5] = { 0.0f, 0.07f, 0.29f, 0.15f, 0.05f };
static HD inline float friction(int t) {
#ifdef __CUDA_ARCH__
  return FRICTION_D[t];
#else
  static const float FR[5] = { 0.0f, 0.07f, 0.29f, 0.15f, 0.05f }; return FR[t];
#endif
}
// surface_type for maps that are not in MAP_SURF (0x71 and the flat test world): 1 unless the 0x80000000 flag form says 3
static HD inline int surface_type_plain(uint flags) {
  if (flags & 0x80000000u) { uint k = flags & 0x1F00; switch (k) { case 0x0: return 1; case 0x100: return 10; case 0x200: return 9; case 0x300: return 6; case 0x400: return 5;
    case 0x500: return 3; case 0x600: return 7; case 0x700: return 8; case 0x800: return 2; case 0x900: return 11; default: return 1; } }
  return 1;
}

// surface_type with the per-map table (bkmove.js MAP_SURF)
static HD inline int surface_type_map(int map, uint flags) {
  if (flags & 0x80000000u) return surface_type_plain(flags);
  int s = 0; if (flags & 0x200) s = 1; if (flags & 0x400) s = 2; if (flags & 0x800) s = 3; if (flags & 0x1000) s = 4;
  switch (map) {
    case 0x1: { const int t_[5] = { 1, 7, 6, 5, 1 }; return t_[s]; }
    case 0x2: { const int t_[5] = { 1, 5, 6, 1, 1 }; return t_[s]; }
    case 0x7: { const int t_[5] = { 2, 5, 6, 1, 1 }; return t_[s]; }
    case 0x26: { const int t_[5] = { 1, 5, 1, 1, 1 }; return t_[s]; }
    case 0xB: { const int t_[5] = { 1, 9, 10, 8, 1 }; return t_[s]; }
    case 0xD: { const int t_[5] = { 8, 11, 1, 1, 1 }; return t_[s]; }
    case 0x12: { const int t_[5] = { 2, 6, 1, 1, 1 }; return t_[s]; }
    case 0x13: { const int t_[5] = { 6, 1, 1, 6, 1 }; return t_[s]; }
    case 0x14: { const int t_[5] = { 6, 1, 1, 1, 1 }; return t_[s]; }
    case 0x15: { const int t_[5] = { 6, 1, 1, 1, 1 }; return t_[s]; }
    case 0x16: { const int t_[5] = { 6, 1, 1, 1, 1 }; return t_[s]; }
    case 0x1A: { const int t_[5] = { 6, 1, 1, 1, 1 }; return t_[s]; }
    case 0x1B: { const int t_[5] = { 1, 7, 6, 12, 5 }; return t_[s]; }
    case 0x21: { const int t_[5] = { 1, 9, 10, 8, 1 }; return t_[s]; }
    case 0x22: { const int t_[5] = { 1, 9, 10, 8, 1 }; return t_[s]; }
    case 0x23: { const int t_[5] = { 1, 9, 10, 8, 1 }; return t_[s]; }
    case 0x27: { const int t_[5] = { 3, 5, 3, 1, 1 }; return t_[s]; }
    case 0x31: { const int t_[5] = { 9, 10, 5, 6, 1 }; return t_[s]; }
    case 0x46: { const int t_[5] = { 3, 1, 1, 1, 1 }; return t_[s]; }
    case 0x72: { const int t_[5] = { 1, 8, 11, 3, 5 }; return t_[s]; }
    case 0x6F: { const int t_[5] = { 1, 3, 3, 1, 1 }; return t_[s]; }
    case 0x40: { const int t_[5] = { 1, 6, 5, 3, 7 }; return t_[s]; }
    default: return 1; }
}
struct Anim { int type; float dur, timer, anim, sub0, sub1, start; int def, dir, id; };
static HD inline void an_reset(Anim &a) { a.type = A_LOOP; a.def = 1; a.timer = 0; a.start = 0; a.sub0 = 0; a.sub1 = 1.0f; a.dur = 2.0f; a.dir = 1; }
static HD inline void an_go(Anim &a) { a.anim = a.def ? (a.dir ? 0.0f : 0.99999899f) : a.start; a.timer = a.anim; }
static HD inline void an_play(Anim &a, int id, float dur, int type) { an_reset(a); a.id = id; a.dur = dur; a.type = type; an_go(a); }
static HD inline void an_setStart(Anim &a, float s) { a.start = s; a.def = 0; }
static HD inline void an_setSub(Anim &a, float x, float y) { a.sub0 = x; a.sub1 = y; }
static HD inline void an_update(Anim &a, float dt) {
  if (a.type == A_ONCE) {
    a.timer = a.anim; float d = dt / a.dur; if (!a.dir) d = -d; float t = a.timer + d;
    if (t < 0) { t = 0; a.type = A_STOPPED; }
    else if (a.sub1 < t || 0.999999 < t) { if (a.sub1 < t) t = a.sub1; if (0.999999 < t) t = (float)0.9999989867210388; a.type = A_STOPPED; }
    else t = t - truncf(t);
    a.anim = t;
  } else if (a.type == A_LOOP) {
    a.timer = a.anim; float d = dt / a.dur; if (!a.dir) d = -d; float t = a.timer + d; if (t < 0) t = t + 1.0f; t = t - truncf(t); a.anim = t;
  }
}
static HD inline int an_isAt(const Anim &a, float x) { float f0 = a.anim; if (f0 == a.timer) return 0;
  if (a.dir) return a.timer < f0 ? (a.timer <= x && x < f0) : (a.timer <= x || x < f0);
  return f0 < a.timer ? (x <= a.timer && f0 < x) : (x <= a.timer || f0 < x); }
static HD inline int an_stopped(const Anim &a) { return a.type == A_STOPPED; }

struct Inp { int A, B, Z; };
struct Player {
  int map; float cam; float pos[3], vel[3]; float yaw, ideal; int yawState; float yawB0, yawB1, yawU; int yawMode; float yawThresh;
  int ptype; float thv, tyaw, grav, term; float zones[5];
  int keyA0, keyA1, keyB0, keyB1, keyZ0, keyZ1;  // [held count, released count]
  float sdist, szp; int szone;                   // stick (always neutral here)
  Anim anim; int grounded, stable, floorType, holdCounter; Tracker tr; World w;
  float slopeTimer, st5, st6; float fallStart[3]; int fallHeight;
  int state; int v_ph, v_rot; float lastD[3]; float dt; int bad;
  // last step results
  float tgt[3]; int held, hits;
};
static HD inline int pl_pressed(int c0) { return c0 == 1; }
static HD inline float pl_floorY(const Player &P) { return P.tr.posX; }
static HD inline int pl_isStable(const Player &P) { return P.stable && P.vel[1] < 0; }
static HD inline int pl_isAboveFloorBy(const Player &P, float n) { return pl_isStable(P) || (P.vel[1] < 0 && (P.pos[1] - pl_floorY(P)) < n); }
static HD inline int pl_isSliding(const Player &P) { return P.st5 > 0 || P.slopeTimer == 1.0f; }
static HD inline int pl_isActive(const Player &P) { int fl = (int)P.tr.unk4C; return (fl & 0x10) || (fl & 0x40); }
static HD inline void pl_setUT(Player &P, int ys, int ym, int pt) { P.yawState = ys; P.yawMode = ym; P.ptype = pt; }
static HD inline void pl_walkTarget(Player &P) { if (P.szone == 0) P.thv = 0; else P.bad = 1; }
static HD inline void pl_setHVel(Player &P, float yaw, float mag) { float v[3]; rot_yaw(yaw, mag, v); P.vel[0] = v[0]; P.vel[1] = v[1]; P.vel[2] = v[2]; }
static HD inline int pl_groundType(const Player &P) { int t = surface_type_map(P.map, P.tr.unk4C); return t == 3 ? 4 : 2; }

static HD void pl_setState(Player &P, int id);
static HD void st_init(Player &P, int id) {
  switch (id) {
    case S_IDLE: case S_SPLAT: an_play(P.anim, 0x6F, 5.5f, A_ONCE); pl_setUT(P, 1, 1, PH_NORMAL); P.thv = 0; P.v_rot = 0; break;
    case S_LANDING: pl_setUT(P, 1, 1, PH_NORMAL); P.thv = 0; break;
    case S_CLAW: an_play(P.anim, 5, 1.3f, A_ONCE); pl_setUT(P, 1, 3, PH_LOCKED); P.tyaw = mlNormalizeAngle(P.ideal); P.thv = 160.0f; break;
    case S_JUMP:
      an_reset(P.anim); P.anim.id = 8; P.anim.dur = 1.9f; an_setStart(P.anim, 0.3f); an_setSub(P.anim, 0, 0.5042f); P.anim.type = A_ONCE; an_go(P.anim);
      pl_setUT(P, 1, 3, PH_AIRBORN); if (P.sdist != 0) P.bad = 1; P.tyaw = mlNormalizeAngle(P.ideal);
      pl_walkTarget(P); pl_setHVel(P, P.ideal, P.thv); P.vel[1] = 710.0f; P.grav = -1350.0f; P.v_ph = 0; break;
    case S_FALL: an_play(P.anim, 0xB0, 0.38f, A_LOOP); pl_setUT(P, 1, 3, PH_AIRBORN); P.v_ph = 0; break;
    case S_TUMBLE: an_play(P.anim, 0x68, 0.35f, A_LOOP); pl_setUT(P, 1, 3, PH_AIRBORN); P.bad = 1; break; // timers not ported
    default: P.bad = 1;
  }
}
static HD void st_end(Player &P, int id) { if (id == S_JUMP) P.grav = -2700.0f; }
static HD void pl_setState(Player &P, int id) { if (!id) return; st_end(P, P.state); P.state = id; P.v_ph = 0; P.v_rot = 0; st_init(P, id); }
static HD int standNext(Player &P, int r) {
  if (P.szone != 0) P.bad = 1; if (P.keyZ0 > 0) r = 0x7; if (pl_pressed(P.keyB0)) r = S_CLAW; if (pl_pressed(P.keyA0)) r = (P.keyZ0 > 0) ? 0x12 : S_JUMP; if (pl_isSliding(P)) r = 0x32; return r;
}
static HD void st_update(Player &P) {
  int n = 0;
  switch (P.state) {
    case S_IDLE: case S_SPLAT:
      if (P.szone == 0 && P.sdist > 0) { P.bad = 1; } else { if (P.v_rot) P.ideal = mlNormalizeAngle(P.yaw); P.v_rot = 0; P.yawState = 1; }
      pl_setState(P, standNext(P, 0)); return;
    case S_LANDING: { int r = 0; if (an_stopped(P.anim)) r = S_IDLE; pl_setState(P, standNext(P, r)); return; }
    case S_CLAW:
      if (an_isAt(P.anim, 0.5788f)) P.thv = 0; if (an_stopped(P.anim)) n = S_IDLE; if (!pl_isStable(P)) n = S_FALL; if (pl_pressed(P.keyA0)) n = (P.keyZ0 > 0) ? 0x12 : S_JUMP;
      pl_setState(P, n); return;
    case S_JUMP:
      pl_walkTarget(P);
      if (P.keyA1 > 0 && 0 < P.vel[1]) P.grav = -2700.0f;
      if (P.v_ph == 0) { if (an_stopped(P.anim)) { an_setSub(P.anim, 0, 0.6667f); P.anim.dur = 4.0f; P.anim.type = A_ONCE; P.v_ph = 1; }
        if (pl_isAboveFloorBy(P, 0x82)) { an_setSub(P.anim, 0, 1.0f); P.anim.dur = 1.4f; P.anim.type = A_ONCE; P.v_ph = 2; } }
      else if (P.v_ph == 1) { if (500 < (P.pos[1] - pl_floorY(P))) n = S_FALL; if (pl_isAboveFloorBy(P, 0x5A)) { an_setSub(P.anim, 0, 1.0f); P.anim.dur = 2.0f; P.anim.type = A_ONCE; P.v_ph = 2; } }
      if (P.fallHeight > 1000 && !pl_isStable(P)) n = S_TUMBLE;
      if (pl_pressed(P.keyZ0)) n = 0xF; if (pl_isStable(P)) n = S_LANDING; pl_setState(P, n); return;
    case S_FALL:
      pl_walkTarget(P);
      if (P.v_ph == 0 && pl_isAboveFloorBy(P, 0x5A)) { an_reset(P.anim); P.anim.id = 8; P.anim.dur = 2.0f; an_setStart(P.anim, 0.6667f); P.anim.type = A_ONCE; an_go(P.anim); P.v_ph = 1; }
      if (P.fallHeight > 1000 && !pl_isStable(P)) n = S_TUMBLE; if (pl_pressed(P.keyZ0)) n = 0xF; if (pl_isStable(P)) n = S_LANDING; pl_setState(P, n); return;
    default: P.bad = 1; return;
  }
}
static HD void pl_physics(Player &P, float *out) {
  if (P.ptype == PH_NORMAL) P.tyaw = mlNormalizeAngle(P.ideal);
  else if (P.ptype == PH_AIRBORN) { if (0 < P.sdist) P.bad = 1; }
  else if (P.ptype == PH_NONE) { P.lastD[0] = P.lastD[1] = P.lastD[2] = 0; out[0] = P.pos[0]; out[1] = P.pos[1]; out[2] = P.pos[2]; return; }
  float dt = P.dt; float tv[3]; rot_yaw(P.tyaw, P.thv, tv); float s60[3] = { tv[0], 0, tv[2] }; float s6c[3] = { P.vel[0], 0, P.vel[2] };
  if (P.grounded) {
    const float *n = P.tr.norm; float l2 = ((s60[0] * s60[0]) + 0.0f) + (s60[2] * s60[2]);
    float s48[3] = { s60[0], s60[1], s60[2] }; if (l2 != 0) { float inv = (float)(1.0 / (double)sqrtf(l2)); s48[0] = s60[0] * inv; s48[1] = s60[1] * inv; s48[2] = s60[2] * inv; }
    float s44 = ((s48[0] * n[0]) + (s48[1] * n[1])) + (s48[2] * n[2]); float s40 = (float)((double)P.slopeTimer * 1.0);
    if (s44 != 0) {
      if (s44 < 0) { s40 = pl_isActive(P) ? ml_map_f(s40, 0, 1, (float)((double)s44 * 0.5), -1) : (float)(0.5 * (double)s44); float k = (float)(1.0 + (double)s40); s60[0] *= k; s60[1] *= k; s60[2] *= k; }
      else { s40 = (float)((double)s44 * 0.2); float k = (float)((double)s40 + 1.0); s60[0] *= k; s60[1] *= k; s60[2] *= k; }
    }
  }
  float fr = friction(P.floorType); float k = (float)((double)dt / 0.0333333);
  float d84[3]; for (int i = 0; i < 3; i++) { float a = s60[i] * fr; float b = s6c[i] * fr; float c = a - b; d84[i] = c * k; }
  P.vel[0] = P.vel[0] + d84[0]; P.vel[1] = P.vel[1] + d84[1]; P.vel[2] = P.vel[2] + d84[2];
  float dl[3] = { P.vel[0], 0, P.vel[2] };
  if (absf(P.vel[0]) < 0.0001) P.vel[0] = 0; if (absf(P.vel[2]) < 0.0001) P.vel[2] = 0;
  P.vel[1] = P.vel[1] + (dt * P.grav); if (P.vel[1] < P.term) P.vel[1] = P.term;
  dl[1] = dl[1] + P.vel[1];
  float d[3] = { dl[0] * dt, dl[1] * dt, dl[2] * dt }; P.lastD[0] = d[0]; P.lastD[1] = d[1]; P.lastD[2] = d[2];
  out[0] = P.pos[0] + d[0]; out[1] = P.pos[1] + d[1]; out[2] = P.pos[2] + d[2];
}
static HD void pl_wrapYaw(Player &P) { if (P.yaw < 360.0) { if (P.yaw < 0.0) P.yaw = (float)((double)P.yaw + 360.0); } else P.yaw = (float)((double)P.yaw - 360.0); }
static HD void pl_limited(Player &P, float lim, float pct) {
  float dt = P.dt; float mx = lim * dt; float d = P.ideal - P.yaw; if (180 < absf(d)) d = (float)((double)d + (d < 0 ? 360.0 : -360.0));
  float v = (d * pct) * dt; v = v < 0 ? ml_clamp_f(v, -mx, -0.1f) : ml_clamp_f(v, 0.1f, mx);
  P.yaw = absf(v) <= absf(d) ? P.yaw + v : P.ideal; pl_wrapYaw(P);
}
static HD void pl_yawStep(Player &P) {
  int m = P.yawMode;
  if (m == 1) { if (P.sdist != 0) P.bad = 1; } else if (m == 5 || m == 4 || m == 7) { if (P.sdist != 0) P.bad = 1; }
  else if (m == 0 || m == 2) return;
  if (P.yawState == 1) pl_limited(P, 700.0f, 7.5f); else if (P.yawState == 3) pl_limited(P, P.yawB0, P.yawB1);
  else if (P.yawState == 2) { float a = P.yawU * P.dt; float d = P.ideal - P.yaw; if (absf(d) > 180) d = (float)((double)d + (d < 0 ? 360.0 : -360.0));
    float s = absf(d) > 180 ? a : (d < 0 ? -a : a); P.yaw = absf(s) <= absf(d) ? P.yaw + s : P.ideal; pl_wrapYaw(P); }
}
static HD void pl_slope(Player &P) {
  if (P.st5 > 0) P.st5 = ml_max_f(0, P.st5 - P.dt); if (P.st6 > 0) P.st6 = ml_max_f(0, P.st6 - P.dt);
  float deg = ml_acosf_deg(P.tr.norm[1]); float k = ml_map_f(deg, 20, 60, 0.6f, 1.3f); int fl = (int)P.tr.unk4C;
  float dt = P.dt; // map 0xC not used here
  if (fl & 0x50) P.slopeTimer = ml_min_f((dt * k) + P.slopeTimer, 1.0f); else P.slopeTimer = 0;
  if (P.slopeTimer == 1.0f) { if (fl & 0x10) P.st5 = 0.18f; else if (fl & 0x40) P.st6 = 0.18f; }
}
static HD inline void key_upd(int h, int &c0, int &c1) { c0 = h ? c0 + 1 : 0; c1 = c0 ? 0 : c1 + 1; }
// one update. frames 2 or 3 (PAL: dt = min(frames/50, 0.06))
static HD void pl_step(const Room &R_, const unsigned short *ACOS, Player &P, Inp in, int frames) {
  P.dt = (float)fmin(frames * (1.0 / 50), 0.06);
  float old[3] = { P.pos[0], P.pos[1], P.pos[2] };
  key_upd(in.A, P.keyA0, P.keyA1); key_upd(in.B, P.keyB0, P.keyB1); key_upd(in.Z, P.keyZ0, P.keyZ1);
  P.sdist = 0; P.szone = 0; P.szp = 0;
  st_update(P);
  float tgt[3]; pl_physics(P, tgt);
  if (pl_isStable(P)) { P.fallStart[0] = tgt[0]; P.fallStart[1] = tgt[1]; P.fallStart[2] = tgt[2]; }
  P.fallHeight = (int)truncf(P.fallStart[1] - tgt[1]);
  Pred r; predict(R_, ACOS, &P.w, old, tgt, P.grounded, P.holdCounter, &P.tr, &r);
  P.pos[0] = r.result[0]; P.pos[1] = r.result[1]; P.pos[2] = r.result[2]; P.grounded = r.grounded; P.holdCounter = r.hold_counter_after;
  float fy = pl_floorY(P); int below = P.tr.unk58 && P.pos[1] < fy;
  if (below && P.pos[1] < (fy - 70.0f)) { P.floorType = 3; if (P.grounded && P.vel[1] < 0) P.vel[1] = -1.0f; }
  else if (P.grounded) { P.floorType = pl_groundType(P); if (P.vel[1] < 0) P.vel[1] = -1.0f; }
  else P.floorType = 1;
  pl_yawStep(P);
  an_update(P.anim, P.dt);
  P.stable = P.grounded;
  pl_slope(P);
  P.tgt[0] = tgt[0]; P.tgt[1] = tgt[1]; P.tgt[2] = tgt[2]; P.held = r.held; P.hits = r.hits;
}
static HD void pl_init(const Room &R_, const unsigned short *ACOS, Player &P, int map, float x, float y, float z, float yaw) {
  P.map = map; P.cam = 0; P.pos[0] = x; P.pos[1] = y; P.pos[2] = z; P.vel[0] = 0; P.vel[1] = -1.0f; P.vel[2] = 0;
  P.yaw = yaw; P.ideal = yaw; P.yawState = 1; P.yawB0 = 700.0f; P.yawB1 = 7.5f; P.yawU = 360.0f; P.yawMode = 1; P.yawThresh = 0;
  P.ptype = PH_NORMAL; P.thv = 0; P.tyaw = P.ideal; P.grav = -2700.0f; P.term = -4000.0f;
  P.zones[0] = 0.12f; P.zones[1] = 0.2f; P.zones[2] = 0.5f; P.zones[3] = 0.75f; P.zones[4] = 1.0f;
  P.keyA0 = 0; P.keyA1 = 1; P.keyB0 = 0; P.keyB1 = 1; P.keyZ0 = 0; P.keyZ1 = 1; P.sdist = 0; P.szp = 0; P.szone = 0;
  an_reset(P.anim); P.anim.anim = 0; P.anim.id = 0; an_play(P.anim, 0x6F, 5.5f, A_ONCE);
  P.grounded = 1; P.stable = 1; P.floorType = 2; P.holdCounter = 0;
  tracker_init(&P.tr, P.pos); P.w.has_stored = 0; P.slopeTimer = 0; P.st5 = 0; P.st6 = 0;
  P.fallStart[0] = x; P.fallStart[1] = y; P.fallStart[2] = z; P.fallHeight = 0; P.state = 0; P.v_ph = 0; P.v_rot = 0; P.lastD[0] = P.lastD[1] = P.lastD[2] = 0; P.bad = 0;
  P.dt = 0; P.held = 0; P.hits = 0;
  Pred r; predict(R_, ACOS, &P.w, P.pos, P.pos, P.grounded, 0, &P.tr, &r);
  P.grounded = r.grounded; P.stable = P.grounded; P.floorType = P.grounded ? pl_groundType(P) : 1;
  pl_setState(P, S_IDLE);
}
