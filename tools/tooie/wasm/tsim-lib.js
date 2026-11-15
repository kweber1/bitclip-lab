// Claude 2026-11-11 (tsim-lib.js): driver for tsim.wasm (the census for one 0.25 cell), shared by the viewer and the Node check.
// new TSim(wasmBytes) -> .loadRoom(colText) -> .cell(seamEntry, cx, cz, onFloat, opts) where seamEntry = room.seams[i]
// = [P0 P1 P2 Q0 Q1 Q2 nya nyb ncrack ma a mb b]. onFloat({j, o, x, y, z, cat, hold, res}) for each crack float (in census order).
const CAT = ['walk', 'void', 'lag', 'jump', 'eject', 'stuck', 'wall', 'water', 'hold'];
class TSim {
  constructor(bytes) { this.mod = new WebAssembly.Module(bytes); this.inst = new WebAssembly.Instance(this.mod, {}); this.x = this.inst.exports; }
  mem() { return this.x.memory.buffer; }
  loadRoom(text) {   // mkroom.py text: MODEL nv nt ncell gn h[11] / vertices / triangles (a b c flags) / cells ; or NOMODEL
    this.inst = new WebAssembly.Instance(this.mod, {}); this.x = this.inst.exports;   // fresh memory per room
    const tok = text.split(/\s+/).filter(Boolean); let p = 0;
    for (let slot = 0; slot < 2; slot++) {
      const w = tok[p++]; if (w === 'NOMODEL' || w === undefined) { const q = this.x.ts_alloc(4); new Int32Array(this.mem(), q, 1)[0] = -1; this.x.ts_load(slot, q); continue; }
      const nv = +tok[p], nt = +tok[p + 1], nc = +tok[p + 2]; const n = 4 + 11 + 3 * nv + 4 * nt + 2 * nc; const q = this.x.ts_alloc(4 * n);
      const d = new Int32Array(this.mem(), q, n); for (let i = 0; i < n; i++) d[i] = Number(tok[p + i]) | 0; p += n; this.x.ts_load(slot, q); }
    this.res = this.x.ts_alloc(this.x.ts_res_size()); this.jr = this.x.ts_alloc(8); this.cap = 1 << 16; this.buf = this.x.ts_alloc(20 * this.cap);
  }
  seam(se) { return this.x.ts_seam(se[0], se[1], se[2], se[3], se[4], se[5], se[9], se[10], se[11], se[12]); }
  // runs the census for cell (cx, cz) of the seam; calls onFloat per crack float; returns counts {n, walk, void, lag, ...}.
  // opts.chunk floats per call (for progress); opts.shouldStop() to abort; async when opts.yield is given (await between chunks)
  // opts.zl: the room was merged with the zero-line run (tcensus_zl.cu): a seam lying on x = 0 / z = 0 is scanned a second time with
  // the across offsets o * 1e-10 (ts_zl), as that run did. opts.zp: the room was merged with the near-zero run (TC_ZEROPART=3: every
  // float within [-1, 1] down to |m| = 1e-5, then the tiny-float ladder; ts_zp); opts.zpzl: that run's zero-line pass too. The counts
  // add up like the merged cell's. opts.maxFloats (default 4e6 seam floats): a bigger cell is not scanned (cnt.tooMany = its size).
  async cell(se, cx, cz, onFloat, opts = {}) {
    const axis = Math.abs(se[3] - se[0]) >= Math.abs(se[5] - se[2]) ? 0 : 2, ot = 2 - axis, zls = se[ot] === 0 && se[3 + ot] === 0;
    const cnt = { n: 0 }; for (const c of CAT) cnt[c] = 0; const step = opts.chunk || 2048; const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
    const P = [];   // passes: [near-zero floats?, zero-line offsets?, j0, j1]
    for (const zp of (opts.zp && this.x.ts_zp ? [0, 1] : [0])) {
      if (this.x.ts_zp) this.x.ts_zp(zp); this.seam(se); this.x.ts_jrange(axis === 0 ? cx : cz, this.jr); let [j0, j1] = new Uint32Array(this.mem(), this.jr, 2); j0 >>>= 0; j1 >>>= 0;
      if (j1 <= j0) continue; P.push([zp, 0, j0, j1]); if (zls && this.x.ts_zl && (zp ? opts.zpzl : opts.zl)) P.push([zp, 1, j0, j1]); }
    const total = P.reduce((t, p) => t + (p[3] - p[2]), 0); if (total > (opts.maxFloats || 4e6)) { cnt.tooMany = total; if (this.x.ts_zp) this.x.ts_zp(0); return cnt; }
    let done = 0;
    for (const [zp, zl, j0, j1] of P) {
      if (this.x.ts_zp) this.x.ts_zp(zp); this.seam(se); if (this.x.ts_zl) this.x.ts_zl(zl);
      for (let a = j0; a < j1; a += step) {
        if (opts.shouldStop && opts.shouldStop()) { cnt.stopped = true; break; }
        const b = Math.min(j1, a + step); const n = this.x.ts_scan(cx, cz, a, b, this.buf, this.cap); if (n > this.cap) throw new Error('scan buffer');
        const B = new Uint32Array(this.mem(), this.buf, 5 * n).slice();
        for (let i = 0; i < n; i++) { const fl = k => { u32[0] = B[5 * i + k]; return f32[0]; }; const x = fl(2), y = fl(3), z = fl(4);
          const cat = this.x.ts_eval(x, y, z, this.res); const R = new Uint8Array(this.mem(), this.res, this.x.ts_res_size());
          const res = { out: Array.from(R.slice(0, 9)), holds: Array.from(R.slice(9, 18)), maxhits: Array.from(R.slice(18, 27)), upd: Array.from(R.slice(27, 36)), sits: Array.from(R.slice(36, 45)),
            jump: Array.from(R.slice(45, 53)), endy: Array.from(new Float32Array(this.mem(), this.res + 56, 9)) };
          const hold = R[54]; cnt.n++; cnt[CAT[cat]]++; if (cat === 0 && res.out[0] === 1) cnt.void++; if (hold) cnt.hold++;
          if (onFloat) onFloat({ j: B[5 * i], o: B[5 * i + 1] - 3, zl, zp, x, y, z, xb: B[5 * i + 2], yb: B[5 * i + 3], zb: B[5 * i + 4], cat: CAT[cat], hold, res }); }
        done += b - a; if (opts.progress) opts.progress(done / Math.max(1, total), cnt);
        if (opts.yield) await opts.yield(); }
      if (cnt.stopped) break; }
    if (this.x.ts_zl) this.x.ts_zl(0); if (this.x.ts_zp) this.x.ts_zp(0);
    return cnt; }
}
if (typeof module !== 'undefined') module.exports = { TSim, CAT };
