// bkmove_fly.js -- flight and pole climbing for the Bit-Clip Lab movement engine (bkmove.js), ported from the n64decomp
// banjo-kazooie sources: core2/bs/bFly.c (flight, beak bomb, crash, knockback, flight ow), ba/flap.c (baflap queue),
// bs/climb.c + climb.c + code_C4B0.c func_80293440 (collision mode 5) + ba/physics.c __baphysics_update_climb,
// bs/jump.c bsjump_climbExit_*, code_14420.c bs_getTypeOfJump / bs/bTrot.c func_802A8D34 (flight pad entry),
// code_EF50.c func_80296608 (BS_INTR_C_CLIMB), ch/climbBase.c (pole contact test), code_12360.c (yaw mode 6).
// Requiring this file installs everything (no setup call).
//
// New Player fields (all optional, set by the caller):
//   onFlyPad        standing on a flight pad (BA_FLAG_1_ON_FLIGHT_PAD); also set per update from inp.flypad
//   redFeathers     red feather count (default 99 when undefined); each flap and each beak bomb uses one
//   health          honeycomb health (undefined = infinite); crash / bomb hit / flight ow use one
//   gTimer          globalTimer (gGlobalTimer, +1 per update); the flight flap only fires when gTimer % 3 == 0
//   flyCam          [pitch, yaw] of the viewport (camera) for the beak bomb direction; also from inp.flyCam.
//                   Default: a camera straight behind Banjo along his yaw and pitch (the flight camera is not modelled)
//   flyFlag8/9      BA_FLAG_8 (bomb bounces off) / BA_FLAG_9 (flight locked); flagF = BA_FLAG_F
//   pole            {bottom:[x,y,z], top:y, radius:20, type:2} (climbBase actor: radius = actorTypeSpecificField,
//                   type 2 = can climb off the top). Contact (climb_set) is tested at the start of each update with
//                   the climbBase rule (horizontal distance < radius + 25, bottom.y < y <= top), or forced by inp.pole.
//   flyHit          D_8037C2A0: the point a flight knockback/ow pushes away from (P.hit / P.flyKnock set it)
// Hits: P.hit(src, type) while flying -> FLY_OW; P.flyKnock(src) = a non-damaging rebound while flying -> FLY_KNOCKBACK.
(function (root) {
'use strict';
const M = root.BKMOVE || (typeof require !== 'undefined' ? require('./bkmove.js') : null);
const L = M.lib;
const { F, fadd, fsub, fmul, fdiv, fsqrt, absf, sinf, cosf, mlNormalizeAngle, mlDiffDegF, ml_map_f, ml_max_f, rot_yaw, rot_pitch_yaw,
  yaw_of, yaw_pitch_of, ONCE, LOOP, STOPPED, PHYS, S, SNAME, INIT, UPDATE, END, P } = L;
const BAD_DTOR = 3.141592654 / 180.0;
const BAD_DTOR_F = F(BAD_DTOR); // mlmtx.c D_80276578 (f32)

// ---- states (enums.h)
L.addState('FLY_KNOCKBACK', 0x18); L.addState('FLY_ENTER', 0x23); L.addState('FLY', 0x24); L.addState('BOMB', 0x2A);
L.addState('CLIMB_IDLE', 0x4F); L.addState('CLIMB_MOVE', 0x50); L.addState('CLIMB_EXIT', 0x51);
L.addState('BOMB_END', 0x57); L.addState('BEAKBOMB_CRASH', 0x58); L.addState('BFLY_UNK59', 0x59); L.addState('FLY_OW', 0x91);
if (S.IDLE === undefined) throw new Error('bkmove_fly: bkmove.js not loaded');
// ---- physics types (ba/physics.h): FREEZE (no movement), UNK8 (pos += vel*dt, no gravity), CLIMB (__baphysics_update_climb)
if (PHYS.FREEZE === undefined) PHYS.FREEZE = 7;
if (PHYS.UNK8 === undefined) PHYS.UNK8 = 8;
if (PHYS.CLIMB === undefined) PHYS.CLIMB = 10;

const FLY_SET = new Set([S.BOMB, S.BOMB_END, S.FLY_KNOCKBACK, S.BFLY_UNK59, S.FLY_OW, S.FLY]); // bsbfly_inSet (+ locked/drone)
const CLIMB_SET = new Set([S.CLIMB_IDLE, S.CLIMB_MOVE]);                                            // bsclimb_inSet (+ 0x9E)
// states whose interrupt handler does not take BS_INTR_C_CLIMB (func_80296590 states, the climb states themselves handle it)
const NO_CLIMB_INTR = new Set([S.OW, S.SPLAT, S.DIVE_OW, S.REBOUND, S.BEAKBOMB_CRASH, 0x41 /* DIE */]);
const ZONES0 = () => [0.12, 0.2, 0.5, 0.75, 1.0].map(F);

// ---- small helpers
P.setCol = function (h, r) { this.colHT = this.colH = F(h); this.colRT = this.colR = F(r); }; // func_80293D48 sets target AND current
const yawTo = (src, dst) => yaw_of([fsub(dst[0], src[0]), 0, fsub(dst[2], src[2])]) ?? 0;  // func_80257F18(src, dst)
P._useFeather = function () { // func_80346C10(&r, 0, x, ITEM_F_RED_FEATHER, 1)
  if (this.redFeathers === undefined) this.redFeathers = 99;
  if (this.redFeathers <= 0) return false; this.redFeathers--; return true; };
P._loseHealth = function () { if (typeof this.health === 'number') this.health = Math.max(0, this.health - 1); };
P._healthLeft = function () { return typeof this.health !== 'number' || this.health > 0; };

// ---- baflap (ba/flap.c): up to 5 flap timers; the count of running timers sets the climb speed (count * 400)
P._flapReset = function () { this.flaps = [0, 0, 0, 0, 0]; this.flapMax = 0; this.flapActive = false; };
P._flapActivate = function (on) { this.flapActive = on; if (!on) this._flapReset(); };
P._flapAdd = function (d) { d = F(d); if (!this.flaps) this._flapReset();
  for (let i = 0; i < 5; i++) if (d - 0.25 < this.flaps[i]) { this.flapMax = d; return false; }
  for (let i = 0; i < 5; i++) if (this.flaps[i] === 0) { this.flaps[i] = d; return true; }
  this.flapMax = d; return false; };
P._flapCount = function () { let n = 0; if (this.flaps) for (let i = 0; i < 5; i++) if (this.flaps[i] !== 0) n++; return n; };
P._flapUpdate = function () {
  if (!this.flapActive) return;
  for (let i = 0; i < 5; i++) { let t = fsub(this.flaps[i], this.dt); if (t < 0) t = 0; this.flaps[i] = t; } // ml_sub_delta_time
  if (this.flapMax !== 0) { const t = this.flapMax; this.flapMax = 0; this._flapAdd(t); } };

// ---- bFly.c shared setup / teardown
P._flySetup = function () { // func_802A3430
  this.yawState = 3; this.yawB = [F(500), F(2)]; this.pitchLim = F(500); this.pitchVel = F(1.2); // func_802A33D8
  this.setCol(60, 45); this.colMode = 4; this._flapReset(); this._flapActivate(true); };
P._flyLeave = function () { // func_802A34C8
  if (FLY_SET.has(this.nextState)) return;
  this.grav = F(-2700); this.term = F(-4000); this.pitchIdeal = 0; this.pitch = 0; // func_8029CB84
  this.yawState = 1; this.setCol(80, 35); this.colMode = 1; this._flapActivate(false); };
P._flyYaw = function () { // func_802A354C: stick X turns the ideal yaw by up to 3 (R: 6) degrees per update
  const sx = this.stick.x; let r;
  if (this.held('R')) { this.yawB = [F(500), F(30)]; r = 6; } else { this.yawB = [F(500), F(2)]; r = 3; }
  this.setIdeal(fadd(this.ideal, ml_map_f(sx, -1, 1, r, -r))); };
P._flyPitch = function () { // func_802A3648: stick down -> 300..360 (nose up), stick up -> 0..80 (nose down)
  const sy = this.stick.y; this.pitchIdeal = mlNormalizeAngle(sy < 0 ? ml_map_f(sy, -1, 0, 300, 360) : ml_map_f(sy, 0, 1, 0, 80)); };
P._flyCanLand = function () { return this.isStable() && !((this.tracker.unk50 | 0) & 8); }; // func_802A3350

// ---- BS_23_FLY_ENTER (bsbfly_enter_*): A on a flight pad. Liftoff at anim 0.2416 (1.4 s anim) with vy = 1600, gravity -1200
INIT[S.FLY_ENTER] = function () {
  this.anim.play(0x45, 1.4, ONCE); this.setUpdateTypes(1, 3, PHYS.AIRBORN);
  if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  this.vel = [0, 0, 0]; this.thv = 0; this.grav = F(-1200); this.v.ph = 0; this.flyFlap35 = false; // D_8037D346 = 0
};
UPDATE[S.FLY_ENTER] = function () {
  let n = 0;
  if (this.v.ph === 0) { if (this.anim.isAt(0.2416)) { this.anim.dur = F(2.4); this.vel[1] = F(1600); this.v.ph = 1; } }
  else if (this.vel[1] < 0) n = S.FLY;
  this.setState(n);
};

// ---- BS_24_FLY (bsbfly_*)
INIT[S.FLY] = function () {
  this.anim.play(0x38, 0.62, LOOP); this.setUpdateTypes(1, 3, PHYS.LOCKED);
  this.thv = this.flyFlag9 ? 0 : F(600); this.setHVel(this.ideal, this.thv); this.tyaw = mlNormalizeAngle(this.ideal);
  this.grav = F(-300); this.term = F(-99.9); this._flySetup();
  this.flyT = F(1.0); this.v.ph = 0; this.v.pend = 0; // D_8037D320 (beak bomb lockout), D_8037D344, D_8037D347
};
UPDATE[S.FLY] = function () {
  let n = 0; const a = this.anim;
  this._flyYaw(); this._flyPitch(); const p = this.pitch; let got = false;
  if (this.pressed('A')) this.v.pend = 1;
  if (this.v.pend && (this.gTimer | 0) % 3 === 0) { this.v.pend = 0; got = this._useFeather(); }
  if (got || this.flyFlap35) {
    if (got) a.dur = F(0.3);
    if (this.flyFlap35) { this.flyFlap35 = false; this._flapAdd(0.35); } else this._flapAdd(1.0);
  }
  const cnt = this._flapCount();
  if (this.v.ph === 0) { if (cnt) this.v.ph = 1; }
  else {
    let pi = mlNormalizeAngle(fsub(this.pitchIdeal, 30)); if (80 < pi && pi < 300) pi = F(300); this.pitchIdeal = pi;
    this.pitchLim = F(1000); this.pitchVel = F(2.2); // func_802A3404
    if (cnt) this.vel[1] = F(cnt * 400.0);
    else { a.dur = F(0.62); this.pitchLim = F(500); this.pitchVel = F(1.2); this.v.ph = 0; }
  }
  let spd; this.grav = F(-300);
  if (this.flyFlag9) { this.term = 0; this.vel = [0, 0, 0]; spd = 0; }
  else if (p <= 80) { this.term = ml_map_f(p, 60, 80, -99.9, -1000.33); this.grav = ml_map_f(p, 60, 80, -300, -700); spd = ml_map_f(p, 60, 80, 600, 60); }
  else { this.term = ml_map_f(p, 300, 310, -399.99, -99.9); spd = ml_map_f(p, 300, 340, 0, 600); }
  if (this.wallHits > 0 && -1.0 < this.dpos[1]) spd = 0; // flying into a wall (D_8037C204 and D_8037C268)
  this.tyaw = this.yaw; this.thv = spd;
  if (this.pressed('Z') && this.abil.buster) n = S.BBUSTER;
  this.flyT = ml_max_f(fsub(this.flyT, this.dt), 0);
  if (this.flyT === 0 && this.pressed('B') && this.abil.beakbomb !== false) { if (this._useFeather()) n = S.BOMB; }
  if (this.inWater) n = S.SWIM_IDLE;
  if (this._flyCanLand()) n = S.IDLE;
  this._flapUpdate();
  this.setState(n);
};
END[S.FLY] = P._flyLeave;

// ---- BS_2A_BOMB (bsbfly_bomb_*): 0.69 s frozen wind-up, then 4200 u/s along the camera's look vector (no gravity)
// until a floor/wall hit or 4000 units from the start
P._viewLook = function (cp, cy) { // viewport_update: look = (Ry(yaw) * Rx(pitch)) applied to (0, 0, -1)
  const m = [[F(1), 0, 0], [0, F(1), 0], [0, 0, F(1)]];
  cy = F(cy); cp = F(cp);
  if (cy !== 0) { const ang = F(cy * BAD_DTOR), s = sinf(ang), c = cosf(ang);
    for (let i = 0; i < 3; i++) { const a = m[0][i], b = m[2][i]; m[0][i] = fsub(fmul(a, c), fmul(b, s)); m[2][i] = fadd(fmul(a, s), fmul(b, c)); } }
  if (cp !== 0) { const ang = fmul(cp, BAD_DTOR_F), s = sinf(ang), c = cosf(ang);
    for (let i = 0; i < 3; i++) { const a = m[1][i], b = m[2][i]; m[1][i] = fadd(fmul(a, c), fmul(b, s)); m[2][i] = fadd(fmul(a, F(-s)), fmul(b, c)); } }
  return [0, 1, 2].map(i => fadd(fadd(fadd(fmul(0, m[0][i]), fmul(0, m[1][i])), fmul(F(-1), m[2][i])), 0)); };
INIT[S.BOMB] = function () {
  this.anim.play(0x43, 1.0, ONCE); this.setUpdateTypes(1, 3, PHYS.FREEZE);
  const cam = this.flyCam || [mlNormalizeAngle(F(-this.pitch)), mlNormalizeAngle(F(this.yaw + 180.0))]; // viewport_getRotation (see header)
  const look = this._viewLook(cam[0], cam[1]).map(x => fmul(x, 4200)); // func_802A339C
  this.setIdeal(F(cam[1] + 180.0)); this.pitchIdeal = mlNormalizeAngle(cam[0]);
  this.vel = look.slice(); this.bombVel = look.slice(); // D_8037D338
  this._flySetup(); this.bombStart = this.pos.slice(); this.v.ph = 0; // D_8037D328
};
P._flyHitPoint = function () { this.flyHit = [0, 1, 2].map(i => fadd(this.pos[i], this.bombVel[i])); }; // func_802A4078
UPDATE[S.BOMB] = function () {
  let n = 0; const a = this.anim;
  if (this.v.ph === 0) {
    if (a.isAt(0.6905)) { this.ptype = PHYS.UNK8; a.dur = F(0.05); this.v.t = 0; this.v.ph = 1; }
  } else {
    this.v.t = fadd(this.v.t, this.dt); const st = this.isStable();
    if (this.inWater) n = S.LAND_WATER;
    if (this.wallHits > 0 || st) {
      // floor: the floor normal and the floor triangle's flags; wall: the last wall normal (wall triangle flags not exported by BK.predict)
      const nrm = st ? this.floorN() : this.wallN; const fl = st ? (this.floorFlags() | 0) : (this.wallFlags | 0);
      let d = this.bombVel.slice(); const l2 = fadd(fadd(fmul(d[0], d[0]), fmul(d[1], d[1])), fmul(d[2], d[2]));
      if (l2 !== 0) { const inv = F(1.0 / fsqrt(l2)); d = d.map(x => fmul(x, inv)); }
      const dp = absf(fadd(fadd(fmul(nrm[0], d[0]), fmul(nrm[1], d[1])), fmul(nrm[2], d[2])));
      if (this.flyFlag8 || (fl & 0x80)) { this._flyHitPoint(); n = S.FLY_KNOCKBACK; }
      else if (0.4 < dp) {
        if (0.65 > nrm[1]) { this._flyHitPoint(); this._loseHealth(); n = this._healthLeft() ? S.BFLY_UNK59 : (S.DIE ?? S.BFLY_UNK59); } // func_802A40E0 (BS_41_DIE if bkmove_misc.js is loaded)
        else n = S.BEAKBOMB_CRASH;
      } else if (st) n = S.BEAKBOMB_CRASH;
    }
    const dd = [0, 1, 2].map(i => fsub(this.pos[i], this.bombStart[i]));
    if (fadd(fadd(fmul(dd[0], dd[0]), fmul(dd[1], dd[1])), fmul(dd[2], dd[2])) > 16000000.0) n = S.BOMB_END;
    if (a.stopped()) { a.id = 0x47; a.dur = F(0.3); a.type = LOOP; a.go(); }
  }
  this.setState(n);
};
END[S.BOMB] = P._flyLeave;

// ---- BS_57_BOMB_END (bsbfly_beakbombend_*): normal gravity for 0.35 s, then back to flight (with a free 0.35 s flap)
INIT[S.BOMB_END] = function () {
  this.anim.reset(); this.anim.id = 0xCC; this.anim.dur = F(0.38); this.anim.type = LOOP; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.LOCKED); this._flySetup(); this.setCol(80, 35); this.colMode = 1;
  this.pitchIdeal = 0; this.grav = F(-2700); this.term = F(-4000); this.flyT = F(0.35); this.v.ph = 0;
};
UPDATE[S.BOMB_END] = function () {
  let n = 0;
  if (this.v.ph === 0 && this.isAboveFloorBy(0x5A)) { this.anim.play(8, 2.0, ONCE, 0.6667); this.v.ph = 1; }
  this.flyT = fsub(this.flyT, this.dt); if (this.flyT < 0) { this.flyFlap35 = true; n = S.FLY; }
  if (this.pressed('B') && this.canPeck()) n = S.BPECK;
  if (this.pressed('Z') && this.abil.buster) n = S.BBUSTER;
  if (this.isStable()) n = S.LANDING;
  if (this.inWater) n = S.SWIM_IDLE;
  this.setState(n);
};
END[S.BOMB_END] = P._flyLeave;

// ---- BS_58_BEAKBOMB_CRASH (bsbfly_beakbomb_crash_init / func_802A48B4 / func_802A4A40)
P._slopePitch = function () { // func_80299628(0): pitch ideal from the floor slope along the facing
  const yp = yaw_pitch_of(this.floorN()); let pi = 0;
  if (yp) { let d = fsub(this.yaw, yp[0]); if (d < -180) d = F(d + 360); if (180 <= d) d = F(d - 360); pi = ml_map_f(absf(d), 0, 180, yp[1], F(-yp[1])); }
  this.pitchIdeal = mlNormalizeAngle(pi); };
INIT[S.BEAKBOMB_CRASH] = function () {
  this.anim.play(0x3E, 1.4, ONCE); this.setUpdateTypes(1, 3, PHYS.LOCKED); this._loseHealth(); this.v.ph = 0; };
P._crashTick = function () { if (this.anim.isAt(0.92)) this.thv = 0; }; // func_802A47E0 (rest is sfx/particles)
UPDATE[S.BEAKBOMB_CRASH] = function () {
  let n = 0; const a = this.anim; this._slopePitch();
  switch (this.v.ph) {
    case 0: this._crashTick();
      if (a.isAt(0.2)) { if (!this._healthLeft()) { this.dead = true; this.setTimer(0, 2.5); this.v.ph = 2; } }
      else if (a.isAt(0.92)) { a.play(0xD2, 2.25, ONCE); this.v.ph = 1; } break;
    case 1: if (a.isAt(0.63)) n = S.LANDING; if (a.stopped()) n = S.IDLE; if (this.shouldFall()) n = S.FALL; break;
    case 2: this._crashTick(); this.decTimer(0); break; // dying (respawn not modelled)
  }
  this.setState(n);
};
END[S.BEAKBOMB_CRASH] = function () { this.pitch = 0; this.pitchIdeal = 0; };

// ---- BS_18_FLY_KNOCKBACK (bounce off a BA_FLAG_8 / 0x80 surface or an object), BS_91_FLY_OW (hurt in flight),
// BS_59_BFLY_UNK59 (beak bomb into a steep surface, -1 health): pushed away from flyHit
P._flyPush = function (spd) {
  const yw = yawTo(this.flyHit || this.pos, this.pos); this.setIdeal(F(yw + 180.0)); this.yaw = this.ideal;
  this.thv = F(spd); this.tyaw = yw; this.setHVel(yw, this.thv); return yw; };
INIT[S.FLY_KNOCKBACK] = function () {
  this.anim.play(0x10D, 1.0, ONCE); const yw = this._flyPush(1300); if (this.map === 0x90) { this.setIdeal(yw); this.yaw = this.ideal; }
  this.setUpdateTypes(1, 2, PHYS.LOCKED); this.vel[1] = F(400); this.grav = F(-1800); };
UPDATE[S.FLY_KNOCKBACK] = function () {
  let n = 0; if (this.isStable()) n = S.LANDING;
  if (this.anim.stopped() && (this.shouldFall() || this.wallHits > 0)) { this.flyFlap35 = true; n = S.FLY; }
  this.setState(n); };
END[S.FLY_KNOCKBACK] = function () { this.grav = F(-2700); this._flyLeave(); };
function owInit(k) { // func_802A4A78
  const g = k === 0 ? -2200 : -1200, v = k === 0 ? 800 : 400;
  this.anim.play(0xD3, 1.2, ONCE); const yw = this._flyPush(v); if (k === 1 && this.map === 0x90) { this.setIdeal(yw); this.yaw = this.ideal; }
  this.setUpdateTypes(1, 2, PHYS.LOCKED); this.vel[1] = F(800); this.grav = F(g); this.term = F(-4000); this._flySetup(); }
function owUpdate() { let n = 0; if (this.anim.stopped()) n = S.FLY; if (this.isStable()) n = S.WALK_SLOW; this.setState(n); } // func_802A4C34
function owEnd() { this.grav = F(-2700); this.term = F(-4000); this._flyLeave(); } // func_802A4C88
INIT[S.BFLY_UNK59] = function () { owInit.call(this, 0); }; UPDATE[S.BFLY_UNK59] = owUpdate; END[S.BFLY_UNK59] = owEnd;
INIT[S.FLY_OW] = function () { owInit.call(this, 1); }; UPDATE[S.FLY_OW] = owUpdate; END[S.FLY_OW] = owEnd;
const hit0 = P.hit;
P.hit = function (src, type) { // func_802962BC: hurt while flying -> BS_91_FLY_OW (func_802960C4 stores the source in D_8037C2A0)
  if (FLY_SET.has(this.state)) { this.hitSrc = src.map(F); this.hitType = type; this.flyHit = src.map(F); this._loseHealth(); this.setState(S.FLY_OW); return; }
  return hit0.call(this, src, type); };
P.flyKnock = function (src) { // __get_rebound_state_id while flying: BS_18_FLY_KNOCKBACK
  if (!FLY_SET.has(this.state)) return false; this.flyHit = src.map(F); this.setState(S.FLY_KNOCKBACK); return true; };

// ---- entering flight: bs_getTypeOfJump (code_14420.c) / func_802A8D34 (bTrot.c)
P.jumpType = function () {
  if (this.held('Z')) return S.BFLIP;            // (can_flap_flip not checked, as in bkmove.js)
  if (this.onPad) return S.JUMP;                 // BA_FLAG_2_ON_SPRING_PAD
  if (this.onFlyPad) return S.FLY_ENTER;         // BA_FLAG_1_ON_FLIGHT_PAD
  return S.JUMP; };
// talon trot: every "A -> BS_8_BTROT_JUMP" goes through func_802A8D34, which turns it into BS_23_FLY_ENTER on a flight pad.
// Done at setState so it survives other modules re-wrapping the trot updates (in the trot states BTROT_JUMP only ever comes from A).
const TROT_ALL = new Set([S.TROT_ENTER, S.TROT_IDLE, S.TROT_WALK, S.TROT_EXIT, S.TROT_JUMP, S.TROT_FALL, S.TROT_SLIDE]);
const setState0 = P.setState;
P.setState = function (id) {
  if (id === S.TROT_JUMP && TROT_ALL.has(this.state) && this.onFlyPad && !this.flagF && this.pressed('A')) id = S.FLY_ENTER;
  return setState0.call(this, id); };

// ---- climbing (bs/climb.c)
P._climbSetup = function () { // func_802AB654
  this.yawMode = 6; this.yawState = 3; this.yawB = [F(500), F(15)]; this.zones[0] = F(0.03); this.zones[1] = F(1.0);
  this.ptype = PHYS.CLIMB; this.accel = F(10); this.colMode = 5; this.setCol(80, 10); };
P._climbRelease = function () { this.climbRegrab = F(0.6); this._climbTouch = false; }; // climb_release
P._climbLeave = function () { // func_802AB6F0 (+ climb_release from bsjump_init / bsstand_init when leaving the pole)
  if (this.nextState === S.JUMP || this.nextState === S.IDLE) this._climbRelease();
  if (CLIMB_SET.has(this.nextState)) return;
  this.zones = ZONES0(); this.ptype = PHYS.NORMAL; this.colMode = 1; this.setCol(80, 35); };
P._climbTvel = function () { // func_802AB5C0: stick Y -> 100..300 up/down
  const sy = this.stick.y; let v = 0;
  if (absf(sy) >= 0.03) v = sy < 0 ? ml_map_f(sy, -0.03, -1.0, -100.0, -300.0) : ml_map_f(sy, 0.03, 1.0, 100.0, 300.0); // ml_mapAbsRange_f
  this.tvel = [0, v, 0]; };
P._climbMoving = function () { return 0.0 < absf(this.tvel[1]) || this.yaw !== this.ideal; }; // func_802AB788
P._pole = function () { const p = this.pole; return { b: p.bottom.map(F), top: F(p.top), r: F(p.radius ?? 20), type: p.type ?? 2 }; };
INIT[S.CLIMB_IDLE] = function () {
  if (!CLIMB_SET.has(this.prevState)) { this.setIdeal(yawTo(this.pos, this._pole().b)); this.yaw = this.ideal; }
  this.anim.play(0xB2, 2.64, LOOP); this._climbSetup(); this.climbTouch = true; // D_8037D3D8
};
UPDATE[S.CLIMB_IDLE] = function () {
  let n = 0; this.fallStart = this.pos.slice(); // bafalldamage_start (the random idle anim swap is cosmetic: skipped)
  this._climbTvel(); if (this._climbMoving()) n = S.CLIMB_MOVE;
  if (this.pressed('A')) n = S.JUMP;
  if (!this.climbTouch) n = S.IDLE; this.climbTouch = false; this.setState(n);
};
END[S.CLIMB_IDLE] = P._climbLeave;
INIT[S.CLIMB_MOVE] = function () { this.anim.play(0x0A, 0.9, LOOP); this._climbSetup(); };
UPDATE[S.CLIMB_MOVE] = function () {
  let n = 0; this.fallStart = this.pos.slice(); this._climbTvel(); const pl = this._pole();
  if (!this._climbMoving() && this.vel[1] < 30.0) n = S.CLIMB_IDLE;
  if (this.tvel[1] < 0.0 && pl.b[1] === this.pos[1]) n = S.IDLE;
  if (pl.type === 2 && 0.0 < this.tvel[1] && pl.top === this.pos[1]) n = S.CLIMB_EXIT;
  if (this.pressed('A')) n = S.JUMP;
  if (!this.climbTouch) n = S.IDLE; this.climbTouch = false; this.setState(n);
};
END[S.CLIMB_MOVE] = P._climbLeave;
// ---- BS_51_CLIMB_EXIT (bsjump_climbExit_*): hop off the top, 60 forward / 710 up, no collision (mode 6) until falling
INIT[S.CLIMB_EXIT] = function () {
  this._climbRelease();
  this.anim.reset(); this.anim.id = 8; this.anim.dur = F(1.9); this.anim.setStart(0.3); this.anim.setSub(0, 0.5042); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.LOCKED); this.tyaw = mlNormalizeAngle(this.ideal); this.thv = F(60); this.setHVel(this.ideal, this.thv);
  this.vel[1] = F(710); this.grav = F(-1350); this.colMode = 6; this.v.ph = 0;
};
UPDATE[S.CLIMB_EXIT] = function () {
  let n = 0; const a = this.anim; if (this.vel[1] < 0.0) this.colMode = 1;
  if (this.v.ph === 0) { if (a.stopped()) { a.setSub(0, 0.6667); a.dur = F(4); a.type = ONCE; this.v.ph = 1; }
    if (this.isAboveFloorBy(130)) { a.setSub(0, 1); a.dur = F(1.4); a.type = ONCE; this.v.ph = 2; } }
  else if (this.v.ph === 1) { if (this.isAboveFloorBy(90)) { a.setSub(0, 1); a.dur = F(2); a.type = ONCE; this.v.ph = 2; } }
  if (this.isStable()) n = S.LANDING; this.setState(n);
};
END[S.CLIMB_EXIT] = function () { this.colMode = 1; this.grav = F(-2700); };

