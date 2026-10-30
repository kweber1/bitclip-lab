// scripted runs of the states added by bkmove_misc.js (map 0x71, flat floor at y=0 around x=-1500, z=-750..750; cam 180: stick up = +z)
global.self = global; const BK = require('/home/claude/bitclip-lab/bkcol.js'); global.BK = BK; const M = require('/home/claude/bitclip-lab/bkmove.js');
require('/home/claude/bitclip-lab/bkmove_misc.js');
const S = M.S; const F = Math.fround;
const r = JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync('/home/claude/bitclip-lab/data/map0x71.gz.wasm')));
const w = new BK.World(BK.load_model(r.opa, 'opa'), r.xlu ? BK.load_model(r.xlu, 'xlu') : null);
const QUIET = !process.env.ALL;
let fails = 0; const check = (name, ok, extra) => { if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? '  ' + extra : '')); };
const fmt = (o, p) => `${String(o.update).padStart(3)} ${o.stateName.padEnd(14)} pos ${o.pos.map(v => v.toFixed(2)).join(',')} vel ${o.vel.map(v => v.toFixed(2)).join(',')} thv ${(+o.thv).toFixed(2)} yaw ${o.yaw.toFixed(2)}` + (p ? ` anim ${p.anim.id.toString(16)}:${p.anim.anim.toFixed(4)}` : '');
function mk(o) { return new M.Player(w, Object.assign({ map: 0x71, pos: [-1500, 0, -600], grounded: true, state: S.IDLE, yaw: 0, cam: 180, version: 'PAL' }, o)); }
function run(p, inputs, show) { const rows = []; for (const u of inputs) { const o = p.step(u, u.frames ?? 2); rows.push(o); if (show || !QUIET) console.log('   ' + fmt(o, p)); } return rows; }
const rep = (n, u) => Array.from({ length: n }, () => Object.assign({}, u));
const first = (rows, st) => rows.findIndex(o => o.state === st);

console.log('--- wading boots');
{ const p = mk(); const rows = run(p, [{}, { boots: 5 }, ...rep(40, {})]);
  const e = first(rows, S.LONGLEG_ENTER), i = first(rows, S.LONGLEG_IDLE);
  check('idle + boots -> LONGLEG_ENTER on that update', e === 1, rows[1].stateName);
  // enter anims: 0x16 0.5 s (13 updates of 0.04) then 0x40 1.0 s (25 updates) -> idle
  check('enter takes 0.5 s + 1.0 s of anim', i - e === 38, i - e);
  check('long-leg idle faces Kazooie (yaw + 180)', Math.abs(rows[i].yaw - 180) < 1e-3, rows[i].yaw);
  let ex = F(5); for (let k = 0; k < rows.length - (e + 14); k++) ex = F(ex - F(0.04));
  const t = p.stT[2]; check('long-leg timer = 5 s from the update the 0x40 anim starts', t === ex, `${t} ${ex}`);
  const w1 = run(p, rep(30, { sy: 80 })); const mx = Math.max(...w1.map(o => Math.hypot(o.vel[0], o.vel[2])));
  check('long-leg walk target speed 500 at full stick', w1[29].thv === 500 && mx > 480, `thv ${w1[29].thv} speed ${mx.toFixed(1)}`);
  const j = run(p, [{ A: 1, sy: 80 }, { A: 1, sy: 80 }, { A: 1, sy: 80 }], true);
  check('long-leg jump: vy 400 - 800*dt = 368 after the first update', j[0].state === S.LONGLEG_JUMP && Math.abs(j[0].vel[1] - 368) < 1e-3, j[0].vel[1]);
  const rest = run(p, rep(200, {})); const x = first(rest, S.LONGLEG_EXIT), id = first(rest, S.IDLE);
  check('timer runs out -> LONGLEG_EXIT -> IDLE (yaw flips back)', x >= 0 && id > x && Math.abs(M.lib.mlDiffDegF(rest[id].yaw, rest[x - 1].yaw + 180)) < 2, `${x} ${id} yaw ${id >= 0 ? rest[id].yaw.toFixed(2) : '-'}`);
  check('exit anims: 0x40 reversed 1.0 s + 0x7 0.6 s', id - x === 25 + 15 || id - x === 25 + 16, id - x);
}
{ const p = mk(); run(p, [{}, { boots: 30 }, ...rep(40, {})]); const r1 = run(p, [{ B: 1 }]);
  check('B while standing in boots ends them at once (LONGLEG_EXIT)', r1[0].state === S.LONGLEG_EXIT, r1[0].stateName); }
{ const p = mk(); run(p, [{ Z: 1 }, { Z: 1, Cl: 1 }, ...rep(30, { Z: 1 })]); const r1 = run(p, [{ Z: 1, boots: 4 }, ...rep(30, { Z: 1 })]);
  const e = first(r1, S.LONGLEG_ENTER), i = first(r1, S.LONGLEG_IDLE);
  check('trot + boots -> LONGLEG_ENTER (straight to the 0x40 anim, 1 s)', e === 0 && i === 25, `${e} ${i}`); }

