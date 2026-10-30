# Serveur de ZTi

Base de données PostgreSQL + API + tableau de bord de l'équipe + espace ambassadeurs. Le site public (pages fixes) l'appelle
pour les formulaires, les avis, la mesure d'audience, les téléchargements et les recommandations.

## Ce qu'il fait

| Adresse | Pour qui | Rôle |
|---|---|---|
| `/v1/demandes`, `/v1/avis`, `/v1/visites`, `/v1/produits`, `/v1/telecharger/:slug` | le site public | formulaires, avis, mesure d'audience sans cookie, catalogue |
| `/admin/` + `/v1/admin/*` | l'équipe ZTi | suivi des clients, comportement des visiteurs, campagnes, avis, ambassadeurs, catalogue, équipe, e-mails |
| `/espace/` + `/v1/membres/*` | les ambassadeurs | compte, lien `?ref=code`, points, récompenses |

## Réglages (variables d'environnement, dans Coolify)

| Variable | Exemple | Rôle |
|---|---|---|
| `DATABASE_URL` | `postgres://…` | base PostgreSQL (ressource Coolify du même projet) |
| `ADRESSE_PUBLIQUE` | `https://api.ztisystem.com` | adresse de ce serveur (contrôle d'origine, liens des e-mails) |
| `ORIGINES_AUTORISEES` | `https://zti-site.pages.dev,https://zeltuminitiative-com.github.io` | sites autorisés à appeler l'API |
| `SITE_PUBLIC` | `https://zti-site.pages.dev` | adresse du site (liens de recommandation, campagnes) |
| `SECRET_VISITES` | 48 caractères aléatoires | empreinte anonyme du jour des visiteurs |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | | e-mails (facultatif : sans eux, rien ne part) |
| `NODE_ENV` | `production` | cookies `__Host-` sécurisés, HSTS |

Volume persistant : `/donnees` (fichiers des logiciels du catalogue).

## Premier compte du tableau de bord

```bash
node src/creer-membre.js adresse@exemple.com "Nom Prénom" admin
```

Affiche un mot de passe provisoire, à changer à la première connexion.

## Sécurité (résumé)

- Mots de passe scrypt ; jetons de session aléatoires dont seule l'empreinte est en base ; cookies `__Host-`, HttpOnly,
  SameSite=Strict ; contrôle d'origine sur toute action (anti-CSRF) ; limites anti-abus (connexion, formulaires, échanges).
- Requêtes SQL toujours paramétrées ; saisies coupées et nettoyées ; export tableur neutralisé (`=`, `+`, `-`, `@`).
- Tableau de bord et espace membre servis avec une politique de sécurité stricte (aucun script ni style extérieur).
- Points de fidélité en registre (jamais modifiés, solde = somme), une seule fois par demande (index unique),
  échange sous verrou (pas de double dépense), jamais d'auto-parrainage.
- Fichiers du catalogue : liste blanche d'extensions, contrôle du contenu réel, nom aléatoire, resservis en pièce jointe.
- Mesure d'audience sans cookie ni adresse IP stockée (empreinte du jour, non réversible).

## Tests

```bash
DATABASE_URL=postgres://… npm test   # base de test jetable : elle est vidée
```
