// Tableau de bord ZTi. Aucune bibliothèque, aucun script extérieur. Toutes les données affichées passent par
// textContent (jamais par innerHTML) : un texte saisi par un visiteur ne peut pas devenir du code.
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');

// ——— petites aides ———
function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat(Infinity)) if (e !== null && e !== undefined && e !== false) el.append(e instanceof Node ? e : String(e));
  return el;
}
const svg = (tag, attrs = {}) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const nombre = n => Number(n || 0).toLocaleString('fr-FR');
const fcfa = n => nombre(n) + ' F';
const date = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const dateHeure = d => d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const pourcent = (a, b) => b ? (100 * a / b).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '—';
const ETATS = [['nouvelle', 'Nouvelle'], ['rappelee', 'Rappelée'], ['rendez_vous', 'Rendez-vous'], ['devis', 'Devis'], ['client', 'Client'], ['sans_suite', 'Sans suite']];
const nomEtat = e => (ETATS.find(x => x[0] === e) || [e, e])[1];
const pastilleEtat = e => h('span', { class: 'etiquette e-' + e }, nomEtat(e));
const GENRES = [['note', 'Note'], ['appel', 'Appel'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['visite', 'Visite sur place'], ['etat', 'Changement d\'état']];
const nomGenre = g => (GENRES.find(x => x[0] === g) || [g, g])[1];

function toast(texte, mauvais = false) {
  const t = $('#toast'); t.textContent = texte; t.className = mauvais ? 'mauvais' : ''; t.hidden = false;
  clearTimeout(toast.minuteur); toast.minuteur = setTimeout(() => { t.hidden = true; }, 4000);
}

let moi = null;
async function api(chemin, { methode = 'GET', corps } = {}) {
  const r = await fetch('/v1/admin' + chemin, {
    method: methode, credentials: 'same-origin',
    headers: corps !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
  if (r.status === 401 && chemin !== '/connexion') { moi = null; afficherConnexion(); throw new Error('Session expirée.'); }
  const type = r.headers.get('content-type') || '';
  const donnees = type.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(donnees?.erreur || 'Erreur ' + r.status);
  return donnees;
}
const essayer = async (fn, bouton) => {
  if (bouton) bouton.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (bouton) bouton.disabled = false; }
};

// ——— connexion ———
function afficherConnexion() {
  const erreur = h('p', { class: 'erreur', hidden: true });
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const mdp = h('input', { type: 'password', name: 'mdp', autocomplete: 'current-password', required: true });
  const bouton = h('button', { class: 'btn', type: 'submit' }, 'Se connecter');
  app.replaceChildren(h('div', { class: 'connexion' }, h('form', { class: 'carte', onsubmit: async e => {
    e.preventDefault(); erreur.hidden = true; bouton.disabled = true;
    try { const r = await api('/connexion', { methode: 'POST', corps: { email: email.value, mot_de_passe: mdp.value } }); moi = r.membre; demarrer(); }
    catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
    finally { bouton.disabled = false; }
  } },
    h('img', { src: 'logo.png', alt: 'ZTi' }),
    h('h1', {}, 'Tableau de bord'),
    h('p', { class: 'muet' }, 'Réservé à l\'équipe ZTi.'),
    erreur, h('label', {}, 'E-mail', email), h('label', {}, 'Mot de passe', mdp), bouton)));
  app.classList.remove('chargement'); app.removeAttribute('aria-busy');
  email.focus();
}

// ——— mise en page ———
const MENU = [['#/', 'Tableau de bord'], ['#/demandes', 'Suivi des clients'], ['#/avis', 'Avis'], ['#/campagnes', 'Campagnes'], ['#/equipe', 'Équipe'], ['#/reglages', 'E-mails et réglages'], ['#/compte', 'Mon compte']];
let compteurs = {};
function cadre(contenu) {
  const route = location.hash.replace(/\/[0-9a-f-]{36}$/, '') || '#/';
  const lien = ([href, texte]) => {
    const n = href === '#/demandes' ? compteurs.a_traiter : href === '#/avis' ? compteurs.avis_en_attente : 0;
    return h('a', { href, 'aria-current': (route === href || (href === '#/' && route === '#')) ? 'page' : undefined }, texte, n ? h('span', { class: 'pastille' }, n) : null);
  };
  const menu = MENU.filter(([href]) => moi.role === 'admin' || !['#/equipe'].includes(href));
  app.replaceChildren(h('div', { class: 'cadre' },
    h('nav', { class: 'menu', 'aria-label': 'Menu' },
      h('div', { class: 'marque' }, h('img', { src: 'logo.png', alt: 'ZTi' }), 'Tableau de bord'),
      menu.map(lien),
      h('div', { class: 'bas' }, h('div', {}, h('b', {}, moi.nom), moi.role === 'admin' ? 'Administrateur' : 'Membre'),
        h('button', { type: 'button', onclick: async () => { await essayer(() => api('/deconnexion', { methode: 'POST' })); moi = null; afficherConnexion(); } }, 'Se déconnecter'))),
    h('main', { class: 'page', id: 'contenu' }, contenu)));
  app.classList.remove('chargement'); app.removeAttribute('aria-busy');
}
const entete = (titre, sousTitre, ...actions) => h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, titre), sousTitre ? h('p', {}, sousTitre) : null), h('div', { class: 'actions' }, actions));

