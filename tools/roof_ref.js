// tools/roof_ref.js -- roof (ceiling) cracks and roof clips, JavaScript reference for tools/gpu-pc/roofscan.cu (same float steps).
// Census (after scripts/census-ff-entrance-roof.py): ceiling triangles = unit normal y <= -0.3 (collision filter 0x5E0000 skipped);
// every edge shared by two ceiling triangles (xz length >= 5) is sampled at k/STEPS; a roof crack = the upward ray y-60 -> y+140 misses
// while the two controls 0.01 to either side across the seam hit. Body clearance: sphere r below (x, y - r/|ny| - 1, z) and above
// (x, y + r/|ny| + 1, z) with r = 35 (Banjo) / 25 (bee, forms) / 45 (Banjo flying).
// Roof clip test (a long move straight up through the crack, the way the bee R282/R308 clips work: the move is longer than 2r-4,
// so func_80293668 tests the centre line, which slips through the seam): the centre starts s under the crack, s = (k+0.5)/NP of the
// first update's move, velocity v up held (flight flaps keep it), then 6 more normal updates. Clip = the feet end 10+ above the crack.
//   bee:   height 50, r 25, v 1600 (4 flaps), every update normal (PAL 64/update, NTSC 53.3; the long-move test needs > 46)
//   fly:   Banjo flying, height 60, r 45, v 1600, the first update long (PAL 0.06 -> 96, NTSC 0.05 -> 80; needs > 86)
'use strict';
const F = Math.fround;
function mk(BK) {
  const FILT = 0x5E0000;
  function ceilingSeams(cl) { // [{a,b,ny,seam}] from a CollisionList
    const seen = new Set(), tri = new Map(), edges = new Map();
    cl.raw.forEach((t, idx) => { if ((t[4] >>> 0) & FILT) return; const ps = [0, 1, 2].map(k => cl.V[t[k]].slice()); const key = JSON.stringify(ps.map(p => p.join(',')).sort());
      if (seen.has(key)) return; seen.add(key); const [pa, pb, pc] = ps; const u = [0, 1, 2].map(k => pb[k] - pa[k]), v = [0, 1, 2].map(k => pc[k] - pa[k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const nl = Math.hypot(...n); if (!nl || n[1] / nl > -0.3) return;
      tri.set(idx, n[1] / nl); for (const [e0, e1] of [[pa, pb], [pb, pc], [pc, pa]]) { const k = [e0.join(','), e1.join(',')].sort().join('|'); if (!edges.has(k)) edges.set(k, { e: [e0, e1].sort((x, y) => x.join(',') < y.join(',') ? -1 : 1), own: [] }); edges.get(k).own.push(idx); } });
    const out = []; let i = 0; for (const k of [...edges.keys()].sort()) { const { e, own } = edges.get(k); i++; if (own.length < 2) continue; const [pa, pb] = e; const L = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]); if (L < 5) continue;
      out.push({ a: pa, b: pb, ny: Math.min(...own.map(o => Math.abs(tri.get(o)))), seam: i }); }
    return out; }
  function census(w, s, STEPS, k) { // one sample; returns null or {p, clear35b, clear25b, clear45b, clear35a, clear25a, clear45a}
    const pa = s.a, pb = s.b; const t = k / STEPS; const p = [0, 1, 2].map(j => F(pa[j] + (pb[j] - pa[j]) * t)); const [x, y, z] = p;
    const line = (a, b) => { w.stored = null; return w.line(a.map(F), b.map(F), [0, 0, 0], FILT); };
    if (line([x, F(y - 60), z], [x, F(y + 140), z])) return null;
    const L = Math.sqrt((pb[0] - pa[0]) * (pb[0] - pa[0]) + (pb[2] - pa[2]) * (pb[2] - pa[2])); const perp = [(pb[2] - pa[2]) / L, -(pb[0] - pa[0]) / L];
    for (const sg of [-1, 1]) { const xx = F(x + sg * 0.01 * perp[0]), zz = F(z + sg * 0.01 * perp[1]); if (!line([xx, F(y - 60), zz], [xx, F(y + 140), zz])) return null; }
    const a = F(s.ny); const clr = (r, up) => { w.stored = null; const c = [x, F(up ? F(y + F(F(r / a) + 1)) : F(y - F(F(r / a) + 1))), z]; return !w.sphere(c, F(r), [0, 0, 0], FILT); };
    return { p, b35: clr(35, 0), b25: clr(25, 0), b45: clr(45, 0), a35: clr(35, 1), a25: clr(25, 1), a45: clr(45, 1) };
  }
  const MODES = { bee: { h: 50, r: 25, v: 1600, longFirst: 0 }, fly: { h: 60, r: 45, v: 1600, longFirst: 1 } };
  function clip(w, p, mode, k, NP, rate) { const m = MODES[mode]; const dtN = F(2 / rate), dtL = F(rate === 60 ? 0.05 : 0.06);
    const dt0 = m.longFirst ? dtL : dtN; const mv = F(F(m.v) * dt0); const s = F(mv * F((k + 0.5) / NP));
    let pos = [p[0], F(F(p[1] - s) - F(m.h)), p[2]]; w.stored = null; const tr = new BK.Tracker({ unk28: pos }); let g = false, hold = 0;
    for (let u = 0; u < 7; u++) { const dt = u === 0 ? dt0 : dtN; const tgt = [pos[0], F(pos[1] + F(F(m.v) * dt)), pos[2]];
      const r = BK.predict(w, pos, tgt, { grounded: g, tracker: tr, hold_counter: hold, height: m.h, radius: m.r }); pos = r.result.map(F); g = !!r.grounded; hold = r.hold_counter_after; }
    return pos[1] > F(p[1] + 10) ? 1 : 0; }
  return { ceilingSeams, census, clip, MODES, FILT };
}
if (typeof module !== 'undefined' && module.exports) module.exports = mk; else if (typeof self !== 'undefined' && self.BK) self.BKROOF = mk(self.BK);
