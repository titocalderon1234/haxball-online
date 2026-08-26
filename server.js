'use strict';
const path=require('path');
const http=require('http');
const os=require('os');
const express=require('express');
const {Server}=require('socket.io');
const E=require('./public/engine.js');
const BUILTINS=require('./public/stadiums.js');

const PORT=Number(process.env.PORT)||3000;
const app=express();
const server=http.createServer(app);
const io=new Server(server,{
  transports:['websocket','polling'],
  maxHttpBufferSize:512*1024,
  pingInterval:10000,
  pingTimeout:10000
});
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));

function splitEnvUrls(v){return String(v||'').split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);}
function buildRtcConfig(){
  const iceServers=[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}];
  const turnUrls=splitEnvUrls(process.env.TURN_URLS||process.env.TURN_URL||'');
  if(turnUrls.length){
    const turn={urls:turnUrls},username=String(process.env.TURN_USERNAME||''),credential=String(process.env.TURN_CREDENTIAL||'');
    if(username)turn.username=username;if(credential)turn.credential=credential;iceServers.push(turn);
  }
  return {iceServers,iceCandidatePoolSize:4,iceTransportPolicy:String(process.env.TURN_FORCE_RELAY||'').toLowerCase()==='true'?'relay':'all',turnConfigured:turnUrls.length>0};
}

const rooms=new Map();
let nextRoomSeq=1;
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

function cleanText(v,max=40){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max);}
function cleanNick(v){return cleanText(v,25)||'Jugador';}
function cleanAvatar(v){const s=String(v??'').replace(/[\r\n\t]/g,'');try{if(typeof Intl!=='undefined'&&Intl.Segmenter){const seg=new Intl.Segmenter(undefined,{granularity:'grapheme'});return [...seg.segment(s)].slice(0,2).map(x=>x.segment).join('');}}catch{}return Array.from(s).slice(0,2).join('');}
function cleanCountry(v){const c=String(v??'').trim().toUpperCase();return /^[A-Z]{2}$/.test(c)?c:'XX';}
function cleanAvatarImage(v){const s=String(v??'');if(!s)return '';if(s.length>30000)return '';return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s)?s:'';}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function clone(v){return JSON.parse(JSON.stringify(v));}
function roomChannel(id){return `room:${id}`;}
function makeId(){return `${Date.now().toString(36)}-${(nextRoomSeq++).toString(36)}-${Math.random().toString(36).slice(2,7)}`;}
function stadiumFor(room){
  if(room.stadiumKey==='small')return E.SMALL;
  if(room.stadiumKey==='big')return E.BIG;
  if(room.stadiumKey==='custom'&&room.customStadium)return room.customStadium;
  if(BUILTINS[room.stadiumKey])return BUILTINS[room.stadiumKey];
  return E.CLASSIC;
}
function publicRooms(){return [...rooms.values()].filter(r=>!r.unlisted).map(r=>{const owner=r.players.find(p=>p.id===r.ownerPlayerId);return {id:r.id,name:r.name,maxPlayers:r.maxPlayers,players:r.players.length,password:!!r.password,unlisted:false,distance:'P2P',running:r.gameRunning,country:owner?.country||'XX'};});}
function broadcastRooms(){io.emit('rooms:list',publicRooms());}
function serializePlayer(p){return {id:p.id,peerId:p.socketId||null,name:p.name,avatar:p.avatar,avatarImage:p.avatarImage||'',country:p.country||'XX',team:p.team,admin:!!p.admin,bot:!!p.bot,ping:p.ping|0};}
function serializeRoom(room){return {
  id:room.id,name:room.name,maxPlayers:room.maxPlayers,unlisted:room.unlisted,hasPassword:!!room.password,
  ownerPlayerId:room.ownerPlayerId,hostPeerId:room.hostSocketId||room.ownerSocketId,players:room.players.map(serializePlayer),teamsLocked:room.teamsLocked,
  stadiumKey:room.stadiumKey,stadium:clone(stadiumFor(room)),timeLimit:room.timeLimit,scoreLimit:room.scoreLimit,teamKits:clone(room.teamKits),
  game:{running:room.gameRunning,paused:room.paused,overtime:room.overtime,elapsedTicks:room.elapsedTicks,redScore:room.redScore|0,blueScore:room.blueScore|0,ending:room.endingGame,finalWinner:room.finalWinner}
};}
function broadcastRoomState(room){io.to(roomChannel(room.id)).emit('room:state',serializeRoom(room));broadcastRooms();}
function emitSystem(room,text){io.to(roomChannel(room.id)).emit('chat:message',{type:'system',text:String(text),ts:Date.now()});}
function emitMatchChat(room,text){io.to(roomChannel(room.id)).emit('chat:message',{type:'goal',text:String(text),ts:Date.now()});}
function getRoom(socket){return rooms.get(socket.data.roomId)||null;}
function getActor(socket,room){return room?.players.find(p=>p.id===socket.data.playerId)||null;}
function requireAdmin(socket,room){const p=getActor(socket,room);return p&&p.admin?p:null;}
function playerSocket(room,p){return p?.socketId?io.sockets.sockets.get(p.socketId):null;}
function isSocketInRoom(target,room){return !!target&&target.data.roomId===room.id;}

