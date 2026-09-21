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
// Index de performance (2026-09-04) : les fiches joueur/coach et les records de
// badges enchainent beaucoup de COUNT/GROUP BY sur ces colonnes. Additifs, sans
// risque - SQLite les cree une fois puis les maintient.
// (Le reste de ce bloc d'index a ete deplace apres les migrations ALTER TABLE plus
// bas - certains portent sur des colonnes qui n'existent pas encore a ce stade sur
// une base VIERGE, cf. bug corrige le 2026-09-11.)
db.exec(`CREATE INDEX IF NOT EXISTS idx_classement_historique_cle_sem ON classement_historique(cle, circuit, semaine)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_classement_historique_circuit_rang ON classement_historique(circuit, rang)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tj_player ON tournoi_joueurs(player_id, est_reel)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tj_tournoi ON tournoi_joueurs(tournoi_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tm_tournoi ON tournoi_matchs(tournoi_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tm_j1 ON tournoi_matchs(joueur1_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tm_j2 ON tournoi_matchs(joueur2_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tm_vainqueur ON tournoi_matchs(vainqueur_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tm_matchid ON tournoi_matchs(match_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_matchs_player ON matchs(player_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_classement_joueurs_circuit ON classement_joueurs(circuit)`);

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
    "ALTER TABLE coupe_composition ADD COLUMN joueur_d_id INTEGER",
    // Verrou manuel des inscriptions (admin.html), independant de saison_lancee -
    // demande explicite de l'utilisateur, 2026-08-27, le temps de brancher le nom
    // de domaine tenniswebmanager.com. DEFAULT 0 (ferme) deliberement : sur la base
    // de production deja existante, cette migration met donc immediatement la
    // ligne jeu_etat existante a 0 des le prochain demarrage - effet recherche,
    // pas un hasard du DEFAULT SQLite habituel.
    "ALTER TABLE jeu_etat ADD COLUMN inscriptions_ouvertes INTEGER DEFAULT 0",
    // Badge coach "Beta testeur" (2026-08-27) : designation manuelle, pas un calcul
    // automatique - accorde une fois aux coachs ayant teste avant le vrai lancement
    // (voir la route ponctuelle qui le pose sur les comptes concernes). DEFAULT 0
    // pour que tout nouveau compte apres le lancement ne l'ait jamais par erreur.
    "ALTER TABLE users ADD COLUMN est_beta_testeur INTEGER DEFAULT 0",
    // Marqueur du recalage de semaine_actuelle lie au passage LONGUEUR_SAISON 51->52
    // (ajout d'une S50, semaine de la moulinette). Voir le bloc guarde plus bas.
    "ALTER TABLE jeu_etat ADD COLUMN patch_longueur_52 INTEGER DEFAULT 0",
    // Accumulateur du budget de competences des inscrits en cours de saison
    // (2026-09-02) : grandit chaque semaine de 70 % de la moyenne des XP distribues
    // aux joueurs reels actifs, remis a 0 a chaque entree en Pre-saison. Le budget
    // affiche vaut 120 + round(cet accumulateur). DEFAULT 0 = "repart de 0 au
    // deploiement" (choix explicite de l'utilisateur, pas de reconstitution
    // retroactive depuis l'historique du journal).
    "ALTER TABLE jeu_etat ADD COLUMN budget_creation_accumule REAL DEFAULT 0",
    // Demande de renommage d'un personnage DEJA VALIDE (contrairement a
    // dernier_refus_motif, qui accompagne toujours une suppression) - un admin peut
    // exiger qu'un coach change juste le prenom/nom d'un personnage existant (ex. jeu
    // de mots non autorise) sans perdre sa progression. renommage_requis_type vaut
    // 'joueur' ou 'joueuse' (le circuit concerne) ou NULL si rien n'est en attente ;
    // efface automatiquement des que POST /api/joueurs/renommer aboutit.
    "ALTER TABLE users ADD COLUMN renommage_requis_type TEXT",
    "ALTER TABLE users ADD COLUMN renommage_requis_motif TEXT",
    // Marqueur du recalcul retroactif des pronostics lie au nouveau bareme cascade
    // (2026-09-07 : 8es/quarts/demies/finale avec bonus d'affiche + tour parfait,
    // total 250 pts/M1000, double en GC). Voir recalculerTousLesPronostics dans
    // server.js, declenche une seule fois au demarrage.
    "ALTER TABLE jeu_etat ADD COLUMN patch_bareme_pronos_20260907 INTEGER DEFAULT 0",
    // Marqueur du recalibrage des bots des tournois deja tires (mais pas commences)
    // sur le critere "moyenne des inscrits reels du tournoi" au lieu de la moyenne
    // du circuit (2026-09-10). Voir le bloc garde dans server.js (au demarrage).
    "ALTER TABLE jeu_etat ADD COLUMN patch_bots_reels_inscrits_20260910 INTEGER DEFAULT 0",
    // Marqueur du recalcul retroactif des pronostics apres le bump du bareme SIMPLE
    // (2026-09-10 : 250 -> 12, 500 -> 25, Masters de fin de saison -> 40 ; etait
    // 3/3/5). Relance recalculerTousLesPronostics au demarrage (server.js).
    "ALTER TABLE jeu_etat ADD COLUMN patch_bareme_simple_20260910 INTEGER DEFAULT 0",
    // 2e ajustement du bareme simple le meme jour : 250 -> 25, 500 -> 50, Masters
    // de fin de saison -> 80. Nouveau recalcul retroactif.
    "ALTER TABLE jeu_etat ADD COLUMN patch_bareme_simple_v2_20260910 INTEGER DEFAULT 0",
    // Signature du bareme des pronostics : des qu'elle change, l'historique est
    // re-note au demarrage (server.js). Remplace les 3 flags patch_bareme_* ci-
    // dessus - plus besoin d'une migration par ajustement de valeur.
    "ALTER TABLE jeu_etat ADD COLUMN bareme_pronos_signature TEXT",
    // Mode maintenance (2026-09-11, urgence) : quand actif, seul le compte admin
    // "Rowdy" garde acces au site (middleware dans server.js) - tout le reste voit
    // une page/reponse de maintenance. Toggle via POST /api/admin/maintenance.
    "ALTER TABLE jeu_etat ADD COLUMN maintenance INTEGER DEFAULT 0",
    "ALTER TABLE jeu_etat ADD COLUMN patch_maintenance_urgence_20260911 INTEGER DEFAULT 0",
    // Ancre temps reel PROPRE a un tournoi (2026-09-11) : semaines_reelles.debut_reel
    // est partagee par TOUS les tournois d'une meme semaine ingame - un tournoi
    // remis a l'etat "tire" par /api/admin/annuler-tournoi ne peut donc pas s'y
    // reposer pour redemarrer son propre rythme de creneaux sans affecter les
    // AUTRES tournois de la meme semaine. Quand elle est posee, executerAvancementTour
    // l'utilise a la place de l'ancre de semaine pour CE tournoi uniquement.
    "ALTER TABLE tournois ADD COLUMN ancre_reset TEXT",
    // Marqueur du recalibrage des bots des tournois deja tires (mais pas commences)
    // sur la nouvelle bande 60-85 % sans plancher (2026-09-11, demande explicite).
    // Voir le bloc garde dans server.js (au demarrage).
    "ALTER TABLE jeu_etat ADD COLUMN patch_bande_60_85_20260911 INTEGER DEFAULT 0",
    // Brouillon de repartition des points de disposition GAGNES (coaching mental ou
    // intersaison), et brouillon de DEPLACEMENT d'un point deja acquis - meme
    // principe que xp_repartition_en_attente (2026-09-14, signale par l'utilisateur :
    // avant, valider ces 2 actions ecrivait immediatement et definitivement sur les
    // dispositions, impossible de revenir dessus). Applique reellement par
    // executerAvancementSemaine, qui vide ensuite ces 2 colonnes.
    "ALTER TABLE players ADD COLUMN dispositions_gain_en_attente TEXT",
    "ALTER TABLE players ADD COLUMN dispositions_deplacement_en_attente TEXT",
    // Historique avant/apres des 7 dispositions, memes principe que les competences/
    // l'etat physique juste au-dessus (2026-09-14, demande explicite de l'utilisateur
    // suite a Nikola Stakhan/Eva Novice : impossible de savoir ce qu'ils avaient
    // avant leur Coaching mental, aucune trace nulle part). Alimente desormais a
    // chaque avancee de semaine par executerAvancementSemaine, pour que ce cas ne se
    // reproduise plus jamais.
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_adversite_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_adversite_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_coupeur_de_tetes_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_coupeur_de_tetes_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_dernier_carre_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_dernier_carre_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_premiers_tours_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_premiers_tours_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_sang_froid_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_sang_froid_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_indoor_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_indoor_apres INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_rivalite_avant INTEGER",
    "ALTER TABLE journal_semaine_joueur ADD COLUMN dispo_rivalite_apres INTEGER"
];

