const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// En local, la base reste a la racine du projet comme avant. Sur Railway, DATA_DIR
// pointe vers le volume persistant (ex. /app/data) - indispensable pour que la base
// survive aux redeploiements (le reste du disque est efface a chaque nouveau build).
// better-sqlite3 ne cree jamais le dossier parent lui-meme (plante sinon si absent).
if (process.env.DATA_DIR) fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const cheminBase = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'tennis-manager.db') : 'tennis-manager.db';
const db = new Database(cheminBase);

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'coach',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        prenom TEXT NOT NULL,
        nom TEXT NOT NULL,
        age INTEGER NOT NULL,
        taille INTEGER NOT NULL,
        nationalite TEXT NOT NULL,
        main_forte TEXT NOT NULL,
        statut TEXT DEFAULT 'en_attente',
        service INTEGER DEFAULT 0,
        retour INTEGER DEFAULT 0,
        coup_droit_revers INTEGER DEFAULT 0,
        effet INTEGER DEFAULT 0,
        volee INTEGER DEFAULT 0,
        deplacement INTEGER DEFAULT 0,
        puissance INTEGER DEFAULT 0,
        resistance INTEGER DEFAULT 0,
        niveau REAL DEFAULT 0,
        forme INTEGER DEFAULT 100,
        mental_courant REAL DEFAULT 100,
        mental_max REAL DEFAULT 100,
        usure INTEGER DEFAULT 0,
        points_energie INTEGER DEFAULT 50,
        points_experience INTEGER DEFAULT 0,
        surface_dur_niveau REAL DEFAULT 75,
        surface_dur_niveau_mental REAL DEFAULT 75,
        surface_dur_automatismes INTEGER DEFAULT 0,
        surface_terre_niveau REAL DEFAULT 75,
        surface_terre_niveau_mental REAL DEFAULT 75,
        surface_terre_automatismes INTEGER DEFAULT 0,
        surface_herbe_niveau REAL DEFAULT 75,
        surface_herbe_niveau_mental REAL DEFAULT 75,
        surface_herbe_automatismes INTEGER DEFAULT 0,
        disposition_adversite INTEGER DEFAULT 0,
        disposition_coupeur_de_tetes INTEGER DEFAULT 0,
        disposition_dernier_carre INTEGER DEFAULT 0,
        disposition_premiers_tours INTEGER DEFAULT 0,
        disposition_sang_froid INTEGER DEFAULT 0,
        disposition_indoor INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS jeu_etat (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        semaine_actuelle INTEGER NOT NULL DEFAULT 1
    )
`);
db.prepare('INSERT OR IGNORE INTO jeu_etat (id, semaine_actuelle) VALUES (1, 1)').run();

db.exec(`
    CREATE TABLE IF NOT EXISTS semaines_reelles (
        semaine INTEGER PRIMARY KEY,
        debut_reel TEXT NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS plannings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        semaine INTEGER NOT NULL,
        action TEXT NOT NULL,
        UNIQUE(player_id, semaine),
        FOREIGN KEY (player_id) REFERENCES players(id)
    )
`);

// Historique COMPLET (append-only, jamais modifie ni supprime) de chaque ordre de
// planification soumis par un coach - contrairement a `plannings` (une seule ligne
// par joueur/semaine, ecrasee a chaque changement d'avis, puis supprimee des sa
// consommation par executerAvancementSemaine), qui ne garde donc aucune trace du
// choix d'origine ni de la date de saisie. Demande explicite de l'utilisateur,
// 2026-08-25, dans la continuite de l'historique physique (forme/energie/
// competences/etc.) ajoute le meme jour : meme motivation, pouvoir repondre avec
// certitude a "un ordre avait-il ete saisi pour ce joueur cette semaine-la, et
// lequel" meme longtemps apres coup, plutot que de devoir le deduire ou constater
// qu'il est introuvable.
db.exec(`
    CREATE TABLE IF NOT EXISTS planning_historique (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        semaine INTEGER NOT NULL,
        action TEXT NOT NULL,
        horodatage TEXT NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players(id)
    )
