// pack.js -- write a bkpc job file: the room (map 0x71 by default) and the flat test floors in the layout of bkcol_port.h, the
// libultra acos table, and the search: crack spots, facings, punch-cancel A timings and lag patterns.
// usage: node pack.js <spots.json [[x,y,z,..],...]> <out.bin> [--map 0x71] [--cancel 1,2,3,4] [--hold 2,3,...] [--dirs 8]
//        [--pats none|single|early|LIST] [--maxupd 40] [--nostand] [--root <bitclip-lab dir>]
// --pats: short = one 1-frame update on every update; short2 = every pair of 1-frame updates; shortlong = one short + one long;
// (in LIST, u+1000 = a 1-frame update on update u)
// --pats: none = no lag only; single = [] + one long update on every update 0..maxupd-1; early = [] + one on 2..12;
//         LIST = semicolon-separated patterns of comma-separated 0-based updates, e.g. "24;23;25,28" ("-" = no lag)
'use strict';
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ROOT = opt('--root', path.join(__dirname, '..', '..'));
global.self = global;
const BK = require(path.join(ROOT, 'bkcol.js')); global.BK = BK; global.BKMOVE = require(path.join(ROOT, 'bkmove.js'));
const SR = require(path.join(ROOT, 'bksearch.js'));
const F = Math.fround;
const mapHex = opt('--map', '0x71'); const MAP = parseInt(mapHex, 16);
const room = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'data', `map${'0x' + MAP.toString(16).toUpperCase().padStart(2, '0')}.gz.wasm`))));
const spots = JSON.parse(fs.readFileSync(args[0]));
const cancel = opt('--cancel', '1,2,3,4').split(',').map(Number);
const hold = opt('--hold', '2,3,4,5,6,7,8,9,10,11,12,14').split(',').map(Number);
const dirs = +opt('--dirs', '8'); const maxUpd = +opt('--maxupd', '40'); const stand = args.includes('--nostand') ? 0 : 1;
const MAXLAG = 12;

// ---- room packing (bkcol_port.h layout)
function packWorld(opa, xlu, props, margin, map) {
  const TF = [], TI = [], CLI = [], CLF = [], CELLS = [], PF = [], PI = [], PC = []; let ntri = 0, ncell = 0;
  const addCL = (cl) => {
    const idx = CLF.length; const tb = ntri, cb = ncell;
    for (const t of cl.tris) {
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) TF.push(t.v[k][j]);
      for (const a of [t.ab, t.ac, t.lineN, t.unitN, t.tmin, t.tmax]) for (let j = 0; j < 3; j++) TF.push(a[j]);
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) TI.push(t.vi[k][j] | 0);
      TI.push(t.unk6 | 0, t.flags | 0); ntri++;
    }
    for (const c of cl.cells) { CELLS.push(c[0] | 0, c[1] | 0); ncell++; }
    CLI.push(tb, cl.tris.length, cb, cl.cells.length, cl.min[0], cl.min[1], cl.min[2], cl.max[0], cl.max[1], cl.max[2], cl.y_stride, cl.z_stride, cl.scale, 0, 0, 0);
    CLF.push(cl.global_norm); return idx;
  };
  const opaI = addCL(opa); const xluI = xlu ? addCL(xlu) : -1;
  const groups = new Map(), glob = [];
  props.forEach((p, i) => {
    const cli = addCL(p.cl); PF.push(p.pos[0], p.pos[1], p.pos[2], p.sc, p.gn);
    for (const M of [p.W, p.M, p.R]) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) PF.push(M.m[a][b]);
    PI.push(cli, p.cube ? 1 : 0, p.order | 0, 0); PC.push(...(p.cube || [0, 0, 0]));
    if (!p.cube) glob.push(i); else { const k = p.cube.join(','); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  });
  const byOrder = (a, b) => props[a].order - props[b].order;
  const GR = [map, opaI, xluI, props.length, groups.size, glob.length, 0, 0, 0];
  const gl = [...groups.entries()]; GR[6] = GR.length; const gidx = [];
  for (const [k, list] of gl) { list.sort(byOrder); const c = k.split(',').map(Number); GR.push(c[0], c[1], c[2], gidx.length, list.length); gidx.push(...list); }
  GR[7] = GR.length; GR.push(...gidx); glob.sort(byOrder); GR[8] = GR.length; GR.push(...glob);
  return { TF, TI, CLI, CLF, CELLS, PF, PI, PC, GR, RF: [margin] };
}
const opa = BK.load_model(room.opa, 'opa'), xlu = room.xlu ? BK.load_model(room.xlu, 'xlu') : null; const props = BK.load_props(room.props || []);
const worldMargin = new BK.World(opa, xlu, props, MAP).margin;
const real = packWorld(opa, xlu, props, worldMargin, MAP);
// flat test floors (bkclipsetup flatWorldAt): one per integer floor height among the spots
const flatYs = [...new Set(spots.map(s => F(s[1]) | 0))]; if (flatYs.length > 8) throw new Error('more than 8 flat floor heights');
const flats = flatYs.map(y => { const L = 60000;
  const d = { vertices: [[-L, y, -L], [L, y, -L], [L, y, L], [-L, y, L]], vertex_header: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100000], collision: { header: null, cells: [], triangles: [[0, 2, 1, 0, 0], [0, 3, 2, 0, 0]] } };
  return packWorld(BK.load_model(d, 'flat'), null, [], F(200), 0); });

