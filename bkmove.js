// bkmove.js -- Banjo's ground/air movement for the Bit-Clip Lab, ported from the n64decomp banjo-kazooie sources
// (core2/ba/physics.c, bastick.c, code_12360.c, yaw.c, anctrl.c, ba/anim.c, batimer.c, bakey.c, code_C4B0.c,
// code_D9B0.c, code_15F20.c, code_9D640.c, playerutils.c, ba/falldamage.c and the bs/ states listed below).
// One call to step() is one game update, in the order of bsmethods.c func_80295C14:
//   bakey/bastick -> bs_updateState -> baphysics_update -> bafalldamage_update -> func_80293F0C (collision, BK.predict)
//   -> func_802993C8 (yaw) -> baAnim_update -> func_8028B71C (stable flag) -> func_80294E60 (slope timer).
// f32 operations are rounded with Math.fround; the C code's double constants stay double.
// States: idle, landing, walk creep/slow/walk/fast, skid, crouch, jump, fall, tumble, splat (as idle), claw (punch),
// beak barge, backflip, beak buster, roll (twirl), slide. Not modelled: water, flight, transformations, enemies that move,
// camera motion (the camera yaw is an input, held fixed or given per update), Kazooie's flap/peck.
(function (root) {
'use strict';
const BK = root.BK || (typeof require !== 'undefined' ? require('./bkcol.js') : null);
const F = Math.fround;
const fadd = (a, b) => F(a + b), fsub = (a, b) => F(a - b), fmul = (a, b) => F(a * b), fdiv = (a, b) => F(a / b);
const fsqrt = (x) => F(Math.sqrt(x));
const absf = (x) => (x > 0 ? x : -x);
const BAD_DTOR = 3.141592654 / 180.0;
const sinf = BK.lib_sinf, cosf = BK.lib_cosf, ml_acosf = BK.ml_acosf;

// ---- core1/ml.c
function mlNormalizeAngle(a) { a = F(a); if (a < 0.0) { a = mlNormalizeAngle(-a); a = F(360.0 - a); } if (a >= 360.0) a = F(a - 360.0 * Math.trunc(a / 360.0)); return a; }
function mlDiffDegF(a, b) { let d = fsub(a, b); while (d > 180) d = fsub(d, 360); while (d <= -180) d = fadd(d, 360); return d; }
function ml_map_f(v, i0, i1, o0, o1) {
  v = F(v); i0 = F(i0); i1 = F(i1); o0 = F(o0); o1 = F(o1);
  if (i1 !== i0) { const r = fadd(fmul(fdiv(fsub(v, i0), fsub(i1, i0)), fsub(o1, o0)), o0);
    if (o0 < o1) { if (r > o1) return o1; if (r < o0) return o0; } else { if (r < o1) return o1; if (r > o0) return o0; } return r; }
  return o1;
}
function ml_mapRange_f(v, i0, i1, o0, o1) { v = F(v); i0 = F(i0); i1 = F(i1); o0 = F(o0); o1 = F(o1); if (i1 !== i0) return fadd(fmul(fdiv(fsub(v, i0), fsub(i1, i0)), fsub(o1, o0)), o0); return o1; }
const ml_interpolate_f = (t, a, b) => fadd(fmul(F(t), fsub(F(b), F(a))), F(a));
const ml_clamp_f = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const ml_max_f = (a, b) => (a > b ? a : b), ml_min_f = (a, b) => (a < b ? a : b);
function rot_yaw(yaw, mag) { // func_80256D0C(0, yaw, 0, 0, mag): x = mag*sin(yaw), z = mag*cos(yaw)
  const v2 = F(F(yaw) * BAD_DTOR); const tmp = fadd(fmul(0, sinf(0)), fmul(cosf(0), F(mag)));
  return [fadd(fmul(tmp, sinf(v2)), fmul(cosf(v2), 0)), fsub(fmul(0, cosf(0)), fmul(sinf(0), F(mag))), fsub(fmul(tmp, cosf(v2)), fmul(sinf(v2), 0))];
}
function rot_pitch_yaw(pitch, yaw, mag) { // func_80256E24(dst, pitch, yaw, 0, 0, mag)
  const t = F(F(pitch) * BAD_DTOR), p = F(F(yaw) * BAD_DTOR); const tmp = fadd(fmul(0, sinf(t)), fmul(cosf(t), F(mag)));
  return [fadd(fmul(tmp, sinf(p)), fmul(cosf(p), 0)), fsub(fmul(0, cosf(t)), fmul(sinf(t), F(mag))), fsub(fmul(tmp, cosf(p)), fmul(sinf(p), 0))];
}
function yaw_of(v) { // func_8025801C: yaw of a horizontal direction, or null when shorter than 0.01
  const h = fsqrt(fadd(fmul(v[2], v[2]), fmul(v[0], v[0]))); if (h < 0.01) return null;
  let y = ml_acosf(fdiv(v[0], h)); if (v[2] < 0) y = fsub(180, y); if (v[0] < 0) y = fsub(360, y); return y;
}
function yaw_pitch_of(n) { // func_80258108
  const h = fsqrt(fadd(fmul(n[2], n[2]), fmul(n[0], n[0]))); if (h < 0.01) return null;
  let y = ml_acosf(fdiv(n[0], h)); if (n[2] < 0) y = fsub(180, y); if (n[0] < 0) y = fsub(360, y); return [y, ml_acosf(h)];
}
const ACOS_DEG = [1.0, 0.999848008, 0.999391019, 0.998629987, 0.997564018, 0.996195018, 0.994521976, 0.992546022, 0.990267992, 0.987688005, 0.984808028, 0.981626987, 0.978147984, 0.974370003, 0.970296025, 0.965925992, 0.961261988, 0.956305027, 0.951057017, 0.94551897, 0.939692974, 0.933579981, 0.927183986, 0.920504987, 0.913545012, 0.906307995, 0.898793995, 0.891007006, 0.882947981, 0.87462002, 0.866024971, 0.857167006, 0.848047972, 0.838671029, 0.829038024, 0.819151998, 0.809017003, 0.798636019, 0.788011014, 0.777145982, 0.766044021, 0.754710019, 0.743144989, 0.731353998, 0.719340026, 0.707107008, 0.694657981, 0.681998014, 0.669130981, 0.656059027, 0.642787993, 0.629320025, 0.615661979, 0.601814985, 0.587785006, 0.573575974, 0.559193015, 0.544638991, 0.529919028, 0.515038013, 0.5, 0.484809995, 0.469471991, 0.453990996, 0.438371003, 0.422618002, 0.406737, 0.390731007, 0.374606997, 0.358368009, 0.342020005, 0.325567991, 0.309017003, 0.292371988, 0.275637001, 0.258819014, 0.241922006, 0.224950999, 0.207911998, 0.190808997, 0.173648, 0.156434, 0.139173001, 0.121868998, 0.104528002, 0.0871559978, 0.0697569996, 0.0523359999, 0.0348990001, 0.0174519997, 0].map(F);
function ml_acosf_deg(x) {
  x = F(x); let sign = 1; if (x < 0) { sign = -1; x = -x; } let up = 0, lo = 91;
  for (;;) { const idx = Math.trunc((up + lo) / 2); if (x > ACOS_DEG[idx]) lo = idx; else up = idx; if (up + 1 === lo) break; }
  if (up === 90) return 0; const res = fadd(fdiv(fsub(x, ACOS_DEG[up]), fsub(ACOS_DEG[lo], ACOS_DEG[up])), up); return sign > 0 ? res : fsub(180, res);
}

// ---- surface type (code_9D640.c): 3 = ice-like (friction 0.05)
const MAP_SURF = { 0x1: [1, 7, 6, 5, 1], 0x2: [1, 5, 6, 1, 1], 0x7: [2, 5, 6, 1, 1], 0x26: [1, 5, 1, 1, 1], 0xB: [1, 9, 10, 8, 1], 0xD: [8, 11, 1, 1, 1],
  0x12: [2, 6, 1, 1, 1], 0x13: [6, 1, 1, 6, 1], 0x14: [6, 1, 1, 1, 1], 0x15: [6, 1, 1, 1, 1], 0x16: [6, 1, 1, 1, 1], 0x1A: [6, 1, 1, 1, 1], 0x1B: [1, 7, 6, 12, 5],
  0x21: [1, 9, 10, 8, 1], 0x22: [1, 9, 10, 8, 1], 0x23: [1, 9, 10, 8, 1], 0x27: [3, 5, 3, 1, 1], 0x31: [9, 10, 5, 6, 1], 0x46: [3, 1, 1, 1, 1], 0x72: [1, 8, 11, 3, 5],
  0x6F: [1, 3, 3, 1, 1], 0x40: [1, 6, 5, 3, 7] };
const FLAG_SURF = { 0x0: 1, 0x100: 10, 0x200: 9, 0x300: 6, 0x400: 5, 0x500: 3, 0x600: 7, 0x700: 8, 0x800: 2, 0x900: 11 };
function surface_type(map, flags) {
  if (flags & 0x80000000) { const k = flags & 0x1F00; return FLAG_SURF[k] ?? 1; }
  let s = 0; if (flags & 0x200) s = 1; if (flags & 0x400) s = 2; if (flags & 0x800) s = 3; if (flags & 0x1000) s = 4;
  const t = MAP_SURF[map]; return t ? t[s] : 1;
}
const FRICTION = [0.0, 0.07, 0.29, 0.15, 0.05].map(F); // commonParticle.c D_80371E30, indexed by floor type

// ---- states (enums.h bs_e)
const S = { IDLE: 0x1, WALK_SLOW: 0x2, WALK: 0x3, WALK_FAST: 0x4, JUMP: 0x5, CLAW: 0x6, CROUCH: 0x7, SKID: 0xC, BBUSTER: 0xF, BFLIP: 0x12, BBARGE: 0x13,
  WALK_CREEP: 0x1F, LANDING: 0x20, FALL: 0x2F, ROLL: 0x31, SLIDE: 0x32, TUMBLE: 0x3D, SPLAT: 0x72,
  BFLAP: 0x10, BPECK: 0x11, OW: 0xE, WW_ENTER: 0x1A, WW_IDLE: 0x1B, WW_WALK: 0x1C, WW_JUMP: 0x1D, WW_EXIT: 0x1E, SHOCK_CHARGE: 0x21, SHOCK_JUMP: 0x22, DIVE_IDLE: 0x2B, DIVE_B: 0x2C, SWIM_IDLE: 0x2D, SWIM: 0x2E, DIVE_ENTER: 0x30, DIVE_A: 0x39, LAND_WATER: 0x4C, DIVE_OW: 0x7F, TROT_ENTER: 0x14, TROT_IDLE: 0x15, TROT_WALK: 0x16, TROT_EXIT: 0x17, TROT_JUMP: 0x08, TROT_FALL: 0x71, TROT_SLIDE: 0x45 };
const SNAME = {}; for (const k in S) SNAME[S[k]] = k;
const PHYS = { NONE: 0, UNK1: 1, NORMAL: 2, LOCKED: 4, AIRBORN: 6, NOGRAV: 9, MOVECLEAR: 5 }; // LOCKED = BA_PHYSICS_LOCKED_ROTATION; MOVECLEAR = BA_PHYSICS_UNK4; NOGRAV = BA_PHYSICS_NO_GRAVITY // physics types used here
const ONCE = 1, LOOP = 2, STOPPED = 4;

class AnimCtrl {
  constructor() { this.type = LOOP; this.dur = F(2); this.timer = 0; this.anim = 0; this.sub0 = 0; this.sub1 = F(1); this.start = 0; this.def = true; this.dir = 1; this.id = 0; }
  reset() { this.type = LOOP; this.def = true; this.timer = 0; this.start = 0; this.sub0 = 0; this.sub1 = F(1); this.dur = F(2); this.dir = 1; }
  play(id, dur, type, start) { this.reset(); this.id = id; this.dur = F(dur); this.type = type; if (start !== undefined) { this.start = F(start); this.def = false; } this.go(); }
  setStart(s) { this.start = F(s); this.def = false; }
  go() { this.anim = this.def ? (this.dir ? 0 : F(0.99999899)) : this.start; this.timer = this.anim; }
  setSub(a, b) { this.sub0 = F(a); this.sub1 = F(b); }
  update(dt) {
    if (this.type === ONCE) {
      this.timer = this.anim; let d = fdiv(dt, this.dur); if (!this.dir) d = -d; let t = fadd(this.timer, d);
      if (t < 0) { t = 0; this.type = STOPPED; }
      else if (this.sub1 < t || 0.999999 < t) { if (this.sub1 < t) t = this.sub1; if (0.999999 < t) t = F(0.9999989867210388); this.type = STOPPED; }
      else t = fsub(t, F(Math.trunc(t)));
      this.anim = t;
    } else if (this.type === LOOP) {
      this.timer = this.anim; let d = fdiv(dt, this.dur); if (!this.dir) d = -d; let t = fadd(this.timer, d); if (t < 0) t = fadd(t, 1); t = fsub(t, F(Math.trunc(t))); this.anim = t;
    }
  }
  isAt(x) { x = F(x); const f0 = this.anim; if (f0 === this.timer) return false;
    if (this.dir) return this.timer < f0 ? (this.timer <= x && x < f0) : (this.timer <= x || x < f0);
    return f0 < this.timer ? (x <= this.timer && f0 < x) : (x <= this.timer || f0 < x); }
  stopped() { return this.type === STOPPED; }
}

class Player {
  // o: {map, pos, vel, yaw, cam, version ('PAL'|'NTSC'), state, grounded}
  constructor(world, o = {}) {
    this.world = world; this.map = o.map ?? 0; this.cam = F(o.cam ?? 0);
    this.pos = (o.pos || [0, 0, 0]).map(F); this.vel = (o.vel || [0, (o.grounded ?? true) ? -1 : 0, 0]).map(F);  // standing Banjo has vy = -1 (every grounded update sets it)
    this.yaw = F(o.yaw ?? 0); this.ideal = F(o.yawIdeal ?? this.yaw); this.yawState = 1; this.yawB = [F(700), F(7.5)]; this.yawU = F(360);
    this.yawMode = 1; this.yawThresh = 0;
    this.ptype = PHYS.NORMAL; this.thv = 0; this.tyaw = this.ideal; this.grav = F(-2700); this.term = F(-4000);
    this.zones = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); this.stick = { x: 0, y: 0, dist: 0, angle: 0, zone: 0, zp: 0 };
    this.keys = { A: [0, 1], B: [0, 1], Z: [0, 1], Cl: [0, 1], Cr: [0, 1], R: [0, 1] }; // [held count, released count]; Cl = C-Left
    this.timers = new Float32Array(8); this.timersLast = new Float32Array(8);
    this.anim = new AnimCtrl(); this.anim.play(0x6F, 5.5, ONCE);
    this.grounded = o.grounded ?? true; this.stable = this.grounded; this.floorType = this.grounded ? 2 : 1; this.holdCounter = 0;
    this.tracker = new BK.Tracker({ unk28: this.pos, mode: o.trackerMode ?? 2 }); if (o.trackerMode === 1) this.tracker.set_mode(1); // 1 = fresh tracker (finds water above) this.slopeTimer = 0; this.stateTimer5 = 0; this.stateTimer6 = 0;
    this.fallStart = this.pos.slice(); this.fallState = 0; this.dpos = [0, 0, 0];
    this.state = 0; this.prevState = 0; this.nextState = 0; this.v = {}; // per-state locals
    this.update = 0; this.flags = { A: false, B: false, C: false }; this.hasFlapped = false; this.hasPecked = false;
    this.abil = Object.assign({ flap: true, peck: true, buster: true, wonderwing: true, shock: true, dive: true }, o.abilities || {});
    this.feathers = o.feathers ?? 0; this.onPad = false; this.colMode = 1; this.waterBelow = false; this.inWater = false; this.canJumpOut = false; this.accel = 0; this.tvel = [0, 0, 0];
    this.pitch = 0; this.pitchIdeal = 0; this.pitchLim = F(500); this.pitchVel = F(0.8); this.diveCd = 0; this.wallHits = 0; this.wallN = [0, 0, 0];
    this.colHT = F(80); this.colRT = F(35); this.colH = F(80); this.colR = F(35); // D_8037C1F0 (target) / D_8037C1F8 (eased 1 unit per update): func_80293D48(height, radius) // pitch.c, bainput_diveCooldown, D_8037C27D/D_8037C258
    this.gtimer = o.gtimer ?? null; this.rate = (o.version || 'PAL') === 'NTSC' ? 60 : 50; this.cap = this.rate === 60 ? 0.05 : 0.06;
    // one collision probe so the tracker knows the floor under the start position
    const r = BK.predict(world, this.pos, this.pos, { grounded: this.grounded, tracker: this.tracker });
    this.grounded = !!r.grounded; this.stable = this.grounded; this.floorType = this.grounded ? this._groundType() : 1;
    if (this.tracker.unk59) { const wy = this.tracker.posY; this.waterBelow = this.pos[1] < wy; this.inWater = this.waterBelow && this.pos[1] < fsub(fsub(wy, 50), 2);
      if (this.waterBelow && this.pos[1] < fsub(wy, 70)) this.floorType = 3; }
    this.setState(o.state ?? S.IDLE);
  }
  // ---- helpers
  dtOf(frames) { return F(Math.min(frames * (1.0 / this.rate), this.cap)); }
  pressed(k) { return this.keys[k][0] === 1; } held(k) { return this.keys[k][0] > 0; } released(k) { return this.keys[k][1] > 0; }
  floorY() { return this.tracker.posX; } floorN() { return this.tracker.norm; } floorFlags() { return this.tracker.unk4C | 0; }
  shouldFall() { return 60.0 < fsub(this.pos[1], this.floorY()); }
  isStable() { return this.stable && this.vel[1] < 0; }
  isAboveFloorBy(n) { return this.isStable() || (this.vel[1] < 0 && fsub(this.pos[1], this.floorY()) < n); } // func_8028B254
  isSliding() { return this.stateTimer5 > 0 || this.slopeTimer === 1.0; }
  isActive() { return !!(this.floorFlags() & 0x10) || !!(this.floorFlags() & 0x40); }
  stickRel() { return mlNormalizeAngle(F(F(this.cam + this.stick.angle) + 90.0)); } // viewport_adjustAngleToRight
  hvel() { return fsqrt(fadd(fmul(this.vel[0], this.vel[0]), fmul(this.vel[2], this.vel[2]))); }
  slowerThan(a) { return fadd(fmul(this.vel[0], this.vel[0]), fmul(this.vel[2], this.vel[2])) <= fmul(F(a), F(a)); }
  hvelPct() { const h = this.hvel(), t = this.thv; return h < t ? fdiv(h, t) : F(1); }
  setIdeal(a) { this.ideal = mlNormalizeAngle(a); } setYaw(a) { this.yaw = mlNormalizeAngle(a); }
  setTimer(i, v) { this.timers[i] = F(v); this.timersLast[i] = F(v); }
  decTimer(i) { this.timersLast[i] = this.timers[i]; if (this.timers[i] === 0) return false; this.timers[i] = ml_max_f(0, fsub(this.timers[i], this.dt)); return this.timers[i] === 0; }
  setUpdateTypes(yawState, yawMode, ptype) { this.yawState = yawState; this.yawMode = yawMode; this.ptype = ptype; }
  setHVel(yaw, mag) { const v = rot_yaw(yaw, mag); this.vel[0] = v[0]; this.vel[1] = v[1]; this.vel[2] = v[2]; } // func_80256D0C writes y too (0)
  walkTarget() { // func_802B6D00 (no mud)
    const zp = this.stick.zp; switch (this.stick.zone) {
      case 0: this.thv = 0; break; case 1: this.thv = ml_interpolate_f(zp, 30, 80); break; case 2: this.thv = ml_interpolate_f(zp, 80, 150); break;
      case 3: this.thv = ml_interpolate_f(zp, 150, 225); break; case 4: this.thv = ml_interpolate_f(zp, 225, 500); break; }
  }
  canFlap() { return !this.hasFlapped && !this.hasPecked && this.abil.flap; } // can_feathery_flap
  canPeck() { return !this.hasPecked && !this.hasFlapped && this.abil.peck; } // can_peck
  jumpType() { return this.held('Z') ? S.BFLIP : S.JUMP; }
  _groundType() { const t = surface_type(this.map, this.tracker.unk4C | 0); return t === 3 ? 4 : 2; }
  // ---- input (bakey_update, bastick_update)
  readInput(inp) {
    for (const k of ['A', 'B', 'Z', 'Cl', 'Cr', 'R']) { const h = !!inp[k]; const c = this.keys[k]; c[0] = h ? c[0] + 1 : 0; c[1] = c[0] ? 0 : c[1] + 1; }
    const norm = (v, mn, mx) => { v = Math.trunc(v || 0); if (v > 0) { v = v > mx ? mx : v < mn ? mn : v; v = Math.trunc(((v - mn) * 80) / (mx - mn)); }
      else if (v < 0) { v = v < -mx ? -mx : v > -mn ? -mn : v; v = Math.trunc(((v + mn) * 80) / (mx - mn)); } return fmul(F(1 / 80), v); };
    const s = this.stick; s.x = norm(inp.sx, 7, 59); s.y = norm(inp.sy, 7, 61);
    s.dist = fsqrt(fadd(fmul(s.x, s.x), fmul(s.y, s.y)));
    if (s.dist !== 0) { s.angle = ml_acosf(fdiv(s.y, s.dist)); if (s.x < 0) s.angle = fsub(180, s.angle); if (s.y < 0) s.angle = fsub(360, s.angle); }
    if (s.dist > 1.0) s.dist = F(1);
    const z = this.zones, d = s.dist; const zp = (a, b) => fdiv(fsub(d, a), fsub(b, a));
    if (d <= z[0]) { s.zone = 0; s.zp = 0; } else if (d <= z[1]) { s.zone = 1; s.zp = zp(z[0], z[1]); } else if (d <= z[2]) { s.zone = 2; s.zp = zp(z[1], z[2]); }
    else if (d <= z[3]) { s.zone = 3; s.zp = zp(z[2], z[3]); } else if (d <= z[4]) { s.zone = 4; s.zp = zp(z[3], z[4]); }
  }
  // ---- state machine (code_13780.c)
  setState(id) { if (this._wt) { const w = this._wt; this._wt = null; const t = w.call(this); if (t) id = t; } if (!id) return; this.nextState = id; const e = this.END[this.state]; if (e) e.call(this); this.prevState = this.state; this.state = id; this.nextState = 0; this.v = {}; const i = this.INIT[id]; if (i) i.call(this); }
  // ---- physics (ba/physics.c)
  physics() {
    if (this.ptype === PHYS.NORMAL) this.tyaw = mlNormalizeAngle(this.ideal);
    else if (this.ptype === PHYS.AIRBORN) { if (0 < this.stick.dist) this.tyaw = mlNormalizeAngle(this.stickRel()); }
    else if (this.ptype === PHYS.NONE) { this.lastD = [0, 0, 0]; return this.pos.slice(); }
    else if (this.ptype === PHYS.MOVECLEAR) { const d = this.vel.map(v => fmul(v, this.dt)); this.vel = [0, 0, 0]; this.lastD = d; return [fadd(this.pos[0], d[0]), fadd(this.pos[1], d[1]), fadd(this.pos[2], d[2])]; } // func_8029740C
    else if (this.ptype === PHYS.NOGRAV) { // __baphysics_update_no_gravity: velocity eases to the 3D target velocity (this.tvel) at this.accel
      const k = fmul(this.dt, this.accel); const dv = [0, 1, 2].map(i => fmul(fsub(this.tvel[i], this.vel[i]), k));
      if (fadd(fadd(fmul(dv[0], dv[0]), fmul(dv[1], dv[1])), fmul(dv[2], dv[2])) < 0.02) this.vel = this.tvel.slice(); else this.vel = [0, 1, 2].map(i => fadd(this.vel[i], dv[i]));
      const d = this.vel.map(v => fmul(v, this.dt)); this.lastD = d; return [fadd(this.pos[0], d[0]), fadd(this.pos[1], d[1]), fadd(this.pos[2], d[2])]; }
    else if (this.ptype === PHYS.UNK1) { // func_802971DC: plain ballistic flight (the cauldron launch)
      this.vel[1] = fadd(this.vel[1], fmul(this.dt, this.grav)); if (this.vel[1] < this.term) this.vel[1] = this.term;
      const d = this.vel.map(v => fmul(v, this.dt)); this.lastD = d; return [fadd(this.pos[0], d[0]), fadd(this.pos[1], d[1]), fadd(this.pos[2], d[2])]; }
    const dt = this.dt; const tv = rot_yaw(this.tyaw, this.thv); let s60 = [tv[0], 0, tv[2]]; const s6c = [this.vel[0], 0, this.vel[2]];
    if (this.grounded) {
      const n = this.floorN(); const l2 = fadd(fadd(fmul(s60[0], s60[0]), 0), fmul(s60[2], s60[2]));
      let s48 = s60.slice(); if (l2 !== 0) { const inv = F(1.0 / fsqrt(l2)); s48 = s60.map(x => fmul(x, inv)); }
      const s44 = fadd(fadd(fmul(s48[0], n[0]), fmul(s48[1], n[1])), fmul(s48[2], n[2])); let s40 = F(this.slopeTimer * 1.0);
      if (s44 !== 0) {
        if (s44 < 0) { s40 = this.isActive() ? ml_map_f(s40, 0, 1, F(s44 * 0.5), -1) : F(0.5 * s44); const k = F(1.0 + s40); s60 = s60.map(x => fmul(x, k)); }
        else { s40 = F(s44 * 0.2); const k = F(s40 + 1.0); s60 = s60.map(x => fmul(x, k)); }
      }
    }
    const fr = (this.frOv4 && this.floorType === 4) ? F(0.24) : FRICTION[this.floorType]; const k = F(dt / 0.0333333);  // talon trot: func_8029CF48(4, 1, 0.24)
    const d84 = [fmul(fsub(fmul(s60[0], fr), fmul(s6c[0], fr)), k), fmul(fsub(fmul(s60[1], fr), fmul(s6c[1], fr)), k), fmul(fsub(fmul(s60[2], fr), fmul(s6c[2], fr)), k)];
    this.vel[0] = fadd(this.vel[0], d84[0]); this.vel[1] = fadd(this.vel[1], d84[1]); this.vel[2] = fadd(this.vel[2], d84[2]);
    const dl = [this.vel[0], 0, this.vel[2]];
    if (absf(this.vel[0]) < 0.0001) this.vel[0] = 0; if (absf(this.vel[2]) < 0.0001) this.vel[2] = 0;
    this.vel[1] = fadd(this.vel[1], fmul(dt, this.grav)); if (this.vel[1] < this.term) this.vel[1] = this.term;
    dl[1] = fadd(dl[1], this.vel[1]); const d = dl.map(x => fmul(x, dt)); this.lastD = d;
    return [fadd(this.pos[0], d[0]), fadd(this.pos[1], d[1]), fadd(this.pos[2], d[2])];
  }
  // ---- yaw (yaw.c, code_12360.c)
  yawStep() {
    const m = this.yawMode, sd = this.stick.dist;
    if (m === 1) { if (sd !== 0) this.setIdeal(this.stickRel()); } else if (m === 5) { if (sd !== 0) this.setIdeal(fadd(this.stickRel(), 180)); }
    else if (m === 4) { if (sd !== 0) { this.setIdeal(this.stickRel()); this.setYaw(this.ideal); } }
    else if (m === 7) { if (sd !== 0) { const a = this.stickRel(); if (this.yawThresh <= absf(mlDiffDegF(this.ideal, a))) this.setIdeal(this.stickRel()); } }
    else if (m === 0 || m === 2) return;
    const dt = this.dt;
    const limited = (lim, pct) => {
      const mx = fmul(F(lim), dt); let d = fsub(this.ideal, this.yaw); if (180 < absf(d)) d = F(d + (d < 0 ? 360.0 : -360.0));
      let v = fmul(fmul(d, F(pct)), dt); v = v < 0 ? ml_clamp_f(v, -mx, F(-0.1)) : ml_clamp_f(v, F(0.1), mx);
      this.yaw = absf(v) <= absf(d) ? fadd(this.yaw, v) : this.ideal; this.wrapYaw();
    };
    if (this.yawState === 1) limited(700, 7.5); else if (this.yawState === 3) limited(this.yawB[0], this.yawB[1]);
    else if (this.yawState === 2) { const a = fmul(this.yawU, dt); let d = fsub(this.ideal, this.yaw); if (absf(d) > 180) d = F(d + (d < 0 ? 360.0 : -360.0));
      const s = absf(d) > 180 ? a : (d < 0 ? -a : a); this.yaw = absf(s) <= absf(d) ? fadd(this.yaw, s) : this.ideal; this.wrapYaw(); }
  }
  // first-person twirl: in C-Up view each 2 VI of full stick turns the view by exactly 3.6 degrees (+ = stick left); leaving first
  // person faces Banjo along the view. e = norm(yaw + 180); e = norm(e +- 3.6) per step; yaw = norm(e + 180). Measured natively on the
  // 810 routes (research/810/fptap, offline-search s12/s13); a lag update while turning gives 5.4 degrees and is not modelled here.
  fpTwirl(m) { const nrm = a => { if (a >= 360) a = F(a - 360); if (a < 0) a = F(a + 360); return a; }; const sg = m < 0 ? -1 : 1;
    let e = nrm(F(this.yaw + 180)); for (let i = 0; i < Math.abs(m); i++) e = nrm(F(e + F(sg * 3.6))); const y = nrm(F(e + 180));
    this.yaw = y; this.ideal = y; this.tyaw = y; }
  pitchStep() { // __pitch_update
    const dt = this.dt, mx = fmul(this.pitchLim, dt); let d = fsub(this.pitchIdeal, this.pitch); if (180.0 < absf(d)) d = F(d + (d < 0 ? 360.0 : -360.0));
    let v = fmul(fmul(d, this.pitchVel), dt); v = v < 0 ? ml_clamp_f(v, -mx, F(-0.1)) : ml_clamp_f(v, F(0.1), mx);
    this.pitch = absf(v) <= absf(d) ? fadd(this.pitch, v) : this.pitchIdeal;
    if (this.pitch < 360.0) { if (this.pitch < 0.0) this.pitch = F(this.pitch + 360.0); } else this.pitch = F(this.pitch - 360.0);
  }
  wrapYaw() { if (this.yaw < 360.0) { if (this.yaw < 0.0) this.yaw = F(this.yaw + 360.0); } else this.yaw = F(this.yaw - 360.0); }
  // ---- one update
  step(inp = {}, frames = 2) {
    if (inp.cam !== undefined) this.cam = F(inp.cam);
    if (inp.pad !== undefined) this.onPad = !!inp.pad;  // standing on a shock spring pad (BA_FLAG_2_ON_SPRING_PAD, set by the pad's marker)
    if (this.world.timeline) this.world.tick(frames);  // recorded moving objects: this update's frame
    if (inp.fp) { this.fpTwirl(inp.fp); inp = {}; }  // first-person (C-Up) twirl, then a normal standing update
    // crouch-face to an exact facing (Z, Z + stick, release): in the game the facing is the camera-relative stick angle, so a
    // route can give the facing itself (taken from BizHawk); then a normal standing update
    if (inp.face != null) { const y = mlNormalizeAngle(F(inp.face)); this.yaw = y; this.ideal = y; this.tyaw = y; inp = {}; }
    this.dt = this.dtOf(frames); this.update++; const old = this.pos.slice();
    this.readInput(inp);
    if (this.diveCd !== 0) this.diveCd = ml_max_f(fsub(this.diveCd, this.dt), 0); // bainput_update
    const u = this.UPDATE[this.state]; if (u) { this._wt = WATER_TO[this.state] || null; u.call(this); this._wt = null; }
    const tgt = this.physics();
    this.canJumpOut = false; // D_8037C27E
    const d238 = [fsub(tgt[0], old[0]), fsub(tgt[1], old[1]), fsub(tgt[2], old[2])]; // D_8037C238: taken before the water clamp below
    if (this.colMode === 3 && this.tracker.unk59 && tgt[1] > fsub(this.tracker.posY, 70)) { tgt[1] = fsub(this.tracker.posY, 70); this.canJumpOut = true; this.vel[1] = F(1); }
    if (this.preCollide) this.preCollide(tgt); // module hook (e.g. climbing, collision mode 5: func_80293440)
    // bafalldamage_update: runs after physics, before collision (uses the stable flag from the previous update and the uncollided position)
    if (this.isStable()) { this.fallStart = tgt.map(F); }
    this.fallHeight = Math.trunc(F(this.fallStart[1] - F(tgt[1])));
    // collision (func_80293F0C)
    // ghost mode (route search pre-pass): no collision at all, Banjo flies through everything
    // ghost 'flat': the floor is taken as flat at the current floor height and nothing else is solid (fast run-ups)
    if (this.gtimer != null) { this.tracker.timer_odd = this.gtimer & 1; this.gtimer++; } // gGlobalTimer (1 per update): deep-water floor tracker (mode 4) alternates floor / water rays
    const ease = (t, c) => (c < t ? ml_min_f(t, fadd(c, 1)) : t < c ? ml_max_f(t, fsub(c, 1)) : c); // func_80293EAC
    this.colH = ease(this.colHT, this.colH); this.colR = ease(this.colRT, this.colR);
    const r = this.ghost === 'flat' ? { result: [tgt[0], this.floorY(), tgt[2]], grounded: true, hold_counter_after: 0, held: false, hits: 0, result_bits: null }
      : this.ghost ? { result: tgt, grounded: false, hold_counter_after: 0, held: false, hits: 0, result_bits: null }
      : BK.predict(this.world, old, tgt, { grounded: this.grounded, tracker: this.tracker, hold_counter: this.holdCounter, height: this.colH, radius: this.colR, d238 });
    const res = r.result.map(F); this.pos = res; this.grounded = !!r.grounded; this.holdCounter = r.hold_counter_after;
    this.wallHits = r.hits | 0; if (r.last_n) this.wallN = r.last_n.map(F); else if (!r.hits) this.wallN = [0, 0, 0];
    const fy = this.floorY(); const wy = this.tracker.posY; if (this.tracker.unk59) this.waterBelow = res[1] < wy; // D_8037C278 (water surface, not the floor)
    if (this.waterBelow && res[1] < fsub(wy, 70)) { this.floorType = 3; if (this.grounded && this.vel[1] < 0) this.vel[1] = F(-1); }
    else if (this.grounded) { this.floorType = this._groundType(); if (this.vel[1] < 0) this.vel[1] = F(-1); }
    else this.floorType = 1;
    this.dpos = [fsub(res[0], old[0]), fsub(res[1], old[1]), fsub(res[2], old[2])];
    this.pitchStep(); // pitch_update (roll is cosmetic)
    this.yawStep();
    this.anim.update(this.dt);
    this.inWater = this.waterBelow && res[1] < (this.inWater ? fadd(fsub(wy, 50), 2) : fsub(fsub(wy, 50), 2)); // func_8028B59C
    this.stable = this.grounded; // func_8028B71C
    if (this.isStable() || this.inWater) { this.hasPecked = false; this.hasFlapped = false; } // func_80294E60
    this.slope(); // func_80294E60 -> func_80294BDC
    if (this.world.meshes) this.world.meshes.tick(this.dt); // gsworld_update -> func_8034C9D4 (animated map vertices, bkmesh.js), after the player
    let tag = r.held ? 'HOLD' : r.hits > 0 ? 'PUSH' : this.grounded ? 'GROUND' : 'AIR';
    return { update: this.update, frames, dt: this.dt, state: this.state, stateName: SNAME[this.state] || ('0x' + this.state.toString(16)), target: tgt, pos: res.slice(), vel: this.vel.slice(),
      yaw: this.yaw, ideal: this.ideal, thv: this.thv, grounded: this.grounded ? 1 : 0, hits: r.hits, held: r.held, tag, floorY: fy, bits: r.result_bits };
  }
  slope() {
    if (this.stateTimer5 > 0) this.stateTimer5 = ml_max_f(0, fsub(this.stateTimer5, this.dt)); if (this.stateTimer6 > 0) this.stateTimer6 = ml_max_f(0, fsub(this.stateTimer6, this.dt));
    const deg = ml_acosf_deg(this.floorN()[1]); const k = ml_map_f(deg, 20, 60, 0.6, 1.3); let fl = this.floorFlags();
    if (this.map === 0xC) { /* Tickers tower doubles the rate */ }
    const dt = this.map === 0xC ? F(this.dt * 2.0) : this.dt;
    if (fl & 0x50) this.slopeTimer = ml_min_f(fadd(fmul(dt, k), this.slopeTimer), F(1)); else this.slopeTimer = 0;
    if (this.slopeTimer === 1.0) { if (fl & 0x10) this.stateTimer5 = F(0.18); else if (fl & 0x40) this.stateTimer6 = F(0.18); }
  }
}

// ---- state methods (bs/*.c), bound to Player
// (talon trot states are at the end of the file)

const INIT = {}, UPDATE = {}, END = {};
const P = Player.prototype; P.INIT = INIT; P.UPDATE = UPDATE; P.END = END;

// ---- feathery flap (bs/bFlap.c): A in the air after a jump / fall
const FLAP_DUR = [0.15, 0.2, 0.27, 0.38, 0.4]; // func_802A2858 (default 0.7)
INIT[S.BFLAP] = function () {
  this.anim.play(0x18, 0.3, ONCE); this.setUpdateTypes(1, 1, PHYS.NORMAL);
  if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  this.walkTarget(); this.setHVel(this.ideal, this.thv); this.vel[1] = 0; this.grav = F(-1100);
  this.hasFlapped = true; this.setTimer(0, 2.5); this.v.cnt = 0; this.v.t1 = 0; this.v.t0 = 0; this.v.ph = 0;
};
P._flapTick = function (counting) { // bafalldamage_start, func_802A2900, func_802A2810, func_802A28CC
  this.fallStart = this.pos.slice(); this.v.t0 = this.v.t1; this.v.t1 = fadd(this.v.t1, this.dt);
  if (counting) { if (this.anim.isAt(0.9)) this.v.cnt++; this.anim.dur = F(this.v.cnt < 5 ? FLAP_DUR[this.v.cnt] : 0.7); }
};
UPDATE[S.BFLAP] = function () {
  let n = 0; this.walkTarget(); const a = this.anim;
  switch (this.v.ph) {
    case 0: this._flapTick(false);
      if (a.isAt(0.9)) { a.reset(); a.id = 0x17; a.dur = F(this.v.cnt < 5 ? FLAP_DUR[this.v.cnt] : 0.7); a.type = LOOP; a.setStart(0); a.go();
        this.vel[1] = F(280); this.grav = F(-1100); this.term = F(-399.9); this.v.ph = 1; } break;
    case 1: this._flapTick(true); if (0.67 <= this.v.t1) this.v.ph = 2; break;
    case 2: this._flapTick(true); if (this.v.cnt === 4) this.v.ph = 3;
      if (this.released('A')) { this.grav = F(-2700); this.term = F(-4000); a.dur = F(1); this.v.ph = 4; } break;
    case 3: this._flapTick(true);
      if (this.released('A')) { this.grav = F(-2700); this.term = F(-4000); a.dur = F(1); this.v.ph = 4; }
      else this.thv = F(this.thv * 0.35); break;
    case 4: if (this.fallHeight > 1000 && !this.isStable()) n = S.TUMBLE; break;
  }
  this.decTimer(0); if (this.timers[0] === 0) n = S.FALL;
  if (this.pressed('Z')) n = S.BBUSTER; if (this.isStable()) n = S.WALK_SLOW; this.setState(n);
};
END[S.BFLAP] = function () { this.grav = F(-2700); this.term = F(-4000); };
// ---- mid-air peck / rat-a-tat rap (bs/bPeck.c): B in the air
INIT[S.BPECK] = function () {
  this.v.trot = this.prevState === S.TROT_JUMP; this.anim.play(0x1A, 0.2, ONCE);
  this.setUpdateTypes(3, 1, PHYS.AIRBORN); this.yawB = [F(1200), F(10)]; this.grav = F(-1400); this.vel[1] = F(120); this.v.n = 0; this.v.ph = 0;
};
P._peck = function () { this.hasPecked = true; this.vel[1] = F(120); this.v.n++; }; // func_802A664C
UPDATE[S.BPECK] = function () {
  let n = 0; const a = this.anim; this.walkTarget(); if (this.v.trot) this.thv = F(this.thv * 0.1);
  switch (this.v.ph) {
    case 0: if (a.isAt(0.9126)) { a.id = 0x19; a.setStart(0); a.dur = F(0.35); a.type = LOOP; a.go(); this.v.t = F(0.5); this.v.ph = 1; } break;
    case 1: if (a.isAt(0.1621)) this._peck(); if (a.isAt(0.7)) this._peck(); this.v.t = fsub(this.v.t, this.dt);
      if (this.v.t < 0) { a.reset(); a.id = 0x1A; a.dir = 0; a.dur = F(0.2); a.type = ONCE; a.go(); this.v.ph = 2; } break;
    case 2: if (a.stopped()) n = S.FALL; break;
  }
  if (this.isStable()) n = S.IDLE; this.setState(n);
};
END[S.BPECK] = function () { this.grav = F(-2700); };

// ---- getting hit (bs/ow.c + rebound.c func_802B360C): knocked away from a hazard. hit(src, type): type = BA_REBOUND_x id
const REBOUND = { 1: [1, 510, -1200, 200], 2: [1, 600, -1500, 300], 3: [1, 510, -1200, 100], 4: [1, 510, -1200, 200], 5: [1, 510, -1200, 300], 6: [1, 510, -1200, 400],
  7: [1, 510, -1200, 500], 8: [1, 600, -1500, 100], 9: [1, 600, -1500, 200], 0xA: [1, 600, -1500, 300], 0xB: [1, 600, -1500, 400], 0xC: [1, 600, -1500, 500],
  0xD: [2, 300, -1200, 0], 0xF: [1, 300, -1200, 0] }; // code_117D0.c s_rebound_list: [unk1, vy, gravity, horizontal speed]
P.hit = function (src, type) { this.hitSrc = src.map(F); this.hitType = type; this.setState(DIVE_SET.has(this.state) ? S.DIVE_OW : S.OW); };
P._knockback = function () { // func_802B360C (non-launch types)
  const rb = REBOUND[this.hitType] || REBOUND[1]; this.v.rb = rb; const yw = yaw_of([fsub(this.pos[0], this.hitSrc[0]), 0, fsub(this.pos[2], this.hitSrc[2])]) ?? 0;
  this.setIdeal(F(yw + 180.0)); this.thv = F(rb[3]); this.tyaw = yw; this.setHVel(yw, this.thv); this.vel[1] = F(rb[1]); this.grav = F(rb[2]);
  this.setUpdateTypes(1, 2, rb[0] === 2 ? PHYS.AIRBORN : PHYS.LOCKED); this.yaw = this.ideal;
};
INIT[S.OW] = function () { this.anim.reset(); this.anim.setSub(0, 0.5344); this.anim.id = 0x4D; this.anim.dur = F(1.7); this.anim.type = ONCE; this.anim.go(); this._knockback(); this.v.ph = 0; };
UPDATE[S.OW] = function () {
  let n = 0; if (this.v.rb[0] === 2) this.walkTarget(); // func_802B37DC
  if (this.v.ph === 0 && this.isAboveFloorBy(0x5A)) { this.anim.setSub(0, 1); this.v.ph = 1; }
  if (this.fallHeight > 1000 && !this.isStable()) n = S.TUMBLE; if (this.isStable()) n = S.WALK_SLOW; this.setState(n);
};
END[S.OW] = function () { this.grav = F(-2700); };
// ---- wonderwing (bs/bWhirl.c): crouch + C-Right with gold feathers; Z held keeps it (Z released -> exit); one feather every 2 s
P.wwTarget = function () { this.thv = this.stick.zone ? ml_interpolate_f(this.stick.zp, 80, 425) : 0; }; // func_802AA400
const WW_SET = new Set([S.WW_IDLE, S.WW_WALK, S.WW_JUMP, S.WW_EXIT]);
P.wwEnd = function () { if (!WW_SET.has(this.nextState)) this.zones = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); };
P.wwFeather = function (n) { this.wwT = fadd(this.wwT || 0, this.dt); if (2.0 < this.wwT) { this.wwT = 0; this.feathers--; if (this.feathers < 0) { this.feathers = 0; n = S.WW_EXIT; } } return n; }; // func_802AA58C
P.wwNext = function (n) { if (this.stick.zone > 0) n = S.WW_WALK; if (this.released('Z')) n = S.WW_EXIT; if (this.pressed('A') && this.isStable()) n = S.WW_JUMP; return n; }; // func_802AA510
INIT[S.WW_ENTER] = function () { this.anim.play(0x22, 0.5, ONCE); this.setUpdateTypes(1, 1, PHYS.NORMAL); this.thv = 0; this.zones[0] = F(0.03); this.zones[1] = F(1.0); this.wwT = 0; };
UPDATE[S.WW_ENTER] = function () { this.setState(this.anim.stopped() ? S.WW_IDLE : 0); };
END[S.WW_ENTER] = P.wwEnd;
INIT[S.WW_IDLE] = function () { this.anim.play(0x23, 1.0, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); this.thv = 0; };
UPDATE[S.WW_IDLE] = function () { let n = this.wwNext(0); n = this.wwFeather(n); if (this.isSliding()) n = S.SLIDE; this.setState(n); };
END[S.WW_IDLE] = P.wwEnd;
INIT[S.WW_WALK] = function () { this.anim.play(0x11, 0.53, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); };
UPDATE[S.WW_WALK] = function () {
  let n = 0; this.wwTarget(); if (!this.stick.zone && this.slowerThan(1)) n = S.WW_IDLE; if (this.released('Z')) n = S.WW_EXIT;
  if (this.pressed('A') && this.isStable()) n = S.WW_JUMP; n = this.wwFeather(n); if (this.isSliding()) n = S.SLIDE; this.setState(n);
};
END[S.WW_WALK] = P.wwEnd;
INIT[S.WW_JUMP] = function () {
  this.anim.reset(); this.anim.id = 0x1B; this.anim.dur = F(0.8); this.anim.setStart(0.14); this.anim.setSub(0, 0.4495); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.AIRBORN); if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  this.wwTarget(); this.setHVel(this.ideal, this.thv); this.vel[1] = F(693.5); this.grav = F(-1200); this.v.ph = 0;
};
UPDATE[S.WW_JUMP] = function () {
  let n = 0; this.wwTarget(); if (this.released('A') && 0 < this.vel[1]) this.grav = F(-2700);
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(0x82)) { this.anim.setSub(0, 1); this.anim.dur = F(0.8); this.anim.type = ONCE; this.v.ph = 1; } break;
    case 1: if (this.isStable()) this.v.ph = 2; break;
    case 2: if (this.anim.stopped()) n = S.WW_IDLE; n = this.wwNext(n); break;
  }
  n = this.wwFeather(n); this.setState(n);
};
END[S.WW_JUMP] = function () { this.grav = F(-2700); this.wwEnd(); };
INIT[S.WW_EXIT] = function () { this.anim.reset(); this.anim.dir = 0; this.anim.id = 0x22; this.anim.dur = F(0.5); this.anim.type = ONCE; this.anim.go(); this.yawMode = 2; this.thv = 0; };
UPDATE[S.WW_EXIT] = function () { this.setState(this.anim.stopped() ? S.IDLE : 0); };
END[S.WW_EXIT] = P.wwEnd;
// ---- shock spring jump (bs/bShock.c): jump on a shock pad (inp.pad) -> charge; A still held at anim 0.3637 -> 1250 u/s jump
INIT[S.SHOCK_CHARGE] = function () {
  this.anim.reset(); this.anim.id = 0x48; this.anim.dur = F(4.2); this.anim.setSub(0, 0.1061); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.AIRBORN); if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  this.walkTarget(); this.setHVel(this.ideal, this.thv); this.pos[1] = fadd(this.pos[1], -50); this.v.dn = true; this.v.go = true; this.v.ph = 0;
};
UPDATE[S.SHOCK_CHARGE] = function () {
  let n = 0; const a = this.anim; this.walkTarget(); if (this.released('A') && 0 < this.vel[1]) this.grav = F(-2700);
  if (this.v.ph === 0) { if (this.fallHeight > 1000 && !this.isStable()) n = S.TUMBLE; if (this.isAboveFloorBy(0x82)) { a.setSub(0, 1); a.dur = F(2.8); a.type = ONCE; this.v.ph = 1; } }
  else { if (a.isAt(0.4036)) a.dur = F(1.4); if (a.stopped()) n = S.IDLE; }
  if (this.isAboveFloorBy(0x3C)) { if (a.timer < 0.3637 && this.released('A')) this.v.go = false; if (this.isStable()) this.thv = 0; }
  else { if (this.pressed('A') && this.canFlap()) n = S.BFLAP; if (this.pressed('Z')) n = S.BBUSTER; }
  if (a.isAt(0.3637) && this.v.go) n = S.SHOCK_JUMP;
  if (a.isAt(0.5551)) { this.vel[1] = F(180); if (this.v.dn) { this.pos[1] = fadd(this.pos[1], 50); this.v.dn = false; } }
  this.setState(n);
};
END[S.SHOCK_CHARGE] = function () { if (this.v.dn) this.pos[1] = fadd(this.pos[1], 50); };
INIT[S.SHOCK_JUMP] = function () {
  this.anim.reset(); this.anim.id = 0x49; this.anim.dur = F(0.8); this.anim.setStart(0.5304); this.anim.setSub(0, 1); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.AIRBORN); if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  this.walkTarget(); this.setHVel(this.ideal, this.thv); this.vel[1] = F(1250); this.grav = F(-1200); this.pos[1] = fadd(this.pos[1], -50); this.v.ph = 0;
};
UPDATE[S.SHOCK_JUMP] = function () {
  let n = 0; this.walkTarget(); if (this.anim.isAt(0.7) && this.released('A') && 0 < this.vel[1]) this.grav = F(-2700);
  if (this.v.ph === 0 && this.vel[1] < 0) n = S.FALL;
  if (!this.isStable()) { if (this.fallHeight > 1000) n = S.TUMBLE; if (this.pressed('A') && this.canFlap()) n = S.BFLAP; if (this.pressed('Z')) n = S.BBUSTER; }
  this.setState(n);
};
END[S.SHOCK_JUMP] = function () { if (this.nextState !== S.BPECK) this.grav = F(-2700); this.pos[1] = fadd(this.pos[1], 50); };

