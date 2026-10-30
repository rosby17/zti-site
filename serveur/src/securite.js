// Sécurité commune : mots de passe, jetons de session, limites anti-abus, empreinte anonyme des visiteurs,
// contrôle des saisies et en-têtes HTTP.
import { scrypt, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scryptP = promisify(scrypt);
const N = 32768, R = 8, P = 1, LONGUEUR = 64, MEMOIRE = 64 * 1024 * 1024;

// ——— mots de passe (scrypt, sel aléatoire, comparaison à temps constant) ———
export async function hacher(motDePasse) {
  const sel = randomBytes(16);
  const empreinte = await scryptP(motDePasse.normalize('NFKC'), sel, LONGUEUR, { N, r: R, p: P, maxmem: MEMOIRE });
  return `scrypt$${N}$${R}$${P}$${sel.toString('base64url')}$${empreinte.toString('base64url')}`;
}

// empreinte factice : même durée de calcul quand l'e-mail n'existe pas (on ne révèle pas quels comptes existent)
let factice;
export async function verifier(motDePasse, stocke) {
  factice ??= await hacher('mot-de-passe-factice-' + randomBytes(8).toString('hex'));
  const [algo, n, r, p, sel, attendu] = String(stocke || factice).split('$');
  if (algo !== 'scrypt') return false;
  const calcule = await scryptP(String(motDePasse).normalize('NFKC'), Buffer.from(sel, 'base64url'), LONGUEUR,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MEMOIRE });
  const ok = timingSafeEqual(calcule, Buffer.from(attendu, 'base64url'));
  return ok && !!stocke;
}

// mot de passe provisoire lisible (pas de caractères ambigus), 16 caractères
export function motDePasseProvisoire() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const octets = randomBytes(16);
  let s = '';
  for (const o of octets) s += alphabet[o % alphabet.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
}

export const regleMotDePasse = m => typeof m === 'string' && m.length >= 10 && m.length <= 200;

// ——— jetons de session : seul le sha256 est gardé en base ———
export const nouveauJeton = () => randomBytes(32).toString('base64url');
export const empreinteJeton = j => createHash('sha256').update(String(j)).digest('hex');

// ——— adresse du visiteur (pour les limites seulement, jamais enregistrée) ———
export function adresseIp(c) {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = (c.req.header('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean);
  return xff.at(-1) || c.env?.incoming?.socket?.remoteAddress || 'inconnue';
}

// empreinte anonyme du jour : HMAC(secret, jour + adresse + navigateur). Change chaque jour, impossible à inverser,
// ne permet pas de suivre une personne d'un jour à l'autre (mesure d'audience sans cookie).
export function empreinteVisiteur(c, jour = new Date().toISOString().slice(0, 10)) {
  const secret = config.secretVisites || 'secret-de-developpement-local-uniquement-0000';
  return createHmac('sha256', secret)
    .update(`${jour}|${adresseIp(c)}|${c.req.header('user-agent') || ''}`)
    .digest('base64url').slice(0, 22);
}

// ——— limites anti-abus (en mémoire, par adresse et par action) ———
const compteurs = new Map();
export function limiter(cle, max, fenetreMs) {
  const maintenant = Date.now();
  const e = compteurs.get(cle);
  if (!e || e.fin < maintenant) { compteurs.set(cle, { n: 1, fin: maintenant + fenetreMs }); return true; }
  e.n += 1;
  return e.n <= max;
}
setInterval(() => { const m = Date.now(); for (const [k, e] of compteurs) if (e.fin < m) compteurs.delete(k); }, 60_000).unref();
export const viderLimites = () => compteurs.clear();

// ——— saisies ———
// texte : chaîne, sans caractères de contrôle (sauf retours à la ligne), espaces en trop retirés, longueur limitée
export function texte(v, max = 200) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}
export const estUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const estEmail = v => typeof v === 'string' && v.length <= 160 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v);
// téléphone camerounais : 9 chiffres commençant par 6 ou 2, avec ou sans +237
export function telephone(v) {
  const c = String(v || '').replace(/\D/g, '').replace(/^00/, '').replace(/^237(?=\d{9}$)/, '');
  return /^[62]\d{8}$/.test(c) ? '+237 ' + c.replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5') : '';
}
// domaine seul d'une adresse de provenance (jamais le chemin ni les paramètres)
export function domaine(v) {
  try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').slice(0, 120) : ''; } catch { return ''; }
}
export function appareil(ua = '') {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|(Android(?!.*Mobile))/i.test(ua)) return 'tablette';
  if (/Mobi|iPhone|iPod|Android|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  return ua ? 'ordinateur' : '';
}

// ——— en-têtes de sécurité ———
export function entetesSecurite(c, csp = true) {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.production) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (csp) c.header('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
}
