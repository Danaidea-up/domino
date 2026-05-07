// ============================================
// 🎲 Domino World - Professional Server
// Features: Chat, Reconnection, Persistent Sessions
// ============================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const matchmakingQueue = [];
const sessions = {};
const socketToSession = {};

function createDominoSet() {
  const tiles = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) tiles.push({ left: i, right: j, id: `${i}-${j}` });
  }
  return tiles;
}
function shuffle(a) { for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }
function getBoardEnds(b) { return b.length === 0 ? {left:null,right:null} : {left:b[0].left, right:b[b.length-1].right}; }
function canPlayTile(t, b) {
  if (b.length === 0) return {left:true,right:true};
  const e = getBoardEnds(b);
  return { left: t.left===e.left || t.right===e.left, right: t.left===e.right || t.right===e.right };
}
function playerCanPlay(h, b) {
  if (b.length === 0) return true;
  return h.some(t => { const c = canPlayTile(t,b); return c.left || c.right; });
}
function pipCount(h) { return h.reduce((s,t)=>s+t.left+t.right,0); }
function genCode() { return Math.random().toString(36).substring(2,6).toUpperCase(); }
function genId() { return crypto.randomBytes(8).toString('hex'); }

function createRoom(roomId, opts = {}) {
  rooms[roomId] = {
    id: roomId, players: [], board: [], boneyard: [], currentTurn: 0,
    started: false, winner: null, isPrivate: opts.isPrivate ?? true,
    isQuickMatch: opts.isQuickMatch ?? false, scores: {}, round: 1,
    targetScore: opts.targetScore || 100, aiDifficulty: opts.aiDifficulty || 'medium',
    botTimers: {}, chatHistory: [], createdAt: Date.now()
  };
  return rooms[roomId];
}

function startRound(roomId) {
  const room = rooms[roomId];
  if (!room || room.players.length < 2) return;
  Object.values(room.botTimers || {}).forEach(t => clearTimeout(t));
  room.botTimers = {};
  const allTiles = shuffle(createDominoSet());
  const tilesPerPlayer = room.players.length === 2 ? 7 : 6;
  room.players.forEach(p => {
    p.hand = allTiles.splice(0, tilesPerPlayer);
    if (!(p.id in room.scores)) room.scores[p.id] = 0;
  });
  room.boneyard = allTiles;
  room.board = [];
  room.started = true;
  room.winner = null;
  room.passes = 0;
  room.lastMove = null;
  let startIdx = 0, highest = -1;
  room.players.forEach((p, idx) => {
    p.hand.forEach(t => {
      if (t.left === t.right && t.left > highest) { highest = t.left; startIdx = idx; }
    });
  });
  room.currentTurn = startIdx;
  addChatMessage(roomId, null, `🎮 ڕاوندی ${room.round} دەستی پێکرد!`, true);
  broadcastGameState(roomId);
  scheduleAIMove(roomId);
}

function broadcastGameState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const baseState = {
    roomId, started: room.started, board: room.board,
    boneyardCount: room.boneyard.length, currentTurn: room.currentTurn,
    currentPlayerName: room.players[room.currentTurn]?.name,
    winner: room.winner, round: room.round, targetScore: room.targetScore,
    lastMove: room.lastMove,
    players: room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, level: p.level || 1,
      isBot: p.isBot, tilesCount: p.hand.length, connected: p.connected,
      score: room.scores[p.id] || 0
    }))
  };
  room.players.forEach(player => {
    if (player.isBot || !player.connected) return;
    io.to(player.id).emit('gameState', {
      ...baseState, yourHand: player.hand,
      yourTurn: room.players[room.currentTurn]?.id === player.id
    });
  });
}

