/**
 * ─── L'ÉTIQUETTE CODE-BARRES, TAILLÉE POUR LE ROULEAU ──────────────────────────
 *
 * Ce que l'imprimante sortait, et pourquoi.
 *
 * La feuille annonçait `@page { size: 40mm 20mm }` : une page PLUS LARGE QUE
 * HAUTE. Chrome traduit ça au pilote par « paysage ». Le pilote Seagull du
 * XP-350B, lui, est réglé sur « Portrait » avec un support USER 40 × 20 : il
 * reçoit une page paysage pour un support portrait et fait tourner l'image d'un
 * quart de tour. Résultat au comptoir : les 40 mm de dessin s'écrasent sur les
 * 20 mm du pas d'étiquette — le nom, les chiffres et le prix sont coupés net à
 * droite, tous au même endroit (d'où l'impression qu'ils « se chevauchent »),
 * et la moitié du rouleau reste blanche.
 *
 * Aucune marge, aucun `padding` ne rattrape ça : 40 mm de contenu ne rentrent
 * pas dans 20 mm. Ce qu'il faut, c'est que la GÉOMÉTRIE DE LA PAGE corresponde
 * à ce que le pilote attend. D'où, ici :
 *
 *   • un PIVOT 90° assumé : la vignette garde son dessin (nom en haut, barres,
 *     chiffres, prix), mais la page part en portrait — `@page{size:20mm 40mm}`
 *     — et la vignette est tournée dedans. Plus de conflit portrait/paysage,
 *     donc plus de rotation surprise du pilote ;
 *   • le format et le pivot se CHOISISSENT sur la feuille d'aperçu et se
 *     retiennent (localStorage) : réglé une fois sur le poste, juste ensuite ;
 *   • la vignette est une GRILLE à quatre rangées — nom / barres / chiffres /
 *     prix. Les trois rangées de texte prennent leur hauteur, les barres
 *     prennent tout le reste (`minmax(0,1fr)`) : aucune rangée ne peut mordre
 *     sur sa voisine, même avec un nom à rallonge ou un prix à cinq chiffres ;
 *   • toutes les tailles dérivent de la hauteur de l'étiquette, donc un 58 × 40
 *     n'est pas un 40 × 20 avec du vide autour ;
 *   • le nom, les chiffres et le prix se réduisent jusqu'à tenir dans leur
 *     boîte — mesuré une fois les polices chargées, et re-mesuré juste avant
 *     l'impression.
 *
 * Le module ne connaît ni le DOM ni React : il rend du HTML, et se teste.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/** Dimensions d'une vignette, en millimètres. */
export interface LabelSize {
  widthMm: number;
  heightMm: number;
}

/** Le rouleau utilisé en station : 40 mm de large, 20 mm de haut. */
export const LABEL_40_20: LabelSize = { widthMm: 40, heightMm: 20 };

/**
 * Les rouleaux qu'on trouve chez les fournisseurs. Le premier est le format par
 * défaut ; les autres sont là pour qu'un changement de bobine ne demande pas
 * une reprise du code.
 */
export const LABEL_PRESETS: { label: string; size: LabelSize }[] = [
  { label: '40 × 20 mm', size: { widthMm: 40, heightMm: 20 } },
  { label: '40 × 30 mm', size: { widthMm: 40, heightMm: 30 } },
  { label: '50 × 25 mm', size: { widthMm: 50, heightMm: 25 } },
  { label: '50 × 30 mm', size: { widthMm: 50, heightMm: 30 } },
  { label: '58 × 40 mm', size: { widthMm: 58, heightMm: 40 } },
  { label: '60 × 40 mm', size: { widthMm: 60, heightMm: 40 } },
  { label: '30 × 20 mm', size: { widthMm: 30, heightMm: 20 } },
  { label: '100 × 50 mm', size: { widthMm: 100, heightMm: 50 } },
];

/**
 * La marge de la vignette, en PROPORTION de ses côtés — 2,5 % en largeur, 3 %
 * en hauteur. Une marge en millimètres fixes mangerait tout un 30 × 20 et se
 * perdrait sur un 100 × 50 ; en proportion, le dessin est le même partout.
 * Ces deux nombres sont la seule source : le CSS les reprend, `moduleWidthMm`
 * aussi, et l'avertissement « code trop dense » reste donc vrai.
 */
