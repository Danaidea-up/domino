// ============================================
// 🎲 Kurdish Domino - Main App
// 4-direction board, multiples of 5 scoring
// ============================================

const $ = (id) => document.getElementById(id);
const socket = io({ transports: ['websocket', 'polling'] });

const STATE = {
  sessionId: localStorage.getItem('domino_session') || null,
  profile: null, settings: null, achievements: [], history: [],
  gameState: null, currentMode: null, selectedTile: null,
  searchTimer: null, searchSeconds: 0,
  unreadChat: 0, lobbyUnreadChat: 0,
  pwaPrompt: null,
  aiOptions: { bots: 1, difficulty: 'medium', teams: false },
  friendsOptions: { score: 350, teams: false }
};

const AVATARS = ['😎','🤩','🥳','🦁','🐯','🐱','🐶','🦊','🐼','🐨','🐸','🦄','🐲','🦅','🦉','🐺','🐻','🦝','🐧','🦋','🌟','⚡','🔥','💎'];

const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🥇', name: 'یەکەم سەرکەوتن', desc: 'یەکەم یاری بدۆڕێنە', check: (s) => s.wins >= 1 },
  { id: 'wins_5', icon: '⭐', name: '٥ سەرکەوتن', desc: '٥ یاری بدۆڕێنە', check: (s) => s.wins >= 5 },
  { id: 'wins_10', icon: '🌟', name: '١٠ سەرکەوتن', desc: '١٠ یاری بدۆڕێنە', check: (s) => s.wins >= 10 },
  { id: 'wins_25', icon: '💫', name: '٢٥ سەرکەوتن', desc: '٢٥ یاری بدۆڕێنە', check: (s) => s.wins >= 25 },
  { id: 'wins_50', icon: '🏆', name: '٥٠ سەرکەوتن', desc: '٥٠ یاری بدۆڕێنە', check: (s) => s.wins >= 50 },
  { id: 'wins_100', icon: '👑', name: 'پاڵەوان', desc: '١٠٠ یاری بدۆڕێنە', check: (s) => s.wins >= 100 },
  { id: 'games_10', icon: '🎮', name: 'یاریزان', desc: '١٠ یاری بکە', check: (s) => s.games >= 10 },
  { id: 'games_50', icon: '🎯', name: 'بێهیلانە', desc: '٥٠ یاری بکە', check: (s) => s.games >= 50 },
  { id: 'level_5', icon: '⬆️', name: 'ئاستی ٥', desc: 'بگە بە ئاستی ٥', check: (s, p) => p.level >= 5 },
  { id: 'level_10', icon: '🎖️', name: 'ئاستی ١٠', desc: 'بگە بە ئاستی ١٠', check: (s, p) => p.level >= 10 },
  { id: 'beat_hard', icon: '💀', name: 'دۆڕاندنی AI سەخت', desc: 'AI ـی سەخت بدۆڕێنە', check: (s, p) => p.beatHardAI },
  { id: 'streak_3', icon: '🔥', name: 'زنجیرەی ٣', desc: '٣ یاری ڕاسەرە بدۆڕێنە', check: (s, p) => (p.bestStreak || 0) >= 3 },
  { id: 'streak_5', icon: '🌋', name: 'زنجیرەی ٥', desc: '٥ یاری ڕاسەرە بدۆڕێنە', check: (s, p) => (p.bestStreak || 0) >= 5 },
  { id: 'big_score', icon: '⭐', name: 'ژمارەی گەورە', desc: 'لە یەک دانان ٢٥+ خاڵ وەربگرە', check: (s, p) => p.bigScore },
  { id: 'team_win', icon: '🤝', name: 'سەرکەوتنی تیمی', desc: 'لە مۆدی تیمی سەرکەوە', check: (s, p) => p.teamWin },
  { id: 'rich_500', icon: '💰', name: 'دەوڵەمەند', desc: '٥٠٠ پارە کۆبکەرەوە', check: (s, p) => (p.coins || 0) >= 500 },
  { id: 'rich_2000', icon: '💎', name: 'مولیۆنێر', desc: '٢٠٠٠ پارە کۆبکەرەوە', check: (s, p) => (p.coins || 0) >= 2000 },
  { id: 'win_rate_70', icon: '📈', name: 'پاڵەوانی ڕاستەقینە', desc: '٢٠+ یاری و ڕێژە ٧٠٪', check: (s) => s.games >= 20 && (s.wins/s.games) >= 0.7 },
  { id: 'play_all_modes', icon: '🌟', name: 'هەمەلایەنە', desc: 'هەموو شێوازەکان تاقیبکەوە', check: (s, p) => p.modesPlayed && p.modesPlayed.length >= 3 },
  { id: 'first_score', icon: '🎯', name: 'یەکەم خاڵ', desc: 'یەکەم خاڵت وەربگرە', check: (s, p) => p.firstScore }
];

// ===== INIT =====
async function init() {
  loadProfile();
  loadSettings();
  loadAchievements();
  loadHistory();
  applySettings();
  applyLanguage(STATE.settings.language || 'ckb');
  setupEventListeners();
  setupSocketListeners();
  setupAuthListeners();
  setupParticles();
  
  setTimeout(() => $('splash').classList.add('hide'), 1200);
  
  // Check authentication status
  await checkAuthAndRoute();
}

// Check if user has saved auth token, decide which screen to show
async function checkAuthAndRoute() {
  // Check Google auth config
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    STATE.googleEnabled = data.googleEnabled;
    STATE.googleClientId = data.googleClientId;
    
    if (data.googleEnabled && data.googleClientId) {
      // Configure Google Sign-In
      const onloadDiv = document.getElementById('g_id_onload');
      if (onloadDiv) onloadDiv.setAttribute('data-client_id', data.googleClientId);
      $('googleSignInWrapper').style.display = 'flex';
    }
  } catch (err) {
    console.warn('Auth status check failed:', err);
    STATE.googleEnabled = false;
  }
  
  // Check for saved JWT token
  const token = localStorage.getItem('domino_token');
  if (token) {
    // Verify token with server
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        STATE.googleToken = token;
        STATE.googleUser = data.user;
        // Apply Google user data to profile
        STATE.profile.name = data.user.name;
        STATE.profile.googlePicture = data.user.picture;
        STATE.profile.isGoogleUser = true;
        saveProfile();
        showScreen('homeScreen');
        renderProfile();
        renderResources();
        setTimeout(checkDailyReward, 1500);
        connectSocket();
        return;
      } else {
        // Token invalid - clear it
        localStorage.removeItem('domino_token');
      }
    } catch (err) {
      console.warn('Token verification failed:', err);
    }
  }
  
  // Check if guest user already has profile
  const hasGuestProfile = localStorage.getItem('domino_session');
  if (hasGuestProfile && STATE.profile.name && STATE.profile.name !== 'یاریزان') {
    // Returning guest - go straight to home
    showScreen('homeScreen');
    renderProfile();
    renderResources();
    setTimeout(checkDailyReward, 1500);
    connectSocket();
    return;
  }
  
  // First-time user - show login screen
  showScreen('loginScreen');
}

