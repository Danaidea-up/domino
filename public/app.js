// ============================================
// 🎲 Domino World - Main App
// ============================================

const $ = (id) => document.getElementById(id);
const socket = io({ transports: ['websocket', 'polling'] });

// ===== STATE =====
const STATE = {
  sessionId: localStorage.getItem('domino_session') || null,
  profile: null,
  settings: null,
  achievements: [],
  history: [],
  gameState: null,
  currentMode: null,
  selectedTile: null,
  searchTimer: null,
  searchSeconds: 0,
  unreadChat: 0,
  lobbyUnreadChat: 0,
  pwaPrompt: null,
  aiOptions: { bots: 1, difficulty: 'medium' },
  friendsOptions: { score: 100 }
};

const AVATARS = ['😎','🤩','🥳','🦁','🐯','🐱','🐶','🦊','🐼','🐨','🐸','🦄','🐲','🦅','🦉','🐺','🐻','🦝','🐧','🦋','🌟','⚡','🔥','💎'];

// ===== ACHIEVEMENTS =====
const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🥇', name: 'یەکەم سەرکەوتن', desc: 'یەکەم یاریت بدۆڕێنە', check: (s) => s.wins >= 1 },
  { id: 'wins_5', icon: '⭐', name: '٥ سەرکەوتن', desc: '٥ یاری بدۆڕێنە', check: (s) => s.wins >= 5 },
  { id: 'wins_10', icon: '🌟', name: '١٠ سەرکەوتن', desc: '١٠ یاری بدۆڕێنە', check: (s) => s.wins >= 10 },
  { id: 'wins_25', icon: '💫', name: '٢٥ سەرکەوتن', desc: '٢٥ یاری بدۆڕێنە', check: (s) => s.wins >= 25 },
  { id: 'wins_50', icon: '🏆', name: '٥٠ سەرکەوتن', desc: '٥٠ یاری بدۆڕێنە', check: (s) => s.wins >= 50 },
  { id: 'wins_100', icon: '👑', name: 'پاڵەوان', desc: '١٠٠ یاری بدۆڕێنە', check: (s) => s.wins >= 100 },
  { id: 'games_10', icon: '🎮', name: 'یاریزان', desc: '١٠ یاری بکە', check: (s) => s.games >= 10 },
  { id: 'games_50', icon: '🎯', name: 'بێهیلانە', desc: '٥٠ یاری بکە', check: (s) => s.games >= 50 },
  { id: 'games_100', icon: '🚀', name: 'یاریزانی پسپۆڕ', desc: '١٠٠ یاری بکە', check: (s) => s.games >= 100 },
  { id: 'level_5', icon: '⬆️', name: 'ئاستی ٥', desc: 'بگە بە ئاستی ٥', check: (s, p) => p.level >= 5 },
  { id: 'level_10', icon: '🎖️', name: 'ئاستی ١٠', desc: 'بگە بە ئاستی ١٠', check: (s, p) => p.level >= 10 },
  { id: 'level_25', icon: '🏅', name: 'ئاستی ٢٥', desc: 'بگە بە ئاستی ٢٥', check: (s, p) => p.level >= 25 },
  { id: 'beat_hard', icon: '💀', name: 'دۆڕاندنی AI سەخت', desc: 'AI ـی سەخت بدۆڕێنە', check: (s, p) => p.beatHardAI },
  { id: 'streak_3', icon: '🔥', name: 'زنجیرەی ٣', desc: '٣ یاری ڕاسەرە بدۆڕێنە', check: (s, p) => (p.bestStreak || 0) >= 3 },
  { id: 'streak_5', icon: '🌋', name: 'زنجیرەی ٥', desc: '٥ یاری ڕاسەرە بدۆڕێنە', check: (s, p) => (p.bestStreak || 0) >= 5 },
  { id: 'streak_10', icon: '☄️', name: 'زنجیرەی ١٠', desc: '١٠ یاری ڕاسەرە بدۆڕێنە', check: (s, p) => (p.bestStreak || 0) >= 10 },
  { id: 'rich_500', icon: '💰', name: 'دەوڵەمەند', desc: '٥٠٠ پارە کۆبکەرەوە', check: (s, p) => (p.coins || 0) >= 500 },
  { id: 'rich_2000', icon: '💎', name: 'مولیۆنێر', desc: '٢٠٠٠ پارە کۆبکەرەوە', check: (s, p) => (p.coins || 0) >= 2000 },
  { id: 'win_rate_70', icon: '📈', name: 'پاڵەوانی ڕاستەقینە', desc: 'ڕێژەی سەرکەوتن ٧٠٪ بکە', check: (s) => s.games >= 20 && (s.wins/s.games) >= 0.7 },
  { id: 'play_all_modes', icon: '🌟', name: 'هەمەلایەنە', desc: 'هەموو شێوازەکانی یاری تاقیبکەوە', check: (s, p) => p.modesPlayed && p.modesPlayed.length >= 3 }
];

// ===== INIT =====
async function init() {
  loadProfile();
  loadSettings();
  loadAchievements();
  loadHistory();
  
  applySettings();
  applyLanguage(STATE.settings.language || 'ckb');
  
  renderProfile();
  renderResources();
  
  setupEventListeners();
  setupSocketListeners();
  setupParticles();
  
  // Hide splash after 1.2s
  setTimeout(() => $('splash').classList.add('hide'), 1200);
  
  // Check daily reward
  setTimeout(checkDailyReward, 1500);
  
  // Init session
  socket.on('connect', () => {
    socket.emit('initSession', {
      sessionId: STATE.sessionId,
      playerName: STATE.profile.name,
      avatar: STATE.profile.avatar,
      level: STATE.profile.level
    });
  });
  
  // PWA install
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    STATE.pwaPrompt = e;
    $('installPWABtn').style.display = 'flex';
  });
  
  if (window.matchMedia('(display-mode: standalone)').matches) {
    $('pwaInstalledText').style.display = 'block';
  }
}

