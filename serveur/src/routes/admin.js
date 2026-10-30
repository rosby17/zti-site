// API du tableau de bord ZTi (back-office). Toute route, sauf la connexion, exige une session valide ;
// les actions qui modifient exigent en plus que la requête vienne du tableau de bord lui-même (anti-CSRF),
// et les actions sensibles (équipe, suppression, export, réglages) le rôle « admin ».
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sql } from '../db.js';
import { config } from '../config.js';
import { envoyer, reglage } from '../notifier.js';
import { enregistrerFichier, supprimerFichier } from '../fichiers.js';
import {
  hacher, verifier, motDePasseProvisoire, regleMotDePasse, nouveauJeton, empreinteJeton,
  adresseIp, limiter, texte, estUuid, estEmail,
} from '../securite.js';

export const admin = new Hono();

const COOKIE = config.production ? '__Host-zti_session' : 'zti_session';
const DUREE = 7 * 24 * 3600 * 1000;
const ETATS = ['nouvelle', 'rappelee', 'rendez_vous', 'devis', 'client', 'sans_suite'];
const GENRES = ['note', 'appel', 'whatsapp', 'email', 'visite'];
const STATUTS_AVIS = ['en_attente', 'publie', 'refuse'];

admin.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
});

// contrôle d'origine : une action qui modifie doit venir du tableau de bord (même site)
function origineOk(c) {
  if (['GET', 'HEAD'].includes(c.req.method)) return true;
  const o = c.req.header('origin');
  if (o) return o === config.adresse;
  const site = c.req.header('sec-fetch-site');
  return site === 'same-origin';
}

async function corps(c) {
  const brut = await c.req.text();
  if (brut.length > 50_000) return null;
  try { const d = JSON.parse(brut || '{}'); return d && typeof d === 'object' && !Array.isArray(d) ? d : null; } catch { return null; }
}

function poserCookie(c, jeton) {
  setCookie(c, COOKIE, jeton, {
    httpOnly: true, secure: config.production, sameSite: 'Strict', path: '/', maxAge: DUREE / 1000,
  });
}

// ——— connexion ———
admin.post('/connexion', async c => {
  if (!origineOk(c)) return c.json({ erreur: 'Origine refusée.' }, 403);
  const d = await corps(c);
  const email = texte(d?.email, 160).toLowerCase(), mdp = String(d?.mot_de_passe || '').slice(0, 200);
  const ip = adresseIp(c);
  if (!limiter('cnx-ip:' + ip, 10, 15 * 60_000) || !limiter('cnx:' + email + '|' + ip, 5, 15 * 60_000) || !limiter('cnx-mail:' + email, 20, 3600_000))
    return c.json({ erreur: 'Trop d\'essais. Réessayez dans 15 minutes.' }, 429);
  const [m] = await sql`select id, nom, email, role, mot_de_passe, actif, doit_changer from equipe where lower(email) = ${email}`;
  const ok = await verifier(mdp, m?.actif ? m.mot_de_passe : null);
  if (!ok) return c.json({ erreur: 'E-mail ou mot de passe incorrect.' }, 401);
  const jeton = nouveauJeton();
  await sql`insert into sessions (empreinte, membre_id, expire_le) values (${empreinteJeton(jeton)}, ${m.id}, ${new Date(Date.now() + DUREE)})`;
  await sql`update equipe set derniere_connexion = now() where id = ${m.id}`;
  await sql`delete from sessions where expire_le < now()`;
  poserCookie(c, jeton);
  return c.json({ membre: { id: m.id, nom: m.nom, email: m.email, role: m.role, doit_changer: m.doit_changer } });
});

// ——— session obligatoire pour tout le reste ———
admin.use('*', async (c, next) => {
  if (c.req.path === '/v1/admin/connexion') return next();
  if (!origineOk(c)) return c.json({ erreur: 'Origine refusée.' }, 403);
  const jeton = getCookie(c, COOKIE);
  if (!jeton) return c.json({ erreur: 'Connexion nécessaire.' }, 401);
  const [m] = await sql`
    select e.id, e.nom, e.email, e.role, e.doit_changer, s.expire_le
    from sessions s join equipe e on e.id = s.membre_id
    where s.empreinte = ${empreinteJeton(jeton)} and s.expire_le > now() and e.actif`;
  if (!m) { deleteCookie(c, COOKIE, { path: '/', secure: config.production }); return c.json({ erreur: 'Session expirée.' }, 401); }
  // session glissante : prolongée si elle expire dans moins de 3 jours
  if (new Date(m.expire_le).getTime() - Date.now() < 3 * 24 * 3600 * 1000) {
    await sql`update sessions set expire_le = ${new Date(Date.now() + DUREE)} where empreinte = ${empreinteJeton(jeton)}`;
    poserCookie(c, jeton);
  }
  c.set('membre', m);
  c.set('jeton', jeton);
  // mot de passe provisoire : seules ces routes restent ouvertes tant qu'il n'est pas changé
  const libre = ['/moi', '/mot-de-passe', '/deconnexion'].map(p => '/v1/admin' + p).includes(c.req.path);
  if (m.doit_changer && !libre) return c.json({ erreur: 'Changez d\'abord votre mot de passe provisoire.' }, 403);
  return next();
});

const estAdmin = c => c.get('membre').role === 'admin';
const refuse = c => c.json({ erreur: 'Réservé aux administrateurs.' }, 403);

admin.get('/moi', c => { const m = c.get('membre'); return c.json({ id: m.id, nom: m.nom, email: m.email, role: m.role, doit_changer: m.doit_changer }); });

