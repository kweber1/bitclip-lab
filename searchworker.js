// Route search worker for the Bit-Clip Lab: runs bksearch.js off the page's main thread so the 3D view stays smooth.
importScripts('bkcol.js', 'bkmove.js', 'bkmove_misc.js', 'bkmove_fly.js', 'bkmove_forms.js', 'bkmesh.js', 'bksearch.js', 'bkclipsetup.js', 'bkchain.js', 'bkexact.js', 'bkgpu.js');
let stopFlag = false;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'stop') { stopFlag = true; return; }
  if (m.type !== 'start') return;
  stopFlag = false;
  const r = m.room; const world = new BK.World(BK.load_model(r.opa, 'opa'), r.xlu ? BK.load_model(r.xlu, 'xlu') : null, BK.load_props(r.props || []), r.map);
  let buf = []; let last = 0;
  const flush = () => { if (buf.length) { self.postMessage({ type: 'paths', paths: buf }); buf = []; } };
  const o = Object.assign({}, m.opts, {
    world, roomData: r,
    onPath: (p, k) => { buf.push([k, p]); if (k === 'hold' || k === 'clip' || Date.now() - last > 300) { last = Date.now(); flush(); } },
    onResult: (res) => { flush(); self.postMessage({ type: 'result', res }); },
    onProgress: (f, t) => self.postMessage({ type: 'progress', f, t }),
    shouldStop: () => stopFlag,
  });
  try {
    const out = m.mode === 'exact' ? await BKEXACT.runExact(o) : m.mode === 'clip' ? await BKCLIP.solve(o) : m.mode === 'chain' ? await BKCHAIN.chainSearch(o) : m.mode === 'deep' ? await BKSEARCH.deepJump(o) : await BKSEARCH.search(o);
    flush(); delete out.results; self.postMessage({ type: 'done', out });
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
