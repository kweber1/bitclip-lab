// ref.js -- the same search with the JavaScript engine (bkclipsetup solve), printed in bkpc's output format for comparison.
// usage: node ref.js <spots.json> <job.bin.json> [first] [count]
'use strict';
const fs = require('fs'), zlib = require('zlib'), path = require('path'); global.self = global;
const ROOT = path.join(__dirname, '..', '..');
const BK = require(path.join(ROOT, 'bkcol.js')); global.BK = BK; global.BKMOVE = require(path.join(ROOT, 'bkmove.js')); global.BKSEARCH = require(path.join(ROOT, 'bksearch.js'));
const BKCLIP = require('./bkclipsetup_ref.js'); const F = Math.fround;
const spots = JSON.parse(fs.readFileSync(process.argv[2])); const job = JSON.parse(fs.readFileSync(process.argv[3]));
const first = +(process.argv[4] || 0), count = +(process.argv[5] || spots.length);
const MAP = parseInt(job.map, 16);
const room = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'data', `map0x${MAP.toString(16).toUpperCase().padStart(2, '0')}.gz.wasm`))));
const world = new BK.World(BK.load_model(room.opa, 'opa'), room.xlu ? BK.load_model(room.xlu, 'xlu') : null, BK.load_props(room.props || []), MAP);
const cancel = [...new Set([])]; const params = [];
const bits = (x) => { const b = Buffer.alloc(4); b.writeFloatBE(x); return b.readUInt32BE(0).toString(16).toUpperCase().padStart(8, '0'); };
(async () => {
  for (let s = first; s < Math.min(spots.length, first + count); s++) { const a = spots[s];
    const cs = [...new Set(job.cancelList || [])];
    const res = await BKCLIP.solve({ world, map: MAP, version: 'PAL', target: { x: a[0], y: a[1], z: a[2] }, move: 'punchCancel', ranges: { cancel: job.cancel, aHold: job.hold }, dirs: 0, facings: job.yaws,
      cam: 0, patterns: () => job.pats, maxUpd: job.maxUpd, standCheck: !!job.stand });
    for (const r of res.results) { const yi = job.yaws.indexOf(F(r.facing)); const pi = job.paramList.findIndex(p => p[0] === r.param.c && p[1] === r.param.h);
      const qi = job.pats.findIndex(p => JSON.stringify(p.map(u => u + 1)) === JSON.stringify(r.lag));
      console.log(`${s} ${yi} ${pi} ${qi} ${r.arrive - 1} ${r.holds} ${r.kind === 'clip' ? 1 : 0} ${r.endY.toFixed(6)} ${r.startBits[0]} ${r.startBits[1]}`); }
  }
})();
