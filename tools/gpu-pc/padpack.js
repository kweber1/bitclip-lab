// padpack.js -- job files for padscan.cu: room.bin (anc layout: magic, acos table, room), spots.txt (crack spots), dirs.txt (bomb directions)
// usage: node padpack.js <map hex> <PAL|NTSC> <outdir> [--every N] [--max M] [--near x,y,z,R] [--pitch 10,20,...] [--yaws 24]
'use strict';
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.join(__dirname, '..', '..'); global.self = global; const BK = require(path.join(ROOT, 'bkcol.js')); const F = Math.fround;
const MAP = parseInt(args[0], 16), VER = args[1], OUT = args[2]; fs.mkdirSync(OUT, { recursive: true });
function loadMap(id, ver) { const h = id.toString(16).toUpperCase().padStart(2, '0'), d = path.join(ROOT, 'data') + '/';
  if (ver === 'NTSC' && fs.existsSync(d + 'map0x' + h + '.ntsc.wasm')) return JSON.parse(zlib.gunzipSync(fs.readFileSync(d + 'map0x' + h + '.ntsc.wasm')));
  if (fs.existsSync(d + 'map0x' + h + '.gz.wasm')) return JSON.parse(zlib.gunzipSync(fs.readFileSync(d + 'map0x' + h + '.gz.wasm')));
  const parts = []; for (let i = 0; fs.existsSync(d + 'map0x' + h + '.gz.' + i + '.wasm'); i++) parts.push(fs.readFileSync(d + 'map0x' + h + '.gz.' + i + '.wasm'));
  return JSON.parse(zlib.gunzipSync(Buffer.concat(parts))); }
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

const room = loadMap(MAP, 'PAL'); const pal = room; // collision is the same in both versions (only dt differs)
const opa = BK.load_model(room.opa, 'opa'), xlu = room.xlu ? BK.load_model(room.xlu, 'xlu') : null; const props = BK.load_props(room.props || pal.props || []);
const margin = new BK.World(opa, xlu, props, MAP).margin; const real = packWorld(opa, xlu, props, margin, MAP);
const bufs = []; const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v | 0); bufs.push(b); };
const arr = (type, a) => { i32(a.length); const b = Buffer.alloc(a.length * (type === 'u16' ? 2 : 4)); a.forEach((v, i) => { if (type === 'f32') b.writeFloatLE(v, i * 4); else if (type === 'i32') b.writeInt32LE(v | 0, i * 4); else b.writeUInt16LE(v, i * 2); }); bufs.push(b); };
i32(0x42504331); arr('u16', Array.from(BK.acos_table())); for (const [t, k] of [['f32', 'TF'], ['i32', 'TI'], ['i32', 'CLI'], ['f32', 'CLF'], ['i32', 'CELLS'], ['f32', 'PF'], ['i32', 'PI'], ['i32', 'PC'], ['i32', 'GR'], ['f32', 'RF']]) arr(t, real[k]);
fs.writeFileSync(path.join(OUT, 'room.bin'), Buffer.concat(bufs));
const hx = (f) => { const b = Buffer.alloc(4); b.writeFloatBE(F(f)); return b.toString('hex'); };
let cr = (room.cracks || pal.cracks || []).map(c => [F(c[0]), F(c[1]), F(c[2])]);
const near = opt('--near', null); if (near) { const P = near.split(';').map(s => s.split(',').map(Number)); cr = cr.filter(c => P.some(([x, y, z, R]) => Math.hypot(c[0] - x, c[2] - z) <= R && c[1] <= y + 700)); }
if (args.includes('--nodirs')) args.push('--pitch', '');
const every = +opt('--every', '1'), max = +opt('--max', '1e9'); const sel = []; for (let i = 0; i < cr.length && sel.length < max; i += every) sel.push(cr[i]);
fs.writeFileSync(path.join(OUT, 'spots.txt'), sel.map(c => c.map(hx).join(' ')).join('\n') + '\n');
const pitches = (args.includes('--nodirs') ? '' : opt('--pitch', '10,20,30,40,50,60,70,80')).split(',').filter(x => x !== '').map(Number), ny = +opt('--yaws', '24'); const dirs = [];
for (const p of pitches) for (let k = 0; k < ny; k++) { const t = p * Math.PI / 180, y = k * 360 / ny * Math.PI / 180; dirs.push([Math.cos(t) * Math.sin(y), -Math.sin(t), Math.cos(t) * Math.cos(y)].map(F)); }
fs.writeFileSync(path.join(OUT, 'dirs.txt'), dirs.map(d => d.map(hx).join(' ')).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'job.json'), JSON.stringify({ map: args[0], ver: VER, spots: sel.length, dirs: pitches.flatMap(p => Array.from({ length: ny }, (_, k) => [p, k * 360 / ny])) }));
console.log(args[0], VER, 'spots', sel.length, 'of', cr.length, 'dirs', dirs.length, 'tris', real.TI.length / 11);