admin.post('/deconnexion', async c => {
  await sql`delete from sessions where empreinte = ${empreinteJeton(c.get('jeton'))}`;
  deleteCookie(c, COOKIE, { path: '/', secure: config.production });
  return c.json({ ok: true });
});

admin.post('/mot-de-passe', async c => {
  const d = await corps(c);
  const m = c.get('membre');
  if (!limiter('mdp:' + m.id, 10, 15 * 60_000)) return c.json({ erreur: 'Trop d\'essais.' }, 429);
  const [ligne] = await sql`select mot_de_passe from equipe where id = ${m.id}`;
  if (!(await verifier(String(d?.actuel || ''), ligne.mot_de_passe))) return c.json({ erreur: 'Mot de passe actuel incorrect.' }, 400);
  if (!regleMotDePasse(d?.nouveau)) return c.json({ erreur: 'Le nouveau mot de passe doit faire au moins 10 caractères.' }, 400);
  if (d.nouveau === d.actuel) return c.json({ erreur: 'Choisissez un mot de passe différent.' }, 400);
  await sql`update equipe set mot_de_passe = ${await hacher(d.nouveau)}, doit_changer = false where id = ${m.id}`;
  // les autres sessions de ce membre sont fermées
  await sql`delete from sessions where membre_id = ${m.id} and empreinte <> ${empreinteJeton(c.get('jeton'))}`;
  return c.json({ ok: true });
});

// ——— tableau de bord : statistiques de la période ———
admin.get('/tableau', async c => {
  const jours = [7, 30, 90, 365].includes(Number(c.req.query('jours'))) ? Number(c.req.query('jours')) : 30;
  const depuis = sql`now() - make_interval(days => ${jours})`;
  const [chiffres] = await sql`
    select
      (select count(*) from visites where evenement = 'vue' and cree_le >= ${depuis})::int as pages_vues,
      (select count(distinct (visiteur, cree_le::date)) from visites where evenement = 'vue' and cree_le >= ${depuis})::int as visites,
      (select count(distinct (visiteur, cree_le::date)) from visites where evenement = 'etape2' and cree_le >= ${depuis})::int as etape2,
      (select count(*) from visites where evenement in ('whatsapp', 'communaute', 'appel') and cree_le >= ${depuis})::int as clics_contact,
      (select count(*) from demandes where cree_le >= ${depuis})::int as demandes,
      (select count(*) from demandes where cree_le >= ${depuis} and etat = 'client')::int as clients,
      (select coalesce(sum(montant), 0) from demandes where cree_le >= ${depuis} and etat = 'client')::bigint as chiffre,
      (select count(*) from demandes where etat = 'nouvelle')::int as a_traiter,
      (select count(*) from demandes where relance_le <= current_date and etat not in ('client', 'sans_suite'))::int as a_relancer,
      (select count(*) from avis where statut = 'en_attente')::int as avis_en_attente,
      (select count(*) from echanges where statut = 'demande')::int as echanges_en_attente,
      (select count(*) from membres where cree_le >= ${depuis})::int as nouveaux_membres,
      (select count(*) from demandes where parrain_id is not null and cree_le >= ${depuis})::int as demandes_recommandees`;
  const parJour = await sql`
    select to_char(j, 'YYYY-MM-DD') as jour,
      (select count(distinct visiteur) from visites v where v.evenement = 'vue' and v.cree_le::date = j)::int as visites,
      (select count(*) from demandes d where d.cree_le::date = j)::int as demandes
    from generate_series((now() - make_interval(days => ${jours - 1}))::date, now()::date, '1 day') as j order by j`;
  const pages = await sql`
    select chemin, count(*)::int as vues, count(distinct (visiteur, cree_le::date))::int as visites
    from visites where evenement = 'vue' and cree_le >= ${depuis} group by chemin order by vues desc limit 12`;
  const sources = await sql`
    select coalesce(nullif(utm_source, ''), nullif(referent, ''), 'Accès direct') as source,
      count(distinct (visiteur, cree_le::date))::int as visites
    from visites where evenement = 'vue' and cree_le >= ${depuis} group by 1 order by 2 desc limit 10`;
  const appareils = await sql`
    select coalesce(nullif(appareil, ''), 'inconnu') as appareil, count(distinct (visiteur, cree_le::date))::int as visites
    from visites where evenement = 'vue' and cree_le >= ${depuis} group by 1 order by 2 desc`;
  const pays = await sql`
    select coalesce(nullif(pays, ''), '?') as pays, count(distinct (visiteur, cree_le::date))::int as visites
    from visites where evenement = 'vue' and cree_le >= ${depuis} group by 1 order by 2 desc limit 8`;
  const etats = await sql`select etat, count(*)::int as n from demandes group by etat`;
  const relances = await sql`
    select id, nom, organisation, tel, etat, to_char(relance_le, 'YYYY-MM-DD') as relance_le
    from demandes where relance_le <= current_date and etat not in ('client', 'sans_suite') order by relance_le limit 10`;
  const recentes = await sql`
    select id, nom, organisation, sujet, etat, cree_le from demandes order by cree_le desc limit 6`;
  return c.json({ jours, chiffres, parJour, pages, sources, appareils, pays, etats, relances, recentes, campagnes: await statsCampagnes(jours) });
});

