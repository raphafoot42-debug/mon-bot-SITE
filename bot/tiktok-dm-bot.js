/**
 * NEXA TIKTOK DM BOT — Fully Automated Bot
 * 1. Analyzes TikTok profiles from client's niche
 * 2. Score 0-100 — if > 50 → sends first DM
 * 3. Auto-replies to all incoming DMs
 * 4. Closes the sale
 * 
 * Deploy on Railway (connected GitHub) — not Netlify
 * Start: node tiktok-dm-bot.js
 */

const puppeteer  = require('puppeteer');
const Anthropic  = require('@anthropic-ai/sdk');
const crypto     = require('crypto');

const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const CONFIG = {
  checkIntervalMs:      5 * 60 * 1000,  // Check every 5 min
  delayBetweenDmsMs:    45 * 1000,      // 45s between DMs (anti-ban)
  delayBetweenSearchMs: 10 * 1000,      // 10s between profile searches
  maxDmsPerHour:        15,             // Max 15 DMs/hour per account
  maxDmsPerDay:         80,             // Max 80 DMs/day per account
  typingDelayMs:        1200,           // Simulate human typing
  minScoreToContact:    50,             // Minimum score for DM
};

// ════════════════════════════════════════════════════════════════
// 🔐 PASSWORD DECRYPTION
// ════════════════════════════════════════════════════════════════

function decryptPassword(encryptedPassword) {
  try {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      console.warn('⚠️ ENCRYPTION_KEY not set, using password as-is');
      return encryptedPassword;
    }
    
    const key = Buffer.from(encryptionKey, 'hex').slice(0, 32);
    const [iv, encrypted] = encryptedPassword.split(':');
    if (!iv || !encrypted) return encryptedPassword;
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(Buffer.from(encrypted, 'hex'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    console.error('Decryption error:', err.message);
    return encryptedPassword;
  }
}

// ════════════════════════════════════════════════════════════════
// 🛡️ RATE LIMITING BY ACCOUNT
// ════════════════════════════════════════════════════════════════

const dmCounters = {};

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
// 🛡️ MALICIOUS MESSAGE DETECTION
// ════════════════════════════════════════════════════════════════

function isMalicious(text) {
  if (!text) return false;
  const patterns = [
    /(.)\1{15,}/,
    /http[s]?:\/\//i,
    /\b(hack|ban|report|scam|pirate)\b/i,
    /[^\x00-\x7F]{100,}/,
    /<script/i,
  ];
  return patterns.some(p => p.test(text));
}

// ════════════════════════════════════════════════════════════════
// 🤖 ANALYZE PROFILE — SCORE 0-100
// ════════════════════════════════════════════════════════════════

async function scoreProfile({ username, bio, followers, niche, productName }) {
  try {
    const response = await aiClient.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 200,
      temperature: 0.3,
      system: `Analyze TikTok profiles to match our target audience.
Reply ONLY in JSON: { "score": 0-100, "reason": "short reason" }
Score > 50 = contact them. Score < 50 = skip.`,
      messages: [{
        role: 'user',
        content: `TikTok Profile:
Username: @${username}
Bio: ${bio || 'empty'}
Followers: ${followers || 'unknown'}
Our niche: ${niche}
Our product: ${productName}

Score this profile.`
      }]
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { score: 0, reason: 'parse error' };
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('Error scoring profile:', err.message);
    return { score: 0, reason: 'error' };
  }
}

// ════════════════════════════════════════════════════════════════
// 💬 GENERATE FIRST DM
// ════════════════════════════════════════════════════════════════

async function generateFirstDM({ username, bio, productName, productDesc, shopUrl }) {
  try {
    const response = await aiClient.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 150,
      temperature: 0.8,
      system: `Send a natural, human first DM on TikTok.
STRICT RULES:
- 1-2 sentences max — SMS style
- Personalized hook based on profile
- No links in first message
- Never direct sales pitch
- Create curiosity or ask question
- Never say you're an AI
- Always in French`,
      messages: [{
        role: 'user',
        content: `Target profile: @${username}
Bio: ${bio || 'empty'}
Product to sell: ${productName}
Description: ${productDesc}

Generate first DM hook.`
      }]
    });

    return response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
  } catch (err) {
    console.error('Error generating first DM:', err.message);
    return '';
  }
}

// ════════════════════════════════════════════════════════════════
// 💬 GENERATE DM REPLY
// ════════════════════════════════════════════════════════════════

