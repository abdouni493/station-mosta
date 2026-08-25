/**
 * ─── L'ÉTIQUETTE CODE-BARRES, TAILLÉE POUR LE ROULEAU 40 × 20 mm ───────────────
 *
 * L'étiquette partait à l'imprimante SANS TAILLE DE PAGE. Le navigateur retombait
 * donc sur du A4 : une vignette perdue au milieu d'une feuille, à côté de la
 * plaque sur une étiqueteuse thermique, et le code-barres — dessiné en pixels
 * fixes, plus large que 40 mm — débordait de la vignette.
 *
 * Tout est repris ici, en MILLIMÈTRES :
 *
 *   • `@page { size: 40mm 20mm; margin: 0 }` — l'imprimante reçoit la bonne
 *     géométrie, l'étiquette occupe exactement sa vignette ;
 *   • le code-barres est tracé sans largeur figée : il s'étire à la largeur
 *     utile de l'étiquette, quel que soit le nombre de caractères ;
 *   • le nom du produit est en GRAS, sur deux lignes au plus, et sa taille
 *     descend d'elle-même jusqu'à tenir dans sa boîte ;
 *   • le prix est lisible de loin, sans les décimales quand elles valent zéro.
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
 * CSS lui donne. C'est ce qui le fait tenir dans 40 mm quel que soit le nombre
 * de caractères — un code à rallonge resserre ses barres au lieu de déborder.
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
 */
