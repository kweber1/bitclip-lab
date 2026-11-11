# Claude 2026-11-11 (bt_rooms.py): write every Banjo-Tooie (USA) level's collision in the Bit-Clip Lab room format so the
# Kazooie census tools (census_gpu / bkgpu, NTSC mode) run on it unchanged ("assuming the logic is the same").
# One room per distinct (opaque, transparent) level-model pair; all maps that use the pair are listed in "maps".
# Output: OUT/rooms/0xNNN.json (map, name, group, maps, opa, xlu, props: []) and OUT/txt/0xNNN.txt (census input: opaque +
# transparent triangles in one list).
#
# Triangle flags are rewritten into the Kazooie bits the tools test, from the filters read in RAM (GI Basement, Banjo):
#   Tooie player sphere filter = ctx+0x14 (0x00400005) | 0x20020 (water)      Kazooie: 0x400000 | 0x1E0000
#   Tooie floor-ray filter     = tracker+0x84 (0x00400005) [| 0x20020]          Kazooie: 0x400000 [| 0x1E0000]
#   Tooie water-ray filter     = tracker+0x88 (0x00001F00), opaque model skipped  Kazooie: 0xF800FF0F, opaque skipped
#   two-sided bit 0x10000 (same in both games: sll 15 / bgez in func_800AB0BC and the tracker)
# so  tooie & 0x400005 -> 0x400000,  tooie & 0x20020 -> 0x20000,  tooie & 0x10000 -> 0x10000,  tooie & 0x1F00 -> 0x100.
# The original flags are kept as the 6th value of each triangle. Vertices are compacted to the referenced ones;
# vertex_header[11] (the model's bounding radius, read by the line test) = Tooie vertex_header[10].
import sys, os, re, json, math, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import btassets as B

OUT = sys.argv[1] if len(sys.argv) > 1 else 'tooie-lab'
NAMES = {int(v, 16): n for n, v in re.findall(r'(MAP_\w+)\s*=\s*(0x[0-9A-Fa-f]+)', open(os.path.join(os.environ.get('BT_DECOMP', 'banjo-tooie'), 'include', 'maps.h')).read())}
WORLD = {'SM': 'Spiral Mountain', 'JV': 'Jinjo Village', 'IOH': "Isle o' Hags", 'GL': "Isle o' Hags", 'MT': 'Mayahem Temple',
         'GGM': 'Glitter Gulch Mine', 'WW': 'Witchyworld', 'JRL': "Jolly Roger's Lagoon", 'TDL': 'Terrydactyland',
         'GI': 'Grunty Industries', 'HP': 'Hailfire Peaks', 'CCL': 'Cloud Cuckooland', 'CK': 'Cauldron Keep', 'MP': 'Multiplayer'}
FIX = {'IOH': 'Isle o\' Hags', 'GL': 'Isle o\' Hags', 'SOP': 'SoP', 'OGOLD': "O' Gold", 'HEGGYS': "Heggy's", 'BANJOS': "Banjo's",
       'BOTTLES': "Bottles'", 'JOLLYS': "Jolly's", 'TERRYS': "Terry's", 'BOGGYS': "Boggy's", 'BLUBBERS': "Blubber's",
       'PROSPECTORS': "Prospector's", 'WORKERS': "Workers'", 'CHUFFYS': "Chuffy's", 'UNGA': 'Unga', 'BUNGAS': "Bunga's",
       'SMUGGLERS': "Smugglers'", 'ROGERS': "Roger's", 'MINGY': 'Mingy', 'B': 'B.', 'V1': 'v1', 'V2': 'v2', 'V3': 'v3'}
def pretty(n):
    p = n.split('_')[2:]
    w = WORLD.get(p[0]) if p else None
    if w and len(p) > 1: p = p[1:]
    words = [FIX.get(x, x.capitalize()) for x in p]
    s = ' '.join(words).replace('Pot O Gold', "Pot o' Gold").replace('Jiggywiggy', 'Jiggywiggy').replace('Sactum', 'Sanctum')
    return s, (w or 'Other')