migrations.forEach(function (sql) {
    try {
        db.exec(sql);
    } catch (err) {
        // Colonne deja existante : rien a faire
    }
});

// One-shot : active le mode maintenance des le premier demarrage apres ce
// deploiement (demande explicite et urgente de l'utilisateur, 2026-09-11, pendant
// la reparation des tournois simules trop tot). Guarde par un flag pour ne jamais
// re-forcer le mode maintenance a chaque redemarrage une fois que l'admin l'aura
// desactive volontairement.
(function activerMaintenanceUrgence() {
    const etat = db.prepare('SELECT patch_maintenance_urgence_20260911 FROM jeu_etat WHERE id = 1').get();
    if (etat && !etat.patch_maintenance_urgence_20260911) {
        db.prepare('UPDATE jeu_etat SET maintenance = 1, patch_maintenance_urgence_20260911 = 1 WHERE id = 1').run();
    }
})();

// Ces 2 index portent sur des colonnes ajoutees par les migrations ci-dessus
// (rival_id, match_id_j2) - sur une base VIERGE (jamais migree depuis l'ancien
// modele), ces colonnes n'existent pas encore au moment ou le bloc d'index
// "de base" plus haut s'execute, donc `CREATE INDEX ... ON tournoi_joueurs
// (rival_id)` y plantait au tout premier demarrage ("no such column: rival_id" -
// jamais repere avant car toute base de dev/prod existante avait deja ces
// colonnes depuis longtemps). Places ici, apres les migrations, ils sont surs
// dans tous les cas.
db.exec(`CREATE INDEX IF NOT EXISTS idx_tj_rival ON tournoi_joueurs(rival_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tm_matchidj2 ON tournoi_matchs(match_id_j2)`);

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

// Recalage unique lie au passage LONGUEUR_SAISON 51 -> 52 (ajout d'une S50, la
// semaine de la moulinette, pour ne plus tomber sur la finale de Coupe Davis en
// S49 - demande explicite de l'utilisateur, 2026-08-30). phaseDeSemaine recalcule
// tout a la volee par modulo LONGUEUR_SAISON : une base pile a la frontiere d'un
// cycle de l'ANCIEN modele (Pre-saison <=> (semaine_actuelle - 1) % 51 === 0,
// cas de la prod : semaine 52) serait sinon reinterpretee comme "S50" de la
// saison precedente. On avance alors semaine_actuelle d'autant de cycles de 51
// deja ecoules (1 pour la prod : 52 -> 53), pour rester exactement sur la meme
// phase affichee. Les bases en cours de saison (non-frontiere, ex. dev) ne
// bougent pas. Le marqueur patch_longueur_52 garantit un passage unique.
db.prepare(`
    UPDATE jeu_etat
    SET semaine_actuelle = semaine_actuelle + ((semaine_actuelle - 1) / 51)
    WHERE patch_longueur_52 = 0
      AND semaine_actuelle > 1
      AND ((semaine_actuelle - 1) % 51) = 0
`).run();
db.prepare("UPDATE jeu_etat SET patch_longueur_52 = 1 WHERE patch_longueur_52 = 0").run();

// Complement du recalage L=51->52 : les tournois FUTURS deja pre-crees sous
// l'ancien calendrier (statut 'inscriptions'/'a_venir') ne bougeaient pas avec le
// recalage de semaine_actuelle - ils se retrouvent 1 semaine trop tot par rapport
// a phaseDeSemaine (leur S1 tombe sur la S0, etc.), donc filtres a tort comme
// "doublons" par tournoiDejaCreeCetteSaison et absents du calendrier "Tournois de
// l'annee" (bug signale par l'utilisateur le 2026-08-30). On recale chaque ligne
// mal alignee sur la vraie semaine absolue de sa position calendaire, dans la
// meme saison, + les lignes liste d'attente / favoris qui la referencent.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_tournois_52 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_tournois_52 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const { CALENDRIER_TOURNOIS, phaseDeSemaine, LONGUEUR_SAISON } = require('./calendrier-tournois');
    const futurs = db.prepare("SELECT id, calendrier_id, semaine FROM tournois WHERE statut IN ('inscriptions', 'a_venir')").all();
    const majT = db.prepare('UPDATE tournois SET semaine = ? WHERE id = ?');
    const majLA = db.prepare('UPDATE tournoi_liste_attente SET semaine = ? WHERE calendrier_id = ? AND semaine = ?');
    const majFav = db.prepare('UPDATE tournoi_favoris SET semaine = ? WHERE calendrier_id = ? AND semaine = ?');
    const recale = db.transaction(function () {
        futurs.forEach(function (t) {
            const entree = CALENDRIER_TOURNOIS.find(function (e) { return e.id === t.calendrier_id; });
            if (!entree) return;
            const phase = phaseDeSemaine(t.semaine);
            if (phase.type === 'tournoi' && phase.positionSemaine === entree.semaine_debut) return; // deja bien aligne
            // Bonne semaine absolue : meme saison (cycle) que la ligne actuelle,
            // position calendaire = entree.semaine_debut (positionSaison = +2).
            const cycle = Math.floor((t.semaine - 1) / LONGUEUR_SAISON);
            const cible = cycle * LONGUEUR_SAISON + entree.semaine_debut + 2;
            if (cible === t.semaine) return;
            majT.run(cible, t.id);
            majLA.run(cible, t.calendrier_id, t.semaine);
            majFav.run(cible, t.calendrier_id, t.semaine);
        });
    });
    recale();
    db.prepare("UPDATE jeu_etat SET patch_tournois_52 = 1 WHERE id = 1").run();
}

