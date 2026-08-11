# Tennis Web Manager

Jeu de gestion de tennis en navigateur, inspiré des règles du jeu "Tennis Web Tour" (règles PDF fournies par l'utilisateur en cours de projet — non jointes ici, mais tous les mécanismes ci-dessous en découlent). L'utilisateur incarne un coach qui gère un joueur ATP et une joueuse WTA créés à l'inscription.

## Stack technique

- Backend : Node.js + Express (server.js)
- Base de données : SQLite via better-sqlite3 (database.js)
- Mots de passe : bcrypt
- Authentification : vraie session serveur (2026-08-11) — cookie httpOnly signé (`session_token`) posé à la connexion/inscription, vérifié par le middleware `authentifier` (server.js) sur toutes les routes `/api/*` sauf une liste explicite de routes publiques (`estRoutePublique`). Table `sessions` (token/user_id/expiration, 30 jours). Toutes les routes lisent désormais l'identité de l'appelant depuis `req.userId` (posé par le middleware) et non plus depuis un `userId` envoyé par le client — plus aucune route ne fait confiance à un id fourni par le frontend pour l'identité de l'appelant
- E-mails transactionnels (réinitialisation de mot de passe) : Resend, clé dans `.env` (`RESEND_API_KEY`, `SITE_URL`) via `dotenv` — voir `.env.example`. Tant que `RESEND_API_KEY` est vide, le lien de réinitialisation est juste affiché dans la console du serveur au lieu d'être envoyé (aucun crash, le reste du jeu fonctionne normalement)
- Frontend : HTML/CSS/JS vanilla, multi-pages, pas de framework, pas de build tool, aucun fichier JS partagé (chaque page duplique son propre `<script>`)
- Hébergement : Railway (déployé le 2026-08-10, projet `positive-blessing`, service `tenniswebmanager`, volume persistant monté sur `/app/data`). `DATA_DIR` (variable d'environnement) fait pointer `tennis-manager.db` et `uploads/` vers ce volume en production ; en local, `DATA_DIR` est absent et tout reste à la racine du projet comme avant. Dépôt GitHub `rod1102/tenniswebmanager`, déploiement via `railway up` (CLI installé, token de projet utilisé)
- L'utilisateur est débutant en développement — expliquer les changements simplement, donner des fichiers complets plutôt que des diffs quand le fichier est modifié en profondeur, pour éviter les erreurs de copier-coller manuel qui ont posé problème plusieurs fois en cours de route

## Structure des fichiers

- `server.js` — toutes les routes API Express
- `database.js` — schéma SQLite + migrations (ALTER TABLE avec try/catch)
- `style.css` — tout le CSS du site
- `index.html` — page d'accueil
- `inscription.html` / `connexion.html` — authentification ; `mot-de-passe-oublie.html` / `reinitialiser-mot-de-passe.html` — réinitialisation par e-mail (Resend)
- `creation-joueurs.html` — création des 2 personnages (joueur + joueuse)
- `joueur.html` — fiche du personnage (`?type=joueur`/`?type=joueuse`), planification hebdomadaire en haut + stats en dessous
- `admin.html` — validation des inscriptions + bouton "avancer la semaine" + gestion des rédacteurs Presse
- `presse.html` / `presse-detail.html` — articles rédigés par les coachs autorisés (`users.est_redacteur`, accordé par l'admin), photo optionnelle uploadée (`uploads/presse/`, dossier créé au démarrage s'il n'existe pas), lien optionnel vers un tournoi ou un joueur réel
- `statistiques.html` — 3 onglets : Confrontations (face-à-face entre VRAIS joueurs uniquement, pas les rivaux ni les lambdas jetables), Almanach (palmarès des tournois majeurs + top 10 par saison COMPLÈTE, recalculé à la volée sur la fenêtre de la saison via `calculerClassementGlobal`, jamais lu depuis `classement_historique` qui ne stocke qu'une fenêtre Live glissante), Records (11 records ATP/WTA/Coachs, filtrables par surface avec les couleurs de `.surface-card`, `balles_break_sauvees` trackées en direct par `simulerMatch` depuis 2026-07-27 donc absentes des matchs déjà joués avant cette date)
- `coupe.html` — Coupe Davis / Billie Jean King Cup (ex-Fed Cup), ancien format (4 manches/saison : 1er tour S5, Quarts S14, Demies S37, Finale S47, cf. `SEMAINES_COUPES_EQUIPE` dans `calendrier-tournois.js`). Liste des rencontres d'une nation + formulaires capitaine (surface/composition/styles) selon la semaine en cours (`etapeCoupe`). Pas de lien dans le menu de navigation (accès via un lien contextuel sur `joueur.html` uniquement), pour ne pas surcharger le menu déjà dense. Capitaine désigné une fois par saison (candidature Pré-saison+S0, vote S1, repli automatique sur le meilleur joueur réel de la nation si personne ne candidate/vote) ; tableau de 16 nations par circuit régénéré automatiquement chaque Pré-saison à partir du meilleur joueur (réel ou rival) de chaque nation sur le classement Live
- `ball.png`, `court.jpg`, `icone-joueur.png`, `icone-joueuse.png` — assets

## Convention de travail

- Après modif de `server.js` ou `database.js` : redémarrer le serveur (`Ctrl+C` puis `node server.js`) — sinon les changements ne sont pas pris en compte
- Après modif du `.env` (ex. ajout de la vraie `RESEND_API_KEY`) : redémarrer le serveur aussi, `dotenv` ne charge le fichier qu'au démarrage
- Après modif d'un `.html`/`.css` : `Ctrl+F5` suffit, pas de redémarrage serveur
- PowerShell sur Windows : attention à l'échappement des guillemets dans les commandes `node -e "..."` (préférer des requêtes préparées avec `?` plutôt que des guillemets imbriqués)

## Règles du jeu (résumé)

- **8 compétences techniques** (Service, Retour, Coup droit/Revers fusionnés en une seule, Effet, Volée, Déplacement, Puissance, Résistance), 0-100, réparties à la création avec un budget de **120 points**
- **7 dispositions personnalisées** (pas celles du PDF d'origine) : Adversité (adversaire affronté 3+ fois cette saison), Coupeur de têtes (non tête de série vs tête de série), Dernier carré (demi/finale), Premiers tours (2 premiers tours), Sang froid (set décisif), Indoor (tournois intérieur), Rivalité (12 matchs contre le même adversaire au cours de la carrière) — budget de **12 points** à la création, max 5 par catégorie (ce plafond ne s'applique qu'à la création : les gains/pertes d'intersaison et le Coaching mental peuvent dépasser 5 dans une catégorie). Aucune disposition n'est câblée dans le moteur de simulation pour l'instant (stockées comme statistiques, effet à construire plus tard)
- **Forme** (0-100), **Mental courant/max** (peut dépasser 100, pas de plafond), **Usure**, **Points d'énergie** (démarre à 50, pas de max fixe, remis à 0 à chaque changement de saison)
- **3 surfaces** (Dur, Terre battue, Herbe) : chacune a Niveau / Niveau+Mental (calculés en direct via coefficients, pas stockés) et Automatismes (0-30, +3/match sur la surface jouée, +15/entraînement de surface dédié, -5/semaine sauf si joué)
- Coefficients de niveau de jeu par surface (issus du PDF) : voir `COEFFICIENTS_SURFACE` dans `server.js`
- **Système hebdomadaire** : `jeu_etat.semaine_actuelle` avance manuellement via le bouton admin "Avancer la semaine" (pas de vrai calendrier temps réel). Une saison dure **54 semaines de jeu** : Pré-saison (1 semaine, aucun tournoi/érosion/XP) → Semaine 0 (1 semaine, tirage des tableaux de S1, pronostics/styles ouverts pour S1) → S1 à S52 (comportement classique). `phaseDeSemaine(semaine)` dans `calendrier-tournois.js` est la seule source de vérité pour interpréter une semaine absolue. Table `plannings` stocke les ordres futurs (repos / generique / surface_dur / surface_terre / surface_herbe / coaching_mental) sur une fenêtre glissante de 5 semaines, uniquement sur des semaines de type "tournoi"
- **Érosion** : -4% sur les 8 compétences à chaque avancée de semaine (sauf Pré-saison/Semaine 0), arrondi par défaut (floor)
- **Changement de saison** (transition S52 → nouvelle Pré-saison, fonction `appliquerChangementDeSaison` dans `server.js`) : usure/automatismes/énergie remis à 0, mental maximal remis à 100, **la moulinette** rabote les 8 compétences des joueurs les plus développés (`cible = ((XP totale - 200) / 2.5) + 100`, réduction proportionnelle si `cible < XP totale`, jamais d'augmentation), et le budget de dispositions évolue par intersaison : +3 pts (intersaisons 1-3), +2 pts (4-5), -2 pts (6-7), -3 pts (8-9), rien à partir de la 10e. Les gains sont libres à répartir (`points_dispositions_a_gagner`), les pertes bloquent le reste des actions du joueur tant qu'elles ne sont pas résolues (`points_dispositions_a_retirer`)
- **Coaching mental** : option de planification hebdomadaire alternative à repos/entraînement — 0 XP cette semaine-là, mais +1 point de disposition à placer où on veut et la possibilité de déplacer 1 point déjà acquis d'une catégorie vers une autre (`points_dispositions_a_deplacer`)
- **Statut de validation** : chaque personnage créé est `en_attente` jusqu'à validation par un compte `role='admin'` dans `users`
- **Avancement automatique des semaines** : `verifierAvancementAuto()` tourne au démarrage du serveur puis toutes les 15 min, avance la partie tous les **lundis et jeudis 8h00** heure locale (rythme du PDF), rattrape les échéances manquées si le serveur était éteint. Le bouton admin "Avancer la semaine" reste disponible en secours (appelle la même fonction `executerAvancementSemaine()`). `executerAvancementSemaine` ne simule plus aucun tournoi (voir moteur de tournoi ci-dessous) — elle crée/tire les tournois dus et enregistre l'ancre temps réel de la semaine (`semaines_reelles`)
- **Moteur de tournoi tour par tour** : un tournoi ne se simule plus d'un coup, chaque tour se joue à un horaire réel précis dans la semaine (`CRENEAUX_TOUR_1_SEMAINE`/`CRENEAUX_TOUR_2_SEMAINES_S1`/`_S2` dans `server.js`, en heures depuis l'ancre `semaines_reelles` de la semaine ingame concernée). `executerAvancementTour()` (2e scheduler automatique, même rythme de vérification que le premier) simule le prochain tour dû de chaque tournoi `statut='a_venir'` ; `tournois.tour_actuel` piste la progression. Bouton admin "Avancer un tour" (`POST /api/admin/avancer-tour`) force le tour suivant de chaque tournoi en cours sans attendre l'horaire (mais ne peut jamais franchir la semaine 2 d'un tournoi 2-semaines avant qu'elle n'ait réellement commencé)
- **XP de tournoi** : versé en une fois à l'élimination/victoire (pas par tour franchi), barème par nombre de tours total et tour atteint (`XP_TOURNOI` dans `server.js`) ; pour les tournois 7 tours (2 semaines, GC + M1000 96), un bonus fixe de qualification (+7, `XP_QUALIFICATION_SEMAINE2`) est versé dès la survie du 3e tour, le complément à l'élimination/victoire réelle en semaine 2. Rejoint le même pool `points_experience` que l'entraînement, soumis à la même règle de péremption hebdomadaire (choix explicite de l'utilisateur)
- **Mise de points d'énergie** : réglée sur `joueur.html`, juste à côté des styles de jeu (pas sur `tournois.html` à l'inscription — l'inscription se fait toujours à mise 0) ; modifiable librement tant que `tournois.tour_actuel === 0` (`POST /api/tournois/mise-energie`), verrouillée dès que le tournoi a commencé. Plafond selon catégorie (`PLAFOND_MISE_ENERGIE` : GC/Finals/M1000 = 10, 500/250 = 5), stockée sur `tournoi_joueurs.energie_misee`. Ajoute `mise × 5` au niveau de jeu pendant tout le tournoi (en plus de l'énergie de base qui compte toujours normalement), perdue définitivement à l'élimination/victoire de ce joueur (en plus du coût fixe de 1 PE/participation). Plafond dur de 100 PE sur la régénération +5/4 semaines
- **Re-choix de styles de jeu** : verrouillés après la première soumission pour tous les tournois, SAUF les tournois 7 tours où les tours non encore joués restent modifiables en continu (les tours déjà joués, eux, restent figés)

## Moteur de matchs

- Fonction partagée `simulerMatch` (server.js) : simulation jeu par jeu, set par set (best of 3), tie-break **point par point** à 6-6 (pas un tirage unique). Utilisée par la simulation de tournoi (`simulerUnTour`/`simulerUnTourPoules`)
- Loi de probabilité du PDF : 50%/54%/56.5%/59% aux écarts de niveau 0/25/50/100, puis +2.5% par palier de 100 au-delà
- Points importants (balle de break/set/match, points décisifs du tie-break) : double tirage — technique puis mental si nécessaire ; égalité entre les deux = on rejoue le point
- **Matchs amicaux retirés du jeu** (2026-07-24, demande explicite de l'utilisateur) : la route `/api/match-amical`, le bloc "Match amical" de `joueur.html` (sélecteurs surface/difficulté + bouton "Lancer le match") ont été supprimés. Le seul match amical jamais joué (Youssouf, player_id=19) a eu ses effets annulés manuellement (retour aux valeurs de création) et son enregistrement supprimé de la table `matchs`. `matchs.html`/`/api/matchs/:userId` restent inchangés (partagés avec les matchs de tournoi, qui continuent d'utiliser la table `matchs`)

## Pas encore fait

- Double (aucune notion de paire/niveau combiné/classement double dans le moteur actuel — chantier de l'ampleur du système de tournois)
- Coupe Davis / Fed Cup / Jeux Olympiques (dépendent du double ci-dessus, plus une couche "équipe par nation" qui n'existe pas du tout aujourd'hui)

## Décisions de conception notables

- Budget de compétences techniques : 450 (proposition initiale) → 150 (premier choix explicite) → 120 (ajusté le 2026-07-18, choix explicite de l'utilisateur, à l'occasion d'un reset complet de la progression)
- Dispositions entièrement personnalisées par rapport au PDF d'origine
- Liste des nationalités réduite (micro-États retirés, sauf ceux explicitement demandés : Bahamas, Barbade, Liechtenstein, Monaco, Samoa, Andorre)
- Tie-break simulé point par point plutôt qu'en un tirage global, sur demande explicite de fidélité aux règles
- Énergie remise à 0 à chaque changement de saison, contrairement au PDF ("l'énergie n'est pas remise à 50 à l'inter-saison") — choix explicite de l'utilisateur (2026-07-18)
- Moulinette et gains/pertes de dispositions à l'intersaison automatiques (pas discrétionnaires comme suggéré dans le PDF), avec des formules et paliers donnés explicitement par l'utilisateur (2026-07-18)
- Drapeaux affichés en images (flagcdn.com), pas en emoji comme envisagé au départ
- **Saison 0 simulée par des bots** (2026-07-19) : les semaines absolues 1-54 ont été jouées intégralement par des rivaux persistants/lambdas (aucun joueur réel) pour pré-remplir les classements avant que l'utilisateur ne crée ses vrais personnages ; la vraie partie démarre à la semaine absolue 55, mais `jeu_etat.saison_offset` (nouvelle colonne, fixée à 1) fait afficher "Saison 1" côté utilisateur via `phaseAffichee()` (server.js) plutôt que "Saison 2" — voir la mémoire `project_saison_0_bots`. Le roster persistant (`classement_joueurs`) a sa propre fourchette de niveau (`NIVEAU_ROSTER_PAR_CATEGORIE`, ~120-270), volontairement plus basse que les lambdas jetables des tournois (`NIVEAU_LAMBDA_PAR_CATEGORIE`, inchangée)
- **Bug corrigé à cette occasion** : un tableau de tournoi non-puissance-de-2 (28/48/56/96 places, la majorité du calendrier réel) plantait ou se corrompait à partir du 2e tour, car un BYE éliminé ne recevait jamais `tour_elimine` dans `simulerUnTour` — jamais détecté avant car toutes les vérifications précédentes utilisaient des tableaux de 32/64/128 (puissances de 2 exactes, sans BYE)