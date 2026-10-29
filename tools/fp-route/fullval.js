// full validation: movement (bkmove) + camera (bkcam) from fpstart, driven by the inputs the game read; compare with the log
const fs=require('fs'),zlib=require('zlib');global.self=global;const ROOT='/home/claude/bitclip-lab';
const BK=require(ROOT+'/bkcol.js');global.BK=BK;const BM=require(ROOT+'/bkmove.js');const CAM=require(ROOT+'/bkcam.js');const F=Math.fround;
const room=JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT+'/data/map0x6F.gz.wasm')));
const opa=BK.load_model(room.opa,'opa'),xlu=room.xlu?BK.load_model(room.xlu,'xlu'):null;
const WC=new BK.World(opa,xlu,BK.load_props((room.props||[]).filter(p=>p.kind==='model_prop')),0x6F);
const WB=new BK.World(opa,xlu,BK.load_props(room.props||[]),0x6F);
const lines=fs.readFileSync(process.argv[2]||'cam-log.csv','utf8').trim().split('\n');const H=lines[0].split(',');const rows=lines.slice(1).map(l=>{const c=l.split(',');const o={};H.forEach((h,i)=>o[h]=c[i]);return o;});
const s=JSON.parse(fs.readFileSync('fpstart_cam.json'));const cam=new CAM.Camera(WC,s);
const r0=rows[0];const P=new BM.Player(WB,{map:0x6F,pos:[+r0.x,+r0.y,+r0.z].map(F),yaw:F(+r0.yaw),yawIdeal:F(+r0.yaw),cam:F(+r0.croty),version:'PAL',grounded:true});
const sh=+(process.argv[3]||0); const PAR=+(process.argv[4]||0);let n=0,maxp=0,maxc=0,first=null;
for(let i=1;i<rows.length;i++){const r=rows[i],pr=rows[i-1];
  if((+r.frame)%2!==PAR) continue;
  const src=rows[i+sh]; const b=parseInt(src.game_btn,16);
  P.cam=cam.rot[1];
  P.step({A:!!(b&0x8000),B:!!(b&0x4000),Z:!!(b&0x2000),sx:+src.game_sx,sy:+src.game_sy},+r.dt_vi||2);
  cam.update({pos:P.pos.slice(),yaw:P.yaw,floorY:P.floorY()},+r.dt_vi||2); n++;
  const dp=Math.max(...[0,1,2].map(k=>Math.abs(P.pos[k]-(+[r.x,r.y,r.z][k])))); const dc=Math.abs(cam.rot[1]-(+r.croty));
  maxp=Math.max(maxp,dp);maxc=Math.max(maxc,dc);
  if(!first&&(dp>1e-3||dc>1e-3)){first={frame:r.frame,dp,dc,sim:P.pos.map(v=>v.toFixed(4)).join(','),game:[r.x,r.y,r.z].join(','),simState:P.state.toString(16),gameState:r.state,simCam:cam.rot[1],gameCam:r.croty};}
}
console.log('shift',sh,'updates',n,'max pos diff',maxp.toExponential(2),'max cam yaw diff',maxc.toExponential(2),'first mismatch',JSON.stringify(first));
