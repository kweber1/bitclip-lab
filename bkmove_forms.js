// bkmove_forms.js -- Mumbo's transformations for the Bit-Clip Lab movement engine (bkmove.js), ported from the n64decomp
// banjo-kazooie sources: bs/ant.c (termite), bs/pumpkin.c, bs/croc.c, bs/walrus.c (+ walrus sled), bs/bee.c, bs/beeMain.c,
// bs/beeFly.c, ba/flap.c, ba/anim.c (BAANIM_UPDATE_2_SCALE_HORZ), code_12360.c func_80299628 (pitch from the floor),
// code_EF50.c (hit / rebound state per transformation), code_14420.c bs_getIdleState, bs/dronexform.c (what a transform sets).
//
// Player fields added: form ('banjo' | 'ant' | 'pumpkin' | 'croc' | 'walrus' | 'bee'), animType (baanim update type: 2 = the
// animation duration follows the horizontal speed), animScale, walrusIce (floor type 4 friction override, func_8029CF48(4,1,0.15)),
// flap (bee flight flap timers, ba/flap.c), and inputs the engine can't know: lookAt (balookat position for the *_LOCKED states,
// null = not locked), turbo (croc turbo trainers state timer 3, seconds), ateWrong (croc ate the wrong thing), beeHover (BA_FLAG_9),
// flushPos (MMM toilet position for PUMPKIN_FLUSH), dead (die-state timer ran out: the game would respawn / game-over here).
//
// Start in a form: M.run(world, {state: L.S.PUMPKIN_IDLE, ...}) (every form state's INIT sets this.form and the form's collision
// size), or p.transform('croc') at any time (= bsdronexform: velocity 0, pitch 0, collision mode 1, then the form's idle state).
// Hits: p.hit(src, type, die) goes to the form's OW (or DIE when die is true, func_802962BC); p.bounce(src, type) to its rebound state.
//
// Water: the decomp gives the transformations no water states. Termite, pumpkin, croc and walrus keep their land states in water
// (collision mode 1: they sink to and walk on the floor under the water, floor type 3 friction); the bee switches to BEE_FLY
// whenever player_inWater (and flaps itself up while in water). Water damage (freezing water etc.) comes from map hazards, not here.
(function (root) {
'use strict';
const M = root.BKMOVE || (typeof require !== 'undefined' ? require('./bkmove.js') : null);
const L = M.lib;
const { F, fadd, fsub, fmul, fdiv, fsqrt, sinf, cosf, BAD_DTOR, mlNormalizeAngle, ml_map_f, ml_mapRange_f, ml_interpolate_f, ml_clamp_f, ml_max_f,
  yaw_of, yaw_pitch_of, ONCE, LOOP, STOPPED, PHYS, S, INIT, UPDATE, END, REBOUND, FRICTION, P } = L;
const ZONES = () => [0.12, 0.2, 0.5, 0.75, 1.0].map(F); // bastick_resetZones

// ---- states (enums.h bs_e)
const ST = {
  ANT_IDLE: 0x35, ANT_WALK: 0x36, ANT_JUMP: 0x37, ANT_FALL: 0x38, ANT_OW: 0x3E, ANT_DIE: 0x43, ANT_LOCKED: 0x8E, ANT_BOUNCE: 0x9F,
  PUMPKIN_FLUSH: 0x40, PUMPKIN_IDLE: 0x48, PUMPKIN_WALK: 0x49, PUMPKIN_JUMP: 0x4A, PUMPKIN_FALL: 0x4B, PUMPKIN_OW: 0x4D, PUMPKIN_DIE: 0x4E,
  PUMPKIN_LOCKED: 0x8F, PUMPKIN_BOUNCE: 0xA0,
  CROC_IDLE: 0x5E, CROC_WALK: 0x5F, CROC_JUMP: 0x60, CROC_FALL: 0x61, CROC_OW: 0x63, CROC_DIE: 0x64, CROC_BITE: 0x6E, CROC_EAT_BAD: 0x6F,
  CROC_EAT_GOOD: 0x70, CROC_LOCKED: 0x8D, CROC_BOUNCE: 0xA1,
  WALRUS_IDLE: 0x67, WALRUS_WALK: 0x68, WALRUS_JUMP: 0x69, WALRUS_FALL: 0x6A, WALRUS_OW: 0x6C, WALRUS_DIE: 0x6D, WALRUS_SLED: 0x7D,
  WALRUS_SLED_JUMP: 0x7E, WALRUS_SLED_LOSE: 0x80, WALRUS_SLED_LOCKED: 0x81, WALRUS_SLED_LOSE_AIR: 0x82, WALRUS_BOUNCE: 0xA2,
  BEE_LOCKED: 0x6B, BEE_IDLE: 0x85, BEE_WALK: 0x86, BEE_JUMP: 0x87, BEE_FALL: 0x88, BEE_OW: 0x89, BEE_DIE: 0x8A, BEE_TAKEOFF: 0x8B,
  BEE_FLY: 0x8C, BEE_BOUNCE: 0xA3 };
for (const k in ST) L.addState(k, ST[k]);
// per-form: idle / fall / ow / die / rebound states (bs_getIdleState, func_8029BA80, func_802962BC, __get_rebound_state_id)
const FORMS = {
  banjo: { idle: S.IDLE, fall: S.FALL, ow: S.OW },
  ant: { idle: S.ANT_IDLE, fall: S.ANT_FALL, ow: S.ANT_OW, die: S.ANT_DIE, bounce: S.ANT_BOUNCE },
  pumpkin: { idle: S.PUMPKIN_IDLE, fall: S.PUMPKIN_FALL, ow: S.PUMPKIN_OW, die: S.PUMPKIN_DIE, bounce: S.PUMPKIN_BOUNCE },
  croc: { idle: S.CROC_IDLE, fall: S.CROC_FALL, ow: S.CROC_OW, die: S.CROC_DIE, bounce: S.CROC_BOUNCE },
  walrus: { idle: S.WALRUS_IDLE, fall: S.WALRUS_FALL, ow: S.WALRUS_OW, die: S.WALRUS_DIE, bounce: S.WALRUS_BOUNCE },
  bee: { idle: S.BEE_IDLE, fall: S.BEE_FALL, ow: S.BEE_OW, die: S.BEE_DIE, bounce: S.BEE_BOUNCE } };
// the *_inSet functions (which states keep the form's stick zones / collision size between states)
const ANT_SET = new Set([0x35, 0x36, 0x37, 0x38, 0x3E, 0x43, 0x8E, 0x92]);             // bsant_inSet (not 0x9F)
const PUMPKIN_SET = new Set([0x48, 0x49, 0x4A, 0x4B, 0x4D, 0x4E, 0x8F, 0x93]);         // bspumpkin_inSet (not 0x40, 0xA0)
const CROC_SET = new Set([0x5E, 0x5F, 0x60, 0x61, 0x63, 0x64, 0x6E, 0x6F, 0x70, 0x8D, 0x94]); // bscroc_inSet (not 0xA1)
const SLED_SET = new Set([0x81, 0x7D, 0x7E, 0x82, 0x80, 0x9C]);                         // bswalrus_inSledSet
const WALRUS_SET = new Set([0x67, 0x68, 0x69, 0x6A, 0x6C, 0x6D, 0x95, ...SLED_SET]);    // bswalrus_inSet (not 0xA2)
const BEE_SET = new Set([0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x9D, 0x6B, 0x8C]); // bsbee_inSet (not 0xA3)
const FORM_OF = {};
const reg = (form, ids) => { for (const id of ids) FORM_OF[id] = form; };
reg('ant', [0x35, 0x36, 0x37, 0x38, 0x3E, 0x43, 0x8E, 0x9F]); reg('pumpkin', [0x40, 0x48, 0x49, 0x4A, 0x4B, 0x4D, 0x4E, 0x8F, 0xA0]);
reg('croc', [0x5E, 0x5F, 0x60, 0x61, 0x63, 0x64, 0x6E, 0x6F, 0x70, 0x8D, 0xA1]);
reg('walrus', [0x67, 0x68, 0x69, 0x6A, 0x6C, 0x6D, 0x7D, 0x7E, 0x80, 0x81, 0x82, 0xA2]); reg('bee', [0x6B, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0xA3]);

// ---- Player additions
P.form = 'banjo'; P.animType = 1; P.walrusIce = 0; P.lookAt = null; P.turbo = 0; P.ateWrong = false; P.beeHover = false; P.dead = false;
P.setCol = function (h, r) { this.colHT = this.colH = F(h); this.colRT = this.colR = F(r); };   // func_80293D48 sets target and current
P.resetCol = function () { this.setCol(80, 35); };                                             // func_80293D74
P.setUT = function (animType, yawState, yawMode, ptype) { this.animType = animType; this.setUpdateTypes(yawState, yawMode, ptype); }; // code_14420_setUpdateTypes
P.setAnimScale = function (vmin, vmax, dmin, dmax) { this.animScale = [F(vmin), F(vmax), F(dmin), F(dmax)]; }; // baanim_setVelocityMapRanges
P.setPitchVel = function (lim, v) { this.pitchLim = F(lim); this.pitchVel = F(v); };          // pitch_setAngVel
P.floorPitch = function (flip) { // func_80299628(flip) -> func_80299594 -> func_8025901C(yaw (+180), floor normal, 1.0): pitch ideal (roll is cosmetic)
  const yaw = flip ? mlNormalizeAngle(fadd(this.yaw, 180)) : this.yaw; const yp = yaw_pitch_of(this.floorN()); let pit = 0;
  if (yp) { let d = fsub(yaw, yp[0]); if (d < -180.0) d = fadd(d, 360); if (180.0 <= d) d = fsub(d, 360); const ad = d >= 0 ? d : -d; const sp = F(yp[1] * 1.0); pit = ml_map_f(ad, 0, 180, sp, F(-sp)); }
  this.pitchIdeal = mlNormalizeAngle(pit);
};
P.formTarget = function (lo, hi) { this.thv = this.stick.zone === 0 ? 0 : ml_interpolate_f(this.stick.zp, lo, hi); };
P.faceLookAt = function () { // func_802B3A50: face the look-at target
  if (this.lookAt) { const y = yaw_of([fsub(F(this.lookAt[0]), this.pos[0]), 0, fsub(F(this.lookAt[2]), this.pos[2])]); if (y !== null) this.setIdeal(y); } };
P._setForm = function (f) { // the transformation itself (bsdronexform state 6 + the form's idle INIT) when a state of another form starts
  if (this.form === f) return; this.form = f; this.setCol(50, 25); if (f === 'walrus') this.walrusIce = 0.15; };
// jump start shared by every form (stick sets the facing, then horizontal speed from the target speed)
P._formJump = function (targetFn, vy, grav) {
  if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  targetFn.call(this); this.setHVel(this.ideal, this.thv); this.vel[1] = F(vy); this.grav = F(grav);
};
// anim helpers (baanim_setEnd / baanim_setEndAndDuration / anctrl reset + set*)
const setEnd = (a, e) => { a.setSub(0, e); a.type = ONCE; };
const setEndDur = (a, e, d) => { a.setSub(0, e); a.dur = F(d); a.type = ONCE; };
function animStart(a, id, dur, type, start, sub) { a.reset(); a.id = id; a.dur = F(dur); if (start !== undefined && start !== null) a.setStart(start); if (sub !== undefined) a.setSub(0, sub); a.type = type; a.go(); }
// knockback shared by the recoil / die states: face away from the hit source, move away from it
P._formKnock = function (hv) {
  const src = this.hitSrc || this.pos; const yw = yaw_of([fsub(this.pos[0], src[0]), 0, fsub(this.pos[2], src[2])]) ?? 0;
  this.setIdeal(F(yw + 180.0)); this.yaw = this.ideal; this.thv = F(hv); this.tyaw = yw; this.setHVel(yw, this.thv); return yw;
};
P._formRecoil = function (id, dur, sub) { // __bsant_recoil_init and friends
  animStart(this.anim, id, dur, ONCE, null, sub); this._formKnock(200); this.setUT(1, 1, 2, PHYS.LOCKED); this.vel[1] = F(510); this.grav = F(-1200); this.v.ph = 0;
};
const resetGrav = function () { this.grav = F(-2700); };

// ---- hits (code_EF50.c): the form's own ow / die / rebound state
const hit0 = P.hit;
P.hit = function (src, type, die) {
  const f = FORMS[this.form]; if (!f || this.form === 'banjo') return hit0.call(this, src, type);
  this.hitSrc = src.map(F); this.hitType = type; this.setState(die ? f.die : f.ow);
};
P.bounce = function (src, type) { // __get_rebound_state_id (Banjo's BS_56_RECOIL is not ported: falls back to OW)
  const f = FORMS[this.form]; if (!f || !f.bounce) return hit0.call(this, src, type);
  this.hitSrc = src.map(F); this.hitType = type; this.setState(f.bounce);
};
// ---- transform (bsdronexform): freeze, pitch 0, collision mode 1, form set, then bs_getIdleState()
P.transform = function (form) {
  if (!FORMS[form]) throw new Error('unknown form ' + form);
  this.vel = [0, 0, 0]; this.tvel = [0, 0, 0]; this.thv = 0; this.pitchIdeal = 0; this.colMode = 1; this.animType = 1;
  const prev = this.form; this.form = form; if (prev !== form && form !== 'banjo') { this.setCol(50, 25); if (form === 'walrus') this.walrusIce = 0.15; }
  this.setState(form === 'banjo' ? (this.inWater ? S.SWIM_IDLE : S.IDLE) : FORMS[form].idle);
};

// ---- engine hooks: BAANIM_UPDATE_2_SCALE_HORZ and the walrus ice friction
function hookAnim(p) {
  const a = p.anim; const up = a.update; p._animHooked = true;
  a.update = function (dt) { // __baanim_update_scaleToHorizontalVelocity (duration_scale off), clamped to baanim_setDurationRange(0.01, 100)
    if (p.animType === 2 && FORM_OF[p.state] && p.animScale) { const s = p.animScale, v = p.vel;
      this.dur = ml_clamp_f(ml_mapRange_f(fsqrt(fadd(fmul(v[0], v[0]), fmul(v[2], v[2]))), s[0], s[1], s[2], s[3]), F(0.01), F(100)); }
    return up.call(this, dt);
  };
}
const step0 = P.step;
P.step = function (inp, frames) { if (!this._animHooked) hookAnim(this); return step0.call(this, inp, frames); };
const phys0 = P.physics;
P.physics = function () {
  if (this.walrusIce && this.floorType === 4 && !this.frOv4) { const s = FRICTION[4]; FRICTION[4] = F(this.walrusIce); try { return phys0.call(this); } finally { FRICTION[4] = s; } }
  return phys0.call(this);
};

// =====================================================================================================================
// ---- termite (bs/ant.c): 30..500, jump 693.5 / -1200, collision 50 x 25
const antTarget = function () { this.formTarget(30, 500); };                                   // func_8029E48C
const antEnd = function () { if (!ANT_SET.has(this.nextState)) { this.zones = ZONES(); this.resetCol(); } this.animType = 1; }; // bsant_end
const antCol = function () { this._setForm('ant'); if (!ANT_SET.has(this.prevState)) this.setCol(50, 25); };              // func_8029E554
INIT[S.ANT_IDLE] = function () { antCol.call(this); this.anim.play(0x5E, 1.2, LOOP); this.setUT(1, 1, 1, PHYS.NORMAL); this.thv = 0; this.setPitchVel(1000, 12); };
UPDATE[S.ANT_IDLE] = function () {
  let n = 0; this.floorPitch(0); if (this.shouldFall()) n = S.ANT_FALL; if (this.stick.zone > 0) n = S.ANT_WALK; if (this.pressed('A')) n = S.ANT_JUMP; this.setState(n); };
END[S.ANT_IDLE] = antEnd;
INIT[S.ANT_WALK] = function () { antCol.call(this); this.anim.play(0x5F, 0.8, LOOP); this.setUT(2, 1, 1, PHYS.NORMAL); this.setAnimScale(30, 500, 0.44, 0.2); };
UPDATE[S.ANT_WALK] = function () {
  let n = 0; this.floorPitch(0); antTarget.call(this); if (this.stick.zone === 0 && this.slowerThan(1)) n = S.ANT_IDLE;
  if (this.shouldFall()) n = S.ANT_FALL; if (this.pressed('A')) n = S.ANT_JUMP; this.setState(n); };
END[S.ANT_WALK] = antEnd;
INIT[S.ANT_JUMP] = function () {
  antCol.call(this); animStart(this.anim, 0x60, 1.0, ONCE, 0.2987, 0.4423); this.setUT(1, 1, 3, PHYS.AIRBORN);
  this._formJump(antTarget, 693.5, -1200); this.v.ph = 0; };
UPDATE[S.ANT_JUMP] = function () {
  let n = 0; const a = this.anim; antTarget.call(this); if (this.released('A') && 0 < this.vel[1]) resetGrav.call(this);
  switch (this.v.ph) {
    case 0: if (a.stopped()) { a.dur = F(5); setEnd(a, 0.5026); this.v.ph = 1; } break;
    case 1: if (this.isAboveFloorBy(0x82)) { a.dur = F(1); setEnd(a, 1.0); this.v.ph = 2; } break;
    case 2: this.floorPitch(0); if (this.isStable()) this.v.ph = 3; break;
    case 3: if (a.stopped()) n = S.ANT_IDLE; break; }
  if (this.isStable()) { this.thv = 0; if (this.stick.zone > 0) n = S.ANT_WALK; if (this.pressed('A')) n = S.ANT_JUMP; }
  this.setState(n); };
END[S.ANT_JUMP] = function () { resetGrav.call(this); antEnd.call(this); };
INIT[S.ANT_FALL] = function () { antCol.call(this); animStart(this.anim, 0x60, 1.9, STOPPED, 0.4423); this.setUT(1, 1, 3, PHYS.AIRBORN); this.v.ph = 0; }; // D_8037D298 = 0: no target speed update
UPDATE[S.ANT_FALL] = function () {
  let n = 0; this.floorPitch(0);
  if (this.v.ph === 0 && this.isAboveFloorBy(0x5A)) { this.anim.dur = F(2); setEnd(this.anim, 1.0); this.v.ph = 1; }
  if (this.isStable()) n = S.ANT_IDLE; this.setState(n); };   // (BA_FLAG_19_SHOULD_TRANSFORM -> badrone_transform not modelled)
END[S.ANT_FALL] = antEnd;
const antRecoilInit = function () { antCol.call(this); this._formRecoil(0x28, 1.4, 0.4899); };
const antRecoilUpdate = function () {
  let n = 0; if (this.v.ph === 0 && this.isAboveFloorBy(0x5A)) { setEnd(this.anim, 1.0); this.v.ph = 1; } if (this.isStable()) n = S.ANT_IDLE; this.setState(n); };
const antRecoilEnd = function () { resetGrav.call(this); antEnd.call(this); };
INIT[S.ANT_OW] = antRecoilInit; UPDATE[S.ANT_OW] = antRecoilUpdate; END[S.ANT_OW] = antRecoilEnd;
INIT[S.ANT_BOUNCE] = antRecoilInit; UPDATE[S.ANT_BOUNCE] = antRecoilUpdate; END[S.ANT_BOUNCE] = antRecoilEnd;
INIT[S.ANT_DIE] = function () {
  antCol.call(this); animStart(this.anim, 0x29, 1.6, ONCE, null, 0.523); this.v.d = F(250); this._formKnock(this.v.d);
  this.setUT(1, 1, 2, PHYS.LOCKED); this.vel[1] = F(510); this.grav = F(-1200); this.setPitchVel(1000, 12); this.v.ph = 0; this.setTimer(0, 2.9); };
UPDATE[S.ANT_DIE] = function () {
  this.thv = this.v.d; this.floorPitch(0);
  switch (this.v.ph) {
    case 0: if (this.isStable()) { setEnd(this.anim, 1.0); this.v.d = 0; this.v.ph = 1; } break;
    case 1: if (this.anim.isAt(0.72)) { this.v.d = 0; this.v.ph = 2; } break; }
  if (this.decTimer(0)) this.dead = true; this.setState(0); };   // func_8029B890 (respawn / game over) not modelled
END[S.ANT_DIE] = function () { resetGrav.call(this); this.pitchIdeal = 0; };
INIT[S.ANT_LOCKED] = function () { antCol.call(this); this.anim.play(0x5E, 2.0, LOOP); this.setUT(1, 1, 3, PHYS.NORMAL); this.thv = 0; this.faceLookAt(); };
UPDATE[S.ANT_LOCKED] = function () { this.faceLookAt(); this.floorPitch(0); this.setState(this.lookAt ? 0 : S.ANT_IDLE); };
END[S.ANT_LOCKED] = antEnd;

// =====================================================================================================================
// ---- pumpkin (bs/pumpkin.c): 30..500, jump 693.5 / -1200, collision 50 x 25 (set by the idle state only)
const pumTarget = function () { this.formTarget(30, 500); };                                    // func_802B223C
const pumEnd = function () { if (!PUMPKIN_SET.has(this.nextState)) { this.zones = ZONES(); this.resetCol(); } this.animType = 1; }; // func_802B229C
INIT[S.PUMPKIN_IDLE] = function () { this._setForm('pumpkin'); this.anim.play(0xA0, 0.8, LOOP); this.setUT(1, 1, 1, PHYS.NORMAL); this.thv = 0; this.setPitchVel(1000, 12); this.setCol(50, 25); };
UPDATE[S.PUMPKIN_IDLE] = function () {
  let n = 0; if (this.shouldFall()) n = S.PUMPKIN_FALL; if (this.stick.zone > 0) n = S.PUMPKIN_WALK; if (this.pressed('A')) n = S.PUMPKIN_JUMP; this.setState(n); };
END[S.PUMPKIN_IDLE] = pumEnd;
INIT[S.PUMPKIN_WALK] = function () { this._setForm('pumpkin'); this.anim.play(0xA0, 0.8, LOOP); this.setUT(2, 1, 1, PHYS.NORMAL); this.setAnimScale(30, 500, 0.44, 0.2); };
UPDATE[S.PUMPKIN_WALK] = function () {
  let n = 0; pumTarget.call(this); if (this.stick.zone === 0 && this.slowerThan(1)) n = S.PUMPKIN_IDLE;
  if (this.shouldFall()) n = S.PUMPKIN_FALL; if (this.pressed('A')) n = S.PUMPKIN_JUMP; this.setState(n); };
END[S.PUMPKIN_WALK] = pumEnd;
INIT[S.PUMPKIN_JUMP] = function () {
  this._setForm('pumpkin'); animStart(this.anim, 0xA1, 1.2, ONCE, null, 0.3941); this.setUT(1, 1, 3, PHYS.AIRBORN);
  this._formJump(pumTarget, 693.5, -1200); this.v.ph = 0; };
UPDATE[S.PUMPKIN_JUMP] = function () {
  let n = 0; const a = this.anim; pumTarget.call(this); if (this.released('A') && this.vel[1] > 0) resetGrav.call(this);
  switch (this.v.ph) {
    case 0: if (this.vel[1] < 0) { if (this.isAboveFloorBy(130)) { a.dur = F(0.7); setEnd(a, 0.8059); this.v.ph = 2; } else { setEnd(a, 0.662); this.v.ph = 1; } } break;
    case 1: if (this.isAboveFloorBy(130)) { setEnd(a, 0.8059); this.v.ph = 2; } break;
    case 2: if (this.isStable()) { setEndDur(a, 1.0, 1.2); this.v.ph = 3; } break;
    case 3: if (a.stopped()) { this.thv = 0; n = S.PUMPKIN_IDLE; } break; }
  if (this.isStable()) { if (this.stick.zone > 0) n = S.PUMPKIN_WALK; if (this.pressed('A')) n = S.PUMPKIN_JUMP; }
  this.setState(n); };
END[S.PUMPKIN_JUMP] = function () { resetGrav.call(this); pumEnd.call(this); };
INIT[S.PUMPKIN_FALL] = function () { this._setForm('pumpkin'); animStart(this.anim, 0xA1, 0.7, STOPPED, 0.662); this.setUT(1, 1, 3, PHYS.AIRBORN); this.v.ph = 0; }; // D_8037D4E4 = 0
UPDATE[S.PUMPKIN_FALL] = function () {
  let n = 0; const a = this.anim;
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(130)) { setEnd(a, 0.8059); this.v.ph = 1; } break;
    case 1: if (this.isStable()) { this.thv = 0; setEndDur(a, 1.0, 1.2); this.v.ph = 2; } break; }
  if (this.isStable() && (this.stick.zone > 0 || (this.v.ph === 2 && a.stopped()))) n = S.PUMPKIN_IDLE;
  this.setState(n); };