// ===== PROFILE =====
function loadProfile() {
  const saved = localStorage.getItem('domino_profile');
  if (saved) {
    STATE.profile = JSON.parse(saved);
  } else {
    STATE.profile = {
      name: 'یاریزان',
      avatar: '😎',
      level: 1,
      xp: 0,
      coins: 0,
      gems: 0,
      stats: { wins: 0, losses: 0, games: 0 },
      currentStreak: 0,
      bestStreak: 0,
      beatHardAI: false,
      modesPlayed: []
    };
  }
  // Defaults for missing fields
  STATE.profile.coins = STATE.profile.coins || 0;
  STATE.profile.gems = STATE.profile.gems || 0;
  STATE.profile.xp = STATE.profile.xp || 0;
  STATE.profile.level = STATE.profile.level || 1;
  STATE.profile.modesPlayed = STATE.profile.modesPlayed || [];
}

function saveProfile() {
  localStorage.setItem('domino_profile', JSON.stringify(STATE.profile));
}

function renderProfile() {
  const p = STATE.profile;
  $('pillAvatar').textContent = p.avatar;
  $('pillName').textContent = p.name;
  $('pillLevel').textContent = p.level;
  
  // XP bar
  const xpForNext = xpRequiredForLevel(p.level + 1);
  const xpForCurrent = xpRequiredForLevel(p.level);
  const xpProgress = ((p.xp - xpForCurrent) / (xpForNext - xpForCurrent)) * 100;
  $('pillXP').style.width = Math.max(0, Math.min(100, xpProgress)) + '%';
  
  // Profile panel
  $('phAvatar').textContent = p.avatar;
  $('phName').textContent = p.name;
  $('phLevel').textContent = p.level;
  $('phXP').style.width = Math.max(0, Math.min(100, xpProgress)) + '%';
  $('phXPText').textContent = `${p.xp - xpForCurrent}/${xpForNext - xpForCurrent} XP`;
  
  // Stats
  const s = p.stats || { wins: 0, losses: 0, games: 0 };
  $('statWins').textContent = s.wins;
  $('statLosses').textContent = s.losses;
  $('statGames').textContent = s.games;
  const winRate = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
  $('statWinRate').textContent = winRate + '%';
}

function renderResources() {
  $('coinsValue').textContent = STATE.profile.coins;
  $('gemsValue').textContent = STATE.profile.gems;
}

function xpRequiredForLevel(level) {
  return Math.floor(50 * Math.pow(level - 1, 1.6));
}

function addXP(amount) {
  STATE.profile.xp += amount;
  let leveledUp = false;
  while (STATE.profile.xp >= xpRequiredForLevel(STATE.profile.level + 1)) {
    STATE.profile.level++;
    leveledUp = true;
  }
  saveProfile();
  renderProfile();
  if (leveledUp) showLevelUp();
}

function addCoins(amount) {
  STATE.profile.coins += amount;
  saveProfile();
  renderResources();
  showRewardToast(`+${amount} 💰`);
}

function addGems(amount) {
  STATE.profile.gems += amount;
  saveProfile();
  renderResources();
}

// ===== AVATARS =====
function renderAvatarGrid() {
  const grid = $('avatarGrid');
  grid.innerHTML = '';
  AVATARS.forEach(av => {
    const btn = document.createElement('div');
    btn.className = 'avatar-option-pro';
    if (av === STATE.profile.avatar) btn.classList.add('selected');
    btn.textContent = av;
    btn.onclick = () => {
      grid.querySelectorAll('.avatar-option-pro').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      STATE.profile.avatar = av;
    };
    grid.appendChild(btn);
  });
}

// ===== SETTINGS =====
function loadSettings() {
  const saved = localStorage.getItem('domino_settings');
  STATE.settings = saved ? JSON.parse(saved) : {
    sound: true, vibrate: true, animations: true, particles: true,
    theme: 'cosmic', language: 'ckb'
  };
}

function saveSettings() {
  localStorage.setItem('domino_settings', JSON.stringify(STATE.settings));
}

function applySettings() {
  document.body.dataset.theme = STATE.settings.theme;
  document.querySelectorAll('.toggle-pro').forEach(t => {
    const key = t.dataset.setting;
    if (STATE.settings[key]) t.classList.add('on');
    else t.classList.remove('on');
  });
  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.theme === STATE.settings.theme);
  });
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.lang === STATE.settings.language);
  });
}

// ===== ACHIEVEMENTS =====
function loadAchievements() {
  const saved = localStorage.getItem('domino_achievements');
  STATE.achievements = saved ? JSON.parse(saved) : [];
  $('achTotal').textContent = ACHIEVEMENTS.length;
}

function saveAchievements() {
  localStorage.setItem('domino_achievements', JSON.stringify(STATE.achievements));
}

function checkAchievements() {
  ACHIEVEMENTS.forEach(ach => {
    if (STATE.achievements.includes(ach.id)) return;
    if (ach.check(STATE.profile.stats, STATE.profile)) {
      STATE.achievements.push(ach.id);
      saveAchievements();
      showAchievementUnlock(ach);
    }
  });
}

