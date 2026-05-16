/* Nexa — app cliente (Netlify Functions)
 * Fichiers à publier ensemble : index.html, css/nexa.css, js/nexa.js
 * Ordre de chargement : Stripe (head, synchrone) → Supabase (defer) → ce script (defer).
 */

// ===== VARIABLES GLOBALES (déclarées en premier pour éviter les ReferenceError) =====
let currentLang = 'fr';
let td = {}; // tunnel data (données du tunnel de qualification)

// ===== SYSTÈME D'AFFILIATION =====
(function() {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    // Valider que l'ID commence bien par acct_
    if(ref && ref.startsWith('acct_')) {
        localStorage.setItem('nexa_partner_id', ref);
        // Nettoyer l'URL sans recharger la page
        const cleanUrl = window.location.pathname + 
            (window.location.search.replace(/[?&]ref=[^&]*/g, '').replace(/^&/, '?') || '');
        window.history.replaceState({}, document.title, cleanUrl);
    }
})();

// ===== STRIPE PLANS ANNUELS =====
const STRIPE_PLANS = {
    "price_1TT4VCP8svYH1bkOmrlIYHls": { name: "Starter Annuel", prospects: 10 },
    "price_1TT4WjP8svYH1bkO9lOHz2CW": { name: "Pro Annuel", prospects: 80 },
    "price_1TT4XwP8svYH1bkOoPQgfYmF": { name: "Business Annuel", prospects: 300 },
    "price_1TT4XNP8svYH1bkORkrNN1P6": { name: "Elite Annuel", prospects: 750 }
};

// ===== SAVE AND SYNC STRIPE =====
async function saveAndSyncStripe() {
    // CORRECTION: null-check propre sur clientStripeId
    const elClientStripe = document.getElementById('clientStripeId');
    const stripeId = elClientStripe ? elClientStripe.value.trim() : '';
    const statusLabel = document.getElementById('stripeStatus');
    const btn = document.getElementById('btnSaveStripe');
    if(!statusLabel || !btn) return;

    if(!stripeId.startsWith('acct_')) {
        statusLabel.innerText = "❌ ID invalide. Il doit commencer par 'acct_'";
        statusLabel.style.color = "#ff4d4d";
        return;
    }
    btn.innerText = "Synchronisation...";
    btn.disabled = true;
    try {
        const user = JSON.parse(localStorage.getItem('nexaai_user') || '{}');
        if(sb && user.id) {
            const { error } = await sb.from('users').update({
                stripe_connect_id: stripeId,
                commission_rate: 0.20
            }).eq('id', user.id);
            if(error) throw error;
        }
        // Sauvegarder en localStorage aussi
        user.stripe_connect_id = stripeId;
        localStorage.setItem('nexaai_user', JSON.stringify(user));
        statusLabel.innerText = "✅ Partage 20/80 activé ! Tu reçois 80% de chaque vente générée.";
        statusLabel.style.color = "var(--accent)";
        btn.innerText = "Enregistré";
    } catch(err) {
        console.error(err);
        statusLabel.innerText = "❌ Erreur lors de l'enregistrement.";
        statusLabel.style.color = "#ff4d4d";
        btn.disabled = false;
        btn.innerText = "Réessayer";
    }
}

// ===== CONFIG =====
const STRIPE_PK = 'pk_test_51TH5S2P8svYH1bkONQyzCOzUff4OrRBFLAu0REAMGK1043xGSQZlW8Ohw3aXYxdfNbgQhvHQsVx6LXeIQbUxpdzu00iEbgUt7K';
// ✅ Netlify Functions — clés cachées côté serveur
const PROXY_URL = '/.netlify/functions/claude';
const STRIPE_URL = '/.netlify/functions/stripe-checkout';
const CLAUDE_MODEL = 'claude-sonnet-4-5'; // model string Anthropic API (format stable)
let stripe = null;
let sb = null;
let CLIENT_STORE_URL = '';

// ===== RETOUR TIKTOK =====
function checkTikTokReturn() {
    const params = new URLSearchParams(window.location.search);
    const tiktok = params.get('tiktok');
    const data = params.get('data');

    if(tiktok === 'success' && data) {
        try {
            const tiktokInfo = JSON.parse(decodeURIComponent(data));
            // Sauvegarder les infos TikTok
            const user = JSON.parse(localStorage.getItem('nexaai_user') || '{}');
            user.tiktok_pseudo = tiktokInfo.username || tiktokInfo.displayName || '';
            user.tiktok_open_id = tiktokInfo.openId || '';
            user.platforms = user.platforms || [];
            if(!user.platforms.includes('tiktok')) user.platforms.push('tiktok');
            localStorage.setItem('nexaai_user', JSON.stringify(user));
            // Sauvegarder dans Supabase
            if(sb && user.email) {
                saveUserToDB({
                    email: user.email,
                    tiktok_pseudo: user.tiktok_pseudo,
                    platforms: user.platforms
                });
            }
            window.history.replaceState({}, document.title, window.location.pathname);
            // Afficher le dashboard si connecté
            if(user.email) {
                await loadDashboard(user);
        showPage('dashboard-page');
                setTimeout(() => alert('✅ TikTok connecté ! Bienvenue ' + (tiktokInfo.displayName || '') + ' !'), 500);
            }
            return true;
        } catch(e) {
            console.error('TikTok return error:', e);
        }
    }

    if(tiktok === 'error') {
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => alert('❌ Connexion TikTok échouée. Réessaie !'), 300);
        return true;
    }
    return false;
}

function checkStripeReturn() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const plan = params.get('plan') || localStorage.getItem('nexaai_pending_plan') || 'starter';

    if(payment === 'success') {
        // Paiement réussi — mettre à jour le plan et afficher succès
        const user = JSON.parse(localStorage.getItem('nexaai_user') || '{}');
        const planBase = plan.replace('-once', '');
        user.plan = planBase;
        localStorage.setItem('nexaai_user', JSON.stringify(user));
        localStorage.removeItem('nexaai_pending_plan');

        // Mettre à jour dans Supabase
        if(sb && user.email) {
            sb.from('users').update({ plan: planBase }).eq('email', user.email).then(() => {
                // Enregistrer le paiement
                sb.from('users').select('id').eq('email', user.email).single().then(({ data }) => {
                    if(data) {
                        const prices = {starter:39,'starter-once':390,pro:94,'pro-once':940,business:194,'business-once':1940,elite:494,'elite-once':4940};
                        sb.from('paiements').insert([{
                            user_id: data.id,
                            plan: planBase,
                            montant: prices[plan] || 39,
                            type_paiement: plan.includes('-once') ? 'unique' : 'mensuel'
                        }]);
                    }
                });
            });
        }

        // Nettoyer l'URL
        window.history.replaceState({}, document.title, window.location.pathname);

        showSuccessPage(user);
        return true;
    }

    if(payment === 'cancel') {
        window.history.replaceState({}, document.title, window.location.pathname);
        showPage('home');
        setTimeout(() => alert('Paiement annulé. Tu peux réessayer quand tu veux !'), 500);
        return true;
    }
    return false;
}

window.addEventListener('load', async () => {
        try {
            if(typeof Stripe !== 'undefined' && STRIPE_PK) {
                stripe = Stripe(STRIPE_PK);
            } else {
                console.warn('[Nexa] Stripe.js indisponible : vérifie le script dans index.html ou un bloqueur de pub.');
            }
            if(!window.supabase) {
                console.warn('[Nexa] Supabase SDK non chargé : vérifie le script defer avant js/nexa.js.');
                return;
            }
            sb = window.supabase.createClient(
                "https://aubjtlxwqndfawdidwfq.supabase.co",
                "sb_publishable_ac-EaAMzdCCmFRxU6Iny9A_NgMHlUHB"
            );
            if(checkTikTokReturn()) return;
            if(checkStripeReturn()) return;

            const { data: { session } } = await sb.auth.getSession();
            if(session && session.user) {
                // Utiliser loadUserData() pour centraliser le chargement du profil
                await loadUserData();
            }
        } catch(e) {
            console.error('[Nexa] Erreur au démarrage :', e);
        }
    });

   // ===== SUPABASE HELPERS =====
async function getAuthUser() {
    if(!sb) return null;
    const { data: { user } } = await sb.auth.getUser();
    return user;
}

async function saveUserToDB(userData) {
    if(!sb) return;
    // Utilisation de upsert pour mettre à jour ou insérer
    const { error } = await sb.from('users').upsert([userData], { onConflict: 'email' });
    if(error) console.error('Supabase save error:', error);
}

async function loadUserFromDB(email) {
    if(!sb) return null;
    const { data, error } = await sb.from('users').select('*').eq('email', email).single();
    if(error) return null;
    return data;
}

async function loadProspectsFromDB(userId) {
    if(!sb) return [];
    const { data: prospects } = await sb.from('prospects').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return prospects || [];
}

