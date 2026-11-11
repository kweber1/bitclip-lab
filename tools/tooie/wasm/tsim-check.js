// node tsim-check.js room.txt tc.txt [cells] [every]: the WebAssembly census against the CELL lines of the GPU census
const fs = require('fs'); const { TSim } = require('./tsim-lib.js');
const sim = new TSim(fs.readFileSync(__dirname + '/tsim.wasm')); sim.loadRoom(fs.readFileSync(process.argv[2], 'utf8'));
const max = +(process.argv[4] || 20), every = +(process.argv[5] || 1), maxn = +(process.argv[6] || 1e12); const seams = []; let done = 0, ok = 0, ln = 0;
(async () => {
  for (const line of fs.readFileSync(process.argv[3], 'utf8').split('\n')) {
    if (line.startsWith('SEAM ')) { const a = line.split(' '); const [ma, ta] = a[2].split(':').map(Number), [mb, tb] = a[3].split(':').map(Number);
      seams[+a[1]] = [+a[4], +a[5], +a[6], +a[7], +a[8], +a[9], 0, 0, 0, ma, ta, mb, tb]; continue; }
    if (!line.startsWith('CELL ') || (ln++ % every)) continue; if (done >= max) break;
    const a = line.split(' '); const bar = a.indexOf('|'); const c = a.slice(2, bar).map(Number); const x = +a[bar + 1], z = +a[bar + 3];
    if (c[0] > maxn) continue; const cx = Math.floor(Math.fround(x) / 0.25), cz = Math.floor(Math.fround(z) / 0.25); const t0 = Date.now();
    const k = await sim.cell(seams[+a[1]], cx, cz, null, {});
    const mine = [k.n, k.walk, k.void, k.lag, k.jump, k.eject, k.stuck, k.wall, k.water, k.hold]; const same = mine.every((v, i) => v === c[i]);
    done++; if (same) ok++; console.log((same ? 'same ' : 'DIFF ') + 'seam ' + a[1] + ' cell ' + cx + ' ' + cz + ' census [' + c.join(' ') + ']' + (same ? '' : ' here [' + mine.join(' ') + ']') + ' ' + (Date.now() - t0) + ' ms'); }
  console.log('cells checked', done, 'identical', ok); })();
