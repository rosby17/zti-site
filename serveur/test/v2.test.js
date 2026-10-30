// Tests : comportement des visiteurs, catalogue et téléchargements, espace membre (ambassadeurs, points, échanges).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../src/db.js';
import { migrer } from '../src/migrer.js';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { hacher, viderLimites } from '../src/securite.js';

const SITE = config.origines[0], ICI = config.adresse;
const jar = { admin: '', membre: '' };
const req = (chemin, { methode = 'GET', corps, origine, qui, entetes = {}, brut } = {}) => app.request(chemin, {
  method: methode,
  headers: { ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(origine ? { Origin: origine } : {}),
    ...(qui && jar[qui] ? { Cookie: jar[qui] } : {}), 'User-Agent': 'Mozilla/5.0 (test)', ...entetes },
  body: brut ?? (corps !== undefined ? JSON.stringify(corps) : undefined),
});
const garder = (qui, r) => { const c = r.headers.get('set-cookie'); if (c) jar[qui] = c.split(';')[0]; return r; };
const admin = (chemin, o = {}) => req('/v1/admin' + chemin, { qui: 'admin', origine: o.methode && o.methode !== 'GET' ? ICI : undefined, ...o });
const membre = (chemin, o = {}) => req('/v1/membres' + chemin, { qui: 'membre', origine: o.methode && o.methode !== 'GET' ? ICI : undefined, ...o });
async function connecterAdmin() {
  await sql`insert into equipe (email, nom, role, mot_de_passe, doit_changer) values ('a@zti.cm', 'Admin', 'admin', ${await hacher('motdepasse-solide-1')}, false)`;
  garder('admin', await req('/v1/admin/connexion', { methode: 'POST', origine: ICI, corps: { email: 'a@zti.cm', mot_de_passe: 'motdepasse-solide-1' } }));
}
const inscrire = (x = {}) => req('/v1/membres/inscription', { methode: 'POST', origine: ICI, corps: {
  nom: 'Marie Ngono', email: 'marie@exemple.cm', tel: '677 11 22 33', mot_de_passe: 'motdepasse-marie', accord: true, ...x } });
const demande = x => req('/v1/demandes', { methode: 'POST', origine: SITE, corps: { nom: 'Paul Filleul', tel: '699 88 77 66', accord: true, page: '/', ...x } });

before(async () => { await sql`drop schema public cascade`; await sql`create schema public`; await migrer(); });
after(async () => { await sql.end(); });
beforeEach(async () => {
  viderLimites(); jar.admin = ''; jar.membre = '';
  await sql`truncate points, echanges, sessions_membres, jetons_membres, telechargements, notes, demandes, avis, visites, campagnes, sessions restart identity`;
  await sql`delete from equipe`; // pas de « truncate … cascade » : il viderait aussi les réglages (barème de points, modèles d'e-mails)
  await sql`delete from membres`;
});

// ——— comportement ———
test('comportement : défilement, sections, clics, temps, étapes de formulaire, pages de sortie', async () => {
  const ev = corps => req('/v1/visites', { methode: 'POST', origine: SITE, corps });
  await ev({ chemin: '/' }); await ev({ evenement: 'defilement', chemin: '/', valeur: 75 });
  await ev({ evenement: 'section', chemin: '/', cible: 'Pour qui', valeur: 1 }); await ev({ evenement: 'clic', chemin: '/', cible: 'Demander un diagnostic' });
  await ev({ evenement: 'formulaire', chemin: '/', valeur: 1 }); await ev({ evenement: 'sortie', chemin: '/', valeur: 42 });
  await ev({ evenement: 'demande', chemin: '/' }); // réservé au serveur : ignoré
  await connecterAdmin();
  const r = await (await admin('/comportement?jours=30')).json();
  const p = r.pages.find(x => x.chemin === '/');
  assert.equal(p.visites, 1); assert.equal(p.profondeur, 75); assert.equal(p.a75, 1); assert.equal(p.temps, 42); assert.equal(p.sorties, 1);
  assert.equal(r.sections[0].section, 'Pour qui'); assert.equal(r.clics[0].cible, 'Demander un diagnostic'); assert.equal(r.formulaire[0].visites, 1);
  assert.equal((await sql`select count(*)::int as n from visites where evenement = 'demande'`)[0].n, 0);
});

