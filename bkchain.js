// bkchain.js -- chain search for the Bit-Clip Lab: a route from the start to the target made of whole moves, each played to the
// end and followed by standing still (like the 810 punch / punch-cancel / crouch-turn routes), then the chosen final move.
// Every move runs in the exact movement engine (bkmove.js) on the real room (bkcol.js), so every route found replays exactly.
//
// Moves (each one ends with "wait until Banjo stands still", at most 60 updates):
//   walk   stick in a direction for n updates             pause  n updates with no input (matters with moving objects)
//   turn   crouch turn: hold Z, Z + stick, Z, release     punch  B (claw)
//   cancel punch cancel: B, A on update k held h          punchZ B, then Z held (punch into crouch)
//   jump   A held h, stick held / released                bflip  Z, A held h
//   roll   run n updates, then B (twirl)                  barge  Z + B
// Search: beam search by depth. At depth d every kept standing state is expanded with every enabled move variant; the new
// standing states are deduplicated (exact position and facing bits) and the best W by distance to the target are kept. From every
// standing state close enough to the target, every variant of the final move is played to the end, and the ones where Banjo is
// held near the target (5-hit hold) are reported, with "clip" when he then goes under the floor.
(function (root) {
'use strict';
// a clip: after the first hold Banjo goes 60+ under the floor and never comes back up within 60 of it (a pop back onto the floor is not a clip)
const stayedUnder = (rows, fh, y0) => { let k = -1; for (let i = fh; i < rows.length; i++) if (rows[i].pos[1] < y0 - 60) { k = i; break; } if (k < 0) return false; for (let i = k + 1; i < rows.length; i++) if (rows[i].pos[1] >= y0 - 60) return false; return true; };
const BK = root.BK || require('./bkcol.js'); const BM = root.BKMOVE || require('./bkmove.js'); const BS = root.BKSEARCH || require('./bksearch.js');
const F = Math.fround; const S = BM.S;

const CHAIN = {
  walk: { label: 'Walk', vary: (o, d) => o.walkN.map(n => ({ n, d })), inputs: (p, c) => Array.from({ length: p.n }, () => ({ sx: c.dir(p.d).sx, sy: c.dir(p.d).sy })), desc: p => `walk ${p.d.toFixed(1)}° × ${p.n}` },
  pause: { label: 'Pause', vary: (o) => o.pauseN.map(n => ({ n })), inputs: p => Array.from({ length: p.n }, () => ({})), desc: p => `pause ${p.n}` },
  turn: { label: 'Crouch turn', vary: (o, d) => [{ d }], inputs: (p, c) => { const s = c.dir(p.d); const r = [];
      for (let i = 0; i < 15; i++) r.push({ Z: true }); for (let i = 0; i < 50; i++) r.push({ Z: true, sx: s.sx, sy: s.sy }); for (let i = 0; i < 5; i++) r.push({ Z: true }); return r; }, desc: p => `crouch turn to ${p.d.toFixed(1)}°` },
  punch: { label: 'Punch', vary: () => [{}], inputs: () => [{ B: true }], desc: () => 'punch' },
  cancel: { label: 'Punch cancel', vary: (o) => { const r = []; for (const k of o.cancelK) for (const h of o.cancelH) r.push({ k, h }); return r; },
    inputs: p => { const r = [{ B: true }]; for (let i = 1; i < p.k; i++) r.push({}); for (let i = 0; i < p.h; i++) r.push({ A: true }); return r; }, desc: p => `punch cancel (A on update ${p.k + 1}, held ${p.h})` },
  punchZ: { label: 'Punch + Z', vary: () => [{}], inputs: () => { const r = [{ B: true }]; for (let i = 0; i < 15; i++) r.push({}); for (let i = 0; i < 200; i++) r.push({ Z: true }); return r; }, desc: () => 'punch, then hold Z' },
  jump: { label: 'Jump', vary: (o, d) => { const r = []; for (const h of o.jumpH) { r.push({ h, d }); r.push({ h, d: null }); } return r; },
    inputs: (p, c) => { const s = p.d == null ? { sx: 0, sy: 0 } : c.dir(p.d); const r = []; for (let i = 0; i < 40; i++) r.push({ sx: s.sx, sy: s.sy, A: i < p.h }); return r; },
    desc: p => p.d == null ? `jump in place (A held ${p.h})` : `jump ${p.d.toFixed(1)}° (A held ${p.h})` },
  bflip: { label: 'Backflip', vary: (o) => o.jumpH.map(h => ({ h })), inputs: p => { const r = [{ Z: true }]; for (let i = 0; i < 40; i++) r.push({ Z: i < 1, A: i < p.h }); return r; }, desc: p => `backflip (A held ${p.h})` },
  roll: { label: 'Roll (twirl)', vary: (o, d) => o.rollN.map(n => ({ n, d })), inputs: (p, c) => { const s = c.dir(p.d); const r = []; for (let i = 0; i < p.n; i++) r.push({ sx: s.sx, sy: s.sy }); r.push({ sx: s.sx, sy: s.sy, B: true }); for (let i = 0; i < 20; i++) r.push({ sx: s.sx, sy: s.sy }); return r; },
    desc: p => `run ${p.d.toFixed(1)}° × ${p.n}, then roll` },
  fptwirl: { label: 'First-person twirl', vary: (o) => { const r = []; for (let k = 1; k <= (o.twirlMax ?? 15); k++) { r.push({ m: k }); r.push({ m: -k }); } return r; },
    inputs: p => [{ fp: p.m }], desc: p => `first-person twirl ${p.m > 0 ? 'left' : 'right'} ${Math.abs(p.m)} step${Math.abs(p.m) > 1 ? 's' : ''} (${(Math.abs(p.m) * 3.6).toFixed(1)}°)` },
  // talon trot: Z, Z + C-Left, Z held 16 updates (the trot starts), then Z + stick for n updates (or a trot jump), then Z released (trot exit)
  trot: { label: 'Talon trot', vary: (o, d) => o.trotN.map(n => ({ n, d })), inputs: (p, c) => { const s = c.dir(p.d); const r = trotIn();
      for (let i = 0; i < p.n; i++) r.push({ Z: true, sx: s.sx, sy: s.sy }); for (let i = 0; i < 12; i++) r.push({ Z: true }); r.push({}); return r; }, desc: p => `talon trot ${p.d.toFixed(1)}° × ${p.n}` },
  trotjump: { label: 'Trot jump', vary: (o, d) => { const r = []; for (const h of o.jumpH) { r.push({ h, d }); r.push({ h, d: null }); } return r; },
    inputs: (p, c) => { const s = p.d == null ? { sx: 0, sy: 0 } : c.dir(p.d); const r = trotIn(); for (let i = 0; i < 45; i++) r.push({ Z: true, sx: s.sx, sy: s.sy, A: i < p.h }); for (let i = 0; i < 12; i++) r.push({ Z: true }); r.push({}); return r; },
    desc: p => p.d == null ? `trot jump in place (A held ${p.h})` : `trot jump ${p.d.toFixed(1)}° (A held ${p.h})` },
  // small steps: a few updates of a light stick (creep / slow walk), the fine adjustment a crack usually needs
  creep: { label: 'Small step', vary: (o, d) => { const r = []; for (const mag of o.creepMag) for (const n of o.creepN) r.push({ d, mag, n }); return r; },
    inputs: (p, c) => { const s = c.dirM(p.d, p.mag); return Array.from({ length: p.n }, () => ({ sx: s.sx, sy: s.sy })); }, desc: p => `small step ${p.d.toFixed(1)}° (stick ${p.mag}) × ${p.n}` },
  // barges from a crouch: Z, Z + B (one update), then Z held n updates (5 = 'Z released' like 810-A step 2, 50 = 'Z kept' like step 6)
  bargeZ: { label: 'Beak barge + Z', vary: (o) => (o.bargeKeep || [50]).map(n => ({ n })), inputs: (p) => { const r = [{ Z: true }, { Z: true, B: true }]; for (let i = 0; i < p.n; i++) r.push({ Z: true }); return r; }, desc: (p) => `beak barge, Z kept ${p.n}` },
  // crouch-face to an exact facing you give (from BizHawk): the facing a camera-relative stick gives in the game
  face: { label: 'Crouch-face (exact facings)', vary: (o) => (o.faces || []).map(f => ({ f })), inputs: (p) => [{ face: p.f }], desc: (p) => `crouch-face to ${p.f}°` },
  bargeB: { label: 'Beak barge, B held', vary: () => [{}], inputs: () => { const r = [{ Z: true }, { Z: true, B: true }]; for (let i = 0; i < 12; i++) r.push({ Z: true, B: true }); for (let i = 0; i < 60; i++) r.push({ Z: true }); return r; }, desc: () => 'beak barge, B held' },
  barge: { label: 'Beak barge', vary: (o) => (o.bargeRel || [5]).map(n => ({ n })), inputs: (p) => { const r = [{ Z: true }, { Z: true, B: true }]; for (let i = 0; i < p.n; i++) r.push({ Z: true }); return r; }, desc: (p) => `beak barge, Z released after ${p.n}` },
};
function trotIn() { const r = [{ Z: true }, { Z: true, Cl: true }]; for (let i = 0; i < 16; i++) r.push({ Z: true }); return r; }
const CHAIN_UI = [['walk', 'Walk', 1], ['pause', 'Pause', 0], ['turn', 'Crouch turn', 1], ['fptwirl', 'First-person twirl', 1], ['punch', 'Punch', 1], ['cancel', 'Punch cancel', 1], ['punchZ', 'Punch + Z', 0], ['jump', 'Jump', 0], ['bflip', 'Backflip', 0], ['roll', 'Roll (twirl)', 0], ['barge', 'Beak barge', 0], ['bargeZ', 'Beak barge + Z', 0], ['face', 'Crouch-face (exact facings)', 0], ['bargeB', 'Beak barge, B held', 0], ['cface', 'Crouch-face (camera, 8 stick directions) before a punch / barge', 0], ['creep', 'Small step', 1], ['trot', 'Talon trot', 0], ['trotjump', 'Trot jump', 0]];

const still = P => P.grounded && (P.state === S.IDLE || P.state === S.LANDING) && P.vel[0] === 0 && P.vel[2] === 0;
// play inputs, then nothing until Banjo stands still; null if he never settles or falls away
function play(P, ins, maxSettle = 60, rows) {
  const y0 = P.pos[1]; let n = 0;
  for (const u of ins) { const r = P.step(u, u.frames || 2); n++; if (rows) rows.push(r); if (P.pos[1] < y0 - 400) return null; }
  for (let i = 0; i < maxSettle; i++) { if (still(P) && P.state === S.IDLE) return n; const r = P.step({}, 2); n++; if (rows) rows.push(r); if (P.pos[1] < y0 - 400) return null; }
  return still(P) ? n : null;
}
const keyOf = P => { const b = BK.bits; return b(P.pos[0]) + ',' + b(P.pos[1]) + ',' + b(P.pos[2]) + ',' + b(P.yaw); };

// ---- the search pieces, shared by the page and by each worker thread. o: {world, map, version, start:{pos,yaw,cam}, target:{x,y,z},
//      seamPts, chain:{walk:true,...}, final, depth, beam, dirs, walkN, pauseN, jumpH, rollN, cancelK, cancelH, ... (plain data)}
function setup(o) {
  const world = o.world, cam = F(o.start.cam ?? 0), T = o.target;
  const opt = Object.assign({ walkN: [1, 2, 3, 4, 6, 9], pauseN: [1, 5], jumpH: [2, 6, 14], rollN: [8, 14], cancelK: [1, 2, 3], cancelH: [1, 2, 3, 6, 14], trotN: [2, 4, 8, 14, 22], creepMag: [0.14, 0.17, 0.2, 0.3, 0.42], creepN: [1, 2, 3], dirs: 16, depth: 4, beam: 120 }, o);
  // directions: evenly spread absolute facings, each as the stick the game maps closest to it
  const yaws = Array.from({ length: opt.dirs }, (_, i) => BM.mlNormalizeAngle(F(F(cam + 180) - i * 360 / opt.dirs)));  // stick up = camera + 180, then clockwise
  const sm = new Map(); const dir = d => { let s = sm.get(d); if (!s) { s = BS.stickForM(d, cam, 1); sm.set(d, s); } return s; };
  const smM = new Map(); const dirM = (d, mag) => { const k = d + '/' + mag; let s = smM.get(k); if (!s) { s = BS.stickForM(d, cam, mag); smM.set(k, s); } return s; };
  const ctx = { dir, dirM };
  const maxUse = o.maxUse || {};
  const enabled = Object.keys(CHAIN).filter(k => o.chain ? o.chain[k] : CHAIN_UI.find(u => u[0] === k)[2]);
  const variants = []; for (const k of enabled) { const ds = ['walk', 'turn', 'jump', 'roll', 'trot', 'trotjump', 'creep'].includes(k) ? yaws : [0];
    const seen = new Set(); for (const d of ds) for (const p of CHAIN[k].vary(opt, d)) { const id = k + JSON.stringify(p); if (seen.has(id)) continue; seen.add(id); variants.push({ k, p, label: CHAIN[k].label, desc: CHAIN[k].desc(p), ins: CHAIN[k].inputs(p, ctx) }); } }
  // crouch-face (810 searches): crouch, stick in one of 8 directions; the facing comes from the static camera, which settles on
  // Banjo after every move. Each punch / punch cancel / punch + Z / barge gets 8 versions that start with a crouch-face.
  const G0 = typeof self !== 'undefined' ? self : globalThis; const EXm = G0.BKEXACT || (typeof require !== 'undefined' ? require('./bkexact.js') : null);
  const cfOn = !!(o.chain && o.chain.cface) && isFinite(o.camX) && isFinite(o.camZ) && EXm;
  const CAM = cfOn ? EXm.make({ camX: o.camX, camZ: o.camZ, floorOK: () => true }) : null;
  const cam0 = cfOn ? (o.cam0 == null || o.cam0 === '' || !isFinite(+o.cam0) ? CAM.camyaw(F(o.start.pos[0]), F(o.start.pos[2])) : F(+o.cam0)) : 0;
  if (cfOn) { const base = variants.filter(v => ['punch', 'cancel', 'punchZ', 'barge', 'bargeZ', 'bargeB'].includes(v.k));
    for (const v of base) for (let d = 0; d < 8; d++) variants.push({ k: v.k, p: Object.assign({}, v.p, { cf: d }), label: v.label, cf: d, base: v, desc: `crouch-face ${EXm.DN[d]}, ${v.desc}`, ins: null }); }
  // final move variants (bksearch finishing moves; stick 'keep' = toward the target from where Banjo stands)
  const simple = o.strict === 'simple';
  const fo = { aHolds: simple ? [1, 3, 6, 10, 14] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20], aHoldsShort: simple ? [2, 8] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14],
    busterAt: simple ? [4, 7, 10] : [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14], busterAtFlip: simple ? [14, 18, 22] : [12, 14, 16, 18, 20, 22, 24],
    aHoldsFlip: simple ? [3, 30] : [1, 2, 3, 4, 6, 8, 11, 14, 20, 30], cancelAt: simple ? [2, 5, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14] };
  const finals = []; const FK = o.goal === 'reach' ? [] : o.final && o.final !== 'auto' ? [o.final] : Object.keys(BS.MOVES).filter(k => !o.moves || o.moves[k]);
  for (const k of FK) { if (k === 'punch') { finals.push({ k, label: 'Punch', desc: 'punch', mk: (i) => ({ B: i === 0 }), n: 40, done: (P, r, i) => r.grounded && i > 4 }); continue; }
    const M = BS.MOVES[k]; if (!M) continue;
    for (const p of M.params(fo)) { const mk = M.input(p); const done = BS.doneOf(M, p); finals.push({ k, label: M.label, desc: M.desc(p), mk, n: M.n || 60, done });
      if (M.noStickVariant === false) continue;
      // the same inputs with the stick left neutral (standing-still setups like the 810 punch cancel use no stick)
      const c0 = { run: { sx: 0, sy: 0 }, back: { sx: 0, sy: 0 } }; let usesStick = false; for (let i = 0; i < 60 && !usesStick; i++) { const u = mk(i, { run: { sx: 1, sy: 1 }, back: { sx: 1, sy: 1 } }); if (u.sx || u.sy) usesStick = true; }
      if (usesStick) finals.push({ k, label: M.label, desc: M.desc(p).replace(/,? ?stick (held|released|keep|none|back)/, '') + ', no stick', mk: (i) => mk(i, c0), n: M.n || 60, done }); } }
  // the final move can start after a short wait (standing still for w updates first changes the result: the 810 N2 clip needs it)
  { const waits = o.finalWait || [0, 1, 2]; const base = finals.splice(0);
    for (const w of waits) for (const f of base) finals.push(w ? { ...f, desc: `wait ${w}, then ${f.desc}`, mk: (i, c) => i < w ? {} : f.mk(i - w, c), done: (P, r, i) => i >= w && f.done(P, r, i - w), n: f.n + w, w } : { ...f, w: 0 }); }
  const seam = BS.edgeOf(world, o.seamPts);
  // "where on the seam": anywhere on it, or within o.alongMax of the picked crack (0.01 = that exact spot)
  const aMax = o.alongMax ?? Infinity; const tT = seam ? (T.x - seam.ax) * seam.ux + (T.z - seam.az) * seam.uz : 0;
  // only at the seam's bit-clip spots: distance to the nearest spot (along and across the seam)
  const SP = BS.spotsOnSeam && seam ? BS.spotsOnSeam(seam, o.spotPts, o.spotTol ?? 0.2) : null;
  const sd = (x, z) => { if (!seam) return Math.hypot(x - T.x, z - T.z); const rx = x - seam.ax, rz = z - seam.az; const t = rx * seam.ux + rz * seam.uz;
    const lo = isFinite(aMax) ? Math.max(0, tT - aMax) : 0, hi = isFinite(aMax) ? Math.min(seam.len, tT + aMax) : seam.len;
    let tc = Math.max(lo, Math.min(hi, t)); if (SP) { const ns = SP.nearestT(t); if (Math.abs(ns - t) > (o.spotTol ?? 0.2)) tc = ns; } return Math.hypot(rx - tc * seam.ux, rz - tc * seam.uz); };
  // goal 'reach': no final move, no clip: a route that leaves Banjo standing within o.reachTol of the target point (and facing
  // o.reachFacing ± o.reachFacingTol when given)
  const reachMode = o.goal === 'reach'; const reachTol = o.reachTol ?? 1; const rFace = o.reachFacing == null || o.reachFacing === '' ? null : +o.reachFacing; const rFaceTol = o.reachFacingTol ?? 1;
  const sdR = (p) => Math.hypot(p[0] - T.x, p[2] - T.z) + (Math.abs(p[1] - T.y) > 60 ? Math.abs(p[1] - T.y) : 0);
  const faceOK = (y) => rFace == null || Math.abs(((y - rFace) % 360 + 540) % 360 - 180) <= rFaceTol;
  const alongOK = (x, z) => { if (!seam) return true; const t = (x - seam.ax) * seam.ux + (z - seam.az) * seam.uz; if (isFinite(aMax) && Math.abs(t - tT) > aMax) return false; return !SP || SP.okT(t); };
  // how far each final move can carry Banjo (flat floor, from standing): only standing states that close are tried
  let reach = 0; { const FW = BS.flatWorld(); for (const f of finals) { const P = new BM.Player(FW, { map: 0, pos: [0, 0, 0], yaw: 0, cam, version: o.version, grounded: true, state: S.IDLE });
      const c = { run: dir(0), back: dir(180) }; const inp = f.mk; for (let i = 0; i < f.n; i++) { P.step(inp(i, c), 2); reach = Math.max(reach, Math.hypot(P.pos[0], P.pos[2])); } } }
  reach = reach * 1.5 + 60;  // the reach is measured on a flat floor; downhill and off ledges a move carries further
  const P0 = new BM.Player(world, { map: o.map, pos: o.start.pos, vel: [0, 0, 0], yaw: o.start.yaw ?? 0, cam, version: o.version, grounded: true, state: S.IDLE });
  // the standing state after a list of inputs (every input played with its own frame count, as play() did)
  const replay = (ins) => { const P = BS.clone(P0); for (const u of ins) P.step(u, u.frames || 2); return P; };
  // every enabled move variant from standing state P (camera yaw cam); children: {vi, n (updates incl. settling), key, pos, yaw, cam, ins?, desc?, Q, rows}
  function expand(P, counts, keep, cam) { const out = []; let sims = 0;
    for (let vi = 0; vi < variants.length; vi++) { const v = variants[vi]; if (maxUse[v.k] != null && (counts[v.k] || 0) >= maxUse[v.k]) continue;
      let vins = v.ins, y = null;
      if (v.cf != null) { y = CAM.cfyaw(F(cam), v.cf); if (Math.abs(EXm.adiff(P.yaw, y)) < 8) continue; vins = [{ face: y }].concat(v.base.ins); }  // a crouch-face needs a real turn (8°+)
      const Q = BS.clone(P); const rows = []; const n = play(Q, vins, 60, rows); sims += rows.length; if (n == null) continue;
      const c = { vi, n, key: keyOf(Q), pos: Q.pos.slice(), yaw: Q.yaw, cam: CAM ? CAM.camnext(F(cam), Q.pos[0], Q.pos[2]) : 0 };
      if (v.cf != null) { c.ins = vins; c.desc = `crouch-face ${EXm.DN[v.cf]} (facing ${y.toFixed(6)}°), ${v.base.desc}`; }
      if (keep) { c.Q = Q; c.rows = rows; } out.push(c); }
    return { out, sims }; }
  // every final move from standing state P (node: {ins, steps, path}); returns the holds / clips found
  function finalsAt(P, node, stop) { const res = []; let tried = 0, sims = 0, closest = 1e9;
    if (sd(P.pos[0], P.pos[2]) > reach) return { res, tried, sims, closest };
    const bear = (Math.atan2(T.x - P.pos[0], T.z - P.pos[2]) * 180 / Math.PI + 360) % 360; const c = { run: dir(Math.round(bear * 1000) / 1000), back: dir((Math.round(bear * 1000) / 1000 + 180) % 360) };
    // with crouch-faces on, every final move is also tried after a crouch-face (the 810 routes end with one before the cancel)
    let FL = finals; if (cfOn) { FL = finals.slice(); for (let d = 0; d < 8; d++) { const y = CAM.cfyaw(F(node.cam ?? cam0), d); if (Math.abs(EXm.adiff(P.yaw, y)) < 8) continue;
        for (const f of finals) FL.push({ ...f, desc: `crouch-face ${EXm.DN[d]} (facing ${y.toFixed(6)}°), then ${f.desc}`, mk: (i, cc) => i === 0 ? { face: y } : f.mk(i - 1, cc), done: (Q, r, i) => i >= 1 && f.done(Q, r, i - 1), n: f.n + 1 }); } }
    for (const f of FL) { if (stop && stop()) break; const Q = BS.clone(P); const rows = []; const ups = []; let fh = -1;
      for (let i = 0; i < f.n; i++) { const u = f.mk(i, c); ups.push(u); const r = Q.step(u, 2); sims++; rows.push(r); const d = sd(r.pos[0], r.pos[2]); if (d < closest && Math.abs(r.pos[1] - T.y) < 60) closest = d;
        if (r.held && fh < 0 && d < 3 && alongOK(r.pos[0], r.pos[2])) fh = i; if (fh < 0 && r.pos[1] > T.y - 5 && f.done(Q, r, i) && i > 4) break; if (r.pos[1] < T.y - 400) break; }
      tried++;
      if (fh >= 0) { let holds = rows.filter(r => r.held).length; let clip = stayedUnder(rows, fh, T.y); const hp = rows[fh].pos;
        let allInputs = node.ins.concat(ups); let lag = null; let rowsOut = rows;
        // a hold that does not clip: try one 3-frame (lag) update on each of the 4 updates from the first hold
        if (!clip && o.lag) for (let L = fh; L < fh + 4 && !clip; L++) { const Q2 = BS.clone(P); const r2 = []; const u2 = [];
          for (let i = 0; i < f.n; i++) { const u = Object.assign({}, f.mk(i, c)); if (i === L) u.frames = 3; u2.push(u); const r = Q2.step(u, u.frames || 2); sims++; r2.push(r); if (r.pos[1] < T.y - 400) break; }
          if (stayedUnder(r2, fh, T.y)) { clip = true; lag = L; rowsOut = r2; allInputs = node.ins.concat(u2); holds = r2.filter(r => r.held).length; } }
        res.push({ kind: clip ? 'clip' : 'hold', holds, move: f.label, desc: f.desc, key: f.k, chain: node.steps.concat([`${f.label}: ${f.desc}`]),
          rows: [], path: [...node.path, ...rowsOut.map(r => r.pos)], start: o.start, cam, allInputs, holdAt: hp.slice(), fromCrack: Math.hypot(hp[0] - T.x, hp[2] - T.z), lag: lag == null ? null : lag - fh, lagAt: lag, legs: null,
          moves: node.steps.length + 1, updates: allInputs.length, frames: allInputs.reduce((a, u) => a + (u.fp ? 86 + 2 * Math.abs(u.fp) : (u.frames || 2)), 0),  // a first-person twirl: C-Up, 50, 2|m| of stick, 4, C-Up, 30 frames
          score: (clip ? 1000 : 0) + holds * 10 - node.steps.length - Math.hypot(hp[0] - T.x, hp[2] - T.z) * 0.01 }); } }
    return { res, tried, sims, closest }; }
  return { o, opt, cam, cam0, cfOn, T, variants, finals, sd, sdR, faceOK, reachMode, reachTol, P0, replay, expand, finalsAt };
}

