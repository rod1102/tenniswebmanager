/*
 * Dessins des cadeaux du calendrier de l'Avent (2026-11-26) : fonds d'ecran, cadres
 * d'avatar, emojis, fonds de fiche, badge, teasers. Repris tels quels de l'artifact
 * "Calendrier de l'Avent TWM" valide par l'utilisateur. Expose window.TWMCadeaux.
 */
(function () {
let uid = 0;
const nid = (p) => `${p}${++uid}`;
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function points(n, w, h, seed, rmin, rmax, op, y0 = 0) {
  const r = rng(seed); let s = "";
  for (let i = 0; i < n; i++) s += `<circle cx="${(r() * w).toFixed(1)}" cy="${(y0 + r() * h).toFixed(1)}" r="${(rmin + r() * (rmax - rmin)).toFixed(2)}" fill="#fff" opacity="${(op * (0.35 + r() * 0.65)).toFixed(2)}"/>`;
  return s;
}
const grain = (id, a = .09) => `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".95" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 ${a}"/></feComponentTransfer></filter>`;

/* Court vu du dessus, centré en (90, cy), longueur L (proportions réelles) */
function courtHaut(cy, L, ligne, ep = 1.6) {
  const W = L / 2.167, x0 = 90 - W / 2, y0 = cy - L / 2, alley = W * 1.37 / 10.97, srv = L * 6.4 / 23.77;
  const ln = (x1, y1, x2, y2) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${ligne}" stroke-width="${ep}" stroke-linecap="square"/>`;
  return `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${W.toFixed(1)}" height="${L}" fill="none" stroke="${ligne}" stroke-width="${ep}"/>`
    + ln(x0 + alley, y0, x0 + alley, y0 + L) + ln(x0 + W - alley, y0, x0 + W - alley, y0 + L)
    + ln(x0 + alley, cy - srv, x0 + W - alley, cy - srv) + ln(x0 + alley, cy + srv, x0 + W - alley, cy + srv)
    + ln(90, cy - srv, 90, cy + srv) + ln(90, y0, 90, y0 + 5) + ln(90, y0 + L - 5, 90, y0 + L)
    + `<line x1="${(x0 - 8).toFixed(1)}" y1="${cy}" x2="${(x0 + W + 8).toFixed(1)}" y2="${cy}" stroke="${ligne}" stroke-width="${ep * 2.2}" opacity=".9"/>`
    + `<circle cx="${(x0 - 8).toFixed(1)}" cy="${cy}" r="2.4" fill="${ligne}"/><circle cx="${(x0 + W + 8).toFixed(1)}" cy="${cy}" r="2.4" fill="${ligne}"/>`;
}
const balle = (x, y, r, id) => `<defs><radialGradient id="${id}" cx=".35" cy=".32" r=".75"><stop offset="0" stop-color="#F4FF7A"/><stop offset=".7" stop-color="#D4F000"/><stop offset="1" stop-color="#9DB300"/></radialGradient></defs>
  <circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id})"/>
  <path d="M${x - r * .78} ${y - r * .6} Q${x - r * .1} ${y} ${x - r * .78} ${y + r * .6} M${x + r * .78} ${y - r * .6} Q${x + r * .1} ${y} ${x + r * .78} ${y + r * .6}" stroke="#fff" stroke-width="${(r * .14).toFixed(2)}" fill="none" stroke-linecap="round"/>`;
const titre = (t1, t2, couleur, sous, y = 52) => `
  <text x="16" y="${y}" font-family="Big Shoulders Display, Impact, sans-serif" font-weight="900" font-size="34" fill="${couleur}" letter-spacing=".5">${t1}</text>
  <text x="16" y="${y + 13}" font-family="IBM Plex Sans, sans-serif" font-weight="600" font-size="7" letter-spacing="2.2" fill="${couleur}" opacity=".8">${t2}</text>
  <text x="164" y="${y}" text-anchor="end" font-family="IBM Plex Sans, sans-serif" font-weight="700" font-size="7" letter-spacing="1.6" fill="${couleur}" opacity=".8">${sous}</text>`;

/* Fonds d'écran en 2 formats : téléphone (180 x 390) et ordinateur Windows 16:9 (400 x 225).
   Plus aucun texte : seulement le logo TWM (2026-11-24, demande de l'utilisateur). */
const DIM = { phone: [180, 390], desktop: [400, 225] };
const logoFond = (fmt) => fmt === "phone"
  ? `<image href="logo-twm.png" x="47" y="26" width="86" height="50"/>`
  : `<image href="logo-twm.png" x="318" y="14" width="68" height="39"/>`;
// court vu du dessus : vertical sur téléphone, couché sur ordinateur
const courtFond = (fmt, couleur, ep = 1.6) => fmt === "phone"
  ? courtHaut(225, 250, couleur, ep)
  : `<g transform="translate(200 112.5) rotate(90) translate(-90 0)">${courtHaut(0, 290, couleur, ep * .95)}</g>`;
const densite = (fmt, n) => Math.round(n * (fmt === "phone" ? 1 : 1.27));

const FONDS = {
  terre: { nom: "Terre de Noël", quand: "4 décembre", svg: (fmt = "phone") => { const [W, H] = DIM[fmt], g = nid("g"), b = nid("b"), s = nid("s"), k = fmt === "phone" ? 1 : .55;
    const [bx, by, mx, my] = fmt === "phone" ? [124, 134, 116, 148] : [292, 76, 282, 86];
    return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Court en terre battue enneigé vu du dessus">
      <defs>${grain(g, .14)}<linearGradient id="${s}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".95"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="#B9521F"/><rect width="${W}" height="${H}" fill="#C8642D" opacity=".6"/>
      ${courtFond(fmt, "#F6EEE4")}
      <ellipse cx="${mx}" cy="${my}" rx="6" ry="3.2" fill="#9A4216" opacity=".7" transform="rotate(-24 ${mx} ${my})"/>
      ${balle(bx, by, 6.5, b)}
      <path d="M0 ${H - 60 * k} Q${W * .22} ${H - 78 * k} ${W * .44} ${H - 64 * k} T${W} ${H - 72 * k} L${W} ${H} L0 ${H}Z" fill="url(#${s})"/>
      <path d="M0 ${H - 38 * k} Q${W * .28} ${H - 50 * k} ${W * .56} ${H - 40 * k} T${W} ${H - 44 * k} L${W} ${H} L0 ${H}Z" fill="#FBFDFF"/>
      ${points(densite(fmt, 120), W, H, 11, .5, 1.7, .9)}
      <rect width="${W}" height="${H}" filter="url(#${g})"/>
      ${logoFond(fmt)}
    </svg>`; } },
  nuit: { nom: "Night session", quand: "9 décembre", svg: (fmt = "phone") => { const [W, H] = DIM[fmt], g = nid("g"), b = nid("b"), l = nid("l"), t = nid("t");
    const ph = fmt === "phone";
    const panneau = ph ? [10, 80, 160, 290] : [36, 12, 328, 201];
    const traj = ph ? "M58 316 Q90 150 122 150" : "M96 150 Q170 52 292 76";
    const [bx, by] = ph ? [122, 150] : [292, 76];
    const lampes = ph ? [[8, 92], [8, 360], [172, 92], [172, 360]] : [[22, 10], [22, 215], [378, 10], [378, 215]];
    return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Court en dur bleu la nuit vu du dessus">
      <defs>${grain(g, .1)}
        <radialGradient id="${l}" cx=".5" cy=".55" r=".65"><stop offset="0" stop-color="#2D74BB"/><stop offset="1" stop-color="#0B2543"/></radialGradient>
        <radialGradient id="${t}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#D4F000" stop-opacity=".55"/><stop offset="1" stop-color="#D4F000" stop-opacity="0"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="#081A30"/>
      <rect x="${panneau[0]}" y="${panneau[1]}" width="${panneau[2]}" height="${panneau[3]}" rx="4" fill="url(#${l})"/>
      ${courtFond(fmt, "#EAF3FC", 1.5)}
      <path d="${traj}" stroke="#D4F000" stroke-width="1.2" fill="none" stroke-dasharray="1.5 4" stroke-linecap="round" opacity=".9"/>
      <circle cx="${bx}" cy="${by}" r="20" fill="url(#${t})"/>
      ${balle(bx, by, 6.5, b)}
      ${lampes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#FFF8D6"/><circle cx="${x}" cy="${y}" r="12" fill="#FFF8D6" opacity=".12"/>`).join("")}
      ${ph ? points(40, 180, 75, 23, .4, 1.1, .7) : ""}
      <rect width="${W}" height="${H}" filter="url(#${g})"/>
      ${logoFond(fmt)}
    </svg>`; } },
  herbe: { nom: "Givre", quand: "20 décembre", svg: (fmt = "phone") => { const [W, H] = DIM[fmt], g = nid("g"), f = nid("f"), m = nid("m"), p = nid("p"), ph = fmt === "phone";
    const raies = ph ? `<pattern id="${p}" width="${W}" height="26" patternUnits="userSpaceOnUse"><rect width="${W}" height="13" fill="#2E7A4A"/><rect y="13" width="${W}" height="13" fill="#3A8A57"/></pattern>`
      : `<pattern id="${p}" width="26" height="${H}" patternUnits="userSpaceOnUse"><rect width="13" height="${H}" fill="#2E7A4A"/><rect x="13" width="13" height="${H}" fill="#3A8A57"/></pattern>`;
    return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Court en gazon givré vu du dessus">
      <defs>${grain(g, .08)}${raies}
        <filter id="${f}"><feTurbulence type="fractalNoise" baseFrequency="${ph ? ".035 .06" : ".05 .03"}" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -0.55"/></filter>
        <radialGradient id="${m}" cx=".5" cy=".55" r=".62"><stop offset=".55" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>
        <mask id="${m}-k"><rect width="${W}" height="${H}" fill="url(#${m})"/></mask></defs>
      <rect width="${W}" height="${H}" fill="url(#${p})"/>
      ${courtFond(fmt, "#FFFFFF", 1.6)}
      <rect width="${W}" height="${H}" filter="url(#${f})" opacity=".9" mask="url(#${m}-k)"/>
      ${points(densite(fmt, 220), W, H, 41, .3, .9, .55)}
      <rect width="${W}" height="${H}" filter="url(#${g})"/>
      ${logoFond(fmt)}
    </svg>`; } },
  indoor: { nom: "Indoor", quand: "16 décembre", svg: (fmt = "phone") => {
    const ph = fmt === "phone", [W, H] = DIM[fmt];
    const g = nid("g"), sol = nid("so"), ciel = nid("ci"), tr = nid("tr"), bl = nid("bl"), bb = nid("bb"), hl = nid("hl"), vg = nid("vg");
    const r = rng(41);
    // géométrie : horizon (filet) et court en perspective
    const Y0 = ph ? 205 : 112, HT = ph ? 185 : 113, D0 = ph ? 40 : 70, DV = ph ? 150 : 270, CX = W / 2;
    const P = (u, v) => [CX + (u - .5) * 2 * (D0 + v * DV), Y0 + v * HT];
    const T1 = ph ? 76 : 30, T2 = Y0 - 9;
    let tribunes = "";
    for (let i = 0; i < (ph ? 140 : 260); i++) { const y = T1 + 4 + r() * (T2 - T1 - 4), x = r() * W; tribunes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(.5 + r() * 1.1).toFixed(2)}" fill="${r() < .2 ? "#FFF6D8" : "#8D7BC4"}" opacity="${(.25 + r() * .5).toFixed(2)}"/>`; }
    let spots = "";
    const nS = ph ? 7 : 12, yS = ph ? 60 : 16;
    for (let i = 0; i < nS; i++) { const x = (W / nS) * (i + .5); spots += `<circle cx="${x.toFixed(1)}" cy="${yS}" r="7" fill="#FFFFFF" opacity=".25" filter="url(#${bl})"/><circle cx="${x.toFixed(1)}" cy="${yS}" r="1.9" fill="#FFFFFF"/>`; }
    const L = (a, b, w = 1.4) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#F4F0FF" stroke-width="${w}" opacity=".92"/>`;
    const lignes = L(P(0, 0), P(0, 1)) + L(P(1, 0), P(1, 1)) + L(P(.12, 0), P(.12, 1)) + L(P(.88, 0), P(.88, 1)) + L(P(.12, .42), P(.88, .42)) + L(P(.5, .42), P(.5, 1.05)) + L(P(0, 0), P(1, 0), 1);
    const filet = `<rect x="${(P(0, 0)[0] - 6).toFixed(1)}" y="${Y0 - 9}" width="${(P(1, 0)[0] - P(0, 0)[0] + 12).toFixed(1)}" height="9" fill="#0B0716" opacity=".85"/><line x1="${(P(0, 0)[0] - 6).toFixed(1)}" y1="${Y0 - 9}" x2="${(P(1, 0)[0] + 6).toFixed(1)}" y2="${Y0 - 9}" stroke="#F4F0FF" stroke-width="1.2"/>`;
    const [rx, ry] = ph ? [118, 318] : [262, 196];
    const [bx, by, br] = ph ? [48, 142, 15] : [96, 60, 12];
    const courbe = ph ? `M${rx} ${ry} C 96 250, 70 190, ${bx + 4} ${by + 8}` : `M${rx} ${ry} C 220 140, 150 90, ${bx + 6} ${by + 5}`;
    const eclats = ph ? [[96, 236], [140, 262], [104, 278]] : [[236, 150], [290, 160], [250, 170]];
    return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Arène indoor de nuit, balle en plein vol au-dessus d'un court violet">
      <defs>${grain(g, .07)}
        <linearGradient id="${ciel}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05030C"/><stop offset="1" stop-color="#1C1236"/></linearGradient>
        <linearGradient id="${sol}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4E3896"/><stop offset=".5" stop-color="#6E50C8"/><stop offset="1" stop-color="#8A6BE0"/></linearGradient>
        <linearGradient id="${tr}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".7" stop-color="#E8F7FF" stop-opacity=".55"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".95"/></linearGradient>
        <radialGradient id="${hl}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#F4FF9A" stop-opacity=".55"/><stop offset="1" stop-color="#F4FF9A" stop-opacity="0"/></radialGradient>
        <radialGradient id="${vg}" cx=".5" cy=".55" r=".8"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
        <filter id="${bl}" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="2.6"/></filter></defs>
      <rect width="${W}" height="${H}" fill="url(#${ciel})"/>
      ${ph ? `<path d="M0 68 Q90 52 180 68 L180 74 Q90 58 0 74Z" fill="#2A1F48"/>` : `<path d="M0 22 Q200 6 400 22 L400 27 Q200 11 0 27Z" fill="#2A1F48"/>`}
      ${spots}
      <path d="M0 ${T1} H${W} V${Y0 - 9} H0Z" fill="#120B24"/>
      ${tribunes}
      <rect y="${Y0 - 19}" width="${W}" height="12" fill="#2C1E52"/>
      <polygon points="${P(0, 0).join(",")} ${P(1, 0).join(",")} ${W + 60},${H + 5} -60,${H + 5}" fill="url(#${sol})"/>
      <polygon points="-60,${Y0} ${P(0, 0).join(",")} -60,${H + 5}" fill="#3D2A78" opacity=".9"/><polygon points="${W + 60},${Y0} ${P(1, 0).join(",")} ${W + 60},${H + 5}" fill="#3D2A78" opacity=".9"/>
      ${lignes}${filet}
      <ellipse cx="${rx}" cy="${ry}" rx="9" ry="2.6" fill="#1A0F35" opacity=".7"/>
      ${eclats.map(([x, y], i) => `<path d="M${rx} ${ry} Q${(rx + x) / 2 + (i - 1) * 4} ${(ry + y) / 2} ${x} ${y}" stroke="#E8F7FF" stroke-width="${1.2 - i * .2}" fill="none" opacity="${.7 - i * .12}"/>`).join("")}
      <path d="${courbe}" stroke="url(#${tr})" stroke-width="12" fill="none" stroke-linecap="round" opacity=".55" filter="url(#${bl})"/>
      <path d="${courbe}" stroke="url(#${tr})" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="${bx}" cy="${by}" r="${br * 1.7}" fill="url(#${hl})"/>
      ${balle(bx, by, br, bb)}
      <rect width="${W}" height="${H}" fill="url(#${vg})"/>
      <rect width="${W}" height="${H}" filter="url(#${g})"/>
      ${logoFond(fmt)}
    </svg>`; } },
  appli: { nom: "Édition application", quand: "25 décembre", svg: (fmt = "phone") => { const [W, H] = DIM[fmt], g = nid("g"), h = nid("h"), ph = fmt === "phone"; return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fond d'écran Tennis Web Manager, logo sur fond bleu nuit">
      <defs>${grain(g, .1)}<radialGradient id="${h}" cx=".5" cy="${ph ? ".4" : ".5"}" r=".55"><stop offset="0" stop-color="#D4F000" stop-opacity=".32"/><stop offset="1" stop-color="#D4F000" stop-opacity="0"/></radialGradient></defs>
      <rect width="${W}" height="${H}" fill="#0A1628"/>
      ${courtFond(fmt, "#16304F", 1.2)}
      <circle cx="${W / 2}" cy="${ph ? 160 : 112}" r="${ph ? 105 : 120}" fill="url(#${h})"/>
      ${ph ? `<image href="logo-twm.png" x="14" y="150" width="152" height="88"/>` : `<image href="logo-twm.png" x="110" y="60" width="180" height="104"/>`}
      <rect width="${W}" height="${H}" filter="url(#${g})"/>
    </svg>`; } },
};
const phone = (k, enc = true) => `<div class="phone">${enc ? '<span class="encoche"></span>' : ""}${FONDS[k].svg("phone")}</div>`;
const ecran = (k) => `<div class="ecran"><div class="ecran-dalle">${FONDS[k].svg("desktop")}</div><span class="ecran-pied"></span></div>`;

