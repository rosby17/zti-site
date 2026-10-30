// Crée un compte du tableau de bord et affiche son mot de passe provisoire (à changer à la 1re connexion).
// Usage : node src/creer-membre.js email@exemple.com "Nom Prénom" [admin|membre]
import { sql } from './db.js';
import { hacher, motDePasseProvisoire, estEmail } from './securite.js';
import { migrer } from './migrer.js';

const [email, nom, role = 'admin'] = process.argv.slice(2);
if (!estEmail(email || '') || !nom) { console.error('Usage : node src/creer-membre.js email "Nom" [admin|membre]'); process.exit(1); }
await migrer();
const provisoire = motDePasseProvisoire();
await sql`insert into equipe (email, nom, role, mot_de_passe) values (${email.toLowerCase()}, ${nom}, ${role === 'membre' ? 'membre' : 'admin'}, ${await hacher(provisoire)})
  on conflict ((lower(email))) do update set mot_de_passe = excluded.mot_de_passe, doit_changer = true, actif = true`;
console.log(`Compte prêt pour ${email}. Mot de passe provisoire : ${provisoire}`);
await sql.end();
