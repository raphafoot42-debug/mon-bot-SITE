/* Nexa — app cliente (Netlify Functions)
 * Fichiers à publier ensemble : index.html, netlify/css/nexa.css, netlify/functions/JS/nexa.js
 * Ordre de chargement : Stripe (head, synchrone) → Supabase → config.js → utils.js → payment.js → nexa.js (ce script, en dernier).
 */

// ===== VARIABLES GLOBALES (déclarées en premier pour éviter les ReferenceError) =====
// ════════════════════════════════════════════════════════════════
// 🏷️ SPA FLAG — empêche dashboard.js de s'auto-initialiser
// ════════════════════════════════════════════════════════════════
window.__nexaSPA = true;

let currentLang = 'fr';
let td = {}; // tunnel data (données du tunnel de qualification)
let dashChatHist = []; // historique du chat dashboard (déclaré globalement pour signOut et loadUserData)
// State — déclaré ici pour être disponible dans signOut() et toutes les fonctions
let currentPlan = 'pending'; // 'pending' avant qualification, puis starter/pro/affiliation
let connected = [];
let chatOpen = false;
let chatHist = [];

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

// ===== STRIPE PLANS =====
const STRIPE_PLANS = {
    "price_1TgQAiP6KQQPJW2bIPBL567L": { name: "Starter", messages: 40 },
    "price_1TgQAjP6KQQPJW2buOxVpaY3": { name: "Starter Annuel", messages: 40 },
    "price_1TgQAjP6KQQPJW2bHjVUSD4j": { name: "Pro", messages: 75 },
    "price_1TgQAlP6KQQPJW2bRq9GGOnU": { name: "Pro Annuel", messages: 75 }
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
                stripe_connect_id: stripeId
                // commission_rate retiré — défini côté serveur uniquement
            }).eq('id', user.id);
            if(error) throw error;
        }
        // Sauvegarder en localStorage aussi
        user.stripe_connect_id = stripeId;
        localStorage.setItem('nexaai_user', JSON.stringify(user));
        statusLabel.innerText = "✅ Partage 80/20 activé ! Nexa génère les ventes, tu reçois 20% de chaque vente générée.";
        statusLabel.style.color = "var(--accent)";
        btn.innerText = "Enregistré";
        btn.disabled = false; // CORRECTION: réactiver le bouton après succès
    } catch(err) {
        console.error(err);
        statusLabel.innerText = "❌ Erreur lors de l'enregistrement.";
        statusLabel.style.color = "#ff4d4d";
        btn.disabled = false;
        btn.innerText = "Réessayer";
    }
}

// ===== CONFIG =====
const STRIPE_PK = 'pk_live_51TH5RcP6KQQPJW2bnHPJyEcMNn4b6Sv2VjHtliuO85GJ95mTzCf3dG6EGHKyJhvVFiVOSg2z37BOl6DZzb52YjtU00JuOJk8d1'; // mode LIVE
// ✅ Netlify Functions — clés cachées côté serveur
const PROXY_URL = '/.netlify/functions/claude';
const STRIPE_URL = '/.netlify/functions/stripe-checkout';
const CLAUDE_MODEL = 'claude-sonnet-4-6'; // model string Anthropic API (format stable)
let stripe = null;
let sb = null;
let CLIENT_STORE_URL = '';

// ===== RETOUR TIKTOK =====
async function checkTikTokReturn() { // CORRECTION: async ajouté (utilise await loadDashboard)
    const params = new URLSearchParams(window.location.search);
    const tiktok = params.get('tiktok');
    const data = params.get('data');

    if(tiktok === 'success' && data) {
        try {
            let tiktokInfo = {};
            try { tiktokInfo = JSON.parse(decodeURIComponent(data)); } catch(parseErr) { console.error('TikTok data parse error:', parseErr); return false; }
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
                setTimeout(() => toast('✅ TikTok connecté ! Bienvenue ' + (tiktokInfo.displayName || '') + ' !', 'ok'), 500);
            }
            return true;
        } catch(e) {
            console.error('TikTok return error:', e);
        }
    }

    if(tiktok === 'error') {
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => toast('❌ Connexion TikTok échouée. Réessaie !', 'err'), 300);
        return true;
    }
    return false;
}

