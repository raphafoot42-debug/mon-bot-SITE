module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const body = req.body;

        // ===== ROUTE ADMIN AUTH =====
        if (body.adminAuth) {
            const { password } = body;
            if (password === process.env.ADMIN_PASSWORD) {
                return res.status(200).json({ ok: true });
            }
            return res.status(401).json({ ok: false });
        }

        // ===== ROUTE CLAUDE =====
        const { model, max_tokens, system, messages } = body;
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model || 'claude-sonnet-4-6',
                max_tokens: max_tokens || 500,
                system: system || '',
                messages
            })
        });

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error('Proxy error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
