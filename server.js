// ============================================
// 🎲 Kurdish Domino - Server
// Rules: 4-direction first double, multiples of 5,
//        teams 2v2, end-round counting
// ============================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/leaderboard', async (req, res) => {
  const board = await db.getLeaderboard(100);
  res.json({ leaderboard: board, hasDB: db.isConnected() });
});

app.get('/api/stats', async (req, res) => {
  const stats = await db.getTotalStats();
  res.json(stats);
});

// ===== STATE =====
const rooms = {};
const matchmakingQueue = [];
const sessions = {};
const socketToSession = {};

// ===== Domino Logic =====
function createDominoSet() {
  const tiles = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) tiles.push({ left: i, right: j, id: `${i}-${j}` });
  }
  return tiles; // 28 tiles
}

function shuffle(a) { 
  for (let i = a.length-1; i > 0; i--) { 
    const j = Math.floor(Math.random()*(i+1)); 
    [a[i],a[j]] = [a[j],a[i]]; 
  } 
  return a; 
}

function isDouble(tile) { return tile.left === tile.right; }

function pipCount(hand) {
  return hand.reduce((s, t) => s + t.left + t.right, 0);
}

// Round to nearest multiple of 5
function roundToFive(n) {
  const remainder = n % 5;
  if (remainder === 0) return n;
  if (remainder >= 3) return n + (5 - remainder);  // 13 -> 15
  return n - remainder;  // 12 -> 10
}

// ===== Board Management (4-direction Kurdish style) =====
// Board structure:
// {
//   center: tile,           // First tile (the double that started)
//   right: [tiles],         // Right branch (in order from center)
//   left: [tiles],          // Left branch
//   up: [tiles],            // Up branch (only if first tile was double)
//   down: [tiles],          // Down branch (only if first tile was double)
//   isFourDirectional: true/false
//   ends: { right, left, up, down } // Current open numbers
// }

function createEmptyBoard() {
  return {
    center: null,
    right: [], left: [], up: [], down: [],
    isFourDirectional: false,
    ends: { right: null, left: null, up: null, down: null }
  };
}

// Get the open number at the end of a branch
function getBranchEnd(board, direction) {
  if (!board.center) return null;
  const branch = board[direction];
  if (branch.length === 0) {
    // No tiles in branch - need to match the side of center facing this direction
    if (direction === 'right') return board.center.right;
    if (direction === 'left') return board.center.left;
    // For up/down, only available if 4-directional
    if (!board.isFourDirectional) return null;
    return board.center.left; // doubles, both sides equal
  }
  // Last tile of the branch
  const lastTile = branch[branch.length - 1];
  // The "outer" end of the last tile
  return lastTile._outerEnd;
}

function recalculateEnds(board) {
  if (!board.center) {
    board.ends = { right: null, left: null, up: null, down: null };
    return;
  }
  board.ends.right = getBranchEnd(board, 'right');
  board.ends.left = getBranchEnd(board, 'left');
  if (board.isFourDirectional) {
    board.ends.up = getBranchEnd(board, 'up');
    board.ends.down = getBranchEnd(board, 'down');
  } else {
    board.ends.up = null;
    board.ends.down = null;
  }
}