// ---- physics: FREEZE, UNK8, CLIMB
const physics0 = P.physics;
P.physics = function () {
  if (this.ptype === PHYS.FREEZE) { this.lastD = [0, 0, 0]; return this.pos.slice(); }
  if (this.ptype === PHYS.UNK8) { const d = this.vel.map(v => fmul(v, this.dt)); this.lastD = d; return [0, 1, 2].map(i => fadd(this.pos[i], d[i])); } // func_8029737C
  if (this.ptype === PHYS.CLIMB && this.pole) { // __baphysics_update_climb
    const pl = this._pole(); const off = rot_pitch_yaw(0, this.yaw, F(-pl.r));
    const nx = [fadd(pl.b[0], off[0]), fadd(this.pos[1], off[1]), fadd(pl.b[2], off[2])];
    this.vel[2] = 0; this.vel[0] = 0; this.tvel[0] = 0; this.tvel[2] = 0;
    const k = fmul(this.dt, this.accel); const dv = [0, 1, 2].map(i => fmul(fsub(this.tvel[i], this.vel[i]), k)); // __baphysics_update_no_gravity
    if (fadd(fadd(fmul(dv[0], dv[0]), fmul(dv[1], dv[1])), fmul(dv[2], dv[2])) < 0.02) this.vel = this.tvel.slice(); else this.vel = [0, 1, 2].map(i => fadd(this.vel[i], dv[i]));
    const d = this.vel.map(v => fmul(v, this.dt)); this.lastD = d; return [0, 1, 2].map(i => fadd(nx[i], d[i]));
  }
  return physics0.call(this);
};

