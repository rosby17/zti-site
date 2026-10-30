// Comportements du site ZTi : menu sur téléphone, apparitions, questions repliables, visionneuse des attestations,
// calculateur du coût réel, formulaires de demande (général, écoles, entreprises, particuliers), avis, page « Merci ».
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = n => Math.round(n).toLocaleString('fr-FR').replace(/\s/g, '\u00a0');
const suivi = (ev, p) => { if (window.fbq) window.fbq('track', ev, p); };

/* ---------- menu sur téléphone ---------- */
const bMenu = $('.menu-mobile'), nav = $('#menu-principal');
if (bMenu && nav) {
  const fermer = () => { nav.classList.remove('ouvert'); bMenu.setAttribute('aria-expanded', 'false'); };
  bMenu.addEventListener('click', () => { const o = nav.classList.toggle('ouvert'); bMenu.setAttribute('aria-expanded', String(o)); });
  nav.addEventListener('click', e => { if (e.target.closest('a')) fermer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fermer(); });
}

/* ---------- apparition au défilement ---------- */
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vu'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
  $$('.rv').forEach(e => io.observe(e));
} else $$('.rv').forEach(e => e.classList.add('vu'));

/* ---------- questions repliables ---------- */
$$('.question > button').forEach(b => b.addEventListener('click', () => {
  const ouvert = b.getAttribute('aria-expanded') === 'true';
  b.setAttribute('aria-expanded', String(!ouvert));
  document.getElementById(b.getAttribute('aria-controls')).hidden = ouvert;
}));

/* ---------- visionneuse des attestations (fenêtre maison) ---------- */
const boutonsVision = $$('[data-visionneuse]');
if (boutonsVision.length) {
  const v = document.createElement('div');
  v.className = 'visionneuse'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', 'Attestation');
  v.innerHTML = '<img alt="" oncontextmenu="return false"><button class="fermer" type="button" aria-label="Fermer">×</button>';
  document.body.append(v);
  let retour = null;
  const fermer = () => { v.classList.remove('ouverte'); retour?.focus(); };
  boutonsVision.forEach(b => b.addEventListener('click', () => { retour = b; $('img', v).src = b.dataset.visionneuse; v.classList.add('ouverte'); $('.fermer', v).focus(); }));
  v.addEventListener('click', e => { if (e.target === v || e.target.closest('.fermer')) fermer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && v.classList.contains('ouverte')) fermer(); });
}

/* ---------- calculateur du coût réel ---------- */
$$('[data-calculateur]').forEach(root => {
  const grille = JSON.parse(root.dataset.grille || '[]');
  const prix = $('[data-calc="prix"]', root), postes = $('[data-calc="postes"]', root);
  // nouveau chiffre affiché d'un coup, avec un léger fondu seulement sur ce qui a changé (pas de défilement)
  const out = (k, v, dec = 0) => $$(`[data-out="${k}"]`, root).forEach(e => {
    const texte = dec ? v.toFixed(dec).replace('.', ',') : fmt(v);
    if (e.textContent === texte) return;
    const premiere = !e.textContent;
    e.textContent = texte;
    if (!premiere) { e.classList.remove('change'); void e.offsetWidth; e.classList.add('change'); }
  });
  const lire = el => +String(el.value).replace(/\D/g, '') || 0;
  const maj = () => {
    const P = Math.max(0, lire(prix)), N = Math.max(1, Math.min(9999, lire(postes) || 1));
    out('m24', P / 24); out('a24', P / 2); out('m36', P / 36); out('m36b', P / 36); out('a36', P / 3); out('g1', P / 2 - P / 3);
    const T = P * N;
    $$('[data-out="n"]', root).forEach(e => { e.textContent = N; });
    out('total', T); out('sa24', T / 2); out('sm24', T / 24); out('sa36', T / 3); out('sm36', T / 36); out('g2', T / 2 - T / 3);
    if (grille.length) {
      const pp = (grille.find(([max]) => N <= max) || grille[grille.length - 1])[1];
      const mois = P > 0 ? pp / (P / 36) : 0;
      out('pp', pp); out('ps', pp * N); out('mois', mois, 1);
    }
  };
  prix.addEventListener('input', () => { const n = String(prix.value).replace(/\D/g, '').slice(0, 9); prix.value = n ? fmt(+n) : ''; maj(); });
  postes.addEventListener('input', () => { postes.value = String(postes.value).replace(/\D/g, '').slice(0, 4); maj(); });
  $$('[data-pas]', root).forEach(b => b.addEventListener('click', () => { postes.value = Math.max(1, Math.min(9999, (lire(postes) || 1) + +b.dataset.pas)); maj(); }));
  maj();
});

