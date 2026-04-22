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

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { plan, email, success_url, cancel_url } = req.body;

        if (!plan || !email) {
            return res.status(400).json({ error: 'plan and email are required' });
        }

        const priceId = PRICE_IDS[plan];
        if (!priceId) {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const isOnce = plan.includes('-once');

        const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                'payment_method_types[]': 'card',
                'mode': isOnce ? 'payment' : 'subscription',
                'customer_email': email,
                'line_items[0][price]': priceId,
                'line_items[0][quantity]': '1',
                'success_url': success_url || `${req.headers.origin}?payment=success&plan=${plan}`,
                'cancel_url': cancel_url || `${req.headers.origin}?payment=cancel`,
                'locale': 'fr',
                'allow_promotion_codes': 'true'
            })
        });

        const session = await stripeResponse.json();

        if (session.error) {
            return res.status(400).json({ error: session.error.message });
        }

        return res.status(200).json({ url: session.url, id: session.id });

    } catch (error) {
        console.error('Stripe checkout error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
