// API publique, appelée par le site de ZTi : demandes, avis, mesure d'audience. Pas de connexion : chaque route
// est limitée (anti-abus), contrôle et coupe ses saisies, et n'accepte que les sites autorisés (CORS).
import { Hono } from 'hono';
import { sql } from '../db.js';
import { config } from '../config.js';
import { alerter, accuserReception } from '../notifier.js';
import { texte, telephone, estEmail, domaine, appareil, empreinteVisiteur, adresseIp, limiter } from '../securite.js';

export const publique = new Hono();

const EVENEMENTS = ['vue', 'etape2', 'whatsapp', 'communaute', 'appel'];
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];

// CORS : seuls les sites de ZTi peuvent appeler l'API depuis un navigateur
publique.use('*', async (c, next) => {
  const origine = c.req.header('origin');
  const autorisee = origine && config.origines.includes(origine);
  if (autorisee) {
    c.header('Access-Control-Allow-Origin', origine);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    c.header('Access-Control-Max-Age', '86400');
  }
  if (c.req.method === 'OPTIONS') return c.body(null, autorisee ? 204 : 403);
  if (c.req.method === 'POST' && origine && !autorisee) return c.json({ erreur: 'Origine non autorisée.' }, 403);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'no-store');
  await next();
});

// lit le corps JSON (envoyé en application/json ou en text/plain par sendBeacon), 20 Ko au plus
async function corps(c) {
  const brut = await c.req.text();
  if (brut.length > 20_000) return null;
  try { const d = JSON.parse(brut); return d && typeof d === 'object' && !Array.isArray(d) ? d : null; } catch { return null; }
}

const trop = c => c.json({ erreur: 'Trop de demandes. Réessayez dans quelques minutes.' }, 429);

publique.get('/sante', async c => {
  await sql`select 1`;
  return c.json({ ok: true });
});

// ——— demande de diagnostic / contact ———
publique.post('/demandes', async c => {
  const ip = adresseIp(c);
  if (!limiter('demande:' + ip, 5, 10 * 60_000)) return trop(c);
  const d = await corps(c);
  if (!d) return c.json({ erreur: 'Demande illisible.' }, 400);
  if (texte(d.site_web)) return c.json({ ok: true }); // piège à robots : on fait semblant

  const nom = texte(d.nom, 80), tel = telephone(d.tel), email = texte(d.email, 160);
  const erreurs = [];
  if (nom.length < 2) erreurs.push('nom');
  if (!tel) erreurs.push('tel');
  if (email && !estEmail(email)) erreurs.push('email');
  if (d.accord !== true) erreurs.push('accord');
  if (erreurs.length) return c.json({ erreur: 'Informations manquantes ou incorrectes.', champs: erreurs }, 400);

  const besoins = (Array.isArray(d.besoins) ? d.besoins : String(d.besoins || '').split(','))
    .map(b => texte(b, 80)).filter(Boolean).slice(0, 15);
  const f = {
    sujet: texte(d.sujet, 120), profil: texte(d.profil, 40), organisation: texte(d.organisation, 120), secteur: texte(d.secteur, 60),
    nom, fonction: texte(d.fonction, 80), tel, email, lieu: texte(d.lieu, 120), postes: texte(d.postes, 30),
    situation: texte(d.situation, 160), besoins, accompagnement: texte(d.accompagnement, 160), prestataire: texte(d.prestataire, 80),
    depenses: texte(d.depenses, 60), moment: texte(d.moment, 30), message: texte(d.message, 1500), connu: texte(d.connu, 60),
    page: texte(d.page, 200), campagne: texte(d.campagne, 80), referent: domaine(d.referent),
    ...Object.fromEntries(UTM.map(k => [k, texte(d[k], 120)])),
    visiteur: empreinteVisiteur(c),
  };
  const [ligne] = await sql`insert into demandes ${sql(f)} returning id`;
  await enregistrerEvenement(c, 'demande', { chemin: f.page || '/', ...f });

  accuserReception(f).catch(e => console.error('Accusé de réception :', e.message));
  alerter('demandes', `Nouvelle demande — ${f.sujet || 'Site'} — ${f.organisation || f.nom}`, [
    `${f.nom}${f.fonction ? ' (' + f.fonction + ')' : ''} — ${f.tel}${f.email ? ' — ' + f.email : ''}`,
    f.organisation && `${f.profil} : ${f.organisation}${f.secteur ? ' (' + f.secteur + ')' : ''}`,
    f.postes && `Ordinateurs : ${f.postes}`, f.situation && `Situation : ${f.situation}`,
    f.accompagnement && `Accompagnement : ${f.accompagnement}`, besoins.length && `Besoins : ${besoins.join(', ')}`,
    f.message && `Message : ${f.message}`, f.moment && `À rappeler : ${f.moment}`,
    f.utm_campaign && `Campagne : ${f.utm_campaign} (${f.utm_source})`,
    '', `Fiche : ${config.adresse}/admin/#/demandes/${ligne.id}`,
  ]).catch(e => console.error('Alerte :', e.message));
  return c.json({ ok: true }, 201);
});

