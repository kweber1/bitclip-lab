// Downward speed when each move reaches the floor (full model, flat ground in Mumbo's Mountain), PAL and NTSC.
// "vy" = the update's vertical displacement into the floor / dt (the speed the collision sees), "dy" = that displacement.
global.self=global;const BK=require('../bkcol.js');global.BK=BK;const M=require('../bkmove.js');require('../bkmove_misc.js');require('../bkmove_fly.js');require('../bkmove_forms.js');
const L=M.lib,S=M.S;const r=JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync(__dirname+'/../data/map0x02.gz.wasm')));
const w=new BK.World(BK.load_model(r.opa,'opa'),r.xlu?BK.load_model(r.xlu,'xlu'):null);const START=[-4289,-199,4194];
const rep=(n,u)=>Array.from({length:n},()=>Object.assign({},u));
function run(ver,setup,inputs,maxU=400){const p=new M.Player(w,{map:2,pos:START,grounded:true,state:S.IDLE,yaw:0,version:ver});p.gTimer=0;p.redFeathers=99;p.feathers=99;if(setup)setup(p);
  let prev=p.pos.slice(),air=false,best=null,peak=p.pos[1],states=new Set();
  for(let i=0;i<maxU;i++){const u=inputs[i]||{};const q=p.step(u,2);states.add(q.stateName);peak=Math.max(peak,q.pos[1]);
    const dy=q.target[1]-prev[1];if(!q.grounded)air=true;
    if(air&&q.grounded&&q.pos[1]<=START[1]+1&&q.stateName!=='SHOCK_CHARGE'){best={u:i,dy,vy:dy/q.dt,peak:peak-START[1],state:q.stateName};break;}prev=q.pos.slice();}
  return best?best:{u:-1,dy:0,vy:0,peak:peak-START[1],state:[...states].join('>')};}
const A={A:1},Z={Z:1},B={B:1};
const SC={
 'jump (A held)':[null,()=>[...rep(1,A),...rep(60,A)]],
 'backflip':[null,()=>[...rep(4,Z),...rep(1,{Z:1,A:1}),...rep(60,{A:1})]],
 'jump + flutter':[null,()=>[...rep(14,A),{},A,...rep(80,A)]],
 'jump + beak buster at apex':[null,()=>[...rep(13,A),{},Z,...rep(80,{})]],
 'backflip + buster at apex':[null,()=>[...rep(4,Z),{Z:1,A:1},...rep(28,A),{},Z,...rep(80,{})]],
 'shock jump (pad)':[null,()=>[...rep(2,{pad:1}),...rep(40,{A:1,pad:1}),...rep(60,{A:1})]],
 'shock jump + buster at apex':[null,()=>[...rep(2,{pad:1}),...rep(40,{A:1,pad:1}),...rep(8,{A:1}),{},Z,...rep(80,{})]],
 'wonderwing jump':[null,()=>[...rep(4,Z),{Z:1,Cr:1},...rep(45,{}),A,...rep(60,A)]],
 'talon trot jump':[null,()=>[...rep(4,Z),{Z:1,Cl:1},...rep(30,Z),{Z:1,A:1},...rep(60,{Z:1,A:1})]],
 'flight: dive to ground':[null,()=>[{flypad:1,A:1},{flypad:0},...rep(70,{}),...rep(300,{sy:80})],600],
 'flight: beak buster from flight':[null,()=>[{flypad:1,A:1},{flypad:0},...rep(70,{}),Z,...rep(200,{})],600],
 'flight: beak bomb 60 deg down':[null,()=>[{flypad:1,A:1},{flypad:0},...rep(90,{}),{B:1,flyCam:[-60,0]},...rep(200,{})],600],
 'flight: beak bomb 85 deg down':[null,()=>[{flypad:1,A:1},{flypad:0},...rep(90,{}),{B:1,flyCam:[-85,0]},...rep(200,{})],600],
 'termite jump':[p=>p.transform('ant'),()=>[...rep(3,{}),...rep(60,A)]],
 'pumpkin jump':[p=>p.transform('pumpkin'),()=>[...rep(3,{}),...rep(60,A)]],
 'bee: fly + dive':[p=>p.transform('bee'),()=>[...rep(3,{}),A,{},A,...rep(40,{}),...rep(300,{sy:80})],600],
};
for(const ver of ['PAL','NTSC']){console.log('\n'+ver);for(const [k,[su,f,mx]] of Object.entries(SC)){let o;try{o=run(ver,su,f(),mx);}catch(e){o={err:e.message};}
  console.log(k.padEnd(34),o.err?('ERR '+o.err):(o.u<0?('no landing ('+o.state+')'):`vy ${o.vy.toFixed(0).padStart(6)}  dy ${o.dy.toFixed(1).padStart(6)}  height ${o.peak.toFixed(0)}  land update ${o.u} (${o.state})`));}}
