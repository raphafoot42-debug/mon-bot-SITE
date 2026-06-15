/* ================================================================
   NEXA — Email Verify + Onboarding
   Dépendances (chargées avant) : config.js, utils.js, nexa.js
   ================================================================ */

// ════════════════════════════════════════════════════════════════
// 📦 STATE
// ════════════════════════════════════════════════════════════════

const _state = {
  btype: null,
  finishing: false,
  _authUnsub: null,
  _authOwner: null,
  _resendTimer: null
};

let _emailVerifyPageBuilt = false;
let _successPageBuilt = false;

// Alias local vers NEXA_MESSAGES (défini dans config.js)
const MSG = {
  offline:        NEXA_MESSAGES.offline,
  sbMissing:      NEXA_MESSAGES.serverError,
  fillAll:        NEXA_MESSAGES.fillAll,
  pwdTooShort:    NEXA_MESSAGES.pwdTooShort,
  emailInvalid:   NEXA_MESSAGES.emailInvalid,
  confirmChecking:NEXA_MESSAGES.confirmChecking,
  emailConfirmed: NEXA_MESSAGES.emailConfirmed,
  emailNotYet:    NEXA_MESSAGES.emailNotYet,
  resendOk:       NEXA_MESSAGES.resendOk,
  finishSaving:   '⏳ Enregistrement...',
  verifyLoading:  '✉️ Vérification...'
};

// ════════════════════════════════════════════════════════════════
// ⚡ RATE LIMITING LOCAL (wrapper sur rateLimiter de utils.js)
// ════════════════════════════════════════════════════════════════
const checkRate = (key, limit, ms) => rateLimiter.check(key, limit, ms);

// ════════════════════════════════════════════════════════════════
// 1️⃣ REGISTER — défini dans auth.js
// showEmailVerifyPage() est appelée depuis auth.js après inscription
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// 2️⃣ PAGE VÉRIFICATION EMAIL
// ════════════════════════════════════════════════════════════════

function showEmailVerifyPage(email) {
  if (_emailVerifyPageBuilt) {
    document.getElementById('verify-email-display').textContent = email;
    document.getElementById('verify-status').textContent = '';
    return;
  }
  _emailVerifyPageBuilt = true;

  let page = document.getElementById('email-verify');
  if (!page) {
    page = document.createElement('div');
    page.id = 'email-verify';
    page.className = 'page';
    document.body.appendChild(page);
  }

  page.innerHTML = `
    <div class="tunnel-wrap">
      <div class="tunnel-card" style="max-width:520px;margin:0 auto;padding:40px;text-align:center;">
        <div style="font-size:3.5rem;margin-bottom:20px;">📧</div>
        <h2 style="color:var(--accent);font-size:1.8rem;margin-bottom:12px;">Confirme ton email</h2>
        <p style="color:var(--text-light);margin-bottom:8px;">Lien envoyé à :</p>
        <p id="verify-email-display" style="color:var(--accent);font-weight:700;word-break:break-all;margin-bottom:24px;">${escHtml(email)}</p>
        
        <div style="background:rgba(57,255,20,0.08);border:1px solid rgba(57,255,20,0.2);border-radius:10px;padding:16px;margin-bottom:24px;text-align:left;font-size:0.88rem;color:var(--text-light);">
          <p style="color:var(--accent);font-weight:700;margin-bottom:10px;">📋 Étapes :</p>
          <p>1. Ouvre ta boîte mail</p>
          <p>2. Clique sur le lien</p>
          <p>3. Reviens ici</p>
          <p style="opacity:0.7;">💡 Vérifie aussi les spams</p>
        </div>

        <button onclick="checkEmailVerified()" class="btn btn-primary btn-full" style="margin-bottom:10px;">✅ J'ai confirmé</button>
        <button onclick="resendVerifyEmail()" class="btn btn-secondary btn-full" style="margin-bottom:10px;">🔁 Renvoyer</button>
        <button onclick="showPage('home')" class="btn btn-ghost btn-full">← Retour</button>
        
        <p id="verify-status" role="status" style="margin-top:12px;font-size:0.85rem;min-height:18px;color:var(--text-light);"></p>
      </div>
    </div>`;

  showPage('email-verify');
}