// ---- water (bs/swim.c, bs/bSwim.c landing; collision mode 3 in code_C4B0.c func_80293F0C; player_inWater in playerutils.c)
// Each land/air state's own "if (player_inWater()) next = ..." check, applied to the value it passes to setState.
const toSwim = function () { return this.inWater ? S.SWIM_IDLE : 0; }, toLand = function () { return this.inWater ? S.LAND_WATER : 0; };
const WATER_TO = {};
for (const id of [S.IDLE, S.WALK_CREEP, S.WALK_SLOW, S.WALK, S.WALK_FAST, S.CROUCH, S.LANDING, S.TROT_IDLE, S.TROT_WALK, S.WW_IDLE, S.WW_WALK]) WATER_TO[id] = toSwim;
for (const id of [S.CLAW, S.BBARGE, S.ROLL, S.SLIDE, S.FALL, S.BFLAP, S.BPECK, S.BBUSTER, S.TUMBLE, S.TROT_JUMP, S.TROT_SLIDE, S.WW_JUMP]) WATER_TO[id] = toLand;
WATER_TO[S.JUMP] = function () { return this.vel[1] < 0 && this.inWater ? S.LAND_WATER : 0; };
WATER_TO[S.SHOCK_CHARGE] = WATER_TO[S.JUMP];
WATER_TO[S.OW] = function () { return this.inWater && this.vel[1] <= 0 ? S.LAND_WATER : 0; };
const SWIM_SET = new Set([S.SWIM_IDLE, S.SWIM, S.LAND_WATER]);   // bsswim_inset
P.enteredWater = function () { this.grav = F(100); this.term = F(133.33); this.zones[0] = F(0.03); this.zones[1] = F(1.0); this.colMode = 3; }; // __bsswim_enteredWater
P.swimEnd = function () { if (!SWIM_SET.has(this.nextState)) { this.term = F(-4000); this.grav = F(-2700); this.zones = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); this.colMode = 1; } };
INIT[S.LAND_WATER] = function () {
  let h = fsub(this.fallStart[1], this.tracker.posY); if (this.prevState === S.BBUSTER) h = ml_max_f(h, 600); // func_8029494C
  if (h > 80) { this.anim.reset(); this.anim.id = 0x4F; this.anim.type = STOPPED; this.anim.dur = F(1.2); this.anim.setStart(0.8204); this.anim.go(); }
  else { this.anim.reset(); this.anim.id = 0x57; this.anim.type = LOOP; this.anim.dur = F(1.2); this.anim.setStart(0.6412); this.anim.go(); }
  this.v.vy = ml_map_f(h, 40, 1000, -300, -1200); this.vel[1] = this.v.vy;
  this.setUpdateTypes(3, 3, PHYS.AIRBORN); this.grav = 0; this.term = F(-399.99); this.zones[0] = F(0.03); this.zones[1] = F(1.0); this.colMode = 3; this.accel = F(2); // func_802A744C
};
UPDATE[S.LAND_WATER] = function () {
  let n = 0; if (this.v.vy < 0) { this.v.vy = F(this.v.vy + ml_max_f(absf(this.v.vy) * 0.1, 50.0)); this.vel[1] = this.v.vy; }
  if (this.isStable()) n = S.SWIM_IDLE; if (!this.inWater) n = S.IDLE; if (this.vel[1] >= 0) n = S.SWIM_IDLE; this.setState(n);
};
END[S.LAND_WATER] = function () { this.diveEnd(); }; // func_802A75B0
INIT[S.SWIM_IDLE] = function () {
  if (DIVE_SET.has(this.prevState)) this.diveCd = F(0.7); // bainput_setDiveCooldown(4, 0.7)
  if (this.anim.id === 0x57 && this.prevState !== S.LAND_WATER) { this.anim.id = 0x57; this.anim.type = LOOP; this.anim.dur = F(1.2); }
  else { this.anim.reset(); this.anim.id = 0x57; this.anim.type = LOOP; this.anim.setStart(0.3); this.anim.dur = F(1.2); this.anim.go(); }
  this.setUpdateTypes(3, 3, PHYS.NORMAL); this.yawB = [F(500), F(5)]; this.thv = 0; this.enteredWater();
};
UPDATE[S.SWIM_IDLE] = function () {
  let n = 0; if (this.stick.zone === 1) n = S.SWIM; if (!this.inWater) n = S.IDLE; if (this.shouldDive()) n = S.DIVE_ENTER; if (this.canJumpOut && this.pressed('A')) n = S.JUMP; this.setState(n);
};
END[S.SWIM_IDLE] = P.swimEnd;
INIT[S.SWIM] = function () {
  if (this.anim.id !== 0x39) { this.anim.reset(); this.anim.id = 0x39; this.anim.setStart(0.8); this.anim.type = LOOP; this.anim.go(); }
  this.yawState = 3; this.yawB = [F(500), F(5)]; this.yawMode = 1; this.ptype = PHYS.NORMAL;
};
UPDATE[S.SWIM] = function () {
  let n = 0; this.thv = this.stick.zone ? ml_interpolate_f(this.stick.zp, 30, 300) : 0; // __bsswim_updateVelocity
  if (this.stick.zone === 0) n = S.SWIM_IDLE; if (!this.inWater) n = S.IDLE;
  if (this.wallHits && this.abil.dive && this.wallN[1] < -0.7 && fsub(this.tracker.posY, this.pos[1]) > 90.0) n = S.DIVE_ENTER; // swim into a ceiling-facing surface
  if (this.shouldDive()) n = S.DIVE_ENTER; if (this.canJumpOut && this.pressed('A')) n = S.JUMP; this.setState(n);
};
END[S.SWIM] = P.swimEnd;
// ---- underwater (bs/bSwim.c): NO_GRAVITY physics, velocity eases to a 3D target at `accel`; pitch from stick Y, yaw from stick X
const DIVE_SET = new Set([S.DIVE_IDLE, S.DIVE_B, S.DIVE_A, S.DIVE_ENTER, S.DIVE_OW]); // bsbswim_inSet (+ drone/die states)
P.shouldDive = function () { return this.pressed('B') && this.diveCd === 0 && this.abil.dive; }; // bainput_should_dive
P.diveSetup = function () { // func_802A744C
  this.grav = 0; this.term = F(-399.99); this.zones[0] = F(0.03); this.zones[1] = F(1.0); this.colMode = 3; this.accel = F(2); };
