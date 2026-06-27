/**
 * NEXA ANALYZE-NICHE — Analyse la niche d'un client affiliation
 * Retourne un score, un verdict honnête et une suggestion si niche faible
 */

const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

const PROMPT = `
Tu es un expert en marketing digital et en vente sur TikTok.
Un utilisateur veut vendre son produit via Nexa IA sur TikTok.

Analyse sa niche et donne un verdict HONNÊTE.

CRITÈRES D'ÉVALUATION :
- Demande sur TikTok (niche populaire vs niche morte)
- Prix adapté à la vente en DM froid (< 200€ = facile, > 500€ = difficile)
- Concurrence (trop saturé = mauvais, bonne demande = bien)
- Produit concret avec valeur claire

NICHES QUI CONVERTISSENT BIEN SUR TIKTOK :
coaching business/argent, formation réseaux sociaux, dropshipping, e-commerce, bien-être/sport, développement personnel

NICHES QUI CONVERTISSENT MAL :
MLM, crypto sans formation, produits génériques sans différenciation, services locaux B2B, niches illégales

RÉPONDS UNIQUEMENT EN JSON :
{
  "score": 0-100,
  "verdict": "2-3 phrases honnêtes sur les chances de succès",
  "suggestion": "Si score < 50 : propose une niche ou angle qui marcherait mieux pour ce profil"
}
`;

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": process.env.SITE_URL || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { niche, product_name, product_price, description } = body;

  if (!niche || !product_name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "niche et product_name requis" }) };
  }

  try {
    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 500,
      system: PROMPT,
      messages: [{
        role: "user",
        content: `Produit : ${product_name}\nPrix : ${product_price}€\nNiche : ${niche}\nDescription : ${description || "non fournie"}`
      }]
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Réponse JSON invalide");

    const result = JSON.parse(match[0]);
    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    console.error("analyze-niche error:", err.message);
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        score: 0,
        verdict: "Analyse temporairement indisponible. Réessaie dans quelques minutes.",
        suggestion: ""
      })
    };
  }
};
