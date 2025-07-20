
const express = require('express');
const path = require('path');
const crypto = require('crypto'); // Import crypto for nonce generation

const app = express();

// Set EJS as the template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security Headers Middleware
app.use((req, res, next) => {
  // Generate a nonce for each request
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  // CSP: Define allowed sources with nonce
  const cspDirectives = [
    "default-src 'self'",
    // Allow scripts from self, Google, Firebase, and inline scripts with a nonce
    `script-src 'self' 'nonce-${nonce}' https://www.gstatic.com https://*.firebaseio.com https://apis.google.com https://www.googletagmanager.com`,
    // Allow styles from self and FontAwesome
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    // Allow frames from Firebase auth
    "frame-src 'self' https://*.firebaseapp.com",
    // Allow fonts from FontAwesome
    "font-src 'self' https://cdnjs.cloudflare.com",
    // Allow connections to self, WebSocket, Firebase, and Google Analytics
    "connect-src 'self' wss: ws: https://*.firebaseio.com https://firestore.googleapis.com https://www.google-analytics.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://apis.google.com",
    // Allow images from self, data URIs, and Google user content (for profile pictures)
    "img-src 'self' data: https://*.googleusercontent.com"
  ];
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // X-Content-Type-Options: Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // X-Frame-Options: Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // X-Powered-By: Remove header to hide server technology
  res.removeHeader('X-Powered-By');

  next();
});


const PORT = process.env.PORT || 5000;

// 静的ファイルの配信 (from public directory)
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

// メインページの配信 (using EJS to inject nonce)
app.get('/', (req, res) => {
  res.render('index', { cspNonce: res.locals.cspNonce });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
