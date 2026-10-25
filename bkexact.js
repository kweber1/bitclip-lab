// bkexact.js -- the old 810 GPU route search (search/s18/s34.cu) ported to JavaScript for the Bit-Clip Lab.
// Flat-floor exact move models (PAL): per-update displacement depends only on the facing, so a move is a fixed list of float
// additions. Crouch-face turns come from a static look-at camera (camera yaw settles to 2 ulp of the look-at yaw after each
// move). Search = meet in the middle: an exact backward table of every standing state from which (turn) + 1..R moves land
// exactly on the target crack (built by inverting the float additions), and an iterative-deepening forward search from the start.
(function (root) {
'use strict';
// a clip: after the first hold Banjo goes 60+ under the floor and never comes back up within 60 of it (a pop back onto the floor is not a clip)
const stayedUnder = (rows, fh, y0) => { let k = -1; for (let i = fh; i < rows.length; i++) if (rows[i].pos[1] < y0 - 60) { k = i; break; } if (k < 0) return false; for (let i = k + 1; i < rows.length; i++) if (rows[i].pos[1] >= y0 - 60) return false; return true; };
const F = Math.fround; const _fb = new Float32Array(1), _ub = new Uint32Array(_fb.buffer);
const fbit = f => { _fb[0] = f; return _ub[0]; }, bitf = u => { _ub[0] = u >>> 0; return _fb[0]; };
const n64d = (h, l) => { const dv = new DataView(new ArrayBuffer(8)); dv.setUint32(0, h); dv.setUint32(4, l); return dv.getFloat64(0); };
const NP = [n64d(0x3ff00000, 0), n64d(0xbfc55554, 0xbc83656d), n64d(0x3f8110ed, 0x3804c2a0), n64d(0xbf29f6ff, 0xeea56814), n64d(0x3ec5dbdf, 0x0e314bfe)];
const NRPI = n64d(0x3fd45f30, 0x6dc9c883), NPIHI = n64d(0x400921fb, 0x50000000), NPILO = n64d(0x3e6110b4, 0x611a6263);
const NROUND = d => d >= 0 ? Math.trunc(d + 0.5) : Math.trunc(d - 0.5);
const poly = dx => { const xsq = dx * dx; const p = ((NP[4] * xsq + NP[3]) * xsq + NP[2]) * xsq + NP[1]; return dx + (dx * xsq) * p; };
function sinf(x) { const ix = fbit(x) | 0; const xpt = (ix >> 22) & 0x1ff; let dx;
  if (xpt < 0xff) { if (xpt >= 0xe6) return F(poly(x)); return x; }
  if (xpt < 0x136) { dx = x; let dn = dx * NRPI; const n = NROUND(dn); dn = n; dx = dx - dn * NPIHI; dx = dx - dn * NPILO; const r = poly(dx); return (n & 1) === 0 ? F(r) : -F(r); } return 0; }
function cosf(x) { const ix = fbit(x) | 0; const xpt = (ix >> 22) & 0x1ff;
  if (xpt < 0x136) { const ax = x < 0 ? -x : x; let dx = ax; let dn = dx * NRPI + 0.5; const n = NROUND(dn); dn = n; dn -= 0.5; dx = dx - dn * NPIHI; dx = dx - dn * NPILO; const r = poly(dx); return (n & 1) === 0 ? F(r) : -F(r); } return 0; }
const gdeg = y => F(y * (3.141592654 / 180.0));
const ATAB = new Uint16Array(10001); for (let i = 0; i <= 10000; i++) { const a = F(i * 90.0 / 10000 * Math.PI / 180); ATAB[i] = Math.trunc(F(F(Math.sin(a)) * 65535)) & 0xffff; }
function acosf(x) { let lo = 0, up = 10000, idx = 10000; const xa = x >= 0 ? x : -x; const t = Math.trunc(xa * 65535.0) & 0xffff; while (up - lo >= 2 && t !== ATAB[idx]) { idx = (up + lo) >> 1; if (t < ATAB[idx]) up = idx; else lo = idx; } return F(idx * 90.0 / 10000.0); }
function yawT(vx, vz) { const h = F(Math.sqrt(F(F(vz * vz) + F(vx * vx)))); if (h < 0.01) return null; let a = acosf(F(vx / h)); if (vz < 0) a = F(180 - a); if (vx < 0) a = F(360 - a); return a; }
const nrmA = a => { if (a >= 360) a = F(a - 360); if (a < 0) a = F(a + 360); return a; };
const adiff = (a, b) => { let d = (b - a + 540) % 360; if (d < 0) d += 360; return d - 180; };
const ANGD = [90, 45, 0.009, 315, 270, 225, 179.991, 135].map(F); const DN = ['U', 'UR', 'R', 'DR', 'D', 'DL', 'L', 'UL'];
const MN = ['P', 'C1', 'PZ', 'BT', 'BR', 'BH'];
const MLONG = ['punch', 'punch cancel (1 update)', 'punch, then Z', 'beak barge, Z kept', 'beak barge, Z released', 'beak barge held'];
const twyaw = (y, t) => { let e = nrmA(F(y + 180)); const d = t > 0 ? F(3.6) : F(-3.6); for (let i = 0, n = Math.abs(t); i < n; i++) e = nrmA(F(e + d)); return nrmA(F(e + 180)); };

function make(cfg) {
  const DT = F(cfg.DT ?? 0.04), K29 = F(0.29), SC = F(F(0.04) / F(0.0333333));
  const CAMX = F(cfg.camX), CAMZ = F(cfg.camZ);
  const upd = (v, t) => { const d = F(F(t * K29) - F(v * K29)); return F(v + F(d * SC)); };
  const camyaw = (x, z) => yawT(F(CAMX - x), F(CAMZ - z)) ?? 0;
  const camnext = (p, x, z) => { const t = camyaw(x, z); const d = (fbit(t) | 0) - (fbit(p) | 0); if (d >= -2 && d <= 2) return p; let u = fbit(t); u = t > p ? u - 2 : u + 2; return bitf(u); };
  const cfyaw = (cam, d) => nrmA(F(F(cam + ANGD[d]) + 90.0));
  const BT = [500, 500, 500, 500, 500, 500, 420, 340, 260, 180, 180, 180, 180, 0, 0, 0, 0, 0, 0, 0, 0];
  const BH = [850, 850, 850, 850, 850, 850, 850, 850, 770, 690, 610, 530, 450, 370, 290, 210, 130, 130, 130, 130, 0, 0, 0, 0, 0, 0, 0, 0];
  const cache = new Map();
  function moveseq(yaw, mv) {
    const ck = fbit(yaw) * 8 + mv; let r = cache.get(ck); if (r) return r;
    const DX = [], DZ = []; let vx = 0, vz = 0;
    const a = gdeg(yaw); const sn = sinf(a), cs = cosf(a); const tx = F(160 * sn), tz = F(160 * cs);
    const STP = (TX, TZ) => { vx = upd(vx, TX); vz = upd(vz, TZ); DX.push(F(vx * DT)); DZ.push(F(vz * DT)); if (Math.abs(vx) < F(1e-4)) vx = 0; if (Math.abs(vz) < F(1e-4)) vz = 0; };
    if (mv === 0 || mv === 1) { const N = mv === 1 ? 1 : 60; for (let i = 1; i <= N; i++) { if (i <= 19) STP(tx, tz); else STP(0, 0); } }
    else { let crouch = true;
      if (mv === 2) { for (let i = 0; i < 19; i++) STP(tx, tz); for (let i = 0; i < 14; i++) STP(0, 0); }
      else { let S, set0, tail = 0; if (mv === 5) { S = BH; set0 = 850; } else { S = BT; set0 = 500; } if (mv === 4) { crouch = false; tail = 60; }
        vx = F(set0 * sn); vz = F(set0 * cs); for (const T of S) STP(F(T * sn), F(T * cs)); for (let i = 0; i < tail; i++) STP(0, 0); }
      if (crouch) { STP(0, 0); const V0 = F(Math.sqrt(F(F(vx * vx) + F(vz * vz)))); const ty = yawT(vx, vz); STP(0, 0);
        let s2 = 0, c2 = 0; if (ty != null) { const b = gdeg(ty); s2 = sinf(b); c2 = cosf(b); }
        let tm = F(0.7); for (let k = 0; k < 80; k++) { tm = F(tm - DT); if (tm < 0) tm = 0; let T = ty != null ? F(F(tm / F(0.3)) * V0) : 0; if (T > V0) T = V0; STP(F(T * s2), F(T * c2)); } } }
    r = { DX: Float32Array.from(DX), DZ: Float32Array.from(DZ) }; if (cache.size > 60000) cache.clear(); cache.set(ck, r); return r; }
  const floorOK = cfg.floorOK; const oncrack = cfg.onCrack || (() => false);
  // one move along the floor; null if Banjo would leave the modelled floor
  function domove(x, z, yaw, mv) { const { DX, DZ } = moveseq(yaw, mv); for (let i = 0; i < DX.length; i++) { x = F(x + DX[i]); z = F(z + DZ[i]); if (!floorOK(x, z)) return null; } return [x, z]; }
  return { DT, upd, camyaw, camnext, cfyaw, moveseq, domove, floorOK, oncrack };
}

// ---- float inversion: every c with F(c + d) == y (a few ulps around y - d)
function nextDown(f) { if (f === 0) return -bitf(1); const u = fbit(f); return f > 0 ? bitf(u - 1) : bitf(u + 1); }
function nextUp(f) { if (f === 0) return bitf(1); const u = fbit(f); return f > 0 ? bitf(u + 1) : bitf(u - 1); }
function invadd(y, d, out) { // the same candidates as s34 (solutions within 6 ulps of F(y - d), ascending, at most 8), found faster:
  // F(c + d) is non-decreasing in c, so walk out from F(y - d) only while it can still round to y
  const b = F(y - d); const sol = []; if (F(b + d) === y) sol.push(b);
  let c = b; for (let n = 0; n < 6; n++) { c = nextDown(c); const v = F(c + d); if (v === y) sol.push(c); else if (v < y) break; }
  c = b; for (let n = 0; n < 6; n++) { c = nextUp(c); const v = F(c + d); if (v === y) sol.push(c); else if (v > y) break; }
  sol.sort((p, q) => p - q); for (const v of sol) { if (out.length >= 8) break; if (!out.some(o => fbit(o) === fbit(v))) out.push(v); } return out; }
function invchain(y, D) { let cur = [y]; for (let k = D.length - 1; k >= 0; k--) { const nx = []; for (const c of cur) { const t = invadd(c, D[k], []); for (const v of t) if (nx.length < 16) nx.push(v); } if (!nx.length) return []; cur = nx; } return cur; }

// ---- the search core, shared by the page and by each worker thread (cfg must be plain data so it can be sent to workers):
// cfg = { camX, camZ, mask: {ok, W, H, x0, z0, cell} | floorOK(x,z), bbox, target:{xb,zb}, R, moves[6], twirlCap, twirlMax, prefilter }
function maskOK(m) { const { ok, W, H, x0, z0, cell } = m; return (x, z) => { const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell); return i >= 0 && j >= 0 && i < W && j < H && ok[j * W + i] === 1; }; }
function core(cfg) {
  const floorOK = cfg.floorOK || maskOK(cfg.mask); const E = make({ camX: cfg.camX, camZ: cfg.camZ, floorOK, onCrack: cfg.onCrack });
  const { camyaw, camnext, cfyaw, moveseq, domove } = E; const oncrack = E.oncrack;
  const MV = [0, 1, 2, 3, 4, 5].filter(m => !cfg.moves || cfg.moves[m]); const C1 = 1;
  const RMAX = cfg.R ?? 3, TWCAP = cfg.twirlCap ?? 0, TWM = cfg.twirlMax ?? 50; const bb = cfg.bbox || [-1e9, -1e9, 1e9, 1e9];
  const TX = cfg.target.xb >>> 0, TZ = cfg.target.zb >>> 0, tx = bitf(TX), tz = bitf(TZ);
  // all exact start states S (camera c, crouch-face d) such that turn d + the moves ms (same facing) end exactly at (ttx, ttz)
  function expand(ttx, ttz, tcamReq, tcam, hasYn, yn, ms, parent, rem, emit) {
    const k = ms.length;
    for (let d = 0; d < 8; d++) {
      const cands = []; let c = camyaw(ttx, ttz); let ax = ttx, az = ttz;
      for (let it = 0; it < 8; it++) { const y = cfyaw(c, d); let x = ttx, z = ttz;
        for (let j = k - 1; j >= 0; j--) { const { DX, DZ } = moveseq(y, ms[j]); for (let i = 0; i < DX.length; i++) { x -= DX[i]; z -= DZ[i]; } }
        ax = x; az = z; const Tc = camyaw(F(x), F(z)); if (fbit(Tc) === fbit(c)) break; c = Tc; }
      if (!(ax > bb[0] && ax < bb[2] && az > bb[1] && az < bb[3])) continue;
      if (cfg.prefilter !== false && !floorOK(F(ax), F(az))) continue;  // the start would be off the modelled floor
      for (let sx = -1; sx <= 1; sx++) for (let sz = -1; sz <= 1; sz++) { const T2 = camyaw(F(ax + 0.05 * sx), F(az + 0.05 * sz));
        for (let q = -2; q <= 2; q++) { const u = (fbit(T2) + q) >>> 0; if (!cands.includes(u) && cands.length < 64) cands.push(u); } }
      const ys = []; for (const u of cands) { const y = cfyaw(bitf(u), d); if (!ys.some(v => fbit(v) === fbit(y))) ys.push(y); }
      for (const y of ys) { if (hasYn && Math.abs(adiff(y, yn)) < 8) continue;
        let SX = [ttx], SZ = [ttz];
        for (let j = k - 1; j >= 0 && SX.length; j--) { const { DX, DZ } = moveseq(y, ms[j]); const NX = [], NZ = [];
          for (let i = 0; i < SX.length; i++) { const xs = invchain(SX[i], DX), zs = invchain(SZ[i], DZ); for (const a of xs) for (const b of zs) if (NX.length < 64) { NX.push(a); NZ.push(b); } }
          SX = NX; SZ = NZ; }
        for (const u of cands) { const cam = bitf(u); if (fbit(cfyaw(cam, d)) !== fbit(y)) continue;
          for (let i = 0; i < SX.length; i++) { const x = SX[i], z = SZ[i];
            const dd = (u | 0) - (fbit(camyaw(x, z)) | 0); if (dd < -2 || dd > 2) continue;
            if (!floorOK(x, z) || oncrack(x, z)) continue;
            let cx = x, cz = z, cc = cam, ok = true;
            for (let j = 0; j < k && ok; j++) { const r = domove(cx, cz, y, ms[j]); if (!r) { ok = false; break; } cx = r[0]; cz = r[1]; cc = camnext(cc, cx, cz); if (j < k - 1 && oncrack(cx, cz)) ok = false; }
            if (!ok || fbit(cx) !== fbit(ttx) || fbit(cz) !== fbit(ttz)) continue;
            if (tcamReq && fbit(cc) !== tcam) continue;
            emit(fbit(x), fbit(z), u, fbit(y), parent, d, rem, k, ms[0], k > 1 ? ms[1] : 0); } } } } }
  const roots = (emit) => { if (!MV.includes(C1)) return; expand(tx, tz, 0, 0, false, 0, [C1], -1, 1, emit); if (RMAX >= 2) for (const m of MV) expand(tx, tz, 0, 0, false, 0, [m, C1], -1, 2, emit); };
  // one table entry -> every entry one or two moves further back
  const expandEntry = (xb, zb, cam, yb, rem, idx, emit) => { const ex = bitf(xb), ez = bitf(zb), y = bitf(yb);
    for (const m of MV) { if (rem + 1 <= RMAX) expand(ex, ez, 1, cam, true, y, [m], idx, rem + 1, emit);
      if (rem + 2 <= RMAX) for (const m2 of MV) expand(ex, ez, 1, cam, true, y, [m, m2], idx, rem + 2, emit); } };
  // forward digits: cf turn r (0 none, 1..8) + move, or a first-person twirl t (±1..TWM) + move
  const G = []; for (let r = 0; r <= 8; r++) for (const m of MV) G.push({ tw: 0, r, m }); if (TWCAP > 0) for (let t = 1; t <= TWM; t++) for (const sg of [t, -t]) for (const m of MV) G.push({ tw: sg, r: 0, m });
  const twAll = (y) => { const out = []; let e = nrmA(F(y + 180)), f = e; for (let t = 1; t <= TWM; t++) { e = nrmA(F(e + F(3.6))); f = nrmA(F(f + F(-3.6))); out.push([t, nrmA(F(e + 180))], [-t, nrmA(F(f + 180))]); } return out; };
  function fstep(s, gi) { const g = G[gi]; let y2 = s.y; if (g.tw) y2 = twyaw(s.y, g.tw); else if (g.r) { y2 = cfyaw(s.cam, g.r - 1); if (Math.abs(adiff(s.y, y2)) < 8) return null; }
    const r = domove(s.x, s.z, y2, g.m); if (!r) return null; if (oncrack(r[0], r[1])) return null; return { x: r[0], z: r[1], y: y2, cam: camnext(s.cam, r[0], r[1]), path: s.path.concat([gi]), ntw: s.ntw + (g.tw ? 1 : 0) }; }
  // table lookup (set once the table is built): xb, zb, cam, yb arrays + a hash on (x, z)
  let TT = null, QH = null, NXT = null, QM = 0;
  const h2 = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) & QM; };
  function setTable(t) { TT = t; const n = t.n; QM = (1 << Math.max(10, Math.ceil(Math.log2(n * 2 + 2)))) - 1; QH = new Int32Array(QM + 1).fill(-1); NXT = new Int32Array(Math.max(1, n)); for (let i = n - 1; i >= 0; i--) { const q = h2(t.xb[i], t.zb[i]); NXT[i] = QH[q]; QH[q] = i; } }
  let nodes = 0;
  // a forward spot meets the table (same position + camera bits, facing turnable), or is one 1-update punch cancel from the crack
  function checknode(s, hit) { nodes++;
    const xb = fbit(s.x), zb = fbit(s.z), cb = fbit(s.cam), yb = fbit(s.y); let tw = null;
    for (let i = QH[h2(xb, zb)]; i >= 0; i = NXT[i]) { if (TT.xb[i] !== xb || TT.zb[i] !== zb || TT.cam[i] !== cb) continue;
      if (yb === TT.yb[i]) hit(s, i, 1); else if (Math.abs(adiff(s.y, bitf(TT.yb[i]))) >= 8) hit(s, i, 0);
      if (TWCAP > 0) { tw = tw || twAll(s.y); for (const [t, v] of tw) if (fbit(v) === TT.yb[i]) hit(s, i, 100 + t); } }
    if (!MV.includes(C1)) return; const dd = Math.hypot(s.x - tx, s.z - tz); if (dd < 1.5 || dd > 3.2) return;
    for (let r = 0; r <= 8; r++) { let y3 = s.y; if (r) { y3 = cfyaw(s.cam, r - 1); if (Math.abs(adiff(s.y, y3)) < 8) continue; } const { DX, DZ } = moveseq(y3, C1); if (fbit(F(s.x + DX[0])) === TX && fbit(F(s.z + DZ[0])) === TZ) hit(s, -1, r); }
    if (TWCAP > 0) { tw = tw || twAll(s.y); for (const [t, y3] of tw) { const { DX, DZ } = moveseq(y3, C1); if (fbit(F(s.x + DX[0])) === TX && fbit(F(s.z + DZ[0])) === TZ) hit(s, -1, 100 + t); } } }
  // every `left`-move tail from s, checking the spots at the end
  function dfs(s, left, hit, stop) { if (left === 0) { checknode(s, hit); return; }
    for (let gi = 0; gi < G.length; gi++) { if (stop && (nodes & 1023) === 0 && stop()) return; if (G[gi].tw && s.ntw >= TWCAP) continue; const c = fstep(s, gi); if (c) dfs(c, left - 1, hit, stop); } }
  return { E, MV, G, RMAX, TWCAP, roots, expandEntry, fstep, setTable, checknode, dfs, nodes: () => nodes, resetNodes: () => { nodes = 0; } };
}