function checkRoundEnd(roomId) {
  const room = rooms[roomId];
  if (!room) return false;
  const winner = room.players.find(p => p.hand.length === 0);
  if (winner) {
    const points = room.players.filter(p => p.id !== winner.id).reduce((s,p) => s + pipCount(p.hand), 0);
    room.scores[winner.id] = (room.scores[winner.id] || 0) + points;
    room.winner = { playerId: winner.id, name: winner.name, reason: 'empty', points,
      gameOver: room.scores[winner.id] >= room.targetScore };
    room.started = false;
    return true;
  }
  const allBlocked = room.players.every(p => !playerCanPlay(p.hand, room.board));
  if (allBlocked && room.boneyard.length === 0) {
    let minPips = Infinity, blockWinner = null;
    room.players.forEach(p => {
      const pips = pipCount(p.hand);
      if (pips < minPips) { minPips = pips; blockWinner = p; }
    });
    const points = room.players.filter(p => p.id !== blockWinner.id).reduce((s,p) => s + pipCount(p.hand), 0);
    room.scores[blockWinner.id] = (room.scores[blockWinner.id] || 0) + points;
    room.winner = { playerId: blockWinner.id, name: blockWinner.name, reason: 'block',
      pips: minPips, points, gameOver: room.scores[blockWinner.id] >= room.targetScore };
    room.started = false;
    return true;
  }
  return false;
}

function aiSelectMove(player, board, difficulty) {
  const moves = [];
  for (const tile of player.hand) {
    const can = canPlayTile(tile, board);
    if (can.left) moves.push({ tile, side: 'left' });
    if (can.right) moves.push({ tile, side: 'right' });
  }
  if (moves.length === 0) return null;
  if (difficulty === 'easy') return moves[Math.floor(Math.random()*moves.length)];
  if (difficulty === 'medium') {
    moves.sort((a,b) => (b.tile.left+b.tile.right) - (a.tile.left+a.tile.right));
    return moves[0];
  }
  const scored = moves.map(move => {
    let score = (move.tile.left + move.tile.right) * 2;
    if (move.tile.left === move.tile.right) score += 5;
    let newBoard = [...board];
    const tile = move.tile;
    if (newBoard.length === 0) newBoard = [tile];
    else {
      const ends = getBoardEnds(newBoard);
      if (move.side === 'left') {
        if (tile.right === ends.left) newBoard = [tile, ...newBoard];
        else newBoard = [{left:tile.right,right:tile.left,id:tile.id}, ...newBoard];
      } else {
        if (tile.left === ends.right) newBoard = [...newBoard, tile];
        else newBoard = [...newBoard, {left:tile.right,right:tile.left,id:tile.id}];
      }
    }
    const newEnds = getBoardEnds(newBoard);
    const myMatches = player.hand.filter(t => t.id !== tile.id && (
      t.left===newEnds.left || t.right===newEnds.left || t.left===newEnds.right || t.right===newEnds.right
    )).length;
    score += myMatches * 3;
    return { ...move, score };
  });
  scored.sort((a,b) => b.score - a.score);
  return scored[0];
}

function executeAIMove(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started) return;
  const player = room.players[room.currentTurn];
  if (!player || !player.isBot) return;
  const move = aiSelectMove(player, room.board, room.aiDifficulty);
  if (move) {
    const tile = { ...move.tile };
    const tileIdx = player.hand.findIndex(t => t.id === tile.id);
    if (room.board.length === 0) room.board.push(tile);
    else {
      const ends = getBoardEnds(room.board);
      if (move.side === 'left') {
        if (tile.right === ends.left) room.board.unshift(tile);
        else room.board.unshift({left:tile.right,right:tile.left,id:tile.id});
      } else {
        if (tile.left === ends.right) room.board.push(tile);
        else room.board.push({left:tile.right,right:tile.left,id:tile.id});
      }
    }
    player.hand.splice(tileIdx, 1);
    room.lastMove = { playerId: player.id, action: 'play', side: move.side, tile };
    room.passes = 0;
    if (!checkRoundEnd(roomId)) room.currentTurn = (room.currentTurn+1) % room.players.length;
    broadcastGameState(roomId);
    scheduleAIMove(roomId);
  } else {
    if (room.boneyard.length > 0) {
      const tile = room.boneyard.pop();
      player.hand.push(tile);
      room.lastMove = { playerId: player.id, action: 'draw' };
      broadcastGameState(roomId);
      const t = setTimeout(() => executeAIMove(roomId), 1000);
      room.botTimers[player.id] = t;
    } else {
      room.lastMove = { playerId: player.id, action: 'pass' };
      room.passes = (room.passes || 0) + 1;
      if (!checkRoundEnd(roomId)) room.currentTurn = (room.currentTurn+1) % room.players.length;
      broadcastGameState(roomId);
      scheduleAIMove(roomId);
    }
  }
}

