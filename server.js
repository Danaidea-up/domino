const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function createDominoSet(){
  const tiles=[];
  for(let i=0;i<=6;i++) for(let j=i;j<=6;j++) tiles.push({left:i,right:j,id:`${i}-${j}-${Math.random().toString(36).slice(2)}`});
  return shuffle(tiles);
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function code(){ let c; do{ c=Math.random().toString(36).substring(2,6).toUpperCase(); }while(rooms[c]); return c; }
function ends(board){ if(!board.length) return {left:null,right:null}; return {left:board[0].left,right:board[board.length-1].right}; }
function canPlayTile(tile, board){ if(!board.length) return {left:true,right:true}; const e=ends(board); return {left:tile.left===e.left||tile.right===e.left,right:tile.left===e.right||tile.right===e.right}; }
function playerCanPlay(hand, board){ return hand.some(t=>{ const c=canPlayTile(t,board); return c.left||c.right; }); }
function placeTile(tile, board, side){
  if(!board.length){ board.push(tile); return true; }
  const e=ends(board);
  if(side==='left'){
    if(tile.right===e.left){ board.unshift(tile); return true; }
    if(tile.left===e.left){ board.unshift({left:tile.right,right:tile.left,id:tile.id}); return true; }
  }else{
    if(tile.left===e.right){ board.push(tile); return true; }
    if(tile.right===e.right){ board.push({left:tile.right,right:tile.left,id:tile.id}); return true; }
  }
  return false;
}
function bestBotTile(bot, room){
  const playable = bot.hand.filter(t=>{ const c=canPlayTile(t,room.board); return c.left||c.right; });
  if(!playable.length) return null;
  if(room.aiLevel==='easy') return playable[Math.floor(Math.random()*playable.length)];
  if(room.aiLevel==='medium') return playable.sort((a,b)=>(b.left+b.right)-(a.left+a.right))[0];
  return playable.sort((a,b)=>((b.left===b.right?20:0)+b.left+b.right)-((a.left===a.right?20:0)+a.left+a.right))[0];
}
function advanceTurn(roomId){
  const room=rooms[roomId]; if(!room||!room.started) return;
  if(checkEnd(roomId)){ broadcast(roomId); return; }
  room.currentTurn=(room.currentTurn+1)%room.players.length;
  broadcast(roomId);
  const p=room.players[room.currentTurn];
  if(p && p.isBot) setTimeout(()=>botMove(roomId), 650);
}
function botMove(roomId){
  const room=rooms[roomId]; if(!room||!room.started) return;
  const bot=room.players[room.currentTurn]; if(!bot||!bot.isBot) return;
  const tile=bestBotTile(bot,room);
  if(tile){
    const c=canPlayTile(tile,room.board);
    const side=c.right?'right':'left';
    placeTile({...tile},room.board,side);
    bot.hand=bot.hand.filter(t=>t.id!==tile.id);
    room.passes=0;
  }else if(room.boneyard.length){
    bot.hand.push(room.boneyard.pop());
  }else{
    room.passes=(room.passes||0)+1;
  }
  advanceTurn(roomId);
}
function start(roomId){
  const room=rooms[roomId]; if(!room||room.players.length<2) return;
  const all=createDominoSet(); const per=room.players.length===2?7:6;
  room.players.forEach(p=>p.hand=all.splice(0,per));
  room.boneyard=all; room.board=[]; room.started=true; room.winner=null; room.passes=0;
  let idx=0, high=-1;
  room.players.forEach((p,i)=>p.hand.forEach(t=>{ if(t.left===t.right && t.left>high){high=t.left;idx=i;} }));
  room.currentTurn=idx; broadcast(roomId);
  if(room.players[room.currentTurn].isBot) setTimeout(()=>botMove(roomId),650);
}
function checkEnd(roomId){
  const room=rooms[roomId]; if(!room) return false;
  const winner=room.players.find(p=>p.hand.length===0);
  if(winner){ room.winner={name:winner.name,reason:'empty',isBot:winner.isBot}; room.started=false; return true; }
  const blocked=room.boneyard.length===0 && room.players.every(p=>!playerCanPlay(p.hand,room.board));
  if(blocked){
    let win=null,min=Infinity;
    room.players.forEach(p=>{ const s=p.hand.reduce((a,t)=>a+t.left+t.right,0); if(s<min){min=s;win=p;} });
    room.winner={name:win.name,reason:'block',pips:min,isBot:win.isBot}; room.started=false; return true;
  }
  return false;
}
function publicPlayers(room){ return room.players.map(p=>({id:p.id,name:p.name,isHost:p.isHost,isBot:p.isBot,tilesCount:p.hand.length,connected:p.connected!==false})); }
function broadcast(roomId){
  const room=rooms[roomId]; if(!room) return;
  room.players.forEach(p=>{
    if(p.isBot) return;
    io.to(p.id).emit('gameState',{roomId,started:room.started,board:room.board,boneyardCount:room.boneyard.length,currentTurn:room.currentTurn,currentPlayerName:room.players[room.currentTurn]?.name,winner:room.winner,yourHand:p.hand,yourTurn:room.players[room.currentTurn]?.id===p.id,players:publicPlayers(room)});
  });
}
function lobby(roomId){ const room=rooms[roomId]; if(room) io.to(roomId).emit('lobbyUpdate',{roomId,players:publicPlayers(room),aiLevel:room.aiLevel}); }

io.on('connection', socket=>{
  socket.on('createRoom', ({playerName, aiLevel})=>{
    const roomId=code();
    rooms[roomId]={players:[{id:socket.id,name:playerName||'Player',hand:[],connected:true,isHost:true,isBot:false}],board:[],boneyard:[],currentTurn:0,started:false,winner:null,aiLevel:aiLevel||'medium'};
    socket.join(roomId); socket.data.roomId=roomId; socket.emit('roomCreated',{roomId,playerId:socket.id}); lobby(roomId);
  });
  socket.on('joinRoom', ({roomId,playerName})=>{
    roomId=(roomId||'').toUpperCase(); const room=rooms[roomId];
    if(!room) return socket.emit('error',{message:'ژوورەکە نییە'});
    if(room.started) return socket.emit('error',{message:'یاری دەستی پێکردووە'});
    if(room.players.length>=4) return socket.emit('error',{message:'ژوور پڕە'});
    room.players.push({id:socket.id,name:playerName||'Player',hand:[],connected:true,isHost:false,isBot:false});
    socket.join(roomId); socket.data.roomId=roomId; socket.emit('roomJoined',{roomId,playerId:socket.id}); lobby(roomId);
  });
  socket.on('addBot', ()=>{
    const roomId=socket.data.roomId; const room=rooms[roomId]; if(!room||room.started) return;
    const host=room.players.find(p=>p.id===socket.id); if(!host?.isHost) return socket.emit('error',{message:'تەنها Host دەتوانێت Bot زیاد بکات'});
    if(room.players.length>=4) return socket.emit('error',{message:'ژوور پڕە'});
    room.players.push({id:'bot_'+Math.random().toString(36).slice(2),name:'🤖 AI Bot '+room.players.length,hand:[],connected:true,isHost:false,isBot:true});
    lobby(roomId);
  });
  socket.on('startGame', ()=>{ const r=socket.data.roomId; const room=rooms[r]; if(!room) return; const p=room.players.find(x=>x.id===socket.id); if(!p?.isHost) return socket.emit('error',{message:'تەنها Host'}); start(r); });
  socket.on('playTile', ({tileId,side})=>{
    const roomId=socket.data.roomId; const room=rooms[roomId]; if(!room||!room.started) return;
    const idx=room.players.findIndex(p=>p.id===socket.id); if(idx!==room.currentTurn) return socket.emit('error',{message:'نۆرەی تۆ نییە'});
    const p=room.players[idx]; const ti=p.hand.findIndex(t=>t.id===tileId); if(ti<0) return;
    const tile={...p.hand[ti]}; if(!placeTile(tile,room.board,side||'right')&&!placeTile(tile,room.board,'left')) return socket.emit('error',{message:'دۆمینۆکە ناگونجێت'});
    p.hand.splice(ti,1); room.passes=0; advanceTurn(roomId);
  });
  socket.on('drawTile', ()=>{
    const roomId=socket.data.roomId; const room=rooms[roomId]; if(!room||!room.started) return;
    const idx=room.players.findIndex(p=>p.id===socket.id); if(idx!==room.currentTurn) return;
    if(!room.boneyard.length) return socket.emit('error',{message:'دۆمینۆ نەماوە'});
    room.players[idx].hand.push(room.boneyard.pop()); broadcast(roomId);
  });
  socket.on('passTurn', ()=>{
    const roomId=socket.data.roomId; const room=rooms[roomId]; if(!room||!room.started) return;
    const idx=room.players.findIndex(p=>p.id===socket.id); if(idx!==room.currentTurn) return;
    if(room.boneyard.length) return socket.emit('error',{message:'سەرەتا دۆمینۆ وەربگرە'});
    if(playerCanPlay(room.players[idx].hand,room.board)) return socket.emit('error',{message:'دۆمینۆی گونجاوت هەیە'});
    room.passes=(room.passes||0)+1; advanceTurn(roomId);
  });
  socket.on('disconnect', ()=>{
    const roomId=socket.data.roomId; const room=rooms[roomId]; if(!room) return;
    const idx=room.players.findIndex(p=>p.id===socket.id); if(idx<0) return;
    if(!room.started){ room.players.splice(idx,1); if(!room.players.length) return delete rooms[roomId]; if(!room.players.some(p=>p.isHost&&!p.isBot)) room.players.find(p=>!p.isBot).isHost=true; lobby(roomId); }
    else{ room.players[idx].connected=false; broadcast(roomId); }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('Domino PRO running on '+PORT));
