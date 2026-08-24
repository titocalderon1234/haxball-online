'use strict';
const E=require('../public/engine.js');
const S=require('../public/stadiums.js');
const maps=[['classic',E.CLASSIC],['futsal12',S.futsal12],['futsal3',S.futsal3],['futsal4',S.futsal4],['futsal5',S.futsal5],['futsal7',S.futsal7]];
for(const [name,st] of maps){
  const players=[{id:1,name:'A',avatar:'',team:1},{id:2,name:'B',avatar:'',team:2}];
  const w=new E.World(st,players);const acts=new Map([[1,[1,0,0]],[2,[-1,0,0]]]);
  for(let i=0;i<3600;i++){if(i===30)acts.set(1,[1,0,1]);if(i===31)acts.set(1,[1,0,0]);w.step(acts);}
  for(const d of w.discs)for(const v of [...d.pos,...d.vel])if(!Number.isFinite(v))throw new Error(`${name}: valor no finito`);
  console.log(`OK ${name}: ${w.discs.length} discos, score ${w.redScore}-${w.blueScore}`);
}