// Connect to socket (called after login decision)
function connectSocket() {
  if (STATE.socketConnected) return;
  STATE.socketConnected = true;
  
  socket.on('connect', () => {
    socket.emit('initSession', {
      sessionId: STATE.sessionId,
      playerName: STATE.profile.name,
      avatar: STATE.profile.avatar,
      level: STATE.profile.level,
      token: STATE.googleToken || null
    });
    
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if (roomCode) {
      setTimeout(() => {
        socket.emit('joinRoom', {
          roomId: roomCode.toUpperCase(),
          playerName: STATE.profile.name, avatar: STATE.profile.avatar,
          level: STATE.profile.level
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 500);
    }
  });
  
  // Trigger connection if already connected
  if (socket.connected) {
    socket.emit('initSession', {
      sessionId: STATE.sessionId,
      playerName: STATE.profile.name,
      avatar: STATE.profile.avatar,
      level: STATE.profile.level,
      token: STATE.googleToken || null
    });
  }
  
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    STATE.pwaPrompt = e;
    $('installPWABtn').style.display = 'flex';
  });
  if (window.matchMedia('(display-mode: standalone)').matches) {
    $('pwaInstalledText').style.display = 'block';
  }
}

// ===== AUTH HANDLERS =====
function setupAuthListeners() {
  // Continue as Guest
  $('continueAsGuestBtn').onclick = () => {
    // Set up basic guest profile
    if (!STATE.profile.name || STATE.profile.name === 'یاریزان') {
      // Generate a fun guest name
      const guestNames = ['میوان', 'یاریزانی نوێ', 'دۆستی نوێ'];
      STATE.profile.name = guestNames[Math.floor(Math.random() * guestNames.length)];
      saveProfile();
    }
    showScreen('homeScreen');
    renderProfile();
    renderResources();
    setTimeout(checkDailyReward, 1500);
    connectSocket();
    showToast('👋 بە خێر بێیت وەک میوان!');
  };
  
  // Logout
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = handleLogout;
  }
}

// Global callback for Google Sign-In (called by Google's library)
window.handleGoogleSignIn = async (response) => {
  if (!response || !response.credential) {
    showToast('چوونەژوور سەرنەکەوت', 'error');
    return;
  }
  
  try {
    showToast('⏳ پشتڕاستکردنەوە...');
    
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: response.credential })
    });
    
    if (!res.ok) throw new Error('Auth failed');
    
    const data = await res.json();
    
    // Save token
    STATE.googleToken = data.token;
    localStorage.setItem('domino_token', data.token);
    STATE.googleUser = data.user;
    
    // Update profile from Google data
    STATE.profile.name = data.user.name;
    STATE.profile.googlePicture = data.user.picture;
    STATE.profile.isGoogleUser = true;
    STATE.profile.email = data.user.email;
    
    // Sync from DB if available
    if (data.user.level) STATE.profile.level = data.user.level;
    if (data.user.xp) STATE.profile.xp = data.user.xp;
    if (data.user.coins) STATE.profile.coins = data.user.coins;
    if (data.user.gems) STATE.profile.gems = data.user.gems;
    if (data.user.stats) STATE.profile.stats = data.user.stats;
    if (data.user.avatar) STATE.profile.avatar = data.user.avatar;
    if (data.user.sessionId) {
      STATE.sessionId = data.user.sessionId;
      localStorage.setItem('domino_session', data.user.sessionId);
    }
    
    saveProfile();
    
    showToast(`✅ بە خێر بێیت ${data.user.name}!`);
    showScreen('homeScreen');
    renderProfile();
    renderResources();
    setTimeout(checkDailyReward, 1500);
    connectSocket();
  } catch (err) {
    console.error('Google sign-in error:', err);
    showToast('چوونەژوور سەرنەکەوت', 'error');
  }
};

async function handleLogout() {
  if (!confirm('دڵنیایت دەتەوێت دەرچیت؟')) return;
  
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {}
  
  // Clear all auth data
  localStorage.removeItem('domino_token');
  STATE.googleToken = null;
  STATE.googleUser = null;
  STATE.profile.isGoogleUser = false;
  STATE.profile.googlePicture = null;
  saveProfile();
  
  // Reload to clear state
  showToast('👋 بە سەلامەتی!');
  setTimeout(() => location.reload(), 1000);
}

