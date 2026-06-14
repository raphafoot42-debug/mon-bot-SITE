/**
 * NEXA VERIFY PAYMENT — Stripe Session Verification
 * Vérifie paiement Stripe et met à jour Supabase
 * Production-ready
 */

// Plans valides — doit rester synchronisé avec payment.js
const VALID_PLANS = new Set(['starter', 'pro', 'affiliation', 'starter_annual', 'pro_annual']);

// ════════════════════════════════════════════════════════════════
// 🔧 UTILITIES
// ════════════════════════════════════════════════════════════════

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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

  const { session_id, email } = body;

  // ════════════════════════════════════════════════════════════════
  // ✅ VALIDATION
  // ════════════════════════════════════════════════════════════════

  if (!session_id || !email) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'session_id and email are required',
      }),
    };
  }

  if (!isValidEmail(email)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid email format' }),
    };
  }

  // Vérifie env vars
  if (
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' }),
    };
  }

  try {
    // ════════════════════════════════════════════════════════════════
    // 1️⃣ FETCH STRIPE SESSION
    // ════════════════════════════════════════════════════════════════

    const qs = new URLSearchParams();
    qs.append('expand[]', 'payment_intent');
    qs.append('expand[]', 'line_items');
    qs.append('expand[]', 'line_items.data.price');

    const stripeRes = await fetchWithTimeout(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } },
      15000
    );

    const session = await stripeRes.json();

    // Gère erreur Stripe
    if (!stripeRes.ok) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: session.error?.message || 'Stripe session fetch failed',
        }),
      };
    }

    // ════════════════════════════════════════════════════════════════
    // 2️⃣ VALIDATE PAYMENT STATUS
    // ════════════════════════════════════════════════════════════════

    if (session.payment_status !== 'paid') {
      return {
        statusCode: 402,
        headers,
        body: JSON.stringify({ error: 'Payment not completed' }),
      };
    }

    // ════════════════════════════════════════════════════════════════
    // 3️⃣ VALIDATE EMAIL MATCH
    // ════════════════════════════════════════════════════════════════

    const stripeEmail = normalizeEmail(
      session.customer_details?.email || session.customer_email || ''
    );
    const requestEmail = normalizeEmail(email);

    if (!stripeEmail || stripeEmail !== requestEmail) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: 'Email does not match Stripe session',
        }),
      };
    }

    // ════════════════════════════════════════════════════════════════
    // 4️⃣ VALIDATE LINE ITEMS
    // ════════════════════════════════════════════════════════════════

    const lineItems = session.line_items?.data || [];
    if (lineItems.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No line items in session' }),
      };
    }

    // Récupère le plan depuis les metadata Stripe (défini dans stripe-checkout.js)
    let planMeta = String(session.metadata?.plan || 'starter').replace('-once', '');

    // ⚠️ Valider que le plan est dans la liste autorisée
    // Empêche qu'une ancienne session avec 'business' ou 'elite' mette à jour la base
    if (!VALID_PLANS.has(planMeta)) {
      console.error('Plan invalide reçu de Stripe:', planMeta);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Plan invalide' }),
      };
    }

    const normalizedPlan = planMeta;

    // ════════════════════════════════════════════════════════════════
    // 5️⃣ UPDATE SUPABASE USER
    // ════════════════════════════════════════════════════════════════

    const updateData = {
      plan: normalizedPlan,
      status: 'active',
      updated_at: new Date().toISOString(),
      stripe_session_id: session_id,
    };

    const patchRes = await fetchWithTimeout(
      `${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(requestEmail)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(updateData),
      },
      10000
    );

    if (!patchRes.ok) {
      const details = await patchRes.text();
      console.error('Supabase PATCH failed:', details);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Database update failed' }),
      };
    }

    const updatedRows = await patchRes.json();
    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' }),
      };
    }

    // ════════════════════════════════════════════════════════════════
    // 6️⃣ OPTIONAL: RECORD COMMISSION
    // ════════════════════════════════════════════════════════════════

    if (session.metadata?.referrer_id) {
      const commissionRes = await fetchWithTimeout(
        `${process.env.SUPABASE_URL}/rest/v1/affiliates_commissions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            partner_id: session.metadata.referrer_id,
            referred_user_email: requestEmail,
            amount_paid: session.amount_total / 100,
            commission_amount: (session.amount_total / 100) * 0.2, // 20% côté serveur
            status: 'paid',
          }),
        },
        8000
      );

      if (!commissionRes.ok) {
        const t = await commissionRes.text();
        console.warn('Commission record failed (non-blocking):', t);
      }
    }

    // ── Email confirmation paiement Nexa (non-bloquant) ─────────
    const userRow = updatedRows[0] || {};
    if (userRow.email) {
      // Email au client
      fetch(`${process.env.SITE_URL || 'https://nexaai.fr'}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'nexa_purchase',
          to: userRow.email,
          data: { prenom: userRow.prenom || '', plan: normalizedPlan, amount: (session.amount_total / 100).toFixed(2) }
        })
      }).catch(e => console.warn('send-email client:', e.message));

      // Email à toi (owner)
      fetch(`${process.env.SITE_URL || 'https://nexaai.fr'}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'owner_nexa_sale',
          to: process.env.OWNER_EMAIL || 'contact@nexaai.fr',
          data: { buyerEmail: userRow.email, plan: normalizedPlan, amount: (session.amount_total / 100).toFixed(2) }
        })
      }).catch(e => console.warn('send-email owner:', e.message));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        valid: true,
        plan: normalizedPlan,
        user: updatedRows[0] || {},
      }),
    };
  } catch (err) {
    console.error('Verify payment handler error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
