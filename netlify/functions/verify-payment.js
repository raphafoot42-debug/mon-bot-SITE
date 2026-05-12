// netlify/functions/verify-payment.js
const PARTNER_PRICE_ID = "price_1TWJqYP8svYH1bkOi4njRmnX";

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if(event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    let body;
    try {
        body = JSON.parse(event.body);
    } catch(e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { session_id, email } = body;
    if(!session_id || !process.env.STRIPE_SECRET_KEY) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing config' }) };
    }

    try {
        // 1. Récupérer la session Stripe avec les détails des paiements
        const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}?expand[]=payment_intent`, {
            headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY }
        });
        const session = await stripeRes.json();

        if(session.payment_status !== 'paid') {
            return { statusCode: 402, headers, body: JSON.stringify({ error: 'Not paid' }) };
        }

        // 2. Détecter si c'est l'activation du Forfait Partenaire
        const isPartnerActivation = session.metadata?.plan === 'partner_activation' || 
                                     (session.line_items && session.line_items.data[0].price.id === PARTNER_PRICE_ID);

        let plan = session.metadata?.plan || 'starter';

        // 3. Mise à jour Supabase (Utilisateur + Stats)
        const updateData = {
            updated_at: new Date().toISOString(),
            stripe_session_id: session_id
        };

        if (isPartnerActivation) {
            updateData.is_partner = true;
            plan = 'partner';
        } else {
            updateData.plan = plan.replace('-once', '');
        }

        await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
                'apikey': process.env.SUPABASE_SERVICE_KEY
            },
            body: JSON.stringify(updateData)
        });

        // 4. Logique de Split 80/20 si un partenaire est présent dans les metadata
        // Note: Le split réel se fait idéalement à la CREATION de la session, 
        // mais ici on enregistre la commission pour le tracking.
        if (session.metadata?.referrer_id) {
             await fetch(`${process.env.SUPABASE_URL}/rest/v1/affiliates_commissions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
                    'apikey': process.env.SUPABASE_SERVICE_KEY
                },
                body: JSON.stringify({
                    partner_id: session.metadata.referrer_id,
                    referred_user_email: email,
                    amount_paid: session.amount_total / 100,
                    commission_amount: (session.amount_total / 100) * 0.20, // 20%
                    status: 'paid'
                })
            });
        }

        return { statusCode: 200, headers, body: JSON.stringify({ valid: true, plan, isPartner: isPartnerActivation }) };

    } catch(err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