/* ---------- source de la visite (publicités) : gardée pendant la visite ---------- */
const SOURCE = 'zti-source';
(() => {
  const q = new URLSearchParams(location.search);
  const champs = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid'];
  if (champs.some(c => q.get(c))) {
    const s = {}; champs.forEach(c => { if (q.get(c)) s[c] = q.get(c).slice(0, 120); });
    sessionStorage.setItem(SOURCE, JSON.stringify(s));
  } else if (!sessionStorage.getItem(SOURCE) && document.referrer && !document.referrer.startsWith(location.origin)) {
    sessionStorage.setItem(SOURCE, JSON.stringify({ referent: document.referrer.slice(0, 200) }));
  }
})();

/* ---------- formulaire de demande (général, écoles, entreprises en 3 étapes, particuliers) ---------- */
$$('form[data-demande]').forEach(form => {
  // choix en boutons
  $$('[data-choix]', form).forEach(g => {
    const unique = g.hasAttribute('data-unique');
    $$('button', g).forEach(b => b.addEventListener('click', () => {
      if (unique) { $$('button', g).forEach(x => x.setAttribute('aria-checked', String(x === b))); }
      else b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      g.closest('.champ')?.classList.remove('invalide');
      if (g.dataset.choix === 'profil') majProfil();
    }));
    if (unique) g.addEventListener('keydown', e => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const bs = $$('button', g), i = bs.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); const n = bs[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; n.focus(); n.click();
    });
  });
  const caseAccord = $('[data-case="accord"]', form);
  caseAccord.addEventListener('click', () => { caseAccord.setAttribute('aria-checked', String(caseAccord.getAttribute('aria-checked') !== 'true')); caseAccord.closest('.champ').classList.remove('invalide'); });
  const valeur = n => $$(`[data-choix="${n}"] button`, form).filter(b => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim());
  const code = n => ($$(`[data-choix="${n}"] button[aria-checked="true"]`, form)[0] || {}).dataset?.valeur || '';
  const v = n => (form.elements[n]?.value || '').trim();
  const profil = () => valeur('profil').join('') || form.dataset.profil || '';
  const champOrg = $('[data-champ="organisation"]', form);
  function majProfil() { if (champOrg && $('[data-choix="profil"]', form)) champOrg.hidden = code('profil') === 'particulier'; }
  majProfil();
  $$('input, textarea', form).forEach(i => i.addEventListener('input', () => i.closest('.champ')?.classList.remove('invalide')));
  const tel = form.elements.tel;
  tel.addEventListener('input', () => { const c = tel.value.replace(/\D/g, '').replace(/^237/, '').slice(0, 9); tel.value = c.replace(/(\d)(\d{0,2})(\d{0,2})(\d{0,2})(\d{0,2})/, (m, a, b, c2, d, e) => [a + b, c2, d, e].filter(Boolean).join(' ')); });

  // contrôle d'un bloc (une étape, ou la fin du formulaire) : signale les champs à corriger
  const controler = bloc => {
    const erreurs = [];
    const marque = (champ, ok) => { if (!champ || champ.hidden) return; champ.classList.toggle('invalide', !ok); if (!ok) erreurs.push(champ); };
    const champ = n => $(`[data-champ="${n}"]`, bloc);
    $$('[data-requis]', bloc).forEach(c => marque(c, !!code(c.dataset.champ)));
    $$('[data-requis-plusieurs]', bloc).forEach(c => marque(c, valeur(c.dataset.champ).length > 0));
    marque(champ('organisation'), v('organisation').length >= 2);
    marque(champ('nom'), v('nom').length >= 2);
    marque(champ('tel'), /^6\d{8}$/.test(v('tel').replace(/\D/g, '')));
    const ec = champ('email');
    if (ec) marque(ec, ec.hasAttribute('data-email-requis') ? /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v('email')) : !v('email') || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v('email')));
    marque(champ('accord'), caseAccord.getAttribute('aria-checked') === 'true');
    const msg = $(':scope > .message-erreur', bloc) || $(':scope > .message-erreur', fin);
    if (erreurs.length) {
      if (msg) { msg.textContent = 'Quelques informations manquent : elles sont signalées ci-dessus.'; msg.hidden = false; }
      erreurs[0].querySelector('input, textarea, button')?.focus();
      return false;
    }
    if (msg) msg.hidden = true;
    return true;
  };

  // étapes (formulaire des entreprises) : la fin du formulaire n'apparaît qu'à la dernière
  const etapes = $$('[data-etape]', form), fin = $('[data-fin]', form), progression = $('[data-progression]', form);
  const titres = JSON.parse(progression?.dataset.titres || '[]');
  let courante = 0;
  const aller = n => {
    courante = n;
    etapes.forEach((x, i) => { x.hidden = i !== n; });
    fin.hidden = n !== etapes.length - 1;
    if (progression) progression.textContent = `Étape ${n + 1} sur ${etapes.length} · ${titres[n] || ''}`;
    const haut = form.getBoundingClientRect().top + scrollY - 90;
    if (scrollY > haut) window.scrollTo({ top: haut, behavior: 'smooth' });
    $('input:not([type=hidden]), button:not(.retour)', etapes[n])?.focus({ preventScroll: true });
    if (n > 0) window.ztiMesurer?.('etape2');
  };
  $$('[data-suivant]', form).forEach(b => b.addEventListener('click', () => { if (controler(etapes[courante])) aller(courante + 1); }));
  $$('[data-retour]', form).forEach(b => b.addEventListener('click', () => aller(courante - 1)));

  let envoi = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (envoi || form.elements.site_web.value) return; // déjà en cours, ou robot
    for (let i = 0; i < etapes.length; i++) if (!controler(etapes[i])) { if (i !== courante) aller(i); else controler(fin) || controler(etapes[i]); return; }
    if (!controler(fin)) return;

    const chiffres = v('tel').replace(/\D/g, '');
    const fonction = v('fonction') || valeur('fonction_choix').join('');
    const d = {
      date: new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' }), accord: true,
      sujet: form.dataset.sujet, profil: profil(), organisation: v('organisation'), secteur: valeur('secteur').join(''),
      nom: v('nom'), fonction, tel: '+237 ' + chiffres.replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5'), email: v('email'),
      lieu: v('lieu') || valeur('ville').join(''), postes: valeur('postes').join(''), situation: valeur('situation').join(''),
      besoins: valeur('besoins'), accompagnement: valeur('accompagnement').join(''), prestataire: valeur('prestataire').join(''),
      depenses: valeur('depenses').join(''), moment: valeur('moment').join(''), message: v('message'), connu: valeur('connu').join(''),
      page: form.dataset.page || location.pathname, campagne: form.dataset.campagne || '', adresse: location.href.split('#')[0],
      ...JSON.parse(sessionStorage.getItem(SOURCE) || '{}'),
    };
    const bouton = $('button[type="submit"]', form); bouton.disabled = true; envoi = true;
    let enregistree = false;
    if (form.dataset.endpoint) enregistree = await envoyerDemande(form.dataset.endpoint, d);
    suivi('Lead', { content_name: d.sujet, content_category: d.campagne || d.page });
    const lignes = [
      `Bonjour ZTi, voici ma demande (${d.sujet}) :`,
      `• Profil : ${d.profil}`, d.organisation && `• ${d.profil === 'Établissement scolaire' ? 'Établissement' : 'Entreprise / organisation'} : ${d.organisation}`,
      `• Nom : ${d.nom}${d.fonction ? ' (' + d.fonction + ')' : ''}`, `• Téléphone : ${d.tel}`, d.email && `• E-mail : ${d.email}`,
      d.secteur && `• ${d.profil === 'Établissement scolaire' ? 'Type' : 'Secteur'} : ${d.secteur}`, d.lieu && `• Lieu : ${d.lieu}`,
      d.postes && `• ${d.profil === 'Particulier' ? 'Appareil' : 'Ordinateurs'} : ${d.postes}`,
      d.situation && `• Situation : ${d.situation}`, d.besoins.length && `• ${d.profil === 'Particulier' ? 'Problème' : 'Besoin'} : ${d.besoins.join(', ')}`,
      d.accompagnement && `• Accompagnement : ${d.accompagnement}`, d.prestataire && `• Prestataire actuel : ${d.prestataire}`,
      d.depenses && `• Dépenses actuelles : ${d.depenses}`, d.moment && `• Meilleur moment : ${d.moment}`,
      d.message && `• Message : ${d.message}`, d.connu && `• A connu ZTi par : ${d.connu}`,
    ].filter(Boolean).join('\n');
    sessionStorage.setItem('zti-demande', JSON.stringify({ enregistree, texte: lignes, sujet: d.sujet, wa: form.dataset.wa, mail: form.dataset.mail }));
    location.href = form.dataset.merci;
  });
});