// ---- facings, params, patterns
const yaws = []; const seen = new Set();
for (let i = 0; i < dirs; i++) { const s = SR.stickFor(360 * i / dirs, F(0), 1); if (!seen.has(s.yaw)) { seen.add(s.yaw); yaws.push(F(s.yaw)); } }
const params = []; for (const c of cancel) for (const h of hold) params.push(c, h);
let pm = opt('--pats', 'none'); if (pm.startsWith('@')) pm = fs.readFileSync(pm.slice(1), 'utf8').trim(); let pats;
if (pm === 'none') pats = [[]];
else if (pm === 'single') { pats = [[]]; for (let u = 0; u < maxUpd; u++) pats.push([u]); }
else if (pm === 'short') { pats = [[]]; for (let u = 0; u < maxUpd; u++) pats.push([u + 1000]); }
else if (pm === 'short2') { pats = [[]]; for (let u = 0; u < maxUpd; u++) for (let v = u + 1; v < maxUpd; v++) pats.push([u + 1000, v + 1000]); }
else if (pm === 'shortlong') { pats = [[]]; for (let u = 0; u < maxUpd; u++) for (let v = 0; v < maxUpd; v++) if (u !== v) pats.push([u + 1000, v]); }
else if (pm === 'early') { pats = [[]]; for (let u = 2; u <= 12; u++) pats.push([u]); }
else pats = pm.split(';').map(s => s === '-' ? [] : s.split(',').map(Number));
const patsFlat = []; for (const p of pats) { for (let q = 0; q < MAXLAG; q++) patsFlat.push(q < p.length ? p[q] : -1); }

// ---- write
const bufs = []; const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v | 0); bufs.push(b); };
const arr = (type, a) => { i32(a.length); const b = Buffer.alloc(a.length * (type === 'f64' ? 8 : type === 'u16' ? 2 : 4));
  a.forEach((v, i) => { if (type === 'f32') b.writeFloatLE(v, i * 4); else if (type === 'i32') b.writeInt32LE(v | 0, i * 4); else if (type === 'f64') b.writeDoubleLE(v, i * 8); else b.writeUInt16LE(v, i * 2); }); bufs.push(b); };
const room_ = (r) => { arr('f32', r.TF); arr('i32', r.TI); arr('i32', r.CLI); arr('f32', r.CLF); arr('i32', r.CELLS); arr('f32', r.PF); arr('i32', r.PI); arr('i32', r.PC); arr('i32', r.GR); arr('f32', r.RF); };
i32(0x42504331); arr('u16', Array.from(BK.acos_table()));
room_(real); i32(flats.length); flats.forEach(room_);
i32(maxUpd); i32(stand);
const sp = []; for (const s of spots) sp.push(s[0], s[1], s[2], flatYs.indexOf(F(s[1]) | 0)); arr('f64', sp);
arr('f32', yaws); arr('i32', params); arr('i32', patsFlat);
fs.writeFileSync(args[1], Buffer.concat(bufs));
fs.writeFileSync(args[1] + '.json', JSON.stringify({ map: mapHex, nspots: spots.length, yaws, cancel, hold, paramList: cancel.flatMap(c => hold.map(h => [c, h])), pats, maxUpd, stand, flatYs }));
console.error(`wrote ${args[1]}: ${spots.length} spots x ${yaws.length} facings x ${params.length / 2} A timings x ${pats.length} lag patterns = ${spots.length * yaws.length * params.length / 2 * pats.length} cases`);
