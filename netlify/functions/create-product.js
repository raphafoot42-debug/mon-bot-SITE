/**
 * NEXA CREATE-PRODUCT — Enregistre le produit d'un client affiliation dans Supabase
 */

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": process.env.SITE_URL || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server configuration error" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { email, stripe_connect_id, name, price, description, niche, niche_score, design, testimonials, guarantee, spots_left } = body;

  if (!email || !stripe_connect_id || !name || !price) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "email, stripe_connect_id, name, price requis" }) };
  }

  if (!stripe_connect_id.startsWith("acct_")) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "stripe_connect_id invalide" }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // Récupérer l'ID utilisateur
    const userRes = await fetchWithTimeout(
      `${url}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key } }, 8000
    );
    const users = await userRes.json();
    const partnerId = users?.[0]?.id;
    if (!partnerId) throw new Error("Utilisateur non trouvé");

    // Créer/mettre à jour le produit
    const productRes = await fetchWithTimeout(
      `${url}/rest/v1/products`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          apikey: key,
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          partner_id:        partnerId,
          stripe_connect_id: stripe_connect_id,
          name:              String(name).slice(0, 100),
          price:             parseFloat(price),
          description:       String(description || "").slice(0, 300),
          niche:             String(niche || "").slice(0, 100),
          niche_score:       parseInt(niche_score) || 50,
          design:            ['minimal','premium','energy'].includes(design) ? design : 'minimal',
          testimonials:      Array.isArray(testimonials) ? testimonials.slice(0,3) : [],
          guarantee:         String(guarantee || "").slice(0, 150),
          spots_left:        spots_left ? parseInt(spots_left) : null,
          status:            "active",
          created_at:        new Date().toISOString(),
        }),
      }, 8000
    );

    if (!productRes.ok) {
      const err = await productRes.text();
      throw new Error("Supabase insert failed: " + err);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        shop_url: `${process.env.SITE_URL || ""}/shop/${stripe_connect_id}`,
      }),
    };

  } catch (err) {
    console.error("create-product error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
