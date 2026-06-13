/**
 * NEXA TIKTOK DM BOT — Bot 100% automatique
 * 1. Analyse les profils TikTok de la niche du client
 * 2. Score 0-100 — si > 50 → envoie le premier DM
 * 3. Répond automatiquement à tous les DMs entrants
 * 4. Close la vente
 * 
 * ⚠️ Héberger sur Railway (connecté GitHub) — pas Netlify
 * Pour démarrer : node tiktok-dm-bot.js
 */

const puppeteer  = require('puppeteer');
const Anthropic  = require('@anthropic-ai/sdk');

const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const CONFIG = {
  checkIntervalMs:      5 * 60 * 1000,  // Vérifier toutes les 5 min
  delayBetweenDmsMs:    45 * 1000,      // 45s entre chaque DM (anti-ban)
  delayBetweenSearchMs: 10 * 1000,      // 10s entre chaque recherche profil
  maxDmsPerHour:        15,             // Max 15 DMs/heure par compte
  maxDmsPerDay:         80,             // Max 80 DMs/jour par compte
  typingDelayMs:        1200,           // Simuler frappe humaine
  minScoreToContact:    50,             // Score minimum pour DM
};

// ════════════════════════════════════════════════════════════════
// 🛡️ RATE LIMITING PAR COMPTE
// ════════════════════════════════════════════════════════════════

const dmCounters = {};

// Limites de MESSAGES par jour — synchronisées avec payment.js
// Ce sont des messages (réponses dans les conversations), pas des DMs initiaux
const PLAN_LIMITS = {
  affiliation: { perHour: 10, perDay: 50 },
  starter:     { perHour: 8,  perDay: 40 },
  pro:         { perHour: 15, perDay: 75 },
};

function checkDmLimit(clientId, plan) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.affiliation;
  const now = Date.now();
  if (!dmCounters[clientId]) {
    dmCounters[clientId] = { hour: 0, day: 0, lastHourReset: now, lastDayReset: now };
  }
  const c = dmCounters[clientId];
  if (now - c.lastHourReset > 3600000) { c.hour = 0; c.lastHourReset = now; }
  if (now - c.lastDayReset > 86400000) { c.day = 0; c.lastDayReset = now; }
  if (c.hour >= limits.perHour || c.day >= limits.perDay) return false;
  c.hour++; c.day++;
  return true;
}

// ════════════════════════════════════════════════════════════════
// 🛡️ DÉTECTION MALVEILLANTS
// ════════════════════════════════════════════════════════════════

function isMalicious(text) {
  if (!text) return false;
  const patterns = [
    /(.)\1{15,}/,
    /http[s]?:\/\//i,
    /\b(hack|ban|report|scam|arnaque|pirate)\b/i,
    /[^\x00-\x7F]{100,}/,
    /<script/i,
  ];
  return patterns.some(p => p.test(text));
}

// ════════════════════════════════════════════════════════════════
// 🤖 ANALYSER UN PROFIL — SCORE 0-100
// ════════════════════════════════════════════════════════════════

async function scoreProfile({ username, bio, followers, niche, productName }) {
  const response = await aiClient.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 200,
    temperature: 0.3,
    system: `Tu analyses des profils TikTok pour voir s'ils correspondent à notre cible.
Réponds UNIQUEMENT en JSON : { "score": 0-100, "reason": "raison courte" }
Score > 50 = on les contacte. Score < 50 = on passe.`,
    messages: [{
      role: 'user',
      content: `Profil TikTok :
Username : @${username}
Bio : ${bio || 'vide'}
Followers : ${followers || 'inconnu'}
Notre niche : ${niche}
Notre produit : ${productName}

Score ce profil.`
    }]
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { score: 0, reason: 'parse error' };
  try { return JSON.parse(match[0]); } catch { return { score: 0, reason: 'parse error' }; }
}

// ════════════════════════════════════════════════════════════════
// 💬 GÉNÉRER PREMIER DM
// ════════════════════════════════════════════════════════════════

async function generateFirstDM({ username, bio, productName, productDesc, shopUrl }) {
  const response = await aiClient.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 150,
    temperature: 0.8,
    system: `Tu envoies un premier DM TikTok naturel et humain.
RÈGLES STRICTES :
- 1-2 phrases max — style SMS
- Accroche personnalisée basée sur le profil
- Jamais de lien dans le premier message
- Jamais de pitch de vente direct
- Créer de la curiosité ou poser une question
- Jamais dire que tu es une IA
- Toujours en français`,
    messages: [{
      role: 'user',
      content: `Profil cible : @${username}
Bio : ${bio || 'vide'}
Produit à vendre : ${productName}
Description : ${productDesc}

Génère le premier DM d'accroche.`
    }]
  });

  return response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
}

