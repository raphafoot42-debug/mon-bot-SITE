/**
 * NEXA UTILS — Fonctions utilitaires réutilisables
 * Sécurité, validation, localStorage, API calls, rate limiting
 */

// ════════════════════════════════════════════════════════════════
// 🔐 SÉCURITÉ - XSS Protection
// ════════════════════════════════════════════════════════════════

/**
 * Échappe les caractères HTML dangereux
 * Empêche les injections XSS
 */
const escHtml = (str) => {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/**
 * Sanitise une valeur (escape HTML + trim + troncate)
 */
const sanitize = (val, maxLen = 255) => {
  return escHtml((val || '').toString().trim()).slice(0, maxLen);
};

// ════════════════════════════════════════════════════════════════
// ✅ VALIDATION
// ════════════════════════════════════════════════════════════════

/**
 * Valide format email
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  return NEXA_PATTERNS.email.test(email.trim());
};

/**
 * Valide password (min 8 chars)
 */
const isValidPassword = (pwd) => {
  if (!pwd || typeof pwd !== 'string') return false;
  return NEXA_PATTERNS.password.test(pwd);
};

/**
 * Valide numéro téléphone
 */
const isValidPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return false;
  return NEXA_PATTERNS.phone.test(phone);
};

/**
 * Valide URL
 */
const isValidUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return NEXA_PATTERNS.url.test(url);
};

// ════════════════════════════════════════════════════════════════
// 💾 LOCALSTORAGE SAFE (avec error handling)
// ════════════════════════════════════════════════════════════════

const LS = {
  /**
   * Lit une clé du localStorage (retourne default si erreur)
   */
  get: (k, dflt = null) => {
    try {
      const val = localStorage.getItem(k);
      return val ? JSON.parse(val) : dflt;
    } catch (e) {
      console.warn(`LS read error for key "${k}":`, e);
      return dflt;
    }
  },

  /**
   * Écrit une clé au localStorage (silent fail)
   */
  set: (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      console.error(`LS write error for key "${k}":`, e);
    }
  },

  /**
   * Supprime une clé du localStorage
   */
  del: (k) => {
    try {
      localStorage.removeItem(k);
    } catch (e) {
      console.warn(`LS delete error for key "${k}":`, e);
    }
  },

  /**
   * Shortcuts pour user
   */
  user: () => LS.get('nexaai_user', null),
  setUser: (u) => LS.set('nexaai_user', u),
  clearUser: () => LS.del('nexaai_user'),

  /**
   * Shortcuts pour token
   */
  token: () => null,    // JWT non stocké en localStorage (sécurité XSS)
  setToken: () => {},   // no-op intentionnel
  clearToken: () => {}, // no-op intentionnel
};

// ════════════════════════════════════════════════════════════════
// 🔗 SUPABASE SAFE
// ════════════════════════════════════════════════════════════════

/**
 * Retourne le client Supabase (global window.sb)
 * Throw error si pas initialisé
 */
const getSb = () => {
  if (typeof window.sb === 'undefined' || !window.sb) {
    throw new Error(
      'Supabase not initialized. Check that config.js is loaded and env vars are set.'
    );
  }
  return window.sb;
};

// ════════════════════════════════════════════════════════════════
// 🔔 TOAST NOTIFICATIONS
// ════════════════════════════════════════════════════════════════

/**
 * Affiche une notification toast
 * Types: 'ok', 'err', 'info', 'warn'
 */
