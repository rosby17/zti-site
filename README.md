# Site ZTi

Site d'entreprise de ZTi SARL (Zèl Tum Initiative), publié gratuitement sur GitHub Pages :
`https://zeltuminitiative-com.github.io/`. L'équipe ZTi le modifie elle-même dans **Pages CMS**, sans toucher au code.
Plan complet et étapes suivantes : [PLAN.md](PLAN.md).

## Pour l'équipe ZTi : modifier le site

1. Ouvrir https://app.pagescms.org, se connecter avec le compte GitHub de ZTi, choisir le dépôt du site et la branche `source`.
2. Dans le menu de gauche :
   - **Pages de campagne** : une page par offre, à l'adresse `/offres/<nom>/`. C'est ce lien qu'on met dans une publicité.
     « Nouveau » crée une campagne. On l'assemble en ajoutant des **sections** (accroche, texte et image, cartes, calculateur,
     packs, preuve, références, questions fréquentes, formulaire, signature, bandeau avec bouton), dans l'ordre voulu.
     Case « En ligne » décochée = brouillon invisible.
   - **Pages du site** : accueil, à propos, contact, politique de confidentialité (mêmes sections).
   - **Services** : un service par fiche ; case « En ligne », ordre d'affichage, publics, page de campagne liée.
   - **Réglages du site** : contacts, menu, bouton du haut, réseaux sociaux, adresse du script Google, pixel Meta.
   - **Références** : les logos des clients.
3. « Enregistrer » : le site se remet à jour tout seul en 1 à 2 minutes.

Pour suivre une publicité : ajouter à la fin du lien `?utm_source=facebook&utm_campaign=<nom de la pub>`.
Ces informations arrivent avec chaque demande dans le CRM Notion.

## Les demandes, le suivi des clients et le tableau de bord

Le site (pages fixes, Cloudflare Pages ou GitHub Pages) envoie tout au **serveur de ZTi** (dossier `serveur/`, hébergé
sur Coolify) : demandes des quatre formulaires (général, écoles, entreprises en 3 étapes, diagnostic en ligne des
particuliers), avis, mesure d'audience maison (sans cookie), téléchargements et espace ambassadeurs.
L'adresse du serveur se règle dans **Réglages du site › Adresse du serveur ZTi**. Tant qu'elle est vide, la demande part
par WhatsApp (message déjà rédigé).

- Tableau de bord de l'équipe : `<serveur>/admin/` (suivi des clients, comportement des visiteurs, campagnes, avis,
  ambassadeurs, catalogue, équipe, e-mails).
- Espace ambassadeurs : `<serveur>/espace/` (lien de recommandation `?ref=code`, points, récompenses).
- Détails techniques, sécurité et installation : [serveur/README.md](serveur/README.md).

## Pour le développeur

- **Astro 7**, pages fixes, sans serveur. `npm install`, puis `npm run dev` (aperçu), `npm run build` (dossier `dist/`).
- `npm run verifier` : contrôle que chaque fichier de `contenu/` se lit (lancé aussi avant chaque publication).
- Contenus : `contenu/` (Markdown + YAML, modifiés par Pages CMS d'après [.pages.yml](.pages.yml)) ; images : `public/images/`.
- Sections : `src/components/sections/` (un fichier par type de bloc ; liste dans `src/components/Sections.astro`).
  Un nouveau type de section se déclare à trois endroits : le composant, `Sections.astro` et les `blocks` de `.pages.yml`.
- Comportements (menu, formulaire, calculateur, visionneuse) : `src/scripts/site.js`. Styles : `src/styles/zti.css`.
- Publication : [.github/workflows/publier.yml](.github/workflows/publier.yml). Le code et les contenus sont sur la branche
  **`source`** (c'est elle que Pages CMS modifie) ; le programme construit le site et range les pages prêtes sur **`main`**,
  que GitHub Pages affiche telle quelle. Il tourne à chaque modification de `source`, chaque nuit à 00 h 05 (heure de Yaoundé,
  pour les saisons programmées de l'étape 2) et à la demande. Aucun réglage administrateur : un accès « Write » au dépôt suffit.
  Dépôt `zeltuminitiative-com.github.io` → site à la racine `https://zeltuminitiative-com.github.io/` ; autre dépôt → sous
  `/<nom du dépôt>/` (calculé tout seul).

## Règles à respecter

- **Couleurs** : uniquement les bleus de la charte ZTi, le noir et le blanc (variables en tête de `src/styles/zti.css`).
- **Aucun contrôle natif du navigateur** : choix en boutons, case à cocher maison, fenêtres maison.
- **Textes** : chaque information vient des documents de ZTi ; aucun chiffre ni témoignage inventé ; la durée de vie des postes
  n'est jamais garantie ; la grille tarifaire n'est jamais affichée (seul le calculateur s'en sert).
- **Attestations** : seules les copies filigranées « Confidentiel » sont publiées.
- **Contacts** : l'e-mail et l'adresse sont affichés ; le numéro WhatsApp n'apparaît qu'après l'envoi du formulaire.

© Zèl Tum Initiative SARL (ZTi SARL). Tous droits réservés.
