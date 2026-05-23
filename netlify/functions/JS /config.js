/**
 * NEXA CONFIG — Configuration centralisée
 * Patterns, messages, timeouts, rate limits, init Supabase
 */

// ════════════════════════════════════════════════════════════════
// 🔐 VALIDATION PATTERNS
// ════════════════════════════════════════════════════════════════
const NEXA_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  password: /^.{8,}$/, // Minimum 8 caractères
  phone: /^[\d\s+\-()]{10,}$/, // Flexible, 10+ caractères
  url: /^https?:\/\/.+/, // HTTP(S) URL
};

// ════════════════════════════════════════════════════════════════
// 💬 MESSAGES D'ERREUR (Centralisés)
// ════════════════════════════════════════════════════════════════
const NEXA_MESSAGES = {
  // Network
  offline: '❌ Pas de connexion internet',
  serverError: '❌ Erreur serveur, réessaie',
  timeout: '⏱️ Requête timeout, réessaie',

  // Validation
  fillAll: '⚠️ Remplir tous les champs',
  pwdTooShort: '⚠️ Min 8 caractères',
  emailInvalid: '⚠️ Email invalide',
  phonInvalid: '⚠️ Téléphone invalide',

  // Auth
  emailExists: '⚠️ Email déjà utilisé',
  loginFail: '❌ Email ou mot de passe incorrect',
  confirmChecking: '⏳ Vérification en cours...',
  emailConfirmed: '✅ Email confirmé !',
  emailNotYet: '❌ Email pas encore confirmé',
  resendOk: '✅ Email renvoyé',

  // Payment
  paymentError: '❌ Erreur paiement',
  paymentSuccess: '✅ Paiement réussi !',
  selectPlan: '⚠️ Sélectionne un plan',

  // TikTok
  tiktokError: '❌ Connexion TikTok échouée',
  tiktokSuccess: '✅ TikTok connecté !',

  // Chat
  chatError: '❌ Erreur message',
  chatSuccess: '✅ Message envoyé',
};

// ════════════════════════════════════════════════════════════════
// ⏱️ TIMEOUTS (Millisecondes)
// ════════════════════════════════════════════════════════════════
const NEXA_TIMEOUTS = {
  api: 15000, // 15 secondes pour API calls
  payment: 30000, // 30 secondes pour paiement
  oauth: 60000, // 60 secondes pour OAuth
  chat: 20000, // 20 secondes pour chat
};

// ════════════════════════════════════════════════════════════════
// 🛡️ RATE LIMITING
// ════════════════════════════════════════════════════════════════
const NEXA_RATE_LIMITS = {
  login: { max: 5, window: 300000 }, // 5 tentatives / 5 minutes
  register: { max: 3, window: 300000 }, // 3 tentatives / 5 minutes
  passwordReset: { max: 3, window: 600000 }, // 3 tentatives / 10 minutes
  chat: { max: 20, window: 60000 }, // 20 messages / 1 minute
  payment: { max: 3, window: 300000 }, // 3 tentatives / 5 minutes
};

// ════════════════════════════════════════════════════════════════
// 🔧 SUPABASE INITIALIZATION
// ════════════════════════════════════════════════════════════════

/**
 * Initialise le client Supabase
 * Crée window.sb pour utilisation partout
 */
function initSupabase() {
  // Vérifie que Supabase CDN est chargé
  if (typeof window.supabase === 'undefined') {
    console.error('⚠️ Supabase CDN not loaded. Check script tag in index.html');
    return null;
  }

  // URL et clé (normalement depuis env vars Netlify)
  const supabaseUrl = process.env.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'YOUR_ANON_KEY_HERE';

  // Valide que les vars sont configurées
  if (
    !supabaseUrl ||
    supabaseUrl.includes('YOUR_PROJECT') ||
    !supabaseAnonKey ||
    supabaseAnonKey.includes('YOUR_')
  ) {
    console.error('⚠️ Supabase not properly configured. Set env vars in Netlify.');
    return null;
  }

  try {
    // Crée le client Supabase
    const sb = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

    // Stocke en global
    window.sb = sb;

    console.log('✅ Supabase initialized');
    return sb;
  } catch (err) {
    console.error('❌ Supabase init failed:', err);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 🚀 AUTO-INIT AU LOAD
// ════════════════════════════════════════════════════════════════

if (document.readyState === 'loading') {
  // DOM pas encore chargé
  document.addEventListener('DOMContentLoaded', initSupabase);
} else {
  // DOM déjà chargé
  initSupabase();
}

// ════════════════════════════════════════════════════════════════
// 📤 EXPORT (pour tests/bundlers)
// ════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NEXA_PATTERNS,
    NEXA_MESSAGES,
    NEXA_TIMEOUTS,
    NEXA_RATE_LIMITS,
    initSupabase,
  };
}
