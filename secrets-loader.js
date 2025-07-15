
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('.'));

// CORS設定
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Secrets APIエンドポイント
app.get('/api/secrets', (req, res) => {
  const secrets = {
    FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
    FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET,
    FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID,
    FIREBASE_APP_ID: process.env.FIREBASE_APP_ID,
    FIREBASE_MEASUREMENT_ID: process.env.FIREBASE_MEASUREMENT_ID,
  };
  
  // 未定義のSecretをチェック
  const missingSecrets = Object.keys(secrets).filter(key => !secrets[key]);
  if (missingSecrets.length > 0) {
    return res.status(400).json({ 
      error: 'Missing secrets', 
      missingSecrets 
    });
  }
  
  res.json(secrets);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Secrets server running on port ${port}`);
});
