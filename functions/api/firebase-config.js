// functions/api/firebase-config.js
export async function onRequest(context) {
  const firebaseConfig = {
    apiKey: context.env.FIREBASE_API_KEY,
    authDomain: context.env.FIREBASE_AUTH_DOMAIN,
    projectId: context.env.FIREBASE_PROJECT_ID,
    storageBucket: context.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: context.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: context.env.FIREBASE_APP_ID,
    measurementId: context.env.FIREBASE_MEASUREMENT_ID,
  };

  // 環境変数のチェック
  const missingVars = Object.entries(firebaseConfig)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    return new Response(
      JSON.stringify({
        error: "Firebase configuration incomplete",
        missing: missingVars,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify(firebaseConfig), {
    headers: { "Content-Type": "application/json" },
  });
}
