const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email invalide' }) };
  }

  try {
    if (body.action === 'confirm') {
      // Le compte doit déjà exister (créé à l'inscription, action 'create').
      // On tente d'abord un UPDATE ; s'il ne touche aucune ligne, ça veut dire
      // que la ligne n'a jamais existé (échec à l'inscription) → on la recrée.
      const { data, error } = await supabase
        .from('users')
        .update({ email_verified: true, status: 'actif' })
        .eq('email', email)
        .select('id');

      if (error) throw error;

      if (!data || data.length === 0) {
        const prenomRaw = email.split('@')[0].replace(/[0-9._-]/g, ' ').trim().split(/\s+/)[0] || 'Utilisateur';
        const prenom = prenomRaw.charAt(0).toUpperCase() + prenomRaw.slice(1);
        const { error: upsertErr } = await supabase.from('users').upsert([{
          id: body.id || undefined,
          email,
          prenom,
          plan: 'pending',
          platforms: [],
          status: 'actif',
          email_verified: true,
          created_at: new Date().toISOString()
        }], { onConflict: 'email' });
        if (upsertErr) throw upsertErr;
      }

      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    // action par défaut : 'create' (inscription). Upsert complet — si le compte
    // existe déjà (ex: double appel), ça ne fait que remettre à jour les champs
    // fournis, sans dupliquer la ligne.
    const { error } = await supabase.from('users').upsert([{
      id: body.id || undefined,
      email,
      prenom: body.prenom || email.split('@')[0],
      plan: body.plan || 'pending',
      platforms: body.platforms || [],
      status: body.status || 'pending_verify',
      email_verified: !!body.email_verified,
      created_at: body.created_at || new Date().toISOString()
    }], { onConflict: 'email' });

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (e) {
    console.error('create-user error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Erreur serveur' }) };
  }
};
