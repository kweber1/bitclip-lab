// Claude 2026-11-11 (tsim-worker.js): runs the census for one 0.25 cell in the background (tsim.wasm = the census's own C++ code,
// tools/tooie/wasm/tsim.cpp) and streams the crack floats back to the page.
importScripts('tsim-lib.js');
let sim = null, roomKey = null;
const CLIP = new Set(['walk', 'lag', 'jump']);
onmessage = async (e) => {
  const m = e.data;
  try {
    if (!sim) sim = new TSim(await (await fetch('tsim.wasm')).arrayBuffer());
    if (roomKey !== m.roomKey) { sim.loadRoom(m.col); roomKey = m.roomKey; }
    let rows = [];
    const cnt = await sim.cell(m.seam, m.cx, m.cz, (f) => {
      if (m.filter === 'all' || CLIP.has(f.cat)) rows.push([f.xb, f.yb, f.zb, f.cat, f.res.out.join(''), f.res.jump[7] ? f.res.jump[0] : -1, f.hold, Math.max(...f.res.sits), f.res.upd[0], f.res.endy[0]]);
    }, { chunk: 256, progress: (p, c) => { postMessage({ type: 'progress', p, cnt: c, rows }); rows = []; }, yield: () => new Promise(r => setTimeout(r, 0)) });
    postMessage({ type: 'done', cnt, rows });
  } catch (err) { postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
