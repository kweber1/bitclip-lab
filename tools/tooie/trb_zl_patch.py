# Claude 2026-11-14 (trb_zl_patch.py): add a Banjo-Tooie zero-line census result (tcensus_zl.cu, TC_ZL=1: only the seams lying on x = 0 or
# z = 0, across offsets o * 1e-10, o = +-1..3) to a published room file (room-<map>.gz.wasm, TRB1) in place, the way tc_merge_zl.py +
# site_build.py would rebuild it from both census files, without the room's full census file:
#   - each zl CELL is merged into the room's spot with the same seam and cell (floor(x / 0.25), floor(z / 0.25)): crack-float counts add
#     up; the spot keeps the representative float of the better category (walk > lag > jump > stuck > eject > wall > water, ties keep
#     the census's) and its category is the best one of the summed counts, as site_build.py takes it; cells only the zl run has are new spots
#   - zl seams are matched to the room's seams by end points and floor triangles; their crack-float counts add up
#   - room header and index entry: counts, cats, cats_flat, holds, void, cells, shown, crack floats / samples, bytes; "zl": 1
# usage: python3 trb_zl_patch.py <data repo dir> <map> <zl tc file (.txt / .gz)>     (prints a JSON summary; rooms already patched are refused)
import sys, os, json, gzip, math
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trb')); import trb
CATN = ['walk', 'lag', 'jump', 'stuck', 'eject', 'wall', 'water']
CI = {'walk': 0, 'lag': 2, 'jump': 3, 'eject': 4, 'stuck': 5, 'wall': 6, 'water': 7}   # index in the counts list after n
def cat_of(c):   # c = [walk, void, lag, jump, eject, stuck, wall, water, hold] -> site_build.py's category
    return 'walk' if c[0] else 'lag' if c[2] else 'jump' if c[3] else 'stuck' if c[5] else 'eject' if c[4] else 'wall' if c[6] else 'water'
PRI = {k: i for i, k in enumerate(CATN)}
def entry(seam, a):   # a CELL line's tokens -> the spot list site_build.py makes
    bar = a.index('|'); c = [int(v) for v in a[2:bar]]; r = a[bar + 1:]; outs = r[3]; hl = [int(v) for v in r[4].split(',')]; sits = [int(v) for v in r[6].split(',')]
    j = r[9] if len(r) > 9 else '-'; jc = [int(v) for v in j[1:].split('/')[1].replace(':', ',').split(',')] if j != '-' else None
    n, cw, cv, cl, cj, ce, cs, cwa, cwt, ch = c
    return [float(r[0]), float(r[1]), float(r[2]), seam, n, cat_of(c[1:]), outs, sum(1 for h in hl if h), max(sits), int(r[7]), round(float(r[8]), 2),
            (jc[0] if jc else -1), (jc[1] if jc else -1), (jc[5] if jc else -1), 1 if ch else 0, c]
