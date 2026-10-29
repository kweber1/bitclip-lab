#!/usr/bin/env node
// clipsetup-cli.js -- run the site's exact "clip setup" search (bkclipsetup.js) from the command line for the clip
// spots near a note door, and write console test cases: exact start floats, facing, punch-cancel inputs and the game
// updates that must be long (3+ VI) for the clip, with the VI offset of each one after the B press.
//
//   node tools/sc64-260/clipsetup-cli.js --map 0x71 --door 260 --max 12 --out tools/sc64-260/cases-260.json
//   node tools/sc64-260/clipsetup-cli.js --map 0x71 --spot 3391.24951,1250,252.1281 --dirs 32
//
// Version is PAL unless --ntsc. Only flat-floor (holds) spots are used; slope / beak-buster spots are skipped.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..', '..');
global.self = global; // the lab modules attach to self in the browser
const BK = require(path.join(ROOT, 'bkcol.js')); global.BK = BK;
global.BKMOVE = require(path.join(ROOT, 'bkmove.js')); global.BKSEARCH = require(path.join(ROOT, 'bksearch.js'));
const BKCLIP = require(path.join(ROOT, 'bkclipsetup.js'));

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const has = (k) => process.argv.includes('--' + k);
const map = String(arg('map', '0x71')).toLowerCase().replace(/^0x/, '').padStart(2, '0').toUpperCase();
const version = has('ntsc') ? 'NTSC' : 'PAL';
const roomFile = path.join(ROOT, 'data', `map0x${map}.gz.wasm`);
const room = JSON.parse(zlib.gunzipSync(fs.readFileSync(roomFile)));
const world = new BK.World(BK.load_model(room.opa, 'opa'), room.xlu ? BK.load_model(room.xlu, 'xlu') : null, BK.load_props(room.props || []), parseInt(map, 16));
const door = (room.doors || []).find(d => String(d.door) === String(arg('door', ''))) || (room.doors || [])[0];

// ---- spot list: --spot x,y,z | clip spots of the room (old door census rows + full hold census rows), nearest the door first
function spots() {
  if (arg('spot')) return String(arg('spot')).split(';').map(s => { const [x, y, z] = s.split(',').map(Number); return { x, y, z, src: 'cli' }; });
  const out = []; const seen = new Set(); const K = { 1: '810', 2: 'fall', 3: 'rest' };
  const push = (o) => { const k = Math.fround(o.x) + ',' + Math.fround(o.z); if (seen.has(k)) return; seen.add(k); out.push(o); };
  for (const h of room.holds || []) if (h.clip_lag != null || h.clip) push({ x: h.x, y: h.y, z: h.z, src: 'door-census', seam: h.seam, held: h.held, lag: h.clip_lag });
  for (const a of room.holdsA || []) if (a[8] && !a[7]) push({ x: a[0], y: a[1], z: a[2], src: 'full-census', seam: a[3], kind: K[a[8][0]], lag: a[8][3], odds: a[9] || null });
  for (const o of out) o.dist = door ? Math.hypot(o.x - door.x, o.z - door.z) : 0;
  out.sort((a, b) => a.dist - b.dist);
  const maxd = +arg('maxdist', 1e9); return out.filter(o => o.dist <= maxd).slice(0, +arg('max', 12));
}

(async () => {
  const list = spots(); const cases = [];
  const ranges = { cancel: String(arg('cancel', '1,2')).split(',').map(Number), aHold: String(arg('hold', '2,3,4,5,6,7,8,10,12,14')).split(',').map(Number) };
  console.error(`${room.name} (0x${map}, ${version}) door ${door ? door.door : '-'}: ${list.length} spots`);
  for (const [i, sp] of list.entries()) {
    const t0 = Date.now(); let res;
    try {
      res = await BKCLIP.solve({ world, map: parseInt(map, 16), version, target: { x: sp.x, y: sp.y, z: sp.z }, move: 'punchCancel', ranges,
        dirs: +arg('dirs', 16), lags: +arg('lags', 2), cam: +arg('cam', 0) });
    } catch (e) { console.error(`spot ${i + 1}: ${e.message}`); continue; }
    const clips = res.results.filter(r => r.kind === 'clip');
    console.error(`spot ${i + 1} (${sp.x}, ${sp.y}, ${sp.z}) ${sp.dist.toFixed(0)} from door: ${res.arrived} arrive, ${res.results.length} hold, ${clips.length} clip (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const r of res.results) {
      // VI offset (from the B press) where each game update starts, given 2 VI per update except the long ones
      let vi = 0; const start = r.inputs.map(u => { const s = vi; vi += u.frames; return s; });
      cases.push({ spot: i + 1, src: sp.src, seam: sp.seam, dist: +sp.dist.toFixed(1), target: [sp.x, sp.y, sp.z], kind: r.kind, holds: r.holds,
        facing: r.facing, stick: r.stick, start: r.start, startBits: r.startBits, cancelUpdate: r.param.c + 1, aHoldUpdates: r.param.h,
        arriveUpdate: r.arrive, lagUpdates: r.lag, lagVIfromB: r.lag.map(u => start[u - 1]), endY: +r.endY.toFixed(3), desc: r.desc });
    }
  }
  const out = arg('out'); const txt = JSON.stringify({ map: '0x' + map, room: room.name, version, door, made: new Date().toISOString(), cases }, null, 1);
  if (out) { fs.writeFileSync(out, txt); console.error(`wrote ${cases.length} cases to ${out}`); } else process.stdout.write(txt + '\n');
})();
