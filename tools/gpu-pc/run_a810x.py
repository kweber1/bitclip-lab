# a810x: every lag pattern (Markov-weighted, deep rule) for punch cancels. usage: run_a810x.py spots tag yaws thr [NB]
import subprocess, os, sys
D = r'E:\banjo\work\a810'; os.chdir(D)
spots, tag = sys.argv[1], sys.argv[2]; yaws = sys.argv[3].split(','); thr = sys.argv[4]; nb = sys.argv[5] if len(sys.argv) > 5 else '20'; mc = len(sys.argv) > 6 and sys.argv[6] == 'mc'
exe = 'a810x_nb%s%s.exe' % (nb, 'mc' if mc else '')
if not os.path.exists(exe) or os.path.getmtime('a810x.cu') > os.path.getmtime(exe):
    open('build_x.cmd', 'w').write('@echo off\ncd /d %~dp0\ncall "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\n"C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.8\\bin\\nvcc.exe" -O3 -arch=sm_89 -fmad=false -prec-div=true -prec-sqrt=true -ftz=false -allow-unsupported-compiler -D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH -DBK_RATE=60 -DBK_CAP=0.05 -DNB=' + nb + (' -DMC' if mc else '') + ' -o ' + exe + ' a810x.cu > buildx.log 2>&1\necho exit %errorlevel% >> buildx.log\n')
    subprocess.run(['cmd', '/c', os.path.join(D, 'build_x.cmd')]); print(open('buildx.log').read()[-600:], flush=True)
for y in yaws:
    t = 'x-%s-y%s' % (tag, y)
    subprocess.run([os.path.join(D, exe), 'room93.bin', spots, 'hits-%s.txt' % t, 'progress-%s.txt' % t, y, thr], cwd=D)
    print(y, open('progress-%s.txt' % t).read()[-300:], flush=True)
