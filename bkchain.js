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
const CHAIN_UI = [['walk', 'Walk', 1], ['pause', 'Pause', 0], ['turn', 'Crouch turn', 1], ['fptwirl', 'First-person twirl', 1], ['punch', 'Punch', 1], ['cancel', 'Punch cancel', 1], ['punchZ', 'Punch + Z', 0], ['jump', 'Jump', 0], ['bflip', 'Backflip', 0], ['roll', 'Roll (twirl)', 0], ['barge', 'Beak barge', 1], ['bargeZ', 'Beak barge + Z', 0], ['face', 'Crouch-face (exact facings)', 0], ['bargeB', 'Beak barge, B held', 0], ['cface', 'Crouch-face (camera, 8 stick directions) before a punch / barge', 0], ['creep', 'Small step', 1], ['trot', 'Talon trot', 0], ['trotjump', 'Trot jump', 0]];

const still = P => P.grounded && (P.state === S.IDLE || P.state === S.LANDING) && P.vel[0] === 0 && P.vel[2] === 0;
// play inputs, then nothing until Banjo stands still; null if he never settles or falls away
function play(P, ins, maxSettle = 60, rows) {
  const y0 = P.pos[1]; let n = 0;
  for (const u of ins) { const r = P.step(u, u.frames || 2); n++; if (rows) rows.push(r); if (P.pos[1] < y0 - 400) return null; }
  for (let i = 0; i < maxSettle; i++) { if (still(P) && P.state === S.IDLE) return n; const r = P.step({}, 2); n++; if (rows) rows.push(r); if (P.pos[1] < y0 - 400) return null; }
  return still(P) ? n : null;
}
// the standing state that matters for what comes next: position, facing (actual, ideal and target), action state, timers,
// and the camera when the search tracks it (two states with the same spot and facing but a different camera are different)
const keyOf = (P, cam) => { const b = BK.bits; return b(P.pos[0]) + ',' + b(P.pos[1]) + ',' + b(P.pos[2]) + ',' + b(P.yaw) + ',' + b(P.ideal) + ',' + b(P.tyaw) + ',' + P.state + ',' + b(P.slopeTimer || 0) + ',' + b(P.stateTimer5 || 0) + ',' + b(P.stateTimer6 || 0) + (cam == null ? '' : ',' + b(cam)); };
const DIR_KINDS = ['walk', 'turn', 'jump', 'roll', 'trot', 'trotjump', 'creep'];
const TW_COARSE = new Set([1, 2, 3, 5, 8, 13, 21, 34, 50]);

