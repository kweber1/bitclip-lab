// Exact-search worker thread (Bit-Clip Lab): expands backward-table entries and runs forward tails for bkexact.js.
importScripts('bkexact.js');
let C = null;
self.onmessage = (e) => { const m = e.data;
  if (m.type === 'init') { C = BKEXACT.core(m.cfg); return; }
  if (m.type === 'table') { C.setTable(m.tab); self.postMessage({ ok: 1 }); return; }
  if (m.type === 'expand') { const out = []; const a = m.items;
    for (let b = 0; b < a.length; b += 6) C.expandEntry(a[b], a[b + 1], a[b + 2], a[b + 3], a[b + 4], a[b + 5], (xb, zb, u, yb, parent, d, rem, k, m0, m1) => out.push(xb, zb, u, yb, parent >>> 0, d, rem, k, m0, m1));
    const o = Uint32Array.from(out); self.postMessage({ out: o }, [o.buffer]); return; }
  if (m.type === 'fwd') { const hits = []; const n0 = C.nodes(); const P = Math.max(1, m.plen);
    for (let q = 0; q < m.nt.length; q++) { const path = []; for (let k = 0; k < m.plen; k++) path.push(m.pl[q * P + k]);
      const s = { x: m.st[q * 4], z: m.st[q * 4 + 1], y: m.st[q * 4 + 2], cam: m.st[q * 4 + 3], ntw: m.nt[q], path };
      C.dfs(s, m.tail, (s2, entry, fin) => hits.push({ path: s2.path, entry, fin, yb: BKEXACT.fbit(s2.y) })); }
    self.postMessage({ hits, nodes: C.nodes() - n0 }); return; }
};
