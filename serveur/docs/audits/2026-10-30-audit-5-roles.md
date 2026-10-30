# Audit de sécurité ZTi — 30/10/2026 (avant ouverture du serveur)

**Méthode :** `REFERENTIEL/methode-audit.md`, 5 rôles en parallèle, en boîte blanche, en lecture seule (authentification, logique métier, API publiques, injections, DevSecOps), sur la branche `v2-serveur` de `zeltuminitiative-com/zti-site`. Chaque constat a été relu dans le code avant d'être retenu.

**Verdict pour la direction :** aucune injection SQL ni XSS exploitable, aucun secret dans l'historique, 0 vulnérabilité dans les dépendances. Les risques trouvés sont des abus (robots, spam d'e-mails, triche aux points) : 2 critiques et 9 élevés, tous corrigés le jour même (commit `a750f45`). 39 tests automatiques les verrouillent, et ils tournent maintenant à chaque modification (GitHub Actions). Reste à faire avant ou juste après l'ouverture : la double authentification des administrateurs, la vérification de l'e-mail des ambassadeurs, les sauvegardes et le pare-feu Cloudflare (INF-01).

| Id | Gravité | Constat | Statut |
|---|---|---|---|
| B-01 | 🔴 | Adresse IP falsifiable (`cf-connecting-ip` cru sans condition) : toutes les limites contournables | Corrigé (`DERRIERE_CLOUDFLARE=1` requis) + test |
| B-02 | 🔴 | Accusé de réception détournable : e-mail piégé signé ZTi vers n'importe quelle adresse | Corrigé (lettres seulement, refus si lien, 1/24 h par adresse, plafond global) + test |
| B-03 | 🟠 | « Mot de passe oublié » : harcèlement d'une boîte, limite par IP seulement | Corrigé (3/h par e-mail, un seul lien valable, envoi sans attente) + test |
| B-04 | 🟠 | Saturation par scrypt (32 Mo par calcul, file sans limite) | Corrigé (4 calculs à la fois, sinon 503) |
| B-05 | 🟠 | Mémoire du limiteur sans plafond | Corrigé (100 000 clés) |
| B-06 | 🟠 | Table `visites` sans plafond ni purge | Corrigé (120/min par IP, 3 000/min au total, purge 13 mois) |
| C-01 | 🟠 | Un membre de l'équipe non admin pouvait passer « client » une fiche recommandée et accorder des échanges | Corrigé (admin seulement) + test |
| C-02 | 🟠 | Points crédités dès le simple rappel (fausses demandes rentables) | Corrigé (au rendez-vous ou au devis) + test |
| C-03 | 🟠 | Même filleul recommandé plusieurs fois = points plusieurs fois | Corrigé (une fois par téléphone) + test |
| E-01 | 🟠 | Application avec un superutilisateur PostgreSQL | Corrigé dans le code (`DATABASE_URL_MIGRATION` séparé) ; rôle `zti_app` à créer au déploiement |
| E-02 | 🟠 | Aucune sauvegarde prévue | **À faire au déploiement** (sauvegarde Coolify planifiée + test de restauration) |
| A-01 | 🟡 | Pas de double authentification sur le tableau de bord (référentiel §3) | **Ouvert** |
| A-02 | 🟡 | Inscription ambassadeur sans vérification de l'e-mail | **Ouvert** (points de bienvenue à 0 en attendant) |
| A-03 | 🟡 | Énumération des comptes ambassadeurs (409 à l'inscription) | Partiel (oubli corrigé ; inscription acceptée pour la simplicité) |
| A-04 | 🟡 | Blocage de la connexion d'autrui (5 essais par e-mail) | Corrigé (compteur e-mail + adresse) |
| D-01 | 🟡 | Faux liens glissés dans les alertes de l'équipe | Corrigé (une ligne par champ, vrai lien en tête) |
| E-03 | 🟡 | Aucune durée de conservation (loi 2024/017) | Corrigé (purge nocturne) ; durées à écrire dans la politique de confidentialité |
| E-04 | 🟡 | Démarrage possible avec des réglages manquants en production | Corrigé |
| E-05 | 🟡 | `.gitignore` sans `.env*` ni fichiers du serveur (dépôt public) | Corrigé |
| E-06 | 🟡 | Tests du serveur absents de la CI | Corrigé (`tests-serveur.yml`) |
| C-04 | 🟡 | Campagnes modifiables par un non-admin ; statistiques faussables (campagnes fantômes) | Corrigé (admin ; campagnes inconnues sans demande ignorées) |
| D-02 | 🔵 | Liens et HTML venus du back-office non filtrés sur le site | Corrigé (`https:`/`mailto:`/`tel:` ; HTML brut ignoré) |
| E-07 | 🔵 | En-têtes incomplets sur l'API, journaux avec `detail` PostgreSQL | Corrigé |
| — | 🔵 | Image Docker non épinglée par digest, CSP du site public, purge des sessions | Partiel / à faire |