// Retrait de tournois du calendrier (demande de l'utilisateur) : nettoyage unique
// des lignes qui les referencaient (coeurs/favoris, liste d'attente, et le cas tres
// improbable d'un tournoi deja cree pour une future edition). Un flag par retrait
// (colonne jeu_etat) garantit l'idempotence.
function nettoyerTournoisRetires(flagCol, calendrierIds) {
    try { db.exec(`ALTER TABLE jeu_etat ADD COLUMN ${flagCol} INTEGER DEFAULT 0`); } catch (e) {}
    if (db.prepare(`SELECT ${flagCol} AS p FROM jeu_etat WHERE id = 1`).get().p !== 0) return;
    const ph = calendrierIds.map(function () { return '?'; }).join(',');
    db.transaction(function () {
        const tIds = db.prepare(`SELECT id FROM tournois WHERE calendrier_id IN (${ph})`).all(...calendrierIds).map(function (r) { return r.id; });
        if (tIds.length) {
            const tph = tIds.map(function () { return '?'; }).join(',');
            db.prepare(`DELETE FROM tournoi_matchs WHERE tournoi_id IN (${tph})`).run(...tIds);
            db.prepare(`DELETE FROM tournoi_joueurs WHERE tournoi_id IN (${tph})`).run(...tIds);
            db.prepare(`DELETE FROM pronostics WHERE tournoi_id IN (${tph})`).run(...tIds);
            db.prepare(`DELETE FROM tournois WHERE id IN (${tph})`).run(...tIds);
        }
        db.prepare(`DELETE FROM tournoi_liste_attente WHERE calendrier_id IN (${ph})`).run(...calendrierIds);
        db.prepare(`DELETE FROM tournoi_favoris WHERE calendrier_id IN (${ph})`).run(...calendrierIds);
        db.prepare(`UPDATE jeu_etat SET ${flagCol} = 1 WHERE id = 1`).run();
    })();
}
nettoyerTournoisRetires('patch_retrait_houston_bucarest', ['atp-houston', 'atp-bucarest']); // 2026-09-02
nettoyerTournoisRetires('patch_retrait_wta_cluj', ['wta-cluj']);                              // 2026-09-03

// Correction ponctuelle : age d'Ansgar Hakansson -> 19 ans (demande de l'utilisateur,
// 2026-09-04). v2 : match large (TRIM + LIKE 'H%kansson') apres un v1 qui n'avait
// rien touche (espace parasite ou graphie du nom non prevue).
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_age_hakansson_v2 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_age_hakansson_v2 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const cibles = db.prepare("SELECT id, prenom, nom, age FROM players WHERE type = 'joueur' AND TRIM(prenom) = 'Ansgar' COLLATE NOCASE AND TRIM(nom) LIKE 'H%kansson'").all();
    console.log('[patch_age_hakansson_v2] cibles :', JSON.stringify(cibles));
    const r = db.prepare("UPDATE players SET age = 19 WHERE type = 'joueur' AND TRIM(prenom) = 'Ansgar' COLLATE NOCASE AND TRIM(nom) LIKE 'H%kansson'").run();
    console.log('[patch_age_hakansson_v2] lignes mises a jour :', r.changes);
    db.prepare("UPDATE jeu_etat SET patch_age_hakansson_v2 = 1 WHERE id = 1").run();
}

// Menage ponctuel du 2026-09-04.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_menage_20260904 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_menage_20260904 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    // 1) Compte cree par erreur lors d'un test (email x@y.z) - aucun joueur associe.
    const junk = db.prepare("SELECT id FROM users WHERE email = 'x@y.z'").get();
    if (junk) {
        db.prepare('DELETE FROM players WHERE user_id = ?').run(junk.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(junk.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(junk.id);
        console.log('[menage_20260904] compte test x@y.z supprime (id ' + junk.id + ')');
    }

    // 2) Refus des personnages "Mathias Part" / "Yona L'Hermitage" (prenom masculin
    //    <-> feminin melange, demande de l'utilisateur). On supprime la paire en
    //    attente du coach concerne et on lui laisse un motif visible a sa prochaine
    //    connexion (meme mecanique que /api/admin/decision, cf. dernier_refus_motif).
    const MOTIF = "Noms pas valides car erreur entre feminin et masculin sur les prenoms";
    const cibles = db.prepare(`
        SELECT id, user_id, type, prenom, nom, statut FROM players
        WHERE (TRIM(prenom) = 'Mathias' COLLATE NOCASE AND TRIM(nom) LIKE 'Part' COLLATE NOCASE)
           OR (TRIM(prenom) = 'Yona' COLLATE NOCASE AND TRIM(nom) LIKE 'L%Hermitage' COLLATE NOCASE)
    `).all();
    console.log('[menage_20260904] cibles Mathias/Yona :', JSON.stringify(cibles));
    const usersConcernes = Array.from(new Set(cibles.filter(function (c) { return c.statut !== 'valide'; }).map(function (c) { return c.user_id; })));
    cibles.filter(function (c) { return c.statut === 'valide'; }).forEach(function (c) {
        console.log('[menage_20260904] ATTENTION cible DEJA VALIDEE, non supprimee (revue manuelle) :', JSON.stringify(c));
    });
    usersConcernes.forEach(function (uid) {
        const aSupprimer = db.prepare("SELECT id FROM players WHERE user_id = ? AND statut != 'valide'").all(uid).map(function (r) { return r.id; });
        if (aSupprimer.length) {
            const ph = aSupprimer.map(function () { return '?'; }).join(',');
            ['plannings', 'planning_historique', 'journal_semaine_joueur', 'tournoi_favoris', 'tournoi_liste_attente'].forEach(function (t) {
                try { db.prepare(`DELETE FROM ${t} WHERE player_id IN (${ph})`).run(...aSupprimer); } catch (e) {}
            });
            try { db.prepare(`DELETE FROM tournoi_joueurs WHERE est_reel = 1 AND player_id IN (${ph})`).run(...aSupprimer); } catch (e) {}
            db.prepare(`DELETE FROM players WHERE id IN (${ph})`).run(...aSupprimer);
        }
        db.prepare('UPDATE users SET dernier_refus_motif = ?, dernier_refus_date = ? WHERE id = ?')
            .run(MOTIF, new Date().toISOString(), uid);
        console.log('[menage_20260904] coach ' + uid + ' : ' + aSupprimer.length + ' perso(s) supprime(s) + motif pose');
    });

    db.prepare("UPDATE jeu_etat SET patch_menage_20260904 = 1 WHERE id = 1").run();
}

try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_renommage_20260907 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_renommage_20260907 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    // Personnage garde (contrairement a Mathias/Yona) : "Ella Vantage" reste jouable
    // telle quelle, seul le prenom/nom devra changer - le coach le fera lui-meme via
    // POST /api/joueurs/renommer, ce patch pose juste l'exigence + le motif. Cible
    // par nom (pas juste l'id) pour ne rien poser si la ligne a deja change entre
    // temps (deja renommee, supprimee...).
    const MOTIF_RENOMMAGE = "Merci de changer le nom et prénom de votre joueuse. Les jeux de mots ne sont pas autorisés.";
    const cible = db.prepare(`
        SELECT id, user_id, type, prenom, nom, statut FROM players
        WHERE TRIM(prenom) = 'Ella' COLLATE NOCASE AND TRIM(nom) = 'Vantage' COLLATE NOCASE AND type = 'joueuse'
    `).get();
    console.log('[renommage_20260907] cible Ella Vantage :', JSON.stringify(cible));
    if (cible && cible.statut === 'valide') {
        db.prepare('UPDATE users SET renommage_requis_type = ?, renommage_requis_motif = ? WHERE id = ?')
            .run(cible.type, MOTIF_RENOMMAGE, cible.user_id);
        console.log('[renommage_20260907] exigence de renommage posee sur le coach ' + cible.user_id);
    } else {
        console.log('[renommage_20260907] cible introuvable ou non valide, rien fait');
    }

    db.prepare("UPDATE jeu_etat SET patch_renommage_20260907 = 1 WHERE id = 1").run();
}