// ===== PROFILE =====
function loadProfile() {
  const saved = localStorage.getItem('domino_profile');
  STATE.profile = saved ? JSON.parse(saved) : {
    name: 'یاریزان', avatar: '😎', level: 1, xp: 0, coins: 0, gems: 0,
    stats: { wins: 0, losses: 0, games: 0 },
    currentStreak: 0, bestStreak: 0, beatHardAI: false,
    modesPlayed: [], bigScore: false, teamWin: false, firstScore: false
  };
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
  
  // Show Google picture if available, else emoji avatar
  const useGooglePic = p.isGoogleUser && p.googlePicture;
  
  if (useGooglePic) {
    $('pillAvatar').innerHTML = `<img src="${escapeAttr(p.googlePicture)}" alt="${escapeAttr(p.name)}" referrerpolicy="no-referrer">`;
  } else {
    $('pillAvatar').textContent = p.avatar;
  }
  
  $('pillName').textContent = p.name;
  $('pillLevel').textContent = p.level;
  
  const xpForNext = xpRequiredForLevel(p.level + 1);
  const xpForCurrent = xpRequiredForLevel(p.level);
  const xpProgress = ((p.xp - xpForCurrent) / (xpForNext - xpForCurrent)) * 100;
  $('pillXP').style.width = Math.max(0, Math.min(100, xpProgress)) + '%';
  
  if (useGooglePic) {
    $('phAvatar').innerHTML = `<img src="${escapeAttr(p.googlePicture)}" alt="${escapeAttr(p.name)}" referrerpolicy="no-referrer">`;
  } else {
    $('phAvatar').textContent = p.avatar;
  }
  $('phName').textContent = p.name;
  $('phLevel').textContent = p.level;
  $('phXP').style.width = Math.max(0, Math.min(100, xpProgress)) + '%';
  $('phXPText').textContent = `${p.xp - xpForCurrent}/${xpForNext - xpForCurrent} XP`;
  
  const s = p.stats || { wins: 0, losses: 0, games: 0 };
  $('statWins').textContent = s.wins;
  $('statLosses').textContent = s.losses;
  $('statGames').textContent = s.games;
  const winRate = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
  $('statWinRate').textContent = winRate + '%';
  
  // Update account info card in settings
  const accountCard = $('accountInfoCard');
  if (accountCard) {
    accountCard.style.display = 'block';
    
    if (useGooglePic) {
      $('accountAvatar').innerHTML = `<img src="${escapeAttr(p.googlePicture)}" alt="${escapeAttr(p.name)}" referrerpolicy="no-referrer">`;
    } else {
      $('accountAvatar').textContent = p.avatar;
    }
    
    $('accountName').textContent = p.name;
    
    if (p.isGoogleUser) {
      $('accountEmail').textContent = p.email || '';
      $('accountEmail').style.display = p.email ? 'block' : 'none';
      $('accountBadge').textContent = '🔐 ئەکاونتی Google';
      $('accountBadge').className = 'account-badge google';
      $('logoutBtn').style.display = 'flex';
      $('logoutBtn').textContent = '🚪 دەرچوون لە Google';
    } else {
      $('accountEmail').style.display = 'none';
      $('accountBadge').textContent = '👤 میوان';
      $('accountBadge').className = 'account-badge';
      $('logoutBtn').style.display = 'none';
    }
  }
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
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
  STATE.profile.coins += 50;
  STATE.profile.gems += 1;
  saveProfile();
  renderResources();
}

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

// ===== DAILY =====
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
    list.innerHTML = '<div class="history-empty">📭 هیچ یاریەکت نییە</div>';
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

function renderLeaderboard() {
  const list = $('leaderboardList');
  list.innerHTML = '<div style="text-align:center; padding:30px;">⏳ بارکردن...</div>';
  fetch('/api/leaderboard').then(r => r.json()).then(data => {
    list.innerHTML = '';
    if (!data.hasDB) { showLocalLeaderboard(list); return; }
    if (data.leaderboard.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-dim);">📭 هێشتا کەس یاری نەکردووە</div>';
      return;
    }
    data.leaderboard.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'lb-item';
      const rankClass = idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : '';
      const isMe = p.name === STATE.profile.name;
      if (isMe) item.style.background = 'linear-gradient(135deg, rgba(240,147,251,0.2), rgba(245,87,108,0.2))';
      item.innerHTML = `
        <div class="lb-rank ${rankClass}">${idx < 3 ? ['🥇','🥈','🥉'][idx] : (idx+1)}</div>
        <div class="pill-avatar">${p.avatar}</div>
        <div style="flex:1;">
          <div style="font-weight:700;">${escapeHTML(p.name)}${isMe ? ' (تۆ)' : ''}</div>
          <div style="font-size:0.8rem; color:var(--text-dim);">ئاست ${p.level} · ${p.wins} سەرکەوتن</div>
        </div>
        <div style="color:var(--gold); font-weight:800;">${p.xp} XP</div>
      `;
      list.appendChild(item);
    });
  }).catch(() => { list.innerHTML = ''; showLocalLeaderboard(list); });
}

function showLocalLeaderboard(list) {
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
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
  document.querySelectorAll('.mode-card').forEach(card => {
    card.onclick = () => {
      const mode = card.dataset.mode;
      STATE.currentMode = mode;
      if (mode === 'quick') startQuickMatch();
      else if (mode === 'ai') showScreen('aiSetupScreen');
      else if (mode === 'friends') showScreen('friendsSetupScreen');
    };
  });
  
  document.querySelectorAll('.back-btn').forEach(btn => {
    if (btn.id === 'leaveLobbyBtn') btn.onclick = leaveLobby;
    else btn.onclick = () => showScreen('homeScreen');
  });
  
  // AI Setup
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
  
  // Team mode toggle for AI
  $('aiTeamsToggle').onclick = () => {
    STATE.aiOptions.teams = !STATE.aiOptions.teams;
    $('aiTeamsToggle').classList.toggle('on', STATE.aiOptions.teams);
    if (STATE.aiOptions.teams) STATE.aiOptions.bots = 3;
    document.querySelectorAll('#botCount .option-pill').forEach(b => {
      b.classList.toggle('selected', parseInt(b.dataset.bots) === STATE.aiOptions.bots);
    });
  };
  
  $('startAIBtn').onclick = startVsAI;
  
  // Friends Setup
  document.querySelectorAll('#targetScore .option-pill').forEach(p => {
    p.onclick = () => {
      document.querySelectorAll('#targetScore .option-pill').forEach(b => b.classList.remove('selected'));
      p.classList.add('selected');
      STATE.friendsOptions.score = parseInt(p.dataset.score);
    };
  });
  $('friendsTeamsToggle').onclick = () => {
    STATE.friendsOptions.teams = !STATE.friendsOptions.teams;
    $('friendsTeamsToggle').classList.toggle('on', STATE.friendsOptions.teams);
  };
  
  $('createRoomBtn').onclick = createRoom;
  $('joinRoomBtn').onclick = joinRoom;
  $('roomCodeInput').oninput = (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  };
  
  $('cancelSearchBtn').onclick = () => {
    socket.emit('cancelQuickMatch');
    stopSearchTimer();
    showScreen('homeScreen');
  };
  
  $('roomCodePro').onclick = copyRoomCode;
  $('startGameBtn').onclick = () => socket.emit('startGame');
  $('addBotBtn').onclick = () => socket.emit('startGame', { addBots: true });
  
  $('shareWhatsappBtn').onclick = () => shareRoom('whatsapp');
  $('shareTelegramBtn').onclick = () => shareRoom('telegram');
  $('shareLinkBtn').onclick = () => shareRoom('link');
  
  // Game controls
  $('gameMenuBtn').onclick = () => $('menuModal').classList.add('active');
  $('resumeBtn').onclick = () => $('menuModal').classList.remove('active');
  $('leaveGameBtn').onclick = () => {
    $('menuModal').classList.remove('active');
    socket.emit('leaveRoom');
    showScreen('homeScreen');
  };
  $('rulesBtn').onclick = () => {
    $('menuModal').classList.remove('active');
    $('rulesPanel').classList.add('active');
  };
  $('closeRulesBtn').onclick = () => $('rulesPanel').classList.remove('active');
  
  // Direction buttons (Kurdish-specific)
  $('playRightBtn').onclick = () => playSelectedTile('right');
  $('playLeftBtn').onclick = () => playSelectedTile('left');
  $('playUpBtn').onclick = () => playSelectedTile('up');
  $('playDownBtn').onclick = () => playSelectedTile('down');
  
  $('drawBtn').onclick = () => { socket.emit('drawTile'); playSound('select'); };
  $('passBtn').onclick = () => { socket.emit('passTurn'); playSound('select'); };
  $('boneyardBtn').onclick = () => showToast(`📦 ${STATE.gameState?.boneyardCount || 0} لە بانک`);
  
  // Chat
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
  $('achievementsBtn').onclick = () => { renderAchievements(); $('achievementsPanel').classList.add('active'); };
  $('closeAchievementsBtn').onclick = () => $('achievementsPanel').classList.remove('active');
  $('playerPill').onclick = openProfile;
  $('profileBtn').onclick = openProfile;
  $('closeProfileBtn').onclick = () => $('profilePanel').classList.remove('active');
  $('saveProfileBtn').onclick = saveProfileChanges;
  $('historyBtn').onclick = () => { renderHistory(); $('historyPanel').classList.add('active'); };
  $('closeHistoryBtn').onclick = () => $('historyPanel').classList.remove('active');
  $('leaderboardBtn').onclick = () => { renderLeaderboard(); $('leaderboardPanel').classList.add('active'); };
  $('closeLeaderboardBtn').onclick = () => $('leaderboardPanel').classList.remove('active');
  
  // Modals
  $('nextRoundBtn').onclick = () => { $('winnerModal').classList.remove('active'); socket.emit('nextRound'); };
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
    if (t.id === 'aiTeamsToggle' || t.id === 'friendsTeamsToggle') return;
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
      // Also logout from server
      fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
        location.reload();
      });
    }
  };
}

