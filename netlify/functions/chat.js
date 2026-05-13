/**
 * NEXA AI - Assistant de conversation (TikTok Edition)
 * - File d'attente (évite le chaos si le client spam)
 * - Historique (sinon le "10-20 messages" ne peut pas marcher)
 * - DOM safe (textContent)
 * - Gestion d'erreurs (pas de réponses vides)
 */

const NEXA_CONFIG = {
  // Délai AVANT l'appel modèle (simule lecture). Mets 0 en prod "site rapide".
  preModelDelayMinMs: 800,
  preModelDelayMaxMs: 2200,

  // Garde-fous historique (tokens / coût)
  maxHistoryMessages: 24, // nombre de messages total (user+assistant) conservés côté client

  // "Frappe" après réception (UX). Ce n'est PAS une attente artificielle de 3 minutes.
  typingCharMinMs: 12,
  typingCharMaxMs: 28,
};

// --- Prompt système (vente + qualité + conformité "soft") ---
const SYSTEM_PROMPT_TEMPLATE = `
Tu es NEXA, un assistant de conversation pour aider un créateur / business à convertir des DM.

Objectif principal :
- Qualifier rapidement (besoin, contexte, objection).
- Avancer vers UNE action claire (clic lien / réponse / rendez-vous) sans insistance toxique.

Cadre :
- AIDA utile mais naturel : accroche courte, questions pertinentes, valeur, appel à l'action simple.
- Style : messages courts (style DM), 1 à 3 phrases max sauf si le client demande du détail.
- Miroir de ton : adapte-toi (plus cool ou plus pro) sans caricature.

Règles de conversion (important) :
- Ne mens pas : pas de faux stock, pas de fausse urgence, pas de promesse chiffrée inventée.
- Ne présente pas le lien comme "la seule solution au monde". Présente-le comme "l'étape logique" quand ça match.
- Ne spamme pas le lien : au maximum 1 lien par réponse, et seulement si pertinent.
- Si le lien de vente est pertinent maintenant, tu peux le donner. Si ce n'est pas encore clair, pose 1 question ciblée.

Lien de destination (unique) :
- SALES_LINK = [SALES_LINK]
- Si Beacons / boutique : dis "catalogue" / "boutique".
- Si site pro : "page officielle".
- Si calendrier : "réserver un créneau".

Sûreté :
- Pas d'insultes, pas de harcèlement, pas de contenu sexuel, pas de incitation dangereuse.
- Si demande illégale / piratage / contournement plateforme : refuse poliment et propose une alternative légitime.

Sortie :
- Réponds toujours en français.
- Réponds toujours avec au moins 1 phrase utile (jamais vide).
`;

// --- État global conversation ---
const state = {
  history: [], // { role: 'user'|'assistant', content: string }
  queue: [],
  draining: false,
};

function buildSystemPrompt(salesLink) {
  const link = (salesLink || '').trim() || 'https://ton-site-de-vente';
  return SYSTEM_PROMPT_TEMPLATE.replace('[SALES_LINK]', link);
}