async function loadUserData() {
    if(!sb) return;
    const authUser = await getAuthUser();
    if(!authUser) return;
    // CORRECTION: reset historique chat au chargement d'un nouveau profil
    if(typeof dashChatHist !== 'undefined') dashChatHist = [];

    const userData = await loadUserFromDB(authUser.email);
    
    if(userData) {
        // L'utilisateur existe en BDD
        const prospects = await loadProspectsFromDB(userData.id);
        const user = { ...userData, prospects };
        localStorage.setItem('nexaai_user', JSON.stringify(user));
        loadDashboard(user);
        // CORRECTION : ID corrigé dashboard-page
        showPage('dashboard-page');
    } else {
        // L'utilisateur est connecté via Auth mais pas encore dans la table 'users'
        // CORRECTION : td est déjà déclaré globalement, pas besoin de td || {}
        td.email = authUser.email;
        showPage('bot-qualify');
        setTimeout(() => {
            if (typeof botQualifyStart === 'function') {
                botQualifyStart(authUser.email);
            }
        }, 300);
    }
    
    // changeLang appelé uniquement si définie (peut être dans un autre fichier)
    if (typeof changeLang === 'function') {
        changeLang(currentLang);
    }
}

async function signOut() {
    if(sb) await sb.auth.signOut();
    localStorage.removeItem('nexaai_user');
    // CORRECTION: réinitialiser les historiques pour éviter fuites entre sessions
    if(typeof dashChatHist !== 'undefined') dashChatHist = [];
    if(typeof chatHist !== 'undefined') chatHist = [];
    showPage('home');
}

// ===== STATE =====
let currentPlan = 'starter';
// currentLang et td sont déclarés en haut du fichier
let connected = [];
let chatOpen = false;
let chatHist = [];

// ===== PAGE SUCCÈS =====
function showSuccessPage(user) {
    if (!user) return;

    const planNames = {
        starter: 'Starter',
        pro: 'Pro 🎯',
        business: 'Business 💼',
        elite: 'Elite 👑'
    };
    const planName = planNames[user.plan] || 'Starter';

    let successPage = document.getElementById('success');
    if(!successPage) {
        successPage = document.createElement('div');
        successPage.id = 'success';
        successPage.className = 'page';
        successPage.innerHTML = `
            <div class="tunnel-wrap">
                <div class="tunnel-card" style="text-align:center;max-width:550px;margin: 0 auto; padding: 40px;">
                    <div style="font-size:4rem;margin-bottom:20px;">🎉</div>
                    <h2 style="color:var(--accent);font-size:2rem;margin-bottom:15px;">Bienvenue ${user.prenom || ''} !</h2>
                    <p style="color:var(--text-light);font-size:1rem;line-height:1.7;margin-bottom:30px;">
                        Ton plan <strong style="color:var(--accent);">${planName}</strong> est activé. Nexa est prête à travailler pour toi 24h/24.
                    </p>
                    <div style="background:rgba(57,255,20,0.08);border:1px solid rgba(57,255,20,0.3);border-radius:12px;padding:20px;margin-bottom:30px;text-align:left;">
                        <p style="color:var(--accent);font-weight:700;margin-bottom:12px;">✅ Prochaines étapes :</p>
                        <p style="color:var(--text-light);margin:8px 0;">1. Connecte tes réseaux TikTok / Instagram</p>
                        <p style="color:var(--text-light);margin:8px 0;">2. Parle à Nexa pour finaliser ton profil</p>
                        <p style="color:var(--text-light);margin:8px 0;">3. Regarde tes premiers prospects arriver</p>
                    </div>
                    <button class="btn btn-primary btn-full" onclick="goToDashboard()" style="font-size:1rem; width: 100%;">
                        Accéder à mon dashboard →
                    </button>
                </div>
            </div>`;
        document.body.appendChild(successPage);
    }
    showPage('success');
}

// Fonction de secours pour le bouton du dashboard
function goToDashboard() {
    const user = JSON.parse(localStorage.getItem('nexaai_user'));
    if(user) loadDashboard(user);
    showPage('dashboard-page');
}

// ===== MODAL ONBOARDING =====
let modalCurrentStep = 1;
let modalSelectedPlan = 'pro';

function openOnboarding() {
    // CORRECTION: null-check avant accès classList
    const om = document.getElementById('onboardingModal');
    if(om) om.classList.add('active');
    modalGoStep(1);
}

function closeOnboarding() {
    // CORRECTION: null-check avant accès classList
    const om = document.getElementById('onboardingModal');
    if(om) om.classList.remove('active');
}

function modalGoStep(step) {
    modalCurrentStep = step;
    // Cacher toutes les étapes
    for(let i = 1; i <= 4; i++) {
        const s = document.getElementById('modal-step' + i);
        const d = document.getElementById('dot' + i);
        if(s) s.classList.remove('active');
        if(d) { d.classList.remove('active', 'done'); }
    }
    // Activer l'étape courante
    const cur = document.getElementById('modal-step' + step);
    if(cur) cur.classList.add('active');
    // Mettre à jour les dots
    for(let i = 1; i <= 4; i++) {
        const d = document.getElementById('dot' + i);
        if(!d) continue;
        if(i < step) d.classList.add('done');
        else if(i === step) d.classList.add('active');
    }
}

function modalNext(step) {
    if(step === 1) {
        const prenom = document.getElementById('m-prenom').value.trim();
        const email = document.getElementById('m-email').value.trim();
        if(!prenom || !email) { alert('Merci de remplir prénom et email !'); return; }
        td.prenom = prenom;
        td.email = email;
        // CORRECTION: null-checks champs onboarding step 1
        const elMPhone = document.getElementById('m-phone');
        const elMPays = document.getElementById('m-pays');
        td.phone = elMPhone ? elMPhone.value : '';
        td.pays = elMPays ? elMPays.value : '';
    }
    if(step === 2) {
        const business = document.getElementById('m-business').value.trim();
        if(!business) { alert('Entre le nom de ton business !'); return; }
        td.business = business;
        // CORRECTION: null-checks champs onboarding step 2
        const elMObj = document.getElementById('m-objectif');
        const elMDms = document.getElementById('m-dms');
        td.objectif = elMObj ? elMObj.value : '';
        td.dms = elMDms ? elMDms.value : '';
    }
    if(step === 3) {
        // CORRECTION: null-checks champs onboarding step 3
        const elMTik = document.getElementById('m-tiktok');
        const elMInsta = document.getElementById('m-instagram');
        const elMNiche = document.getElementById('m-niche');
        td.tiktok = elMTik ? elMTik.value : '';
        td.instagram = elMInsta ? elMInsta.value : '';
        td.niche = elMNiche ? elMNiche.value : '';
    }
    modalGoStep(step + 1);
}

function modalPrev(step) {
    modalGoStep(step - 1);
}

function selectModalPlan(el, plan) {
    document.querySelectorAll('.plan-select-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    modalSelectedPlan = plan;
}

function modalPay() {
    closeOnboarding();
    handlePlanSelection(modalSelectedPlan || 'pro');
}

// ===== NAVIGATION =====
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const p = document.getElementById(id);
    if(p) { p.classList.add('active'); window.scrollTo({top:0,behavior:'smooth'}); }
}

