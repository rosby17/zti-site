// Fichiers du catalogue (logiciels de ZTi) : enregistrés sur le volume du serveur sous un nom aléatoire, jamais sous
// le nom envoyé ; liste blanche d'extensions ; resservis en pièce jointe (jamais affichés dans le navigateur).
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { mkdir, stat, writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, extname } from 'node:path';
import { config } from './config.js';

export const EXTENSIONS = ['.zip', '.exe', '.msi', '.7z', '.pdf'];
export const TAILLE_MAX = 300 * 1024 * 1024; // 300 Mo

const sur = n => /^[a-f0-9]{32}\.(zip|exe|msi|7z|pdf)$/.test(n);

export async function enregistrerFichier(fichier) {
  const ext = extname(fichier.name || '').toLowerCase();
  if (!EXTENSIONS.includes(ext)) throw Object.assign(new Error('Type de fichier refusé (accepté : ' + EXTENSIONS.join(', ') + ').'), { statut: 400 });
  if (fichier.size > TAILLE_MAX) throw Object.assign(new Error('Fichier trop lourd (300 Mo au plus).'), { statut: 413 });
  const octets = Buffer.from(await fichier.arrayBuffer());
  // contrôle du contenu réel (début du fichier), pas seulement de l'extension
  const signatures = { '.zip': [0x50, 0x4b], '.exe': [0x4d, 0x5a], '.msi': [0xd0, 0xcf, 0x11, 0xe0], '.7z': [0x37, 0x7a, 0xbc, 0xaf], '.pdf': [0x25, 0x50, 0x44, 0x46] };
  if (!signatures[ext].every((b, i) => octets[i] === b)) throw Object.assign(new Error('Le contenu du fichier ne correspond pas à son extension.'), { statut: 400 });
  await mkdir(config.dossierFichiers, { recursive: true });
  const nom = randomBytes(16).toString('hex') + ext;
  await writeFile(join(config.dossierFichiers, nom), octets, { mode: 0o640 });
  const propre = (fichier.name || 'fichier' + ext).normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(0, 100);
  return { fichier: nom, fichier_nom: propre, taille: octets.length };
}

export async function supprimerFichier(nom) {
  if (sur(nom)) await unlink(join(config.dossierFichiers, nom)).catch(() => {});
}

export async function servirFichier(c, nom, nomPropose) {
  if (!sur(nom)) return c.json({ erreur: 'Introuvable.' }, 404);
  const chemin = join(config.dossierFichiers, nom);
  const infos = await stat(chemin).catch(() => null);
  if (!infos) return c.json({ erreur: 'Fichier indisponible.' }, 404);
  const propre = String(nomPropose || nom).replace(/["\\\r\n]/g, '');
  c.header('Content-Type', 'application/octet-stream');
  c.header('Content-Length', String(infos.size));
  c.header('Content-Disposition', `attachment; filename="${propre}"`);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "sandbox; default-src 'none'");
  c.header('Cache-Control', 'no-store');
  return c.body(Readable.toWeb(createReadStream(chemin)));
}