function createPlayer(room,socket,nick,avatar,admin=false,bot=false,country='XX',avatarImage=''){
  const p={id:room.nextPlayerId++,socketId:bot?null:socket.id,name:cleanNick(nick),avatar:cleanAvatar(avatar),avatarImage:cleanAvatarImage(avatarImage),country:cleanCountry(country),team:0,admin:!!admin,bot:!!bot,ping:0,visible:true};
  room.players.push(p);return p;
}
function newRoom(socket,data){
  const id=makeId();
  const room={
    id,name:cleanText(data?.name,40)||'Sala',maxPlayers:clamp(Number(data?.maxPlayers)||8,2,22),password:cleanText(data?.password,30),unlisted:!!data?.unlisted,
    ownerSocketId:socket.id,hostSocketId:socket.id,ownerPlayerId:null,nextPlayerId:1,players:[],bannedNames:new Set(),teamsLocked:false,
    stadiumKey:'classic',customStadium:null,timeLimit:3,scoreLimit:3,teamKits:clone(DEFAULT_TEAM_KITS),
    gameRunning:false,paused:false,overtime:false,elapsedTicks:0,redScore:0,blueScore:0,endingGame:false,finalWinner:0,endTimer:null,hostLastSeenAt:Date.now()
  };
  const owner=createPlayer(room,socket,data?.nick,data?.avatar,true,false,data?.country,data?.avatarImage);room.ownerPlayerId=owner.id;rooms.set(id,room);
  socket.join(roomChannel(id));socket.data.roomId=id;socket.data.playerId=owner.id;return room;
}
function movePlayer(room,p,team){
  team=Number(team);if(![0,1,2].includes(team)||p.team===team)return;p.team=team;
  room.players=room.players.filter(x=>x.id!==p.id);room.players.push(p);
}
function secureRandomIndex(max){try{const b=require('crypto').randomBytes(4).readUInt32LE(0);return b%max;}catch{return Math.floor(Math.random()*max);}}
function autoTeams(room,randomMode){
  const specs=room.players.filter(p=>p.team===0);if(!specs.length)return;let chosen=[];
  if(randomMode){const pool=specs.slice();while(chosen.length<2&&pool.length)chosen.push(pool.splice(secureRandomIndex(pool.length),1)[0]);}
  else chosen=specs.slice(-2);
  const first=randomMode?(secureRandomIndex(2)?2:1):1,second=first===1?2:1;if(chosen[0])movePlayer(room,chosen[0],first);if(chosen[1])movePlayer(room,chosen[1],second);
}
function startGame(room,by){
  if(room.endTimer){clearTimeout(room.endTimer);room.endTimer=null;}
  room.gameRunning=true;room.paused=false;room.overtime=false;room.elapsedTicks=0;room.redScore=0;room.blueScore=0;room.endingGame=false;room.finalWinner=0;room.hostLastSeenAt=Date.now();
  emitSystem(room,`Partida iniciada por ${by.name}.`);broadcastRoomState(room);
}
function stopGame(room,by,message=true){
  if(room.endTimer){clearTimeout(room.endTimer);room.endTimer=null;}
  room.gameRunning=false;room.paused=false;room.overtime=false;room.elapsedTicks=0;room.redScore=0;room.blueScore=0;room.endingGame=false;room.finalWinner=0;
  if(message&&by)emitSystem(room,`Partida detenida por ${by.name}.`);broadcastRoomState(room);
}
function finishGame(room,team){
  if(room.endTimer)clearTimeout(room.endTimer);
  room.gameRunning=false;room.paused=false;room.endingGame=true;room.finalWinner=team;
  emitMatchChat(room,`${team===1?'Rojo':'Azul'} gana el partido! (${room.redScore|0} - ${room.blueScore|0})`);
  broadcastRoomState(room);
  room.endTimer=setTimeout(()=>{const r=rooms.get(room.id);if(!r||!r.endingGame)return;r.endingGame=false;r.finalWinner=0;r.elapsedTicks=0;r.overtime=false;r.endTimer=null;broadcastRoomState(r);},1900);
}
function pickHostCandidate(room,excludeSocketId=null,visibleOnly=true){
  const candidates=room.players.filter(p=>!p.bot&&p.socketId&&p.socketId!==excludeSocketId&&io.sockets.sockets.has(p.socketId)&&(!visibleOnly||p.visible!==false));
  candidates.sort((a,b)=>(a.ping|0)-(b.ping|0)||a.id-b.id);
  return candidates[0]||null;
}
function migrateHost(room,excludeSocketId=null,allowHiddenFallback=false){
  let next=pickHostCandidate(room,excludeSocketId,true);
  if(!next&&allowHiddenFallback)next=pickHostCandidate(room,excludeSocketId,false);
  if(!next)return false;
  if(room.hostSocketId===next.socketId)return false;
  room.hostSocketId=next.socketId;room.hostLastSeenAt=Date.now();
  return true;
}
function removePlayer(room,p,reason='leave'){
  if(!p)return;const wasHost=room.hostSocketId===p.socketId;room.players=room.players.filter(x=>x.id!==p.id);
  if(wasHost)migrateHost(room,p.socketId,true);
  if(reason==='leave')emitSystem(room,`${p.name} abandonó la sala.`);broadcastRoomState(room);
}
async function closeRoom(room,message='El host cerró la sala.',excludeSocketId=null){
  if(room.endTimer)clearTimeout(room.endTimer);rooms.delete(room.id);const ids=[...(io.sockets.adapter.rooms.get(roomChannel(room.id))||[])];
  for(const sid of ids){const s=io.sockets.sockets.get(sid);if(!s)continue;if(sid!==excludeSocketId)s.emit('room:closed',{message});s.leave(roomChannel(room.id));s.data.roomId=null;s.data.playerId=null;}broadcastRooms();
}
async function leaveCurrentRoom(socket,reason='leave'){
  const room=getRoom(socket);if(!room)return;const p=getActor(socket,room);
  if(room.ownerSocketId===socket.id){await closeRoom(room,'El host cerró la sala.',reason==='leave'?socket.id:null);socket.data.roomId=null;socket.data.playerId=null;return;}
  socket.leave(roomChannel(room.id));socket.data.roomId=null;socket.data.playerId=null;removePlayer(room,p,reason);
}
function relayRtc(socket,event,data){
  const room=getRoom(socket);if(!room)return;const target=io.sockets.sockets.get(String(data?.target||''));if(!isSocketInRoom(target,room))return;
  const hostId=room.hostSocketId||room.ownerSocketId;
  if(event==='rtc:offer'&&socket.id!==hostId)return;
  if(event==='rtc:answer'&&target.id!==hostId)return;
  if(event==='rtc:restart-request'&&target.id!==hostId)return;
  target.emit(event,{from:socket.id,sdp:data?.sdp||null,candidate:data?.candidate||null,restart:!!data?.restart,attempt:Number(data?.attempt)||0});
}
function relayGameplay(socket,data){
  const room=getRoom(socket);if(!room)return;const hostId=room.hostSocketId||room.ownerSocketId,payload=data?.payload;
  if(!payload||typeof payload!=='object')return;
  const t=String(payload.t||'');if(!['i','s','p','q','hello'].includes(t))return;
  let size=0;try{size=JSON.stringify(payload).length;}catch{return;}if(size>160000)return;
  if(socket.id===hostId){
    const target=io.sockets.sockets.get(String(data?.target||''));if(!isSocketInRoom(target,room)||target.id===hostId)return;target.emit('game:relay',{from:socket.id,payload});
  }else{
    const host=io.sockets.sockets.get(hostId);if(!isSocketInRoom(host,room))return;host.emit('game:relay',{from:socket.id,payload});
  }
}

