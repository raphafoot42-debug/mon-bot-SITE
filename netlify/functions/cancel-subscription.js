/**
 * NEXA CANCEL-SUBSCRIPTION — Annule l'abonnement Stripe actif d'un client
 * Appelé automatiquement avant un changement de forfait
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': process.env.SITE_URL || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { subscription_id, email } = body;

  if (!subscription_id || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'subscription_id et email requis' }) };
  }

  if (!subscription_id.startsWith('sub_')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'subscription_id invalide' }) };
  }

  try {
    // Annuler l'abonnement immédiatement sur Stripe
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscription_id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('Stripe cancel error:', data.error?.message);
      return { statusCode: 400, headers, body: JSON.stringify({ error: data.error?.message || 'Erreur Stripe' }) };
    }

    // Mettre à jour Supabase — vider stripe_subscription_id
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ stripe_subscription_id: null }),
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, status: data.status }) };

  } catch (err) {
    console.error('cancel-subscription error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
