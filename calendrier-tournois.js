// Donnees de reference pour le systeme de tournois : calendrier reel ATP/WTA
// (saison 2025, categories 250/500/1000/Grand Chelem) et baremes de points.
// Regles reelles compilees par recherche web (categories, baremes, semaines,
// chevauchements) - voir la note memoire "project_matchs_amical_live_teletexte"
// et l'artifact de reference pour le detail des sources.
//
// semaine_debut est une position dans un cycle de saison repete (1 a 52).
// Plusieurs tournois peuvent partager la meme semaine_debut : c'est voulu,
// ca represente le vrai parallelisme du calendrier (plusieurs tournois
// eligibles en meme temps, sur des semaines qui reviennent chaque annee).
//
// Les baremes de points sont ordonnes [Vainqueur, Finale, 1/2, 1/4, 8e, 16e, 32e, 64e]
// (du plus profond au moins profond). Un tableau plus court que le nombre de
// tours reels d'un tournoi donne est complete en reutilisant sa derniere
// valeur (les tours les plus precoces rapportent tous le meme minimum).

const BAREME_POINTS = {
    ATP_SLAM: [2000, 1300, 800, 400, 200, 100, 50, 10],
    ATP_1000_96: [1000, 650, 400, 200, 100, 50, 10],
    ATP_1000_56: [1000, 650, 400, 200, 100, 50, 10],
    ATP_500: [500, 330, 200, 100, 50, 25],
    ATP_250: [250, 165, 100, 50, 25, 13],
    WTA_SLAM: [2000, 1300, 780, 430, 240, 130, 70, 10],
    WTA_1000_96: [1000, 650, 390, 215, 120, 65, 10],
    WTA_1000_56: [1000, 650, 390, 215, 120, 65],
    WTA_500: [500, 325, 195, 108, 60, 30],
    WTA_250: [250, 163, 98, 54, 30],
    // Masters de fin de saison (format poules) : bareme officiel accumule par match gagne
    // (200/victoire de poule + 400 demie + 500 finale pour l'ATP, un peu moins cote WTA).
    // Simplifie ici en 4 paliers (Vainqueur/Finale/Demi-finale/Poules) pour rester coherent
    // avec le reste du bareme du jeu plutot que de suivre l'accumulation exacte match par match.
    ATP_FINALS: [1500, 1100, 600, 200],
    WTA_FINALS: [1500, 1080, 580, 125]
};

// Fourchette de niveau des joueurs lambda generes, par categorie. Ce sont des
// valeurs approximatives de depart (a ajuster une fois testees en jeu) pour
// que les tableaux 250 restent abordables et les Grands Chelems relevent.
const NIVEAU_LAMBDA_PAR_CATEGORIE = {
    250: { min: 220, max: 320 },
    500: { min: 260, max: 360 },
    1000: { min: 300, max: 400 },
    slam: { min: 330, max: 430 },
    finals: { min: 380, max: 460 }
};

// Semaines reservees pour Coupe Davis / Billie Jean King Cup (ex-Fed Cup), format
// "ancien" (4 manches dans l'annee, pas les Finales groupees modernes) - demande
// explicite de l'utilisateur le 2026-07-27. Aucun tournoi individuel ne doit etre
// place sur ces semaines pour les 2 circuits. Le moteur de simulation de ces
// manches (composition d'equipe par nation, capitaine, tie-play) reste A CONSTRUIRE
// - seules les semaines sont reservees ici pour l'instant, voir la memoire
// "project_coupe_equipes_calendrier" pour le detail des echanges de conception.
const SEMAINES_COUPES_EQUIPE = [
    { semaine: 5, manche: '1er tour' },
    { semaine: 14, manche: 'Quarts de finale' },
    { semaine: 38, manche: 'Demi-finales' },
    { semaine: 49, manche: 'Finale' },
    // Barrage de maintien (World Group Play-offs) : meme semaine que les Demi-
    // finales, comme dans le vrai ancien format (a ce stade il ne reste que 4
    // nations du Groupe mondial en lice, les 8 perdantes du 1er tour jouent leur
    // barrage de maintien contre 8 challengers en parallele). Cf. memoire
    // project_coupe_groupe_mondial pour le detail du systeme promotion/relegation.
    { semaine: 38, manche: 'Barrage de maintien' }
];

