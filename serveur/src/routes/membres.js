// Espace membre (ambassadeurs) : un compte, un code de recommandation, des points de fidélité.
// Points : registre (table points) jamais modifié ; le solde est la somme des lignes. Un échange retire les points
// tout de suite (ils sont rendus si ZTi refuse). Mêmes protections que le tableau de bord : cookie HttpOnly
// SameSite=Strict, jeton haché en base, contrôle d'origine, limites anti-abus.
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sql } from '../db.js';
import { config } from '../config.js';
import { envoyer, reglage } from '../notifier.js';
import { enregistrerEvenement } from './public.js';
import {
  hacher, verifier, regleMotDePasse, nouveauJeton, empreinteJeton, adresseIp, limiter, texte, estEmail, telephone,
} from '../securite.js';

export const membres = new Hono();
const COOKIE = config.production ? '__Host-zti_membre' : 'zti_membre';
const DUREE = 30 * 24 * 3600 * 1000;

membres.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff'); await next(); });

function origineOk(c) {
  if (['GET', 'HEAD'].includes(c.req.method)) return true;
  const o = c.req.header('origin');
  return o ? o === config.adresse : c.req.header('sec-fetch-site') === 'same-origin';
}
async function corps(c) {
  const brut = await c.req.text();
  if (brut.length > 20_000) return null;
  try { const d = JSON.parse(brut || '{}'); return d && typeof d === 'object' && !Array.isArray(d) ? d : null; } catch { return null; }
}
const poserCookie = (c, jeton) => setCookie(c, COOKIE, jeton, { httpOnly: true, secure: config.production, sameSite: 'Strict', path: '/', maxAge: DUREE / 1000 });
async function ouvrirSession(c, id) {
  const jeton = nouveauJeton();
  await sql`insert into sessions_membres (empreinte, membre_id, expire_le) values (${empreinteJeton(jeton)}, ${id}, ${new Date(Date.now() + DUREE)})`;
  await sql`update membres set derniere_connexion = now() where id = ${id}`;
  poserCookie(c, jeton);
}

// code de recommandation lisible, tiré du nom : « marie-ngono », puis « marie-ngono2 »… (mots réservés exclus)
const RESERVES = ['admin', 'zti', 'ztisysteme', 'contact', 'support', 'espace', 'api', 'test'];
async function codeLibre(nom) {
  const base = (nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20)) || 'membre';
  for (let i = 0; i < 50; i++) {
    const code = i ? base + (i + 1) : base;
    if (RESERVES.includes(code)) continue;
    const [pris] = await sql`select 1 from membres where lower(code) = ${code}`;
    if (!pris) return code;
  }
  return base + '-' + Date.now().toString(36);
}

// ——— inscription ———
membres.post('/inscription', async c => {
  if (!origineOk(c)) return c.json({ erreur: 'Origine refusée.' }, 403);
  if (!limiter('insc:' + adresseIp(c), 5, 60 * 60_000)) return c.json({ erreur: 'Trop d\'inscriptions. Réessayez plus tard.' }, 429);
  const d = await corps(c);
  const nom = texte(d?.nom, 80), email = texte(d?.email, 160).toLowerCase(), tel = telephone(d?.tel), mdp = d?.mot_de_passe;
  const erreurs = [];
  if (nom.length < 2) erreurs.push('nom');
  if (!estEmail(email)) erreurs.push('email');
  if (!tel) erreurs.push('tel');
  if (!regleMotDePasse(mdp)) erreurs.push('mot_de_passe');
  if (d?.accord !== true) erreurs.push('accord');
  if (erreurs.length) return c.json({ erreur: 'Informations manquantes ou incorrectes.', champs: erreurs }, 400);
  const [existe] = await sql`select 1 from membres where lower(email) = ${email}`;
  if (existe) return c.json({ erreur: 'Un compte existe déjà avec cet e-mail. Connectez-vous.' }, 409);
  // parrain : code valide et actif ; le premier parrain est gardé pour toujours ; jamais soi-même
  let parrainId = null;
  const code = texte(d?.parrain, 40).toLowerCase();
  if (code) {
    const [p] = await sql`select id, tel, email from membres where lower(code) = ${code} and actif`;
    if (p && p.tel !== tel && p.email.toLowerCase() !== email) parrainId = p.id;
  }
  const fid = (await reglage('fidelite')) || {};
  const id = await sql.begin(async t => {
    const [m] = await t`insert into membres (nom, email, tel, mot_de_passe, code, parrain_id)
      values (${nom}, ${email}, ${tel}, ${await hacher(mdp)}, ${await codeLibre(nom)}, ${parrainId}) returning id`;
    if (fid.points_bienvenue > 0) await t`insert into points (membre_id, points, motif, detail) values (${m.id}, ${fid.points_bienvenue}, 'bienvenue', 'Bienvenue chez les ambassadeurs ZTi')`;
    return m.id;
  });
  await enregistrerEvenement(c, 'inscription', { chemin: '/espace/', parrain: code });
  await ouvrirSession(c, id);
  return c.json({ ok: true }, 201);
});