function renderAchievements() {
  const list = $('achievementsList');
  list.innerHTML = '';
  $('achUnlocked').textContent = STATE.achievements.length;
  $('achProgressFill').style.width = (STATE.achievements.length / ACHIEVEMENTS.length * 100) + '%';
  
  // Show badge if unread achievements would be possible (here: just hide)
  $('achBadge').style.display = 'none';
  
  ACHIEVEMENTS.forEach(ach => {
    const unlocked = STATE.achievements.includes(ach.id);
    const item = document.createElement('div');
    item.className = `ach-item ${unlocked ? 'unlocked' : 'locked'}`;
    item.innerHTML = `
      <div class="ach-icon">${unlocked ? ach.icon : '🔒'}</div>
      <div class="ach-info">
        <div class="ach-name">${ach.name}</div>
        <div class="ach-desc">${ach.desc}</div>
      </div>
      <div class="ach-status ${unlocked ? 'unlocked' : 'locked'}">${unlocked ? '✓' : '🔒'}</div>
    `;
    list.appendChild(item);
  });
}

function showAchievementUnlock(ach) {
  $('achPopupIcon').textContent = ach.icon;
  $('achPopupName').textContent = ach.name;
  $('achPopupDesc').textContent = ach.desc;
  $('achievementModal').classList.add('active');
  playSound('win');
  vibrate(200);
  // Reward
  STATE.profile.coins += 50;
  STATE.profile.gems += 1;
  saveProfile();
  renderResources();
}

// ===== LEVEL UP =====
function showLevelUp() {
  $('newLevel').textContent = STATE.profile.level;
  $('levelUpModal').classList.add('active');
  STATE.profile.coins += 50;
  STATE.profile.gems += 2;
  saveProfile();
  renderResources();
  playSound('win');
  triggerConfetti();
}

// ===== DAILY REWARD =====
function checkDailyReward() {
  const last = parseInt(localStorage.getItem('domino_last_daily') || '0');
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  if (now - last >= dayMs) {
    $('dailyBtn').classList.remove('claimed');
    $('dailyBtn').onclick = () => $('dailyModal').classList.add('active');
  } else {
    $('dailyBtn').classList.add('claimed');
    const hoursLeft = Math.ceil((dayMs - (now - last)) / (60 * 60 * 1000));
    $('dailyText').textContent = `${hoursLeft}س`;
  }
}

function claimDaily() {
  STATE.profile.coins += 100;
  STATE.profile.gems += 5;
  saveProfile();
  renderResources();
  localStorage.setItem('domino_last_daily', Date.now().toString());
  $('dailyModal').classList.remove('active');
  $('dailyBtn').classList.add('claimed');
  $('dailyText').textContent = '24س';
  triggerConfetti();
  playSound('win');
  showToast('🎁 خەڵاتەکەت وەرگیرا!');
}

// ===== HISTORY =====
function loadHistory() {
  const saved = localStorage.getItem('domino_history');
  STATE.history = saved ? JSON.parse(saved) : [];
}

function addHistoryEntry(entry) {
  STATE.history.unshift({ ...entry, date: Date.now() });
  if (STATE.history.length > 50) STATE.history = STATE.history.slice(0, 50);
  localStorage.setItem('domino_history', JSON.stringify(STATE.history));
}

function renderHistory() {
  const list = $('historyList');
  list.innerHTML = '';
  if (STATE.history.length === 0) {
    list.innerHTML = '<div class="history-empty">📭 هیچ یاریەکت نییە لە مێژوودا</div>';
    return;
  }
  STATE.history.forEach(h => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const modeNames = { quick: '⚡ خێرا', ai: '🤖 AI', friends: '👥 هاوڕێ' };
    item.innerHTML = `
      <div class="hi-info">
        <div class="hi-mode">${modeNames[h.mode] || h.mode}</div>
        <div class="hi-date">${formatDate(h.date)}</div>
      </div>
      <div class="hi-result ${h.result}">${h.result === 'win' ? '✓ سەرکەوتن' : '✗ دۆڕان'}</div>
    `;
    list.appendChild(item);
  });
}

function formatDate(ts) {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return 'ئێستا';
  if (diff < 3600000) return Math.floor(diff/60000) + ' خ پێش';
  if (diff < 86400000) return Math.floor(diff/3600000) + ' س پێش';
  return d.toLocaleDateString('ar-IQ');
}

