# Claude 2026-11-12 (bkb.py): "BKB1", the compact Banjo-Kazooie room file for the Bit-Clip Lab viewer: the big spot tables as typed,
# delta-coded, byte-planed columns instead of JSON text (several times smaller once gzipped, so every spot fits under the host's
# 1 GB limit without sampling; the viewer keeps them as typed columns). Same idea as tools/tooie/trb.py (TRB1).
#   file (map0xNN.gz[.i].wasm) = gzip( "BKB1" | u32 LE header length | header JSON | pad to 4 | columns )
#   header = every room key except the tables, plus fmt "BKB1" and tables {name: {n, rowlen?, cols: [[col, type, offset, ...]]}}
#   column types (n values, byte-planed: all low bytes, then the next byte, ...):
#     zdW  int32 zigzag delta from the previous value, W bytes (integers)
#     f9W  float32 bits as a zigzag delta, W bytes: the JSON number was printed with 9 significant digits from a float32, so the
#          decoder rebuilds it as Number(fround(v).toPrecision(9));  fsW the same for the shortest decimal that round-trips the float32
#          (the first toPrecision(1..9) that does);  m3W int32 zigzag delta of v * 1000 (values with <= 3 decimals)
#     qW   v * 10^E as an integer (E = cols[i][3]), zigzag delta in W = 1, 2, 4 or 8 bytes (any 9-digit decimal, e.g. sloped y)
#     with up to 25% exceptions: cols[i][5] = [count, W, index offset (zdW), float64 values offset]
#     f8   float64 bits (8 planes; plain values that are neither)
#     sdW  index into the column's string list (header: cols[i][3])
#   cols[i] = [name, type, offset, strings | null, null-flags offset | null, (exceptions)]; null flags: one byte per row, 1 = null.
# Tables and their rows (exactly as the JSON rooms had them; checked value for value by decode()):
#   cracks, slopecracks [x, y, z, seam]        hit5 [x, y, z, seam, first case, slope]
#   holdsA [x, y, z, seam, held, of, max holds, slope, clip 0 | [kind, h, vy, lag, end y], odds 0 | [runs, clips, nolag, voids]]
#   slopeclips [x, y, z, seam, cases, mask, (flat)]       lowercracks [x, y, z, seam, drop, ...12 more] or 5-entry sample rows
#   pcancel [x, y, z, seam, runs, held, clips, then per lag family (no lag: clips, best A; one lag frame, 3/2 alternation, alternation
#           with one slip, console FP-45 lag: clips, best A, share) and the example clip: A, pattern name, claw frames] (ingest_pc.py;
#           A 0 = held the whole jump, -1 = none)
import json, gzip, struct
import numpy as np
TABLES = {
  'cracks': ['x', 'y', 'z', 'seam'], 'slopecracks': ['x', 'y', 'z', 'seam'], 'hit5': ['x', 'y', 'z', 'seam', 'c', 's'],
  'holdsA': ['x', 'y', 'z', 'seam', 'held', 'of', 'maxh', 'slope', 'clip', 'ck', 'ch', 'cv', 'cl', 'ce', 'odds', 'oR', 'oC', 'oN', 'oV'],
  'slopeclips': ['x', 'y', 'z', 'seam', 'n', 'mask', 'flat'],
  'lowercracks': ['len', 'x', 'y', 'z', 'seam', 'drop', 'sv', 'sy', 'held', 'mh', 'fv', 'fk', 'fh', 'fvy', 'flag', 'fe', 'bu', 'bo'],
  'pcancel': ['x', 'y', 'z', 'seam', 'runs', 'held', 'clips', 'nC', 'nK', 'oC', 'oK', 'oS', 'aC', 'aK', 'aS', 'sC', 'sK', 'sS', 'fC', 'fK', 'fS', 'bK', 'bN', 'claw'] }
def split_row(t, r):
    if t == 'holdsA':
        c, o = r[8], r[9]; return r[:8] + [1 if c else 0] + (list(c) if c else [0] * 5) + [1 if o else 0] + (list(o) if o else [0] * 4)
    if t == 'slopeclips': return r[:6] + [r[6] if len(r) > 6 else -1]
    if t == 'lowercracks': return [len(r)] + list(r) + [0] * (17 - len(r))
    return list(r)
def join_row(t, v):
    if t == 'holdsA': return v[:8] + [v[9:14] if v[8] else 0] + [v[15:19] if v[14] else 0]
    if t == 'slopeclips': return v[:6] + ([v[6]] if v[6] != -1 else [])
    if t == 'lowercracks': return v[1:1 + v[0]]
    return v