// Calculate sum of all open ends (for scoring)
function calculateOpenEndsSum(board) {
  if (!board.center) return 0;
  
  let sum = 0;
  
  // Helper: a double counts as both numbers (its full pip count)
  // i.e., 5|5 counts as 10, even at end
  
  // Check each direction
  ['right', 'left', 'up', 'down'].forEach(dir => {
    const branch = board[dir];
    if (board.ends[dir] === null) return;
    
    if (branch.length === 0) {
      // No tile placed yet in this direction; the center's side is open
      // This only happens when 4-directional and no extension yet
      if (board.isFourDirectional && isDouble(board.center)) {
        // Each side of the double is one of its values
        sum += board.center.left;
      }
    } else {
      // The last tile in the branch - check if it's a "double-end"
      const lastTile = branch[branch.length - 1];
      if (isDouble(lastTile)) {
        // Double counts as both numbers
        sum += lastTile.left + lastTile.right;
      } else {
        // Just the outer end
        sum += lastTile._outerEnd;
      }
    }
  });
  
  // Special case: empty board with first tile being a double NOT yet extended
  // For first move scoring, we need to handle: 5|5 played first = 10 points (4 directions sum to 5+5+5+5=20, but actually it's just the double = 10)
  // Wait: per rules, doubles count twice. 5|5 has 4 sides all showing 5, but it's still scored as 10 (the double itself)
  // Actually looking again: when 5|5 is placed first, the OPEN ENDS are 5, 5, 5, 5 = 20 (not a multiple of 5 wait yes 20 is multiple of 5)
  // Hmm, but rule 13 example 1 says "Open ends: 5, 5; Total: 10" - this is 2-direction case
  // For 4-directional, it would be 5+5+5+5 = 20
  // Let me re-read... rules don't explicitly cover the very first move 4-direction case.
  // I'll interpret: when only the center double exists with no extensions, each direction shows one of its numbers
  // So 5|5 alone in 4-dir = 5+5+5+5 = 20 points
  
  // Special case: 2-direction first move (non-double tile)
  if (!board.isFourDirectional && board.right.length === 0 && board.left.length === 0) {
    // First move was non-double, just placed center
    // Open ends are: center.right and center.left
    sum = board.center.right + board.center.left;
  }
  
  // Special case: 4-direction first move with no extensions
  if (board.isFourDirectional && board.right.length === 0 && board.left.length === 0 
      && board.up.length === 0 && board.down.length === 0) {
    // The double shows on all 4 sides
    sum = board.center.left * 2 + board.center.right * 2; // Same number 4 times
  }
  
  return sum;
}

// Check if tile can be played at a specific direction
function canPlayAt(tile, board, direction) {
  if (!board.center) return true; // First move - any tile, any direction (only "right" used as default)
  
  const end = board.ends[direction];
  if (end === null || end === undefined) {
    // Direction not available
    if ((direction === 'up' || direction === 'down') && !board.isFourDirectional) {
      return false;
    }
    return false;
  }
  
  return tile.left === end || tile.right === end;
}

// Get all valid moves for a tile
function getValidMoves(tile, board) {
  const moves = [];
  if (!board.center) {
    moves.push({ direction: 'first', tile });
    return moves;
  }
  
  ['right', 'left', 'up', 'down'].forEach(dir => {
    if (canPlayAt(tile, board, dir)) {
      moves.push({ direction: dir, tile });
    }
  });
  return moves;
}

function playerCanPlay(hand, board) {
  if (!board.center) return true;
  return hand.some(t => getValidMoves(t, board).length > 0);
}

// Place a tile on the board
function placeTile(board, tile, direction) {
  if (!board.center) {
    // First move
    board.center = { ...tile };
    board.isFourDirectional = isDouble(tile);
    recalculateEnds(board);
    return true;
  }
  
  const end = board.ends[direction];
  if (end === null || end === undefined) return false;
  if (tile.left !== end && tile.right !== end) return false;
  
  // Determine which side of the tile connects, and which is the outer end
  let connecting, outer;
  if (tile.left === end) {
    connecting = tile.left;
    outer = tile.right;
  } else {
    connecting = tile.right;
    outer = tile.left;
  }
  
  const placedTile = {
    ...tile,
    _direction: direction,
    _connectingEnd: connecting,
    _outerEnd: outer,
    _isDouble: isDouble(tile)
  };
  
  board[direction].push(placedTile);
  recalculateEnds(board);
  return true;
}

// ===== Determining First Player =====
// Highest double, fallback to highest tile sum
function determineFirstPlayer(players) {
  let firstPlayer = 0;
  let firstTile = null;
  
  // Look for highest double
  for (let value = 6; value >= 0; value--) {
    for (let i = 0; i < players.length; i++) {
      const tile = players[i].hand.find(t => t.left === value && t.right === value);
      if (tile) {
        return { playerIdx: i, tile };
      }
    }
  }
  
  // No doubles - find highest sum
  let maxSum = -1;
  for (let i = 0; i < players.length; i++) {
    for (const tile of players[i].hand) {
      const sum = tile.left + tile.right;
      if (sum > maxSum) {
        maxSum = sum;
        firstPlayer = i;
        firstTile = tile;
      }
    }
  }
  
  return { playerIdx: firstPlayer, tile: firstTile };
}