// ===== LEADERBOARD (Local) =====
function renderLeaderboard() {
  const list = $('leaderboardList');
  list.innerHTML = '';
  
  // Show current player
  const p = STATE.profile;
  const item = document.createElement('div');
  item.className = 'lb-item';
  item.style.background = 'linear-gradient(135deg, rgba(240,147,251,0.2), rgba(245,87,108,0.2))';
  item.innerHTML = `
    <div class="lb-rank gold">★</div>
    <div class="pill-avatar">${p.avatar}</div>
    <div style="flex:1;">
      <div style="font-weight:700;">${p.name} (تۆ)</div>
      <div style="font-size:0.8rem; color:var(--text-dim);">ئاست ${p.level} · ${p.stats.wins} سەرکەوتن</div>
    </div>
    <div style="color:var(--gold); font-weight:800;">${p.xp} XP</div>
  `;
  list.appendChild(item);
  
  // Note about global leaderboard
  const note = document.createElement('div');
  note.style.cssText = 'text-align:center; padding:30px; color:var(--text-dim); font-size:0.9rem;';
  note.innerHTML = '🌍 ڕیتبەندی جیهانی پێویستی بە سێرڤەرێکی هەمیشەییە';
  list.appendChild(note);
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
  // Mode cards
  document.querySelectorAll('.mode-card').forEach(card => {
    card.onclick = () => {
      const mode = card.dataset.mode;
      STATE.currentMode = mode;
      if (mode === 'quick') startQuickMatch();
      else if (mode === 'ai') showScreen('aiSetupScreen');
      else if (mode === 'friends') showScreen('friendsSetupScreen');
    };
  });
  
  // Back buttons
  document.querySelectorAll('.back-btn').forEach(btn => {
    if (btn.id === 'leaveLobbyBtn') {
      btn.onclick = leaveLobby;
    } else {
      btn.onclick = () => showScreen('homeScreen');
    }
  });
  
  // AI setup
  document.querySelectorAll('#botCount .option-pill').forEach(p => {
    p.onclick = () => {
      document.querySelectorAll('#botCount .option-pill').forEach(b => b.classList.remove('selected'));
      p.classList.add('selected');
      STATE.aiOptions.bots = parseInt(p.dataset.bots);
    };
  });
  document.querySelectorAll('.diff-card').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('.diff-card').forEach(b => b.classList.remove('selected'));
      c.classList.add('selected');
      STATE.aiOptions.difficulty = c.dataset.diff;
    };
  });
  $('startAIBtn').onclick = startVsAI;
  
  // Friends setup
  document.querySelectorAll('#targetScore .option-pill').forEach(p => {
    p.onclick = () => {
      document.querySelectorAll('#targetScore .option-pill').forEach(b => b.classList.remove('selected'));
      p.classList.add('selected');
      STATE.friendsOptions.score = parseInt(p.dataset.score);
    };
  });
  $('createRoomBtn').onclick = createRoom;
  $('joinRoomBtn').onclick = joinRoom;
  $('roomCodeInput').oninput = (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  };
  
  // Search
  $('cancelSearchBtn').onclick = () => {
    socket.emit('cancelQuickMatch');
    stopSearchTimer();
    showScreen('homeScreen');
  };
  
  // Lobby
  $('roomCodePro').onclick = copyRoomCode;
  $('startGameBtn').onclick = () => socket.emit('startGame');
  $('addBotBtn').onclick = () => socket.emit('startGame', { addBots: true });
  
  // Game
  $('gameMenuBtn').onclick = () => $('menuModal').classList.add('active');
  $('resumeBtn').onclick = () => $('menuModal').classList.remove('active');
  $('leaveGameBtn').onclick = () => {
    $('menuModal').classList.remove('active');
    socket.emit('leaveRoom');
    showScreen('homeScreen');
  };
  $('playLeftBtn').onclick = () => playSelectedTile('left');
  $('playRightBtn').onclick = () => playSelectedTile('right');
  $('drawBtn').onclick = () => { socket.emit('drawTile'); playSound('select'); };
  $('passBtn').onclick = () => { socket.emit('passTurn'); playSound('select'); };
  $('boneyardBtn').onclick = () => showToast(`📦 ${STATE.gameState?.boneyardCount || 0} دۆمینۆ ماوە`);
  
  // Game chat
  $('gameChatBtn').onclick = openChat;
  $('lobbyChatBtn').onclick = openChat;
  $('closeChatBtn').onclick = closeChat;
  $('chatSendBtn').onclick = sendChatText;
  $('chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChatText(); };
  document.querySelectorAll('.emoji-quick').forEach(b => {
    b.onclick = () => sendChatEmoji(b.dataset.emoji);
  });
  
  // Top buttons
  $('settingsBtn').onclick = () => $('settingsPanel').classList.add('active');
  $('closeSettingsBtn').onclick = () => $('settingsPanel').classList.remove('active');
  $('achievementsBtn').onclick = () => {
    renderAchievements();
    $('achievementsPanel').classList.add('active');
  };
  $('closeAchievementsBtn').onclick = () => $('achievementsPanel').classList.remove('active');
  $('playerPill').onclick = openProfile;
  $('profileBtn').onclick = openProfile;
  $('closeProfileBtn').onclick = () => $('profilePanel').classList.remove('active');
  $('saveProfileBtn').onclick = saveProfileChanges;
  $('historyBtn').onclick = () => {
    renderHistory();
    $('historyPanel').classList.add('active');
  };
  $('closeHistoryBtn').onclick = () => $('historyPanel').classList.remove('active');
  $('leaderboardBtn').onclick = () => {
    renderLeaderboard();
    $('leaderboardPanel').classList.add('active');
  };
  $('closeLeaderboardBtn').onclick = () => $('leaderboardPanel').classList.remove('active');
  
  // Modals
  $('nextRoundBtn').onclick = () => {
    $('winnerModal').classList.remove('active');
    socket.emit('nextRound');
  };
  $('exitGameBtn').onclick = () => {
    $('winnerModal').classList.remove('active');
    socket.emit('leaveRoom');
    showScreen('homeScreen');
  };
  $('claimDailyBtn').onclick = claimDaily;
  $('closeAchPopup').onclick = () => $('achievementModal').classList.remove('active');
  $('closeLevelUpBtn').onclick = () => $('levelUpModal').classList.remove('active');
  
  // Settings
  document.querySelectorAll('.toggle-pro').forEach(t => {
    t.onclick = () => {
      const key = t.dataset.setting;
      STATE.settings[key] = !STATE.settings[key];
      t.classList.toggle('on', STATE.settings[key]);
      saveSettings();
    };
  });
  document.querySelectorAll('.theme-card').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('.theme-card').forEach(b => b.classList.remove('selected'));
      c.classList.add('selected');
      STATE.settings.theme = c.dataset.theme;
      document.body.dataset.theme = STATE.settings.theme;
      saveSettings();
    };
  });
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.lang-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      STATE.settings.language = b.dataset.lang;
      saveSettings();
      applyLanguage(b.dataset.lang);
    };
  });
  
  // PWA
  $('installPWABtn').onclick = async () => {
    if (STATE.pwaPrompt) {
      STATE.pwaPrompt.prompt();
      const { outcome } = await STATE.pwaPrompt.userChoice;
      if (outcome === 'accepted') {
        $('installPWABtn').style.display = 'none';
        $('pwaInstalledText').style.display = 'block';
        showToast('✅ ئەپەکە دامەزرا!');
      }
    }
  };
  
  // Reset buttons
  $('resetStatsBtn').onclick = () => {
    if (confirm('دڵنیایت لە سڕینەوەی ئامارەکان؟')) {
      STATE.profile.stats = { wins: 0, losses: 0, games: 0 };
      STATE.profile.currentStreak = 0;
      STATE.profile.bestStreak = 0;
      saveProfile();
      renderProfile();
      showToast('🗑️ ئامارەکان سڕانەوە');
    }
  };
  $('resetAllBtn').onclick = () => {
    if (confirm('⚠️ هەموو شت دەسڕێتەوە! دڵنیایت؟')) {
      localStorage.clear();
      location.reload();
    }
  };
}