// ——— routeur ———
const ROUTES = {
  '#/': vueTableau, '#/demandes': vueDemandes, '#/demande': vueFiche, '#/avis': vueAvis, '#/campagnes': vueCampagnes,
  '#/equipe': vueEquipe, '#/reglages': vueReglages, '#/compte': vueCompte,
};
async function router() {
  if (!moi) return afficherConnexion();
  if (moi.doit_changer) return vueCompte(true);
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/demandes\/([0-9a-f-]{36})$/);
  try {
    if (m) return await vueFiche(m[1]);
    await (ROUTES[hash] || vueTableau)();
  } catch (e) { if (moi) cadre(h('p', { class: 'erreur' }, e.message)); }
}
window.addEventListener('hashchange', router);

async function demarrer() {
  try { moi = await api('/moi'); } catch { moi = null; }
  router();
}
demarrer();

// ——— TABLEAU DE BORD ———
let periode = 30;
async function vueTableau() {
  const t = await api('/tableau?jours=' + periode);
  compteurs = t.chiffres;
  const c = t.chiffres;
  const choixPeriode = h('div', { class: 'onglets', role: 'group', 'aria-label': 'Période' },
    [[7, '7 jours'], [30, '30 jours'], [90, '3 mois'], [365, '1 an']].map(([j, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(j === periode), onclick: () => { periode = j; vueTableau(); } }, l)));
  const carteChiffre = (titre, valeur, detail, alerte) => h('div', { class: 'carte chiffre' + (alerte ? ' alerte' : '') }, h('small', {}, titre), h('b', {}, valeur), detail ? h('span', {}, detail) : null);
  const max = Math.max(1, c.visites);
  cadre([
    entete('Tableau de bord', 'Ce qui se passe sur le site et dans le suivi des clients.', choixPeriode),
    h('div', { class: 'grille g4' },
      carteChiffre('Visites', nombre(c.visites), nombre(c.pages_vues) + ' pages vues'),
      carteChiffre('Demandes reçues', nombre(c.demandes), 'Taux de demande : ' + pourcent(c.demandes, c.visites)),
      carteChiffre('Clients gagnés', nombre(c.clients), pourcent(c.clients, c.demandes) + ' des demandes'),
      carteChiffre('Chiffre signé', fcfa(c.chiffre), 'Montants des fiches « Client »')),
    h('div', { class: 'grille g4', style: 'margin-top:16px' },
      lienCarte('#/demandes', carteChiffre('À traiter', nombre(c.a_traiter), 'Demandes « Nouvelle »', c.a_traiter > 0)),
      lienCarte('#/demandes', carteChiffre('À relancer', nombre(c.a_relancer), 'Date de relance atteinte', c.a_relancer > 0)),
      lienCarte('#/avis', carteChiffre('Avis à valider', nombre(c.avis_en_attente), 'En attente de publication', c.avis_en_attente > 0)),
      carteChiffre('Clics WhatsApp et communauté', nombre(c.clics_contact), 'Boutons de contact du site')),
    h('div', { class: 'grille g2', style: 'margin-top:16px' },
      h('div', { class: 'carte graphique' }, h('h2', {}, 'Visites et demandes par jour'), graphique(t.parJour),
        h('div', { class: 'legende' }, h('span', {}, h('i', { style: 'background:#1565FF' }), 'Visites'), h('span', {}, h('i', { style: 'background:#12A15E' }), 'Demandes'))),
      h('div', { class: 'carte' }, h('h2', {}, 'Du visiteur au client'), h('p', { class: 'muet' }, 'Sur la période choisie.'),
        h('div', { class: 'entonnoir' }, [['Visites', c.visites], ['Formulaire commencé', c.etape2], ['Demandes', c.demandes], ['Clients', c.clients]].map(([l, n]) =>
          h('div', {}, h('span', {}, l), h('div', { class: 'barre' }, h('i', { style: `width:${Math.max(2, 100 * n / max)}%` })), h('b', {}, nombre(n))))))),
    h('div', { class: 'carte', style: 'margin-top:16px' }, h('h2', {}, 'Campagnes publicitaires'),
      t.campagnes.length ? tableauCampagnes(t.campagnes) : h('p', { class: 'vide' }, 'Aucune campagne sur la période. Créez-en une dans « Campagnes » pour obtenir des liens suivis.')),
    h('div', { class: 'grille g3', style: 'margin-top:16px' },
      h('div', { class: 'carte' }, h('h2', {}, 'Pages les plus vues'), barres(t.pages.map(p => [p.chemin, p.vues]))),
      h('div', { class: 'carte' }, h('h2', {}, 'D\'où viennent les visiteurs'), barres(t.sources.map(s => [s.source, s.visites]))),
      h('div', { class: 'carte' }, h('h2', {}, 'Appareils et pays'), barres([...t.appareils.map(a => [a.appareil, a.visites]), ...t.pays.map(p => ['Pays : ' + p.pays, p.visites])]))),
    h('div', { class: 'grille g2', style: 'margin-top:16px' },
      h('div', { class: 'carte' }, h('h2', {}, 'À relancer'), t.relances.length ? h('table', {}, h('tbody', {}, t.relances.map(d =>
        h('tr', { class: 'clic', onclick: () => { location.hash = '#/demandes/' + d.id; } }, h('td', {}, h('b', {}, d.nom), h('div', { class: 'muet' }, d.organisation)), h('td', {}, pastilleEtat(d.etat)), h('td', { class: 'n' }, date(d.relance_le))))))
        : h('p', { class: 'vide' }, 'Aucune relance en retard.')),
      h('div', { class: 'carte' }, h('h2', {}, 'Dernières demandes'), t.recentes.length ? h('table', {}, h('tbody', {}, t.recentes.map(d =>
        h('tr', { class: 'clic', onclick: () => { location.hash = '#/demandes/' + d.id; } }, h('td', {}, h('b', {}, d.nom), h('div', { class: 'muet' }, d.organisation || d.sujet)), h('td', {}, pastilleEtat(d.etat)), h('td', { class: 'n muet' }, dateHeure(d.cree_le))))))
        : h('p', { class: 'vide' }, 'Pas encore de demande.'))),
  ]);
}
const lienCarte = (href, carte) => h('a', { href, style: 'text-decoration:none' }, carte);
function barres(lignes) {
  if (!lignes.length) return h('p', { class: 'vide' }, 'Pas encore de données.');
  const max = Math.max(...lignes.map(l => l[1]), 1);
  return h('div', { class: 'liste-barres', style: 'margin-top:12px' }, lignes.map(([l, n]) =>
    h('div', {}, h('div', { class: 'l' }, h('span', { title: l }, l), h('b', {}, nombre(n))), h('div', { class: 'barre' }, h('i', { style: `width:${100 * n / max}%` })))));
}
function graphique(jours) {
  const L = 640, H = 220, m = 28;
  const maxV = Math.max(1, ...jours.map(j => j.visites)), maxD = Math.max(1, ...jours.map(j => j.demandes));
  const x = i => m + (L - 2 * m) * (jours.length < 2 ? .5 : i / (jours.length - 1));
  const s = svg('svg', { viewBox: `0 0 ${L} ${H}`, role: 'img', 'aria-label': 'Visites et demandes par jour' });
  for (let k = 0; k <= 4; k++) { const y = m + (H - 2 * m) * k / 4; s.append(svg('line', { x1: m, x2: L - m, y1: y, y2: y, stroke: '#E1E6F3' })); }
  const larg = Math.max(2, (L - 2 * m) / jours.length * .5);
  jours.forEach((j, i) => { if (!j.demandes) return; const hd = (H - 2 * m) * .45 * j.demandes / maxD;
    s.append(svg('rect', { x: x(i) - larg / 2, y: H - m - hd, width: larg, height: hd, rx: 2, fill: '#12A15E', opacity: .85 })); });
  const pts = jours.map((j, i) => `${x(i)},${H - m - (H - 2 * m) * j.visites / maxV}`).join(' ');
  s.append(svg('polyline', { points: pts, fill: 'none', stroke: '#1565FF', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const t1 = svg('text', { x: m, y: 16, 'font-size': 11, fill: '#7C86A8' }); t1.textContent = 'max ' + maxV + ' visites / jour'; s.append(t1);
  [0, jours.length - 1].forEach(i => { if (!jours[i]) return; const t = svg('text', { x: x(i), y: H - 8, 'font-size': 11, fill: '#7C86A8', 'text-anchor': i ? 'end' : 'start' }); t.textContent = date(jours[i].jour); s.append(t); });
  return s;
}
function tableauCampagnes(liste) {
  return h('div', { class: 'defile-x' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Campagne', 'Source', 'Visites', 'Demandes', 'Taux', 'Clients', 'Chiffre', 'Coût / demande'].map((t, i) => h('th', { class: i > 1 ? 'n' : '' }, t)))),
    h('tbody', {}, liste.map(k => h('tr', {},
      h('td', {}, h('b', {}, k.nom || k.code), k.nom ? h('div', { class: 'muet' }, k.code) : null), h('td', {}, k.source || '—'),
      h('td', { class: 'n' }, nombre(k.visites)), h('td', { class: 'n' }, nombre(k.demandes)), h('td', { class: 'n' }, pourcent(k.demandes, k.visites)),
      h('td', { class: 'n' }, nombre(k.clients)), h('td', { class: 'n' }, fcfa(k.chiffre)),
      h('td', { class: 'n' }, k.budget && k.demandes ? fcfa(Math.round(k.budget / k.demandes)) : '—'))))));
}

// ——— SUIVI DES CLIENTS ———
let vueListe = false, filtres = { etat: '', q: '', campagne: '' };
async function vueDemandes() {
  const params = new URLSearchParams(Object.entries(filtres).filter(([, v]) => v));
  const liste = await api('/demandes?' + params);
  const recherche = h('input', { type: 'search', placeholder: 'Nom, entreprise, téléphone, e-mail…', value: filtres.q, style: 'width:280px',
    onchange: e => { filtres.q = e.target.value.trim(); vueDemandes(); } });
  const choixEtat = h('select', { style: 'width:180px', onchange: e => { filtres.etat = e.target.value; vueDemandes(); } },
    h('option', { value: '' }, 'Tous les états'), ETATS.map(([v, l]) => h('option', { value: v, selected: filtres.etat === v || undefined }, l)));
  const bascule = h('div', { class: 'onglets' },
    h('button', { type: 'button', 'aria-pressed': String(!vueListe), onclick: () => { vueListe = false; vueDemandes(); } }, 'Colonnes'),
    h('button', { type: 'button', 'aria-pressed': String(vueListe), onclick: () => { vueListe = true; vueDemandes(); } }, 'Liste'));
  const exporter = moi.role === 'admin' ? h('a', { class: 'btn second', href: '/v1/admin/export/demandes.csv' }, 'Exporter (tableur)') : null;
  cadre([
    entete('Suivi des clients', 'Chaque demande du site devient une fiche. Faites-la avancer jusqu\'à « Client ».', bascule, exporter),
    h('div', { class: 'actions', style: 'margin-bottom:16px' }, recherche, choixEtat,
      filtres.campagne ? h('button', { class: 'btn second petit', onclick: () => { filtres.campagne = ''; vueDemandes(); } }, 'Campagne : ' + filtres.campagne + ' ✕') : null),
    !liste.length ? h('div', { class: 'carte vide' }, 'Aucune demande pour l\'instant.') : vueListe ? listeDemandes(liste) : colonnesDemandes(liste),
  ]);
}
const ouvrir = id => { location.hash = '#/demandes/' + id; };
function listeDemandes(liste) {
  return h('div', { class: 'carte defile-x' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Reçue', 'Contact', 'Organisation', 'Demande', 'Provenance', 'État', 'Relance'].map(t => h('th', {}, t)))),
    h('tbody', {}, liste.map(d => h('tr', { class: 'clic', onclick: () => ouvrir(d.id) },
      h('td', { class: 'muet' }, dateHeure(d.cree_le)), h('td', {}, h('b', {}, d.nom), h('div', { class: 'muet' }, d.tel)),
      h('td', {}, d.organisation || '—', h('div', { class: 'muet' }, d.profil)), h('td', {}, d.sujet, d.postes ? h('div', { class: 'muet' }, d.postes) : null),
      h('td', { class: 'muet' }, d.utm_campaign || d.utm_source || 'Site'), h('td', {}, pastilleEtat(d.etat)),
      h('td', { class: d.relance_le && d.relance_le <= new Date().toISOString().slice(0, 10) ? 'muet' : 'muet' }, d.relance_le ? date(d.relance_le) : ''))))));
}
function colonnesDemandes(liste) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  return h('div', { class: 'colonnes' }, ETATS.map(([etat, libelle]) => {
    const fiches = liste.filter(d => d.etat === etat);
    const col = h('section', { class: 'colonne', 'aria-label': libelle,
      ondragover: e => { e.preventDefault(); col.classList.add('survol'); }, ondragleave: () => col.classList.remove('survol'),
      ondrop: async e => { e.preventDefault(); col.classList.remove('survol'); const id = e.dataTransfer.getData('text/plain');
        if (!/^[0-9a-f-]{36}$/.test(id)) return;
        await essayer(async () => { await api('/demandes/' + id, { methode: 'PATCH', corps: { etat } }); toast('Fiche déplacée : ' + libelle); vueDemandes(); }); } },
      h('h3', {}, h('span', {}, libelle), h('span', { class: 'muet' }, fiches.length)),
      fiches.map(d => h('article', { class: 'fiche-mini', draggable: 'true', tabindex: 0,
        ondragstart: e => e.dataTransfer.setData('text/plain', d.id), onclick: () => ouvrir(d.id), onkeydown: e => { if (e.key === 'Enter') ouvrir(d.id); } },
        h('b', {}, d.nom), h('span', {}, d.organisation || d.profil || ''), h('span', { class: 'muet' }, d.sujet),
        d.relance_le ? h('span', { class: d.relance_le <= aujourdhui ? 'relance' : 'muet' }, 'Relance : ' + date(d.relance_le)) : null,
        d.montant ? h('span', { class: 'muet' }, fcfa(d.montant)) : null)));
    return col;
  }));
}

async function vueFiche(id) {
  const [{ fiche: f, notes }, equipe] = await Promise.all([api('/demandes/' + id), api('/equipe')]);
  const chiffres = (f.tel || '').replace(/\D/g, '');
  const ligne = (t, v) => v && (Array.isArray(v) ? v.length : true) ? [h('dt', {}, t), h('dd', {}, Array.isArray(v) ? v.join(', ') : v)] : null;
  const etat = h('select', {}, ETATS.map(([v, l]) => h('option', { value: v, selected: f.etat === v || undefined }, l)));
  const relance = h('input', { type: 'date', value: f.relance_le || '' });
  const montant = h('input', { type: 'number', min: 0, step: 1000, value: f.montant ?? '', placeholder: 'F CFA' });
  const responsable = h('select', {}, h('option', { value: '' }, 'Personne'), equipe.filter(m => m.actif !== false).map(m => h('option', { value: m.id, selected: f.responsable_id === m.id || undefined }, m.nom)));
  const enregistrer = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    await api('/demandes/' + id, { methode: 'PATCH', corps: { etat: etat.value, relance_le: relance.value || null, montant: montant.value === '' ? null : Number(montant.value), responsable_id: responsable.value || null } });
    toast('Fiche enregistrée.'); vueFiche(id);
  }, e.currentTarget) }, 'Enregistrer');
  const genre = h('select', {}, GENRES.filter(g => g[0] !== 'etat' && g[0] !== 'email').map(([v, l]) => h('option', { value: v }, l)));
  const note = h('textarea', { placeholder: 'Ce qui s\'est dit, la prochaine étape…', style: 'min-height:80px' });
  const ajouterNote = h('button', { class: 'btn second', type: 'button', onclick: e => essayer(async () => {
    if (!note.value.trim()) return toast('La note est vide.', true);
    await api('/demandes/' + id + '/notes', { methode: 'POST', corps: { genre: genre.value, texte: note.value } }); toast('Note ajoutée.'); vueFiche(id);
  }, e.currentTarget) }, 'Ajouter au suivi');
  const sujetMail = h('input', { value: 'Votre demande auprès de ZTi' });
  const texteMail = h('textarea', { value: `Bonjour ${f.nom},\n\n` });
  const envoyerMail = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    await api('/demandes/' + id + '/email', { methode: 'POST', corps: { sujet: sujetMail.value, texte: texteMail.value } }); toast('E-mail envoyé.'); vueFiche(id);
  }, e.currentTarget) }, 'Envoyer l\'e-mail');
  const supprimer = moi.role === 'admin' ? h('button', { class: 'btn danger petit', type: 'button', onclick: e => essayer(async () => {
    if (!confirm('Supprimer définitivement cette fiche et son historique ? (à faire seulement si la personne le demande)')) return;
    await api('/demandes/' + id, { methode: 'DELETE' }); toast('Fiche supprimée.'); location.hash = '#/demandes';
  }, e.currentTarget) }, 'Supprimer la fiche') : null;
  cadre([
    entete(f.nom, (f.organisation ? f.organisation + ' · ' : '') + 'reçue le ' + dateHeure(f.cree_le),
      h('a', { class: 'btn second', href: '#/demandes' }, '← Retour'),
      chiffres ? h('a', { class: 'btn second', href: 'tel:+' + (chiffres.startsWith('237') ? chiffres : '237' + chiffres) }, 'Appeler') : null,
      chiffres ? h('a', { class: 'btn', href: 'https://wa.me/' + (chiffres.startsWith('237') ? chiffres : '237' + chiffres), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null),
    h('div', { class: 'fiche' },
      h('div', { class: 'grille' },
        h('div', { class: 'carte' }, h('h2', {}, 'Contact'), h('dl', {}, ligne('Nom', f.nom), ligne('Fonction', f.fonction), ligne('Téléphone', f.tel), ligne('E-mail', f.email),
          ligne('Profil', f.profil), ligne('Organisation', f.organisation), ligne(f.profil === 'Établissement scolaire' ? 'Type' : 'Secteur', f.secteur), ligne('Lieu', f.lieu), ligne('À rappeler', f.moment))),
        h('div', { class: 'carte' }, h('h2', {}, 'Sa demande'), h('dl', {}, ligne('Sujet', f.sujet), ligne(f.profil === 'Particulier' ? 'Appareil' : 'Ordinateurs', f.postes),
          ligne('Situation', f.situation), ligne(f.profil === 'Particulier' ? 'Problème' : 'Besoins', f.besoins), ligne('Accompagnement', f.accompagnement),
          ligne('Prestataire actuel', f.prestataire), ligne('Dépenses actuelles', f.depenses), ligne('Message', f.message), ligne('A connu ZTi par', f.connu))),
        h('div', { class: 'carte' }, h('h2', {}, 'Provenance'), h('dl', {}, ligne('Page', f.page), ligne('Campagne', f.utm_campaign), ligne('Source', f.utm_source),
          ligne('Support', f.utm_medium), ligne('Annonce', f.utm_content), ligne('Venu de', f.referent))),
        f.email ? h('div', { class: 'carte formulaire' }, h('h2', {}, 'Écrire un e-mail'), h('p', { class: 'muet' }, 'Part à ' + f.email + ', avec la signature ZTi. Gardé dans l\'historique.'),
          h('label', {}, 'Sujet', sujetMail), h('label', {}, 'Message', texteMail), h('div', { class: 'actions' }, envoyerMail)) : null),
      h('div', { class: 'grille' },
        h('div', { class: 'carte formulaire' }, h('h2', {}, 'Suivi'), h('label', {}, 'État', etat), h('label', {}, 'Relancer le', relance),
          h('label', {}, 'Responsable', responsable), h('label', {}, 'Montant du devis ou du contrat (F CFA)', montant), h('div', { class: 'actions' }, enregistrer, supprimer)),
        h('div', { class: 'carte formulaire' }, h('h2', {}, 'Historique'), h('label', {}, 'Type', genre), note, h('div', { class: 'actions' }, ajouterNote),
          notes.length ? h('div', { class: 'historique' }, notes.map(n => h('div', { class: 'g-' + n.genre },
            h('small', {}, nomGenre(n.genre) + ' · ' + dateHeure(n.cree_le) + (n.auteur ? ' · ' + n.auteur : '')),
            h('p', {}, n.genre === 'etat' ? n.texte.split(' → ').map(nomEtat).join(' → ') : n.texte)))) : h('p', { class: 'muet' }, 'Aucune note pour l\'instant.')))),
  ]);
}

// ——— AVIS ———
let statutAvis = 'en_attente';
async function vueAvis() {
  const liste = await api('/avis?statut=' + statutAvis);
  const onglets = h('div', { class: 'onglets' }, [['en_attente', 'À valider'], ['publie', 'Publiés'], ['refuse', 'Refusés']].map(([v, l]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === statutAvis), onclick: () => { statutAvis = v; vueAvis(); } }, l)));
  const action = (id, statut, texte, classe = 'btn second petit') => h('button', { class: classe, type: 'button', onclick: e => essayer(async () => {
    await api('/avis/' + id, { methode: 'PATCH', corps: { statut } }); toast(statut === 'publie' ? 'Avis publié sur le site.' : 'Avis mis de côté.'); vueAvis();
  }, e.currentTarget) }, texte);
  cadre([
    entete('Avis des clients', 'Rien ne s\'affiche sur le site sans votre validation.', onglets),
    liste.length ? h('div', { class: 'grille g3' }, liste.map(a => h('div', { class: 'carte', style: 'display:grid;gap:10px' },
      h('span', { class: 'etoiles', 'aria-label': a.note + ' sur 5' }, '★'.repeat(a.note) + '☆'.repeat(5 - a.note)),
      h('p', { style: 'margin:0;white-space:pre-wrap' }, a.texte),
      h('div', {}, h('b', {}, a.nom), a.organisation ? h('div', { class: 'muet' }, a.organisation) : null, h('div', { class: 'muet' }, dateHeure(a.cree_le) + (a.tel ? ' · ' + a.tel : ''))),
      h('div', { class: 'actions' },
        a.statut !== 'publie' ? action(a.id, 'publie', 'Publier', 'btn petit') : null,
        a.statut !== 'refuse' ? action(a.id, 'refuse', a.statut === 'publie' ? 'Retirer du site' : 'Refuser') : null,
        a.statut === 'refuse' ? action(a.id, 'en_attente', 'Remettre à valider') : null,
        moi.role === 'admin' ? h('button', { class: 'btn danger petit', type: 'button', onclick: e => essayer(async () => {
          if (!confirm('Supprimer définitivement cet avis ?')) return; await api('/avis/' + a.id, { methode: 'DELETE' }); toast('Avis supprimé.'); vueAvis();
        }, e.currentTarget) }, 'Supprimer') : null))))
      : h('div', { class: 'carte vide' }, statutAvis === 'en_attente' ? 'Aucun avis à valider.' : 'Aucun avis ici.'),
  ]);
}

