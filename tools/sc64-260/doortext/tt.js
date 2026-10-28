// door-text trigger search: two consecutive long updates right after Banjo first comes within 290 (3D) of the 260 door
'use strict';
const fs=require('fs'),zlib=require('zlib'),path=require('path');global.self=global;
const ROOT='/home/claude/bitclip-lab';
const BK=require(ROOT+'/bkcol.js');global.BK=BK;global.BKMOVE=require(ROOT+'/bkmove.js');global.BKSEARCH=require(ROOT+'/bksearch.js');
const BKCLIP=require('./bkclipsetup_tt.js');
const room=JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT+'/data/map0x71.gz.wasm')));
const world=new BK.World(BK.load_model(room.opa,'opa'),room.xlu?BK.load_model(room.xlu,'xlu'):null,BK.load_props(room.props||[]),0x71);
const DOOR=[3845,1250,281], R=+process.env.R||290;
const ring=JSON.parse(fs.readFileSync('ring.json'));
const part=+process.argv[2], nparts=+process.argv[3], step=+process.argv[4]||3;
const out=fs.createWriteStream(`tt-${part}.jsonl`);
const dist=(p)=>Math.hypot(p[0]-DOOR[0],p[1]-DOOR[1],p[2]-DOOR[2]);
(async()=>{
 const idx=[];for(let i=0;i<ring.length;i+=step)idx.push(i);
 for(let n=part;n<idx.length;n+=nparts){const a=ring[idx[n]];const t0=Date.now();
  const res=await BKCLIP.solve({world,map:0x71,version:'PAL',target:{x:a[0],y:a[1],z:a[2]},move:'punchCancel',
    ranges:{cancel:[1,2,3],aHold:[3,4,5,6,7,8,9,10,12,14]},dirs:+process.env.DIRS||8,cam:0,
    patterns:(k)=>{const L=[[]];for(let u=Math.max(0,k-3);u<k+8;u++)L.push([u,u+1]);return L;}});
  let nclip=0,ntrig=0;
  for(const r of res.results){ if(r.kind!=='clip'||r.lag.length!==2)continue; nclip++;
    const d0=dist(r.start); const tr=r.trace; let first=-1; for(let i=0;i<tr.length;i++){if(dist(tr[i])<R){first=i;break;}}
    const l0=r.lag[0]-1; // 0-based first long update
    const rec={spot:[a[0],a[1],a[2]],seam:a[3],facing:r.facing,c:r.param.c+1,h:r.param.h,lag:r.lag,startDist:+d0.toFixed(2),first,off:first<0?null:l0-first,
      dists:tr.slice(0,Math.max(first+3,l0+2)).map(p=>+dist(p).toFixed(1)),start:r.start,startBits:r.startBits};
    if(d0>=R && first>=0 && (l0-first===1||l0-first===0)) {ntrig++; rec.TRIG=true;}
    out.write(JSON.stringify(rec)+'\n');}
  console.error(`${n}/${idx.length} spot ${a[0]},${a[2]} d${dist(a).toFixed(0)} arrived ${res.arrived} results ${res.results.length} clip2 ${nclip} trig ${ntrig} ${((Date.now()-t0)/1000).toFixed(0)}s`);
 }
 out.end();
})();
