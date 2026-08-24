(function(){
'use strict';
const E=window.HBEngine,F=E.F;
const BUILTIN_STADIUMS=window.HB_BUILTIN_STADIUMS||{};
const socket=window.io({transports:['websocket','polling']});
const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
const defaults={nick:'Jugador',avatar:'',extrapolation:0,extrapolationTouched:false,showChat:true,showNames:true,sound:true,lowLatency:true,view:'1',fps:'0',chatOpacity:72,chatWidth:'compact',chatHeight:260,volume:70};
let settings=Object.assign({},defaults,readJSON('hbLocalV2Settings',{}));
// V2-V7 defaulted to a whole-stadium fit view. HaxBall's normal view is 1 world
// unit per CSS pixel with a following camera; migrate the old untouched default once.
try{if(!localStorage.getItem('hbLocalV8CameraMigrated')){if(settings.view==='fit')settings.view='1';localStorage.setItem('hbLocalV8CameraMigrated','1');localStorage.setItem('hbLocalV2Settings',JSON.stringify(settings));}}catch{}
let canvas=$('#gameCanvas'),ctx=canvas.getContext('2d',{alpha:false,desynchronized:settings.lowLatency!==false});
let onlineRooms=[];
let selectedRoomId=null;
let room={id:null,name:'',maxPlayers:8,password:'',unlisted:false,owned:false,hostPeerId:null};
let players=[],myPlayerId=null,world=null,selectedStadium=E.CLASSIC,customStadium=null,selectedStadiumKey='classic';
let gameRunning=false,paused=false,overtime=false,pendingWinner=0,elapsedTicks=0,endingGame=false,finalWinner=0,goalScoringTeam=0;
let menuOpen=true,teamsLocked=false,keys=new Set(),lastActions=new Map();
let replayRecording=false,replayFrames=[];
let contextPlayerId=null;
let accumulator=0,lastFrame=performance.now(),lastRender=0,audioCtx=null,chatDrag=null;
let prevPhysicsSnapshot=null,currPhysicsSnapshot=null,lastNetPacket=null,lastNetSnapshotAt=0,inputSeq=0,lastSentInput='',myPing=0;
let peerLinks=new Map(),hostLink=null,peerInputs=new Map(),hostSnapshotDivider=0,hostMetaDivider=0,hostPendingWinner=0,hostFinishing=false;
const RTC_CONFIG={iceServers:[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}],iceCandidatePoolSize:2};
let pendingRoomFromUrl=new URLSearchParams(location.search).get('room')||null,lastJoinPassword='';

// Team-color presets use HaxBall's /colors model: angle, avatar/text color, up to 3 stripes.
const DEFAULT_TEAM_KITS={
  1:{angle:0,textColor:'FFFFFF',colors:['D95A56']},
  2:{angle:0,textColor:'FFFFFF',colors:['5678D8']}
};
const PARTIDOS={
  argfra:{name:'Argentina vs Francia',red:{angle:180,textColor:'333A3C',colors:['EFF6FC','BBE3F4','EFF6FC']},blue:{angle:90,textColor:'EABC78',colors:['1B2A4A']}},
  argbra:{name:'Argentina vs Brasil',red:{angle:180,textColor:'333A3C',colors:['EFF6FC','BBE3F4','EFF6FC']},blue:{angle:220,textColor:'038434',colors:['F8DD2E']}},
  rivboc:{name:'River vs Boca',red:{angle:30,textColor:'231F20',colors:['FFFFFF','EE1B2C','FFFFFF']},blue:{angle:90,textColor:'FFFFFF',colors:['033F86','FAB900','033F86']}},
  indrac:{name:'Independiente vs Racing',red:{angle:60,textColor:'FFFFFF',colors:['EC1C24']},blue:{angle:180,textColor:'002942',colors:['00A5E3','FFFFFF','00A5E3']}},
  nobcen:{name:"Newell's vs Rosario Central",red:{angle:180,textColor:'FFFFFF',colors:['000000','BF0311']},blue:{angle:180,textColor:'FFFFFF',colors:['FCD724','0D3E66','FCD724']}},
  pennac:{name:'Peñarol vs Nacional',red:{angle:180,textColor:'FFFFFF',colors:['FFCA00','000000','FFCA00']},blue:{angle:55,textColor:'D0142C',colors:['003895','FFFFFF','003895']}},
  barrma:{name:'Barcelona vs Real Madrid',red:{angle:180,textColor:'F5B606',colors:['011EDE','C80056']},blue:{angle:73,textColor:'0F2145',colors:['FFC10A','FFFFFF','FFFFFF']}},
  acmint:{name:'AC Milan vs Inter',red:{angle:180,textColor:'FFFFFF',colors:['DF061B','000000','DF061B']},blue:{angle:180,textColor:'FFFFFF',colors:['00239C','000000','00239C']}},
  baybvb:{name:'Bayern vs Borussia Dortmund',red:{angle:90,textColor:'FFFFFF',colors:['DC052D','ED0038','ED0038']},blue:{angle:90,textColor:'1D1D1B',colors:['1D1D1B','FAD515','FAD515']}},
  munmci:{name:'Manchester United vs Manchester City',red:{angle:90,textColor:'FFFFFF',colors:['D90119','C7011A','AB0918']},blue:{angle:55,textColor:'FFFFFF',colors:['6DACDF']}}
};
function cleanHex(v,fallback='FFFFFF'){let h=String(v??'').replace(/^#/,'').trim();if(!/^[0-9a-f]{1,6}$/i.test(h))h=fallback;return h.padStart(6,'0').slice(-6).toUpperCase();}
function cloneKit(k){return {angle:Number(k?.angle)||0,textColor:cleanHex(k?.textColor),colors:(k?.colors?.length?k.colors:['FFFFFF']).slice(0,3).map(x=>cleanHex(x))};}
let teamKits={1:cloneKit(DEFAULT_TEAM_KITS[1]),2:cloneKit(DEFAULT_TEAM_KITS[2])};
function resetTeamKits(){teamKits={1:cloneKit(DEFAULT_TEAM_KITS[1]),2:cloneKit(DEFAULT_TEAM_KITS[2])};}
const stadiumTiles={grass:new Image(),hockey:new Image()};
stadiumTiles.grass.src='assets/grasstile.png';stadiumTiles.hockey.src='assets/hockeytile.png';
stadiumTiles.grass.onload=stadiumTiles.hockey.onload=()=>{try{render();}catch{}};

function readJSON(k,fallback){try{return JSON.parse(localStorage.getItem(k)||'null')||fallback}catch{return fallback}}
function saveSettings(){try{localStorage.setItem('hbLocalV2Settings',JSON.stringify(settings));}catch{}}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function colorToCss(value,fallback='#000000'){
  if(value==null)return fallback;
  if(Array.isArray(value)&&value.length>=3)return `rgb(${clamp(+value[0]||0,0,255)},${clamp(+value[1]||0,0,255)},${clamp(+value[2]||0,0,255)})`;
  const raw=String(value).trim();if(!raw)return fallback;if(raw.toLowerCase()==='transparent')return 'rgba(0,0,0,0)';
  if(/^#?[0-9a-f]+$/i.test(raw)){let h=raw.replace('#','');if(h.length<6)h=h.padStart(6,'0');if(h.length>6)h=h.slice(-6);return '#'+h;}
  return fallback;
}
function teamName(t){return t===1?'Rojo':t===2?'Azul':'Espectadores';}
function stadiumDisplayName(st){const n=st?.name||'Clásico';if(n==='Classic')return 'Clásico';if(n==='Small')return 'Pequeño';if(n==='Big')return 'Grande';if(/^Futsal x1 and x2/i.test(n))return 'Futsal x1/x2';if(/^Futsal x3/i.test(n))return 'Futsal x3';if(/^Futsal x4/i.test(n))return 'Futsal x4';if(/^Futsal x5/i.test(n))return 'Futsal x5 GLH';if(/^Futsal x7/i.test(n))return 'Futsal x7';return n;}
function formatTime(ticks){const sec=Math.max(0,Math.floor(ticks/60));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function human(){return players.find(p=>p.id===myPlayerId)||null;}
function activePlayers(){return players.filter(p=>p.team===1||p.team===2);}
function beep(freq=450,dur=.035,gain=.035){
  if(!settings.sound||settings.volume<=0)return;
  try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.frequency.value=freq;g.gain.value=gain*(settings.volume/100);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur);}catch{}
}
function show(view){for(const id of ['nickView','roomsView','createView','gameView'])$('#'+id).classList.add('hidden');$('#'+view).classList.remove('hidden');$('#siteNav').classList.toggle('hidden',view==='gameView');}


/* ---------- WebRTC host-authoritative gameplay ---------- */
function isHost(){return !!room.id&&!!room.hostPeerId&&socket.id===room.hostPeerId;}
function dcOpen(dc){return !!dc&&dc.readyState==='open';}
function safeDcSend(dc,obj){if(!dcOpen(dc))return false;try{dc.send(JSON.stringify(obj));return true;}catch{return false;}}
function closeLink(link){if(!link)return;try{link.dc&&link.dc.close();}catch{}try{link.pc&&link.pc.close();}catch{}}
function closeAllRtc(){for(const l of peerLinks.values())closeLink(l);peerLinks.clear();closeLink(hostLink);hostLink=null;peerInputs.clear();myPing=isHost()?0:999;}
function queueOrAddIce(link,candidate){if(!link||!candidate)return;if(link.pc.remoteDescription){link.pc.addIceCandidate(candidate).catch(()=>{});}else link.pendingIce.push(candidate);}
async function flushIce(link){if(!link?.pc?.remoteDescription)return;const q=link.pendingIce.splice(0);for(const c of q)try{await link.pc.addIceCandidate(c);}catch{}}
function makePc(peerId){
  const pc=new RTCPeerConnection(RTC_CONFIG),link={pc,dc:null,peerId,pendingIce:[],playerId:null,lastPingSent:0,pingSeq:0};
  pc.onicecandidate=e=>{if(e.candidate&&room.id)socket.emit('rtc:ice',{target:peerId,candidate:e.candidate});};
  return link;
}
function bindGameChannel(link,dc,asHost){
  link.dc=dc;dc.binaryType='arraybuffer';
  dc.onopen=()=>{if(asHost){sendHostSnapshot(true,link);safeDcSend(dc,{t:'hello',host:true});}else{safeDcSend(dc,{t:'hello',host:false});startDirectPing();}};
  dc.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}if(asHost)handleGuestData(link,m);else handleHostData(link,m);};
  dc.onclose=()=>{if(!room.id)return;if(asHost){peerInputs.delete(link.playerId);setTimeout(syncPeerTopology,700);}else{myPing=999;$('#pingHud').textContent='Ping: —';setTimeout(syncPeerTopology,700);}};
  dc.onerror=()=>{};
}
async function createHostPeer(p){
  if(!isHost()||!p?.peerId||p.bot||p.id===myPlayerId||peerLinks.has(p.peerId))return;
  const link=makePc(p.peerId);link.playerId=p.id;peerLinks.set(p.peerId,link);
  const dc=link.pc.createDataChannel('hb-game',{ordered:false,maxRetransmits:0});bindGameChannel(link,dc,true);
  link.pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(link.pc.connectionState)){closeLink(link);peerLinks.delete(p.peerId);peerInputs.delete(p.id);setTimeout(syncPeerTopology,900);}};
  try{const offer=await link.pc.createOffer();await link.pc.setLocalDescription(offer);socket.emit('rtc:offer',{target:p.peerId,sdp:link.pc.localDescription});}catch{closeLink(link);peerLinks.delete(p.peerId);}
}
async function acceptHostOffer(from,sdp){
  if(!room.id||isHost()||from!==room.hostPeerId)return;
  closeLink(hostLink);hostLink=makePc(from);
  hostLink.pc.ondatachannel=e=>bindGameChannel(hostLink,e.channel,false);
  hostLink.pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(hostLink?.pc?.connectionState)){closeLink(hostLink);hostLink=null;myPing=999;setTimeout(syncPeerTopology,900);}};
  try{await hostLink.pc.setRemoteDescription(sdp);await flushIce(hostLink);const ans=await hostLink.pc.createAnswer();await hostLink.pc.setLocalDescription(ans);socket.emit('rtc:answer',{target:from,sdp:hostLink.pc.localDescription});}catch{closeLink(hostLink);hostLink=null;}
}
async function acceptGuestAnswer(from,sdp){const link=peerLinks.get(from);if(!link||!isHost())return;try{await link.pc.setRemoteDescription(sdp);await flushIce(link);}catch{}}
function syncPeerTopology(){
  if(!room.id||typeof RTCPeerConnection==='undefined')return;
  if(isHost()){
    if(hostLink){closeLink(hostLink);hostLink=null;}
    const wanted=new Set();for(const p of players){if(p.bot||p.id===myPlayerId||!p.peerId)continue;wanted.add(p.peerId);if(!peerLinks.has(p.peerId))createHostPeer(p);else peerLinks.get(p.peerId).playerId=p.id;}
    for(const [id,l] of [...peerLinks])if(!wanted.has(id)){closeLink(l);peerLinks.delete(id);peerInputs.delete(l.playerId);}
    myPing=0;socket.emit('player:ping',{ping:0});
  }else{
    for(const l of peerLinks.values())closeLink(l);peerLinks.clear();
    if(hostLink&&hostLink.peerId!==room.hostPeerId){closeLink(hostLink);hostLink=null;}
  }
}
socket.on('rtc:offer',m=>acceptHostOffer(m?.from,m?.sdp));
socket.on('rtc:answer',m=>acceptGuestAnswer(m?.from,m?.sdp));
socket.on('rtc:ice',m=>{const link=isHost()?peerLinks.get(m?.from):hostLink;if(link&&m?.from===link.peerId)queueOrAddIce(link,m.candidate);});
function handleGuestData(link,m){
  if(!isHost()||!m)return;
  if(m.t==='i'){const p=players.find(x=>x.id===link.playerId);if(!p||p.bot)return;const prev=peerInputs.get(p.id);if(prev&&Number(m.seq)<prev.seq)return;peerInputs.set(p.id,{seq:Number(m.seq)||0,act:[clamp(Number(m.x)||0,-1,1),clamp(Number(m.y)||0,-1,1),m.k?1:0]});}
  else if(m.t==='p'){safeDcSend(link.dc,{t:'q',n:m.n,ts:m.ts});}
}
function handleHostData(link,m){
  if(!m)return;if(m.t==='s')applyPacketToWorld(m,true);else if(m.t==='q'&&Number.isFinite(m.ts)){myPing=Math.max(0,Math.round(performance.now()-m.ts));socket.emit('player:ping',{ping:myPing});const me=human();if(me)me.ping=myPing;$('#pingHud').textContent=`Ping: ${myPing}`;}
}
function startDirectPing(){if(isHost()){myPing=0;return;}if(!dcOpen(hostLink?.dc))return;hostLink.pingSeq=(hostLink.pingSeq||0)+1;safeDcSend(hostLink.dc,{t:'p',n:hostLink.pingSeq,ts:performance.now()});}
setInterval(()=>{if(!room.id)return;if(isHost()){myPing=0;$('#pingHud').textContent='Ping: 0';socket.emit('player:ping',{ping:0});}else startDirectPing();},900);
function makeGamePacket(){
  if(!world)return null;const snap=world.snapshot();return {t:'s',tick:world.steps,running:gameRunning,paused,overtime,elapsedTicks,redScore:world.redScore,blueScore:world.blueScore,state:world.state,kickingTeam:world.kickingTeam,goalTimer:world.goalTimer,goalScoringTeam,ending:endingGame,finalWinner,discs:snap.map(d=>[d.x,d.y,d.vx,d.vy,d.r]),kickFlags:world.kickFlag.slice()};
}
function sendHostSnapshot(force=false,onlyLink=null){if(!isHost()||!world)return;const pkt=makeGamePacket();if(!pkt)return;lastNetPacket=pkt;prevPhysicsSnapshot=currPhysicsSnapshot||world.snapshot();currPhysicsSnapshot=world.snapshot();lastNetSnapshotAt=performance.now();const links=onlyLink?[onlyLink]:[...peerLinks.values()];for(const l of links)safeDcSend(l.dc,pkt);if(force)updateHud();}
function botAction(p){
  if(!world)return [0,0,0];const i=world.playerIndexById.get(p.id);if(i==null)return [0,0,0];const d=world.discs[i],b=world.discs[0],attack=p.team===1?1:-1,dist=Math.sqrt((b.pos[0]-d.pos[0])**2+(b.pos[1]-d.pos[1])**2);let tx,ty;
  if(world.state===E.STATE_KICKOFF&&world.kickingTeam!==d.team){tx=p.team===1?-world.spawnDistance:world.spawnDistance;ty=0;}else{tx=b.pos[0]-attack*24;ty=b.pos[1];}
  const dx=tx-d.pos[0],dy=ty-d.pos[1];return [Math.abs(dx)<2?0:Math.sign(dx),Math.abs(dy)<2?0:Math.sign(dy),dist<34?1:0];
}
function hostActions(localAct){const m=new Map();for(const p of players){if(!(p.team===1||p.team===2))continue;if(p.bot)m.set(p.id,botAction(p));else if(p.id===myPlayerId)m.set(p.id,localAct);else m.set(p.id,peerInputs.get(p.id)?.act||[0,0,0]);}return m;}
function rebuildHostWorld(oldWorld){
  const nw=new E.World(selectedStadium,players);if(!oldWorld)return nw;nw.redScore=oldWorld.redScore;nw.blueScore=oldWorld.blueScore;nw.state=oldWorld.state;nw.kickingTeam=oldWorld.kickingTeam;nw.goalTimer=oldWorld.goalTimer;nw.steps=oldWorld.steps;
  const non=Math.min(nw.firstPlayer,oldWorld.firstPlayer);for(let i=0;i<non;i++){nw.discs[i].pos=oldWorld.discs[i].pos.slice();nw.discs[i].vel=oldWorld.discs[i].vel.slice();}
  for(const p of players){if(!(p.team===1||p.team===2))continue;const ni=nw.playerIndexById.get(p.id),oi=oldWorld.playerIndexById.get(p.id);if(ni==null||oi==null)continue;nw.discs[ni].pos=oldWorld.discs[oi].pos.slice();nw.discs[ni].vel=oldWorld.discs[oi].vel.slice();}
  return nw;
}
function hostStep(localAct){
  if(!isHost()||!gameRunning||paused||endingGame||!world)return;lastActions=hostActions(localAct);const r=world.step(lastActions);elapsedTicks++;
  if(r.goalConceding){const scoring=r.goalConceding===F.RED?2:1;goalScoringTeam=scoring;if((room.scoreLimit||0)>0&&(world.redScore>=room.scoreLimit||world.blueScore>=room.scoreLimit))hostPendingWinner=world.redScore>world.blueScore?1:2;if(overtime)hostPendingWinner=scoring;}
  if(world.state!==E.STATE_GOAL&&!hostPendingWinner)goalScoringTeam=0;
  if(hostPendingWinner&&world.state===E.STATE_KICKOFF&&!hostFinishing){hostFinishing=true;gameRunning=false;endingGame=true;finalWinner=hostPendingWinner;sendHostSnapshot(true);socket.emit('room:hostFinish',{team:hostPendingWinner});return;}
  if((room.timeLimit||0)>0&&!overtime&&elapsedTicks>=room.timeLimit*3600){if(world.redScore===world.blueScore)overtime=true;else if(!hostFinishing){hostPendingWinner=world.redScore>world.blueScore?1:2;hostFinishing=true;gameRunning=false;endingGame=true;finalWinner=hostPendingWinner;sendHostSnapshot(true);socket.emit('room:hostFinish',{team:hostPendingWinner});return;}}
  hostSnapshotDivider++;if(hostSnapshotDivider>=2){hostSnapshotDivider=0;sendHostSnapshot(false);}hostMetaDivider++;if(hostMetaDivider>=60){hostMetaDivider=0;socket.emit('room:hostMeta',{elapsedTicks,overtime});}
}

