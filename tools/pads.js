// tools/pads.js -- shock spring pads and flight pads of every map (actor spawns + Lair model props), from the map data -> data/pads.json
// Shock: ACTOR_B_SHOCKSPRING_PAD, ACTOR_249_LAIR_SWITCH_SHOCK_JUMP_PAD (marker 0x242), model prop 0x2DD. Flight: ACTOR_E4_FLIGHT_PAD,
// ACTOR_247_LAIR_SWITCH_FLIGHT_PAD, ACTOR_39F_FIGHT_FLIGHT_PAD, model prop 0x2E8 (ba/marker.c: these set BA_FLAG_2 / BA_FLAG_1).
const fs=require('fs');const L=require(process.argv[2]||'/tmp/claude-0/loadmap.js');const idx=JSON.parse(fs.readFileSync(__dirname+'/../data/index.json'));
const out={};
const maps=(Array.isArray(idx)?idx:idx.maps||Object.values(idx)).map(m=>typeof m==='object'?(m.map??m.id):m).map(m=>typeof m==='string'?parseInt(m):m).filter(m=>m!=null);
for(const m of new Set(maps)){for(const ver of ['PAL','NTSC']){let r;try{r=L(m,ver);}catch(e){continue;}if(!r)continue;const pads=[];
  for(const p of r.props||[]){const n=p.name||'';let kind=null;
    if(/SHOCKSPRING_PAD|SWITCH_SHOCK_JUMP_PAD/.test(n)||/MODEL_PROP_0x2DD$/.test(n))kind='shock';
    if(/ACTOR_E4_FLIGHT_PAD|SWITCH_FLIGHT_PAD|FIGHT_FLIGHT_PAD/.test(n)||/MODEL_PROP_0x2E8$/.test(n))kind='flight';
    if(kind)pads.push({kind,name:n,pos:p.position});}
  if(pads.length){const k='0x'+m.toString(16).toUpperCase().padStart(2,'0');out[k]=out[k]||{name:r.name};out[k][ver]=pads;}}}
fs.writeFileSync(__dirname+'/../data/pads.json',JSON.stringify(out,null,0));
for(const [k,v] of Object.entries(out))console.log(k,v.name,'PAL',(v.PAL||[]).map(p=>p.kind[0]).join(''),'NTSC',(v.NTSC||[]).map(p=>p.kind[0]).join(''));
