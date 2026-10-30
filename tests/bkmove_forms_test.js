// tests/bkmove_forms_test.js -- run the transformation states (bkmove_forms.js) on a flat floor in Mumbo's Mountain (map 0x02,
// the big flat top at y 2155) and print per-update state / position / velocity, plus walk speeds and jump heights per form.
//   node tests/bkmove_forms_test.js            summary + key checks
//   node tests/bkmove_forms_test.js -v         also every update
global.self = global; const BK = require('/home/claude/bitclip-lab/bkcol.js'); global.BK = BK;
const M = require('/home/claude/bitclip-lab/bkmove.js'); require('/home/claude/bitclip-lab/bkmove_forms.js');
const L = M.lib, S = M.S, F = Math.fround;
const VERB = process.argv.includes('-v');
const load = (m) => { const r = JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync('/home/claude/bitclip-lab/data/map' + m + '.gz.wasm')));
  return new BK.World(BK.load_model(r.opa, 'opa'), r.xlu ? BK.load_model(r.xlu, 'xlu') : null); };
const W = load('0x02'); const START = [3397, 2155, -2650];
let fails = 0; const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? '  ok   ' : '  FAIL ') + msg); };
const fmt = (r, p) => `${String(r.update).padStart(3)} ${r.stateName.padEnd(18)} pos ${r.pos.map(v => v.toFixed(2).padStart(9)).join(' ')}  vel ${r.vel.map(v => v.toFixed(2).padStart(8)).join(' ')}  thv ${(+r.thv).toFixed(1).padStart(6)} g${r.grounded} col ${p.colH}/${p.colR} anim ${r.an}`;
function sim(start, inputs, opts = {}) {
  const p = new M.Player(W, Object.assign({ map: 2, pos: START, grounded: true, yaw: 0, cam: 0 }, start)); const rows = [];
  if (opts.before) opts.before(p);
  for (const u of inputs) { if (u.fn) { u.fn(p); continue; } const r = p.step(u, u.frames ?? 2); r.an = `${p.anim.id.toString(16)}@${p.anim.anim.toFixed(3)} d${p.anim.dur.toFixed(3)}`; rows.push(r); if (VERB) console.log(fmt(r, p)); }
  return [rows, p];
}
const rep = (n, u) => Array.from({ length: n }, () => Object.assign({}, u));
const hv = (r) => Math.hypot(r.vel[0], r.vel[2]);
const FORMS = { ant: 'ANT', pumpkin: 'PUMPKIN', croc: 'CROC', walrus: 'WALRUS', bee: 'BEE' };
const WALK_MAX = { ant: 500, pumpkin: 500, croc: 375, walrus: 400, bee: 375 };
const summary = [];
for (const f in FORMS) {
  const P = FORMS[f];
  console.log(`\n==== ${f}`);
  // idle -> walk (full stick) -> release -> idle
  if (VERB) console.log('-- walk');
  let [rows, p] = sim({ state: S[P + '_IDLE'] }, [...rep(3, {}), ...rep(40, { sy: 80 }), ...rep(25, {})]);
  check(p.form === f, `form = ${p.form}`); check(p.colH === F(50) && p.colR === F(25), `collision height/radius 50/25 (${p.colH}/${p.colR})`);
  const walkMax = Math.max(...rows.map(hv)); const st = new Set(rows.map(r => r.stateName));
  check(st.has(P + '_WALK') && rows[rows.length - 1].stateName === P + '_IDLE', `idle -> walk -> idle (${[...st].join(',')})`);
  check(Math.abs(walkMax - WALK_MAX[f]) < 1, `top walk speed ${walkMax.toFixed(2)} (target ${WALK_MAX[f]})`);
  // anim type 2: walk anim duration follows speed
  const wr = sim({ state: S[P + '_IDLE'] }, [...rep(3, {}), ...rep(40, { sy: 80 })])[1];
  console.log(`  walk anim duration at top speed: ${wr.anim.dur.toFixed(4)} (BAANIM_UPDATE_2_SCALE_HORZ)`);
  // jump (A held) from standing with full stick
  if (VERB) console.log('-- jump (A held)');
  [rows, p] = sim({ state: S[P + '_IDLE'] }, [...rep(2, {}), { A: 1, sy: 80 }, ...rep(60, { A: 1, sy: 80 }), ...rep(15, {})]);
  const j0 = rows.findIndex(r => r.stateName === P + '_JUMP'); const y0 = START[1];
  const peak = Math.max(...rows.map(r => r.pos[1])) - y0; const land = rows.findIndex((r, i) => i > j0 + 1 && r.grounded);
  const jv = rows[j0].vel[1];
  console.log(`  jump: first update vy ${jv.toFixed(2)}, peak +${peak.toFixed(2)}, airborne ${land - j0} updates, states ${[...new Set(rows.slice(j0).map(r => r.stateName))].join(' > ')}`);
  // short hop: A released at once
  [rows, p] = sim({ state: S[P + '_IDLE'] }, [...rep(2, {}), { A: 1 }, ...rep(60, {})]);
  const hop = Math.max(...rows.map(r => r.pos[1])) - y0;
  console.log(`  short hop (A tapped): peak +${hop.toFixed(2)}`);
  // fall from 400 up
  if (VERB) console.log('-- fall');
  [rows, p] = sim({ state: S[P + '_FALL'], pos: [START[0], START[1] + 400, START[2]], grounded: false, vel: [0, 0, 0] }, rep(40, {}));
  const fl = rows.findIndex(r => r.grounded);
  check(rows[rows.length - 1].stateName === P + '_IDLE', `fall 400 -> lands at update ${fl + 1}, ends ${rows[rows.length - 1].stateName}`);
  // hit from the front
  [rows, p] = sim({ state: S[P + '_IDLE'] }, [...rep(2, {}), { fn: (q) => q.hit([q.pos[0], q.pos[1], q.pos[2] + 50], 1) }, ...rep(40, {})]);
  const ow = rows.slice(2); console.log(`  hit: ${ow[0].stateName} vel0 ${ow[0].vel.map(v => v.toFixed(1)).join(',')} peak +${(Math.max(...ow.map(r => r.pos[1])) - y0).toFixed(2)} -> ${rows[rows.length - 1].stateName}`);
  summary.push({ form: f, walk: walkMax.toFixed(1), jumpVy: jv.toFixed(1), jumpPeak: peak.toFixed(1), hopPeak: hop.toFixed(1), air: land - j0 });
}