# names the decomp leaves unknown or placeholder (0xCA-0xCE are labelled MT_KICKBALL_3 there; they are the GGM rooms)
OVR = {0xF4: ('Ancient Swimming Baths', "Jolly Roger's Lagoon"), 0xCA: ('Fuel Depot', 'Glitter Gulch Mine'),
       0xCB: ('Crushing Shed', 'Glitter Gulch Mine'), 0xCC: ('Flooded Caves', 'Glitter Gulch Mine'),
       0xCD: ('Water Storage', 'Glitter Gulch Mine'), 0xCE: ('Waterfall Cavern', 'Glitter Gulch Mine'),
       0xAD: ("Grunty's Lair Entrance", 'Spiral Mountain'), 0xB6: ("Wumba's Wigwam", None), 0xB7: ("Mumbo's Skull", None),
       0xF1: ('UFO', None), 0x150: ("Heggy's Egg Shed", None), 0xD0: ("Chuffy's Cab", 'Other'), 0xD1: ("Inside Chuffy's Boiler", None),
       0x166: ("Inside Targitzan's Temple", 'Mayahem Temple'), 0x177: ('Slightly Sacred Chamber', None),
       0x1A7: ("Jolly Roger's Lagoon (town)", None), 0x120: ("Wumba's Wigwam", None), 0x122: ("Wumba's Wigwam (big)", None),
       0x12E: ('Kickball 1', None), 0xC6: ('Kickball 1', None), 0x145: ('Jinjo House', None)}
def remap(f):
    b = 0
    if f & 0x400005: b |= 0x400000
    if f & 0x20020: b |= 0x20000
    if f & 0x10000: b |= 0x10000
    if f & 0x1F00: b |= 0x100
    return b
def room_model(aid):
    if not aid: return None
    m = B.model(B.asset(aid)); c = m['collision']
    if not c or not c['triangles']: return None
    used = sorted({t[j] for t in c['triangles'] for j in range(3)}); idx = {v: i for i, v in enumerate(used)}
    verts = [list(m['vertices'][v]) for v in used]
    rad = max(math.sqrt(x * x + y * y + z * z) for x, y, z in verts)
    vh = list(m['vertex_header']); gn = vh[10] if vh[10] >= rad else int(math.ceil(rad))
    tris = [[idx[t[0]], idx[t[1]], idx[t[2]], t[3], remap(t[4]), t[4]] for t in c['triangles']]
    return {'asset': '0x%X' % aid, 'tooie_vertex_header': vh, 'vertex_header': vh[:11] + [gn], 'vertices': verts,
            'collision': {'header': list(c['header']), 'cells': [list(x) for x in c['cells']], 'triangles': tris}}
if __name__ == '__main__':
    os.makedirs(OUT + '/rooms', exist_ok=True); os.makedirs(OUT + '/txt', exist_ok=True)
    mt = B.maptable(); pairs = collections.OrderedDict()
    for mp in sorted(mt):
        r = mt[mp]; pairs.setdefault((r[0], r[1]), []).append(mp)
    index = []
    for (oa, xa), maps in pairs.items():
        play = [m for m in maps if '_CS_' not in NAMES.get(m, '')]
        if not play: continue
        opa, xlu = room_model(oa), room_model(xa)
        nt = (len(opa['collision']['triangles']) if opa else 0) + (len(xlu['collision']['triangles']) if xlu else 0)
        if nt == 0: continue
        key = '0x%X' % play[0]; nm, grp = pretty(NAMES.get(play[0], 'MAP_%X_UNKNOWN' % play[0]))
        if play[0] in OVR: nm, grp = OVR[play[0]][0], OVR[play[0]][1] or grp
        others = [pretty(NAMES.get(m, 'MAP_%X_X' % m))[0] for m in play[1:]]
        room = {'map': key, 'name': nm, 'group': grp, 'maps': ['0x%X' % m for m in play], 'map_names': [nm] + others,
                'game': 'Banjo-Tooie (USA)', 'opa': opa, 'xlu': xlu, 'props': []}
        json.dump(room, open('%s/rooms/%s.json' % (OUT, key), 'w'), separators=(',', ':'))
        V = (opa['vertices'] if opa else []) + (xlu['vertices'] if xlu else []); off = len(opa['vertices']) if opa else 0
        T = ([t[:3] + [t[4]] for t in opa['collision']['triangles']] if opa else []) + \
            ([[t[0] + off, t[1] + off, t[2] + off, t[4]] for t in xlu['collision']['triangles']] if xlu else [])
        with open('%s/txt/%s.txt' % (OUT, key), 'w') as f:
            f.write('%d %d\n' % (len(V), len(T))); f.write(''.join('%d %d %d\n' % tuple(v) for v in V))
            f.write(''.join('%d %d %d %d\n' % tuple(t) for t in T))
        index.append({'map': key, 'name': nm, 'group': grp, 'maps': room['maps'], 'map_names': room['map_names'], 'tris': nt,
                      'opa': opa and opa['asset'], 'xlu': xlu and xlu['asset']})
        print(key, nm, '|', grp, '|', nt, 'tris', '| also' if others else '', ', '.join(others))
    json.dump(index, open(OUT + '/rooms-index.json', 'w'), indent=1)
    print(len(index), 'rooms')
