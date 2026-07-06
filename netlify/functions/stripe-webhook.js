/**
 * NEXA STRIPE WEBHOOK — Notification automatique de vente
 * Écoute Stripe directement (server-to-server), donc ça marche même si
 * le prospect ferme son onglet juste après avoir payé.
 *
 * Ne gère qu'un seul événement : une vente sur une page de vente
 * "affiliation_product" (créée par stripe-checkout.js). Dès que ça arrive :
 *   1. Email au client (son produit vient de se vendre)
 *   2. Email à toi (ta commission de 20%)
 *
 * ⚠️ Config requise sur Netlify (variables d'environnement) :
 *   - STRIPE_SECRET_KEY        (déjà utilisée ailleurs)
 *   - STRIPE_WEBHOOK_SECRET    (nouvelle — voir en bas du fichier)
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (déjà utilisées ailleurs)
 *   - SITE_URL / OWNER_EMAIL   (déjà utilisées ailleurs)
 */

const crypto = require('crypto');

// ════════════════════════════════════════════════════════════════
// 🔐 VÉRIFICATION SIGNATURE STRIPE (sans SDK, comme le reste du projet)
// ════════════════════════════════════════════════════════════════

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('='))
  );
  const timestamp = parts.t;
  const receivedSig = parts.v1;
  if (!timestamp || !receivedSig) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  // Comparaison à temps constant — évite les attaques par timing
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(receivedSig, 'hex')
    );
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ════════════════════════════════════════════════════════════════
// 🌐 MAIN HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET manquant');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  // ── 1️⃣ Vérifier que ça vient bien de Stripe ────────────────────
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const isValid = verifyStripeSignature(event.body, signature, process.env.STRIPE_WEBHOOK_SECRET);

  if (!isValid) {
    console.error('Signature Stripe invalide — requête ignorée');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // ── 2️⃣ On ne réagit qu'à un paiement de page de vente terminé ──
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' }; // Stripe attend un 200 rapide, même si on ignore
  }

  const session = stripeEvent.data?.object || {};

  // ── 2️⃣bis Vente d'un forfait Nexa classique (Starter/Pro) ──────
  // Bloc totalement isolé du reste : ne touche à rien d'existant, ne fait
  // que t'envoyer un email quand un vrai abonnement Nexa est payé.
  const NEXA_PLANS = new Set(['starter', 'pro', 'starter_annual', 'pro_annual']);
  if (NEXA_PLANS.has(session.metadata?.plan)) {
    try {
      const siteUrl = process.env.SITE_URL || 'https://steady-centaur-82e10a.netlify.app';
      const buyerEmail = session.customer_details?.email || session.customer_email || '';
      const amount = (session.amount_total || 0) / 100;

      await fetch(`${siteUrl}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'owner_nexa_sale',
          to: process.env.OWNER_EMAIL || 'contact@nexaai.fr',
          data: {
            buyerEmail,
            plan: session.metadata.plan.replace('_annual', ''),
            amount: amount.toFixed(2),
          },
        }),
      }).catch((e) => console.warn('send-email owner_nexa_sale:', e.message));
    } catch (err) {
      console.error('stripe-webhook owner_nexa_sale error:', err.message);
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  if (session.metadata?.plan !== 'affiliation_product') {
    return { statusCode: 200, body: 'ignored' }; // pas une vente de page ambassadeur
  }

  try {
    const acct = session.metadata.acct;
    const amount = (session.amount_total || 0) / 100;
    const buyerEmail = session.customer_details?.email || session.customer_email || '';

    // Nom du produit — récupéré depuis les line items Stripe
    const qs = new URLSearchParams();
    qs.append('expand[]', 'line_items');
    const sRes = await fetchWithTimeout(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session.id)}?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } },
      10000
    );
    const sData = await sRes.json();
    const productName = sData.line_items?.data?.[0]?.description || 'ton produit';

    // ── 3️⃣ Retrouver le client via son stripe_connect_id ──────────
    const userRes = await fetchWithTimeout(
      `${process.env.SUPABASE_URL}/rest/v1/users?stripe_connect_id=eq.${encodeURIComponent(acct)}&select=email,prenom&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
      },
      10000
    );
    const users = userRes.ok ? await userRes.json() : [];
    const partner = users[0];

    const siteUrl = process.env.SITE_URL || 'https://steady-centaur-82e10a.netlify.app';
    const commission = (amount * 0.20).toFixed(2);

    // ⚠️ CORRECTION : ces deux fetch n'étaient jamais "await" — la fonction
    // pouvait retourner (et l'environnement serverless se geler) avant même
    // que la requête réseau ait eu le temps de partir. Résultat : les emails
    // de vente pouvaient ne jamais arriver, de façon imprévisible (parfois
    // ça passe si le fetch part assez vite, parfois non). On attend
    // maintenant réellement les deux envois avant de répondre à Stripe.
    // Promise.allSettled : si l'un des deux échoue, l'autre part quand même.
    const emailJobs = [];

    // ── 4️⃣ Email au client ──────────────────────────
    if (partner?.email) {
      emailJobs.push(
        fetch(`${siteUrl}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'sale_notify',
            to: partner.email,
            data: {
              partnerPrenom: partner.prenom || '',
              buyerEmail,
              productName,
              amount: amount.toFixed(2),
              commission,
            },
          }),
        }).catch((e) => console.warn('send-email sale_notify:', e.message))
      );
    }

    // ── 5️⃣ Email à toi (owner) ──────────────────────
    emailJobs.push(
      fetch(`${siteUrl}/.netlify/functions/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'owner_affiliation_sale',
          to: process.env.OWNER_EMAIL || 'contact@nexaai.fr',
          data: {
            clientEmail: partner?.email || acct,
            productName,
            amount: amount.toFixed(2),
          },
        }),
      }).catch((e) => console.warn('send-email owner_affiliation_sale:', e.message))
    );

    await Promise.allSettled(emailJobs);

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('stripe-webhook error:', err.message);
    // On renvoie quand même 200 pour éviter que Stripe ne re-tente en boucle
    // une erreur qui ne se réparera pas toute seule (ex: user introuvable).
    return { statusCode: 200, body: JSON.stringify({ received: true, warning: err.message }) };
  }
};

/**
 * ─────────────────────────────────────────────────────────────────
 * MISE EN PLACE (une seule fois, 5 minutes) :
 *
 * 1. Mets ce fichier au même endroit que tes autres fonctions Netlify
 *    (à côté de verify-payment.js, stripe-checkout.js, etc.)
 *
 * 2. Sur ton Dashboard Stripe → Développeurs → Webhooks → Ajouter un endpoint
 *    URL à renseigner : https://tonsite.netlify.app/.netlify/functions/stripe-webhook
 *    Événement à cocher : checkout.session.completed
 *
 * 3. Stripe te donne une "clé de signature" (commence par whsec_...)
 *    → colle-la dans Netlify (Site settings → Environment variables)
 *      sous le nom STRIPE_WEBHOOK_SECRET
 *
 * 4. Redéploie. C'est tout, rien d'autre à toucher.
 * ─────────────────────────────────────────────────────────────────
 */
