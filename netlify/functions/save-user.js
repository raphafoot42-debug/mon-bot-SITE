/**
 * NEXA SAVE-USER — Sauvegarde un utilisateur dans Supabase après inscription
 * Appelé par auth.js après Supabase auth.signUp
 */

const crypto = require('crypto');

function encryptPassword(plainPassword) {
  try {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey || !plainPassword) return plainPassword;
    const key = Buffer.from(encryptionKey, 'hex').slice(0, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(Buffer.from(plainPassword));
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (err) {
    console.error('Encryption error:', err.message);
    return plainPassword;
  }
}

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

  const {
    id, email,
    // Champs collectés pendant le bot qualify
    prenom, plan, status,
    business, type_business, niche_tiktok, prix_produit, objectif, pays,
    tiktok_pseudo, tiktok_username, tiktok_password_encrypted,
    store_url, stripe_connect_id, affiliation_mode,
    stripe_subscription_id
  } = body;

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

    // Construire l'objet à sauvegarder — on n'écrase que les champs fournis
    const userData = {
      id:         String(id).trim(),
      email:      String(email).trim().toLowerCase(),
      plan:       plan       || 'pending',
      status:     status     || 'pending_verify',
      updated_at: new Date().toISOString(),
      ...(alreadyExists ? {} : { created_at: new Date().toISOString() }),
    };

    // Ajouter les champs optionnels seulement s'ils sont fournis
    if (prenom)                    userData.prenom                    = String(prenom).trim().slice(0, 100);
    if (business)                  userData.business                  = String(business).trim().slice(0, 200);
    if (type_business)             userData.type_business             = String(type_business).trim().slice(0, 100);
    if (niche_tiktok)              userData.niche_tiktok              = String(niche_tiktok).trim().slice(0, 100);
    if (prix_produit)              userData.prix_produit              = String(prix_produit).trim().slice(0, 50);
    if (objectif)                  userData.objectif                  = String(objectif).trim().slice(0, 200);
    if (pays)                      userData.pays                      = String(pays).trim().slice(0, 50);
    if (tiktok_pseudo)             userData.tiktok_pseudo             = String(tiktok_pseudo).trim().slice(0, 100);
    if (tiktok_username)           userData.tiktok_username           = String(tiktok_username).trim().slice(0, 100);
    if (tiktok_password_encrypted) userData.tiktok_password_encrypted = encryptPassword(String(tiktok_password_encrypted).trim());
    if (store_url)                 userData.store_url                 = String(store_url).trim().slice(0, 500);
    if (stripe_connect_id)         userData.stripe_connect_id         = String(stripe_connect_id).trim();
    if (affiliation_mode)          userData.affiliation_mode          = String(affiliation_mode).trim().slice(0, 50);
    if (stripe_subscription_id)    userData.stripe_subscription_id    = String(stripe_subscription_id).trim();

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
        body: JSON.stringify(userData),
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