async function statsCampagnes(jours) {
  return sql`
    with v as (
      select utm_campaign as code, max(utm_source) as source, count(distinct (visiteur, cree_le::date))::int as visites
      from visites where evenement = 'vue' and utm_campaign <> '' and cree_le >= now() - make_interval(days => ${jours}) group by 1),
    d as (
      select utm_campaign as code, count(*)::int as demandes, count(*) filter (where etat = 'client')::int as clients,
        coalesce(sum(montant) filter (where etat = 'client'), 0)::bigint as chiffre
      from demandes where utm_campaign <> '' and cree_le >= now() - make_interval(days => ${jours}) group by 1)
    select coalesce(k.code, v.code, d.code) as code, k.id, k.nom, k.budget, coalesce(k.source, v.source) as source,
      coalesce(v.visites, 0) as visites, coalesce(d.demandes, 0) as demandes, coalesce(d.clients, 0) as clients, coalesce(d.chiffre, 0) as chiffre
    from campagnes k full join v on v.code = k.code full join d on d.code = coalesce(k.code, v.code)
    where k.code is not null or d.code is not null
    order by coalesce(d.demandes, 0) desc, coalesce(v.visites, 0) desc`;
}

// ——— demandes = fiches de suivi des clients ———
admin.get('/demandes', async c => {
  const etat = c.req.query('etat'), campagne = texte(c.req.query('campagne'), 80), q = texte(c.req.query('q'), 80);
  const page = Math.max(0, Math.min(1000, Number(c.req.query('page')) || 0));
  const motif = q ? '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%' : null;
  const liste = await sql`
    select d.id, d.cree_le, d.etat, d.nom, d.organisation, d.profil, d.tel, d.email, d.sujet, d.postes, d.accompagnement,
      d.utm_campaign, d.utm_source, d.montant, to_char(d.relance_le, 'YYYY-MM-DD') as relance_le, e.nom as responsable,
      (select count(*) from notes n where n.demande_id = d.id)::int as nb_notes
    from demandes d left join equipe e on e.id = d.responsable_id
    where (${ETATS.includes(etat) ? etat : null}::text is null or d.etat = ${ETATS.includes(etat) ? etat : null})
      and (${campagne || null}::text is null or d.utm_campaign = ${campagne || null})
      and (${motif}::text is null or d.nom ilike ${motif} or d.organisation ilike ${motif} or d.tel ilike ${motif} or d.email ilike ${motif})
    order by d.cree_le desc limit 50 offset ${page * 50}`;
  return c.json(liste);
});

admin.get('/demandes/:id', async c => {
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  const [fiche] = await sql`select d.*, to_char(d.relance_le, 'YYYY-MM-DD') as relance_le from demandes d where d.id = ${id}`;
  if (!fiche) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  const notes = await sql`
    select n.id, n.genre, n.texte, n.cree_le, e.nom as auteur from notes n left join equipe e on e.id = n.auteur_id
    where n.demande_id = ${id} order by n.cree_le desc`;
  return c.json({ fiche, notes });
});

admin.patch('/demandes/:id', async c => {
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  const d = await corps(c);
  if (!d) return c.json({ erreur: 'Requête illisible.' }, 400);
  const m = c.get('membre');
  const maj = {};
  if (d.etat !== undefined) { if (!ETATS.includes(d.etat)) return c.json({ erreur: 'État inconnu.' }, 400); maj.etat = d.etat; }
  if (d.relance_le !== undefined) {
    if (d.relance_le !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d.relance_le)) return c.json({ erreur: 'Date de relance invalide.' }, 400);
    maj.relance_le = d.relance_le;
  }
  if (d.montant !== undefined) {
    const n = d.montant === null || d.montant === '' ? null : Number(d.montant);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 1e12)) return c.json({ erreur: 'Montant invalide.' }, 400);
    maj.montant = n;
  }
  if (d.responsable_id !== undefined) {
    if (d.responsable_id !== null) {
      if (!estUuid(d.responsable_id)) return c.json({ erreur: 'Responsable inconnu.' }, 400);
      const [r] = await sql`select id from equipe where id = ${d.responsable_id} and actif`;
      if (!r) return c.json({ erreur: 'Responsable inconnu.' }, 400);
    }
    maj.responsable_id = d.responsable_id;
  }
  if (!Object.keys(maj).length) return c.json({ erreur: 'Rien à modifier.' }, 400);
  const resultat = await sql.begin(async t => {
    const [avant] = await t`select etat, parrain_id from demandes where id = ${id} for update`;
    if (!avant) return null;
    // une fiche recommandée ne passe « client » que par un administrateur (elle rapporte des points)
    if (maj.etat === 'client' && avant.parrain_id && c.get('membre').role !== 'admin') return 'interdit';
    const [apres] = await t`update demandes set ${t(maj)}, mis_a_jour_le = now() where id = ${id} returning id, etat`;
    if (maj.etat && maj.etat !== avant.etat) {
      await t`insert into notes (demande_id, auteur_id, genre, texte) values (${id}, ${m.id}, 'etat', ${avant.etat + ' → ' + maj.etat})`;
      await crediterParrain(t, id, maj.etat, m.id);
    }
    return apres;
  });
  if (!resultat) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  if (resultat === 'interdit') return c.json({ erreur: 'Fiche recommandée par un ambassadeur : seul un administrateur la passe en « Client ».' }, 403);
  return c.json({ ok: true });
});