async function generateDMReply({ incomingMessage, history, productName, productDesc, shopUrl }) {
  try {
    const response = await aiClient.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 200,
      temperature: 0.7,
      system: `You are a natural sales assistant on TikTok DM.
Product: ${productName}
Description: ${productDesc}
Shop link: ${shopUrl}

RULES:
- 1-3 sentences max — SMS style
- Adapt tone to person
- Push link ONLY if clearly interested
- If hostile/malicious → reply politely and stop
- If asked if you're AI → say yes honestly
- Never fake urgency`,
      messages: [
        ...(history || []).slice(-8),
        { role: 'user', content: incomingMessage }
      ]
    });

    return response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
  } catch (err) {
    console.error('Error generating DM reply:', err.message);
    return '';
  }
}

// ════════════════════════════════════════════════════════════════
// 🌐 SUPABASE — GET ACTIVE CLIENTS
// ════════════════════════════════════════════════════════════════

async function getActiveClients() {
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/users?plan=in.(affiliation,starter,pro)&status=eq.active&select=id,email,prenom,plan,tiktok_username,tiktok_password_encrypted,stripe_connect_id`,
      { 
        headers: { 
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json'
        } 
      }
    );
    if (!res.ok) {
      console.error(`Supabase error: ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.error('Error fetching clients:', err.message);
    return [];
  }
}

