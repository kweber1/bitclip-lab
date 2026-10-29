// exact search (movement + camera sims, validated against the console log) from fpstart: crouch-turn (easy stick dir), barge, slide W, [punch cancel], backflip (A held, easy stick dir)
const fs=require('fs'),zlib=require('zlib');global.self=global;const ROOT='/home/claude/bitclip-lab';
const BK=require(ROOT+'/bkcol.js');global.BK=BK;const BM=require(ROOT+'/bkmove.js');const CAM=require(ROOT+'/bkcam.js');const SR=require(ROOT+'/bksearch.js');global.BKSEARCH=SR;const F=Math.fround;
const room=JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT+'/data/map0x6F.gz.wasm')));
const opa=BK.load_model(room.opa,'opa'),xlu=room.xlu?BK.load_model(room.xlu,'xlu'):null;
const WC=new BK.World(opa,xlu,BK.load_props((room.props||[]).filter(p=>p.kind==='model_prop')),0x6F);
const WB=new BK.World(opa,xlu,BK.load_props(room.props||[]),0x6F);
const pad=JSON.parse(fs.readFileSync('/tmp/claude-0/-home-claude/bf52e3f2-f95b-56d9-a730-a4d34feb6da0/scratchpad/padcells.json'));
const onPad=(p)=>p[1]>200&&pad.some(c=>Math.abs(c[0]-p[0])<=7&&Math.abs(c[1]-p[2])<=7);
const s0=JSON.parse(fs.readFileSync('fpstart_cam.json'));
const EASY=[['up',0,80],['up-right',57,57],['right',80,0],['down-right',57,-57],['down',0,-80],['down-left',-57,-57],['left',-80,0],['up-left',-57,57]];
function start(){const P=new BM.Player(WB,{map:0x6F,pos:s0.player.pos.map(F),yaw:F(s0.player.yaw),yawIdeal:F(s0.player.yaw),cam:F(s0.rot[1]),version:'PAL',grounded:true});const C=new CAM.Camera(WC,s0);return {P,C};}
function step(S,inp){S.P.cam=S.C.rot[1];S.P.step(inp,2);S.C.update({pos:S.P.pos.slice(),yaw:S.P.yaw,floorY:S.P.floorY()},2);}
function clone(S){return {P:SR.clone(S.P),C:Object.assign(Object.create(Object.getPrototypeOf(S.C)),JSON.parse(JSON.stringify(Object.assign({},S.C,{W:null}))),{W:S.C.W})};}
function flip(S,m){const st=m===null?[0,0]:[EASY[m][1],EASY[m][2]];let air=false;
  for(let j=0;j<90;j++){step(S,{Z:j<3,A:j>=2,sx:j>=2?st[0]:0,sy:j>=2?st[1]:0});if(j>2){if(!S.P.grounded)air=true;else if(air)break;}}
  for(let j=0;j<10;j++)step(S,{A:true}); return S.P.pos.slice();}
module.exports={start,step,clone,flip,onPad,EASY};
if(require.main===module){
 const res=[];const t0=Date.now();
 for(let d1=0;d1<8;d1++) for(const bh of [1,20]){ // B held updates
   const S=start();
   for(let u=0;u<12;u++) step(S,{Z:true,sx:u>=1&&u<=10?EASY[d1][1]:0,sy:u>=1&&u<=10?EASY[d1][2]:0}); // crouch turn
   const snaps=[];for(let w=0;w<=130;w++){snaps.push(clone(S));step(S,{Z:w<35,B:w>=1&&w<1+bh});}
   for(let m=-1;m<8;m++){let line='';for(let w=5;w<=130;w++){const e=flip(clone(snaps[w]),m<0?null:m);line+=onPad(e)?'P':(e[1]>200?'-':'.');}
     if(line.includes('P')) res.push({k:`crouch-turn ${EASY[d1][0]}, barge B ${bh===1?'tap':'held'}, backflip stick ${m<0?'neutral':EASY[m][0]}`,line});}
 }
 const best=(l)=>Math.max(...l.split(/[.\-]/).map(s=>s.length));res.sort((a,b)=>best(b.line)-best(a.line));
 for(const r of res.slice(0,25)) console.log(String(best(r.line)).padStart(3),r.k.padEnd(62),r.line);
 console.log(res.length,'combos reach the pad; W = updates after the barge B press, 5..130;',((Date.now()-t0)/1000).toFixed(0),'s');
}