function trimHistory() {
  // garde les derniers N messages (pairs imparfaites ok)
  if (state.history.length > NEXA_CONFIG.maxHistoryMessages) {
    state.history = state.history.slice(-NEXA_CONFIG.maxHistoryMessages);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function setSendEnabled(enabled) {
  const btn = document.getElementById('send-btn');
  const input = document.getElementById('user-input');
  if (btn) btn.disabled = !enabled;
  if (input) input.disabled = !enabled;
}

function appendMessage(role, text) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}-message`;

  const p = document.createElement('p');
  p.textContent = (text ?? '').toString().trim() || "Je n'ai pas réussi à formuler une réponse. On reprend avec une question simple : c'est pour quel objectif pour toi ?";
  msgDiv.appendChild(p);

  chatMessages.appendChild(msgDiv);
  msgDiv.scrollIntoView({ behavior: 'smooth' });
}

function showTypingIndicator(label = 'Nexa écrit…') {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return null;

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.setAttribute('aria-live', 'polite');

  const span = document.createElement('span');
  span.textContent = label;
  indicator.appendChild(span);

  chatMessages.appendChild(indicator);
  indicator.scrollIntoView({ behavior: 'smooth' });
  return indicator;
}

function removeTypingIndicator(el) {
  if (el && el.remove) el.remove();
}

// "Frappe" progressive (UX). Optionnel : remplace par appendMessage direct si tu veux instantané.
async function typewriterAppendAi(fullText) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message ai-message';
  const p = document.createElement('p');
  msgDiv.appendChild(p);
  chatMessages.appendChild(msgDiv);

  const text = (fullText ?? '').toString();
  if (!text.trim()) {
    p.textContent = "Petit souci de formulation de mon côté. Tu veux qu'on parte sur ton besoin en une phrase ?";
    msgDiv.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  // effet frappe simple (par caractères) — évite les HTML
  let acc = '';
  for (const ch of text) {
    acc += ch;
    p.textContent = acc;
    msgDiv.scrollIntoView({ behavior: 'smooth' });
    await sleep(randomBetween(NEXA_CONFIG.typingCharMinMs, NEXA_CONFIG.typingCharMaxMs));
  }
}

async function callClaude({ userText, history, systemPrompt, context }) {
  const response = await fetch('/.netlify/functions/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: userText,
      history,
      system_instructions: systemPrompt,
      context: context || 'Prospection TikTok (assistant)',
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
    const errMsg = data?.error || data?.message || raw || `HTTP ${response.status}`;
    throw new Error(errMsg);
  }

  const reply = (data && (data.reply ?? data.text ?? data.output)) ?? '';
  return reply.toString().trim();
}

async function processOneUserMessage(userText) {
  const salesLink = localStorage.getItem('user_sales_link') || '';
  const systemPrompt = buildSystemPrompt(salesLink);

  // 1) petit délai "lecture" (optionnel)
  await sleep(randomBetween(NEXA_CONFIG.preModelDelayMinMs, NEXA_CONFIG.preModelDelayMaxMs));

  // 2) indicateur
  const typing = showTypingIndicator('Nexa réfléchit…');
  setSendEnabled(false);

  try {
    // historique AVANT d'ajouter le user courant : on envoie l'état précédent + message courant
    // (plus simple pour la function : elle concatène)
    const historySnapshot = [...state.history];

    const reply = await callClaude({
      userText,
      history: historySnapshot,
      systemPrompt,
      context: 'Conversation commerciale en DM',
    });

    // maj historique
    state.history.push({ role: 'user', content: userText });
    state.history.push({ role: 'assistant', content: reply || "OK, je reformule : tu veux surtout vendre, ou augmenter les messages ?" });
    trimHistory();

    removeTypingIndicator(typing);

    // 3) affichage AI
    await typewriterAppendAi(reply);
  } catch (e) {
    console.error('Erreur Nexa:', e);
    removeTypingIndicator(typing);

    appendMessage(
      'ai',
      "Désolé, j'ai un souci technique de mon côté. Réessaie dans 10 secondes. Si ça continue, dis-moi juste ton objectif (vendre / booker / infos) en une phrase."
    );
  } finally {
    setSendEnabled(true);
  }
}

async function drainQueue() {
  if (state.draining) return;
  state.draining = true;

  try {
    while (state.queue.length > 0) {
      const next = state.queue.shift();
      await processOneUserMessage(next);
    }
  } finally {
    state.draining = false;
  }
}

// API publique : branche ton bouton / enter sur ça
export async function sendChatMsg() {
  const input = document.getElementById('user-input');
  const message = (input?.value ?? '').trim();
  if (!message) return;

  // UI user immédiate
  appendMessage('user', message);
  input.value = '';

  // protection spam : enqueue
  state.queue.push(message);
  void drainQueue();
}

// Si tu n'as pas de bundler "module", enlève export et fais :
// window.sendChatMsg = sendChatMsg;