END[S.PUMPKIN_FALL] = pumEnd;
// toilet flush (MMM): frozen, spinning, sinking 50 units over 2.3 s at flushPos; collision mode 6 (none) -> engine ghost mode. Ends by cutscene.
INIT[S.PUMPKIN_FLUSH] = function () {
  this._setForm('pumpkin'); this.v.fp = (this.flushPos || this.pos).map(F); this.pos = this.v.fp.slice();
  this.anim.play(0xA0, 0.8, LOOP); this.setUT(1, 1, 2, PHYS.NONE); this.colMode = 6; this.v.ghost = this.ghost; this.ghost = true; this.setTimer(0, 0); };
UPDATE[S.PUMPKIN_FLUSH] = function () {
  this.timersLast[0] = this.timers[0]; this.timers[0] = fadd(this.timers[0], this.dt); const t = this.timers[0]; // batimer_increment
  this.setIdeal(fadd(this.ideal, ml_map_f(t, 0, 2.3, 0, 45))); this.yaw = this.ideal;
  const fp = this.v.fp; this.pos = [fp[0], ml_map_f(t, 0, 2.3, fp[1], F(fp[1] - 50.0)), fp[2]]; this.setState(0); };
END[S.PUMPKIN_FLUSH] = function () { this.colMode = 1; this.ghost = this.v.ghost; };
const pumRecoilInit = function () { this._setForm('pumpkin'); this._formRecoil(0x236, 1.3, 0.45); };
const pumRecoilUpdate = function () {
  let n = 0; switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(90)) { setEndDur(this.anim, 1.0, 0.5); this.v.ph = 1; } break;
    case 1: if (this.anim.stopped()) n = S.PUMPKIN_IDLE; break; }
  this.setState(n); };
