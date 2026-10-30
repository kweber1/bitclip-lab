// tools/lower_ingest.js -- puts lower-floor / rim crack results (research\bitclip-lab\lowercensus\out\lower-0xNN.json from lower-gpu.js)
// into the site's room data (data/map0xNN.gz[.i].wasm: gzip JSON, 15 MB parts) and data/index.json.
// Rows: [x, y, z, seam, drop, stand verdict, stand end y, held, max holds, fall verdict, kind (1 810, 2 fall, 3 rest), h, vy, lag (-1 none),
// end y, buster under, buster onto]; untested sample spots [x, y, z, seam, drop]. Tested spots that go through come first (cap CAP rows).
// usage: node tools/lower_ingest.js lower-0xNN.json [...]
'use strict'; const fs = require('fs'), path = require('path'), zlib = require('zlib');
const D = path.join(__dirname, '..', 'data'); const CAP = 150000, PART = 15000000; const KIND = { '810': 1, fall: 2, rest: 3 };
const idxF = path.join(D, 'index.json'); const index = JSON.parse(fs.readFileSync(idxF));
const r4 = v => +(+v).toFixed(4);
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(f)); const m = j.map; const h = m.slice(2).toUpperCase().padStart(2, '0'); const ent = index.find(e => e.map === '0x' + h); if (!ent) { console.log('no room', m); continue; }
  const names = ent.gzparts ? Array.from({ length: ent.gzparts }, (_, i) => path.join(D, `map0x${h}.gz.${i}.wasm`)) : [path.join(D, `map0x${h}.gz.wasm`)];
  const room = JSON.parse(zlib.gunzipSync(Buffer.concat(names.map(n => fs.readFileSync(n)))));
  const row = (d) => { const fl = d.fall || {}; return [r4(d.x), r4(d.y), r4(d.z), d.seam, +(+d.drop).toFixed(2), d.stand ? d.stand[0] : 0, d.stand ? d.stand[1] : null, d.held || 0, d.max_holds || 0,
    fl.v || 0, KIND[fl.kind] || 0, fl.h ?? null, fl.vy ?? null, fl.lag == null ? -1 : fl.lag, fl.endY ?? null, d.buster ? d.buster[0] : 0, d.buster ? d.buster[1] : 0]; };
  const through = d => d[5] === 2 || d[9] === 2 || (d[15] || 0) > 0;
  let rows = j.hits.map(row); const nThrough = rows.filter(through).length, nStand = rows.filter(d => d[5] === 2).length;
  rows.sort((a, b) => (through(b) ? 1 : 0) - (through(a) ? 1 : 0)); const samp = (j.sample || []).map(s => [r4(s[0]), r4(s[1]), r4(s[2]), s[3], +(+s[4]).toFixed(2)]);
  rows = rows.concat(samp).slice(0, CAP);
  room.lowercracks = rows; room.lowercracks_total = j.total;
  room.lower_note = `Cracks over lower floors & rims: ${j.total.toLocaleString('en-US')} spots where the floor ray misses the floor but hits something 5+ below, or misses a floor triangle at its rim (${j.tested.toLocaleString('en-US')} tested); ${nThrough.toLocaleString('en-US')} fall through in a test (${nStand.toLocaleString('en-US')} just from standing on them).`;
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(room)), { level: 9 });
  for (const n of names) fs.renameSync(n, n + '.old');
  if (gz.length > PART) { const n = Math.ceil(gz.length / PART); for (let i = 0; i < n; i++) fs.writeFileSync(path.join(D, `map0x${h}.gz.${i}.wasm`), gz.subarray(i * PART, (i + 1) * PART)); ent.gzparts = n; }
  else { fs.writeFileSync(path.join(D, `map0x${h}.gz.wasm`), gz); delete ent.gzparts; }
  for (const n of names) fs.unlinkSync(n + '.old');
  ent.lower = j.total; ent.lower_through = nThrough; ent.size = gz.length;
  console.log(m, room.name, 'spots', j.total, 'rows', rows.length, 'through', nThrough, 'standing', nStand, 'gz', gz.length);
}
fs.writeFileSync(idxF, '[\n' + index.map(e => '{\n' + Object.entries(e).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n') + '\n}').join(',\n') + '\n]');
