# Claude 2026-11-11 (tooie_census_run.py): Banjo-Tooie bit-clip census on the graphics card, every room (or the ones given).
# Builds E:\banjo\research\bitclip-lab\tooie\tcol\tcensus.exe (CUDA 11.8 + MSVC 2022, no FMA) if needed, checks it against the CPU
# build's output on 3 seams of GI Basement (selftest-expected.txt), then runs tcensus.exe on every room text in tcol\rooms\
# (GI Basement 0x10F first, then smallest first). Output tcol\out\tc-<room>.txt; finished rooms are skipped. No console windows.
# usage: python tooie_census_run.py [rooms...]
import os, subprocess, sys, time, json
D = r'E:\banjo\research\bitclip-lab\tooie\tcol'; os.chdir(D); NOWIN = 0x08000000; os.makedirs('out', exist_ok=True)
NV = r'"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8\bin\nvcc.exe" -O3 -arch=sm_89 -fmad=false -prec-div=true -prec-sqrt=true -ftz=false -allow-unsupported-compiler -D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH'
def log(s): l = time.strftime('%H:%M:%S ') + s; print(l, flush=True); open(os.path.join('out', 'progress.txt'), 'a').write(l + '\n')
src = [os.path.getmtime(f) for f in ('tcensus.cu', 'tcol.h', 'troom.h')]
if not os.path.exists('tcensus.exe') or max(src) > os.path.getmtime('tcensus.exe'):
    open('build.cmd', 'w').write('@echo off\ncd /d %~dp0\ncall "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\n' + NV + ' -o tcensus.exe tcensus.cu > build.log 2>&1\necho exit %errorlevel% >> build.log\n')
    subprocess.run(['cmd', '/c', os.path.join(D, 'build.cmd')], creationflags=NOWIN); log('build: ' + open('build.log').read()[-600:].replace('\n', ' | '))
t = time.time(); r = subprocess.run([os.path.join(D, 'tcensus.exe'), r'rooms\0x10F.txt', r'out\selftest.txt', '3'], stdout=subprocess.DEVNULL, stderr=open(r'out\selftest-log.txt', 'w'), creationflags=NOWIN); r.stderr = open(r'out\selftest-log.txt').read()
got = open(r'out\selftest.txt').read().split('\n')[1:] if os.path.exists(r'out\selftest.txt') else []; want = open('selftest-expected.txt').read().split('\n')[1:]
ok = got == want; log('selftest (GPU vs CPU build, 3 seams of 0x10F): %s, %.1f s; %s' % ('IDENTICAL' if ok else 'DIFFERENT (%d vs %d lines)' % (len(got), len(want)), time.time() - t, r.stderr[-300:].replace('\n', ' | ')))
if not ok:
    n = sum(1 for a, b in zip(got, want) if a != b); log('  %d differing lines; first: %s' % (n, next(((a, b) for a, b in zip(got, want) if a != b), None))); sys.exit(1)
idx = {e['map']: e for e in json.load(open('rooms-index.json'))}
order = sys.argv[1:] or (['0x10F'] + sorted([m for m in idx if m != '0x10F'], key=lambda m: idx[m]['tris']))
log('census start: %d rooms' % len(order))
for m in order:
    out = os.path.join('out', 'tc-%s.txt' % m)
    if os.path.exists(out): continue
    t = time.time(); lgf = os.path.join('out', 'log-%s.txt' % m); r = subprocess.run([os.path.join(D, 'tcensus.exe'), os.path.join('rooms', m + '.txt'), out + '.part'], stdout=subprocess.DEVNULL, stderr=open(lgf, 'w'), creationflags=NOWIN); r.stderr = open(lgf).read()
    if r.returncode == 0 and os.path.exists(out + '.part'): os.replace(out + '.part', out)
    log('%s %s: rc %d, %.1f min | %s' % (m, idx[m]['name'], r.returncode, (time.time() - t) / 60, r.stderr.strip().replace('\n', ' | ')[-400:]))
log('census ALLDONE')
