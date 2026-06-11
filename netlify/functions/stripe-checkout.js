/**
 * NEXA STRIPE CHECKOUT — Create Checkout Session
 * Production-ready avec validation & Connect splits
 */

// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const PRICE_IDS = {
  // ── Mensuel ──────────────────────────────────────────────────
  starter:        process.env.STRIPE_PRICE_STARTER        || 'price_1TgQAiP6KQQPJW2bIPBL567L',
  pro:            process.env.STRIPE_PRICE_PRO            || 'price_1TgQAjP6KQQPJW2bHjVUSD4j',
  // ── Annuel ───────────────────────────────────────────────────
  starter_annual: process.env.STRIPE_PRICE_STARTER_ANNUAL || 'price_1TgQAjP6KQQPJW2buOxVpaY3',
  pro_annual:     process.env.STRIPE_PRICE_PRO_ANNUAL     || 'price_1TgQAlP6KQQPJW2bRq9GGOnU',
  // ⚠️ plans 'business', 'elite', 'partner_activation' supprimés — ne correspondent plus aux forfaits réels
};

const SUBSCRIPTION_PLANS = new Set(['starter', 'pro', 'starter_annual', 'pro_annual']);

// ════════════════════════════════════════════════════════════════
// 🔧 UTILITIES
// ════════════════════════════════════════════════════════════════

/**
 * Retourne l'URL du site
 */
function getSiteUrl() {
  const base = (process.env.SITE_URL || 'https://example.netlify.app').replace(
    /\/$/,
    ''
  );
  return base;
}

/**
 * Valide email
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const e = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Determine le mode checkout (payment vs subscription)
 */
function checkoutModeForPlan(plan) {
  if (SUBSCRIPTION_PLANS.has(plan)) return 'subscription';
  return 'payment';
}

/**
 * Résout le Connect account ID
 */
async function resolveConnectAccountId({ referrer_id }) {
  // CORRECTION: on n'accepte PLUS le connectId envoyé par le client (risque de fraude)
  // Le Connect ID doit être résolu UNIQUEMENT côté serveur via Supabase
  if (!referrer_id) return '';

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return '';

  try {
    const res = await fetch(
      `${url}/rest/v1/users?id=eq.${encodeURIComponent(referrer_id)}&select=stripe_connect_id`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
        },
      }
    );
    if (!res.ok) return '';
    const rows = await res.json();
    const connectId = rows?.[0]?.stripe_connect_id || '';
    // Vérifie format Stripe Connect ID
    return typeof connectId === 'string' && connectId.startsWith('acct_') ? connectId : '';
  } catch (e) {
    console.error('resolveConnectAccountId error:', e.message);
    return '';
  }
}

/**
 * Ajoute le split Connect si applicable
 */
function appendConnectSplit({ stripeParams, mode, connectId }) {
  if (!connectId) return;

  if (mode === 'payment') {
    // CORRECTION: payment_intent_data utilise application_fee_amount (centimes), pas percent
    // 20% calculé depuis le price ID n'est pas connu ici → on stocke le referrer_id dans metadata
    // et on calcule la commission dans verify-payment.js après paiement confirmé
    stripeParams.append('payment_intent_data[transfer_data][destination]', connectId);
  } else if (mode === 'subscription') {
    // CORRECTION: subscription_data supporte bien application_fee_percent
    stripeParams.append('subscription_data[application_fee_percent]', '20');
    stripeParams.append('subscription_data[transfer_data][destination]', connectId);
  }
}

