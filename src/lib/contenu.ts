// Lecture des contenus (contenu/) et petites aides communes aux pages.
import { getCollection, getEntry } from 'astro:content';
import { marked } from 'marked';

export type Reglages = {
  nom: string;
  nom_legal: string;
  slogan: string;
  signature: string;
  depuis: string;
  description: string;
  contact: { email: string; whatsapp: string; telephone: string; adresse: string; horaires: string };
  reseaux: { nom: string; adresse: string }[];
  communaute?: { facebook?: string; whatsapp?: string };
  menu: { texte: string; lien: string }[];
  bouton_principal: { texte: string; lien: string };
  mesures: { endpoint: string; pixel: string };
};

export type Reference = { nom: string; logo: string; ordre?: number };

export async function reglages(): Promise<Reglages> {
  const e = await getEntry('reglages', 'site');
  if (!e) throw new Error('contenu/reglages/site.yml manquant');
  return e.data as unknown as Reglages;
}

export async function references(): Promise<Reference[]> {
  const e = await getEntry('reglages', 'references');
  const liste = ((e?.data as { references?: Reference[] })?.references ?? []).filter(r => r.nom && r.logo);
  return liste.sort((a, b) => (a.ordre ?? 50) - (b.ordre ?? 50));
}

export type Avis = { nom: string; organisation?: string; note: number; texte: string; date?: string; afficher?: boolean };

// avis validés par ZTi, les plus récents d'abord
export async function avis(): Promise<Avis[]> {
  const e = await getEntry('reglages', 'avis');
  const liste = ((e?.data as { avis?: Avis[] })?.avis ?? []).filter(a => a.afficher !== false && a.nom && a.texte);
  return liste
    .map(a => ({ ...a, note: Math.min(5, Math.max(1, Math.round(Number(a.note) || 5))) }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export async function services() {
  const tous = await getCollection('services', s => s.data.en_ligne);
  return tous.sort((a, b) => a.data.ordre - b.data.ordre || a.data.titre.localeCompare(b.data.titre, 'fr'));
}

// texte saisi dans Pages CMS (Markdown) → HTML. Les contenus viennent de l'équipe ZTi, pas des visiteurs.
export const md = (texte?: unknown) => (texte ? (marked.parse(String(texte), { async: false }) as string) : '');
export const mdLigne = (texte?: unknown) => (texte ? (marked.parseInline(String(texte), { async: false }) as string) : '');

// adresse interne → adresse complète du site (base comprise)
export const lien = (chemin?: string) => {
  if (!chemin) return '/';
  if (/^(https?:|mailto:|tel:|#)/.test(chemin)) return chemin;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base + (chemin.startsWith('/') ? chemin : '/' + chemin);
};

export const PUBLICS: Record<string, string> = {
  ecoles: 'Écoles',
  entreprises: 'Entreprises',
  institutions: 'Institutions',
  particuliers: 'Particuliers',
};

// icône d'un réseau social d'après son nom (Google Maps, Facebook, X…)
export function iconeReseau(nom: string): string {
  const n = nom.toLowerCase().trim();
  if (n.includes('maps') || n.includes('google')) return 'carte';
  if (n === 'x' || n.includes('twitter')) return 'x';
  return ['facebook', 'linkedin', 'instagram', 'tiktok', 'youtube', 'whatsapp'].find(r => n.includes(r)) || 'lien';
}
