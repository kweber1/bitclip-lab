# Claude 2026-11-12 (xfun.py): Banjo-Tooie XBLA (Banjo2_CPR.exe) analysis helpers over the loaded image (image.bin, VA - 0x82000000):
# functions from .pdata, call graph (bl), float constants each function loads (lis + lfs/lfd pairs), disassembly.
import struct, sys, bisect, capstone, pickle, os
D = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'image.bin'), 'rb').read(); BASE = 0x82000000
md = capstone.Cs(capstone.CS_ARCH_PPC, capstone.CS_MODE_32 | capstone.CS_MODE_BIG_ENDIAN); md.detail = False
P0, PN = 0x82080400, 0x1ddf8
funcs = []
for o in range(P0 - BASE, P0 - BASE + PN, 8):
    b, x = struct.unpack_from('>II', D, o)
    if b == 0: continue
    n = (x >> 8) & 0x3FFFFF; funcs.append((b, b + n * 4))
funcs = sorted(set(funcs)); starts = [f[0] for f in funcs]
def func_of(a):
    i = bisect.bisect_right(starts, a) - 1
    return funcs[i] if i >= 0 and funcs[i][0] <= a < funcs[i][1] else None
def dis(lo, hi): return list(md.disasm(D[lo - BASE:hi - BASE], lo))
def u32(a): return struct.unpack_from('>I', D, a - BASE)[0]
def f32(a): return struct.unpack_from('>f', D, a - BASE)[0]
def analyze(f):
    """calls, float consts (addr, value), fp op counts"""
    calls, consts, fops = [], [], {}
    lis = {}
    for i in dis(*f):
        m, op = i.mnemonic, i.op_str
        if m == 'bl': calls.append(int(op.split()[-1], 16) if op.startswith('0x') else int(op, 16))
        elif m == 'lis':
            r, v = op.split(', '); lis[r] = int(v, 0) << 16
        elif m in ('lfs', 'lfd') and '(' in op:
            reg, mem = op.split(', ', 1); off, base = mem[:-1].split('(')
            if base in lis:
                off = int(off, 0); a = (lis[base] + off) & 0xFFFFFFFF
                if lis[base] & 0x8000 and False: pass
                if BASE <= a < BASE + len(D): consts.append((a, f32(a) if m == 'lfs' else struct.unpack_from('>d', D, a - BASE)[0]))
        elif m == 'addi':
            p = op.split(', ')
            if len(p) == 3 and p[1] in lis:
                try: lis[p[0]] = (lis[p[1]] + int(p[2], 0)) & 0xFFFFFFFF
                except ValueError: pass
        if m.startswith('f') or m.startswith('fn'): fops[m] = fops.get(m, 0) + 1
    return calls, consts, fops
_cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'xfun.cache')
def graph():
    if os.path.exists(_cache): return pickle.load(open(_cache, 'rb'))
    G = {}
    for f in funcs: G[f[0]] = analyze(f)
    pickle.dump(G, open(_cache, 'wb')); return G
if __name__ == '__main__':
    G = graph(); cmd = sys.argv[1]
    callers = {}
    for a, (c, k, fo) in G.items():
        for t in c: callers.setdefault(t, set()).add(a)
    if cmd == 'info':
        for s in sys.argv[2:]:
            a = int(s, 16); f = func_of(a); c, k, fo = G[f[0]]
            print('%X-%X (%d instr) fp %s' % (f[0], f[1], (f[1] - f[0]) // 4, fo))
            print('   calls', ' '.join('%X' % t for t in c)); print('   callers', ' '.join('%X' % t for t in sorted(callers.get(f[0], ()))))
            print('   consts', ' '.join('%g' % v for _, v in k))
    elif cmd == 'const':   # functions loading a float constant value
        v = float(sys.argv[2]); tol = float(sys.argv[3]) if len(sys.argv) > 3 else 0
        for a, (c, k, fo) in sorted(G.items()):
            if any(abs(x - v) <= tol * max(1, abs(v)) for _, x in k): print('%X (%d instr) consts %s' % (a, (func_of(a)[1] - a) // 4, ' '.join('%g' % x for _, x in k)[:200]))
    elif cmd == 'range':
        lo, hi = int(sys.argv[2], 16), int(sys.argv[3], 16)
        for f in funcs:
            if lo <= f[0] < hi: c, k, fo = G[f[0]]; print('%X %4d fp%4d calls %s | consts %s' % (f[0], (f[1] - f[0]) // 4, sum(fo.values()), ' '.join('%X' % t for t in c)[:120], ' '.join('%g' % x for _, x in k)[:140]))
    elif cmd == 'dis':
        a = int(sys.argv[2], 16); f = func_of(a)
        for i in dis(*f): print('%X: %s %s' % (i.address, i.mnemonic, i.op_str))
def leaf(a, maxn=200):
    out = []
    for i in md.disasm(D[a - BASE:a - BASE + 4 * maxn], a):
        out.append(i)
        if i.mnemonic == 'blr': break
    return out
if __name__ == '__main__' and sys.argv[1] == 'leaf':
    for s in sys.argv[2:]:
        a = int(s, 16); print('== %X' % a)
        for i in leaf(a): print('  %X: %s %s' % (i.address, i.mnemonic, i.op_str))
