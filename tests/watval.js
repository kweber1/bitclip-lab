// replay a BizHawk water trace (tests/data/water.csv: PAL practice ROM, MAP 0x71 moat) through bkmove and compare per update
const MAPID=parseInt(process.env.MAP||"0x71");
global.self=global;const BK=require('../bkcol.js');global.BK=BK;const M=require('../bkmove.js');if(!process.env.NOMODS){require('../bkmove_misc.js');require('../bkmove_fly.js');require('../bkmove_forms.js');}const F=Math.fround;
const fs=require('fs');const file=process.argv[2]||__dirname+'/data/water.csv';const START=+(process.argv[3]||47);const SH=+(process.argv[4]||0);
const r=JSON.parse(require('zlib').gunzipSync(fs.readFileSync(__dirname+'/../data/map0x'+MAPID.toString(16).toUpperCase().padStart(2,'0')+'.gz.wasm')));
const w=new BK.World(BK.load_model(r.opa,'opa'),r.xlu?BK.load_model(r.xlu,'xlu'):null,BK.load_props(r.props||[]),MAPID);
const L=fs.readFileSync(file,'utf8').trim().split('\n');const H=L[0].split(',');const rows=L.slice(1).map(l=>{const c=l.split(',');const o={};H.forEach((h,i)=>o[h]=c[i]);return o;});
const MESH=require('../bkmesh.js');
const i0=rows.findIndex(x=>+x.frame===START);const s=rows[i0];
const hf=h=>new Float32Array(new Uint32Array([parseInt(h,16)]).buffer)[0];if(s.w4&&!process.env.NOWAVE)MESH.attach(w,require('../data/meshes.json'),MAPID,{wave5:{u4:hf(s.w4),u8:hf(s.w8),u2C:hf(s.w2C)}});
const P=new M.Player(w,{map:MAPID,pos:[+s.x,+s.y,+s.z],vel:[+s.vx,+s.vy,+s.vz],yaw:+s.yaw,grounded:true,state:parseInt(s.state,16),cam:+s.cam,version:'PAL',trackerMode:1,gtimer:+(process.env.GT||0)});
let n=0,bad=0;
for(let i=i0+1;i<rows.length;i++){const x=rows[i],p=rows[i-1];if(x.gtime===p.gtime)continue;
  const src=rows[i+SH];const b=parseInt(src.gbtn,16);P.cam=F(+(process.env.CAMCUR?x.cam:p.cam));
  if(process.env.DBG&&+x.frame===+process.env.DBG){const _p=BK.predict;BK.predict=function(...a){const r=_p.apply(this,a);console.log('PREDICT old',a[1].map(Number),'tgt',a[2].map(Number),'res',r.result,'hits',r.hits,JSON.stringify(r.trace.map(t=>t.map(v=>Array.isArray(v)?v.map(q=>+(+q).toFixed(3)):v))));return r;};}
  const o=P.step({A:!!(b&0x8000),B:!!(b&0x4000),Z:!!(b&0x2000),R:!!(b&0x10),sx:+src.gsx,sy:+src.gsy},+x.dtvi||2);n++;
  const g=[+x.x,+x.y,+x.z];const d=Math.max(...[0,1,2].map(k=>Math.abs(o.pos[k]-g[k])));const st=parseInt(x.state,16);
  const flag=(d>1e-3||st!==o.state);if(flag)bad++;
  if(process.env.TR)console.log(x.frame,"trk",P.tracker.mode,P.tracker.posY,P.tracker.posX,x.trY,x.trmode);if(flag&&bad<=25||process.env.ALL)console.log(x.frame,'game',x.state,g.map(v=>v.toFixed(3)).join(','),'vy',(+x.vy).toFixed(2),'yaw',(+x.yaw).toFixed(3),'v',(+x.vx).toFixed(2),(+x.vz).toFixed(2),'| sim',o.state.toString(16),'yaw',o.yaw.toFixed(3),'v',o.vel[0].toFixed(2),o.vel[2].toFixed(2),o.pos.map(v=>v.toFixed(3)).join(','),'vy',o.vel[1].toFixed(2),'d',d.toFixed(4));
}
console.log('updates',n,'mismatched',bad);
