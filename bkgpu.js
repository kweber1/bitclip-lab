// bkgpu.js -- WebGPU accelerator for the exact search (bkexact.js): runs the forward move tails on the visitor's graphics card.
// The GPU has no doubles and its compilers may fuse a*b+c, so the shader
//  - puts a "barrier" (xor with a runtime zero) on every product, so no multiply-add can be fused,
//  - computes the game's double-precision sinf/cosf and degree conversion in double-float (two f32s, ~48 bits),
//  - rounds sqrt and division correctly by checking the neighbouring floats with exact (Dekker) products.
// Every route the GPU reports is re-played on the CPU with the exact JavaScript models before it is shown, so a rare rounding
// difference can only lose a route, never show a wrong one.
(function (root) {
'use strict';
const F = Math.fround; const _fb = new Float32Array(1), _ub = new Uint32Array(_fb.buffer);
const fbit = f => { _fb[0] = f; return _ub[0]; }, bitf = u => { _ub[0] = u >>> 0; return _fb[0]; };
const n64d = (h, l) => { const dv = new DataView(new ArrayBuffer(8)); dv.setUint32(0, h); dv.setUint32(4, l); return dv.getFloat64(0); };
const split = d => { const hi = F(d); return [hi, F(d - hi)]; };  // a double as hi + lo floats
const dfc = (name, d) => { const [h, l] = split(d); return `const ${name} = DF(${h.toPrecision(9)}, ${l.toPrecision(9)});`; };

function shader() {
  const NP = [n64d(0x3ff00000, 0), n64d(0xbfc55554, 0xbc83656d), n64d(0x3f8110ed, 0x3804c2a0), n64d(0xbf29f6ff, 0xeea56814), n64d(0x3ec5dbdf, 0x0e314bfe)];
  const NRPI = n64d(0x3fd45f30, 0x6dc9c883), NPIHI = n64d(0x400921fb, 0x50000000), NPILO = n64d(0x3e6110b4, 0x611a6263);
  const GDEG = 3.141592654 / 180.0;
  return /* wgsl */`
struct Params { camX: f32, camZ: f32, DT: f32, K29: f32, SC: f32, zero: u32, TX: u32, TZ: u32,
  nStates: u32, tail: u32, NG: u32, TWCAP: u32, TWM: u32, maskW: u32, maskH: u32, x0: f32,
  z0: f32, invCell: f32, QM: u32, hasC1: u32, maxHits: u32, bbx: u32, bby: u32, mode: u32 };
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> states: array<u32>;   // 5 words per state: x, z, y, cam (bits), twirls used
@group(0) @binding(2) var<storage, read> digits: array<u32>;   // per digit: (twirl + 128) | turn << 8 | move << 16
@group(0) @binding(3) var<storage, read> maskb: array<u32>;    // floor cells, 1 bit each
@group(0) @binding(4) var<storage, read> cst: array<u32>;      // ATAB[10001], acos values[10001] (f32 bits), tm/0.3 table[80]
@group(0) @binding(5) var<storage, read> tab: array<vec4<u32>>; // backward table: x, z, camera, facing bits
@group(0) @binding(6) var<storage, read> hsh: array<i32>;      // heads[QM+1] then next[n]
@group(0) @binding(7) var<storage, read_write> outb: array<atomic<u32>>; // [0] hits, [1] nodes lo, [2] nodes hi, then 8 words per hit

// ---- barrier: no product may be fused into an add (P.zero is 0 at run time, but the compiler cannot know that)
fn B(x: f32) -> f32 { return bitcast<f32>(bitcast<u32>(x) ^ P.zero); }
fn mul(a: f32, b: f32) -> f32 { return B(a * b); }

// ---- double-float arithmetic (hi + lo)
struct DF { hi: f32, lo: f32 };
fn two_sum(a: f32, b: f32) -> DF { let s = B(a + b); let bb = B(s - a); let err = B(B(a - B(s - bb)) + B(b - bb)); return DF(s, err); }
fn quick_two_sum(a: f32, b: f32) -> DF { let s = B(a + b); return DF(s, B(b - B(s - a))); }
fn splitf(a: f32) -> DF { let t = mul(4097.0, a); let hi = B(t - B(t - a)); return DF(hi, B(a - hi)); }
fn two_prod(a: f32, b: f32) -> DF { let p = mul(a, b); let A = splitf(a); let Bb = splitf(b);
  let err = B(B(B(B(mul(A.hi, Bb.hi) - p) + mul(A.hi, Bb.lo)) + mul(A.lo, Bb.hi)) + mul(A.lo, Bb.lo)); return DF(p, err); }
fn df_add(a: DF, b: DF) -> DF { var s = two_sum(a.hi, b.hi); let t = two_sum(a.lo, b.lo); s.lo = B(s.lo + t.hi); s = quick_two_sum(s.hi, s.lo); s.lo = B(s.lo + t.lo); return quick_two_sum(s.hi, s.lo); }
fn df_neg(a: DF) -> DF { return DF(-a.hi, -a.lo); }
fn df_sub(a: DF, b: DF) -> DF { return df_add(a, df_neg(b)); }
fn df_mul(a: DF, b: DF) -> DF { var p = two_prod(a.hi, b.hi); p.lo = B(p.lo + B(mul(a.hi, b.lo) + mul(a.lo, b.hi))); return quick_two_sum(p.hi, p.lo); }
fn df_f(a: f32) -> DF { return DF(a, 0.0); }
fn df_round(a: DF) -> f32 { return B(a.hi + a.lo); }

${NP.map((d, i) => dfc('NP' + i, d)).join('\n')}
${dfc('NRPI', NRPI)}
${dfc('NPIHI', NPIHI)}
${dfc('NPILO', NPILO)}
${dfc('GDEG', GDEG)}
fn poly(dx: DF) -> DF { let xsq = df_mul(dx, dx); let p = df_add(df_mul(df_add(df_mul(df_add(df_mul(NP4, xsq), NP3), xsq), NP2), xsq), NP1); return df_add(dx, df_mul(df_mul(dx, xsq), p)); }
fn nround(d: DF) -> i32 { // (int)(d >= 0 ? d + 0.5 : d - 0.5)
  let h = select(-0.5, 0.5, d.hi >= 0.0); let v = df_add(two_sum(d.hi, h), df_f(d.lo)); var t = trunc(v.hi); let rest = B(B(v.hi - t) + v.lo);
  if (v.hi >= 0.0 && rest < 0.0) { t = t - 1.0; } if (v.hi < 0.0 && rest > 0.0) { t = t + 1.0; } return i32(t); }
// libultra sinf / cosf (ultralib gu/sinf.c, cosf.c), double steps in double-float
fn n64sinf(x: f32) -> f32 { let ix = bitcast<u32>(x); let xpt = (ix >> 22u) & 0x1ffu;
  if (xpt < 0xffu) { if (xpt >= 0xe6u) { return df_round(poly(df_f(x))); } return x; }
  if (xpt < 0x136u) { let dx0 = df_f(x); let n = nround(df_mul(dx0, NRPI)); let dn = df_f(f32(n));
    var dx = df_sub(dx0, df_mul(dn, NPIHI)); dx = df_sub(dx, df_mul(dn, NPILO)); let r = df_round(poly(dx)); return select(-r, r, (n & 1) == 0); }
  return 0.0; }
fn n64cosf(x: f32) -> f32 { let ix = bitcast<u32>(x); let xpt = (ix >> 22u) & 0x1ffu;
  if (xpt < 0x136u) { let ax = abs(x); let dx0 = df_f(ax); let n = nround(df_add(df_mul(dx0, NRPI), df_f(0.5))); let dn = df_sub(df_f(f32(n)), df_f(0.5));
    var dx = df_sub(dx0, df_mul(dn, NPIHI)); dx = df_sub(dx, df_mul(dn, NPILO)); let r = df_round(poly(dx)); return select(-r, r, (n & 1) == 0); }
  return 0.0; }
fn gdeg(y: f32) -> f32 { return df_round(df_mul(df_f(y), GDEG)); }

// ---- correctly rounded sqrt and division (pick the neighbour with the smallest exact residual)
fn nb(x: f32, k: i32) -> f32 { return bitcast<f32>(u32(i32(bitcast<u32>(x)) + k)); }
fn crsqrt(x: f32) -> f32 { let s = sqrt(x); var best = s; var be = 1e30;
  for (var k = -2; k <= 2; k++) { let c = nb(s, k); if (c < 0.0) { continue; } let e = abs(df_round(df_sub(df_f(x), two_prod(c, c)))); if (e < be) { be = e; best = c; } } return best; }
fn crdiv(a: f32, b: f32) -> f32 { let q = a / b; var best = q; var be = 1e30;
  for (var k = -2; k <= 2; k++) { let c = nb(q, k); let e = abs(df_round(df_sub(df_f(a), two_prod(c, b)))); if (e < be) { be = e; best = c; } } return best; }

// ---- game helpers
fn nrmA(a0: f32) -> f32 { var a = a0; if (a >= 360.0) { a = B(a - 360.0); } if (a < 0.0) { a = B(a + 360.0); } return a; }
fn atab(i: u32) -> u32 { return cst[i]; }
fn acosv(i: u32) -> f32 { return bitcast<f32>(cst[10001u + i]); }
fn tq(k: u32) -> f32 { return bitcast<f32>(cst[20002u + k]); }
fn acosf(x: f32) -> f32 { var lo = 0u; var up = 10000u; var idx = 10000u; let xa = abs(x);
  let p = two_prod(xa, 65535.0); var t = floor(p.hi); if (p.hi == t && p.lo < 0.0) { t = t - 1.0; } let tt = u32(t) & 0xffffu;
  loop { if (!(up - lo >= 2u && tt != atab(idx))) { break; } idx = (up + lo) >> 1u; if (tt < atab(idx)) { up = idx; } else { lo = idx; } }
  return acosv(idx); }
// yaw of (vx, vz), or -1 when shorter than 0.01
fn yawT(vx: f32, vz: f32) -> f32 { let h = crsqrt(B(mul(vz, vz) + mul(vx, vx))); if (h < 0.01) { return -1.0; }
  var a = acosf(crdiv(vx, h)); if (vz < 0.0) { a = B(180.0 - a); } if (vx < 0.0) { a = B(360.0 - a); } return a; }
fn camyaw(x: f32, z: f32) -> f32 { let y = yawT(B(P.camX - x), B(P.camZ - z)); return select(y, 0.0, y < 0.0); }
fn camnext(p: f32, x: f32, z: f32) -> f32 { let t = camyaw(x, z); let d = i32(bitcast<u32>(t)) - i32(bitcast<u32>(p)); if (d >= -2 && d <= 2) { return p; }
  var u = bitcast<u32>(t); if (t > p) { u = u - 2u; } else { u = u + 2u; } return bitcast<f32>(u); }
const ANGD = array<f32, 8>(90.0, 45.0, 0.009, 315.0, 270.0, 225.0, 179.991, 135.0);
fn cfyaw(cam: f32, d: u32) -> f32 { return nrmA(B(B(cam + ANGD[d]) + 90.0)); }
fn twyaw(y: f32, t: i32) -> f32 { var e = nrmA(B(y + 180.0)); let dd = select(-3.6, 3.6, t > 0); for (var i = 0; i < abs(t); i++) { e = nrmA(B(e + dd)); } return nrmA(B(e + 180.0)); }
fn adiff(a: f32, b: f32) -> f32 { var d = (b - a + 540.0) % 360.0; if (d < 0.0) { d += 360.0; } return d - 180.0; }
fn floorOK(x: f32, z: f32) -> bool { let fi = floor((x - P.x0) * P.invCell); let fj = floor((z - P.z0) * P.invCell);
  if (fi < 0.0 || fj < 0.0 || fi >= f32(P.maskW) || fj >= f32(P.maskH)) { return false; } let k = u32(fj) * P.maskW + u32(fi); return ((maskb[k >> 5u] >> (k & 31u)) & 1u) == 1u; }
fn upd(v: f32, t: f32) -> f32 { let d = B(mul(t, P.K29) - mul(v, P.K29)); return B(v + mul(d, P.SC)); }

// ---- one move: the exact flat-floor models of bkexact.js
struct Mv { ok: bool, x: f32, z: f32 };
struct St { vx: f32, vz: f32, x: f32, z: f32, ok: bool };
fn stp(s: ptr<function, St>, TX: f32, TZ: f32) { (*s).vx = upd((*s).vx, TX); (*s).vz = upd((*s).vz, TZ);
  let dx = mul((*s).vx, P.DT); let dz = mul((*s).vz, P.DT); (*s).x = B((*s).x + dx); (*s).z = B((*s).z + dz);
  if (abs((*s).vx) < 1e-4) { (*s).vx = 0.0; } if (abs((*s).vz) < 1e-4) { (*s).vz = 0.0; } if (!floorOK((*s).x, (*s).z)) { (*s).ok = false; } }
const BT = array<f32, 21>(500, 500, 500, 500, 500, 500, 420, 340, 260, 180, 180, 180, 180, 0, 0, 0, 0, 0, 0, 0, 0);
const BH = array<f32, 28>(850, 850, 850, 850, 850, 850, 850, 850, 770, 690, 610, 530, 450, 370, 290, 210, 130, 130, 130, 130, 0, 0, 0, 0, 0, 0, 0, 0);
fn domove(x: f32, z: f32, yaw: f32, mv: u32) -> Mv {
  let a = gdeg(yaw); let sn = n64sinf(a); let cs = n64cosf(a); let tx = mul(160.0, sn); let tz = mul(160.0, cs);
  var s = St(0.0, 0.0, x, z, true);
  if (mv == 0u || mv == 1u) { let N = select(60, 1, mv == 1u); for (var i = 1; i <= N; i++) { if (i <= 19) { stp(&s, tx, tz); } else { stp(&s, 0.0, 0.0); } if (!s.ok) { return Mv(false, 0.0, 0.0); } } return Mv(true, s.x, s.z); }
  var crouch = true;
  if (mv == 2u) { for (var i = 0; i < 19; i++) { stp(&s, tx, tz); } for (var i = 0; i < 14; i++) { stp(&s, 0.0, 0.0); } }
  else if (mv == 5u) { s.vx = mul(850.0, sn); s.vz = mul(850.0, cs); for (var i = 0; i < 28; i++) { stp(&s, mul(BH[i], sn), mul(BH[i], cs)); } }
  else { s.vx = mul(500.0, sn); s.vz = mul(500.0, cs); for (var i = 0; i < 21; i++) { stp(&s, mul(BT[i], sn), mul(BT[i], cs)); }
    if (mv == 4u) { crouch = false; for (var i = 0; i < 60; i++) { stp(&s, 0.0, 0.0); } } }
  if (!s.ok) { return Mv(false, 0.0, 0.0); }
  if (crouch) { stp(&s, 0.0, 0.0); let V0 = crsqrt(B(mul(s.vx, s.vx) + mul(s.vz, s.vz))); let ty = yawT(s.vx, s.vz); stp(&s, 0.0, 0.0);
    var s2 = 0.0; var c2 = 0.0; if (ty >= 0.0) { let b = gdeg(ty); s2 = n64sinf(b); c2 = n64cosf(b); }
    for (var k = 0u; k < 80u; k++) { var T = 0.0; if (ty >= 0.0) { T = mul(tq(k), V0); } if (T > V0) { T = V0; } stp(&s, mul(T, s2), mul(T, c2)); if (!s.ok) { break; } } }
  if (!s.ok) { return Mv(false, 0.0, 0.0); }
  return Mv(true, s.x, s.z); }

// ---- forward step by digit
struct S { x: f32, z: f32, y: f32, cam: f32, ntw: u32, ok: bool };
fn fstep(s: S, g: u32) -> S { let tw = i32(g & 0xffu) - 128; let r = (g >> 8u) & 0xffu; let m = (g >> 16u) & 0xffu; var y2 = s.y; var o = s; o.ok = false;
  if (tw != 0) { if (s.ntw >= P.TWCAP) { return o; } y2 = twyaw(s.y, tw); } else if (r != 0u) { y2 = cfyaw(s.cam, r - 1u); if (abs(adiff(s.y, y2)) < 8.0) { return o; } }
  let mvr = domove(s.x, s.z, y2, m); if (!mvr.ok) { return o; }
  return S(mvr.x, mvr.z, y2, camnext(s.cam, mvr.x, mvr.z), s.ntw + select(0u, 1u, tw != 0), true); }

// ---- hits
fn h2(a: u32, b: u32) -> u32 { var h = ((a ^ 0x9e3779b9u) * 0x85ebca6bu) ^ ((b + 0x7f4a7c15u) * 0xc2b2ae35u); h ^= h >> 15u; h = h * 0x2c1b3c6du; h ^= h >> 12u; return h & P.QM; }
fn pushHit(si: u32, g1: u32, g2: u32, g3: u32, entry: i32, fin: i32, yb: u32) { let i = atomicAdd(&outb[0], 1u); if (i >= P.maxHits) { return; } let b = 3u + i * 8u;
  atomicStore(&outb[b], si); atomicStore(&outb[b + 1u], g1); atomicStore(&outb[b + 2u], g2); atomicStore(&outb[b + 3u], g3); atomicStore(&outb[b + 4u], bitcast<u32>(entry)); atomicStore(&outb[b + 5u], bitcast<u32>(fin)); atomicStore(&outb[b + 6u], yb); }
fn c1hits(x: f32, z: f32, y3: f32) -> bool { let a = gdeg(y3); let sn = n64sinf(a); let cs = n64cosf(a); let vx = upd(0.0, mul(160.0, sn)); let vz = upd(0.0, mul(160.0, cs));
  return bitcast<u32>(B(x + mul(vx, P.DT))) == P.TX && bitcast<u32>(B(z + mul(vz, P.DT))) == P.TZ; }
fn checknode(s: S, si: u32, g1: u32, g2: u32, g3: u32) {
  let xb = bitcast<u32>(s.x); let zb = bitcast<u32>(s.z); let cb = bitcast<u32>(s.cam); let yb = bitcast<u32>(s.y);
  var i = hsh[h2(xb, zb)];
  loop { if (i < 0) { break; } let e = tab[u32(i)];
    if (e.x == xb && e.y == zb && e.z == cb) {
      if (yb == e.w) { pushHit(si, g1, g2, g3, i, 1, yb); } else if (abs(adiff(s.y, bitcast<f32>(e.w))) >= 8.0) { pushHit(si, g1, g2, g3, i, 0, yb); }
      if (P.TWCAP > 0u) { for (var t = 1; t <= i32(P.TWM); t++) { if (bitcast<u32>(twyaw(s.y, t)) == e.w) { pushHit(si, g1, g2, g3, i, 100 + t, yb); } if (bitcast<u32>(twyaw(s.y, -t)) == e.w) { pushHit(si, g1, g2, g3, i, 100 - t, yb); } } } }
    i = hsh[P.QM + 1u + u32(i)]; }
  if (P.hasC1 == 0u) { return; } let tx = bitcast<f32>(P.TX); let tz = bitcast<f32>(P.TZ); let dd = sqrt((s.x - tx) * (s.x - tx) + (s.z - tz) * (s.z - tz)); if (dd < 1.5 || dd > 3.2) { return; }
  for (var r = 0u; r <= 8u; r++) { var y3 = s.y; if (r > 0u) { y3 = cfyaw(s.cam, r - 1u); if (abs(adiff(s.y, y3)) < 8.0) { continue; } } if (c1hits(s.x, s.z, y3)) { pushHit(si, g1, g2, g3, -1, i32(r), yb); } }
  if (P.TWCAP > 0u) { for (var t = 1; t <= i32(P.TWM); t++) { if (c1hits(s.x, s.z, twyaw(s.y, t))) { pushHit(si, g1, g2, g3, -1, 100 + t, yb); } if (c1hits(s.x, s.z, twyaw(s.y, -t))) { pushHit(si, g1, g2, g3, -1, 100 - t, yb); } } } }

fn loadState(si: u32) -> S { let b = si * 5u; return S(bitcast<f32>(states[b]), bitcast<f32>(states[b + 1u]), bitcast<f32>(states[b + 2u]), bitcast<f32>(states[b + 3u]), states[b + 4u], true); }
// thread = (state, first digit [, second digit]); the third tail digit (tail 3) is a loop
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let NG = P.NG; let per = select(NG, NG * NG, P.tail >= 2u); let idx = gid.x + gid.y * (P.bbx * 64u); if (idx >= P.nStates * per) { return; }
  let si = idx / per; let rem = idx % per; let g1 = select(rem, rem / NG, P.tail >= 2u); let g2 = rem % NG;
  var nodes = 0u; let s0 = loadState(si);
  let s1 = fstep(s0, digits[g1]); if (!s1.ok) { return; }
  if (P.tail == 1u) { checknode(s1, si, g1, 0xffffu, 0xffffu); atomicAdd(&outb[1], 1u); return; }
  let s2 = fstep(s1, digits[g2]); if (!s2.ok) { return; }
  if (P.tail == 2u) { checknode(s2, si, g1, g2, 0xffffu); atomicAdd(&outb[1], 1u); return; }
  for (var g3 = 0u; g3 < NG; g3++) { let s3 = fstep(s2, digits[g3]); if (!s3.ok) { continue; } checknode(s3, si, g1, g2, g3); nodes++; }
  atomicAdd(&outb[1], nodes); }
// self-test: per state, run digit states[4] (as a raw digit) and report x, z, y, cam bits + ok
@compute @workgroup_size(64) fn test(@builtin(global_invocation_id) gid: vec3<u32>) { let i = gid.x; if (i >= P.nStates) { return; }
  let s = loadState(i); let g = s.ntw; var t = s; t.ntw = 0u; let r = fstep(t, g); let b = 3u + i * 8u;
  atomicStore(&outb[b], bitcast<u32>(r.x)); atomicStore(&outb[b + 1u], bitcast<u32>(r.z)); atomicStore(&outb[b + 2u], bitcast<u32>(r.y)); atomicStore(&outb[b + 3u], bitcast<u32>(r.cam)); atomicStore(&outb[b + 4u], select(0u, 1u, r.ok));
  let a = bitcast<f32>(states[i * 5u + 2u]); atomicStore(&outb[b + 5u], bitcast<u32>(n64sinf(a))); atomicStore(&outb[b + 6u], bitcast<u32>(n64cosf(a))); atomicStore(&outb[b + 7u], bitcast<u32>(camyaw(bitcast<f32>(states[i * 5u]), bitcast<f32>(states[i * 5u + 1u])))); }
`;
}

// ---- host side
async function makeGpu(o) {
  // o: { camX, camZ, mask:{ok,W,H,x0,z0,cell}, target:{xb,zb}, G (digits from bkexact core), twirlCap, twirlMax, hasC1, table:{n,xb,zb,cam,yb}, onLog }
  if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('This browser has no WebGPU.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!adapter) throw new Error('No WebGPU graphics adapter.');
  const L = adapter.limits; const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize, maxComputeWorkgroupsPerDimension: L.maxComputeWorkgroupsPerDimension } });
  let lost = null; device.lost.then(i => { lost = i.message || 'device lost'; });
  const module = device.createShaderModule({ code: shader() });
  const info = await module.getCompilationInfo(); const errs = info.messages.filter(m => m.type === 'error'); if (errs.length) throw new Error('WebGPU shader: ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
  const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, ...[1, 2, 3, 4, 5, 6].map(b => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } })), { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipe = device.createComputePipeline({ layout: pl, compute: { module, entryPoint: 'main' } });
  const pipeTest = device.createComputePipeline({ layout: pl, compute: { module, entryPoint: 'test' } });
  const buf = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength); return b; };
  const S = GPUBufferUsage.STORAGE;
  // constants: ATAB, acos values, tm/0.3
  const cst = new Uint32Array(20002 + 80);
  for (let i = 0; i <= 10000; i++) { const a = F(i * 90.0 / 10000 * Math.PI / 180); cst[i] = Math.trunc(F(F(Math.sin(a)) * 65535)) & 0xffff; cst[10001 + i] = fbit(F(i * 90.0 / 10000.0)); }
  { let tm = F(0.7); const DT = F(0.04); for (let k = 0; k < 80; k++) { tm = F(tm - DT); if (tm < 0) tm = 0; cst[20002 + k] = fbit(F(tm / F(0.3))); } }
  const m = o.mask; const bits = new Uint32Array(Math.ceil(m.W * m.H / 32)); for (let k = 0; k < m.W * m.H; k++) if (m.ok[k]) bits[k >> 5] |= 1 << (k & 31);
  const dig = new Uint32Array(o.G.map(g => ((g.tw + 128) & 0xff) | (g.r << 8) | (g.m << 16)));
  const n = o.table.n; const tab = new Uint32Array(Math.max(4, n * 4)); for (let i = 0; i < n; i++) { tab[i * 4] = o.table.xb[i]; tab[i * 4 + 1] = o.table.zb[i]; tab[i * 4 + 2] = o.table.cam[i]; tab[i * 4 + 3] = o.table.yb[i]; }
  const QM = (1 << Math.max(10, Math.ceil(Math.log2(n * 2 + 2)))) - 1; const hsh = new Int32Array(QM + 1 + Math.max(1, n)).fill(-1);
  const h2 = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) & QM; };
  for (let i = n - 1; i >= 0; i--) { const q = h2(o.table.xb[i], o.table.zb[i]); hsh[QM + 1 + i] = hsh[q]; hsh[q] = i; }
  const bMask = buf(bits, S), bCst = buf(cst, S), bDig = buf(dig, S), bTab = buf(tab, S), bHsh = buf(hsh, S);
  const MAXH = 1 << 16; const outSize = (3 + MAXH * 8) * 4;
  const bOut = device.createBuffer({ size: outSize, usage: S | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const bRead = device.createBuffer({ size: outSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const bU = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const params = (nStates, tail, bbx, mode) => { const ab = new ArrayBuffer(96), f = new Float32Array(ab), u = new Uint32Array(ab);
    f[0] = F(o.camX); f[1] = F(o.camZ); f[2] = F(0.04); f[3] = F(0.29); f[4] = F(F(0.04) / F(0.0333333)); u[5] = 0; u[6] = o.target.xb >>> 0; u[7] = o.target.zb >>> 0;
    u[8] = nStates; u[9] = tail; u[10] = o.G.length; u[11] = o.twirlCap || 0; u[12] = o.twirlMax || 50; u[13] = m.W; u[14] = m.H; f[15] = F(m.x0);
    f[16] = F(m.z0); f[17] = F(1 / m.cell); u[18] = QM; u[19] = o.hasC1 ? 1 : 0; u[20] = MAXH; u[21] = bbx; u[22] = 0; u[23] = mode; return ab; };
  const desc = adapter.info ? `${adapter.info.vendor || ''} ${adapter.info.architecture || ''} ${adapter.info.description || ''}`.trim() : 'GPU';
  async function dispatch(pipeline, stArr, nStates, tail, threads) {
    if (lost) throw new Error('WebGPU device lost: ' + lost);
    const bSt = buf(stArr, S); const WG = Math.ceil(threads / 64); const maxD = adapter.limits.maxComputeWorkgroupsPerDimension || 65535; const bbx = Math.min(WG, maxD); const bby = Math.ceil(WG / bbx);
    device.queue.writeBuffer(bU, 0, params(nStates, tail, bbx, 0)); device.queue.writeBuffer(bOut, 0, new Uint32Array(3));
    const bg = device.createBindGroup({ layout, entries: [bU, bSt, bDig, bMask, bCst, bTab, bHsh, bOut].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
    const enc = device.createCommandEncoder(); const pass = enc.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(bbx, bby); pass.end();
    enc.copyBufferToBuffer(bOut, 0, bRead, 0, outSize); device.queue.submit([enc.finish()]);
    await bRead.mapAsync(GPUMapMode.READ); const r = new Uint32Array(bRead.getMappedRange()).slice(); bRead.unmap(); bSt.destroy(); return r; }
  // run every `tail`-move tail from each state: states = [{x,z,y,cam,ntw}], returns hits [{si, g:[...], entry, fin, yb}] + nodes
  async function run(states, tail) { const NG = o.G.length; const per = tail >= 2 ? NG * NG : NG; const st = new Uint32Array(states.length * 5);
    states.forEach((s, i) => { st[i * 5] = fbit(s.x); st[i * 5 + 1] = fbit(s.z); st[i * 5 + 2] = fbit(s.y); st[i * 5 + 3] = fbit(s.cam); st[i * 5 + 4] = s.ntw; });
    const r = await dispatch(pipe, st, states.length, tail, states.length * per); const nh = Math.min(r[0], MAXH); const hits = [];
    for (let i = 0; i < nh; i++) { const b = 3 + i * 8; const g = [r[b + 1], r[b + 2], r[b + 3]].slice(0, tail); hits.push({ si: r[b], g, entry: r[b + 4] | 0, fin: r[b + 5] | 0, yb: r[b + 6] }); }
    return { hits, nodes: r[1] + r[2] * 4294967296, overflow: r[0] > MAXH }; }
  // self-test: per item {x,z,y,cam, gi}: GPU fstep + sin/cos of y + camyaw(x,z)
  async function test(items) { const st = new Uint32Array(items.length * 5); items.forEach((s, i) => { st[i * 5] = fbit(s.x); st[i * 5 + 1] = fbit(s.z); st[i * 5 + 2] = fbit(s.y); st[i * 5 + 3] = fbit(s.cam); st[i * 5 + 4] = dig[s.gi]; });
    const r = await dispatch(pipeTest, st, items.length, 0, items.length); return items.map((_, i) => { const b = 3 + i * 8; return { x: bitf(r[b]), z: bitf(r[b + 1]), y: bitf(r[b + 2]), cam: bitf(r[b + 3]), ok: !!r[b + 4], sin: bitf(r[b + 5]), cos: bitf(r[b + 6]), camyaw: bitf(r[b + 7]) }; }); }
  // how many states per dispatch keeps one dispatch short (the browser resets a GPU that hangs for a few seconds)
  return { run, test, desc, perDispatch: (tail) => { const NG = o.G.length; const per = tail >= 2 ? NG * NG : NG; const cost = tail >= 3 ? per * NG : per; return Math.max(1, Math.floor((tail >= 3 ? 3e6 : 4e6) / cost)); }, destroy: () => { try { device.destroy(); } catch (e) {} } };
}
const api = { makeGpu, shader };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKGPU = api;
})(typeof self !== 'undefined' ? self : this);