// ===== Helpers =====
function genCode() { return Math.random().toString(36).substring(2,6).toUpperCase(); }
function genId() { return crypto.randomBytes(8).toString('hex'); }

// ===== Room Management =====
function createRoom(roomId, opts = {}) {
  rooms[roomId] = {
    id: roomId,
    players: [],
    teams: opts.teams || false, // 4-player team mode
    board: createEmptyBoard(),
    boneyard: [],
    currentTurn: 0,
    started: false,
    winner: null,
    isPrivate: opts.isPrivate ?? true,
    isQuickMatch: opts.isQuickMatch ?? false,
    scores: { team1: 0, team2: 0, players: {} }, // team scores or individual
    round: 1,
    targetScore: opts.targetScore || 350,
    aiDifficulty: opts.aiDifficulty || 'medium',
    botTimers: {},
    chatHistory: [],
    createdAt: Date.now(),
    lastWinner: null, // For Kurdish rule: previous winner picks next round's first tile
    chooseFirstTile: false, // True when winner needs to pick starting tile
    suggestedStarter: null, // The tile suggested as starter
    moveLog: [] // For replay
  };
  return rooms[roomId];
}

function startRound(roomId, isFirstRound = false) {
  const room = rooms[roomId];
  if (!room || room.players.length < 2) return;
  
  // Cleanup timers
  Object.values(room.botTimers || {}).forEach(t => clearTimeout(t));
  room.botTimers = {};
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  
  const allTiles = shuffle(createDominoSet());
  const tilesPerPlayer = 7;
  
  room.players.forEach(p => {
    p.hand = allTiles.splice(0, tilesPerPlayer);
  });
  room.boneyard = allTiles; // 0 tiles in 4-player, 14 tiles in 2-player
  room.board = createEmptyBoard();
  room.started = true;
  room.winner = null;
  room.passes = 0;
  room.lastMove = null;
  room.moveLog = [];
  
  // Determine first player
  if (isFirstRound || !room.lastWinner) {
    const { playerIdx } = determineFirstPlayer(room.players);
    room.currentTurn = playerIdx;
    room.chooseFirstTile = false;
    addChatMessage(roomId, null, `🎮 ڕاوندی ${room.round} دەستی پێکرد! ${room.players[playerIdx].name} یەکەم دانانە.`, true);
  } else {
    // Previous round winner picks any tile
    const winnerIdx = room.players.findIndex(p => p.id === room.lastWinner);
    if (winnerIdx >= 0) {
      room.currentTurn = winnerIdx;
      room.chooseFirstTile = true;
      addChatMessage(roomId, null, `🏆 ${room.players[winnerIdx].name} ڕاوندی پێشوو بردیەوە - دەتوانێت هەر دۆمینۆیەک هەڵبژێرێت!`, true);
    } else {
      const { playerIdx } = determineFirstPlayer(room.players);
      room.currentTurn = playerIdx;
      room.chooseFirstTile = false;
    }
  }
  
  broadcastGameState(roomId);
  scheduleAIMove(roomId);
}

function broadcastGameState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  // Set turn deadline (45s for human)
  const currentPlayer = room.players[room.currentTurn];
  if (currentPlayer && !currentPlayer.isBot && room.started && !room.winner) {
    if (!room.turnDeadline || room.lastTurnPlayer !== currentPlayer.id) {
      room.turnDeadline = Date.now() + 45000;
      room.lastTurnPlayer = currentPlayer.id;
      if (room.turnTimer) clearTimeout(room.turnTimer);
      room.turnTimer = setTimeout(() => autoActionForTimeout(roomId), 46000);
    }
  } else {
    room.turnDeadline = null;
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  }
  
  const baseState = {
    roomId,
    started: room.started,
    board: room.board,
    boneyardCount: room.boneyard.length,
    currentTurn: room.currentTurn,
    currentPlayerName: room.players[room.currentTurn]?.name,
    winner: room.winner,
    round: room.round,
    targetScore: room.targetScore,
    lastMove: room.lastMove,
    turnDeadline: room.turnDeadline,
    teams: room.teams,
    teamScores: room.teams ? { team1: room.scores.team1, team2: room.scores.team2 } : null,
    chooseFirstTile: room.chooseFirstTile,
    openEndsSum: calculateOpenEndsSum(room.board),
    players: room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, level: p.level || 1,
      isBot: p.isBot, tilesCount: p.hand.length, connected: p.connected,
      score: room.teams ? 0 : (room.scores.players[p.id] || 0),
      team: p.team
    }))
  };
  
  room.players.forEach(player => {
    if (player.isBot || !player.connected) return;
    io.to(player.id).emit('gameState', {
      ...baseState,
      yourHand: player.hand,
      yourTurn: room.players[room.currentTurn]?.id === player.id,
      yourTeam: player.team
    });
  });
}