// ===== TUNNEL =====
function startTunnel(plan) {
    // CORRECTION : résoudre les price IDs Stripe annuels vers leur plan de base
    const priceIdMap = {
        'price_1TT4VCP8svYH1bkOmrlIYHls': 'starter-once',
        'price_1TT4WjP8svYH1bkO9lOHz2CW': 'pro-once',
        'price_1TT4XwP8svYH1bkOoPQgfYmF': 'business-once',
        'price_1TT4XNP8svYH1bkORkrNN1P6': 'elite-once'
    };
    if(priceIdMap[plan]) plan = priceIdMap[plan];

    currentPlan = plan;
    td.plan = plan;
    const isOnce = plan.includes('-once');
    const planBase = plan.replace('-once', '');
    const planNames = {starter:'Starter', pro:'Pro 🎯', business:'Business 💼', elite:'Elite 👑'};
    const planPrices = {
        'starter':'€39', 'starter-once':'€390 (paiement unique)',
        'pro':'€94', 'pro-once':'€940 (paiement unique)',
        'business':'€194', 'business-once':'€1940 (paiement unique)',
        'elite':'€494', 'elite-once':'€4940 (paiement unique)'
    };
    const payPlanName = document.getElementById('pay-plan-name');
    const payPlanPrice = document.getElementById('pay-plan-price');
    if(payPlanName) payPlanName.textContent = (planNames[planBase] || 'Starter') + (isOnce ? ' — Paiement unique' : '');
    if(payPlanPrice) payPlanPrice.textContent = planPrices[plan] || '€39';

    // Afficher les features du plan dans la page paiement
    const features = {
        starter: '&#8226; 10 prospects / jour&#8226; Messages automatisés&#8226; Dashboard&#8226; Support par email',
        pro: '&#8226; 80 prospects / jour&#8226; Messages ultra-personnalisés&#8226; Dashboard + Analytics&#8226; Support 24/7&#8226; API integration',
        business: '&#8226; 300 prospects / jour&#8226; 200 messages bot / jour&#8226; Dashboard Business&#8226; Support 24/7&#8226; API integration',
        elite: '&#8226; 750 prospects / jour&#8226; Messages bot illimités&#8226; Dashboard Elite&#8226; Account manager dédié&#8226; API + Webhooks&#8226; Onboarding dédié'
    };
    const featEl = document.getElementById('pay-features');
    if(featEl) featEl.innerHTML = features[planBase] || features.starter;

    const typeEl = document.getElementById('pay-plan-type');
    if(typeEl) typeEl.textContent = isOnce ? 'Paiement unique — accès 12 mois' : 'Abonnement mensuel — sans engagement';

    handlePlanSelection(plan);
}
// ===== PAIEMENT — FONCTION UNIQUE =====
function resetStripePayButtons() {
    const payBtn = document.getElementById('pay-btn');
    const modalPayBtn = document.getElementById('modalPayBtn');
    if(payBtn) { payBtn.disabled = false; payBtn.textContent = payBtn.dataset.defaultLabel || '🔒 Payer'; }
    if(modalPayBtn) { modalPayBtn.disabled = false; modalPayBtn.textContent = modalPayBtn.dataset.defaultLabel || '🔒 Activer mon plan →'; }
}

async function handlePlanSelection(plan) {
    const btn = document.getElementById('pay-btn') || document.getElementById('modalPayBtn');
    if(btn) {
        if(!btn.dataset.defaultLabel) btn.dataset.defaultLabel = btn.textContent.trim();
        btn.textContent = '⏳ Redirection Stripe...';
        btn.disabled = true;
    }

    try {
        let email = td.email || '';
        if(!email && sb) {
            const { data: { user } } = await sb.auth.getUser();
            if(user) email = user.email;
        }
        if(!email) {
            alert('Email requis ! Connecte-toi ou passe par le tunnel avec ton email.');
            resetStripePayButtons();
            return;
        }

        const rawPartner = localStorage.getItem('nexa_partner_id');
        const clientStripeConnectId = (rawPartner && rawPartner.startsWith('acct_')) ? rawPartner : null;

        if(sb && email) {
            await saveUserToDB({
                email,
                prenom: td.prenom || email.split('@')[0],
                business: td.business || '',
                plan: plan.replace('-once',''),
                tiktok_pseudo: td.tiktok || '',
                store_url: CLIENT_STORE_URL || ''
            });
        }

        const res = await fetch(STRIPE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan,
                email,
                clientStripeConnectId,
                success_url: window.location.origin + window.location.pathname + '?payment=success&plan=' + encodeURIComponent(plan),
                cancel_url: window.location.origin + window.location.pathname + '?payment=cancel'
            })
        });

        const raw = await res.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch(parseErr) {
            throw new Error(res.ok ? 'Réponse invalide du serveur' : 'Erreur ' + res.status + ' — vérifie la function Netlify stripe-checkout.');
        }
        if(!res.ok) {
            throw new Error(data.error || ('HTTP ' + res.status));
        }
        if(data.url) {
            localStorage.setItem('nexaai_pending_plan', plan);
            window.location.href = data.url;
            return;
        }
        throw new Error(data.error || 'Pas d\'URL de paiement renvoyée');
    } catch(err) {
        resetStripePayButtons();
        alert('Erreur : ' + (err && err.message ? err.message : String(err)));
    }
}

// Alias pour compatibilité avec les boutons existants
function processPayment() { handlePlanSelection(currentPlan || 'starter'); }


function goStep2() {
    const p = document.getElementById('t-prenom').value.trim();
    const e = document.getElementById('t-email').value.trim();
    if(!p || !e) { alert('Merci de remplir ton prénom et ton email !'); return; }
    td.prenom = p; td.email = e;
    // CORRECTION: null-checks champs tunnel step 1
    const elTPhone = document.getElementById('t-phone');
    const elTPays = document.getElementById('t-pays');
    td.phone = elTPhone ? elTPhone.value : '';
    td.pays = elTPays ? elTPays.value : '';
    showPage('step2');
}

function goStep3() {
    const b = document.getElementById('t-business').value.trim();
    if(!b) { alert('Merci d\'indiquer le nom de ton business !'); return; }
    td.business = b;
    // CORRECTION: null-checks champs tunnel step 2
    const elTDms = document.getElementById('t-dms');
    const elTObj = document.getElementById('t-objectif');
    td.dms = elTDms ? elTDms.value : '';
    td.objectif = elTObj ? elTObj.value : '';
    showPage('step3');
}

function pickOpt(el, group, val) {
    el.closest('.option-grid').querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    td[group] = val;
}

function connectNet(platform) {
    const btn = document.getElementById(platform + '-btn');
    const status = document.getElementById(platform + '-status');
    // CORRECTION: null-check pour éviter crash si éléments absents du DOM
    if(!btn || !status) return;
    btn.style.opacity = '0.6';
    setTimeout(() => {
        btn.classList.add('connected');
        btn.style.opacity = '1';
        status.textContent = '✓ Connecté';
        status.className = 'platform-status status-ok';
        if(!connected.includes(platform)) connected.push(platform);
        td[platform] = true;
    }, 1500);
}

function fmtCard(i) { let v = i.value.replace(/\D/g,''); i.value = v.match(/.{1,4}/g)?.join(' ') || v; }
function fmtExp(i) { let v = i.value.replace(/\D/g,''); if(v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2,4); i.value = v; }



// ===== DASHBOARD =====
async function loadDashboard(user) {
    if(!user) user = JSON.parse(localStorage.getItem('nexaai_user') || 'null');
    if(!user) return;
    // Recharger les prospects depuis Supabase si dispo
    if(sb && user.id) {
        const prospects = await loadProspectsFromDB(user.id);
        if(prospects.length) user.prospects = prospects;
    }
    const elWelcome = document.getElementById('dash-welcome'); if(elWelcome) elWelcome.textContent = `Bienvenue ${user.prenom} 🎯`;
    const elProspects = document.getElementById('st-prospects'); if(elProspects) elProspects.textContent = user.prospects?.length || 0;
    const elMsgs = document.getElementById('st-msgs'); if(elMsgs) elMsgs.textContent = (user.prospects?.length || 0) * 3;
    const elRate = document.getElementById('st-rate'); if(elRate) elRate.textContent = '27%';
    // Calcul du revenu estimé depuis les prospects closés
    const closedCount = (user.prospects || []).filter(p => p.status === 'closed').length;
    const planRevenue = { starter: 39, pro: 94, business: 194, elite: 494, free: 0 };
    const revenueEstimate = closedCount * (planRevenue[user.plan] || 0);
    // CORRECTION: null-check sur st-revenue
    const elRevenue = document.getElementById('st-revenue');
    if(elRevenue) elRevenue.textContent = '€' + revenueEstimate;
    // Badges
    const badges = document.getElementById('platform-badges');
    // CORRECTION: null-check sur badges avant innerHTML
    if(badges) badges.innerHTML = '';
    if(badges && user.platforms?.includes('tiktok')) badges.innerHTML += '<span style="background:rgba(57,255,20,0.1);border:1px solid var(--accent);color:var(--accent);padding:6px 14px;border-radius:20px;font-size:0.8rem;font-weight:700;">🎵 TikTok connecté</span>';
    if(badges && user.platforms?.includes('instagram')) badges.innerHTML += '<span style="background:rgba(57,255,20,0.1);border:1px solid var(--accent);color:var(--accent);padding:6px 14px;border-radius:20px;font-size:0.8rem;font-weight:700;">📸 Instagram connecté</span>';
    // Settings
    const elPrenom = document.getElementById('s-prenom'); if(elPrenom) elPrenom.value = user.prenom || '';
    const elEmail = document.getElementById('s-email'); if(elEmail) elEmail.value = user.email || '';
    const elBusiness = document.getElementById('s-business'); if(elBusiness) elBusiness.value = user.business || '';
    const planNames = {starter:'Starter',pro:'Pro 🎯',business:'Business 💼',elite:'Elite 👑',free:'Gratuit'};
    const planPrices = {
        starter:'€39/mois', 'starter-once':'€390 (unique)',
        pro:'€94/mois',     'pro-once':'€940 (unique)',
        business:'€194/mois','business-once':'€1940 (unique)',
        elite:'€494/mois',  'elite-once':'€4940 (unique)',
        free:'—'
    };
    const elPlan = document.getElementById('s-plan'); if(elPlan) elPlan.textContent = planNames[user.plan] || 'Starter';
    const elPrice = document.getElementById('s-price'); if(elPrice) elPrice.textContent = planPrices[user.plan] || '€39/mois';
    // Prospects
    loadProspects(user.prospects || []);
    // Message d'accueil Nexa personnalisé dans le dashboard
    const welcomeMsg = document.getElementById('dash-welcome-msg');
    if(welcomeMsg) {
        welcomeMsg.innerHTML = 'Salut ' + (user.prenom||'') + ' ! 👋 Je suis Nexa, ton agent IA personnel.<br><br>Je connais ton business <strong>' + (user.business||'') + '</strong> par coeur. Je suis la pour t\'aider a closer plus, optimiser tes messages et faire grandir tes revenus.<br><br>On attaque quoi aujourd\'hui ?';
    }
    const navOverview = document.querySelector('.sidebar-menu a[data-dash="overview"]');
    if(navOverview) showDash('overview', navOverview);
}

