// ============================================
// 🌐 i18n - Multi-language Support
// ============================================

const i18n = {
  ckb: {
    appTitle: '🎲 Domino World',
    subtitle: 'یاری دۆمینۆی جیهانی',
    online: 'ئۆنڵاین',
    games: 'یاری',
    quickPlay: 'یاری خێرا',
    quickPlayDesc: 'دۆزینەوەی یاریزان لە ٨ چرکەدا',
    aiPlay: 'یاری دژی AI',
    aiPlayDesc: 'تاقیکردنەوەی توانا دژی کۆمپیوتەر',
    friendsPlay: 'یاری لەگەڵ هاوڕێ',
    friendsPlayDesc: 'ژوور درووست بکە یان پەیوەست بە',
    history: 'مێژوو',
    leaderboard: 'ڕیتبەند',
    profile: 'پڕۆفایل',
    settings: 'سێتینگ',
    achievements: 'نیشانەکان',
    daily: 'خەڵات',
    won: 'سەرکەوت',
    lost: 'دۆڕا',
    save: 'پاراستن',
    back: 'گەڕانەوە',
    chat: 'چات'
  },
  ar: {
    appTitle: '🎲 Domino World',
    subtitle: 'لعبة الدومينو العالمية',
    online: 'متصل',
    games: 'لعبة',
    quickPlay: 'لعبة سريعة',
    quickPlayDesc: 'العثور على لاعب في 8 ثواني',
    aiPlay: 'اللعب ضد الذكاء الصناعي',
    aiPlayDesc: 'اختبر مهاراتك ضد الكمبيوتر',
    friendsPlay: 'اللعب مع الأصدقاء',
    friendsPlayDesc: 'أنشئ غرفة أو انضم لأخرى',
    history: 'السجل',
    leaderboard: 'المتصدرين',
    profile: 'الملف الشخصي',
    settings: 'الإعدادات',
    achievements: 'الإنجازات',
    daily: 'مكافأة',
    won: 'فاز',
    lost: 'خسر',
    save: 'حفظ',
    back: 'رجوع',
    chat: 'دردشة'
  },
  en: {
    appTitle: '🎲 Domino World',
    subtitle: 'World-Class Domino Game',
    online: 'Online',
    games: 'Games',
    quickPlay: 'Quick Match',
    quickPlayDesc: 'Find an opponent in 8 seconds',
    aiPlay: 'Play vs AI',
    aiPlayDesc: 'Test your skills against the computer',
    friendsPlay: 'Play with Friends',
    friendsPlayDesc: 'Create a room or join one',
    history: 'History',
    leaderboard: 'Leaderboard',
    profile: 'Profile',
    settings: 'Settings',
    achievements: 'Achievements',
    daily: 'Reward',
    won: 'Won',
    lost: 'Lost',
    save: 'Save',
    back: 'Back',
    chat: 'Chat'
  }
};

function applyLanguage(lang) {
  const t = i18n[lang] || i18n.ckb;
  document.body.dir = (lang === 'en') ? 'ltr' : 'rtl';
  document.documentElement.lang = lang;
  
  // Update text elements
  const updates = {
    'pillName': null, // keep player name
    'searchTimeLabel': t.online
  };
  
  // Mode cards
  const modeCards = document.querySelectorAll('.mode-card');
  if (modeCards.length >= 3) {
    const titles = [t.quickPlay, t.aiPlay, t.friendsPlay];
    const descs = [t.quickPlayDesc, t.aiPlayDesc, t.friendsPlayDesc];
    modeCards.forEach((card, i) => {
      const titleEl = card.querySelector('.mode-title');
      const descEl = card.querySelector('.mode-desc');
      if (titleEl) titleEl.textContent = titles[i];
      if (descEl) descEl.textContent = descs[i];
    });
  }
  
  // Quick action buttons
  const quickBtns = document.querySelectorAll('.quick-btn');
  if (quickBtns.length >= 3) {
    const labels = [t.history, t.leaderboard, t.profile];
    quickBtns.forEach((btn, i) => {
      const span = btn.querySelectorAll('span')[1];
      if (span) span.textContent = labels[i];
    });
  }
  
  localStorage.setItem('domino_lang', lang);
}

function getCurrentLang() {
  return localStorage.getItem('domino_lang') || 'ckb';
}