function scheduleAIMove(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started) return;
  const player = room.players[room.currentTurn];
  if (!player || !player.isBot) return;
  const delay = 1200 + Math.random()*800;
  room.botTimers[player.id] = setTimeout(() => executeAIMove(roomId), delay);
}

function addBotsToRoom(roomId, count, difficulty='medium') {
  const room = rooms[roomId];
  if (!room) return;
  const names = ['🤖 ئەمیر', '🤖 سارا', '🤖 دیاکۆ', '🤖 ڕێژین'];
  const avatars = ['🤖','👾','🎮','🦾'];
  for (let i = 0; i < count && room.players.length < 4; i++) {
    const idx = room.players.length;
    room.players.push({
      id: `bot_${roomId}_${idx}_${Date.now()}`,
      name: names[idx % names.length], avatar: avatars[idx % avatars.length],
      isBot: true, hand: [], connected: true, isHost: false, level: 5
    });
  }
  room.aiDifficulty = difficulty;
}

function addChatMessage(roomId, senderId, text, isSystem=false, emoji=null) {
  const room = rooms[roomId];
  if (!room) return;
  const sender = senderId ? room.players.find(p => p.id === senderId) : null;
  const msg = {
    id: genId(), senderId,
    senderName: sender?.name || 'سیستەم',
    senderAvatar: sender?.avatar, text, emoji, isSystem, timestamp: Date.now()
  };
  room.chatHistory.push(msg);
  if (room.chatHistory.length > 50) room.chatHistory.shift();
  io.to(roomId).emit('chatMessage', msg);
}

function tryMatchmake() {
  while (matchmakingQueue.length >= 2) {
    const p1 = matchmakingQueue.shift();
    const p2 = matchmakingQueue.shift();
    let roomId;
    do { roomId = genCode(); } while (rooms[roomId]);
    const room = createRoom(roomId, { isPrivate: false, isQuickMatch: true });
    [p1, p2].forEach((p, i) => {
      room.players.push({
        id: p.socketId, name: p.playerName, avatar: p.avatar, level: p.level || 1,
        sessionId: p.sessionId, hand: [], connected: true, isHost: i===0, isBot: false
      });
    });
    [p1, p2].forEach(p => {
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) {
        sock.join(roomId);
        sock.data.roomId = roomId;
        if (sessions[p.sessionId]) sessions[p.sessionId].roomId = roomId;
        io.to(p.socketId).emit('matchFound', { roomId });
      }
    });
    setTimeout(() => startRound(roomId), 1500);
  }
}

function checkQuickMatchTimeout(socketId) {
  const idx = matchmakingQueue.findIndex(p => p.socketId === socketId);
  if (idx === -1) return;
  const player = matchmakingQueue.splice(idx, 1)[0];
  let roomId;
  do { roomId = genCode(); } while (rooms[roomId]);
  const room = createRoom(roomId, { isPrivate: false, isQuickMatch: true });
  room.players.push({
    id: player.socketId, name: player.playerName, avatar: player.avatar,
    level: player.level || 1, sessionId: player.sessionId,
    hand: [], connected: true, isHost: true, isBot: false
  });
  addBotsToRoom(roomId, 1, 'medium');
  const sock = io.sockets.sockets.get(player.socketId);
  if (sock) {
    sock.join(roomId);
    sock.data.roomId = roomId;
    if (sessions[player.sessionId]) sessions[player.sessionId].roomId = roomId;
    io.to(player.socketId).emit('matchFound', { roomId, withBot: true });
  }
  setTimeout(() => startRound(roomId), 1500);
}

