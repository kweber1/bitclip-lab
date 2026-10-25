// Chain-search worker thread (Bit-Clip Lab): replays a standing state from its inputs, then tries every move / final move from it.
importScripts('bkcol.js', 'bkmove.js', 'bksearch.js', 'bkexact.js', 'bkchain.js');
let C = null;
self.onmessage = (e) => { const m = e.data;
  try {
    if (m.type === 'init') { const r = m.o.roomData; const world = new BK.World(BK.load_model(r.opa, 'opa'), r.xlu ? BK.load_model(r.xlu, 'xlu') : null, BK.load_props(r.props || []), r.map);
      C = BKCHAIN.setup(Object.assign({}, m.o, { world })); return; }
    if (m.type === 'expand') { let sims = 0; const kids = m.nodes.map(n => { const P = C.replay(n.ins); const r = C.expand(P, n.counts, false, n.cam); sims += r.sims; return r.out; });
      self.postMessage({ kids, sims }); return; }
    if (m.type === 'finals') { let tried = 0, sims = 0, closest = 1e9; const res = [];
      for (const n of m.nodes) { const P = C.replay(n.ins); const r = C.finalsAt(P, n, null); tried += r.tried; sims += r.sims; closest = Math.min(closest, r.closest); res.push(...r.res); }
      self.postMessage({ res, tried, sims, closest }); return; }
  } catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};