// ════════════════════════════════════════════════════════════════
// 3️⃣ VÉRIFIER EMAIL
// ════════════════════════════════════════════════════════════════

async function checkEmailVerified() {
  try {
    isOnline();
    checkRate('emailCheck', 10, 60000); // Max 10/min
    
    const client = getSb();
    const statusEl = document.getElementById('verify-status');
    const btn = document.querySelector('button[onclick="checkEmailVerified()"]');
    
    if (btn) btn.textContent = MSG.confirmChecking;
    if (statusEl) statusEl.textContent = '⏳...';

    try { await client.auth.refreshSession(); } catch (_) {}
    
    const { data: { session } } = await withTimeout(client.auth.getSession(), 6000);

    if (session?.user?.email_confirmed_at) {
      const user = LS.user();
      user.emailVerified = true;
      user.status = 'actif';
      LS.setUser(user);

      if (statusEl) statusEl.textContent = MSG.emailConfirmed;
      if (statusEl) statusEl.style.color = 'var(--accent)';

      // Email de bienvenue (non-bloquant)
      if (user.email) {
        fetch('/.netlify/functions/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'welcome',
            to: user.email,
            data: { prenom: user.prenom || '' }
          })
        }).catch(e => console.warn('send-email welcome:', e.message));
      }

      setTimeout(() => {
        showSuccessPage(user);
      }, 800);

      toast(MSG.emailConfirmed, 'ok');
    } else {
      if (statusEl) statusEl.textContent = MSG.emailNotYet;
      if (statusEl) statusEl.style.color = '#ff6b6b';
    }

  } catch (err) {
    toast(`❌ ${err.message}`, 'err');
    const statusEl = document.getElementById('verify-status');
    if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = '#ff6b6b'; }
  }
}

// ════════════════════════════════════════════════════════════════
// 4️⃣ RENVOYER EMAIL
// ════════════════════════════════════════════════════════════════

async function resendVerifyEmail() {
  try {
    isOnline();
    checkRate('resendEmail', 5, 30000); // Max 5/30s
    
    const user = LS.user();
    if (!user.email) throw new Error('Email not found');

    const btn = document.querySelector('button[onclick="resendVerifyEmail()"]');
    if (btn) btn.disabled = true;

    const client = getSb();
    const { error } = await withTimeout(
      client.auth.resend({
        type: 'signup',
        email: user.email,
        options: { emailRedirectTo: window.location.origin + '/?auth=confirmed' }
      }), 10000
    );

    if (error) throw error;

    toast(MSG.resendOk, 'ok');

    if (btn) {
      let count = 60;
      btn.textContent = `🔁 (${count}s)`;
      const timer = setInterval(() => {
        count--;
        if (count <= 0) {
          clearInterval(timer);
          btn.textContent = '🔁 Renvoyer';
          btn.disabled = false;
        } else {
          btn.textContent = `🔁 (${count}s)`;
        }
      }, 1000);
    }

  } catch (err) {
    toast(`❌ ${err.message}`, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// 5️⃣ RETOUR EMAIL (?verified=1)
// ════════════════════════════════════════════════════════════════

async function checkEmailVerifyReturn() {
  const params = new URLSearchParams(window.location.search);
  // ✅ aligné sur auth.js : emailRedirectTo pointe vers ?auth=confirmed
  if (params.get('auth') !== 'confirmed') return false;

  window.history.replaceState({}, document.title, window.location.pathname);

  try {
    const client = getSb();
    const user = LS.user();
    
    showVerifyLoader(user.email);

    let resolved = false;
    const resolve = v => { if (!resolved) { resolved = true; return v; } };

    const timeout = setTimeout(() => {
      hideVerifyLoader();
      if (user.email) showEmailVerifyPage(user.email);
      resolve(false);
    }, 12000);

    const { data: { subscription } } = client.auth.onAuthStateChange((evt, session) => {
      if (evt === 'SIGNED_IN' && session?.user?.email_confirmed_at) {
        clearTimeout(timeout);
        subscription.unsubscribe();

        const u = LS.user();
        u.emailVerified = true;
        u.status = 'actif';
        LS.setUser(u);

        hideVerifyLoader();
        showSuccessPage(u);
        resolve(true);
      }
    });

    client.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email_confirmed_at) {
        clearTimeout(timeout);
        subscription.unsubscribe();
        const u = LS.user();
        u.emailVerified = true;
        LS.setUser(u);
        hideVerifyLoader();
        showSuccessPage(u);
        resolve(true);
      }
    }).catch(e => console.error('getSession:', e));

    return new Promise(r => { setTimeout(() => r(resolved), 100); });

  } catch (err) {
    console.error('checkEmailVerifyReturn:', err);
    return false;
  }
}

