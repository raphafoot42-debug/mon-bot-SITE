const PRICE_IDS = {
    'starter':       'price_1THSyjP8svYH1bkOt686fqqC',
    'pro':           'price_1THSzsP8svYH1bkOndl82cmU',
    'business':      'price_1TP3ihP8svYH1bkOOITtQVaA',
    'elite':         'price_1TJ8XPP8svYH1bkOWwjjcZ87',
};

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if(event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        const { plan, email, clientStripeConnectId, isAmbassadorMode } = JSON.parse(event.body || '{}');

        // 1. Gestion du mode "Ambassadeur Gratuit" (Pas de paiement Stripe immédiat)
        if (isAmbassadorMode) {
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ message: 'Mode ambassadeur activé via Supabase' }) 
            };
        }

        const finalPriceId = PRICE_IDS[plan];
        const isOnce = plan && plan.includes('-once');
        
        const stripeParams = new URLSearchParams({
            'payment_method_types[]': 'card',
            'mode': isOnce ? 'payment' : 'subscription',
            'customer_email': email,
            'line_items[0][price]': finalPriceId,
            'line_items[0][quantity]': '1',
            'success_url': 'https://steady-centaur-82e10a.netlify.app/dashboard.html?payment=success',
            'cancel_url': 'https://steady-centaur-82e10a.netlify.app/#pricing',
            'locale': 'fr'
        });

        // 2. LOGIQUE D'AFFILIATION (80% pour nous, 20% pour l'affilié)
        // Note: Dans Stripe Connect, l'application_fee est ce que NOUS on garde.
        if (clientStripeConnectId && clientStripeConnectId.startsWith('acct_')) {
            const myCommission = '80'; // On prend 80%
            
            if (isOnce) {
                stripeParams.append('payment_intent_data[application_fee_percent]', myCommission);
                stripeParams.append('transfer_data[destination]', clientStripeConnectId);
            } else {
                stripeParams.append('subscription_data[application_fee_percent]', myCommission);
                stripeParams.append('subscription_data[transfer_data][destination]', clientStripeConnectId);
            }
        }

        const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: stripeParams
        });

        const session = await stripeResponse.json();
        return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };

    } catch(err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
