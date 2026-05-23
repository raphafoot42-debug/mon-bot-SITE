/**
 * NEXA CHAT — Message Handler & Queue Manager
 * Production-ready avec validation, queue, error handling
 */

// ════════════════════════════════════════════════════════════════
// 📝 SYSTEM PROMPT
// ════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_TEMPLATE = `
Tu es NEXA, un assistant de conversion pour créateurs et entrepreneurs.

Objectif principal :
- Qualifier rapidement le prospect (besoin, contexte, objection)
- Avancer vers UNE action claire sans pression toxique

Style :
- Messages courts (style DM), 1-3 phrases max
- Adapte-toi au ton du prospect (cool ou pro)
- AIDA naturel : accroche, questions, valeur, CTA

Règles :
- Ne mens jamais (pas de faux stock, fausse urgence, promesses chiffrées)
- Présente le lien comme "l'étape logique suivante"
- Max 1 lien par réponse, seulement si pertinent
- Pas d'insultes, harcèlement, contenu sexuel ou illégal

Lien destination : [SALES_LINK]

Réponds TOUJOURS en français avec au moins 1 phrase utile (jamais vide).
`;

// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const NEXA_CONFIG = {
  preModelDelayMinMs: 500,
  preModelDelayMaxMs: 1500,
  maxHistoryMessages: 10,
  typingCharMinMs: 10,
  typingCharMaxMs: 20,
  maxMessageLength: 5000,
};

// ════════════════════════════════════════════════════════════════
// 🔄 STATE
// ════════════════════════════════════════════════════════════════

const state = {
  history: [],
  queue: [],
  draining: false,
};

// ════════════════════════════════════════════════════════════════
// ✅ VALIDATION
// ════════════════════════════════════════════════════════════════

/**
 * Valide un message utilisateur
 */
function validateMessage(userText) {
  if (!userText || typeof userText !== 'string') {
    throw new Error('Message must be non-empty string');
  }

  const text = userText.trim();
  if (text.length < 1 || text.length > NEXA_CONFIG.maxMessageLength) {
    throw new Error(
      `Message must be 1-${NEXA_CONFIG.maxMessageLength} characters`
    );
  }

  return text;
}

// ════════════════════════════════════════════════════════════════
// 🤖 BUILD SYSTEM PROMPT
// ════════════════════════════════════════════════════════════════

/**
 * Construit le system prompt avec le lien de vente
 */
function buildSystemPrompt(salesLink) {
  const link = (salesLink || '').trim() || 'https://ton-site-de-vente';
  return SYSTEM_PROMPT_TEMPLATE.replace('[SALES_LINK]', link);
}

// ════════════════════════════════════════════════════════════════
// 📚 HISTORY MANAGEMENT
// ════════════════════════════════════════════════════════════════

/**
 * Trim l'historique (garde max 10 messages)
 */
function trimHistory() {
  if (state.history.length > NEXA_CONFIG.maxHistoryMessages) {
    state.history = state.history.slice(-NEXA_CONFIG.maxHistoryMessages);
  }
}

// ════════════════════════════════════════════════════════════════
// ⏱️ UTILS
// ════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// ════════════════════════════════════════════════════════════════
// 🎨 DOM MANIPULATION
// ════════════════════════════════════════════════════════════════

function setSendEnabled(enabled) {
  const btn = document.getElementById('send-btn');
  const input = document.getElementById('user-input');
  if (btn) btn.disabled = !enabled;
  if (input) input.disabled = !enabled;
}

function appendMessage(role, text) {
  const chatMsgs = document.getElementById('chat-messages');
  if (!chatMsgs) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}-message`;

  const p = document.createElement('p');
  p.textContent =
    (text ?? '').toString().trim() ||
    "Désolé, j'ai pas pu générer une réponse. Peux-tu reformuler ?";
  msgDiv.appendChild(p);

  chatMsgs.appendChild(msgDiv);
  msgDiv.scrollIntoView({ behavior: 'smooth' });
}

function showTypingIndicator(label = 'Nexa écrit…') {
  const chatMsgs = document.getElementById('chat-messages');
  if (!chatMsgs) return null;

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.setAttribute('aria-live', 'polite');

  const span = document.createElement('span');
  span.textContent = label;
  indicator.appendChild(span);

  chatMsgs.appendChild(indicator);
  indicator.scrollIntoView({ behavior: 'smooth' });
  return indicator;
}

