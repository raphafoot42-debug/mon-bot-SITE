// netlify/functions/verify-payment.js
const PARTNER_PRICE_ID = "price_1TWJqYP8svYH1bkOi4njRmnX";

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

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { session_id, email } = body;

  if (!session_id || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "session_id and email are required" }) };
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing server config" }) };
  }

  try {
    const qs = new URLSearchParams();
    qs.append("expand[]", "payment_intent");
    qs.append("expand[]", "line_items");
    qs.append("expand[]", "line_items.data.price");

    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}?${qs.toString()}`,
      { headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY } }
    );

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: session.error?.message || "Stripe session fetch failed" }),
      };
    }

    if (session.payment_status !== "paid") {
      return { statusCode: 402, headers, body: JSON.stringify({ error: "Not paid" }) };
    }

    const stripeEmail = String(session.customer_details?.email || session.customer_email || "")
      .trim()
      .toLowerCase();
    const requestEmail = String(email).trim().toLowerCase();

    if (!stripeEmail || stripeEmail !== requestEmail) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Email does not match Stripe checkout session" }),
      };
    }

    const lineItems = session.line_items?.data || [];
    const firstPriceId = lineItems[0]?.price?.id;

    const isPartnerActivation =
      session.metadata?.plan === "partner_activation" || firstPriceId === PARTNER_PRICE_ID;

    let planMeta = session.metadata?.plan || "starter";
    const normalizedPlan = isPartnerActivation ? "partner" : String(planMeta).replace("-once", "");

    const updateData = {
      updated_at: new Date().toISOString(),
      stripe_session_id: session_id,
    };

    if (isPartnerActivation) {
      updateData.is_partner = true;
    } else {
      updateData.plan = normalizedPlan;
    }

    const patchRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(requestEmail)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Prefer: "return=representation",
        },
        body: JSON.stringify(updateData),
      }
    );

    if (!patchRes.ok) {
      const details = await patchRes.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Supabase update failed", details }) };
    }

    const updatedRows = await patchRes.json();
    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "No user found for this email" }) };
    }

    if (session.metadata?.referrer_id) {
      const commissionRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/affiliates_commissions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          partner_id: session.metadata.referrer_id,
          referred_user_email: requestEmail,
          amount_paid: session.amount_total / 100,
          commission_amount: (session.amount_total / 100) * 0.2,
          status: "paid",
        }),
      });

      if (!commissionRes.ok) {
        const t = await commissionRes.text();
        console.error("affiliates_commissions insert failed:", t);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        valid: true,
        plan: normalizedPlan,
        isPartner: !!isPartnerActivation,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
