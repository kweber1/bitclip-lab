-- Claude 2026-11-11 (bt_nodes.lua): Banjo-Tooie (USA) spawn-point dump for every map in MAPS, for the Bit-Clip Lab objects layer.
-- Same warp as bt_objects.lua. Each cube of the cube grid D_80128410 is 8 bytes: +0 s16 handle / +2 s16 count of the first list
-- (spawn points, incl. enemies not spawned yet; pool D_80132DB0, 20-byte records), +4 / +6 the prop list bt_objects.lua already
-- dumps (pool D_80132DB4). Element h of a pool is at pool + h*esz + 4 (esz = s16 at pool+0). Writes OUTD/nodes-<map>.txt:
--   CUBE cx cy cz h1 n1 h2 n2
--   N1 cx cy cz k <raw 32 bytes from the list start + k*0x14>   (stride checked offline)
-- and, with DUMPRAM=1, the whole RDRAM of the first map to OUTD/rdram-<map>.bin (to find the actor-type registry offline).
local OUT=os.getenv('OUTD'); local START=os.getenv('START'); local D='RDRAM'
local function u32(a) return memory.read_u32_be(a%0x800000,D) end
local function s32(a) return memory.read_s32_be(a%0x800000,D) end
local function s16(a) return memory.read_s16_be(a%0x800000,D) end
local function u16(a) return memory.read_u16_be(a%0x800000,D) end
local function u8(a) return memory.read_u8(a%0x800000,D) end
local function okp(p) return p>=0x80000000 and p<0x80800000 end
local lg=assert(io.open(OUT..'nodes-log.txt','a')); local function L(fmt,...) local s=string.format(fmt,...); lg:write(os.date('%H:%M:%S ')..s..'\n'); lg:flush() end
local MAP,ENT=0,1; local REQ=false
event.onmemoryexecute(function() if not REQ then return end; local B=0x127630
  memory.write_u16_be(B+0x10,MAP,D); memory.write_u8(B+0x13,ENT,D); memory.write_u8(B+0x16,0,D); memory.write_u8(B+0x18,0,D); memory.write_u8(B+0x14,0,D); memory.write_u8(B+0x12,1,D); REQ=false end,0x8009B590,'warp')
local function hex(a,n) local t={}; for q=0,n-1 do t[#t+1]=string.format('%02X',u8(a+q)) end; return table.concat(t) end
local function dumpram(m)
  local f=assert(io.open(string.format('%srdram-0x%X.bin',OUT,m),'wb'))
  for base=0,0x7FFFFF,0x10000 do local t=memory.read_bytes_as_array(base,0x10000,D); local parts={}
    for i=1,#t,4096 do parts[#parts+1]=string.char(table.unpack(t,i,math.min(#t,i+4095))) end; f:write(table.concat(parts)) end
  f:close() end
local function dump(m)
  local o=assert(io.open(string.format('%snodes-0x%X.txt',OUT,m),'w'))
  o:write(string.format('MAP 0x%X entrance %d\n',m,ENT))
  local C=0x80128410; local arr=u32(C); local mn={s32(C+4),s32(C+8),s32(C+12)}; local mx={s32(C+16),s32(C+20),s32(C+24)}; local st={s32(C+0x1C),s32(C+0x20)}
  local pool=u32(0x80132DB4); local esz=okp(pool) and s16(pool) or 0; local nn=0
  local npool=u32(0x80132DB0); local nesz=okp(npool) and s16(npool) or 0   -- spawn points: 20-byte records (s16 x y z, u16 kind, u16 id, ...)
  o:write(string.format('GRID %08X min %d %d %d max %d %d %d strides %d %d pool %08X esz %d\n',arr,mn[1],mn[2],mn[3],mx[1],mx[2],mx[3],st[1],st[2],pool,esz))
  local function cube(c,cx,cy,cz) local h1=s16(c); local n1=s16(c+2); local h2=s16(c+4); local n2=s16(c+6)
    if (h1==0 or n1<=0) and (h2==0 or n2<=0) then return end
    o:write(string.format('CUBE %d %d %d %d %d %d %d\n',cx,cy,cz,h1,n1,h2,n2))
    if h1~=0 and n1>0 and n1<2000 and okp(npool) then local p=npool+h1*nesz+4
      for k=0,n1-1 do o:write(string.format('N1 %d %d %d %d %s\n',cx,cy,cz,k,hex(p+k*nesz,nesz))); nn=nn+1 end end end
  if okp(arr) and mx[1]-mn[1]<200 and mx[3]-mn[3]<200 and mx[2]-mn[2]<200 then
    for cz=mn[3],mx[3] do for cy=mn[2],mx[2] do for cx=mn[1],mx[1] do cube(arr+8*((cx-mn[1])+(cy-mn[2])*st[1]+(cz-mn[3])*st[2]),cx,cy,cz) end end end end
  cube(0x80128444,999,999,999)
  o:write(string.format('TOTAL nodes %d\n',nn)); o:close(); return nn end
pcall(client.speedmode,6400); pcall(client.SetSoundOn,false)
if movie.isloaded() then emu.frameadvance(); movie.stop() end
local first=true
for ms in (os.getenv('MAPS') or ''):gmatch('[^,]+') do MAP=tonumber(ms); local ok=false
  for _,e in ipairs({1,2,3,4,0}) do ENT=e; savestate.load(START); for i=1,10 do emu.frameadvance() end; REQ=true; local since=-1
    for fr=1,2400 do local k={}; if fr%50<2 then k={A=true} end; joypad.set(k,1); emu.frameadvance()
      if u16(0x132DC2)==MAP then if since<0 then since=fr end; if fr-since>=240 then ok=true; break end end end
    if ok then break end end
  if ok then local nn=dump(MAP); L('0x%X entrance %d: %d spawn-list entries',MAP,ENT,nn)
    if os.getenv('DUMPRAM')=='2' then dumpram(MAP); L('0x%X rdram dumped',MAP) end; first=false
  else L('0x%X: could not warp (map now %X)',MAP,u16(0x132DC2)) end end
lg:close(); local h=assert(io.open(OUT..'status.txt','w')); h:write('DONE\n'); h:close(); client.exit()