function removeTypingIndicator(el) {
  if (el && el.remove) el.remove();
}

// ════════════════════════════════════════════════════════════════
// ✍️ TYPEWRITER EFFECT
// ════════════════════════════════════════════════════════════════

/**
 * Affiche la réponse AI avec effet de "frappe"
 */
async function typewriterAppendAi(fullText) {
  const chatMsgs = document.getElementById('chat-messages');
  if (!chatMsgs) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'message ai-message';
  const p = document.createElement('p');
  msgDiv.appendChild(p);
  chatMsgs.appendChild(msgDiv);

  const text = (fullText ?? '').toString();
  if (!text.trim()) {
    p.textContent =
      'Petit souci technique. Peux-tu recommencer ?';
    msgDiv.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  // Frappe character-by-character
  let acc = '';
  for (const ch of text) {
    acc += ch;
    p.textContent = acc;
    msgDiv.scrollIntoView({ behavior: 'smooth' });
    await sleep(randomBetween(NEXA_CONFIG.typingCharMinMs, NEXA_CONFIG.typingCharMaxMs));
  }
}

// ════════════════════════════════════════════════════════════════
// 🤖 CALL CLAUDE FUNCTION
// ════════════════════════════════════════════════════════════════

/**
 * Appelle la function Claude
 */
async function callClaude({
  userText,
  history,
  systemPrompt,
  context,
}) {
  const response = await fetch('/.netlify/functions/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: userText,
      history,
      system_instructions: systemPrompt,
      context: context || 'Chat commercial',
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

// ════════════════════════════════════════════════════════════════
// 💬 PROCESS MESSAGE
// ════════════════════════════════════════════════════════════════

/**
 * Traite un message (avec delay, API call, etc)
 */
async function processOneUserMessage(userText) {
  const salesLink = localStorage.getItem('user_sales_link') || '';
  const systemPrompt = buildSystemPrompt(salesLink);

  // Delay optionnel (simulation "reading time")
  await sleep(randomBetween(NEXA_CONFIG.preModelDelayMinMs, NEXA_CONFIG.preModelDelayMaxMs));

  const typing = showTypingIndicator('Nexa réfléchit…');
  setSendEnabled(false);

  try {
    const historySnapshot = [...state.history];

    const reply = await callClaude({
      userText,
      history: historySnapshot,
      systemPrompt,
      context: 'Conversation commerciale',
    });

    // Update history
    state.history.push({ role: 'user', content: userText });
    state.history.push({
      role: 'assistant',
      content: reply || 'Peux-tu clarifier ton besoin ?',
    });
    trimHistory();

    removeTypingIndicator(typing);

    // Display
    await typewriterAppendAi(reply);
  } catch (e) {
    console.error('Chat error:', e);
    removeTypingIndicator(typing);

    appendMessage(
      'ai',
      'Désolé, erreur technique. Réessaie dans 10s. Sinon, dis-moi ton objectif (vendre/booker/infos) en une phrase.'
    );
  } finally {
    setSendEnabled(true);
  }
}

// ════════════════════════════════════════════════════════════════
// 📤 QUEUE MANAGEMENT
// ════════════════════════════════════════════════════════════════

/**
 * Vide la file d'attente des messages
 */
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

// ════════════════════════════════════════════════════════════════
// 🎯 PUBLIC API
// ════════════════════════════════════════════════════════════════

/**
 * Envoie un message (appelle depuis HTML)
 */
async function sendChatMsg() {
  const input = document.getElementById('user-input');
  const message = (input?.value ?? '').trim();
  if (!message) return;

  try {
    validateMessage(message);
  } catch (err) {
    appendMessage('error', err.message);
    return;
  }

  // Affiche user message
  appendMessage('user', message);
  input.value = '';

  // Enqueue
  state.queue.push(message);
  void drainQueue();
}

// ════════════════════════════════════════════════════════════════
// 📤 EXPORT
// ════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  window.sendChatMsg = sendChatMsg;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sendChatMsg,
    buildSystemPrompt,
    trimHistory,
  };
}
