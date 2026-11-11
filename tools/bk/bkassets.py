# Claude 2026-11-11 (bkassets.py): Banjo-Kazooie ROM assets + the map -> level model table (user's own ROMs, read only).
import struct, zlib, importlib.util, functools
ROOT = '/home/claude/bkroot'
ROMS = {'pal': ROOT + '/roms/banjo.eu.pal.z64', 'us10': ROOT + '/roms/banjo.us.v10.z64'}
_s = importlib.util.spec_from_file_location('insp', ROOT + '/scripts/inspect-810.py'); insp = importlib.util.module_from_spec(_s); _s.loader.exec_module(insp)

@functools.lru_cache(None)
def rom(ver='pal'): return open(ROMS[ver], 'rb').read()
@functools.lru_cache(None)
def A(ver='pal'): return insp.Assets(rom(ver))
def asset(i, ver='pal'): return A(ver).get(i)

@functools.lru_cache(None)
def map_table(ver='pal'):
    """map id -> (opaque model asset, transparent model asset); found in the decompressed code like extract-map-collision.py"""
    a = A(ver); r = rom(ver)
    for offset, data in insp.code_streams(r, a.base + a.entries[-1][0]):
        j = data.find(struct.pack('>3H', 0x93, 0xD6D, 0xD71))
        if j < 0: continue
        start = j
        while start >= 24 and 0 < struct.unpack_from('>H', data, start - 24)[0] < 0x100: start -= 24
        T = {}; p = start
        while p + 6 <= len(data):
            m, o, t = struct.unpack_from('>3H', data, p)
            if not (0 < m < 0x100): break
            T[m] = (o, t); p += 24
        return T
    raise RuntimeError('map table not found')