// ——— connexion, déconnexion ———
membres.post('/connexion', async c => {
  if (!origineOk(c)) return c.json({ erreur: 'Origine refusée.' }, 403);
  const d = await corps(c);
  const email = texte(d?.email, 160).toLowerCase();
  if (!limiter('mcnx-ip:' + adresseIp(c), 15, 15 * 60_000) || !limiter('mcnx:' + email, 5, 15 * 60_000))
    return c.json({ erreur: 'Trop d\'essais. Réessayez dans 15 minutes.' }, 429);
  const [m] = await sql`select id, mot_de_passe, actif from membres where lower(email) = ${email}`;
  if (!(await verifier(String(d?.mot_de_passe || '').slice(0, 200), m?.actif ? m.mot_de_passe : null)))
    return c.json({ erreur: 'E-mail ou mot de passe incorrect.' }, 401);
  await ouvrirSession(c, m.id);
  return c.json({ ok: true });
});

// mot de passe oublié : lien par e-mail (valable 1 heure, usage unique) ; même réponse que le compte existe ou non
membres.post('/oubli', async c => {
  if (!origineOk(c)) return c.json({ erreur: 'Origine refusée.' }, 403);
  if (!limiter('oubli:' + adresseIp(c), 5, 60 * 60_000)) return c.json({ erreur: 'Trop de demandes.' }, 429);
  const d = await corps(c);
  const email = texte(d?.email, 160).toLowerCase();
  const [m] = await sql`select id, nom from membres where lower(email) = ${email} and actif`;
  if (m) {
    const jeton = nouveauJeton();
    await sql`insert into jetons_membres (empreinte, membre_id, expire_le) values (${empreinteJeton(jeton)}, ${m.id}, now() + interval '1 hour')`;
    await envoyer({ a: email, sujet: 'Choisir un nouveau mot de passe — ZTi',
      texte: `Bonjour ${m.nom},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable une heure) :\n${config.adresse}/espace/#/nouveau/${jeton}\n\nSi vous n'avez rien demandé, ignorez cet e-mail.\n\nL'équipe ZTi` });
  }
  return c.json({ ok: true, message: 'Si un compte existe avec cet e-mail, un lien vient de lui être envoyé.' });
});

membres.post('/nouveau-mot-de-passe', async c => {
  if (!origineOk(c)) return c.json({ erreur: 'Origine refusée.' }, 403);
  if (!limiter('nmdp:' + adresseIp(c), 10, 60 * 60_000)) return c.json({ erreur: 'Trop d\'essais.' }, 429);
  const d = await corps(c);
  if (!regleMotDePasse(d?.mot_de_passe)) return c.json({ erreur: 'Le mot de passe doit faire au moins 10 caractères.' }, 400);
  const empreinte = empreinteJeton(String(d?.jeton || ''));
  const id = await sql.begin(async t => {
    const [j] = await t`update jetons_membres set utilise = true where empreinte = ${empreinte} and not utilise and expire_le > now() returning membre_id`;
    if (!j) return null;
    await t`update membres set mot_de_passe = ${await hacher(d.mot_de_passe)} where id = ${j.membre_id}`;
    await t`delete from sessions_membres where membre_id = ${j.membre_id}`;
    return j.membre_id;
  });
  if (!id) return c.json({ erreur: 'Ce lien n\'est plus valable. Demandez-en un nouveau.' }, 400);
  await ouvrirSession(c, id);
  return c.json({ ok: true });
});

// ——— session obligatoire pour la suite ———
membres.use('*', async (c, next) => {
  if (['/inscription', '/connexion', '/oubli', '/nouveau-mot-de-passe'].some(p => c.req.path.endsWith(p))) return next();
  if (!origineOk(c)) return c.json({ erreur: 'Origine refusée.' }, 403);
  const jeton = getCookie(c, COOKIE);
  const [m] = jeton ? await sql`
    select m.id, m.nom, m.email, m.tel, m.code from sessions_membres s join membres m on m.id = s.membre_id
    where s.empreinte = ${empreinteJeton(jeton)} and s.expire_le > now() and m.actif` : [];
  if (!m) { deleteCookie(c, COOKIE, { path: '/', secure: config.production }); return c.json({ erreur: 'Connexion nécessaire.' }, 401); }
  c.set('membre', m); c.set('jeton', jeton);
  return next();
});