// ===== Round End Logic =====
function checkRoundEnd(roomId) {
  const room = rooms[roomId];
  if (!room) return false;
  
  // Win by playing all tiles ("Domino!")
  const winner = room.players.find(p => p.hand.length === 0);
  if (winner) {
    handleRoundEnd(roomId, winner, 'domino');
    return true;
  }
  
  // Blocked game
  const allBlocked = room.players.every(p => !playerCanPlay(p.hand, room.board));
  if (allBlocked && room.boneyard.length === 0) {
    // Find player(s) with lowest pip count
    let minPips = Infinity;
    let blockWinner = null;
    
    if (room.teams) {
      // Sum by teams
      const team1Pips = room.players.filter(p => p.team === 1).reduce((s,p) => s + pipCount(p.hand), 0);
      const team2Pips = room.players.filter(p => p.team === 2).reduce((s,p) => s + pipCount(p.hand), 0);
      
      if (team1Pips < team2Pips) {
        blockWinner = room.players.find(p => p.team === 1 && p.hand.length > 0) || room.players.find(p => p.team === 1);
        minPips = team1Pips;
      } else if (team2Pips < team1Pips) {
        blockWinner = room.players.find(p => p.team === 2 && p.hand.length > 0) || room.players.find(p => p.team === 2);
        minPips = team2Pips;
      } else {
        // Tie - no points awarded, but pick first team's player as nominal winner
        blockWinner = null;
      }
    } else {
      room.players.forEach(p => {
        const pips = pipCount(p.hand);
        if (pips < minPips) { minPips = pips; blockWinner = p; }
      });
    }
    
    if (blockWinner) {
      handleRoundEnd(roomId, blockWinner, 'block');
    } else {
      // Tie in team mode
      room.winner = { reason: 'tie', name: 'یەکسانی', points: 0, gameOver: false };
      room.started = false;
      addChatMessage(roomId, null, `🤝 ڕاوند بە یەکسانی کۆتایی هات!`, true);
    }
    return true;
  }
  
  return false;
}

function handleRoundEnd(roomId, winner, reason) {
  const room = rooms[roomId];
  
  // Calculate losers' total pip count
  let losersPips = 0;
  if (room.teams) {
    const winnerTeam = winner.team;
    losersPips = room.players.filter(p => p.team !== winnerTeam).reduce((s,p) => s + pipCount(p.hand), 0);
  } else {
    losersPips = room.players.filter(p => p.id !== winner.id).reduce((s,p) => s + pipCount(p.hand), 0);
  }
  
  // Round to nearest multiple of 5
  const points = roundToFive(losersPips);
  
  // Award points
  if (room.teams) {
    const teamKey = winner.team === 1 ? 'team1' : 'team2';
    room.scores[teamKey] = (room.scores[teamKey] || 0) + points;
  } else {
    room.scores.players[winner.id] = (room.scores.players[winner.id] || 0) + points;
  }
  
  // Check game over
  let gameOver = false;
  if (room.teams) {
    gameOver = room.scores.team1 >= room.targetScore || room.scores.team2 >= room.targetScore;
  } else {
    gameOver = (room.scores.players[winner.id] || 0) >= room.targetScore;
  }
  
  room.winner = {
    playerId: winner.id,
    name: winner.name,
    team: winner.team,
    reason,
    points,
    rawPoints: losersPips,
    gameOver
  };
  room.started = false;
  room.lastWinner = winner.id;
  
  if (gameOver) saveGameToDatabase(room, winner);
  
  if (reason === 'domino') {
    addChatMessage(roomId, null, `🎉 ${winner.name} داڵاو! +${points} خاڵ`, true);
  } else if (reason === 'block') {
    addChatMessage(roomId, null, `🚫 یاری بەستراوە! ${winner.name} +${points} خاڵ وەردەگرێت`, true);
  }
}

