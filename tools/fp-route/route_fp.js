// per-update input list: [neutral], crouch-turn down-left (stick 10 updates), barge (Z held, B held 20), slide to W, backflip (Z, then A held, stick up-right until he lands), then A held, stick neutral
const {start,step,clone,flip,onPad,EASY}=require('./csearch.js');
const d1=5,bh=20,m=1;
function build(W){const S=start();const L=[];const go=(i)=>{L.push(i);step(S,i);};
 go({});
 for(let u=0;u<12;u++)go({Z:true,sx:u>=1&&u<=10?EASY[d1][1]:0,sy:u>=1&&u<=10?EASY[d1][2]:0});
 for(let w=0;w<W;w++)go({Z:w<35,B:w>=1&&w<1+bh});
 let air=false,land=-1;for(let j=0;j<90;j++){go({Z:j<3,A:j>=2,sx:j>=2?EASY[m][1]:0,sy:j>=2?EASY[m][2]:0});if(j>2){if(!S.P.grounded)air=true;else if(air){land=j;break;}}}
 for(let j=0;j<10;j++)go({A:true});
 return {L,end:S.P.pos.slice(),land};}
let line='',ok=[];const R={};for(let W=30;W<=70;W++){const r=build(W);R[W]=r;const p=onPad(r.end);line+=p?'P':'.';if(p)ok.push(W);}
console.log('W=30..70:',line);
let bs=0,bl=0,s=null;for(let W=30;W<=71;W++){if(ok.includes(W)){s=s??W;}else if(s!==null){if(W-s>bl){bl=W-s;bs=s;}s=null;}}
const Wb=bs+Math.floor((bl-1)/2);console.log('window W',bs,'..',bs+bl-1,'best',Wb,'end',R[Wb].end.map(v=>v.toFixed(3)).join(','),'flip lands after',R[Wb].land,'updates');
require('fs').writeFileSync('fp_route_inputs.json',JSON.stringify({W:Wb,win:[bs,bs+bl-1],inputs:R[Wb].L,end:R[Wb].end,all:Object.fromEntries(ok.map(W=>[W,R[W].L.length]))}));