// ---- the search pieces, shared by the page and by each worker thread. o: {world, map, version, start:{pos,yaw,cam,vel,air},
//      target:{x,y,z}, seamPts, spotPts, chain:{walk:true,...}, final, depth, beam, dirs, walkN, ..., camX, camZ, cam0, camFollow}
function setup(o) {
  const world = o.world, T = o.target;
  const opt = Object.assign({ walkN: [1, 2, 3, 4, 6, 9], pauseN: [1, 5], jumpH: [2, 6, 14], rollN: [8, 14], cancelK: [1, 2, 3], cancelH: [1, 2, 3, 6, 14], trotN: [2, 4, 8, 14, 22], creepMag: [0.14, 0.17, 0.2, 0.3, 0.42], creepN: [1, 2, 3], dirs: 16, depth: 4, beam: 120 }, o);
  // the static camera model (810 searches): yaw toward a fixed point, settling on Banjo after every move. With it, crouch-faces
  // use the camera's facings and (camFollow) every stick direction is converted with the camera of that moment.
  const G0 = typeof self !== 'undefined' ? self : globalThis; const EXm = G0.BKEXACT || (typeof require !== 'undefined' ? require('./bkexact.js') : null);
  const camOn = isFinite(o.camX) && isFinite(o.camZ) && !!EXm; const CAM = camOn ? EXm.make({ camX: o.camX, camZ: o.camZ, floorOK: () => true }) : null;
  const cam0 = camOn ? (o.cam0 == null || o.cam0 === '' || !isFinite(+o.cam0) ? CAM.camyaw(F(o.start.pos[0]), F(o.start.pos[2])) : F(+o.cam0)) : F(o.start.cam ?? 0);
  const cfOn = camOn && !!(o.chain && o.chain.cface); const follow = camOn && !!o.camFollow;
  const cam = F(o.start.cam ?? 0);  // the engine's camera yaw for sticks when the camera is not followed
  // directions: evenly spread absolute facings; each becomes the stick the game maps closest to it for a given camera yaw
  const yaws = Array.from({ length: opt.dirs }, (_, i) => BM.mlNormalizeAngle(F(F((follow ? cam0 : cam) + 180) - i * 360 / opt.dirs)));
  const stickCache = new Map(); const stick = (d, c, mag) => { const k = d + '|' + c + '|' + mag; let s = stickCache.get(k); if (!s) { s = BS.stickForM(d, c, mag); if (stickCache.size > 20000) stickCache.clear(); stickCache.set(k, s); } return s; };
  const ctxFor = (c) => ({ dir: d => stick(d, c, 1), dirM: (d, mag) => stick(d, c, mag) });
  const ctx0 = ctxFor(cam);
  const maxUse = o.maxUse || {};
  const enabled = Object.keys(CHAIN).filter(k => o.chain ? o.chain[k] : CHAIN_UI.find(u => u[0] === k)[2]);
  // coarse variants are tried from every state; fine ones (all twirl steps, light small steps) only around the most promising states
  const variants = []; for (const k of enabled) { const ds = DIR_KINDS.includes(k) ? yaws : [0];
    const seen = new Set(); for (const d of ds) for (const p of CHAIN[k].vary(opt, d)) { const id = k + JSON.stringify(p); if (seen.has(id)) continue; seen.add(id);
      const fine = (k === 'fptwirl' && !TW_COARSE.has(Math.abs(p.m))) || (k === 'creep' && !(p.mag >= 0.2 && (p.n === 1 || p.n === 3)));
      const dyn = follow && DIR_KINDS.includes(k) && p.d != null;
      variants.push({ k, p, label: CHAIN[k].label, desc: CHAIN[k].desc(p), ins: dyn ? null : CHAIN[k].inputs(p, ctx0), dyn, fine }); } }
  if (cfOn) { const base = variants.filter(v => ['punch', 'cancel', 'punchZ', 'barge', 'bargeZ', 'bargeB'].includes(v.k));
    for (const v of base) for (let d = 0; d < 8; d++) variants.push({ k: v.k, p: Object.assign({}, v.p, { cf: d }), label: v.label, cf: d, base: v, desc: `crouch-face ${EXm.DN[d]}, ${v.desc}`, ins: null, fine: v.fine }); }
  // final move variants (bksearch finishing moves; stick 'keep' = toward the target from where Banjo stands)
  const simple = o.strict === 'simple';
  const fo = { aHolds: simple ? [1, 3, 6, 10, 14] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20], aHoldsShort: simple ? [2, 8] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14],
    busterAt: simple ? [4, 7, 10] : [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14], busterAtFlip: simple ? [14, 18, 22] : [12, 14, 16, 18, 20, 22, 24],
    aHoldsFlip: simple ? [3, 30] : [1, 2, 3, 4, 6, 8, 11, 14, 20, 30], cancelAt: simple ? [2, 5, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14] };
  const finals = []; const FK = o.goal === 'reach' ? [] : o.final && o.final !== 'auto' ? [o.final] : Object.keys(BS.MOVES).filter(k => !o.moves || o.moves[k]);
  for (const k of FK) { if (k === 'punch') { finals.push({ k, label: 'Punch', desc: 'punch', mk: (i) => ({ B: i === 0 }), n: 40, done: (P, r, i) => r.grounded && i > 4, stick: false }); continue; }
    const M = BS.MOVES[k]; if (!M) continue;
    for (const p of M.params(fo)) { const mk = M.input(p); const done = BS.doneOf(M, p);
      const c1 = { run: { sx: 1, sy: 1 }, back: { sx: 1, sy: 1 } }; let usesStick = false; for (let i = 0; i < 60 && !usesStick; i++) { const u = mk(i, c1); if (u.sx || u.sy) usesStick = true; }
      finals.push({ k, label: M.label, desc: M.desc(p), mk, n: M.n || 60, done, stick: usesStick });
      if (M.noStickVariant === false || !usesStick) continue;
      // the same inputs with the stick left neutral (standing-still setups like the 810 punch cancel use no stick)
      const c0 = { run: { sx: 0, sy: 0 }, back: { sx: 0, sy: 0 } };
      finals.push({ k, label: M.label, desc: M.desc(p).replace(/,? ?stick (held|released|keep|none|back)/, '') + ', no stick', mk: (i) => mk(i, c0), n: M.n || 60, done, stick: false }); } }
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
  // ---- the finishing region. Each final move is played once on a flat floor from standing at the origin, facing +z (stick
  // toward +z when it uses the stick). Every update with the feet at floor height is a "contact": where the move could put
  // Banjo onto a crack. From a standing state, a final move can only work if one of its contacts, turned to the facing it would
  // have (Banjo's facing, a crouch-face facing, or the bearing to the target for stick moves), lands on the seam / spots.
  const FW = BS.flatWorld(); const fcam = F(0);
  for (const f of finals) { const P = new BM.Player(FW, { map: 0, pos: [0, 0, 0], yaw: 0, cam: fcam, version: o.version, grounded: true, state: S.IDLE });
    const c = { run: BS.stickForM(0, fcam, 1), back: BS.stickForM(180, fcam, 1) }; const seenC = new Set(); f.contacts = [];
    for (let i = 0; i < f.n; i++) { P.step(f.mk(i, c), 2); if (P.pos[1] <= 1.0) { const kx = Math.round(P.pos[0] * 4), kz = Math.round(P.pos[2] * 4); const kk = kx + ',' + kz; if (!seenC.has(kk)) { seenC.add(kk); f.contacts.push([P.pos[0], P.pos[2]]); } } } }
  // finals grouped by (stick, contacts) so the heuristic checks each distinct contact set once
  const cgroups = new Map(); for (const f of finals) { const key = (f.stick ? 'S' : 'F') + f.contacts.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(';'); let g = cgroups.get(key); if (!g) cgroups.set(key, g = { stick: f.stick, contacts: f.contacts, finals: [] }); g.finals.push(f); }
  const CG = [...cgroups.values()];
  const rot = (cx, cz, yaw) => { const r = yaw * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r); return [cx * cs + cz * sn, -cx * sn + cz * cs]; };
  // the facings a final can be played with from (pos, yaw, camera): its own, and the 8 crouch-face facings
  const finalFacings = (P, camv) => { const ys = [P.yaw]; if (cfOn) for (let d = 0; d < 8; d++) { const y = CAM.cfyaw(F(camv), d); if (Math.abs(EXm.adiff(P.yaw, y)) >= 8) ys.push(y); } return ys; };
  const contactErr = (g, x, z, yaw) => { let best = 1e9; for (const [cx, cz] of g.contacts) { const [ox, oz] = rot(cx, cz, yaw); const e = sd(x + ox, z + oz); if (e < best) best = e; } return best; };
  // H: the smallest predicted miss of any final move from this standing state (0 = some final move's contact is on a spot)
  function H(P, camv) { if (reachMode) return sdR(P.pos); return Hxz(P.pos[0], P.pos[2], P.yaw, camv); }
  function Hxz(x, z, yaw, camv) { if (reachMode) return Math.hypot(x - T.x, z - T.z); if (!finals.length) return sd(x, z);
    const bear = (Math.atan2(T.x - x, T.z - z) * 180 / Math.PI + 360) % 360; const ys = finalFacings({ yaw }, camv); let best = 1e9;
    for (const g of CG) { if (g.stick) { const e = contactErr(g, x, z, bear); if (e < best) best = e; } else for (const y of ys) { const e = contactErr(g, x, z, y); if (e < best) best = e; } if (best < 0.05) break; }
    return best; }
  // one move of look-ahead: every setup move played once on the flat floor from standing at the origin. A move with a stick
  // direction goes the same way whatever Banjo faces ('abs'); the others are turned with his facing ('rel') or with the
  // crouch-face facing ('cf'). L(state) = the best H one move later, predicted without playing anything in the room.
  const look = variants.map((v) => { const cf = v.cf != null; const k = cf ? v.base.k : v.k; const p = cf ? v.base.p : v.p;
    const abs = DIR_KINDS.includes(k) && p.d != null; const y0 = abs ? F(p.d) : (k === 'face' ? 0 : F(0));
    const P = new BM.Player(FW, { map: 0, pos: [0, 0, 0], yaw: y0, cam: fcam, version: o.version, grounded: true, state: S.IDLE });
    const ins = k === 'face' ? [{ face: F(p.f) }] : CHAIN[k].inputs(p, ctxFor(fcam)); const n = play(P, ins, 60); if (n == null) return null;
    if (k === 'face') return { m: 'abs', dx: 0, dz: 0, yaw: P.yaw };
    return { m: abs ? 'abs' : cf ? 'cf' : 'rel', dx: P.pos[0], dz: P.pos[2], dyaw: abs ? P.yaw : P.yaw - y0, cf: cf ? v.cf : null }; });
  function L(x, z, yaw, camv, counts) { let best = Hxz(x, z, yaw, camv);
    for (let vi = 0; vi < variants.length && best > 0.05; vi++) { const t = look[vi]; if (!t) continue; const v = variants[vi]; if (maxUse[v.k] != null && (counts && counts[v.k] || 0) >= maxUse[v.k]) continue;
      let px, pz, py; if (t.m === 'abs') { px = x + t.dx; pz = z + t.dz; py = t.yaw; } else { const fy = t.m === 'cf' ? CAM.cfyaw(F(camv), t.cf) : yaw; const [ox, oz] = rot(t.dx, t.dz, fy); px = x + ox; pz = z + oz; py = BM.mlNormalizeAngle(F(fy + t.dyaw)); }
      const h = Hxz(px, pz, py, camv); if (h < best) best = h; }
    return best; }
  const P0raw = new BM.Player(world, { map: o.map, pos: o.start.pos, vel: o.start.vel || [0, 0, 0], yaw: o.start.yaw ?? 0, cam: follow ? cam0 : cam, version: o.version, grounded: !o.start.air, state: o.start.air ? S.FALL : S.IDLE });
  // a start that is still moving (landing, sliding): first let Banjo come to rest with no input (those updates are part of the route)
  let settleIns = []; let P0 = P0raw;
  if (o.start.air || (o.start.vel && o.start.vel.some(v => v))) { const Q = BS.clone(P0raw); const n = play(Q, [], 200); if (n != null) { settleIns = Array.from({ length: n }, () => ({})); P0 = Q; } }
  const replay = (ins) => { const P = BS.clone(P0); for (const u of ins) { if (u.cam != null) P.cam = F(u.cam); P.step(u, u.frames || 2); } return P; };
  // every move variant from standing state P (camera camv); fine = also the fine variants. children: {vi, n, key, pos, yaw, cam, H, ins?, desc?, Q?, rows?}
  function expand(P, counts, keep, camv, fine) { const out = []; let sims = 0; const cv = F(camv ?? 0); const ctxC = follow ? ctxFor(cv) : null;
    for (let vi = 0; vi < variants.length; vi++) { const v = variants[vi]; if (v.fine && !fine) continue; if (maxUse[v.k] != null && (counts[v.k] || 0) >= maxUse[v.k]) continue;
      let vins = v.ins, y = null, desc = null;
      if (v.cf != null) { y = CAM.cfyaw(cv, v.cf); if (Math.abs(EXm.adiff(P.yaw, y)) < 8) continue; vins = [{ face: y }].concat(v.base.ins || CHAIN[v.base.k].inputs(v.base.p, ctxC || ctx0)); desc = `crouch-face ${EXm.DN[v.cf]} (facing ${y.toFixed(6)}°), ${v.base.desc}`; }
      else if (v.dyn) vins = CHAIN[v.k].inputs(v.p, ctxC);
      if (follow) vins = vins.map((u, i) => i === 0 ? Object.assign({}, u, { cam: cv }) : u);  // the camera of this move (for replays)
      const Q = BS.clone(P); if (follow) Q.cam = cv; const rows = []; const n = play(Q, vins, 60, rows); sims += rows.length; if (n == null) continue;
      const camN = camOn ? CAM.camnext(cv, Q.pos[0], Q.pos[2]) : null;
      const c = { vi, n, key: keyOf(Q, camN), pos: Q.pos.slice(), yaw: Q.yaw, cam: camN, H: H(Q, camN ?? 0) };
      if (vins !== v.ins) c.ins = vins; if (desc) c.desc = desc;
      if (keep) { c.Q = Q; c.rows = rows; } out.push(c); }
    return { out, sims }; }
  // every final move from standing state P (node: {ins, steps, path, cam}); returns the holds / clips found. Only final moves whose
  // flat-floor contacts come within finTol of a spot are played (the rest cannot reach one).
  const finTol = o.finTol ?? 2;
  function finalsAt(P, node, stop) { const res = []; let tried = 0, sims = 0, closest = 1e9; const camv = F(node.cam ?? cam0);
    const x = P.pos[0], z = P.pos[2]; const bear = (Math.atan2(T.x - x, T.z - z) * 180 / Math.PI + 360) % 360; const c = { run: (follow ? ctxFor(camv) : ctx0).dir(Math.round(bear * 1000) / 1000), back: (follow ? ctxFor(camv) : ctx0).dir((Math.round(bear * 1000) / 1000 + 180) % 360) };
    const facings = [{ y: P.yaw, pre: null }]; if (cfOn) for (let d = 0; d < 8; d++) { const y = CAM.cfyaw(camv, d); if (Math.abs(EXm.adiff(P.yaw, y)) >= 8) facings.push({ y, pre: d }); }
    const FL = [];
    for (const g of CG) { if (g.stick) { if (contactErr(g, x, z, bear) <= finTol) for (const f of g.finals) FL.push(f); continue; }
      for (const fc of facings) { if (contactErr(g, x, z, fc.y) > finTol) continue;
        for (const f of g.finals) FL.push(fc.pre == null ? f : { ...f, desc: `crouch-face ${EXm.DN[fc.pre]} (facing ${fc.y.toFixed(6)}°), then ${f.desc}`, mk: (i, cc) => i === 0 ? { face: fc.y } : f.mk(i - 1, cc), done: (Q, r, i) => i >= 1 && f.done(Q, r, i - 1), n: f.n + 1 }); } }
    for (const f of FL) { if (stop && stop()) break; const Q = BS.clone(P); if (follow) Q.cam = camv; const rows = []; const ups = []; let fh = -1, cross = -1;
      for (let i = 0; i < f.n; i++) { const u = f.mk(i, c); ups.push(u); const prevY = Q.pos[1], px = Q.pos[0], pz = Q.pos[2]; const r = Q.step(u, 2); sims++; rows.push(r); const d = sd(r.pos[0], r.pos[2]); if (d < closest && Math.abs(r.pos[1] - T.y) < 60) closest = d;
        if (r.held && fh < 0 && d < 3 && alongOK(r.pos[0], r.pos[2])) fh = i;
        // a direct clip (no hold): the feet go from at/above the floor to under it at a spot, while the floor under him is still the
        // target's floor (walking off a ledge onto a lower floor is not a clip), and stay down
        if (cross < 0 && fh < 0 && prevY >= T.y - 5 && r.pos[1] < T.y - 5 && (r.floorY == null || Math.abs(r.floorY - T.y) < 2)) { const mx = (px + r.pos[0]) / 2, mz = (pz + r.pos[2]) / 2; if ((sd(r.pos[0], r.pos[2]) < 3 || sd(mx, mz) < 3) && alongOK(r.pos[0], r.pos[2])) cross = i; }
        if (fh < 0 && cross < 0 && r.pos[1] > T.y - 5 && f.done(Q, r, i) && i > 4) break; if (r.pos[1] < T.y - 400) break; }
      tried++;
      const direct = fh < 0 && cross >= 0 && stayedUnder(rows, cross, T.y);
      if (fh >= 0 || direct) { const at = fh >= 0 ? fh : cross; let holds = rows.filter(r => r.held).length; let clip = direct || stayedUnder(rows, fh, T.y); const hp = rows[at].pos;
        const preIns = node.ins; let allInputs = preIns.concat(ups); let lag = null; let rowsOut = rows;
        // a hold that does not clip: try one 3-frame (lag) update on each of the 4 updates from the first hold
        if (!clip && o.lag) for (let L = fh; L < fh + 4 && !clip; L++) { const Q2 = BS.clone(P); if (follow) Q2.cam = camv; const r2 = []; const u2 = [];
          for (let i = 0; i < f.n; i++) { const u = Object.assign({}, f.mk(i, c)); if (i === L) u.frames = 3; u2.push(u); const r = Q2.step(u, u.frames || 2); sims++; r2.push(r); if (r.pos[1] < T.y - 400) break; }
          if (stayedUnder(r2, fh, T.y)) { clip = true; lag = L; rowsOut = r2; allInputs = preIns.concat(u2); holds = r2.filter(r => r.held).length; } }
        res.push({ kind: clip ? 'clip' : 'hold', holds, direct, move: f.label, desc: f.desc + (direct ? ' · straight through, no hold' : ''), key: f.k, chain: node.steps.concat([`${f.label}: ${f.desc}`]),
          rows: [], path: [...(node.path || []), ...rowsOut.map(r => r.pos)], start: o.start, cam: camv, allInputs, holdAt: hp.slice(), fromCrack: Math.hypot(hp[0] - T.x, hp[2] - T.z), lag: lag == null ? null : lag - fh, lagAt: lag, legs: null,
          moves: node.steps.length + 1, updates: allInputs.length, frames: allInputs.reduce((a, u) => a + (u.fp ? 86 + 2 * Math.abs(u.fp) : (u.frames || 2)), 0),  // a first-person twirl: C-Up, 50, 2|m| of stick, 4, C-Up, 30 frames
          score: (clip ? 1000 : 0) + holds * 10 - node.steps.length - Math.hypot(hp[0] - T.x, hp[2] - T.z) * 0.01 }); } }
    return { res, tried, sims, closest, candidates: FL.length }; }
  return { o, opt, cam, cam0, camOn, cfOn, follow, T, variants, finals, CG, sd, sdR, faceOK, reachMode, reachTol, P0, settleIns, replay, expand, finalsAt, H, L };
}