// ---- a pool of worker threads running exactworker.js (each holds its own copy of the core and, later, of the table)
function makePool(n, cfg, url) {
  const ws = []; for (let i = 0; i < n; i++) { const w = new Worker(url || 'exactworker.js'); w.postMessage({ type: 'init', cfg }); ws.push({ w, busy: false }); }
  const queue = []; let id = 0; const pending = new Map();
  const pump = () => { for (const x of ws) { if (x.busy || !queue.length) continue; const t = queue.shift(); x.busy = true; x.cur = t; x.w.postMessage(t.msg, t.transfer || []); } };
  for (const x of ws) x.w.onmessage = (e) => { const t = x.cur; x.busy = false; x.cur = null; pump(); t.resolve(e.data); };
  for (const x of ws) x.w.onerror = (e) => { e.preventDefault && e.preventDefault(); const t = x.cur; x.busy = false; x.cur = null; if (t) t.reject(new Error(e.message || 'worker error')); pump(); };
  return { size: n, run: (msg, transfer) => new Promise((resolve, reject) => { queue.push({ msg: Object.assign({ id: ++id }, msg), transfer, resolve, reject }); pump(); }),
    broadcast: (msg) => Promise.all(ws.map(x => new Promise((resolve, reject) => { queue.unshift({ msg, resolve, reject }); }))).then(() => {}),
    each: (msg) => Promise.all(ws.map(x => new Promise((resolve, reject) => { const send = () => { if (x.busy) { setTimeout(send, 20); return; } x.busy = true; x.cur = { resolve, reject }; x.w.postMessage(msg); }; send(); }))),
    clear: () => { queue.length = 0; }, terminate: () => { for (const x of ws) x.w.terminate(); } };
}

