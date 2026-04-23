module.exports = async function handler(req, res) {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send("No code received");
    }
    // ici plus tard on échangera le code contre un token TikTok
    return res.status(200).send("TikTok login success: " + code);
};
