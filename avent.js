/*
 * Calendrier de l'Avent sur l'accueil (2026-11-26) : bandeau, fenetre a la 1re
 * visite du jour (ou via la cloche, accueil.html?avent=1), porte en papier cadeau.
 * Papiers repris de l'artifact "Calendrier de l'Avent au quotidien". Necessite
 * cadeaux.js, collection.js, collection.css. Case ouvrable de 10h a 10h le lendemain.
 */
(function () {
let uid = 0;
const nid = function (p) { return p + (++uid); };
function raquette(x, y, rot, cadre, corde, manche, s = 1, filet = null) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <ellipse cx="0" cy="-10" rx="9" ry="12" fill="${corde}" stroke="${cadre}" stroke-width="2.4"/>
    <path d="M-5 -18 V-2 M0 -21 V1 M5 -18 V-2 M-8 -14 H8 M-9 -9 H9 M-8 -4 H8" stroke="${filet || cadre}" stroke-width=".6" opacity=".6"/>
    <path d="M-3 1.5 L0 6 L3 1.5" stroke="${cadre}" stroke-width="2" fill="none"/>
    <rect x="-1.9" y="6" width="3.8" height="15" rx="1.5" fill="${manche}"/>
  </g>`;
}
const balleP = (x, y, r, c, couture = "#fff", op = .9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><path d="M${x - r * .75} ${y - r * .6} q${r * .5} ${r * .6} 0 ${r * 1.2} M${x + r * .75} ${y - r * .6} q${-r * .5} ${r * .6} 0 ${r * 1.2}" stroke="${couture}" stroke-width="${(r * .16).toFixed(2)}" fill="none" opacity="${op}"/>`;
const etincelle = (x, y, c = "#fff") => `<path d="M${x} ${y - 3.5} V${y + 3.5} M${x - 3.5} ${y} H${x + 3.5} M${x - 2.2} ${y - 2.2} L${x + 2.2} ${y + 2.2} M${x + 2.2} ${y - 2.2} L${x - 2.2} ${y + 2.2}" stroke="${c}" stroke-width=".8" opacity=".85"/>`;
const etoile = (x, y, r, c) => `<polygon points="${Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; return (x + Math.cos(a) * rr).toFixed(1) + "," + (y + Math.sin(a) * rr).toFixed(1); }).join(" ")}" fill="${c}"/>`;
const icone = (x, y, c, b) => `<g transform="translate(${x} ${y}) rotate(-35)"><ellipse cx="0" cy="-5" rx="4.2" ry="5.4" fill="none" stroke="${c}" stroke-width="1.4"/><rect x="-.8" y=".5" width="1.6" height="7" fill="${c}"/><circle cx="0" cy="-5" r="2" fill="${b}"/></g>`;
const feuille = (x, y, rot, c) => `<g transform="translate(${x} ${y}) rotate(${rot})" fill="${c}">${[-40, -20, 0, 20, 40].map(a => `<ellipse cx="0" cy="-9" rx="2.6" ry="8" transform="rotate(${a})"/>`).join("")}</g>`;

const PAPIERS = {
  emeraude: { nom: "Émeraude", fond: "#1E8C72", ruban: ["#F4A9C8", "#D9789F"], tuile: () => raquette(28, 34, 35, "#F08AD0", "#17705B", "#F08AD0") + raquette(92, 92, -32, "#4FD6B8", "#17705B", "#4FD6B8") + balleP(88, 26, 6, "#E6F25C") + balleP(26, 98, 6, "#E6F25C") + balleP(60, 62, 6, "#E6F25C") + etincelle(58, 14) + etincelle(112, 54) + etincelle(10, 68) + etincelle(60, 112) },
  vichy: { nom: "Vichy bleu", fond: "#FFFFFF", vichy: "#9CC7E6", ruban: ["#C9E0F0", "#94BAD6"], tuile: () => raquette(30, 36, 50, "#3FB3C0", "rgba(255,255,255,.6)", "#4A3426") + raquette(94, 92, -40, "#3FB3C0", "rgba(255,255,255,.6)", "#4A3426") + balleP(90, 28, 6, "#D2E33A", "#fff", .7) + balleP(26, 100, 6, "#D2E33A", "#fff", .7) + etoile(62, 64, 6, "#F5D90A") + etoile(112, 10, 4.5, "#F5D90A") },
  terre: { nom: "Terre battue", fond: "#D0532A", ruban: ["#3A3A3A", "#121212"], tuile: () => icone(20, 22, "#2B1A10", "#E6F25C") + icone(80, 22, "#2B1A10", "#E6F25C") + icone(50, 62, "#2B1A10", "#E6F25C") + icone(110, 62, "#2B1A10", "#E6F25C") + icone(20, 102, "#2B1A10", "#E6F25C") + icone(80, 102, "#2B1A10", "#E6F25C") },
  balles: { nom: "Balles", fond: "#FAFAF6", ruban: ["#8A9C87", "#5F705C"], tuile: () => balleP(28, 30, 10, "#D8EC2A", "#3A2A10", .8) + balleP(92, 46, 9, "#CBE33A", "#3A2A10", .8) + balleP(58, 96, 10, "#DFF23A", "#3A2A10", .8) + balleP(112, 104, 7, "#D2E63A", "#3A2A10", .8) },
  sauge: { nom: "Sauge", fond: "#B3C29A", ruban: ["#F3EEDF", "#D2C8AC"], tuile: () => raquette(32, 38, 30, "#2E8B3E", "rgba(240,245,230,.75)", "#3A3F44", 1.1, "#7FA67F") + raquette(94, 96, -50, "#2E8B3E", "rgba(240,245,230,.75)", "#3A3F44", 1.1, "#7FA67F") + balleP(96, 26, 7, "#E6F32D") + balleP(26, 104, 7, "#E6F32D") },
  dur: { nom: "Dur bleu", fond: "#3D6FA8", ruban: ["#F6DCE4", "#D9B3C0"], tuile: () => icone(20, 22, "#0F2238", "#E6F25C") + icone(80, 22, "#0F2238", "#E6F25C") + icone(50, 62, "#0F2238", "#E6F25C") + icone(110, 62, "#0F2238", "#E6F25C") + icone(20, 102, "#0F2238", "#E6F25C") + icone(80, 102, "#0F2238", "#E6F25C") },
  citron: { nom: "Citron", fond: "#8CC63F", ruban: ["#C9A46A", "#9E7C45"], tuile: () => raquette(28, 34, 35, "#F4FBE8", "#79B032", "#F4FBE8") + raquette(92, 92, -32, "#F4FBE8", "#79B032", "#F4FBE8") + balleP(88, 26, 5, "#FFFFFF") + balleP(26, 98, 5, "#FFFFFF") + balleP(60, 62, 5, "#FFFFFF") },
  noirblanc: { nom: "Noir et blanc", fond: "#FFFFFF", ruban: ["#5E5E5E", "#2E2E2E"], tuile: () => [[30, 34], [90, 94]].map(([x, y]) => raquette(x - 6, y, -25, "#2A2A2A", "#E6E6E6", "#2A2A2A", .9) + raquette(x + 6, y, 25, "#2A2A2A", "#E6E6E6", "#2A2A2A", .9) + `<circle cx="${x + 8}" cy="${y - 26}" r="3" fill="#2A2A2A"/>`).join("") },
  gazon: { nom: "Gazon", fond: "#5FA845", ruban: ["#FFFFFF", "#D8DDE0"], tuile: () => icone(20, 22, "#173A12", "#E6F25C") + icone(80, 22, "#173A12", "#E6F25C") + icone(50, 62, "#173A12", "#E6F25C") + icone(110, 62, "#173A12", "#E6F25C") + icone(20, 102, "#173A12", "#E6F25C") + icone(80, 102, "#173A12", "#E6F25C") },
  jouy: { nom: "Botanique", fond: "#EFE9D6", ruban: ["#3A5545", "#1C2E24"], tuile: () => feuille(60, 40, 10, "rgba(120,145,132,.45)") + feuille(16, 96, -30, "rgba(120,145,132,.45)") + feuille(104, 108, 40, "rgba(120,145,132,.45)") + raquette(26, 40, 25, "#2F4A3A", "rgba(239,233,214,.6)", "#2F4A3A", 1.05) + raquette(88, 84, -28, "#2F4A3A", "rgba(239,233,214,.6)", "#2F4A3A", 1.05) + balleP(96, 22, 5, "#E7E1C6", "#8A8468", .9) },
  or: { nom: "Or (24 et 25)", fond: "#C9A23A", ruban: ["#C23A39", "#8E2524"], tuile: () => raquette(28, 34, 35, "#FFF3C4", "#B08A26", "#FFF3C4") + raquette(92, 92, -32, "#8C6D12", "#B08A26", "#8C6D12") + balleP(88, 26, 6, "#FFFFFF") + balleP(26, 98, 6, "#FFFFFF") + etincelle(58, 14) + etincelle(112, 54) },
};
// Un papier différent chaque jour (l'or reste pour le 24 et le 25)
const ORDRE_PAPIERS = ["emeraude", "vichy", "terre", "balles", "sauge", "dur", "citron", "noirblanc", "gazon", "jouy"];
const papierDuJour = j => (j >= 24 ? "or" : ORDRE_PAPIERS[(j - 1) % ORDRE_PAPIERS.length]);
function paquet(numero, nom) {
  const p = PAPIERS[nom], id = nid("pap"), [rc, ro] = p.ruban;
  const vichy = p.vichy ? `<pattern id="${id}v" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="10" height="20" fill="${p.vichy}" opacity=".45"/><rect width="20" height="10" fill="${p.vichy}" opacity=".45"/></pattern>` : "";
  const deg = (dir) => `<linearGradient id="${id}${dir}" x1="0" y1="0" x2="${dir === "r" ? 1 : 0}" y2="${dir === "r" ? 0 : 1}"><stop offset="0" stop-color="${ro}"/><stop offset=".45" stop-color="${rc}"/><stop offset=".55" stop-color="#FFFFFF" stop-opacity=".5"/><stop offset=".65" stop-color="${rc}"/><stop offset="1" stop-color="${ro}"/></linearGradient>`;
  return `<svg class="papier" viewBox="0 0 240 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><pattern id="${id}" width="120" height="120" patternUnits="userSpaceOnUse">${p.tuile()}</pattern>${vichy}${deg("r")}${deg("h")}</defs>
      <rect width="240" height="300" fill="${p.fond}"/>${p.vichy ? `<rect width="240" height="300" fill="url(#${id}v)"/>` : ""}<rect width="240" height="300" fill="url(#${id})"/>
      <rect x="60" y="0" width="22" height="300" fill="url(#${id}r)"/>
      <rect x="0" y="80" width="240" height="22" fill="url(#${id}h)"/>
      <path d="M71 91 C52 62 24 66 30 84 C35 100 58 98 71 91 Z" fill="${rc}" stroke="${ro}" stroke-width="1.5"/>
      <path d="M71 91 C90 62 118 66 112 84 C107 100 84 98 71 91 Z" fill="${rc}" stroke="${ro}" stroke-width="1.5"/>
      <path d="M71 91 L56 128 L64 124 L67 132 Z M71 91 L88 126 L80 123 L78 131 Z" fill="${ro}"/>
      <circle cx="71" cy="91" r="7" fill="${rc}" stroke="${ro}" stroke-width="1.5"/>
      <path d="M74 95 Q132 112 172 148" stroke="#B9AE93" stroke-width="1.4" fill="none"/>
    </svg>
    <span class="etiquette"><span class="trou"></span><span class="et-num">${numero}</span><span class="et-mois">décembre</span></span>`;
}

/* ---------- Calendrier de l'Avent branche sur le serveur (/api/avent) ---------- */
const COUL_FAM = { pochette: '#E08A4B', cadre: '#D4AF37', fond: '#5CC57F', emoji: '#FF8FB3', teaser: '#9B6FE0', fiche: '#5FA8E8', badge: '#D4F000', appli: '#D4F000' };
const FAM_NOM = { pochette: 'Pochette de cartes', cadre: "Cadre d'avatar", fond: "Fond d'écran", emoji: 'Emoji du pseudo', teaser: 'Teaser mystère', fiche: 'Fond de fiche', badge: 'Badge', appli: 'La surprise' };
const C = window.TWMCadeaux, COL = window.TWMCollection;
const escA = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
const noeud = function (c) { return '<svg class="noeud" viewBox="0 0 64 34" aria-hidden="true"><path d="M32 17 C20 2 6 4 8 14 C10 24 24 22 32 17 Z M32 17 C44 2 58 4 56 14 C54 24 40 22 32 17 Z" fill="' + c + '"/><circle cx="32" cy="17" r="5" fill="' + c + '" stroke="rgba(0,0,0,.25)"/></svg>'; };
let etat = null;

function visuelCase(c) {
    const code = c.code || '';
    if (c.type === 'pochette') return C.miniPack(c.jour, { super: c.jour === 24, legende: c.jour === 1 || c.jour === 10 });
    if (c.type === 'cadre') return C.CADRES[{ 'cadre:balle': 'balle', 'cadre:flocons': 'flocons', 'cadre:guirlande': 'dore' }[code] || 'balle'].svg(170);
    if (c.type === 'fond' || c.type === 'appli') return C.phone({ 'fond:terre': 'terre', 'fond:nuit': 'nuit', 'fond:indoor': 'indoor', 'fond:givre': 'herbe', 'fond:appli': 'appli' }[code] || 'appli', false);
    if (c.type === 'emoji') return '<div style="display:grid;gap:10px;justify-items:center">' + ({ 'emoji:boule': C.emojiBoule, 'emoji:raquette': C.emojiRaquette, 'emoji:etoile': C.emojiEtoile }[code] || C.emojiBoule)(96) + '</div>';
    if (c.type === 'fiche') return C.ficheNeige();
    if (c.type === 'badge') return C.badge(140);
    if (c.type === 'teaser') return C.teaserMystere(c.part || 30, '', c.jMoins || 1, 200);
    return '';
}

// Boutons d'action d'une case ouverte.
function actionsCase(c) {
    if (c.type === 'pochette') return c.cartes && c.cartes.length ? '<button class="sbtn plein" type="button" data-act="revoir">Revoir mes cartes</button><a class="sbtn" href="collection.html">Ma collection</a>' : '<a class="sbtn plein" href="collection.html">Ma collection</a>';
    if (c.type === 'cadre' || c.type === 'emoji' || c.type === 'fiche') return '<button class="sbtn plein" type="button" data-act="equiper">' + { cadre: 'Activer sur ma fiche', emoji: 'Afficher à côté de mon pseudo', fiche: 'Activer sur la fiche de mes joueurs' }[c.type] + '</button>';
    if ((c.type === 'fond' || c.type === 'appli') && c.fichiers) return '<a class="sbtn plein" href="' + escA(c.fichiers.telephone) + '" download>Fond téléphone</a><a class="sbtn" href="' + escA(c.fichiers.ordinateur) + '" download>Fond ordinateur</a>';
    if (c.type === 'badge') return '<button class="sbtn plein" type="button" data-act="equiper-fiche">Activer la fiche festive</button>';
    return '';
}

function miniCal(jourVu) {
    let h = '';
    for (let d = 1; d <= 24; d++) {
        const c = etat.cases[d - 1];
        const cls = d === etat.jourActuel ? 'auj' : c.etat === 'ouverte' ? 'ok' : c.etat === 'ratee' ? 'rate' : '';
        h += '<button type="button" class="mini-case ' + cls + (d === jourVu ? ' vue' : '') + '" data-jour="' + d + '" title="' + d + ' décembre"' + (c.etat === 'ouverte' || d === etat.jourActuel ? '' : ' disabled') + '>' + d + '</button>';
    }
    return '<div class="mini-cal">' + h + '</div><div class="legende-cal"><span>■ vert : ouverte</span><span>■ rouge : aujourd\'hui</span><span>barrée : manquée</span></div>';
}

function toastA(t) {
    let el = document.getElementById('avent-toast');
    if (!el) { el = document.createElement('div'); el.id = 'avent-toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = t; el.hidden = false;
    clearTimeout(toastA.t); toastA.t = setTimeout(function () { el.hidden = true; }, 2800);
}

function bandeau() {
    const zone = document.getElementById('avent-bandeau');
    if (!zone) return;
    if (!etat || !etat.actif) { zone.innerHTML = ''; return; }
    const nb = etat.nbOuvertes, j = etat.jourActuel;
    const ouverte = etat.caseDuJourOuverte;
    zone.innerHTML = '<div class="bandeau-avent">' +
        '<div class="num">' + (j || '—') + '</div>' +
        '<div><h3>' + (j === 25 ? 'Joyeux Noël !' : "Calendrier de l'Avent") + '</h3><p>' + (j ? (ouverte ? 'Case du jour ouverte · prochaine demain à 10h' : "La case du jour t'attend") : 'Prochaine case à 10h') + ' · ' + nb + ' / 25</p>' +
        '<div class="barre"><i style="width:' + Math.min(100, nb / 25 * 100) + '%"></i></div></div>' +
        '<button class="sbtn" style="color:#fff;border-color:rgba(255,255,255,.5)" id="avent-btn" type="button">' + (j && !ouverte ? 'Ouvrir' : 'Voir') + '</button></div>';
    document.getElementById('avent-btn').onclick = function () { fenetre(j || dernierJourOuvert()); };
}
function dernierJourOuvert() {
    const o = etat.cases.filter(function (c) { return c.etat === 'ouverte'; });
    return o.length ? o[o.length - 1].jour : 1;
}

function fenetre(jour) {
    if (!etat) return;
    const c = etat.cases[jour - 1];
    if (!c) return;
    const zone = document.getElementById('avent-fenetre');
    const ouverte = c.etat === 'ouverte';
    const papier = papierDuJour(jour);
    zone.innerHTML = '<div class="avent-voile" id="avent-voile"><div class="fenetre col-scope" role="dialog" aria-modal="true" aria-labelledby="avent-titre">' +
        '<div class="fen-tete"><small>CALENDRIER DE L\'AVENT</small><h2 id="avent-titre">' + jour + ' décembre</h2><button class="fermer" id="avent-fermer" type="button" aria-label="Fermer">×</button></div>' +
        '<div class="fen-corps">' +
        '<div class="scene-porte"><div class="derriere" id="avent-derriere">' + (ouverte ? visuelCase(c) : '') + '</div>' +
        '<button class="porte' + (ouverte ? ' ouverte' : '') + '" id="avent-porte" type="button" aria-label="Ouvrir la case du ' + jour + ' décembre">' + paquet(jour, papier) + '<span class="tap">TOUCHE POUR OUVRIR</span></button></div>' +
        '<div class="cadeau-info" id="avent-info"' + (ouverte ? '' : ' hidden') + '>' + infoCase(c) + '</div>' +
        '<div class="fen-actions" id="avent-actions"' + (ouverte ? '' : ' hidden') + '>' + (ouverte ? actionsCase(c) : '') + '</div>' +
        '<p class="cadeau-erreur" id="avent-erreur" hidden></p>' +
        miniCal(jour) +
        '</div></div></div>';
    const fermer = function () { zone.innerHTML = ''; bandeau(); };
    document.getElementById('avent-fermer').onclick = fermer;
    document.getElementById('avent-voile').addEventListener('click', function (e) { if (e.target.id === 'avent-voile') fermer(); });
    zone.querySelectorAll('.mini-case[data-jour]').forEach(function (b) { b.onclick = function () { fenetre(Number(b.dataset.jour)); }; });
    brancherActions(c);
    const porte = document.getElementById('avent-porte');
    if (!ouverte) {
        porte.focus();
        porte.onclick = async function () {
            if (c.etat !== 'disponible') return;
            porte.disabled = true;
            const rep = await fetch('/api/avent/ouvrir', { method: 'POST' });
            const d = await rep.json().catch(function () { return {}; });
            if (!rep.ok) {
                const err = document.getElementById('avent-erreur');
                err.textContent = d.error || "Impossible d'ouvrir la case."; err.hidden = false; porte.disabled = false;
                return;
            }
            const nc = d.case;
            etat.cases[jour - 1] = nc; etat.caseDuJourOuverte = true; etat.nbOuvertes += 1;
            document.getElementById('avent-derriere').innerHTML = visuelCase(nc);
            porte.classList.add('ouverte');
            setTimeout(async function () {
                document.getElementById('avent-info').innerHTML = infoCase(nc);
                document.getElementById('avent-info').hidden = false;
                document.getElementById('avent-actions').innerHTML = actionsCase(nc);
                document.getElementById('avent-actions').hidden = false;
                brancherActions(nc);
                if (nc.type === 'pochette' && d.cartes && d.cartes.length) {
                    await COL.ouvrirPochette(d.cartes, { taille: nc.jour === 24 ? 10 : 5 });
                }
                // mini-calendrier et bandeau a jour (case maintenant ouverte)
                if (document.getElementById('avent-porte')) fenetre(jour);
                bandeau();
            }, 900);
        };
    }
}

function infoCase(c) {
    if (!c.titre) return '';
    return '<span class="fam" style="color:' + (COUL_FAM[c.type] || '#D4F000') + '">' + (FAM_NOM[c.type] || '') + '</span><h3>' + escA(c.titre) + '</h3><p>' + escA(c.texte) + '</p>';
}

function brancherActions(c) {
    const zone = document.getElementById('avent-actions');
    if (!zone) return;
    const revoir = zone.querySelector('[data-act="revoir"]');
    if (revoir) revoir.onclick = function () { COL.ouvrirPochette(c.cartes || [], { taille: c.jour === 24 ? 10 : 5 }); };
    const equiper = zone.querySelector('[data-act="equiper"]');
    const equiperFiche = zone.querySelector('[data-act="equiper-fiche"]');
    const envoyer = async function (type, code, message) {
        const rep = await fetch('/api/cosmetiques/equiper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type, code: code }) });
        const d = await rep.json().catch(function () { return {}; });
        toastA(rep.ok ? message : (d.error || 'Impossible pour le moment.'));
    };
    if (equiper) equiper.onclick = function () {
        const type = String(c.code || '').split(':')[0];
        envoyer(type, c.code, { cadre: 'Cadre activé', emoji: 'Emoji affiché à côté de ton pseudo', fiche: 'Fond activé sur la fiche de tes joueurs' }[type] || 'Activé');
    };
    if (equiperFiche) equiperFiche.onclick = function () { envoyer('fiche', 'fiche:festive', 'Fiche festive activée'); };
}

async function charger() {
    try {
        const rep = await fetch('/api/avent');
        if (!rep.ok) return;
        etat = await rep.json();
    } catch (e) { return; }
    bandeau();
    const lien = document.getElementById('lien-collection');
    if (lien && (etat.actif || etat.nbOuvertes > 0)) lien.hidden = false;
    if (!etat.actif) return;
    // 1re visite de la journee (ou lien de la cloche) : la fenetre s'ouvre toute seule.
    const forcer = /[?&]avent=1/.test(location.search);
    const j = etat.jourActuel;
    if (!j) return;
    let cle = null;
    try { cle = 'twm.avent.vu.' + (localStorage.getItem('currentUserId') || '') + '.' + etat.annee + '.' + j; } catch (e) { cle = null; }
    let dejaVu = false;
    try { dejaVu = cle && localStorage.getItem(cle) === '1'; } catch (e) { dejaVu = false; }
    if (forcer || (!etat.caseDuJourOuverte && !dejaVu)) {
        try { if (cle) localStorage.setItem(cle, '1'); } catch (e) { /* rien */ }
        fenetre(j);
    }
}
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const f = document.getElementById('avent-fermer'); if (f) f.click(); } });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', charger); else charger();
window.TWMAvent = { ouvrir: fenetre };

})();
