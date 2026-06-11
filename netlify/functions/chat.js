/**
 * ═══════════════════════════════════════════════════════════════
 * 💬 CHAT.JS — Gestion des Conversations IA (Messages TikTok)
 * 
 * Utilise Claude pour générer des réponses naturelles
 * Gère l'historique + la file d'attente + typewriter effect
 * ═══════════════════════════════════════════════════════════════
 */

const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ════════════════════════════════════════════════════════════════
// 📦 CONFIG
// ════════════════════════════════════════════════════════════════

const CHAT_CONFIG = {
  preModelDelayMinMs: 800,
  preModelDelayMaxMs: 2200,
  maxHistoryMessages: 24,
  typingCharMinMs: 12,
  typingCharMaxMs: 28,
};

// ════════════════════════════════════════════════════════════════
// 🧠 SYSTEM PROMPT POUR LES CONVERSATIONS
// ════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `
Tu es NEXA, un assistant de conversation pour aider un créateur / business à convertir des DM.

OBJECTIF PRINCIPAL :
- Qualifier rapidement (besoin, contexte, objection).
- Avancer vers UNE action claire (clic lien / réponse / rendez-vous) sans insistance toxique.

CADRE :
- AIDA utile mais naturel : accroche courte, questions pertinentes, valeur, appel à l'action simple.
- Style : messages courts (style DM), 1 à 3 phrases max sauf si le client demande du détail.
- Miroir de ton : adapte-toi (plus cool ou plus pro) sans caricature.

RÈGLES DE CONVERSION (IMPORTANT) :
- Ne mens pas : pas de faux stock, pas de fausse urgence, pas de promesse chiffrée inventée.
- Ne présente pas le lien comme "la seule solution au monde". Présente-le comme "l'étape logique" quand ça match.
- Ne spamme pas le lien : au maximum 1 lien par réponse, et seulement si pertinent.
- Si le lien de vente est pertinent maintenant, tu peux le donner. Si ce n'est pas encore clair, pose 1 question ciblée.

SÛRETÉ :
- Pas d'insultes, pas de harcèlement, pas de contenu sexuel, pas d'incitation dangereuse.
- Si demande illégale / piratage / contournement plateforme : refuse poliment et propose une alternative légitime.

SORTIE :
- Réponds toujours en français.
- Réponds toujours avec au moins 1 phrase utile (jamais vide).
`;

// ════════════════════════════════════════════════════════════════
// 🔧 HELPER FUNCTIONS
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

// ════════════════════════════════════════════════════════════════
// 🤖 APPEL À CLAUDE
// ════════════════════════════════════════════════════════════════

async function callClaude({ userText, history, salesLink }) {
  try {
    const messages = [
      ...history,
      {
        role: "user",
        content: userText,
      },
    ];

    const systemPrompt = salesLink
      ? SYSTEM_PROMPT.replace("[SALES_LINK]", salesLink)
      : SYSTEM_PROMPT;

    const response = await client.messages.create({
      model: "claude-opus-4-1",
      max_tokens: 400,
      temperature: 0.7,
      system: systemPrompt,
      messages: messages,
    });

    const reply =
      response.content[0].type === "text" ? response.content[0].text : "";
    return reply.toString().trim();
  } catch (err) {
    console.error("❌ Claude API Error:", err);
    throw new Error("Erreur lors de la génération de la réponse");
  }
}

// ════════════════════════════════════════════════════════════════
// 📊 TRAITEMENT D'UN MESSAGE USER
// ════════════════════════════════════════════════════════════════

async function processUserMessage({
  userText,
  history = [],
  salesLink = "",
  quotaAvailable = 40,
}) {
  try {
    // Validation
    if (!userText || userText.trim().length === 0) {
      throw new Error("Message vide");
    }

    if (quotaAvailable <= 0) {
      throw new Error("Quota dépassé pour aujourd'hui");
    }

    // Délai "lecture"
    await sleep(
      randomBetween(
        CHAT_CONFIG.preModelDelayMinMs,
        CHAT_CONFIG.preModelDelayMaxMs
      )
    );

    // Appel Claude
    const aiReply = await callClaude({
      userText,
      history,
      salesLink,
    });

    if (!aiReply || aiReply.length === 0) {
      throw new Error("Réponse vide de l'IA");
    }

    // Mise à jour historique
    const updatedHistory = [
      ...history,
      { role: "user", content: userText },
      { role: "assistant", content: aiReply },
    ];

    const trimmedHistory = trimHistory(updatedHistory);

    return {
      success: true,
      message: aiReply,
      history: trimmedHistory,
      quota_remaining: quotaAvailable - 1,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("❌ Process Message Error:", err);
    return {
      success: false,
      error: err.message || "Erreur inconnue",
      timestamp: new Date().toISOString(),
    };
  }
}

// ════════════════════════════════════════════════════════════════
// 📤 NETLIFY HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const {
      user_text,
      history = [],
      sales_link = "",
      quota_available = 40,
    } = body;

    if (!user_text) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "user_text required" }),
      };
    }

    const result = await processUserMessage({
      userText: user_text,
      history,
      salesLink: sales_link,
      quotaAvailable: quota_available,
    });

    const statusCode = result.success ? 200 : 400;

    return {
      statusCode,
      headers,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("🔥 Chat Handler Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal Server Error",
        details: err.message,
      }),
    };
  }
};