const pumRecoilEnd = function () { resetGrav.call(this); pumEnd.call(this); };
INIT[S.PUMPKIN_OW] = pumRecoilInit; UPDATE[S.PUMPKIN_OW] = pumRecoilUpdate; END[S.PUMPKIN_OW] = pumRecoilEnd;
INIT[S.PUMPKIN_BOUNCE] = pumRecoilInit; UPDATE[S.PUMPKIN_BOUNCE] = pumRecoilUpdate; END[S.PUMPKIN_BOUNCE] = pumRecoilEnd;
INIT[S.PUMPKIN_DIE] = function () {
  this._setForm('pumpkin'); animStart(this.anim, 0x188, 3.5, ONCE, null, 0.1439); this.v.d = F(250); this._formKnock(this.v.d);
  this.setUT(1, 1, 2, PHYS.LOCKED); this.vel[1] = F(510); this.grav = F(-1200); this.setPitchVel(1000, 12); this.setTimer(1, 2.9); this.v.ph = 0; };
UPDATE[S.PUMPKIN_DIE] = function () {
  this.thv = this.v.d; this.floorPitch(0); const a = this.anim; const dec = () => { this.v.d = ml_max_f(0, fsub(this.v.d, 10)); };
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(90)) { setEnd(a, 0.1571); this.v.ph = 1; } break;
    case 1: if (this.isStable()) { setEndDur(a, 0.2, 2.9); this.v.ph = 2; } break;
    case 2: if (a.stopped()) { this.vel[1] = F(400); setEnd(a, 0.355); this.v.ph = 3; } break;
    case 3: dec(); if (this.isAboveFloorBy(90)) { setEnd(a, 0.36); this.v.ph = 4; } break;
    case 4: dec(); if (this.isStable()) { setEnd(a, 1.0); this.v.ph = 5; } break;
    case 5: dec(); break; }
  if (this.decTimer(1)) this.dead = true; this.setState(0); };
