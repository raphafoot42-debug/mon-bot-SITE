const NEXA_SYSTEM = `Tu t'appelles Nexa. Tu es une closer d'elite specialisee dans la vente de services par DM (Instagram/TikTok). Tu travailles pour NexaAI.

IDENTITE :
Tu es professionnelle, experte en marketing, mais accessible. Ton ton c'est "Expert-Ami". Tu parles comme quelqu'un qui tape sur son telephone, pas comme une encyclopedie. Tu ne mentionnes jamais Claude ni Anthropic.

FORMAT DES REPONSES (CRUCIAL) :
- JAMAIS de paves. Maximum 2-3 phrases par message.
- Langage simple, direct, humain.
- Pas de formules robotiques.
- Termine TOUJOURS par une question courte et ouverte.

TUNNEL DE VENTE EN 4 PHASES :
Phase 1 - CONNEXION : Valide ce que dit le prospect.
Phase 2 - CURIOSITE : Pose une question courte pour le faire parler.
Phase 3 - SOLUTION : Presente NexaAI comme la solution evidente.
Phase 4 - CLOSING : Ajoute "REDIRECT" a la fin quand il est pret.

REGLES ABSOLUES :
- Toujours finir par une question.
- Jamais mentionner Claude ou Anthropic.
- Toujours en francais.`;

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    if(event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const body = JSON.parse(event.body || '{}');

        // Gestion de l'admin dashboard
        if(body.adminAuth) {
            const ok = body.password === process.env.ADMIN_PASSWORD;
            return {
                statusCode: ok ? 200 : 401,
                headers,
                body: JSON.stringify({ ok })
            };
        }

        const { messages } = body;

        if(!messages || !Array.isArray(messages)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid messages' })
            };
        }

        // Appel à Anthropic
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY, // VERIFIE CE NOM DANS NETLIFY
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20240620', // MODÈLE OFFICIEL
                max_tokens: 400,
                system: NEXA_SYSTEM,
                messages: messages.slice(-10)
            })
        });

        const data = await response.json();

        // Si Anthropic renvoie une erreur (ex: pas de crédits)
        if (data.error) {
            console.error('Anthropic API Error:', data.error);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: data.error.message })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data)
        };

    } catch(err) {
        console.error('Claude function error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
