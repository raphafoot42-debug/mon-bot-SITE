/**
 * NEXA SAVE-USER — Sauvegarde un utilisateur dans Supabase après inscription
 * Appelé par auth.js après Supabase auth.signUp
 */

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.SITE_URL || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { id, email } = body;

  if (!id || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'id et email requis' }) };
  }

  // Validation email basique
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // Vérifier si l'utilisateur existe déjà (pour ne pas renvoyer l'email de bienvenue)
    const existingRes = await fetchWithTimeout(
      `${url}/rest/v1/users?id=eq.${encodeURIComponent(String(id).trim())}&select=id`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key } },
      8000
    );
    const existingRows = existingRes.ok ? await existingRes.json() : [];
    const alreadyExists = Array.isArray(existingRows) && existingRows.length > 0;

    const res = await fetchWithTimeout(
      `${url}/rest/v1/users?on_conflict=id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          apikey: key,
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          id:         String(id).trim(),
          email:      String(email).trim().toLowerCase(),
          plan:       'pending',
          status:     'pending_verify',
          ...(alreadyExists ? {} : { created_at: new Date().toISOString() }),
          updated_at: new Date().toISOString(),
        }),
      },
      8000
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('save-user Supabase error:', err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
    }

    // Email de bienvenue (non-bloquant) — uniquement pour les nouveaux comptes
    if (!alreadyExists) {
      fetch(`${process.env.SITE_URL || 'https://steady-centaur-82e10a.netlify.app'}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'welcome',
          to: email,
          data: { prenom: email.split('@')[0] }
        })
      }).catch(e => console.warn('send-email welcome:', e.message));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };

  } catch (err) {
    console.error('save-user error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