/* ---------- Cadres ---------- */
let sansAvatar = false; // cadreSeul() : le cadre sans la silhouette d'exemple
function avatar(cx, cy, r) {
  if (sansAvatar) return '';
  const c = nid("c");
  return `<clipPath id="${c}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1B3A5C"/>
    <g clip-path="url(#${c})"><circle cx="${cx}" cy="${cy - r * .16}" r="${r * .3}" fill="#9FB0C2"/><ellipse cx="${cx}" cy="${cy + r * .8}" rx="${r * .6}" ry="${r * .48}" fill="#9FB0C2"/></g>`;
}
const CADRES = {
  balle: { nom: "Balle de tennis", quand: "2 décembre", svg: (t = 150) => { const f = nid("f"), gr = nid("gr"), cl = nid("cl");
    // une couture = un arc qui part du bord intérieur, longe le bord extérieur, et revient
    const couture = (centre, sens) => { let d = ""; for (let i = 0; i <= 60; i++) { const u = i / 60, a = (centre - 80 + u * 160) * Math.PI / 180, r = 61 + sens * 6.2 * Math.sin(u * Math.PI); d += (i ? "L" : "M") + (75 + Math.cos(a) * r).toFixed(2) + " " + (75 + Math.sin(a) * r).toFixed(2); } return d; };
    return `<svg width="${t}" height="${t}" viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cadre balle de tennis">
      <defs><radialGradient id="${gr}" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#F2FF73"/><stop offset=".6" stop-color="#D4F000"/><stop offset="1" stop-color="#93A800"/></radialGradient>
        <filter id="${f}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 .8  0 0 0 .55 0"/></filter>
        <mask id="${cl}"><circle cx="75" cy="75" r="68.5" fill="#fff"/><circle cx="75" cy="75" r="53.5" fill="#000"/></mask></defs>
      <circle cx="75" cy="75" r="61" fill="none" stroke="url(#${gr})" stroke-width="15"/>
      <rect width="150" height="150" filter="url(#${f})" mask="url(#${cl})" opacity=".35"/>
      <g mask="url(#${cl})" fill="none" stroke-linecap="round">
        <path d="${couture(180, -1)}" stroke="#F7F9EF" stroke-width="2.6"/><path d="${couture(0, 1)}" stroke="#F7F9EF" stroke-width="2.6"/>
      </g>
      <circle cx="75" cy="75" r="68.5" fill="none" stroke="#7E9100" stroke-width="1" opacity=".6"/>
      ${avatar(75, 75, 52)}
      <circle cx="75" cy="75" r="53" fill="none" stroke="#0A1628" stroke-width="1.5" opacity=".45"/>
    </svg>`; } },
  flocons: { nom: "Cristaux de givre", quand: "7 décembre", svg: (t = 150) => { const gr = nid("gr");
    const cristal = (x, y, s, rot) => { let p = ""; for (let k = 0; k < 6; k++) { const a = (rot + k * 60) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        const ex = x + ca * s, ey = y + sa * s, mx = x + ca * s * .55, my = y + sa * s * .55;
        p += `M${x} ${y}L${ex.toFixed(1)} ${ey.toFixed(1)}`;
        for (const d of [-1, 1]) { const b = a + d * .75; p += `M${mx.toFixed(1)} ${my.toFixed(1)}L${(mx + Math.cos(b) * s * .32).toFixed(1)} ${(my + Math.sin(b) * s * .32).toFixed(1)}`; } }
      return `<path d="${p}" stroke="#F2FAFF" stroke-width="${(s * .13).toFixed(2)}" stroke-linecap="round" fill="none"/>`; };
    const r = rng(9); let cr = "";
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + .2, rr = 61 + (r() - .5) * 6; cr += cristal(75 + Math.cos(a) * rr, 75 + Math.sin(a) * rr, 4.5 + r() * 5.5, r() * 60); }
    return `<svg width="${t}" height="${t}" viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cadre cristaux de givre">
      <defs><linearGradient id="${gr}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E8F6FF"/><stop offset=".5" stop-color="#9ED3F5"/><stop offset="1" stop-color="#4F8FC9"/></linearGradient></defs>
      <circle cx="75" cy="75" r="61" fill="none" stroke="url(#${gr})" stroke-width="9" opacity=".95"/>
      <circle cx="75" cy="75" r="67" fill="none" stroke="#CFEAFF" stroke-width=".8" opacity=".7"/>
      ${avatar(75, 75, 55)}
      ${cr}
    </svg>`; } },
  dore: { nom: "Guirlande de sapin", quand: "15 décembre", svg: (t = 150) => { const lu = nid("lu");
    const r = rng(17); let aiguilles = "", lampes = "";
    for (let i = 0; i < 220; i++) { const a = r() * Math.PI * 2, rr = 55 + r() * 13, l = 4 + r() * 4, o = a + (r() - .5) * 2.2;
      const x = 75 + Math.cos(a) * rr, y = 75 + Math.sin(a) * rr;
      aiguilles += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(o) * l).toFixed(1)}" y2="${(y + Math.sin(o) * l).toFixed(1)}" stroke="${["#1F5C34", "#2E7A4A", "#17462A", "#3A8C57"][i % 4]}" stroke-width="1.6" stroke-linecap="round"/>`; }
    const couleurs = ["#E24B4A", "#F5C542", "#5FA8E8", "#FF8FB3", "#D4F000"];
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + .3, x = 75 + Math.cos(a) * 62, y = 75 + Math.sin(a) * 62, c = couleurs[i % 5];
      lampes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${c}" opacity=".28" filter="url(#${lu})"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${c}"/><circle cx="${(x - .8).toFixed(1)}" cy="${(y - .8).toFixed(1)}" r=".8" fill="#fff" opacity=".8"/>`; }
    return `<svg width="${t}" height="${t}" viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cadre guirlande de sapin">
      <defs><filter id="${lu}" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="2.2"/></filter></defs>
      <circle cx="75" cy="75" r="61" fill="none" stroke="#123A22" stroke-width="13"/>
      ${aiguilles}${lampes}
      ${avatar(75, 75, 52)}
      <path d="M75 131 l-11 -7 q-4 -2 -2 5 l2 6 q1 3 5 1 Z M75 131 l11 -7 q4 -2 2 5 l-2 6 q-1 3 -5 1 Z" fill="#C23A39"/><circle cx="75" cy="131" r="3.4" fill="#9E2A29"/>
    </svg>`; } },
};

