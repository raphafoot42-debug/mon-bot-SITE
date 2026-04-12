# NexaAI Proxy — Guide de déploiement

## Structure
nexaai-proxy/
├── api/
│   └── claude.js     ← proxy Claude API
├── vercel.json       ← config Vercel
├── .gitignore        ← protège les clés
└── README.md

## Étapes

### 1. Créer le repo GitHub
- Va sur github.com → New repository
- Nom : nexaai-proxy
- Privé (Private)
- Uploade ces fichiers

### 2. Connecter à Vercel
- Va sur vercel.com → New Project
- Importe ton repo nexaai-proxy
- Clique Deploy

### 3. Ajouter la clé Claude dans Vercel
- Dans ton projet Vercel → Settings → Environment Variables
- Ajoute :
  - Nom : CLAUDE_API_KEY
  - Valeur : [COLLE TA CLÉ ICI DIRECTEMENT DANS VERCEL - NE PAS METTRE ICI]
- Clique Save
- Redéploie (Deployments → Redeploy)

### 4. Récupérer ton URL Vercel
Après déploiement tu auras une URL comme :
https://nexaai-proxy.vercel.app

### 5. Mettre à jour ta page HTML
Dans ton fichier nexaai_definitif.html, trouve cette ligne :
const PROXY_URL = 'https://nexaai-proxy.vercel.app/api/claude';
Et remplace l'URL par celle que Vercel t'a donnée.