P.diveEnd = function () { // func_802A75B0
  if (!DIVE_SET.has(this.nextState)) { this.pitchIdeal = 0; this.term = F(-4000); this.grav = F(-2700); this.zones = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); this.colMode = 1; } };
P.speed3 = function () { const v = this.vel; return ml_map_f(fsqrt(fadd(fadd(fmul(v[0], v[0]), fmul(v[1], v[1])), fmul(v[2], v[2]))), 50, 200, 0, 1); }; // func_802A716C
P.diveYaw = function () { // func_802A71D8 (per update, not scaled by dt)
  const sx = this.stick.x, k = this.speed3(); let yr;
  if (this.held('R')) { yr = 4.3; this.yawB = [F(250), F(20)]; } else { yr = ml_interpolate_f(k, 3.1, 2.4); this.yawB = [F(90), ml_interpolate_f(k, 3.8, 2.2)]; }
  this.setIdeal(fadd(this.ideal, ml_map_f(sx, -1, 1, yr, F(-yr)))); };
P.divePitch = function () { // func_802A7304
  this.pitchLim = ml_interpolate_f(this.speed3(), 70, 30); this.pitchVel = F(0.9); const sy = this.stick.y;
  this.pitchIdeal = mlNormalizeAngle(sy < 0 ? ml_map_f(sy, -1, 0, 275, 360) : ml_map_f(sy, 0, 1, 0, 85)); };