`);

// Journal hebdomadaire : une ligne par joueur et par semaine "vecue", ecrite au
// moment ou executerAvancementSemaine traite cette semaine - contrairement a
// `plannings` (supprimee une fois consommee) et `points_experience` (remis a zero
// chaque semaine), c'est la SEULE trace persistante de "qu'est-ce qui etait prevu
// et qu'est-ce qui a ete reellement credite" pour un joueur a une semaine donnee.
db.exec(`
    CREATE TABLE IF NOT EXISTS journal_semaine_joueur (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        semaine INTEGER NOT NULL,
        action_prevue TEXT,
        tournoi_nom TEXT,
        xp_credite INTEGER DEFAULT 0,
        disposition_a_gagner_ajoutee INTEGER DEFAULT 0,
        disposition_a_deplacer_ajoutee INTEGER DEFAULT 0,
        forme_avant REAL,
        forme_apres REAL,
        horodatage TEXT NOT NULL,
        UNIQUE(player_id, semaine),
        FOREIGN KEY (player_id) REFERENCES players(id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS matchs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        surface TEXT NOT NULL,
        difficulte TEXT NOT NULL,
        semaine INTEGER NOT NULL,
        vainqueur TEXT NOT NULL,
        score TEXT NOT NULL,
        niveau_joueur INTEGER NOT NULL,
        niveau_adversaire INTEGER NOT NULL,
        evenements TEXT NOT NULL,
        date_creation TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (player_id) REFERENCES players(id)
    )
`);

// Tournoi = evenement GLOBAL partage par tous les coachs (pas une copie privee par
// coach) : pas de user_id/player_id ici, l'appartenance d'un vrai joueur a une
// instance vit uniquement sur tournoi_joueurs.player_id (est_reel = 1).
db.exec(`
    CREATE TABLE IF NOT EXISTS tournois (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        calendrier_id TEXT NOT NULL,
        nom TEXT NOT NULL,
        circuit TEXT NOT NULL,
        categorie TEXT NOT NULL,
        surface TEXT NOT NULL,
        taille_tableau INTEGER NOT NULL,
        semaine INTEGER NOT NULL,
        bareme TEXT NOT NULL,
        statut TEXT NOT NULL DEFAULT 'a_venir',
        format TEXT NOT NULL DEFAULT 'elimination'
    )
`);

// Migration ponctuelle (pas une simple ALTER TABLE ADD COLUMN) : les anciennes
// installations ont un `tournois` avec user_id/player_id NOT NULL et les colonnes
// tour_elimine_joueur/points_gagnes_joueur (modele "copie privee par coach").
// SQLite ne permet pas de retirer une contrainte NOT NULL ni une colonne par ALTER
// TABLE proprement : on recree la table dans la nouvelle forme et on recopie les
// donnees existantes (les ids sont preserves, donc tournoi_joueurs/tournoi_matchs/
// matchs.tournoi_id restent valides sans aucun changement). Idempotent : ne s'execute
// que si l'ancienne colonne existe encore.
const colonnesTournois = db.prepare("PRAGMA table_info(tournois)").all().map(function (c) { return c.name; });
if (colonnesTournois.includes('player_id')) {
    db.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE tournois RENAME TO tournois_old;
        CREATE TABLE tournois (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            calendrier_id TEXT NOT NULL,
            nom TEXT NOT NULL,
            circuit TEXT NOT NULL,
            categorie TEXT NOT NULL,
            surface TEXT NOT NULL,
            taille_tableau INTEGER NOT NULL,
            semaine INTEGER NOT NULL,
            bareme TEXT NOT NULL,
            statut TEXT NOT NULL DEFAULT 'a_venir',
            format TEXT NOT NULL DEFAULT 'elimination'
        );
        INSERT INTO tournois (id, calendrier_id, nom, circuit, categorie, surface, taille_tableau, semaine, bareme, statut, format)
            SELECT id, calendrier_id, nom, circuit, categorie, surface, taille_tableau, semaine, bareme, statut, format FROM tournois_old;
        DROP TABLE tournois_old;
    `);
}

// Invariant "un seul tournoi par evenement calendaire par semaine" applique au niveau
// base plutot que par convention applicative seule.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tournois_calendrier_semaine ON tournois(calendrier_id, semaine)`);

