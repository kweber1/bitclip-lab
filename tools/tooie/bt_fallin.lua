-- Claude 2026-11-11 (bt_fallin.lua): Banjo-Tooie (USA) "fall into a crack from rest" test, the emulator ground truth for the
-- Tooie bit-clip census. For every spot in SPOTS ("x y z seam tag" per line, crack floats from census_gpu): load START (Banjo idle in
-- the same map), write Banjo's feet = (x, y, z) exactly (all three posInfo copies) and velocity = 0 inside the physics-update hook
-- (func_8009B590), then let the game run NVI video frames with no input. Every player collision-resolver call (func_800D4584 entry /
-- exit 0x800D4D24) is logged: old / target / result feet, passes that hit (ctx+0x55 delta), held flag (ctx+0x54), grounded (ctx+0x56),
-- floor-tracker floor y (+0x70), vertical velocity, update length in VIs and the player state.
-- Output OUTD/fallin.txt: one "SPOT" line per spot with the outcome, then its per-update "U" lines.
--   outcome: CLIP  = feet end more than 115 below the spot (whole sphere under the floor) and still under it;
--            EJECT = feet end at or above the spot's floor (pushed back out / landed on top);
--            STUCK = anything else (between, or the floor tracker found the floor at once: NOMISS).
local OUT=os.getenv('OUTD'); local START=os.getenv('START'); local SPOTS=os.getenv('SPOTS'); local NVI=tonumber(os.getenv('NVI') or '150')
local D='RDRAM'
local function u(a) return memory.read_u32_be(a%0x800000,D) end
local function u8(a) return memory.read_u8(a%0x800000,D) end
local function f(a) return memory.readfloat(a%0x800000,true,D) end
local function wf(a,v) memory.writefloat(a%0x800000,v,true,D) end
local function okp(p) return p>=0x80000000 and p<0x80800000 end
local spack,sunpack=string.pack,string.unpack
local function bits(x) return (sunpack('<I4',spack('<f',x))) end
local function f32(x) return (sunpack('<f',spack('<f',x))) end
local BTN={'A','B','Z','Start','L','R','C Up','C Down','C Left','C Right','DPad U','DPad D','DPad L','DPad R'}
local function ps() for i=0,7 do local p=u(0x135490+4*i); if okp(p) then return p end end return 0 end
local function ctx() local p=ps(); return okp(p) and u(p+0x94) or 0 end
local o=assert(io.open(OUT..'fallin.txt','w')); local function W(fmt,...) o:write(string.format(fmt,...)..'\n') end
local E=nil; local CALLS={}; local LOG=false
event.onmemoryexecute(function() if not LOG then return end; local c=emu.getregister('a0_lo')%0x100000000; if c~=ctx() then E=nil; return end
  local a1=emu.getregister('a1_lo')%0x100000000; local a2=emu.getregister('a2_lo')%0x100000000; local a3=emu.getregister('a3_lo')%0x100000000
  E={c=c,a2=a2,oy=f(a1+4),ty=f(a2+4),vy=f(a3+4),h0=u8(c+0x55)} end,0x800D4584,'fall entry')
event.onmemoryexecute(function() if not E then return end; local c=E.c; local t=u(c); local p=ps(); local st=u(p+0x120)
  CALLS[#CALLS+1]={oy=E.oy,ty=E.ty,vy=E.vy,rx=f(E.a2),ry=f(E.a2+4),rz=f(E.a2+8),hits=(u8(c+0x55)-E.h0)%256,held=u8(c+0x54),gnd=u8(c+0x56),
    floor=okp(t) and f(t+0x70) or 0,vi=u(0x12C764),state=okp(st) and u(st+4) or -1}; E=nil end,0x800D4D24,'fall exit')
local PEND=nil
event.onmemoryexecute(function() if not PEND then return end; local p=ps(); local a0=emu.getregister('a0_lo'); if a0 and (a0%0x100000000)~=p then return end
  local pi=u(p+0xE4); for k=0,2 do wf(pi+12*k,PEND[1]); wf(pi+12*k+4,PEND[2]); wf(pi+12*k+8,PEND[3]) end
  local c8=u(p+0xC8); for k=0,2 do wf(c8+0x10+4*k,0) end; PEND=nil; LOG=true end,0x8009B590,'place')
local function step() local p={}; for _,k in ipairs(BTN) do p[k]=false end; joypad.setanalog({['X Axis']=0,['Y Axis']=0},1); joypad.set(p,1); emu.frameadvance() end
pcall(client.speedmode,6400); pcall(client.SetSoundOn,false)
if movie.isloaded() then emu.frameadvance(); movie.stop() end
savestate.load(START); for i=1,10 do step() end
local S0=memorysavestate.savecorestate()
local n=0; local cnt={CLIP=0,EJECT=0,STUCK=0,NOMISS=0}
for line in io.lines(SPOTS) do local a={}; for w in line:gmatch('%S+') do a[#a+1]=w end
  if #a>=3 then n=n+1; local x,y,z=f32(tonumber(a[1])),f32(tonumber(a[2])),f32(tonumber(a[3]))
    memorysavestate.loadcorestate(S0); CALLS={}; LOG=false; E=nil; PEND={x,y,z}
    local fr=0; local miny=1e9
    while fr<NVI do step(); fr=fr+1; local c=CALLS[#CALLS]
      if c then if c.ry<miny then miny=c.ry end; if c.ry<y-600 then break end end end
    local first=CALLS[1]; local last=CALLS[#CALLS]; local out
    local nh5,maxhits,nheld=0,0,0; for _,c in ipairs(CALLS) do if c.hits>=5 then nh5=nh5+1 end; if c.hits>maxhits then maxhits=c.hits end; if c.held~=0 then nheld=nheld+1 end end
    if not last then out='NONE'
    elseif first and first.floor>-10000 and math.abs(first.floor-y)<2 and miny>y-2 then out='NOMISS'
    elseif last.ry<y-115 then out='CLIP'
    elseif last.ry>=y-0.5 then out='EJECT' else out='STUCK' end
    cnt[out]=(cnt[out] or 0)+1
    W('SPOT %d %s %s %s %s %s | %s | updates %d end (%.4f, %.4f, %.4f) min y %.3f | 5-hit updates %d max hits %d held-flag updates %d | first floor y %.2f',
      n,a[1],a[2],a[3],a[4] or '',a[5] or '',out,#CALLS,last and last.rx or 0,last and last.ry or 0,last and last.rz or 0,miny,nh5,maxhits,nheld,first and first.floor or 0)
    for i,c in ipairs(CALLS) do W('U %d vi %d st %X oy %.4f ty %.4f vy %.2f -> (%.5f, %.4f, %.5f) hits %d held %d gnd %d floor %.2f',i,c.vi,c.state,c.oy,c.ty,c.vy,c.rx,c.ry,c.rz,c.hits,c.held,c.gnd,c.floor) end
    if n%25==0 then o:flush() end end end
W('TOTAL %d spots: CLIP %d EJECT %d STUCK %d NOMISS %d',n,cnt.CLIP,cnt.EJECT,cnt.STUCK,cnt.NOMISS)
o:close(); local h=assert(io.open(OUT..'status.txt','w')); h:write(string.format('DONE %d CLIP %d EJECT %d STUCK %d NOMISS %d\n',n,cnt.CLIP,cnt.EJECT,cnt.STUCK,cnt.NOMISS)); h:close(); client.exit()
