# Claude 2026-11-12 (trb.py): "TRB1", the compact Tooie room file for the Bit-Clip Lab viewer (about 3x smaller than gzipped JSON,
# and the viewer keeps the spots as typed columns instead of millions of arrays).
#   file (room-<map>.gz.wasm) = gzip( "TRB1" | u32 LE header length | header JSON | pad to 4 | columns )
#   header = every room key except "spots", plus  fmt "TRB1", n (spots), cats (category names), walks (distinct 9-digit run strings),
#            nruns (length of the per-spot outcome counts list), cols [[name, type, offset]] (offset from the column area start).
#   column types: u1 i1 u2 i2 u4 i4 = plain integers; fd1 fd2 fd4 = float32 stored as the zigzag delta of its bits from the previous
#   spot's; zd1 zd2 zd4 = int32 zigzag delta. Every column is byte-planed: the low byte of all n values, then the next byte, ...
# A spot is rebuilt as the JSON rooms had it: [x, y, z, seam, crack_floats(= run0), category, walk_outcomes_9, walk_runs_with_hold,
# max_sit_updates, decided_update, end_y, jump_clips_of_42, jump_voids_of_42, jump_drops_with_hold, any_hold, [run0 .. run9]].
import json, gzip, struct, sys, os
import numpy as np
FCOLS = ((0, 'x'), (1, 'y'), (2, 'z'), (10, 'end_y'))
ICOLS = ((7, 'walk_runs_with_hold'), (8, 'max_sit_updates'), (9, 'decided_update'), (11, 'jump_clips_of_42'), (12, 'jump_voids_of_42'),
         (13, 'jump_drops_with_hold'), (14, 'any_hold'))
def _w(u):
    m = int(u.max()) if len(u) else 0; return 1 if m < 256 else 2 if m < 65536 else 4
def _planes(a, w):
    return np.ascontiguousarray(a.astype('<u%d' % w).view(np.uint8).reshape(-1, w).T).tobytes()
def _zz(d):   # int64 holding int32 values -> uint32 zigzag
    d = ((d + 2**31) % 2**32) - 2**31; return (((d << 1) ^ (d >> 63)) & 0xFFFFFFFF).astype(np.uint64)
def _plain(a):
    lo, hi = (int(a.min()), int(a.max())) if len(a) else (0, 0)
    for t, mn, mx in (('u1', 0, 255), ('i1', -128, 127), ('u2', 0, 65535), ('i2', -32768, 32767), ('u4', 0, 2**32 - 1), ('i4', -2**31, 2**31 - 1)):
        if lo >= mn and hi <= mx: return t, _planes((a % (1 << (8 * int(t[1])))) if t[0] == 'i' else a, int(t[1]))
    raise ValueError('out of range')
class Cols:
    """collect spots (16-entry lists) into numpy columns"""
    def __init__(self, n, nruns=10):
        self.n = n; self.i = 0; self.nruns = nruns
        self.f = {nm: np.zeros(n, '<f4') for _, nm in FCOLS}; self.seam = np.zeros(n, np.int64)
        self.it = {nm: np.zeros(n, np.int64) for _, nm in ICOLS}; self.runs = np.zeros((n, nruns), np.int64)
        self.cat = np.zeros(n, np.int64); self.walk = np.zeros(n, np.int64); self.cats = {}; self.walks = {}
    def add(self, s):
        i = self.i; self.i += 1
        for k, nm in FCOLS: self.f[nm][i] = s[k]
        self.seam[i] = s[3]
        for k, nm in ICOLS: self.it[nm][i] = s[k]
        r = s[15]; assert isinstance(r, list) and len(r) == self.nruns and r[0] == s[4], 'not an every-float spot'
        self.runs[i] = r
        self.cat[i] = self.cats.setdefault(s[5], len(self.cats)); self.walk[i] = self.walks.setdefault(s[6], len(self.walks))
    def blob(self, hdr):
        assert self.i == self.n, (self.i, self.n)
        cols = []
        for _, nm in FCOLS:
            bits = self.f[nm].view('<u4').astype(np.int64); d = np.diff(bits, prepend=0); u = _zz(d); w = _w(u); cols.append((nm, 'fd%d' % w, _planes(u, w)))
        u = _zz(np.diff(self.seam, prepend=0)); w = _w(u); cols.append(('seam', 'zd%d' % w, _planes(u, w)))
        t, b = _plain(self.cat); cols.append(('cat', t, b)); t, b = _plain(self.walk); cols.append(('walk', t, b))
        for _, nm in ICOLS: t, b = _plain(self.it[nm]); cols.append((nm, t, b))
        for j in range(self.nruns): t, b = _plain(self.runs[:, j]); cols.append(('run%d' % j, t, b))
        body = bytearray(); meta = []
        for nm, t, b in cols:
            while len(body) % 4: body.append(0)
            meta.append([nm, t, len(body)]); body += b
        h = dict(hdr); h.pop('spots', None)
        h.update(fmt='TRB1', n=self.n, cats=list(self.cats), walks=list(self.walks), nruns=self.nruns, cols=meta)
        hj = json.dumps(h, separators=(',', ':')).encode(); head = bytearray(b'TRB1' + struct.pack('<I', len(hj)) + hj)
        while len(head) % 4: head.append(0)
        return bytes(head) + bytes(body)
