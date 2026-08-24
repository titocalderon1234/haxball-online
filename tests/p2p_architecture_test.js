'use strict';
const fs=require('fs');
const server=fs.readFileSync(require('path').join(__dirname,'..','server.js'),'utf8');
const app=fs.readFileSync(require('path').join(__dirname,'..','public','app.js'),'utf8');
function ok(cond,msg){if(!cond){console.error('FAIL',msg);process.exit(1);}console.log('OK',msg);}
ok(server.includes("socket.on('rtc:offer'"),'signaling de ofertas WebRTC');
ok(server.includes("socket.on('rtc:answer'"),'signaling de respuestas WebRTC');
ok(server.includes("socket.on('rtc:ice'"),'signaling ICE');
ok(!server.includes('stepRoom(room)'),'servidor no ejecuta física de partida');
ok(!server.includes("emit('game:snapshot'"),'servidor no transmite snapshots de gameplay');
ok(app.includes('new RTCPeerConnection'),'cliente crea RTCPeerConnection');
ok(app.includes("createDataChannel('hb-game'"),'host crea RTCDataChannel de juego');
ok(app.includes("safeDcSend(hostLink?.dc,{t:'i'"),'inputs de invitados viajan por DataChannel');
ok(app.includes('function sendHostSnapshot'),'host envía snapshots P2P');
ok(app.includes('function hostStep'),'host navegador ejecuta simulación');
ok(!app.includes("socket.emit('player:input'"),'inputs ya no pasan por Socket.IO');
console.log('P2P architecture checks passed.');
