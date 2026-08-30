/*
 * Theme visuel de fond selon la periode de jeu : pendant les 2 semaines de chaque
 * Grand Chelem, le voile de fond du site prend une couleur dediee (bleu dur, terre
 * orangee, vert gazon, bleu nuit) et, si le fichier image correspondant existe, une
 * photo de fond dediee. Inclure via <script src="theme-saison.js"></script>.
 *
 * Pose un attribut data-slam sur <html> ; tout le rendu est ensuite gere en CSS
 * (voir "Themes Grand Chelem" dans style.css). /api/semaine est public : marche
 * aussi sur les pages hors connexion.
 */
(function () {
    var FENETRES = [
        { slam: 'ao', semaines: [3, 4] },          // Open d'Australie
        { slam: 'rg', semaines: [22, 23] },        // Roland-Garros
        { slam: 'wimbledon', semaines: [27, 28] }, // Wimbledon
        { slam: 'us-open', semaines: [36, 37] }    // US Open
    ];

    fetch('/api/semaine')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data || !data.phase || data.phase.type !== 'tournoi') return;
            var pos = data.phase.positionSemaine;
            for (var i = 0; i < FENETRES.length; i++) {
                if (FENETRES[i].semaines.indexOf(pos) !== -1) {
                    document.documentElement.setAttribute('data-slam', FENETRES[i].slam);
                    return;
                }
            }
        })
        .catch(function () { /* silencieux : pas de theme si l'appel echoue */ });
})();
