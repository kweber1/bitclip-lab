# Claude 2026-11-11 (tooie_every_run.py v6): EXHAUSTIVE Banjo-Tooie bit-clip census, phase A (every crack float except |coord| < 1 on
# a seam's long axis; phase B skipped at the user's request), with the build chosen by the v5 benchmark (v8: test8\tcensus_ex8.exe,
# byte-identical on three finished levels and on every finished level's crack scan). Between levels it runs bench requests with the
# graphics card to itself: tcol\bench\request.txt, one command per line:
#   BUILD <name> <file.cu>                     build bench\<name>.exe (same nvcc flags)
#   RUN <name> <room> [KEY=VAL ...]            time bench\<name>.exe (or 'census' = the current build) on a finished level, check it
#                                              byte for byte against out_every\tc-<room>.txt
#   CRACK <name>                               crack scan only (TC_CRACKONLY=1) on every finished level vs their per-seam crack counts
#   USE <name>                                 switch the census to bench\<name>.exe if all its RUN/CRACK lines in this request matched
# results go to progress.txt; the request is renamed request-<time>.done. Output tcol\out_every\tc-<room>.txt. No console windows.
import os, subprocess, sys, time, json, shutil
D = r'E:\banjo\research\bitclip-lab\tooie\tcol'; os.chdir(D); NOWIN = 0x08000000; OUT = os.path.join(D, 'out_every'); B = os.path.join(D, 'bench'); os.makedirs(B, exist_ok=True)
NV = r'"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8\bin\nvcc.exe" -O3 -arch=sm_89 -fmad=false -prec-div=true -prec-sqrt=true -ftz=false -allow-unsupported-compiler -D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH'
def log(s): l = time.strftime('%H:%M:%S ') + s; print(l, flush=True); open(os.path.join(OUT, 'progress.txt'), 'a').write(l + '\n')
ps2 = "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*tooie_every_run*' -and $_.ProcessId -ne %d } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }" % os.getpid()
log('v6 driver: stopped previous driver: ' + subprocess.run(['powershell', '-NoProfile', '-Command', ps2], capture_output=True, text=True, creationflags=NOWIN).stdout.strip().replace('\n', ' '))
for im in ('tcensus_ex.exe', 'tcensus_ex6.exe', 'tcensus_ex7.exe', 'tcensus_ex8.exe'): subprocess.run(['taskkill', '/F', '/IM', im], capture_output=True, creationflags=NOWIN)
time.sleep(3)
EXE = os.path.join(D, 'test8', 'tcensus_ex8.exe')
if not os.path.exists(EXE): EXE = os.path.join(D, 'tcensus_ex.exe')
log('census build: ' + EXE)
def run(exe, room, out, extra=None):
    env = dict(os.environ, TC_EVERY='1', TC_ZEROPART='2', **(extra or {})); t = time.time()
    r = subprocess.run([exe, os.path.join('rooms', room + '.txt'), out], env=env, stdout=subprocess.DEVNULL, stderr=open(out + '.log', 'w'), creationflags=NOWIN)
    return r.returncode, time.time() - t, open(out + '.log', errors='replace').read()
