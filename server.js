
const express = require('express');
const path = require('path');

const app = express();

// Security Headers Middleware
app.use((req, res, next) => {
  // CSP: Define allowed sources
  const cspDirectives = [
    "default-src 'self'",
    // Allow scripts with unsafe-hashes for Google authentication compatibility
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'unsafe-hashes' blob: data: https://www.gstatic.com https://*.firebaseio.com https://apis.google.com https://www.googletagmanager.com https://accounts.google.com https://accounts.youtube.com https://content.googleapis.com https://infird.com https://x.com https://twitter.com https://api.x.com",
    // Explicitly set script-src-elem with same permissions
    "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' 'unsafe-hashes' blob: data: https://www.gstatic.com https://*.firebaseio.com https://apis.google.com https://www.googletagmanager.com https://accounts.google.com https://accounts.youtube.com https://content.googleapis.com https://infird.com https://x.com https://twitter.com https://api.x.com",
    // Allow styles from self, FontAwesome, and Google Fonts
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com https://accounts.google.com https://accounts.youtube.com",
    // Allow frames from Firebase auth and Google accounts (including YouTube)
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://accounts.youtube.com https://*.googleapis.com https://content.googleapis.com",
    // Allow child frames for Google authentication
    "child-src 'self' https://accounts.google.com https://accounts.youtube.com https://*.googleapis.com https://content.googleapis.com https://*.firebaseapp.com",
    // Allow fonts from FontAwesome and Google Fonts
    "font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com",
    // Allow connections to self, WebSocket, Firebase, and Google services
    "connect-src 'self' wss: ws: https://*.firebaseio.com https://firestore.googleapis.com https://www.google-analytics.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://apis.google.com https://accounts.google.com https://accounts.youtube.com https://content.googleapis.com https://play.google.com https://overbridgenet.com https://api.twitter.com",
    // Allow images from self, data URIs, and Google user content
    "img-src 'self' data: https://*.googleusercontent.com https://accounts.google.com https://www.googletagmanager.com https://www.google-analytics.com https://pbs.twimg.com",
    // Allow forms to be submitted to Google
    "form-action 'self' https://accounts.google.com https://accounts.youtube.com",
    // Allow frames from Google accounts for authentication
    "frame-ancestors 'self' https://accounts.google.com https://accounts.youtube.com"
  ];
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // COOP: Unsafe-none for better Safari compatibility with Firebase auth
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');

  // X-Content-Type-Options: Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // X-Frame-Options: Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // X-Powered-By: Remove header to hide server technology
  res.removeHeader('X-Powered-By');

  next();
});


const PORT = process.env.PORT || 5000;

// 静的ファイルの配信
app.use(express.static(path.join(__dirname, 'public')));

// Firebase設定をクライアントに安全に配信するエンドポイント
app.get('/api/firebase-config', (req, res) => {
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
  };

  // 環境変数が設定されているかチェック
  const missingVars = Object.entries(firebaseConfig)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    return res.status(500).json({
      error: 'Firebase configuration incomplete',
      missing: missingVars
    });
  }

  res.json(firebaseConfig);
});

// メインページの配信
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
