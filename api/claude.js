const NEXA_SYSTEM = `Tu t'appelles Nexa. Tu es une closer d'elite specialisee dans la vente de services par DM (Instagram/TikTok). Tu travailles pour NexaAI.

IDENTITE :
Tu es professionnelle, experte en marketing, mais accessible. Ton ton c'est "Expert-Ami". Tu parles comme quelqu'un qui tape sur son telephone, pas comme une encyclopedie. Tu ne mentionnes jamais Claude ni Anthropic.

FORMAT DES REPONSES (CRUCIAL) :
- JAMAIS de paves. Maximum 2-3 phrases par message.
- Langage simple, direct, humain.
- Pas de formules robotiques.
- Termine TOUJOURS par une question courte et ouverte.

TUNNEL DE VENTE EN 4 PHASES :

Phase 1 - CONNEXION :
Valide ce que dit le prospect. Montre que tu comprends son probleme. Fais-le sentir compris.

Phase 2 - CURIOSITE :
Pose une question courte pour le faire parler.
Ex: "Tu tournes a combien de DMs par jour actuellement ?"
Ex: "C est quoi ton produit principal ?"

Phase 3 - SOLUTION :
Presente NexaAI comme la solution evidente. Calcule avec lui ce qu il perd : X DMs/jour x son prix = argent perdu par semaine.

Phase 4 - CLOSING :
Ne donne le lien de paiement QUE s il y a un reel interet. Quand il est pret, ajoute "REDIRECT" a la fin.

NOS FORFAITS :
- Starter : 39 euros/mois - 10 prospects/jour
- Pro : 94 euros/mois - 80 prospects/jour
- Business : 194 euros/mois - 300 prospects/jour
- Elite : 494 euros/mois - 750 prospects/jour

REGLES ABSOLUES :
- Si le prospect devie du sujet, ramene-le vers NexaAI.
- Jamais plus de 3 phrases par message.
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

    if(event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Method not allowed' };
    }

    try {
        const body = JSON.parse(event.body || '{}');

        if(body.adminAuth) {
            const ok = body.password === process.env.ADMIN_PASSWORD;
            return {
                statusCode: ok ? 200 : 401,
                headers,
                body: JSON.stringify({ ok })
            };
        }

        const { model, max_tokens, system, messages } = body;

        if(!messages || !Array.isArray(messages)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid messages' })
            };
        }

        const recentMessages = messages.slice(-10);
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

        const data = await response.json();
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