// Pas de FOREIGN KEY declaree sur tournoi_id ici (deliberement, cf. migration de
// reparation ci-dessous) : SQLite reecrit automatiquement les clauses FK des AUTRES
// tables lors d'un `ALTER TABLE ... RENAME` de la table referencee (comportement
// documente depuis 3.25), ce qui casserait de nouveau ces tables au prochain
// `tournois RENAME TO tournois_old` d'une migration future. L'integrite est deja
// geree au niveau applicatif partout ailleurs dans ce schema (pas de FK sur
// matchs.tournoi_id non plus, par exemple).
db.exec(`
    CREATE TABLE IF NOT EXISTS tournoi_joueurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tournoi_id INTEGER NOT NULL,
        nom TEXT NOT NULL,
        nationalite TEXT,
        niveau INTEGER NOT NULL,
        est_reel INTEGER NOT NULL DEFAULT 0,
        player_id INTEGER,
        position_tableau INTEGER NOT NULL,
        tete_de_serie INTEGER,
        tour_elimine TEXT,
        points_gagnes INTEGER
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS tournoi_matchs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tournoi_id INTEGER NOT NULL,
        numero_tour TEXT NOT NULL,
        ordre INTEGER NOT NULL,
        joueur1_id INTEGER NOT NULL,
        joueur2_id INTEGER,
        vainqueur_id INTEGER,
        score TEXT,
        match_id INTEGER
    )
`);

// Migration de reparation : le tout premier passage de la migration "tournois
// global" (RENAME TO tournois_old, CREATE TABLE tournois, DROP TABLE tournois_old)
// a fait que SQLite reecrive silencieusement les clauses FK de tournoi_joueurs et
// tournoi_matchs pour pointer vers "tournois_old" (comportement automatique du
// RENAME) - une fois tournois_old supprime, ces FK pointent dans le vide. Avec
// `PRAGMA foreign_keys` a ON par defaut sur une connexion fraiche (confirme via
// `db.pragma('foreign_keys')`), CA CASSE TOUT INSERT/UPDATE/DELETE sur ces 2 tables
// des le prochain redemarrage avec une nouvelle connexion. Detecte via le texte SQL
// stocke dans sqlite_master (contient "tournois_old"), corrige par recreation sans
// aucune clause FK (cf. justification ci-dessus).
const sqlActuelTJ = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tournoi_joueurs'").get();
if (sqlActuelTJ && sqlActuelTJ.sql.indexOf('tournois_old') !== -1) {
    db.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE tournoi_joueurs RENAME TO tournoi_joueurs_old;
        CREATE TABLE tournoi_joueurs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournoi_id INTEGER NOT NULL,
            nom TEXT NOT NULL,
            nationalite TEXT,
            niveau INTEGER NOT NULL,
            est_reel INTEGER NOT NULL DEFAULT 0,
            player_id INTEGER,
            position_tableau INTEGER NOT NULL,
            tete_de_serie INTEGER,
            tour_elimine TEXT,
            points_gagnes INTEGER,
            rival_id INTEGER,
            style_choisi TEXT
        );
        INSERT INTO tournoi_joueurs (id, tournoi_id, nom, nationalite, niveau, est_reel, player_id, position_tableau, tete_de_serie, tour_elimine, points_gagnes, rival_id, style_choisi)
            SELECT id, tournoi_id, nom, nationalite, niveau, est_reel, player_id, position_tableau, tete_de_serie, tour_elimine, points_gagnes, rival_id, style_choisi FROM tournoi_joueurs_old;
        DROP TABLE tournoi_joueurs_old;
    `);
}

const sqlActuelTM = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tournoi_matchs'").get();
if (sqlActuelTM && sqlActuelTM.sql.indexOf('tournois_old') !== -1) {
    db.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE tournoi_matchs RENAME TO tournoi_matchs_old;
        CREATE TABLE tournoi_matchs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournoi_id INTEGER NOT NULL,
            numero_tour TEXT NOT NULL,
            ordre INTEGER NOT NULL,
            joueur1_id INTEGER NOT NULL,
            joueur2_id INTEGER,
            vainqueur_id INTEGER,
            score TEXT,
            match_id INTEGER,
            match_id_j2 INTEGER
        );
        INSERT INTO tournoi_matchs (id, tournoi_id, numero_tour, ordre, joueur1_id, joueur2_id, vainqueur_id, score, match_id, match_id_j2)
            SELECT id, tournoi_id, numero_tour, ordre, joueur1_id, joueur2_id, vainqueur_id, score, match_id, match_id_j2 FROM tournoi_matchs_old;
        DROP TABLE tournoi_matchs_old;
    `);
}

