# Claude 2026-11-11 (bkobjects.py): Banjo-Kazooie objects and enemies for the Bit-Clip Lab viewer, same format as the Tooie viewer's
# (btobjects.py). From the user's own PAL ROM, no emulator: every map's setup file (cube grid): actor spawn nodes (category 6:
# x y z, actor id, yaw, scale %) and cube props (12-byte records: model or sprite id, yaw x2, roll x2, x y z, scale %, flags).
# Actor id -> model asset from the decomp's ActorInfo tables (ACTOR_x, ASSET_y pairs); model assets are identical in PAL and US.
# Output: <site>/models/<asset>.gz.wasm (visible triangles, texture coordinates, lab texture keys), <site>/data/objects.gz.wasm.
import sys, os, json, gzip, struct, re, collections
sys.path.insert(0, '/home/claude/bkvis'); sys.path.insert(0, '/home/claude/btmaps')
import numpy as np
import bkassets as B, bktex, bkvis, bkhd, btrice
SETUP = 0x71C
def setup_nodes(m):
    d = B.asset(SETUP + m)
    if d is None or d[:2] != b'\x01\x01': return [], []
    low = struct.unpack_from('>3i', d, 2); high = struct.unpack_from('>3i', d, 14); p = 26; nodes = []; props = []
    for cx in range(low[0], high[0] + 1):
        for cy in range(low[1], high[1] + 1):
            for cz in range(low[2], high[2] + 1):
                while d[p] != 1:
                    tag = d[p]; p += 1
                    if tag == 0: p += 24
                    elif tag == 2: p += 12
                    elif tag == 3:
                        if d[p] in (10, 6):
                            typ, count = d[p:p + 2]; p += 2
                            if count: p += 1
                            for i in range(count):
                                x, y, z, bits, aid, marker, pad, ys, tail = struct.unpack_from('>3hHHBBII', d, p)
                                nodes.append((x, y, z, (bits >> 1) & 63, aid, ys >> 23, ys & 0x7FFFFF)); p += 20
                        if d[p] == 8:
                            count = d[p + 1]; p += 2
                            if count:
                                assert d[p] == 9; p += 1
                                for _ in range(count): props.append(d[p:p + 12]); p += 12
                    else: raise ValueError('tag %x' % tag)
                p += 1
    return nodes, props
def names():
    A, S = {}, {}
    for l in open('/mnt/user-data/uploads/banjo/decomp/include/enums.h'):
        m = re.match(r'\s*ACTOR_([0-9A-F]+)_([A-Za-z0-9_]+)', l)
        if m: A.setdefault(int(m.group(1), 16), m.group(2))
        m = re.match(r'\s*ASSET_([0-9A-F]+)_(MODEL|SPRITE|ANIM)_([A-Za-z0-9_]+)', l)
        if m: S.setdefault(int(m.group(1), 16), m.group(3))
    t = lambda s: s.replace('_', ' ').title()
    return {k: t(v) for k, v in A.items() if v != 'UNKNOWN'}, {k: t(v) for k, v in S.items()}
def model_mesh(aid, texdir, hd, P):
    d = B.asset(aid); out, S, unk = bktex.walk(d, aid)
    verts, vidx, tris, mats, midx = [], {}, [], [], {}
    for (V3, tex, wrap, uv3, lit) in out:
        mat = -1
        if tex >= 0:
            dd = bkvis.texture(S[tex], texdir)
            if 'error' not in dd:
                hp = bkhd.hd_path(S[tex], P)
                if hp: hd[S[tex]['key']] = hp
                wm = [1 if c & 1 else 2 if c & 2 else 0 for c in wrap]; key = (S[tex]['key'], wm[0], wm[1], 1 if dd['cov'] < 0.93 else 0)
                if key not in midx: midx[key] = len(mats); mats.append(list(key))
                mat = midx[key]
        ids = []
        for p, (u, v) in zip(V3, uv3):
            col = (255, 255, 255) if lit else p[3:6]; kk = tuple(p[:3]) + tuple(col) + ((round(u, 3), round(v, 3)) if mat >= 0 else (0, 0))
            if kk not in vidx: vidx[kk] = len(verts); verts.append(list(kk))
            ids.append(vidx[kk])
        tris.append(ids + [0, mat])
    if not tris: return None
    Pv = np.array([v[:3] for v in verts], float); mn, mx = Pv.min(0), Pv.max(0)
    return {'asset': '0x%X' % aid, 'verts': verts, 'tris': tris, 'mats': mats, 'min': mn.tolist(), 'max': mx.tolist(), 'billboard': False}
