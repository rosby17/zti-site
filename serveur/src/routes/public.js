// API publique, appelée par le site de ZTi : demandes, avis, mesure d'audience. Pas de connexion : chaque route
// est limitée (anti-abus), contrôle et coupe ses saisies, et n'accepte que les sites autorisés (CORS).
import { Hono } from 'hono';
import { sql } from '../db.js';
import { config } from '../config.js';
import { alerter, accuserReception } from '../notifier.js';
import { texte, telephone, estEmail, domaine, appareil, empreinteVisiteur, adresseIp, limiter } from '../securite.js';
import { servirFichier } from '../fichiers.js';

export const publique = new Hono();

// événements que le navigateur peut envoyer (« demande », « avis », « inscription » et « telechargement » sont posés par le serveur)
const EVENEMENTS = ['vue', 'defilement', 'section', 'clic', 'sortie', 'formulaire', 'etape2', 'whatsapp', 'communaute', 'appel'];
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

// page du site sous la même forme que dans les visites : « accueil » → « / », « offres/audit-pme » → « /offres/audit-pme/ »
const cheminPage = p => { p = texte(p, 200).replace(/^\/?zti-site/, ''); if (!p || p === 'accueil' || p === '/') return '/'; return ('/' + p.replace(/^\/+|\/+$/g, '') + '/'); };

// lit le corps JSON (envoyé en application/json ou en text/plain par sendBeacon), 20 Ko au plus
async function corps(c) {
  const brut = await c.req.text();
  if (brut.length > 20_000) return null;
  try { const d = JSON.parse(brut); return d && typeof d === 'object' && !Array.isArray(d) ? d : null; } catch { return null; }
}

const trop = c => c.json({ erreur: 'Trop de demandes. Réessayez dans quelques minutes.' }, 429);

publique.get('/sante', async c => {
  if (!limiter('sante:' + adresseIp(c), 30, 60_000)) return trop(c);
  await sql`select 1`;
  return c.json({ ok: true });
});