// ---- a pool of worker threads (chainworker.js), each with its own copy of the room and of setup()
function makeChainPool(n, init, url) {
  const ws = []; for (let i = 0; i < n; i++) { const w = new Worker(url || 'chainworker.js'); w.postMessage({ type: 'init', o: init }); ws.push({ w, busy: false }); }
  const queue = []; const pump = () => { for (const x of ws) { if (x.busy || !queue.length) continue; const t = queue.shift(); x.busy = true; x.cur = t; x.w.postMessage(t.msg); } };
  for (const x of ws) { x.w.onmessage = (e) => { const t = x.cur; x.busy = false; x.cur = null; pump(); if (e.data && e.data.error) t.reject(new Error(e.data.error)); else t.resolve(e.data); };
    x.w.onerror = (e) => { e.preventDefault && e.preventDefault(); const t = x.cur; x.busy = false; x.cur = null; if (t) t.reject(new Error(e.message || 'worker error')); pump(); }; }
  return { size: n, run: (msg) => new Promise((resolve, reject) => { queue.push({ msg, resolve, reject }); pump(); }), clear: () => { queue.length = 0; }, terminate: () => { for (const x of ws) x.w.terminate(); } };
}

// o: setup() options + {seconds, objective, onPath, onResult, onProgress, shouldStop, threads, roomData (for the threads),
//     beam (0 = keep every standing spot), keep ('spread' | 'near'), widen (repeat with a doubled beam until the time is up)}
async function chainSearch(o) {
  const t0 = Date.now(); const until = t0 + (o.seconds ?? 300) * 1000; const userStop = o.shouldStop;
  // threads once for every round
  let pool = null; const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1; const nT = Math.max(0, Math.min(o.threads ?? (hc - 1), 32));
  if (nT > 1 && o.roomData && typeof Worker !== 'undefined') { try { const init = {}; for (const [k, v] of Object.entries(o)) if (typeof v !== 'function' && k !== 'world' && k !== 'pool') init[k] = v; pool = makeChainPool(nT, init, o.workerUrl); } catch (e) { pool = null; } }
  const seenRes = new Set(); let out = null; let beam = o.beam === 0 ? 0 : (o.beam || 120); let round = 1; const all = [];
  try {
    for (;;) {
      const r = await chainSearchOnce(Object.assign({}, o, { beam, pool, t0: Date.now(), secondsLeft: (until - Date.now()) / 1000, round,
        onResult: (res) => { const k = res.chain.join('|') + '|' + (res.lag ?? '') + '|' + res.kind; if (seenRes.has(k)) return; seenRes.add(k); all.push(res); o.onResult && o.onResult(res); },
        onProgress: (f, t) => o.onProgress && o.onProgress(f, (o.widen && beam ? `Round ${round} (keeping ${beam.toLocaleString()} per step) · ` : '') + t) }));
      out = r; if (!o.widen || !beam || r.exhausted || Date.now() > until - 1000 || (userStop && userStop())) break;
      beam *= 2; round++; }
  } finally { if (pool) pool.terminate(); }
  out.results = all; return out;
}

