/**
 * NEXA SEND-EMAIL — Système d'envoi d'emails centralisé
 * Utilise Resend (gratuit jusqu'à 3000 emails/mois)
 * Types : welcome | purchase_confirm | sale_notify | nexa_purchase
 */

// ════════════════════════════════════════════════════════════════
// 🔧 HELPERS
// ════════════════════════════════════════════════════════════════

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ════════════════════════════════════════════════════════════════
// 📧 TEMPLATES EMAIL
// ════════════════════════════════════════════════════════════════

function templateWelcome({ prenom }) {
  return {
    subject: '🎉 Bienvenue sur Nexa AI !',
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">Bienvenue ${prenom || ''} ! 👋</h1>
      <p style="color:#aaa;line-height:1.7;margin-bottom:20px;">
        Ton compte Nexa est créé. Tu peux maintenant configurer ton profil et commencer à prospecter sur TikTok.
      </p>
      <a href="https://nexaai.fr" style="display:inline-block;background:#39ff14;color:#000;padding:14px 28px;border-radius:10px;font-weight:900;text-decoration:none;margin-bottom:24px;">
        Accéder à mon dashboard →
      </a>
      <p style="color:#555;font-size:0.8rem;">Tu reçois cet email car tu viens de créer un compte sur nexaai.fr</p>
    </div>`
  };
}

function templatePurchaseConfirm({ prenom, productName, amount }) {
  return {
    subject: `✅ Accès confirmé — ${productName}`,
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">Paiement confirmé ! 🎉</h1>
      <p style="color:#aaa;line-height:1.7;margin-bottom:16px;">
        Merci ${prenom || ''} ! Ton achat de <strong style="color:#fff;">${productName}</strong> est confirmé.
      </p>
      <div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#aaa;margin:0 0 8px;">Montant payé</p>
        <p style="color:#39ff14;font-size:1.5rem;font-weight:900;margin:0;">€${amount}</p>
      </div>
      <p style="color:#aaa;line-height:1.7;margin-bottom:20px;">
        Tu vas recevoir tes accès sous peu. Si tu as des questions, réponds directement à cet email.
      </p>
      <p style="color:#555;font-size:0.8rem;">Paiement sécurisé par Stripe · nexaai.fr</p>
    </div>`
  };
}

function templateSaleNotify({ partnerPrenom, buyerEmail, productName, amount, commission }) {
  return {
    subject: `🎉 Tu viens de faire une vente — ${productName}`,
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">Nouvelle vente ! 🔥</h1>
      <p style="color:#aaa;line-height:1.7;margin-bottom:16px;">
        Bonne nouvelle ${partnerPrenom || ''} ! Nexa vient de closer une vente pour toi.
      </p>
      <div style="background:#111;border:1px solid #39ff14;border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Produit vendu</p>
        <p style="color:#fff;font-weight:700;margin:0 0 16px;">${productName}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Acheteur</p>
        <p style="color:#fff;margin:0 0 16px;">${buyerEmail}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Prix de vente</p>
        <p style="color:#fff;font-weight:700;margin:0 0 16px;">€${amount}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Ta commission (20%)</p>
        <p style="color:#39ff14;font-size:1.5rem;font-weight:900;margin:0;">€${commission}</p>
      </div>
      <p style="color:#aaa;line-height:1.7;margin-bottom:20px;">
        Ta commission sera versée sur ton compte Stripe sous 2-5 jours ouvrés.
      </p>
      <a href="https://nexaai.fr" style="display:inline-block;background:#39ff14;color:#000;padding:14px 28px;border-radius:10px;font-weight:900;text-decoration:none;">
        Voir mon dashboard →
      </a>
      <p style="color:#555;font-size:0.8rem;margin-top:24px;">nexaai.fr · Système de suivi automatique</p>
    </div>`
  };
}

function templateNexaPurchase({ prenom, plan, amount }) {
  const planNames = { starter: 'Starter ✨', pro: 'Pro 🚀', affiliation: 'Ambassadeur 🤝' };
  return {
    subject: `✅ Ton forfait ${planNames[plan] || plan} est activé !`,
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">Bienvenue dans l'équipe ! 🎉</h1>
      <p style="color:#aaa;line-height:1.7;margin-bottom:16px;">
        ${prenom || 'Bonjour'}, ton forfait <strong style="color:#39ff14;">${planNames[plan] || plan}</strong> est maintenant actif.
      </p>
      <div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#aaa;margin:0 0 8px;font-size:0.85rem;">Montant payé</p>
        <p style="color:#39ff14;font-size:1.5rem;font-weight:900;margin:0;">€${amount}</p>
      </div>
      <a href="https://nexaai.fr" style="display:inline-block;background:#39ff14;color:#000;padding:14px 28px;border-radius:10px;font-weight:900;text-decoration:none;margin-bottom:24px;">
        Accéder à mon dashboard →
      </a>
      <p style="color:#555;font-size:0.8rem;">nexaai.fr · Paiement sécurisé par Stripe</p>
    </div>`
  };
}