P.diveSurfacing = function () { return this.tracker.unk59 && this.pos[1] > fsub(this.tracker.posY, 130); }; // bsbdive_surfacing (CCW winter uses 90)
P.diveDrive = function () { const v = rot_pitch_yaw(this.pitch, this.yaw, this.v.spd); this.tvel = v.slice(); this.vel = v.slice(); }; // func_802A77D8
P.diveCommon = function (n) { if (this.diveSurfacing()) n = S.SWIM_IDLE; if (!this.inWater) n = S.IDLE; return n; };
INIT[S.DIVE_ENTER] = function () { // bsSwim_dive_init
  this.anim.play(0x3C, 1.0, ONCE); this.setUpdateTypes(3, 3, PHYS.NOGRAV); this.yawB = [F(500), F(5)]; this.tvel = [0, 0, 0]; this.diveSetup();
  this.pitchLim = F(200); this.pitchVel = F(2.5); this.v.ph = 0; };
UPDATE[S.DIVE_ENTER] = function () {
  let n = 0;
  if (this.v.ph === 0) { this.pitchIdeal = F(50); if (this.anim.isAt(0.7247)) { this.vel = rot_pitch_yaw(this.pitch, this.yaw, 800); this.setTimer(1, 0.8); this.v.ph = 1; } }
  else if (this.decTimer(1)) n = S.DIVE_IDLE;
  if (!this.inWater) n = S.IDLE; this.setState(n); };