function tryReconnect(socket, sessionId) {
  const session = sessions[sessionId];
  if (!session || !session.roomId) return false;
  const room = rooms[session.roomId];
  if (!room) return false;
  const player = room.players.find(p => p.sessionId === sessionId);
  if (!player) return false;
  
  const oldSocketId = player.id;
  player.id = socket.id;
  player.connected = true;
  if (room.scores[oldSocketId] !== undefined) {
    room.scores[player.id] = room.scores[oldSocketId];
    delete room.scores[oldSocketId];
  }
  session.socketId = socket.id;
  session.lastSeen = Date.now();
  socketToSession[socket.id] = sessionId;
  socket.join(session.roomId);
  socket.data.roomId = session.roomId;
  
  socket.emit('reconnected', { 
    roomId: session.roomId, started: room.started,
    chatHistory: room.chatHistory 
  });
  
  if (room.started) broadcastGameState(session.roomId);
  else broadcastLobby(session.roomId);
  
  addChatMessage(session.roomId, null, `${player.name} گەڕایەوە! 👋`, true);
  return true;
}

io.on('connection', (socket) => {
  socket.emit('stats', { onlinePlayers: io.sockets.sockets.size, activeRooms: Object.keys(rooms).length });

  socket.on('initSession', ({ sessionId, playerName, avatar, level }) => {
    if (sessionId && sessions[sessionId]) {
      if (tryReconnect(socket, sessionId)) return;
      sessions[sessionId].socketId = socket.id;
      sessions[sessionId].playerName = playerName;
      sessions[sessionId].avatar = avatar;
      sessions[sessionId].lastSeen = Date.now();
      socketToSession[socket.id] = sessionId;
      socket.emit('sessionReady', { sessionId });
      return;
    }
    const newSessionId = sessionId || genId();
    sessions[newSessionId] = {
      socketId: socket.id, roomId: null, playerName, avatar, level: level || 1, lastSeen: Date.now()
    };
    socketToSession[socket.id] = newSessionId;
    socket.emit('sessionReady', { sessionId: newSessionId });
  });

  socket.on('quickMatch', ({ playerName, avatar, level }) => {
    const sessionId = socketToSession[socket.id];
    matchmakingQueue.push({ socketId: socket.id, playerName, avatar, level, sessionId });
    socket.emit('searching');
    tryMatchmake();
    setTimeout(() => checkQuickMatchTimeout(socket.id), 8000);
  });

  socket.on('cancelQuickMatch', () => {
    const idx = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
  });

  socket.on('playVsAI', ({ playerName, avatar, level, difficulty, numBots }) => {
    let roomId;
    do { roomId = genCode(); } while (rooms[roomId]);
    const room = createRoom(roomId, { isPrivate: false, aiDifficulty: difficulty });
    const sessionId = socketToSession[socket.id];
    room.players.push({
      id: socket.id, name: playerName, avatar, level: level || 1,
      sessionId, hand: [], connected: true, isHost: true, isBot: false
    });
    addBotsToRoom(roomId, numBots || 1, difficulty || 'medium');
    socket.join(roomId);
    socket.data.roomId = roomId;
    if (sessions[sessionId]) sessions[sessionId].roomId = roomId;
    socket.emit('roomCreated', { roomId, isVsAI: true });
    setTimeout(() => startRound(roomId), 1000);
  });

  socket.on('createRoom', ({ playerName, avatar, level, targetScore }) => {
    let roomId;
    do { roomId = genCode(); } while (rooms[roomId]);
    const room = createRoom(roomId, { isPrivate: true, targetScore });
    const sessionId = socketToSession[socket.id];
    room.players.push({
      id: socket.id, name: playerName, avatar, level: level || 1,
      sessionId, hand: [], connected: true, isHost: true, isBot: false
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    if (sessions[sessionId]) sessions[sessionId].roomId = roomId;
    socket.emit('roomCreated', { roomId, isPrivate: true });
    broadcastLobby(roomId);
  });

  socket.on('joinRoom', ({ roomId, playerName, avatar, level }) => {
    roomId = roomId.toUpperCase();
    const room = rooms[roomId];
    if (!room) return socket.emit('error', { message: 'ژوورەکە نییە!' });
    if (room.started) return socket.emit('error', { message: 'یاریەکە دەستی پێکردووە!' });
    if (room.players.length >= 4) return socket.emit('error', { message: 'ژوورەکە پڕە!' });
    const sessionId = socketToSession[socket.id];
    room.players.push({
      id: socket.id, name: playerName, avatar, level: level || 1,
      sessionId, hand: [], connected: true, isHost: false, isBot: false
    });
    socket.join(roomId);
    socket.data.roomId = roomId;
    if (sessions[sessionId]) sessions[sessionId].roomId = roomId;
    socket.emit('roomJoined', { roomId });
    broadcastLobby(roomId);
    addChatMessage(roomId, null, `${playerName} پەیوەست بوو 👋`, true);
  });

  socket.on('startGame', ({ addBots, difficulty } = {}) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return socket.emit('error', { message: 'تەنها هۆست!' });
    if (addBots && room.players.length < 4) addBotsToRoom(roomId, 1, difficulty || 'medium');
    if (room.players.length < 2) return socket.emit('error', { message: 'پێویستی بە ٢ یاریزان!' });
    startRound(roomId);
  });

  socket.on('playTile', ({ tileId, side }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || !room.started) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentTurn) return socket.emit('error', { message: 'نۆرەی تۆ نییە!' });
    const player = room.players[playerIdx];
    const tileIdx = player.hand.findIndex(t => t.id === tileId);
    if (tileIdx === -1) return;
    const tile = { ...player.hand[tileIdx] };
    if (room.board.length === 0) room.board.push(tile);
    else {
      const ends = getBoardEnds(room.board);
      if (side === 'left') {
        if (tile.right === ends.left) room.board.unshift(tile);
        else if (tile.left === ends.left) room.board.unshift({left:tile.right,right:tile.left,id:tile.id});
        else return socket.emit('error', { message: 'ناگونجێت!' });
      } else {
        if (tile.left === ends.right) room.board.push(tile);
        else if (tile.right === ends.right) room.board.push({left:tile.right,right:tile.left,id:tile.id});
        else return socket.emit('error', { message: 'ناگونجێت!' });
      }
    }
    player.hand.splice(tileIdx, 1);
    room.lastMove = { playerId: player.id, action: 'play', side, tile };
    room.passes = 0;
    if (!checkRoundEnd(roomId)) room.currentTurn = (room.currentTurn+1) % room.players.length;
    broadcastGameState(roomId);
    scheduleAIMove(roomId);
  });

  socket.on('drawTile', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || !room.started) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentTurn) return;
    if (room.boneyard.length === 0) return socket.emit('error', { message: 'نەماوە!' });
    const tile = room.boneyard.pop();
    room.players[playerIdx].hand.push(tile);
    room.lastMove = { playerId: socket.id, action: 'draw' };
    broadcastGameState(roomId);
  });

  socket.on('passTurn', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || !room.started) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentTurn) return;
    const player = room.players[playerIdx];
    if (room.boneyard.length > 0) return socket.emit('error', { message: 'سەرەتا وەربگرە!' });
    if (playerCanPlay(player.hand, room.board)) return socket.emit('error', { message: 'دۆمینۆی گونجاوت هەیە!' });
    room.passes = (room.passes || 0) + 1;
    room.lastMove = { playerId: socket.id, action: 'pass' };
    if (!checkRoundEnd(roomId)) room.currentTurn = (room.currentTurn+1) % room.players.length;
    broadcastGameState(roomId);
    scheduleAIMove(roomId);
  });

  socket.on('nextRound', () => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;
    if (room.winner && room.winner.gameOver) {
      room.scores = {};
      room.round = 1;
    } else {
      room.round++;
    }
    startRound(roomId);
  });

  socket.on('sendChat', ({ text, emoji }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (!player.chatTimes) player.chatTimes = [];
    const now = Date.now();
    player.chatTimes = player.chatTimes.filter(t => now - t < 10000);
    if (player.chatTimes.length >= 5) {
      return socket.emit('error', { message: '⏱️ زۆر خێرا پەیام دەنێریت!' });
    }
    player.chatTimes.push(now);
    const cleanText = (text || '').toString().trim().substring(0, 200);
    if (!cleanText && !emoji) return;
    addChatMessage(roomId, socket.id, cleanText, false, emoji);
  });

  socket.on('leaveRoom', () => handleLeave(socket, true));
  socket.on('disconnect', () => {
    const qIdx = matchmakingQueue.findIndex(p => p.socketId === socket.id);
    if (qIdx !== -1) matchmakingQueue.splice(qIdx, 1);
    handleLeave(socket, false);
  });
});