async function chainSearchOnce(o) {
  const t0 = Date.now(); const until = t0 + (o.secondsLeft ?? o.seconds ?? 300) * 1000;
  const stop = () => o.shouldStop && o.shouldStop() || Date.now() > until; const prog = (f, t) => o.onProgress && o.onProgress(f, t);
  let lastYield = Date.now(); const tick = () => { if (Date.now() - lastYield < 80) return null; return new Promise(r => setTimeout(() => { lastYield = Date.now(); r(); }, 0)); };
  const C = setup(o); const { opt, variants, sd, sdR, faceOK, reachMode, reachTol, P0 } = C;
  const objective = o.objective === 'time' ? 'time' : 'moves'; let best = Infinity; const metric = (steps, nIns) => objective === 'time' ? nIns : steps;
  // worker threads: every core but one, unless o.threads says otherwise (1 = none)
  const pool = o.pool || null;
  const thr = pool ? ` · ${pool.size} threads` : '';
  const results = []; let tried = 0, sims = 0, closest = 1e9; const seen = new Set([keyOf(P0)]);
  const addRes = (res) => { if (res.kind === 'clip') best = Math.min(best, metric(res.moves, res.updates)); const path = res.path; delete res.path; results.push(res); o.onResult && o.onResult(res); o.onPath && o.onPath(path, res.kind === 'clip' ? 'clip' : 'hold'); };
  const tryFinalsLevel = async (nodes) => {
    if (!pool) { for (const node of nodes) { if (stop()) break; const r = C.finalsAt(node.P, node, stop); tried += r.tried; sims += r.sims; closest = Math.min(closest, r.closest); for (const x of r.res) addRes(x); await tick(); } return; }
    const jobs = []; for (let i = 0; i < nodes.length; i += 4) { const sl = nodes.slice(i, i + 4).map(n => ({ ins: n.ins, steps: n.steps, path: n.path, cam: n.cam }));
      jobs.push(pool.run({ type: 'finals', nodes: sl }).then(r => { tried += r.tried; sims += r.sims; closest = Math.min(closest, r.closest); for (const x of r.res) addRes(x); })); }
    let fin = false; Promise.all(jobs).then(() => { fin = true; }, () => { fin = true; }); while (!fin) { if (stop()) { pool.clear(); break; } await new Promise(r => setTimeout(r, 60)); } };
  let level = [{ P: P0, ins: [], steps: [], counts: {}, path: [P0.pos.slice()], cam: C.cam0 }];
  const reachCheck = (node, pos, yaw) => { const d = sdR(pos); if (d < closest) closest = d;
    if (d > reachTol || !faceOK(yaw)) return;
    const res = { kind: 'reach', holds: 0, move: 'Reached the spot', desc: `stands ${d < 0.001 ? d.toExponential(2) : d.toFixed(3)} from the target, facing ${yaw.toFixed(3)}°`, key: 'reach', chain: node.steps.slice(),
      rows: [], start: o.start, cam: C.cam, allInputs: node.ins.slice(), holdAt: pos.slice(), fromCrack: d, lag: null, lagAt: null, legs: null, standYaw: yaw,
      moves: node.steps.length, updates: node.ins.length, frames: node.ins.reduce((a, u) => a + (u.fp ? 86 + 2 * Math.abs(u.fp) : (u.frames || 2)), 0), score: 1000 - node.steps.length - d };
    results.push(res); best = Math.min(best, metric(res.moves, res.updates) + 1); o.onResult && o.onResult(res); o.onPath && o.onPath(node.path, 'hold'); };
  let pruned = false;
  if (reachMode) reachCheck(level[0], P0.pos, P0.yaw); else await tryFinalsLevel(level);
  const pmsg = (d, done, total) => `Depth ${d} of ${opt.depth}: ${done.toLocaleString()} of ${total.toLocaleString()} moves · ${seen.size.toLocaleString()} standing spots · ${reachMode ? '' : `${tried.toLocaleString()} final moves tried · `}${results.length} found · closest ${closest < 1e8 ? closest.toExponential(1) : '—'} from the ${reachMode ? 'target' : 'seam'}${thr}`;
  try {
  for (let d = 1; d <= opt.depth && !stop(); d++) {
    const next = []; const total = level.length * variants.length; const live = level.filter(node => metric(node.steps.length + 1, node.ins.length) < best);  // can't beat a clip already found
    // expand every node of the level (on the threads: they replay the node's inputs, then try every move variant)
    const kids = new Array(live.length); let done = 0;
    if (pool) { const jobs = []; const CH = Math.max(1, Math.round(240 / Math.max(1, variants.length)));
      for (let i = 0; i < live.length; i += CH) { const idx = i; const sl = live.slice(i, i + CH).map(n => ({ ins: n.ins, counts: n.counts, cam: n.cam }));
        jobs.push(pool.run({ type: 'expand', nodes: sl }).then(r => { r.kids.forEach((k, j) => { kids[idx + j] = k; }); sims += r.sims; done += sl.length * variants.length; prog((d - 1 + done / Math.max(1, total)) / opt.depth, pmsg(d, done, total)); })); }
      let fin = false; Promise.all(jobs).then(() => { fin = true; }, () => { fin = true; }); while (!fin) { if (stop()) { pool.clear(); break; } await new Promise(r => setTimeout(r, 60)); }
    } else {
      for (let i = 0; i < live.length && !stop(); i++) { const r = C.expand(live[i].P, live[i].counts, true, live[i].cam); kids[i] = r.out; sims += r.sims; done += variants.length; prog((d - 1 + done / Math.max(1, total)) / opt.depth, pmsg(d, done, total)); await tick(); } }
    if (stop() && !kids.some(Boolean)) break;
    // merge in node order (the same order as one thread), dropping standing spots seen before
    for (let i = 0; i < live.length; i++) { const node = live[i]; const ks = kids[i]; if (!ks) continue;
      for (const c of ks) { if (seen.has(c.key)) continue; seen.add(c.key); const v = variants[c.vi];
        const vins = c.ins || v.ins; const ins = node.ins.concat(vins, Array.from({ length: c.n - vins.length }, () => ({})));
        const child = { P: c.Q || null, cam: c.cam, ins, steps: node.steps.concat([c.desc || v.desc]), counts: { ...node.counts, [v.k]: (node.counts[v.k] || 0) + 1 },
          path: c.rows ? node.path.concat(c.rows.map(r => r.pos)) : node.path.concat([c.pos]), dist: reachMode ? sdR(c.pos) : sd(c.pos[0], c.pos[2]), yaw: c.yaw, pos: c.pos };
        if (reachMode) reachCheck(child, c.pos, c.yaw);
        next.push(child); } }
    next.sort((a, b) => a.dist - b.dist || (objective === 'time' ? a.ins.length - b.ins.length : 0));
    // which standing spots go on: all of them (beam 0), the nearest W (at most W/4 per facing), or (spread, the default) half
    // the nearest and half spread over the room: the nearest spot of every 25-unit cell and 45° facing, so routes that first
    // move away from the target (like 810-A's barge east) survive
    const W = opt.beam; level = []; 
    if (!W) level = next;
    else { const per = new Map(); const taken = new Set(); const nearN = o.keep === 'near' ? W : Math.ceil(W / 2);
      for (let i = 0; i < next.length && level.length < nearN; i++) { const c = next[i]; const f = Math.round(c.yaw * 10); const m = per.get(f) || 0; if (m >= Math.max(4, W / 4)) continue; per.set(f, m + 1); level.push(c); taken.add(i); }
      if (o.keep !== 'near' && level.length < W) { const cells = new Map();
        for (let i = 0; i < next.length; i++) { if (taken.has(i)) continue; const c = next[i]; const ck = Math.floor(c.pos[0] / 25) + ',' + Math.floor(c.pos[2] / 25) + ',' + Math.floor(c.yaw / 45);
          if (!cells.has(ck)) cells.set(ck, i); }
        const pick = [...cells.values()];  // nearest per cell (next is sorted)
        // more cells than room: take them spread evenly over the distance order
        const step = Math.max(1, pick.length / (W - level.length)); for (let q = 0; q < pick.length && level.length < W; q += step) { const i = pick[Math.floor(q)]; level.push(next[i]); taken.add(i); }
        for (let i = 0; i < next.length && level.length < W; i++) if (!taken.has(i)) { level.push(next[i]); taken.add(i); } } }
    if (level.length < next.length) pruned = true;
    o.onLevel && o.onLevel(level, d, next);
    for (const c of level.slice(0, 40)) o.onPath && o.onPath(c.path, 'run');
    if (!reachMode && !stop()) await tryFinalsLevel(level);
  }
  } finally { }
  prog(1, `Done: ${seen.size.toLocaleString()} standing spots reached, ${reachMode ? '' : `${tried.toLocaleString()} final moves tried, `}${results.length} found${closest < 1e8 ? ` · closest ${closest.toExponential(1)} from the ${reachMode ? 'target' : 'seam'}` : ''} · ${((Date.now() - t0) / 1000).toFixed(0)} s${thr}`);
  return { results, closest, tried, spots: seen.size, sims, exhausted: !pruned && !stop() };
}

const api = { chainSearch, setup, makeChainPool, CHAIN, CHAIN_UI, play };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKCHAIN = api;
})(typeof self !== 'undefined' ? self : this);
