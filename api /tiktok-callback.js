export default function handler(req, res) {
  const { code, state } = req.query;

  res.status(200).send(`
    <html>
      <body style="background:black;color:white;font-family:Arial;text-align:center;padding-top:100px">
        <h1>Connexion TikTok OK ✅</h1>
        <p>Code reçu :</p>
        <pre>${code}</pre>
      </body>
    </html>
  `);
}
