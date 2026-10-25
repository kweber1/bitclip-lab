// bksearch.js -- route search for the Bit-Clip Lab, on top of bkmove.js (exact movement) and bkcol.js (exact collision).
// A route: run from the start in a straight line (any stick angle the game can produce), then one finishing move
// (jump, backflip, punch-cancel jump, beak buster, barge, roll, crouch slide, skid), then coast until Banjo lands.
// Floor cracks are seams a fraction of a unit wide, so the search works like a TAS brute-forcer:
//  1. run every stick angle near the bearing to the target and keep Banjo's state after every update (launch states);
//  2. play every finishing move once on a flat test floor, from each stage of a run's acceleration, and keep its path;
//  3. for every launch state x finishing move, place that path at the launch point (rotated to the run direction) and
//     keep the pairs whose path touches the target seam at the right height;
//  4. replay those pairs exactly in the real room (optionally with one lag update after the first hold).
(function (root) {
'use strict';
// a clip: after the first hold Banjo goes 60+ under the floor and never comes back up within 60 of it (a pop back onto the floor is not a clip)
const stayedUnder = (rows, fh, y0) => { let k = -1; for (let i = fh; i < rows.length; i++) if (rows[i].pos[1] < y0 - 60) { k = i; break; } if (k < 0) return false; for (let i = k + 1; i < rows.length; i++) if (rows[i].pos[1] >= y0 - 60) return false; return true; };
const BK = root.BK || require('./bkcol.js'); const BM = root.BKMOVE || require('./bkmove.js');
const F = Math.fround; const S = BM.S;

// ---- stick: one raw (x, y) per normalised level pair; the angle and distance the game computes for it
let STICKS = null;
function sticks() {
  if (STICKS) return STICKS; STICKS = [];
  const lv = (mn, mx) => { const m = new Map(); for (let v = -127; v <= 127; v++) { let w = v; if (w > 0) { w = w > mx ? mx : w < mn ? mn : w; w = Math.trunc(((w - mn) * 80) / (mx - mn)); } else if (w < 0) { w = w < -mx ? -mx : w > -mn ? -mn : w; w = Math.trunc(((w + mn) * 80) / (mx - mn)); } if (!m.has(w) || Math.abs(v) < Math.abs(m.get(w))) m.set(w, v); } return m; };
  const LX = lv(7, 59), LY = lv(7, 61);
  for (const [nx, rx] of LX) for (const [ny, ry] of LY) {
    const x = F(F(1 / 80) * nx), y = F(F(1 / 80) * ny); let d = F(Math.sqrt(F(F(x * x) + F(y * y)))); if (d === 0) continue;
    let a = BK.ml_acosf(F(y / d)); if (x < 0) a = F(180 - a); if (y < 0) a = F(360 - a); if (d > 1) d = F(1);
    STICKS.push({ rx, ry, a, d });
  }
  return STICKS;
}
const yawOfStick = (a, cam) => BM.mlNormalizeAngle(F(F(F(cam) + a) + 90.0));
function stickFor(yaw, cam, mag = 1) {
  let best = null, be = 1e9;
  for (const s of sticks()) { if (s.d < mag - 1e-6) continue; let e = Math.abs(yawOfStick(s.a, cam) - yaw); if (e > 180) e = 360 - e;
    if (e < be - 1e-9 || (Math.abs(e - be) < 1e-9 && best && Math.abs(s.rx) + Math.abs(s.ry) < Math.abs(best.rx) + Math.abs(best.ry))) { be = e; best = s; } }
  return { sx: best.rx, sy: best.ry, err: be, yaw: yawOfStick(best.a, cam) };
}
const memo = new Map();
function stickForM(yaw, cam, mag) { const k = Math.round(yaw * 1000) + ':' + Math.round(cam * 1000) + ':' + mag; let v = memo.get(k); if (!v) { v = stickFor(yaw, cam, mag); memo.set(k, v); } return v; }
// every distinct full-press yaw within `spread` degrees of `bearing`, at most n of them, evenly spread
function runYaws(bearing, cam, spread, n) {
  const seen = new Map();
  for (const s of sticks()) { if (s.d < 1) continue; const y = yawOfStick(s.a, cam); let e = y - bearing; e = ((e + 540) % 360) - 180; if (Math.abs(e) > spread) continue;
    const k = y.toFixed(5); if (!seen.has(k) || Math.abs(s.rx) + Math.abs(s.ry) < Math.abs(seen.get(k).sx) + Math.abs(seen.get(k).sy)) seen.set(k, { yaw: y, sx: s.rx, sy: s.ry, off: e }); }
  let list = [...seen.values()].sort((a, b) => a.off - b.off);
  if (list.length > n) { const out = []; for (let i = 0; i < n; i++) out.push(list[Math.round(i * (list.length - 1) / (n - 1))]); list = out; }
  return list;
}

// ---- cloning a Player
function clone(P) {
  const Q = Object.assign(Object.create(Object.getPrototypeOf(P)), P);
  Q.pos = P.pos.slice(); Q.vel = P.vel.slice(); Q.zones = P.zones.slice(); Q.yawB = P.yawB.slice();
  Q.keys = { A: P.keys.A.slice(), B: P.keys.B.slice(), Z: P.keys.Z.slice(), Cl: (P.keys.Cl || [0, 1]).slice() }; Q.timers = P.timers.slice(); Q.timersLast = P.timersLast.slice();
  Q.anim = Object.assign(Object.create(Object.getPrototypeOf(P.anim)), P.anim); Q.v = Object.assign({}, P.v); Q.flags = Object.assign({}, P.flags); Q.stick = Object.assign({}, P.stick);
  const t = P.tracker; Q.tracker = Object.assign(Object.create(Object.getPrototypeOf(t)), t); Q.tracker.unk1C = t.unk1C.slice(); Q.tracker.norm = t.norm.slice(); if (t.unk28) Q.tracker.unk28 = t.unk28.slice();
  Q.fallStart = P.fallStart.slice(); Q.dpos = P.dpos.slice(); return Q;
}

// ---- finishing moves: input for update i of the move (i from 0). Stick: 'keep' = hold the run direction, 'none', 'back'
const TROT_START = 16;  // updates of Z after C-Left before the trot takes A (the enter animation must pass 0.5: 12 updates on PAL, 15 on NTSC; 16 works on both)
function stickOf(dir, c) { if (dir === 'none') return { sx: 0, sy: 0 }; if (dir === 'back') return { sx: c.back.sx, sy: c.back.sy }; return { sx: c.run.sx, sy: c.run.sy }; }
const MOVES = {
  jump: { label: 'Jump', params: (o) => { const r = []; for (const h of o.aHolds) for (const d of ['keep', 'none']) r.push({ h, d }); return r; },
    input: (p) => (i, c) => ({ ...stickOf(p.d, c), A: i < p.h }), desc: (p) => `A held ${p.h} update${p.h > 1 ? 's' : ''}, stick ${p.d === 'keep' ? 'held' : 'released'}` },
  jumpBuster: { label: 'Jump → beak buster', params: (o) => { const r = []; for (const h of o.aHoldsShort) for (const k of o.busterAt) r.push({ h, k }); return r; },
    input: (p) => (i, c) => ({ ...stickOf(i < p.k ? 'keep' : 'none', c), A: i < p.h, Z: i === p.k }), desc: (p) => `A held ${p.h}, Z on update ${p.k + 1}` },
  bflip: { label: 'Backflip', params: (o) => { const r = []; for (const h of o.aHoldsFlip) for (const d of ['back', 'keep', 'none']) r.push({ h, d }); return r; },
    input: (p) => (i, c) => i === 0 ? { Z: true } : ({ ...(i >= 2 ? stickOf(p.d, c) : { sx: 0, sy: 0 }), Z: i <= 1, A: i >= 1 && i <= p.h }), desc: (p) => `Z, then A held ${p.h}, stick ${p.d}` },
  bflipBuster: { label: 'Backflip → beak buster', params: (o) => { const r = []; for (const k of o.busterAtFlip) for (const d of ['back', 'none']) r.push({ k, d }); return r; },
    input: (p) => (i, c) => i === 0 ? { Z: true } : ({ ...(i >= 2 && i < p.k ? stickOf(p.d, c) : { sx: 0, sy: 0 }), Z: i <= 1 || i === p.k, A: i >= 1 }), desc: (p) => `Z, A held, Z again on update ${p.k + 1}, stick ${p.d}` },
  punchCancel: { label: 'Punch → cancel jump', params: (o) => { const r = []; for (const k of o.cancelAt) for (const h of o.aHoldsShort) r.push({ k, h }); return r; },
    input: (p) => (i, c) => ({ ...(i >= p.k ? stickOf('keep', c) : { sx: 0, sy: 0 }), B: i === 0, A: i >= p.k && i < p.k + p.h }), desc: (p) => `B, A on update ${p.k + 1} held ${p.h}` },
  punchCancelBuster: { label: 'Punch → cancel jump → buster', params: (o) => { const r = []; for (const k of o.cancelAt) for (const z of o.busterAt) r.push({ k, h: 12, z }); return r; },
    input: (p) => (i, c) => ({ ...(i >= p.k && i < p.k + p.z ? stickOf('keep', c) : { sx: 0, sy: 0 }), B: i === 0, A: i >= p.k && i < p.k + p.h, Z: i === p.k + p.z }), desc: (p) => `B, A on update ${p.k + 1}, Z ${p.z} later` },
  barge: { label: 'Beak barge', params: (o) => [{ tap: true }, { tap: false }], input: (p) => (i, c) => ({ Z: true, B: i >= 1 && (p.tap ? i <= 1 : i <= 30) }), desc: (p) => p.tap ? 'Z + tap B' : 'Z + hold B' },
  roll: { label: 'Roll (twirl)', params: (o) => [{ d: 'keep' }, { d: 'none' }], input: (p) => (i, c) => ({ ...stickOf(p.d, c), B: i === 0 }), desc: (p) => `B at full run, stick ${p.d === 'keep' ? 'held' : 'released'}` },
  slide: { label: 'Crouch slide', params: (o) => { const r = [{ f: 0 }]; for (const h of o.aHoldsFlip) r.push({ f: 1, h }); return r; },
    input: (p) => (i, c) => ({ Z: i <= 12, A: !!p.f && i >= 4 && i < 4 + p.h }), desc: (p) => p.f ? `Z slide, backflip A held ${p.h}` : 'Z slide' },
  // talon trot (Kazooie): Z, Z + C-Left, Z held while the trot starts (14 updates), Z + stick for r updates, then A held h (Z kept held)
  trotJump: { label: 'Talon trot jump', n: 100, params: (o) => { const r = []; for (const w of (o.trotRun || [0, 2, 4, 6, 9, 12, 16, 20, 25])) for (const h of (o.aHoldsTrot || [1, 3, 6, 10, 14, 20])) for (const d of ['keep', 'none']) r.push({ r: w, h, d }); return r; },
    input: (p) => (i, c) => { if (i === 0) return { Z: true }; if (i === 1) return { Z: true, Cl: true }; const j = i - 2 - TROT_START; if (j < 0) return { Z: true };
      if (j < p.r) return { Z: true, ...stickOf('keep', c) }; return { Z: true, ...stickOf(p.d, c), A: j - p.r < p.h }; },
    done: (P, r, i, p) => r.grounded && i > 2 + TROT_START + p.r + 3, desc: (p) => `trot${p.r ? ` ${p.r} update${p.r > 1 ? 's' : ''},` : ''} A held ${p.h}, stick ${p.d === 'keep' ? 'held' : 'released'}` },
  trotWalk: { label: 'Talon trot walk', n: 90, noStickVariant: false, params: () => [{}], input: () => (i, c) => i === 0 ? { Z: true } : i === 1 ? { Z: true, Cl: true } : i < 2 + TROT_START ? { Z: true } : { Z: true, ...stickOf('keep', c) },
    done: () => false, desc: () => 'trot toward the target (Z held)' },
  skid: { label: 'Skid turn', params: (o) => [{ a: 0 }, { a: 1 }], input: (p) => (i, c) => ({ ...stickOf('back', c), A: !!p.a && i >= 4 && i < 16 }), desc: (p) => p.a ? 'reverse stick, jump out of the skid' : 'reverse stick' },
};

// when a finishing move is over: back on the ground (states that stay grounded while the move is still going don't count)
const BUSY = new Set([S.BBUSTER, S.BBARGE, S.CLAW, S.CROUCH]);
function doneOf(M, p) { return M.done ? (P, r, i) => M.done(P, r, i, p) : (P, r, i) => r.grounded && i > 3 && !BUSY.has(P.state); }
// a flat test floor at y = 0 (two triangles, no grid) for the move paths
function flatWorld() {
  const L = 60000; const d = { vertices: [[-L, 0, -L], [L, 0, -L], [L, 0, L], [-L, 0, L]], vertex_header: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100000], collision: { header: null, cells: [], triangles: [[0, 2, 1, 0, 0], [0, 3, 2, 0, 0]] } };
  const m = BK.load_model(d, 'flat'); return new BK.World(m, null);
}
// seam geometry: line through the crack points of the target's seam
function seamOf(pts) {
  if (!pts || pts.length < 2) return null;
  let a = pts[0], b = pts[0], best = -1;
  for (const p of pts) { const d = (p[0] - pts[0][0]) ** 2 + (p[2] - pts[0][2]) ** 2; if (d > best) { best = d; b = p; } }
  best = -1; for (const p of pts) { const d = (p[0] - b[0]) ** 2 + (p[2] - b[2]) ** 2; if (d > best) { best = d; a = p; } }
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1; return { ax: a[0], az: a[2], ux: dx / L, uz: dz / L, len: L, y: a[1] };
}

// the real triangle edge the crack points sit on (their own extremes can be off the edge by more than the gap is wide)
// "only at the seam's bit-clip spots": the spots' positions along the seam (sorted); okT(t) is true within tol of one of them,
// nearestT(t) gives the closest one
function spotsOnSeam(seam, pts, tol) { if (!seam || !pts || !pts.length) return null;
  const ts = pts.map(c => (c[0] - seam.ax) * seam.ux + (c[c.length > 2 ? 2 : 1] - seam.az) * seam.uz).sort((a, b) => a - b);
  const nearestT = (t) => { let lo = 0, hi = ts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m; else hi = m; } return Math.abs(ts[lo] - t) <= Math.abs(ts[hi] - t) ? ts[lo] : ts[hi]; };
  return { n: ts.length, okT: (t) => Math.abs(nearestT(t) - t) <= tol, nearestT }; }
