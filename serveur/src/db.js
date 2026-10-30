// Connexion à PostgreSQL. Toutes les requêtes passent par des gabarits sql`…` : les valeurs sont toujours envoyées
// à part (jamais collées dans le texte SQL), ce qui écarte les injections.
import postgres from 'postgres';
import { config } from './config.js';

export const sql = postgres(config.base, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: { undefined: null },
  onnotice: () => {},
});