// ——— CAMPAGNES ———
const PAGES = [['/', 'Accueil'], ['/offres/diagnostic-ecoles/', 'Écoles'], ['/offres/audit-pme/', 'Entreprises'], ['/offres/particuliers/', 'Particuliers'], ['/contact/', 'Contact']];
const SOURCES = ['facebook', 'instagram', 'linkedin', 'whatsapp', 'tiktok', 'google', 'youtube', 'affiche', 'autre'];
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
async function vueCampagnes(edition = null) {
  const [{ campagnes, stats }, reg] = await Promise.all([api('/campagnes?jours=365'), api('/reglages')]);
  const lienSuivi = k => `${reg.site}${k.page}?utm_source=${encodeURIComponent(k.source)}&utm_medium=${encodeURIComponent(k.support)}&utm_campaign=${encodeURIComponent(k.code)}`;
  const k = edition || { nom: '', code: '', source: 'facebook', support: 'paid', page: '/offres/diagnostic-ecoles/', budget: '', debut: '', fin: '', notes: '' };
  const champs = {
    nom: h('input', { value: k.nom, placeholder: 'Ex. Écoles — rentrée novembre', oninput: e => { if (!edition) champs.code.value = slug(e.target.value); maj(); } }),
    code: h('input', { value: k.code, oninput: () => maj() }),
    source: h('select', { onchange: () => maj() }, SOURCES.map(s => h('option', { value: s, selected: k.source === s || undefined }, s))),
    support: h('select', { onchange: () => maj() }, [['paid', 'Publicité payante'], ['social', 'Publication gratuite'], ['message', 'Message / groupe'], ['print', 'Imprimé (affiche, flyer)']].map(([v, l]) => h('option', { value: v, selected: k.support === v || undefined }, l))),
    page: h('select', { onchange: () => maj() }, PAGES.map(([v, l]) => h('option', { value: v, selected: k.page === v || undefined }, l + ' — ' + v))),
    budget: h('input', { type: 'number', min: 0, step: 1000, value: k.budget ?? '' }), debut: h('input', { type: 'date', value: k.debut || '' }),
    fin: h('input', { type: 'date', value: k.fin || '' }), notes: h('textarea', { value: k.notes || '', style: 'min-height:70px' }),
  };
  const apercu = h('div', { class: 'secret', style: 'font-size:13px;overflow-wrap:anywhere' });
  function maj() { apercu.textContent = lienSuivi({ code: champs.code.value || 'code', source: champs.source.value, support: champs.support.value, page: champs.page.value }); }
  maj();
  const valider = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    const corps = Object.fromEntries(Object.entries(champs).map(([c, el]) => [c, el.value]));
    await api(edition ? '/campagnes/' + edition.id : '/campagnes', { methode: edition ? 'PATCH' : 'POST', corps });
    toast(edition ? 'Campagne modifiée.' : 'Campagne créée : copiez son lien dans votre publicité.'); vueCampagnes();
  }, e.currentTarget) }, edition ? 'Enregistrer' : 'Créer la campagne');
  const statsDe = code => stats.find(s => s.code === code) || {};
  cadre([
    entete('Campagnes publicitaires', 'Chaque campagne a son lien : les visites, demandes et clients qu\'elle apporte sont comptés tout seuls.'),
    h('div', { class: 'grille g2' },
      h('div', { class: 'carte formulaire' }, h('h2', {}, edition ? 'Modifier la campagne' : 'Nouvelle campagne'),
        h('label', {}, 'Nom', champs.nom), h('label', {}, 'Code (dans le lien)', champs.code),
        h('div', { class: 'grille g2' }, h('label', {}, 'Réseau', champs.source), h('label', {}, 'Type', champs.support)),
        h('label', {}, 'Page d\'arrivée', champs.page),
        h('div', { class: 'grille g3' }, h('label', {}, 'Budget (F CFA)', champs.budget), h('label', {}, 'Début', champs.debut), h('label', {}, 'Fin', champs.fin)),
        h('label', {}, 'Notes', champs.notes), h('div', {}, h('p', { class: 'muet' }, 'Lien à mettre dans la publicité :'), apercu),
        h('div', { class: 'actions' }, valider, h('button', { class: 'btn second', type: 'button', onclick: () => navigator.clipboard.writeText(apercu.textContent).then(() => toast('Lien copié.')) }, 'Copier le lien'),
          edition ? h('button', { class: 'btn second', type: 'button', onclick: () => vueCampagnes() }, 'Annuler') : null)),
      h('div', { class: 'carte' }, h('h2', {}, 'Résultats sur 12 mois'), stats.length ? tableauCampagnes(stats) : h('p', { class: 'vide' }, 'Les résultats apparaîtront dès les premières visites venues d\'un lien de campagne.'))),
    campagnes.length ? h('div', { class: 'carte', style: 'margin-top:16px' }, h('h2', {}, 'Toutes les campagnes'), h('div', { class: 'defile-x' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Campagne', 'Réseau', 'Page', 'Dates', 'Demandes', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, campagnes.map(c => h('tr', {},
        h('td', {}, h('b', {}, c.nom), h('div', { class: 'muet' }, c.code)), h('td', {}, c.source), h('td', { class: 'muet' }, c.page),
        h('td', { class: 'muet' }, [c.debut && date(c.debut), c.fin && date(c.fin)].filter(Boolean).join(' → ')),
        h('td', {}, h('a', { href: '#/demandes', onclick: () => { filtres = { etat: '', q: '', campagne: c.code }; } }, nombre(statsDe(c.code).demandes))),
        h('td', {}, h('div', { class: 'actions' },
          h('button', { class: 'btn second petit', type: 'button', onclick: () => navigator.clipboard.writeText(lienSuivi(c)).then(() => toast('Lien copié.')) }, 'Copier le lien'),
          h('button', { class: 'btn second petit', type: 'button', onclick: () => { vueCampagnes(c); scrollTo(0, 0); } }, 'Modifier'),
          moi.role === 'admin' ? h('button', { class: 'btn danger petit', type: 'button', onclick: e => essayer(async () => {
            if (!confirm('Supprimer cette campagne ? (les visites et demandes restent)')) return; await api('/campagnes/' + c.id, { methode: 'DELETE' }); vueCampagnes();
          }, e.currentTarget) }, 'Supprimer') : null)))))))) : null,
  ]);
}

