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
    else if (k === 'style') el.style.cssText = v; // propriété CSSOM : permise par la politique de sécurité (pas d'attribut style)
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

// ——— composants maison (aucun contrôle natif du navigateur : règle du kit) ———
let ouvert = null; // menu ou calendrier ouvert
const fermerOuvert = () => { if (ouvert) { ouvert.fermer(); ouvert = null; } };
document.addEventListener('click', e => { if (ouvert && !ouvert.el.contains(e.target)) fermerOuvert(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ouvert) { const b = ouvert.bouton; fermerOuvert(); b?.focus(); } });
let idUnique = 0;

// menu déroulant : options = [[valeur, libellé], …] ; renvoie l'élément, avec .valeur
function menu(options, { valeur = options[0]?.[0] ?? '', libelle = 'Choisir', onchange, desactive = false } = {}) {
  const id = 'menu-' + (++idUnique);
  const texte = h('span', {});
  const bouton = h('button', { type: 'button', class: 'menu-maison-bouton', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': libelle, disabled: desactive || undefined },
    texte, h('span', { class: 'chevron', 'aria-hidden': 'true' }));
  const liste = h('ul', { class: 'menu-maison-liste', role: 'listbox', id, hidden: true, tabindex: -1 });
  const el = h('div', { class: 'menu-maison' }, bouton, liste);
  let courant = valeur, actif = 0;
  const choisir = (v, notifier = true) => {
    courant = v; texte.textContent = (options.find(o => o[0] === v) || options[0] || ['', ''])[1];
    [...liste.children].forEach(li => li.setAttribute('aria-selected', String(li.dataset.v === String(v))));
    if (notifier) onchange?.(v);
  };
  const marquer = i => { actif = (i + options.length) % options.length; [...liste.children].forEach((li, k) => li.classList.toggle('actif', k === actif)); liste.children[actif]?.scrollIntoView({ block: 'nearest' }); };
  options.forEach(([v, l], i) => liste.append(h('li', { role: 'option', 'data-v': String(v), onclick: () => { choisir(v); fermerOuvert(); bouton.focus(); }, onmousemove: () => marquer(i) }, l)));
  const fermer = () => { liste.hidden = true; bouton.setAttribute('aria-expanded', 'false'); };
  const ouvrir = () => { fermerOuvert(); liste.hidden = false; bouton.setAttribute('aria-expanded', 'true'); marquer(Math.max(0, options.findIndex(o => o[0] === courant))); liste.focus(); ouvert = { el, fermer, bouton }; };
  bouton.addEventListener('click', e => { e.stopPropagation(); liste.hidden ? ouvrir() : fermerOuvert(); });
  bouton.addEventListener('keydown', e => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); ouvrir(); } });
  let saisie = '', minuteur;
  liste.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); marquer(actif + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marquer(actif - 1); }
    else if (e.key === 'Home') { e.preventDefault(); marquer(0); } else if (e.key === 'End') { e.preventDefault(); marquer(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choisir(options[actif][0]); fermerOuvert(); bouton.focus(); }
    else if (e.key === 'Tab') fermerOuvert();
    else if (e.key.length === 1) { // aller à l'option qui commence par les lettres tapées
      saisie += e.key.toLowerCase(); clearTimeout(minuteur); minuteur = setTimeout(() => { saisie = ''; }, 600);
      const i = options.findIndex(o => String(o[1]).toLowerCase().startsWith(saisie)); if (i >= 0) marquer(i);
    }
  });
  choisir(valeur, false);
  Object.defineProperty(el, 'valeur', { get: () => courant });
  return el;
}

// calendrier en français ; valeur 'AAAA-MM-JJ' ou '' ; renvoie l'élément, avec .valeur
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function calendrier({ valeur = '', libelle = 'Choisir une date', vide = 'Aucune date', desactive = false } = {}) {
  let courant = valeur || '';
  const texte = h('span', {});
  const bouton = h('button', { type: 'button', class: 'menu-maison-bouton', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': libelle, disabled: desactive || undefined },
    texte, h('span', { class: 'icone-cal', 'aria-hidden': 'true' }));
  const panneau = h('div', { class: 'calendrier', role: 'dialog', 'aria-label': libelle, hidden: true });
  const el = h('div', { class: 'menu-maison' }, bouton, panneau);
  const afficherTexte = () => { texte.textContent = courant ? new Date(courant + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : vide; texte.classList.toggle('muet', !courant); };
  let vue = courant ? new Date(courant + 'T12:00') : new Date(), focus = new Date(vue);
  const dessiner = () => {
    const premier = new Date(vue.getFullYear(), vue.getMonth(), 1);
    const decalage = (premier.getDay() + 6) % 7; // lundi en premier
    const jours = new Date(vue.getFullYear(), vue.getMonth() + 1, 0).getDate();
    const auj = iso(new Date());
    const grille = h('div', { class: 'cal-grille', role: 'grid' },
      ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map(j => h('span', { class: 'cal-jour-nom', 'aria-hidden': 'true' }, j)),
      Array.from({ length: decalage }, () => h('span', {})),
      Array.from({ length: jours }, (_, i) => {
        const d = new Date(vue.getFullYear(), vue.getMonth(), i + 1), v = iso(d);
        return h('button', { type: 'button', class: 'cal-jour' + (v === courant ? ' choisi' : '') + (v === auj ? ' aujourdhui' : ''),
          tabindex: v === iso(focus) ? 0 : -1, 'data-v': v, 'aria-label': d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          'aria-pressed': String(v === courant), onclick: () => valider(v) }, i + 1);
      }));
    panneau.replaceChildren(
      h('div', { class: 'cal-tete' },
        h('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Mois précédent', onclick: () => { vue = new Date(vue.getFullYear(), vue.getMonth() - 1, 1); focus = new Date(vue); dessiner(); } }, '‹'),
        h('b', {}, MOIS[vue.getMonth()] + ' ' + vue.getFullYear()),
        h('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Mois suivant', onclick: () => { vue = new Date(vue.getFullYear(), vue.getMonth() + 1, 1); focus = new Date(vue); dessiner(); } }, '›')),
      grille,
      h('div', { class: 'cal-pied' },
        h('button', { type: 'button', class: 'btn second petit', onclick: () => valider(iso(new Date())) }, 'Aujourd\'hui'),
        h('button', { type: 'button', class: 'btn second petit', onclick: () => { const d = new Date(); d.setDate(d.getDate() + 7); valider(iso(d)); } }, 'Dans 7 jours'),
        h('button', { type: 'button', class: 'btn second petit', onclick: () => valider('') }, 'Effacer')));
  };
  const valider = v => { courant = v; afficherTexte(); fermerOuvert(); bouton.focus(); };
  const fermer = () => { panneau.hidden = true; bouton.setAttribute('aria-expanded', 'false'); };
  bouton.addEventListener('click', e => {
    e.stopPropagation(); if (!panneau.hidden) return fermerOuvert();
    fermerOuvert(); vue = courant ? new Date(courant + 'T12:00') : new Date(); focus = new Date(vue); dessiner();
    panneau.hidden = false; bouton.setAttribute('aria-expanded', 'true'); ouvert = { el, fermer, bouton };
    panneau.querySelector('.cal-jour[tabindex="0"]')?.focus();
  });
  panneau.addEventListener('keydown', e => {
    const pas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!pas || !e.target.classList.contains('cal-jour')) return;
    e.preventDefault(); focus = new Date(e.target.dataset.v + 'T12:00'); focus.setDate(focus.getDate() + pas);
    if (focus.getMonth() !== vue.getMonth()) vue = new Date(focus.getFullYear(), focus.getMonth(), 1);
    dessiner(); panneau.querySelector('.cal-jour[tabindex="0"]')?.focus();
  });
  afficherTexte();
  Object.defineProperty(el, 'valeur', { get: () => courant });
  return el;
}

