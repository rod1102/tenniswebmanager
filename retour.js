/*
 * Bouton "Retour" discret, partage par toutes les pages.
 * Inclure via <script src="retour.js"></script> juste avant </body>.
 *
 * Ne s'affiche que si on est arrive depuis une autre page du site
 * (document.referrer de meme origine) : pas en acces direct, pas de lien
 * externe, pas apres un simple rechargement de la meme page.
 * Au clic : history.back() si possible, sinon retour direct vers le referrer.
 */
(function () {
    function memeOrigine(url) {
        try {
            return new URL(url).origin === window.location.origin;
        } catch (e) {
            return false;
        }
    }

    var referrer = document.referrer;
    if (!referrer || !memeOrigine(referrer)) return;
    if (referrer.split('#')[0] === window.location.href.split('#')[0]) return;

    function init() {
        if (document.querySelector('.btn-retour-flottant')) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-retour-flottant';
        btn.setAttribute('aria-label', 'Revenir a la page precedente');
        btn.innerHTML = '<span aria-hidden="true">←</span> Retour';
        btn.addEventListener('click', function () {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = referrer;
            }
        });

        document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