// envoi au serveur de ZTi (réponse vérifiée) ; ancienne adresse de script Google : envoi « à l'aveugle »
async function envoyerDemande(adresse, d) {
  try {
    if (/script\.google\.com/.test(adresse)) {
      await fetch(adresse, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(d) });
      return true;
    }
    const r = await fetch(adresse.replace(/\/$/, '') + '/v1/demandes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    return r.ok;
  } catch (_) { return false; } // réseau coupé : la demande part par WhatsApp
}

/* ---------- avis des clients ---------- */
$$('form[data-avis]').forEach(form => {
  const groupe = $('[data-choix="note"]', form), etoiles = $$('button', groupe);
  const noter = n => { etoiles.forEach((b, i) => { b.setAttribute('aria-checked', String(i + 1 === n)); b.classList.toggle('allumee', i < n); }); groupe.closest('.champ').classList.remove('invalide'); };
  etoiles.forEach((b, i) => b.addEventListener('click', () => noter(i + 1)));
  groupe.addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const i = etoiles.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1) + 5) % 5; etoiles[n].focus(); noter(n + 1);
  });
  const caseAccord = $('[data-case="accord"]', form);
  caseAccord.addEventListener('click', () => { caseAccord.setAttribute('aria-checked', String(caseAccord.getAttribute('aria-checked') !== 'true')); caseAccord.closest('.champ').classList.remove('invalide'); });
  $$('input, textarea', form).forEach(i => i.addEventListener('input', () => i.closest('.champ')?.classList.remove('invalide')));

  let envoye = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (envoye || form.elements.site_web.value) return; // déjà envoyé, ou robot
    const v = n => (form.elements[n]?.value || '').trim();
    const note = etoiles.findIndex(b => b.getAttribute('aria-checked') === 'true') + 1;
    const erreurs = [];
    const marque = (n, ok) => { const c = $(`[data-champ="${n}"]`, form); c?.classList.toggle('invalide', !ok); if (!ok) erreurs.push(c); };
    marque('note', note > 0);
    marque('nom', v('nom').length >= 2);
    marque('texte', v('texte').length >= 10);
    marque('accord', caseAccord.getAttribute('aria-checked') === 'true');
    const msg = $('.message-erreur', form);
    if (erreurs.length) { msg.textContent = 'Quelques informations manquent : elles sont signalées ci-dessus.'; msg.hidden = false; erreurs[0].querySelector('input, textarea, button')?.focus(); return; }
    msg.hidden = true;

    const d = {
      type: 'avis', date: new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' }),
      note, nom: v('nom'), organisation: v('organisation'), texte: v('texte'), tel: v('tel'),
      page: form.dataset.page || location.pathname, adresse: location.href.split('#')[0],
    };
    const bouton = $('button[type="submit"]', form); bouton.disabled = true; envoye = true;
    let enregistre = false;
    if (form.dataset.endpoint) {
      try { await fetch(form.dataset.endpoint, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(d) }); enregistre = true; } catch (_) { /* réseau coupé : l'avis part par WhatsApp */ }
    }
    const merci = $('.avis-merci', form.parentElement);
    const texteWa = [`Bonjour ZTi, voici mon avis (${note}/5) :`, d.texte, `— ${d.nom}${d.organisation ? ', ' + d.organisation : ''}`].join('\n');
    if (!enregistre) {
      $('[data-texte]', merci).textContent = 'Dernière étape : appuyez sur « Envoyer par WhatsApp », votre avis part déjà rédigé.';
      const wa = $('[data-wa]', merci);
      if (form.dataset.wa) { wa.href = `https://wa.me/${form.dataset.wa.replace(/\D/g, '')}?text=${encodeURIComponent(texteWa)}`; wa.hidden = false; }
    }
    form.hidden = true; merci.hidden = false; merci.focus?.();
  });
});