// points de l'ambassadeur : une fois quand ZTi confirme la demande du filleul, une fois quand il devient client
// (index unique : jamais deux fois les mêmes points pour une demande, même si l'état fait des allers-retours)
async function crediterParrain(t, demandeId, etat, auteurId) {
  const [d] = await t`select parrain_id, nom, tel from demandes where id = ${demandeId}`;
  if (!d?.parrain_id) return;
  const fid = (await t`select valeur from reglages where cle = 'fidelite'`)[0]?.valeur || {};
  if (fid.actif === false) return;
  const prenom = String(d.nom).split(' ')[0];
  // une seule fois par personne recommandée (même téléphone), même si elle envoie plusieurs demandes
  const dejaPour = async motif => (await t`select 1 from points p join demandes x on x.id = p.demande_id
    where p.membre_id = ${d.parrain_id} and p.motif = ${motif} and x.tel = ${d.tel} limit 1`).length > 0;
  if (['rendez_vous', 'devis', 'client'].includes(etat) && fid.points_recommandation > 0 && !(await dejaPour('recommandation')))
    await t`insert into points (membre_id, points, motif, detail, demande_id, auteur_id) values (${d.parrain_id}, ${fid.points_recommandation}, 'recommandation', ${'Demande de ' + prenom + ' confirmée'}, ${demandeId}, ${auteurId}) on conflict do nothing`;
  if (etat === 'client' && fid.points_client > 0 && !(await dejaPour('client')))
    await t`insert into points (membre_id, points, motif, detail, demande_id, auteur_id) values (${d.parrain_id}, ${fid.points_client}, 'client', ${prenom + ' est devenu client'}, ${demandeId}, ${auteurId}) on conflict do nothing`;
}

admin.post('/demandes/:id/notes', async c => {
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  const d = await corps(c);
  const genre = GENRES.includes(d?.genre) ? d.genre : 'note';
  const t = texte(d?.texte, 3000);
  if (!t) return c.json({ erreur: 'La note est vide.' }, 400);
  const [existe] = await sql`select id from demandes where id = ${id}`;
  if (!existe) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  await sql`insert into notes (demande_id, auteur_id, genre, texte) values (${id}, ${c.get('membre').id}, ${genre}, ${t})`;
  await sql`update demandes set mis_a_jour_le = now() where id = ${id}`;
  return c.json({ ok: true }, 201);
});

// e-mail écrit depuis la fiche (part par Brevo, gardé dans l'historique)
admin.post('/demandes/:id/email', async c => {
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  if (!limiter('email:' + c.get('membre').id, 30, 60 * 60_000)) return c.json({ erreur: 'Trop d\'e-mails envoyés. Réessayez plus tard.' }, 429);
  const d = await corps(c);
  const sujet = texte(d?.sujet, 180), corpsTexte = String(d?.texte || '').slice(0, 8000).trim();
  if (!sujet || !corpsTexte) return c.json({ erreur: 'Sujet et message obligatoires.' }, 400);
  const [fiche] = await sql`select email from demandes where id = ${id}`;
  if (!fiche) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  if (!fiche.email) return c.json({ erreur: 'Ce client n\'a pas donné d\'e-mail.' }, 400);
  const sig = await reglage('signature');
  const alertes = await reglage('alertes');
  const res = await envoyer({ a: fiche.email, sujet, texte: corpsTexte + (sig?.texte ? '\n\n' + sig.texte : ''), repondreA: alertes?.destinataires?.[0] });
  if (!res.ok) return c.json({ erreur: 'E-mail non envoyé : ' + res.raison }, 502);
  await sql`insert into notes (demande_id, auteur_id, genre, texte) values (${id}, ${c.get('membre').id}, 'email', ${'E-mail envoyé : ' + sujet + '\n\n' + corpsTexte})`;
  return c.json({ ok: true });
});

// suppression (demande d'effacement d'une personne, loi n° 2024/017) : admin seulement
admin.delete('/demandes/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  const r = await sql`delete from demandes where id = ${id}`;
  return r.count ? c.json({ ok: true }) : c.json({ erreur: 'Fiche introuvable.' }, 404);
});

