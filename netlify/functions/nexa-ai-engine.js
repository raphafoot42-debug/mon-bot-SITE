/**
 * ═══════════════════════════════════════════════════════════════
 * 🤖 NEXA-AI-ENGINE — Moteur IA Principal (Netlify Function)
 * 
 * Fusionne chat.js + nexa-ai-engine.js
 * Actions : scout | closer | security | chat
 * ═══════════════════════════════════════════════════════════════
 */

const Anthropic = require("@anthropic-ai/sdk");

// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const NEXA_CONFIG = {
  MODEL:       process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  MAX_TOKENS:  1000,
  TEMPERATURE: 0.7,
};

const CHAT_CONFIG = {
  preModelDelayMinMs:  800,
  preModelDelayMaxMs:  2200,
  maxHistoryMessages:  24,
};

// ════════════════════════════════════════════════════════════════
// 💳 FORFAITS — synchronisés avec payment.js
// ════════════════════════════════════════════════════════════════

// Limites de messages par jour — synchronisées avec payment.js
// Starter €39/€340 = 40 msgs/jour | Pro €59/€590 = 75 msgs/jour | Affiliation gratuit = 50 msgs/jour
const FORFAITS = {
  starter:         { messages_per_day: 40, label: "Starter ✨" },
  starter_annual:  { messages_per_day: 40, label: "Starter Annuel ✨" },
  pro:             { messages_per_day: 75, label: "Pro 🚀" },
  pro_annual:      { messages_per_day: 75, label: "Pro Annuel 🚀" },
  affiliation:     { messages_per_day: 50, label: "Ambassadeur 🤝" },
};

// ════════════════════════════════════════════════════════════════
// 🔐 CLIENT ANTHROPIC
// ════════════════════════════════════════════════════════════════

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ════════════════════════════════════════════════════════════════
// 🔍 PROMPT 1 : NEXA-SCOUT (Analyse de profil)
// ════════════════════════════════════════════════════════════════

const PROMPT_SCOUT = `
# 🔍 NEXA-SCOUT : ANALYSE DE PROFIL TIKTOK

## MISSION
Tu es un expert en analyse comportementale. Analyse le profil TikTok fourni et génère un rapport de qualification JSON.

## FORMAT DE RÉPONSE (JSON strict, rien d'autre)
{
  "username": "string",
  "score_certitude": 0-100,
  "categorie": "FROID | TIEDE | BRULANT",
  "profil_psycho": "string (ex: Curieux, Sceptique, Ready-to-buy)",
  "points_forts": ["string"],
  "objections_probables": ["string"],
  "recommandation": "string",
  "produit_recommande": "string"
}

## CRITÈRES DE SCORING
- 0-40 = FROID : peu ou pas engagé, profil générique
- 41-70 = TIÈDE : intéressé mais hésitant
- 71-100 = BRÛLANT : engagé, pose des questions, prêt à acheter

Réponds UNIQUEMENT avec le JSON valide.
`;

// ════════════════════════════════════════════════════════════════
// 💬 PROMPT 2 : NEXA-CLOSER (Génération de messages)
// ════════════════════════════════════════════════════════════════

const PROMPT_CLOSER = `
# 💬 NEXA-CLOSER : GÉNÉRATEUR DE MESSAGES DE VENTE

## IDENTITÉ
Tu es NEXA, un assistant de conversation humain et naturel qui aide à convertir des DM TikTok.

## OBJECTIF
Générer le prochain message de la conversation pour avancer vers une action claire (clic lien, réponse, rendez-vous).

## RÈGLES STRICTES
- Messages courts : 1 à 3 phrases max (style DM smartphone)
- Adapte ton ton au prospect (cool ou pro selon son style)
- Maximum 1 lien par réponse, seulement si pertinent
- Ne partage le lien que si le prospect est prêt — sinon pose 1 question ciblée
- Jamais de fausse urgence, jamais de promesse chiffrée inventée
- Jamais de harcèlement, respecte si le prospect dit stop

## RÈGLES ÉTHIQUES (OBLIGATOIRES)
- Ne prétends JAMAIS être humain si on te le demande directement — dis que tu es un assistant IA
- Pas de manipulation psychologique agressive
- Pas de fausse urgence ("c'est en promo cette semaine" si c'est faux)

## GESTION DU QUOTA
- FROID (score < 40) : 2-3 messages max, économise le quota
- TIÈDE (score 41-70) : 4-6 messages, discussion fluide
- BRÛLANT (score > 70) : jusqu'à 8 messages si vraiment engagé

## FORMAT DE RÉPONSE
Réponds UNIQUEMENT avec le message à envoyer, rien d'autre.
`;

