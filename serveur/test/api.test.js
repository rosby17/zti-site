// Tests du serveur ZTi sur une vraie base PostgreSQL (DATABASE_URL, base de test jetable : elle est vidée).
// Lancer : DATABASE_URL=postgres://… npm test
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../src/db.js';
import { migrer } from '../src/migrer.js';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { hacher, viderLimites } from '../src/securite.js';

const SITE = config.origines[0];
const ADMIN = config.adresse;
let cookie = '';

const req = (chemin, { methode = 'GET', corps, origine, entetes = {}, avecCookie = true } = {}) =>
  app.request(chemin, {
    method: methode,
    headers: {
      ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(origine ? { Origin: origine } : {}),
      ...(avecCookie && cookie ? { Cookie: cookie } : {}),
      'User-Agent': 'Mozilla/5.0 (test)',
      ...entetes,
    },
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
const adminReq = (chemin, o = {}) => req('/v1/admin' + chemin, { origine: o.methode && o.methode !== 'GET' ? ADMIN : undefined, ...o });

async function membre(email, role = 'admin', mdp = 'motdepasse-solide-1', doitChanger = false) {
  const [m] = await sql`insert into equipe (email, nom, role, mot_de_passe, doit_changer)
    values (${email}, ${'Membre ' + role}, ${role}, ${await hacher(mdp)}, ${doitChanger}) returning id`;
  return m.id;
}
async function connecter(email, mdp = 'motdepasse-solide-1') {
  const r = await req('/v1/admin/connexion', { methode: 'POST', origine: ADMIN, corps: { email, mot_de_passe: mdp }, avecCookie: false });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return r;
}
const demandeValide = (x = {}) => ({ nom: 'Jean Test', tel: '699 00 00 00', accord: true, sujet: 'Essai', profil: 'Entreprise',
  organisation: 'Test SARL', besoins: ['Pannes'], utm_source: 'facebook', utm_campaign: 'essai-pme', page: '/offres/audit-pme/', ...x });

before(async () => {
  await sql`drop schema public cascade`;
  await sql`create schema public`;
  await migrer();
});
after(async () => { await sql.end(); });
beforeEach(async () => {
  viderLimites(); cookie = '';
  await sql`truncate points, echanges, sessions_membres, jetons_membres, telechargements, notes, demandes, avis, visites, campagnes, sessions restart identity`;
  await sql`delete from equipe`; // pas de « truncate … cascade » : il viderait aussi les réglages (barème de points, modèles d'e-mails)
  await sql`delete from membres`;
});

// ——— API publique ———
test('santé', async () => {
  assert.equal((await req('/v1/sante')).status, 200);
});

test('demande valide enregistrée, avec sa provenance et un événement « demande »', async () => {
  const r = await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: demandeValide() });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  const [d] = await sql`select * from demandes`;
  assert.equal(d.tel, '+237 6 99 00 00 00');
  assert.equal(d.etat, 'nouvelle');
  assert.deepEqual(d.besoins, ['Pannes']);
  assert.equal(d.utm_campaign, 'essai-pme');
  const [v] = await sql`select evenement from visites`;
  assert.equal(v.evenement, 'demande');
});

test('demande refusée : téléphone, nom, e-mail ou accord manquants', async () => {
  const r = await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: { nom: 'J', tel: '12', email: 'pas-un-mail' } });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.deepEqual(j.champs.sort(), ['accord', 'email', 'nom', 'tel']);
  assert.equal((await sql`select count(*)::int as n from demandes`)[0].n, 0);
});

test('piège à robots : réponse normale, rien enregistré', async () => {
  const r = await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: demandeValide({ site_web: 'http://spam' }) });
  assert.equal(r.status, 200);
  assert.equal((await sql`select count(*)::int as n from demandes`)[0].n, 0);
});

test('un autre site ne peut pas envoyer de demande (CORS)', async () => {
  const r = await req('/v1/demandes', { methode: 'POST', origine: 'https://pirate.example', corps: demandeValide() });
  assert.equal(r.status, 403);
  const pre = await req('/v1/demandes', { methode: 'OPTIONS', origine: 'https://pirate.example' });
  assert.equal(pre.status, 403);
  const preOk = await req('/v1/demandes', { methode: 'OPTIONS', origine: SITE });
  assert.equal(preOk.status, 204);
});

