// bkmove_misc.js -- more of Banjo's player states for bkmove.js, ported from the n64decomp banjo-kazooie sources:
//   wading boots (bs/bLongLeg.c 0x25-0x29, 0x55, 0x62, 0x9B), egg firing (bs/bEggHead.c 0x9, bs/bEggAss.c 0xA),
//   walking in mud / on hazard ground (bs/walk.c 0x7A, hazards.c), the real rebound/recoil state (bs/rebound.c 0x56),
//   splat (bs/splat.c 0x72), carry / throw (bs/carry.c 0x3A 0x3B, bs/throw.c 0x5B), talk (bs/talk.c 0x3C), surf (bs/surf.c 0x52),
//   die (bs/die.c 0x41), jiggy / note-door jig (bs/jig.c 0x44 0x34), sled (bs/sled.c 0x7C), the "drop in" state 0x3F (bs/jump.c),
//   rest / cutscene look-at states (bs/rest.c 0x73 0x74 0x75), first-person look (bs/dronelook.c via bs/walk.c 0x98 and 0x9B),
//   plus fixes to existing states found by auditing them against the decomp (see FIXES below).
// Requiring the module is enough: it adds the states, the C-Up / C-Down buttons (inp.Cu / inp.Cd) and the transitions.
//
// Per-update inputs added (all optional, in the same object as A/B/Z/sx/sy):
//   Cu, Cd           C-Up / C-Down held
//   boots            touching a wading-boots pickup (BA_FLAG_E_TOUCHING_WADING_BOOTS; true or the boots time in seconds, default p.bootsTime = 20)
//   mud              force "dangerous ground" (BA_FLAG_13) for the next update; otherwise it is computed per map from the floor flags (hazards.c)
//   jiggy, notedoor, trainers   BA_FLAG_7 / BA_FLAG_1A / BA_FLAG_10 (a jiggy touched / a note door opening / turbo trainers touched)
//   pickup           a carriable object touched (interrupt 7) ; carry:false drops it (bacarry marker cleared)
//   throw            the carried object asks to be thrown (interrupt 0x16)
//   talk             a talking actor holds Banjo this update (interrupt 8) ; surf: a surf/tumblar object holds Banjo (interrupt 0xD)
//   sledOff          the sled releases Banjo (interrupt 0x28)
//   lookat           true: a cutscene look-at is active (balookat_getState() != 0; enters the group's locked state), false: it ended
//   camPos           camera position [x,y,z] (for the states that face the camera: jig, 0x3F)
//   eggs             set the egg count (p.eggs, default 99)
// Object interrupts are applied after the update (they come from baMarker_update, late in the frame).
(function (root) {
'use strict';
const M = (typeof module !== 'undefined' && module.exports && typeof require !== 'undefined') ? require('./bkmove.js') : root.BKMOVE;
const L = M.lib; const { F, fadd, fsub, fmul, absf, mlNormalizeAngle, mlDiffDegF, ml_map_f, ml_interpolate_f, ml_max_f, ml_min_f, yaw_of, yaw_pitch_of,
  ONCE, LOOP, STOPPED, PHYS, S, SNAME, INIT, UPDATE, END, WATER_TO, REBOUND, DIVE_SET, SWIM_SET, P } = L;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---- state ids (enums.h)
L.addState('EGG_HEAD', 0x9); L.addState('EGG_ASS', 0xA);
L.addState('LONGLEG_ENTER', 0x25); L.addState('LONGLEG_IDLE', 0x26); L.addState('LONGLEG_WALK', 0x27); L.addState('LONGLEG_JUMP', 0x28);
L.addState('LONGLEG_EXIT', 0x29); L.addState('LONGLEG_SLIDE', 0x55); L.addState('LONGLEG_LOCKED', 0x62); L.addState('LONGLEG_DRONE', 0x9B);
L.addState('JIG_NOTEDOOR', 0x34); L.addState('CARRY_IDLE', 0x3A); L.addState('CARRY_WALK', 0x3B); L.addState('TALK', 0x3C);
L.addState('DROP_IN', 0x3F); L.addState('DIE', 0x41); L.addState('JIG_JIGGY', 0x44); L.addState('SURF', 0x52);
L.addState('RECOIL', 0x56); L.addState('CARRY_THROW', 0x5B); L.addState('REST_73', 0x73); L.addState('REST_74', 0x74); L.addState('REST_75', 0x75);
L.addState('WALK_MUD', 0x7A); L.addState('SLED', 0x7C); L.addState('WALK_DRONE', 0x98);
// 0x56 is BS_56_RECOIL = rebound_init/update/end (bs/rebound.c). bkmove.js's REBOUND launch (P.launchTo) is its type 0xE/0x10 branch:
// S.REBOUND stays an alias of S.RECOIL and launchTo keeps working (it now also gets rebound_init's animation and timer 0).

const TROT_SET = new Set([S.TROT_ENTER, S.TROT_IDLE, S.TROT_WALK, S.TROT_EXIT, S.TROT_JUMP, S.TROT_FALL, S.TROT_SLIDE]); // bsbtrot_inSet
const LL_SET = new Set([S.LONGLEG_IDLE, S.LONGLEG_WALK, S.LONGLEG_JUMP, S.LONGLEG_EXIT, S.LONGLEG_SLIDE, S.LONGLEG_DRONE, S.LONGLEG_LOCKED]); // bslongleg_inSet
const WW_SET = new Set([S.WW_ENTER, S.WW_IDLE, S.WW_WALK, S.WW_JUMP, S.WW_EXIT]);
// states whose interrupt handler is func_802B5350 (bsmethods.c): they accept pickup / talk / surf interrupts
const INTR_STATES = new Set([S.IDLE, S.WALK_SLOW, S.WALK, S.WALK_FAST, S.CROUCH, S.TROT_JUMP, S.SKID, S.TROT_ENTER, S.TROT_IDLE, S.TROT_WALK, S.TROT_EXIT,
  S.EGG_HEAD, S.EGG_ASS, S.WALK_CREEP, S.LANDING, S.LONGLEG_ENTER, S.LONGLEG_IDLE, S.LONGLEG_WALK, S.LONGLEG_EXIT, S.ROLL, S.SLIDE, S.TROT_SLIDE, S.LONGLEG_SLIDE]);
const CARRY_SET = new Set([S.CARRY_IDLE, S.CARRY_WALK]);
const ZONE_RES = new Set([0, S.IDLE, S.WALK_CREEP, S.WALK_SLOW, S.WALK, S.WALK_FAST]); // what the walk states' zone switch can give

// ---- per-player state this module keeps (lazily created)
function miscInit(p) {
  if (p._misc) return; p._misc = true;
  for (const k of ['Cu', 'Cd']) if (!p.keys[k]) p.keys[k] = [0, 1];
  p.stT = new Float32Array(8); p.stP = new Float32Array(8);  // statetimer.c stateTimerList (0 = unknown, 1 = throw, 2 = long leg, 3 = turbo)
  p.fdState = 1;               // bafalldamage_state (1 = falling from stable ground: full tumble window)
  if (p.eggs === undefined) p.eggs = 99; if (p.abil.egg === undefined) p.abil.egg = true;
  if (p.bootsTime === undefined) p.bootsTime = 20;  // the boots actor's time (chwadingboots: actor yaw), level data
  p.mud = false; p.bootsFlag = false; p.jiggyFlag = false; p.notedoorFlag = false; p.trainersFlag = false;
  p.carrying = false; p.lookat = false; p.sled = false; p.dead = false; p.fpEnter = 0; p.fpExit = 0;
}

// every state change (also the constructor's first one) sees this module's fields
const setState0 = P.setState; P.setState = function (id) { miscInit(this); return setState0.call(this, id); };
// trot end (func_802A8BB0) also resets the pitch ideal
const trotEnd0 = P.trotEnd; P.trotEnd = function () { trotEnd0.call(this); if (!TROT_SET.has(this.nextState)) this.pitchIdeal = 0; };

// ---- input: C-Up / C-Down (bakey_update)
const readInput0 = P.readInput;
P.readInput = function (inp) {
  miscInit(this); readInput0.call(this, inp);
  for (const k of ['Cu', 'Cd']) { const h = !!inp[k]; const c = this.keys[k]; c[0] = h ? c[0] + 1 : 0; c[1] = c[0] ? 0 : c[1] + 1; }
};

// ---- one update: statetimer update at the start of the frame, hazards (mud flag), camera first-person timers and object interrupts after
const step0 = P.step;
P.step = function (inp = {}, frames = 2) {
  miscInit(this);
  const dt = this.dtOf(frames);
  for (let i = 0; i < 7; i++) { this.stP[i] = this.stT[i]; if (this.stP[i] !== 0) { this.stT[i] = fsub(this.stT[i], dt); if (this.stT[i] < 0) this.stT[i] = 0; } } // stateTimer_update
  if (inp.eggs !== undefined) this.eggs = inp.eggs;
  if (inp.camPos) this.camPos = inp.camPos.map(F);
  if (inp.boots) { this.bootsFlag = true; this.llTime = F(typeof inp.boots === 'number' ? inp.boots : this.bootsTime); } // baMarker: func_802A6388(time)
  if (inp.jiggy) this.jiggyFlag = true; if (inp.notedoor) this.notedoorFlag = true; if (inp.trainers) this.trainersFlag = true;
  if (inp.carry === false) this.carrying = false;
  if (inp.lookat === false) this.lookat = false;
  const r = step0.call(this, inp, frames);
  // ncba1p (camera) first-person transition timers, updated after the player
  if (this.fpEnter > 0) this.fpEnter = ml_max_f(fsub(this.fpEnter, this.dt), 0);
  if (this.fpExit > 0) this.fpExit = ml_max_f(fsub(this.fpExit, this.dt), 0);
  this.mud = !!inp.mud || this.canTakeGroundDamage(); // hazards_update (after func_8028B71C)
  this.objInterrupts(inp);
  r.state = this.state; r.stateName = SNAME[this.state] || ('0x' + this.state.toString(16));
  return r;
};
// bafalldamage_update: state 1 whenever stable or in water (runs right after physics; the flags it reads don't change in physics)
const physics0 = P.physics;
P.physics = function () { const t = physics0.call(this); if (this.isStable() || this.inWater || SWIM_SET.has(this.state) || DIVE_SET.has(this.state)) this.fdState = 1; return t; };

// ---- helpers
// capture the state an existing UPDATE chooses, without changing state (its water check, this._wt, stays pending for our setState)
P._cap = function (fn) { let got = 0; this.setState = function (id) { got = id || 0; }; try { fn.call(this); } finally { delete this.setState; } return got; };
P.canEgg = function () { return !!this.abil.egg; };
P.canFP = function () { return this.fpExit === 0 && (this.isStable() || this.inWater); };  // can_view_first_person (camera not in its exit transition)
P.shouldLook = function () { return this.pressed('Cu') && this.canFP(); };                   // bainput_should_look_first_person_camera
P.lookState = function () { return LL_SET.has(this.state) || this.state === S.LONGLEG_ENTER ? S.LONGLEG_DRONE : S.WALK_DRONE; } // badrone_look (Banjo groups)
P.flagNext = function (n) { // func_8029CA94 (transformations, timeouts and the boggy race not modelled)
  if (this.notedoorFlag) n = S.JIG_NOTEDOOR; if (this.bootsFlag) n = S.LONGLEG_ENTER; if (this.trainersFlag) n = S.TROT_ENTER; if (this.jiggyFlag) n = S.JIG_JIGGY; return n; };
P.crouchNext = function (n) { // func_802ADCD4 (also used by the egg states)
  if (this.released('Z')) { n = S.IDLE; if (this.pressed('B')) n = S.CLAW; if (this.pressed('A')) n = this.jumpType(); }
  else {
    if (this.pressed('Cr') && this.abil.wonderwing) { if (this.feathers > 0) { this.feathers--; n = S.WW_ENTER; } }  // func_80346C10(.., GOLD_FEATHER, use 1)
    if (this.pressed('Cl')) n = S.TROT_ENTER;
    if (this.pressed('Cd') && this.canEgg() && this.eggs > 0) n = S.EGG_ASS; if (this.pressed('Cu') && this.canEgg() && this.eggs > 0) n = S.EGG_HEAD;
    if (this.pressed('A')) n = S.BFLIP; if (this.pressed('B')) n = S.BBARGE;
  }
  return n; };
P.faceCamera = function () { if (this.camPos) { const y = yaw_of([fsub(this.camPos[0], this.pos[0]), 0, fsub(this.camPos[2], this.pos[2])]); this.setIdeal(y ?? 0); } }; // func_8029B41C
P.faceTarget = function (t) { if (t) { const y = yaw_of([fsub(t[0], this.pos[0]), 0, fsub(t[2], this.pos[2])]); this.setIdeal(y ?? 0); } }; // func_80257F18(player, target)
// func_80299594(back, k): pitch ideal from the floor normal along the facing (func_8025901C), normalized like pitch_setIdeal
P.slopePitch = function (back, k) {
  const yp = yaw_pitch_of(this.floorN()); let out = 0;
  if (yp) { const s44 = fmul(yp[1], F(k)); let d = fsub(back ? mlNormalizeAngle(F(this.yaw + 180.0)) : this.yaw, yp[0]); if (d < -180) d = fadd(d, 360); if (180 <= d) d = fsub(d, 360);
    out = ml_map_f(absf(d), 0, 180, s44, F(-s44)); }
  this.pitchIdeal = mlNormalizeAngle(out); return this.pitchIdeal; };
const HZ_FLOOR = new Set([0xD, 0x12, 0x1B, 0x3C, 0x43, 0x44, 0x45, 0x46, 0x6E, 0x72, 0x8E]);
const HZ_MAPS = new Set([0xD, 0x12, 0x1B, 0x27, 0x31, 0x3C, 0x43, 0x44, 0x45, 0x46, 0x6E, 0x72, 0x7F, 0x8E]);
P.inHazard = function () { // isPlayerInHazard (hazards.c)
  const m = this.map, p = this.pos;
  if (HZ_FLOOR.has(m)) return !!(this.floorFlags() & 0xE000) && this.isStable();
  if (m === 0x31) return this.inWater && p[0] >= -9000 && p[0] <= -6820 && p[1] >= -3000 && p[1] <= -700 && p[2] >= -3850 && p[2] <= -1620;
  if (m === 0x27 || m === 0x7F) return this.inWater; return false; };
P.canTakeGroundDamage = function () { // canTakeGroundDamage (iframes not modelled)
  return HZ_MAPS.has(this.map) && this.inHazard() && this.stT[2] === 0 && !WW_SET.has(this.state) && !LL_SET.has(this.state) && !this.bootsFlag
    && this.state !== S.LONGLEG_ENTER && !DIVE_SET.has(this.state) && this.state !== S.TUMBLE && !this.dead; };
// func_802B6D00 with dangerous ground: on hazard floors the target speed is 30..150 by the stick distance
const walkTarget0 = P.walkTarget;
P.walkTarget = function () { if (this.mud) { this.thv = this.stick.zone === 0 ? 0 : ml_interpolate_f(this.stick.dist, 30, 150); return; } walkTarget0.call(this); };

// ---- object interrupts (bs_checkInterrupt from baMarker_update), applied after the update
P.objInterrupts = function (inp) {
  const s = this.state;
  if (inp.pickup) { if (CARRY_SET.has(s)) this.carrying = true; else if (INTR_STATES.has(s)) { this.carrying = true; this.setState(S.CARRY_IDLE); } }
  if (inp.throw && CARRY_SET.has(this.state) && this.stT[1] === 0) this.setState(S.CARRY_THROW);
  if (inp.talk) { if (this.state === S.TALK) this.v.stay = true; else if (INTR_STATES.has(this.state) || CARRY_SET.has(this.state)) this.setState(S.TALK); }
  if (inp.surf) { if (this.state === S.SURF) this.v.stay = true; else if (INTR_STATES.has(this.state)) this.setState(S.SURF); }
  if (inp.sledOff && this.state === S.SLED) this.sled = false;
  if (inp.lookat === true) this.lookAt(inp.lookKind || 0x74, inp.lookPos);
};
// cutscene look-at: enter the group's locked state (code_14420.c D_80364810/D_80364880/D_803648F0 tables; kind = 0x73, 0x74 or 0x75)
const REST_SET = new Set([S.REST_73, S.REST_74, S.REST_75, S.LONGLEG_LOCKED]);
P.lookAt = function (kind, pos) {
  this.lookat = true; if (pos) this.lookatPos = pos.map(F); if (REST_SET.has(this.state)) return;
  this.setState(LL_SET.has(this.state) || this.state === S.LONGLEG_ENTER ? S.LONGLEG_LOCKED : kind); };
P.lookAtEnd = function () { this.lookat = false; };
P.recoil = function (src, type) { this.hitSrc = src.map(F); this.hitType = type; this.setState(S.RECOIL); };     // a rebound interrupt (non-launch types)
P.die = function (src) { if (src) this.hitSrc = src.map(F); this.setState(S.DIE); };
P.sledStart = function () { this.sled = true; this.setState(S.SLED); };

// =====================================================================================================================
// wading boots (bs/bLongLeg.c)
P.llTarget = function () { this.thv = this.stick.zone ? ml_interpolate_f(this.stick.zp, 80, 500) : 0; }; // func_802A524C
P.llWater = function (n) { return (!this.inHazard() && this.inWater) ? S.LAND_WATER : n; };            // func_802A51D0
P.llSetup = function () { this.zones[0] = F(0.03); this.zones[1] = F(1.0); this.pitchLim = F(1000); this.pitchVel = F(12); }; // func_802A5374
P.llEnd = function () { // func_802A5404
  if (LL_SET.has(this.nextState)) return;
  this.zones = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); this.modelDir(0); this.pitchIdeal = 0; this.stT[2] = 0; this.stP[2] = 0; };
P._llEnterFromTrot = function () { this.anim.play(0x40, 1.0, ONCE); this.stT[2] = this.stP[2] = F(this.llTime ?? this.bootsTime); this.v.ph = 1; };
INIT[S.LONGLEG_ENTER] = function () {
  this.bootsFlag = false;
  if (TROT_SET.has(this.prevState)) this._llEnterFromTrot(); else { this.anim.play(0x16, 0.5, ONCE); this.v.ph = 0; }
  this.setUpdateTypes(1, 3, PHYS.NORMAL); this.thv = 0; this.llSetup(); };
UPDATE[S.LONGLEG_ENTER] = function () {
  let n = 0; this.slopePitch(1, 0.5);
  if (this.v.ph === 0) { if (this.anim.stopped()) this._llEnterFromTrot(); } else if (this.anim.stopped()) n = S.LONGLEG_IDLE;
  this.setState(n); };
END[S.LONGLEG_ENTER] = function () { this.llEnd(); };
INIT[S.LONGLEG_IDLE] = function () { this.anim.play(0x41, 1.0, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); this.thv = 0; this.modelDir(1); this.llSetup(); };
UPDATE[S.LONGLEG_IDLE] = function () {
  let n = 0; this.slopePitch(1, 0.5);
  if (this.shouldLook()) n = this.lookState(); if (this.pressed('B')) { this.stT[2] = 0; this.stP[2] = 0; }
  if (this.stick.zone > 0) n = S.LONGLEG_WALK; if (this.shouldSlideTrot()) n = S.LONGLEG_SLIDE; if (this.pressed('A') && this.isStable()) n = S.LONGLEG_JUMP;
  if (this.stT[2] === 0) n = S.LONGLEG_EXIT; this.setState(this.llWater(n)); };
END[S.LONGLEG_IDLE] = function () { this.llEnd(); };
INIT[S.LONGLEG_WALK] = function () { this.anim.play(0x42, 2, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); }; // anim duration is velocity-mapped (cosmetic)
UPDATE[S.LONGLEG_WALK] = function () {
  let n = 0; this.slopePitch(1, 0.5); this.llTarget();
  if (this.pressed('B') && this.thv === 0) { this.stT[2] = 0; this.stP[2] = 0; }
  if (!this.stick.zone && this.slowerThan(1)) n = S.LONGLEG_IDLE; if (this.shouldSlideTrot()) n = S.LONGLEG_SLIDE;
  if (this.pressed('A') && this.isStable()) n = S.LONGLEG_JUMP; if (this.stT[2] === 0) n = S.LONGLEG_EXIT; this.setState(this.llWater(n)); };
END[S.LONGLEG_WALK] = function () { this.llEnd(); };
INIT[S.LONGLEG_JUMP] = function () {
  this.v.t0 = F(0.14); this.anim.reset(); this.anim.id = 0x3D; this.anim.dur = F(1); this.anim.setStart(0.14); this.anim.setSub(0, 0.42); this.anim.type = ONCE; this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.AIRBORN); if (this.stick.dist !== 0) this.setIdeal(this.stickRel()); this.tyaw = mlNormalizeAngle(this.ideal);
  this.llTarget(); this.setHVel(this.ideal, this.thv); this.vel[1] = F(400); this.grav = F(-800); this.v.ph = 0; };