END[S.PUMPKIN_DIE] = function () { pumEnd.call(this); resetGrav.call(this); this.pitchIdeal = 0; };
INIT[S.PUMPKIN_LOCKED] = function () { this._setForm('pumpkin'); this.anim.play(0xA0, 0.8, LOOP); this.setUT(1, 1, 3, PHYS.NORMAL); this.thv = 0; this.faceLookAt(); };
UPDATE[S.PUMPKIN_LOCKED] = function () { this.faceLookAt(); this.setState(this.lookAt ? 0 : S.PUMPKIN_IDLE); };
END[S.PUMPKIN_LOCKED] = pumEnd;

// =====================================================================================================================
// ---- crocodile (bs/croc.c): 30..375 (500 with turbo trainers), jump 693.5 / -1200, collision 50 x 25, bite lunges 500 (400 in the air)
const crocTarget = function () { this.formTarget(30, this.turbo !== 0 ? 500 : 375); };          // __bscroc_update_velocity / __bscroc_getMaxVelocity
const crocTurbo = function () { if (this.turbo > 0) this.turbo = ml_max_f(0, fsub(F(this.turbo), this.dt)); }; // state timer 3 (picking trainers up not modelled)
const crocEnd = function () { if (!CROC_SET.has(this.nextState)) { this.zones = ZONES(); this.resetCol(); } this.animType = 1; }; // __bscroc_end
INIT[S.CROC_IDLE] = function () { this._setForm('croc'); this.anim.play(0xE1, 1.0, LOOP); this.setUT(1, 1, 1, PHYS.NORMAL); this.thv = 0; this.setPitchVel(1000, 12); this.setCol(50, 25); };
UPDATE[S.CROC_IDLE] = function () {
  let n = 0; crocTurbo.call(this); this.floorPitch(0); if (this.shouldFall()) n = S.CROC_FALL; if (this.stick.zone > 0) n = S.CROC_WALK;
  if (this.pressed('B')) n = S.CROC_BITE; if (this.pressed('A')) n = S.CROC_JUMP; this.setState(n); }; // (func_8029CA94 flags not modelled)
END[S.CROC_IDLE] = crocEnd;
INIT[S.CROC_WALK] = function () { this._setForm('croc'); this.anim.play(0xE0, 0.8, LOOP, 0.4); this.setUT(2, 1, 1, PHYS.NORMAL); this.setAnimScale(30, 375, 0.5, 0.3); };
UPDATE[S.CROC_WALK] = function () {
  let n = 0; crocTurbo.call(this); this.floorPitch(0); crocTarget.call(this); if (this.stick.zone === 0 && this.slowerThan(1)) n = S.CROC_IDLE;
  if (this.shouldFall()) n = S.CROC_FALL; if (this.pressed('B')) n = S.CROC_BITE; if (this.pressed('A')) n = S.CROC_JUMP; this.setState(n); };