async function checkStripeReturn() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sessionId = params.get('session_id');

    if(payment === 'success') {
        const user = JSON.parse(localStorage.getItem('nexaai_user') || '{}');

        // CORRECTION: vérifier le paiement côté serveur via verify-payment.js
        // Empêche toute manipulation d'URL (?plan=starter_annual sans avoir payé)
        if(sessionId && user.email) {
            try {
                toast('⏳ Vérification du paiement...', 'ok');
                const res = await fetch('/.netlify/functions/verify-payment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: sessionId, email: user.email })
                });
                const data = await res.json();

                if(!res.ok || !data.valid) {
                    console.error('verify-payment failed:', data.error);
                    toast('❌ Vérification paiement échouée : ' + (data.error || 'erreur inconnue'), 'err');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    showPage('home');
                    return true;
                }

                // Plan vérifié côté serveur — on fait confiance à la réponse
                const planBase = data.plan || 'starter';
                user.plan = planBase;
                user.isPartner = !!data.isPartner;
                localStorage.setItem('nexaai_user', JSON.stringify(user));
                localStorage.removeItem('nexaai_pending_plan');

                // Supabase déjà mis à jour par verify-payment.js côté serveur
                // On enregistre juste le paiement local
                if(sb && user.email) {
                    try {
                        const { data: userRow } = await sb.from('users').select('id').eq('email', user.email).single();
                        if(userRow) {
                        const prices = { starter:39, starter_annual:340, pro:59, pro_annual:590 };
                            await sb.from('paiements').insert([{
                                user_id: userRow.id,
                                plan: planBase,
                                montant: prices[data.plan] || prices[planBase] || 39,
                                type_paiement: (data.plan || '').endsWith('_annual') ? 'annuel' : 'mensuel',
                                stripe_session_id: sessionId
                            }]);
                        }
                    } catch(e) { console.error('Supabase paiements insert error:', e); }
                }

            } catch(e) {
                console.error('checkStripeReturn verify error:', e);
                toast('❌ Erreur réseau lors de la vérification', 'err');
                window.history.replaceState({}, document.title, window.location.pathname);
                showPage('home');
                return true;
            }
        } else {
            // Pas de session_id → on ne peut pas vérifier → on refuse
            console.warn('checkStripeReturn: pas de session_id, paiement non vérifié');
            toast('❌ Paiement non vérifiable, contacte le support', 'err');
            window.history.replaceState({}, document.title, window.location.pathname);
            showPage('home');
            return true;
        }

        // Nettoyer l'URL
        window.history.replaceState({}, document.title, window.location.pathname);

        showSuccessPage(user);
        return true;
    }

    if(payment === 'cancel') {
        window.history.replaceState({}, document.title, window.location.pathname);
        showPage('home');
        setTimeout(() => toast('Paiement annulé. Tu peux réessayer quand tu veux !', 'err'), 500);
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
            if(!window.sb) {
                console.warn('[Nexa] Supabase non initialisé : vérifie que config.js est chargé avant nexa.js.');
                return;
            }
            sb = window.sb;
            if(await checkEmailVerifyReturn()) return;
            if(await checkTikTokReturn()) return;
            if(await checkStripeReturn()) return;

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
    dashChatHist = [];

    const userData = await loadUserFromDB(authUser.email);
    
    if(userData) {
        // L'utilisateur existe en BDD
        const prospects = await loadProspectsFromDB(userData.id);
        const user = { ...userData, prospects };
        localStorage.setItem('nexaai_user', JSON.stringify(user));

        // Vérification — si profil déjà complet (plan défini ou stripe configuré) → dashboard direct, pas de requalification
        const profileComplete = user.plan && user.plan !== 'pending' || user.stripe_connect_id;
        if(profileComplete) {
            await loadDashboard(user);
            showPage('dashboard-page');
        } else {
            // Profil existant mais incomplet → reprendre la qualification
            td.email = user.email;
            showPage('bot-qualify');
            setTimeout(() => { if(typeof botQualifyStart === 'function') botQualifyStart(user.email); }, 300);
        }
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
    dashChatHist = [];
    chatHist = [];
    showPage('home');
}

// ===== STATE =====
// currentPlan, connected, chatOpen, chatHist sont déclarés globalement en haut du fichier

// ===== PAGE SUCCÈS =====
function showSuccessPage(user) {
    if (!user) return;

    const planNames = {
        starter: 'Starter ✨',
        starter_annual: 'Starter Annuel ✨',
        pro: 'Pro 🚀',
        pro_annual: 'Pro Annuel 🚀',
        affiliation: 'Ambassadeur 🤝',
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
                    <h2 style="color:var(--accent);font-size:2rem;margin-bottom:15px;">Bienvenue ${escHtml(user.prenom || '')} !</h2>
                    <p style="color:var(--text-light);font-size:1rem;line-height:1.7;margin-bottom:30px;">
                        Ton plan <strong style="color:var(--accent);">${escHtml(planName)}</strong> est activé. Nexa est prête à travailler pour toi 24h/24.
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
async function goToDashboard() {
    const user = JSON.parse(localStorage.getItem('nexaai_user'));
    if(user) { await loadDashboard(user); showPage('dashboard-page'); }
    else showPage('home'); // CORRECTION: éviter dashboard vide si user null
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
        const elMPrenom = document.getElementById('m-prenom');
        const elMEmail = document.getElementById('m-email');
        if(!elMPrenom || !elMEmail) return; // CORRECTION: null-check
        const prenom = elMPrenom.value.trim();
        const email = elMEmail.value.trim();
        if(!prenom || !email) { toast('⚠️ Merci de remplir prénom et email !', 'err'); return; }
        // CORRECTION: validation format email
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast(`⚠️ Merci d'entrer un email valide !`, 'err'); return; }
        td.prenom = prenom;
        td.email = email;
        // CORRECTION: null-checks champs onboarding step 1
        const elMPhone = document.getElementById('m-phone');
        const elMPays = document.getElementById('m-pays');
        td.phone = elMPhone ? elMPhone.value : '';
        td.pays = elMPays ? elMPays.value : '';
    }
    if(step === 2) {
        const elMBusiness = document.getElementById('m-business');
        if(!elMBusiness) return; // CORRECTION: null-check
        const business = elMBusiness.value.trim();
        if(!business) { toast('⚠️ Entre le nom de ton business !', 'err'); return; }
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

// Validation étape 3 : au moins un réseau social obligatoire
function validateStep3() {
    const elMTik = document.getElementById('m-tiktok');
    const elMInsta = document.getElementById('m-instagram');
    const elMNiche = document.getElementById('m-niche');
    const errEl = document.getElementById('step3-error');
    const tiktok = elMTik ? elMTik.value.trim() : '';
    const insta = elMInsta ? elMInsta.value.trim() : '';
    if(!tiktok && !insta) {
        if(errEl) errEl.style.display = 'block';
        return;
    }
    if(errEl) errEl.style.display = 'none';
    td.tiktok = tiktok;
    td.instagram = insta;
    td.niche = elMNiche ? elMNiche.value.trim() : '';
    modalGoStep(4);
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

// Appelée par modalPayGuard() dans le HTML — vérifie qu'un plan est sélectionné avant de payer
function handleModalPay() {
    const selected = document.querySelector('.plan-select-card.selected');
    const errEl = document.getElementById('modal-pay-error');
    if (!selected) {
        if(errEl) errEl.style.display = 'block';
        return;
    }
    if(errEl) errEl.style.display = 'none';
    modalPay();
}

// ===== NAVIGATION =====
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const p = document.getElementById(id);
    if(p) { p.classList.add('active'); window.scrollTo({top:0,behavior:'smooth'}); }
}

// ===== LANGUE =====
const LANGS = {
    fr: {
        loginTitle: 'Connexion', loginEmailL: 'Email', loginPwdL: 'Mot de passe',
        loginSubmit: 'Se connecter', loginBack: 'Retour',
        botTitle: 'Nexa — Ton agent IA', botSub: 'Nexa connaît ton business. Pose-lui n\'importe quelle question.',
        settingsTitle: 'Paramètres', sPrenomL: 'Prénom', sEmailL: 'Email',
        sPwdL: 'Nouveau mot de passe', sBusinessL: 'Nom du business', sTypeL: 'Type de business',
        sSaveBtn: 'Sauvegarder', sLogoutBtn: 'Déconnexion',
        stProspects: 'Prospects', stMsgs: 'Messages', stRate: 'Conversion', stRevenue: 'Revenu estimé',
        chatHdrTitle: 'Nexa', loginBtn: 'Connexion', signupBtn: 'S\'inscrire'
    },
    en: {
        loginTitle: 'Login', loginEmailL: 'Email', loginPwdL: 'Password',
        loginSubmit: 'Sign in', loginBack: 'Back',
        botTitle: 'Nexa — Your AI agent', botSub: 'Nexa knows your business. Ask anything.',
        settingsTitle: 'Settings', sPrenomL: 'First name', sEmailL: 'Email',
        sPwdL: 'New password', sBusinessL: 'Business name', sTypeL: 'Business type',
        sSaveBtn: 'Save', sLogoutBtn: 'Logout',
        stProspects: 'Prospects', stMsgs: 'Messages', stRate: 'Conversion', stRevenue: 'Est. Revenue',
        chatHdrTitle: 'Nexa', loginBtn: 'Login', signupBtn: 'Sign up'
    },
    cn: {
        loginTitle: '登录', loginEmailL: '邮箱', loginPwdL: '密码',
        loginSubmit: '登录', loginBack: '返回',
        botTitle: 'Nexa — 你的AI助手', botSub: 'Nexa了解你的业务，随时提问。',
        settingsTitle: '设置', sPrenomL: '名字', sEmailL: '邮箱',
        sPwdL: '新密码', sBusinessL: '业务名称', sTypeL: '业务类型',
        sSaveBtn: '保存', sLogoutBtn: '退出',
        stProspects: '潜在客户', stMsgs: '消息', stRate: '转化率', stRevenue: '预估收入',
        chatHdrTitle: 'Nexa', loginBtn: '登录', signupBtn: '注册'
    }
};

function changeLang(lang) {
    currentLang = lang || 'fr';
    const t = LANGS[currentLang] || LANGS.fr;
    // Mettre à jour tous les éléments traduits
    Object.entries(t).forEach(([id, text]) => {
        const el = document.getElementById(id);
        if(el) {
            if(el.tagName === 'INPUT') el.placeholder = text;
            else if(el.tagName === 'BUTTON') el.textContent = text;
            else el.textContent = text;
        }
    });
}

// ===== TUNNEL =====
function startTunnel(plan) {
    // Résout les price IDs Stripe vers leur clé plan (pour compatibilité boutons HTML existants)
    const priceIdMap = {
        'price_1TgQAiP6KQQPJW2bIPBL567L': 'starter',
        'price_1TgQAjP6KQQPJW2bHjVUSD4j': 'pro',
        'price_1TgQAjP6KQQPJW2buOxVpaY3': 'starter_annual',
        'price_1TgQAlP6KQQPJW2bRq9GGOnU': 'pro_annual',
    };
    if(priceIdMap[plan]) plan = priceIdMap[plan];

    currentPlan = plan;
    td.plan = plan;
    const isAnnual = plan.endsWith('_annual');
    const planBase = plan.replace('_annual', '');
    const planNames = { starter:'Starter ✨', pro:'Pro 🚀', affiliation:'Ambassadeur 🤝' };
    const planPrices = {
        'starter':'€39/mois', 'starter_annual':'€340/an',
        'pro':'€59/mois',     'pro_annual':'€590/an',
        'affiliation':'Gratuit'
    };
    const payPlanName = document.getElementById('pay-plan-name');
    const payPlanPrice = document.getElementById('pay-plan-price');
    if(payPlanName) payPlanName.textContent = (planNames[planBase] || 'Starter') + (isAnnual ? ' — Annuel' : '');
    if(payPlanPrice) payPlanPrice.textContent = planPrices[plan] || '€39/mois';

    // Afficher les features du plan
    const features = {
        starter: '&#8226; 40 messages / jour&#8226; Messages automatisés&#8226; Dashboard de suivi&#8226; Support par email',
        pro: '&#8226; 75 messages / jour&#8226; Messages ultra-personnalisés&#8226; Dashboard avancé&#8226; Support 24/7&#8226; API',
        affiliation: '&#8226; 50 messages / jour&#8226; Lien d\'affiliation personnel&#8226; 20% sur chaque vente générée'
    };
    const featEl = document.getElementById('pay-features');
    if(featEl) featEl.innerHTML = features[planBase] || features.starter;

    const typeEl = document.getElementById('pay-plan-type');
    if(typeEl) typeEl.textContent = isAnnual ? 'Paiement annuel — 2 mois offerts' : 'Abonnement mensuel — sans engagement';

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
            if(email) td.email = email; // CORRECTION: synchroniser td.email pour éviter perte de contexte
        }
        if(!email) {
            toast('⚠️ Email requis ! Connecte-toi ou passe par le tunnel avec ton email.', 'err');
            resetStripePayButtons();
            return;
        }

        const rawPartner = localStorage.getItem('nexa_partner_id');
        const referrerId = (rawPartner && rawPartner.startsWith('acct_')) ? rawPartner : null;

        if(sb && email) {
            await saveUserToDB({
                email,
                prenom: td.prenom || email.split('@')[0],
                business: td.business || '',
                plan: plan.replace('_annual',''),
                tiktok_pseudo: td.tiktok || '',
                store_url: CLIENT_STORE_URL || ''
            });
        }

        const res = await fetch(STRIPE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan: plan.replace('_annual', ''),
                billing: plan.endsWith('_annual') ? 'annual' : 'monthly',
                email,
                referrer_id: referrerId,
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
        toast('❌ Erreur : ' + (err && err.message ? err.message : String(err)), 'err');
    }
}

// Alias pour compatibilité avec les boutons existants
function processPayment() { handlePlanSelection(currentPlan || 'starter'); }


function goStep2() {
    const elTPrenom = document.getElementById('t-prenom');
    const elTEmail = document.getElementById('t-email');
    if(!elTPrenom || !elTEmail) return; // CORRECTION: null-check
    const p = elTPrenom.value.trim();
    const e = elTEmail.value.trim();
    if(!p || !e) { toast('⚠️ Merci de remplir ton prénom et ton email !', 'err'); return; }
    // CORRECTION: validation format email
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { toast(`⚠️ Merci d'entrer un email valide !`, 'err'); return; }
    td.prenom = p; td.email = e;
    // CORRECTION: null-checks champs tunnel step 1
    const elTPhone = document.getElementById('t-phone');
    const elTPays = document.getElementById('t-pays');
    td.phone = elTPhone ? elTPhone.value : '';
    td.pays = elTPays ? elTPays.value : '';
    showPage('step2');
}

function goStep3() {
    const elTBusiness = document.getElementById('t-business');
    if(!elTBusiness) return; // CORRECTION: null-check
    const b = elTBusiness.value.trim();
    if(!b) { toast(`⚠️ Merci d'indiquer le nom de ton business !`, 'err'); return; }
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
let _loadDashboardRunning = false;
async function loadDashboard(user) {
    // CORRECTION: éviter les appels simultanés (race condition)
    if(_loadDashboardRunning) return;
    _loadDashboardRunning = true;
    try {
    if(!user) user = JSON.parse(localStorage.getItem('nexaai_user') || 'null');
    if(!user) { _loadDashboardRunning = false; return; }
    // Recharger les prospects depuis Supabase si dispo
    if(sb && user.id) {
        const prospects = await loadProspectsFromDB(user.id);
        if(prospects.length) user.prospects = prospects;
    }
    const elWelcome = document.getElementById('dash-welcome'); if(elWelcome) elWelcome.textContent = `Bienvenue ${user.prenom || ''} 🎯`;
    const elProspects = document.getElementById('st-prospects'); if(elProspects) elProspects.textContent = user.prospects?.length || 0;
    const elMsgs = document.getElementById('st-msgs'); if(elMsgs) elMsgs.textContent = (user.prospects?.length || 0) * 3;
    const elRate = document.getElementById('st-rate');
    if(elRate) {
        const totalP = (user.prospects || []).length;
        const closedP = (user.prospects || []).filter(p => p.status === 'closed').length;
        elRate.textContent = totalP > 0 ? Math.round((closedP / totalP) * 100) + '%' : '—';
    }
    // Calcul du revenu estimé depuis les prospects closés
    const closedCount = (user.prospects || []).filter(p => p.status === 'closed').length;
    const planRevenue = { starter: 39, pro: 59, affiliation: 0 };
    // CORRECTION: utiliser le prix du produit client si renseigné, sinon le tarif du plan
    const revenueEstimate = closedCount * (parseFloat(user.prix_produit) || planRevenue[user.plan] || 0);
    // CORRECTION: null-check sur st-revenue
    const elRevenue = document.getElementById('st-revenue');
    if(elRevenue) elRevenue.textContent = '€' + revenueEstimate;
    // Badges
    const badges = document.getElementById('platform-badges');
    // CORRECTION: null-check sur badges avant innerHTML
    if(badges) badges.innerHTML = '';
    if(badges && user.platforms?.includes('tiktok')) badges.innerHTML += '<span style="background:rgba(57,255,20,0.1);border:1px solid var(--accent);color:var(--accent);padding:6px 14px;border-radius:20px;font-size:0.8rem;font-weight:700;">🎵 TikTok connecté</span>';
    if(badges && user.platforms?.includes('instagram')) badges.innerHTML += '<span style="background:rgba(57,255,20,0.1);border:1px solid var(--accent);color:var(--accent);padding:6px 14px;border-radius:20px;font-size:0.8rem;font-weight:700;">📸 Instagram connecté</span>';
    // Liens ambassadeur — visibles uniquement si plan affiliation
    const elAffLinks = document.getElementById('dash-aff-links');
    if(elAffLinks) {
        if(user.plan === 'affiliation' && user.stripe_connect_id) {
            const shopUrl = window.location.origin + '/shop/' + user.stripe_connect_id;
            const affUrl  = window.location.origin + '?ref=' + user.stripe_connect_id;
            elAffLinks.style.display = 'block';
            const elShopUrl = document.getElementById('dash-shop-url');
            const elAffUrl  = document.getElementById('dash-aff-url');
            if(elShopUrl) elShopUrl.textContent = shopUrl;
            if(elAffUrl)  elAffUrl.textContent  = affUrl;
        } else {
            elAffLinks.style.display = 'none';
        }
    }
    // Settings
    const elPrenom = document.getElementById('s-prenom'); if(elPrenom) elPrenom.value = user.prenom || '';
    const elEmail = document.getElementById('s-email'); if(elEmail) elEmail.value = user.email || '';
    const elBusiness = document.getElementById('s-business'); if(elBusiness) elBusiness.value = user.business || '';
    const elSType = document.getElementById('s-type'); if(elSType && user.type_business) elSType.value = user.type_business;
    // Injecter la section Affiliation dans les paramètres si pas encore présente
    const dSettings = document.getElementById('d-settings');
    if(dSettings && !document.getElementById('s-aff-section')) {
        const affSection = document.createElement('div');
        affSection.id = 's-aff-section';
        affSection.style.cssText = 'margin-top:30px;padding:20px;background:rgba(57,255,20,0.04);border:1px solid rgba(57,255,20,0.2);border-radius:14px;';
        affSection.innerHTML = `
            <h3 style="color:var(--accent);font-size:1rem;font-weight:800;margin-bottom:6px;">🤝 Affiliation / Ambassadeur</h3>
            <p style="color:var(--text-light);font-size:0.82rem;margin-bottom:18px;">Configure ton mode d'affiliation pour recevoir 20% automatiquement sur Stripe.</p>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-size:0.82rem;color:var(--text-light);display:block;margin-bottom:6px;">Mode</label>
                <select id="s-aff-mode" onchange="onAffModeChange()" style="width:100%;padding:10px;background:#000;border:1px solid var(--border);border-radius:8px;color:var(--text);">
                    <option value="">— Choisir un mode —</option>
                    <option value="ia_close">🤖 Mode 1 — L'IA close pour moi (Nexa 80% / moi 20%)</option>
                    <option value="lien">🔗 Mode 2 — Je partage mon lien (Nexa 80% / moi 20%)</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
                <label style="font-size:0.82rem;color:var(--text-light);display:block;margin-bottom:6px;">ID Stripe Connect <span style="color:#ff4444;">*</span></label>
                <input type="text" id="s-aff-stripe" placeholder="acct_xxxxxxxxxxxxxxxx" style="width:100%;padding:10px;background:#000;border:1px solid var(--border);border-radius:8px;color:var(--text);box-sizing:border-box;">
                <p style="font-size:0.75rem;color:var(--text-light);margin-top:4px;">Trouve ton ID sur <a href="https://dashboard.stripe.com" target="_blank" style="color:var(--accent);">dashboard.stripe.com</a></p>
            </div>
            <div id="s-aff-url-group" class="form-group" style="margin-bottom:14px;display:none;">
                <label style="font-size:0.82rem;color:var(--text-light);display:block;margin-bottom:6px;">URL de ton tunnel de vente</label>
                <input type="text" id="s-aff-url" placeholder="https://ton-site.com/vente" style="width:100%;padding:10px;background:#000;border:1px solid var(--border);border-radius:8px;color:var(--text);box-sizing:border-box;">
            </div>
            <p id="s-aff-status" style="font-size:0.82rem;margin-bottom:10px;min-height:18px;"></p>
            <p id="s-aff-link" style="display:none;font-size:0.82rem;color:var(--accent);word-break:break-all;margin-bottom:12px;padding:10px;background:rgba(57,255,20,0.06);border-radius:8px;"></p>
            <button id="sAffSaveBtn" onclick="saveAffiliationSettings()" style="padding:12px 24px;background:var(--accent);color:#000;border:none;border-radius:8px;font-weight:800;font-size:0.88rem;cursor:pointer;">Sauvegarder</button>
        `;
        dSettings.appendChild(affSection);
    }
    const elAffMode = document.getElementById('s-aff-mode'); if(elAffMode && user.affiliation_mode) { elAffMode.value = user.affiliation_mode; onAffModeChange(); }
    const elAffStripe = document.getElementById('s-aff-stripe'); if(elAffStripe && user.stripe_connect_id) elAffStripe.value = user.stripe_connect_id;
    const elAffUrl = document.getElementById('s-aff-url'); if(elAffUrl && user.store_url) elAffUrl.value = user.store_url;
    const elAffLink = document.getElementById('s-aff-link');
    if(elAffLink && user.stripe_connect_id && user.stripe_connect_id.startsWith('acct_')) {
        elAffLink.style.display = 'block';
        elAffLink.textContent = '🔗 Ton lien : ' + window.location.origin + '?ref=' + user.stripe_connect_id;
    }
    const planNames = {
        starter:'Starter ✨', starter_annual:'Starter Annuel ✨',
        pro:'Pro 🚀',         pro_annual:'Pro Annuel 🚀',
        affiliation:'Ambassadeur 🤝', free:'Gratuit'
    };
    const planPrices = {
        starter:'€39/mois',   starter_annual:'€340/an',
        pro:'€59/mois',       pro_annual:'€590/an',
        affiliation:'€0/mois', free:'—'
    };
    const elPlan = document.getElementById('s-plan'); if(elPlan) elPlan.textContent = planNames[user.plan] || 'Starter';
    const elBilling = document.getElementById('s-billing'); if(elBilling) elBilling.textContent = (user.plan || '').endsWith('_annual') ? 'Abonnement annuel' : 'Abonnement mensuel';
    const elPrice = document.getElementById('s-price'); if(elPrice) elPrice.textContent = planPrices[user.plan] || '€39/mois';
    // Prospects
    loadProspects(user.prospects || []);
    // Message d'accueil Nexa personnalisé dans le dashboard
    const welcomeMsg = document.getElementById('dash-welcome-msg');
    if(welcomeMsg) {
        welcomeMsg.innerHTML = 'Salut ' + escHtml(user.prenom||'') + ' ! 👋 Je suis Nexa, ton agent IA personnel.<br><br>Je connais ton business <strong>' + escHtml(user.business||'') + '</strong> par coeur. Je suis la pour t\'aider a closer plus, optimiser tes messages et faire grandir tes revenus.<br><br>On attaque quoi aujourd\'hui ?';
    }
    const navOverview = document.querySelector('.sidebar-menu a[data-dash="overview"]');
    if(navOverview) showDash('overview', navOverview);
    } catch(e) {
        console.error('[Nexa] loadDashboard error:', e);
    } finally {
        // CORRECTION: toujours libérer le verrou, même en cas d'erreur
        _loadDashboardRunning = false;
    }
}


function loadProspects(list) {
    const tbody = document.getElementById('prospects-body');
    if(!tbody) return; // CORRECTION: null-check
    if(!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:40px;">Aucun prospect pour l\'instant. Le bot commence d\u00e8s que tes r\u00e9seaux sont connect\u00e9s !</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(p => `
        <tr>
            <td>${escHtml(p.name)}</td><td>${escHtml(p.network)}</td>
            <td><span class="badge ${p.status==='closed'?'badge-green':'badge-orange'}">${p.status==='closed'?'✓ Closé':'⏳ En cours'}</span></td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-light);font-size:0.82rem;">${escHtml(p.lastMsg||'—')}</td>
            <td style="color:var(--text-light);font-size:0.82rem;">${p.date && !isNaN(new Date(p.date)) ? new Date(p.date).toLocaleDateString('fr-FR') : '—'}</td>
        </tr>`).join('');
}

function showDash(section, el) {
    const dashSections = ['overview', 'prospects', 'bot', 'settings'];
    dashSections.forEach(s => {
        const el2 = document.getElementById('d-' + s);
        if(el2) el2.style.display = 'none';
    });
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
    user.business = elSBusiness ? elSBusiness.value : (user.business || '');
    user.type_business = elSType ? elSType.value : (user.type_business || '');
    if(elSEmail) elSEmail.value = user.email || '';

    await saveUserToDB({
        email: user.email,
        prenom: user.prenom,
        business: user.business,
        type_business: user.type_business,
        plan: user.plan || 'pending',
        platforms: user.platforms || []
    });

    localStorage.setItem('nexaai_user', JSON.stringify(user));

    const btn = document.getElementById('sSaveBtn');
    if(btn) {
        btn.textContent = '✅ Sauvegardé !';
        setTimeout(() => { btn.textContent = 'Sauvegarder'; }, 2000);
    }
}

// ===== AFFILIATION SETTINGS =====
async function saveAffiliationSettings() {
    const user = JSON.parse(localStorage.getItem('nexaai_user') || '{}');
    const elAffMode = document.getElementById('s-aff-mode');
    const elAffStripe = document.getElementById('s-aff-stripe');
    const elAffUrl = document.getElementById('s-aff-url');
    const elAffStatus = document.getElementById('s-aff-status');
    const elAffLink = document.getElementById('s-aff-link');
    const btn = document.getElementById('sAffSaveBtn');

    const mode = elAffMode ? elAffMode.value : '';
    const stripeId = elAffStripe ? elAffStripe.value.trim() : '';
    const storeUrl = elAffUrl ? elAffUrl.value.trim() : '';

    // Validation Stripe ID
    if (!stripeId.startsWith('acct_')) {
        if(elAffStatus) { elAffStatus.textContent = "❌ L'ID Stripe doit commencer par acct_"; elAffStatus.style.color = '#ff4444'; }
        return;
    }
    // Validation URL si mode IA close
    if (mode === 'ia_close' && storeUrl && !/^https?:\/\/.+/.test(storeUrl)) {
        if(elAffStatus) { elAffStatus.textContent = "❌ L'URL doit commencer par https://"; elAffStatus.style.color = '#ff4444'; }
        return;
    }

    if(btn) { btn.textContent = '⏳ Sauvegarde...'; btn.disabled = true; }

    try {
        user.affiliation_mode = mode;
        user.stripe_connect_id = stripeId;
        if(storeUrl) user.store_url = storeUrl;
        if(!user.plan || user.plan === 'pending') user.plan = 'affiliation';

        await saveUserToDB({
            email: user.email,
            affiliation_mode: mode,
            stripe_connect_id: stripeId,
            store_url: storeUrl || user.store_url || '',
            plan: user.plan
            // commission_rate retiré — défini côté serveur uniquement
        });

        localStorage.setItem('nexaai_user', JSON.stringify(user));

        // Afficher le lien d'affiliation généré
        const affLink = window.location.origin + '?ref=' + stripeId;
        if(elAffLink) {
            elAffLink.style.display = 'block';
            elAffLink.textContent = '🔗 Ton lien : ' + affLink;
        }
        if(elAffStatus) {
            elAffStatus.textContent = mode === 'ia_close'
                ? '✅ Mode activé ! Nexa close tes DMs, tu reçois 20% de chaque vente.'
                : '✅ Mode activé ! Partage ton lien, tu reçois 20% à chaque abonnement.';
            elAffStatus.style.color = 'var(--accent)';
        }
        if(btn) { btn.textContent = '✅ Sauvegardé !'; setTimeout(() => { btn.textContent = 'Sauvegarder'; btn.disabled = false; }, 2000); }
    } catch(err) {
        console.error('saveAffiliationSettings error:', err);
        if(elAffStatus) { elAffStatus.textContent = '❌ Erreur lors de la sauvegarde.'; elAffStatus.style.color = '#ff4444'; }
        if(btn) { btn.textContent = 'Réessayer'; btn.disabled = false; }
    }
}

// Afficher/masquer le champ URL selon le mode choisi
function onAffModeChange() {
    const mode = document.getElementById('s-aff-mode');
    const urlGroup = document.getElementById('s-aff-url-group');
    if(!mode || !urlGroup) return;
    urlGroup.style.display = mode.value === 'ia_close' ? 'block' : 'none';
}

// ===== AUTH =====
// ════════════════════════════════════════════════════════════════
// 🔐 UTILITAIRES VÉRIFICATION EMAIL
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// 🔐 UTILITAIRES SÉCURITÉ & VÉRIFICATION EMAIL
// ════════════════════════════════════════════════════════════════



let _rateLimits = {};
const checkRate = (key, limit, ms) => {
  const now = Date.now();
  _rateLimits[key] = (_rateLimits[key] || []).filter(t => now - t < ms);
  if (_rateLimits[key].length >= limit) throw new Error('Trop de tentatives');
  _rateLimits[key].push(now);
};

// LS est défini dans utils.js — chargé avant nexa.js

const MSG = {
  offline: '❌ Pas de connexion internet',
  fillAll: '⚠️ Remplir tous les champs',
  pwdTooShort: '⚠️ Min 8 caractères',
  emailInvalid: '⚠️ Email invalide',
  confirmChecking: '⏳ Vérification...',
  emailConfirmed: '✅ Email confirmé !',
  emailNotYet: '❌ Email non confirmé',
  resendOk: '✅ Email renvoyé',
  finishSaving: '⏳ Enregistrement...'
};

const _state = {
  btype: null,
  finishing: false,
  csrf: genToken(),
  sessionStart: Date.now(),
  _authUnsub: null,
  _resendTimer: null
};

let _emailVerifyPageBuilt = false;

// ════════════════════════════════════════════════════════════════
// 1️⃣ REGISTER AVEC VÉRIFICATION EMAIL
// ════════════════════════════════════════════════════════════════

async function register() {
  try {
    isOnline();
    checkRate('register', 5, 900000);

    const email = sanitize(document.getElementById('regEmail')?.value);
    const pwd = document.getElementById('regPwd')?.value || '';
    const pwd2 = document.getElementById('regPwd2')?.value || '';

    if (!email || !pwd) throw new Error(MSG.fillAll);
    if (pwd !== pwd2) throw new Error('Mots de passe différents');
    if (pwd.length < 8) throw new Error(MSG.pwdTooShort);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error(MSG.emailInvalid);

    const btn = document.getElementById('regBtn');
    if (btn) { btn.textContent = '⏳ Création...'; btn.disabled = true; }

    const client = getSb();
    const { data, error } = await withTimeout(
      client.auth.signUp({
        email,
        password: pwd,
        options: { emailRedirectTo: window.location.origin + window.location.pathname + '?verified=1' }
      }),
      15000
    );

    if (error) throw error;

    const prenom = email.split('@')[0].replace(/[0-9._\-+]/g, ' ').trim().split(/\s+/)[0];
    const newUser = {
      id: data.user?.id || genToken(),
      email,
      prenom: prenom.charAt(0).toUpperCase() + prenom.slice(1),
      plan: 'pending',
      platforms: [],
      status: 'pending_verify',
      email_verified: false,
      created_at: new Date().toISOString(),
      prospects: []
    };

    LS.setUser(newUser);
    try { await client.from('users').insert([newUser]); } catch(e) { console.error('DB insert:', e); }

    showEmailVerifyPage(email);
    toast('✅ Email de confirmation envoyé', 'ok');

  } catch (err) {
    toast('❌ ' + err.message, 'err');
  } finally {
    const btn = document.getElementById('regBtn');
    if (btn) { btn.textContent = 'Créer mon compte'; btn.disabled = false; }
  }
}

// ════════════════════════════════════════════════════════════════
// 2️⃣ PAGE VÉRIFICATION EMAIL
// ════════════════════════════════════════════════════════════════

function showEmailVerifyPage(email) {
  if (_emailVerifyPageBuilt) {
    const el = document.getElementById('verify-email-display');
    if (el) el.textContent = email;
    const st = document.getElementById('verify-status');
    if (st) st.textContent = '';
    showPage('email-verify');
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
          <p>2. Clique sur le lien de confirmation</p>
          <p>3. Reviens ici et clique sur le bouton</p>
          <p style="opacity:0.7;">💡 Vérifie aussi tes spams</p>
        </div>
        <button onclick="checkEmailVerified()" class="btn btn-primary btn-full" style="margin-bottom:10px;">✅ J'ai confirmé mon email</button>
        <button onclick="resendVerifyEmail()" class="btn btn-secondary btn-full" style="margin-bottom:10px;">🔁 Renvoyer l'email</button>
        <button onclick="showPage('home')" class="btn btn-ghost btn-full">← Retour</button>
        <p id="verify-status" role="status" style="margin-top:12px;font-size:0.85rem;min-height:18px;color:var(--text-light);"></p>
      </div>
    </div>`;

  showPage('email-verify');
}

// ════════════════════════════════════════════════════════════════
// 3️⃣ VÉRIFIER EMAIL CONFIRMÉ
// ════════════════════════════════════════════════════════════════

async function checkEmailVerified() {
  try {
    isOnline();
    checkRate('emailCheck', 10, 60000);

    const statusEl = document.getElementById('verify-status');
    if (statusEl) statusEl.textContent = MSG.confirmChecking;

    const client = getSb();
    const { data: { user }, error } = await withTimeout(client.auth.getUser(), 15000);
    if (error) throw error;

    if (user?.email_confirmed_at) {
      if (statusEl) statusEl.textContent = MSG.emailConfirmed;
      toast(MSG.emailConfirmed, 'ok');

      const stored = LS.user();
      stored.emailVerified = true;
      stored.status = 'actif';
      LS.setUser(stored);

      try {
        await client.from('users').update({ email_verified: true, status: 'actif' }).eq('email', user.email);
      } catch(e) { console.error('DB update:', e); }

      setTimeout(() => {
        showPage('bot-qualify');
        if (typeof botQualifyStart === 'function') botQualifyStart(user.email);
      }, 1000);
    } else {
      if (statusEl) statusEl.textContent = MSG.emailNotYet;
      toast(MSG.emailNotYet, 'err');
    }
  } catch(err) {
    toast('❌ ' + err.message, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// 4️⃣ RENVOYER EMAIL DE VÉRIFICATION
// ════════════════════════════════════════════════════════════════

async function resendVerifyEmail() {
  try {
    if (_state._resendTimer) { toast('⏳ Attends 60s avant de renvoyer', 'err'); return; }
    checkRate('resend', 3, 900000);

    const email = document.getElementById('verify-email-display')?.textContent?.trim();
    if (!email) throw new Error('Email introuvable');

    const client = getSb();
    const { error } = await withTimeout(client.auth.resend({ type: 'signup', email }), 15000);
    if (error) throw error;

    toast(MSG.resendOk, 'ok');
    _state._resendTimer = setTimeout(() => { _state._resendTimer = null; }, 60000);

  } catch(err) {
    toast('❌ ' + err.message, 'err');
  }
}

// ════════════════════════════════════════════════════════════════
// 5️⃣ GÉRER RETOUR APRÈS CLIC SUR LIEN EMAIL
// ════════════════════════════════════════════════════════════════

async function checkEmailVerifyReturn() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('verified') && !params.has('access_token') && !window.location.hash.includes('access_token')) {
    return false;
  }
  try {
    const client = getSb();
    const { data: { user } } = await client.auth.getUser();
    if (user?.email_confirmed_at) {
      const stored = LS.user();
      stored.emailVerified = true;
      stored.status = 'actif';
      LS.setUser(stored);
      window.history.replaceState({}, document.title, window.location.pathname);
      toast('✅ Email confirmé, bienvenue !', 'ok');
      showPage('bot-qualify');
      if (typeof botQualifyStart === 'function') botQualifyStart(user.email);
      return true;
    }
  } catch(e) { console.error('checkEmailVerifyReturn:', e); }
  return false;
}


async function login() {
    const elLoginEmail = document.getElementById('loginEmail');
    const elLoginPwd = document.getElementById('loginPassword');
    if(!elLoginEmail || !elLoginPwd) return; // CORRECTION: null-check
    const email = elLoginEmail.value.trim();
    const pwd = elLoginPwd.value.trim();
    if(!email || !pwd) { toast('⚠️ Merci de remplir tous les champs !', 'err'); return; }

    const btn = document.querySelector('#login .btn-primary');
    if(btn) { btn.textContent = '⏳ Connexion...'; btn.disabled = true; }

    if(!sb) {
        toast('❌ Erreur de connexion, rechargez la page', 'err');
        if(btn) { btn.textContent = 'Se connecter'; btn.disabled = false; }
        return;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });

    if(error) {
        toast('❌ Email ou mot de passe incorrect.', 'err');
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
        await loadDashboard(user); // CORRECTION: await ajouté
        showPage('dashboard-page');
    } else {
        // Profil pas encore créé → tunnel de qualification
        td.email = email;
        showPage('bot-qualify');
        setTimeout(() => botQualifyStart(email), 300);
    }
}

async function logout() { await signOut(); }

// ===== ADMIN =====
// La vérification du mot de passe admin est gérée côté serveur (Netlify Function claude).
// Aucun secret n'est stocké côté client.
let allUsers = [];

function openAdminLogin() {
    const alm = document.getElementById('adminLoginModal');
    if(alm) alm.style.display = 'flex';
    setTimeout(() => { const ap = document.getElementById('adminSecretPwd'); if(ap) ap.focus(); }, 100);
}
function closeAdminLogin() {
    const alm = document.getElementById('adminLoginModal');
    if(alm) alm.style.display = 'none';
    const asp = document.getElementById('adminSecretPwd');
    if(asp) asp.value = '';
}
async function checkAdminLogin() {
    const aspEl = document.getElementById('adminSecretPwd');
    if(!aspEl) return;
    const pwd = aspEl.value;
    if(!pwd) return;
    try {
        const res = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminAuth: true, password: pwd })
        });
        const rawAdmin = await res.text();
        let data = {};
        try { data = rawAdmin ? JSON.parse(rawAdmin) : {}; } catch(e) { throw new Error('Réponse serveur invalide'); }
        if(data.ok) {
            closeAdminLogin();
            const apanel = document.getElementById('adminPanel');
            if(apanel) apanel.style.display = 'block';
            document.body.style.overflow = 'hidden';
            loadAdminData();
            // CORRECTION: démarrer le polling uniquement à l'ouverture du panel
            if(!_adminIntervalId) {
                _adminIntervalId = setInterval(() => {
                    if(!_adminLoading) {
                        _adminLoading = true;
                        loadAdminData().finally(() => { _adminLoading = false; });
                    }
                }, 10000);
            }
        } else {
            const aspErr = document.getElementById('adminSecretPwd');
            if(aspErr) {
                aspErr.style.borderColor = '#ff4444';
                setTimeout(() => { aspErr.style.borderColor = 'var(--border)'; }, 1000);
                aspErr.value = '';
            }
        }
    } catch(e) { toast('❌ Erreur de connexion', 'err'); }
}
function closeAdminPanel() {
    const ap = document.getElementById('adminPanel');
    if(ap) ap.style.display = 'none';
    document.body.style.overflow = '';
    // CORRECTION: arrêter le polling à la fermeture du panel
    if(_adminIntervalId) { clearInterval(_adminIntervalId); _adminIntervalId = null; }
}