export const PAD_X_RATIO = 0.025;
export const PAD_Y_RATIO = 0.03;

/** Ce qu'on retient d'un poste à l'autre : format du rouleau, pivot, copies. */
export interface LabelOptions {
  size?: LabelSize;
  /** Page tournée d'un quart de tour — voir l'en-tête du fichier. */
  rotate?: boolean;
  /** Nombre de vignettes identiques à sortir d'affilée. */
  copies?: number;
}

/** Ce qu'une étiquette montre d'un produit. */
export interface BarcodeLabelProduct {
  name?: string;
  barcode?: string;
  salePrice?: number;
}

/**
 * Code 128 — une trame de 6 modules par valeur (0-106), commune aux jeux A, B
 * et C. Chaque trame est barre/espace/barre/espace/barre/espace ; le symbole
 * d'arrêt (106) porte une barre terminale supplémentaire. Table standard,
 * lisible par toutes les douchettes.
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE128_SWITCH_B = 100;
const CODE128_SWITCH_C = 99;
const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_STOP = 106;
/** Zone de silence exigée par la norme, de chaque côté du symbole. */
const QUIET_MODULES = 10;

/** Longueur de la suite de chiffres qui commence en `i`. */
function digitRun(s: string, i: number): number {
  let n = 0;
  while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n++;
  return n;
}

/**
 * Les VALEURS Code 128 d'un texte, jeu B et jeu C mélangés.
 *
 * Le jeu C encode DEUX chiffres par symbole. Les codes de la station font
 * treize chiffres (`genBarcode`) : en jeu B seul, le symbole pesait 198
 * modules, soit 0,19 mm par module une fois étalé sur 40 mm — la limite basse
 * de ce qu'une douchette d'entrée de gamme sait lire. Le même code en jeu C
 * tombe à 143 modules, donc 0,27 mm : le symbole passe de « ça devrait
 * marcher » à « ça se lit du premier coup ».
 *
 * La bascule se décide au compte de symboles, pas à vue de nez : deux chiffres
 * en C en économisent un, entrer coûte un symbole (gratuit au départ, où la
 * bascule remplace le symbole de début) et revenir en B en coûte un autre s'il
 * reste quelque chose derrière. On ne bascule que si le solde est POSITIF —
 * une égalité resterait en jeu B, plus simple à relire.
 */
export function code128Values(text: string): number[] | null {
  // Code 128 (jeux B/C) n'encode que l'ASCII imprimable (32-126).
  const clean = String(text ?? '').replace(/[^\x20-\x7E]/g, '');
  if (!clean) return null;

  const codes: number[] = [];
  let mode: 'B' | 'C' | null = null;
  let i = 0;

  while (i < clean.length) {
    const run = digitRun(clean, i);
    const even = run - (run % 2);        // le jeu C avale les chiffres par PAIRES
    const entryCost = mode === 'C' || i === 0 ? 0 : 1;
    const exitCost = i + even < clean.length ? 1 : 0;
    const wantC = even >= 2 && even / 2 - entryCost - exitCost > 0;

    if (wantC) {
      if (mode !== 'C') { codes.push(mode === null ? CODE128_START_C : CODE128_SWITCH_C); mode = 'C'; }
      for (let k = 0; k < even; k += 2) codes.push(parseInt(clean.substr(i + k, 2), 10));
      i += even;
    } else {
      if (mode !== 'B') { codes.push(mode === null ? CODE128_START_B : CODE128_SWITCH_B); mode = 'B'; }
      codes.push(clean.charCodeAt(i) - 32);
      i += 1;
    }
  }

  // Somme de contrôle : le symbole de départ pèse 1, puis chaque symbole pèse
  // son rang. Le reste modulo 103 est le caractère de contrôle.
  let checksum = codes[0];
  for (let k = 1; k < codes.length; k++) checksum += codes[k] * k;
  codes.push(checksum % 103);
  codes.push(CODE128_STOP);
  return codes;
}

/**
 * La suite des largeurs barre/espace du symbole, en modules, zones de silence
 * comprises. `null` quand le texte n'a rien d'encodable.
 */
export function code128Widths(text: string): { widths: number[]; modules: number } | null {
  const codes = code128Values(text);
  if (!codes) return null;

  const widths = codes
    .map(c => CODE128_PATTERNS[c])
    .join('')
    .split('')
    .map(d => parseInt(d, 10));
  const modules = widths.reduce((s, w) => s + w, 0) + QUIET_MODULES * 2;
  return { widths, modules };
}

