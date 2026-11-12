// bkb.js (Claude 2026-11-12) -- reader for "BKB1" Banjo-Kazooie room files (tools/bk/bkb.py): the big spot tables come as typed,
// delta-coded, byte-planed columns. BKB.decode(arrayBuffer) gives the room object the viewer expects; its tables are RowLists:
// array-like (length, [i], for..of, forEach / map / filter / some / find / slice / concat) that rebuild each row on access, exactly
// as the JSON rooms had it, so millions of spots stay compact in memory. rowList.xyz(i, out) gives a spot's position fast (no row).
(function (root) {
  'use strict';
  const F32 = new Float32Array(1), I32 = new Int32Array(F32.buffer);
  // f.toPrecision(p) rounds an exact tie away from zero; the files were written with C / Python printf ("%.9g"), which rounds the
  // exact binary value half to even -- so on a tie (the value has exactly p + 1 digits ending in 5) take the even neighbour
  function prec(f, p) { const s = f.toPrecision(p); const t = f.toPrecision(p + 1);
    if (Number(t) === f && /5(e[+-]\d+)?$/.test(t)) { const e = s.indexOf('e'), j = (e < 0 ? s.length : e) - 1; const d = s.charCodeAt(j) - 48;
      if (d & 1) return Number(s.slice(0, j) + String.fromCharCode(48 + d - 1) + s.slice(j + 1)); }
    return Number(s); }
  const p9 = (f) => prec(f, 9);
  const ps = (f) => { for (let p = 1; p <= 9; p++) { const t = prec(f, p); if (Math.fround(t) === f) return t; } return prec(f, 9); };
  // read n W-byte planed unsigned values (W <= 8; exact while below 2^53)
  function planes(bytes, off, n, w) { const out = new Float64Array(n); let m = 1;
    for (let k = 0; k < w; k++) { const b = bytes.subarray(off + k * n, off + (k + 1) * n); for (let i = 0; i < n; i++) out[i] += b[i] * m; m *= 256; }
    return out; }
  function unzz(u) { for (let i = 0; i < u.length; i++) { const v = u[i]; u[i] = (v % 2) ? -(v + 1) / 2 : v / 2; } return u; }
  function col(bytes, base, n, m) {   // -> { num: typed array (drawing / maths), val(i): the exact JSON value }
    const [name, typ, off, extra, nulo, ex] = m; let num, val, isStr = false, strs = null;
    if (typ === 'f8') { const b = new Uint8Array(n * 8); for (let k = 0; k < 8; k++) for (let i = 0; i < n; i++) b[i * 8 + k] = bytes[base + off + k * n + i]; num = new Float64Array(b.buffer); val = (i) => num[i]; }
    else { const k = typ.slice(0, typ[0] === 'q' ? 1 : 2), w = +typ.slice(k.length); const d = unzz(planes(bytes, base + off, n, w));
      if (k === 'q') { const sc = Math.pow(10, extra); let a = 0; num = new Float64Array(n); for (let i = 0; i < n; i++) { a += d[i]; num[i] = a / sc; } val = (i) => num[i]; }
      else { const a = new Int32Array(n); let s = 0; for (let i = 0; i < n; i++) { s = (s + d[i]) | 0; a[i] = s; }
        if (k === 'zd') { num = a; val = (i) => num[i]; }
        else if (k === 'sd') { num = a; strs = extra; isStr = true; val = (i) => strs[num[i]]; }
        else if (k === 'm3') { num = new Float64Array(n); for (let i = 0; i < n; i++) num[i] = a[i] / 1000; val = (i) => num[i]; }
        else { const f32 = new Float32Array(a.buffer); num = f32; const conv = k === 'f9' ? p9 : ps; val = (i) => conv(f32[i]); } } }
    if (ex) { const [ne, wi, io, vo] = ex; const idx = unzz(planes(bytes, base + io, ne, wi)); let s = 0; const map = new Map();
      const b = new Uint8Array(ne * 8); for (let k = 0; k < 8; k++) for (let i = 0; i < ne; i++) b[i * 8 + k] = bytes[base + vo + k * ne + i]; const ev = new Float64Array(b.buffer);
      for (let i = 0; i < ne; i++) { s += idx[i]; map.set(s, ev[i]); if (!(num instanceof Float32Array) || Math.fround(ev[i]) === ev[i]) num[s] = ev[i]; }
      const v0 = val; val = (i) => { const e = map.get(i); return e !== undefined ? e : v0(i); }; if (num instanceof Float32Array) { const n0 = num; num = { length: n, ex: map, f: n0 }; } }
    if (nulo != null) { const nul = bytes.subarray(base + nulo, base + nulo + n); const v1 = val; val = (i) => nul[i] ? null : v1(i); }
    return { name, num, val, isStr };
  }
  const ROW = {
    cracks: (c) => (i) => [c.x(i), c.y(i), c.z(i), c.seam(i)],
    slopecracks: (c) => (i) => [c.x(i), c.y(i), c.z(i), c.seam(i)],
    hit5: (c) => (i) => [c.x(i), c.y(i), c.z(i), c.seam(i), c.c(i), c.s(i)],
    holdsA: (c) => (i) => [c.x(i), c.y(i), c.z(i), c.seam(i), c.held(i), c.of(i), c.maxh(i), c.slope(i), c.clip(i) ? [c.ck(i), c.ch(i), c.cv(i), c.cl(i), c.ce(i)] : 0,
      c.odds(i) ? [c.oR(i), c.oC(i), c.oN(i), c.oV(i)] : 0],
    slopeclips: (c) => (i) => { const r = [c.x(i), c.y(i), c.z(i), c.seam(i), c.n(i), c.mask(i)]; const f = c.flat(i); if (f !== -1) r.push(f); return r; },
    lowercracks: (c) => { const K = ['x', 'y', 'z', 'seam', 'drop', 'sv', 'sy', 'held', 'mh', 'fv', 'fk', 'fh', 'fvy', 'flag', 'fe', 'bu', 'bo']; return (i) => { const n = c.len(i); const r = new Array(n); for (let k = 0; k < n; k++) r[k] = c[K[k]](i); return r; }; },
    pcancel: (c) => (i) => [c.x(i), c.y(i), c.z(i), c.seam(i), c.held(i), c.cases(i), c.clips(i), c.nolag(i), c.voids(i), c.K(i), c.lag(i), c.ey(i), c.slope(i)] };
  // array-like view over typed columns
  class RowList {
    constructor(n, row, cols) { this.n = n; this.row = row; this.cols = cols; }
    get length() { return this.n; }
    at(i) { return i >= 0 && i < this.n ? this.row(i) : undefined; }
    xyz(i, o) { const c = this.cols; o[0] = num(c.x, i); o[1] = num(c.y, i); o[2] = num(c.z, i); return o; }
    forEach(f) { for (let i = 0; i < this.n; i++) f(this.row(i), i, this); }
    map(f) { const o = new Array(this.n); for (let i = 0; i < this.n; i++) o[i] = f(this.row(i), i, this); return o; }
    filter(f) { const o = []; for (let i = 0; i < this.n; i++) { const r = this.row(i); if (f(r, i, this)) o.push(r); } return o; }
    some(f) { for (let i = 0; i < this.n; i++) if (f(this.row(i), i, this)) return true; return false; }
    every(f) { for (let i = 0; i < this.n; i++) if (!f(this.row(i), i, this)) return false; return true; }
    find(f) { for (let i = 0; i < this.n; i++) { const r = this.row(i); if (f(r, i, this)) return r; } return undefined; }
    findIndex(f) { for (let i = 0; i < this.n; i++) if (f(this.row(i), i, this)) return i; return -1; }
    reduce(f, a) { let i = 0; if (arguments.length < 2) { a = this.row(0); i = 1; } for (; i < this.n; i++) a = f(a, this.row(i), i, this); return a; }
    slice(a = 0, b = this.n) { if (a < 0) a += this.n; if (b < 0) b += this.n; const o = []; for (let i = Math.max(0, a); i < Math.min(this.n, b); i++) o.push(this.row(i)); return o; }
    concat(...xs) { const o = this.slice(); for (const x of xs) { if (x && typeof x.length === 'number' && typeof x !== 'string') { for (let i = 0; i < x.length; i++) o.push(x instanceof RowList ? x.row(i) : x[i]); } else o.push(x); } return o; }
    toArray() { return this.slice(); }
    toJSON() { return this.slice(); }
    *[Symbol.iterator]() { for (let i = 0; i < this.n; i++) yield this.row(i); }
    get [Symbol.isConcatSpreadable]() { return true; }
  }
  const num = (c, i) => { const a = c.num; if (a.ex) { const e = a.ex.get(i); return e !== undefined ? e : a.f[i]; } return a[i]; };
  const IDX = /^(?:0|[1-9]\d*)$/;
  function rowList(n, row, cols) { const L = new RowList(n, row, cols);
    const bound = {};
    return new Proxy(L, { get(t, p, r) { if (typeof p === 'string' && p.length < 10 && IDX.test(p)) return t.at(+p); const v = t[p];
        if (typeof v !== 'function') return v; return bound[p] || (bound[p] = v.bind(t)); },
      has(t, p) { if (typeof p === 'string' && IDX.test(p)) return +p < t.n; return p in t; } }); }
  function decode(buf) {
    const bytes = new Uint8Array(buf); if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'BKB1') return null;
    const hl = new DataView(buf instanceof ArrayBuffer ? buf : bytes.buffer, bytes.byteOffset).getUint32(4, true);
    const hdr = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))); const base = (8 + hl + 3) & ~3;
    const room = {}; for (const k in hdr) if (k !== 'fmt' && k !== 'tables') room[k] = hdr[k];
    for (const [t, T] of Object.entries(hdr.tables)) { const c = {}, cv = {};
      for (const m of T.cols) { const cc = col(bytes, base, T.n, m); c[m[0]] = cc; cv[m[0]] = cc.val; }
      room[t] = rowList(T.n, ROW[t](cv), c); }
    return room;
  }
  const api = { decode, RowList, isRowList: (a) => a instanceof RowList };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKB = api;
})(typeof self !== 'undefined' ? self : this);
