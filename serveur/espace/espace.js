// Espace ambassadeurs ZTi : inscription, connexion, lien de recommandation, points, récompenses.
// Aucune bibliothèque, aucun contrôle natif du navigateur ; données affichées par textContent uniquement.
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v; else if (k === 'value') el.value = v; else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat(Infinity)) if (e !== null && e !== undefined && e !== false) el.append(e instanceof Node ? e : String(e));
  return el;
}
const nombre = n => Number(n || 0).toLocaleString('fr-FR');
const date = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
function toast(texte, mauvais = false) { const t = $('#toast'); t.textContent = texte; t.className = mauvais ? 'mauvais' : ''; t.hidden = false; clearTimeout(toast.m); toast.m = setTimeout(() => { t.hidden = true; }, 4500); }
async function api(chemin, { methode = 'GET', corps } = {}) {
  const r = await fetch('/v1/membres' + chemin, { method: methode, credentials: 'same-origin', headers: corps !== undefined ? { 'Content-Type': 'application/json' } : {}, body: corps !== undefined ? JSON.stringify(corps) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.erreur || 'Erreur ' + r.status), { statut: r.status });
  return d;
}
const essayer = async (fn, b) => { if (b) b.disabled = true; try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (b) b.disabled = false; } };
function champMotDePasse(attrs = {}) {
  const input = h('input', { type: 'password', ...attrs });
  const oeil = h('button', { type: 'button', class: 'oeil', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false', onclick: () => {
    const voir = input.type === 'password'; input.type = voir ? 'text' : 'password'; oeil.setAttribute('aria-pressed', String(voir)); oeil.setAttribute('aria-label', voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  } });
  const el = h('div', { class: 'champ-mdp' }, input, oeil);
  Object.defineProperty(el, 'value', { get: () => input.value });
  return el;
}
function caseMaison(texte) {
  const b = h('button', { type: 'button', role: 'checkbox', class: 'case-maison', 'aria-checked': 'false', onclick: () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')) }, h('span', { class: 'boite', 'aria-hidden': 'true' }), h('span', {}, texte));
  Object.defineProperty(b, 'coche', { get: () => b.getAttribute('aria-checked') === 'true' });
  return b;
}
function confirmer({ titre, texte, bouton = 'Confirmer' }) {
  return new Promise(resolve => {
    const avant = document.activeElement;
    const fin = ok => { voile.remove(); document.removeEventListener('keydown', clavier, true); avant?.focus?.(); resolve(ok); };
    const annuler = h('button', { type: 'button', class: 'btn second', onclick: () => fin(false) }, 'Annuler');
    const valider = h('button', { type: 'button', class: 'btn', onclick: () => fin(true) }, bouton);
    const voile = h('div', { class: 'voile', onclick: e => { if (e.target === voile) fin(false); } },
      h('div', { class: 'fenetre', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'f-titre' }, h('h2', { id: 'f-titre' }, titre), h('p', {}, texte), h('div', { class: 'actions fin' }, annuler, valider)));
    const clavier = e => { if (e.key === 'Escape') { e.preventDefault(); fin(false); } else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === annuler ? valider : annuler).focus(); } };
    document.addEventListener('keydown', clavier, true); document.body.append(voile); valider.focus();
  });
}

// code d'ambassadeur venu du lien (?ref=…) ou du site
const parrain = (() => {
  const q = new URLSearchParams(location.search).get('ref');
  if (q && /^[a-z0-9-]{2,40}$/i.test(q)) { localStorage.setItem('zti-parrain', q.toLowerCase()); return q.toLowerCase(); }
  return localStorage.getItem('zti-parrain') || '';
})();

function cadre(connecte, titre, sousTitre, contenu) {
  app.replaceChildren(
    h('header', { class: 'espace-haut' },
      h('div', { class: 'espace-barre' }, h('a', { href: '#/' }, h('img', { src: 'logo.png', alt: 'ZTi' })),
        h('div', { class: 'actions' }, connecte ? h('button', { type: 'button', onclick: async () => { await essayer(() => api('/deconnexion', { methode: 'POST' })); location.hash = '#/'; demarrer(); } }, 'Se déconnecter') : null)),
      h('div', { class: 'espace-titre' }, h('h1', {}, titre), sousTitre ? h('p', {}, sousTitre) : null)),
    h('main', { class: 'espace-corps' }, contenu));
  app.classList.remove('chargement'); app.removeAttribute('aria-busy');
}

