# note-door room scan (anc.cu): any map, per-spot floor y. usage: run_anc.py room.bin spots.txt tag mapid versions(ntsc,pal) modes yaws moves
import subprocess, os, sys
D = r'E:\banjo\work\a810'; os.chdir(D)
room, spots, tag, mapid = sys.argv[1:5]; vers = sys.argv[5].split(','); modes = sys.argv[6].split(','); yaws = sys.argv[7].split(','); moves = sys.argv[8].split(',')
NV = r'"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8\bin\nvcc.exe" -O3 -arch=sm_89 -fmad=false -prec-div=true -prec-sqrt=true -ftz=false -allow-unsupported-compiler -D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH'
out = open('batch-%s.txt' % tag, 'a')
for v in vers:
    exe = 'anc_%s_%s.exe' % (v, mapid)
    rate = '-DBK_RATE=60 -DBK_CAP=0.05' if v == 'ntsc' else '-DBK_RATE=50 -DBK_CAP=0.06'
    if not os.path.exists(exe) or os.path.getmtime('anc.cu') > os.path.getmtime(exe):
        open('build_anc.cmd', 'w').write('@echo off\ncd /d %~dp0\ncall "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul\n' + NV + ' ' + rate + ' -DMAPID=' + mapid + ' -o ' + exe + ' anc.cu > buildanc.log 2>&1\necho exit %errorlevel% >> buildanc.log\n')
        subprocess.run(['cmd', '/c', os.path.join(D, 'build_anc.cmd')]); print(open('buildanc.log').read()[-500:], flush=True)
    for mv in moves:
        env = dict(os.environ, A810_MOVE=mv)
        for m in modes:
            for y in yaws:
                t = '%s-%s-%s-mv%s-y%s' % (tag, v, m, mv, y)
                subprocess.run([os.path.join(D, exe), room, spots, 'hits-%s.txt' % t, 'progress-%s.txt' % t, y, m], cwd=D, env=env)
                last = [l for l in open('progress-%s.txt' % t) if 'spots,' in l][-1].strip()
                out.write('%-4s move %s %-5s yaw %3s | %s\n' % (v, mv, m, y, last)); out.flush(); print(v, mv, m, y, last, flush=True)
