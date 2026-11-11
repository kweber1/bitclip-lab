-- Claude 2026-11-11 (bt_jump.lua): Banjo-Tooie (USA) jump profile: from START (Banjo idle) press A for HOLD frames (several values),
-- log every player resolver call (old y, target y, displacement y = a3[1], result y, VI count of the update, state) until he lands.
-- Output OUTD/jump.txt.
local OUT=os.getenv('OUTD'); local START=os.getenv('START'); local D='RDRAM'
local function u(a) return memory.read_u32_be(a%0x800000,D) end
local function u8(a) return memory.read_u8(a%0x800000,D) end
local function f(a) return memory.readfloat(a%0x800000,true,D) end
local function okp(p) return p>=0x80000000 and p<0x80800000 end
local BTN={'A','B','Z','Start','L','R','C Up','C Down','C Left','C Right','DPad U','DPad D','DPad L','DPad R'}
local function ps() for i=0,7 do local p=u(0x135490+4*i); if okp(p) then return p end end return 0 end
local function ctx() local p=ps(); return okp(p) and u(p+0x94) or 0 end
local o=assert(io.open(OUT..'jump.txt','w')); local E=nil; local CALLS={}
event.onmemoryexecute(function() local c=emu.getregister('a0_lo')%0x100000000; if c~=ctx() then E=nil; return end
  local a1=emu.getregister('a1_lo')%0x100000000; local a2=emu.getregister('a2_lo')%0x100000000; local a3=emu.getregister('a3_lo')%0x100000000
  E={c=c,a2=a2,oy=f(a1+4),ty=f(a2+4),dy=f(a3+4),h0=u8(c+0x55)} end,0x800D4584,'jump entry')
event.onmemoryexecute(function() if not E then return end; local p=ps(); local st=u(p+0x120); local c8=u(p+0xC8)
  CALLS[#CALLS+1]={oy=E.oy,ty=E.ty,dy=E.dy,ry=f(E.a2+4),vi=u(0x12C764),st=okp(st) and u(st+4) or -1,vy=f(c8+0x14),gr=f(c8+0x34),term=f(c8+0x38),gnd=u8(E.c+0x56)}; E=nil end,0x800D4D24,'jump exit')
local function step(keys) local p={}; for _,k in ipairs(BTN) do p[k]=false end; for k,v in pairs(keys or {}) do p[k]=v end
  joypad.setanalog({['X Axis']=0,['Y Axis']=0},1); joypad.set(p,1); emu.frameadvance() end
pcall(client.speedmode,6400); pcall(client.SetSoundOn,false)
if movie.isloaded() then emu.frameadvance(); movie.stop() end
savestate.load(START); for i=1,10 do step() end
local S0=memorysavestate.savecorestate()
for _,hold in ipairs({1,2,4,6,8,10,14,20,30,60}) do memorysavestate.loadcorestate(S0); for i=1,4 do step() end; CALLS={}
  for i=1,hold do step({A=true}) end; for i=1,200 do step() end
  local y0=CALLS[1] and CALLS[1].oy or 0; local apex=-1e9; for _,c in ipairs(CALLS) do if c.ry>apex then apex=c.ry end end
  o:write(string.format('HOLD %d frames: start y %.4f apex %.4f (+%.4f), %d updates\n',hold,y0,apex,apex-y0,#CALLS))
  for i,c in ipairs(CALLS) do o:write(string.format('  %d vi %d st %X oy %.4f ty %.4f dy %.5f -> %.4f | vy %.4f grav %.2f term %.2f gnd %d\n',i,c.vi,c.st,c.oy,c.ty,c.dy,c.ry,c.vy,c.gr,c.term,c.gnd))
    if i>3 and c.gnd==1 and c.ry<=y0+0.01 then break end end
  o:flush() end
o:close(); local h=assert(io.open(OUT..'status.txt','w')); h:write('DONE\n'); h:close(); client.exit()