async function saveGameToDatabase(room, winner) {
  if (!db.isConnected()) return;
  try {
    const mode = room.isQuickMatch ? 'quick' : (room.isPrivate ? 'friends' : 'ai');
    const xpAmount = mode === 'quick' ? 50 : 30;
    const coinsAmount = mode === 'quick' ? 50 : 30;
    
    for (const player of room.players) {
      if (player.isBot || !player.sessionId) continue;
      const won = room.teams ? player.team === winner.team : player.id === winner.id;
      await db.updatePlayerStats(player.sessionId, {
        wonGame: won,
        xpGained: won ? xpAmount : 0,
        coinsGained: won ? coinsAmount : 0
      });
    }
    
    if (winner.sessionId) await db.saveGame(room.id, winner.sessionId, mode);
  } catch (err) {
    console.error('saveGameToDatabase error:', err.message);
  }
}

// ===== AI =====
function aiSelectMove(player, board, difficulty) {
  // Get all valid moves across all tiles and directions
  const allMoves = [];
  for (const tile of player.hand) {
    const moves = getValidMoves(tile, board);
    moves.forEach(m => allMoves.push(m));
  }
  
  if (allMoves.length === 0) return null;
  
  // First move and choose first tile - special handling
  if (!board.center) {
    // Pick highest double if available, else highest tile
    const doubles = player.hand.filter(t => isDouble(t));
    if (doubles.length > 0) {
      doubles.sort((a, b) => b.left - a.left);
      return { tile: doubles[0], direction: 'first' };
    }
    // Pick highest tile
    const sorted = [...player.hand].sort((a,b) => (b.left+b.right) - (a.left+a.right));
    return { tile: sorted[0], direction: 'first' };
  }
  
  if (difficulty === 'easy') {
    return allMoves[Math.floor(Math.random() * allMoves.length)];
  }
  
  if (difficulty === 'medium') {
    // Score each move
    const scored = allMoves.map(move => {
      const score = (move.tile.left + move.tile.right) + (isDouble(move.tile) ? 5 : 0);
      return { ...move, _score: score };
    });
    scored.sort((a,b) => b._score - a._score);
    return scored[0];
  }
  
  // Hard: simulate move and check if it creates multiple of 5
  const scored = allMoves.map(move => {
    let score = (move.tile.left + move.tile.right) * 2;
    if (isDouble(move.tile)) score += 10;
    
    // Simulate placement
    const tempBoard = JSON.parse(JSON.stringify(board));
    placeTile(tempBoard, move.tile, move.direction);
    const newSum = calculateOpenEndsSum(tempBoard);
    
    if (newSum > 0 && newSum % 5 === 0) {
      score += newSum * 3; // Big bonus for scoring move
    }
    
    return { ...move, _score: score };
  });
  scored.sort((a,b) => b._score - a._score);
  return scored[0];
}

function executeAIMove(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started) return;
  const player = room.players[room.currentTurn];
  if (!player || !player.isBot) return;
  
  const move = aiSelectMove(player, room.board, room.aiDifficulty);
  
  if (move) {
    const tile = move.tile;
    const tileIdx = player.hand.findIndex(t => t.id === tile.id);
    
    if (move.direction === 'first') {
      placeTile(room.board, tile, 'first');
    } else {
      placeTile(room.board, tile, move.direction);
    }
    player.hand.splice(tileIdx, 1);
    room.chooseFirstTile = false;
    
    // Check for scoring (multiple of 5)
    const sum = calculateOpenEndsSum(room.board);
    let scoreEarned = 0;
    if (sum > 0 && sum % 5 === 0) {
      scoreEarned = sum;
      awardScore(room, player, sum);
    }
    
    room.lastMove = { 
      playerId: player.id, action: 'play', 
      direction: move.direction, tile, 
      scoreEarned 
    };
    room.passes = 0;
    
    if (!checkRoundEnd(roomId)) {
      room.currentTurn = (room.currentTurn + 1) % room.players.length;
    }
    broadcastGameState(roomId);
    scheduleAIMove(roomId);
  } else {
    // No moves - draw or pass
    if (room.boneyard.length > 0) {
      const tile = room.boneyard.pop();
      player.hand.push(tile);
      room.lastMove = { playerId: player.id, action: 'draw' };
      broadcastGameState(roomId);
      const t = setTimeout(() => executeAIMove(roomId), 800);
      room.botTimers[player.id] = t;
    } else {
      room.lastMove = { playerId: player.id, action: 'pass' };
      room.passes = (room.passes || 0) + 1;
      if (!checkRoundEnd(roomId)) {
        room.currentTurn = (room.currentTurn + 1) % room.players.length;
      }
      broadcastGameState(roomId);
      scheduleAIMove(roomId);
    }
  }
}

