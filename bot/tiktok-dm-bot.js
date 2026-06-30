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
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');


// ════════════════════════════════════════════════════════════════
// ⚙️ CONFIG
// ════════════════════════════════════════════════════════════════

const CONFIG = {
  checkIntervalMs:      5 * 60 * 1000,  // Check every 5 min
  delayBetweenDmsMs:    45 * 1000,      // 45s between DMs (anti-ban)
  delayBetweenSearchMs: 10 * 1000,      // 10s between profile searches
  maxDmsPerHour:        15,
  maxDmsPerDay:         80,
  typingDelayMs:        1200,
  minScoreToContact:    50,
  navigationTimeout:    30000,           // 30s for page loads
  elementTimeout:       10000,           // 10s for element wait
};

// ════════════════════════════════════════════════════════════════
// 💾 SESSION STORAGE (to maintain login)
// ════════════════════════════════════════════════════════════════

const SESSIONS_DIR = '/tmp/tiktok-sessions';

function ensureSessionDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

async function saveBrowserSession(clientId, browser) {
  try {
    const cookies = await browser.cookies();
    const sessionPath = path.join(SESSIONS_DIR, `${clientId}.json`);
    fs.writeFileSync(sessionPath, JSON.stringify({ cookies, timestamp: Date.now() }));
    console.log(`✅ Session saved for client ${clientId}`);
  } catch (err) {
    console.error(`Warning: Could not save session: ${err.message}`);
  }
}

