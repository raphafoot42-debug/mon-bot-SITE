/**
 * NEXA TIKTOK CALLBACK — OAuth 2.0 PKCE Flow
 * Production-ready avec sécurité complète
 */

// ════════════════════════════════════════════════════════════════
// 🔧 UTILITIES
// ════════════════════════════════════════════════════════════════

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function redirectHeaders(location) {
  return {
    'Access-Control-Allow-Origin': '*',
    Location: location,
  };
}

/**
 * Parse JSON safe
 */
async function readJsonSafe(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { _raw: text };
  }
}

// ════════════════════════════════════════════════════════════════
// 🔑 EXCHANGE CODE FOR TOKEN
// ════════════════════════════════════════════════════════════════

/**
 * Échange le code d'autorisation pour un access token
 */
async function exchangeCode({ code, code_verifier }) {
  const redirect_uri = process.env.TIKTOK_REDIRECT_URI;

  // Vérifie config
  if (
    !process.env.TIKTOK_CLIENT_KEY ||
    !process.env.TIKTOK_CLIENT_SECRET ||
    !redirect_uri
  ) {
    throw new Error('Missing TikTok env vars');
  }

  // Vérifie PKCE verifier
  if (!code_verifier) {
    throw new Error('Code verifier required (PKCE)');
  }

  // Build params
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri,
    code_verifier, // PKCE
  });

  // Appelle TikTok
  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const tokenData = await readJsonSafe(tokenRes);

  // Gère erreur TikTok
  if (!tokenRes.ok || tokenData.error) {
    const msg =
      tokenData.error_description ||
      tokenData.error ||
      tokenData.message ||
      tokenData._raw ||
      `Token exchange failed (${tokenRes.status})`;
    const err = new Error(msg);
    err.tokenData = tokenData;
    throw err;
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || '';
  const openId = tokenData.open_id;

  // Vérifie tokens
  if (!accessToken || !openId) {
    throw new Error('Missing access_token or open_id in response');
  }

  // ════════════════════════════════════════════════════════════════
  // 👤 FETCH USER PROFILE
  // ════════════════════════════════════════════════════════════════

  const profileRes = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const profileData = await readJsonSafe(profileRes);
  const user = profileData.data?.user;

  if (!user) {
    throw new Error('Failed to fetch user profile');
  }

  return {
    accessToken,
    refreshToken,
    openId,
    profile: {
      openId,
      username: user.username || '',
      displayName: user.display_name || '',
      avatar: user.avatar_url || '',
    },
  };
}

// ════════════════════════════════════════════════════════════════
// 💾 PERSIST TO SUPABASE
// ════════════════════════════════════════════════════════════════

/**
 * Sauvegarde le compte TikTok dans Supabase
 */
async function maybePersistToSupabase({
  openId,
  accessToken,
  refreshToken,
  profile,
}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.warn('Supabase not configured, skipping persistence');
    return;
  }

  try {
    await fetch(`${url}/rest/v1/tiktok_accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        apikey: key,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        open_id: openId,
        access_token: accessToken,
        refresh_token: refreshToken,
        username: profile.username,
        display_name: profile.displayName,
        avatar_url: profile.avatar,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('Supabase persistence failed:', err.message);
    // Non-blocking: don't throw
  }
}

// ════════════════════════════════════════════════════════════════
// 🌐 MAIN HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: JSON_HEADERS, body: '' };
  }

  const site = process.env.SITE_URL || '';
  const dashboardPath = process.env.DASHBOARD_PATH || '/dashboard.html';

  // ════════════════════════════════════════════════════════════════
  // POST: Recommandé (from dashboard with PKCE)
  // ════════════════════════════════════════════════════════════════

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ success: false, message: 'Invalid JSON' }),
      };
    }

    const code = body.code;
    const verifier = body.verifier || body.code_verifier;

    // Vérifie inputs
    if (!code || !verifier) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          success: false,
          message: 'code and verifier required (PKCE)',
        }),
      };
    }

    try {
      // Échange code
      const { accessToken, refreshToken, openId, profile } = await exchangeCode({
        code,
        code_verifier: verifier,
      });

      // Persiste dans Supabase
      await maybePersistToSupabase({
        openId,
        accessToken,
        refreshToken,
        profile,
      });

      // Retourne profil publique (PAS le token)
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          success: true,
          user: profile,
        }),
      };
    } catch (err) {
      console.error('tiktok-callback POST error:', err.message);
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          success: false,
          message: err.message || 'OAuth error',
        }),
      };
    }
  }

  // ════════════════════════════════════════════════════════════════
  // GET: TikTok redirects here (if REDIRECT_URI points to function)
  // ════════════════════════════════════════════════════════════════

  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};
    const code = qs.code;
    const error = qs.error;

    // Gère erreur OAuth
    if (error) {
      return {
        statusCode: 302,
        headers: redirectHeaders(
          `${site}${dashboardPath}?tiktok=error&reason=${encodeURIComponent(
            error
          )}`
        ),
        body: '',
      };
    }

    // Pas de code
    if (!code) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'No code provided' }),
      };
    }

    // Redirect au dashboard (finish en POST)
    return {
      statusCode: 302,
      headers: redirectHeaders(
        `${site}${dashboardPath}?tiktok=pending&code=${encodeURIComponent(
          code
        )}&state=${encodeURIComponent(qs.state || '')}`
      ),
      body: '',
    };
  }

  // Method not allowed
  return {
    statusCode: 405,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: 'Method not allowed' }),
  };
};
