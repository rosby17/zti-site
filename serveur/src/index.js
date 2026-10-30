// Démarrage : contrôle des réglages, migrations de la base, puis écoute.
import { serve } from '@hono/node-server';
import { config, verifierConfig } from './config.js';
import { migrer } from './migrer.js';
import { app } from './app.js';
import { sql } from './db.js';

verifierConfig();
await migrer();
const serveur = serve({ fetch: app.fetch, port: config.port }, i => console.log(`Serveur ZTi prêt sur le port ${i.port}`));
const arreter = async () => { serveur.close(); await sql.end({ timeout: 5 }); process.exit(0); };
process.on('SIGTERM', arreter);
process.on('SIGINT', arreter);
