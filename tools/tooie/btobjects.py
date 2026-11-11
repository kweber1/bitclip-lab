# Claude 2026-11-11 (btobjects.py): Banjo-Tooie objects and enemies for the Bit-Clip Lab viewer.
# Input: BizHawk dumps from bt_objects.lua (objects/objects*/objects-0x<map>.txt): every actor in the actor list
# (position, rotation in degrees, scale, model asset, prop id) 240 frames after warping in, and the cube grid's
# props that are not actors (12-byte records: u16 model id (+0x2D1 = model asset), u8 yaw x2, u8 roll x2, s16 x y z,
# u8 scale x0.01, u8 flags).
# Output: <site>/models/<asset>.gz.wasm (each model's visible triangles, texture coordinates and lab-made texture keys,
#         like the level look) and <site>/data/objects.gz.wasm (per map: the placed objects; names; model sizes).
import sys, os, glob, json, gzip, struct, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import btassets as B, bttex, btvis2, btrice

def prop_names():
    names = {}
    for l in open('/home/claude/bt-decomp/include/props.h'):
        if 'PROP_' in l and '=' in l:
            n, v = l.strip().rstrip(',').split('=')
            n = n.strip().split('_', 2)[2].replace('_REAL', '').replace('_', ' ').title()
            names[int(v, 16)] = n
    extra = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prop_names_extra.json')
    if os.path.exists(extra):
        for k, v in json.load(open(extra)).items(): names.setdefault(int(k, 16), v)
    return names

def model_mesh(aid, texdir, hd):
    d = B.asset(aid)
    if len(d) < 32 or struct.unpack_from('>I', d)[0] != 0xB: return None
    out, S, _ = bttex.walk(d, aid)
    verts, vidx, tris, mats, midx = [], {}, [], [], {}
    for (V3, tex, wrap, uv3, lit) in out:
        mat = -1
        if tex >= 0 and S[tex]:
            dd = btvis2.texture(S[tex], texdir)
            if 'error' not in dd:
                p = btrice.hd_path(S[tex])
                if p: hd[S[tex]['key']] = p
                wm = [1 if c & 1 else 2 if c & 2 else 0 for c in wrap]
                key = (S[tex]['key'], wm[0], wm[1], 1 if dd['cov'] < 0.93 else 0)
                if key not in midx: midx[key] = len(mats); mats.append(list(key))
                mat = midx[key]
        ids = []
        for p, (u, v) in zip(V3, uv3):
            col = (255, 255, 255) if lit else p[3:6]
            kk = tuple(p[:3]) + tuple(col) + ((round(u, 3), round(v, 3)) if mat >= 0 else (0, 0))
            if kk not in vidx: vidx[kk] = len(verts); verts.append(list(kk))
            ids.append(vidx[kk])
        tris.append(ids + [0, mat])
    if not tris: return None
    P = np.array([v[:3] for v in verts], float); mn, mx = P.min(0), P.max(0); ext = mx - mn
    bb = False
    return {'asset': '0x%X' % aid, 'verts': verts, 'tris': tris, 'mats': mats, 'min': mn.tolist(), 'max': mx.tolist(), 'billboard': bb}