// ===== NOUVELLES FONCTIONS ADMIN =====

function viewUserDetail(email) {
    const user = allUsers.find(u => u.email === email);
    if(!user) return;
    const modal = document.getElementById('userDetailModal');
    const content = document.getElementById('userDetailContent');
    if(!modal || !content) return; // CORRECTION: null-check
    const planNames = {starter:'Starter ✨',starter_annual:'Starter Annuel ✨',pro:'Pro 🚀',pro_annual:'Pro Annuel 🚀',affiliation:'Ambassadeur 🤝',free:'Gratuit'};
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
        '<span style="color:var(--text-light);font-size:0.85rem;">' + escHtml(String(label)) + '</span>' +
        '<span style="color:var(--text);font-weight:600;font-size:0.85rem;">' + escHtml(String(value)) + '</span>' +
        '</div>';
}

function closeUserDetail() {
    // CORRECTION: null-check
    const udm = document.getElementById('userDetailModal');
    if(udm) udm.style.display = 'none';
}

// ════════════════════════════════════════════════════════════════
// 🪟 CONFIRM ADMIN — remplace window.confirm() (non stylisable)
// ════════════════════════════════════════════════════════════════
function adminConfirm(message) {
    return new Promise(resolve => {
        let modal = document.getElementById('_adminConfirmModal');
        if(!modal) {
            modal = document.createElement('div');
            modal.id = '_adminConfirmModal';
            modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;align-items:center;justify-content:center;';
            modal.innerHTML = `
              <div style="background:#111;border:1px solid #333;border-radius:14px;padding:28px 32px;max-width:380px;width:90%;text-align:center;">
                <p id="_adminConfirmMsg" style="color:var(--text);font-size:0.97rem;margin-bottom:24px;line-height:1.5;"></p>
                <div style="display:flex;gap:12px;justify-content:center;">
                  <button id="_adminConfirmNo"  style="padding:10px 24px;border-radius:8px;border:1px solid #555;background:transparent;color:#ccc;cursor:pointer;">Annuler</button>
                  <button id="_adminConfirmYes" style="padding:10px 24px;border-radius:8px;border:none;background:#ff4444;color:#fff;font-weight:700;cursor:pointer;">Confirmer</button>
                </div>
              </div>`;
            document.body.appendChild(modal);
        }
        document.getElementById('_adminConfirmMsg').textContent = message;
        modal.style.display = 'flex';
        const close = ok => { modal.style.display = 'none'; resolve(ok); };
        document.getElementById('_adminConfirmYes').onclick = () => close(true);
        document.getElementById('_adminConfirmNo').onclick  = () => close(false);
    });
}

