// Confettis plein page, sans dependance (canvas) - lances par le Live d'un match quand la
// ligne "<joueur> remporte <tournoi>" apparait (matchs.html, tournoi-detail.html).
// Demande explicite de l'utilisateur, 2026-09-26. Fichier partage (comme retour.js et
// theme-saison.js) pour ne pas dupliquer l'animation dans chaque page.
(function () {
    var enCours = false;

    window.lancerConfettis = function (dureeMs) {
        if (enCours) return;
        // Respecte le reglage systeme "reduire les animations".
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        enCours = true;
        dureeMs = dureeMs || 5000;

        var canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed; inset:0; width:100%; height:100%; pointer-events:none; z-index:9999;';
        document.body.appendChild(canvas);
        var ctx = canvas.getContext('2d');

        function redimensionner() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        redimensionner();
        window.addEventListener('resize', redimensionner);

        var couleurs = ['#D4F000', '#F5F7FA', '#E24B4A', '#5CC57F', '#4FA3E0', '#F5B942'];
        var particules = [];

        function creerParticule() {
            return {
                x: Math.random() * canvas.width,
                y: -10 - Math.random() * canvas.height * 0.3,
                vx: (Math.random() - 0.5) * 3,
                vy: 2 + Math.random() * 4,
                taille: 6 + Math.random() * 6,
                angle: Math.random() * Math.PI * 2,
                vAngle: (Math.random() - 0.5) * 0.3,
                couleur: couleurs[Math.floor(Math.random() * couleurs.length)]
            };
        }

        var debut = performance.now();
        // On ne genere plus de nouvelles particules sur la derniere seconde, pour que
        // l'ecran soit propre a 5 secondes pile.
        var finGeneration = dureeMs - 1000;

        function image(maintenant) {
            var ecoule = maintenant - debut;
            if (ecoule >= dureeMs) {
                window.removeEventListener('resize', redimensionner);
                canvas.remove();
                enCours = false;
                return;
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (ecoule < finGeneration) {
                for (var n = 0; n < 4; n++) particules.push(creerParticule());
            }

            var opacite = ecoule > dureeMs - 800 ? Math.max(0, (dureeMs - ecoule) / 800) : 1;
            ctx.globalAlpha = opacite;
            particules.forEach(function (p) {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.03;
                p.angle += p.vAngle;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.fillStyle = p.couleur;
                ctx.fillRect(-p.taille / 2, -p.taille / 4, p.taille, p.taille / 2);
                ctx.restore();
            });
            particules = particules.filter(function (p) { return p.y < canvas.height + 20; });

            requestAnimationFrame(image);
        }
        requestAnimationFrame(image);
    };
})();
