/*
 * Cloche de notifications (2026-11-24, comme sur l'appli mobile), a cote du nom du
 * jeu dans l'en-tete de toutes les pages connectees.
 * Inclure via <script src="cloche.js"></script> JUSTE APRES retour.js (elle se place
 * dans le bloc .dashboard-brand que retour.js cree autour du logo).
 *
 * Donnees : GET /api/notifications (calculees par le serveur). Le chiffre rouge
 * compte les notifications pas encore vues + celles qui restent tant que l'action
 * n'est pas faite (persistante : XP a placer, points de disposition). Les autres
 * (tirage, pronos) sont marquees vues a la fermeture du panneau (memorise dans ce
 * navigateur) : elles restent dans la liste, grisees, tant qu'elles sont d'actualite.
 */
(function () {
    var userId = null;
    try { userId = localStorage.getItem('currentUserId'); } catch (e) { userId = null; }
    if (!userId) return;

    var CLE_VUES = 'twm.notifications.vues.' + userId;
    // Notifications retirees par le coach via leur case a cocher (2026-11-24) : plus
    // affichees du tout. Jamais possible pour une notification persistante (XP).
    var CLE_RETIREES = 'twm.notifications.retirees.' + userId;
    var toutes = [];
    var notifications = [];
    var bouton, compteur, panneau;

    function lireVues() {
        try { return JSON.parse(localStorage.getItem(CLE_VUES) || '[]'); } catch (e) { return []; }
    }
    function ecrireVues(ids) {
        try { localStorage.setItem(CLE_VUES, JSON.stringify(ids.slice(-300))); } catch (e) { /* stockage indisponible */ }
    }
    function lireRetirees() {
        try { return JSON.parse(localStorage.getItem(CLE_RETIREES) || '[]'); } catch (e) { return []; }
    }
    function retirer(id) {
        var ids = lireRetirees().filter(function (x) { return x !== id; });
        ids.push(id);
        try { localStorage.setItem(CLE_RETIREES, JSON.stringify(ids.slice(-300))); } catch (e) { /* stockage indisponible */ }
    }
    function filtrer() {
        var retirees = lireRetirees();
        notifications = toutes.filter(function (n) { return n.persistante || retirees.indexOf(n.id) === -1; });
    }
    function echapper(t) {
        return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function estNonVue(n, vues) {
        return n.persistante || vues.indexOf(n.id) === -1;
    }

    function majCompteur() {
        var vues = lireVues();
        var nb = notifications.filter(function (n) { return estNonVue(n, vues); }).length;
        compteur.textContent = nb > 9 ? '9+' : String(nb);
        compteur.style.display = nb > 0 ? 'flex' : 'none';
        bouton.setAttribute('aria-label', nb > 0 ? nb + ' notification' + (nb > 1 ? 's' : '') : 'Notifications');
    }

    function rendrePanneau() {
        var vues = lireVues();
        if (notifications.length === 0) {
            panneau.innerHTML = '<div class="cloche-titre">Notifications</div><div class="cloche-vide">Aucune notification pour l\'instant.</div>';
            return;
        }
        panneau.innerHTML = '<div class="cloche-titre">Notifications</div>' + notifications.map(function (n) {
            var classes = 'cloche-item cloche-' + n.type + (estNonVue(n, vues) ? '' : ' cloche-vue');
            // Case a cocher "lu / fait" : retire la notification. Pas pour les
            // notifications persistantes (repartition des XP).
            var caseRetrait = n.persistante
                ? '<span class="cloche-case-vide" aria-hidden="true"></span>'
                : '<input type="checkbox" class="cloche-case" data-id="' + echapper(n.id) + '" title="Lu / fait : retirer la notification" aria-label="Retirer la notification">';
            return '<div class="' + classes + '">' + caseRetrait +
                '<a class="cloche-lien" href="' + echapper(n.lien) + '">' +
                '<span class="cloche-texte">' + echapper(n.texte) +
                (n.detail ? '<span class="cloche-detail">' + echapper(n.detail) + '</span>' : '') +
                '</span><span class="cloche-fleche" title="' + echapper(n.lienTexte || '') + '" aria-hidden="true">→</span></a></div>';
        }).join('');
    }

    function marquerVues() {
        var vues = lireVues();
        notifications.forEach(function (n) {
            if (!n.persistante && vues.indexOf(n.id) === -1) vues.push(n.id);
        });
        ecrireVues(vues);
        majCompteur();
    }

    function ouvrir() {
        rendrePanneau();
        panneau.classList.add('open');
        bouton.setAttribute('aria-expanded', 'true');
    }
    function fermer() {
        if (!panneau.classList.contains('open')) return;
        panneau.classList.remove('open');
        bouton.setAttribute('aria-expanded', 'false');
        marquerVues();
    }

    function charger() {
        fetch('/api/notifications')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                if (!d || !d.success) return;
                toutes = d.notifications || [];
                filtrer();
                majCompteur();
                if (panneau.classList.contains('open')) rendrePanneau();
            })
            .catch(function () { /* reseau indisponible : on garde l'affichage */ });
    }

    function init() {
        if (document.querySelector('.cloche-bouton')) return;
        var logo = document.querySelector('.dashboard-header .auth-logo');
        if (!logo || !logo.parentNode) return;

        var ligne = document.createElement('div');
        ligne.className = 'cloche-ligne';
        logo.parentNode.insertBefore(ligne, logo);
        ligne.appendChild(logo);

        var zone = document.createElement('div');
        zone.className = 'cloche-zone';
        zone.innerHTML =
            '<button type="button" class="cloche-bouton" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z"/></svg>' +
            '<span class="cloche-compteur" style="display:none;">0</span></button>' +
            '<div class="cloche-panneau" role="menu"></div>';
        ligne.appendChild(zone);

        bouton = zone.querySelector('.cloche-bouton');
        compteur = zone.querySelector('.cloche-compteur');
        panneau = zone.querySelector('.cloche-panneau');

        bouton.addEventListener('click', function (e) {
            e.stopPropagation();
            if (panneau.classList.contains('open')) fermer(); else ouvrir();
        });
        panneau.addEventListener('click', function (e) {
            e.stopPropagation();
            var caseCochee = e.target.closest('.cloche-case');
            if (caseCochee) {
                retirer(caseCochee.getAttribute('data-id'));
                filtrer();
                majCompteur();
                rendrePanneau();
                return;
            }
            if (e.target.closest('.cloche-lien')) marquerVues();
        });
        document.addEventListener('click', fermer);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fermer(); });

        charger();
        setInterval(function () { if (!document.hidden) charger(); }, 120000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) charger(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