// ——— accueil : connexion ou inscription ———
let onglet = parrain ? 'inscription' : 'connexion';
function vueAccueil() {
  const erreur = h('p', { class: 'erreur', hidden: true });
  const montrerErreur = m => { erreur.textContent = m; erreur.hidden = false; };
  let formulaire;
  if (onglet === 'connexion') {
    const email = h('input', { type: 'email', autocomplete: 'username' }), mdp = champMotDePasse({ autocomplete: 'current-password' });
    const b = h('button', { class: 'btn', type: 'submit' }, 'Se connecter');
    formulaire = h('form', { class: 'formulaire', onsubmit: e => { e.preventDefault(); erreur.hidden = true; essayer(async () => {
      try { await api('/connexion', { methode: 'POST', corps: { email: email.value, mot_de_passe: mdp.value } }); demarrer(); } catch (err) { montrerErreur(err.message); }
    }, b); } }, erreur, h('label', {}, 'E-mail', email), h('label', {}, 'Mot de passe', mdp), h('div', { class: 'actions' }, b,
      h('button', { class: 'btn second', type: 'button', onclick: () => { onglet = 'oubli'; vueAccueil(); } }, 'Mot de passe oublié')));
  } else if (onglet === 'oubli') {
    const email = h('input', { type: 'email', autocomplete: 'username' });
    const b = h('button', { class: 'btn', type: 'submit' }, 'Recevoir le lien');
    formulaire = h('form', { class: 'formulaire', onsubmit: e => { e.preventDefault(); essayer(async () => {
      const r = await api('/oubli', { methode: 'POST', corps: { email: email.value } }); toast(r.message);
    }, b); } }, h('p', { class: 'muet', style: 'margin:0' }, 'Indiquez l\'e-mail de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.'),
      h('label', {}, 'E-mail', email), h('div', { class: 'actions' }, b, h('button', { class: 'btn second', type: 'button', onclick: () => { onglet = 'connexion'; vueAccueil(); } }, 'Retour')));
  } else {
    const nom = h('input', { autocomplete: 'name', maxlength: 80 }), email = h('input', { type: 'email', autocomplete: 'email' });
    const tel = h('input', { inputmode: 'tel', autocomplete: 'tel-national', maxlength: 12, placeholder: '6XX XX XX XX' });
    tel.addEventListener('input', () => { const c = tel.value.replace(/\D/g, '').replace(/^237/, '').slice(0, 9); tel.value = c.replace(/(\d)(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})/, (m, a, b2, c2, d, e2) => [a + b2, c2, d, e2].filter(Boolean).join(' ')); });
    const mdp = champMotDePasse({ autocomplete: 'new-password' });
    const accord = caseMaison('J\'accepte que ZTi garde ces informations pour gérer mon compte d\'ambassadeur et mes points (loi n° 2024/017). Elles ne sont ni communiquées ni cédées.');
    const b = h('button', { class: 'btn', type: 'submit' }, 'Créer mon compte');
    formulaire = h('form', { class: 'formulaire', onsubmit: e => { e.preventDefault(); erreur.hidden = true; essayer(async () => {
      try {
        await api('/inscription', { methode: 'POST', corps: { nom: nom.value, email: email.value, tel: tel.value, mot_de_passe: mdp.value, accord: accord.coche, parrain } });
        toast('Bienvenue chez les ambassadeurs ZTi !'); demarrer();
      } catch (err) { montrerErreur(err.message + (err.statut === 400 ? ' Vérifiez : nom, e-mail, téléphone (9 chiffres), mot de passe de 10 caractères au moins, accord.' : '')); }
    }, b); } }, erreur, parrain ? h('p', { class: 'muet', style: 'margin:0' }, 'Vous avez été recommandé par un ambassadeur (code ' + parrain + ').') : null,
      h('label', {}, 'Nom et prénom', nom), h('div', { class: 'grille g2' }, h('label', {}, 'E-mail', email),
        h('div', { class: 'champ-groupe' }, h('span', { class: 'champ-titre' }, 'Téléphone / WhatsApp'), h('div', { class: 'telephone-maison' }, h('span', {}, '+237'), tel))),
      h('label', {}, 'Mot de passe (10 caractères au moins)', mdp), accord, h('div', { class: 'actions' }, b));
  }
  const onglets = h('div', { class: 'onglets' }, [['inscription', 'Créer mon compte'], ['connexion', 'Me connecter']].map(([v, l]) =>
    h('button', { type: 'button', 'aria-pressed': String(onglet === v || (v === 'connexion' && onglet === 'oubli')), onclick: () => { onglet = v; vueAccueil(); } }, l)));
  cadre(false, h('span', {}, 'Recommandez ZTi, ', h('em', {}, 'gagnez des points'), '.'),
    'Vous connaissez une école, une entreprise ou une personne qui a besoin de ZTi ? Partagez votre lien : chaque recommandation confirmée vous rapporte des points, à échanger contre des services ZTi.', [
    h('div', { class: 'etapes-amb' }, [['1', 'Créez votre compte', 'Gratuit, en une minute. Vous recevez votre lien personnel.'],
      ['2', 'Partagez votre lien', 'Sur WhatsApp, Facebook ou de vive voix avec votre code.'],
      ['3', 'Gagnez des points', 'Quand ZTi confirme la demande, puis quand la personne devient cliente.']].map(([n, t, x]) =>
      h('div', { class: 'carte' }, h('b', {}, n), h('h3', {}, t), h('p', { class: 'muet', style: 'margin:6px 0 0' }, x)))),
    h('div', { class: 'carte', style: 'max-width:640px;width:100%;justify-self:center;display:grid;gap:16px' }, onglets, formulaire),
  ]);
}

