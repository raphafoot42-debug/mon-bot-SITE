const PRICE_IDS = {
    'starter':       'price_1THSyjP8svYH1bkOt686fqqC',
    'starter-once':  'price_1THSyjP8svYH1bkOt686fqqC',
    'pro':           'price_1THSzsP8svYH1bkOndl82cmU',
    'pro-once':      'price_1THSzsP8svYH1bkOndl82cmU',
    'business':      'price_1TP3ihP8svYH1bkOOITtQVaA',
    'business-once': 'price_1TP3ihP8svYH1bkOOITtQVaA',
    'elite':         'price_1TJ8XPP8svYH1bkOWwjjcZ87',
    'elite-once':    'price_1TJ8XPP8svYH1bkOWwjjcZ87',
};

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
        return { statusCode: 405, headers, body: 'Method not allowed' };
    }

    try {
        const { plan, email, success_url, cancel_url, priceId } = JSON.parse(event.body || '{}');

        if(!email) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email manquant' }) };
        }

        const finalPriceId = priceId || PRICE_IDS[plan];
        if(!finalPriceId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Plan invalide' }) };
        }

        const isOnce = plan && plan.includes('-once');
        
        // CORRECTION : URL Dynamique basée sur la requête entrante
        const host = event.headers.host || 'steady-centaur-82e10a.netlify.app';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const baseUrl = `${protocol}://${host}`;

        const stripeParams = new URLSearchParams({
            'payment_method_types[]': 'card',
            'mode': isOnce ? 'payment' : 'subscription',
            'customer_email': email,
            'line_items[0][price]': finalPriceId,
            'line_items[0][quantity]': '1',
            'success_url': success_url || (baseUrl + '/dashboard.html?payment=success'),
            'cancel_url': cancel_url || (baseUrl + '/#pricing'),
            'locale': 'fr',
            'allow_promotion_codes': 'true'
        });

        const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: stripeParams
        });

        const session = await stripeResponse.json();

        if(session.error) {
            console.error('Erreur API Stripe:', session.error);
            return { statusCode: 400, headers, body: JSON.stringify({ error: session.error.message }) };
        }

        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ url: session.url, id: session.id }) 
        };

    } catch(err) {
        console.error('Erreur interne serveur:', err);
        return { 
            statusCode: 500, 
            headers, 
            body: JSON.stringify({ error: 'Erreur lors de la création de la session de paiement' }) 
        };
    }
};
