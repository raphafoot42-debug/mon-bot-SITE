/**
 * NEXA AUTH — Authentication & Authorization
 * Register, Login, Logout avec Supabase
 * Production-ready
 */

// ════════════════════════════════════════════════════════════════
// 🔐 REGISTER
// ════════════════════════════════════════════════════════════════

/**
 * Crée un nouveau compte utilisateur
 * Appelle Supabase auth.signUp
 */
async function register() {
  try {
    // Récupère les inputs
    const email = (document.getElementById('regEmail')?.value || '').trim();
    const password = (document.getElementById('regPwd')?.value || '').trim();
    const password2 = (document.getElementById('regPwd2')?.value || '').trim();

    // ✅ Validation
    if (!email || !password || !password2) {
      toast(NEXA_MESSAGES.fillAll, 'err');
      return;
    }

    if (!isValidEmail(email)) {
      toast(NEXA_MESSAGES.emailInvalid, 'err');
      return;
    }

    if (!isValidPassword(password)) {
      toast(NEXA_MESSAGES.pwdTooShort, 'err');
      return;
    }

    if (password !== password2) {
      toast('⚠️ Les mots de passe ne correspondent pas', 'err');
      return;
    }

    // Rate limiting
    rateLimiter.check(`register_${email}`, NEXA_RATE_LIMITS.register.max, NEXA_RATE_LIMITS.register.window);

    toast(NEXA_MESSAGES.confirmChecking, 'info');

    // ════════════════════════════════════════════════════════════════
    // 🔗 SUPABASE SIGNUP
    // ════════════════════════════════════════════════════════════════

    const sb = getSb();

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/?auth=confirmed`,
      },
    });

    if (error) {
      console.error('Signup error:', error);
      const msg = error.message || 'Erreur inscription';
      toast(`❌ ${msg}`, 'err');
      return;
    }

    // ════════════════════════════════════════════════════════════════
    // 💾 SAVE USER TO SUPABASE DB
    // ════════════════════════════════════════════════════════════════

    if (data.user) {
      const newUser = {
        id: data.user.id,
        email: data.user.email,
        plan: 'free', // plan réel après inscription — promu via bot de qualification + paiement
        status: 'pending_verify',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      try {
        await apiCall('/.netlify/functions/save-user', {
          method: 'POST',
          body: JSON.stringify(newUser),
        });
      } catch (err) {
        console.warn('Could not save user to DB:', err.message);
        // Non-blocking: user created in auth anyway
      }
    }

    // ════════════════════════════════════════════════════════════════
    // ✅ SUCCESS
    // ════════════════════════════════════════════════════════════════

    toast('✅ Compte créé ! Confirme ton email.', 'ok');
    const elRegEmail = document.getElementById('regEmail');
    const elRegPwd   = document.getElementById('regPwd');
    const elRegPwd2  = document.getElementById('regPwd2');
    if (elRegEmail) elRegEmail.value = '';
    if (elRegPwd)   elRegPwd.value   = '';
    if (elRegPwd2)  elRegPwd2.value  = '';

    // Affiche la page de confirmation email (même flux que nexa.js)
    if (typeof showEmailVerifyPage === 'function') {
      showEmailVerifyPage(email);
    } else {
      setTimeout(() => showPage('login'), 2000);
    }
  } catch (err) {
    console.error('Register error:', err);
    toast(`❌ ${err.message}`, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// 🔓 LOGIN
// ════════════════════════════════════════════════════════════════

/**
 * Connecte un utilisateur existant
 * Appelle Supabase auth.signInWithPassword
 */
async function login() {
  try {
    const email = (document.getElementById('loginEmail')?.value || '').trim();
    const password = (
      document.getElementById('loginPassword')?.value || ''
    ).trim();

    // ✅ Validation
    if (!email || !password) {
      toast(NEXA_MESSAGES.fillAll, 'err');
      return;
    }

    if (!isValidEmail(email)) {
      toast(NEXA_MESSAGES.emailInvalid, 'err');
      return;
    }

    // Rate limiting
    rateLimiter.check(
      `login_${email}`,
      NEXA_RATE_LIMITS.login.max,
      NEXA_RATE_LIMITS.login.window
    );

    toast('⏳ Connexion en cours...', 'info');

    // ════════════════════════════════════════════════════════════════
    // 🔗 SUPABASE SIGNIN
    // ════════════════════════════════════════════════════════════════

    const sb = getSb();

    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Login error:', error);
      toast(NEXA_MESSAGES.loginFail, 'err');
      return;
    }

    if (!data.user) {
      toast(NEXA_MESSAGES.loginFail, 'err');
      return;
    }

    // ════════════════════════════════════════════════════════════════
    // 💾 CHARGER LE PROFIL DEPUIS SUPABASE (source de vérité)
    // ⚠️ NE PAS stocker le JWT dans localStorage — XSS exposure.
    // Supabase gère la session en interne via auth.getUser().
    // ════════════════════════════════════════════════════════════════

    const userData = await loadUserFromDB(data.user.email);
    if (userData) {
      const prospects = typeof loadProspectsFromDB === 'function'
        ? await loadProspectsFromDB(userData.id)
        : [];
      const user = { ...userData, prospects };
      LS.setUser(user);

      toast('✅ Bienvenue !', 'ok');
      const elLoginEmail = document.getElementById('loginEmail');
      const elLoginPwd   = document.getElementById('loginPassword');
      if (elLoginEmail) elLoginEmail.value = '';
      if (elLoginPwd)   elLoginPwd.value   = '';

      // Reste sur index.html — loadDashboard gère l'affichage
      if (typeof loadDashboard === 'function') {
        await loadDashboard(user);
        showPage('dashboard-page');
      }
    } else {
      // Profil pas encore créé → tunnel de qualification
      toast('✅ Bienvenue !', 'ok');
      if (typeof showPage === 'function') {
        showPage('bot-qualify');
        if (typeof botQualifyStart === 'function') {
          setTimeout(() => botQualifyStart(data.user.email), 300);
        }
      }
    }
  } catch (err) {
    console.error('Login error:', err);
    toast(`❌ ${err.message}`, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// 🚪 LOGOUT
// ════════════════════════════════════════════════════════════════

/**
 * Déconnecte l'utilisateur
 */
async function logout() {
  try {
    const sb = getSb();

    // Supabase logout
    await sb.auth.signOut();

    // Clear localStorage
    LS.clearUser();
    // ⚠️ Ne pas appeler LS.clearToken() — le token ne doit pas être en localStorage

    // Reset des historiques chat (évite fuite de contexte entre sessions)
    if (typeof chatHist !== 'undefined') chatHist = [];
    if (typeof dashChatHist !== 'undefined') dashChatHist = [];

    toast('✅ Déconnexion réussie', 'ok');

    // Retour à la page d'accueil (même page — SPA)
    setTimeout(() => {
      if (typeof showPage === 'function') {
        showPage('home');
      } else {
        window.location.href = '/';
      }
    }, 800);
  } catch (err) {
    console.error('Logout error:', err);
    toast(`❌ ${err.message}`, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// 📤 EXPORT
// ════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  window.register = register;
  window.login    = login;
  window.logout   = logout;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { register, login, logout };
}