/* ---------- page « Merci » ---------- */
const merci = $('[data-merci-page]');
if (merci) {
  const d = JSON.parse(sessionStorage.getItem('zti-demande') || 'null');
  // la page ne s'affiche qu'après l'envoi d'un formulaire
  if (!d) location.replace(merci.dataset.accueil || '/');
  $$('[data-communaute]', merci).forEach(a => a.addEventListener('click', () => suivi('Contact', { method: a.dataset.communaute })));
  if (d) {
    if (!d.enregistree) {
      $('[data-etiquette]', merci).textContent = 'Dernière étape';
      $('[data-titre]', merci).textContent = 'Envoyez votre demande à ZTi.';
      $('[data-texte]', merci).textContent = 'Votre demande est prête. Appuyez sur « Écrire sur WhatsApp » : elle part déjà rédigée.';
    }
    const wa = $('[data-wa]', merci), mail = $('[data-mail]', merci);
    if (d.wa) { wa.href = `https://wa.me/${d.wa.replace(/\D/g, '')}?text=${encodeURIComponent(d.texte)}`; wa.hidden = false; }
    if (d.mail) { mail.href = `mailto:${d.mail}?subject=${encodeURIComponent(d.sujet + ' — demande depuis le site')}&body=${encodeURIComponent(d.texte)}`; mail.hidden = false; }
    wa.addEventListener('click', () => suivi('Contact', { method: 'whatsapp' }));
    mail.addEventListener('click', () => suivi('Contact', { method: 'email' }));
    $('[data-envoi]', merci).hidden = false;
  }
}

/* ---------- lueur des cartes qui suit la souris ---------- */
if (matchMedia('(hover: hover)').matches) {
  document.addEventListener('pointermove', e => {
    const c = e.target.closest?.('.carte'); if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}
