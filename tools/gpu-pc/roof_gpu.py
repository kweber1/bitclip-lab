# roof_gpu.py -- builds and runs the roof-crack census + roof clip test (roofscan.cu) for every map, PAL and NTSC.
# Files in E:\banjo\work\roofscan: roofscan.cu, bkcol_port.h, rj\<map>\room.bin + seams.txt, rj\jobs.txt. Output rj\<map>\out-<ver>.txt
import os, subprocess, sys, time
D = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'work', 'roofscan'))
NV = r'"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8\bin\nvcc.exe" -O3 -arch=sm_89 -fmad=false -prec-div=true -prec-sqrt=true -ftz=false -allow-unsupported-compiler -D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH'
os.chdir(D)
vers = (sys.argv[1] if len(sys.argv) > 1 else 'pal,ntsc').split(',')
for v in vers:
    exe = 'roofscan_%s.exe' % v
    if not os.path.exists(exe) or os.path.getmtime('roofscan.cu') > os.path.getmtime(exe):
        rate = '60' if v == 'ntsc' else '50'
        open('build_%s.cmd' % v, 'w').write('@echo off\ncd /d %~dp0\ncall "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\n' + NV + ' -DBK_RATE=' + rate + ' -o ' + exe + ' roofscan.cu > build_' + v + '.log 2>&1\necho exit %errorlevel% >> build_' + v + '.log\n')
        subprocess.run(['cmd', '/c', os.path.join(D, 'build_%s.cmd' % v)]); print(open('build_%s.log' % v).read()[-600:], flush=True)
summ = open('summary.txt', 'a')
for j in [j.strip() for j in open('rj/jobs.txt') if j.strip()]:
    for v in vers:
        jd = os.path.join(D, 'rj', j); t = time.time()
        subprocess.run([os.path.join(D, 'roofscan_%s.exe' % v), 'room.bin', 'seams.txt', 'out-%s.txt' % v, 'progress-%s.txt' % v], cwd=jd)
        last = [l.strip() for l in open(os.path.join(jd, 'progress-%s.txt' % v)) if l.startswith('roof cracks')]
        line = '%-5s %-4s %s (%.0f s)' % (j, v, last[-1] if last else 'NO OUTPUT', time.time() - t); print(line, flush=True); summ.write(line + '\n'); summ.flush()
