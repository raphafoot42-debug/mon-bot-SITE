/**
 * NEXA TRACK-SALE — Pixel de tracking des ventes clients
 * Reçoit une notification quand un prospect achète sur le site du client
 * S'aligne sur : verify-payment.js (table affiliates_commissions), nexa.js (acct_ + store_url)
 */

// ════════════════════════════════════════════════════════════════
// 🔧 HELPERS
// ════════════════════════════════════════════════════════════════

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isValidAmount(amount) {
  return typeof amount === 'number' && amount > 0 && amount < 100000;
}

// ════════════════════════════════════════════════════════════════
// 🔍 VÉRIFIER QUE LE PARTENAIRE EXISTE DANS SUPABASE
// Empêche les fausses ventes avec un acct_ inventé
// ════════════════════════════════════════════════════════════════

async function verifyPartner(stripeConnectId) {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

  try {
    const res = await fetchWithTimeout(
      `${url}/rest/v1/users?stripe_connect_id=eq.${encodeURIComponent(stripeConnectId)}&select=id,email,prenom,plan`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key } },
      8000
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return rows?.[0]?.plan === 'affiliation' ? rows[0] : false;
  } catch (e) {
    console.error('verifyPartner error:', e.message);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════
// 💾 ENREGISTRER LA VENTE DANS SUPABASE
// Table : client_sales (différente de affiliates_commissions qui est pour l'affiliation Nexa)
// ════════════════════════════════════════════════════════════════

async function recordSale({ partnerId, stripeConnectId, amount, currency, prospectRef }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = await fetchWithTimeout(
    `${url}/rest/v1/client_sales`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        apikey: key,
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        partner_id:        partnerId,          // UUID Supabase du client
        stripe_connect_id: stripeConnectId,    // acct_xxxxx
        amount:            amount,             // montant en €
        currency:          currency || 'eur',
        prospect_ref:      prospectRef || null, // ref optionnelle du prospect
        recorded_at:       new Date().toISOString(),
        source:            'pixel',            // vente détectée via pixel
      }),
    },
    8000
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Supabase insert failed: ' + err);
  }
  return true;
}

// ════════════════════════════════════════════════════════════════
// 🌐 MAIN HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async function (event) {
  // ⚠️ CORS '*' intentionnel — ce pixel est appelé depuis les sites externes des clients
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Vérifier env vars
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { ref, amount, currency, prospect_ref } = body;

  // ── Validation ───────────────────────────────────────────────
  if (!ref || !ref.startsWith('acct_')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'ref invalide — doit commencer par acct_' }) };
  }

  if (!isValidAmount(Number(amount))) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'amount invalide — nombre positif requis' }) };
  }

  // ── Vérifier que le partenaire existe ────────────────────────
  const partner = await verifyPartner(ref);
  if (!partner) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Partenaire non trouvé ou non affilié' }) };
  }

  // ── Enregistrer la vente ─────────────────────────────────────
  try {
    await recordSale({
      partnerId:       partner.id,
      stripeConnectId: ref,
      amount:          Number(amount),
      currency:        currency || 'eur',
      prospectRef:     prospect_ref || null,
    });

    // ── Notifier le partenaire par email (non-bloquant) ─────────
    const partnerEmail = partner.email;
    const commission   = (Number(amount) * 0.20).toFixed(2);
    if (partnerEmail) {
      fetch(`${process.env.SITE_URL || 'https://nexaai.fr'}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'sale_notify',
          to: partnerEmail,
          data: {
            partnerPrenom: partner.prenom || '',
            buyerEmail:    prospect_ref || 'client',
            productName:   partner.product_name || 'ton produit',
            amount:        Number(amount).toFixed(2),
            commission,
          }
        })
      }).catch(e => console.warn('send-email partenaire:', e.message));
    }

    // ── Notifier le owner (toi) par email (non-bloquant) ────────
    fetch(`${process.env.SITE_URL || 'https://nexaai.fr'}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'owner_affiliation_sale',
        to: process.env.OWNER_EMAIL || 'contact@nexaai.fr',
        data: {
          clientEmail: partnerEmail || 'inconnu',
          productName: partner.product_name || 'produit affiliation',
          amount: Number(amount).toFixed(2),
        }
      })
    }).catch(e => console.warn('send-email owner:', e.message));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Vente enregistrée' }),
    };
  } catch (err) {
    console.error('track-sale error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
