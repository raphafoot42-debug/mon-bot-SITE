/**
 * NEXA BLOCK-ACCOUNT — Bloque automatiquement les comptes inactifs
 * Scheduled function — à appeler une fois par jour
 * Règle : pas de vente en 30 jours → blocage
 * Règle : avertissement à J+20
 */

async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.SITE_URL || '',
    'Content-Type': 'application/json',
  };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const now = new Date();
    const day20 = new Date(now - 20 * 86400000).toISOString();
    const day30 = new Date(now - 30 * 86400000).toISOString();

    // Récupérer les clients affiliation actifs
    const clientsRes = await fetchWithTimeout(
      `${url}/rest/v1/users?plan=eq.affiliation&status=eq.active&select=id,email,prenom,created_at`,
      { headers: { Authorization: `Bearer ${key}`, apikey: key } }, 8000
    );
    const clients = await clientsRes.json();

    let warned = 0;
    let blocked = 0;

    for (const client of clients) {
      // Vérifier si le client a des ventes
      const salesRes = await fetchWithTimeout(
        `${url}/rest/v1/client_sales?partner_id=eq.${client.id}&select=id&limit=1`,
        { headers: { Authorization: `Bearer ${key}`, apikey: key } }, 8000
      );
      const sales = await salesRes.json();
      const hasSales = sales && sales.length > 0;

      if (hasSales) continue; // a des ventes → on ne touche pas

      const createdAt = new Date(client.created_at);

      // J+30 → blocage
      if (createdAt < new Date(day30)) {
        await fetchWithTimeout(
          `${url}/rest/v1/users?id=eq.${client.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
            body: JSON.stringify({ status: 'blocked', updated_at: now.toISOString() })
          }, 8000
        );

        // Email de blocage
        await fetchWithTimeout(
          `${process.env.SITE_URL}/.netlify/functions/send-email`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'account_blocked',
              to: client.email,
              data: { prenom: client.prenom || '' }
            })
          }, 8000
        ).catch(e => console.warn('send-email blocked:', e.message));

        blocked++;
        console.log(`🚫 Compte bloqué: ${client.email}`);
      }
      // J+20 → avertissement
      else if (createdAt < new Date(day20)) {
        await fetchWithTimeout(
          `${process.env.SITE_URL}/.netlify/functions/send-email`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'account_warning',
              to: client.email,
              data: { prenom: client.prenom || '', daysLeft: 10 }
            })
          }, 8000
        ).catch(e => console.warn('send-email warning:', e.message));

        warned++;
        console.log(`⚠️ Avertissement envoyé: ${client.email}`);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, warned, blocked }),
    };

  } catch (err) {
    console.error('block-account error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
