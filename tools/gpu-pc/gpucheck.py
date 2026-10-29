# build bkpc.exe, then run the GPU on the two check jobs and compare with the cloud CPU results (bit-exact with the JS engine)
import subprocess, os, sys, json
D = os.path.dirname(os.path.abspath(__file__)); os.chdir(D)
r = subprocess.run(['cmd', '/c', os.path.join(D, 'build.cmd')]); print(open('build.log').read()[-3000:], flush=True)
if not os.path.exists('bkpc.exe'): sys.exit('build failed')
open('spot1.json','w').write('[[3391.24951,1250,252.128098]]')
json.dump([[3222.31836, 1250, 285.656891], [3398.50928, 1250, 251.202255], [3275.75, 1250, -86.834488], [3001.68799, 1250, 667.855835], [3719.17261, 1250, 128.000122], [3675.39087, 1250, 89.000038]], open('sample6.json','w'))
for name, spots, pats in [('spot1', 'spot1.json', 'single'), ('s6', 'sample6.json', 'early')]:
    subprocess.run(['node', 'pack.js', spots, name + '.bin', '--pats', pats], check=True)
    p = subprocess.run([os.path.join(D, 'bkpc.exe'), name + '.bin', name + '_gpu.txt'], capture_output=True, text=True); print(p.stderr[-1500:], flush=True)
print('DONE')
