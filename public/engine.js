/*
HB Local deterministic browser physics.

Core collision/movement/state logic is a JavaScript adaptation of the MIT-licensed
HaxballGym haxball_core Rust implementation. Classic below is the exact
reference classic.hbs bundled by HaxballGym; Small/Big keep the published geometry used by this local build.

This file contains no official HaxBall client code.
*/
(function(global){
'use strict';

const F={BALL:1,RED:2,BLUE:4,REDKO:8,BLUEKO:16,WALL:32,ALL:63,KICK:64,SCORE:128,C0:256,C1:512,C2:1024,C3:2048};
F.PLAYER_COLLISION=F.BALL|F.RED|F.BLUE|F.WALL;
const STATE_KICKOFF=0,STATE_PLAYING=1,STATE_GOAL=2;
const SQRT=(x,y)=>Math.sqrt(x*x+y*y);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const scale=(a,s)=>[a[0]*s,a[1]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const norm=a=>Math.sqrt(a[0]*a[0]+a[1]*a[1]);
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];

function parseFlags(names){
  if(!Array.isArray(names)) return 0;
  let out=0;
  for(const n of names){
    if(n==='ball')out|=F.BALL; else if(n==='red')out|=F.RED; else if(n==='blue')out|=F.BLUE;
    else if(n==='redKO')out|=F.REDKO; else if(n==='blueKO')out|=F.BLUEKO; else if(n==='wall')out|=F.WALL;
    else if(n==='all')out|=F.ALL; else if(n==='kick')out|=F.KICK; else if(n==='score')out|=F.SCORE;
    else if(n==='c0')out|=F.C0; else if(n==='c1')out|=F.C1; else if(n==='c2')out|=F.C2; else if(n==='c3')out|=F.C3;
  }
  return out;
}
function collides(a,b){return (a.cgroup&b.cmask)!==0 && (a.cmask&b.cgroup)!==0;}

function discDisc(a,b){
  const dx=a.pos[0]-b.pos[0],dy=a.pos[1]-b.pos[1];
  const d2=dx*dx+dy*dy,rs=a.radius+b.radius;
  if(!(d2>0 && d2<=rs*rs))return false;
  const dist=Math.sqrt(d2),nx=dx/dist,ny=dy/dist;
  const denom=a.invMass+b.invMass;
  if(denom===0)return false;
  const mf=a.invMass/denom,overlap=rs-dist,pf=overlap*mf;
  a.pos[0]+=nx*pf;a.pos[1]+=ny*pf;
  const ob=overlap-pf;b.pos[0]-=nx*ob;b.pos[1]-=ny*ob;
  let nv=nx*(a.vel[0]-b.vel[0])+ny*(a.vel[1]-b.vel[1]);
  if(nv<0){
    nv*=a.bcoef*b.bcoef+1;
    const ca=mf*nv;a.vel[0]-=nx*ca;a.vel[1]-=ny*ca;
    const cb=nv-ca;b.vel[0]+=nx*cb;b.vel[1]+=ny*cb;
  }
  return true;
}
function discVertex(d,v){
  const dx=d.pos[0]-v.pos[0],dy=d.pos[1]-v.pos[1],dist=Math.sqrt(dx*dx+dy*dy);
  if(dist>0 && dist<=d.radius){
    const nx=dx/dist,ny=dy/dist;
    d.pos[0]+=nx*(d.radius-dist);d.pos[1]+=ny*(d.radius-dist);
    const nv=d.vel[0]*nx+d.vel[1]*ny;
    if(nv<0){const bounce=-(1+d.bcoef*v.bcoef);d.vel[0]+=nx*nv*bounce;d.vel[1]+=ny*nv*bounce;}
    return true;
  }
  return false;
}
function discPlane(d,p){
  const len=Math.sqrt(p.normal[0]*p.normal[0]+p.normal[1]*p.normal[1]);
  const nx=p.normal[0]/len,ny=p.normal[1]/len;
  const dist=p.dist-(d.pos[0]*nx+d.pos[1]*ny)+d.radius;
  if(dist>0){
    d.pos[0]+=nx*dist;d.pos[1]+=ny*dist;
    const nv=d.vel[0]*nx+d.vel[1]*ny;
    if(nv<0){const bounce=-(1+d.bcoef*p.bcoef);d.vel[0]+=p.normal[0]*nv*bounce;d.vel[1]+=p.normal[1]*nv*bounce;}
    return true;
  }
  return false;
}
function segmentNoCurve(pd,v0,v1){
  const sx=v1[0]-v0[0],sy=v1[1]-v0[1];
  const a0=pd[0]-v0[0],a1=pd[1]-v0[1],b0=pd[0]-v1[0],b1=pd[1]-v1[1];
  if(sx*a0+sy*a1>0 && sx*b0+sy*b1<0){
    const len=Math.sqrt(sx*sx+sy*sy),nx=-sy/len,ny=sx/len;
    return [nx*b0+ny*b1,[nx,ny]];
  }
  return null;
}
function segmentCurve(pd,s){
  const x=pd[0]-s.center[0],y=pd[1]-s.center[1];
  const cond=(x*s.t0[0]+y*s.t0[1]>0)&&(x*s.t1[0]+y*s.t1[1]>0);
  if(cond!==(s.curve<0)){
    const dist=Math.sqrt(x*x+y*y);
    if(dist>0)return [dist-s.arcRadius,[x/dist,y/dist]];
  }
  return null;
}
function segmentBias(bias,dist,normal){
  let bs=bias;
  if(bs===0){if(dist<0){dist=-dist;normal=[-normal[0],-normal[1]];}}
  else if(bs<0){bs=-bs;dist=-dist;normal=[-normal[0],-normal[1]];}
  if(dist<-bs)return null;
  return [dist,normal];
}
function segmentFinal(d,s,dist,normal){
  if(dist<d.radius){
    d.pos[0]+=normal[0]*(d.radius-dist);d.pos[1]+=normal[1]*(d.radius-dist);
    const nv=d.vel[0]*normal[0]+d.vel[1]*normal[1];
    if(nv<0){const bounce=-(1+d.bcoef*s.bcoef);d.vel[0]+=normal[0]*nv*bounce;d.vel[1]+=normal[1]*nv*bounce;}
    return true;
  }
  return false;
}
function buildSegment(v0raw,v1raw,curveDeg,biasRaw,bcoef,cgroup,cmask,vis,color,curveFRaw){
  // Official .hbs rule: when curveF exists, curve is ignored. curveF is the
  // precision-preserving cotangent representation: cot(angle/2). Convert it back
  // only to determine orientation; use the original curveF itself for geometry.
  const cf=curveFRaw!=null?Number(curveFRaw):NaN;
  let sourceDeg=Number.isFinite(Number(curveDeg))?Number(curveDeg):0;
  if(Number.isFinite(cf)){
    let a=2*Math.atan2(1,cf)*180/Math.PI; // (0, 360]
    if(a>180+1e-10)a-=360;               // canonical equivalent (-180,180]
    sourceDeg=a;
  }
  const rawV0=[v0raw[0],v0raw[1]],rawV1=[v1raw[0],v1raw[1]];
  let h=[v0raw[0],-v0raw[1]],m=[v1raw[0],-v1raw[1]],bias=-biasRaw;
  let rad=(-sourceDeg)*0.017453292519943295;
  if(rad<0){rad=-rad;const tmp=h;h=m;m=tmp;bias=-bias;}
  let o=Infinity;
  if(Number.isFinite(cf)) o=cf;
  else if(0.17435839227423353<rad && rad<5.934119456780721)o=1/Math.tan(rad/2);
  let center=[0,0],arcRadius=0,curve=0,t0=[0,0],t1=[0,0];
  if(Number.isFinite(o)){
    const f=.5*(m[0]-h[0]),i=.5*(m[1]-h[1]);
    const cx=h[0]+f-i*o,cy=h[1]+i+f*o;
    const fr=h[0]-cx,ir=h[1]-cy;
    arcRadius=Math.sqrt(fr*fr+ir*ir);
    t0=[cy-h[1],h[0]-cx];t1=[m[1]-cy,cx-m[0]];
    if(o<=0){t0=[-t0[0],-t0[1]];t1=[-t1[0],-t1[1]];}
    center=[cx,cy];curve=o;
  }
  return {v0:h,v1:m,rawV0,rawV1,bcoef,bias,cgroup,cmask,curve,center,arcRadius,t0,t1,vis:vis!==false,color:color??null,curveDeg:sourceDeg,curveF:Number.isFinite(cf)?cf:null};
}
function makeDisc(pos,radius,invMass,damping,bcoef,cgroup,cmask,extra){
  return Object.assign({pos:[pos[0],pos[1]],vel:[0,0],radius,invMass,damping,bcoef,gravity:[0,0],cgroup,cmask,isPlayer:false,accel:0,kickAccel:0,kickDamping:0,kickStrength:0,kickback:0,team:0},extra||{});
}
function mergeProps(obj,trait){const out=Object.assign({},trait||{},obj||{});delete out.trait;return out;}
function propFlags(p,key,def){return Array.isArray(p[key])?parseFlags(p[key]):def;}

const COMMON_TRAITS={
  ballArea:{vis:false,bCoef:1,cMask:['ball']},
  goalPost:{radius:8,invMass:0,bCoef:.5},
  goalNet:{vis:true,bCoef:.1,cMask:['ball']},
  kickOffBarrier:{vis:false,bCoef:.1,cGroup:['redKO','blueKO'],cMask:['red','blue']}
};
function makeOfficialRectStadium(name,width,height,spawn,bgw,bgh,ko,goalX,goalHalf,netX,netInnerY){
  return {
    name,width,height,spawnDistance:spawn,bg:{type:'grass',width:bgw,height:bgh,kickOffRadius:ko,cornerRadius:0},
    vertexes:[
      {x:-bgw,y:bgh,trait:'ballArea'},{x:-bgw,y:goalHalf,trait:'ballArea'},{x:-bgw,y:-goalHalf,trait:'ballArea'},{x:-bgw,y:-bgh,trait:'ballArea'},
      {x:bgw,y:bgh,trait:'ballArea'},{x:bgw,y:goalHalf,trait:'ballArea'},{x:bgw,y:-goalHalf,trait:'ballArea'},{x:bgw,y:-bgh,trait:'ballArea'},
      {x:0,y:height,trait:'kickOffBarrier'},{x:0,y:ko,trait:'kickOffBarrier'},{x:0,y:-ko,trait:'kickOffBarrier'},{x:0,y:-height,trait:'kickOffBarrier'},
      {x:-goalX-10,y:-goalHalf,trait:'goalNet'},{x:-netX,y:-netInnerY,trait:'goalNet'},{x:-netX,y:netInnerY,trait:'goalNet'},{x:-goalX-10,y:goalHalf,trait:'goalNet'},
      {x:goalX+10,y:-goalHalf,trait:'goalNet'},{x:netX,y:-netInnerY,trait:'goalNet'},{x:netX,y:netInnerY,trait:'goalNet'},{x:goalX+10,y:goalHalf,trait:'goalNet'}
    ],
    segments:[
      {v0:0,v1:1,trait:'ballArea'},{v0:2,v1:3,trait:'ballArea'},{v0:4,v1:5,trait:'ballArea'},{v0:6,v1:7,trait:'ballArea'},
      {v0:12,v1:13,trait:'goalNet',curve:-90},{v0:13,v1:14,trait:'goalNet'},{v0:14,v1:15,trait:'goalNet',curve:-90},
      {v0:16,v1:17,trait:'goalNet',curve:90},{v0:17,v1:18,trait:'goalNet'},{v0:18,v1:19,trait:'goalNet',curve:90},
      {v0:8,v1:9,trait:'kickOffBarrier'},{v0:9,v1:10,trait:'kickOffBarrier',curve:180,cGroup:['blueKO']},{v0:9,v1:10,trait:'kickOffBarrier',curve:-180,cGroup:['redKO']},{v0:10,v1:11,trait:'kickOffBarrier'}
    ],
    goals:[{p0:[-bgw,goalHalf],p1:[-bgw,-goalHalf],team:'red'},{p0:[bgw,goalHalf],p1:[bgw,-goalHalf],team:'blue'}],
    discs:[
      {pos:[-bgw,goalHalf],trait:'goalPost',color:'FFCCCC'},{pos:[-bgw,-goalHalf],trait:'goalPost',color:'FFCCCC'},
      {pos:[bgw,goalHalf],trait:'goalPost',color:'CCCCFF'},{pos:[bgw,-goalHalf],trait:'goalPost',color:'CCCCFF'}
    ],
    planes:[
      {normal:[0,1],dist:-bgh,trait:'ballArea'},{normal:[0,-1],dist:-bgh,trait:'ballArea'},
      {normal:[0,1],dist:-height,bCoef:.1},{normal:[0,-1],dist:-height,bCoef:.1},{normal:[1,0],dist:-width,bCoef:.1},{normal:[-1,0],dist:-width,bCoef:.1}
    ],
    traits:JSON.parse(JSON.stringify(COMMON_TRAITS))
  };
}
const CLASSIC={"name":"Classic","width":420,"height":200,"ballPhysics":"disc0","vertexes":[{"x":378,"y":-64,"bCoef":0.1,"cMask":["ball"]},{"x":378,"y":64,"bCoef":0.1,"cMask":["ball"]},{"x":400,"y":-42,"bCoef":0.1,"cMask":["ball"]},{"x":400,"y":42,"bCoef":0.1,"cMask":["ball"]},{"x":-378,"y":-64,"bCoef":0.1,"cMask":["ball"]},{"x":-378,"y":64,"bCoef":0.1,"cMask":["ball"]},{"x":-400,"y":-42,"bCoef":0.1,"cMask":["ball"]},{"x":-400,"y":42,"bCoef":0.1,"cMask":["ball"]},{"x":0,"y":-200,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":-75,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":75,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":0,"y":200,"bCoef":0.1,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"x":-370,"y":-170,"cMask":[]},{"x":370,"y":-170,"cMask":[]},{"x":370,"y":-64,"cMask":[]},{"x":370,"y":64,"cMask":[]},{"x":370,"y":170,"cMask":[]},{"x":-370,"y":170,"cMask":[]},{"x":-370,"y":64,"cMask":[]},{"x":-370,"y":-64,"cMask":[]}],"segments":[{"v0":0,"v1":2,"bCoef":0.1,"curve":90,"curveF":1.0000000000000002,"cMask":["ball"]},{"v0":3,"v1":2,"bCoef":0.1,"cMask":["ball"]},{"v0":3,"v1":1,"bCoef":0.1,"curve":90,"curveF":1.0000000000000002,"cMask":["ball"]},{"v0":6,"v1":4,"bCoef":0.1,"curve":90,"curveF":1.0000000000000002,"cMask":["ball"]},{"v0":7,"v1":6,"bCoef":0.1,"cMask":["ball"]},{"v0":5,"v1":7,"bCoef":0.1,"curve":90,"curveF":1.0000000000000002,"cMask":["ball"]},{"v0":8,"v1":9,"bCoef":0.1,"vis":false,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"v0":10,"v1":11,"bCoef":0.1,"vis":false,"cMask":["red","blue"],"cGroup":["redKO","blueKO"]},{"v0":9,"v1":10,"bCoef":0.1,"curve":180,"curveF":6.123233995736766e-17,"vis":false,"cMask":["red","blue"],"cGroup":["redKO"]},{"v0":10,"v1":9,"bCoef":0.1,"curve":180,"curveF":6.123233995736766e-17,"vis":false,"cMask":["red","blue"],"cGroup":["blueKO"]},{"v0":13,"v1":14,"vis":false,"cMask":["ball"]},{"v0":15,"v1":16,"vis":false,"cMask":["ball"]},{"v0":17,"v1":18,"vis":false,"cMask":["ball"]},{"v0":19,"v1":12,"vis":false,"cMask":["ball"]}],"planes":[{"normal":[0,1],"dist":-200,"bCoef":0},{"normal":[0,-1],"dist":-200,"bCoef":0},{"normal":[1,0],"dist":-420,"bCoef":0},{"normal":[-1,0],"dist":-420,"bCoef":0},{"normal":[0,1],"dist":-170,"cMask":["ball"]},{"normal":[0,-1],"dist":-170,"cMask":["ball"]}],"goals":[{"p0":[370,-64],"p1":[370,64],"team":"blue"},{"p0":[-370,-64],"p1":[-370,64],"team":"red"}],"playerPhysics":{},"discs":[{"cGroup":["ball","kick","score"]},{"pos":[370,-64],"radius":8,"invMass":0,"color":"CCCCFF"},{"pos":[370,64],"radius":8,"invMass":0,"color":"CCCCFF"},{"pos":[-370,-64],"radius":8,"invMass":0,"color":"FFCCCC"},{"pos":[-370,64],"radius":8,"invMass":0,"color":"FFCCCC"}],"spawnDistance":277.5,"bg":{"type":"grass","width":370,"height":170,"kickOffRadius":75}};
const SMALL=makeOfficialRectStadium('Small',420,200,130,320,130,70,320,55,350,35);
const BIG=makeOfficialRectStadium('Big',600,270,350,550,240,80,550,80,580,60);

class World{
  constructor(stadium,players){
    this.stadium=JSON.parse(JSON.stringify(stadium||CLASSIC));
    this.players=players.filter(p=>p.team===1||p.team===2).map(p=>Object.assign({},p));
    this.discs=[];this.vertices=[];this.segments=[];this.planes=[];this.goals=[];this.playerIndexById=new Map();
    this.redScore=0;this.blueScore=0;this.steps=0;this.state=STATE_KICKOFF;this.kickingTeam=F.RED;this.goalTimer=0;this.ballCurveSpin=0;this.ballCurveTicks=0;this.ballCurveTotalTicks=0;this.ballCurveIntensity=0;this.ballCurveDir=[0,0];this.ballBaseColor='FFFFFF';
    this.kickRateMin=2;this.kickRateCost=0;this.kickRateCap=1;this.lastGoalConceding=null;this.lastKickBy=null;this.lastBallKickBy=null;
    this.kickOffReset=(this.stadium.kickOffReset||'partial').toLowerCase()==='full'?'full':'partial';
    this._build();
    // Keep the exact authored state of every non-player disc. HaxBall's `full`
    // kickoff reset restores all discs; `partial` restores only ball + players.
    this.initialNonPlayer=this.discs.slice(0,this.firstPlayer).map(d=>({pos:d.pos.slice(),vel:d.vel.slice()}));
    this.resetPositions();
  }
  _build(){
    const s=this.stadium,traits=s.traits||{};
    let ballRaw={},ballDiscIndex=null,ballIsDiscRef=false;
    if(typeof s.ballPhysics==='string' && /^disc\d+$/.test(s.ballPhysics)){
      ballDiscIndex=parseInt(s.ballPhysics.slice(4),10);const src=s.discs?.[ballDiscIndex]||{};ballRaw=mergeProps(src,src.trait?traits[src.trait]:null);ballIsDiscRef=true;
    }else ballRaw=mergeProps(s.ballPhysics||{},s.ballPhysics?.trait?traits[s.ballPhysics.trait]:null);
    const bSpeed=ballRaw.speed||[0,0],bGravity=ballRaw.gravity||[0,0];
    // Reference loader gives the game ball canonical collision flags regardless of whether
    // ballPhysics is inline or points at discN. Physics values still come from that object.
    const ballGroup=F.BALL|F.KICK|F.SCORE;
    const ballMask=F.ALL;
    this.ballBaseColor=String(ballRaw.color??'FFFFFF').replace(/^#/,'').padStart(6,'0').slice(-6).toUpperCase();this.discs.push(makeDisc([0,0],ballRaw.radius??10,ballRaw.invMass??1,ballRaw.damping??.99,ballRaw.bCoef??.5,ballGroup,ballMask,{kind:'ball',color:this.ballBaseColor,vel:[bSpeed[0]||0,-(bSpeed[1]||0)],gravity:[bGravity[0]||0,-(bGravity[1]||0)]}));
    (s.discs||[]).forEach((raw,i)=>{
      if(i===ballDiscIndex)return;
      const p=mergeProps(raw,raw.trait?traits[raw.trait]:null),pos=p.pos||[0,0],speed=p.speed||[0,0],gravity=p.gravity||[0,0];
      this.discs.push(makeDisc([pos[0],-pos[1]],p.radius??10,p.invMass??1,p.damping??.99,p.bCoef??.5,propFlags(p,'cGroup',F.ALL),propFlags(p,'cMask',F.ALL),{kind:'static',color:p.color??null,vel:[speed[0]||0,-(speed[1]||0)],gravity:[gravity[0]||0,-(gravity[1]||0)]}));
    });
    this.firstPlayer=this.discs.length;
    const pp=s.playerPhysics||{},ppGravity=pp.gravity||[0,0],ppExtraGroup=propFlags(pp,'cGroup',0);
    this.players.forEach(pl=>{
      const team=pl.team===1?F.RED:F.BLUE;
      const d=makeDisc([0,0],pp.radius??15,pp.invMass??.5,pp.damping??.96,pp.bCoef??.5,team|ppExtraGroup,F.PLAYER_COLLISION,{isPlayer:true,kind:'player',gravity:[ppGravity[0]||0,-(ppGravity[1]||0)],accel:pp.acceleration??.1,kickAccel:pp.kickingAcceleration??.07,kickDamping:pp.kickingDamping??.96,kickStrength:pp.kickStrength??5,kickback:pp.kickback??0,team,playerId:pl.id,name:pl.name,avatar:pl.avatar||'',bot:!!pl.bot});
      this.playerIndexById.set(pl.id,this.discs.length);this.discs.push(d);
    });
    this.nPlayers=this.players.length;
    this.kickFlag=new Array(this.nPlayers).fill(false);this.kickHeldPrev=new Array(this.nPlayers).fill(false);this.kickCooldown=new Array(this.nPlayers).fill(0);this.kickBurst=new Array(this.nPlayers).fill(0);
    const verts=s.vertexes||[];
    verts.forEach(raw=>{
      const p=mergeProps(raw,raw.trait?traits[raw.trait]:null);
      this.vertices.push({pos:[p.x??0,-(p.y??0)],bcoef:p.bCoef??1,cgroup:propFlags(p,'cGroup',F.WALL),cmask:propFlags(p,'cMask',F.ALL)});
    });
    (s.segments||[]).forEach(raw=>{
      const p=mergeProps(raw,raw.trait?traits[raw.trait]:null),a=verts[p.v0],b=verts[p.v1];
      if(!a||!b)throw new Error(`segment references missing vertex ${p.v0}/${p.v1}`);
      this.segments.push(buildSegment([a.x,a.y],[b.x,b.y],p.curve??0,p.bias??0,p.bCoef??1,propFlags(p,'cGroup',F.WALL),propFlags(p,'cMask',F.ALL),p.vis,p.color,p.curveF));
    });
    (s.planes||[]).forEach(raw=>{
      const p=mergeProps(raw,raw.trait?traits[raw.trait]:null);
      this.planes.push({normal:[p.normal[0],-p.normal[1]],dist:p.dist,bcoef:p.bCoef??1,cgroup:propFlags(p,'cGroup',F.WALL),cmask:propFlags(p,'cMask',F.ALL)});
    });
    // Match HaxballGym's stadium parser: goals stay in authored .hbs coordinates.
    // (Vertices/discs/planes are mirrored into the internal y-up simulation.)
    (s.goals||[]).forEach(raw=>{
      const g=mergeProps(raw,raw.trait?traits[raw.trait]:null);
      if(!Array.isArray(g.p0)||!Array.isArray(g.p1))return;
      this.goals.push({p0:[g.p0[0],g.p0[1]],p1:[g.p1[0],g.p1[1]],team:g.team==='red'?F.RED:g.team==='blue'?F.BLUE:0});
    });
    this.spawnDistance=s.spawnDistance??277.5;
    this.redSpawn=(s.redSpawnPoints||[]).map(p=>[p[0],-p[1]]);this.blueSpawn=(s.blueSpawnPoints||[]).map(p=>[p[0],-p[1]]);
  }
  rowOffset(i){const row=((i+1)>>1);return i%2===1?-55*row:55*row;}
  resetPositions(){
    // The game ball always returns to center on kickoff. With full reset all
    // custom/moving stadium discs return to the exact position/speed authored in .hbs.
    this.discs[0].pos=[0,0];this.discs[0].vel=[0,0];this.discs[0].color=this.ballBaseColor;this.ballCurveSpin=0;this.ballCurveTicks=0;this.ballCurveTotalTicks=0;this.ballCurveIntensity=0;this.ballCurveDir=[0,0];
    if(this.kickOffReset==='full'){
      for(let i=1;i<this.firstPlayer;i++){
        const st=this.initialNonPlayer?.[i];if(!st)continue;
        this.discs[i].pos=st.pos.slice();this.discs[i].vel=st.vel.slice();
      }
    }
    let ri=0,bi=0;
    for(let k=0;k<this.nPlayers;k++){
      const d=this.discs[this.firstPlayer+k];d.vel=[0,0];
      if(d.team===F.RED){d.pos=this.redSpawn[ri]?.slice()||[-this.spawnDistance,this.rowOffset(ri)];ri++;}
      else{d.pos=this.blueSpawn[bi]?.slice()||[this.spawnDistance,this.rowOffset(bi)];bi++;}
      this.kickFlag[k]=false;this.kickHeldPrev[k]=false;this.kickCooldown[k]=0;this.kickBurst[k]=0;d.cmask=F.PLAYER_COLLISION;
    }
    this.state=STATE_KICKOFF;this.goalTimer=0;
  }
  clone(){
    const w=Object.create(World.prototype);
    w.stadium=this.stadium;w.players=this.players.map(p=>Object.assign({},p));
    w.discs=this.discs.map(d=>Object.assign({},d,{pos:d.pos.slice(),vel:d.vel.slice(),gravity:d.gravity.slice()}));
    w.vertices=this.vertices;w.segments=this.segments;w.planes=this.planes;w.goals=this.goals;w.playerIndexById=new Map(this.playerIndexById);
    w.redScore=this.redScore;w.blueScore=this.blueScore;w.steps=this.steps;w.state=this.state;w.kickingTeam=this.kickingTeam;w.goalTimer=this.goalTimer;w.ballCurveSpin=this.ballCurveSpin||0;w.ballCurveTicks=this.ballCurveTicks||0;w.ballCurveTotalTicks=this.ballCurveTotalTicks||0;w.ballCurveIntensity=this.ballCurveIntensity||0;w.ballCurveDir=Array.isArray(this.ballCurveDir)?this.ballCurveDir.slice():[0,0];w.ballBaseColor=this.ballBaseColor||'FFFFFF';
    w.kickRateMin=this.kickRateMin;w.kickRateCost=this.kickRateCost;w.kickRateCap=this.kickRateCap;w.lastGoalConceding=null;w.lastKickBy=null;w.lastBallKickBy=null;
    w.firstPlayer=this.firstPlayer;w.nPlayers=this.nPlayers;w.spawnDistance=this.spawnDistance;w.redSpawn=this.redSpawn;w.blueSpawn=this.blueSpawn;w.kickOffReset=this.kickOffReset;
    w.initialNonPlayer=this.initialNonPlayer.map(x=>({pos:x.pos.slice(),vel:x.vel.slice()}));
    w.kickFlag=this.kickFlag.slice();w.kickHeldPrev=this.kickHeldPrev.slice();w.kickCooldown=this.kickCooldown.slice();w.kickBurst=this.kickBurst.slice();
    return w;
  }
  snapshot(){return this.discs.map(d=>({x:d.pos[0],y:d.pos[1],vx:d.vel[0],vy:d.vel[1],r:d.radius,team:d.team,kind:d.kind,playerId:d.playerId,name:d.name,avatar:d.avatar,bot:d.bot,color:d.color,kick:false}));}
  predictedSnapshot(ms,actions){
    // HaxBall physics is stepped at 60 Hz. For non-integer extrapolation times we
    // interpolate between two fully collision-resolved predicted ticks. The old
    // build advanced positions fractionally without resolving collisions, which
    // could visually overshoot a player/wall/post and then "snap" into the bounce.
    const tf=Math.max(0,(Number(ms)||0)*.06),ticks=Math.floor(tf),frac=tf-ticks;
    const p=this.clone();
    for(let i=0;i<ticks;i++)p.step(actions||new Map(),true);
    const a=p.snapshot();
    if(frac<=0){for(let k=0;k<p.nPlayers;k++)a[p.firstPlayer+k].kick=!!p.kickFlag[k];return a;}
    const q=p.clone();q.step(actions||new Map(),true);const b=q.snapshot(),out=new Array(a.length);
    for(let i=0;i<a.length;i++){
      out[i]=Object.assign({},b[i],{
        x:a[i].x+(b[i].x-a[i].x)*frac,
        y:a[i].y+(b[i].y-a[i].y)*frac,
        vx:a[i].vx+(b[i].vx-a[i].vx)*frac,
        vy:a[i].vy+(b[i].vy-a[i].vy)*frac
      });
    }
    for(let k=0;k<p.nPlayers;k++)out[p.firstPlayer+k].kick=!!p.kickFlag[k];
    return out;
  }
  setScore(r,b){this.redScore=r;this.blueScore=b;}
  setKickRate(min,cost,cap){this.kickRateMin=min|0;this.kickRateCost=cost|0;this.kickRateCap=cap|0;}
  checkGoal(prev,cur){
    for(const g of this.goals){
      const pp=sub(prev,g.p0),cp=sub(cur,g.p0),cp1=sub(cur,g.p1),dv=sub(cur,prev),gv=sub(g.p1,g.p0);
      if(cross(cp,dv)*cross(cp1,dv)<=0 && cross(pp,gv)*cross(cp,gv)<=0)return g.team;
    }
    return null;
  }
  resolveCollisions(){
    const n=this.discs.length;let ballHitWall=false;
    for(let i=0;i<n;i++){
      for(let j=i+1;j<n;j++){
        const a=this.discs[i],b=this.discs[j];if(!collides(a,b))continue;
        const actuallyHit=discDisc(a,b);
        if(actuallyHit&&((i===0&&b.invMass===0)||(j===0&&a.invMass===0)))ballHitWall=true;
      }
      const d=this.discs[i];if(d.invMass===0)continue;
      for(const v of this.vertices)if(collides(d,v)){const actuallyHit=discVertex(d,v);if(i===0&&actuallyHit)ballHitWall=true;}
      for(const p of this.planes)if(collides(d,p)){const actuallyHit=discPlane(d,p);if(i===0&&actuallyHit)ballHitWall=true;}
      for(const s of this.segments){
        if(!collides(d,s))continue;
        let hit=s.curve!==0?segmentCurve(d.pos,s):segmentNoCurve(d.pos,s.v0,s.v1);
        if(!hit)continue;hit=segmentBias(s.bias,hit[0],hit[1]);if(hit){const actuallyHit=segmentFinal(d,s,hit[0],hit[1]);if(i===0&&actuallyHit)ballHitWall=true;}
      }
    }
    return ballHitWall;
  }
  step(actionsById,predictionOnly=false){
    this.lastGoalConceding=null;this.lastKickBy=null;this.lastBallKickBy=null;
    for(let k=0;k<this.nPlayers;k++){
      const pi=this.firstPlayer+k,d=this.discs[pi],pl=this.players[k],act=actionsById.get(pl.id)||[0,0,0,0,0];
      const kickingInput=act[2]>=1,intraFrameRearm=act[2]===2;
      if((kickingInput&&!this.kickHeldPrev[k])||intraFrameRearm)this.kickFlag[k]=true;
      if(!kickingInput)this.kickFlag[k]=false;
      this.kickHeldPrev[k]=kickingInput;
      if(this.kickCooldown[k]>0)this.kickCooldown[k]--;
      if(this.kickBurst[k]<this.kickRateCap)this.kickBurst[k]++;
      const kickAllowed=this.kickFlag[k]&&this.kickCooldown[k]<=0&&this.kickBurst[k]>=0;
      const px=d.pos[0],py=d.pos[1],pr=d.radius,ks=d.kickStrength,kb=d.kickback,pim=d.invMass;
      let didKick=false;
      for(let di=0;di<this.discs.length;di++){
        if(di===pi)continue;const target=this.discs[di];if((target.cgroup&F.KICK)===0)continue;
        const dx=target.pos[0]-px,dy=target.pos[1]-py,dist=SQRT(dx,dy);
        if(dist-target.radius-pr<4 && kickAllowed && dist>0){
          const nx=dx/dist,ny=dy/dist,curveCharge=clamp(Number(act[3])||0,0,1),powerCharge=clamp(Number(act[4])||0,0,1),specialCharge=Math.max(curveCharge,powerCharge);
          // Powershot conserva una escala fija (hasta 1.50x). La comba usa la misma
          // base en x1/x2, pero aumenta gradualmente en los Futsal grandes usando el ancho
          // REAL del .hbs. La raiz cuadrada evita hacer x7 absurdamente 3.57 veces mas fuerte:
          // x1/2 1.50x, x3 ~1.61x, x4 ~1.69x, x5 ~1.80x, x7 ~1.93x a carga maxima.
          const stadiumName=String(this.stadium?.name||'').toLowerCase(),stadiumWidth=Math.max(420,Number(this.stadium?.width)||420);
          const curveMapScale=stadiumName.includes('futsal')?clamp(Math.sqrt(stadiumWidth/420),1,1.85):1;
          const specialPowerExtra=curveCharge>0?.50*curveCharge*curveMapScale:.50*powerCharge;
          const powerMul=target.kind==='ball'?(1+specialPowerExtra):1;
          target.vel[0]+=nx*ks*powerMul*target.invMass;target.vel[1]+=ny*ks*powerMul*target.invMass;
          d.vel[0]+=nx*-kb*pim;d.vel[1]+=ny*-kb*pim;
          if(target.kind==='ball'){
            if(curveCharge>0){
              // Dirección como Curve Bot v2: perpendicular al disparo, elegida por el
              // movimiento lateral del jugador. Si patea completamente recto/parado,
              // elegimos un lado determinista para que /c SIEMPRE produzca comba visible.
              const mix=Number(act[0])||0,miy=Number(act[1])||0;
              let side=(-ny)*mix+nx*miy;
              if(Math.abs(side)<.10)side=(-ny)*d.vel[0]+nx*d.vel[1];
              if(Math.abs(side)<.04)side=pl.team===1?1:-1;
              const sign=side>=0?1:-1;
              this.ballCurveDir=[-ny*sign,nx*sign];
              this.ballCurveIntensity=clamp(.25+.55*curveCharge,.25,.80);
              this.ballCurveSpin=sign*curveCharge; // se conserva para snapshots/versiones anteriores
              this.ballCurveTotalTicks=96; // 1.6 s a 60 Hz, igual que Curve Bot v2
              this.ballCurveTicks=this.ballCurveTotalTicks;
            }else{
              this.ballCurveSpin=0;this.ballCurveTicks=0;this.ballCurveTotalTicks=0;this.ballCurveIntensity=0;this.ballCurveDir=[0,0];
            }
            if(!predictionOnly)this.lastBallKickBy=pl.id;
          }
          didKick=true;if(!predictionOnly)this.lastKickBy=pl.id;
        }
      }
      if(didKick){this.kickFlag[k]=false;this.kickCooldown[k]=this.kickRateMin;this.kickBurst[k]-=this.kickRateCost;}
      const ix=act[0],iy=act[1],len=SQRT(ix,iy),nx=len>0?ix/len:0,ny=len>0?iy/len:0;
      const accel=this.kickFlag[k]?d.kickAccel:d.accel;
      d.vel[0]+=nx*accel;d.vel[1]+=ny*accel;
    }
    // Comba autoritativa mientras la pelota está en vuelo libre. La fuerza se mantiene
    // perpendicular a la velocidad para doblar la trayectoria sin convertirla en otro
    // powershot. Si después hay un choque REAL con pared/poste, resolveCollisions lo
    // informa y el efecto se cancela inmediatamente más abajo.
    if(this.ballCurveTicks>0&&this.ballCurveIntensity>0){
      const cb=this.discs[0],elapsed=(Math.max(0,(this.ballCurveTotalTicks||96)-this.ballCurveTicks))/60;
      const increasing=(Math.min(elapsed*3,.7)*(1+this.ballCurveIntensity*4))/1.6;
      const speed=SQRT(cb.vel[0],cb.vel[1]),sign=this.ballCurveSpin>=0?1:-1;
      if(speed>.0001){
        const tx=cb.vel[0]/speed,ty=cb.vel[1]/speed;
        // Unit normal to current trajectory; therefore the curve force stays lateral
        // and does not artificially add/remove forward speed after a bounce.
        this.ballCurveDir=[-ty*sign,tx*sign];
        const lateral=.05*increasing;
        cb.vel[0]+=this.ballCurveDir[0]*lateral;cb.vel[1]+=this.ballCurveDir[1]*lateral;
      }
      this.ballCurveTicks--;
      if(this.ballCurveTicks<=0){this.ballCurveSpin=0;this.ballCurveTicks=0;this.ballCurveTotalTicks=0;this.ballCurveIntensity=0;this.ballCurveDir=[0,0];}
    }
    // Any disc carrying the `score` collision flag can cross a goal line and score.
    // Standard maps only give it to the ball, but custom .hbs files may use it elsewhere.
    const prevScoreDiscs=[];for(let di=0;di<this.firstPlayer;di++)if((this.discs[di].cgroup&F.SCORE)!==0)prevScoreDiscs.push([di,this.discs[di].pos.slice()]);
    const ball=this.discs[0];
    for(let k=0;k<this.nPlayers;k++){
      const d=this.discs[this.firstPlayer+k],kf=this.kickFlag[k];
      d.pos[0]+=d.vel[0];d.pos[1]+=d.vel[1];
      const damping=kf?d.kickDamping:d.damping;
      d.vel[0]=(d.vel[0]+d.gravity[0])*damping;d.vel[1]=(d.vel[1]+d.gravity[1])*damping;
    }
    for(let di=0;di<this.firstPlayer;di++){
      const d=this.discs[di];d.pos[0]+=d.vel[0];d.pos[1]+=d.vel[1];
      d.vel[0]=(d.vel[0]+d.gravity[0])*d.damping;d.vel[1]=(d.vel[1]+d.gravity[1])*d.damping;
    }
    const ballHitWall=this.resolveCollisions();
    // En el modo COMBA, el primer rebote contra pared/segmento/plano/poste cancela
    // inmediatamente el efecto lateral. El rebote conserva toda la velocidad que ya
    // tenia (incluida la potencia del disparo), pero desde el siguiente tick vuela como
    // una pelota normal. Powershot no tiene fuerza persistente, asi que su potencia sigue.
    if(ballHitWall&&this.ballCurveTicks>0){this.ballCurveSpin=0;this.ballCurveTicks=0;this.ballCurveTotalTicks=0;this.ballCurveIntensity=0;this.ballCurveDir=[0,0];}
    this.steps++;
    if(this.state===STATE_KICKOFF){
      const ko=this.kickingTeam===F.RED?F.REDKO:F.BLUEKO;
      for(let k=0;k<this.nPlayers;k++)this.discs[this.firstPlayer+k].cmask=F.PLAYER_COLLISION|ko;
      const vx=ball.vel[0],vy=ball.vel[1];if(vx*vx+vy*vy>0)this.state=STATE_PLAYING;
    }else if(this.state===STATE_PLAYING){
      for(let k=0;k<this.nPlayers;k++)this.discs[this.firstPlayer+k].cmask=F.PLAYER_COLLISION;
      let conceded=null;
      for(const [di,prev] of prevScoreDiscs){conceded=this.checkGoal(prev,this.discs[di].pos);if(conceded)break;}
      if(conceded){
        if(conceded===F.RED)this.blueScore++;else this.redScore++;
        this.kickingTeam=conceded;this.state=STATE_GOAL;this.goalTimer=150;
        if(!predictionOnly)this.lastGoalConceding=conceded;
      }
    }else{
      this.goalTimer--;if(this.goalTimer<=0)this.resetPositions();
    }
    return {goalConceding:this.lastGoalConceding,kickBy:this.lastKickBy,ballKickBy:this.lastBallKickBy};
  }
}

function validateStadium(obj){
  if(!obj||typeof obj!=='object')throw new Error('El archivo .hbs no contiene un estadio válido.');
  if(!Array.isArray(obj.vertexes)||!Array.isArray(obj.segments)||!Array.isArray(obj.planes))throw new Error('Al mapa le faltan vertexes, segments o planes.');
  if(Array.isArray(obj.joints)&&obj.joints.length)throw new Error('Este mapa usa joints; todavía no están soportados con fidelidad y no se cargará de forma silenciosamente incorrecta.');
  return obj;
}

global.HBEngine={F,STATE_KICKOFF,STATE_PLAYING,STATE_GOAL,World,CLASSIC,SMALL,BIG,validateStadium,parseFlags};
if(typeof module!=='undefined'&&module.exports)module.exports=global.HBEngine;
})(typeof window!=='undefined'?window:globalThis);
