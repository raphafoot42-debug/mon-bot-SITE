exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Récupération des paramètres (Netlify utilise event.queryStringParameters)
    const { code, error, state } = event.queryStringParameters || {};

    if (error) {
        return {
            statusCode: 302,
            headers: { ...headers, 'Location': '/?tiktok=error' },
            body: ''
        };
    }

    if (!code) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'No code provided' })
        };
    }

    try {
        // Note : Le verifier devrait idéalement être passé via le state ou géré côté client.
        // Si tu l'as mis en sessionStorage côté client, l'échange doit se faire via un appel fetch 
        // depuis le dashboard plutôt qu'une redirection directe ici.
        
        const params = new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY,
            client_secret: process.env.TIKTOK_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            // CORRECTION : URL compatible Netlify
            redirect_uri: 'https://steady-centaur-82e10a.netlify.app/.netlify/functions/tiktok-callback'
        });

        const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            return {
                statusCode: 302,
                headers: { ...headers, 'Location': '/?tiktok=error&msg=' + encodeURIComponent(tokenData.error_description || tokenData.error) },
                body: ''
            };
        }

        const accessToken = tokenData.access_token;
        const openId = tokenData.open_id;

        // Récupération du profil
        const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username', {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        const profileData = await profileRes.json();
        const user = profileData.data?.user;

        const tiktokInfo = encodeURIComponent(JSON.stringify({
            openId: openId,
            username: user?.username || '',
            displayName: user?.display_name || '',
            avatar: user?.avatar_url || '',
            accessToken: accessToken
        }));

        // Redirection finale vers le dashboard
        return {
            statusCode: 302,
            headers: { 
                ...headers, 
                'Location': '/dashboard.html?tiktok=success&data=' + tiktokInfo 
            },
            body: ''
        };

    } catch (err) {
        console.error('TikTok callback error:', err);
        return {
            statusCode: 302,
            headers: { ...headers, 'Location': '/dashboard.html?tiktok=error' },
            body: ''
        };
    }
};