function openProfile() {
  renderAvatarGrid();
  $('nameInput').value = STATE.profile.name;
  $('profilePanel').classList.add('active');
}

function saveProfileChanges() {
  const name = $('nameInput').value.trim();
  if (name) STATE.profile.name = name;
  saveProfile();
  renderProfile();
  $('profilePanel').classList.remove('active');
  showToast('✅ پاراست');
  // Update server with new info
  socket.emit('initSession', {
    sessionId: STATE.sessionId,
    playerName: STATE.profile.name,
    avatar: STATE.profile.avatar,
    level: STATE.profile.level
  });
}

// ===== SCREEN MANAGEMENT =====
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
  
  // Reset chat unread for context
  if (screenId === 'gameScreen') STATE.unreadChat = 0;
  if (screenId === 'lobbyScreen') STATE.lobbyUnreadChat = 0;
  updateChatBadges();
}

// ===== MATCHMAKING =====
function startQuickMatch() {
  socket.emit('quickMatch', {
    playerName: STATE.profile.name,
    avatar: STATE.profile.avatar,
    level: STATE.profile.level
  });
  showScreen('searchingScreen');
  startSearchTimer();
}

function startSearchTimer() {
  STATE.searchSeconds = 0;
  $('searchTime').textContent = '0';
  STATE.searchTimer = setInterval(() => {
    STATE.searchSeconds++;
    $('searchTime').textContent = STATE.searchSeconds;
  }, 1000);
}

function stopSearchTimer() {
  if (STATE.searchTimer) clearInterval(STATE.searchTimer);
  STATE.searchTimer = null;
}

function startVsAI() {
  if (!STATE.profile.modesPlayed.includes('ai')) {
    STATE.profile.modesPlayed.push('ai');
    saveProfile();
  }
  socket.emit('playVsAI', {
    playerName: STATE.profile.name,
    avatar: STATE.profile.avatar,
    level: STATE.profile.level,
    difficulty: STATE.aiOptions.difficulty,
    numBots: STATE.aiOptions.bots
  });
}

function createRoom() {
  if (!STATE.profile.modesPlayed.includes('friends')) {
    STATE.profile.modesPlayed.push('friends');
    saveProfile();
  }
  socket.emit('createRoom', {
    playerName: STATE.profile.name,
    avatar: STATE.profile.avatar,
    level: STATE.profile.level,
    targetScore: STATE.friendsOptions.score
  });
}

function joinRoom() {
  const code = $('roomCodeInput').value.trim().toUpperCase();
  if (code.length !== 4) return showToast('کۆد دەبێت ٤ پیت بێت!', 'error');
  if (!STATE.profile.modesPlayed.includes('friends')) {
    STATE.profile.modesPlayed.push('friends');
    saveProfile();
  }
  socket.emit('joinRoom', {
    roomId: code,
    playerName: STATE.profile.name,
    avatar: STATE.profile.avatar,
    level: STATE.profile.level
  });
}

function leaveLobby() {
  socket.emit('leaveRoom');
  showScreen('homeScreen');
}

function copyRoomCode() {
  const code = $('roomCodeText').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code);
    showToast('✓ کۆد کۆپی کرا!');
    vibrate(50);
  }
}