// ---- specials
console.log('\n==== croc bite (B from idle)');
{ const [rows, p] = sim({ state: S.CROC_IDLE }, [...rep(2, {}), { B: 1 }, ...rep(30, {})]);
  const b = rows.filter(r => r.stateName === 'CROC_BITE'); console.log(`  bite updates ${b.length}, first vel ${b[0].vel.map(v => v.toFixed(1)).join(',')}, distance ${(Math.hypot(rows[rows.length - 1].pos[0] - START[0], rows[rows.length - 1].pos[2] - START[2])).toFixed(1)}, then ${[...new Set(rows.slice(rows.indexOf(b[0])).map(r => r.stateName))].join(' > ')}`);
  if (!VERB) rows.slice(2, 16).forEach(r => console.log('   ' + fmt(r, p))); }
console.log('\n==== croc turbo trainers (turbo = 5 s): top speed');
{ const [rows] = sim({ state: S.CROC_IDLE }, [{ fn: (q) => { q.turbo = 5; } }, ...rep(40, { sy: 80 })]); console.log(`  ${Math.max(...rows.map(hv)).toFixed(2)} (500)`); }
console.log('\n==== bee: jump, then A in the air -> flight, mash A');
{ const inp = [...rep(2, {}), { A: 1 }, ...rep(8, { A: 1 }), {}, { A: 1 }]; for (let i = 0; i < 60; i++) inp.push(i % 8 === 0 ? { A: 1, sy: 0 } : {});
  inp.push(...rep(80, { sy: 80 }));
  const [rows, p] = sim({ state: S.BEE_IDLE }, inp); const fi = rows.findIndex(r => r.stateName === 'BEE_FLY');
  console.log(`  flight from update ${fi + 1}; vy there ${rows[fi].vel[1].toFixed(1)}; max height +${(Math.max(...rows.map(r => r.pos[1])) - START[1]).toFixed(1)}; end ${rows[rows.length - 1].stateName} pitch ${p.pitch.toFixed(2)}`);
  if (!VERB) rows.slice(fi - 1, fi + 14).forEach(r => console.log('   ' + fmt(r, p)));
  const dive = rows.slice(-30); console.log(`  nose down (stick up): speed ${hv(dive[dive.length - 1]).toFixed(1)}, vy ${dive[dive.length - 1].vel[1].toFixed(1)}, term ${p.term.toFixed(2)}`); }
console.log('\n==== walrus sled (start in WALRUS_SLED), push forward; A -> sled jump');
{ const [rows, p] = sim({ state: S.WALRUS_SLED }, [...rep(40, { sy: 80 }), { A: 1, sy: 80 }, ...rep(40, { A: 1, sy: 80 })]);
  console.log(`  top speed ${Math.max(...rows.slice(0, 40).map(hv)).toFixed(2)} (700 flat), states ${[...new Set(rows.map(r => r.stateName))].join(' > ')}, sled jump peak +${(Math.max(...rows.map(r => r.pos[1])) - START[1]).toFixed(1)}`); }
console.log('\n==== pumpkin flush');
{ const [rows, p] = sim({ state: S.PUMPKIN_IDLE }, [{ fn: (q) => q.setState(S.PUMPKIN_FLUSH) }, ...rep(60, {})]);
  const r = rows[rows.length - 1]; console.log(`  after 60 updates: y ${(r.pos[1] - START[1]).toFixed(2)} (-50), yaw ${r.yaw.toFixed(1)}`); }