// ——— avis d'un client (publié seulement après validation) ———
publique.post('/avis', async c => {
  if (!limiter('avis:' + adresseIp(c), 3, 60 * 60_000)) return trop(c);
  const d = await corps(c);
  if (!d) return c.json({ erreur: 'Avis illisible.' }, 400);
  if (texte(d.site_web)) return c.json({ ok: true });
  const note = Number(d.note), nom = texte(d.nom, 80), avisTexte = texte(d.texte, 800);
  const erreurs = [];
  if (!Number.isInteger(note) || note < 1 || note > 5) erreurs.push('note');
  if (nom.length < 2) erreurs.push('nom');
  if (avisTexte.length < 10) erreurs.push('texte');
  if (d.accord !== true) erreurs.push('accord');
  if (erreurs.length) return c.json({ erreur: 'Informations manquantes ou incorrectes.', champs: erreurs }, 400);
  const f = { note, nom, organisation: texte(d.organisation, 120), texte: avisTexte, tel: texte(d.tel, 30), page: texte(d.page, 200) };
  await sql`insert into avis ${sql(f)}`;
  await enregistrerEvenement(c, 'avis', { chemin: f.page || '/' });
  alerter('avis', `Nouvel avis (${note}/5) — ${nom}`, [avisTexte, `— ${nom}${f.organisation ? ', ' + f.organisation : ''}`, '',
    `À valider : ${config.adresse}/admin/#/avis`]).catch(e => console.error('Alerte :', e.message));
  return c.json({ ok: true }, 201);
});

// avis publiés, affichés sur le site (sans le téléphone)
publique.get('/avis', async c => {
  const liste = await sql`
    select nom, organisation, note, texte, to_char(cree_le, 'YYYY-MM-DD') as date
    from avis where statut = 'publie' order by cree_le desc limit 30`;
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(liste);
});

// ——— mesure d'audience : une page vue ou une action (clic WhatsApp, étape 2 du formulaire…) ———
publique.post('/visites', async c => {
  if (!limiter('visite:' + adresseIp(c), 120, 60_000)) return c.body(null, 204);
  const d = await corps(c);
  if (!d || !EVENEMENTS.includes(d.evenement || 'vue')) return c.body(null, 204);
  await enregistrerEvenement(c, d.evenement || 'vue', d);
  return c.body(null, 204);
});

async function enregistrerEvenement(c, evenement, d) {
  const chemin = texte(d.chemin, 200);
  if (!chemin.startsWith('/')) return;
  const ua = c.req.header('user-agent') || '';
  if (/bot|crawl|spider|slurp|preview|headless|lighthouse/i.test(ua)) return; // robots exclus des statistiques
  const pays = (c.req.header('cf-ipcountry') || '').toUpperCase();
  await sql`insert into visites ${sql({
    evenement, chemin, referent: domaine(d.referent),
    ...Object.fromEntries(UTM.map(k => [k, texte(d[k], 120)])),
    visiteur: empreinteVisiteur(c), appareil: appareil(ua), pays: /^[A-Z]{2}$/.test(pays) && pays !== 'XX' ? pays : '',
  })}`;
}