END[S.CROC_WALK] = crocEnd;
INIT[S.CROC_JUMP] = function () {
  this._setForm('croc'); animStart(this.anim, 0x11C, 1.0, ONCE, 0.1, 0.35); this.setUT(1, 1, 3, PHYS.AIRBORN);
  this._formJump(crocTarget, 693.5, -1200); this.v.ph = 0; };
UPDATE[S.CROC_JUMP] = function () {
  let n = 0; const a = this.anim; crocTurbo.call(this); crocTarget.call(this); if (this.released('A') && 0 < this.vel[1]) resetGrav.call(this);
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(0x82)) { setEndDur(a, 0.6538, 0.7); this.v.ph = 2; } else if (a.stopped()) { setEndDur(a, 0.5036, 3.0); this.v.ph = 1; } break;
    case 1: if (this.isAboveFloorBy(0x82)) { setEndDur(a, 0.6538, 1.0); this.v.ph = 2; } break;
    case 2: this.floorPitch(0); if (this.isStable()) { setEndDur(a, 1.0, 1.0); this.v.ph = 3; } break;
    case 3: this.floorPitch(0); if (a.stopped()) { this.thv = 0; n = S.CROC_IDLE; } break; }
  if (this.isStable()) { if (this.stick.zone > 0) n = S.CROC_WALK; if (this.pressed('A')) n = S.CROC_JUMP; }
  if (this.pressed('B')) n = S.CROC_BITE; this.setState(n); };
END[S.CROC_JUMP] = function () { resetGrav.call(this); crocEnd.call(this); };
INIT[S.CROC_FALL] = function () { this._setForm('croc'); animStart(this.anim, 0x11C, 0.7, STOPPED, 0.5036); this.setUT(1, 1, 3, PHYS.AIRBORN); this.v.ph = 0; };
UPDATE[S.CROC_FALL] = function () {
  let n = 0; const a = this.anim; crocTurbo.call(this); this.floorPitch(0); crocTarget.call(this);
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(0x82)) { setEnd(a, 0.6538); this.v.ph = 1; } break;
    case 1: if (this.isStable()) { this.thv = 0; setEndDur(a, 1.0, 1.0); this.v.ph = 2; } break; }
  if (this.isStable() && (this.stick.zone > 0 || (this.v.ph === 2 && a.stopped()))) n = S.CROC_IDLE;
  this.setState(n); };
END[S.CROC_FALL] = crocEnd;
const crocRecoilInit = function () { this._setForm('croc'); this._formRecoil(0x11D, 1.0, 0.7518); };
const crocRecoilUpdate = function () {
  let n = 0; crocTurbo.call(this); if (this.v.ph === 0 && this.isAboveFloorBy(0x5A)) { setEnd(this.anim, 1.0); this.v.ph = 1; } if (this.isStable()) n = S.CROC_IDLE; this.setState(n); };
const crocRecoilEnd = function () { resetGrav.call(this); crocEnd.call(this); };
INIT[S.CROC_OW] = crocRecoilInit; UPDATE[S.CROC_OW] = crocRecoilUpdate; END[S.CROC_OW] = crocRecoilEnd;
INIT[S.CROC_BOUNCE] = crocRecoilInit; UPDATE[S.CROC_BOUNCE] = crocRecoilUpdate; END[S.CROC_BOUNCE] = crocRecoilEnd;
// die: shared by croc / walrus / bee (vy 420, a second hop of 400 on the first landing, then sliding to a stop at 10 per update)
const die420 = function (id, dur, sub, timer) {
  animStart(this.anim, id, dur, ONCE, null, sub); this.setUT(1, 1, 2, PHYS.LOCKED); this.v.d = F(250); this._formKnock(this.v.d);
  this.vel[1] = F(420); this.grav = F(-1200); this.setPitchVel(1000, 12); this.setTimer(0, timer); this.v.ph = 0; };
const die420Update = function (first, skip1) {
  this.thv = this.v.d; this.floorPitch(0);
  switch (this.v.ph) {
    case 0: if (this.isStable()) { setEnd(this.anim, first); this.vel[1] = F(400); this.v.ph = skip1 ? 2 : 1; } break;
    case 1: if (this.isStable()) { setEnd(this.anim, 1.0); this.v.ph = 2; } break;
    case 2: this.v.ph = 3; break;
    case 3: if (0 < this.v.d) this.v.d = ml_max_f(0, fsub(this.v.d, 10)); break; }
  if (this.decTimer(0)) this.dead = true; };
INIT[S.CROC_DIE] = function () { this._setForm('croc'); die420.call(this, 0x11E, 1.7, 0.3966, 2.9); };
UPDATE[S.CROC_DIE] = function () { crocTurbo.call(this); die420Update.call(this, 0.7453, false); this.setState(0); };
END[S.CROC_DIE] = function () { resetGrav.call(this); this.pitchIdeal = 0; };
const crocLunge = function () { // func_802ACF58: velocity set straight to 500 (400 in the air) along the facing, 200 up
  const len = F(this.isStable() ? 500 : 400); const y = F(this.yaw * BAD_DTOR); this.vel = [fmul(sinf(y), len), F(200), fmul(cosf(y), len)]; };
INIT[S.CROC_BITE] = function () { this._setForm('croc'); this.anim.play(0x122, 0.25, LOOP, 0.2); this.setUT(1, 1, 1, PHYS.LOCKED); crocLunge.call(this); this.v.n = 0; this.crocBite = true; };
UPDATE[S.CROC_BITE] = function () {
  let n = 0; const a = this.anim; crocTurbo.call(this); this.floorPitch(0);
  if (a.isAt(0.99)) { this.v.n++; if (this.v.n === 1) { crocLunge.call(this); a.dur = F(0.28); } else if (this.v.n === 2) { crocLunge.call(this); a.dur = F(0.32); a.type = ONCE; } }
  if (this.v.n === 3) n = this.shouldFall() ? S.CROC_FALL : S.CROC_WALK;
  if (this.isStable() && this.pressed('A')) n = S.CROC_JUMP; this.setState(n); };
END[S.CROC_BITE] = function () { this.crocBite = false; crocEnd.call(this); };   // _bscrocHitboxActive
INIT[S.CROC_EAT_BAD] = function () { this._setForm('croc'); this.anim.play(0x123, 2.41, ONCE); this.setUT(1, 1, 2, PHYS.LOCKED); this.thv = 0; };
UPDATE[S.CROC_EAT_BAD] = function () { crocTurbo.call(this); this.floorPitch(0); this.setState(this.anim.stopped() ? S.CROC_IDLE : 0); };
END[S.CROC_EAT_BAD] = crocEnd;
INIT[S.CROC_EAT_GOOD] = function () { this._setForm('croc'); this.anim.play(0x122, 0.25, LOOP); this.setUT(1, 1, 1, PHYS.NORMAL); this.v.n = 0; };
UPDATE[S.CROC_EAT_GOOD] = function () {
  let n = 0; const a = this.anim; crocTurbo.call(this); this.floorPitch(0); crocTarget.call(this);
  if (a.isAt(0.99)) { this.v.n++; if (this.v.n === 1) a.dur = F(0.28); else if (this.v.n === 2) { a.dur = F(0.32); a.type = ONCE; } else if (this.v.n === 3) n = this.ateWrong ? S.CROC_EAT_BAD : S.CROC_IDLE; }
  this.setState(n); };