def rep_cat(c): return cat_of(c[1:])   # category of the cell's representative float = the best category with a count
def main(D, m, zlf):
    f = os.path.join(D, 'data', 'room-%s.gz.wasm' % m); idxf = os.path.join(D, 'data', 'index.json'); idx = json.load(open(idxf))
    e = next(x for x in idx['rooms'] if x['map'] == m); assert not e.get('parts') and not e.get('repo'), 'room in parts / another repo: not handled'
    hdr, C = trb.decode(gzip.decompress(open(f, 'rb').read())); assert hdr.get('every'), 'not an exhaustive room'
    if hdr.get('zl'): print(json.dumps({'map': m, 'skipped': 'already has the zero-line run'})); return
    n0 = hdr['n']; seams = hdr['seams']
    # the zl run
    zh = None; zseams = []; zcells = []
    for l in (gzip.open(zlf, 'rt') if zlf.endswith('.gz') else open(zlf)):
        a = l.split()
        if not a: continue
        if a[0] == 'ROOM': zh = a
        elif a[0] == 'SEAM': zseams.append(a)
        elif a[0] == 'CELL': zcells.append(a)
    sk = lambda P, ab: (tuple(float(v) for v in P), ab)
    sidx = {sk(s[:6], tuple(s[9:13])): i for i, s in enumerate(seams)}; zmap = {}; newseams = 0
    for a in zseams:
        k = sk(a[4:10], tuple(int(v) for v in a[2].split(':') + a[3].split(':')))
        if k in sidx: i = sidx[k]
        else:
            i = len(seams); seams.append([float(a[4]), float(a[5]), float(a[6]), float(a[7]), float(a[8]), float(a[9]), round(float(a[10]), 4), round(float(a[11]), 4), 0] + [int(v) for v in a[2].split(':') + a[3].split(':')])
            sidx[k] = i; newseams += 1
        seams[i][8] = int(seams[i][8]) + int(a[12]); zmap[int(a[1])] = i
    Z = {}
    for a in zcells:
        s = zmap[int(a[1])]; E = entry(s, a); k = (s, math.floor(E[0] / 0.25), math.floor(E[2] / 0.25))
        assert k not in Z, 'two zl cells with one key'; Z[k] = E
    # the room's spots with those keys
    zs = set(zmap.values()); sel = np.nonzero(np.isin(C['seam'], list(zs)))[0]
    keys = {}
    for i in sel:
        k = (int(C['seam'][i]), math.floor(float(C['x'][i]) / 0.25), math.floor(float(C['z'][i]) / 0.25)); keys[k] = int(i)
    # columns as arrays (rooms with millions of spots: no per-spot lists); merged spots are rewritten in place, new ones appended
    cats = {c: i for i, c in enumerate(hdr['cats'])}; walks = {w: i for i, w in enumerate(hdr['walks'])}; NR = hdr['nruns']
    def get(i): return trb.spots_from(hdr, C, [i])[0]
    merged = better = 0; cnt = dict(hdr['counts']); flat = lambda s: seams[s][6] > 0.999 and seams[s][7] > 0.999
    cf = dict(e.get('cats_flat', {})); add = {'spots': 0, 'holds': 0, 'void': 0}
    def tally(E):
        c = E[15]
        for k_, ci in CI.items():
            v = c[1 + ci]
            if v:
                cnt[k_] = cnt.get(k_, 0) + v
                if flat(E[3]): cf[k_] = cf.get(k_, 0) + v
        add['spots'] += c[0]; add['holds'] += c[9]; add['void'] += c[2]
    upd = {}; newspots = []
    for k, E in Z.items():
        tally(E)
        if k in keys:
            i = keys[k]; S = get(i); c = [x + y for x, y in zip(S[15], E[15])]; merged += 1
            rep = E if PRI[rep_cat(E[15])] < PRI[rep_cat(S[15])] else S; better += rep is E
            N = list(rep[:15]) + [c]; N[3] = S[3]; N[4] = c[0]; N[5] = cat_of(c[1:]); N[14] = 1 if c[9] else 0; upd[i] = N
        else: newspots.append(E)
    newspots.sort(key=lambda E: (E[3], E[0], E[2])); n1 = n0 + len(newspots)
    cols = trb.Cols(0, NR); cols.n = n1; cols.i = n1; cols.cats = cats; cols.walks = walks
    cols.f = {nm: np.concatenate([np.asarray(C[nm], '<f4'), np.zeros(len(newspots), '<f4')]) for _, nm in trb.FCOLS}
    cols.seam = np.concatenate([np.asarray(C['seam'], np.int64), np.zeros(len(newspots), np.int64)])
    cols.it = {nm: np.concatenate([np.asarray(C[nm], np.int64), np.zeros(len(newspots), np.int64)]) for _, nm in trb.ICOLS}
    cols.runs = np.zeros((n1, NR), np.int64)
    for j in range(NR): cols.runs[:n0, j] = C['run%d' % j]
    cols.cat = np.concatenate([np.asarray(C['cat'], np.int64), np.zeros(len(newspots), np.int64)]); cols.walk = np.concatenate([np.asarray(C['walk'], np.int64), np.zeros(len(newspots), np.int64)])
    def put(i, S):
        for k_, nm in trb.FCOLS: cols.f[nm][i] = S[k_]
        cols.seam[i] = S[3]
        for k_, nm in trb.ICOLS: cols.it[nm][i] = S[k_]
        cols.runs[i] = S[15]; cols.cat[i] = cats.setdefault(S[5], len(cats)); cols.walk[i] = walks.setdefault(S[6], len(walks))
    for i, S in upd.items(): put(i, S)
    for q, S in enumerate(newspots): put(n0 + q, S)
    h = {k: v for k, v in hdr.items() if k not in ('fmt', 'n', 'cats', 'walks', 'nruns', 'cols')}
    h['seams'] = seams; h['counts'] = cnt; h['zl'] = 1
    h['thinned'] = hdr.get('thinned', '') + '; with the zero-line run (seams on x = 0 / z = 0, offsets 1-3 x 1e-10 across)'
    trb.write(f, h, cols)
    e['cats'] = cnt; e['cats_flat'] = cf; e['spots'] += add['spots']; e['holds'] += add['holds']; e['void'] += add['void']
    e['cells'] = e.get('cells', 0) + len(newspots); e['shown'] += len(newspots); e['seams'] = len(seams); e['zl'] = 1
    e['crack_floats'] += int(zh[7]); e['crack_samples'] += int(zh[5]); e['bytes'] = os.path.getsize(f)
    json.dump(idx, open(idxf, 'w'), indent=1)
    print(json.dumps({'map': m, 'name': e['name'], 'zl_seams': len(zseams), 'new_seams': newseams, 'zl_cells': len(Z), 'merged': merged, 'better': better,
                      'new_spots': len(newspots), 'zl_floats': int(zh[7]), 'zl_cats': {k_: sum(E[15][1 + ci] for E in Z.values()) for k_, ci in CI.items()},
                      'zl_holds': sum(E[15][9] for E in Z.values()), 'zl_void': sum(E[15][2] for E in Z.values()), 'bytes': e['bytes']}))
if __name__ == '__main__': main(*sys.argv[1:4])
