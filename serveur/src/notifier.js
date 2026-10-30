// E-mails de ZTi, envoyés par Brevo (comme nos autres plateformes) : alertes à l'équipe, accusé de réception
// au client, e-mails écrits depuis la fiche d'un client. Sans clé Brevo, rien ne part (tout reste dans le back-office).
// Les données des visiteurs sont toujours échappées avant d'entrer dans le HTML.
import { config } from './config.js';
import { sql } from './db.js';

export const echapper = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// mise en page simple aux couleurs de ZTi (le texte est échappé, puis les retours à la ligne deviennent <br>)
function html(texte) {
  const corps = echapper(texte).replace(/\n/g, '<br>');
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#F4F6FA;font-family:Arial,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #E3E8F6;border-radius:16px;overflow:hidden">
<div style="background:#02008A;color:#fff;padding:18px 24px;font-weight:700;font-size:18px">ZTi</div>
<div style="padding:24px;font-size:15px;line-height:1.6">${corps}</div></div></body></html>`;
}

export async function envoyer({ a, sujet, texte, repondreA }) {
  const destinataires = (Array.isArray(a) ? a : [a]).filter(Boolean);
  if (!config.brevo || !config.expediteurEmail || !destinataires.length) return { ok: false, raison: 'E-mails non configurés' };
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.brevo, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: config.expediteurEmail, name: config.expediteurNom },
        to: destinataires.map(email => ({ email })),
        ...(repondreA ? { replyTo: { email: repondreA } } : {}),
        subject: String(sujet).replace(/[\r\n]+/g, ' ').slice(0, 180),
        textContent: texte,
        htmlContent: html(texte),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { ok: false, raison: `Brevo ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, raison: e.message };
  }
}

export async function reglage(cle) {
  const [r] = await sql`select valeur from reglages where cle = ${cle}`;
  return r?.valeur ?? null;
}

// alerte à l'équipe ZTi (nouvelle demande, nouvel avis)
export async function alerter(genre, sujet, lignes) {
  const r = await reglage('alertes');
  if (!r || r[genre] === false) return;
  const res = await envoyer({ a: r.destinataires || [], sujet, texte: lignes.filter(x => typeof x === 'string').join('\n') });
  if (!res.ok && config.brevo) console.error('Alerte non envoyée :', res.raison);
}

// remplace {prenom}, {nom}, {organisation} dans un modèle
export function remplir(modele, d) {
  const prenom = String(d.nom || '').trim().split(/\s+/).at(-1) || '';
  return String(modele || '').replace(/\{(prenom|nom|organisation)\}/g, (_, k) => ({ prenom, nom: d.nom || '', organisation: d.organisation || '' }[k]));
}

// accusé de réception automatique au client (s'il a donné son e-mail)
export async function accuserReception(d) {
  if (!d.email) return;
  const m = await reglage('accuse_demande');
  if (!m?.actif) return;
  const alertes = await reglage('alertes');
  await envoyer({ a: d.email, sujet: remplir(m.sujet, d), texte: remplir(m.texte, d), repondreA: alertes?.destinataires?.[0] });
}
