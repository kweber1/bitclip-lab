"""260 door skip, console positive control of the RECOVERY (PAL SC64 agent v7).

Spot 1 punch cancel (B, A on update 2 held 9 updates = J 18). One forced 3-frame update from B+48 (DIAGNOSTIC: stands
in for the lag source, v6/v7 F_FORCE) sends Banjo through the floor; he lands "grounded" under it (y ~1130), drops into
the walk-off-ledge fall (state 0x20), and then:
    jump  A at action VI j (stick toward the door), held jl VI
    flutter A again at VI f, held until the Beak Buster
    Z (Beak Buster) at VI z  -> the snap-up puts him on the floor behind the closed door; stick held walks him into
    the loading zone (MAP 0x6E).
BizHawk (bk_pal260_probe.lua): j 72 jl 22 f 98 z 128-136, stick (50,115) -> MAP 0x6E. Needs agent v7 (v6 drops the stick).
Action VI = VI since the action phase; B is at VI 2.
Usage: python sc64_pal260_rec.py [--sticks 50:115,75:103,25:125] [--zs 130,134] [--facings 0]
"""
import argparse, os, sys, time, csv
import sc64_pal765b as P
import sc64_pal_v3 as V
import sc64_pal_viewsurvey as VS
from sc64_crack_brute import b2f, f2b, f32, parse_list
import sc64_pal260 as K

HERE = os.path.dirname(os.path.abspath(__file__))
MAPA = 0x80383fb4
A, Z = 0x8000, 0x2000


def seg(btn, sx, sy): return btn | ((sx & 0xFF) << 24) | ((sy & 0xFF) << 16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sticks', default='50:115,75:103,25:125,0:127,90:90')
    ap.add_argument('--zs', default='130,134'); ap.add_argument('--j', type=int, default=72); ap.add_argument('--jl', type=int, default=22)
    ap.add_argument('--f', type=int, default=98); ap.add_argument('--facings', default='0'); ap.add_argument('--force', type=int, default=48)
    ap.add_argument('--repeat', type=int, default=1)
    a = ap.parse_args()
    link, ag = K.setup()
    r = ag.run([P.JOB_MAGIC, P.K_PING], timeout=5)
    if r['version'] < 7: sys.exit('agent v%d: upload BK-Snapper-PAL-Practice-SC64-v7.z64 (v6 drops the stick)' % r['version'])
    spots, _ = K.load_cases(os.path.join(HERE, 'cases-260.json')); sp = spots[0]
    out = os.path.join(HERE, 'sc64-pal260-rec'); os.makedirs(out, exist_ok=True)
    fo = open(os.path.join(out, 'results.csv'), 'a', newline=''); wr = csv.writer(fo)
    for facing in parse_list(a.facings):
        o = VS.origin(ag, sp, facing)
        if o: o = VS.calibrate(ag, sp, facing, o)
        if not o: print('no origin for facing', facing); continue
        for st in a.sticks.split(','):
            sx, sy = map(int, st.split(':'))
            for z in parse_list(a.zs):
                for rep in range(a.repeat):
                    m = V.peek(ag, link, MAPA, 1)
                    if not m or (m[0] & 0xFF) != K.MAP:
                        r = ag.run([P.JOB_MAGIC, P.K_ROOM, 0, K.ENTRY, K.MAP, K.DOOR_FLAG], timeout=90)
                        V.poke(ag, [(K.LEARNED, 0x1FFFFF)])
                    segs = [(a.j, 330, seg(0, sx, sy)), (a.j, a.jl, seg(A, sx, sy)), (a.f, z - a.f, seg(A, sx, sy)), (z, 3, seg(Z, sx, sy))]
                    w = V.test_words(sp, facing, o[0], o[1], 18, 400, segs, 0, [])
                    w += [0] * (64 - len(w)); w[2] |= K.F_FORCE; w[52] = 0; w[53] = a.force; w[54] = 3
                    r = ag.run(w, timeout=150)
                    if not r or r['status'] != 1: print('status', r and r['status']); continue
                    tr, bv = r['trace'], r['b_vi']
                    pts = [(t['v'] - bv + 2, b2f(t['x']), t['y'], b2f(t['z']), t['state'], t['dtvi']) for t in tr]
                    pop = next(((v, x, zz) for v, x, y, zz, s, d in pts if v > 60 and y >= 1249), None)
                    mn = min((y for v, x, y, zz, s, d in pts if v > 50), default=0)
                    time.sleep(2); m = V.peek(ag, link, MAPA, 1); mp = (m[0] & 0xFF) if m else -1
                    longs = [v for v, x, y, zz, s, d in pts if d >= 3]
                    ok = mp == 0x6E
                    print('facing %d stick %d,%d z %d: crossing miny %.1f pop %s map %02X %s longs %s' % (facing, sx, sy, z, mn,
                          pop and '(%.0f,%.0f)@%d' % (pop[1], pop[2], pop[0]), mp, 'SKIP!' if ok else '', longs), flush=True)
                    wr.writerow([time.strftime('%H:%M:%S'), facing, sx, sy, a.j, a.jl, a.f, z, a.force, '%.1f' % mn,
                                 pop and '%.0f' % pop[1], pop and '%.0f' % pop[2], '%02X' % mp, int(ok), ' '.join(map(str, longs))]); fo.flush()
                    with open(os.path.join(out, 'trace_f%d_s%d_%d_z%d_r%d.csv' % (facing, sx, sy, z, rep)), 'w') as ft:
                        ft.write('v_act,x,y,z,state,game_dt\n')
                        for p in pts: ft.write('%d,%.2f,%.2f,%.2f,%02X,%d\n' % p)


if __name__ == '__main__':
    main()
