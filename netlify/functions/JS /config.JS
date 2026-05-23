/**
 * CONFIG.JS - Configuration centralisée Nexa
 * ✅ À utiliser partout pour éviter les hardcodes
 */

window.NEXA_CONFIG = {
  // ====== SUPABASE ======
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'YOUR_ANON_KEY',

  // ====== STRIPE ======
  STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY || 'pk_test_...',

  // ====== TIKTOK OAUTH ======
  TIKTOK_CLIENT_KEY: 'sbaw1dltizgdnu9xs8', // Public, OK de le mettre ici
  TIKTOK_REDIRECT_URI: window.location.origin + '/tiktok-bridge.html',

  // ====== API FUNCTIONS ======
  FUNCTIONS_BASE: '/.netlify/functions',

  // ====== MESSAGES D'ERREUR ======
  ERRORS: {
    OFFLINE: '❌ Pas de connexion internet',
    SUPABASE_MISSING: '❌ Supabase non initialisé',
    FILL_ALL: '⚠️ Remplir tous les champs',
    PWD_SHORT: '⚠️ Minimum 8 caractères',
    EMAIL_INVALID: '⚠️ Email invalide',
    PLAN_REQUIRED: '⚠️ Sélectionne un plan',
  },

  // ====== VALIDATION ======
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  PWD_MIN_LENGTH: 8,

  // ====== TIMEOUTS ======
  TIMEOUT_MS: 8000,
  RATE_LIMIT_MS: 900000, // 15min
  RATE_LIMIT_MAX: 5,
};

/**
 * Initialiser Supabase avec config centralisée
 */
function initSupabase() {
  if (!window.supabase) {
    console.error('❌ Supabase JS library not loaded');
    return null;
  }

  const sb = window.supabase.createClient(
    NEXA_CONFIG.SUPABASE_URL,
    NEXA_CONFIG.SUPABASE_ANON_KEY
  );

  window.sb = sb; // Global
  return sb;
}

// Initialiser dès que le DOM est ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSupabase);
} else {
  initSupabase();
}