function edgeOf(world, pts) {
  const fit = seamOf(pts); if (!fit || !world) return fit; let best = null;
  const sample = pts.length > 60 ? pts.filter((_, i) => i % Math.ceil(pts.length / 60) === 0) : pts;
  for (const cl of [world.opa, world.xlu]) { if (!cl) continue;
    for (const t of cl.tris) for (let e = 0; e < 3; e++) { const p = t.vi[e], q = t.vi[(e + 1) % 3]; const ux = q[0] - p[0], uz = q[2] - p[2], L = Math.hypot(ux, uz); if (L < 1) continue;
      let m = 0; for (const c of sample) { const d = Math.abs((c[0] - p[0]) * uz - (c[2] - p[2]) * ux) / L; if (d > m) m = d; if (best && m >= best.m) break; }
      if (!best || m < best.m) best = { m, p, q, L, ux, uz }; } }
  if (!best || best.m > 0.01) return fit;
  const { p, L, ux, uz } = best; return { ax: p[0], az: p[2], ux: ux / L, uz: uz / L, len: L, y: fit.y, edge: true };
}
// o: {world, map, version, start:{pos,yaw,cam}, target:{x,y,z}, seamPts:[[x,y,z],...], moves:{jump:true,...}, strict:'frame'|'simple',
//     lag:bool, runs, spread, maxRun, maxReal, tol, onPath(path, kind), onResult(res), onProgress(frac, text), shouldStop()}
async function search(o) {
  const t0 = Date.now(); const world = o.world, cam = F(o.start.cam ?? 0), T = o.target; const simple = o.strict === 'simple';
  const stop = () => o.shouldStop && o.shouldStop(); const prog = (f, t) => o.onProgress && o.onProgress(f, t); let lastYield = Date.now(); const tick = () => { if (Date.now() - lastYield < 60) return null; return new Promise(r => setTimeout(() => { lastYield = Date.now(); r(); }, 0)); };
  const seam = edgeOf(world, o.seamPts); const pointTol = o.pointTol ?? 0.6; const tol = o.tol ?? 3;
  // signed distance to the seam line (or to the point) and whether the foot is along the seam's extent
  // "where on the seam": anywhere, or within o.alongMax of the picked crack along the seam (0.01 = that exact spot)
  const aMax = o.alongMax ?? Infinity; const tT = seam ? (T.x - seam.ax) * seam.ux + (T.z - seam.az) * seam.uz : 0;
  const SP = spotsOnSeam(seam, o.spotPts, o.spotTol ?? 0.2);
  const near = (x, z) => { if (!seam) return Math.hypot(x - T.x, z - T.z) < pointTol ? 0 : 1e9;
    const rx = x - seam.ax, rz = z - seam.az; const t = rx * seam.ux + rz * seam.uz; if (t < -1 || t > seam.len + 1 || Math.abs(t - tT) > aMax) return 1e9; if (SP && !SP.okT(t)) return 1e9; return Math.abs(rx * seam.uz - rz * seam.ux); };
  const yLo = T.y - 80, yHi = T.y + 40;
  const opts = {
    aHolds: simple ? [1, 3, 6, 10, 14] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20], aHoldsShort: simple ? [2, 8] : [1, 2, 3, 4, 6, 8, 10, 12],
    busterAt: simple ? [4, 7, 10] : [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16], busterAtFlip: simple ? [14, 18, 22] : [12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26],
    aHoldsFlip: simple ? [3, 30] : [1, 2, 3, 4, 6, 8, 11, 14, 20, 30], cancelAt: simple ? [2, 5, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] };
  const enabled = Object.keys(MOVES).filter(k => o.moves ? o.moves[k] : true);
  const variants = []; for (const k of enabled) for (const p of MOVES[k].params(opts)) variants.push({ k, p, label: MOVES[k].label, desc: MOVES[k].desc(p), mk: MOVES[k].input(p), n: MOVES[k].n || 60, done: doneOf(MOVES[k], p) });
  const P0 = new BM.Player(world, { map: o.map, pos: o.start.pos, vel: [0, 0, 0], yaw: o.start.yaw ?? 0, cam, version: o.version, grounded: true, state: S.IDLE });
  const maxRun = o.maxRun ?? 70; let simSteps = 0;
  // 1. runs
  const bearing = (Math.atan2(T.x - o.start.pos[0], T.z - o.start.pos[2]) * 180 / Math.PI + 360) % 360;
  const dist0 = Math.hypot(T.x - o.start.pos[0], T.z - o.start.pos[2]);
  const RY = runYaws(bearing, cam, o.spread ?? 40, o.runs ?? 240); const launches = [];
  for (let ri = 0; ri < RY.length; ri++) {
    if (stop()) break; const ry = RY[ri]; const P = clone(P0); const path = [P.pos.slice()]; const back = stickForM((ry.yaw + 180) % 360, cam, 1);
    for (let u = 0; u < maxRun; u++) {
      const r = P.step({ sx: ry.sx, sy: ry.sy }, 2); simSteps++; path.push(r.pos.slice());
      if (P.grounded && u >= 0) launches.push({ P: clone(P), ri, u: u + 1, ry, back });
      const d = Math.hypot(T.x - P.pos[0], T.z - P.pos[2]); if (u > 5 && d > dist0 + 300) break; if (P.pos[1] < T.y - 500) break;
    }
    o.onPath && o.onPath(path, 'run'); if (ri % 6 === 5) { prog(0.3 * ri / RY.length, `Running ${ri + 1} of ${RY.length} stick angles`); await tick(); }
  }
  // 2. move paths on the flat test floor, from each stage of the run-up (updates 1..12 of a run, then full speed)
  const FW = flatWorld(); const canon = new Map(); const SAT = 14;
  const cr = stickForM(0, cam, 1), cyaw = cr.yaw, cb = stickForM((cyaw + 180) % 360, cam, 1);
  const Pc = new BM.Player(FW, { map: 0, pos: [0, 0, 0], vel: [0, 0, 0], yaw: o.start.yaw ?? 0, cam, version: o.version, grounded: true, state: S.IDLE });
  const stage = []; { const P = clone(Pc); for (let u = 1; u <= SAT; u++) { P.step({ sx: cr.sx, sy: cr.sy }, 2); stage[u] = clone(P); } }
  const ctxC = { run: cr, back: cb };
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi]; const arr = [];
    for (let u = 1; u <= SAT; u++) { const P = clone(stage[u]); const base = P.pos.slice(); const pts = [];
      for (let i = 0; i < v.n; i++) { const r = P.step(v.mk(i, ctxC), 2); simSteps++; pts.push([r.pos[0] - base[0], r.pos[1] - base[1], r.pos[2] - base[2], r.vel[1]]); if (v.done(P, r, i)) break; if (r.pos[1] < base[1] - 900) break; }
      arr[u] = pts; }
    canon.set(vi, arr); if (vi % 10 === 9) { prog(0.3 + 0.1 * vi / variants.length, `Move paths ${vi + 1} of ${variants.length}`); await tick(); }
  }
  // 3. place every move path at every launch state; keep the ones that touch the seam inside the height window
  const cands = [];
  for (const l of launches) {
    const th = (l.ry.yaw - cyaw) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th); const u = Math.min(l.u, SAT); const L = l.P.pos;
    for (let vi = 0; vi < variants.length; vi++) { const pts = canon.get(vi)[u]; let best = 1e9, bk = -1;
      for (let k = 0; k < pts.length; k++) { const q = pts[k]; const y = L[1] + q[1]; if (y < yLo || y > yHi) continue; const x = L[0] + q[0] * c + q[2] * s, z = L[2] - q[0] * s + q[2] * c; const d = near(x, z); if (d < best) { best = d; bk = k; } }
      if (best < tol) cands.push({ l, vi, d: best, k: bk }); }
  }
  cands.sort((a, b) => a.d - b.d); prog(0.4, `${cands.length.toLocaleString()} candidate routes pass near the target; checking their exact paths`); await tick();
  // 4. exact flight paths without collision ("ghost"): a crack is a gap about one float step wide, so the foot has to land on
  //    exactly the right float pair. Only paths whose foot lands on a real gap (floor ray misses) are replayed in the room.
  const results = []; const maxGhost = o.maxGhost ?? 80000; let real = 0, ghosts = 0, gaps = 0; let closest = 1e9, closestAt = null;
  const nrm = [0, 0, 0]; const isGap = (x, z) => { const a = [x, F(T.y + 10), z], b = [x, F(T.y - 10), z]; return !world.line(a, b, nrm, 0x400000 | 0x1E0000); };
  const replay = (l, v, ctx) => {
    const lagSet = o.lag ? [null, 0, 1, 2, 3] : [null]; let firstHold = -1;
    for (const lag of lagSet) {
      if (lag !== null && firstHold < 0) break;
      const P = clone(l.P); const rows = []; let landed = 0, fh = -1;
      for (let i = 0; i < v.n; i++) { const fr = (lag !== null && i === firstHold + 1 + lag) ? 3 : 2; const r = P.step(v.mk(i, ctx), fr); simSteps++; r.frames = fr; rows.push(r);
        if (r.held && fh < 0 && near(r.pos[0], r.pos[2]) < 3) fh = i;
        if (v.done(P, r, i)) { if (++landed > 2) break; }
        if (r.pos[1] < T.y - 700) break; }
      real++; if (lag === null) firstHold = fh;
      const holds = rows.filter(r => r.held && near(r.pos[0], r.pos[2]) < 3).length;
      const clip = fh >= 0 && stayedUnder(rows, fh, T.y);
      if (o.onPath) o.onPath([l.P.pos.slice(), ...rows.map(r => r.pos)], clip ? 'clip' : holds ? 'hold' : 'try');
      if (holds) {
        const res = { kind: clip ? 'clip' : 'hold', holds, move: v.label, desc: v.desc, key: v.k, param: v.p, runYaw: l.ry.yaw, runStick: [l.ry.sx, l.ry.sy], runN: l.u, launch: l.P.pos.slice(), lag, rows, start: o.start, cam,
          inputs: rows.map((r, i) => ({ ...v.mk(i, ctx), frames: r.frames })), score: (clip ? 1000 : 0) + holds * 10 };
        if (simple) res.robust = robust(l, v, ctx, near);
        if (!simple || res.robust) { results.push(res); o.onResult && o.onResult(res); }
      }
    }
  };
  const nG = Math.min(cands.length, maxGhost);
  for (let ci = 0; ci < nG; ci++) {
    if (stop()) break; const cnd = cands[ci]; const v = variants[cnd.vi]; const l = cnd.l; const ctx = { run: l.ry, back: l.back };
    const G = clone(l.P); G.ghost = true; let prevY = G.pos[1]; let hit = false; ghosts++;
    for (let i = 0; i < v.n; i++) { const r = G.step(v.mk(i, ctx), 2);
      const y = r.pos[1];
      if (y <= T.y + 2 && prevY >= T.y - 60 && y < prevY) { const x = r.pos[0], z = r.pos[2]; const d = seam ? near(x, z) : Math.hypot(x - T.x, z - T.z);
        if (d < closest) { closest = d; closestAt = { move: v.label, desc: v.desc, runYaw: l.ry.yaw, runN: l.u, x, z }; }
        if (seam ? (d < 0.002 && isGap(x, z)) : d < pointTol) { hit = true; gaps++; break; } }
      if (y < T.y - 80) break; prevY = y; }
    if (hit) replay(l, v, ctx);
    if (ci % 400 === 399) { prog(0.4 + 0.6 * ci / nG, `Checked ${(ci + 1).toLocaleString()} of ${nG.toLocaleString()} exact paths · ${gaps} land on a gap · ${results.length} found · closest ${closest < 1e8 ? closest.toExponential(2) : '—'}`); await tick(); }
  }
  results.sort((a, b) => b.score - a.score || a.runN - b.runN);
  prog(1, `${results.length} route${results.length === 1 ? '' : 's'} found · ${ghosts.toLocaleString()} exact paths, ${gaps} on a gap, ${real.toLocaleString()} replays in the room · ${simSteps.toLocaleString()} updates simulated in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { results, cands: cands.length, ghosts, gaps, closest, closestAt, launches: launches.length, variants: variants.length, runs: RY.length, simSteps, ms: Date.now() - t0 };
}
// ---- deep search for jumps: millions of exact paths per minute
// Run-ups use the flat-floor ghost (exact on flat floor with no walls in the way); the take-off update runs in the engine;
// the flight is integrated with the same float steps as baphysics (AIRBORN, constant stick, air friction 0.07), and the
// height for each A-hold length separately (vertical and horizontal motion do not mix in the air). A path counts when the
// foot lands on the target seam within `eps` (default 1e-4) at the update it crosses the floor; those are replayed from
// the start in the full engine, and the ones where the floor ray really misses and Banjo gets held are reported.
async function deepJump(o) {
  const t0 = Date.now(); const world = o.world, cam = F(o.start.cam ?? 0), T = o.target; const seam = edgeOf(world, o.seamPts);
  const stop = () => o.shouldStop && o.shouldStop(); const prog = (f, t) => o.onProgress && o.onProgress(f, t); let lastYield = Date.now(); const tick = () => { if (Date.now() - lastYield < 60) return null; return new Promise(r => setTimeout(() => { lastYield = Date.now(); r(); }, 0)); };
  if (!seam) throw new Error('Deep search needs a crack or hold on a seam as the target.');
  const budget = (o.seconds ?? 60) * 1000; const holdsList = o.aHolds ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24];
  // along-seam window: anywhere on the seam, or within o.alongMax of the picked crack
  const tT = (T.x - seam.ax) * seam.ux + (T.z - seam.az) * seam.uz; const aMax = o.alongMax ?? Infinity;
  const SP = spotsOnSeam(seam, o.spotPts, o.spotTol ?? 0.2);
  const sd = (x, z) => { const rx = x - seam.ax, rz = z - seam.az; const t = rx * seam.ux + rz * seam.uz; if (t < -0.5 || t > seam.len + 0.5 || Math.abs(t - tT) > aMax) return 1e9; if (SP && !SP.okT(t)) return 1e9; return Math.abs(rx * seam.uz - rz * seam.ux); };
  const nrm = [0, 0, 0]; const isGap = (x, z) => !world.line([x, F(T.y + 10), z], [x, F(T.y - 10), z], nrm, 0x400000 | 0x1E0000);
  // how wide the gap is across the seam at the target (so progress can be read against it)
  let gapW = 0; { const n = [seam.uz, -seam.ux]; const tx = F(T.x), tz = F(T.z); // T is a crack point
    if (isGap(tx, tz)) for (const k of [-1, 1]) { for (let i = 1; i < 3000; i++) { const off = k * i * 2e-7; if (!isGap(F(tx + n[0] * off), F(tz + n[1] * off))) { gapW += i * 2e-7; break; } } } }
  const eps = Math.max(o.eps ?? 0, 4e-5, gapW * 2.5); let nearHits = 0;
  const P0 = new BM.Player(world, { map: o.map, pos: o.start.pos, vel: [0, 0, 0], yaw: o.start.yaw ?? 0, cam, version: o.version, grounded: true, state: S.IDLE });
  const dt = P0.dtOf(2); const kk = F(dt / 0.0333333); const fr = BM.FRICTION[1]; const NK = 45;
  const VY = holdsList.map(h => { const ys = []; let y = 0, vy = F(710), g = F(-1350); for (let i = 0; i < NK; i++) { if (i >= 1 && i >= h && vy > 0) g = F(-2700); vy = F(vy + F(dt * g)); if (vy < F(-4000)) vy = F(-4000); y = F(y + F(vy * dt)); ys.push(y); } return ys; });
  const reach = o.reach ?? 900, reach2 = reach * reach; const maxRun = o.maxRun ?? 80;
  let paths = 0, launches = 0, runs = 0, closest = 1e9, closestAt = null, gaps = 0, verified = 0; const results = []; const seen = new Set();
  const legsKey = (legs) => legs.map(l => `${l.s.sx},${l.s.sy}x${l.n}`).join('+');
  const verify = (legs, pol, h) => { // replay from the start in the full engine
    const key = legsKey(legs) + `|${pol.key}|${h}`; if (seen.has(key)) return; seen.add(key); verified++;
    const P = clone(P0); const ups = [];
    for (const l of legs) for (let u = 0; u < l.n; u++) { const inp = { sx: l.s.sx, sy: l.s.sy, frames: 2 }; ups.push(inp); P.step(inp, 2); }
    const launch = P.pos.slice(); const fl = legs[legs.length - 1].s; const rows = []; let fh = -1, landed = 0;
    for (let i = 0; i < 60; i++) { const inp = { sx: i === 0 ? fl.sx : pol.stick.sx, sy: i === 0 ? fl.sy : pol.stick.sy, A: i < h, frames: 2 }; ups.push(inp);
      const r = P.step(inp, 2); r.frames = 2; rows.push(r); if (r.held && fh < 0 && sd(r.pos[0], r.pos[2]) < 3) fh = i; if (r.grounded && i > 3) { if (++landed > 2) break; } if (r.pos[1] < T.y - 700) break; }
    const holds = rows.filter(r => r.held && sd(r.pos[0], r.pos[2]) < 3).length; const clip = fh >= 0 && stayedUnder(rows, fh, T.y);
    o.onPath && o.onPath([launch, ...rows.map(r => r.pos)], clip ? 'clip' : holds ? 'hold' : 'try');
    if (holds) { const last = legs[legs.length - 1]; const hp = rows[fh].pos;
      const res = { kind: clip ? 'clip' : 'hold', holds, move: 'Jump', desc: `A held ${h} update${h > 1 ? 's' : ''}, stick ${pol.label} after take-off`, key: 'jump',
        runYaw: last.s.yaw, runStick: [last.s.sx, last.s.sy], runN: legs.reduce((a, l) => a + l.n, 0), legs: legs.map(l => ({ yaw: l.s.yaw, stick: [l.s.sx, l.s.sy], n: l.n })),
        launch, lag: null, rows, start: o.start, cam, allInputs: ups, holdAt: hp.slice(), fromCrack: Math.hypot(hp[0] - T.x, hp[2] - T.z), score: (clip ? 1000 : 0) + holds * 10 - Math.hypot(hp[0] - T.x, hp[2] - T.z) * 0.01 };
      results.push(res); o.onResult && o.onResult(res); }
  };
  // one launch state: take off in the engine, fly with the game's float steps, test each A-hold's floor crossing
  // crossing updates for each A-hold, for a given launch height (cached): the update where the foot goes below the target height
  const crossCache = new Map();
  const crossings = (ly) => { let c = crossCache.get(ly); if (c) return c; c = [];
    for (let hi = 0; hi < holdsList.length; hi++) { const ys = VY[hi];
      for (let i = 1; i < NK; i++) { const y = F(ly + ys[i]), yp = F(ly + ys[i - 1]); if (y < yp && y <= T.y + 2 && yp >= T.y - 60) c.push([i, hi]); if (y < T.y - 80) break; } }
    crossCache.set(ly, c); return c; };
  // one launch state (Banjo running at full stick s on flat floor). The take-off update sets the speed to 500 along the stick
  // direction (bsjump_init) and the easing toward the same target adds nothing, so the flight can be stepped directly with
  // the game's float operations: no engine call per launch.
  const X = new Float64Array(NK), Z = new Float64Array(NK);
  // flight sticks for a run stick: held, let go, and a few partial presses close to the same direction (each a different glide)
  const ZM = [0.12, 0.2, 0.5, 0.75, 1.0].map(F); const zoneThv = (d) => { d = F(d); const zp = (a, b) => F(F(d - a) / F(b - a)); const it = (t, a, b) => F(F(t * F(b - a)) + a);
    if (d <= ZM[0]) return 0; if (d <= ZM[1]) return it(zp(ZM[0], ZM[1]), 30, 80); if (d <= ZM[2]) return it(zp(ZM[1], ZM[2]), 80, 150); if (d <= ZM[3]) return it(zp(ZM[2], ZM[3]), 150, 225); return it(zp(ZM[3], ZM[4]), 225, 500); };
  const polCache = new Map(); const nPartial = o.partialSticks ?? 6;
  const policies = (s) => { let L = polCache.get(s); if (L) return L; const v0 = BM.rot_yaw(s.yaw, F(500));
    L = [{ key: 'keep', stick: s, tv: [v0[0], v0[2]], label: 'held' }, { key: 'release', stick: { sx: 0, sy: 0 }, tv: [0, 0], label: 'let go' }];
    const cands = sticks().filter(q => q.d < 0.97 && q.d > 0.13).map(q => ({ q, y: yawOfStick(q.a, cam) })).map(c => ({ ...c, e: Math.abs(((c.y - s.yaw + 540) % 360) - 180) })).filter(c => c.e < 1.5);
    const bands = [0.2, 0.35, 0.5, 0.62, 0.75, 0.9]; const used = new Set();
    for (const b of bands.slice(0, nPartial)) { let best = null; for (const c of cands) { if (used.has(c.q)) continue; const sc = Math.abs(c.q.d - b) * 4 + c.e; if (!best || sc < best.sc) best = { ...c, sc }; }
      if (best) { used.add(best.q); const thv = zoneThv(best.q.d); const tv = BM.rot_yaw(best.y, thv); L.push({ key: 'p' + best.q.rx + ',' + best.q.ry, stick: { sx: best.q.rx, sy: best.q.ry }, tv: [tv[0], tv[2]], label: `at ${Math.round(best.q.d * 100)}% toward ${best.y.toFixed(1)}°` }); } }
    polCache.set(s, L); return L; };
  const tryLaunch = (P, legs) => {
    if (P.state !== S.WALK_FAST && P.state !== S.WALK && P.state !== S.WALK_SLOW && P.state !== S.WALK_CREEP) return;
    launches++; const fl = legs[legs.length - 1].s; const ly = P.pos[1]; const cr = crossings(ly); if (!cr.length) return;
    const v0 = BM.rot_yaw(fl.yaw, F(500));
    for (const pol of policies(fl)) {
      let vx = v0[0], vz = v0[2]; let x = F(P.pos[0] + F(vx * dt)), z = F(P.pos[2] + F(vz * dt)); X[0] = x; Z[0] = z;
      const tx = pol.tv[0], tz = pol.tv[1];
      for (let i = 1; i < NK; i++) { const d0 = F(F(F(tx * fr) - F(vx * fr)) * kk), d2 = F(F(F(tz * fr) - F(vz * fr)) * kk); vx = F(vx + d0); vz = F(vz + d2);
        const lx = vx, lz = vz; if (Math.abs(vx) < 0.0001) vx = 0; if (Math.abs(vz) < 0.0001) vz = 0; x = F(x + F(lx * dt)); z = F(z + F(lz * dt)); X[i] = x; Z[i] = z; }
      paths += holdsList.length;
      for (const [i, hi] of cr) { const d = sd(X[i], Z[i]);
        if (d < closest) { closest = d; closestAt = { legs: legsKey(legs), pol, h: holdsList[hi] }; }
        if (d < eps) { nearHits++; if (isGap(F(X[i]), F(Z[i]))) { gaps++; verify(legs.map(l => ({ ...l })), pol, holdsList[hi]); } } }
    }
  };
  // run with stick s from state P (ghost, flat floor), trying a jump after every update that is within reach
  const runFrom = (P0r, prefix, s, maxN) => {
    const P = clone(P0r); P.ghost = 'flat'; runs++; const path = [P.pos.slice()]; let best = 1e18;
    for (let u = 0; u < maxN; u++) {
      P.step({ sx: s.sx, sy: s.sy }, 2); path.push(P.pos.slice());
      const dx = T.x - P.pos[0], dz = T.z - P.pos[2], d2 = dx * dx + dz * dz; if (d2 < best) best = d2; else if (d2 > best + 250000) break;
      if (d2 < reach2) tryLaunch(P, [...prefix, { s, n: u + 1 }]);
    }
    return path;
  };
  const bearingFrom = (p) => (Math.atan2(T.x - p[0], T.z - p[2]) * 180 / Math.PI + 360) % 360;
  const yawsNear = (b, spread, n) => runYaws(b, cam, spread, n).map(r => ({ sx: r.sx, sy: r.sy, yaw: r.yaw }));
  const status = (stage) => `${stage} · ${(paths).toLocaleString()} exact jump paths · closest landing ${closest < 1e8 ? closest.toExponential(1) : '—'} from the seam (gap is ${gapW ? gapW.toExponential(1) : '?'} wide) · ${results.length} held`;
  // stage 1: straight runs at every full-press angle near the bearing
  const spread = o.spread ?? 45; const first = yawsNear(bearingFrom(o.start.pos), spread, 100000);
  for (let i = 0; i < first.length && !stop(); i++) { const path = runFrom(P0, [], first[i], maxRun); if (i % 40 === 0) o.onPath && o.onPath(path, 'run');
    const tk = tick(); if (tk) { prog(Math.min(0.99, (Date.now() - t0) / budget), status('Straight runs')); await tk; } }
  // stage 2 (until the time budget runs out or a route is found): two-leg run-ups. The first leg (any angle, any length) puts
  // Banjo somewhere new; the second leg runs at the target from there. Every combination is a fresh set of exact positions.
  let seed = (o.seed ?? 12345) >>> 0; const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const wide = yawsNear(bearingFrom(o.start.pos), 180, 100000);
  let round = 0;
  while (!stop() && Date.now() - t0 < budget && !(o.stopOnFirst && results.length)) {
    // one or two random legs (any angle, 1-30 updates) put Banjo somewhere new, then the last leg runs at the target
    const nLegs = 1 + (rand() < 0.5 ? 1 : 0); const prefix = []; const P = clone(P0); P.ghost = 'flat';
    for (let k = 0; k < nLegs; k++) { const s1 = wide[Math.floor(rand() * wide.length)]; const n1 = 1 + Math.floor(rand() * 30); prefix.push({ s: s1, n: n1 }); for (let u = 0; u < n1; u++) P.step({ sx: s1.sx, sy: s1.sy }, 2); }
    if (Math.hypot(T.x - P.pos[0], T.z - P.pos[2]) > 2500) continue;
    const second = yawsNear(bearingFrom(P.pos), 5, 30);
    for (const s2 of second) { const path = runFrom(P, prefix, s2, maxRun); if (runs % 300 === 0) o.onPath && o.onPath(path, 'run'); }
    round++; const tk = tick(); if (tk) { prog(Math.min(0.99, (Date.now() - t0) / budget), status('Multi-leg run-ups')); await tk; }
  }
  results.sort((a, b) => b.score - a.score || a.runN - b.runN);
  prog(1, status(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s`));
  return { results, paths, launches, runs, closest, closestAt, gaps, nearHits, gapW, verified, ms: Date.now() - t0 };
}
// "simple press": the route must still get a hold when the finishing move starts one update earlier or later
function robust(l, v, ctx, near) {
  let ok = 0;
  for (const sh of [-1, 1]) {
    const P = clone(l.P);
    if (sh < 0) { /* start one update earlier: undo is impossible, so approximate by releasing the stick for that update */ P.step({}, 2); }
    else P.step({ sx: ctx.run.sx, sy: ctx.run.sy }, 2);
    let holds = 0; for (let i = 0; i < (v.n || 60); i++) { const r = P.step(v.mk(i, ctx), 2); if (r.held && near(r.pos[0], r.pos[2]) < 3) holds++; if (v.done ? v.done(P, r, i) && i > 6 : (r.grounded && i > 6)) break; }
    if (holds) ok++;
  }
  return ok;
}
// per-update inputs of a result, from the start: the run, then the move
function routeInputs(res) {
  const ups = []; for (let i = 0; i < res.runN; i++) ups.push({ sx: res.runStick[0], sy: res.runStick[1], A: false, B: false, Z: false, frames: 2, note: `run ${res.runYaw.toFixed(3)}°` });
  res.inputs.forEach((inp) => ups.push({ sx: inp.sx || 0, sy: inp.sy || 0, A: !!inp.A, B: !!inp.B, Z: !!inp.Z, frames: inp.frames || 2, note: res.move }));
  return ups;
}
const api = { spotsOnSeam, doneOf, TROT_START, search, deepJump, edgeOf, stickFor, stickForM, sticks, runYaws, clone, MOVES, routeInputs, flatWorld, seamOf };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKSEARCH = api;
})(typeof self !== 'undefined' ? self : this);
