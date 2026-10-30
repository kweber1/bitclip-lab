// tools/padscan_ref.js -- reference (JavaScript) for the GPU pad-clip scan (tools/gpu-pc/padscan.cu). Two cases:
//  drop(crack, h): Banjo falls from rest at height h above the crack (x,z exact), gravity -2700 (what a shock-pad jump turns into
//    once A is let go / past the apex; the pad sets the reachable height range), until he lands or is 150 under the floor.
//  bomb(crack, dir, phase): beak bomb (BA_PHYSICS_UNK8: pos += vel*dt, no gravity, 4200 along dir) aimed so its straight line passes
//    through the crack spot; phase = how far along the per-update step the line hits the floor (0..1).
// A case is a clip when Banjo ends up more than 150 under the crack's floor (held-then-through or straight through the seam).
'use strict';
const F = Math.fround;
function mk(BK) {
  function run(world, pos, vel, grav, term, dt, maxU, floorY, stopOnGround) {
    world.stored = null; const tr = new BK.Tracker({ unk28: pos }); let grounded = false, hold = 0; pos = pos.map(F); vel = vel.map(F); let minY = pos[1], holds = 0;
    for (let u = 0; u < maxU; u++) {
      if (absf(vel[0]) < 0.0001) vel[0] = 0; if (absf(vel[2]) < 0.0001) vel[2] = 0;
      if (grav !== 0) { vel[1] = F(vel[1] + F(dt * grav)); if (vel[1] < term) vel[1] = term; }
      const tgt = [F(pos[0] + F(vel[0] * dt)), F(pos[1] + F(vel[1] * dt)), F(pos[2] + F(vel[2] * dt))];
      const r = BK.predict(world, pos, tgt, { grounded, tracker: tr, hold_counter: hold });
      pos = r.result.map(F); grounded = !!r.grounded; hold = r.hold_counter_after; if (r.held) holds++;
      if (grounded && vel[1] < 0 && grav !== 0) vel[1] = F(-1);
      if (pos[1] < minY) minY = pos[1];
      if (pos[1] < floorY - 150) return { clip: 1, u, minY, holds, pos };
      if (grounded && (stopOnGround || pos[1] > floorY - 5)) return { clip: 0, u, minY, holds, landY: pos[1], pos };
    }
    return { clip: 0, u: maxU, minY, holds, pos };
  }
  const absf = (x) => (x < 0 ? -x : x);
  function drop(world, c, h, dt) { return run(world, [c[0], F(c[1] + F(h)), c[2]], [0, 0, 0], F(-2700), F(-4000), dt, 80, c[1], false); }
  function bomb(world, c, dir, phase, dt, speed = 4200) {
    const v = dir.map(x => F(x * speed)); const step = [F(v[0] * dt), F(v[1] * dt), F(v[2] * dt)];
    const back = F(3 + phase); const p = [0, 1, 2].map(i => F(c[i] - F(step[i] * back))); // feet start 3+phase steps up the line
    return run(world, p, v, 0, 0, dt, 12, c[1], true);
  }
  return { run, drop, bomb };
}
if (typeof module !== 'undefined') module.exports = mk;