/* ---------- Cosmétiques et divers ---------- */
const ligneEmoji = (e) => `<div class="ligne-classement"><span class="r">14</span><span class="p">${e} TonPseudo</span><span class="pts">1 240 pts</span></div>`;
const ficheFestive = () => `<div class="fiche-festive" role="img" aria-label="Fond de fiche festif">
  <svg viewBox="0 0 300 150" preserveAspectRatio="none" aria-hidden="true">
    <path d="M-5 8 Q37 34 75 10 T150 10 T225 10 T305 8" stroke="#1F4A33" stroke-width="2" fill="none"/>
    ${[16, 52, 92, 130, 168, 206, 246, 284].map((x, i) => `<circle cx="${x}" cy="${[20, 24, 18, 22, 20, 24, 18, 22][i]}" r="4.5" fill="${["#E24B4A", "#D4F000", "#5FA8E8", "#F5B942"][i % 4]}"/><circle cx="${x}" cy="${[20, 24, 18, 22, 20, 24, 18, 22][i]}" r="9" fill="${["#E24B4A", "#D4F000", "#5FA8E8", "#F5B942"][i % 4]}" opacity=".18"/>`).join("")}
    ${points(36, 300, 120, 77, .5, 1.3, .5, 30)}
  </svg>
  <div style="position:relative;font-size:11px;font-weight:700;letter-spacing:.1em;color:#D4F000">ATP</div>
  <div class="fn">Prénom<br>NOM</div>
  <div class="fs">France · fiche aux couleurs de Noël</div>
