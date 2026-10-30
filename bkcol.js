// bkcol.js -- JavaScript port of scripts/bk_collision_predict.py (Banjo-Kazooie player collision resolver,
// func_80293668 PAL 0x80293488) for the browser. Every single-precision operation is rounded with Math.fround,
// double-precision steps stay in double, mirroring the Python line by line.
(function (root) {
'use strict';
const F = Math.fround;
const fadd = (a, b) => F(a + b), fsub = (a, b) => F(a - b), fmul = (a, b) => F(a * b), fdiv = (a, b) => F(a / b);
const fsqrt = (x) => F(Math.sqrt(x));
const _b = new DataView(new ArrayBuffer(8));
function bits(x) { _b.setFloat32(0, x); return _b.getUint32(0); }
function hexd(hi, lo) { _b.setUint32(0, hi); _b.setUint32(4, lo); return _b.getFloat64(0); }

const v3 = (a) => [F(a[0]), F(a[1]), F(a[2])];
const vcopy = (a) => [a[0], a[1], a[2]];
const vsub = (a, b) => [fsub(a[0], b[0]), fsub(a[1], b[1]), fsub(a[2], b[2])];
const vadd = (a, b) => [fadd(a[0], b[0]), fadd(a[1], b[1]), fadd(a[2], b[2])];
const vscale = (a, s) => [fmul(a[0], s), fmul(a[1], s), fmul(a[2], s)];
const dot = (a, b) => fadd(fadd(fmul(a[0], b[0]), fmul(a[1], b[1])), fmul(a[2], b[2]));
const lensq = (a) => fadd(fadd(fmul(a[0], a[0]), fmul(a[1], a[1])), fmul(a[2], a[2]));
const cross = (a, b) => [fsub(fmul(a[1], b[2]), fmul(a[2], b[1])), fsub(fmul(a[2], b[0]), fmul(a[0], b[2])), fsub(fmul(a[0], b[1]), fmul(a[1], b[0]))];
function normalize(v) { const l2 = lensq(v); if (l2 !== 0) { const inv = F(1.0 / fsqrt(l2)); return vscale(v, inv); } return vcopy(v); }
function set_length(v, length) { const mag = fsqrt(lensq(v)); if (mag !== 0) return vscale(v, fdiv(F(length), mag)); return vcopy(v); }
const dist2 = (a, b) => lensq(vsub(a, b));
const absf = (x) => (x > 0 ? x : -x);
const is_nonzero = (v) => v[0] !== 0 || v[1] !== 0 || v[2] !== 0;
const c_int = (x) => Math.trunc(x);
function c_div(a, b) { const q = Math.floor(Math.abs(a) / Math.abs(b)); return ((a >= 0) === (b > 0)) ? q : -q; }

// ---- libultra sinf / cosf, acos table
const _P = [hexd(0x3ff00000, 0x00000000), hexd(0xbfc55554, 0xbc83656d), hexd(0x3f8110ed, 0x3804c2a0), hexd(0xbf29f6ff, 0xeea56814), hexd(0x3ec5dbdf, 0x0e314bfe)];
const _RPI = hexd(0x3fd45f30, 0x6dc9c883), _PIHI = hexd(0x400921fb, 0x50000000), _PILO = hexd(0x3e6110b4, 0x611a6263);
const _round = (d) => (d >= 0 ? Math.trunc(d + 0.5) : Math.trunc(d - 0.5));
function _poly(dx) { const xsq = dx * dx; const poly = ((_P[4] * xsq + _P[3]) * xsq + _P[2]) * xsq + _P[1]; return dx + (dx * xsq) * poly; }
function lib_sinf(x) {
  x = F(x); const xpt = (bits(x) >>> 22) & 0x1ff;
  if (xpt < 0xff) { if (xpt >= 0xe6) return F(_poly(x)); return x; }
  if (xpt < 0x136) { let dx = x; const n = _round(dx * _RPI); const dn = n; dx = dx - dn * _PIHI; dx = dx - dn * _PILO; const r = F(_poly(dx)); return (n & 1) === 0 ? r : -r; }
  return 0;
}
function lib_cosf(x) {
  x = F(x); const xpt = (bits(x) >>> 22) & 0x1ff;
  if (xpt < 0x136) { let dx = absf(x); const n = _round(dx * _RPI + 0.5); const dn = n - 0.5; dx = dx - dn * _PIHI; dx = dx - dn * _PILO; const r = F(_poly(dx)); return (n & 1) === 0 ? r : -r; }
  return 0;
}
let _ACOS = null;
function acos_table() {
  if (!_ACOS) { const M_PI = 3.14159265358979323846; _ACOS = new Uint16Array(10001);
    for (let i = 0; i <= 10000; i++) { const s = lib_sinf(F(i * 90.0 / 10000 * M_PI / 180)); _ACOS[i] = Math.trunc(fmul(s, 65535.0)) & 0xFFFF; } }
  return _ACOS;
}
function ml_acosf(x) {
  const tbl = acos_table(); const xa = x >= 0 ? x : -x; const target = Math.trunc(xa * 65535.0) & 0xFFFF;
  let lo = 0, hi = 10000, idx = 10000;
  while ((hi - lo >= 2) && target !== tbl[idx]) { idx = Math.floor((hi + lo) / 2); if (target < tbl[idx]) hi = idx; else lo = idx; }
  return F(idx * 90.0 / 10000.0);
}
const BAD_DTOR = 3.141592654 / 180.0;
const ml_cos_deg = (a) => lib_cosf(F(a * BAD_DTOR));
function sin_between(v1, v2) { const a = fsqrt(lensq(v1)), b = fsqrt(lensq(v2)); return fdiv(fsqrt(lensq(cross(v1, v2))), fmul(a, b)); }
function func_80259554(vec1, vec2, vec3) {
  let tmp1 = vsub(vec2, vec1); const tmp2 = vsub(vec3, vec1); const mag = fsqrt(lensq(tmp2));
  if (mag === 0) return vcopy(vec1);
  const tmp3 = ml_acosf(fdiv(fmul(sin_between(tmp1, tmp2), mag), mag));
  tmp1 = set_length(tmp1, fmul(ml_cos_deg(tmp3), mag));
  if (dot(tmp1, tmp2) > 0) return vadd(vec1, tmp1);
  return vsub(vec1, tmp1);
}
function func_802596AC(a1, a2, a3) {
  let a0 = func_80259554(a1, a2, a3); const a = dist2(a1, a2), b = dist2(a1, a0), c = dist2(a2, a0);
  if (a < b || a < c) a0 = (b < c) ? vcopy(a1) : vcopy(a2);
  return a0;
}
function nearest_on_edges(p, tri) {
  const s40 = func_802596AC(tri[0], tri[1], p), s34 = func_802596AC(tri[1], tri[2], p), s28 = func_802596AC(tri[2], tri[0], p);
  const d54 = dist2(s40, p), d50 = dist2(s34, p), d4c = dist2(s28, p);
  if (d54 < d50) return d4c < d54 ? vcopy(s28) : vcopy(s40);
  return d4c < d50 ? vcopy(s28) : vcopy(s34);
}
function project_on_plane(p, tri) {
  const n = normalize(cross(vsub(tri[1], tri[0]), vsub(tri[2], tri[0])));
  const s = fsub(dot(n, p), dot(n, tri[0]));
  return vsub(p, vscale(n, s));
}

// ---- collision lists
const _s32 = (x) => (x | 0);
class CollisionList {
  constructor(name, vertices, global_norm, header, cells, triangles) {
    this.name = name; this.V = vertices.map(v => v.map(a => a | 0)); this.global_norm = F(global_norm);
    if (!header) { this.min = [0, 0, 0]; this.max = [0, 0, 0]; this.y_stride = this.z_stride = 0; this.scale = 0; this.cells = [[0, triangles.length]]; }
    else { this.min = header.slice(0, 3); this.max = header.slice(3, 6); this.y_stride = header[6]; this.z_stride = header[7]; this.scale = header[9]; this.cells = cells.map(c => [c[0], c[1]]); }
    this.raw = triangles; this.tris = triangles.map((t, i) => this._tri(t, i)); this.V0 = this.V.map(v => v.slice()); this._vt = null;
  }
  _tri(t, i) { const vi = [this.V[t[0]], this.V[t[1]], this.V[t[2]]];
      const v = vi.map(p => [F(p[0]), F(p[1]), F(p[2])]);
      const ab = vsub(v[1], v[0]), ac = vsub(v[2], v[0]); const cr = cross(ab, ac); const L = F(100000.0);
      const lineN = (L < cr[0] || L < cr[1] || L < cr[2] || cr[0] < -L || cr[1] < -L || cr[2] < -L) ? [fdiv(cr[0], L), fdiv(cr[1], L), fdiv(cr[2], L)] : cr;
      const tmin = [0, 1, 2].map(j => Math.min(v[0][j], v[1][j], v[2][j])), tmax = [0, 1, 2].map(j => Math.max(v[0][j], v[1][j], v[2][j]));
      return { lst: this, idx: i, v, vi, unk6: t[3], flags: _s32(t[4]), ab, ac, lineN, unitN: normalize(cr), tmin, tmax }; }
  // animated vertices (mesh transforms, code_C5440.c: water waves etc. write the model bin's vertex list, which collision reads):
  // set vertex k to [x, y, z] (s16) and rebuild the triangles that use it
  setVerts(list) {
    if (!this._vt) { this._vt = this.V.map(() => []); this.raw.forEach((t, i) => { for (let j = 0; j < 3; j++) this._vt[t[j]].push(i); }); }
    const dirty = new Set();
    for (const [k, p] of list) { const v = this.V[k]; if (v[0] === p[0] && v[1] === p[1] && v[2] === p[2]) continue; v[0] = p[0]; v[1] = p[1]; v[2] = p[2]; for (const i of this._vt[k]) dirty.add(i); }
    for (const i of dirty) this.tris[i] = this._tri(this.raw[i], i);
    return dirty.size;
  }
  cells_for(mn, mx, is_float) {
    if (this.scale === 0) return [0];
    const ms = [0, 0, 0], xs = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      let a, b;
      if (is_float) { a = mn[i] >= 0 ? c_div(c_int(mn[i]), this.scale) : c_div(c_int(mn[i]), this.scale) - 1; b = mx[i] >= 0 ? c_div(c_int(mx[i]), this.scale) : c_div(c_int(mx[i]), this.scale) - 1; }
      else { a = mn[i] >= 0 ? c_div(mn[i], this.scale) : c_div(mn[i], this.scale) - 1; b = mx[i] >= 0 ? c_div(mx[i], this.scale) : c_div(mx[i], this.scale) - 1; }
      if (a < this.min[i]) a = this.min[i]; if (this.max[i] < a) a = this.max[i];
      if (b < this.min[i]) b = this.min[i]; if (this.max[i] < b) b = this.max[i];
      ms[i] = a - this.min[i]; xs[i] = b - this.min[i];
    }
    const out = [];
    for (let z = ms[2]; z <= xs[2]; z++) for (let y = ms[1]; y <= xs[1]; y++) for (let x = ms[0]; x <= xs[0]; x++) out.push(this.z_stride * z + x + y * this.y_stride);
    return out;
  }
  iter_tris(cells) { const out = []; for (const c of cells) { const cc = this.cells[c]; if (!cc) continue; const st = cc[0], n = cc[1]; for (let k = st; k < st + n; k++) out.push(this.tris[k]); } return out; }
}
function load_model(d, name) {
  if (!d || !d.collision) return null;
  return new CollisionList(name, d.vertices, d.vertex_header[11], d.collision.header, d.collision.cells, d.collision.triangles);
}

class World {
  constructor(opa, xlu, props, map) { this.opa = opa; this.xlu = xlu || null; this.stored = null; this.props = props || []; this.margin = F(CUBE_MARGIN[map] ?? 200); this._groups = null; this.timeline = null; }
  // recorded moving objects: timeline = { staticProps, at(frame) -> actor props, cursor, offset, frameTime }. tick(frames) puts the
  // props of the current emulator frame in place for the coming update, then moves the cursor on by that update's frames.
  tick(frames) { const t = this.timeline; if (!t) return; const p = t.at(t.cursor + (t.offset || 0)); if (p !== this._tl) { this._tl = p; this.props = t.staticProps.concat(p); this._groups = null; } t.cursor += frames; }
  // props grouped by cube; queries visit cubes in the game's order, then the global cube
  _propsFor(p1, p2, margin, zyx) {
    if (!this.props.length) return this.props;
    if (!this._groups) { this._groups = new Map(); this._global = []; for (const p of this.props) { if (!p.cube) this._global.push(p); else { const k = p.cube.join(','); if (!this._groups.has(k)) this._groups.set(k, []); this._groups.get(k).push(p); } }
      for (const g of [...this._groups.values(), this._global]) g.sort((a, b) => a.order - b.order); }
    const [mn, mx] = cube_range(p1, p2, margin); const out = []; const add = (x, y, z) => { const g = this._groups.get(x + ',' + y + ',' + z); if (g) out.push(...g); };
    if (zyx) { for (let z = mn[2]; z <= mx[2]; z++) for (let y = mn[1]; y <= mx[1]; y++) for (let x = mn[0]; x <= mx[0]; x++) add(x, y, z); }
    else { for (let x = mn[0]; x <= mx[0]; x++) for (let y = mn[1]; y <= mx[1]; y++) for (let z = mn[2]; z <= mx[2]; z++) add(x, y, z); }
    out.push(...this._global); return out;
  }
  _storeBack(p) { if (this.stored) this.stored = this.stored.map(v => p.M.apply(v)); }
  _propLine(p, start, end, n, filt) {
    if (!point_on_line(p.pos, p.gn, start, end)) return null;
    const os = p.W.apply(start), oe = p.W.apply(end); const t = this._cl_line(p.cl, os, oe, n, filt); if (!t) return null;
    const we = p.M.apply(oe); end[0] = we[0]; end[1] = we[1]; end[2] = we[2]; const nn = p.R.apply(n); n[0] = nn[0]; n[1] = nn[1]; n[2] = nn[2]; this._storeBack(p); return t;
  }
  _propMovingSphere(p, p1, p2, radius, n, steps, filt) {
    if (p.gn <= fsub(vdist(p2, p.pos), radius)) return null;
    const o1 = p.W.apply(p1), o2 = p.W.apply(p2); const t = this._cl_moving_sphere(p.cl, o1, o2, fdiv(radius, p.sc), n, steps, filt); if (!t) return null;
    const w = p.M.apply(o2); p2[0] = w[0]; p2[1] = w[1]; p2[2] = w[2]; const nn = p.R.apply(n); n[0] = nn[0]; n[1] = nn[1]; n[2] = nn[2]; this._storeBack(p); return t;
  }
  _propSphere(p, c, radius, n, filt) {
    if (p.gn <= fsub(vdist(c, p.pos), radius)) return null;
    const oc = p.W.apply(c); const t = this._cl_sphere(p.cl, oc, fdiv(radius, p.sc), n, filt); if (!t) return null;
    const w = p.M.apply(oc); c[0] = w[0]; c[1] = w[1]; c[2] = w[2]; const nn = p.R.apply(n); n[0] = nn[0]; n[1] = nn[1]; n[2] = nn[2]; this._storeBack(p); return t;
  }
  _store(tri) { if (tri) this.stored = [0, 1, 2].map(k => tri.vi[k].map(F)); }
  _cl_line(cl, start, end, normal_out, filt) {
    let res = null; const vr = cl.global_norm;
    const bounds = () => { const mn = [0, 0, 0], mx = [0, 0, 0];
      for (let i = 0; i < 3; i++) { if (start[i] < end[i]) { mn[i] = c_int(start[i]); mx[i] = c_int(end[i]); } else { mn[i] = c_int(end[i]); mx[i] = c_int(start[i]); } mn[i] -= 1; mx[i] += 1; }
      return [mn, mx, vsub(end, start)]; };
    let [mn, mx, d] = bounds();
    for (let i = 0; i < 3; i++) if (F(mx[i]) <= -vr || vr <= F(mn[i])) return null;
    const cells = cl.cells_for(mn, mx, false);
    for (const t of cl.iter_tris(cells)) {
      if (t.flags & filt) continue;
      const vi = t.vi;
      if (vi[0][0] < mn[0] && vi[1][0] < mn[0] && vi[2][0] < mn[0]) continue;
      if (vi[0][0] > mx[0] && vi[1][0] > mx[0] && vi[2][0] > mx[0]) continue;
      if (vi[0][2] < mn[2] && vi[1][2] < mn[2] && vi[2][2] < mn[2]) continue;
      if (vi[0][2] > mx[2] && vi[1][2] > mx[2] && vi[2][2] > mx[2]) continue;
      if (vi[0][1] < mn[1] && vi[1][1] < mn[1] && vi[2][1] < mn[1]) continue;
      if (vi[0][1] > mx[1] && vi[1][1] > mx[1] && vi[2][1] > mx[1]) continue;
      const tri = t.v; const ab = t.ab, ac = t.ac;
      let n = t.lineN;
      const ls = vsub(start, tri[0]), le = vsub(end, tri[0]); const a = dot(ls, n), b = dot(le, n);
      if (!(a >= 0 && b >= 0) && !(a <= 0 && b <= 0)) {
        if ((t.flags & 0x10000) && a < 0) n = [-n[0], -n[1], -n[2]];
        const nd = dot(n, d); const p = dot(tri[0], n);
        if (nd === 0) continue;
        const tt = fdiv(-fsub(dot(n, start), p), nd);
        if (tt <= 0 || tt >= 1) continue;
        const cur = [fadd(start[0], fmul(tt, d[0])), fadd(start[1], fmul(tt, d[1])), fadd(start[2], fmul(tt, d[2]))];
        let pa = absf(n[0]) > absf(n[1]) ? 0 : 1; pa = absf(n[2]) > absf(n[pa]) ? 2 : pa;
        const i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
        const f0 = fsub(cur[i1], tri[0][i1]), f1 = ab[i1], f2 = ac[i1];
        const e0 = fsub(cur[i2], tri[0][i2]), e1 = ab[i2], e2 = ac[i2];
        const den = fsub(fmul(f1, e2), fmul(e1, f2));
        const u = fdiv(fsub(fmul(f0, e2), fmul(e0, f2)), den);
        if (u < 0 || 1 < u) continue;
        const w = fdiv(fsub(fmul(f1, e0), fmul(e1, f0)), den);
        if (w < 0 || w > 1) continue;
        if (fadd(u, w) > 1) continue;
        res = t; end[0] = cur[0]; end[1] = cur[1]; end[2] = cur[2];
        const nn = normalize(n); normal_out[0] = nn[0]; normal_out[1] = nn[1]; normal_out[2] = nn[2];
        [mn, mx, d] = bounds();
      }
    }
    this._store(res);
    return res;
  }
  line(start, end, normal_out, filt) {
    let res;
    if (this.xlu) {
      let o = null;
      if (((filt & 0x80001F00) >>> 0) !== 0x80001F00) o = this._cl_line(this.opa, start, end, normal_out, filt);
      const x = this._cl_line(this.xlu, start, end, normal_out, filt);
      res = x || o;
    } else res = this._cl_line(this.opa, start, end, normal_out, filt);
    if (this.props.length) for (const p of this._propsFor(start, end, this.margin, true)) { const t = this._propLine(p, start, end, normal_out, filt); if (t) res = t; }
    return res;
  }
  _fast_check(cl, p1, p2, vel, margin, filt) {
    const mn = [0, 0, 0], mx = [0, 0, 0];
    for (let i = 0; i < 3; i++) { if (p1[i] < p2[i]) { mn[i] = p1[i]; mx[i] = p2[i]; } else { mn[i] = p2[i]; mx[i] = p1[i]; } mn[i] = fsub(mn[i], margin); mx[i] = fadd(mx[i], margin); }
    const vr = cl.global_norm;
    for (let i = 0; i < 3; i++) if (mx[i] <= -vr || mn[i] >= vr) return null;
    const cells = cl.cells_for(mn, mx, true); const act = [];
    outer: for (const c of cells) { const cc = cl.cells[c]; if (!cc) continue; const [st, cnt] = cc;
      for (let k = st; k < st + cnt; k++) {
        const t = cl.tris[k]; if (t.flags & filt) continue; const tc = t.v;
        const tmin = t.tmin, tmax = t.tmax;
        if (tmin[0] > mx[0] || tmax[0] < mn[0]) continue; if (tmin[1] > mx[1] || tmax[1] < mn[1]) continue; if (tmin[2] > mx[2] || tmax[2] < mn[2]) continue;
        const ab = t.ab, ac = t.ac; let n = t.unitN;
        if (t.flags & 0x10000) { if (dot(vsub(p1, tc[0]), n) < 0) n = [-n[0], -n[1], -n[2]]; }
        else if (dot(n, vel) > 0) continue;
        act.push([t, tc, ab, ac, n]);
        if (act.length > 100) break outer;
      } }
    return act;
  }
  static _iteration(act, pos, radius) {
    let coll = null; let nsum = [0, 0, 0]; const rd = radius - 0.5; const r2 = fmul(radius, radius);
    for (const ent of act) {
      const [t, tc, ab, ac, n] = ent; const s0 = vsub(pos, tc[0]); const theta = dot(s0, n);
      if (-rd >= theta || theta >= rd) continue;
      let nl = lensq(n); if (nl === 0) continue; nl = fdiv(-theta, nl);
      const pp = [fadd(pos[0], fmul(nl, n[0])), fadd(pos[1], fmul(nl, n[1])), fadd(pos[2], fmul(nl, n[2]))];
      let pa = absf(n[0]) > absf(n[1]) ? 0 : 1; pa = absf(n[2]) > absf(n[pa]) ? 2 : pa; const i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
      const a0 = fsub(pp[i1], tc[0][i1]), a1 = ab[i1], a2 = ac[i1], b0 = fsub(pp[i2], tc[0][i2]), b1 = ab[i2], b2 = ac[i2];
      const den = fsub(fmul(a1, b2), fmul(b1, a2)); const u = fdiv(fsub(fmul(a0, b2), fmul(b0, a2)), den); const w = fdiv(fsub(fmul(a1, b0), fmul(b1, a0)), den);
      if (0 <= u && u <= 1 && 0 <= w && w <= 1 && 0 <= fsub(1, fadd(u, w))) { coll = ent; nsum = vadd(nsum, n); continue; }
      let hit = false; const s = [];
      for (let i = 0; i < 3; i++) { const si = vsub(pos, tc[i]); s.push(si); if (lensq(si) < r2) { coll = ent; nsum = vadd(nsum, n); hit = true; break; } }
      if (hit) continue;
      for (let i = 0; i < 3; i++) { let e = vsub(tc[(i + 1) % 3], tc[i]); const el = lensq(e); e = normalize(e); const d0 = dot(e, s[i]);
        if (0 <= d0 && fmul(d0, d0) <= el) { const q = [fsub(s[i][0], fmul(d0, e[0])), fsub(s[i][1], fmul(d0, e[1])), fsub(s[i][2], fmul(d0, e[2]))];
          if (lensq(q) < r2) { coll = ent; nsum = vadd(nsum, n); break; } } }
    }
    return [coll, nsum];
  }
  _cl_moving_sphere(cl, p1, p2, radius, normal_out, steps, filt) {
    const vel = vsub(p2, p1); const act = this._fast_check(cl, p1, p2, vel, F(radius + 0.5), filt);
    if (!act || act.length === 0) return null;
    let [coll, tn] = World._iteration(act, p2, radius); if (!coll) return null;
    let normal = vcopy(tn); const dist_ = vsub(p2, p1); p2[0] = p1[0]; p2[1] = p1[1]; p2[2] = p1[2];
    let start = 0, end = 1;
    for (let s = 0; s < steps; s++) {
      const cur = F((start + end) * 0.5); const cp = [fadd(p1[0], fmul(cur, dist_[0])), fadd(p1[1], fmul(cur, dist_[1])), fadd(p1[2], fmul(cur, dist_[2]))];
      const [c2, tn2] = World._iteration(act, cp, radius);
      if (c2) { normal = vcopy(tn2); end = cur; coll = c2; } else { p2[0] = cp[0]; p2[1] = cp[1]; p2[2] = cp[2]; start = cur; }
    }
    normal = normalize(normal); normal_out[0] = normal[0]; normal_out[1] = normal[1]; normal_out[2] = normal[2];
    this._store(coll[0]); return coll[0];
  }
  moving_sphere(p1, p2, radius, normal_out, steps, filt) {
    const o = this._cl_moving_sphere(this.opa, p1, p2, radius, normal_out, steps, filt);
    let res = o;
    if (this.xlu) { const x = this._cl_moving_sphere(this.xlu, p1, p2, radius, normal_out, steps, filt); res = x || o; }
    if (this.props.length) for (const p of this._propsFor(p1, p2, fadd(radius, this.margin), false)) { const t = this._propMovingSphere(p, p1, p2, radius, normal_out, steps, filt); if (t) res = t; }
    return res;
  }
  _cl_sphere(cl, pos, radius, normal_out, filt) {
    const rp = radius + 0.5; const mn = [0, 1, 2].map(i => F(pos[i] - rp)), mx = [0, 1, 2].map(i => F(pos[i] + rp));
    const vr = cl.global_norm;
    for (let i = 0; i < 3; i++) if (mx[i] <= -vr || mn[i] >= vr) return null;
    let matched = null; let acc = [0, 0, 0]; const rd = radius - 0.5; const r2 = fmul(radius, radius);
    for (const t of cl.iter_tris(cl.cells_for(mn, mx, true))) {
      if (t.flags & filt) continue; const tc = t.v;
      const tmin = t.tmin, tmax = t.tmax;
      if (mx[0] < tmin[0] || tmax[0] < mn[0]) continue; if (mx[1] < tmin[1] || tmax[1] < mn[1]) continue; if (mx[2] < tmin[2] || tmax[2] < mn[2]) continue;
      const e0 = t.ab, e1 = t.ac; const n = t.unitN;
      if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue;
      const s0 = vsub(pos, tc[0]); const th = dot(s0, n);
      if (th <= -rd || rd <= th) continue;
      const l2 = lensq(n); if (l2 === 0) continue; const k = fdiv(-th, l2);
      const pp = [fadd(pos[0], fmul(k, n[0])), fadd(pos[1], fmul(k, n[1])), fadd(pos[2], fmul(k, n[2]))];
      let pa = absf(n[0]) > absf(n[1]) ? 0 : 1; pa = absf(n[2]) > absf(n[pa]) ? 2 : pa; const i1 = (pa + 1) % 3, i2 = (pa + 2) % 3;
      const a0 = fsub(pp[i1], tc[0][i1]), a1 = e0[i1], a2 = e1[i1], b0 = fsub(pp[i2], tc[0][i2]), b1 = e0[i2], b2 = e1[i2];
      const den = fsub(fmul(a1, b2), fmul(b1, a2)); const u = fdiv(fsub(fmul(a0, b2), fmul(b0, a2)), den);
      if (0 <= u && u <= 1) { const w = fdiv(fsub(fmul(a1, b0), fmul(b1, a0)), den); if (0 <= w && w <= 1 && fadd(u, w) <= 1) { matched = t; acc = vadd(acc, n); continue; } }
      let hit = false; const s = [];
      for (let i = 0; i < 3; i++) { const si = vsub(pos, tc[i]); s.push(si); if (lensq(si) < r2) { matched = t; acc = vadd(acc, n); hit = true; break; } }
      if (hit) continue;
      for (let i = 0; i < 3; i++) { let e = vsub(tc[(i + 1) % 3], tc[i]); const el = lensq(e); e = normalize(e); const d0 = dot(e, s[i]);
        if (d0 >= 0 && fmul(d0, d0) <= el) { const q = [fsub(s[i][0], fmul(d0, e[0])), fsub(s[i][1], fmul(d0, e[1])), fsub(s[i][2], fmul(d0, e[2]))];
          if (lensq(q) < r2) { matched = t; acc = vadd(acc, n); break; } } }
    }
    if (matched) { const nn = normalize(acc); normal_out[0] = nn[0]; normal_out[1] = nn[1]; normal_out[2] = nn[2]; }
    this._store(matched); return matched;
  }
  sphere(pos, radius, normal_out, filt) {
    const o = this._cl_sphere(this.opa, pos, radius, normal_out, filt);
    let res = o;
    if (this.xlu) { const x = this._cl_sphere(this.xlu, pos, radius, normal_out, filt); res = x || o; }
    if (this.props.length) for (const p of this._propsFor(pos, pos, fadd(radius, this.margin), false)) { const t = this._propSphere(p, pos, radius, normal_out, filt); if (t) res = t; }
    return res;
  }
}


// ---- static actors and model props (code_A5BC0.c func_803311D4/func_80331638/func_803319C0, code_5FD90.c *Global):
// each query is moved into the model's space, tested against the model's own collision list, and the result moved back.
// Providers run in the game's order: the map, then the props of the 1000-unit cubes the query touches (lines: z, y, x;
// spheres: x, y, z), then the always-tested global cube. Each sees the end point already changed by the ones before.
const D_80276578 = F(BAD_DTOR);
class Mtx {
  constructor() { this.m = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; }
  pitch(a) { a = F(a); if (a === 0) return this; a = fmul(a, D_80276578); const s = lib_sinf(a), c = lib_cosf(a); const m = this.m;
    for (let i = 0; i < 3; i++) { const t18 = m[1][i], t10 = m[2][i]; m[1][i] = fadd(fmul(t18, c), fmul(t10, s)); m[2][i] = fadd(fmul(t18, -s), fmul(t10, c)); } return this; }
  yaw(a) { a = F(a); if (a === 0) return this; a = F(a * BAD_DTOR); const s = lib_sinf(a), c = lib_cosf(a); const m = this.m;
    for (let i = 0; i < 3; i++) { const t18 = m[0][i], t10 = m[2][i]; m[0][i] = fsub(fmul(t18, c), fmul(t10, s)); m[2][i] = fadd(fmul(t18, s), fmul(t10, c)); } return this; }
  roll(a) { a = F(a); if (a === 0) return this; a = fmul(a, D_80276578); const s = lib_sinf(a), c = lib_cosf(a); const m = this.m;
    for (let i = 0; i < 3; i++) { const t18 = m[0][i], t10 = m[1][i]; m[0][i] = fadd(fmul(t18, c), fmul(t10, s)); m[1][i] = fadd(fmul(t18, -s), fmul(t10, c)); } return this; }
  scale(k) { const m = this.m; for (let i = 0; i < 3; i++) { m[0][i] = fmul(m[0][i], k); m[1][i] = fmul(m[1][i], k); m[2][i] = fmul(m[2][i], k); } return this; }
  translate(x, y, z) { const m = this.m; for (let i = 0; i < 3; i++) { const a = fmul(m[0][i], x), b = fmul(m[1][i], y); m[3][i] = fadd(m[3][i], fadd(fadd(a, b), fmul(m[2][i], z))); } return this; }
  apply(v) { const m = this.m; return [0, 1, 2].map(i => fadd(fadd(fadd(fmul(v[0], m[0][i]), fmul(v[1], m[1][i])), fmul(v[2], m[2][i])), m[3][i])); }
}
function w2m(pos, rot, sc) { const M = new Mtx(); if (sc !== 1) { const inv = fdiv(1, sc); M.scale(inv); } M.roll(-rot[2]).pitch(-rot[0]).yaw(-rot[1]); M.translate(-pos[0], -pos[1], -pos[2]); return M; }
function m2w(pos, rot, sc) { const M = new Mtx(); if (pos) M.translate(pos[0], pos[1], pos[2]); M.yaw(rot[1]).pitch(rot[0]).roll(rot[2]); if (sc !== 1) M.scale(sc); return M; }
const vdist = (a, b) => fsqrt(lensq(vsub(a, b)));
function dist_to_line(s, e, p) { // ml_vec3f_distance_to_point
  const dir = vsub(e, s); const L = fsqrt(lensq(dir)); if (L < 0.01) return vdist(s, p);
  const off = vsub(p, s); const pd = fsqrt(lensq(off)); if (pd < 0.01) return pd;
  const pf = fdiv(dot(dir, off), fmul(L, pd)); const pr = fdiv(fmul(pf, pd), L);
  return vdist([fadd(s[0], fmul(dir[0], pr)), fadd(s[1], fmul(dir[1], pr)), fadd(s[2], fmul(dir[2], pr))], p);
}
function point_on_line(pt, margin, s, e) {
  if (margin <= dist_to_line(s, e, pt)) return false;
  const mid = [fdiv(fadd(s[0], e[0]), 2), fdiv(fadd(s[1], e[1]), 2), fdiv(fadd(s[2], e[2]), 2)];
  if (fadd(vdist(mid, s), margin) <= vdist(mid, pt)) return false; return true;
}
const CUBE_MARGIN = { 0x21: 500, 0x12: 500, 0x7F: 500, 0xD: 700, 0x7: 400, 0x16: 400, 0x2: 250, 0x27: 250, 0x92: 300 };
function cube_range(p1, p2, margin) {
  const mn = [0, 0, 0], mx = [0, 0, 0];
  for (let i = 0; i < 3; i++) { let a = p1[i] <= p2[i] ? p1[i] : p2[i]; let t = fsub(a, margin); mn[i] = Math.trunc(0 <= t ? fdiv(t, 1000) : fadd(fdiv(t, 1000), -1));
    a = p2[i] <= p1[i] ? p1[i] : p2[i]; t = fadd(a, margin); mx[i] = Math.trunc(t >= 0 ? fdiv(t, 1000) : fadd(fdiv(t, 1000), -1)); }
  return [mn, mx];
}
function load_props(list) {
  const out = [];
  for (const a of list || []) {
    if (a.cube === 'unk3C' || !a.collision || !a.collision.collision) continue;
    const cl = load_model(a.collision, a.name); if (!cl) continue;
    const pos = a.position.map(F), rot = a.rotation.map(F), sc = F(a.scale);
    out.push({ name: a.name, kind: a.kind, cl, pos, rot, sc, W: w2m(pos, rot, sc), M: m2w(pos, rot, sc), R: m2w(null, rot, F(1)), gn: fmul(cl.global_norm, sc),
      cube: a.cube === 'global' ? null : a.cube, order: a.order_index ?? 0 });
  }
  return out;
}

// ---- floor tracker
class Tracker {
  constructor(o = {}) {
    this.mode = o.mode ?? 2; this.posZ = F(o.posZ ?? 56.0); this.unk1C = [0, 0, 0];
    this.unk28 = o.unk28 ? v3(o.unk28) : null; this.posX = F(o.posX ?? -9000.0); this.posY = F(o.posY ?? -10000.0);
    this.norm = v3(o.norm ?? [0, 1, 0]); this.unk4C = 0; this.unk50 = 0; this.unk54 = o.unk54 ?? 0x400000;
    this.unk58 = o.unk58 ?? 0; this.unk59 = o.unk59 ?? 0; this.unk5A = 0; this.unk5B = 0; this.unk5C = 0; this.unk5D = 0; this.timer_odd = o.timer_odd ?? 0;
  }
  set_mode(m) { if (m === 1) this.unk5D = 5; if (m === 4) this.unk5C = 1; this.mode = m; }
  _set_floor(y, flags, unk14, n) { this.unk58 = 1; this.unk4C = flags; this.unk50 = unk14; this.posX = F(y); this.norm = vcopy(n); }
  _no_floor() { this._set_floor(F(-9000.0), 0, 0, [0, 1, 0]); }
  _set_water(y) { this.unk59 = 1; this.posY = F(y); }
  _no_water() { this._set_water(F(-10000.0)); }
  _ray(world, pos, a1, a2, filt) {
    const s = vcopy(pos); s[1] = fadd(s[1], F(a1)); const e = vcopy(pos); e[1] = fadd(e[1], F(a2)); const n = [0, 0, 0];
    const t = world.line(s, e, n, filt); return [t, { n, y: e[1], flags: t ? t.flags : 0, unk14: t ? t.unk6 : 0 }];
  }
  _ray500(world, pos, a1, a2, filt) {
    a1 = F(a1); a2 = F(a2);
    if (absf(fsub(a2, a1)) > 500) {
      let t, r;
      if (a1 < a2) { [t, r] = this._ray(world, pos, a1, fadd(a1, 500), filt); if (!t) [t, r] = this._ray(world, pos, fsub(fadd(a1, 500), 1), a2, filt); }
      else { [t, r] = this._ray(world, pos, a1, fsub(a1, 500), filt); if (!t) [t, r] = this._ray(world, pos, fadd(fsub(a1, 500), 1), a2, filt); }
      return [t, r];
    }
    return this._ray(world, pos, a1, a2, filt);
  }
  _classify() {
    if (this.unk59 === 0) return 2; if (this.unk59 !== 0 && this.unk58 === 0) return 4; if (this.posY < this.unk1C[1]) return 2;
    const d = fsub(this.posY, this.posX); if (d < -20) return 2; if (d > 100) return 4; return 3;
  }
  update(world) {
    if (!this.unk28) this.unk28 = vcopy(this.unk1C);
    this.unk5A = this.unk58; this.unk5B = this.unk59; this.unk58 = this.unk59 = 0;
    if (this.mode === 1 || this.unk5D !== 0) { this.unk5D = (this.unk5D - 1) & 0xFF; const [t, r] = this._ray(world, this.unk1C, -100.0, 7000.0, 0xF800FF0F | 0); if (t) this._set_water(r.y); this.set_mode(t ? 3 : 2); }
    if (this.mode === 2) this._mode2(world); else if (this.mode === 3) this._mode3(world); else if (this.mode === 4) this._mode4(world);
    this.unk28 = vcopy(this.unk1C);
  }
  _mode2(world) {
    const p = vcopy(this.unk1C); let sp64 = this.posZ; let sp30 = false;
    const dd = fsub(this.unk28[1], this.unk1C[1]); const top = dd > 150 ? dd : F(150.0);
    let [t, r] = this._ray500(world, p, fadd(top, 10), -5.0, 0xF800FF0F | 0);
    if (t) { this._set_water(r.y); sp30 = true; }
    [t, r] = this._ray500(world, p, sp64, -1300.0, this.unk54);
    if (!t) { this._no_floor(); if (!sp30) this._no_water(); else if (this.unk1C[1] < this.posY) this.set_mode(3); return; }
    if (t.flags & 0x1E0000) {
      this._set_water(r.y); if (this.posX < this.posY && this.unk1C[1] < this.posY) this.set_mode(3);
      [t, r] = this._ray500(world, p, sp64, -450.0, 0x1E0000 | this.unk54);
      if (!t) this._no_floor(); else if (r.n[1] >= 0) this._set_floor(r.y, r.flags, r.unk14, r.n);
    } else {
      if (r.n[1] < 0 && !(t.flags & 0x10000)) {
        sp64 = fsub(r.y, p[1]); [t, r] = this._ray500(world, p, fsub(sp64, 1), fsub(sp64, 1300), this.unk54 | 0x1E0000);
        if (t) this._set_floor(r.y, r.flags, r.unk14, r.n); else this._no_floor();
      } else { this._set_floor(r.y, r.flags, r.unk14, r.n); if (sp30) this.set_mode(3); else this._no_water(); }
    }
  }
  _mode3(world) {
    const p = vcopy(this.unk1C); let [t, r] = this._ray500(world, p, 100.0, -1300.0, this.unk54 | 0x1E0000);
    if (t && r.n[1] >= 0) this._set_floor(r.y, r.flags, r.unk14, r.n);
    const d = fsub(this.posY, p[1]); [t, r] = this._ray500(world, p, fadd(d, 50), fsub(d, 50), 0xF800FF0F | 0);
    if (t) this._set_water(r.y); const m = this._classify(); if (m !== 3) this.set_mode(m);
  }
  _mode4(world) {
    const p = vcopy(this.unk1C); const high = fsub(this.unk1C[1], this.posX) > 120.0 ? 1 : 0; const odd = this.timer_odd;
    if (high === 0 || odd !== 0) { this.unk59 = this.unk5B; const [t, r] = this._ray500(world, p, 60.0, -390.0, this.unk54 | 0x1E0000);
      if (t) { if (r.n[1] >= 0) this._set_floor(r.y, r.flags, r.unk14, r.n); } else this._no_floor(); }
    if (high === 0 || odd === 0) { this.unk58 = this.unk5A; const d = fsub(this.posY, p[1]); const [t, r] = this._ray500(world, p, fadd(d, 70), fsub(d, 70), 0xF800FF0F | 0);
      if (t) { this._set_water(r.y); this.unk5C = 1; } else if (this.unk5C !== 0) { this.unk5C = 0; this.unk59 = 1; } }
    const m = this._classify(); if (m !== 4) this.set_mode(m);
  }
}

// ---- the resolver (one update)
function predict(world, old, target, o = {}) {
  const grounded = !!o.grounded, height = o.height ?? 80.0, radius = o.radius ?? 35.0, marker_filter = o.marker_filter ?? 0x400000, hold_counter = o.hold_counter ?? 0;
  const h = F(height), r = F(radius); const filt = marker_filter | 0x1E0000;
  old = v3(old); const tgt = v3(target); const d238 = o.d238 ? v3(o.d238) : vsub(tgt, old);
  const tr = o.tracker || new Tracker(); tr.unk54 = marker_filter;
  const st = { grounded: grounded ? 1 : 0 }; const log = [];
  function floor_snap(pos) {
    tr.unk1C = vcopy(pos); tr.unk54 = marker_filter; tr.update(world);
    const fy = tr.posX, n = tr.norm; const prev = st.grounded; st.grounded = 0;
    if (!(n[1] < 0.432)) {
      if (pos[1] <= fy) { pos[1] = fy; st.grounded = 1; }
      else if (prev !== 0 && d238[1] < 0) {
        if (n[1] < 0.9) { if (pos[1] < fadd(fy, 30)) { pos[1] = fy; st.grounded = 1; } }
        else if (pos[1] < fadd(fy, 5)) { pos[1] = fy; st.grounded = 1; }
      }
    }
  }
  let sp390 = vcopy(old); const c = [old[0], fadd(old[1], h), old[2]]; const nrm = [0, 0, 0];
  if (world.sphere(c, r, nrm, filt)) {
    sp390 = [fadd(old[0], fmul(nrm[0], r)), fadd(old[1], fmul(nrm[1], r)), fadd(old[2], fmul(nrm[2], r))]; old = vcopy(sp390);
    const a = vcopy(old), b = vcopy(old); a[1] = fadd(a[1], 100); b[1] = fsub(b[1], 500); const n2 = [0, 0, 0];
    const t2 = world.line(a, b, n2, filt);
    if (t2 && (!(n2[1] < 0) || (t2.flags & 0x10000)) && old[1] < b[1]) old[1] = b[1];
    log.push(['fallback-pushed', vcopy(sp390), vcopy(old)]);
  }
  const P = []; let last204 = null; let last_n = null; let count = 0; let i = 0;
  while (i < 5) {
    const cur = {}; P.push(cur); const prev = i ? P[i - 1] : null;
    if (i) { cur.u0 = vcopy(prev.u0); cur.uC = vcopy(prev.uC); } else { cur.u0 = vcopy(tgt); cur.uC = vcopy(old); }
    const u0 = cur.u0, uC = cur.uC; const sp364 = vcopy(u0); const sp380 = vsub(u0, uC);
    const tf = fsub(fmul(r, 2), 4); let line_hit = null;
    if (lensq(sp380) > fmul(tf, tf)) {
      const sp38c = u0[1]; const s34 = vcopy(uC); let s28 = vcopy(u0); s34[1] = fadd(s34[1], h); s28[1] = fadd(s28[1], h);
      let s20 = vcopy(s28); const s2c = set_length(vsub(s20, s34), fsub(r, 1)); s20 = vadd(s20, s2c); const n44 = [0, 0, 0];
      line_hit = world.line(s34, s20, n44, filt);
      if (line_hit) { s20 = vsub(s20, s2c); s28 = s20; s28[1] = fsub(s28[1], h); u0[0] = s28[0]; u0[1] = s28[1]; u0[2] = s28[2];
        const spn = normalize(sp380); if (dot(spn, n44) > 0) { line_hit = null; u0[0] = sp364[0]; u0[1] = sp364[1]; u0[2] = sp364[2]; } }
      if (line_hit) { if (n44[1] >= 0 && n44[1] < 0.02) u0[1] = sp38c; }
      log.push([i, 'line', line_hit ? line_hit.idx : null, vcopy(u0)]);
    }
    floor_snap(u0); cur.u8C = st.grounded;
    cur.u34 = [uC[0], fadd(h, uC[1]), uC[2]]; cur.u28 = [u0[0], fadd(h, u0[1]), u0[2]];
    const n1c = [0, 0, 0]; const hit = world.moving_sphere(cur.u34, cur.u28, r, n1c, 3, filt);
    cur.u18 = hit; cur.u1C = n1c; log.push([i, 'sphere', vcopy(u0), hit ? hit.idx : null, vcopy(n1c)]);
    if (!hit) break;
    count++; last204 = hit; last_n = vcopy(n1c); // D_8037C27D, D_8037C258
    if (i === 2) {
      if (hit === P[0].u18 && hit !== prev.u18) cur.u1C = normalize(vadd(cur.u1C, prev.u1C));
      if (cur.u18 === P[0].u18) {
        if (cur.u18 === prev.u18 && world.stored) {
          cur.u68 = world.stored.map(vcopy); let s380 = project_on_plane(u0, cur.u68); const s3a0 = set_length(vsub(u0, s380), fadd(r, 1)); s380 = vadd(s380, s3a0);
          if (!(cur.u18.flags & 0x10000)) { const a = [s380[0], fadd(s380[1], h), s380[2]], b = [u0[0], fadd(u0[1], h), u0[2]];
            const hh = world.moving_sphere(a, b, r, cur.u1C, 3, filt); if (hh) { u0[0] = b[0]; u0[1] = fsub(b[1], h); u0[2] = b[2]; } cur.u18 = hh; }
          else { u0[0] = s380[0]; u0[1] = s380[1]; u0[2] = s380[2]; }
          log.push([i, 'i2-plane', cur.u18 ? cur.u18.idx : null, vcopy(u0)]);
        }
      }
    }
    if (cur.u8C === 0 && cur.u18 && d238[1] < 0) {
      if (absf(cur.u1C[1]) < 0.01 && world.stored) {
        cur.u68 = world.stored.map(vcopy); let s380 = project_on_plane(u0, cur.u68); const s374 = vadd(s380, vscale(cur.u1C, fadd(r, 1)));
        const a = [s374[0], fadd(s374[1], h), s374[2]], b = [s380[0], fadd(s380[1], h), s380[2]];
        const hh = world.moving_sphere(a, b, r, cur.u1C, 3, filt); if (hh) s380 = [b[0], fsub(b[1], h), b[2]];
        cur.u18 = hh; u0[0] = s380[0]; u0[2] = s380[2]; log.push([i, 'wall-slide', hh ? hh.idx : null, vcopy(u0)]);
      }
    }
    if (cur.u1C[1] > 0.999 && cur.u18) {
      cur.u68 = world.stored.map(vcopy); const near = nearest_on_edges(u0, cur.u68);
      let s = [fsub(u0[0], near[0]), 0, fsub(u0[2], near[2])]; s = set_length(s, fadd(1, r)); s = vadd(s, near);
      u0[0] = s[0]; u0[2] = s[2]; log.push([i, 'flat-edge-push', vcopy(near), vcopy(u0)]);
    } else if (is_nonzero(cur.u1C)) {
      const a = vsub(u0, uC), b = vsub(cur.u28, cur.u34), dd = vsub(a, b); let ph = -dot(cur.u1C, dd); ph = (5 > ph) ? F(5) : ph;
      u0[0] = fadd(u0[0], fmul(ph, cur.u1C[0])); u0[1] = fadd(u0[1], fmul(ph, cur.u1C[1])); u0[2] = fadd(u0[2], fmul(ph, cur.u1C[2]));
      log.push([i, 'normal-push', vcopy(u0)]);
    }
    i++;
  }
  const held = (i === 5); const falling_hold = held && st.grounded === 0 && last204 !== null && tgt[1] < old[1];
  const result = held ? vcopy(sp390) : vcopy(P[i].u0);
  let grounded_out = st.grounded; const forced = (hold_counter === 3); if (forced) grounded_out = 1;
  const new_counter = falling_hold ? Math.min(hold_counter + 1, 3) : 0;
  return { hits: count, held, result, result_bits: result.map(x => bits(x).toString(16).toUpperCase().padStart(8, '0')), grounded: grounded_out,
    grounded_from_floor: st.grounded, forced_grounded: forced, falling_hold, hold_counter_after: new_counter, last_hit: last204 ? last204.idx : null, last_flags: last204 ? last204.flags : 0, last_n, trace: log };
}

// ---- several updates
function physics_step(pos, vel, dt, gravity = -2700.0, terminal = -4000.0) {
  dt = F(dt); let vx = F(vel[0]), vy = F(vel[1]), vz = F(vel[2]);
  if (absf(vx) < 0.0001) vx = 0; if (absf(vz) < 0.0001) vz = 0;
  vy = fadd(vy, fmul(dt, F(gravity))); if (vy < F(terminal)) vy = F(terminal);
  const d = [fmul(vx, dt), fmul(vy, dt), fmul(vz, dt)];
  return [[fadd(F(pos[0]), d[0]), fadd(F(pos[1]), d[1]), fadd(F(pos[2]), d[2])], [vx, vy, vz]];
}
// steps: array of {dt, gravity?, vel?(override velocity before gravity), terminal?}; returns rows + summary.
function simulate(world, pos, vel, steps, o = {}) {
  const gravity0 = o.gravity ?? -2700.0, terminal0 = o.terminal ?? -4000.0;
  const tr = o.tracker || new Tracker({ unk28: pos }); pos = v3(pos); vel = v3(vel);
  let grounded = !!o.grounded, hold_counter = o.hold_counter ?? 0; const rows = []; let held_y = null; let stop_after_exit = o.stop_after_exit ?? 1;
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k]; if (s.vel) vel = v3(s.vel);
    if (world.timeline) world.tick(Math.round(s.dt / world.timeline.frameTime));
    const [tgt, nv] = physics_step(pos, vel, s.dt, s.gravity ?? gravity0, s.terminal ?? terminal0); vel = nv;
    const r = predict(world, pos, tgt, { grounded, tracker: tr, height: o.height, radius: o.radius, hold_counter });
    const res = v3(r.result); let tag;
    if (r.held) { tag = 'HOLD'; held_y = res[1]; } else if (r.hits > 0) tag = 'POP'; else if (r.grounded_from_floor) tag = held_y !== null ? 'POP' : 'LAND'; else tag = 'FREE';
    grounded = !!r.grounded; hold_counter = r.hold_counter_after;
    if (grounded && vel[1] < 0) vel[1] = F(-1.0);
    rows.push({ update: k + 1, dt: s.dt, target: tgt, hits: r.hits, tag, result: res, vel: vcopy(vel), vy_after: vel[1], grounded: grounded ? 1 : 0, bits: r.result_bits });
    pos = res;
    if (held_y !== null && tag !== 'HOLD') { stop_after_exit--; if (stop_after_exit <= 0) break; }
  }
  const tags = rows.map(r => r.tag); const holds = tags.filter(t => t === 'HOLD').length; const first = tags.indexOf('HOLD');
  let kind = 'none', verdict;
  if (first < 0) verdict = 'never held';
  else { const after = tags.slice(first); const exit_ = after.find(t => t !== 'HOLD'); const n_hold = exit_ ? after.indexOf(exit_) : after.length;
    if (!exit_) { kind = 'stable'; verdict = `STABLE: held all ${n_hold} remaining updates`; }
    else if (exit_ === 'POP') { kind = 'thrown'; verdict = `THROWN OFF: held ${n_hold}, then popped out`; }
    else { const yb = rows[first + n_hold].result[1]; if (held_y !== null && yb < held_y) {
        // through the floor -- but only a clip if he stays under: a later pop / landing back up at the floor's height is not one
        const ex = first + n_hold; let lowY = yb, back = -1;
        for (let i = ex + 1; i < rows.length; i++) { const y = rows[i].result[1]; if (y < lowY) lowY = y; if ((rows[i].tag === 'POP' || rows[i].tag === 'LAND' || rows[i].grounded) && y >= held_y - 1) { back = i; break; } }
        const after = rows.length - 1 - ex;
        if (back >= 0) { kind = 'thrown'; verdict = `NOT A CLIP: held ${n_hold}, dipped under to y ${lowY.toFixed(3)}, then popped back up onto the floor on update ${back + 1} (y ${rows[back].result[1].toFixed(3)})`; }
        else if (after < 12 && lowY > held_y - 115) { kind = 'clip'; verdict = `CLIP?: held ${n_hold}, then went through (y ${yb.toFixed(3)}); only ${after} update${after === 1 ? '' : 's'} after it were simulated, add updates to check he doesn't pop back up`; }
        else { kind = 'clip'; verdict = `CLIP: held ${n_hold}, then went through (y ${yb.toFixed(3)}, down to ${lowY.toFixed(3)})`; } } else { kind = 'released'; verdict = `released after ${n_hold} hold(s) (${exit_})`; } } }
  return [rows, { holds, kind, first_hold: first < 0 ? null : first + 1, verdict, tags: tags.join(' ') }];
}

const api = { F, bits, World, load_props, Mtx, w2m, m2w, Tracker, CollisionList, load_model, predict, simulate, physics_step, lib_sinf, lib_cosf, ml_acosf, acos_table };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BK = api;
})(typeof self !== 'undefined' ? self : this);
