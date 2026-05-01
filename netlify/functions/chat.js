exports.handler = async (event) => {
    // On n'accepte que les requêtes POST (celles de ton chatbot)
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Méthode non autorisée" };
    }

    try {
        const { message } = JSON.parse(event.body);
        
        // C'est ici que Netlify va chercher ta clé ANTHROPIC_API_KEY
        const apiKey = process.env.ANTHROPIC_API_KEY;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: "claude-3-5-sonnet-20240620",
                max_tokens: 1024,
                messages: [{ role: "user", content: message }]
            })
        });

        const data = await response.json();

        // On renvoie la réponse de Claude à ton site
        return {
            statusCode: 200,
            body: JSON.stringify({ reply: data.content[0].text })
        };
    } catch (error) {
        console.error("Erreur détaillée:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Erreur de connexion à l'IA" })
        };
    }
};
