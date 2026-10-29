#!/usr/bin/env python3
"""
PAL console (SummerCart64) tests for the 260 note door (MAP 0x71, Statue Room): can a human action put one long
(3-VI) game update on a census crack hold at the moment the bit-clip needs it?

Needs the PAL agent v6 ROM (BK-Snapper-PAL-Practice-SC64-v6.z64, built from tools/sc64-260/agent/sc64pal-v6.c) running
in game, and these files from E:\\banjo\\mods\\sc64-crack-brute next to it: sc64_crack_brute.py, sc64_pal765b.py,
sc64_pal_v3.py, sc64_pal_viewsurvey.py. Spots and clip windows come from cases-260.json (clipsetup-cli.js).

Each try (agent K_TEST, same as the 765 runs): Banjo native-placed on the pre spot, origin x/z written (DIAGNOSTIC),
the action inputs, origin written again, 2 updates, B 2 VI, A held J VI. Every update is logged with its raw VI
(hook interval) and the game's own frame time (game dt). Only game dt >= 3 counts as a real long update (a hook
interval of 3 then 1 with game dt 2 is controller-read jitter, see claude/765-pal-console-lag-20261024.md).

  python sc64_pal260.py --plan base                      # baseline cadence at every spot (frame-boundary map)
  python sc64_pal260.py --plan cam   --spots 1 --facings 0,90,180,270
  python sc64_pal260.py --plan anim  --spots 1
  python sc64_pal260.py --plan phase --spots 1
  python sc64_pal260.py --plan eggs  --spots 1
  python sc64_pal260.py --plan force --spots 1 --facings 0  # DIAGNOSTIC positive control: one forced 3-frame update from B+k
  python sc64_pal260.py --plan custom --styles "c:0-3-CU/50-3-CU@60" --spots 1
Results: sc64-pal260-<plan>\\results.csv (+ traces\\ for every held try that had a real long update or clipped).
"""
import argparse, csv, json, os, sys, time
import sc64_pal765b as P
import sc64_pal_v3 as V
import sc64_pal_viewsurvey as VS
from sc64_crack_brute import b2f, f2b, f32, parse_list

HERE = os.path.dirname(os.path.abspath(__file__))
MAP, ENTRY, DOOR_FLAG = 0x71, 1, 0x3C          # Statue Room, entry 1 = higher exit (260-door side), FILEPROG_3C 260 open
LEARNED = 0x8037CD70                           # PAL learned-abilities word
F_FORCE = 16                                   # v6: job[53] = VI after B, job[54] = frames (3 = the 0.06 s cap)
A, B, Z, CU, CD, CL, CR, R = 0x8000, 0x4000, 0x2000, 8, 4, 2, 1, 0x10
P.BTN['R'] = R


# ------------------------------------------------------------------ styles: (segments, act_len); B comes act_len+2 VI after the action start
def tap(btn, t):                    # one 3-VI press t VI after B (B at VI 2 when act_len = 0)
    return ([(2 + t, 3, btn)], 0)


def zoom(n, wait):                  # standing C-Down presses before the punch (camera zoom state)
    seg = [(i * 30, 3, CD) for i in range(n)]
    return seg, n * 30 + wait


def fp(k, w, turn=0, sx=0):         # first person in, (stick turn for `turn` VI), out after k VI, wait w
    seg = [(0, 3, CU)]
    if turn: seg.append((50, turn, ((sx & 0xFF) << 24)))
    seg.append((3 + k, 3, CU))
    return seg, 3 + k + 3 + w


def crouch(hold, wait):             # Z crouch for `hold` VI, release, stand up, wait (stand-up animation timing)
    return [(0, hold, Z)], hold + wait


def eggs(n, back, gap=8, wait=30):  # n eggs forward (C-Up) or back (C-Down) from a crouch (max 14 per job: 16 segments)
    return P.eggs(n, back, gap=gap, wait=wait)


