/**
 * NEXA DASHBOARD — Main Dashboard Logic
 * Charge data utilisateur, affiche stats, gère sections
 * Production-ready
 */

// ════════════════════════════════════════════════════════════════
// 📊 LOAD USER DATA
// ════════════════════════════════════════════════════════════════

/**
 * Charge les données de l'utilisateur depuis Supabase
 */
async function loadUserData() {
  try {
    const user = await getAuthUser();

    if (!user) {
      window.location.href = '/?auth=required';
      return;
    }

    // ════════════════════════════════════════════════════════════════
    // 🔗 FETCH USER PROFILE
    // ════════════════════════════════════════════════════════════════

    const sb = getSb();
    const { data: userData, error } = await sb
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Could not load user data:', error);
      toast('❌ Erreur chargement profil', 'err');
      return null;
    }

    // ════════════════════════════════════════════════════════════════
    // 💾 SAVE TO LOCALSTORAGE
    // ════════════════════════════════════════════════════════════════

    LS.setUser({
      ...userData,
      email: user.email,
      id: user.id,
    });

    return userData;
  } catch (err) {
    console.error('loadUserData error:', err);
    toast(`❌ ${err.message}`, 'err');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 📈 RENDER DASHBOARD
// ════════════════════════════════════════════════════════════════

/**
 * Affiche la page dashboard avec les infos utilisateur
 */
async function renderDashboard() {
  try {
    // Vérifie auth
    const user = await getAuthUser();
    if (!user) {
      window.location.href = '/?auth=required';
      return;
    }

    // Charge data
    const userData = await loadUserData();
    if (!userData) {
      toast('❌ Erreur chargement données', 'err');
      return;
    }

    // ════════════════════════════════════════════════════════════════
    // 🎨 UPDATE DOM
    // ════════════════════════════════════════════════════════════════

    // Affiche bienvenue
    const welcomeEl = document.getElementById('dash-welcome');
    if (welcomeEl) {
      welcomeEl.textContent = `Bienvenue, ${userData.name || userData.email.split('@')[0]} 👋`;
    }

    // Plan actuel
    const planEl = document.getElementById('current-plan');
    if (planEl) {
      const plans = {
        starter: '✨ Starter',
        pro: '🚀 Pro',
        business: '💼 Business',
        elite: '👑 Elite',
        partner: '🤝 Partner',
      };
      planEl.textContent = plans[userData.plan] || userData.plan;
    }

    // Email
    const emailEl = document.getElementById('user-email');
    if (emailEl) {
      emailEl.textContent = userData.email;
    }

    // ════════════════════════════════════════════════════════════════
    // 📊 RENDER STATS
    // ════════════════════════════════════════════════════════════════

    await renderStats(userData);

    // ════════════════════════════════════════════════════════════════
    // ✅ SHOW DASHBOARD
    // ════════════════════════════════════════════════════════════════

    const dashPage = document.getElementById('dashboard-page');
    if (dashPage) {
      dashPage.style.display = 'block';
    }

    toast('✅ Bienvenue sur ton dashboard !', 'ok');
  } catch (err) {
    console.error('renderDashboard error:', err);
    toast(`❌ ${err.message}`, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// 📊 RENDER STATS
// ════════════════════════════════════════════════════════════════

/**
 * Affiche les statistiques utilisateur
 */
async function renderStats(userData) {
  try {
    // Prospects count
    const prospectEl = document.getElementById('st-prospects');
    if (prospectEl) {
      prospectEl.textContent = userData.prospect_count || '0';
    }

    // Messages sent
    const msgsEl = document.getElementById('st-msgs');
    if (msgsEl) {
      msgsEl.textContent = userData.message_count || '0';
    }

    // Conversion rate
    const rateEl = document.getElementById('st-rate');
    if (rateEl) {
      const rate =
        userData.prospect_count > 0
          ? Math.round((userData.converted_count / userData.prospect_count) * 100)
          : 0;
      rateEl.textContent = `${rate}%`;
    }

    // Revenue (estimé)
    const revenueEl = document.getElementById('st-revenue');
    if (revenueEl) {
      const revenue = userData.estimated_revenue || 0;
      revenueEl.textContent = formatPrice(revenue);
    }
  } catch (err) {
    console.error('renderStats error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 🔄 NAVIGATION
// ════════════════════════════════════════════════════════════════

/**
 * Affiche une section du dashboard
 */
function showDashSection(section) {
  try {
    // Hide all sections
    const sections = document.querySelectorAll('[id^="d-"]');
    sections.forEach((el) => {
      el.style.display = 'none';
    });

    // Show selected
    const sectionEl = document.getElementById(`d-${section}`);
    if (sectionEl) {
      sectionEl.style.display = 'block';
    }

    // Update menu active
    const links = document.querySelectorAll('.sidebar-menu a');
    links.forEach((el) => {
      el.classList.remove('active');
      if (el.getAttribute('data-dash') === section) {
        el.classList.add('active');
      }
    });
  } catch (err) {
    console.error('showDashSection error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 💾 SAVE SETTINGS
// ════════════════════════════════════════════════════════════════

/**
 * Sauvegarde les settings utilisateur
 */
async function saveSettings() {
  try {
    const user = await getAuthUser();
    if (!user) {
      toast(NEXA_MESSAGES.loginFail, 'err');
      return;
    }

    // Récupère les inputs
    const name = (document.getElementById('s-prenom')?.value || '').trim();
    const business = (
      document.getElementById('s-business')?.value || ''
    ).trim();
    const businessType = document.getElementById('s-type')?.value;

    // ✅ Validation
    if (!name) {
      toast('⚠️ Remplir au moins le prénom', 'err');
      return;
    }

    toast('⏳ Enregistrement...', 'info');

    // ════════════════════════════════════════════════════════════════
    // 🔗 UPDATE SUPABASE
    // ════════════════════════════════════════════════════════════════

    const sb = getSb();
    const { error } = await sb
      .from('users')
      .update({
        name,
        business_name: business,
        business_type: businessType,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (error) {
      console.error('Save settings error:', error);
      toast('❌ Erreur sauvegarde', 'err');
      return;
    }

    // ════════════════════════════════════════════════════════════════
    // ✅ SUCCESS
    // ════════════════════════════════════════════════════════════════

    toast('✅ Paramètres sauvegardés !', 'ok');

    // Recharge data
    await loadUserData();
  } catch (err) {
    console.error('saveSettings error:', err);
    toast(`❌ ${err.message}`, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// 🌐 INIT ON LOAD
// ════════════════════════════════════════════════════════════════

/**
 * Initialise le dashboard au load
 */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    renderDashboard();
  });
}

// ════════════════════════════════════════════════════════════════
// 📤 EXPORT
// ════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  window.renderDashboard = renderDashboard;
  window.showDashSection = showDashSection;
  window.saveSettings = saveSettings;
  window.loadUserData = loadUserData;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderDashboard,
    showDashSection,
    saveSettings,
    loadUserData,
  };
}