export function moduleWidthMm(text: string, size: LabelSize = LABEL_40_20, paddingMm = 1): number {
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

/**
 * La page d'impression complète.
 *
 * À l'écran elle montre l'étiquette AGRANDIE — une vignette de 40 × 20 mm est
 * illisible sur un moniteur — avec le bouton pour relancer l'impression si la
 * boîte de dialogue a été fermée par erreur. À l'imprimante, seule la vignette
 * sort, exactement à sa taille.
 */
export function barcodeLabelHTML(
  product: BarcodeLabelProduct,
  size: LabelSize = LABEL_40_20,
): string {
  const code = String(product.barcode ?? '').trim();
  const svg = barcodeLabelSVG(code);
  const name = escapeHtml(product.name || '');
  const price = escapeHtml(labelPrice(product.salePrice));
  const modMm = moduleWidthMm(code, size);
  const tooDense = modMm > 0 && modMm < MIN_MODULE_MM;
  const W = size.widthMm;
  const H = size.heightMm;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>Étiquette ${escapeHtml(code)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:#f1f5f9;font-family:Arial,Helvetica,sans-serif}

  /* ── La vignette : tout est en mm, rien ne dépend du zoom du navigateur ──
     Le budget vertical des 20 mm, dans le pire des cas (nom sur deux lignes) :
     marges 1,2 · nom 5,3 · code 2,3 · prix 4,0 · respiration 0,65 — il reste
     6,5 mm de barres. Un nom sur une seule ligne leur en rend 2,6 de plus.
     Toucher à une taille ci-dessous, c'est prendre sur la hauteur des barres. */
  .label{
    width:${W}mm;height:${H}mm;
    padding:0.6mm 1mm;
    background:#fff;color:#000;
    display:flex;flex-direction:column;align-items:stretch;
    overflow:hidden;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;
  }
  /* Le nom du produit : en gras, deux lignes au plus, jamais coupé en silence. */
  .name{
    font-weight:900;font-size:2.5mm;line-height:1.06;letter-spacing:-0.02mm;
    text-align:center;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
    overflow:hidden;overflow-wrap:anywhere;
  }
  /* Les barres prennent TOUT ce que le nom et le pied laissent. Le SVG est
     positionné en absolu : c'est la seule façon fiable de lui faire remplir
     une boîte dont la hauteur vient de flex-grow. */
  .bars{flex:1 1 auto;min-height:3mm;margin:0.4mm 0 0.25mm;position:relative}
  .bars svg{position:absolute;top:0;left:0;width:100%;height:100%;display:block}
  .code{
    font-family:'Courier New',Courier,monospace;font-weight:700;
    font-size:2.1mm;line-height:1.1;letter-spacing:0.25mm;text-align:center;
    white-space:nowrap;overflow:hidden;
  }
  .price{
    font-weight:900;font-size:3.2mm;line-height:1.15;text-align:center;
    margin-top:0.3mm;white-space:nowrap;overflow:hidden;
  }
  .empty{font-size:2.4mm;font-weight:700;text-align:center;padding-top:6mm}

  /* ── Écran : la vignette agrandie, pour vérifier avant d'imprimer ──────── */
  @media screen{
    body{padding:28px 16px;display:flex;flex-direction:column;align-items:center;gap:18px}
    h1{font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:#475569}
    .stage{
      width:calc(${W}mm * 4);height:calc(${H}mm * 4);
      box-shadow:0 10px 30px rgba(15,23,42,.18);border-radius:4px;background:#fff;
      overflow:hidden;
    }
    .stage .label{transform:scale(4);transform-origin:top left}
    .meta{font-size:12px;color:#64748b;text-align:center;line-height:1.6;max-width:44ch}
    .meta b{color:#0f172a}
    .warn{
      max-width:44ch;font-size:12px;line-height:1.5;text-align:center;font-weight:700;
      color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;
    }
    button{
      font:700 12px/1 Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.12em;
      padding:12px 22px;border-radius:10px;border:0;cursor:pointer;
      background:#001f5c;color:#FFB800;
    }
    button:hover{background:#003087}
  }

  /* ── Impression : la vignette, et rien d'autre ─────────────────────────── */
  @page{size:${W}mm ${H}mm;margin:0}
  @media print{
    html,body{width:${W}mm;height:${H}mm;background:#fff;padding:0}
    .screen-only{display:none!important}
    .stage{width:auto;height:auto;box-shadow:none;border-radius:0;overflow:visible}
    .stage .label{transform:none}
  }
</style></head>
<body>
  <h1 class="screen-only">Étiquette ${W} × ${H} mm</h1>

  <div class="stage">
    <div class="label" id="label">
      ${svg ? `
      <div class="name" id="name">${name || '&nbsp;'}</div>
      <div class="bars">${svg}</div>
      <div class="code">${escapeHtml(code)}</div>
      ${price ? `<div class="price" id="price">${price}</div>` : ''}`
      : `<div class="empty">Code-barres illisible</div>`}
    </div>
  </div>

  ${tooDense ? `<p class="warn screen-only">
    Code très long : les barres ne font que ${modMm.toFixed(2)} mm de large sur ${W} mm.
    Certaines douchettes peineront — un code plus court se lit mieux.
  </p>` : ''}

  <p class="meta screen-only">
    Réglez l'imprimante sur un format <b>${W} × ${H} mm</b>, marges à <b>zéro</b>,
    échelle <b>100 %</b> (pas « ajuster à la page »).
  </p>
  <button class="screen-only" onclick="window.print()">Imprimer l'étiquette</button>

  <script>
    // Le nom doit tenir dans ses deux lignes. Plutôt que de le rogner en
    // silence, on descend sa taille jusqu'à ce qu'il rentre — un nom long
    // reste lisible en entier, un nom court garde sa pleine taille.
    (function () {
      var fit = function (el, startMm, minMm) {
        if (!el) return;
        var mm = startMm;
        el.style.fontSize = mm + 'mm';
        while (mm > minMm && el.scrollHeight > el.clientHeight + 1) {
          mm = Math.round((mm - 0.1) * 10) / 10;
          el.style.fontSize = mm + 'mm';
        }
      };
      var fitWidth = function (el, startMm, minMm) {
        if (!el) return;
        var mm = startMm;
        el.style.fontSize = mm + 'mm';
        while (mm > minMm && el.scrollWidth > el.clientWidth + 1) {
          mm = Math.round((mm - 0.1) * 10) / 10;
          el.style.fontSize = mm + 'mm';
        }
      };
      window.addEventListener('load', function () {
        fit(document.getElementById('name'), 2.5, 1.7);
        fitWidth(document.getElementById('price'), 3.2, 2.1);
        window.focus();
        window.print();
      });
    })();
  </script>
</body></html>`;
}
