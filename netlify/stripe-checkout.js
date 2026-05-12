const PRICE_IDS = {
    'starter':  'price_1THSyjP8svYH1bkOt686fqqC',
    'pro':      'price_1THSzsP8svYH1bkOndl82cmU',
    'business': 'price_1TP3ihP8svYH1bkOOITtQVaA',
    'elite':    'price_1TJ8XPP8svYH1bkOWwjjcZ87',
    'partner_activation': 'price_1TWJqYP8svYH1bkOi4njRmnX' // TON NOUVEAU PRIX 0€
};

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if(event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    try {
        const body = JSON.parse(event.body || '{}');
        const { plan, email, clientStripeConnectId } = body;

        const finalPriceId = PRICE_IDS[plan];
        if (!finalPriceId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Plan invalide." }) };
        }

        const stripeParams = new URLSearchParams({
            'payment_method_types[]': 'card',
            'mode': 'payment', 
            'customer_email': email,
            'line_items[0][price]': finalPriceId,
            'line_items[0][quantity]': '1',
            'success_url': 'https://steady-centaur-82e10a.netlify.app/dashboard.html?payment=success',
            'cancel_url': 'https://steady-centaur-82e10a.netlify.app/#pricing',
            'metadata[plan]': plan,
            'locale': 'fr'
        });

        // LOGIQUE DE PARTAGE 80/20
        // Si le clientStripeConnectId existe, c'est une vente affiliée
        if (clientStripeConnectId && clientStripeConnectId.startsWith('acct_')) {
            // On définit la commission de la plateforme (Toi) à 80%
            stripeParams.append('payment_intent_data[application_fee_percent]', '80');
            // On envoie le reste (20%) au partenaire
            stripeParams.append('transfer_data[destination]', clientStripeConnectId);
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
        if (session.error) throw new Error(session.error.message);

        return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };

    } catch(err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
};
