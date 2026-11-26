'use strict';
/*
 * Collection TWM + calendrier de l'Avent (2026-11-26, maquettes validees par
 * l'utilisateur : artifacts "Collection TWM" et "Calendrier de l'Avent TWM").
 *
 * AUCUN IMPACT SUR LE JEU : cartes et cadeaux sont purement cosmetiques.
 *
 * Collection
 *  - carte JOUEUR : chaque joueur d'un coach (pas les bots) existe en 50 communes,
 *    25 rares, 5 epiques et 1 legendaire, numerotees, jamais reimprimees. La
 *    legendaire 1/1 ne sort jamais en pochette : elle est reservee au coach du
 *    joueur (calendrier de l'Avent : 1er decembre pour un de ses 2 personnages, 10
 *    pour l'autre ; ratee = gardee en reserve et offerte dans sa pochette suivante).
 *  - carte MOMENT : chaque tournoi gagne par un joueur d'un coach, 25 rares, 5
 *    epiques, 1 legendaire.
 *  - pochette de 5 cartes (SLOTS, chances de l'artifact) ; super pack de 10 avec au
 *    moins une epique.
 *
 * Calendrier de l'Avent : case N ouvrable du N decembre 10h au N+1 decembre 10h
 * (heure de Paris), puis perdue (choix de l'utilisateur). Case 25 = l'appli.
 */

const ANNEE_AVENT = 2026;
const TIRAGE_J = { commune: 50, rare: 25, epique: 5, legendaire: 1 };
const TIRAGE_M = { rare: 25, epique: 5, legendaire: 1 };
const ORDRE_RARETE = ['commune', 'rare', 'epique', 'legendaire'];
const SLOTS = [
    [['joueur', 'commune', 100]],
    [['joueur', 'commune', 100]],
    [['joueur', 'commune', 35], ['joueur', 'rare', 55], ['joueur', 'epique', 10]],
    [['moment', 'rare', 90], ['moment', 'epique', 8], ['moment', 'legendaire', 2]],
    [['moment', 'rare', 53], ['moment', 'epique', 18], ['moment', 'legendaire', 3], ['joueur', 'rare', 23], ['joueur', 'epique', 3]]
];

