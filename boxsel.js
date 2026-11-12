// boxsel.js (Claude 2026-11-12) -- 3D box selection for the Bit-Clip Lab viewers (Kazooie and Tooie): draw a box on the level
// (drag across the floor for its footprint, drag the top / bottom handles or type numbers for its height), see how many of the
// spots you can see right now (the layers that are on, the "Show" filter, the slicer) are inside it, and copy them as text or
// download them as a CSV file. Each viewer supplies an adapter: BoxSel.init({ THREE, scene, camera, renderer, controls, host,
// pickTargets(), cutY(), rows(box), fileName(), pos }). rows(box) returns the visible spots inside box {x0,x1,y0,y1,z0,z1} as
// plain objects (first keys: layer, x, y, z); the CSV columns are the union of their keys in first-seen order.
(function (root) {
  'use strict';
  let A = null, box = null, armed = false, drag = null, mesh = null, edges = null, hTop = null, hBot = null, rowsCache = null;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => (n ?? 0).toLocaleString('en-US');
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const STYLE = `.bxs{padding:0;font-size:12.5px;width:min(300px,calc(100% - 24px));z-index:4}
.bxs>summary{list-style:none;cursor:pointer;padding:7px 11px;display:flex;align-items:center;gap:8px}.bxs>summary::-webkit-details-marker{display:none}
.bxs>summary b{margin-right:auto;font-size:13px}.bxs .bb{display:grid;gap:7px;padding:8px 11px 11px;border-top:1px solid var(--line-soft,var(--line))}
.bxs .note{color:var(--muted);font-size:11.5px;line-height:1.45;margin:0}
.bxs .xyz{display:grid;grid-template-columns:auto 1fr 1fr;gap:4px 6px;align-items:center;font-family:var(--f-mono,monospace);font-size:11.5px}
.bxs .xyz input{width:100%;min-width:0;font:inherit;padding:2px 5px;border:1px solid var(--line);border-radius:5px;background:var(--sunk,var(--panel));color:var(--ink)}
.bxs .xyz span{color:var(--muted)}
.bxs .row{display:flex;gap:6px;flex-wrap:wrap}.bxs .cnt{font-family:var(--f-mono,monospace);font-size:11.5px;color:var(--ink);line-height:1.5}
.bxs textarea{width:100%;min-height:120px;max-height:260px;font:11px var(--f-mono,monospace);border:1px solid var(--line);border-radius:6px;background:var(--sunk,var(--panel));color:var(--ink);resize:vertical;white-space:pre;overflow:auto}`;
  function panel() {
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    const d = document.createElement('details'); d.className = 'float bxs'; d.id = 'boxSel'; Object.assign(d.style, A.pos || { right: '12px', top: '12px' });
    d.innerHTML = `<summary><b>Box select</b><span class="n" id="bxSum" style="color:var(--muted);font-family:var(--f-mono,monospace);font-size:11.5px"></span></summary>
      <div class="bb">
        <p class="note">Press <b>Draw box</b>, then drag across the level for the box's footprint. Drag the round handles on the top and bottom to set its height, or type the numbers. Only spots you can see count: the layers that are on, the Show filter and the slicer.</p>
        <div class="row"><button class="btn mini" id="bxDraw" aria-pressed="false">Draw box</button><button class="btn mini" id="bxFitY" title="Set the height to the visible spots inside the footprint">Fit height</button><button class="btn mini" id="bxClear">Clear</button></div>
        <div class="xyz" id="bxXYZ"><span></span><span>min</span><span>max</span>
          <span>x</span><input id="bxX0" type="number" step="1" aria-label="x min"><input id="bxX1" type="number" step="1" aria-label="x max">
          <span>y</span><input id="bxY0" type="number" step="1" aria-label="y min"><input id="bxY1" type="number" step="1" aria-label="y max">
          <span>z</span><input id="bxZ0" type="number" step="1" aria-label="z min"><input id="bxZ1" type="number" step="1" aria-label="z max"></div>
        <div class="cnt" id="bxCnt">No box yet.</div>
        <div class="row"><button class="btn mini" id="bxCopy" disabled>Copy as text</button><button class="btn mini" id="bxCsv" disabled>Download CSV</button></div>
        <textarea id="bxText" readonly hidden aria-label="Selected spots as CSV text"></textarea>
      </div>`;
    A.host.appendChild(d);
    $('bxDraw').onclick = () => setArmed(!armed);
    $('bxClear').onclick = () => { box = null; draw(); refresh(); };
    $('bxFitY').onclick = fitY;
    ['bxX0', 'bxX1', 'bxY0', 'bxY1', 'bxZ0', 'bxZ1'].forEach(id => $(id).onchange = () => { const v = k => +$(k).value;
      if (!box) box = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
      box = norm({ x0: v('bxX0'), x1: v('bxX1'), y0: v('bxY0'), y1: v('bxY1'), z0: v('bxZ0'), z1: v('bxZ1') }); draw(); refresh(); });
    $('bxCopy').onclick = copyText; $('bxCsv').onclick = download;
  }
  const norm = (b) => ({ x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1), z0: Math.min(b.z0, b.z1), z1: Math.max(b.z0, b.z1) });
  function setArmed(on) { armed = on; $('bxDraw').setAttribute('aria-pressed', on); $('bxDraw').textContent = on ? 'Drag on the level…' : 'Draw box'; A.renderer.domElement.style.cursor = on ? 'crosshair' : ''; }
  // ---- picking on the level (falls back to the horizontal plane through the orbit target)
  const rc = () => new A.THREE.Raycaster();
  function ndc(e) { const r = A.renderer.domElement.getBoundingClientRect(); return new A.THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
  function floorAt(e, planeY) { const ray = rc(); ray.setFromCamera(ndc(e), A.camera); const cy = A.cutY ? A.cutY() : 1e9;
    if (planeY == null) { const hit = ray.intersectObjects(A.pickTargets().filter(o => o && o.visible !== false), false).filter(h => h.point.y <= cy + 0.01).sort((a, b) => a.distance - b.distance)[0]; if (hit) return hit.point.clone(); planeY = A.controls.target.y; }
    const p = new A.THREE.Vector3(); return ray.ray.intersectPlane(new A.THREE.Plane(new A.THREE.Vector3(0, 1, 0), -planeY), p) ? p : null; }
  function handleAt(e) { if (!hTop) return null; const ray = rc(); ray.setFromCamera(ndc(e), A.camera); const h = ray.intersectObjects([hTop, hBot], false)[0]; return h ? h.object : null; }
  function onDown(e) {
    if (e.button !== 0) return;
    const h = handleAt(e);
    if (h) { drag = { kind: h === hTop ? 'top' : 'bot', y: e.clientY, start: h === hTop ? box.y1 : box.y0, upp: unitsPerPixel(h.position) }; }
    else if (armed) { const p = floorAt(e); if (!p) return; drag = { kind: 'foot', a: p, planeY: p.y }; box = { x0: p.x, x1: p.x, z0: p.z, z1: p.z, y0: p.y - 30, y1: p.y + 250 }; draw(); }
    else return;
    A.controls.enabled = false; e.stopImmediatePropagation(); e.preventDefault(); A.renderer.domElement.setPointerCapture && A.renderer.domElement.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (!drag) { if (hTop) A.renderer.domElement.style.cursor = handleAt(e) ? 'ns-resize' : (armed ? 'crosshair' : ''); return; }
    e.stopImmediatePropagation();
    if (drag.kind === 'foot') { const p = floorAt(e, drag.planeY); if (!p) return; const lo = Math.min(drag.a.y, p.y);
      box = norm({ x0: drag.a.x, x1: p.x, z0: drag.a.z, z1: p.z, y0: Math.min(lo - 30, box.y0), y1: box.y1 }); }
    else { const dy = (drag.y - e.clientY) * drag.upp; if (drag.kind === 'top') box.y1 = Math.max(box.y0 + 1, drag.start + dy); else box.y0 = Math.min(box.y1 - 1, drag.start + dy); }
    draw(); showNums();
  }
  function onUp(e) { if (!drag) return; e.stopImmediatePropagation(); const k = drag.kind; drag = null; A.controls.enabled = true; if (k === 'foot') { setArmed(false); if (box.x1 - box.x0 < 1 && box.z1 - box.z0 < 1) box = null; } draw(); refresh(); }
  function unitsPerPixel(p) { const d = A.camera.position.distanceTo(p); const h = A.renderer.domElement.clientHeight || 600; return 2 * d * Math.tan((A.camera.fov * Math.PI / 180) / 2) / h; }
  // ---- the box in the scene: faint faces, bright edges, two round handles (top and bottom)
  function draw() {
    const T = A.THREE; [mesh, edges, hTop, hBot].forEach(o => { if (o) { A.scene.remove(o); o.geometry.dispose(); o.material.dispose(); } }); mesh = edges = hTop = hBot = null;
    showNums(); if (!box) return;
    const col = new T.Color(css('--accent') || '#e0a030'); const sx = Math.max(box.x1 - box.x0, 0.01), sy = Math.max(box.y1 - box.y0, 0.01), sz = Math.max(box.z1 - box.z0, 0.01);
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, cz = (box.z0 + box.z1) / 2; const g = new T.BoxGeometry(sx, sy, sz);
    mesh = new T.Mesh(g, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false, side: T.DoubleSide })); mesh.position.set(cx, cy, cz); mesh.renderOrder = 5; A.scene.add(mesh);
    edges = new T.LineSegments(new T.EdgesGeometry(g), new T.LineBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthTest: false })); edges.position.copy(mesh.position); edges.renderOrder = 6; A.scene.add(edges);
    const r = Math.max(4, Math.min(40, Math.max(sx, sz) * 0.04)); const hg = new T.SphereGeometry(r, 16, 12);
    hTop = new T.Mesh(hg, new T.MeshBasicMaterial({ color: col, depthTest: false })); hTop.position.set(cx, box.y1, cz); hTop.renderOrder = 7; A.scene.add(hTop);
    hBot = new T.Mesh(hg.clone(), new T.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.7 })); hBot.position.set(cx, box.y0, cz); hBot.renderOrder = 7; A.scene.add(hBot);
  }
  function showNums() { const f = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = box ? (+v.toFixed(2)) : ''; };
    f('bxX0', box && box.x0); f('bxX1', box && box.x1); f('bxY0', box && box.y0); f('bxY1', box && box.y1); f('bxZ0', box && box.z0); f('bxZ1', box && box.z1); }
  function fitY() { if (!box) return; const all = A.rows({ x0: box.x0, x1: box.x1, z0: box.z0, z1: box.z1, y0: -1e9, y1: 1e9 }); if (!all.length) return;
    let lo = Infinity, hi = -Infinity; for (const r of all) { if (r.y < lo) lo = r.y; if (r.y > hi) hi = r.y; } box.y0 = Math.floor(lo - 2); box.y1 = Math.ceil(hi + 2); draw(); refresh(); }
  // ---- what is inside
  function refresh() { rowsCache = null; const c = $('bxCnt'); if (!c) return; $('bxText').hidden = true;
    if (!box) { c.textContent = 'No box yet.'; $('bxSum').textContent = ''; $('bxCopy').disabled = $('bxCsv').disabled = true; return; }
    const rows = getRows(); const by = new Map(); for (const r of rows) by.set(r.layer, (by.get(r.layer) || 0) + 1);
    c.innerHTML = `<b>${fmt(rows.length)}</b> visible spot${rows.length === 1 ? '' : 's'} in the box` + (by.size ? '<br>' + [...by].map(([k, n]) => `${k}: ${fmt(n)}`).join('<br>') : '');
    $('bxSum').textContent = fmt(rows.length); $('bxCopy').disabled = $('bxCsv').disabled = !rows.length; }
  function getRows() { if (!rowsCache) rowsCache = box ? A.rows(box) : []; return rowsCache; }
  const cell = (v) => { if (v == null) return ''; if (typeof v === 'number') return String(v); const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function csv(rows, max) { const cols = []; const seen = new Set(); for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    const out = [cols.join(',')]; const n = Math.min(rows.length, max ?? rows.length); for (let i = 0; i < n; i++) { const r = rows[i]; out.push(cols.map(k => cell(r[k])).join(',')); } return out.join('\n') + '\n'; }
  function copyText() { const rows = getRows(); const full = csv(rows); const LIM = 100000; const t = $('bxText');
    t.value = rows.length > LIM ? csv(rows, LIM) + `# … ${fmt(rows.length - LIM)} more rows: use Download CSV for all of them\n` : full; t.hidden = false; t.focus(); t.select();
    const b = $('bxCopy'); (navigator.clipboard ? navigator.clipboard.writeText(full) : Promise.reject()).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy as text', 1500); }).catch(() => { try { document.execCommand('copy'); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy as text', 1500); } catch (e) {} }); }
  function download() { const blob = new Blob([csv(getRows())], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (A.fileName ? A.fileName() : 'bitclip-box') + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  function init(adapter) {
    A = adapter; panel(); const el = A.renderer.domElement;
    el.addEventListener('pointerdown', onDown, true); el.addEventListener('pointermove', onMove, true); el.addEventListener('pointerup', onUp, true);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) setArmed(false); });
  }
  // the viewer calls this when the room, the layers or the filters change
  let tmr = 0; function changed(roomChanged) { if (!A) return; if (roomChanged) { box = null; draw(); } clearTimeout(tmr); tmr = setTimeout(refresh, 150); }
  root.BoxSel = { init, changed, inBox: (b, x, y, z) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1 };
})(typeof window !== 'undefined' ? window : this);