END[S.DIVE_ENTER] = P.diveEnd;
INIT[S.DIVE_IDLE] = function () { this.anim.play(0x70, 2.0, LOOP); this.setUpdateTypes(3, 3, PHYS.NOGRAV); this.tvel = [0, 0, 0]; this.diveSetup(); this.accel = F(0.4); };
UPDATE[S.DIVE_IDLE] = function () {
  let n = 0; this.diveYaw(); this.divePitch(); if (this.held('A')) n = S.DIVE_A; if (this.held('B')) n = S.DIVE_B; this.setState(this.diveCommon(n)); };
END[S.DIVE_IDLE] = P.diveEnd;
INIT[S.DIVE_B] = function () { // bsbdiveb_init: one big stroke per loop (600, -10 per update)
  this.anim.reset(); this.anim.id = 0x3F; this.anim.setStart(0.4626); this.anim.dur = F(1.0); this.anim.go();
  this.setUpdateTypes(3, 3, PHYS.NOGRAV); this.diveSetup(); this.v.spd = 0; this.accel = F(1); };
UPDATE[S.DIVE_B] = function () {
  let n = 0; const a = this.anim; this.diveYaw(); this.divePitch();
  if (this.v.spd > 0) { this.diveDrive(); this.v.spd = ml_max_f(fsub(this.v.spd, 10), 0); }
  if (a.isAt(0.1)) this.v.spd = F(600); if (a.isAt(0.4626)) a.dur = F(1.0); if (a.isAt(0.2766)) a.dur = F(3.0);
  if (!this.held('B')) { if (this.held('A')) { if (a.anim <= 0.4625 && 0.1 < a.anim) n = S.DIVE_A; } else if (a.isAt(0.4625)) n = S.DIVE_IDLE; }
  if (a.isAt(0.4625) && !this.held('B')) n = this.held('A') ? S.DIVE_A : S.DIVE_IDLE;
  this.setState(this.diveCommon(n)); };