UPDATE[S.LONGLEG_JUMP] = function () {
  let n = 0; const a = this.anim; this.llTarget(); const vy = this.vel[1];
  if (this.released('A') && 0 < vy) this.grav = F(-2700);
  const h = fsub(this.pos[1], this.floorY());
  switch (this.v.ph) {
    case 0: if (vy < 100 || h < 10) a.dur = F(0.4); if (a.stopped()) { a.setSub(0, 0.5282); a.dur = F(4.5); a.type = ONCE; this.v.ph = 1; } break;
    case 1: if (0.4 < a.anim && h < 70) { this.v.t0 = a.anim; this.v.h0 = h; a.type = STOPPED; this.v.ph = 2; } break;
    case 2: a.anim = ml_map_f(h, this.v.h0, 1, this.v.t0, 0.6703); this.slopePitch(1, 0.5);
      if (this.isStable()) { a.setSub(0, 1); a.dur = F(1.3); a.type = ONCE; this.v.ph = 3; } break;
    case 3: this.slopePitch(1, 0.5); if (a.stopped()) n = S.LONGLEG_IDLE; if (this.pressed('A')) n = S.LONGLEG_JUMP; if (this.stT[2] === 0) n = S.LONGLEG_EXIT; break;
  }
  this.setState(this.llWater(n)); };