// ===== SOCKET EVENTS =====
function setupSocketListeners() {
  socket.on('sessionReady', ({ sessionId }) => {
    STATE.sessionId = sessionId;
    localStorage.setItem('domino_session', sessionId);
  });
  
  socket.on('reconnected', ({ roomId, started, chatHistory }) => {
    showToast('✅ گەڕایتەوە بۆ یاری!');
    if (chatHistory) {
      $('chatMessages').innerHTML = '';
      chatHistory.forEach(msg => addChatMessageToUI(msg));
    }
    if (started) showScreen('gameScreen');
    else showScreen('lobbyScreen');
  });
  
  socket.on('stats', ({ onlinePlayers, activeRooms }) => {
    $('onlineCount').textContent = onlinePlayers;
    $('roomsCount').textContent = activeRooms;
  });
  
  socket.on('searching', () => { /* already on searching screen */ });
  
  socket.on('matchFound', ({ roomId, withBot }) => {
    stopSearchTimer();
    if (withBot) showToast('🤖 ڕۆبۆتێک زیاد کرا!');
    else showToast('✅ یاریزانێک دۆزرایەوە!');
  });
  
  socket.on('roomCreated', ({ roomId, isVsAI, isPrivate }) => {
    if (isVsAI) {
      showScreen('gameScreen');
    } else {
      $('roomCodeText').textContent = roomId;
      showScreen('lobbyScreen');
    }
  });
  
  socket.on('roomJoined', ({ roomId }) => {
    $('roomCodeText').textContent = roomId;
    showScreen('lobbyScreen');
  });
  
  socket.on('lobbyUpdate', (data) => {
    $('roomCodeText').textContent = data.roomId;
    $('lobbyTargetScore').textContent = data.targetScore;
    renderLobbyPlayers(data.players);
  });
  
  socket.on('gameState', (state) => {
    STATE.gameState = state;
    renderGame(state);
    if (state.started && !$('gameScreen').classList.contains('active')) {
      showScreen('gameScreen');
    }
    if (state.winner) {
      setTimeout(() => showWinner(state), 800);
    }
  });
  
  socket.on('chatMessage', (msg) => {
    addChatMessageToUI(msg);
    if (!$('chatPanel').classList.contains('active')) {
      if ($('gameScreen').classList.contains('active')) STATE.unreadChat++;
      else if ($('lobbyScreen').classList.contains('active')) STATE.lobbyUnreadChat++;
      updateChatBadges();
      if (!msg.isSystem) playSound('select');
    }
  });
  
  socket.on('error', ({ message }) => {
    showToast(message, 'error');
    vibrate([50, 50, 50]);
  });
  
  socket.on('disconnect', () => {
    showToast('❌ پەیوەندی داشکا - چاوەڕێی پەیوەستبوونەوە...', 'error');
  });
}

// ===== LOBBY RENDERING =====
function renderLobbyPlayers(players) {
  const slots = $('playerSlots');
  slots.innerHTML = '';
  $('playersCount').textContent = players.length;
  
  players.forEach(p => {
    const isMe = p.id === socket.id;
    const slot = document.createElement('div');
    slot.className = 'player-slot';
    slot.innerHTML = `
      <div class="slot-avatar">${p.avatar}</div>
      <div class="slot-info">
        <div class="slot-name">${p.name}</div>
        <div class="slot-level">⬆ ئاست ${p.level || 1}</div>
      </div>
      <div class="slot-badges">
        ${isMe ? '<span class="badge-pill badge-you">تۆ</span>' : ''}
        ${p.isHost ? '<span class="badge-pill badge-host">👑</span>' : ''}
        ${p.isBot ? '<span class="badge-pill badge-bot">🤖</span>' : ''}
      </div>
    `;
    slots.appendChild(slot);
  });
  
  // Empty slots
  for (let i = players.length; i < 4; i++) {
    const slot = document.createElement('div');
    slot.className = 'player-slot empty';
    slot.innerHTML = `<div class="slot-avatar">+</div><div style="color:var(--text-dim);">شوێنی بەتاڵ</div>`;
    slots.appendChild(slot);
  }
  
  // Host controls
  const me = players.find(p => p.id === socket.id);
  if (me && me.isHost) {
    $('hostControls').style.display = 'block';
    $('waitingMsg').style.display = 'none';
    $('startGameBtn').disabled = players.length < 2;
    $('addBotBtn').style.display = players.length < 4 ? 'flex' : 'none';
  } else {
    $('hostControls').style.display = 'none';
    $('waitingMsg').style.display = 'block';
  }
}

// ===== GAME RENDERING =====
function renderGame(state) {
  $('targetScoreDisplay').textContent = state.targetScore;
  $('roundDisplay').textContent = state.round;
  $('boneyardCount').textContent = state.boneyardCount;
  
  // Players bar
  const bar = $('playersBar');
  bar.innerHTML = '';
  state.players.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = `player-card-pro ${idx === state.currentTurn ? 'current' : ''} ${!p.connected ? 'disconnected' : ''}`;
    card.innerHTML = `
      <div class="pc-avatar-pro">
        ${p.avatar}
        <div class="pc-lvl">${p.level}</div>
      </div>
      <div class="pc-name-pro">${p.name}${p.id === socket.id ? ' (تۆ)' : ''}</div>
      <div class="pc-info-pro">
        <span>🎴${p.tilesCount}</span>
        <span class="pc-score-pro">${p.score}</span>
      </div>
    `;
    bar.appendChild(card);
  });
  
  // Board
  renderBoard(state.board);
  
  // Hand
  renderHand(state.yourHand || [], state.board, state.yourTurn);
  
  // Title
  if (state.yourTurn) {
    $('handTitle').innerHTML = '<b style="color:var(--gold);">🌟 نۆرەی تۆیە!</b>';
  } else {
    $('handTitle').textContent = `⏳ نۆرەی ${state.currentPlayerName}...`;
  }
  
  // Buttons
  if (!state.yourTurn) {
    $('playLeftBtn').disabled = true;
    $('playRightBtn').disabled = true;
    $('drawBtn').disabled = true;
    $('passBtn').disabled = true;
  } else {
    const hasPlayable = checkAnyPlayable(state.yourHand || [], state.board);
    $('drawBtn').disabled = state.boneyardCount === 0 || hasPlayable;
    $('passBtn').disabled = state.boneyardCount > 0 || hasPlayable;
  }
  
  // Last move feedback
  if (state.lastMove && state.lastMove.action === 'play') {
    playSound('place');
    vibrate(30);
  }
}

function renderBoard(board) {
  const boardEl = $('board');
  boardEl.innerHTML = '';
  if (!board || board.length === 0) {
    boardEl.classList.add('empty');
    return;
  }
  boardEl.classList.remove('empty');
  board.forEach(tile => {
    const t = createTileElement(tile, 'horizontal');
    boardEl.appendChild(t);
  });
}