test('limite anti-abus : 5 demandes par 10 minutes et par adresse', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: demandeValide() })).status, 201);
  assert.equal((await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: demandeValide() })).status, 429);
});

test('corps illisible ou trop gros refusé', async () => {
  const r = await app.request('/v1/demandes', { method: 'POST', headers: { Origin: SITE }, body: '{pas du json' });
  assert.equal(r.status, 400);
  const gros = await app.request('/v1/demandes', { method: 'POST', headers: { Origin: SITE }, body: JSON.stringify({ message: 'x'.repeat(70_000) }) });
  assert.equal(gros.status, 413);
});

test('avis : en attente à l’envoi, publié seulement après validation, téléphone jamais public', async () => {
  const r = await req('/v1/avis', { methode: 'POST', origine: SITE, corps: { note: 5, nom: 'Awa', texte: 'Très bon travail, merci.', tel: '699', accord: true } });
  assert.equal(r.status, 201);
  assert.deepEqual(await (await req('/v1/avis')).json(), []);
  await sql`update avis set statut = 'publie'`;
  const publics = await (await req('/v1/avis')).json();
  assert.equal(publics.length, 1);
  assert.equal(publics[0].tel, undefined);
  assert.equal((await req('/v1/avis', { methode: 'POST', origine: SITE, corps: { note: 9, nom: 'A', texte: 'court' } })).status, 400);
});

test('visites : page vue enregistrée sans adresse IP ; robots et chemins invalides ignorés', async () => {
  await req('/v1/visites', { methode: 'POST', origine: SITE, corps: { chemin: '/', referent: 'https://www.facebook.com/x?y=1', utm_campaign: 'essai' } });
  await req('/v1/visites', { methode: 'POST', origine: SITE, corps: { chemin: 'javascript:alert(1)' } });
  await req('/v1/visites', { methode: 'POST', origine: SITE, corps: { chemin: '/' }, entetes: { 'User-Agent': 'Googlebot/2.1' } });
  await req('/v1/visites', { methode: 'POST', origine: SITE, corps: { evenement: 'demande', chemin: '/' } }); // réservé au serveur
  const v = await sql`select * from visites`;
  assert.equal(v.length, 1);
  assert.equal(v[0].referent, 'facebook.com');
  assert.ok(v[0].visiteur.length >= 16 && !v[0].visiteur.includes('.'));
});

// ——— tableau de bord ———
test('tableau de bord fermé sans connexion', async () => {
  assert.equal((await adminReq('/tableau')).status, 401);
  assert.equal((await adminReq('/demandes')).status, 401);
});

test('connexion : mauvais mot de passe, compte inconnu ou désactivé refusés avec le même message', async () => {
  await membre('a@zti.cm');
  const r1 = await connecter('a@zti.cm', 'mauvais-mot-de-passe');
  const r2 = await connecter('inconnu@zti.cm');
  await sql`update equipe set actif = false`;
  const r3 = await connecter('a@zti.cm');
  for (const r of [r1, r2, r3]) { assert.equal(r.status, 401); assert.equal((await r.json()).erreur, 'E-mail ou mot de passe incorrect.'); }
});

test('connexion limitée : 5 essais par e-mail en 15 minutes', async () => {
  await membre('a@zti.cm');
  for (let i = 0; i < 5; i++) await connecter('a@zti.cm', 'faux-' + i);
  assert.equal((await connecter('a@zti.cm')).status, 429);
});

test('cookie de session : HttpOnly, SameSite Strict ; le jeton n’est pas stocké tel quel', async () => {
  await membre('a@zti.cm');
  const r = await connecter('a@zti.cm');
  const c = r.headers.get('set-cookie');
  assert.match(c, /HttpOnly/i); assert.match(c, /SameSite=Strict/i);
  const jeton = cookie.split('=')[1];
  assert.equal((await sql`select count(*)::int as n from sessions where empreinte = ${jeton}`)[0].n, 0);
});