def bench():
    global EXE
    rq = os.path.join(B, 'request.txt')
    if not os.path.exists(rq): return
    lines = [l.split() for l in open(rq).read().split('\n') if l.strip() and not l.startswith('#')]; os.replace(rq, os.path.join(B, 'request-%s.done' % time.strftime('%H%M%S')))
    ok = {}
    for p in lines:
        try:
            if p[0] == 'BUILD':
                name, cu = p[1], p[2]; cmd = os.path.join(B, 'build-%s.cmd' % name); bl = os.path.join(B, 'build-%s.log' % name)
                open(cmd, 'w').write('@echo off\ncd /d %s\ncall "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\n' % D + NV + ' %s -o bench\\%s.exe %s > %s 2>&1\necho exit %%errorlevel%% >> %s\n' % (' '.join(p[3:]), name, cu, bl, bl))
                subprocess.run(['cmd', '/c', cmd], creationflags=NOWIN); log('bench build %s: %s' % (name, open(bl, errors='replace').read()[-300:].replace('\n', ' | ')))
            elif p[0] == 'RUN':
                name, room = p[1], p[2]; exe = EXE if name == 'census' else os.path.join(B, name + '.exe'); extra = dict(kv.split('=', 1) for kv in p[3:])
                out = os.path.join(B, '%s-%s.txt' % (name, room)); rc, dt, lg = run(exe, room, out, extra)
                same = rc == 0 and os.path.exists(out) and open(out).read().split('\n')[1:] == open(os.path.join(OUT, 'tc-%s.txt' % room)).read().split('\n')[1:]
                ok[name] = ok.get(name, True) and same
                tl = [l for l in lg.split('\n') if 'time:' in l or 'kernels' in l]
                log('bench %s %s %s: %s, %.1f s | %s' % (name, room, ' '.join(p[3:]), 'IDENTICAL' if same else 'DIFFERENT rc %d' % rc, dt, ' | '.join(tl)[-400:]))
            elif p[0] == 'CRACK':
                name = p[1]; exe = EXE if name == 'census' else os.path.join(B, name + '.exe'); tt = time.time(); allok = True; nchk = 0
                for f in sorted(os.listdir(OUT)):
                    if not (f.startswith('tc-') and f.endswith('.txt')): continue
                    room = f[3:-4]; out = os.path.join(B, 'crack-%s-%s.txt' % (name, room)); rc, dt, lg = run(exe, room, out, {'TC_CRACKONLY': '1'}); nchk += 1
                    want = [l for l in open(os.path.join(OUT, f)) if l.startswith('SEAM ')]; got = [l for l in open(out) if l.startswith('SEAM ')] if os.path.exists(out) else []
                    if got != want: allok = False; log('bench crack %s %s: DIFFERENT' % (name, room))
                ok[name] = ok.get(name, True) and allok; log('bench crack %s against %d finished levels: %s, %.1f min' % (name, nchk, 'ALL IDENTICAL' if allok else 'MISMATCH', (time.time() - tt) / 60))
            elif p[0] == 'USE':
                name = p[1]
                if ok.get(name): EXE = os.path.join(B, name + '.exe'); log('census now uses ' + EXE)
                else: log('not switching to %s (not verified identical in this request)' % name)
        except Exception as ex: log('bench line %s: error %r' % (' '.join(p), ex))
bench()
idx = {e['map']: e for e in json.load(open('rooms-index.json'))}
ww = [m for m in ('0xD6', '0xE7', '0xEA', '0xEB', '0xDD', '0xE1', '0xE2', '0xE3', '0xE4', '0xE6', '0xEC', '0xF9') if m in idx]
order = sys.argv[1:] or (ww + sorted([m for m in idx if m not in ww], key=lambda m: idx[m]['tris']))
phase = 'A (every float except |coord| < 1)'; log('exhaustive census phase %s start: %d rooms' % (phase, len(order)))
for m in order:
    out = os.path.join(OUT, 'tc-%s.txt' % m)
    if os.path.exists(out): continue
    bench()
    t = time.time(); lgf = os.path.join(OUT, 'log-%s.txt' % m)
    r = subprocess.run([EXE, os.path.join('rooms', m + '.txt'), out + '.part'], env=dict(os.environ, TC_EVERY='1', TC_ZEROPART='2'), stdout=subprocess.DEVNULL, stderr=open(lgf, 'w'), creationflags=NOWIN)
    if r.returncode == 0 and os.path.exists(out + '.part'): os.replace(out + '.part', out)
    log('%s %s: rc %d, %.1f min | %s' % (m, idx[m]['name'], r.returncode, (time.time() - t) / 60, open(lgf).read().strip().replace('\n', ' | ')[-300:]))
bench()
log('exhaustive census phase %s ALLDONE' % phase)
