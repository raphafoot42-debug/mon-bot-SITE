/**
 * NEXA AI - SYSTEME DE VENTE AUTONOME (TikTok Edition)
 * Piliers : Marketing AIDA, Comportement Humain, Conversion Universelle
 */

const NEXA_CONFIG = {
    minDelay: 45000,  // 45 secondes
    maxDelay: 180000, // 3 minutes
    typingSpeed: 150  // Simulation de frappe
};

// --- SECTION 1 : BIBLIOTHÈQUE MARKETING & HUMAINE ---
const SYSTEM_PROMPT = `
### TITRE 1 : STRATÉGIE MARKETING & VENTE
- Appliquer le framework AIDA (Attention, Intérêt, Désir, Action).
- Poser des questions de diagnostic : "Tu tournes à combien de vues ?", "Tu gagnes combien par mois avec ce business ?".
- Identifier les blocages du client pour présenter le lien comme la seule solution.
- Utiliser la rareté et l'urgence pour pousser au clic.

### TITRE 2 : PROTOCOLE HUMAIN & ADAPTATION
- Mirroring : Adopter le ton du client (jeune/cool ou pro/formel).
- Écoute active : Rebondir sur les mots précis du client. Pas de réponses génériques.
- Pacing : Vise 10 à 20 messages avant de sortir le lien de vente.
- Empathie : Utiliser des phrases comme "Je comprends, c'est galère au début" ou "Bien vu !".

### TITRE 3 : GESTION DU LIEN DE VENTE (DESTINATION)
- Le lien de destination est : [SALES_LINK].
- Si c'est un Beacons/Store : Parle de "catalogue" ou de "boutique".
- Si c'est un site pro : Parle de "plateforme officielle".
- Si c'est un Calendly : Parle de "réserver un créneau de stratégie".
- Ne jamais spammer le lien. L'envoyer quand le désir est au maximum.
`;

// --- SECTION 2 : LOGIQUE D'ENVOI ET DÉLAIS ---
async function sendChatMsg() {
    const input = document.getElementById('user-input');
    const chatBox = document.getElementById('chat-messages');
    const message = input.value.trim();

    if (!message) return;

    // Affichage utilisateur
    appendMessage('user', message);
    input.value = '';

    // 1. Délai "Humain" de lecture (3 à 8 secondes)
    await new Promise(resolve => setTimeout(resolve, Math.random() * (8000 - 3000) + 3000));

    // 2. Affichage "Nexa écrit..."
    const typingIndicator = showTypingIndicator();

    try {
        // Récupération du lien universel (Beacons, Shopify, etc.)
        const salesLink = localStorage.getItem('user_sales_link') || 'ton site de vente';

        // 3. Appel au serveur (Netlify Function)
        const response = await fetch('/.netlify/functions/claude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                system_instructions: SYSTEM_PROMPT.replace('[SALES_LINK]', salesLink),
                context: "Prospection TikTok en cours"
            })
        });

        const data = await response.json();

        // 4. Calcul du délai de réponse final (45s - 3min) pour paraître humain
        const finalDelay = Math.random() * (NEXA_CONFIG.maxDelay - NEXA_CONFIG.minDelay) + NEXA_CONFIG.minDelay;

        setTimeout(() => {
            removeTypingIndicator(typingIndicator);
            appendMessage('ai', data.reply);
        }, finalDelay);

    } catch (error) {
        console.error("Erreur Nexa:", error);
        removeTypingIndicator(typingIndicator);
        appendMessage('ai', "Désolé, j'ai un petit souci de connexion. On reprend ?");
    }
}

// --- SECTION 3 : INTERFACE ---
function appendMessage(role, text) {
    const chatMessages = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}-message`;
    msgDiv.innerHTML = `<p>${text}</p>`;
    chatMessages.appendChild(msgDiv);
    msgDiv.scrollIntoView({ behavior: 'smooth' });
}

function showTypingIndicator() {
    const chatMessages = document.getElementById('chat-messages');
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span> Nexa réfléchit...';
    chatMessages.appendChild(indicator);
    return indicator;
}

function removeTypingIndicator(el) {
    if (el) el.remove();
}