// ════════════════════════════════════════════════════════════════
// 💬 GÉNÉRER RÉPONSE DM
// ════════════════════════════════════════════════════════════════

async function generateDMReply({ incomingMessage, history, productName, productDesc, shopUrl }) {
  const response = await aiClient.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 200,
    temperature: 0.7,
    system: `Tu es un assistant de vente naturel sur TikTok DM.
Produit : ${productName}
Description : ${productDesc}
Lien de vente : ${shopUrl}

RÈGLES :
- 1-3 phrases max — style SMS
- Adapte ton ton à la personne
- Pousse vers le lien SEULEMENT si la personne est clairement intéressée
- Si hostile ou malveillant → réponds poliment et arrête
- Si on te demande si tu es une IA → dis oui honnêtement
- Jamais de fausse urgence`,
    messages: [
      ...(history || []).slice(-8),
      { role: 'user', content: incomingMessage }
    ]
  });

  return response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
}

// ════════════════════════════════════════════════════════════════
// 🌐 SUPABASE — RÉCUPÉRER LES CLIENTS
// ════════════════════════════════════════════════════════════════

async function getActiveClients() {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/users?plan=in.(affiliation,starter,pro)&status=eq.active&select=id,email,prenom,plan,tiktok_username,tiktok_password_encrypted,stripe_connect_id`,
    { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } }
  );
  if (!res.ok) return [];
  return await res.json();
}

async function getClientProduct(stripeConnectId) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/products?stripe_connect_id=eq.${encodeURIComponent(stripeConnectId)}&status=eq.active&select=name,description,niche&limit=1`,
    { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

// ════════════════════════════════════════════════════════════════
// 🤖 BOT PUPPETEER PRINCIPAL
// ════════════════════════════════════════════════════════════════

async function runBotForClient(clientData, product) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      ],
    });

    const page = await browser.newPage();

    // Masquer Puppeteer
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    // ── 1. CONNEXION TIKTOK ─────────────────────────────────────
    console.log(`🔑 Connexion TikTok pour ${clientData.prenom}...`);
    await page.goto('https://www.tiktok.com/login/phone-or-email/email', { waitUntil: 'networkidle2' });
    await page.waitForTimeout(2000 + Math.random() * 1000);

    await page.type('[name="username"]', clientData.tiktok_username, { delay: 80 + Math.random() * 40 });
    await page.waitForTimeout(500);
    await page.type('[type="password"]', clientData.tiktok_password_encrypted, { delay: 80 + Math.random() * 40 });
    await page.waitForTimeout(500);
    await page.click('[type="submit"]');
    await page.waitForTimeout(4000);

    const shopUrl = `${process.env.SITE_URL}/shop/${clientData.stripe_connect_id}`;

    // ── 2. RECHERCHER DES PROFILS À CONTACTER ──────────────────
    console.log(`🔍 Recherche profils pour niche: ${product.niche}...`);
    await page.goto(`https://www.tiktok.com/search/user?q=${encodeURIComponent(product.niche)}`, { waitUntil: 'networkidle2' });
    await page.waitForTimeout(3000);

    const profiles = await page.$$eval('[data-e2e="search-user-info"]', els =>
      els.slice(0, 20).map(el => ({
        username: el.querySelector('[data-e2e="search-user-unique-id"]')?.textContent?.replace('@', '') || '',
        bio: el.querySelector('[data-e2e="search-user-desc"]')?.textContent || '',
        followers: el.querySelector('[data-e2e="search-user-follower-count"]')?.textContent || '0',
      }))
    ).catch(() => []);

    console.log(`📋 ${profiles.length} profils trouvés`);

    // ── 3. ANALYSER ET DM LES PROFILS CHAUDS ───────────────────
    for (const profile of profiles) {
      if (!profile.username) continue;
      if (!checkDmLimit(clientData.id, clientData.plan)) {
        console.log(`⚠️ Limite DM atteinte pour ${clientData.prenom} (${clientData.plan})`);
        break;
      }

      // Scorer le profil
      const { score, reason } = await scoreProfile({
        username: profile.username,
        bio: profile.bio,
        followers: profile.followers,
        niche: product.niche,
        productName: product.name,
      });

      console.log(`📊 @${profile.username} — score: ${score} (${reason})`);

      if (score < CONFIG.minScoreToContact) continue;

      // Générer le premier DM
      const firstDM = await generateFirstDM({
        username: profile.username,
        bio: profile.bio,
        productName: product.name,
        productDesc: product.description,
        shopUrl,
      });

      if (!firstDM) continue;

      // Aller sur le profil et envoyer le DM
      await page.goto(`https://www.tiktok.com/@${profile.username}`, { waitUntil: 'networkidle2' });
      await page.waitForTimeout(2000);

      const msgBtn = await page.$('[data-e2e="message-icon"]');
      if (!msgBtn) continue;

      await msgBtn.click();
      await page.waitForTimeout(2000);

      const input = await page.$('[data-e2e="message-input"]');
      if (!input) continue;

      await input.click();
      await page.waitForTimeout(CONFIG.typingDelayMs);
      await input.type(firstDM, { delay: 40 + Math.random() * 60 });
      await page.waitForTimeout(500 + Math.random() * 500);
      await page.keyboard.press('Enter');

      console.log(`✅ Premier DM envoyé à @${profile.username}: ${firstDM.slice(0, 50)}...`);

      await page.waitForTimeout(CONFIG.delayBetweenDmsMs);
      await page.waitForTimeout(CONFIG.delayBetweenSearchMs);
    }

    // ── 4. RÉPONDRE AUX DMs ENTRANTS ───────────────────────────
    console.log(`💬 Vérification des DMs entrants pour ${clientData.prenom}...`);
    await page.goto('https://www.tiktok.com/messages', { waitUntil: 'networkidle2' });
    await page.waitForTimeout(2000);

    const conversations = await page.$$('[data-e2e="message-item"]');

    for (const conv of conversations.slice(0, 15)) {
      if (!checkDmLimit(clientData.id, clientData.plan)) break;

      await conv.click();
      await page.waitForTimeout(1500);

      const messages = await page.$$eval('[data-e2e="message-bubble"]', els =>
        els.map(el => ({
          text: el.textContent.trim(),
          isOwn: el.classList.contains('own')
        }))
      ).catch(() => []);

      const lastMessage = messages.filter(m => !m.isOwn).pop();
      if (!lastMessage?.text) continue;
      if (isMalicious(lastMessage.text)) {
        console.log(`🚫 Message malveillant ignoré`);
        continue;
      }

      // Vérifier que le dernier message n'est pas déjà de nous
      const lastOverall = messages[messages.length - 1];
      if (lastOverall?.isOwn) continue;

      const history = messages.slice(-8).map(m => ({
        role: m.isOwn ? 'assistant' : 'user',
        content: m.text,
      }));

      const reply = await generateDMReply({
        incomingMessage: lastMessage.text,
        history,
        productName: product.name,
        productDesc: product.description,
        shopUrl,
      });

      if (!reply) continue;

      const input = await page.$('[data-e2e="message-input"]');
      if (!input) continue;

      await input.click();
      await page.waitForTimeout(CONFIG.typingDelayMs);
      await input.type(reply, { delay: 40 + Math.random() * 60 });
      await page.waitForTimeout(300 + Math.random() * 400);
      await page.keyboard.press('Enter');

      console.log(`✅ Réponse DM envoyée: ${reply.slice(0, 50)}...`);
      await page.waitForTimeout(CONFIG.delayBetweenDmsMs);
    }

  } catch (err) {
    console.error(`❌ Bot error pour ${clientData.prenom}:`, err.message);
  } finally {
    if (browser) await browser.close();
  }
}