// 2026-09-10, demande explicite de l'utilisateur :
//  1) Sophia D'ASPREMONT-LYNDEN (player id 87) passe en nationalite "Curaçao".
//  2) Rivaux : pour chaque (circuit, pays) ayant au moins UN joueur reel valide
//     sur ce circuit, garantir un total (reels + rivaux) d'au moins 4 joueurs,
//     en re-nationalisant + renommant le nombre necessaire de rivaux "sans
//     attache" (pays sans aucun joueur reel), du moins etabli au plus etabli
//     (apparitions en tournoi, puis niveau). Snapshot a l'instant du deploiement :
//     les pays des coachs qui s'inscriront plus tard ne sont pas re-completes.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_min4_rivaux_pays INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_min4_rivaux_pays AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const { genererJoueurLambda, normaliserPays } = require('./calendrier-tournois');
    const MIN_PAR_PAYS = 4;

    db.transaction(function () {
        // --- 1) Sophia D'ASPREMONT-LYNDEN -> Curaçao (cible par id ET nom) ---
        const sophia = db.prepare("SELECT id, type, prenom, nom, nationalite FROM players WHERE id = 87").get();
        if (sophia && normaliserPays(sophia.prenom) === 'sophia' && normaliserPays(sophia.nom).indexOf('aspremont') !== -1) {
            db.prepare("UPDATE players SET nationalite = 'Curaçao' WHERE id = 87").run();
            console.log('[min4_rivaux_pays] player 87 (' + sophia.prenom + ' ' + sophia.nom + ') : ' + sophia.nationalite + ' -> Curaçao');
        } else {
            console.log('[min4_rivaux_pays] player 87 introuvable ou nom inattendu, nationalite non modifiee :', JSON.stringify(sophia));
        }

        // --- 2) Minimum de 4 joueurs par (circuit, pays concerne) ---
        const nomsRoster = new Set(db.prepare('SELECT nom FROM classement_joueurs').all().map(function (r) { return r.nom; }));
        const apparitions = new Map(
            db.prepare('SELECT rival_id, COUNT(*) AS n FROM tournoi_joueurs WHERE rival_id IS NOT NULL GROUP BY rival_id').all()
                .map(function (r) { return [r.rival_id, r.n]; })
        );
        const majRival = db.prepare('UPDATE classement_joueurs SET nom = ?, nationalite = ? WHERE id = ?');
        const rapport = [];

        const majNationalite = db.prepare('UPDATE classement_joueurs SET nationalite = ? WHERE id = ?');

        [['ATP', 'joueur', false], ['WTA', 'joueuse', true]].forEach(function (spec) {
            const circuit = spec[0], typeReel = spec[1], estFeminin = spec[2];

            // Pays concernes = au moins 1 joueur reel valide sur CE circuit. On garde
            // la graphie exacte du joueur reel (accents) comme forme a ecrire.
            const canoniqueParCle = new Map();
            const nbReelsParCle = new Map();
            db.prepare("SELECT nationalite FROM players WHERE type = ? AND statut = 'valide'").all(typeReel).forEach(function (r) {
                const cle = normaliserPays(r.nationalite);
                if (!canoniqueParCle.has(cle)) canoniqueParCle.set(cle, r.nationalite);
                nbReelsParCle.set(cle, (nbReelsParCle.get(cle) || 0) + 1);
            });
            if (canoniqueParCle.size === 0) return;

            const rivaux = db.prepare('SELECT id, nom, nationalite, niveau FROM classement_joueurs WHERE circuit = ?').all(circuit);

            // Harmonisation : les rivaux d'un pays concerne dont l'orthographe (sans
            // accent, issue de genererJoueurLambda) differe de celle du joueur reel
            // sont recales sur la graphie du joueur reel - sinon les recherches par
            // egalite exacte (assurerRosterMinimalNation / joueursEligiblesNation,
            // Coupe Davis) ne les voient pas comme compatriotes du joueur reel.
            rivaux.forEach(function (rv) {
                const cle = normaliserPays(rv.nationalite);
                const graphie = canoniqueParCle.get(cle);
                if (graphie && rv.nationalite !== graphie) {
                    majNationalite.run(graphie, rv.id);
                    rapport.push(circuit + ' : ' + rv.nom + ' ' + rv.nationalite + ' -> ' + graphie + ' (harmonisation)');
                    rv.nationalite = graphie;
                }
            });

            const nbRivauxParCle = new Map();
            rivaux.forEach(function (rv) {
                const cle = normaliserPays(rv.nationalite);
                nbRivauxParCle.set(cle, (nbRivauxParCle.get(cle) || 0) + 1);
            });

            const manques = [];
            canoniqueParCle.forEach(function (graphie, cle) {
                const total = (nbReelsParCle.get(cle) || 0) + (nbRivauxParCle.get(cle) || 0);
                if (total < MIN_PAR_PAYS) manques.push({ graphie: graphie, manque: MIN_PAR_PAYS - total });
            });
            if (manques.length === 0) return;

            // Pool reassignable : rivaux d'un pays NON concerne (pour ne jamais faire
            // passer un pays concerne sous son total). Du moins au plus etabli.
            const pool = rivaux
                .filter(function (rv) { return !canoniqueParCle.has(normaliserPays(rv.nationalite)); })
                .sort(function (a, b) {
                    return (apparitions.get(a.id) || 0) - (apparitions.get(b.id) || 0)
                        || a.niveau - b.niveau || a.id - b.id;
                });

            let i = 0;
            manques.forEach(function (m) {
                for (let k = 0; k < m.manque && i < pool.length; k++, i++) {
                    const cible = pool[i];
                    let nouveauNom;
                    do { nouveauNom = genererJoueurLambda(250, estFeminin).nom; } while (nomsRoster.has(nouveauNom));
                    nomsRoster.add(nouveauNom);
                    nomsRoster.delete(cible.nom);
                    majRival.run(nouveauNom, m.graphie, cible.id);
                    rapport.push(circuit + ' : ' + cible.nom + ' (' + cible.nationalite + ') -> ' + nouveauNom + ' (' + m.graphie + ')');
                }
            });
            if (i < manques.reduce(function (s, m) { return s + m.manque; }, 0)) {
                console.log('[min4_rivaux_pays] ATTENTION ' + circuit + ' : pool de rivaux epuise avant de combler tous les manques');
            }
        });

        console.log('[min4_rivaux_pays] ' + rapport.length + ' rival(aux) reassigne(s)');
        rapport.forEach(function (l) { console.log('  ' + l); });
    })();

    db.prepare("UPDATE jeu_etat SET patch_min4_rivaux_pays = 1 WHERE id = 1").run();
}

// 2026-09-10 (2), demande explicite de l'utilisateur ("Chris COSTA ca fait pas
// norvegien") : donner aux rivaux des pays "concernes" (>= 1 joueur reel valide
// sur le circuit) des prenoms/noms coherents avec leur nationalite, quand une
// banque locale existe (noms-locaux.js). Couvre aussi bien les rivaux
// re-nationalises par patch_min4_rivaux_pays que les compatriotes deja presents.
// (genererJoueurLambda produit desormais deja des noms locaux pour les rivaux et
// lambdas crees ensuite.)
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_noms_locaux_rivaux INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_noms_locaux_rivaux AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const { normaliserPays } = require('./calendrier-tournois');
    const { genererNomLocal, aBanque } = require('./noms-locaux');

    db.transaction(function () {
        const nomsRoster = new Set(db.prepare('SELECT nom FROM classement_joueurs').all().map(function (r) { return r.nom; }));
        const majNom = db.prepare('UPDATE classement_joueurs SET nom = ? WHERE id = ?');
        let renommes = 0;
        const sansBanque = new Set();

        [['ATP', 'joueur', false], ['WTA', 'joueuse', true]].forEach(function (spec) {
            const circuit = spec[0], typeReel = spec[1], estFeminin = spec[2];

            const clesConcernees = new Set(
                db.prepare("SELECT DISTINCT nationalite FROM players WHERE type = ? AND statut = 'valide'").all(typeReel)
                    .map(function (r) { return normaliserPays(r.nationalite); })
            );
            if (clesConcernees.size === 0) return;

            db.prepare('SELECT id, nom, nationalite FROM classement_joueurs WHERE circuit = ?').all(circuit).forEach(function (rv) {
                const cle = normaliserPays(rv.nationalite);
                if (!clesConcernees.has(cle)) return;
                if (!aBanque(cle)) { sansBanque.add(rv.nationalite); return; }

                let nouveau, essais = 0;
                do { nouveau = genererNomLocal(cle, estFeminin); essais += 1; } while (nouveau && nomsRoster.has(nouveau) && essais < 60);
                if (!nouveau || nomsRoster.has(nouveau)) return; // banque trop petite : on garde l'ancien nom
                nomsRoster.delete(rv.nom);
                nomsRoster.add(nouveau);
                majNom.run(nouveau, rv.id);
                renommes += 1;
            });
        });

        console.log('[noms_locaux_rivaux] ' + renommes + ' rival(aux) renomme(s)');
        if (sansBanque.size) console.log('[noms_locaux_rivaux] AUCUNE banque de noms pour : ' + Array.from(sansBanque).join(', '));
    })();

    db.prepare("UPDATE jeu_etat SET patch_noms_locaux_rivaux = 1 WHERE id = 1").run();
}

