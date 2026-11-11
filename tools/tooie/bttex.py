# Claude 2026-11-11 (bttex.py): Banjo-Tooie (USA) level-model textures and texture coordinates.
# Model texture setup (header +0x08 u16 offset): u32 data size, u16 count, pad to 8; then count x 8-byte entries
# (u32 texture id, u16 format, u8 width, u8 height). Texture id t is ROM asset 0x1EF6 + t (raw palette + pixels).
# The engine loads the textures back to back into one buffer that the display lists address as segment 2.
# Formats: 1 CI4, 2 CI8, 4 RGBA16, 8 RGBA32, 0x10 IA8; 0x8000 = with mip levels (base level first).
import struct, collections
import numpy as np
import btassets as B
TEXBASE = 0x1EF6

def setup(data, aid=0):
    """Texture entries of a model. flag 0x100: external textures by id (asset TEXBASE + id), loaded back to back;
    flag 0: textures embedded after the entry table, entry word = offset in that data (BK style)."""
    o = struct.unpack_from('>H', data, 8)[0]
    if not o: return []
    sz, cnt, flag = struct.unpack_from('>IHH', data, o)
    out, off = [], 0; emb = o + 8 + 8 * cnt
    for i in range(cnt):
        word, ty, w, h = struct.unpack_from('>IHBB', data, o + 8 + 8 * i)
        if flag & 0x100:
            if TEXBASE + word >= B.NA: out.append(None); continue
            raw = B.asset(TEXBASE + word); key = 't%04x' % word
            out.append({'id': word, 'key': key, 'raw': raw, 'fmt': ty, 'w': w or 256, 'h': h or 256, 'seg': off, 'len': len(raw)})
            off += len(raw)
        else:
            nxt = struct.unpack_from('>I', data, o + 8 + 8 * (i + 1))[0] if i + 1 < cnt else sz - 8 - 8 * cnt
            raw = data[emb + word: emb + nxt]
            out.append({'id': word, 'key': 'm%04x_%05x' % (aid, word), 'raw': raw, 'fmt': ty, 'w': w or 256, 'h': h or 256, 'seg': word, 'len': len(raw)})
    return out

