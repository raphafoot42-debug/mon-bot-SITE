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
        emailRedirectTo: `${window.location.origin}/dashboard.html`,
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
        plan: 'starter',
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
    document.getElementById('regEmail').value = '';
    document.getElementById('regPwd').value = '';
    document.getElementById('regPwd2').value = '';

    // Redirige après 2s
    setTimeout(() => showPage('login'), 2000);
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
    // 💾 SAVE USER DATA LOCALLY
    // ════════════════════════════════════════════════════════════════

    const userData = {
      id: data.user.id,
      email: data.user.email,
      token: data.session?.access_token,
    };

    LS.setUser(userData);
    LS.setToken(data.session?.access_token);

    // ════════════════════════════════════════════════════════════════
    // ✅ SUCCESS
    // ════════════════════════════════════════════════════════════════

    toast('✅ Bienvenue !', 'ok');
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';

    // Redirige au dashboard
    setTimeout(() => {
      window.location.href = '/dashboard.html';
    }, 1000);
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
    LS.clearToken();

    // Message
    toast('✅ Déconnexion réussie', 'ok');

    // Redirige home
    setTimeout(() => {
      window.location.href = '/';
    }, 1000);
  } catch (err) {
    console.error('Logout error:', err);
    toast(`❌ ${err.message}`, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// ✅ CHECK AUTH STATUS
// ════════════════════════════════════════════════════════════════

/**
 * Vérifie si l'utilisateur est connecté
 * Retourne l'utilisateur ou null
 */
async function getAuthUser() {
  try {
    const sb = getSb();
    const {
      data: { user },
    } = await sb.auth.getUser();
    return user || null;
  } catch (err) {
    console.error('getAuthUser error:', err);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 🔐 REQUIRE AUTH
// ════════════════════════════════════════════════════════════════

/**
 * Redirige au login si pas connecté
 * À appeler au load du dashboard
 */
async function requireAuth() {
  const user = await getAuthUser();

  if (!user) {
    // Pas connecté
    window.location.href = '/?auth=required';
    return null;
  }

  return user;
}

// ════════════════════════════════════════════════════════════════
// 📤 EXPORT
// ════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  window.register = register;
  window.login = login;
  window.logout = logout;
  window.getAuthUser = getAuthUser;
  window.requireAuth = requireAuth;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    register,
    login,
    logout,
    getAuthUser,
    requireAuth,
  };
}