function templateHotLead({ prenom, username, commentText, suggestedDM }) {
  return {
    subject: `🔥 Prospect chaud détecté — @${username}`,
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">🔥 Prospect chaud !</h1>
      <p style="color:#aaa;line-height:1.7;margin-bottom:16px;">
        ${prenom || 'Bonjour'}, Nexa a détecté un profil très intéressant sur TikTok.
      </p>
      <div style="background:#111;border:1px solid #39ff14;border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Profil TikTok</p>
        <p style="color:#fff;font-weight:700;margin:0 0 16px;">@${username}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Son commentaire</p>
        <p style="color:#fff;font-style:italic;margin:0;">"${commentText}"</p>
      </div>
      <p style="color:#aaa;line-height:1.7;margin-bottom:12px;">Message suggéré à lui envoyer en DM :</p>
      <div style="background:#0a1a0a;border:1px solid #39ff14;border-radius:10px;padding:16px;margin-bottom:24px;">
        <p style="color:#39ff14;margin:0;">${suggestedDM}</p>
      </div>
      <p style="color:#aaa;font-size:0.85rem;margin-bottom:20px;">
        ⚡ Envoie ce message en DM à @${username} sur TikTok.<br>
        Nexa prendra automatiquement la suite de la conversation.
      </p>
      <a href="https://nexaai.fr" style="display:inline-block;background:#39ff14;color:#000;padding:14px 28px;border-radius:10px;font-weight:900;text-decoration:none;">
        Voir mon dashboard →
      </a>
    </div>`
  };
}

function templateAccountWarning({ prenom, daysLeft }) {
  return {
    subject: `⚠️ Ton compte Nexa sera bloqué dans ${daysLeft} jours`,
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">⚠️ Avertissement important</h1>
      <p style="color:#aaa;line-height:1.7;margin-bottom:16px;">
        ${prenom || 'Bonjour'}, ton compte Ambassadeur n'a généré aucune vente depuis 20 jours.
      </p>
      <p style="color:#ff6b6b;line-height:1.7;margin-bottom:24px;">
        Si aucune vente n'est enregistrée dans les <strong>${daysLeft} prochains jours</strong>, ton compte sera automatiquement bloqué.
      </p>
      <p style="color:#aaa;line-height:1.7;margin-bottom:20px;">
        Nos conseils pour débloquer la situation :<br>
        • Vérifie que ta page de vente est bien configurée<br>
        • Poste du contenu TikTok régulièrement<br>
        • Réponds aux commentaires pour créer de l'engagement
      </p>
      <a href="https://nexaai.fr" style="display:inline-block;background:#39ff14;color:#000;padding:14px 28px;border-radius:10px;font-weight:900;text-decoration:none;">
        Accéder à mon dashboard →
      </a>
    </div>`
  };
}