// interrupteur (à la place d'une case à cocher)
function interrupteur(libelle, { coche = false, desactive = false } = {}) {
  const b = h('button', { type: 'button', role: 'switch', class: 'interrupteur', 'aria-checked': String(!!coche), disabled: desactive || undefined,
    onclick: () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')) }, h('span', { class: 'piste', 'aria-hidden': 'true' }, h('span', {})), libelle);
  Object.defineProperty(b, 'coche', { get: () => b.getAttribute('aria-checked') === 'true' });
  return b;
}

// libellé + commande maison (pas de <label> autour : il rouvrirait la liste à chaque clic)
const champ = (titre, commande) => h('div', { class: 'champ-groupe', role: 'group', 'aria-label': titre }, h('span', { class: 'champ-titre' }, titre), commande);

// champ de mot de passe avec l'œil
function champMotDePasse(attrs = {}) {
  const input = h('input', { type: 'password', ...attrs });
  const oeil = h('button', { type: 'button', class: 'oeil', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false', onclick: () => {
    const voir = input.type === 'password'; input.type = voir ? 'text' : 'password';
    oeil.setAttribute('aria-pressed', String(voir)); oeil.setAttribute('aria-label', voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  } });
  const el = h('div', { class: 'champ-mdp' }, input, oeil);
  Object.defineProperty(el, 'value', { get: () => input.value });
  el.focus = () => input.focus();
  return el;
}

// montant en F CFA (champ texte, chiffres seulement, espaces des milliers)
function champMontant(valeur, attrs = {}) {
  const input = h('input', { inputmode: 'numeric', autocomplete: 'off', placeholder: 'F CFA', ...attrs });
  const formater = () => { const n = input.value.replace(/\D/g, '').slice(0, 12); input.value = n ? Number(n).toLocaleString('fr-FR') : ''; };
  input.value = valeur == null || valeur === '' ? '' : String(valeur); formater();
  input.addEventListener('input', formater);
  Object.defineProperty(input, 'nombre', { get: () => { const n = input.value.replace(/\D/g, ''); return n ? Number(n) : null; } });
  return input;
}

// fenêtre de confirmation maison (à la place de confirm()) : renvoie true ou false
function confirmer({ titre, texte, bouton = 'Confirmer', danger = false }) {
  return new Promise(resolve => {
    const avant = document.activeElement;
    const fin = ok => { voile.remove(); document.removeEventListener('keydown', clavier, true); avant?.focus?.(); resolve(ok); };
    const annuler = h('button', { type: 'button', class: 'btn second', onclick: () => fin(false) }, 'Annuler');
    const valider = h('button', { type: 'button', class: danger ? 'btn rouge' : 'btn', onclick: () => fin(true) }, bouton);
    const fenetre = h('div', { class: 'fenetre', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'fenetre-titre', 'aria-describedby': 'fenetre-texte' },
      h('h2', { id: 'fenetre-titre' }, titre), h('p', { id: 'fenetre-texte' }, texte), h('div', { class: 'actions fin' }, annuler, valider));
    const voile = h('div', { class: 'voile', onclick: e => { if (e.target === voile) fin(false); } }, fenetre);
    const clavier = e => {
      if (e.key === 'Escape') { e.preventDefault(); fin(false); }
      else if (e.key === 'Enter' && document.activeElement !== annuler) { e.preventDefault(); fin(true); }
      else if (e.key === 'Tab') { const f = [annuler, valider]; const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + 2) % 2].focus(); }
    };
    document.addEventListener('keydown', clavier, true);
    document.body.append(voile); (danger ? annuler : valider).focus();
  });
}

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
  const mdp = champMotDePasse({ name: 'mdp', autocomplete: 'current-password', required: true });
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
const MENU = [['#/', 'Tableau de bord'], ['#/demandes', 'Suivi des clients'], ['#/comportement', 'Comportement'], ['#/campagnes', 'Campagnes'], ['#/avis', 'Avis'], ['#/ambassadeurs', 'Ambassadeurs'], ['#/catalogue', 'Catalogue'], ['#/equipe', 'Équipe'], ['#/reglages', 'E-mails et réglages'], ['#/compte', 'Mon compte']];
let compteurs = {};
function cadre(contenu) {
  const route = location.hash.replace(/\/[0-9a-f-]{36}$/, '') || '#/';
  const lien = ([href, texte]) => {
    const n = href === '#/demandes' ? compteurs.a_traiter : href === '#/avis' ? compteurs.avis_en_attente : href === '#/ambassadeurs' ? compteurs.echanges_en_attente : 0;
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
  '#/comportement': vueComportement, '#/catalogue': () => vueCatalogue(), '#/ambassadeurs': vueAmbassadeurs,
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
    h('div', { class: 'grille g3', style: 'margin-top:16px' },
      lienCarte('#/ambassadeurs', carteChiffre('Nouveaux ambassadeurs', nombre(c.nouveaux_membres), 'Inscrits dans l\'espace membre')),
      carteChiffre('Demandes recommandées', nombre(c.demandes_recommandees), 'Venues d\'un ambassadeur'),
      lienCarte('#/ambassadeurs', carteChiffre('Échanges à traiter', nombre(c.echanges_en_attente), 'Récompenses demandées', c.echanges_en_attente > 0))),
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
    h('div', {}, h('div', { class: 'l' }, h('span', {}, l), h('b', {}, nombre(n))), h('div', { class: 'barre' }, h('i', { style: `width:${100 * n / max}%` })))));
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
  const choixEtat = menu([['', 'Tous les états'], ...ETATS], { valeur: filtres.etat, libelle: 'Filtrer par état', onchange: v => { filtres.etat = v; vueDemandes(); } });
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
  const etat = menu(ETATS, { valeur: f.etat, libelle: 'État' });
  const relance = calendrier({ valeur: f.relance_le || '', libelle: 'Date de relance', vide: 'Pas de relance prévue' });
  const montant = champMontant(f.montant);
  const responsable = menu([['', 'Personne'], ...equipe.filter(m => m.actif !== false).map(m => [m.id, m.nom])], { valeur: f.responsable_id || '', libelle: 'Responsable' });
  const enregistrer = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    await api('/demandes/' + id, { methode: 'PATCH', corps: { etat: etat.valeur, relance_le: relance.valeur || null, montant: montant.nombre, responsable_id: responsable.valeur || null } });
    toast('Fiche enregistrée.'); vueFiche(id);
  }, e.currentTarget) }, 'Enregistrer');
  const genre = menu(GENRES.filter(g => g[0] !== 'etat' && g[0] !== 'email'), { libelle: 'Type de note' });
  const note = h('textarea', { placeholder: 'Ce qui s\'est dit, la prochaine étape…', style: 'min-height:80px' });
  const ajouterNote = h('button', { class: 'btn second', type: 'button', onclick: e => essayer(async () => {
    if (!note.value.trim()) return toast('La note est vide.', true);
    await api('/demandes/' + id + '/notes', { methode: 'POST', corps: { genre: genre.valeur, texte: note.value } }); toast('Note ajoutée.'); vueFiche(id);
  }, e.currentTarget) }, 'Ajouter au suivi');
  const sujetMail = h('input', { value: 'Votre demande auprès de ZTi' });
  const texteMail = h('textarea', { value: `Bonjour ${f.nom},\n\n` });
  const envoyerMail = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    await api('/demandes/' + id + '/email', { methode: 'POST', corps: { sujet: sujetMail.value, texte: texteMail.value } }); toast('E-mail envoyé.'); vueFiche(id);
  }, e.currentTarget) }, 'Envoyer l\'e-mail');
  const supprimer = moi.role === 'admin' ? h('button', { class: 'btn danger petit', type: 'button', onclick: e => essayer(async () => {
    if (!(await confirmer({ titre: 'Supprimer cette fiche ?', texte: 'La fiche et tout son historique seront effacés définitivement. À faire seulement si la personne le demande.', bouton: 'Supprimer', danger: true }))) return;
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
        h('div', { class: 'carte formulaire' }, h('h2', {}, 'Suivi'), champ('État', etat), champ('Relancer le', relance),
          champ('Responsable', responsable), h('label', {}, 'Montant du devis ou du contrat (F CFA)', montant), h('div', { class: 'actions' }, enregistrer, supprimer)),
        h('div', { class: 'carte formulaire' }, h('h2', {}, 'Historique'), champ('Type', genre), note, h('div', { class: 'actions' }, ajouterNote),
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
          if (!(await confirmer({ titre: 'Supprimer cet avis ?', texte: 'Il sera effacé définitivement.', bouton: 'Supprimer', danger: true }))) return; await api('/avis/' + a.id, { methode: 'DELETE' }); toast('Avis supprimé.'); vueAvis();
        }, e.currentTarget) }, 'Supprimer') : null))))
      : h('div', { class: 'carte vide' }, statutAvis === 'en_attente' ? 'Aucun avis à valider.' : 'Aucun avis ici.'),
  ]);
}