def main(site):
    texdir = os.path.join(site, 'tex'); mdir = os.path.join(site, 'models'); os.makedirs(mdir, exist_ok=True)
    hdf = os.path.join(site, 'data', 'hd.json'); HD = json.load(open(hdf)); hd = HD['files']
    maps = {}; used = collections.Counter(); pm = {}
    for f in sorted(glob.glob('/home/claude/btmaps/objects/objects*/objects-0x*.txt')):
        m = None; ent = 0; objs = []
        for l in open(f):
            a = l.split()
            if a[0] == 'MAP': m = a[1]; ent = int(a[3])
            elif a[0] == 'ACTOR':
                x, y, z, rx, ry, rz, sc = map(float, a[2:9]); mdl = int(a[9], 16); prop = int(a[10], 16)
                if mdl in (0, 0xFFFF): mdl = -1
                objs.append([mdl, round(x, 2), round(y, 2), round(z, 2), round(rx, 2), round(ry, 2), round(rz, 2), round(sc, 4), prop, 0])
            elif a[0] == 'CUBEPROP':
                r = bytes.fromhex(a[4]); mid, yaw, roll, x, y, z, sc, fl = struct.unpack('>HBBhhhBB', r)
                mdl = (mid & 0xFFF) + 0x2D1
                objs.append([mdl, x, y, z, 0, yaw * 2, roll * 2, round(sc / 100, 3), mid & 0xFFF, 1])
        if m is None: continue
        key = '0x%X' % int(m, 16); maps[key] = {'entrance': ent, 'objs': objs}
        for o in objs:
            if o[0] >= 0 and o[9] == 0: pm.setdefault(o[8], collections.Counter())[o[0]] += 1
    # spawn points (cube grid list 1, pool D_80132DB0, 20-byte records; kind 0x0C = actor): every object and enemy of the map,
    # including the ones not spawned yet. x y z s16, u16 kind, u16 prop id, +12 u8 yaw/2, +14 u16 scale x100.
    ram = json.load(open('/home/claude/btmaps/ram_propmodel.json')) if os.path.exists('/home/claude/btmaps/ram_propmodel.json') else {}
    for k, v in ram.items(): pm.setdefault(int(k, 16), collections.Counter())[int(v[0], 16) if isinstance(v[0], str) else v[0]] += 1
    # spawners show the thing they spawn (Jinjo, Jiggy, honeycomb, Glowbo, Cheato page, doubloon, ticket)
    for sp_, real in {0x1F5: 0x1F4, 0x1F6: 0x21F, 0x1F7: 0x220, 0x1F8: 0x21B, 0x201: 0x136, 0x29D: 0x4E5, 0x4E6: 0x3C6}.items():
        if real in pm and sp_ not in pm: pm[sp_] = pm[real]
    for f in sorted(glob.glob('/home/claude/btmaps/nodes/nodes*/nodes-0x*.txt')):
        m = None; sp = []
        for l in open(f):
            a = l.split()
            if a[0] == 'MAP': m = '0x%X' % int(a[1], 16)
            elif a[0] == 'N1':
                e = bytes.fromhex(a[5]); x, y, z, kind, pid = struct.unpack_from('>hhhHH', e)
                if (kind & 0x7F) != 0x0C or not pid: continue
                yaw = e[12] * 2 + e[13] / 128.0; sc = struct.unpack_from('>H', e, 14)[0] / 100.0 or 1.0
                mdl = pm[pid].most_common(1)[0][0] if pid in pm else -1
                sp.append([mdl, x, y, z, 0, round(yaw, 2), 0, round(sc, 3), pid, 2])
        if m is None or m not in maps: continue
        old = maps[m]['objs']; keep = []
        for o in old:
            if o[9] == 0 and any(s_[8] == o[8] and abs(s_[1] - o[1]) + abs(s_[2] - o[2]) + abs(s_[3] - o[3]) < 120 for s_ in sp): continue   # same as a spawn point
            keep.append(o)
        maps[m]['objs'] = sp + keep
    for mp in maps.values():
        for o in mp['objs']:
            if o[0] >= 0: used[o[0]] += 1
    meta = {}
    for aid in sorted(used):
        try: mesh = model_mesh(aid, texdir, hd)
        except Exception as ex: print('model', hex(aid), ex); mesh = None
        if not mesh: continue
        open(os.path.join(mdir, '%X.gz.wasm' % aid), 'wb').write(gzip.compress(json.dumps(mesh, separators=(',', ':')).encode(), 9))
        meta['0x%X' % aid] = {'billboard': mesh['billboard'], 'min': mesh['min'], 'max': mesh['max'], 'tris': len(mesh['tris'])}
    btvis2.save_descs()
    for mp in maps.values():
        for o in mp['objs']:
            if o[0] >= 0 and '0x%X' % o[0] not in meta: o[0] = -1          # not a drawable model (sprite etc.): marker
    # collectables that always face the camera in game
    BILL = {0x1D7, 0x1D8, 0x1E9, 0x1C8, 0x1C9, 0x1CA, 0x1CB, 0x1CC, 0x1CD, 0x1CE, 0x1CF, 0x2B8, 0x4A6}
    for mp in maps.values():
        for o in mp['objs']:
            if o[0] >= 0 and o[8] in BILL and o[9] == 0: meta['0x%X' % o[0]]['billboard'] = True
    data = {'note': 'objects and enemies as loaded 240 frames after entering each map (BizHawk, Banjo-Tooie USA); actor list + cube props',
            'fields': ['model asset or -1', 'x', 'y', 'z', 'rot x', 'rot y', 'rot z', 'scale', 'prop id', '0 spawned actor / 1 static prop / 2 spawn point'],
            'names': {'0x%X' % k: v for k, v in prop_names().items()}, 'models': meta, 'maps': maps}
    open(os.path.join(site, 'data', 'objects.gz.wasm'), 'wb').write(gzip.compress(json.dumps(data, separators=(',', ':')).encode(), 9))
    json.dump(HD, open(hdf, 'w'), indent=0)
    print(len(maps), 'maps', sum(len(m['objs']) for m in maps.values()), 'objects', len(meta), 'models', len(hd), 'hd textures')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/bitclip-lab/tooie')