END[S.LONGLEG_JUMP] = function () { this.grav = F(-2700); this.llEnd(); };
INIT[S.LONGLEG_EXIT] = function () { this.anim.reset(); this.anim.dir = 0; this.anim.id = 0x40; this.anim.dur = F(1); this.anim.type = ONCE; this.anim.go(); this.v.ph = 0; this.yawMode = 2; this.thv = 0; };
UPDATE[S.LONGLEG_EXIT] = function () {
  let n = 0; this.slopePitch(1, 1);
  if (this.v.ph === 0) { if (this.anim.stopped()) { this.anim.play(7, 0.6, ONCE); this.v.ph = 1; } } else if (this.anim.stopped()) n = S.IDLE;
  this.setState(this.llWater(n)); };
END[S.LONGLEG_EXIT] = function () { this.llEnd(); };
INIT[S.LONGLEG_SLIDE] = function () {
  this.anim.reset(); this.anim.id = 0x3D; this.anim.type = STOPPED; this.anim.setStart(0.0865); this.anim.go();
  this.setUpdateTypes(1, 3, PHYS.LOCKED); this.tyaw = mlNormalizeAngle(this.ideal); this.setHVel(this.ideal, this.thv); this.pitchLim = F(1000); this.pitchVel = F(12);
  this.thv = 0; this.v.t = F(1); };