END[S.DIVE_B] = P.diveEnd;
INIT[S.DIVE_A] = function () { this.anim.play(0x71, 0.75, LOOP); this.setUpdateTypes(3, 3, PHYS.NOGRAV); this.diveSetup(); this.v.spd = F(120); this.accel = F(2); };
UPDATE[S.DIVE_A] = function () { // steady paddle at 120
  let n = 0; this.diveYaw(); this.divePitch(); this.diveDrive();
  if (this.anim.isAt(0.99)) { if (!this.held('A')) n = S.DIVE_IDLE; if (this.held('B')) n = S.DIVE_B; }
  this.setState(this.diveCommon(n)); };
END[S.DIVE_A] = P.diveEnd;
INIT[S.DIVE_OW] = function () { // bsbswim_ow_init
  const rb = REBOUND[this.hitType] || REBOUND[1]; this.anim.play(0x1A0, 1.4, ONCE);
  const yw = yaw_of([fsub(this.pos[0], this.hitSrc[0]), 0, fsub(this.pos[2], this.hitSrc[2])]) ?? 0;
  this.setIdeal(yw); this.yaw = this.ideal; this.thv = F(rb[3]); this.tyaw = yw; this.setHVel(yw, this.thv); this.setUpdateTypes(1, 2, PHYS.LOCKED); this.diveSetup(); };
