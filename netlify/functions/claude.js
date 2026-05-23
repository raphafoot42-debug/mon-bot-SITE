/**
 * NEXA CLAUDE API — Anthropic Integration
 * Handles AI chat messages with validation & error handling
 * Production-ready
 */

const crypto = require('crypto');

// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.7;

// ════════════════════════════════════════════════════════════════
// 🔐 VALIDATION
// ════════════════════════════════════════════════════════════════

/**
 * Valide l'input utilisateur
 */
function validateInput(userText, history) {
  // Vérifie message
  if (!userText || typeof userText !== 'string') {
    throw new Error('Message invalide: vide ou pas string');
  }

  const text = userText.trim();
  if (text.length < 1 || text.length > 5000) {
    throw new Error('Message doit être entre 1-5000 caractères');
  }

  // Vérifie history
  if (!Array.isArray(history)) {
    throw new Error('History doit être un array');
  }

  // Trim history (keep last 20 messages)
  if (history.length > 20) {
    history = history.slice(-20);
  }

  return { text, history };
}

// ════════════════════════════════════════════════════════════════
// 🏗️ MESSAGE BUILDER
// ════════════════════════════════════════════════════════════════

/**
 * Construit l'array de messages pour Claude
 */
function buildMessages(userText, history) {
  const messages = [];

  // Ajoute l'historique
  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: (msg.content || '').toString().slice(0, 5000),
      });
    }
  }

  // Ajoute le message courant
  messages.push({
    role: 'user',
    content: userText.slice(0, 5000),
  });

  return messages;
}

// ════════════════════════════════════════════════════════════════
// 🤖 CLAUDE API CALL
// ════════════════════════════════════════════════════════════════

/**
 * Appelle l'API Claude
 */
async function callClaudeAPI(messages, systemPrompt) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY not configured in Netlify env');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemPrompt,
      messages,
    }),
  });

  const data = await response.json();

  // Gère erreur
  if (!response.ok) {
    const err = new Error(
      data.error?.message || `Claude API error: ${response.status}`
    );
    err.status = response.status;
    err.claudeError = data.error;

    // Détecte rate limit
    if (response.status === 429) {
      err.rateLimit = true;
    }

    throw err;
  }

  // Extrait la réponse
  const text =
    data.content && data.content[0] && data.content[0].type === 'text'
      ? data.content[0].text
      : 'Pas de réponse valide de Claude';

  return {
    reply: text,
    usage: data.usage || {},
    model: data.model,
  };
}

// ════════════════════════════════════════════════════════════════
// 🌐 MAIN HANDLER
// ════════════════════════════════════════════════════════════════

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
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

  const { message, history = [], system_instructions = '' } = body;

  try {
    // Valide inputs
    const { text, history: validHistory } = validateInput(message, history);

    // Construit messages
    const messages = buildMessages(text, validHistory);

    // Appelle Claude
    const result = await callClaudeAPI(messages, system_instructions);

    // Retourne réponse
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        reply: result.reply,
        usage: result.usage,
        model: result.model,
      }),
    };
  } catch (err) {
    console.error('Claude handler error:', err);

    let statusCode = 500;
    let errorMsg = err.message || 'Internal server error';

    // Rate limit
    if (err.rateLimit) {
      statusCode = 429;
      errorMsg = 'Rate limited. Retry après 60s.';
    }
    // Auth error
    else if (err.status === 401) {
      statusCode = 401;
      errorMsg = 'API key invalid';
    }
    // Bad request
    else if (err.status === 400) {
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