</div>`;
const badge = (t = 120) => { const g = nid("bg"); return `<svg width="${t}" height="${t}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Badge Calendrier de l'Avent 2026">
  <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C23A39"/><stop offset="1" stop-color="#6E1515"/></linearGradient></defs>
  <path d="M42 70 L30 114 L48 104 L58 118 L62 74Z" fill="#1F6B3E"/><path d="M78 70 L90 114 L72 104 L62 118 L58 74Z" fill="#2F7D4C"/>
  <circle cx="60" cy="52" r="42" fill="url(#${g})" stroke="#F6DC7A" stroke-width="4"/>
  <circle cx="60" cy="52" r="33" fill="none" stroke="#F6DC7A" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="60" y="50" text-anchor="middle" font-family="Big Shoulders Display, Impact, sans-serif" font-weight="900" font-size="22" fill="#fff">24/24</text>
  <text x="60" y="66" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-weight="700" font-size="7.5" letter-spacing="1.5" fill="#F6DC7A">AVENT 2026</text>
</svg>`; };
/* ---------- Nouveaux visuels : pochettes, emojis dessinés, fond de fiche neige ---------- */
const miniPack = (n, opts = {}) => `<div class="mini-pack${opts.super ? " super" : ""}" role="img" aria-label="${opts.super ? "Super pack de 10 cartes" : "Pochette " + n}">
  <span class="mp-dents"></span>
  <div class="mp-num">${opts.super ? "SUPER" : "PACK " + n}</div>
  <img src="logo-twm.png" alt="" class="mp-logo"><div class="mp-titre">Collection</div>
  <div class="mp-sous">${opts.super ? "10 CARTES" : "5 CARTES"}</div>
  ${opts.legende ? `<div class="mp-bonus">+ ta légendaire 1/1</div>` : ""}
