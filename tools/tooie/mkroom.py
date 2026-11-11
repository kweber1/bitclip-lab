# Claude 2026-11-11: room json (bt_rooms.py) -> plain-text room for tcol (original Tooie triangle flags)
import json, sys
r = json.load(open(sys.argv[1])); out = []
for k in ('opa', 'xlu'):
    m = r[k]
    if not m: out.append('NOMODEL'); continue
    c = m['collision']; h = c['header']
    out.append('MODEL %d %d %d %d %s' % (len(m['vertices']), len(c['triangles']), len(c['cells']), m['vertex_header'][11] if 'tooie_vertex_header' not in m else m['tooie_vertex_header'][10], ' '.join(map(str, h))))
    out += ['%d %d %d' % tuple(v) for v in m['vertices']]
    out += ['%d %d %d %d' % (t[0], t[1], t[2], t[5]) for t in c['triangles']]
    out += ['%d %d' % tuple(x) for x in c['cells']]
open(sys.argv[2], 'w').write('\n'.join(out) + '\n')
