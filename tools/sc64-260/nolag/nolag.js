'use strict';
const fs=require('fs'),zlib=require('zlib');global.self=global;
const ROOT=__dirname;
const BK=require(ROOT+'/bkcol.js');global.BK=BK;global.BKMOVE=require(ROOT+'/bkmove.js');global.BKSEARCH=require(ROOT+'/bksearch.js');
const BKCLIP=require(__dirname+'/bkclipsetup_tt.js');
const room=JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT+'/data/map0x71.gz.wasm')));
const world=new BK.World(BK.load_model(room.opa,'opa'),room.xlu?BK.load_model(room.xlu,'xlu'):null,BK.load_props(room.props||[]),0x71);
const spots=JSON.parse(fs.readFileSync(__dirname+'/ring3.json'));
const part=+process.argv[2], nparts=+process.argv[3];
const out=fs.createWriteStream(__dirname+`/out/nolag-${part}.jsonl`,{flags:'a'});
const D=[3845,1250,281];
(async()=>{
 for(let n=part;n<spots.length;n+=nparts){const a=spots[n];const t0=Date.now();
  let res;
  try{ res=await BKCLIP.solve({world,map:0x71,version:'PAL',target:{x:a[0],y:a[1],z:a[2]},move:'punchCancel',
    ranges:{cancel:[1,2,3,4],aHold:[2,3,4,5,6,7,8,9,10,11,12,14]},dirs:8,cam:0,patterns:(k)=>[[]]}); }catch(e){console.error(n,'err',e.message);continue;}
  const cl=res.results.filter(r=>r.kind==='clip');
  for(const r of cl) out.write(JSON.stringify({spot:a.slice(0,4),dist:Math.hypot(a[0]-D[0],a[2]-D[2]).toFixed(0),facing:r.facing,c:r.param.c+1,h:r.param.h,holds:r.holds,noHold:r.noHold,endY:r.endY,start:r.start,startBits:r.startBits})+'\n');
  console.error(`${n}/${spots.length} ${a[0].toFixed(1)},${a[2].toFixed(1)} seam ${a[3]} arrived ${res.arrived} holds ${res.results.length-cl.length} clips ${cl.length} ${((Date.now()-t0)/1000).toFixed(0)}s`);
 }
 out.end();
})();
