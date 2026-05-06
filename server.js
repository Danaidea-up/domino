const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const rooms = {};
const BOT_NAMES = ['هێمن AI', 'ژیان AI', 'ئاراس AI', 'رۆژ AI', 'دانا AI'];

function id4(){ return Math.random().toString(36).slice(2,6).toUpperCase(); }
function createDominoSet(){ const a=[]; for(let i=0;i<=6;i++) for(let j=i;j<=6;j++) a.push({left:i,right:j,id:`${i}-${j}-${Math.random().toString(36).slice(2,7)}`}); return a; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function ends(board){ if(!board.length) return {left:null,right:null}; return {left:board[0].left,right:board[board.length-1].right}; }
function canPlayTile(tile, board){ if(!board.length) return {left:true,right:true}; const e=ends(board); return {left:tile.left===e.left||tile.right===e.left, right:tile.left===e.right||tile.right===e.right}; }
function playerCanPlay(hand, board){ return !board.length || hand.some(t=>{const c=canPlayTile(t,board); return c.left||c.right;}); }
function normalizeName(name){ return String(name||'یاریزان').trim().slice(0,18) || 'یاریزان'; }
function roomPublic(room){ return { roomId: room.id, settings: room.settings, started: room.started, players: room.players.map(p=>({id:p.id,name:p.name,isHost:p.isHost,isBot:p.isBot,connected:p.connected,ready:p.ready,tilesCount:p.hand?.length||0,score:p.score||0})), }; }
function emitLobby(room){ io.to(room.id).emit('lobbyUpdate', roomPublic(room)); }
function stateFor(room, player){ return { roomId: room.id, started: room.started, settings: room.settings, board: room.board, boneyardCount: room.boneyard.length, currentTurn: room.currentTurn, currentPlayerName: room.players[room.currentTurn]?.name, winner: room.winner, yourHand: player.hand, yourTurn: room.players[room.currentTurn]?.id===player.id, log: room.log.slice(-8), players: room.players.map(p=>({id:p.id,name:p.name,isHost:p.isHost,isBot:p.isBot,connected:p.connected,tilesCount:p.hand.length,score:p.score||0})) }; }
function broadcast(room){ room.players.forEach(p=>{ if(!p.isBot) io.to(p.id).emit('gameState', stateFor(room,p)); }); emitLobby(room); if(room.started) setTimeout(()=>maybeBotTurn(room.id), 650); }
function addLog(room, msg){ room.log.push(msg); if(room.log.length>40) room.log.shift(); }
function ensureBots(room){ if(!room.settings.fillBots) return; let i=0; while(room.players.length < room.settings.targetPlayers){ const name=BOT_NAMES[(room.players.length+i)%BOT_NAMES.length]; room.players.push({id:`bot_${id4()}`,name,hand:[],connected:true,isHost:false,isBot:true,ready:true,score:0}); i++; } }
function startGame(roomId){ const room=rooms[roomId]; if(!room || room.players.length<2) return; ensureBots(room); const all=shuffle(createDominoSet()); const per=room.players.length===2?7:6; room.players.forEach(p=>p.hand=all.splice(0,per)); room.boneyard=all; room.board=[]; room.started=true; room.winner=null; room.passes=0; room.log=[]; let start=0, high=-1; room.players.forEach((p,idx)=>p.hand.forEach(t=>{if(t.left===t.right&&t.left>high){high=t.left;start=idx;}})); room.currentTurn=start; addLog(room, `یاری دەستی پێکرد — نۆرەی ${room.players[start].name}`); broadcast(room); }
function endIfNeeded(room){ const w=room.players.find(p=>p.hand.length===0); if(w){ room.winner={name:w.name,reason:'empty'}; w.score=(w.score||0)+10; room.started=false; addLog(room, `${w.name} بردیەوە 🎉`); return true; } const blocked=room.players.every(p=>!playerCanPlay(p.hand,room.board)); if(blocked && !room.boneyard.length){ let best=room.players[0], min=Infinity; room.players.forEach(p=>{const s=p.hand.reduce((a,t)=>a+t.left+t.right,0); if(s<min){min=s;best=p;}}); best.score=(best.score||0)+5; room.winner={name:best.name,reason:'block',pips:min}; room.started=false; addLog(room, `${best.name} بە کەمترین خاڵ بردیەوە`); return true; } return false; }
function play(room, playerIdx, tileId, side){ const p=room.players[playerIdx]; const idx=p.hand.findIndex(t=>t.id===tileId); if(idx<0) return false; let tile={...p.hand[idx]}; if(!room.board.length) room.board.push(tile); else { const e=ends(room.board); if(side==='left'){ if(tile.right===e.left) room.board.unshift(tile); else if(tile.left===e.left) room.board.unshift({left:tile.right,right:tile.left,id:tile.id}); else return false; } else { if(tile.left===e.right) room.board.push(tile); else if(tile.right===e.right) room.board.push({left:tile.right,right:tile.left,id:tile.id}); else return false; } } p.hand.splice(idx,1); room.passes=0; addLog(room, `${p.name} دۆمینۆی دانا`); if(!endIfNeeded(room)) room.currentTurn=(room.currentTurn+1)%room.players.length; return true; }
function maybeBotTurn(roomId){ const room=rooms[roomId]; if(!room||!room.started) return; const p=room.players[room.currentTurn]; if(!p||!p.isBot) return; let playable=null, side='right'; for(const t of p.hand){ const c=canPlayTile(t,room.board); if(c.right){playable=t;side='right';break;} if(c.left){playable=t;side='left';break;} }
 if(playable) play(room, room.currentTurn, playable.id, side); else if(room.boneyard.length){ p.hand.push(room.boneyard.pop()); addLog(room, `${p.name} دۆمینۆی وەرگرت`); } else { addLog(room, `${p.name} نۆرەی تێپەڕاند`); room.currentTurn=(room.currentTurn+1)%room.players.length; }
 if(!endIfNeeded(room)) broadcast(room); else broadcast(room);
}

io.on('connection', socket=>{
  socket.on('createRoom', ({playerName, accountName, settings})=>{ let id; do{id=id4()}while(rooms[id]); rooms[id]={id, players:[{id:socket.id,name:normalizeName(playerName||accountName),hand:[],connected:true,isHost:true,isBot:false,ready:false,score:0}], board:[],boneyard:[],currentTurn:0,started:false,winner:null,passes:0,log:[], settings:{targetPlayers:2,fillBots:true,sound:true,music:true,...settings}}; socket.join(id); socket.data.roomId=id; socket.emit('roomCreated',{roomId:id,playerId:socket.id}); emitLobby(rooms[id]); });
  socket.on('joinRoom', ({roomId,playerName})=>{ const id=String(roomId||'').toUpperCase(); const room=rooms[id]; if(!room) return socket.emit('errorMessage','ژوور نەدۆزرایەوە'); if(room.started) return socket.emit('errorMessage','یاری دەستی پێکردووە'); if(room.players.filter(p=>!p.isBot).length>=4) return socket.emit('errorMessage','ژوورەکە پڕە'); room.players.push({id:socket.id,name:normalizeName(playerName),hand:[],connected:true,isHost:false,isBot:false,ready:false,score:0}); socket.join(id); socket.data.roomId=id; socket.emit('roomJoined',{roomId:id,playerId:socket.id}); emitLobby(room); });
  socket.on('updateSettings', settings=>{ const room=rooms[socket.data.roomId]; if(!room) return; const me=room.players.find(p=>p.id===socket.id); if(!me?.isHost) return; room.settings={...room.settings,...settings, targetPlayers:Math.min(4,Math.max(2,Number(settings.targetPlayers||room.settings.targetPlayers)))}; emitLobby(room); });
  socket.on('toggleReady', ()=>{ const room=rooms[socket.data.roomId]; if(!room) return; const me=room.players.find(p=>p.id===socket.id); if(me){me.ready=!me.ready; emitLobby(room);} });
  socket.on('addBot', ()=>{ const room=rooms[socket.data.roomId]; if(!room||room.players.length>=4) return; room.settings.fillBots=true; room.settings.targetPlayers=Math.min(4, room.players.length+1); ensureBots(room); emitLobby(room); });
  socket.on('startGame', ()=>{ const room=rooms[socket.data.roomId]; if(!room) return; const me=room.players.find(p=>p.id===socket.id); if(!me?.isHost) return socket.emit('errorMessage','تەنها هۆست دەتوانێت دەستپێبکات'); ensureBots(room); if(room.players.length<2) return socket.emit('errorMessage','لانیکەم ٢ یاریزان پێویستە'); startGame(room.id); });
  socket.on('playTile', ({tileId, side})=>{ const room=rooms[socket.data.roomId]; if(!room||!room.started) return; const idx=room.players.findIndex(p=>p.id===socket.id); if(idx!==room.currentTurn) return socket.emit('errorMessage','ئێستا نۆرەی تۆ نییە'); if(!play(room,idx,tileId,side)) return socket.emit('errorMessage','ئەم دۆمینۆیە لەم شوێنە ناگونجێت'); broadcast(room); });
  socket.on('drawTile', ()=>{ const room=rooms[socket.data.roomId]; if(!room||!room.started) return; const idx=room.players.findIndex(p=>p.id===socket.id); if(idx!==room.currentTurn) return; if(!room.boneyard.length) return socket.emit('errorMessage','دۆمینۆی ماوە نییە'); room.players[idx].hand.push(room.boneyard.pop()); addLog(room, `${room.players[idx].name} دۆمینۆی وەرگرت`); broadcast(room); });
  socket.on('passTurn', ()=>{ const room=rooms[socket.data.roomId]; if(!room||!room.started) return; const idx=room.players.findIndex(p=>p.id===socket.id); if(idx!==room.currentTurn) return; if(room.boneyard.length) return socket.emit('errorMessage','سەرەتا دۆمینۆ وەربگرە'); if(playerCanPlay(room.players[idx].hand,room.board)) return socket.emit('errorMessage','دۆمینۆی گونجاوت هەیە'); room.currentTurn=(room.currentTurn+1)%room.players.length; addLog(room, `${room.players[idx].name} نۆرەی تێپەڕاند`); broadcast(room); });
  socket.on('restartGame', ()=>{ const room=rooms[socket.data.roomId]; const me=room?.players.find(p=>p.id===socket.id); if(me?.isHost) startGame(room.id); });
  socket.on('disconnect', ()=>{ const room=rooms[socket.data.roomId]; if(!room) return; const idx=room.players.findIndex(p=>p.id===socket.id); if(idx<0) return; if(!room.started){ room.players.splice(idx,1); if(!room.players.length) return delete rooms[room.id]; if(!room.players.some(p=>p.isHost)) room.players[0].isHost=true; emitLobby(room); } else { room.players[idx].connected=false; broadcast(room); } });
});

const PORT=process.env.PORT||3000;
server.listen(PORT, ()=>console.log(`Domino Pro running on ${PORT}`));