function renderHand(hand, board, isYourTurn) {
  const handEl = $('hand');
  handEl.innerHTML = '';
  if (!hand) return;
  
  hand.forEach(tile => {
    const t = createHandTile(tile, board, isYourTurn);
    handEl.appendChild(t);
  });
}

function createTileElement(tile, orientation) {
  const div = document.createElement('div');
  div.className = `domino ${orientation}`;
  div.innerHTML = `<div class="domino-half">${createPips(tile.left)}</div><div class="domino-half">${createPips(tile.right)}</div>`;
  return div;
}

function createHandTile(tile, board, isYourTurn) {
  const div = document.createElement('div');
  div.className = 'hand-tile';
  div.dataset.tileId = tile.id;
  
  const can = canPlayTile(tile, board);
  const isPlayable = isYourTurn && (can.left || can.right);
  if (isPlayable) div.classList.add('playable');
  if (!isYourTurn) div.classList.add('disabled');
  
  if (STATE.selectedTile === tile.id) div.classList.add('selected');
  
  div.innerHTML = `<div class="domino-half">${createPips(tile.left)}</div><div class="domino-half">${createPips(tile.right)}</div>`;
  
  div.onclick = () => {
    if (!isYourTurn) return;
    if (!isPlayable) {
      showToast('ئەم دۆمینۆیە ناگونجێت!', 'error');
      vibrate(50);
      return;
    }
    selectTile(tile.id, can);
  };
  
  return div;
}

function createPips(value) {
  const positions = {
    0: [], 1: [5], 2: [1,9], 3: [1,5,9], 4: [1,3,7,9],
    5: [1,3,5,7,9], 6: [1,3,4,6,7,9]
  };
  const pips = positions[value] || [];
  let html = '';
  for (let i = 1; i <= 9; i++) {
    html += pips.includes(i) ? '<div class="pip"></div>' : '<div></div>';
  }
  return html;
}

function selectTile(tileId, playableInfo) {
  STATE.selectedTile = STATE.selectedTile === tileId ? null : tileId;
  document.querySelectorAll('.hand-tile').forEach(t => {
    t.classList.toggle('selected', t.dataset.tileId === STATE.selectedTile);
  });
  playSound('select');
  vibrate(20);
  
  if (STATE.selectedTile) {
    const board = STATE.gameState?.board || [];
    if (board.length === 0) {
      // First tile - play directly
      socket.emit('playTile', { tileId: STATE.selectedTile, side: 'right' });
      STATE.selectedTile = null;
      return;
    }
    $('playLeftBtn').disabled = !playableInfo.left;
    $('playRightBtn').disabled = !playableInfo.right;
    
    // Auto play if only one side works
    if (playableInfo.left && !playableInfo.right) playSelectedTile('left');
    else if (playableInfo.right && !playableInfo.left) playSelectedTile('right');
  } else {
    $('playLeftBtn').disabled = true;
    $('playRightBtn').disabled = true;
  }
}

function playSelectedTile(side) {
  if (!STATE.selectedTile) return;
  socket.emit('playTile', { tileId: STATE.selectedTile, side });
  STATE.selectedTile = null;
  $('playLeftBtn').disabled = true;
  $('playRightBtn').disabled = true;
}

// ===== GAME LOGIC =====
function getBoardEnds(board) {
  if (!board || board.length === 0) return { left: null, right: null };
  return { left: board[0].left, right: board[board.length-1].right };
}

function canPlayTile(tile, board) {
  if (!board || board.length === 0) return { left: true, right: true };
  const ends = getBoardEnds(board);
  return {
    left: tile.left === ends.left || tile.right === ends.left,
    right: tile.left === ends.right || tile.right === ends.right
  };
}

function checkAnyPlayable(hand, board) {
  if (!board || board.length === 0) return true;
  return hand.some(t => {
    const c = canPlayTile(t, board);
    return c.left || c.right;
  });
}