UPDATE[S.DIVE_OW] = function () { this.setState(this.anim.stopped() ? S.DIVE_IDLE : 0); };
END[S.DIVE_OW] = P.diveEnd;
function standNext(r) { // func_802B488C
  switch (this.stick.zone) { case 1: r = S.WALK_CREEP; break; case 2: r = S.WALK_SLOW; break; case 3: r = S.WALK; break; case 4: r = S.WALK_FAST; break; }
  if (this.held('Z')) r = S.CROUCH; if (this.pressed('B')) r = S.CLAW; if (this.pressed('A')) r = this.jumpType(); if (this.isSliding()) r = S.SLIDE; return r;
}
INIT[S.IDLE] = function () { this.anim.play(0x6F, 5.5, ONCE); this.setUpdateTypes(1, 1, PHYS.NORMAL); this.thv = 0; this.v.rot = 0; };
UPDATE[S.IDLE] = function () {
  if (this.stick.zone === 0 && this.stick.dist > 0) { this.v.rot = 1; this.yawState = 3; this.yawB = [F(200), F(14)]; }
  else { if (this.v.rot) this.setIdeal(this.yaw); this.v.rot = 0; this.yawState = 1; }
  this.setState(standNext.call(this, 0));
};
INIT[S.SPLAT] = INIT[S.IDLE]; UPDATE[S.SPLAT] = UPDATE[S.IDLE];
INIT[S.LANDING] = function () { this.setUpdateTypes(1, 1, PHYS.NORMAL); this.thv = 0; };
UPDATE[S.LANDING] = function () { let r = 0; if (this.anim.stopped()) r = S.IDLE; this.setState(standNext.call(this, r)); };
function walkCommon(next) {
  if (this.isAboveFloorBy && this.shouldFall()) next = S.FALL; if (this.held('Z')) next = S.CROUCH;
  if (this.pressed('B')) next = (225 < this.thv) ? S.ROLL : S.CLAW;
  if (this.pressed('A')) next = this.jumpType(); if (this.isSliding()) next = S.SLIDE; return next;
}
const skidCheck = function () { return 135.0 < absf(mlDiffDegF(this.ideal, this.yaw)) && 125.0 < this.hvel(); };
for (const id of [S.WALK_CREEP, S.WALK_SLOW, S.WALK, S.WALK_FAST]) INIT[id] = function () { this.anim.play(id, 0.66, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); if (id === S.WALK || id === S.WALK_FAST) this.v.t = F(0.3); };
UPDATE[S.WALK_CREEP] = function () {
  let n = 0; if (this.stick.dist === 0) this.setIdeal(this.yaw); this.walkTarget();
  switch (this.stick.zone) { case 0: if (this.slowerThan(1)) n = S.IDLE; break; case 2: n = S.WALK_SLOW; break; case 3: n = S.WALK; break; case 4: n = S.WALK_FAST; break; }
  this.setState(walkCommon.call(this, n));
};
UPDATE[S.WALK_SLOW] = function () {
  let n = 0; if (this.stick.dist === 0) this.setIdeal(this.yaw); this.walkTarget();
  switch (this.stick.zone) { case 0: if (this.slowerThan(3)) n = S.IDLE; break; case 1: n = S.WALK_CREEP; break; case 3: n = S.WALK; break; case 4: n = S.WALK_FAST; break; }
  this.setState(walkCommon.call(this, n));
};
UPDATE[S.WALK] = function () {
  let n = 0; this.v.t = ml_max_f(0, fsub(this.v.t, this.dt)); this.walkTarget();
  switch (this.stick.zone) { case 0: case 1: case 2: if (this.slowerThan(150) && this.v.t === 0) n = S.WALK_SLOW; break; case 4: n = S.WALK_FAST; break; }
  if (skidCheck.call(this)) n = S.SKID; this.setState(walkCommon.call(this, n));
};
UPDATE[S.WALK_FAST] = function () {
  let n = 0; this.v.t = ml_max_f(0, fsub(this.v.t, this.dt)); this.walkTarget();
  switch (this.stick.zone) { case 0: if (this.slowerThan(18)) n = S.IDLE; break; case 1: case 2: if (this.slowerThan(150)) n = S.WALK_SLOW; break;
    case 3: if (this.slowerThan(225) && this.v.t === 0) n = S.WALK; break; }
  if (skidCheck.call(this)) n = S.SKID; this.setState(walkCommon.call(this, n));
};
INIT[S.SKID] = function () { this.anim.play(0xE, 0.3, ONCE); this.yawState = 1; this.yawMode = 2; this.ptype = PHYS.LOCKED; this.v.h0 = this.hvel(); };
UPDATE[S.SKID] = function () {
  this.thv = ml_map_f(this.anim.anim, 0.18, 1.0, this.v.h0, 0); let n = 0; if (this.anim.stopped()) n = S.WALK_FAST;
  if (this.held('Z')) n = S.CROUCH; if (this.pressed('B')) n = S.CLAW; if (this.pressed('A')) n = this.jumpType(); this.setState(n);
};
END[S.SKID] = function () { this.setYaw(fsub(this.yaw, 180)); };
INIT[S.CROUCH] = function () {
  this.anim.reset(); this.anim.id = 1; this.anim.dur = F(0.5); this.anim.type = ONCE; this.anim.setStart(0); this.anim.go();
  this.yawState = 3; this.yawB = [F(350), F(14)]; this.yawMode = 7; this.yawThresh = F(8); this.ptype = PHYS.LOCKED;
  this.setTimer(0, 0.7); this.setTimer(1, 0.2); this.v.h0 = this.hvel(); { const y = yaw_of(this.vel); if (y !== null) this.tyaw = mlNormalizeAngle(y); } // bscrouch_init: target yaw = velocity direction whenever it has one (the 140 check is only the sound)
};
UPDATE[S.CROUCH] = function () {
  this.decTimer(0); this.decTimer(1); this.thv = ml_map_f(this.timers[0], 0, 0.3, 0, this.v.h0);
  let n = 0; if (this.isSliding()) n = S.SLIDE; if (this.shouldFall()) n = S.FALL;
  if (this.released('Z')) { n = S.IDLE; if (this.pressed('B')) n = S.CLAW; if (this.pressed('A')) n = this.jumpType(); }
  else { if (this.pressed('Cl')) n = S.TROT_ENTER; if (this.pressed('Cr') && this.abil.wonderwing && this.feathers > 0) n = S.WW_ENTER; if (this.pressed('A')) n = S.BFLIP; if (this.pressed('B')) n = S.BBARGE; }
  if (n === S.IDLE && this.timers[1] !== 0) n = 0; this.setState(n);
};
INIT[S.JUMP] = function () {
  this.anim.reset(); this.anim.id = 8; this.anim.dur = F(1.9); this.anim.setStart(0.3); this.anim.setSub(0, 0.5042); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.AIRBORN); if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  this.walkTarget(); this.setHVel(this.ideal, this.thv); this.vel[1] = F(this.prevState === S.SWIM_IDLE || this.prevState === S.SWIM ? 610 : 710); this.grav = F(-1350); this.v.ph = 0;
  this.v.pad = this.onPad && this.abil.shock; // D_8037D4C2
};
UPDATE[S.JUMP] = function () {
  let n = 0; this.walkTarget();
  if (this.released('A') && 0 < this.vel[1] && !this.v.pad) this.grav = F(-2700);
  if (this.v.ph === 0) { if (this.anim.stopped()) { this.anim.setSub(0, 0.6667); this.anim.dur = F(4); this.anim.type = ONCE; this.v.ph = 1; }
    if (this.isAboveFloorBy(0x82)) { this.anim.setSub(0, 1); this.anim.dur = F(1.4); this.anim.type = ONCE; this.v.ph = 2; } }
  else if (this.v.ph === 1) { if (500 < fsub(this.pos[1], this.floorY())) n = S.FALL; if (this.v.pad) { this.v.pad = false; n = S.SHOCK_CHARGE; } if (this.isAboveFloorBy(0x5A)) { this.anim.setSub(0, 1); this.anim.dur = F(2); this.anim.type = ONCE; this.v.ph = 2; } }
  if (this.released('A')) this.v.pad = false;
  if (this.fallHeight > 1000 && !this.isStable()) n = S.TUMBLE;
  if (this.pressed('A') && this.canFlap()) n = S.BFLAP; if (this.pressed('B') && this.canPeck()) n = S.BPECK;
  if (this.pressed('Z')) n = S.BBUSTER; if (this.isStable()) n = S.LANDING; this.setState(n);
};
END[S.JUMP] = function () { if (this.nextState !== S.BPECK) this.grav = F(-2700); };
INIT[S.FALL] = function () { this.anim.play(0xB0, 0.38, LOOP); this.setUpdateTypes(1, 3, PHYS.AIRBORN); this.v.ph = 0; };
UPDATE[S.FALL] = function () {
  let n = 0; this.walkTarget();
  if (this.v.ph === 0 && this.isAboveFloorBy(0x5A)) { this.anim.reset(); this.anim.id = 8; this.anim.dur = F(2); this.anim.setStart(0.6667); this.anim.type = ONCE; this.anim.go(); this.v.ph = 1; }
  if (this.fallHeight > 1000 && !this.isStable()) n = S.TUMBLE;
  if (this.pressed('A') && this.canFlap() && !this.hasPecked) n = S.BFLAP; if (this.pressed('B') && this.canPeck()) n = S.BPECK;
  if (this.pressed('Z')) n = S.BBUSTER; if (this.isStable()) n = S.LANDING; this.setState(n);
};
INIT[S.TUMBLE] = function () { this.anim.play(0x68, 0.35, LOOP); this.setUpdateTypes(1, 3, PHYS.AIRBORN); this.setTimer(0, 0.5); this.setTimer(1, 0.41); };
UPDATE[S.TUMBLE] = function () { let n = 0; this.decTimer(1); this.decTimer(0); this.walkTarget(); if (this.timers[0] !== 0 && this.pressed('Z')) n = S.BBUSTER; if (this.isStable()) n = S.SPLAT; this.setState(n); };
INIT[S.CLAW] = function () { this.anim.play(5, 1.3, ONCE); this.setUpdateTypes(1, 3, PHYS.LOCKED); this.tyaw = mlNormalizeAngle(this.ideal); this.thv = F(160); };
UPDATE[S.CLAW] = function () {
  let n = 0; if (this.anim.isAt(0.5788)) this.thv = 0; if (this.anim.stopped()) n = S.IDLE; if (!this.isStable()) n = S.FALL; if (this.pressed('A')) n = this.jumpType(); this.setState(n);
};
INIT[S.BBARGE] = function () {
  this.anim.reset(); this.anim.id = 0x1C; this.anim.dur = F(1); this.anim.setSub(0, 0.375); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.LOCKED); this.tyaw = mlNormalizeAngle(this.ideal); this.thv = F(this.thv * 0.3); this.setHVel(this.ideal, this.thv);
  this.v.ph = 0; this.flags.A = this.flags.B = this.flags.C = false; this.setTimer(2, 0.01); this.v.spd = 0;
};
UPDATE[S.BBARGE] = function () {
  let n = 0; if (this.released('B')) this.flags.A = true;
  switch (this.v.ph) {
    case 0: if (!this.anim.stopped()) break; if (!this.flags.A) { this.flags.C = true; this.v.spd = F(850); } else this.v.spd = F(500); this.setTimer(1, 0.01); this.v.ph = 1; break;
    case 1: this.decTimer(1); if (!this.flags.B && this.timers[1] < 0.1) this.flags.B = true; if (this.timers[1] !== 0) break;
      this.anim.dur = F(1); this.anim.setSub(0, 0.565); this.anim.type = ONCE; this.thv = this.v.spd; this.setHVel(this.ideal, this.thv); this.v.ph = 2; break;
    case 2: this.thv = this.v.spd; if (this.anim.stopped()) { this.anim.dur = F(2); this.anim.setSub(0, 0.6); this.anim.type = ONCE; this.setTimer(0, 0.1); this.v.ph = 3; } break;
    case 3: this.decTimer(0); if (!this.flags.C || this.timers[0] === 0) this.v.spd = fsub(this.v.spd, 80); this.thv = this.v.spd;
      if (this.v.spd < 200) { this.anim.dur = F(1.5); this.anim.setSub(0, 1); this.anim.type = ONCE; this.v.ph = 4; } break;
    case 4: if (!this.isStable()) n = S.FALL; if (this.anim.isAt(0.7)) this.v.spd = 0; this.thv = this.v.spd; if (this.anim.isAt(0.9193)) n = S.LANDING; break;
  }
  this.setState(n);
};
INIT[S.BFLIP] = function () {
  this.anim.reset(); this.anim.id = 0x4B; this.anim.dur = F(2.3); this.anim.setSub(0, 0.7866); this.anim.setStart(0); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 2, PHYS.LOCKED); this.zones[0] = F(0.03); this.zones[1] = F(1.0); this.v.ph = 0;
};
UPDATE[S.BFLIP] = function () {
  let n = 0; const a = this.anim;
  switch (this.v.ph) {
    case 0: if (a.isAt(0.1837)) {
      if (this.stick.dist !== 0) { this.yawState = 2; this.yawMode = 3; this.setIdeal(this.stickRel()); let d = fsub(this.ideal, this.yaw); if (180 < absf(d)) d = F(d + (d < 0 ? 360.0 : -360.0)); this.yawU = absf(fdiv(d, F(1)));
        this.ptype = PHYS.AIRBORN; this.tyaw = mlNormalizeAngle(this.ideal); this.thv = F(200); this.setHVel(this.ideal, this.thv); }
      else { this.ptype = PHYS.AIRBORN; this.thv = 0; }
      this.vel[1] = F(920); this.grav = F(-1200); this.term = F(-533.3); a.dur = F(1.9); this.v.ph = 1; } break;
    case 1: this.thv = this.stick.zone ? ml_interpolate_f(this.stick.zp, 80, 200) : 0;
      if (a.stopped()) { a.play(0x4C, 0.13, LOOP); this.v.ph = 2; } if (this.pressed('Z')) n = S.BBUSTER; break;
    case 2: if (this.released('A')) { a.play(0x61, 0.8, ONCE); this.term = F(-4000); this.v.ph = 3; }
      if (this.isStable()) { this._flipLand(); n = this._afterLand(n); this.v.ph = 4; } else if (this.pressed('Z')) n = S.BBUSTER; break;
    case 3: if (this.isStable()) { this._flipLand(); n = this._afterLand(n); this.v.ph = 4; } else if (this.pressed('Z')) n = S.BBUSTER; break;
    case 4: if (a.stopped()) n = S.WALK_SLOW; n = this._afterLand(n); break;
  }
  this.setState(n);
};
P._flipLand = function () { this.anim.reset(); this.anim.id = 0x4B; this.anim.dur = F(2.2); this.anim.setStart(0.8566); this.anim.type = ONCE; this.anim.go(); this.ptype = PHYS.LOCKED; this.thv = 0; this.vel = [0, 0, 0]; };
P._afterLand = function (n) { if (this.pressed('A')) n = this.jumpType(); if (this.pressed('B')) n = S.CLAW; if (this.held('Z') && this.pressed('B')) n = S.BBARGE; if (this.isSliding()) n = S.SLIDE; return n; }; // func_8029C9C0
END[S.BFLIP] = function () { this.grav = F(-2700); this.term = F(-4000); this.zones = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); };
INIT[S.BBUSTER] = function () {
  this.anim.reset(); this.anim.id = 0x1D; this.anim.dur = F(1.02); this.anim.setSub(0, 0.35); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.AIRBORN); this.grav = 0; this.thv = 0; this.vel = [0, 0, 0]; this.v.t = F(0.0001); this.v.ph = 0; this.v.still = 0;
};
UPDATE[S.BBUSTER] = function () {
  let n = 0; switch (this.v.ph) {
    case 0: if (this.anim.stopped()) { this.anim.dur = F(0.4); this.v.ph = 1; } break;
    case 1: this.v.t = fsub(this.v.t, this.dt); if (this.v.t <= 0) { this.term = F(-5000); this.grav = F(-20000); this.vel[1] = F(2300); this.v.ph = 2; } break;
    case 2: this.v.still = absf(this.dpos[1]) < 1.0 ? this.v.still + 1 : 0;
      if (this.isStable() || !(this.v.still < 4)) { this.vel = [0, 0, 0]; this.grav = 0; this.thv = 0; this.v.t = F(0.09); this.v.ph = 3; this.v.landed = this.update; } break;
    case 3: this.v.t = fsub(this.v.t, this.dt); if (this.v.t <= 0) { this.vel[1] = F(730); this.grav = F(-2110); this.anim.setSub(0, 0.7299); this.anim.dur = F(1.9); this.anim.type = ONCE; this.v.ph = 4; } break;
    case 4: this.walkTarget(); if (this.anim.stopped()) { this.anim.setSub(0, 0.74); this.anim.dur = F(15); this.anim.type = ONCE; }
      if (this.isStable()) { this.anim.setSub(0, 1); this.anim.dur = F(1.9); this.anim.type = ONCE; n = S.LANDING; } break;
  }
  this.setState(n);
};
END[S.BBUSTER] = function () { this.grav = F(-2700); this.term = F(-4000); };
INIT[S.ROLL] = function () {
  this.anim.reset(); this.anim.id = 0x4F; this.anim.dur = F(0.9); this.anim.type = ONCE; this.anim.go(); this.yawState = 1; this.yawMode = 3;
  this.tyaw = mlNormalizeAngle(this.ideal); this.setHVel(this.ideal, this.thv); this.ptype = PHYS.LOCKED; this.thv = F(600); this.setTimer(0, 0.01); this.v.ph = 0;
};
UPDATE[S.ROLL] = function () {
  let n = 0; switch (this.v.ph) { case 0: this.v.ph = 1; break; case 1: this.v.ph = 2; break;
    case 2: if (this.decTimer(0)) this.setTimer(0, 0.12); if (this.anim.isAt(0.8011)) { this.anim.dur = F(2.5); this.thv = 0; this.v.ph = 3; } // falls through
    case 3: if (this.anim.stopped()) n = S.IDLE; break; }
  if (this.pressed('A')) n = this.jumpType(); if (0.6 < this.anim.anim && !this.isStable()) n = S.FALL; this.setState(n);
};
INIT[S.SLIDE] = function () {
  this.anim.play(0x5A, 1, STOPPED); this.v.front = true;
  if (this.isSliding()) { const yp = yaw_pitch_of(this.floorN()); if (yp) { const t = mlNormalizeAngle(fsub(this.yaw, yp[0])); if (t < 90 || 270 < t) this.v.front = false; } }
  this.setUpdateTypes(1, 3, PHYS.LOCKED); this.tyaw = mlNormalizeAngle(this.ideal); this.setHVel(this.ideal, this.thv); this.thv = 0; this.v.t = F(1);
};
UPDATE[S.SLIDE] = function () {
  let n = 0; this.v.t = ml_max_f(fsub(this.v.t, this.dt), 0);
  if (this.isSliding()) { const yp = yaw_pitch_of(this.floorN()); if (yp) { this.setIdeal(this.v.front ? fadd(yp[0], 180) : yp[0]); this.thv = ml_map_f(yp[1], 20, 60, 550, 700); this.tyaw = mlNormalizeAngle(yp[0]); } else this.thv = F(500); }
  else n = S.IDLE;
  if (this.v.t === 0 && this.pressed('A')) n = this.jumpType(); this.setState(n);
};

