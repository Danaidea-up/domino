const express = require("express");
const http = require("http");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 60_000, max: 240 }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || "";
let dbReady = false;

const PlayerSchema = new mongoose.Schema({
  playerId: { type: String, unique: true, index: true },
  name: String,
  avatar: String,
  coins: { type: Number, default: 100 },
  xp: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  rank: { type: String, default: "نوێ" },
  skins: { type: [String], default: ["classic"] },
  currentSkin: { type: String, default: "classic" },
  lastSeen: Date
});

const MatchSchema = new mongoose.Schema({
  roomId: String,
  players: [String],
  winner: String,
  score: Number,
  endedAt: Date,
  mode: String
});

const Player = mongoose.model("Player", PlayerSchema);
const Match = mongoose.model("Match", MatchSchema);

if (MONGO_URL) {
  mongoose.connect(MONGO_URL).then(() => {
    dbReady = true;
    console.log("MongoDB connected");
  }).catch(err => console.log("MongoDB error:", err.message));
}

const rooms = {};
const queue = [];
const sessions = new Map();

function code(){ return Math.random().toString(36).substring(2,6).toUpperCase(); }
function tiles(){
  const a=[]; for(let i=0;i<=6;i++) for(let j=i;j<=6;j++) a.push({left:i,right:j,id:`${i}-${j}-${Math.random()}`});
  return shuffle(a);
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a; }
function ends(board){ return board.length ? {left: board[0].left, right: board[board.length-1].right} : {left:null,right:null}; }
function canPlay(tile, board){
  if(!board.length) return {left:true,right:true};
  const e=ends(board);
  return {left: tile.left===e.left || tile.right===e.left, right: tile.left===e.right || tile.right===e.right};
}
function hasMove(hand, board){ return hand.some(t => { const c=canPlay(t, board); return c.left || c.right; }); }
function normalizeRank(xp){ if(xp>=1000) return "ئەفسانەیی"; if(xp>=500) return "پڕۆ"; if(xp>=150) return "باش"; return "نوێ"; }
function safeRoomState(room, player){
  return {
    roomId: room.id, started: room.started, board: room.board, boneyardCount: room.boneyard.length,
    currentTurn: room.currentTurn, currentPlayerName: room.players[room.currentTurn]?.name,
    winner: room.winner, yourHand: player.hand, yourTurn: room.players[room.currentTurn]?.id === player.id,
    players: room.players.map(p => ({ id:p.id, name:p.name, avatar:p.avatar, tilesCount:p.hand.length, connected:p.connected, isBot:p.isBot, coins:p.coins||0 }))
  };
}
function broadcastLobby(room){
  io.to(room.id).emit("lobbyUpdate", { roomId: room.id, players: room.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,isHost:p.isHost,isBot:p.isBot})) });
}
function broadcast(room){
  room.players.forEach(p => { if(!p.isBot) io.to(p.id).emit("gameState", safeRoomState(room,p)); });
}
function addBot(room){
  const bot = { id:"BOT_"+Math.random().toString(36).slice(2), playerId:"bot", name:"🤖 AI Bot", avatar:"🤖", hand:[], connected:true, isHost:false, isBot:true, coins:0 };
  room.players.push(bot);
  return bot;
}
function start(room){
  if(!room || room.players.length<2) return;
  while(room.players.length < 4 && room.autoFill) addBot(room);
  const all=tiles();
  const per = room.players.length===2 ? 7 : 6;
  room.players.forEach(p=>p.hand=all.splice(0,per));
  room.boneyard=all; room.board=[]; room.started=true; room.winner=null; room.currentTurn=0; room.passes=0;
  broadcast(room);
  maybeBot(room);
}
function scoreHand(hand){ return hand.reduce((s,t)=>s+t.left+t.right,0); }
async function end(room, winner, reason){
  room.winner={name:winner.name, reason};
  room.started=false;
  const score = room.players.filter(p=>p.id!==winner.id).reduce((s,p)=>s+scoreHand(p.hand),0);
  if(dbReady && !winner.isBot && winner.playerId){
    const p = await Player.findOne({playerId:winner.playerId});
    if(p){ p.wins += 1; p.coins += Math.max(20, score); p.xp += 30; p.rank = normalizeRank(p.xp); await p.save(); }
  }
  for(const loser of room.players){
    if(dbReady && !loser.isBot && loser.id!==winner.id && loser.playerId){
      const p = await Player.findOne({playerId:loser.playerId});
      if(p){ p.losses += 1; p.xp += 5; p.rank = normalizeRank(p.xp); await p.save(); }
    }
  }
  if(dbReady) await Match.create({roomId:room.id, players:room.players.map(p=>p.playerId||p.name), winner:winner.name, score, endedAt:new Date(), mode:room.mode});
  broadcast(room);
}
function checkEnd(room){
  const w = room.players.find(p=>p.hand.length===0);
  if(w){ end(room,w,"empty"); return true; }
  if(room.boneyard.length===0 && room.players.every(p=>!hasMove(p.hand, room.board))){
    let best=room.players[0]; for(const p of room.players) if(scoreHand(p.hand)<scoreHand(best.hand)) best=p;
    end(room,best,"blocked"); return true;
  }
  return false;
}
function play(room, player, tileId, side){
  if(!room.started) return false;
  if(room.players[room.currentTurn]?.id !== player.id) return false;
  const idx=player.hand.findIndex(t=>t.id===tileId);
  if(idx<0) return false;
  const tile={...player.hand[idx]};
  if(room.board.length===0) room.board.push(tile);
  else{
    const e=ends(room.board);
    if(side==="left"){
      if(tile.right===e.left) room.board.unshift(tile);
      else if(tile.left===e.left) room.board.unshift({left:tile.right,right:tile.left,id:tile.id});
      else return false;
    } else {
      if(tile.left===e.right) room.board.push(tile);
      else if(tile.right===e.right) room.board.push({left:tile.right,right:tile.left,id:tile.id});
      else return false;
    }
  }
  player.hand.splice(idx,1); room.passes=0;
  if(!checkEnd(room)){ room.currentTurn=(room.currentTurn+1)%room.players.length; broadcast(room); maybeBot(room); }
  return true;
}
function botMove(room){
  const bot=room.players[room.currentTurn];
  if(!bot || !bot.isBot || !room.started) return;
  const playable=bot.hand.filter(t=>{const c=canPlay(t, room.board); return c.left||c.right});
  let t = playable.sort((a,b)=>(b.left+b.right)-(a.left+a.right))[0];
  if(t){
    const c=canPlay(t, room.board);
    play(room, bot, t.id, c.right ? "right" : "left");
  } else if(room.boneyard.length){
    bot.hand.push(room.boneyard.pop());
    broadcast(room);
    setTimeout(()=>botMove(room),500);
  } else {
    room.currentTurn=(room.currentTurn+1)%room.players.length;
    broadcast(room);
    maybeBot(room);
  }
}
function maybeBot(room){ if(room.started && room.players[room.currentTurn]?.isBot) setTimeout(()=>botMove(room),700); }

