// ============================================
// 🗄️ Database Connection - PostgreSQL
// ============================================
// This connects to PostgreSQL on Railway
// If DATABASE_URL is not set, the app runs without database (in-memory only)

const { Pool } = require('pg');

let pool = null;
let isConnected = false;

// Only connect if DATABASE_URL is provided
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  pool.on('error', (err) => {
    console.error('❌ Postgres error:', err.message);
  });

  // Test connection
  pool.query('SELECT NOW()')
    .then(() => {
      console.log('✅ Connected to PostgreSQL');
      isConnected = true;
      initDatabase();
    })
    .catch(err => {
      console.error('❌ Could not connect to PostgreSQL:', err.message);
      console.log('⚠️  Running without database (in-memory only)');
    });
} else {
  console.log('⚠️  DATABASE_URL not set - running without database');
}

// ===== Initialize tables =====
async function initDatabase() {
  if (!pool) return;
  
  try {
    // Players table - permanent player records
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) UNIQUE NOT NULL,
        name VARCHAR(50) NOT NULL,
        avatar VARCHAR(10) DEFAULT '😎',
        level INT DEFAULT 1,
        xp INT DEFAULT 0,
        coins INT DEFAULT 0,
        gems INT DEFAULT 0,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        games INT DEFAULT 0,
        best_streak INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW()
      )
    `);

    // Games history
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(10),
        winner_session VARCHAR(64),
        mode VARCHAR(20),
        rounds INT DEFAULT 1,
        finished_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Achievements
    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_achievements (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL,
        achievement_id VARCHAR(50) NOT NULL,
        unlocked_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(session_id, achievement_id)
      )
    `);

    // Index for fast leaderboard queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_players_xp ON players(xp DESC)
    `);

    console.log('✅ Database tables ready');
  } catch (err) {
    console.error('❌ Init error:', err.message);
  }
}

// ===== API =====

// Get or create player
async function getOrCreatePlayer(sessionId, name, avatar) {
  if (!isConnected || !pool) return null;
  
  try {
    const existing = await pool.query(
      'SELECT * FROM players WHERE session_id = $1',
      [sessionId]
    );
    
    if (existing.rows.length > 0) {
      // Update last_seen and name/avatar
      await pool.query(
        'UPDATE players SET last_seen = NOW(), name = $1, avatar = $2 WHERE session_id = $3',
        [name, avatar, sessionId]
      );
      return existing.rows[0];
    }
    
    // Create new
    const result = await pool.query(
      `INSERT INTO players (session_id, name, avatar) 
       VALUES ($1, $2, $3) RETURNING *`,
      [sessionId, name, avatar]
    );
    return result.rows[0];
  } catch (err) {
    console.error('DB error (getOrCreatePlayer):', err.message);
    return null;
  }
}

// Update player stats after game
async function updatePlayerStats(sessionId, { wonGame, xpGained, coinsGained }) {
  if (!isConnected || !pool) return;
  
  try {
    if (wonGame) {
      await pool.query(`
        UPDATE players 
        SET wins = wins + 1, games = games + 1, 
            xp = xp + $1, coins = coins + $2,
            last_seen = NOW()
        WHERE session_id = $3
      `, [xpGained || 0, coinsGained || 0, sessionId]);
    } else {
      await pool.query(`
        UPDATE players 
        SET losses = losses + 1, games = games + 1,
            last_seen = NOW()
        WHERE session_id = $1
      `, [sessionId]);
    }
    
    // Update level based on XP
    await pool.query(`
      UPDATE players 
      SET level = FLOOR(POWER(xp / 50.0, 1.0/1.6)) + 1
      WHERE session_id = $1
    `, [sessionId]);
  } catch (err) {
    console.error('DB error (updatePlayerStats):', err.message);
  }
}

// Save game record
async function saveGame(roomId, winnerSession, mode) {
  if (!isConnected || !pool) return;
  try {
    await pool.query(
      `INSERT INTO games (room_id, winner_session, mode) VALUES ($1, $2, $3)`,
      [roomId, winnerSession, mode]
    );
  } catch (err) {
    console.error('DB error (saveGame):', err.message);
  }
}

// Get global leaderboard (top 100)
async function getLeaderboard(limit = 100) {
  if (!isConnected || !pool) return [];
  
  try {
    const result = await pool.query(`
      SELECT name, avatar, level, xp, wins, games,
             ROW_NUMBER() OVER (ORDER BY xp DESC) as rank
      FROM players
      WHERE games >= 1
      ORDER BY xp DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  } catch (err) {
    console.error('DB error (getLeaderboard):', err.message);
    return [];
  }
}

// Get player rank
async function getPlayerRank(sessionId) {
  if (!isConnected || !pool) return null;
  
  try {
    const result = await pool.query(`
      WITH ranked AS (
        SELECT session_id, ROW_NUMBER() OVER (ORDER BY xp DESC) as rank
        FROM players WHERE games >= 1
      )
      SELECT rank FROM ranked WHERE session_id = $1
    `, [sessionId]);
    return result.rows[0]?.rank || null;
  } catch (err) {
    return null;
  }
}

// Get player achievements
async function getPlayerAchievements(sessionId) {
  if (!isConnected || !pool) return [];
  
  try {
    const result = await pool.query(
      'SELECT achievement_id FROM player_achievements WHERE session_id = $1',
      [sessionId]
    );
    return result.rows.map(r => r.achievement_id);
  } catch (err) {
    return [];
  }
}

// Unlock achievement
async function unlockAchievement(sessionId, achievementId) {
  if (!isConnected || !pool) return;
  try {
    await pool.query(
      `INSERT INTO player_achievements (session_id, achievement_id) 
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [sessionId, achievementId]
    );
  } catch (err) {
    console.error('DB error (unlockAchievement):', err.message);
  }
}

// Get total stats
async function getTotalStats() {
  if (!isConnected || !pool) return { totalPlayers: 0, totalGames: 0 };
  
  try {
    const players = await pool.query('SELECT COUNT(*) as count FROM players');
    const games = await pool.query('SELECT COUNT(*) as count FROM games');
    return {
      totalPlayers: parseInt(players.rows[0].count),
      totalGames: parseInt(games.rows[0].count)
    };
  } catch (err) {
    return { totalPlayers: 0, totalGames: 0 };
  }
}

module.exports = {
  isConnected: () => isConnected,
  getOrCreatePlayer,
  updatePlayerStats,
  saveGame,
  getLeaderboard,
  getPlayerRank,
  getPlayerAchievements,
  unlockAchievement,
  getTotalStats
};