db.exec(`
    CREATE TABLE IF NOT EXISTS tournoi_favoris (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        calendrier_id TEXT NOT NULL,
        semaine INTEGER NOT NULL,
        UNIQUE(player_id, semaine),
        FOREIGN KEY (player_id) REFERENCES players(id)
    )
`);

// Liste d'attente des inscriptions reelles a un tournoi (2026-08-18, demande
// explicite) : source de verite unique de "qui s'est inscrit", INDEPENDANTE du
// tableau tournoi_joueurs qui, lui, reste toujours a taille_tableau lignes exactes.
// Un vrai joueur peut toujours s'inscrire (plus de rejet "tableau complet") ; a
// chaque inscription/desinscription, rebalancerTournoi() recalcule qui occupe
// reellement un slot dans tournoi_joueurs (les mieux classes en priorite, jamais au
// detriment d'un rival) et qui reste en liste d'attente. Pas de FK, meme convention
// que tournois/tournoi_joueurs (une migration RENAME future casserait sinon
// silencieusement ces references).
db.exec(`
    CREATE TABLE IF NOT EXISTS tournoi_liste_attente (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        calendrier_id TEXT NOT NULL,
        semaine INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        date_inscription TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tournoi_liste_attente_unique ON tournoi_liste_attente(calendrier_id, semaine, player_id)`);

// Roster de rivaux GLOBAL (partage par tous les coachs, cf. tournois global) : pas
// de user_id, un seul pool par circuit pour tout le monde.
db.exec(`
    CREATE TABLE IF NOT EXISTS classement_joueurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        circuit TEXT NOT NULL,
        nom TEXT NOT NULL,
        nationalite TEXT,
        niveau INTEGER NOT NULL
    )
`);

