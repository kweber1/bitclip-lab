-- generic probe: J18 / force B+48 at spot 1, then segments from PROBES table; prints trace after the crossing
local D='RDRAM'
local BOX=0x80480BFC; local TRACE=0x80480DFC
local function rd(a) return memory.read_u32_be(a%0x800000,D) end
local function wr(a,v) memory.write_u32_be(a%0x800000,v,D) end
local spack,sunpack=string.pack,string.unpack
local function f32(x) return (sunpack('<f',spack('<f',x))) end
local function fb2(b) return (sunpack('<f',spack('<I4',b))) end
local function bits(x) return (sunpack('<I4',spack('<f',x))) end
local MAP=0x80383fb4
local OUT=os.getenv('POUT') or '/home/claude/emu/pal6/probe.txt'
local lg=assert(io.open(OUT,'w'))
local STICK=nil; local cross=nil; local fr=0
local TXW=nil
local function adv()
  joypad.set({},1)
  if TXW==nil and CLEARTEXT and memory.readbyte(0x383BCE,D)&1==1 and WATCHON then TXW=string.format('flag set at pos %.0f,%.0f,%.0f state %02X', fb2(rd(0x8037CF70)),fb2(rd(0x8037CF74)),fb2(rd(0x8037CF78)), rd(0x8037DB34)&0xff) end
  if STICK then
    local y=fb2(rd(0x8037CF74)); fr=fr+1
    if not cross and y<1140 and y>1000 then cross=fr end
    local ax,ay=0,0
    if cross then ax,ay=STICK(fr-cross) end
    joypad.setanalog({['X Axis']=ax,['Y Axis']=ay},1)
  end
  emu.frameadvance() end
local function pw(btn, sx, sy) return ((btn & 0xFFFF) << 16) | ((sx & 0xFF) << 8) | (sy & 0xFF) end
local Btn={A=0x8000,B=0x4000,Z=0x2000}
local ok,err=xpcall(function()
pcall(client.speedmode,1600)
for i=1,3000 do adv(); if rd(MAP)~=0 and rd(0x8037f2b4)==3 and i>600 then break end end
for i=1,200 do adv() end
local seq=100
local function job(w)
  for i=0,62 do wr(BOX+i*4, w[i] or 0) end
  seq=seq+1; wr(BOX+63*4, seq)
  for i=1,20000 do adv(); if rd(BOX+127*4)==seq then break end end
  local r={}; for i=0,63 do r[i]=rd(BOX+(64+i)*4) end; return r
end
job({[0]=0x504C4A31,[1]=0}); job({[0]=0x504C4A31,[1]=1,[3]=1,[4]=0x71,[5]=0x3C}); wr(0x8037CD70,0x1FFFFF)
local function run(segs, label, J, K, runmax, stick)
  if rd(MAP)&0xff ~= 0x71 then job({[0]=0x504C4A31,[1]=1,[3]=1,[4]=0x71,[5]=0x3C}); wr(0x8037CD70,0x1FFFFF) end
  STICK=stick; cross=nil; fr=0
  TXW=nil; WATCHON=true
  if CLEARTEXT then local b=memory.readbyte(0x383BCE,D); memory.writebyte(0x383BCE, b & 0xFE, D) end
  lg:write(string.format('pre: textflag byte %02X fileprog byte %02X\n', memory.readbyte(0x383BCE,D), memory.readbyte(0x37CBB2,D)))
  local w={[0]=0x504C4A31,[1]=2,[2]=1+4+(K==0 and 0 or 16),[3]=bits(f32(3391.24951+40)),[4]=bits(f32(252.128098)),[5]=bits(f32(1250)),[6]=0,
    [7]=0x4553F3FE,[8]=0x4379E6A1,[9]=40,[10]=30,[11]=2,[12]=2,[13]=J or 18,[16]=runmax or 200,[17]=0,[19]=#segs,[52]=0,[53]=K or 48,[54]=3}
  for i,s in ipairs(segs) do w[20+(i-1)*2]=(s[1]<<16)|s[2]; w[21+(i-1)*2]=s[3] end
  local r=job(w)
  STICK=nil
  lg:write(string.format('=== %s cross@%s  status %d forcedat %d miny %.1f map %02X\n', label, tostring(cross), r[2], r[30], fb2(r[24]), rd(MAP)&0xff))
  local out={}
  for i=0,r[25]-1 do local b=TRACE+i*20; local x,y,z=fb2(rd(b)),fb2(rd(b+4)),fb2(rd(b+8)); local fl=rd(b+12); local rel=rd(b+16)-r[27]+2
    if rel>=44 then out[#out+1]=string.format('%d:%.0f,%.0f,%.0f s%02X d%d', rel, x,y,z, (fl>>16)&255, (fl>>24)&255) end end
  if not SUMMARY then lg:write(table.concat(out,' | ')..'\n') end
  local best=nil; local maxx=-1e9; local popx=nil
  for i=0,r[25]-1 do local b=TRACE+i*20; local x,y,z=fb2(rd(b)),fb2(rd(b+4)),fb2(rd(b+8)); local rel=rd(b+16)-r[27]+2
    if rel>56 then if y<1249 and x>maxx then maxx=x end
      if y>=1249 and not popx then popx=string.format('%.0f,%.0f@%d',x,z,rel) end end end
  lg:write(tostring(TXW)..'\n'); lg:write(string.format('post: textflag %02X fileprog %02X\n', memory.readbyte(0x383BCE,D), memory.readbyte(0x37CBB2,D))); local fx,fy,fz=fb2(rd(0x8037CF70)),fb2(rd(0x8037CF74)),fb2(rd(0x8037CF78)); lg:write(string.format('SUM %s | maxx_under %.0f | pop %s | end map %02X pos %.0f,%.0f,%.0f\n', label, maxx, tostring(popx), rd(MAP)&0xff, fx,fy,fz)); lg:flush()
  return r
end
PROBES(run, pw, Btn)
end,debug.traceback)
lg:write(ok and 'DONE\n' or ('ERROR '..tostring(err)..'\n')); lg:close(); client.exit()