// ——— catalogue ———
test('catalogue : seuls les produits publiés sont visibles ; gratuit → page de l’éditeur ; payant → 402 ; brouillon → 404', async () => {
  const liste = await (await req('/v1/produits?type=logiciel')).json();
  assert.ok(liste.some(p => p.slug === 'anydesk'));
  assert.ok(!liste.some(p => p.slug === 'zti-arret-5s')); // brouillon
  assert.ok(liste.every(p => p.fichier === undefined && p.lien_externe === undefined));
  const r = await req('/v1/telecharger/anydesk');
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://anydesk.com/fr/downloads');
  assert.equal((await sql`select count(*)::int as n from telechargements`)[0].n, 1);
  assert.equal((await req('/v1/telecharger/zti-arret-5s')).status, 404);
  await sql`update produits set publie = true, prix = 5000, lien_externe = 'https://exemple.cm/x' where slug = 'zti-arret-5s'`;
  assert.equal((await req('/v1/telecharger/zti-arret-5s')).status, 402);
  assert.equal((await req('/v1/telecharger/..%2F..%2Fetc%2Fpasswd')).status, 404);
});

test('catalogue : envoi de fichier contrôlé (extension, contenu réel) et resservi en pièce jointe', async () => {
  await connecterAdmin();
  const [p] = await sql`select id from produits where slug = 'zti-restauration-fichiers-caches'`;
  const envoi = (nom, octets) => { const f = new FormData(); f.append('fichier', new File([octets], nom)); return admin(`/produits/${p.id}/fichier`, { methode: 'POST', brut: f }); };
  assert.equal((await envoi('outil.html', Buffer.from('<script>alert(1)</script>'))).status, 400);
  assert.equal((await envoi('outil.exe', Buffer.from('pas un exe'))).status, 400); // mauvaise signature
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
  const ok = await envoi('ZTi Restauration v1.zip', zip);
  assert.equal(ok.status, 200);
  await sql`update produits set publie = true where id = ${p.id}`;
  const dl = await req('/v1/telecharger/zti-restauration-fichiers-caches');
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename="ZTi-Restauration-v1.zip"$/);
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.equal(Buffer.from(await dl.arrayBuffer()).length, zip.length);
});

test('catalogue : un membre de l’équipe (non admin) ne peut pas modifier le catalogue', async () => {
  await sql`insert into equipe (email, nom, role, mot_de_passe, doit_changer) values ('m@zti.cm', 'Membre', 'membre', ${await hacher('motdepasse-solide-1')}, false)`;
  garder('admin', await req('/v1/admin/connexion', { methode: 'POST', origine: ICI, corps: { email: 'm@zti.cm', mot_de_passe: 'motdepasse-solide-1' } }));
  assert.equal((await admin('/produits', { methode: 'POST', corps: { nom: 'X', slug: 'xx' } })).status, 403);
});

// ——— espace membre ———
test('inscription : code de recommandation créé, compte en double refusé, mot de passe trop court refusé', async () => {
  assert.equal((await inscrire({ mot_de_passe: 'court' })).status, 400);
  const r = garder('membre', await inscrire());
  assert.equal(r.status, 201);
  const moi = await (await membre('/moi')).json();
  assert.equal(moi.membre.code, 'marie-ngono');
  assert.match(moi.lien, /\?ref=marie-ngono$/);
  assert.equal((await inscrire()).status, 409);
});

test('parrainage : points quand ZTi confirme la demande, puis quand le filleul devient client, jamais en double', async () => {
  garder('membre', await inscrire());
  await demande({ parrain: 'MARIE-NGONO' });
  const [d] = await sql`select id, parrain_id from demandes`;
  assert.ok(d.parrain_id);
  await connecterAdmin();
  await admin('/demandes/' + d.id, { methode: 'PATCH', corps: { etat: 'rappelee' } });
  await admin('/demandes/' + d.id, { methode: 'PATCH', corps: { etat: 'nouvelle' } });
  await admin('/demandes/' + d.id, { methode: 'PATCH', corps: { etat: 'devis' } });
  await admin('/demandes/' + d.id, { methode: 'PATCH', corps: { etat: 'client' } });
  await admin('/demandes/' + d.id, { methode: 'PATCH', corps: { etat: 'devis' } });
  await admin('/demandes/' + d.id, { methode: 'PATCH', corps: { etat: 'client' } });
  const moi = await (await membre('/moi')).json();
  assert.equal(moi.solde, 110); // 10 (confirmée) + 100 (client), une seule fois chacun
  assert.equal(moi.filleuls[0].nom, 'Paul F.'); // jamais le nom complet ni le téléphone du filleul
  assert.equal(moi.filleuls[0].tel, undefined);
});