// export tableur (admin) ; les cellules qui commencent par = + - @ sont neutralisées
admin.get('/export/demandes.csv', async c => {
  if (!estAdmin(c)) return refuse(c);
  const lignes = await sql`
    select to_char(cree_le, 'YYYY-MM-DD HH24:MI') as date, etat, sujet, profil, organisation, secteur, nom, fonction, tel, email, lieu,
      postes, situation, array_to_string(besoins, ', ') as besoins, accompagnement, prestataire, depenses, moment, message, connu,
      montant, page, utm_source, utm_medium, utm_campaign, utm_content, referent
    from demandes order by cree_le desc`;
  const colonnes = lignes.columns?.map(x => x.name) || Object.keys(lignes[0] || { date: '' });
  const cellule = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s) && !/^\+237 [\d ]+$/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const csv = '﻿' + [colonnes.join(';'), ...lignes.map(l => colonnes.map(k => cellule(l[k])).join(';'))].join('\r\n');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="zti-demandes-${new Date().toISOString().slice(0, 10)}.csv"`);
  return c.body(csv);
});

// ——— avis ———
admin.get('/avis', async c => {
  const statut = STATUTS_AVIS.includes(c.req.query('statut')) ? c.req.query('statut') : 'en_attente';
  return c.json(await sql`
    select a.id, a.cree_le, a.statut, a.note, a.nom, a.organisation, a.texte, a.tel, a.page, a.modere_le, e.nom as modere_par
    from avis a left join equipe e on e.id = a.modere_par where a.statut = ${statut} order by a.cree_le desc limit 200`);
});

admin.patch('/avis/:id', async c => {
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Avis introuvable.' }, 404);
  const d = await corps(c);
  if (!STATUTS_AVIS.includes(d?.statut)) return c.json({ erreur: 'Statut inconnu.' }, 400);
  const r = await sql`update avis set statut = ${d.statut}, modere_par = ${c.get('membre').id}, modere_le = now() where id = ${id}`;
  return r.count ? c.json({ ok: true }) : c.json({ erreur: 'Avis introuvable.' }, 404);
});

admin.delete('/avis/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Avis introuvable.' }, 404);
  const r = await sql`delete from avis where id = ${id}`;
  return r.count ? c.json({ ok: true }) : c.json({ erreur: 'Avis introuvable.' }, 404);
});

// ——— campagnes publicitaires ———
admin.get('/campagnes', async c => {
  const jours = [7, 30, 90, 365].includes(Number(c.req.query('jours'))) ? Number(c.req.query('jours')) : 90;
  const stats = await statsCampagnes(jours);
  const toutes = await sql`select id, nom, code, source, support, page, budget, to_char(debut, 'YYYY-MM-DD') as debut,
    to_char(fin, 'YYYY-MM-DD') as fin, notes from campagnes order by cree_le desc`;
  return c.json({ jours, campagnes: toutes, stats });
});

function lireCampagne(d) {
  const f = {
    nom: texte(d.nom, 120), code: texte(d.code, 62).toLowerCase(), source: texte(d.source, 40).toLowerCase() || 'facebook',
    support: texte(d.support, 40).toLowerCase() || 'paid', page: texte(d.page, 200) || '/',
    budget: d.budget === '' || d.budget == null ? null : Number(d.budget),
    debut: d.debut || null, fin: d.fin || null, notes: texte(d.notes, 2000),
  };
  if (f.nom.length < 2) return [null, 'Nom de la campagne obligatoire.'];
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(f.code)) return [null, 'Code : lettres minuscules, chiffres et tirets (ex. ecoles-novembre).'];
  if (!/^[a-z0-9_-]{1,40}$/.test(f.source) || !/^[a-z0-9_-]{1,40}$/.test(f.support)) return [null, 'Source ou support invalide.'];
  if (!/^\/(?!\/)/.test(f.page)) return [null, 'La page doit commencer par « / ».'];
  if (f.budget !== null && (!Number.isInteger(f.budget) || f.budget < 0)) return [null, 'Budget invalide.'];
  for (const k of ['debut', 'fin']) if (f[k] && !/^\d{4}-\d{2}-\d{2}$/.test(f[k])) return [null, 'Date invalide.'];
  return [f, null];
}

admin.post('/campagnes', async c => {
  const [f, err] = lireCampagne((await corps(c)) || {});
  if (err) return c.json({ erreur: err }, 400);
  try { const [r] = await sql`insert into campagnes ${sql(f)} returning id`; return c.json({ id: r.id }, 201); }
  catch (e) { if (e.code === '23505') return c.json({ erreur: 'Ce code de campagne existe déjà.' }, 409); throw e; }
});

admin.patch('/campagnes/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Campagne introuvable.' }, 404);
  const [f, err] = lireCampagne((await corps(c)) || {});
  if (err) return c.json({ erreur: err }, 400);
  try {
    const r = await sql`update campagnes set ${sql(f)} where id = ${id}`;
    return r.count ? c.json({ ok: true }) : c.json({ erreur: 'Campagne introuvable.' }, 404);
  } catch (e) { if (e.code === '23505') return c.json({ erreur: 'Ce code de campagne existe déjà.' }, 409); throw e; }
});

admin.delete('/campagnes/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Campagne introuvable.' }, 404);
  const r = await sql`delete from campagnes where id = ${id}`;
  return r.count ? c.json({ ok: true }) : c.json({ erreur: 'Campagne introuvable.' }, 404);
});

// ——— équipe ———
admin.get('/equipe', async c => {
  const liste = await sql`select id, nom, email, role, actif, doit_changer, cree_le, derniere_connexion from equipe order by cree_le`;
  // un membre simple ne voit que les noms (pour choisir un responsable)
  return c.json(estAdmin(c) ? liste : liste.filter(m => m.actif).map(({ id, nom }) => ({ id, nom })));
});

admin.post('/equipe', async c => {
  if (!estAdmin(c)) return refuse(c);
  const d = await corps(c);
  const email = texte(d?.email, 160).toLowerCase(), nom = texte(d?.nom, 80), role = d?.role === 'admin' ? 'admin' : 'membre';
  if (!estEmail(email) || nom.length < 2) return c.json({ erreur: 'Nom et e-mail valides obligatoires.' }, 400);
  const provisoire = motDePasseProvisoire();
  try {
    const [m] = await sql`insert into equipe (email, nom, role, mot_de_passe) values (${email}, ${nom}, ${role}, ${await hacher(provisoire)}) returning id`;
    return c.json({ id: m.id, mot_de_passe_provisoire: provisoire }, 201);
  } catch (e) { if (e.code === '23505') return c.json({ erreur: 'Cet e-mail a déjà un compte.' }, 409); throw e; }
});

admin.patch('/equipe/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Membre introuvable.' }, 404);
  const d = await corps(c);
  const maj = {};
  if (typeof d?.actif === 'boolean') maj.actif = d.actif;
  if (['admin', 'membre'].includes(d?.role)) maj.role = d.role;
  if (!Object.keys(maj).length) return c.json({ erreur: 'Rien à modifier.' }, 400);
  if (id === c.get('membre').id) return c.json({ erreur: 'Vous ne pouvez pas modifier votre propre compte ici.' }, 400);
  const r = await sql.begin(async t => {
    const res = await t`update equipe set ${t(maj)} where id = ${id}`;
    const [{ n }] = await t`select count(*)::int as n from equipe where role = 'admin' and actif`;
    if (n < 1) throw Object.assign(new Error('dernier admin'), { dernierAdmin: true });
    if (maj.actif === false) await t`delete from sessions where membre_id = ${id}`;
    return res;
  }).catch(e => { if (e.dernierAdmin) return 'dernier'; throw e; });
  if (r === 'dernier') return c.json({ erreur: 'Il doit rester au moins un administrateur actif.' }, 400);
  return r.count ? c.json({ ok: true }) : c.json({ erreur: 'Membre introuvable.' }, 404);
});

admin.post('/equipe/:id/reinitialiser', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Membre introuvable.' }, 404);
  const provisoire = motDePasseProvisoire();
  const r = await sql`update equipe set mot_de_passe = ${await hacher(provisoire)}, doit_changer = true where id = ${id}`;
  if (!r.count) return c.json({ erreur: 'Membre introuvable.' }, 404);
  await sql`delete from sessions where membre_id = ${id}`;
  return c.json({ mot_de_passe_provisoire: provisoire });
});

// ——— réglages : e-mails ———
admin.get('/reglages', async c => {
  const lignes = await sql`select cle, valeur from reglages where cle in ('alertes', 'accuse_demande', 'signature', 'fidelite')`;
  return c.json({
    ...Object.fromEntries(lignes.map(l => [l.cle, l.valeur])),
    emails_actifs: !!(config.brevo && config.expediteurEmail),
    site: config.sitePublic,
    expediteur: config.expediteurEmail ? `${config.expediteurNom} <${config.expediteurEmail}>` : '',
  });
});

admin.put('/reglages', async c => {
  if (!estAdmin(c)) return refuse(c);
  const d = await corps(c);
  if (!d) return c.json({ erreur: 'Requête illisible.' }, 400);
  const m = c.get('membre');
  const valeurs = {};
  if (d.alertes) {
    const destinataires = (Array.isArray(d.alertes.destinataires) ? d.alertes.destinataires : [])
      .map(x => texte(x, 160).toLowerCase()).filter(Boolean).slice(0, 5);
    if (destinataires.some(x => !estEmail(x))) return c.json({ erreur: 'Une adresse d\'alerte n\'est pas valide.' }, 400);
    valeurs.alertes = { destinataires, demandes: d.alertes.demandes !== false, avis: d.alertes.avis !== false };
  }
  if (d.accuse_demande) {
    const sujet = texte(d.accuse_demande.sujet, 180), t = String(d.accuse_demande.texte || '').slice(0, 5000).trim();
    if (!sujet || !t) return c.json({ erreur: 'Sujet et texte de l\'accusé de réception obligatoires.' }, 400);
    valeurs.accuse_demande = { actif: d.accuse_demande.actif !== false, sujet, texte: t };
  }
  if (d.signature) valeurs.signature = { texte: String(d.signature.texte || '').slice(0, 1000).trim() };
  if (d.fidelite) {
    const n = v => Math.max(0, Math.min(100000, Math.round(Number(v) || 0)));
    const recompenses = (Array.isArray(d.fidelite.recompenses) ? d.fidelite.recompenses : []).slice(0, 20)
      .map(r => ({ nom: texte(r?.nom, 120), points: n(r?.points) })).filter(r => r.nom && r.points > 0);
    valeurs.fidelite = { actif: d.fidelite.actif !== false, points_bienvenue: n(d.fidelite.points_bienvenue),
      points_recommandation: n(d.fidelite.points_recommandation), points_client: n(d.fidelite.points_client), recompenses };
  }
  for (const [cle, valeur] of Object.entries(valeurs))
    await sql`insert into reglages (cle, valeur, modifie_par) values (${cle}, ${sql.json(valeur)}, ${m.id})
      on conflict (cle) do update set valeur = excluded.valeur, modifie_le = now(), modifie_par = excluded.modifie_par`;
  return c.json({ ok: true });
});

// envoi d'essai à l'adresse de la personne connectée
admin.post('/reglages/essai', async c => {
  if (!limiter('essai:' + c.get('membre').id, 5, 60 * 60_000)) return c.json({ erreur: 'Trop d\'essais.' }, 429);
  const res = await envoyer({ a: c.get('membre').email, sujet: 'Essai d\'e-mail — tableau de bord ZTi',
    texte: 'Bonjour,\n\nCet e-mail d\'essai confirme que les envois du site ZTi fonctionnent.\n\nL\'équipe ZTi' });
  return res.ok ? c.json({ ok: true }) : c.json({ erreur: 'Non envoyé : ' + res.raison }, 502);
});

// ——— comportement des visiteurs ———
admin.get('/comportement', async c => {
  const jours = [7, 30, 90, 365].includes(Number(c.req.query('jours'))) ? Number(c.req.query('jours')) : 30;
  const chemin = texte(c.req.query('chemin'), 200) || null;
  const depuis = sql`now() - make_interval(days => ${jours})`;
  const pages = await sql`
    with v as (select chemin, visiteur, cree_le::date as j, min(cree_le) as debut, max(cree_le) as fin from visites
               where evenement = 'vue' and cree_le >= ${depuis} group by 1, 2, 3),
    prof as (select chemin, visiteur, cree_le::date as j, max(valeur) as p from visites
             where evenement = 'defilement' and cree_le >= ${depuis} group by 1, 2, 3),
    temps as (select chemin, avg(least(valeur, 1800))::int as t from visites where evenement = 'sortie' and valeur > 0 and cree_le >= ${depuis} group by 1),
    derniere as (select distinct on (visiteur, cree_le::date) visiteur, cree_le::date as j, chemin from visites
                 where evenement = 'vue' and cree_le >= ${depuis} order by visiteur, cree_le::date, cree_le desc),
    premiere as (select distinct on (visiteur, cree_le::date) visiteur, cree_le::date as j, chemin from visites
                 where evenement = 'vue' and cree_le >= ${depuis} order by visiteur, cree_le::date, cree_le),
    dem as (select page as chemin, count(*)::int as n from demandes where cree_le >= ${depuis} group by 1)
    select v.chemin, count(*)::int as visites,
      coalesce(round(avg(coalesce(prof.p, 0))), 0)::int as profondeur,
      count(*) filter (where prof.p >= 50)::int as a50, count(*) filter (where prof.p >= 75)::int as a75, count(*) filter (where prof.p >= 100)::int as a100,
      (select t from temps where temps.chemin = v.chemin) as temps,
      (select count(*) from derniere d where d.chemin = v.chemin)::int as sorties,
      (select count(*) from premiere p where p.chemin = v.chemin)::int as entrees,
      coalesce((select n from dem where dem.chemin = v.chemin), 0) as demandes
    from v left join prof on prof.chemin = v.chemin and prof.visiteur = v.visiteur and prof.j = v.j
    group by v.chemin order by visites desc limit 30`;
  const choisi = chemin || pages[0]?.chemin || '/';
  const [{ total }] = await sql`select count(distinct (visiteur, cree_le::date))::int as total from visites where evenement = 'vue' and chemin = ${choisi} and cree_le >= ${depuis}`;
  const sections = await sql`
    select cible as section, count(distinct (visiteur, cree_le::date))::int as visites, min(valeur) as ordre
    from visites where evenement = 'section' and chemin = ${choisi} and cree_le >= ${depuis} and cible <> '' group by cible order by min(valeur) nulls last, 2 desc limit 30`;
  const clics = await sql`
    select cible, count(*)::int as n, count(distinct (visiteur, cree_le::date))::int as visites
    from visites where evenement = 'clic' and chemin = ${choisi} and cree_le >= ${depuis} and cible <> '' group by cible order by 2 desc limit 15`;
  const formulaire = await sql`
    select coalesce(valeur, 1) as etape, count(distinct (visiteur, cree_le::date))::int as visites
    from visites where evenement = 'formulaire' and chemin = ${choisi} and cree_le >= ${depuis} group by 1 order by 1`;
  const [{ envoyes }] = await sql`select count(*)::int as envoyes from demandes where page = ${choisi} and cree_le >= ${depuis}`;
  const clicsSite = await sql`
    select cible, count(*)::int as n from visites where evenement in ('clic', 'whatsapp', 'communaute', 'appel') and cree_le >= ${depuis} and cible <> ''
    group by cible order by 2 desc limit 12`;
  return c.json({ jours, chemin: choisi, total, pages, sections, clics, formulaire, envoyes, clicsSite });
});

// ——— catalogue (logiciels ; plus tard formations, services) ———
const TYPES = ['logiciel', 'formation', 'service', 'materiel'], CATEGORIES = ['assistance', 'outil', 'formation', 'autre'];
admin.get('/produits', async c => c.json(await sql`
  select p.*, (select count(*) from telechargements t where t.produit_id = p.id)::int as telechargements,
    (select count(*) from telechargements t where t.produit_id = p.id and t.cree_le >= now() - interval '30 days')::int as telechargements_30j
  from produits p order by p.ordre, p.nom`));

function lireProduit(d) {
  const f = {
    type: TYPES.includes(d.type) ? d.type : 'logiciel', categorie: CATEGORIES.includes(d.categorie) ? d.categorie : 'outil',
    nom: texte(d.nom, 120), slug: texte(d.slug, 62).toLowerCase(), resume: texte(d.resume, 400), description: String(d.description || '').slice(0, 5000).trim(),
    prix: d.prix === '' || d.prix == null ? null : Number(d.prix), lien_externe: texte(d.lien_externe, 400), version: texte(d.version, 40),
    systeme: texte(d.systeme, 120), publie: d.publie === true, ordre: Number.isInteger(Number(d.ordre)) ? Number(d.ordre) : 50,
  };
  if (f.nom.length < 2) return [null, 'Nom obligatoire.'];
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(f.slug)) return [null, 'Adresse : lettres minuscules, chiffres et tirets.'];
  if (f.prix !== null && (!Number.isInteger(f.prix) || f.prix < 0)) return [null, 'Prix invalide.'];
  if (f.lien_externe) { try { const u = new URL(f.lien_externe); if (u.protocol !== 'https:') throw 0; } catch { return [null, 'Le lien de téléchargement doit commencer par https://'] } }
  return [f, null];
}
admin.post('/produits', async c => {
  if (!estAdmin(c)) return refuse(c);
  const [f, err] = lireProduit((await corps(c)) || {});
  if (err) return c.json({ erreur: err }, 400);
  try { const [r] = await sql`insert into produits ${sql(f)} returning id`; return c.json({ id: r.id }, 201); }
  catch (e) { if (e.code === '23505') return c.json({ erreur: 'Cette adresse existe déjà.' }, 409); throw e; }
});
admin.patch('/produits/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Produit introuvable.' }, 404);
  const [f, err] = lireProduit((await corps(c)) || {});
  if (err) return c.json({ erreur: err }, 400);
  try { const r = await sql`update produits set ${sql(f)}, modifie_le = now() where id = ${id}`; return r.count ? c.json({ ok: true }) : c.json({ erreur: 'Produit introuvable.' }, 404); }
  catch (e) { if (e.code === '23505') return c.json({ erreur: 'Cette adresse existe déjà.' }, 409); throw e; }
});
admin.delete('/produits/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Produit introuvable.' }, 404);
  const [p] = await sql`delete from produits where id = ${id} returning fichier`;
  if (!p) return c.json({ erreur: 'Produit introuvable.' }, 404);
  await supprimerFichier(p.fichier);
  return c.json({ ok: true });
});
// envoi du fichier d'un logiciel (admin) : liste blanche, contrôle du contenu, nom aléatoire sur le serveur
admin.post('/produits/:id/fichier', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Produit introuvable.' }, 404);
  const [p] = await sql`select fichier from produits where id = ${id}`;
  if (!p) return c.json({ erreur: 'Produit introuvable.' }, 404);
  const form = await c.req.parseBody().catch(() => null);
  const fichier = form?.fichier;
  if (!fichier || typeof fichier === 'string') return c.json({ erreur: 'Aucun fichier reçu.' }, 400);
  try {
    const f = await enregistrerFichier(fichier);
    await sql`update produits set fichier = ${f.fichier}, fichier_nom = ${f.fichier_nom}, taille = ${f.taille}, modifie_le = now() where id = ${id}`;
    await supprimerFichier(p.fichier);
    return c.json({ ok: true, ...f, fichier: undefined });
  } catch (e) { if (e.statut) return c.json({ erreur: e.message }, e.statut); throw e; }
});

// ——— ambassadeurs et fidélité ———
admin.get('/ambassadeurs', async c => c.json(await sql`
  select m.id, m.nom, m.email, m.tel, m.code, m.actif, m.cree_le, m.derniere_connexion, p.nom as parrain,
    coalesce((select sum(points) from points where membre_id = m.id), 0)::int as solde,
    (select count(*) from demandes where parrain_id = m.id)::int as filleuls,
    (select count(*) from demandes where parrain_id = m.id and etat = 'client')::int as clients,
    (select count(*) from membres f where f.parrain_id = m.id)::int as inscrits
  from membres m left join membres p on p.id = m.parrain_id order by solde desc, m.cree_le desc limit 500`));

admin.get('/ambassadeurs/:id', async c => {
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Membre introuvable.' }, 404);
  const [m] = await sql`select id, nom, email, tel, code, actif, cree_le from membres where id = ${id}`;
  if (!m) return c.json({ erreur: 'Membre introuvable.' }, 404);
  const historique = await sql`select p.points, p.motif, p.detail, p.cree_le, e.nom as auteur from points p left join equipe e on e.id = p.auteur_id where p.membre_id = ${id} order by p.cree_le desc limit 200`;
  const filleuls = await sql`select id, nom, organisation, etat, cree_le from demandes where parrain_id = ${id} order by cree_le desc limit 200`;
  return c.json({ membre: m, historique, filleuls });
});

admin.post('/ambassadeurs/:id/points', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Membre introuvable.' }, 404);
  const d = await corps(c);
  const n = Number(d?.points), motif = d?.motif === 'correction' ? 'correction' : 'bonus', detail = texte(d?.detail, 200);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 100000) return c.json({ erreur: 'Nombre de points invalide.' }, 400);
  if (!detail) return c.json({ erreur: 'Indiquez la raison.' }, 400);
  const [m] = await sql`select id from membres where id = ${id}`;
  if (!m) return c.json({ erreur: 'Membre introuvable.' }, 404);
  await sql`insert into points (membre_id, points, motif, detail, auteur_id) values (${id}, ${n}, ${motif}, ${detail}, ${c.get('membre').id})`;
  return c.json({ ok: true }, 201);
});

admin.patch('/ambassadeurs/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Membre introuvable.' }, 404);
  const d = await corps(c);
  if (typeof d?.actif !== 'boolean') return c.json({ erreur: 'Rien à modifier.' }, 400);
  const r = await sql`update membres set actif = ${d.actif} where id = ${id}`;
  if (!d.actif) await sql`delete from sessions_membres where membre_id = ${id}`;
  return r.count ? c.json({ ok: true }) : c.json({ erreur: 'Membre introuvable.' }, 404);
});

admin.get('/echanges', async c => {
  const statut = ['demande', 'accorde', 'refuse'].includes(c.req.query('statut')) ? c.req.query('statut') : 'demande';
  return c.json(await sql`select e.id, e.recompense, e.points, e.statut, e.cree_le, e.traite_le, e.note, m.nom, m.tel, m.email
    from echanges e join membres m on m.id = e.membre_id where e.statut = ${statut} order by e.cree_le desc limit 200`);
});

// accorder ou refuser un échange ; un refus rend les points (ligne inverse dans le registre)
admin.patch('/echanges/:id', async c => {
  if (!estAdmin(c)) return refuse(c);
  const id = c.req.param('id');
  if (!estUuid(id)) return c.json({ erreur: 'Échange introuvable.' }, 404);
  const d = await corps(c);
  if (!['accorde', 'refuse'].includes(d?.statut)) return c.json({ erreur: 'Statut inconnu.' }, 400);
  const res = await sql.begin(async t => {
    const [e] = await t`select membre_id, points, recompense, statut from echanges where id = ${id} for update`;
    if (!e) return 404;
    if (e.statut !== 'demande') return 409;
    await t`update echanges set statut = ${d.statut}, traite_le = now(), traite_par = ${c.get('membre').id}, note = ${texte(d.note, 300)} where id = ${id}`;
    if (d.statut === 'refuse') await t`insert into points (membre_id, points, motif, detail, echange_id, auteur_id) values (${e.membre_id}, ${e.points}, 'echange_refuse', ${'Points rendus : ' + e.recompense}, ${id}, ${c.get('membre').id})`;
    return 200;
  });
  if (res === 404) return c.json({ erreur: 'Échange introuvable.' }, 404);
  if (res === 409) return c.json({ erreur: 'Cet échange a déjà été traité.' }, 409);
  return c.json({ ok: true });
});