/** Les barres noires du symbole, en unités de module, zone de silence incluse. */
function barRects(widths: number[], unit: number, height: number): string {
  let x = QUIET_MODULES * unit;
  let isBar = true;
  let rects = '';
  for (const w of widths) {
    const width = w * unit;
    if (isBar) rects += `<rect x="${round(x)}" y="0" width="${round(width)}" height="${height}"/>`;
    x += width;
    isBar = !isBar;
  }
  return rects;
}

const round = (n: number) => Math.round(n * 1000) / 1000;


/**
 * Code-barres à taille FIXE, en pixels — pour un aperçu à l'écran ou un
 * document qui n'est pas une étiquette.
 */
export function barcodeSVG(text: string, moduleWidth = 2, height = 70): string {
  const bars = code128Widths(text);
  if (!bars) return '';
  const total = bars.modules * moduleWidth;
  return `<svg width="${round(total)}" height="${height}" viewBox="0 0 ${round(total)} ${height}"`
    + ` xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`
    + `<rect x="0" y="0" width="${round(total)}" height="${height}" fill="#fff"/>`
    + `<g fill="#000">${barRects(bars.widths, moduleWidth, height)}</g></svg>`;
}

/**
 * Code-barres d'ÉTIQUETTE : aucune largeur figée, il remplit la boîte que le
 * CSS lui donne. C'est ce qui le fait tenir dans la vignette quel que soit le
 * nombre de caractères — un code à rallonge resserre ses barres au lieu de
 * déborder.
 *
 * `preserveAspectRatio="none"` étire uniquement en X : toutes les barres
 * gardent leurs proportions les unes par rapport aux autres, donc le symbole
 * reste lisible.
 */
export function barcodeLabelSVG(text: string): string {
  const bars = code128Widths(text);
  if (!bars) return '';
  const H = 100; // hauteur du repère interne ; la hauteur réelle vient du CSS
  return `<svg viewBox="0 0 ${bars.modules} ${H}" preserveAspectRatio="none"`
    + ` xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`
    + `<rect x="0" y="0" width="${bars.modules}" height="${H}" fill="#fff"/>`
    + `<g fill="#000">${barRects(bars.widths, 1, H)}</g></svg>`;
}

/**
 * Largeur d'un module une fois l'étiquette imprimée, en millimètres. En dessous
 * d'environ 0,19 mm, une douchette d'entrée de gamme commence à buter sur le
 * symbole : la fenêtre d'impression le signale plutôt que de laisser découvrir
 * le problème au comptoir.
 *
 * La marge par défaut est celle qu'applique réellement la feuille :
 * `PAD_X_RATIO` de la largeur, soit 1 mm sur un rouleau de 40 mm.
 */
export function moduleWidthMm(
  text: string,
  size: LabelSize = LABEL_40_20,
  paddingMm: number = size.widthMm * PAD_X_RATIO,
): number {
  const bars = code128Widths(text);
  if (!bars) return 0;
  return (size.widthMm - paddingMm * 2) / bars.modules;
}

/** En deçà de cette largeur de module, le symbole devient difficile à lire. */
export const MIN_MODULE_MM = 0.19;

/**
 * Le prix tel qu'il se lit sur une vignette : sans décimales quand elles valent
 * zéro. « 250 DA » se lit d'un coup d'œil, « 250,00 DA » mange trois caractères
 * de large pour ne rien apprendre.
 */
