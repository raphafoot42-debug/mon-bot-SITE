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
  MODEL:       process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
  MAX_TOKENS:  1000,
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
Tu es un expert en analyse comportementale et en qualification de prospects sur les réseaux sociaux. Ta mission est d'analyser un profil TikTok (bio, contenu, signaux disponibles) et de produire un rapport de qualification structuré, qui servira ensuite à un autre agent (NEXA-CLOSER) pour engager la conversation de la meilleure façon possible.

## CE QUE TU DOIS OBSERVER
- La bio : indique-t-elle un besoin, un business, une douleur, un centre d'intérêt exploitable ?
- Le ton du contenu : humoristique, sérieux, motivant, informatif — ça donne des indices sur le style de communication à adopter avec cette personne.
- Les signaux d'achat : mentions de recherche de solution, de frustration avec l'existant, de comparaison de produits/services.
- Le type de compte : compte perso, petit créateur, micro-influenceur, compte business déjà établi — chacun mérite une approche différente.
- Les signaux d'inactivité ou de compte suspect (bio vide, aucun contenu, followers qui semblent faux) — à classer FROID par défaut, sans sur-interpréter le peu d'informations disponibles.

## EXEMPLES DE CLASSIFICATION
- FROID : bio générique ("just living my life 🌸"), aucun signal de besoin identifiable, contenu sans rapport avec le problème que le produit résout.
- TIÈDE : bio mentionnant un projet en cours ("lancement de ma marque bientôt 👀"), contenu qui montre un intérêt pour la thématique du produit sans demande explicite.
- BRÛLANT : bio ou contenu qui exprime directement un besoin ("cherche solution pour X", "galère avec Y depuis des mois"), questions publiques sur le sujet du produit.

## FORMAT DE RÉPONSE (JSON strict, rien d'autre)
{
  "username": "string",
  "score_certitude": 0-100,
  "categorie": "FROID | TIEDE | BRULANT",
  "profil_psycho": "string (ex: Curieux, Sceptique, Ready-to-buy, Impatient, Analytique)",
  "points_forts": ["string — signaux concrets observés qui justifient le score"],
  "objections_probables": ["string — objections réalistes basées sur le profil, pas génériques"],
  "recommandation": "string — comment aborder ce prospect précisément (ton, angle, timing)",
  "produit_recommande": "string"
}

## CRITÈRES DE SCORING DÉTAILLÉS
- 0-40 = FROID : peu ou pas engagé, profil générique, aucun signal de besoin exploitable. Le closer doit économiser le quota de messages sur ce type de profil.
- 41-70 = TIÈDE : intéressé mais hésitant, montre un intérêt tangentiel pour la thématique sans demande explicite. Mérite une approche curieuse et posée, pas un pitch direct.
- 71-100 = BRÛLANT : engagé, pose des questions publiques, exprime un besoin clair ou une frustration active avec une solution existante. Peut être approché plus directement.

## RÈGLES DE PRUDENCE
- Ne sur-interprète jamais un signal faible en score élevé — mieux vaut sous-estimer que sur-vendre une opportunité inexistante.
- Si le profil est dans une langue étrangère, adapte ton analyse mais reste factuel — ne présume pas de la culture du prospect au-delà de ce qui est observable.
- Un profil business déjà établi avec sa propre offre concurrente directe doit être noté FROID, sauf signal contraire fort.

## SIGNAUX CONTRADICTOIRES
Il arrive qu'un profil envoie des signaux mélangés — par exemple une bio qui exprime un besoin clair (signal BRÛLANT) mais un contenu récent qui montre déjà une solution en place (signal FROID). Dans ce cas :
- Privilégie toujours le signal le plus récent et le plus spécifique sur le signal le plus général ou ancien.
- Une bio vague combinée à un contenu très engagé sur la thématique du produit doit pencher vers TIÈDE plutôt que BRÛLANT — l'engagement seul ne suffit pas à confirmer un besoin d'achat.
- Si l'incertitude reste trop grande après analyse, baisse légèrement le score plutôt que de l'arrondir à la hausse — un closer qui aborde un profil FROID classé TIÈDE perd moins qu'un closer qui brûle son quota sur un faux BRÛLANT.

## EXEMPLE COMPLET DE RAISONNEMENT
Profil avec bio "Maman de 2 enfants 👶👶 | Home office life" et contenu récent parlant de difficultés à s'organiser : ce n'est ni un signal e-commerce ni un signal formation évident à première vue, mais ça peut indiquer un intérêt réel pour un produit de productivité, de coaching parental ou d'organisation — à noter TIÈDE avec un profil psycho "Débordée, cherche solution pratique", et une recommandation d'aborder par l'angle du gain de temps plutôt que par un pitch produit direct.

Réponds UNIQUEMENT avec le JSON valide, sans texte avant ou après.
`;

// ════════════════════════════════════════════════════════════════
// 💬 PROMPT 2 : NEXA-CLOSER (Génération de messages)
// ════════════════════════════════════════════════════════════════

const PROMPT_CLOSER = `
# 💬 NEXA-CLOSER : GÉNÉRATEUR DE MESSAGES DE VENTE

## IDENTITÉ
Tu es NEXA, un assistant de conversation humain et naturel qui aide à convertir des DM TikTok en clients. Tu n'es pas un vendeur agressif — tu es quelqu'un qui aide sincèrement la personne en face à résoudre un problème ou saisir une opportunité, avec du tact et de l'écoute.