async function loadBrowserSession(page, clientId) {
  try {
    const sessionPath = path.join(SESSIONS_DIR, `${clientId}.json`);
    if (fs.existsSync(sessionPath)) {
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      // Only load if less than 24 hours old
      if (Date.now() - session.timestamp < 86400000) {
        await page.setCookie(...session.cookies);
        console.log(`✅ Session loaded for client ${clientId}`);
        return true;
      }
    }
  } catch (err) {
    console.error(`Warning: Could not load session: ${err.message}`);
  }
  return false;
}

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
  affiliation:    { perHour: 10, perDay: 50 },
  starter:        { perHour: 8,  perDay: 40 },
  starter_annual: { perHour: 8,  perDay: 40 },
  pro:            { perHour: 15, perDay: 75 },
  pro_annual:     { perHour: 15, perDay: 75 },
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
    const res = await fetch(`${process.env.SITE_URL}/.netlify/functions/nexa-ai-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'scout',
        tiktok_username: username,
        client_products: [{ name: productName, niche }],
        bio, followers
      })
    });
    if (!res.ok) throw new Error(`nexa-ai-engine scout error: ${res.status}`);
    const data = await res.json();
    return { score: data.score_certitude || 0, reason: data.recommandation || '' };
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
    const res = await fetch(`${process.env.SITE_URL}/.netlify/functions/nexa-ai-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'closer',
        prospect_data: {
          username, bio,
          score: 75,
          psycho_profile: 'Curious',
          sales_link: shopUrl
        },
        conversation_history: [],
        quota: 40
      })
    });
    if (!res.ok) throw new Error(`nexa-ai-engine closer error: ${res.status}`);
    const data = await res.json();
    return data.next_message || '';
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
    const res = await fetch(`${process.env.SITE_URL}/.netlify/functions/nexa-ai-engine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'closer',
        prospect_data: {
          username: 'prospect',
          score: 65,
          psycho_profile: 'Engaged',
          sales_link: shopUrl
        },
        conversation_history: [
          ...(history || []).slice(-8),
          { role: 'user', text: incomingMessage }
        ],
        quota: 30
      })
    });
    if (!res.ok) throw new Error(`nexa-ai-engine closer error: ${res.status}`);
    const data = await res.json();
    return data.next_message || '';
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
      `${process.env.SUPABASE_URL}/rest/v1/users?plan=in.(affiliation,starter,pro,starter_annual,pro_annual)&status=eq.active&select=id,email,prenom,plan,tiktok_username,tiktok_password_encrypted,stripe_connect_id,store_url,niche_tiktok,business`,
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
// 🔍 WAIT FOR ELEMENT WITH FALLBACK
// ════════════════════════════════════════════════════════════════

async function waitForElementWithFallback(page, selectors, timeout = CONFIG.elementTimeout) {
  if (!Array.isArray(selectors)) selectors = [selectors];
  
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    for (const selector of selectors) {
      const element = await page.$(selector);
      if (element) return element;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// 💬 TYPE MESSAGE INTO INPUT
// ════════════════════════════════════════════════════════════════

async function typeMessage(page, message, delay = 40) {
  // Try different input selectors
  const inputSelectors = [
    'textarea[placeholder*="essage"]',
    'input[placeholder*="essage"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
  ];

  const input = await waitForElementWithFallback(page, inputSelectors);
  if (!input) {
    console.error('❌ Could not find message input');
    return false;
  }

  await input.click();
  await page.waitForTimeout(500);

  // Use evaluate to set value directly (more reliable)
  await page.evaluate((text) => {
    const activeElement = document.activeElement;
    if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
      activeElement.value = text;
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
      activeElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (activeElement.contentEditable === 'true') {
      activeElement.innerText = text;
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, message);

  await page.waitForTimeout(300 + Math.random() * 400);
  return true;
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
        '--disable-gpu',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ],
      userDataDir: path.join(SESSIONS_DIR, `profile-${clientData.id}`),
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(CONFIG.navigationTimeout);
    page.setDefaultTimeout(CONFIG.elementTimeout);

    // Hide Puppeteer
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
    });

    // Try to load session
    const sessionLoaded = await loadBrowserSession(page, clientData.id);

    // ── 1. TIKTOK LOGIN ─────────────────────────────────────
    console.log(`🔑 TikTok login for ${clientData.prenom}...`);
    try {
      await page.goto('https://www.tiktok.com/', { waitUntil: 'networkidle2' });
      
      // Check if already logged in
      const loggedIn = await page.$('[data-testid="user-avatar"]') || 
                       await page.$('a[href="/upload"]');
      
      if (!loggedIn && !sessionLoaded) {
        // Need to login
        await page.goto('https://www.tiktok.com/login', { waitUntil: 'networkidle0' });
        await page.waitForTimeout(3000);

        // Look for email input
        const emailInput = await waitForElementWithFallback(page, [
          'input[type="email"]',
          'input[name="email"]',
          'input[name="username"]',
          'input[autocomplete="email"]'
        ]);

        if (emailInput) {
          await emailInput.type(clientData.tiktok_username, { delay: 100 });
          await page.waitForTimeout(800);
        }

        // Password input
        const passwordInput = await waitForElementWithFallback(page, 'input[type="password"]');
        if (passwordInput) {
          await passwordInput.type(password, { delay: 100 });
          await page.waitForTimeout(800);
        }

        // Submit
        const submitBtn = await waitForElementWithFallback(page, [
          'button[type="submit"]',
          'button:contains("Log in")',
          '[role="button"]'
        ]);

        if (submitBtn) {
          await submitBtn.click();
          await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
          await page.waitForTimeout(5000);
        }

        // Save session after login
        await saveBrowserSession(clientData.id, browser);
      } else {
        console.log(`✅ Using saved session for ${clientData.prenom}`);
      }

    } catch (err) {
      console.error(`⚠️ Login error for ${clientData.prenom}: ${err.message}`);
    }

    // Pour les ambassadeurs : page shop Nexa. Pour les clients payants : leur propre tunnel.
    const shopUrl = clientData.stripe_connect_id
      ? `${process.env.SITE_URL}/shop/${clientData.stripe_connect_id}`
      : (clientData.store_url || process.env.SITE_URL || '');

    // ── 2. SEARCH PROFILES TO CONTACT ──────────────────
    console.log(`🔍 Searching profiles for niche: ${product.niche}...`);
    try {
      await page.goto(`https://www.tiktok.com/search/user?q=${encodeURIComponent(product.niche)}`, { 
        waitUntil: 'networkidle1'
      }).catch(() => {});
      
      await page.waitForTimeout(2000);

      const profiles = await page.evaluate(() => {
        const profiles = [];
        const items = document.querySelectorAll('[data-testid="user-item"]');
        
        items.forEach((el, idx) => {
          if (idx >= 20) return;
          
          const linkEl = el.querySelector('a[href^="/@"]');
          if (!linkEl) return;
          
          const username = linkEl.getAttribute('href').replace('/@', '').split('?')[0];
          const bioEl = el.querySelector('[class*="bio"]') || el.querySelector('p');
          const bio = bioEl ? bioEl.textContent : '';
          
          profiles.push({
            username,
            bio,
            followers: el.textContent.match(/[\d.]+M?\s*Followers?/i)?.[0] || '0',
          });
        });
        
        return profiles;
      });

      console.log(`📋 ${profiles.length} profiles found`);

      // ── 3. ANALYZE AND DM HOT PROFILES ───────────────────
      for (const profile of profiles) {
        if (!profile.username) continue;
        if (!checkDmLimit(clientData.id, clientData.plan)) {
          console.log(`⚠️ DM limit reached for ${clientData.prenom}`);
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
            waitUntil: 'networkidle1'
          }).catch(() => {});
          
          await page.waitForTimeout(1500);

          // Find message button
          const msgBtn = await waitForElementWithFallback(page, [
            'button[aria-label*="essage"]',
            'button:contains("Message")',
            '[data-testid="message-icon"]',
            'button[data-e2e="message-button"]'
          ], 5000);

          if (!msgBtn) {
            console.log(`⚠️ Could not find message button for @${profile.username}`);
            continue;
          }

          await msgBtn.click();
          await page.waitForTimeout(2000);

          // Type and send message
          const sent = await typeMessage(page, firstDM);
          if (sent) {
            await page.keyboard.press('Enter');
            console.log(`✅ First DM sent to @${profile.username}`);
            await page.waitForTimeout(CONFIG.delayBetweenDmsMs);
          }

        } catch (err) {
          console.error(`⚠️ Error with @${profile.username}: ${err.message}`);
        }

        await page.waitForTimeout(CONFIG.delayBetweenSearchMs);
      }
    } catch (err) {
      console.error(`⚠️ Profile search error: ${err.message}`);
    }

    // ── 4. REPLY TO INCOMING DMs ───────────────────────
    console.log(`💬 Checking incoming DMs...`);
    try {
      await page.goto('https://www.tiktok.com/messages', { waitUntil: 'networkidle1' }).catch(() => {});
      await page.waitForTimeout(2000);

      const conversations = await page.$$('[data-testid="message-item"]');

      for (const conv of conversations.slice(0, 15)) {
        if (!checkDmLimit(clientData.id, clientData.plan)) break;

        try {
          await conv.click();
          await page.waitForTimeout(1500);

          const messages = await page.evaluate(() => {
            const items = document.querySelectorAll('[data-testid="message-bubble"]');
            return Array.from(items).map(el => ({
              text: el.textContent.trim(),
              isOwn: el.classList.contains('own')
            }));
          }).catch(() => []);

          const lastMessage = messages.filter(m => !m.isOwn).pop();
          if (!lastMessage?.text || isMalicious(lastMessage.text)) continue;

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

          if (reply) {
            const sent = await typeMessage(page, reply);
            if (sent) {
              await page.keyboard.press('Enter');
              console.log(`✅ Reply sent`);
              await page.waitForTimeout(CONFIG.delayBetweenDmsMs);
            }
          }

        } catch (err) {
          console.error(`⚠️ DM error: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`⚠️ Messages error: ${err.message}`);
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
  ensureSessionDir();
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

        // Ambassadeurs : produit réel créé via create-product.js
        // Clients payants (starter/pro) : pas de table products,
        // on construit un produit virtuel depuis les données business déjà collectées
        let product = await getClientProduct(client.stripe_connect_id);
        if (!product) {
          if (client.business || client.niche_tiktok) {
            product = {
              name: client.business || 'Produit/Service de ' + (client.prenom || 'client'),
              description: client.business || '',
              niche: client.niche_tiktok || ''
            };
          } else {
            console.log(`⚠️ No product/business data for ${client.prenom}`);
            continue;
          }
        }

        console.log(`\n🔄 Bot active for ${client.prenom} — ${product.name}`);
        await runBotForClient(client, product);

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