UPDATE[S.LONGLEG_SLIDE] = function () {
  let n = 0; this.v.t = ml_max_f(fsub(this.v.t, this.dt), 0);
  if (this.isSliding()) { const sy = yaw_of(this.floorN()) ?? 0; const pi = this.slopePitch(1, 0.5); this.thv = ml_map_f(pi, 20, 60, 550, 700); this.tyaw = sy; }
  else n = S.LONGLEG_IDLE;
  if (this.v.t === 0 && this.pressed('A')) n = S.LONGLEG_JUMP; this.setState(this.llWater(n)); };
END[S.LONGLEG_SLIDE] = function () { this.llEnd(); };
INIT[S.LONGLEG_LOCKED] = function () { this.anim.play(0x41, 1.0, LOOP); this.setUpdateTypes(1, 3, PHYS.NORMAL); this.thv = 0; this.llSetup(); this.modelDir(1); };
UPDATE[S.LONGLEG_LOCKED] = function () { let n = 0; this.slopePitch(1, 1); if (!this.lookat) n = S.LONGLEG_IDLE; this.setState(this.llWater(n)); };
END[S.LONGLEG_LOCKED] = function () { this.llEnd(); };

// =====================================================================================================================
// first-person look (bs/dronelook.c, entered with C-Up from standing / walking: badrone_look -> BS_98_WALK_DRONE, BS_9B_LONGLEG_DRONE)
// Banjo does not move: the velocity is zeroed on entry and the target speed is 0. While the camera is "idle" (its 1 s zoom-in timer,
// ncba1p, has run out) stick X turns the view by 90 deg/s and Banjo's ideal facing = view yaw + 180 (he turns at the normal rate).
// A / B / C-Up, or leaving the ground by more than 25 units, ends it; the camera then needs 1 s (zoom-out) before C-Up works again.
P._droneInit = function (anim, dur) {
  this.anim.play(anim, dur, LOOP); this.setUpdateTypes(1, 3, PHYS.NORMAL); this.thv = 0; this.vel = [0, 0, 0];
  this.fpEnter = F(1); this.v.eye = mlNormalizeAngle(F(this.yaw + 180.0)); };
