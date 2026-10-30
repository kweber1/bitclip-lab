-- fp-pad-route.lua (BizHawk 2.11, Banjo-Kazooie PAL) -- the shock-pad route found by the movement+camera simulator.
-- No walking. From rec\fpstart.State (end of your recording 20261029-161617, standing after the Talon Trot):
--   1. crouch turn: hold Z, stick FULL DOWN-LEFT for ~20 frames (Banjo turns in place)
--   2. beak barge: keep Z held, press B and HOLD B ~40 frames (let go of Z ~70 frames after the B press)
--   3. he slides on the snow; W updates (2 frames each) after the B press: press Z, then A and HOLD A,
--      stick FULL UP-RIGHT; when he lands, let go of the stick (keep A)
-- Simulator: lands on the pad for W = 39..55 (34 frames of leeway). This script checks every W in your emulator,
-- writes rec\fp-pad-route.txt, and saves W=47 as a normal recording (rec\fppad-route.csv, LAST.txt) for route-replay.lua.
local DIR = ROUTE_DIR or "E:/banjo/mods/route-rec/rec/"
local D = "RDRAM"
local A = { pos=0x37CF70, vel=0x37CE88, yaw=0x37D060, myaw=0x37D064, state=0x37DB34, grounded=0x37C930,
            map=0x37F2C5, gtime=0x37F2B8, dtvi=0x384E64, gbtn=0x285734, gsx=0x285736, gsy=0x285737, camyaw=0x37E33C }
local PAD = { 3672, 7034 }
local function f(a) return memory.readfloat(a, true, D) end
local out = assert(io.open(DIR .. "fp-pad-route.txt", "w"))
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
-- one game update = 2 frames with the same input (the update reads the second one)
local function upd(b, sx, sy) frame(b, sx or 0, sy or 0); frame(b, sx or 0, sy or 0) end

local function route(W)
  savestate.load(DIR .. "fpstart.State"); fn = 0
  -- (update 0 runs on the savestate's own input)
  for u = 0, 11 do local on = (u >= 1 and u <= 10); upd({ Z = true }, on and -57 or 0, on and -57 or 0) end   -- crouch turn down-left
  for w = 0, W - 1 do upd({ Z = (w < 35), B = (w >= 1 and w < 21) }) end                                   -- barge, B held 20 updates
  -- backflip: Z, then A held with the stick up-right; the update that reads frame 2 of pair j uses input j, and it
  -- finishes on frame 1 of pair j+1, so landing for input j is seen there and pair j+1's read frame can drop the stick
  local air, landed, after = false, false, 0
  local function fin(j) if landed then return { A = true }, 0, 0 end
    return { Z = (j < 3), A = (j >= 2) }, (j >= 2) and 57 or 0, (j >= 2) and 57 or 0 end
  for j = 0, 120 do
    local b, sx, sy = fin(j); frame(b, sx, sy)
    if j - 1 > 2 and not landed then if memory.read_u8(A.grounded, D) == 0 then air = true elseif air then landed = true end end
    b, sx, sy = fin(j); frame(b, sx, sy)
    if landed then after = after + 1; if after > 10 then break end end
  end
  local px, py, pz = f(A.pos), f(A.pos + 4), f(A.pos + 8)
  return py > 235 and math.sqrt((px - PAD[1]) ^ 2 + (pz - PAD[2]) ^ 2) < 130, px, py, pz
end

local line = ""
for W = 30, 70 do
  gui.text(10, 40, "FP pad route, W " .. W, "yellow")
  local ok, x, y, z = route(W)
  line = line .. (ok and "P" or (y > 200 and "-" or "."))
  if W == 47 then say("W=47 ends at %.4f %.4f %.4f  %s", x, y, z, ok and "ON THE PAD" or "missed") end
end
say("W = 30..70 (updates after the barge B press when Z is pressed for the backflip): %s", line)
say("simulator said:                                      .........PPPPPPPPPPPPPPPPP.PPPPPPPPP...P.")
savestate.load(DIR .. "fpstart.State"); savestate.save(DIR .. "fppad-route_anchor.State")
log = assert(io.open(DIR .. "fppad-route.csv", "w"))
log:write("frame,A,B,Z,L,R,Start,CU,CD,CL,CR,DU,DD,DL,DR,X,Y,game_buttons,game_sx,game_sy,dt_vi,x,y,z,vx,vy,vz,yaw,moving_yaw,state,grounded,map,cam_yaw,game_time\n")
log:write("0," .. string.rep("0,", 16) .. stateRow() .. "\n")
route(47)
log:close(); log = nil
local fl = io.open(DIR .. "LAST.txt", "w"); fl:write("fppad-route\n"); fl:close()
say("saved rec\\fppad-route.csv (W=47); route-replay.lua plays it back")
out:close()
gui.addmessage("FP pad route check done: rec\\fp-pad-route.txt")
