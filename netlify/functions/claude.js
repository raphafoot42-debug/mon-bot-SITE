/**
 * NEXA CLAUDE API — Anthropic Integration
 * Handles AI chat messages with validation & error handling
 * Production-ready
 */

// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

// ════════════════════════════════════════════════════════════════
// 📝 SYSTEM PROMPTS (en dur — plus en variable d'env Netlify)
// Déplacés hors de process.env pour libérer de l'espace sous la
// limite de 4KB imposée par AWS Lambda sur les env vars.
// Ce ne sont pas des secrets, ils peuvent être en dur dans le code.
// ════════════════════════════════════════════════════════════════

const CLAUDE_SYSTEM_PROMPT = `Tu es Nexa, l'IA de NexaAI. Ne mentionne jamais Claude ni Anthropic. Détecte et parle la langue du prospect (FR/EN/ES/autre).

FORFAITS: Starter 39€/mois ou 340€/an, 40 msg/jour, dashboard, support email. Pro 59€/mois ou 590€/an, 75 msg/jour, dashboard avancé, support 24/7, API. Ambassadeur 0€, 50 msg/jour, 20% commission par vente via ton lien.

LIMITES CHAT: jour 1 max 50 messages puis renvoie vers inscription. Jours suivants max 5/jour puis renvoie vers contact@nexaai.fr. Spam: ne réponds plus, renvoie vers contact@nexaai.fr.

TUNNEL VENTE 5 ETAPES (une question à la fois, jamais de pavé): 1. Lien humain: présentation chaleureuse, une question pour briser la glace, pas de pitch. 2. Business: identifie e-commerce (produit, plateforme, panier moyen, objectif CA), formation/coaching (sujet, format, prix, élèves, objectif revenus), ou SaaS (problème résolu, pricing, MRR actuel, objectif MRR). 3. TikTok: pseudo, niche, followers approx, DMs reçus/jour sans réponse. 4. Urgence: calcule DMs/jour x prix = perte hebdo, sans mentir, traite objections calmement. 5. Close: 0-40 DMs/jour=Starter, 41-75=Pro, pas de budget=Ambassadeur. Explique pourquoi ce forfait précisément puis écris "REDIRECT" en fin de message.

SI PERDU (comment ça marche/par où commencer/connecter TikTok): réponds "Inscris-toi sur NexaAI — une IA va te guider étape par étape, comprendre ton business, choisir ton forfait et connecter ton TikTok automatiquement." Renvoie toujours vers inscription, pas d'instructions complexes.

TIKTOK: NexaAI connecte vraiment le compte TikTok via OAuth officiel, trouve des profils ciblés, envoie des DMs automatiques, répond pour closer. 100% réel et opérationnel. Ne dis jamais que c'est impossible.

COMPORTEMENT: messages courts 3-4 lignes max, humain et percutant. Froid: écoute et reformule sans pitcher. Chaud: va droit au but. Utilise preuve sociale, rareté, urgence. Adapte-toi en temps réel, jamais de script rigide.

PROSPECTION (DM pour un client): max 6-7 messages si prospect froid sans intérêt, sinon arrête. Prospect chaud (questions, intérêt réel): continue sans limite. Avant chaque conversation analyse le profil client (business, produit, prix, cible) pour maximiser conversion.`;

const CLAUDE_SYSTEM_PROMPT_FLOAT = `Tu es Nexa, IA de NexaAI. Jamais Claude/Anthropic. Parle la langue du visiteur.

NEXAAI: connecte ton TikTok, trouve des prospects ciblés, leur envoie des DMs et vend ton produit a ta place automatiquement.

Pour toute question (comment ca marche, forfaits, comment commencer): reponds court puis dis "Inscris-toi sur NexaAI, une IA te guidera et configurera tout pour toi."

COMPORTEMENT: 2-3 lignes max, humain, direct. Toujours renvoyer vers inscription. Limite 20 messages/session.`;

// ════════════════════════════════════════════════════════════════
// 🛡️ RATE LIMITING (par IP — en mémoire)
// ⚠️ NOTE : fonctionne sur instance unique (dev/staging).
// En production multi-instance Netlify, utiliser Upstash Redis
// ou le rate limiting natif Netlify pour une protection réelle.
// Limite : 30 requêtes / minute par IP
// ════════════════════════════════════════════════════════════════
const _ipWindows = {};
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

function checkIpRate(ip) {
  const now = Date.now();
  _ipWindows[ip] = (_ipWindows[ip] || []).filter(t => now - t < RATE_WINDOW_MS);
  if (_ipWindows[ip].length >= RATE_LIMIT) {
    const err = new Error('Rate limit dépassé');
    err.rateLimit = true;
    throw err;
  }
  _ipWindows[ip].push(now);
}

// ════════════════════════════════════════════════════════════════
// 🔐 VALIDATION
// ════════════════════════════════════════════════════════════════

/**
 * Valide l'input utilisateur
 */
