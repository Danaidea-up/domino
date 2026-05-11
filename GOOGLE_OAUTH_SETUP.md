# 🔐 Google OAuth Setup Guide

ئەم فایلە ڕێنمایی هەنگاو بە هەنگاو دەدات بۆ ڕێکخستنی Google Sign-In لە یارییەکە.

## 📋 پێشپێویستی

- ئەکاونتی Google
- ٥ خولەک کات

---

## 🚀 هەنگاو ١: درووستکردنی Google Cloud Project

١. بڕۆ بۆ [console.cloud.google.com](https://console.cloud.google.com)
٢. **Select a project** → **NEW PROJECT**
٣. ناو دیاری بکە: `Kurdish Domino`
٤. **Create**

---

## 🔑 هەنگاو ٢: کاراکردنی OAuth API

١. لە مێنیۆی چەپەوە، بڕۆ بۆ **APIs & Services** → **Library**
٢. گەڕان بکە بۆ "Google+ API" یان "Identity Toolkit API"
٣. **Enable**

---

## 🌐 هەنگاو ٣: ڕێکخستنی OAuth Consent Screen

١. بڕۆ بۆ **APIs & Services** → **OAuth consent screen**
٢. **External** → **Create**
٣. پڕی بکەرەوە:
   - **App name:** `Kurdish Domino`
   - **User support email:** ئیمەیلەکەت
   - **Developer contact:** ئیمەیلەکەت
٤. **Save and Continue** (٣ جار)
٥. **Back to Dashboard**

---

## 🆔 هەنگاو ٤: درووستکردنی OAuth Client ID

١. بڕۆ بۆ **APIs & Services** → **Credentials**
٢. **+ CREATE CREDENTIALS** → **OAuth client ID**
٣. **Application type:** `Web application`
٤. **Name:** `Kurdish Domino Web Client`

### Authorized JavaScript origins
زیاد بکە:
- `http://localhost:3000` (بۆ تاقیکردنەوە لۆکاڵ)
- `https://your-app.up.railway.app` (URL ـی Railway)

### Authorized redirect URIs
زیاد بکە:
- `http://localhost:3000`
- `https://your-app.up.railway.app`

٥. **Create**

✅ ئێستا کۆپی بکە:
- **Client ID** (نموونە: `123456789-abcdef.apps.googleusercontent.com`)
- **Client Secret** (نموونە: `GOCSPX-xxxxxxxxxx`)

---

## ⚙️ هەنگاو ٥: زیادکردنی Environment Variables لە Railway

١. بڕۆ بۆ Railway dashboard → پڕۆژەکەت → **Variables**
٢. زیاد بکە:

```
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
JWT_SECRET=any-random-long-string-at-least-32-chars
APP_URL=https://your-app.up.railway.app
```

⚠️ **JWT_SECRET** پێویستە **هەرگیز نەگۆڕدرێت** پاش دامەزراندن - ئەگەر گۆڕدرا، هەموو یاریزانان دەرکراون.

---

## 🧪 هەنگاو ٦: تاقیکردنەوە لۆکاڵ (دڵخواز)

١. فایلێکی نوێی `.env` درووست بکە لە بنکەی پڕۆژە:

```bash
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-secret-here
JWT_SECRET=test-secret-do-not-use-in-production-12345
APP_URL=http://localhost:3000
PORT=3000
```

٢. زیادکردنی `dotenv` بۆ خوێندنی ئۆتۆماتیک:

```bash
npm install dotenv
```

٣. لە سەرەتای `server.js`:

```javascript
require('dotenv').config();
```

٤. بەکاربهێنە: `npm start`

---

## ✅ هەنگاو ٧: تاقیکردنەوە

١. ئەپەکە بکەرەوە
٢. لە یەکەم سکرینی Login، دەبێت دوگمەی **Sign in with Google** دیار بێت
٣. کلیکی بکە و ئەکاونتێک هەڵبژێرە
٤. ئەگەر سەرکەوتوو بوو، بە ناوی Google چویتە ژوور!

---

## 🔧 فریاکەوتنەوە

### ❌ "Sign in with Google" نییە
- پشکنینی Console: ئاگاداری "Google OAuth enabled" نیشان دەدات؟
- ئەگەر "GOOGLE_CLIENT_ID not set" نیشان دەدات: Variable لە Railway زیاد نەکراوە
- پشتی dashboard: Variables بە دروستی پاراستن

### ❌ "Error 400: redirect_uri_mismatch"
- بڕۆ بۆ Google Cloud Console → Credentials → کلیک Client ID
- زیاد بکە **بە تەواوی** URL ـی Railway لە Authorized redirect URIs
- پێویستە بە `https://` بنووسرێت، بێ `/` لە کۆتایی

### ❌ "Origin not allowed"
- پشکنینی **Authorized JavaScript origins** لە Google Console
- Origin ـی Railway پێویستە بە تەواوی هەر بێت

### ❌ ناتوانم Sign-in بکەم لە مۆبایل
- ئەگەر لە Safari / Chrome مۆبایل، popup blocker کارا نییە
- یەک هەنگاو سەرەتا: لە Browser settings، Pop-ups: Allow بکە

---

## 📊 لە داتابەیس

ئەکاونتە Google ـیەکان لە جدوەلی `players` پاراستن دەکرێت لەگەڵ:
- `google_id`: شناسەی Google
- `google_email`: ئیمەیل
- `google_picture`: لینکی وێنەی پڕۆفایل
- `is_google_user: TRUE`

ئەو یاریزانانە **ناتوانن ناویان بگۆڕن** (ناوەکە لە Google دێت)، بەڵام **دەتوانن ئاواتاری ئیمۆجی هەڵبژێرن**.

---

🎲 **یاری خۆش بێت!**