const colonnesClassement = db.prepare("PRAGMA table_info(classement_joueurs)").all().map(function (c) { return c.name; });
if (colonnesClassement.includes('user_id')) {
    db.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE classement_joueurs RENAME TO classement_joueurs_old;
        CREATE TABLE classement_joueurs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            circuit TEXT NOT NULL,
            nom TEXT NOT NULL,
            nationalite TEXT,
            niveau INTEGER NOT NULL
        );
        INSERT INTO classement_joueurs (id, circuit, nom, nationalite, niveau)
            SELECT id, circuit, nom, nationalite, niveau FROM classement_joueurs_old;
        DROP TABLE classement_joueurs_old;
    `);
}

// Pronostics d'un coach sur un tournoi donne (vainqueur seul, ou cascade
// huitiemes/quarts/demies/finale/vainqueur pour M1000/GC). Pas de FK sur tournoi_id,
// meme precaution que tournoi_joueurs/tournoi_matchs depuis le piege RENAME+FK.
db.exec(`
    CREATE TABLE IF NOT EXISTS pronostics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tournoi_id INTEGER NOT NULL,
        predictions TEXT NOT NULL,
        points_gagnes INTEGER,
        UNIQUE(user_id, tournoi_id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

// Articles de presse - texte libre redige par un coach autorise (users.est_redacteur,
// accorde par l'admin), avec photo optionnelle (uploads/presse/, servie en statique)
// et lien optionnel vers un tournoi OU un joueur reel du jeu (un seul des deux, pas
// de contrainte en base - verifie a l'ecriture cote application).
db.exec(`
    CREATE TABLE IF NOT EXISTS articles_presse (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        titre TEXT NOT NULL,
        contenu TEXT NOT NULL,
        image_path TEXT,
        lien_tournoi_id INTEGER,
        lien_player_id INTEGER,
        date_creation TEXT NOT NULL
    )
`);

// Annonce unique de l'administrateur (pas une liste comme articles_presse - une
// seule ligne, toujours id=1, ecrasee a chaque modification) affichee en bas de
// la page Presse pour tous les coachs. Contenu vide = aucune annonce a afficher.
db.exec(`
    CREATE TABLE IF NOT EXISTS annonce_admin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        contenu TEXT NOT NULL DEFAULT '',
        date_modification TEXT
    )
`);
db.prepare("INSERT OR IGNORE INTO annonce_admin (id, contenu, date_modification) VALUES (1, '', NULL)").run();

// Photo hebdomadaire du classement Live GLOBAL (tous coachs + rivaux confondus),
// une ligne par participant (cle 'rival:id'/'joueur:id') et par semaine ecoulee -
// alimentee dans executerAvancementSemaine (server.js), jamais de reconstruction
// retroactive (rien pour les semaines deja ecoulees avant ce chantier, ni pour la
// saison 0 des bots). Sert a calculer le "meilleur classement" (MIN(rang)) et le
// nombre de semaines passees a ce rang (COUNT(*) WHERE rang = ce MIN) d'un joueur
// ou d'un rival sur sa fiche adversaire.
db.exec(`
    CREATE TABLE IF NOT EXISTS classement_historique (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        circuit TEXT NOT NULL,
        cle TEXT NOT NULL,
        semaine INTEGER NOT NULL,
        rang INTEGER NOT NULL
    )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_classement_historique_cle ON classement_historique(cle, circuit)`);

// ---------- Coupe Davis / Billie Jean King Cup (ex-Fed Cup) ----------
// Ancien format (2026-07-28, demande explicite) : 4 manches par saison (1er tour,
// quarts, demies, finale), chacune = 5 rencontres (2 simples/1 double/2 simples
// retour), premiere nation a 3 victoires remporte la manche. Pas de FK (meme
// convention que tournois/tournoi_joueurs plus haut - une migration RENAME future
// casserait sinon silencieusement ces references).
db.exec(`
    CREATE TABLE IF NOT EXISTS coupe_equipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        saison INTEGER NOT NULL,
        circuit TEXT NOT NULL,
        manche TEXT NOT NULL,
        semaine INTEGER NOT NULL,
        nation_domicile TEXT NOT NULL,
        nation_exterieur TEXT NOT NULL,
        surface TEXT,
        statut TEXT NOT NULL DEFAULT 'a_venir',
        victoires_domicile INTEGER NOT NULL DEFAULT 0,
        victoires_exterieur INTEGER NOT NULL DEFAULT 0,
        nation_vainqueur TEXT
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS coupe_composition (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coupe_equipe_id INTEGER NOT NULL,
        nation TEXT NOT NULL,
        joueur_a_est_reel INTEGER, joueur_a_id INTEGER,
        joueur_b_est_reel INTEGER, joueur_b_id INTEGER,
        joueur_c_est_reel INTEGER, joueur_c_id INTEGER,
        joueur_d_est_reel INTEGER, joueur_d_id INTEGER,
        double_j1_est_reel INTEGER, double_j1_id INTEGER,
        double_j2_est_reel INTEGER, double_j2_id INTEGER
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS coupe_rubbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coupe_equipe_id INTEGER NOT NULL,
        numero INTEGER NOT NULL,
        type TEXT NOT NULL,
        domicile_est_reel INTEGER, domicile_id INTEGER, domicile_style TEXT,
        exterieur_est_reel INTEGER, exterieur_id INTEGER, exterieur_style TEXT,
        nation_vainqueur TEXT,
        score TEXT,
        match_id INTEGER,
        match_id_j2 INTEGER
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS coupe_capitaines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        saison INTEGER NOT NULL,
        circuit TEXT NOT NULL,
        nation TEXT NOT NULL,
        player_id INTEGER NOT NULL
    )
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_capitaines_unique ON coupe_capitaines(saison, circuit, nation)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS coupe_candidatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        saison INTEGER NOT NULL,
        circuit TEXT NOT NULL,
        nation TEXT NOT NULL,
        player_id INTEGER NOT NULL,
        date_creation TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_candidatures_unique ON coupe_candidatures(saison, circuit, nation, player_id)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS coupe_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        saison INTEGER NOT NULL,
        circuit TEXT NOT NULL,
        nation TEXT NOT NULL,
        votant_player_id INTEGER NOT NULL,
        candidat_player_id INTEGER NOT NULL
    )
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_votes_unique ON coupe_votes(saison, circuit, nation, votant_player_id)`);

// Un style par VRAI joueur et par manche (pas par rencontre individuelle) - couvre
// a la fois son/ses simple(s) et le double s'il y participe, decision explicite de
// l'utilisateur (pas de "style d'equipe" separe).
// numero (rencontre precise : 1/2/4/5, jamais 3=double) ajoute nativement ici pour
// une base neuve - les bases existantes le recuperent via la migration ALTER TABLE
// plus bas (colonne absente de coupe_styles a l'origine). L'index unique est cree
// APRES le bloc de migrations, en bas de ce fichier, pour etre sur que la colonne
// existe deja quel que soit le chemin (creation neuve ou migration).
db.exec(`
    CREATE TABLE IF NOT EXISTS coupe_styles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coupe_equipe_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        style TEXT NOT NULL,
        numero INTEGER
    )
`);

// Groupe mondial (2026-08-12, demande explicite) : composition PERSISTANTE des 16
// nations d'un circuit pour une saison donnee - remplace le tirage integral chaque
// annee par un systeme de promotion/relegation. Une nation y reste tant qu'elle
// gagne son 1er tour (maintien automatique) ou gagne son barrage de maintien
// (promotion) ; elle en sort si elle perd les deux. Une ligne par (saison, circuit,
// nation) - saison conservee pour garder l'historique complet des compositions
// passees, pas seulement la plus recente.
db.exec(`
    CREATE TABLE IF NOT EXISTS coupe_groupe_mondial (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        saison INTEGER NOT NULL,
        circuit TEXT NOT NULL,
        nation TEXT NOT NULL
    )
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_groupe_mondial_unique ON coupe_groupe_mondial(saison, circuit, nation)`);

// Top 30 ATP/WTA "obligatoire" (regle du classement a 18/16 meilleurs resultats)
// - fige une seule fois a la fin de chaque saison (classement Live du moment),
// en vigueur pour toute la saison suivante. Volontairement absent en Saison 1
// (aucune ligne tant que la 1ere fin de saison n'a pas eu lieu) : la regle ne
// s'applique qu'a partir de la Saison 2 (demande explicite de l'utilisateur,
// 2026-08-22).
db.exec(`
    CREATE TABLE IF NOT EXISTS classement_top30 (
        saison INTEGER NOT NULL,
        circuit TEXT NOT NULL,
        cle TEXT NOT NULL,
        PRIMARY KEY (saison, circuit, cle)
    )
`);

// Vraie session serveur (2026-08-11) : un jeton oppose = une ligne, supprime a la
// deconnexion ou a l'expiration. Remplace le mecanisme precedent (userId envoye en
// clair par le client a chaque appel, jamais verifie cote serveur).
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        date_creation TEXT DEFAULT CURRENT_TIMESTAMP,
        date_expiration TEXT NOT NULL
    )
