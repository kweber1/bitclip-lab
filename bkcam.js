// bkcam.js -- Banjo-Kazooie's normal follow camera (dynamic camera state 0xB), ported from the n64decomp banjo-kazooie sources:
// core2/nc/dynamicCamera.c (ncDynamicCamera_update, func_802BCA58, func_802BCD60, func_802BD3CC/4C0/51C, func_802BD904,
// func_802BDF5C/func_802BE190, func_802BE258/384/484/60C, func_802BC84C/func_802BC640), nc/dynamicCamB.c, code_F8EAF0.c
// (target point mode 2), code_34790.c func_802BC434, core1/ml.c, core1/code_72B0.c (func_80244D94/func_80245314/func_8024575C).
// One update() = one game update, called AFTER the player's update for that frame (the player uses the yaw from the previous one).
// The camera's yaw (rot[1]) is what the stick is measured against (viewport_adjustAngleToRight).
// Not modelled: camera trigger nodes (setup category 9 volumes), C-button rotation (state 0xA), R / zoom changes, water, first person.
// f32 operations are rounded with Math.fround; the C code's double constants stay double.
(function (root) {
'use strict';
const BK = root.BK || (typeof require !== 'undefined' ? require('./bkcol.js') : null);
const F = Math.fround;
const fadd = (a, b) => F(a + b), fsub = (a, b) => F(a - b), fmul = (a, b) => F(a * b), fdiv = (a, b) => F(a / b);
const fsqrt = (x) => F(Math.sqrt(x));
const absf = (x) => (x > 0 ? x : -x);
const BAD_DTOR = 3.141592654 / 180.0;
const sinf = BK.lib_sinf, cosf = BK.lib_cosf, ml_acosf = BK.ml_acosf;
const FLAGS = 0x9E0000;
const LOOP = 6; // PAL: time_getDeltaReal_frames()*6 iterations (US *5); found by fitting the console spring

// ---- core1/ml.c
function mlNormalizeAngle(a) { a = F(a); if (a < 0.0) { a = mlNormalizeAngle(-a); a = F(360.0 - a); } if (a >= 360.0) a = F(a - 360.0 * Math.trunc(a / 360.0)); return a; }
function mlDiffDegF(a, b) { let d = fsub(a, b); while (d > 180) d = fsub(d, 360); while (d <= -180) d = fadd(d, 360); return d; }
function ml_map_f(v, i0, i1, o0, o1) {
  v = F(v); i0 = F(i0); i1 = F(i1); o0 = F(o0); o1 = F(o1);
  if (i1 !== i0) { const r = fadd(fmul(fdiv(fsub(v, i0), fsub(i1, i0)), fsub(o1, o0)), o0);
    if (o0 < o1) { if (r > o1) return o1; if (r < o0) return o0; } else { if (r < o1) return o1; if (r > o0) return o0; } return r; }
  return o1;
}
const ml_max_f = (a, b) => (a > b ? a : b);
const vcopy = (v) => [v[0], v[1], v[2]];
const vsub = (a, b) => [fsub(a[0], b[0]), fsub(a[1], b[1]), fsub(a[2], b[2])];
const vadd = (a, b) => [fadd(a[0], b[0]), fadd(a[1], b[1]), fadd(a[2], b[2])];
const vscale = (a, k) => [fmul(a[0], k), fmul(a[1], k), fmul(a[2], k)];
const dot = (a, b) => fadd(fadd(fmul(a[0], b[0]), fmul(a[1], b[1])), fmul(a[2], b[2]));
const lensq = (a) => dot(a, a);
function normalize(v) { const l2 = lensq(v); if (l2 !== 0) { const inv = F(1.0 / fsqrt(l2)); return vscale(v, inv); } return vcopy(v); }
function set_length(v, len) { const m = fsqrt(lensq(v)); if (m !== 0) return vscale(v, fdiv(F(len), m)); return vcopy(v); }
function vlen(a, b) { const d = vsub(a, b); const s = lensq(d); return s !== 0 ? fsqrt(s) : 0; }          // ml_vec3f_length
function vdist(a, b) { return fsqrt(lensq(vsub(a, b))); }                                                     // ml_vec3f_distance
function func_80256E24(theta, phi, x, y, z) {
  theta = F(theta * BAD_DTOR); phi = F(phi * BAD_DTOR);
  const tmp = fadd(fmul(y, sinf(theta)), fmul(cosf(theta), z));
  return [fadd(fmul(tmp, sinf(phi)), fmul(cosf(phi), x)), fsub(fmul(y, cosf(theta)), fmul(sinf(theta), z)), fsub(fmul(tmp, cosf(phi)), fmul(sinf(phi), x))];
}
function yaw_rotate(src, yaw) { yaw = F(yaw * BAD_DTOR); const c = cosf(yaw), s = sinf(yaw);
  return [fadd(fmul(src[2], s), fmul(src[0], c)), src[1], fsub(fmul(src[2], c), fmul(src[0], s))]; }
function func_8025801C(v) { const h = fsqrt(fadd(fmul(v[2], v[2]), fmul(v[0], v[0]))); if (h < 0.01) return 0;
  let y = ml_acosf(fdiv(v[0], h)); if (v[2] < 0) y = fsub(180, y); if (v[0] < 0) y = fsub(360, y); return y; }
function hv_angles(a, b) { // ml_horizontal_and_vertical_angles(a -> b): [o1 (pitch), o2 (yaw)]
  const dx = fsub(b[0], a[0]), dy = fsub(b[1], a[1]), dz = fsub(b[2], a[2]);
  const ft2 = fadd(fmul(dx, dx), fmul(dz, dz)); const hd = fsqrt(ft2); let o2, o1;
  if (hd > 0.01) { o2 = ml_acosf(fdiv(dx, hd)); if (dz < 0) o2 = fsub(180, o2); if (dx < 0) o2 = fsub(360, o2); } else o2 = 0;
  const dist = fsqrt(fadd(fmul(dy, dy), ft2));
  if (dist > 0.01) { o1 = ml_acosf(fdiv(dy, dist)); if (hd < 0) o1 = fsub(180, o1); if (dy < 0) o1 = fsub(360, o1); } else o1 = 0;
  return [o1, o2];
}

// ---- world queries (func_80320B98 line, func_80320C94 moving sphere, func_80320DB0 sphere); end points are updated in place
function line(W, a, b, n) { return W.line(a, b, n, FLAGS); }
function func_80244D94(W, a, b, n, ext) { // line extended by ext; on a hit b = hit point pulled back by ext
  let s20 = vcopy(b); const s2c = set_length(vsub(s20, a), ext); s20 = vadd(s20, s2c);
  const t = W.line(a, s20, n, FLAGS); if (!t) return null; const r = vsub(s20, s2c); b[0] = r[0]; b[1] = r[1]; b[2] = r[2]; return t; }
function func_8024575C(W, a, b, r, n, steps) { if (r < vdist(a, b)) return null; return W.moving_sphere(a, b, r, n, steps, FLAGS); }

class Camera {
  // s: state read from RAM (see camRamState in the tools), all f32
  constructor(world, s) {
    this.W = world;
    Object.assign(this, JSON.parse(JSON.stringify(s)));
  }
  // player view: { pos, yaw, floorY }
  _target(pl) { // func_802BD4C0 (mode 2): func_802BD3CC + lead offset
    const a = vcopy(pl.pos); const fl = pl.floorY;
    if (fadd(fl, this.D974) < a[1]) a[1] = fadd(a[1], fsub(80.0, this.D974)); else a[1] = fadd(fl, 80.0);
    return vadd(a, this.D9B8);
  }
  _floorCam() { // func_802BCD60
    const s = vcopy(this.pos); const a = [s[0], fadd(s[1], 10), s[2]], b = [s[0], fadd(s[1], -600), s[2]]; const n = [0, 0, 0];
    const t = this.W.line(a, b, n, 0x800000);
    this.D9A0 = t ? b[1] : fsub(s[1], 600.0);
  }
  _lead(pl) { // func_802BCA58
    const d = vsub(pl.pos, this.pos); const yaw = pl.yaw;
    const k = ml_map_f(absf(F(mlNormalizeAngle(fsub(this.rot[1], yaw)) - 180.0)), 0, 180, this.D97C, this.D980);
    this.D9A8 = func_80256E24(0, yaw, 0, 0, ml_map_f(fsqrt(fadd(fmul(d[0], d[0]), fmul(d[2], d[2]))), 300, 450, 0, k));
    const s = vscale(vsub(this.D9A8, this.D9B8), F(0.08));
    this.D9B8 = vadd(this.D9B8, s);
  }
  _height(pl) { // func_802BD51C
    const fl = pl.floorY; const s1c = fadd(fadd(this.D9A0, 35.0), 20.0);
    if (fsub(pl.pos[1], fl) > 130.0) this.D978 = fsub(fadd(pl.pos[1], this.D99C), 130.0); else this.D978 = fadd(this.D99C, fl);
    if (this.D978 < s1c) this.D978 = s1c;
    return this.D978;
  }
  _spring(goal, frames) { // func_802BE190 / func_802BDF5C
    const p = vcopy(this.pos); const n = frames * LOOP;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const d = fsub(goal[k], p[k]); const s48 = F(this.D9EC * (0.003333 * d)); const s3c = fsub(s48, this.D9E0[k]);
        this.D9E0[k] = F(this.D9E0[k] + s3c * 0.003333 * this.D9F0);
        p[k] = p[k]; // (snap below uses the same d)
        this._d = this._d || []; this._d[k] = d;
      }
      for (let k = 0; k < 3; k++) { const v = this.D9E0[k], d = this._d[k]; if (absf(d) < absf(v) && 0.0 <= fmul(v, d)) { this.D9E0[k] = 0; p[k] = goal[k]; } }
      for (let k = 0; k < 3; k++) p[k] = fadd(p[k], this.D9E0[k]);
    }
    this.pos = p;
  }
  _pushSphere(a, r) { // func_802BE258: one push of a out of the walls
    const n = [0, 0, 0];
    if (this.W.sphere(a, r, n, FLAGS)) { if (fadd(fadd(fmul(n[0], n[0]), fmul(n[1], n[1])), fmul(n[2], n[2])) < 0.01) return;
      a[0] = fadd(a[0], fmul(1.5, n[0])); a[1] = fadd(a[1], fmul(1.5, n[1])); a[2] = fadd(a[2], fmul(1.5, n[2])); }
  }
  _collide() { // func_802BE60C -> func_802BE484(D948, pos); true when the camera position changed
    const before = vcopy(this.pos); const a0 = this.D948, a1 = this.pos;
    this._pushSphere(a0, 35.0);
    const s48 = vcopy(a0); let s3c = vcopy(a1); const s30 = vscale(normalize(vsub(s3c, s48)), 35.0); s3c = vadd(s3c, s30);
    const n = [0, 0, 0];
    const hit1 = line(this.W, s48, s3c, n);
    s3c = vsub(s3c, s30);
    const hit2 = func_8024575C(this.W, s48, s3c, 35.0, n, 3);
    if (hit1 || hit2) {
      // func_802BE384(s48, s3c, a0, a1, n)
      const s34 = vsub(a1, a0), s28 = vsub(s3c, s48), s1c = vsub(s34, s28); const dp = F(-dot(n, s1c));
      a1[0] = fadd(a1[0], fmul(dp, n[0])); a1[1] = fadd(a1[1], fmul(dp, n[1])); a1[2] = fadd(a1[2], fmul(dp, n[2]));
      const s30b = vscale(normalize(vsub(a1, a0)), 35.0); const e = vadd(a1, s30b);
      line(this.W, a0, e, [0, 0, 0]); const r = vsub(e, s30b); a1[0] = r[0]; a1[1] = r[1]; a1[2] = r[2];
    }
    return !(before[0] === this.pos[0]) || !(before[1] === this.pos[1]) || !(before[2] === this.pos[2]);
  }
  _sightCheck(pl, mode) { // func_802BC84C
    const pp = [pl.pos[0], fadd(pl.pos[1], 80.0), pl.pos[2]]; const cp = vcopy(this.pos);
    let d = vsub(pp, cp); const dir = normalize(d); let s44 = vcopy(pp);
    const dist = fsqrt(fadd(fadd(fmul(d[0], d[0]), fmul(d[1], d[1])), fmul(d[2], d[2])));
    if (1500.0 < dist) { d = vscale(dir, 1500.0); s44 = vadd(cp, d); }
    let s2c;
    switch (this.D9F6) { case 1: s2c = yaw_rotate(vscale(dir, 100.0), -90.0); break; case 2: s2c = yaw_rotate(vscale(dir, 100.0), 90.0); break;
      case 3: s2c = [0, 100, 0]; break; default: s2c = [0, 0, 0]; }
    const s20 = vadd(s2c, s44);
    if (line(this.W, cp, s20, [0, 0, 0])) { this.D9F6++; if (this.D9F6 >= 5) { this.D9F6 = 0; return this._relocate(pp, dir, dist, mode); } }
    else this.D9F6 = 0;
    return 0;
  }
  _relocate(pp, dir, dist, mode) { // func_802BC640
    let f26 = ml_max_f(150.0, fsub(dist, 100.0)); let list;
    if (mode === 1) list = [0, -25, 25, -50, 50, -80, 80, -120, 120, -140, 140]; else if (mode === 2 || mode === 3) list = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340]; else { list = [0]; f26 = 150.0; }
    for (let a of list) { if (mode === 3) a = -a;
      const s9c = yaw_rotate(vscale(dir, F(-dist)), a); const s78 = vadd(pp, s9c); const n = [0, 0, 0];
      func_80244D94(this.W, pp, s78, n, 40.0); func_8024575C(this.W, pp, s78, 40.0, n, 4);
      if (f26 < vlen(pp, s78)) { this.pos = s78; this.D9C8 = [0, 0, 0]; this.D9E0 = [0, 0, 0]; return 1; } }
    return 0;
  }
  _rotSmooth(tr, dt) { // func_802BD904
    const cr = vcopy(this.rot); const d0 = mlDiffDegF(tr[0], cr[0]), d1 = mlDiffDegF(tr[1], cr[1]);
    const s44 = [fmul(fmul(d0, dt), this.D9D4), fmul(fmul(d1, dt), this.D9D4)];
    const s38 = [fsub(s44[0], this.D9C8[0]), fsub(s44[1], this.D9C8[1])];
    s38[0] = F(this.D9D8 * (0.0333 * s38[0])); s38[1] = F(this.D9D8 * (0.0333 * s38[1]));
    this.D9C8[0] = fadd(this.D9C8[0], s38[0]); this.D9C8[1] = fadd(this.D9C8[1], s38[1]);
    let s30 = absf(this.D9C8[0]); if (absf(d0) < s30 && fmul(this.D9C8[0], d0) > 0) { this.D9C8[0] = 0; cr[0] = tr[0]; }
    s30 = absf(this.D9C8[1]); if (absf(d1) < s30 && fmul(this.D9C8[1], d1) > 0) { this.D9C8[1] = 0; cr[1] = tr[1]; }
    cr[0] = mlNormalizeAngle(fadd(cr[0], this.D9C8[0])); cr[1] = mlNormalizeAngle(fadd(cr[1], this.D9C8[1]));
    this.rot = cr;
  }
  // one game update; pl = { pos, yaw, floorY } after the player's update; frames = VIs of this update
  update(pl, frames) {
    const dt = F(Math.min(frames * (1.0 / 50), 0.06));
    this._floorCam();
    this.D948 = vcopy(this.pos);
    this._lead(pl);
    // ncDynamicCamB_update
    this.DB84 = vcopy(this.pos);
    let tgt = this._target(pl);
    const off = func_80256E24(0, this.DB70, 0, 0, this.D994);
    const goal = vadd(tgt, off); goal[1] = this._height(pl); this.DB90 = vcopy(goal);
    this._spring(goal, frames);
    let set = 0;
    if (this._collide()) {
      if (this._sightCheck(pl, 1)) set = 1;
      else { // func_802C03BC
        this.DB78 = vcopy(this.pos); const a = normalize(vsub(this.DB90, this.DB84)), b = normalize(vsub(this.DB78, this.DB84)); const k = dot(a, b);
        if (k < 0 || this.DB9C < 0) this.pos = vcopy(this.DB84);
        this.DB9C = k;
      }
      tgt = this._target(pl); this.DB70 = func_8025801C(vsub(this.pos, tgt)); // func_802C04B0
    }
    tgt = this._target(pl);
    const ang = hv_angles(tgt, this.pos); const tr = [mlNormalizeAngle(-ang[0]), ang[1], 0];
    if (set) this.rot = vcopy(tr);
    this._rotSmooth(tr, dt);
    return this.rot[1];
  }
}
// RAM layout (PAL = US decomp name + 0x9D0) for reading the state out of a savestate
const RAM_PAL = { D948: 0x8037E318, pos: 0x8037E328, rot: 0x8037E338, D974: 0x8037E344, D978: 0x8037E348, D97C: 0x8037E34C, D980: 0x8037E350,
  D984: 0x8037E354, D988: 0x8037E358, D98C: 0x8037E35C, D990: 0x8037E360, D994: 0x8037E364, D998: 0x8037E368, D99C: 0x8037E36C, D9A0: 0x8037E370,
  D9A8: 0x8037E378, D9B8: 0x8037E388, D9C8: 0x8037E398, D9D4: 0x8037E3A4, D9D8: 0x8037E3A8, D9E0: 0x8037E3B0, D9EC: 0x8037E3BC, D9F0: 0x8037E3C0,
  D9F6: 0x8037E3C6, state: 0x8037E3C4, DB40: 0x8037E510, DB70: 0x8037E540, DB78: 0x8037E548, DB84: 0x8037E554, DB90: 0x8037E560, DB9C: 0x8037E56C };
const api = { Camera, RAM_PAL, hv_angles, func_80256E24, func_8025801C };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKCAM = api;
})(typeof self !== 'undefined' ? self : this);
