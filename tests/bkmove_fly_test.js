// tests/bkmove_fly_test.js -- flight + climbing check for bkmove_fly.js (node tests/bkmove_fly_test.js)
// Flight: Mumbo's Mountain (0x02), flat ground near (-4289, -199, 4194), PAL (dt = 0.04 per 2-frame update).
// Climb: a made-up pole on the same flat ground (no pole object on this spot: the pole is a Player field).
global.self = global; const BK = require('/home/claude/bitclip-lab/bkcol.js'); global.BK = BK;
const M = require('/home/claude/bitclip-lab/bkmove.js'); require('/home/claude/bitclip-lab/bkmove_fly.js');
const r = JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync('/home/claude/bitclip-lab/data/map0x02.gz.wasm')));
const w = new BK.World(BK.load_model(r.opa, 'opa'), r.xlu ? BK.load_model(r.xlu, 'xlu') : null);
const f = (x, n = 2) => (typeof x === 'number' ? x.toFixed(n) : String(x));
const hv = (v) => Math.hypot(v[0], v[2]);
function show(title, rows, extra) {
  console.log('\n== ' + title);
  for (const q of rows) console.log(String(q.update).padStart(3), q.stateName.padEnd(15), 'pos', q.pos.map(x => f(x, 1)).join(','), ' vel', q.vel.map(x => f(x, 1)).join(','),
    ' hspd', f(hv(q.vel), 1), ' yaw', f(q.yaw, 1), ' pitch', f(q.pitch, 1), ' thv', f(q.thv, 1), q.grounded ? 'G' : '', extra ? extra(q) : '');
}
const START = [-4289, -199, 4194];

// ---- 1. flight pad launch, flaps, glide, beak bomb into the ground
{
  const p = new M.Player(w, { map: 0x02, pos: START, grounded: true, state: M.S.IDLE, yaw: 0 });
  p.gTimer = 0; p.redFeathers = 5;
  const inp = [{ flypad: 1 }, { A: 1 }, { flypad: 0 }];
  for (let i = 0; i < 40; i++) inp.push({});                      // launch, then glide
  for (let k = 0; k < 4; k++) { inp.push({ A: 1 }); inp.push({}); inp.push({}); inp.push({}); inp.push({}); inp.push({}); } // 4 flaps
  for (let i = 0; i < 25; i++) inp.push({});                      // wait out the flap timers
  for (let i = 0; i < 10; i++) inp.push({ sy: 80 });              // nose down (pitch -> 80)
  inp.push({ sy: 80, B: 1 });                                     // beak bomb, flying down at pitch ~80
  for (let i = 0; i < 70; i++) inp.push({});
  const rows = []; for (const u of inp) { const pre = p.redFeathers; const q = p.step(u, 2); q.feathers = p.redFeathers; q.flaps = p._flapCount(); rows.push(q); }
  show('flight pad -> FLY -> flaps -> beak bomb', rows, q => 'flaps ' + q.flaps + ' fea ' + q.feathers);
}

// ---- 2. level beak bomb (camera given) that runs out after 4000 units -> BOMB_END -> back to FLY
{
  const p = new M.Player(w, { map: 0x02, pos: START, grounded: true, state: M.S.IDLE, yaw: 0 });
  p.gTimer = 0; p.onFlyPad = true;
  const inp = [{ A: 1 }, { flypad: 0 }]; for (let i = 0; i < 75; i++) inp.push({});
  inp.push({ B: 1, flyCam: [20, 0] }); for (let i = 0; i < 80; i++) inp.push({});
  const rows = inp.map(u => p.step(u, 2));
  show('beak bomb 20 deg up along -z (camera pitch 20, yaw 0) -> 4000 units -> BOMB_END -> FLY', rows.slice(70));
}

// ---- 3. flying back down: land out of flight
{
  const p = new M.Player(w, { map: 0x02, pos: START, grounded: true, state: M.S.IDLE, yaw: 0 });
  p.gTimer = 0; p.onFlyPad = true;
  const inp = [{ A: 1 }, { flypad: 0 }]; for (let i = 0; i < 160; i++) inp.push({ sy: 80 });
  const rows = inp.map(u => p.step(u, 2));
  show('dive and land', rows.filter((q, i) => i < 3 || i % 10 === 0 || q.stateName !== 'FLY'));
}

// ---- 4. climbing: jump at a pole, climb up, climb off the top
{
  const pole = { bottom: [START[0], -199, START[2] - 100], top: 300, radius: 20, type: 2 };
  const p = new M.Player(w, { map: 0x02, pos: START, grounded: true, state: M.S.IDLE, yaw: 0 });
  p.pole = pole;
  const inp = [{ A: 1, sy: 80 }]; for (let i = 0; i < 12; i++) inp.push({ A: 1, sy: 80 });
  for (let i = 0; i < 50; i++) inp.push({ sy: 80 }); for (let i = 0; i < 40; i++) inp.push({});
  const rows = inp.map(u => { const q = p.step(u, 2); q.tv = p.tvel[1]; return q; });
  show('pole: jump in, climb (stick up), climb exit at the top (no ledge here, so he falls back onto the pole after the 0.6 s regrab wait)', rows.filter((q, i) => i < 8 || (i > 32 && i < 44) || i % 6 === 0), q => 'tvel ' + f(q.tv, 1));
}

// ---- 5. hurt / bounced while flying, and trot -> flight pad
{
  const mk = () => { const p = new M.Player(w, { map: 0x02, pos: START, grounded: true, state: M.S.IDLE, yaw: 0 }); p.onFlyPad = true; p.gTimer = 0;
    p.step({ A: 1 }); p.onFlyPad = false; for (let i = 0; i < 50; i++) p.step({}); return p; };
  let p = mk(); const rows = [];
  p.hit([p.pos[0], p.pos[1], p.pos[2] + 100], 1); for (let i = 0; i < 34; i++) rows.push(p.step({}));
  show('hit in flight (source 100 ahead) -> FLY_OW -> FLY', rows.filter((q, i) => i < 4 || i > 28));
  p = mk(); const r2 = [];
  p.flyKnock([p.pos[0], p.pos[1], p.pos[2] + 100]); for (let i = 0; i < 30; i++) r2.push(p.step({}));
  show('bounce in flight -> FLY_KNOCKBACK (1300 back, vy 400, gravity -1800)', r2.filter((q, i) => i < 4 || i > 24));
  p = new M.Player(w, { map: 0x02, pos: START, grounded: true, state: M.S.IDLE, yaw: 0 }); p.onFlyPad = true;
  const r3 = [{ Z: 1 }, { Z: 1 }, { Z: 1, Cl: 1 }]; for (let i = 0; i < 30; i++) r3.push({ Z: 1 }); r3.push({ Z: 1, A: 1 }); r3.push({ Z: 1 });
  show('talon trot on a flight pad + A -> FLY_ENTER', r3.map(u => p.step(u, 2)).slice(-4));
}
