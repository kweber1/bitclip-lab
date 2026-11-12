# Claude 2026-11-12: convert published Tooie rooms (gzipped JSON, maybe in parts) to TRB1 in place and check EVERY spot round-trips
# (float32 bits, ints, strings). usage: convert.py <data repo dir> <map> ...   prints one line per room; updates index.json bytes/parts.
import sys, os, json, gzip, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import trb
D = sys.argv[1]; data = os.path.join(D, 'data'); idxf = os.path.join(data, 'index.json'); idx = json.load(open(idxf))
for m in sys.argv[2:]:
    e = next(x for x in idx['rooms'] if x['map'] == m)
    names = ['room-%s.gz.%d.wasm' % (m, i) for i in range(e['parts'])] if e.get('parts') else ['room-%s.gz.wasm' % m]
    gz = b''.join(open(os.path.join(data, f), 'rb').read() for f in names); raw = gzip.decompress(gz)
    if raw[:4] == b'TRB1': print(m, 'already TRB1'); continue
    txt = raw.decode(); del raw
    try: hdr, cols = trb.from_json_text(txt)
    except (AssertionError, IndexError, TypeError) as ex: print(m, 'KEPT as JSON (%r)' % ex); continue
    out = os.path.join(data, 'room-%s.gz.wasm.trb' % m); trb.write(out, hdr, cols)
    # check: decode the file and compare every spot with the JSON ones (exact float32 values)
    h2, C = trb.decode(gzip.decompress(open(out, 'rb').read())); n = h2['n']
    dec = json.JSONDecoder(); k = txt.index('"spots":['); i = k + len('"spots":['); bad = 0; j = 0; B = 50000
    batch = []
    def check(batch, j0):
        global bad
        got = trb.spots_from(h2, C, range(j0, j0 + len(batch)))
        for s, g in zip(batch, got):
            same = all((np.float32(a) == np.float32(b)) if isinstance(a, float) or isinstance(b, float) else a == b for a, b in zip(s[:15], g[:15])) and s[15] == g[15]
            if not same: bad += 1
    while True:
        while txt[i] in ' \n,': i += 1
        if txt[i] == ']': break
        s, i = dec.raw_decode(txt, i); batch.append(s)
        if len(batch) == B: check(batch, j); j += B; batch = []
    if batch: check(batch, j); j += len(batch)
    if bad or j != n: print(m, 'MISMATCH', bad, j, n); os.remove(out); continue
    for f in names: os.remove(os.path.join(data, f))
    os.replace(out, os.path.join(data, 'room-%s.gz.wasm' % m)); e.pop('parts', None); e['bytes'] = os.path.getsize(os.path.join(data, 'room-%s.gz.wasm' % m))
    print(m, '%d spots, %.1f MB -> %.1f MB, every spot identical' % (n, len(gz) / 1e6, e['bytes'] / 1e6), flush=True)
    json.dump(idx, open(idxf, 'w'), indent=1)
