// tools/paddata.js -- site data from the pad-clip scan (padscan.cu + padpost.js): data/padclips/map0xNN.json =
// { pads: [[kind, x, y, z]], PAL|NTSC: { shock: [[x,y,z, pad index, n heights, h1, h2, ...]], bomb: [[x,y,z, pitch, yaw, phase]],
//   shockAll, bombAll, bombChecked } }   usage: node tools/paddata.js <pj dir>
'use strict'; const fs = require('fs'), path = require('path'); const dir = process.argv[2];
const out = path.join(__dirname, '..', 'data', 'padclips'); fs.mkdirSync(out, { recursive: true }); const pads = require(path.join(__dirname, '..', 'data', 'pads.json'));
const maps = {}; const r4 = v => +(+v).toFixed(4);
for (const j of fs.readdirSync(dir).filter(x => /^0x/.test(x))) for (const v of ['PAL', 'NTSC']) {
  const f = path.join(dir, j, 'post-' + v.toLowerCase() + '.json'); if (!fs.existsSync(f)) continue; const p = JSON.parse(fs.readFileSync(f)); const m = p.map;
  const M = maps[m] = maps[m] || { name: p.name, pads: (pads[m] ? pads[m].PAL : []).map(q => [q.kind, ...q.pos]) }; const V = M[v] = M[v] || { shock: [], bomb: [], shockAll: 0, bombAll: 0, bombChecked: 0 };
  for (const s of p.dropReach) { const pi = M.pads.findIndex(q => q[1] === s.pad[0] && q[2] === s.pad[1] && q[3] === s.pad[2]); V.shock.push([r4(s.pos[0]), r4(s.pos[1]), r4(s.pos[2]), pi, s.nHeights ?? s.heights.length, ...s.heights.map(h => +h.toFixed(2))]); }
  for (const b of p.bombVerified) V.bomb.push([r4(b.pos[0]), r4(b.pos[1]), r4(b.pos[2]), b.dir[0], b.dir[1], b.phase]);
  V.shockAll += p.dropSpots; V.bombAll += p.bombSpots; V.bombChecked += p.bombChecked; }
const sum = [];
for (const [m, M] of Object.entries(maps)) { fs.writeFileSync(path.join(out, 'map' + m + '.json'), JSON.stringify(M));
  const s = { map: m, name: M.name }; for (const v of ['PAL', 'NTSC']) if (M[v]) Object.assign(s, { [v]: { shockReach: M[v].shock.length, shockAll: M[v].shockAll, bombClean: M[v].bomb.length, bombChecked: M[v].bombChecked, bombAll: M[v].bombAll } }); sum.push(s); }
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(sum, null, 1)); console.log(JSON.stringify(sum, null, 1));