async function getClientProduct(stripeConnectId) {
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/products?stripe_connect_id=eq.${encodeURIComponent(stripeConnectId)}&status=eq.active&select=name,description,niche&limit=1`,
      { 
        headers: { 
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json'
        } 
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (err) {
    console.error('Error fetching product:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// 🤖 MAIN PUPPETEER BOT
// ════════════════════════════════════════════════════════════════

async function runBotForClient(clientData, product) {
  let browser;
  try {
    const password = decryptPassword(clientData.tiktok_password_encrypted);

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      ],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(15000);

    // Hide Puppeteer
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    // ── 1. TIKTOK LOGIN ─────────────────────────────────────
    console.log(`🔑 TikTok login for ${clientData.prenom}...`);
    try {
      await page.goto('https://www.tiktok.com/login/phone-or-email/email', { waitUntil: 'networkidle2' });
      await page.waitForTimeout(2000 + Math.random() * 1000);

      const emailInput = await page.$('input[type="email"]') || await page.$('input[name="username"]');
      if (emailInput) {
        await emailInput.type(clientData.tiktok_username, { delay: 80 + Math.random() * 40 });
        await page.waitForTimeout(500);
      }

      const passwordInput = await page.$('input[type="password"]');
      if (passwordInput) {
        await passwordInput.type(password, { delay: 80 + Math.random() * 40 });
        await page.waitForTimeout(500);
      }

      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        await page.waitForTimeout(4000);
      }
    } catch (err) {
      console.error(`⚠️ Login error for ${clientData.prenom}: ${err.message}`);
    }

    const shopUrl = `${process.env.SITE_URL}/shop/${clientData.stripe_connect_id}`;

    // ── 2. SEARCH PROFILES TO CONTACT ──────────────────
    console.log(`🔍 Searching profiles for niche: ${product.niche}...`);
    try {
      await page.goto(`https://www.tiktok.com/search/user?q=${encodeURIComponent(product.niche)}`, { 
        waitUntil: 'networkidle2' 
      }).catch(() => {});
      await page.waitForTimeout(3000);

      const profiles = await page.evaluate(() => {
        const items = document.querySelectorAll('[data-testid="user-item"]') || 
                      document.querySelectorAll('div[class*="UserItem"]') ||
                      [];
        return Array.from(items).slice(0, 20).map(el => ({
          username: el.textContent.match(/@[\w.]+/)?.[0]?.replace('@', '') || '',
          bio: el.textContent.split('\n')[1] || '',
          followers: el.textContent.match(/[\d.]+K?\s*(?:followers|Followers)/)?.[0] || '0',
        })).filter(p => p.username);
      });

      console.log(`📋 ${profiles.length} profiles found`);

      // ── 3. ANALYZE AND DM HOT PROFILES ───────────────────
      for (const profile of profiles) {
        if (!profile.username) continue;
        if (!checkDmLimit(clientData.id, clientData.plan)) {
          console.log(`⚠️ DM limit reached for ${clientData.prenom} (${clientData.plan})`);
          break;
        }

        const { score, reason } = await scoreProfile({
          username: profile.username,
          bio: profile.bio,
          followers: profile.followers,
          niche: product.niche,
          productName: product.name,
        });

        console.log(`📊 @${profile.username} — score: ${score} (${reason})`);

        if (score < CONFIG.minScoreToContact) continue;

        const firstDM = await generateFirstDM({
          username: profile.username,
          bio: profile.bio,
          productName: product.name,
          productDesc: product.description,
          shopUrl,
        });

        if (!firstDM) continue;

        // Navigate to profile and send DM
        try {
          await page.goto(`https://www.tiktok.com/@${profile.username}`, { 
            waitUntil: 'networkidle2' 
          }).catch(() => {});
          await page.waitForTimeout(2000);

          const msgBtn = await page.$('button[aria-label*="essage"]') || 
                        await page.$('[data-testid="message-icon"]');
          if (!msgBtn) continue;

          await msgBtn.click();
          await page.waitForTimeout(2000);

          const input = await page.$('textarea[placeholder*="essage"]') || 
                       await page.$('input[placeholder*="essage"]') ||
                       await page.$('[contenteditable="true"]');
          if (!input) continue;

          await input.click();
          await page.waitForTimeout(CONFIG.typingDelayMs);
          await input.type(firstDM, { delay: 40 + Math.random() * 60 });
          await page.waitForTimeout(500 + Math.random() * 500);
          await page.keyboard.press('Enter');

          console.log(`✅ First DM sent to @${profile.username}: ${firstDM.slice(0, 50)}...`);

          await page.waitForTimeout(CONFIG.delayBetweenDmsMs);
        } catch (err) {
          console.error(`Error sending DM to @${profile.username}: ${err.message}`);
        }

        await page.waitForTimeout(CONFIG.delayBetweenSearchMs);
      }
    } catch (err) {
      console.error(`Error in profile search: ${err.message}`);
    }

    // ── 4. REPLY TO INCOMING DMs ───────────────────────
    console.log(`💬 Checking incoming DMs for ${clientData.prenom}...`);
    try {
      await page.goto('https://www.tiktok.com/messages', { waitUntil: 'networkidle2' }).catch(() => {});
      await page.waitForTimeout(2000);

      const conversations = await page.$$('[data-testid="message-item"]') || 
                           await page.$$('div[class*="MessageItem"]') || [];

      for (const conv of conversations.slice(0, 15)) {
        if (!checkDmLimit(clientData.id, clientData.plan)) break;

        try {
          await conv.click();
          await page.waitForTimeout(1500);

          const messages = await page.evaluate(() => {
            const items = document.querySelectorAll('[data-testid="message-bubble"]') ||
                         document.querySelectorAll('div[class*="MessageBubble"]') || [];
            return Array.from(items).map(el => ({
              text: el.textContent.trim(),
              isOwn: el.classList.contains('own') || el.textContent.includes('You')
            }));
          }).catch(() => []);

          const lastMessage = messages.filter(m => !m.isOwn).pop();
          if (!lastMessage?.text) continue;
          if (isMalicious(lastMessage.text)) {
            console.log(`🚫 Malicious message ignored`);
            continue;
          }

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

          const input = await page.$('textarea[placeholder*="essage"]') || 
                       await page.$('input[placeholder*="essage"]') ||
                       await page.$('[contenteditable="true"]');
          if (!input) continue;

          await input.click();
          await page.waitForTimeout(CONFIG.typingDelayMs);
          await input.type(reply, { delay: 40 + Math.random() * 60 });
          await page.waitForTimeout(300 + Math.random() * 400);
          await page.keyboard.press('Enter');

          console.log(`✅ DM reply sent: ${reply.slice(0, 50)}...`);
          await page.waitForTimeout(CONFIG.delayBetweenDmsMs);
        } catch (err) {
          console.error(`Error processing conversation: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`Error in DM responses: ${err.message}`);
    }

  } catch (err) {
    console.error(`❌ Bot error for ${clientData.prenom}:`, err.message);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.error('Error closing browser:', err.message);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 🔄 MAIN LOOP
// ════════════════════════════════════════════════════════════════

async function main() {
  console.log('🤖 Nexa DM Bot started — 100% automatic');

  while (true) {
    try {
      const clients = await getActiveClients();
      console.log(`\n📋 ${clients.length} active client(s) — ${new Date().toLocaleTimeString()}`);

      for (const client of clients) {
        if (!client.tiktok_username || !client.tiktok_password_encrypted) {
          console.log(`⚠️ No TikTok credentials for ${client.prenom}`);
          continue;
        }

        const product = await getClientProduct(client.stripe_connect_id);
        if (!product) {
          console.log(`⚠️ No product for ${client.prenom}`);
          continue;
        }

        console.log(`\n🔄 Bot active for ${client.prenom} — ${product.name}`);
        await runBotForClient(client, product);

        // Delay between clients
        await new Promise(r => setTimeout(r, 10000));
      }

    } catch (err) {
      console.error('❌ Main loop error:', err.message);
    }

    console.log(`\n⏳ Next check in ${CONFIG.checkIntervalMs / 60000} minutes...`);
    await new Promise(r => setTimeout(r, CONFIG.checkIntervalMs));
  }
}

main().catch(console.error);