// ——— ÉQUIPE ———
async function vueEquipe() {
  if (moi.role !== 'admin') return cadre(h('p', { class: 'erreur' }, 'Réservé aux administrateurs.'));
  const liste = await api('/equipe');
  const zone = h('div');
  const montrerMdp = (qui, mdp) => zone.replaceChildren(h('div', { class: 'carte', style: 'margin-bottom:16px;display:grid;gap:10px' },
    h('h2', {}, 'Mot de passe provisoire de ' + qui), h('p', { class: 'muet' }, 'Transmettez-le en main propre ou par WhatsApp. Il ne sera plus affiché ; la personne devra le changer à sa première connexion.'),
    h('div', { class: 'secret' }, mdp)));
  const nom = h('input', { placeholder: 'Nom et prénom' }), email = h('input', { type: 'email', placeholder: 'adresse@exemple.com' });
  const role = h('select', {}, h('option', { value: 'membre' }, 'Membre (suivi des clients, avis, campagnes)'), h('option', { value: 'admin' }, 'Administrateur (tout, dont l\'équipe et les réglages)'));
  const ajouter = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    const r = await api('/equipe', { methode: 'POST', corps: { nom: nom.value, email: email.value, role: role.value } });
    await vueEquipe(); montrerMdp(nom.value, r.mot_de_passe_provisoire);
  }, e.currentTarget) }, 'Ajouter');
  cadre([
    entete('Équipe', 'Les personnes qui ont accès au tableau de bord.'), zone,
    h('div', { class: 'grille g2' },
      h('div', { class: 'carte defile-x' }, h('table', {}, h('thead', {}, h('tr', {}, ['Personne', 'Rôle', 'Dernière connexion', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, liste.map(m => h('tr', {},
          h('td', {}, h('b', {}, m.nom), h('div', { class: 'muet' }, m.email), !m.actif ? h('span', { class: 'etiquette e-sans_suite' }, 'Désactivé') : null),
          h('td', {}, m.role === 'admin' ? 'Administrateur' : 'Membre'), h('td', { class: 'muet' }, m.derniere_connexion ? dateHeure(m.derniere_connexion) : 'Jamais'),
          h('td', {}, m.id === moi.id ? h('span', { class: 'muet' }, 'Vous') : h('div', { class: 'actions' },
            h('button', { class: 'btn second petit', type: 'button', onclick: e => essayer(async () => { await api('/equipe/' + m.id, { methode: 'PATCH', corps: { actif: !m.actif } }); vueEquipe(); }, e.currentTarget) }, m.actif ? 'Désactiver' : 'Réactiver'),
            h('button', { class: 'btn second petit', type: 'button', onclick: e => essayer(async () => { await api('/equipe/' + m.id, { methode: 'PATCH', corps: { role: m.role === 'admin' ? 'membre' : 'admin' } }); vueEquipe(); }, e.currentTarget) }, m.role === 'admin' ? 'Passer membre' : 'Passer admin'),
            h('button', { class: 'btn second petit', type: 'button', onclick: e => essayer(async () => {
              if (!confirm('Créer un nouveau mot de passe provisoire pour ' + m.nom + ' ?')) return;
              const r = await api('/equipe/' + m.id + '/reinitialiser', { methode: 'POST' }); montrerMdp(m.nom, r.mot_de_passe_provisoire);
            }, e.currentTarget) }, 'Nouveau mot de passe')))))))),
      h('div', { class: 'carte formulaire' }, h('h2', {}, 'Ajouter une personne'), h('label', {}, 'Nom', nom), h('label', {}, 'E-mail', email), h('label', {}, 'Rôle', role), h('div', { class: 'actions' }, ajouter))),
  ]);
}

// ——— E-MAILS ET RÉGLAGES ———
async function vueReglages() {
  const r = await api('/reglages');
  const admin = moi.role === 'admin';
  const dest = h('input', { value: (r.alertes?.destinataires || []).join(', '), disabled: !admin || undefined });
  const alDem = h('input', { type: 'checkbox', checked: r.alertes?.demandes !== false, disabled: !admin || undefined });
  const alAvis = h('input', { type: 'checkbox', checked: r.alertes?.avis !== false, disabled: !admin || undefined });
  const accActif = h('input', { type: 'checkbox', checked: r.accuse_demande?.actif !== false, disabled: !admin || undefined });
  const accSujet = h('input', { value: r.accuse_demande?.sujet || '', disabled: !admin || undefined });
  const accTexte = h('textarea', { value: r.accuse_demande?.texte || '', style: 'min-height:220px', disabled: !admin || undefined });
  const signature = h('textarea', { value: r.signature?.texte || '', style: 'min-height:70px', disabled: !admin || undefined });
  const enregistrer = admin ? h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    await api('/reglages', { methode: 'PUT', corps: {
      alertes: { destinataires: dest.value.split(',').map(s => s.trim()).filter(Boolean), demandes: alDem.checked, avis: alAvis.checked },
      accuse_demande: { actif: accActif.checked, sujet: accSujet.value, texte: accTexte.value }, signature: { texte: signature.value } } });
    toast('Réglages enregistrés.');
  }, e.currentTarget) }, 'Enregistrer') : null;
  const essai = h('button', { class: 'btn second', type: 'button', onclick: e => essayer(async () => { await api('/reglages/essai', { methode: 'POST' }); toast('E-mail d\'essai envoyé à ' + moi.email + '.'); }, e.currentTarget) }, 'M\'envoyer un e-mail d\'essai');
  cadre([
    entete('E-mails et réglages', admin ? null : 'Lecture seule : seuls les administrateurs peuvent modifier.'),
    h('div', { class: 'carte', style: 'margin-bottom:16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between' },
      h('div', {}, h('h2', {}, r.emails_actifs ? 'Envoi des e-mails : actif' : 'Envoi des e-mails : pas encore branché'),
        h('p', { class: 'muet', style: 'margin:4px 0 0' }, r.emails_actifs ? 'Expéditeur : ' + r.expediteur + ' (Brevo).' : 'Le compte Brevo n\'est pas encore relié : les demandes restent visibles ici, mais aucun e-mail ne part.')),
      r.emails_actifs ? essai : null),
    h('div', { class: 'grille g2' },
      h('div', { class: 'carte formulaire' }, h('h2', {}, 'Alertes à l\'équipe'), h('label', {}, 'Adresses qui reçoivent les alertes (séparées par des virgules)', dest),
        h('label', { class: 'case' }, alDem, 'Une alerte à chaque nouvelle demande'), h('label', { class: 'case' }, alAvis, 'Une alerte à chaque nouvel avis'),
        h('h2', { style: 'margin-top:10px' }, 'Signature des e-mails'), signature),
      h('div', { class: 'carte formulaire' }, h('h2', {}, 'Accusé de réception au client'),
        h('p', { class: 'muet', style: 'margin:0' }, 'Envoyé automatiquement quand la personne a donné son e-mail. Vous pouvez écrire {prenom}, {nom} ou {organisation}.'),
        h('label', { class: 'case' }, accActif, 'Envoyer l\'accusé de réception'), h('label', {}, 'Sujet', accSujet), h('label', {}, 'Texte', accTexte))),
    admin ? h('div', { class: 'actions', style: 'margin-top:16px' }, enregistrer) : null,
  ]);
}

