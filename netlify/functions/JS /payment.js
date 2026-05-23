/**
 * NEXA PAYMENT — Stripe Integration & Checkout
 * Plans, pricing, checkout, verification
 * Production-ready
 */

// ════════════════════════════════════════════════════════════════
// 💳 PLAN CONFIG
// ════════════════════════════════════════════════════════════════

const NEXA_PLANS = {
  starter: {
    id: 'starter',
    name: '✨ Starter',
    price: 39,
    description: 'Pour débuter',
    features: [
      '100 messages/mois',
      'Assistant IA basique',
      'Suivi prospects',
      'Support email',
    ],
  },
  pro: {
    id: 'pro',
    name: '🚀 Pro',
    price: 99,
    description: 'Pour pros',
    features: [
      '500 messages/mois',
      'IA avancée',
      'Analytics complètes',
      'Support prioritaire',
      'Webhooks',
    ],
  },
  business: {
    id: 'business',
    name: '💼 Business',
    price: 299,
    description: 'Pour entreprises',
    features: [
      'Messages illimités',
      'IA pro + Claude',
      'API complète',
      'Support 24/7',
      'Équipe dédiée',
    ],
  },
  elite: {
    id: 'elite',
    name: '👑 Elite',
    price: 999,
    description: 'Enterprise',
    features: [
      'Tout du Business',
      'Serveurs dédiés',
      'Intégration custom',
      'Consulting inclus',
      'SLA 99.9%',
    ],
  },
};

// ════════════════════════════════════════════════════════════════
// 🛒 SELECT PLAN
// ════════════════════════════════════════════════════════════════

/**
 * Sélectionne un plan (highlight visual + store)
 */
function selectPlan(planId) {
  try {
    // Highlight
    const cards = document.querySelectorAll('[data-plan]');
    cards.forEach((card) => {
      card.classList.remove('selected');
      if (card.getAttribute('data-plan') === planId) {
        card.classList.add('selected');
      }
    });

    // Store
    localStorage.setItem('selected_plan', planId);

    toast(`✅ Plan ${NEXA_PLANS[planId]?.name || planId} sélectionné`, 'ok');
  } catch (err) {
    console.error('selectPlan error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 💳 START CHECKOUT
// ════════════════════════════════════════════════════════════════

/**
 * Lance le checkout Stripe
 */
async function startCheckout(planId) {
  try {
    const user = await getAuthUser();
    if (!user) {
      toast(NEXA_MESSAGES.loginFail, 'err');
      showPage('login');
      return;
    }

    const email = user.email;

    // ✅ Validation
    if (!NEXA_PLANS[planId]) {
      toast('❌ Plan invalide', 'err');
      return;
    }

    toast('⏳ Redirection vers paiement...', 'info');

    // ════════════════════════════════════════════════════════════════
    // 🔗 CALL STRIPE FUNCTION
    // ════════════════════════════════════════════════════════════════

    const response = await apiCall('/.netlify/functions/stripe-checkout', {
      method: 'POST',
      body: JSON.stringify({
        plan: planId,
        email,
        referrer_id: localStorage.getItem('referrer_id') || null,
      }),
    });

    if (!response.url) {
      throw new Error('No checkout URL returned');
    }

    // ════════════════════════════════════════════════════════════════
    // 📤 REDIRECT TO STRIPE
    // ════════════════════════════════════════════════════════════════

    window.location.href = response.url;
  } catch (err) {
    console.error('startCheckout error:', err);
    toast(`❌ ${err.message || NEXA_MESSAGES.paymentError}`, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// ✅ VERIFY PAYMENT AFTER REDIRECT
// ════════════════════════════════════════════════════════════════

/**
 * Vérifie le paiement après redirect de Stripe
 * À appeler depuis dashboard.html après paiement
 */
async function verifyPaymentAfterCheckout() {
  try {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get('session_id');
    const status = url.searchParams.get('payment');

    // Pas de session ID = pas de paiement
    if (!sessionId || status !== 'success') {
      return null;
    }

    const user = await getAuthUser();
    if (!user) {
      toast(NEXA_MESSAGES.loginFail, 'err');
      return null;
    }

    toast('⏳ Vérification paiement...', 'info');

    // ════════════════════════════════════════════════════════════════
    // 🔗 VERIFY PAYMENT FUNCTION
    // ════════════════════════════════════════════════════════════════

    const response = await apiCall('/.netlify/functions/verify-payment', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        email: user.email,
      }),
    });

    if (!response.valid) {
      throw new Error(response.error || 'Payment verification failed');
    }

    // ════════════════════════════════════════════════════════════════
    // 💾 UPDATE LOCAL USER DATA
    // ════════════════════════════════════════════════════════════════

    const userData = LS.user();
    userData.plan = response.plan;
    userData.is_partner = response.isPartner;
    LS.setUser(userData);

    // ════════════════════════════════════════════════════════════════
    // ✅ SUCCESS
    // ════════════════════════════════════════════════════════════════

    toast('✅ Paiement confirmé ! Bienvenue.', 'ok');

    // Clean URL
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('session_id');
    cleanUrl.searchParams.delete('payment');
    window.history.replaceState({}, document.title, cleanUrl.toString());

    return response;
  } catch (err) {
    console.error('verifyPaymentAfterCheckout error:', err);
    toast(`❌ ${err.message}`, 'err');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 💰 FORMAT PRICING
// ════════════════════════════════════════════════════════════════

/**
 * Affiche les plans de pricing
 */
function renderPricingPlans() {
  try {
    const container = document.getElementById('pricing-plans');
    if (!container) return;

    container.innerHTML = '';

    Object.values(NEXA_PLANS).forEach((plan) => {
      const card = document.createElement('div');
      card.className = 'pricing-card';
      card.setAttribute('data-plan', plan.id);

      const features = plan.features.map((f) => `<li>✓ ${f}</li>`).join('');

      card.innerHTML = `
        <div class="pricing-header">
          <h3>${plan.name}</h3>
          <div class="pricing-price">€${plan.price}<span>/mois</span></div>
          <p>${plan.description}</p>
        </div>
        <ul class="pricing-features">
          ${features}
        </ul>
        <button class="btn btn-primary btn-full" onclick="startCheckout('${plan.id}')">
          Commencer
        </button>
      `;

      container.appendChild(card);
    });
  } catch (err) {
    console.error('renderPricingPlans error:', err);
  }
}

// ════════════════════════════════════════════════════════════════
// 🌐 INIT
// ════════════════════════════════════════════════════════════════

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    renderPricingPlans();
    verifyPaymentAfterCheckout();
  });
}

// ════════════════════════════════════════════════════════════════
// 📤 EXPORT
// ════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  window.selectPlan = selectPlan;
  window.startCheckout = startCheckout;
  window.verifyPaymentAfterCheckout = verifyPaymentAfterCheckout;
  window.renderPricingPlans = renderPricingPlans;
  window.NEXA_PLANS = NEXA_PLANS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    selectPlan,
    startCheckout,
    verifyPaymentAfterCheckout,
    renderPricingPlans,
    NEXA_PLANS,
  };
}