// ——— CAMPAGNES ———
const PAGES = [['/', 'Accueil'], ['/offres/diagnostic-ecoles/', 'Écoles'], ['/offres/audit-pme/', 'Entreprises'], ['/offres/particuliers/', 'Particuliers'], ['/contact/', 'Contact']];
const SOURCES = ['facebook', 'instagram', 'linkedin', 'whatsapp', 'tiktok', 'google', 'youtube', 'affiche', 'autre'];
const NOMS_SOURCES = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', tiktok: 'TikTok', google: 'Google', youtube: 'YouTube', affiche: 'Affiche / flyer', autre: 'Autre' };
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
async function vueCampagnes(edition = null) {
  const [{ campagnes, stats }, reg] = await Promise.all([api('/campagnes?jours=365'), api('/reglages')]);
  const lienSuivi = k => `${reg.site}${k.page}?utm_source=${encodeURIComponent(k.source)}&utm_medium=${encodeURIComponent(k.support)}&utm_campaign=${encodeURIComponent(k.code)}`;
  const k = edition || { nom: '', code: '', source: 'facebook', support: 'paid', page: '/offres/diagnostic-ecoles/', budget: '', debut: '', fin: '', notes: '' };
  const champs = {
    nom: h('input', { value: k.nom, placeholder: 'Ex. Écoles — rentrée novembre', oninput: e => { if (!edition) champs.code.value = slug(e.target.value); maj(); } }),
    code: h('input', { value: k.code, oninput: () => maj() }),
    source: menu(SOURCES.map(s => [s, NOMS_SOURCES[s] || s]), { valeur: k.source, libelle: 'Réseau', onchange: () => maj() }),
    support: menu([['paid', 'Publicité payante'], ['social', 'Publication gratuite'], ['message', 'Message / groupe'], ['print', 'Imprimé (affiche, flyer)']], { valeur: k.support, libelle: 'Type', onchange: () => maj() }),
    page: menu(PAGES.map(([v, l]) => [v, l + ' — ' + v]), { valeur: k.page, libelle: 'Page d\'arrivée', onchange: () => maj() }),
    budget: champMontant(k.budget), debut: calendrier({ valeur: k.debut || '', libelle: 'Début', vide: 'Non précisé' }),
    fin: calendrier({ valeur: k.fin || '', libelle: 'Fin', vide: 'Non précisé' }), notes: h('textarea', { value: k.notes || '', style: 'min-height:70px' }),
  };
  const lire = el => el.valeur !== undefined ? el.valeur : el.nombre !== undefined ? el.nombre : el.value;
  const apercu = h('div', { class: 'secret', style: 'font-size:13px;overflow-wrap:anywhere' });
  function maj() { apercu.textContent = lienSuivi({ code: champs.code.value || 'code', source: champs.source.valeur, support: champs.support.valeur, page: champs.page.valeur }); }
  maj();
  const valider = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    const corps = Object.fromEntries(Object.entries(champs).map(([c, el]) => [c, lire(el)]));
    await api(edition ? '/campagnes/' + edition.id : '/campagnes', { methode: edition ? 'PATCH' : 'POST', corps });
    toast(edition ? 'Campagne modifiée.' : 'Campagne créée : copiez son lien dans votre publicité.'); vueCampagnes();
  }, e.currentTarget) }, edition ? 'Enregistrer' : 'Créer la campagne');
  const statsDe = code => stats.find(s => s.code === code) || {};
  cadre([
    entete('Campagnes publicitaires', 'Chaque campagne a son lien : les visites, demandes et clients qu\'elle apporte sont comptés tout seuls.'),
    h('div', { class: 'grille g2' },
      h('div', { class: 'carte formulaire' }, h('h2', {}, edition ? 'Modifier la campagne' : 'Nouvelle campagne'),
        h('label', {}, 'Nom', champs.nom), h('label', {}, 'Code (dans le lien)', champs.code),
        h('div', { class: 'grille g2' }, champ('Réseau', champs.source), champ('Type', champs.support)),
        champ('Page d\'arrivée', champs.page),
        h('div', { class: 'grille g3' }, h('label', {}, 'Budget (F CFA)', champs.budget), champ('Début', champs.debut), champ('Fin', champs.fin)),
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
            if (!(await confirmer({ titre: 'Supprimer cette campagne ?', texte: 'Les visites et les demandes qu\'elle a apportées restent dans le tableau de bord.', bouton: 'Supprimer', danger: true }))) return; await api('/campagnes/' + c.id, { methode: 'DELETE' }); vueCampagnes();
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
  const role = menu([['membre', 'Membre (suivi des clients, avis, campagnes)'], ['admin', 'Administrateur (tout, dont l\'équipe et les réglages)']], { libelle: 'Rôle' });
  const ajouter = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    const r = await api('/equipe', { methode: 'POST', corps: { nom: nom.value, email: email.value, role: role.valeur } });
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
              if (!(await confirmer({ titre: 'Nouveau mot de passe provisoire ?', texte: m.nom + ' sera déconnecté et devra se connecter avec le nouveau mot de passe, puis le changer.', bouton: 'Créer le mot de passe' }))) return;
              const r = await api('/equipe/' + m.id + '/reinitialiser', { methode: 'POST' }); montrerMdp(m.nom, r.mot_de_passe_provisoire);
            }, e.currentTarget) }, 'Nouveau mot de passe')))))))),
      h('div', { class: 'carte formulaire' }, h('h2', {}, 'Ajouter une personne'), h('label', {}, 'Nom', nom), h('label', {}, 'E-mail', email), champ('Rôle', role), h('div', { class: 'actions' }, ajouter))),
  ]);
}