// ——— demande de diagnostic / contact ———
publique.post('/demandes', async c => {
  const ip = adresseIp(c);
  if (!limiter('demande:' + ip, 5, 10 * 60_000) || !limiter('demande-global', 120, 3600_000)) return trop(c);
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
    page: cheminPage(d.page), campagne: texte(d.campagne, 80), referent: domaine(d.referent),
    ...Object.fromEntries(UTM.map(k => [k, texte(d[k], 120)])),
    visiteur: empreinteVisiteur(c),
  };
  // ambassadeur : code valide, compte actif, et jamais soi-même (même téléphone ou même e-mail)
  const code = texte(d.parrain, 40).toLowerCase();
  if (code) {
    const [p] = await sql`select id, tel, email from membres where lower(code) = ${code} and actif`;
    if (p && p.tel !== tel && (!email || p.email.toLowerCase() !== email.toLowerCase())) f.parrain_id = p.id;
  }
  const [ligne] = await sql`insert into demandes ${sql(f)} returning id`;
  await enregistrerEvenement(c, 'demande', { chemin: f.page || '/', ...f, parrain: code });

  accuserReception(f).catch(e => console.error('Accusé de réception :', e.message));
  const l = v => String(v || '').replace(/\s+/g, ' ').trim(); // une ligne par champ : pas de faux lien glissé dans l'alerte
  alerter('demandes', `Nouvelle demande — ${l(f.sujet) || 'Site'} — ${l(f.organisation || f.nom)}`, [
    '>>> Ouvrir la fiche dans le tableau de bord : ' + `${config.adresse}/admin/#/demandes/${ligne.id}`, '',
    `${l(f.nom)}${f.fonction ? ' (' + l(f.fonction) + ')' : ''} — ${f.tel}${f.email ? ' — ' + f.email : ''}`,
    f.organisation && `${l(f.profil)} : ${l(f.organisation)}${f.secteur ? ' (' + l(f.secteur) + ')' : ''}`,
    f.postes && `Ordinateurs : ${l(f.postes)}`, f.situation && `Situation : ${l(f.situation)}`,
    f.accompagnement && `Accompagnement : ${l(f.accompagnement)}`, besoins.length && `Besoins : ${l(besoins.join(', '))}`,
    f.moment && `À rappeler : ${l(f.moment)}`, f.utm_campaign && `Campagne : ${l(f.utm_campaign)} (${l(f.utm_source)})`,
    f.message && '', f.message && 'Message (écrit par le visiteur, ne pas cliquer sur un lien qu\'il contiendrait) :', f.message && '« ' + l(f.message) + ' »',
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
  const f = { note, nom, organisation: texte(d.organisation, 120), texte: avisTexte, tel: texte(d.tel, 30), page: cheminPage(d.page) };
  await sql`insert into avis ${sql(f)}`;
  await enregistrerEvenement(c, 'avis', { chemin: f.page || '/' });
  const l = v => String(v || '').replace(/\s+/g, ' ').trim();
  alerter('avis', `Nouvel avis (${note}/5) — ${l(nom)}`, ['>>> À valider dans le tableau de bord : ' + `${config.adresse}/admin/#/avis`, '',
    '« ' + l(avisTexte) + ' »', `— ${l(nom)}${f.organisation ? ', ' + l(f.organisation) : ''}`]).catch(e => console.error('Alerte :', e.message));
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
  if (!limiter('visite:' + adresseIp(c), 120, 60_000) || !limiter('visite-global', 3000, 60_000)) return c.body(null, 204);
  const d = await corps(c);
  if (!d || !EVENEMENTS.includes(d.evenement || 'vue')) return c.body(null, 204);
  await enregistrerEvenement(c, d.evenement || 'vue', d);
  return c.body(null, 204);
});

export async function enregistrerEvenement(c, evenement, d) {
  const chemin = texte(d.chemin, 200);
  if (!chemin.startsWith('/')) return;
  const ua = c.req.header('user-agent') || '';
  if (/bot|crawl|spider|slurp|preview|headless|lighthouse/i.test(ua)) return; // robots exclus des statistiques
  const pays = (c.req.header('cf-ipcountry') || '').toUpperCase();
  await sql`insert into visites ${sql({
    evenement, chemin, referent: domaine(d.referent),
    ...Object.fromEntries(UTM.map(k => [k, texte(d[k], 120)])),
    visiteur: empreinteVisiteur(c), appareil: appareil(ua), pays: /^[A-Z]{2}$/.test(pays) && pays !== 'XX' ? pays : '',
    valeur: Number.isInteger(d.valeur) && d.valeur >= 0 && d.valeur <= 100000 ? d.valeur : null,
    cible: texte(d.cible, 80), parrain: texte(d.parrain, 40).toLowerCase(),
  })}`;
}

// ——— catalogue : logiciels à télécharger (et plus tard formations, services) ———
publique.get('/produits', async c => {
  const type = ['logiciel', 'formation', 'service', 'materiel'].includes(c.req.query('type')) ? c.req.query('type') : null;
  const liste = await sql`
    select slug, type, categorie, nom, resume, description, prix, version, systeme, taille,
      (fichier <> '' or lien_externe <> '') as disponible, lien_externe <> '' as externe
    from produits where publie and (${type}::text is null or type = ${type}) order by ordre, nom`;
  c.header('Cache-Control', 'public, max-age=120');
  return c.json(liste);
});

// téléchargement : gratuit → fichier ou page officielle de l'éditeur ; payant → pas encore (boutique à venir)
publique.get('/telecharger/:slug', async c => {
  const slug = texte(c.req.param('slug'), 62).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) return c.json({ erreur: 'Introuvable.' }, 404);
  if (!limiter('dl:' + adresseIp(c), 30, 60 * 60_000)) return trop(c);
  const [p] = await sql`select id, nom, prix, lien_externe, fichier, fichier_nom from produits where slug = ${slug} and publie`;
  if (!p) return c.json({ erreur: 'Introuvable.' }, 404);
  if (p.prix) return c.json({ erreur: 'Ce logiciel est payant : contactez ZTi pour l\'obtenir.', payant: true }, 402);
  if (!p.fichier && !p.lien_externe) return c.json({ erreur: 'Bientôt disponible.' }, 404);
  const visiteur = empreinteVisiteur(c);
  const [deja] = await sql`select 1 from telechargements where produit_id = ${p.id} and visiteur = ${visiteur} and cree_le::date = current_date`;
  if (!deja && !/bot|crawl|spider/i.test(c.req.header('user-agent') || '')) await sql`insert into telechargements (produit_id, visiteur) values (${p.id}, ${visiteur})`;
  await enregistrerEvenement(c, 'telechargement', { chemin: '/telechargements/', cible: slug });
  if (p.lien_externe) return c.redirect(p.lien_externe, 302);
  return servirFichier(c, p.fichier, p.fichier_nom);
});