app.post("/api/profile", async (req,res)=>{
  const {playerId,name,avatar}=req.body;
  if(!dbReady) return res.json({ok:false, offline:true});
  const p = await Player.findOneAndUpdate({playerId},{ $set:{name,avatar,lastSeen:new Date()} },{new:true,upsert:true,setDefaultsOnInsert:true});
  res.json({ok:true, player:p});
});
app.get("/api/profile/:id", async (req,res)=>{
  if(!dbReady) return res.json({ok:false, offline:true});
  const p = await Player.findOne({playerId:req.params.id});
  res.json({ok:true, player:p});
});
app.get("/api/leaderboard", async (req,res)=>{
  if(!dbReady) return res.json({ok:false, players:[]});
  const players = await Player.find({}).sort({xp:-1, coins:-1}).limit(50);
  res.json({ok:true, players});
});

io.on("connection", socket=>{
  socket.on("register", async ({playerId,name,avatar})=>{
    socket.data.playerId=playerId; socket.data.name=name; socket.data.avatar=avatar;
    sessions.set(playerId, socket.id);
    if(dbReady) await Player.findOneAndUpdate({playerId},{ $set:{name,avatar,lastSeen:new Date()} },{upsert:true,setDefaultsOnInsert:true});
    socket.emit("registered",{ok:true});
  });

  socket.on("findMatch", ()=>{
    const player={id:socket.id, playerId:socket.data.playerId, name:socket.data.avatar+" "+socket.data.name, avatar:socket.data.avatar, hand:[], connected:true, isHost:true, isBot:false};
    const waiting = queue.shift();
    if(waiting && io.sockets.sockets.get(waiting.id)){
      const id=code();
      const room={id, players:[waiting, {...player,isHost:false}], board:[], boneyard:[], currentTurn:0, started:false, winner:null, autoFill:true, mode:"matchmaking"};
      rooms[id]=room;
      room.players.forEach(p=>{io.sockets.sockets.get(p.id)?.join(id); io.sockets.sockets.get(p.id).data.roomId=id;});
      broadcastLobby(room); start(room);
    } else {
      queue.push(player);
      socket.emit("queueStatus",{waiting:true});
      setTimeout(()=>{
        const idx=queue.findIndex(p=>p.id===socket.id);
        if(idx>=0){
          queue.splice(idx,1);
          const id=code();
          const room={id, players:[player], board:[], boneyard:[], currentTurn:0, started:false, winner:null, autoFill:true, mode:"botFallback"};
          rooms[id]=room; socket.join(id); socket.data.roomId=id; addBot(room); broadcastLobby(room); start(room);
        }
      },8000);
    }
  });

  socket.on("createRoom", ({playerName})=>{
    const id=code();
    const room={id, players:[{id:socket.id, playerId:socket.data.playerId, name:playerName||socket.data.name||"Player", avatar:socket.data.avatar||"🎲", hand:[], connected:true, isHost:true, isBot:false}], board:[], boneyard:[], currentTurn:0, started:false, winner:null, autoFill:false, mode:"room"};
    rooms[id]=room; socket.join(id); socket.data.roomId=id;
    socket.emit("roomCreated",{roomId:id, playerId:socket.id}); broadcastLobby(room);
  });
  socket.on("joinRoom", ({roomId,playerName})=>{
    const room=rooms[String(roomId||"").toUpperCase()];
    if(!room) return socket.emit("error",{message:"ژوور نەدۆزرایەوە"});
    if(room.started) return socket.emit("error",{message:"یاری دەستی پێکردووە"});
    if(room.players.length>=4) return socket.emit("error",{message:"ژوور پڕە"});
    room.players.push({id:socket.id, playerId:socket.data.playerId, name:playerName||socket.data.name||"Player", avatar:socket.data.avatar||"🎲", hand:[], connected:true, isHost:false, isBot:false});
    socket.join(room.id); socket.data.roomId=room.id;
    socket.emit("roomJoined",{roomId:room.id, playerId:socket.id}); broadcastLobby(room);
  });
  socket.on("addBot", ()=>{ const room=rooms[socket.data.roomId]; if(room && !room.started && room.players.length<4){ addBot(room); broadcastLobby(room); }});
  socket.on("startGame", ()=>{ const room=rooms[socket.data.roomId]; if(room) start(room); });
  socket.on("playTile", ({tileId,side})=>{ const room=rooms[socket.data.roomId]; if(!room) return; const p=room.players.find(x=>x.id===socket.id); if(!p || !play(room,p,tileId,side)) socket.emit("error",{message:"جوڵەی هەڵە"}); });
  socket.on("drawTile", ()=>{ const room=rooms[socket.data.roomId]; if(!room || !room.started) return; const p=room.players.find(x=>x.id===socket.id); if(room.players[room.currentTurn]?.id!==socket.id) return; if(room.boneyard.length){p.hand.push(room.boneyard.pop()); broadcast(room);} });
  socket.on("passTurn", ()=>{ const room=rooms[socket.data.roomId]; if(!room || !room.started) return; const p=room.players.find(x=>x.id===socket.id); if(!p || room.players[room.currentTurn]?.id!==socket.id) return; if(hasMove(p.hand,room.board)) return socket.emit("error",{message:"دۆمینۆی گونجاوت هەیە"}); room.currentTurn=(room.currentTurn+1)%room.players.length; broadcast(room); maybeBot(room); });
  socket.on("disconnect", ()=>{ const room=rooms[socket.data.roomId]; if(!room) return; const p=room.players.find(x=>x.id===socket.id); if(p){p.connected=false; broadcast(room);} });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("Domino Ultimate V2 running on "+PORT));