function validateInput(userText, history) {
  if (!userText || typeof userText !== 'string') {
    throw new Error('Message invalide: vide ou pas string');
  }

  const text = userText.trim();
  if (text.length < 1 || text.length > 5000) {
    throw new Error('Message doit être entre 1-5000 caractères');
  }

  if (!Array.isArray(history)) {
    throw new Error('History doit être un array');
  }

  // Valider chaque message en profondeur — content non-string peut crasher l'API
  const validatedHistory = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
    }));

  // Garder les 20 derniers messages
  let trimmedHistory = validatedHistory.length > 20
    ? validatedHistory.slice(-20)
    : validatedHistory;

  // Limite totale de l'historique pour éviter 20 × 5000 = 100 000 chars vers l'API
  let totalChars = trimmedHistory.reduce((s, m) => s + m.content.length, 0);
  while (trimmedHistory.length > 1 && totalChars > 80000) {
    const removed = trimmedHistory.shift();
    totalChars -= removed.content.length;
  }

  return { text, history: trimmedHistory };
}

// ════════════════════════════════════════════════════════════════
// 🏗️ MESSAGE BUILDER
// ════════════════════════════════════════════════════════════════

function buildMessages(userText, history) {
  const messages = [];

  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: (msg.content || '').toString().slice(0, 5000),
      });
    }
  }

  messages.push({
    role: 'user',
    content: userText.slice(0, 5000),
  });

  return messages;
}

// ════════════════════════════════════════════════════════════════
// 🤖 CLAUDE API CALL
// ════════════════════════════════════════════════════════════════

async function callClaudeAPI(messages, systemPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured in Netlify env');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000); // 25s max (lambda Netlify = 26s)
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json();

  if (!response.ok) {
    const err = new Error(
      data.error?.message || `Claude API error: ${response.status}`
    );
    err.status = response.status;
    err.claudeError = data.error;
    if (response.status === 429) err.rateLimit = true;
    throw err;
  }

  const text =
    data.content && data.content[0] && data.content[0].type === 'text'
      ? data.content[0].text
      : 'Pas de réponse valide de Claude';

  return { reply: text };
}

// ════════════════════════════════════════════════════════════════
// 🔐 AUTH ADMIN
// Vérifie le mot de passe admin côté serveur uniquement.
// ════════════════════════════════════════════════════════════════

function checkAdminAuth(body) {
  if (!body.adminAuth) return false;
  const adminPwd = process.env.ADMIN_PASSWORD;
  if (!adminPwd) return false;
  const a = Buffer.from(body.password || ""); const b = Buffer.from(adminPwd); return a.length === b.length && require("crypto").timingSafeEqual(a, b);
}

// ════════════════════════════════════════════════════════════════
// 🌐 MAIN HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async function (event) {
  // CORS : restreindre à l'origine du site — jamais '*' en production
  const allowedOrigin = process.env.SITE_URL || '';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Accepte seulement POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  // ── Rate limiting IP ────────────────────────────────────────
  // Récupère l'IP réelle (header Netlify CDN)
  const ip =
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    event.requestContext?.identity?.sourceIp ||
    'unknown';

  try {
    checkIpRate(ip);
  } catch (err) {
    if (err.rateLimit) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'Rate limited. Retry après 60s.' }),
      };
    }
    throw err;
  }

  // ── Auth admin (vérification mot de passe panel admin) ──────
  if (body.adminAuth) {
    const ok = checkAdminAuth(body);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok }),
    };
  }

  // ── Extraction body ─────────────────────────────────────────
  // ⚠️ SÉCURITÉ : `system_instructions` ignoré depuis le client.
  // Le system prompt vient UNIQUEMENT des constantes en dur ci-dessus
  // (CLAUDE_SYSTEM_PROMPT / CLAUDE_SYSTEM_PROMPT_FLOAT), plus de process.env.
  const { message, history = [], chatMode = 'qualify', system: clientSystem = '' } = body;
  const basePrompt = chatMode === 'float'
    ? (CLAUDE_SYSTEM_PROMPT_FLOAT || CLAUDE_SYSTEM_PROMPT)
    : CLAUDE_SYSTEM_PROMPT;
  const systemPrompt = (chatMode === 'dash' && clientSystem && typeof clientSystem === 'string')
    ? clientSystem.slice(0, 8000)
    : basePrompt;

  try {
    const { text, history: validHistory } = validateInput(message, history);
    const messages = buildMessages(text, validHistory);
    const result = await callClaudeAPI(messages, systemPrompt);

    // ⚠️ usage et model non retournés — évite de fournir des infos
    // utiles pour calibrer des attaques ou de l'amplification de coûts.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: result.reply }),
    };
  } catch (err) {
    console.error('Claude handler error:', err);

    let statusCode = 500;
    let errorMsg = 'Internal server error';

    if (err.rateLimit) {
      statusCode = 429;
      errorMsg = 'Rate limited. Retry après 60s.';
    } else if (err.status === 401) {
      statusCode = 401;
      errorMsg = 'API key invalid';
    } else if (err.status === 400) {
      statusCode = 400;
      errorMsg = err.message;
    }

    return {
      statusCode,
      headers,
      body: JSON.stringify({ error: errorMsg }),
    };
  }
};