// ---- a pool of worker threads (chainworker.js), each with its own copy of the room and of setup(); run() goes to any free
// thread, runOn(w) to one thread (the one that holds a state in its cache)
function makeChainPool(n, init, url) {
  const ws = []; for (let i = 0; i < n; i++) { const w = new Worker(url || 'chainworker.js'); w.postMessage({ type: 'init', o: init, wid: i }); ws.push({ w, busy: false, q: [] }); }
  const queue = [];
  const pump = () => { for (const x of ws) { if (x.busy) continue; const t = x.q.length ? x.q.shift() : queue.length ? queue.shift() : null; if (!t) continue; x.busy = true; x.cur = t; x.w.postMessage(t.msg); } };
  ws.forEach((x) => { x.w.onmessage = (e) => { const t = x.cur; x.busy = false; x.cur = null; pump(); if (e.data && e.data.error) t.reject(new Error(e.data.error)); else t.resolve(e.data); };
    x.w.onerror = (e) => { e.preventDefault && e.preventDefault(); const t = x.cur; x.busy = false; x.cur = null; if (t) t.reject(new Error(e.message || 'worker error')); pump(); }; });
  return { size: n, run: (msg) => new Promise((resolve, reject) => { queue.push({ msg, resolve, reject }); pump(); }),
    runOn: (wi, msg) => new Promise((resolve, reject) => { ws[wi].q.push({ msg, resolve, reject }); pump(); }),
    clear: () => { queue.length = 0; for (const x of ws) x.q.length = 0; }, terminate: () => { for (const x of ws) x.w.terminate(); } };
}

