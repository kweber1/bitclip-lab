-- Claude 2026-11-11 (bt_objects.lua): Banjo-Tooie (USA) object dump for every map in MAPS ("0x10F,0xAF,..."), for the Bit-Clip Lab.
-- For each map: load START, request the warp the way gcgoto does (D_80127630: +0x10 map, +0x13 entrance, +0x12 warp bit), trying
-- entrances 1..4 and 0, wait until the map is loaded and 240 more frames have run, then write OUTD/objects-<map>.txt:
--   ACTOR idx x y z rx ry rz scale model prop flags   from the actor list D_80136EE0 (Vector of Actor, 0x9C bytes each:
--        +0x04 position f32[3], +0x38 scale, +0x44 rotation f32[3] (degrees), +0x00 marker (Unk80132ED0: +0x14 u16 model asset),
--        +0x6C prop id = bits 9..20)
--   CUBEPROP cx cy cz raw12  the cube grid's non-actor props (D_80128410 cubes; prop pool D_80132DB4), raw 12-byte records
-- and a screenshot. Status lines go to OUTD/objects-log.txt.
local OUT=os.getenv('OUTD'); local START=os.getenv('START'); local D='RDRAM'
local function u32(a) return memory.read_u32_be(a%0x800000,D) end
local function s32(a) return memory.read_s32_be(a%0x800000,D) end
local function s16(a) return memory.read_s16_be(a%0x800000,D) end
local function u16(a) return memory.read_u16_be(a%0x800000,D) end
local function u8(a) return memory.read_u8(a%0x800000,D) end
local function f(a) return memory.readfloat(a%0x800000,true,D) end
local function okp(p) return p>=0x80000000 and p<0x80800000 end
local lg=assert(io.open(OUT..'objects-log.txt','a')); local function L(fmt,...) local s=string.format(fmt,...); lg:write(os.date('%H:%M:%S ')..s..'\n'); lg:flush() end
local MAP,ENT=0,1; local REQ=false
event.onmemoryexecute(function() if not REQ then return end; local B=0x127630
  memory.write_u16_be(B+0x10,MAP,D); memory.write_u8(B+0x13,ENT,D); memory.write_u8(B+0x16,0,D); memory.write_u8(B+0x18,0,D); memory.write_u8(B+0x14,0,D); memory.write_u8(B+0x12,1,D); REQ=false end,0x8009B590,'warp')
local function dump(m)
  local o=assert(io.open(string.format('%sobjects-0x%X.txt',OUT,m),'w'))
  o:write(string.format('MAP 0x%X entrance %d\n',m,ENT))
  local V=u32(0x80136EE0); local n=0
  if okp(V) then local esz=s32(V); local b=u32(V+4); local e=u32(V+8)
    if esz>0 and okp(b) and e>=b then n=math.floor((e-b)/esz)
      for i=0,n-1 do local a=b+i*esz; local mk=u32(a); local model=okp(mk) and u16(mk+0x14) or 0
        o:write(string.format('ACTOR %d %.4f %.4f %.4f %.4f %.4f %.4f %.5f %04X %03X %08X %08X\n',i,f(a+4),f(a+8),f(a+12),f(a+0x44),f(a+0x48),f(a+0x4C),f(a+0x38),model,(u32(a+0x6C)>>9)&0xFFF,u32(a+0x64),okp(mk) and u32(mk+0x18) or 0)) end end end
  local C=0x80128410; local arr=u32(C); local mn={s32(C+4),s32(C+8),s32(C+12)}; local mx={s32(C+16),s32(C+20),s32(C+24)}; local st={s32(C+0x1C),s32(C+0x20)}
  local pool=u32(0x80132DB4); local esz=okp(pool) and s16(pool) or 0; local np=0
  local function cube(c,cx,cy,cz) local h=s16(c+4); local k=s16(c+6); if h==0 or k<=0 or k>4000 or not okp(pool) then return end
    local p=pool+h*esz+4; for j=0,k-1 do local a=p+12*j; if u8(a+11)%2==0 then local raw=''; for q=0,11 do raw=raw..string.format('%02X',u8(a+q)) end
      o:write(string.format('CUBEPROP %d %d %d %s\n',cx,cy,cz,raw)); np=np+1 end end end
  if okp(arr) and mx[1]-mn[1]<200 and mx[3]-mn[3]<200 and mx[2]-mn[2]<200 then
    for cz=mn[3],mx[3] do for cy=mn[2],mx[2] do for cx=mn[1],mx[1] do cube(arr+8*((cx-mn[1])+(cy-mn[2])*st[1]+(cz-mn[3])*st[2]),cx,cy,cz) end end end end
  cube(0x80128444,999,999,999)
  o:write(string.format('TOTAL actors %d cubeprops %d\n',n,np)); o:close(); return n,np end
pcall(client.speedmode,6400); pcall(client.SetSoundOn,false)
if movie.isloaded() then emu.frameadvance(); movie.stop() end
for ms in (os.getenv('MAPS') or ''):gmatch('[^,]+') do MAP=tonumber(ms); local ok=false
  for _,e in ipairs({1,2,3,4,0}) do ENT=e; savestate.load(START); for i=1,10 do emu.frameadvance() end; REQ=true; local since=-1
    for fr=1,2400 do local k={}; if fr%50<2 then k={A=true} end; joypad.set(k,1); emu.frameadvance()
      if u16(0x132DC2)==MAP then if since<0 then since=fr end; if fr-since>=240 then ok=true; break end end end
    if ok then break end end
  if ok then local n,np=dump(MAP); client.screenshot(string.format('%sobjects-0x%X.png',OUT,MAP)); L('0x%X entrance %d: %d actors, %d cube props',MAP,ENT,n,np)
  else L('0x%X: could not warp (map now %X)',MAP,u16(0x132DC2)) end end
lg:close(); local h=assert(io.open(OUT..'status.txt','w')); h:write('DONE\n'); h:close(); client.exit()