END[S.CROC_EAT_GOOD] = function () { this.ateWrong = false; crocEnd.call(this); };
INIT[S.CROC_LOCKED] = function () { this._setForm('croc'); this.anim.play(0xE1, 1.0, LOOP); this.setUT(1, 1, 3, PHYS.NORMAL); this.thv = 0; this.faceLookAt(); };
UPDATE[S.CROC_LOCKED] = function () { crocTurbo.call(this); this.faceLookAt(); this.floorPitch(0); this.setState(this.lookAt ? 0 : S.CROC_IDLE); };
END[S.CROC_LOCKED] = function () { this.pitchIdeal = 0; crocEnd.call(this); };

// =====================================================================================================================
// ---- walrus (bs/walrus.c): 30..400, jump 693.5 / -1200, collision 50 x 25, ice friction 0.15 (instead of 0.05);
// sled: 30..700 (+350 going uphill with A held or released less than 3 updates ago)
const walTarget = function () { this.formTarget(30, 400); };                                     // func_802B7E6C
const sledTarget = function () { // func_802B7F28 (+ func_802B7ECC)
  let hi = F(700); const zp = this.stick.zp; this.v.boost = F(ml_clamp_f(this.keys.A[1] < 3 ? 1 : 0, 0, 1));
  const v = [this.vel[0], 0, this.vel[2]]; const l2 = fadd(fadd(fmul(v[0], v[0]), fmul(v[1], v[1])), fmul(v[2], v[2]));
  if (900.0 < l2) { const inv = F(1.0 / fsqrt(l2)); const u = v.map(x => fmul(x, inv)); const n = this.floorN();
    if (fadd(fadd(fmul(u[0], n[0]), fmul(u[1], n[1])), fmul(u[2], n[2])) < -0.2) hi = F(hi + this.v.boost * 350.0); }
  this.thv = this.stick.zone === 0 ? 0 : ml_interpolate_f(zp, 30, hi);
};
const walEnd = function () { // func_802B8048
  if (!WALRUS_SET.has(this.nextState)) { this.pitchIdeal = 0; this.zones = ZONES(); this.resetCol(); this.walrusIce = 0; } };
const sledEnd = function () { if (!SLED_SET.has(this.nextState)) walEnd.call(this); };    // func_802B80D0
const walIce = function () { this._setForm('walrus'); this.walrusIce = 0.15; };              // func_802B8110
const sledEnter = function () { this._setForm('walrus'); if (!SLED_SET.has(this.prevState)) { this.v.boost = 0; this.walrusIce = 0.15; } }; // func_802B813C
INIT[S.WALRUS_IDLE] = function () { walIce.call(this); this.anim.play(0x11F, 4.0, LOOP); this.setUT(1, 1, 1, PHYS.NORMAL); this.thv = 0; this.setPitchVel(1000, 12); this.setCol(50, 25); };
UPDATE[S.WALRUS_IDLE] = function () {
  let n = 0; this.floorPitch(0); if (this.shouldFall()) n = S.WALRUS_FALL; if (this.stick.zone > 0) n = S.WALRUS_WALK; if (this.pressed('A')) n = S.WALRUS_JUMP; this.setState(n); };
END[S.WALRUS_IDLE] = walEnd;
INIT[S.WALRUS_WALK] = function () { walIce.call(this); this.anim.play(0x120, 0.8, LOOP); this.setUT(2, 1, 1, PHYS.NORMAL); this.setAnimScale(30, 400, 0.6, 0.4); };
UPDATE[S.WALRUS_WALK] = function () {
  let n = 0; this.floorPitch(0); walTarget.call(this); if (this.stick.zone === 0 && this.slowerThan(1)) n = S.WALRUS_IDLE;
  if (this.shouldFall()) n = S.WALRUS_FALL; if (this.pressed('A')) n = S.WALRUS_JUMP; this.setState(n); };
END[S.WALRUS_WALK] = walEnd;
INIT[S.WALRUS_JUMP] = function () {
  animStart(this.anim, 0x121, 1.0, ONCE, 0.1, 0.514); this.setUT(1, 1, 3, PHYS.AIRBORN); this._setForm('walrus');
  this._formJump(walTarget, 693.5, -1200); walIce.call(this); this.v.ph = 0; };
UPDATE[S.WALRUS_JUMP] = function () {
  let n = 0; const a = this.anim; walTarget.call(this); if (this.released('A') && 0 < this.vel[1]) resetGrav.call(this);
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(0x82)) { a.dur = F(0.7); setEnd(a, 0.8501); this.v.ph = 2; } else if (a.stopped()) { setEnd(a, 0.6734); a.dur = F(3); this.v.ph = 1; } break;
    case 1: if (this.isAboveFloorBy(0x82)) { setEndDur(a, 0.8501, 1.0); this.v.ph = 2; } break;
    case 2: this.floorPitch(0); if (this.isStable()) { setEndDur(a, 1.0, 1.0); this.v.ph = 3; } break;
    case 3: this.floorPitch(0); if (a.stopped()) { this.thv = 0; n = S.WALRUS_IDLE; } break; }
  if (this.isStable()) { if (this.stick.zone > 0) n = S.WALRUS_WALK; if (this.pressed('A')) n = S.WALRUS_JUMP; }
  this.setState(n); };
END[S.WALRUS_JUMP] = function () { resetGrav.call(this); walEnd.call(this); };
INIT[S.WALRUS_FALL] = function () { animStart(this.anim, 0x121, 0.7, STOPPED, 0.662); this.setUT(1, 1, 3, PHYS.AIRBORN); walIce.call(this); this.v.ph = 0; };
UPDATE[S.WALRUS_FALL] = function () {
  let n = 0; const a = this.anim; this.floorPitch(0); walTarget.call(this);
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(0x82)) { setEnd(a, 0.8501); this.v.ph = 1; } break;
    case 1: if (this.isStable()) { this.thv = 0; setEndDur(a, 1.0, 1.0); this.v.ph = 2; } break; }
  if (this.isStable() && (this.stick.zone > 0 || (this.v.ph === 2 && a.stopped()))) n = S.WALRUS_IDLE;
  this.setState(n); };
END[S.WALRUS_FALL] = walEnd;
const walRecoilInit = function () { // __bswalrus_recoil_init: speeds from the rebound table (barebound, type = the hit's rebound id)
  this._setForm('walrus'); const rb = REBOUND[this.hitType] || REBOUND[1]; this.anim.play(0x19C, 1.0, ONCE);
  this._formKnock(rb[3]); this.setUT(1, 1, 2, PHYS.LOCKED); this.vel[1] = F(rb[1]); this.grav = F(rb[2]); walIce.call(this); };
const walRecoilUpdate = function () { this.setState(this.isStable() ? S.WALRUS_IDLE : 0); };
const walRecoilEnd = function () { resetGrav.call(this); walEnd.call(this); };
INIT[S.WALRUS_OW] = walRecoilInit; UPDATE[S.WALRUS_OW] = walRecoilUpdate; END[S.WALRUS_OW] = walRecoilEnd;
INIT[S.WALRUS_BOUNCE] = walRecoilInit; UPDATE[S.WALRUS_BOUNCE] = walRecoilUpdate; END[S.WALRUS_BOUNCE] = walRecoilEnd;
INIT[S.WALRUS_DIE] = function () { this._setForm('walrus'); die420.call(this, 0x19D, 2.2, 0.4454, 1.5); walIce.call(this); };
UPDATE[S.WALRUS_DIE] = function () { die420Update.call(this, 1.0, true); this.setState(0); };
END[S.WALRUS_DIE] = function () { resetGrav.call(this); this.pitchIdeal = 0; };
INIT[S.WALRUS_SLED_LOCKED] = function () { this.anim.play(0x19E, 0.8, LOOP); this.setUT(1, 1, 3, PHYS.NORMAL); this.thv = 0; sledEnter.call(this); this.faceLookAt(); };
UPDATE[S.WALRUS_SLED_LOCKED] = function () { this.faceLookAt(); this.floorPitch(0); this.setState(this.lookAt ? 0 : S.WALRUS_SLED); };
END[S.WALRUS_SLED_LOCKED] = sledEnd;
INIT[S.WALRUS_SLED] = function () { this.anim.play(0x19E, 0.8, LOOP); this.setUT(2, 1, 1, PHYS.NORMAL); this.setAnimScale(30, 400, 0.6, 0.44); sledEnter.call(this); };
UPDATE[S.WALRUS_SLED] = function () { let n = 0; this.floorPitch(0); sledTarget.call(this); if (this.pressed('A')) n = S.WALRUS_SLED_JUMP; this.setState(n); };
END[S.WALRUS_SLED] = sledEnd;
INIT[S.WALRUS_SLED_JUMP] = function () {
  animStart(this.anim, 0x19F, 1.0, ONCE, 0.14, 0.4285); this.setUT(1, 1, 3, PHYS.AIRBORN); this._setForm('walrus');
  this._formJump(sledTarget, 693.5, -1200); sledEnter.call(this); this.v.ph = 0; };
