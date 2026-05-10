// netlify/functions/verify-payment.js
// Vérifie qu'un paiement Stripe est réellement complété avant d'activer le plan

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if(event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if(event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // Parsing sécurisé du body
    let body;
    try {
        if(!event.body || event.body.trim() === '') {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Empty body' }) };
        }
        body = JSON.parse(event.body);
    } catch(e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { session_id, email } = body;

    // Validation des paramètres
    if(!session_id || !session_id.startsWith('cs_')) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid session_id' }) };
    }
    if(!email || !email.includes('@')) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
    }

    // Vérifier que la clé Stripe est configurée
    if(!process.env.STRIPE_SECRET_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }) };
    }

    try {
        // 1. Récupérer la session Stripe
        const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
            headers: {
                'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY
            }
        });

        if(!stripeRes.ok) {
            const err = await stripeRes.json();
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Stripe error: ' + (err.error?.message || 'unknown') }) };
        }

        const session = await stripeRes.json();

        // 2. Vérifier que le paiement est bien complété
        if(session.status !== 'complete' || session.payment_status !== 'paid') {
            return {
                statusCode: 402,
                headers,
                body: JSON.stringify({
                    error: 'Payment not completed',
                    status: session.status,
                    payment_status: session.payment_status
                })
            };
        }

        // 3. Vérifier que l'email correspond
        if(session.customer_email && session.customer_email.toLowerCase() !== email.toLowerCase()) {
            return { statusCode: 403, headers, body: JSON.stringify({ error: 'Email mismatch' }) };
        }

        // 4. Déterminer le plan depuis les metadata ou line_items
        let plan = session.metadata?.plan || 'starter';

        // 5. Mettre à jour Supabase
        if(!process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_URL) {
            // Si pas de clé service, retourner juste la validation Stripe
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    valid: true,
                    plan,
                    message: 'Payment verified by Stripe (Supabase update skipped)'
                })
            };
        }

        const supabaseRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
                'apikey': process.env.SUPABASE_SERVICE_KEY,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                plan: plan.replace('-once', ''),
                updated_at: new Date().toISOString(),
                stripe_session_id: session_id
            })
        });

        if(!supabaseRes.ok) {
            // Paiement valide mais Supabase a échoué — on retourne quand même valid:true
            console.error('Supabase update failed:', supabaseRes.status);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    valid: true,
                    plan,
                    warning: 'Payment verified but Supabase update failed'
                })
            };
        }

        // 6. Enregistrer le paiement
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/paiements`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
                'apikey': process.env.SUPABASE_SERVICE_KEY,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                email,
                plan: plan.replace('-once', ''),
                stripe_session_id: session_id,
                type_paiement: plan.includes('-once') ? 'unique' : 'mensuel',
                created_at: new Date().toISOString()
            })
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ valid: true, plan })
        };

    } catch(err) {
        console.error('verify-payment error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error: ' + err.message }) };
    }
};