/* ---------- startup + room list ---------- */
function populateMaxPlayers(){for(let i=2;i<=22;i++)$('#createMax').append(new Option(i,i));$('#createMax').value='8';}
populateMaxPlayers();
$('#nickInput').value=settings.nick;
setTimeout(()=>$('#nickInput').focus(),20);
$('#nickOk').onclick=acceptNick;
$('#nickInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();acceptNick();}});
function acceptNick(){settings.nick=$('#nickInput').value.trim()||'Jugador';saveSettings();socket.emit('rooms:get');renderRoomList();show('roomsView');}
function renderRoomList(){
  const rows=$('#roomRows');rows.innerHTML='';
  const visible=onlineRooms.filter(r=>(($('#showEmptyRooms').checked||r.players>0)&&($('#showFullRooms').checked||r.players<r.maxPlayers)&&($('#showLockedRooms').checked||!r.password)));
  if(selectedRoomId&&!visible.some(r=>r.id===selectedRoomId))selectedRoomId=visible[0]?.id||null;
  visible.forEach(r=>{
    const d=document.createElement('div');d.className='room-row'+(r.id===selectedRoomId?' selected':'');d.dataset.id=r.id;
    d.innerHTML=`<span class="room-name"></span><span>${r.players}/${r.maxPlayers}</span><span>${r.password?'🔒':''}</span><span><span class="flag">🌐</span>${r.distance||'—'}</span>`;
    d.querySelector('.room-name').append(document.createTextNode(r.name+(r.running?'  ▶':'')));
    d.onclick=()=>{selectedRoomId=r.id;renderRoomList();};d.ondblclick=()=>joinSelectedRoom();rows.appendChild(d);
  });
  const total=visible.reduce((a,r)=>a+r.players,0);$('#roomStats').textContent=`${total} jugador${total===1?'':'es'} en ${visible.length} sala${visible.length===1?'':'s'}`;
}
$('#showEmptyRooms').onchange=renderRoomList;$('#showFullRooms').onchange=renderRoomList;$('#showLockedRooms').onchange=renderRoomList;
$('#refreshRooms').onclick=()=>{socket.emit('rooms:get');flashButton($('#refreshRooms'),'Actualizando…');};
$('#joinRoom').onclick=joinSelectedRoom;
function joinSelectedRoom(){
  const r=onlineRooms.find(x=>x.id===selectedRoomId);if(!r)return;
  const password=r.password?(prompt('Contraseña de la sala:')??''):'';if(r.password&&password==='')return;lastJoinPassword=password;
  socket.emit('room:join',{roomId:r.id,password,nick:settings.nick,avatar:settings.avatar},res=>{if(!res?.ok){alert(res?.error||'No se pudo entrar.');return;}myPlayerId=res.myPlayerId;enterRoomState(res.state);});
}
$('#openCreate').onclick=()=>{$('#createName').value=`Sala de ${settings.nick}`;$('#createPass').value='';$('#unlistedBtn').dataset.unlisted='false';$('#unlistedBtn').textContent='Mostrar en la lista: Sí';show('createView');setTimeout(()=>$('#createName').focus(),0);};
$('#cancelCreate').onclick=()=>show('roomsView');
$('#unlistedBtn').onclick=()=>{const b=$('#unlistedBtn'),v=b.dataset.unlisted!=='true';b.dataset.unlisted=String(v);b.textContent=`Mostrar en la lista: ${v?'No':'Sí'}`;};
$('#createConfirm').onclick=()=>{
  const name=$('#createName').value.trim();if(!name){$('#createName').focus();return;}
  socket.emit('room:create',{name,maxPlayers:+$('#createMax').value,password:$('#createPass').value,unlisted:$('#unlistedBtn').dataset.unlisted==='true',nick:settings.nick,avatar:settings.avatar},res=>{if(!res?.ok){alert(res?.error||'No se pudo crear la sala.');return;}myPlayerId=res.myPlayerId;lastJoinPassword=$('#createPass').value;enterRoomState(res.state);});
};
$('#optionsFromLobby').onclick=openSettings;
$('#logoutBtn').onclick=()=>{show('nickView');setTimeout(()=>$('#nickInput').focus(),0);};
$('#replaysBtn').onclick=()=>alert('Las repeticiones se graban desde una sala con el botón Grabar.');

socket.on('connect',()=>{socket.emit('rooms:get');});
socket.on('rooms:list',list=>{onlineRooms=Array.isArray(list)?list:[];if(!selectedRoomId)selectedRoomId=onlineRooms[0]?.id||null;renderRoomList();
  if(pendingRoomFromUrl&&$('#roomsView')&&!$('#roomsView').classList.contains('hidden')){const r=onlineRooms.find(x=>x.id===pendingRoomFromUrl);if(r){selectedRoomId=r.id;pendingRoomFromUrl=null;setTimeout(joinSelectedRoom,30);}}
});
socket.on('disconnect',()=>{if(room.id)addSystem('Conexión perdida. Intentando reconectar…');});
socket.on('room:closed',data=>{alert(data?.message||'La sala se cerró.');resetToLobby();});
socket.on('room:kicked',data=>{alert(data?.ban?'Fuiste baneado de la sala.':'Fuiste expulsado de la sala.');resetToLobby();});
socket.on('chat:message',m=>{if(!m)return;addChat(m.text||'',m.type||'system',m.name||'');});
// El ping mostrado durante una sala se mide directo contra el host por WebRTC.
/* ---------- room ---------- */
function currentActiveSignature(){return players.filter(p=>p.team===1||p.team===2).map(p=>p.id).join(',');}
function worldActiveSignature(){return world?.players?.map(p=>p.id).join(',')||'';}
function ensureGameWorld(force=false,oldWorld=null){
  if(!(gameRunning||endingGame)){world=null;prevPhysicsSnapshot=null;currPhysicsSnapshot=null;lastNetPacket=null;return;}
  if(!force&&world&&worldActiveSignature()===currentActiveSignature())return;
  if(isHost()){
    world=oldWorld?rebuildHostWorld(oldWorld):new E.World(selectedStadium,players);
    prevPhysicsSnapshot=world.snapshot();currPhysicsSnapshot=world.snapshot();lastNetSnapshotAt=performance.now();
  }else{
    world=new E.World(selectedStadium,players);
    if(lastNetPacket)applyPacketToWorld(lastNetPacket,false);else{prevPhysicsSnapshot=world.snapshot();currPhysicsSnapshot=world.snapshot();}
  }
}
function syncRoomUI(){
  $('#roomTitle').textContent=room.name||'Sala';$('#lockTeams').classList.toggle('active',teamsLocked);$('#lockTeams').textContent=teamsLocked?'🔒 Desbloquear':'🔓 Bloquear';
  $('#startStop').textContent=gameRunning?'■ Detener partida':'▶ Iniciar partida';$('#timeLimit').value=String(room.timeLimit??3);$('#scoreLimit').value=String(room.scoreLimit??3);
  $('#stadiumSelect').value=selectedStadiumKey;$('#stadiumCurrent').textContent=stadiumDisplayName(selectedStadium);$$('.stadium-choice').forEach(b=>b.classList.toggle('selected',b.dataset.stadium===selectedStadiumKey));
  renderPlayers();updateHud();
}
function applyRoomState(st){
  if(!st||st.id!==room.id)return;
  const oldSig=currentActiveSignature(),oldStadium=selectedStadiumKey,oldWorld=world,wasRunning=gameRunning,wasPaused=paused,wasEnding=endingGame;
  players=(st.players||[]).map(p=>Object.assign({},p));teamsLocked=!!st.teamsLocked;
  room=Object.assign(room,{id:st.id,name:st.name,maxPlayers:st.maxPlayers,unlisted:st.unlisted,owned:myPlayerId===st.ownerPlayerId,hostPeerId:st.hostPeerId||null,timeLimit:st.timeLimit,scoreLimit:st.scoreLimit});
  selectedStadiumKey=st.stadiumKey||'classic';selectedStadium=st.stadium||E.CLASSIC;customStadium=selectedStadiumKey==='custom'?selectedStadium:null;teamKits=st.teamKits||teamKits;
  gameRunning=!!st.game?.running;paused=!!st.game?.paused;overtime=!!st.game?.overtime;if(!isHost()||!wasRunning)elapsedTicks=st.game?.elapsedTicks||elapsedTicks;endingGame=!!st.game?.ending;finalWinner=st.game?.finalWinner||0;
  const started=!wasRunning&&gameRunning,stopped=(wasRunning||wasEnding)&&!(gameRunning||endingGame),mustRebuild=started||(oldSig!==currentActiveSignature())||(oldStadium!==selectedStadiumKey);
  if(started&&isHost()){hostPendingWinner=0;hostFinishing=false;goalScoringTeam=0;elapsedTicks=0;overtime=false;lastNetPacket=null;world=null;}
  ensureGameWorld(mustRebuild,mustRebuild&&oldWorld&&!started?oldWorld:null);
  if(stopped){hostPendingWinner=0;hostFinishing=false;goalScoringTeam=0;}
  syncPeerTopology();syncRoomUI();syncGameViewState();
  if(started){menuOpen=false;$('#roomMenu').classList.add('closed');syncGameViewState();}
  if(isHost()&&world&&(started||mustRebuild||wasPaused!==paused))setTimeout(()=>sendHostSnapshot(true),0);
}
function enterRoomState(st){
  room={id:st.id,name:st.name,maxPlayers:st.maxPlayers,password:'',unlisted:st.unlisted,owned:myPlayerId===st.ownerPlayerId,hostPeerId:st.hostPeerId||null,timeLimit:st.timeLimit,scoreLimit:st.scoreLimit};
  closeAllRtc();players=[];world=null;lastNetPacket=null;prevPhysicsSnapshot=null;currPhysicsSnapshot=null;gameRunning=false;paused=false;overtime=false;elapsedTicks=0;endingGame=false;finalWinner=0;goalScoringTeam=0;menuOpen=true;keys.clear();resetVisualCamera();
  clearChat();applyRoomState(st);if(settings.extrapolationTouched)addSystem(`Extrapolation: ${settings.extrapolation} ms.`);applySettingsToUI();resizeCanvas();show('gameView');setRoomMenu(!(gameRunning||endingGame));render();
}
function resetToLobby(){
  closeAllRtc();room={id:null,name:'',maxPlayers:8,password:'',unlisted:false,owned:false,hostPeerId:null};players=[];myPlayerId=null;world=null;lastNetPacket=null;prevPhysicsSnapshot=null;currPhysicsSnapshot=null;gameRunning=false;paused=false;endingGame=false;keys.clear();hidePlayerContext();show('roomsView');socket.emit('rooms:get');
}
function leaveRoom(){socket.emit('room:leave',{},()=>resetToLobby());}
$('#leaveRoomBtn').onclick=leaveRoom;
$('#roomMenuBtn').onclick=()=>setRoomMenu(!menuOpen);
function setRoomMenu(open){menuOpen=!!open;$('#roomMenu').classList.toggle('closed',!menuOpen);keys.clear();hidePlayerContext();syncGameViewState();}
socket.on('room:state',st=>{if(room.id===st?.id)applyRoomState(st);});
socket.on('room:pings',list=>{if(!Array.isArray(list))return;for(const [id,ping] of list){const p=players.find(x=>x.id===id);if(p)p.ping=ping|0;}if(menuOpen)renderPlayers();});

function renderPlayers(){
  const targets={0:$('#specPlayers'),1:$('#redPlayers'),2:$('#bluePlayers')};Object.values(targets).forEach(x=>x.innerHTML='');const me=human();
  players.forEach(p=>{
    const row=document.createElement('div');row.className='player-row'+(p.id===myPlayerId?' me':'');row.draggable=!!me?.admin;row.dataset.id=p.id;
    row.innerHTML=`${p.admin?'<span class="admin-star">★</span>':'<span class="admin-star"></span>'}<span class="country-flag">🌐</span><span class="avatar-chip"></span><span class="player-name"></span><span class="player-meta"></span>`;
    row.querySelector('.avatar-chip').textContent=p.avatar||'';row.querySelector('.player-name').textContent=p.name;row.querySelector('.player-meta').textContent=p.bot?'CPU':String(p.ping??0);
    row.ondragstart=e=>e.dataTransfer.setData('text/plain',String(p.id));row.oncontextmenu=e=>{e.preventDefault();openPlayerContext(p.id,e.clientX,e.clientY);};targets[p.team]?.appendChild(row);
  });
}
$$('.team-column').forEach(col=>{col.ondragover=e=>e.preventDefault();col.ondrop=e=>{e.preventDefault();const id=+e.dataTransfer.getData('text/plain');movePlayer(id,+col.dataset.team);};});
$$('.team-switch').forEach(b=>b.onclick=()=>socket.emit('room:teamAction',{action:+b.dataset.team===1?'resetRed':'resetBlue'}));$('.spec-column .team-header').onclick=null;
function movePlayer(id,team){if(!human()?.admin)return;socket.emit('room:setTeam',{playerId:id,team},res=>{if(res&&!res.ok&&res.error)addSystem(res.error);});}
$('#addRedBot').onclick=()=>socket.emit('room:addBot',{team:1});$('#addBlueBot').onclick=()=>socket.emit('room:addBot',{team:2});
$('#autoTeams').onclick=()=>socket.emit('room:teamAction',{action:'auto'});$('#randTeams').onclick=()=>socket.emit('room:teamAction',{action:'rand'});$('#lockTeams').onclick=()=>socket.emit('room:teamAction',{action:'lock'});$('#resetTeams').onclick=()=>socket.emit('room:teamAction',{action:'reset'});

function setupLimits(){for(const el of [$('#timeLimit'),$('#scoreLimit')]){el.innerHTML='';for(let i=0;i<=10;i++)el.append(new Option(i===0?'Sin límite':i,i));}$('#timeLimit').value='3';$('#scoreLimit').value='3';}
setupLimits();
function sendLimits(){if(!human()?.admin)return;socket.emit('room:setLimits',{timeLimit:+$('#timeLimit').value,scoreLimit:+$('#scoreLimit').value});}
$('#timeLimit').onchange=sendLimits;$('#scoreLimit').onchange=sendLimits;
function selectStadiumKey(v){
  if(!human()?.admin)return false;if(gameRunning){addSystem('No se puede cambiar el estadio mientras la partida está en curso.');return false;}
  if(v==='custom'){$('#stadiumFile').click();return false;}socket.emit('room:setStadium',{key:v},res=>{if(res&&!res.ok)addSystem(res.error||'No se pudo cambiar el estadio.');});return true;
}
$('#stadiumSelect').onchange=()=>selectStadiumKey($('#stadiumSelect').value);$('#stadiumPickBtn').onclick=()=>{$('#stadiumModal').classList.remove('hidden');};$('#closeStadium').onclick=()=>$('#stadiumModal').classList.add('hidden');
$$('.stadium-choice').forEach(b=>b.onclick=()=>{const v=b.dataset.stadium;if(v==='custom'){$('#stadiumModal').classList.add('hidden');$('#stadiumFile').click();return;}if(selectStadiumKey(v))$('#stadiumModal').classList.add('hidden');});
$('#stadiumFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const obj=E.validateStadium(JSON.parse(await file.text()));socket.emit('room:setStadium',{key:'custom',stadium:obj},res=>{if(!res?.ok)addSystem(res?.error||'Mapa inválido.');});}catch(err){alert(err.message);}e.target.value='';};
/* ---------- game rules ---------- */
function startGame(){if(!human()?.admin)return;socket.emit('room:gameAction',{action:gameRunning?'stop':'start'},res=>{if(res&&!res.ok&&res.error)addSystem(res.error);});}
$('#startStop').onclick=startGame;
function togglePause(){if(!gameRunning||!human()?.admin)return;socket.emit('room:gameAction',{action:'pause'});}
function humanAction(){let dx=0,dy=0;if(keys.has('ArrowLeft'))dx--;if(keys.has('ArrowRight'))dx++;if(keys.has('ArrowUp'))dy++;if(keys.has('ArrowDown'))dy--;return [dx,dy,keys.has('x')||keys.has('X')||keys.has(' ')?1:0];}
function tick(){
  if(!room.id||!socket.connected)return;const me=human(),act=me&&(me.team===1||me.team===2)&&gameRunning&&!paused?humanAction():[0,0,0];
  if(isHost()){hostStep(act);return;}
  lastActions=new Map();if(me)lastActions.set(me.id,act);
  const key=act.join(',');inputSeq++;if(key!==lastSentInput||inputSeq%2===0){safeDcSend(hostLink?.dc,{t:'i',x:act[0],y:act[1],k:!!act[2],seq:inputSeq});lastSentInput=key;}
}
function applyPacketToWorld(pkt,refresh=true){
  if(!pkt)return;lastNetPacket=pkt;gameRunning=!!pkt.running;paused=!!pkt.paused;overtime=!!pkt.overtime;elapsedTicks=pkt.elapsedTicks||0;endingGame=!!pkt.ending;finalWinner=pkt.finalWinner||0;goalScoringTeam=pkt.goalScoringTeam||0;
  if(!world)world=new E.World(selectedStadium,players);if(!Array.isArray(pkt.discs)||pkt.discs.length!==world.discs.length){world=new E.World(selectedStadium,players);if(pkt.discs?.length!==world.discs.length){prevPhysicsSnapshot=world.snapshot();currPhysicsSnapshot=world.snapshot();lastNetSnapshotAt=performance.now();return;}}
  prevPhysicsSnapshot=currPhysicsSnapshot||world.snapshot();
  for(let i=0;i<pkt.discs.length;i++){const a=pkt.discs[i],d=world.discs[i];d.pos[0]=+a[0];d.pos[1]=+a[1];d.vel[0]=+a[2];d.vel[1]=+a[3];if(a[4]!=null)d.radius=+a[4];}
  world.redScore=pkt.redScore|0;world.blueScore=pkt.blueScore|0;world.state=pkt.state;world.kickingTeam=pkt.kickingTeam;world.goalTimer=pkt.goalTimer|0;world.steps=pkt.tick|0;if(Array.isArray(pkt.kickFlags))world.kickFlag=pkt.kickFlags.slice();
  currPhysicsSnapshot=world.snapshot();for(let k=0;k<world.nPlayers;k++)currPhysicsSnapshot[world.firstPlayer+k].kick=!!world.kickFlag[k];lastNetSnapshotAt=performance.now();
  if(replayRecording&&pkt.tick%2===0)replayFrames.push({t:pkt.tick,score:[world.redScore,world.blueScore],state:world.state,discs:currPhysicsSnapshot.map(d=>[d.x,d.y,d.vx,d.vy])});
  if(refresh){syncGameViewState();updateHud();}
}
// Los snapshots de partida llegan por el DataChannel WebRTC del host, no por Socket.IO.
/* ---------- chat ---------- */
function clearChat(){$('#chatLog').innerHTML='';}
function addChat(text,type='system',name=''){const d=document.createElement('div');d.className='chat-msg '+type;if(name){const n=document.createElement('span');n.className='chat-name';n.textContent=name+': ';d.appendChild(n);}d.appendChild(document.createTextNode(text));$('#chatLog').appendChild(d);$('#chatLog').scrollTop=$('#chatLog').scrollHeight;}
function addSystem(t){addChat(t,'system');}
function focusChat(){$('#chatPanel').classList.remove('chat-hidden');$('#chatPanel').classList.add('focused');$('#chatInput').focus();}
function blurChat(){$('#chatInput').blur();$('#chatPanel').classList.remove('focused');if(!settings.showChat)$('#chatPanel').classList.add('chat-hidden');}
function submitChat(){const inp=$('#chatInput'),txt=inp.value.trim();inp.value='';if(txt){if(txt.startsWith('/')||txt.startsWith('!'))runCommand(txt);else socket.emit('chat:send',{text:txt});}blurChat();}
$('#chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();submitChat();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();$('#chatInput').value='';blurChat();}else if(e.key==='Tab'){e.preventDefault();e.stopPropagation();blurChat();}});
function showHelp(){addSystem('Comandos disponibles:');addSystem('/avatar <texto> — cambia el avatar (máximo 2 caracteres).');addSystem('/clear_avatar — vuelve a mostrar el número del jugador.');addSystem('/extrapolation <ms> — predicción visual del cliente (0 a 1000 ms).');addSystem('/set_password <clave> — establece contraseña de sala (admin).');addSystem('/clear_password — quita la contraseña de sala (admin).');addSystem('/clear_bans — limpia baneos (admin).');addSystem('/partido — muestra camisetas; /partido <nombre> las aplica.');}
function showPartidos(){addSystem('Partidos disponibles:');for(const [id,p] of Object.entries(PARTIDOS))addSystem(`${id} — ${p.name}`);addSystem('normal — restaura Rojo/Azul.');addSystem('Usá /partido <nombre>.');}
function runCommand(raw){
  const prefix=raw[0],body=raw.slice(1).trim(),[cmdRaw,...rest]=body.split(/\s+/),arg=rest.join(' '),me=human(),cmd=(cmdRaw||'').toLowerCase();
  if(prefix==='!'){if(cmd==='help'){showHelp();return;}addSystem(`Comando desconocido: !${cmd}. Escribí !help.`);return;}
  switch(cmd){
    case 'avatar':settings.avatar=arg.slice(0,2);saveSettings();socket.emit('profile:update',{name:settings.nick,avatar:settings.avatar});syncSettingsFields();break;
    case 'clear_avatar':settings.avatar='';saveSettings();socket.emit('profile:update',{name:settings.nick,avatar:''});syncSettingsFields();break;
    case 'extrapolation':settings.extrapolation=clamp(parseInt(rest[0],10)||0,0,1000);settings.extrapolationTouched=true;saveSettings();addSystem(`Extrapolation: ${settings.extrapolation} ms.`);syncSettingsFields();break;
    case 'set_password':if(!me?.admin){addSystem('Solo un admin puede cambiar la contraseña.');break;}socket.emit('room:setPassword',{password:arg});break;
    case 'clear_password':if(!me?.admin){addSystem('Solo un admin puede cambiar la contraseña.');break;}socket.emit('room:setPassword',{password:''});break;
    case 'clear_bans':if(!me?.admin){addSystem('Solo un admin puede limpiar los baneos.');break;}socket.emit('room:clearBans');break;
    case 'partido':{if(!me?.admin){addSystem('Solo un admin puede cambiar las camisetas.');break;}const id=(rest[0]||'').toLowerCase();if(!id){showPartidos();break;}socket.emit('room:partido',{id},res=>{if(!res?.ok)addSystem(res?.error||'No se pudo cambiar la camiseta.');});break;}
    default:addSystem(`Comando desconocido: /${cmd}. Escribí !help.`);
  }
}
function syncWorldPlayerMeta(){}

/* chat resizing */
$('#chatResize').addEventListener('pointerdown',e=>{chatDrag={y:e.clientY,h:$('#chatPanel').getBoundingClientRect().height};$('#chatResize').setPointerCapture(e.pointerId);e.preventDefault();});
$('#chatResize').addEventListener('pointermove',e=>{if(!chatDrag)return;const h=clamp(chatDrag.h+(chatDrag.y-e.clientY),90,430);$('#chatPanel').style.height=h+'px';});
$('#chatResize').addEventListener('pointerup',e=>{chatDrag=null;try{$('#chatResize').releasePointerCapture(e.pointerId)}catch{}});

/* ---------- keyboard ---------- */
window.addEventListener('keydown',e=>{
  if($('#stadiumModal').classList.contains('hidden')===false){if(e.key==='Escape'){e.preventDefault();$('#stadiumModal').classList.add('hidden');}return;}
  if($('#settingsModal').classList.contains('hidden')===false){if(e.key==='Escape'){e.preventDefault();closeSettings();}return;}
  if(document.activeElement===$('#chatInput'))return;
  if(document.activeElement&&['INPUT','SELECT'].includes(document.activeElement.tagName))return;
  if(e.key==='Enter'||e.key==='Tab'){if(!$('#gameView').classList.contains('hidden')){e.preventDefault();focusChat();}return;}
  if(e.key==='Escape'&&!$('#gameView').classList.contains('hidden')){e.preventDefault();setRoomMenu(!menuOpen);return;}
  if(e.key==='p'||e.key==='P'){togglePause();return;}
  if(['1','2','3','4','0'].includes(e.key)&&!menuOpen){const map={'1':'1','2':'1.25','3':'1.5','4':'1.75','0':'fit'};settings.view=map[e.key];saveSettings();syncSettingsFields();return;}
  if(menuOpen)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','x','X'].includes(e.key)){e.preventDefault();keys.add(e.key);}
});
window.addEventListener('keyup',e=>keys.delete(e.key));window.addEventListener('blur',()=>keys.clear());


/* ---------- room/game presentation state ---------- */
function syncGameViewState(){
  const gv=$('#gameView');if(!gv)return;
  const visuallyPlaying=gameRunning||endingGame;
  gv.classList.toggle('room-idle',!visuallyPlaying);
  gv.classList.toggle('room-playing',visuallyPlaying);
  if(!visuallyPlaying){$('#roomMenu').classList.remove('closed');menuOpen=true;}
  updateGameAnnouncement();
}

/* ---------- admin player context menu ---------- */
function hidePlayerContext(){const m=$('#playerContext');if(m)m.classList.add('hidden');contextPlayerId=null;}
function openPlayerContext(id,x,y){const me=human(),p=players.find(q=>q.id===id),m=$('#playerContext');if(!me?.admin||!p||!m)return hidePlayerContext();contextPlayerId=id;$('#ctxPlayerName').textContent=p.name;const adminBtn=m.querySelector('[data-action="admin"]');adminBtn.textContent=p.admin?'Quitar admin':'Dar admin';adminBtn.disabled=p.id===me.id;m.querySelector('[data-action="kick"]').disabled=p.id===me.id;m.querySelector('[data-action="ban"]').disabled=p.id===me.id;m.querySelector('[data-action="red"]').disabled=p.team===1;m.querySelector('[data-action="spec"]').disabled=p.team===0;m.querySelector('[data-action="blue"]').disabled=p.team===2;m.classList.remove('hidden');const pad=6,w=m.offsetWidth||188,h=m.offsetHeight||220;m.style.left=Math.min(x,innerWidth-w-pad)+'px';m.style.top=Math.min(y,innerHeight-h-pad)+'px';}
$('#playerContext').addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b||b.disabled)return;const p=players.find(q=>q.id===contextPlayerId),me=human();if(!p||!me?.admin)return hidePlayerContext();const a=b.dataset.action;if(a==='red'||a==='spec'||a==='blue')movePlayer(p.id,a==='red'?1:a==='blue'?2:0);else socket.emit('room:adminAction',{playerId:p.id,action:a});hidePlayerContext();});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#playerContext')&&!e.target.closest('.player-row'))hidePlayerContext();});window.addEventListener('resize',hidePlayerContext);
/* ---------- settings ---------- */
$('#settingsBtn').onclick=openSettings;
function openSettings(){syncSettingsFields();$('#settingsModal').classList.remove('hidden');}
function closeSettings(){$('#settingsModal').classList.add('hidden');}
$('#closeSettings').onclick=closeSettings;
$$('.settings-tab').forEach(t=>t.onclick=()=>{$$('.settings-tab').forEach(x=>x.classList.toggle('active',x===t));$$('.settings-page').forEach(p=>p.classList.toggle('hidden',p.dataset.page!==t.dataset.tab));});
function syncSettingsFields(){
  $('#setNick').value=settings.nick;$('#setAvatar').value=settings.avatar;$('#setExtrap').value=settings.extrapolation;$('#setShowChat').checked=settings.showChat;$('#setShowNames').checked=settings.showNames;$('#setSound').checked=settings.sound;$('#setLowLatency').checked=settings.lowLatency!==false;$('#setView').value=settings.view;$('#setFps').value=String(settings.fps);$('#setChatOpacity').value=settings.chatOpacity;$('#setChatWidth').value=settings.chatWidth||'compact';$('#setChatHeight').value=settings.chatHeight;$('#volumeSlider').value=settings.volume;
}
function applySettingsToUI(){
  document.documentElement.style.setProperty('--chat-opacity',String(settings.chatOpacity/100));document.documentElement.style.setProperty('--chat-focus-height',settings.chatHeight+'px');
  $('#chatPanel').classList.toggle('chat-width-full',(settings.chatWidth||'compact')==='full');
  $('#chatPanel').classList.toggle('chat-hidden', !settings.showChat && document.activeElement !== $('#chatInput')); $('#volumeSlider').value=settings.volume;
}
$('#saveSettings').onclick=()=>{
  const previousLowLatency=settings.lowLatency!==false,previousExtrapolation=settings.extrapolation;
  settings.nick=$('#setNick').value.trim()||'Jugador';settings.avatar=$('#setAvatar').value.slice(0,2);settings.extrapolation=clamp(parseInt($('#setExtrap').value,10)||0,0,1000);if(settings.extrapolation!==previousExtrapolation)settings.extrapolationTouched=true;settings.showChat=$('#setShowChat').checked;settings.showNames=$('#setShowNames').checked;settings.sound=$('#setSound').checked;settings.lowLatency=$('#setLowLatency').checked;settings.view=$('#setView').value;settings.fps=$('#setFps').value;settings.chatOpacity=clamp(+$('#setChatOpacity').value,20,95);settings.chatWidth=$('#setChatWidth').value;settings.chatHeight=clamp(+$('#setChatHeight').value,140,420);settings.volume=+$('#volumeSlider').value;
  $('#nickInput').value=settings.nick;saveSettings();if(room.id)socket.emit('profile:update',{name:settings.nick,avatar:settings.avatar});if(previousLowLatency!==(settings.lowLatency!==false))recreateCanvas();applySettingsToUI();closeSettings();
};
$('#volumeSlider').oninput=e=>{settings.volume=+e.target.value;saveSettings();};

