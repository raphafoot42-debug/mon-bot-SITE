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
        const body = JSON.parse(event.body || '{}');
        const { plan, email, clientStripeConnectId, isAmbassadorMode } = body;

        // 1. Sécurité : Vérifier si le plan existe
        const finalPriceId = PRICE_IDS[plan];
        if (!finalPriceId) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Plan de paiement invalide." }) };
        }

        // 2. Préparation des paramètres Stripe
        // On force 'payment' pour les ventes de crédits (plus stable que subscription ici)
        const stripeParams = new URLSearchParams({
            'payment_method_types[]': 'card',
            'mode': 'payment', 
            'customer_email': email,
            'line_items[0][price]': finalPriceId,
            'line_items[0][quantity]': '1',
            'success_url': 'https://steady-centaur-82e10a.netlify.app/dashboard.html?payment=success',
            'cancel_url': 'https://steady-centaur-82e10a.netlify.app/#pricing',
            'locale': 'fr'
        });

        // 3. LOGIQUE D'AFFILIATION RÉPARÉE
        // On n'ajoute ces paramètres QUE si l'ID partenaire est valide et présent
        if (clientStripeConnectId && clientStripeConnectId.startsWith('acct_')) {
            stripeParams.append('payment_intent_data[application_fee_percent]', '80');
            stripeParams.append('transfer_data[destination]', clientStripeConnectId);
        }

        // 4. Appel à Stripe
        const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: stripeParams
        });

        const session = await stripeResponse.json();

        // 5. Vérification du succès de Stripe
        if (session.error) {
            console.error("Erreur Stripe détaillée:", session.error);
            return { statusCode: 400, headers, body: JSON.stringify({ error: session.error.message }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };

    } catch(err) {
        console.error("Erreur Serveur:", err.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Erreur interne du serveur." }) };
    }
};