const showVerifyLoader = email => {
  let el = document.getElementById('_verify-loader');
  if (!el) {
    el = document.createElement('div');
    el.id = '_verify-loader';
    el.style.cssText = `position:fixed;inset:0;background:var(--bg,#000);display:flex;
      flex-direction:column;align-items:center;justify-content:center;z-index:10000;gap:12px;`;
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="font-size:2.5rem;">✉️</div>
    <p style="color:var(--accent);font-weight:700;">${MSG.verifyLoading}</p>
    <p style="color:var(--text-light);font-size:0.85rem;">${escHtml(email)}</p>`;
};

const hideVerifyLoader = () => document.getElementById('_verify-loader')?.remove();

// ════════════════════════════════════════════════════════════════
// 6️⃣ SUCCESS PAGE (Onboarding)
// ════════════════════════════════════════════════════════════════

function showSuccessPage(user) {
  if (!user?.email) return;

  if (_successPageBuilt) {
    document.getElementById('ob-prenom-display').textContent = user.prenom || 'toi';
    document.getElementById('ob-prenom-input').value = user.prenom || '';
    document.getElementById('ob-business').value = user.business || '';
    document.getElementById('ob-tiktok').value = user.tiktok_pseudo || '';
    document.getElementById('ob-instagram').value = user.instagram_pseudo || '';
    document.getElementById('ob-niche').value = user.niche || '';
    return;
  }
  _successPageBuilt = true;

  let page = document.getElementById('success');
  if (!page) {
    page = document.createElement('div');
    page.id = 'success';
    page.className = 'page';
    document.body.appendChild(page);
  }

  const planName = {
    free:        '🆓 Gratuit',
    starter:     '✨ Starter',
    pro:         '🚀 Pro',
    affiliation: '🤝 Ambassadeur'
  }[user.plan] || 'Gratuit';

  page.innerHTML = `
    <div class="tunnel-wrap" style="padding:30px 20px;">
      <div class="tunnel-card" style="max-width:600px;margin:0 auto;padding:30px;">

        <div style="text-align:center;margin-bottom:30px;">
          <div style="font-size:3rem;margin-bottom:12px;">🎉</div>
          <h2 style="color:var(--accent);font-size:1.8rem;margin-bottom:6px;">Bienvenue <span id="ob-prenom-display">${escHtml(user.prenom || 'toi')}</span> !</h2>
          <p style="color:var(--text-light);">Plan <strong style="color:var(--accent);">${planName}</strong> activé</p>
        </div>

        <!-- Progress bar -->
        <div style="display:flex;justify-content:center;gap:8px;margin-bottom:30px;">
          <div id="dot-1" style="width:30px;height:30px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#000;font-weight:700;">1</div>
          <div style="flex:1;max-width:50px;height:2px;background:var(--border);"></div>
          <div id="dot-2" style="width:30px;height:30px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-light);font-weight:700;">2</div>
          <div style="flex:1;max-width:50px;height:2px;background:var(--border);"></div>
          <div id="dot-3" style="width:30px;height:30px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-light);font-weight:700;">3</div>
        </div>

        <!-- STEP 1: Profile -->
        <div id="step-1">
          <h3 style="color:var(--accent);font-size:1.1rem;margin-bottom:6px;">👤 Étape 1 — Ton profil</h3>
          <p style="color:var(--text-light);font-size:0.85rem;margin-bottom:16px;">Dis-nous ton prénom et type de business</p>
          
          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:4px;color:var(--text-light);font-size:0.85rem;">Prénom *</label>
            <input type="text" id="ob-prenom-input" placeholder="Ton prénom" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-light);">
          </div>

          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:4px;color:var(--text-light);font-size:0.85rem;">Business *</label>
            <input type="text" id="ob-business" placeholder="Ex: Mon Coaching" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-light);">
          </div>

          <div style="margin-bottom:16px;">
            <label style="display:block;margin-bottom:8px;color:var(--text-light);font-size:0.85rem;">Type *</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="opt-card" data-btype="coaching" onclick="pickBtype(this)" role="button" tabindex="0" style="padding:10px;border:1px solid var(--border);border-radius:6px;text-align:center;cursor:pointer;">🎯 Coaching</div>
              <div class="opt-card" data-btype="ecommerce" onclick="pickBtype(this)" role="button" tabindex="0" style="padding:10px;border:1px solid var(--border);border-radius:6px;text-align:center;cursor:pointer;">📦 E-com</div>
              <div class="opt-card" data-btype="service" onclick="pickBtype(this)" role="button" tabindex="0" style="padding:10px;border:1px solid var(--border);border-radius:6px;text-align:center;cursor:pointer;">💼 Service</div>
              <div class="opt-card" data-btype="saas" onclick="pickBtype(this)" role="button" tabindex="0" style="padding:10px;border:1px solid var(--border);border-radius:6px;text-align:center;cursor:pointer;">💻 SaaS</div>
            </div>
            <p id="btype-err" role="alert" style="color:#ff6b6b;font-size:0.8rem;margin-top:6px;display:none;">Sélectionne un type</p>
          </div>

          <button onclick="nextStep(1)" class="btn btn-primary btn-full">Continuer →</button>
        </div>

        <!-- STEP 2: Socials -->
        <div id="step-2" style="display:none;">
          <h3 style="color:var(--accent);font-size:1.1rem;margin-bottom:6px;">📱 Étape 2 — Réseaux</h3>
          <p style="color:var(--text-light);font-size:0.85rem;margin-bottom:16px;">Tes pseudos (optionnel)</p>
          
          <div style="margin-bottom:10px;">
            <input type="text" id="ob-tiktok" placeholder="@tiktok" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-light);margin-bottom:8px;">
            <input type="text" id="ob-instagram" placeholder="@instagram" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-light);margin-bottom:8px;">
            <input type="text" id="ob-niche" placeholder="Ta niche" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-light);">
          </div>

          <div style="display:flex;gap:8px;">
            <button onclick="prevStep(2)" class="btn btn-secondary" style="flex:1;">← Retour</button>
            <button onclick="nextStep(2)" class="btn btn-primary" style="flex:2;">Continuer →</button>
          </div>
        </div>

        <!-- STEP 3: Recap + Finish -->
        <div id="step-3" style="display:none;text-align:center;">
          <h3 style="color:var(--accent);font-size:1.1rem;margin-bottom:6px;">🚀 Étape 3 — C'est parti !</h3>
          <p style="color:var(--text-light);font-size:0.85rem;margin-bottom:16px;">Ton profil est complet. Nexa est prête.</p>

          <div style="background:rgba(57,255,20,0.08);border:1px solid rgba(57,255,20,0.2);border-radius:8px;padding:14px;margin-bottom:16px;text-align:left;font-size:0.85rem;">
            <p style="color:var(--accent);font-weight:700;margin-bottom:8px;">✅ Nexa va faire :</p>
            <p style="color:var(--text-light);margin:6px 0;">📥 Gérer tes DMs 24h/24</p>
            <p style="color:var(--text-light);margin:6px 0;">🤖 Répondre intelligemment</p>
            <p style="color:var(--text-light);margin:6px 0;">📊 Tracker tes prospects</p>
            <p style="color:var(--text-light);margin:6px 0;">💬 IA intégrée</p>
          </div>

          <div id="recap" style="background:var(--bg-light);border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:16px;text-align:left;font-size:0.8rem;color:var(--text-light);"></div>

          <button id="finish-btn" onclick="finish()" class="btn btn-primary btn-full">🎯 Accéder au dashboard →</button>
          <button onclick="prevStep(3)" class="btn btn-secondary btn-full" style="margin-top:8px;">← Modifier</button>
        </div>

      </div>
    </div>`;

  showPage('success');
}

// ════════════════════════════════════════════════════════════════
// 7️⃣ ONBOARDING NAVIGATION
// ════════════════════════════════════════════════════════════════

function pickBtype(el) {
  document.querySelectorAll('.opt-card').forEach(c => {
    c.style.background = 'transparent';
    c.style.borderColor = 'var(--border)';
  });
  el.style.background = 'rgba(57,255,20,0.15)';
  el.style.borderColor = 'var(--accent)';
  _state.btype = el.dataset.btype;
  document.getElementById('btype-err').style.display = 'none';
}

function nextStep(step) {
  if (step === 1) {
    const prenom = sanitize(document.getElementById('ob-prenom-input')?.value);
    const business = sanitize(document.getElementById('ob-business')?.value);
    
    if (!prenom) { toast('⚠️ Prénom requis', 'err'); return; }
    if (!business) { toast('⚠️ Business requis', 'err'); return; }
    if (!_state.btype) { 
      document.getElementById('btype-err').style.display = 'block';
      toast('⚠️ Type requis', 'err');
      return;
    }

    const user = LS.user();
    user.prenom = prenom;
    user.business = business;
    user.btype = _state.btype;
    LS.setUser(user);
    goStep(2);

  } else if (step === 2) {
    const tiktok = (document.getElementById('ob-tiktok')?.value || '').trim();
    const insta = (document.getElementById('ob-instagram')?.value || '').trim();
    const niche = sanitize(document.getElementById('ob-niche')?.value);

    const user = LS.user();
    user.tiktok_pseudo = tiktok;
    user.instagram_pseudo = insta;
    user.niche = niche;
    LS.setUser(user);

    const btypes = { coaching: '🎯 Coaching', ecommerce: '📦 E-com', service: '💼 Service', saas: '💻 SaaS' };
    const recap = document.getElementById('recap');
    recap.innerHTML = `
      <p><b>Prénom :</b> ${escHtml(user.prenom)}</p>
      <p><b>Business :</b> ${escHtml(user.business)}</p>
      <p><b>Type :</b> ${btypes[user.btype] || user.btype}</p>
      <p><b>TikTok :</b> ${tiktok || '—'}</p>
      <p><b>Instagram :</b> ${insta || '—'}</p>
      <p><b>Niche :</b> ${niche || '—'}</p>
      <p><b>Plan :</b> ${user.plan}</p>
    `;
    goStep(3);
  }
}

function prevStep(step) {
  goStep(step - 1);
}

function goStep(s) {
  [1, 2, 3].forEach(n => {
    const el = document.getElementById(`step-${n}`);
    const dot = document.getElementById(`dot-${n}`);
    if (el) el.style.display = n === s ? 'block' : 'none';
    if (dot) {
      dot.style.background = n < s ? 'var(--accent)' : n === s ? 'var(--accent)' : 'var(--border)';
      dot.style.color = n <= s ? '#000' : 'var(--text-light)';
      dot.textContent = n < s ? '✓' : String(n);
    }
  });
}

async function finish() {
  try {
    if (_state.finishing) return;
    _state.finishing = true;
    isOnline();

    const user = LS.user();
    const btn = document.getElementById('finish-btn');
    if (btn) { btn.textContent = MSG.finishSaving; btn.disabled = true; }

    const client = getSb();
    if (client && user.email) {
      const { error } = await withTimeout(
        client.from('users').update({
          prenom: user.prenom,
          business: user.business,
          btype: user.btype,
          tiktok_pseudo: user.tiktok_pseudo,
          instagram_pseudo: user.instagram_pseudo,
          niche: user.niche,
          status: 'actif'
        }).eq('email', user.email),
        12000
      );

      if (error) {
        throw new Error(`Erreur Supabase: ${error.message}`);
      }
    }

    LS.del('nexaai_ob_step');
    LS.del('nexaai_ob_btype');

    toast('✅ Profil sauvegardé !', 'ok');

    setTimeout(() => {
      showPage('dashboard-page');
      if (typeof loadDashboard === 'function') {
        loadDashboard(user);
      }
    }, 500);

  } catch (err) {
    toast(`❌ ${err.message}`, 'err');
    console.error('finish() error:', err);
  } finally {
    _state.finishing = false;
    const btn = document.getElementById('finish-btn');
    if (btn) { btn.textContent = '🎯 Dashboard'; btn.disabled = false; }
  }
}

// ════════════════════════════════════════════════════════════════
// 8️⃣ RESET SESSION
// ════════════════════════════════════════════════════════════════
function resetSession() {
  _emailVerifyPageBuilt = false;
  _successPageBuilt = false;
  _state.btype = null;
  _state.finishing = false;
  if (_state._authUnsub) _state._authUnsub();
  _state._authUnsub = null;
  _state._authOwner = null;
  LS.del('nexaai_user');
  LS.del('nexaai_ob_step');
  LS.del('nexaai_ob_btype');
}

// ════════════════════════════════════════════════════════════════
// 9️⃣ EXPORT GLOBAL NAMESPACE
// ════════════════════════════════════════════════════════════════

window.Nexa = window.Nexa || {};

Object.assign(window.Nexa, {
  // Email verify
  checkEmailVerified,
  resendVerifyEmail,
  checkEmailVerifyReturn,
  showEmailVerifyPage,
  // Onboarding
  showSuccessPage,
  pickBtype,
  nextStep,
  prevStep,
  finish,
  resetSession,
});

// Exposer les fonctions directement sur window pour les onclick inline
window.checkEmailVerified  = checkEmailVerified;
window.resendVerifyEmail   = resendVerifyEmail;
window.showEmailVerifyPage = showEmailVerifyPage;
window.showSuccessPage     = showSuccessPage;
window.pickBtype           = pickBtype;
window.nextStep            = nextStep;
window.prevStep            = prevStep;
window.finish              = finish;

// ════════════════════════════════════════════════════════════════
// 🔟 INIT ON LOAD
// En SPA (index.html), nexa.js gère l'init principale.
// Ce listener gère uniquement le retour de confirmation email.
// ════════════════════════════════════════════════════════════════

if (!window.__nexaSPA) {
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      if (await checkEmailVerifyReturn()) return;
      const user = LS.user();
      if (user?.email && user?.emailVerified) showSuccessPage(user);
    } catch (err) { console.error('Init:', err); }
  });
} else {
  // En SPA : juste vérifier le retour email au load
  document.addEventListener('DOMContentLoaded', async () => {
    await checkEmailVerifyReturn();
  });
}

// Auto cleanup on unload
window.addEventListener('beforeunload', () => {
  if (_state._authUnsub) _state._authUnsub();
});