</div>`;
function emojiBoule(t = 22) {
  const g = nid("eb");
  return `<svg width="${t}" height="${t}" viewBox="0 0 24 24" aria-label="balle de tennis en boule de Noël" role="img">
    <defs><radialGradient id="${g}" cx=".35" cy=".35" r=".75"><stop offset="0" stop-color="#F4FF7A"/><stop offset=".7" stop-color="#D4F000"/><stop offset="1" stop-color="#8FA300"/></radialGradient></defs>
    <circle cx="12" cy="1.6" r="1.2" fill="none" stroke="#D4AF37" stroke-width=".8"/>
    <rect x="9.6" y="2.6" width="4.8" height="2.6" rx=".6" fill="#D4AF37"/><rect x="9.6" y="3.6" width="4.8" height=".5" fill="#8C6D12"/>
    <circle cx="12" cy="14" r="9" fill="url(#${g})"/>
    <path d="M5 8.5 Q9.5 14 5 19.5 M19 8.5 Q14.5 14 19 19.5" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <ellipse cx="8.6" cy="10" rx="1.8" ry="1" fill="#fff" opacity=".55" transform="rotate(-35 8.6 10)"/>
  </svg>`;
}
function emojiRaquette(t = 22) {
  const c = nid("er");
  return `<svg width="${t}" height="${t}" viewBox="0 0 24 24" aria-label="raquette" role="img">
    <g transform="rotate(-38 12 12)">
      <clipPath id="${c}"><ellipse cx="12" cy="7.6" rx="5" ry="6.4"/></clipPath>
      <g clip-path="url(#${c})" stroke="#E8EDF2" stroke-width=".45">${[8, 10, 12, 14, 16].map(x => `<line x1="${x}" y1="0" x2="${x}" y2="15"/>`).join("")}${[3, 5, 7, 9, 11, 13].map(y => `<line x1="6" y1="${y}" x2="18" y2="${y}"/>`).join("")}</g>
      <ellipse cx="12" cy="7.6" rx="5.6" ry="7" fill="none" stroke="#E24B4A" stroke-width="1.6"/>
      <path d="M10.2 14 L12 16.4 L13.8 14" stroke="#E24B4A" stroke-width="1.3" fill="none"/>
      <rect x="11" y="16.2" width="2" height="7.4" rx=".8" fill="#2A2F37"/><rect x="11" y="19" width="2" height=".6" fill="#D4F000"/>
    </g>
  </svg>`;
}
function emojiEtoile(t = 22) {
  const g = nid("ee"), pts = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.4 : 10; return `${(12 + Math.cos(a) * r).toFixed(2)},${(12.6 + Math.sin(a) * r).toFixed(2)}`; }).join(" ");
  return `<svg width="${t}" height="${t}" viewBox="0 0 24 24" aria-label="étoile de Noël" role="img">
    <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF3B0"/><stop offset=".5" stop-color="#F5C542"/><stop offset="1" stop-color="#B8860B"/></linearGradient></defs>
    <circle cx="12" cy="12.6" r="10" fill="#F5C542" opacity=".18"/>
    <polygon points="${pts}" fill="url(#${g})" stroke="#8C6D12" stroke-width=".5" stroke-linejoin="round"/>
    <path d="M12 6.5 L12 18.5 M6.4 10.8 L17.6 14.4" stroke="#fff" stroke-width=".5" opacity=".5"/>
    <path d="M20 2.5 l.6 1.4 1.4.6 -1.4.6 -.6 1.4 -.6 -1.4 -1.4 -.6 1.4 -.6z" fill="#fff"/>
  </svg>`;
}
const ficheNeige = () => `<div class="fiche-festive fiche-neige" role="img" aria-label="Fond de fiche neige">
  <svg viewBox="0 0 300 150" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 0 H300 V18 Q285 30 270 20 Q262 34 250 22 Q232 14 220 26 Q212 40 204 24 Q190 12 176 22 Q160 32 150 20 Q138 10 126 24 Q118 38 110 22 Q96 12 82 24 Q70 34 60 20 Q48 10 36 24 Q28 36 20 22 Q10 14 0 22Z" fill="#F4F8FC"/>
    ${points(60, 300, 150, 91, .5, 1.6, .7)}
  </svg>
  <div style="position:relative;font-size:11px;font-weight:700;letter-spacing:.1em;color:#D4F000">ATP</div>
  <div class="fn">Prénom<br>NOM</div>
  <div class="fs">Fiche sous la neige</div>
