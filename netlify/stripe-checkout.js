/**
 * netlify/functions/create-checkout.js
 *
 * Conseils importants (lis les commentaires "NOTE:") :
 * - Le split 80/20 via Connect ne s'applique qu'au paiement créé par CE Checkout.
 *   Ce n'est PAS automatiquement "toutes les ventes TikTok" : ça demande un flux paiement séparé (Connect sur ventes marchandes).
 * - Ne mets JAMAIS des identifiants partenaires "secrets" en dur dans le repo.
 *   Passe plutôt referrer_id + lookup DB (partners.stripe_connect_id).
 * - Un price Stripe à 0€ peut fonctionner en payment, mais teste en mode test Stripe.
 *   Si Stripe refuse : alternative = pas de Checkout (forfait gratuit interne) OU coupon 100% sur un prix non-nul.
 */

const PRICE_IDS = {
  starter: "price_1THSyjP8svYH1bkOt686fqqC",
  pro: "price_1THSzsP8svYH1bkOndl82cmU",
  business: "price_1TP3ihP8svYH1bkOOITtQVaA",
  elite: "price_1TJ8XPP8svYH1bkOWwjjcZ87",

  // NOTE: souvent un "partner_activation" à 0€ = one-time (payment), pas un abonnement.
  partner_activation: "price_1TWJqYP8svYH1bkOi4njRmnX",
};

// Plans facturés en récurrence (si tes price Stripe sont des prices "recurring")
const SUBSCRIPTION_PLANS = new Set(["starter", "pro", "business", "elite"]);

function siteUrl() {
  // NOTE: configure SITE_URL dans Netlify (prod + preview si besoin)
  const base = (process.env.SITE_URL || "https://steady-centaur-82e10a.netlify.app").replace(/\/$/, "");
  return base;
}

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function checkoutModeForPlan(plan) {
  // NOTE: partner_activation : en général "payment" (achat unique, même à 0€)
  if (plan === "partner_activation") return "payment";

  // NOTE: si un jour un de tes price IDs n'est pas récurrent, enlève-le de SUBSCRIPTION_PLANS
  if (SUBSCRIPTION_PLANS.has(plan)) return "subscription";

  // défaut prudent
  return "payment";
}

/**
 * TODO (recommandé) : remplacer ce mapping par Supabase
 * ex: SELECT stripe_connect_id FROM partners WHERE public_ref = $1 AND active = true
 *
 * Ne laisse pas des acct_ en dur ici : c'est dur à maintenir et ça finit sur Git.
 */
async function resolveConnectAccountId({ referrer_id, clientStripeConnectId }) {
  // Si ton front envoie déjà un compte vérifié (et que tu le re-valideras côté serveur avec l'utilisateur connecté)
  if (typeof clientStripeConnectId === "string" && clientStripeConnectId.startsWith("acct_")) {
    return clientStripeConnectId;
  }

  // Si tu as seulement un referrer_id, fais un lookup DB ici et retourne acct_...
  // if (referrer_id) return await db.lookup(...)

  void referrer_id;
  return "";
}

function appendConnectSplit({ stripeParams, mode, connectId }) {
  if (!connectId) return;

  // NOTE: application_fee_percent = part prélevée par TA plateforme (toi), le reste va au compte destination (partenaire),
  // hors mécanique interne Stripe + cas limites. Vérifie toujours en test mode avec un vrai acct_ test.

  if (mode === "payment") {
    stripeParams.append("payment_intent_data[application_fee_percent]", "80");
    stripeParams.append("payment_intent_data[transfer_data][destination]", connectId);
    return;
  }

  if (mode === "subscription") {
    stripeParams.append("subscription_data[application_fee_percent]", "80");
    stripeParams.append("subscription_data[transfer_data][destination]", connectId);
  }
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { plan, email, clientStripeConnectId, referrer_id } = body;

  if (!isValidEmail(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Email invalide." }) };
  }

  const finalPriceId = PRICE_IDS[plan];
  if (!finalPriceId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Plan invalide." }) };
  }

  const mode = checkoutModeForPlan(plan);

  const base = siteUrl();
  const success_url = `${base}/dashboard.html?payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancel_url = `${base}/#pricing`;

  try {
    const stripeParams = new URLSearchParams({
      "payment_method_types[]": "card",
      mode,
      customer_email: String(email).trim(),
      "line_items[0][price]": finalPriceId,
      "line_items[0][quantity]": "1",
      success_url,
      cancel_url,
      "metadata[plan]": String(plan),
      locale: "fr",
    });

  // NOTE: referrer_id sert surtout au tracking + verify-payment + commissions en base.
  // Le split Connect utilise connectId (acct_). Ce sont deux briques complémentaires.
  if (referrer_id) {
    stripeParams.append("metadata[referrer_id]", String(referrer_id));
  }

  const connectId = await resolveConnectAccountId({ referrer_id, clientStripeConnectId });
  appendConnectSplit({ stripeParams, mode, connectId });

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: stripeParams.toString(),
    });

    const raw = await stripeResponse.text();
    let session;
    try {
      session = raw ? JSON.parse(raw) : {};
    } catch {
      session = { error: { message: raw || "Invalid Stripe response" } };
    }

    if (!stripeResponse.ok || session.error) {
      const msg = session.error?.message || raw || `Stripe error (${stripeResponse.status})`;

      // NOTE: si ton price 0€ est incompatible avec mode/price type, Stripe renverra une erreur claire ici.
      return { statusCode: 400, headers, body: JSON.stringify({ error: msg }) };
    }

    if (!session.url) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "No checkout URL returned" }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url, id: session.id, mode }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Server error" }) };
  }
};
