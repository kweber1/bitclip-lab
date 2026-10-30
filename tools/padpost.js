// tools/padpost.js -- reachability + approach check for the GPU pad scan (padscan.cu) results.
// usage: node tools/padpost.js <jobdir> <PAL|NTSC> [maxVerify]   (jobdir has room.bin? no: spots.txt, dirs.txt, job.json, out-<ver>.txt)
//  shock drop: a clip height h counts when the shock jump can reach it: pad top + 290 <= crack + h <= pad top + 668 and the crack is
//    within (air time x 500) of the pad horizontally.
//  beak bomb: the case is replayed with a long approach (12 steps back up the line, about 2000 units); it counts when nothing is
//    hit on the way in (the bomb would stop at a wall) and Banjo still ends up 150 under the floor.
'use strict';
global.self = global; const path = require('path'), fs = require('fs'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'); const BK = require(path.join(ROOT, 'bkcol.js')); const F = Math.fround;
const [dir, VER, MAXV] = process.argv.slice(2); const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'))); const id = parseInt(job.map);
const rate = VER === 'NTSC' ? 60 : 50; const dt = F(2 / rate);
function loadMap(id) { const h = id.toString(16).toUpperCase().padStart(2, '0'), d = path.join(ROOT, 'data') + '/';
  if (fs.existsSync(d + 'map0x' + h + '.gz.wasm')) return JSON.parse(zlib.gunzipSync(fs.readFileSync(d + 'map0x' + h + '.gz.wasm')));
  const parts = []; for (let i = 0; fs.existsSync(d + 'map0x' + h + '.gz.' + i + '.wasm'); i++) parts.push(fs.readFileSync(d + 'map0x' + h + '.gz.' + i + '.wasm')); return JSON.parse(zlib.gunzipSync(Buffer.concat(parts))); }
const room = loadMap(id); const w = new BK.World(BK.load_model(room.opa, 'opa'), room.xlu ? BK.load_model(room.xlu, 'xlu') : null, BK.load_props(room.props || []), id);
const hf = h => Buffer.from(h, 'hex').readFloatBE(0);
const sp = fs.readFileSync(path.join(dir, 'spots.txt'), 'utf8').trim().split('\n').map(l => l.split(' ').map(hf));
const dd = (fs.readFileSync(path.join(dir, 'dirs.txt'), 'utf8').trim() || '').split('\n').filter(x => x).map(l => l.split(' ').map(hf));
const pads = (require(path.join(ROOT, 'data', 'pads.json'))[job.map] || {}).PAL || [];
const NP = 32, HMIN = 60, HSTEP = 0.25;
const lines = fs.readFileSync(path.join(dir, 'out-' + VER.toLowerCase() + '.txt'), 'utf8').trim().split('\n').filter(x => x);
const res = { map: job.map, name: room.name, ver: VER, spots: sp.length, dropSpots: 0, dropReach: [], bombSpots: 0, bombVerified: [], bombChecked: 0 };
// under the floor: a ray from 50 above the crack's floor down to just above Banjo, at his x/z, hits a floor (up-facing) triangle.
// (a fall off a ledge next to the crack has open air above him and does not count)
function underFloor(pos, floorY) { let hits = 0; for (const [dx, dz] of [[10, 0], [-10, 0], [0, 10], [0, -10]]) { const x = F(pos[0] + dx), z = F(pos[2] + dz);
  const a = [x, F(floorY + 50), z], b = [x, F(pos[1] + 10), z], n = [0, 0, 0]; const t = w.line(a, b, n, 0); if (t && n[1] > 0.4 && Math.abs(b[1] - floorY) < 10) hits++; } return hits >= 2; }
function run(pos, vel, maxU, floorY, grav) { w.stored = null; const tr = new BK.Tracker({ unk28: pos }); let g = false, hold = 0; pos = pos.map(F); let hitsBefore = 0;
  vel = vel.slice(); for (let u = 0; u < maxU; u++) { if (grav) { vel[1] = F(vel[1] + F(dt * grav)); if (vel[1] < -4000) vel[1] = F(-4000); } const tgt = [0, 1, 2].map(i => F(pos[i] + F(vel[i] * dt))); const r = BK.predict(w, pos, tgt, { grounded: g, tracker: tr, hold_counter: hold });
    if (r.hits > 0 && tgt[1] > floorY + 100) hitsBefore++; pos = r.result.map(F); g = !!r.grounded; hold = r.hold_counter_after;
    if (g && grav && vel[1] < 0) vel[1] = F(-1);
    if (pos[1] < floorY - 150) return { clip: underFloor(pos, floorY) ? 1 : 0, ledge: underFloor(pos, floorY) ? 0 : 1, hitsBefore, pos }; if (g && (!grav || pos[1] > floorY - 5)) return { clip: 0, hitsBefore }; }
  return { clip: 0, hitsBefore }; }
let nv = 0; const maxV = +(MAXV || 3000);
for (const l of lines) { const t = l.split(' '); const s = +t[0]; const c = sp[s]; const bi = t.indexOf('bomb'); const hi = t.indexOf('h');
  const nd = +t[5]; const hl = hi >= 0 ? t.slice(hi + 1, bi).map(Number) : []; const nb = +t[bi + 1]; const bl = t[bi + 2] === 'c' ? t.slice(bi + 3).map(Number) : [];
  if (nd) { res.dropSpots++;
    for (const p of pads.filter(p => p.kind === 'shock')) { const top = p.pos[1];
      const ok = hl.map(k => HMIN + k * HSTEP).filter(h => { const y = c[1] + h; if (y < top + 290 || y > top + 668) return false;
        const fall = y - c[1]; const air = 1250 / 1200 + Math.sqrt(2 * Math.max(0, y - top) / 1350) + Math.sqrt(2 * fall / 2700); return Math.hypot(c[0] - p.pos[0], c[2] - p.pos[2]) <= air * 500; });
      const real = ok.filter(h => run([c[0], F(c[1] + F(h)), c[2]], [0, 0, 0], 80, c[1], F(-2700)).clip);
      if (real.length) { res.dropReach.push({ spot: s, pos: c, pad: p.pos, heights: real.slice(0, 8), nHeights: real.length, dist: Math.round(Math.hypot(c[0] - p.pos[0], c[2] - p.pos[2])) }); break; } } }
  if (nb) { res.bombSpots++; if (nv < maxV) { nv++; res.bombChecked++;
      for (const cc of bl.slice(0, 4)) { const d = Math.floor(cc / NP), k = cc % NP; const dirv = dd[d]; const v = dirv.map(x => F(x * 4200)); const step = v.map(x => F(x * dt)); const back = F(12 + k / NP);
        const p0 = [0, 1, 2].map(i => F(c[i] - F(step[i] * back))); const o = run(p0, v, 20, c[1]);
        if (o.clip && !o.hitsBefore) { res.bombVerified.push({ spot: s, pos: c, dir: job.dirs[d], phase: k / NP }); break; } } } } }
const out = path.join(dir, 'post-' + VER.toLowerCase() + '.json'); fs.writeFileSync(out, JSON.stringify(res));
console.log(job.map, room.name, VER, 'spots', sp.length, '| drop clips at', res.dropSpots, 'spots, reachable from a shock pad', res.dropReach.length, '| bomb clips at', res.bombSpots, 'spots, checked', res.bombChecked, 'clean approach', res.bombVerified.length);