UPDATE[S.WALRUS_SLED_JUMP] = function () {
  let n = 0; const a = this.anim; sledTarget.call(this); if (this.released('A') && 0 < this.vel[1]) resetGrav.call(this);
  switch (this.v.ph) {
    case 0: if (a.stopped()) { setEndDur(a, 0.5058, 7.0); this.v.ph = 1; } break;
    case 1: if (this.isAboveFloorBy(0x82)) { setEndDur(a, 1.0, 1.0); this.v.ph = 2; } break;
    case 2: if (a.stopped()) n = S.WALRUS_SLED; break; }
  if (this.isStable() && this.pressed('A')) n = S.WALRUS_SLED_JUMP; this.setState(n); };
END[S.WALRUS_SLED_JUMP] = function () { resetGrav.call(this); sledEnd.call(this); };
INIT[S.WALRUS_SLED_LOSE_AIR] = function () { animStart(this.anim, 0x19F, 1.0, STOPPED, null, 0.5058); this.setUT(1, 1, 3, PHYS.AIRBORN); sledEnter.call(this); this.v.ph = 0; };
UPDATE[S.WALRUS_SLED_LOSE_AIR] = function () {
  let n = 0; const a = this.anim; this.floorPitch(0); walTarget.call(this);
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(0x82)) { setEndDur(a, 1.0, 1.0); this.v.ph = 1; } break;
    case 1: if (this.isStable()) { this.thv = 0; this.v.ph = 2; } break; }
  if (this.isStable()) { if (this.stick.zone > 0 || (this.v.ph === 2 && a.stopped())) n = S.WALRUS_SLED; if (this.pressed('A')) n = S.WALRUS_SLED_JUMP; }
  this.setState(n); };
END[S.WALRUS_SLED_LOSE_AIR] = walEnd;   // func_802B8048 (not the sled end)
INIT[S.WALRUS_SLED_LOSE] = function () { this.anim.play(0x1A9, 3.2, ONCE); this.setUT(1, 1, 3, PHYS.NONE); this.thv = 0; this.setTimer(0, 2.9); sledEnter.call(this); };
UPDATE[S.WALRUS_SLED_LOSE] = function () { this.floorPitch(0); if (this.decTimer(0)) this.dead = true; this.setState(0); }; // (yaw ideal = camera yaw + 35: no camera position here)
END[S.WALRUS_SLED_LOSE] = sledEnd;

// =====================================================================================================================
// ---- bee (bs/bee.c, beeMain.c, beeFly.c): 30..375, jump 693.5 / -1200, collision 50 x 25; A in the air -> flight
const beeTarget = function () { this.formTarget(30, 375); };                                    // func_802A1020
const beeEnd = function () { if (!BEE_SET.has(this.nextState)) { this.pitchIdeal = 0; this.zones = ZONES(); this.resetCol(); } this.animType = 1; }; // func_802A02C0
const beeEnter = function () { this._setForm('bee'); if (!BEE_SET.has(this.prevState)) { this.setPitchVel(1000, 12); this.setCol(50, 25); } };      // func_802A0340
INIT[S.BEE_IDLE] = function () { beeEnter.call(this); this.anim.play(0x1DE, 3.0, LOOP); this.setUT(1, 1, 1, PHYS.NORMAL); this.thv = 0; };
UPDATE[S.BEE_IDLE] = function () {
  let n = 0; this.floorPitch(0); if (this.shouldFall()) n = S.BEE_FALL; if (this.stick.zone > 0) n = S.BEE_WALK; if (this.pressed('A')) n = S.BEE_JUMP;
  if (this.inWater) n = S.BEE_FLY; this.setState(n); };
END[S.BEE_IDLE] = beeEnd;
INIT[S.BEE_WALK] = function () { beeEnter.call(this); this.anim.play(0x1DD, 0.38, LOOP); this.setUT(2, 1, 1, PHYS.NORMAL); this.setAnimScale(30, 375, 0.6, 0.4); };
UPDATE[S.BEE_WALK] = function () {
  let n = 0; this.floorPitch(0); beeTarget.call(this); if (this.stick.zone === 0 && this.slowerThan(1)) n = S.BEE_IDLE;
  if (this.shouldFall()) n = S.BEE_FALL; if (this.pressed('A')) n = S.BEE_JUMP; if (this.inWater) n = S.BEE_FLY; this.setState(n); };
END[S.BEE_WALK] = beeEnd;
INIT[S.BEE_JUMP] = function () {
  beeEnter.call(this); animStart(this.anim, 0x1E2, 1.2, ONCE, 0.1, 0.34); this.setUT(1, 1, 3, PHYS.AIRBORN);
  this._formJump(beeTarget, 693.5, -1200); this.v.ph = 0; };
UPDATE[S.BEE_JUMP] = function () {
  let n = 0; const a = this.anim; beeTarget.call(this); if (this.released('A') && 0 < this.vel[1]) resetGrav.call(this);
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(130)) { setEndDur(a, 0.715, 0.7); this.v.ph = 2; } else if (a.stopped()) { setEndDur(a, 0.51, 4.0); this.v.ph = 1; } break;
    case 1: if (this.isAboveFloorBy(130)) { setEndDur(a, 0.715, 1.2); this.v.ph = 2; } break;
    case 2: this.floorPitch(0); if (this.isStable()) { setEndDur(a, 1.0, 0.7); this.v.ph = 3; } break;
    case 3: this.floorPitch(0); if (a.stopped()) { this.thv = 0; n = S.BEE_IDLE; } break; }
  if (this.isStable()) { if (this.stick.zone > 0) n = S.BEE_WALK; if (this.pressed('A')) n = S.BEE_JUMP; }
  else if (this.pressed('A')) n = S.BEE_FLY;
  if (this.inWater) n = S.BEE_FLY; this.setState(n); };
END[S.BEE_JUMP] = function () { beeEnd.call(this); resetGrav.call(this); };
INIT[S.BEE_FALL] = function () { beeEnter.call(this); animStart(this.anim, 0x1E2, 8.0, ONCE, 0.34, 0.51); this.setUT(1, 1, 3, PHYS.AIRBORN); this.v.ph = 0; };
UPDATE[S.BEE_FALL] = function () {
  let n = 0; const a = this.anim; this.floorPitch(0); beeTarget.call(this);
  switch (this.v.ph) {
    case 0: if (this.isAboveFloorBy(0x82)) { setEndDur(a, 0.715, 0.7); this.v.ph = 1; } break;
    case 1: this.floorPitch(0); if (this.isStable()) { this.thv = 0; setEndDur(a, 1.0, 0.7); this.v.ph = 2; } break;
    case 2: this.floorPitch(0); if (a.stopped()) { this.thv = 0; n = S.BEE_IDLE; } break; }
  if (this.isStable()) { if (this.stick.zone > 0) n = S.BEE_WALK; if (this.pressed('A')) n = S.BEE_JUMP; }
  else if (this.pressed('A')) n = S.BEE_FLY;   // (BA_FLAG_F not modelled)
  if (this.inWater) n = S.BEE_FLY; this.setState(n); };
