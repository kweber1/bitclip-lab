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
    # visible level model (display lists): what the level looks like in game, incl. decoration Banjo does not collide with
    vis = {'verts': [], 'tris': []}
    try:
        import btassets as BA, btvis
        vidx2 = {}
        for mk in ('opa', 'xlu'):
            m = room[mk]
            if not m: continue
            tl, _ = btvis.visible(BA.asset(int(m['asset'], 16)))
            for t in tl:
                ids = []
                for p in t:
                    k = p[:3] + p[3:6]
                    if k not in vidx2: vidx2[k] = len(vis['verts']); vis['verts'].append(list(k))
                    ids.append(vidx2[k])
                vis['tris'].append(ids + [1 if mk == 'xlu' else 0])
    except Exception as ex: vis = {'verts': [], 'tris': [], 'error': str(ex)}
    seams, spots = [], []
    head = None
    for l in open(tc):
        a = l.split()
        if not a: continue
        if a[0] == 'ROOM': head = a
        elif a[0] == 'SEAM':
            seams.append([float(a[4]), float(a[5]), float(a[6]), float(a[7]), float(a[8]), float(a[9]), round(float(a[10]), 4), round(float(a[11]), 4), int(a[12])])
        elif a[0] == 'SPOT':
            seam, x, y, z, width = int(a[1]), a[2], a[3], a[4], int(a[5]); outs = a[6]
            holds = [int(v) for v in a[7].split(',')]; maxh = a[8]; sits = [int(v) for v in a[9].split(',')]; upd = int(a[10]); endy = float(a[11])
            j = a[12] if len(a) > 12 else '-'
            if j != '-':
                nj, rest = j[1:].split('/'); jc = [int(v) for v in rest.replace(':', ',').split(',')]   # clip, voids, eject, stuck, other, hold, sitmax
            else: nj, jc = 0, None
            walk = outs[0]; anyclip = any(c in '01' for c in outs)
            if walk in '01': cat = 'walk'
            elif walk == '5': cat = 'wall'
            elif walk == '4': cat = 'water'
            elif anyclip: cat = 'lag'
            elif jc and jc[0] > 0: cat = 'jump'
            elif walk == '3': cat = 'stuck'
            else: cat = 'eject'
            hold = sum(holds) > 0 or (jc is not None and jc[5] > 0)
            spots.append([float(x), float(y), float(z), seam, width, cat, outs, sum(1 for h in holds if h), max(sits), upd, round(endy, 2),
                          (jc[0] if jc else -1), (jc[1] if jc else -1), (jc[5] if jc else -1), 1 if hold else 0])
    cnt = collections.Counter(s[5] for s in spots)
    # the site keeps every spot that goes through (walk / lag / jump) or holds at the census resolution (0.25 cell); the rest
    # (ejected, stuck, wall, water) one per seam per 2x2-unit cell, so the levels fit on GitHub Pages
    shown, seen = [], set()
    for s_ in spots:
        if s_[5] in ('walk', 'lag', 'jump') or s_[14]: shown.append(s_); continue
        k = (s_[3], math.floor(s_[0] / 2), math.floor(s_[2] / 2), s_[5])
        if k in seen: continue
        seen.add(k); shown.append(s_)
    flatseam = [s[6] > 0.999 and s[7] > 0.999 for s in seams]
    cntflat = collections.Counter(s[5] for s in spots if flatseam[s[3]])
    data = {'map': key, 'name': room['name'], 'group': room['group'], 'maps': room['maps'], 'map_names': room['map_names'],
            'verts': [list(v) for v in verts], 'tris': tris, 'vis': vis, 'seams': seams,
            'spot_fields': ['x', 'y', 'z', 'seam', 'crack_floats', 'category', 'walk_outcomes_9', 'walk_runs_with_hold', 'max_sit_updates',
                            'decided_update', 'end_y', 'jump_clips_of_42', 'jump_voids_of_42', 'jump_drops_with_hold', 'any_hold'],
            'thinned': 'eject/stuck/wall/water spots: one per seam per 2x2-unit cell', 'counts': dict(cnt), 'spots': shown}
    os.makedirs(os.path.join(outdir, 'data'), exist_ok=True)
    raw = json.dumps(data, separators=(',', ':')).encode()
    with open(os.path.join(outdir, 'data', 'room-%s.gz.wasm' % key), 'wb') as f: f.write(gzip.compress(raw, 9))
    entry = {'map': key, 'name': room['name'], 'group': room['group'], 'maps': room['maps'], 'map_names': room['map_names'],
             'tris': len(tris), 'seams': len(seams), 'crack_samples': int(head[5]) if head else 0, 'crack_floats': int(head[7]) if head else 0,
             'spots': len(spots), 'shown': len(shown), 'cats': dict(cnt), 'cats_flat': dict(cntflat), 'holds': sum(s[14] for s in spots),
             'void': sum(1 for s in spots if s[6][0] == '1'), 'bytes': os.path.getsize(os.path.join(outdir, 'data', 'room-%s.gz.wasm' % key))}
    return entry

if __name__ == '__main__':
    e = build(sys.argv[1], sys.argv[2], sys.argv[3])
    idxf = os.path.join(sys.argv[3], 'data', 'index.json')
    if os.path.exists(idxf): idx = json.load(open(idxf))
    else:
        base = json.load(open(os.environ.get('BT_ROOMS_INDEX', 'tooie-lab/rooms-index.json')))
        idx = {'game': 'Banjo-Tooie (USA)', 'method': 'tcensus (Tooie collision port, NTSC)', 'rooms': [dict(r, done=False) for r in base]}
    e['done'] = True
    idx['rooms'] = [dict(r, **e) if r['map'] == e['map'] else r for r in idx['rooms']]
    json.dump(idx, open(idxf, 'w'), indent=1)
    print(json.dumps(e))