def c5551(v):
    r = (v >> 11) & 31; g = (v >> 6) & 31; b = (v >> 1) & 31
    return (r * 255 // 31, g * 255 // 31, b * 255 // 31, 255 if v & 1 else 0)

def decode(e):
    """RGBA uint8 array (h, w, 4) of the base level of a texture entry from setup()."""
    d = e['raw']; fmt, w, h = e['fmt'], e['w'], e['h']; f = fmt & 0xFF
    img = np.zeros((h, w, 4), np.uint8)
    if f == 1:
        pal = [c5551(struct.unpack_from('>H', d, 2 * i)[0]) for i in range(16)]
        px = np.frombuffer(d, np.uint8, w * h // 2, 0x20)
        idx = np.stack([px >> 4, px & 15], 1).reshape(h, w)
        img[:] = np.array(pal, np.uint8)[idx]
    elif f == 2:
        pal = [c5551(struct.unpack_from('>H', d, 2 * i)[0]) for i in range(256)]
        idx = np.frombuffer(d, np.uint8, w * h, 0x200).reshape(h, w)
        img[:] = np.array(pal, np.uint8)[idx]
    elif f == 4:
        v = np.frombuffer(d, '>u2', w * h, 0).reshape(h, w).astype(np.uint32)
        img[..., 0] = ((v >> 11) & 31) * 255 // 31; img[..., 1] = ((v >> 6) & 31) * 255 // 31; img[..., 2] = ((v >> 1) & 31) * 255 // 31; img[..., 3] = (v & 1) * 255
    elif f == 8:
        img[:] = np.frombuffer(d, np.uint8, w * h * 4, 0).reshape(h, w, 4)
    elif f == 0x10:
        v = np.frombuffer(d, np.uint8, w * h, 0).reshape(h, w)
        i = (v >> 4) * 17; a = (v & 15) * 17
        img[..., 0] = i; img[..., 1] = i; img[..., 2] = i; img[..., 3] = a
    else:
        raise ValueError('format %x' % fmt)
    return img

def walk(data, aid=0):
    """Visible triangles with their texture: list of (verts3, tex_entry_index or -1, (cms, cmt), uv3, lit).
    verts = (x, y, z, r, g, b, a); uv in texture widths (1.0 = one repeat of the texture)."""
    vo = struct.unpack_from('>I', data, 16)[0]; dlo = struct.unpack_from('>I', data, 12)[0]
    n = struct.unpack_from('>I', data, dlo)[0]; base = dlo + 8
    nv = (len(data) - vo - 24) // 16
    V = [struct.unpack_from('>3h', data, vo + 24 + 16 * i) + struct.unpack_from('>4B', data, vo + 24 + 16 * i + 12) for i in range(nv)]
    ST = [struct.unpack_from('>2h', data, vo + 24 + 16 * i + 8) for i in range(nv)]
    S = setup(data, aid)
    seg2 = {}                                    # buffer offset -> (entry, 'pal' | 'pix')
    for k, e in enumerate(S):
        if not e: continue
        f = e['fmt'] & 0xFF; pal = 0x20 if f == 1 else 0x200 if f == 2 else 0
        seg2[e['seg']] = (k, 'pal' if pal else 'pix')
        if pal: seg2[e['seg'] + pal] = (k, 'pix')
    st = {'img': None, 'loaded': -1, 'scale': (0x10000, 0x10000), 'texon': 1, 'tile0': (0, 0, 0, 0, 0, 0), 'uls': 0, 'ult': 0, 'tw': None, 'lit': 0}
    buf = [None] * 64; out = []; unk = collections.Counter()
    def uvof(i):
        s, t = ST[i]
        cmt, maskt, shiftt, cms, masks, shifts = st['tile0']
        ss = s * st['scale'][0] / 65536.0 / 32.0; tt = t * st['scale'][1] / 65536.0 / 32.0
        if shifts: ss = ss / (1 << shifts) if shifts <= 10 else ss * (1 << (16 - shifts))
        if shiftt: tt = tt / (1 << shiftt) if shiftt <= 10 else tt * (1 << (16 - shiftt))
        e = S[st['loaded']] if st['loaded'] >= 0 else None
        w = e['w'] if e else 32; h = e['h'] if e else 32
        return ((ss - st['uls'] / 4.0) / w, (tt - st['ult'] / 4.0) / h)
    def tri(a, b, c):
        if None in (buf[a], buf[b], buf[c]): return
        ia, ib, ic = buf[a], buf[b], buf[c]
        tex = st['loaded'] if st['texon'] else -1
        cmt, maskt, shiftt, cms, masks, shifts = st['tile0']
        out.append(((V[ia], V[ib], V[ic]), tex, (cms, cmt), (uvof(ia), uvof(ib), uvof(ic)), st['lit']))
    for i in range(n):
        w0, w1 = struct.unpack_from('>II', data, base + 8 * i); op = w0 >> 24
        if op == 0x01:
            cnt = (w0 >> 12) & 0xFF; v0 = ((w0 >> 1) & 0x7F) - cnt; seg = w1 >> 24; off = w1 & 0xFFFFFF
            if seg == 1:
                for k in range(cnt):
                    idx = off // 16 + k
                    if 0 <= v0 + k < 64: buf[v0 + k] = idx if idx < nv else None
        elif op == 0x05:
            tri(((w0 >> 16) & 0xFF) // 2, ((w0 >> 8) & 0xFF) // 2, (w0 & 0xFF) // 2)
        elif op == 0x06:
            for w in (w0, w1): tri(((w >> 16) & 0xFF) // 2, ((w >> 8) & 0xFF) // 2, (w & 0xFF) // 2)
        elif op == 0xFD:
            st['img'] = (w1 >> 24, w1 & 0xFFFFFF)
        elif op in (0xF3, 0xF4):                  # LOADBLOCK / LOADTILE: the pixels of the texture at the last SETTIMG
            if st['img'] and st['img'][0] == 2:
                hit = seg2.get(st['img'][1])
                if hit: st['loaded'] = hit[0]
                else: unk['seg2 %x' % st['img'][1]] += 1
            else: unk['img seg %s' % (st['img'] and st['img'][0])] += 1
        elif op == 0xF5:
            tile = (w1 >> 24) & 7
            if tile == 0:
                st['tile0'] = ((w1 >> 18) & 3, (w1 >> 14) & 15, (w1 >> 10) & 15, (w1 >> 8) & 3, (w1 >> 4) & 15, w1 & 15)
        elif op == 0xF2:
            if ((w1 >> 24) & 7) == 0:
                st['uls'] = (w0 >> 12) & 0xFFF; st['ult'] = w0 & 0xFFF
        elif op == 0xD7:
            st['scale'] = (w1 >> 16, w1 & 0xFFFF); st['texon'] = w0 & 0xFF
        elif op == 0xD9:                          # geometry mode: clear mask (w0 low 24 bits), set bits (w1)
            clr = w0 & 0xFFFFFF; st['lit'] = 1 if (w1 & 0x00020000) else (st['lit'] if clr & 0x00020000 else 0)
    return out, S, unk

if __name__ == '__main__':
    import sys
    aid = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0x1D58
    out, S, unk = walk(B.asset(aid), aid)
    print(len(out), 'tris', len(S), 'textures', dict(unk))
    c = collections.Counter(t[1] for t in out); print(c.most_common(10))
    import math
    # texel density on a few triangles: world units per texture repeat
    for t in out[:6]:
        (a, b, c_), tex, wr, uv, lit = t
        e = S[tex] if tex >= 0 else None
        d = math.dist(a[:3], b[:3]); du = math.dist(uv[0], uv[1])
        print(tex, e and (hex(e['id']), e['fmt'], e['w'], e['h']), wr, [tuple(round(x, 3) for x in p) for p in uv], 'edge', round(d, 1), 'uv', round(du, 3), 'units/texel', round(d / max(1e-6, du * (e['w'] if e else 32)), 2), 'lit', lit)
