export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("No code received");
  }

  try {
    const client_key = process.env.TIKTOK_CLIENT_KEY;
    const client_secret = process.env.TIKTOK_CLIENT_SECRET;

    const params = new URLSearchParams({
      client_key,
      client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: "https://ton-site.vercel.app/api/tiktok-callback"
    });

    const tokenResponse = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      }
    );

    const data = await tokenResponse.json();

    // 🔴 IMPORTANT: vérifie aussi le statut HTTP
    if (!tokenResponse.ok) {
      return res.status(400).json(data);
    }

    if (!data.access_token) {
      return res.status(400).json(data);
    }

    return res.redirect(
      `/dashboard?access_token=${data.access_token}&open_id=${data.open_id}`
    );

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