async function toggleSuspend(email, isSuspended) {
    const newStatus = isSuspended ? 'actif' : 'suspended';
    if(!isSuspended && !(await adminConfirm('Suspendre le compte de ' + email + ' ?'))) return;

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
    const elMsgEmail2 = document.getElementById('msg-email');
    const elMsgContent2 = document.getElementById('msg-content');
    if(!elMsgEmail2 || !elMsgContent2) return; // CORRECTION: null-check
    const email = elMsgEmail2.value.trim();
    const rawMsg = elMsgContent2.value.trim();
    if(!rawMsg) { toast('⚠️ Écris un message !', 'err'); return; }
    // Sanitisation : limiter la longueur et supprimer les balises HTML
    const msg = rawMsg.replace(/<[^>]*>/g, '').slice(0, 2000);

    // Sauvegarder le message dans Supabase
    if(sb) {
        if(email) {
            const { data: userRow } = await sb.from('users').select('id').eq('email', email).single();
            if(userRow) {
                await sb.from('prospects').insert([{
                    user_id: userRow.id,
                    name: 'Message Admin',
                    status: 'message',
                    lastMsg: msg,
                    network: 'admin',
                    date: new Date().toISOString()
                }]);
            }
        }
    }

    // Vider les champs (utilise les variables déjà déclarées en haut)
    elMsgContent2.value = '';
    elMsgEmail2.value = '';
    toast('✅ Message envoyé' + (email ? ' à ' + email : ' à tous les clients') + ' !', 'ok');
}