// ---- the search. o = cfg (above) + { start:{x,z,yaw,cam}, D (max forward moves), seconds, tableCap, frontierCap, pool, onHit, onProgress, shouldStop }
async function search(o) {
  const C = core(o); const t0 = Date.now(); const until = t0 + (o.seconds ?? 600) * 1000; const stop = () => (o.shouldStop && o.shouldStop()) || Date.now() > until;
  let lastYield = Date.now(); const tick = () => { if (Date.now() - lastYield < 100) return null; return new Promise(r => setTimeout(() => { lastYield = Date.now(); r(); }, 0)); };
  const prog = (f, t) => o.onProgress && o.onProgress(f, t); const pool = o.pool && o.pool.size > 0 ? o.pool : null; const thr = pool ? ` · ${pool.size} threads` : '';
  const RMAX = C.RMAX, TWCAP = C.TWCAP; const tableCap = o.tableCap ?? 4e6; const C1 = 1;
  // backward table: growable typed arrays + an open-addressing hash on (x, z, camera, facing) bits for exact dedupe
  const T = { n: 0, cap: 0 }; const FIELDS = { xb: Uint32Array, zb: Uint32Array, cam: Uint32Array, yb: Uint32Array, parent: Int32Array, d: Uint8Array, rem: Uint8Array, k: Uint8Array, m0: Uint8Array, m1: Uint8Array };
  const grow = () => { const nc = Math.max(1 << 16, T.cap * 2); for (const [f, A] of Object.entries(FIELDS)) { const na = new A(nc); if (T[f]) na.set(T[f]); T[f] = na; } T.cap = nc; };
  let HS = new Int32Array(1 << 18), HM = (1 << 18) - 1;
  const h4 = (a, b, c, d) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c ^ 0x165667b1, 0x27d4eb2f) ^ Math.imul(d + 0x61c88647, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return h >>> 0; };
  const hfind = (xb, zb, cb, yb) => { let i = h4(xb, zb, cb, yb) & HM; for (;;) { const e = HS[i]; if (!e) return -1 - i; const j = e - 1; if (T.xb[j] === xb && T.zb[j] === zb && T.cam[j] === cb && T.yb[j] === yb) return j; i = (i + 1) & HM; } };
  const rehash = () => { HS = new Int32Array(HS.length * 2); HM = HS.length - 1; for (let j = 0; j < T.n; j++) { let i = h4(T.xb[j], T.zb[j], T.cam[j], T.yb[j]) & HM; while (HS[i]) i = (i + 1) & HM; HS[i] = j + 1; } };
  const addT = (xb, zb, cb, yb, parent, d, rem, k, m0, m1) => { if (T.n >= tableCap) return; const f = hfind(xb, zb, cb, yb); if (f >= 0) return;
    if (T.n >= T.cap) grow(); const j = T.n++; T.xb[j] = xb; T.zb[j] = zb; T.cam[j] = cb; T.yb[j] = yb; T.parent[j] = parent; T.d[j] = d; T.rem[j] = rem; T.k[j] = k; T.m0[j] = m0; T.m1[j] = m1;
    HS[-1 - f] = j + 1; if (T.n * 2 > HS.length) rehash(); };
  C.roots(addT);
  prog(0, `Backward table: ${T.n} exact spots 1–2 moves from the crack${thr}`);
  let lo = 0;
  for (let pass = 0; pass < RMAX && T.n < tableCap && !stop(); pass++) { const hi = T.n; const msg = (i) => `Backward table, pass ${pass + 1}: ${(i - lo).toLocaleString()} of ${(hi - lo).toLocaleString()} spots expanded · ${T.n.toLocaleString()} exact spots${thr}`;
    if (pool) { // chunks of entries to the threads; their new entries are merged here (deduplicated) as they come back
      const CH = 64; let done = 0; const jobs = [];
      for (let i = lo; i < hi; i += CH) { const j = Math.min(hi, i + CH); const items = new Uint32Array((j - i) * 6);
        for (let q = i; q < j; q++) { const b = (q - i) * 6; items[b] = T.xb[q]; items[b + 1] = T.zb[q]; items[b + 2] = T.cam[q]; items[b + 3] = T.yb[q]; items[b + 4] = T.rem[q]; items[b + 5] = q; }
        jobs.push(pool.run({ type: 'expand', items }, [items.buffer]).then(r => { if (stop()) return; const a = r.out; for (let b = 0; b < a.length; b += 10) addT(a[b], a[b + 1], a[b + 2], a[b + 3], a[b + 4] | 0, a[b + 5], a[b + 6], a[b + 7], a[b + 8], a[b + 9]); done += j - i; prog(0.3 * (pass + done / Math.max(1, hi - lo)) / RMAX, msg(lo + done)); })); }
      while (jobs.length) { const all = Promise.all(jobs); let fin = false; all.then(() => { fin = true; }); while (!fin) { if (stop()) { pool.clear(); break; } await new Promise(r => setTimeout(r, 100)); } if (fin || stop()) break; }
    } else {
      for (let i = lo; i < hi && !stop() && T.n < tableCap; i++) { C.expandEntry(T.xb[i], T.zb[i], T.cam[i], T.yb[i], T.rem[i], i, addT);
        if ((i & 63) === 0) { prog(0.3 * (pass + (i - lo) / Math.max(1, hi - lo)) / RMAX, msg(i)); await tick(); } } }
    if (T.n === hi) break; lo = hi; }
  HS = null; const NT = T.n;
  const tab = { n: NT, xb: T.xb.slice(0, NT), zb: T.zb.slice(0, NT), cam: T.cam.slice(0, NT), yb: T.yb.slice(0, NT) }; C.setTable(tab);
  const hist = {}; for (let i = 0; i < NT; i++) hist[T.rem[i]] = (hist[T.rem[i]] || 0) + 1;
  const tableInfo = `Backward table: ${NT.toLocaleString()} exact spots (${Object.entries(hist).map(([r, n]) => `${n.toLocaleString()} with ${r} move${r > 1 ? 's' : ''} left`).join(', ')}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`;
  prog(0.3, tableInfo + thr);
  if (pool && !stop()) await pool.each({ type: 'table', tab });
  // the graphics card (WebGPU), when asked for: it runs the forward tails; every hit it reports is re-checked here on the CPU
  let gpu = null; const G0 = typeof self !== 'undefined' ? self : globalThis;
  if (o.useGpu && !stop()) { try { if (!G0.BKGPU) throw new Error('bkgpu.js is not loaded');
      gpu = await G0.BKGPU.makeGpu({ camX: o.camX, camZ: o.camZ, mask: o.mask, target: o.target, G: C.G, twirlCap: TWCAP, twirlMax: o.twirlMax ?? 50, hasC1: C.MV.includes(1), table: tab }); }
    catch (e) { gpu = null; prog(0.3, `${tableInfo} · the graphics card could not be used (${e.message}), so the CPU does the search`); o.onGpuFail && o.onGpuFail(e.message); } }
  const gtxt = gpu ? ` · graphics card: ${gpu.desc || 'WebGPU'}` : '';
  // a hit: (forward digits, table entry or -1 for a straight final cancel, fin = how the facing is reached, forward end facing bits)
  const hits = []; const hitKeys = new Set(); let nodesPool = 0;
  function report(path, entry, fin, yb) { const steps = []; let y = bitf(yb);
    for (const gi of path) { const g = C.G[gi]; steps.push(g.tw ? { tw: g.tw, m: g.m } : { cf: g.r ? g.r - 1 : null, m: g.m }); }
    if (entry < 0) steps.push(fin >= 50 ? { tw: fin - 100, m: C1 } : { cf: fin ? fin - 1 : null, m: C1 });
    else { let e = entry, first = true; while (e >= 0) { const tw = first && fin >= 50 ? fin - 100 : 0; const turn = !tw && fbit(y) !== T.yb[e];
        const ms = T.k[e] > 1 ? [T.m0[e], T.m1[e]] : [T.m0[e]]; ms.forEach((m, j) => steps.push(j ? { cf: null, m } : tw ? { tw, m } : { cf: turn ? T.d[e] : null, m }));
        y = bitf(T.yb[e]); first = false; e = T.parent[e]; } }
    const txt = steps.map(st => (st.tw ? `tw${st.tw > 0 ? '+' : ''}${st.tw}` : st.cf == null ? '-' : 'cf' + DN[st.cf]) + ' ' + MN[st.m]).join(' ');
    if (hitKeys.has(txt)) return; hitKeys.add(txt);
    const h = { steps, text: txt, moves: steps.length, meet: path.length }; hits.push(h); o.onHit && o.onHit(h); }
  const localHit = (s, entry, fin) => report(s.path, entry, fin, fbit(s.y));
  // iterative deepening: levels with exact-state dedupe up to frontierCap, then exhaustive tails (on the threads)
  const s0 = { x: F(o.start.x), z: F(o.start.z), y: F(o.start.yaw), cam: F(o.start.cam), path: [], ntw: 0 };
  const vkey = s => fbit(s.x) + ',' + fbit(s.z) + ',' + fbit(s.y) + ',' + fbit(s.cam);
  const LEV = [[s0]]; const SEEN = new Set([vkey(s0)]); const fcap = o.frontierCap ?? 1.5e6; const Dmax = o.D ?? 3; const NG = C.G.length;
  let nodesGpu = 0, gpuMiss = 0; const nodesAll = () => C.nodes() + nodesPool + nodesGpu;
  for (let D = 0; D <= Dmax && !stop(); D++) {
    while (LEV.length - 1 < D) { const cur = LEV[LEV.length - 1]; if (cur.length * NG > fcap * 40) break; const nx = [];
      for (let i = 0; i < cur.length && !stop(); i++) { for (let gi = 0; gi < NG; gi++) { if (C.G[gi].tw && cur[i].ntw >= TWCAP) continue; const c = C.fstep(cur[i], gi); if (!c) continue; const k = vkey(c); if (SEEN.has(k)) continue; SEEN.add(k); nx.push(c); }
        if ((i & 255) === 0) { prog(0.3 + 0.7 * D / (Dmax + 1), `${tableInfo}. Forward: building depth ${LEV.length} (${nx.length.toLocaleString()} new spots) · ${hits.length} routes${thr}`); await tick(); } }
      if (stop()) break; LEV.push(nx); if (nx.length > fcap) break; }
    const Pf = Math.min(D, LEV.length - 1); const tail = D - Pf; const base = LEV[Pf];
    const fmsg = (i) => `${tableInfo}. Forward: ${D} move${D === 1 ? '' : 's'} before the table (${i.toLocaleString()} of ${base.length.toLocaleString()}) · ${nodesAll().toLocaleString()} spots checked · ${hits.length} route${hits.length === 1 ? '' : 's'}${gpu ? gtxt : thr}`;
    if (gpu && tail > 0) {
      // the CPU walks any moves beyond 3 (no dedupe), the GPU does the last 1-3 moves of each tail
      const gt = Math.min(3, tail), pre = tail - gt; const per = gpu.perDispatch(gt); let batch = [];
      const flush = async () => { if (!batch.length) return; const b = batch; batch = []; const r = await gpu.run(b, gt); nodesGpu += r.nodes;
        for (const h of r.hits) { const path = b[h.si].path.concat(h.g); // re-check on the CPU with the exact models
          let s = s0, ok = true; for (const gi of path) { s = C.fstep(s, gi); if (!s) { ok = false; break; } }
          let conf = false; if (ok) C.checknode(s, (_s, e, f) => { if (e === h.entry && f === h.fin) conf = true; });
          if (conf) report(path, h.entry, h.fin, fbit(s.y)); else gpuMiss++; } };
      const walk = async (s, left) => { if (stop()) return; if (left === 0) { batch.push(s); if (batch.length >= per) { await flush(); await tick(); } return; }
        for (let gi = 0; gi < NG; gi++) { if (C.G[gi].tw && s.ntw >= TWCAP) continue; const c = C.fstep(s, gi); if (c) await walk(c, left - 1); if (stop()) return; } };
      for (let i = 0; i < base.length && !stop(); i++) { await walk(base[i], pre); if ((i & 15) === 0) { prog(0.3 + 0.7 * (D + i / base.length) / (Dmax + 1), fmsg(i)); await tick(); } }
      if (!stop()) await flush();
    } else if (pool && tail > 0) {
      const per = Math.max(1, Math.round(4000 / Math.pow(NG, tail - 1) / Math.max(1, NG / 54))); let done = 0; const jobs = [];
      for (let i = 0; i < base.length; i += per) { const sl = base.slice(i, i + per); const st = new Float32Array(sl.length * 4), nt = new Uint8Array(sl.length), pl = new Uint16Array(sl.length * Math.max(1, Pf));
        sl.forEach((s, q) => { st[q * 4] = s.x; st[q * 4 + 1] = s.z; st[q * 4 + 2] = s.y; st[q * 4 + 3] = s.cam; nt[q] = s.ntw; s.path.forEach((g, k) => { pl[q * Math.max(1, Pf) + k] = g; }); });
        jobs.push(pool.run({ type: 'fwd', st, nt, pl, plen: Pf, tail }).then(r => { nodesPool += r.nodes; for (const h of r.hits) report(h.path, h.entry, h.fin, h.yb); done += sl.length; prog(0.3 + 0.7 * (D + done / base.length) / (Dmax + 1), fmsg(done)); })); }
      let fin = false; Promise.all(jobs).then(() => { fin = true; }); while (!fin) { if (stop()) { pool.clear(); break; } await new Promise(r => setTimeout(r, 100)); }
    } else {
      for (let i = 0; i < base.length && !stop(); i++) { C.dfs(base[i], tail, localHit, stop);
        if ((i & 15) === 0) { prog(0.3 + 0.7 * (D + i / base.length) / (Dmax + 1), fmsg(i)); await tick(); } } }
  }
  if (gpu) gpu.destroy();
  prog(1, `Done: ${tableInfo}. ${nodesAll().toLocaleString()} forward spots checked, ${hits.length} route${hits.length === 1 ? '' : 's'} · ${((Date.now() - t0) / 1000).toFixed(0)} s${gpu ? gtxt : thr}${gpuMiss ? ` · ${gpuMiss} GPU hit${gpuMiss > 1 ? 's' : ''} did not hold up on the CPU (dropped)` : ''}`);
  return { hits, nodes: nodesAll(), table: NT, tableInfo };
}