def build_styles(plan, window):
    S = {}
    if plan in ('base',):
        S['base'] = ([], 0)
    if plan == 'cam':
        lo, hi = (window[0] - 12, window[1] + 2) if window else (20, 48)
        for t in range(max(0, lo), hi + 1, 2):           # taps that land before / on the needed long update
            S['camL_t%d' % t] = tap(CL, t); S['camR_t%d' % t] = tap(CR, t); S['R_t%d' % t] = tap(R, t)
            S['zoomCD_t%d' % t] = tap(CD, t)
        for n in (1, 2):
            for w in (10, 30, 60):
                S['zoom%d_w%d' % (n, w)] = zoom(n, w)
        for k in (50, 70):                               # first person needs ~50 VI to zoom in before C-Up/B are read
            for w in (0, 6, 12, 20, 30):
                S['fp_k%d_w%d' % (k, w)] = fp(k, w)
            for sx in (127, -128):
                S['fp_k%d_turn%s' % (k, 'R' if sx > 0 else 'L')] = fp(k + 20, 4, turn=16, sx=sx)
    if plan == 'anim':
        for d in range(0, 121, 4):                       # idle time before B (idle animation phase / reload)
            S['idle_d%d' % d] = ([], d)
        for h in (10, 30):
            for w in range(10, 61, 5):                   # crouch, release, B w VI later (stand-up animation)
                S['crouch%d_w%d' % (h, w)] = crouch(h, w)
    if plan == 'phase':
        for d in range(0, 8):                            # shift B by 0..7 VI against the 2-VI frame cadence
            S['shift_d%d' % d] = ([], d)
    if plan == 'eggs':
        for back in (False, True):
            for n in (1, 3, 8, 14):
                for gap in (6, 8):
                    for w in (15, 20, 30, 45, 60):
                        S['egg%s%d_g%d_w%d' % ('B' if back else 'F', n, gap, w)] = eggs(n, back, gap, w)
        for n in (3, 14):                                # zoomed out + laid eggs
            for w in (20, 40):
                seg, act = eggs(n, True, 8, w); S['zoom1_eggB%d_w%d' % (n, w)] = ([(0, 3, CD)] + [(s + 40, l, b) for s, l, b in seg], act + 40)
    return S


def load_cases(path):
    d = json.load(open(path))
    spots, wins = [], {}
    for c in d['cases']:
        key = c['spot']
        if key > len(spots):
            spots.extend([None] * (key - len(spots)))
        if spots[key - 1] is None:
            x, y, z = c['target']; spots[key - 1] = (f32(x), f32(z), float(y), '%.1f' % c['dist'])
        if c['kind'] == 'clip' and len(c['lagUpdates']) == 1 and c['cancelUpdate'] == 2:
            wins.setdefault(key, {}).setdefault(c['aHoldUpdates'], set()).add(c['lagVIfromB'][0])
    return spots, wins


