/**
 * NEXA STRIPE CHECKOUT — Create Checkout Session
 * Production-ready avec validation & Connect splits
 */

// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const PRICE_IDS = {
  starter:
    process.env.STRIPE_PRICE_STARTER || 'price_1THSyjP8svYH1bkOt686fqqC',
  pro: process.env.STRIPE_PRICE_PRO || 'price_1THSzsP8svYH1bkOndl82cmU',
  business:
    process.env.STRIPE_PRICE_BUSINESS || 'price_1TP3ihP8svYH1bkOOITtQVaA',
  elite: process.env.STRIPE_PRICE_ELITE || 'price_1TJ8XPP8svYH1bkOWwjjcZ87',
  partner_activation:
    process.env.STRIPE_PRICE_PARTNER || 'price_1TWJqYP8svYH1bkOi4njRmnX',
};

const SUBSCRIPTION_PLANS = new Set(['starter', 'pro', 'business', 'elite']);

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
  if (plan === 'partner_activation') return 'payment';
  if (SUBSCRIPTION_PLANS.has(plan)) return 'subscription';
  return 'payment';
}

/**
 * Résout le Connect account ID
 */
async function resolveConnectAccountId({ referrer_id, clientStripeConnectId }) {
  // Si le client envoie un Connect ID vérifié
  if (
    typeof clientStripeConnectId === 'string' &&
    clientStripeConnectId.startsWith('acct_')
  ) {
    return clientStripeConnectId;
  }

  // Si referrer_id, lookup DB (optional)
  // ex: const row = await db.query(...); return row.stripe_connect_id;

  void referrer_id;
  return '';
}

/**
 * Ajoute le split Connect si applicable
 */
function appendConnectSplit({ stripeParams, mode, connectId }) {
  if (!connectId) return;

  if (mode === 'payment') {
    stripeParams.append('payment_intent_data[application_fee_percent]', '20');
    stripeParams.append('payment_intent_data[transfer_data][destination]', connectId);
  } else if (mode === 'subscription') {
    stripeParams.append('subscription_data[application_fee_percent]', '20');
    stripeParams.append('subscription_data[transfer_data][destination]', connectId);
  }
}

// ════════════════════════════════════════════════════════════════
// 🌐 MAIN HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
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

  const { plan, email, clientStripeConnectId, referrer_id } = body;

  // ════════════════════════════════════════════════════════════════
  // ✅ VALIDATION
  // ════════════════════════════════════════════════════════════════

  if (!isValidEmail(email)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid email' }),
    };
  }

  const finalPriceId = PRICE_IDS[plan];
  if (!finalPriceId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid plan' }),
    };
  }

  const mode = checkoutModeForPlan(plan);
  const base = getSiteUrl();
  const success_url = `${base}/dashboard.html?payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = `${base}/#pricing`;

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
      'metadata[plan]': String(plan),
      locale: 'fr',
    });

    if (referrer_id) {
      stripeParams.append('metadata[referrer_id]', String(referrer_id));
    }

    // ════════════════════════════════════════════════════════════════
    // 2️⃣ ADD CONNECT SPLIT
    // ════════════════════════════════════════════════════════════════

    const connectId = await resolveConnectAccountId({
      referrer_id,
      clientStripeConnectId,
    });
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
