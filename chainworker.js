// Chain-search worker thread (Bit-Clip Lab): keeps the standing states it makes (cache by id), tries every move / final move from
// them, and replays a state from its inputs only when it does not have it.
importScripts('bkcol.js', 'bkmove.js', 'bkmove_misc.js', 'bkmove_fly.js', 'bkmove_forms.js', 'bkmesh.js', 'bksearch.js', 'bkexact.js', 'bkchain.js');
let C = null, wid = -1; const cache = new Map(); const CAP = 20000;
const keep = (id, Q) => { cache.set(id, Q); if (cache.size > CAP) cache.delete(cache.keys().next().value); };
const stateOf = (n) => { const P = cache.get(n.id); if (P) { cache.delete(n.id); cache.set(n.id, P); return P; } return n.ins ? C.replay(n.ins) : null; };
self.onmessage = (e) => { const m = e.data;
  try {
    if (m.type === 'init') { wid = m.wid; const r = m.o.roomData; const world = new BK.World(BK.load_model(r.opa, 'opa'), r.xlu ? BK.load_model(r.xlu, 'xlu') : null, BK.load_props(r.props || []), r.map);
      C = BKCHAIN.setup(Object.assign({}, m.o, { world })); keep(0, C.P0); return; }
    if (m.type === 'expand') { const miss = m.nodes.filter(n => !cache.has(n.id) && !n.ins).map(n => n.id); if (miss.length) { self.postMessage({ miss, wid, kids: [], sims: 0 }); return; }
      let sims = 0; const kids = m.nodes.map((n, q) => { const P = stateOf(n); const r = C.expand(P, n.counts, true, n.cam, n.fine); sims += r.sims;
        return r.out.map(c => { const id = m.base + q * 65536 + c.vi; keep(id, c.Q); delete c.Q; delete c.rows; c.id = id; return c; }); });
      self.postMessage({ kids, sims, wid }); return; }
    if (m.type === 'finals') { let tried = 0, sims = 0, closest = 1e9, candidates = 0; const res = [];
      for (const n of m.nodes) { const P = stateOf(n); const r = C.finalsAt(P, n, null); tried += r.tried; sims += r.sims; candidates += r.candidates; closest = Math.min(closest, r.closest); res.push(...r.res); }
      self.postMessage({ res, tried, sims, closest, candidates, wid }); return; }
  } catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};