def main(site):
    texdir = os.path.join(site, 'tex'); mdir = os.path.join(site, 'models'); os.makedirs(mdir, exist_ok=True)
    hdf = os.path.join(site, 'data', 'hd.json'); HD = json.load(open(hdf)); hd = HD['files']; P = bkhd.pack_index()
    AM = {}
    for l in open('/mnt/user-data/uploads/banjo/work/bk_actor_models.txt'):
        a, s = l.strip().split(','); AM.setdefault(int(a.split('_')[1], 16), int(s.split('_')[1], 16))
    AN, SN = names()
    rooms = [e['map'] for e in json.load(open(os.path.join(site, 'data', 'index.json')))]
    maps = {}; used = collections.Counter()
    for key in rooms:
        m = int(key, 16); nodes, props = setup_nodes(m); objs = []
        for (x, y, z, cat, aid, yaw, sc) in nodes:
            if cat != 6: continue
            mdl = AM.get(aid, -1); s = sc / 100.0 if 0 < sc < 2000 else 1.0
            objs.append([mdl, x, y, z, 0, yaw, 0, round(s, 3), aid, 2])
        for r in props:
            mid, yaw, roll, x, y, z, sc, fl = struct.unpack('>HBBhhhBB', r); idx = mid >> 4
            if fl & 1: continue                                     # actor props: spawned elsewhere
            asset = idx + 0x2D1 if fl & 2 else idx + 0x572
            objs.append([asset if fl & 2 else -1, x, y, z, 0, yaw * 2, roll * 2, round((sc or 100) / 100.0, 3), asset, 1])
        maps[key] = {'objs': objs}
        for o in objs:
            if o[0] >= 0: used[o[0]] += 1
    meta = {}
    for aid in sorted(used):
        try: mesh = model_mesh(aid, texdir, hd, P)
        except Exception as ex: print('model', hex(aid), ex); mesh = None
        if not mesh: continue
        open(os.path.join(mdir, '%X.gz.wasm' % aid), 'wb').write(gzip.compress(json.dumps(mesh, separators=(',', ':')).encode(), 9))
        meta['0x%X' % aid] = {'billboard': False, 'min': mesh['min'], 'max': mesh['max'], 'tris': len(mesh['tris'])}
    json.dump(bkvis._desc, open(bkvis.DESC_CACHE, 'w'))
    for mp in maps.values():
        for o in mp['objs']:
            if o[0] >= 0 and '0x%X' % o[0] not in meta: o[0] = -1
    nm = {}
    for mp in maps.values():
        for o in mp['objs']:
            k = '0x%X' % o[8]; nm[k] = (AN.get(o[8]) if o[9] == 2 else SN.get(o[8])) or nm.get(k)
    data = {'note': "objects and enemies from each map's setup file (Banjo-Kazooie PAL ROM): actor spawn points and cube props",
            'fields': ['model asset or -1', 'x', 'y', 'z', 'rot x', 'rot y', 'rot z', 'scale', 'actor id (spawn point) or asset (prop)', '1 static prop / 2 spawn point'],
            'names': {k: v for k, v in nm.items() if v}, 'models': meta, 'maps': maps}
    open(os.path.join(site, 'data', 'objects.gz.wasm'), 'wb').write(gzip.compress(json.dumps(data, separators=(',', ':')).encode(), 9))
    json.dump(HD, open(hdf, 'w'), indent=0)
    print(len(maps), 'maps', sum(len(m['objs']) for m in maps.values()), 'objects', sum(1 for m in maps.values() for o in m['objs'] if o[0] >= 0), 'with a model;', len(meta), 'models;', len(hd), 'hd textures')
if __name__ == '__main__': main(sys.argv[1])