def _planes(a, w): return np.ascontiguousarray(a.astype('<u%d' % w).view(np.uint8).reshape(-1, w).T).tobytes()
def _zz(d): d = ((d + 2**31) % 2**32) - 2**31; return (((d << 1) ^ (d >> 63)) & 0xFFFFFFFF).astype(np.uint64)
def _w(u): m = int(u.max()) if len(u) else 0; return 1 if m < 256 else 2 if m < 65536 else 4
def _isint(v): return isinstance(v, int) and not isinstance(v, bool) or (isinstance(v, float) and v.is_integer() and abs(v) < 2**31)
def _f32(v): return float(np.float32(v))
def _p9(f): return float('%.9g' % f)
def _ps(f):   # the shortest decimal that rounds back to the float32 f (as JS: the first toPrecision(1..9) that round-trips)
    for p in range(1, 10):
        t = float('%.*g' % (p, f))
        if np.float32(t) == np.float32(f): return t
    return float('%.9g' % f)
def _ok(kind, v):
    if not isinstance(v, (int, float)) or isinstance(v, bool) or v != v or abs(v) > 1e30: return False
    if kind == 'f9': return _p9(_f32(v)) == v
    if kind == 'fs': return _ps(_f32(v)) == v
    return abs(v) < 2e6 and round(v * 1000) / 1000 == v   # m3
def _zdcol(a):
    u = _zz(np.diff(np.asarray(a, np.int64), prepend=0)); w = _w(u); return w, _planes(u, w)
def encode_col(vals, put):
    """vals: python numbers / strings / None -> column meta [type, offset, strings, null offset, [n exceptions, idx offset, val offset]]
    (put(bytes) stores a block and returns its offset)"""
    n = len(vals); nul = [v is None for v in vals]; vv = [0 if v is None else v for v in vals]
    nulo = put(np.array(nul, np.uint8).tobytes()) if any(nul) else None
    if any(isinstance(v, str) for v in vv):
        d = {}; idx = [d.setdefault(v, len(d)) for v in vv]; w, b = _zdcol(idx); return ['sd%d' % w, put(b), list(d), nulo]
    if all(_isint(v) for v in vv):
        w, b = _zdcol([int(v) for v in vv]); return ['zd%d' % w, put(b), None, nulo]
    # candidates: f9 / fs / m3 / q (with up to 25% exceptions stored as float64) and plain f8; keep the one that gzips smallest
    import zlib
    cands = []
    for kind in ('f9', 'fs', 'm3'):
        bad = [i for i, v in enumerate(vv) if not _ok(kind, v)]
        if len(bad) <= n * 0.25: cands.append((kind, None, bad))
    for E in range(10):
        sc = 10 ** E; qb = [i for i, v in enumerate(vv) if not (isinstance(v, (int, float)) and abs(v) * sc < 2**52 and round(v * sc) / sc == v)]
        if len(qb) <= n * 0.25: cands.append(('q', E, qb))
        if not qb: break
    def build(kind, E, bad):
        badset = set(bad); fill = [0.0 if i in badset else vv[i] for i in range(n)]
        if kind == 'q':
            a = np.array([int(round(v * 10 ** E)) for v in fill], np.int64); d = np.diff(a, prepend=0); u = ((d << 1) ^ (d >> 63)).astype(np.uint64)
            mx = int(u.max()) if n else 0; w = next(k for k in (1, 2, 4, 8) if mx < 2 ** (8 * k)); return 'q%d' % w, _planes(u, w), E
        if kind == 'm3': w, b = _zdcol([int(round(v * 1000)) for v in fill])
        else: w, b = _zdcol(np.array(fill, np.float32).view('<u4').astype(np.int64))
        return '%s%d' % (kind, w), b, None
    f8b = np.ascontiguousarray(np.array(vv, '<f8').view(np.uint8).reshape(-1, 8).T).tobytes()
    best = ('f8', f8b, None, [], len(zlib.compress(f8b, 6)))
    for kind, E, bad in cands:
        typ, b, ex = build(kind, E, bad); sz = len(zlib.compress(b, 6)) + 12 * len(bad)
        if sz < best[4]: best = (typ, b, ex, bad, sz)
    typ, b, ex, bad, _ = best
    m = [typ, put(b), ex, nulo]
    if bad:
        wi, bi = _zdcol(bad); ev = np.array([vv[i] for i in bad], '<f8')
        m.append([len(bad), wi, put(bi), put(np.ascontiguousarray(ev.view(np.uint8).reshape(-1, 8).T).tobytes())])
    return m