// ════════════════════════════════════════════════════════════════
// 🛡️ PROMPT 3 : NEXA-SECURITY (Monitoring + quota)
// ════════════════════════════════════════════════════════════════

const PROMPT_SECURITY = `
# 🛡️ NEXA-SECURITY : MONITORING ET PROTECTION

## MISSION
Analyser les données d'usage d'un compte et générer un rapport de monitoring JSON.

## FORFAITS RÉELS
- starter : 40 messages/jour — 39€/mois (ou 340€/an)
- pro : 75 messages/jour — 59€/mois (ou 590€/an)
- affiliation : 50 messages/jour — gratuit (20% commission)

## PROTOCOLE ANTI-BAN TIKTOK
- Max 40 messages/jour par compte TikTok (quelle que soit le forfait)
- Max 8 messages au même prospect
- Délai minimum entre messages : 2-5 minutes
- Pic d'activité : 10h-22h

## FORMAT DE RÉPONSE (JSON strict)
{
  "client_id": "string",
  "forfait": "string",
  "messages_utilises": number,
  "quota_total": number,
  "quota_restant": number,
  "taux_conversion": "string",
  "risque_ban": "VERT | ORANGE | ROUGE",
  "raison_risque": "string",
  "recommandation": "string"
}

Réponds UNIQUEMENT avec le JSON valide.
`;

// ════════════════════════════════════════════════════════════════
// 💬 PROMPT 4 : CHAT SIMPLE (Dashboard Nexa)
// ════════════════════════════════════════════════════════════════

const PROMPT_CHAT = process.env.CLAUDE_SYSTEM_PROMPT || `
Tu es NEXA, un assistant IA qui aide les créateurs TikTok à automatiser leur prospection.
Tu réponds toujours en français, de façon concise et utile.
`;

// ════════════════════════════════════════════════════════════════
// 🔧 HELPERS
// ════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function trimHistory(history) {
  if (history.length > CHAT_CONFIG.maxHistoryMessages) {
    return history.slice(-CHAT_CONFIG.maxHistoryMessages);
  }
  return history;
}

function getQuotaForPlan(plan) {
  return FORFAITS[plan]?.messages_per_day ?? FORFAITS.affiliation.messages_per_day;
}

// ════════════════════════════════════════════════════════════════
// 🔍 ACTION 1 : SCOUT
// ════════════════════════════════════════════════════════════════