// ——— E-MAILS ET RÉGLAGES ———
async function vueReglages() {
  const r = await api('/reglages');
  const admin = moi.role === 'admin';
  const dest = h('input', { value: (r.alertes?.destinataires || []).join(', '), disabled: !admin || undefined });
  const alDem = interrupteur('Une alerte à chaque nouvelle demande', { coche: r.alertes?.demandes !== false, desactive: !admin });
  const alAvis = interrupteur('Une alerte à chaque nouvel avis', { coche: r.alertes?.avis !== false, desactive: !admin });
  const accActif = interrupteur('Envoyer l\'accusé de réception', { coche: r.accuse_demande?.actif !== false, desactive: !admin });
  const accSujet = h('input', { value: r.accuse_demande?.sujet || '', disabled: !admin || undefined });
  const accTexte = h('textarea', { value: r.accuse_demande?.texte || '', style: 'min-height:220px', disabled: !admin || undefined });
  const signature = h('textarea', { value: r.signature?.texte || '', style: 'min-height:70px', disabled: !admin || undefined });
  const fid = r.fidelite || {};
  const fidActif = interrupteur('Programme ambassadeurs ouvert', { coche: fid.actif !== false, desactive: !admin });
  const ptsReco = champMontant(fid.points_recommandation ?? 10, { placeholder: 'points', disabled: !admin || undefined });
  const ptsClient = champMontant(fid.points_client ?? 100, { placeholder: 'points', disabled: !admin || undefined });
  const ptsBienvenue = champMontant(fid.points_bienvenue ?? 0, { placeholder: 'points', disabled: !admin || undefined });
  const lignesRecompenses = h('div', { class: 'grille' });
  const ajouterRecompense = (nom = '', points = '') => {
    const n = h('input', { value: nom, placeholder: 'Récompense', disabled: !admin || undefined }), p = champMontant(points, { placeholder: 'points', disabled: !admin || undefined });
    const ligne = h('div', { class: 'ligne-recompense' }, n, p, admin ? h('button', { class: 'btn danger petit', type: 'button', onclick: () => ligne.remove() }, 'Retirer') : null);
    ligne.lire = () => ({ nom: n.value.trim(), points: p.nombre || 0 }); lignesRecompenses.append(ligne);
  };
  (fid.recompenses || []).forEach(x => ajouterRecompense(x.nom, x.points));
  const enregistrer = admin ? h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    await api('/reglages', { methode: 'PUT', corps: {
      alertes: { destinataires: dest.value.split(',').map(s => s.trim()).filter(Boolean), demandes: alDem.coche, avis: alAvis.coche },
      accuse_demande: { actif: accActif.coche, sujet: accSujet.value, texte: accTexte.value }, signature: { texte: signature.value },
      fidelite: { actif: fidActif.coche, points_recommandation: ptsReco.nombre || 0, points_client: ptsClient.nombre || 0, points_bienvenue: ptsBienvenue.nombre || 0,
        recompenses: [...lignesRecompenses.children].map(l => l.lire()).filter(x => x.nom && x.points > 0) } } });
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
        alDem, alAvis,
        h('h2', { style: 'margin-top:10px' }, 'Signature des e-mails'), signature),
      h('div', { class: 'carte formulaire' }, h('h2', {}, 'Accusé de réception au client'),
        h('p', { class: 'muet', style: 'margin:0' }, 'Envoyé automatiquement quand la personne a donné son e-mail. Vous pouvez écrire {prenom}, {nom} ou {organisation}.'),
        accActif, h('label', {}, 'Sujet', accSujet), h('label', {}, 'Texte', accTexte))),
    h('div', { class: 'carte formulaire', style: 'margin-top:16px' }, h('h2', {}, 'Programme ambassadeurs (fidélité)'), fidActif,
      h('div', { class: 'grille g3' }, h('label', {}, 'Points quand ZTi confirme une demande recommandée', ptsReco), h('label', {}, 'Points quand elle devient cliente', ptsClient), h('label', {}, 'Points de bienvenue', ptsBienvenue)),
      h('h3', {}, 'Récompenses à échanger contre des points'), lignesRecompenses,
      admin ? h('div', { class: 'actions' }, h('button', { class: 'btn second petit', type: 'button', onclick: () => ajouterRecompense() }, 'Ajouter une récompense')) : null),
    admin ? h('div', { class: 'actions', style: 'margin-top:16px' }, enregistrer) : null,
  ]);
}

