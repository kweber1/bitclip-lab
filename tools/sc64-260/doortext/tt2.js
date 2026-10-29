'use strict';
const fs=require('fs'),zlib=require('zlib');global.self=global;
const ROOT='/home/claude/bitclip-lab';
const BK=require(ROOT+'/bkcol.js');global.BK=BK;global.BKMOVE=require(ROOT+'/bkmove.js');global.BKSEARCH=require(ROOT+'/bksearch.js');
const BKCLIP=require('./bkclipsetup_tt.js');
const room=JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT+'/data/map0x71.gz.wasm')));
const world=new BK.World(BK.load_model(room.opa,'opa'),room.xlu?BK.load_model(room.xlu,'xlu'):null,BK.load_props(room.props||[]),0x71);
const DOOR=[3845,1250,281], R=290;
const dist=(p)=>Math.hypot(p[0]-DOOR[0],p[1]-DOOR[1],p[2]-DOOR[2]);
const spots=JSON.parse(fs.readFileSync(process.env.SPOTS||'ring2.json'));
const part=+process.argv[2], nparts=+process.argv[3];
const out=fs.createWriteStream(`tt2-${part}.jsonl`,{flags:'a'});
(async()=>{
 for(let n=part;n<spots.length;n+=nparts){const a=spots[n];const t0=Date.now();
  const br=Math.atan2(DOOR[0]-a[0],DOOR[2]-a[2])*180/Math.PI;
  const facings=[-40,-20,0,20,40].map(d=>((br+d)%360+360)%360);
  const res=await BKCLIP.solve({world,map:0x71,version:'PAL',target:{x:a[0],y:a[1],z:a[2]},move:'runPC',
    ranges:{run:[3,5,8,12],cancel:[1,2,3],aHold:[3,5,7,9,12]},dirs:0,facings,cam:0,trigger:{door:DOOR,r:R,offs:[0,1]}});
  let nclip=0,nok=0;
  for(const r of res.results){ if(r.kind!=='clip')continue; nclip++;
    const tr=r.trace; const t=tr.findIndex(q=>dist(q)<R); const l0=r.lag[0]-1;
    const ok=dist(r.start)>=R && t>=0 && (l0-t===0||l0-t===1);
    if(ok)nok++;
    out.write(JSON.stringify({spot:a.slice(0,4),facing:r.facing,p:r.param,lag:r.lag,t,off:l0-t,ok,startDist:+dist(r.start).toFixed(1),start:r.start,startBits:r.startBits,holds:r.holds})+'\n');}
  console.error(`${n}/${spots.length} ${a[0].toFixed(1)},${a[2].toFixed(1)} d${dist(a).toFixed(0)} arrived ${res.arrived} res ${res.results.length} clip ${nclip} ok ${nok} ${((Date.now()-t0)/1000).toFixed(0)}s`);
 }
 out.end();
})();
