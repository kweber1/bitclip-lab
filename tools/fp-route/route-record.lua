-- route-record.lua  (BizHawk 2.11, Banjo-Kazooie PAL)
-- Records your inputs frame by frame, plus Banjo's position/speed/facing/state after every frame.
-- 1. Get to the spot you want to start from (stand still if you can).
-- 2. Load this script (Tools > Lua Console > open). It saves a start savestate right away and starts recording.
-- 3. Play your moves.
-- 4. Press the END key on the keyboard to stop. Files go to E:\banjo\mods\route-rec\rec\
--      <name>_anchor.State   the start savestate
--      <name>.csv            one row per frame: your inputs, what the game read, and Banjo's state
-- Then run route-replay.lua to play it back from the savestate and check it ends in the same spot.
-- Use the normal PAL ROM (banjo.eu.pal.z64), not the practice ROM: on the practice ROM BizHawk's input
-- playback does not reach the game.

local DIR = ROUTE_DIR or "E:/banjo/mods/route-rec/rec/"
local D = "RDRAM"
-- PAL addresses (banjo-debug-hud profile)
local A = { pos=0x37CF70, vel=0x37CE88, yaw=0x37D060, myaw=0x37D064, state=0x37DB34, grounded=0x37C930,
            map=0x37F2C5, gtime=0x37F2B8, dtvi=0x384E64, gbtn=0x285734, gsx=0x285736, gsy=0x285737, camyaw=0x37E33C }
local function f(a) return memory.readfloat(a, true, D) end

os.execute('mkdir "E:\\banjo\\mods\\route-rec\\rec" 2>nul')
local name = os.date("%Y%m%d-%H%M%S")
local anchor = DIR .. name .. "_anchor.State"
savestate.save(anchor)
local fo = assert(io.open(DIR .. name .. ".csv", "w"))
local BTN = { "A", "B", "Z", "L", "R", "Start", "C Up", "C Down", "C Left", "C Right", "DPad U", "DPad D", "DPad L", "DPad R" }
fo:write("frame,A,B,Z,L,R,Start,CU,CD,CL,CR,DU,DD,DL,DR,X,Y,game_buttons,game_sx,game_sy,dt_vi,x,y,z,vx,vy,vz,yaw,moving_yaw,state,grounded,map,cam_yaw,game_time\n")

-- the input the core actually polls on each frame
local polled = nil
local cb = event.oninputpoll(function() polled = joypad.get(1) end, "route-record")

local frame = 0
local stop = false
local function row(p)
  local t = {}
  for _, b in ipairs(BTN) do t[#t + 1] = (p and p[b]) and 1 or 0 end
  t[#t + 1] = p and math.floor((p["X Axis"] or 0) + 0.5) or 0
  t[#t + 1] = p and math.floor((p["Y Axis"] or 0) + 0.5) or 0
  return table.concat(t, ",")
end
local function stateRow()
  return string.format("%04X,%d,%d,%d,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%02X,%d,%02X,%.4f,%.0f",
    memory.read_u16_be(A.gbtn, D), memory.read_s8(A.gsx, D), memory.read_s8(A.gsy, D), memory.read_u32_be(A.dtvi, D),
    f(A.pos), f(A.pos + 4), f(A.pos + 8), f(A.vel), f(A.vel + 4), f(A.vel + 8), f(A.yaw), f(A.myaw),
    memory.read_u32_be(A.state, D) & 0xFF, memory.read_u8(A.grounded, D), memory.read_u8(A.map, D), f(A.camyaw), memory.read_u32_be(A.gtime, D))
end

-- frame 0 = the state in the savestate, before any input
fo:write("0," .. row(nil) .. "," .. stateRow() .. "\n")
while not stop do
  gui.text(10, 40, string.format("REC %s  frame %d  (press END to stop)", name, frame), "red")
  polled = nil
  if ROUTE_TEST then ROUTE_TEST(frame) end
  emu.frameadvance()
  frame = frame + 1
  fo:write(frame .. "," .. row(polled) .. "," .. stateRow() .. "\n")
  local k = input.get()
  if k["End"] or (ROUTE_TEST_STOP and frame >= ROUTE_TEST_STOP) then stop = true end
end
event.unregisterbyid(cb)
fo:close()
local msg = string.format("saved %s: %d frames, end pos %.4f %.4f %.4f, yaw %.3f", name, frame, f(A.pos), f(A.pos + 4), f(A.pos + 8), f(A.yaw))
print(msg)
local fl = io.open(DIR .. "LAST.txt", "w"); fl:write(name .. "\n"); fl:close()
gui.addmessage(msg)
