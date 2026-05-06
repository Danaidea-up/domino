const express = require("express");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || "";
let dbReady = false;

const localPlayers = new Map();
const localMatches = [];

const PlayerSchema = new mongoose.Schema({
  playerId: { type: String, unique: true, index: true },
  name: { type: String, default: "Player" },
  avatar: { type: String, default: "🎲" },
  coins: { type: Number, default: 100 },
  xp: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  rank: { type: String, default: "نوێ" },
  lastSeen: Date
});

const MatchSchema = new mongoose.Schema({
  roomId: String,
  mode: String,
  targetScore: Number,
  players: [String],
  finalScores: Object,
  winner: String,
  rounds: Number,
  endedAt: Date
});

const Player = mongoose.model("Player", PlayerSchema);
const Match = mongoose.model("Match", MatchSchema);

async function connectDB() {
  if (!MONGO_URL || MONGO_URL.includes("${{")) {
    console.log("MongoDB not configured. Local fallback active.");
    return;
  }
  try {
    await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
    dbReady = true;
    console.log("MongoDB connected");
  } catch (err) {
    dbReady = false;
    console.log("MongoDB failed. Local fallback active:", err.message);
  }
}
connectDB();

const rooms = {};
const queue = [];

function rankFromXP(xp) {
  if (xp >= 1000) return "ئەفسانەیی";
  if (xp >= 500) return "پڕۆ";
  if (xp >= 150) return "باش";
  return "نوێ";
}

function defaultPlayer(playerId, name, avatar) {
  return { playerId, name: name || "Player", avatar: avatar || "🎲", coins: 100, xp: 0, wins: 0, losses: 0, rank: "نوێ", lastSeen: new Date() };
}