export function labelPrice(price?: number): string {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return '';
  const whole = Math.abs(price - Math.round(price)) < 0.005;
  const n = price.toLocaleString('fr-DZ', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${n} DA`;
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Où le poste retient son rouleau : format, pivot, nombre de copies. */
export const LABEL_PREFS_KEY = 'etiquette.format.v1';

/**
 * La page d'impression complète.
 *
 * À l'écran elle montre l'étiquette AGRANDIE — une vignette de 40 × 20 mm est
 * illisible sur un moniteur — avec les trois réglages qui décident de ce qui
 * sort vraiment : le format du rouleau, le pivot, le nombre de copies. À
 * l'imprimante, seules les vignettes partent, exactement à leur taille.
 *
 * Le format et le pivot vivent dans des VARIABLES CSS et dans une règle `@page`
 * réécrite à la volée : changer de rouleau ne redemande pas la page, l'aperçu
 * suit immédiatement, et le choix est retenu pour l'étiquette suivante.
 */
export function barcodeLabelHTML(
  product: BarcodeLabelProduct,
  sizeOrOptions: LabelSize | LabelOptions = LABEL_40_20,
): string {
  const opts: LabelOptions = 'widthMm' in (sizeOrOptions as LabelSize)
    ? { size: sizeOrOptions as LabelSize }
    : (sizeOrOptions as LabelOptions);
  const size = opts.size || LABEL_40_20;
  const rotate = !!opts.rotate;
  const copies = Math.max(1, Math.min(50, Math.round(opts.copies || 1)));

  const code = String(product.barcode ?? '').trim();
  const svg = barcodeLabelSVG(code);
  const name = escapeHtml(product.name || '');
  const price = escapeHtml(labelPrice(product.salePrice));
  const modules = code128Widths(code)?.modules ?? 0;
  const W = size.widthMm;
  const H = size.heightMm;
  // La page envoyée à l'imprimante : les côtés s'échangent quand on pivote.
  const PW = rotate ? H : W;
  const PH = rotate ? W : H;

  const presetOptions = LABEL_PRESETS.map(p =>
    `<option value="${p.size.widthMm}x${p.size.heightMm}"`
    + `${p.size.widthMm === W && p.size.heightMm === H ? ' selected' : ''}>${p.label}</option>`
  ).join('');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>Étiquette ${escapeHtml(code)}</title>
<style id="page-size">@page{size:${PW}mm ${PH}mm;margin:0}</style>
<style>
  *{margin:0;padding:0;box-sizing:border-box}

  /* ── Toute la vignette dérive de ces quatre nombres ─────────────────────────
     "--lw"/"--lh" sont le DESSIN (toujours à l'endroit), "--pw"/"--ph" la PAGE
     envoyée à l'imprimante (côtés échangés quand on pivote). Les tailles de
     texte et les marges sont des fractions de la hauteur : un 58 × 40 n'est pas
     un 40 × 20 entouré de vide, c'est le même dessin en plus grand. */
  :root{
    --lw:${W}mm; --lh:${H}mm;
    --pw:${PW}mm; --ph:${PH}mm;
    --pad-x:calc(var(--lw) * ${PAD_X_RATIO});
    --pad-y:calc(var(--lh) * ${PAD_Y_RATIO});
    --fs-name:calc(var(--lh) * 0.125);
    --fs-code:calc(var(--lh) * 0.105);
    --fs-price:calc(var(--lh) * 0.16);
    --zoom:4;
  }
  html,body{background:#f1f5f9;font-family:Arial,Helvetica,sans-serif}

  /* ── La page physique, et la vignette dedans ──────────────────────────────
     ".sheet" fait EXACTEMENT la taille de la page : c'est lui qui garantit
     qu'une vignette pivotée retombe dans ses clous plutôt que de déborder. */
  .sheet{
    position:relative;
    width:var(--pw);height:var(--ph);
    background:#fff;overflow:hidden;
    break-after:page;page-break-after:always;
  }
  /* La dernière copie ne pousse pas une page blanche derrière elle. */
  .sheet:last-child{break-after:auto;page-break-after:auto}

  .label{
    position:absolute;top:0;left:0;
    width:var(--lw);height:var(--lh);
    padding:var(--pad-y) var(--pad-x);
    background:#fff;color:#000;
    overflow:hidden;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;

    /* Quatre rangées : nom · barres · chiffres · prix. Les trois rangées de
       texte prennent leur hauteur ("auto"), les barres prennent tout le reste
       ("minmax(0,1fr)", qui sait descendre à zéro sans jamais pousser ses
       voisines). Aucune rangée ne peut donc en recouvrir une autre — c'est ce
       qui remplace l'empilement flex où un nom long grignotait le reste. */
    display:grid;
    grid-template-rows:auto minmax(0,1fr) auto auto;
    align-content:stretch;
  }
  /* Le pivot : la vignette tourne d'un quart de tour dans sa page.
     "rotate(90deg) translateY(-100%)" se lit de droite à gauche — on remonte
     d'abord la vignette de sa propre hauteur, puis on tourne : elle retombe
     pile sur [0, --lh] × [0, --lw], soit exactement la page pivotée. */
  body[data-rotate="1"] .label{
    transform-origin:0 0;
    transform:rotate(90deg) translateY(-100%);
  }

  /* Le nom : gras, deux lignes au plus, et une hauteur PLAFONNÉE. Sans ce
     plafond, un nom à rallonge prendrait sur la hauteur des barres. */
  .name{
    font-weight:900;font-size:var(--fs-name);line-height:1.06;
    letter-spacing:-0.02em;text-align:center;
    max-height:calc(var(--lh) * 0.28);
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
    overflow:hidden;overflow-wrap:anywhere;
  }
  /* Les barres remplissent la rangée que la grille leur laisse. Le SVG est en
     absolu : c'est la seule façon fiable de remplir une boîte dont la hauteur
     vient de "1fr". */
  .bars{
    position:relative;min-height:0;
    margin:calc(var(--lh) * 0.02) 0 calc(var(--lh) * 0.012);
  }
  .bars svg{position:absolute;top:0;left:0;width:100%;height:100%;display:block}
  .code{
    font-family:'Courier New',Courier,monospace;font-weight:700;
    font-size:var(--fs-code);line-height:1.1;letter-spacing:0.12em;
    text-align:center;white-space:nowrap;overflow:hidden;
  }
  .price{
    font-weight:900;font-size:var(--fs-price);line-height:1.15;
    text-align:center;margin-top:calc(var(--lh) * 0.015);
    white-space:nowrap;overflow:hidden;
  }
  .empty{
    grid-row:1 / -1;align-self:center;
    font-size:calc(var(--lh) * 0.12);font-weight:700;text-align:center;
  }

  /* ── Écran : la vignette agrandie, et les réglages qui la commandent ────── */
  @media screen{
    body{padding:26px 16px 40px;display:flex;flex-direction:column;align-items:center;gap:16px}
    h1{font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:#475569;text-align:center}
    .stage{
      width:calc(var(--pw) * var(--zoom));height:calc(var(--ph) * var(--zoom));
      box-shadow:0 10px 30px rgba(15,23,42,.18);border-radius:4px;background:#fff;
      overflow:hidden;flex:none;
    }
    .stage .sheet{transform:scale(var(--zoom));transform-origin:top left}
    /* Une seule vignette à l'écran : les copies ne concernent que le papier. */
    #sheets .sheet:not(:first-child){display:none}

    .panel{
      display:flex;flex-wrap:wrap;gap:10px 14px;justify-content:center;align-items:flex-end;
      background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;
      box-shadow:0 2px 8px rgba(15,23,42,.06);
    }
    .panel label{
      display:flex;flex-direction:column;gap:5px;
      font:700 10px/1 Arial,Helvetica,sans-serif;
      text-transform:uppercase;letter-spacing:.1em;color:#64748b;
    }
    .panel select,.panel input[type=number]{
      font:700 13px/1 Arial,Helvetica,sans-serif;color:#0f172a;
      border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;background:#fff;
    }
    .panel input[type=number]{width:76px}
    .toggle{
      flex-direction:row!important;align-items:center;gap:8px!important;
      color:#0f172a!important;font-size:11px!important;padding-bottom:9px;
    }
    .toggle input{width:16px;height:16px;accent-color:#001f5c}

    .meta{font-size:12px;color:#64748b;text-align:center;line-height:1.6;max-width:46ch}
    .meta b{color:#0f172a}
    .warn{
      max-width:46ch;font-size:12px;line-height:1.5;text-align:center;font-weight:700;
      color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;
    }
    .warn[hidden]{display:none}
    button{
      font:700 12px/1 Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.12em;
      padding:12px 22px;border-radius:10px;border:0;cursor:pointer;
      background:#001f5c;color:#FFB800;
    }
    button:hover{background:#003087}
  }

  /* ── Impression : les vignettes, et rien d'autre ───────────────────────── */
  @media print{
    html,body{background:#fff;padding:0;margin:0}
    .screen-only{display:none!important}
    .stage{width:auto;height:auto;box-shadow:none;border-radius:0;overflow:visible}
    .stage .sheet{transform:none}
  }
</style></head>
<body data-rotate="${rotate ? '1' : '0'}">
  <h1 class="screen-only" id="title">Étiquette ${W} × ${H} mm</h1>

  <div class="stage">
    <div id="sheets">
      <div class="sheet">
        <div class="label">
          ${svg ? `
          <div class="name" data-fit="height">${name || '&nbsp;'}</div>
          <div class="bars">${svg}</div>
          <div class="code" data-fit="width">${escapeHtml(code)}</div>
          ${price ? `<div class="price" data-fit="width">${price}</div>` : ''}`
          : `<div class="empty">Code-barres illisible</div>`}
        </div>
      </div>
    </div>
  </div>

  <div class="panel screen-only">
    <label>Format du rouleau
      <select id="fmt">${presetOptions}</select>
    </label>
    <label class="toggle" title="À cocher si l'étiquette sort tournée d'un quart de tour, ou coupée sur le côté">
      <input type="checkbox" id="rot"${rotate ? ' checked' : ''}> Pivoter 90°
    </label>
    <label>Copies
      <input type="number" id="cop" min="1" max="50" step="1" value="${copies}">
    </label>
  </div>

  <p class="warn screen-only" id="warn" hidden></p>
  <p class="meta screen-only" id="meta"></p>
  <button class="screen-only" onclick="window.print()">Imprimer l'étiquette</button>

  <script>
  (function () {
    var PREFS = ${JSON.stringify(LABEL_PREFS_KEY)};
    var MODULES = ${modules};
    var PAD_X = ${PAD_X_RATIO};
    var MIN_MODULE = ${MIN_MODULE_MM};

    var root = document.documentElement;
    var pageStyle = document.getElementById('page-size');
    var sheets = document.getElementById('sheets');
    var fmt = document.getElementById('fmt');
    var rot = document.getElementById('rot');
    var cop = document.getElementById('cop');

    var state = { w: ${W}, h: ${H}, rotate: ${rotate}, copies: ${copies} };

    // ── Le réglage retenu sur le poste ─────────────────────────────────────
    // Le format d'un rouleau ne change pas d'une étiquette à l'autre : réglé
    // une fois, il vaut pour toutes les suivantes.
    try {
      var saved = JSON.parse(localStorage.getItem(PREFS) || 'null');
      if (saved && saved.w > 0 && saved.h > 0) {
        state.w = saved.w;
        state.h = saved.h;
        state.rotate = !!saved.rotate;
        state.copies = Math.max(1, Math.min(50, saved.copies || 1));
      }
    } catch (e) { /* navigation privée, stockage bloqué : on garde le défaut */ }

    function save() {
      try { localStorage.setItem(PREFS, JSON.stringify(state)); } catch (e) {}
    }

    // ── Réduire un texte jusqu'à ce qu'il tienne dans sa boîte ─────────────
    // Mesuré en PIXELS à partir de la taille calculée : marche donc pour
    // n'importe quel format, sans table de correspondance en millimètres.
    //
    // Le nom se mesure BRIDE DESSERRÉE. Tant que "-webkit-line-clamp" tient,
    // le navigateur coupe le texte à deux lignes et annonce une hauteur qui
    // rentre toujours : on ne verrait jamais qu'il déborde, et un nom long
    // sortirait tronqué par des points de suspension au lieu de rétrécir.
    // On relâche la bride le temps de la mesure, puis on la remet.
    //
    // Et on vise DEUX LIGNES À LA TAILLE COURANTE, pas le "max-height" du CSS :
    // celui-ci vaut deux lignes à la taille de départ, donc presque trois une
    // fois le texte réduit — le nom aurait passé la mesure pour se faire
    // couper juste après par la bride.
    var LINES = 2;
    function fit(el) {
      if (!el) return;
      el.style.fontSize = '';
      var base = parseFloat(getComputedStyle(el).fontSize);
      if (!(base > 0)) return;
      var byWidth = el.getAttribute('data-fit') === 'width';
      if (!byWidth) el.style.webkitLineClamp = 'unset';

      var over = function () {
        if (byWidth) return el.scrollWidth > el.clientWidth + 1;
        var cs = getComputedStyle(el);
        var lh = parseFloat(cs.lineHeight);
        if (!(lh > 0)) lh = parseFloat(cs.fontSize) * 1.2;
        return el.scrollHeight > LINES * lh + 1;
      };

      var size = base, floor = base * 0.62, step = base * 0.04, guard = 0;
      while (over() && size > floor && guard++ < 40) {
        size -= step;
        el.style.fontSize = size + 'px';
      }
      if (!byWidth) el.style.webkitLineClamp = '';
    }
    function fitAll() {
      var nodes = sheets.querySelectorAll('[data-fit]');
      for (var i = 0; i < nodes.length; i++) fit(nodes[i]);
    }

    // ── Appliquer l'état : page, variables CSS, copies, avertissement ──────
    function apply() {
      var pw = state.rotate ? state.h : state.w;
      var ph = state.rotate ? state.w : state.h;

      // Une règle @page ne lit pas les variables CSS : on la réécrit.
      pageStyle.textContent = '@page{size:' + pw + 'mm ' + ph + 'mm;margin:0}';
      root.style.setProperty('--lw', state.w + 'mm');
      root.style.setProperty('--lh', state.h + 'mm');
      root.style.setProperty('--pw', pw + 'mm');
      root.style.setProperty('--ph', ph + 'mm');
      // L'aperçu tient dans ~340 px de large, quel que soit le rouleau.
      root.style.setProperty('--zoom', Math.max(1.5, Math.min(6, Math.round(900 / pw) / 10)));
      document.body.setAttribute('data-rotate', state.rotate ? '1' : '0');

      // Autant de pages que de copies, toutes identiques à la première.
      var first = sheets.firstElementChild;
      while (sheets.children.length > state.copies) sheets.removeChild(sheets.lastElementChild);
      while (sheets.children.length < state.copies) sheets.appendChild(first.cloneNode(true));

      document.getElementById('title').textContent =
        'Étiquette ' + state.w + ' × ' + state.h + ' mm' + (state.rotate ? ' — pivotée' : '');
      document.getElementById('meta').innerHTML =
        'Réglez l\\'imprimante sur <b>' + pw + ' × ' + ph + ' mm</b>, marges à <b>zéro</b>, '
        + 'échelle <b>100 %</b> (surtout pas « ajuster à la page »).<br>'
        + 'Si l\\'étiquette sort tournée d\\'un quart de tour, ou coupée sur le côté, '
        + 'cochez <b>Pivoter 90°</b>.';

      // Les barres sont-elles encore lisibles à cette largeur ?
      var warn = document.getElementById('warn');
      var mm = MODULES ? (state.w - state.w * PAD_X * 2) / MODULES : 0;
      if (mm > 0 && mm < MIN_MODULE) {
        warn.hidden = false;
        warn.textContent = 'Code très long : les barres ne font que ' + mm.toFixed(2)
          + ' mm de large sur ' + state.w + ' mm. Certaines douchettes peineront — '
          + 'un rouleau plus large, ou un code plus court, se lit mieux.';
      } else {
        warn.hidden = true;
      }

      fitAll();
    }

    // ── Les commandes ─────────────────────────────────────────────────────
    fmt.addEventListener('change', function () {
      var d = fmt.value.split('x');
      state.w = parseFloat(d[0]);
      state.h = parseFloat(d[1]);
      save(); apply();
    });
    rot.addEventListener('change', function () {
      state.rotate = rot.checked; save(); apply();
    });
    cop.addEventListener('change', function () {
      state.copies = Math.max(1, Math.min(50, parseInt(cop.value, 10) || 1));
      cop.value = state.copies; save(); apply();
    });

    // Un rouleau hors liste (format retenu d'une autre session) : on l'ajoute
    // au menu plutôt que de le perdre au premier affichage.
    function syncControls() {
      var want = state.w + 'x' + state.h;
      fmt.value = want;
      if (fmt.value !== want) {
        var o = document.createElement('option');
        o.value = want;
        o.textContent = state.w + ' × ' + state.h + ' mm';
        fmt.appendChild(o);
        fmt.value = want;
      }
      rot.checked = state.rotate;
      cop.value = state.copies;
    }

    syncControls();
    apply();

    // Les polices arrivent parfois après le premier calcul : on remesure une
    // fois qu'elles sont là, puis encore juste avant l'impression — sinon un
    // nom mesuré en police de secours déborde sur le papier.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
    window.addEventListener('beforeprint', fitAll);

    window.addEventListener('load', function () {
      fitAll();
      window.focus();
      window.print();
    });
  })();
  </script>
</body></html>`;
}
