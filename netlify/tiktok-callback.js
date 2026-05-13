// netlify/functions/tiktok-callback.js

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Nexa-Secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function redirectHeaders(location) {
  return {
    "Access-Control-Allow-Origin": "*",
    Location: location,
  };
}

async function readJsonSafe(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { _raw: text };
  }
}

async function exchangeCode({ code, code_verifier }) {
  const redirect_uri = process.env.TIKTOK_REDIRECT_URI;
  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET || !redirect_uri) {
    throw new Error("Missing TikTok env vars (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TIKTOK_REDIRECT_URI)");
  }

  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri,
  });

  // PKCE (fortement recommandé / souvent requis selon config TikTok)
  if (code_verifier) {
    params.append("code_verifier", code_verifier);
  }

  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const tokenData = await readJsonSafe(tokenRes);

  if (!tokenRes.ok || tokenData.error) {
    const msg =
      tokenData.error_description ||
      tokenData.error ||
      tokenData.message ||
      tokenData._raw ||
      `TikTok token exchange failed (${tokenRes.status})`;
    const err = new Error(msg);
    err.tokenData = tokenData;
    throw err;
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || "";
  const openId = tokenData.open_id;

  if (!accessToken || !openId) {
    throw new Error("TikTok token response missing access_token or open_id");
  }

  const profileRes = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username",
    { headers: { Authorization: "Bearer " + accessToken } }
  );

  const profileData = await readJsonSafe(profileRes);
  const user = profileData.data?.user;

  return {
    accessToken,
    refreshToken,
    openId,
    profile: {
      openId,
      username: user?.username || "",
      displayName: user?.display_name || "",
      avatar: user?.avatar_url || "",
    },
  };
}

async function maybePersistToSupabase({ openId, accessToken, refreshToken, profile }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  // À ADAPTER à ton schéma (exemple minimal)
  await fetch(`${url}/rest/v1/tiktok_accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
      apikey: key,
      Prefer: "resolution=merge-duplicates",
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
  }).catch(() => null);
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: JSON_HEADERS, body: "" };
  }

  const site = process.env.SITE_URL || ""; // ex: https://steady-centaur-82e10a.netlify.app
  const dashboardPath = process.env.DASHBOARD_PATH || "/dashboard.html";

  // --- POST : recommandé avec ton dashboard (code + pkce_verifier) ---
  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ success: false, message: "Invalid JSON" }) };
    }

    const code = body.code;
    const verifier = body.verifier || body.code_verifier;

    if (!code || !verifier) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ success: false, message: "code and verifier are required (PKCE)" }),
      };
    }

    try {
      const { accessToken, refreshToken, openId, profile } = await exchangeCode({
        code,
        code_verifier: verifier,
      });

      await maybePersistToSupabase({ openId, accessToken, refreshToken, profile });

      // Ne renvoie PAS le access_token au navigateur si tu peux l'éviter.
      // Ici : succès + profil public uniquement.
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          success: true,
          user: profile,
          // Si tu as absolument besoin côté client pour un MVP : décommente, mais c'est moins safe
          // access_token: accessToken,
        }),
      };
    } catch (err) {
      console.error("tiktok-callback POST error:", err);
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ success: false, message: err.message || "OAuth error" }),
      };
    }
  }

  // --- GET : TikTok peut rediriger ici si TIKTOK_REDIRECT_URI pointe sur la function ---
  if (event.httpMethod === "GET") {
    const qs = event.queryStringParameters || {};
    const code = qs.code;
    const error = qs.error;

    if (error) {
      return {
        statusCode: 302,
        headers: redirectHeaders(`${site}${dashboardPath}?tiktok=error&reason=${encodeURIComponent(error)}`),
        body: "",
      };
    }

    if (!code) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "No code provided" }) };
    }

    // Sans verifier PKCE, l'échange peut échouer selon ta config TikTok.
    // Le plus fiable : renvoyer vers le dashboard avec le code pour finir en POST.
    return {
      statusCode: 302,
      headers: redirectHeaders(`${site}${dashboardPath}?tiktok=pending&code=${encodeURIComponent(code)}&state=${encodeURIComponent(qs.state || "")}`),
      body: "",
    };
  }

  return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
};