async function getOrCreatePlayer(playerId, name, avatar) {
  if (!playerId) playerId = "guest_" + Math.random().toString(36).slice(2);
  if (dbReady) {
    return await Player.findOneAndUpdate(
      { playerId },
      { $set: { name: name || "Player", avatar: avatar || "🎲", lastSeen: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }
  if (!localPlayers.has(playerId)) localPlayers.set(playerId, defaultPlayer(playerId, name, avatar));
  const p = localPlayers.get(playerId);
  p.name = name || p.name;
  p.avatar = avatar || p.avatar;
  p.lastSeen = new Date();
  return p;
}

function code(){ return Math.random().toString(36).substring(2,6).toUpperCase(); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function makeTiles(){ const a=[]; for(let i=0;i<=6;i++) for(let j=i;j<=6;j++) a.push({ left:i, right:j, id:`${i}-${j}-${Math.random().toString(36).slice(2)}` }); return shuffle(a); }
function tileSum(t){ return t.left + t.right; }
function handScore(hand){ return hand.reduce((s,t)=>s + tileSum(t), 0); }
function roundToNearest5(n){ return Math.round(n / 5) * 5; }
function isMultipleOf5(n){ return n > 0 && n % 5 === 0; }

function teamOf(room, playerIndex) {
  if (room.players.length === 4 && room.teamMode) return playerIndex % 2 === 0 ? "teamA" : "teamB";
  return "p" + playerIndex;
}

function scoreOwnerKey(room, player) {
  const idx = room.players.findIndex(p => p.id === player.id);
  return teamOf(room, idx);
}

function assignTeams(room) {
  room.teams = {};
  room.players.forEach((p, idx) => {
    const key = teamOf(room, idx);
    if (!room.teams[key]) room.teams[key] = { score: 0, roundWins: 0, names: [] };
    room.teams[key].names.push(p.name);
  });
}

function doubleRank(tile){ return tile.left === tile.right ? tile.left : -1; }

function chooseStarter(room) {
  let bestIdx = 0;
  let bestDouble = -1;
  room.players.forEach((p, idx) => {
    p.hand.forEach(t => {
      if (t.left === t.right && t.left > bestDouble) {
        bestDouble = t.left;
        bestIdx = idx;
      }
    });
  });
  if (bestDouble >= 0) return bestIdx;

  let bestSum = -1;
  room.players.forEach((p, idx) => {
    const maxSum = Math.max(...p.hand.map(tileSum));
    if (maxSum > bestSum) {
      bestSum = maxSum;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

// Board has up to 4 arms from the center: right, left, top, bottom.
// First tile opens left/right. The first double can expand to top/bottom.
function boardEnds(board) {
  const ends = {};
  for (const side of ["right","left","top","bottom"]) {
    const arm = board.arms[side] || [];
    if (!arm.length) ends[side] = board.center ? openValueOnSide(board.center, side) : null;
    else {
      const last = arm[arm.length - 1];
      ends[side] = last.open;
    }
  }
  return ends;
}

function openValueOnSide(center, side) {
  if (!center) return null;
  if (center.left === center.right) return center.left;
  if (side === "left") return center.left;
  if (side === "right") return center.right;
  return null;
}

function getOpenSides(board) {
  if (!board.center) return [];
  const e = boardEnds(board);
  return Object.entries(e).filter(([side, val]) => val !== null).map(([side, val]) => ({ side, value: val }));
}

function canPlayOnSide(tile, board, side) {
  if (!board.center) return true;
  const e = boardEnds(board);
  const target = e[side];
  if (target === null || target === undefined) return false;
  return tile.left === target || tile.right === target;
}

function anyCanPlay(tile, board) {
  if (!board.center) return true;
  return getOpenSides(board).some(s => tile.left === s.value || tile.right === s.value);
}

function playerHasMove(hand, board) {
  return hand.some(t => anyCanPlay(t, board));
}

function flattenBoard(board) {
  const arr = [];
  if (board.center) arr.push({ ...board.center, side: "center" });
  for (const side of ["right","left","top","bottom"]) {
    for (const t of board.arms[side]) arr.push({ left:t.left, right:t.right, id:t.id, side });
  }
  return arr;
}

function makeBoard() {
  return { center: null, arms: { right: [], left: [], top: [], bottom: [] } };
}

function orientedForSide(tile, openVal, side) {
  // Store open = value exposed after placement.
  if (tile.left === openVal) return { left: tile.left, right: tile.right, id: tile.id, open: tile.right };
  if (tile.right === openVal) return { left: tile.right, right: tile.left, id: tile.id, open: tile.left };
  return null;
}

function placeOnBoard(room, tile, side) {
  const board = room.board;
  if (!board.center) {
    board.center = { left: tile.left, right: tile.right, id: tile.id };
    // First double opens four sides. Non-double opens left/right only.
    return true;
  }
  if (!["right","left","top","bottom"].includes(side)) return false;
  const ends = boardEnds(board);
  const openVal = ends[side];
  if (openVal === null || openVal === undefined) return false;
  const oriented = orientedForSide(tile, openVal, side);
  if (!oriented) return false;
  board.arms[side].push(oriented);
  return true;
}

function openEndScore(board) {
  if (!board.center) return 0;
  const ends = boardEnds(board);
  let sum = 0;
  for (const side of ["right","left","top","bottom"]) {
    if (ends[side] !== null && ends[side] !== undefined) sum += ends[side];
  }
  // If center is double and no arms, count two sides by default as double value * 2.
  if (board.center && board.center.left === board.center.right && !flattenBoard(board).some(t => t.side !== "center")) {
    return board.center.left * 2;
  }
  return sum;
}

function scoreFromMove(board) {
  const s = openEndScore(board);
  return isMultipleOf5(s) ? s : 0;
}

function lobbyState(room) {
  return {
    roomId: room.id,
    targetScore: room.targetScore,
    teamMode: room.teamMode,
    players: room.players.map((p, idx)=>({id:p.id,name:p.name,avatar:p.avatar,isHost:p.isHost,isBot:p.isBot,team:teamOf(room, idx)}))
  };
}
function broadcastLobby(room) { io.to(room.id).emit("lobbyUpdate", lobbyState(room)); }

function publicScores(room) {
  return room.teams || {};
}

function stateFor(room, player) {
  const idx = room.players.findIndex(p => p.id === player.id);
  return {
    roomId: room.id,
    started: room.started,
    board: flattenBoard(room.board),
    boardRaw: room.board,
    openSides: getOpenSides(room.board),
    openScore: openEndScore(room.board),
    boneyardCount: room.boneyard.length,
    currentTurn: room.currentTurn,
    currentPlayerName: room.players[room.currentTurn]?.name || "",
    winner: room.winner,
    gameWinner: room.gameWinner,
    yourHand: player.hand,
    yourTurn: room.players[room.currentTurn]?.id === player.id,
    yourTeam: teamOf(room, idx),
    targetScore: room.targetScore,
    teams: publicScores(room),
    roundNumber: room.roundNumber,
    turnDeadline: room.turnDeadline || null,
    turnSeconds: room.turnDeadline ? Math.max(0, Math.ceil((room.turnDeadline - Date.now())/1000)) : 20,
    lastScore: room.lastScore,
    penalty: room.penalty,
    players: room.players.map((p,i)=>({id:p.id,name:p.name,avatar:p.avatar,tilesCount:p.hand.length,connected:p.connected,isBot:p.isBot,team:teamOf(room,i)}))
  };
}
function broadcastGame(room) {
  room.players.forEach(p => { if (!p.isBot) io.to(p.id).emit("gameState", stateFor(room,p)); });
}

function addBot(room) {
  if (room.players.length >= 4) return null;
  const n = room.players.filter(p=>p.isBot).length + 1;
  const bot = { id:"BOT_"+Math.random().toString(36).slice(2), playerId:null, cleanName:"AI Bot "+n, name:"🤖 AI Bot "+n, avatar:"🤖", hand:[], connected:true, isHost:false, isBot:true };
  room.players.push(bot);
  assignTeams(room);
  return bot;
}

function resetRound(room, starterIndex = null) {
  const all = makeTiles();
  room.players.forEach(p => { p.hand = all.splice(0, 7); });
  room.boneyard = all;
  room.board = makeBoard();
  room.started = true;
  room.winner = null;
  room.gameWinner = null;
  room.lastScore = null;
  room.passes = 0;
  room.roundNumber = (room.roundNumber || 0) + 1;
  room.currentTurn = starterIndex !== null ? starterIndex : chooseStarter(room);
}

function startRoom(room) {
  if (!room || room.players.length < 2) return false;
  if (room.players.length === 3) addBot(room);
  assignTeams(room);
  resetRound(room);
  broadcastGame(room);
  startTurnTimer(room);
  maybeBot(room);
  return true;
}

async function saveGameEnd(room, winnerKey) {
  if (dbReady) {
    try {
      await Match.create({
        roomId: room.id,
        mode: room.mode,
        targetScore: room.targetScore,
        players: room.players.map(p=>p.playerId || p.name),
        finalScores: room.teams,
        winner: winnerKey,
        rounds: room.roundNumber,
        endedAt: new Date()
      });
    } catch {}
  } else {
    localMatches.push({ roomId:room.id, winner:winnerKey, finalScores:room.teams, endedAt:new Date() });
  }

  for (const p of room.players) {
    if (p.isBot || !p.playerId) continue;
    const key = scoreOwnerKey(room, p);
    const profile = await getOrCreatePlayer(p.playerId, p.cleanName || p.name, p.avatar);
    if (key === winnerKey) {
      profile.wins = (profile.wins || 0) + 1;
      profile.coins = (profile.coins || 100) + 50;
      profile.xp = (profile.xp || 0) + 50;
    } else {
      profile.losses = (profile.losses || 0) + 1;
      profile.xp = (profile.xp || 0) + 10;
    }
    profile.rank = rankFromXP(profile.xp);
    if (dbReady && profile.save) await profile.save();
    else localPlayers.set(p.playerId, profile);
  }
}

async function addScore(room, ownerKey, points, reason) {
  if (!points) return;
  if (!room.teams[ownerKey]) room.teams[ownerKey] = { score:0, roundWins:0, names:[] };
  room.teams[ownerKey].score += points;
  room.lastScore = { ownerKey, points, reason, total: room.teams[ownerKey].score };

  if (room.teams[ownerKey].score >= room.targetScore) {
    room.gameWinner = { ownerKey, score: room.teams[ownerKey].score, reason: "target" };
    clearTurnTimer(room);
    room.started = false;
    await saveGameEnd(room, ownerKey);
  }
}

async function endRound(room, winnerPlayer, reason) {
  const winnerKey = scoreOwnerKey(room, winnerPlayer);
  let raw = 0;
  for (const p of room.players) {
    if (p.id !== winnerPlayer.id) raw += handScore(p.hand);
  }
  const rounded = roundToNearest5(raw);
  room.teams[winnerKey].roundWins += 1;
  await addScore(room, winnerKey, rounded, reason === "domino" ? "دۆمینۆ + خڕکردنی خاڵ" : "بردنەوەی ڕاوند");
  room.winner = { name:winnerPlayer.name, reason, raw, rounded, ownerKey:winnerKey };

  if (!room.gameWinner) {
    clearTurnTimer(room);
    room.started = false;
    broadcastGame(room);
    setTimeout(() => {
      // Winner starts next round with a tile of their choice in real life.
      // Here: winner starts next round automatically.
      const idx = room.players.findIndex(p => p.id === winnerPlayer.id);
      resetRound(room, idx >= 0 ? idx : null);
      broadcastGame(room);
      startTurnTimer(room);
      maybeBot(room);
    }, 2500);
  }
}

async function checkEnd(room) {
  const winner = room.players.find(p => p.hand.length === 0);
  if (winner) { await endRound(room, winner, "domino"); return true; }
  if (room.boneyard.length === 0 && room.players.every(p => !playerHasMove(p.hand, room.board))) {
    let best = room.players[0];
    for (const p of room.players) if (handScore(p.hand) < handScore(best.hand)) best = p;
    await endRound(room, best, "blocked");
    return true;
  }
  return false;
}

async function applyPenalty(room, player, amount, reason) {
  const key = scoreOwnerKey(room, player);
  if (!room.teams[key]) return;
  room.teams[key].score = Math.max(0, room.teams[key].score - amount);
  room.penalty = { ownerKey:key, amount, reason };
}

async function playTile(room, player, tileId, side) {
  if (!room || !room.started) return {ok:false, error:"یاری دەستی پێنەکردووە"};
  if (room.players[room.currentTurn]?.id !== player.id) return {ok:false, error:"نۆرەی تۆ نییە"};
  const idx = player.hand.findIndex(t => t.id === tileId);
  if (idx < 0) return {ok:false, error:"دۆمینۆ نەدۆزرایەوە"};
  const tile = {...player.hand[idx]};

  if (!placeOnBoard(room, tile, side)) {
    await applyPenalty(room, player, room.penaltyAmount || 5, "دانانی هەڵە");
    return {ok:false, error:"دانانی هەڵە: سزات لێدرا"};
  }

  player.hand.splice(idx,1);

  const moveScore = scoreFromMove(room.board);
  if (moveScore) await addScore(room, scoreOwnerKey(room, player), moveScore, "مضاعفی 5");

  room.passes = 0;
  if (!(await checkEnd(room))) {
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    broadcastGame(room);
    startTurnTimer(room);
    maybeBot(room);
  } else {
    broadcastGame(room);
  }
  return {ok:true};
}

function botBestMove(room, bot) {
  const moves = [];
  for (const t of bot.hand) {
    for (const s of getOpenSides(room.board)) {
      if (canPlayOnSide(t, room.board, s.side)) {
        const clone = JSON.parse(JSON.stringify(room.board));
        const fakeRoom = { board: clone };
        placeOnBoard(fakeRoom, t, s.side);
        moves.push({ tile:t, side:s.side, score:scoreFromMove(fakeRoom.board), sum:tileSum(t) });
      }
    }
    if (!room.board.center) moves.push({ tile:t, side:"right", score: t.left===t.right ? (t.left*2 % 5===0 ? t.left*2 : 0) : 0, sum:tileSum(t) });
  }
  moves.sort((a,b)=>(b.score-a.score) || (b.sum-a.sum));
  return moves[0];
}

async function botMove(room) {
  if (!room || !room.started) return;
  const bot = room.players[room.currentTurn];
  if (!bot || !bot.isBot) return;

  let move = botBestMove(room, bot);
  if (move) {
    await playTile(room, bot, move.tile.id, move.side);
  } else if (room.boneyard.length) {
    bot.hand.push(room.boneyard.pop());
    broadcastGame(room);
    setTimeout(()=>botMove(room), 450);
  } else {
    room.passes++;
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    if (!(await checkEnd(room))) {
      broadcastGame(room);
      startTurnTimer(room);
      maybeBot(room);
    }
  }
}


function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = null;
}

function startTurnTimer(room) {
  clearTurnTimer(room);
  if (!room || !room.started || room.winner || room.gameWinner) return;
  const current = room.players[room.currentTurn];
  if (!current || current.isBot) return;
  room.turnDeadline = Date.now() + 20000;
  room.turnTimer = setTimeout(async () => {
    try {
      const p = room.players[room.currentTurn];
      if (!p || p.isBot || !room.started) return;
      if (room.boneyard.length && !playerHasMove(p.hand, room.board)) {
        while (room.boneyard.length && !playerHasMove(p.hand, room.board)) {
          p.hand.push(room.boneyard.pop());
          if (playerHasMove(p.hand, room.board)) break;
        }
      }
      if (!playerHasMove(p.hand, room.board) || !room.boneyard.length) {
        room.currentTurn = (room.currentTurn + 1) % room.players.length;
        room.lastScore = { ownerKey: scoreOwnerKey(room, p), points:0, reason:"٢٠ چرکە تەواو بوو؛ نۆرە تێپەڕی" };
        if (!(await checkEnd(room))) {
          broadcastGame(room);
          maybeBot(room);
        }
      } else {
        room.lastScore = { ownerKey: scoreOwnerKey(room, p), points:0, reason:"٢٠ چرکە تەواو بوو؛ دۆمینۆی لە بانک وەرگرت" };
        broadcastGame(room);
        startTurnTimer(room);
      }
    } catch(e) {
      console.log("turn timer error", e.message);
    }
  }, 20000);
}

function maybeBot(room) {
  if (room?.started && room.players[room.currentTurn]?.isBot) setTimeout(()=>botMove(room), 650);
}

app.post("/api/profile", async (req,res) => {
  try {
    const {playerId,name,avatar} = req.body || {};
    const p = await getOrCreatePlayer(playerId, name, avatar);
    res.json({ok:true, dbReady, player:p});
  } catch (e) { res.json({ok:false, error:e.message}); }
});

app.get("/api/profile/:id", async (req,res) => {
  try {
    let p;
    if (dbReady) p = await Player.findOne({playerId:req.params.id});
    else p = localPlayers.get(req.params.id);
    res.json({ok:true, dbReady, player:p || null});
  } catch (e) { res.json({ok:false, error:e.message}); }
});

app.get("/api/leaderboard", async (req,res) => {
  try {
    let players;
    if (dbReady) players = await Player.find({}).sort({xp:-1, coins:-1}).limit(50).lean();
    else players = Array.from(localPlayers.values()).sort((a,b)=>(b.xp||0)-(a.xp||0)).slice(0,50);
    res.json({ok:true, dbReady, players});
  } catch (e) { res.json({ok:false, players:[], error:e.message}); }
});

io.on("connection", socket => {
  socket.on("register", async ({playerId,name,avatar}={}) => {
    socket.data.playerId = playerId || "guest_"+socket.id;
    socket.data.cleanName = name || "Player";
    socket.data.avatar = avatar || "🎲";
    await getOrCreatePlayer(socket.data.playerId, socket.data.cleanName, socket.data.avatar);
    socket.emit("registered", {ok:true});
  });

  socket.on("createRoom", ({playerName,targetScore=350,teamMode=true}={}) => {
    const id = code();
    const room = {
      id, players:[], board:makeBoard(), boneyard:[], currentTurn:0, started:false,
      winner:null, gameWinner:null, passes:0, mode:"room", roundNumber:0,
      targetScore: Number(targetScore) === 450 ? 450 : 350,
      teamMode: !!teamMode, teams:{}, lastScore:null, penalty:null, penaltyAmount:5
    };
    room.players.push({ id:socket.id, playerId:socket.data.playerId, cleanName:socket.data.cleanName, name:playerName || `${socket.data.avatar||"🎲"} ${socket.data.cleanName||"Player"}`, avatar:socket.data.avatar||"🎲", hand:[], connected:true, isHost:true, isBot:false });
    rooms[id] = room;
    assignTeams(room);
    socket.join(id);
    socket.data.roomId = id;
    socket.emit("roomCreated", {roomId:id, playerId:socket.id});
    broadcastLobby(room);
  });

  socket.on("joinRoom", ({roomId,playerName}={}) => {
    const room = rooms[String(roomId || "").toUpperCase()];
    if (!room) return socket.emit("error", {message:"ژوور نەدۆزرایەوە"});
    if (room.started) return socket.emit("error", {message:"یاری دەستی پێکردووە"});
    if (room.players.length >= 4) return socket.emit("error", {message:"ژوور پڕە"});
    room.players.push({ id:socket.id, playerId:socket.data.playerId, cleanName:socket.data.cleanName, name:playerName || `${socket.data.avatar||"🎲"} ${socket.data.cleanName||"Player"}`, avatar:socket.data.avatar||"🎲", hand:[], connected:true, isHost:false, isBot:false });
    assignTeams(room);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.emit("roomJoined", {roomId:room.id, playerId:socket.id});
    broadcastLobby(room);
  });

  socket.on("findMatch", ({targetScore=350}={}) => {
    const player = { id:socket.id, playerId:socket.data.playerId, cleanName:socket.data.cleanName, name:`${socket.data.avatar||"🎲"} ${socket.data.cleanName||"Player"}`, avatar:socket.data.avatar||"🎲", hand:[], connected:true, isHost:true, isBot:false };
    const other = queue.shift();
    if (other && io.sockets.sockets.get(other.id)) {
      const id = code();
      const room = { id, players:[other, {...player,isHost:false}], board:makeBoard(), boneyard:[], currentTurn:0, started:false, winner:null, gameWinner:null, passes:0, mode:"matchmaking", roundNumber:0, targetScore:Number(targetScore)===450?450:350, teamMode:false, teams:{}, lastScore:null, penalty:null, penaltyAmount:5 };
      rooms[id] = room;
      assignTeams(room);
      for (const p of room.players) {
        const s = io.sockets.sockets.get(p.id);
        if (s) { s.join(id); s.data.roomId = id; s.emit("roomJoined", {roomId:id, playerId:p.id}); }
      }
      broadcastLobby(room);
      startRoom(room);
    } else {
      queue.push(player);
      socket.emit("queueStatus", {waiting:true});
      setTimeout(() => {
        const idx = queue.findIndex(p => p.id === socket.id);
        if (idx >= 0) {
          queue.splice(idx,1);
          const id = code();
          const room = { id, players:[player], board:makeBoard(), boneyard:[], currentTurn:0, started:false, winner:null, gameWinner:null, passes:0, mode:"botFallback", roundNumber:0, targetScore:Number(targetScore)===450?450:350, teamMode:false, teams:{}, lastScore:null, penalty:null, penaltyAmount:5 };
          rooms[id] = room;
          socket.join(id);
          socket.data.roomId = id;
          addBot(room);
          assignTeams(room);
          socket.emit("roomJoined", {roomId:id, playerId:socket.id});
          broadcastLobby(room);
          startRoom(room);
        }
      }, 5000);
    }
  });

  socket.on("addBot", () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.started) return;
    addBot(room);
    assignTeams(room);
    broadcastLobby(room);
  });

  socket.on("startGame", () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    while (room.players.length < 2) addBot(room);
    if (room.players.length === 3) addBot(room);
    startRoom(room);
  });

  socket.on("playTile", async ({tileId,side}={}) => {
    const room = rooms[socket.data.roomId];
    const player = room?.players.find(p => p.id === socket.id);
    if (!player) return socket.emit("error", {message:"یاریزان نەدۆزرایەوە"});
    const result = await playTile(room, player, tileId, side || "right");
    if (!result.ok) {
      socket.emit("error", {message:result.error});
      broadcastGame(room);
    }
  });

  socket.on("drawTile", async () => {
    const room = rooms[socket.data.roomId];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || !room.started) return;
    if (room.players[room.currentTurn]?.id !== player.id) return;
    if (!room.boneyard.length) {
      room.currentTurn = (room.currentTurn + 1) % room.players.length;
      broadcastGame(room);
      startTurnTimer(room);
      maybeBot(room);
      return;
    }
    // Pro rule: draw until playable or bank empty.
    let drawn = 0;
    while (room.boneyard.length && !playerHasMove(player.hand, room.board)) {
      player.hand.push(room.boneyard.pop());
      drawn++;
      if (playerHasMove(player.hand, room.board)) break;
    }
    if (!playerHasMove(player.hand, room.board) && !room.boneyard.length) {
      room.currentTurn = (room.currentTurn + 1) % room.players.length;
    }
    room.lastScore = { ownerKey: scoreOwnerKey(room, player), points:0, reason:`لە بانک ${drawn} دۆمینۆی وەرگرت` };
    broadcastGame(room);
    startTurnTimer(room);
    maybeBot(room);
  });

  socket.on("passTurn", async () => {
    const room = rooms[socket.data.roomId];
    const player = room?.players.find(p => p.id === socket.id);
    if (!room || !player || !room.started) return;
    if (room.players[room.currentTurn]?.id !== player.id) return;
    if (playerHasMove(player.hand, room.board)) {
      await applyPenalty(room, player, room.penaltyAmount || 5, "پاس بەبێ هۆ");
      socket.emit("error", {message:"دۆمینۆی گونجاوت هەیە؛ سزات لێدرا"});
      broadcastGame(room);
      return;
    }
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    if (!(await checkEnd(room))) {
      broadcastGame(room);
      startTurnTimer(room);
      maybeBot(room);
    }
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.data.roomId];
    if (!room) return;
    const p = room.players.find(x => x.id === socket.id);
    if (p) { p.connected = false; broadcastGame(room); }
  });
});

server.listen(PORT, () => console.log("Kurdish Domino Pro Rules V3 running on port " + PORT));