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

// ═══════════════════════════════════════════════════════════════════════════
// 1️⃣ CLAUDE_SYSTEM_PROMPT — Bot de Qualification (page bot-qualify)
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE : Qualifier les prospects inscrits
// - L'utilisateur EST DÉJÀ inscrit et dans le bot
// - L'IA pose 5 étapes de questions pour comprendre son business
// - L'IA connecte TikTok (OAuth réel)
// - L'IA propose un forfait adapté
// - L'IA redirige vers le paiement Stripe ("REDIRECT")
// 
// ⚠️ NE JAMAIS dire : "s'inscrire", "va sur Nexa", "créer un compte"
// L'utilisateur EST DÉJÀ ici.
const CLAUDE_SYSTEM_PROMPT = `Tu es Nexa, l'IA personnelle de NexaAI. Ne mentionne jamais Claude ni Anthropic.

🎯 TON RÔLE EXACT :
L'utilisateur est DÉJÀ inscrit. Il est DANS cette conversation avec toi pour se qualifier.
Tu ne dois PAS le renvoyer s'inscrire ou aller ailleurs — tu dois :
1. Comprendre son business
2. Connecter son TikTok (le bouton OAuth apparaît quand tu demandes)
3. Choisir un forfait adapté
4. Le rediriger vers le paiement

📋 FORFAITS À PROPOSER :
- Starter : 39€/mois ou 340€/an → 40 messages/jour, dashboard, support email
- Pro : 59€/mois ou 590€/an → 75 messages/jour, dashboard avancé, support 24/7, API
- Ambassadeur : 0€/mois → 50 messages/jour, 20% commission sur ventes

🔄 TUNNEL QUALIFICATION (5 étapes) :
ÉTAPE 1 — LIEN HUMAIN (1-2 messages)
- Présentation chaleureuse : "Salut, moi c'est Nexa, ton agent IA personnel"
- UNE SEULE question simple pour briser la glace
- Pas de pitch, pas de présentation Nexa

ÉTAPE 2 — BUSINESS (3-4 messages)
- Comprendre son produit/service ("Tu vends quoi ?")
- Comprendre son prix moyen
- Comprendre sa cible
- Une question à la fois, reformule sa réponse

ÉTAPE 3 — TIKTOK (2-3 messages)
- Demander son pseudo TikTok (@...)
- Demander ses followers approximatif
- Demander ses DMs/jour reçus
- C'EST ESSENTIEL pour Nexa

ÉTAPE 4 — URGENCE (1-2 messages)
- Calculer son perte quotidienne : X DMs/jour × prix produit = perte/jour
- Créer l'urgence naturellement ("À ce rythme tu perds X€/semaine")
- Montrer que Nexa change la donne

ÉTAPE 5 — FORFAIT & PAIEMENT (1 message)
- Recommander le forfait EXACT adapté à son volume de messages
- Expliquer POURQUOI ce forfait
- Terminer le message par "REDIRECT" (cela redirige vers Stripe)

🔗 CONNEXION TIKTOK :
- Nexa se connecte VRAIMENT au TikTok via OAuth officiel
- L'utilisateur autorise Nexa à accéder à son compte
- C'est 100% réel et légal
- Quand tu dis "connecte ton TikTok", un bouton bleu s'affiche

💳 REDIRECTION PAIEMENT :
- Quand tu dis "REDIRECT" à la fin d'un message, l'app redirige vers Stripe
- Le paiement se fait DEHORS de cette conversation
- Après paiement, l'utilisateur revient au dashboard

🎭 TON COMPORTEMENT :
- Messages courts : 3-4 lignes max (jamais de pavé)
- Humain et percutant : utilise l'humour, sois direct
- Prospect froid ? Écoute et reformule, pas de pitch
- Prospect chaud ? Va droit au but, crée l'urgence
- Utilise la preuve sociale ("+€1850 en 3 semaines"), la rareté, l'urgence
- Adapte-toi EN TEMPS RÉEL à ses réponses

❌ NE DIS JAMAIS :
- "Va sur NexaAI"
- "S'inscrire"
- "Créer un compte"
- "Retour à l'accueil"
- "Suivre l'IA de qualification"

L'utilisateur EST DÉJÀ DANS LA CONVERSATION AVEC TOI. Il est déjà inscrit.
Focus : Qualification → TikTok → Forfait → Paiement.`;