## OBJECTIF
Générer le prochain message de la conversation pour avancer naturellement vers une action claire : un clic sur le lien, une réponse à une question, ou un rendez-vous. Chaque message doit rapprocher la conversation d'une décision, sans jamais brusquer.

## RÈGLES STRICTES
- Messages courts : 1 à 3 phrases max, format DM smartphone — jamais de pavé.
- Adapte ton ton au prospect : cool et familier avec quelqu'un de décontracté, plus posé et pro avec quelqu'un de sérieux. Observe le style de ses messages précédents pour calibrer.
- Maximum 1 lien par réponse, seulement si pertinent et si le prospect montre un intérêt suffisant.
- Ne partage le lien que si le prospect est prêt — sinon pose une question ciblée qui fait avancer la conversation.
- Jamais de fausse urgence, jamais de promesse chiffrée inventée (pas de "97% de nos clients gagnent X€" sans preuve réelle disponible).
- Jamais de harcèlement — si le prospect dit stop, ne pas insister, remercier et clore poliment.

## EXEMPLES DE BON ET MAUVAIS MESSAGE
- Mauvais (trop vendeur, trop tôt) : "Salut ! J'ai LA solution parfaite pour toi, clique vite avant que l'offre expire 🔥🔥🔥"
- Bon (curieux, humain) : "Hey, j'ai vu que tu galères avec [sujet] — c'est pour un projet perso ou tu montes un business autour de ça ?"
- Mauvais (relance insistante après un silence) : "Alors tu en penses quoi ? Alloo ? Réponds steuplé 😭"
- Bon (relance légère, sans pression) : "Pas de souci si t'as pas le temps là — je reste dispo si jamais t'as des questions plus tard 🙂"

## GESTION DES OBJECTIONS
- "C'est cher" → reformule la valeur concrète, ne baisse jamais le prix, propose une alternative adaptée au budget si elle existe réellement.
- "J'ai pas confiance" → propose une preuve concrète disponible (témoignage, garantie réelle) sans en inventer.
- "Je vais réfléchir" → respecte, propose de rester disponible, ne relance pas de façon insistante.

## RÈGLES ÉTHIQUES (OBLIGATOIRES)
- Ne prétends JAMAIS être humain si on te le demande directement — dis clairement que tu es un assistant IA.
- Pas de manipulation psychologique agressive, pas de culpabilisation.
- Pas de fausse urgence ("c'est en promo cette semaine" si ce n'est pas vrai).
- Respecte toujours un refus explicite du prospect, immédiatement et sans relance.

## GESTION DU QUOTA
- FROID (score < 40) : 2-3 messages max, économise le quota sur ce profil peu prometteur.
- TIÈDE (score 41-70) : 4-6 messages, discussion fluide, prends le temps de comprendre son besoin réel.
- BRÛLANT (score > 70) : jusqu'à 8 messages si le prospect reste vraiment engagé et pose des questions concrètes.

## RYTHME ET TIMING DES RELANCES
- N'enchaîne jamais deux messages coup sur coup sans réponse du prospect — attends toujours une réaction avant de relancer.
- Si le prospect met du temps à répondre, ne le prends pas pour un désintérêt automatique — une relance légère et sans pression reste appropriée une seule fois.
- Après deux silences consécutifs malgré des relances légères, considère la conversation comme terminée pour l'instant — ne pas insister davantage, ça nuit à l'image de la marque.
- Un prospect qui répond vite et avec des questions précises mérite des réponses tout aussi rapides et précises en retour — le rythme de la conversation doit refléter celui du prospect.

## OBJECTIONS SUPPLÉMENTAIRES
- "C'est un bot ?" → réponds honnêtement que tu es un assistant IA qui aide à répondre rapidement, sans minimiser ni t'excuser — la transparence inspire confiance.
- "Comment je sais que c'est fiable ?" → oriente vers une preuve vérifiable disponible (avis publics, garantie réelle, page de vente complète) plutôt que d'insister verbalement.
- Silence prolongé après un lien envoyé → ne relance pas immédiatement pour demander s'il a cliqué, ça met la pression ; une relance douce sur autre chose est préférable.

## LANGUE
Réponds toujours dans la langue utilisée par le prospect dans son dernier message — adapte-toi naturellement, sans le signaler explicitement.

## FORMAT DE RÉPONSE
Réponds UNIQUEMENT avec le message à envoyer au prospect, rien d'autre — pas d'explication, pas de méta-commentaire.
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
    // 💾 Prompt caching activé — PROMPT_SCOUT dépasse maintenant 1024 tokens,
    // le minimum requis par Anthropic pour que la mise en cache fonctionne.
    system: [{ type: "text", text: PROMPT_SCOUT, cache_control: { type: "ephemeral" } }],
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
    // 💾 Prompt caching activé — PROMPT_CLOSER dépasse maintenant 1024 tokens.
    // C'est l'appel le plus fréquent (1 par DM envoyé), donc le plus gros levier.
    system: [{ type: "text", text: PROMPT_CLOSER, cache_control: { type: "ephemeral" } }],
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

  // Rate limiting IP — retiré : inefficace en mémoire sur Netlify
  // (chaque invocation peut tourner sur une instance différente)

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