def encode(room):
    """room dict -> raw BKB1 bytes (not gzipped)"""
    hdr = {k: v for k, v in room.items() if k not in TABLES or not isinstance(v, list)}; body = bytearray(); tabs = {}
    def put(b):
        while len(body) % 4: body.append(0)
        off = len(body); body.extend(b); return off
    for t, cols in TABLES.items():
        rows = room.get(t)
        if not isinstance(rows, list): continue
        V = [split_row(t, r) for r in rows]
        tabs[t] = {'n': len(rows), 'cols': [[c] + encode_col([v[j] for v in V], put) for j, c in enumerate(cols)]}
    hdr['fmt'] = 'BKB1'; hdr['tables'] = tabs
    hj = json.dumps(hdr, separators=(',', ':')).encode(); head = bytearray(b'BKB1' + struct.pack('<I', len(hj)) + hj)
    while len(head) % 4: head.append(0)
    return bytes(head) + bytes(body)
def _planes_in(raw, off, n, w): return np.frombuffer(raw, np.uint8, n * w, off).reshape(w, n).T.copy().view('<u%d' % w).reshape(n).astype(np.int64)
def _unzd(u): d = (u >> 1) ^ -(u & 1); return (np.cumsum(d) + 2**31) % 2**32 - 2**31
def decode(raw):
    """raw BKB1 bytes -> room dict with the tables as lists of rows (as the JSON had them)"""
    assert raw[:4] == b'BKB1'; hl = struct.unpack_from('<I', raw, 4)[0]; hdr = json.loads(raw[8:8 + hl]); base = (8 + hl + 3) & ~3
    room = {k: v for k, v in hdr.items() if k not in ('fmt', 'tables')}
    for t, T in hdr['tables'].items():
        n = T['n']; cols = []
        for m in T['cols']:
            c, typ, off, strs, nulo = m[:5]
            if typ == 'f8': vals = np.frombuffer(raw, np.uint8, n * 8, base + off).reshape(8, n).T.copy().view('<f8').reshape(n).tolist()
            elif typ[0] == 'q':
                w = int(typ[1:]); u = np.frombuffer(raw, np.uint8, n * w, base + off).reshape(w, n).T.copy().view('<u%d' % w).reshape(n).astype(np.uint64)
                d = (u >> np.uint64(1)).astype(np.int64) ^ -(u & np.uint64(1)).astype(np.int64); a = np.cumsum(d); sc = 10 ** strs; vals = [q / sc for q in a.tolist()]
            else:
                k, w = typ[:2], int(typ[2:]); a = _unzd(_planes_in(raw, base + off, n, w))
                if k == 'sd': vals = [strs[i] for i in a.tolist()]
                elif k == 'zd': vals = a.tolist()
                elif k == 'm3': vals = [q / 1000 for q in a.tolist()]
                else:
                    f = a.astype(np.uint32).view(np.float32).astype(np.float64).tolist(); vals = [_p9(x) for x in f] if k == 'f9' else [_ps(x) for x in f]
            if len(m) > 5:
                ne, wi, io, vo = m[5]; idx = _unzd(_planes_in(raw, base + io, ne, wi)).tolist()
                ev = np.frombuffer(raw, np.uint8, ne * 8, base + vo).reshape(8, ne).T.copy().view('<f8').reshape(ne).tolist()
                for i, v in zip(idx, ev): vals[i] = v
            if nulo is not None:
                nul = np.frombuffer(raw, np.uint8, n, base + nulo); vals = [None if nul[i] else vals[i] for i in range(n)]
            cols.append(vals)
        room[t] = [join_row(t, list(r)) for r in zip(*cols)] if n else []
    return room
def add_tables(raw, extra):
    """raw BKB1 bytes + {table: rows, other header key: value} -> raw BKB1 bytes with the new tables' columns appended (the other
    tables' bytes are kept as they are, so a big room is not decoded); a table that is already there is replaced by a full re-encode"""
    assert raw[:4] == b'BKB1'; hl = struct.unpack_from('<I', raw, 4)[0]; hdr = json.loads(raw[8:8 + hl]); base = (8 + hl + 3) & ~3
    if any(t in hdr['tables'] for t in extra if t in TABLES): room = decode(raw); room.update(extra); return encode(room)
    body = bytearray(raw[base:])
    def put(b):
        while len(body) % 4: body.append(0)
        off = len(body); body.extend(b); return off
    for t, rows in extra.items():
        if t in TABLES and isinstance(rows, list):
            V = [split_row(t, r) for r in rows]; hdr['tables'][t] = {'n': len(rows), 'cols': [[c] + encode_col([v[j] for v in V], put) for j, c in enumerate(TABLES[t])]}
        else: hdr[t] = rows
    hj = json.dumps(hdr, separators=(',', ':')).encode(); head = bytearray(b'BKB1' + struct.pack('<I', len(hj)) + hj)
    while len(head) % 4: head.append(0)
    return bytes(head) + bytes(body)
def write(path, room, level=9):
    raw = encode(room); gz = gzip.compress(raw, level, mtime=0); return gz