// ===== WINNER =====
function showWinner(state) {
  const me = state.players.find(p => p.id === socket.id);
  const isWinner = state.winner.playerId === socket.id;
  const isGameOver = state.winner.gameOver;
  
  $('trophyEmoji').textContent = isGameOver ? (isWinner ? '🏆' : '😔') : (isWinner ? '🎉' : '⚡');
  
  if (isGameOver) {
    $('winnerTitle').textContent = isWinner ? '🎊 سەرکەوتنی یاری!' : 'یاریەکە کۆتایی هات';
    $('winnerSubtitle').textContent = isWinner ? `پیرۆزە! تۆ بوویتە پاڵەوان!` : `${state.winner.name} بردیەوە`;
  } else {
    $('winnerTitle').textContent = isWinner ? '✨ ڕاوندت بردەوە!' : 'ڕاوند کۆتایی هات';
    $('winnerSubtitle').textContent = `${state.winner.name} +${state.winner.points} خاڵی وەرگرت`;
  }
  
  // Score table
  const table = $('scoreTable');
  table.innerHTML = '';
  state.players.forEach(p => {
    const row = document.createElement('div');
    row.className = `score-row ${p.id === state.winner.playerId ? 'winner' : ''}`;
    row.innerHTML = `<span>${p.avatar} ${p.name}</span><span>${p.score} خاڵ</span>`;
    table.appendChild(row);
  });
  
  // Rewards
  if (isGameOver && isWinner) {
    const xpAmount = STATE.currentMode === 'quick' ? 50 : (STATE.currentMode === 'ai' && STATE.aiOptions.difficulty === 'hard' ? 80 : 30);
    const coinsAmount = STATE.currentMode === 'quick' ? 50 : 30;
    $('xpEarned').textContent = xpAmount;
    $('coinsEarned').textContent = coinsAmount;
    $('rewardsShown').style.display = 'flex';
    
    addXP(xpAmount);
    STATE.profile.coins += coinsAmount;
    
    // Stats
    STATE.profile.stats.wins++;
    STATE.profile.stats.games++;
    STATE.profile.currentStreak = (STATE.profile.currentStreak || 0) + 1;
    if (STATE.profile.currentStreak > (STATE.profile.bestStreak || 0)) {
      STATE.profile.bestStreak = STATE.profile.currentStreak;
    }
    
    if (STATE.currentMode === 'ai' && STATE.aiOptions.difficulty === 'hard') {
      STATE.profile.beatHardAI = true;
    }
    
    addHistoryEntry({ mode: STATE.currentMode || 'quick', result: 'win' });
    triggerConfetti();
    playSound('win');
  } else if (isGameOver && !isWinner) {
    $('rewardsShown').style.display = 'none';
    STATE.profile.stats.losses++;
    STATE.profile.stats.games++;
    STATE.profile.currentStreak = 0;
    addHistoryEntry({ mode: STATE.currentMode || 'quick', result: 'loss' });
    playSound('error');
  } else {
    $('rewardsShown').style.display = 'none';
  }
  
  saveProfile();
  renderProfile();
  renderResources();
  
  if (isGameOver) checkAchievements();
  
  // Hide next round button if game over
  $('nextRoundBtn').style.display = isGameOver ? 'none' : 'flex';
  
  $('winnerModal').classList.add('active');
}

// ===== CHAT =====
function openChat() {
  $('chatPanel').classList.add('active');
  STATE.unreadChat = 0;
  STATE.lobbyUnreadChat = 0;
  updateChatBadges();
  setTimeout(() => {
    $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
  }, 100);
}

function closeChat() {
  $('chatPanel').classList.remove('active');
}

function sendChatText() {
  const text = $('chatInput').value.trim();
  if (!text) return;
  socket.emit('sendChat', { text });
  $('chatInput').value = '';
}

function sendChatEmoji(emoji) {
  socket.emit('sendChat', { emoji });
  vibrate(30);
}

function addChatMessageToUI(msg) {
  const messages = $('chatMessages');
  const empty = messages.querySelector('.chat-empty');
  if (empty) empty.remove();
  
  const div = document.createElement('div');
  const isMine = msg.senderId === socket.id;
  div.className = `chat-msg ${msg.isSystem ? 'system' : (isMine ? 'mine' : '')}`;
  
  if (msg.isSystem) {
    div.innerHTML = `<div class="cm-bubble">${msg.text}</div>`;
  } else {
    const content = msg.emoji ? `<div class="cm-emoji">${msg.emoji}</div>` : `<div class="cm-text">${escapeHTML(msg.text)}</div>`;
    div.innerHTML = `
      <div class="cm-avatar">${msg.senderAvatar || '👤'}</div>
      <div class="cm-bubble">
        <div class="cm-name">${escapeHTML(msg.senderName)}</div>
        ${content}
      </div>
    `;
  }
  
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function updateChatBadges() {
  const lobby = $('lobbyChatBadge');
  const game = $('gameChatBadge');
  if (STATE.lobbyUnreadChat > 0) {
    lobby.style.display = 'block';
    lobby.textContent = STATE.lobbyUnreadChat > 9 ? '9+' : STATE.lobbyUnreadChat;
  } else lobby.style.display = 'none';
  
  if (STATE.unreadChat > 0) {
    game.style.display = 'block';
    game.textContent = STATE.unreadChat > 9 ? '9+' : STATE.unreadChat;
  } else game.style.display = 'none';
}

function escapeHTML(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ===== FX =====
function showToast(msg, type = 'success') {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function showRewardToast(msg) {
  const toast = $('rewardToast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function vibrate(pattern) {
  if (STATE.settings?.vibrate && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

let audioCtx = null;
function playSound(type) {
  if (!STATE.settings?.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    
    const sounds = {
      place: { freq: 200, dur: 0.1, type: 'sine' },
      select: { freq: 600, dur: 0.05, type: 'sine' },
      win: { freq: 800, dur: 0.3, type: 'sine' },
      error: { freq: 150, dur: 0.2, type: 'square' },
      turn: { freq: 1000, dur: 0.1, type: 'sine' }
    };
    const s = sounds[type] || sounds.select;
    o.type = s.type;
    o.frequency.value = s.freq;
    g.gain.setValueAtTime(0.15, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + s.dur);
    o.start();
    o.stop(audioCtx.currentTime + s.dur);
  } catch (e) {}
}

function setupParticles() {
  if (!STATE.settings?.particles) return;
  const container = $('particles');
  for (let i = 0; i < 25; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = (15 + Math.random() * 15) + 's';
    p.style.animationDelay = Math.random() * 15 + 's';
    p.style.opacity = (0.3 + Math.random() * 0.5);
    container.appendChild(p);
  }
}

function triggerConfetti() {
  if (!STATE.settings?.animations) return;
  const container = $('confettiContainer');
  const colors = ['#f093fb', '#f5576c', '#4facfe', '#00f2fe', '#feca57', '#48dbfb', '#ffd700'];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDuration = (2.5 + Math.random() * 1.5) + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(c);
    setTimeout(() => c.remove(), 5000);
  }
}

// Service worker registration for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ===== START =====
document.addEventListener('DOMContentLoaded', init);