// ---- convenience: run a list of per-update inputs
function run(world, start, inputs) {
  const p = new Player(world, start); const rows = [];
  for (const u of inputs) rows.push(p.step(u, u.frames ?? 2));
  return [rows, p];
}
// ---- talon trot (bs/bTrot.c). Enter: crouch + C-Left; hold Z to stay in the trot (Z released -> exit); A -> trot jump.
// No turbo trainers, no dangerous ground, no slide/peck/flight pad. Friction on floor type 4 becomes 0.24 while trotting.
const TROT_SET = new Set([S.TROT_ENTER, S.TROT_IDLE, S.TROT_WALK, S.TROT_EXIT, S.TROT_JUMP, S.TROT_FALL, S.TROT_SLIDE]);
// player_shouldSlideTrot: only floors flagged 0x40 make Kazooie slide (once the slope timer is full); ordinary steep slopes don't
P.shouldSlideTrot = function () { return this.stateTimer6 > 0 || (this.slopeTimer === 1.0 && !!(this.floorFlags() & 0x40)); };
P.trotSetup = function () { this.zones[0] = F(0.03); this.zones[1] = F(1.0); this.frOv4 = true; this.modelDir(1); };   // func_802A8A40
// baModel_setDirection: turning the model to Kazooie (or back) flips the facing by 180 (yaw_setIdeal(norm(yaw + 180)); yaw_applyIdeal)
P.modelDir = function (k) { const cur = this.kaz ? 1 : 0; if (k !== cur && (k === 1 || cur === 1)) { this.ideal = mlNormalizeAngle(F(this.yaw + 180.0)); this.yaw = this.ideal; } this.kaz = k === 1; };
P.trotEnd = function () { if (TROT_SET.has(this.nextState)) return; this.modelDir(0); this.zones = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); this.frOv4 = false; }; // func_802A8BB0
P.trotTarget = function () { this.thv = this.stick.zone ? ml_interpolate_f(this.stick.zp, 30, 700) : 0; };  // bsbtrot_walkUpdateTargetVelocity
P.trotNext = function (n) { // func_802A8D84
  if (this.stick.zone > 0) n = S.TROT_WALK; if (this.shouldFall()) n = S.TROT_FALL; if (this.released('Z')) n = S.TROT_EXIT;
  if (this.pressed('A')) n = S.TROT_JUMP; if (this.shouldSlideTrot()) n = S.TROT_SLIDE; return n; };
INIT[S.TROT_ENTER] = function () { this.anim.play(0x16, 1.0, ONCE); this.setUpdateTypes(1, 2, PHYS.NORMAL); this.thv = 0; this.trotSetup(); };
UPDATE[S.TROT_ENTER] = function () { let n = 0; if (this.anim.stopped()) n = S.TROT_IDLE; if (0.5 < this.anim.anim) n = this.trotNext(n); this.setState(n); };
END[S.TROT_ENTER] = function () { this.trotEnd(); };
INIT[S.TROT_IDLE] = function () { this.anim.play(0x26, 1.2, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); this.thv = 0; this.trotSetup(); };
UPDATE[S.TROT_IDLE] = function () { this.setState(this.trotNext(0)); };
END[S.TROT_IDLE] = function () { this.trotEnd(); };
INIT[S.TROT_WALK] = function () { this.anim.play(0x15, 0.53, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); this.trotSetup(); };
UPDATE[S.TROT_WALK] = function () {
  this.trotTarget(); let n = 0; if (!this.stick.zone && this.slowerThan(1)) n = S.TROT_IDLE; if (this.shouldFall()) n = S.TROT_FALL;
  if (this.released('Z')) n = S.TROT_EXIT; if (this.pressed('A')) n = S.TROT_JUMP; if (this.shouldSlideTrot()) n = S.TROT_SLIDE; this.setState(n); };
END[S.TROT_WALK] = function () { this.trotEnd(); };
INIT[S.TROT_EXIT] = function () { this.anim.play(7, 0.6, ONCE); this.thv = 0; };
UPDATE[S.TROT_EXIT] = function () { this.setState(this.anim.stopped() ? S.IDLE : 0); };
END[S.TROT_EXIT] = function () { this.trotEnd(); };
INIT[S.TROT_JUMP] = function () {
  this.anim.reset(); this.anim.id = 0x27; this.anim.dur = F(1.4); this.anim.setStart(0.2); this.anim.setSub(0, 0.4002); this.anim.type = ONCE; this.anim.go();
  this.trotSetup(); this.setUpdateTypes(1, 3, PHYS.AIRBORN); if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  this.trotTarget(); this.setHVel(this.ideal, this.thv); this.vel[1] = F(693.5); this.grav = F(-1200); this.v.ph = 0; };
P._trotLand = function (n, last) { // shared tail of bsbtrot_jump_update / bsbtrot_fall_update
  const a = this.anim; const ph = this.v.ph;
  if (ph === last - 3 && this.isStable()) { a.setSub(0, 0.8798); a.dur = F(0.9); a.type = ONCE; this.yawMode = 1; this.v.ph = ph + 1; }
  else if (ph === last - 2 && a.stopped()) { a.setSub(0, 0.8898); a.dur = F(2.0); a.type = ONCE; this.v.ph = ph + 1; }
  else if (ph === last - 1 && a.stopped()) { a.setSub(0, 1.0); a.dur = F(1.2); a.type = ONCE; this.v.ph = ph + 1; }
  else if (ph === last && a.stopped()) n = S.TROT_IDLE;
  if (this.fallHeight > 1000 && !this.isStable()) n = S.TUMBLE;
  if (this.isStable()) { if (this.pressed('A')) n = S.TROT_JUMP; if (this.shouldSlideTrot()) n = S.TROT_SLIDE; } return n; };
UPDATE[S.TROT_JUMP] = function () {
  this.trotTarget(); if (this.released('A') && 0 < this.vel[1]) this.grav = F(-2700); const a = this.anim; let n = 0;
  if (this.v.ph === 0) { if (a.stopped()) { a.setSub(0, 0.4653); a.dur = F(10); a.type = ONCE; this.v.ph = 1; } }
  else if (this.v.ph === 1) { if (this.isAboveFloorBy(0x8C)) { a.setSub(0, 0.7328); a.dur = F(1.4); a.type = ONCE; this.v.ph = 2; } }
  n = this._trotLand(n, 5); this.setState(n); };
END[S.TROT_JUMP] = function () { this.grav = F(-2700); this.trotEnd(); };
INIT[S.TROT_FALL] = function () {
  this.anim.reset(); this.anim.id = 0x27; this.anim.dur = F(1.4); this.anim.setStart(0.4653); this.anim.type = STOPPED; this.anim.go();
  this.trotSetup(); this.setUpdateTypes(1, 3, PHYS.AIRBORN); this.tyaw = mlNormalizeAngle(this.ideal); this.trotTarget(); this.setHVel(this.ideal, this.thv); this.v.ph = 0; };
UPDATE[S.TROT_FALL] = function () {
  this.trotTarget(); const a = this.anim; let n = 0;
  if (this.v.ph === 0) { if (this.isAboveFloorBy(0x8C)) { a.setSub(0, 0.7328); a.dur = F(1.4); a.type = ONCE; this.v.ph = 1; } }
  n = this._trotLand(n, 4); this.setState(n); };
END[S.TROT_FALL] = function () { this.trotEnd(); };
// trot slide (bsbtrot_slide_*): down the slope at 550..700 by the slope's pitch along Kazooie's facing; A after 1 s (when stable) jumps
INIT[S.TROT_SLIDE] = function () {
  this.anim.reset(); this.anim.id = 0x27; this.anim.setStart(0.069); this.anim.type = STOPPED; this.anim.go();
  this.trotSetup(); this.setUpdateTypes(1, 3, PHYS.LOCKED); this.tyaw = mlNormalizeAngle(this.ideal); this.setHVel(this.ideal, this.thv); this.thv = 0; this.v.t = F(1); };
UPDATE[S.TROT_SLIDE] = function () {
  let n = 0; this.v.t = ml_max_f(fsub(this.v.t, this.dt), 0);
  if (this.shouldSlideTrot()) { const nn = this.floorN(); const sy = yaw_of(nn);
    // func_80299628(1) -> func_8025901C(yaw + 180, normal): pitch ideal = map(|facing - slope yaw|, 0, 180, pitch, -pitch)
    let pi = 0; const yp = yaw_pitch_of(nn); if (yp) { let d = fsub(mlNormalizeAngle(F(this.yaw + 180.0)), yp[0]); if (d < -180) d = F(d + 360); if (180 <= d) d = F(d - 360); pi = ml_map_f(absf(d), 0, 180, yp[1], F(-yp[1])); }
    this.thv = ml_map_f(pi, 20, 60, 550, 700); if (sy != null) this.tyaw = mlNormalizeAngle(sy); }
  else n = S.TROT_IDLE;
  if (this.v.t === 0 && this.pressed('A') && this.isStable()) n = S.TROT_JUMP; this.setState(n); };
END[S.TROT_SLIDE] = function () { this.trotEnd(); };

// rebound to a target (bsrebound type 0xE, func_8028F4B8(target, vy, gravity)): the warp-cauldron launch. Flight time from
// func_8029B56C (stepped at 1/FRAMERATE), horizontal speed = distance / time, cut to 0 when the timer (batimer 6) runs out.
S.REBOUND = 0x56; SNAME[0x56] = 'REBOUND';
P.launchTo = function (target, vy, grav) {
  const T = target.map(F); const d = [fsub(this.pos[0], T[0]), 0, fsub(this.pos[2], T[2])]; const yp = yaw_pitch_of(d);
  this.state = S.REBOUND; this.nextState = 0; this.anim.reset();
  this.setUpdateTypes(1, 2, PHYS.UNK1); this.ideal = mlNormalizeAngle(yp ? yp[0] : 0); this.yaw = this.ideal;
  this.grav = F(grav); const step = F(1.0 / this.rate); let y = this.pos[1], v = F(vy), t = F(0);
  while (v > 0 || T[1] < y) { t = fadd(t, step); y = fadd(y, fmul(v, step)); v = fadd(v, fmul(F(grav), step)); }
  this.vel = [fdiv(fsub(T[0], this.pos[0]), t), F(vy), fdiv(fsub(T[2], this.pos[2]), t)]; this.thv = 0; this.setTimer(6, t); this.grounded = false; this.stable = false; };
UPDATE[S.REBOUND] = function () { let n = 0; if (this.decTimer(6)) { this.vel[0] = 0; this.vel[2] = 0; this.thv = 0; } if (this.isStable()) n = S.LANDING; this.setState(n); };
END[S.REBOUND] = function () { this.vel = [0, 0, 0]; this.grav = F(-2700); };

// internals for the state modules (bkmove_*.js): they add states with lib.addState(name, id) and fill lib.INIT/UPDATE/END
const lib = { BK, F, fadd, fsub, fmul, fdiv, fsqrt, absf, sinf, cosf, ml_acosf, BAD_DTOR, mlNormalizeAngle, mlDiffDegF, ml_map_f, ml_mapRange_f, ml_interpolate_f,
  ml_clamp_f, ml_max_f, ml_min_f, rot_yaw, rot_pitch_yaw, yaw_of, yaw_pitch_of, ml_acosf_deg, surface_type, FRICTION, ONCE, LOOP, STOPPED, PHYS, S, SNAME,
  INIT, UPDATE, END, WATER_TO, REBOUND, DIVE_SET, SWIM_SET, toSwim, toLand, standNext, P,
  addState(name, id) { if (S[name] !== undefined && S[name] !== id) throw new Error('state ' + name + ' already 0x' + S[name].toString(16)); S[name] = id; SNAME[id] = name; return id; } };
const api = { Player, S, SNAME, run, mlNormalizeAngle, rot_yaw, surface_type, ml_acosf_deg, FRICTION, lib };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKMOVE = api;
})(typeof self !== 'undefined' ? self : this);
