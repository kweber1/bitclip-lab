-- Emulator check of the PAL SC64 agent v6 (BK-Snapper-PAL-Practice-SC64-v6.z64) before it goes on the console:
-- boot, PING (version 6), ROOM to MAP 0x71 entry 1 with the 260 door flag (0x3C) cleared, then punch cancels at the
-- nearest 260 census clip spot from the clip-setup start floats: plain (BizHawk never lags: expect a hold, no clip)
-- and with one forced 3-frame (0.06 s) update from B+k (v6 F_FORCE, DIAGNOSTIC) for k = 36..50.
-- Writes agent-v6-check.txt next to this script. Run: EmuHawk --lua=bk_pal_agent_v6_check.lua BK-Snapper-PAL-Practice-SC64-v6.z64
local DIR0=(debug.getinfo(1,"S").source:match("^@(.*[/\\])") or "")
local D='RDRAM'
local BOX=0x80480BFC; local TRACE=0x80480DFC; local PAL=0x80480A50   -- v6 symbols (pal_box, pal_trace, pal)
local function rd(a) return memory.read_u32_be(a%0x800000,D) end
local function wr(a,v) memory.write_u32_be(a%0x800000,v,D) end
local spack,sunpack=string.pack,string.unpack
local function f32(x) return (sunpack('<f',spack('<f',x))) end
local function fb2(b) return (sunpack('<f',spack('<I4',b))) end
local function bits(x) return (sunpack('<I4',spack('<f',x))) end
local lg=assert(io.open(DIR0..'agent-v6-check.txt','w'))
local function L(fmt,...) lg:write(string.format(fmt,...)..'\n'); lg:flush() end
local function adv(n) for i=1,(n or 1) do joypad.set({},1); emu.frameadvance() end end
local ok,err=xpcall(function()
pcall(client.speedmode,800); pcall(client.SetSoundOn,false)
L('rom %s', gameinfo.getromhash())
for i=1,3000 do adv(1); if rd(0x80383fb4)~=0 and rd(0x8037f2b4)==3 and i>600 then break end end
adv(200)
L('boot: map %02X mode %d pal.present %d', rd(0x80383fb4), rd(0x8037f2b4), rd(PAL))
local seq=100
local function job(w)
  for i=0,62 do wr(BOX+i*4, w[i] or 0) end
  seq=seq+1; wr(BOX+63*4, seq)
  for i=1,20000 do adv(1); if rd(BOX+127*4)==seq then break end end
  local r={}; for i=0,63 do r[i]=rd(BOX+(64+i)*4) end
  return r
end
local r=job({[0]=0x504C4A31,[1]=0})
L('PING status %d version %d map %02X mode %d present %d', r[2], r[3], r[4], r[5], r[20])
r=job({[0]=0x504C4A31,[1]=1,[3]=1,[4]=0x71,[5]=0x3C})
L('ROOM status %d map %02X mode %d load VI %d', r[2], r[4], r[5], r[21])
-- spot 1: (3391.24951, 1250, 252.128098), 455 from the 260 door; clip setup facing 0: start bits 4553F3FE 4379E6A1,
-- B, A on update 2 held 7 updates (J 14 VI); the host model says one long update starting at B+42 or B+44 clips.
-- yaw is written as exactly 0 here (the console scripts use facing + 0.5 and calibrate the origin on the console).
local sx,sz,fy=fb2(0x4553F3FE),fb2(bits(f32(252.128098))),1250
local ox,oz=0x4553F3FE,0x4379E6A1
local function test(J, pokeK)
  local w={[0]=0x504C4A31,[1]=2,[2]=1+4,[3]=bits(f32(3391.24951+40)),[4]=bits(f32(252.128098)),[5]=bits(f32(fy)),[6]=0,
    [7]=ox,[8]=oz,[9]=40,[10]=30,[11]=2,[12]=2,[13]=J,[14]=0,[15]=0,[16]=110,[17]=0,[19]=0}
  if pokeK then w[2]=w[2]+16; w[52]=0; w[53]=pokeK; w[54]=3 end
  local r=job(w)
  local ys={}
  for i=0,r[25]-1 do local b=TRACE+i*20; local v=rd(b+16); local rel=v-r[27]
    if rel>=30 and rel<=60 then ys[#ys+1]=string.format('%d:%.1f/%d', rel, fb2(rd(b+4)), (rd(b+12)>>24)&255) end
  end
  return r, table.concat(ys,' ')
end
local r0,ys=test(14,nil)
L('plain J14: status %d b_vi %d miny %.2f clip %d | %s', r0[2], r0[27], fb2(r0[24]), r0[26], ys)
for k=36,50,1 do
  local r,ys=test(14, k)
  L('forced 3 frames from B+%d (forced at B+%d): status %d miny %.2f clip %d | %s', k, r[30], r[2], fb2(r[24]), r[26], ys)
end
end,debug.traceback)
L(ok and 'DONE' or ('ERROR '..tostring(err))); lg:close(); client.exit()