// 2026-09-10 (3), demande de l'utilisateur : renommer le pseudo du compte id 112
// ("Prepelic" -> "LeBretto"). Cible par id ET pseudo actuel ; abandon si le
// nouveau pseudo est deja pris par un autre compte (comparaison insensible a la
// casse, meme regle que pseudoDejaPris cote serveur).
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_pseudo_prepelic INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_pseudo_prepelic AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const NOUVEAU = 'LeBretto';
    const cible = db.prepare('SELECT id, pseudo FROM users WHERE id = 112').get();
    if (!cible) {
        console.log('[pseudo_prepelic] compte 112 introuvable, rien fait');
    } else if ((cible.pseudo || '').toLowerCase() !== 'prepelic') {
        console.log('[pseudo_prepelic] pseudo actuel du compte 112 inattendu (' + cible.pseudo + '), rien fait');
    } else {
        const conflit = db.prepare('SELECT id FROM users WHERE pseudo = ? COLLATE NOCASE AND id != 112').get(NOUVEAU);
        if (conflit) {
            console.log('[pseudo_prepelic] "' + NOUVEAU + '" deja pris par le compte ' + conflit.id + ', rien fait');
        } else {
            db.prepare('UPDATE users SET pseudo = ? WHERE id = 112').run(NOUVEAU);
            console.log('[pseudo_prepelic] compte 112 : "' + cible.pseudo + '" -> "' + NOUVEAU + '"');
        }
    }
    db.prepare("UPDATE jeu_etat SET patch_pseudo_prepelic = 1 WHERE id = 1").run();
}

// 2026-09-10 (4), demande explicite de l'utilisateur : les noms locaux des rivaux
// ne doivent JAMAIS evoquer un joueur reel, "sous aucun pretexte". noms-locaux.js
// a ete purge de tout patronyme de joueur ATP/WTA connu -> on re-renomme les
// rivaux des pays concernes (deja renommes une 1re fois par
// patch_noms_locaux_rivaux) avec les nouvelles banques, en re-tirant tant que le
// nom coincide avec celui d'un vrai personnage present en base.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_noms_locaux_rivaux_v2 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_noms_locaux_rivaux_v2 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const { normaliserPays } = require('./calendrier-tournois');
    const { genererNomLocal, aBanque } = require('./noms-locaux');

    const cleNom = function (s) { return normaliserPays(String(s || '')).replace(/\s+/g, ' ').trim(); };

    db.transaction(function () {
        // Noms interdits : tous les vrais personnages (players), pour ne jamais
        // qu'un rival porte exactement le nom d'un joueur reel du jeu.
        const nomsReels = new Set(
            db.prepare('SELECT prenom, nom FROM players').all().map(function (p) { return cleNom(p.prenom + ' ' + p.nom); })
        );
        const nomsRoster = new Set(db.prepare('SELECT nom FROM classement_joueurs').all().map(function (r) { return r.nom; }));
        const majNom = db.prepare('UPDATE classement_joueurs SET nom = ? WHERE id = ?');
        let renommes = 0;
        const sansBanque = new Set();

        [['ATP', 'joueur', false], ['WTA', 'joueuse', true]].forEach(function (spec) {
            const circuit = spec[0], typeReel = spec[1], estFeminin = spec[2];

            // Par pays concerne : cle -> Set des prenoms des joueurs reels de ce
            // pays sur ce circuit (un rival ne doit pas non plus partager le prenom
            // d'un vrai joueur du meme pays - "aient un rapport avec un joueur reel").
            const clesConcernees = new Set();
            const prenomsReelsParCle = new Map();
            db.prepare("SELECT prenom, nationalite FROM players WHERE type = ? AND statut = 'valide'").all(typeReel).forEach(function (r) {
                const cle = normaliserPays(r.nationalite);
                clesConcernees.add(cle);
                if (!prenomsReelsParCle.has(cle)) prenomsReelsParCle.set(cle, new Set());
                prenomsReelsParCle.get(cle).add(normaliserPays(r.prenom).trim());
            });
            if (clesConcernees.size === 0) return;

            db.prepare('SELECT id, nom, nationalite FROM classement_joueurs WHERE circuit = ?').all(circuit).forEach(function (rv) {
                const cle = normaliserPays(rv.nationalite);
                if (!clesConcernees.has(cle)) return;
                if (!aBanque(cle)) { sansBanque.add(rv.nationalite); return; }
                const prenomsInterdits = prenomsReelsParCle.get(cle) || new Set();

                let nouveau = null, essais = 0;
                while (essais < 80) {
                    const candidat = genererNomLocal(cle, estFeminin);
                    essais += 1;
                    if (!candidat) break;
                    if (nomsRoster.has(candidat)) continue;
                    if (nomsReels.has(cleNom(candidat))) continue;
                    if (prenomsInterdits.has(normaliserPays(candidat.split(' ')[0]).trim())) continue;
                    nouveau = candidat;
                    break;
                }
                if (!nouveau) return; // banque trop petite : on garde le nom courant
                nomsRoster.delete(rv.nom);
                nomsRoster.add(nouveau);
                majNom.run(nouveau, rv.id);
                renommes += 1;
            });
        });

        console.log('[noms_locaux_rivaux_v2] ' + renommes + ' rival(aux) renomme(s)');
        if (sansBanque.size) console.log('[noms_locaux_rivaux_v2] AUCUNE banque de noms pour : ' + Array.from(sansBanque).join(', '));
    })();

    db.prepare("UPDATE jeu_etat SET patch_noms_locaux_rivaux_v2 = 1 WHERE id = 1").run();
}