const CALENDRIER_TOURNOIS = [
    // --- ATP : swing australien ---
    { id: 'atp-brisbane', circuit: 'ATP', nom: 'Brisbane International', pays: 'Australie', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 1, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-hong-kong', circuit: 'ATP', nom: 'Hong Kong Open', pays: 'Hong Kong', categorie: 250, surface: 'dur', taille_tableau: 28, semaine_debut: 1, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-adelaide', circuit: 'ATP', nom: 'Adelaide International', pays: 'Australie', categorie: 250, surface: 'dur', taille_tableau: 28, semaine_debut: 2, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-auckland', circuit: 'ATP', nom: 'Auckland Open', pays: 'Nouvelle-Zelande', categorie: 250, surface: 'dur', taille_tableau: 28, semaine_debut: 2, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-ao', circuit: 'ATP', nom: 'Open d\'Australie', pays: 'Australie', categorie: 'slam', surface: 'dur', taille_tableau: 128, semaine_debut: 3, duree: 2, bareme: 'ATP_SLAM' },

    // --- ATP : golden swing (indoor + Amerique du Sud) ---
    { id: 'atp-montpellier', circuit: 'ATP', nom: 'Open Occitanie (Montpellier)', pays: 'France', categorie: 250, surface: 'dur', indoor: true, taille_tableau: 28, semaine_debut: 6, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-dallas', circuit: 'ATP', nom: 'Dallas Open', pays: 'Etats-Unis', categorie: 500, surface: 'dur', indoor: true, taille_tableau: 32, semaine_debut: 6, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-rotterdam', circuit: 'ATP', nom: 'Rotterdam Open', pays: 'Pays-Bas', categorie: 500, surface: 'dur', indoor: true, taille_tableau: 32, semaine_debut: 6, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-delray-beach', circuit: 'ATP', nom: 'Delray Beach Open', pays: 'Etats-Unis', categorie: 250, surface: 'dur', taille_tableau: 28, semaine_debut: 7, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-marseille', circuit: 'ATP', nom: 'Open 13 Provence (Marseille)', pays: 'France', categorie: 250, surface: 'dur', indoor: true, taille_tableau: 28, semaine_debut: 7, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-buenos-aires', circuit: 'ATP', nom: 'Argentina Open (Buenos Aires)', pays: 'Argentine', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 7, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-doha', circuit: 'ATP', nom: 'Qatar Open (Doha)', pays: 'Qatar', categorie: 500, surface: 'dur', taille_tableau: 32, semaine_debut: 8, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-rio', circuit: 'ATP', nom: 'Rio Open', pays: 'Bresil', categorie: 500, surface: 'terre', taille_tableau: 32, semaine_debut: 8, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-dubai', circuit: 'ATP', nom: 'Dubai Championships', pays: 'Emirats arabes unis', categorie: 500, surface: 'dur', taille_tableau: 32, semaine_debut: 9, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-acapulco', circuit: 'ATP', nom: 'Mexican Open (Acapulco)', pays: 'Mexique', categorie: 500, surface: 'dur', taille_tableau: 32, semaine_debut: 9, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-santiago', circuit: 'ATP', nom: 'Chile Open (Santiago)', pays: 'Chili', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 9, duree: 1, bareme: 'ATP_250' },

    // --- ATP : Sunshine Double ---
    { id: 'atp-indian-wells', circuit: 'ATP', nom: 'Indian Wells Masters', pays: 'Etats-Unis', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 10, duree: 2, bareme: 'ATP_1000_96' },
    { id: 'atp-miami', circuit: 'ATP', nom: 'Miami Open', pays: 'Etats-Unis', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 12, duree: 2, bareme: 'ATP_1000_96' },

    // --- ATP : swing terre battue ---
    { id: 'atp-houston', circuit: 'ATP', nom: 'US Men\'s Clay Court Championships (Houston)', pays: 'Etats-Unis', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 15, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-marrakech', circuit: 'ATP', nom: 'Grand Prix Hassan II (Marrakech)', pays: 'Maroc', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 15, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-bucarest', circuit: 'ATP', nom: 'Romanian Open (Bucarest)', pays: 'Roumanie', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 15, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-monte-carlo', circuit: 'ATP', nom: 'Monte-Carlo Masters', pays: 'Monaco', categorie: 1000, surface: 'terre', taille_tableau: 56, semaine_debut: 15, duree: 1, bareme: 'ATP_1000_56' },
    { id: 'atp-barcelone', circuit: 'ATP', nom: 'Barcelona Open', pays: 'Espagne', categorie: 500, surface: 'terre', taille_tableau: 32, semaine_debut: 16, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-munich', circuit: 'ATP', nom: 'Bavarian International (Munich)', pays: 'Allemagne', categorie: 500, surface: 'terre', taille_tableau: 32, semaine_debut: 16, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-madrid', circuit: 'ATP', nom: 'Madrid Masters', pays: 'Espagne', categorie: 1000, surface: 'terre', taille_tableau: 96, semaine_debut: 17, duree: 2, bareme: 'ATP_1000_96' },
    { id: 'atp-rome', circuit: 'ATP', nom: 'Rome Masters', pays: 'Italie', categorie: 1000, surface: 'terre', taille_tableau: 96, semaine_debut: 19, duree: 2, bareme: 'ATP_1000_96' },
    { id: 'atp-hambourg', circuit: 'ATP', nom: 'Hamburg Open', pays: 'Allemagne', categorie: 500, surface: 'terre', taille_tableau: 32, semaine_debut: 21, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-geneve', circuit: 'ATP', nom: 'Geneva Open', pays: 'Suisse', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 21, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-rg', circuit: 'ATP', nom: 'Roland-Garros', pays: 'France', categorie: 'slam', surface: 'terre', taille_tableau: 128, semaine_debut: 22, duree: 2, bareme: 'ATP_SLAM' },

    // --- ATP : swing herbe ---
    { id: 'atp-queens', circuit: 'ATP', nom: 'Queen\'s Club Championships', pays: 'Royaume-Uni', categorie: 500, surface: 'herbe', taille_tableau: 32, semaine_debut: 25, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-halle', circuit: 'ATP', nom: 'Halle Open', pays: 'Allemagne', categorie: 500, surface: 'herbe', taille_tableau: 32, semaine_debut: 25, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-stuttgart', circuit: 'ATP', nom: 'Stuttgart Open', pays: 'Allemagne', categorie: 250, surface: 'herbe', taille_tableau: 28, semaine_debut: 24, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-s-hertogenbosch', circuit: 'ATP', nom: 'Libema Open (\'s-Hertogenbosch)', pays: 'Pays-Bas', categorie: 250, surface: 'herbe', taille_tableau: 28, semaine_debut: 24, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-mallorca', circuit: 'ATP', nom: 'Mallorca Open', pays: 'Espagne', categorie: 250, surface: 'herbe', taille_tableau: 28, semaine_debut: 26, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-eastbourne', circuit: 'ATP', nom: 'Eastbourne International', pays: 'Royaume-Uni', categorie: 250, surface: 'herbe', taille_tableau: 28, semaine_debut: 26, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-wimbledon', circuit: 'ATP', nom: 'Wimbledon', pays: 'Royaume-Uni', categorie: 'slam', surface: 'herbe', taille_tableau: 128, semaine_debut: 27, duree: 2, bareme: 'ATP_SLAM' },

    // --- ATP : ete europeen + swing dur US ---
    { id: 'atp-los-cabos', circuit: 'ATP', nom: 'Los Cabos Open', pays: 'Mexique', categorie: 250, surface: 'dur', taille_tableau: 28, semaine_debut: 29, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-bastad', circuit: 'ATP', nom: 'Swedish Open (Bastad)', pays: 'Suede', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 29, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-gstaad', circuit: 'ATP', nom: 'Swiss Open (Gstaad)', pays: 'Suisse', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 29, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-umag', circuit: 'ATP', nom: 'Croatia Open (Umag)', pays: 'Croatie', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 30, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-kitzbuhel', circuit: 'ATP', nom: 'Generali Open (Kitzbuhel)', pays: 'Autriche', categorie: 250, surface: 'terre', taille_tableau: 28, semaine_debut: 30, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-washington', circuit: 'ATP', nom: 'Washington Open', pays: 'Etats-Unis', categorie: 500, surface: 'dur', taille_tableau: 48, semaine_debut: 30, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-canada', circuit: 'ATP', nom: 'Canada Masters (Montreal/Toronto)', pays: 'Canada', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 31, duree: 2, bareme: 'ATP_1000_96' },
    { id: 'atp-cincinnati', circuit: 'ATP', nom: 'Cincinnati Masters', pays: 'Etats-Unis', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 33, duree: 2, bareme: 'ATP_1000_96' },
    { id: 'atp-winston-salem', circuit: 'ATP', nom: 'Winston-Salem Open', pays: 'Etats-Unis', categorie: 250, surface: 'dur', taille_tableau: 48, semaine_debut: 35, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-us-open', circuit: 'ATP', nom: 'US Open', pays: 'Etats-Unis', categorie: 'slam', surface: 'dur', taille_tableau: 128, semaine_debut: 36, duree: 2, bareme: 'ATP_SLAM' },

    // --- ATP : swing asiatique ---
    { id: 'atp-chengdu', circuit: 'ATP', nom: 'Chengdu Open', pays: 'Chine', categorie: 250, surface: 'dur', taille_tableau: 28, semaine_debut: 39, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-hangzhou', circuit: 'ATP', nom: 'Hangzhou Open', pays: 'Chine', categorie: 250, surface: 'dur', taille_tableau: 28, semaine_debut: 39, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-beijing', circuit: 'ATP', nom: 'China Open (Pekin)', pays: 'Chine', categorie: 500, surface: 'dur', taille_tableau: 32, semaine_debut: 40, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-tokyo', circuit: 'ATP', nom: 'Japan Open (Tokyo)', pays: 'Japon', categorie: 500, surface: 'dur', taille_tableau: 32, semaine_debut: 40, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-shanghai', circuit: 'ATP', nom: 'Shanghai Masters', pays: 'Chine', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 41, duree: 2, bareme: 'ATP_1000_96' },

    // --- ATP : swing indoor ---
    { id: 'atp-almaty', circuit: 'ATP', nom: 'Almaty Open', pays: 'Kazakhstan', categorie: 250, surface: 'dur', indoor: true, taille_tableau: 28, semaine_debut: 43, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-bruxelles', circuit: 'ATP', nom: 'European Open (Bruxelles)', pays: 'Belgique', categorie: 250, surface: 'dur', indoor: true, taille_tableau: 28, semaine_debut: 43, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-stockholm', circuit: 'ATP', nom: 'BNP Paribas Nordic Open (Stockholm)', pays: 'Suede', categorie: 250, surface: 'dur', indoor: true, taille_tableau: 28, semaine_debut: 46, duree: 1, bareme: 'ATP_250' },
    { id: 'atp-vienne', circuit: 'ATP', nom: 'Vienna Open', pays: 'Autriche', categorie: 500, surface: 'dur', indoor: true, taille_tableau: 32, semaine_debut: 44, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-bale', circuit: 'ATP', nom: 'Swiss Indoors (Bale)', pays: 'Suisse', categorie: 500, surface: 'dur', indoor: true, taille_tableau: 32, semaine_debut: 44, duree: 1, bareme: 'ATP_500' },
    { id: 'atp-paris', circuit: 'ATP', nom: 'Paris Masters', pays: 'France', categorie: 1000, surface: 'dur', indoor: true, taille_tableau: 56, semaine_debut: 45, duree: 1, bareme: 'ATP_1000_56' },

    // --- ATP : Masters de fin de saison (format poules) ---
    { id: 'atp-finals', circuit: 'ATP', nom: 'Nitto ATP Finals', pays: 'Italie', categorie: 'finals', surface: 'dur', indoor: true, taille_tableau: 8, semaine_debut: 48, duree: 1, bareme: 'ATP_FINALS', format: 'poules' },

    // --- WTA : swing australien ---
    { id: 'wta-brisbane', circuit: 'WTA', nom: 'Brisbane International', pays: 'Australie', categorie: 500, surface: 'dur', taille_tableau: 48, semaine_debut: 1, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-auckland', circuit: 'WTA', nom: 'Auckland Open', pays: 'Nouvelle-Zelande', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 1, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-adelaide', circuit: 'WTA', nom: 'Adelaide International', pays: 'Australie', categorie: 500, surface: 'dur', taille_tableau: 32, semaine_debut: 2, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-hobart', circuit: 'WTA', nom: 'Hobart International', pays: 'Australie', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 2, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-ao', circuit: 'WTA', nom: 'Open d\'Australie', pays: 'Australie', categorie: 'slam', surface: 'dur', taille_tableau: 128, semaine_debut: 3, duree: 2, bareme: 'WTA_SLAM' },

    // --- WTA : swing indoor / hiver ---
    { id: 'wta-linz', circuit: 'WTA', nom: 'Linz Open', pays: 'Autriche', categorie: 500, surface: 'dur', indoor: true, taille_tableau: 28, semaine_debut: 6, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-singapour', circuit: 'WTA', nom: 'Singapore Open', pays: 'Singapour', categorie: 250, surface: 'dur', indoor: true, taille_tableau: 32, semaine_debut: 6, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-abou-dabi', circuit: 'WTA', nom: 'Abu Dhabi Open', pays: 'Emirats arabes unis', categorie: 500, surface: 'dur', taille_tableau: 28, semaine_debut: 6, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-cluj', circuit: 'WTA', nom: 'Transylvania Open (Cluj-Napoca)', pays: 'Roumanie', categorie: 250, surface: 'dur', indoor: true, taille_tableau: 32, semaine_debut: 6, duree: 1, bareme: 'WTA_250' },

    // --- WTA : Moyen-Orient + pre-Sunshine ---
    { id: 'wta-doha', circuit: 'WTA', nom: 'Qatar Open (Doha)', pays: 'Qatar', categorie: 1000, surface: 'dur', taille_tableau: 56, semaine_debut: 7, duree: 1, bareme: 'WTA_1000_56' },
    { id: 'wta-dubai', circuit: 'WTA', nom: 'Dubai Championships', pays: 'Emirats arabes unis', categorie: 1000, surface: 'dur', taille_tableau: 56, semaine_debut: 8, duree: 1, bareme: 'WTA_1000_56' },
    { id: 'wta-merida', circuit: 'WTA', nom: 'Merida Open', pays: 'Mexique', categorie: 500, surface: 'dur', taille_tableau: 28, semaine_debut: 9, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-austin', circuit: 'WTA', nom: 'ATX Open (Austin)', pays: 'Etats-Unis', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 9, duree: 1, bareme: 'WTA_250' },

    // --- WTA : Sunshine Double ---
    { id: 'wta-indian-wells', circuit: 'WTA', nom: 'Indian Wells Open', pays: 'Etats-Unis', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 10, duree: 2, bareme: 'WTA_1000_96' },
    { id: 'wta-miami', circuit: 'WTA', nom: 'Miami Open', pays: 'Etats-Unis', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 12, duree: 2, bareme: 'WTA_1000_96' },

    // --- WTA : swing terre battue ---
    { id: 'wta-charleston', circuit: 'WTA', nom: 'Charleston Open', pays: 'Etats-Unis', categorie: 500, surface: 'terre', taille_tableau: 48, semaine_debut: 15, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-bogota', circuit: 'WTA', nom: 'Copa Colsanitas (Bogota)', pays: 'Colombie', categorie: 250, surface: 'terre', taille_tableau: 32, semaine_debut: 15, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-rouen', circuit: 'WTA', nom: 'Open de Rouen', pays: 'France', categorie: 250, surface: 'terre', indoor: true, taille_tableau: 32, semaine_debut: 16, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-stuttgart', circuit: 'WTA', nom: 'Stuttgart Open', pays: 'Allemagne', categorie: 500, surface: 'terre', indoor: true, taille_tableau: 28, semaine_debut: 16, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-rabat', circuit: 'WTA', nom: 'Morocco Open (Rabat)', pays: 'Maroc', categorie: 250, surface: 'terre', taille_tableau: 32, semaine_debut: 21, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-madrid', circuit: 'WTA', nom: 'Madrid Open', pays: 'Espagne', categorie: 1000, surface: 'terre', taille_tableau: 96, semaine_debut: 17, duree: 2, bareme: 'WTA_1000_96' },
    { id: 'wta-rome', circuit: 'WTA', nom: 'Italian Open (Rome)', pays: 'Italie', categorie: 1000, surface: 'terre', taille_tableau: 96, semaine_debut: 19, duree: 2, bareme: 'WTA_1000_96' },
    { id: 'wta-strasbourg', circuit: 'WTA', nom: 'Strasbourg Open', pays: 'France', categorie: 500, surface: 'terre', taille_tableau: 28, semaine_debut: 21, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-rg', circuit: 'WTA', nom: 'Roland-Garros', pays: 'France', categorie: 'slam', surface: 'terre', taille_tableau: 128, semaine_debut: 22, duree: 2, bareme: 'WTA_SLAM' },

    // --- WTA : swing herbe ---
    { id: 'wta-berlin', circuit: 'WTA', nom: 'Berlin Open', pays: 'Allemagne', categorie: 500, surface: 'herbe', taille_tableau: 28, semaine_debut: 25, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-queens', circuit: 'WTA', nom: 'Queen\'s Club (HSBC Championships)', pays: 'Royaume-Uni', categorie: 500, surface: 'herbe', taille_tableau: 28, semaine_debut: 24, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-bad-homburg', circuit: 'WTA', nom: 'Bad Homburg Open', pays: 'Allemagne', categorie: 500, surface: 'herbe', taille_tableau: 32, semaine_debut: 26, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-rosmalen', circuit: 'WTA', nom: 'Rosmalen Open (Libema)', pays: 'Pays-Bas', categorie: 250, surface: 'herbe', taille_tableau: 32, semaine_debut: 24, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-nottingham', circuit: 'WTA', nom: 'Nottingham Open', pays: 'Royaume-Uni', categorie: 250, surface: 'herbe', taille_tableau: 32, semaine_debut: 25, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-eastbourne', circuit: 'WTA', nom: 'Eastbourne Open', pays: 'Royaume-Uni', categorie: 250, surface: 'herbe', taille_tableau: 32, semaine_debut: 26, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-wimbledon', circuit: 'WTA', nom: 'Wimbledon', pays: 'Royaume-Uni', categorie: 'slam', surface: 'herbe', taille_tableau: 128, semaine_debut: 27, duree: 2, bareme: 'WTA_SLAM' },

    // --- WTA : ete europeen + swing dur US ---
    { id: 'wta-hambourg', circuit: 'WTA', nom: 'Hamburg Open', pays: 'Allemagne', categorie: 250, surface: 'terre', taille_tableau: 32, semaine_debut: 29, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-iasi', circuit: 'WTA', nom: 'Iasi Open', pays: 'Roumanie', categorie: 250, surface: 'terre', taille_tableau: 32, semaine_debut: 29, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-prague', circuit: 'WTA', nom: 'Prague Open', pays: 'Republique tcheque', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 30, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-washington', circuit: 'WTA', nom: 'Washington Open', pays: 'Etats-Unis', categorie: 500, surface: 'dur', taille_tableau: 28, semaine_debut: 30, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-canada', circuit: 'WTA', nom: 'Canadian Open (Montreal/Toronto)', pays: 'Canada', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 31, duree: 2, bareme: 'WTA_1000_96' },
    { id: 'wta-cincinnati', circuit: 'WTA', nom: 'Cincinnati Open', pays: 'Etats-Unis', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 33, duree: 2, bareme: 'WTA_1000_96' },
    { id: 'wta-cleveland', circuit: 'WTA', nom: 'Tennis in the Land (Cleveland)', pays: 'Etats-Unis', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 35, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-monterrey', circuit: 'WTA', nom: 'Monterrey Open', pays: 'Mexique', categorie: 500, surface: 'dur', taille_tableau: 28, semaine_debut: 35, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-us-open', circuit: 'WTA', nom: 'US Open', pays: 'Etats-Unis', categorie: 'slam', surface: 'dur', taille_tableau: 128, semaine_debut: 36, duree: 2, bareme: 'WTA_SLAM' },

    // --- WTA : swing asiatique ---
    { id: 'wta-sao-paulo', circuit: 'WTA', nom: 'SP Open (Sao Paulo)', pays: 'Bresil', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 39, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-guadalajara', circuit: 'WTA', nom: 'Guadalajara Open', pays: 'Mexique', categorie: 500, surface: 'dur', taille_tableau: 28, semaine_debut: 39, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-seoul', circuit: 'WTA', nom: 'Korea Open (Seoul)', pays: 'Coree du Sud', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 39, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-beijing', circuit: 'WTA', nom: 'China Open (Pekin)', pays: 'Chine', categorie: 1000, surface: 'dur', taille_tableau: 96, semaine_debut: 40, duree: 2, bareme: 'WTA_1000_96' },
    { id: 'wta-wuhan', circuit: 'WTA', nom: 'Wuhan Open', pays: 'Chine', categorie: 1000, surface: 'dur', taille_tableau: 56, semaine_debut: 42, duree: 1, bareme: 'WTA_1000_56' },
    { id: 'wta-ningbo', circuit: 'WTA', nom: 'Ningbo Open', pays: 'Chine', categorie: 500, surface: 'dur', taille_tableau: 28, semaine_debut: 43, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-osaka', circuit: 'WTA', nom: 'Japan Open (Osaka)', pays: 'Japon', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 43, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-guangzhou', circuit: 'WTA', nom: 'Guangzhou Open', pays: 'Chine', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 44, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-tokyo', circuit: 'WTA', nom: 'Tokyo Open (Pan Pacific)', pays: 'Japon', categorie: 500, surface: 'dur', taille_tableau: 28, semaine_debut: 44, duree: 1, bareme: 'WTA_500' },
    { id: 'wta-hong-kong', circuit: 'WTA', nom: 'Hong Kong Open', pays: 'Hong Kong', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 45, duree: 1, bareme: 'WTA_250' },
    { id: 'wta-chennai', circuit: 'WTA', nom: 'Chennai Open', pays: 'Inde', categorie: 250, surface: 'dur', taille_tableau: 32, semaine_debut: 45, duree: 1, bareme: 'WTA_250' },

    // --- WTA : Masters de fin de saison (format poules) ---
    { id: 'wta-finals', circuit: 'WTA', nom: 'WTA Finals', pays: 'Italie', categorie: 'finals', surface: 'dur', indoor: true, taille_tableau: 8, semaine_debut: 47, duree: 1, bareme: 'WTA_FINALS', format: 'poules' }
];

const PRENOMS_LAMBDA = [
    'Marco', 'Luca', 'Tomas', 'Milos', 'Pavel', 'Ivan', 'Diego', 'Pedro', 'Hugo', 'Felix',
    'Erik', 'Anders', 'Jonas', 'Lukas', 'Mateo', 'Rafa', 'Nico', 'Leon', 'Adam', 'Kenji',
    'Yuki', 'Wei', 'Jae', 'Omar', 'Karim', 'Ben', 'Sam', 'Alex', 'Chris', 'Dan'
];
const PRENOMS_LAMBDA_F = [
    'Marta', 'Elena', 'Sofia', 'Nina', 'Anna', 'Clara', 'Lucia', 'Emma', 'Julia', 'Laura',
    'Ines', 'Mia', 'Vera', 'Iris', 'Zara', 'Yuki', 'Wei', 'Sara', 'Nora', 'Alix',
    'Petra', 'Olga', 'Katya', 'Dana', 'Rosa', 'Bea', 'Cami', 'Dara', 'Fay', 'Gina'
];
const NOMS_LAMBDA = [
    'Bergman', 'Novak', 'Kowalski', 'Dubois', 'Moreau', 'Santos', 'Silva', 'Ricci', 'Rossi', 'Weber',
    'Schmidt', 'Muller', 'Andersson', 'Nilsson', 'Ivanov', 'Petrov', 'Popov', 'Costa', 'Alves', 'Herrera',
    'Vidal', 'Fontaine', 'Laurent', 'Girard', 'Roy', 'Tanaka', 'Sato', 'Kim', 'Park', 'Wong'
];
const NATIONALITES_LAMBDA = [
    'France', 'Espagne', 'Italie', 'Allemagne', 'Suede', 'Serbie', 'Croatie', 'Pologne',
    'Argentine', 'Bresil', 'Etats-Unis', 'Canada', 'Australie', 'Japon', 'Coree du Sud',
    'Republique tcheque', 'Autriche', 'Suisse', 'Belgique', 'Pays-Bas', 'Portugal', 'Grece'
];

// Codes pays (ISO 3166-1 alpha-2) pour construire un vrai drapeau image (voir
// flagImg() cote frontend) au lieu d'un emoji Unicode - sur Windows, Chrome/Edge
// n'ont pas de police couleur pour les emoji drapeau et affichent les 2 lettres
// brutes ("FR") a la place. Couvre les ~177 nationalites du formulaire de
// creation de personnage (creation-joueurs.html, graphie accentuee) + les pays
// hotes de tournoi de ce fichier. normaliserPays() enleve les accents et met en
// minuscule avant la recherche, ce qui fait aussi matcher au passage les noms
// non-accentues de NATIONALITES_LAMBDA ci-dessus (ex. "Coree du Sud" et
// "Corée du Sud" tombent sur la meme cle) sans avoir besoin de deux tables.
function normaliserPays(nom) {
    let base = '';
    for (const car of nom.normalize('NFD')) {
        const code = car.codePointAt(0);
        const estAccentCombinant = code >= 768 && code <= 879;
        if (!estAccentCombinant) base += car;
    }
    return base.toLowerCase();
}

const CODES_PAYS = {
    'afghanistan': 'af', 'afrique du sud': 'za', 'albanie': 'al', 'algerie': 'dz', 'allemagne': 'de',
    'andorre': 'ad', 'angola': 'ao', 'arabie saoudite': 'sa', 'argentine': 'ar', 'armenie': 'am',
    'australie': 'au', 'autriche': 'at', 'azerbaidjan': 'az', 'bahamas': 'bs', 'bahrein': 'bh',
    'bangladesh': 'bd', 'barbade': 'bb', 'belgique': 'be', 'belize': 'bz', 'benin': 'bj',
    'bhoutan': 'bt', 'bielorussie': 'by', 'birmanie': 'mm', 'bolivie': 'bo', 'bosnie-herzegovine': 'ba',
    'botswana': 'bw', 'bresil': 'br', 'brunei': 'bn', 'bulgarie': 'bg', 'burkina faso': 'bf',
    'burundi': 'bi', 'cambodge': 'kh', 'cameroun': 'cm', 'canada': 'ca', 'cap-vert': 'cv',
    'republique centrafricaine': 'cf', 'chili': 'cl', 'chine': 'cn', 'chypre': 'cy', 'colombie': 'co',
    'comores': 'km', 'congo': 'cg', 'republique democratique du congo': 'cd', 'coree du nord': 'kp',
    'coree du sud': 'kr', 'costa rica': 'cr', "cote d'ivoire": 'ci', 'croatie': 'hr', 'cuba': 'cu',
    'danemark': 'dk', 'djibouti': 'dj', 'egypte': 'eg', 'emirats arabes unis': 'ae', 'equateur': 'ec',
    'erythree': 'er', 'espagne': 'es', 'estonie': 'ee', 'eswatini': 'sz', 'etats-unis': 'us',
    'ethiopie': 'et', 'fidji': 'fj', 'finlande': 'fi', 'france': 'fr', 'gabon': 'ga', 'gambie': 'gm',
    'georgie': 'ge', 'ghana': 'gh', 'grece': 'gr', 'guatemala': 'gt', 'guinee': 'gn',
    'guinee equatoriale': 'gq', 'guinee-bissau': 'gw', 'guyana': 'gy', 'haiti': 'ht', 'honduras': 'hn',
    'hongrie': 'hu', 'inde': 'in', 'indonesie': 'id', 'irak': 'iq', 'iran': 'ir', 'irlande': 'ie',
    'islande': 'is', 'israel': 'il', 'italie': 'it', 'jamaique': 'jm', 'japon': 'jp', 'jordanie': 'jo',
    'kazakhstan': 'kz', 'kenya': 'ke', 'kirghizistan': 'kg', 'kosovo': 'xk', 'koweit': 'kw',
    'laos': 'la', 'lesotho': 'ls', 'lettonie': 'lv', 'liban': 'lb', 'liberia': 'lr', 'libye': 'ly',
    'liechtenstein': 'li', 'lituanie': 'lt', 'luxembourg': 'lu', 'macedoine du nord': 'mk',
    'madagascar': 'mg', 'malaisie': 'my', 'malawi': 'mw', 'maldives': 'mv', 'mali': 'ml', 'malte': 'mt',
    'maroc': 'ma', 'maurice': 'mu', 'mauritanie': 'mr', 'mexique': 'mx', 'moldavie': 'md',
    'monaco': 'mc', 'mongolie': 'mn', 'montenegro': 'me', 'mozambique': 'mz', 'namibie': 'na',
    'nepal': 'np', 'nicaragua': 'ni', 'niger': 'ne', 'nigeria': 'ng', 'norvege': 'no',
    'nouvelle-zelande': 'nz', 'oman': 'om', 'ouganda': 'ug', 'ouzbekistan': 'uz', 'pakistan': 'pk',
    'palestine': 'ps', 'panama': 'pa', 'papouasie-nouvelle-guinee': 'pg', 'paraguay': 'py',
    'pays-bas': 'nl', 'perou': 'pe', 'philippines': 'ph', 'pologne': 'pl', 'portugal': 'pt',
    'qatar': 'qa', 'republique dominicaine': 'do', 'republique tcheque': 'cz', 'roumanie': 'ro',
    'royaume-uni': 'gb', 'russie': 'ru', 'rwanda': 'rw', 'saint-marin': 'sm', 'salvador': 'sv', 'samoa': 'ws',
    'senegal': 'sn', 'serbie': 'rs', 'seychelles': 'sc', 'sierra leone': 'sl', 'singapour': 'sg',
    'slovaquie': 'sk', 'slovenie': 'si', 'somalie': 'so', 'soudan': 'sd', 'soudan du sud': 'ss',
    'sri lanka': 'lk', 'suede': 'se', 'suisse': 'ch', 'suriname': 'sr', 'syrie': 'sy',
    'tadjikistan': 'tj', 'tanzanie': 'tz', 'tchad': 'td', 'thailande': 'th', 'timor oriental': 'tl',
    'togo': 'tg', 'tunisie': 'tn', 'turkmenistan': 'tm', 'turquie': 'tr', 'ukraine': 'ua',
    'uruguay': 'uy', 'venezuela': 've', 'vietnam': 'vn', 'yemen': 'ye', 'zambie': 'zm',
    'zimbabwe': 'zw', 'hong kong': 'hk'
};

function drapeau(nationalite) {
    if (!nationalite) return '';
    return CODES_PAYS[normaliserPays(nationalite)] || '';
}

function choixAleatoire(liste) {
    return liste[Math.floor(Math.random() * liste.length)];
}

function genererJoueurLambda(categorie, estFeminin) {
    const fourchette = NIVEAU_LAMBDA_PAR_CATEGORIE[categorie] || NIVEAU_LAMBDA_PAR_CATEGORIE[250];
    const niveau = Math.round(fourchette.min + Math.random() * (fourchette.max - fourchette.min));
    const prenom = choixAleatoire(estFeminin ? PRENOMS_LAMBDA_F : PRENOMS_LAMBDA);
    return {
        nom: prenom + ' ' + choixAleatoire(NOMS_LAMBDA),
        nationalite: choixAleatoire(NATIONALITES_LAMBDA),
        niveau
    };
}

const LONGUEUR_SAISON = 51; // 1 Pre-saison + 1 Semaine 0 + 49 semaines de tournois

// Interprete un semaine_actuelle absolu (sans borne, incremente indefiniment) en
// phase de saison : presaison/s0 (aucun tournoi, aucune XP) ou tournoi (avec la
// position 1-49 a chercher dans CALENDRIER_TOURNOIS).
function phaseDeSemaine(semaine) {
    const positionSaison = ((semaine - 1) % LONGUEUR_SAISON) + 1;
    const numeroSaison = Math.floor((semaine - 1) / LONGUEUR_SAISON) + 1;
    if (positionSaison === 1) return { type: 'presaison', numeroSaison };
    if (positionSaison === 2) return { type: 's0', numeroSaison };
    return { type: 'tournoi', positionSemaine: positionSaison - 2, numeroSaison };
}

module.exports = { BAREME_POINTS, CALENDRIER_TOURNOIS, SEMAINES_COUPES_EQUIPE, genererJoueurLambda, drapeau, normaliserPays, phaseDeSemaine, LONGUEUR_SAISON };
