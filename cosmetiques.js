/*
 * Cadeaux cosmetiques du calendrier de l'Avent affiches sur le site (2026-11-26) :
 *  - emoji a cote du pseudo d'un coach : tous les liens vers coach.html?id=N, et
 *    tout element [data-emoji-coach="N"] (titre de la fiche coach) ;
 *  - cadre autour d'un avatar rond : elements [data-cadre-coach="N"] ;
 *  - fond de fiche (neige / guirlandes) : elements [data-fiche-coach="N"].
 * N = id du coach. Les pages rendues dynamiquement sont suivies (MutationObserver).
 * Necessite cadeaux.js (dessins). Aucun effet si le coach n'a rien equipe.
 */
(function () {
    const C = window.TWMCadeaux;
    if (!C) return;
    const cache = new Map();
    const EMOJI = { 'emoji:boule': C.emojiBoule, 'emoji:raquette': C.emojiRaquette, 'emoji:etoile': C.emojiEtoile };
    const CADRE = { 'cadre:balle': 'balle', 'cadre:flocons': 'flocons', 'cadre:guirlande': 'dore' };
    const decoFiche = {};
    function svgFiche(code) {
        if (!decoFiche[code]) {
            const html = code === 'fiche:neige' ? C.ficheNeige() : C.ficheFestive();
            const m = html.match(/<svg[\s\S]*?<\/svg>/);
            decoFiche[code] = m ? m[0].replace('<svg ', '<svg class="fiche-deco-svg" ') : '';
        }
        return decoFiche[code];
    }
    const idDe = function (href) { const m = /coach\.html\?id=(\d+)/.exec(href || ''); return m ? Number(m[1]) : 0; };

    async function charger(ids) {
        const manquants = ids.filter(function (id) { return id && !cache.has(id); });
        if (!manquants.length) return;
        manquants.forEach(function (id) { cache.set(id, {}); });
        try {
            const r = await fetch('/api/cosmetiques/equipes?ids=' + manquants.join(','));
            if (!r.ok) return;
            const d = await r.json();
            manquants.forEach(function (id) { cache.set(id, (d.equipes || {})[id] || {}); });
        } catch (e) { /* reseau : rien d'affiche */ }
    }

    let enCours = false, encore = false;
    async function appliquer() {
        if (enCours) { encore = true; return; }
        enCours = true;
        try {
            const liens = Array.prototype.slice.call(document.querySelectorAll('a[href*="coach.html?id="]:not([data-emoji-fait])'));
            const emojis = Array.prototype.slice.call(document.querySelectorAll('[data-emoji-coach]:not([data-emoji-fait])'));
            const cadres = Array.prototype.slice.call(document.querySelectorAll('[data-cadre-coach]:not([data-cadre-fait])'));
            const fiches = Array.prototype.slice.call(document.querySelectorAll('[data-fiche-coach]:not([data-fiche-fait])'));
            if (!liens.length && !emojis.length && !cadres.length && !fiches.length) return;
            const ids = new Set();
            liens.forEach(function (a) { ids.add(idDe(a.getAttribute('href'))); });
            emojis.forEach(function (e) { ids.add(Number(e.dataset.emojiCoach)); });
            cadres.forEach(function (e) { ids.add(Number(e.dataset.cadreCoach)); });
            fiches.forEach(function (e) { ids.add(Number(e.dataset.ficheCoach)); });
            await charger(Array.from(ids));
            const poserEmoji = function (el, id) {
                el.setAttribute('data-emoji-fait', '1');
                const code = (cache.get(id) || {}).emoji;
                if (code && EMOJI[code] && !el.querySelector('.pseudo-emoji')) el.insertAdjacentHTML('beforeend', '<span class="pseudo-emoji" aria-hidden="true">' + EMOJI[code](18) + '</span>');
            };
            liens.forEach(function (a) { poserEmoji(a, idDe(a.getAttribute('href'))); });
            emojis.forEach(function (e) { poserEmoji(e, Number(e.dataset.emojiCoach)); });
            cadres.forEach(function (e) {
                e.setAttribute('data-cadre-fait', '1');
                const code = (cache.get(Number(e.dataset.cadreCoach)) || {}).cadre;
                if (code && CADRE[code]) {
                    e.classList.add('avec-cadre');
                    e.insertAdjacentHTML('beforeend', '<span class="cadre-avatar" aria-hidden="true">' + C.cadreSeul(CADRE[code], 150) + '</span>');
                }
            });
            fiches.forEach(function (e) {
                e.setAttribute('data-fiche-fait', '1');
                const code = (cache.get(Number(e.dataset.ficheCoach)) || {}).fiche;
                if (code === 'fiche:neige' || code === 'fiche:festive') {
                    e.classList.add('fiche-deco');
                    e.insertAdjacentHTML('afterbegin', svgFiche(code));
                }
            });
        } finally {
            enCours = false;
            if (encore) { encore = false; setTimeout(appliquer, 50); }
        }
    }

    let minuteur = null;
    const planifier = function () { clearTimeout(minuteur); minuteur = setTimeout(appliquer, 250); };
    function init() {
        appliquer();
        new MutationObserver(planifier).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.TWMCosmetiques = { rafraichir: function () { cache.clear(); document.querySelectorAll('[data-emoji-fait],[data-cadre-fait],[data-fiche-fait]').forEach(function (e) { e.removeAttribute('data-emoji-fait'); e.removeAttribute('data-cadre-fait'); e.removeAttribute('data-fiche-fait'); }); document.querySelectorAll('.pseudo-emoji,.cadre-avatar,.fiche-deco-svg').forEach(function (e) { e.remove(); }); appliquer(); } };
})();