test('mot de passe provisoire : tout est bloqué tant qu’il n’est pas changé', async () => {
  await membre('a@zti.cm', 'admin', 'provisoire-1234', true);
  await connecter('a@zti.cm', 'provisoire-1234');
  assert.equal((await adminReq('/tableau')).status, 403);
  assert.equal((await adminReq('/mot-de-passe', { methode: 'POST', corps: { actuel: 'provisoire-1234', nouveau: 'court' } })).status, 400);
  assert.equal((await adminReq('/mot-de-passe', { methode: 'POST', corps: { actuel: 'provisoire-1234', nouveau: 'nouveau-mot-de-passe' } })).status, 200);
  assert.equal((await adminReq('/tableau')).status, 200);
});

test('anti-CSRF : une action venue d’un autre site est refusée', async () => {
  await membre('a@zti.cm');
  await connecter('a@zti.cm');
  const r = await req('/v1/admin/campagnes', { methode: 'POST', origine: 'https://pirate.example', corps: { nom: 'X', code: 'xx' } });
  assert.equal(r.status, 403);
  const sansOrigine = await req('/v1/admin/campagnes', { methode: 'POST', corps: { nom: 'X', code: 'xx' } });
  assert.equal(sansOrigine.status, 403);
});

test('suivi d’une demande : état, relance, montant, notes et historique', async () => {
  await membre('a@zti.cm');
  await connecter('a@zti.cm');
  await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: demandeValide() });
  const [d] = await (await adminReq('/demandes')).json();
  assert.equal((await adminReq('/demandes/' + d.id, { methode: 'PATCH', corps: { etat: 'inconnu' } })).status, 400);
  assert.equal((await adminReq('/demandes/' + d.id, { methode: 'PATCH', corps: { etat: 'devis', relance_le: '2026-11-05', montant: 150000 } })).status, 200);
  assert.equal((await adminReq('/demandes/' + d.id + '/notes', { methode: 'POST', corps: { genre: 'appel', texte: 'Rappelé, RDV jeudi' } })).status, 201);
  const fiche = await (await adminReq('/demandes/' + d.id)).json();
  assert.equal(fiche.fiche.etat, 'devis');
  assert.equal(fiche.fiche.relance_le, '2026-11-05');
  assert.deepEqual(fiche.notes.map(n => n.genre).sort(), ['appel', 'etat']);
  assert.equal((await adminReq('/demandes/pas-un-uuid')).status, 404);
  assert.equal((await adminReq('/demandes/00000000-0000-0000-0000-000000000000')).status, 404);
  // recherche avec caractères spéciaux (pas d'injection, pas d'erreur)
  assert.equal((await adminReq('/demandes?q=' + encodeURIComponent("%' or 1=1 --"))).status, 200);
  assert.equal((await (await adminReq('/demandes?q=Jean')).json()).length, 1);
});

test('rôles : un membre ne peut ni supprimer, ni exporter, ni gérer l’équipe, ni les réglages', async () => {
  await membre('admin@zti.cm');
  await membre('m@zti.cm', 'membre');
  await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: demandeValide() });
  await connecter('m@zti.cm');
  const [d] = await (await adminReq('/demandes')).json();
  assert.equal((await adminReq('/demandes/' + d.id, { methode: 'DELETE' })).status, 403);
  assert.equal((await adminReq('/export/demandes.csv')).status, 403);
  assert.equal((await adminReq('/equipe', { methode: 'POST', corps: { email: 'x@zti.cm', nom: 'X' } })).status, 403);
  assert.equal((await adminReq('/reglages', { methode: 'PUT', corps: { signature: { texte: 'x' } } })).status, 403);
  const equipe = await (await adminReq('/equipe')).json();
  assert.ok(equipe.every(m => m.email === undefined)); // un membre ne voit que les noms
});

test('équipe : création avec mot de passe provisoire, dernier admin protégé, désactivation coupe les sessions', async () => {
  const moi = await membre('admin@zti.cm');
  await connecter('admin@zti.cm');
  const r = await adminReq('/equipe', { methode: 'POST', corps: { email: 'Nouveau@ZTI.cm', nom: 'Nouveau', role: 'membre' } });
  assert.equal(r.status, 201);
  const { id, mot_de_passe_provisoire } = await r.json();
  assert.match(mot_de_passe_provisoire, /^[\w]{4}-[\w]{4}-[\w]{4}-[\w]{4}$/);
  assert.equal((await adminReq('/equipe', { methode: 'POST', corps: { email: 'nouveau@zti.cm', nom: 'Doublon' } })).status, 409);
  assert.equal((await adminReq('/equipe/' + moi, { methode: 'PATCH', corps: { actif: false } })).status, 400);
  assert.equal((await adminReq('/equipe/' + id, { methode: 'PATCH', corps: { actif: false } })).status, 200);
  assert.equal((await connecter('nouveau@zti.cm', mot_de_passe_provisoire)).status, 401);
});