const toast = (msg, type = 'info', duration = 4000) => {
  const colors = {
    ok: '#39ff14',
    err: '#ff6b6b',
    info: '#888',
    warn: '#ff9800',
  };

  const bgColor = colors[type] || colors.info;

  // Crée l'élément s'il n'existe pas
  let el = document.getElementById('_nexa_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_nexa_toast';
    el.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 0.9rem;
      background: #222;
      border: 2px solid ${bgColor};
      color: ${bgColor};
      z-index: 99999;
      max-width: 90vw;
      text-align: center;
      opacity: 0;
      transition: opacity 0.3s;
      font-weight: 600;
    `;
    document.body.appendChild(el);
  }

  // Met à jour le texte et affiche
  el.textContent = msg;
  el.style.opacity = '1';

  // Fade out après duration
  if (duration > 0) {
    setTimeout(() => {
      el.style.opacity = '0';
    }, duration);
  }
};

// ════════════════════════════════════════════════════════════════
// 🛡️ RATE LIMITING
// ════════════════════════════════════════════════════════════════

/**
 * Classe pour gérer le rate limiting
 * Usage: const limiter = new RateLimiter(); limiter.check('login', 5, 300000)
 */
class RateLimiter {
  constructor() {
    this.attempts = {}; // { key: [timestamp1, timestamp2, ...] }
  }

  /**
   * Vérifie si la limite est respectée
   * @param {string} key - Clé unique (ex: 'login_user@email.com')
   * @param {number} limit - Nombre max de tentatives
   * @param {number} windowMs - Fenêtre de temps en ms
   * @throws Error si limite dépassée
   */
  check(key, limit = 5, windowMs = 300000) {
    const now = Date.now();

    // Nettoie les anciennes tentatives (hors fenêtre)
    this.attempts[key] = (this.attempts[key] || []).filter((t) => now - t < windowMs);

    // Vérifie limite
    if (this.attempts[key].length >= limit) {
      const resetTime = Math.ceil((this.attempts[key][0] + windowMs - now) / 1000);
      throw new Error(`Trop de tentatives. Réessaie dans ${resetTime}s.`);
    }

    // Enregistre la tentative
    this.attempts[key].push(now);
    return true;
  }

  /**
   * Réinitialise les tentatives pour une clé
   */
  reset(key) {
    delete this.attempts[key];
  }
}

// Instance globale
const rateLimiter = new RateLimiter();

// ════════════════════════════════════════════════════════════════
// 🌐 API CALLS AVEC TIMEOUT
// ════════════════════════════════════════════════════════════════

/**
 * Promise qui résout ou rejette après timeout
 */
async function withTimeout(promise, timeoutMs) {
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`Request timeout after ${timeoutMs}ms`)),
      timeoutMs
    )
  );
  return Promise.race([promise, timeout]);
}

/**
 * API call avec validation, timeout, error handling
 * @param {string} url - URL de la requête
 * @param {object} options - Options fetch
 * @param {number} timeoutMs - Timeout en ms
 * @returns {Promise<object>} Réponse JSON
 */
async function apiCall(url, options = {}, timeoutMs = NEXA_TIMEOUTS.api) {
  try {
    // Vérifie connection
    if (!navigator.onLine) {
      throw new Error(NEXA_MESSAGES.offline);
    }

    // Requête avec timeout
    const response = await withTimeout(
      fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
      }),
      timeoutMs
    );

    // Parse réponse
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { _raw: text };
    }

    // Gère erreur HTTP
    if (!response.ok) {
      const err = new Error(
        data?.error || data?.message || text || `HTTP ${response.status}`
      );
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
    console.error('API call failed:', { url, error: err.message });
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════
// 🌐 NETWORK CHECK
// ════════════════════════════════════════════════════════════════

/**
 * Vérifie la connexion internet
 * @throws Error si offline
 */
const isOnline = () => {
  if (!navigator.onLine) {
    throw new Error(NEXA_MESSAGES.offline);
  }
  return true;
};

// ════════════════════════════════════════════════════════════════
// 🔑 TOKEN GENERATION
// ════════════════════════════════════════════════════════════════

/**
 * Génère un token aléatoire sécurisé
 * @param {number} length - Longueur du token
 * @returns {string} Token hex
 */
const genToken = (length = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

// ════════════════════════════════════════════════════════════════
// ⏱️ UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Sleep/delay en ms
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Random entre min et max
 */
const randomBetween = (min, max) => min + Math.random() * (max - min);

/**
 * Formate une date (YYYY-MM-DD)
 */
const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  return d.toISOString().split('T')[0];
};

/**
 * Formate une devise (EUR)
 */
const formatPrice = (price) => {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(price || 0);
};

// ════════════════════════════════════════════════════════════════
// 📤 EXPORT (pour tests/bundlers)
// ════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escHtml,
    sanitize,
    isValidEmail,
    isValidPassword,
    isValidPhone,
    isValidUrl,
    LS,
    getSb,
    toast,
    RateLimiter,
    rateLimiter,
    withTimeout,
    apiCall,
    isOnline,
    genToken,
    sleep,
    randomBetween,
    formatDate,
    formatPrice,
  };
}