const FOND = function (code, nom) {
    return { telephone: '/avent/fonds/' + code + '-telephone.png', ordinateur: '/avent/fonds/' + code + '-ordinateur.png', nom: nom };
};
// Le plan des 25 cases (artifact "Calendrier de l'Avent TWM").
const CASES = {
    1: { type: 'pochette', taille: 5, titre: '1re pochette + ta 1re légendaire', texte: "5 cartes, et la légendaire 1/1 d'un de tes deux personnages, tiré au sort." },
    2: { type: 'cadre', code: 'cadre:balle', titre: 'Cadre « Balle de tennis »', texte: "La balle jaune, sa feutrine et sa couture autour de l'avatar." },
    3: { type: 'pochette', taille: 5, titre: '2e pochette', texte: '5 cartes.' },
    4: { type: 'fond', code: 'fond:terre', fichiers: FOND('terre', 'Terre de Noël'), titre: "Fond d'écran « Terre de Noël »", texte: 'Un court en terre battue vu du ciel, sous la première neige.' },
    5: { type: 'emoji', code: 'emoji:boule', titre: 'Emoji balle de tennis en boule de Noël', texte: 'À côté de ton pseudo, dans les classements et sur ta fiche coach.' },
    6: { type: 'pochette', taille: 5, titre: '3e pochette', texte: '5 cartes.' },
    7: { type: 'cadre', code: 'cadre:flocons', titre: 'Cadre « Cristaux de givre »', texte: 'Un anneau de glace et des flocons dessinés un par un.' },
    8: { type: 'teaser', code: 'teaser:1', titre: 'Teaser n°1', texte: 'Quelque chose se prépare. Il tiendra dans une seule main.', part: 30, jMoins: 17 },
    9: { type: 'fond', code: 'fond:nuit', fichiers: FOND('nuit', 'Night session'), titre: "Fond d'écran « Night session »", texte: 'Le court en dur bleu de nuit, sous les projecteurs.' },
    10: { type: 'pochette', taille: 5, titre: '4e pochette + ta 2e légendaire', texte: '5 cartes, et la légendaire 1/1 de ton autre personnage.' },
    11: { type: 'emoji', code: 'emoji:raquette', titre: 'Emoji raquette à côté du pseudo', texte: "Une raquette dessinée pour le jeu (il n'existe pas d'emoji raquette de tennis)." },
    12: { type: 'pochette', taille: 5, titre: '5e pochette', texte: '5 cartes.' },
    13: { type: 'fiche', code: 'fiche:neige', titre: 'Fond de fiche « Neige »', texte: 'La fiche de tes joueurs sous une couche de neige.' },
    14: { type: 'teaser', code: 'teaser:2', titre: 'Teaser n°2', texte: "Il ne dort jamais. Il te préviendra quand ton joueur entre sur le court.", part: 62, jMoins: 11 },
    15: { type: 'cadre', code: 'cadre:guirlande', titre: 'Cadre « Guirlande de sapin »', texte: 'Une couronne de branches de sapin, des lumières colorées et un nœud rouge.' },
    16: { type: 'fond', code: 'fond:indoor', fichiers: FOND('indoor', 'Indoor'), titre: "Fond d'écran « Indoor »", texte: 'Un court en salle violet, sous les guirlandes lumineuses.' },
    17: { type: 'pochette', taille: 5, titre: '6e pochette', texte: '5 cartes.' },
    18: { type: 'emoji', code: 'emoji:etoile', titre: 'Emoji étoile de Noël à côté du pseudo', texte: 'Une étoile dorée qui brille à côté de ton pseudo.' },
    19: { type: 'pochette', taille: 5, titre: '7e pochette', texte: '5 cartes.' },
    20: { type: 'fond', code: 'fond:givre', fichiers: FOND('givre', 'Givre'), titre: "Fond d'écran « Givre »", texte: 'Le gazon tondu en bandes, pris dans le givre du matin.' },
    21: { type: 'pochette', taille: 5, titre: '8e pochette', texte: '5 cartes.' },
    22: { type: 'badge', code: 'badge:avent2026', codes: ['badge:avent2026', 'fiche:festive'], titre: 'Badge « Avent 2026 » + fond de fiche festif', texte: 'Rangé dans « Événements », hors records ; la fiche s\'illumine de guirlandes.' },
    23: { type: 'teaser', code: 'teaser:3', titre: 'Teaser n°3', texte: 'Bientôt, le tennis ne sera plus jamais loin de toi.', part: 94, jMoins: 2 },
    24: { type: 'pochette', taille: 10, super: true, titre: 'Super pack de 10 cartes', texte: "Le double d'une pochette, avec au moins une épique garantie." },
    25: { type: 'appli', code: 'fond:appli', fichiers: FOND('appli', 'Édition application'), titre: "Révélation de l'application mobile", texte: "Tennis Web Manager arrive sur ton téléphone. La case débloque aussi le fond d'écran « Édition application »." }
};

// Decembre = heure d'hiver a Paris (UTC+1) : la case N s'ouvre le N a 09:00 UTC.
function debutCase(jour) { return new Date(Date.UTC(ANNEE_AVENT, 11, jour, 9, 0, 0)); }

function maintenant() {
    // Test en local uniquement : AVENT_DATE_TEST=2026-12-03T11:00:00+01:00
    if (process.env.AVENT_DATE_TEST) return new Date(process.env.AVENT_DATE_TEST);
    return new Date();
}

// Case ouvrable en ce moment (1..25) ou null.
function caseDuMoment(date) {
    const t = date.getTime();
    for (let j = 1; j <= 25; j++) {
        if (t >= debutCase(j).getTime() && t < debutCase(j + 1).getTime()) return j;
    }
    return null;
}

