// Applique dans l'ordre les fichiers de serveur/migrations/ qui ne l'ont pas encore été (une transaction chacun).
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from './db.js';

const dossier = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrer() {
  await sql`create table if not exists migrations (nom text primary key, appliquee_le timestamptz not null default now())`;
  const faites = new Set((await sql`select nom from migrations`).map(r => r.nom));
  const fichiers = (await readdir(dossier)).filter(f => f.endsWith('.sql')).sort();
  for (const f of fichiers) {
    if (faites.has(f)) continue;
    const texte = await readFile(dossier + f, 'utf8');
    await sql.begin(async t => {
      await t.unsafe(texte);
      await t`insert into migrations (nom) values (${f}) on conflict do nothing`;
    });
    console.log('Migration appliquée :', f);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrer().then(() => sql.end()).catch(e => { console.error(e); process.exit(1); });
}
