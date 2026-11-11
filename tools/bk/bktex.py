# Claude 2026-11-11 (bktex.py): Banjo-Kazooie level-model textures and texture coordinates (F3DEX 1.x display lists).
# Model header (decomp include/core2/model.h): +0x08 s16 texture list, +0x0C gfx list, +0x10 vertex list, +0x30 u16 triangle count.
# Texture list: s32 size, s16 count, pad; count x 16 bytes (s32 offset, s16 type, pad2, u8 w, u8 h, pad6); data follows the table,
# loaded as segment 2 (palette first for CI4 / CI8). Types 1 CI4, 2 CI8, 4 RGBA16, 8 RGBA32, 0x10 IA8 (bttex.decode reads them).
# Gfx list: u32 count, pad, Gfx[count] (segment 3). Vertices: segment 1, 16 bytes each after a 24-byte header.
# F3DEX 1.x: G_VTX 0x04 (v0*2 in w0 bits 16-23, n in bits 10-15), G_TRI1 0xBF / G_TRI2 0xB1 (indices *2), G_TEXTURE 0xBB,
# G_SETGEOMETRYMODE 0xB7 / G_CLEARGEOMETRYMODE 0xB6 (G_LIGHTING 0x20000); RDP commands as F3DEX2.
import struct, collections, sys
sys.path.insert(0, '/home/claude/btmaps')
import bttex

def setup(data, aid=0):
    o = struct.unpack_from('>h', data, 8)[0]
    if not o: return []
    sz, cnt = struct.unpack_from('>ih', data, o); base = o + 8 + 16 * cnt; out = []
    offs = [struct.unpack_from('>i', data, o + 8 + 16 * i)[0] for i in range(cnt)] + [sz - 8 - 16 * cnt]
    for i in range(cnt):
        off, ty, w, h = struct.unpack_from('>ihxxBB', data, o + 8 + 16 * i)
        raw = data[base + off: base + offs[i + 1]]
        out.append({'id': off, 'key': 'b%04x_%05x' % (aid, off), 'raw': raw, 'fmt': ty, 'w': w or 256, 'h': h or 256, 'seg': off, 'len': len(raw)})
    return out

def walk(data, aid=0):
    """Visible triangles: list of (verts3, tex index or -1, (cms, cmt), uv3, lit); verts = (x, y, z, r, g, b, a)."""
    vo = struct.unpack_from('>i', data, 16)[0]; go = struct.unpack_from('>i', data, 12)[0]
    n = struct.unpack_from('>I', data, go)[0]; base = go + 8
    nv = struct.unpack_from('>12h', data, vo)[10]
    V = [struct.unpack_from('>3h', data, vo + 24 + 16 * i) + struct.unpack_from('>4B', data, vo + 24 + 16 * i + 12) for i in range(nv)]
    ST = [struct.unpack_from('>2h', data, vo + 24 + 16 * i + 8) for i in range(nv)]
    S = setup(data, aid)
    seg2 = {}
    for k, e in enumerate(S):
        f = e['fmt'] & 0xFF; pal = 0x20 if f == 1 else 0x200 if f == 2 else 0
        seg2[e['seg']] = k
        if pal: seg2[e['seg'] + pal] = k
    st = {'img': None, 'loaded': -1, 'scale': (0x10000, 0x10000), 'texon': 1, 'tile0': (0, 0, 0, 0, 0, 0), 'uls': 0, 'ult': 0, 'lit': 0}
    buf = [None] * 32; out = []; unk = collections.Counter(); ntri = 0
    def uvof(i):
        s, t = ST[i]; cmt, maskt, shiftt, cms, masks, shifts = st['tile0']
        ss = s * st['scale'][0] / 65536.0 / 32.0; tt = t * st['scale'][1] / 65536.0 / 32.0
        if shifts: ss = ss / (1 << shifts) if shifts <= 10 else ss * (1 << (16 - shifts))
        if shiftt: tt = tt / (1 << shiftt) if shiftt <= 10 else tt * (1 << (16 - shiftt))
        e = S[st['loaded']] if st['loaded'] >= 0 else None
        w = e['w'] if e else 32; h = e['h'] if e else 32
        return ((ss - st['uls'] / 4.0) / w, (tt - st['ult'] / 4.0) / h)
    def tri(a, b, c):
        nonlocal ntri
        ntri += 1
        if max(a, b, c) >= 32 or None in (buf[a], buf[b], buf[c]): unk['bad tri'] += 1; return
        ia, ib, ic = buf[a], buf[b], buf[c]; tex = st['loaded'] if st['texon'] else -1
        cmt, maskt, shiftt, cms, masks, shifts = st['tile0']
        out.append(((V[ia], V[ib], V[ic]), tex, (cms, cmt), (uvof(ia), uvof(ib), uvof(ic)), st['lit']))
    for i in range(n):
        w0, w1 = struct.unpack_from('>II', data, base + 8 * i); op = w0 >> 24
        if op == 0x04:
            v0 = ((w0 >> 16) & 0xFF) // 2; cnt = (w0 >> 10) & 0x3F; seg = w1 >> 24; off = w1 & 0xFFFFFF
            if seg == 1:
                for k in range(cnt):
                    idx = off // 16 + k
                    if 0 <= v0 + k < 32: buf[v0 + k] = idx if idx < nv else None
            else: unk['vtx seg %d' % seg] += 1
        elif op == 0xBF: tri(((w1 >> 16) & 0xFF) // 2, ((w1 >> 8) & 0xFF) // 2, (w1 & 0xFF) // 2)
        elif op == 0xB1:
            for w in (w0, w1): tri(((w >> 16) & 0xFF) // 2, ((w >> 8) & 0xFF) // 2, (w & 0xFF) // 2)
        elif op == 0xFD: st['img'] = (w1 >> 24, w1 & 0xFFFFFF)
        elif op in (0xF3, 0xF4):
            if st['img'] and st['img'][0] == 2:
                hit = seg2.get(st['img'][1])
                if hit is not None: st['loaded'] = hit
                else: unk['seg2 %x' % st['img'][1]] += 1
            else: unk['img seg %s' % (st['img'] and st['img'][0])] += 1
        elif op == 0xF5:
            if ((w1 >> 24) & 7) == 0: st['tile0'] = ((w1 >> 18) & 3, (w1 >> 14) & 15, (w1 >> 10) & 15, (w1 >> 8) & 3, (w1 >> 4) & 15, w1 & 15)
        elif op == 0xF2:
            if ((w1 >> 24) & 7) == 0: st['uls'] = (w0 >> 12) & 0xFFF; st['ult'] = w0 & 0xFFF
        elif op == 0xBB: st['scale'] = (w1 >> 16, w1 & 0xFFFF); st['texon'] = w0 & 0xFF
        elif op == 0xB7:
            if w1 & 0x20000: st['lit'] = 1
        elif op == 0xB6:
            if w1 & 0x20000: st['lit'] = 0
    hdr = struct.unpack_from('>H', data, 0x30)[0]
    if ntri != hdr: unk['tri count %d != header %d' % (ntri, hdr)] += 1
    return out, S, unk

if __name__ == '__main__':
    import bkassets as B
    T = B.map_table('pal')
    for m in [int(a, 0) for a in sys.argv[1:]] or [0x93, 0x01, 0x0B]:
        for k, aid in zip(('opa', 'xlu'), T[m]):
            if not aid: continue
            out, S, unk = walk(B.asset(aid), aid)
            c = collections.Counter(t[1] for t in out)
            print(hex(m), k, len(out), 'tris', len(S), 'textures', 'untextured', c[-1], 'lit', sum(t[4] for t in out), dict(unk))
