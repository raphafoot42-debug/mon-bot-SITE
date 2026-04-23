module.exports = async function handler(req, res) {
    const { code, error } = req.query;

    if (error) {
        return res.status(400).send("TikTok error: " + error);
    }

    if (!code) {
        return res.status(400).send("No code received");
    }

    return res.status(200).send("TikTok login success. Code: " + code);
};