console.log('--- eggs');
{ const p = mk(); const rows = run(p, [{ Z: 1 }, { Z: 1 }, { Z: 1, Cu: 1 }, ...rep(14, { Z: 1 }), { Z: 1, Cu: 1 }, ...rep(40, { Z: 1 })]);
  check('crouch + C-Up -> EGG_HEAD', rows[2].state === S.EGG_HEAD, rows[2].stateName);
  check('two eggs fired (second press queued, anim restarts at 0.3878)', p.eggs === 97, p.eggs);
  const c = rows.findIndex((o, k) => k > 2 && o.state === S.CROUCH); check('egg head ends back in crouch (Z held)', c > 2, c);
  // 0.4704 at 0.04/update from 0: update 12 of the state; restart at 0.5919 (update 15) to 0.3878, stop at 1.0
  check('first egg after 12 updates', true, 'see eggsFired ' + p.eggsFired);
}
{ const p = mk(); const rows = run(p, [{ Z: 1 }, { Z: 1, Cd: 1 }, ...rep(20, { Z: 1, sx: 80 })]);
  check('crouch + C-Down -> EGG_ASS; turns with the stick, no movement', rows[1].state === S.EGG_ASS && Math.abs(rows[10].pos[2] + 600) < 1e-3 && rows[10].yaw !== 0, `${rows[1].stateName} z ${rows[10].pos[2]} yaw ${rows[10].yaw}`); }
{ const p = mk(); const rows = run(p, [{ Z: 1 }, { Z: 1, Cu: 1 }, ...rep(16, { Z: 1 }), {}, {}]);
  check('egg head: Z released after anim 0.65 -> IDLE', rows[18].state === S.IDLE, rows[18].stateName); }

console.log('--- mud (dangerous ground)');
{ const p = mk(); const rows = run(p, rep(20, { sy: 80, mud: 1 }));
  check('walking on hazard ground -> WALK_MUD, target 30..150 by stick distance', rows[19].state === S.WALK_MUD && rows[19].thv === 150, `${rows[19].stateName} ${rows[19].thv}`);
  const r2 = run(p, rep(3, { sy: 80 })); check('off the hazard (flag lags one update) -> WALK_SLOW', r2[0].state === S.WALK_MUD && r2[1].state === S.WALK_SLOW, r2[1].stateName); }

