// tools/roofdata.js -- site data from the roof scan: data/roof/map0xNN.json = { np, total, rows: [x,y,z,seam,clear,beePAL,flyPAL,beeNTSC,flyNTSC] }
// usage: node tools/roofdata.js <dir with <map>/out-pal.txt + out-ntsc.txt> [cap 60000] [outdir]
'use strict'; const fs = require('fs'), path = require('path');
const dir = process.argv[2], CAP = +(process.argv[3] || 60000); const outDir = process.argv[4] || path.join(__dirname, '..', 'data', 'roof'); fs.mkdirSync(outDir, { recursive: true });
const hf = h => Buffer.from(h, 'hex').readFloatBE(0); const sum = [];
for (const m of fs.readdirSync(dir).filter(x => /^0x/.test(x)).sort()) {
  const read = v => { const f = path.join(dir, m, 'out-' + v + '.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(x => x) : null; };
  const P = read('pal'), N = read('ntsc'); if (!P) continue; const map = new Map();
  const pos = new Map(); for (const l of P) { const t = l.split(' '); const k = t[1] + t[2] + t[3]; if (pos.has(k)) continue; pos.set(k, [hf(t[1]), hf(t[2]), hf(t[3]), +t[0], +t[4], +t[5], +t[6], 0, 0]); }
  if (N) for (const l of N) { const t = l.split(' '); const r = pos.get(t[1] + t[2] + t[3]); if (r) { r[7] = +t[5]; r[8] = +t[6]; } }
  // thin like the floor census: one spot per 0.25 x 0.25 cell per seam, keeping the one with the most clips
  for (const r of pos.values()) { const k = r[3] + ':' + Math.floor(r[0] / 0.25) + ',' + Math.floor(r[2] / 0.25); const o = map.get(k); if (!o || r[5] + r[6] + r[7] + r[8] > o[5] + o[6] + o[7] + o[8]) map.set(k, r); }
  let rows = [...map.values()]; const total = rows.length; const samples = pos.size;
  if (rows.length > CAP) { const clip = rows.filter(r => r[5] + r[6] + r[7] + r[8] > 0), rest = rows.filter(r => r[5] + r[6] + r[7] + r[8] === 0); const keep = Math.max(0, CAP - clip.length);
    const step = rest.length / Math.max(1, keep); const thin = []; for (let i = 0; i < keep && Math.floor(i * step) < rest.length; i++) thin.push(rest[Math.floor(i * step)]); rows = clip.slice(0, CAP).concat(thin); }
  rows = rows.map(r => [+r[0].toFixed(4), +r[1].toFixed(4), +r[2].toFixed(4), ...r.slice(3)]);
  fs.writeFileSync(path.join(outDir, 'map' + m + '.json'), JSON.stringify({ np: 16, total, samples, rows }));
  const c = (i, j) => rows.filter(r => r[i] + r[j] > 0).length; const s = { map: m, total, shown: rows.length, beePAL: rows.filter(r => r[5]).length, flyPAL: rows.filter(r => r[6]).length, beeNTSC: rows.filter(r => r[7]).length, flyNTSC: rows.filter(r => r[8]).length };
  sum.push(s); console.log(JSON.stringify(s)); }
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(sum, null, 1));