END[S.BEE_FALL] = beeEnd;
const beeRecoilInit = function () { beeEnter.call(this); this._formRecoil(0x1E0, 1.0, 0.7518); };
const beeRecoilUpdate = function () {
  let n = 0; if (this.v.ph === 0 && this.isAboveFloorBy(0x5A)) { setEnd(this.anim, 1.0); this.v.ph = 1; } if (this.isStable()) n = S.BEE_IDLE;
  if (0.65 < this.anim.anim && this.inWater) n = S.BEE_FLY; this.setState(n); };
const beeRecoilEnd = function () { resetGrav.call(this); beeEnd.call(this); };
INIT[S.BEE_OW] = beeRecoilInit; UPDATE[S.BEE_OW] = beeRecoilUpdate; END[S.BEE_OW] = beeRecoilEnd;
INIT[S.BEE_BOUNCE] = beeRecoilInit; UPDATE[S.BEE_BOUNCE] = beeRecoilUpdate; END[S.BEE_BOUNCE] = beeRecoilEnd;
INIT[S.BEE_DIE] = function () { beeEnter.call(this); die420.call(this, 0x1E1, 1.7, 0.3966, 2.9); };
UPDATE[S.BEE_DIE] = function () { die420Update.call(this, 0.7453, false); this.setState(0); };
END[S.BEE_DIE] = function () { resetGrav.call(this); beeEnd.call(this); };
INIT[S.BEE_LOCKED] = function () { beeEnter.call(this); this.anim.play(0x1DE, 3.0, LOOP); this.setUT(1, 1, 3, PHYS.NORMAL); this.thv = 0; this.faceLookAt(); };
UPDATE[S.BEE_LOCKED] = function () { this.faceLookAt(); this.floorPitch(0); this.setState(this.lookAt ? 0 : S.BEE_IDLE); };
END[S.BEE_LOCKED] = function () { this.pitchIdeal = 0; beeEnd.call(this); };
// take-off (bsbeefly_bs8Bunknown, BS_8B): 1600 up at anim 0.266, then flight once falling (no state of the game enters it that we know of)
INIT[S.BEE_TAKEOFF] = function () {
  beeEnter.call(this); this.anim.play(0x1DF, 1.5, ONCE); this.setUT(1, 1, 3, PHYS.AIRBORN);
  if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = this.ideal; this.thv = 0; this.grav = F(-1200); this.v.ph = 0; };
UPDATE[S.BEE_TAKEOFF] = function () {
  let n = 0; const a = this.anim;
  if (this.v.ph === 0) { if (a.isAt(0.266)) { this.vel[1] = F(1600); this.v.ph = 1; } }
  else { if (a.stopped()) a.play(0x1DC, 0.38, LOOP); if (this.vel[1] < 0) n = S.BEE_FLY; }
  this.setState(n); };
END[S.BEE_TAKEOFF] = beeEnd;
// ---- bee flight (beeFly.c + ba/flap.c): each A press (below y 7500) adds a 1 s flap timer (a new one only when every running timer
// is <= 0.75 s); while n flaps run, vy is held at n*400. Pitch from stick Y (up to 80 down / 60 up), speed and terminal velocity from pitch.
const FLY_DUR = [0.38, 0.3, 0.24, 0.18, 0.14, 0.0].map(F);   // D_803649B0 (index 5 would read D_803649C4[0] = 0)
P.flapCount = function () { let c = 0; for (const t of this.flap.list) if (t !== 0) c++; return c; };           // baflap_getCount
P.flapAdd = function (d) { // baflap_add
  d = F(d); const f = this.flap; for (let i = 0; i < 5; i++) if (d - 0.25 < f.list[i]) { f.max = d; return false; }
  for (let i = 0; i < 5; i++) if (f.list[i] === 0) { f.list[i] = d; return true; } f.max = d; return false; };
P.flapReset = function () { this.flap = { list: [0, 0, 0, 0, 0], max: 0, active: false }; };
P.flapUpdate = function () { // baflap_update
  const f = this.flap; if (!f.active) return; for (let i = 0; i < 5; i++) { let t = fsub(f.list[i], this.dt); if (t < 0) t = 0; f.list[i] = t; }
  if (f.max !== 0) { const t = f.max; f.max = 0; this.flapAdd(t); } };
INIT[S.BEE_FLY] = function () {
  this._setForm('bee'); const prev = this.prevState; this.anim.play(0x1DC, 0.38, LOOP); this.setUT(1, 1, 3, PHYS.LOCKED);
  this.thv = this.beeHover ? 0 : F(600); this.setHVel(this.ideal, this.thv); this.tyaw = this.ideal;
  if (prev !== S.BEE_FLY) { // func_802A07F8
    this.yawState = 3; this.setPitchVel(500, 1.2); this.grav = F(-300); this.term = F(-99.9); this.flapReset(); this.flap.active = true; }
  if (prev !== S.BEE_TAKEOFF) { this.flapAdd(1.0); this.v.ph = 0; } else this.v.ph = 1;
};
UPDATE[S.BEE_FLY] = function () {
  let n = 0; const sx = this.stick.x, sy = this.stick.y;
  // _bsBeeFly_updateYaw (roll is cosmetic)
  let a; if (this.held('R')) { this.yawB = [F(500), F(30)]; a = 6.0; } else { this.yawB = [F(500), F(2)]; a = 3.0; }
  this.setIdeal(fadd(this.ideal, ml_map_f(sx, -1, 1, a, -a)));
  // _bsBeeFly_updatePitch
  this.pitchIdeal = mlNormalizeAngle(sy < 0 ? ml_map_f(sy, -1, 0, 300, 360) : ml_map_f(sy, 0, 1, 0, 80));
  if (this.pressed('A') && this.pos[1] < 7500.0) this.flapAdd(1.0);
  if (this.flapCount() === 0 && this.inWater) this.flapAdd(1.0);
  const cnt = this.flapCount(); this.anim.dur = FLY_DUR[cnt]; const p = this.pitch; // pitch_get (before this update's pitch step)
  switch (this.v.ph) {
    case 0: if (cnt !== 0) this.v.ph = 1; break;
    case 1: { let q = mlNormalizeAngle(fsub(this.pitchIdeal, 30)); if (80.0 < q && q < 300.0) q = F(300); this.pitchIdeal = mlNormalizeAngle(q);
      this.setPitchVel(1000, 2.2); if (cnt !== 0) this.vel[1] = F(cnt * 400.0); if (cnt === 0) { this.setPitchVel(500, 1.2); this.v.ph = 0; } break; } }
  let spd;
  if (this.beeHover) { this.term = 0; this.vel = [0, 0, 0]; spd = 0; } // BA_FLAG_9
  else if (p <= 80.0) { this.term = ml_map_f(p, 60, 80, -99.9, -1266.66); spd = ml_map_f(p, 60, 80, 600, 60); }
  else { this.term = ml_map_f(p, 300, 310, -399.99, -99.9); spd = ml_map_f(p, 300, 340, 0, 600); }
  this.tyaw = this.yaw; if (this.held('B')) spd = F(spd + spd); this.thv = spd;
  if (this.isStable() && !this.inWater) n = S.BEE_IDLE;
  this.flapUpdate(); this.setState(n);
};
END[S.BEE_FLY] = function () { // _bsbeefly_end
  if (this.nextState === S.BEE_FLY) return; this.pitchIdeal = 0; this.grav = F(-2700); this.term = F(-4000); this.flapReset(); };

const api = { FORMS, FORM_OF, ST, ANT_SET, PUMPKIN_SET, CROC_SET, WALRUS_SET, SLED_SET, BEE_SET };
M.forms = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKMOVE_FORMS = api;
})(typeof self !== 'undefined' ? self : this);
