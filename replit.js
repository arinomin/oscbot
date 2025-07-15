

// Replit環境でのSecrets読み込み（API経由）
async function loadReplitSecrets() {
  try {
    const response = await fetch('/api/secrets');
    if (!response.ok) {
      throw new Error(`Secrets API error: ${response.status}`);
    }
    const secrets = await response.json();
    
    window.replit = { secrets };
    console.log('Replit secrets loaded successfully');
  } catch (error) {
    console.error('Failed to load Replit secrets:', error);
    window.replit = { secrets: {} };
  }
}

// DOM読み込み完了前にSecretsを読み込む
loadReplitSecrets();