function awardScore(room, player, points) {
  if (room.teams) {
    const teamKey = player.team === 1 ? 'team1' : 'team2';
    room.scores[teamKey] = (room.scores[teamKey] || 0) + points;
  } else {
    room.scores.players[player.id] = (room.scores.players[player.id] || 0) + points;
  }
  addChatMessage(room.id, null, `⭐ ${player.name} +${points} خاڵ وەرگرت!`, true);
}

function scheduleAIMove(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started) return;
  const player = room.players[room.currentTurn];
  if (!player || !player.isBot) return;
  const delay = 1500 + Math.random() * 800;
  room.botTimers[player.id] = setTimeout(() => executeAIMove(roomId), delay);
}

function autoActionForTimeout(roomId) {
  const room = rooms[roomId];
  if (!room || !room.started || room.winner) return;
  const player = room.players[room.currentTurn];
  if (!player || player.isBot) return;
  
  // Try to play any valid move
  for (const tile of player.hand) {
    const moves = getValidMoves(tile, room.board);
    if (moves.length > 0) {
      const move = moves[0];
      const tileIdx = player.hand.findIndex(t => t.id === tile.id);
      placeTile(room.board, tile, move.direction);
      player.hand.splice(tileIdx, 1);
      room.chooseFirstTile = false;
      
      const sum = calculateOpenEndsSum(room.board);
      let scoreEarned = 0;
      if (sum > 0 && sum % 5 === 0) {
        scoreEarned = sum;
        awardScore(room, player, sum);
      }
      
      room.lastMove = { playerId: player.id, action: 'play', direction: move.direction, tile, scoreEarned, autoPlayed: true };
      addChatMessage(roomId, null, `⏱️ ${player.name} کاتی تەواوبوو - خۆکار دانرا!`, true);
      
      if (!checkRoundEnd(roomId)) room.currentTurn = (room.currentTurn+1) % room.players.length;
      broadcastGameState(roomId);
      scheduleAIMove(roomId);
      return;
    }
  }
  
  // No moves - draw or pass
  if (room.boneyard.length > 0) {
    const tile = room.boneyard.pop();
    player.hand.push(tile);
    room.lastMove = { playerId: player.id, action: 'draw', autoPlayed: true };
    addChatMessage(roomId, null, `⏱️ ${player.name} خۆکار وەرگرت`, true);
    broadcastGameState(roomId);
  } else {
    room.lastMove = { playerId: player.id, action: 'pass', autoPlayed: true };
    room.passes = (room.passes || 0) + 1;
    addChatMessage(roomId, null, `⏱️ ${player.name} خۆکار تێپەڕاند`, true);
    if (!checkRoundEnd(roomId)) room.currentTurn = (room.currentTurn+1) % room.players.length;
    broadcastGameState(roomId);
    scheduleAIMove(roomId);
  }
}