P._droneUpdate = function (exit) {
  let n = 0;
  if (this.fpEnter === 0) {
    const e = fsub(this.v.eye, fmul(fmul(this.stick.x, F(90)), this.dt)); this.v.eye = mlNormalizeAngle(e); this.setIdeal(F(e + 180.0));
    let x = this.pressed('B') || this.pressed('A') || this.pressed('Cu');
    if (this.inWater) x = true; else if (!this.isAboveFloorBy(25)) x = true;
    if (x) n = exit;
  }
  return n; };
P._droneEnd = function () { this.fpExit = F(1); this.fpEnter = 0; };
INIT[S.WALK_DRONE] = function () { this._droneInit(0x19B, 4.5); };
UPDATE[S.WALK_DRONE] = function () { this.setState(this._droneUpdate(S.IDLE)); };
END[S.WALK_DRONE] = P._droneEnd;
INIT[S.LONGLEG_DRONE] = function () { this.llSetup(); this._droneInit(0x41, 1.0); };
UPDATE[S.LONGLEG_DRONE] = function () { let n = this._droneUpdate(S.LONGLEG_IDLE); if (this.stT[2] === 0) n = S.LONGLEG_EXIT; this.setState(n); };
END[S.LONGLEG_DRONE] = function () { this._droneEnd(); this.llEnd(); };

// =====================================================================================================================
// eggs (bs/bEggHead.c, bs/bEggAss.c): from crouch with C-Up (head) / C-Down (ass). Banjo stands (target speed 0, locked rotation:
// the old velocity decays along the old target yaw) and turns with the stick (bounded yaw 350/14). Pressing again queues up to 3 eggs.
function eggState(id, anim, fire, again, restart, exitAt, key) {
  INIT[id] = function () { this.anim.play(anim, 1.0, ONCE); this.setUpdateTypes(3, 1, PHYS.LOCKED); this.yawB = [F(350), F(14)]; this.thv = 0; this.v.q = 1; this.v.n = 1; };
  UPDATE[id] = function () {
    let n = 0; const a = this.anim; const hasEggs = this.eggs > 0;
    if (this.pressed(key) && this.canEgg()) { if (hasEggs) this.v.q = Math.min(this.v.q + 1, 3); }
    if (hasEggs) {
      if (a.isAt(fire)) { this.eggs--; this.eggsFired = (this.eggsFired || 0) + 1; }
      if (a.isAt(again) && this.v.n < this.v.q) { a.setStart(restart); a.go(); this.v.n++; }
    }
    if (a.stopped()) n = this.held('Z') ? S.CROUCH : S.IDLE; else if (exitAt < a.anim) n = this.crouchNext(0);
    if (this.shouldFall()) n = S.FALL; this.setState(n); };
  END[id] = function () { this.grav = F(-2700); };
}
eggState(S.EGG_HEAD, 0x2A, 0.4704, 0.5919, 0.3878, 0.65, 'Cu');
eggState(S.EGG_ASS, 0x2B, 0.3837, 0.4885, 0.349, 0.6, 'Cd');

// =====================================================================================================================
// walking on hazard ground (bs/walk.c bswalk_mud_*; BA_FLAG_13 from hazards.c)
INIT[S.WALK_MUD] = function () { this.anim.play(0xB, 0.43, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); };
UPDATE[S.WALK_MUD] = function () {
  let n = 0; this.walkTarget();
  if (!this.mud) n = S.WALK_SLOW; if (!this.stick.zone) n = S.IDLE; if (this.shouldLook()) n = this.lookState(); if (this.shouldFall()) n = S.FALL;
  if (this.held('Z')) n = S.CROUCH; if (this.pressed('B')) n = (225 < this.thv) ? S.ROLL : S.CLAW; if (this.pressed('A')) n = this.jumpType();
  if (this.isSliding()) n = S.SLIDE; n = this.flagNext(n); if (this.inWater) n = S.SWIM_IDLE; this.setState(n); };

// =====================================================================================================================
// splat (bs/splat.c): landing from a tumble. Banjo keeps sliding along the old target yaw while the target speed drops 15 per update
// (locked rotation), 1.1 s anim, then the get-up anim (2.25 s): LANDING at 0.63 of it (the landing state lets the stick/A/B cut it).
const FD_TABLE = [[7000, 8], [6000, 7], [5000, 6], [4000, 5], [3000, 4], [2000, 3], [1000, 2], [0, 1]]; // bafalldamage_lookup_table (Banjo)
INIT[S.SPLAT] = function () {
  this.anim.play(0x149, 1.1, ONCE); this.setUpdateTypes(1, 3, PHYS.LOCKED); this.v.ph = 0;
  let dmg = 0; for (const [h, d] of FD_TABLE) if (h + 1000 < this.fallHeight) { dmg = d; break; }
  this.lastFallDamage = dmg;
  if (this.health !== undefined) { this.health = Math.max(0, this.health - dmg); if (this.health === 0) this.setState(S.DIE); } };
UPDATE[S.SPLAT] = function () {
  let n = 0; const a = this.anim; this.thv = ml_max_f(0, fsub(this.thv, 15));
  if (this.v.ph === 0) { if (this.shouldFall()) n = S.FALL; if (a.stopped()) { a.play(0xD2, 2.25, ONCE); this.v.ph = 1; } }
  else { if (a.isAt(0.63)) n = S.LANDING; if (a.stopped()) n = S.IDLE; if (this.shouldFall()) n = S.FALL; }
  if (!this.isStable() && this.inWater) n = S.SWIM_IDLE; this.setState(n); };
END[S.SPLAT] = undefined;