function handleLeave(socket, intentional) {
  const roomId = socket.data.roomId;
  if (!roomId || !rooms[roomId]) return;
  const room = rooms[roomId];
  const playerIdx = room.players.findIndex(p => p.id === socket.id);
  if (playerIdx === -1) return;
  const player = room.players[playerIdx];

  if (intentional) {
    room.players.splice(playerIdx, 1);
    if (room.players.filter(p => !p.isBot).length === 0) {
      Object.values(room.botTimers || {}).forEach(t => clearTimeout(t));
      delete rooms[roomId];
      return;
    }
    if (!room.players.some(p => p.isHost && !p.isBot)) {
      const human = room.players.find(p => !p.isBot);
      if (human) human.isHost = true;
    }
    if (room.started) {
      addChatMessage(roomId, null, `${player.name} لە یاری دەرچوو 👋`, true);
      broadcastGameState(roomId);
    } else {
      broadcastLobby(roomId);
    }
    socket.data.roomId = null;
    if (player.sessionId && sessions[player.sessionId]) sessions[player.sessionId].roomId = null;
  } else {
    if (room.started) {
      player.connected = false;
      addChatMessage(roomId, null, `${player.name} پەیوەندی پچڕا - چاوەڕێی گەڕانەوە... 🔌`, true);
      broadcastGameState(roomId);
      setTimeout(() => {
        const stillRoom = rooms[roomId];
        if (!stillRoom) return;
        const stillPlayer = stillRoom.players.find(p => p.sessionId === player.sessionId);
        if (stillPlayer && !stillPlayer.connected) {
          const idx = stillRoom.players.indexOf(stillPlayer);
          stillRoom.players.splice(idx, 1);
          if (stillRoom.players.filter(p => !p.isBot && p.connected).length === 0) {
            Object.values(stillRoom.botTimers || {}).forEach(t => clearTimeout(t));
            delete rooms[roomId];
          } else {
            addChatMessage(roomId, null, `${stillPlayer.name} گەڕایەوە نا 😔`, true);
            broadcastGameState(roomId);
          }
        }
      }, 60000);
    } else {
      room.players.splice(playerIdx, 1);
      if (room.players.filter(p => !p.isBot).length === 0) {
        delete rooms[roomId];
        return;
      }
      if (!room.players.some(p => p.isHost && !p.isBot)) {
        const human = room.players.find(p => !p.isBot);
        if (human) human.isHost = true;
      }
      broadcastLobby(roomId);
    }
  }
}

function broadcastLobby(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('lobbyUpdate', {
    roomId, targetScore: room.targetScore,
    players: room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, level: p.level || 1,
      isHost: p.isHost, isBot: p.isBot
    }))
  });
}

setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach(sid => {
    if (now - sessions[sid].lastSeen > 24*60*60*1000) delete sessions[sid];
  });
}, 60*60*1000);

setInterval(() => {
  io.emit('stats', { onlinePlayers: io.sockets.sockets.size, activeRooms: Object.keys(rooms).length });
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎲 Domino World - port ${PORT}`);
});