function addBotsToRoom(roomId, count, difficulty='medium') {
  const room = rooms[roomId];
  if (!room) return;
  const names = ['🤖 ئەمیر', '🤖 سارا', '🤖 دیاکۆ', '🤖 ڕێژین'];
  const avatars = ['🤖','👾','🎮','🦾'];
  for (let i = 0; i < count && room.players.length < 4; i++) {
    const idx = room.players.length;
    const team = room.teams ? (idx % 2 === 0 ? 1 : 2) : null;
    room.players.push({
      id: `bot_${roomId}_${idx}_${Date.now()}`,
      name: names[idx % names.length], avatar: avatars[idx % avatars.length],
      isBot: true, hand: [], connected: true, isHost: false, level: 5, team
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

// ===== Matchmaking =====
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
        sessionId: p.sessionId, hand: [], connected: true, isHost: i===0, isBot: false, team: null
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
    setTimeout(() => startRound(roomId, true), 1500);
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
    hand: [], connected: true, isHost: true, isBot: false, team: null
  });
  addBotsToRoom(roomId, 1, 'medium');
  
  const sock = io.sockets.sockets.get(player.socketId);
  if (sock) {
    sock.join(roomId);
    sock.data.roomId = roomId;
    if (sessions[player.sessionId]) sessions[player.sessionId].roomId = roomId;
    io.to(player.socketId).emit('matchFound', { roomId, withBot: true });
  }
  setTimeout(() => startRound(roomId, true), 1500);
}

// ===== Reconnection =====
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
  if (room.scores.players && room.scores.players[oldSocketId] !== undefined) {
    room.scores.players[player.id] = room.scores.players[oldSocketId];
    delete room.scores.players[oldSocketId];
  }
  session.socketId = socket.id;
  session.lastSeen = Date.now();
  socketToSession[socket.id] = sessionId;
  socket.join(session.roomId);
  socket.data.roomId = session.roomId;
  
  socket.emit('reconnected', { roomId: session.roomId, started: room.started, chatHistory: room.chatHistory });
  if (room.started) broadcastGameState(session.roomId);
  else broadcastLobby(session.roomId);
  
  addChatMessage(session.roomId, null, `${player.name} گەڕایەوە! 👋`, true);
  return true;
}

