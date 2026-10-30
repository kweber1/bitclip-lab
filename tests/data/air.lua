local D='RDRAM'; local o=io.open('/home/claude/emu/wv/air.csv','w')
local function u8(a) return memory.read_u8(a,D) end local function u16(a) return memory.read_u16_be(a,D) end local function u32(a) return memory.read_u32_be(a,D) end
local function f(a) return memory.readfloat(a,true,D) end local function wf(a,v) memory.writefloat(a,v,true,D) end
local function s8(a) local v=u8(a); if v>127 then v=v-256 end return v end
savestate.load('/home/claude/emu/bh/BizHawk-2.11.1-linux-x64/N64/State/BK-Snapper-PAL-Practice-SC64-v6.Ares64.QuickSave5.State')
for i=1,3 do emu.frameadvance() end
memory.write_u32_be(0x37CD70, (u32(0x37CD70) | 0x7FFFF), D)   -- all moves
local P={3795.5,1250,400}
local function place() for _,a in ipairs({0x37CF70,0x37C9F0,0x37CBE8,0x37CBF8,0x37CF80}) do wf(a,P[1]); wf(a+4,P[2]); wf(a+8,P[3]) end wf(0x37CE88,0); wf(0x37CE8C,0); wf(0x37CE90,0) end
place(); emu.frameadvance(); place()
local WA=nil
for a=0,0x3FFFF0,4 do if memory.read_u32_be(a,D)==0x3F4CCCCD and f(a+0xC)==-50 and f(a+0x10)==-1325 and f(a+0x14)==-1725 then WA=a; break end end
local wo=io.open('/home/claude/emu/wv/wave.txt','w'); wo:write(string.format('WA %s\n', WA and string.format('%X',WA) or 'nil')); wo:close()
-- input script: {frames, buttons, sx, sy}
local SCRIPT={{60,{},0,0},{4,{A=true},0,0},{26,{},0,0},{4,{A=true},0,0},{60,{A=true},0,40},{40,{},0,0},{4,{A=true},0,0},{24,{},0,0},{4,{B=true},0,0},{4,{},0,0},{4,{B=true},0,0},{4,{},0,0},{4,{B=true},0,0},{60,{},0,0},{4,{A=true},40,40},{20,{A=true},40,40},{4,{Z=true},0,0},{80,{},0,0},{30,{A=true},-60,0},{4,{},0,0},{4,{A=true},0,0},{50,{A=true},0,0},{60,{},0,0}}
o:write('frame,btn,sx,sy,gbtn,gsx,gsy,dtvi,gtime,x,y,z,vx,vy,vz,yaw,state,inwater,grounded,cam,trX,trY,trmode,tr59,w4,w8,w2C\n')
local fr=0
for _,seg in ipairs(SCRIPT) do for i=1,seg[1] do
  joypad.set(seg[2],1); joypad.setanalog({['X Axis']=seg[3],['Y Axis']=seg[4]},1); emu.frameadvance(); fr=fr+1
  o:write(string.format('%d,%s,%d,%d,%04X,%d,%d,%d,%d,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%X,%d,%d,%.9g',fr,(seg[2].A and 'A' or '')..(seg[2].B and 'B' or ''),seg[3],seg[4],
    u16(0x285734),s8(0x285736),s8(0x285737),u32(0x384E64),u32(0x37F2B8),f(0x37CF70),f(0x37CF74),f(0x37CF78),f(0x37CE88),f(0x37CE8C),f(0x37CE90),f(0x37D060),u32(0x37DB34),u8(0x37C931),u8(0x37C930),f(0x37E33C)))
  local tp=u32(0x37CBD0)-0x80000000; o:write(string.format(',%.9g,%.9g,%d,%d,%08X,%08X,%08X\n',f(tp+0x40),f(tp+0x44),u8(tp+0x5E),u8(tp+0x59),WA and u32(WA+4) or 0,WA and u32(WA+8) or 0,WA and u32(WA+0x2C) or 0))
end end
o:close(); client.exit()
