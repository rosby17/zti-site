// Réglages du serveur ZTi, lus dans les variables d'environnement (Coolify). Aucun secret dans le code.
const env = process.env;
const liste = v => (v || '').split(',').map(x => x.trim()).filter(Boolean);

export const config = {
  port: Number(env.PORT || 3000),
  base: env.DATABASE_URL || '',
  // sites autorisés à envoyer des formulaires et des visites (site public, aperçu, local)
  origines: liste(env.ORIGINES_AUTORISEES || 'http://localhost:4381'),
  // adresse publique du back-office (sert au contrôle d'origine des actions et aux liens des e-mails)
  adresse: (env.ADRESSE_PUBLIQUE || 'http://localhost:3000').replace(/\/$/, ''),
  // secret qui sert à calculer l'empreinte anonyme du jour des visiteurs (jamais l'adresse IP)
  secretVisites: env.SECRET_VISITES || '',
  // e-mails (Brevo, comme nos autres plateformes) : clé API et expéditeur validé dans Brevo
  brevo: env.BREVO_API_KEY || '',
  expediteurEmail: env.BREVO_SENDER_EMAIL || '',
  expediteurNom: env.BREVO_SENDER_NAME || 'ZTi',
  // derrière Cloudflare / Coolify, l'adresse du visiteur arrive dans un en-tête
  production: env.NODE_ENV === 'production',
};

export function verifierConfig() {
  const manque = [];
  if (!config.base) manque.push('DATABASE_URL');
  if (config.production && config.secretVisites.length < 32) manque.push('SECRET_VISITES (32 caractères au moins)');
  if (manque.length) throw new Error('Réglages manquants : ' + manque.join(', '));
}
