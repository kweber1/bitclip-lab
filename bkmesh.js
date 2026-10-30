// bkmesh.js -- animated map vertices that collision sees (core2/code_C5440.c mesh transforms). The map models' mesh lists
// (data/meshes.json, from tools/meshes.py on the PAL ROM) tag groups of vertices by uid; every game update, after the player,
// gsworld_update -> func_8034C9D4 runs each group's transform, which writes the model bin's vertex list -- the same list the
// collision functions read. So Banjo's next update collides with the water as it was moved after his previous one.
// Modelled: uid 700-799 (xform 5, code_C7CC0.c: per-vertex waves, the Lair's water) and uid 300-399 (xform 3, code_C76D0.c:
// whole-mesh bob, level water). Not modelled: xform 2 (400-499, 600-699: scripted moves started by objects), colour/texture-only ones.
// The waves start at 0 when the map loads (xform 3 starts at a random phase randf2(0,1)), so a run needs the time since the map
// loaded: opts.t0 (seconds of game dt summed since load) or per-mesh phases.
(function (root) {
'use strict';
const BK = root.BK || (typeof require !== 'undefined' ? require('./bkcol.js') : null);
const F = Math.fround; const sinf = BK.lib_sinf, cosf = BK.lib_cosf; const BAD_PI = 3.141592654;
const trunc16 = (x) => { let v = Math.trunc(x); v = ((v % 65536) + 65536) % 65536; return v >= 32768 ? v - 65536 : v; };

class Wave5 { // func_8034EE2C / func_8034EF60 / func_8034EC50
  constructor(cl, uid, idx) {
    this.cl = cl; this.uid = uid; this.idx = idx; const V = cl.V0; const mn = [0, 1, 2].map(i => Math.min(...idx.map(k => V[k][i]))), mx = [0, 1, 2].map(i => Math.max(...idx.map(k => V[k][i])));
    const a = uid - 700; this.u0 = (a >= 0 && a < 0xB) ? F(a / 10.0) : F(1.0); this.u4 = 0; this.u8 = 0; this.u2C = 0;
    this.uC = F(mn[1] + (mx[1] - mn[1]) * 0.5); this.u10 = F(mn[0]); this.u14 = F(mn[2]); this.u20 = F(((mx[1] - mn[1]) * 0.5) / 2); this.u24 = F(this.u20 * 2);
  }
  advance(dt) { dt = F(dt); this.u2C = F(this.u2C + dt); this.u4 = F(this.u4 + F(F(dt * this.u0) * 3)); this.u8 = F(this.u8 + dt * (this.u0 + 0.01) * 3); }
  apply() {
    const V = this.cl.V; const out = [];
    for (const k of this.idx) { const v = V[k];
      const t0 = F(this.u4 + F(F(v[0] - this.u10) * F(200.0))), t1 = F(this.u8 + F(F(v[2] - this.u14) * F(200.0)));
      const d = F(F(sinf(t0) + cosf(t1)) * this.u20); out.push([k, [v[0], trunc16(F(this.uC + d)), v[2]]]); }
    return this.cl.setVerts(out);
  }
}
class Wave3 { // func_8034E6A8 / func_8034E8E4 / func_8034E660 (no scripted level change: unkC = unkE = 0)
  constructor(cl, uid, idx, phase) { this.cl = cl; this.uid = uid; this.idx = idx; this.u4 = F(phase ?? 0.5); this.u8 = F(uid - 300); this.dy = 0; }
  advance(dt) { dt = F(dt); this.u4 = F(this.u4 + dt);
    const c = cosf(F(this.u4 * 0.5 * BAD_PI)), s = sinf(F(this.u4 * 0.11 * BAD_PI));
    const sp2C = F(s * (this.u8 * 0.25) + (this.u8 * 0.75) * c); const sp28 = F(0 + sp2C); this.dy = trunc16(sp28 >= 0.0 ? sp28 + 0.5 : sp28 - 0.5); }
  apply() { const V0 = this.cl.V0, V = this.cl.V; return this.cl.setVerts(this.idx.map(k => [k, [V[k][0], trunc16(V0[k][1] + this.dy), V[k][2]]])); }
}

// attach the transforms of map `mapId` to a World; returns the controller (world.meshes). opts: { t0, phase3: {uid: phase}, steps }
function attach(world, meshes, mapId, opts = {}) {
  const key = '0x' + mapId.toString(16).toUpperCase().padStart(2, '0'); const m = meshes[key]; const list = [];
  if (m) for (const [kind, cl] of [['opa', world.opa], ['xlu', world.xlu]]) {
    if (!cl || !m[kind]) continue;
    for (const [uid, idx] of m[kind]) {
      const ok = idx.filter(k => k < cl.V.length); if (!ok.length) continue;
      if (uid >= 700 && uid < 800) list.push(new Wave5(cl, uid, ok));
      else if (uid >= 300 && uid < 400) list.push(new Wave3(cl, uid, ok, (opts.phase3 || {})[uid]));
    }
  }
  const ctl = { list, time: 0,
    tick(dt) { for (const w of list) { w.advance(dt); w.apply(); } this.time += dt; },
    // jump to `t` seconds after the map loaded using a fixed step (the game sums each update's dt; pass the real steps when known)
    seek(t, step) { step = F(step ?? 0.04); while (this.time + step / 2 < t) { for (const w of list) w.advance(step); this.time += step; } for (const w of list) w.apply(); } };
  if (opts.wave5) for (const w of list) if (w instanceof Wave5) { const v = opts.wave5[w.uid] || opts.wave5; w.u4 = F(v.u4); w.u8 = F(v.u8); w.u2C = F(v.u2C ?? 0); }
  world.meshes = ctl; if (opts.wave5) { for (const w of list) w.apply(); return ctl; } if (opts.t0) ctl.seek(opts.t0, opts.step); else for (const w of list) w.apply();
  return ctl;
}
const api = { attach, Wave5, Wave3 };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BKMESH = api;
})(typeof self !== 'undefined' ? self : this);