console.log('\n==== transform: banjo -> ant -> banjo');
{ const [rows, p] = sim({ state: S.IDLE }, [{}, { fn: (q) => q.transform('ant') }, {}, {}, { fn: (q) => q.transform('banjo') }, {}]);
  console.log(`  states ${rows.map(r => r.stateName).join(' ')}; form ${p.form}, col ${p.colH}/${p.colR}`); check(p.colH === F(80) && p.state === S.IDLE, 'back to Banjo 80/35 idle'); }
console.log('\n==== ant: col size across idle -> bounce -> idle (0x9F is outside bsant_inSet: 80/35 during the bounce)');
{ const [rows, p] = sim({ state: S.ANT_IDLE }, [{}, { fn: (q) => { q.bounce([q.pos[0], q.pos[1], q.pos[2] + 50], 1); console.log(`  in bounce: col ${q.colH}/${q.colR}`); } }, ...rep(40, {})]);
  console.log(`  after: ${rows[rows.length - 1].stateName} col ${p.colH}/${p.colR}`); }

// ---- hand checks against the decomp
console.log('\n==== hand checks');
{ // ant jump first update (PAL dt 0.04): vy = 693.5 + 0.04 * -1200 = 645.5 (f32); hvel at full stick: thv = 500 (zone 4 zp 1)
  const [rows] = sim({ state: S.ANT_IDLE }, [{}, { A: 1, sy: 80 }]); const r = rows[1];
  const vy = F(F(693.5) + F(F(0.04) * F(-1200))); check(r.vel[1] === vy, `ant jump vy after 1 update ${r.vel[1]} == ${vy}`);
  check(Math.abs(hv(r) - 500) < 0.01, `ant jump horizontal speed ${hv(r).toFixed(3)} == 500`);
  // the ant jump anim starts at 0.2987 and stops at 0.4423 after (0.4423-0.2987)*1.0 s = 0.1436 s = 4 updates
  const [r2, p2] = sim({ state: S.ANT_IDLE }, [{}, { A: 1 }, ...rep(4, { A: 1 })]); check(p2.anim.dur === F(5), `ant jump: anim stopped after 4 updates -> duration 5 (${p2.anim.dur})`);
}
{ // croc bite lunge: 500 along the facing, 200 up (yaw 0 -> +z)
  const [rows, p] = sim({ state: S.CROC_IDLE }, [{}, { B: 1 }]); const r = rows[1];
  console.log(`  croc bite after 1 update vel ${r.vel.map(v => v.toFixed(3)).join(',')} (500 forward, 200 + 0.04*-2700 up, then friction toward 0)`); }
{ // bee flight enter: 600 forward, one flap -> vy 400 on the next update
  const [rows, p] = sim({ state: S.BEE_JUMP, grounded: false, pos: [START[0], START[1] + 300, START[2]], vel: [0, 0, 0] }, [{}, { A: 1 }, {}, {}]);
  console.log(`  bee fly: ${rows.map(r => r.stateName + ' vy ' + r.vel[1].toFixed(2) + ' h ' + hv(r).toFixed(1)).join(' | ')}`);
  check(rows[3].vel[1] === F(F(400) + F(F(0.04) * F(-300))), 'bee fly: 2nd flight update holds vy = 1 flap * 400 (then gravity -300 -> 388)'); }
{ // walrus ice: friction 0.15 on floor type 4 instead of 0.05 (FP is map 0x27; here just check the override value is used)
  const p = new M.Player(W, { map: 2, pos: START, grounded: true, state: S.WALRUS_IDLE }); p.floorType = 4; const f0 = L.FRICTION[4];
  let seen; const ph = M.lib.P.physics; check(p.walrusIce === 0.15 && f0 === F(0.05), `walrus ice override 0.15 set (table value ${f0})`); }

console.log('\n==== water (MM pool at x 1111 z 3194: surface -200, floor ~-830)');
for (const f of ['ant', 'walrus', 'bee']) {
  const [rows, p] = sim({ state: M.S[FORMS[f] + '_FALL'], pos: [1111, -100, 3194], grounded: false, vel: [0, 0, 0] }, rep(120, {}));
  const sts = [...new Set(rows.map(r => r.stateName))]; const r = rows[rows.length - 1];
  console.log(`  ${f}: ${sts.join(' > ')}; end y ${r.pos[1].toFixed(1)} floor ${r.floorY.toFixed(1)} inWater ${p.inWater} vy ${r.vel[1].toFixed(1)}`);
  if (f === 'bee') check(sts.includes('BEE_FLY'), 'bee in water -> BEE_FLY'); else check(r.stateName === FORMS[f] + '_IDLE' && r.pos[1] < -700, `${f} sinks to the pool floor and stands`);
}

console.log('\n==== summary (PAL, 2 frames per update)');
console.table(summary);
console.log(fails ? `${fails} FAILED` : 'all checks ok');
