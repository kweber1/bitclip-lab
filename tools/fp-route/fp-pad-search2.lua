-- fp-pad-search2.lua  (BizHawk 2.11, Banjo-Kazooie PAL)  -- no walking, no trotting
-- From the end of your recording 20261029-161617 (standing after the Talon Trot), tries every
--   1. crouch turn: hold Z, push the stick FULL in one of the 8 easy directions (up, up-right, right, ... relative to the camera)
--   2. beak barge: (Z still held) press B, either a tap or held
--   3. while he slides on the snow, after W frames: crouch (Z) and BACKFLIP, A held the whole time, stick FULL in an easy direction
-- and reports which ones end ON TOP OF THE LOW SHOCK PAD, and how many frames of leeway W has (a run of P's).
-- Every stick value is a plain full-tilt direction, so a human can do it; the leeway shows how exact the timing must be.
-- Results: rec\fp-pad-search2.txt. The best one is saved as rec\fppad2-best.csv + _anchor.State (LAST.txt), so
-- route-replay.lua plays it back 3 times. Takes a while (tens of minutes); don't touch the controller.

local DIR = ROUTE_DIR or "E:/banjo/mods/route-rec/rec/"
local REC = "20261029-161617"
local D = "RDRAM"
local A = { pos=0x37CF70, vel=0x37CE88, yaw=0x37D060, myaw=0x37D064, state=0x37DB34, grounded=0x37C930,
            map=0x37F2C5, gtime=0x37F2B8, dtvi=0x384E64, gbtn=0x285734, gsx=0x285736, gsy=0x285737, camyaw=0x37E33C }
local PAD = { 3672, 7034 }
local W_MIN, W_MAX, W_STEP = 30, 260, 2         -- frames after the B press
local BARGE = { { "tap", 2 }, { "held", 40 } }   -- B held frames
local EASY = { { "up", 0, 80 }, { "up-right", 57, 57 }, { "right", 80, 0 }, { "down-right", 57, -57 },
               { "down", 0, -80 }, { "down-left", -57, -57 }, { "left", -80, 0 }, { "up-left", -57, 57 } }
local function f(a) return memory.readfloat(a, true, D) end
-- world yaw that easy stick k gives right now (game: moving yaw = camera yaw + stick angle + 180)
local function easyYaw(k) return (f(A.camyaw) + math.deg(math.atan(-EASY[k][2], EASY[k][3])) + 180) % 360 end
local function padYaw() return math.deg(math.atan(PAD[1] - f(A.pos), PAD[2] - f(A.pos + 8))) % 360 end
local function off(a, b) local d = (a - b) % 360; if d > 180 then d = 360 - d end; return d end
local out = assert(io.open(DIR .. "fp-pad-search2.txt", "w"))
local function say(...) local s = string.format(...); print(s); out:write(s .. "\n"); out:flush() end
pcall(client.speedmode, 1600)

local BTN = { "A", "B", "Z", "L", "R", "Start", "C Up", "C Down", "C Left", "C Right", "DPad U", "DPad D", "DPad L", "DPad R" }
local log = nil
local function stateRow()
  return string.format("%04X,%d,%d,%d,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%02X,%d,%02X,%.4f,%.0f",
    memory.read_u16_be(A.gbtn, D), memory.read_s8(A.gsx, D), memory.read_s8(A.gsy, D), memory.read_u32_be(A.dtvi, D),
    f(A.pos), f(A.pos + 4), f(A.pos + 8), f(A.vel), f(A.vel + 4), f(A.vel + 8), f(A.yaw), f(A.myaw),
    memory.read_u32_be(A.state, D) & 0xFF, memory.read_u8(A.grounded, D), memory.read_u8(A.map, D), f(A.camyaw), memory.read_u32_be(A.gtime, D))
end
local fn = 0
local function frame(b, sx, sy)
  joypad.set(b, 1); joypad.setanalog({ ["X Axis"] = sx, ["Y Axis"] = sy }, 1)
  emu.frameadvance(); fn = fn + 1
  if log then local t = {}; for _, n in ipairs(BTN) do t[#t + 1] = b[n] and 1 or 0 end
    log:write(fn .. "," .. table.concat(t, ",") .. "," .. sx .. "," .. sy .. "," .. stateRow() .. "\n") end
end

-- your recording to the end
local START = DIR .. "fpstart.State"
do local rows = {}
  local fi = assert(io.open(DIR .. REC .. ".csv")); fi:read("*l")
  for l in fi:lines() do local c = {}; local i = 1; for s in (l .. ","):gmatch("(.-),") do c[i] = s; i = i + 1 end; rows[#rows + 1] = c end; fi:close()
  savestate.load(DIR .. REC .. "_anchor.State")
  for k = 1, #rows - 1 do local r = rows[k + 1]; local b = {}; for j, n in ipairs(BTN) do b[n] = r[j + 1] == "1" end
    frame(b, tonumber(r[16]), tonumber(r[17])) end
  say("end of %s: %.6f %.6f %.6f yaw %.4f cam %.4f (recorded %s %s %s)", REC, f(A.pos), f(A.pos + 4), f(A.pos + 8), f(A.yaw), f(A.camyaw), rows[#rows][22], rows[#rows][23], rows[#rows][24])
  savestate.save(START)
end

-- turn + barge: frames 1..28 Z held, stick d1 on frames 3..24; B pressed at frame 30 (Z still held), Z let go at frame 70
local function turnBarge(d1, bh, upto, cb)
  for t = 1, upto do
    local sx, sy = 0, 0
    if t >= 3 and t <= 24 then sx, sy = EASY[d1][2], EASY[d1][3] end
    frame({ Z = (t <= 70), B = (t >= 30 and t < 30 + bh) }, sx, sy)
    if cb then cb(t) end
  end
end
-- backflip from the current frame: Z 6 frames, A from frame 4 held, stick m from frame 4; returns onpad, landing
local function flip(m)
  local air = false
  for j = 1, 200 do
    local sx, sy = 0, 0; if j >= 4 and m then sx, sy = EASY[m][2], EASY[m][3] end
    frame({ Z = (j <= 6), A = (j >= 4) }, sx, sy)
    local g = memory.read_u8(A.grounded, D)
    if j > 6 then if g == 0 then air = true elseif air then break end end
  end
  for j = 1, 20 do frame({ A = true }, 0, 0) end
  local px, py, pz = f(A.pos), f(A.pos + 4), f(A.pos + 8)
  return py > 235 and math.sqrt((px - PAD[1]) ^ 2 + (pz - PAD[2]) ^ 2) < 130, { px, py, pz }
end

say("W = frames after the B press when Z is pressed for the backflip, %d..%d step %d. P = ends on the pad, - = on the high ledge, . = floor", W_MIN, W_MAX, W_STEP)
local best = nil
savestate.load(START)
local D1 = {}; for k = 1, 8 do if off(easyYaw(k), padYaw()) <= 70 then D1[#D1 + 1] = k end end
say("crouch-turn directions that point within 70 deg of the pad from the start: %d", #D1)
for _, d1 in ipairs(D1) do for bi, bg in ipairs(BARGE) do
  -- run the turn + barge once, keeping an in-memory savestate at each W
  savestate.load(START); fn = 0
  local snaps = {}
  turnBarge(d1, bg[2], 30 + W_MAX, function(t)
    local w = t - 30
    if w >= W_MIN and (w - W_MIN) % W_STEP == 0 then snaps[w] = memorysavestate.savecorestate() end
  end)
  local lines = {}; for m = 0, 8 do lines[m] = "" end
  for w = W_MIN, W_MAX, W_STEP do
    gui.text(10, 40, string.format("turn %s, barge %s, W %d", EASY[d1][1], bg[1], w), "yellow")
    memorysavestate.loadcorestate(snaps[w])
    local py = padYaw()
    for m = 0, 8 do
      if m == 0 or off(easyYaw(m), py) <= 70 then
        memorysavestate.loadcorestate(snaps[w])
        local ok, e = flip(m > 0 and m or nil)
        lines[m] = lines[m] .. (ok and "P" or (e[2] > 200 and "-" or "."))
      else lines[m] = lines[m] .. " " end
    end
  end
  for w, id in pairs(snaps) do memorysavestate.removestate(id) end
  for m = 0, 8 do
    local l = lines[m]
    if l:find("P") then
      local run, br = 0, 0; local bs, s = nil, nil
      for i = 1, #l + 1 do if l:sub(i, i) == "P" then s = s or i; run = i - s + 1; if run > br then br = run; bs = s end else s = nil end end
      say("turn %-10s barge %-4s flip stick %-10s  leeway %2d (x%d frames)  %s", EASY[d1][1], bg[1], m > 0 and EASY[m][1] or "neutral", br, W_STEP, l)
      if not best or br > best.br then best = { d1 = d1, bh = bg[2], bn = bg[1], m = m, br = br, w = W_MIN + (bs - 1 + math.floor((br - 1) / 2)) * W_STEP } end
    end
  end
end end

if not best then say("NOTHING LANDS ON THE PAD"); out:close(); return end
say("BEST: crouch-turn %s, barge %s, backflip at W=%d frames after B with stick %s (leeway %d checks = %d frames)",
  EASY[best.d1][1], best.bn, best.w, best.m > 0 and EASY[best.m][1] or "neutral", best.br, best.br * W_STEP)
-- save it as a recording
savestate.load(START); savestate.save(DIR .. "fppad2-best_anchor.State")
log = assert(io.open(DIR .. "fppad2-best.csv", "w"))
log:write("frame,A,B,Z,L,R,Start,CU,CD,CL,CR,DU,DD,DL,DR,X,Y,game_buttons,game_sx,game_sy,dt_vi,x,y,z,vx,vy,vz,yaw,moving_yaw,state,grounded,map,cam_yaw,game_time\n")
log:write("0," .. string.rep("0,", 16) .. stateRow() .. "\n")
fn = 0
turnBarge(best.d1, best.bh, 30 + best.w)
local ok, e = flip(best.m > 0 and best.m or nil)
log:close(); log = nil
local fl = io.open(DIR .. "LAST.txt", "w"); fl:write("fppad2-best\n"); fl:close()
say("best replayed: %s, ends at %.4f %.4f %.4f. Saved rec\\fppad2-best.csv; run route-replay.lua to check it 3 times", ok and "ON THE PAD" or "MISSED", e[1], e[2], e[3])
out:close()
gui.addmessage("FP pad search 2 done: rec\\fp-pad-search2.txt")
