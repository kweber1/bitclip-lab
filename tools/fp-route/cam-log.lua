-- cam-log.lua (BizHawk 2.11, Banjo-Kazooie PAL): camera data for building the camera simulator.
-- From rec\fpstart.State (end of your recording), plays a fixed list of moves and logs, every frame, Banjo and the
-- camera's internal values to rec\cam-log.csv. Takes about a minute. Don't touch the controller.
local DIR = ROUTE_DIR or "E:/banjo/mods/route-rec/rec/"
local D = "RDRAM"
local function f(a) return memory.readfloat(a, true, D) end
local function u8(a) return memory.read_u8(a, D) end
local P = { pos=0x37CF70, yaw=0x37D060, state=0x37DB34, grounded=0x37C930, dtvi=0x384E64, gbtn=0x285734, gsx=0x285736, gsy=0x285737 }
local C = { D948=0x37E318, pos=0x37E328, rot=0x37E338, D978=0x37E348, D994=0x37E364, D9A0=0x37E370, D9A8=0x37E378, D9B8=0x37E388,
            D9C8=0x37E398, D9E0=0x37E3B0, DB70=0x37E540, DB9C=0x37E56C }
pcall(client.speedmode, 1600)
savestate.load(DIR .. "fpstart.State")
local out = assert(io.open(DIR .. "cam-log.csv", "w"))
local hdr = { "frame", "btn", "sx", "sy", "game_btn", "game_sx", "game_sy", "dt_vi", "x", "y", "z", "yaw", "state", "grounded", "camstate", "cam_mode" }
local function v3(name) return name .. "x," .. name .. "y," .. name .. "z" end
out:write(table.concat(hdr, ",") .. "," .. v3("D948") .. "," .. v3("cpos") .. "," .. v3("crot") .. ",D978,D994,D9A0," .. v3("D9A8") .. "," .. v3("D9B8") .. "," .. v3("D9C8") .. "," .. v3("D9E0") .. ",DB70,DB9C,D9F6\n")
local fn = 0
local function rd3(a) return string.format("%.9g,%.9g,%.9g", f(a), f(a + 4), f(a + 8)) end
local function logrow(btn, sx, sy)
  out:write(string.format("%d,%s,%d,%d,%04X,%d,%d,%d,%.9g,%.9g,%.9g,%.9g,%02X,%d,%02X,%02X,", fn, btn, sx, sy,
    memory.read_u16_be(P.gbtn, D), memory.read_s8(P.gsx, D), memory.read_s8(P.gsy, D), memory.read_u32_be(P.dtvi, D),
    f(P.pos), f(P.pos + 4), f(P.pos + 8), f(P.yaw), memory.read_u32_be(P.state, D) & 0xFF, u8(P.grounded), u8(0x37E3C4), u8(0x37E510)))
  out:write(rd3(C.D948) .. "," .. rd3(C.pos) .. "," .. rd3(C.rot) .. string.format(",%.9g,%.9g,%.9g,", f(C.D978), f(C.D994), f(C.D9A0)) ..
    rd3(C.D9A8) .. "," .. rd3(C.D9B8) .. "," .. rd3(C.D9C8) .. "," .. rd3(C.D9E0) .. string.format(",%.9g,%.9g,%d\n", f(C.DB70), f(C.DB9C), u8(0x37E3C6)))
end
local function frame(b, sx, sy)
  joypad.set(b, 1); joypad.setanalog({ ["X Axis"] = sx, ["Y Axis"] = sy }, 1)
  emu.frameadvance(); fn = fn + 1
  local t = {}; for _, k in ipairs({ "A", "B", "Z" }) do if b[k] then t[#t + 1] = k end end
  logrow(#t > 0 and table.concat(t, "+") or "-", sx, sy)
end
logrow("start", 0, 0)
-- 1. stand 30 frames; 2. walk/run in several directions (for validation only); 3. crouch turns, barges, backflip
for i = 1, 30 do frame({}, 0, 0) end
for _, d in ipairs({ { 0, 80, 60 }, { 80, 0, 40 }, { -57, 57, 50 }, { 0, -80, 40 }, { 0, 0, 40 } }) do
  for i = 1, d[3] do frame({}, d[1], d[2]) end
end
for _, st in ipairs({ { 57, 57 }, { -80, 0 } }) do
  for i = 1, 24 do frame({ Z = true }, (i >= 3 and i <= 20) and st[1] or 0, (i >= 3 and i <= 20) and st[2] or 0) end
  for i = 1, 40 do frame({ Z = (i <= 30), B = (i <= 20) }, 0, 0) end
  for i = 1, 80 do frame({}, 0, 0) end
end
for i = 1, 6 do frame({ Z = true }, 0, 0) end
for i = 1, 100 do frame({ Z = (i <= 2), A = true }, 0, 80) end
for i = 1, 40 do frame({}, 0, 0) end
out:close()
print("cam-log done: " .. fn .. " frames")
gui.addmessage("cam-log done")