/* ---------- replay/link ---------- */
$('#recBtn').onclick=()=>{
  replayRecording=!replayRecording;$('#recBtn').textContent=replayRecording?'■ Detener':'● Grabar';$('#recBtn').classList.toggle('active',replayRecording);
  if(replayRecording){replayFrames=[];addSystem('Grabación iniciada.');}
  else{addSystem('Grabación detenida.');downloadReplay();}
};
function downloadReplay(){if(!replayFrames.length)return;const data={format:'HB-LOCAL-REPLAY-1',room:room.name,stadium:selectedStadium.name||'Custom',players:players.map(p=>({id:p.id,name:p.name,team:p.team,bot:p.bot})),frames:replayFrames};const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='hb-local-replay.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
$('#linkBtn').onclick=async()=>{if(!room.id)return;const u=new URL(location.href);u.searchParams.set('room',room.id);try{await navigator.clipboard.writeText(u.toString());addSystem('Enlace de la sala copiado.');}catch{prompt('Copiá el enlace de la sala:',u.toString());}};
function flashButton(btn,text){const old=btn.textContent;btn.textContent=text;setTimeout(()=>btn.textContent=old,600);}

/* ---------- render ---------- */
function recreateCanvas(){
  const old=canvas,next=old.cloneNode(false);old.replaceWith(next);canvas=next;ctx=canvas.getContext('2d',{alpha:false,desynchronized:settings.lowLatency!==false});resizeCanvas();
}
function resizeCanvas(){const dpr=Math.min(2,window.devicePixelRatio||1),w=innerWidth,h=innerHeight;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0);canvas._cw=w;canvas._ch=h;}
window.addEventListener('resize',()=>{resizeCanvas();render();});resizeCanvas();
function blendSnapshots(a,b,t){
  if(!a||!b||a.length!==b.length)return b||a||[];
  const q=clamp(t,0,1),out=new Array(b.length);
  for(let i=0;i<b.length;i++){
    const x=Object.assign({},b[i]);
    x.x=a[i].x+(b[i].x-a[i].x)*q;x.y=a[i].y+(b[i].y-a[i].y)*q;
    x.vx=a[i].vx+(b[i].vx-a[i].vx)*q;x.vy=a[i].vy+(b[i].vy-a[i].vy)*q;
    out[i]=x;
  }
  return out;
}
function currentSnapshot(){
  if(!world)return [];if(!gameRunning||paused||endingGame)return currPhysicsSnapshot||world.snapshot();
  const extra=Number(settings.extrapolation)||0;
  if(isHost())return world.predictedSnapshot(clamp(accumulator*1000,0,17)+extra,lastActions);
  const age=clamp(performance.now()-lastNetSnapshotAt,0,80);return world.predictedSnapshot(age+extra,lastActions);
}
// Camera presentation state. Physics remain at 60 Hz; this only affects how the
// viewport follows the local player/ball. Large stadiums need a stable camera:
// the player is the primary anchor and the ball only adds a soft, delayed lead.
const visualCamera={x:0,y:0,ballX:0,ballY:0,ready:false,ballReady:false,lastTime:0,key:''};
function resetVisualCamera(){visualCamera.ready=false;visualCamera.ballReady=false;visualCamera.lastTime=0;visualCamera.key='';}
function camera(st,snap){
  const cw=canvas._cw||innerWidth,ch=canvas._ch||innerHeight,w=st.width||420,h=st.height||200;
  const fit=Math.min((cw-28)/(w*2),(ch-38)/(h*2));
  let scale=settings.view==='fit'?fit:(parseFloat(settings.view)||1);
  // Official .hbs: maxViewWidth prevents ultra-wide displays from seeing more world
  // width than the stadium author intended. 0 means disabled.
  const maxViewWidth=Number(st.maxViewWidth)||0;if(maxViewWidth>0)scale=Math.max(scale,cw/maxViewWidth);
  if(settings.view==='fit'){resetVisualCamera();return {scale,cx:cw/2,cy:ch/2};}

  const ball=snap?.[0],me=human(),i=me&&world?.playerIndexById.get(me.id),pd=(i!=null?snap?.[i]:null);
  const halfW=cw/(2*scale),halfH=ch/(2*scale);
  const movingX=halfW<w,movingY=halfH<h;
  const key=`${st.name||''}|${settings.view}|${me?.id||0}|${cw}x${ch}`;
  const now=performance.now();
  const sameCamera=visualCamera.ready&&visualCamera.key===key&&gameRunning&&!paused;
  const dt=sameCamera?Math.min(.05,Math.max(0,(now-visualCamera.lastTime)/1000)):0;

  let target=[0,0];
  if(pd){
    if((st.cameraFollow||'ball')==='player'||!ball){
      target=[pd.x,pd.y];
      visualCamera.ballReady=false;
    }else{
      // Do NOT chase every instantaneous ball bounce. Smooth a separate camera-only
      // ball focus, keep a dead-zone around the player, and use only the excess as
      // a small lead. This keeps the viewport HaxBall-like instead of making the
      // whole stadium jerk whenever the ball changes direction.
      if(!sameCamera||!visualCamera.ballReady){
        visualCamera.ballX=ball.x;visualCamera.ballY=ball.y;visualCamera.ballReady=true;
      }else{
        const ballK=1-Math.exp(-dt*6.4); // ~156 ms: softer ball-follow without feeling detached
        visualCamera.ballX+=(ball.x-visualCamera.ballX)*ballK;
        visualCamera.ballY+=(ball.y-visualCamera.ballY)*ballK;
      }
      const rx=visualCamera.ballX-pd.x,ry=visualCamera.ballY-pd.y;
      const deadX=Math.min(130,halfW*.215),deadY=Math.min(100,halfH*.215);
      const excessX=Math.sign(rx)*Math.max(0,Math.abs(rx)-deadX);
      const excessY=Math.sign(ry)*Math.max(0,Math.abs(ry)-deadY);
      const leadX=clamp(excessX*.22,-halfW*.20,halfW*.20);
      const leadY=clamp(excessY*.22,-halfH*.20,halfH*.20);
      target=[pd.x+leadX,pd.y+leadY];
    }
  }else if(ball){
    target=[ball.x,ball.y];
  }

  target[0]=halfW>=w?0:clamp(target[0],-w+halfW,w-halfW);
  target[1]=halfH>=h?0:clamp(target[1],-h+halfH,h-halfH);

  if(!sameCamera){
    visualCamera.x=target[0];visualCamera.y=target[1];visualCamera.ready=true;visualCamera.key=key;visualCamera.lastTime=now;
  }else{
    visualCamera.lastTime=now;
    const dx=target[0]-visualCamera.x,dy=target[1]-visualCamera.y;
    const snapDist=Math.max(140,Math.min(halfW,halfH)*.62);
    if(dx*dx+dy*dy>snapDist*snapDist){
      // Kickoff/teleport/respawn: reposition immediately, otherwise the camera would
      // spend several frames crossing the stadium.
      visualCamera.x=target[0];visualCamera.y=target[1];
    }else{
      // Slightly slower than V12. The local player remains responsive because it is
      // already frame-interpolated; this filter mainly removes camera micro-jitter.
      const k=1-Math.exp(-dt*21);
      if(movingX)visualCamera.x+=dx*k;else visualCamera.x=target[0];
      if(movingY)visualCamera.y+=dy*k;else visualCamera.y=target[1];
    }
  }
  return {scale,cx:cw/2-visualCamera.x*scale,cy:ch/2+visualCamera.y*scale};
}
function roundedRectPath(ctx,x,y,w,h,r){
  r=Math.max(0,Math.min(r,Math.abs(w)/2,Math.abs(h)/2));ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
// Pre-render each stadium floor once into an offscreen canvas. This preserves the
// exact V8 world alignment but reduces x5/x7 from hundreds of tile draw calls per
// frame to one drawImage. Unlike CanvasPattern, this is safe when opening index.html
// directly from file:// and when the main game canvas gets recreated.
const stadiumFloorCache=new Map();
function getStadiumFloor(img,type,bg){
  if(!img||!img.complete||!img.naturalWidth)return null;
  const worldW=Number(bg.width)*2,worldH=Number(bg.height)*2;
  if(!(worldW>0&&worldH>0))return null;
  const key=`${type}|${worldW}|${worldH}|${img.src}`;
  let cached=stadiumFloorCache.get(key);if(cached)return cached;
  const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(worldW));c.height=Math.max(1,Math.ceil(worldH));
  const g=c.getContext('2d');if(!g)return null;
  const tileWorld=128,left=-Number(bg.width),top=-Number(bg.height),right=Number(bg.width),bottom=Number(bg.height);
  const ix0=Math.floor(left/tileWorld)*tileWorld,iy0=Math.floor(top/tileWorld)*tileWorld;
  for(let wy=iy0;wy<bottom;wy+=tileWorld){
    for(let wx=ix0;wx<right;wx+=tileWorld){
      g.drawImage(img,wx-left,wy-top,tileWorld,tileWorld);
    }
  }
  cached={canvas:c,worldW,worldH};stadiumFloorCache.set(key,cached);return cached;
}
function drawWorldTiles(ctx,img,bg,cam,sx,sy){
  const floor=getStadiumFloor(img,bg.type||'none',bg);if(!floor)return;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  // Align only the texture to physical pixels. Stadium geometry and players keep the
  // smooth sub-pixel camera, while the repeating grass/hockey texture no longer
  // shimmers as the camera pans. The max correction is < 0.5 physical pixel.
  const rawX=sx(-bg.width),rawY=sy(-bg.height),x=Math.round(rawX*dpr)/dpr,y=Math.round(rawY*dpr)/dpr;
  const w=bg.width*2*cam.scale,h=bg.height*2*cam.scale,oldSmooth=ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled=false;ctx.drawImage(floor.canvas,0,0,floor.worldW,floor.worldH,x,y,w,h);ctx.imageSmoothingEnabled=oldSmooth;
}
function renderBackground(ctx,sx,sy,bg,cam,cw,ch){
  const type=bg.type||'none';
  if(type==='none'){
    ctx.fillStyle=colorToCss(bg.color,'#718c5a');ctx.fillRect(0,0,cw,ch);return;
  }
  const isHockey=type==='hockey',base=isHockey?'rgb(85,85,85)':'rgb(113,140,90)',border=isHockey?'rgb(233,204,110)':'rgb(199,230,189)';
  ctx.fillStyle=isHockey?'#202425':'#5f754d';ctx.fillRect(0,0,cw,ch);
  const x=sx(-bg.width),y=sy(-bg.height),w=bg.width*2*cam.scale,h=bg.height*2*cam.scale,r=(bg.cornerRadius||0)*cam.scale;
  ctx.save();roundedRectPath(ctx,x,y,w,h,r);ctx.clip();ctx.fillStyle=colorToCss(bg.color,base);ctx.fillRect(x,y,w,h);drawWorldTiles(ctx,stadiumTiles[type],bg,cam,sx,sy);ctx.restore();
  ctx.strokeStyle=border;ctx.lineWidth=Math.max(1,2*cam.scale);roundedRectPath(ctx,x,y,w,h,r);ctx.stroke();
  ctx.beginPath();ctx.moveTo(sx(0),sy(-bg.height));ctx.lineTo(sx(0),sy(bg.height));ctx.stroke();
  if((bg.kickOffRadius||0)>0){ctx.beginPath();ctx.arc(sx(0),sy(0),bg.kickOffRadius*cam.scale,0,Math.PI*2);ctx.stroke();}
  if(isHockey&&(bg.goalLine||0)>0){
    const gl=bg.goalLine;ctx.save();ctx.lineWidth=Math.max(1,2*cam.scale);ctx.strokeStyle='#d75c5c';ctx.beginPath();ctx.moveTo(sx(-gl),sy(-bg.height));ctx.lineTo(sx(-gl),sy(bg.height));ctx.stroke();ctx.strokeStyle='#5978d8';ctx.beginPath();ctx.moveTo(sx(gl),sy(-bg.height));ctx.lineTo(sx(gl),sy(bg.height));ctx.stroke();ctx.restore();
  }
}
function render(){
  const cw=canvas._cw||innerWidth,ch=canvas._ch||innerHeight;ctx.setTransform(window.devicePixelRatio?Math.min(2,window.devicePixelRatio):1,0,0,window.devicePixelRatio?Math.min(2,window.devicePixelRatio):1,0,0);
  const st=selectedStadium||E.CLASSIC,snap=currentSnapshot(),cam=camera(st,snap),sx=x=>cam.cx+x*cam.scale,sy=y=>cam.cy-y*cam.scale,syRaw=y=>cam.cy+y*cam.scale,bg=st.bg||{type:'grass',width:(st.width||420)-50,height:(st.height||200)-30,kickOffRadius:75};
  // Stadium physics are mirrored to a Cartesian y-up engine. Mirror them back for
  // display; BackgroundObject itself remains in raw HaxBall y-down coordinates.
  renderBackground(ctx,sx,syRaw,bg,cam,cw,ch);
  if(world){
    // Every visible segment keeps its .hbs color. Curves use the exact precomputed geometry.
    ctx.lineWidth=Math.max(1,1.1*cam.scale);ctx.lineCap='butt';
    for(const sg of world.segments){
      if(!sg.vis)continue;ctx.strokeStyle=colorToCss(sg.color,'#000000');ctx.beginPath();
      if(sg.curve===0){ctx.moveTo(sx(sg.v0[0]),sy(sg.v0[1]));ctx.lineTo(sx(sg.v1[0]),sy(sg.v1[1]));}
      else{
        // Render in raw .hbs screen orientation. curveDeg is derived from curveF
        // when present, so exported precision-preserving arcs draw the same path.
        const rcx=sg.center[0],rcy=-sg.center[1],rv0=sg.rawV0||[sg.v0[0],-sg.v0[1]];
        const a0=Math.atan2(rv0[1]-rcy,rv0[0]-rcx),sweep=(sg.curveDeg||0)*Math.PI/180;
        ctx.arc(sx(rcx),syRaw(rcy),sg.arcRadius*cam.scale,a0,a0+sweep,sweep<0);
      }
      ctx.stroke();
    }
    // Static map discs/posts retain their stadium colors.
    for(let i=1;i<world.firstPlayer;i++)drawDisc(snap[i],colorToCss(snap[i].color,'#dddddd'),cam,sx,sy,false,'');
    // Custom maps often change ball radius/mass/color (these futsal maps use a yellow ball).
    drawDisc(snap[0],colorToCss(snap[0]?.color,'#f5f5f5'),cam,sx,sy,false,'');
    for(let i=world.firstPlayer;i<snap.length;i++){
      const d=snap[i],p=players.find(x=>x.id===d.playerId);if(!p)continue;
      const k=world.kickFlag[i-world.firstPlayer]||d.kick;if(k)drawKickEffect(d,snap[0],cam,sx,sy);
      drawPlayerDisc(d,teamKits[d.team]||DEFAULT_TEAM_KITS[d.team]||DEFAULT_TEAM_KITS[1],cam,sx,sy,p.avatar||String(p.id));
      if(settings.showNames){const fs=clamp(11*cam.scale,10,15);ctx.font=`${fs}px Arial`;ctx.textAlign='center';ctx.textBaseline='top';ctx.lineWidth=3;ctx.strokeStyle='rgba(0,0,0,.72)';ctx.fillStyle='#fff';const yy=sy(d.y-d.r)+4;ctx.strokeText(p.name,sx(d.x),yy);ctx.fillText(p.name,sx(d.x),yy);}
    }
  }
}
function drawKickEffect(d,ball,cam,sx,sy){
  if(!ball)return;
  const x=sx(d.x),y=sy(d.y),bx=sx(ball.x),by=sy(ball.y),a=Math.atan2(by-y,bx-x);
  ctx.save();ctx.strokeStyle='rgba(238,238,238,.72)';ctx.lineCap='round';
  for(let q=0;q<3;q++){ctx.beginPath();ctx.lineWidth=Math.max(1,1.05*cam.scale);ctx.arc(x,y,(d.r+3+q*3)*cam.scale,a-.46,a+.46);ctx.stroke();}
  ctx.restore();
}
function drawPlayerDisc(d,kit,cam,sx,sy,label){
  if(!d)return;kit=cloneKit(kit);const r=d.r*cam.scale,x=sx(d.x),y=sy(d.y),colors=kit.colors.map(c=>'#'+c);
  ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
  ctx.translate(x,y);ctx.rotate((kit.angle||0)*Math.PI/180);
  // HaxBall angle 0 = vertical stripes. Draw an oversized stripe field so rotation
  // cannot expose empty corners inside the clipped player disc.
  const span=r*4,n=Math.max(1,colors.length),stripe=span/n;
  for(let i=0;i<n;i++){ctx.fillStyle=colors[i];ctx.fillRect(-span/2+i*stripe,-span/2,stripe+.7,span);}
  ctx.restore();
  ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.lineWidth=Math.max(1.35,1.4*cam.scale);ctx.strokeStyle='#242424';ctx.stroke();
  if(label){const avatarSize=clamp((label.length>1?9.4:10.7)*cam.scale,11,18);ctx.fillStyle='#'+cleanHex(kit.textColor);ctx.font=`bold ${avatarSize}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='#000';ctx.shadowBlur=.7;ctx.fillText(label,x,y+.5);ctx.shadowBlur=0;}ctx.restore();
}
function drawDisc(d,color,cam,sx,sy,player,label){
  if(!d)return;const r=d.r*cam.scale,x=sx(d.x),y=sy(d.y);ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
  ctx.lineWidth=Math.max(1.35,1.4*cam.scale);ctx.strokeStyle='#242424';ctx.stroke();
  if(player&&label){const avatarSize=clamp((label.length>1?9.4:10.7)*cam.scale,11,18);ctx.fillStyle='#fff';ctx.font=`bold ${avatarSize}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='#000';ctx.shadowBlur=.7;ctx.fillText(label,x,y+.5);ctx.shadowBlur=0;}ctx.restore();
}
function updateGameAnnouncement(){
  const box=$('#gameAnnouncement'),txt=$('#gameAnnouncementText');if(!box||!txt)return;
  let text='',kind='';
  if(endingGame&&finalWinner){text=finalWinner===1?'¡Rojo gana!':'¡Azul gana!';kind=finalWinner===1?'victory-red':'victory-blue';}
  else if(paused&&gameRunning){text='Juego pausado';kind='paused';}
  else if(gameRunning&&world?.state===E.STATE_GOAL&&goalScoringTeam){text=goalScoringTeam===1?'Rojo\nanota!':'Azul\nanota!';kind=goalScoringTeam===1?'goal-red':'goal-blue';}
  box.className='game-announcement'+(text?' '+kind:' hidden');txt.textContent=text;
  canvas?.classList.toggle('paused-visual',paused&&gameRunning);$('#gameView')?.classList.toggle('game-paused',paused&&gameRunning);
}
function updateHud(){
  $('#redScore').textContent=world?world.redScore:0;$('#blueScore').textContent=world?world.blueScore:0;$('#clockText').textContent=formatTime(elapsedTicks);$('#overtimeText').classList.toggle('hidden',!overtime||menuOpen);
  let hint='';if(gameRunning&&world){if(paused)hint='Partida pausada';else if(world.state===E.STATE_KICKOFF)hint=`Saca ${world.kickingTeam===F.RED?'Rojo':'Azul'}`;else if(world.state===E.STATE_GOAL)hint='¡Gol!';}
  $('#kickHint').textContent=hint||'¡Presioná X para patear!';$('#pingHud').textContent=`Ping: ${myPing}`;updateGameAnnouncement();
}
function loop(now){
  const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;accumulator+=dt;while(accumulator>=1/60){tick();accumulator-=1/60;}
  const target=+settings.fps;if(target===0||now-lastRender>=1000/target-1){render();lastRender=now;}requestAnimationFrame(loop);
}

applySettingsToUI();syncSettingsFields();renderRoomList();syncGameViewState();updateHud();requestAnimationFrame(loop);
})();