// ---- generic floor model for a room: cells of flat floor at Banjo's height y0, at least R from any wall, ledge, slope or object
function floorMask(world, y0, o = {}) {
  const cell = o.cell ?? 2, R = o.R ?? 45, band = o.band ?? [2, 150];
  const tris = []; const addL = (cl, M) => { if (!cl) return; for (const t of cl.tris) tris.push({ v: M ? t.v.map(p => M.apply(p)) : t.v, n: t.unitN, rot: !!M }); };
  addL(world.opa); addL(world.xlu); for (const p of world.props || []) addL(p.cl, p.M);
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; const walk = [];
  for (const t of tris) { const flat = t.v.every(p => Math.abs(p[1] - y0) < 0.5) && (t.rot ? Math.abs((t.v[1][0] - t.v[0][0]) * (t.v[2][2] - t.v[0][2]) - (t.v[2][0] - t.v[0][0]) * (t.v[1][2] - t.v[0][2])) > 1e-6 : t.n[1] > 0.9999);
    if (flat) { walk.push(t); for (const p of t.v) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); } } }
  if (!walk.length) return null;
  x0 = Math.floor(x0 - R - cell); z0 = Math.floor(z0 - R - cell); x1 += R + cell; z1 += R + cell;
  const W = Math.ceil((x1 - x0) / cell) + 1, H = Math.ceil((z1 - z0) / cell) + 1; if (W * H > 2.5e7) return null;
  const good = new Uint8Array(W * H), bad = new Uint8Array(W * H);
  const cx = i => x0 + (i + 0.5) * cell, cz = j => z0 + (j + 0.5) * cell;
  const inTri = (px, pz, v) => { const s = (a, b) => (b[0] - a[0]) * (pz - a[2]) - (b[2] - a[2]) * (px - a[0]); const d1 = s(v[0], v[1]), d2 = s(v[1], v[2]), d3 = s(v[2], v[0]); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  const fill = (v, arr) => { const ix0 = Math.max(0, Math.floor((Math.min(v[0][0], v[1][0], v[2][0]) - x0) / cell)), ix1 = Math.min(W - 1, Math.floor((Math.max(v[0][0], v[1][0], v[2][0]) - x0) / cell));
    const jz0 = Math.max(0, Math.floor((Math.min(v[0][2], v[1][2], v[2][2]) - z0) / cell)), jz1 = Math.min(H - 1, Math.floor((Math.max(v[0][2], v[1][2], v[2][2]) - z0) / cell));
    for (let j = jz0; j <= jz1; j++) for (let i = ix0; i <= ix1; i++) if (inTri(cx(i), cz(j), v)) arr[j * W + i] = 1;
    if (arr === bad) for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3]; const L = Math.hypot(b[0] - a[0], b[2] - a[2]); const n = Math.max(1, Math.ceil(L / (cell / 2)));
      for (let k = 0; k <= n; k++) { const px = a[0] + (b[0] - a[0]) * k / n, pz = a[2] + (b[2] - a[2]) * k / n; const i = Math.floor((px - x0) / cell), j = Math.floor((pz - z0) / cell); if (i >= 0 && j >= 0 && i < W && j < H) bad[j * W + i] = 1; } } };
  for (const t of walk) fill(t.v, good);
  for (const t of tris) { if (walk.includes(t)) continue; const ylo = Math.min(t.v[0][1], t.v[1][1], t.v[2][1]), yhi = Math.max(t.v[0][1], t.v[1][1], t.v[2][1]); if (yhi < y0 + band[0] || ylo > y0 + band[1]) continue; fill(t.v, bad); }
  // distances (in cells): to the nearest cell off the flat floor (the floor ray only looks under Banjo's centre) and to the nearest
  // wall / object / raised surface (Banjo's body)
  const INF = 1e9, D1 = 1, D2 = Math.SQRT2;
  const dt = (src) => { const dist = new Float32Array(W * H); for (let i = 0; i < W * H; i++) dist[i] = src(i) ? INF : 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; let d = dist[k]; if (!d) continue; if (i > 0) d = Math.min(d, dist[k - 1] + D1); if (j > 0) { d = Math.min(d, dist[k - W] + D1); if (i > 0) d = Math.min(d, dist[k - W - 1] + D2); if (i < W - 1) d = Math.min(d, dist[k - W + 1] + D2); } dist[k] = d; }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) { const k = j * W + i; let d = dist[k]; if (!d) continue; if (i < W - 1) d = Math.min(d, dist[k + 1] + D1); if (j < H - 1) { d = Math.min(d, dist[k + W] + D1); if (i < W - 1) d = Math.min(d, dist[k + W + 1] + D2); if (i > 0) d = Math.min(d, dist[k + W - 1] + D2); } dist[k] = d; }
    return dist; };
  const dF = dt(i => good[i]), dO = dt(i => !bad[i]); const rf = (o.edge ?? 1) / cell + 1;
  const ok = new Uint8Array(W * H); let n = 0, bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9; const rc = R / cell + 1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (dF[k] >= rf && dO[k] >= rc) { ok[k] = 1; n++; bx0 = Math.min(bx0, cx(i)); bx1 = Math.max(bx1, cx(i)); bz0 = Math.min(bz0, cz(j)); bz1 = Math.max(bz1, cz(j)); } }
  const okAt = (x, z) => { const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell); return i >= 0 && j >= 0 && i < W && j < H && ok[j * W + i] === 1; };
  return { okAt, cells: n, area: n * cell * cell, bbox: [bx0 - 10, bz0 - 10, bx1 + 10, bz1 + 10], W, H, x0, z0, cell, ok };
}

