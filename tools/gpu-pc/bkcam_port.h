// bkcam_port.h -- CUDA/C++ port of bkcam.js (Banjo-Kazooie dynamic follow camera, state 0xB, PAL). Same operations in the
// same order: f32 steps rounded to float, the C code's double constants kept double. Needs bkmove_port.h (Player, ml helpers).
// The camera queries its own World (map + model props only: pass the camera Room, packed with --modelprops).
#pragma once
#include "bkmove_port.h"
#define CAM_FLAGS 0x9E0000u
#define CAM_LOOP 6
struct Cam {
  float D948[3], pos[3], rot[3]; float D974, D978, D97C, D980, D994, D998, D99C, D9A0;
  float D9A8[3], D9B8[3], D9C8[3]; float D9D4, D9D8; float D9E0[3]; float D9EC, D9F0; int D9F6;
  float DB70, DB78[3], DB84[3], DB90[3], DB9C; World w;
};
static HD float c_mlDiffDegF(float a, float b) { float d = a - b; while (d > 180) d = d - 360.0f; while (d <= -180) d = d + 360.0f; return d; }
static HD void c_80256E24(float *o, float theta, float phi, float x, float y, float z) {
  theta = (float)((double)theta * BAD_DTOR); phi = (float)((double)phi * BAD_DTOR);
  float tmp = (y * lib_sinf(theta)) + (lib_cosf(theta) * z);
  o[0] = (tmp * lib_sinf(phi)) + (lib_cosf(phi) * x); o[1] = (y * lib_cosf(theta)) - (lib_sinf(theta) * z); o[2] = (tmp * lib_cosf(phi)) - (lib_sinf(phi) * x);
}
static HD void c_yaw_rotate(float *o, const float *src, float yaw) { yaw = (float)((double)yaw * BAD_DTOR); float c = lib_cosf(yaw), s = lib_sinf(yaw);
  float r0 = (src[2] * s) + (src[0] * c), r2 = (src[2] * c) - (src[0] * s); o[0] = r0; o[1] = src[1]; o[2] = r2; }
static HD float c_8025801C(const unsigned short *AC, const float *v) { float h = sqrtf((v[2] * v[2]) + (v[0] * v[0])); if (h < 0.01) return 0;
  float y = ml_acosf(AC, v[0] / h); if (v[2] < 0) y = 180.0f - y; if (v[0] < 0) y = 360.0f - y; return y; }
static HD void c_hv_angles(const unsigned short *AC, const float *a, const float *b, float &o1, float &o2) {
  float dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; float ft2 = (dx * dx) + (dz * dz); float hd = sqrtf(ft2);
  if (hd > 0.01) { o2 = ml_acosf(AC, dx / hd); if (dz < 0) o2 = 180.0f - o2; if (dx < 0) o2 = 360.0f - o2; } else o2 = 0;
  float dist = sqrtf((dy * dy) + ft2);
  if (dist > 0.01) { o1 = ml_acosf(AC, dy / dist); if (hd < 0) o1 = 180.0f - o1; if (dy < 0) o1 = 360.0f - o1; } else o1 = 0;
}
#define CRA const Room &R_, const unsigned short *AC, Cam &C
#define CRP R_, AC, C
static HD int c_line(CRA, const float *a, float *b, float *n) { return bk_line(R_, &C.w, a, b, n, CAM_FLAGS) >= 0; }
static HD int c_80244D94(CRA, const float *a, float *b, float *n, float ext) {
  float s20[3]; VCP(s20, b); float d[3]; vsub(d, s20, a); float s2c[3]; set_length(s2c, d, ext); vadd(s20, s20, s2c);
  if (bk_line(R_, &C.w, a, s20, n, CAM_FLAGS) < 0) return 0; float r[3]; vsub(r, s20, s2c); VCP(b, r); return 1; }