test('parrainage : on ne peut pas se recommander soi-même ; code inconnu ou membre désactivé ignorés', async () => {
  garder('membre', await inscrire());
  await demande({ parrain: 'marie-ngono', tel: '677 11 22 33' }); // même téléphone que l'ambassadrice
  await demande({ parrain: 'inconnu' });
  await sql`update membres set actif = false`;
  await demande({ parrain: 'marie-ngono' });
  assert.equal((await sql`select count(*)::int as n from demandes where parrain_id is not null`)[0].n, 0);
});

test('échanges : points retirés tout de suite, refus = points rendus, solde insuffisant refusé, pas de double traitement', async () => {
  garder('membre', await inscrire());
  const [m] = await sql`select id from membres`;
  assert.equal((await membre('/echanges', { methode: 'POST', corps: { recompense: 'Nettoyage complet d\'un ordinateur' } })).status, 400); // 0 point
  await sql`insert into points (membre_id, points, motif, detail) values (${m.id}, 250, 'bonus', 'test')`;
  assert.equal((await membre('/echanges', { methode: 'POST', corps: { recompense: 'Récompense inventée' } })).status, 400);
  assert.equal((await membre('/echanges', { methode: 'POST', corps: { recompense: 'Nettoyage complet d\'un ordinateur' } })).status, 201);
  assert.equal((await (await membre('/moi')).json()).solde, 50);
  assert.equal((await membre('/echanges', { methode: 'POST', corps: { recompense: 'Nettoyage complet d\'un ordinateur' } })).status, 400); // plus assez
  await connecterAdmin();
  const [e] = await (await admin('/echanges')).json();
  assert.equal((await admin('/echanges/' + e.id, { methode: 'PATCH', corps: { statut: 'refuse' } })).status, 200);
  assert.equal((await admin('/echanges/' + e.id, { methode: 'PATCH', corps: { statut: 'accorde' } })).status, 409);
  assert.equal((await (await membre('/moi')).json()).solde, 250);
});

test('espace membre : protections (connexion, autre site, mot de passe oublié sans révéler les comptes)', async () => {
  assert.equal((await membre('/moi')).status, 401);
  const autre = await req('/v1/membres/inscription', { methode: 'POST', origine: 'https://pirate.example', corps: {} });
  assert.equal(autre.status, 403);
  await inscrire();
  const a = await (await req('/v1/membres/oubli', { methode: 'POST', origine: ICI, corps: { email: 'marie@exemple.cm' } })).json();
  const b = await (await req('/v1/membres/oubli', { methode: 'POST', origine: ICI, corps: { email: 'personne@exemple.cm' } })).json();
  assert.deepEqual(a, b);
  const mauvais = await req('/v1/membres/nouveau-mot-de-passe', { methode: 'POST', origine: ICI, corps: { jeton: 'faux', mot_de_passe: 'nouveau-mot-de-passe' } });
  assert.equal(mauvais.status, 400);
  const r = await req('/v1/membres/connexion', { methode: 'POST', origine: ICI, corps: { email: 'marie@exemple.cm', mot_de_passe: 'faux-mot-de-passe' } });
  assert.equal(r.status, 401);
});

test('admin : bonus de points tracé, désactivation d’un ambassadeur', async () => {
  garder('membre', await inscrire());
  const [m] = await sql`select id from membres`;
  await connecterAdmin();
  assert.equal((await admin(`/ambassadeurs/${m.id}/points`, { methode: 'POST', corps: { points: 50 } })).status, 400); // raison obligatoire
  assert.equal((await admin(`/ambassadeurs/${m.id}/points`, { methode: 'POST', corps: { points: 50, detail: 'Merci pour la vidéo' } })).status, 201);
  const fiche = await (await admin('/ambassadeurs/' + m.id)).json();
  assert.equal(fiche.historique[0].auteur, 'Admin');
  assert.equal((await admin('/ambassadeurs/' + m.id, { methode: 'PATCH', corps: { actif: false } })).status, 200);
  assert.equal((await membre('/moi')).status, 401);
});
