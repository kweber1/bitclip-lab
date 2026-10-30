local D='RDRAM'; local o=io.open('/home/claude/emu/wv/fly.csv','w'); local lg=io.open('/home/claude/emu/wv/fly.log','w')
local function u8(a) return memory.read_u8(a,D) end local function u16(a) return memory.read_u16_be(a,D) end local function u32(a) return memory.read_u32_be(a,D) end
local function f(a) return memory.readfloat(a,true,D) end local function wf(a,v) memory.writefloat(a,v,true,D) end
local function s8(a) local v=u8(a); if v>127 then v=v-256 end return v end
local GS=0x37F2B0
local function g(a) return string.format("%.9g",f(a)) end
local function camjson()
  local t={}
  t[#t+1]='"D948":['..g(0x37E318)..","..g(0x37E31C)..","..g(0x37E320).."]"
  t[#t+1]='"pos":['..g(0x37E328)..","..g(0x37E32C)..","..g(0x37E330).."]"
  t[#t+1]='"rot":['..g(0x37E338)..","..g(0x37E33C)..","..g(0x37E340).."]"
  t[#t+1]='"D974":'..g(0x37E344)
  t[#t+1]='"D978":'..g(0x37E348)
  t[#t+1]='"D97C":'..g(0x37E34C)
  t[#t+1]='"D980":'..g(0x37E350)
  t[#t+1]='"D984":'..g(0x37E354)
  t[#t+1]='"D988":'..g(0x37E358)
  t[#t+1]='"D98C":'..g(0x37E35C)
  t[#t+1]='"D990":'..g(0x37E360)
  t[#t+1]='"D994":'..g(0x37E364)
  t[#t+1]='"D998":'..g(0x37E368)
  t[#t+1]='"D99C":'..g(0x37E36C)
  t[#t+1]='"D9A0":'..g(0x37E370)
  t[#t+1]='"D9A8":['..g(0x37E378)..","..g(0x37E37C)..","..g(0x37E380).."]"
  t[#t+1]='"D9B8":['..g(0x37E388)..","..g(0x37E38C)..","..g(0x37E390).."]"
  t[#t+1]='"D9C8":['..g(0x37E398)..","..g(0x37E39C)..","..g(0x37E3A0).."]"
  t[#t+1]='"D9D4":'..g(0x37E3A4)
  t[#t+1]='"D9D8":'..g(0x37E3A8)
  t[#t+1]='"D9E0":['..g(0x37E3B0)..","..g(0x37E3B4)..","..g(0x37E3B8).."]"
  t[#t+1]='"D9EC":'..g(0x37E3BC)
  t[#t+1]='"D9F0":'..g(0x37E3C0)
  t[#t+1]='"D9F6":'..memory.read_s16_be(0x37E3C6,D)
  t[#t+1]='"state":'..memory.read_u8(0x37E3C4,D)
  return "{"..table.concat(t,",").."}" end

savestate.load('/home/claude/emu/bh/BizHawk-2.11.1-linux-x64/N64/State/BK-Snapper-PAL-Practice-SC64-v6.Ares64.QuickSave5.State')
for i=1,3 do emu.frameadvance() end
memory.write_u8(GS+0x15,0x07,D); memory.write_u8(GS+0x16,1,D); memory.write_u8(GS+0x17,1,D); memory.write_u8(GS+0x18,0,D); memory.write_u8(GS+0x19,0,D); memory.write_u8(GS+0x14,1,D)
for i=1,600 do emu.frameadvance() end
lg:write(string.format('map %02X mode %d state %X pos %.1f %.1f %.1f\n',u8(0x37F2C5),u32(GS+4),u32(0x37DB34),f(0x37CF70),f(0x37CF74),f(0x37CF78)))
memory.write_u32_be(0x37CD70, (u32(0x37CD70) | 0x7FFFF), D)
local P={-80,2200,493}
local function place() for _,a in ipairs({0x37CF70,0x37C9F0,0x37CBE8,0x37CBF8,0x37CF80}) do wf(a,P[1]); wf(a+4,P[2]); wf(a+8,P[3]) end wf(0x37CE88,0); wf(0x37CE8C,0); wf(0x37CE90,0) end
place(); emu.frameadvance(); place()
local SCRIPT={{60,{},0,0},{4,{A=true},0,0},{150,{},0,0},{20,{A=true},0,0},{4,{},0,0},{60,{},0,-70},{60,{},0,0},{4,{B=true},0,0},{200,{},0,0},{60,{},0,70},{4,{Z=true},0,0},{120,{},0,0}}
o:write('frame,btn,sx,sy,gbtn,gsx,gsy,dtvi,gtime,x,y,z,vx,vy,vz,yaw,state,inwater,grounded,cam,cpx,cpy,cpz,crx,cry,gt,gt2\n')
local fr=0; local cj=io.open('/home/claude/emu/wv/flycam.jsonl','w')
for _,seg in ipairs(SCRIPT) do for i=1,seg[1] do
  joypad.set(seg[2],1); joypad.setanalog({['X Axis']=seg[3],['Y Axis']=seg[4]},1); emu.frameadvance(); fr=fr+1
  o:write(string.format('%d,-,%d,%d,%04X,%d,%d,%d,%d,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%X,%d,%d,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g',fr,seg[3],seg[4],
    u16(0x285734),s8(0x285736),s8(0x285737),u32(0x384E64),u32(0x37F2B8),f(0x37CF70),f(0x37CF74),f(0x37CF78),f(0x37CE88),f(0x37CE8C),f(0x37CE90),f(0x37D060),u32(0x37DB34),u8(0x37C931),u8(0x37C930),f(0x37E33C),
    f(0x37E328),f(0x37E32C),f(0x37E330),f(0x37E338),f(0x37E33C))); o:write(string.format(',%d,%d\n',u32(0x275478),u32(0x2762FC)))
  cj:write(fr..' '..camjson()..'\n')
end end
cj:close(); o:close(); lg:close(); client.exit()
