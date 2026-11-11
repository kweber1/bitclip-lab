# Claude 2026-11-11 (btvis.py): Banjo-Tooie level model -> visible triangles (F3DEX2 display list walk: G_VTX / G_TRI1 / G_TRI2 / G_DL)
import struct, collections
import btassets as B
def visible(data):
    vo = struct.unpack_from('>I', data, 16)[0]; dlo = struct.unpack_from('>I', data, 12)[0]
    n = struct.unpack_from('>I', data, dlo)[0]; base = dlo + 8
    nv = (len(data) - vo - 24) // 16
    V = [struct.unpack_from('>3h', data, vo + 24 + 16 * i) + struct.unpack_from('>4B', data, vo + 24 + 16 * i + 12) for i in range(nv)]   # x y z r g b a
    tris = []; buf = [None] * 64; stats = collections.Counter()
    def run(i, depth):
        while i < n:
            w0, w1 = struct.unpack_from('>II', data, base + 8 * i); op = w0 >> 24; stats[op] += 1
            if op == 0x01:
                cnt = (w0 >> 12) & 0xFF; v0 = ((w0 >> 1) & 0x7F) - cnt; seg = w1 >> 24; off = w1 & 0xFFFFFF
                if seg == 1:
                    for k in range(cnt):
                        idx = off // 16 + k
                        if 0 <= v0 + k < 64: buf[v0 + k] = V[idx] if idx < nv else None
                else: stats['vtxseg%d' % seg] += 1
            elif op == 0x05:
                a, b, c = ((w0 >> 16) & 0xFF) // 2, ((w0 >> 8) & 0xFF) // 2, (w0 & 0xFF) // 2; tris.append((buf[a], buf[b], buf[c]))
            elif op == 0x06:
                for w in (w0, w1):
                    a, b, c = ((w >> 16) & 0xFF) // 2, ((w >> 8) & 0xFF) // 2, (w & 0xFF) // 2; tris.append((buf[a], buf[b], buf[c]))
            # the geometry layout calls the sub-lists; walking the whole command array once covers every triangle once
            i += 1
    run(0, 0)
    return [t for t in tris if None not in t], stats
if __name__ == '__main__':
    for aid in (0x1D7C, 0x1D93, 0x1CF9):
        t, st = visible(B.asset(aid)); print(hex(aid), len(t), 'visible tris', dict((hex(k) if isinstance(k, int) else k, v) for k, v in st.items() if not isinstance(k, int) or k in (1, 5, 6, 0xDE, 0xDF)))