function templateAccountBlocked({ prenom }) {
  return {
    subject: `🚫 Ton compte Nexa a été suspendu`,
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">Compte suspendu</h1>
      <p style="color:#aaa;line-height:1.7;margin-bottom:16px;">
        ${prenom || 'Bonjour'}, ton compte Ambassadeur a été suspendu car aucune vente n'a été enregistrée en 30 jours.
      </p>
      <p style="color:#aaa;line-height:1.7;margin-bottom:24px;">
        Si tu penses que c'est une erreur ou si tu veux réactiver ton compte avec une nouvelle niche, contacte-nous.
      </p>
      <a href="mailto:contact@nexaai.fr" style="display:inline-block;background:#333;color:#fff;padding:14px 28px;border-radius:10px;font-weight:900;text-decoration:none;">
        Contacter le support →
      </a>
    </div>`
  };
}

function templateOwnerNexaSale({ buyerEmail, plan, amount }) {
  const planNames = { starter: 'Starter ✨', pro: 'Pro 🚀', affiliation: 'Ambassadeur 🤝' };
  return {
    subject: `🎉 Nouvelle vente Nexa — ${planNames[plan] || plan} — ${amount}€`,
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI — Raphaël</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">🎉 Nouvelle vente !</h1>
      <div style="background:#111;border:1px solid #39ff14;border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Client</p>
        <p style="color:#fff;font-weight:700;margin:0 0 16px;">${buyerEmail}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Forfait acheté</p>
        <p style="color:#fff;font-weight:700;margin:0 0 16px;">${planNames[plan] || plan}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Montant encaissé</p>
        <p style="color:#39ff14;font-size:2rem;font-weight:900;margin:0;">€${amount}</p>
      </div>
      <p style="color:#555;font-size:0.8rem;">nexaai.fr · Notification automatique</p>
    </div>`
  };
}

function templateOwnerAffiliationSale({ clientEmail, productName, amount }) {
  const ownerShare = (Number(amount) * 0.80).toFixed(2);
  return {
    subject: `💰 Commission affiliation — €${ownerShare} pour toi`,
    html: `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff;padding:40px 32px;border-radius:16px;">
      <div style="color:#39ff14;font-size:1.5rem;font-weight:900;letter-spacing:2px;margin-bottom:24px;">NEXA AI — Raphaël</div>
      <h1 style="font-size:1.8rem;margin-bottom:12px;">💰 Vente affiliation !</h1>
      <div style="background:#111;border:1px solid #39ff14;border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Client affiliation</p>
        <p style="color:#fff;font-weight:700;margin:0 0 16px;">${clientEmail}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Produit vendu</p>
        <p style="color:#fff;font-weight:700;margin:0 0 16px;">${productName}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Prix de vente</p>
        <p style="color:#fff;font-weight:700;margin:0 0 16px;">€${amount}</p>
        <p style="color:#aaa;margin:0 0 6px;font-size:0.85rem;">Ta part (80%)</p>
        <p style="color:#39ff14;font-size:2rem;font-weight:900;margin:0;">€${ownerShare}</p>
      </div>
      <p style="color:#555;font-size:0.8rem;">nexaai.fr · Notification automatique</p>
    </div>`
  };
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  const res = await fetchWithTimeout(
    'https://api.resend.com/emails',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Nexa AI <noreply@nexaai.fr>',
        to: [to],
        subject,
        html,
      }),
    },
    10000
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Resend error: ' + err);
  }
  return true;
}

// ════════════════════════════════════════════════════════════════
// 🌐 HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.SITE_URL || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type, to, data = {} } = body;

  if (!type || !to) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'type et to requis' }) };
  }

  // Valider email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
  }

  try {
    let template;

    switch (type) {
      case 'welcome':
        template = templateWelcome(data); break;
      case 'purchase_confirm':
        template = templatePurchaseConfirm(data); break;
      case 'sale_notify':
        template = templateSaleNotify(data); break;
      case 'nexa_purchase':
        template = templateNexaPurchase(data); break;
      case 'hot_lead':
        template = templateHotLead(data); break;
      case 'account_warning':
        template = templateAccountWarning(data); break;
      case 'account_blocked':
        template = templateAccountBlocked(data); break;
      case 'owner_nexa_sale':
        template = templateOwnerNexaSale(data); break;
      case 'owner_affiliation_sale':
        template = templateOwnerAffiliationSale(data); break;
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Type inconnu: ' + type }) };
    }

    await sendEmail({ to, subject: template.subject, html: template.html });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('send-email error:', err.message);
    // Non-bloquant — on log mais on ne crash pas le système
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email non envoyé' }) };
  }
};
