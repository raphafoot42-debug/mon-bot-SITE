const NEXA_SYSTEM = `Tu t appelles Nexa. Tu es une closer d elite specialisee dans la vente de services par DM. Tu travailles pour NexaAI. Tu ne mentionnes jamais Claude ni Anthropic.

IDENTITE : Tu es professionnelle, experte en marketing, accessible. Ton ton : Expert-Ami. Tu parles comme quelqu un qui tape sur son telephone.

FORMAT : JAMAIS de paves. Max 2-3 phrases. Termine TOUJOURS par une question courte.

TUNNEL DE VENTE :
Phase 1 - CONNEXION : Valide ce que dit le prospect. Fais-le sentir compris.
Phase 2 - CURIOSITE : Une question courte. Ex: Tu tournes a combien de DMs par jour ?
Phase 3 - SOLUTION : Presente NexaAI. Calcule ce qu il perd chaque jour sans automatisation.
Phase 4 - CLOSING : Donne le lien de paiement quand il est pret. Ajoute REDIRECT dans ton message.

FORFAITS :
- Starter : 39 euros/mois - 10 prospects/jour
- Pro : 94 euros/mois - 80 prospects/jour
- Business : 194 euros/mois - 300 prospects/jour
- Elite : 494 euros/mois - 750 prospects/jour

ROLE AGENT TIKTOK : Tu prospectes sur TikTok au nom du client. Tu connais son business et son lien de vente. Tu pousses les prospects vers ce lien. Tu fermes la vente avec urgence et preuve sociale.

REGLES : Max 3 phrases, finir par une question, jamais Claude/Anthropic, toujours en francais.`;

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

    // Try/catch robuste sur le parsing du body
    let body;
    try {
        if(!event.body || event.body.trim() === '') {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Empty request body' }) };
        }
        body = JSON.parse(event.body);
    } catch(parseError) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON', details: parseError.message }) };
    }

    try {
        // Route admin auth
        if(body.adminAuth) {
            const ok = body.password === process.env.ADMIN_PASSWORD;
            return { statusCode: ok ? 200 : 401, headers, body: JSON.stringify({ ok }) };
        }

        // Validation
        const { model, max_tokens, system, messages } = body;
        if(!messages || !Array.isArray(messages) || messages.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'messages array required' }) };
        }

        // Vérifier clé API
        if(!process.env.CLAUDE_API_KEY) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured' }) };
        }

        // Garder les 10 derniers messages
        const recentMessages = messages.slice(-10);

        // System prompt final
        const finalSystem = system ? NEXA_SYSTEM + '\n\n' + system : NEXA_SYSTEM;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model || 'claude-sonnet-4-6',
                max_tokens: max_tokens || 400,
                system: finalSystem,
                messages: recentMessages
            })
        });

        if(!response.ok) {
            const errData = await response.json().catch(() => ({}));
            return { statusCode: response.status, headers, body: JSON.stringify({ error: errData.error || 'Anthropic API error' }) };
        }

        const data = await response.json();
        return { statusCode: 200, headers, body: JSON.stringify(data) };

    } catch(err) {
        console.error('Claude function error:', err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: err.message }) };
    }
};
