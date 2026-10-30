-- Base de données de ZTi : demandes du site (suivi des clients), avis, visites (mesure d'audience maison),
-- campagnes publicitaires, équipe ZTi et sessions du back-office.
-- Aucun accès direct depuis Internet : seule l'API (serveur/) lit et écrit, avec un rôle dédié.

create extension if not exists pgcrypto;

-- ——— équipe ZTi (comptes du back-office) ———
create table equipe (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  nom text not null,
  role text not null default 'membre' check (role in ('admin', 'membre')),
  mot_de_passe text not null,                 -- scrypt$N$r$p$sel$empreinte
  actif boolean not null default true,
  doit_changer boolean not null default true, -- mot de passe provisoire à changer à la 1re connexion
  cree_le timestamptz not null default now(),
  derniere_connexion timestamptz
);
create unique index equipe_email on equipe (lower(email));

create table sessions (
  empreinte text primary key,                 -- sha256 du jeton (le jeton lui-même n'est jamais stocké)
  membre_id uuid not null references equipe (id) on delete cascade,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null
);
create index sessions_membre on sessions (membre_id);

-- ——— campagnes publicitaires ———
create table campagnes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,60}$'),  -- valeur de utm_campaign
  source text not null default 'facebook',    -- utm_source
  support text not null default 'paid',       -- utm_medium
  page text not null default '/',             -- page d'arrivée
  budget integer check (budget is null or budget >= 0),  -- F CFA
  debut date,
  fin date,
  notes text not null default '',
  cree_le timestamptz not null default now()
);

-- ——— demandes du site = fiches de suivi des clients ———
create table demandes (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  mis_a_jour_le timestamptz not null default now(),
  etat text not null default 'nouvelle'
    check (etat in ('nouvelle', 'rappelee', 'rendez_vous', 'devis', 'client', 'sans_suite')),
  responsable_id uuid references equipe (id) on delete set null,
  relance_le date,
  montant integer check (montant is null or montant >= 0),  -- devis ou contrat, F CFA
  -- ce que la personne a rempli
  sujet text not null default '',
  profil text not null default '',
  organisation text not null default '',
  secteur text not null default '',
  nom text not null,
  fonction text not null default '',
  tel text not null,
  email text not null default '',
  lieu text not null default '',
  postes text not null default '',
  situation text not null default '',
  besoins text[] not null default '{}',
  accompagnement text not null default '',
  prestataire text not null default '',
  depenses text not null default '',
  moment text not null default '',
  message text not null default '',
  connu text not null default '',
  -- d'où elle vient
  page text not null default '',
  campagne text not null default '',
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  utm_content text not null default '',
  referent text not null default '',
  visiteur text not null default ''
);
create index demandes_etat on demandes (etat, cree_le desc);
create index demandes_date on demandes (cree_le desc);
create index demandes_campagne on demandes (utm_campaign);

-- notes et historique d'une fiche (changements d'état compris)
create table notes (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references demandes (id) on delete cascade,
  auteur_id uuid references equipe (id) on delete set null,
  genre text not null default 'note' check (genre in ('note', 'etat', 'appel', 'whatsapp', 'email', 'visite')),
  texte text not null,
  cree_le timestamptz not null default now()
);
create index notes_demande on notes (demande_id, cree_le);

-- ——— avis des clients (publiés seulement après validation par ZTi) ———
create table avis (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'publie', 'refuse')),
  note smallint not null check (note between 1 and 5),
  nom text not null,
  organisation text not null default '',
  texte text not null,
  tel text not null default '',               -- jamais publié
  page text not null default '',
  modere_par uuid references equipe (id) on delete set null,
  modere_le timestamptz
);
create index avis_statut on avis (statut, cree_le desc);

-- ——— mesure d'audience maison (sans cookie, sans adresse IP stockée) ———
create table visites (
  id bigint generated always as identity primary key,
  cree_le timestamptz not null default now(),
  evenement text not null default 'vue'
    check (evenement in ('vue', 'etape2', 'demande', 'avis', 'whatsapp', 'communaute', 'appel')),
  chemin text not null,
  referent text not null default '',          -- domaine d'origine seulement
  utm_source text not null default '',
  utm_medium text not null default '',
  utm_campaign text not null default '',
  utm_content text not null default '',
  visiteur text not null,                     -- empreinte du jour (change chaque jour, non réversible)
  appareil text not null default '' check (appareil in ('', 'mobile', 'tablette', 'ordinateur')),
  pays text not null default ''
);
create index visites_date on visites (cree_le);
create index visites_campagne on visites (utm_campaign, cree_le);

-- ——— suivi des migrations ———
create table if not exists migrations (nom text primary key, appliquee_le timestamptz not null default now());
