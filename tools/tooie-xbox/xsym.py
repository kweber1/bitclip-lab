# Claude 2026-11-12 (xsym.py): print a 360 function's float data flow symbolically (one line per store / compare / call / branch),
# so its operation order can be compared with the N64 port. Linear walk: expressions are reset at branch targets.
import sys, re, xfun
FOPS = {'fadds': '+', 'fsubs': '-', 'fmuls': '*', 'fdivs': '/', 'fadd': '+', 'fsub': '-', 'fmul': '*', 'fdiv': '/'}
def run(a, show_all=False):
    f = xfun.func_of(a); ins = xfun.dis(*f) if f else xfun.leaf(a, 2000)
    targets = set()
    for i in ins:
        if i.mnemonic.startswith('b') and i.op_str and '0x' in i.op_str.split(',')[-1]:
            try: targets.add(int(i.op_str.split(',')[-1].strip(), 16))
            except ValueError: pass
    F = {}; G = {}; lis = {}
    def fr(r): return F.get(r, r)
    def gr(r): return G.get(r, r)
    for i in ins:
        m, op = i.mnemonic, i.op_str; p = [x.strip() for x in op.split(',')] if op else []
        if i.address in targets: print('L%X:' % i.address); F = {}  # join point: forget float values
        def mem(s):
            off, base = s[:-1].split('('); b = gr(base); o = int(off, 0)
            if base in lis: return 'C[%X]=%g' % ((lis[base] + o) & 0xFFFFFFFF, xfun.f32((lis[base] + o) & 0xFFFFFFFF))
            return '%s[%s]' % (b, hex(o))
        if m == 'lis': lis[p[0]] = int(p[1], 0) << 16; G[p[0]] = 'hi'; continue
        if m in ('lfs', 'lfd'): F[p[0]] = mem(p[1]); continue
        if m in ('lfsx',): F[p[0]] = '%s[%s]' % (gr(p[1]), gr(p[2])); continue
        if m in ('stfs', 'stfd'): print('  %X  %s = %s' % (i.address, mem(p[1]), fr(p[0]))); continue
        if m == 'stfsx': print('  %X  %s[%s] = %s' % (i.address, gr(p[1]), gr(p[2]), fr(p[0]))); continue
        if m in FOPS: F[p[0]] = '(%s %s %s)' % (fr(p[1]), FOPS[m], fr(p[2])); continue
        if m in ('fmadds', 'fmadd'): F[p[0]] = 'FMA(%s*%s + %s)' % (fr(p[1]), fr(p[2]), fr(p[3])); continue
        if m in ('fmsubs', 'fmsub'): F[p[0]] = 'FMA(%s*%s - %s)' % (fr(p[1]), fr(p[2]), fr(p[3])); continue
        if m in ('fnmsubs', 'fnmsub'): F[p[0]] = 'FMA(-(%s*%s - %s))' % (fr(p[1]), fr(p[2]), fr(p[3])); continue
        if m in ('fnmadds', 'fnmadd'): F[p[0]] = 'FMA(-(%s*%s + %s))' % (fr(p[1]), fr(p[2]), fr(p[3])); continue
        if m == 'fneg': F[p[0]] = '-%s' % fr(p[1]); continue
        if m == 'fabs': F[p[0]] = '|%s|' % fr(p[1]); continue
        if m == 'fmr': F[p[0]] = fr(p[1]); continue
        if m == 'frsp': F[p[0]] = fr(p[1]); continue
        if m == 'fsqrts': F[p[0]] = 'sqrt(%s)' % fr(p[1]); continue
        if m == 'fcfid': F[p[0]] = 'i2f(%s)' % fr(p[1]); continue
        if m in ('fctiwz', 'fctidz'): F[p[0]] = 'f2i(%s)' % fr(p[1]); continue
        if m == 'fsel': F[p[0]] = 'SEL(%s>=0?%s:%s)' % (fr(p[1]), fr(p[2]), fr(p[3])); continue
        if m == 'fcmpu' or m == 'fcmpo': print('  %X  cmp %s : %s  -> %s' % (i.address, fr(p[1]), fr(p[2]), p[0])); continue
        if m == 'mr': G[p[0]] = gr(p[1]); continue
        if m == 'addi' and len(p) == 3:
            if p[1] in lis: lis[p[0]] = (lis[p[1]] + int(p[2], 0)) & 0xFFFFFFFF
            G[p[0]] = '%s+%s' % (gr(p[1]), p[2]); continue
        if m == 'bl':
            t = int(op, 16); print('  %X  CALL %X (r3=%s r4=%s r5=%s r6=%s f1=%s f2=%s f3=%s)' % (i.address, t, gr('r3'), gr('r4'), gr('r5'), gr('r6'), fr('f1'), fr('f2'), fr('f3')))
            for r in ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12', 'f13']: F.pop(r, None)
            F['f1'] = 'ret%X' % t; G['r3'] = 'ret%X' % t; continue
        if m.startswith('b') or m.startswith('f') or show_all:
            print('  %X  %s %s' % (i.address, m, op))
        if m in ('lwz', 'lhz', 'lha', 'lbz', 'li', 'add', 'subf', 'rlwinm', 'mulli', 'lwzx', 'lhzx', 'lhax'):
            if p: G[p[0]] = '%s(%s)' % (m, ','.join(gr(x) if not '(' in x else x for x in p[1:]))
if __name__ == '__main__':
    run(int(sys.argv[1], 16), '-all' in sys.argv)