`);

// Marque les evenements globaux (declenches a l'issue d'un tournoi precis, cf.
// PDF) deja appliques cette saison, pour ne jamais les rejouer deux fois quand
// le tournoi ATP et le tournoi WTA du meme evenement se terminent separement.
db.exec(`
    CREATE TABLE IF NOT EXISTS evenements_globaux (
        evenement TEXT NOT NULL,
        semaine INTEGER NOT NULL,
        PRIMARY KEY (evenement, semaine)
    )
`);

const migrations = [
    "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'coach'",
    "ALTER TABLE players ADD COLUMN statut TEXT DEFAULT 'en_attente'",
    "ALTER TABLE players ADD COLUMN service INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN retour INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN coup_droit_revers INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN effet INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN volee INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN deplacement INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN puissance INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN resistance INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN niveau REAL DEFAULT 0",
    "ALTER TABLE players ADD COLUMN forme INTEGER DEFAULT 100",
    "ALTER TABLE players ADD COLUMN mental_courant REAL DEFAULT 100",
    "ALTER TABLE players ADD COLUMN mental_max REAL DEFAULT 100",
    "ALTER TABLE players ADD COLUMN usure INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN points_energie INTEGER DEFAULT 50",
    "ALTER TABLE players ADD COLUMN points_experience INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN surface_dur_niveau REAL DEFAULT 75",
    "ALTER TABLE players ADD COLUMN surface_dur_niveau_mental REAL DEFAULT 75",
    "ALTER TABLE players ADD COLUMN surface_dur_automatismes INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN surface_terre_niveau REAL DEFAULT 75",
    "ALTER TABLE players ADD COLUMN surface_terre_niveau_mental REAL DEFAULT 75",
    "ALTER TABLE players ADD COLUMN surface_terre_automatismes INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN surface_herbe_niveau REAL DEFAULT 75",
    "ALTER TABLE players ADD COLUMN surface_herbe_niveau_mental REAL DEFAULT 75",
    "ALTER TABLE players ADD COLUMN surface_herbe_automatismes INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN disposition_adversite INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN disposition_coupeur_de_tetes INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN disposition_dernier_carre INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN disposition_premiers_tours INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN disposition_sang_froid INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN disposition_indoor INTEGER DEFAULT 0",
    "ALTER TABLE matchs ADD COLUMN tournoi_id INTEGER",
    "ALTER TABLE matchs ADD COLUMN numero_tour TEXT",
    "ALTER TABLE tournois ADD COLUMN format TEXT NOT NULL DEFAULT 'elimination'",
    "ALTER TABLE tournoi_joueurs ADD COLUMN rival_id INTEGER",
    "ALTER TABLE players ADD COLUMN disposition_rivalite INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN condition TEXT DEFAULT 'en_forme'",
    "ALTER TABLE tournoi_joueurs ADD COLUMN style_choisi TEXT",
    "ALTER TABLE tournoi_matchs ADD COLUMN match_id_j2 INTEGER",
    "ALTER TABLE matchs ADD COLUMN kine_intervenu INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN ip_inscription TEXT",
    "ALTER TABLE players ADD COLUMN points_dispositions_a_gagner INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN points_dispositions_a_retirer INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN points_dispositions_a_deplacer INTEGER DEFAULT 0",
    "ALTER TABLE jeu_etat ADD COLUMN derniere_avancee_auto TEXT",
    "ALTER TABLE tournois ADD COLUMN tour_actuel INTEGER DEFAULT 0",
    "ALTER TABLE tournoi_joueurs ADD COLUMN energie_misee INTEGER DEFAULT 0",
    "ALTER TABLE jeu_etat ADD COLUMN saison_offset INTEGER DEFAULT 0",
    "ALTER TABLE jeu_etat ADD COLUMN saison_lancee INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN pseudo TEXT",
    "ALTER TABLE users ADD COLUMN discord TEXT",
    "ALTER TABLE users ADD COLUMN reset_token TEXT",
    "ALTER TABLE users ADD COLUMN reset_token_expire TEXT",
    "ALTER TABLE users ADD COLUMN est_redacteur INTEGER DEFAULT 0",
    "ALTER TABLE matchs ADD COLUMN balles_break_sauvees INTEGER DEFAULT 0",
    "ALTER TABLE coupe_equipes ADD COLUMN position INTEGER",
    "ALTER TABLE coupe_rubbers ADD COLUMN domicile_id2 INTEGER",
    "ALTER TABLE coupe_rubbers ADD COLUMN exterieur_id2 INTEGER",
    "ALTER TABLE matchs ADD COLUMN coupe_equipe_id INTEGER",
    "ALTER TABLE coupe_equipes ADD COLUMN rubber_actuel INTEGER DEFAULT 0",
    "ALTER TABLE coupe_equipes ADD COLUMN division INTEGER DEFAULT 1",
    "ALTER TABLE players ADD COLUMN points_competences_a_repartir INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN cap_service INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN cap_retour INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN cap_coup_droit_revers INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN cap_effet INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN cap_volee INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN cap_deplacement INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN cap_puissance INTEGER DEFAULT 0",
    "ALTER TABLE players ADD COLUMN cap_resistance INTEGER DEFAULT 0",
    "ALTER TABLE tournoi_matchs ADD COLUMN evenements TEXT",
    "ALTER TABLE users ADD COLUMN dernier_refus_motif TEXT",
    "ALTER TABLE users ADD COLUMN dernier_refus_date TEXT",
    "ALTER TABLE players ADD COLUMN xp_repartition_en_attente TEXT",
    "ALTER TABLE players ADD COLUMN photo_avatar TEXT",
    "ALTER TABLE tournoi_matchs ADD COLUMN manche_poules INTEGER",
    // Historique physique complet par joueur/semaine (energie/usure/mental/
    // condition/automatismes, en plus de forme_avant/forme_apres deja existants) -
    // permet de retrouver le veritable etat d'un joueur juste avant un evenement
    // donne (bug de reset, etc.) au lieu de le perdre definitivement des qu'un
    // champ est ecrase, comme c'est arrive le 2026-08-24 pour l'energie (aucune
    // trace ne permettait de savoir ce qu'elle valait avant la remise a zero).
    "ALTER TABLE journal_semaine_joueur ADD COLUMN energie_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN energie_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN usure_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN usure_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN mental_avant REAL",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN mental_apres REAL",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN mental_max_avant REAL",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN mental_max_apres REAL",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN condition_avant TEXT",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN condition_apres TEXT",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN automatismes_dur_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN automatismes_dur_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN automatismes_terre_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN automatismes_terre_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN automatismes_herbe_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN automatismes_herbe_apres INTEGER",
    // Memes raisons que le bloc ci-dessus, mais pour les 8 competences techniques
    // (service/retour/coup_droit_revers/effet/volee/deplacement/puissance/resistance) -
    // demande explicite de l'utilisateur, 2026-08-25.
    "ALTER TABLE journal_semaine_joueur ADD COLUMN service_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN service_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN retour_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN retour_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN coup_droit_revers_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN coup_droit_revers_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN effet_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN effet_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN volee_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN volee_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN deplacement_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN deplacement_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN puissance_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN puissance_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN resistance_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN resistance_apres INTEGER",
    // Moulinette differee jusqu'a la prochaine connexion du coach (demande explicite
    // de l'utilisateur, 2026-08-25) - voir marquerMoulinetteEnAttente/
    // appliquerMoulinettePourJoueur dans server.js.
    "ALTER TABLE players ADD COLUMN moulinette_en_attente INTEGER DEFAULT 0",
    // Coupe Davis/Fed Cup : 4 simples distincts (plus de "simple retour" rejoue par
    // les 2 memes joueurs) + 1 double = 5 rencontres, demande explicite de
    // l'utilisateur, 2026-08-25. joueur_a/joueur_b existaient deja.
    "ALTER TABLE coupe_composition ADD COLUMN joueur_c_est_reel INTEGER",
    "ALTER TABLE coupe_composition ADD COLUMN joueur_c_id INTEGER",
    // Style de Coupe Davis/Fed Cup dissocie PAR RENCONTRE (numero de coupe_rubbers) -
    // un joueur de simple joue 2 rencontres (aller + retour), chacune avec son propre
    // style desormais (comme les tours d'un tournoi), plutot qu'un seul style pour
    // toute la manche. Le double n'a plus aucun style (toujours "aucun" a la
    // simulation) - demande explicite de l'utilisateur, 2026-08-26. Les styles deja
    // soumis avant ce changement (une ligne par joueur, sans numero) restent en base
    // mais ne correspondent plus a aucune rencontre precise (numero NULL) : le joueur
    // doit simplement re-choisir, cout de transition juge acceptable pour un
    // changement de regle.
    "ALTER TABLE coupe_styles ADD COLUMN numero INTEGER",
    "ALTER TABLE coupe_composition ADD COLUMN joueur_d_est_reel INTEGER",
    "ALTER TABLE coupe_composition ADD COLUMN joueur_d_id INTEGER"
];

migrations.forEach(function (sql) {
    try {
        db.exec(sql);
    } catch (err) {
        // Colonne deja existante : rien a faire
    }
});

// Placee ici (apres les migrations) pour etre sure que coupe_styles.numero existe
// deja, que la base soit neuve (colonne native dans le CREATE TABLE) ou existante
// (colonne ajoutee par migration juste au-dessus). L'ancien index deux-colonnes
// (coupe_equipe_id, player_id) - un seul style pour toute la manche - doit etre
// explicitement supprime : `CREATE ... IF NOT EXISTS` ne remplace jamais un index
// existant du meme nom meme si sa definition a change, une base deja en prod
// garderait sinon l'ancienne contrainte et rejetterait le 2e style (aller ET
// retour) d'un meme joueur. Demande explicite de l'utilisateur, 2026-08-26.
db.exec(`DROP INDEX IF EXISTS idx_coupe_styles_unique`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_styles_unique_v2 ON coupe_styles(coupe_equipe_id, player_id, numero)`);

// Nettoyage : avant le correctif du refus admin, un personnage refuse restait
// fige sur statut='refuse' sans jamais etre supprime, empechant le coach de
// recreer ses personnages. Desormais /api/admin/decision supprime directement
// la ligne au lieu de la marquer 'refuse', donc plus aucune ligne ne devrait
// jamais reprendre ce statut - cette purge ne rattrape que les refus deja
// enregistres avant ce correctif. Sans effet (0 ligne) une fois la base a jour.
db.prepare("DELETE FROM players WHERE statut = 'refuse'").run();

module.exports = db;