function loadProspects(list) {
    const tbody = document.getElementById('prospects-body');
    if(!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:40px;">Aucun prospect pour l\'instant. Le bot commence d\u00e8s que tes r\u00e9seaux sont connect\u00e9s !</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(p => `
        <tr>
            <td>${p.name}</td><td>${p.network}</td>
            <td><span class="badge ${p.status==='closed'?'badge-green':'badge-orange'}">${p.status==='closed'?'✓ Closé':'⏳ En cours'}</span></td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-light);font-size:0.82rem;">${p.lastMsg||'—'}</td>
            <td style="color:var(--text-light);font-size:0.82rem;">${new Date(p.date).toLocaleDateString('fr-FR')}</td>
        </tr>`).join('');
}

function showDash(section, el) {
    document.querySelectorAll('[id^="d-"]').forEach(s => s.style.display = 'none');
    // CORRECTION: null-check sur la section cible
    const elSection = document.getElementById('d-' + section);
    if(elSection) elSection.style.display = 'block';
    document.querySelectorAll('.sidebar-menu a').forEach(a => a.classList.remove('active'));
    if(el) el.classList.add('active');
}

async function saveSettings() {
    const user = JSON.parse(localStorage.getItem('nexaai_user') || '{}');
    // CORRECTION: null-checks sur tous les champs settings
    const elSPrenom = document.getElementById('s-prenom');
    const elSEmail = document.getElementById('s-email');
    const elSBusiness = document.getElementById('s-business');
    const elSType = document.getElementById('s-type');
    user.prenom = elSPrenom ? elSPrenom.value : (user.prenom || '');
    user.email = elSEmail ? elSEmail.value : (user.email || '');
    user.business = elSBusiness ? elSBusiness.value : (user.business || '');
    user.type_business = elSType ? elSType.value : (user.type_business || '');

    // Sauvegarder dans Supabase
    await saveUserToDB({
        email: user.email,
        prenom: user.prenom,
        business: user.business,
        type_business: user.type_business,
        plan: user.plan || 'free',
        platforms: user.platforms || []
    });

    // Mettre à jour localStorage
    localStorage.setItem('nexaai_user', JSON.stringify(user));

    const btn = document.getElementById('sSaveBtn');
    btn.textContent = '✅ Sauvegardé !';
    setTimeout(() => { btn.textContent = 'Sauvegarder'; }, 2000);
}

// ===== AUTH =====
async function register() {
    const email = document.getElementById('regEmail').value.trim();
    const pwd = document.getElementById('regPwd').value.trim();
    const pwd2 = document.getElementById('regPwd2').value.trim();

    if(!email || !pwd) { alert('Merci de remplir tous les champs !'); return; }
    if(pwd !== pwd2) { alert('Les mots de passe ne correspondent pas !'); return; }
    if(pwd.length < 6) { alert('Le mot de passe doit faire au moins 6 caractères !'); return; }

    const btn = document.getElementById('regBtn');
    btn.textContent = '⏳ Création...'; btn.disabled = true;

    if(!sb) { alert('Erreur de connexion, rechargez la page'); btn.textContent = 'Créer mon compte'; btn.disabled = false; return; }

    // Créer le compte Supabase Auth
    const { data, error } = await sb.auth.signUp({ email, password: pwd });
    if(error) {
        alert('Erreur : ' + error.message);
        btn.textContent = 'Créer mon compte'; btn.disabled = false;
        return;
    }

    // Créer le profil dans la table users
    const newUser = {
        email,
        prenom: email.split('@')[0],
        plan: 'free',
        platforms: [],
        status: 'actif'
    };
    await saveUserToDB(newUser);

    // Garder aussi en localStorage pour l'admin
    const localUser = { ...newUser, id: Date.now(), createdAt: new Date().toISOString(), prospects: [] };
    const users = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
    if(!users.find(u => u.email === email)) { users.push(localUser); localStorage.setItem('nexaai_users', JSON.stringify(users)); }
    localStorage.setItem('nexaai_user', JSON.stringify(localUser));
    td.email = email;

    btn.textContent = 'Créer mon compte'; btn.disabled = false;
    showPage('bot-qualify');
    setTimeout(() => botQualifyStart(email), 300);
}

async function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const pwd = document.getElementById('loginPassword').value.trim();
    if(!email || !pwd) { alert('Merci de remplir tous les champs !'); return; }

    const btn = document.querySelector('#login .btn-primary');
    if(btn) { btn.textContent = '⏳ Connexion...'; btn.disabled = true; }

    if(!sb) { alert('Erreur de connexion, rechargez la page'); return; }

    const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });

    if(error) {
        alert('Email ou mot de passe incorrect.');
        if(btn) { btn.textContent = 'Se connecter'; btn.disabled = false; }
        return;
    }

    if(btn) { btn.textContent = 'Se connecter'; btn.disabled = false; }

    // Charger le profil depuis Supabase
    const userData = await loadUserFromDB(email);
    if(userData) {
        const prospects = await loadProspectsFromDB(userData.id);
        const user = { ...userData, prospects };
        localStorage.setItem('nexaai_user', JSON.stringify(user));
        loadDashboard(user);
        showPage('dashboard-page');
    } else {
        // Profil pas encore créé → tunnel de qualification
        td.email = email;
        showPage('bot-qualify');
        setTimeout(() => botQualifyStart(email), 300);
    }
}

function logout() { signOut(); }

// ===== ADMIN =====
const ADMIN_PWD = null; // Mot de passe vérifié côté Netlify Functions
let allUsers = [];

function openAdminLogin() {
    // CORRECTION: null-checks admin modal
    const alm = document.getElementById('adminLoginModal');
    if(alm) alm.style.display = 'flex';
    setTimeout(() => { const ap = document.getElementById('adminSecretPwd'); if(ap) ap.focus(); }, 100);
}
function closeAdminLogin() {
    // CORRECTION: null-checks
    const alm = document.getElementById('adminLoginModal');
    if(alm) alm.style.display = 'none';
    const asp = document.getElementById('adminSecretPwd');
    if(asp) asp.value = '';
}
async function checkAdminLogin() {
    const pwd = document.getElementById('adminSecretPwd').value;
    if(!pwd) return;
    try {
        const res = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminAuth: true, password: pwd })
        });
        const data = await res.json();
        if(data.ok) {
            closeAdminLogin();
            // CORRECTION: null-checks
            const apanel = document.getElementById('adminPanel');
            if(apanel) apanel.style.display = 'block';
            document.body.style.overflow = 'hidden';
            loadAdminData();
        } else {
            const aspErr = document.getElementById('adminSecretPwd');
            if(aspErr) {
                aspErr.style.borderColor = '#ff4444';
                setTimeout(() => { aspErr.style.borderColor = 'var(--border)'; }, 1000);
                aspErr.value = '';
            }
        }
    } catch(e) { alert('Erreur de connexion'); }
}
function closeAdminPanel() {
    // CORRECTION: null-check
    const ap = document.getElementById('adminPanel');
    if(ap) ap.style.display = 'none';
    document.body.style.overflow = '';
}


// ===== NOUVELLES FONCTIONS ADMIN =====

function viewUserDetail(email) {
    const user = allUsers.find(u => u.email === email);
    if(!user) return;
    const modal = document.getElementById('userDetailModal');
    const content = document.getElementById('userDetailContent');
    const planNames = {starter:'Starter',pro:'Pro 🎯',business:'Business 💼',elite:'Elite 👑',free:'Gratuit'};
    const date = new Date(user.created_at || user.createdAt || Date.now()).toLocaleDateString('fr-FR');

    var rows = [
        ['Prenom', user.prenom || '-'],
        ['Email', user.email || '-'],
        ['Business', user.business || '-'],
        ['Type', user.type_business || '-'],
        ['TikTok', user.tiktok_pseudo || '-'],
        ['Niche', user.niche_tiktok || '-'],
        ['Followers', user.followers_tiktok || '-'],
        ['DMs/jour', user.dms_par_jour || '-'],
        ['Prix produit', user.prix_produit || '-'],
        ['Objectif', user.objectif || '-'],
        ['Forfait', planNames[user.plan] || 'Gratuit'],
        ['Date', date],
        ['Pays', user.pays || '-'],
        ['Prospects', (user.prospects || []).length]
    ];
    content.innerHTML = '<div style="display:grid;gap:12px;">' + rows.map(function(r){ return row(r[0], r[1]); }).join('') + '</div>';

    modal.style.display = 'flex';
}

function row(label, value) {
    return '<div style="display:flex;justify-content:space-between;padding:10px;background:#000;border-radius:8px;">' +
        '<span style="color:var(--text-light);font-size:0.85rem;">' + label + '</span>' +
        '<span style="color:var(--text);font-weight:600;font-size:0.85rem;">' + value + '</span>' +
        '</div>';
}

function closeUserDetail() {
    // CORRECTION: null-check
    const udm = document.getElementById('userDetailModal');
    if(udm) udm.style.display = 'none';
}

async function toggleSuspend(email, isSuspended) {
    const newStatus = isSuspended ? 'actif' : 'suspended';
    if(!isSuspended && !confirm('Suspendre le compte de ' + email + ' ?')) return;

    if(sb) await sb.from('users').update({ status: newStatus }).eq('email', email);

    allUsers = allUsers.map(u => u.email === email ? {...u, status: newStatus} : u);
    const local = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
    const updated = local.map(u => u.email === email ? {...u, status: newStatus} : u);
    localStorage.setItem('nexaai_users', JSON.stringify(updated));

    renderAdminStats(allUsers);
    // CORRECTION: null-check admin-search
    const adminSearch = document.getElementById('admin-search');
    filterAdminUsers(adminSearch ? adminSearch.value : '');
}

async function sendAdminMessage() {
    const email = document.getElementById('msg-email').value.trim();
    const msg = document.getElementById('msg-content').value.trim();
    if(!msg) { alert('Écris un message !'); return; }

    // Sauvegarder le message dans Supabase
    if(sb) {
        if(email) {
            const { data: userRow } = await sb.from('users').select('id').eq('email', email).single();
            if(userRow) {
                await sb.from('prospects').insert([{
                    user_id: userRow.id,
                    nom: 'Message Admin',
                    statut: 'message',
                    dernier_message: msg
                }]);
            }
        }
    }

    // CORRECTION: null-checks sur les champs admin message
    const elMsgContent = document.getElementById('msg-content');
    const elMsgEmail = document.getElementById('msg-email');
    if(elMsgContent) elMsgContent.value = '';
    if(elMsgEmail) elMsgEmail.value = '';
    alert('✅ Message envoyé' + (email ? ' à ' + email : ' à tous les clients') + ' !');
}

function exportCSV() {
    const headers = ['Prénom','Email','Business','Type','TikTok','Forfait','Inscrit','Prospects','Statut'];
    const planNames = {starter:'Starter',pro:'Pro',business:'Business',elite:'Elite',free:'Gratuit'};
    const rows = allUsers.map(u => [
        u.prenom || '',
        u.email || '',
        u.business || '',
        u.type_business || '',
        u.tiktok_pseudo || '',
        planNames[u.plan] || 'Gratuit',
        new Date(u.created_at || u.createdAt || Date.now()).toLocaleDateString('fr-FR'),
        (u.prospects || []).length,
        u.status || 'actif'
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexaai_clients_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

async function loadAdminData() {
    // Charger depuis Supabase en priorité
    if(sb) {
        const { data, error } = await sb.from('users').select('*, paiements(*)').order('created_at', { ascending: false });
        if(data && !error) {
            allUsers = data.map(u => ({
                ...u,
                createdAt: u.created_at,
                prospects: []
            }));
            // Fusionner avec localStorage pour avoir les prospects
            const local = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
            allUsers = allUsers.map(u => {
                const loc = local.find(l => l.email === u.email);
                return loc ? { ...u, prospects: loc.prospects || [] } : u;
            });
            renderAdminStats(allUsers);
            renderAdminUsers(allUsers);
            return;
        }
    }
    // Fallback localStorage
    allUsers = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
    allUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    renderAdminStats(allUsers);
    renderAdminUsers(allUsers);
}

// Rafraîchir automatiquement toutes les 10s si le panel est ouvert
setInterval(() => {
    if(document.getElementById('adminPanel').style.display === 'block') {
        loadAdminData();
    }
}, 10000);

function renderAdminStats(users) {
    const total = users.length;
    const paying = users.filter(u => u.plan && u.plan !== 'free').length;
    const free = users.filter(u => !u.plan || u.plan === 'free').length;
    const suspended = users.filter(u => u.status === 'suspended').length;

    // MRR
    const planPrices = {starter:39, pro:94, business:194, elite:494};
    const mrr = users.filter(u => u.plan && u.plan !== 'free')
        .reduce((sum, u) => sum + (planPrices[u.plan] || 0), 0);

    // Inscrits aujourd'hui
    const today = new Date().toDateString();
    const newToday = users.filter(u => {
        const d = new Date(u.created_at || u.createdAt);
        return d.toDateString() === today;
    }).length;

    // CORRECTION: null-checks sur tous les éléments stats admin
    const elATotal = document.getElementById('a-total'); if(elATotal) elATotal.textContent = total;
    const elAPaying = document.getElementById('a-paying'); if(elAPaying) elAPaying.textContent = paying;
    const elAFree = document.getElementById('a-free'); if(elAFree) elAFree.textContent = free;
    const elARevenue = document.getElementById('a-revenue'); if(elARevenue) elARevenue.textContent = '€' + mrr;
    const elANewToday = document.getElementById('a-new-today'); if(elANewToday) elANewToday.textContent = newToday;
    // CORRECTION: null-checks stats admin (suite)
    const elASusp = document.getElementById('a-suspended'); if(elASusp) elASusp.textContent = suspended;
    const elACount = document.getElementById('a-count'); if(elACount) elACount.textContent = '(' + total + ' clients)';
    const elALast = document.getElementById('a-last-update'); if(elALast) elALast.textContent = 'Mis à jour : ' + new Date().toLocaleTimeString('fr-FR');

    // Graphique revenus par mois
    renderRevenueChart(users);
}

function renderRevenueChart(users) {
    const chart = document.getElementById('revenue-chart');
    const labels = document.getElementById('revenue-chart-labels');
    if(!chart || !labels) return;

    const planPrices = {starter:39, pro:94, business:194, elite:494};
    const months = {};
    const now = new Date();

    // Générer les 6 derniers mois
    for(let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        months[key] = 0;
    }

    // Calculer les revenus par mois
    users.forEach(u => {
        if(!u.plan || u.plan === 'free') return;
        const d = new Date(u.created_at || u.createdAt || now);
        const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        if(months[key] !== undefined) months[key] += planPrices[u.plan] || 0;
    });

    const maxVal = Math.max(...Object.values(months), 1);
    const monthNames = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

    chart.innerHTML = '';
    labels.innerHTML = '';

    Object.entries(months).forEach(([key, val]) => {
        const height = Math.max((val / maxVal) * 100, 4);
        const month = parseInt(key.split('-')[1]) - 1;
        const bar = document.createElement('div');
        bar.style.cssText = 'flex:1;background:linear-gradient(to top,var(--accent),#2dd10f);border-radius:4px 4px 0 0;transition:height 0.5s;position:relative;cursor:default;min-width:30px;';
        bar.style.height = height + '%';
        bar.title = monthNames[month] + ' : €' + val;
        chart.appendChild(bar);

        const lbl = document.createElement('div');
        lbl.style.cssText = 'flex:1;text-align:center;color:var(--text-light);font-size:0.7rem;min-width:30px;';
        lbl.textContent = monthNames[month];
        labels.appendChild(lbl);
    });
}

function renderAdminUsers(users) {
    const tbody = document.getElementById('admin-users');
    if(!tbody) return;

    if(!users.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-light);padding:30px;">Aucun utilisateur trouvé</td></tr>';
        return;
    }

    const planColors = {starter:'var(--accent)',pro:'#60c8ff',business:'#a78bfa',elite:'gold',free:'#555'};
    const planNames = {starter:'Starter',pro:'Pro 🎯',business:'Business 💼',elite:'Elite 👑',free:'Gratuit'};

    tbody.innerHTML = '';
    users.forEach(u => {
        const plan = u.plan || 'free';
        const date = new Date(u.created_at || u.createdAt || Date.now());
        const dateStr = date.toLocaleDateString('fr-FR');
        const prospects = (u.prospects || []).length;
        const isSuspended = u.status === 'suspended';
        const statusColor = isSuspended ? '#ff4444' : (plan !== 'free' ? 'var(--accent)' : '#888');
        const statusLabel = isSuspended ? '🚫 Suspendu' : (plan !== 'free' ? '✅ Actif' : '⭕ Gratuit');

        var em = (u.email||'').replace(/'/g, '');
        var tr = document.createElement('tr');
        if(isSuspended) tr.style.opacity = '0.5';
        tr.innerHTML = [
            '<td style="font-weight:600;">' + (u.prenom||'-') + '</td>',
            '<td style="color:var(--text-light);font-size:0.82rem;">' + (u.email||'-') + '</td>',
            '<td style="color:var(--text-light);font-size:0.82rem;">' + (u.business||'-') + '</td>',
            '<td><span style="background:' + planColors[plan] + '22;color:' + planColors[plan] + ';padding:4px 10px;border-radius:20px;font-size:0.78rem;font-weight:700;">' + planNames[plan] + '</span></td>',
            '<td><select data-email="' + em + '" onchange="adminChangePlan(this,this.dataset.email)" style="padding:5px 8px;background:#000;border:1px solid var(--border);border-radius:6px;color:var(--text-light);font-size:0.8rem;cursor:pointer;">' +
                '<option value="free"' + (plan==='free'?' selected':'') + '>Gratuit</option>' +
                '<option value="starter"' + (plan==='starter'?' selected':'') + '>Starter</option>' +
                '<option value="pro"' + (plan==='pro'?' selected':'') + '>Pro</option>' +
                '<option value="business"' + (plan==='business'?' selected':'') + '>Business</option>' +
                '<option value="elite"' + (plan==='elite'?' selected':'') + '>Elite</option>' +
            '</select></td>',
            '<td style="color:var(--text-light);font-size:0.82rem;">' + dateStr + '</td>',
            '<td style="text-align:center;color:var(--accent);font-weight:700;">' + prospects + '</td>',
            '<td><span style="color:' + statusColor + ';font-size:0.8rem;">' + statusLabel + '</span></td>',
            '<td><div style="display:flex;gap:6px;">' +
                '<button data-email="' + em + '" onclick="viewUserDetail(this.dataset.email)" style="padding:5px 10px;background:transparent;border:1px solid var(--accent);color:var(--accent);border-radius:6px;cursor:pointer;font-size:0.75rem;">👁</button>' +
                '<button data-email="' + em + '" data-susp="' + (isSuspended?1:0) + '" onclick="toggleSuspend(this.dataset.email,this.dataset.susp==1)" style="padding:5px 10px;background:transparent;border:1px solid ' + (isSuspended?'var(--accent)':'#ff4444') + ';color:' + (isSuspended?'var(--accent)':'#ff4444') + ';border-radius:6px;cursor:pointer;font-size:0.75rem;">' + (isSuspended?'✅':'🚫') + '</button>' +
                // CORRECTION : bouton excludeUser branché
                '<button data-email="' + em + '" onclick="excludeUser(this.dataset.email)" style="padding:5px 10px;background:transparent;border:1px solid #888;color:#888;border-radius:6px;cursor:pointer;font-size:0.75rem;" title="Exclure">🗑</button>' +
            '</div></td>'
        ].join('');
        tbody.appendChild(tr);
    });
}

function filterAdminUsers(search) {
    const filter = document.getElementById('admin-filter').value;
    let filtered = allUsers.filter(u =>
        (u.email || '').toLowerCase().includes((search || '').toLowerCase()) ||
        (u.prenom || '').toLowerCase().includes((search || '').toLowerCase())
    );
    if(filter === 'paying') filtered = filtered.filter(u => u.plan && u.plan !== 'free');
    else if(filter === 'free') filtered = filtered.filter(u => !u.plan || u.plan === 'free');
    else if(filter === 'suspended') filtered = filtered.filter(u => u.status === 'suspended');
    else if(['starter','pro','business','elite'].includes(filter)) filtered = filtered.filter(u => u.plan === filter);
    renderAdminUsers(filtered);
}

async function adminChangePlan(sel, email) {
    const newPlan = sel.value;
    // Mettre à jour Supabase
    if(sb) {
        await sb.from('users').update({ plan: newPlan }).eq('email', email);
    }
    // Mettre à jour localStorage
    const users = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
    const i = users.findIndex(u => u.email === email);
    if(i !== -1) {
        users[i].plan = newPlan;
        localStorage.setItem('nexaai_users', JSON.stringify(users));
    }
    allUsers = allUsers.map(u => u.email === email ? {...u, plan: newPlan} : u);
    renderAdminStats(allUsers);
    // Feedback visuel
    sel.style.borderColor = 'var(--accent)';
    setTimeout(() => sel.style.borderColor = '#333', 1500);
}

function excludeUser(email) {
    if(!confirm(`⚠️ Exclure ${email} du site ? Cette action est irréversible.`)) return;
    let users = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
    users = users.filter(u => u.email !== email);
    localStorage.setItem('nexaai_users', JSON.stringify(users));
    allUsers = users;
    renderAdminStats(users);
    renderAdminUsers(users);
}

function giveAccess(event) {
    const email = document.getElementById('gift-email').value.trim();
    const plan = document.getElementById('gift-plan').value;
    if(!email) { alert('Entre un email !'); return; }
    const users = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
    const i = users.findIndex(u => u.email === email);
    if(i !== -1) { users[i].plan = plan; }
    else { users.push({id:Date.now(), prenom:email.split('@')[0], email, plan, createdAt:new Date().toISOString(), prospects:[], platforms:[]}); }
    localStorage.setItem('nexaai_users', JSON.stringify(users));
    // CORRECTION: null-check gift-email
    const ge = document.getElementById('gift-email'); if(ge) ge.value = '';
    allUsers = users;
    renderAdminStats(users);
    renderAdminUsers(users);
    // CORRECTION : utiliser getElementById pour éviter crash si event est undefined
    const btn = (event && event.target) ? event.target : document.querySelector('[onclick*="giveAccess"]');
    if(btn) {
        btn.textContent = '✅ Activé !';
        btn.style.background = '#fff';
        setTimeout(() => { btn.textContent = '🎁 Activer'; btn.style.background = 'var(--accent)'; }, 2000);
    }
}

// ===== CLAUDE SYSTEM PROMPT =====
const SYS = `Tu t'appelles Nexa. Tu es une IA closer commerciale de haut niveau pour NexaAI. Tu ne mentionnes jamais Claude ni Anthropic — tu es Nexa, point.

NOS FORFAITS (à respecter strictement selon le volume de DMs) :
- Starter : €39/mois (ou €390 paiement unique = 2 mois offerts) — 10 prospects contactés/jour, messages automatisés, dashboard, support email
- Pro : €94/mois (ou €940 paiement unique = 2 mois offerts) — 80 prospects/jour, messages ultra-personnalisés, dashboard avancé, support 24/7, API
- Business : €194/mois (ou €1940 paiement unique = 2 mois offerts) — 300 prospects/jour, 200 messages bot/jour, support prioritaire 24/7
- Elite : €494/mois (ou €4940 paiement unique = 2 mois offerts) — 750 prospects/jour, messages bot illimités, account manager dédié

TUNNEL DE VENTE EN 5 ÉTAPES — tu suis ce fil sans jamais le perdre :

ÉTAPE 1 — CRÉER LE LIEN :
Tu te présentes chaleureusement. Une seule question courte pour briser la glace. Pas de pitch, pas de vente. Juste du lien humain.

ÉTAPE 2 — COMPRENDRE LE BUSINESS (une question à la fois) :
Identifie d'abord sa catégorie de business parmi ces 3 :

► E-COMMERCE : vente en ligne, dropshipping, produits physiques/digitaux
→ Collecte : produit vendu, plateforme (Shopify/TikTok Shop...), panier moyen, objectif CA

► FORMATION / MRR / AFFILIATION : coaching, programmes, memberships, affiliation
→ Collecte : sujet de la formation, format, prix de vente, nombre d'élèves actuels, objectif revenus

► SAAS : logiciel, outil, application, abonnement
→ Collecte : ce que résout le SaaS, pricing mensuel, MRR actuel, objectif MRR

Utilise tes connaissances sur chaque type de business pour poser des questions intelligentes.
Une seule question à la fois. Reformule après chaque réponse.

ÉTAPE 3 — COMPRENDRE SA PRÉSENCE TIKTOK (une question à la fois) :
Collecte : son pseudo TikTok (@...), sa niche/type de contenu, nombre de followers approximatif, combien de DMs il reçoit par jour sans pouvoir y répondre.
Montre que tu comprends sa situation TikTok.

ÉTAPE 4 — CRÉER L'URGENCE ET CLOSER :
Utilise tout ce que tu sais sur son business et son TikTok. Calcule avec lui ce qu'il perd chaque jour : X DMs/jour × son prix de vente = X€ perdus par semaine. Crée l'urgence naturellement, sans mentir. Traite les objections calmement avec des réponses courtes et percutantes.

ÉTAPE 5 — RECOMMANDER LE BON FORFAIT ET CLOSER :
Recommande le forfait adapté à son volume de DMs :
- 0-10 DMs/jour → Starter (10 prospects/jour, €39/mois)
- 11-80 DMs/jour → Pro (80 prospects/jour, €94/mois)
- 81-300 DMs/jour → Business (300 prospects/jour, €194/mois)
- 300+ DMs/jour → Elite (750 prospects/jour, €494/mois)
Explique POURQUOI ce forfait précisément, en lien direct avec son business et son TikTok. Puis ajoute "REDIRECT" à la fin.

TON COMPORTEMENT :
- Messages courts, humains, percutants — jamais de pavés (max 3-4 lignes)
- S'il est froid : tu écoutes, tu reformules, tu ne pitches pas directement
- S'il est chaud : tu vas droit au but, tu pousses vers la décision
- Tu utilises la preuve sociale, la rareté, la peur de rater
- Tu t'adaptes en temps réel, jamais de script fixe
- Chaque message rapproche le prospect d'une décision

RÔLE AGENT DE VENTE TIKTOK :
Quand tu prospectes pour un client, tu connais son business et son lien de vente. Tu pousses les prospects vers ce lien. Tu utilises la preuve sociale, l urgence et la rareté pour convaincre. Tu fermes la vente — c est ton seul objectif.

RÈGLES ABSOLUES :
- Max 3-4 lignes par message, jamais de pavé
- Toujours en français
- Jamais mentionner Claude ou Anthropic — tu es Nexa, une IA NexaAI
- Tu ne parles QUE de NexaAI et du business du prospect
- Si la conversation dérive, tu la ramènes naturellement vers son projet`;



// ===== FLOATING CHAT =====
function toggleChat() {
    chatOpen = !chatOpen;
    const win = document.getElementById('chatWindow');
    win.style.display = chatOpen ? 'flex' : 'none';
    if(chatOpen && chatHist.length === 0) {
        addMsg('ai', "Salut 👋 Moi c'est Nexa.\n\nJe vais être directe — en combien de temps tu veux automatiser ta prospection ?", [
            '⚡ Le plus vite possible', '📅 Ce mois-ci', '🤔 Je cherche encore', '💬 Explique-moi d\'abord'
        ]);
    }
}

function addMsg(type, text, opts=[]) {
    const msgs = document.getElementById('chatMsgs');
    const optHtml = opts.length ? `<div class="chat-opts-row">${opts.map(o=>`<button class="copt" onclick="optClick('${o.replace(/'/g,"\\'")}')">${o}</button>`).join('')}</div>` : '';
    const d = document.createElement('div');
    d.className = type==='ai' ? 'cmsg-ai' : 'cmsg-user';
    d.innerHTML = text.replace(/\n/g,'<br>') + optHtml;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
}

function optClick(opt) { sendChatMsg(opt); }


let awaitingAdminPwd = false;
let dashChatHist = []; // historique du chat dashboard pour la mémoire de contexte

async function sendChatMsg(text) {
    // Détecter "admin" pour accès admin via chatbot
    if(text.toLowerCase().trim() === 'admin' && !awaitingAdminPwd) {
        addMsg('user', text);
        awaitingAdminPwd = true;
        setTimeout(() => addMsg('ai', '🔐 Accès admin détecté. Entre le mot de passe pour continuer :'), 400);
        return;
    }
    if(awaitingAdminPwd) {
        addMsg('user', '••••••');
        // Vérification admin via Netlify (function claude)
        fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminAuth: true, password: text.trim() })
        }).then(r => r.json()).then(data => {
            awaitingAdminPwd = false;
            if(data.ok) {
                addMsg('ai', '✅ Accès accordé ! Ouverture du panel admin...');
                setTimeout(() => {
                    toggleChat();
                    // CORRECTION: null-check adminPanel
                    const ap1233 = document.getElementById('adminPanel');
                    if(ap1233) ap1233.style.display = 'block';
                    document.body.style.overflow = 'hidden';
                    loadAdminData();
                }, 800);
            } else {
                addMsg('ai', '❌ Mot de passe incorrect. Réessaie !');
            }
        }).catch(() => {
            awaitingAdminPwd = false;
            addMsg('ai', '❌ Erreur de connexion. Réessaie !');
        });
        return;
    }

    addMsg('user', text);
    chatHist.push({role:'user', content:text});
    // CORRECTION: null-checks typingBubble et chatMsgs
    const tb = document.getElementById('typingBubble');
    const cm = document.getElementById('chatMsgs');
    if(tb) tb.style.display = 'block';
    if(cm) cm.scrollTop = 99999;
    try {
        const res = await fetch(PROXY_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                model:CLAUDE_MODEL,
                max_tokens:400,
                system: SYS + (CLIENT_STORE_URL ? '\n\nLien de vente du client : ' + CLIENT_STORE_URL : ''),
                messages:chatHist
            })
        });
        const data = await res.json();
        // CORRECTION: null-check typingBubble
        const tb2 = document.getElementById('typingBubble');
        if(tb2) tb2.style.display = 'none';
        if(data.content?.[0]) {
            let reply = data.content[0].text;
            chatHist.push({role:'assistant',content:reply});
            if(reply.includes('REDIRECT')) {
                reply = reply.replace('REDIRECT','');
                addMsg('ai', reply.trim());
                setTimeout(() => { toggleChat(); const pr = document.getElementById('pricing'); if(pr) pr.scrollIntoView({behavior:'smooth'}); }, 1500);
                return;
            }
            let opts = [];
            const lower = reply.toLowerCase();
            if(lower.includes('elite')) opts = ['👑 Je prends l\'Elite','💼 C\'est quoi le Business ?','❓ Question'];
            else if(lower.includes('business')) opts = ['💼 Je prends le Business','🚀 C\'est quoi le Pro ?','❓ Question'];
            else if(lower.includes('starter') && lower.includes('pro')) opts = ['🚀 Starter — €39/mois','💎 Pro — €94/mois','❓ Question'];
            else if(lower.includes('starter')) opts = ['✅ Je prends le Starter','💎 C\'est quoi le Pro ?'];
            else if(lower.includes('pro')) opts = ['🔥 Je prends le Pro !','🔰 Le Starter suffit ?'];
            addMsg('ai', reply, opts);
            const lower2 = text.toLowerCase();
            if(lower2.includes('starter')) setTimeout(()=>{toggleChat();startTunnel('starter');},800);
            else if(lower2.includes('elite')) setTimeout(()=>{toggleChat();startTunnel('elite');},800);
            else if(lower2.includes('business')) setTimeout(()=>{toggleChat();startTunnel('business');},800);
            else if(lower2.includes('pro')) setTimeout(()=>{toggleChat();startTunnel('pro');},800);
        }
    } catch(err) {
        // CORRECTION: null-check typingBubble dans catch
        const tb3 = document.getElementById('typingBubble');
        if(tb3) tb3.style.display = 'none';
        addMsg('ai','Connexion instable, réessaie ! 🔄');
    }
}

// ===== DASH BOT CHAT =====
async function sendDashMsg() {
    const inp = document.getElementById('dash-input');
    // CORRECTION: null-checks inp et msgs
    if(!inp) return;
    const text = inp.value.trim();
    if(!text) return;
    inp.value = '';
    const msgs = document.getElementById('dash-msgs');
    if(!msgs) return;
    const ud = document.createElement('div');
    ud.className = 'dash-msg-user';
    ud.textContent = text;
    msgs.appendChild(ud);
    msgs.scrollTop = msgs.scrollHeight;
    try {
        const user = JSON.parse(localStorage.getItem('nexaai_user') || '{}');
        const nr = 'Non renseigne';
        const ctx = 'PROFIL CLIENT - Prenom: ' + (user.prenom||nr)
            + ' | Business: ' + (user.business||nr)
            + ' | Type: ' + (user.type_business||nr)
            + ' | Produit: ' + (user.produit||nr)
            + ' | Prix: ' + (user.prix_produit||nr)
            + ' | Cible: ' + (user.cible_client||nr)
            + ' | TikTok: ' + (user.tiktok_pseudo||nr)
            + ' | Niche: ' + (user.niche_tiktok||nr)
            + ' | Followers: ' + (user.followers_tiktok||nr)
            + ' | DMs/jour: ' + (user.dms_par_jour||nr)
            + ' | Objectif: ' + (user.objectif||nr)
            + ' | Plan: ' + (user.plan||'free')
            + ' | Pays: ' + (user.pays||nr)
            + ' | En tant que Nexa agent IA personnel, utilise ces infos pour conseiller ultra-personnalise, aider a rediger des messages de closing, calculer le potentiel de revenus et motiver avec des donnees concretes.';
        const fullSystem = SYS + '\n\nContexte client: ' + ctx;
        dashChatHist.push({ role: 'user', content: text });
        const res = await fetch(PROXY_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({model:CLAUDE_MODEL,max_tokens:400,system:fullSystem,messages:dashChatHist})
        });
        const data = await res.json();
        if(data.content?.[0]) {
            const replyText = data.content[0].text;
            dashChatHist.push({ role: 'assistant', content: replyText });
            const ad = document.createElement('div');
            ad.className = 'dash-msg-ai';
            ad.innerHTML = replyText.replace(/\n/g,'<br>');
            msgs.appendChild(ad);
            msgs.scrollTop = msgs.scrollHeight;
        }
    } catch(err) {
        const ed = document.createElement('div');
        ed.className = 'dash-msg-ai';
        ed.textContent = 'Connexion instable, réessaie !';
        msgs.appendChild(ed);
    }
}

// ===== BOT QUALIFICATION =====
let bqHist = [];
let bqStep = 0;
let bqData = {};

const BQ_PROMPT = `Tu t'appelles Nexa. Tu es l'IA personnelle de NexaAI. Tu ne mentionnes jamais Claude ni Anthropic.
Tu viens de rencontrer un nouvel utilisateur. Tu vas le qualifier en 5 étapes.

FORFAITS :
- Starter : €39/mois — 10 prospects/jour
- Pro : €94/mois — 80 prospects/jour
- Business : €194/mois — 300 prospects/jour
- Elite : €494/mois — 750 prospects/jour
- Ambassadeur : €0 (Affiliation 80/20)

ÉTAPE 1 : Prénom.
ÉTAPE 2 : Business (Nom, Produit, Prix, Cible).
ÉTAPE 3 : TikTok (Pseudo, Followers, DMs/jour).
ÉTAPE 4 : Calculer le manque à gagner (Urgence).
ÉTAPE 5 : Recommander le forfait. Termine par "CHOIX_FORFAIT".`;

function botQualifyStart(email) {
    bqHist = [];
    bqStep = 0;
    bqData = { email };
    // CORRECTION: null-checks éléments bot qualify
    const bqMsgsEl = document.getElementById('bq-msgs');
    const bqOptsEl = document.getElementById('bq-opts');
    const bqProgEl = document.getElementById('bq-progress');
    if(bqMsgsEl) bqMsgsEl.innerHTML = '';
    if(bqOptsEl) bqOptsEl.innerHTML = '';
    if(bqProgEl) bqProgEl.style.width = '0%';
    bqAIMsg("Salut ! 👋 Moi c'est Nexa, ton agent IA personnel.\n\nPour commencer ce voyage ensemble... c'est quoi ton prénom ?");
}

function bqAIMsg(text, opts=[]) {
    // CORRECTION: null-check bq-msgs
    const msgs = document.getElementById('bq-msgs');
    if(!msgs) return;
    const d = document.createElement('div');
    d.style.cssText = 'background:#000;border:1px solid var(--border);border-radius:14px;padding:12px 16px;max-width:90%;align-self:flex-start;font-size:0.88rem;line-height:1.5;animation:slideL 0.3s ease;margin-bottom:10px;';
    d.innerHTML = text.replace(/
/g,'<br>');
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    const optsDiv = document.getElementById('bq-opts');
    optsDiv.innerHTML = '';
    if(opts.length) {
        opts.forEach(o => {
            const btn = document.createElement('button');
            btn.className = 'copt';
            btn.textContent = o;
            btn.onclick = () => bqUserMsg(o);
            optsDiv.appendChild(btn);
        });
    }
}

function bqUserMsg(text) {
    // CORRECTION: null-checks bq-opts et bq-msgs
    const bqOpts2 = document.getElementById('bq-opts');
    if(bqOpts2) bqOpts2.innerHTML = '';
    const msgs = document.getElementById('bq-msgs');
    const d = document.createElement('div');
    d.style.cssText = 'background:linear-gradient(90deg,var(--accent),#2dd10f);color:#000;border-radius:14px;padding:12px 16px;max-width:85%;align-self:flex-end;font-weight:600;font-size:0.88rem;animation:slideR 0.3s ease;margin-left:auto;margin-bottom:10px;';
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    bqSendToAI(text);
}

function bqSend() {
    const inp = document.getElementById('bq-input');
    const t = inp.value.trim();
    if(!t) return;
    inp.value = '';
    bqUserMsg(t);
}

async function bqSendToAI(userText) {
    bqHist.push({ role: 'user', content: userText });
    const lower = userText.toLowerCase();

    // Capturer le prénom à la première étape (bqStep === 0)
    if(bqStep === 0 && !bqData.prenom) {
        const prenom = userText.trim().split(' ')[0];
        bqData.prenom = prenom.charAt(0).toUpperCase() + prenom.slice(1).toLowerCase();
    }

    // --- LOGIQUE SPÉCIALE CLOSER (Affiliation vs Payant) ---
    
    // 1. Détection Ambassadeur / Affiliation
    if (lower.includes('ambassadeur') || lower.includes('affiliation') || lower.includes('gratuit')) {
        bqData.plan = 'affiliation';
        bqAIMsg("Excellent choix ! 🤝 Plan Ambassadeur activé (80% pour toi / 20% pour Nexa).");
        bqAIMsg("Action : Copie ton lien Beacons et mets-le en bio TikTok. \n\nDis-moi 'PRET' quand c'est fait pour ouvrir ton accès.");
        await saveUserToDB({ email: bqData.email, plan: 'affiliation', prenom: bqData.prenom || 'Ambassadeur' });
        // Redirection automatique vers le dashboard après 3 secondes
        setTimeout(() => {
            const user = JSON.parse(localStorage.getItem('nexaai_user') || '{}');
            if (user && user.email) loadDashboard(user);
            showPage('dashboard-page');
        }, 3000);
        return;
    }

    // 2. Détection Forfaits Payants
    const planMap = [
        { keys: ['starter', '39'], plan: 'starter', name: 'Starter', price: '€39' },
        { keys: ['pro', '94'], plan: 'pro', name: 'Pro 🎯', price: '€94' },
        { keys: ['business', '194'], plan: 'business', name: 'Business 💼', price: '€194' },
        { keys: ['elite', '494'], plan: 'elite', name: 'Elite 👑', price: '€494' }
    ];

    for(const p of planMap) {
        if(p.keys.some(k => lower.includes(k)) && bqStep >= 4) {
            bqData.plan = p.plan;
            bqAIMsg(`Option ${p.name} sélectionnée ! 🔥 On lance l'artillerie lourde.`);
            bqAIMsg("Pour injecter mon IA sur ton compte, envoie-moi ton NOM complet et l'URL de ton tunnel.");
            bqAIMsg("Je t'envoie le lien de paiement sécurisé juste après.");
            await saveUserToDB({ email: bqData.email, plan: p.plan, prenom: bqData.prenom || 'Client Premium' });
            return;
        }
    }

    // --- LOGIQUE NORMALE (IA) ---
    // CORRECTION: null-check bq-typing
    const bqTyp = document.getElementById('bq-typing');
    if(bqTyp) bqTyp.style.display = 'block';
    try {
        const res = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 500, system: BQ_PROMPT, messages: bqHist })
        });
        const data = await res.json();
        // CORRECTION: null-check bq-typing hide
        const bqTypH = document.getElementById('bq-typing');
        if(bqTypH) bqTypH.style.display = 'none';

        if(data.content?.[0]) {
            let reply = data.content[0].text;
            bqHist.push({ role: 'assistant', content: reply });

            // Incrémenter l'étape et mettre à jour la barre de progression
            bqStep++;
            const progress = Math.min((bqStep / 5) * 100, 100);
            const progressBar = document.getElementById('bq-progress');
            if(progressBar) progressBar.style.width = progress + '%';

            if(reply.includes('CHOIX_FORFAIT')) {
                reply = reply.replace('CHOIX_FORFAIT', '').trim();
                bqStep = 5; // étape finale atteinte
                if(progressBar) progressBar.style.width = '100%';
                bqAIMsg(reply, [
                    '🤝 Plan Ambassadeur — €0',
                    '⚡ Starter — €39/mois',
                    '🚀 Pro — €94/mois',
                    'Business — €194/mois',
                    '👑 Elite — €494/mois'
                ]);
            } else {
                bqAIMsg(reply);
            }
        }
    } catch(err) {
        // CORRECTION: null-check bq-typing dans catch
        const bqTypC = document.getElementById('bq-typing');
        if(bqTypC) bqTypC.style.display = 'none';
        bqAIMsg('Nexa analyse tes données... Continue !');
    }
}
