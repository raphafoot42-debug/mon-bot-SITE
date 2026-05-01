const axios = require('axios');

exports.handler = async (event) => {
    // Vérification de la méthode
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Méthode non autorisée" };
    }

    try {
        const { message } = JSON.parse(event.body);

        // L'ORDRE MAGIQUE : On récupère ta clé cachée dans Netlify
        const apiKey = process.env.ANTHROPIC_API_KEY;

        const response = await axios.post('https://api.anthropic.com/v1/messages', {
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 1024,
            messages: [{ role: "user", content: message }]
        }, {
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            }
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ reply: response.data.content[0].text })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Erreur de connexion à l'IA" })
        };
    }
};
