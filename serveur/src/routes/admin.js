// API du tableau de bord ZTi (back-office). Toute route, sauf la connexion, exige une session valide ;
// les actions qui modifient exigent en plus que la requête vienne du tableau de bord lui-même (anti-CSRF),
// et les actions sensibles (équipe, suppression, export, réglages) le rôle « admin ».
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sql } from '../db.js';
import { config } from '../config.js';
import { envoyer, reglage } from '../notifier.js';
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
  if (!limiter('cnx-ip:' + ip, 10, 15 * 60_000) || !limiter('cnx-mail:' + email, 5, 15 * 60_000))
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
  if (c.req.path.endsWith('/connexion')) return next();
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
  const libre = ['/moi', '/mot-de-passe', '/deconnexion'].some(p => c.req.path.endsWith(p));
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
      (select count(*) from avis where statut = 'en_attente')::int as avis_en_attente`;
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
    const [avant] = await t`select etat from demandes where id = ${id} for update`;
    if (!avant) return null;
    const [apres] = await t`update demandes set ${t(maj)}, mis_a_jour_le = now() where id = ${id} returning id, etat`;
    if (maj.etat && maj.etat !== avant.etat)
      await t`insert into notes (demande_id, auteur_id, genre, texte) values (${id}, ${m.id}, 'etat', ${avant.etat + ' → ' + maj.etat})`;
    return apres;
  });
  if (!resultat) return c.json({ erreur: 'Fiche introuvable.' }, 404);
  return c.json({ ok: true });
});

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
  const cellule = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
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
  if (!f.page.startsWith('/')) return [null, 'La page doit commencer par « / ».'];
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
  const lignes = await sql`select cle, valeur from reglages where cle in ('alertes', 'accuse_demande', 'signature')`;
  return c.json({
    ...Object.fromEntries(lignes.map(l => [l.cle, l.valeur])),
    emails_actifs: !!(config.brevo && config.expediteurEmail),
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