// ════════════════════════════════════════════════════════════════
// 🌐 MAIN HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async function (event) {
  const allowedOrigin = process.env.SITE_URL || '';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Accepte seulement POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Vérifie Stripe config
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Stripe not configured' }),
    };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { plan, billing, email, referrer_id, acct, price, product_name } = body;

  // ════════════════════════════════════════════════════════════════
  // ✅ VALIDATION
  // ════════════════════════════════════════════════════════════════

  if (!isValidEmail(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  // ── Cas spécial : achat produit client affiliation ──────────────
  if (plan === 'affiliation_product') {
    if (!acct || !acct.startsWith('acct_')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'acct invalide' }) };
    }
    if (!price || isNaN(Number(price)) || Number(price) <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'price invalide' }) };
    }

    const base = getSiteUrl();
    const success_url = `${base}/shop/${acct}?payment=success&email=${encodeURIComponent(email)}`;
    const cancel_url  = `${base}/shop/${acct}`;

    // Créer un Price dynamique Stripe (price_data) — pas de Price ID fixe
    const stripeParams = new URLSearchParams({
      'payment_method_types[]': 'card',
      mode: 'payment',
      customer_email: String(email).trim(),
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': String(Math.round(Number(price) * 100)),
      'line_items[0][price_data][product_data][name]': String(product_name || 'Produit').slice(0, 127),
      'line_items[0][quantity]': '1',
      success_url,
      cancel_url,
      'metadata[plan]': 'affiliation_product',
      'metadata[acct]': acct,
      'metadata[referrer_id]': acct,
      locale: 'fr',
    });

    // Split 80/20 vers le compte Connect du client
    stripeParams.append('payment_intent_data[transfer_data][destination]', acct);
    stripeParams.append('payment_intent_data[application_fee_amount]',
      String(Math.round(Number(price) * 100 * 0.80)) // 80% pour Nexa
    );

    try {
      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: stripeParams.toString(),
      });

      const raw = await stripeRes.text();
      let session;
      try { session = raw ? JSON.parse(raw) : {}; } catch { session = { error: { message: raw } }; }

      if (!stripeRes.ok || session.error) {
        console.error('Stripe affiliation_product error:', session.error?.message || raw);
        return { statusCode: 400, headers, body: JSON.stringify({ error: session.error?.message || 'Erreur Stripe' }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
    } catch (err) {
      console.error('affiliation_product handler error:', err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
    }
  }

  // ── Cas standard : forfaits Nexa (starter / pro / annuel) ──────
  // Résout la clé plan selon le billing (monthly par défaut)
  const isAnnual = billing === 'annual';
  const planKey  = isAnnual ? `${plan}_annual` : plan;

  const finalPriceId = PRICE_IDS[planKey];
  if (!finalPriceId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };
  }

  const mode = checkoutModeForPlan(planKey);
  const base = getSiteUrl();
  // ✅ SPA sur index.html — pas de /Netlify/dashboard.html (404 sur Netlify)
  const success_url = `${base}/?payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancel_url  = `${base}/#pricing`;

  try {
    // ════════════════════════════════════════════════════════════════
    // 1️⃣ BUILD STRIPE PARAMS
    // ════════════════════════════════════════════════════════════════

    const stripeParams = new URLSearchParams({
      'payment_method_types[]': 'card',
      mode,
      customer_email: String(email).trim(),
      'line_items[0][price]': finalPriceId,
      'line_items[0][quantity]': '1',
      success_url,
      cancel_url,
      'metadata[plan]': String(planKey),
      'metadata[billing]': isAnnual ? 'annual' : 'monthly',
      locale: 'fr',
    });

    if (referrer_id) {
      stripeParams.append('metadata[referrer_id]', String(referrer_id));
    }

    // ════════════════════════════════════════════════════════════════
    // 2️⃣ ADD CONNECT SPLIT
    // ════════════════════════════════════════════════════════════════

    const connectId = await resolveConnectAccountId({ referrer_id });
    appendConnectSplit({ stripeParams, mode, connectId });

    // ════════════════════════════════════════════════════════════════
    // 3️⃣ CALL STRIPE API
    // ════════════════════════════════════════════════════════════════

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: stripeParams.toString(),
    });

    const raw = await stripeRes.text();
    let session;
    try {
      session = raw ? JSON.parse(raw) : {};
    } catch {
      session = { error: { message: raw || 'Invalid response' } };
    }

    // Gère erreur Stripe
    if (!stripeRes.ok || session.error) {
      const msg =
        session.error?.message || raw || `Error (${stripeRes.status})`;
      console.error('Stripe error:', msg);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: msg }),
      };
    }

    // Vérifie URL checkout
    if (!session.url) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'No checkout URL returned' }),
      };
    }

    // ════════════════════════════════════════════════════════════════
    // ✅ SUCCESS RESPONSE
    // ════════════════════════════════════════════════════════════════

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        url: session.url,
        id: session.id,
        mode,
      }),
    };
  } catch (err) {
    console.error('Checkout handler error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error' }),
    };
  }
};
