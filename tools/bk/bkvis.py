# Claude 2026-11-11 (bkvis.py): textured "game look" for the Banjo-Kazooie viewer, same format as the Tooie viewer's (btvis2.py):
# vis = {verts: [x, y, z, r, g, b, u, v], tris: [a, b, c, xlu, mat], mats: [[texture key, wrapS, wrapT, cutout]]}.
# Level models from the user's own PAL ROM (map table -> opaque / transparent model). The textures the site shows are the lab's
# own (btgen.py paints them from a short description of each original); no game art is published.
# usage: python3 bkvis.py <site root> [maps...]   -> <site>/data/vis/map0xNN.gz.wasm, <site>/tex/<key>.png, <site>/data/vis/index.json
import os, sys, json, gzip
sys.path.insert(0, '/home/claude/btmaps')
from PIL import Image
import bkassets as B, bktex, bttex, btgen

DESC_CACHE = '/home/claude/bkvis/texdesc.json'
_desc = json.load(open(DESC_CACHE)) if os.path.exists(DESC_CACHE) else {}

def texture(e, texdir):
    k = e['key']
    if k not in _desc:
        try: _desc[k] = btgen.describe(bttex.decode(e))
        except Exception as ex: _desc[k] = {'error': str(ex)}
    d = _desc[k]; out = os.path.join(texdir, k + '.png')
    if 'error' not in d and not os.path.exists(out):
        Image.fromarray(btgen.paint(d, int(k[1:].replace('_', ''), 16) & 0x7FFFFFFF), 'RGBA').save(out, optimize=True)
    return d

def room_vis(m, texdir):
    os.makedirs(texdir, exist_ok=True)
    T = B.map_table('pal'); verts, vidx, tris, mats, midx = [], {}, [], [], {}; info = {}
    for mk, aid in zip(('opa', 'xlu'), T[m]):
        if not aid: continue
        out, S, unk = bktex.walk(B.asset(aid), aid); info[mk] = {'asset': hex(aid), 'tris': len(out), 'textures': len(S), 'unknown': dict(unk)}
        for (V3, tex, wrap, uv3, lit) in out:
            mat = -1
            if tex >= 0:
                d = texture(S[tex], texdir)
                if 'error' not in d:
                    wm = [1 if c & 1 else 2 if c & 2 else 0 for c in wrap]
                    key = (S[tex]['key'], wm[0], wm[1], 1 if d['cov'] < 0.93 else 0)
                    if key not in midx: midx[key] = len(mats); mats.append(list(key))
                    mat = midx[key]
            ids = []
            for p, (u, v) in zip(V3, uv3):
                col = (255, 255, 255) if lit else p[3:6]
                kk = tuple(p[:3]) + tuple(col) + ((round(u, 3), round(v, 3)) if mat >= 0 else (0, 0))
                if kk not in vidx: vidx[kk] = len(verts); verts.append(list(kk))
                ids.append(vidx[kk])
            tris.append(ids + [1 if mk == 'xlu' else 0, mat])
    return {'verts': verts, 'tris': tris, 'mats': mats, 'fill': 0}, info

if __name__ == '__main__':
    site = sys.argv[1]; vd = os.path.join(site, 'data', 'vis'); os.makedirs(vd, exist_ok=True)
    maps = [int(a, 0) for a in sys.argv[2:]] or [int(e['map'], 16) for e in json.load(open(os.path.join(site, 'data', 'index.json')))]
    idxf = os.path.join(vd, 'index.json'); idx = json.load(open(idxf)) if os.path.exists(idxf) else {}
    for m in maps:
        vis, info = room_vis(m, os.path.join(site, 'tex'))
        f = os.path.join(vd, 'map0x%02X.gz.wasm' % m)
        with gzip.open(f, 'wb', 9) as g: g.write(json.dumps(vis, separators=(',', ':')).encode())
        idx['0x%02X' % m] = dict(info, bytes=os.path.getsize(f), mats=len(vis['mats']))
        print('0x%02X' % m, len(vis['tris']), 'tris', len(vis['mats']), 'materials', os.path.getsize(f), 'bytes', {k: v['unknown'] for k, v in info.items() if v['unknown']})
    json.dump(idx, open(idxf, 'w'), indent=1); json.dump(_desc, open(DESC_CACHE, 'w'))