function vueNouveauMotDePasse(jeton) {
  const mdp = champMotDePasse({ autocomplete: 'new-password' }), conf = champMotDePasse({ autocomplete: 'new-password' });
  const b = h('button', { class: 'btn', type: 'submit' }, 'Enregistrer');
  cadre(false, 'Nouveau mot de passe', 'Choisissez un mot de passe de 10 caractères au moins.', h('form', { class: 'carte formulaire', style: 'max-width:520px', onsubmit: e => { e.preventDefault(); essayer(async () => {
    if (mdp.value !== conf.value) throw new Error('Les deux mots de passe ne sont pas identiques.');
    await api('/nouveau-mot-de-passe', { methode: 'POST', corps: { jeton, mot_de_passe: mdp.value } }); toast('Mot de passe changé.'); location.hash = '#/'; demarrer();
  }, b); } }, h('label', {}, 'Nouveau mot de passe', mdp), h('label', {}, 'Confirmez', conf), h('div', { class: 'actions' }, b)));
}

// ——— mon espace ———
const MOTIFS = { bienvenue: 'Bienvenue', recommandation: 'Recommandation confirmée', client: 'Filleul devenu client', bonus: 'Bonus de ZTi', echange: 'Échange', echange_refuse: 'Points rendus', correction: 'Correction' };
async function vueEspace(m) {
  const copier = () => navigator.clipboard.writeText(m.lien).then(() => toast('Lien copié.'));
  const message = `Je te recommande ZTi pour l'entretien et le dépannage de tes ordinateurs (écoles, entreprises, particuliers). Diagnostic offert : ${m.lien}`;
  const mdpActuel = champMotDePasse({ autocomplete: 'current-password' }), mdpNouveau = champMotDePasse({ autocomplete: 'new-password' });
  cadre(true, h('span', {}, 'Bonjour ', h('em', {}, m.membre.nom.split(' ')[0]), '.'), 'Votre espace d\'ambassadeur ZTi.', [
    h('div', { class: 'grille g2' },
      h('div', { class: 'carte chiffre solde' }, h('small', {}, 'Vos points'), h('b', {}, nombre(m.solde)),
        h('span', {}, m.regles.actif ? `+${m.regles.recommandation} points par recommandation confirmée, +${m.regles.client} quand elle devient cliente.` : 'Le programme est en pause.')),
      h('div', { class: 'carte', style: 'display:grid;gap:12px' }, h('h2', {}, 'Votre lien de recommandation'),
        h('div', { class: 'lien-parrain' }, h('code', {}, m.lien)),
        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: copier }, 'Copier le lien'),
          h('a', { class: 'btn second', href: 'https://wa.me/?text=' + encodeURIComponent(message), target: '_blank', rel: 'noopener' }, 'Partager sur WhatsApp')),
        h('p', { class: 'muet', style: 'margin:0' }, 'Votre code : ', h('b', {}, m.membre.code), '. La personne peut aussi le donner au téléphone.'))),
    h('div', { class: 'carte' }, h('h2', {}, 'Échanger mes points'), m.recompenses.length ? h('div', { class: 'grille g3', style: 'margin-top:12px' }, m.recompenses.map(r =>
      h('div', { class: 'carte recompense' }, h('h3', {}, r.nom), h('b', {}, nombre(r.points) + ' points'),
        h('button', { class: m.solde >= r.points ? 'btn' : 'btn second', type: 'button', disabled: m.solde < r.points || !m.regles.actif || undefined, onclick: e => essayer(async () => {
          if (!(await confirmer({ titre: 'Échanger ' + r.points + ' points ?', texte: 'Contre : ' + r.nom + '. ZTi vous contacte pour l\'organiser. Si ZTi ne peut pas l\'accorder, vos points vous sont rendus.', bouton: 'Échanger' }))) return;
          await api('/echanges', { methode: 'POST', corps: { recompense: r.nom } }); toast('Demande envoyée à ZTi.'); demarrer();
        }, e.currentTarget) }, m.solde >= r.points ? 'Échanger' : 'Pas encore assez de points')))) : h('p', { class: 'vide' }, 'Les récompenses arrivent bientôt.'),
      m.echanges.length ? h('div', { style: 'margin-top:14px' }, h('h3', {}, 'Mes demandes d\'échange'), h('table', {}, h('tbody', {}, m.echanges.map(e => h('tr', {},
        h('td', {}, e.recompense), h('td', { class: 'n' }, nombre(e.points) + ' pts'), h('td', {}, h('span', { class: 'etiquette ' + (e.statut === 'accorde' ? 'e-client' : e.statut === 'refuse' ? 'e-sans_suite' : 'e-nouvelle') },
          e.statut === 'accorde' ? 'Accordé' : e.statut === 'refuse' ? 'Refusé, points rendus' : 'En cours')), h('td', { class: 'muet' }, date(e.cree_le))))))) : null),
    h('div', { class: 'grille g2' },
      h('div', { class: 'carte' }, h('h2', {}, 'Mes recommandations'), h('p', { class: 'muet' }, nombre(m.inscrits) + ' personne(s) inscrite(s) avec votre lien.'),
        m.filleuls.length ? h('table', {}, h('tbody', {}, m.filleuls.map(f => h('tr', {}, h('td', {}, h('b', {}, f.nom)), h('td', {}, f.etat), h('td', { class: 'muet' }, date(f.cree_le))))))
          : h('p', { class: 'vide' }, 'Aucune demande recommandée pour l\'instant. Partagez votre lien !')),
      h('div', { class: 'carte' }, h('h2', {}, 'Historique de mes points'), m.historique.length ? h('table', {}, h('tbody', {}, m.historique.map(x => h('tr', {},
        h('td', {}, h('b', {}, MOTIFS[x.motif] || x.motif), h('div', { class: 'muet' }, x.detail)), h('td', { class: 'n' }, (x.points > 0 ? '+' : '') + nombre(x.points)), h('td', { class: 'muet' }, date(x.cree_le))))))
        : h('p', { class: 'vide' }, 'Pas encore de points.'))),
    h('form', { class: 'carte formulaire', style: 'max-width:520px', onsubmit: e => { e.preventDefault(); essayer(async () => {
      await api('/mot-de-passe', { methode: 'POST', corps: { actuel: mdpActuel.value, nouveau: mdpNouveau.value } }); toast('Mot de passe changé.'); demarrer();
    }, e.submitter); } }, h('h2', {}, 'Changer mon mot de passe'), h('label', {}, 'Mot de passe actuel', mdpActuel), h('label', {}, 'Nouveau mot de passe', mdpNouveau),
      h('div', { class: 'actions' }, h('button', { class: 'btn second', type: 'submit' }, 'Changer'))),
  ]);
}

async function demarrer() {
  const m = location.hash.match(/^#\/nouveau\/([\w-]{20,})$/);
  if (m) return vueNouveauMotDePasse(m[1]);
  try { vueEspace(await api('/moi')); } catch (e) { if (e.statut === 401) vueAccueil(); else toast(e.message, true); }
}
window.addEventListener('hashchange', demarrer);
demarrer();
