// replay the BizHawk flight trace (tests/data/fly.csv + flycam.jsonl: PAL practice ROM, TTC flight pad: launch, glide, flap, nose up, beak bomb, crash)
// run: SHFROM=70 node tests/flyval.js  (after the warp the recording latches inputs one update late; from frame 70 on, update i uses frame i-1)
global.self=global;const BK=require('../bkcol.js');global.BK=BK;const M=require('../bkmove.js');require('../bkmove_misc.js');require('../bkmove_fly.js');require('../bkmove_forms.js');
const CAM=require('../bkcam.js');const F=Math.fround;const fs=require('fs');const z=require('zlib');
const parts=[];for(let i=0;fs.existsSync(__dirname+'/../data/map0x07.gz.'+i+'.wasm');i++)parts.push(fs.readFileSync(__dirname+'/../data/map0x07.gz.'+i+'.wasm'));
const r=JSON.parse(z.gunzipSync(Buffer.concat(parts)));
const w=new BK.World(BK.load_model(r.opa,'opa'),r.xlu?BK.load_model(r.xlu,'xlu'):null,BK.load_props(r.props||[]),7);
const Lr=fs.readFileSync(__dirname+'/data/fly.csv','utf8').trim().split('\n');const H=Lr[0].split(',');const rows=Lr.slice(1).map(l=>{const c=l.split(',');const o={};H.forEach((h,i)=>o[h]=c[i]);return o;});
const camj={};for(const l of fs.readFileSync(__dirname+'/data/flycam.jsonl','utf8').trim().split('\n')){const i=l.indexOf(' ');camj[+l.slice(0,i)]=JSON.parse(l.slice(i+1));}
const START=+(process.argv[2]||39),PADEND=+(process.env.PADEND||61);const i0=rows.findIndex(x=>+x.frame===START);const s=rows[i0];
const P=new M.Player(w,{map:7,pos:[+s.x,+s.y,+s.z],vel:[+s.vx,+s.vy,+s.vz],yaw:+s.yaw,grounded:true,state:parseInt(s.state,16),cam:+s.cam,version:'PAL',gtimer:+(process.env.GT||0)});
P.gTimer=+s.gt;
let n=0,bad=0,cbad=0;
for(let i=i0+1;i<rows.length;i++){const x=rows[i],p=rows[i-1];if(x.gtime===p.gtime)continue;const SH=(process.env.SHFROM&&+x.frame>=+process.env.SHFROM)?-1:+(process.env.SH||0);const src=rows[i+SH];const b=parseInt(src.gbtn,16);P.cam=F(+p.cam);
  if(!P.flyCamObj||!P.flyCamObj.active){P.flyCamObj=new CAM.FlyCam(w,camj[+p.frame]);}
  const lateA=(process.env.LATEA&&+x.frame===+process.env.LATEA);const o=P.step({A:!lateA&&!!(b&0x8000),B:!!(b&0x4000),Z:!!(b&0x2000),R:!!(b&0x10),sx:+src.gsx,sy:+src.gsy,flypad:+x.frame<=PADEND?1:0},+x.dtvi||2);n++;
  const g=[+x.x,+x.y,+x.z];const d=Math.max(...[0,1,2].map(k=>Math.abs(o.pos[k]-g[k])));const st=parseInt(x.state,16);
  let cd=0;if(P.flyCamObj&&camj[+x.frame]){const c=camj[+x.frame];const fc=P.flyCamObj;if(c.state===4)cd=Math.max(...[0,1,2].map(k=>Math.abs(fc.pos[k]-c.pos[k])),Math.abs(fc.rot[0]-c.rot[0]),Math.abs(fc.rot[1]-c.rot[1]));if(cd>1e-3)cbad++;if(process.env.CD&&+x.frame<+(process.env.CDE||160)&&+x.frame>=+(process.env.CDS||0))console.log('C',x.frame,c.state,'game',c.pos.map(v=>v.toFixed(3)).join(','),c.rot.map(v=>v.toFixed(3)).join(','),'sim',fc.pos.map(v=>v.toFixed(3)).join(','),fc.rot.map(v=>v.toFixed(3)).join(','));}
  if(process.env.PITCH)console.log('P',x.frame,P.pitch,P.pitchIdeal);const flag=(d>1e-3||st!==o.state);if(flag)bad++;
  if((flag||cd>1e-3)&&(bad+cbad)<=20||process.env.ALL)console.log(x.frame,'game',x.state,g.map(v=>v.toFixed(3)).join(','),'v',(+x.vx).toFixed(1),(+x.vy).toFixed(1),(+x.vz).toFixed(1),'| sim',o.state.toString(16),o.pos.map(v=>v.toFixed(3)).join(','),'v',o.vel.map(v=>v.toFixed(1)).join(','),'d',d.toFixed(4),'cam d',cd.toFixed(4));
}
console.log('updates',n,'mismatched',bad,'camera mismatched',cbad);