function openProfile() {
  renderAvatarGrid();
  $('nameInput').value = STATE.profile.name;
  
  // Disable name change for Google users
  if (STATE.profile.isGoogleUser) {
    $('nameInput').disabled = true;
    $('nameInput').style.opacity = '0.6';
    $('nameInput').title = 'ناو لە ئەکاونتی Google دێت';
    // Show note
    let note = document.getElementById('googleNameNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'googleNameNote';
      note.style.cssText = 'font-size:0.78rem; color:var(--text-dim); margin-top:6px; padding:8px; background:var(--glass-strong); border-radius:8px;';
      note.innerHTML = '🔐 ناوەکەت لە Google دێت و ناتوانرێت بگۆڕدرێت';
      $('nameInput').parentNode.appendChild(note);
    }
    note.style.display = 'block';
  } else {
    $('nameInput').disabled = false;
    $('nameInput').style.opacity = '';
    const note = document.getElementById('googleNameNote');
    if (note) note.style.display = 'none';
  }
  
  $('profilePanel').classList.add('active');
}

function saveProfileChanges() {
  // Google users can only change avatar
  if (!STATE.profile.isGoogleUser) {
    const name = $('nameInput').value.trim();
    if (name) STATE.profile.name = name;
  }
  saveProfile();
  renderProfile();
  $('profilePanel').classList.remove('active');
  showToast('✅ پاراست');
  socket.emit('initSession', {
    sessionId: STATE.sessionId, 
    playerName: STATE.profile.name,
    avatar: STATE.profile.avatar, 
    level: STATE.profile.level,
    token: STATE.googleToken || null
  });
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
  if (screenId === 'gameScreen') STATE.unreadChat = 0;
  if (screenId === 'lobbyScreen') STATE.lobbyUnreadChat = 0;
  updateChatBadges();
}

function startQuickMatch() {
  socket.emit('quickMatch', {
    playerName: STATE.profile.name, avatar: STATE.profile.avatar, level: STATE.profile.level
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
    playerName: STATE.profile.name, avatar: STATE.profile.avatar,
    level: STATE.profile.level, difficulty: STATE.aiOptions.difficulty,
    numBots: STATE.aiOptions.teams ? 3 : STATE.aiOptions.bots,
    teams: STATE.aiOptions.teams
  });
}

