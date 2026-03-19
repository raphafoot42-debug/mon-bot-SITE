export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée' }); return; }

  const { prompt } = req.body;
  if (!prompt) { res.status(400).json({ error: 'Prompt manquant' }); return; }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Tu es un expert développeur web. Génère UNIQUEMENT du code HTML complet en un seul fichier pour : "${prompt}". Design moderne, fond sombre, accents colorés, responsive. CSS dans <style>, JS dans <script>. Réponds uniquement avec le code HTML, rien d'autre.`
        }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let code = data.content[0].text.replace(/```html/gi, '').replace(/```/g, '').trim();
    res.status(200).json({ code });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