app.get('/rtc-config',(req,res)=>{res.set('Cache-Control','no-store');res.json(buildRtcConfig());});
app.get('/healthz',(req,res)=>{const rtc=buildRtcConfig();res.json({ok:true,rooms:rooms.size,mode:'webrtc-preferred-with-relay-fallback',turnConfigured:rtc.turnConfigured,uptime:process.uptime()});});

io.on('connection',socket=>{
  socket.emit('rooms:list',publicRooms());
  socket.on('rooms:get',()=>socket.emit('rooms:list',publicRooms()));
  socket.on('room:create',async(data,ack=()=>{})=>{try{if(getRoom(socket))await leaveCurrentRoom(socket);const room=newRoom(socket,data||{});ack({ok:true,myPlayerId:socket.data.playerId,state:serializeRoom(room)});broadcastRoomState(room);}catch{ack({ok:false,error:'No se pudo crear la sala.'});}});
  socket.on('room:join',async(data,ack=()=>{})=>{
    const room=rooms.get(String(data?.roomId||''));if(!room)return ack({ok:false,error:'La sala ya no existe.'});const nick=cleanNick(data?.nick);
    if(room.bannedNames.has(nick.toLowerCase()))return ack({ok:false,error:'Estás baneado de esta sala.'});if(room.players.length>=room.maxPlayers)return ack({ok:false,error:'La sala está llena.'});if(room.password&&String(data?.password||'')!==room.password)return ack({ok:false,error:'Contraseña incorrecta.'});
    if(getRoom(socket))await leaveCurrentRoom(socket);socket.join(roomChannel(room.id));const p=createPlayer(room,socket,nick,data?.avatar,false,false,data?.country,data?.avatarImage);socket.data.roomId=room.id;socket.data.playerId=p.id;
    ack({ok:true,myPlayerId:p.id,state:serializeRoom(room)});emitSystem(room,`${p.name} entró a la sala.`);broadcastRoomState(room);
  });
  socket.on('room:leave',async(_,ack=()=>{})=>{await leaveCurrentRoom(socket);ack({ok:true});});

  // Socket.IO is signaling/lobby only. Gameplay packets never pass through here.
  socket.on('rtc:offer',data=>relayRtc(socket,'rtc:offer',data));
  socket.on('rtc:answer',data=>relayRtc(socket,'rtc:answer',data));
  socket.on('rtc:ice',data=>relayRtc(socket,'rtc:ice',data));
  socket.on('rtc:restart-request',data=>relayRtc(socket,'rtc:restart-request',data));
  socket.on('game:relay',data=>relayGameplay(socket,data));

  socket.on('player:ping',data=>{const room=getRoom(socket),p=getActor(socket,room);if(!p)return;p.ping=clamp(Number(data?.ping)||0,0,9999)|0;});
  socket.on('player:visibility',data=>{
    const room=getRoom(socket),p=getActor(socket,room);if(!room||!p||p.bot)return;
    // Cambiar de pestaña NO cambia el host. La migración se reserva para desconexión real
    // o para un host que deja de producir estado del partido durante varios segundos.
    p.visible=!!data?.visible;
  });
  socket.on('net:ping',(t,ack)=>{if(typeof ack==='function')ack(t);});
  socket.on('chat:send',data=>{const room=getRoom(socket),p=getActor(socket,room);if(!room||!p)return;const text=cleanText(data?.text,140);if(!text)return;io.to(roomChannel(room.id)).emit('chat:message',{type:p.team===1?'red':p.team===2?'blue':'system',text,name:p.name,playerId:p.id,ts:Date.now()});});
  socket.on('profile:update',(data,ack=()=>{})=>{const room=getRoom(socket),p=getActor(socket,room);if(!room||!p)return ack({ok:false});p.name=cleanNick(data?.name??p.name);p.avatar=cleanAvatar(data?.avatar??p.avatar);if(data&&Object.prototype.hasOwnProperty.call(data,'avatarImage'))p.avatarImage=cleanAvatarImage(data.avatarImage);if(data&&Object.prototype.hasOwnProperty.call(data,'country'))p.country=cleanCountry(data.country);broadcastRoomState(room);if(p.id===room.ownerPlayerId)broadcastRooms();ack({ok:true});});
  socket.on('room:setTeam',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false,error:'Solo admin.'});const p=room.players.find(x=>x.id===Number(data?.playerId));if(!p)return ack({ok:false});movePlayer(room,p,Number(data?.team));broadcastRoomState(room);ack({ok:true});});
  socket.on('room:teamAction',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false});const action=String(data?.action||'');if(action==='auto')autoTeams(room,false);else if(action==='rand')autoTeams(room,true);else if(action==='reset'){for(const p of [...room.players])if(p.team!==0)movePlayer(room,p,0);}else if(action==='resetRed'){for(const p of [...room.players])if(p.team===1)movePlayer(room,p,0);}else if(action==='resetBlue'){for(const p of [...room.players])if(p.team===2)movePlayer(room,p,0);}else if(action==='lock')room.teamsLocked=!room.teamsLocked;else return ack({ok:false});broadcastRoomState(room);ack({ok:true});});
  socket.on('room:addBot',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false});if(room.players.length>=room.maxPlayers)return ack({ok:false,error:'Sala llena.'});const n=room.players.filter(p=>p.bot).length+1,p=createPlayer(room,socket,`CPU ${n}`,'',false,true);p.team=Number(data?.team)===1?1:2;broadcastRoomState(room);ack({ok:true});});
  socket.on('room:adminAction',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false});const p=room.players.find(x=>x.id===Number(data?.playerId));if(!p||p.id===actor.id)return ack({ok:false});const action=String(data?.action||'');if(action==='admin'){p.admin=!p.admin;broadcastRoomState(room);return ack({ok:true});}if(action==='kick'||action==='ban'){if(action==='ban')room.bannedNames.add(p.name.toLowerCase());const target=playerSocket(room,p);if(target){target.emit('room:kicked',{ban:action==='ban'});target.leave(roomChannel(room.id));target.data.roomId=null;target.data.playerId=null;}removePlayer(room,p,'kick');return ack({ok:true});}ack({ok:false});});
  socket.on('room:setLimits',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false});room.timeLimit=clamp(Number(data?.timeLimit)||0,0,10);room.scoreLimit=clamp(Number(data?.scoreLimit)||0,0,10);broadcastRoomState(room);ack({ok:true});});
  socket.on('room:setStadium',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false,error:'Solo admin.'});if(room.gameRunning)return ack({ok:false,error:'Detené la partida primero.'});const key=String(data?.key||'classic');if(key==='custom'){try{const raw=data?.stadium;if(JSON.stringify(raw).length>400000)throw new Error('Mapa demasiado grande');room.customStadium=E.validateStadium(clone(raw));room.stadiumKey='custom';}catch(err){return ack({ok:false,error:err.message||'Mapa inválido.'});}}else if(['classic','small','big',...Object.keys(BUILTINS)].includes(key)){room.stadiumKey=key;room.customStadium=null;}else return ack({ok:false,error:'Estadio inválido.'});broadcastRoomState(room);ack({ok:true});});
  socket.on('room:gameAction',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false,error:'Solo admin.'});const action=String(data?.action||'');if(action==='start'){if(room.gameRunning)return ack({ok:false});startGame(room,actor);ack({ok:true});}else if(action==='stop'){stopGame(room,actor,true);ack({ok:true});}else if(action==='pause'){if(!room.gameRunning)return ack({ok:false});room.paused=!room.paused;emitSystem(room,room.paused?`Partida pausada por ${actor.name}.`:`Partida reanudada por ${actor.name}.`);broadcastRoomState(room);ack({ok:true});}else ack({ok:false});});
  socket.on('room:hostMeta',(data,ack=()=>{})=>{const room=getRoom(socket);if(!room||socket.id!==(room.hostSocketId||room.ownerSocketId))return ack({ok:false});room.hostLastSeenAt=Date.now();const prevRed=room.redScore|0,prevBlue=room.blueScore|0,nextRed=Math.max(0,Number(data?.redScore)||0)|0,nextBlue=Math.max(0,Number(data?.blueScore)||0)|0;room.elapsedTicks=Math.max(0,Number(data?.elapsedTicks)||0)|0;room.overtime=!!data?.overtime;room.redScore=nextRed;room.blueScore=nextBlue;if(nextRed===prevRed+1&&nextBlue===prevBlue)emitMatchChat(room,`Rojo anota! (${nextRed} - ${nextBlue})`);else if(nextBlue===prevBlue+1&&nextRed===prevRed)emitMatchChat(room,`Azul anota! (${nextRed} - ${nextBlue})`);ack({ok:true});});
  socket.on('room:hostFinish',(data,ack=()=>{})=>{const room=getRoom(socket);if(!room||socket.id!==(room.hostSocketId||room.ownerSocketId))return ack({ok:false});const team=Number(data?.team);if(team!==1&&team!==2)return ack({ok:false});finishGame(room,team);ack({ok:true});});
  socket.on('room:setPassword',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false});room.password=cleanText(data?.password,30);broadcastRoomState(room);ack({ok:true});});
  socket.on('room:clearBans',(_,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false});room.bannedNames.clear();ack({ok:true});});
  socket.on('room:partido',(data,ack=()=>{})=>{const room=getRoom(socket),actor=requireAdmin(socket,room);if(!room||!actor)return ack({ok:false,error:'Solo admin.'});const id=String(data?.id||'').toLowerCase();if(id==='normal')room.teamKits=clone(DEFAULT_TEAM_KITS);else if(PARTIDOS[id])room.teamKits={1:clone(PARTIDOS[id].red),2:clone(PARTIDOS[id].blue)};else return ack({ok:false,error:'Partido desconocido.'});broadcastRoomState(room);ack({ok:true,name:id==='normal'?'Normal':PARTIDOS[id].name});});
  socket.on('disconnect',()=>{leaveCurrentRoom(socket,'leave').catch(()=>{});});
});