def setup(port=None):
    link, ag, r = V.connect()
    t0 = time.time()
    while not (r and r['status'] == 1 and r['version'] >= 6 and r['mode'] == 3):
        if r and r['status'] == 1 and r['version'] < 6: sys.exit('agent v%d is running: upload BK-Snapper-PAL-Practice-SC64-v6.z64 and press Reset' % r['version'])
        if time.time() - t0 > 900: sys.exit('PAL agent v6 is not answering')
        time.sleep(1); r = ag.run([P.JOB_MAGIC, P.K_PING], timeout=3)
    print('agent v%d map %02X mode %d' % (r['version'], r['map'], r['mode']), flush=True)
    if r['map'] != MAP:
        r = ag.run([P.JOB_MAGIC, P.K_ROOM, 0, ENTRY, MAP, DOOR_FLAG], timeout=90)
        print('warp to 0x%02X entry %d (door flag 0x%02X cleared): %s' % (MAP, ENTRY, DOOR_FLAG, r and r['status']), flush=True)
        if not r or r['status'] != 1: sys.exit('could not reach the Statue Room')
    w = V.peek(ag, link, LEARNED, 1)                # FIXTURE: learned moves as the Practice ROM sets them (claw swipe = bit 4;
    if w and (w[0] & 0x1FFFFF) != 0x1FFFFF:          # without it B does nothing and the "punch cancel" is a plain jump)
        V.poke(ag, [(LEARNED, w[0] | 0x1FFFFF)]); print('learned moves %08X -> %08X (FIXTURE)' % (w[0], w[0] | 0x1FFFFF), flush=True)
    return link, ag


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--plan', default='base', choices=['base', 'cam', 'anim', 'phase', 'eggs', 'force', 'custom'])
    ap.add_argument('--cases', default=os.path.join(HERE, 'cases-260.json'))
    ap.add_argument('--styles'); ap.add_argument('--spots', default='1'); ap.add_argument('--facings', default='0,90,180,270')
    ap.add_argument('--holds', help='A held, in game updates (J = 2 x updates VI); default: the spot\'s single-lag clip holds')
    ap.add_argument('--repeat', type=int, default=2); ap.add_argument('--runmax', type=int, default=110)
    ap.add_argument('--port'); ap.add_argument('--out')
    a = ap.parse_args()
    spots, wins = load_cases(a.cases)
    link, ag = setup(a.port)
    out = os.path.join(HERE, a.out or 'sc64-pal260-' + a.plan); os.makedirs(os.path.join(out, 'traces'), exist_ok=True)
    res_path = os.path.join(out, 'results.csv'); new = not os.path.exists(res_path)
    fo = open(res_path, 'a', newline=''); wr = csv.writer(fo)
    if new:
        wr.writerow(['time', 'plan', 'style', 'spot', 'dist', 'facing', 'holdUpd', 'J', 'rep', 'window_VI', 'arrived', 'held_rel_B',
                     'miny', 'clip', 'long_gamedt_rel_B', 'long_in_window', 'hook_longs_rel_B', 'pattern_dvi', 'pattern_gamedt'])
    ntry = nclip = nwin = 0
    for si in parse_list(a.spots):
        sp = spots[si - 1]
        if sp is None: print('spot %d not in %s' % (si, a.cases)); continue
        sw = wins.get(si, {})
        holds = parse_list(a.holds) if a.holds else (sorted(sw) or [7])
        for facing in parse_list(a.facings):
            o = VS.origin(ag, sp, facing)
            if o: o = VS.calibrate(ag, sp, facing, o)
            if not o: print('spot %d facing %d: no exact origin' % (si, facing), flush=True); continue
            for h in holds:
                J = 2 * h; window = sorted(sw.get(h, ())) or None
                wlo, whi = (window[0], window[-1] + 2) if window else (None, None)
                if a.plan == 'force':
                    styles = {'force_k%d' % k: ([], 0, k) for k in range((wlo or 40) - 6, (whi or 48) + 7, 1)}
                elif a.plan == 'custom':
                    styles = {}
                    for s in (a.styles or '').split(','):
                        if s and P.add_custom(s): styles[s] = P.STYLES[s]
                else:
                    styles = build_styles(a.plan, (wlo, whi) if window else None)
                    if a.styles: styles = {k: v for k, v in styles.items() if k in a.styles.split(',')}
                for name, st in styles.items():
                    seg, act = st[0], st[1]
                    for rep in range(a.repeat):
                        w = V.test_words(sp, facing, o[0], o[1], J, a.runmax, seg, act, [])
                        if a.plan == 'force':                  # the first frame starting >= k VI after B gets 3 frames
                            w += [0] * (64 - len(w)); w[2] |= F_FORCE; w[52] = 0; w[53] = st[2]; w[54] = 3
                        r = ag.run(w, timeout=120)
                        if not r: print('  timeout', flush=True); continue
                        if r['status'] == 3: sys.exit('cancelled (Start)')
                        if r['status'] != 1: print('  status', P.STATUS.get(r['status']), flush=True); continue
                        tr, bv = r['trace'], r['b_vi']; rel = lambda t: t['v'] - bv
                        sxb, szb = f2b(sp[0]), f2b(sp[1])
                        arr = any(t['x'] == sxb and t['z'] == szb for t in tr[r['b_n']:])
                        held = [rel(t) for t in tr[r['b_n']:] if sp[2] - 115 < t['y'] < sp[2] - 20]
                        longs = [rel(t) for t in tr[1:] if t['dtvi'] >= 3]
                        hook = [rel(t) for t in tr[1:] if t['dvi'] >= 3]
                        inwin = [v for v in longs if wlo is not None and wlo <= v <= whi]
                        ntry += 1; nclip += r['clip']; nwin += bool(inwin)
                        wr.writerow([time.strftime('%H:%M:%S'), a.plan, name, si, sp[3], facing, h, J, rep,
                                     '%s-%s' % (wlo, whi) if window else '', int(arr), ' '.join(map(str, held)), '%.2f' % r['miny'],
                                     r['clip'], ' '.join(map(str, longs)), ' '.join(map(str, inwin)), ' '.join(map(str, hook)),
                                     ''.join(str(min(t['dvi'], 9)) for t in tr[1:]), ''.join(str(min(t['dtvi'], 9)) for t in tr[1:])])
                        fo.flush()
                        if held and (longs or r['clip']):
                            fn = '%s_s%02d_f%03d_h%d_r%d.csv' % (''.join(c if c.isalnum() or c in '-_' else '_' for c in name), si, facing, h, rep)
                            with open(os.path.join(out, 'traces', fn), 'w', newline='') as ft:
                                tw = csv.writer(ft); tw.writerow(['v_rel_B', 'x', 'y', 'z', 'dvi', 'game_dt', 'state', 'hits', 'btn'])
                                for t in tr: tw.writerow([rel(t), '%.6f' % b2f(t['x']), '%.4f' % t['y'], '%.6f' % b2f(t['z']),
                                                          t['dvi'], t['dtvi'], '%02X' % t['state'], t['hits'], t['btn']])
                        print('  %-16s s%d f%d h%d arrived %d held %s %s longs %s%s' % (name, si, facing, h, arr, ','.join(map(str, held)) or '-',
                              'CLIP' if r['clip'] else '', ' '.join(map(str, longs)) or '-', ' IN WINDOW' if inwin else ''), flush=True)
    print('DONE: %d tries, %d with a long update in the clip window, %d clips' % (ntry, nwin, nclip))


if __name__ == '__main__':
    main()