// ---- yaw: collision mode 5 (func_80293440, runs right after the collision, before the yaw update) and yaw mode 6 (func_80299338)
const yawStep0 = P.yawStep;
P.yawStep = function () {
  if (this.colMode === 5 && this.pole) { // clamp to the pole and face it
    const pl = this._pole(); let y = this.pos[1]; if (pl.top < y) y = pl.top; if (y < pl.b[1]) y = pl.b[1];
    if (y !== this.pos[1]) { this.pos[1] = y; if (this._old) this.dpos[1] = fsub(y, this._old[1]); if (this.tracker.unk59) this.waterBelow = y < this.tracker.posY; }
    const a = yawTo(this.pos, pl.b); if (1.0 < absf(mlDiffDegF(a, this.yaw))) { this.setIdeal(a); this.yaw = this.ideal; }
  }
  if (this.yawMode === 6) {
    const sx = this.stick.x; const d = 0.03 < absf(sx) ? (sx < 0 ? ml_map_f(sx, -0.0, -1.0, -1.0, -6.0) : ml_map_f(sx, 0, 1, 1, 6)) : 0;
    this.setIdeal(fadd(this.ideal, d)); this.yawMode = 3; try { yawStep0.call(this); } finally { this.yawMode = 6; } return;
  }
  return yawStep0.call(this);
};