function createRoom() {
  if (!STATE.profile.modesPlayed.includes('friends')) {
    STATE.profile.modesPlayed.push('friends');
    saveProfile();
  }
  socket.emit('createRoom', {
    playerName: STATE.profile.name, avatar: STATE.profile.avatar,
    level: STATE.profile.level, targetScore: STATE.friendsOptions.score,
    teams: STATE.friendsOptions.teams
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
    roomId: code, playerName: STATE.profile.name,
    avatar: STATE.profile.avatar, level: STATE.profile.level
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

function shareRoom(platform) {
  const code = $('roomCodeText').textContent;
  const url = `${window.location.origin}/?room=${code}`;
  const message = `🎲 وەرە یاری دۆمینۆ بکەین!\n\nکۆدی ژوور: ${code}\nلینک: ${url}`;
  vibrate(50);
  if (platform === 'whatsapp') {
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  } else if (platform === 'telegram') {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent('🎲 یاری دۆمینۆ! کۆد: ' + code)}`, '_blank');
  } else if (platform === 'link') {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      showToast('✓ لینک کۆپی کرا!');
    }
  }
}

// ===== TURN TIMER =====
let turnTimerInterval = null;
function updateTurnTimer(deadline) {
  const timer = $('turnTimer');
  const fill = $('ttFill');
  const text = $('ttText');
  if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
  if (!deadline) { timer.style.display = 'none'; return; }
  timer.style.display = 'flex';
  const update = () => {
    const remaining = Math.max(0, deadline - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const percent = Math.max(0, Math.min(100, (remaining / 45000) * 100));
    fill.style.width = percent + '%';
    text.textContent = seconds + 'ث';
    fill.classList.remove('warning', 'danger');
    if (seconds <= 10) fill.classList.add('danger');
    else if (seconds <= 20) fill.classList.add('warning');
    if (remaining <= 0) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
  };
  update();
  turnTimerInterval = setInterval(update, 250);
}

// Tab title flash
let originalTitle = document.title;
let titleFlashInterval = null;
function flashTabTitle(message) {
  if (!document.hidden) return;
  if (titleFlashInterval) return;
  let flip = false;
  titleFlashInterval = setInterval(() => {
    document.title = flip ? originalTitle : message;
    flip = !flip;
  }, 1000);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
    document.title = originalTitle;
  }
});

// ===== SOCKET =====
function setupSocketListeners() {
  socket.on('sessionReady', ({ sessionId, dbPlayer }) => {
    STATE.sessionId = sessionId;
    localStorage.setItem('domino_session', sessionId);
    if (dbPlayer) {
      let updated = false;
      if (dbPlayer.xp > STATE.profile.xp) { STATE.profile.xp = dbPlayer.xp; updated = true; }
      if (dbPlayer.level > STATE.profile.level) { STATE.profile.level = dbPlayer.level; updated = true; }
      if (dbPlayer.coins > STATE.profile.coins) { STATE.profile.coins = dbPlayer.coins; updated = true; }
      if (dbPlayer.gems > STATE.profile.gems) { STATE.profile.gems = dbPlayer.gems; updated = true; }
      if (dbPlayer.stats.wins > STATE.profile.stats.wins) { STATE.profile.stats = dbPlayer.stats; updated = true; }
      if (updated) { saveProfile(); renderProfile(); renderResources(); }
    }
  });
  
  socket.on('reconnected', ({ roomId, started, chatHistory }) => {
    showToast('✅ گەڕایتەوە بۆ یاری!');
    if (chatHistory) {
      $('chatMessages').innerHTML = '';
      chatHistory.forEach(msg => addChatMessageToUI(msg));
    }
    showScreen(started ? 'gameScreen' : 'lobbyScreen');
  });
  
  socket.on('stats', ({ onlinePlayers, activeRooms }) => {
    $('onlineCount').textContent = onlinePlayers;
    $('roomsCount').textContent = activeRooms;
  });
  
  socket.on('searching', () => {});
  
  socket.on('matchFound', ({ roomId, withBot }) => {
    stopSearchTimer();
    showToast(withBot ? '🤖 ڕۆبۆتێک زیاد کرا!' : '✅ یاریزانێک دۆزرایەوە!');
  });
  
  socket.on('roomCreated', ({ roomId, isVsAI, isPrivate }) => {
    if (isVsAI) showScreen('gameScreen');
    else { $('roomCodeText').textContent = roomId; showScreen('lobbyScreen'); }
  });
  
  socket.on('roomJoined', ({ roomId }) => {
    $('roomCodeText').textContent = roomId;
    showScreen('lobbyScreen');
  });
  
  socket.on('lobbyUpdate', (data) => {
    $('roomCodeText').textContent = data.roomId;
    $('lobbyTargetScore').textContent = data.targetScore;
    renderLobbyPlayers(data.players, data.teams);
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
    showToast('❌ پەیوەندی داشکا...', 'error');
  });
}

// ===== LOBBY RENDERING =====
function renderLobbyPlayers(players, teams) {
  const slots = $('playerSlots');
  slots.innerHTML = '';
  $('playersCount').textContent = players.length;
  
  if (teams) {
    // Show team-based layout
    const team1 = players.filter(p => p.team === 1);
    const team2 = players.filter(p => p.team === 2);
    
    const t1Header = document.createElement('div');
    t1Header.className = 'team-header team-1-header';
    t1Header.innerHTML = '🔴 تیمی یەکەم';
    slots.appendChild(t1Header);
    [0,1].forEach(i => slots.appendChild(makePlayerSlot(team1[i], 1)));
    
    const t2Header = document.createElement('div');
    t2Header.className = 'team-header team-2-header';
    t2Header.innerHTML = '🔵 تیمی دووەم';
    slots.appendChild(t2Header);
    [0,1].forEach(i => slots.appendChild(makePlayerSlot(team2[i], 2)));
  } else {
    players.forEach(p => slots.appendChild(makePlayerSlot(p)));
    for (let i = players.length; i < 4; i++) {
      const empty = document.createElement('div');
      empty.className = 'player-slot empty';
      empty.innerHTML = `<div class="slot-avatar">+</div><div style="color:var(--text-dim);">شوێنی بەتاڵ</div>`;
      slots.appendChild(empty);
    }
  }
  
  const me = players.find(p => p.id === socket.id);
  if (me && me.isHost) {
    $('hostControls').style.display = 'block';
    $('waitingMsg').style.display = 'none';
    const minNeeded = teams ? 4 : 2;
    $('startGameBtn').disabled = players.length < minNeeded;
    $('addBotBtn').style.display = players.length < 4 ? 'flex' : 'none';
  } else {
    $('hostControls').style.display = 'none';
    $('waitingMsg').style.display = 'block';
  }
}

function makePlayerSlot(p, team) {
  if (!p) {
    const empty = document.createElement('div');
    empty.className = 'player-slot empty';
    empty.innerHTML = `<div class="slot-avatar">+</div><div style="color:var(--text-dim);">شوێنی بەتاڵ</div>`;
    return empty;
  }
  const isMe = p.id === socket.id;
  const slot = document.createElement('div');
  slot.className = `player-slot ${team ? 'team-' + team : ''}`;
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
  return slot;
}

// ===== GAME RENDERING (KURDISH 4-DIRECTION) =====
function renderGame(state) {
  $('targetScoreDisplay').textContent = state.targetScore;
  $('roundDisplay').textContent = state.round;
  $('boneyardCount').textContent = state.boneyardCount;
  
  // Open ends sum (Kurdish scoring)
  const openSum = state.openEndsSum || 0;
  $('openSumValue').textContent = openSum;
  $('openSumValue').style.color = (openSum > 0 && openSum % 5 === 0) ? '#ffd700' : 'var(--text)';
  
  // Vertical-unlock notice
  const vertNotice = $('vertUnlockNotice');
  if (vertNotice) {
    vertNotice.style.display = (state.verticalUnlocked && state.board?.isFourDirectional) ? 'block' : 'none';
  }
  
  // Turn timer
  if (state.yourTurn && state.turnDeadline) {
    updateTurnTimer(state.turnDeadline);
    flashTabTitle('🎲 نۆرەی تۆیە!');
  } else {
    updateTurnTimer(null);
  }
  
  // Players bar (with team colors if teams mode)
  const bar = $('playersBar');
  bar.innerHTML = '';
  
  if (state.teams && state.teamScores) {
    // Team scores at top
    const teamsBar = document.createElement('div');
    teamsBar.className = 'teams-score-bar';
    teamsBar.innerHTML = `
      <div class="team-score team-1-score">
        <span class="ts-label">🔴 تیم ١</span>
        <span class="ts-value">${state.teamScores.team1}</span>
      </div>
      <div class="team-vs">VS</div>
      <div class="team-score team-2-score">
        <span class="ts-label">🔵 تیم ٢</span>
        <span class="ts-value">${state.teamScores.team2}</span>
      </div>
    `;
    bar.appendChild(teamsBar);
  }
  
  const playersRow = document.createElement('div');
  playersRow.className = 'players-row';
  state.players.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = `player-card-pro ${idx === state.currentTurn ? 'current' : ''} ${!p.connected ? 'disconnected' : ''} ${p.team ? 'team-' + p.team : ''}`;
    card.innerHTML = `
      <div class="pc-avatar-pro">${p.avatar}<div class="pc-lvl">${p.level}</div></div>
      <div class="pc-name-pro">${p.name}${p.id === socket.id ? ' (تۆ)' : ''}</div>
      <div class="pc-info-pro">
        <span>🎴${p.tilesCount}</span>
        ${!state.teams ? `<span class="pc-score-pro">${p.score}</span>` : ''}
      </div>
    `;
    playersRow.appendChild(card);
  });
  bar.appendChild(playersRow);
  
  // Render the 4-direction board
  renderBoard4Direction(state.board);
  
  // Show/hide up/down buttons based on board direction mode
  const ctrlGrid = document.querySelector('.ctrl-grid-4');
  if (state.board && state.board.center && !state.board.isFourDirectional) {
    ctrlGrid.classList.add('two-dir-only');
  } else {
    ctrlGrid.classList.remove('two-dir-only');
  }
  
  // Render hand
  renderHand(state.yourHand || [], state.board, state.yourTurn);
  
  // Title
  if (state.yourTurn) {
    if (state.chooseFirstTile) {
      $('handTitle').innerHTML = '<b style="color:var(--gold); font-size: 1rem;">🏆 تۆ بردتەوە! دۆمینۆیەک هەڵبژێرە بۆ دەستپێکردن</b>';
    } else if (!state.board.center) {
      $('handTitle').innerHTML = '<b style="color:var(--gold); font-size: 1rem;">🌟 یەکەم دانان - نۆرەی تۆیە!</b>';
    } else {
      $('handTitle').innerHTML = '<b style="color:var(--success); font-size: 1rem;">✨ نۆرەی تۆیە! دۆمینۆیەک هەڵبژێرە</b>';
    }
  } else {
    $('handTitle').innerHTML = `<span style="color: var(--text-dim);">⏳ نۆرەی <b style="color: var(--primary);">${state.currentPlayerName}</b>...</span>`;
  }
  
  // Controls
  if (!state.yourTurn) {
    ['playRightBtn','playLeftBtn','playUpBtn','playDownBtn'].forEach(id => $(id).disabled = true);
    $('drawBtn').disabled = true;
    $('passBtn').disabled = true;
  } else {
    const hasPlayable = checkAnyPlayable(state.yourHand || [], state.board);
    $('drawBtn').disabled = state.boneyardCount === 0 || hasPlayable || state.chooseFirstTile;
    $('passBtn').disabled = state.boneyardCount > 0 || hasPlayable || !state.board.center;
  }
  
  // Show scoring popup if last move scored
  if (state.lastMove && state.lastMove.scoreEarned > 0) {
    showScoreToast(state.lastMove.scoreEarned);
    playSound('win');
    if (state.lastMove.scoreEarned >= 25) {
      STATE.profile.bigScore = true;
      saveProfile();
    }
    if (!STATE.profile.firstScore) {
      STATE.profile.firstScore = true;
      saveProfile();
    }
  }
  
  if (state.lastMove && state.lastMove.action === 'play') {
    playSound('place');
    vibrate(30);
  }
}

// ===== 4-DIRECTION BOARD RENDERING =====
function renderBoard4Direction(board) {
  const boardEl = $('board');
  boardEl.innerHTML = '';
  
  if (!board || !board.center) {
    boardEl.classList.add('empty');
    return;
  }
  boardEl.classList.remove('empty');
  
  const layout = document.createElement('div');
  layout.className = `board-layout ${board.isFourDirectional ? 'four-dir' : 'two-dir'}`;
  
  if (board.isFourDirectional) {
    // 4-direction layout structure:
    //   [up branch]      ← centered absolutely above the center tile
    //   [left ← center → right]
    //   [down branch]    ← centered absolutely below the center tile
    //
    // To position up/down ABOVE/BELOW just the center (not the whole row),
    // we use position: relative on the middle row and absolute positioning for up/down,
    // OR simpler: we make up/down their own flex rows but with same width as center
    
    // UP branch wrapper - just the up branch, centered
    if (board.up.length > 0) {
      const upBranch = document.createElement('div');
      upBranch.className = 'branch branch-up';
      [...board.up].reverse().forEach(t => upBranch.appendChild(createTileElement(t, 'vertical')));
      layout.appendChild(upBranch);
    }
    
    // Middle row (left + center + right)
    const middleRow = document.createElement('div');
    middleRow.className = 'branch-middle';
    
    const leftBranch = document.createElement('div');
    leftBranch.className = 'branch branch-left';
    board.left.forEach(t => leftBranch.appendChild(createTileElement(t, 'horizontal')));
    middleRow.appendChild(leftBranch);
    
    const centerTile = createTileElement(board.center, 'horizontal');
    centerTile.classList.add('center-tile');
    middleRow.appendChild(centerTile);
    
    const rightBranch = document.createElement('div');
    rightBranch.className = 'branch branch-right';
    board.right.forEach(t => rightBranch.appendChild(createTileElement(t, 'horizontal')));
    middleRow.appendChild(rightBranch);
    
    layout.appendChild(middleRow);
    
    // DOWN branch
    if (board.down.length > 0) {
      const downBranch = document.createElement('div');
      downBranch.className = 'branch branch-down';
      board.down.forEach(t => downBranch.appendChild(createTileElement(t, 'vertical')));
      layout.appendChild(downBranch);
    }
    
  } else {
    // 2-direction layout: simple horizontal row [left ← center → right]
    const leftBranch = document.createElement('div');
    leftBranch.className = 'branch branch-left';
    board.left.forEach(t => leftBranch.appendChild(createTileElement(t, 'horizontal')));
    layout.appendChild(leftBranch);
    
    const centerTile = createTileElement(board.center, 'horizontal');
    centerTile.classList.add('center-tile');
    layout.appendChild(centerTile);
    
    const rightBranch = document.createElement('div');
    rightBranch.className = 'branch branch-right';
    board.right.forEach(t => rightBranch.appendChild(createTileElement(t, 'horizontal')));
    layout.appendChild(rightBranch);
  }
  
  boardEl.appendChild(layout);
  
  // Auto-scale board to fit container if it's too big
  // This prevents tiles from being clipped/lost when chains get long
  requestAnimationFrame(() => {
    autoScaleBoard(boardEl, layout);
  });
}

// Automatically scale the board down so all tiles fit visibly
function autoScaleBoard(boardEl, layout) {
  if (!boardEl || !layout) return;
  
  // Reset scale first to measure natural size
  boardEl.style.transform = '';
  
  const container = boardEl.parentElement; // .board-container-pro
  if (!container) return;
  
  const containerWidth = container.clientWidth - 16; // padding
  const containerHeight = container.clientHeight - 16;
  
  const layoutWidth = layout.scrollWidth;
  const layoutHeight = layout.scrollHeight;
  
  if (layoutWidth <= 0 || layoutHeight <= 0) return;
  
  // Calculate scale factor (use the smaller dimension to fit fully)
  const scaleX = containerWidth / layoutWidth;
  const scaleY = containerHeight / layoutHeight;
  let scale = Math.min(scaleX, scaleY, 1); // Never scale up, only down
  
  // Don't go below 35% (would be unreadable)
  scale = Math.max(scale, 0.35);
  
  if (scale < 0.99) {
    boardEl.style.transform = `scale(${scale})`;
  } else {
    boardEl.style.transform = '';
  }
}

// Re-scale on window resize (orientation change, etc.)
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const boardEl = $('board');
    const layout = boardEl?.querySelector('.board-layout');
    if (boardEl && layout) autoScaleBoard(boardEl, layout);
  }, 200);
});

function renderHand(hand, board, isYourTurn) {
  const handEl = $('hand');
  handEl.innerHTML = '';
  
  if (!hand || hand.length === 0) {
    handEl.innerHTML = '<div class="hand-empty">🎴 هیچ دۆمینۆیەکت نییە</div>';
    return;
  }
  hand.forEach(tile => {
    const t = createHandTile(tile, board, isYourTurn);
    handEl.appendChild(t);
  });
}

function createTileElement(tile, orientation) {
  const div = document.createElement('div');
  // Doubles always show perpendicular to branch direction (Kurdish rule visual)
  // If branch is horizontal, double shows vertical; if branch is vertical, double shows horizontal
  const isDoubleTile = tile._isDouble || tile.left === tile.right;
  let actualOrientation = orientation;
  
  if (isDoubleTile) {
    // Doubles are perpendicular to their branch
    actualOrientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
  }
  
  div.className = `domino ${actualOrientation}`;
  if (isDoubleTile) div.classList.add('double-tile');
  div.innerHTML = `<div class="domino-half">${createPips(tile.left)}</div><div class="domino-half">${createPips(tile.right)}</div>`;
  return div;
}

function createHandTile(tile, board, isYourTurn) {
  const div = document.createElement('div');
  div.className = 'hand-tile domino vertical'; // Add domino classes for shared styles
  div.dataset.tileId = tile.id;
  
  // First move OR chooseFirstTile - any tile is playable
  const isFirstMove = !board.center;
  const chooseFirst = STATE.gameState?.chooseFirstTile;
  
  let isPlayable = false;
  let validDirections = { right: false, left: false, up: false, down: false };
  
  if (isYourTurn) {
    if (isFirstMove || chooseFirst) {
      isPlayable = true;
    } else {
      const verticalUnlocked = STATE.gameState?.verticalUnlocked || false;
      // Check each direction
      ['right','left','up','down'].forEach(dir => {
        const end = board.ends && board.ends[dir];
        if (end !== null && end !== undefined) {
          // Vertical branches require unlock
          if ((dir === 'up' || dir === 'down') && !verticalUnlocked) return;
          
          if (tile.left === end || tile.right === end) {
            validDirections[dir] = true;
            isPlayable = true;
          }
        }
      });
    }
  }
  
  if (isPlayable) div.classList.add('playable');
  if (!isYourTurn) div.classList.add('disabled');
  if (STATE.selectedTile === tile.id) div.classList.add('selected');
  
  // Show special indicator for doubles
  if (tile.left === tile.right) div.classList.add('hand-double');
  
  div.innerHTML = `<div class="domino-half">${createPips(tile.left)}</div><div class="domino-half">${createPips(tile.right)}</div>`;
  
  div.onclick = () => {
    if (!isYourTurn) return;
    if (!isPlayable) {
      showToast('ئەم دۆمینۆیە ناگونجێت!', 'error');
      vibrate(50);
      return;
    }
    selectTile(tile.id, validDirections, isFirstMove || chooseFirst);
  };
  
  return div;
}

function createPips(value) {
  // Position grid (1-9 = 3x3):
  // 1 2 3
  // 4 5 6
  // 7 8 9
  const positions = {
    0: [],
    1: [5],           // center
    2: [1, 9],        // top-left, bottom-right
    3: [1, 5, 9],     // diagonal
    4: [1, 3, 7, 9],  // four corners
    5: [1, 3, 5, 7, 9], // four corners + center
    6: [1, 3, 4, 6, 7, 9] // two columns of 3
  };
  const pips = positions[value] || [];
  let html = '';
  for (let i = 1; i <= 9; i++) {
    if (pips.includes(i)) {
      html += '<span class="pip-cell"><span class="pip"></span></span>';
    } else {
      html += '<span class="pip-cell"></span>';
    }
  }
  return html;
}

function selectTile(tileId, validDirections, isFirstMove) {
  STATE.selectedTile = STATE.selectedTile === tileId ? null : tileId;
  document.querySelectorAll('.hand-tile').forEach(t => {
    t.classList.toggle('selected', t.dataset.tileId === STATE.selectedTile);
  });
  playSound('select');
  vibrate(20);
  
  if (!STATE.selectedTile) {
    ['playRightBtn','playLeftBtn','playUpBtn','playDownBtn'].forEach(id => $(id).disabled = true);
    return;
  }
  
  if (isFirstMove) {
    // First move - place directly
    socket.emit('playTile', { tileId: STATE.selectedTile, direction: 'first' });
    STATE.selectedTile = null;
    return;
  }
  
  // Enable valid direction buttons
  $('playRightBtn').disabled = !validDirections.right;
  $('playLeftBtn').disabled = !validDirections.left;
  $('playUpBtn').disabled = !validDirections.up;
  $('playDownBtn').disabled = !validDirections.down;
  
  // Auto-play if only one direction works
  const validCount = Object.values(validDirections).filter(v => v).length;
  if (validCount === 1) {
    const onlyDir = Object.keys(validDirections).find(k => validDirections[k]);
    setTimeout(() => playSelectedTile(onlyDir), 300);
  }
}

function playSelectedTile(direction) {
  if (!STATE.selectedTile) return;
  socket.emit('playTile', { tileId: STATE.selectedTile, direction });
  STATE.selectedTile = null;
  ['playRightBtn','playLeftBtn','playUpBtn','playDownBtn'].forEach(id => $(id).disabled = true);
}

function checkAnyPlayable(hand, board) {
  if (!board || !board.center) return true;
  if (STATE.gameState?.chooseFirstTile) return true;
  const verticalUnlocked = STATE.gameState?.verticalUnlocked || false;
  return hand.some(t => {
    return ['right','left','up','down'].some(dir => {
      const end = board.ends && board.ends[dir];
      if (end === null || end === undefined) return false;
      if ((dir === 'up' || dir === 'down') && !verticalUnlocked) return false;
      return t.left === end || t.right === end;
    });
  });
}

// ===== WINNER =====
function showWinner(state) {
  const me = state.players.find(p => p.id === socket.id);
  let isWinner;
  if (state.teams) {
    isWinner = me && me.team === state.winner.team;
  } else {
    isWinner = state.winner.playerId === socket.id;
  }
  const isGameOver = state.winner.gameOver;
  
  $('trophyEmoji').textContent = isGameOver ? (isWinner ? '🏆' : '😔') : (isWinner ? '🎉' : '⚡');
  
  if (isGameOver) {
    $('winnerTitle').textContent = isWinner ? '🎊 سەرکەوتنی یاری!' : 'یاریەکە کۆتایی هات';
    $('winnerSubtitle').textContent = isWinner ? `پیرۆزە! تۆ بوویتە پاڵەوان!` : `${state.winner.name} بردیەوە`;
  } else if (state.winner.reason === 'tie') {
    $('winnerTitle').textContent = '🤝 یەکسانی';
    $('winnerSubtitle').textContent = 'هیچ خاڵێک نەدرا';
  } else {
    const reasonText = state.winner.reason === 'domino' ? 'داڵاو!' : 'یاری بەستراوە';
    $('winnerTitle').textContent = isWinner ? `✨ ${reasonText}` : 'ڕاوند کۆتایی هات';
    $('winnerSubtitle').textContent = `${state.winner.name} +${state.winner.points} خاڵ${state.winner.rawPoints !== state.winner.points ? ` (${state.winner.rawPoints} گردکراوە بۆ ${state.winner.points})` : ''}`;
  }
  
  // Score table
  const table = $('scoreTable');
  table.innerHTML = '';
  
  if (state.teams && state.teamScores) {
    table.innerHTML = `
      <div class="score-row team-row team-1-bg ${state.winner.team === 1 ? 'winner' : ''}">
        <span>🔴 تیمی یەکەم</span>
        <span>${state.teamScores.team1} خاڵ</span>
      </div>
      <div class="score-row team-row team-2-bg ${state.winner.team === 2 ? 'winner' : ''}">
        <span>🔵 تیمی دووەم</span>
        <span>${state.teamScores.team2} خاڵ</span>
      </div>
    `;
  } else {
    state.players.forEach(p => {
      const row = document.createElement('div');
      row.className = `score-row ${p.id === state.winner.playerId ? 'winner' : ''}`;
      row.innerHTML = `<span>${p.avatar} ${p.name}</span><span>${p.score} خاڵ</span>`;
      table.appendChild(row);
    });
  }
  
  // Rewards
  if (isGameOver && isWinner) {
    const xpAmount = STATE.currentMode === 'quick' ? 50 : (STATE.currentMode === 'ai' && STATE.aiOptions.difficulty === 'hard' ? 80 : 30);
    const coinsAmount = STATE.currentMode === 'quick' ? 50 : 30;
    $('xpEarned').textContent = xpAmount;
    $('coinsEarned').textContent = coinsAmount;
    $('rewardsShown').style.display = 'flex';
    addXP(xpAmount);
    STATE.profile.coins += coinsAmount;
    STATE.profile.stats.wins++;
    STATE.profile.stats.games++;
    STATE.profile.currentStreak = (STATE.profile.currentStreak || 0) + 1;
    if (STATE.profile.currentStreak > (STATE.profile.bestStreak || 0)) {
      STATE.profile.bestStreak = STATE.profile.currentStreak;
    }
    if (STATE.currentMode === 'ai' && STATE.aiOptions.difficulty === 'hard') STATE.profile.beatHardAI = true;
    if (state.teams) STATE.profile.teamWin = true;
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
  
  $('nextRoundBtn').style.display = isGameOver ? 'none' : 'flex';
  $('winnerModal').classList.add('active');
}

// ===== CHAT =====
function openChat() {
  $('chatPanel').classList.add('active');
  STATE.unreadChat = 0;
  STATE.lobbyUnreadChat = 0;
  updateChatBadges();
  setTimeout(() => { $('chatMessages').scrollTop = $('chatMessages').scrollHeight; }, 100);
}

function closeChat() { $('chatPanel').classList.remove('active'); }

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
  if (STATE.lobbyUnreadChat > 0) { lobby.style.display = 'block'; lobby.textContent = STATE.lobbyUnreadChat > 9 ? '9+' : STATE.lobbyUnreadChat; } else lobby.style.display = 'none';
  if (STATE.unreadChat > 0) { game.style.display = 'block'; game.textContent = STATE.unreadChat > 9 ? '9+' : STATE.unreadChat; } else game.style.display = 'none';
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

function showScoreToast(points) {
  const toast = $('scoreToast');
  toast.textContent = `+${points} خاڵ! ⭐`;
  toast.classList.add('show');
  vibrate([50, 30, 50]);
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function vibrate(pattern) {
  if (STATE.settings?.vibrate && navigator.vibrate) navigator.vibrate(pattern);
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
      score: { freq: 1200, dur: 0.2, type: 'sine' }
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

document.addEventListener('DOMContentLoaded', init);
