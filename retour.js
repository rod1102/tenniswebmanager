/*
 * Bouton "Retour" partage par toutes les pages.
 * Inclure via <script src="retour.js"></script> juste avant </body>.
 *
 * Rendu : un bouton dans le meme style que le bouton "Menu", en plus petit,
 * place juste sous le nom du jeu (dans l'en-tete). Sur les pages sans en-tete
 * de tableau de bord (connexion, inscription...), il se place sous le logo centre.
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
    var actif = !!referrer
        && memeOrigine(referrer)
        && referrer.split('#')[0] !== window.location.href.split('#')[0];

    function creerBouton() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-retour-entete';
        btn.setAttribute('aria-label', 'Revenir a la page precedente');
        btn.innerHTML = '<span class="btn-retour-fleche" aria-hidden="true">←</span> Retour';
        btn.addEventListener('click', function () {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = referrer;
            }
        });
        return btn;
    }

    function init() {
        if (!actif) return;
        if (document.querySelector('.btn-retour-entete')) return;

        var logo = document.querySelector('.auth-logo');
        if (!logo) return;

        var btn = creerBouton();
        // Vrai si le logo partage sa ligne avec le bouton "Menu" (en-tete de jeu).
        var dansEnTete = logo.closest('.dashboard-header')
            || logo.parentNode.querySelector(':scope > .nav-menu');

        if (dansEnTete) {
            // Colonne : nom du jeu au-dessus, bouton retour juste en dessous.
            var brand = document.createElement('div');
            brand.className = 'dashboard-brand';
            logo.parentNode.insertBefore(brand, logo);
            brand.appendChild(logo);
            brand.appendChild(btn);
        } else {
            // Pages d'authentification : sous le logo centre.
            btn.classList.add('btn-retour-entete-centre');
            logo.parentNode.insertBefore(btn, logo.nextSibling);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
