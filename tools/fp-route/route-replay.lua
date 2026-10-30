-- route-replay.lua  (BizHawk 2.11, Banjo-Kazooie PAL)
-- Plays a recording from route-record.lua back from its start savestate, several times, and checks that Banjo
-- follows the same path and ends in the same spot every time.
-- Settings below: NAME = "" plays the last recording (rec\LAST.txt). STOP_AT = 0 plays it all.
-- Results: on screen, in the Lua console, and in rec\<name>_replay.txt

local NAME = ROUTE_NAME or ""
local REPEATS = 3
local STOP_AT = 0
local DIR = ROUTE_DIR or "E:/banjo/mods/route-rec/rec/"
local D = "RDRAM"
local A = { pos=0x37CF70, yaw=0x37D060, state=0x37DB34, gbtn=0x285734, gsx=0x285736, gsy=0x285737 }
local function f(a) return memory.readfloat(a, true, D) end

if NAME == "" then local fl = assert(io.open(DIR .. "LAST.txt")); NAME = fl:read("*l"); fl:close() end
local rows = {}
local fi = assert(io.open(DIR .. NAME .. ".csv"))
local hdr = fi:read("*l")
for l in fi:lines() do
  local c = {}; local i = 1
  for s in (l .. ","):gmatch("(.-),") do c[i] = s; i = i + 1 end
  rows[#rows + 1] = c
end
fi:close()
local BTN = { "A", "B", "Z", "L", "R", "Start", "C Up", "C Down", "C Left", "C Right", "DPad U", "DPad D", "DPad L", "DPad R" }
-- columns: 1 frame, 2..15 buttons, 16 X, 17 Y, 18 game_buttons, 19 game_sx, 20 game_sy, 21 dt_vi, 22..24 pos, ... 28 yaw, 30 state
local last = #rows - 1
if STOP_AT > 0 and STOP_AT < last then last = STOP_AT end
local out = assert(io.open(DIR .. NAME .. "_replay.txt", "w"))
local function say(s) print(s); out:write(s .. "\n"); out:flush() end
say(string.format("replaying %s, frames 1..%d, %d times", NAME, last, REPEATS))

local ends = {}
for rep = 1, REPEATS do
  savestate.load(DIR .. NAME .. "_anchor.State")
  local firstDiff, padDiff = nil, nil
  for k = 1, last do
    local r = rows[k + 1]
    local b = {}; for j, n in ipairs(BTN) do b[n] = r[j + 1] == "1" end
    joypad.set(b, 1)
    joypad.setanalog({ ["X Axis"] = tonumber(r[16]), ["Y Axis"] = tonumber(r[17]) }, 1)
    gui.text(10, 40, string.format("REPLAY %d/%d  frame %d/%d", rep, REPEATS, k, last), "yellow")
    emu.frameadvance()
    local x, y, z = f(A.pos), f(A.pos + 4), f(A.pos + 8)
    if not padDiff and string.format("%04X", memory.read_u16_be(A.gbtn, D)) ~= r[18] then padDiff = k end
    if not firstDiff and (math.abs(x - tonumber(r[22])) > 1e-3 or math.abs(y - tonumber(r[23])) > 1e-3 or math.abs(z - tonumber(r[24])) > 1e-3) then
      firstDiff = k
      say(string.format("  try %d: path differs from the recording at frame %d: now %.4f %.4f %.4f, recorded %s %s %s", rep, k, x, y, z, r[22], r[23], r[24]))
    end
  end
  local e = { f(A.pos), f(A.pos + 4), f(A.pos + 8), f(A.yaw), memory.read_u32_be(A.state, D) & 0xFF }
  ends[rep] = e
  say(string.format("  try %d: end %.6f %.6f %.6f yaw %.4f state %02X  %s%s", rep, e[1], e[2], e[3], e[4], e[5],
    firstDiff and "DIFFERENT PATH" or "same path as the recording",
    padDiff and string.format(" (game read different buttons from frame %d: inputs may not be reaching the game)", padDiff) or ""))
end
local same = true
for rep = 2, REPEATS do for j = 1, 4 do if ends[rep][j] ~= ends[1][j] then same = false end end end
say(same and "ALL TRIES END IN THE SAME SPOT" or "TRIES END IN DIFFERENT SPOTS")
out:close()
gui.addmessage(same and "replay: same spot every time" or "replay: spots differ")