// ---- replay a hit in the full engine (bkmove.js on the real room) and test the final cancel for a hold / clip
const STEPIN = {
  0: () => [{ B: true }],
  1: () => [{ B: true }, { A: true }],
  2: () => { const r = [{ B: true }]; for (let i = 0; i < 15; i++) r.push({}); for (let i = 0; i < 200; i++) r.push({ Z: true }); return r; },
  3: () => { const r = [{ Z: true }, { Z: true, B: true }]; for (let i = 0; i < 50; i++) r.push({ Z: true }); return r; },
  4: () => { const r = [{ Z: true }, { Z: true, B: true }]; for (let i = 0; i < 5; i++) r.push({ Z: true }); return r; },
  5: () => { const r = [{ Z: true }, { Z: true, B: true }]; for (let i = 0; i < 12; i++) r.push({ Z: true, B: true }); for (let i = 0; i < 60; i++) r.push({ Z: true }); return r; },
};
const STEPDESC = ['punch', 'punch cancel (B, A on the next update)', 'punch, then hold Z', 'beak barge, Z kept', 'beak barge, Z released', 'beak barge, B held'];
function verify(world, o, hit) {
  const G = typeof self !== "undefined" ? self : globalThis; const BM = G.BKMOVE, BS = G.BKSEARCH, BC = G.BKCHAIN; const E = make(o);
  const T = { x: bitf(o.target.xb), z: bitf(o.target.zb), y: o.target.y ?? 0 };
  const P = new BM.Player(world, { map: o.map, pos: [F(o.start.x), F(o.start.y ?? 0), F(o.start.z)], vel: [0, 0, 0], yaw: F(o.start.yaw), cam: F(o.start.cam), version: o.version || 'PAL', grounded: true, state: BM.S.IDLE });
  P.ideal = P.yaw; P.tyaw = P.yaw;
  let mx = F(o.start.x), mz = F(o.start.z), my = F(o.start.yaw), mcam = F(o.start.cam); let ins = [], path = [P.pos.slice()], chain = [], match = true, firstOff = -1;
  const steps = hit.steps; const last = steps.length - 1;
  for (let i = 0; i < last; i++) { const st = steps[i];
    const y = st.tw ? twyaw(my, st.tw) : st.cf != null ? E.cfyaw(mcam, st.cf) : my;
    const turnIn = st.tw ? [{ fp: st.tw }] : st.cf != null ? [{ face: y }] : [];
    const rows = []; for (const u of turnIn) { rows.push(P.step(u, 2)); ins.push(u); }
    const mi = STEPIN[st.m](); const n = BC.play(P, mi, 80, rows); if (n == null) { match = false; firstOff = i; break; }
    for (let k = 0; k < n; k++) ins.push(k < mi.length ? mi[k] : {});
    for (const r of rows) path.push(r.pos);
    const r = E.domove(mx, mz, y, st.m); if (r) { mx = r[0]; mz = r[1]; } my = y; mcam = E.camnext(mcam, mx, mz);
    if (match && (fbit(P.pos[0]) !== fbit(mx) || fbit(P.pos[2]) !== fbit(mz))) { match = false; firstOff = i; }
    chain.push(`${st.tw ? `first-person twirl ${st.tw > 0 ? 'left' : 'right'} ${Math.abs(st.tw)} (${(Math.abs(st.tw) * 3.6).toFixed(1)}°), pause buffer` : st.cf != null ? `crouch, stick ${DN[st.cf]} → facing ${y.toFixed(6)}°` : 'no turn'}, ${STEPDESC[st.m]}`); }
  // final: (turn) + B, A held h, then nothing; hold / clip, with a lag update on each of the 4 updates from the first hold
  const st = steps[last]; const yF = st.tw ? twyaw(my, st.tw) : st.cf != null ? E.cfyaw(mcam, st.cf) : my;
  const turnF = st.tw ? [{ fp: st.tw }] : st.cf != null ? [{ face: yF }] : [];
  const fdesc = `${st.tw ? `first-person twirl ${st.tw > 0 ? 'left' : 'right'} ${Math.abs(st.tw)}, pause buffer` : st.cf != null ? `crouch, stick ${DN[st.cf]} → facing ${yF.toFixed(6)}°` : 'no turn'}, punch cancel onto the crack`;
  const out = []; if (!match) return { match, firstOff, results: [] };
  for (const h of o.finalA || [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14]) {
    const run = (lagAt) => { const Q = BS.clone(P); const rows = [], ups = []; for (const u of turnF) { rows.push(Q.step(u, 2)); ups.push(u); }
      const fin = [{ B: true }]; for (let i = 0; i < h; i++) fin.push({ A: true }); for (let i = 0; i < 40; i++) fin.push({});
      let fh = -1; for (let i = 0; i < fin.length; i++) { const u = Object.assign({}, fin[i]); if (i === lagAt) u.frames = 3; ups.push(u); const r = Q.step(u, u.frames || 2); rows.push(r);
        if (r.held && fh < 0 && Math.hypot(r.pos[0] - T.x, r.pos[2] - T.z) < 3) fh = i; if (r.pos[1] < T.y - 400) break; }
      return { rows, ups, fh, clip: fh >= 0 && stayedUnder(rows, fh, T.y), holds: rows.filter(r => r.held).length }; };
    let r = run(-1); let lag = null;
    if (r.fh >= 0 && !r.clip && o.lag !== false) for (let L = r.fh; L < r.fh + 4; L++) { const r2 = run(L + 0); if (r2.clip) { lag = L - r.fh; r = r2; break; } }
    if (r.fh < 0) continue;
    const allInputs = ins.concat(r.ups); const frames = allInputs.reduce((a, u) => a + (u.fp ? 86 + 2 * Math.abs(u.fp) : (u.frames || 2)), 0);
    out.push({ kind: r.clip ? 'clip' : 'hold', holds: r.holds, move: 'Exact route', desc: `${hit.text} · final A held ${h}`, key: 'exact', chain: chain.concat([`${fdesc}, A held ${h}`]),
      rows: r.rows, start: o.start, allInputs, holdAt: r.rows[r.fh].pos.slice(), fromCrack: 0, lag, legs: null, moves: steps.length, updates: allInputs.length, frames,
      path: path.concat(r.rows.map(q => q.pos)), score: (r.clip ? 1000 : 0) + r.holds * 10 - steps.length }); }
  if (!out.length) { // reaches the crack, but no A length holds there
    out.push({ kind: 'reach', holds: 0, move: 'Exact route (reaches the crack)', desc: `${hit.text} · lands on the crack; no A length held there`, key: 'exact', chain: chain.concat([fdesc]), rows: [], start: o.start, allInputs: ins.concat(turnF, [{ B: true }, { A: true }]),
      holdAt: [T.x, T.y, T.z], fromCrack: 0, lag: null, legs: null, moves: steps.length, updates: ins.length + 2, frames: 0, path, score: -steps.length }); }
  return { match, firstOff, results: out };
}