def write(path, hdr, cols, level=9):
    raw = cols.blob(hdr); tmp = path + '.tmp'
    with open(tmp, 'wb') as f: f.write(gzip.compress(raw, level, mtime=0))
    os.replace(tmp, path); return len(raw)
def from_json_text(txt):
    """stream the spots of a room JSON text straight into columns (the spots are the last key; spots are separated by '],[' after
    their inner outcome list, so the count is known up front and no list of millions of lists is built)"""
    k = txt.index('"spots":['); a = k + len('"spots":['); dec = json.JSONDecoder(); i = a
    n = 0 if txt[a] == ']' else txt.count(']],[', a) + 1
    first, _ = dec.raw_decode(txt, a) if n else (None, 0)
    c = Cols(n, len(first[15]) if n and isinstance(first[15], list) else 10)
    while True:
        while txt[i] in ' \n,': i += 1
        if txt[i] == ']': end = i + 1; break
        s, i = dec.raw_decode(txt, i); c.add(s)
    hdr = json.loads(txt[:k] + '"spots":null' + txt[end:])
    return hdr, c
def decode(raw):
    assert raw[:4] == b'TRB1'; hl = struct.unpack_from('<I', raw, 4)[0]; hdr = json.loads(raw[8:8 + hl]); base = (8 + hl + 3) & ~3; n = hdr['n']; C = {}
    for nm, t, off in hdr['cols']:
        w = int(t[-1]); b = np.frombuffer(raw, np.uint8, n * w, base + off).reshape(w, n).T.copy(); u = b.view('<u%d' % w).reshape(n).astype(np.int64)
        if t[0] in 'fz':
            d = (u >> 1) ^ -(u & 1); acc = np.cumsum(d) % 2**32; v = acc.astype('<u4')
            C[nm] = v.view('<f4') if t[0] == 'f' else v.view('<i4').astype(np.int64)
        else:
            C[nm] = b.view('<' + t[0] + str(w)).reshape(n).astype(np.int64) if t[0] != 'u' else u
    return hdr, C
def spots_from(hdr, C, idx):
    out = []
    for i in idx:
        r = [int(C['run%d' % j][i]) for j in range(hdr['nruns'])]
        out.append([float(C['x'][i]), float(C['y'][i]), float(C['z'][i]), int(C['seam'][i]), r[0], hdr['cats'][int(C['cat'][i])], hdr['walks'][int(C['walk'][i])],
                    int(C['walk_runs_with_hold'][i]), int(C['max_sit_updates'][i]), int(C['decided_update'][i]), float(C['end_y'][i]),
                    int(C['jump_clips_of_42'][i]), int(C['jump_voids_of_42'][i]), int(C['jump_drops_with_hold'][i]), int(C['any_hold'][i]), r])
    return out
