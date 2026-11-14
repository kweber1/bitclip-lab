# Claude 2026-11-14 (tc_merge_zl.py): merge a Banjo-Tooie zero-line census result (tcensus_zl.cu, TC_ZL=1: only the seams lying on x = 0 or
# z = 0, across offsets o * 1e-10) into the room's exhaustive census result (tc-<room>.txt, across offsets = the +-3 float steps, which
# are denormals on those seams), so site_build.py / publish_every.sh publish one room with both:
#   - zl seams are matched to the census's seams by their two floor triangles and end points (renumbered to the census's index);
#     the per-seam crack-float count (last SEAM field) adds up
#   - each zl CELL (one 0.25 x 0.25 cell of one seam) is merged into the census's cell with the same seam and cell (floor(x / 0.25),
#     floor(z / 0.25), as tcensus keys them): the counts add up and the cell keeps the representative float of the better category
#     (walk > lag > jump > stuck > eject > wall > water, as tcensus ranks them; ties keep the census's); cells only the zl run has are
#     appended
#   - ROOM header: samples and crack floats add up, cells recounted, "zl 1" appended
# usage: python3 tc_merge_zl.py <census tc (.txt or .gz)> <zl tc (.txt or .gz)> <out tc (.txt or .gz)>
import sys, gzip, math, tempfile, shutil
def op(f, m='rt'): return gzip.open(f, m) if f.endswith('.gz') else open(f, m[0])
CPRI = [(0, 0), (2, 1), (3, 2), (5, 3), (4, 4), (6, 5), (7, 6)]   # (count index after n: walk void lag jump eject stuck wall water hold) -> priority
def best(c):   # c = [walk, void, lag, jump, eject, stuck, wall, water, hold]
    for i, p in CPRI:
        if c[i]: return p
    return 99
def parse_cell(l):
    a = l.split(); bar = a.index('|'); seam = int(a[1]); n = int(a[2]); c = [int(v) for v in a[3:bar]]; rest = a[bar + 1:]
    return seam, n, c, rest
def key(seam, rest): return (seam, math.floor(float(rest[0]) / 0.25), math.floor(float(rest[2]) / 0.25))
def fmt(seam, n, c, rest): return 'CELL %d %d %s | %s\n' % (seam, n, ' '.join(str(v) for v in c), ' '.join(rest))
def skey(a): return (a[2], a[3]) + tuple(float(v) for v in a[4:10])
def main(orig, zlf, outf):
    # the zl run: header, seams, cells (small)
    zhead = None; zseams = []; zcells = {}
    for l in op(zlf):
        a = l.split()
        if not a: continue
        if a[0] == 'ROOM': zhead = a
        elif a[0] == 'SEAM': zseams.append(a)
        elif a[0] == 'CELL':
            s, n, c, r = parse_cell(l); zcells.setdefault(s, []).append((n, c, r))
    # the census: seams first (they precede the cells)
    fh = op(orig); head = None; seams = []; first_cell = None
    for l in fh:
        a = l.split()
        if not a: continue
        if a[0] == 'ROOM': head = a
        elif a[0] == 'SEAM': seams.append(a)
        elif a[0] == 'CELL': first_cell = l; break
    idx = {skey(a): int(a[1]) for a in seams}; zmap = {}; added = 0
    for a in zseams:
        k = skey(a); zi = int(a[1])
        if k in idx: oi = idx[k]; seams[oi] = seams[oi][:12] + [str(int(seams[oi][12]) + int(a[12]))]
        else: oi = len(seams); seams.append(['SEAM', str(oi)] + a[2:]); idx[k] = oi; added += 1
        zmap[zi] = oi
    Z = {}
    for zi, rows in zcells.items():
        for n, c, r in rows:
            k = key(zmap[zi], r)
            if k in Z: on, oc, orr = Z[k]; Z[k] = (on + n, [x + y for x, y in zip(oc, c)], orr if best(oc) <= best(c) else r)
            else: Z[k] = (n, c, r)
    body = tempfile.TemporaryFile('w+'); ncells = 0; merged = 0; better = 0
    def emit(l):
        nonlocal ncells, merged, better
        s, n, c, r = parse_cell(l); k = key(s, r); ncells += 1
        if k in Z:
            zn, zc, zr = Z.pop(k); merged += 1; b0, b1 = best(c), best(zc)
            if b1 < b0: better += 1; r = zr
            body.write(fmt(s, n + zn, [x + y for x, y in zip(c, zc)], r))
        else: body.write(l if l.endswith('\n') else l + '\n')
    if first_cell: emit(first_cell)
    for l in fh:
        if l.startswith('CELL'): emit(l)
    fh.close()
    for (s, _, _), (n, c, r) in sorted(Z.items()): body.write(fmt(s, n, c, r)); ncells += 1
    # header: ROOM <room> seams N samples S cracks C cells K every 1 zeropart 2 [...]
    h = list(head); h[3] = str(len(seams)); h[5] = str(int(head[5]) + int(zhead[5])); h[7] = str(int(head[7]) + int(zhead[7])); h[9] = str(ncells)
    with op(outf, 'wt') as o:
        o.write(' '.join(h + ['zl', '1']) + '\n')
        for a in seams: o.write(' '.join(a) + '\n')
        body.seek(0); shutil.copyfileobj(body, o)
    print('merged %s + %s: %d zl seams (%d new), %d zl cells: %d merged into census cells (%d now a better category), %d new; %d cells; crack floats %s + %s'
          % (orig, zlf, len(zseams), added, sum(len(v) for v in zcells.values()), merged, better, len(Z), ncells, head[7], zhead[7]))
if __name__ == '__main__': main(*sys.argv[1:4])