// =====================================================================================================================
// rebound / recoil (bs/rebound.c, BS_56_RECOIL). Knockback types use func_802B360C's non-launch branch (same as OW's knockback);
// the launch types (0xE / 0x10) are P.launchTo. Ends: stable -> LANDING; tumbling (knockback only) -> TUMBLE; anim done in the air -> FALL.
P._reboundAnim = function (dur) { const a = this.anim; a.reset(); a.setSub(0, 0.5823); a.id = 0xF; a.dur = F(dur); a.type = ONCE; a.go(); this.setTimer(0, 1.5); };
INIT[S.RECOIL] = function () { this._knockback(); this.v.mode = 0; this._reboundAnim(1.4); };
const launchTo0 = P.launchTo;
P.launchTo = function (target, vy, grav) { launchTo0.call(this, target, vy, grav); this.v = { mode: 1 }; this._reboundAnim(F(this.timers[6] + 0.5)); };
UPDATE[S.RECOIL] = function () {
  let n = 0; this.decTimer(0);
  if (this.v.mode === 1) { if (this.decTimer(6)) { this.vel[0] = 0; this.vel[2] = 0; this.thv = 0; } } else if (this.v.rb && this.v.rb[0] === 2) this.walkTarget(); // func_802B37DC
  if (this.isStable()) n = S.LANDING;
  if (this.fallHeight > 1000 && !this.isStable() && this.v.mode === 0) n = S.TUMBLE;
  if (this.anim.stopped() && this.shouldFall() && this.v.mode === 0) n = S.FALL;
  this.setState(n); };
END[S.RECOIL] = function () { if (this.v.mode === 1) this.vel = [0, 0, 0]; this.grav = F(-2700); };

// =====================================================================================================================
// carrying (bs/carry.c, bs/throw.c): no jump, no fall check (walking off a ledge keeps CARRY_WALK)
INIT[S.CARRY_IDLE] = function () { this.anim.play(0x72, 1.2, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); this.thv = 0; this.pitchLim = F(1000); this.pitchVel = F(12); };
UPDATE[S.CARRY_IDLE] = function () { let n = 0; if (this.stick.zone > 0) n = S.CARRY_WALK; if (!this.carrying) n = S.IDLE; this.setState(n); };
const carryEnd = function () { if (!CARRY_SET.has(this.nextState)) this.zones = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); };
END[S.CARRY_IDLE] = carryEnd;
INIT[S.CARRY_WALK] = function () { this.anim.play(0x73, 0.8, LOOP); this.setUpdateTypes(1, 1, PHYS.NORMAL); };
UPDATE[S.CARRY_WALK] = function () {
  let n = 0; this.thv = this.stick.zone ? ml_interpolate_f(this.stick.zp, 30, 300) : 0; // func_802AAE80
  if (this.stick.zone === 0 && this.slowerThan(1)) n = S.CARRY_IDLE; if (!this.carrying) n = S.IDLE; this.setState(n); };
END[S.CARRY_WALK] = carryEnd;
INIT[S.CARRY_THROW] = function () { this.anim.play(0x11B, 1.0, ONCE); this.yawState = 1; this.yawMode = 3; this.ptype = PHYS.LOCKED; this.thv = 0; this.vel = [0, 0, 0]; };
UPDATE[S.CARRY_THROW] = function () {
  let n = 0; this.faceTarget(this.throwTarget); if (this.anim.isAt(0.35) && this.carrying) this.carrying = false; // the object leaves Banjo
  if (this.anim.stopped()) n = S.IDLE; this.setState(n); };
END[S.CARRY_THROW] = function () { if (this.nextState === S.IDLE) { this.stT[0] = this.stP[0] = F(0.14); this.stT[1] = this.stP[1] = F(0.28); } };

// talking (bs/talk.c) and surfing (bs/surf.c): Banjo stands (NORMAL physics, target speed 0, no stick yaw) while the object keeps
// sending its interrupt every update; one update without it -> IDLE. Surf: A -> JUMP.
INIT[S.TALK] = function () { this.anim.play(0x6F, 5.5, LOOP); this.faceTarget(this.talkTarget); this.yawState = 1; this.yawMode = 3; this.ptype = PHYS.NORMAL; this.thv = 0; this.v.stay = true; };
UPDATE[S.TALK] = function () { let n = 0; if (!this.v.stay) n = S.IDLE; this.v.stay = false; this.setState(n); };
INIT[S.SURF] = function () { this.anim.play(0x69, 1.8, LOOP); this.setUpdateTypes(1, 3, PHYS.NORMAL); this.thv = 0; this.v.stay = true; };
UPDATE[S.SURF] = function () { let n = 0; if (this.pressed('A')) n = S.JUMP; if (!this.v.stay) n = S.IDLE; this.v.stay = false; this.setState(n); };

// =====================================================================================================================
// dying (bs/die.c): knocked away from the hazard (this.hitSrc) at 250 u/s, vy 510, gravity -1400; bounces once (vy 400) on landing,
// then slows by 12 per update. Timer 0 (2.9 s) ends the game (this.dead). Swim-die (0x54) not ported.
INIT[S.DIE] = function () {
  this.anim.reset(); this.anim.id = 9; this.anim.setSub(0, 0.3356); this.anim.dur = F(2); this.anim.type = ONCE; this.anim.go();
  const src = this.hitSrc || this.pos; const yw = yaw_of([fsub(this.pos[0], src[0]), 0, fsub(this.pos[2], src[2])]) ?? 0;
  this.v.spd = F(250); this.setIdeal(F(yw + 180.0)); this.yaw = this.ideal; this.thv = this.v.spd; this.tyaw = yw; this.setHVel(yw, this.thv);
  this.yawState = 1; this.yawMode = 2; this.ptype = PHYS.LOCKED; this.vel[1] = F(510); this.grav = F(-1400); this.setTimer(0, 2.9); this.v.ph = 0; };
UPDATE[S.DIE] = function () {
  const a = this.anim; this.thv = this.v.spd;
  switch (this.v.ph) {
    case 0: if (this.isStable()) { a.setSub(0, 1); a.type = ONCE; this.vel[1] = F(400); this.v.ph = 1; } break;
    case 1: if (this.isStable()) this.v.ph = 2; break;
    case 2: this.v.spd = ml_max_f(fsub(this.v.spd, 12), 0); if (a.isAt(0.6538)) a.dur = F(4); if (a.stopped()) { this.v.spd = 0; this.v.ph = 3; } break;
  }
  if (this.decTimer(0)) this.dead = true; this.setState(0); };
END[S.DIE] = function () { this.grav = F(-2700); this.pitchIdeal = 0; };

