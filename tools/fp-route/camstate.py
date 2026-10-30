# read the camera state from a BizHawk Mupen64Plus savestate (core.bin = decompressed Core.bin.zst)
import json,sys
from ram import RAM
r=RAM(sys.argv[1] if len(sys.argv)>1 else 'core.bin')
A={'D948':0x8037E318,'pos':0x8037E328,'rot':0x8037E338,'D974':0x8037E344,'D978':0x8037E348,'D97C':0x8037E34C,'D980':0x8037E350,'D994':0x8037E364,'D998':0x8037E368,'D99C':0x8037E36C,'D9A0':0x8037E370,
 'D9A8':0x8037E378,'D9B8':0x8037E388,'D9C8':0x8037E398,'D9D4':0x8037E3A4,'D9D8':0x8037E3A8,'D9E0':0x8037E3B0,'D9EC':0x8037E3BC,'D9F0':0x8037E3C0,'DB70':0x8037E540,'DB78':0x8037E548,'DB84':0x8037E554,'DB90':0x8037E560,'DB9C':0x8037E56C}
V3={'D948','pos','rot','D9A8','D9B8','D9C8','D9E0','DB78','DB84','DB90'}
s={}
for k,a in A.items(): s[k]=[r.f(a+4*i) for i in range(3)] if k in V3 else r.f(a)
s['D9F6']=r.u8(0x8037E3C6); s['state']=r.u8(0x8037E3C4)
s['player']={'pos':[r.f(0x8037CF70+4*i) for i in range(3)],'yaw':r.f(0x8037D060)}
print(json.dumps(s))