// 2026-09-12, demande explicite de l'utilisateur : renommer LUND (id 254) en
// JØRGENSEN. La cible peut etre un vrai joueur (players, prenom/nom separes) ou un
// rival persistant (classement_joueurs, nom complet en une seule colonne) - id 254
// n'a pas de sens partage entre les deux tables (auto-increment independant
// chacune), donc on verifie les deux, et on abandonne sur celle qui ne correspond
// pas plutot que d'ecraser un nom inattendu.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_lund_jorgensen_20260912 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_lund_jorgensen_20260912 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const NOUVEAU_NOM = 'JØRGENSEN';

    const joueurReel = db.prepare('SELECT id, nom FROM players WHERE id = 254').get();
    if (joueurReel) {
        if ((joueurReel.nom || '').toUpperCase() === 'LUND') {
            db.prepare('UPDATE players SET nom = ? WHERE id = 254').run(NOUVEAU_NOM);
            console.log('[lund_jorgensen] players id 254 : "' + joueurReel.nom + '" -> "' + NOUVEAU_NOM + '"');
        } else {
            console.log('[lund_jorgensen] players id 254 existe mais nom inattendu (' + joueurReel.nom + '), rien fait');
        }
    }

    const rival = db.prepare('SELECT id, nom FROM classement_joueurs WHERE id = 254').get();
    if (rival) {
        if (/\bLUND\b/i.test(rival.nom || '')) {
            const nomMisAJour = rival.nom.replace(/\bLUND\b/i, NOUVEAU_NOM);
            db.prepare('UPDATE classement_joueurs SET nom = ? WHERE id = 254').run(nomMisAJour);
            console.log('[lund_jorgensen] classement_joueurs id 254 : "' + rival.nom + '" -> "' + nomMisAJour + '"');
        } else {
            console.log('[lund_jorgensen] classement_joueurs id 254 existe mais nom inattendu (' + rival.nom + '), rien fait');
        }
    }

    if (!joueurReel && !rival) {
        console.log('[lund_jorgensen] aucun joueur ni rival id 254 trouve, rien fait');
    }

    db.prepare('UPDATE jeu_etat SET patch_lund_jorgensen_20260912 = 1 WHERE id = 1').run();
}

// 2026-09-14, demande explicite de l'utilisateur : Nikola Stakhan et Eva Noviče
// ont valide leur Coaching mental (repartition de points de disposition gagnes +
// deplacement) AVANT le correctif du meme jour qui a rendu ces 2 actions
// modifiables jusqu'a l'avancee de semaine (brouillon, plus immediates et
// definitives) - leurs choix a eux se sont donc appliques tout de suite, sans
// jamais avoir eu la possibilite de revenir dessus comme n'importe quel coach
// depuis. On leur "remet le tableau" en leur re-accordant 1 point a gagner et 1
// deplacement, pour qu'ils puissent choisir a nouveau via le systeme corrige.
// N'ANNULE PAS le placement deja fait (aucune trace fiable de la categorie
// choisie pour le reconstruire sans risque) - seulement une nouvelle chance de
// jouer le systeme corrige, pas une remise a zero de ce qui a deja ete gagne.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_redo_coaching_mental_20260914 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_redo_coaching_mental_20260914 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const CIBLES = [
        { prenom: 'Nikola', nom: 'Stakhan' },
        { prenom: 'Eva', nom: 'Noviče' }
    ];
    CIBLES.forEach(function (cible) {
        const joueur = db.prepare('SELECT id, prenom, nom, points_dispositions_a_gagner, points_dispositions_a_deplacer FROM players WHERE prenom = ? COLLATE NOCASE AND nom = ? COLLATE NOCASE').get(cible.prenom, cible.nom);
        if (!joueur) {
            console.log('[redo_coaching_mental] "' + cible.prenom + ' ' + cible.nom + '" introuvable, rien fait');
            return;
        }
        db.prepare('UPDATE players SET points_dispositions_a_gagner = 1, points_dispositions_a_deplacer = 1 WHERE id = ?').run(joueur.id);
        console.log('[redo_coaching_mental] ' + joueur.prenom + ' ' + joueur.nom + ' (id ' + joueur.id + ') : re-accorde 1 point a gagner + 1 deplacement (etait ' + joueur.points_dispositions_a_gagner + '/' + joueur.points_dispositions_a_deplacer + ')');
    });
    db.prepare('UPDATE jeu_etat SET patch_redo_coaching_mental_20260914 = 1 WHERE id = 1').run();
}

// 2026-09-14 (2), demande explicite de l'utilisateur : valeurs exactes des
// dispositions de Nikola Stakhan AVANT le changement errone (Coaching mental
// applique immediatement, avant le correctif du meme jour) - indoor=5,
// premiers_tours=5, sang_froid=2. Corrige precisement ce qui avait ete mal
// applique ; le point deja re-accorde par patch_redo_coaching_mental_20260914
// (points_dispositions_a_gagner=1) reste disponible pour qu'il le replace pour de
// bon cette fois, via le systeme desormais corrige.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_stakhan_dispositions_20260914 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_stakhan_dispositions_20260914 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const joueur = db.prepare('SELECT id, prenom, nom, disposition_indoor, disposition_premiers_tours, disposition_sang_froid FROM players WHERE prenom = ? COLLATE NOCASE AND nom = ? COLLATE NOCASE').get('Nikola', 'Stakhan');
    if (!joueur) {
        console.log('[stakhan_dispositions] "Nikola Stakhan" introuvable, rien fait');
    } else {
        db.prepare('UPDATE players SET disposition_indoor = 5, disposition_premiers_tours = 5, disposition_sang_froid = 2 WHERE id = ?').run(joueur.id);
        console.log('[stakhan_dispositions] Nikola Stakhan (id ' + joueur.id + ') : indoor ' + joueur.disposition_indoor + '->5, premiers_tours ' + joueur.disposition_premiers_tours + '->5, sang_froid ' + joueur.disposition_sang_froid + '->2');
    }
    db.prepare('UPDATE jeu_etat SET patch_stakhan_dispositions_20260914 = 1 WHERE id = 1').run();
}

// 2026-09-14 (3), demande explicite de l'utilisateur : "dernier carre" a toujours
// 1 point en trop pour Nikola Stakhan (le correctif precedent ne touchait que
// indoor/premiers_tours/sang_froid - c'est ici, en realite, que le point du
// Coaching mental errone avait atterri). Decrement relatif (pas une valeur
// absolue, jamais communiquee) - jamais sous 0 par securite.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_stakhan_dernier_carre_20260914 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_stakhan_dernier_carre_20260914 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const joueur = db.prepare('SELECT id, prenom, nom, disposition_dernier_carre FROM players WHERE prenom = ? COLLATE NOCASE AND nom = ? COLLATE NOCASE').get('Nikola', 'Stakhan');
    if (!joueur) {
        console.log('[stakhan_dernier_carre] "Nikola Stakhan" introuvable, rien fait');
    } else if (joueur.disposition_dernier_carre <= 0) {
        console.log('[stakhan_dernier_carre] Nikola Stakhan (id ' + joueur.id + ') : dernier_carre deja a ' + joueur.disposition_dernier_carre + ', rien retire');
    } else {
        const nouvelleValeur = joueur.disposition_dernier_carre - 1;
        db.prepare('UPDATE players SET disposition_dernier_carre = ? WHERE id = ?').run(nouvelleValeur, joueur.id);
        console.log('[stakhan_dernier_carre] Nikola Stakhan (id ' + joueur.id + ') : dernier_carre ' + joueur.disposition_dernier_carre + ' -> ' + nouvelleValeur);
    }
    db.prepare('UPDATE jeu_etat SET patch_stakhan_dernier_carre_20260914 = 1 WHERE id = 1').run();
}

