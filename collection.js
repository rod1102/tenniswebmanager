/*
 * Collection TWM (2026-11-26) : dessin des cartes a partir des donnees du jeu
 * (/api/collection, /api/avent/ouvrir), ouverture animee d'une pochette et album.
 * Repris de l'artifact "Collection TWM" valide par l'utilisateur.
 * Necessite collection.css. Expose window.TWMCollection.
 */
(function () {
    let uid = 0;
    const nid = function (p) { return p + (++uid); };
    function rng(seed) { let s = seed; return function () { return (s = (s * 16807) % 2147483647) / 2147483647; }; }
    const esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

    const SURF = { dur: ['#1F5C94', '#0E3360'], terre: ['#B9521F', '#7A3010'], gazon: ['#2E7A4A', '#154A2A'] };
    const SURF_NOM = { dur: 'Dur', terre: 'Terre battue', gazon: 'Gazon' };
    const SURF_VIF = { dur: '#5FA8E8', terre: '#E08A4B', gazon: '#5CC57F' };
    const RLABEL = { commune: 'COMMUNE', rare: 'RARE', epique: 'ÉPIQUE', legendaire: 'LÉGENDAIRE' };
    const RNOM = { commune: 'Commune', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire' };
    const ORDRE = ['commune', 'rare', 'epique', 'legendaire'];
    const GLOW = { commune: '#A9B2BB', rare: '#E2CF8A', epique: '#A76BF0', legendaire: '#F0B8FF' };
    const CAT = { slam: 'Grand Chelem', '1000': '1000', '500': '500', '250': '250', finals: 'Masters' };
    const serial = function (n, tot) { return String(n).padStart(String(tot).length, '0') + '/' + tot; };
    const drapeauImg = function (code, large) { return code ? '<img src="https://flagcdn.com/' + (large ? 'w320' : 'w40') + '/' + esc(code) + '.png" alt="">' : ''; };
    const surfaceDe = function (s) { return SURF[s] ? s : 'dur'; };

    function art(surface) {
        const s = SURF[surfaceDe(surface)], g = nid('g'), cl = nid('c');
        return '<svg viewBox="0 0 150 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
            '<defs><linearGradient id="' + g + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + s[0] + '"/><stop offset="1" stop-color="' + s[1] + '"/></linearGradient><clipPath id="' + cl + '"><rect width="150" height="120"/></clipPath></defs>' +
            '<rect width="150" height="120" fill="url(#' + g + ')"/>' +
            '<g clip-path="url(#' + cl + ')" stroke="#fff" stroke-opacity=".22" stroke-width="1.4" fill="none"><polygon points="38,30 112,30 150,125 0,125"/><line x1="75" y1="30" x2="75" y2="125"/><polygon points="47,52 103,52 116,88 34,88"/><line x1="20" y1="72" x2="130" y2="72" stroke-opacity=".5" stroke-width="2.4"/></g>' +
            '<circle cx="75" cy="58" r="17" fill="#E8EDF2"/><path d="M40 125 C42 92 58 80 75 80 C92 80 108 92 110 125Z" fill="#E8EDF2"/>' +
            '<path d="M58 86 L75 102 L92 86" stroke="' + s[1] + '" stroke-width="3" fill="none" opacity=".5"/></svg>';
    }
    function artMoment(surface) {
        const s = SURF[surfaceDe(surface)], g = nid('g'), t = nid('t'), h = nid('h');
        let rayons = '';
        for (let i = 0; i < 12; i++) rayons += '<line x1="75" y1="52" x2="' + (75 + Math.cos(i * Math.PI / 6) * 120) + '" y2="' + (52 + Math.sin(i * Math.PI / 6) * 120) + '" stroke="#fff" stroke-opacity=".07" stroke-width="10"/>';
        return '<svg viewBox="0 0 150 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
            '<defs><radialGradient id="' + g + '" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="' + s[0] + '"/><stop offset="1" stop-color="' + s[1] + '"/></radialGradient>' +
            '<linearGradient id="' + t + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#A9861A"/><stop offset=".45" stop-color="#FBE9A0"/><stop offset="1" stop-color="#9C7A14"/></linearGradient>' +
            '<radialGradient id="' + h + '" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF3B0" stop-opacity=".55"/><stop offset="1" stop-color="#FFF3B0" stop-opacity="0"/></radialGradient></defs>' +
            '<rect width="150" height="120" fill="url(#' + g + ')"/>' + rayons +
            '<circle cx="75" cy="52" r="46" fill="url(#' + h + ')"/>' +
            '<path d="M55 22 H95 V30 Q95 62 75 68 Q55 62 55 30Z" fill="url(#' + t + ')"/>' +
            '<path d="M55 30 Q40 30 42 42 Q44 52 57 52" stroke="url(#' + t + ')" stroke-width="4" fill="none"/><path d="M95 30 Q110 30 108 42 Q106 52 93 52" stroke="url(#' + t + ')" stroke-width="4" fill="none"/>' +
            '<rect x="71" y="67" width="8" height="14" fill="url(#' + t + ')"/><rect x="60" y="80" width="30" height="7" rx="1.5" fill="url(#' + t + ')"/><rect x="56" y="87" width="38" height="8" rx="1.5" fill="#3B2A08"/>' +
            '<ellipse cx="66" cy="34" rx="3" ry="9" fill="#fff" opacity=".35"/></svg>';
    }
    const GEMMES = { commune: ['#E3A86E', '#6E4122'], rare: ['#EFE2A8', '#6B5E2E'], epique: ['#E2C8FF', '#5A2496'], legendaire: ['#FFFFFF', '#C58BFF'] };
    function gemme(r) {
        const c = GEMMES[r], g = nid('gm');
        return '<svg class="gemme" viewBox="0 0 20 20" aria-hidden="true"><defs><linearGradient id="' + g + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs><path d="M10 1 L18 7 L15 18 L5 18 L2 7Z" fill="url(#' + g + ')" stroke="rgba(0,0,0,.35)" stroke-width=".8"/><path d="M10 1 L10 18 M2 7 L18 7" stroke="rgba(255,255,255,.45)" stroke-width=".6"/></svg>';
    }
    function codeBarres(seed) {
        const r = rng(seed); let x = 0, s = '';
        while (x < 58) { const w = r() < 0.35 ? 1.6 : 0.7; s += '<rect x="' + x.toFixed(1) + '" width="' + w + '" height="18"/>'; x += w + 0.6 + r() * 1.2; }
        return '<svg viewBox="0 0 60 18" preserveAspectRatio="none" aria-hidden="true"><g fill="currentColor">' + s + '</g></svg>';
    }

    function faceJoueur(c) {
        const j = c.joueur || {};
        const det = j.detailTitres || [0, 0, 0, 0];
        const ini = ((j.prenom || ' ')[0] + (j.nom || ' ')[0]).toUpperCase();
        return '<div class="cadre"><div class="face">' +
            '<div class="entete"><span class="chip">' + esc(j.circuit) + '</span><span class="serial">N° ' + serial(c.numero, c.total) + '</span>' + gemme(c.rarete) + '</div>' +
            '<div class="art">' + (j.photo ? '<img src="' + esc(j.photo) + '" alt=""><span class="voile"></span>' : art(j.surface) + '<span class="mono">' + esc(ini) + '</span>') + '</div>' +
            '<div class="ident"><div class="prenom">' + esc(j.prenom) + '</div><div class="nom">' + esc(j.nom) + '</div><div class="pays">' + drapeauImg(j.drapeau) + esc(j.nationalite) + '</div></div>' +
            '<div><div class="stats"><div class="stat"><b>' + (j.meilleurRang || '—') + '</b><span>Meilleur rang</span></div><div class="stat"><b>' + (j.titres || 0) + '</b><span>Titres</span></div>' +
            '<div class="detail-titres">' + [['250', 0], ['500', 1], ['1000', 2], ['GC', 3]].map(function (x) { return '<span><i>' + x[0] + '</i><em>' + det[x[1]] + '</em></span>'; }).join('') + '</div></div>' +
            '<div class="pied"><span class="pied-logo"><img src="logo-w.png" alt="">COLLECTION</span><span class="rar">' + RLABEL[c.rarete] + '</span></div></div>' +
            '</div></div>';
    }
    function faceMoment(c) {
        const j = c.joueur || {}, t = c.tournoi || {};
        const surf = surfaceDe(t.surface);
        const score = String(t.score || '').trim();
        return '<div class="cadre"><div class="face">' +
            '<div class="t-bande" style="--surf:' + SURF[surf][0] + '">' +
            '<div class="t-ligne"><span>' + esc((CAT[t.categorie] || t.categorie || '').toUpperCase()) + ' · ' + esc(t.circuit) + '</span><span>★ FINALE ★</span><span>ENTRÉE</span></div>' +
            '<div class="t-nom">' + esc(t.nom) + '</div>' +
            '<div class="t-ligne t-bas"><span>' + esc(SURF_NOM[surf].toUpperCase()) + '</span></div></div>' +
            '<div class="t-photo">' + (j.photo ? '<img src="' + esc(j.photo) + '" alt="">' : artMoment(surf)) + '<span class="t-tampon">VAINQUEUR</span></div>' +
            '<div class="t-match"><div class="t-joueur"><small>' + esc(j.prenom) + '</small> ' + esc(j.nom) + '</div>' +
            '<div class="t-contre">' + (t.adversaire ? 'bat ' + esc(t.adversaire) : 'Vainqueur du tournoi') + '</div>' +
            (score ? '<div class="t-score">' + score.split(/\s+/).map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('') + '</div>' : '') + '</div>' +
            '<div class="t-perfo"></div>' +
            '<div class="t-souche"><div class="t-infos"><span>' + esc(SURF_NOM[surf].toUpperCase()) + '</span><span>SAISON ' + esc(t.saison) + ' · SEM. ' + esc(t.semaine || '—') + '</span><span>N° ' + serial(c.numero, c.total) + '</span></div>' +
            '<div class="t-code">' + codeBarres((t.absSemaine || 1) * 31 + c.numero) + '<span class="t-rar">' + RLABEL[c.rarete] + '</span></div></div>' +
            '</div></div>';
    }
    function dos() {
        const g = nid('d');
        return '<div class="dos"><svg viewBox="0 0 150 210" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs><pattern id="' + g + '" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 15 H30 M15 0 V30" stroke="#16304F" stroke-width="1.2"/></pattern></defs>' +
            '<rect width="150" height="210" fill="#0A1628"/><rect width="150" height="210" fill="url(#' + g + ')"/>' +
            '<image href="logo-twm.png" x="20" y="62" width="110" height="64"/>' +
            '<text x="75" y="150" text-anchor="middle" font-family="Big Shoulders Display, Impact, sans-serif" font-weight="900" font-size="15" letter-spacing="3" fill="#fff">COLLECTION</text></svg></div>';
    }
    const estMoment = function (c) { return c.famille === 'moment'; };
    const nomDe = function (c) { return estMoment(c) ? 'Moment ' + (c.tournoi ? c.tournoi.nom : '') : ((c.joueur || {}).prenom + ' ' + (c.joueur || {}).nom); };
    function carte(c, fs, cls) {
        return '<div class="carte ' + (cls || '') + ' ' + (estMoment(c) ? 'moment' : '') + ' r-' + c.rarete + '"' + (fs ? ' style="--fs:' + fs + 'px"' : '') +
            ' role="img" aria-label="Carte ' + esc(nomDe(c)) + ', ' + RNOM[c.rarete].toLowerCase() + '">' + (estMoment(c) ? faceMoment(c) : faceJoueur(c)) + '</div>';
    }
    function carteFlip(c, fs) {
        return '<button type="button" class="flip" style="--fs:' + fs + 'px" aria-label="Retourner la carte ' + esc(nomDe(c)) + '"><div class="tourne">' + carte(c, fs) + dos() + '</div></button>';
    }
    document.addEventListener('click', function (e) {
        const f = e.target.closest && e.target.closest('.flip');
        if (f) f.classList.toggle('retournee');
    });

    /* ---------- Ouverture animee (plein ecran) ---------- */
    const reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function zigzag(dents, haut) {
        const pts = [];
        for (let i = 0; i <= dents * 2; i++) pts.push((i / (dents * 2) * 100).toFixed(2) + '% ' + ((i % 2 === 0) === haut ? '100%' : 'calc(100% - 12px)'));
        return pts;
    }
    function htmlPochette(taille, legende) {
        const bas = zigzag(9, true), haut = zigzag(9, false).map(function (p) { return p.replace('calc(100% - 12px)', '12px').replace('100%', '0'); });
        return '<div class="pk" id="pk">' +
            '<div class="pk-part pk-corps" style="clip-path: polygon(' + haut.join(',') + ', 100% 100%, 0 100%)"><span class="pk-dent"></span><img src="logo-twm.png" alt="" class="pk-logo"><div class="pk-titre">Collection</div><div class="pk-sous">' + taille + ' CARTES' + (legende ? ' + 1 LÉGENDAIRE' : '') + '</div></div>' +
            '<div class="pk-lueur"></div>' +
            '<div class="pk-part pk-haut" style="clip-path: polygon(0 0, 100% 0, ' + bas.slice().reverse().join(',') + ')"></div></div>' +
            '<div class="lab pk-aide">Touche la pochette pour l\'ouvrir</div>';
    }

    // Ouvre une pochette deja tiree par le serveur : dechirure, puis revelation
    // des cartes (communes d'abord, la plus rare en dernier). Resout a la fin.
    function ouvrirPochette(cartes, opts) {
        opts = opts || {};
        return new Promise(function (fini) {
            const scene = document.createElement('div');
            scene.className = 'revelation';
            scene.innerHTML = '<div class="rayons"></div><div class="flash"></div><div class="etape" aria-live="assertive"></div>' +
                '<div class="rev-actions"><button class="btn sec" type="button" data-passer>Passer</button><button class="btn" type="button" data-suite hidden>Continuer</button></div>';
            document.body.appendChild(scene);
            const etape = scene.querySelector('.etape'), flash = scene.querySelector('.flash');
            const btnPasser = scene.querySelector('[data-passer]'), btnSuite = scene.querySelector('[data-suite]');
            let passer = false;
            btnPasser.addEventListener('click', function () { passer = true; });
            const attendre = function (ms) {
                return new Promise(function (r) {
                    if (passer || reduit) return r();
                    const t = setTimeout(r, ms);
                    btnPasser.addEventListener('click', function () { clearTimeout(t); r(); }, { once: true });
                });
            };
            const clic = function (el) { return new Promise(function (r) { el.addEventListener('click', r, { once: true }); }); };
            const montrer = function (html) { etape.innerHTML = html; };
            const indice = function (lab, gros, style) {
                montrer('<div class="lab">' + esc(lab) + '</div><div class="gros slam' + (gros.length > 6 ? ' long' : '') + (gros.length > 14 ? ' tres-long' : '') + '" style="' + (style || '') + '">' + esc(gros) + '</div>');
            };
            async function deroule() {
                scene.style.setProperty('--glow', '#D4F000');
                btnPasser.hidden = true;
                const legende = cartes.some(function (c) { return c.rarete === 'legendaire' && c.famille === 'joueur'; });
                montrer(htmlPochette(opts.taille || cartes.length, legende));
                const pk = document.getElementById('pk');
                if (!reduit) await clic(pk);
                pk.classList.add('secoue'); await attendre(900);
                pk.classList.add('ouvert'); await attendre(1100);
                pk.classList.add('vide'); await attendre(900);
                const ordre = cartes.slice().sort(function (a, b) { return ORDRE.indexOf(a.rarete) - ORDRE.indexOf(b.rarete); });
                for (let i = 0; i < ordre.length; i++) {
                    const c = ordre[i];
                    passer = false;
                    btnSuite.textContent = i === ordre.length - 1 ? 'Terminer' : 'Continuer (' + (i + 1) + '/' + ordre.length + ')';
                    scene.style.setProperty('--glow', GLOW[c.rarete]);
                    scene.classList.toggle('legende', c.rarete === 'legendaire');
                    btnSuite.hidden = true; btnPasser.hidden = c.rarete === 'commune';
                    if (c.rarete !== 'commune') {
                        montrer('<div class="orbe"></div>');
                        await attendre(c.rarete === 'legendaire' ? 2600 : 1800);
                        if (estMoment(c) && c.tournoi) {
                            indice('Moment · circuit', c.tournoi.circuit || ''); await attendre(2400);
                            indice('Surface', SURF_NOM[surfaceDe(c.tournoi.surface)], 'color:' + SURF_VIF[surfaceDe(c.tournoi.surface)]); await attendre(2400);
                            indice('Catégorie', CAT[c.tournoi.categorie] || String(c.tournoi.categorie)); await attendre(2400);
                            indice('Tournoi', c.tournoi.nom); await attendre(2700);
                        } else {
                            const j = c.joueur || {};
                            indice('Circuit', j.circuit || ''); await attendre(2400);
                            montrer('<div class="lab">Nationalité</div><div class="drap vague">' + drapeauImg(j.drapeau, true) + '</div><div class="nation slam" style="animation-delay:.35s">' + esc(j.nationalite) + '</div>');
                            await attendre(2700);
                        }
                        flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
                    }
                    const fs = window.innerWidth < 500 ? 15 : 19;
                    montrer('<div class="' + (c.rarete === 'commune' ? 'carte-simple' : 'carte-in') + '">' + carte(c, fs) + '</div><div class="bandeau-rar">' + RLABEL[c.rarete] + ' · N° ' + serial(c.numero, c.total) + '</div>');
                    btnPasser.hidden = true;
                    await new Promise(function (r) { setTimeout(r, reduit ? 0 : 700); });
                    btnSuite.hidden = false; btnSuite.focus();
                    await clic(btnSuite);
                }
                scene.remove();
                fini();
            }
            deroule().catch(function () { scene.remove(); fini(); });
        });
    }

    /* ---------- Album ---------- */
    // Une page par joueur (4 raretes) ou par Moment (3 raretes) present dans mes cartes.
    function rendreAlbum(conteneur, data, onglet) {
        const pages = new Map();
        (data.cartes || []).forEach(function (c) {
            const cle = c.famille + ':' + (c.joueur ? c.joueur.playerId : 0) + ':' + (c.tournoi ? c.tournoi.id : 0);
            if (!pages.has(cle)) pages.set(cle, { cle: cle, base: c, possede: {} });
            const p = pages.get(cle);
            (p.possede[c.rarete] = p.possede[c.rarete] || []).push(c);
        });
        const liste = Array.from(pages.values()).filter(function (p) { return (p.base.famille === 'moment') === (onglet === 'moments'); });
        if (liste.length === 0) {
            conteneur.innerHTML = '<p class="match-hint">' + (onglet === 'moments' ? 'Aucune carte Moment pour l\'instant.' : 'Aucune carte joueur pour l\'instant.') + '</p>';
            return;
        }
        liste.sort(function (a, b) { return nomDe(a.base).localeCompare(nomDe(b.base)); });
        const tirage = onglet === 'moments' ? data.tirages.moment : data.tirages.joueur;
        conteneur.innerHTML = liste.map(function (p) {
            const b = p.base, j = b.joueur || {}, t = b.tournoi;
            const titre = t ? t.nom : (j.prenom + ' ' + j.nom);
            const sous = t ? ((CAT[t.categorie] || t.categorie) + ' · ' + j.prenom + ' ' + j.nom + ' · S' + t.saison + ' sem. ' + (t.semaine || '—')) : (j.circuit + ' · ' + (j.nationalite || ''));
            const rest = (data.restants || {})[p.cle] || {};
            return '<div class="page-joueur"><div class="qui"><b>' + esc(titre) + '</b><span>' + esc(sous) + '</span></div><div class="slots">' +
                Object.keys(tirage).map(function (r) {
                    const own = p.possede[r];
                    const n = rest[r] || 0;
                    const lib = '<span style="color:var(--r-' + r + ')">' + RNOM[r] + '</span><span>' + n + ' restant' + (n > 1 ? 's' : '') + '</span>';
                    if (!own) return '<div class="slot"><div class="case-vide"><div><b>?</b>' + RNOM[r] + '<br>/' + tirage[r] + '</div></div>' + lib + '</div>';
                    return '<div class="slot"><div class="' + (own.length > 1 ? 'double' : '') + '" data-n="×' + own.length + '">' + carteFlip(own[0], 7) + '</div>' + lib + '</div>';
                }).join('') + '</div></div>';
        }).join('');
    }

    window.TWMCollection = { carte: carte, carteFlip: carteFlip, ouvrirPochette: ouvrirPochette, rendreAlbum: rendreAlbum, RNOM: RNOM };
})();