// ════════════════════════════════════════════════════════════════
// 🔄 BOUCLE PRINCIPALE
// ════════════════════════════════════════════════════════════════

async function main() {
  console.log('🤖 Nexa DM Bot démarré — 100% automatique');

  while (true) {
    try {
      const clients = await getActiveClients();
      console.log(`\n📋 ${clients.length} client(s) actif(s) — ${new Date().toLocaleTimeString()}`);

      for (const client of clients) {
        if (!client.tiktok_username || !client.tiktok_password_encrypted) {
          console.log(`⚠️ Pas de credentials TikTok pour ${client.prenom}`);
          continue;
        }

        const product = await getClientProduct(client.stripe_connect_id);
        if (!product) {
          console.log(`⚠️ Pas de produit pour ${client.prenom}`);
          continue;
        }

        console.log(`\n🔄 Bot actif pour ${client.prenom} — ${product.name}`);
        await runBotForClient(client, product);

        // Délai entre chaque client
        await new Promise(r => setTimeout(r, 10000));
      }

    } catch (err) {
      console.error('❌ Main loop error:', err.message);
    }

    console.log(`\n⏳ Prochaine vérification dans ${CONFIG.checkIntervalMs / 60000} minutes...`);
    await new Promise(r => setTimeout(r, CONFIG.checkIntervalMs));
  }
}

main().catch(console.error);
