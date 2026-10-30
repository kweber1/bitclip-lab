"""Claude 2026-10-30: mesh lists (uid -> vertex indices) of every map's opaque/transparent model, PAL ROM. Water waves = uid 300-399."""
import hashlib,importlib.util,json,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def module(name,path):
 s=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
assets=module('assets50','scripts/inspect-810.py')
rom=(ROOT/'roms/banjo.eu.pal.z64').read_bytes()
A=assets.Assets(rom)
table=None
for offset,data in assets.code_streams(rom,A.base+A.entries[-1][0]):
 j=data.find(struct.pack('>3H',0x93,0xD6D,0xD71))
 if j>=0: table=(data,j);break
data,j=table
start=j
while start-24>=0 and 0<struct.unpack_from('>H',data,start-24)[0]<0xA0: start-=24
out={}
pos=start
while pos+6<=len(data):
 m,o,t=struct.unpack_from('>3H',data,pos)
 if not(0<m<0xA0):break
 res={}
 for kind,aid in (('opa',o),('xlu',t)):
  if not aid: continue
  try: b=A.get(aid)
  except Exception as e: continue
  if struct.unpack_from('>I',b)[0]!=11: continue
  mo=struct.unpack_from('>i',b,0x24)[0]
  if not mo: continue
  n=struct.unpack_from('>h',b,mo)[0]; p=mo+2; ms=[]
  for i in range(n):
   uid,c=struct.unpack_from('>2h',b,p); v=list(struct.unpack_from('>%dh'%c,b,p+4)); p+=4+2*c; ms.append([uid,v])
  res[kind]=ms
 if res: out['0x%02X'%m]=res
 pos+=24
(ROOT/'work/meshes/meshes.json').write_text(json.dumps(out))
for k,v in out.items(): print(k,{kk:[u for u,_ in vv] for kk,vv in v.items()})
