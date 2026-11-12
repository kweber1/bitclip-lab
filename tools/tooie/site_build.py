# Claude 2026-11-11 (site_build.py): Banjo-Tooie census output (tcensus tc-<room>.txt) + room collision (bt_rooms.py json) ->
# Bit-Clip Lab site data: tooie/data/room-<map>.gz.wasm (gzipped JSON; .wasm so GitHub Pages serves the bytes as they are, like
# the Kazooie rooms) and an entry for tooie/data/index.json.
# usage: python3 site_build.py <tc-room.txt> <room.json> <site tooie dir>
import sys, json, gzip, math, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
O = {'0': 'land', '1': 'void', '2': 'eject', '3': 'stuck', '4': 'water', '5': 'wall'}

def tri_class(V, t, fl):
    a, b, c = V[t[0]], V[t[1]], V[t[2]]
    u = [b[i] - a[i] for i in range(3)]; v = [c[i] - a[i] for i in range(3)]
    n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; L = math.sqrt(sum(x * x for x in n)) or 1
    ny = n[1] / L
    if fl & 0x20020: return 3                 # water
    if fl & 0x400005: return 4                # not solid for Banjo
    return 0 if ny > 0.3 else (2 if ny < -0.3 else 1)   # floor / wall / ceiling

def build(tc, roomf, outdir):
    room = json.load(open(roomf)); key = room['map']
    # mesh: unique triangles of both models (cells repeat them)
    verts, vidx, tris = [], {}, []; seen = set()
    for mk in ('opa', 'xlu'):
        m = room[mk]
        if not m: continue
        V = m['vertices']
        for t in m['collision']['triangles']:
            pts = tuple(sorted(tuple(V[j]) for j in t[:3]))
            if pts in seen: continue
            seen.add(pts); ids = []
            for j in t[:3]:
                p = tuple(V[j])
                if p not in vidx: vidx[p] = len(verts); verts.append(p)
                ids.append(vidx[p])
            tris.append(ids + [tri_class(V, t, t[5]), t[5]])
    # visible level model (display lists) with texture coordinates; the textures are the lab's own (btgen.py)
    try:
        import btvis2
        vis = btvis2.room_vis(room, os.environ.get('BT_TEXDIR') or os.path.join(outdir, 'tex'))   # textures stay with the viewer (bitclip-lab/tooie/tex); data goes to the version repo; btvis2.save_descs()
    except Exception as ex:
        import traceback; traceback.print_exc(); vis = {'verts': [], 'tris': [], 'mats': [], 'error': str(ex)}
    import tempfile
    seams, seen = [], set(); nshown = 0; merged = {}; ncell = 0
    spf = tempfile.TemporaryFile('w+')   # shown spots as JSON text, one per line (rooms with millions of spots)
    head = None
    cnt = collections.Counter(); byseam = collections.Counter(); nsp = 0; nhold = 0; nvoid = 0
    # the site keeps every spot that goes through (walk / lag / jump) or holds at the census resolution (0.25 cell); the rest
    # (ejected, stuck, wall, water) one per seam per 2x2-unit cell, so the levels fit on GitHub Pages. Spots are kept as JSON text
    # (not lists) so rooms with millions of spots (e.g. Chuffy's Cab, a 4.2 GB census file) fit in memory.
    big = False   # the user wants every through / hold spot shown, also in huge rooms
    CATI = {'walk': 0, 'lag': 1, 'jump': 2, 'stuck': 3, 'eject': 4, 'wall': 5, 'water': 6}
    thin_txt = 'eject/stuck/wall/water spots: one per seam per 2x2-unit cell'
    fh = gzip.open(tc, 'rt') if tc.endswith('.gz') else open(tc)
    for l in fh:
        a = l.split()
        if not a: continue
        if a[0] == 'ROOM': head = a
        elif a[0] == 'SEAM':
            seams.append([float(a[4]), float(a[5]), float(a[6]), float(a[7]), float(a[8]), float(a[9]), round(float(a[10]), 4), round(float(a[11]), 4), int(a[12])] + [int(v) for v in a[2].split(':') + a[3].split(':')])   # + model:triangle of both floors (the browser simulator needs them)
        elif a[0] == 'CELL':
            # exhaustive census: every crack float of this 0.25 cell tested; counts per category + one float of the best category
            bar = a.index('|'); c = [int(v) for v in a[2:bar]]   # n, walk, void, lag, jump, eject, stuck, wall, water, hold
            r = a[bar + 1:]; seam = int(a[1]); outs = r[3]; hl = [int(v) for v in r[4].split(',')]; sits = [int(v) for v in r[6].split(',')]
            j = r[9] if len(r) > 9 else '-'
            jc = [int(v) for v in j[1:].split('/')[1].replace(':', ',').split(',')] if j != '-' else None
            n, cw, cv, cl, cj, ce, cs, cwa, cwt, ch = c
            cat = 'walk' if cw else 'lag' if cl else 'jump' if cj else 'stuck' if cs else 'eject' if ce else 'wall' if cwa else 'water'
            for k_, v_ in (('walk', cw), ('lag', cl), ('jump', cj), ('eject', ce), ('stuck', cs), ('wall', cwa), ('water', cwt)):
                if v_: cnt[k_] += v_; byseam[(seam, k_)] += v_
            nsp += n; nhold += ch; nvoid += cv; ncell += 1
            x, z = float(r[0]), float(r[2]); thru = cat in ('walk', 'lag', 'jump') or ch > 0
            entry = [x, float(r[1]), z, seam, n, cat, outs, sum(1 for h in hl if h), max(sits), int(r[7]), round(float(r[8]), 2),
                     (jc[0] if jc else -1), (jc[1] if jc else -1), (jc[5] if jc else -1), 1 if ch else 0, c]
            nshown += 1; spf.write(json.dumps(entry, separators=(',', ':')) + '\n')   # every 0.25 cell is its own spot (nothing merged)
            continue
        elif a[0] in ('SPOT', 'RUN'):
            run = None
            if a[0] == 'RUN':   # exhaustive census: n consecutive crack floats with identical outcomes, every one tested
                run = (int(a[3]), float(a[7]), float(a[8]), int(a[2]))   # n, x_end, z_end, across offset
                a = ['SPOT', a[1], a[4], a[5], a[6], a[3]] + a[9:]
            seam = int(a[1]); outs = a[6]
            holds = a[7]; j = a[12] if len(a) > 12 else '-'
            if j != '-':
                nj, rest = j[1:].split('/'); jc = [int(v) for v in rest.replace(':', ',').split(',')]   # clip, voids, eject, stuck, other, hold, sitmax
            else: jc = None
            walk = outs[0]; anyclip = ('0' in outs) or ('1' in outs)
            if walk in '01': cat = 'walk'
            elif walk == '5': cat = 'wall'
            elif walk == '4': cat = 'water'
            elif anyclip: cat = 'lag'
            elif jc and jc[0] > 0: cat = 'jump'
            elif walk == '3': cat = 'stuck'
            else: cat = 'eject'
            hl = [int(v) for v in holds.split(',')]
            hold = sum(hl) > 0 or (jc is not None and jc[5] > 0)
            cnt[cat] += 1; byseam[(seam, cat)] += 1; nsp += 1; nhold += hold; nvoid += walk == '1'
            x, z = float(a[2]), float(a[4]); thru = cat in ('walk', 'lag', 'jump') or hold
            if run: k = None   # every tested run is shown
            elif big: k = (seam, math.floor(x), math.floor(z), cat, hold) if thru else (seam, math.floor(x / 4), math.floor(z / 4), cat)
            else: k = None if thru else (seam, math.floor(x / 2), math.floor(z / 2), cat)
            if k is not None:
                k = ((k[0] * 4000037 + k[1] + 2000000) * 4000037 + k[2] + 2000000) * 16 + CATI[k[3]]   # exact packed key (hash() would merge -1 and -2)
                if k in seen: continue
                seen.add(k)
            sits = [int(v) for v in a[9].split(',')]
            nshown += 1; spf.write(json.dumps([x, float(a[3]), z, seam, int(a[5]), cat, outs, sum(1 for h in hl if h), max(sits), int(a[10]), round(float(a[11]), 2),
                          (jc[0] if jc else -1), (jc[1] if jc else -1), (jc[5] if jc else -1), 1 if hold else 0] + (list(run) if run else []), separators=(',', ':')) + '\n')
    fh.close(); seen = None
    for e_ in merged.values():
        e_[5] = 'stuck' if e_[15][6] else 'eject' if e_[15][5] else 'wall' if e_[15][7] else 'water'
        nshown += 1; spf.write(json.dumps(e_, separators=(',', ':')) + '\n')
    every = ncell > 0
    if every: thin_txt = 'every crack float tested; each spot is one 0.25 cell of one seam with counts per outcome (nothing merged)'
    flatseam = [s[6] > 0.999 and s[7] > 0.999 for s in seams]
    cntflat = collections.Counter()
    for (sm, c), n in byseam.items():
        if sm < len(flatseam) and flatseam[sm]: cntflat[c] += n
    data = {'map': key, 'name': room['name'], 'group': room['group'], 'maps': room['maps'], 'map_names': room['map_names'],
            'verts': [list(v) for v in verts], 'tris': tris, 'vis': vis, 'seams': seams,
            'spot_fields': ['x', 'y', 'z', 'seam', 'crack_floats', 'category', 'walk_outcomes_9', 'walk_runs_with_hold', 'max_sit_updates',
                            'decided_update', 'end_y', 'jump_clips_of_42', 'jump_voids_of_42', 'jump_drops_with_hold', 'any_hold',
                            'every_float_run: floats_in_run', 'x_end', 'z_end', 'across_offset'],
            'thinned': thin_txt, 'every': every, 'counts': dict(cnt), 'spots': '__SPOTS__'}
    os.makedirs(os.path.join(outdir, 'data'), exist_ok=True)
    spf.seek(0)
    wrote = False
    if every:   # TRB1 (tools/tooie/trb.py): the spots as typed columns, about 3x smaller than gzipped JSON
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trb')); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import trb
        try:
            cols = trb.Cols(nshown)
            for line in spf: cols.add(json.loads(line))
            trb.write(os.path.join(outdir, 'data', 'room-%s.gz.wasm' % key), data, cols); wrote = True
        except AssertionError as ex: print('TRB1 not possible (%s): writing JSON' % ex, file=sys.stderr); spf.seek(0)
    if not wrote:
        pre, post = json.dumps(data, separators=(',', ':')).split('"__SPOTS__"', 1)
        with gzip.open(os.path.join(outdir, 'data', 'room-%s.gz.wasm' % key), 'wb', 9) as f:
            f.write((pre + '[').encode()); first = True
            for line in spf:
                f.write(((',' if not first else '') + line.rstrip('\n')).encode()); first = False
            f.write((']' + post).encode())
    spf.close()
    entry = {'map': key, 'name': room['name'], 'group': room['group'], 'maps': room['maps'], 'map_names': room['map_names'],
             'tris': len(tris), 'seams': len(seams), 'crack_samples': int(head[5]) if head else 0, 'crack_floats': int(head[7]) if head else 0,
             'spots': nsp, 'shown': nshown, 'cats': dict(cnt), 'cats_flat': dict(cntflat), 'holds': nhold,
             'void': nvoid, 'every': every, 'cells': ncell, 'bytes': os.path.getsize(os.path.join(outdir, 'data', 'room-%s.gz.wasm' % key))}
    return entry

if __name__ == '__main__':
    e = build(sys.argv[1], sys.argv[2], sys.argv[3])
    idxf = os.path.join(sys.argv[3], 'data', 'index.json')
    if os.path.exists(idxf): idx = json.load(open(idxf))
    else:
        base = json.load(open('/home/claude/btmaps/tooie-lab/rooms-index.json'))
        idx = {'game': 'Banjo-Tooie (USA)', 'method': 'tcensus (Tooie collision port, NTSC)', 'rooms': [dict(r, done=False) for r in base]}
    e['done'] = True
    idx['rooms'] = [dict(r, **e) if r['map'] == e['map'] else r for r in idx['rooms']]
    json.dump(idx, open(idxf, 'w'), indent=1)
    print(json.dumps(e))