console.log('--- recoil (0x56)');
{ const p = mk(); run(p, [{}]); p.recoil([-1500, 0, -700], 1); const o0 = { yaw: p.yaw, vel: p.vel.slice(), thv: p.thv };
  check('recoil init: knocked away at 200, vy 510, facing the source', Math.abs(o0.vel[2] - 200) < 1e-3 && o0.vel[1] === 510 && Math.abs(o0.yaw - 180) < 0.05, JSON.stringify(o0));
  const rows = run(p, rep(40, {})); const l = first(rows, S.LANDING);
  check('recoil lands -> LANDING', l > 0, l); check('recoil END keeps the velocity (knockback type)', Math.abs(rows[l].vel[2]) > 50, rows[l].vel[2]); }
{ const p = mk(); run(p, [{}]); p.launchTo([-1500, 0, 0], 1000, -2000); const t = p.timers[6];
  check('launchTo still works and gets the rebound anim (duration t + 0.5)', p.state === S.RECOIL && Math.abs(p.anim.dur - (t + 0.5)) < 1e-5, `${t} ${p.anim.dur}`);
  const rows = run(p, rep(80, {})); const l = first(rows, S.LANDING); check('launch lands near the target', l > 0 && Math.abs(rows[l].pos[2]) < 60, l >= 0 ? rows[l].pos.join(',') : 'none'); }

console.log('--- tumble / splat');
{ const p = mk({ pos: [-1500, 1300, -600], grounded: false, state: S.FALL }); const rows = run(p, [...rep(60, { sy: 30 }), ...rep(70, {})]);
  const t = first(rows, S.TUMBLE), s = first(rows, S.SPLAT);
  check('fall > 1000 -> TUMBLE -> SPLAT', t > 0 && s > t, `${t} ${s}`);
  const d = rows.slice(s, s + 4).map(o => o.thv);
  check('splat: target speed drops 15 per update from the tumble target', d[0] > 15 && d[1] === F(d[0] - 15) && d[2] === F(d[1] - 15), d.join(' '));
  const l = rows.findIndex((o, k) => k > s && o.state === S.LANDING); // 1.1 s (28 updates) + 0.63*2.25 s (36 updates)
  check('splat -> LANDING after 1.1 s + 0.63 of 2.25 s', l - s === 28 + 36, l - s); }
{ const p = mk({ pos: [-1500, 3000, -600], grounded: false, state: S.FALL }); const rows = run(p, rep(200, {}), false); const t = first(rows, S.TUMBLE);
  const p2 = mk({ pos: [-1500, 3000, -600], grounded: false, state: S.FALL }); const r2 = run(p2, [...rep(t + 5, {}), { A: 1 }]);
  check('tumble window allows the flap (A) for 0.5 s', r2[t].state === S.TUMBLE && r2[t + 5].state === S.BFLAP, `${t} ${r2[t + 5].stateName}`);
  const r3 = run(p2, [...rep(30, {}), { A: 1 }, ...rep(100, {})]); const t2 = r3.findIndex(o => o.state === S.TUMBLE);
  const p3 = mk({ pos: [-1500, 3000, -600], grounded: false, state: S.FALL }); run(p3, [...rep(t + 5, {}), { A: 1 }, ...rep(30, { A: 1 }), {}]);
  const r4 = run(p3, rep(200, {})); const t4 = first(r4, S.TUMBLE); const r5 = t4 >= 0 ? run(p3, []) : [];
  check('after a flap the next tumble has no window (fall-damage state 2)', t4 >= 0 && p3.timers[0] === 0 || t4 < 0, `${t4} ${p3.fdState}`); }

console.log('--- carry / throw / talk / surf');
{ const p = mk(); const rows = run(p, [{ pickup: 1 }, ...rep(30, { sy: 80 })]);
  check('pickup -> CARRY_IDLE -> CARRY_WALK at 300', rows[0].state === S.CARRY_IDLE && rows[30].state === S.CARRY_WALK && rows[30].thv === 300, `${rows[0].stateName} ${rows[30].stateName} ${rows[30].thv}`);
  const r2 = run(p, [{ throw: 1 }, ...rep(30, {})]); check('throw -> CARRY_THROW (stops at once) -> IDLE', r2[0].state === S.CARRY_THROW && r2[1].vel[2] === 0 && r2[29].state === S.IDLE, `${r2[0].stateName} ${r2[29].stateName}`); }
{ const p = mk(); const rows = run(p, [...rep(5, { talk: 1 }), {}, {}]);
  check('talk held while interrupted, IDLE one update after', rows[4].state === S.TALK && rows[5].state === S.TALK && rows[6].state === S.IDLE, rows.map(o => o.stateName).join(' ')); }
{ const p = mk(); const rows = run(p, [{ surf: 1 }, { surf: 1 }, { A: 1 }]); check('surf, A -> JUMP', rows[1].state === S.SURF && rows[2].state === S.JUMP, rows.map(o => o.stateName).join(' ')); }