// ---- the whole exact search for the page / worker: floor model from the room, search, replay every hit in the full engine
async function runExact(o) {
  const world = o.world; const st = o.start; const y0 = F(st.pos[1]);
  const t0 = Date.now(); o.onProgress && o.onProgress(0, 'Mapping the flat floor at Banjo\'s height…');
  const mask = floorMask(world, y0, { R: o.clearance ?? 30 });
  if (!mask) throw new Error('Banjo\'s start is not on flat floor (the exact move models need a flat floor at his height).');
  if (!mask.okAt(st.pos[0], st.pos[2])) throw new Error(`The start is off the modelled floor: it is within ${o.clearance ?? 30} of a wall, edge or object (lower "Keep Banjo this far from walls").`);
  const tx = F(o.target.x), tz = F(o.target.z);
  if (Math.abs((o.target.y ?? y0) - y0) > 0.5) throw new Error(`The target crack is at y ${(+o.target.y).toFixed(3)}, but Banjo starts at y ${y0.toFixed(3)}: the exact search needs both on the same flat floor.`);
  const E0 = make({ camX: o.camX, camZ: o.camZ, floorOK: mask.okAt }); const cam = o.startCam == null || !isFinite(o.startCam) ? E0.camyaw(F(st.pos[0]), F(st.pos[2])) : F(o.startCam);
  const moves = o.exMoves || [true, true, true, true, true, true];
  // worker threads: every core but one (the visitor's own computer does the search)
  let pool = null; const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1; const nThreads = Math.max(0, Math.min(o.threads ?? (hc - 1), 32));
  const cfgData = { camX: o.camX, camZ: o.camZ, mask: { ok: mask.ok, W: mask.W, H: mask.H, x0: mask.x0, z0: mask.z0, cell: mask.cell }, bbox: mask.bbox, target: { xb: fbit(tx), zb: fbit(tz) }, R: o.R ?? 3, moves: o.exMoves || [true, true, true, true, true, true], twirlCap: o.twirlCap ?? 0, twirlMax: o.twirlMax ?? 50 };
  if (nThreads > 1 && typeof Worker !== 'undefined') { try { pool = makePool(nThreads, cfgData, o.workerUrl); } catch (e) { pool = null; } }
  const eo = { pool, useGpu: !!o.useGpu, mask: cfgData.mask, twirlMax: o.twirlMax ?? 50, camX: o.camX, camZ: o.camZ, floorOK: mask.okAt, bbox: mask.bbox, target: { xb: fbit(tx), zb: fbit(tz), y: y0 }, start: { x: F(st.pos[0]), z: F(st.pos[2]), y: y0, yaw: F(st.yaw || 0), cam },
    R: o.R ?? 3, D: o.D ?? 3, moves, twirlCap: o.twirlCap ?? 0, twirlMax: o.twirlMax ?? 50, seconds: o.seconds, map: o.map, version: o.version, lag: o.lag, shouldStop: o.shouldStop };
  let mism = 0, shown = 0, routes = 0; let lastTxt = '';
  eo.onProgress = (f, t) => { lastTxt = t; o.onProgress && o.onProgress(f, t + (routes ? ` · ${shown} replayed in the engine` : '') + (mism ? ` · ${mism} left the flat-floor model in the engine (skipped)` : '')); };
  eo.onHit = (h) => { routes++; const v = verify(world, eo, h); if (!v.match) { mism++; return; }
    for (const r of v.results) { shown++; r.cam = cam; o.onPath && o.onPath(r.path, r.kind === 'clip' ? 'clip' : 'hold'); delete r.path; o.onResult && o.onResult(r); } };
  let out; try { out = await search(eo); } finally { if (pool) pool.terminate(); }
  o.onProgress && o.onProgress(1, `${lastTxt.replace(/^Done: /, 'Done: ')} · start camera ${cam.toFixed(6)}°${mism ? ` · ${mism} route${mism > 1 ? 's' : ''} left the flat-floor model when replayed (skipped)` : ''}`);
  return { closest: out.hits.length ? 0 : 1e9, routes: out.hits.length, nodes: out.nodes };
}
const api = { make, core, makePool, maskOK, runExact, verify, floorMask, search, invadd, invchain, fbit, bitf, sinf, cosf, yawT, twyaw, nrmA, adiff, ANGD, DN, MN, MLONG };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKEXACT = api;
})(typeof self !== 'undefined' ? self : this);
