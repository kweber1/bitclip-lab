// 640 room rail camera (Claude 2026-11-01: underwater the look-ahead floor is 20, not 80) (dynamic cam 0x12), JS port of x_camupdate from the exact swim model (exact.h) - straight rail along z at x 0, y -500
const F=Math.fround;
module.exports=function(BK){
  const acos=x=>BK.ml_acosf(F(x)); const sinf=BK.lib_sinf, cosf=BK.lib_cosf; const DT=F(0.04); const D2R=3.141592654/180.0;
  const norm=a=>{ a=F(a); if(a<0){ a=norm(-a); a=F(360-a);} if(a>=360) a=F(a-360*Math.trunc(a/360)); return a; };
  const dd=(a,b)=>{ let d=F(a-b); while(d>180) d=F(d-360); while(d<=-180) d=F(d+360); return d; };
  const mapf=(v,i0,i1,o0,o1)=>{ let r; if(i1!==i0){ r=F(F(F(F(v-i0)/F(i1-i0))*F(o1-o0))+o0); if(o0<o1){ if(r>o1) return F(o1); if(r<o0) return F(o0);} else { if(r<o1) return F(o1); if(r>o0) return F(o0);} return r;} return F(o1); };
  function hv(x1,y1,z1,x2,y2,z2){ const dx=F(x2-x1),dy=F(y2-y1),dz=F(z2-z1); const ft2=F(F(dx*dx)+F(dz*dz)); const h=F(Math.sqrt(ft2)); let o2=0; if(h>0.01){ o2=acos(F(dx/h)); if(dz<0)o2=F(180-o2); if(dx<0)o2=F(360-o2);} return o2; }
  class Cam{ constructor(){ this.cam=F(0); this.camr=F(0); this.B=[F(0),F(0)]; this.camz=new Float32Array(new Uint32Array([0xc42d8d94]).buffer)[0]; this.camu4=F(0);}
    update(S,pyaw,under){ const CX=F(0),CY=F(-500);
      const dxp=F(S[0]-CX), dzp=F(S[2]-this.camz); const sp48=mapf(Math.abs(F(norm(F(this.cam-pyaw))-180.0)),0,180,under?20:80,200); // func_802BD82C(20 underwater / 80, 200)
      const m=mapf(F(Math.sqrt(F(F(dxp*dxp)+F(dzp*dzp)))),300,450,0,sp48); const yr=F(pyaw*D2R); const tmp=F(F(0*sinf(0))+F(cosf(0)*m));
      const A0=F(F(tmp*sinf(yr))+F(cosf(yr)*0)), A2=F(F(tmp*cosf(yr))-F(sinf(yr)*0)); let d0=F(A0-this.B[0]), d2=F(A2-this.B[1]); d0=F(d0*F(0.08)); d2=F(d2*F(0.08)); this.B[0]=F(this.B[0]+d0); this.B[1]=F(this.B[1]+d2);
      const tz=F(S[2]+this.B[1]); const sp30=Math.abs(F(tz-this.camz)); const sp34=tz<this.camz?1:-1; let sp38=0;
      if(550<sp30) sp38=F(mapf(sp30,550,650,0,1500)*sp34); else if(sp30<500) sp38=F(mapf(sp30,400,500,1500,0)*-sp34);
      if(Math.abs(this.camu4)<Math.abs(sp38)) this.camu4=F(this.camu4+(sp38-this.camu4)*0.08); else this.camu4=F(sp38);
      this.camz=F(this.camz-F(DT*this.camu4));
      const t1=hv(S[0],F(S[1]+60),S[2],CX,CY,this.camz); const d1=dd(t1,this.cam); const s1=F(F(d1*DT)*5); let q1=F(s1-this.camr); q1=F(10*(0.0333*q1)); let R1=F(this.camr+q1); let c1=this.cam;
      if(Math.abs(d1)<Math.abs(R1)&&R1*d1>0){ R1=F(0); c1=t1; } this.camr=R1; this.cam=norm(F(c1+R1)); } }
  return Cam; };