// 2026-09-14 (4), demande explicite de l'utilisateur : valeurs completes des 7
// dispositions d'Eva Novice a la Semaine 0 (avant le Coaching mental applique a
// tort immediatement, avant le correctif du meme jour) - sang_froid=5,
// premiers_tours=5, dernier_carre=2, le reste (adversite, coupeur_de_tetes,
// indoor, rivalite) a 0. Le point deja re-accorde par
// patch_redo_coaching_mental_20260914 (points_dispositions_a_gagner=1) reste
// disponible pour qu'elle le replace pour de bon via le systeme corrige.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_eva_dispositions_20260914 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_eva_dispositions_20260914 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const joueur = db.prepare(`
        SELECT id, prenom, nom, disposition_adversite, disposition_coupeur_de_tetes, disposition_dernier_carre,
               disposition_premiers_tours, disposition_sang_froid, disposition_indoor, disposition_rivalite
        FROM players WHERE prenom = ? COLLATE NOCASE AND nom = ? COLLATE NOCASE
    `).get('Eva', 'Noviče');
    if (!joueur) {
        console.log('[eva_dispositions] "Eva Noviče" introuvable, rien fait');
    } else {
        db.prepare(`
            UPDATE players SET
                disposition_adversite = 0, disposition_coupeur_de_tetes = 0, disposition_dernier_carre = 2,
                disposition_premiers_tours = 5, disposition_sang_froid = 5, disposition_indoor = 0, disposition_rivalite = 0
            WHERE id = ?
        `).run(joueur.id);
        console.log('[eva_dispositions] Eva Noviče (id ' + joueur.id + ') : etait adversite=' + joueur.disposition_adversite +
            ', coupeur_de_tetes=' + joueur.disposition_coupeur_de_tetes + ', dernier_carre=' + joueur.disposition_dernier_carre +
            ', premiers_tours=' + joueur.disposition_premiers_tours + ', sang_froid=' + joueur.disposition_sang_froid +
            ', indoor=' + joueur.disposition_indoor + ', rivalite=' + joueur.disposition_rivalite +
            ' -> desormais 0/0/2/5/5/0/0');
    }
    db.prepare('UPDATE jeu_etat SET patch_eva_dispositions_20260914 = 1 WHERE id = 1').run();
}

try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_rotterdam_doublon_20260914 INTEGER DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_recalage_tournois_20260914 INTEGER DEFAULT 0"); } catch (e) {}

// Suppression de tous les avatars personnalises deja poses par des joueurs avant
// que la gestion des avatars ne soit reservee a l'admin (2026-09-14) - demande
// explicite de l'utilisateur, 2026-09-16. Supprime le fichier sur disque puis vide
// la colonne en base ; la fonctionnalite elle-meme reste utilisable par un admin
// (aucun changement de route/permission ici, cf. joueurGerableParAvatar dans
// server.js). Marqueur jeu_etat garantit un passage unique.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_suppression_avatars_20260916 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_suppression_avatars_20260916 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const dossierDonnees = process.env.DATA_DIR || __dirname;
    const joueursAvecAvatar = db.prepare("SELECT id, photo_avatar FROM players WHERE photo_avatar IS NOT NULL").all();
    for (const joueur of joueursAvecAvatar) {
        try { fs.unlinkSync(path.join(dossierDonnees, joueur.photo_avatar)); } catch (e) {}
    }
    db.prepare("UPDATE players SET photo_avatar = NULL WHERE photo_avatar IS NOT NULL").run();
    console.log('[patch_suppression_avatars_20260916] avatars supprimes :', joueursAvecAvatar.length);
    db.prepare("UPDATE jeu_etat SET patch_suppression_avatars_20260916 = 1 WHERE id = 1").run();
}

// Rattrape les tournois deja tires AVANT le renommage LUND -> JORGENSEN
// (patch_lund_jorgensen_20260912 ci-dessus) : tournoi_joueurs.nom est une COPIE
// figee au moment du tirage (genererEntrants), pas une valeur relue en direct
// depuis players/classement_joueurs - un tableau deja tire avant cette date
// affichait donc encore "Lund" meme apres le renommage de la source (signale par
// l'utilisateur, 2026-09-17 : "Tomas Jorgensen" apparaissait comme "Tomas Lund"
// dans le tableau d'un tournoi). Meme id=254 et meme regle de mot entier (\bLUND\b)
// que le patch d'origine, pour ne jamais toucher un autre "Lund"/"Lundgren"
// homonyme legitime (Lund existe aussi comme patronyme distinct dans
// noms-locaux.js).
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_lund_jorgensen_tournois_20260917 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_lund_jorgensen_tournois_20260917 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const NOUVEAU_NOM = 'JØRGENSEN';
    const lignes = db.prepare("SELECT id, nom FROM tournoi_joueurs WHERE player_id = 254 OR rival_id = 254").all();
    let compteur = 0;
    lignes.forEach(function (ligne) {
        if (/\bLUND\b/i.test(ligne.nom || '')) {
            const nomMisAJour = ligne.nom.replace(/\bLUND\b/i, NOUVEAU_NOM);
            db.prepare('UPDATE tournoi_joueurs SET nom = ? WHERE id = ?').run(nomMisAJour, ligne.id);
            compteur++;
        }
    });
    console.log('[patch_lund_jorgensen_tournois_20260917] lignes tournoi_joueurs corrigees :', compteur);
    db.prepare('UPDATE jeu_etat SET patch_lund_jorgensen_tournois_20260917 = 1 WHERE id = 1').run();
}

// Retire les capitaines de Coupe Davis / BJK Cup deja designes en Saison 1 -
// demande explicite de l'utilisateur, 2026-09-18 : le capitainat (candidature/
// vote/repli automatique) ne doit s'activer qu'a partir de la Saison 2, le temps
// que les coachs decouvrent la fonctionnalite. Les garde-fous cote server.js
// (candidature, vote, resolution automatique en fin de S1) empechent desormais
// toute nouvelle designation en Saison 1, mais ceux deja resolus par le repli
// automatique (aucune candidature/vote necessaire pour se declencher) doivent
// etre annules retroactivement. "saison" ici est deja le numero AFFICHE (voir
// nombreSaisonAffichee/phaseAffichee cote server.js), donc "= 1" cible
// precisement la Saison 1 affichee, jamais une saison bots anterieure au
// decalage d'affichage.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_retrait_capitaines_saison1_20260918 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_retrait_capitaines_saison1_20260918 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const capitaines = db.prepare('DELETE FROM coupe_capitaines WHERE saison = 1').run();
    const candidatures = db.prepare('DELETE FROM coupe_candidatures WHERE saison = 1').run();
    const votes = db.prepare('DELETE FROM coupe_votes WHERE saison = 1').run();
    console.log('[patch_retrait_capitaines_saison1_20260918] capitaines/candidatures/votes retires :',
        capitaines.changes, candidatures.changes, votes.changes);
    db.prepare('UPDATE jeu_etat SET patch_retrait_capitaines_saison1_20260918 = 1 WHERE id = 1').run();
}

// Rattrapage RETROACTIF de l'erosion des automatismes sur un entrainement de surface
// (demande explicite de l'utilisateur, 2026-09-18, a la suite du correctif de
// executerAvancementSemaine dans server.js) : avant ce correctif, le changement de
// semaine qui creditait un entrainement de surface (+15) retirait aussitot 5 sur cette
// meme surface (net +10). Le journal hebdomadaire garde l'automatisme avant/apres de
// chaque surface : une ligne dont action_prevue = surface_X ET dont apres ==
// (credite - 5), avec credite = avant > 15 ? 30 : avant + 15, est PRECISEMENT une
// transition victime de ce bug - aucune ligne deja correcte (apres == credite, ex.
// produite apres le correctif) n'est jamais retouchee. Chaque ligne rend +5 a la
// valeur COURANTE de la surface (plafond 30). Limite aux lignes de la saison en
// cours : appliquerResetPreSaison remet tous les automatismes a 0 a chaque nouvelle
// saison, un rattrapage sur une saison anterieure ajouterait des points de nulle part.
// Approximation assumee : un plancher a 0 ou un plafond a 30 atteint depuis pourrait
// absorber une partie des 5 points, ce qui ne peut que sous-restituer, jamais depasser
// 30 (garanti par le plafond).
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_automatismes_retroactif_20260918 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_automatismes_retroactif_20260918 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const { LONGUEUR_SAISON } = require('./calendrier-tournois');
    const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;
    const debutSaison = semaineActuelle - ((semaineActuelle - 1) % LONGUEUR_SAISON);
    const lignes = db.prepare(`
        SELECT player_id, semaine, action_prevue,
               automatismes_dur_avant, automatismes_dur_apres,
               automatismes_terre_avant, automatismes_terre_apres,
               automatismes_herbe_avant, automatismes_herbe_apres
        FROM journal_semaine_joueur
        WHERE action_prevue IN ('surface_dur', 'surface_terre', 'surface_herbe') AND semaine >= ?
    `).all(debutSaison);
    let corrigees = 0;
    lignes.forEach(function (ligne) {
        const surf = ligne.action_prevue.replace('surface_', '');
        const avant = ligne['automatismes_' + surf + '_avant'];
        const apres = ligne['automatismes_' + surf + '_apres'];
        if (avant === null || apres === null) return;
        const credite = avant > 15 ? 30 : Math.min(30, avant + 15);
        if (apres !== credite - 5) return;
        // surf vient de la liste blanche ci-dessus (dur/terre/herbe), jamais d'une saisie
        const col = 'surface_' + surf + '_automatismes';
        const r = db.prepare('UPDATE players SET ' + col + ' = MIN(30, ' + col + ' + 5) WHERE id = ?').run(ligne.player_id);
        if (r.changes > 0) {
            corrigees++;
            console.log('[patch_automatismes_retroactif_20260918] player ' + ligne.player_id + ' semaine ' + ligne.semaine + ' : +5 sur ' + surf);
        }
    });
    console.log('[patch_automatismes_retroactif_20260918] transitions rattrapees :', corrigees, '/', lignes.length, 'lignes d\'entrainement de surface examinees');
    db.prepare('UPDATE jeu_etat SET patch_automatismes_retroactif_20260918 = 1 WHERE id = 1').run();
}

// Retrait des rencontres de Coupe Davis/Fed Cup de la Saison 1 (2026-09-21, bug
// signale par l'utilisateur : "Coupe Davis" affichee en S4 dans la programmation
// alors qu'il n'y en a pas en Saison 1). Reliquat d'un tableau cree avant la regle
// "pas de Coupe Davis en Saison 1" ou avant le passage a 52 semaines.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_retrait_coupe_saison1_v2_20260921 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_retrait_coupe_saison1_v2_20260921 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    // Selon la saison AFFICHEE de la semaine du match (tie.saison peut etre fausse sur un
    // reliquat, cas de Nikola STAKHAN : rencontre en S4 de la Saison 1 mais saison != 1).
    const { phaseDeSemaine } = require('./calendrier-tournois');
    const decalage = (db.prepare('SELECT saison_offset FROM jeu_etat WHERE id = 1').get().saison_offset) || 0;
    const ids = db.prepare('SELECT id, semaine FROM coupe_equipes').all()
        .filter(function (r) { return phaseDeSemaine(r.semaine).numeroSaison - decalage <= 1; })
        .map(function (r) { return r.id; });
    ids.forEach(function (id) {
        db.prepare('DELETE FROM coupe_composition WHERE coupe_equipe_id = ?').run(id);
        db.prepare('DELETE FROM coupe_rubbers WHERE coupe_equipe_id = ?').run(id);
        db.prepare('DELETE FROM coupe_styles WHERE coupe_equipe_id = ?').run(id);
    });
    ids.forEach(function (id) { db.prepare('DELETE FROM coupe_equipes WHERE id = ?').run(id); });
    db.prepare('DELETE FROM coupe_groupe_mondial WHERE saison = 1').run();
    console.log('[patch_retrait_coupe_saison1_v2_20260921] rencontres de Saison 1 retirees :', ids.length);
    db.prepare('UPDATE jeu_etat SET patch_retrait_coupe_saison1_v2_20260921 = 1 WHERE id = 1').run();
}

// Badge Sang-froid : recomptage RETROACTIF de TOUTES les balles de break sauvees
// (2026-09-21, demande explicite de l'utilisateur). Avant, le moteur ne comptait que
// les balles de break qui auraient aussi termine un set/match. Les evenements du
// teletexte de chaque match sont conserves (matchs.evenements, toujours du point de
// vue du joueur de la ligne : "Toi") - une balle de break sauvee y est tracee par
// "Break sauve par Toi". On ne fait jamais BAISSER un compteur existant.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_break_sauvees_toutes_20260921 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_break_sauvees_toutes_20260921 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    let modifies = 0;
    const lignes = db.prepare('SELECT id, balles_break_sauvees AS b, evenements FROM matchs WHERE (tournoi_id IS NOT NULL OR coupe_equipe_id IS NOT NULL) AND evenements IS NOT NULL').all();
    lignes.forEach(function (l) {
        let ev;
        try { ev = JSON.parse(l.evenements); } catch (e) { return; }
        if (!Array.isArray(ev)) return;
        const n = ev.filter(function (x) { return x && x.type === 'point_important' && typeof x.texte === 'string' && x.texte.indexOf('Break sauve par Toi') === 0; }).length;
        if (n > (l.b || 0)) {
            db.prepare('UPDATE matchs SET balles_break_sauvees = ? WHERE id = ?').run(n, l.id);
            modifies++;
        }
    });
    console.log('[patch_break_sauvees_toutes_20260921] matchs recomptes :', modifies, '/', lignes.length);
    db.prepare('UPDATE jeu_etat SET patch_break_sauvees_toutes_20260921 = 1 WHERE id = 1').run();
}

// Trace permanente de chaque validation de repartition d'XP (2026-09-21, demande
// explicite de l'utilisateur, a la suite du cas de Vane id 121 dont la repartition de
// la S2 n'etait plus en base au changement de semaine) : players.xp_repartition_en_attente
// est ecrasee a chaque nouvelle validation puis effacee au changement de semaine, donc
// aucune trace ne restait de ce que le coach avait valide ni de l'heure.
db.exec(`
    CREATE TABLE IF NOT EXISTS xp_repartition_historique (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        semaine INTEGER NOT NULL,
        repartition TEXT NOT NULL,
        total INTEGER NOT NULL,
        points_experience INTEGER NOT NULL,
        horodatage TEXT NOT NULL
    )
