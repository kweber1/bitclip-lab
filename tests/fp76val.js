// Claude 2026-11-01: replay a PAL 640-room first-person dump (BizHawk bk_76_fpdump.lua: RAM slices per VI) through bkmove from the
// dive-idle start and compare per game update. usage: node tests/fp76val.js dump.txt [SH]
global.self=global;const BK=require('../bkcol.js');global.BK=BK;const M=require('../bkmove.js');require('../bkmove_misc.js');require('../bkmove_fly.js');require('../bkmove_forms.js');
const F=Math.fround;const fs=require('fs');const MAPID=0x76;
const r=JSON.parse(require('zlib').gunzipSync(fs.readFileSync(__dirname+'/../data/map0x76.gz.wasm')));
const w=new BK.World(BK.load_model(r.opa,'opa'),r.xlu?BK.load_model(r.xlu,'xlu'):null,BK.load_props(r.props||[]),MAPID);
const REG=[[0x37C900,0x1240],[0x280C00,0x200],[0x37F280,0x80],[0x37E300,0x400],[0x275400,0x100]];
const SH=+(process.argv[3]||0);
const rows=fs.readFileSync(process.argv[2],'utf8').trim().split('\n').map(l=>{const p=l.split(' ');const hx=p.slice(-5).map(h=>Buffer.from(h,'hex'));const btn=p.slice(4,-5).join('');
  const rd=(a,t)=>{for(let i=0;i<5;i++){const [b,n]=REG[i];if(a>=b&&a<b+n){const o=a-b;return t==='u'?hx[i].readUInt32BE(o):t==='b'?hx[i].readUInt8(o):hx[i].readFloatBE(o);}}};
  return {vi:+p[0],sx:+p[2],sy:+p[3],btn,pos:[rd(0x37CF70),rd(0x37CF74),rd(0x37CF78)],vel:[rd(0x37CE88),rd(0x37CE8C),rd(0x37CE90)],yaw:rd(0x37D060),ideal:rd(0x37D064),
    camr:rd(0x37E39C),B0:rd(0x37E388),B2:rd(0x37E390),camz:rd(0x37E330),camu4:rd(0x37E5B4),pitch:rd(0x37CF10),pitchI:rd(0x37CF14),state:rd(0x37DB34,'u'),gt:rd(0x37F2B8,'u'),cam:rd(0x280CE4),crot:rd(0x37E33C),inw:rd(0x37C931,'b'),gnd:rd(0x37C930,'b')};});
const s=rows[0];
const P=new M.Player(w,{map:MAPID,pos:s.pos,vel:s.vel,yaw:s.yaw,yawIdeal:s.ideal,grounded:false,state:s.state,cam:s.cam,version:'PAL',gtimer:s.gt,abilities:{dive:false}});
P.pitch=F(s.pitch);P.pitchIdeal=F(s.pitchI);
const T=P.tracker;T.mode=4;T.unk5C=1;T.unk59=1;T.posY=F(-50);T.unk58=1;T.posX=F(-700);T.norm=[0,1,0];P.inWater=true;P.waterBelow=true;P.floorType=3;
let n=0,bad=0,lastgt=s.gt,cbad=0;const SIM=!!process.env.SIMCAM;let C=null;if(SIM){const Cam=require('../tools/railcam76.js')(BK);C=new Cam();C.cam=F(s.cam);C.camr=F(s.camr);C.B=[F(s.B0),F(s.B2)];C.camz=F(s.camz);C.camu4=F(s.camu4);}
for(let i=1;i<rows.length;i++){const x=rows[i],p=rows[i-1];if(x.gt===p.gt)continue;
  const src=rows[i+SH]||x;const b=src.btn;P.cam=SIM?C.cam:F(p.cam);
  const o=P.step({A:b.includes('A'),B:b.includes('B')&&!b.includes('CUp')?true:b==='B',Z:b.includes('Z'),Cu:b.includes('CUp'),sx:src.sx>127?127:src.sx<-128?-128:src.sx,sy:src.sy>127?127:src.sy<-128?-128:src.sy},Math.max(1,Math.round((x.gt-lastgt)/41)));lastgt=x.gt;n++;if(SIM){if(o.state!==0x97||process.env.NOFREEZE)C.update(o.pos,o.yaw,[0x2B,0x2C,0x39,0x97,0x78,0x30].includes(o.state));const nx=rows[i+1]||x;if(x.vi>=+(process.env.CFROM||0)&&(C.cam!==F(nx.crot)||C.camz!==F(nx.camz)||C.camu4!==F(nx.camu4))&&cbad++<6)console.log(x.vi,'st',o.state.toString(16),'cam sim',C.cam,'game crot',nx.crot,'camz sim',C.camz,'game',nx.camz,'u4',C.camu4,nx.camu4,'B',C.B,nx.B0,nx.B2,'camr',C.camr,nx.camr);}
  const d=Math.max(...[0,1,2].map(k=>Math.abs(o.pos[k]-x.pos[k])));const flag=(d>1e-4||x.state!==o.state||Math.abs(o.yaw-x.yaw)>1e-3);if(flag)bad++;
  if((flag&&bad<=12)||process.env.ALL)console.log(x.vi,'game',x.state.toString(16),x.pos.map(v=>v.toFixed(3)).join(','),'yaw',x.yaw.toFixed(3),'pit',x.pitch.toFixed(2),'| sim',o.state.toString(16),o.pos.map(v=>v.toFixed(3)).join(','),'yaw',o.yaw.toFixed(3),'pit',P.pitch.toFixed(2),'d',d.toFixed(4));
}
console.log('updates',n,'mismatched',bad);