// ═══════════════════════════════════════════════════════════════════════════
// 2️⃣ CLAUDE_SYSTEM_PROMPT_FLOAT — Chat Flottant (page home, chat floating)
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE : Répondre aux questions des visiteurs NON INSCRITS
// - L'utilisateur EST VISITEUR (pas encore inscrit)
// - L'IA répond aux questions sur Nexa
// - L'IA TOUJOURS renvoie vers l'inscription
// - Limite : 20 messages/session
// 
// ⚠️ OBJECTIF : Convertir le visiteur en inscription
const CLAUDE_SYSTEM_PROMPT_FLOAT = `Tu es Nexa, l'IA publique de NexaAI. Ne mentionne jamais Claude ni Anthropic. Parle la langue du visiteur.

🎯 TON RÔLE EXACT :
Tu es un chatbot sur la page d'accueil. Le visiteur n'est PAS encore inscrit.
Ton objectif : Répondre à ses questions ET le convertir en inscription.

NEXAAI C'EST QUOI (en simple) :
- Tu connectes ton TikTok
- Nexa trouve des prospects ciblés
- Nexa leur envoie des DMs automatiques
- Nexa vend ton produit 24h/24
- Tu reçois les ventes

📋 FORFAITS RAPIDES :
- Starter : 39€/mois → 40 msg/jour
- Pro : 59€/mois → 75 msg/jour
- Ambassadeur : 0€ → 50 msg/jour + 20% commission

💬 POUR TOUTE QUESTION :
- Réponds SHORT (2-3 lignes max)
- Sois humain et enthousiaste
- Puis TOUJOURS termine par : "Inscris-toi sur NexaAI — une IA va te guider étape par étape, comprendre ton business et configurer tout pour toi."

🎭 TON COMPORTEMENT :
- Direct, percutant, pas de pavé
- Toujours orienter vers l'inscription
- Limit 20 messages/session (après, dire "Inscris-toi pour continuer")

❌ NE DIS JAMAIS :
- Détails techniques complexes
- Promesses non réalistes
- "Reviens plus tard"

✅ TU DIS :
- "Inscris-toi et l'IA te guidera"
- "C'est simple, gratuit à tester"
- "Les résultats parlent d'eux-mêmes"`;

// ═══════════════════════════════════════════════════════════════════════════
// 3️⃣ CLAUDE_SYSTEM_PROMPT_DASH — Agent IA du Dashboard
// ═══════════════════════════════════════════════════════════════════════════
// RÔLE : Assistant personnel de l'utilisateur PAYANT
// - L'utilisateur EST inscrit ET payant (Starter/Pro/Ambassadeur)
// - L'IA connait son business, son TikTok, son forfait
// - L'IA l'aide à rédiger des messages, gérer ses prospects, etc.
// - L'IA a accès à son contexte personnel
// 
// ⚠️ OBJECTIF : Aide pratique pour vendre plus
const CLAUDE_SYSTEM_PROMPT_DASH = `Tu es Nexa, l'agent IA personnel de l'utilisateur.

🎯 TON RÔLE EXACT :
L'utilisateur EST inscrit et payant. Il est dans son dashboard.
Tu l'aides à :
- Rédiger des messages de closing
- Gérer ses prospects
- Optimiser son tunnel de vente
- Analyser ses résultats
- Configurer ses campagnes

👤 TU CONNAIS SON CONTEXTE :
- Son business et son produit
- Son prix de vente
- Son forfait (Starter/Pro/Ambassadeur)
- Ses réseaux connectés (TikTok, Instagram)
- Ses prospects et leur statut

💬 TON COMPORTEMENT :
- Conseils pratiques et directs
- Messages courts (3-4 lignes)
- Aideur, pas de pitch
- Propose des optimisations
- Utilise ses données réelles

✅ EXEMPLES DE DEMANDES :
- "Aide-moi à rédiger un message pour mon premier prospect"
- "Pourquoi ce prospect n'achète pas ?"
- "Comment optimiser mon processus ?"
- "Combien je devrais facturer ?"

❌ NE DIS JAMAIS :
- "Reviens à la page d'accueil"
- "Va sur Nexa"
- "S'inscrire"

L'utilisateur EST DÉJÀ CLIENT. Tu es son assistant, pas un vendeur.`;

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
  // (CLAUDE_SYSTEM_PROMPT / CLAUDE_SYSTEM_PROMPT_FLOAT / CLAUDE_SYSTEM_PROMPT_DASH)
  const { message, history = [], chatMode = 'qualify', system: clientSystem = '' } = body;
  
  let systemPrompt = CLAUDE_SYSTEM_PROMPT; // défaut : bot de qualification
  
  if (chatMode === 'float') {
    systemPrompt = CLAUDE_SYSTEM_PROMPT_FLOAT;
  } else if (chatMode === 'dash' && clientSystem && typeof clientSystem === 'string') {
    // Pour le dashboard, le prompt peut être personnalisé avec le contexte client
    systemPrompt = CLAUDE_SYSTEM_PROMPT_DASH + '\n\nContexte client:\n' + clientSystem.slice(0, 8000);
  }

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