membres.post('/deconnexion', async c => {
  await sql`delete from sessions_membres where empreinte = ${empreinteJeton(c.get('jeton'))}`;
  deleteCookie(c, COOKIE, { path: '/', secure: config.production });
  return c.json({ ok: true });
});

// tableau de l'ambassadeur : solde, lien, filleuls (prénom + initiale seulement), historique, récompenses
membres.get('/moi', async c => {
  const m = c.get('membre');
  const [{ solde }] = await sql`select coalesce(sum(points), 0)::int as solde from points where membre_id = ${m.id}`;
  const historique = await sql`select points, motif, detail, cree_le from points where membre_id = ${m.id} order by cree_le desc limit 50`;
  const filleuls = await sql`
    select split_part(nom, ' ', 1) || coalesce(' ' || left(nullif(split_part(nom, ' ', 2), ''), 1) || '.', '') as nom,
      case when etat = 'client' then 'Client' when etat in ('rappelee', 'rendez_vous', 'devis') then 'En cours' when etat = 'sans_suite' then 'Sans suite' else 'Reçue' end as etat,
      cree_le
    from demandes where parrain_id = ${m.id} order by cree_le desc limit 50`;
  const [{ inscrits }] = await sql`select count(*)::int as inscrits from membres where parrain_id = ${m.id}`;
  const echanges = await sql`select recompense, points, statut, cree_le from echanges where membre_id = ${m.id} order by cree_le desc limit 20`;
  const fid = (await reglage('fidelite')) || {};
  return c.json({
    membre: { nom: m.nom, email: m.email, tel: m.tel, code: m.code },
    lien: `${config.sitePublic}/?ref=${encodeURIComponent(m.code)}`,
    solde, historique, filleuls, inscrits, echanges,
    regles: { recommandation: fid.points_recommandation || 0, client: fid.points_client || 0, actif: fid.actif !== false },
    recompenses: (fid.recompenses || []).filter(r => r.nom && r.points > 0),
  });
});

// demander une récompense : points retirés tout de suite (verrou sur le membre : pas de double dépense)
membres.post('/echanges', async c => {
  const m = c.get('membre');
  if (!limiter('ech:' + m.id, 10, 60 * 60_000)) return c.json({ erreur: 'Trop de demandes.' }, 429);
  const d = await corps(c);
  const fid = (await reglage('fidelite')) || {};
  if (fid.actif === false) return c.json({ erreur: 'Les échanges sont fermés pour le moment.' }, 400);
  const r = (fid.recompenses || []).find(x => x.nom === d?.recompense && x.points > 0);
  if (!r) return c.json({ erreur: 'Récompense inconnue.' }, 400);
  const res = await sql.begin(async t => {
    await t`select id from membres where id = ${m.id} for update`;
    const [{ solde }] = await t`select coalesce(sum(points), 0)::int as solde from points where membre_id = ${m.id}`;
    if (solde < r.points) return 'insuffisant';
    const [e] = await t`insert into echanges (membre_id, recompense, points) values (${m.id}, ${r.nom}, ${r.points}) returning id`;
    await t`insert into points (membre_id, points, motif, detail, echange_id) values (${m.id}, ${-r.points}, 'echange', ${r.nom}, ${e.id})`;
    return 'ok';
  });
  if (res === 'insuffisant') return c.json({ erreur: 'Pas assez de points pour cette récompense.' }, 400);
  const alertes = await reglage('alertes');
  envoyer({ a: alertes?.destinataires || [], sujet: `Échange de points — ${m.nom}`, texte: `${m.nom} (${m.tel}) demande : ${r.nom} (${r.points} points).\n\nÀ traiter : ${config.adresse}/admin/#/ambassadeurs` }).catch(() => {});
  return c.json({ ok: true }, 201);
});

membres.post('/mot-de-passe', async c => {
  const m = c.get('membre');
  if (!limiter('mmdp:' + m.id, 10, 15 * 60_000)) return c.json({ erreur: 'Trop d\'essais.' }, 429);
  const d = await corps(c);
  const [l] = await sql`select mot_de_passe from membres where id = ${m.id}`;
  if (!(await verifier(String(d?.actuel || ''), l.mot_de_passe))) return c.json({ erreur: 'Mot de passe actuel incorrect.' }, 400);
  if (!regleMotDePasse(d?.nouveau)) return c.json({ erreur: 'Le nouveau mot de passe doit faire au moins 10 caractères.' }, 400);
  await sql`update membres set mot_de_passe = ${await hacher(d.nouveau)} where id = ${m.id}`;
  await sql`delete from sessions_membres where membre_id = ${m.id} and empreinte <> ${empreinteJeton(c.get('jeton'))}`;
  return c.json({ ok: true });
});
