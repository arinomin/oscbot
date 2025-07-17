
const express = require('express');
const path = require('path');
const he = require('he');

const app = express();
const PORT = process.env.PORT || 5000;

// JSONリクエストのパース
app.use(express.json());

// 入力サニタイゼーションミドルウェア
function sanitizeInput(req, res, next) {
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = he.escape(req.body[key]);
      }
    }
  }
  next();
}

app.use(sanitizeInput);

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