// jigs (bs/jig.c): Banjo faces the camera (needs inp.camPos; without it the facing is unchanged), NORMAL physics with target speed 0:
// any speed he had decays by floor friction. He is not held in place, gravity applies, and there is no fall / water exit.
INIT[S.JIG_JIGGY] = function () { this.anim.play(0x2E, 4.3, ONCE); this.faceCamera(); this.setUpdateTypes(1, 3, PHYS.NORMAL); this.thv = 0; this.jiggyFlag = false; this.v.nd = this.jiggies === 9; };
UPDATE[S.JIG_JIGGY] = function () { let n = 0; this.faceCamera(); if (this.anim.stopped()) n = this.v.nd ? S.JIG_NOTEDOOR : S.IDLE; this.setState(n); };
INIT[S.JIG_NOTEDOOR] = function () { this.notedoorFlag = false; this.anim.play(0x282, 3.6, ONCE); this.faceCamera(); this.setUpdateTypes(1, 3, PHYS.NORMAL); this.thv = 0; };
UPDATE[S.JIG_NOTEDOOR] = function () { this.setState(this.anim.stopped() ? S.IDLE : 0); };

// sled (bs/sled.c): BA_PHYSICS_FREEZE (no movement from physics: the sled object positions Banjo), collision mode 6; sled released -> FALL
INIT[S.SLED] = function () { this.anim.play(0x228, 1.8, LOOP); this.setUpdateTypes(1, 3, PHYS.NONE); this.thv = 0; this.colMode = 6; this.sled = true; };
UPDATE[S.SLED] = function () { this.setState(this.sled ? 0 : S.FALL); };
END[S.SLED] = function () { this.colMode = 1; this.sled = false; this.pitchIdeal = 0; };

// 0x3F (bs/jump.c func_802B1BF4): dropped in (velocity 0, airborne, target speed 0, faces the camera); stable -> IDLE
INIT[S.DROP_IN] = function () {
  this.anim.play(8, 1.9, STOPPED, 0.6667); this.faceCamera(); this.yawState = 1; this.yawMode = 3; this.ptype = PHYS.AIRBORN; this.thv = 0; this.vel = [0, 0, 0]; this.v.ph = 0; };
UPDATE[S.DROP_IN] = function () {
  let n = 0; if (this.v.ph === 0 && this.isAboveFloorBy(90)) { this.anim.setSub(0, 1); this.anim.dur = F(2); this.anim.type = ONCE; this.v.ph = 1; }
  if (this.isStable()) n = S.IDLE; this.setState(n); };

// rest / cutscene look-at (bs/rest.c): NORMAL physics, target speed 0, faces the look-at position; held until the look-at ends.
// 0x73 / 0x75 use the "listen" anim: on the end Banjo plays the 0.5 s turn-back anim before IDLE; 0x74 (stand anim) ends at once.
P._restAnim = function (listen) {
  if (listen) { if (this.anim.id === 0x14A) this.anim.play(0x14A, 11.4, LOOP); else if (this.anim.id === 0x167) { this.anim.reset(); this.anim.id = 0x167; this.anim.dur = F(0.4); this.anim.type = ONCE; this.anim.go(); } else this.anim.play(0x167, 0.5, ONCE); }
  else this.anim.play(0x6F, 5.5, LOOP);
  this.setUpdateTypes(1, 3, PHYS.NORMAL); this.thv = 0; if (this.lookat) this.faceTarget(this.lookatPos); };
P._restDone = function () { // func_802B3BB0
  const a = this.anim; if (this.lookat) this.faceTarget(this.lookatPos); let done = false;
  if (a.id === 0x167) { if (a.stopped()) { if (a.dir) a.play(0x14A, 11.4, LOOP); else if (!this.lookat) done = true; } }
  else if (a.id === 0x14A) { if (!this.lookat) { a.reset(); a.dir = 0; a.id = 0x167; a.setStart(1.0); a.dur = F(0.5); a.type = ONCE; a.go(); } }
  else if (!this.lookat) done = true;
  return done; };
for (const [id, listen] of [[S.REST_73, true], [S.REST_74, false], [S.REST_75, true]]) {
  INIT[id] = function () { this._restAnim(listen); };
  UPDATE[id] = function () { let n = 0; if (this.inWater) n = S.SWIM_IDLE; /* BS_77_SWIM_LOOKAT_DRONE not ported */ if (this._restDone()) n = S.IDLE; this.setState(n); };
}

// =====================================================================================================================
// transitions into the new states from existing states, and FIXES to existing states (audit against the decomp)
const up = {}; for (const id of [S.SLIDE, S.IDLE, S.LANDING, S.WALK_CREEP, S.WALK_SLOW, S.WALK, S.WALK_FAST, S.CROUCH, S.ROLL, S.FALL, S.BFLAP, S.TROT_IDLE, S.TROT_WALK]) up[id] = UPDATE[id];
// standing (bsstand_update / func_802B488C): first-person look (after A, before slide), func_8029CA94 flags, then water;
// FIX: idle's player_shouldFall check (overrides everything, also water) was missing
UPDATE[S.IDLE] = function () {
  let n = this._cap(up[S.IDLE]); if (this.shouldLook() && n !== S.SLIDE) n = this.lookState(); n = this.flagNext(n);
  if (this.shouldFall()) { n = S.FALL; this._wt = null; } this.setState(n); };
UPDATE[S.LANDING] = function () { let n = this._cap(up[S.LANDING]); if (this.shouldLook() && n !== S.SLIDE) n = this.lookState(); this.setState(this.flagNext(n)); };
// walking (bs/walk.c): mud after the zone switch, look after skid (inside the zone switch for walk-fast), flags before water
for (const id of [S.WALK_CREEP, S.WALK_SLOW, S.WALK]) UPDATE[id] = function () {
  let n = this._cap(up[id]); if (this.mud && ZONE_RES.has(n)) n = S.WALK_MUD;
  if (this.shouldLook() && (ZONE_RES.has(n) || n === S.WALK_MUD || n === S.SKID)) n = this.lookState(); this.setState(this.flagNext(n)); };
UPDATE[S.WALK_FAST] = function () {
  let n = this._cap(up[S.WALK_FAST]); if (this.stick.zone !== 4 && this.shouldLook() && ZONE_RES.has(n)) n = this.lookState();
  if (this.mud && (ZONE_RES.has(n) || n === S.WALK_DRONE)) n = S.WALK_MUD; this.setState(this.flagNext(n)); };