// ——— MON COMPTE ———
function vueCompte(force = false) {
  const actuel = champMotDePasse({ autocomplete: 'current-password' });
  const nouveau = champMotDePasse({ autocomplete: 'new-password' });
  const confirmation = champMotDePasse({ autocomplete: 'new-password' });
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

// ——— COMPORTEMENT DES VISITEURS ———
let pageComportement = null;
async function vueComportement() {
  const t = await api('/comportement?jours=' + periode + (pageComportement ? '&chemin=' + encodeURIComponent(pageComportement) : ''));
  const choixPeriode = h('div', { class: 'onglets', role: 'group', 'aria-label': 'Période' },
    [[7, '7 jours'], [30, '30 jours'], [90, '3 mois'], [365, '1 an']].map(([j, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(j === periode), onclick: () => { periode = j; vueComportement(); } }, l)));
  const choixPage = t.pages.length ? menu(t.pages.map(p => [p.chemin, p.chemin]), { valeur: t.chemin, libelle: 'Page analysée', onchange: v => { pageComportement = v; vueComportement(); } }) : null;
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const duree = s => s == null ? '—' : s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0');
  const pageChoisie = t.pages.find(p => p.chemin === t.chemin) || { visites: t.total };
  const etapesForm = [...t.formulaire.map(f => ['Étape ' + f.etape + ' commencée', f.visites]), ['Demande envoyée', t.envoyes]];
  cadre([
    entete('Comportement des visiteurs', 'Ce que font les visiteurs sur chaque page : jusqu\'où ils lisent, ce qu\'ils cliquent, où ils partent.', choixPeriode),
    h('div', { class: 'carte defile-x' }, h('h2', {}, 'Toutes les pages'),
      t.pages.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Page', 'Visites', 'Lu en moyenne', 'Lu à 75 %', 'Temps moyen', 'Arrivées ici', 'Quittent ici', 'Demandes'].map((x, i) => h('th', { class: i ? 'n' : '' }, x)))),
        h('tbody', {}, t.pages.map(p => h('tr', { class: 'clic', onclick: () => { pageComportement = p.chemin; vueComportement(); } },
          h('td', {}, h('b', {}, p.chemin)), h('td', { class: 'n' }, nombre(p.visites)), h('td', { class: 'n' }, p.profondeur + ' %'),
          h('td', { class: 'n' }, pct(p.a75, p.visites) + ' %'), h('td', { class: 'n' }, duree(p.temps)), h('td', { class: 'n' }, nombre(p.entrees)),
          h('td', { class: 'n' + (pct(p.sorties, p.visites) > 60 ? ' alerte-texte' : '') }, pct(p.sorties, p.visites) + ' %'), h('td', { class: 'n' }, nombre(p.demandes))))))
        : h('p', { class: 'vide' }, 'Les données apparaîtront dès les premières visites du site.')),
    t.pages.length ? h('div', { class: 'actions', style: 'margin:22px 0 12px' }, h('h2', {}, 'Analyse de la page'), choixPage) : null,
    t.pages.length ? h('div', { class: 'grille g3' },
      h('div', { class: 'carte' }, h('h2', {}, 'Jusqu\'où ils lisent'), h('p', { class: 'muet' }, 'Part des visites qui atteignent chaque section, de haut en bas. Une forte baisse = l\'endroit où ils décrochent.'),
        t.sections.length ? h('div', { class: 'entonnoir', style: 'margin-top:12px' }, t.sections.map(s => h('div', {}, h('span', {}, s.section),
          h('div', { class: 'barre' }, h('i', { style: `width:${Math.max(2, pct(s.visites, t.total))}%` })), h('b', {}, pct(s.visites, t.total) + ' %'))))
          : h('p', { class: 'vide' }, 'Pas encore de données.')),
      h('div', { class: 'carte' }, h('h2', {}, 'Ce qu\'ils cliquent'), barres(t.clics.map(c => [c.cible, c.n]))),
      h('div', { class: 'carte' }, h('h2', {}, 'Le formulaire de la page'), h('p', { class: 'muet' }, 'Où ils abandonnent, étape par étape.'),
        etapesForm.length > 1 ? h('div', { class: 'entonnoir', style: 'margin-top:12px' }, etapesForm.map(([l, n]) => h('div', {}, h('span', {}, l),
          h('div', { class: 'barre' }, h('i', { style: `width:${Math.max(2, pct(n, pageChoisie.visites))}%` })), h('b', {}, nombre(n)))))
          : h('p', { class: 'vide' }, 'Personne n\'a encore commencé le formulaire de cette page.'))) : null,
    t.clicsSite.length ? h('div', { class: 'carte', style: 'margin-top:16px' }, h('h2', {}, 'Boutons les plus cliqués sur tout le site'), barres(t.clicsSite.map(c => [c.cible, c.n]))) : null,
  ]);
}