static HD int c_8024575C(CRA, const float *a, float *b, float r, float *n, int steps) { if (r < vdist(a, b)) return 0; return bk_moving_sphere(R_, &C.w, a, b, r, n, steps, CAM_FLAGS) >= 0; }
static HD void c_target(CRA, const Player &P, float *a) {
  VCP(a, P.pos); float fl = pl_floorY(P);
  if ((fl + C.D974) < a[1]) a[1] = a[1] + (80.0f - C.D974); else a[1] = fl + 80.0f;
  vadd(a, a, C.D9B8);
}
static HD void c_floorCam(CRA) { float a[3] = { C.pos[0], C.pos[1] + 10.0f, C.pos[2] }, b[3] = { C.pos[0], C.pos[1] + -600.0f, C.pos[2] }, n[3] = { 0, 0, 0 };
  int t = bk_line(R_, &C.w, a, b, n, 0x800000u) >= 0; C.D9A0 = t ? b[1] : C.pos[1] - 600.0f; }
static HD void c_lead(CRA, const Player &P) {
  float d[3]; vsub(d, P.pos, C.pos); float yaw = P.yaw;
  float k = ml_map_f(absf((float)((double)mlNormalizeAngle(C.rot[1] - yaw) - 180.0)), 0, 180, C.D97C, C.D980);
  c_80256E24(C.D9A8, 0, yaw, 0, 0, ml_map_f(sqrtf((d[0] * d[0]) + (d[2] * d[2])), 300, 450, 0, k));
  float s[3]; vsub(s, C.D9A8, C.D9B8); vscale(s, s, 0.08f); vadd(C.D9B8, C.D9B8, s);
}
static HD float c_height(CRA, const Player &P) {
  float fl = pl_floorY(P); float s1c = (C.D9A0 + 35.0f) + 20.0f;
  if ((P.pos[1] - fl) > 130.0f) C.D978 = (P.pos[1] + C.D99C) - 130.0f; else C.D978 = C.D99C + fl;
  if (C.D978 < s1c) C.D978 = s1c; return C.D978;
}
static HD void c_spring(CRA, const float *goal, int frames) {
  float p[3]; VCP(p, C.pos); int n = frames * CAM_LOOP; float dd[3];
  for (int i = 0; i < n; i++) {
    for (int k = 0; k < 3; k++) { float d = goal[k] - p[k]; float s48 = (float)((double)C.D9EC * (0.003333 * (double)d)); float s3c = s48 - C.D9E0[k];
      C.D9E0[k] = (float)((double)C.D9E0[k] + (double)s3c * 0.003333 * (double)C.D9F0); dd[k] = d; }
    for (int k = 0; k < 3; k++) { float v = C.D9E0[k], d = dd[k]; if (absf(d) < absf(v) && 0.0 <= (v * d)) { C.D9E0[k] = 0; p[k] = goal[k]; } }
    for (int k = 0; k < 3; k++) p[k] = p[k] + C.D9E0[k];
  }
  VCP(C.pos, p);
}
static HD void c_pushSphere(CRA, float *a, float r) { float n[3] = { 0, 0, 0 };
  if (bk_sphere(R_, &C.w, a, r, n, CAM_FLAGS) >= 0) { if ((((n[0] * n[0]) + (n[1] * n[1])) + (n[2] * n[2])) < 0.01) return;
    a[0] = a[0] + (1.5f * n[0]); a[1] = a[1] + (1.5f * n[1]); a[2] = a[2] + (1.5f * n[2]); } }
