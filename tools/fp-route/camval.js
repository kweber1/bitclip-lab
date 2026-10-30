// camera-only validation: feed the logged Banjo positions per update into the camera sim, compare camera values
const fs=require('fs'),zlib=require('zlib');global.self=global;const ROOT='/home/claude/bitclip-lab';
const BK=require(ROOT+'/bkcol.js');global.BK=BK;const CAM=require(ROOT+'/bkcam.js');const F=Math.fround;
const room=JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT+'/data/map0x6F.gz.wasm')));
const modelProps=(room.props||[]).filter(p=>p.kind==='model_prop');
const W=new BK.World(BK.load_model(room.opa,'opa'),room.xlu?BK.load_model(room.xlu,'xlu'):null,BK.load_props(modelProps),0x6F);
const WB=new BK.World(BK.load_model(room.opa,'opa'),room.xlu?BK.load_model(room.xlu,'xlu'):null,BK.load_props(room.props||[]),0x6F);
const lines=fs.readFileSync(process.argv[2]||'cam-log.csv','utf8').trim().split('\n');const H=lines[0].split(',');const rows=lines.slice(1).map(l=>{const c=l.split(',');const o={};H.forEach((h,i)=>o[h]=c[i]);return o;});
const s=JSON.parse(fs.readFileSync('fpstart_cam.json'));const cam=new CAM.Camera(W,s);
function floorAt(p){const a=[p[0],F(p[1]+60),p[2]],b=[p[0],F(p[1]-1000),p[2]],n=[0,0,0];return WB.line(a,b,n,0x1E0000)?b[1]:-9000;}
let prevT=null,nupd=0,bad=0;const verbose=process.argv[3];
for(let i=1;i<rows.length;i++){const r=rows[i];const p=[+r.x,+r.y,+r.z].map(F);
  // an update happened on this frame when the camera changed or the player moved; use the game's dt_vi
  const camNow=[+r.cposx,+r.cposy,+r.cposz,+r.crotx,+r.croty].map(F);
  if(i>1 && rows[i-1].frame!==undefined){}
  // detect update frames: compare camera vars with previous row
  const pr=rows[i-1];const changed=['cposx','cposy','cposz','crotx','croty','D9E0x','D9E0y','D9E0z','D9C8x','D9C8y','D9B8x','D9B8z','x','y','z'].some(k=>pr[k]!==r[k]);
  if(!changed) continue;
  const fr=+r.dt_vi||2; const fl=floorAt(p);
  cam.update({pos:p,yaw:F(+r.yaw),floorY:fl},fr); nupd++;
  const d=Math.max(...[0,1,2].map(k=>Math.abs(cam.pos[k]-camNow[k])), Math.abs(cam.rot[0]-camNow[3]), Math.abs(cam.rot[1]-camNow[4]));
  global.MAXD=Math.max(global.MAXD||0,d); if(verbose||d>1e-3){ if(bad<15) console.log('frame',r.frame,'upd',nupd,'dt',fr,'sim pos',cam.pos.map(v=>v.toFixed(4)).join(','),'rot',cam.rot.slice(0,2).map(v=>v.toFixed(4)).join(','),'| game',camNow.map(v=>v.toFixed(4)).join(','),'diff',d.toExponential(2),'state',r.state); if(d>1e-3) bad++; }
}
console.log("updates",nupd,"mismatching",bad,"max diff",global.MAXD);
