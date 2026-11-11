# Claude 2026-11-11: Banjo-Tooie (USA) asset reader + level-model collision extractor.
# Asset table: ROM 0x5188, u32 per asset: offset = w >> 6 (from 0x12B24), bit 4 = compressed (2-byte header + raw deflate), low 4 bits = type.
# Map -> level models: table at decompressed-ROM 0x210FA40, 14-byte rows (map u16, opaque model id u16, transparent model id u16, ...).
import struct, zlib, json, os
ROM = open(os.environ.get('BT_ROM', 'baserom.us.z64'), 'rb').read()          # Banjo-Tooie (USA), SHA1 af1a89e1...
DEC = open(os.environ.get('BT_DEC', 'decompressed.us.z64'), 'rb').read()   # the decomp's tools/rom_decompressor output
T = 0x5188; BASE = 0x12B24; NA = 13927
W = [struct.unpack_from('>I', ROM, T + 4 * i)[0] for i in range(NA + 1)]
def asset(i):
    off = W[i] >> 6; nxt = W[i + 1] >> 6; raw = ROM[BASE + off:BASE + nxt]
    if (W[i] >> 4) & 1:
        d = zlib.decompressobj(-15); return d.decompress(raw[2:])
    return raw
def maptable():
    o = 0x210FA40; rows = {}
    while True:
        e = struct.unpack_from('>7H', DEC, o)
        if not (0x80 <= e[0] <= 0x200): break
        rows[e[0]] = e[1:]; o += 14
    return rows
def model(data):
    assert struct.unpack_from('>I', data)[0] == 11
    vo, co = struct.unpack_from('>I', data, 16)[0], struct.unpack_from('>I', data, 28)[0]
    vh = struct.unpack_from('>12h', data, vo)
    nv = (len(data) - vo - 24) // 16   # Tooie: no usable count in the header; the vertex store is the last section
    verts = [struct.unpack_from('>3h', data, vo + 24 + i * 16) for i in range(nv)]
    res = {'vertex_header': vh, 'vertices': verts, 'collision': None}
    if co:
        h = struct.unpack_from('>11h', data, co)
        ncell = h[8] & 0xffff; ntri = h[10] & 0xffff
        cells = [struct.unpack_from('>2h', data, co + 24 + 4 * i) for i in range(ncell)]
        tb = co + 24 + 4 * ncell
        tris = [struct.unpack_from('>4hI', data, tb + i * 12) for i in range(ntri)]
        res['collision'] = {'header': h, 'cells': cells, 'triangles': tris}
    return res
if __name__ == '__main__':
    mt = maptable(); print(len(mt), 'maps in the table;', '0x10F ->', [hex(x) for x in mt[0x10F]])
    for aid in mt[0x10F][:2]:
        if not aid: continue
        m = model(asset(aid)); c = m['collision']
        print(hex(aid), 'verts', len(m['vertices']), 'collision header', c and c['header'], 'tris', c and len(c['triangles']))
        if c:
            bad = sum(1 for t in c['triangles'] if not all(0 <= t[j] < len(m['vertices']) for j in range(3)))
            print('  tris with bad vertex index', bad, 'cells', len(c['cells']), 'sample tri', c['triangles'][:3])
