// Démarrage : contrôle des réglages, migrations de la base, puis écoute.
import { serve } from '@hono/node-server';
import { config, verifierConfig } from './config.js';
import { migrer } from './migrer.js';
import { app } from './app.js';
import { sql } from './db.js';

verifierConfig();
await migrer();
// conservation limitée (loi n° 2024/017) : purge chaque nuit des données devenues inutiles
async function purger() {
  try {
    await sql`delete from visites where cree_le < now() - interval '13 months'`;
    await sql`delete from telechargements where cree_le < now() - interval '13 months'`;
    await sql`delete from demandes where etat = 'sans_suite' and mis_a_jour_le < now() - interval '3 years'`;
    await sql`delete from sessions where expire_le < now()`;
    await sql`delete from sessions_membres where expire_le < now()`;
    await sql`delete from jetons_membres where expire_le < now() or utilise`;
  } catch (e) { console.error('Purge :', e.code || '', e.message); }
}
purger();
setInterval(purger, 24 * 3600_000).unref();

const serveur = serve({ fetch: app.fetch, port: config.port }, i => console.log(`Serveur ZTi prêt sur le port ${i.port}`));
const arreter = async () => { serveur.close(); await sql.end({ timeout: 5 }); process.exit(0); };
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
