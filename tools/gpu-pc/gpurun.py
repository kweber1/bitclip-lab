# usage (via runner wrapper): gpurun.py <name> <maxdist> <pats> [extra pack.js args...]
import subprocess, os, sys, json, math
D = os.path.dirname(os.path.abspath(__file__)); os.chdir(D)
name, maxd, pats = sys.argv[1], float(sys.argv[2]), sys.argv[3]; extra = sys.argv[4:]
door = (3845, 1250, 281)
if not os.path.exists('bkpc.exe') or os.path.getmtime('bkpc.cu') > os.path.getmtime('bkpc.exe'):
    subprocess.run(['cmd', '/c', os.path.join(D, 'build.cmd')]); print(open('build.log').read()[-300:], flush=True)
spots = [s for s in json.load(open('all950.json')) if math.dist(s[:3], door) < maxd]
json.dump(spots, open(name + '_spots.json', 'w'))
subprocess.run(['node', 'pack.js', name + '_spots.json', name + '.bin', '--pats', pats] + extra, check=True)
p = subprocess.run([os.path.join(D, 'bkpc.exe'), name + '.bin', name + '_out.txt', '--clips'], stderr=subprocess.PIPE, text=True)
lines = p.stderr.splitlines(); print('\n'.join(lines[:2] + lines[-3:]), flush=True)
# summary: clips per spot with distance to the door
job = json.load(open(name + '.bin.json')); clips = {}
for l in open(name + '_out.txt'):
    if l[0] == '#': continue
    s, yi, pi, qi, k, holds, clipAt, clip, endY, x0, z0 = l.split()
    if clip != '1': continue
    clips.setdefault(int(s), []).append((int(yi), job['paramList'][int(pi)], job['pats'][int(qi)], int(k), float(endY)))
with open(name + '_summary.txt', 'w') as fo:
    for s in sorted(clips, key=lambda s: math.dist(spots[s][:3], door)):
        lagset = sorted(set(tuple(c[2]) for c in clips[s]))
        fo.write('%s d%.0f clips %d lags %s\n' % (spots[s][:3], math.dist(spots[s][:3], door), len(clips[s]), lagset[:12]))
print('spots with clips:', len(clips)); print(open(name + '_summary.txt').read()[:3000])
