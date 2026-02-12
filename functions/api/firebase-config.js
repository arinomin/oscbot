// functions/api/firebase-config.js
export async function onRequest(context) {
  // Cloudflare の環境変数 (context.env) から取得
  const config = {
    apiKey: context.env.FIREBASE_API_KEY,
    authDomain: context.env.FIREBASE_AUTH_DOMAIN,
    projectId: context.env.FIREBASE_PROJECT_ID,
    storageBucket: context.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: context.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: context.env.FIREBASE_APP_ID,
    measurementId: context.env.FIREBASE_MEASUREMENT_ID,
  };

  // 1つでも設定が足りない場合はエラーを返す
  const missing = Object.entries(config)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    return new Response(
      JSON.stringify({ error: "Missing config", missing }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 設定情報を JSON で返す
  return new Response(JSON.stringify(config), {
    headers: { "Content-Type": "application/json" },
  });
}