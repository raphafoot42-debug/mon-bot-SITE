// netlify/functions/claude.js
const crypto = require("crypto");

const NEXA_SYSTEM = `Tu t'appelles Nexa. Tu es une closer d'élite spécialisée dans la vente de services par DM. Tu travailles pour NexaAI. Tu ne mentionnes jamais Claude ni Anthropic.

IDENTITÉ : professionnelle, experte en marketing, accessible. Ton : expert-ami. Tu parles comme quelqu'un qui tape sur son téléphone.

FORMAT : jamais de pavés. Max 2-3 courtes phrases. Termine TOUJOURS par une question courte.

TUNNEL :
1) CONNEXION : valide ce que dit le prospect, montre que tu as compris.
2) CURIOSITÉ : une question courte et utile (contexte, objectif, contrainte).
3) SOLUTION : présente NexaAI avec des bénéfices concrets (gain de temps, cadence, clarté) sans inventer des chiffres.
4) CLOSING : donne le lien de paiement seulement si le prospect est prêt. Si tu utilises un mot-clé technique pour le front, utilise exactement : REDIRECT:<url> (une seule fois, quand c'est pertinent).

FORFAITS (infos produit, ne pas inventer d'autres prix) :
- Starter : 39€/mois - 10 prospects/jour
- Pro : 94€/mois - 80 prospects/jour
- Business : 194€/mois - 300 prospects/jour
- Elite : 494€/mois - 750 prospects/jour

TIKTOK / DM : tu aides à structurer des conversations DM de façon professionnelle. Pas de harcèlement, pas d'insistance toxique, pas de fausse urgence, pas de fausse preuve sociale, pas de promesses chiffrées inventées. Si une info manque, pose une question.

RÈGLES : français, max 3 phrases, finir par une question, jamais Claude/Anthropic.`;

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
}

function timingSafeEqualStr(a, b) {
  const aa = sha256Hex(a);
  const bb = sha256Hex(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(Buffer.from(aa, "utf8"), Buffer.from(bb, "utf8"));
}

function getHeader(headers, name) {
  if (!headers) return "";
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k] || "";
  }
  return "";
}

function extractAssistantText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
}

function normalizeAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.content !== "string") continue;
    const content = m.content.trim();
    if (!content) continue;
    out.push({ role: m.role, content });
  }
  return out;
}

function buildMessagesFromLegacy(body) {
  const history = Array.isArray(body.history) ? body.history : [];
  const msg = typeof body.message === "string" ? body.message.trim() : "";
  if (!msg) return null;

  const msgs = [];
  for (const h of history) {
    if (!h || !h.role) continue;
    const role = h.role === "assistant" ? "assistant" : "user";
    const content = typeof h.content === "string" ? h.content.trim() : "";
    if (!content) continue;
    msgs.push({ role, content });
  }

  msgs.push({ role: "user", content: msg });
  return msgs.length ? msgs : null;
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Nexa-Secret",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Optionnel mais fortement recommandé : empêcher le monde d'abuser de ta clé Anthropic
  const fnSecret = process.env.NEXA_FUNCTION_SECRET;
  if (fnSecret) {
    const sent = getHeader(event.headers, "x-nexa-secret");
    if (!sent || !timingSafeEqualStr(sent, fnSecret)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
    }
  }

  let body;
  try {
    if (!event.body || String(event.body).trim() === "") {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Empty request body" }) };
    }
    body = JSON.parse(event.body);
  } catch (parseError) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON", details: parseError.message }) };
  }

  try {
    // Admin : OK temporairement, mais idéalement une autre function + rate limit Netlify
    if (body.adminAuth) {
      const adminPass = process.env.ADMIN_PASSWORD;
      if (!adminPass) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "ADMIN_PASSWORD not configured" }) };
      }
      const ok = typeof body.password === "string" && timingSafeEqualStr(body.password, adminPass);
      return { statusCode: ok ? 200 : 401, headers, body: JSON.stringify({ ok }) };
    }

    if (!process.env.CLAUDE_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "CLAUDE_API_KEY not configured" }) };
    }

    let messages = null;
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      messages = normalizeAnthropicMessages(body.messages);
    } else {
      messages = buildMessagesFromLegacy(body);
    }

    if (!messages || messages.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "messages required (Anthropic format) OR message + optional history[]",
        }),
      };
    }

    const recentMessages = messages.slice(-10);

    const extraSystem = body.system || body.system_instructions || "";
    const finalSystem = extraSystem ? `${NEXA_SYSTEM}\n\n${extraSystem}` : NEXA_SYSTEM;

    const model = body.model || process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
    const max_tokens = typeof body.max_tokens === "number" ? body.max_tokens : 400;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        system: finalSystem,
        messages: recentMessages,
      }),
    });

    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data?.error || raw || "Anthropic API error" }),
      };
    }

    const reply = extractAssistantText(data) || "Je te réponds dans un instant : tu veux surtout scaler tes DM ou sécuriser la qualité des réponses ?";

    // Compat : ton front peut lire `reply`, et tu gardes la payload utile pour debug
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply,
        id: data.id,
        model: data.model,
        usage: data.usage,
        // compat optionnelle si un vieux code lit encore la forme Anthropic
        content: data.content,
      }),
    };
  } catch (err) {
    console.error("Claude function error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal server error", details: err.message }) };
  }
};