// ---- the search. o: setup() options + {seconds, objective, beam (spots expanded per depth per round; 0 = all), keep ('spread'|'near'),
//      widen (keep widening the same frontier until the time is up), known (a known route: one move description per line),
//      threads, roomData, onPath, onResult, onProgress, shouldStop}
// Anytime frontier search: every standing state found is kept (compactly: parent + move); each round expands the next W best
// not-yet-expanded states of every depth (W doubles each round), so nothing is thrown away and nothing is redone.
async function chainSearch(o) {
  const t0 = Date.now(); const until = t0 + (o.seconds ?? 300) * 1000;
  const stop = () => (o.shouldStop && o.shouldStop()) || Date.now() > until; const prog = (f, t) => o.onProgress && o.onProgress(f, t);
  let lastYield = Date.now(); const tick = () => { if (Date.now() - lastYield < 80) return null; return new Promise(r => setTimeout(() => { lastYield = Date.now(); r(); }, 0)); };
  const C = setup(o); const { opt, variants, reachMode, reachTol, faceOK, sdR } = C; const D = opt.depth;
  const objective = o.objective === 'time' ? 'time' : 'moves'; let best = Infinity; const metric = (steps, nIns) => objective === 'time' ? nIns : steps;
  let pool = null; const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1; const nT = Math.max(0, Math.min(o.threads ?? (hc - 1), 32));
  if (nT > 1 && o.roomData && typeof Worker !== 'undefined') { try { const init = {}; for (const [k, v] of Object.entries(o)) if (typeof v !== 'function' && k !== 'world' && k !== 'pool') init[k] = v; pool = makeChainPool(nT, init, o.workerUrl); } catch (e) { pool = null; } }
  const thr = pool ? ` · ${pool.size} threads` : '';
  // nodes: {id, parent, vi, n, ins? (dynamic inputs), desc?, pos, yaw, cam, H, depth, counts, km (still on the known route), owner, expanded, fin}
  let nextId = 1; const nodes = new Map(); const local = new Map();  // local: id -> Player (LRU, no threads)
  const remember = (id, Q) => { local.set(id, Q); if (local.size > 30000) local.delete(local.keys().next().value); };
  const insOf = (nd) => { const parts = []; for (let x = nd; x && x.parent; x = x.parent) { const v = variants[x.vi]; const vins = x.ins || v.ins; parts.push(vins.concat(Array.from({ length: x.n - vins.length }, () => ({})))); } return C.settleIns.concat(...parts.reverse()); };
  const stepsOf = (nd) => { const s = []; for (let x = nd; x && x.parent; x = x.parent) s.push(x.desc || variants[x.vi].desc); return s.reverse(); };
  const pathOf = (nd) => { const s = []; for (let x = nd; x; x = x.parent) s.push(x.pos); return s.reverse(); };
  const normK = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').replace(/^\s*(\d+[.)]\s*)?/, '').trim(); const known = (o.known || []).map(normK).filter(Boolean);
  const kmatch = (desc, d) => d < known.length && normK(desc) === known[d];
  const root = { id: 0, parent: null, pos: C.P0.pos.slice(), yaw: C.P0.yaw, cam: C.cam0, H: C.H(C.P0, C.cam0), depth: 0, counts: {}, km: known.length > 0 };
  local.set(0, C.P0); nodes.set(0, root);
  const seen = new Map([[keyOf(C.P0, C.camOn ? C.cam0 : null), root]]);
  const pend = Array.from({ length: D + 1 }, () => []); pend[0].push(root);
  const results = []; const seenRes = new Set(); let tried = 0, sims = 0, closest = 1e9, finCand = 0;
  const kstat = { deepest: 0, lostAt: null, info: '' };
  const addRes = (res) => { const k = res.chain.join('|') + '|' + (res.lag ?? '') + '|' + res.kind; if (seenRes.has(k)) return; seenRes.add(k);
    if (res.kind === 'clip') best = Math.min(best, metric(res.moves, res.updates)); const path = res.path; delete res.path; results.push(res); o.onResult && o.onResult(res); o.onPath && o.onPath(path, res.kind === 'clip' ? 'clip' : 'hold'); };
  const reachCheck = (nd) => { const d = sdR(nd.pos); if (d < closest) closest = d; if (d > reachTol || !faceOK(nd.yaw)) return; const ins = insOf(nd); const steps = stepsOf(nd);
    addRes({ kind: 'reach', holds: 0, move: 'Reached the spot', desc: `stands ${d < 0.001 ? d.toExponential(2) : d.toFixed(3)} from the target, facing ${nd.yaw.toFixed(3)}°`, key: 'reach', chain: steps, rows: [], path: pathOf(nd), start: o.start, cam: C.cam,
      allInputs: ins, holdAt: nd.pos.slice(), fromCrack: d, lag: null, lagAt: null, legs: null, standYaw: nd.yaw, moves: steps.length, updates: ins.length, frames: ins.reduce((a, u) => a + (u.fp ? 86 + 2 * Math.abs(u.fp) : (u.frames || 2)), 0), score: 1000 - steps.length - d }); };
  // final moves for a batch of nodes (each node once)
  async function finalsFor(batch) { batch = batch.filter(nd => !nd.fin && !reachMode && metric(nd.depth + 1, 0) < best); batch.forEach(nd => { nd.fin = true; }); if (!batch.length) return;
    const pack = (nd) => ({ id: nd.id, ins: insOf(nd), steps: stepsOf(nd), path: pathOf(nd), cam: nd.cam });
    if (!pool) { for (const nd of batch) { if (stop()) break; const P = local.get(nd.id) || C.replay(insOf(nd)); const r = C.finalsAt(P, pack(nd), stop); tried += r.tried; sims += r.sims; finCand += r.candidates; closest = Math.min(closest, r.closest); for (const x of r.res) addRes(x); await tick(); } return; }
    const jobs = []; const byW = new Map(); for (const nd of batch) { const w = nd.owner ?? -1; if (!byW.has(w)) byW.set(w, []); byW.get(w).push(nd); }
    for (const [w, list] of byW) for (let i = 0; i < list.length; i += 4) { const msg = { type: 'finals', nodes: list.slice(i, i + 4).map(pack) };
      jobs.push((w >= 0 ? pool.runOn(w, msg) : pool.run(msg)).then(r => { tried += r.tried; sims += r.sims; finCand += r.candidates; closest = Math.min(closest, r.closest); for (const x of r.res) addRes(x); })); }
    await waitAll(jobs); }
  async function waitAll(jobs) { let fin = false; Promise.all(jobs).then(() => { fin = true; }, () => { fin = true; }); while (!fin) { if (stop()) { pool && pool.clear(); break; } await new Promise(r => setTimeout(r, 50)); } }
  // expand a batch of nodes of depth d; children go to pend[d+1] (and are tested with final moves right away when promising)
  const nearTol = o.nearTol ?? 1.5;
  async function expandBatch(batch, d, fineIds) { const kids = new Array(batch.length);
    if (!pool) { for (let i = 0; i < batch.length && !stop(); i++) { const nd = batch[i]; const P = local.get(nd.id) || C.replay(insOf(nd)); const r = C.expand(P, nd.counts, true, nd.cam, fineIds.has(nd.id)); kids[i] = r.out; sims += r.sims; if (i % 4 === 0) await tick(); } }
    else { const jobs = []; const byW = new Map(); batch.forEach((nd, i) => { const w = nd.owner ?? -1; if (!byW.has(w)) byW.set(w, []); byW.get(w).push(i); });
      const CH = Math.max(1, Math.round(240 / Math.max(1, variants.length)));
      for (const [w, idxs] of byW) for (let j = 0; j < idxs.length; j += CH) { const sl = idxs.slice(j, j + CH); const base = nextId; nextId += sl.length * 65536;
        const msg = { type: 'expand', base, nodes: sl.map(i => ({ id: batch[i].id, ins: batch[i].owner == null ? insOf(batch[i]) : null, counts: batch[i].counts, cam: batch[i].cam, fine: fineIds.has(batch[i].id) })) };
        const send = async () => { let r = await (w >= 0 ? pool.runOn(w, msg) : pool.run(msg)); if (r.miss && r.miss.length) { msg.nodes.forEach(m => { if (r.miss.includes(m.id)) m.ins = insOf(nodes.get(m.id)); }); r = await (r.wid != null ? pool.runOn(r.wid, msg) : pool.run(msg)); }
          r.kids.forEach((k, q) => { kids[sl[q]] = k.map(c => Object.assign(c, { owner: r.wid })); }); sims += r.sims; };
        jobs.push(send()); }
      await waitAll(jobs); }
    const promising = [];
    for (let i = 0; i < batch.length; i++) { const nd = batch[i]; const ks = kids[i]; if (!ks) continue; nd.done = true;
      for (const c of ks) { const v = variants[c.vi]; const dup = seen.get(c.key);
        // the same standing state reached another way: keep the first; if this way is the known route, the first one stands in for it
        if (dup) { if (known.length && nd.km && kmatch(c.desc || v.desc, d)) { dup.km = true; dup.kvia = true; } continue; }
        const id = c.id ?? nextId++; seen.set(c.key, null); const ch = { id, parent: nd, vi: c.vi, n: c.n, ins: c.ins, desc: c.desc, pos: c.pos, yaw: c.yaw, cam: c.cam, H: c.H, depth: d + 1, counts: Object.assign({}, nd.counts, { [v.k]: (nd.counts[v.k] || 0) + 1 }), owner: c.owner };
        seen.set(c.key, ch); if (known.length) ch.km = nd.km && kmatch(c.desc || v.desc, d);
        if (c.Q) remember(id, c.Q); nodes.set(id, ch); pend[d + 1].push(ch);
        if (reachMode) reachCheck(ch); else if (ch.H <= nearTol) promising.push(ch); } }
    pend[d + 1].sorted = false;
    if (promising.length) await finalsFor(promising);  // a final move is tried before the state can be dropped
    return batch.length; }
  // choose the next W not-yet-expanded states of depth d: half the best by H (finishing-region error), half spread over
  // position, height, facing and camera (the best of each cell), so routes that must first move away survive
  function choose(d, W) { const P = pend[d];
    // ranked by the predicted miss one move later (a state that needs one more move is not judged by where it stands now)
    if (d < D && !C.reachMode) for (const nd of P) if (nd.L == null) { nd.L = Math.min(nd.H, C.L(nd.pos[0], nd.pos[2], nd.yaw, nd.cam ?? C.cam0, nd.counts)); P.sorted = false; }
    const rk = (nd) => nd.L ?? nd.H;
    if (!P.sorted) { P.sort((a, b) => rk(a) - rk(b) || a.H - b.H || (objective === 'time' ? a.n - b.n : 0)); P.sorted = true; }
    const free = P.filter(nd => !nd.expanded); if (!W || free.length <= W) return free;
    const out = []; const taken = new Set(); const nearN = o.keep === 'near' ? W : Math.ceil(W / 2);
    for (let i = 0; i < free.length && out.length < nearN; i++) { out.push(free[i]); taken.add(free[i]); }
    if (out.length < W) { const cells = new Map(); for (const nd of free) { if (taken.has(nd)) continue; const ck = Math.floor(nd.pos[0] / 25) + ',' + Math.floor(nd.pos[2] / 25) + ',' + Math.floor(nd.pos[1] / 20) + ',' + Math.floor(nd.yaw / 45) + ',' + (nd.cam == null ? '' : Math.floor(nd.cam / 10)); if (!cells.has(ck)) cells.set(ck, nd); }
      const pick = [...cells.values()]; const step = Math.max(1, pick.length / (W - out.length)); for (let q = 0; q < pick.length && out.length < W; q += step) { const nd = pick[Math.floor(q)]; if (!taken.has(nd)) { out.push(nd); taken.add(nd); } }
      for (const nd of free) { if (out.length >= W) break; if (!taken.has(nd)) { out.push(nd); taken.add(nd); } } }
    return out; }
  // where the known route stands: the deepest move of it the search has reached, that state's rank among the states of its depth,
// and why it has not gone further (not expanded yet, or the next move was never produced from it)
  const kreport = () => { if (!known.length) return; let info = '', deepest = 0; const L = Math.min(D, known.length);
    for (let d = 1; d <= L; d++) { const nd = pend[d].find(x => x.km); const par = d === 1 ? root : pend[d - 1].find(x => x.km);
      if (!nd) { info = par && !par.done ? `known route: move ${d - 1} reached (${rankOf(par, d - 1)}), waiting to be expanded` : `known route: move ${d} (“${known[d - 1]}”) is not one of the moves tried from move ${d - 1}: check the move settings (directions, counts, crouch-faces)`; break; }
      deepest = d; if (d === L) { info = `known route: all ${L} moves reached (${rankOf(nd, d)})${nd.fin ? ', its final moves were played' : ', final moves not played yet'}`; break; } }
    kstat.deepest = deepest; kstat.info = info; };
  const rankOf = (nd, d) => { const P = pend[d]; if (!P.sorted) { const rk = (x) => x.L ?? x.H; P.sort((a, b) => rk(a) - rk(b)); P.sorted = true; } return `rank ${(P.indexOf(nd) + 1).toLocaleString()} of ${P.length.toLocaleString()} at depth ${d}, predicted miss ${nd.H.toFixed(2)} now${nd.L != null && nd.L < nd.H ? `, ${nd.L.toFixed(2)} after one more move` : ''}`; };
  const pmsg = (round, W, d, extra) => `Round ${round} (${W ? `${W.toLocaleString()} per depth` : 'every spot'}) · depth ${d} of ${D} · ${seen.size.toLocaleString()} standing spots · ${tried.toLocaleString()} final moves played${extra || ''} · ${results.length} found · closest ${closest < 1e8 ? closest.toExponential(1) : '—'} from the ${reachMode ? 'target' : 'spot'}${thr}${kstat.info ? ' · ' + kstat.info : ''}`;
  let W = o.beam === 0 ? 0 : (o.beam || 120); let round = 1; let exhausted = false;
  if (reachMode) reachCheck(root); else await finalsFor([root]);
  try {
    while (!stop()) { let work = 0;
      for (let d = 0; d < D && !stop(); d++) { const batch = choose(d, W); if (!batch.length) continue; batch.forEach(nd => { nd.expanded = true; }); work += batch.length;
        // the most promising states also get the fine variants (all twirl steps, light small steps)
        const fineIds = new Set(batch.slice(0, Math.max(5, Math.ceil(batch.length / 10))).map(nd => nd.id));
        await finalsFor(batch); for (let i = 0; i < batch.length && !stop(); i += 64) { await expandBatch(batch.slice(i, i + 64), d, fineIds); kreport(); prog(Math.min(0.99, (round - 1 + (d + i / batch.length) / D) / (round + 1)), pmsg(round, W, d + 1)); } }
      // the deepest states only need their final moves
      { const last = choose(D, W); last.forEach(nd => { nd.expanded = true; }); work += last.length; for (let i = 0; i < last.length && !stop(); i += 64) await finalsFor(last.slice(i, i + 64)); }
      kreport(); prog(Math.min(0.99, round / (round + 1)), pmsg(round, W, D));
      if (!work) { exhausted = true; break; } if (!o.widen && o.widen !== undefined) break; if (!W) { exhausted = !pend.some(P => P.some(nd => !nd.expanded)); if (exhausted) break; }
      W = W ? W * 2 : 0; round++; }
  } finally { if (pool) pool.terminate(); }
  kreport();
  prog(1, `Done: ${seen.size.toLocaleString()} standing spots reached in ${round} round${round > 1 ? 's' : ''}, ${reachMode ? '' : `${tried.toLocaleString()} final moves played, `}${results.length} found${closest < 1e8 ? ` · closest ${closest.toExponential(1)} from the ${reachMode ? 'target' : 'spot'}` : ''}${exhausted ? ' · every reachable spot was searched' : ''} · ${((Date.now() - t0) / 1000).toFixed(0)} s${thr}${kstat.info ? ' · ' + kstat.info : ''}`);
  return { results, closest, tried, spots: seen.size, sims, exhausted, known: kstat };
}

const api = { chainSearch, setup, makeChainPool, keyOf, CHAIN, CHAIN_UI, play };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKCHAIN = api;
})(typeof self !== 'undefined' ? self : this);