// ——— MON COMPTE ———
function vueCompte(force = false) {
  const actuel = h('input', { type: 'password', autocomplete: 'current-password' });
  const nouveau = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 });
  const confirmation = h('input', { type: 'password', autocomplete: 'new-password' });
  const valider = h('button', { class: 'btn', type: 'submit' }, 'Changer le mot de passe');
  const formulaire = h('form', { class: 'carte formulaire', style: 'max-width:480px', onsubmit: e => { e.preventDefault(); essayer(async () => {
    if (nouveau.value !== confirmation.value) throw new Error('Les deux nouveaux mots de passe ne sont pas identiques.');
    await api('/mot-de-passe', { methode: 'POST', corps: { actuel: actuel.value, nouveau: nouveau.value } });
    moi.doit_changer = false; toast('Mot de passe changé.'); location.hash = '#/'; router();
  }, valider); } },
    h('h2', {}, force ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'),
    force ? h('p', { class: 'muet', style: 'margin:0' }, 'Vous utilisez un mot de passe provisoire. Choisissez le vôtre (10 caractères au moins) pour accéder au tableau de bord.') : null,
    h('label', {}, force ? 'Mot de passe provisoire' : 'Mot de passe actuel', actuel), h('label', {}, 'Nouveau mot de passe (10 caractères au moins)', nouveau),
    h('label', {}, 'Confirmez le nouveau mot de passe', confirmation), h('div', { class: 'actions' }, valider));
  cadre([entete('Mon compte', moi.nom + ' · ' + moi.email), formulaire]);
}