`);

// Correction ponctuelle : les 8 points de deplacement valides par Vane (id 121) en S2
// ne se sont jamais appliques au passage en S3 (journal : deplacement 9 -> 9, aucune
// repartition trouvee par le moteur). On ne touche que si la valeur est encore celle
// constatee (9) et pour cette joueuse precisement - jamais si elle a bouge depuis.
try { db.exec("ALTER TABLE jeu_etat ADD COLUMN patch_vane_xp_s2_20260921 INTEGER DEFAULT 0"); } catch (e) {}
if (db.prepare('SELECT patch_vane_xp_s2_20260921 AS p FROM jeu_etat WHERE id = 1').get().p === 0) {
    const vane = db.prepare("SELECT id, deplacement FROM players WHERE id = 121 AND prenom = 'April' COLLATE NOCASE AND nom = 'Vane' COLLATE NOCASE").get();
    if (vane && vane.deplacement === 9) {
        db.prepare('UPDATE players SET deplacement = 17 WHERE id = 121').run();
        console.log('[patch_vane_xp_s2_20260921] April Vane (id 121) : deplacement 9 -> 17');
    } else {
        console.log('[patch_vane_xp_s2_20260921] non applique (joueuse absente ou deplacement =', vane ? vane.deplacement : 'n/a', ')');
    }
    db.prepare('UPDATE jeu_etat SET patch_vane_xp_s2_20260921 = 1 WHERE id = 1').run();
}

module.exports = db;