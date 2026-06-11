/**
 * NEXA GET-PRODUCT — Retourne les infos d'un produit depuis Supabase
 * Appelé par shop.html via ?acct=acct_xxxxx
 */

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*", // public — page de vente accessible à tous
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60", // cache 60s pour ne pas surcharger Supabase
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const acct = event.queryStringParameters?.acct;

  if (!acct || !acct.startsWith("acct_")) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "acct invalide" }) };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server configuration error" }) };
  }

  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await fetchWithTimeout(
      `${url}/rest/v1/products?stripe_connect_id=eq.${encodeURIComponent(acct)}&status=eq.active&select=name,price,description,niche&limit=1`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key } },
      8000
    );

    if (!res.ok) throw new Error("Supabase error");
    const rows = await res.json();

    if (!rows || rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: "Produit non trouvé" }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, product: rows[0] }),
    };

  } catch (err) {
    console.error("get-product error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