test('export CSV : cellules dangereuses neutralisées', async () => {
  await membre('admin@zti.cm');
  await connecter('admin@zti.cm');
  await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: demandeValide({ organisation: '=HYPERLINK("http://x")' }) });
  const csv = await (await adminReq('/export/demandes.csv')).text();
  assert.ok(csv.includes(`"'=HYPERLINK`));
});

test('campagnes : création, code unique, statistiques visites → demandes → clients', async () => {
  await membre('admin@zti.cm');
  await connecter('admin@zti.cm');
  assert.equal((await adminReq('/campagnes', { methode: 'POST', corps: { nom: 'PME novembre', code: 'Pas Valide!' } })).status, 400);
  assert.equal((await adminReq('/campagnes', { methode: 'POST', corps: { nom: 'PME novembre', code: 'essai-pme', budget: 50000, page: '/offres/audit-pme/' } })).status, 201);
  assert.equal((await adminReq('/campagnes', { methode: 'POST', corps: { nom: 'Doublon', code: 'essai-pme' } })).status, 409);
  await req('/v1/visites', { methode: 'POST', origine: SITE, corps: { chemin: '/offres/audit-pme/', utm_source: 'facebook', utm_campaign: 'essai-pme' } });
  await req('/v1/demandes', { methode: 'POST', origine: SITE, corps: demandeValide() });
  await sql`update demandes set etat = 'client', montant = 200000`;
  const { stats } = await (await adminReq('/campagnes')).json();
  const s = stats.find(x => x.code === 'essai-pme');
  assert.equal(s.visites, 1); assert.equal(s.demandes, 1); assert.equal(s.clients, 1); assert.equal(Number(s.chiffre), 200000);
  const t = await (await adminReq('/tableau?jours=30')).json();
  assert.equal(t.chiffres.demandes, 1); assert.equal(t.chiffres.visites, 1); assert.equal(t.parJour.length, 30);
});

test('avis : modération par l’équipe', async () => {
  await membre('admin@zti.cm');
  await connecter('admin@zti.cm');
  await req('/v1/avis', { methode: 'POST', origine: SITE, corps: { note: 4, nom: 'Awa', texte: 'Intervention rapide et propre.', accord: true } });
  const [a] = await (await adminReq('/avis?statut=en_attente')).json();
  assert.equal((await adminReq('/avis/' + a.id, { methode: 'PATCH', corps: { statut: 'publie' } })).status, 200);
  assert.equal((await (await req('/v1/avis')).json()).length, 1);
});

test('réglages : modèles d’e-mails modifiables, adresses contrôlées', async () => {
  await membre('admin@zti.cm');
  await connecter('admin@zti.cm');
  assert.equal((await adminReq('/reglages', { methode: 'PUT', corps: { alertes: { destinataires: ['pas-un-mail'] } } })).status, 400);
  assert.equal((await adminReq('/reglages', { methode: 'PUT', corps: { accuse_demande: { actif: false, sujet: 'Merci', texte: 'Bonjour {prenom}' } } })).status, 200);
  const r = await (await adminReq('/reglages')).json();
  assert.equal(r.accuse_demande.actif, false);
  assert.equal(r.emails_actifs, false);
});

test('déconnexion : la session ne sert plus', async () => {
  await membre('admin@zti.cm');
  await connecter('admin@zti.cm');
  const ancien = cookie;
  assert.equal((await adminReq('/deconnexion', { methode: 'POST' })).status, 200);
  cookie = ancien;
  assert.equal((await adminReq('/tableau')).status, 401);
});

test('tableau de bord servi avec une politique de sécurité stricte', async () => {
  const r = await app.request('/admin/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});