async function nexaScout(tiktokUsername, clientProducts) {
  const userPrompt = `
Analyse ce profil TikTok et fournis le rapport JSON complet :

**Profil TikTok** : ${tiktokUsername}

**Produits disponibles** :
${(clientProducts || []).map((p) => `- ${p.name} (${p.niche})`).join("\n")}

Réponds UNIQUEMENT avec le JSON valide.
  `;

  const response = await client.messages.create({
    model: NEXA_CONFIG.MODEL,
    max_tokens: NEXA_CONFIG.MAX_TOKENS,
    temperature: NEXA_CONFIG.TEMPERATURE,
    system: PROMPT_SCOUT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Impossible de parser la réponse JSON du Scout");
  return JSON.parse(match[0]);
}

// ════════════════════════════════════════════════════════════════
// 💬 ACTION 2 : CLOSER
// ════════════════════════════════════════════════════════════════

async function nexaCloser(prospectData, conversationHistory, quota) {
  const conversationText = (conversationHistory || [])
    .map((msg) => `${msg.role}: ${msg.text || msg.content}`)
    .join("\n");

  const userPrompt = `
**Prospect** :
- Username : ${prospectData.username}
- Score : ${prospectData.score}%
- Profil : ${prospectData.psycho_profile || prospectData.profil_psycho}
- Lien de vente : ${prospectData.sales_link || "non défini"}

**Historique** :
${conversationText || "Première prise de contact"}

**Quota restant** : ${quota} messages

Génère le PROCHAIN message. Respecte les règles. Réponds JUSTE le message.
  `;

  const response = await client.messages.create({
    model: NEXA_CONFIG.MODEL,
    max_tokens: 300,
    temperature: 0.7,
    system: PROMPT_CLOSER,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  return text.trim();
}

// ════════════════════════════════════════════════════════════════
// 🛡️ ACTION 3 : SECURITY
// ════════════════════════════════════════════════════════════════

async function nexaSecurity(clientData) {
  const quotaTotal = getQuotaForPlan(clientData.plan);

  const userPrompt = `
**Client** :
- ID : ${clientData.client_id}
- Forfait : ${clientData.plan}
- Messages utilisés aujourd'hui : ${clientData.messages_used} / ${quotaTotal}
- Comptes TikTok : ${clientData.tiktok_accounts?.length || 0}
- Taux de conversion (7j) : ${clientData.conversion_rate}%
- Signalements récents : ${clientData.reports_count}

Génère le rapport de monitoring JSON. Réponds UNIQUEMENT avec le JSON valide.
  `;

  const response = await client.messages.create({
    model: NEXA_CONFIG.MODEL,
    max_tokens: 800,
    temperature: 0.4,
    system: PROMPT_SECURITY,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Impossible de parser le rapport Security");
  return JSON.parse(match[0]);
}

// ════════════════════════════════════════════════════════════════
// 💬 ACTION 4 : CHAT (remplace chat.js)
// ════════════════════════════════════════════════════════════════

async function nexaChat({ userText, history, salesLink, quotaAvailable }) {
  if (!userText?.trim()) throw new Error("Message vide");
  if (quotaAvailable <= 0) throw new Error("Quota dépassé pour aujourd'hui");

  // Délai "lecture" simulé — UX naturelle
  await sleep(randomBetween(CHAT_CONFIG.preModelDelayMinMs, CHAT_CONFIG.preModelDelayMaxMs));

  const systemPrompt = salesLink
    ? PROMPT_CHAT + `\n\nLien de vente du client (à partager si pertinent) : ${salesLink}`
    : PROMPT_CHAT;

  const messages = [
    ...(history || []),
    { role: "user", content: userText },
  ];

  const response = await client.messages.create({
    model: NEXA_CONFIG.MODEL,
    max_tokens: 400,
    temperature: 0.7,
    system: systemPrompt,
    messages,
  });

  const reply = response.content[0]?.type === "text" ? response.content[0].text : "";
  if (!reply) throw new Error("Réponse vide de l'IA");

  const updatedHistory = trimHistory([
    ...(history || []),
    { role: "user", content: userText },
    { role: "assistant", content: reply },
  ]);

  return {
    success: true,
    message: reply.trim(),
    history: updatedHistory,
    quota_remaining: quotaAvailable - 1,
    timestamp: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════
// 🌐 NETLIFY HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  const allowedOrigin = process.env.SITE_URL || "";
  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Rate limiting IP
  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const action = body.action; // "scout" | "closer" | "security" | "chat"

  try {
    // ── SCOUT ───────────────────────────────────────────────────
    if (action === "scout") {
      const { tiktok_username, client_products } = body;
      if (!tiktok_username) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "tiktok_username required" }) };
      }
      const report = await nexaScout(tiktok_username, client_products);
      return { statusCode: 200, headers, body: JSON.stringify(report) };
    }

    // ── CLOSER ──────────────────────────────────────────────────
    if (action === "closer") {
      const { prospect_data, conversation_history, quota } = body;
      if (!prospect_data) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "prospect_data required" }) };
      }
      const msg = await nexaCloser(prospect_data, conversation_history, quota ?? 40);
      return { statusCode: 200, headers, body: JSON.stringify({ next_message: msg, timestamp: new Date().toISOString() }) };
    }

    // ── SECURITY ────────────────────────────────────────────────
    if (action === "security") {
      const { client_data } = body;
      if (!client_data) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "client_data required" }) };
      }
      const report = await nexaSecurity(client_data);
      return { statusCode: 200, headers, body: JSON.stringify(report) };
    }

    // ── CHAT ────────────────────────────────────────────────────
    if (action === "chat") {
      const { user_text, history, sales_link, quota_available, plan } = body;
      if (!user_text) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "user_text required" }) };
      }
      const quotaMax = getQuotaForPlan(plan || 'affiliation');
      const result = await nexaChat({
        userText: user_text,
        history: history || [],
        salesLink: sales_link || "",
        quotaAvailable: quota_available ?? quotaMax,
      });
      return { statusCode: result.success ? 200 : 400, headers, body: JSON.stringify(result) };
    }

    // ── ACTION INCONNUE ─────────────────────────────────────────
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Unknown action. Use: scout | closer | security | chat" }),
    };

  } catch (err) {
    console.error("🔥 NEXA Engine Error:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};