module.exports = function installerCollectionAvent(app, db, outils) {
    const { estAdmin, meilleurClassement, drapeau, phaseAffichee, positionSemaineAffichee, niveauNormal } = outils;

    /* ---------------- Stock de cartes ---------------- */
    const insererCarte = db.prepare('INSERT OR IGNORE INTO cartes (famille, player_id, tournoi_id, rarete, numero, total) VALUES (?, ?, ?, ?, ?, ?)');
    function assurerStock() {
        const joueurs = db.prepare(`
            SELECT p.id FROM players p JOIN users u ON u.id = p.user_id
            WHERE p.statut = 'valide' AND COALESCE(u.supprime, 0) = 0
              AND NOT EXISTS (SELECT 1 FROM cartes c WHERE c.famille = 'joueur' AND c.player_id = p.id)
        `).all();
        const moments = db.prepare(`
            SELECT tj.player_id AS player_id, t.id AS tournoi_id FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
            WHERE tj.est_reel = 1 AND tj.player_id IS NOT NULL AND tj.tour_elimine = 'Vainqueur'
              AND NOT EXISTS (SELECT 1 FROM cartes c WHERE c.famille = 'moment' AND c.tournoi_id = t.id)
        `).all();
        if (joueurs.length === 0 && moments.length === 0) return;
        db.transaction(function () {
            joueurs.forEach(function (j) {
                Object.keys(TIRAGE_J).forEach(function (r) {
                    for (let n = 1; n <= TIRAGE_J[r]; n++) insererCarte.run('joueur', j.id, 0, r, n, TIRAGE_J[r]);
                });
            });
            moments.forEach(function (m) {
                Object.keys(TIRAGE_M).forEach(function (r) {
                    for (let n = 1; n <= TIRAGE_M[r]; n++) insererCarte.run('moment', m.player_id, m.tournoi_id, r, n, TIRAGE_M[r]);
                });
            });
        })();
        console.log('[collection] stock complete : ' + joueurs.length + ' joueur(s), ' + moments.length + ' moment(s)');
    }

    /* ---------------- Pochettes ---------------- */
    const prendreCarte = db.prepare(`
        SELECT id FROM cartes WHERE famille = ? AND rarete = ? AND user_id IS NULL
          AND NOT (famille = 'joueur' AND rarete = 'legendaire')
        ORDER BY RANDOM() LIMIT 1
    `);
    // Rarete voulue, sinon la plus proche disponible, sinon l'autre famille.
    function tirerCarte(famille, rarete) {
        const i = ORDRE_RARETE.indexOf(rarete);
        const essais = [rarete];
        for (let d = 1; d < ORDRE_RARETE.length; d++) {
            if (ORDRE_RARETE[i - d]) essais.push(ORDRE_RARETE[i - d]);
            if (ORDRE_RARETE[i + d]) essais.push(ORDRE_RARETE[i + d]);
        }
        const familles = [famille, famille === 'joueur' ? 'moment' : 'joueur'];
        for (const f of familles) {
            for (const r of essais) {
                const c = prendreCarte.get(f, r);
                if (c) return c.id;
            }
        }
        return null;
    }
    function rouler(slot) {
        let x = Math.random() * 100;
        for (const s of slot) { if ((x -= s[2]) < 0) return s; }
        return slot[0];
    }

    // Personnages d'un coach dans l'ordre des legendaires de l'Avent (1er puis 10).
    function ordreLegendaires(userId) {
        const persos = db.prepare("SELECT id FROM players WHERE user_id = ? AND statut = 'valide' ORDER BY id").all(userId);
        if (persos.length === 2 && userId % 2 === 1) persos.reverse(); // "tire au sort", mais stable
        return persos.map(function (p) { return p.id; });
    }
    // Legendaires 1/1 du coach dues a cette date et pas encore remises.
    function legendairesDues(userId, date) {
        const ordre = ordreLegendaires(userId);
        const dues = [];
        [[1, ordre[0]], [10, ordre[1]]].forEach(function (x) {
            if (!x[1] || date.getTime() < debutCase(x[0]).getTime()) return;
            const c = db.prepare("SELECT id FROM cartes WHERE famille = 'joueur' AND player_id = ? AND rarete = 'legendaire' AND user_id IS NULL").get(x[1]);
            if (c) dues.push(c.id);
        });
        return dues;
    }

    function ouvrirPochette(userId, source, taille, garantieEpique) {
        assurerStock();
        const date = maintenant();
        return db.transaction(function () {
            const pochetteId = db.prepare('INSERT INTO pochettes (user_id, source, date_ouverture) VALUES (?, ?, ?)').run(userId, source, date.toISOString()).lastInsertRowid;
            const ids = [];
            const attribuer = db.prepare('UPDATE cartes SET user_id = ?, pochette_id = ?, date_obtention = ? WHERE id = ? AND user_id IS NULL');
            const prendre = function (id) {
                if (id && attribuer.run(userId, pochetteId, date.toISOString(), id).changes === 1) ids.push(id);
            };
            const slots = taille === 10 ? SLOTS.concat(SLOTS) : SLOTS;
            slots.forEach(function (slot) { const s = rouler(slot); prendre(tirerCarte(s[0], s[1])); });
            if (garantieEpique) {
                const dejaEpique = ids.some(function (id) {
                    const r = db.prepare('SELECT rarete FROM cartes WHERE id = ?').get(id).rarete;
                    return r === 'epique' || r === 'legendaire';
                });
                if (!dejaEpique) {
                    const epique = tirerCarte(Math.random() < 0.5 ? 'joueur' : 'moment', 'epique');
                    if (epique) {
                        // remplace une commune (rendue au stock) par l'epique
                        const commune = ids.find(function (id) { return db.prepare('SELECT rarete FROM cartes WHERE id = ?').get(id).rarete === 'commune'; });
                        if (commune) {
                            db.prepare('UPDATE cartes SET user_id = NULL, pochette_id = NULL, date_obtention = NULL WHERE id = ?').run(commune);
                            ids.splice(ids.indexOf(commune), 1);
                        }
                        prendre(epique);
                    }
                }
            }
            legendairesDues(userId, date).forEach(prendre);
            return { pochetteId: Number(pochetteId), ids: ids };
        })();
    }

    /* ---------------- Description des cartes ---------------- */
    function decrireCartes(ids) {
        if (!ids.length) return [];
        const cacheJoueur = new Map();
        const infosJoueur = function (playerId) {
            if (cacheJoueur.has(playerId)) return cacheJoueur.get(playerId);
            const p = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
            if (!p) { cacheJoueur.set(playerId, null); return null; }
            const circuit = p.type === 'joueur' ? 'ATP' : 'WTA';
            const titres = db.prepare(`
                SELECT t.categorie AS categorie, COUNT(*) AS n FROM tournoi_joueurs tj JOIN tournois t ON t.id = tj.tournoi_id
                WHERE tj.player_id = ? AND tj.est_reel = 1 AND tj.tour_elimine = 'Vainqueur' GROUP BY t.categorie
            `).all(p.id);
            const det = { '250': 0, '500': 0, '1000': 0, slam: 0 };
            let total = 0;
            titres.forEach(function (t) { total += t.n; if (det[t.categorie] !== undefined) det[t.categorie] += t.n; });
            let surface = 'dur';
            try {
                const niveaux = { dur: niveauNormal(p, 'dur'), terre: niveauNormal(p, 'terre'), herbe: niveauNormal(p, 'herbe') };
                surface = Object.keys(niveaux).sort(function (a, b) { return niveaux[b] - niveaux[a]; })[0];
            } catch (e) { surface = 'dur'; }
            const best = meilleurClassement(circuit, 'joueur:' + p.id);
            const info = {
                playerId: p.id, prenom: String(p.prenom || '').trim(), nom: String(p.nom || '').trim(), circuit: circuit,
                nationalite: p.nationalite, drapeau: drapeau(p.nationalite), photo: p.photo_avatar || null,
                surface: surface === 'herbe' ? 'gazon' : surface,
                meilleurRang: best ? best.rang : null, titres: total, detailTitres: [det['250'], det['500'], det['1000'], det.slam]
            };
            cacheJoueur.set(playerId, info);
            return info;
        };
        const lignes = db.prepare('SELECT * FROM cartes WHERE id IN (' + ids.map(function () { return '?'; }).join(',') + ')').all(...ids);
        const parId = new Map(lignes.map(function (c) { return [c.id, c]; }));
        return ids.map(function (id) { return parId.get(id); }).filter(Boolean).map(function (c) {
            const j = infosJoueur(c.player_id);
            const carte = { id: c.id, famille: c.famille, rarete: c.rarete, numero: c.numero, total: c.total, joueur: j };
            if (c.famille === 'moment') {
                const t = db.prepare('SELECT * FROM tournois WHERE id = ?').get(c.tournoi_id);
                if (t) {
                    const finale = db.prepare("SELECT * FROM tournoi_matchs WHERE tournoi_id = ? AND numero_tour = 'Finale' ORDER BY id DESC LIMIT 1").get(t.id);
                    let adversaire = null;
                    if (finale) {
                        const ids2 = [finale.joueur1_id, finale.joueur2_id].filter(function (x) { return x && x !== finale.vainqueur_id; });
                        const adv = ids2.length ? db.prepare('SELECT nom FROM tournoi_joueurs WHERE id = ?').get(ids2[0]) : null;
                        adversaire = adv ? adv.nom : null;
                    }
                    carte.tournoi = {
                        id: t.id, calendrierId: t.calendrier_id, nom: t.nom, categorie: t.categorie, circuit: t.circuit,
                        surface: t.surface === 'herbe' ? 'gazon' : t.surface,
                        saison: phaseAffichee(t.semaine).numeroSaison, semaine: positionSemaineAffichee(t.semaine), absSemaine: t.semaine,
                        score: finale && finale.score ? finale.score : '', adversaire: adversaire
                    };
                }
            }
            return carte;
        });
    }

    /* ---------------- Calendrier de l'Avent ---------------- */
    function etatAvent(userId) {
        const date = maintenant();
        const jourActuel = caseDuMoment(date);
        const ouvertes = new Map(db.prepare('SELECT jour, pochette_id FROM avent_ouvertures WHERE user_id = ? AND annee = ?').all(userId, ANNEE_AVENT)
            .map(function (r) { return [r.jour, r]; }));
        const cases = [];
        for (let j = 1; j <= 25; j++) {
            const def = CASES[j];
            let etat;
            if (ouvertes.has(j)) etat = 'ouverte';
            else if (jourActuel === j) etat = 'disponible';
            else if (date.getTime() >= debutCase(j + 1).getTime()) etat = 'ratee';
            else etat = 'a_venir';
            const c = { jour: j, type: def.type, etat: etat, ouverture: debutCase(j).toISOString() };
            // Le contenu d'une case n'est devoile qu'une fois ouverte (ou ratee : titre seul).
            if (etat === 'ouverte' || etat === 'ratee') { c.titre = def.titre; c.texte = def.texte; }
            if (etat === 'ouverte') {
                if (def.fichiers) c.fichiers = def.fichiers;
                if (def.type === 'teaser') { c.part = def.part; c.jMoins = def.jMoins; }
                if (def.code) c.code = def.code;
                const o = ouvertes.get(j);
                if (o.pochette_id) c.cartes = decrireCartes(db.prepare('SELECT id FROM cartes WHERE pochette_id = ? ORDER BY id').all(o.pochette_id).map(function (r) { return r.id; }));
            }
            cases.push(c);
        }
        const prochaine = jourActuel === null
            ? cases.find(function (c) { return c.etat === 'a_venir'; })
            : cases.find(function (c) { return c.jour === jourActuel + 1; });
        return {
            annee: ANNEE_AVENT, jourActuel: jourActuel,
            actif: date.getTime() >= debutCase(1).getTime() && date.getTime() < debutCase(26).getTime(),
            caseDuJourOuverte: jourActuel !== null && ouvertes.has(jourActuel),
            prochaineOuverture: prochaine ? prochaine.ouverture : null,
            nbOuvertes: ouvertes.size,
            cases: cases
        };
    }

    app.get('/api/avent', function (req, res) {
        try {
            res.json(Object.assign({ success: true }, etatAvent(req.userId)));
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });

    app.post('/api/avent/ouvrir', function (req, res) {
        try {
            const userId = req.userId;
            const jour = caseDuMoment(maintenant());
            if (jour === null) return res.status(400).json({ error: "Aucune case du calendrier de l'Avent n'est ouvrable en ce moment." });
            const def = CASES[jour];
            const deja = db.prepare('SELECT 1 FROM avent_ouvertures WHERE user_id = ? AND annee = ? AND jour = ?').get(userId, ANNEE_AVENT, jour);
            if (deja) return res.status(400).json({ error: 'Tu as déjà ouvert la case du jour.' });
            // Reserve aux coachs qui ont au moins un personnage valide (sinon pas de collection).
            const aPerso = db.prepare("SELECT 1 FROM players WHERE user_id = ? AND statut = 'valide'").get(userId);
            if (!aPerso) return res.status(400).json({ error: 'Crée et fais valider tes personnages pour ouvrir le calendrier.' });

            let pochette = null;
            if (def.type === 'pochette') pochette = ouvrirPochette(userId, 'avent-' + ANNEE_AVENT + '-' + jour, def.taille, !!def.super);
            const date = maintenant().toISOString();
            db.transaction(function () {
                db.prepare('INSERT INTO avent_ouvertures (user_id, annee, jour, date_ouverture, pochette_id) VALUES (?, ?, ?, ?, ?)')
                    .run(userId, ANNEE_AVENT, jour, date, pochette ? pochette.pochetteId : null);
                (def.codes || (def.code ? [def.code] : [])).forEach(function (code) {
                    db.prepare('INSERT OR IGNORE INTO cosmetiques (user_id, code, date_obtention) VALUES (?, ?, ?)').run(userId, code, date);
                });
            })();
            const etat = etatAvent(userId);
            res.json({ success: true, jour: jour, case: etat.cases[jour - 1], cartes: pochette ? decrireCartes(pochette.ids) : [] });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });

    /* ---------------- Album ---------------- */
    // Mes cartes + pour chaque joueur / Moment present dans l'album, combien
    // d'exemplaires de chaque rarete restent a trouver dans tout le jeu.
    app.get('/api/collection', function (req, res) {
        try {
            const userId = req.params.userId ? Number(req.params.userId) : req.userId;
            const ids = db.prepare('SELECT id FROM cartes WHERE user_id = ? ORDER BY famille, player_id, tournoi_id, rarete, numero').all(userId).map(function (r) { return r.id; });
            const cartes = decrireCartes(ids);
            const restants = {};
            db.prepare(`
                SELECT famille, player_id, tournoi_id, rarete, COUNT(*) AS n FROM cartes WHERE user_id IS NULL
                  AND (famille, player_id, tournoi_id) IN (SELECT DISTINCT famille, player_id, tournoi_id FROM cartes WHERE user_id = ?)
                GROUP BY famille, player_id, tournoi_id, rarete
            `).all(userId).forEach(function (r) {
                const cle = r.famille + ':' + r.player_id + ':' + r.tournoi_id;
                (restants[cle] = restants[cle] || {})[r.rarete] = r.n;
            });
            res.json({ success: true, cartes: cartes, restants: restants, tirages: { joueur: TIRAGE_J, moment: TIRAGE_M } });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });

    /* ---------------- Cosmetiques ---------------- */
    app.get('/api/cosmetiques', function (req, res) {
        try {
            const possedes = db.prepare('SELECT code, date_obtention FROM cosmetiques WHERE user_id = ? ORDER BY date_obtention').all(req.userId);
            const equipes = {};
            db.prepare('SELECT type, code FROM cosmetiques_equipes WHERE user_id = ?').all(req.userId).forEach(function (r) { equipes[r.type] = r.code; });
            res.json({ success: true, possedes: possedes, equipes: equipes });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });

    // Equiper (ou retirer, code null) un cadre / emoji / fond de fiche deja debloque.
    app.post('/api/cosmetiques/equiper', function (req, res) {
        try {
            const type = String((req.body && req.body.type) || '');
            const code = req.body && req.body.code ? String(req.body.code) : null;
            if (!['cadre', 'emoji', 'fiche'].includes(type)) return res.status(400).json({ error: 'Type de cadeau invalide.' });
            if (code === null) {
                db.prepare('DELETE FROM cosmetiques_equipes WHERE user_id = ? AND type = ?').run(req.userId, type);
                return res.json({ success: true });
            }
            if (code.split(':')[0] !== type) return res.status(400).json({ error: 'Ce cadeau ne correspond pas à ce type.' });
            const possede = db.prepare('SELECT 1 FROM cosmetiques WHERE user_id = ? AND code = ?').get(req.userId, code);
            if (!possede) return res.status(400).json({ error: "Tu n'as pas encore débloqué ce cadeau." });
            db.prepare('INSERT OR REPLACE INTO cosmetiques_equipes (user_id, type, code) VALUES (?, ?, ?)').run(req.userId, type, code);
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });

    // Cosmetiques equipes de plusieurs coachs d'un coup (affichage public : emojis
    // a cote des pseudos, cadres autour des avatars).
    function cosmetiquesEquipes(userIds) {
        const res = {};
        if (!userIds.length) return res;
        const places = userIds.map(function () { return '?'; }).join(',');
        db.prepare('SELECT user_id, type, code FROM cosmetiques_equipes WHERE user_id IN (' + places + ')')
            .all(...userIds).forEach(function (r) { (res[r.user_id] = res[r.user_id] || {})[r.type] = r.code; });
        // Badges d'evenements (rubrique "Evenements" de la fiche coach, hors records).
        db.prepare("SELECT user_id, code FROM cosmetiques WHERE code LIKE 'badge:%' AND user_id IN (" + places + ')')
            .all(...userIds).forEach(function (r) { const e = (res[r.user_id] = res[r.user_id] || {}); (e.badges = e.badges || []).push(r.code); });
        return res;
    }
    app.get('/api/cosmetiques/equipes', function (req, res) {
        try {
            const ids = String(req.query.ids || '').split(',').map(Number).filter(function (n) { return n > 0; }).slice(0, 500);
            res.json({ success: true, equipes: cosmetiquesEquipes(ids) });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'ERREUR : ' + err.message });
        }
    });

    // Stock cree au demarrage (puis complete a chaque ouverture de pochette).
    try { assurerStock(); } catch (e) { console.error('[collection] stock :', e.message); }

    return {
        // Notification de la cloche : case du jour pas encore ouverte.
        notificationAvent: function (userId) {
            const jour = caseDuMoment(maintenant());
            if (jour === null) return null;
            const deja = db.prepare('SELECT 1 FROM avent_ouvertures WHERE user_id = ? AND annee = ? AND jour = ?').get(userId, ANNEE_AVENT, jour);
            if (deja) return null;
            return {
                id: 'avent-' + ANNEE_AVENT + '-' + jour, type: 'avent', persistante: false,
                texte: "La case n°" + jour + " de ton calendrier de l'Avent t'attend",
                detail: "À ouvrir avant demain 10h, sinon elle est perdue",
                lien: 'accueil.html?avent=1', lienTexte: 'Ouvrir la case'
            };
        },
        cosmetiquesEquipes: cosmetiquesEquipes
    };
};
