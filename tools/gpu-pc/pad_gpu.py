# pad_gpu.py -- builds and runs the pad-clip GPU scan (E:\banjo\work\padscan: padscan.cu + bkcol_port.h + pj\<job>\room.bin, spots.txt, dirs.txt)
# for PAL and NTSC. Output: pj\<job>\out-<ver>.txt, progress-<ver>.txt; summary in E:\banjo\work\padscan\summary.txt
import os, subprocess, sys, time
D = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'work', 'padscan'))
NV = r'"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8\bin\nvcc.exe" -O3 -arch=sm_89 -fmad=false -prec-div=true -prec-sqrt=true -ftz=false -allow-unsupported-compiler -D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH'
os.chdir(D)
vers = (sys.argv[1] if len(sys.argv) > 1 else 'pal,ntsc').split(',')
only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
for v in vers:
    exe = 'padscan_%s.exe' % v
    if not os.path.exists(exe) or os.path.getmtime('padscan.cu') > os.path.getmtime(exe):
        rate = '60' if v == 'ntsc' else '50'
        open('build_%s.cmd' % v, 'w').write('@echo off\ncd /d %~dp0\ncall "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\n' + NV + ' -DBK_RATE=' + rate + ' -o ' + exe + ' padscan.cu > build_' + v + '.log 2>&1\necho exit %errorlevel% >> build_' + v + '.log\n')
        subprocess.run(['cmd', '/c', os.path.join(D, 'build_%s.cmd' % v)]); print(open('build_%s.log' % v).read()[-800:], flush=True)
jobs = [j.strip() for j in open('pj/jobs.txt') if j.strip()]
summ = open('summary.txt', 'a')
for j in jobs:
    if only and j not in only: continue
    for v in vers:
        jd = os.path.join(D, 'pj', j); env = dict(os.environ, PS_HMIN='60', PS_HSTEP='0.25', PS_NH='0' if j.endswith('f') else '2600', PS_NP='32')
        t = time.time(); subprocess.run([os.path.join(D, 'padscan_%s.exe' % v), 'room.bin', 'spots.txt', 'dirs.txt', 'out-%s.txt' % v, 'progress-%s.txt' % v], cwd=jd, env=env)
        last = [l for l in open(os.path.join(jd, 'progress-%s.txt' % v)) if 'spots |' in l]
        line = '%-6s %-4s %s (%.0f s)' % (j, v, last[-1].strip() if last else 'NO OUTPUT', time.time() - t)
        print(line, flush=True); summ.write(line + '\n'); summ.flush()