// ---- per update: flight pad flag, global timer, pole contact (climb_set) and the climb interrupt (climb_regrab_update),
// and collision mode 6 (no collision at all)
const step0 = P.step;
P.step = function (inp = {}, frames = 2) {
  if (this.redFeathers === undefined) this.redFeathers = 99;
  if (inp.flypad !== undefined) this.onFlyPad = !!inp.flypad;
  if (inp.flyCam !== undefined) this.flyCam = inp.flyCam;
  this.gTimer = (this.gTimer | 0) + 1;
  // climb_set by the pole actor (position from the end of the previous update)
  let touch = false;
  if (this.pole) {
    if (inp.pole !== undefined) touch = !!inp.pole;
    else { const pl = this._pole(); const r = F(pl.r + 25); const dx = fsub(pl.b[0], this.pos[0]), dz = fsub(pl.b[2], this.pos[2]);
      touch = fadd(fmul(dx, dx), fmul(dz, dz)) < fmul(r, r) && pl.b[1] < this.pos[1] && this.pos[1] <= pl.top; }
    if (touch && this.climbRegrab > 0) touch = false; // same pole within 0.6 s of letting go
  }
  this._climbTouch = touch; const st0 = this.stable; this._old = this.pos.slice();
  const pc = this.preCollide, hadPc = Object.prototype.hasOwnProperty.call(this, 'preCollide'), g0 = this.ghost; let ghosted = false;
  const hook = function (tgt) { if (pc) pc.call(this, tgt); if (this.colMode === 6 && !this.ghost) { this.ghost = true; ghosted = true; } };
  this.preCollide = hook;
  let row;
  try { row = step0.call(this, inp, frames); }
  finally { if (this.preCollide === hook) { if (hadPc) this.preCollide = pc; else delete this.preCollide; } if (ghosted) this.ghost = g0; }
  // climb_regrab_update (after the anim update, before the stable flag update)
  this.climbRegrab = ml_max_f(fsub(F(this.climbRegrab || 0), this.dt), 0);
  if (this._climbTouch && this.abil.climb !== false) {
    if (CLIMB_SET.has(this.state)) this.climbTouch = true;
    else if (!NO_CLIMB_INTR.has(this.state) && !this.flagF && !(st0 && this.vel[1] < 0)) this.setState(S.CLIMB_IDLE);
  }
  this._climbTouch = false;
  // flight camera (dynamic camera state 4, bkcam.js FlyCam): set by bsbfly_init (and the other fly states that call func_802914CC(4)),
  // left when the bomb flies (state 5) or flight ends; it updates after the player, and the beak bomb reads its rotation (viewport)
  const fc = this.flyCamObj;
  if (fc) { const on = CAM4.has(this.state) && !(this.state === S.BOMB && this.v.ph === 1);
    if (on) { if (!fc.active) { fc.bomb(false); fc.active = true; } if (this.state === S.BOMB && !fc.bombOn) { fc.bomb(true); fc.bombOn = true; }
      fc.update({ pos: this.pos, yaw: this.yaw, pitch: this.pitch, floorY: this.floorY() }, frames); this.flyCam = [fc.rot[0], fc.rot[1]]; }
    else { fc.active = false; fc.bombOn = false; } }
  row.state = this.state; row.stateName = SNAME[this.state] || ('0x' + this.state.toString(16)); row.pitch = this.pitch;
  return row;
};

const CAM4 = new Set([S.FLY, S.BOMB, S.BEAKBOMB_CRASH, S.FLY_KNOCKBACK, S.FLY_OW]);
const api = { FLY_SET, CLIMB_SET };
L.fly = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