// ——— CATALOGUE ———
const TYPES_PRODUIT = [['logiciel', 'Logiciel'], ['formation', 'Formation'], ['service', 'Service'], ['materiel', 'Matériel']];
const CATEGORIES_PRODUIT = [['assistance', 'Assistance à distance'], ['outil', 'Outil créé par ZTi'], ['formation', 'Formation'], ['autre', 'Autre']];
async function vueCatalogue(edition = null) {
  const liste = await api('/produits');
  const admin = moi.role === 'admin';
  const p = edition || { type: 'logiciel', categorie: 'outil', nom: '', slug: '', resume: '', description: '', prix: null, lien_externe: '', version: '', systeme: 'Windows', publie: false, ordre: 50 };
  const champs = {
    nom: h('input', { value: p.nom, oninput: e => { if (!edition) champs.slug.value = slug(e.target.value); } }), slug: h('input', { value: p.slug }),
    type: menu(TYPES_PRODUIT, { valeur: p.type, libelle: 'Type' }), categorie: menu(CATEGORIES_PRODUIT, { valeur: p.categorie, libelle: 'Rubrique' }),
    resume: h('textarea', { value: p.resume, style: 'min-height:70px' }), description: h('textarea', { value: p.description || '', style: 'min-height:90px' }),
    prix: champMontant(p.prix), lien_externe: h('input', { value: p.lien_externe || '', placeholder: 'https://… (page officielle de l\'éditeur)' }),
    version: h('input', { value: p.version || '' }), systeme: h('input', { value: p.systeme || '' }),
    publie: interrupteur('Visible sur la page Téléchargements', { coche: p.publie }),
  };
  const enregistrer = h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
    const corps = { nom: champs.nom.value, slug: champs.slug.value, type: champs.type.valeur, categorie: champs.categorie.valeur, resume: champs.resume.value,
      description: champs.description.value, prix: champs.prix.nombre, lien_externe: champs.lien_externe.value, version: champs.version.value,
      systeme: champs.systeme.value, publie: champs.publie.coche, ordre: p.ordre };
    const r = await api(edition ? '/produits/' + edition.id : '/produits', { methode: edition ? 'PATCH' : 'POST', corps });
    toast(edition ? 'Produit enregistré.' : 'Produit créé. Ajoutez son fichier si besoin.');
    vueCatalogue(edition ? null : { ...corps, id: r.id });
  }, e.currentTarget) }, edition ? 'Enregistrer' : 'Créer');
  // envoi du fichier : bouton maison qui ouvre le choix de fichier (le champ natif reste caché)
  const entree = h('input', { type: 'file', class: 'cache', accept: '.zip,.exe,.msi,.7z,.pdf' });
  const etatFichier = h('span', { class: 'muet' }, edition?.fichier_nom ? 'Fichier actuel : ' + edition.fichier_nom + (edition.taille ? ' (' + Math.round(edition.taille / 1024) + ' Ko)' : '') : 'Aucun fichier sur le serveur.');
  entree.addEventListener('change', () => essayer(async () => {
    const f = entree.files[0]; if (!f) return;
    etatFichier.textContent = 'Envoi de ' + f.name + '…';
    const donnees = new FormData(); donnees.append('fichier', f);
    const r = await fetch('/v1/admin/produits/' + edition.id + '/fichier', { method: 'POST', body: donnees, credentials: 'same-origin' });
    const j = await r.json(); if (!r.ok) { etatFichier.textContent = ''; throw new Error(j.erreur); }
    toast('Fichier envoyé.'); vueCatalogue({ ...edition, fichier_nom: j.fichier_nom, taille: j.taille });
  }));
  const zoneFichier = edition?.id ? h('div', { class: 'champ-groupe' }, h('span', { class: 'champ-titre' }, 'Fichier à télécharger (ZIP, EXE, MSI, 7Z ou PDF, 300 Mo au plus)'),
    h('div', { class: 'actions' }, h('button', { class: 'btn second', type: 'button', onclick: () => entree.click() }, 'Choisir un fichier'), etatFichier), entree,
    h('p', { class: 'muet', style: 'margin:0' }, 'Un outil en .bat : mettez-le dans un fichier ZIP.')) : h('p', { class: 'muet' }, 'Créez le produit, puis ajoutez son fichier.');
  const tarif = x => x.prix ? fcfa(x.prix) : 'Gratuit';
  cadre([
    entete('Catalogue', 'Les logiciels de la page Téléchargements. Plus tard : formations, services et boutique.'),
    h('div', { class: 'grille g2' },
      h('div', { class: 'carte defile-x' }, h('table', {}, h('thead', {}, h('tr', {}, ['Produit', 'Prix', 'Téléchargements', 'État', ''].map((x, i) => h('th', { class: i === 2 ? 'n' : '' }, x)))),
        h('tbody', {}, liste.map(x => h('tr', {},
          h('td', {}, h('b', {}, x.nom), h('div', { class: 'muet' }, (CATEGORIES_PRODUIT.find(c => c[0] === x.categorie) || ['', ''])[1] + (x.version ? ' · v' + x.version : ''))),
          h('td', {}, tarif(x)), h('td', { class: 'n' }, nombre(x.telechargements), h('div', { class: 'muet' }, nombre(x.telechargements_30j) + ' sur 30 j')),
          h('td', {}, x.publie ? h('span', { class: 'etiquette e-client' }, 'En ligne') : h('span', { class: 'etiquette e-sans_suite' }, 'Brouillon'),
            !x.fichier && !x.lien_externe ? h('div', { class: 'muet' }, 'Sans fichier') : null),
          h('td', {}, admin ? h('div', { class: 'actions' }, h('button', { class: 'btn second petit', type: 'button', onclick: () => { vueCatalogue(x); scrollTo(0, 0); } }, 'Modifier'),
            h('button', { class: 'btn danger petit', type: 'button', onclick: e => essayer(async () => {
              if (!(await confirmer({ titre: 'Supprimer « ' + x.nom + ' » ?', texte: 'Le produit et son fichier seront effacés.', bouton: 'Supprimer', danger: true }))) return;
              await api('/produits/' + x.id, { methode: 'DELETE' }); vueCatalogue();
            }, e.currentTarget) }, 'Supprimer')) : null)))))),
      admin ? h('div', { class: 'carte formulaire' }, h('h2', {}, edition?.id ? 'Modifier : ' + edition.nom : 'Nouveau produit'),
        h('label', {}, 'Nom', champs.nom), h('label', {}, 'Adresse (dans le lien)', champs.slug),
        h('div', { class: 'grille g2' }, champ('Type', champs.type), champ('Rubrique', champs.categorie)),
        h('label', {}, 'Résumé (une ou deux phrases)', champs.resume), h('label', {}, 'Description', champs.description),
        h('div', { class: 'grille g2' }, h('label', {}, 'Prix (vide = gratuit)', champs.prix), h('label', {}, 'Version', champs.version)),
        h('label', {}, 'Systèmes', champs.systeme), h('label', {}, 'Ou lien de téléchargement officiel (logiciel d\'un éditeur)', champs.lien_externe),
        zoneFichier, champs.publie,
        h('p', { class: 'muet', style: 'margin:0' }, 'Un produit payant affiche « Nous contacter » tant que la boutique n\'est pas ouverte.'),
        h('div', { class: 'actions' }, enregistrer, edition ? h('button', { class: 'btn second', type: 'button', onclick: () => vueCatalogue() }, 'Annuler') : null))
        : h('div', { class: 'carte' }, h('p', { class: 'muet' }, 'Seuls les administrateurs modifient le catalogue.'))),
  ]);
}

