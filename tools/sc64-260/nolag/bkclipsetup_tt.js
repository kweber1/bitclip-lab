// bkclipsetup.js -- "clip setup" for one crack spot: for a chosen move (punch, punch cancel, jump, backflip, beak buster)
// and facing, find the exact standing spot that lands Banjo's foot on the crack, then try lag patterns and report which
// ones hold or clip.
//
// How the start spot is found exactly: on flat floor, Banjo's speed over the updates does not depend on where he stands,
// so the step the game adds to x and z each update (baphysics: next = pos + f32(vel*dt)) is the same from any start.
// Playing the move once on a flat test floor gives those steps; walking them backwards from the crack, float by float,
// gives every start value whose rounded sum lands exactly on the crack. Each start found is then played in the real room
// with the full engine, which settles whether it arrives, holds and clips.
(function (root) {
'use strict';
const BK = root.BK || require('./bkcol.js'); const BM = root.BKMOVE || require('./bkmove.js'); const SR = root.BKSEARCH || require('./bksearch.js');
const F = Math.fround; const S = BM.S;
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
const bitsOf = (x) => { _f[0] = x; return _u[0]; };
function nextF(x, dir) { _f[0] = x; if (x === 0) { _u[0] = dir > 0 ? 1 : 0x80000001; return _f[0]; } if ((x > 0) === (dir > 0)) _u[0]++; else _u[0]--; return _f[0]; }

// every float a near (target - inc) with f32(a + inc) === target (at most `keep`, nearest first)
function preimages(target, inc, keep) {
  const out = []; const base = F(target - inc); let a = base;
  for (let i = 0; i < 48 && out.length < keep; i++) { a = nextF(a, -1); }
  let b = a; for (let i = 0; i < 96; i++) { if (F(b + inc) === target) out.push(b); b = nextF(b, 1); }
  out.sort((p, q) => Math.abs(p - base) - Math.abs(q - base)); return out.slice(0, keep);
}
// all starts s0 with s_k = f32(s_{k-1} + inc_k) ending exactly on target after the given steps
function invertChain(target, incs, keep = 4) {
  let cands = [F(target)];
  for (let i = incs.length - 1; i >= 0; i--) { const inc = incs[i]; const next = [];
    for (const c of cands) { if (inc === 0) { next.push(c); continue; } for (const a of preimages(c, inc, keep)) if (!next.includes(a)) next.push(a); }
    cands = next.slice(0, keep * 2); if (!cands.length) return []; }
  return cands;
}

// moves: per-update inputs from standing still, facing the stick direction s (stick only where the move uses it)
const MOVES = {
  runPC: { label: 'Running punch cancel', maxUpd: 60, air: true, params: (o) => { const r = []; for (const w of (o.run || [3, 5, 8, 12])) for (const c of o.cancel) for (const h of o.aHold) for (const sk of [0, 1]) r.push({ r: w, c, h, sk }); return r; },
    input: (p, s) => (i) => { if (i < p.r) return { sx: s.sx, sy: s.sy }; const j = i - p.r; const st = (p.sk || j === 0) ? { sx: s.sx, sy: s.sy } : {};
      return { ...st, B: j === 0, A: j >= p.c && j < p.c + p.h }; },
    desc: (p) => `run ${p.r}, B, A on +${p.c} held ${p.h}, stick ${p.sk ? 'held' : 'released'}` },
  punch: { label: 'Punch', params: () => [{}], input: (p, s) => (i) => ({ B: i === 0 }), desc: () => 'B' },
  punchCancel: { label: 'Punch cancel', params: (o) => { const r = []; for (const c of o.cancel) for (const h of o.aHold) r.push({ c, h }); return r; },
    input: (p, s) => (i) => ({ B: i === 0, A: i >= p.c && i < p.c + p.h }), desc: (p) => `B, A on update ${p.c + 1} held ${p.h} update${p.h > 1 ? 's' : ''}, no stick` },
  jump: { label: 'Jump', params: (o) => { const r = []; for (const h of o.aHold) for (const st of ['held', 'none']) r.push({ h, st }); return r; },
    input: (p, s) => (i) => ({ ...(p.st === 'held' ? { sx: s.sx, sy: s.sy } : {}), A: i < p.h }), desc: (p) => `A held ${p.h}, stick ${p.st === 'held' ? 'held forward' : 'neutral'}` },
  bflip: { label: 'Backflip', params: (o) => o.aHold.map(h => ({ h })), input: (p, s) => (i) => ({ Z: i <= 1, A: i >= 1 && i <= p.h }), desc: (p) => `Z, then A held ${p.h}` },
  buster: { label: 'Jump → beak buster', params: (o) => { const r = []; for (const h of [2, 6, 12]) for (const z of o.buster) r.push({ h, z }); return r; },
    input: (p, s) => (i) => ({ A: i < p.h, Z: i === p.z }), desc: (p) => `A held ${p.h}, Z on update ${p.z + 1}` },
  // talon trot jump: Z, Z + C-Left, Z held 16 updates (the trot starts, facing flips to Kazooie), trot r updates, then A held h (Z kept held, stick held)
  trotJump: { label: 'Talon trot jump', maxUpd: 90, air: true, params: (o) => { const r = []; for (const w of [0, 2, 4, 6, 9, 12, 16]) for (const h of o.aHold) r.push({ r: w, h }); return r; },
    input: (p, s) => (i) => { if (i === 0) return { Z: true }; if (i === 1) return { Z: true, Cl: true }; const j = i - 18; if (j < 0) return { Z: true };
      return { Z: true, sx: s.sx, sy: s.sy, A: j >= p.r && j < p.r + p.h }; },
    desc: (p) => `Z, Z + C-Left, Z ×16, ${p.r ? `trot ${p.r}, ` : ''}A held ${p.h} (Z and stick held)` },
};
function flatWorldAt(y) {
  const L = 60000; const d = { vertices: [[-L, y, -L], [L, y, -L], [L, y, L], [-L, y, L]], vertex_header: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100000], collision: { header: null, cells: [], triangles: [[0, 2, 1, 0, 0], [0, 3, 2, 0, 0]] } };
  return new BK.World(BK.load_model(d, 'flat'), null);
}

// o: {world, map, version, target:{x,y,z}, move:'punchCancel', params:{...ranges}, yaws:[deg...] | dirs:16, cam, lags:0|1|2, maxUpd, onResult, onProgress, shouldStop}
async function solve(o) {
  const mv = MOVES[o.move]; const T = o.target; const cam = F(o.cam ?? 0); const maxUpd = mv.maxUpd ?? o.maxUpd ?? 40; /* 40 updates = 80 frames */ const tx = F(T.x), tz = F(T.z); const ranges = Object.assign({ cancel: [1, 2, 3, 4], aHold: [2, 4, 6, 7, 10, 14], buster: [3, 5, 7, 9, 11] }, o.ranges || {});
  const params = mv.params(ranges);
  // facing directions: exact stick yaws spread around the circle
  const yaws = []; const nd = o.dirs ?? 16; const seen = new Set();
  for (const y of (o.facings || [])) { const s = SR.stickFor(y, cam, 1); yaws.push({ sx: s.sx, sy: s.sy, yaw: F(y), exact: true }); seen.add(F(y)); }
  for (let i = 0; i < nd; i++) { const s = SR.stickFor((o.yaw0 ?? 0) + 360 * i / nd, cam, 1); if (!seen.has(s.yaw)) { seen.add(s.yaw); yaws.push(s); } }
  const FW = flatWorldAt(F(T.y)); const results = []; let tried = 0, arrived = 0, pushed = 0; const tick = () => new Promise(r => setTimeout(r, 0)); let lastT = Date.now();
  // lag: one long update (3+ frames; every length from 3 up is the same dt, the cap) anywhere in the window, or two near the arrival
  const lagPatterns = o.patterns ? o.patterns : (k) => { const L = [[]]; if ((o.lags ?? 2) >= 1) for (let u = 0; u < maxUpd; u++) L.push([u]);
    if ((o.lags ?? 2) >= 2) for (let u = Math.max(0, k - 3); u < k + 6; u++) for (let w = u + 1; w < k + 7; w++) L.push([u, w]); return L; };
  const total = yaws.length * params.length; let done = 0;
  const startAt = (x0, z0, s) => new BM.Player(new BK.World(o.world.opa, o.world.xlu, o.world.props, o.map), { map: o.map, pos: [x0, F(T.y), z0], yaw: s.yaw, yawIdeal: s.yaw, cam, version: o.version, grounded: true });
  const near = (r) => Math.hypot(r.pos[0] - T.x, r.pos[2] - T.z) < 3;
  // play on from player R (already at update `from`) and judge the result
  const finish = (R, from, inp, fr, rows0, k, lag, s, p, st0) => {
    const rows = rows0.slice(); let fh = rows.findIndex(r => r.held && near(r));
    // clip = after landing on the crack the feet end up more than 115 below its floor (with or without a 5-hit hold first)
    const under = (r) => r.pos[1] < T.y - 115 && Math.hypot(r.pos[0] - T.x, r.pos[2] - T.z) < 60;
    let clipAt = rows.findIndex((r, i) => i >= k && under(r));
    for (let i = from; i < maxUpd; i++) { const r = R.step(inp(i), fr(i)); r.frames = fr(i); rows.push(r); if (r.held && fh < 0 && near(r)) fh = i; if (clipAt < 0 && under(r)) clipAt = i;
      if (clipAt >= 0 && (i > clipAt + 8 || r.pos[1] < T.y - 700)) break; if (fh < 0 && clipAt < 0 && i > k + 10) break; if (fh >= 0 && i > fh + 14) break; }
    const holds = rows.filter(r => r.held && near(r)).length; const clip = clipAt >= 0 && !rows.slice(clipAt + 1).some(r => r.pos[1] >= T.y - 60); /* popped back up onto the floor: not a clip */ if (!holds && !clip) return;
    const res = { kind: clip ? 'clip' : 'hold', holds, noHold: clip && !holds, move: mv.label, key: o.move, param: p, desc: mv.desc(p), facing: s.yaw, stick: [s.sx, s.sy], start: st0,
      startBits: [bitsOf(st0[0]).toString(16).toUpperCase(), bitsOf(st0[2]).toString(16).toUpperCase()], arrive: k + 1, lag: lag.map(u => u + 1), endY: rows[rows.length - 1].pos[1],
      inputs: rows.map((r, i) => ({ ...inp(i), frames: fr(i) })), trace: rows.map(r => r.pos.slice()), score: (clip ? 1000 : 0) + holds * 10 - lag.length * 3 };
    results.push(res); o.onResult && o.onResult(res); };
  for (const s of yaws) for (const p of params) {
    if (o.shouldStop && o.shouldStop()) return { results, tried, arrived, pushed };
    done++; const inp = mv.input(p, s);
    // 1. play the move once on the flat floor (no lag) to find the arrival updates: where the foot would go under the floor
    const arrivals = (() => { const P = new BM.Player(FW, { map: 0, pos: [0, F(T.y), 0], yaw: s.yaw, yawIdeal: s.yaw, cam, version: o.version, grounded: true });
      const A = []; let prevY = P.pos[1], wasAir = false;
      for (let i = 0; i < maxUpd; i++) { const r = P.step(inp(i), 2); const moved = P.lastD[0] !== 0 || P.lastD[2] !== 0;
        if ((r.target[1] < T.y && prevY >= T.y - 0.5 && i > 0 && (!mv.air || wasAir)) || (P.grounded && moved && i < 3 && o.move.startsWith('punch'))) A.push(i);
        wasAir = !P.grounded; prevY = r.pos[1]; }
      return A; })();
    for (const k of arrivals) {
      const pats0 = lagPatterns(k); const post0 = null; const pats = pats0; const post = pats.filter(L => L.every(u => u > k)), pre = pats.filter(L => L.some(u => u <= k));
      // patterns with every lag after the arrival share one start spot and one run up to the arrival
      const runTo = (lag) => { tried++; const fr = (i) => (lag.includes(i) ? 3 : 2);
        const P = new BM.Player(FW, { map: 0, pos: [0, F(T.y), 0], yaw: s.yaw, yawIdeal: s.yaw, cam, version: o.version, grounded: true });
        const ix = [], iz = []; for (let i = 0; i <= k; i++) { P.step(inp(i), fr(i)); ix.push(P.lastD[0]); iz.push(P.lastD[2]); }
        const X0 = invertChain(tx, ix, 3), Z0 = invertChain(tz, iz, 3); if (!X0.length || !Z0.length) return null;
        const R = startAt(X0[0], Z0[0], s); const st0 = R.pos.slice(); if (st0[0] !== X0[0] || st0[2] !== Z0[0]) { pushed++; return null; }
        const rows = []; for (let i = 0; i <= k; i++) { const r = R.step(inp(i), fr(i)); r.frames = fr(i); rows.push(r); }
        const last = rows[k]; if (last.target[0] !== tx || last.target[2] !== tz) return null; arrived++; return { R, rows, st0, fr }; };
      const base = runTo([]);
      let trigPats = null;
      if (o.trigger) { if (!base) continue; const D = o.trigger.door, R0 = o.trigger.r; const dd = (q) => Math.hypot(q[0] - D[0], q[1] - D[1], q[2] - D[2]);
        if (dd(base.st0) < R0) continue;
        const RR = SR.clone(base.R); const pos = base.rows.map(r => r.pos.slice()); for (let i = k + 1; i < maxUpd; i++) pos.push(RR.step(inp(i), 2).pos.slice());
        const t = pos.findIndex(q => dd(q) < R0); if (t < 0) continue; trigPats = (o.trigger.offs || [0, 1]).map(d => [t + d, t + d + 1]).filter(L => L[0] >= 0 && L[1] < maxUpd); }
      const POST = trigPats ? trigPats.filter(L => L.every(u => u > k)) : post, PRE = trigPats ? trigPats.filter(L => L.some(u => u <= k)) : pre;
      if (base) for (const lag of POST) { const fr = (i) => (lag.includes(i) ? 3 : 2); finish(SR.clone(base.R), k + 1, inp, fr, base.rows, k, lag, s, p, base.st0); }
      for (const lag of PRE) { const b = runTo(lag); if (b) finish(b.R, k + 1, inp, b.fr, b.rows, k, lag, s, p, b.st0);
        if (Date.now() - lastT > 80) { lastT = Date.now(); o.onProgress && o.onProgress(done / total, `${done} of ${total} facing × move combinations · ${arrived.toLocaleString()} setups land on the crack · ${pushed.toLocaleString()} start spots can't be stood on · ${results.length} hold`); await tick(); } }
    }
    if (Date.now() - lastT > 80) { lastT = Date.now(); o.onProgress && o.onProgress(done / total, `${done} of ${total} facing × move combinations · ${arrived.toLocaleString()} setups land on the crack · ${pushed.toLocaleString()} start spots can't be stood on · ${results.length} hold`); await tick(); }
  }
  results.sort((a, b) => b.score - a.score);
  o.onProgress && o.onProgress(1, `${results.length} setups hold (${results.filter(r => r.kind === 'clip').length} clip) · ${tried.toLocaleString()} tried · ${arrived.toLocaleString()} land exactly on the crack · ${pushed.toLocaleString()} start spots can't be stood on (a wall pushes Banjo off them)`);
  return { results, tried, arrived, pushed };
}
const api = { solve, invertChain, MOVES, flatWorldAt };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKCLIP = api;
})(typeof self !== 'undefined' ? self : this);
