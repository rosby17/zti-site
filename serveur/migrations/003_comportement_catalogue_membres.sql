-- 1. Comportement des visiteurs : défilement, sections vues, clics, temps passé, étapes des formulaires.
-- 2. Catalogue (logiciels, et plus tard formations, services, boutique) et téléchargements.
-- 3. Espace membre : ambassadeurs, code de recommandation, points de fidélité (registre), récompenses.

-- ——— 1. comportement ———
alter table visites drop constraint if exists visites_evenement_check;
alter table visites add constraint visites_evenement_check check (evenement in (
  'vue', 'defilement', 'section', 'clic', 'sortie', 'formulaire', 'etape2', 'demande', 'avis',
  'whatsapp', 'communaute', 'appel', 'telechargement', 'inscription'));
alter table visites add column valeur integer;              -- profondeur de défilement (%), temps passé (s), n° d'étape…
alter table visites add column cible text not null default ''; -- section atteinte, bouton cliqué, formulaire…
alter table visites add column parrain text not null default ''; -- code d'ambassadeur présent dans le lien
create index visites_chemin on visites (chemin, cree_le);
create index visites_visite on visites (visiteur, cree_le);

-- ——— 2. catalogue ———
create table produits (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'logiciel' check (type in ('logiciel', 'formation', 'service', 'materiel')),
  categorie text not null default 'outil' check (categorie in ('assistance', 'outil', 'formation', 'autre')),
  nom text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  resume text not null default '',
  description text not null default '',
  prix integer check (prix is null or prix >= 0),            -- null = gratuit ; en F CFA
  lien_externe text not null default '',                      -- page officielle de téléchargement (logiciel d'un éditeur)
  fichier text not null default '',                           -- nom du fichier enregistré sur le serveur (jamais choisi par l'utilisateur)
  fichier_nom text not null default '',                       -- nom proposé au téléchargement
  taille bigint,
  version text not null default '',
  systeme text not null default '',                           -- Windows, macOS, Android…
  publie boolean not null default false,
  ordre integer not null default 50,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table telechargements (
  id bigint generated always as identity primary key,
  produit_id uuid not null references produits (id) on delete cascade,
  cree_le timestamptz not null default now(),
  visiteur text not null default '',
  membre_id uuid
);
create index telechargements_produit on telechargements (produit_id, cree_le);

-- logiciels d'assistance à distance (pages officielles des éditeurs) ; outils ZTi en brouillon, à compléter par ZTi
insert into produits (type, categorie, nom, slug, resume, lien_externe, systeme, publie, ordre) values
  ('logiciel', 'assistance', 'AnyDesk', 'anydesk', 'Pour que ZTi prenne la main sur votre ordinateur à distance, avec votre accord. Donnez-nous le code affiché.', 'https://anydesk.com/fr/downloads', 'Windows, macOS, Android, iPhone', true, 1),
  ('logiciel', 'assistance', 'RustDesk', 'rustdesk', 'Logiciel d''assistance à distance gratuit et libre.', 'https://rustdesk.com/fr/', 'Windows, macOS, Linux, Android', true, 2),
  ('logiciel', 'assistance', 'TeamViewer QuickSupport', 'teamviewer-quicksupport', 'Version simple de TeamViewer pour recevoir de l''aide à distance.', 'https://www.teamviewer.com/fr/telechargement/', 'Windows, macOS, Android, iPhone', true, 3),
  ('logiciel', 'outil', 'ZTi Restauration des fichiers cachés', 'zti-restauration-fichiers-caches', 'Fait réapparaître les fichiers rendus invisibles par un virus sur une clé USB ou un disque dur.', '', 'Windows', false, 10),
  ('logiciel', 'outil', 'ZTi Mise en veille prolongée', 'zti-mise-en-veille-prolongee', 'Éteint complètement l''ordinateur en gardant la session ouverte : pensé pour les coupures de courant.', '', 'Windows', false, 11),
  ('logiciel', 'outil', 'ZTi Arrêt 5S', 'zti-arret-5s', 'Règle en cinq secondes les redémarrages en boucle au moment d''éteindre.', '', 'Windows', false, 12);

-- ——— 3. espace membre et ambassadeurs ———
create table membres (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  email text not null,
  tel text not null default '',
  mot_de_passe text not null,
  code text not null,                                         -- code de recommandation (dans le lien ?ref=code)
  parrain_id uuid references membres (id) on delete set null, -- posé une seule fois, à l'inscription
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  derniere_connexion timestamptz
);
create unique index membres_email on membres (lower(email));
create unique index membres_code on membres (lower(code));

create table sessions_membres (
  empreinte text primary key,
  membre_id uuid not null references membres (id) on delete cascade,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null
);

-- demandes de nouveau mot de passe (jeton haché, valable 1 heure, à usage unique)
create table jetons_membres (
  empreinte text primary key,
  membre_id uuid not null references membres (id) on delete cascade,
  expire_le timestamptz not null,
  utilise boolean not null default false
);

-- la demande d'un filleul garde le code de son ambassadeur
alter table demandes add column parrain_id uuid references membres (id) on delete set null;
create index demandes_parrain on demandes (parrain_id);

-- registre des points : jamais modifié ; le solde est toujours la somme des lignes
create table points (
  id bigint generated always as identity primary key,
  membre_id uuid not null references membres (id) on delete cascade,
  points integer not null,
  motif text not null check (motif in ('bienvenue', 'recommandation', 'client', 'bonus', 'echange', 'echange_refuse', 'correction')),
  detail text not null default '',
  demande_id uuid references demandes (id) on delete set null,
  echange_id uuid,
  auteur_id uuid references equipe (id) on delete set null,
  cree_le timestamptz not null default now()
);
create index points_membre on points (membre_id, cree_le);
-- jamais deux fois les mêmes points pour la même demande
create unique index points_une_fois on points (demande_id, motif) where demande_id is not null;

create table echanges (
  id uuid primary key default gen_random_uuid(),
  membre_id uuid not null references membres (id) on delete cascade,
  recompense text not null,
  points integer not null check (points > 0),
  statut text not null default 'demande' check (statut in ('demande', 'accorde', 'refuse')),
  cree_le timestamptz not null default now(),
  traite_le timestamptz,
  traite_par uuid references equipe (id) on delete set null,
  note text not null default ''
);

insert into reglages (cle, valeur) values ('fidelite', jsonb_build_object(
  'actif', true,
  'points_bienvenue', 0,
  'points_recommandation', 10,   -- quand ZTi confirme la demande d'un filleul (état « Rappelée » ou plus)
  'points_client', 100,          -- quand le filleul devient client
  'recompenses', jsonb_build_array(
    jsonb_build_object('nom', 'Nettoyage complet d''un ordinateur', 'points', 200),
    jsonb_build_object('nom', 'Diagnostic et entretien d''une clé USB ou d''un disque', 'points', 150),
    jsonb_build_object('nom', 'Réduction de 10 000 F sur une intervention', 'points', 300))
)) on conflict (cle) do nothing;