// ——— AMBASSADEURS ———
const MOTIFS = { bienvenue: 'Bienvenue', recommandation: 'Recommandation confirmée', client: 'Filleul devenu client', bonus: 'Bonus', echange: 'Échange', echange_refuse: 'Points rendus', correction: 'Correction' };
let ongletAmbassadeurs = 'liste';
async function vueAmbassadeurs() {
  const onglets = h('div', { class: 'onglets' }, [['liste', 'Ambassadeurs'], ['echanges', 'Échanges à traiter']].map(([v, l]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === ongletAmbassadeurs), onclick: () => { ongletAmbassadeurs = v; vueAmbassadeurs(); } }, l)));
  if (ongletAmbassadeurs === 'echanges') {
    const liste = await api('/echanges?statut=demande');
    return cadre([entete('Ambassadeurs', 'Les récompenses demandées avec des points. Un refus rend les points.', onglets),
      liste.length ? h('div', { class: 'grille g3' }, liste.map(e => h('div', { class: 'carte', style: 'display:grid;gap:8px' },
        h('h2', {}, e.recompense), h('div', {}, h('b', {}, e.nom), h('div', { class: 'muet' }, e.tel + ' · ' + e.email), h('div', { class: 'muet' }, nombre(e.points) + ' points · ' + dateHeure(e.cree_le))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn petit', type: 'button', onclick: ev => essayer(async () => { await api('/echanges/' + e.id, { methode: 'PATCH', corps: { statut: 'accorde' } }); toast('Échange accordé.'); vueAmbassadeurs(); }, ev.currentTarget) }, 'Accorder'),
          h('button', { class: 'btn second petit', type: 'button', onclick: ev => essayer(async () => {
            if (!(await confirmer({ titre: 'Refuser cet échange ?', texte: 'Les ' + e.points + ' points seront rendus à ' + e.nom + '.', bouton: 'Refuser' }))) return;
            await api('/echanges/' + e.id, { methode: 'PATCH', corps: { statut: 'refuse' } }); toast('Échange refusé, points rendus.'); vueAmbassadeurs();
          }, ev.currentTarget) }, 'Refuser')))))
        : h('div', { class: 'carte vide' }, 'Aucun échange à traiter.')]);
  }
  const liste = await api('/ambassadeurs');
  cadre([
    entete('Ambassadeurs', 'Les membres qui recommandent ZTi. Leurs points montent quand ZTi confirme une demande recommandée, puis quand elle devient cliente.', onglets),
    liste.length ? h('div', { class: 'carte defile-x' }, h('table', {}, h('thead', {}, h('tr', {}, ['Ambassadeur', 'Code', 'Points', 'Recommandations', 'Clients', 'Inscrit le'].map((x, i) => h('th', { class: i > 1 && i < 5 ? 'n' : '' }, x)))),
      h('tbody', {}, liste.map(m => h('tr', { class: 'clic', onclick: () => vueAmbassadeur(m.id) },
        h('td', {}, h('b', {}, m.nom), h('div', { class: 'muet' }, m.tel), !m.actif ? h('span', { class: 'etiquette e-sans_suite' }, 'Désactivé') : null),
        h('td', { class: 'muet' }, m.code), h('td', { class: 'n' }, h('b', {}, nombre(m.solde))), h('td', { class: 'n' }, nombre(m.filleuls)),
        h('td', { class: 'n' }, nombre(m.clients)), h('td', { class: 'muet' }, date(m.cree_le)))))))
      : h('div', { class: 'carte vide' }, 'Aucun ambassadeur pour l\'instant. Les clients s\'inscrivent depuis l\'espace membre du site.'),
  ]);
}
async function vueAmbassadeur(id) {
  const { membre: m, historique, filleuls } = await api('/ambassadeurs/' + id);
  const solde = historique.reduce((s, x) => s + x.points, 0);
  const nb = champMontant(null, { placeholder: 'Ex. 50 ou -20' });
  const signe = menu([['+', 'Ajouter'], ['-', 'Retirer']], { libelle: 'Ajouter ou retirer' });
  const raison = h('input', { placeholder: 'Raison (visible dans l\'historique)' });
  cadre([
    entete(m.nom, m.email + ' · ' + m.tel + ' · code ' + m.code, h('button', { class: 'btn second', type: 'button', onclick: () => vueAmbassadeurs() }, '← Retour'),
      moi.role === 'admin' ? h('button', { class: 'btn second', type: 'button', onclick: e => essayer(async () => {
        await api('/ambassadeurs/' + id, { methode: 'PATCH', corps: { actif: !m.actif } }); toast(m.actif ? 'Compte désactivé.' : 'Compte réactivé.'); vueAmbassadeur(id);
      }, e.currentTarget) }, m.actif ? 'Désactiver' : 'Réactiver') : null),
    h('div', { class: 'grille g2' },
      h('div', { class: 'grille' },
        h('div', { class: 'carte chiffre' }, h('small', {}, 'Solde'), h('b', {}, nombre(solde) + ' points')),
        moi.role === 'admin' ? h('div', { class: 'carte formulaire' }, h('h2', {}, 'Ajuster les points'), h('div', { class: 'grille g2' }, champ('Opération', signe), h('label', {}, 'Points', nb)), raison,
          h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: e => essayer(async () => {
            const n = nb.nombre; if (!n) throw new Error('Indiquez un nombre de points.');
            await api('/ambassadeurs/' + id + '/points', { methode: 'POST', corps: { points: signe.valeur === '-' ? -n : n, motif: signe.valeur === '-' ? 'correction' : 'bonus', detail: raison.value } });
            toast('Points enregistrés.'); vueAmbassadeur(id);
          }, e.currentTarget) }, 'Enregistrer'))) : null,
        h('div', { class: 'carte' }, h('h2', {}, 'Personnes recommandées'), filleuls.length ? h('table', {}, h('tbody', {}, filleuls.map(f =>
          h('tr', { class: 'clic', onclick: () => { location.hash = '#/demandes/' + f.id; } }, h('td', {}, h('b', {}, f.nom), h('div', { class: 'muet' }, f.organisation)), h('td', {}, pastilleEtat(f.etat)), h('td', { class: 'muet' }, date(f.cree_le))))))
          : h('p', { class: 'vide' }, 'Personne pour l\'instant.'))),
      h('div', { class: 'carte' }, h('h2', {}, 'Historique des points'), historique.length ? h('table', {}, h('tbody', {}, historique.map(x => h('tr', {},
        h('td', {}, h('b', {}, MOTIFS[x.motif] || x.motif), h('div', { class: 'muet' }, x.detail + (x.auteur ? ' · ' + x.auteur : ''))),
        h('td', { class: 'n' + (x.points < 0 ? ' alerte-texte' : '') }, (x.points > 0 ? '+' : '') + nombre(x.points)), h('td', { class: 'muet' }, dateHeure(x.cree_le))))))
        : h('p', { class: 'vide' }, 'Aucun mouvement.'))),
  ]);
}
