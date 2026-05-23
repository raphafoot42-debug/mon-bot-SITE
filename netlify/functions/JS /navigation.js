/**
 * NEXA NAVIGATION — Page & Language Navigation
 * Gère l'affichage des pages, les transitions, les langues
 * Production-ready
 */

// ════════════════════════════════════════════════════════════════
// 🌍 TRANSLATIONS
// ════════════════════════════════════════════════════════════════

const TRANSLATIONS = {
  fr: {
    loginTitle: 'Connexion',
    loginBtn: 'Se connecter',
    registerBtn: "S'inscrire",
    logoutBtn: 'Déconnexion',
    dashboardTitle: 'Tableau de bord',
    settingsTitle: 'Paramètres',
    pricingTitle: 'Tarifs',
    supportTitle: 'Support',
    faqTitle: 'FAQ',
  },
  en: {
    loginTitle: 'Sign In',
    loginBtn: 'Sign In',
    registerBtn: 'Sign Up',
    logoutBtn: 'Sign Out',
    dashboardTitle: 'Dashboard',
    settingsTitle: 'Settings',
    pricingTitle: 'Pricing',
    supportTitle: 'Support',
    faqTitle: 'FAQ',
  },
  cn: {
    loginTitle: '登录',
    loginBtn: '登录',
    registerBtn: '注册',
    logoutBtn: '登出',
    dashboardTitle: '仪表板',
    settingsTitle: '设置',
    pricingTitle: '定价',
    supportTitle: '支持',
    faqTitle: '常见问题',
  },
};

// ════════════════════════════════════════════════════════════════
// 📄 PAGE NAVIGATION
// ════════════════════════════════════════════════════════════════

/**
 * Affiche une page, cache les autres
 */
function showPage(pageId) {
  try {
    // Hide all pages
    const pages = document.querySelectorAll('.page');
    pages.forEach((page) => {
      page.style.display = 'none';
    });

    // Show selected
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
      targetPage.style.display = 'block';
      targetPage.scrollIntoView({ behavior: 'smooth' });
    }

    // Update browser history
    window.history.pushState({ page: pageId }, '', `#${pageId}`);
  } catch (err) {
    console.error('showPage error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 🌍 LANGUAGE SWITCHING
// ════════════════════════════════════════════════════════════════

/**
 * Change la langue et applique les traductions
 */
function changeLang(lang) {
  try {
    if (!TRANSLATIONS[lang]) {
      console.warn(`Language ${lang} not available`);
      return;
    }

    // Save to localStorage
    localStorage.setItem('nexa_lang', lang);

    // Apply translations
    const trans = TRANSLATIONS[lang];
    Object.entries(trans).forEach(([key, value]) => {
      const el = document.getElementById(`t-${key}`);
      if (el) {
        el.textContent = value;
      }
    });

    // Set HTML lang attribute
    document.documentElement.lang = lang;

    // Update selector
    const selector = document.querySelector('.lang-selector');
    if (selector) {
      selector.value = lang;
    }

    toast(`✅ Langue changée en ${lang.toUpperCase()}`, 'info');
  } catch (err) {
    console.error('changeLang error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 📍 HANDLE HASH NAVIGATION
// ════════════════════════════════════════════════════════════════

/**
 * Gère la navigation par URL hash
 * Ex: #login, #register, #pricing
 */
function handleHashNavigation() {
  try {
    let hash = window.location.hash.substring(1) || 'home';

    // Redirect secure pages if not logged in
    const securePages = ['dashboard', 'settings'];
    if (securePages.includes(hash)) {
      getAuthUser().then((user) => {
        if (!user) {
          showPage('home');
          toast('❌ Connexion requise', 'err');
        } else {
          showPage(hash);
        }
      });
    } else {
      showPage(hash);
    }
  } catch (err) {
    console.error('handleHashNavigation error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 🚀 INIT NAVIGATION
// ════════════════════════════════════════════════════════════════

/**
 * Initialise la navigation au load
 */
function initNavigation() {
  try {
    // ════════════════════════════════════════════════════════════════
    // 🌍 Load saved language
    // ════════════════════════════════════════════════════════════════

    const savedLang = localStorage.getItem('nexa_lang') || 'fr';
    changeLang(savedLang);

    // ════════════════════════════════════════════════════════════════
    // 📍 Handle initial route
    // ════════════════════════════════════════════════════════════════

    handleHashNavigation();

    // ════════════════════════════════════════════════════════════════
    // 📍 Listen to hash changes
    // ════════════════════════════════════════════════════════════════

    window.addEventListener('hashchange', handleHashNavigation);

    // ════════════════════════════════════════════════════════════════
    // 👤 Update auth UI
    // ════════════════════════════════════════════════════════════════

    updateAuthUI();
  } catch (err) {
    console.error('initNavigation error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 👤 UPDATE AUTH UI
// ════════════════════════════════════════════════════════════════

/**
 * Met à jour les boutons d'auth selon l'état de connexion
 */
async function updateAuthUI() {
  try {
    const user = await getAuthUser();

    const loginBtn = document.getElementById('loginBtn');
    const signupBtn = document.getElementById('signupBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const dashboardBtn = document.getElementById('dashboardBtn');

    if (user) {
      // Connecté
      if (loginBtn) loginBtn.style.display = 'none';
      if (signupBtn) signupBtn.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'block';
      if (dashboardBtn) dashboardBtn.style.display = 'block';
    } else {
      // Pas connecté
      if (loginBtn) loginBtn.style.display = 'block';
      if (signupBtn) signupBtn.style.display = 'block';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (dashboardBtn) dashboardBtn.style.display = 'none';
    }
  } catch (err) {
    console.error('updateAuthUI error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 🌐 INIT ON LOAD
// ════════════════════════════════════════════════════════════════

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initNavigation);
}

// ════════════════════════════════════════════════════════════════
// 📤 EXPORT
// ════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  window.showPage = showPage;
  window.changeLang = changeLang;
  window.handleHashNavigation = handleHashNavigation;
  window.updateAuthUI = updateAuthUI;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    showPage,
    changeLang,
    handleHashNavigation,
    updateAuthUI,
    TRANSLATIONS,
  };
}