setInterval(()=>{for(const room of rooms.values())io.to(roomChannel(room.id)).emit('room:pings',room.players.filter(p=>!p.bot).map(p=>[p.id,p.ping|0]));},1200);
// Failover conservador: no migramos por document.hidden. Solo si el partido está corriendo y
// el host deja de enviar room:hostMeta por más de 5.5 s. Así evitamos cambios de host por un ALT-TAB
// corto, pero seguimos recuperando una partida cuyo host realmente quedó congelado.
setInterval(()=>{const now=Date.now();for(const room of rooms.values()){
  if(!room.gameRunning||room.paused||room.endingGame)continue;
  const hostId=room.hostSocketId||room.ownerSocketId;if(!hostId)continue;
  if(now-(room.hostLastSeenAt||now)<5500)continue;
  const changed=migrateHost(room,hostId,false);if(changed){emitSystem(room,'El host de la partida cambió por pérdida de sincronización.');broadcastRoomState(room);}else room.hostLastSeenAt=now;
}},1500);

server.listen(PORT,'0.0.0.0',()=>{
  const rtc=buildRtcConfig();console.log(`HB Online escuchando en http://localhost:${PORT}`);
  const urls=[];for(const entries of Object.values(os.networkInterfaces()))for(const n of entries||[])if(n.family==='IPv4'&&!n.internal)urls.push(`http://${n.address}:${PORT}`);
  if(urls.length){console.log('Misma Wi-Fi / LAN:');for(const u of urls)console.log('  '+u);}console.log(`WebRTC P2P preferido + relay Socket.IO de respaldo. TURN: ${rtc.turnConfigured?'configurado':'no configurado (usar TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL)'}.`);
});