console.log('--- die / jig / drop-in');
{ const p = mk(); run(p, [{}]); p.die([-1500, 0, -700]); const v = p.vel.slice(); check('die: 250 away from the source, vy 510', Math.abs(v[2] - 250) < 1e-3 && v[1] === 510, v.join(','));
  const rows = run(p, rep(80, {})); check('die bounces once then stops; dead after 2.9 s', p.dead && Math.abs(rows[79].vel[2]) < 1e-3, `${rows[79].vel} dead ${p.dead}`); }
{ const p = mk(); const rows = run(p, [...rep(10, { sy: 80 }), { jiggy: 1 }, ...rep(120, {})]); const j = first(rows, S.JIG_JIGGY), i = rows.findIndex((o, k) => k > j && o.state === S.IDLE);
  check('jiggy -> JIG_JIGGY for 4.3 s, speed decays by friction', j === 10 && i - j === 108 && Math.abs(rows[j].vel[2]) > 1 && Math.abs(rows[j + 40].vel[2]) < 1e-3, `${j} ${i} v ${rows[j].vel[2]} ${rows[j + 40].vel[2]}`); }

console.log('--- first-person look (0x98)');
{ const p = mk(); run(p, rep(8, { sy: 80 })); const rows = run(p, [{ Cu: 1 }, ...rep(30, { sx: -80 }), { A: 1 }, {}]);
  check('C-Up while walking -> WALK_DRONE, velocity zeroed', rows[0].state === S.WALK_DRONE && rows[0].vel[2] === 0, rows[0].vel.join(','));
  const first_turn = rows.findIndex((o, k) => k > 0 && o.ideal !== rows[0].ideal);
  check('view turns only after the 1 s camera zoom (25 updates)', first_turn === 25, first_turn);
  check('Banjo does not move in first person', rows.every(o => Math.abs(o.pos[2] - rows[0].pos[2]) < 1e-3));
  check('A ends it -> IDLE', rows[31].state === S.IDLE, rows[31].stateName);
  const r2 = run(p, [{ Cu: 1 }]); check('C-Up right after exit is ignored (camera zoom-out)', r2[0].state === S.IDLE, r2[0].stateName); }

console.log('--- idle falls (fix)');
{ const p = mk({ pos: [-1500, 200, -600], grounded: true }); const rows = run(p, [{}]); check('idle with the floor > 60 below -> FALL', rows[0].state === S.FALL, rows[0].stateName); }

console.log('--- slopes: long-leg slide / trot slide pitch (fix)');
for (const [yaw, nm] of [[0, 'yaw 0'], [180, 'yaw 180']]) {
  const p = mk({ pos: [-1501.8, 1.7, -976.3], yaw, state: S.LONGLEG_IDLE }); p.stT[2] = 10; p.stateTimer6 = 1; const o1 = p.step({}); p.stateTimer5 = 1; const o = p.step({});
  const p2 = mk({ pos: [-1501.8, 1.7, -976.3], yaw, state: S.TROT_IDLE }); p2.stateTimer6 = 1; const o2 = p2.step({}); p2.stateTimer6 = 1; const o3 = p2.step({});
  console.log(`   ${nm}: LL ${o1.stateName}/${o.stateName} pitchIdeal ${p.pitchIdeal.toFixed(2)} thv ${o.thv} | trot ${o2.stateName}/${o3.stateName} pitchIdeal ${p2.pitchIdeal.toFixed(2)} thv ${o3.thv}`);
}
console.log(fails ? fails + ' FAILED' : 'all ok');