// ===== Socket Events =====
io.on('connection', (socket) => {
  socket.emit('stats', { onlinePlayers: io.sockets.sockets.size, activeRooms: Object.keys(rooms).length });

  socket.on('initSession', async ({ sessionId, playerName, avatar, level }) => {
    if (sessionId && sessions[sessionId]) {
      if (tryReconnect(socket, sessionId)) return;
      sessions[sessionId].socketId = socket.id;
      sessions[sessionId].playerName = playerName;
      sessions[sessionId].avatar = avatar;
      sessions[sessionId].lastSeen = Date.now();
      socketToSession[socket.id] = sessionId;
      const dbPlayer = await db.getOrCreatePlayer(sessionId, playerName, avatar);
      socket.emit('sessionReady', { 
        sessionId,
        dbPlayer: dbPlayer ? {
          level: dbPlayer.level, xp: dbPlayer.xp,
          coins: dbPlayer.coins, gems: dbPlayer.gems,
          stats: { wins: dbPlayer.wins, losses: dbPlayer.losses, games: dbPlayer.games }
        } : null
      });
      return;
    }
    const newSessionId = sessionId || genId();
    sessions[newSessionId] = {
      socketId: socket.id, roomId: null, playerName, avatar, level: level || 1, lastSeen: Date.now()
    };
    socketToSession[socket.id] = newSessionId;
    const dbPlayer = await db.getOrCreatePlayer(newSessionId, playerName, avatar);
    socket.emit('sessionReady', { 
      sessionId: newSessionId,
      dbPlayer: dbPlayer ? {
        level: dbPlayer.level, xp: dbPlayer.xp,
        coins: dbPlayer.coins, gems: dbPlayer.gems,
        stats: { wins: dbPlayer.wins, losses: dbPlayer.losses, games: dbPlayer.games }
      } : null
    });
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

  socket.on('playVsAI', ({ playerName, avatar, level, difficulty, numBots, teams }) => {
    let roomId;
    do { roomId = genCode(); } while (rooms[roomId]);
    const room = createRoom(roomId, { isPrivate: false, aiDifficulty: difficulty, teams: !!teams });
    const sessionId = socketToSession[socket.id];
    room.players.push({
      id: socket.id, name: playerName, avatar, level: level || 1,
      sessionId, hand: [], connected: true, isHost: true, isBot: false,
      team: teams ? 1 : null
    });
    addBotsToRoom(roomId, numBots || 1, difficulty || 'medium');
    socket.join(roomId);
    socket.data.roomId = roomId;
    if (sessions[sessionId]) sessions[sessionId].roomId = roomId;
    socket.emit('roomCreated', { roomId, isVsAI: true });
    setTimeout(() => startRound(roomId, true), 1000);
  });

  socket.on('createRoom', ({ playerName, avatar, level, targetScore, teams }) => {
    let roomId;
    do { roomId = genCode(); } while (rooms[roomId]);
    const room = createRoom(roomId, { isPrivate: true, targetScore, teams: !!teams });
    const sessionId = socketToSession[socket.id];
    room.players.push({
      id: socket.id, name: playerName, avatar, level: level || 1,
      sessionId, hand: [], connected: true, isHost: true, isBot: false,
      team: teams ? 1 : null
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
    let team = null;
    if (room.teams) {
      // Auto-assign to balance teams
      const team1Count = room.players.filter(p => p.team === 1).length;
      const team2Count = room.players.filter(p => p.team === 2).length;
      team = team1Count <= team2Count ? 1 : 2;
    }
    
    room.players.push({
      id: socket.id, name: playerName, avatar, level: level || 1,
      sessionId, hand: [], connected: true, isHost: false, isBot: false, team
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
    if (room.teams && room.players.length !== 4) return socket.emit('error', { message: 'تیمەکی پێویستی بە ٤ یاریزان هەیە!' });
    startRound(roomId, true);
  });

  // ===== PLAY TILE (Kurdish style: with direction) =====
  socket.on('playTile', ({ tileId, direction }) => {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room || !room.started) return;
    const playerIdx = room.players.findIndex(p => p.id === socket.id);
    if (playerIdx !== room.currentTurn) return socket.emit('error', { message: 'نۆرەی تۆ نییە!' });
    const player = room.players[playerIdx];
    const tileIdx = player.hand.findIndex(t => t.id === tileId);
    if (tileIdx === -1) return;
    const tile = player.hand[tileIdx];
    
    // First move - any tile (special: chooseFirstTile = previous winner picks)
    if (!room.board.center) {
      placeTile(room.board, tile, 'first');
      player.hand.splice(tileIdx, 1);
      room.chooseFirstTile = false;
      
      // Check for first-move scoring
      const sum = calculateOpenEndsSum(room.board);
      let scoreEarned = 0;
      if (sum > 0 && sum % 5 === 0) {
        scoreEarned = sum;
        awardScore(room, player, sum);
      }
      
      room.lastMove = { playerId: player.id, action: 'play', direction: 'first', tile, scoreEarned };
      room.passes = 0;
      
      if (!checkRoundEnd(roomId)) room.currentTurn = (room.currentTurn+1) % room.players.length;
      broadcastGameState(roomId);
      scheduleAIMove(roomId);
      return;
    }
    
    // Subsequent moves - validate direction
    if (!direction || !['right','left','up','down'].includes(direction)) {
      return socket.emit('error', { message: 'ئاراستە دیاری بکە!' });
    }
    if (!canPlayAt(tile, room.board, direction)) {
      return socket.emit('error', { message: 'ئەو دۆمینۆیە لەو ئاراستەیە ناگونجێت!' });
    }
    
    placeTile(room.board, tile, direction);
    player.hand.splice(tileIdx, 1);
    
    const sum = calculateOpenEndsSum(room.board);
    let scoreEarned = 0;
    if (sum > 0 && sum % 5 === 0) {
      scoreEarned = sum;
      awardScore(room, player, sum);
    }
    
    room.lastMove = { playerId: player.id, action: 'play', direction, tile, scoreEarned };
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
    if (room.boneyard.length === 0) return socket.emit('error', { message: 'بانک بەتاڵە!' });
    
    // Per Kurdish rules: keep drawing until playable tile or bank empty
    const player = room.players[playerIdx];
    const tile = room.boneyard.pop();
    player.hand.push(tile);
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
    if (room.boneyard.length > 0) return socket.emit('error', { message: 'سەرەتا لە بانک وەربگرە!' });
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
      room.scores = { team1: 0, team2: 0, players: {} };
      room.round = 1;
      room.lastWinner = null;
      startRound(roomId, true);
    } else {
      room.round++;
      startRound(roomId, false);
    }
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
      if (room.turnTimer) clearTimeout(room.turnTimer);
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
            if (stillRoom.turnTimer) clearTimeout(stillRoom.turnTimer);
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
    teams: room.teams,
    players: room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, level: p.level || 1,
      isHost: p.isHost, isBot: p.isBot, team: p.team
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
  console.log(`🎲 Kurdish Domino - port ${PORT}`);
});