function exportCSV() {
    const headers = ['Prénom','Email','Business','Type','TikTok','Forfait','Inscrit','Prospects','Statut'];
    const planNames = {starter:'Starter',starter_annual:'Starter Annuel',pro:'Pro',pro_annual:'Pro Annuel',affiliation:'Ambassadeur',free:'Gratuit'};
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
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM UTF-8 pour Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexaai_clients_' + new Date().toISOString().split('T')[0] + '.csv';
    // CORRECTION: appendChild requis pour Firefox (sinon a.click() est silencieux)
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

// CORRECTION: l'intervalle admin démarre à l'ouverture et s'arrête à la fermeture (évite polling permanent)
let _adminIntervalId = null;
let _adminLoading = false;

function renderAdminStats(users) {
    const total = users.length;
    const paying = users.filter(u => u.plan && u.plan !== 'pending').length;
    const free = users.filter(u => !u.plan || u.plan === 'pending').length;
    const suspended = users.filter(u => u.status === 'suspended').length;

    // MRR
    const planPrices = {starter:39, pro:59};
    const mrr = users.filter(u => u.plan && u.plan !== 'pending')
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

    const planPrices = {starter:39, pro:59};
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
        if(!u.plan || u.plan === 'pending') return;
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

    const planColors = {starter:'var(--accent)',starter_annual:'var(--accent)',pro:'#60c8ff',pro_annual:'#60c8ff',affiliation:'#f59e0b',free:'#555'};
    const planNames = {starter:'Starter ✨',starter_annual:'Starter Annuel ✨',pro:'Pro 🚀',pro_annual:'Pro Annuel 🚀',affiliation:'Ambassadeur 🤝',free:'Gratuit'};

    tbody.innerHTML = '';
    users.forEach(u => {
        const plan = u.plan || 'pending';
        const date = new Date(u.created_at || u.createdAt || Date.now());
        const dateStr = date.toLocaleDateString('fr-FR');
        const prospects = (u.prospects || []).length;
        const isSuspended = u.status === 'suspended';
        const statusColor = isSuspended ? '#ff4444' : (plan !== 'pending' ? 'var(--accent)' : '#888');
        const statusLabel = isSuspended ? '🚫 Suspendu' : (plan !== 'pending' ? '✅ Actif' : '⭕ Non qualifié');

        // CORRECTION: utiliser escHtml() plutôt que des remplacements manuels dupliqués
        var em = escHtml(u.email || '');
        var tr = document.createElement('tr');
        if(isSuspended) tr.style.opacity = '0.5';
        tr.innerHTML = [
            '<td style="font-weight:600;">' + escHtml(u.prenom||'-') + '</td>',
            '<td style="color:var(--text-light);font-size:0.82rem;">' + escHtml(u.email||'-') + '</td>',
            '<td style="color:var(--text-light);font-size:0.82rem;">' + escHtml(u.business||'-') + '</td>',
            '<td><span style="background:' + planColors[plan] + '22;color:' + planColors[plan] + ';padding:4px 10px;border-radius:20px;font-size:0.78rem;font-weight:700;">' + planNames[plan] + '</span></td>',
            '<td><select data-email="' + em + '" onchange="adminChangePlan(this,this.dataset.email)" style="padding:5px 8px;background:#000;border:1px solid var(--border);border-radius:6px;color:var(--text-light);font-size:0.8rem;cursor:pointer;">' +
                '<option value="pending"' + (plan==='pending'?' selected':'') + '>Gratuit</option>' +
                '<option value="starter"' + (plan==='starter'?' selected':'') + '>Starter</option>' +
                '<option value="pro"' + (plan==='pro'?' selected':'') + '>Pro</option>' +
                '<option value="affiliation"' + (plan==='affiliation'?' selected':'') + '>Ambassadeur</option>' +
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
    // CORRECTION: fusion des deux versions — recherche texte + filtre dropdown + recherche business
    const filterEl = document.getElementById('admin-filter');
    const filter = filterEl ? filterEl.value : '';
    const q = (search || '').toLowerCase();
    let filtered = allUsers.filter(u =>
        (u.email || '').toLowerCase().includes(q) ||
        (u.prenom || '').toLowerCase().includes(q) ||
        (u.business || '').toLowerCase().includes(q)
    );
    if(filter === 'paying') filtered = filtered.filter(u => u.plan && u.plan !== 'pending');
    else if(filter === 'pending') filtered = filtered.filter(u => !u.plan || u.plan === 'pending');
    else if(filter === 'suspended') filtered = filtered.filter(u => u.status === 'suspended');
    else if(['starter','pro','affiliation'].includes(filter)) filtered = filtered.filter(u => u.plan === filter);
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

async function excludeUser(email) {
    if(!(await adminConfirm('⚠️ Exclure ' + email + ' du site ? Cette action est irréversible.'))) return;
    // CORRECTION: supprimer aussi dans Supabase
    if(sb) sb.from('users').delete().eq('email', email).catch(e => console.error('Supabase delete error:', e));
    let users = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
    users = users.filter(u => u.email !== email);
    localStorage.setItem('nexaai_users', JSON.stringify(users));
    allUsers = allUsers.filter(u => u.email !== email);
    renderAdminStats(allUsers);
    renderAdminUsers(allUsers);
}

function giveAccess(event) {
    const elGiftEmail = document.getElementById('gift-email');
    const elGiftPlan = document.getElementById('gift-plan');
    if(!elGiftEmail || !elGiftPlan) return; // CORRECTION: null-check
    const email = elGiftEmail.value.trim();
    const plan = elGiftPlan.value;
    if(!email) { toast('⚠️ Entre un email !', 'err'); return; }
    // CORRECTION: valider le format email avant insertion
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('❌ Email invalide !', 'err'); return; }
    const users = JSON.parse(localStorage.getItem('nexaai_users') || '[]');
    const i = users.findIndex(u => u.email === email);
    if(i !== -1) { users[i].plan = plan; }
    else { users.push({id:(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)), prenom:email.split('@')[0], email, plan, createdAt:new Date().toISOString(), prospects:[], platforms:[]}); }
    localStorage.setItem('nexaai_users', JSON.stringify(users));
    // CORRECTION: synchroniser aussi dans Supabase pour que le plan persiste
    if(sb) {
        sb.from('users').upsert([{ email, plan }], { onConflict: 'email' })
            .catch(e => console.error('Supabase giveAccess error:', e));
    }
    // CORRECTION: null-check gift-email (utilise elGiftEmail déjà déclaré)
    elGiftEmail.value = '';
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

NOS FORFAITS (à respecter strictement selon le volume de messages) :
- Starter : €39/mois (ou €340 paiement unique = 2 mois offerts) — 40 messages/jour, messages automatisés, dashboard, support email
- Pro : €59/mois (ou €590 paiement unique = 2 mois offerts) — 75 messages/jour, messages ultra-personnalisés, dashboard avancé, support 24/7, API
- Gratuit (Ambassadeur) : €0 — 50 messages/jour via lien d'affiliation

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
Recommande le forfait adapté à son volume de messages :
- 0-40 messages/jour → Starter (40 messages/jour, €39/mois)
- 41-75 messages/jour → Pro (75 messages/jour, €59/mois)
- Affiliation / pas de budget → Gratuit (50 messages/jour, €0)
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
- Si la conversation dérive, tu la ramènes naturellement vers son projet

RÈGLES TECHNIQUES DE PROSPECTION :
- LIMITE DE MESSAGES : tu envoies maximum 6 à 7 messages par prospect. Si le prospect ne montre aucun intérêt après 6-7 messages, tu arrêtes — inutile d'insister sur quelqu'un de froid.
- EXCEPTION CHAUD : si le prospect pose beaucoup de questions ou montre un intérêt réel, tu continues au-delà de la limite sans restriction.
- DÉTECTION PRODUIT AUTOMATIQUE : avant chaque conversation avec un prospect, tu analyses automatiquement le profil du client (business, produit, prix, cible) pour déterminer quel produit lui proposer en priorité. Tu adaptes ton approche et tes arguments en fonction de ce profil pour maximiser les chances de conversion.`;



// ===== FLOATING CHAT =====
function toggleChat() {
    chatOpen = !chatOpen;
    const win = document.getElementById('chatWindow');
    if(!win) return; // CORRECTION: null-check
    if(chatOpen) { win.classList.add('active'); } else { win.classList.remove('active'); }
    if(chatOpen && chatHist.length === 0) {
        addMsg('ai', "Salut 👋 Moi c'est Nexa.\n\nJe vais être directe — en combien de temps tu veux automatiser ta prospection ?", [
            '⚡ Le plus vite possible', '📅 Ce mois-ci', '🤔 Je cherche encore', '💬 Explique-moi d\'abord'
        ]);
    }
}

function addMsg(type, text, opts=[]) {
    const msgs = document.getElementById('chatMsgs');
    if(!msgs) return;
    const d = document.createElement('div');
    d.className = type==='ai' ? 'cmsg-ai' : 'cmsg-user';
    // Échapper le texte avant injection innerHTML (protège contre réponses IA malformées)
    d.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    // CORRECTION: boutons créés via DOM (textContent + onclick closure) — élimine le XSS inline onclick
    if(opts.length) {
        const row = document.createElement('div');
        row.className = 'chat-opts-row';
        opts.forEach(o => {
            const btn = document.createElement('button');
            btn.className = 'copt';
            btn.textContent = o; // textContent = jamais d'injection HTML
            btn.onclick = () => optClick(o);
            row.appendChild(btn);
        });
        d.appendChild(row);
    }
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
}

function optClick(opt) { sendChatMsg(opt); }


let awaitingAdminPwd = false;
let _chatSending = false; // guard contre les double-envois
// dashChatHist est déclaré globalement en haut du fichier

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
        // CORRECTION: ne pas conserver le mot de passe dans l'historique (évite fuite en logs)
        const pwdToSend = text.trim();
        chatHist = chatHist.filter(m => m.content !== text); // retirer le message s'il a été ajouté
        // Vérification admin via Netlify (function claude)
        fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminAuth: true, password: pwdToSend })
        }).then(r => r.text()).then(raw => {
            let data = {};
            try { data = raw ? JSON.parse(raw) : {}; } catch(e) { data = {}; }
            awaitingAdminPwd = false;
            if(data.ok) {
                addMsg('ai', '✅ Accès accordé ! Ouverture du panel admin...');
                setTimeout(() => {
                    toggleChat();
                    const ap1233 = document.getElementById('adminPanel');
                    if(ap1233) ap1233.style.display = 'block';
                    document.body.style.overflow = 'hidden';
                    loadAdminData();
                    if(!_adminIntervalId) {
                        _adminIntervalId = setInterval(() => {
                            if(!_adminLoading) {
                                _adminLoading = true;
                                loadAdminData().finally(() => { _adminLoading = false; });
                            }
                        }, 10000);
                    }
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

    if(_chatSending) return; // CORRECTION: éviter double-envoi (vérifié en premier, avant tout affichage)
    _chatSending = true;
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
                message: text,
                history: chatHist.slice(0, -1),
                system: SYS + (CLIENT_STORE_URL
                    && /^https?:\/\/[^\s]{1,200}$/.test(CLIENT_STORE_URL.trim())
                    ? '\n\nLien de vente du client : ' + CLIENT_STORE_URL.trim().slice(0, 200)
                    : '')
            })
        });
        const rawChat = await res.text();
        let data = {};
        try { data = rawChat ? JSON.parse(rawChat) : {}; } catch(e) { throw new Error('Réponse serveur invalide'); }
        const tb2 = document.getElementById('typingBubble');
        if(tb2) tb2.style.display = 'none';
        // claude.js retourne { reply: "..." }
        if(data.reply) {
            let reply = data.reply;
            chatHist.push({role:'assistant',content:reply});
            if(reply.includes('REDIRECT')) {
                reply = reply.replace('REDIRECT','');
                addMsg('ai', reply.trim());
                _chatSending = false; // CORRECTION: libérer le guard avant le return
                setTimeout(() => { toggleChat(); const pr = document.getElementById('pricing'); if(pr) pr.scrollIntoView({behavior:'smooth'}); }, 1500);
                return;
            }
            let opts = [];
            const lower = reply.toLowerCase();
            if(lower.includes('starter') && lower.includes('pro')) opts = ['🚀 Starter — €39/mois','💎 Pro — €59/mois','❓ Question'];
            else if(lower.includes('starter')) opts = ['✅ Je prends le Starter','💎 C\'est quoi le Pro ?'];
            else if(lower.includes('pro')) opts = ['🔥 Je prends le Pro !','🔰 Le Starter suffit ?'];
            addMsg('ai', reply, opts);
        }
        _chatSending = false; // CORRECTION: libérer le guard (aussi si content vide)
    } catch(err) {
        // CORRECTION: retirer le message user du historique si l'appel API échoue
        chatHist.pop();
        _chatSending = false; // CORRECTION: libérer le guard en cas d'erreur
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
    // Indicateur de chargement (id unique pour éviter conflits)
    const loadingId = 'dash-loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'dash-msg-ai';
    loadingDiv.id = loadingId;
    loadingDiv.textContent = '...';
    msgs.appendChild(loadingDiv);
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
            + ' | Plan: ' + (user.plan||'pending')
            + ' | Pays: ' + (user.pays||nr)
            + ' | En tant que Nexa agent IA personnel, utilise ces infos pour conseiller ultra-personnalise, aider a rediger des messages de closing, calculer le potentiel de revenus et motiver avec des donnees concretes.';
        const fullSystem = SYS + '\n\nContexte client: ' + ctx;
        dashChatHist.push({ role: 'user', content: text });
        // CORRECTION: tronquer l'historique pour éviter de dépasser la limite de tokens API
        if(dashChatHist.length > 20) dashChatHist = dashChatHist.slice(-20);
        const res = await fetch(PROXY_URL, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ message: text, history: dashChatHist.slice(0,-1) })
        });
        const rawDash = await res.text();
        let data = {};
        try { data = rawDash ? JSON.parse(rawDash) : {}; } catch(e) { throw new Error('Réponse serveur invalide'); }
        const loadEl = document.getElementById(loadingId);
        if(loadEl) loadEl.remove();
        // claude.js retourne { reply: "..." }
        if(data.reply) {
            const replyText = data.reply;
            dashChatHist.push({ role: 'assistant', content: replyText });
            const ad = document.createElement('div');
            ad.className = 'dash-msg-ai';
            // CORRECTION: échapper le texte avant injection innerHTML
            ad.innerHTML = replyText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
            msgs.appendChild(ad);
            msgs.scrollTop = msgs.scrollHeight;
        } else {
            // CORRECTION: afficher un message d'erreur si la réponse est vide
            const ed = document.createElement('div');
            ed.className = 'dash-msg-ai';
            ed.textContent = 'Réponse vide, réessaie !';
            msgs.appendChild(ed);
        }
    } catch(err) {
        // CORRECTION: retirer le message user du historique ET du DOM si l'appel API échoue
        dashChatHist.pop();
        if(ud && ud.parentNode) ud.remove();
        const loadElErr = document.getElementById(loadingId);
        if(loadElErr) loadElErr.remove(); // CORRECTION: retirer l'indicateur en cas d'erreur
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
- Starter : €39/mois — 40 messages/jour
- Pro : €59/mois — 75 messages/jour
- Ambassadeur : €0 (Affiliation 20/80 — tu reçois 20% sur chaque vente via ton lien) — 50 messages/jour

ÉTAPE 1 : Prénom.
ÉTAPE 2 : Business (Nom, Produit, Prix, Cible).
ÉTAPE 3 : TikTok (Pseudo, Followers, DMs/jour).
ÉTAPE 4 : Calculer le manque à gagner (Urgence).
ÉTAPE 5 : Recommander le forfait. Termine par "CHOIX_FORFAIT".`;

function botQualifyStart(email) {
    // Vérification — si l'utilisateur a déjà tout configuré, ne pas repasser par le bot
    const existingUser = JSON.parse(localStorage.getItem('nexaai_user') || '{}');
    if(existingUser.email === email) {
        const alreadyDone = (existingUser.plan && existingUser.plan !== 'pending') || existingUser.stripe_connect_id;
        if(alreadyDone) {
            loadDashboard(existingUser).then(() => showPage('dashboard-page'));
            return;
        }
        // Préremplir bqData avec ce qu'on a déjà pour ne pas redemander
        if(existingUser.prenom) bqData.prenom = existingUser.prenom;
        if(existingUser.business) bqData.business = existingUser.business;
        if(existingUser.tiktok_pseudo) bqData.tiktok = existingUser.tiktok_pseudo;
    }

    bqHist = [];
    bqStep = 0;
    bqData = { ...bqData, email };
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
    // CORRECTION: échapper le texte avant injection innerHTML
    d.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    const optsDiv = document.getElementById('bq-opts');
    if(!optsDiv) return; // CORRECTION: null-check
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
    if(!msgs) return; // CORRECTION: null-check
    const d = document.createElement('div');
    d.style.cssText = 'background:linear-gradient(90deg,var(--accent),#2dd10f);color:#000;border-radius:14px;padding:12px 16px;max-width:85%;align-self:flex-end;font-weight:600;font-size:0.88rem;animation:slideR 0.3s ease;margin-left:auto;margin-bottom:10px;';
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    bqSendToAI(text);
}

function bqSend() {
    const inp = document.getElementById('bq-input');
    if(!inp) return;
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
        bqHist.pop();
        bqData._affStep = 'choose_mode';
        bqAIMsg(
            "Super ! 🤝 Plan Ambassadeur — voici comment ça marche :\n\n" +
            "🔹 Mode 1 — L'IA close pour toi : Nexa analyse les profils TikTok, gère tes DMs et close tes ventes. Nexa prend 80%, tu reçois 20% de chaque vente.\n\n" +
            "🔹 Mode 2 — Tu partages ton lien : Tu mets ton lien en bio TikTok. À chaque abonnement Nexa via ton lien, tu reçois 20%, Nexa garde 80%.\n\nLequel tu choisis ?",
            ['🤖 Mode 1 — L\'IA close pour moi', '🔗 Mode 2 — Je partage mon lien']
        );
        return;
    }

    // 1b. Choix du mode
    if (bqData._affStep === 'choose_mode') {
        bqHist.pop();
        if (lower.includes('mode 1') || lower.includes('ia close') || lower.includes('close pour moi')) {
            bqData._affMode = 'ia_close';
            bqData._affStep = 'ask_stripe';
            bqAIMsg(
                "Parfait 🤖 Pour que Nexa puisse reverser tes 20% automatiquement, j'ai besoin de ton identifiant Stripe Connect.\n\n" +
                "👉 Va sur dashboard.stripe.com → ton ID commence par acct_\n\nEnvoie-moi ton ID Stripe :"
            );
        } else {
            bqData._affMode = 'lien';
            bqData._affStep = 'ask_stripe';
            bqAIMsg(
                "Top 🔗 Pour que Nexa génère ton lien d'affiliation et reverse tes 20%, j'ai besoin de ton identifiant Stripe Connect.\n\n" +
                "👉 Va sur dashboard.stripe.com → ton ID commence par acct_\n\nEnvoie-moi ton ID Stripe :"
            );
        }
        return;
    }

    // 1c. Réception ID Stripe
    if (bqData._affStep === 'ask_stripe') {
        bqHist.pop();
        const stripeIdMatch = userText.trim().match(/acct_[a-zA-Z0-9]+/);
        if (!stripeIdMatch) {
            bqAIMsg("❌ Cet ID ne semble pas valide. Il doit commencer par acct_ suivi de lettres et chiffres.\n\nRéessaie :");
            return;
        }
        bqData.stripe_connect_id = stripeIdMatch[0];

        if (bqData._affMode === 'ia_close') {
            // Mode IA close → on crée la page produit → demander le nom du produit
            bqData._affStep = 'ask_product_name';
            bqAIMsg(
                "✅ ID Stripe enregistré !\n\n" +
                "Maintenant je vais créer ta page de vente sur Nexa. C'est toi qui vends, moi je prospecte et je close.\n\n" +
                "C'est quoi le nom de ton produit ou service ?"
            );
        } else {
            // Mode lien → finaliser directement
            bqData._affStep = 'done';
            await _finalizeAmbassadeur();
        }
        return;
    }

    // 1d. Mode IA close — Nom du produit
    if (bqData._affStep === 'ask_product_name') {
        bqHist.pop();
        const nom = userText.trim().slice(0, 100);
        if (!nom || nom.length < 2) {
            bqAIMsg("❌ Donne-moi un vrai nom de produit !\n\nExemple : \"Formation TikTok\", \"Coaching business\" ...");
            return;
        }
        bqData._productName = nom;
        bqData._affStep = 'ask_product_price';
        bqAIMsg(`Super — "${nom}" 👍\n\nC'est vendu à quel prix ? (juste le chiffre en €)`);
        return;
    }

    // 1e. Mode IA close — Prix
    if (bqData._affStep === 'ask_product_price') {
        bqHist.pop();
        const priceMatch = userText.trim().match(/\d+([.,]\d{1,2})?/);
        if (!priceMatch) {
            bqAIMsg("❌ Je n'ai pas reconnu de prix. Envoie juste un chiffre, ex : 97");
            return;
        }
        const price = parseFloat(priceMatch[0].replace(',', '.'));
        if (price < 1 || price > 50000) {
            bqAIMsg("❌ Le prix doit être entre 1€ et 50 000€. Réessaie :");
            return;
        }
        bqData._productPrice = price;
        bqData._affStep = 'ask_product_description';
        bqAIMsg(`${price}€ 💰\n\nDécris ton produit en 2-3 phrases. Qu'est-ce que ça apporte concrètement à l'acheteur ?`);
        return;
    }

    // 1f. Mode IA close — Description
    if (bqData._affStep === 'ask_product_description') {
        bqHist.pop();
        const desc = userText.trim().slice(0, 300);
        if (!desc || desc.length < 10) {
            bqAIMsg("❌ Donne-moi une vraie description — au moins une phrase complète.");
            return;
        }
        bqData._productDesc = desc;
        bqData._affStep = 'ask_product_design';
        bqAIMsg(
            "Parfait 👌\n\nMaintenant choisis le design de ta page de vente :\n\n" +
            "🖤 Design 1 — Minimaliste : fond noir, texte blanc, accent vert. Simple, moderne, crédible. Idéal pour coaching et formation.\n\n" +
            "✨ Design 2 — Premium : dégradé sombre, touches dorées, typographie élégante. Parfait pour produits haut de gamme.\n\n" +
            "⚡ Design 3 — Énergie : fond blanc, couleurs vives, bold. Parfait pour sport, bien-être, e-commerce.\n\nLequel tu choisis ?",
            ['🖤 Minimaliste', '✨ Premium', '⚡ Énergie']
        );
        return;
    }

    // Design
    if (bqData._affStep === 'ask_product_design') {
        bqHist.pop();
        if (lower.includes('minimal') || lower.includes('1') || lower.includes('noir')) {
            bqData._productDesign = 'minimal';
        } else if (lower.includes('premium') || lower.includes('2') || lower.includes('dor')) {
            bqData._productDesign = 'premium';
        } else {
            bqData._productDesign = 'energy';
        }
        bqData._affStep = 'ask_product_guarantee';
        bqAIMsg(
            "Super choix ! 🎨\n\nTu offres une garantie ? Ex : \"Satisfait ou remboursé 30 jours\", \"Résultats garantis ou remboursé\"\n\nSi non, réponds non.",
            ['✅ Satisfait ou remboursé 30 jours', '✅ Résultats garantis', '❌ Pas de garantie']
        );
        return;
    }

    // Garantie
    if (bqData._affStep === 'ask_product_guarantee') {
        bqHist.pop();
        if (lower.includes('non') || lower.includes('pas')) {
            bqData._productGuarantee = '';
        } else {
            bqData._productGuarantee = userText.trim().slice(0, 150);
        }
        bqData._affStep = 'ask_product_spots';
        bqAIMsg(
            "👍\n\nTu veux limiter les places disponibles ? C'est un outil marketing puissant.\n\nEx : \"Plus que 10 places disponibles\"\n\nSi non, réponds non.",
            ['✅ Oui — 5 places', '✅ Oui — 10 places', '✅ Oui — 20 places', '❌ Non']
        );
        return;
    }

    // Places limitées
    if (bqData._affStep === 'ask_product_spots') {
        bqHist.pop();
        if (lower.includes('non') || lower.includes('pas')) {
            bqData._productSpots = null;
        } else {
            const spotsMatch = userText.match(/\d+/);
            bqData._productSpots = spotsMatch ? parseInt(spotsMatch[0]) : null;
        }
        bqData._affStep = 'ask_product_testimonials';
        bqAIMsg(
            "Presque fini ! 🙌\n\nTu as des témoignages clients à mettre sur ta page ?\n\nEnvoie-les dans ce format :\n" +
            "Prénom : Marie\nAvis : \"Cette formation a changé ma vie, j'ai fait 2000€ en 3 semaines !\"\n\n" +
            "Tu peux en mettre jusqu'à 3. Si tu n'en as pas, réponds non."
        );
        return;
    }

    // Témoignages
    if (bqData._affStep === 'ask_product_testimonials') {
        bqHist.pop();
        if (lower.includes('non') || lower.includes('pas')) {
            bqData._productTestimonials = [];
        } else {
            // Parser les témoignages du texte libre
            const lines = userText.split('\n').filter(l => l.trim());
            const testimonials = [];
            let current = {};
            for (const line of lines) {
                if (line.toLowerCase().includes('prénom') || line.toLowerCase().includes('prenom')) {
                    if (current.name && current.text) testimonials.push(current);
                    current = { name: line.split(':').slice(1).join(':').trim() };
                } else if (line.toLowerCase().includes('avis')) {
                    current.text = line.split(':').slice(1).join(':').trim().replace(/['"]/g, '');
                }
            }
            if (current.name && current.text) testimonials.push(current);
            bqData._productTestimonials = testimonials.slice(0, 3);
        }
        bqData._affStep = 'ask_product_niche';
        bqAIMsg(
            "Super ! Dernière question 💪\n\nQuelle est ta niche ? Dans quel secteur tu vends ?\n\n" +
            "Ex : coaching business, formation TikTok, e-commerce, dropshipping, bien-être, sport...",
            ['💼 Coaching / Formation', '🛒 E-commerce', '📱 Réseaux sociaux', '💪 Sport / Bien-être', '🏠 Immobilier', '🎨 Autre']
        );
        return;
    }

    // 1g. Mode IA close — Niche → Analyse IA
    if (bqData._affStep === 'ask_product_niche') {
        bqHist.pop();
        bqData._productNiche = userText.trim().slice(0, 100);
        bqData._affStep = 'analyzing_niche';

        bqAIMsg("⏳ J'analyse ta niche et ton produit...");

        // Appel à l'IA pour analyser la niche
        try {
            const analyzeRes = await fetch('/.netlify/functions/analyze-niche', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    niche: bqData._productNiche,
                    product_name: bqData._productName,
                    product_price: bqData._productPrice,
                    description: bqData._productDesc
                })
            });
            const analyzeData = await analyzeRes.json();
            const score = analyzeData.score || 0;
            const verdict = analyzeData.verdict || '';
            const suggestion = analyzeData.suggestion || '';

            bqData._nicheScore = score;
            bqData._nicheVerdict = verdict;

            if (score >= 50) {
                // ✅ Niche acceptable → continuer
                bqData._affStep = 'niche_accepted';
                bqAIMsg(
                    `✅ Bonne nouvelle !\n\n${verdict}\n\n` +
                    `Score niche : ${score}/100 — tu as de bonnes chances de convertir avec Nexa.\n\n` +
                    `Je crée ta page de vente maintenant. Une seconde...`
                );
                await _createProductAndFinalize();
            } else {
                // ❌ Niche faible → honnêteté + proposition
                bqData._affStep = 'niche_rejected_proposal';
                bqData._nicheSuggestion = suggestion;
                bqAIMsg(
                    `⚠️ Je dois être honnête avec toi.\n\n${verdict}\n\n` +
                    `Score niche : ${score}/100 — avec cette niche, tu risques de faire très peu de ventes ` +
                    `et Nexa va travailler pour rien.\n\n` +
                    `Par contre, voici ce qui pourrait vraiment marcher pour toi :\n\n` +
                    `💡 ${suggestion}\n\n` +
                    `Tu veux qu'on parte sur cette direction à la place ?`,
                    ['✅ Oui, je veux essayer ça !', '❌ Non, je reste sur mon idée']
                );
            }
        } catch(e) {
            console.error('analyze-niche error:', e);
            // En cas d'erreur API → on laisse passer avec un warning
            bqData._affStep = 'niche_accepted';
            bqAIMsg("⚠️ Analyse indisponible, je crée ta page quand même. Une seconde...");
            await _createProductAndFinalize();
        }
        return;
    }

    // 1h. Réponse au verdict niche faible
    if (bqData._affStep === 'niche_rejected_proposal') {
        bqHist.pop();
        if (lower.includes('oui') || lower.includes('essayer') || lower.includes('ok') || lower.includes('accord')) {
            // ✅ Client accepte la suggestion → créer avec la nouvelle niche
            bqData._productNiche = bqData._nicheSuggestion || bqData._productNiche;
            bqData._affStep = 'niche_accepted';
            bqAIMsg("🔥 Excellent choix ! Je crée ta page avec cette direction. Une seconde...");
            await _createProductAndFinalize();
        } else {
            // ❌ Client refuse → on ne bloque pas, on dit juste non
            bqData._affStep = 'done_refused';
            bqAIMsg(
                "Je comprends ton choix. Mais je ne changerai pas d'avis — avec cette niche, " +
                "Nexa ne pourra pas faire de résultats et je ne veux pas te faire perdre ton temps.\n\n" +
                "Si un jour tu veux repartir sur une niche qui convertit vraiment, reviens me voir. " +
                "La porte est ouverte. 💪"
            );
        }
        return;
    }

    // Helper — créer le produit dans Supabase et finaliser (déclaré dans bqSendToAI pour accès à bqData/bqAIMsg)
    // Note: voir aussi _createProductAndFinalize / _finalizeAmbassadeur définis après bqSendToAI
    async function _createProductAndFinalize() {
        try {
            const productRes = await fetch('/.netlify/functions/create-product', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email:            bqData.email,
                    stripe_connect_id:bqData.stripe_connect_id,
                    name:             bqData._productName,
                    price:            bqData._productPrice,
                    description:      bqData._productDesc,
                    niche:            bqData._productNiche,
                    niche_score:      bqData._nicheScore  || 50,
                    design:           bqData._productDesign       || 'minimal',
                    testimonials:     bqData._productTestimonials || [],
                    guarantee:        bqData._productGuarantee    || '',
                    spots_left:       bqData._productSpots        || null
                })
            });
            const productData = await productRes.json();
            if (!productData.success) throw new Error('Création produit échouée');
            await _finalizeAmbassadeur();
        } catch(e) {
            console.error('_createProductAndFinalize error:', e);
            bqAIMsg("❌ Une erreur est survenue lors de la création. Réessaie !");
        }
    }

    // Helper interne — finalise l'enregistrement ambassadeur
    async function _finalizeAmbassadeur() {
        try {
            await saveUserToDB({
                email: bqData.email,
                plan: 'affiliation',
                prenom: bqData.prenom || 'Ambassadeur',
                stripe_connect_id: bqData.stripe_connect_id || '',
                store_url: bqData.store_url || '',
                affiliation_mode: bqData._affMode || 'lien'
            });
            const userAff = LS.user() || {};
            userAff.stripe_connect_id = bqData.stripe_connect_id || '';
            userAff.store_url = bqData.store_url || '';
            userAff.affiliation_mode = bqData._affMode || 'lien';
            userAff.plan = 'affiliation';

            const shopLink = window.location.origin + '/shop/' + (bqData.stripe_connect_id || '');
            const affLink  = window.location.origin + '?ref=' + (bqData.stripe_connect_id || '');

            // Sauvegarder les liens dans le profil pour les retrouver dans le dashboard
            userAff.shop_url = shopLink;
            userAff.aff_link = affLink;
            LS.setUser(userAff);
            await saveUserToDB({ email: userAff.email, shop_url: shopLink });

            if (bqData._affMode === 'ia_close') {
                bqAIMsg(
                    "🎉 Tout est prêt !\n\n" +
                    "🛍️ Ta page de vente :\n" + shopLink + "\n\n" +
                    "🔗 Ton lien d'affiliation :\n" + affLink + "\n\n" +
                    "Nexa va prospecter sur TikTok et envoyer tes clients sur ta page. " +
                    "Tu reçois 20% de chaque vente automatiquement sur ton Stripe.\n\n" +
                    "Accède à ton dashboard pour suivre tes ventes 👇"
                );
            } else {
                bqAIMsg(
                    "🎉 Tout est configuré !\n\n" +
                    "🔗 Ton lien d'affiliation :\n" + affLink + "\n\n" +
                    "Mets ce lien en bio TikTok. À chaque abonnement Nexa via ce lien, " +
                    "tu reçois 20% automatiquement sur ton Stripe.\n\nAccède à ton dashboard 👇"
                );
            }
            if (userAff.email) await loadDashboard(userAff);
            showPage('dashboard-page');
        } catch(saveErr) {
            console.error('saveUserToDB error (affiliation):', saveErr);
            bqAIMsg("Une erreur est survenue, réessaie !");
        }
    }

    // 2. Détection Forfaits Payants
    const planMap = [
        { keys: ['starter', '39'], plan: 'starter', name: 'Starter', price: '€39' },
        { keys: ['pro', '59'], plan: 'pro', name: 'Pro 🎯', price: '€59' }
    ];

    for(const p of planMap) {
        if(p.keys.some(k => lower.includes(k)) && bqStep >= 4) {
            bqData.plan = p.plan;
            try {
                await saveUserToDB({ email: bqData.email, plan: p.plan, prenom: bqData.prenom || 'Client Premium' });
                // CORRECTION: pop() uniquement si saveUserToDB réussit — évite état incohérent
                bqHist.pop();
                bqAIMsg(`Option ${p.name} sélectionnée ! 🔥 On lance l'artillerie lourde.`);
                bqAIMsg("Pour injecter mon IA sur ton compte, envoie-moi ton NOM complet et l'URL de ton tunnel.");
                bqAIMsg("Je t'envoie le lien de paiement sécurisé juste après.");
            } catch(saveErr) {
                console.error('saveUserToDB error (plan):', saveErr);
                bqAIMsg("Une erreur est survenue, réessaie !");
            }
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
            // claude.js attend { message, history } et retourne { reply }
            body: JSON.stringify({ message: bqHist[bqHist.length-1]?.content || '', history: bqHist.slice(0,-1) })
        });
        const raw = await res.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch(e) { throw new Error('Réponse serveur invalide (HTTP ' + res.status + ')'); }
        const bqTypH = document.getElementById('bq-typing');
        if(bqTypH) bqTypH.style.display = 'none';

        if(data.reply) {
            let reply = data.reply;
            bqHist.push({ role: 'assistant', content: reply });

            const progressBar = document.getElementById('bq-progress');

            if(reply.includes('CHOIX_FORFAIT')) {
                reply = reply.replace('CHOIX_FORFAIT', '').trim();
                bqStep = 5;
                if(progressBar) progressBar.style.width = '100%';
                bqAIMsg(reply, [
                    '🤝 Plan Ambassadeur — €0',
                    '⚡ Starter — €39/mois',
                    '🚀 Pro — €59/mois'
                ]);
            } else {
                bqStep++;
                const progress = Math.min((bqStep / 5) * 100, 100);
                if(progressBar) progressBar.style.width = progress + '%';
                bqAIMsg(reply);
            }
        } else {
            // CORRECTION: masquer le spinner si la réponse est vide (évite spinner bloqué indéfiniment)
            const bqTypEmpty = document.getElementById('bq-typing');
            if(bqTypEmpty) bqTypEmpty.style.display = 'none';
            bqAIMsg('Nexa réfléchit encore... Réessaie !');
        }
    } catch(err) {
        // CORRECTION: retirer le message user du historique si l'appel API échoue
        // (évite deux messages 'user' consécutifs qui invalident l'API)
        bqHist.pop();
        const bqTypC = document.getElementById('bq-typing');
        if(bqTypC) bqTypC.style.display = 'none';
        bqAIMsg('Nexa analyse tes données... Continue !');
    }
}
