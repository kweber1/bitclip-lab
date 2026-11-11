# Claude 2026-11-11 (bkhd.py): match Banjo-Kazooie level textures to BK-Reloaded (GhostlyDark and contributors) the way GLideN64 does
# (Rice texture checksum + palette checksum, btrice.py). Writes <site>/data/hd.json: {source, base, files: {lab texture key: path in
# the pack}}; the viewer loads the images from the pack's own repository (pinned commit), nothing is copied here.
import sys, re, json, os
sys.path.insert(0, '/home/claude/btmaps')
import btrice, bkassets as B, bktex
def pack_index(listfile='/home/claude/bkvis/bkr-files.txt'):
    P = {}
    for f in open(listfile):
        f = f.strip(); m = re.search(r'#([0-9A-F]{8})#(\d)#(\d)(?:#([0-9A-F]{8}))?_(\w+)\.png$', f)
        if m: P.setdefault((m.group(1), int(m.group(2)), int(m.group(3))), []).append((m.group(4), f))
    return P
def hd_path(e, P):
    c = btrice.checksums(e)
    if not c: return None
    crc, fm, sz, pal, cm = c
    for pc, path in P.get(('%08X' % crc, fm, sz), []):
        if pal is None and pc is None: return path
        if pal is not None and pc is not None and '%08X' % btrice.palcrc(pal, cm, False) == pc: return path
    return None
if __name__ == '__main__':
    site = sys.argv[1]; P = pack_index(); commit = open('/home/claude/bkvis/bkr-commit.txt').read().strip()
    maps = [int(e['map'], 16) for e in json.load(open(os.path.join(site, 'data', 'index.json')))]
    T = B.map_table('pal'); files = {}; n = 0
    for m in maps:
        for aid in T[m]:
            if not aid: continue
            for e in bktex.setup(B.asset(aid), aid):
                n += 1; p = hd_path(e, P)
                if p: files[e['key']] = p
    json.dump({'source': "BK Reloaded by GhostlyDark (and contributors), https://github.com/GhostlyDark/BK-Reloaded - loaded from the pack's own repository, not copied here",
               'base': 'https://raw.githubusercontent.com/GhostlyDark/BK-Reloaded/%s/' % commit, 'files': files}, open(os.path.join(site, 'data', 'hd.json'), 'w'), indent=0)
    print('level textures', n, 'with an HD replacement', len(files), 'distinct pack files', len(set(files.values())))
