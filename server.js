require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { Resend } = require('resend');
const db = require('./database');
const { BAREME_POINTS, CALENDRIER_TOURNOIS, SEMAINES_COUPES_EQUIPE, genererJoueurLambda, drapeau, normaliserPays, phaseDeSemaine, LONGUEUR_SAISON } = require('./calendrier-tournois');

// Fenetre du classement Live (52 dernieres semaines glissantes) : un nombre fixe,
// independant de LONGUEUR_SAISON (duree du cycle de saison ingame, cf.
// calendrier-tournois.js) - les deux notions sont sans rapport et ne doivent
// jamais partager la meme constante.
const FENETRE_LIVE = 52;

// Photos d'articles de presse : dossier servi statiquement (voir express.static
// plus bas), cree au demarrage s'il n'existe pas encore (absent du depot). Meme
// logique DATA_DIR que database.js : sur Railway, doit vivre sur le volume
// persistant, sinon les photos uploadees disparaitraient a chaque redeploiement.
const DOSSIER_DONNEES = process.env.DATA_DIR || __dirname;
const DOSSIER_UPLOADS_PRESSE = path.join(DOSSIER_DONNEES, 'uploads', 'presse');
fs.mkdirSync(DOSSIER_UPLOADS_PRESSE, { recursive: true });

const uploadPresse = multer({
    storage: multer.diskStorage({
        destination: DOSSIER_UPLOADS_PRESSE,
        filename: function (req, file, cb) {
            const extension = path.extname(file.originalname).toLowerCase();
            cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + extension);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const autorises = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!autorises.includes(file.mimetype)) {
            return cb(new Error('Format d\'image non supporté (jpg, png, webp ou gif uniquement).'));
        }
        cb(null, true);
    }
});

// Avatar personnalise d'un joueur reel (rectangle, remplace l'icone generique
// icone-joueur.png/icone-joueuse.png sur joueur.html/adversaire.html quand present) -
// meme dossier de stockage statique + meme logique DATA_DIR que les photos de
// Presse ci-dessus.
const DOSSIER_UPLOADS_AVATARS = path.join(DOSSIER_DONNEES, 'uploads', 'avatars');
fs.mkdirSync(DOSSIER_UPLOADS_AVATARS, { recursive: true });

const uploadAvatar = multer({
    storage: multer.diskStorage({
        destination: DOSSIER_UPLOADS_AVATARS,
        filename: function (req, file, cb) {
            const extension = path.extname(file.originalname).toLowerCase();
            cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + extension);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const autorises = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!autorises.includes(file.mimetype)) {
            return cb(new Error('Format d\'image non supporté (jpg, png, webp ou gif uniquement).'));
        }
        cb(null, true);
    }
});

// Tant qu'aucune cle Resend n'est configuree (.env), le reste du jeu doit
// continuer a fonctionner normalement - seul l'envoi du mail de reinitialisation
// est indisponible (le constructeur Resend() plante sinon des le demarrage).
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

const app = express();
const PORT = process.env.PORT || 3000;

// Necessaire derriere le proxy/edge de Railway : sans ca, req.secure vaut toujours
// false (le cookie de session ne passerait jamais en HTTPS-only) et req.ip renvoie
// l'IP interne du proxy plutot que la vraie IP du visiteur (casse la regle anti-
// doublon "1 compte par IP" a l'inscription).
app.set('trust proxy', 1);

app.use('/uploads', express.static(path.join(DOSSIER_DONNEES, 'uploads')));
app.use(express.static(__dirname));
app.use(express.json());
app.use(cookieParser());

const DUREE_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function creerSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiration = new Date(Date.now() + DUREE_SESSION_MS).toISOString();
    db.prepare('INSERT INTO sessions (token, user_id, date_expiration) VALUES (?, ?, ?)').run(token, userId, expiration);
    return token;
}

function poserCookieSession(req, res, token) {
    res.cookie('session_token', token, {
        httpOnly: true,
        secure: req.secure,
        sameSite: 'lax',
        maxAge: DUREE_SESSION_MS,
        path: '/'
    });
}

// Routes qui doivent rester joignables sans etre connecte (connexion/inscription
// elles-memes, mot de passe oublie, et les quelques lectures publiques deja
// utilisees par index.html/statistiques.html/presse.html avant/sans connexion).
function estRoutePublique(req) {
    if (req.method === 'POST') {
        return ['/api/inscription', '/api/connexion', '/api/deconnexion', '/api/mot-de-passe-oublie', '/api/reinitialiser-mot-de-passe'].includes(req.path);
    }
    if (req.method === 'GET') {
        if (['/api/semaine', '/api/public/tournois-en-cours', '/api/public/classement', '/api/annuaire/coachs',
            '/api/presse', '/api/presse/options-liens', '/api/statistiques/confrontations',
            '/api/statistiques/almanach', '/api/statistiques/records', '/api/annonce'].includes(req.path)) {
            return true;
        }
        if (req.path.startsWith('/api/annuaire/joueurs/')) return true;
        if (/^\/api\/presse\/\d+$/.test(req.path)) return true;
        return false;
    }
    return false;
}

// Seule source de verite pour l'identite de l'appelant desormais (req.userId) -
// remplace le userId envoye en clair par le client a chaque appel, jamais verifie
// avant ce chantier (2026-08-11).
function authentifier(req, res, next) {
    if (!req.path.startsWith('/api/')) return next();
    if (estRoutePublique(req)) return next();

    const token = req.cookies.session_token;
    if (!token) return res.status(401).json({ error: 'Non connecte.' });

    const session = db.prepare('SELECT user_id, date_expiration FROM sessions WHERE token = ?').get(token);
    if (!session || new Date(session.date_expiration) < new Date()) {
        if (session) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        res.clearCookie('session_token', { path: '/' });
        return res.status(401).json({ error: 'Session expiree, reconnecte-toi.' });
    }

    req.userId = session.user_id;
    next();
}

app.use(authentifier);

const BUDGET_POINTS = 120;
// Un personnage cree en cours de saison part avec un budget de competences plus
// eleve que 120 (rattrapage) : +4 points par semaine de tournoi deja ecoulee cette
// saison (S1, S2, ... - la Pre-saison/Semaine 0 ne comptent pas, aucun tournoi ne
// s'y joue). Demande explicite de l'utilisateur, 2026-08-28 : "si on arrive en S10
// on aurait 160 xp a repartir" (120 + 4*10).
const BONUS_BUDGET_PAR_SEMAINE = 4;
function budgetActuelCompetences() {
    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const phase = phaseDeSemaine(etat.semaine_actuelle);
    const bonus = phase.type === 'tournoi' ? phase.positionSemaine * BONUS_BUDGET_PAR_SEMAINE : 0;
    return BUDGET_POINTS + bonus;
}
const COMPETENCES = ['service', 'retour', 'coup_droit_revers', 'effet', 'volee', 'deplacement', 'puissance', 'resistance'];
const DISPOSITIONS = ['adversite', 'coupeur_de_tetes', 'dernier_carre', 'premiers_tours', 'sang_froid', 'indoor', 'rivalite'];
const STYLES_JEU = ['sprinter', 'prudence', 'en_avant', 'marathonien', 'mental_acier', 'reperage', 'aucun'];
const BUDGET_DISPOSITIONS = 12;
const MAX_PAR_DISPOSITION = 5;
const SURFACES = ['dur', 'terre', 'herbe'];
const ACTIONS_VALIDES = ['repos', 'generique', 'surface_dur', 'surface_terre', 'surface_herbe', 'coaching_mental'];

function formeMax(usure) {
    return Math.min(100, (100 - usure / 10) + 3);
}

// Malus de niveau de jeu selon la condition physique du joueur (PDF) : aucun en
// pleine forme, -50 fatigue, -100 diminue. Un joueur blesse ne simule jamais de
// match (forfait immediat), donc jamais concerne par ce malus.
function malusCondition(condition) {
    if (condition === 'fatigue') return 50;
    if (condition === 'diminue') return 100;
    return 0;
}

// Perte aleatoire d'1 point parmi les 8 competences techniques deja non-nulles,
// appliquee quand la condition d'un joueur se degrade reellement pendant un match
// (PDF : "parmi les competences deja remplies, une perd 1 point tire au sort").
function appliquerPerteCaracteristique(playerId) {
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
    if (!player) return;
    const candidates = COMPETENCES.filter(function (c) { return player[c] > 0; });
    if (candidates.length === 0) return;
    const cle = candidates[Math.floor(Math.random() * candidates.length)];
    db.prepare(`UPDATE players SET ${cle} = ${cle} - 1 WHERE id = ?`).run(playerId);
}

// Degradation de la condition (En forme -> Fatigue -> Diminue -> Blesse), regle
// exacte du PDF : par jeu joue, probabilite en pour mille = 10 (si plus d'energie)
// + (80 - forme) si forme < 80. Si le tirage reussit et forme < 60, saut direct a
// "Blesse" quel que soit l'etat courant. forme/points_energie doivent etre les
// valeurs AVANT le match (constantes pendant tout le match), pas les valeurs deja
// mises a jour post-match - seule la CONDITION evolue reellement en cours de match
// desormais (voir tirageDegradationJeu, appele depuis simulerMatch).
const CONDITION_ORDRE = ['en_forme', 'fatigue', 'diminue', 'blesse'];

// Tirage de degradation pour UN SEUL jeu (remplace l'ancien degraderCondition, qui
// bouclait "a l'aveugle" APRES le match sans jamais savoir a quel jeu precis la
// degradation avait eu lieu - desormais appele depuis l'interieur de simulerMatch,
// jeu par jeu, ce qui permet a la fois d'inserer l'alerte au bon endroit dans le
// teletexte ET de degrader le niveau de jeu pour le reste du match, comme prevu par
// le reglement (demande explicite de l'utilisateur, 2026-08-21).
function tirageDegradationJeu(condition, forme, pointsEnergie) {
    const chancePourMille = (pointsEnergie <= 0 ? 10 : 0) + (forme < 80 ? (80 - forme) : 0);
    if (chancePourMille <= 0) return condition;
    if (Math.random() * 1000 >= chancePourMille) return condition;
    if (forme < 60) return 'blesse';
    const index = CONDITION_ORDRE.indexOf(condition);
    return CONDITION_ORDRE[Math.min(index + 1, CONDITION_ORDRE.length - 1)];
}

// "Le kine est intervenu pendant CE match" = la condition s'est reellement degradee
// entre le debut et la fin de ce match precis (pas juste "il etait deja diminue en
// arrivant"). Un forfait blessure n'appelle jamais degraderCondition (aucune
// simulation n'a lieu), donc n'est jamais marque comme une degradation "pendant" le match.
function conditionSestDegradee(avant, apres) {
    return CONDITION_ORDRE.indexOf(apres) > CONDITION_ORDRE.indexOf(avant || 'en_forme');
}

// Anti-doublon de comptes : 1 seul compte par adresse IP, sans exception pour
// localhost (choix explicite de l'utilisateur, plus strict que "1 personne = 1
// compte" habituel puisque ca s'applique aussi en dev/local).
const LIMITE_COMPTES_PAR_IP = 1;

// Railway ajoute son propre maillon devant l'appli (X-Forwarded-For contient au
// moins 2 adresses : le vrai visiteur, puis un hop interne Railway) - avec "trust
// proxy: 1", Express renvoyait ce hop interne (identique pour tout le monde) au
// lieu du vrai visiteur, bloquant TOUTES les inscriptions des le 2e compte jamais
// cree (bug trouve le 2026-08-17). On lit directement le premier maillon de
// l'en-tete plutot que de compter les hops avec trust proxy - repli sur req.ip si
// l'en-tete est absent (dev local, pas de proxy).
function ipReelle(req) {
    const xff = req.headers['x-forwarded-for'];
    return xff ? xff.split(',')[0].trim() : req.ip;
}

app.post('/api/inscription', (req, res) => {
    try {
        const etatInscriptions = db.prepare('SELECT inscriptions_ouvertes FROM jeu_etat WHERE id = 1').get();
        if (!etatInscriptions.inscriptions_ouvertes) {
            return res.status(403).json({ error: 'Les inscriptions sont temporairement fermées. Réessaie un peu plus tard.' });
        }

        const { email, password, pseudo } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email et mot de passe requis.' });
        }
        const pseudoNettoye = (pseudo || '').trim();
        if (!pseudoNettoye) {
            return res.status(400).json({ error: 'Le pseudo de coach est obligatoire.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caracteres.' });
        }

        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existing) {
            return res.status(409).json({ error: 'Un compte existe deja avec cet email.' });
        }

        const ip = ipReelle(req);
        const nbComptesIp = db.prepare('SELECT COUNT(*) AS n FROM users WHERE ip_inscription = ?').get(ip).n;
        if (nbComptesIp >= LIMITE_COMPTES_PAR_IP) {
            return res.status(409).json({ error: 'Limite IP atteinte : un compte a deja ete cree depuis cette connexion (un seul compte par personne).' });
        }

        const passwordHash = bcrypt.hashSync(password, 10);
        const result = db.prepare('INSERT INTO users (email, password_hash, ip_inscription, pseudo) VALUES (?, ?, ?, ?)').run(email, passwordHash, ip, pseudoNettoye);

        poserCookieSession(req, res, creerSession(result.lastInsertRowid));
        res.json({ success: true, userId: result.lastInsertRowid });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

function competencesValides(joueur, budget) {
    let total = 0;
    for (const cle of COMPETENCES) {
        const valeur = Number(joueur[cle]);
        if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) {
            return false;
        }
        total += valeur;
    }
    return total === budget;
}

function dispositionsValides(joueur) {
    let total = 0;
    for (const cle of DISPOSITIONS) {
        const valeur = Number(joueur['disp_' + cle]);
        if (!Number.isFinite(valeur) || valeur < 0 || valeur > MAX_PAR_DISPOSITION) {
            return false;
        }
        total += valeur;
    }
    return total === BUDGET_DISPOSITIONS;
}

// Lettres (accents compris), espaces, apostrophes et tirets uniquement - meme jeu
// de caracteres que celui deja suppose par capitaliserPrenom/formaterNom partout
// ailleurs dans le jeu. Rejette chiffres, caracteres speciaux, chaine vide/blanche.
function nomValide(texte) {
    return /^\p{L}+([\s'-]\p{L}+)*$/u.test((texte || '').trim());
}

function calculerNiveau(joueur) {
    const total = COMPETENCES.reduce(function (somme, cle) { return somme + Number(joueur[cle]); }, 0);
    return Math.round((total / COMPETENCES.length) * 10) / 10;
}

// Un joueur avec une perte de disposition d'intersaison non resolue doit d'abord
// passer par /api/repartir-dispositions-perte avant toute autre action le concernant.
function aDesPertesDispositionsEnAttente(playerId) {
    const player = db.prepare('SELECT points_dispositions_a_retirer FROM players WHERE id = ?').get(playerId);
    return !!player && player.points_dispositions_a_retirer > 0;
}

// Meme principe pour la moulinette d'intersaison (regle PDF) : un joueur avec un
// budget de competences en attente de repartition doit d'abord passer par
// /api/joueurs/repartir-competences-moulinette avant toute autre action.
function aDesCompetencesARepartir(playerId) {
    const player = db.prepare('SELECT points_competences_a_repartir FROM players WHERE id = ?').get(playerId);
    return !!player && player.points_competences_a_repartir > 0;
}

app.post('/api/joueurs', (req, res) => {
    try {
        const userId = req.userId;
        const { joueur, joueuse } = req.body;

        if (!joueur || !joueuse) {
            return res.status(400).json({ error: 'Il manque les infos d un des deux personnages.' });
        }
        if (!nomValide(joueur.prenom) || !nomValide(joueur.nom)) {
            return res.status(400).json({ error: 'Le prenom et le nom du joueur ne peuvent contenir que des lettres, espaces, apostrophes ou tirets.' });
        }
        if (!nomValide(joueuse.prenom) || !nomValide(joueuse.nom)) {
            return res.status(400).json({ error: 'Le prenom et le nom de la joueuse ne peuvent contenir que des lettres, espaces, apostrophes ou tirets.' });
        }
        const budgetCourant = budgetActuelCompetences();
        if (!competencesValides(joueur, budgetCourant)) {
            return res.status(400).json({ error: 'Le total des competences du joueur doit faire exactement ' + budgetCourant + ' points.' });
        }
        if (!competencesValides(joueuse, budgetCourant)) {
            return res.status(400).json({ error: 'Le total des competences de la joueuse doit faire exactement ' + budgetCourant + ' points.' });
        }
        if (!dispositionsValides(joueur)) {
            return res.status(400).json({ error: 'Le total des dispositions du joueur doit faire exactement ' + BUDGET_DISPOSITIONS + ' points.' });
        }
        if (!dispositionsValides(joueuse)) {
            return res.status(400).json({ error: 'Le total des dispositions de la joueuse doit faire exactement ' + BUDGET_DISPOSITIONS + ' points.' });
        }

        // Garde-fou anti-doublon : rien n'empechait un double-clic/double-soumission
        // du formulaire de creation de personnages de creer 2 fois la paire
        // joueur+joueuse pour le meme compte, silencieusement (bug signale par
        // l'utilisateur, 2026-08-20 - doublon visible dans l'annuaire).
        const dejaCree = db.prepare('SELECT COUNT(*) AS n FROM players WHERE user_id = ?').get(userId).n;
        if (dejaCree > 0) {
            return res.status(400).json({ error: 'Ce compte a deja des personnages crees.' });
        }

        // Un motif de refus eventuel ne concernait que la tentative precedente -
        // efface au moment ou une nouvelle paire est soumise.
        db.prepare('UPDATE users SET dernier_refus_motif = NULL, dernier_refus_date = NULL WHERE id = ?').run(userId);

        const insert = db.prepare(`
            INSERT INTO players (
                user_id, type, prenom, nom, age, taille, nationalite, main_forte, statut,
                service, retour, coup_droit_revers, effet, volee, deplacement, puissance, resistance,
                niveau, points_energie, points_experience,
                surface_dur_automatismes, surface_terre_automatismes, surface_herbe_automatismes,
                disposition_adversite, disposition_coupeur_de_tetes, disposition_dernier_carre,
                disposition_premiers_tours, disposition_sang_froid, disposition_indoor, disposition_rivalite
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en_attente', ?, ?, ?, ?, ?, ?, ?, ?, ?, 50, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)
        `);

        insert.run(
            userId, 'joueur', joueur.prenom, joueur.nom, joueur.age, joueur.taille, joueur.nationalite, joueur.main,
            joueur.service, joueur.retour, joueur.coup_droit_revers, joueur.effet, joueur.volee, joueur.deplacement, joueur.puissance, joueur.resistance,
            calculerNiveau(joueur),
            joueur.disp_adversite, joueur.disp_coupeur_de_tetes, joueur.disp_dernier_carre,
            joueur.disp_premiers_tours, joueur.disp_sang_froid, joueur.disp_indoor, joueur.disp_rivalite
        );

        insert.run(
            userId, 'joueuse', joueuse.prenom, joueuse.nom, joueuse.age, joueuse.taille, joueuse.nationalite, joueuse.main,
            joueuse.service, joueuse.retour, joueuse.coup_droit_revers, joueuse.effet, joueuse.volee, joueuse.deplacement, joueuse.puissance, joueuse.resistance,
            calculerNiveau(joueuse),
            joueuse.disp_adversite, joueuse.disp_coupeur_de_tetes, joueuse.disp_dernier_carre,
            joueuse.disp_premiers_tours, joueuse.disp_sang_froid, joueuse.disp_indoor, joueuse.disp_rivalite
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Expose le budget de competences ACTUEL (voir budgetActuelCompetences) a
// creation-joueurs.html, pour afficher/valider le bon total avant meme la
// soumission - la route de creation elle-meme recalcule ce budget independamment
// (la source de verite reste server-side), cette route ne sert qu'a l'affichage.
app.get('/api/budget-creation', (req, res) => {
    try {
        res.json({ success: true, budget: budgetActuelCompetences() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/connexion', (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email et mot de passe requis.' });
        }

        const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);

        if (!user) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        const passwordMatches = bcrypt.compareSync(password, user.password_hash);
        if (!passwordMatches) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        }

        // Moulinette differee (voir marquerMoulinetteEnAttente/appliquerMoulinettePourJoueur) :
        // applique maintenant, avec les competences A JOUR, a chaque joueur de ce coach
        // qui attendait ce calcul depuis son dernier passage en S49 - peu importe la
        // saison/semaine de jeu atteinte entretemps (demande explicite de l'utilisateur,
        // 2026-08-25).
        db.prepare("SELECT * FROM players WHERE user_id = ? AND moulinette_en_attente = 1").all(user.id)
            .forEach(function (player) { appliquerMoulinettePourJoueur(player); });

        poserCookieSession(req, res, creerSession(user.id));
        res.json({ success: true, userId: user.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/deconnexion', (req, res) => {
    const token = req.cookies.session_token;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie('session_token', { path: '/' });
    res.json({ success: true });
});

// Duree de validite d'un jeton de reinitialisation de mot de passe.
const EXPIRATION_RESET_MOT_DE_PASSE_MS = 60 * 60 * 1000; // 1 heure

app.post('/api/mot-de-passe-oublie', (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Adresse e-mail requise.' });
        }

        const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);

        // Reponse identique que le compte existe ou non, pour ne jamais reveler
        // si une adresse e-mail est inscrite (enumeration de comptes).
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            const expire = new Date(Date.now() + EXPIRATION_RESET_MOT_DE_PASSE_MS).toISOString();
            db.prepare('UPDATE users SET reset_token = ?, reset_token_expire = ? WHERE id = ?').run(token, expire, user.id);

            const lienReset = SITE_URL + '/reinitialiser-mot-de-passe.html?token=' + token;
            if (resend) {
                resend.emails.send({
                    // A remplacer par une adresse sur un domaine verifie dans Resend
                    // (ex. noreply@tondomaine.fr) une fois le domaine ajoute - en
                    // attendant, onboarding@resend.dev ne delivre reellement qu'aux
                    // adresses de test Resend, pas aux vrais coachs.
                    from: 'Tennis Web Manager <onboarding@resend.dev>',
                    to: [user.email],
                    subject: 'Réinitialisation de ton mot de passe',
                    html: `
                        <p>Tu as demandé la réinitialisation de ton mot de passe sur Tennis Web Manager.</p>
                        <p><a href="${lienReset}">Clique ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p>
                        <p>Si tu n'es pas à l'origine de cette demande, ignore simplement cet e-mail.</p>
                    `
                }).catch(function (err) { console.error('Erreur envoi e-mail reset :', err); });
            } else {
                console.log('[RESEND_API_KEY absente] Lien de reinitialisation pour ' + user.email + ' : ' + lienReset);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/reinitialiser-mot-de-passe', (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ error: 'Jeton et nouveau mot de passe requis.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
        }

        const user = db.prepare('SELECT id, reset_token_expire FROM users WHERE reset_token = ?').get(token);
        if (!user || new Date(user.reset_token_expire) < new Date()) {
            return res.status(400).json({ error: 'Ce lien de réinitialisation est invalide ou a expiré.' });
        }

        const passwordHash = bcrypt.hashSync(password, 10);
        db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expire = NULL WHERE id = ?').run(passwordHash, user.id);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/joueurs/:userId', (req, res) => {
    try {
        const userId = req.userId;
        const players = db.prepare('SELECT * FROM players WHERE user_id = ?').all(userId);

        players.forEach(function (player) {
            SURFACES.forEach(function (surface) {
                const niveauBase = niveauNormal(player, surface);
                player['surface_' + surface + '_niveau'] = Math.round(niveauBase * 100) / 100;
                player['surface_' + surface + '_niveau_mental'] = Math.round((niveauBase + player.mental_courant) * 100) / 100;

                const niveauDoubleBase = niveauDouble(player, surface);
                player['surface_' + surface + '_niveau_double'] = Math.round(niveauDoubleBase * 100) / 100;
                player['surface_' + surface + '_niveau_mental_double'] = Math.round((niveauDoubleBase + player.mental_courant) * 100) / 100;
            });
            player.drapeau = drapeau(player.nationalite);
        });

        res.json({ success: true, players });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Avatar personnalise d'un joueur reel : remplace la photo existante s'il y en
// avait deja une (ancien fichier supprime du disque, pas seulement ecrase en
// base). Le proprietaire du joueur peut gerer sa propre photo ; un admin peut en
// plus le faire sur N'IMPORTE QUEL joueur (seul l'admin doit pouvoir poser une
// photo sur la fiche d'un joueur qui n'est pas le sien, demande explicite de
// l'utilisateur 2026-08-22).
function joueurGerableParAvatar(playerId, userId) {
    if (estAdmin(userId)) return db.prepare('SELECT id, photo_avatar FROM players WHERE id = ?').get(playerId);
    return db.prepare('SELECT id, photo_avatar FROM players WHERE id = ? AND user_id = ?').get(playerId, userId);
}

app.post('/api/joueur/avatar/:playerId', function (req, res) {
    uploadAvatar.single('photo')(req, res, function (erreurUpload) {
        if (erreurUpload) {
            return res.status(400).json({ error: erreurUpload.code === 'LIMIT_FILE_SIZE' ? 'Image trop volumineuse (5 Mo maximum).' : erreurUpload.message });
        }
        try {
            const { playerId } = req.params;
            const player = joueurGerableParAvatar(playerId, req.userId);
            if (!player) {
                if (req.file) fs.unlink(req.file.path, function () {});
                return res.status(404).json({ error: 'Joueur introuvable.' });
            }
            if (!req.file) {
                return res.status(400).json({ error: 'Aucune image envoyée.' });
            }
            if (player.photo_avatar) {
                fs.unlink(path.join(DOSSIER_DONNEES, player.photo_avatar), function () {});
            }
            const photoAvatar = '/uploads/avatars/' + req.file.filename;
            db.prepare('UPDATE players SET photo_avatar = ? WHERE id = ?').run(photoAvatar, playerId);
            res.json({ success: true, photoAvatar });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });
});

app.delete('/api/joueur/avatar/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;
        const player = joueurGerableParAvatar(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (player.photo_avatar) {
            fs.unlink(path.join(DOSSIER_DONNEES, player.photo_avatar), function () {});
        }
        db.prepare('UPDATE players SET photo_avatar = NULL WHERE id = ?').run(playerId);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/utilisateur/:userId', (req, res) => {
    try {
        const userId = req.userId;
        const user = db.prepare('SELECT id, email, role, est_redacteur, dernier_refus_motif, dernier_refus_date FROM users WHERE id = ?').get(userId);

        if (!user) {
            return res.status(404).json({ error: 'Utilisateur introuvable.' });
        }

        res.json({ success: true, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

function estAdmin(adminId) {
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(adminId);
    return user && user.role === 'admin';
}

app.get('/api/admin/en-attente', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }

        const enAttente = db.prepare(`
            SELECT players.*, users.pseudo AS coach_pseudo
            FROM players
            JOIN users ON users.id = players.user_id
            WHERE players.statut = 'en_attente'
        `).all();
        enAttente.forEach(function (p) { p.coach_pseudo = capitaliserPrenom(p.coach_pseudo); });

        res.json({ success: true, players: enAttente });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Repartition des points de disposition gagnes (intersaison ou Coaching mental) :
// meme principe que /api/repartir-xp (pool consommable partiellement, le reste
// attend), mais SANS plafond de 5/categorie - celui-ci ne s'applique qu'a la
// creation du personnage (dispositionsValides).
app.post('/api/repartir-dispositions-gain', (req, res) => {
    try {
        const { playerId, repartition } = req.body;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        let total = 0;
        for (const cle of DISPOSITIONS) {
            const valeur = Number((repartition && repartition[cle]) || 0);
            if (!Number.isFinite(valeur) || valeur < 0) {
                return res.status(400).json({ error: 'Valeurs invalides.' });
            }
            total += valeur;
        }
        if (total > player.points_dispositions_a_gagner) {
            return res.status(400).json({ error: 'Pas assez de points de disposition disponibles.' });
        }

        const maj = db.prepare(`
            UPDATE players SET
                disposition_adversite = ?, disposition_coupeur_de_tetes = ?, disposition_dernier_carre = ?,
                disposition_premiers_tours = ?, disposition_sang_froid = ?, disposition_indoor = ?, disposition_rivalite = ?,
                points_dispositions_a_gagner = ?
            WHERE id = ?
        `);
        maj.run(
            player.disposition_adversite + Number((repartition && repartition.adversite) || 0),
            player.disposition_coupeur_de_tetes + Number((repartition && repartition.coupeur_de_tetes) || 0),
            player.disposition_dernier_carre + Number((repartition && repartition.dernier_carre) || 0),
            player.disposition_premiers_tours + Number((repartition && repartition.premiers_tours) || 0),
            player.disposition_sang_froid + Number((repartition && repartition.sang_froid) || 0),
            player.disposition_indoor + Number((repartition && repartition.indoor) || 0),
            player.disposition_rivalite + Number((repartition && repartition.rivalite) || 0),
            player.points_dispositions_a_gagner - total,
            playerId
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Retrait obligatoire de points de disposition (perte d'intersaison) : contrairement
// au gain, la resolution doit etre complete en un seul appel (total exact, pas de
// reste en attente) puisqu'elle debloque un ecran obligatoire cote frontend.
app.post('/api/repartir-dispositions-perte', (req, res) => {
    try {
        const { playerId, repartition } = req.body;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        let total = 0;
        for (const cle of DISPOSITIONS) {
            const valeur = Number((repartition && repartition[cle]) || 0);
            if (!Number.isFinite(valeur) || valeur < 0) {
                return res.status(400).json({ error: 'Valeurs invalides.' });
            }
            if (player['disposition_' + cle] - valeur < 0) {
                return res.status(400).json({ error: 'Impossible de descendre sous 0 en ' + cle + '.' });
            }
            total += valeur;
        }
        if (total !== player.points_dispositions_a_retirer) {
            return res.status(400).json({ error: 'Le total doit correspondre exactement aux ' + player.points_dispositions_a_retirer + ' points a retirer.' });
        }

        const maj = db.prepare(`
            UPDATE players SET
                disposition_adversite = ?, disposition_coupeur_de_tetes = ?, disposition_dernier_carre = ?,
                disposition_premiers_tours = ?, disposition_sang_froid = ?, disposition_indoor = ?, disposition_rivalite = ?,
                points_dispositions_a_retirer = 0
            WHERE id = ?
        `);
        maj.run(
            player.disposition_adversite - Number((repartition && repartition.adversite) || 0),
            player.disposition_coupeur_de_tetes - Number((repartition && repartition.coupeur_de_tetes) || 0),
            player.disposition_dernier_carre - Number((repartition && repartition.dernier_carre) || 0),
            player.disposition_premiers_tours - Number((repartition && repartition.premiers_tours) || 0),
            player.disposition_sang_froid - Number((repartition && repartition.sang_froid) || 0),
            player.disposition_indoor - Number((repartition && repartition.indoor) || 0),
            player.disposition_rivalite - Number((repartition && repartition.rivalite) || 0),
            playerId
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Repartition obligatoire du budget de competences de la moulinette d'intersaison
// (regle PDF) : contrairement au gain de dispositions, la resolution doit etre
// complete en un seul appel (total exact, pas de reste en attente), puisqu'elle
// debloque un ecran obligatoire cote frontend - meme principe que
// /api/repartir-dispositions-perte. Chaque competence est plafonnee par sa valeur
// de fin de saison (cap_*, deja a 0 pour une competence jamais remplie, ce qui
// interdit naturellement d'y placer des points).
app.post('/api/joueurs/repartir-competences-moulinette', (req, res) => {
    try {
        const { playerId, repartition } = req.body;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (player.points_competences_a_repartir <= 0) {
            return res.status(400).json({ error: 'Aucune repartition de moulinette en attente pour ce joueur.' });
        }

        let total = 0;
        const valeurs = {};
        for (const cle of COMPETENCES) {
            const valeur = Number((repartition && repartition[cle]) || 0);
            if (!Number.isFinite(valeur) || valeur < 0) {
                return res.status(400).json({ error: 'Valeurs invalides.' });
            }
            if (valeur > player['cap_' + cle]) {
                return res.status(400).json({ error: 'Impossible de depasser ' + player['cap_' + cle] + ' points en ' + cle + ' (valeur de fin de saison derniere).' });
            }
            valeurs[cle] = valeur;
            total += valeur;
        }
        if (total !== player.points_competences_a_repartir) {
            return res.status(400).json({ error: 'Le total doit correspondre exactement aux ' + player.points_competences_a_repartir + ' points a repartir.' });
        }

        const nouveauNiveau = COMPETENCES.reduce(function (s, c) { return s + valeurs[c]; }, 0) / COMPETENCES.length;

        db.prepare(`
            UPDATE players SET
                service = ?, retour = ?, coup_droit_revers = ?, effet = ?, volee = ?, deplacement = ?, puissance = ?, resistance = ?,
                niveau = ?, points_competences_a_repartir = 0,
                cap_service = 0, cap_retour = 0, cap_coup_droit_revers = 0, cap_effet = 0,
                cap_volee = 0, cap_deplacement = 0, cap_puissance = 0, cap_resistance = 0
            WHERE id = ?
        `).run(
            valeurs.service, valeurs.retour, valeurs.coup_droit_revers, valeurs.effet,
            valeurs.volee, valeurs.deplacement, valeurs.puissance, valeurs.resistance,
            Math.round(nouveauNiveau * 10) / 10,
            playerId
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Deplacement d'1 point de disposition deja acquis (bonus "Coaching mental") : ne
// consomme pas le pool de gain, un compteur separe (points_dispositions_a_deplacer).
app.post('/api/deplacer-disposition', (req, res) => {
    try {
        const { playerId, depuis, vers } = req.body;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (!DISPOSITIONS.includes(depuis) || !DISPOSITIONS.includes(vers) || depuis === vers) {
            return res.status(400).json({ error: 'Categories invalides.' });
        }
        if (player.points_dispositions_a_deplacer <= 0) {
            return res.status(400).json({ error: 'Aucun deplacement disponible.' });
        }
        if (player['disposition_' + depuis] <= 0) {
            return res.status(400).json({ error: 'Cette categorie est deja a 0.' });
        }

        db.prepare(`
            UPDATE players SET
                disposition_${depuis} = disposition_${depuis} - 1,
                disposition_${vers} = disposition_${vers} + 1,
                points_dispositions_a_deplacer = points_dispositions_a_deplacer - 1
            WHERE id = ?
        `).run(playerId);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/admin/decision', (req, res) => {
    try {
        const { playerId, decision, motif } = req.body;

        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        if (decision !== 'valide' && decision !== 'refuse') {
            return res.status(400).json({ error: 'Decision invalide.' });
        }

        if (decision === 'refuse') {
            const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(playerId);
            if (!player) {
                return res.status(404).json({ error: 'Joueur introuvable.' });
            }
            // Un refus supprime le personnage refuse (et son eventuel binome encore en
            // attente) pour renvoyer le coach vers la creation de personnages plutot que
            // de le laisser bloque sur un statut "Refuse" sans issue. Un personnage deja
            // valide n'est jamais touche. Le motif (facultatif) est conserve sur le
            // compte - la ligne players elle-meme disparait, donc c'est le seul endroit
            // qui survit pour l'afficher au coach au retour sur creation-joueurs.html
            // (demande utilisateur, 2026-08-20).
            db.prepare("DELETE FROM players WHERE user_id = ? AND statut != 'valide'").run(player.user_id);
            db.prepare('UPDATE users SET dernier_refus_motif = ?, dernier_refus_date = ? WHERE id = ?')
                .run((motif || '').trim() || null, new Date().toISOString(), player.user_id);
        } else {
            db.prepare('UPDATE players SET statut = ? WHERE id = ?').run(decision, playerId);
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Liste des coachs (tous les comptes non-admin) avec leur statut redacteur actuel,
// pour l'ecran admin qui accorde/retire ce statut.
app.get('/api/admin/redacteurs', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }

        const coachs = db.prepare("SELECT id, email, pseudo, est_redacteur FROM users WHERE role != 'admin' ORDER BY pseudo").all();
        coachs.forEach(function (c) { c.pseudo = capitaliserPrenom(c.pseudo); });
        res.json({ success: true, coachs });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/admin/redacteur', (req, res) => {
    try {
        const { userId, estRedacteur } = req.body;
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }

        db.prepare('UPDATE users SET est_redacteur = ? WHERE id = ?').run(estRedacteur ? 1 : 0, userId);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Decalage d'affichage du numero de saison (jeu_etat.saison_offset) : permet de
// faire jouer une "saison 0" (bots uniquement, avant toute vraie partie) sans que
// la vraie carriere d'un coach ne demarre visiblement a "Saison 2". N'affecte que
// l'AFFICHAGE et l'indexation des paliers d'intersaison (variationDispositionsIntersaison)
// - jamais les semaines absolues stockees en base ni les fenetres Live/Race, qui
// continuent de raisonner sur phaseDeSemaine brut.
function decalageSaison() {
    const etat = db.prepare('SELECT saison_offset FROM jeu_etat WHERE id = 1').get();
    return (etat && etat.saison_offset) || 0;
}

function phaseAffichee(semaine) {
    const phase = phaseDeSemaine(semaine);
    return Object.assign({}, phase, { numeroSaison: phase.numeroSaison - decalageSaison() });
}

// Position relative (1-52) d'une semaine absolue A L'INTERIEUR DE SA PROPRE SAISON
// - a utiliser partout ou un evenement passe (tournoi joue, palmares, match) affiche
// "Semaine X" a l'utilisateur : jamais le numero absolu brut, qui n'a de sens que
// pour l'implementation (fenetres Live/Race, calcul de saison). Retourne null pour
// une semaine de Pre-saison/Semaine 0 (pas de position de tournoi).
function positionSemaineAffichee(semaine) {
    const phase = phaseDeSemaine(semaine);
    return phase.type === 'tournoi' ? phase.positionSemaine : null;
}

app.get('/api/semaine', (req, res) => {
    try {
        const etat = db.prepare('SELECT semaine_actuelle, saison_lancee, inscriptions_ouvertes FROM jeu_etat WHERE id = 1').get();
        res.json({
            success: true, semaine_actuelle: etat.semaine_actuelle, phase: phaseAffichee(etat.semaine_actuelle),
            prochainAvancementAuto: prochaineEcheanceApres(new Date()).toISOString(),
            saisonLancee: !!etat.saison_lancee,
            inscriptionsOuvertes: !!etat.inscriptions_ouvertes
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Semaines (dans [debut, fin]) ou ce joueur reel est selectionne dans la
// composition de sa nation pour une rencontre de Coupe Davis/Fed Cup non
// terminee - pas juste "sa nation joue cette semaine-la" (un joueur non retenu
// dans la composition garde sa planification normale). Utilise par
// /api/planification (fiche joueur) pour verrouiller la semaine, meme principe
// que les tournois individuels. Demande explicite de l'utilisateur, 2026-08-26.
function joueursEngagesCoupeDavis(player, debut, fin) {
    const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
    const ties = db.prepare(`
        SELECT * FROM coupe_equipes
        WHERE statut != 'termine' AND semaine BETWEEN ? AND ? AND circuit = ? AND (nation_domicile = ? OR nation_exterieur = ?)
    `).all(debut, fin, circuit, player.nationalite, player.nationalite);

    const nomCoupe = circuit === 'ATP' ? 'Coupe Davis' : 'Fed Cup';
    const resultats = [];
    ties.forEach(function (tie) {
        const compo = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tie.id, player.nationalite);
        if (!compo) return;
        const postes = [['joueur_a_est_reel', 'joueur_a_id'], ['joueur_b_est_reel', 'joueur_b_id'], ['double_j1_est_reel', 'double_j1_id'], ['double_j2_est_reel', 'double_j2_id']];
        const selectionne = postes.some(function (poste) { return compo[poste[0]] && Number(compo[poste[1]]) === Number(player.id); });
        if (selectionne) resultats.push({ semaine: tie.semaine, nom: nomCoupe });
    });
    return resultats;
}

app.get('/api/planification/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const debut = etat.semaine_actuelle + 1;
        const fin = debut + 4;

        const ordres = db.prepare('SELECT semaine, action FROM plannings WHERE player_id = ? AND semaine BETWEEN ? AND ?').all(playerId, debut, fin);

        // Semaines ou le joueur est reellement inscrit a un tournoi : la planification
        // (repos/entrainement) n'a pas sa place la, le tournoi occupe deja la semaine.
        const tournois = db.prepare(`
            SELECT tournois.semaine, tournois.nom
            FROM tournois
            JOIN tournoi_joueurs ON tournoi_joueurs.tournoi_id = tournois.id
            WHERE tournois.semaine BETWEEN ? AND ?
              AND tournoi_joueurs.est_reel = 1 AND tournoi_joueurs.player_id = ?
        `).all(debut, fin, playerId);

        // Meme principe pour une semaine de Coupe Davis/Fed Cup ou ce joueur est
        // selectionne dans la composition de sa nation (pas juste "sa nation joue" -
        // un joueur non retenu cette manche-la garde sa planification normale).
        // Demande explicite de l'utilisateur, 2026-08-26.
        const coupes = joueursEngagesCoupeDavis(player, debut, fin);

        // finDeSaison : derniere semaine de type "tournoi" du cycle, juste avant que la
        // moulinette s'applique a la bascule vers la Pre-saison suivante - rien a y
        // planifier (aucun tournoi n'y tombe jamais), donc le select repos/entrainement
        // n'a pas de sens la, contrairement aux autres semaines "tournoi" classiques
        // (bug signale par l'utilisateur, 2026-08-24 : affichait un select vide avec
        // l'alerte "bientot trop tard" au lieu d'expliquer qu'il n'y a rien a faire).
        const phases = {};
        for (let s = debut; s <= fin; s++) {
            const p = phaseAffichee(s);
            phases[s] = Object.assign({}, p, { finDeSaison: p.type === 'tournoi' && p.positionSemaine === LONGUEUR_SAISON - 2 });
        }

        res.json({ success: true, semaine_actuelle: etat.semaine_actuelle, debut, fin, ordres, tournois, coupes, phases });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Tournoi qui occupe une semaine ingame donnee pour un joueur reel precis (couvre
// aussi les tournois sur 2 semaines, ex. Grand Chelem : semaine de depart + la
// suivante, via CALENDRIER_TOURNOIS.duree - tournois.semaine ne stocke que le
// depart). Utilise pour "Semaine en cours/prochaine" (joueur.html) et pourrait
// resservir ailleurs si besoin d'un aperçu similaire.
function tournoiCouvrantSemaine(playerId, semaine) {
    const lignes = db.prepare(`
        SELECT t.*
        FROM tournoi_joueurs tj
        JOIN tournois t ON t.id = tj.tournoi_id
        WHERE tj.player_id = ? AND tj.est_reel = 1 AND t.statut != 'termine'
    `).all(playerId);
    for (const t of lignes) {
        const entree = CALENDRIER_TOURNOIS.find(function (e) { return e.id === t.calendrier_id; });
        const duree = entree ? entree.duree : 1;
        if (semaine >= t.semaine && semaine <= t.semaine + duree - 1) return t;
    }
    return null;
}

const LABELS_ACTION_COURTS = {
    repos: 'Repos',
    generique: 'Entraînement générique',
    surface_dur: 'Entraînement surface Dur',
    surface_terre: 'Entraînement surface Terre battue',
    surface_herbe: 'Entraînement surface Herbe',
    coaching_mental: 'Coaching mental',
    afk: 'AFK'
};

// XP credite automatiquement a un joueur "AFK" (aucune planification soumise
// cette semaine, pas engage en tournoi ni Coupe Davis/Fed Cup) - demande explicite
// de l'utilisateur, 2026-08-28 : plutot que de perdre silencieusement la semaine,
// 4 XP sont repartis tout seuls, TOUJOURS dans le meme ordre : d'abord chaque
// competence UNE PAR UNE (dans l'ordre de COMPETENCES) jusqu'a 24 avant de passer
// a la suivante ; une fois les 8 a 24, une competence tiree au hasard est remplie
// jusqu'a 99 avant d'en tirer une autre au hasard (jamais jusqu'a 100 - plafond
// volontairement legerement en dessous du maximum). Le montant peut deborder sur
// plusieurs competences la meme semaine si le seuil courant est atteint en cours
// de route (rare avec seulement 4 points, mais gere proprement).
const XP_AFK = 4;
function repartirXPAuto(competencesActuelles, montant) {
    const resultat = Object.assign({}, competencesActuelles);
    let reste = montant;
    while (reste > 0) {
        let cible = COMPETENCES.find(function (c) { return resultat[c] < 24; });
        let plafond = 24;
        if (!cible) {
            // Phase 2 : toutes deja a 24+ - on continue la competence "en cours"
            // (strictement entre 24 et 99) s'il y en a une, sinon on en tire une
            // nouvelle au hasard parmi celles encore sous 99.
            cible = COMPETENCES.find(function (c) { return resultat[c] > 24 && resultat[c] < 99; });
            if (!cible) {
                const eligibles = COMPETENCES.filter(function (c) { return resultat[c] < 99; });
                if (eligibles.length === 0) break; // tout est deja a 99, rien de plus a faire
                cible = eligibles[Math.floor(Math.random() * eligibles.length)];
            }
            plafond = 99;
        }
        const espace = plafond - resultat[cible];
        const applique = Math.min(espace, reste);
        resultat[cible] += applique;
        reste -= applique;
    }
    return resultat;
}

app.get('/api/joueur/semaine-info/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;

        const player = db.prepare('SELECT id FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const semaineActuelle = etat.semaine_actuelle;

        function infoPour(semaine) {
            // Un tournoi sur 2 semaines peut, dans l'absolu, deborder sur une Pre-saison/
            // Semaine 0 si son tour final tombe pile sur la derniere semaine de la saison -
            // priorite au tournoi (le joueur reste engage) avant de retomber sur le libelle
            // de phase neutre.
            const tournoi = tournoiCouvrantSemaine(playerId, semaine);
            if (tournoi) return { libelle: 'Tournoi : ' + tournoi.nom };

            const phase = phaseDeSemaine(semaine);
            if (phase.type === 'presaison') return { libelle: 'Pré-saison' };
            if (phase.type === 's0') return { libelle: 'Semaine 0' };

            // Une semaine deja atteinte (typiquement semaineActuelle) n'a plus de ligne
            // dans `plannings` - supprimee des sa consommation par executerAvancementSemaine
            // (voir la note sur /api/journal plus haut) - l'action reellement executee vit
            // desormais dans journal_semaine_joueur. Sans ca, "Semaine en cours" affichait
            // a tort "Pas encore defini" meme quand une action etait bel et bien en cours
            // (bug signale par l'utilisateur, 2026-08-21).
            const journal = db.prepare('SELECT action_prevue, tournoi_nom FROM journal_semaine_joueur WHERE player_id = ? AND semaine = ?').get(playerId, semaine);
            if (journal && journal.action_prevue) {
                return { libelle: journal.action_prevue === 'tournoi' ? 'Tournoi : ' + journal.tournoi_nom : (LABELS_ACTION_COURTS[journal.action_prevue] || journal.action_prevue) };
            }

            const planning = db.prepare('SELECT action FROM plannings WHERE player_id = ? AND semaine = ?').get(playerId, semaine);
            if (planning) return { libelle: LABELS_ACTION_COURTS[planning.action] || planning.action };

            return { libelle: 'Pas encore défini' };
        }

        res.json({
            success: true,
            semaineActuelle: infoPour(semaineActuelle),
            semaineProchaine: infoPour(semaineActuelle + 1)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Journal hebdomadaire : seule trace persistante de "qu'est-ce qui etait prevu et
// qu'est-ce qui a ete credite" pour un joueur, semaine par semaine (contrairement a
// `plannings`, supprimee une fois consommee, et `points_experience`, remis a zero
// chaque semaine). Sert a diagnostiquer un doute du type "j'avais prevu un
// entrainement mais les points n'ont pas ete ajoutes".
app.get('/api/journal/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;

        const player = db.prepare('SELECT id FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const lignes = db.prepare(`
            SELECT semaine, action_prevue, tournoi_nom, xp_credite, disposition_a_gagner_ajoutee,
                   disposition_a_deplacer_ajoutee, forme_avant, forme_apres, horodatage
            FROM journal_semaine_joueur
            WHERE player_id = ?
            ORDER BY semaine DESC
            LIMIT 20
        `).all(playerId);

        const journal = lignes.map(function (l) {
            let libelle;
            if (l.action_prevue === 'tournoi') libelle = 'Tournoi : ' + l.tournoi_nom;
            else if (l.action_prevue) libelle = LABELS_ACTION_COURTS[l.action_prevue] || l.action_prevue;
            else {
                const phase = phaseDeSemaine(l.semaine);
                libelle = phase.type === 'presaison' ? 'Pré-saison' : (phase.type === 's0' ? 'Semaine 0' : 'Rien de planifié');
            }
            return Object.assign({}, l, { positionSemaine: positionSemaineAffichee(l.semaine), libelle });
        });

        res.json({ success: true, journal });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/planification', (req, res) => {
    try {
        const { playerId, semaine, action } = req.body;

        const player = db.prepare('SELECT id, condition, type, nationalite FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (aDesPertesDispositionsEnAttente(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de disposition a retirer.' });
        }
        if (aDesCompetencesARepartir(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de competences de la moulinette.' });
        }
        if (!ACTIONS_VALIDES.includes(action)) {
            return res.status(400).json({ error: 'Action invalide.' });
        }
        // Regle du PDF : un joueur blesse ne peut ni s'entrainer normalement ni faire
        // un entrainement de surface - seuls le repos (le vrai remede) et le coaching
        // mental restent possibles.
        if (player.condition === 'blesse' && (action === 'generique' || action.indexOf('surface_') === 0)) {
            return res.status(400).json({ error: 'Un joueur blesse ne peut faire qu un repos ou un coaching mental.' });
        }

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const debut = etat.semaine_actuelle + 1;
        const fin = debut + 4;
        if (semaine < debut || semaine > fin) {
            return res.status(400).json({ error: 'Cette semaine est en dehors de la fenetre de planification.' });
        }
        if (phaseDeSemaine(semaine).type !== 'tournoi') {
            return res.status(400).json({ error: 'Aucune planification possible pendant la Pre-saison ou la Semaine 0.' });
        }

        const inscritCetteSemaine = db.prepare(`
            SELECT tournois.id
            FROM tournois
            JOIN tournoi_joueurs ON tournoi_joueurs.tournoi_id = tournois.id
            WHERE tournois.semaine = ?
              AND tournoi_joueurs.est_reel = 1 AND tournoi_joueurs.player_id = ?
        `).get(semaine, playerId);
        if (inscritCetteSemaine) {
            return res.status(400).json({ error: 'Ce joueur est inscrit a un tournoi cette semaine-la, la planification ne s applique pas.' });
        }
        // Meme garde-fou pour une semaine de Coupe Davis/Fed Cup ou ce joueur est
        // selectionne dans la composition de sa nation (demande explicite de
        // l'utilisateur, 2026-08-26) - la fiche joueur ne propose deja plus le
        // select pour cette semaine-la, ce garde-fou couvre un appel direct a l'API.
        if (joueursEngagesCoupeDavis(player, semaine, semaine).length > 0) {
            return res.status(400).json({ error: 'Ce joueur est engage en Coupe Davis/Fed Cup cette semaine-la, la planification ne s applique pas.' });
        }

        db.prepare(`
            INSERT INTO plannings (player_id, semaine, action) VALUES (?, ?, ?)
            ON CONFLICT(player_id, semaine) DO UPDATE SET action = excluded.action
        `).run(playerId, semaine, action);

        // Trace permanente de la soumission (voir planning_historique, database.js) :
        // contrairement a `plannings` ci-dessus (ecrasee a chaque changement d'avis,
        // supprimee des consommation), cette ligne n'est jamais modifiee ni supprimee -
        // meme un ordre change 3 fois avant la semaine concernee laisse une trace de
        // chaque choix, avec sa date exacte.
        db.prepare('INSERT INTO planning_historique (player_id, semaine, action, horodatage) VALUES (?, ?, ?, ?)')
            .run(playerId, semaine, action, new Date().toISOString());

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Ne repartit plus les points d'XP immediatement : enregistre le choix du coach
// (ecrase un choix precedent non encore applique), applique seulement au prochain
// changement de semaine, apres l'erosion (meme ordre "changement de semaine ->
// erosion -> xp -> 1er tour" que l'XP d'entrainement) - avant ce correctif, valider
// la repartition modifiait service/retour/etc. sur-le-champ, incoherent avec cette
// regle (bug signale par l'utilisateur, 2026-08-20).
app.post('/api/repartir-xp', (req, res) => {
    try {
        const { playerId, repartition } = req.body;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (aDesPertesDispositionsEnAttente(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de disposition a retirer.' });
        }
        if (aDesCompetencesARepartir(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de competences de la moulinette.' });
        }

        let total = 0;
        const valeurs = {};
        for (const cle of COMPETENCES) {
            const valeur = Number((repartition && repartition[cle]) || 0);
            if (!Number.isFinite(valeur) || valeur < 0) {
                return res.status(400).json({ error: 'Valeurs invalides.' });
            }
            if (player[cle] + valeur > 100) {
                return res.status(400).json({ error: 'Impossible de depasser 100 en ' + cle + '.' });
            }
            valeurs[cle] = valeur;
            total += valeur;
        }
        if (total > player.points_experience) {
            return res.status(400).json({ error: 'Pas assez de points d experience disponibles.' });
        }
        if (total === 0) {
            return res.status(400).json({ error: 'Indique au moins un point a repartir.' });
        }

        db.prepare('UPDATE players SET xp_repartition_en_attente = ? WHERE id = ?').run(JSON.stringify(valeurs), playerId);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Variation du budget de dispositions a chaque intersaison (indexIntersaison=1 pour
// la toute premiere) : gains les premieres annees pour laisser le temps de rattraper
// les joueurs plus anciens, puis pertes, puis stabilisation a partir de la 10eme.
function variationDispositionsIntersaison(indexIntersaison) {
    if (indexIntersaison <= 3) return 3;
    if (indexIntersaison <= 5) return 2;
    if (indexIntersaison <= 7) return -2;
    if (indexIntersaison <= 9) return -3;
    return 0;
}

// "La moulinette" au sens strict (rabotage des competences) : declenchee une seule
// fois a l'ENTREE en semaine 49 (derniere semaine de tournoi du cycle), PAS a la
// bascule vers la Pre-saison suivante comme avant (demande explicite de
// l'utilisateur, 2026-08-24). Ouvre une repartition manuelle des competences pour
// les joueurs les plus developpes (cible = ((XP totale - 200) / 2.5) + 100, jamais
// si cible >= total) au lieu d'une reduction automatique (regle PDF, revient sur un
// choix precedent).
//
// SEULEMENT le rabotage des competences est deplace ici - la variation de
// dispositions, le Top 30 fige et le tableau Coupe Davis restent a la bascule
// Pre-saison (appliquerResetPreSaison plus bas), MEME MOMENT QU'AVANT : ces champs
// (points_dispositions_a_gagner en particulier) sont aussi ecrits, sans lien avec
// la moulinette, par la boucle hebdomadaire normale (credit du Coaching mental,
// remise a 0 chaque semaine si rien de gagne) qui tourne pour TOUTE semaine
// (y compris S49) - si le gain de dispositions de la moulinette avait ete pose ici,
// la boucle hebdomadaire de la semaine 49 (executee lors du prochain appel, en
// quittant S49) l'aurait aussitot ecrase avant meme que le coach ait pu le voir.
// Le rabotage de competences n'a pas ce risque : aucune autre logique ne touche
// points_competences_a_repartir/cap_* en dehors de cette fonction et de la route de
// repartition manuelle.
//
// Le CALCUL reel (ce que faisait cette fonction avant le 2026-08-25) est desormais
// differe jusqu'a la prochaine connexion du coach, peu importe la saison/semaine a
// laquelle il revient (demande explicite de l'utilisateur) : un coach absent au
// moment ou son joueur franchit S49 se serait vu figer un budget/des plafonds
// calcules sur des competences qui datent de plusieurs semaines, potentiellement
// deja perimees par l'erosion hebdomadaire du temps qu'il etait absent. Ici, on se
// contente donc de marquer chaque joueur valide comme "en attente" -
// appliquerMoulinettePourJoueur (plus bas) fait le vrai calcul, avec les
// competences A JOUR au moment ou le coach se reconnecte (voir POST /api/connexion).
// Le reset physique de pre-saison (appliquerResetPreSaison), lui, continue de se
// declencher automatiquement sans jamais attendre personne (demande explicite).
function marquerMoulinetteEnAttente() {
    db.prepare("UPDATE players SET moulinette_en_attente = 1 WHERE statut = 'valide'").run();
}

// Vrai calcul de la moulinette pour UN joueur (competences a jour au moment de
// l'appel) - declenche a la connexion du coach si son joueur etait marque en
// attente, voir marquerMoulinetteEnAttente ci-dessus.
function appliquerMoulinettePourJoueur(player) {
    const valeurs = {};
    COMPETENCES.forEach(function (c) { valeurs[c] = player[c]; });
    const xpTotale = COMPETENCES.reduce(function (s, c) { return s + valeurs[c]; }, 0);
    const cible = ((xpTotale - 200) / 2.5) + 100;

    // Moulinette : les competences ne bougent PAS ici - le coach les repartit
    // lui-meme (route /api/joueurs/repartir-competences-moulinette), plafonne par
    // ses valeurs actuelles (cap_*), pour un budget total = Math.floor(cible).
    // En dessous du seuil (cible >= total), rien ne s'ouvre, comme avant.
    const competencesARepartir = (xpTotale > 0 && cible < xpTotale) ? Math.floor(cible) : 0;
    const caps = {};
    COMPETENCES.forEach(function (c) { caps[c] = competencesARepartir > 0 ? valeurs[c] : 0; });

    db.prepare(`
        UPDATE players SET
            points_competences_a_repartir = ?,
            cap_service = ?, cap_retour = ?, cap_coup_droit_revers = ?, cap_effet = ?,
            cap_volee = ?, cap_deplacement = ?, cap_puissance = ?, cap_resistance = ?,
            moulinette_en_attente = 0
        WHERE id = ?
    `).run(
        competencesARepartir,
        caps.service, caps.retour, caps.coup_droit_revers, caps.effet,
        caps.volee, caps.deplacement, caps.puissance, caps.resistance,
        player.id
    );
}

// Bascule vers la Pre-saison : remise a zero physique du joueur (usure/forme/
// mental/automatismes reviennent a leur valeur d'origine de creation, la condition
// repasse a "en forme") + variation de dispositions de la saison + Top 30 fige +
// tableau Coupe Davis - meme moment qu'avant le decoupage de la moulinette
// (2026-08-24), voir le commentaire d'appliquerMoulinette plus haut pour pourquoi
// la variation de dispositions doit rester ici et pas suivre la moulinette.
// La condition est remise a "en forme" bien que non citee explicitement par
// l'utilisateur : sans ca, un joueur encore "blesse" a la fin de la saison
// resterait bloque indefiniment, la Pre-saison ne proposant justement aucune
// planification de repos pour s'en sortir. L'energie n'est PAS remise a zero ici,
// contrairement a avant (revient sur le choix du 2026-07-18) : elle garde sa valeur
// de fin de saison, comme les classements (jamais touches par cette fonction de
// toute facon).
function appliquerResetPreSaison(nouvelleSemaine) {
    const joueurs = db.prepare("SELECT * FROM players WHERE statut = 'valide'").all();
    const indexIntersaison = phaseAffichee(nouvelleSemaine).numeroSaison - 1;
    const variationDispositions = variationDispositionsIntersaison(indexIntersaison);

    const maj = db.prepare(`
        UPDATE players SET
            usure = 0, forme = 100, mental_courant = 100, mental_max = 100,
            surface_dur_automatismes = 0, surface_terre_automatismes = 0, surface_herbe_automatismes = 0,
            condition = 'en_forme',
            points_dispositions_a_gagner = ?, points_dispositions_a_retirer = ?
        WHERE id = ?
    `);

    // Corrige la ligne de journal_semaine_joueur deja inseree pour nouvelleSemaine
    // (par la boucle hebdomadaire normale, juste avant l'appel a cette fonction) :
    // sans ca, le journal continuait de montrer les valeurs D'AVANT ce reset comme
    // etat "final" de la semaine, alors que le reset les change juste apres - un
    // historique qui ne reflete pas l'etat reellement enregistre en base n'a
    // aucune valeur de recours en cas de bug (constate le 2026-08-24 : impossible
    // de savoir si/quand l'energie avait ete perdue faute d'un tel recoupement).
    // L'energie n'est PAS incluse ici, coherent avec le reset lui-meme qui n'y
    // touche pas.
    const majJournal = db.prepare(`
        UPDATE journal_semaine_joueur SET
            forme_apres = 100, usure_apres = 0, mental_apres = 100, mental_max_apres = 100,
            condition_apres = 'en_forme',
            automatismes_dur_apres = 0, automatismes_terre_apres = 0, automatismes_herbe_apres = 0
        WHERE player_id = ? AND semaine = ?
    `);

    joueurs.forEach(function (player) {
        const dispositionsAGagner = player.points_dispositions_a_gagner + Math.max(0, variationDispositions);
        const dispositionsARetirer = player.points_dispositions_a_retirer + Math.max(0, -variationDispositions);
        maj.run(dispositionsAGagner, dispositionsARetirer, player.id);
        majJournal.run(player.id, nouvelleSemaine);
    });

    // Coupe Davis / Fed Cup : tableau de 16 nations + ties du 1er tour genere une
    // seule fois au tout debut de la nouvelle Pre-saison (idempotent).
    assurerTableauCoupe('ATP');
    assurerTableauCoupe('WTA');

    // Top 30 "obligatoire" (regle des 18/16 meilleurs resultats) : fige une seule
    // fois par saison, sur le classement Live tel qu'il etait a la toute derniere
    // semaine de la saison qui vient de se terminer - en vigueur pour la saison qui
    // commence. Idempotent (skip si deja fige pour cette saison/ce circuit).
    fixerTop30Saison(nouvelleSemaine);
}

function fixerTop30Saison(nouvelleSemaine) {
    const saison = phaseAffichee(nouvelleSemaine).numeroSaison;
    ['ATP', 'WTA'].forEach(function (circuit) {
        const existe = db.prepare('SELECT COUNT(*) AS n FROM classement_top30 WHERE saison = ? AND circuit = ?').get(saison, circuit).n;
        if (existe > 0) return;
        const semaineReference = nouvelleSemaine - 1;
        const classement = calculerClassementGlobal(circuit, semaineReference - FENETRE_LIVE, semaineReference);
        const insert = db.prepare('INSERT INTO classement_top30 (saison, circuit, cle) VALUES (?, ?, ?)');
        classement.slice(0, 30).forEach(function (c) { insert.run(saison, circuit, c.cle); });
    });
}

// Coeur de l'avancee de semaine, reutilise par la route admin ET par le scheduler
// automatique (verifierAvancementAuto) - jamais duplique entre les deux.
function executerAvancementSemaine() {
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const semaine = etat.semaine_actuelle;
        const nouvelleSemaine = semaine + 1;

        // Ancre temps reel de la semaine qu'on s'apprete a commencer (nouvelleSemaine) :
        // seule source de verite pour calculer a quelle heure reelle chaque tour des
        // tournois qui s'y deroulent doit etre joue (executerAvancementTour). Doit
        // etre postee la, au moment ou cette semaine debute reellement - postee sous
        // l'ancien numero de semaine (bug corrige ici), l'ancre de la semaine en cours
        // n'existait jamais tant qu'on n'avait pas deja avance a la semaine suivante,
        // donc "Avancer un tour" ne trouvait jamais rien a simuler avant qu'il ne soit
        // trop tard. Enregistree inconditionnellement, meme en Pre-saison/Semaine 0
        // (sans effet, juste par simplicite).
        db.prepare('INSERT OR IGNORE INTO semaines_reelles (semaine, debut_reel) VALUES (?, ?)').run(nouvelleSemaine, new Date().toISOString());

        const joueurs = db.prepare("SELECT * FROM players WHERE statut = 'valide'").all();

        // phaseActuelle (semaine qu'on quitte) gouverne l'erosion/la decroissance des
        // automatismes : une attrition pour "avoir vecu" cette semaine-la, jamais
        // pendant une Pre-saison/Semaine 0 neutre. phaseNouvelleSemaine (semaine qu'on
        // s'apprete a commencer) gouverne au contraire le credit du planning - un
        // choix fait pour la semaine X doit devenir disponible des que semaine_actuelle
        // affiche X, pas une semaine plus tard une fois X deja terminee (bug corrige
        // ici : avant, le planning lu restait toujours celui de la semaine qu'on
        // quitte, donc le credit n'apparaissait jamais avant d'avoir déjà avance
        // au-dela de la semaine concernee).
        const phaseActuelle = phaseDeSemaine(semaine);
        const phaseNouvelleSemaine = phaseDeSemaine(nouvelleSemaine);

        // Tournoi = evenement GLOBAL partage par tous les coachs : un seul pool
        // cree/tire par entree calendaire due cette semaine (tous circuits confondus),
        // quel que soit le nombre de coachs inscrits dedans. La SIMULATION elle-meme
        // (tour par tour) est entierement geree par executerAvancementTour, pas ici.
        // Pre-saison/Semaine 0 : semaines neutres, jamais de tournoi dessus.
        const entreesSemaine = phaseActuelle.type === 'tournoi'
            ? CALENDRIER_TOURNOIS
                .filter(function (t) { return t.semaine_debut === phaseActuelle.positionSemaine; })
                .sort(function (a, b) { return b.taille_tableau - a.taille_tableau; })
            : [];

        const rivauxUtilisesSemaine = new Set();

        entreesSemaine.forEach(function (entree) {
            let tournoiRow = db.prepare('SELECT * FROM tournois WHERE calendrier_id = ? AND semaine = ?').get(entree.id, semaine);

            if (!tournoiRow) {
                if (tournoiDejaCreeCetteSaison(entree.id, semaine)) return; // deja joue cette saison a une autre position (decalage de calendrier)
                // Filet de securite : normalement le pool est cree a S-5 (inscriptions
                // ouvertes) et tire au sort a S-1. Si ce n'est jamais arrive (partie
                // commencee en cours de cycle, etc.), on rattrape les deux etapes ici.
                const nouveauId = creerTournoi(entree, semaine, rivauxUtilisesSemaine);
                tirerAuSort(nouveauId, entree);
            } else if (tournoiRow.statut === 'inscriptions') {
                tirerAuSort(tournoiRow.id, entree);
            }
        });

        joueurs.forEach(function (player) {
            // Un tournoi peut deborder sur plusieurs semaines ingame (les 7-tours) :
            // un joueur reste "engage" tant que son tournoi n'est pas termine, quelle
            // que soit la semaine ou ce tournoi a ete cree. Uniquement une fois le
            // tableau REELLEMENT tire (statut='a_venir') - une simple inscription
            // (statut='inscriptions', pool ouvert des S-5 mais tournoi pas encore
            // commence) ne doit jamais compter comme "engage cette semaine" : sinon
            // un joueur inscrit a un tournoi futur voit sa planification de la
            // semaine en cours silencieusement annulee, une semaine trop tot (bug
            // signale par l'utilisateur, 2026-08-20 - confirme via /api/admin/debug-joueur).
            // Un joueur peut avoir 2 tournois 'a_venir' simultanement : celui qu'il est
            // en train de jouer ET le suivant, deja tire au sort a S-1 (ex. un Grand
            // Chelem sur 2 semaines) - sans tri, LIMIT 1 pouvait piocher le mauvais des
            // deux (tournoi_nom errone dans le journal, mauvaise surface protegee de
            // l'erosion). Le tournoi qui commence le plus tot est toujours celui
            // reellement en cours (un tournoi futur ne peut jamais avoir demarre avant
            // lui), donc trier par semaine croissante resout l'ambiguite (bug signale
            // par l'utilisateur, 2026-08-20).
            // Un tournoi en 2 semaines reste statut='a_venir' pendant TOUTE sa duree,
            // meme apres l'elimination du joueur des la 1ere semaine - sans exclure les
            // lignes deja resolues (tour_elimine pose), un joueur elimine en semaine 1
            // restait considere "engage" en semaine 2, son planning pour cette semaine
            // (ex. entrainement generique prevu en cas d'elimination) etait silencieusement
            // ignore et le journal affichait encore le nom du tournoi (bug signale par
            // l'utilisateur, 2026-08-21).
            const tournoiEngage = db.prepare(`
                SELECT t.nom, t.surface
                FROM tournoi_joueurs tj
                JOIN tournois t ON t.id = tj.tournoi_id
                WHERE tj.player_id = ? AND tj.est_reel = 1 AND t.statut = 'a_venir' AND tj.tour_elimine IS NULL
                ORDER BY t.semaine ASC
                LIMIT 1
            `).get(player.id);
            // Coupe Davis/Fed Cup : meme principe "engage" qu'un tournoi individuel -
            // un joueur selectionne dans la composition d'une rencontre non terminee
            // CETTE semaine (nouvelleSemaine, celle qu'on credite) ne doit pas cumuler
            // l'XP/consequences d'un entrainement planifie EN PLUS de sa rencontre
            // (bug signale par l'utilisateur, 2026-08-27 : XP creditee pour les deux a
            // la fois). Contrairement aux tournois, une manche de Coupe Davis se joue
            // integralement sur UNE seule semaine (pas de notion de tour_elimine à
            // cheval sur 2 semaines), donc verifier juste la semaine en cours suffit.
            const coupeEngagee = joueursEngagesCoupeDavis(player, nouvelleSemaine, nouvelleSemaine)[0] || null;
            const tieCoupeEngage = coupeEngagee
                ? db.prepare(`
                    SELECT surface FROM coupe_equipes
                    WHERE circuit = ? AND semaine = ? AND statut != 'termine' AND (nation_domicile = ? OR nation_exterieur = ?)
                `).get(player.type === 'joueur' ? 'ATP' : 'WTA', nouvelleSemaine, player.nationalite, player.nationalite)
                : null;
            const joueurEngageCetteSemaine = !!tournoiEngage || !!coupeEngagee;

            if (joueurEngageCetteSemaine) {
                player = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
            }

            // Planning de la semaine qu'on s'apprete a commencer (nouvelleSemaine), pas
            // celle qu'on quitte - voir commentaire plus haut.
            const ordre = (!joueurEngageCetteSemaine && phaseNouvelleSemaine.type === 'tournoi')
                ? db.prepare('SELECT action FROM plannings WHERE player_id = ? AND semaine = ?').get(player.id, nouvelleSemaine)
                : null;
            const formeAvant = player.forme;
            // Instantane complet avant traitement de la semaine (au-dela de la seule
            // forme) - permet de retrouver le veritable etat d'un joueur juste avant
            // un evenement donne au lieu de le perdre des qu'un champ est ecrase par
            // erreur ailleurs (bug de reset d'energie du 2026-08-24, sans aucune trace
            // de la valeur perdue faute d'un tel historique).
            const energieAvant = player.points_energie;
            const usureAvant = player.usure;
            const mentalAvant = player.mental_courant;
            const mentalMaxAvant = player.mental_max;
            const conditionAvant = player.condition;
            const automatismesDurAvant = player.surface_dur_automatismes;
            const automatismesTerreAvant = player.surface_terre_automatismes;
            const automatismesHerbeAvant = player.surface_herbe_automatismes;
            const competencesAvant = {};
            COMPETENCES.forEach(function (cle) { competencesAvant[cle] = player[cle]; });

            let forme = player.forme;
            let mentalCourant = player.mental_courant;
            // Pas d'accumulation d'une semaine sur l'autre : les XP d'entrainement
            // generique, les points de disposition gagnes et le deplacement de
            // Coaching mental ne sont disponibles que la semaine ou ils sont gagnes -
            // on repart de 0 a chaque semaine plutot que de cumuler sur les valeurs
            // deja en base (regle explicite de l'utilisateur : ne peuvent pas rester
            // en reserve indefiniment, perdus s'ils ne sont pas utilises a temps).
            let pointsExperience = 0;
            // XP creditee automatiquement a un joueur "AFK" cette semaine (voir plus bas,
            // repartirXPAuto) - distincte de pointsExperience : contrairement a l'XP
            // d'entrainement generique, elle est repartie tout de suite dans les
            // competences, jamais laissee en attente pour une repartition manuelle.
            let xpAfkCreditee = 0;
            let pointsEnergie = player.points_energie;
            // EXCEPTION a la regle ci-dessus, uniquement pour les dispositions gagnees :
            // en quittant une semaine de Pre-saison/Semaine 0 (phaseActuelle.type !==
            // 'tournoi'), aucune planification n'est jamais possible - le coach n'a donc
            // JAMAIS eu l'occasion de repartir un gain recu la (ex. le budget d'intersaison
            // verse par appliquerResetPreSaison a l'entree en Pre-saison), contrairement a
            // un credit hebdomadaire normal qu'il aurait pu choisir d'utiliser. Le remettre
            // a 0 ici l'effacerait avant meme que le coach ait pu le voir, des le prochain
            // avancement automatique (bug signale par l'utilisateur, 2026-08-24 : la
            // moulinette ne proposait jamais de repartir de disposition). On le reporte
            // donc tel quel tant qu'aucune semaine "tournoi" (avec planification reelle)
            // n'a ete traversee.
            let pointsDispositionsAGagner = phaseActuelle.type === 'tournoi' ? 0 : player.points_dispositions_a_gagner;
            let pointsDispositionsADeplacer = 0;
            // Recuperation : tant qu'aucune semaine de repos n'est faite, la condition
            // (En forme/Fatigue/Diminue/Blesse) reste degradee ; une semaine de repos
            // suffit a repartir a zero, quel que soit l'etat de depart.
            let condition = player.condition;
            const automatismes = {
                dur: player.surface_dur_automatismes,
                terre: player.surface_terre_automatismes,
                herbe: player.surface_herbe_automatismes
            };

            let surfaceProtegee = null;

            if (ordre) {
                if (ordre.action === 'repos') {
                    forme = formeMax(player.usure);
                    mentalCourant = player.mental_max;
                    condition = 'en_forme';
                // Tant qu'un joueur reste blesse (aucune semaine de repos faite depuis),
                // plus aucune XP d'entrainement - seul le repos permet de reprendre une
                // progression normale, en repartant la condition a "En forme" ci-dessus
                // (demande explicite de l'utilisateur, 2026-08-21).
                } else if (ordre.action === 'generique' && player.condition !== 'blesse') {
                    pointsExperience = 8;
                } else if (ordre.action.indexOf('surface_') === 0) {
                    const surf = ordre.action.replace('surface_', '');
                    if (SURFACES.includes(surf)) {
                        surfaceProtegee = surf;
                        automatismes[surf] = automatismes[surf] > 15 ? 30 : Math.min(30, automatismes[surf] + 15);
                    }
                } else if (ordre.action === 'coaching_mental') {
                    pointsDispositionsAGagner = 1;
                    pointsDispositionsADeplacer = 1;
                }
            }

            // Protection contre l'erosion : ce qui s'est REELLEMENT passe pendant la
            // semaine qu'on quitte (phaseActuelle), jamais le plan de la semaine qu'on
            // s'apprete a commencer (surfaceProtegee ci-dessus, qui sert uniquement a
            // crediter le bonus d'automatismes/XP DE CETTE semaine-la) - sinon un
            // automatisme tout juste monte par un entrainement de surface se faisait
            // immediatement raboter de 5 au changement suivant, a moins de planifier
            // encore la meme surface la semaine d'apres, ce qui n'a aucun sens (bug
            // signale par l'utilisateur, 2026-08-20). Un joueur engage en tournoi
            // protege la surface jouee (regle exacte du PDF : exclusion de "la surface
            // ou le joueur a joue durant la semaine en simple") ; sinon on relit le
            // journal de la semaine qu'on quitte (ecrit lors de la transition
            // precedente) pour savoir si un entrainement de surface y avait ete credite.
            let surfaceProtegeeErosion = null;
            const surfaceEngagee = (tournoiEngage && tournoiEngage.surface) || (tieCoupeEngage && tieCoupeEngage.surface) || null;
            if (joueurEngageCetteSemaine && surfaceEngagee && SURFACES.includes(surfaceEngagee)) {
                surfaceProtegeeErosion = surfaceEngagee;
            } else {
                const journalSemaineQuittee = db.prepare('SELECT action_prevue FROM journal_semaine_joueur WHERE player_id = ? AND semaine = ?').get(player.id, semaine);
                if (journalSemaineQuittee && journalSemaineQuittee.action_prevue && journalSemaineQuittee.action_prevue.indexOf('surface_') === 0) {
                    const surfQuittee = journalSemaineQuittee.action_prevue.replace('surface_', '');
                    if (SURFACES.includes(surfQuittee)) surfaceProtegeeErosion = surfQuittee;
                }
            }

            // Erosion des competences et decroissance des automatismes : uniquement
            // pour avoir vecu une VRAIE semaine de tournoi (phaseActuelle, la semaine
            // qu'on quitte) - jamais pendant une Pre-saison/Semaine 0 neutre, meme si
            // la semaine qu'on s'apprete a commencer (nouvelleSemaine) en est une.
            let competencesErodees = {};
            COMPETENCES.forEach(function (cle) { competencesErodees[cle] = player[cle]; });
            if (phaseActuelle.type === 'tournoi') {
                SURFACES.forEach(function (surf) {
                    if (surf !== surfaceProtegeeErosion) {
                        automatismes[surf] = Math.max(0, automatismes[surf] - 5);
                    }
                });
                COMPETENCES.forEach(function (cle) {
                    const valeur = player[cle];
                    const perte = Math.floor(valeur * 0.04);
                    competencesErodees[cle] = Math.max(0, valeur - perte);
                });
                if (semaine % 4 === 0) {
                    pointsEnergie = Math.min(100, pointsEnergie + 5);
                }
            }

            // Repartition d'XP programmee par le coach (via /api/repartir-xp) : appliquee
            // ICI, apres l'erosion mais avant l'ecriture finale - ordre exact demande par
            // l'utilisateur ("changement de semaine -> erosion -> xp -> 1er tour"),
            // 2026-08-20. S'ajoute aux valeurs DEJA erodees, jamais aux valeurs d'avant
            // erosion.
            if (player.xp_repartition_en_attente) {
                try {
                    const enAttente = JSON.parse(player.xp_repartition_en_attente);
                    COMPETENCES.forEach(function (cle) {
                        const valeur = Number(enAttente[cle]) || 0;
                        if (valeur > 0) {
                            competencesErodees[cle] = Math.min(100, competencesErodees[cle] + valeur);
                        }
                    });
                } catch (e) { /* JSON invalide, ignore */ }
            }

            // Joueur "AFK" cette semaine : aucune planification soumise (ordre est deja
            // null pour un joueur engage en tournoi/Coupe Davis OU hors semaine de
            // tournoi, cf. calcul de `ordre` plus haut - il ne reste donc que le vrai cas
            // "rien de fait") - credite et repartit 4 XP automatiquement plutot que de
            // perdre la semaine en silence (demande explicite de l'utilisateur,
            // 2026-08-28). Applique APRES la repartition manuelle en attente (l'un
            // n'exclut pas forcement l'autre en theorie, mais dans les faits un joueur
            // AFK n'a jamais eu l'occasion de soumettre xp_repartition_en_attente non
            // plus). Meme regle qu'un entrainement generique planifie manuellement : un
            // joueur blesse ne gagne aucune XP tant qu'il n'a pas fait un vrai repos
            // (demande explicite de l'utilisateur, 2026-08-28 - "meme afk il ne gagne
            // pas d'xp tant qu'il n'a pas fait un repos") - reste neanmoins marque "afk"
            // dans le journal (juste sans XP), pour distinguer ce cas d'une semaine hors
            // saison (action_prevue null).
            const estAfk = !ordre && phaseNouvelleSemaine.type === 'tournoi' && !joueurEngageCetteSemaine;
            if (estAfk && player.condition !== 'blesse') {
                competencesErodees = repartirXPAuto(competencesErodees, XP_AFK);
                xpAfkCreditee = XP_AFK;
            }

            const nouveauNiveau = COMPETENCES.reduce(function (s, c) { return s + competencesErodees[c]; }, 0) / COMPETENCES.length;

            db.prepare(`
                UPDATE players SET
                    service = ?, retour = ?, coup_droit_revers = ?, effet = ?, volee = ?, deplacement = ?, puissance = ?, resistance = ?,
                    forme = ?, mental_courant = ?, points_experience = ?, points_energie = ?,
                    surface_dur_automatismes = ?, surface_terre_automatismes = ?, surface_herbe_automatismes = ?,
                    niveau = ?, condition = ?, points_dispositions_a_gagner = ?, points_dispositions_a_deplacer = ?,
                    xp_repartition_en_attente = NULL
                WHERE id = ?
            `).run(
                competencesErodees.service, competencesErodees.retour, competencesErodees.coup_droit_revers, competencesErodees.effet,
                competencesErodees.volee, competencesErodees.deplacement, competencesErodees.puissance, competencesErodees.resistance,
                forme, mentalCourant, pointsExperience, pointsEnergie,
                automatismes.dur, automatismes.terre, automatismes.herbe,
                Math.round(nouveauNiveau * 10) / 10, condition, pointsDispositionsAGagner, pointsDispositionsADeplacer,
                player.id
            );

            // Journal de la semaine qui vient d'etre creditee (nouvelleSemaine) - pas
            // celle qu'on quitte, coherent avec le planning lu plus haut.
            db.prepare(`
                INSERT OR IGNORE INTO journal_semaine_joueur
                    (player_id, semaine, action_prevue, tournoi_nom, xp_credite, disposition_a_gagner_ajoutee, disposition_a_deplacer_ajoutee,
                     forme_avant, forme_apres, energie_avant, energie_apres, usure_avant, usure_apres,
                     mental_avant, mental_apres, mental_max_avant, mental_max_apres, condition_avant, condition_apres,
                     automatismes_dur_avant, automatismes_dur_apres, automatismes_terre_avant, automatismes_terre_apres,
                     automatismes_herbe_avant, automatismes_herbe_apres,
                     service_avant, service_apres, retour_avant, retour_apres,
                     coup_droit_revers_avant, coup_droit_revers_apres, effet_avant, effet_apres,
                     volee_avant, volee_apres, deplacement_avant, deplacement_apres,
                     puissance_avant, puissance_apres, resistance_avant, resistance_apres,
                     horodatage)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                player.id, nouvelleSemaine,
                joueurEngageCetteSemaine ? 'tournoi' : (ordre ? ordre.action : (estAfk ? 'afk' : null)),
                tournoiEngage ? tournoiEngage.nom : (coupeEngagee ? coupeEngagee.nom : null),
                pointsExperience + xpAfkCreditee,
                ordre && ordre.action === 'coaching_mental' ? 1 : 0,
                ordre && ordre.action === 'coaching_mental' ? 1 : 0,
                formeAvant, forme, energieAvant, pointsEnergie, usureAvant, usureAvant,
                mentalAvant, mentalCourant, mentalMaxAvant, mentalMaxAvant, conditionAvant, condition,
                automatismesDurAvant, automatismes.dur, automatismesTerreAvant, automatismes.terre,
                automatismesHerbeAvant, automatismes.herbe,
                competencesAvant.service, competencesErodees.service,
                competencesAvant.retour, competencesErodees.retour,
                competencesAvant.coup_droit_revers, competencesErodees.coup_droit_revers,
                competencesAvant.effet, competencesErodees.effet,
                competencesAvant.volee, competencesErodees.volee,
                competencesAvant.deplacement, competencesErodees.deplacement,
                competencesAvant.puissance, competencesErodees.puissance,
                competencesAvant.resistance, competencesErodees.resistance,
                new Date().toISOString()
            );

            if (ordre) {
                db.prepare('DELETE FROM plannings WHERE player_id = ? AND semaine = ?').run(player.id, nouvelleSemaine);
            }
        });

        // Photo hebdomadaire du classement Live GLOBAL (voir classement_historique,
        // database.js) - alimente le "meilleur classement" affiche sur les fiches
        // adversaire. Prise sur la semaine qui vient d'etre traitee, avant la bascule
        // sur nouvelleSemaine (coherent avec calculerRangsLiveGlobal, qui utilisera
        // cette meme semaine comme borne haute une fois qu'elle sera "actuelle").
        const insertHistorique = db.prepare('INSERT INTO classement_historique (circuit, cle, semaine, rang) VALUES (?, ?, ?, ?)');
        ['ATP', 'WTA'].forEach(function (circuit) {
            const liste = calculerClassementGlobal(circuit, semaine - FENETRE_LIVE, semaine);
            liste.forEach(function (j, i) { insertHistorique.run(circuit, j.cle, semaine, i + 1); });
        });

        db.prepare('UPDATE jeu_etat SET semaine_actuelle = semaine_actuelle + 1 WHERE id = 1').run();

        // Moulinette : marquee "en attente" une seule fois, exactement a l'entree en
        // semaine 49 (derniere semaine de tournoi du cycle), pas a la bascule
        // Pre-saison (demande explicite de l'utilisateur, 2026-08-24). Le vrai calcul
        // est differe jusqu'a la prochaine connexion du coach (2026-08-25), voir
        // marquerMoulinetteEnAttente plus haut.
        if (phaseNouvelleSemaine.type === 'tournoi' && phaseNouvelleSemaine.positionSemaine === LONGUEUR_SAISON - 2) {
            marquerMoulinetteEnAttente();
        }

        // Coupe Davis / Fed Cup : barrage de maintien genere a l'entree en S29 (pas
        // juste apres le 1er tour, S5-S6 - beaucoup trop tot pour designer
        // equitablement les 8 nations challengers hors Groupe mondial sur une
        // classement Live qui reflete a peine 5-6 semaines de saison). S29 laisse le
        // classement des outsiders se stabiliser jusqu'a la fin de S28 avant de
        // figer les challengers - demande explicite de l'utilisateur, 2026-08-27.
        // Idempotent (genererBarrage ne fait rien si deja generee cette saison).
        if (phaseNouvelleSemaine.type === 'tournoi' && phaseNouvelleSemaine.positionSemaine === 29) {
            const saisonCourante = nombreSaisonAffichee();
            genererBarrage(saisonCourante, 'ATP');
            genererBarrage(saisonCourante, 'WTA');
        }

        // Remise a zero physique du joueur + verrou de saison : declenche exactement au
        // moment ou l'on quitte S49 pour entrer dans la nouvelle Pre-saison. La partie
        // se fige ensuite dans cette Pre-saison (meme verrou saison_lancee que pour le
        // tout premier lancement) : l'admin doit relancer explicitement la nouvelle
        // saison via /api/admin/lancer-saison, ce n'est plus automatique (demande
        // explicite).
        if (phaseNouvelleSemaine.type === 'presaison') {
            appliquerResetPreSaison(nouvelleSemaine);
            db.prepare('UPDATE jeu_etat SET saison_lancee = 0 WHERE id = 1').run();
        }

        // Coupe Davis / Fed Cup : capitaine tranche une seule fois par saison, a la
        // bascule S1->S2 (le vote de S1 vient de se terminer). Les manches elles-memes
        // se simulent rencontre par rencontre via executerAvancementTourCoupe (memes
        // creneaux qu'un tournoi individuel classique), pas ici.
        if (phaseNouvelleSemaine.type === 'tournoi' && phaseNouvelleSemaine.positionSemaine === 2) {
            resoudreCapitainesSaison(phaseAffichee(nouvelleSemaine).numeroSaison);
        }

        // Coupe Davis / Fed Cup : a l'entree en semaine des styles (S-1), la surface
        // et la composition doivent etre DEFINITIVES, jamais encore "probable" - si
        // le capitaine n'a rien soumis pendant ses fenetres S-3/S-2, le repli
        // automatique s'applique maintenant, pour de bon, plutot que d'attendre la
        // toute premiere simulation de rubber (demande explicite de l'utilisateur,
        // 2026-08-26 : a S-1 les joueurs ne doivent plus pouvoir changer).
        db.prepare("SELECT * FROM coupe_equipes WHERE statut != 'termine' AND semaine = ?").all(nouvelleSemaine + 1)
            .forEach(function (tie) {
                assurerSurfaceAuto(tie);
                const tieAJour = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tie.id);
                assurerCompositionAuto(tieAJour, tieAJour.nation_domicile);
                assurerCompositionAuto(tieAJour, tieAJour.nation_exterieur);
            });

        const semaineOuvertureFavoris = nouvelleSemaine + 5;
        const semaineOuvertureEntrants = nouvelleSemaine + 5;
        const semaineTirage = nouvelleSemaine + 1;
        const phaseOuvertureEntrants = phaseDeSemaine(semaineOuvertureEntrants);
        const phaseTirage = phaseDeSemaine(semaineTirage);

        // Ouverture des inscriptions (S-5) : le pool d'entrants existe des maintenant,
        // consultable dans l'onglet "Inscrits", meme si personne n'est encore inscrit.
        // Une seule fois par entree calendaire due (tous circuits), plus par joueur.
        // Pre-saison/Semaine 0 : rien a ouvrir, ces semaines n'ont jamais de tournoi.
        // EXCEPTION : les Masters de fin de saison (categorie 'finals') ne sont jamais
        // crees ici - leurs 8 qualifies sont determines par genererEntrantsFinals au
        // moment du tirage (S-1, ci-dessous), pas 5 semaines a l'avance, pour refleter
        // le classement Race a jour juste apres le dernier tournoi de la saison
        // reguliere (Stockholm cote ATP, Hong Kong cote WTA) plutot qu'un instantane
        // perime pris bien avant que ces derniers points ne soient marques (bug
        // signale par l'utilisateur, 2026-08-24 - la semaine des Finals a ete decalee
        // d'une semaine dans calendrier-tournois.js pour degager le delai necessaire).
        const rivauxUtilisesOuverture = new Set();
        if (phaseOuvertureEntrants.type === 'tournoi') {
            CALENDRIER_TOURNOIS
                .filter(function (t) { return t.semaine_debut === phaseOuvertureEntrants.positionSemaine && t.categorie !== 'finals'; })
                .sort(function (a, b) { return b.taille_tableau - a.taille_tableau; })
                .forEach(function (entree) {
                    const existe = db.prepare('SELECT id FROM tournois WHERE calendrier_id = ? AND semaine = ?').get(entree.id, semaineOuvertureEntrants);
                    if (!existe && !tournoiDejaCreeCetteSaison(entree.id, semaineOuvertureEntrants)) {
                        creerTournoi(entree, semaineOuvertureEntrants, rivauxUtilisesOuverture);
                    }
                });
        }

        // Tirage au sort (S-1) : le pool est fige, seede et place dans le tableau.
        const rivauxUtilisesTirage = new Set();
        if (phaseTirage.type === 'tournoi') {
            CALENDRIER_TOURNOIS
                .filter(function (t) { return t.semaine_debut === phaseTirage.positionSemaine; })
                .sort(function (a, b) { return b.taille_tableau - a.taille_tableau; })
                .forEach(function (entree) {
                    let tournoiRow = db.prepare('SELECT * FROM tournois WHERE calendrier_id = ? AND semaine = ?').get(entree.id, semaineTirage);
                    if (!tournoiRow) {
                        if (tournoiDejaCreeCetteSaison(entree.id, semaineTirage)) return; // deja joue cette saison a une autre position (decalage de calendrier)
                        const nouveauId = creerTournoi(entree, semaineTirage, rivauxUtilisesTirage);
                        tournoiRow = { id: nouveauId, statut: 'inscriptions' };
                    }
                    if (tournoiRow.statut === 'inscriptions') {
                        // Plus d'inscription forcee des joueurs du Top 30 fixe aux tournois
                        // obligatoires (revient sur le choix du 2026-08-23, demande explicite
                        // de l'utilisateur, 2026-08-24) : le respect de l'obligation se
                        // verifie desormais au calcul des points (pointsRetenusParEntiteCircuit),
                        // pas ici a l'inscription.
                        tirerAuSort(tournoiRow.id, entree);
                    }
                });
        }

        // Auto-inscription des favoris : intrinsequement une action par coach/joueur,
        // reste une boucle par joueur (le pool existe deja grace a l'ouverture des
        // inscriptions ci-dessus, donc ceci remplace un lambda plutot que d'en creer un).
        joueurs.forEach(function (player) {
            const favori = db.prepare('SELECT calendrier_id FROM tournoi_favoris WHERE player_id = ? AND semaine = ?').get(player.id, semaineOuvertureFavoris);
            if (favori) {
                const entreeFavori = CALENDRIER_TOURNOIS.find(function (t) { return t.id === favori.calendrier_id; });
                if (entreeFavori) {
                    const joueurAJour = db.prepare('SELECT * FROM players WHERE id = ?').get(player.id);
                    inscrireJoueurAuTournoi(player.user_id, joueurAJour, entreeFavori, semaineOuvertureFavoris);
                }
            }
        });

        return nouvelleSemaine;
}

app.post('/api/admin/avancer-semaine', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        const nouvelleSemaine = executerAvancementSemaine();
        res.json({ success: true, nouvelleSemaine });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/admin/avancer-tour', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        const quelqueChoseSimule = executerAvancementTour(true);
        const quelqueChoseSimuleCoupe = executerAvancementTourCoupe(true);
        res.json({ success: true, quelqueChoseSimule: quelqueChoseSimule || quelqueChoseSimuleCoupe });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Combine avancer-semaine + avancer-tour en boucle : joue tous les tours de tous
// les tournois/rencontres de Coupe Davis dus pour la semaine qui vient de
// commencer, sans attendre les creneaux horaires reels. S'arrete naturellement
// des qu'un tournoi/tie touche a une semaine ingame pas encore commencee (meme
// verrou que "Avancer un tour" seul, executerAvancementTour/Coupe) - jamais de
// franchissement vers la semaine suivante. Plafond de securite (50 iterations)
// tres au-dela du plus grand tableau possible (7 tours), simple garde-fou.
app.post('/api/admin/avancer-semaine-et-jouer', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        const nouvelleSemaine = executerAvancementSemaine();
        let toursJoues = 0;
        for (let i = 0; i < 50; i++) {
            const simuleTournoi = executerAvancementTour(true);
            const simuleCoupe = executerAvancementTourCoupe(true);
            if (!simuleTournoi && !simuleCoupe) break;
            toursJoues++;
        }
        res.json({ success: true, nouvelleSemaine, toursJoues });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Verrou manuel : tant que la saison n'est pas "lancee", les 2 schedulers
// automatiques (verifierAvancementAuto/verifierAvancementTourAuto) ne font rien,
// meme si l'horaire reel est depasse - permet de rester bloque en Pre-saison
// aussi longtemps que voulu avant de demarrer une vraie partie. Les boutons
// manuels "Avancer semaine"/"Avancer tour" restent actifs independamment de ce
// verrou (action deliberee de l'admin, jamais bloquee).
app.post('/api/admin/lancer-saison', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        // Redemarre la fenetre de rattrapage a partir de maintenant : evite qu'un
        // long temps de pause ne soit compte comme des echeances manquees a
        // rattraper d'un coup au moment du lancement.
        db.prepare('UPDATE jeu_etat SET saison_lancee = 1, derniere_avancee_auto = ? WHERE id = 1').run(new Date().toISOString());
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Pause manuelle (symetrique de lancer-saison) : meme verrou saison_lancee que
// celui pose automatiquement a chaque nouvelle Pre-saison - bloque les 2
// schedulers auto (semaine + tour), jamais les boutons manuels d'avancement
// (demande explicite de l'utilisateur, 2026-08-23 : jusqu'ici seule la reprise
// avait un bouton, jamais la mise en pause elle-meme).
app.post('/api/admin/pauser-saison', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        db.prepare('UPDATE jeu_etat SET saison_lancee = 0 WHERE id = 1').run();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Verrou manuel independant de saison_lancee : bloque uniquement la CREATION de
// nouveaux comptes (POST /api/inscription), jamais la connexion ni le jeu des
// comptes deja crees. Demande explicite de l'utilisateur, 2026-08-27, le temps de
// brancher le nom de domaine tenniswebmanager.com.
app.post('/api/admin/inscriptions/bloquer', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        db.prepare('UPDATE jeu_etat SET inscriptions_ouvertes = 0 WHERE id = 1').run();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/admin/inscriptions/autoriser', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        db.prepare('UPDATE jeu_etat SET inscriptions_ouvertes = 1 WHERE id = 1').run();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Reset total avant le vrai lancement (cf. memoire project-test-beta-avant-lancement) :
// supprime tous les personnages/tournois/classements/Coupe Davis/pronostics/presse
// de la phase de test beta, mais PRESERVE les comptes coach (users : email, mot de
// passe, pseudo, role, droit de redaction Presse) - decision explicite de
// l'utilisateur, les testeurs n'auront pas besoin de se reinscrire. Rejoue ensuite
// une saison complete (LONGUEUR_SAISON semaines) entierement par des bots, exactement
// comme le tout premier peuplement du jeu (voir memoire project-saison-0-bots,
// 2026-07-19) : sans aucun joueur reel, creerTournoi/tirerAuSort/simulerUnTour
// composent chaque tableau a 100% de rivaux/lambdas, ce qui repeuple les classements
// Live avant que les coachs ne recreent leurs vrais personnages. Meme decalage
// d'affichage (saison_offset=1) pour que leur toute premiere vraie saison s'affiche
// "Saison 1", pas "Saison 2".
function executerResetTotal() {
    const tablesAVider = [
        'players', 'plannings', 'planning_historique', 'journal_semaine_joueur',
        'matchs', 'tournois', 'tournoi_joueurs', 'tournoi_matchs', 'tournoi_favoris',
        'tournoi_liste_attente', 'classement_joueurs', 'pronostics',
        'classement_historique', 'classement_top30', 'coupe_equipes',
        'coupe_composition', 'coupe_rubbers', 'coupe_capitaines',
        'coupe_candidatures', 'coupe_votes', 'coupe_styles', 'coupe_groupe_mondial',
        'semaines_reelles', 'articles_presse', 'evenements_globaux'
    ];
    // PRAGMA foreign_keys=ON par defaut sur ce projet (cf. commentaire plus haut
    // dans database.js, piege RENAME+FK) : players est reference par plannings/
    // planning_historique/journal_semaine_joueur/matchs/tournoi_favoris, donc un
    // simple ordre de suppression ne suffit pas partout (ex. tournoi_favoris peut
    // aussi referencer tournois). Desactive le temps du reset, comme les migrations
    // de reparation existantes le font deja.
    db.exec('PRAGMA foreign_keys = OFF');
    tablesAVider.forEach(function (table) { db.prepare('DELETE FROM ' + table).run(); });
    db.exec('PRAGMA foreign_keys = ON');
    // users, sessions, annonce_admin : volontairement intouches.

    db.prepare('UPDATE jeu_etat SET semaine_actuelle = 1, saison_offset = 0, saison_lancee = 0, derniere_avancee_auto = NULL WHERE id = 1').run();

    // Rejoue semaine par semaine (jamais "hors du temps") : tirerAuSort seed les
    // tetes de serie via le classement Live courant, qui depend de semaine_actuelle,
    // et un tournoi sur 2 semaines a besoin que l'ancre reelle de sa 2e semaine
    // existe deja avant de pouvoir jouer ses derniers tours (executerAvancementTour).
    for (let semaine = 0; semaine < LONGUEUR_SAISON; semaine++) {
        executerAvancementSemaine();
        for (let garde = 0; garde < 50; garde++) {
            const simuleTournoi = executerAvancementTour(true);
            const simuleCoupe = executerAvancementTourCoupe(true);
            if (!simuleTournoi && !simuleCoupe) break;
        }
    }

    db.prepare('UPDATE jeu_etat SET saison_offset = 1 WHERE id = 1').run();

    return db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;
}

// Operation volontairement lourde (rejoue tout un cycle de calendrier complet,
// ~5 minutes mesure en test) : bien trop long pour une requete HTTP synchrone
// classique (risque de timeout du proxy Railway avant la fin, alors meme que le
// traitement continuerait correctement cote serveur). La route repond donc
// IMMEDIATEMENT et lance le travail apres coup (setImmediate) ; l'avancement se
// suit via GET /api/admin/reset-total/statut (poll cote admin.html). Etat en
// memoire seulement (pas en base) : un redemarrage du serveur pendant l'operation
// perdrait juste le suivi de progression, jamais la coherence de la base
// elle-meme (chaque etape de executerResetTotal est deja ecrite/commitee au fur
// et a mesure par better-sqlite3, synchrone par nature).
let resetTotalStatut = null;

app.post('/api/admin/reset-total', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        if (req.body.confirmation !== 'RESET') {
            return res.status(400).json({ error: 'Confirmation manquante ou incorrecte.' });
        }
        if (resetTotalStatut && resetTotalStatut.etat === 'en_cours') {
            return res.status(409).json({ error: 'Une reinitialisation est deja en cours.' });
        }

        resetTotalStatut = { etat: 'en_cours', demarreA: new Date().toISOString() };
        res.json({ success: true, demarre: true });

        setImmediate(function () {
            try {
                const semaineFinale = executerResetTotal();
                resetTotalStatut = { etat: 'termine', semaineFinale, termineA: new Date().toISOString() };
                console.log('Reset total termine, semaineFinale=' + semaineFinale);
            } catch (err) {
                console.error('Erreur pendant le reset total (execution differee) :', err);
                resetTotalStatut = { etat: 'erreur', erreur: err.message };
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/admin/reset-total/statut', (req, res) => {
    if (!estAdmin(req.userId)) {
        return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
    }
    res.json({ success: true, statut: resetTotalStatut });
});

// Route temporaire (2026-08-20) : restaure manuellement le coaching mental perdu
// d'un joueur bloque a tort par le bug "inscription = engage" (corrige juste
// avant) - credite le +1 a gagner / +1 a deplacer que la semaine en cours aurait
// du donner. A n'utiliser qu'une fois, uniquement pour un joueur reellement
// concerne (le coach doit confirmer que la semaine n'a pas encore avance).
app.post('/api/admin/restaurer-coaching-mental/:playerId', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        const { playerId } = req.params;
        const info = db.prepare(`
            UPDATE players SET
                points_dispositions_a_gagner = points_dispositions_a_gagner + 1,
                points_dispositions_a_deplacer = points_dispositions_a_deplacer + 1
            WHERE id = ?
        `).run(playerId);
        if (info.changes === 0) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Route temporaire (2026-08-20) : diagnostique les doublons de personnages
// (aucune contrainte d'unicite sur (user_id, type) avant le garde-fou ajoute sur
// /api/joueurs - un double-clic/double-soumission du formulaire de creation
// pouvait creer 2 fois la paire joueur+joueuse pour le meme compte, silencieusement,
// bug signale par l'utilisateur via un doublon visible dans l'annuaire). Renvoie
// chaque paire en double avec assez de contexte (nb de matchs/tournois lies) pour
// decider en toute securite laquelle des 2 lignes supprimer - a retirer une fois
// le/les doublon(s) trouve(s) et nettoye(s) manuellement.
app.get('/api/admin/diagnostiquer-doublons-joueurs', (req, res) => {
    try {
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }
        const groupes = db.prepare(`
            SELECT user_id, type, COUNT(*) AS n
            FROM players
            GROUP BY user_id, type
            HAVING n > 1
        `).all();

        const resultat = groupes.map(function (g) {
            const lignes = db.prepare('SELECT * FROM players WHERE user_id = ? AND type = ? ORDER BY id').all(g.user_id, g.type);
            lignes.forEach(function (l) {
                l.nbMatchs = db.prepare('SELECT COUNT(*) AS n FROM matchs WHERE player_id = ?').get(l.id).n;
                l.nbTournois = db.prepare('SELECT COUNT(*) AS n FROM tournoi_joueurs WHERE player_id = ? AND est_reel = 1').get(l.id).n;
            });
            return { userId: g.user_id, coachNom: nomCoach(g.user_id), type: g.type, joueurs: lignes };
        });

        res.json({ success: true, doublons: resultat });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Avancement automatique : fidele au PDF ("chaque semaine reelle equivaut a deux
// semaines ingame"), rythme fixe a lundi et jeudi 8h00 heure FRANCAISE (Europe/Paris).
const JOURS_ECHEANCE_AUTO = [1, 4]; // lundi, jeudi
const HEURE_ECHEANCE_AUTO = 8;
const JOURS_SEMAINE_INTL = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Decompose un instant en date/heure LOCALE Europe/Paris (gere automatiquement le
// passage heure ete/hiver via Intl, sans dependance externe).
function partiesParis(date) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Paris', hour12: false, weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = dtf.formatToParts(date).reduce(function (acc, p) { acc[p.type] = p.value; return acc; }, {});
    return {
        annee: Number(parts.year), mois: Number(parts.month), jour: Number(parts.day),
        heure: Number(parts.hour === '24' ? '0' : parts.hour), minute: Number(parts.minute), seconde: Number(parts.second),
        jourSemaine: JOURS_SEMAINE_INTL[parts.weekday]
    };
}

// Construit l'instant UTC correspondant a une date/heure LOCALE Paris donnee (annee,
// moisIndex0 0-11, jour, heure) - contrairement a `new Date(y,m,d,h)` qui utilise le
// fuseau du SERVEUR : sur Railway (UTC), ca decalait l'avancement automatique de 2h
// l'ete / 1h l'hiver par rapport a l'heure francaise annoncee (bug signale par
// l'utilisateur, 2026-08-24 : "10:00" affiche au lieu de "8:00").
function dateParisVersUTC(annee, moisIndex0, jour, heure) {
    const approx = new Date(Date.UTC(annee, moisIndex0, jour, heure, 0, 0));
    const p = partiesParis(approx);
    const commeUTC = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute, p.seconde);
    return new Date(approx.getTime() - (commeUTC - approx.getTime()));
}

// Premiere echeance strictement apres `date` (lundi ou jeudi, 8h00 heure de Paris).
// Avance jour par jour (calendrier Paris) jusqu'a tomber sur un jour valide dont le
// crenau de 8h n'est pas deja passe par rapport a `date`.
function prochaineEcheanceApres(date) {
    let p = partiesParis(date);
    let candidate = dateParisVersUTC(p.annee, p.mois - 1, p.jour, HEURE_ECHEANCE_AUTO);
    while (candidate.getTime() <= date.getTime() || !JOURS_ECHEANCE_AUTO.includes(partiesParis(candidate).jourSemaine)) {
        const pSuivant = partiesParis(new Date(candidate.getTime() + 24 * 3600 * 1000));
        candidate = dateParisVersUTC(pSuivant.annee, pSuivant.mois - 1, pSuivant.jour, HEURE_ECHEANCE_AUTO);
    }
    return candidate;
}

// Toutes les echeances strictement apres `depuis` et jusqu'a `jusqua` inclus, dans
// l'ordre chronologique - couvre le rattrapage de plusieurs echeances manquees.
function echeancesEntre(depuis, jusqua) {
    const resultat = [];
    let courante = prochaineEcheanceApres(depuis);
    while (courante.getTime() <= jusqua.getTime()) {
        resultat.push(courante);
        courante = prochaineEcheanceApres(courante);
    }
    return resultat;
}

let avancementAutoEnCours = false;

// Verifie si une ou plusieurs echeances sont dues et les rattrape dans l'ordre.
// Appelee au demarrage (rattrapage si le serveur etait eteint) puis toutes les
// 15 minutes. Pas de verrou complexe necessaire au-dela du booleen ci-dessus :
// Node est single-threaded et toutes les operations DB sont synchrones
// (better-sqlite3), donc aucun risque reel de concurrence avec un clic manuel sur
// le bouton admin - les deux s'executent simplement l'un apres l'autre.
function verifierAvancementAuto() {
    const gate = db.prepare('SELECT saison_lancee FROM jeu_etat WHERE id = 1').get();
    if (!gate.saison_lancee) return;
    if (avancementAutoEnCours) return;
    avancementAutoEnCours = true;
    try {
        const etat = db.prepare('SELECT derniere_avancee_auto FROM jeu_etat WHERE id = 1').get();
        if (!etat.derniere_avancee_auto) {
            // Premier demarrage jamais vu : point de depart = maintenant, sans
            // rattrapage retroactif (eviterait une rafale d'avancees au tout
            // premier deploiement de cette fonctionnalite).
            db.prepare('UPDATE jeu_etat SET derniere_avancee_auto = ? WHERE id = 1').run(new Date().toISOString());
            return;
        }

        const echeances = echeancesEntre(new Date(etat.derniere_avancee_auto), new Date());
        echeances.forEach(function (echeance) {
            executerAvancementSemaine();
            db.prepare('UPDATE jeu_etat SET derniere_avancee_auto = ? WHERE id = 1').run(echeance.toISOString());
        });
    } finally {
        avancementAutoEnCours = false;
    }
}

// Creneaux de simulation "un tour a la fois", en heures depuis le "changement
// semaine" (8h00, lundi ou jeudi) de la semaine ingame concernee - fonctionne aussi
// bien pour une semaine lundi-mercredi que jeudi-samedi puisque tout est relatif.
const CRENEAUX_TOUR_1_SEMAINE = [0, 9, 24, 33, 48, 52];        // tour1..tour6 (5 ou 6 tours, 1 semaine)
const CRENEAUX_TOUR_2_SEMAINES_S1 = [4, 28, 52];               // tours 1-3 (semaine ingame de depart)
const CRENEAUX_TOUR_2_SEMAINES_S2 = [0, 9, 28, 52];            // huitieme/quart/demi/finale (semaine ingame suivante)

// Simule, pour chaque tournoi en cours, le(s) tour(s) dont le creneau horaire est
// deja atteint (rattrapage naturel si plusieurs echeances ont ete manquees).
// `force=true` (bouton admin manuel, symetrique du bouton "Avancer semaine") ignore
// le creneau horaire et simule immediatement le prochain tour de chaque tournoi, sans
// pour autant contourner la contrainte structurelle "semaine ingame pas commencee"
// (impossible de jouer les huitiemes d'un GC avant que sa 2e semaine n'ait debute).
// Retourne true si au moins un tour a ete simule.
function executerAvancementTour(force) {
    let quelqueChoseSimule = false;

    // Filet de securite : la semaine en cours doit toujours avoir une ancre (postee
    // normalement par executerAvancementSemaine des qu'elle debute). Comble un trou
    // residuel si une transition anterieure a tourne avant la correction du bug
    // d'ancre decalee d'une semaine (2026-08-20), sans quoi le tournoi de la semaine
    // en cours ne trouverait jamais d'ancre et resterait bloque a "rien a simuler".
    const etatCourant = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    db.prepare('INSERT OR IGNORE INTO semaines_reelles (semaine, debut_reel) VALUES (?, ?)').run(etatCourant.semaine_actuelle, new Date().toISOString());

    const idsTournoisActifs = db.prepare("SELECT id FROM tournois WHERE statut = 'a_venir'").all().map(function (r) { return r.id; });

    idsTournoisActifs.forEach(function (tournoiId) {
        let encore = true;
        while (encore) {
            encore = false;
            const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
            if (!tournoi || tournoi.statut !== 'a_venir') break;

            const nbTours = calculerLabelsTours(tournoi.taille_tableau, tournoi.format).length;
            const tourIndex = tournoi.tour_actuel;
            if (tourIndex >= nbTours) break;

            // Tournoi 7 tours (2 semaines) : les tours 0-2 se jouent la semaine de
            // depart, les tours 3-6 (huitieme->finale) la semaine ingame suivante.
            const semaineTour = (nbTours === 7 && tourIndex >= 3) ? tournoi.semaine + 1 : tournoi.semaine;
            const ancre = db.prepare('SELECT debut_reel FROM semaines_reelles WHERE semaine = ?').get(semaineTour);
            if (!ancre) break; // la semaine ingame concernee n'a pas encore commence (verrou naturel)

            let pret = force;
            if (!pret) {
                const creneaux = nbTours === 7
                    ? (tourIndex < 3 ? CRENEAUX_TOUR_2_SEMAINES_S1 : CRENEAUX_TOUR_2_SEMAINES_S2)
                    : CRENEAUX_TOUR_1_SEMAINE;
                const indexCreneau = (nbTours === 7 && tourIndex >= 3) ? tourIndex - 3 : tourIndex;
                const offsetHeures = creneaux[indexCreneau];
                if (offsetHeures === undefined) break;
                const horaire = new Date(ancre.debut_reel).getTime() + offsetHeures * 60 * 60 * 1000;
                pret = Date.now() >= horaire;
            }

            if (pret) {
                if (tournoi.format === 'poules') {
                    simulerUnTourPoules(tournoiId);
                } else {
                    simulerUnTour(tournoiId);
                }
                quelqueChoseSimule = true;
                encore = !force; // en mode force, un seul tour par tournoi et par clic
            }
        }
    });

    return quelqueChoseSimule;
}

let avancementTourEnCours = false;

function verifierAvancementTourAuto() {
    const gate = db.prepare('SELECT saison_lancee FROM jeu_etat WHERE id = 1').get();
    if (!gate.saison_lancee) return;
    if (avancementTourEnCours) return;
    avancementTourEnCours = true;
    try {
        executerAvancementTour();
    } finally {
        avancementTourEnCours = false;
    }
}

// Coupe Davis / Fed Cup : memes creneaux qu'un tournoi individuel classique
// (CRENEAUX_TOUR_1_SEMAINE, une manche = toujours 5 rencontres = les 5 premiers
// creneaux) - une seule rencontre simulee a la fois (simulerUnRubberCoupe), jamais
// les 5 d'un coup. simulerUnRubberCoupe/finaliserMancheCoupe/genererMancheSuivante
// sont definis plus bas (section Coupe Davis), disponibles ici par hoisting.
function executerAvancementTourCoupe(force) {
    let quelqueChoseSimule = false;
    const idsTiesActifs = db.prepare("SELECT id FROM coupe_equipes WHERE statut = 'a_venir'").all().map(function (r) { return r.id; });

    idsTiesActifs.forEach(function (tieId) {
        let encore = true;
        while (encore) {
            encore = false;
            const tie = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tieId);
            if (!tie || tie.statut !== 'a_venir') break;
            if (tie.rubber_actuel >= 5) break;

            const ancre = db.prepare('SELECT debut_reel FROM semaines_reelles WHERE semaine = ?').get(tie.semaine);
            if (!ancre) break; // la semaine ingame de cette manche n'a pas encore commence

            let pret = force;
            if (!pret) {
                const offsetHeures = CRENEAUX_TOUR_1_SEMAINE[tie.rubber_actuel];
                if (offsetHeures === undefined) break;
                const horaire = new Date(ancre.debut_reel).getTime() + offsetHeures * 60 * 60 * 1000;
                pret = Date.now() >= horaire;
            }

            if (pret) {
                simulerUnRubberCoupe(tieId);
                quelqueChoseSimule = true;
                encore = !force;
            }
        }
    });

    return quelqueChoseSimule;
}

let avancementTourCoupeEnCours = false;

function verifierAvancementTourCoupeAuto() {
    const gate = db.prepare('SELECT saison_lancee FROM jeu_etat WHERE id = 1').get();
    if (!gate.saison_lancee) return;
    if (avancementTourCoupeEnCours) return;
    avancementTourCoupeEnCours = true;
    try {
        executerAvancementTourCoupe();
    } finally {
        avancementTourCoupeEnCours = false;
    }
}

const COEFFICIENTS_SURFACE = {
    dur: { service: 2, retour: 2, coup_droit_revers: 2, effet: 1, volee: 1, deplacement: 1, puissance: 2, resistance: 1 },
    herbe: { service: 2, retour: 2, coup_droit_revers: 1, effet: 2, volee: 2, deplacement: 1, puissance: 1, resistance: 1 },
    terre: { service: 1, retour: 1, coup_droit_revers: 2, effet: 2, volee: 1, deplacement: 2, puissance: 1, resistance: 2 }
};

// Double (Coupe Davis/Fed Cup uniquement, pas encore un vrai mode de jeu - simple
// apercu chiffre pour l'instant) : memes coefficients que COEFFICIENTS_SURFACE,
// ponderes par un bonus/malus qui valorise le jeu au filet (Volee tres fortement,
// Deplacement un peu) et penalise le jeu de fond de court pur (Puissance/Resistance),
// Service/Retour/Coup droit-Revers/Effet inchanges (deja maximaux sur les surfaces
// qui comptent, un bonus supplementaire ne les differenciait pas davantage).
const COEFFICIENTS_DOUBLE = {
    dur: { service: 2, retour: 2, coup_droit_revers: 2, effet: 1, volee: 2.25, deplacement: 1.25, puissance: 1.5, resistance: 0.75 },
    herbe: { service: 2, retour: 2, coup_droit_revers: 1, effet: 2, volee: 4.5, deplacement: 1.25, puissance: 0.75, resistance: 0.75 },
    terre: { service: 1, retour: 1, coup_droit_revers: 2, effet: 2, volee: 2.25, deplacement: 2.5, puissance: 0.75, resistance: 1.5 }
};

function niveauDouble(player, surface, bonusEnergieMisee) {
    const coefs = COEFFICIENTS_DOUBLE[surface];
    let total = 0;
    COMPETENCES.forEach(function (cle) {
        total += player[cle] * coefs[cle];
    });
    total += player.forme + player.points_energie + player['surface_' + surface + '_automatismes'] + (bonusEnergieMisee || 0);
    return total;
}

function niveauNormal(player, surface, bonusEnergieMisee) {
    const coefs = COEFFICIENTS_SURFACE[surface];
    let total = 0;
    COMPETENCES.forEach(function (cle) {
        total += player[cle] * coefs[cle];
    });
    // L'energie de base compte integralement (comme avant) ; une mise d'energie sur
    // ce tournoi s'ajoute PAR-DESSUS (coefficient 5 sur la partie misee uniquement),
    // conformement a l'exemple chiffre du PDF - jamais une substitution.
    total += player.forme + player.points_energie + player['surface_' + surface + '_automatismes'] + (bonusEnergieMisee || 0);
    return total;
}

function probabiliteVictoireA(diff) {
    const d = Math.abs(diff);
    let p;
    if (d <= 25) p = 50 + (d / 25) * 4;
    else if (d <= 50) p = 54 + ((d - 25) / 25) * 2.5;
    else if (d <= 100) p = 56.5 + ((d - 50) / 50) * 2.5;
    else p = 59 + ((d - 100) / 100) * 2.5;
    p = Math.min(p, 95);
    return diff >= 0 ? p / 100 : 1 - (p / 100);
}

function tirage(niveauA, niveauB) {
    return Math.random() < probabiliteVictoireA(niveauA - niveauB) ? 'A' : 'B';
}

function nomJoueur(cle) {
    return cle === 'A' ? 'Toi' : 'Adversaire';
}

// Resout UN point : tirage technique simple si ce point n'a rien de decisif
// (menacant = null), sinon un unique tirage avec le mental deja integre au niveau
// (niveau_mental = niveau_normal + mental_courant) - meme mecanique que
// resoudrePointTB pour le tie-break. Plus de 1er tirage technique "a l'aveugle"
// suivi de relances silencieuses tant que technique et mental ne s'accordent pas :
// chaque relance invisible gonflait quand meme pointsImportants (donc le gain de
// mental max) sans jamais apparaitre dans le teletexte (demande explicite de
// l'utilisateur 2026-08-22, divergence assumee du PDF d'origine).
function resoudrePointJeu(niveauA_normal, niveauB_normal, niveauA_mental, niveauB_mental, menacant, libelle, mot, stats, evenements) {
    if (!menacant) {
        return tirage(niveauA_normal, niveauB_normal);
    }

    evenements.push({ type: 'point_important', texte: libelle + ' pour ' + nomJoueur(menacant) });

    stats.pointsImportants++;
    const vainqueur = tirage(niveauA_mental, niveauB_mental);
    const motMajuscule = mot.charAt(0).toUpperCase() + mot.slice(1);
    const texteResolution = vainqueur === menacant
        ? motMajuscule + ' ' + nomJoueur(vainqueur)
        : motMajuscule + ' sauve par ' + nomJoueur(vainqueur);
    evenements.push({ type: 'point_important', texte: texteResolution });
    return vainqueur;
}

// Simule un jeu (service) point par point (0-15-30-40, egalite/avantage) plutot
// qu'en un seul tirage global pour tout le jeu : chaque point ordinaire est un
// tirage technique simple, SAUF le ou les points qui menacent reellement de
// conclure le jeu ALORS que cette conclusion est deja classee decisive pour le
// match (balle de break/set/match, determinee une fois pour tout le jeu par
// l'appelant via pointImportant/menacant) - ceux-la seuls beneficient du double
// tirage technique+mental, et peuvent se repeter plusieurs fois dans le meme jeu
// si la balle est sauvee (retour a l'egalite, puis nouvelle balle) au lieu de
// clore le jeu entier des la 1ere balle de break gagnee sans rejouer (bug signale
// par l'utilisateur, 2026-08-20).
function resoudreJeu(serveur, niveauA_normal, niveauB_normal, niveauA_mental, niveauB_mental, pointImportant, libelleAnnonce, motResolution, menacant, stats, evenements) {
    const libelle = libelleAnnonce || 'Balle de break';
    const mot = motResolution || 'break';
    const relanceur = serveur === 'A' ? 'B' : 'A';
    let ptsA = 0, ptsB = 0;
    let dernierPointAnnonce = false;

    while (true) {
        const completeraitPourServeur = serveur === 'A' ? (ptsA + 1 >= 4 && ptsA + 1 - ptsB >= 2) : (ptsB + 1 >= 4 && ptsB + 1 - ptsA >= 2);
        const completeraitPourRelanceur = relanceur === 'A' ? (ptsA + 1 >= 4 && ptsA + 1 - ptsB >= 2) : (ptsB + 1 >= 4 && ptsB + 1 - ptsA >= 2);

        // Une balle qui menace de faire gagner le jeu au relanceur est TOUJOURS une
        // vraie balle de break, quels que soient les enjeux de set/match (jamais
        // rien qu'un simple tirage technique) - seul le libelle change : celui,
        // specifique, calcule par l'appelant si ce jeu est aussi classe decisif pour
        // le relanceur, sinon le libelle generique par defaut.
        let menacantPoint = null;
        if (completeraitPourRelanceur) {
            menacantPoint = relanceur;
        } else if (completeraitPourServeur && pointImportant && menacant === serveur) {
            menacantPoint = serveur;
        }
        dernierPointAnnonce = menacantPoint !== null;

        const libelleUtilisePourCePoint = (menacantPoint === relanceur && !(pointImportant && menacant === relanceur))
            ? 'Balle de break'
            : libelle;
        const motUtilisePourCePoint = (menacantPoint === relanceur && !(pointImportant && menacant === relanceur))
            ? 'break'
            : mot;

        const vainqueurPoint = resoudrePointJeu(niveauA_normal, niveauB_normal, niveauA_mental, niveauB_mental, menacantPoint, libelleUtilisePourCePoint, motUtilisePourCePoint, stats, evenements);
        if (vainqueurPoint === 'A') ptsA++; else ptsB++;

        if ((ptsA >= 4 || ptsB >= 4) && Math.abs(ptsA - ptsB) >= 2) break;
    }

    const vainqueur = ptsA > ptsB ? 'A' : 'B';
    return { vainqueur, libelleUtilise: dernierPointAnnonce ? libelle : null };
}

function seraitDecisifTB(pts, autre, seuil) {
    return (pts + 1 >= seuil) && (pts + 1 - autre >= 2);
}

function resoudrePointTB(niveauA_normal, niveauB_normal, niveauA_mental, niveauB_mental, menacant, stats, evenements) {
    if (!menacant) {
        return tirage(niveauA_normal, niveauB_normal);
    }

    evenements.push({ type: 'point_important', texte: 'Point decisif pour ' + nomJoueur(menacant) });

    // Un seul tirage, avec le mental deja integre au niveau (niveau_mental =
    // niveau_normal + mental_courant) - plus de 1er tirage technique "a l'aveugle"
    // suivi de relances silencieuses tant que technique et mental ne s'accordent
    // pas : chaque relance invisible gonflait quand meme pointsImportants (donc le
    // gain de mental max) sans jamais apparaitre dans le teletexte (demande
    // explicite de l'utilisateur 2026-08-22, divergence assumee du PDF d'origine).
    stats.pointsImportants++;
    const vainqueur = tirage(niveauA_mental, niveauB_mental);
    const texteResolution = vainqueur === menacant
        ? 'Point ' + nomJoueur(vainqueur)
        : 'Point sauve par ' + nomJoueur(vainqueur);
    evenements.push({ type: 'point_important', texte: texteResolution });
    return vainqueur;
}

function simulerTieBreak(niveauA_normal, niveauB_normal, niveauA_mental, niveauB_mental, stats, evenements, numeroSet, setsA, setsB, seuil) {
    let ptsA = 0, ptsB = 0;
    evenements.push({ type: 'tie_break_debut', texte: '--- Jeu decisif (tie-break) ---', numeroSet, setsA, setsB, jeuxA: 6, jeuxB: 6 });
    while (true) {
        const menacant = seraitDecisifTB(ptsA, ptsB, seuil) ? 'A' : (seraitDecisifTB(ptsB, ptsA, seuil) ? 'B' : null);
        const vainqueur = resoudrePointTB(niveauA_normal, niveauB_normal, niveauA_mental, niveauB_mental, menacant, stats, evenements);
        if (vainqueur === 'A') ptsA++; else ptsB++;
        evenements.push({
            type: 'tie_break_point',
            texte: 'Point du tie-break remporte par ' + (vainqueur === 'A' ? 'Toi' : 'Adversaire') + ' (score : ' + ptsA + '-' + ptsB + ')',
            numeroSet, setsA, setsB, ptsA, ptsB
        });
        if ((ptsA >= seuil || ptsB >= seuil) && Math.abs(ptsA - ptsB) >= 2) break;
    }
    return ptsA > ptsB ? 'A' : 'B';
}

// Styles de jeu (choisis par le joueur reel entre S-1 et S0 d'un tournoi, cf.
// tournoi_joueurs.style_choisi) : deltas de niveau de jeu par manche pour
// Sprinter/Marathonien (cape a la derniere valeur au-dela de la 5e manche).
const STYLE_DELTAS_MANCHE = {
    sprinter: [20, 13, 6, -1, -8],
    marathonien: [0, 7, 14, 21, 28]
};

// ---------- Dispositions (activees le 2026-08-19, bareme fourni par l'utilisateur) ----------
// Bonus de niveau de jeu par rang investi dans une disposition (index = rang,
// plafonne a 10 - les gains d'intersaison/Coaching mental peuvent depasser 5 mais
// aucune valeur au-dela de 10 n'a ete fournie).
const BONUS_DISPOSITION = [0, 5, 10, 15, 20, 25, 29, 33, 36, 38, 40];
function bonusDisposition(rang) {
    return BONUS_DISPOSITION[Math.max(0, Math.min(10, Math.round(rang || 0)))];
}

// Seules les 2 lignes matchs REEL vs REEL sont ecrites separement (une par coach),
// donc match_id ET match_id_j2 peuvent chacun pointer vers la ligne matchs d'un
// joueur donne - LEFT/INNER JOIN sur l'un OU l'autre retrouve la bonne rencontre
// quel que soit le cote joue par ce joueur. Rivaux et lambdas n'ont pas de ligne
// matchs (jamais appelant ici, dispositions reservees aux vrais joueurs).
function confrontationsPasseesDeTournoi(playerId) {
    return db.prepare(`
        SELECT matchs.semaine,
               tj1.player_id AS tj1_player_id, tj1.rival_id AS tj1_rival_id,
               tj2.player_id AS tj2_player_id, tj2.rival_id AS tj2_rival_id
        FROM matchs
        JOIN tournoi_matchs AS tm ON tm.match_id = matchs.id OR tm.match_id_j2 = matchs.id
        JOIN tournoi_joueurs AS tj1 ON tj1.id = tm.joueur1_id
        JOIN tournoi_joueurs AS tj2 ON tj2.id = tm.joueur2_id
        WHERE matchs.player_id = ? AND matchs.tournoi_id IS NOT NULL
    `).all(playerId).map(function (m) {
        const jeSuisTj1 = m.tj1_player_id === Number(playerId);
        return {
            semaine: m.semaine,
            adversairePlayerId: jeSuisTj1 ? m.tj2_player_id : m.tj1_player_id,
            adversaireRivalId: jeSuisTj1 ? m.tj2_rival_id : m.tj1_rival_id
        };
    });
}

// Meme principe que confrontationsPasseesDeTournoi, mais pour les rencontres de
// Coupe Davis/Fed Cup - uniquement les simples (cr.type = 'simple', jamais le
// double, qui n'a pas d'adversaire individuel unique face au joueur).
function confrontationsPasseesCoupe(playerId) {
    return db.prepare(`
        SELECT matchs.semaine,
               cr.domicile_est_reel, cr.domicile_id, cr.exterieur_est_reel, cr.exterieur_id
        FROM matchs
        JOIN coupe_rubbers AS cr ON cr.match_id = matchs.id OR cr.match_id_j2 = matchs.id
        WHERE matchs.player_id = ? AND matchs.coupe_equipe_id IS NOT NULL AND cr.type = 'simple'
    `).all(playerId).map(function (m) {
        const jeSuisDomicile = !!m.domicile_est_reel && m.domicile_id === Number(playerId);
        const adversaireEstReel = jeSuisDomicile ? !!m.exterieur_est_reel : !!m.domicile_est_reel;
        const adversaireId = jeSuisDomicile ? m.exterieur_id : m.domicile_id;
        return {
            semaine: m.semaine,
            adversairePlayerId: adversaireEstReel ? adversaireId : null,
            adversaireRivalId: adversaireEstReel ? null : adversaireId
        };
    });
}

function nbConfrontations(confrontations, adversaireEstReel, adversaireId, limiterASaison, saisonActuelle) {
    return confrontations.filter(function (c) {
        if (limiterASaison && phaseAffichee(c.semaine).numeroSaison !== saisonActuelle) return false;
        return adversaireEstReel ? c.adversairePlayerId === adversaireId : c.adversaireRivalId === adversaireId;
    }).length;
}

// Bonus de niveau de jeu apporte par les dispositions d'un vrai joueur pour UN
// match precis (tournoi individuel ET rencontres de Coupe Davis/Fed Cup en simple -
// jamais le double, qui n'a pas d'adversaire individuel unique). "fixe" s'applique pendant tout le
// match, "sangFroid" seulement dans le set decisif (le jeu se joue toujours en 2
// sets gagnants, donc systematiquement le 3e). Plusieurs dispositions peuvent se
// cumuler (demande explicite de l'utilisateur) : chaque condition remplie ajoute
// son propre bonus indépendamment des autres.
function calculerBonusDispositions(player, adversaireEntree, contexte) {
    const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;
    const saisonActuelle = phaseAffichee(semaineActuelle).numeroSaison;
    const confrontations = confrontationsPasseesDeTournoi(player.id).concat(confrontationsPasseesCoupe(player.id));
    const adversaireEstReel = !!adversaireEntree.est_reel;
    const adversaireId = adversaireEstReel ? adversaireEntree.player_id : adversaireEntree.rival_id;

    const nbSaison = nbConfrontations(confrontations, adversaireEstReel, adversaireId, true, saisonActuelle);
    const nbCarriere = nbConfrontations(confrontations, adversaireEstReel, adversaireId, false, null);

    let fixe = 0;
    if (nbSaison >= 2) fixe += bonusDisposition(player.disposition_adversite); // a partir du 3e match cette saison
    if (!contexte.esTeteDeSerie && contexte.adversaireEsTeteDeSerie) fixe += bonusDisposition(player.disposition_coupeur_de_tetes);
    if (contexte.estDemiOuFinale) fixe += bonusDisposition(player.disposition_dernier_carre);
    // 2 premiers tours normalement, 3 premiers tours pour un tournoi en 2 semaines (PDF).
    if (contexte.tourIndex <= (contexte.premiersToursMax !== undefined ? contexte.premiersToursMax : 1)) fixe += bonusDisposition(player.disposition_premiers_tours);
    if (contexte.estIndoor) fixe += bonusDisposition(player.disposition_indoor);
    if (nbCarriere >= 11) fixe += bonusDisposition(player.disposition_rivalite); // a partir du 12e match en carriere

    return { fixe, sangFroid: bonusDisposition(player.disposition_sang_froid) };
}

// Calcule les niveaux (normal/mental) d'un cote ajustes pour la manche en cours
// selon son style de jeu. Utilisee symetriquement pour A et B : un adversaire
// lambda/rival n'a simplement jamais de style (styleA falsy = aucun ajustement),
// mais un 2e vrai joueur (reel-vs-reel, cf. jouerMatchTournoi) en a un comme
// n'importe quel joueur reel. mentalCourantA n'est necessaire que pour
// "mental_acier" (seul style qui retraite specifiquement la composante mentale
// plutot que de decaler le niveau combine).
function ajusterNiveauxStyle(niveauA_normal, niveauA_mental, styleA, mentalCourantA, numeroSet) {
    if (!styleA) return { normal: niveauA_normal, mental: niveauA_mental };

    if (styleA === 'sprinter' || styleA === 'marathonien') {
        const deltas = STYLE_DELTAS_MANCHE[styleA];
        const delta = deltas[Math.min(numeroSet - 1, deltas.length - 1)];
        return { normal: niveauA_normal + delta, mental: niveauA_mental + delta };
    }
    if (styleA === 'prudence') {
        return { normal: niveauA_normal - 20, mental: niveauA_mental - 20 };
    }
    if (styleA === 'en_avant') {
        return { normal: niveauA_normal + 20, mental: niveauA_mental + 20 };
    }
    if (styleA === 'reperage') {
        return { normal: niveauA_normal - 15, mental: niveauA_mental - 15 };
    }
    if (styleA === 'mental_acier' && mentalCourantA !== undefined) {
        return { normal: niveauA_normal, mental: niveauA_normal + mentalCourantA * 0.8 };
    }
    return { normal: niveauA_normal, mental: niveauA_mental };
}

// bonusSangFroidA/B (disposition "Sang froid", optionnels) : n'ajoutent au niveau
// de jeu que dans le set decisif - le jeu se joue toujours en 2 sets gagnants, donc
// c'est systematiquement le 3e set (numeroSet === 3), jamais un 5e.
// etatPhysiqueA/B (optionnels) : { forme, pointsEnergie, condition } d'un vrai
// joueur AVANT le match, pour tirer une eventuelle alerte kine jeu par jeu et
// degrader dynamiquement son niveau de jeu pour le reste du match (regle du PDF,
// demande explicite de l'utilisateur, 2026-08-21) - absent/falsy pour un
// adversaire lambda/rival ou une equipe de double, qui n'ont pas de condition
// physique individuelle suivie.
function simulerMatch(niveauA_normal, niveauA_mental, niveauB_normal, niveauB_mental, styleA, mentalCourantA, styleB, mentalCourantB, bonusSangFroidA, bonusSangFroidB, meilleurDe5, etatPhysiqueA, etatPhysiqueB) {
    // Exception PDF : un match de Grand Chelem chez les hommes se joue en 3 sets
    // gagnants (5 sets max) au lieu de 2 (3 sets max) partout ailleurs - le set
    // decisif (Sang froid, tie-break a 10 points) se deplace donc du 3e au 5e set.
    const setsRequis = meilleurDe5 ? 3 : 2;
    const numeroSetDecisif = meilleurDe5 ? 5 : 3;
    let setsA = 0, setsB = 0;
    const scoreParManche = [];
    let totalJeux = 0;
    let serveur = 'A';
    const stats = { pointsImportants: 0 };
    const evenements = [];
    let numeroSet = 1;
    let ballesBreakSauveesA = 0, ballesBreakSauveesB = 0;

    // Condition/malus dynamiques : demarrent a l'etat d'avant-match, puis peuvent
    // evoluer jeu par jeu (voir tenterAlerteKine plus bas) - un adversaire sans
    // etatPhysique (lambda/rival/double) n'a jamais de malus, jamais de tirage.
    let conditionActuelleA = etatPhysiqueA ? (etatPhysiqueA.condition || 'en_forme') : null;
    let conditionActuelleB = etatPhysiqueB ? (etatPhysiqueB.condition || 'en_forme') : null;
    let malusActuelA = etatPhysiqueA ? malusCondition(conditionActuelleA) : 0;
    let malusActuelB = etatPhysiqueB ? malusCondition(conditionActuelleB) : 0;

    // Si un joueur atteint "Blesse" PENDANT le match, il est contraint a l'abandon
    // (meme regle que le forfait pre-match, PDF) - abandonCote stoppe la simulation
    // des que possible (voir les points d'appel plus bas).
    let abandonCote = null;

    // Renvoie l'evenement kine/abandon a pousser (ou null), sans le pousser lui-meme
    // dans `evenements` et SANS toucher a abandonCote - l'appelant insere l'evenement
    // AVANT de jouer le jeu concerne (voir les points d'appel plus bas), pas apres :
    // l'alerte precede toujours le jeu qu'elle affecte, jamais son resultat. Ne pas
    // fixer abandonCote ici permet a l'appelant de tester les DEUX cotes de maniere
    // independante avant de decider qui abandonne (cf. cas des deux joueurs blesses
    // sur le meme jeu, PDF : tirage equiprobable).
    function tenterAlerteKine(cote) {
        const etatPhysique = cote === 'A' ? etatPhysiqueA : etatPhysiqueB;
        if (!etatPhysique) return null;
        const conditionActuelle = cote === 'A' ? conditionActuelleA : conditionActuelleB;
        if (conditionActuelle === 'blesse') return null; // deja blesse, plus rien a tirer
        const nouvelleCondition = tirageDegradationJeu(conditionActuelle, etatPhysique.forme, etatPhysique.pointsEnergie);
        if (nouvelleCondition === conditionActuelle) return null;
        if (cote === 'A') { conditionActuelleA = nouvelleCondition; malusActuelA = malusCondition(nouvelleCondition); }
        else { conditionActuelleB = nouvelleCondition; malusActuelB = malusCondition(nouvelleCondition); }

        if (nouvelleCondition === 'blesse') {
            const estJoueuse = etatPhysique.type === 'joueuse';
            const texteAbandon = estJoueuse ? 'elle est obligée d\'abandonner.' : 'il est obligé d\'abandonner.';
            return { type: 'abandon', texte: '➕ John n\'a rien pu faire pour ' + nomJoueur(cote) + ', ' + texteAbandon };
        }
        return { type: 'kine', texte: '🚑 ' + nomJoueur(cote) + ' fait appel à John le kiné.' };
    }

    while (setsA < setsRequis && setsB < setsRequis) {
        const bonusSetDecisifA = numeroSet === numeroSetDecisif ? (bonusSangFroidA || 0) : 0;
        const bonusSetDecisifB = numeroSet === numeroSetDecisif ? (bonusSangFroidB || 0) : 0;
        evenements.push({
            type: 'set_debut',
            texte: '--- Set ' + numeroSet + ' (Service : ' + nomJoueur(serveur) + ') ---',
            numeroSet, setsA, setsB, jeuxA: 0, jeuxB: 0, serveur
        });
        let jeuxA = 0, jeuxB = 0;
        while (true) {
            // Tirage kine/abandon AVANT ce jeu (pas apres) : l'alerte concerne le jeu
            // qui va se jouer, pas le suivant - elle s'affiche donc avant l'annonce de
            // son resultat, et son malus (le cas echeant) s'applique des ce jeu-la.
            // Les deux cotes sont TOUJOURS testes independamment (PDF) - si les deux
            // deviennent blesses sur ce meme jeu, un tirage equiprobable determine
            // lequel abandonne (sinon A "gagnait" systematiquement l'abandon des que
            // son propre tirage reussissait, le tirage de B n'etant jamais effectue).
            const alerteA = tenterAlerteKine('A');
            const alerteB = tenterAlerteKine('B');
            if (alerteA) evenements.push(alerteA);
            if (alerteB) evenements.push(alerteB);
            const aAbandonneA = alerteA && alerteA.type === 'abandon';
            const aAbandonneB = alerteB && alerteB.type === 'abandon';
            if (aAbandonneA && aAbandonneB) {
                abandonCote = Math.random() < 0.5 ? 'A' : 'B';
            } else if (aAbandonneA) {
                abandonCote = 'A';
            } else if (aAbandonneB) {
                abandonCote = 'B';
            }
            if (abandonCote) break; // ne peut meme pas commencer ce jeu

            // Recalcule a CHAQUE jeu (pas une fois par set) : une alerte kine peut avoir
            // change le malus de condition a l'instant, et ca doit affecter immediatement
            // le niveau de jeu utilise pour CE jeu.
            const niveauxA = ajusterNiveauxStyle(niveauA_normal - malusActuelA + bonusSetDecisifA, niveauA_mental - malusActuelA, styleA, mentalCourantA, numeroSet);
            const niveauA_normal_manche = niveauxA.normal;
            const niveauA_mental_manche = niveauxA.mental;
            const niveauxB = ajusterNiveauxStyle(niveauB_normal - malusActuelB + bonusSetDecisifB, niveauB_mental - malusActuelB, styleB, mentalCourantB, numeroSet);
            const niveauB_normal_manche = niveauxB.normal;
            const niveauB_mental_manche = niveauxB.mental;

            if (jeuxA === 6 && jeuxB === 6) {
                // 5e set d'un match en 3 sets gagnants : jeu decisif a 10 points (au lieu
                // de 7) et gagne de 2 points d'ecart, seule exception au reglement normal.
                const seuilTB = (meilleurDe5 && numeroSet === 5) ? 10 : 7;
                const vainqueurTB = simulerTieBreak(niveauA_normal_manche, niveauB_normal_manche, niveauA_mental_manche, niveauB_mental_manche, stats, evenements, numeroSet, setsA, setsB, seuilTB);
                if (vainqueurTB === 'A') jeuxA++; else jeuxB++;
                totalJeux++;
                break;
            }

            const relanceur = serveur === 'A' ? 'B' : 'A';
            const gamesServeur = serveur === 'A' ? jeuxA : jeuxB;
            const gamesRelanceur = serveur === 'A' ? jeuxB : jeuxA;
            const setsServeur = serveur === 'A' ? setsA : setsB;
            const setsRelanceur = serveur === 'A' ? setsB : setsA;

            const completeraitManchePourServeur = (gamesServeur + 1 >= 6) && (gamesServeur + 1 - gamesRelanceur >= 2);
            const completeraitManchePourRelanceur = (gamesRelanceur + 1 >= 6) && (gamesRelanceur + 1 - gamesServeur >= 2);
            const completeraitMatchServeur = completeraitManchePourServeur && (setsServeur + 1 === setsRequis);
            const completeraitMatchRelanceur = completeraitManchePourRelanceur && (setsRelanceur + 1 === setsRequis);

            // Une balle qui se gagne en cassant le service (le relanceur la remporte) est
            // toujours au moins une "balle de break" ; si elle termine aussi le set ou le
            // match, on l'indique en plus (ex: "Balle de break / Balle de set").
            let libelleAnnonce = null;
            let motResolution = null;
            let menacant = relanceur;
            if (completeraitMatchServeur) {
                libelleAnnonce = 'Balle de match';
                motResolution = 'match';
                menacant = serveur;
            } else if (completeraitMatchRelanceur) {
                libelleAnnonce = 'Balle de break / Balle de match';
                motResolution = 'break';
                menacant = relanceur;
            } else if (completeraitManchePourServeur) {
                libelleAnnonce = 'Balle de set';
                motResolution = 'set';
                menacant = serveur;
            } else if (completeraitManchePourRelanceur) {
                libelleAnnonce = 'Balle de break / Balle de set';
                motResolution = 'break';
                menacant = relanceur;
            }

            const pointImportant = libelleAnnonce !== null;

            const resultatJeu = resoudreJeu(serveur, niveauA_normal_manche, niveauB_normal_manche, niveauA_mental_manche, niveauB_mental_manche, pointImportant, libelleAnnonce, motResolution, menacant, stats, evenements);
            const vainqueurJeu = resultatJeu.vainqueur;

            // Balle de break sauvee : le serveur de CE jeu (avant relève ci-dessous)
            // remporte un jeu qui, s'il l'avait perdu, aurait ete un break pour le
            // relanceur - jamais compte dans un tie-break (pas de notion de break la-dedans).
            if (motResolution === 'break' && vainqueurJeu === serveur) {
                if (serveur === 'A') ballesBreakSauveesA++; else ballesBreakSauveesB++;
            }

            if (vainqueurJeu === 'A') jeuxA++; else jeuxB++;
            totalJeux++;
            serveur = relanceur;

            evenements.push({
                type: 'jeu',
                texte: resultatJeu.libelleUtilise
                    ? resultatJeu.libelleUtilise + ' : Jeu ' + jeuxA + '-' + jeuxB
                    : 'Jeu remporte par ' + (vainqueurJeu === 'A' ? 'Toi' : 'Adversaire') + ' (score du set : ' + jeuxA + '-' + jeuxB + ')',
                numeroSet, setsA, setsB, jeuxA, jeuxB
            });
            if ((jeuxA >= 6 || jeuxB >= 6) && Math.abs(jeuxA - jeuxB) >= 2) break;
        }

        // Set incomplet suite a un abandon : le score brut du moment est quand meme
        // affiche (comme un vrai tableau de score), mais ce set n'est gagne par
        // personne (pas d'incrementation de setsA/setsB) et pas de "Set remporte
        // par..." puisqu'il ne l'a pas ete - on sort direct vers le bilan du match.
        scoreParManche.push(jeuxA + '-' + jeuxB);
        if (abandonCote) break;
        if (jeuxA > jeuxB) setsA++; else setsB++;
        evenements.push({
            type: 'set_fin',
            texte: 'Set ' + numeroSet + ' remporte par ' + (jeuxA > jeuxB ? 'Toi' : 'Adversaire') + ' (' + jeuxA + '-' + jeuxB + ')',
            numeroSet, setsA, setsB, jeuxA, jeuxB, scoreSet: jeuxA + '-' + jeuxB
        });
        numeroSet++;
    }

    if (abandonCote) {
        const vainqueurAbandon = abandonCote === 'A' ? 'B' : 'A';
        const scoreAbandon = scoreParManche.join(', ') + ' (Abandon)';
        evenements.push({
            type: 'match_fin',
            texte: 'Match termine : ' + (vainqueurAbandon === 'A' ? 'Victoire' : 'Defaite') + ' ' + scoreAbandon,
            setsA, setsB
        });
        return {
            vainqueur: vainqueurAbandon,
            score: scoreAbandon,
            totalJeux,
            pointsImportants: stats.pointsImportants,
            ballesBreakSauveesA,
            ballesBreakSauveesB,
            conditionFinaleA: conditionActuelleA,
            conditionFinaleB: conditionActuelleB,
            evenements
        };
    }

    evenements.push({
        type: 'match_fin',
        texte: 'Match termine : ' + (setsA > setsB ? 'Victoire' : 'Defaite') + ' ' + scoreParManche.join(', '),
        setsA, setsB
    });

    return {
        vainqueur: setsA > setsB ? 'A' : 'B',
        score: scoreParManche.join(', '),
        totalJeux,
        pointsImportants: stats.pointsImportants,
        ballesBreakSauveesA,
        ballesBreakSauveesB,
        conditionFinaleA: conditionActuelleA,
        conditionFinaleB: conditionActuelleB,
        evenements
    };
}

const ROUND_LABELS = { 2: 'Finale', 4: '1/2 finale', 8: '1/4 finale', 16: '8e de finale', 32: '16e de finale', 64: '32e de finale', 128: '64e de finale' };

// Libelles (pour le selecteur de styles, un par tour possible) de tous les tours
// qu'un joueur pourrait avoir a jouer dans un tournoi donne, dans l'ordre. Les
// Masters de fin de saison (format 'poules') ont une structure fixe a part.
function calculerLabelsTours(tailleTableau, format) {
    if (format === 'poules') {
        return ['Phase de poules (match 1)', 'Phase de poules (match 2)', 'Phase de poules (match 3)', 'Demi-finale', 'Finale'];
    }
    let taillePuissance2 = 1;
    while (taillePuissance2 < tailleTableau) taillePuissance2 *= 2;
    const labels = [];
    let entrants = taillePuissance2;
    while (entrants >= 2) {
        labels.push(ROUND_LABELS[entrants] || (entrants + 'e de finale'));
        entrants = entrants / 2;
    }
    return labels;
}

// ---------- Pronostics ----------

// Type de pari pour un tournoi donne : cascade (5 tours) pour M1000/GC, simple
// (vainqueur seul) pour tout le reste (250/500, Masters de fin de saison).
function typePronostic(tournoi) {
    return (tournoi.categorie === '1000' || tournoi.categorie === 'slam') ? 'cascade' : 'simple';
}

// Points pour un pari "vainqueur seul" correct : 5 pour les Masters de fin de
// saison (rarete/prestige, seuls 8 entrants), 3 pour un tournoi simple normal.
function pointsVainqueurSimple(tournoi) {
    return tournoi.categorie === 'finals' ? 5 : 3;
}

// Seuls les vrais joueurs sont proposables au pronostic (rivaux/lambdas exclus,
// demande explicite de l'utilisateur 2026-08-21) - SAUF si ca viderait totalement
// la liste (aucun vrai joueur dans cette portion du tableau), auquel cas on retombe
// sur la liste complete pour ne pas rendre cette tranche impronosticable.
function reelsOuTousSiVide(liste) {
    const reels = liste.filter(function (e) { return e.est_reel; });
    return reels.length > 0 ? reels : liste;
}

// Decoupe les entrants d'un tableau (tries par position_tableau) en 16 tranches
// consecutives - "huitieme de finale" designe toujours structurellement 16 joueurs,
// quelle que soit la taille du tableau (56 ou 128), donc toujours 16 tranches.
// Les lignes BYE sont exclues (jamais un choix valide, pas un vrai entrant).
function trancheHuitiemes(entrants, taillePuissance2) {
    const parTranche = taillePuissance2 / 16;
    const tranches = [];
    for (let i = 0; i < 16; i++) {
        const debut = i * parTranche;
        const brute = entrants.slice(debut, debut + parTranche).filter(function (e) { return e.nom !== 'BYE'; });
        tranches.push(reelsOuTousSiVide(brute));
    }
    return tranches;
}

// Verifie qu'une cascade soumise est interieurement coherente : chaque huitieme
// appartient bien a sa tranche, et chaque tour suivant ne pioche que parmi les 2
// choix du tour precedent pour la paire concernee. Protege contre un client qui
// soumettrait des ids incoherents, meme si l'UI normale ne le permet pas.
function validerCascade(predictions, tranchesHuitiemes) {
    const huitiemes = predictions.huitiemes, quarts = predictions.quarts, demies = predictions.demies, finale = predictions.finale, vainqueur = predictions.vainqueur;
    if (!Array.isArray(huitiemes) || huitiemes.length !== 16) return false;
    if (!Array.isArray(quarts) || quarts.length !== 8) return false;
    if (!Array.isArray(demies) || demies.length !== 4) return false;
    if (!Array.isArray(finale) || finale.length !== 2) return false;
    if (typeof vainqueur !== 'number') return false;

    for (let i = 0; i < 16; i++) {
        if (!tranchesHuitiemes[i].some(function (e) { return e.id === huitiemes[i]; })) return false;
    }
    function verifiePaires(niveauSuivant, niveauPrecedent) {
        for (let i = 0; i < niveauSuivant.length; i++) {
            const attendus = [niveauPrecedent[2 * i], niveauPrecedent[2 * i + 1]];
            if (attendus.indexOf(niveauSuivant[i]) === -1) return false;
        }
        return true;
    }
    if (!verifiePaires(quarts, huitiemes)) return false;
    if (!verifiePaires(demies, quarts)) return false;
    if (!verifiePaires(finale, demies)) return false;
    if (vainqueur !== finale[0] && vainqueur !== finale[1]) return false;

    return true;
}

// "Present au moins jusqu'au tour cible" : Vainqueur = present partout ; sinon on
// compare l'index du tour ou le joueur a reellement perdu a l'index du tour vise,
// dans l'ordre chronologique donne par calculerLabelsTours (tour le plus tot en
// premier). Perdre a un tour plus tardif implique avoir ete present a tous les
// tours precedents (il fallait les gagner pour y arriver).
function aAtteintTour(tourElimineReel, tourCible, labelsTours) {
    if (tourElimineReel === 'Vainqueur') return true;
    const idxReel = labelsTours.indexOf(tourElimineReel);
    const idxCible = labelsTours.indexOf(tourCible);
    if (idxReel === -1 || idxCible === -1) return false;
    return idxReel >= idxCible;
}

const BAREME_CASCADE = [
    { cle: 'huitiemes', tour: '8e de finale', pts: 1 },
    { cle: 'quarts', tour: '1/4 finale', pts: 2 },
    { cle: 'demies', tour: '1/2 finale', pts: 3 },
    { cle: 'finale', tour: 'Finale', pts: 4 }
];

// Calcule et enregistre les points de tous les pronostics en attente pour un
// tournoi qui vient d'etre simule. Appelee juste apres simulerTournoi/
// simulerTournoiPoules dans avancer-semaine.
function calculerPointsPronostics(tournoiId) {
    const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
    const enAttente = db.prepare('SELECT * FROM pronostics WHERE tournoi_id = ? AND points_gagnes IS NULL').all(tournoiId);
    if (enAttente.length === 0) return;

    const entrants = db.prepare('SELECT id, tour_elimine FROM tournoi_joueurs WHERE tournoi_id = ?').all(tournoiId);
    const tourEliminePar = new Map(entrants.map(function (e) { return [e.id, e.tour_elimine]; }));

    const type = typePronostic(tournoi);
    const labelsTours = type === 'cascade' ? calculerLabelsTours(tournoi.taille_tableau, tournoi.format) : null;

    enAttente.forEach(function (p) {
        let predictions;
        try { predictions = JSON.parse(p.predictions); } catch (e) { predictions = null; }
        if (!predictions) {
            db.prepare('UPDATE pronostics SET points_gagnes = 0 WHERE id = ?').run(p.id);
            return;
        }

        let points = 0;
        if (type === 'simple') {
            if (tourEliminePar.get(predictions.vainqueur) === 'Vainqueur') {
                points = pointsVainqueurSimple(tournoi);
            }
        } else {
            BAREME_CASCADE.forEach(function (etape) {
                (predictions[etape.cle] || []).forEach(function (id) {
                    const tourReel = tourEliminePar.get(id);
                    if (tourReel && aAtteintTour(tourReel, etape.tour, labelsTours)) {
                        points += etape.pts;
                    }
                });
            });
            if (tourEliminePar.get(predictions.vainqueur) === 'Vainqueur') {
                points += 5;
            }
        }

        db.prepare('UPDATE pronostics SET points_gagnes = ? WHERE id = ?').run(points, p.id);
    });
}

function melanger(liste) {
    const copie = liste.slice();
    for (let i = copie.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = copie[i];
        copie[i] = copie[j];
        copie[j] = tmp;
    }
    return copie;
}

// Roster persistant de rivaux fictifs par coach et par circuit, utilise pour que
// les Classements (ATP/WTA Live/Race) aient de vrais rivaux qui cumulent des
// points d'un tournoi a l'autre, plutot que des lambdas jetables. Genere une
// seule fois (lazy-init) avec une repartition de niveaux en pyramide.
const ROSTER_SIZE = 200;
const CATEGORIES_ROSTER = [250, 250, 250, 500, 500, 500, 1000, 1000, 1000, 'slam', 'slam'];

// Fourchette de niveau dediee au roster persistant, volontairement plus basse que
// NIVEAU_LAMBDA_PAR_CATEGORIE (qui reste inchangee, utilisee par les lambdas
// jetables de tous les tournois) : les rivaux persistants ne doivent jamais
// devenir une vraie menace pour un joueur reel developpe, ils servent seulement a
// completer les tableaux et alimenter les classements avant/independamment de la
// progression des joueurs reels.
const NIVEAU_ROSTER_PAR_CATEGORIE = {
    250: { min: 120, max: 190 },
    500: { min: 150, max: 220 },
    1000: { min: 180, max: 250 },
    slam: { min: 200, max: 270 }
};

function assurerRoster(circuit) {
    const existant = db.prepare('SELECT COUNT(*) AS n FROM classement_joueurs WHERE circuit = ?').get(circuit);
    if (existant.n > 0) return;

    const estFeminin = circuit === 'WTA';
    const insert = db.prepare('INSERT INTO classement_joueurs (circuit, nom, nationalite, niveau) VALUES (?, ?, ?, ?)');
    const nomsUtilises = new Set();

    for (let i = 0; i < ROSTER_SIZE; i++) {
        const categorie = CATEGORIES_ROSTER[Math.floor(Math.random() * CATEGORIES_ROSTER.length)];
        let rival;
        do {
            rival = genererJoueurLambda(categorie, estFeminin);
        } while (nomsUtilises.has(rival.nom));
        nomsUtilises.add(rival.nom);
        const fourchette = NIVEAU_ROSTER_PAR_CATEGORIE[categorie];
        const niveau = Math.round(fourchette.min + Math.random() * (fourchette.max - fourchette.min));
        insert.run(circuit, rival.nom, rival.nationalite, niveau);
    }
}

// Regle "18/16 meilleurs resultats" ATP/WTA (fidele aux vraies regles du tour,
// demande explicite de l'utilisateur, 2026-08-22) - le classement Live/Race
// n'est plus une simple somme de tous les points gagnes : seuls les N meilleurs
// resultats comptent : 18 pour l'ATP, 16 pour la WTA (+1 si qualifie·e aux
// Masters de fin de saison dans la fenetre, regle WTA uniquement).
const NB_RESULTATS_RETENUS = { ATP: 18, WTA: 16 };

// Masters 1000 obligatoires pour le Top 30 fixe - reprend les vraies
// designations du circuit. Monte-Carlo (ATP) en est exclu (seul M1000
// traditionnellement facultatif) ; cote WTA, seuls ces 4 WTA1000 sont
// obligatoires (les 6 autres restent facultatifs, comme un 500/250).
const M1000_OBLIGATOIRE_TOP30 = {
    ATP: ['atp-indian-wells', 'atp-miami', 'atp-madrid', 'atp-rome', 'atp-canada', 'atp-cincinnati', 'atp-shanghai', 'atp-paris'],
    WTA: ['wta-indian-wells', 'wta-miami', 'wta-madrid', 'wta-beijing']
};

function estTournoiObligatoireTop30(circuit, calendrierId, categorie) {
    return categorie === 'slam' || (M1000_OBLIGATOIRE_TOP30[circuit] || []).indexOf(calendrierId) !== -1;
}

// Points retenus (regle des N meilleurs resultats) pour TOUTES les entites
// (vrais joueurs + rivaux persistants) d'un circuit sur une fenetre donnee, en
// un minimum de requetes SQL (un balayage groupe plutot qu'une requete par
// entite). Retourne une Map cle ('joueur:ID'/'rival:ID') -> points retenus.
//
// Regle des tournois obligatoires (Grand Chelem, Masters 1000 designes) pour un
// vrai joueur classe dans le Top 30 fixe de la saison concernee (classement_top30) :
// PLUS d'inscription forcee (revient sur le choix du 2026-08-23, demande
// explicite de l'utilisateur, 2026-08-24) - le coach reste libre de ne pas
// inscrire son joueur. En revanche, chaque occurrence obligatoire, si elle est
// TERMINEE dans la fenetre, occupe TOUJOURS un des N resultats retenus : avec le
// resultat reellement obtenu s'il a participe, ou un ZERO force sinon - ce n'est
// donc PAS equivalent a "l'ignorer" (qui reviendrait juste a completer avec le
// meilleur resultat volontaire suivant). Seuls les resultats VOLONTAIRES
// (non-obligatoires, ou obligatoires d'une saison ou le joueur n'etait pas
// Top 30) se disputent les slots restants (N moins le nombre d'obligatoires deja
// comptes, jamais negatif). La fenetre (52 semaines, FENETRE_LIVE) chevauche
// quasi-systematiquement 2 saisons (LONGUEUR_SAISON=51) : le Top 30 et le
// calendrier obligatoire sont donc verifies saison par saison, pas globalement.
function pointsRetenusParEntiteCircuit(circuit, semaineMin, semaineActuelle) {
    const tournois = db.prepare(`
        SELECT id, semaine, categorie, calendrier_id FROM tournois
        WHERE circuit = ? AND semaine > ? AND semaine <= ? AND statut = 'termine'
    `).all(circuit, semaineMin, semaineActuelle);
    const infoTournoi = new Map(tournois.map(function (t) { return [t.id, t]; }));

    const tournoisObligatoires = tournois
        .filter(function (t) { return estTournoiObligatoireTop30(circuit, t.calendrier_id, t.categorie); })
        .map(function (t) { return Object.assign({}, t, { saison: phaseAffichee(t.semaine).numeroSaison }); });

    const top30ParSaison = new Map();
    new Set(tournoisObligatoires.map(function (t) { return t.saison; })).forEach(function (saison) {
        const rows = db.prepare('SELECT cle FROM classement_top30 WHERE saison = ? AND circuit = ?').all(saison, circuit);
        top30ParSaison.set(saison, new Set(rows.map(function (r) { return r.cle; })));
    });

    const resultats = db.prepare(`
        SELECT tj.player_id, tj.rival_id, tj.points_gagnes, tj.tournoi_id
        FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
        WHERE t.circuit = ? AND t.semaine > ? AND t.semaine <= ? AND t.statut = 'termine'
          AND tj.points_gagnes IS NOT NULL
          AND ((tj.player_id IS NOT NULL AND tj.est_reel = 1) OR tj.rival_id IS NOT NULL)
    `).all(circuit, semaineMin, semaineActuelle);

    const parEntite = new Map();
    resultats.forEach(function (r) {
        const cle = r.player_id ? 'joueur:' + r.player_id : 'rival:' + r.rival_id;
        if (!parEntite.has(cle)) parEntite.set(cle, new Map());
        parEntite.get(cle).set(r.tournoi_id, r.points_gagnes);
    });

    // Toutes les entites concernees : celles qui ont au moins un resultat, PLUS
    // les joueurs Top 30 d'une saison presente dans la fenetre meme sans aucun
    // resultat du tout (leurs zeros obligatoires doivent quand meme compter).
    const cles = new Set(parEntite.keys());
    top30ParSaison.forEach(function (set) { set.forEach(function (cle) { if (cle.indexOf('joueur:') === 0) cles.add(cle); }); });

    const points = new Map();
    cles.forEach(function (cle) {
        const resultatsParTournoi = parEntite.get(cle) || new Map();

        const estJoueur = cle.indexOf('joueur:') === 0;
        const obligatoiresApplicables = estJoueur
            ? tournoisObligatoires.filter(function (t) { return (top30ParSaison.get(t.saison) || new Set()).has(cle); })
            : [];
        const idsObligatoires = new Set(obligatoiresApplicables.map(function (t) { return t.id; }));

        const valeursObligatoires = obligatoiresApplicables.map(function (t) { return resultatsParTournoi.get(t.id) || 0; });
        const valeursVolontaires = [];
        let qualifieFinalsWTA = false;
        resultatsParTournoi.forEach(function (pts, tournoiId) {
            if (idsObligatoires.has(tournoiId)) return;
            valeursVolontaires.push(pts);
            if (infoTournoi.get(tournoiId) && infoTournoi.get(tournoiId).categorie === 'finals') qualifieFinalsWTA = true;
        });

        let n = NB_RESULTATS_RETENUS[circuit];
        if (circuit === 'WTA' && qualifieFinalsWTA) n += 1;

        const slotsVolontairesRestants = Math.max(0, n - valeursObligatoires.length);
        const meilleursVolontaires = valeursVolontaires.sort(function (a, b) { return b - a; }).slice(0, slotsVolontairesRestants);

        const total = valeursObligatoires.reduce(function (s, x) { return s + x; }, 0) + meilleursVolontaires.reduce(function (s, x) { return s + x; }, 0);
        points.set(cle, total);
    });

    return points;
}

// Classement PARTAGE (tous coachs confondus, pas un seul) pour un circuit et une
// fenetre de semaines donnes : rivaux persistants + TOUS les joueurs reels valides
// de ce circuit. Utilise pour la qualification aux Masters de fin de saison (Top 8
// Race), pour l'annuaire (Top Live par nation), et pour les onglets ATP/WTA
// Live/Race de classements.html (2026-08-16 - avant cette date, ces onglets
// passaient par une fonction separee qui ne montrait que les rivaux + le joueur de
// l'appelant, jamais les vrais joueurs des AUTRES coachs meme s'ils avaient deja
// marque des points).
// Les points d'un tournoi encore en cours (statut != 'termine') ne comptent pas
// encore dans le classement, meme si certains joueurs sont deja elimines - ils ne
// sont credites qu'une fois le tournoi entierement termine.
function calculerClassementGlobal(circuit, semaineMin, semaineActuelle) {
    const pointsRetenus = pointsRetenusParEntiteCircuit(circuit, semaineMin, semaineActuelle);

    const rivaux = db.prepare('SELECT id, nom, nationalite, niveau FROM classement_joueurs WHERE circuit = ?').all(circuit);
    const liste = rivaux.map(function (r) {
        const cle = 'rival:' + r.id;
        return { cle, nom: r.nom, nationalite: r.nationalite, drapeau: drapeau(r.nationalite), points: pointsRetenus.get(cle) || 0, niveau: r.niveau, playerId: null, rivalId: r.id, userId: null };
    });

    const type = circuit === 'ATP' ? 'joueur' : 'joueuse';
    const joueursReels = db.prepare("SELECT * FROM players WHERE type = ? AND statut = 'valide'").all(type);
    joueursReels.forEach(function (p) {
        const cle = 'joueur:' + p.id;
        liste.push({
            cle,
            nom: p.prenom + ' ' + p.nom,
            prenom: p.prenom,
            nomFamille: p.nom,
            nationalite: p.nationalite,
            drapeau: drapeau(p.nationalite),
            points: pointsRetenus.get(cle) || 0,
            niveau: p.niveau,
            playerId: p.id,
            rivalId: null,
            userId: p.user_id
        });
    });

    liste.sort(function (a, b) { return b.points - a.points; });
    return liste;
}

// classementGlobal + le flag estMoi calcule du point de vue de l'appelant (mise en
// surbrillance de sa propre ligne) - c'est cette version qui alimente les onglets
// ATP/WTA Live/Race de classements.html.
function classementPartage(circuit, semaineMin, semaineActuelle, monUserId) {
    return calculerClassementGlobal(circuit, semaineMin, semaineActuelle).map(function (c) {
        return Object.assign({}, c, { estMoi: c.userId !== null && Number(c.userId) === Number(monUserId) });
    });
}

// Rang Live (fenetre glissante de 52 semaines) de chaque participant d'un circuit,
// sous forme de Map cle -> rang (1-based), pour afficher le classement dans le
// tableau d'un tournoi sans recalculer une requete par participant. Aussi utilise
// pour afficher le "Classement" actuel sur une fiche adversaire (reel ou rival).
function calculerRangsLiveGlobal(circuit) {
    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const liste = calculerClassementGlobal(circuit, etat.semaine_actuelle - FENETRE_LIVE, etat.semaine_actuelle);
    const rangs = new Map();
    liste.forEach(function (j, i) { rangs.set(j.cle, i + 1); });
    return rangs;
}

// Meme principe que calculerRangsLiveGlobal, fenetre Race (depuis le debut de la
// saison en cours) au lieu de la fenetre Live glissante - reutilise la meme
// formule de debut de saison que /api/classement/:userId.
function calculerRangsRaceGlobal(circuit) {
    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const semaineActuelle = etat.semaine_actuelle;
    const positionSaisonBrute = ((semaineActuelle - 1) % LONGUEUR_SAISON) + 1;
    const debutSaison = semaineActuelle - positionSaisonBrute + 2;
    const liste = calculerClassementGlobal(circuit, debutSaison, semaineActuelle);
    const rangs = new Map();
    liste.forEach(function (j, i) { rangs.set(j.cle, i + 1); });
    return rangs;
}

// Meilleur classement Live jamais atteint par un participant (rival ou joueur reel)
// + le nombre de semaines passees a ce rang exact, d'apres classement_historique
// (alimente semaine par semaine dans executerAvancementSemaine, pas d'historique
// retroactif). Retourne null si ce cle n'a encore aucune semaine enregistree.
function meilleurClassement(circuit, cle) {
    const meilleur = db.prepare('SELECT MIN(rang) AS rang FROM classement_historique WHERE cle = ? AND circuit = ?').get(cle, circuit);
    if (!meilleur.rang) return null;
    const nb = db.prepare('SELECT COUNT(*) AS n FROM classement_historique WHERE cle = ? AND circuit = ? AND rang = ?').get(cle, circuit, meilleur.rang);
    return { rang: meilleur.rang, semaines: nb.n };
}

// Classement Live d'un participant (rival ou joueur reel) A UNE SEMAINE PRECISE
// (contrairement a meilleurClassement, qui cherche le meilleur de toute la
// carriere) - utilise pour afficher "le classement de l'adversaire au moment du
// match". Retourne null si `cle` est absent (adversaire lambda, jamais classe) ou
// si cette semaine precise n'a pas encore ete photographiee dans classement_historique.
function classementALaSemaine(circuit, cle, semaine) {
    if (!cle) return null;
    const row = db.prepare('SELECT rang FROM classement_historique WHERE cle = ? AND circuit = ? AND semaine = ?').get(cle, circuit, semaine);
    return row ? row.rang : null;
}

// Un tournoi nouvellement cree est toujours un pool 100% lambda/rivaux (plus jamais
// seede avec un joueur reel a la creation) : dans le modele global, TOUTE inscription
// reelle passe uniformement par le mecanisme "voler un slot lambda" de
// inscrireJoueurAuTournoi, qu'il s'agisse du 1er coach a s'inscrire ou du 50e.
// SEULE EXCEPTION : les Masters de fin de saison (categorie 'finals'), qui court-
// circuitent cette fonction au profit de genererEntrantsFinals (qualification
// automatique, pas d'inscription volontaire) - voir creerTournoi.
// Plus aucun bot dans un tableau (demande explicite de l'utilisateur, 2026-08-19) :
// le roster de rivaux persistants (200 par circuit) suffit largement a remplir
// n'importe quel tableau. Les rivaux retenus sont les mieux classes au Live (pas
// juste le meilleur niveau brut) - coherent avec le tri des tetes de serie dans
// tirerAuSort, qui utilise le meme classement.
function genererEntrants(entreeCalendrier, semaine, rivauxUtilises) {
    const tailleReelle = entreeCalendrier.taille_tableau;
    const utilises = rivauxUtilises || new Set();

    // Filet de securite contre un rival deja engage cette semaine-la dans un AUTRE
    // tournoi du meme circuit : rivauxUtilises ne survit jamais au-dela d'un seul
    // appel de executerAvancementSemaine, donc si 2 tournois de la meme semaine
    // sont crees lors d'appels separes (ex. l'un via l'ouverture S-5, l'autre via
    // le filet de securite d'un appel ulterieur), rien ne les empechait de piocher
    // le meme rival - source de verite = la base plutot que ce Set en memoire (bug
    // trouve en prod : meme rival a la fois a Brisbane et Hong Kong Open, tous
    // deux ATP S1).
    db.prepare(`
        SELECT DISTINCT tj.rival_id
        FROM tournoi_joueurs tj
        JOIN tournois t ON t.id = tj.tournoi_id
        WHERE t.semaine = ? AND t.circuit = ? AND tj.rival_id IS NOT NULL
    `).all(semaine, entreeCalendrier.circuit).forEach(function (r) { utilises.add(r.rival_id); });

    const entrants = [];

    assurerRoster(entreeCalendrier.circuit);
    const rangs = calculerRangsLiveGlobal(entreeCalendrier.circuit);
    const roster = db.prepare('SELECT * FROM classement_joueurs WHERE circuit = ?').all(entreeCalendrier.circuit);
    const disponibles = roster
        .filter(function (r) { return !utilises.has(r.id); })
        .sort(function (a, b) { return (rangs.get('rival:' + a.id) || Infinity) - (rangs.get('rival:' + b.id) || Infinity); })
        .slice(0, tailleReelle);

    disponibles.forEach(function (r) {
        utilises.add(r.id);
        entrants.push({ nom: r.nom, nationalite: r.nationalite, niveau: r.niveau, est_reel: 0, player_id: null, rival_id: r.id });
    });

    // Filet de securite si le roster deduplique (tournois paralleles de la meme
    // semaine) venait vraiment a manquer - ne devrait jamais arriver avec 200
    // rivaux par circuit, mais un lambda exceptionnel vaut mieux qu'un tableau
    // incomplet qui plante.
    const estFeminin = entreeCalendrier.circuit === 'WTA';
    while (entrants.length < tailleReelle) {
        const lambda = genererJoueurLambda(entreeCalendrier.categorie, estFeminin);
        entrants.push({ nom: lambda.nom, nationalite: lambda.nationalite, niveau: lambda.niveau, est_reel: 0, player_id: null, rival_id: null });
    }

    return entrants;
}

// Entrants des Masters de fin de saison : les 8 (taille_tableau) premiers du
// classement Race du circuit, tous coachs confondus, calcules au moment du tirage
// (S-1, cf. l'exception 'finals' dans l'ouverture des inscriptions ci-dessus) - donc
// juste apres le dernier tournoi de la saison reguliere du circuit (Stockholm cote
// ATP, Hong Kong cote WTA), avec une semaine de battement avant le debut des Finals
// pour choisir les styles. Melange naturellement rivaux persistants et joueurs reels
// selon leurs points.
function genererEntrantsFinals(entreeCalendrier, semaine) {
    assurerRoster(entreeCalendrier.circuit);

    const positionSaisonBrute = ((semaine - 1) % LONGUEUR_SAISON) + 1;
    const debutSaison = semaine - positionSaisonBrute + 2;

    const classement = calculerClassementGlobal(entreeCalendrier.circuit, debutSaison, semaine);
    return classement.slice(0, entreeCalendrier.taille_tableau).map(function (c) {
        return {
            nom: c.nom, nationalite: c.nationalite, niveau: c.niveau,
            est_reel: !!c.playerId, player_id: c.playerId || null, rival_id: c.rivalId || null
        };
    });
}

// Ordre canonique de tetes de serie pour un tableau de n places (n = puissance de
// 2) : position -> numero de tete de serie, construit recursivement pour que le
// seed 1 et le seed 2 soient toujours sur des moities opposees, 3-4 dans les deux
// quarts restants, etc. (convention standard des tableaux de tennis).
function ordreSeeds(n) {
    if (n === 1) return [1];
    const precedent = ordreSeeds(n / 2);
    const resultat = [];
    precedent.forEach(function (s) {
        resultat.push(s);
        resultat.push(n + 1 - s);
    });
    return resultat;
}

// ordreSeeds() brut place le seed 2 en tete de la seconde moitie (position n/2),
// pas a la toute derniere position (n-1) comme l'exige la convention reelle du
// tennis - un simple deplacement ponctuel de la seule TDS 2 (essaye avant,
// corrige ici) cassait le rangement des autres etages en la faisant atterrir
// dans la zone d'un autre seed (bug signale par l'utilisateur, 2026-08-20 : TDS
// 2 et 4 pouvaient se rencontrer des les 1/4). La bonne correction est
// d'inverser l'ORDRE COMPLET de la seconde moitie (pas juste un seed) : ca
// deplace bien le seed 2 en derniere position tout en preservant la separation
// en quarts/huitiemes/etc. de tous les autres etages a l'interieur de cette
// moitie, puisque l'inversion est un simple miroir qui ne fait jamais
// chevaucher deux zones.
function ordreSeedsReel(n) {
    if (n === 1) return [1];
    const brut = ordreSeeds(n);
    const milieu = n / 2;
    return brut.slice(0, milieu).concat(brut.slice(milieu).reverse());
}

// Etages de tirage au sort des tetes de serie, convention reelle du tennis :
// TDS 1 seule, TDS 2 seule, 3-4 ensemble, 5-8 ensemble, 9-16, 17-32, 33-64...
// A l'interieur d'un etage, le tirage decide QUELLE tete de serie va dans QUELLE
// zone du tableau parmi celles reservees a cet etage (ex : la TDS 3 a autant de
// chances de tomber dans la moitie de la TDS 1 que dans celle de la TDS 2 - ce
// n'est jamais automatiquement l'une ou l'autre).
function etagesSeeds(nbTetes) {
    const bornes = [1, 2, 4, 8, 16, 32, 64, 128];
    const etages = [];
    for (let i = 0; i < bornes.length; i++) {
        const debut = i === 0 ? 1 : bornes[i - 1] + 1;
        if (debut > nbTetes) break;
        etages.push([debut, Math.min(bornes[i], nbTetes)]);
    }
    return etages;
}

// Tirage au sort : fige les tetes de serie et les positions dans le tableau (avec
// exemptions/byes pour les tailles non-puissance-de-2) a partir des entrants deja
// connus (crees a l'ouverture des inscriptions, S-5). Appele a S-1.
function tirerAuSort(tournoiId, entreeCalendrier) {
    const tailleReelle = entreeCalendrier.taille_tableau;
    let taillePuissance2 = 1;
    while (taillePuissance2 < tailleReelle) taillePuissance2 *= 2;
    const nbByes = taillePuissance2 - tailleReelle;

    // Tetes de serie basees sur le classement Live (pas le "niveau" brut, qui reste
    // la force de jeu utilisee pour la simulation des matchs mais dont l'echelle
    // differe entre rivaux et vrais joueurs) : le mieux classe herite de la tete de
    // serie la plus favorable, rival ou vrai joueur, sans distinction (demande
    // explicite de l'utilisateur, 2026-08-19).
    const rangsSeed = calculerRangsLiveGlobal(entreeCalendrier.circuit);
    function rangDeEntrant(e) {
        if (e.rival_id) return rangsSeed.get('rival:' + e.rival_id) || Infinity;
        if (e.est_reel) return rangsSeed.get('joueur:' + e.player_id) || Infinity;
        return Infinity;
    }
    const entrants = db.prepare('SELECT * FROM tournoi_joueurs WHERE tournoi_id = ?').all(tournoiId);
    const parRangAsc = entrants.slice().sort(function (a, b) { return rangDeEntrant(a) - rangDeEntrant(b); });
    const nbTetes = Math.min(entrants.length, Math.max(1, Math.floor(taillePuissance2 / 4)));

    const majTeteDeSerie = db.prepare('UPDATE tournoi_joueurs SET tete_de_serie = ? WHERE id = ?');
    parRangAsc.forEach(function (e, i) {
        e.tete_de_serie = i < nbTetes ? i + 1 : null;
        majTeteDeSerie.run(e.tete_de_serie, e.id);
    });

    // Zones canoniques reservees a chaque numero de tete de serie (garantit que le
    // seed 1 et le seed 2 restent sur des moities opposees, 3-4 dans les deux
    // quarts restants, etc. - la convention standard des tableaux de tennis).
    const positionDeSeed = {};
    ordreSeedsReel(taillePuissance2).forEach(function (seed, position) { positionDeSeed[seed] = position; });

    // Tirage au sort proprement dit : a l'interieur d'un etage (3-4, 5-8, 9-16...),
    // les zones canoniques de l'etage sont melangees avant d'y affecter les tetes
    // de serie dans l'ordre du classement - la TDS 3 peut donc atterrir dans la
    // zone canonique du 3 ou celle du 4, au hasard, jamais toujours la meme.
    const slots = new Array(taillePuissance2).fill(undefined);
    const positionParIndexSeed = {};
    etagesSeeds(nbTetes).forEach(function (etage) {
        const indices = [];
        for (let i = etage[0] - 1; i <= etage[1] - 1; i++) indices.push(i);
        const positionsMelangees = melanger(indices.map(function (i) { return positionDeSeed[i + 1]; }));
        indices.forEach(function (i, k) {
            slots[positionsMelangees[k]] = parRangAsc[i];
            positionParIndexSeed[i] = positionsMelangees[k];
        });
    });

    // Exemptions (byes) donnees en priorite aux meilleures tetes de serie, placees
    // dans la case adverse du round 1 de leur beneficiaire (comme en vrai : un
    // joueur exempte n'a simplement personne en face au 1er tour).
    for (let i = 0; i < nbByes; i++) {
        const positionSeed = positionParIndexSeed[i];
        const positionAdverse = positionSeed % 2 === 0 ? positionSeed + 1 : positionSeed - 1;
        slots[positionAdverse] = 'BYE';
    }

    const nonSeedes = melanger(parRangAsc.slice(nbTetes));
    let curseur = 0;
    for (let i = 0; i < slots.length; i++) {
        if (slots[i] === undefined) {
            slots[i] = nonSeedes[curseur];
            curseur++;
        }
    }

    const majPosition = db.prepare('UPDATE tournoi_joueurs SET position_tableau = ? WHERE id = ?');
    const insertBye = db.prepare(`
        INSERT INTO tournoi_joueurs (tournoi_id, nom, nationalite, niveau, est_reel, player_id, position_tableau, tete_de_serie)
        VALUES (?, 'BYE', NULL, -1, 0, NULL, ?, NULL)
    `);

    slots.forEach(function (e, index) {
        if (e === 'BYE') {
            insertBye.run(tournoiId, index);
        } else {
            majPosition.run(index, e.id);
        }
    });

    db.prepare("UPDATE tournois SET statut = 'a_venir' WHERE id = ?").run(tournoiId);

    // Le tableau est fige : la liste d'attente n'a plus lieu d'etre (les confirmes
    // sont deja des lignes tournoi_joueurs permanentes, les non-retenus n'auront
    // jamais de slot pour cette edition precise).
    const semaineDuTournoi = db.prepare('SELECT semaine FROM tournois WHERE id = ?').get(tournoiId).semaine;
    db.prepare('DELETE FROM tournoi_liste_attente WHERE calendrier_id = ? AND semaine = ?').run(entreeCalendrier.id, semaineDuTournoi);
}

// Style de jeu en cours pour un joueur reel a l'interieur d'un tournoi : deduit du
// nombre de matchs deja enregistres pour lui dans ce tournoi (jamais incremente par
// un bye ou un adversaire lambda, donc fiable en elimination comme en poules sans
// faire remonter d'index explicite depuis simulerTournoi).
function styleDuTourCourant(tournoiId, player, entrant) {
    const dejaJoues = db.prepare('SELECT COUNT(*) AS n FROM matchs WHERE tournoi_id = ? AND player_id = ?').get(tournoiId, player.id).n;
    let stylesChoisis = [];
    try { stylesChoisis = JSON.parse(entrant.style_choisi || '[]'); } catch (e) { stylesChoisis = []; }
    return stylesChoisis[dejaJoues] || 'aucun';
}

// Perte du mental courant a l'issue d'un match, selon la categorie du tournoi et le
// tour atteint (bareme exact du PDF - 1000 et finals partagent le meme bareme).
const PERTE_MENTAL_COURANT = {
    slam: { premiers: 1.5, quarts: 2.5, demies: 4, finale: 6 },
    1000: { premiers: 1, quarts: 1.5, demies: 2, finale: 3 },
    finals: { premiers: 1, quarts: 1.5, demies: 2, finale: 3 },
    500: { premiers: 0.5, quarts: 1, demies: 1.5, finale: 2 },
    250: { premiers: 0.5, quarts: 1, demies: 1, finale: 1.5 }
};

function perteMentalCourant(categorie, label) {
    const bareme = PERTE_MENTAL_COURANT[categorie] || PERTE_MENTAL_COURANT[250];
    if (label === 'Finale') return bareme.finale;
    if (label === '1/2 finale' || label === 'Demi-finale') return bareme.demies;
    if (label === '1/4 finale') return bareme.quarts;
    return bareme.premiers;
}

// Consequences post-match sur un joueur reel (forme/usure/mental/automatisme/
// condition) selon SON PROPRE style. Taux de perte de forme (Prudence 0.08 / En
// Avant 0.12 / defaut 0.10), de gain de mental max (Mental d'acier 0.15 / defaut
// 0.1) et de gain d'automatisme (Reperage 6 / defaut 3) cf. tournoi_joueurs.style_choisi.
// moitie (optionnel, utilise par simulerRubberDouble en Coupe Davis/Fed Cup,
// demande explicite de l'utilisateur, 2026-08-26) : divise par 2 la perte de
// forme, la perte de mental courant et le gain de mental max - PAS l'usure, qui
// reste +1 dans tous les cas. Arrondi a 2 decimales au lieu d'1 dans ce cas (une
// valeur normalement a 1 decimale, une fois divisee par 2, peut tomber sur 2 -
// ex. 12,094 -> 12,10 plutot que 12,1 ou 12,0).
function appliquerEtatPostMatch(player, surface, style, totalJeux, pointsImportants, categorie, label, conditionFinale, moitie) {
    const facteur = moitie ? 0.5 : 1;
    const decimales = moitie ? 100 : 10;
    const tauxPerteForme = (style === 'prudence' ? 0.08 : (style === 'en_avant' ? 0.12 : 0.10)) * facteur;
    const tauxGainMentalMax = (style === 'mental_acier' ? 0.15 : 0.1) * facteur;
    const gainAutomatisme = style === 'reperage' ? 6 : 3;
    const nouvelleForme = Math.max(0, player.forme - totalJeux * tauxPerteForme);
    const nouvelleUsure = player.usure + 1;
    const nouveauMentalMax = Math.round((player.mental_max + pointsImportants * tauxGainMentalMax) * decimales) / decimales;
    const nouveauMentalCourant = Math.max(0, Math.round((player.mental_courant - perteMentalCourant(categorie, label) * facteur) * decimales) / decimales);
    const cleAutomatisme = 'surface_' + surface + '_automatismes';
    const nouvelAutomatisme = Math.min(30, player[cleAutomatisme] + gainAutomatisme);
    // La condition finale est desormais determinee PENDANT le match (simulerMatch,
    // jeu par jeu, cf. tenterAlerteKine) et simplement appliquee ici - plus de
    // second tirage independant apres coup, qui pouvait diverger de ce qui avait
    // reellement ete raconte dans le teletexte.
    const nouvelleCondition = conditionFinale || player.condition || 'en_forme';
    db.prepare(`UPDATE players SET forme = ?, usure = ?, mental_max = ?, mental_courant = ?, ${cleAutomatisme} = ?, condition = ? WHERE id = ?`).run(
        Math.round(nouvelleForme * decimales) / decimales, nouvelleUsure, nouveauMentalMax, nouveauMentalCourant, nouvelAutomatisme, nouvelleCondition, player.id
    );
    const kineIntervenu = conditionSestDegradee(player.condition, nouvelleCondition);
    // PDF : une degradation reelle de condition (pas juste "deja diminue en arrivant")
    // coute aussi 1 point tire au sort parmi les competences techniques deja non-nulles.
    if (kineIntervenu) appliquerPerteCaracteristique(player.id);
    return { kineIntervenu };
}

// Le moteur (simulerMatch/resoudreJeu) etiquette toujours son cote gagnant potentiel
// "A" comme "Toi" dans les textes d'evenements bruts. Pour la 2e ligne matchs d'un
// match reel-contre-reel (le journal du coach du cote B), il faut un miroir exact du
// meme deroule (pas une resimulation, qui tirerait un resultat different) : on
// inverse le texte Toi/Adversaire et les champs positionnels A/B.
function miroirEvenements(evenements) {
    return evenements.map(function (evt) {
        const copie = Object.assign({}, evt);
        if (typeof copie.texte === 'string') {
            copie.texte = copie.texte
                .replace(/\bToi\b/g, '@@MIROIR@@')
                .replace(/\bAdversaire\b/g, 'Toi')
                .replace(/@@MIROIR@@/g, 'Adversaire');
        }
        if (copie.setsA !== undefined && copie.setsB !== undefined) { const t = copie.setsA; copie.setsA = copie.setsB; copie.setsB = t; }
        if (copie.jeuxA !== undefined && copie.jeuxB !== undefined) { const t = copie.jeuxA; copie.jeuxA = copie.jeuxB; copie.jeuxB = t; }
        if (copie.ptsA !== undefined && copie.ptsB !== undefined) { const t = copie.ptsA; copie.ptsA = copie.ptsB; copie.ptsB = t; }
        if (copie.serveur === 'A') copie.serveur = 'B'; else if (copie.serveur === 'B') copie.serveur = 'A';
        return copie;
    });
}

// Un score peut porter un suffixe non-numerique en fin de chaine (ex. "6-4, 3-2
// (Abandon)") depuis l'ajout de l'abandon force par blessure mi-match - on le met
// de cote avant de miroiter les sets (sinon le "2" final se retrouverait fusionne
// avec le texte du suffixe) et on le rattache tel quel a la fin.
function miroirScore(score) {
    const correspondance = score.match(/^(.*?)( \([^)]*\))?$/);
    const setsBruts = correspondance[1];
    const suffixe = correspondance[2] || '';
    const setsMiroir = setsBruts.split(', ').map(function (set) {
        const parts = set.split('-');
        return parts[1] + '-' + parts[0];
    }).join(', ');
    return setsMiroir + suffixe;
}

function jouerMatchTournoi(tournoi, label, j1, j2, tourIndex) {
    if (j1.est_reel && j2.est_reel) {
        return jouerMatchReelVsReel(tournoi, label, j1, j2, tourIndex);
    }

    const reel = j1.est_reel ? j1 : j2;
    const lambda = j1.est_reel ? j2 : j1;

    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(reel.player_id);
    const niveauReel_normal = niveauNormal(player, tournoi.surface, (reel.energie_misee || 0) * 5);

    if (player.condition === 'blesse') {
        // Regle du PDF : un joueur blesse est contraint a l'abandon et declare forfait
        // pour ses eventuels autres matchs de la semaine (donc tous les tours restants
        // de ce tournoi, joues au fil des echeances de simulerUnTour). Aucune
        // simulation, aucun impact sur
        // forme/usure/mental/automatismes/condition puisqu'aucun match n'est reellement joue.
        const evenementForfait = [{ type: 'match_fin', texte: player.prenom + ' ' + player.nom.toUpperCase() + ' declare forfait (blesse) et perd le match.' }];
        const insertionForfait = db.prepare(`
            INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, tournoi_id, numero_tour)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            player.user_id, player.id, tournoi.surface, 'tournoi', tournoi.semaine,
            'adversaire', 'Forfait (blessure)', Math.round(niveauReel_normal), Math.round(lambda.niveau),
            JSON.stringify(evenementForfait), tournoi.id, label
        );
        // Score cote tournoi_matchs (bracket) nomme la personne qui forfait, meme regle
        // que jouerMatchReelVsReel - la ligne matchs ci-dessus (perspective du coach
        // concerne) reste inchangee, deja sans ambiguite pour lui.
        return { vainqueur: lambda, score: 'Forfait de ' + player.prenom + ' ' + player.nom + ' (blessure)', matchId: insertionForfait.lastInsertRowid, matchIdJ2: null };
    }

    const entreeCalendrier = CALENDRIER_TOURNOIS.find(function (t) { return t.id === tournoi.calendrier_id; });
    const nbTours = calculerLabelsTours(entreeCalendrier.taille_tableau, tournoi.format).length;
    const bonus = calculerBonusDispositions(player, lambda, {
        esTeteDeSerie: !!reel.tete_de_serie,
        adversaireEsTeteDeSerie: !!lambda.tete_de_serie,
        estDemiOuFinale: label === '1/2 finale' || label === 'Finale',
        tourIndex: tourIndex,
        premiersToursMax: nbTours === 7 ? 2 : 1,
        estIndoor: !!(entreeCalendrier && entreeCalendrier.indoor)
    });
    // Malus de condition physique (PDF) : -50 fatigue, -100 diminue, 0 en pleine
    // forme - applique desormais DYNAMIQUEMENT jeu par jeu a l'interieur de
    // simulerMatch (via etatPhysiqueA), pas fige avant le match : niveauReel_normal
    // reste donc "brut" ici (sans malus, juste les dispositions).
    const niveauReel_normal_avecDispositions = niveauReel_normal + bonus.fixe;

    const niveauReel_mental = niveauReel_normal_avecDispositions + player.mental_courant;
    const niveauLambda_normal = lambda.niveau;
    const niveauLambda_mental = niveauLambda_normal + 100;

    const styleA = styleDuTourCourant(tournoi.id, player, reel);

    // GC Hommes : 3 sets gagnants (5 max) au lieu de 2 (regle PDF), partout ailleurs
    // inchange.
    const meilleurDe5 = tournoi.circuit === 'ATP' && tournoi.categorie === 'slam';

    // Le joueur reel est toujours simule cote "A" : les evenements du moteur
    // (simulerMatch/resoudreJeu) etiquettent toujours 'A' comme "Toi", quelle que
    // soit sa position dans le tableau du tournoi.
    const resultat = simulerMatch(
        niveauReel_normal_avecDispositions, niveauReel_mental, niveauLambda_normal, niveauLambda_mental,
        styleA, player.mental_courant, null, undefined, bonus.sangFroid, 0, meilleurDe5,
        { forme: player.forme, pointsEnergie: player.points_energie, condition: player.condition, type: player.type }
    );

    const { kineIntervenu } = appliquerEtatPostMatch(player, tournoi.surface, styleA, resultat.totalJeux, resultat.pointsImportants, tournoi.categorie, label, resultat.conditionFinaleA);

    const vainqueurEstReel = resultat.vainqueur === 'A';

    const insertion = db.prepare(`
        INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, tournoi_id, numero_tour, kine_intervenu, balles_break_sauvees)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        player.user_id, player.id, tournoi.surface, 'tournoi', tournoi.semaine,
        vainqueurEstReel ? 'joueur' : 'adversaire',
        resultat.score,
        Math.round(niveauReel_normal_avecDispositions), Math.round(niveauLambda_normal),
        JSON.stringify(resultat.evenements),
        tournoi.id, label, kineIntervenu ? 1 : 0, resultat.ballesBreakSauveesA
    );

    return { vainqueur: vainqueurEstReel ? reel : lambda, score: resultat.score, matchId: insertion.lastInsertRowid, matchIdJ2: null };
}

// Reel-contre-reel : deux coachs differents se retrouvent dans le meme tableau.
// Chaque cote garde ses propres stats/mental/style/forfait (pas de cote "lambda"
// simplifie) ; DEUX lignes matchs sont ecrites (une par coach, chacune de son propre
// point de vue), et tournoi_matchs.match_id/match_id_j2 les relient toutes les deux.
function jouerMatchReelVsReel(tournoi, label, j1, j2, tourIndex) {
    const player1 = db.prepare('SELECT * FROM players WHERE id = ?').get(j1.player_id);
    const player2 = db.prepare('SELECT * FROM players WHERE id = ?').get(j2.player_id);

    const blesse1 = player1.condition === 'blesse';
    const blesse2 = player2.condition === 'blesse';

    if (blesse1 || blesse2) {
        // Si les deux sont blesses en meme temps (rarissime), le cote 1 est
        // arbitrairement celui qui declare forfait - deterministe, aucune simulation
        // dans tous les cas des qu'un seul cote est blesse.
        const perdant = blesse1 ? player1 : player2;
        const gagnant = blesse1 ? player2 : player1;
        const perdantEntrant = blesse1 ? j1 : j2;
        const gagnantEntrant = blesse1 ? j2 : j1;
        const gagnantEstJ1 = !blesse1;
        const evenementForfait = [{ type: 'match_fin', texte: perdant.prenom + ' ' + perdant.nom.toUpperCase() + ' declare forfait (blesse) et perd le match.' }];

        const matchIdPerdant = db.prepare(`
            INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, tournoi_id, numero_tour)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            perdant.user_id, perdant.id, tournoi.surface, 'tournoi', tournoi.semaine,
            'adversaire', 'Forfait (blessure)',
            Math.round(niveauNormal(perdant, tournoi.surface, (perdantEntrant.energie_misee || 0) * 5)),
            Math.round(niveauNormal(gagnant, tournoi.surface, (gagnantEntrant.energie_misee || 0) * 5)),
            JSON.stringify(evenementForfait), tournoi.id, label
        ).lastInsertRowid;
        const matchIdGagnant = db.prepare(`
            INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, tournoi_id, numero_tour)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            gagnant.user_id, gagnant.id, tournoi.surface, 'tournoi', tournoi.semaine,
            'joueur', 'Forfait (blessure adverse)',
            Math.round(niveauNormal(gagnant, tournoi.surface, (gagnantEntrant.energie_misee || 0) * 5)),
            Math.round(niveauNormal(perdant, tournoi.surface, (perdantEntrant.energie_misee || 0) * 5)),
            JSON.stringify(evenementForfait), tournoi.id, label
        ).lastInsertRowid;

        return {
            // Score cote tournoi_matchs (bracket, visible de TOUS les coachs) : nomme la
            // personne qui forfait, contrairement aux 2 lignes matchs ci-dessus (perspective
            // propre a chaque coach, deja sans ambiguite pour eux) - sinon impossible de
            // savoir qui des deux a declare forfait en consultant juste le tableau (bug
            // signale par l'utilisateur, 2026-08-24).
            vainqueur: gagnantEstJ1 ? j1 : j2, score: 'Forfait de ' + perdant.prenom + ' ' + perdant.nom + ' (blessure)',
            matchId: gagnantEstJ1 ? matchIdGagnant : matchIdPerdant,
            matchIdJ2: gagnantEstJ1 ? matchIdPerdant : matchIdGagnant
        };
    }

    const entreeCalendrier = CALENDRIER_TOURNOIS.find(function (t) { return t.id === tournoi.calendrier_id; });
    const nbTours = calculerLabelsTours(entreeCalendrier.taille_tableau, tournoi.format).length;
    const contexteCommun = {
        estDemiOuFinale: label === '1/2 finale' || label === 'Finale',
        tourIndex: tourIndex,
        premiersToursMax: nbTours === 7 ? 2 : 1,
        estIndoor: !!(entreeCalendrier && entreeCalendrier.indoor)
    };
    const bonus1 = calculerBonusDispositions(player1, j2, Object.assign({ esTeteDeSerie: !!j1.tete_de_serie, adversaireEsTeteDeSerie: !!j2.tete_de_serie }, contexteCommun));
    const bonus2 = calculerBonusDispositions(player2, j1, Object.assign({ esTeteDeSerie: !!j2.tete_de_serie, adversaireEsTeteDeSerie: !!j1.tete_de_serie }, contexteCommun));

    // Malus de condition physique (PDF) : -50 fatigue, -100 diminue, 0 en pleine
    // forme - applique desormais DYNAMIQUEMENT jeu par jeu a l'interieur de
    // simulerMatch (via etatPhysiqueA/B), pas fige avant le match.
    const niveau1_normal = niveauNormal(player1, tournoi.surface, (j1.energie_misee || 0) * 5) + bonus1.fixe;
    const niveau1_mental = niveau1_normal + player1.mental_courant;
    const niveau2_normal = niveauNormal(player2, tournoi.surface, (j2.energie_misee || 0) * 5) + bonus2.fixe;
    const niveau2_mental = niveau2_normal + player2.mental_courant;

    const style1 = styleDuTourCourant(tournoi.id, player1, j1);
    const style2 = styleDuTourCourant(tournoi.id, player2, j2);

    // GC Hommes : 3 sets gagnants (5 max) au lieu de 2 (regle PDF), partout ailleurs
    // inchange.
    const meilleurDe5 = tournoi.circuit === 'ATP' && tournoi.categorie === 'slam';

    const resultat = simulerMatch(
        niveau1_normal, niveau1_mental, niveau2_normal, niveau2_mental,
        style1, player1.mental_courant, style2, player2.mental_courant, bonus1.sangFroid, bonus2.sangFroid, meilleurDe5,
        { forme: player1.forme, pointsEnergie: player1.points_energie, condition: player1.condition, type: player1.type },
        { forme: player2.forme, pointsEnergie: player2.points_energie, condition: player2.condition, type: player2.type }
    );

    const etat1 = appliquerEtatPostMatch(player1, tournoi.surface, style1, resultat.totalJeux, resultat.pointsImportants, tournoi.categorie, label, resultat.conditionFinaleA);
    const etat2 = appliquerEtatPostMatch(player2, tournoi.surface, style2, resultat.totalJeux, resultat.pointsImportants, tournoi.categorie, label, resultat.conditionFinaleB);

    const j1Gagne = resultat.vainqueur === 'A';

    const matchId1 = db.prepare(`
        INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, tournoi_id, numero_tour, kine_intervenu, balles_break_sauvees)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        player1.user_id, player1.id, tournoi.surface, 'tournoi', tournoi.semaine,
        j1Gagne ? 'joueur' : 'adversaire', resultat.score,
        Math.round(niveau1_normal), Math.round(niveau2_normal),
        JSON.stringify(resultat.evenements), tournoi.id, label, etat1.kineIntervenu ? 1 : 0, resultat.ballesBreakSauveesA
    ).lastInsertRowid;

    const matchId2 = db.prepare(`
        INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, tournoi_id, numero_tour, kine_intervenu, balles_break_sauvees)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        player2.user_id, player2.id, tournoi.surface, 'tournoi', tournoi.semaine,
        j1Gagne ? 'adversaire' : 'joueur', miroirScore(resultat.score),
        Math.round(niveau2_normal), Math.round(niveau1_normal),
        JSON.stringify(miroirEvenements(resultat.evenements)), tournoi.id, label, etat2.kineIntervenu ? 1 : 0, resultat.ballesBreakSauveesB
    ).lastInsertRowid;

    return { vainqueur: j1Gagne ? j1 : j2, score: resultat.score, matchId: matchId1, matchIdJ2: matchId2 };
}

function resoudreMatchAdversaire(tournoi, label, j1, j2, tourIndex) {
    if (j1.est_reel || j2.est_reel) {
        return jouerMatchTournoi(tournoi, label, j1, j2, tourIndex);
    }
    // Meme les matchs 100% lambda jouent un vrai match (score plausible) plutot qu'un
    // simple tirage, pour que le tableau et les resultats du tournoi restent lisibles
    // et consultables meme quand le joueur du coach n'est pas implique. Le deroule
    // complet (evenements) est conserve directement sur tournoi_matchs (pas de ligne
    // matchs, qui exige un user_id/player_id reel) pour offrir Live/Resultat/Teletexte
    // meme sur ces matchs-la (demande explicite de l'utilisateur, 2026-08-20).
    // Meme regle que jouerMatchTournoi/jouerMatchReelVsReel (Grand Chelem ATP =
    // meilleur des 5 sets) - jamais transmise ici avant ce correctif, donc TOUS les
    // matchs 100% bots (y compris en Grand Chelem hommes) se jouaient a tort en 2
    // sets gagnants, produisant des scores en 2 manches impossibles pour un GC
    // (bug signale par l'utilisateur, 2026-08-20).
    const meilleurDe5 = tournoi.circuit === 'ATP' && tournoi.categorie === 'slam';
    const resultat = simulerMatch(j1.niveau, j1.niveau + 100, j2.niveau, j2.niveau + 100, null, undefined, null, undefined, 0, 0, meilleurDe5);
    // Le moteur etiquette toujours les 2 cotes "Toi"/"Adversaire" (perspective d'un
    // coach) - sans le moindre sens pour un match 100% bots, remplace par les vrais
    // noms des deux entrants avant stockage.
    const evenementsNommes = resultat.evenements.map(function (evt) {
        return evt.texte ? Object.assign({}, evt, { texte: evt.texte.replace(/\bToi\b/g, j1.nom).replace(/\bAdversaire\b/g, j2.nom) }) : evt;
    });
    return {
        vainqueur: resultat.vainqueur === 'A' ? j1 : j2, score: resultat.score,
        matchId: null, matchIdJ2: null, evenements: JSON.stringify(evenementsNommes)
    };
}

// manchePoules (optionnel) : numero du round de poules (1/2/3, cf. SCHEDULE_POULE_4)
// pour un match "Phase de poules" - sans ca, les 3 rounds partagent le meme
// numero_tour et un `ordre` remis a 0 a chaque round, donc impossible de les
// distinguer une fois plusieurs rounds joues (bug signale par l'utilisateur,
// 2026-08-24 : impossible de voir l'ordre des matchs de poules dans l'onglet
// Tableau). Toujours null pour les demies/finale (un seul match chacune).
function enregistrerMatchTournoi(tournoiId, label, ordre, j1, j2, vainqueur, score, matchId, matchIdJ2, evenements, manchePoules) {
    db.prepare(`
        INSERT INTO tournoi_matchs (tournoi_id, numero_tour, ordre, joueur1_id, joueur2_id, vainqueur_id, score, match_id, match_id_j2, evenements, manche_poules)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tournoiId, label, ordre, j1.id, j2 ? j2.id : null, vainqueur ? vainqueur.id : null, score || null, matchId || null, matchIdJ2 || null, evenements || null, manchePoules || null);
}

// XP verse en une fois a l'elimination/victoire, selon le nombre total de tours du
// tournoi et l'index (0-based, dans l'ordre de calculerLabelsTours) du tour atteint.
// Tournois 7 tours (2 semaines) : les valeurs des index 3-6 sont le COMPLEMENT verse
// a l'elimination/victoire en semaine 2 - le bonus fixe de qualification (verse a
// part, des la survie du tour d'index 2) n'est pas inclus ici.
const XP_QUALIFICATION_SEMAINE2 = 7;
const XP_TOURNOI = {
    5: [10, 10, 10, 9, 9],
    6: [10, 10, 11, 10, 9, 9],
    7: [10, 10, 11, 10, 10, 9, 9]
};

// Plafond de mise d'energie sacrifiable a l'inscription, selon la categorie du
// tournoi (PDF, table "Miser des points d'energie").
const PLAFOND_MISE_ENERGIE = { slam: 10, finals: 10, '1000': 10, '500': 5, '250': 5 };

// Ajoute cette XP au journal hebdomadaire de la semaine EN COURS (celle ou le tour
// est reellement simule, pas celle du prevu/realise deja pose par la transition
// hebdomadaire) - le journal ne tracait jusqu'ici que l'XP d'entrainement, jamais
// celle de tournoi (versee ici, dans un tout autre code path que
// executerAvancementSemaine) : le total affiche au coach etait donc toujours
// incomplet des qu'un tournoi etait en jeu (demande utilisateur, 2026-08-21). La
// ligne existe deja (creee par la transition qui a fait entrer le joueur dans
// cette semaine, toujours avant qu'un tour ne s'y joue) - simple ajout, pas de
// creation.
function crediterXpJournal(playerId, xp) {
    const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;
    db.prepare('UPDATE journal_semaine_joueur SET xp_credite = xp_credite + ? WHERE player_id = ? AND semaine = ?').run(xp, playerId, semaineActuelle);
}

// Un match perdu sans avoir ete reellement joue jusqu'au bout (abandon en cours de
// match OU forfait pre-match, tous les deux dus a une blessure) n'ouvre jamais droit
// a l'XP de progression du tour concerne - meme regle pour les deux, demande
// explicite de l'utilisateur, 2026-08-21.
function matchSansXp(score) {
    return !!score && (score.indexOf('(Abandon)') !== -1 || score.indexOf('Forfait') !== -1);
}

// Contrairement a l'XP ci-dessus, les points de classement ATP/WTA ne doivent
// etre mis a zero que pour un vrai FORFAIT (blessure pre-match, le joueur ne s'est
// jamais presente) - un abandon EN COURS de match (il a reellement joue, mais a du
// se retirer) reste un tour effectivement dispute et garde donc les points du tour
// atteint, comme sur le vrai circuit (un retrait mi-match compte, un forfait pur
// non). Bug corrige le 2026-08-23 : la reutilisation de matchSansXp (qui couvre
// les deux cas) mettait par erreur aussi les points a zero pour un abandon.
function matchEstForfait(score) {
    return !!score && score.indexOf('Forfait') !== -1;
}

function verserXpTournoi(entrant, nbTours, tourIndex) {
    if (!entrant.est_reel || !entrant.player_id) return;
    const table = XP_TOURNOI[nbTours];
    const xp = table ? (table[tourIndex] || 0) : 0;
    if (xp > 0) {
        db.prepare('UPDATE players SET points_experience = points_experience + ? WHERE id = ?').run(xp, entrant.player_id);
        crediterXpJournal(entrant.player_id, xp);
    }
}

function verserXpQualificationSemaine2(entrant) {
    if (!entrant.est_reel || !entrant.player_id) return;
    db.prepare('UPDATE players SET points_experience = points_experience + ? WHERE id = ?').run(XP_QUALIFICATION_SEMAINE2, entrant.player_id);
    crediterXpJournal(entrant.player_id, XP_QUALIFICATION_SEMAINE2);
}

// Cout en fin de parcours (elimination ou victoire finale) pour un entrant reel :
// 1 PE fixe de participation + la mise eventuelle, definitivement perdue (PDF).
function deduireEnergieFinTournoi(entrant) {
    if (!entrant.est_reel || !entrant.player_id) return;
    const cout = 1 + (entrant.energie_misee || 0);
    db.prepare('UPDATE players SET points_energie = MAX(0, points_energie - ?) WHERE id = ?').run(cout, entrant.player_id);
}

// A l'issue de Miami, Wimbledon et l'US Open (ATP et WTA comptent comme le meme
// evenement), le mental max de TOUS les joueurs reels valides perd les 2/3 de ce
// qui depasse 100 (PDF, pour eviter une inflation indefinie). evenements_globaux
// dedoublonne : les deux tournois du meme evenement/de la meme semaine ne
// declenchent la reduction qu'une seule fois.
const EVENEMENTS_REDUCTION_MENTAL = {
    'atp-miami': 'miami', 'wta-miami': 'miami',
    'atp-wimbledon': 'wimbledon', 'wta-wimbledon': 'wimbledon',
    'atp-us-open': 'us_open', 'wta-us-open': 'us_open'
};

function appliquerReductionMentalSiEvenement(tournoiId) {
    const tournoi = db.prepare('SELECT calendrier_id, semaine FROM tournois WHERE id = ?').get(tournoiId);
    if (!tournoi) return;
    const evenement = EVENEMENTS_REDUCTION_MENTAL[tournoi.calendrier_id];
    if (!evenement) return;

    try {
        db.prepare('INSERT INTO evenements_globaux (evenement, semaine) VALUES (?, ?)').run(evenement, tournoi.semaine);
    } catch (e) {
        return; // deja applique pour cet evenement/cette semaine (contrainte PRIMARY KEY)
    }

    const joueurs = db.prepare("SELECT id, mental_max, mental_courant FROM players WHERE statut = 'valide'").all();
    const maj = db.prepare('UPDATE players SET mental_max = ?, mental_courant = ? WHERE id = ?');
    joueurs.forEach(function (j) {
        if (j.mental_max <= 100) return;
        const exces = j.mental_max - 100;
        const nouveauMax = Math.round((j.mental_max - exces * (2 / 3)) * 10) / 10;
        const nouveauCourant = Math.min(j.mental_courant, nouveauMax);
        maj.run(nouveauMax, nouveauCourant, j.id);
    });
}

// Simule UN SEUL tour d'un tournoi a elimination directe (le prochain non joue,
// deduit de tournois.tour_actuel), au lieu du tournoi entier d'un coup - appelee par
// executerAvancementTour au moment ou son creneau horaire est atteint (voir section
// creneaux). Idempotent : si le tournoi est deja termine, ne fait rien.
function simulerUnTour(tournoiId) {
    const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
    if (!tournoi || tournoi.statut !== 'a_venir') return;

    const bareme = BAREME_POINTS[tournoi.bareme] || [0];
    const labelsTours = calculerLabelsTours(tournoi.taille_tableau, tournoi.format);
    const nbTours = labelsTours.length;
    const tourIndex = tournoi.tour_actuel; // 0-based : prochain tour a jouer

    const vivants = db.prepare('SELECT * FROM tournoi_joueurs WHERE tournoi_id = ? AND tour_elimine IS NULL ORDER BY position_tableau').all(tournoiId);
    const joueursAvantTour = vivants.length;
    const label = ROUND_LABELS[joueursAvantTour] || (joueursAvantTour + 'e de finale');
    const estDernierTour = joueursAvantTour === 2;
    const qualifiesSemaine2 = [];

    for (let i = 0; i < vivants.length; i += 2) {
        const j1 = vivants[i];
        const j2 = vivants[i + 1];

        let vainqueur, score = null, matchId = null, matchIdJ2 = null, evenements = null;
        if (j1.nom === 'BYE') {
            vainqueur = j2;
        } else if (j2.nom === 'BYE') {
            vainqueur = j1;
        } else {
            const resultat = resoudreMatchAdversaire(tournoi, label, j1, j2, tourIndex);
            vainqueur = resultat.vainqueur;
            score = resultat.score;
            matchId = resultat.matchId;
            matchIdJ2 = resultat.matchIdJ2;
            evenements = resultat.evenements;
        }

        enregistrerMatchTournoi(tournoiId, label, i / 2, j1, j2, vainqueur, score, matchId, matchIdJ2, evenements);

        const perdant = vainqueur === j1 ? j2 : j1;
        if (perdant.nom !== 'BYE') {
            const profondeur = Math.round(Math.log2(joueursAvantTour));
            // XP : jamais versee pour un abandon en cours de match NI pour un forfait
            // pre-match (le joueur n'a pas reellement progresse ce tour dans les 2 cas).
            // Points de classement : mis a zero UNIQUEMENT pour un forfait (jamais
            // presente) - un abandon en cours de match a bel et bien ete dispute jusqu'a
            // l'arret, il garde donc les points du tour atteint, comme sur le vrai
            // circuit (bug corrige le 2026-08-23, matchSansXp couvrait les 2 a tort pour
            // les points).
            const estAbandon = matchSansXp(score);
            const estForfait = matchEstForfait(score);
            const points = estForfait ? 0 : bareme[Math.min(profondeur, bareme.length - 1)];
            db.prepare('UPDATE tournoi_joueurs SET tour_elimine = ?, points_gagnes = ? WHERE id = ?').run(label, points, perdant.id);
            if (!estAbandon) verserXpTournoi(perdant, nbTours, tourIndex);
            deduireEnergieFinTournoi(perdant);
        } else {
            // Le BYE lui-meme doit sortir de "vivants" (aucun point/XP/energie, ce
            // n'est pas un vrai competiteur) - sinon il reste tour_elimine IS NULL
            // indefiniment et fausse le compte des tours suivants des que le tableau
            // n'est pas une puissance de 2 exacte (28/48/56/96, tres frequent).
            db.prepare('UPDATE tournoi_joueurs SET tour_elimine = ? WHERE id = ?').run(label, perdant.id);
        }

        if (estDernierTour && vainqueur.nom !== 'BYE') {
            db.prepare('UPDATE tournoi_joueurs SET tour_elimine = ?, points_gagnes = ? WHERE id = ?').run('Vainqueur', bareme[0], vainqueur.id);
            verserXpTournoi(vainqueur, nbTours, tourIndex);
            deduireEnergieFinTournoi(vainqueur);
        } else if (nbTours === 7 && tourIndex === 2 && vainqueur.nom !== 'BYE') {
            qualifiesSemaine2.push(vainqueur);
        }
    }

    qualifiesSemaine2.forEach(function (v) { verserXpQualificationSemaine2(v); });

    const nouveauTourActuel = tourIndex + 1;
    db.prepare('UPDATE tournois SET tour_actuel = ? WHERE id = ?').run(nouveauTourActuel, tournoiId);
    if (estDernierTour) {
        db.prepare("UPDATE tournois SET statut = 'termine' WHERE id = ?").run(tournoiId);
        calculerPointsPronostics(tournoiId);
        appliquerReductionMentalSiEvenement(tournoiId);
    }
}

// Calendrier fixe (methode du cercle) pour un round-robin a 4 joueurs : 3 tours, 2 matchs par tour.
const SCHEDULE_POULE_4 = [
    [[0, 3], [1, 2]],
    [[0, 2], [3, 1]],
    [[0, 1], [2, 3]]
];

// Repartition en 2 groupes de 4 par "serpentin" (1er, 4e, 5e, 8e niveau contre 2e,
// 3e, 6e, 7e) pour eviter que les deux meilleurs niveaux se retrouvent dans le meme
// groupe. Purement deterministe a partir du niveau (fixe depuis le tirage), donc
// recalculable a l'identique a chaque appel sans rien avoir a stocker.
function groupesPoules(tournoiId) {
    const joueurs = db.prepare('SELECT * FROM tournoi_joueurs WHERE tournoi_id = ? ORDER BY niveau DESC').all(tournoiId);
    return {
        A: [joueurs[0], joueurs[3], joueurs[4], joueurs[7]],
        B: [joueurs[1], joueurs[2], joueurs[5], joueurs[6]]
    };
}

// Statistiques brutes d'un groupe de poules a partir des tournoi_matchs "Phase de
// poules" deja joues : victoires, matchs REELLEMENT disputes (un forfait n'en
// compte aucun), sets/jeux gagnes-perdus. Le score stocke est toujours "A-B" ou A
// est le joueur REEL si un seul des deux l'est (jouerMatchTournoi simule toujours
// le joueur reel cote A, meme positionne joueur2 du match), sinon A = joueur1
// (reel-vs-reel ou lambda-vs-lambda) - d'ou le drapeau `inverse` ci-dessous, sans
// quoi les jeux/sets de la moitie des matchs se retrouveraient attribues au
// mauvais joueur.
function statsGroupePoules(tournoiId, groupe) {
    const idsGroupe = new Set(groupe.map(function (j) { return j.id; }));
    const estReelParId = new Map(groupe.map(function (j) { return [j.id, !!j.est_reel]; }));
    const matchs = db.prepare("SELECT * FROM tournoi_matchs WHERE tournoi_id = ? AND numero_tour = 'Phase de poules'").all(tournoiId)
        .filter(function (m) { return idsGroupe.has(m.joueur1_id); });

    const stats = new Map();
    groupe.forEach(function (j) { stats.set(j.id, { victoires: 0, matchsJoues: 0, setsGagnes: 0, setsPerdus: 0, jeuxGagnes: 0, jeuxPerdus: 0 }); });
    const faceAFace = new Map();

    matchs.forEach(function (m) {
        if (m.vainqueur_id == null) return;
        stats.get(m.vainqueur_id).victoires++;
        faceAFace.set(m.joueur1_id + '-' + m.joueur2_id, m.vainqueur_id);
        faceAFace.set(m.joueur2_id + '-' + m.joueur1_id, m.vainqueur_id);

        if (matchEstForfait(m.score)) return; // aucun jeu/set reellement dispute

        stats.get(m.joueur1_id).matchsJoues++;
        stats.get(m.joueur2_id).matchsJoues++;

        const inverse = !estReelParId.get(m.joueur1_id) && estReelParId.get(m.joueur2_id);
        ((m.score || '').match(/(\d+)-(\d+)/g) || []).forEach(function (manche) {
            const parts = manche.split('-').map(Number);
            let a = parts[0], b = parts[1];
            if (inverse) { const t = a; a = b; b = t; }
            stats.get(m.joueur1_id).jeuxGagnes += a;
            stats.get(m.joueur1_id).jeuxPerdus += b;
            stats.get(m.joueur2_id).jeuxGagnes += b;
            stats.get(m.joueur2_id).jeuxPerdus += a;
            if (a > b) { stats.get(m.joueur1_id).setsGagnes++; stats.get(m.joueur2_id).setsPerdus++; }
            else if (b > a) { stats.get(m.joueur2_id).setsGagnes++; stats.get(m.joueur1_id).setsPerdus++; }
        });
    });

    return { stats, faceAFace };
}

// Classement d'un groupe de poules (Masters de fin de saison), selon l'ordre
// officiel ATP/WTA Finals 2026 fourni explicitement par l'utilisateur (2026-08-24) :
// 1) victoires, 2) matchs reellement disputes (utile en cas d'abandon/forfait en
// cours de poule), 3) si EXACTEMENT 2 sont encore a egalite : confrontation
// directe, 4) si 3 (ou plus) : % de sets gagnes, puis % de jeux gagnes, puis
// classement Live. Reconstruit a partir des tournoi_matchs "Phase de poules" deja
// joues - permet de rappeler cette fonction a n'importe quel moment (demi-finales,
// finale) sans avoir besoin de stocker le classement entre deux appels de
// simulerUnTourPoules.
function classementGroupe(tournoiId, groupe) {
    const tournoi = db.prepare('SELECT circuit FROM tournois WHERE id = ?').get(tournoiId);
    const { stats, faceAFace } = statsGroupePoules(tournoiId, groupe);
    const rangs = calculerRangsLiveGlobal(tournoi.circuit);
    function rangDe(j) {
        if (j.rival_id) return rangs.get('rival:' + j.rival_id) || Infinity;
        if (j.est_reel) return rangs.get('joueur:' + j.player_id) || Infinity;
        return Infinity;
    }

    const tries = groupe.slice().sort(function (a, b) {
        const sa = stats.get(a.id), sb = stats.get(b.id);
        if (sb.victoires !== sa.victoires) return sb.victoires - sa.victoires;
        return sb.matchsJoues - sa.matchsJoues;
    });

    const resultat = [];
    let i = 0;
    while (i < tries.length) {
        let j = i + 1;
        while (j < tries.length) {
            const sa = stats.get(tries[i].id), sb = stats.get(tries[j].id);
            if (sa.victoires !== sb.victoires || sa.matchsJoues !== sb.matchsJoues) break;
            j++;
        }
        const exAequo = tries.slice(i, j);
        if (exAequo.length === 2) {
            const gagnant = faceAFace.get(exAequo[0].id + '-' + exAequo[1].id);
            if (gagnant === exAequo[1].id) exAequo.reverse();
        } else if (exAequo.length > 2) {
            exAequo.sort(function (a, b) {
                const sa = stats.get(a.id), sb = stats.get(b.id);
                const totalSetsA = sa.setsGagnes + sa.setsPerdus, totalSetsB = sb.setsGagnes + sb.setsPerdus;
                const pctSetsA = totalSetsA > 0 ? sa.setsGagnes / totalSetsA : 0;
                const pctSetsB = totalSetsB > 0 ? sb.setsGagnes / totalSetsB : 0;
                if (pctSetsB !== pctSetsA) return pctSetsB - pctSetsA;
                const totalJeuxA = sa.jeuxGagnes + sa.jeuxPerdus, totalJeuxB = sb.jeuxGagnes + sb.jeuxPerdus;
                const pctJeuxA = totalJeuxA > 0 ? sa.jeuxGagnes / totalJeuxA : 0;
                const pctJeuxB = totalJeuxB > 0 ? sb.jeuxGagnes / totalJeuxB : 0;
                if (pctJeuxB !== pctJeuxA) return pctJeuxB - pctJeuxA;
                const rangA = rangDe(a), rangB = rangDe(b);
                if (rangA !== rangB) return rangA - rangB;
                return b.niveau - a.niveau; // filet de securite ultime, cas non prevu par la regle officielle
            });
        }
        resultat.push.apply(resultat, exAequo);
        i = j;
    }
    return resultat;
}

// Simule UNE SEULE etape des 5 que compte le format poules (Masters de fin de
// saison) : match 1/2/3 de la phase de groupes (les 2 groupes en meme temps),
// demi-finales, finale - au lieu de tout jouer d'un coup. Meme esprit que
// simulerUnTour pour l'elimination directe, pilotee par tournois.tour_actuel.
function simulerUnTourPoules(tournoiId) {
    const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
    if (!tournoi || tournoi.statut !== 'a_venir') return;

    const bareme = BAREME_POINTS[tournoi.bareme] || [0];
    const nbTours = 5; // le format poules compte toujours 5 etapes (calculerLabelsTours)
    const tourIndex = tournoi.tour_actuel;
    const groupes = groupesPoules(tournoiId);

    // estAbandon (facultatif) : le joueur perd cette elimination suite a un abandon
    // en cours de match (blessure) - jamais d'XP de progression dans ce cas (demande
    // explicite de l'utilisateur, 2026-08-21). Uniquement calculable pour les
    // eliminations directement liees a UN match precis (demies/finale) - pas pour
    // la sortie 3e/4e de poules, decidee sur le classement du groupe plutot que sur
    // un match unique.
    // score (optionnel) : XP jamais versee pour un abandon EN COURS de match NI un
    // forfait pre-match ; points de classement mis a zero UNIQUEMENT pour un
    // forfait, un abandon garde les points du tour reellement atteint (bug corrige
    // le 2026-08-23, cf. matchEstForfait plus haut).
    function eliminer(label, indexPoints, perdant, score) {
        const estAbandon = matchSansXp(score);
        const estForfait = matchEstForfait(score);
        const points = estForfait ? 0 : bareme[Math.min(indexPoints, bareme.length - 1)];
        db.prepare('UPDATE tournoi_joueurs SET tour_elimine = ?, points_gagnes = ? WHERE id = ?').run(label, points, perdant.id);
        if (!estAbandon) verserXpTournoi(perdant, nbTours, tourIndex);
        deduireEnergieFinTournoi(perdant);
    }

    if (tourIndex <= 2) {
        // Manche (tourIndex+1) sur 3 de la phase de poules, simultanement dans les 2 groupes.
        let ordre = 0;
        [groupes.A, groupes.B].forEach(function (groupe) {
            SCHEDULE_POULE_4[tourIndex].forEach(function (paire) {
                const j1 = groupe[paire[0]];
                const j2 = groupe[paire[1]];
                const resultat = resoudreMatchAdversaire(tournoi, 'Phase de poules', j1, j2);
                enregistrerMatchTournoi(tournoiId, 'Phase de poules', ordre++, j1, j2, resultat.vainqueur, resultat.score, resultat.matchId, resultat.matchIdJ2, resultat.evenements, tourIndex + 1);
            });
        });

        if (tourIndex === 2) {
            // Derniere manche jouee : classement final de chaque groupe, elimination des 3e/4e.
            const classementA = classementGroupe(tournoiId, groupes.A);
            const classementB = classementGroupe(tournoiId, groupes.B);
            classementA.slice(2).forEach(function (p) { eliminer('Poules', 3, p); });
            classementB.slice(2).forEach(function (p) { eliminer('Poules', 3, p); });
        }
    } else if (tourIndex === 3) {
        // Demi-finales : 1er groupe A vs 2e groupe B, 1er groupe B vs 2e groupe A.
        const classementA = classementGroupe(tournoiId, groupes.A);
        const classementB = classementGroupe(tournoiId, groupes.B);

        const sf1 = resoudreMatchAdversaire(tournoi, 'Demi-finale', classementA[0], classementB[1]);
        enregistrerMatchTournoi(tournoiId, 'Demi-finale', 100, classementA[0], classementB[1], sf1.vainqueur, sf1.score, sf1.matchId, sf1.matchIdJ2, sf1.evenements);
        eliminer('Demi-finale', 2, sf1.vainqueur === classementA[0] ? classementB[1] : classementA[0], sf1.score);

        const sf2 = resoudreMatchAdversaire(tournoi, 'Demi-finale', classementB[0], classementA[1]);
        enregistrerMatchTournoi(tournoiId, 'Demi-finale', 101, classementB[0], classementA[1], sf2.vainqueur, sf2.score, sf2.matchId, sf2.matchIdJ2, sf2.evenements);
        eliminer('Demi-finale', 2, sf2.vainqueur === classementB[0] ? classementA[1] : classementB[0], sf2.score);
    } else if (tourIndex === 4) {
        // Finale : les 2 seuls joueurs encore en lice.
        const finalistes = db.prepare('SELECT * FROM tournoi_joueurs WHERE tournoi_id = ? AND tour_elimine IS NULL').all(tournoiId);
        const resultat = resoudreMatchAdversaire(tournoi, 'Finale', finalistes[0], finalistes[1]);
        enregistrerMatchTournoi(tournoiId, 'Finale', 102, finalistes[0], finalistes[1], resultat.vainqueur, resultat.score, resultat.matchId, resultat.matchIdJ2, resultat.evenements);
        const champion = resultat.vainqueur;
        const runnerUp = champion.id === finalistes[0].id ? finalistes[1] : finalistes[0];
        eliminer('Finale', 1, runnerUp, resultat.score);
        db.prepare('UPDATE tournoi_joueurs SET tour_elimine = ?, points_gagnes = ? WHERE id = ?').run('Vainqueur', bareme[0], champion.id);
        verserXpTournoi(champion, nbTours, tourIndex);
        deduireEnergieFinTournoi(champion);
    }

    db.prepare('UPDATE tournois SET tour_actuel = ? WHERE id = ?').run(tourIndex + 1, tournoiId);
    if (tourIndex === 4) {
        db.prepare("UPDATE tournois SET statut = 'termine' WHERE id = ?").run(tournoiId);
        calculerPointsPronostics(tournoiId);
        appliquerReductionMentalSiEvenement(tournoiId);
    }
}

// Un tournoi peut compter des dizaines de joueurs (souvent des bots) qui continuent
// a jouer bien apres que CE joueur ait ete elimine ou ait remporte le titre -
// tournois.statut ne repasse a 'termine' qu'une fois TOUT le monde fini, donc s'y
// fier laissait "Resultats en tournoi" vide tant que le tournoi entier n'etait pas
// bouclé, meme si le parcours du joueur etait deja termine depuis longtemps (bug
// signale par l'utilisateur, 2026-08-20). tj.tour_elimine est lui pose des que ce
// joueur precis est elimine/vainqueur (simulerUnTour), independamment du reste du
// tableau - c'est la bonne condition.
app.get('/api/tournois/historique/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const historique = db.prepare(`
            SELECT tournois.nom, tournois.semaine, tournois.categorie, tournois.surface, tournois.calendrier_id,
                   tj.tour_elimine, tj.points_gagnes,
                   EXISTS(
                       SELECT 1 FROM matchs
                       WHERE matchs.tournoi_id = tournois.id AND matchs.player_id = tj.player_id AND matchs.kine_intervenu = 1
                   ) AS kine_intervenu
            FROM tournois
            JOIN tournoi_joueurs tj ON tj.tournoi_id = tournois.id AND tj.player_id = ? AND tj.est_reel = 1
            WHERE tj.tour_elimine IS NOT NULL
            ORDER BY tournois.semaine DESC
        `).all(playerId);

        historique.forEach(function (h) {
            h.positionSemaine = positionSemaineAffichee(h.semaine);
            h.kineIntervenu = !!h.kine_intervenu;
            delete h.kine_intervenu;
            const entreeCal = CALENDRIER_TOURNOIS.find(function (e) { return e.id === h.calendrier_id; });
            h.indoor = entreeCal ? !!entreeCal.indoor : false;
        });

        const totalPoints = historique.reduce(function (s, h) { return s + (h.points_gagnes || 0); }, 0);

        res.json({ success: true, historique, totalPoints });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/tournois/calendrier/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const debut = etat.semaine_actuelle + 1;
        const finOuvert = debut + 4;
        const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
        const cycleLongueur = LONGUEUR_SAISON;

        // On s'arrete a la fin du passage en cours dans le cycle (pas de bouclage sur la
        // saison suivante) : apres les Masters de fin de saison, plus rien a afficher tant
        // qu'on n'a pas vraiment atteint la semaine 1 de la nouvelle saison.
        const positionDebut = ((debut - 1) % cycleLongueur) + 1;
        const finAnnee = debut + (cycleLongueur - positionDebut);

        const eligibles = [];
        // Coupe Davis (ATP) / Fed Cup (WTA) : aucun tournoi individuel ne se joue ces
        // semaines-la (cf. SEMAINES_COUPES_EQUIPE), le calendrier serait sinon vide et
        // silencieux ces semaines-la - simple visibilite, pas d'inscription possible.
        const nomCoupe = circuit === 'ATP' ? 'Coupe Davis' : 'Fed Cup';
        for (let semaine = debut; semaine <= finAnnee; semaine++) {
            const phase = phaseDeSemaine(semaine);
            if (phase.type !== 'tournoi') continue;
            CALENDRIER_TOURNOIS
                // !tournoiDejaCreeCetteSaison : un tournoi deja cree/joue cette saison a
                // une AUTRE position (decalage de calendrier, cf. tournoiDejaCreeCetteSaison
                // plus bas) ne doit pas reapparaitre ici comme "a venir" - sinon la liste
                // annonce une 2e edition du meme tournoi (Stockholm/Finals...) qui ne sera
                // jamais reellement creee (le meme garde-fou bloque sa creation reelle),
                // laissant une inscription possible mais sans effet (bug signale par
                // l'utilisateur, 2026-08-24, suite au decalage de calendrier du meme jour).
                .filter(function (t) { return t.circuit === circuit && t.semaine_debut === phase.positionSemaine && !tournoiDejaCreeCetteSaison(t.id, semaine); })
                .forEach(function (t) { eligibles.push(Object.assign({}, t, { semaine, positionSemaine: t.semaine_debut, ouvert: semaine <= finOuvert })); });
            SEMAINES_COUPES_EQUIPE
                .filter(function (sc) { return sc.semaine === phase.positionSemaine; })
                .forEach(function (sc) {
                    eligibles.push({
                        id: 'coupe-' + circuit + '-' + sc.manche, estCoupe: true, circuit: circuit,
                        nom: nomCoupe, manche: sc.manche, semaine: semaine, positionSemaine: sc.semaine
                    });
                });
        }

        const tournoisExistants = db.prepare('SELECT id, calendrier_id, semaine, statut FROM tournois WHERE semaine BETWEEN ? AND ?').all(debut, finAnnee);
        const tournoiMap = new Map(tournoisExistants.map(function (t) { return [t.calendrier_id + '-' + t.semaine, t]; }));

        // "Inscrit" reflete tournoi_liste_attente (confirme OU en liste d'attente),
        // pas seulement une ligne est_reel=1 dans tournoi_joueurs - sinon un joueur en
        // attente reverrait "S'inscrire" au lieu de "Se desinscrire".
        const inscriptionsReelles = db.prepare(`
            SELECT calendrier_id, semaine FROM tournoi_liste_attente
            WHERE semaine BETWEEN ? AND ? AND player_id = ?
        `).all(debut, finAnnee, playerId);
        const inscritSet = new Set(inscriptionsReelles.map(function (i) { return i.calendrier_id + '-' + i.semaine; }));

        const favoris = db.prepare('SELECT calendrier_id, semaine FROM tournoi_favoris WHERE player_id = ? AND semaine BETWEEN ? AND ?').all(playerId, debut, finAnnee);
        const favoriSet = new Set(favoris.map(function (f) { return f.calendrier_id + '-' + f.semaine; }));

        // estTop30 : le joueur est-il dans le Top 30 fixe de la saison en cours -
        // detrmine si "estObligatoire" doit vraiment declencher l'avertissement pour
        // CE coach (un tournoi obligatoire ne concerne que les joueurs Top 30, cf.
        // pointsRetenusParEntiteCircuit). Plus d'inscription forcee depuis le
        // 2026-08-24 (demande explicite de l'utilisateur) : ne pas participer reste
        // possible, mais l'occurrence obligatoire comptera quand meme dans le
        // classement Live/Race avec 0 point si le joueur etait Top 30.
        const saisonAffichee = nombreSaisonAffichee();
        const estTop30 = !!db.prepare('SELECT 1 FROM classement_top30 WHERE saison = ? AND circuit = ? AND cle = ?')
            .get(saisonAffichee, circuit, 'joueur:' + playerId);

        eligibles.forEach(function (t) {
            const tournoi = tournoiMap.get(t.id + '-' + t.semaine);
            t.inscrit = inscritSet.has(t.id + '-' + t.semaine);
            t.tournoiId = tournoi ? tournoi.id : null;
            // Inscriptions fermees une fois le tableau tire (S-1), meme si "ouvert" au sens
            // de la fenetre de 5 semaines : coherent avec le vrai delai avant tirage au sort.
            t.inscriptionFermee = !!tournoi && tournoi.statut !== 'inscriptions';
            t.favori = favoriSet.has(t.id + '-' + t.semaine);
            t.estObligatoire = !t.estCoupe && estTop30 && estTournoiObligatoireTop30(circuit, t.id, t.categorie);
        });

        res.json({ success: true, semaineActuelle: etat.semaine_actuelle, debut, finOuvert, tournois: eligibles });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/tournois/mes/:userId', (req, res) => {
    try {
        const userId = req.userId;
        // "Mes" tournois = ceux ou l'un de mes joueurs a une inscription reelle
        // (tournoi_joueurs.player_id parmi mes joueurs, est_reel = 1) - le tournoi
        // lui-meme est un objet partage, l'appartenance vit sur l'inscription.
        const tournois = db.prepare(`
            SELECT tournois.*, players.prenom, players.nom AS nom_joueur, players.type,
                   moi.tour_elimine AS tour_elimine_joueur, moi.points_gagnes AS points_gagnes_joueur,
                   vainqueur_j.nom AS nom_vainqueur
            FROM tournoi_joueurs AS moi
            JOIN tournois ON tournois.id = moi.tournoi_id
            JOIN players ON players.id = moi.player_id
            LEFT JOIN tournoi_joueurs AS vainqueur_j
                ON vainqueur_j.tournoi_id = tournois.id AND vainqueur_j.tour_elimine = 'Vainqueur'
            WHERE moi.est_reel = 1 AND players.user_id = ?
            ORDER BY tournois.semaine DESC, tournois.id DESC
        `).all(userId);
        tournois.forEach(function (t) { t.positionSemaine = positionSemaineAffichee(t.semaine); });
        res.json({ success: true, tournois });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// TOUS les tournois de la semaine en cours pour un circuit (inscrit ou non) -
// contrairement a /api/tournois/mes, qui ne remonte que les tournois ou l'appelant
// a une inscription reelle. "participe"/tour_elimine_joueur/points_gagnes_joueur
// restent alimentes via une jointure sur mes propres joueurs quand j'y suis
// inscrit, pour garder le meme affichage de resultat cote frontend.
app.get('/api/tournois/cette-semaine/:circuit', (req, res) => {
    try {
        const circuit = req.params.circuit === 'WTA' ? 'WTA' : 'ATP';
        const type = circuit === 'ATP' ? 'joueur' : 'joueuse';
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();

        // semaine BETWEEN (pas = ) : un tournoi sur 2 semaines (GC/M1000 96) garde
        // tournois.semaine fige a sa semaine de DEBUT pendant toute sa duree - une
        // egalite stricte le faisait disparaitre de "Tournois de la semaine" des que
        // semaine_actuelle avancait vers sa 2e semaine, alors qu'il est toujours en
        // cours (bug signale par l'utilisateur, 2026-08-22). Meme logique que
        // tournoisDeLaSemaine (accueil.html), filtre par duree reelle applique ensuite en JS.
        const tournois = db.prepare(`
            SELECT tournois.*,
                   (moi.id IS NOT NULL) AS participe,
                   moi.tour_elimine AS tour_elimine_joueur, moi.points_gagnes AS points_gagnes_joueur,
                   vainqueur_j.nom AS nom_vainqueur
            FROM tournois
            LEFT JOIN tournoi_joueurs AS moi
                ON moi.tournoi_id = tournois.id AND moi.est_reel = 1
                AND moi.player_id IN (SELECT id FROM players WHERE user_id = ? AND type = ?)
            LEFT JOIN tournoi_joueurs AS vainqueur_j
                ON vainqueur_j.tournoi_id = tournois.id AND vainqueur_j.tour_elimine = 'Vainqueur'
            WHERE tournois.circuit = ? AND tournois.semaine BETWEEN ? AND ?
            ORDER BY tournois.id
        `).all(req.userId, type, circuit, etat.semaine_actuelle - 1, etat.semaine_actuelle)
            .filter(function (t) {
                const entree = CALENDRIER_TOURNOIS.find(function (e) { return e.id === t.calendrier_id; });
                const duree = entree ? entree.duree : 1;
                return t.semaine <= etat.semaine_actuelle && etat.semaine_actuelle < t.semaine + duree;
            });

        tournois.forEach(function (t) {
            t.positionSemaine = positionSemaineAffichee(t.semaine);
            const entreeCal = CALENDRIER_TOURNOIS.find(function (e) { return e.id === t.calendrier_id; });
            t.indoor = entreeCal ? !!entreeCal.indoor : false;
        });
        res.json({ success: true, tournois });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/tournois/passes/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
        const cycleLongueur = LONGUEUR_SAISON;

        // Reellement termines uniquement (statut de la ligne tournois elle-meme, pas
        // seulement "la semaine du calendrier est atteinte") - un tournoi de la
        // semaine en cours, pas encore joue ou encore en cours, ne doit jamais
        // apparaitre ici tant que son dernier tour n'est pas simule.
        //
        // Part DIRECTEMENT des lignes `tournois` reellement jouees (semaine stockee,
        // immuable) plutot que de re-deriver une semaine attendue en parcourant
        // CALENDRIER_TOURNOIS a partir de son semaine_debut ACTUEL : un tournoi deja
        // joue avant un decalage de calendrier (ex. Cincinnati Open+1 le 2026-08-24)
        // garde sa vraie semaine en base, mais semaine_debut a change entre-temps,
        // donc le recalcul retombait a cote et le tournoi disparaissait purement et
        // simplement de "Tournois passes" (bug signale par l'utilisateur, meme jour).
        const passes = db.prepare("SELECT id, calendrier_id, semaine FROM tournois WHERE circuit = ? AND statut = 'termine' AND semaine BETWEEN ? AND ?")
            .all(circuit, etat.semaine_actuelle - cycleLongueur, etat.semaine_actuelle)
            .map(function (row) {
                const entree = CALENDRIER_TOURNOIS.find(function (t) { return t.id === row.calendrier_id; });
                if (!entree) return null; // entree calendaire disparue (ne devrait jamais arriver)
                return Object.assign({}, entree, { semaine: row.semaine, positionSemaine: positionSemaineAffichee(row.semaine), tournoiId: row.id });
            })
            .filter(Boolean);

        // Mes inscriptions reelles (le tournoi lui-meme est partage, l'appartenance vit
        // sur tournoi_joueurs.player_id/est_reel), jointes a tournois pour le statut et
        // le resultat propre a CE joueur (tj.tour_elimine/points_gagnes, pas une colonne
        // denormalisee sur tournois qui n'aurait plus de sens sur une ligne partagee).
        const registrations = db.prepare(`
            SELECT t.id, t.statut, tj.tour_elimine AS tour_elimine_joueur, tj.points_gagnes AS points_gagnes_joueur
            FROM tournoi_joueurs tj
            JOIN tournois t ON t.id = tj.tournoi_id
            WHERE tj.player_id = ? AND tj.est_reel = 1 AND t.semaine BETWEEN ? AND ?
        `).all(playerId, etat.semaine_actuelle - cycleLongueur, etat.semaine_actuelle);
        const regMap = new Map(registrations.map(function (r) { return [r.id, r]; }));

        passes.forEach(function (t) {
            const reg = regMap.get(t.tournoiId);
            if (reg && reg.statut === 'termine') {
                t.participe = true;
                t.tourElimineJoueur = reg.tour_elimine_joueur;
                t.pointsGagnesJoueur = reg.points_gagnes_joueur;
            } else {
                t.participe = false;
            }

            // Vainqueur affiche dans tous les cas (participation ou non) - demande
            // explicite de l'utilisateur : "Tournois passes" doit montrer TOUS les
            // tournois du circuit, avec le nom et le drapeau du vainqueur.
            const vainqueur = db.prepare("SELECT nom, nationalite FROM tournoi_joueurs WHERE tournoi_id = ? AND tour_elimine = 'Vainqueur'").get(t.tournoiId);
            t.nomVainqueur = vainqueur ? vainqueur.nom : null;
            t.drapeauVainqueur = vainqueur ? drapeau(vainqueur.nationalite) : null;
        });

        passes.sort(function (a, b) { return b.semaine - a.semaine; });

        res.json({ success: true, tournois: passes });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/tournois/:id', (req, res) => {
    try {
        const { id } = req.params;

        const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(id);
        if (!tournoi) {
            return res.status(404).json({ error: 'Tournoi introuvable.' });
        }

        const joueurs = db.prepare('SELECT * FROM tournoi_joueurs WHERE tournoi_id = ? ORDER BY position_tableau').all(id);

        res.json({ success: true, tournoi, joueurs });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Un calendrier_id ne doit jamais avoir 2 editions creees la meme saison. Garde-fou
// necessaire depuis le decalage de calendrier du 2026-08-24 (Cincinnati+1 et ses
// consequences en cascade sur Stockholm/ATP Finals/WTA Finals, decales une 2e ou 3e
// fois le meme jour) : un tournoi deja cree/joue cette saison a son ANCIENNE position
// se retrouve, sous le calendrier ACTUEL, associe a une position plus tardive encore
// a venir cette meme saison - sans ce garde-fou, il serait recree et rejoue une 2e
// fois (ex. une 2e WTA Finals dans la meme saison, avec un 2e "vainqueur").
// Distance absolue plutot que re-derivation du numero de saison via
// phaseDeSemaine : un changement de LONGUEUR_SAISON (ex. 50->51 le 2026-08-24)
// reinterprete RETROACTIVEMENT la saison de N'IMPORTE QUELLE semaine passee, y
// compris une ligne creee des annees de jeu plus tot sous une autre valeur.
// Deux occurrences a moins d'une demi-saison d'ecart sont presque certainement
// un doublon (decalage de calendrier), deux occurrences a l'ecart d'une saison
// complete ou plus sont deux editions differentes - stable quel que soit
// LONGUEUR_SAISON au moment de la comparaison, contrairement au recalcul de saison.
// r.semaine !== semaineReference (ajoute le 2026-08-25) : sans cette exclusion,
// un tournoi deja cree A CETTE POSITION EXACTE (le cas normal - cree a S-5,
// tire a S-1) se detectait lui-meme comme "doublon" des qu'il apparaissait dans
// la liste "Tournois de l'annee", le faisant disparaitre completement de
// l'affichage (bug signale par l'utilisateur pour l'Open d'Australie et la
// semaine 7 de la saison 2 - les 2 avaient deja ete crees a leur bonne position
// et se sont donc mis a se filtrer eux-memes). Les appels cote creation
// verifient deja `!tournoiRow`/`!existe` en position exacte avant d'appeler
// cette fonction, donc l'exclusion ne change rien pour eux.
function tournoiDejaCreeCetteSaison(calendrierId, semaineReference) {
    const seuil = LONGUEUR_SAISON / 2;
    return db.prepare('SELECT semaine FROM tournois WHERE calendrier_id = ?').all(calendrierId)
        .some(function (r) { return r.semaine !== semaineReference && Math.abs(r.semaine - semaineReference) < seuil; });
}

// Cree un tournoi au stade "inscriptions" : le pool d'entrants existe (visible dans
// l'onglet Inscrits) mais le tableau n'est pas encore tire au sort (ca arrive a S-1,
// voir tirerAuSort). position_tableau = -1 est le marqueur "pas encore tire".
function creerTournoi(entree, semaine, rivauxUtilises) {
    const insertionTournoi = db.prepare(`
        INSERT INTO tournois (calendrier_id, nom, circuit, categorie, surface, taille_tableau, semaine, bareme, format, statut)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'inscriptions')
    `).run(
        entree.id, entree.nom, entree.circuit, String(entree.categorie),
        entree.surface, entree.taille_tableau, semaine, entree.bareme, entree.format || 'elimination'
    );

    const tournoiId = insertionTournoi.lastInsertRowid;
    const entrants = entree.categorie === 'finals'
        ? genererEntrantsFinals(entree, semaine)
        : genererEntrants(entree, semaine, rivauxUtilises);

    const insertJoueur = db.prepare(`
        INSERT INTO tournoi_joueurs (tournoi_id, nom, nationalite, niveau, est_reel, player_id, rival_id, position_tableau, tete_de_serie)
        VALUES (?, ?, ?, ?, ?, ?, ?, -1, NULL)
    `);
    entrants.forEach(function (entrant) {
        insertJoueur.run(
            tournoiId, entrant.nom, entrant.nationalite || null, entrant.niveau,
            entrant.est_reel ? 1 : 0, entrant.player_id || null, entrant.rival_id || null
        );
    });

    return tournoiId;
}

// Reequilibre le tableau d'un tournoi encore en inscriptions a partir de
// tournoi_liste_attente (source de verite unique de "qui s'est inscrit"). Un vrai
// joueur a TOUJOURS priorite sur un rival (demande explicite de l'utilisateur,
// 2026-08-19) : les "capacite" premiers inscrits reels (par classement) delogent
// systematiquement des rivaux, quel que soit le classement de ces derniers - seul
// le surplus de vrais joueurs au-dela de la capacite totale part en liste d'attente.
// Les rivaux ne se disputent qu'ENTRE EUX les slots qui restent une fois tous les
// vrais joueurs places, toujours les mieux classes en priorite. Plus jamais de bot
// tant que le roster de rivaux (200/circuit) n'est pas epuise. La priorite au vrai
// joueur ne s'applique qu'ici (qui entre dans le tableau) - une fois dedans, le
// tirage au sort (tirerAuSort) seede tout le monde par classement sans distinction,
// un rival mieux classe qu'un vrai joueur reste tete de serie devant lui. Appelee
// apres CHAQUE inscription/desinscription reelle.
function rebalancerTournoi(tournoiId, entree, semaine) {
    const rangs = calculerRangsLiveGlobal(entree.circuit);

    const inscriptions = db.prepare(`
        SELECT p.* FROM tournoi_liste_attente tla
        JOIN players p ON p.id = tla.player_id
        WHERE tla.calendrier_id = ? AND tla.semaine = ?
    `).all(entree.id, semaine).map(function (p) {
        return { type: 'reel', id: p.id, rang: rangs.get('joueur:' + p.id) || Infinity, data: p, niveau: Math.round(niveauNormal(p, entree.surface)) };
    }).sort(function (a, b) { return a.rang - b.rang; });

    const lignes = db.prepare("SELECT * FROM tournoi_joueurs WHERE tournoi_id = ? AND nom != 'BYE'").all(tournoiId);
    const capacite = lignes.length;

    const retenusReels = inscriptions.slice(0, capacite);
    const slotsRivaux = capacite - retenusReels.length;

    // Rivaux retenus pour les slots restants : ceux deja dans ce tableau, plus tout
    // rival du roster non deja utilise par un AUTRE tournoi de la meme semaine -
    // les mieux classes en priorite.
    const rivauxActuelsSet = new Set(lignes.filter(function (l) { return l.rival_id !== null; }).map(function (l) { return l.rival_id; }));
    const utilisesAilleursSemaine = new Set(
        db.prepare('SELECT DISTINCT rival_id FROM tournoi_joueurs WHERE rival_id IS NOT NULL AND tournoi_id IN (SELECT id FROM tournois WHERE semaine = ? AND id != ?)')
            .all(semaine, tournoiId).map(function (r) { return r.rival_id; })
    );
    const candidatsRivaux = db.prepare('SELECT id FROM classement_joueurs WHERE circuit = ?').all(entree.circuit)
        .map(function (r) { return r.id; })
        .filter(function (id) { return rivauxActuelsSet.has(id) || !utilisesAilleursSemaine.has(id); })
        .sort(function (a, b) { return (rangs.get('rival:' + a) || Infinity) - (rangs.get('rival:' + b) || Infinity); });

    const retenus = retenusReels.concat(
        candidatsRivaux.slice(0, slotsRivaux).map(function (id) { return { type: 'rival', id: id, rang: rangs.get('rival:' + id) || Infinity }; })
    );

    const idsReelsRetenus = new Set(retenusReels.map(function (c) { return c.id; }));
    const idsRivauxRetenus = new Set(retenus.filter(function (c) { return c.type === 'rival'; }).map(function (c) { return c.id; }));

    // Slots dont l'occupant actuel n'est plus retenu.
    const slotsLibres = lignes.filter(function (l) {
        if (l.est_reel) return !idsReelsRetenus.has(l.player_id);
        if (l.rival_id !== null) return !idsRivauxRetenus.has(l.rival_id);
        return true; // ancien bot de secours residuel, toujours remplacable
    });

    // Retenus qui n'ont pas deja la ligne qui leur correspond.
    const dejaEnPlace = new Set();
    lignes.forEach(function (l) {
        if (l.est_reel && idsReelsRetenus.has(l.player_id)) dejaEnPlace.add('reel:' + l.player_id);
        if (l.rival_id !== null && idsRivauxRetenus.has(l.rival_id)) dejaEnPlace.add('rival:' + l.rival_id);
    });

    let curseur = 0;
    retenus.filter(function (c) { return !dejaEnPlace.has(c.type + ':' + c.id); }).forEach(function (c) {
        const slot = slotsLibres[curseur];
        curseur++;
        if (!slot) return; // ne devrait pas arriver, comptes verifies ci-dessus
        if (c.type === 'reel') {
            db.prepare('UPDATE tournoi_joueurs SET nom = ?, nationalite = ?, niveau = ?, est_reel = 1, player_id = ?, rival_id = NULL, energie_misee = 0 WHERE id = ?')
                .run(c.data.prenom + ' ' + c.data.nom, c.data.nationalite, c.niveau, c.id, slot.id);
        } else {
            const r = db.prepare('SELECT * FROM classement_joueurs WHERE id = ?').get(c.id);
            db.prepare('UPDATE tournoi_joueurs SET nom = ?, nationalite = ?, niveau = ?, est_reel = 0, player_id = NULL, rival_id = ? WHERE id = ?')
                .run(r.nom, r.nationalite, r.niveau, r.id, slot.id);
        }
    });

    // Filet de secours ultime (roster de 200 rivaux/circuit vraiment epuise, ne
    // devrait jamais arriver en pratique) : bouche les slots encore libres avec un
    // bot plutot que de laisser une ligne orpheline.
    const estFeminin = entree.circuit === 'WTA';
    slotsLibres.slice(curseur).forEach(function (slot) {
        const lambda = genererJoueurLambda(entree.categorie, estFeminin);
        db.prepare('UPDATE tournoi_joueurs SET nom = ?, nationalite = ?, niveau = ?, est_reel = 0, player_id = NULL, rival_id = NULL, energie_misee = 0 WHERE id = ?')
            .run(lambda.nom, lambda.nationalite, lambda.niveau, slot.id);
    });

    // Si jamais un bot de secours existe, son niveau reste toujours plus faible que
    // n'importe quel vrai joueur confirme (demande explicite de l'utilisateur,
    // 2026-08-18).
    const niveauxConfirmes = retenus.filter(function (c) { return c.type === 'reel'; }).map(function (c) { return c.niveau; });
    if (niveauxConfirmes.length > 0) {
        const niveauPlancher = Math.min.apply(null, niveauxConfirmes);
        db.prepare("UPDATE tournoi_joueurs SET niveau = ? WHERE tournoi_id = ? AND est_reel = 0 AND rival_id IS NULL AND nom != 'BYE'").run(niveauPlancher, tournoiId);
    }
}

// Une inscription reelle n'est plus jamais rejetee pour "tableau complet" (liste
// d'attente illimitee, 2026-08-18) : elle est enregistree dans
// tournoi_liste_attente, puis rebalancerTournoi() decide qui occupe reellement un
// slot. La mise d'energie ne se choisit plus ici (voir POST /api/tournois/mise-
// energie), toujours 0 a l'inscription.
function inscrireJoueurAuTournoi(userId, player, entree, semaine) {
    // Un joueur blesse est contraint de declarer forfait pour les tournois a venir
    // (regle du PDF) : pas de nouvelle inscription tant que la condition n'est pas
    // revenue a "en_forme" (recuperation via une semaine de repos).
    if (player.condition === 'blesse') {
        return { error: 'Ce joueur est blesse et ne peut pas s inscrire a un tournoi tant qu il ne s est pas repose.' };
    }

    // Le tournoi est un objet GLOBAL partage par tous les coachs : le pool peut deja
    // exister (cree a l'ouverture des inscriptions S-5, ou par un autre coach deja
    // inscrit) independamment de ce joueur precis.
    const dejaInscrit = db.prepare('SELECT * FROM tournois WHERE calendrier_id = ? AND semaine = ?').get(entree.id, semaine);

    if (dejaInscrit) {
        const dejaEnListe = db.prepare('SELECT 1 FROM tournoi_liste_attente WHERE calendrier_id = ? AND semaine = ? AND player_id = ?').get(entree.id, semaine, player.id);
        if (dejaEnListe) {
            return { error: 'Deja inscrit a ce tournoi.' };
        }
        if (dejaInscrit.statut !== 'inscriptions') {
            return { error: 'Les inscriptions sont fermees pour ce tournoi (le tableau a deja ete tire).' };
        }
    }

    const autreTournoiCetteSemaine = db.prepare(`
        SELECT 1 FROM tournoi_liste_attente WHERE semaine = ? AND player_id = ? AND calendrier_id != ?
    `).get(semaine, player.id, entree.id);
    if (autreTournoiCetteSemaine) {
        return { error: 'Ce joueur est deja inscrit a un autre tournoi cette semaine-la.' };
    }

    // Assure l'existence du pool partage (le cree si personne, coach ou lambda, n'y
    // est encore jamais entre) avant d'enregistrer l'inscription.
    const tournoiId = dejaInscrit ? dejaInscrit.id : creerTournoi(entree, semaine);
    db.prepare('INSERT OR IGNORE INTO tournoi_liste_attente (calendrier_id, semaine, player_id) VALUES (?, ?, ?)').run(entree.id, semaine, player.id);
    rebalancerTournoi(tournoiId, entree, semaine);

    return { tournoiId };
}

app.post('/api/tournois/inscription', (req, res) => {
    try {
        const { playerId, calendrierId, semaine } = req.body;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (player.statut !== 'valide') {
            return res.status(400).json({ error: 'Ce joueur doit d abord etre valide par l administrateur.' });
        }
        if (aDesPertesDispositionsEnAttente(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de disposition a retirer.' });
        }
        if (aDesCompetencesARepartir(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de competences de la moulinette.' });
        }
        if (player.points_energie < 1) {
            return res.status(400).json({ error: 'Ce joueur n a plus de points d energie : impossible de s inscrire (cout fixe de 1 PE par participation).' });
        }

        const entree = CALENDRIER_TOURNOIS.find(function (t) { return t.id === calendrierId; });
        if (!entree) {
            return res.status(400).json({ error: 'Tournoi introuvable dans le calendrier.' });
        }
        if (entree.circuit !== (player.type === 'joueur' ? 'ATP' : 'WTA')) {
            return res.status(400).json({ error: 'Ce tournoi n est pas sur le circuit de ce joueur.' });
        }

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        if (semaine <= etat.semaine_actuelle || semaine > etat.semaine_actuelle + 5) {
            return res.status(400).json({ error: 'Ce tournoi n est pas (ou plus) ouvert aux inscriptions.' });
        }

        // La mise d energie ne se choisit plus ici : elle se regle sur la page
        // planification, juste a cote des styles de jeu, tant que le tournoi n a pas
        // commence (voir POST /api/tournois/mise-energie). L inscription demarre donc
        // toujours a 0.
        const resultat = inscrireJoueurAuTournoi(req.userId, player, entree, semaine);
        if (resultat.error) {
            return res.status(409).json({ error: resultat.error });
        }

        res.json({ success: true, tournoiId: resultat.tournoiId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/tournois/favori', (req, res) => {
    try {
        const { playerId, calendrierId, semaine } = req.body;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (aDesPertesDispositionsEnAttente(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de disposition a retirer.' });
        }
        if (aDesCompetencesARepartir(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de competences de la moulinette.' });
        }

        const entree = CALENDRIER_TOURNOIS.find(function (t) { return t.id === calendrierId; });
        if (!entree) {
            return res.status(400).json({ error: 'Tournoi introuvable dans le calendrier.' });
        }

        const existant = db.prepare('SELECT id, calendrier_id FROM tournoi_favoris WHERE player_id = ? AND semaine = ?').get(playerId, semaine);
        if (existant && existant.calendrier_id === calendrierId) {
            db.prepare('DELETE FROM tournoi_favoris WHERE id = ?').run(existant.id);
            return res.json({ success: true, favori: false });
        }

        db.prepare(`
            INSERT INTO tournoi_favoris (player_id, calendrier_id, semaine) VALUES (?, ?, ?)
            ON CONFLICT(player_id, semaine) DO UPDATE SET calendrier_id = excluded.calendrier_id
        `).run(playerId, calendrierId, semaine);

        res.json({ success: true, favori: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/tournois/desinscription', (req, res) => {
    try {
        const { playerId, tournoiId } = req.body;

        // Le tournoi lui-meme est partage (plus de user_id/player_id dessus) :
        // l'ownership passe par le joueur (players.user_id) + sa ligne d'inscription
        // reelle (tournoi_joueurs.player_id/est_reel) dans ce tournoi precis.
        const player = db.prepare('SELECT id FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (aDesPertesDispositionsEnAttente(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de disposition a retirer.' });
        }
        if (aDesCompetencesARepartir(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de competences de la moulinette.' });
        }
        const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
        if (!tournoi) {
            return res.status(404).json({ error: 'Inscription introuvable.' });
        }
        if (tournoi.statut !== 'inscriptions') {
            return res.status(400).json({ error: 'Le tableau de ce tournoi est deja tire, impossible de se desinscrire.' });
        }

        const inscription = db.prepare('SELECT id FROM tournoi_liste_attente WHERE calendrier_id = ? AND semaine = ? AND player_id = ?').get(tournoi.calendrier_id, tournoi.semaine, playerId);
        if (!inscription) {
            return res.status(400).json({ error: 'Ce joueur n est pas inscrit a ce tournoi.' });
        }

        // Retire l'inscription (confirmee ou en liste d'attente), puis rebalancerTournoi
        // se charge de tout : si ce joueur occupait un slot dans le tableau, il revient
        // lambda et un inscrit mieux classe encore en attente prend sa place le cas echeant.
        db.prepare('DELETE FROM tournoi_liste_attente WHERE id = ?').run(inscription.id);
        const entree = CALENDRIER_TOURNOIS.find(function (t) { return t.id === tournoi.calendrier_id; });
        rebalancerTournoi(tournoiId, entree, tournoi.semaine);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Styles interdits pour un tournoi OU une rencontre de Coupe Davis/Fed Cup donne(e) :
// l'ensemble (sans doublon, "aucun" exclu) de tous les styles utilises a
// l'evenement PRECEDENT joue par ce joueur CETTE MEME SAISON (le plus recent par
// semaine, strictement avant `semaineActuelle` mais pas avant la Pre-saison en
// cours) - une rencontre de Coupe Davis/Fed Cup compte desormais comme un
// tournoi pour cette restriction, dans les 2 sens (demande explicite de
// l'utilisateur, 2026-08-26 : "la CD/FC compte comme un tournoi"). Une nouvelle
// saison repart avec tous les styles disponibles (demande explicite,
// 2026-08-24). Pas de restriction a l'interieur d'un meme tournoi/d'une meme
// rencontre : on peut tres bien garder le meme style partout, y compris
// consecutif (simple aller ET retour d'une meme rencontre CD/FC par exemple).
function stylesInterditsEvenementPrecedent(playerId, semaineActuelle) {
    const positionSaisonBrute = ((semaineActuelle - 1) % LONGUEUR_SAISON) + 1;
    const debutSaison = semaineActuelle - positionSaisonBrute + 2;

    const dernierTournoi = db.prepare(`
        SELECT t.semaine AS semaine, tj.style_choisi AS styles
        FROM tournois t
        JOIN tournoi_joueurs tj ON tj.tournoi_id = t.id AND tj.player_id = ? AND tj.est_reel = 1
        WHERE t.semaine < ? AND t.semaine > ? AND tj.style_choisi IS NOT NULL
        ORDER BY t.semaine DESC
        LIMIT 1
    `).get(playerId, semaineActuelle, debutSaison);

    const player = db.prepare('SELECT nationalite, type FROM players WHERE id = ?').get(playerId);
    let dernierTie = null;
    if (player) {
        const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
        dernierTie = db.prepare(`
            SELECT ce.id AS tieId, ce.semaine AS semaine
            FROM coupe_equipes ce
            WHERE ce.circuit = ? AND (ce.nation_domicile = ? OR ce.nation_exterieur = ?)
              AND ce.semaine < ? AND ce.semaine > ?
              AND EXISTS (SELECT 1 FROM coupe_styles cs WHERE cs.coupe_equipe_id = ce.id AND cs.player_id = ?)
            ORDER BY ce.semaine DESC
            LIMIT 1
        `).get(circuit, player.nationalite, player.nationalite, semaineActuelle, debutSaison, playerId);
    }

    if (!dernierTournoi && !dernierTie) return [];
    // Le plus RECENT des 2 (semaine la plus proche de semaineActuelle) l'emporte -
    // c'est lui, et lui seul, qui interdit ses propres styles.
    if (dernierTie && (!dernierTournoi || dernierTie.semaine > dernierTournoi.semaine)) {
        const lignes = db.prepare('SELECT style FROM coupe_styles WHERE coupe_equipe_id = ? AND player_id = ?').all(dernierTie.tieId, playerId);
        return Array.from(new Set(lignes.map(function (r) { return r.style; }).filter(function (s) { return s !== 'aucun'; })));
    }
    let stylesPrecedents = [];
    try { stylesPrecedents = JSON.parse(dernierTournoi.styles || '[]'); } catch (e) { stylesPrecedents = []; }
    return Array.from(new Set(stylesPrecedents.filter(function (s) { return s !== 'aucun'; })));
}

app.post('/api/tournois/style', (req, res) => {
    try {
        const { playerId, tournoiId, styles } = req.body;

        if (!Array.isArray(styles) || styles.length === 0) {
            return res.status(400).json({ error: 'Liste de styles invalide.' });
        }
        if (!styles.every(function (s) { return STYLES_JEU.includes(s); })) {
            return res.status(400).json({ error: 'Un des styles de jeu choisis est invalide.' });
        }

        const player = db.prepare('SELECT id FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        if (aDesPertesDispositionsEnAttente(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de disposition a retirer.' });
        }
        if (aDesCompetencesARepartir(playerId)) {
            return res.status(400).json({ error: 'Il faut d abord repartir les points de competences de la moulinette.' });
        }
        const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
        if (!tournoi) {
            return res.status(404).json({ error: 'Tournoi introuvable.' });
        }
        if (tournoi.statut !== 'a_venir') {
            return res.status(400).json({ error: 'Les styles de jeu ne peuvent etre choisis qu une fois le tableau tire, et avant le debut du tournoi.' });
        }

        const stylesInterdits = stylesInterditsEvenementPrecedent(playerId, tournoi.semaine);
        if (styles.some(function (s) { return stylesInterdits.includes(s); })) {
            return res.status(400).json({ error: 'Impossible d utiliser un style deja utilise au tournoi ou a la rencontre de Coupe Davis/Fed Cup precedent(e).' });
        }

        const entree = CALENDRIER_TOURNOIS.find(function (t) { return t.id === tournoi.calendrier_id; });
        const labelsAttendus = calculerLabelsTours(entree.taille_tableau, tournoi.format);
        if (styles.length !== labelsAttendus.length) {
            return res.status(400).json({ error: 'Il faut choisir exactement un style pour chacun des ' + labelsAttendus.length + ' tours possibles de ce tournoi.' });
        }

        const ligneReelle = db.prepare('SELECT id, style_choisi FROM tournoi_joueurs WHERE tournoi_id = ? AND player_id = ? AND est_reel = 1').get(tournoiId, playerId);
        if (!ligneReelle) {
            return res.status(400).json({ error: 'Ce joueur n est pas inscrit a ce tournoi.' });
        }

        if (ligneReelle.style_choisi) {
            const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;

            // Verrouille des que la semaine de DEBUT du tournoi commence, y compris pour
            // les tournois 2 semaines (7 tours, GC/M1000 96) : avant, leurs tours de la
            // 2e semaine (3-6) restaient modifiables jusqu'a leur propre semaine, permettant
            // de changer le style en cours de route une fois le tournoi deja entame -
            // desormais un seul verrou global, comme les tournois classiques (demande
            // explicite de l'utilisateur, 2026-08-20).
            if (semaineActuelle >= tournoi.semaine) {
                return res.status(400).json({ error: 'Les styles de ce tournoi ne sont plus modifiables une fois sa semaine commencee.' });
            }
        }

        db.prepare('UPDATE tournoi_joueurs SET style_choisi = ? WHERE id = ?').run(JSON.stringify(styles), ligneReelle.id);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/tournois/style-en-attente/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const semaineActuelle = etat.semaine_actuelle;

        // TOUS les tournois "a_venir" (tableau deja tire) ou ce joueur est engage, pas
        // seulement le premier : le tableau du PROCHAIN tournoi peut deja etre tire
        // (S-1) alors que le joueur est encore engage dans le tournoi en cours, et les
        // 2 doivent pouvoir etre planifies en meme temps (demande explicite de
        // l'utilisateur, 2026-08-20 - avant, le 2e restait invisible jusqu'a la fin du
        // 1er). La semaine >= semaine_actuelle exclut toute ligne orpheline restee
        // bloquee en 'a_venir' tres loin dans le passe.
        const tournois = db.prepare(`
            SELECT tournois.*
            FROM tournois
            JOIN tournoi_joueurs ON tournoi_joueurs.tournoi_id = tournois.id
            WHERE tournois.statut = 'a_venir' AND tournois.semaine >= ?
              AND tournoi_joueurs.player_id = ? AND tournoi_joueurs.est_reel = 1
            ORDER BY tournois.semaine ASC
        `).all(semaineActuelle, playerId);

        const resultat = tournois.map(function (tournoi) {
            const entree = CALENDRIER_TOURNOIS.find(function (t) { return t.id === tournoi.calendrier_id; });
            const labelsTours = calculerLabelsTours(entree.taille_tableau, tournoi.format);

            const ligneReelle = db.prepare('SELECT style_choisi, energie_misee FROM tournoi_joueurs WHERE tournoi_id = ? AND player_id = ? AND est_reel = 1').get(tournoi.id, playerId);
            let stylesActuels = [];
            try { stylesActuels = JSON.parse(ligneReelle.style_choisi || '[]'); } catch (e) { stylesActuels = []; }

            const stylesInterdits = stylesInterditsEvenementPrecedent(playerId, tournoi.semaine);

            return {
                tournoi: { id: tournoi.id, nom: tournoi.nom, calendrierId: tournoi.calendrier_id, semaine: tournoi.semaine, positionSemaine: positionSemaineAffichee(tournoi.semaine), tour_actuel: tournoi.tour_actuel },
                // Verrouille des que la semaine de DEBUT du tournoi commence (meme regle
                // que /api/tournois/style, cf. juste en dessous) - remplace tour_actuel > 0
                // cote frontend, qui restait faux tant qu'aucun tour n'avait encore ete
                // simule cette semaine-la.
                verrouille: semaineActuelle >= tournoi.semaine,
                labelsTours,
                stylesActuels,
                stylesInterdits,
                energieMiseeActuelle: ligneReelle.energie_misee || 0,
                plafondMiseEnergie: PLAFOND_MISE_ENERGIE[String(entree.categorie)] || 0
            };
        });

        res.json({ success: true, tournois: resultat, pointsEnergieDisponibles: player.points_energie });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Reglage de la mise d energie, deplace sur la page planification (juste a cote des
// styles de jeu) plutot qu a l inscription : librement modifiable tant que le
// tournoi n a pas commence (tour_actuel === 0), verrouille ensuite - la mise
// s applique a la totalite du tournoi, pas tour par tour, donc pas de logique de
// re-choix partiel comme pour les styles des tournois 7 tours.
app.post('/api/tournois/mise-energie', (req, res) => {
    try {
        const { playerId, tournoiId, energieMisee } = req.body;

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }
        const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
        if (!tournoi) {
            return res.status(404).json({ error: 'Tournoi introuvable.' });
        }
        // Meme regle que les styles de jeu : modifiable tant que la semaine en cours
        // n'a pas atteint celle du tournoi, verrouillee des que la semaine change pour
        // y entrer (executerAvancementSemaine), meme si le 1er tour n'est pas encore simule.
        const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;
        if (tournoi.statut !== 'a_venir' || semaineActuelle >= tournoi.semaine) {
            return res.status(400).json({ error: 'La mise d energie ne peut plus etre modifiee, la semaine du tournoi a deja commence.' });
        }

        const ligneReelle = db.prepare('SELECT id FROM tournoi_joueurs WHERE tournoi_id = ? AND player_id = ? AND est_reel = 1').get(tournoiId, playerId);
        if (!ligneReelle) {
            return res.status(400).json({ error: 'Ce joueur n est pas inscrit a ce tournoi.' });
        }

        const entree = CALENDRIER_TOURNOIS.find(function (t) { return t.id === tournoi.calendrier_id; });
        const plafondCategorie = PLAFOND_MISE_ENERGIE[String(entree.categorie)] || 0;
        const miseDemandee = Math.floor(Number(energieMisee) || 0);
        if (miseDemandee < 0 || miseDemandee > plafondCategorie) {
            return res.status(400).json({ error: 'La mise d energie doit etre comprise entre 0 et ' + plafondCategorie + ' pour ce tournoi.' });
        }
        if (miseDemandee > player.points_energie) {
            return res.status(400).json({ error: 'Ce joueur n a pas assez de points d energie pour cette mise.' });
        }

        db.prepare('UPDATE tournoi_joueurs SET energie_misee = ? WHERE id = ?').run(miseDemandee, ligneReelle.id);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/tournois/fiche/:calendrierId', (req, res) => {
    try {
        const { calendrierId } = req.params;
        const { playerId, semaine } = req.query;
        const userId = req.userId;

        const entree = CALENDRIER_TOURNOIS.find(function (t) { return t.id === calendrierId; });
        if (!entree) {
            return res.status(404).json({ error: 'Tournoi introuvable dans le calendrier.' });
        }

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, userId);
        if (!player) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const semaineNum = parseInt(semaine, 10);
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const bareme = BAREME_POINTS[entree.bareme] || [];

        const instanceRow = db.prepare('SELECT * FROM tournois WHERE calendrier_id = ? AND semaine = ?').get(calendrierId, semaineNum);
        // Vrai si confirme dans le tableau (tournoi_joueurs, seule source qui survit
        // au tirage au sort - la liste d'attente est videe a ce moment-la) OU encore en
        // liste d'attente (tant que le tableau n'a pas ete tire).
        const estInscrit = (!!instanceRow && !!db.prepare('SELECT 1 FROM tournoi_joueurs WHERE tournoi_id = ? AND player_id = ? AND est_reel = 1').get(instanceRow.id, playerId))
            || !!db.prepare('SELECT 1 FROM tournoi_liste_attente WHERE calendrier_id = ? AND semaine = ? AND player_id = ?').get(calendrierId, semaineNum, playerId);

        let instance = null;
        if (instanceRow) {
            const rangs = calculerRangsLiveGlobal(entree.circuit);
            const rangsRace = calculerRangsRaceGlobal(entree.circuit);
            function rangDe(table, rivalId, estReel, playerId) {
                if (rivalId) return table.get('rival:' + rivalId) || null;
                if (estReel) return table.get('joueur:' + playerId) || null;
                return null;
            }

            const joueurs = db.prepare(`
                SELECT tj.*, p.user_id AS coach_user_id
                FROM tournoi_joueurs tj
                LEFT JOIN players p ON p.id = tj.player_id
                WHERE tj.tournoi_id = ?
                ORDER BY tj.position_tableau
            `).all(instanceRow.id);
            joueurs.forEach(function (j) {
                j.drapeau = drapeau(j.nationalite);
                j.rang = rangDe(rangs, j.rival_id, j.est_reel, j.player_id);
                j.rangRace = rangDe(rangsRace, j.rival_id, j.est_reel, j.player_id);
                j.coachNom = j.est_reel ? nomCoach(j.coach_user_id) : null;
            });
            // Niveau confidentiel : reste utilise pour le tri (tete de serie puis niveau,
            // comme avant) mais efface du JSON envoye au client pour tout le monde sauf
            // le joueur qui consulte - sinon la valeur resterait visible brute dans
            // l'onglet reseau du navigateur meme si l'affichage la masque.
            joueurs.sort(function (a, b) {
                if (a.tete_de_serie && b.tete_de_serie) return a.tete_de_serie - b.tete_de_serie;
                if (a.tete_de_serie) return -1;
                if (b.tete_de_serie) return 1;
                return b.niveau - a.niveau;
            });
            joueurs.forEach(function (j) {
                const estMoi = j.est_reel && j.player_id === Number(playerId);
                if (!estMoi) j.niveau = null;
            });
            // Liste d'attente : inscriptions reelles qui n'ont pas (ou plus) de ligne
            // confirmee dans tournoi_joueurs - affichees a part (fond rouge cote client),
            // triees par classement comme la priorite qui determine qui passe devant qui.
            const idsConfirmes = new Set(joueurs.filter(function (j) { return j.est_reel; }).map(function (j) { return j.player_id; }));
            const enAttente = db.prepare(`
                SELECT p.*
                FROM tournoi_liste_attente tla
                JOIN players p ON p.id = tla.player_id
                WHERE tla.calendrier_id = ? AND tla.semaine = ?
            `).all(calendrierId, semaineNum)
                .filter(function (w) { return !idsConfirmes.has(w.id); })
                .map(function (w) {
                    const estMoi = w.id === Number(playerId);
                    return {
                        nom: w.prenom + ' ' + w.nom, nationalite: w.nationalite, drapeau: drapeau(w.nationalite),
                        coachNom: nomCoach(w.user_id), player_id: w.id, est_reel: 1,
                        niveau: estMoi ? Math.round(niveauNormal(w, entree.surface)) : null,
                        rang: rangs.get('joueur:' + w.id) || null,
                        rangRace: rangsRace.get('joueur:' + w.id) || null
                    };
                })
                .sort(function (a, b) { return (a.rang || Infinity) - (b.rang || Infinity); });

            instance = Object.assign({}, instanceRow, { joueurs, enAttente });

            // Format poules (Masters de fin de saison) : le niveau brut reste
            // confidentiel (efface juste au-dessus pour tout le monde sauf "moi"), donc
            // le frontend ne peut pas reconstruire lui-meme la repartition en groupes
            // (basee sur le niveau) ni le classement de poule - on les calcule ici et on
            // envoie uniquement des noms/victoires/rang, jamais le niveau (demande
            // explicite de l'utilisateur, 2026-08-24 : les poules etaient invisibles
            // dans l'onglet Tableau, aussi bien avant que pendant/apres le tournoi).
            if (instanceRow.format === 'poules') {
                const groupes = groupesPoules(instanceRow.id);
                const groupeParId = new Map();
                groupes.A.forEach(function (j) { groupeParId.set(j.id, 'A'); });
                groupes.B.forEach(function (j) { groupeParId.set(j.id, 'B'); });
                joueurs.forEach(function (j) { j.groupe = groupeParId.get(j.id) || null; });

                function pourClientPoules(j) {
                    return {
                        id: j.id, nom: j.nom, drapeau: drapeau(j.nationalite),
                        est_reel: j.est_reel, player_id: j.player_id, rival_id: j.rival_id,
                        estMoi: !!(j.est_reel && j.player_id === Number(playerId))
                    };
                }

                // % de sets gagnes affiche a cote des victoires (demande explicite de
                // l'utilisateur, 2026-08-24) - c'est aussi le 4e critere de departage
                // officiel ATP/WTA Finals utilise par classementGroupe, cf. statsGroupePoules.
                function pourStandings(groupe) {
                    const stats = statsGroupePoules(instanceRow.id, groupe).stats;
                    return classementGroupe(instanceRow.id, groupe).map(function (j, i) {
                        const s = stats.get(j.id);
                        const totalSets = s.setsGagnes + s.setsPerdus;
                        return Object.assign(pourClientPoules(j), {
                            rang: i + 1, victoires: s.victoires,
                            pctSets: totalSets > 0 ? Math.round((s.setsGagnes / totalSets) * 100) : null
                        });
                    });
                }

                // Composition FIGEE des groupes (ordre du tirage, jamais re-triee) - sert au
                // frontend a reconstruire les 3 manches de poules (SCHEDULE_POULE_4) meme
                // avant qu'elles ne soient jouees. Le classement, lui, evolue avec les
                // resultats (regle officielle, cf. classementGroupe).
                instance.groupesPoules = { A: groupes.A.map(pourClientPoules), B: groupes.B.map(pourClientPoules) };
                instance.classementPoules = { A: pourStandings(groupes.A), B: pourStandings(groupes.B) };
            }

            const matchs = db.prepare(`
                SELECT tournoi_matchs.*,
                       j1.nom AS joueur1_nom, j1.nationalite AS joueur1_nationalite, j1.est_reel AS joueur1_est_reel,
                       j1.rival_id AS joueur1_rival_id, j1.player_id AS joueur1_player_id, j1.tete_de_serie AS joueur1_seed,
                       j2.nom AS joueur2_nom, j2.nationalite AS joueur2_nationalite, j2.est_reel AS joueur2_est_reel,
                       j2.rival_id AS joueur2_rival_id, j2.player_id AS joueur2_player_id, j2.tete_de_serie AS joueur2_seed,
                       vj.nom AS vainqueur_nom
                FROM tournoi_matchs
                JOIN tournoi_joueurs AS j1 ON j1.id = tournoi_matchs.joueur1_id
                LEFT JOIN tournoi_joueurs AS j2 ON j2.id = tournoi_matchs.joueur2_id
                LEFT JOIN tournoi_joueurs AS vj ON vj.id = tournoi_matchs.vainqueur_id
                WHERE tournoi_matchs.tournoi_id = ?
                ORDER BY tournoi_matchs.ordre
            `).all(instanceRow.id);
            matchs.forEach(function (m) {
                m.joueur1_drapeau = drapeau(m.joueur1_nationalite);
                m.joueur2_drapeau = drapeau(m.joueur2_nationalite);
                m.joueur1_rang = rangDe(rangs, m.joueur1_rival_id, m.joueur1_est_reel, m.joueur1_player_id);
                m.joueur2_rang = rangDe(rangs, m.joueur2_rival_id, m.joueur2_est_reel, m.joueur2_player_id);
                // Match reel-contre-reel : 2 lignes matchs distinctes existent (une par
                // coach), tournoi_matchs.match_id/match_id_j2 les relient toutes les deux.
                // On ne renvoie au client que celle qui appartient au joueur consulte (ou
                // rien s'il n'est implique dans ce match precis) - meme contrat qu'avant
                // pour le frontend (un seul champ m.match_id), aucun changement JS requis.
                const estMonMatch = m.joueur1_player_id === Number(playerId) || m.joueur2_player_id === Number(playerId);
                const aUnDeroulePublic = !!m.evenements || !!m.match_id || !!m.match_id_j2;
                if (m.joueur2_player_id === Number(playerId)) {
                    m.match_id = m.match_id_j2;
                } else if (m.joueur1_player_id !== Number(playerId)) {
                    m.match_id = null;
                }
                // Deroule complet (bots ou vrai joueur d'un AUTRE coach) : jamais envoye
                // tel quel ici (spoilerait le score des l'ouverture de l'onglet), seulement
                // un indicateur - le vrai contenu se recupere a la demande via
                // /api/tournois/match-bot/:id quand le coach clique un mode de visionnage.
                m.aReplayBot = !estMonMatch && aUnDeroulePublic;
                delete m.evenements;
            });
            instance.matchs = matchs;
        }

        const autreTournoiCetteSemaine = db.prepare(`
            SELECT 1 FROM tournoi_liste_attente WHERE semaine = ? AND player_id = ? AND calendrier_id != ?
        `).get(semaineNum, playerId, calendrierId);

        const peutInscrire = !estInscrit
            && semaineNum > etat.semaine_actuelle
            && semaineNum <= etat.semaine_actuelle + 5
            && (!instanceRow || instanceRow.statut === 'inscriptions')
            && !autreTournoiCetteSemaine
            && player.condition !== 'blesse'
            && player.points_energie >= 1;

        // Palmares = TOUS les vainqueurs des editions terminees de ce tournoi, que ce
        // joueur y ait participe ou non (comme "Tournois passes" sur tournois.html) -
        // avant, ne montrait QUE les propres resultats du joueur (jamais rien si
        // c'etait sa 1ere fois sur cette edition, meme si le tournoi a une longue
        // histoire), demande utilisateur 2026-08-21. semaine <= (pas <) pour que
        // l'edition qu'on est justement en train de consulter apparaisse des qu'elle
        // passe a statut='termine', sans attendre la prochaine saison.
        const palmares = db.prepare(`
            SELECT tournois.id, tournois.semaine, tournois.categorie, tournois.surface,
                   vainqueur_j.nom AS nom_vainqueur, vainqueur_j.nationalite AS vainqueur_nationalite
            FROM tournois
            LEFT JOIN tournoi_joueurs AS vainqueur_j
                ON vainqueur_j.tournoi_id = tournois.id AND vainqueur_j.tour_elimine = 'Vainqueur'
            WHERE tournois.calendrier_id = ? AND tournois.statut = 'termine' AND tournois.semaine <= ?
            ORDER BY tournois.semaine DESC
        `).all(calendrierId, semaineNum);
        const mesResultatsParTournoi = db.prepare('SELECT tour_elimine, points_gagnes FROM tournoi_joueurs WHERE tournoi_id = ? AND player_id = ? AND est_reel = 1');
        palmares.forEach(function (p) {
            p.positionSemaine = positionSemaineAffichee(p.semaine);
            p.numeroSaison = phaseAffichee(p.semaine).numeroSaison;
            p.drapeauVainqueur = drapeau(p.vainqueur_nationalite);
            const monResultat = mesResultatsParTournoi.get(p.id, playerId);
            p.participe = !!monResultat;
            p.tourElimineJoueur = monResultat ? monResultat.tour_elimine : null;
            p.pointsGagnesJoueur = monResultat ? monResultat.points_gagnes : null;
        });

        res.json({
            success: true,
            info: Object.assign({}, entree, { baremePoints: bareme, paysDrapeau: drapeau(entree.pays) }),
            semaine: semaineNum,
            estInscrit,
            peutInscrire,
            joueurCondition: player.condition,
            joueurPointsEnergie: player.points_energie,
            instance,
            palmares
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Vue d'ensemble "Accueil" : TOUS les tournois actuellement en cours de
// deroulement (tableau deja tire, pas encore termine) sur les deux circuits -
// pas seulement ceux ou le coach a un personnage engage. Un "(Toi)" est ajoute
// sur les tournois ou l'un de ses 2 personnages a une inscription reelle.
function estMoiDansTournoi(tournoiId, userId) {
    return !!db.prepare(`
        SELECT 1 FROM tournoi_joueurs tj
        JOIN players p ON p.id = tj.player_id
        WHERE tj.tournoi_id = ? AND tj.est_reel = 1 AND p.user_id = ?
    `).get(tournoiId, userId);
}

// "Tournois de la semaine" (ex "Tournois en cours", renomme 2026-08-21) : tous les
// tournois dont la semaine du calendrier couvre la semaine ingame actuelle, MEME
// s'ils sont deja 'termine' - avant, un tournoi disparaissait de l'accueil des
// qu'il se terminait, souvent avant meme la fin de la semaine reelle (bug/demande
// utilisateur). Le "termine" gagne desormais un etat dedie plutot que le texte
// "En cours" errone qu'il aurait recu sinon. taille = duree du calendrier (1 ou 2
// semaines) pour couvrir les tournois a cheval sur 2 semaines ingame.
function tournoisDeLaSemaine(semaineActuelle) {
    const lignes = db.prepare("SELECT * FROM tournois WHERE statut != 'inscriptions' ORDER BY semaine ASC, circuit ASC").all();
    return lignes.filter(function (t) {
        const entree = CALENDRIER_TOURNOIS.find(function (e) { return e.id === t.calendrier_id; });
        const duree = entree ? entree.duree : 1;
        return t.semaine <= semaineActuelle && semaineActuelle < t.semaine + duree;
    });
}

function etatTournoiAccueil(t) {
    if (t.statut === 'termine') return 'Terminé';
    if (t.tour_actuel === 0) return 'Tableau tiré — pas encore commencé';
    const labels = calculerLabelsTours(t.taille_tableau, t.format);
    return 'En cours — prochain tour : ' + (labels[t.tour_actuel] || 'tour final');
}

app.get('/api/accueil/tournois-en-cours/:userId', (req, res) => {
    try {
        const userId = req.userId;
        const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;

        const tournois = tournoisDeLaSemaine(semaineActuelle).map(function (t) {
            return {
                nom: t.nom, circuit: t.circuit, categorie: t.categorie, etat: etatTournoiAccueil(t),
                estMoi: estMoiDansTournoi(t.id, userId),
                calendrierId: t.calendrier_id, semaine: t.semaine
            };
        });

        res.json({ success: true, tournois });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Versions publiques (page d'accueil avant connexion) des deux blocs ci-dessus :
// memes donnees globales, sans aucune notion de coach ("estMoi" / classement
// d'un userId precis) puisqu'aucun visiteur n'est identifie a ce stade.
app.get('/api/public/tournois-en-cours', (req, res) => {
    try {
        const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;

        const tournois = tournoisDeLaSemaine(semaineActuelle).map(function (t) {
            return { nom: t.nom, circuit: t.circuit, categorie: t.categorie, etat: etatTournoiAccueil(t) };
        });

        res.json({ success: true, tournois });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/public/classement', (req, res) => {
    try {
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const semaineActuelle = etat.semaine_actuelle;

        function top5(circuit) {
            return calculerClassementGlobal(circuit, semaineActuelle - FENETRE_LIVE, semaineActuelle)
                .slice(0, 5)
                .map(function (c, i) {
                    return { rang: i + 1, nom: c.nom, drapeau: c.drapeau, points: c.points };
                });
        }

        res.json({ success: true, atp: top5('ATP'), wta: top5('WTA') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Classement NATION public (classements.html) = meme logique que le seeding reel
// de la Coupe Davis/Fed Cup (cf. classementNationsTop4) : cumul des points Live des
// 4 meilleurs joueurs de la nation, calcule circuit par circuit puis additionne.
// circuits = ['ATP'], ['WTA'] ou ['ATP','WTA'] pour la version combinee (onglet Coach).
function classementNationsSomme(circuits) {
    // Meme precaution que dans classementNationsTop4 : fusionner ATP et WTA sur une
    // cle normalisee, sinon "Coree du Sud" (cote ATP) et "Corée du Sud" (cote WTA)
    // resteraient deux lignes distinctes au lieu de s'additionner.
    const parNation = new Map();
    circuits.forEach(function (circuit) {
        classementNationsTop4(circuit).forEach(function (points, nation) {
            const cle = normaliserPays(nation);
            const existant = parNation.get(cle) || { total: 0, libelle: nation };
            existant.total += points;
            parNation.set(cle, existant);
        });
    });
    const cles = Array.from(parNation.keys()).sort(function (a, b) { return parNation.get(b).total - parNation.get(a).total; });
    return cles.map(function (cle, i) {
        const v = parNation.get(cle);
        return { rang: i + 1, nation: v.libelle, drapeau: drapeau(v.libelle), points: v.total };
    });
}

// Classement COACH = somme des points (Live ou Race) des DEUX personnages (ATP +
// WTA) d'un meme coach - un coach sans l'un des deux personnages est quand meme
// classe, sur la seule somme de celui qu'il a.
function classementCoachSomme(circuits, semaineMin, semaineActuelle, monUserId) {
    // Par coach : points cumules + le joueur ATP et la joueuse WTA eux-memes (nom +
    // drapeau), pour que l'affichage puisse montrer "Coach (drapeau Joueur - drapeau
    // Joueuse)" plutot que le seul pseudo du coach.
    const parCoach = new Map();
    circuits.forEach(function (circuit) {
        calculerClassementGlobal(circuit, semaineMin, semaineActuelle).forEach(function (c) {
            if (!c.userId) return; // ignore les rivaux, un "coach" a toujours un vrai compte
            if (!parCoach.has(c.userId)) parCoach.set(c.userId, { points: 0, atp: null, wta: null });
            const entree = parCoach.get(c.userId);
            entree.points += c.points;
            entree[circuit === 'ATP' ? 'atp' : 'wta'] = { nom: c.nom, drapeau: c.drapeau };
        });
    });
    return Array.from(parCoach.keys())
        .sort(function (a, b) { return parCoach.get(b).points - parCoach.get(a).points; })
        .map(function (uid) {
            const entree = parCoach.get(uid);
            return { userId: uid, nom: nomCoach(uid), points: entree.points, estMoi: Number(uid) === Number(monUserId), joueurAtp: entree.atp, joueurWta: entree.wta };
        });
}

// Detail tournoi par tournoi des points comptes pour une ligne de classement
// (Live ou Race), affiche derriere le "?" a cote du total sur classements.html.
// Deux facons d'identifier la ligne : `cle` (rival:X ou joueur:X, pour les
// onglets ATP/WTA individuels) ou `userId` (pour l'onglet Coach, qui cumule le
// joueur ATP et la joueuse WTA d'un meme compte). DOIT rester declaree AVANT
// /api/classement/:userId ci-dessous : Express matche dans l'ordre de
// declaration, un ":userId" plus haut aurait intercepte "/detail" en le prenant
// pour une valeur d'userId (bug trouve en prod, la fenetre restait bloquee sur
// "Chargement..." indefiniment).
app.get('/api/classement/detail', (req, res) => {
    try {
        const { cle, userId: userIdParam, type } = req.query;
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const semaineActuelle = etat.semaine_actuelle;
        const positionSaisonBrute = ((semaineActuelle - 1) % LONGUEUR_SAISON) + 1;
        const debutSaison = semaineActuelle - positionSaisonBrute + 2;
        const semaineMin = type === 'race' ? debutSaison : semaineActuelle - FENETRE_LIVE;

        let condition, params;
        if (cle && cle.indexOf('rival:') === 0) {
            condition = 'tj.rival_id = ?';
            params = [cle.slice(6)];
        } else if (cle && cle.indexOf('joueur:') === 0) {
            condition = '(tj.player_id = ? AND tj.est_reel = 1)';
            params = [cle.slice(7)];
        } else if (userIdParam) {
            const joueurs = db.prepare("SELECT id FROM players WHERE user_id = ? AND statut = 'valide'").all(userIdParam);
            if (joueurs.length === 0) {
                return res.json({ success: true, detail: [], total: 0 });
            }
            const placeholders = joueurs.map(function () { return '?'; }).join(',');
            condition = '(tj.player_id IN (' + placeholders + ') AND tj.est_reel = 1)';
            params = joueurs.map(function (j) { return j.id; });
        } else {
            return res.status(400).json({ error: 'Parametre cle ou userId requis.' });
        }

        const lignes = db.prepare(`
            SELECT tournois.nom, tournois.circuit, tournois.semaine, tj.tour_elimine, tj.points_gagnes
            FROM tournoi_joueurs tj
            JOIN tournois ON tournois.id = tj.tournoi_id
            WHERE ${condition} AND tournois.semaine > ? AND tournois.semaine <= ? AND tournois.statut = 'termine'
            ORDER BY tournois.semaine DESC
        `).all(...params, semaineMin, semaineActuelle);

        lignes.forEach(function (l) { l.positionSemaine = positionSemaineAffichee(l.semaine); });
        const total = lignes.reduce(function (s, l) { return s + (l.points_gagnes || 0); }, 0);

        res.json({ success: true, detail: lignes, total });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/classement/:userId', (req, res) => {
    try {
        const userId = req.userId;
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const semaineActuelle = etat.semaine_actuelle;
        // Debut de saison = fin de la Semaine 0 en cours (borne exclue : la Race ne
        // compte que les points marques a partir de S1). Pendant la Pre-saison/S0
        // elle-meme, cette borne tombe dans le futur -> Race a 0 partout, voulu.
        const positionSaisonBrute = ((semaineActuelle - 1) % LONGUEUR_SAISON) + 1;
        const debutSaison = semaineActuelle - positionSaisonBrute + 2;

        res.json({
            success: true,
            atp: { live: classementPartage('ATP', semaineActuelle - FENETRE_LIVE, semaineActuelle, userId), race: classementPartage('ATP', debutSaison, semaineActuelle, userId) },
            wta: { live: classementPartage('WTA', semaineActuelle - FENETRE_LIVE, semaineActuelle, userId), race: classementPartage('WTA', debutSaison, semaineActuelle, userId) },
            coach: {
                live: classementCoachSomme(['ATP', 'WTA'], semaineActuelle - FENETRE_LIVE, semaineActuelle, userId),
                race: classementCoachSomme(['ATP', 'WTA'], debutSaison, semaineActuelle, userId)
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// circuit = ATP, WTA ou COMBINE (somme des deux, utilisee par l'onglet Coach).
app.get('/api/classement/nations/:circuit', (req, res) => {
    try {
        const param = req.params.circuit;
        const circuits = param === 'WTA' ? ['WTA'] : (param === 'COMBINE' ? ['ATP', 'WTA'] : ['ATP']);
        res.json({ success: true, classement: classementNationsSomme(circuits) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Annuaire : joueurs valides d'un circuit tries par nation puis par classement Live
// decroissant a l'interieur de la nation (jamais Race, qui retombe a 0 pendant
// chaque Pre-saison/Semaine 0 - peu adapte a un annuaire consultable en permanence).
app.get('/api/annuaire/joueurs/:circuit', (req, res) => {
    try {
        const circuit = req.params.circuit === 'WTA' ? 'WTA' : 'ATP';
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const semaineActuelle = etat.semaine_actuelle;

        const classement = calculerClassementGlobal(circuit, semaineActuelle - FENETRE_LIVE, semaineActuelle)
            .filter(function (c) { return c.playerId !== null; });

        // Brassard de capitaine (emoji) affiche dans l'annuaire pour les joueurs
        // designes capitaines de leur nation cette saison - demande explicite de
        // l'utilisateur, 2026-08-24. Un seul SELECT groupe plutot qu'une requete par
        // joueur.
        const saison = nombreSaisonAffichee();
        const capitainesSet = new Set(
            db.prepare('SELECT player_id FROM coupe_capitaines WHERE saison = ? AND circuit = ?').all(saison, circuit)
                .map(function (r) { return r.player_id; })
        );

        const joueurs = classement.map(function (c) {
            return {
                playerId: c.playerId, prenom: c.prenom, nom: c.nomFamille,
                nationalite: c.nationalite, drapeau: c.drapeau, points: c.points,
                coachNom: nomCoach(c.userId), coachUserId: c.userId,
                estCapitaine: capitainesSet.has(c.playerId)
            };
        });

        joueurs.sort(function (a, b) {
            if (a.nationalite !== b.nationalite) return (a.nationalite || '').localeCompare(b.nationalite || '');
            return b.points - a.points;
        });

        res.json({ success: true, joueurs });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Annuaire : tous les coachs (au moins un personnage valide), tries par ordre
// alphabetique de leur pseudo (users.pseudo).
app.get('/api/annuaire/coachs', (req, res) => {
    try {
        const userIds = db.prepare("SELECT DISTINCT user_id FROM players WHERE statut = 'valide'").all()
            .map(function (r) { return r.user_id; });

        const coachs = userIds.map(function (userId) {
            const joueur = db.prepare("SELECT * FROM players WHERE user_id = ? AND type = 'joueur'").get(userId);
            const joueuse = db.prepare("SELECT * FROM players WHERE user_id = ? AND type = 'joueuse'").get(userId);
            return {
                userId: userId,
                nomTri: nomCoach(userId),
                joueur: joueur ? { id: joueur.id, prenom: joueur.prenom, nom: joueur.nom, nationalite: joueur.nationalite, drapeau: drapeau(joueur.nationalite), statut: joueur.statut } : null,
                joueuse: joueuse ? { id: joueuse.id, prenom: joueuse.prenom, nom: joueuse.nom, nationalite: joueuse.nationalite, drapeau: drapeau(joueuse.nationalite), statut: joueuse.statut } : null
            };
        });

        coachs.sort(function (a, b) { return a.nomTri.localeCompare(b.nomTri); });

        res.json({ success: true, coachs });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/pronostics/disponibles/:userId', (req, res) => {
    try {
        const userId = req.userId;
        const tournois = db.prepare(`
            SELECT tournois.id, tournois.calendrier_id, tournois.nom, tournois.circuit, tournois.categorie, tournois.semaine,
                   pronostics.id AS pronostic_id
            FROM tournois
            LEFT JOIN pronostics ON pronostics.tournoi_id = tournois.id AND pronostics.user_id = ?
            WHERE tournois.statut = 'a_venir'
            ORDER BY tournois.semaine, tournois.nom
        `).all(userId);
        tournois.forEach(function (t) {
            t.dejaPronostique = !!t.pronostic_id;
            t.type = typePronostic(t);
            delete t.pronostic_id;
        });
        res.json({ success: true, tournois });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/pronostics/tournoi/:tournoiId', (req, res) => {
    try {
        const { tournoiId } = req.params;
        const userId = req.userId;

        const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
        if (!tournoi) {
            return res.status(404).json({ error: 'Tournoi introuvable.' });
        }

        const entrants = db.prepare('SELECT * FROM tournoi_joueurs WHERE tournoi_id = ? ORDER BY position_tableau').all(tournoiId);
        entrants.forEach(function (e) { e.drapeau = drapeau(e.nationalite); });

        let taillePuissance2 = 1;
        while (taillePuissance2 < tournoi.taille_tableau) taillePuissance2 *= 2;

        const type = typePronostic(tournoi);

        let pronosticActuel = null;
        if (userId) {
            const ligne = db.prepare('SELECT predictions, points_gagnes FROM pronostics WHERE tournoi_id = ? AND user_id = ?').get(tournoiId, userId);
            if (ligne) {
                let predictions = null;
                try { predictions = JSON.parse(ligne.predictions); } catch (e) { predictions = null; }
                pronosticActuel = { predictions, pointsGagnes: ligne.points_gagnes };
            }
        }

        // Meme regle que /api/pronostics (POST) : verrouille des que la semaine du
        // tournoi a commence, pas seulement une fois entierement termine.
        const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;
        const verrouille = tournoi.statut !== 'a_venir' || semaineActuelle >= tournoi.semaine;

        res.json({
            success: true,
            tournoi: { id: tournoi.id, nom: tournoi.nom, circuit: tournoi.circuit, categorie: tournoi.categorie, statut: tournoi.statut, semaine: tournoi.semaine },
            verrouille,
            type,
            entrants: type === 'simple' ? reelsOuTousSiVide(entrants.filter(function (e) { return e.nom !== 'BYE'; })) : null,
            tranchesHuitiemes: type === 'cascade' ? trancheHuitiemes(entrants, taillePuissance2) : null,
            pronosticActuel
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/pronostics', (req, res) => {
    try {
        const userId = req.userId;
        const { tournoiId, predictions } = req.body;

        const tournoi = db.prepare('SELECT * FROM tournois WHERE id = ?').get(tournoiId);
        if (!tournoi) {
            return res.status(404).json({ error: 'Tournoi introuvable.' });
        }
        // tournois.statut ne repasse a 'termine' qu'une fois TOUS les tours joues -
        // il reste 'a_venir' pendant toute la duree du tournoi (tour_actuel avance
        // de 0 a la fin sans jamais changer le statut), donc se fier uniquement au
        // statut laissait les pronostics modifiables jusqu'a la toute fin du
        // tournoi au lieu de son debut (bug signale par l'utilisateur, 2026-08-20).
        // Bloque desormais des que la semaine du tournoi a commence, meme regle que
        // les styles de jeu.
        const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;
        if (tournoi.statut !== 'a_venir' || semaineActuelle >= tournoi.semaine) {
            return res.status(400).json({ error: 'Les pronostics ne sont plus modifiables pour ce tournoi (tableau pas encore tire, ou tournoi deja commence).' });
        }

        const type = typePronostic(tournoi);
        const entrants = db.prepare('SELECT id, nom, position_tableau FROM tournoi_joueurs WHERE tournoi_id = ? ORDER BY position_tableau').all(tournoiId);

        if (type === 'simple') {
            if (!predictions || typeof predictions.vainqueur !== 'number') {
                return res.status(400).json({ error: 'Pronostic invalide.' });
            }
            const cible = entrants.find(function (e) { return e.id === predictions.vainqueur; });
            if (!cible || cible.nom === 'BYE') {
                return res.status(400).json({ error: 'Joueur pronostique introuvable dans ce tableau.' });
            }
        } else {
            let taillePuissance2 = 1;
            while (taillePuissance2 < tournoi.taille_tableau) taillePuissance2 *= 2;
            const tranches = trancheHuitiemes(entrants, taillePuissance2);
            if (!predictions || !validerCascade(predictions, tranches)) {
                return res.status(400).json({ error: 'Pronostic incoherent - verifie que chaque tour ne reprend que tes propres choix du tour precedent.' });
            }
        }

        db.prepare(`
            INSERT INTO pronostics (user_id, tournoi_id, predictions) VALUES (?, ?, ?)
            ON CONFLICT(user_id, tournoi_id) DO UPDATE SET predictions = excluded.predictions
        `).run(userId, tournoiId, JSON.stringify(predictions));

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Classement des coachs par points de pronostics cumules (pas un classement de
// joueurs de tennis) - le nom affiche pour chaque coach reprend celui de son
// personnage reel sur le circuit concerne, jamais son email (coherent avec le
// reste du jeu, ou personne n'expose son adresse aux autres coachs).
function classementPronosParCircuit(circuit) {
    return db.prepare(`
        SELECT p.user_id, SUM(p.points_gagnes) AS points
        FROM pronostics p
        JOIN tournois t ON t.id = p.tournoi_id
        WHERE p.points_gagnes IS NOT NULL AND t.circuit = ?
        GROUP BY p.user_id
        ORDER BY points DESC
    `).all(circuit);
}

function classementPronosCombine() {
    return db.prepare(`
        SELECT p.user_id, SUM(p.points_gagnes) AS points
        FROM pronostics p
        WHERE p.points_gagnes IS NOT NULL
        GROUP BY p.user_id
        ORDER BY points DESC
    `).all();
}

// Normalise une casse "Prenom" (premiere lettre de chaque mot en majuscule, le
// reste en minuscule) - meme regle que formaterNom() cote frontend (dupliquee la-
// bas faute de fichier JS partage), appliquee ici aux pseudos de coach.
function capitaliserPrenom(texte) {
    return (texte || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, function (c) { return c.toUpperCase(); });
}

// Identite d'un coach = son pseudo (users.pseudo, obligatoire a l'inscription) -
// jamais le nom de l'un de ses personnages, qui n'a rien a voir avec le coach lui-
// meme. Independant du circuit desormais (un seul pseudo par compte), le fallback
// "Coach #id" ne sert que pour les comptes crees avant l'ajout de ce champ.
function nomCoach(userId) {
    const user = db.prepare('SELECT pseudo FROM users WHERE id = ?').get(userId);
    return user && user.pseudo ? capitaliserPrenom(user.pseudo) : ('Coach #' + userId);
}

app.get('/api/pronostics/classement/:userId', (req, res) => {
    try {
        const userId = req.userId;
        const atp = classementPronosParCircuit('ATP').map(function (r) {
            return { userId: r.user_id, nom: nomCoach(r.user_id), points: r.points, estMoi: Number(r.user_id) === Number(userId) };
        });
        const wta = classementPronosParCircuit('WTA').map(function (r) {
            return { userId: r.user_id, nom: nomCoach(r.user_id), points: r.points, estMoi: Number(r.user_id) === Number(userId) };
        });
        const combine = classementPronosCombine().map(function (r) {
            return { userId: r.user_id, nom: nomCoach(r.user_id), points: r.points, estMoi: Number(r.user_id) === Number(userId) };
        });
        res.json({ success: true, atp, wta, combine });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Classement Pronos decoupe par SAISON AFFICHEE (contrairement a
// classementPronosParCircuit/classementPronosCombine, qui cumulent tout depuis
// toujours) : { [numeroSaison]: { [user_id]: points } }. circuit = null pour le
// classement Combine.
function classementPronosParSaison(circuit) {
    const rows = circuit
        ? db.prepare(`SELECT p.user_id, p.points_gagnes, t.semaine FROM pronostics p JOIN tournois t ON t.id = p.tournoi_id WHERE p.points_gagnes IS NOT NULL AND t.circuit = ?`).all(circuit)
        : db.prepare(`SELECT p.user_id, p.points_gagnes, t.semaine FROM pronostics p JOIN tournois t ON t.id = p.tournoi_id WHERE p.points_gagnes IS NOT NULL`).all();

    const parSaison = {};
    rows.forEach(function (r) {
        const saison = phaseAffichee(r.semaine).numeroSaison;
        if (!parSaison[saison]) parSaison[saison] = {};
        parSaison[saison][r.user_id] = (parSaison[saison][r.user_id] || 0) + r.points_gagnes;
    });
    return parSaison;
}

// Historique du classement Pronos d'UN coach, saison par saison : rang + points
// pour chaque saison ou il a au moins un point marque (la saison en cours est
// marquee `enCours`, son rang/points ne sont pas encore definitifs).
function historiquePronosCoach(userId, circuit) {
    const parSaison = classementPronosParSaison(circuit);
    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const saisonActuelle = phaseAffichee(etat.semaine_actuelle).numeroSaison;

    return Object.keys(parSaison)
        .map(function (s) { return Number(s); })
        .sort(function (a, b) { return a - b; })
        .map(function (saison) {
            const points = parSaison[saison];
            const classement = Object.keys(points)
                .map(function (uid) { return { userId: Number(uid), points: points[uid] }; })
                .sort(function (a, b) { return b.points - a.points; });
            const rang = classement.findIndex(function (c) { return c.userId === Number(userId); }) + 1;
            if (rang === 0) return null;
            return { saison, rang, points: points[userId], enCours: saison === saisonActuelle };
        })
        .filter(function (r) { return r !== null; });
}

// ---------- Fiche coach ----------

// Palmares COMBINE des 2 personnages d'un coach (contrairement au palmares d'un
// seul joueur sur adversaire.html) - chaque ligne precise quel personnage a
// remporte le titre (`joueurType`), tries par semaine desc comme le palmares joueur.
function palmaresCoach(joueurId, joueuseId) {
    const ids = [joueurId, joueuseId].filter(function (id) { return id; });
    if (ids.length === 0) return [];
    const placeholders = ids.map(function () { return '?'; }).join(',');
    const rows = db.prepare(`
        SELECT tournois.nom, tournois.semaine, tournois.categorie, tournois.surface,
               players.type AS joueurType, players.prenom AS joueurPrenom, players.nom AS joueurNom
        FROM tournoi_joueurs tj
        JOIN tournois ON tournois.id = tj.tournoi_id
        JOIN players ON players.id = tj.player_id
        WHERE tj.player_id IN (${placeholders}) AND tj.est_reel = 1 AND tj.tour_elimine = 'Vainqueur'
        ORDER BY tournois.semaine DESC
    `).all(...ids);
    rows.forEach(function (r) { r.positionSemaine = positionSemaineAffichee(r.semaine); });
    return rows;
}

app.get('/api/coach/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const user = db.prepare('SELECT id, pseudo, discord FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'Coach introuvable.' });
        }

        const joueur = db.prepare("SELECT id, prenom, nom, nationalite, statut FROM players WHERE user_id = ? AND type = 'joueur'").get(userId);
        const joueuse = db.prepare("SELECT id, prenom, nom, nationalite, statut FROM players WHERE user_id = ? AND type = 'joueuse'").get(userId);

        res.json({
            success: true,
            userId: user.id,
            pseudo: nomCoach(user.id),
            discord: user.discord || null,
            joueur: joueur ? { id: joueur.id, prenom: joueur.prenom, nom: joueur.nom, nationalite: joueur.nationalite, drapeau: drapeau(joueur.nationalite), statut: joueur.statut } : null,
            joueuse: joueuse ? { id: joueuse.id, prenom: joueuse.prenom, nom: joueuse.nom, nationalite: joueuse.nationalite, drapeau: drapeau(joueuse.nationalite), statut: joueuse.statut } : null,
            palmares: palmaresCoach(joueur ? joueur.id : null, joueuse ? joueuse.id : null),
            pronosHistorique: {
                atp: historiquePronosCoach(userId, 'ATP'),
                wta: historiquePronosCoach(userId, 'WTA'),
                combine: historiquePronosCoach(userId, null)
            },
            badges: calculerBadgesCoach(userId)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Edition du profil coach (pseudo + lien Discord) - identite prise depuis la
// session (req.userId), jamais depuis une valeur envoyee par le client.
app.post('/api/coach/profil', (req, res) => {
    try {
        const { pseudo, discord } = req.body;
        const pseudoNettoye = (pseudo || '').trim();
        if (!pseudoNettoye) {
            return res.status(400).json({ error: 'Le pseudo de coach est obligatoire.' });
        }
        const discordNettoye = (discord || '').trim() || null;
        db.prepare('UPDATE users SET pseudo = ?, discord = ? WHERE id = ?').run(pseudoNettoye, discordNettoye, req.userId);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// V/D global, par surface et par "saison" (meme decoupage 52 semaines que le Race
// des classements, pas de vrai calendrier dans ce jeu) a partir d'une liste uniforme
// de { surface, semaine, victoire (bool) } - alimentee differemment selon que
// l'adversaire est un vrai joueur (table matchs) ou un rival (tournoi_matchs).
function calculerStatsVD(rows) {
    const global = { victoires: 0, defaites: 0 };
    const parSurface = {};
    const parSaison = {};
    rows.forEach(function (r) {
        global[r.victoire ? 'victoires' : 'defaites']++;
        if (!parSurface[r.surface]) parSurface[r.surface] = { victoires: 0, defaites: 0 };
        parSurface[r.surface][r.victoire ? 'victoires' : 'defaites']++;
        const saison = phaseAffichee(r.semaine).numeroSaison;
        if (!parSaison[saison]) parSaison[saison] = { victoires: 0, defaites: 0 };
        parSaison[saison][r.victoire ? 'victoires' : 'defaites']++;
    });
    return { global, parSurface, parSaison };
}

// Face-a-face : lignes tournoi_matchs (seule table qui connait l'identite des DEUX
// cotes d'un match, contrairement a `matchs`) ou l'un des cotes est mon joueur
// (player_id = monPlayerId, est_reel = 1) - fonctionne pareil que l'autre cote soit
// un vrai joueur ou un rival, la condition specifique a chaque cas est dans la
// requete SQL appelante, pas ici.
function calculerFaceAFace(rows, monPlayerId) {
    const parSurface = {};
    const parSaison = {};
    let victoires = 0, defaites = 0;
    rows.forEach(function (r) {
        const monCoteId = (r.j1_player_id === Number(monPlayerId) && r.j1_est_reel) ? r.j1_id : r.j2_id;
        const jaiGagne = r.vainqueur_id === monCoteId;
        if (jaiGagne) victoires++; else defaites++;
        if (!parSurface[r.surface]) parSurface[r.surface] = { victoires: 0, defaites: 0 };
        parSurface[r.surface][jaiGagne ? 'victoires' : 'defaites']++;
        const saison = phaseAffichee(r.semaine).numeroSaison;
        if (!parSaison[saison]) parSaison[saison] = { victoires: 0, defaites: 0 };
        parSaison[saison][jaiGagne ? 'victoires' : 'defaites']++;
    });
    return { nbConfrontations: rows.length, victoires, defaites, parSurface, parSaison };
}

app.get('/api/adversaire/reel/:playerId', (req, res) => {
    try {
        const { playerId } = req.params;
        const { monUserId } = req.query;

        const adversaire = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
        if (!adversaire) {
            return res.status(404).json({ error: 'Joueur introuvable.' });
        }

        const circuitAdversaire = adversaire.type === 'joueur' ? 'ATP' : 'WTA';
        const cleAdversaire = 'joueur:' + adversaire.id;
        const infos = {
            prenom: adversaire.prenom, nom: adversaire.nom, age: adversaire.age, taille: adversaire.taille,
            nationalite: adversaire.nationalite, drapeau: drapeau(adversaire.nationalite),
            main_forte: adversaire.main_forte, type: adversaire.type,
            circuit: circuitAdversaire,
            classement: calculerRangsLiveGlobal(circuitAdversaire).get(cleAdversaire) || null,
            meilleurClassement: meilleurClassement(circuitAdversaire, cleAdversaire),
            coachUserId: adversaire.user_id, coachNom: nomCoach(adversaire.user_id),
            photoAvatar: adversaire.photo_avatar
        };

        const palmares = db.prepare(`
            SELECT tournois.nom, tournois.semaine, tournois.categorie, tournois.surface
            FROM tournoi_joueurs tj
            JOIN tournois ON tournois.id = tj.tournoi_id
            WHERE tj.player_id = ? AND tj.est_reel = 1 AND tj.tour_elimine = 'Vainqueur'
            ORDER BY tournois.semaine DESC
        `).all(playerId);
        palmares.forEach(function (p) { p.positionSemaine = positionSemaineAffichee(p.semaine); });

        const matchsBruts = db.prepare(`
            SELECT matchs.id, matchs.surface, matchs.semaine, matchs.vainqueur, matchs.score, matchs.tournoi_id, matchs.numero_tour, matchs.kine_intervenu,
                   tournois.nom AS tournoi_nom, tournois.calendrier_id AS tournoi_calendrier_id, tournois.categorie AS tournoi_categorie,
                   tj1.player_id AS tj1_player_id, tj1.rival_id AS tj1_rival_id, tj1.nom AS tj1_nom, tj1.nationalite AS tj1_nationalite,
                   tj2.player_id AS tj2_player_id, tj2.rival_id AS tj2_rival_id, tj2.nom AS tj2_nom, tj2.nationalite AS tj2_nationalite
            FROM matchs
            LEFT JOIN tournois ON tournois.id = matchs.tournoi_id
            LEFT JOIN tournoi_matchs AS tm ON tm.match_id = matchs.id OR tm.match_id_j2 = matchs.id
            LEFT JOIN tournoi_joueurs AS tj1 ON tj1.id = tm.joueur1_id
            LEFT JOIN tournoi_joueurs AS tj2 ON tj2.id = tm.joueur2_id
            WHERE matchs.player_id = ?
            ORDER BY matchs.id DESC
        `).all(playerId);
        matchsBruts.forEach(function (m) {
            if (!m.tournoi_id) return;
            const jeSuisTj1 = m.tj1_player_id === Number(playerId);
            m.adversaire_nom = jeSuisTj1 ? m.tj2_nom : m.tj1_nom;
            m.adversaire_nationalite = jeSuisTj1 ? m.tj2_nationalite : m.tj1_nationalite;
            const adversairePlayerId = jeSuisTj1 ? m.tj2_player_id : m.tj1_player_id;
            const adversaireRivalId = jeSuisTj1 ? m.tj2_rival_id : m.tj1_rival_id;
            const adversaireCle = adversairePlayerId ? ('joueur:' + adversairePlayerId) : (adversaireRivalId ? ('rival:' + adversaireRivalId) : null);
            m.adversaire_classement = classementALaSemaine(circuitAdversaire, adversaireCle, m.semaine);
            m.adversaire_player_id = adversairePlayerId;
            m.adversaire_rival_id = adversaireRivalId;
        });

        // "Derniers matchs" n'est plus plafonne a 20 : tous les matchs de la SAISON
        // demandee (`?saison=N`, saison affichee courante par defaut) sont renvoyes.
        // `saisonsDisponibles` liste les saisons ou ce joueur a au moins un match, pour
        // alimenter le selecteur cote client.
        const etatSemaine = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const saisonCourante = phaseAffichee(etatSemaine.semaine_actuelle).numeroSaison;
        const saisonsDisponibles = Array.from(new Set(matchsBruts.map(function (m) { return phaseAffichee(m.semaine).numeroSaison; })))
            .sort(function (a, b) { return b - a; });
        const saisonAffichee = req.query.saison ? Number(req.query.saison) : saisonCourante;

        const derniersMatchs = matchsBruts
            .filter(function (m) { return phaseAffichee(m.semaine).numeroSaison === saisonAffichee; })
            .map(function (m) {
                return {
                    matchId: m.id, surface: m.surface, semaine: m.semaine, positionSemaine: positionSemaineAffichee(m.semaine),
                    victoire: m.vainqueur === 'joueur', score: m.score, tournoi: !!m.tournoi_id, numeroTour: m.numero_tour,
                    kineIntervenu: !!m.kine_intervenu,
                    tournoiId: m.tournoi_id, tournoiNom: m.tournoi_nom, tournoiCalendrierId: m.tournoi_calendrier_id, categorie: m.tournoi_categorie,
                    adversaireNom: m.adversaire_nom || null, adversaireDrapeau: drapeau(m.adversaire_nationalite),
                    adversaireClassement: m.adversaire_classement || null,
                    adversairePlayerId: m.adversaire_player_id || null, adversaireRivalId: m.adversaire_rival_id || null
                };
            });

        const stats = calculerStatsVD(matchsBruts.map(function (m) { return { surface: m.surface, semaine: m.semaine, victoire: m.vainqueur === 'joueur' }; }));

        let faceAFace = { nbConfrontations: 0, victoires: 0, defaites: 0, parSurface: {}, parSaison: {} };
        if (monUserId) {
            const monJoueur = db.prepare('SELECT id FROM players WHERE user_id = ? AND type = ?').get(monUserId, adversaire.type);
            if (monJoueur) {
                const confrontations = db.prepare(`
                    SELECT tm.vainqueur_id, t.surface, t.semaine,
                           j1.id AS j1_id, j1.player_id AS j1_player_id, j1.est_reel AS j1_est_reel,
                           j2.id AS j2_id, j2.player_id AS j2_player_id, j2.est_reel AS j2_est_reel
                    FROM tournoi_matchs tm
                    JOIN tournoi_joueurs j1 ON j1.id = tm.joueur1_id
                    JOIN tournoi_joueurs j2 ON j2.id = tm.joueur2_id
                    JOIN tournois t ON t.id = tm.tournoi_id
                    WHERE (j1.player_id = ? AND j1.est_reel = 1 AND j2.player_id = ? AND j2.est_reel = 1)
                       OR (j2.player_id = ? AND j2.est_reel = 1 AND j1.player_id = ? AND j1.est_reel = 1)
                `).all(monJoueur.id, playerId, monJoueur.id, playerId);
                faceAFace = calculerFaceAFace(confrontations, monJoueur.id);
            }
        }

        const badges = calculerBadges(circuitAdversaire, cleAdversaire, 'player_id', playerId);

        res.json({ success: true, infos, palmares, derniersMatchs, stats, faceAFace, badges, saisonAffichee, saisonsDisponibles });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/adversaire/rival/:rivalId', (req, res) => {
    try {
        const { rivalId } = req.params;
        const { monUserId } = req.query;

        const rival = db.prepare('SELECT * FROM classement_joueurs WHERE id = ?').get(rivalId);
        if (!rival) {
            return res.status(404).json({ error: 'Rival introuvable.' });
        }

        const cleRival = 'rival:' + rival.id;
        const infos = {
            nom: rival.nom, nationalite: rival.nationalite, drapeau: drapeau(rival.nationalite), circuit: rival.circuit,
            classement: calculerRangsLiveGlobal(rival.circuit).get(cleRival) || null,
            meilleurClassement: meilleurClassement(rival.circuit, cleRival)
        };

        const palmares = db.prepare(`
            SELECT tournois.nom, tournois.semaine, tournois.categorie, tournois.surface
            FROM tournoi_joueurs tj
            JOIN tournois ON tournois.id = tj.tournoi_id
            WHERE tj.rival_id = ? AND tj.tour_elimine = 'Vainqueur'
            ORDER BY tournois.semaine DESC
        `).all(rivalId);
        palmares.forEach(function (p) { p.positionSemaine = positionSemaineAffichee(p.semaine); });

        const matchsBruts = db.prepare(`
            SELECT t.id AS tournoi_id, t.nom AS tournoi_nom, t.calendrier_id AS tournoi_calendrier_id, t.semaine, t.surface, tm.numero_tour, tm.score, tm.vainqueur_id,
                   j1.id AS j1_id, j1.rival_id AS j1_rival_id, j1.player_id AS j1_player_id, j1.nom AS j1_nom,
                   j2.id AS j2_id, j2.rival_id AS j2_rival_id, j2.player_id AS j2_player_id, j2.nom AS j2_nom
            FROM tournoi_matchs tm
            JOIN tournoi_joueurs j1 ON j1.id = tm.joueur1_id
            JOIN tournoi_joueurs j2 ON j2.id = tm.joueur2_id
            JOIN tournois t ON t.id = tm.tournoi_id
            WHERE j1.rival_id = ? OR j2.rival_id = ?
            ORDER BY t.semaine DESC, tm.id DESC
        `).all(rivalId, rivalId);

        const matchsForme = matchsBruts.filter(function (m) { return m.score; }).map(function (m) {
            const rivalEstJ1 = m.j1_rival_id === Number(rivalId);
            const monId = rivalEstJ1 ? m.j1_id : m.j2_id;
            const victoire = m.vainqueur_id === monId;
            const adversaireNom = rivalEstJ1 ? m.j2_nom : m.j1_nom;
            const adversairePlayerId = rivalEstJ1 ? m.j2_player_id : m.j1_player_id;
            const adversaireRivalId = rivalEstJ1 ? m.j2_rival_id : m.j1_rival_id;
            const score = rivalEstJ1 ? m.score : miroirScore(m.score);
            return {
                tournoiId: m.tournoi_id, tournoiCalendrierId: m.tournoi_calendrier_id,
                tournoiNom: m.tournoi_nom, semaine: m.semaine, positionSemaine: positionSemaineAffichee(m.semaine),
                surface: m.surface, numeroTour: m.numero_tour, adversaireNom, victoire, score,
                adversairePlayerId: adversairePlayerId || null, adversaireRivalId: adversaireRivalId || null
            };
        });

        // "Derniers matchs" n'est plus plafonne a 20 : tous les matchs de la SAISON
        // demandee (`?saison=N`, saison affichee courante par defaut) sont renvoyes.
        const etatSemaine = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const saisonCourante = phaseAffichee(etatSemaine.semaine_actuelle).numeroSaison;
        const saisonsDisponibles = Array.from(new Set(matchsForme.map(function (m) { return phaseAffichee(m.semaine).numeroSaison; })))
            .sort(function (a, b) { return b - a; });
        const saisonAffichee = req.query.saison ? Number(req.query.saison) : saisonCourante;

        const derniersMatchs = matchsForme.filter(function (m) { return phaseAffichee(m.semaine).numeroSaison === saisonAffichee; });
        const stats = calculerStatsVD(matchsForme.map(function (m) { return { surface: m.surface, semaine: m.semaine, victoire: m.victoire }; }));

        let faceAFace = { nbConfrontations: 0, victoires: 0, defaites: 0, parSurface: {}, parSaison: {} };
        if (monUserId) {
            const monJoueur = db.prepare('SELECT id FROM players WHERE user_id = ? AND type = ?').get(monUserId, rival.circuit === 'ATP' ? 'joueur' : 'joueuse');
            if (monJoueur) {
                const confrontations = db.prepare(`
                    SELECT tm.vainqueur_id, t.surface, t.semaine,
                           j1.id AS j1_id, j1.player_id AS j1_player_id, j1.est_reel AS j1_est_reel,
                           j2.id AS j2_id, j2.player_id AS j2_player_id, j2.est_reel AS j2_est_reel
                    FROM tournoi_matchs tm
                    JOIN tournoi_joueurs j1 ON j1.id = tm.joueur1_id
                    JOIN tournoi_joueurs j2 ON j2.id = tm.joueur2_id
                    JOIN tournois t ON t.id = tm.tournoi_id
                    WHERE (j1.player_id = ? AND j1.est_reel = 1 AND j2.rival_id = ?)
                       OR (j2.player_id = ? AND j2.est_reel = 1 AND j1.rival_id = ?)
                `).all(monJoueur.id, rivalId, monJoueur.id, rivalId);
                faceAFace = calculerFaceAFace(confrontations, monJoueur.id);
            }
        }

        const badges = calculerBadges(rival.circuit, cleRival, 'rival_id', rivalId);

        res.json({ success: true, infos, palmares, derniersMatchs, stats, faceAFace, badges, saisonAffichee, saisonsDisponibles });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// ---------- Badges ----------

// 6 paliers (index 0 = sombre/non atteint) : "seuils" contient les 5 valeurs
// minimales pour bronze/argent/or/platine/legende. Un badge par statistique
// deja suivie en base (titres, victoires, classement) - pas de nouvelle
// mecanique de jeu, juste une lecture/mise en forme de compteurs existants.
// Affiches directement sur la fiche adversaire (Infos/Palmares/... + Badges),
// aussi bien pour un vrai joueur que pour un rival persistant. Le palier
// "Legende" n'est jamais obtenu QUE par le seuil numerique le plus haut : il
// l'est aussi des qu'un badge egale le record absolu du circuit pour cette
// statistique, quel que soit le nombre - voir estRecord dans construireBadges
// et calculerBadges plus bas (demande explicite de l'utilisateur, 2026-08-22).
const NOMS_PALIERS = ['sombre', 'bronze', 'argent', 'or', 'platine', 'legende'];

function palierBadge(valeur, seuils) {
    let palier = 0;
    for (let i = 0; i < seuils.length; i++) {
        if (valeur >= seuils[i]) palier = i + 1;
    }
    return palier;
}

// b.nomsPaliers (optionnel) remplace NOMS_PALIERS pour CE badge uniquement (les
// autres badges partageant NOMS_PALIERS restent inchanges). b.estRecord force le
// palier le plus prestigieux meme sous le seuil numerique normal - utilise pour
// le palier "Legende" des badges par surface : peu importe le nombre, le joueur/
// la joueuse ayant le plus de victoires sur cette surface (parmi son circuit)
// obtient ce palier (demande explicite de l'utilisateur, 2026-08-22).
function construireBadges(liste) {
    return liste.map(function (b) {
        const noms = b.nomsPaliers || NOMS_PALIERS;
        let palier = palierBadge(b.valeur, b.seuils);
        if (b.estRecord && b.valeur > 0) palier = noms.length - 1;
        return {
            id: b.id, nom: b.nom, description: b.description, valeur: b.valeur, seuils: b.seuils,
            palier: palier, palierNom: noms[palier],
            prochainSeuil: b.seuils[palier] || null
        };
    });
}

// Meilleure serie de victoires consecutives (tournoi) d'UN joueur/rival donne -
// factorisee pour etre reutilisable a la fois pour l'entite courante (calculerBadges)
// et pour balayer tout un circuit (maxMeilleureSerieCircuit ci-dessous).
function meilleureSerieDe(filtreColonne, id) {
    const matchs = matchsOrientes(filtreColonne, id);
    let meilleureSerie = 0, serieActuelle = 0;
    matchs.forEach(function (m) {
        if (m.victoire) { serieActuelle++; meilleureSerie = Math.max(meilleureSerie, serieActuelle); }
        else { serieActuelle = 0; }
    });
    return meilleureSerie;
}

function intouchableDe(filtreColonne, id) {
    return matchsOrientes(filtreColonne, id).filter(function (m) { return m.victoire && estIntouchable(m.score); }).length;
}

// Record absolu d'un circuit pour "Intouchable" et "Serie de victoires" a la
// fois (un seul parcours du roster, matchsOrientes recupere une seule fois par
// entite au lieu de deux boucles separees) - ni l'un ni l'autre n'est exprimable
// en simple agregat SQL (score a parser / chronologie a suivre par entite).
function maxStatsSequentiellesCircuit(circuit) {
    const type = circuit === 'ATP' ? 'joueur' : 'joueuse';
    const idsReels = db.prepare("SELECT id FROM players WHERE type = ? AND statut = 'valide'").all(type).map(function (r) { return r.id; });
    const idsRivaux = db.prepare('SELECT id FROM classement_joueurs WHERE circuit = ?').all(circuit).map(function (r) { return r.id; });
    let maxIntouchable = 0, maxSerie = 0;
    function balayer(filtreColonne, id) {
        const matchs = matchsOrientes(filtreColonne, id);
        let serieActuelle = 0, meilleureSerie = 0, intouchable = 0;
        matchs.forEach(function (m) {
            if (m.victoire) {
                serieActuelle++;
                meilleureSerie = Math.max(meilleureSerie, serieActuelle);
                if (estIntouchable(m.score)) intouchable++;
            } else {
                serieActuelle = 0;
            }
        });
        maxIntouchable = Math.max(maxIntouchable, intouchable);
        maxSerie = Math.max(maxSerie, meilleureSerie);
    }
    idsReels.forEach(function (id) { balayer('player_id', id); });
    idsRivaux.forEach(function (id) { balayer('rival_id', id); });
    return { maxIntouchable, maxSerie };
}

// Record absolu d'un circuit pour une statistique exprimable en agregat SQL simple
// (COUNT/COUNT DISTINCT groupe par entite) - factorise le motif commun a la
// plupart des badges "Legende" : peu importe le nombre, le record du moment
// obtient ce palier, quel que soit le badge concerne (demande explicite de
// l'utilisateur, 2026-08-22). `depuis` = FROM+JOIN a partir de `tournoi_joueurs tj`
// (avec ou sans `tournois t`) ; `conditionExtra` = filtre SQL supplementaire
// (categorie/nom de tournoi/surface...), avec ses `?` dans `paramsExtra`.
function maxAgregatTournoiCircuit(circuit, selectN, depuis, conditionExtra, paramsExtra) {
    const type = circuit === 'ATP' ? 'joueur' : 'joueuse';
    const maxReel = db.prepare(`
        SELECT MAX(n) AS m FROM (
            SELECT ${selectN} AS n FROM ${depuis}
            WHERE tj.est_reel = 1 AND tj.player_id IN (SELECT id FROM players WHERE type = ?)${conditionExtra}
            GROUP BY tj.player_id
        )
    `).get(type, ...paramsExtra).m || 0;
    const maxRival = db.prepare(`
        SELECT MAX(n) AS m FROM (
            SELECT ${selectN} AS n FROM ${depuis}
            WHERE tj.rival_id IN (SELECT id FROM classement_joueurs WHERE circuit = ?)${conditionExtra}
            GROUP BY tj.rival_id
        )
    `).get(circuit, ...paramsExtra).m || 0;
    return Math.max(maxReel, maxRival);
}

// Record absolu d'un circuit sur une surface donnee (max de victoires de tournoi
// sur cette surface parmi TOUS les vrais joueurs ET rivaux persistants de ce
// circuit).
function maxVictoiresParSurfaceCircuit(circuit, surface) {
    return maxAgregatTournoiCircuit(circuit, 'COUNT(*)',
        'tournoi_matchs tm JOIN tournoi_joueurs tj ON tj.id = tm.vainqueur_id JOIN tournois t ON t.id = tj.tournoi_id',
        ' AND t.surface = ?', [surface]);
}

function maxVictoiresCircuit(circuit) {
    return maxAgregatTournoiCircuit(circuit, 'COUNT(*)',
        'tournoi_matchs tm JOIN tournoi_joueurs tj ON tj.id = tm.vainqueur_id', '', []);
}

function maxTitresCircuit(circuit) {
    return maxAgregatTournoiCircuit(circuit, 'COUNT(*)', 'tournoi_joueurs tj', " AND tj.tour_elimine = 'Vainqueur'", []);
}

function maxTitresParCategorieCircuit(circuit, categorie) {
    return maxAgregatTournoiCircuit(circuit, 'COUNT(*)',
        'tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id',
        " AND tj.tour_elimine = 'Vainqueur' AND t.categorie = ?", [categorie]);
}

function maxTitresParNomCircuit(circuit, nom) {
    return maxAgregatTournoiCircuit(circuit, 'COUNT(*)',
        'tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id',
        " AND tj.tour_elimine = 'Vainqueur' AND t.nom = ?", [nom]);
}

function maxGcDifferentsCircuit(circuit) {
    return maxAgregatTournoiCircuit(circuit, 'COUNT(DISTINCT t.nom)',
        'tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id',
        " AND tj.tour_elimine = 'Vainqueur' AND t.categorie = 'slam'", []);
}

function maxQualifMastersCircuit(circuit) {
    return maxAgregatTournoiCircuit(circuit, 'COUNT(*)',
        'tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id',
        " AND t.categorie = 'finals'", []);
}

// classement_historique.cle unifie deja "joueur:ID"/"rival:ID" - un seul agregat
// suffit, pas besoin du split reel/rival des fonctions ci-dessus.
function maxSemainesRangCircuit(circuit, conditionRang) {
    return db.prepare(`
        SELECT MAX(n) AS m FROM (
            SELECT COUNT(*) AS n FROM classement_historique WHERE circuit = ? AND ${conditionRang} GROUP BY cle
        )
    `).get(circuit).m || 0;
}

// Balles de break sauvees : jamais trackees pour un rival (cf. ballesBreakSauvees
// plus bas), le record ne peut donc venir que d'un vrai joueur.
function maxSangFroidCircuit(circuit) {
    const type = circuit === 'ATP' ? 'joueur' : 'joueuse';
    return db.prepare(`
        SELECT MAX(n) AS m FROM (
            SELECT SUM(balles_break_sauvees) AS n FROM matchs WHERE player_id IN (SELECT id FROM players WHERE type = ?)
            GROUP BY player_id
        )
    `).get(type).m || 0;
}

// Score au format "6-3, 7-5" toujours oriente du point de vue de CE joueur/rival
// (mirroirScore deja applique si besoin par l'appelant) - utilise pour detecter
// un match "sans perdre le moindre jeu" (chaque set gagne 6-0/7-0).
function estIntouchable(score) {
    if (!score) return false;
    return score.split(', ').every(function (set) {
        const parts = set.split('-').map(Number);
        return parts.length === 2 && !isNaN(parts[1]) && parts[1] === 0;
    });
}

// Historique chronologique (ordre tm.id, seul proxy disponible - pas de vraie
// date par match) des matchs de tournoi d'un joueur/rival, TOUJOURS oriente de
// son propre point de vue (mirroirScore applique si ce joueur/rival etait cote
// j2) - sert de base commune aux badges "Intouchable" et "Serie de victoires",
// qui ont besoin du score/de l'issue de CHAQUE match, pas juste d'un total.
function matchsOrientes(filtreColonne, id) {
    const filtreJ1 = filtreColonne === 'player_id' ? 'j1.player_id = ? AND j1.est_reel = 1' : 'j1.rival_id = ?';
    const filtreJ2 = filtreColonne === 'player_id' ? 'j2.player_id = ? AND j2.est_reel = 1' : 'j2.rival_id = ?';
    const rows = db.prepare(`
        SELECT tm.id, tm.score, tm.vainqueur_id,
               j1.id AS j1_id, j1.player_id AS j1_player_id, j1.rival_id AS j1_rival_id,
               j2.id AS j2_id, j2.player_id AS j2_player_id, j2.rival_id AS j2_rival_id
        FROM tournoi_matchs tm
        JOIN tournoi_joueurs j1 ON j1.id = tm.joueur1_id
        JOIN tournoi_joueurs j2 ON j2.id = tm.joueur2_id
        WHERE (${filtreJ1}) OR (${filtreJ2})
        ORDER BY tm.id ASC
    `).all(id, id);

    return rows.filter(function (r) { return r.score; }).map(function (r) {
        const estJ1 = filtreColonne === 'player_id' ? r.j1_player_id === Number(id) : r.j1_rival_id === Number(id);
        const monId = estJ1 ? r.j1_id : r.j2_id;
        return { victoire: r.vainqueur_id === monId, score: estJ1 ? r.score : miroirScore(r.score) };
    });
}

// filtreColonne = 'player_id' (vrai joueur, avec est_reel = 1) ou 'rival_id'
// (rival persistant du roster) - les deux colonnes sont mutuellement exclusives
// dans tournoi_joueurs, donc pas besoin d'un est_reel explicite pour rival_id.
// Jeux Olympiques delibirement absents (n'existent pas dans le jeu, cf. CLAUDE.md
// "Pas encore fait") : "Grand chelem differents" plafonne donc a 4/5 realistement
// tant que les JO ne sont pas implementes (choix explicite de l'utilisateur).
function calculerBadges(circuit, cle, filtreColonne, id) {
    const filtreDirect = filtreColonne === 'player_id' ? 'player_id = ? AND est_reel = 1' : 'rival_id = ?';
    const filtreJoint = filtreColonne === 'player_id' ? 'tj.player_id = ? AND tj.est_reel = 1' : 'tj.rival_id = ?';

    function titresParCategorie(categorie) {
        return db.prepare(`
            SELECT COUNT(*) AS n FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
            WHERE ${filtreJoint} AND tj.tour_elimine = 'Vainqueur' AND t.categorie = ?
        `).get(id, categorie).n;
    }

    function titresParNom(nom) {
        return db.prepare(`
            SELECT COUNT(*) AS n FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
            WHERE ${filtreJoint} AND tj.tour_elimine = 'Vainqueur' AND t.nom = ?
        `).get(id, nom).n;
    }

    function victoiresParSurface(surface) {
        return db.prepare(`
            SELECT COUNT(*) AS n FROM tournoi_matchs tm JOIN tournoi_joueurs tj ON tj.id = tm.vainqueur_id
            JOIN tournois t ON t.id = tj.tournoi_id
            WHERE ${filtreJoint} AND t.surface = ?
        `).get(id, surface).n;
    }

    const titres = db.prepare(`SELECT COUNT(*) AS n FROM tournoi_joueurs WHERE ${filtreDirect} AND tour_elimine = 'Vainqueur'`).get(id).n;
    const titresGC = titresParCategorie('slam');
    const titresM1000 = titresParCategorie('1000');
    const titresMasters = titresParCategorie('finals');

    const gcDifferents = db.prepare(`
        SELECT COUNT(DISTINCT t.nom) AS n FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
        WHERE ${filtreJoint} AND tj.tour_elimine = 'Vainqueur' AND t.categorie = 'slam'
    `).get(id).n;

    const victoires = db.prepare(`
        SELECT COUNT(*) AS n FROM tournoi_matchs tm JOIN tournoi_joueurs tj ON tj.id = tm.vainqueur_id
        WHERE ${filtreJoint}
    `).get(id).n;

    const semainesTop10 = db.prepare(`SELECT COUNT(*) AS n FROM classement_historique WHERE cle = ? AND circuit = ? AND rang <= 10`).get(cle, circuit).n;
    const semainesNum1 = db.prepare(`SELECT COUNT(*) AS n FROM classement_historique WHERE cle = ? AND circuit = ? AND rang = 1`).get(cle, circuit).n;

    const qualifMasters = db.prepare(`
        SELECT COUNT(*) AS n FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
        WHERE ${filtreJoint} AND t.categorie = 'finals'
    `).get(id).n;

    const victoiresDur = victoiresParSurface('dur');
    const victoiresTerre = victoiresParSurface('terre');
    const victoiresHerbe = victoiresParSurface('herbe');

    // Intouchable + Serie de victoires partagent le meme parcours matchsOrientes,
    // calcules ensemble ici (valeur de CETTE entite) et via maxStatsSequentiellesCircuit
    // (record du circuit, un seul balayage du roster pour les deux).
    const matchs = matchsOrientes(filtreColonne, id);
    const intouchable = matchs.filter(function (m) { return m.victoire && estIntouchable(m.score); }).length;
    let meilleureSerie = 0, serieActuelle = 0;
    matchs.forEach(function (m) {
        if (m.victoire) { serieActuelle++; meilleureSerie = Math.max(meilleureSerie, serieActuelle); }
        else { serieActuelle = 0; }
    });
    const maxSequentiels = maxStatsSequentiellesCircuit(circuit);

    // Balles de break sauvees : uniquement trackees sur la table `matchs`, qui
    // n'existe que pour un VRAI joueur (jamais de ligne `matchs` pour un rival,
    // meme quand il affronte un reel) - toujours 0 pour un rival, faute de donnee.
    const ballesBreakSauvees = filtreColonne === 'player_id'
        ? db.prepare('SELECT COALESCE(SUM(balles_break_sauvees), 0) AS n FROM matchs WHERE player_id = ?').get(id).n
        : 0;

    // Tous les badges obtiennent le palier "Legende" (peu importe le nombre) des
    // que leur valeur egale le record absolu du circuit pour cette statistique -
    // demande explicite de l'utilisateur, 2026-08-22. Un badge deja au sommet
    // numerique (ex: 4/4 Grand Chelem differents) obtient logiquement aussi
    // "Legende" des lors qu'il est le record (souvent le cas pour ce badge precis).
    return construireBadges([
        { id: 'victoires', nom: 'Victoires en tournoi', description: 'Matchs de tournoi remportés, toute la carrière', valeur: victoires, seuils: [50, 100, 150, 250, 500],
            estRecord: victoires === maxVictoiresCircuit(circuit) },
        { id: 'victoires_dur', nom: 'Matchs gagnés sur dur', description: 'Matchs remportés sur surface dure', valeur: victoiresDur,
            seuils: [1, 25, 50, 75, 150], estRecord: victoiresDur === maxVictoiresParSurfaceCircuit(circuit, 'dur') },
        { id: 'victoires_terre', nom: 'Matchs gagnés sur terre', description: 'Matchs remportés sur terre battue', valeur: victoiresTerre,
            seuils: [1, 25, 50, 75, 150], estRecord: victoiresTerre === maxVictoiresParSurfaceCircuit(circuit, 'terre') },
        { id: 'victoires_herbe', nom: 'Matchs gagnés sur herbe', description: 'Matchs remportés sur herbe', valeur: victoiresHerbe,
            seuils: [1, 25, 50, 75, 150], estRecord: victoiresHerbe === maxVictoiresParSurfaceCircuit(circuit, 'herbe') },
        { id: 'titres', nom: 'Titres remportés', description: 'Tournois remportés, toutes catégories confondues', valeur: titres, seuils: [5, 10, 15, 25, 50],
            estRecord: titres === maxTitresCircuit(circuit) },
        { id: 'titres_gc', nom: 'Titres du Grand Chelem', description: 'Open d\'Australie, Roland-Garros, Wimbledon, US Open remportés', valeur: titresGC, seuils: [5, 10, 15, 25, 50],
            estRecord: titresGC === maxTitresParCategorieCircuit(circuit, 'slam') },
        { id: 'gc_differents', nom: 'Grand Chelem différents gagnés', description: 'Nombre de Grand Chelem distincts remportés au moins une fois', valeur: gcDifferents, seuils: [1, 2, 3, 4, 5],
            estRecord: gcDifferents === maxGcDifferentsCircuit(circuit) },
        { id: 'titres_m1000', nom: 'Titres Masters 1000', description: 'Tournois Masters 1000 remportés', valeur: titresM1000, seuils: [5, 10, 15, 25, 50],
            estRecord: titresM1000 === maxTitresParCategorieCircuit(circuit, '1000') },
        { id: 'top10', nom: 'Semaines dans le Top 10', description: 'Semaines passées dans le top 10 du classement Live', valeur: semainesTop10, seuils: [1, 10, 25, 50, 100],
            estRecord: semainesTop10 === maxSemainesRangCircuit(circuit, 'rang <= 10') },
        { id: 'numero1', nom: 'Semaines N°1', description: 'Semaines passées n°1 du classement Live', valeur: semainesNum1, seuils: [1, 4, 12, 26, 52],
            estRecord: semainesNum1 === maxSemainesRangCircuit(circuit, 'rang = 1') },
        { id: 'masters_qualif', nom: 'Qualifications aux Masters', description: 'Qualifications au tournoi des Masters de fin de saison', valeur: qualifMasters, seuils: [1, 10, 25, 50, 100],
            estRecord: qualifMasters === maxQualifMastersCircuit(circuit) },
        { id: 'victoire_ao', nom: 'Victoire Open d\'Australie', description: 'Titres remportés à l\'Open d\'Australie', valeur: titresParNom('Open d\'Australie'), seuils: [1, 2, 3, 5, 8],
            estRecord: titresParNom('Open d\'Australie') === maxTitresParNomCircuit(circuit, 'Open d\'Australie') },
        { id: 'victoire_rg', nom: 'Victoire Roland-Garros', description: 'Titres remportés à Roland-Garros', valeur: titresParNom('Roland-Garros'), seuils: [1, 2, 3, 5, 8],
            estRecord: titresParNom('Roland-Garros') === maxTitresParNomCircuit(circuit, 'Roland-Garros') },
        { id: 'victoire_wimbledon', nom: 'Victoire Wimbledon', description: 'Titres remportés à Wimbledon', valeur: titresParNom('Wimbledon'), seuils: [1, 2, 3, 5, 8],
            estRecord: titresParNom('Wimbledon') === maxTitresParNomCircuit(circuit, 'Wimbledon') },
        { id: 'victoire_usopen', nom: 'Victoire US Open', description: 'Titres remportés à l\'US Open', valeur: titresParNom('US Open'), seuils: [1, 2, 3, 5, 8],
            estRecord: titresParNom('US Open') === maxTitresParNomCircuit(circuit, 'US Open') },
        { id: 'victoire_masters', nom: 'Victoire Masters', description: 'Titres remportés au tournoi des Masters de fin de saison', valeur: titresMasters, seuils: [1, 2, 3, 5, 8],
            estRecord: titresMasters === maxTitresParCategorieCircuit(circuit, 'finals') },
        { id: 'intouchable', nom: 'Intouchable', description: 'Matchs remportés sans perdre le moindre jeu', valeur: intouchable, seuils: [1, 5, 15, 25, 50],
            estRecord: intouchable === maxSequentiels.maxIntouchable },
        { id: 'serie_victoires', nom: 'Série de victoires', description: 'Meilleure série de matchs gagnés à la suite', valeur: meilleureSerie, seuils: [5, 10, 15, 25, 50],
            estRecord: meilleureSerie === maxSequentiels.maxSerie },
        { id: 'sang_froid', nom: 'Sang-froid', description: 'Balles de break sauvées, cumulées sur la carrière', valeur: ballesBreakSauvees, seuils: [10, 25, 50, 100, 200],
            estRecord: filtreColonne === 'player_id' && ballesBreakSauvees === maxSangFroidCircuit(circuit) }
    ]);
}

// Badges du COACH (distincts des badges par joueur ci-dessus) : cumules sur les
// 2 personnages + statistiques propres au coach (pronostics, saisons jouees).
// Jeux Olympiques delibirement absents (cf. calculerBadges ci-dessus).
function calculerBadgesCoach(userId) {
    const joueurs = db.prepare("SELECT id, type FROM players WHERE user_id = ? AND statut = 'valide'").all(userId);
    const idsJoueurs = joueurs.map(function (j) { return j.id; });
    const joueurRow = joueurs.find(function (j) { return j.type === 'joueur'; });
    const joueuseRow = joueurs.find(function (j) { return j.type === 'joueuse'; });

    let titres = 0, gcCumules = 0, mastersCumules = 0, appelKine = 0;
    if (idsJoueurs.length > 0) {
        const placeholders = idsJoueurs.map(function () { return '?'; }).join(',');
        titres = db.prepare(`
            SELECT COUNT(*) AS n FROM tournoi_joueurs WHERE player_id IN (${placeholders}) AND est_reel = 1 AND tour_elimine = 'Vainqueur'
        `).get(...idsJoueurs).n;

        gcCumules = db.prepare(`
            SELECT COUNT(*) AS n FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
            WHERE tj.player_id IN (${placeholders}) AND tj.est_reel = 1 AND tj.tour_elimine = 'Vainqueur' AND t.categorie = 'slam'
        `).get(...idsJoueurs).n;

        mastersCumules = db.prepare(`
            SELECT COUNT(*) AS n FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
            WHERE tj.player_id IN (${placeholders}) AND tj.est_reel = 1 AND tj.tour_elimine = 'Vainqueur' AND t.categorie = 'finals'
        `).get(...idsJoueurs).n;

        appelKine = db.prepare(`SELECT COUNT(*) AS n FROM matchs WHERE player_id IN (${placeholders}) AND kine_intervenu = 1`).get(...idsJoueurs).n;
    }

    // Nombre de saisons ou LES DEUX personnages ont chacun remporte au moins un
    // Grand Chelem (JO non compris, cf. Why plus haut).
    let gcMemeSaison = 0;
    if (joueurRow && joueuseRow) {
        function saisonsGC(playerId) {
            return new Set(db.prepare(`
                SELECT t.semaine FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
                WHERE tj.player_id = ? AND tj.est_reel = 1 AND tj.tour_elimine = 'Vainqueur' AND t.categorie = 'slam'
            `).all(playerId).map(function (r) { return phaseAffichee(r.semaine).numeroSaison; }));
        }
        const saisonsJoueur = saisonsGC(joueurRow.id);
        const saisonsJoueuse = saisonsGC(joueuseRow.id);
        saisonsJoueur.forEach(function (s) { if (saisonsJoueuse.has(s)) gcMemeSaison++; });
    }

    // Semaines Top 10 ou les 2 personnages y sont EN MEME TEMPS (pas la somme des
    // semaines de chacun separement).
    let top10Simultanees = 0;
    if (joueurRow && joueuseRow) {
        top10Simultanees = db.prepare(`
            SELECT COUNT(*) AS n FROM classement_historique a JOIN classement_historique b ON a.semaine = b.semaine
            WHERE a.cle = ? AND a.circuit = 'ATP' AND a.rang <= 10 AND b.cle = ? AND b.circuit = 'WTA' AND b.rang <= 10
        `).get('joueur:' + joueurRow.id, 'joueur:' + joueuseRow.id).n;
    }

    const pointsPronos = db.prepare(`SELECT COALESCE(SUM(points_gagnes), 0) AS n FROM pronostics WHERE user_id = ? AND points_gagnes IS NOT NULL`).get(userId).n;

    const saisonsRows = db.prepare(`
        SELECT DISTINCT t.semaine FROM pronostics p JOIN tournois t ON t.id = p.tournoi_id WHERE p.user_id = ?
    `).all(userId);
    const saisonsJouees = new Set(saisonsRows.map(function (r) { return phaseAffichee(r.semaine).numeroSaison; })).size;

    // Badge special, designation manuelle (pas un calcul de statistique) : accorde
    // une fois pour toutes aux coachs ayant teste le jeu avant le vrai lancement.
    // Reutilise le mecanisme estRecord (voir construireBadges) pour un badge
    // binaire "on l'a ou pas" plutot qu'une progression a 5 paliers - directement
    // au palier maximal des qu'il est accorde, jamais de palier intermediaire.
    const estBetaTesteur = !!db.prepare('SELECT est_beta_testeur FROM users WHERE id = ?').get(userId).est_beta_testeur;

    return construireBadges([
        { id: 'beta_testeur', nom: 'Beta testeur', description: 'A permis de tester et résoudre les bugs avant la sortie du jeu. Merci à lui !', valeur: estBetaTesteur ? 1 : 0, seuils: [1, 1, 1, 1, 1], estRecord: estBetaTesteur },
        { id: 'titres_coach', nom: 'Titres cumulés', description: 'Titres remportés, cumulés sur les 2 personnages', valeur: titres, seuils: [1, 25, 50, 100, 250] },
        { id: 'gc_cumules', nom: 'Grand Chelems cumulés', description: 'Titres du Grand Chelem, cumulés sur les 2 personnages', valeur: gcCumules, seuils: [2, 5, 10, 20, 30] },
        { id: 'gc_meme_saison', nom: 'Grand Chelem la même saison', description: 'Saisons où les 2 personnages ont chacun remporté un Grand Chelem', valeur: gcMemeSaison, seuils: [1, 2, 3, 4, 5] },
        { id: 'masters_cumules', nom: 'Masters de fin d\'année cumulés', description: 'Titres du tournoi des Masters, cumulés sur les 2 personnages', valeur: mastersCumules, seuils: [1, 2, 3, 5, 8] },
        { id: 'points_pronos', nom: 'Points de pronostics', description: 'Points de pronostics cumulés, toute la carrière', valeur: pointsPronos, seuils: [25, 40, 70, 100, 200] },
        { id: 'top10_simultane', nom: 'Semaines dans le Top 10 ensemble', description: 'Semaines où les 2 personnages sont dans le top 10 du classement Live en même temps', valeur: top10Simultanees, seuils: [1, 2, 3, 5, 10] },
        { id: 'saisons_jouees', nom: 'Saisons jouées', description: 'Saisons avec au moins un pronostic soumis', valeur: saisonsJouees, seuils: [1, 3, 5, 10, 20] },
        { id: 'appel_kine', nom: 'Appel au kiné', description: 'Interventions du kiné, cumulées sur les 2 personnages', valeur: appelKine, seuils: [5, 10, 15, 25, 50] }
    ]);
}

app.get('/api/matchs/semaine/:userId', (req, res) => {
    try {
        const userId = req.userId;
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const semaineActuelle = etat.semaine_actuelle;

        const joueurs = db.prepare("SELECT id, type FROM players WHERE user_id = ? AND statut = 'valide'").all(userId);
        if (joueurs.length === 0) {
            return res.json({ success: true, tournois: [] });
        }

        // Un joueur par circuit (ATP pour 'joueur', WTA pour 'joueuse') pour batir le
        // lien vers la fiche tournoi cote frontend - la fiche n'exige pas d'y etre
        // inscrit pour etre consultee.
        const joueurParCircuit = {};
        joueurs.forEach(function (p) { joueurParCircuit[p.type === 'joueur' ? 'ATP' : 'WTA'] = p.id; });

        // TOUS les tournois de la semaine sur les circuits du coach, inscrit ou non
        // (demande explicite : "je veux voir tous les matchs de la semaine, que mon
        // joueur y participe ou non") - plus seulement ceux ou l'un de mes joueurs a
        // une inscription reelle. Meme tolerance d'un ecart de 1 semaine que
        // /api/matchs (cf. bug Live) : un tournoi se joue integralement au moment ou
        // semaine_actuelle avance dans la meme requete, donc au moment ou le coach
        // consulte la page, la semaine courante a deja avance d'un cran par rapport a
        // tournois.semaine.
        const circuits = Object.keys(joueurParCircuit);
        if (circuits.length === 0) {
            return res.json({ success: true, tournois: [] });
        }
        const placeholders = circuits.map(function () { return '?'; }).join(',');
        const tournois = db.prepare(`
            SELECT tournois.id, tournois.nom, tournois.circuit, tournois.surface,
                   tournois.calendrier_id, tournois.semaine
            FROM tournois
            WHERE tournois.semaine >= ? AND tournois.semaine <= ?
              AND tournois.circuit IN (${placeholders})
        `).all(semaineActuelle - 1, semaineActuelle, ...circuits);

        const resultat = tournois.map(function (t) {
            t.player_id = joueurParCircuit[t.circuit];
            // "Autres matchs" = tout ce qui n'est pas deja affiche dans "mes matchs"
            // (donc pas MES matchs a moi), PAS "tout match sans aucun vrai joueur" -
            // exclure purement match_id IS NOT NULL faisait disparaitre les tours
            // (souvent la demi-finale/la finale) ou un AUTRE coach avait un vrai
            // joueur engage : ce tour n'appartenait ni a "mes matchs" (pas mon joueur)
            // ni a "autres matchs" (exclu a tort), donc invisible pour moi (bug
            // signale par l'utilisateur, 2026-08-20). N'exclut desormais que les
            // matchs qui m'appartiennent VRAIMENT (matchs.user_id = moi, cote j1 ou j2).
            const matchs = db.prepare(`
                SELECT tournoi_matchs.id, tournoi_matchs.numero_tour, tournoi_matchs.ordre, tournoi_matchs.score,
                       tournoi_matchs.evenements, tournoi_matchs.match_id, tournoi_matchs.match_id_j2,
                       j1.nom AS joueur1_nom, j1.nationalite AS joueur1_nationalite,
                       j2.nom AS joueur2_nom, j2.nationalite AS joueur2_nationalite
                FROM tournoi_matchs
                JOIN tournoi_joueurs AS j1 ON j1.id = tournoi_matchs.joueur1_id
                LEFT JOIN tournoi_joueurs AS j2 ON j2.id = tournoi_matchs.joueur2_id
                LEFT JOIN matchs AS m1 ON m1.id = tournoi_matchs.match_id
                LEFT JOIN matchs AS m2 ON m2.id = tournoi_matchs.match_id_j2
                WHERE tournoi_matchs.tournoi_id = ?
                  AND j1.nom != 'BYE' AND (j2.nom IS NULL OR j2.nom != 'BYE')
                  AND (m1.id IS NULL OR m1.user_id != ?)
                  AND (m2.id IS NULL OR m2.user_id != ?)
                ORDER BY tournoi_matchs.ordre
            `).all(t.id, userId, userId);
            matchs.forEach(function (m) {
                m.joueur1_drapeau = drapeau(m.joueur1_nationalite);
                m.joueur2_drapeau = drapeau(m.joueur2_nationalite);
                // Deroule complet jamais envoye ici (spoilerait le score des l'ouverture
                // de la page) - juste un indicateur, le vrai contenu se recupere via
                // /api/tournois/match-bot/:id au clic sur un mode de visionnage. La ligne
                // a deja ete exclue plus haut si elle m'appartenait, donc match_id/
                // match_id_j2 non nuls ici signifient toujours "un AUTRE coach".
                m.aReplayBot = !!m.evenements || !!m.match_id || !!m.match_id_j2;
                delete m.evenements;
            });
            return {
                tournoiId: t.id, nom: t.nom, circuit: t.circuit, surface: t.surface,
                calendrierId: t.calendrier_id, playerId: t.player_id, semaine: t.semaine,
                positionSemaine: positionSemaineAffichee(t.semaine), matchs: matchs
            };
        }).filter(function (t) { return t.matchs.length > 0; });

        res.json({ success: true, tournois: resultat });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/matchs/:userId', (req, res) => {
    try {
        const userId = req.userId;
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();

        // Fenetre semaineActuelle-1 a semaineActuelle uniquement (meme tolerance d'un
        // ecart de 1 qu'ailleurs sur cette page, cf. estSemaineActuelle plus bas) - sans
        // filtre, cette requete remontait TOUS les matchs jamais joues par le coach
        // depuis le debut de la partie, accumulant indefiniment et surchargeant la page
        // (bug signale par l'utilisateur, 2026-08-21). "Historique de mes matchs" sur la
        // fiche joueur (adversaire.html) reste la vraie page d'archive complete.
        const matchs = db.prepare(`
            SELECT matchs.id, matchs.player_id, matchs.surface, matchs.difficulte, matchs.semaine,
                   matchs.vainqueur, matchs.score, matchs.niveau_joueur, matchs.niveau_adversaire, matchs.date_creation,
                   matchs.tournoi_id, matchs.numero_tour, matchs.coupe_equipe_id, tournois.nom AS tournoi_nom, tournois.calendrier_id AS tournoi_calendrier_id,
                   players.prenom, players.nom, players.type, players.nationalite,
                   tj1.player_id AS tj1_player_id, tj1.rival_id AS tj1_rival_id, tj1.nom AS tj1_nom, tj1.nationalite AS tj1_nationalite,
                   tj2.player_id AS tj2_player_id, tj2.rival_id AS tj2_rival_id, tj2.nom AS tj2_nom, tj2.nationalite AS tj2_nationalite
            FROM matchs
            JOIN players ON players.id = matchs.player_id
            LEFT JOIN tournois ON tournois.id = matchs.tournoi_id
            LEFT JOIN tournoi_matchs AS tm ON tm.match_id = matchs.id OR tm.match_id_j2 = matchs.id
            LEFT JOIN tournoi_joueurs AS tj1 ON tj1.id = tm.joueur1_id
            LEFT JOIN tournoi_joueurs AS tj2 ON tj2.id = tm.joueur2_id
            WHERE matchs.user_id = ? AND matchs.semaine >= ? AND matchs.semaine <= ?
            ORDER BY matchs.id DESC
        `).all(userId, etat.semaine_actuelle - 1, etat.semaine_actuelle);

        const nbDivisionsCoupeCache = {};
        matchs.forEach(function (m) {
            // Un tournoi se joue integralement a la semaine "semaine" au moment ou
            // avancer-semaine incremente semaine_actuelle dans la meme requete : au
            // moment ou le coach peut voir le match, semaine_actuelle a deja avance
            // d'un cran. D'ou la tolerance d'un ecart de 1 (sinon le Live d'un match
            // de tournoi ne serait jamais accessible).
            m.estSemaineActuelle = etat.semaine_actuelle - m.semaine <= 1;
            m.positionSemaine = positionSemaineAffichee(m.semaine);
            // Les matchs amicaux (pas de tournoi_id) peuvent avoir lieu meme en
            // Pre-saison/Semaine 0, ou positionSemaine est null - libelle de repli
            // complet pour ce cas precis (jamais utilise pour un match de tournoi,
            // toujours en semaine de type 'tournoi' donc positionSemaine deja valide).
            const phaseM = phaseDeSemaine(m.semaine);
            m.semaineLabel = phaseM.type === 'tournoi' ? ('Semaine ' + phaseM.positionSemaine)
                : (phaseM.type === 'presaison' ? 'Pré-saison' : 'Semaine 0');
            m.joueur_drapeau = drapeau(m.nationalite);
            if (m.tournoi_id) {
                // Un match reel-vs-reel a 2 lignes matchs distinctes (une par coach),
                // reliees respectivement par match_id ET match_id_j2 - se fier a
                // est_reel pour deviner qui est l'adversaire (comme avant) rate ce cas
                // (tj1 ET tj2 tous les deux reels). Determiner "qui je suis" via QUELLE
                // COLONNE a matche (match_id vs match_id_j2, tente brievement le
                // 2026-08-20) est FAUX pour un simple reel-vs-lambda : la ligne
                // tournoi_matchs.match_id pointe TOUJOURS vers l'unique vrai joueur,
                // meme quand il est tire en position joueur2_id du tableau - la seule
                // comparaison fiable est le player_id (le lambda a toujours
                // tj_player_id = NULL, jamais egal au mien).
                const jeSuisTj1 = m.tj1_player_id === m.player_id;
                m.adversaire_nom = jeSuisTj1 ? m.tj2_nom : m.tj1_nom;
                m.adversaire_nationalite = jeSuisTj1 ? m.tj2_nationalite : m.tj1_nationalite;
                m.adversaire_drapeau = drapeau(m.adversaire_nationalite);
                m.adversaire_player_id = jeSuisTj1 ? m.tj2_player_id : m.tj1_player_id;
                m.adversaire_rival_id = jeSuisTj1 ? m.tj2_rival_id : m.tj1_rival_id;
            } else if (m.difficulte === 'coupe' && m.coupe_equipe_id) {
                const tieCoupe = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(m.coupe_equipe_id);
                const rubber = db.prepare(`
                    SELECT * FROM coupe_rubbers WHERE coupe_equipe_id = ?
                    AND ((domicile_est_reel = 1 AND (domicile_id = ? OR domicile_id2 = ?))
                      OR (exterieur_est_reel = 1 AND (exterieur_id = ? OR exterieur_id2 = ?)))
                `).all(m.coupe_equipe_id, m.player_id, m.player_id, m.player_id, m.player_id)
                    .find(function (r) { return libelleRubber(r.numero) === m.numero_tour; });

                if (rubber) {
                    const jeSuisDomicile = rubber.domicile_est_reel === 1 && (rubber.domicile_id === m.player_id || rubber.domicile_id2 === m.player_id);
                    const advEstReel = jeSuisDomicile ? !!rubber.exterieur_est_reel : !!rubber.domicile_est_reel;
                    const adv1Id = jeSuisDomicile ? rubber.exterieur_id : rubber.domicile_id;
                    const adv1 = identiteJoueurOuRival(advEstReel, adv1Id);
                    const adv2Id = jeSuisDomicile ? rubber.exterieur_id2 : rubber.domicile_id2;
                    const adv2 = adv2Id ? identiteJoueurOuRival(advEstReel, adv2Id) : null;
                    m.adversaire_nom = adv2 ? (adv1.nom + ' / ' + adv2.nom) : (adv1 ? adv1.nom : null);
                    m.adversaire_nationalite = adv1 ? adv1.nationalite : null;
                    m.adversaire_drapeau = drapeau(m.adversaire_nationalite);
                    // Lien cliquable uniquement en simple (un double n'a pas de fiche
                    // adversaire unique vers laquelle pointer).
                    if (adv1 && !adv2) {
                        m.adversaire_player_id = advEstReel ? adv1Id : null;
                        m.adversaire_rival_id = advEstReel ? null : adv1Id;
                    }
                }
                if (tieCoupe) {
                    m.coupe_manche = LABELS_MANCHE[tieCoupe.manche] || tieCoupe.manche;
                    m.coupe_nation_domicile = tieCoupe.nation_domicile;
                    m.coupe_nation_exterieur = tieCoupe.nation_exterieur;
                    const cleDivisions = tieCoupe.saison + '_' + tieCoupe.circuit;
                    if (!(cleDivisions in nbDivisionsCoupeCache)) {
                        nbDivisionsCoupeCache[cleDivisions] = db.prepare('SELECT MAX(division) AS n FROM coupe_equipes WHERE saison = ? AND circuit = ?').get(tieCoupe.saison, tieCoupe.circuit).n || 1;
                    }
                    m.coupe_division = nbDivisionsCoupeCache[cleDivisions] > 1 ? tieCoupe.division : null;
                }
            }
        });

        res.json({ success: true, matchs, semaineActuelle: etat.semaine_actuelle });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/matchs/detail/:matchId', (req, res) => {
    try {
        const { matchId } = req.params;
        const userId = req.userId;

        // Un match de tournoi est public (le tableau lui-meme l'est deja, cf. fiche
        // adversaire) - seuls les matchs amicaux (tournoi_id NULL) restent prives au
        // coach qui les a joues.
        const match = db.prepare(`
            SELECT matchs.*, tournois.nom AS tournoi_nom, players.prenom, players.nom, players.type,
                   tj1.player_id AS tj1_player_id, tj1.nom AS tj1_nom,
                   tj2.player_id AS tj2_player_id, tj2.nom AS tj2_nom
            FROM matchs
            JOIN players ON players.id = matchs.player_id
            LEFT JOIN tournois ON tournois.id = matchs.tournoi_id
            LEFT JOIN tournoi_matchs AS tm ON tm.match_id = matchs.id OR tm.match_id_j2 = matchs.id
            LEFT JOIN tournoi_joueurs AS tj1 ON tj1.id = tm.joueur1_id
            LEFT JOIN tournoi_joueurs AS tj2 ON tj2.id = tm.joueur2_id
            WHERE matchs.id = ? AND (matchs.user_id = ? OR matchs.tournoi_id IS NOT NULL)
        `).get(matchId, userId);

        if (!match) {
            return res.status(404).json({ error: 'Match introuvable.' });
        }

        // Nom de l'adversaire, pour que le Live/Teletexte puisse afficher les vrais
        // noms au lieu de "Toi"/"Adversaire" (demande utilisateur, 2026-08-20) - un
        // match reel-vs-reel a 2 lignes matchs (une par coach), reliees par match_id
        // ET match_id_j2 respectivement, d'ou l'extension du JOIN ci-dessus. Determiner
        // "qui je suis" via QUELLE COLONNE a matche (tente brievement le 2026-08-20)
        // est FAUX pour un simple reel-vs-lambda : tournoi_matchs.match_id pointe
        // TOUJOURS vers l'unique vrai joueur, meme tire en position joueur2_id du
        // tableau - seule la comparaison par player_id est fiable (le lambda a
        // toujours tj_player_id = NULL, jamais egal au mien).
        if (match.tournoi_id) {
            const jeSuisTj1 = match.tj1_player_id === match.player_id;
            match.adversaire_nom = jeSuisTj1 ? match.tj2_nom : match.tj1_nom;
        } else if (match.difficulte === 'coupe' && match.coupe_equipe_id) {
            const rubber = db.prepare(`
                SELECT * FROM coupe_rubbers WHERE coupe_equipe_id = ?
                AND ((domicile_est_reel = 1 AND (domicile_id = ? OR domicile_id2 = ?))
                  OR (exterieur_est_reel = 1 AND (exterieur_id = ? OR exterieur_id2 = ?)))
            `).all(match.coupe_equipe_id, match.player_id, match.player_id, match.player_id, match.player_id)
                .find(function (r) { return libelleRubber(r.numero) === match.numero_tour; });
            if (rubber) {
                const jeSuisDomicile = rubber.domicile_est_reel === 1 && (rubber.domicile_id === match.player_id || rubber.domicile_id2 === match.player_id);
                const advEstReel = jeSuisDomicile ? !!rubber.exterieur_est_reel : !!rubber.domicile_est_reel;
                const adv1 = identiteJoueurOuRival(advEstReel, jeSuisDomicile ? rubber.exterieur_id : rubber.domicile_id);
                const adv2Id = jeSuisDomicile ? rubber.exterieur_id2 : rubber.domicile_id2;
                const adv2 = adv2Id ? identiteJoueurOuRival(advEstReel, adv2Id) : null;
                match.adversaire_nom = adv2 ? (adv1.nom + ' / ' + adv2.nom) : (adv1 ? adv1.nom : null);
            }
        }
        delete match.tj1_player_id; delete match.tj1_nom; delete match.tj2_player_id; delete match.tj2_nom;

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        match.evenements = JSON.parse(match.evenements);
        match.estSemaineActuelle = etat.semaine_actuelle - match.semaine <= 1;

        // Niveau confidentiel (meme principe que le tableau de tournoi, cf. fiche
        // adversaire) : le niveau adverse n'est jamais envoye, quel que soit le
        // spectateur - et le niveau du joueur lui-meme seulement au coach proprietaire
        // de ce match (un tiers qui consulte un match public d'un autre coach ne doit
        // voir le niveau d'aucun des deux).
        delete match.niveau_adversaire;
        if (Number(match.user_id) !== Number(userId)) {
            delete match.niveau_joueur;
        }

        res.json({ success: true, match });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Deroule complet d'un match "public" (pas le mien) affiche derriere un mode de
// visionnage sur un match ou je ne suis pas implique : soit 100% bots (evenements
// stockes directement sur tournoi_matchs), soit un vrai joueur d'un AUTRE coach
// (le deroule vit alors dans sa propre ligne `matchs`, ecrit de SON point de vue -
// "Toi"/"Adversaire" remplaces ici par les vrais noms des 2 entrants pour un
// spectateur neutre). Public comme le reste d'un tableau de tournoi deja tire,
// pas de verification de proprietaire.
app.get('/api/tournois/match-bot/:tournoiMatchId', (req, res) => {
    try {
        const { tournoiMatchId } = req.params;

        const match = db.prepare(`
            SELECT tournoi_matchs.score, tournoi_matchs.evenements, tournoi_matchs.match_id, tournoi_matchs.match_id_j2, tournois.semaine,
                   j1.nom AS joueur1_nom, j1.nationalite AS joueur1_nationalite, j1.player_id AS joueur1_player_id,
                   j2.nom AS joueur2_nom, j2.nationalite AS joueur2_nationalite, j2.player_id AS joueur2_player_id,
                   vj.nom AS vainqueur_nom
            FROM tournoi_matchs
            JOIN tournois ON tournois.id = tournoi_matchs.tournoi_id
            JOIN tournoi_joueurs AS j1 ON j1.id = tournoi_matchs.joueur1_id
            LEFT JOIN tournoi_joueurs AS j2 ON j2.id = tournoi_matchs.joueur2_id
            LEFT JOIN tournoi_joueurs AS vj ON vj.id = tournoi_matchs.vainqueur_id
            WHERE tournoi_matchs.id = ?
        `).get(tournoiMatchId);

        if (!match) {
            return res.status(404).json({ error: 'Match introuvable.' });
        }

        let evenements;
        if (match.evenements) {
            evenements = JSON.parse(match.evenements);
        } else if (match.match_id || match.match_id_j2) {
            const ligne = db.prepare('SELECT player_id, evenements FROM matchs WHERE id = ?').get(match.match_id || match.match_id_j2);
            if (!ligne) {
                return res.status(404).json({ error: 'Match introuvable.' });
            }
            // match_id (cote "j1") n'appartient PAS toujours au joueur1 : pour un match
            // reel-vs-lambda, match_id pointe simplement vers l'unique vrai joueur,
            // quelle que soit sa position dans le tableau (contrairement au reel-vs-reel
            // ou match_id/match_id_j2 correspondent bien a j1/j2). Comparer matchs.player_id
            // aux 2 cotes plutot que de deviner via quelle colonne est renseignee.
            const proprietaireEstJ1 = ligne.player_id === match.joueur1_player_id;
            const nomProprietaire = proprietaireEstJ1 ? match.joueur1_nom : match.joueur2_nom;
            const nomAdversaire = proprietaireEstJ1 ? match.joueur2_nom : match.joueur1_nom;
            evenements = JSON.parse(ligne.evenements).map(function (evt) {
                return evt.texte ? Object.assign({}, evt, { texte: evt.texte.replace(/\bToi\b/g, nomProprietaire).replace(/\bAdversaire\b/g, nomAdversaire) }) : evt;
            });
        } else {
            return res.status(404).json({ error: 'Match introuvable.' });
        }

        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        match.joueur1_drapeau = drapeau(match.joueur1_nationalite);
        match.joueur2_drapeau = drapeau(match.joueur2_nationalite);
        match.evenements = evenements;
        match.estSemaineActuelle = etat.semaine_actuelle - match.semaine <= 1;

        res.json({ success: true, match });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// ---------- Statistiques ----------

// Confrontations entre VRAIS joueurs uniquement (les lambdas jetables des tournois
// n'ont pas d'identite stable d'un tournoi a l'autre, et les 200 rivaux persistants
// par circuit rendraient une matrice complete enorme et peu lisible pour peu de
// confrontations repetees). tournoi_matchs est la seule table qui connait les DEUX
// cotes d'un match (contrairement a `matchs`, cote unique).
app.get('/api/statistiques/confrontations', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT j1.player_id AS p1, j2.player_id AS p2, j1.id AS j1_id, j2.id AS j2_id, tm.vainqueur_id
            FROM tournoi_matchs tm
            JOIN tournoi_joueurs j1 ON j1.id = tm.joueur1_id
            JOIN tournoi_joueurs j2 ON j2.id = tm.joueur2_id
            WHERE j1.est_reel = 1 AND j2.est_reel = 1 AND tm.vainqueur_id IS NOT NULL
        `).all();

        const parPaire = new Map();
        rows.forEach(function (r) {
            const vainqueurPlayerId = r.vainqueur_id === r.j1_id ? r.p1 : r.p2;
            const a = Math.min(r.p1, r.p2), b = Math.max(r.p1, r.p2);
            const cle = a + '-' + b;
            if (!parPaire.has(cle)) parPaire.set(cle, { a, b, victoiresA: 0, victoiresB: 0 });
            const entree = parPaire.get(cle);
            if (vainqueurPlayerId === a) entree.victoiresA++; else entree.victoiresB++;
        });

        const joueursParId = new Map(
            db.prepare("SELECT id, prenom, nom, nationalite, type FROM players WHERE statut = 'valide'").all()
                .map(function (p) { return [p.id, p]; })
        );

        const confrontations = Array.from(parPaire.values())
            .filter(function (c) { return joueursParId.has(c.a) && joueursParId.has(c.b); })
            .map(function (c) {
                const ja = joueursParId.get(c.a);
                const jb = joueursParId.get(c.b);
                return {
                    joueur1: { id: ja.id, prenom: ja.prenom, nom: ja.nom, drapeau: drapeau(ja.nationalite), type: ja.type },
                    joueur2: { id: jb.id, prenom: jb.prenom, nom: jb.nom, drapeau: drapeau(jb.nationalite), type: jb.type },
                    victoires1: c.victoiresA, victoires2: c.victoiresB,
                    nbMatchs: c.victoiresA + c.victoiresB
                };
            })
            .sort(function (x, y) { return y.nbMatchs - x.nbMatchs; });

        res.json({ success: true, confrontations });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Almanach : palmares + top 10 par saison COMPLETE (la saison en cours n'est pas
// archivee tant qu'elle n'est pas terminee). Le classement de fin de saison est
// recalcule a la volee sur la fenetre exacte de cette saison (calculerClassementGlobal),
// pas relu depuis classement_historique qui ne stocke que des photos Live (fenetre
// glissante de 52 semaines) - le "classement de fin de saison" traditionnel, lui,
// correspond a la Race (points marques dans la saison), recalculable a tout moment
// puisque tournois/tournoi_joueurs ne sont jamais purges.
app.get('/api/statistiques/almanach', (req, res) => {
    try {
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const saisonCouranteAffichee = phaseAffichee(etat.semaine_actuelle).numeroSaison;
        const offset = decalageSaison();

        function top10(circuit, semaineDebut, semaineFin) {
            return calculerClassementGlobal(circuit, semaineDebut, semaineFin).slice(0, 10).map(function (c, i) {
                return { rang: i + 1, nom: c.nom, drapeau: c.drapeau, points: c.points };
            });
        }

        const saisons = [];
        for (let n = 1; n < saisonCouranteAffichee; n++) {
            const absN = n + offset;
            const semaineDebut = (absN - 1) * LONGUEUR_SAISON + 1;
            const semaineFin = absN * LONGUEUR_SAISON;

            const tournois = db.prepare(`
                SELECT t.nom, t.circuit, t.categorie,
                       tj.nom AS vainqueur_nom, tj.nationalite AS vainqueur_nationalite,
                       tj.player_id AS vainqueur_player_id, tj.rival_id AS vainqueur_rival_id, tj.est_reel AS vainqueur_est_reel
                FROM tournois t
                LEFT JOIN tournoi_joueurs tj ON tj.tournoi_id = t.id AND tj.tour_elimine = 'Vainqueur'
                WHERE t.categorie IN ('slam', 'finals') AND t.statut = 'termine' AND t.semaine BETWEEN ? AND ?
                ORDER BY t.semaine ASC, t.circuit ASC
            `).all(semaineDebut, semaineFin).map(function (t) {
                return {
                    nom: t.nom, circuit: t.circuit, categorie: t.categorie,
                    vainqueur: t.vainqueur_nom ? {
                        nom: t.vainqueur_nom, drapeau: drapeau(t.vainqueur_nationalite),
                        type: t.vainqueur_est_reel ? 'reel' : 'rival',
                        id: t.vainqueur_est_reel ? t.vainqueur_player_id : t.vainqueur_rival_id
                    } : null
                };
            });

            if (tournois.length === 0) continue;

            saisons.push({
                numeroSaison: n, tournois,
                topAtp: top10('ATP', semaineDebut, semaineFin),
                topWta: top10('WTA', semaineDebut, semaineFin)
            });
        }

        saisons.sort(function (a, b) { return b.numeroSaison - a.numeroSaison; });

        res.json({ success: true, saisons });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// ---------- Statistiques : Records ----------
// Uniquement des VRAIS joueurs partout ici (comme Confrontations) - les requetes
// de base ci-dessous ne filtrent jamais par type/circuit, elles renvoient une
// valeur par player_id ; c'est seulement au moment d'agreger (par joueur ATP, par
// joueuse WTA, ou par coach en sommant ses 2 personnages) qu'on filtre par type.
// Un forfait (blessure) n'est jamais un match "joue" pour ces records.

function joueursReelsParId() {
    return new Map(
        db.prepare("SELECT id, user_id, prenom, nom, nationalite, type FROM players WHERE statut = 'valide'").all()
            .map(function (p) { return [p.id, p]; })
    );
}

function clauseEtParamSurface(colonne, surfaceValide, paramsBase) {
    if (!surfaceValide) return { clause: '', params: paramsBase };
    return { clause: ' AND ' + colonne + ' = ?', params: paramsBase.concat([surfaceValide]) };
}

function donneesTrophees(surfaceValide) {
    const { clause, params } = clauseEtParamSurface('t.surface', surfaceValide, []);
    return db.prepare(`
        SELECT tj.player_id AS playerId, COUNT(*) AS valeur
        FROM tournoi_joueurs tj
        JOIN tournois t ON t.id = tj.tournoi_id
        WHERE tj.est_reel = 1 AND tj.tour_elimine = 'Vainqueur'${clause}
        GROUP BY tj.player_id
    `).all(...params);
}

function donneesVictoires(surfaceValide) {
    const { clause, params } = clauseEtParamSurface('surface', surfaceValide, []);
    return db.prepare(`
        SELECT player_id AS playerId, COUNT(*) AS valeur
        FROM matchs
        WHERE vainqueur = 'joueur' AND score NOT LIKE 'Forfait%'${clause}
        GROUP BY player_id
    `).all(...params);
}

function donneesTotalMatchs(surfaceValide) {
    const { clause, params } = clauseEtParamSurface('surface', surfaceValide, []);
    return db.prepare(`
        SELECT player_id AS playerId, COUNT(*) AS valeur
        FROM matchs
        WHERE score NOT LIKE 'Forfait%'${clause}
        GROUP BY player_id
    `).all(...params);
}

const MIN_MATCHS_RATIO = 5;

function donneesRatioVictoire(surfaceValide) {
    const victoires = new Map(donneesVictoires(surfaceValide).map(function (r) { return [r.playerId, r.valeur]; }));
    const totaux = donneesTotalMatchs(surfaceValide);
    return totaux
        .filter(function (r) { return r.valeur >= MIN_MATCHS_RATIO; })
        .map(function (r) { return { playerId: r.playerId, valeur: (victoires.get(r.playerId) || 0) / r.valeur, victoires: victoires.get(r.playerId) || 0, total: r.valeur }; });
}

function donneesStreakVictoires(surfaceValide) {
    const { clause, params } = clauseEtParamSurface('surface', surfaceValide, []);
    const rows = db.prepare(`
        SELECT player_id AS playerId, semaine, vainqueur
        FROM matchs
        WHERE score NOT LIKE 'Forfait%'${clause}
        ORDER BY player_id, semaine ASC, id ASC
    `).all(...params);

    const parJoueur = new Map();
    rows.forEach(function (r) {
        if (!parJoueur.has(r.playerId)) parJoueur.set(r.playerId, []);
        parJoueur.get(r.playerId).push(r.vainqueur === 'joueur');
    });

    const resultats = [];
    parJoueur.forEach(function (victoiresOrdonnees, playerId) {
        let courant = 0, meilleur = 0;
        victoiresOrdonnees.forEach(function (v) {
            courant = v ? courant + 1 : 0;
            if (courant > meilleur) meilleur = courant;
        });
        resultats.push({ playerId, valeur: meilleur });
    });
    return resultats;
}

function donneesNum1Total() {
    const rows = db.prepare(`
        SELECT cle, COUNT(*) AS valeur FROM classement_historique WHERE rang = 1 AND cle LIKE 'joueur:%' GROUP BY cle
    `).all();
    return rows.map(function (r) { return { playerId: Number(r.cle.split(':')[1]), valeur: r.valeur }; });
}

function donneesNum1Consecutif() {
    const rows = db.prepare(`
        SELECT cle, semaine, rang FROM classement_historique WHERE cle LIKE 'joueur:%' ORDER BY cle, semaine ASC
    `).all();
    const parCle = new Map();
    rows.forEach(function (r) {
        if (!parCle.has(r.cle)) parCle.set(r.cle, []);
        parCle.get(r.cle).push(r);
    });
    const resultats = [];
    parCle.forEach(function (liste, cle) {
        let courant = 0, meilleur = 0, semainePrecedente = null;
        liste.forEach(function (r) {
            if (r.rang === 1 && semainePrecedente !== null && r.semaine === semainePrecedente + 1) courant++;
            else if (r.rang === 1) courant = 1;
            else courant = 0;
            if (courant > meilleur) meilleur = courant;
            semainePrecedente = r.semaine;
        });
        resultats.push({ playerId: Number(cle.split(':')[1]), valeur: meilleur });
    });
    return resultats;
}

function donneesPointsRace() {
    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const semaineActuelle = etat.semaine_actuelle;
    const positionSaisonBrute = ((semaineActuelle - 1) % LONGUEUR_SAISON) + 1;
    const debutSaison = semaineActuelle - positionSaisonBrute + 2;
    const resultats = [];
    ['ATP', 'WTA'].forEach(function (circuit) {
        calculerClassementGlobal(circuit, debutSaison, semaineActuelle)
            .filter(function (c) { return c.playerId !== null; })
            .forEach(function (c) { resultats.push({ playerId: c.playerId, valeur: c.points }); });
    });
    return resultats;
}

function donneesBreakSauveesMatch(surfaceValide) {
    const { clause, params } = clauseEtParamSurface('surface', surfaceValide, []);
    return db.prepare(`
        SELECT player_id AS playerId, MAX(balles_break_sauvees) AS valeur
        FROM matchs
        WHERE score NOT LIKE 'Forfait%'${clause}
        GROUP BY player_id
    `).all(...params);
}

function donneesBreakSauveesTournoi(surfaceValide) {
    const { clause, params } = clauseEtParamSurface('m.surface', surfaceValide, []);
    const rows = db.prepare(`
        SELECT m.player_id AS playerId, m.tournoi_id AS tournoiId, t.nom AS tournoiNom, SUM(m.balles_break_sauvees) AS total
        FROM matchs m
        JOIN tournoi_joueurs tj ON tj.tournoi_id = m.tournoi_id AND tj.player_id = m.player_id AND tj.est_reel = 1
        JOIN tournois t ON t.id = m.tournoi_id
        WHERE tj.tour_elimine = 'Vainqueur' AND m.score NOT LIKE 'Forfait%'${clause}
        GROUP BY m.player_id, m.tournoi_id
    `).all(...params);

    const meilleurParJoueur = new Map();
    rows.forEach(function (r) {
        const actuel = meilleurParJoueur.get(r.playerId);
        if (!actuel || r.total > actuel.valeur) meilleurParJoueur.set(r.playerId, { valeur: r.total, tournoiId: r.tournoiId, tournoiNom: r.tournoiNom });
    });
    return Array.from(meilleurParJoueur.entries()).map(function ([playerId, v]) { return { playerId, valeur: v.valeur, tournoiId: v.tournoiId, tournoiNom: v.tournoiNom }; });
}

function donneesRivalite(surfaceValide) {
    const { clause, params } = clauseEtParamSurface('t.surface', surfaceValide, []);
    const rows = db.prepare(`
        SELECT j1.player_id AS p1, j2.player_id AS p2, j1.id AS j1_id, j2.id AS j2_id, tm.vainqueur_id
        FROM tournoi_matchs tm
        JOIN tournoi_joueurs j1 ON j1.id = tm.joueur1_id
        JOIN tournoi_joueurs j2 ON j2.id = tm.joueur2_id
        JOIN tournois t ON t.id = tm.tournoi_id
        WHERE j1.est_reel = 1 AND j2.est_reel = 1 AND tm.vainqueur_id IS NOT NULL${clause}
    `).all(...params);

    const parPaire = new Map();
    rows.forEach(function (r) {
        const vainqueurPlayerId = r.vainqueur_id === r.j1_id ? r.p1 : r.p2;
        const a = Math.min(r.p1, r.p2), b = Math.max(r.p1, r.p2);
        const cle = a + '-' + b;
        if (!parPaire.has(cle)) parPaire.set(cle, { a, b, victoiresA: 0, victoiresB: 0 });
        const entree = parPaire.get(cle);
        if (vainqueurPlayerId === a) entree.victoiresA++; else entree.victoiresB++;
    });
    return Array.from(parPaire.values());
}

// Formate le detenteur d'un record cote joueur (fiche adversaire.html?type=reel).
function detenteurJoueur(joueursById, playerId) {
    const j = joueursById.get(playerId);
    if (!j) return null;
    return { id: j.id, prenom: j.prenom, nom: j.nom, drapeau: drapeau(j.nationalite), type: j.type };
}

// Meilleur joueur d'un circuit donne pour une serie de donnees {playerId, valeur}.
function meilleurJoueurCircuit(donnees, joueursById, type) {
    let meilleur = null;
    donnees.forEach(function (d) {
        const j = joueursById.get(d.playerId);
        if (!j || j.type !== type) return;
        if (!meilleur || d.valeur > meilleur.valeur) meilleur = d;
    });
    if (!meilleur) return null;
    return { valeur: meilleur.valeur, joueur: detenteurJoueur(joueursById, meilleur.playerId), extra: meilleur };
}

// Meilleur coach pour une serie de donnees {playerId, valeur}, en agregeant les 2
// personnages d'un meme coach : 'somme' pour les stats cumulatives (trophees,
// victoires, matchs, points Race), 'max' pour les series/records ponctuels (streak,
// duree num1 consecutive, meilleure perf sur un seul match/tournoi) qui n'ont pas de
// sens additionnes entre 2 personnages/circuits differents.
function meilleurCoach(donnees, joueursById, mode) {
    const parCoach = new Map();
    donnees.forEach(function (d) {
        const j = joueursById.get(d.playerId);
        if (!j) return;
        if (mode === 'max') {
            const actuel = parCoach.get(j.user_id);
            if (!actuel || d.valeur > actuel.valeur) parCoach.set(j.user_id, d);
        } else {
            const actuel = parCoach.get(j.user_id) || 0;
            parCoach.set(j.user_id, actuel + d.valeur);
        }
    });
    let meilleurUserId = null, meilleurValeur = -Infinity, meilleurExtra = null;
    parCoach.forEach(function (valeurOuObjet, userId) {
        const valeur = mode === 'max' ? valeurOuObjet.valeur : valeurOuObjet;
        if (valeur > meilleurValeur) { meilleurValeur = valeur; meilleurUserId = userId; meilleurExtra = mode === 'max' ? valeurOuObjet : null; }
    });
    if (meilleurUserId === null || meilleurValeur <= 0) return null;
    return { valeur: meilleurValeur, coach: { userId: meilleurUserId, pseudo: nomCoach(meilleurUserId) }, extra: meilleurExtra };
}

function meilleureRivaliteCircuit(paires, joueursById, type) {
    let meilleure = null;
    paires.forEach(function (p) {
        const ja = joueursById.get(p.a), jb = joueursById.get(p.b);
        if (!ja || !jb || ja.type !== type || jb.type !== type) return;
        const nbMatchs = p.victoiresA + p.victoiresB;
        if (!meilleure || nbMatchs > meilleure.nbMatchs) {
            meilleure = { nbMatchs, joueur1: detenteurJoueur(joueursById, p.a), joueur2: detenteurJoueur(joueursById, p.b), victoires1: p.victoiresA, victoires2: p.victoiresB };
        }
    });
    return meilleure;
}

function meilleureRivaliteCoachs(paires, joueursById) {
    const parPaireCoach = new Map();
    paires.forEach(function (p) {
        const ja = joueursById.get(p.a), jb = joueursById.get(p.b);
        if (!ja || !jb || ja.user_id === jb.user_id) return;
        const uA = Math.min(ja.user_id, jb.user_id), uB = Math.max(ja.user_id, jb.user_id);
        const cle = uA + '-' + uB;
        const nbMatchs = p.victoiresA + p.victoiresB;
        parPaireCoach.set(cle, (parPaireCoach.get(cle) || 0) + nbMatchs);
    });
    let meilleurCle = null, meilleurValeur = 0;
    parPaireCoach.forEach(function (valeur, cle) {
        if (valeur > meilleurValeur) { meilleurValeur = valeur; meilleurCle = cle; }
    });
    if (!meilleurCle) return null;
    const [uA, uB] = meilleurCle.split('-').map(Number);
    return { nbMatchs: meilleurValeur, coach1: { userId: uA, pseudo: nomCoach(uA) }, coach2: { userId: uB, pseudo: nomCoach(uB) } };
}

app.get('/api/statistiques/records', (req, res) => {
    try {
        const vue = ['ATP', 'WTA', 'coachs'].includes(req.query.vue) ? req.query.vue : 'ATP';
        const surfaceValide = ['dur', 'terre', 'herbe'].includes(req.query.surface) ? req.query.surface : null;
        const joueursById = joueursReelsParId();
        const type = vue === 'WTA' ? 'joueuse' : 'joueur';

        const rivalite = donneesRivalite(surfaceValide);
        const trophees = donneesTrophees(surfaceValide);
        const victoires = donneesVictoires(surfaceValide);
        const streak = donneesStreakVictoires(surfaceValide);
        const totalMatchs = donneesTotalMatchs(surfaceValide);
        const ratio = donneesRatioVictoire(surfaceValide);
        const breakMatch = donneesBreakSauveesMatch(surfaceValide);
        const breakTournoi = donneesBreakSauveesTournoi(surfaceValide);

        let resultats;
        if (vue === 'coachs') {
            resultats = {
                rivalite: meilleureRivaliteCoachs(rivalite, joueursById),
                trophees: meilleurCoach(trophees, joueursById, 'somme'),
                victoires: meilleurCoach(victoires, joueursById, 'somme'),
                victoiresConsecutives: meilleurCoach(streak, joueursById, 'max'),
                totalMatchs: meilleurCoach(totalMatchs, joueursById, 'somme'),
                ratioVictoire: meilleurCoach(ratio, joueursById, 'max'),
                breakSauveesMatch: meilleurCoach(breakMatch, joueursById, 'max'),
                breakSauveesTournoi: meilleurCoach(breakTournoi, joueursById, 'max')
            };
            if (!surfaceValide) {
                resultats.dureeNum1 = meilleurCoach(donneesNum1Total(), joueursById, 'somme');
                resultats.dureeNum1Consecutive = meilleurCoach(donneesNum1Consecutif(), joueursById, 'max');
                resultats.pointsRace = meilleurCoach(donneesPointsRace(), joueursById, 'somme');
            }
        } else {
            resultats = {
                rivalite: meilleureRivaliteCircuit(rivalite, joueursById, type),
                trophees: meilleurJoueurCircuit(trophees, joueursById, type),
                victoires: meilleurJoueurCircuit(victoires, joueursById, type),
                victoiresConsecutives: meilleurJoueurCircuit(streak, joueursById, type),
                totalMatchs: meilleurJoueurCircuit(totalMatchs, joueursById, type),
                ratioVictoire: meilleurJoueurCircuit(ratio, joueursById, type),
                breakSauveesMatch: meilleurJoueurCircuit(breakMatch, joueursById, type),
                breakSauveesTournoi: meilleurJoueurCircuit(breakTournoi, joueursById, type)
            };
            if (!surfaceValide) {
                resultats.dureeNum1 = meilleurJoueurCircuit(donneesNum1Total(), joueursById, type);
                resultats.dureeNum1Consecutive = meilleurJoueurCircuit(donneesNum1Consecutif(), joueursById, type);
                resultats.pointsRace = meilleurJoueurCircuit(donneesPointsRace(), joueursById, type);
            }
        }

        res.json({ success: true, resultats });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// ---------- Presse ----------

// Enrichit une ligne brute articles_presse (+ jointures tournoi/joueur) avec les
// libelles/liens prets a afficher - partage entre la liste et le detail.
function formaterArticle(a) {
    return {
        id: a.id,
        titre: a.titre,
        contenu: a.contenu,
        imagePath: a.image_path,
        dateCreation: a.date_creation,
        auteur: nomCoach(a.user_id),
        auteurUserId: a.user_id,
        lienTournoi: a.lien_tournoi_id ? {
            id: a.lien_tournoi_id, nom: a.tournoi_nom, calendrierId: a.tournoi_calendrier_id, semaine: a.tournoi_semaine
        } : null,
        lienJoueur: a.lien_player_id ? {
            id: a.lien_player_id, prenom: a.joueur_prenom, nom: a.joueur_nom, type: a.joueur_type, drapeau: drapeau(a.joueur_nationalite)
        } : null
    };
}

const SELECT_ARTICLE = `
    SELECT ap.*, t.nom AS tournoi_nom, t.calendrier_id AS tournoi_calendrier_id, t.semaine AS tournoi_semaine,
           p.prenom AS joueur_prenom, p.nom AS joueur_nom, p.type AS joueur_type, p.nationalite AS joueur_nationalite
    FROM articles_presse ap
    LEFT JOIN tournois t ON t.id = ap.lien_tournoi_id
    LEFT JOIN players p ON p.id = ap.lien_player_id
`;

// Options pour le formulaire de creation d'article (lien optionnel vers un
// tournoi termine ou un joueur reel valide) - limite a 100 tournois (les plus
// recents) pour garder un menu deroulant raisonnable meme apres plusieurs saisons.
app.get('/api/presse/options-liens', (req, res) => {
    try {
        const joueurs = db.prepare("SELECT id, prenom, nom, type FROM players WHERE statut = 'valide' ORDER BY prenom").all();
        const tournois = db.prepare("SELECT id, nom, semaine, circuit FROM tournois WHERE statut = 'termine' ORDER BY semaine DESC LIMIT 100").all();
        tournois.forEach(function (t) { t.positionSemaine = positionSemaineAffichee(t.semaine); });
        res.json({ success: true, joueurs, tournois });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/presse', (req, res) => {
    try {
        const articles = db.prepare(SELECT_ARTICLE + ' ORDER BY ap.id DESC').all();
        res.json({ success: true, articles: articles.map(formaterArticle) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/presse/:id', (req, res) => {
    try {
        const article = db.prepare(SELECT_ARTICLE + ' WHERE ap.id = ?').get(req.params.id);
        if (!article) {
            return res.status(404).json({ error: 'Article introuvable.' });
        }
        res.json({ success: true, article: formaterArticle(article) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/presse', function (req, res) {
    uploadPresse.single('image')(req, res, function (erreurUpload) {
        if (erreurUpload) {
            return res.status(400).json({ error: erreurUpload.code === 'LIMIT_FILE_SIZE' ? 'Image trop volumineuse (5 Mo maximum).' : erreurUpload.message });
        }

        try {
            const userId = req.userId;
            const { titre, contenu, lienTournoiId, lienPlayerId } = req.body;

            const user = db.prepare('SELECT est_redacteur FROM users WHERE id = ?').get(userId);
            if (!user || !user.est_redacteur) {
                if (req.file) fs.unlink(req.file.path, function () {});
                return res.status(403).json({ error: 'Seuls les rédacteurs autorisés par l\'administrateur peuvent publier un article.' });
            }
            if (!titre || !titre.trim() || !contenu || !contenu.trim()) {
                if (req.file) fs.unlink(req.file.path, function () {});
                return res.status(400).json({ error: 'Titre et contenu sont obligatoires.' });
            }
            if (lienTournoiId && lienPlayerId) {
                if (req.file) fs.unlink(req.file.path, function () {});
                return res.status(400).json({ error: 'Un article ne peut être lié qu\'à un seul élément (tournoi OU joueur).' });
            }

            const imagePath = req.file ? '/uploads/presse/' + req.file.filename : null;

            const insertion = db.prepare(`
                INSERT INTO articles_presse (user_id, titre, contenu, image_path, lien_tournoi_id, lien_player_id, date_creation)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(userId, titre.trim(), contenu.trim(), imagePath, lienTournoiId || null, lienPlayerId || null, new Date().toISOString());

            res.json({ success: true, articleId: insertion.lastInsertRowid });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });
});

// Modification d'un article existant - meme regle d'autorisation que la
// suppression (auteur ou admin). Le champ `supprimerImage` ('true') retire la
// photo sans en mettre une nouvelle ; sinon, un nouveau fichier envoye remplace
// l'ancien (ancien fichier supprime) ; sinon la photo actuelle est conservee.
app.put('/api/presse/:id', function (req, res) {
    uploadPresse.single('image')(req, res, function (erreurUpload) {
        if (erreurUpload) {
            return res.status(400).json({ error: erreurUpload.code === 'LIMIT_FILE_SIZE' ? 'Image trop volumineuse (5 Mo maximum).' : erreurUpload.message });
        }

        try {
            const { titre, contenu, lienTournoiId, lienPlayerId, supprimerImage } = req.body;

            const article = db.prepare('SELECT * FROM articles_presse WHERE id = ?').get(req.params.id);
            if (!article) {
                if (req.file) fs.unlink(req.file.path, function () {});
                return res.status(404).json({ error: 'Article introuvable.' });
            }
            if (Number(article.user_id) !== Number(req.userId) && !estAdmin(req.userId)) {
                if (req.file) fs.unlink(req.file.path, function () {});
                return res.status(403).json({ error: 'Tu ne peux modifier que tes propres articles.' });
            }
            if (!titre || !titre.trim() || !contenu || !contenu.trim()) {
                if (req.file) fs.unlink(req.file.path, function () {});
                return res.status(400).json({ error: 'Titre et contenu sont obligatoires.' });
            }
            if (lienTournoiId && lienPlayerId) {
                if (req.file) fs.unlink(req.file.path, function () {});
                return res.status(400).json({ error: 'Un article ne peut être lié qu\'à un seul élément (tournoi OU joueur).' });
            }

            let imagePath = article.image_path;
            if (req.file) {
                if (article.image_path) fs.unlink(path.join(__dirname, article.image_path), function () {});
                imagePath = '/uploads/presse/' + req.file.filename;
            } else if (supprimerImage === 'true') {
                if (article.image_path) fs.unlink(path.join(__dirname, article.image_path), function () {});
                imagePath = null;
            }

            db.prepare(`
                UPDATE articles_presse SET titre = ?, contenu = ?, image_path = ?, lien_tournoi_id = ?, lien_player_id = ?
                WHERE id = ?
            `).run(titre.trim(), contenu.trim(), imagePath, lienTournoiId || null, lienPlayerId || null, req.params.id);

            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });
});

app.delete('/api/presse/:id', (req, res) => {
    try {
        const article = db.prepare('SELECT * FROM articles_presse WHERE id = ?').get(req.params.id);
        if (!article) {
            return res.status(404).json({ error: 'Article introuvable.' });
        }
        if (Number(article.user_id) !== Number(req.userId) && !estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Tu ne peux supprimer que tes propres articles.' });
        }

        if (article.image_path) {
            fs.unlink(path.join(__dirname, article.image_path), function () {});
        }
        db.prepare('DELETE FROM articles_presse WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Annonce unique de l'administrateur (pas une liste, une seule ligne toujours
// ecrasee) - affichee en bas de la page Presse pour tous les coachs.
app.get('/api/annonce', (req, res) => {
    try {
        const annonce = db.prepare('SELECT contenu, date_modification FROM annonce_admin WHERE id = 1').get();
        res.json({ success: true, contenu: annonce.contenu, dateModification: annonce.date_modification });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/annonce', (req, res) => {
    try {
        const { contenu } = req.body;
        if (!estAdmin(req.userId)) {
            return res.status(403).json({ error: 'Acces reserve a l administrateur.' });
        }

        db.prepare('UPDATE annonce_admin SET contenu = ?, date_modification = ? WHERE id = 1').run((contenu || '').trim(), new Date().toISOString());
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// ---------- Coupe Davis / Billie Jean King Cup (ex-Fed Cup) ----------
// Ancien format (2026-07-28) : 16 nations par circuit, tableau a elimination
// directe (1er tour/Quarts/Demies/Finale), chaque manche = 5 rencontres (2
// simples/1 double/2 simples retour). Capitaine designe une fois par saison
// (candidature Pre-saison+S0, vote S1), puis pour CHAQUE manche : surface (S-3),
// composition/ordre (S-2), styles (S-1), matchs (S0) - cf. memoire
// project_discord_et_pistes_futures pour l'historique complet de la conception.
//
// Groupe mondial + promotion/relegation (2026-08-12, demande explicite) : le
// tableau de 16 n'est plus retire integralement chaque saison. Les 8 vainqueurs
// du 1er tour sont maintenus AUTOMATIQUEMENT dans le Groupe mondial l'annee
// suivante (quel que soit leur parcours ensuite en quarts/demies/finale, qui ne
// determinent que le vainqueur sportif de la saison). Les 8 perdants du 1er tour
// jouent en meme temps que les demies (S37) un barrage de maintien contre les 8
// meilleures nations HORS Groupe mondial (classement Live du moment) ; les 8
// vainqueurs de ce barrage completent le Groupe mondial a 16 la saison suivante.
// Cf. memoire project_coupe_groupe_mondial.

const MANCHES_COUPE = ['1er_tour', 'quarts', 'demies', 'finale'];
const LABELS_MANCHE = { '1er_tour': '1er tour', quarts: 'Quarts de finale', demies: 'Demi-finales', finale: 'Finale', barrage: 'Barrage de maintien' };

// Libelle d'une rencontre (numero 1-5) - partage entre l'ecriture des lignes matchs
// (simulerMancheCoupe) et leur relecture sur la page Matchs (matchs.numero_tour).
// Format 2 simples (chacun rejoue une 2e fois en position inversee) + 1 double.
// Les 2 simples retour se nomment "Simple 3"/"Simple 4" plutot que "Simple 1/2
// (retour)" (demande explicite de l'utilisateur, 2026-08-26).
function libelleRubber(numero) {
    if (numero === 3) return 'Coupe - Double';
    return 'Coupe - Simple ' + (numero < 3 ? numero : numero - 1);
}

// Tous les joueurs eligibles pour representer une nation sur un circuit donne :
// vrais joueurs valides de cette nationalite + rivaux persistants du roster. Un
// rival n'a qu'un niveau plat (pas de detail par surface), coherent avec le
// traitement deja applique ailleurs (resoudreMatchAdversaire, lambda-vs-lambda).
// Identite (nom complet + nationalite) d'un vrai joueur ou d'un rival, utilisee pour
// afficher l'adversaire d'un match de Coupe Davis/Fed Cup sur la page Matchs (pas de
// tournoi_matchs ici, l'identite se retrouve via coupe_rubbers).
function identiteJoueurOuRival(estReel, id) {
    if (!id) return null;
    if (estReel) {
        const p = db.prepare('SELECT prenom, nom, nationalite FROM players WHERE id = ?').get(id);
        return p ? { nom: p.prenom + ' ' + p.nom.toUpperCase(), nationalite: p.nationalite } : null;
    }
    const r = db.prepare('SELECT nom, nationalite FROM classement_joueurs WHERE id = ?').get(id);
    return r ? { nom: r.nom, nationalite: r.nationalite } : null;
}

// Complete le roster persistant de rivaux d'une nation si elle n'a pas assez de
// joueurs (reels + rivaux existants) pour remplir une composition de Coupe Davis/
// Fed Cup (4 simples distincts + 1 paire de double) - genere alors de nouveaux
// rivaux PERSISTANTS (jamais jetables, contrairement aux lambdas de tournoi) avec
// cette nationalite, une seule fois pour de bon. Necessaire car le roster de 200
// rivaux/circuit genere a la creation du jeu tire une nationalite au hasard par
// joueur (genererJoueurLambda) : sur 200 tirages, une grande partie des ~190
// nationalites possibles du jeu n'a jamais ete tiree (22 seulement couvertes en
// pratique) - demande explicite de l'utilisateur, 2026-08-25, plutot que des bots
// jetables regeneres a chaque fois (qui ne laisseraient aucune trace stable dans
// les classements/confrontations, contrairement aux rivaux habituels).
const MINIMUM_JOUEURS_NATION_COUPE = 5;
function assurerRosterMinimalNation(circuit, nation) {
    const nbActuel = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM players WHERE statut = 'valide' AND type = ? AND nationalite = ?) +
            (SELECT COUNT(*) FROM classement_joueurs WHERE circuit = ? AND nationalite = ?) AS n
    `).get(circuit === 'ATP' ? 'joueur' : 'joueuse', nation, circuit, nation).n;
    const manquants = MINIMUM_JOUEURS_NATION_COUPE - nbActuel;
    if (manquants <= 0) return;

    const estFeminin = circuit === 'WTA';
    const nomsExistants = new Set(db.prepare('SELECT nom FROM classement_joueurs WHERE circuit = ?').all(circuit).map(function (r) { return r.nom; }));
    const insert = db.prepare('INSERT INTO classement_joueurs (circuit, nom, nationalite, niveau) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < manquants; i++) {
        const categorie = CATEGORIES_ROSTER[Math.floor(Math.random() * CATEGORIES_ROSTER.length)];
        let rival;
        do { rival = genererJoueurLambda(categorie, estFeminin); } while (nomsExistants.has(rival.nom));
        nomsExistants.add(rival.nom);
        const fourchette = NIVEAU_ROSTER_PAR_CATEGORIE[categorie];
        const niveau = Math.round(fourchette.min + Math.random() * (fourchette.max - fourchette.min));
        insert.run(circuit, rival.nom, nation, niveau);
    }
}

function joueursEligiblesNation(circuit, nation) {
    assurerRosterMinimalNation(circuit, nation);
    const type = circuit === 'ATP' ? 'joueur' : 'joueuse';
    const reels = db.prepare("SELECT id, user_id, prenom, nom FROM players WHERE statut = 'valide' AND type = ? AND nationalite = ?").all(type, nation)
        .map(function (p) { return { estReel: true, id: p.id, userId: p.user_id, nom: p.prenom + ' ' + p.nom.toUpperCase() }; });
    const rivaux = db.prepare('SELECT id, nom, niveau FROM classement_joueurs WHERE circuit = ? AND nationalite = ?').all(circuit, nation)
        .map(function (r) { return { estReel: false, id: r.id, userId: null, nom: r.nom, niveau: r.niveau }; });
    return reels.concat(rivaux);
}

// Classement d'une nation (PDF) : cumul des points Live des 4 meilleurs joueurs
// (reels ou rivaux) de cette nationalite - utilise pour le seeding du Groupe
// mondial, le tirage du 1er tour et la selection/le seeding des challengers de
// barrage, ET repris tel quel par le classement NATION public (classementNationsSomme,
// classements.html). calculerClassementGlobal renvoie deja un classement trie par
// points decroissants : les 4 premieres occurrences rencontrees pour une nation
// donnee sont donc bien ses 4 meilleurs joueurs, en un seul passage.
function classementNationsTop4(circuit) {
    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const classement = calculerClassementGlobal(circuit, etat.semaine_actuelle - FENETRE_LIVE, etat.semaine_actuelle);
    const parNation = new Map();
    classement.forEach(function (c) {
        if (!c.nationalite) return;
        // Cle normalisee (sans accents/casse) car un meme pays peut etre orthographie
        // differemment selon la source du joueur (rivaux/lambdas non-accentues vs
        // formulaire de creation accentue) - voir normaliserPays(). Le libelle affiche
        // reste la premiere graphie rencontree.
        const cle = normaliserPays(c.nationalite);
        const compte = parNation.get(cle) || { total: 0, n: 0, libelle: c.nationalite };
        if (compte.n < 4) {
            compte.total += c.points;
            compte.n += 1;
            parNation.set(cle, compte);
        }
    });
    const totaux = new Map();
    parNation.forEach(function (v) { totaux.set(v.libelle, v.total); });
    return totaux;
}

function nombreSaisonAffichee() {
    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    return phaseAffichee(etat.semaine_actuelle).numeroSaison;
}

// Constitue le Groupe mondial (16 nations) d'une saison/circuit, si ce n'est pas
// deja fait (idempotent) : soit un bootstrap (toute 1ere edition - les 16
// meilleures nations au classement Live), soit une reconduction de la saison
// precedente (8 maintenues + 8 promues du barrage - voir plus haut).
function constituerGroupeMondial(circuit, saison) {
    const dejaConstitue = db.prepare('SELECT COUNT(*) AS n FROM coupe_groupe_mondial WHERE saison = ? AND circuit = ?').get(saison, circuit).n;
    if (dejaConstitue > 0) return;

    const saisonPrecedente = db.prepare('SELECT MAX(saison) AS s FROM coupe_groupe_mondial WHERE circuit = ? AND saison < ?').get(circuit, saison).s;

    let nations;
    if (!saisonPrecedente) {
        const parNation = classementNationsTop4(circuit);
        nations = Array.from(parNation.keys())
            .sort(function (a, b) { return parNation.get(b) - parNation.get(a); })
            .slice(0, 16);
    } else {
        const maintenues = db.prepare(`
            SELECT nation_vainqueur AS nation FROM coupe_equipes
            WHERE saison = ? AND circuit = ? AND manche = '1er_tour' AND statut = 'termine'
        `).all(saisonPrecedente, circuit).map(function (r) { return r.nation; });
        const promues = db.prepare(`
            SELECT nation_vainqueur AS nation FROM coupe_equipes
            WHERE saison = ? AND circuit = ? AND manche = 'barrage' AND statut = 'termine'
        `).all(saisonPrecedente, circuit).map(function (r) { return r.nation; });
        nations = maintenues.concat(promues);
    }

    nations.forEach(function (nation) {
        db.prepare('INSERT OR IGNORE INTO coupe_groupe_mondial (saison, circuit, nation) VALUES (?, ?, ?)').run(saison, circuit, nation);
    });
}

// Cree les 8 ties du 1er tour pour une saison/circuit donnes, si ce n'est pas deja
// fait (idempotent). Appelee au debut de la Pre-saison. Pas de Coupe Davis/Fed Cup
// en Saison 1 (choix explicite de l'utilisateur) : les rangs de meilleur joueur par
// nation ne seraient sinon composes que de rivaux fictifs faute d'assez de vrais
// coachs inscrits en tout debut de partie - on laisse le temps a de vrais joueurs
// de rejoindre avant la 1ere edition, en Saison 2.
function assurerTableauCoupe(circuit) {
    const saison = nombreSaisonAffichee();
    if (saison <= 1) return;
    const existe = db.prepare('SELECT COUNT(*) AS n FROM coupe_equipes WHERE saison = ? AND circuit = ?').get(saison, circuit).n;
    if (existe > 0) return;

    constituerGroupeMondial(circuit, saison);
    const nations = db.prepare('SELECT nation FROM coupe_groupe_mondial WHERE saison = ? AND circuit = ?').all(saison, circuit).map(function (r) { return r.nation; });
    if (nations.length < 16) return; // pas encore assez de nations connues (ne devrait pas arriver une fois la partie lancee)

    // Seeding du 1er tour par classement Live courant (1 vs 16, 2 vs 15, etc.),
    // la nation la mieux classee de chaque paire recoit l'avantage du terrain.
    const parNation = classementNationsTop4(circuit);
    const nationsSeeds = nations.slice().sort(function (a, b) {
        return (parNation.get(b) || 0) - (parNation.get(a) || 0);
    });

    // Appelee EXACTEMENT au debut de la Pre-saison (position 1 du cycle de 54) :
    // semaine_actuelle EST donc la semaine de Pre-saison elle-meme. La Semaine 5
    // (position 7 : 1=presaison, 2=S0, 3=S1...7=S5) tombe 6 semaines plus tard.
    const etatCourant = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const semaineDuMatch = etatCourant.semaine_actuelle + 6;

    for (let i = 0; i < 8; i++) {
        db.prepare(`
            INSERT INTO coupe_equipes (saison, circuit, manche, semaine, nation_domicile, nation_exterieur, statut, position, division)
            VALUES (?, ?, '1er_tour', ?, ?, ?, 'a_venir', ?, 1)
        `).run(saison, circuit, semaineDuMatch, nationsSeeds[i], nationsSeeds[15 - i], i);
    }
}

// Semaine de match de chaque manche (position dans le cycle de saison, cf.
// SEMAINES_COUPES_EQUIPE), reindexee sur les cles internes de MANCHES_COUPE.
const SEMAINE_PAR_MANCHE = {
    '1er_tour': SEMAINES_COUPES_EQUIPE[0].semaine,
    quarts: SEMAINES_COUPES_EQUIPE[1].semaine,
    demies: SEMAINES_COUPES_EQUIPE[2].semaine,
    finale: SEMAINES_COUPES_EQUIPE[3].semaine
};

// Barrage de maintien : une fois les 8 ties du 1er tour terminees, oppose les 8
// nations perdantes aux 8 meilleures nations HORS Groupe mondial actuel (classement
// Live du moment). Seeding : le perdant le mieux classe affronte le challenger le
// moins bien classe (et inversement), le perdant recoit l'avantage du terrain (il
// defend sa place). Le vainqueur de chaque barrage rejoint le Groupe mondial de la
// saison suivante (cf. constituerGroupeMondial) - pas de manche apres le barrage,
// contrairement a 1er_tour/quarts/demies/finale.
function genererBarrage(saison, circuit) {
    const dejaGeneree = db.prepare("SELECT COUNT(*) AS n FROM coupe_equipes WHERE saison = ? AND circuit = ? AND manche = 'barrage'").get(saison, circuit).n;
    if (dejaGeneree > 0) return;

    const premiersTours = db.prepare("SELECT * FROM coupe_equipes WHERE saison = ? AND circuit = ? AND manche = '1er_tour'").all(saison, circuit);
    if (premiersTours.length === 0 || premiersTours.some(function (t) { return t.statut !== 'termine'; })) return;

    const perdants = premiersTours.map(function (t) {
        return t.nation_vainqueur === t.nation_domicile ? t.nation_exterieur : t.nation_domicile;
    });

    const membresGroupe = new Set(db.prepare('SELECT nation FROM coupe_groupe_mondial WHERE saison = ? AND circuit = ?').all(saison, circuit).map(function (r) { return r.nation; }));
    const parNation = classementNationsTop4(circuit);
    const challengers = Array.from(parNation.keys())
        .filter(function (n) { return !membresGroupe.has(n); })
        .sort(function (a, b) { return parNation.get(b) - parNation.get(a); })
        .slice(0, 8);
    if (challengers.length < 8) return; // pas assez de nations candidates hors Groupe mondial (partie encore jeune)

    const perdantsTries = perdants.slice().sort(function (a, b) {
        return (parNation.get(b) || 0) - (parNation.get(a) || 0);
    });

    const semaineBarrage = premiersTours[0].semaine + (SEMAINES_COUPES_EQUIPE[2].semaine - SEMAINES_COUPES_EQUIPE[0].semaine);

    perdantsTries.forEach(function (perdant, i) {
        db.prepare(`
            INSERT INTO coupe_equipes (saison, circuit, manche, semaine, nation_domicile, nation_exterieur, statut, position, division)
            VALUES (?, ?, 'barrage', ?, ?, ?, 'a_venir', ?, 1)
        `).run(saison, circuit, semaineBarrage, perdant, challengers[7 - i], i);
        // Filet de securite : le capitaine de chaque nation a deja ete designe en
        // debut de saison par resoudreCapitainesSaison (candidature/vote ou repli),
        // donc dejaDesigne interrompt resoudreCapitaine immediatement ici dans le cas
        // normal. Ne sert que si une nation a rejoint le jeu trop tard pour avoir eu
        // sa fenetre de candidature/vote.
        resoudreCapitaine(saison, circuit, challengers[7 - i]);
    });
}

// Une fois TOUTES les ties d'une manche terminees, genere la manche suivante en
// appariant les vainqueurs par position consecutive (0&1 -> 0, 2&3 -> 1, etc.) -
// pas de protection de tete de serie façon "S-curve" au-dela du 1er tour, simplification
// assumee (cf. memoire project_discord_et_pistes_futures). Chaque division (s'il y en
// a plusieurs) est traitee independamment : une division peut generer sa manche
// suivante sans attendre qu'une autre division ait fini la sienne.
function genererMancheSuivante(saison, circuit, mancheActuelle) {
    // Le barrage n'est PLUS genere ici (retire le 2026-08-27, demande explicite de
    // l'utilisateur) : le 1er tour se joue et se termine des la semaine S5-S6,
    // beaucoup trop tot pour designer equitablement les 8 nations challengers hors
    // Groupe mondial (classementNationsTop4 aurait alors reflete a peine 5-6
    // semaines de saison). Genere desormais depuis executerAvancementSemaine, a
    // l'entree en S29 (une fois le classement des outsiders "stabilise" a la fin
    // de S28), voir plus bas.

    const indexManche = MANCHES_COUPE.indexOf(mancheActuelle);
    if (indexManche === -1 || indexManche === MANCHES_COUPE.length - 1) return; // pas de manche apres la finale

    const mancheSuivante = MANCHES_COUPE[indexManche + 1];
    const divisions = db.prepare('SELECT DISTINCT division FROM coupe_equipes WHERE saison = ? AND circuit = ? AND manche = ?').all(saison, circuit, mancheActuelle).map(function (r) { return r.division; });

    divisions.forEach(function (division) {
        const ties = db.prepare('SELECT * FROM coupe_equipes WHERE saison = ? AND circuit = ? AND manche = ? AND division = ? ORDER BY position ASC').all(saison, circuit, mancheActuelle, division);
        if (ties.length === 0 || ties.some(function (t) { return t.statut !== 'termine'; })) return;

        const dejaGeneree = db.prepare('SELECT COUNT(*) AS n FROM coupe_equipes WHERE saison = ? AND circuit = ? AND manche = ? AND division = ?').get(saison, circuit, mancheSuivante, division).n;
        if (dejaGeneree > 0) return;

        // ties[].semaine est une semaine ABSOLUE ; SEMAINE_PAR_MANCHE ne donne qu'une
        // POSITION dans le cycle de saison - on applique l'ecart de position a la
        // semaine absolue deja connue de la manche qui vient de se terminer.
        const semaineDuMatch = ties[0].semaine + (SEMAINE_PAR_MANCHE[mancheSuivante] - SEMAINE_PAR_MANCHE[mancheActuelle]);

        for (let i = 0; i < ties.length; i += 2) {
            const tieA = ties[i], tieB = ties[i + 1];
            if (!tieB) break; // nombre impair (ne devrait pas arriver avec 16/8/4/2)
            db.prepare(`
                INSERT INTO coupe_equipes (saison, circuit, manche, semaine, nation_domicile, nation_exterieur, statut, position, division)
                VALUES (?, ?, ?, ?, ?, ?, 'a_venir', ?, ?)
            `).run(saison, circuit, mancheSuivante, semaineDuMatch, tieA.nation_vainqueur, tieB.nation_vainqueur, i / 2, division);
        }
    });
}

// Resout le capitaine (vote ou repli) de toutes les nations du tableau d'une saison,
// pour les 2 circuits - appelee une seule fois, a la bascule S1->S2.
// Regle du PDF : un capitaine est designe pour TOUTE nation ayant au moins un vrai
// joueur sur ce circuit, pas seulement les 16 du Groupe mondial - une nation hors
// Groupe mondial peut avoir besoin du sien plus tard si elle est retenue comme
// challenger au barrage (cf. genererBarrage), bien avant que cette qualification
// ne soit connue.
function resoudreCapitainesSaison(saison) {
    ['ATP', 'WTA'].forEach(function (circuit) {
        const type = circuit === 'ATP' ? 'joueur' : 'joueuse';
        const nations = new Set(
            db.prepare("SELECT DISTINCT nationalite FROM players WHERE type = ? AND statut = 'valide'").all(type)
                .map(function (r) { return r.nationalite; })
        );
        nations.forEach(function (nation) { resoudreCapitaine(saison, circuit, nation); });
    });
}

// ---------- Capitaine : candidature + vote ----------

app.get('/api/coupe/statut-capitaine/:playerId', (req, res) => {
    try {
        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(req.params.playerId, req.userId);
        if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });

        const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
        const saison = nombreSaisonAffichee();
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const phase = phaseDeSemaine(etat.semaine_actuelle);

        const fenetreCandidature = phase.type === 'presaison' || phase.type === 's0';
        const fenetreVote = phase.type === 'tournoi' && phase.positionSemaine === 1;

        const dansLeTableau = !!db.prepare(`
            SELECT 1 FROM coupe_equipes WHERE saison = ? AND circuit = ? AND (nation_domicile = ? OR nation_exterieur = ?)
        `).get(saison, circuit, player.nationalite, player.nationalite);

        const capitaine = db.prepare('SELECT player_id FROM coupe_capitaines WHERE saison = ? AND circuit = ? AND nation = ?').get(saison, circuit, player.nationalite);
        const candidatures = db.prepare(`
            SELECT c.player_id, p.prenom, p.nom FROM coupe_candidatures c JOIN players p ON p.id = c.player_id
            WHERE c.saison = ? AND c.circuit = ? AND c.nation = ?
        `).all(saison, circuit, player.nationalite);
        const monVote = db.prepare('SELECT candidat_player_id FROM coupe_votes WHERE saison = ? AND circuit = ? AND nation = ? AND votant_player_id = ?').get(saison, circuit, player.nationalite, player.id);
        const maCandidature = candidatures.some(function (c) { return c.player_id === player.id; });
        const estCapitaine = !!capitaine && Number(capitaine.player_id) === Number(player.id);
        const etapeAction = estCapitaine ? etapeActionCapitaineEnAttente(saison, circuit, player.nationalite) : null;
        // Rappel de style : independant du statut de capitaine, s'applique a tout
        // joueur reel selectionne dans une composition (voir styleEnAttentePourJoueur
        // plus bas). N'ecrase l'alerte capitaine que si celle-ci est absente (les 2
        // ne devraient jamais se declencher la meme semaine pour la meme rencontre,
        // mais un joueur peut etre capitaine d'une autre rencontre en parallele).
        const styleDu = dansLeTableau && !etapeAction ? styleEnAttentePourJoueur(player.id, player.nationalite, circuit) : false;

        res.json({
            success: true, dansLeTableau, fenetreCandidature, fenetreVote,
            capitaine: capitaine ? capitaine.player_id : null,
            candidatures, maCandidature,
            monVote: monVote ? monVote.candidat_player_id : null,
            alerte: etapeAction ? TEXTES_ALERTE_ACCUEIL[etapeAction] : (styleDu ? TEXTE_ALERTE_STYLE_ACCUEIL : null),
            alerteJoueur: etapeAction ? TEXTES_ALERTE_JOUEUR[etapeAction] : (styleDu ? TEXTE_ALERTE_STYLE_JOUEUR : null)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.get('/api/coupe/mes-rencontres/:playerId', (req, res) => {
    try {
        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(req.params.playerId, req.userId);
        if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
        const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
        const saison = nombreSaisonAffichee();

        const ties = db.prepare(`
            SELECT * FROM coupe_equipes WHERE saison = ? AND circuit = ? AND (nation_domicile = ? OR nation_exterieur = ?)
            ORDER BY semaine ASC
        `).all(saison, circuit, player.nationalite, player.nationalite);
        const nbDivisions = db.prepare('SELECT MAX(division) AS n FROM coupe_equipes WHERE saison = ? AND circuit = ?').get(saison, circuit).n || 1;

        // positionSemaine : le numero absolu brut (t.semaine) n'a de sens que pour
        // l'implementation - jamais a afficher tel quel, sinon "Semaine 58" au lieu de
        // "Semaine 5" une fois hors saison 1 (bug signale par l'utilisateur, 2026-08-24,
        // meme categorie que le badge "Semaine 56" deja corrige ailleurs le 2026-07-20 -
        // coupe.html n'avait pas ete couvert par ce correctif-la).
        res.json({
            success: true, nbDivisions, circuit,
            ties: ties.map(function (t) { return Object.assign({}, t, { manche: LABELS_MANCHE[t.manche] || t.manche, positionSemaine: positionSemaineAffichee(t.semaine) }); })
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Tableau de bord du capitaine (page dediee capitanat.html) : refuse l'acces (403)
// a quiconque n'est pas REELLEMENT le capitaine designe de sa nation cette saison -
// contrairement a coupe.html qui reste ouvert a tout participant. Pour chaque
// rencontre, `actionRequise` dit si une action de capitaine (surface/composition)
// est due CETTE semaine et pas encore faite - c'est ce qui declenche l'affichage du
// formulaire inline sur la page (demande explicite de l'utilisateur, 2026-08-24).
app.get('/api/coupe/capitanat/:playerId', (req, res) => {
    try {
        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(req.params.playerId, req.userId);
        if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });

        const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
        const saison = nombreSaisonAffichee();
        const nation = player.nationalite;

        const capitaineId = capitaineDe(saison, circuit, nation);
        if (!capitaineId || Number(capitaineId) !== Number(player.id)) {
            return res.status(403).json({ error: 'Tu n es pas capitaine de la Coupe Davis / Fed Cup cette saison.' });
        }

        const ties = db.prepare(`
            SELECT * FROM coupe_equipes WHERE saison = ? AND circuit = ? AND (nation_domicile = ? OR nation_exterieur = ?)
            ORDER BY semaine ASC
        `).all(saison, circuit, nation, nation);

        res.json({
            success: true, nation, circuit,
            ties: ties.map(function (t) {
                const etape = etapeCoupe(t);
                const compositionFaite = !!db.prepare('SELECT 1 FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(t.id, nation);
                const actionRequise = (etape === 'surface' && t.nation_domicile === nation && t.surface == null)
                    || (etape === 'composition' && !compositionFaite);
                return Object.assign({}, t, {
                    manche: LABELS_MANCHE[t.manche] || t.manche,
                    positionSemaine: positionSemaineAffichee(t.semaine),
                    etape, actionRequise, compositionFaite
                });
            })
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Tableau complet du groupe mondial (page coupe-tableau.html) : en acces libre,
// jamais filtre par nation - meme esprit que GET /api/coupe/tie/:tieId qui n'a
// jamais impose de verification de nation non plus. Le barrage de maintien (meme
// semaine que les demies, mais une branche a part qui ne rejoint jamais l'echelle
// principale) est renvoye separement plutot que mele au tour "demies".
app.get('/api/coupe/tableau/:circuit', (req, res) => {
    try {
        const circuit = req.params.circuit === 'WTA' ? 'WTA' : 'ATP';
        const saison = nombreSaisonAffichee();

        const ties = db.prepare('SELECT * FROM coupe_equipes WHERE saison = ? AND circuit = ? ORDER BY division ASC, position ASC').all(saison, circuit);

        const echelle = {};
        const barrage = [];
        ties.forEach(function (t) {
            const ligne = Object.assign({}, t, {
                mancheLabel: LABELS_MANCHE[t.manche] || t.manche, positionSemaine: positionSemaineAffichee(t.semaine),
                // Drapeaux (memes codes flagcdn.com que partout ailleurs sur le site) -
                // demande explicite de l'utilisateur, 2026-08-26.
                nation_domicile_drapeau: drapeau(t.nation_domicile), nation_exterieur_drapeau: drapeau(t.nation_exterieur)
            });
            if (t.manche === 'barrage') { barrage.push(ligne); return; }
            if (!echelle[t.manche]) echelle[t.manche] = [];
            echelle[t.manche].push(ligne);
        });

        res.json({ success: true, circuit, saison, echelle, barrage });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/coupe/candidature', (req, res) => {
    try {
        const { playerId } = req.body;
        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player || player.statut !== 'valide') return res.status(404).json({ error: 'Joueur introuvable.' });

        const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
        const saison = nombreSaisonAffichee();
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const phase = phaseDeSemaine(etat.semaine_actuelle);

        if (phase.type !== 'presaison' && phase.type !== 's0') {
            return res.status(400).json({ error: 'La candidature au poste de capitaine n\'est ouverte qu\'en Pré-saison et Semaine 0.' });
        }

        // Regle du PDF : un capitaine doit etre designe en debut de saison pour
        // TOUTE nation, qu'elle fasse partie du Groupe mondial ou non - meme celles
        // qui ne le sauront que plus tard (eventuelle qualification en barrage). Plus
        // de restriction "dansLeTableau" ici (le Groupe mondial de la saison n'est de
        // toute facon pas encore tire au moment de la candidature).
        db.prepare('INSERT OR IGNORE INTO coupe_candidatures (saison, circuit, nation, player_id) VALUES (?, ?, ?, ?)')
            .run(saison, circuit, player.nationalite, player.id);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/coupe/vote', (req, res) => {
    try {
        const { votantPlayerId, candidatPlayerId } = req.body;
        const votant = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(votantPlayerId, req.userId);
        if (!votant || votant.statut !== 'valide') return res.status(404).json({ error: 'Joueur introuvable.' });

        const circuit = votant.type === 'joueur' ? 'ATP' : 'WTA';
        const saison = nombreSaisonAffichee();
        const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
        const phase = phaseDeSemaine(etat.semaine_actuelle);

        if (!(phase.type === 'tournoi' && phase.positionSemaine === 1)) {
            return res.status(400).json({ error: 'Le vote pour le capitaine n\'est ouvert qu\'en Semaine 1.' });
        }

        const estCandidat = db.prepare('SELECT 1 FROM coupe_candidatures WHERE saison = ? AND circuit = ? AND nation = ? AND player_id = ?')
            .get(saison, circuit, votant.nationalite, candidatPlayerId);
        if (!estCandidat) {
            return res.status(400).json({ error: 'Ce joueur ne fait pas partie des candidats de ta nation.' });
        }

        db.prepare(`
            INSERT INTO coupe_votes (saison, circuit, nation, votant_player_id, candidat_player_id) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(saison, circuit, nation, votant_player_id) DO UPDATE SET candidat_player_id = excluded.candidat_player_id
        `).run(saison, circuit, votant.nationalite, votant.id, candidatPlayerId);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Depouille le vote et designe le capitaine - a appeler au moment ou la Semaine 1
// se termine (integration au scheduler a faire). Egalite entre plusieurs candidats
// en tete : le mieux classe (Live) l'emporte (regle PDF). Si personne n'a candidate
// ou vote, retombe sur le joueur reel le mieux classe de la nation (Live courant).
function resoudreCapitaine(saison, circuit, nation) {
    const dejaDesigne = db.prepare('SELECT 1 FROM coupe_capitaines WHERE saison = ? AND circuit = ? AND nation = ?').get(saison, circuit, nation);
    if (dejaDesigne) return;

    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const classement = calculerClassementGlobal(circuit, etat.semaine_actuelle - FENETRE_LIVE, etat.semaine_actuelle);
    const rangDe = function (playerId) {
        const idx = classement.findIndex(function (c) { return c.playerId === playerId; });
        return idx === -1 ? Infinity : idx;
    };

    const votes = db.prepare('SELECT candidat_player_id, COUNT(*) AS n FROM coupe_votes WHERE saison = ? AND circuit = ? AND nation = ? GROUP BY candidat_player_id ORDER BY n DESC').all(saison, circuit, nation);

    let capitaineId = null;
    if (votes.length > 0) {
        const maxVotes = votes[0].n;
        const enTete = votes.filter(function (v) { return v.n === maxVotes; });
        capitaineId = enTete.length === 1
            ? enTete[0].candidat_player_id
            : enTete.slice().sort(function (a, b) { return rangDe(a.candidat_player_id) - rangDe(b.candidat_player_id); })[0].candidat_player_id;
    }

    if (!capitaineId) {
        const meilleur = classement.find(function (c) { return c.playerId !== null && c.nationalite === nation; });
        capitaineId = meilleur ? meilleur.playerId : null;
    }

    if (capitaineId) {
        db.prepare('INSERT INTO coupe_capitaines (saison, circuit, nation, player_id) VALUES (?, ?, ?, ?)').run(saison, circuit, nation, capitaineId);
    }
}

// ---------- Surface / composition / styles avant chaque manche ----------
// Cascade a 3 semaines glissantes avant la semaine de match (tie.semaine) :
// tie.semaine-3 = surface, -2 = composition/ordre, -1 = styles, 0 = matchs.
function etapeCoupe(tie) {
    const etat = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get();
    const diff = tie.semaine - etat.semaine_actuelle;
    if (diff === 3) return 'surface';
    if (diff === 2) return 'composition';
    if (diff === 1) return 'styles';
    if (diff === 0) return 'matchs';
    return null;
}

function capitaineDe(saison, circuit, nation) {
    const row = db.prepare('SELECT player_id FROM coupe_capitaines WHERE saison = ? AND circuit = ? AND nation = ?').get(saison, circuit, nation);
    return row ? row.player_id : null;
}

// Texte d'alerte a afficher au capitaine s'il doit agir CETTE semaine sur une de
// ses rencontres non terminees - etapeCoupe() dit seulement "quelle semaine
// correspond a quelle etape", pas si l'action a deja ete faite, donc on croise avec
// l'absence de surface/composition enregistree. Une seule etape peut etre due a la
// fois en pratique (une nation ne joue jamais 2 rencontres la meme semaine), mais on
// boucle par securite et on retourne la premiere trouvee. Demande explicite de
// l'utilisateur, 2026-08-24 : textes exacts, pas de 3e alerte pour les styles
// (chaque joueur choisit le sien, ce n'est pas une action du capitaine).
function etapeActionCapitaineEnAttente(saison, circuit, nation) {
    const ties = db.prepare(`
        SELECT * FROM coupe_equipes
        WHERE saison = ? AND circuit = ? AND (nation_domicile = ? OR nation_exterieur = ?) AND statut != 'termine'
    `).all(saison, circuit, nation, nation);

    for (const tie of ties) {
        const etape = etapeCoupe(tie);
        if (etape === 'surface' && tie.nation_domicile === nation && tie.surface == null) return 'surface';
        if (etape === 'composition') {
            const dejaCompo = db.prepare('SELECT 1 FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tie.id, nation);
            if (!dejaCompo) return 'composition';
        }
    }
    return null;
}

// Deux formulations pour la meme etape ('surface'/'composition') : l'accueil garde
// le format court "S-3 : ..."/"S-2 : ..." (demande explicite, 2026-08-24), la fiche
// joueur une phrase narrative plus discrete (demande explicite separee, meme jour -
// la fiche joueur ne doit plus rien montrer d'autre sur le capitanat, tout le reste
// vit desormais sur la page dediee capitanat.html accessible depuis le menu).
const TEXTES_ALERTE_ACCUEIL = {
    surface: 'S-3 : Attention tu dois choisir la surface cette semaine',
    composition: 'S-2 : Attention tu dois choisir les joueurs cette semaine'
};
const TEXTES_ALERTE_JOUEUR = {
    surface: 'Cette semaine le capitaine doit choisir la surface du prochain match de Coupe Davis',
    composition: 'Cette semaine le capitaine doit choisir les joueurs du prochain match de Coupe Davis'
};

// Rappel distinct de l'alerte capitaine ci-dessus : celui-ci s'adresse a N'IMPORTE
// QUEL joueur reel selectionne dans une composition (pas seulement le capitaine),
// pour qu'il pense a choisir SON PROPRE style avant le debut des matchs - sans
// notification, un joueur selectionne pouvait completement rater la semaine S-1 et
// se retrouver sans style choisi (bug signale par l'utilisateur, 2026-08-26).
// N'entre pas en contradiction avec le choix du 2026-08-24 ("pas de 3e alerte
// capitaine pour les styles") : ceci n'est pas une action du capitaine, c'est le
// rappel individuel de chaque joueur concerne pour SA propre rencontre.
function styleEnAttentePourJoueur(playerId, nationalite, circuit) {
    const saison = nombreSaisonAffichee();
    const ties = db.prepare(`
        SELECT * FROM coupe_equipes
        WHERE saison = ? AND circuit = ? AND (nation_domicile = ? OR nation_exterieur = ?) AND statut != 'termine'
    `).all(saison, circuit, nationalite, nationalite);

    for (const tie of ties) {
        if (etapeCoupe(tie) !== 'styles') continue;
        const nation = tie.nation_domicile === nationalite ? tie.nation_domicile : tie.nation_exterieur;
        const compo = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tie.id, nation);
        // Uniquement les 2 rencontres de simple (aller/retour) - plus aucun style en
        // double depuis le 2026-08-26, jamais "en attente" pour ce poste-la.
        const postes = postesSimpleDuJoueur(compo, playerId);
        const unStyleManque = postes.some(function (p) {
            return !db.prepare('SELECT 1 FROM coupe_styles WHERE coupe_equipe_id = ? AND player_id = ? AND numero = ?').get(tie.id, playerId, p.numero);
        });
        if (unStyleManque) return true;
    }
    return false;
}
const TEXTE_ALERTE_STYLE_ACCUEIL = 'S-1 : Attention tu dois choisir ton style pour ta rencontre de Coupe Davis cette semaine';
const TEXTE_ALERTE_STYLE_JOUEUR = 'Cette semaine tu dois choisir ton style pour ta rencontre de Coupe Davis';

app.get('/api/coupe/tie/:tieId', (req, res) => {
    try {
        const tie = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(req.params.tieId);
        if (!tie) return res.status(404).json({ error: 'Rencontre introuvable.' });

        let composition = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ?').all(tie.id);
        const rubbers = db.prepare('SELECT * FROM coupe_rubbers WHERE coupe_equipe_id = ? ORDER BY numero').all(tie.id);
        const capitaineDomicile = capitaineDe(tie.saison, tie.circuit, tie.nation_domicile);
        const capitaineExterieur = capitaineDe(tie.saison, tie.circuit, tie.nation_exterieur);
        const nbDivisions = db.prepare('SELECT MAX(division) AS n FROM coupe_equipes WHERE saison = ? AND circuit = ?').get(tie.saison, tie.circuit).n || 1;

        if (tie.statut !== 'termine') {
            const semaineActuelle = db.prepare('SELECT semaine_actuelle FROM jeu_etat WHERE id = 1').get().semaine_actuelle;
            // La fenetre de soumission de la composition (S-2) est fermee des que l'on
            // atteint S-1 (diff <= 1) - a ce stade elle DOIT etre definitive, jamais
            // encore "probable" (l'entree en S-1 la verrouille normalement pour de bon,
            // voir executerAvancementSemaine, mais une rencontre deja a ce stade AVANT
            // le deploiement de ce verrou n'a jamais ete rattrapee) : on force alors le
            // repli automatique reel (ecriture en base), pas un simple apercu - demande
            // explicite de l'utilisateur, 2026-08-26.
            if (tie.semaine - semaineActuelle <= 1) {
                assurerSurfaceAuto(tie);
                const tieAJour = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tie.id);
                [tieAJour.nation_domicile, tieAJour.nation_exterieur].forEach(function (nation) { assurerCompositionAuto(tieAJour, nation); });
                composition = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ?').all(tie.id);
            } else {
                // Encore dans la fenetre normale (surface/composition pas encore due ou
                // en cours) : simple apercu non enregistre, marque prevue:true pour que
                // le front l'affiche comme un "probable" plutot que comme une
                // composition arretee.
                [tie.nation_domicile, tie.nation_exterieur].forEach(function (nation) {
                    if (composition.some(function (c) { return c.nation === nation; })) return;
                    const meilleurs = meilleursJoueursNation(tie.circuit, nation, tie.surface || 'dur');
                    if (!meilleurs) return;
                    const a = meilleurs.a, b = meilleurs.b;
                    composition.push({
                        coupe_equipe_id: tie.id, nation, prevue: true,
                        joueur_a_est_reel: a.estReel ? 1 : 0, joueur_a_id: a.id,
                        joueur_b_est_reel: b.estReel ? 1 : 0, joueur_b_id: b.id,
                        double_j1_est_reel: a.estReel ? 1 : 0, double_j1_id: a.id,
                        double_j2_est_reel: b.estReel ? 1 : 0, double_j2_id: b.id
                    });
                });
            }
        }

        res.json({
            success: true, nbDivisions,
            tie: Object.assign({}, tie, { manche: LABELS_MANCHE[tie.manche] || tie.manche, positionSemaine: positionSemaineAffichee(tie.semaine) }),
            composition, rubbers, capitaineDomicile, capitaineExterieur,
            etape: etapeCoupe(tie),
            joueursDomicile: joueursEligiblesNation(tie.circuit, tie.nation_domicile),
            joueursExterieur: joueursEligiblesNation(tie.circuit, tie.nation_exterieur)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/coupe/surface', (req, res) => {
    try {
        const { tieId, capitainePlayerId, surface } = req.body;
        if (!['dur', 'terre', 'herbe'].includes(surface)) return res.status(400).json({ error: 'Surface invalide.' });

        const monPlayer = db.prepare('SELECT id FROM players WHERE id = ? AND user_id = ?').get(capitainePlayerId, req.userId);
        if (!monPlayer) return res.status(403).json({ error: 'Ce personnage ne t\'appartient pas.' });

        const tie = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tieId);
        if (!tie) return res.status(404).json({ error: 'Rencontre introuvable.' });

        const capitaine = capitaineDe(tie.saison, tie.circuit, tie.nation_domicile);
        if (!capitaine || Number(capitaine) !== Number(capitainePlayerId)) {
            return res.status(403).json({ error: 'Seul le capitaine de la nation à domicile choisit la surface.' });
        }
        if (etapeCoupe(tie) !== 'surface') {
            return res.status(400).json({ error: 'Le choix de la surface n\'est pas ouvert cette semaine.' });
        }

        db.prepare('UPDATE coupe_equipes SET surface = ? WHERE id = ?').run(surface, tieId);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

app.post('/api/coupe/composition', (req, res) => {
    try {
        const { tieId, capitainePlayerId, nation, joueurA, joueurB, doubleJ1, doubleJ2 } = req.body;

        const monPlayer = db.prepare('SELECT id FROM players WHERE id = ? AND user_id = ?').get(capitainePlayerId, req.userId);
        if (!monPlayer) return res.status(403).json({ error: 'Ce personnage ne t\'appartient pas.' });

        const tie = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tieId);
        if (!tie) return res.status(404).json({ error: 'Rencontre introuvable.' });
        if (nation !== tie.nation_domicile && nation !== tie.nation_exterieur) {
            return res.status(400).json({ error: 'Cette nation ne participe pas à cette rencontre.' });
        }

        const capitaine = capitaineDe(tie.saison, tie.circuit, nation);
        if (!capitaine || Number(capitaine) !== Number(capitainePlayerId)) {
            return res.status(403).json({ error: 'Seul le capitaine de ta nation soumet la composition.' });
        }
        if (etapeCoupe(tie) !== 'composition') {
            return res.status(400).json({ error: 'La composition d\'équipe n\'est pas ouverte cette semaine.' });
        }

        const eligibles = joueursEligiblesNation(tie.circuit, nation);
        const estEligible = function (e) { return e && eligibles.some(function (j) { return j.estReel === !!e.estReel && j.id === Number(e.id); }); };
        if (![joueurA, joueurB, doubleJ1, doubleJ2].every(estEligible)) {
            return res.status(400).json({ error: 'Un ou plusieurs joueurs choisis ne font pas partie de l\'équipe éligible.' });
        }

        const memeJoueur = function (a, b) { return !!a.estReel === !!b.estReel && Number(a.id) === Number(b.id); };
        if (memeJoueur(joueurA, joueurB)) {
            return res.status(400).json({ error: 'Le simple 1 et le simple 2 doivent être joués par 2 joueurs différents.' });
        }
        if (memeJoueur(doubleJ1, doubleJ2)) {
            return res.status(400).json({ error: 'La paire de double doit être composée de 2 joueurs différents.' });
        }

        db.prepare('DELETE FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').run(tie.id, nation);
        db.prepare(`
            INSERT INTO coupe_composition (coupe_equipe_id, nation, joueur_a_est_reel, joueur_a_id, joueur_b_est_reel, joueur_b_id, double_j1_est_reel, double_j1_id, double_j2_est_reel, double_j2_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tie.id, nation, joueurA.estReel ? 1 : 0, joueurA.id, joueurB.estReel ? 1 : 0, joueurB.id, doubleJ1.estReel ? 1 : 0, doubleJ1.id, doubleJ2.estReel ? 1 : 0, doubleJ2.id);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Les rencontres de simple (numero + libelle) qu'un joueur precis doit disputer
// d'apres la composition de sa nation - joueur_a joue 1 (aller) et 4 (retour),
// joueur_b joue 2 (aller) et 5 (retour). Jamais le double (numero 3, plus aucun
// style depuis le 2026-08-26) : un joueur uniquement double_j1/j2 (jamais aussi
// joueur_a/b) n'a donc aucune rencontre ici. Partage entre POST /api/coupe/style
// (validation) et GET /api/coupe/style-en-attente/:playerId (liste a afficher).
function postesSimpleDuJoueur(compo, playerId) {
    if (!compo) return [];
    const resultats = [];
    if (compo.joueur_a_est_reel && Number(compo.joueur_a_id) === Number(playerId)) {
        resultats.push({ numero: 1, label: 'Simple 1' }, { numero: 4, label: 'Simple 3' });
    }
    if (compo.joueur_b_est_reel && Number(compo.joueur_b_id) === Number(playerId)) {
        resultats.push({ numero: 2, label: 'Simple 2' }, { numero: 5, label: 'Simple 4' });
    }
    return resultats;
}

app.post('/api/coupe/style', (req, res) => {
    try {
        const { tieId, playerId, style, numero } = req.body;
        if (!STYLES_JEU.includes(style)) return res.status(400).json({ error: 'Style invalide.' });

        const tie = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tieId);
        if (!tie) return res.status(404).json({ error: 'Rencontre introuvable.' });
        if (etapeCoupe(tie) !== 'styles') {
            return res.status(400).json({ error: 'Le choix des styles n\'est pas ouvert cette semaine.' });
        }

        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(playerId, req.userId);
        if (!player || (player.nationalite !== tie.nation_domicile && player.nationalite !== tie.nation_exterieur)) {
            return res.status(400).json({ error: 'Ce joueur ne participe pas à cette rencontre.' });
        }

        // Plus aucun style en double (toujours "aucun", demande explicite de
        // l'utilisateur, 2026-08-26) : le numero doit correspondre a une des 2
        // rencontres de simple REELLEMENT jouees par ce joueur precis d'apres la
        // composition de sa nation - jamais 3 (double), jamais le poste de l'autre
        // simple, jamais une rencontre non jouee par lui.
        const compo = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tie.id, player.nationalite);
        const postesValides = postesSimpleDuJoueur(compo, player.id).map(function (p) { return p.numero; });
        if (!postesValides.includes(Number(numero))) {
            return res.status(400).json({ error: 'Ce joueur ne joue pas cette rencontre-la, ou il s\'agit du double (pas de style a y choisir).' });
        }

        // Meme restriction que pour un tournoi : impossible de reprendre un style
        // deja utilise a l'evenement precedent (tournoi OU rencontre de Coupe Davis/
        // Fed Cup, le plus recent des deux) - demande explicite de l'utilisateur,
        // 2026-08-26 ("la CD/FC compte comme un tournoi"). Aucune restriction entre
        // le simple aller et le simple retour d'une MEME rencontre (tie.semaine
        // identique pour les 2, donc jamais son propre "precedent").
        const stylesInterdits = stylesInterditsEvenementPrecedent(player.id, tie.semaine);
        if (stylesInterdits.includes(style)) {
            return res.status(400).json({ error: 'Impossible d utiliser un style deja utilise au tournoi ou a la rencontre de Coupe Davis/Fed Cup precedent(e).' });
        }

        db.prepare(`
            INSERT INTO coupe_styles (coupe_equipe_id, player_id, style, numero) VALUES (?, ?, ?, ?)
            ON CONFLICT(coupe_equipe_id, player_id, numero) DO UPDATE SET style = excluded.style
        `).run(tie.id, player.id, style, Number(numero));

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// Rencontres de simple de Coupe Davis/Fed Cup dont ce joueur doit choisir le style
// CETTE semaine (etape 'styles', S-1) - alimente le meme panneau que les styles de
// tournoi sur joueur.html, demande explicite de l'utilisateur, 2026-08-26 :
// pouvoir choisir directement ici plutot que d'aller sur coupe.html, et un style
// distinct pour l'aller et le retour (comme 2 tours de tournoi), jamais pour le
// double (aucun style possible, l'info le rappelle cote frontend).
app.get('/api/coupe/style-en-attente/:playerId', (req, res) => {
    try {
        const player = db.prepare('SELECT * FROM players WHERE id = ? AND user_id = ?').get(req.params.playerId, req.userId);
        if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });

        const circuit = player.type === 'joueur' ? 'ATP' : 'WTA';
        const saison = nombreSaisonAffichee();
        const ties = db.prepare(`
            SELECT * FROM coupe_equipes
            WHERE saison = ? AND circuit = ? AND (nation_domicile = ? OR nation_exterieur = ?) AND statut != 'termine'
        `).all(saison, circuit, player.nationalite, player.nationalite);

        const rencontres = [];
        ties.forEach(function (tie) {
            if (etapeCoupe(tie) !== 'styles') return;
            const compo = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tie.id, player.nationalite);
            const postes = postesSimpleDuJoueur(compo, player.id);
            if (postes.length === 0) return; // uniquement dans le double (ou pas selectionne) : rien a choisir
            const simples = postes.map(function (p) {
                const styleActuel = db.prepare('SELECT style FROM coupe_styles WHERE coupe_equipe_id = ? AND player_id = ? AND numero = ?').get(tie.id, player.id, p.numero);
                return { numero: p.numero, label: p.label, styleActuel: styleActuel ? styleActuel.style : 'aucun' };
            });
            const opposant = tie.nation_domicile === player.nationalite ? tie.nation_exterieur : tie.nation_domicile;
            rencontres.push({
                tieId: tie.id, opposant, manche: LABELS_MANCHE[tie.manche] || tie.manche,
                positionSemaine: positionSemaineAffichee(tie.semaine), simples,
                // Comme pour un tournoi : impossible de reprendre un style deja utilise
                // a l'evenement precedent (tournoi OU rencontre CD/FC) - demande
                // explicite de l'utilisateur, 2026-08-26.
                stylesInterdits: stylesInterditsEvenementPrecedent(player.id, tie.semaine)
            });
        });

        res.json({ success: true, rencontres });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'ERREUR : ' + err.message });
    }
});

// ---------- Simulation de la manche (5 rencontres) ----------

const BAREME_XP_COUPE = {
    victoirePersoEtEquipe: 11,
    victoirePersoSeule: 10,
    defaitePersoMaisEquipeGagne: 10,
    defaitePersoEtEquipe: 9
};

// Style d'un joueur pour UNE rencontre precise (numero de coupe_rubbers, 1/2/4/5) -
// dissocie par rencontre depuis le 2026-08-26 (demande explicite de l'utilisateur) :
// un joueur de simple joue 2 rencontres (aller + retour), avec un style eventuellement
// different pour chacune, comme les tours d'un tournoi. Le double n'a pas de numero
// de style (jamais appele avec un numero par simulerRubberDouble, qui n'utilise plus
// aucun style).
function styleJoueur(tieId, playerId, numero) {
    const row = db.prepare('SELECT style FROM coupe_styles WHERE coupe_equipe_id = ? AND player_id = ? AND numero = ?').get(tieId, playerId, numero);
    return row ? row.style : null;
}

// Meme bareme de perte de mental courant que les tournois (PERTE_MENTAL_COURANT),
// faute de bareme dedie a la Coupe Davis dans le PDF - mappe la manche de la
// rencontre sur le label attendu par perteMentalCourant (categorie 250 toujours
// utilisee, la moins punitive, choix assume en l'absence de bareme officiel).
// Partage entre simulerRubberCoupe et simulerRubberDouble.
const LABEL_MANCHE_COUPE = { finale: 'Finale', demies: 'Demi-finale', quarts: '1/4 finale' };

// Simule UNE rencontre (simple ou double) et ecrit les lignes matchs necessaires
// (une par cote reel, aucune si les 2 cotes sont des rivaux) + la ligne coupe_rubbers.
// Simple uniquement - le double a sa propre fonction (simulerRubberDouble), les 2
// cotes y representent une PAIRE et non un joueur seul, ce qui change trop la forme
// des donnees pour partager le meme code sans le rendre confus.
function simulerRubberCoupe(tie, numero, domicileEntree, exterieurEntree, libelleRubber) {
    const surface = tie.surface;
    const styleDomicile = domicileEntree.estReel ? styleJoueur(tie.id, domicileEntree.id, numero) : null;
    const styleExterieur = exterieurEntree.estReel ? styleJoueur(tie.id, exterieurEntree.id, numero) : null;

    function valeurs(entree) {
        if (entree.estReel) {
            const player = db.prepare('SELECT * FROM players WHERE id = ?').get(entree.id);
            const normal = niveauNormal(player, surface);
            const mental = normal + player.mental_courant;
            return { normal, mental, mentalCourant: player.mental_courant, joueur: player };
        }
        const rival = db.prepare('SELECT * FROM classement_joueurs WHERE id = ?').get(entree.id);
        return { normal: rival.niveau, mental: rival.niveau + 100, mentalCourant: 100, joueur: null };
    }

    const vDomicile = valeurs(domicileEntree);
    const vExterieur = valeurs(exterieurEntree);

    // Dispositions : actives en Coupe Davis/Fed Cup uniquement pour les simples (le
    // double n'a pas d'adversaire individuel identifiable). Pas de notion de tete de
    // serie ni de match indoor dans une rencontre par equipe, ces deux dispositions
    // ne peuvent donc jamais s'y declencher. "Dernier carre" suit la manche de la
    // rencontre (demies/finale), "Premiers tours" ne s'applique qu'au 1er tour.
    const contexteCoupe = {
        esTeteDeSerie: false,
        adversaireEsTeteDeSerie: false,
        estDemiOuFinale: tie.manche === 'demies' || tie.manche === 'finale',
        tourIndex: tie.manche === '1er_tour' ? 0 : 99,
        estIndoor: false
    };
    function entreeAdverse(entree) {
        return { est_reel: entree.estReel, player_id: entree.estReel ? entree.id : null, rival_id: entree.estReel ? null : entree.id };
    }
    const bonusDomicile = vDomicile.joueur ? calculerBonusDispositions(vDomicile.joueur, entreeAdverse(exterieurEntree), contexteCoupe) : { fixe: 0, sangFroid: 0 };
    const bonusExterieur = vExterieur.joueur ? calculerBonusDispositions(vExterieur.joueur, entreeAdverse(domicileEntree), contexteCoupe) : { fixe: 0, sangFroid: 0 };

    const domicileNormal = vDomicile.normal + bonusDomicile.fixe;
    const domicileMental = vDomicile.mental + bonusDomicile.fixe;
    const exterieurNormal = vExterieur.normal + bonusExterieur.fixe;
    const exterieurMental = vExterieur.mental + bonusExterieur.fixe;

    // Alignement complet sur un match de tournoi (demande explicite de l'utilisateur,
    // 2026-08-21) : un rubber de Coupe Davis/Fed Cup n'avait jusqu'ici AUCUN effet sur
    // l'etat physique (jamais de malus de condition ni d'alerte kine, jamais de perte
    // de forme/usure/gain de mental/automatismes - simulerMatch etait appele "nu").
    // etatPhysique fait desormais demarrer ET evoluer le malus de condition pendant
    // le rubber, exactement comme en tournoi.
    const etatPhysiqueDomicile = vDomicile.joueur ? { forme: vDomicile.joueur.forme, pointsEnergie: vDomicile.joueur.points_energie, condition: vDomicile.joueur.condition, type: vDomicile.joueur.type } : null;
    const etatPhysiqueExterieur = vExterieur.joueur ? { forme: vExterieur.joueur.forme, pointsEnergie: vExterieur.joueur.points_energie, condition: vExterieur.joueur.condition, type: vExterieur.joueur.type } : null;

    const resultat = simulerMatch(
        domicileNormal, domicileMental, exterieurNormal, exterieurMental,
        styleDomicile, vDomicile.mentalCourant, styleExterieur, vExterieur.mentalCourant,
        bonusDomicile.sangFroid, bonusExterieur.sangFroid, false,
        etatPhysiqueDomicile, etatPhysiqueExterieur
    );

    const labelPourEtatPostMatch = LABEL_MANCHE_COUPE[tie.manche] || 'premier tour';
    const kineDomicile = vDomicile.joueur
        ? appliquerEtatPostMatch(vDomicile.joueur, surface, styleDomicile, resultat.totalJeux, resultat.pointsImportants, 250, labelPourEtatPostMatch, resultat.conditionFinaleA).kineIntervenu
        : false;
    const kineExterieur = vExterieur.joueur
        ? appliquerEtatPostMatch(vExterieur.joueur, surface, styleExterieur, resultat.totalJeux, resultat.pointsImportants, 250, labelPourEtatPostMatch, resultat.conditionFinaleB).kineIntervenu
        : false;

    const nationVainqueur = resultat.vainqueur === 'A' ? tie.nation_domicile : tie.nation_exterieur;

    // Ecriture des lignes matchs pour chaque cote reel (independant l'un de l'autre,
    // pas de lien tournoi_matchs ici puisque ce n'est pas un tournoi individuel).
    let matchIdDomicile = null, matchIdExterieur = null;
    if (vDomicile.joueur) {
        matchIdDomicile = db.prepare(`
            INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, numero_tour, balles_break_sauvees, coupe_equipe_id, kine_intervenu)
            VALUES (?, ?, ?, 'coupe', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            vDomicile.joueur.user_id, vDomicile.joueur.id, surface, tie.semaine,
            resultat.vainqueur === 'A' ? 'joueur' : 'adversaire', resultat.score,
            Math.round(domicileNormal), Math.round(exterieurNormal),
            JSON.stringify(resultat.evenements || []), libelleRubber, resultat.ballesBreakSauveesA || 0, tie.id, kineDomicile ? 1 : 0
        ).lastInsertRowid;
    }
    if (vExterieur.joueur) {
        matchIdExterieur = db.prepare(`
            INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, numero_tour, balles_break_sauvees, coupe_equipe_id, kine_intervenu)
            VALUES (?, ?, ?, 'coupe', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            vExterieur.joueur.user_id, vExterieur.joueur.id, surface, tie.semaine,
            resultat.vainqueur === 'B' ? 'joueur' : 'adversaire', miroirScore(resultat.score),
            Math.round(exterieurNormal), Math.round(domicileNormal),
            JSON.stringify(miroirEvenements(resultat.evenements || [])), libelleRubber, resultat.ballesBreakSauveesB || 0, tie.id, kineExterieur ? 1 : 0
        ).lastInsertRowid;
    }

    db.prepare(`
        INSERT INTO coupe_rubbers (coupe_equipe_id, numero, type, domicile_est_reel, domicile_id, domicile_style, exterieur_est_reel, exterieur_id, exterieur_style, nation_vainqueur, score, match_id, match_id_j2)
        VALUES (?, ?, 'simple', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tie.id, numero, domicileEntree.estReel ? 1 : 0, domicileEntree.id, styleDomicile, exterieurEntree.estReel ? 1 : 0, exterieurEntree.id, styleExterieur, nationVainqueur, resultat.score, matchIdDomicile, matchIdExterieur);

    return { nationVainqueur, domicileGagne: resultat.vainqueur === 'A' };
}

// Simule les 5 rencontres d'une manche (idempotent : ne fait rien si deja terminee),
// applique le bareme XP, met a jour le score de la manche.
// Repli automatique quand personne n'a agi a temps - soit parce que la nation n'a
// aucun vrai joueur (100% pilotee par le jeu, jamais de capitaine humain), soit
// qu'un capitaine humain a simplement oublie. Sans ca, une manche impliquant une
// nation sans capitaine ne se simulerait JAMAIS (composition/surface jamais soumises).
function assurerSurfaceAuto(tie) {
    if (tie.surface) return tie.surface;
    const surfaces = ['dur', 'terre', 'herbe'];
    const choix = surfaces[Math.floor(Math.random() * surfaces.length)];
    db.prepare('UPDATE coupe_equipes SET surface = ? WHERE id = ?').run(choix, tie.id);
    return choix;
}

// Les 2 meilleurs joueurs eligibles d'une nation (classes par niveau approx sur la
// surface donnee) - coeur du repli automatique (assurerCompositionAuto) ET de
// l'apercu de composition non encore soumise (voir compositionPrevue plus bas,
// GET /api/coupe/tie/:tieId), factorise pour ne pas dupliquer le tri.
function meilleursJoueursNation(circuit, nation, surface) {
    const eligibles = joueursEligiblesNation(circuit, nation).map(function (j) {
        if (j.estReel) {
            const player = db.prepare('SELECT * FROM players WHERE id = ?').get(j.id);
            return Object.assign({}, j, { niveauApprox: niveauNormal(player, surface) });
        }
        return Object.assign({}, j, { niveauApprox: j.niveau });
    }).sort(function (a, b) { return b.niveauApprox - a.niveauApprox; });
    if (eligibles.length === 0) return null; // ne devrait jamais arriver (assurerRosterMinimalNation garantit au moins 5 joueurs)
    return { a: eligibles[0], b: eligibles[1] || eligibles[0] };
}

function assurerCompositionAuto(tie, nation) {
    const existe = db.prepare('SELECT 1 FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tie.id, nation);
    if (existe) return;

    const meilleurs = meilleursJoueursNation(tie.circuit, nation, tie.surface || 'dur');
    if (!meilleurs) return;

    // Retour au format Simple 1/Simple 2/Double (double reprend 1/2, comme avant),
    // sur demande explicite de l'utilisateur, 2026-08-26 (revient sur le format
    // "4 simples distincts" du 2026-08-25).
    const a = meilleurs.a, b = meilleurs.b;
    db.prepare(`
        INSERT INTO coupe_composition (coupe_equipe_id, nation, joueur_a_est_reel, joueur_a_id, joueur_b_est_reel, joueur_b_id, double_j1_est_reel, double_j1_id, double_j2_est_reel, double_j2_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tie.id, nation, a.estReel ? 1 : 0, a.id, b.estReel ? 1 : 0, b.id, a.estReel ? 1 : 0, a.id, b.estReel ? 1 : 0, b.id);
}

// Ordre standard d'une manche (2 simples/1 double/2 simples retour), commun a
// simulerUnRubberCoupe et finaliserMancheCoupe. Retour a ce format sur demande
// explicite de l'utilisateur, 2026-08-26 (revient sur le format "4 simples
// distincts" du 2026-08-25) : Simple 1 et Simple 2 rejouent chacun une 2e fois en
// position inversee (rubbers 4/5) plutot que d'introduire 2 joueurs de plus. Les
// entrees simple referencent directement A/B ; le double n'a pas besoin d'entrees
// ici (gere a part par simulerRubberDouble, qui lit compoDomicile/compoExterieur
// directement).
function ordreRubbersCoupe(compoDomicile, compoExterieur) {
    const A_d = { estReel: !!compoDomicile.joueur_a_est_reel, id: compoDomicile.joueur_a_id };
    const B_d = { estReel: !!compoDomicile.joueur_b_est_reel, id: compoDomicile.joueur_b_id };
    const A_e = { estReel: !!compoExterieur.joueur_a_est_reel, id: compoExterieur.joueur_a_id };
    const B_e = { estReel: !!compoExterieur.joueur_b_est_reel, id: compoExterieur.joueur_b_id };
    return [
        { numero: 1, type: 'simple', domicile: A_d, exterieur: A_e },
        { numero: 2, type: 'simple', domicile: B_d, exterieur: B_e },
        { numero: 3, type: 'double' },
        { numero: 4, type: 'simple', domicile: A_d, exterieur: B_e },
        { numero: 5, type: 'simple', domicile: B_d, exterieur: A_e }
    ];
}

// Simule LA PROCHAINE rencontre due (coupe_equipes.rubber_actuel, 0-based) d'une
// manche, comme un tour de tournoi classique (cf. simulerUnTour) - jamais les 5
// d'un coup. Repli automatique (surface/composition) applique une seule fois, avant
// la toute premiere rencontre (idempotent, ne fait rien si deja soumis). Finalise
// la manche des qu'une nation atteint 3 victoires (qualification anticipee, les
// rencontres restantes ne se jouent jamais - demande explicite de l'utilisateur,
// 2026-08-26), ou apres la 5e si aucune n'a encore atteint 3 avant.
function simulerUnRubberCoupe(tieId) {
    let tie = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tieId);
    if (!tie || tie.statut === 'termine') return;
    if (tie.rubber_actuel >= 5) return;

    assurerSurfaceAuto(tie);
    tie = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tieId);
    assurerCompositionAuto(tie, tie.nation_domicile);
    assurerCompositionAuto(tie, tie.nation_exterieur);

    const compoDomicile = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tie.id, tie.nation_domicile);
    const compoExterieur = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tie.id, tie.nation_exterieur);
    if (!compoDomicile || !compoExterieur) return; // ne devrait plus arriver, garde-fou

    const ordre = ordreRubbersCoupe(compoDomicile, compoExterieur);
    const r = ordre[tie.rubber_actuel];

    if (r.type === 'double') {
        simulerRubberDouble(tie, compoDomicile, compoExterieur);
    } else {
        simulerRubberCoupe(tie, r.numero, r.domicile, r.exterieur, libelleRubber(r.numero));
    }

    const nouveauRubberActuel = tie.rubber_actuel + 1;
    db.prepare('UPDATE coupe_equipes SET rubber_actuel = ? WHERE id = ?').run(nouveauRubberActuel, tie.id);

    const victoires = db.prepare(`
        SELECT
            SUM(CASE WHEN nation_vainqueur = ? THEN 1 ELSE 0 END) AS dom,
            SUM(CASE WHEN nation_vainqueur = ? THEN 1 ELSE 0 END) AS ext
        FROM coupe_rubbers WHERE coupe_equipe_id = ?
    `).get(tie.nation_domicile, tie.nation_exterieur, tie.id);

    if (nouveauRubberActuel >= 5 || victoires.dom >= 3 || victoires.ext >= 3) {
        finaliserMancheCoupe(tie.id);
    }
}

// Cloture une manche une fois ses 5 coupe_rubbers joues : score final, bareme XP
// (grille 2x2 validee), puis genere la manche suivante si c'etait la derniere
// rencontre en attente de cette manche/saison/circuit.
function finaliserMancheCoupe(tieId) {
    const tie = db.prepare('SELECT * FROM coupe_equipes WHERE id = ?').get(tieId);
    const rubbers = db.prepare('SELECT * FROM coupe_rubbers WHERE coupe_equipe_id = ?').all(tieId);

    let victoiresDomicile = 0, victoiresExterieur = 0;
    const victoiresParJoueur = new Map(); // playerId (reel uniquement) -> nb victoires perso
    function comptabiliseVictoire(estReel, id) {
        if (estReel && id) victoiresParJoueur.set(id, (victoiresParJoueur.get(id) || 0) + 1);
    }

    rubbers.forEach(function (r) {
        const domicileGagne = r.nation_vainqueur === tie.nation_domicile;
        if (domicileGagne) victoiresDomicile++; else victoiresExterieur++;

        if (r.type === 'double') {
            const cote = domicileGagne
                ? { estReel: r.domicile_est_reel, id1: r.domicile_id, id2: r.domicile_id2 }
                : { estReel: r.exterieur_est_reel, id1: r.exterieur_id, id2: r.exterieur_id2 };
            comptabiliseVictoire(!!cote.estReel, cote.id1);
            comptabiliseVictoire(!!cote.estReel, cote.id2);
        } else {
            const cote = domicileGagne
                ? { estReel: r.domicile_est_reel, id: r.domicile_id }
                : { estReel: r.exterieur_est_reel, id: r.exterieur_id };
            comptabiliseVictoire(!!cote.estReel, cote.id);
        }
    });

    const nationVainqueur = victoiresDomicile > victoiresExterieur ? tie.nation_domicile : tie.nation_exterieur;
    db.prepare('UPDATE coupe_equipes SET statut = ?, victoires_domicile = ?, victoires_exterieur = ?, nation_vainqueur = ? WHERE id = ?')
        .run('termine', victoiresDomicile, victoiresExterieur, nationVainqueur, tieId);

    // Bareme XP (grille 2x2 validee) - uniquement les VRAIS joueurs impliques,
    // retrouves via les 2 compositions (pas les rubbers, plus simple et complet
    // meme pour un joueur qui aurait perdu tous ses matchs).
    const compoDomicile = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tieId, tie.nation_domicile);
    const compoExterieur = db.prepare('SELECT * FROM coupe_composition WHERE coupe_equipe_id = ? AND nation = ?').get(tieId, tie.nation_exterieur);
    const joueursImpliques = new Set();
    [compoDomicile, compoExterieur].forEach(function (c) {
        if (!c) return;
        [[c.joueur_a_est_reel, c.joueur_a_id], [c.joueur_b_est_reel, c.joueur_b_id],
         [c.double_j1_est_reel, c.double_j1_id], [c.double_j2_est_reel, c.double_j2_id]]
            .forEach(function (pair) { if (pair[0] && pair[1]) joueursImpliques.add(pair[1]); });
    });

    // Un joueur ayant abandonne OU declare forfait (blessure) sur l'un de ses rubbers
    // de cette rencontre ne touche aucune XP de progression, meme s'il a par ailleurs
    // gagne un autre rubber de la meme rencontre (ex. simple gagne puis double
    // abandonne) - meme regle que les tournois (demande explicite de l'utilisateur,
    // 2026-08-21).
    const abandonParJoueur = new Set();
    db.prepare("SELECT DISTINCT player_id FROM matchs WHERE coupe_equipe_id = ? AND (score LIKE '%(Abandon)%' OR score LIKE '%Forfait%')").all(tieId)
        .forEach(function (row) { abandonParJoueur.add(row.player_id); });

    joueursImpliques.forEach(function (playerId) {
        const player = db.prepare('SELECT nationalite FROM players WHERE id = ?').get(playerId);
        if (!player) return;
        if (abandonParJoueur.has(playerId)) return;
        const sonEquipeGagne = player.nationalite === nationVainqueur;
        const aGagneAuMoinsUnMatch = (victoiresParJoueur.get(playerId) || 0) > 0;
        let xp;
        if (aGagneAuMoinsUnMatch && sonEquipeGagne) xp = BAREME_XP_COUPE.victoirePersoEtEquipe;
        else if (aGagneAuMoinsUnMatch && !sonEquipeGagne) xp = BAREME_XP_COUPE.victoirePersoSeule;
        else if (!aGagneAuMoinsUnMatch && sonEquipeGagne) xp = BAREME_XP_COUPE.defaitePersoMaisEquipeGagne;
        else xp = BAREME_XP_COUPE.defaitePersoEtEquipe;
        db.prepare('UPDATE players SET points_experience = points_experience + ? WHERE id = ?').run(xp, playerId);
    });

    genererMancheSuivante(tie.saison, tie.circuit, tie.manche);
}

// Le double est simule a part (2 joueurs par cote au lieu d'1) : niveau d'equipe =
// moyenne des 2 partenaires, chacun ayant applique son propre style au prealable
// (ajustement "plat" set 1, pas la dynamique par set - simplification assumee,
// cf. memoire project_discord_et_pistes_futures).
function simulerRubberDouble(tie, compoDomicile, compoExterieur) {
    const surface = tie.surface;

    // Plus aucun style en double (toujours "aucun") - demande explicite de
    // l'utilisateur, 2026-08-26 : seuls les simples ont un style desormais, choisi
    // separement pour l'aller et le retour. ajusterNiveauxStyle(..., null, ...) ne
    // touche a rien (meme comportement que style === 'aucun').
    function valeurJoueur(estReel, id) {
        if (estReel) {
            const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
            const normal = niveauDouble(player, surface);
            const mental = normal + player.mental_courant;
            return Object.assign({ joueur: player, style: null }, ajusterNiveauxStyle(normal, mental, null, player.mental_courant, 1));
        }
        const rival = db.prepare('SELECT * FROM classement_joueurs WHERE id = ?').get(id);
        return { normal: rival.niveau, mental: rival.niveau + 100 };
    }

    const d1 = valeurJoueur(!!compoDomicile.double_j1_est_reel, compoDomicile.double_j1_id);
    const d2 = valeurJoueur(!!compoDomicile.double_j2_est_reel, compoDomicile.double_j2_id);
    const e1 = valeurJoueur(!!compoExterieur.double_j1_est_reel, compoExterieur.double_j1_id);
    const e2 = valeurJoueur(!!compoExterieur.double_j2_est_reel, compoExterieur.double_j2_id);

    const niveauEquipeDomicileNormal = (d1.normal + d2.normal) / 2;
    const niveauEquipeDomicileMental = (d1.mental + d2.mental) / 2;
    const niveauEquipeExterieurNormal = (e1.normal + e2.normal) / 2;
    const niveauEquipeExterieurMental = (e1.mental + e2.mental) / 2;

    const resultat = simulerMatch(niveauEquipeDomicileNormal, niveauEquipeDomicileMental, niveauEquipeExterieurNormal, niveauEquipeExterieurMental);
    const nationVainqueur = resultat.vainqueur === 'A' ? tie.nation_domicile : tie.nation_exterieur;
    const domicileGagne = resultat.vainqueur === 'A';

    // Consequences physiques (forme/mental/usure/automatismes/condition) pour chaque
    // vrai joueur de la paire, a moitie du taux normal pour la perte de forme, la
    // perte de mental courant et le gain de mental max - PAS l'usure, qui reste +1
    // dans tous les cas (demande explicite de l'utilisateur, 2026-08-26 : un match de
    // double se joue a 2 contre 2, chacun porte "la moitie" de l'effort individuel
    // d'un simple). Categorie 250 comme les simples de Coupe Davis (labelPourEtatPostMatch
    // partage, voir LABEL_MANCHE_COUPE), pas de kine/perte de caracteristique geree ici
    // separement - appliquerEtatPostMatch s'en charge deja pour chaque joueur.
    const labelPourEtatPostMatch = LABEL_MANCHE_COUPE[tie.manche] || 'premier tour';
    [[d1, resultat.conditionFinaleA], [d2, resultat.conditionFinaleA], [e1, resultat.conditionFinaleB], [e2, resultat.conditionFinaleB]]
        .forEach(function (pair) {
            const j = pair[0];
            if (!j.joueur) return;
            appliquerEtatPostMatch(j.joueur, surface, j.style, resultat.totalJeux, resultat.pointsImportants, 250, labelPourEtatPostMatch, pair[1], true);
        });

    function ecrireMatch(estReel, id, userId, monNiveau, adversaireNiveau, jaiGagne, score, evenements) {
        if (!estReel) return null;
        return db.prepare(`
            INSERT INTO matchs (user_id, player_id, surface, difficulte, semaine, vainqueur, score, niveau_joueur, niveau_adversaire, evenements, numero_tour, balles_break_sauvees, coupe_equipe_id)
            VALUES (?, ?, ?, 'coupe', ?, ?, ?, ?, ?, ?, 'Coupe - Double', ?, ?)
        `).run(userId, id, surface, tie.semaine, jaiGagne ? 'joueur' : 'adversaire', score, Math.round(monNiveau), Math.round(adversaireNiveau), JSON.stringify(evenements), jaiGagne ? resultat.ballesBreakSauveesA || 0 : resultat.ballesBreakSauveesB || 0, tie.id).lastInsertRowid;
    }

    let matchIdDomicileJ1 = null, matchIdDomicileJ2 = null, matchIdExterieurJ1 = null, matchIdExterieurJ2 = null;
    if (compoDomicile.double_j1_est_reel) {
        const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(compoDomicile.double_j1_id);
        matchIdDomicileJ1 = ecrireMatch(true, compoDomicile.double_j1_id, player.user_id, niveauEquipeDomicileNormal, niveauEquipeExterieurNormal, domicileGagne, resultat.score, resultat.evenements);
    }
    if (compoDomicile.double_j2_est_reel) {
        const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(compoDomicile.double_j2_id);
        matchIdDomicileJ2 = ecrireMatch(true, compoDomicile.double_j2_id, player.user_id, niveauEquipeDomicileNormal, niveauEquipeExterieurNormal, domicileGagne, resultat.score, resultat.evenements);
    }
    if (compoExterieur.double_j1_est_reel) {
        const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(compoExterieur.double_j1_id);
        matchIdExterieurJ1 = ecrireMatch(true, compoExterieur.double_j1_id, player.user_id, niveauEquipeExterieurNormal, niveauEquipeDomicileNormal, !domicileGagne, miroirScore(resultat.score), miroirEvenements(resultat.evenements));
    }
    if (compoExterieur.double_j2_est_reel) {
        const player = db.prepare('SELECT user_id FROM players WHERE id = ?').get(compoExterieur.double_j2_id);
        matchIdExterieurJ2 = ecrireMatch(true, compoExterieur.double_j2_id, player.user_id, niveauEquipeExterieurNormal, niveauEquipeDomicileNormal, !domicileGagne, miroirScore(resultat.score), miroirEvenements(resultat.evenements));
    }

    // domicile_id/domicile_id2 et exterieur_id/exterieur_id2 identifient TOUJOURS les
    // 4 joueurs de la paire (reel ou rival), independamment de savoir si une ligne
    // matchs existe pour chacun - sert a retrouver "la paire adverse" sur la page Matchs.
    db.prepare(`
        INSERT INTO coupe_rubbers (
            coupe_equipe_id, numero, type,
            domicile_est_reel, domicile_id, domicile_id2,
            exterieur_est_reel, exterieur_id, exterieur_id2,
            nation_vainqueur, score, match_id, match_id_j2
        )
        VALUES (?, 3, 'double', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        tie.id,
        compoDomicile.double_j1_est_reel, compoDomicile.double_j1_id, compoDomicile.double_j2_id,
        compoExterieur.double_j1_est_reel, compoExterieur.double_j1_id, compoExterieur.double_j2_id,
        nationVainqueur, resultat.score,
        matchIdDomicileJ1 || matchIdDomicileJ2, matchIdExterieurJ1 || matchIdExterieurJ2
    );

    return { nationVainqueur, domicileGagne };
}

app.listen(PORT, () => {
    console.log('Serveur lance sur http://localhost:' + PORT);
});

verifierAvancementAuto();
setInterval(verifierAvancementAuto, 15 * 60 * 1000);

verifierAvancementTourAuto();
setInterval(verifierAvancementTourAuto, 15 * 60 * 1000);

verifierAvancementTourCoupeAuto();
setInterval(verifierAvancementTourCoupeAuto, 15 * 60 * 1000);
