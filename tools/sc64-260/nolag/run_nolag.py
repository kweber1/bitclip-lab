"""Run the 260 no-lag punch-cancel clip search on all CPU cores (Windows node). Output: out\\nolag-*.jsonl, summary.txt"""
import os, subprocess, shutil, time, json, glob
HERE = os.path.dirname(os.path.abspath(__file__))
node = shutil.which('node')
N = max(1, (os.cpu_count() or 2) - 2)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
for f in glob.glob(os.path.join(HERE, 'out', '*')): os.remove(f)
t0 = time.time()
procs = [subprocess.Popen([node, os.path.join(HERE, 'nolag.js'), str(p), str(N)], stdout=subprocess.DEVNULL,
                          stderr=open(os.path.join(HERE, 'out', 'w%02d.log' % p), 'w')) for p in range(N)]
print('%d workers started' % N, flush=True)
while any(p.poll() is None for p in procs):
    time.sleep(20)
    done = sum(len(open(f).read().splitlines()) for f in glob.glob(os.path.join(HERE, 'out', 'w*.log')))
    print('%4.0f s: %d spots done' % (time.time() - t0, done), flush=True)
clips = []
for f in glob.glob(os.path.join(HERE, 'out', 'nolag-*.jsonl')):
    clips += [json.loads(l) for l in open(f) if l.strip()]
with open(os.path.join(HERE, 'out', 'summary.txt'), 'w') as fo:
    fo.write('%d no-lag clips\n' % len(clips))
    for c in sorted(clips, key=lambda c: float(c['dist'])): fo.write(json.dumps(c) + '\n')
print('DONE: %d no-lag clip setups in %.0f s' % (len(clips), time.time() - t0))