// crouch (func_802ADCD4): eggs (C-Down, then C-Up) after trot and before flip / barge; FIX: wonderwing uses up a gold feather on entry
UPDATE[S.CROUCH] = function () {
  const wwFeather = !this.released('Z') && this.pressed('Cr') && this.abil.wonderwing && this.feathers > 0;
  let n = this._cap(up[S.CROUCH]); if (wwFeather) this.feathers--;
  if (n === S.WW_ENTER && this.pressed('Cl')) n = S.TROT_ENTER; // FIX: trot is checked after wonderwing
  if (!this.released('Z') && n !== S.BFLIP && n !== S.BBARGE) {
    if (this.pressed('Cd') && this.canEgg() && this.eggs > 0) n = S.EGG_ASS; if (this.pressed('Cu') && this.canEgg() && this.eggs > 0) n = S.EGG_HEAD; }
  this.setState(n); };
const crouchInit0 = INIT[S.CROUCH];
INIT[S.CROUCH] = function () { crouchInit0.call(this); if (this.prevState === S.EGG_HEAD || this.prevState === S.EGG_ASS || this.prevState === S.WW_ENTER) { this.anim.setStart(0.5357); this.anim.go(); } };
// roll / twirl (bs/twirl.c): func_8029CA94 comes after its water check, so the flags override water
UPDATE[S.ROLL] = function () { let n = this._cap(up[S.ROLL]); const f = this.flagNext(0); if (f) { n = f; this._wt = null; } this.setState(n); };
// trot stand / walk (bs/bTrot.c): func_8029CA94 last (turbo trainers, boots, jiggy, note door)
for (const id of [S.TROT_IDLE, S.TROT_WALK]) UPDATE[id] = function () { let n = this._cap(up[id]); const f = this.flagNext(0); if (f) { n = f; this._wt = null; } this.setState(n); };
const trotEnterInit0 = INIT[S.TROT_ENTER]; INIT[S.TROT_ENTER] = function () { this.trainersFlag = false; trotEnterInit0.call(this); };
// flip landing (func_8029C9C0): first-person look after the barge check, before slide
const afterLand0 = P._afterLand;
P._afterLand = function (n) { n = afterLand0.call(this, n); if (!this.isSliding() && this.shouldLook()) n = this.lookState(); return n; };
// FIX slide (bsslide_update): the jump (A after 1 s) is checked after water, so it wins over LAND_WATER
UPDATE[S.SLIDE] = function () { const n = this._cap(up[S.SLIDE]); if (this.v.t === 0 && this.pressed('A')) this._wt = null; this.setState(n); };
// FIX fall (bsjump_fall_update): stable (LANDING) is checked after water, so it wins over LAND_WATER
UPDATE[S.FALL] = function () { const n = this._cap(up[S.FALL]); if (n === S.LANDING) this._wt = null; this.setState(n); };
// FIX fall init: touching a jiggy caps the upward speed at 700
const fallInit0 = INIT[S.FALL]; INIT[S.FALL] = function () { if (this.jiggyFlag && 700 < this.vel[1]) this.vel[1] = F(700); fallInit0.call(this); };
// FIX tumble (bsjump_tumble_*): the 0.5 s window also allows flap (A) and peck (B), not only the beak buster, and it is only open
// when the fall started from the ground (bafalldamage state 1); leaving it into buster / flap / peck restarts the fall height.
// Water (LAND_WATER) is checked before stable (SPLAT wins).
delete WATER_TO[S.TUMBLE];
INIT[S.TUMBLE] = function () {
  this.anim.play(0x68, 0.35, LOOP); this.setUpdateTypes(1, 3, PHYS.AIRBORN);
  if (this.fdState === 1) { this.setTimer(0, 0.5); this.setTimer(1, 0.41); } else { this.setTimer(0, 0); this.setTimer(1, 0.01); } };
UPDATE[S.TUMBLE] = function () {
  let n = 0; this.decTimer(1); this.decTimer(0); this.walkTarget();
  if (this.timers[0] !== 0) { if (this.pressed('A') && this.canFlap()) n = S.BFLAP; if (this.pressed('B') && this.canPeck()) n = S.BPECK; if (this.pressed('Z') && this.abil.buster) n = S.BBUSTER; }
  if (this.inWater) n = S.LAND_WATER; if (this.isStable()) n = S.SPLAT; this.setState(n); };
END[S.TUMBLE] = function () { if (this.nextState === S.BBUSTER || this.nextState === S.BFLAP || this.nextState === S.BPECK) { this.fdState = 3; this.fallStart = this.pos.slice(); } };
// FIX peck init: a peck after leaving the ground restarts the fall height (bafalldamage_set_state(2))
const peckInit0 = INIT[S.BPECK]; INIT[S.BPECK] = function () { if (this.fdState === 1) { this.fdState = 2; this.fallStart = this.pos.slice(); } peckInit0.call(this); };
// flap: releasing A sets the fall-damage state 2 (closes the tumble window of a later tumble)
UPDATE[S.BFLAP] = function () { const ph = this.v.ph; const n = this._cap(up[S.BFLAP]); if (ph !== 4 && this.v.ph === 4) { this.fdState = 2; this.fallStart = this.pos.slice(); } this.setState(n); };
// FIX trot slide (bsbtrot_slide_update): pitch_setIdeal normalizes the slope pitch (facing uphill gives ~340-360 -> 700, not 550),
// the target yaw is 0 when the floor is flat, water goes to SWIM_IDLE (not LAND_WATER) and A (stable) is checked after water.
delete WATER_TO[S.TROT_SLIDE];
UPDATE[S.TROT_SLIDE] = function () {
  let n = 0; this.v.t = ml_max_f(fsub(this.v.t, this.dt), 0);
  if (this.shouldSlideTrot()) { const sy = yaw_of(this.floorN()) ?? 0; const pi = this.slopePitch(1, 1); this.thv = ml_map_f(pi, 20, 60, 550, 700); this.tyaw = sy; }
  else n = S.TROT_IDLE;
  if (this.inWater) n = S.SWIM_IDLE; if (this.v.t === 0 && this.pressed('A') && this.isStable()) n = S.TROT_JUMP; this.setState(n); };

const api = { TROT_SET, LL_SET, INTR_STATES, FD_TABLE };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKMOVE_MISC = api;
})(typeof self !== 'undefined' ? self : this);