</div>`;


/* Teaser mystère : un trait de lumière dessine peu à peu une forme arrondie (on ne sait pas encore quoi),
   une énigme et le compte à rebours. Rien ne nomme l'application avant le 25. */
// Coins du contour révélés selon l'étape : 1 coin, puis 2 opposés, puis 3 (jamais les 4)
function coins(part, g) {
  const x = 66, y = 34, w = 68, h = 132, r = 14, l = 16;
  const C = [
    `M${x} ${y + r + l} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + r + l}`,
    `M${x + w - r - l} ${y + h} H${x + w - r} Q${x + w} ${y + h} ${x + w} ${y + h - r} V${y + h - r - l}`,
    `M${x + w - r - l} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + r + l}`,
  ];
  const n = part < 50 ? 1 : part < 80 ? 2 : 3;
  return C.slice(0, n).map(d => `<path d="${d}" fill="none" stroke="#D4F000" stroke-width="5" stroke-linecap="round" filter="url(#${g})" opacity=".75"/><path d="${d}" fill="none" stroke="#F4FF9A" stroke-width="1.8" stroke-linecap="round"/>`).join("");
}
function teaserMystere(part, enigme, jMoins, taille = 220) {
  const g = nid("tg"), p = nid("tp");
  return `<div class="teaser-m" style="width:${taille}px">
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs><filter id="${g}" x="-.5" y="-.5" width="2" height="2"><feGaussianBlur stdDeviation="3.2"/></filter>
        <radialGradient id="${p}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#D4F000" stop-opacity=".22"/><stop offset="1" stop-color="#D4F000" stop-opacity="0"/></radialGradient></defs>
      <rect width="200" height="200" fill="#060C18"/>
      ${points(40, 200, 200, 7 + part, .3, .9, .45)}
      <circle cx="100" cy="100" r="80" fill="url(#${p})"/>
      <g transform="rotate(-24 100 100)">${coins(part, g)}</g>
      <text x="100" y="108" text-anchor="middle" font-family="Big Shoulders Display, Impact, sans-serif" font-weight="900" font-size="30" fill="#fff" opacity=".9">J-${jMoins}</text>
    </svg>

  </div>`;
}
function cadreSeul(nom, t) { sansAvatar = true; try { return CADRES[nom].svg(t); } finally { sansAvatar = false; } }
window.TWMCadeaux = { cadreSeul, FONDS, CADRES, emojiBoule, emojiRaquette, emojiEtoile, ficheNeige, ficheFestive, badge, teaserMystere, miniPack, phone, ecran };
})();
