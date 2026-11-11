# Claude 2026-11-11 (btvis2.py): textured "game look" for the Banjo-Tooie viewer.
# vis = {verts: [x, y, z, r, g, b, u, v], tris: [a, b, c, xlu, mat], mats: [[texture key, wrapS, wrapT, cutout]]}
# u, v are in texture repeats (N64 tile maths incl. G_TEXTURE scale, tile shift and tile origin); wrap 0 repeat, 1 mirror, 2 clamp.
# The texture images the viewer shows are the lab's own (btgen.py), written to <site>/tooie/tex/<key>.png.
import os, json
import numpy as np
from PIL import Image
import btassets as BA, bttex, btgen

DESC_CACHE = '/home/claude/btmaps/texdesc.json'
_desc = None

def _descs():
    global _desc
    if _desc is None:
        _desc = json.load(open(DESC_CACHE)) if os.path.exists(DESC_CACHE) else {}
    return _desc

def save_descs():
    if _desc is not None: json.dump(_desc, open(DESC_CACHE, 'w'))

def texture(e, texdir):
    """Describe the original (numbers only) and paint the lab's texture for it; returns the description."""
    D = _descs(); k = e['key']
    if k not in D:
        try: D[k] = btgen.describe(bttex.decode(e))
        except Exception as ex: D[k] = {'error': str(ex)}
    d = D[k]; out = os.path.join(texdir, k + '.png')
    if 'error' not in d and not os.path.exists(out):
        Image.fromarray(btgen.paint(d, int(k[1:].replace('_', ''), 16) & 0x7FFFFFFF), 'RGBA').save(out, optimize=True)
    return d

def room_vis(room, texdir):
    os.makedirs(texdir, exist_ok=True)
    verts, vidx, tris, mats, midx = [], {}, [], [], {}
    for mk in ('opa', 'xlu'):
        m = room[mk]
        if not m: continue
        aid = int(m['asset'], 16)
        out, S, _ = bttex.walk(BA.asset(aid), aid)
        for (V3, tex, wrap, uv3, lit) in out:
            mat = -1
            if tex >= 0 and S[tex]:
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
    # floors that are in the collision but never drawn by the level's display lists (e.g. the Gatehouse's mirror floor, which the
    # game draws with a special effect): add them as plain fill (mat -2) so the floor is not missing
    seen = set(tuple(sorted(tuple(verts[i][:3]) for i in t[:3])) for t in tris)
    fill = 0
    for mk in ('opa', 'xlu'):
        m = room[mk]
        if not m or not m.get('collision'): continue
        Vc = m['vertices']
        for t in m['collision']['triangles']:
            fl = t[5] if len(t) > 5 else t[4]
            if fl & 0x400005: continue
            P = [tuple(Vc[j]) for j in t[:3]]
            ux, uy, uz = (P[1][i] - P[0][i] for i in range(3)); vx, vy, vz = (P[2][i] - P[0][i] for i in range(3))
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx; L = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1
            if ny / L < 0.3: continue
            k = tuple(sorted(P))
            if k in seen: continue
            seen.add(k); ids = []
            col = (120, 160, 210) if fl & 0x20020 else (168, 170, 176)
            for p in P:
                kk = p + col + (0, 0)
                if kk not in vidx: vidx[kk] = len(verts); verts.append(list(kk))
                ids.append(vidx[kk])
            tris.append(ids + [0, -2]); fill += 1
    return {'verts': verts, 'tris': tris, 'mats': mats, 'fill': fill}
