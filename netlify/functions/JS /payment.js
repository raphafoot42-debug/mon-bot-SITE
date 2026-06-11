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
    priceId: 'price_1TgQAiP6KQQPJW2bIPBL567L',
    priceIdAnnual: 'price_1TgQAjP6KQQPJW2buOxVpaY3',
    name: '✨ Starter',
    price: 39,
    priceAnnual: 340,
    messagesPerDay: 40,
    description: 'Pour démarrer',
    features: [
      '40 messages / jour',
      'Messages automatisés',
      'Dashboard de suivi',
      'Support par email',
    ],
  },
  pro: {
    id: 'pro',
    priceId: 'price_1TgQAjP6KQQPJW2bHjVUSD4j',
    priceIdAnnual: 'price_1TgQAlP6KQQPJW2bRq9GGOnU',
    name: '🚀 Pro',
    price: 59,
    priceAnnual: 590,
    messagesPerDay: 75,
    description: 'Pour scaler',
    features: [
      '75 messages / jour',
      'Messages ultra-personnalisés',
      'Dashboard avancé',
      'Support 24/7',
      'API',
    ],
  },
  affiliation: {
    id: 'affiliation',
    priceId: null,
    priceIdAnnual: null,
    name: '🤝 Ambassadeur',
    price: 0,
    priceAnnual: 0,
    messagesPerDay: 50,
    description: 'Gratuit — 20% sur chaque vente',
    features: [
      '50 messages / jour',
      'Lien d\'affiliation personnel',
      '20% sur chaque vente générée',
    ],
  },
};

// ════════════════════════════════════════════════════════════════
// 🔄 BILLING TOGGLE
// ════════════════════════════════════════════════════════════════

/**
 * Retourne le billing actif ('monthly' | 'annual')
 */
function getBilling() {
  return localStorage.getItem('selected_billing') || 'monthly';
}

/**
 * Bascule entre mensuel et annuel
 */
function setBilling(billing) {
  if (billing !== 'monthly' && billing !== 'annual') return;
  localStorage.setItem('selected_billing', billing);

  // Met à jour le toggle UI si présent
  const toggle = document.getElementById('billing-toggle');
  if (toggle) toggle.value = billing;

  // Rafraîchit l'affichage des prix
  renderPricingPlans();
}

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

    if (!NEXA_PLANS[planId]) {
      toast('❌ Plan invalide', 'err');
      return;
    }

    // Plan Ambassadeur — gratuit, pas de paiement Stripe
    if (planId === 'affiliation') {
      showPage('bot-qualify');
      if (typeof botQualifyStart === 'function') botQualifyStart(user.email);
      return;
    }

    toast('⏳ Redirection vers paiement...', 'info');

    // ════════════════════════════════════════════════════════════════
    // 🔗 CALL STRIPE FUNCTION
    // ════════════════════════════════════════════════════════════════

    const email = user.email;
    const billing = getBilling(); // 'monthly' | 'annual'

    const response = await apiCall('/.netlify/functions/stripe-checkout', {
      method: 'POST',
      body: JSON.stringify({
        plan: planId,
        billing,
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
 * Appelé au load de index.html si ?payment=success est présent
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

    const billing = getBilling();
    const isAnnual = billing === 'annual';

    container.innerHTML = '';

    Object.values(NEXA_PLANS).forEach((plan) => {
      const card = document.createElement('div');
      card.className = 'pricing-card';
      card.setAttribute('data-plan', plan.id);

      const displayPrice = isAnnual && plan.priceAnnual > 0
        ? plan.priceAnnual
        : plan.price;
      const priceLabel = plan.price === 0
        ? 'Gratuit'
        : isAnnual
          ? `€${displayPrice}<span>/an</span>`
          : `€${displayPrice}<span>/mois</span>`;

      const features = plan.features.map((f) => `<li>✓ ${f}</li>`).join('');

      card.innerHTML = `
        <div class="pricing-header">
          <h3>${plan.name}</h3>
          <div class="pricing-price">${priceLabel}</div>
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
  window.getBilling = getBilling;
  window.setBilling = setBilling;
  window.NEXA_PLANS = NEXA_PLANS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    selectPlan,
    startCheckout,
    verifyPaymentAfterCheckout,
    renderPricingPlans,
    getBilling,
    setBilling,
    NEXA_PLANS,
  };
}