static HD int c_collide(CRA) {
  float before[3]; VCP(before, C.pos); float *a0 = C.D948, *a1 = C.pos;
  c_pushSphere(CRP, a0, 35.0f);
  float s48[3], s3c[3], s30[3], t[3]; VCP(s48, a0); VCP(s3c, a1); vsub(t, s3c, s48); normalize(t, t); vscale(s30, t, 35.0f); vadd(s3c, s3c, s30);
  float n[3] = { 0, 0, 0 };
  int hit1 = c_line(CRP, s48, s3c, n);
  vsub(s3c, s3c, s30);
  int hit2 = c_8024575C(CRP, s48, s3c, 35.0f, n, 3);
  if (hit1 || hit2) {
    float s34[3], s28[3], s1c[3]; vsub(s34, a1, a0); vsub(s28, s3c, s48); vsub(s1c, s34, s28); float dp = -dot(n, s1c);
    a1[0] = a1[0] + (dp * n[0]); a1[1] = a1[1] + (dp * n[1]); a1[2] = a1[2] + (dp * n[2]);
    float s30b[3], e[3], z3[3] = { 0, 0, 0 }; vsub(t, a1, a0); normalize(t, t); vscale(s30b, t, 35.0f); vadd(e, a1, s30b);
    c_line(CRP, a0, e, z3); float r[3]; vsub(r, e, s30b); VCP(a1, r);
  }
  return !(before[0] == C.pos[0]) || !(before[1] == C.pos[1]) || !(before[2] == C.pos[2]);
}
static HD int c_relocate(CRA, const float *pp, const float *dir, float dist, int mode) {
  float f26 = ml_max_f(150.0f, dist - 100.0f); const int L1[11] = { 0, -25, 25, -50, 50, -80, 80, -120, 120, -140, 140 };
  int nl; const int *list; int L0[1] = { 0 }; int L2[18]; for (int i = 0; i < 18; i++) L2[i] = i * 20;
  if (mode == 1) { list = L1; nl = 11; } else if (mode == 2 || mode == 3) { list = L2; nl = 18; } else { list = L0; nl = 1; f26 = 150.0f; }
  for (int q = 0; q < nl; q++) { int a = list[q]; if (mode == 3) a = -a;
    float sc[3], s9c[3], s78[3], n[3] = { 0, 0, 0 }; vscale(sc, dir, -dist); c_yaw_rotate(s9c, sc, (float)a); vadd(s78, pp, s9c);
    c_80244D94(CRP, pp, s78, n, 40.0f); c_8024575C(CRP, pp, s78, 40.0f, n, 4);
    float dd[3]; vsub(dd, pp, s78); float l2 = lensq(dd); float vl = l2 != 0 ? sqrtf(l2) : 0;
    if (f26 < vl) { VCP(C.pos, s78); C.D9C8[0] = C.D9C8[1] = C.D9C8[2] = 0; C.D9E0[0] = C.D9E0[1] = C.D9E0[2] = 0; return 1; } }
  return 0;
}
static HD int c_sightCheck(CRA, const Player &P, int mode) {
  float pp[3] = { P.pos[0], P.pos[1] + 80.0f, P.pos[2] }; float cp[3]; VCP(cp, C.pos);
  float d[3]; vsub(d, pp, cp); float dir[3]; normalize(dir, d); float s44[3]; VCP(s44, pp);
  float dist = sqrtf(((d[0] * d[0]) + (d[1] * d[1])) + (d[2] * d[2]));
  if (1500.0f < dist) { vscale(d, dir, 1500.0f); vadd(s44, cp, d); }
  float s2c[3], tmp[3];
  switch (C.D9F6) { case 1: vscale(tmp, dir, 100.0f); c_yaw_rotate(s2c, tmp, -90.0f); break; case 2: vscale(tmp, dir, 100.0f); c_yaw_rotate(s2c, tmp, 90.0f); break;
    case 3: s2c[0] = 0; s2c[1] = 100; s2c[2] = 0; break; default: s2c[0] = s2c[1] = s2c[2] = 0; }
  float s20[3]; vadd(s20, s2c, s44); float z3[3] = { 0, 0, 0 };
  if (c_line(CRP, cp, s20, z3)) { C.D9F6++; if (C.D9F6 >= 5) { C.D9F6 = 0; return c_relocate(CRP, pp, dir, dist, mode); } }
  else C.D9F6 = 0;
  return 0;
}
static HD void c_rotSmooth(CRA, const float *tr, float dt) {
  float cr[3]; VCP(cr, C.rot); float d0 = c_mlDiffDegF(tr[0], cr[0]), d1 = c_mlDiffDegF(tr[1], cr[1]);
  float s44[2] = { (d0 * dt) * C.D9D4, (d1 * dt) * C.D9D4 };
  float s38[2] = { s44[0] - C.D9C8[0], s44[1] - C.D9C8[1] };
  s38[0] = (float)((double)C.D9D8 * (0.0333 * (double)s38[0])); s38[1] = (float)((double)C.D9D8 * (0.0333 * (double)s38[1]));
  C.D9C8[0] = C.D9C8[0] + s38[0]; C.D9C8[1] = C.D9C8[1] + s38[1];
  float s30 = absf(C.D9C8[0]); if (absf(d0) < s30 && (C.D9C8[0] * d0) > 0) { C.D9C8[0] = 0; cr[0] = tr[0]; }
  s30 = absf(C.D9C8[1]); if (absf(d1) < s30 && (C.D9C8[1] * d1) > 0) { C.D9C8[1] = 0; cr[1] = tr[1]; }
  cr[0] = mlNormalizeAngle(cr[0] + C.D9C8[0]); cr[1] = mlNormalizeAngle(cr[1] + C.D9C8[1]);
  VCP(C.rot, cr);
}
static HD float cam_update(CRA, const Player &P, int frames) {
  float dt = (float)fmin(frames * (1.0 / 50), 0.06);
  c_floorCam(CRP);
  VCP(C.D948, C.pos);
  c_lead(CRP, P);
  VCP(C.DB84, C.pos);
  float tgt[3]; c_target(CRP, P, tgt);
  float off[3]; c_80256E24(off, 0, C.DB70, 0, 0, C.D994);
  float goal[3]; vadd(goal, tgt, off); goal[1] = c_height(CRP, P); VCP(C.DB90, goal);
  c_spring(CRP, goal, frames);
  int set = 0;
  if (c_collide(CRP)) {
    if (c_sightCheck(CRP, P, 1)) set = 1;
    else {
      VCP(C.DB78, C.pos); float a[3], b[3], t[3]; vsub(t, C.DB90, C.DB84); normalize(a, t); vsub(t, C.DB78, C.DB84); normalize(b, t); float k = dot(a, b);
      if (k < 0 || C.DB9C < 0) VCP(C.pos, C.DB84);
      C.DB9C = k;
    }
    c_target(CRP, P, tgt); float t[3]; vsub(t, C.pos, tgt); C.DB70 = c_8025801C(AC, t);
  }
  c_target(CRP, P, tgt);
  float o1, o2; c_hv_angles(AC, tgt, C.pos, o1, o2); float tr[3] = { mlNormalizeAngle(-o1), o2, 0 };
  if (set) VCP(C.rot, tr);
  c_rotSmooth(CRP, tr, dt);
  return C.rot[1];
}
// ---- zoom camera node (dynamic camera state 0x11, ncDynamicCam11), as on the FP lobby y 891 shelf: node (1995.857, 1101.941, 6432.931),
// close = far = 1000, no collision, target = func_802BD3CC (player, floor + 80). When settled (spring and rotation snap to their goals) the
// camera sits at target + set_length(node - target (horizontal), min(1000, |node - target|)), y = node y, looking at the target.
static HD float cam11_settledYaw(const unsigned short *AC, const Player &P) {
  const float NX = 1995.857177734375f, NY = 1101.94140625f, NZ = 6432.93115234375f, D974 = 130.0f;
  float t[3]; VCP(t, P.pos); float fl = pl_floorY(P);
  if ((fl + D974) < t[1]) t[1] = t[1] + (80.0f - D974); else t[1] = fl + 80.0f;
  float s34[3] = { NX - t[0], NY - t[1], NZ - t[2] }; s34[1] = 0.0f;
  float s30 = sqrtf((s34[0] * s34[0]) + (s34[2] * s34[2])); float s20 = 1000.0f; if (s30 < s20) s20 = s30;
  float s24[3]; set_length(s24, s34, s20); s24[0] = s24[0] + t[0]; s24[2] = s24[2] + t[2]; s24[1] = NY;
  float o1, o2; c_hv_angles(AC, t, s24, o1, o2); return o2;
}
// one game update of the zoom camera (ncDynamicCam11_update, D_8037DAE5 = 0, no collision): spring to the goal, then turn toward the target.
// Uses C.pos, C.rot, C.D9E0 (spring velocity), C.D9C8 (turn velocity), C.D9EC/D9F0 (1.75/3.75), C.D9D4/D9D8 (2.75/12).
static HD void cam11_target(const Player &P, float *t) { VCP(t, P.pos); float fl = pl_floorY(P); if ((fl + 130.0f) < t[1]) t[1] = t[1] + (80.0f - 130.0f); else t[1] = fl + 80.0f; }
static HD void cam11_update(const unsigned short *AC, Cam &C, const Player &P, int frames) {
  const float NX = 1995.857177734375f, NY = 1101.94140625f, NZ = 6432.93115234375f, CLOSE = 1000.0f, FAR = 1000.0f;
  float t[3]; cam11_target(P, t);
  float s24[3] = { C.pos[0] - t[0], C.pos[1] - t[1], C.pos[2] - t[2] }; s24[1] = 0.0f;
  float s20 = sqrtf((s24[0] * s24[0]) + (s24[2] * s24[2])); if (s20 < CLOSE) s20 = CLOSE; if (FAR < s20) s20 = FAR;
  float s34[3] = { NX - t[0], NY - t[1], NZ - t[2] }; s34[1] = 0.0f;
  float s30 = sqrtf((s34[0] * s34[0]) + (s34[2] * s34[2])); if (s30 < s20) s20 = s30;
  set_length(s24, s34, s20); s24[0] = s24[0] + t[0]; s24[2] = s24[2] + t[2]; s24[1] = NY;
  // func_802BE190 (spring)
  { float p[3]; VCP(p, C.pos); int n = frames * CAM_LOOP; float dd[3];
    for (int i = 0; i < n; i++) {
      for (int k = 0; k < 3; k++) { float d = s24[k] - p[k]; float s48 = (float)((double)C.D9EC * (0.003333 * (double)d)); float s3c = s48 - C.D9E0[k];
        C.D9E0[k] = (float)((double)C.D9E0[k] + (double)s3c * 0.003333 * (double)C.D9F0); dd[k] = d; }
      for (int k = 0; k < 3; k++) { float v = C.D9E0[k], d = dd[k]; if (absf(d) < absf(v) && 0.0 <= (v * d)) { C.D9E0[k] = 0; p[k] = s24[k]; } }
      for (int k = 0; k < 3; k++) p[k] = p[k] + C.D9E0[k]; }
    VCP(C.pos, p); }
  float o1, o2; c_hv_angles(AC, t, C.pos, o1, o2); float tr[3] = { mlNormalizeAngle(-o1), o2, 0 };
  float dt = (float)fmin(frames * (1.0 / 50), 0.06);
  // func_802BD904 (turn)
  { float cr[3]; VCP(cr, C.rot); float d0 = c_mlDiffDegF(tr[0], cr[0]), d1 = c_mlDiffDegF(tr[1], cr[1]);
    float s44[2] = { (d0 * dt) * C.D9D4, (d1 * dt) * C.D9D4 }; float s38[2] = { s44[0] - C.D9C8[0], s44[1] - C.D9C8[1] };
    s38[0] = (float)((double)C.D9D8 * (0.0333 * (double)s38[0])); s38[1] = (float)((double)C.D9D8 * (0.0333 * (double)s38[1]));
    C.D9C8[0] = C.D9C8[0] + s38[0]; C.D9C8[1] = C.D9C8[1] + s38[1];
    float s30b = absf(C.D9C8[0]); if (absf(d0) < s30b && (C.D9C8[0] * d0) > 0) { C.D9C8[0] = 0; cr[0] = tr[0]; }
    s30b = absf(C.D9C8[1]); if (absf(d1) < s30b && (C.D9C8[1] * d1) > 0) { C.D9C8[1] = 0; cr[1] = tr[1]; }
    cr[0] = mlNormalizeAngle(cr[0] + C.D9C8[0]); cr[1] = mlNormalizeAngle(cr[1] + C.D9C8[1]); VCP(C.rot, cr); }
}
