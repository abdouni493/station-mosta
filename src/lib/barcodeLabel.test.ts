/**
 * ─── Ce que ces cas protègent ─────────────────────────────────────────────────
 *
 * L'étiquette d'un produit part sur un rouleau de 40 × 20 mm. Deux façons de la
 * rater, toutes deux invisibles tant qu'on n'a pas gâché une bobine :
 *
 *   1. la page n'annonce pas sa taille — le navigateur imprime en A4 et la
 *      vignette sort minuscule au milieu d'une feuille ;
 *   2. le symbole est correct « en théorie » mais illisible en pratique, parce
 *      que ses barres, écrasées sur 40 mm, tombent sous ce qu'une douchette
 *      sait distinguer.
 *
 * Le cœur du fichier est un DÉCODEUR : il relit le symbole produit et
 * reconstitue le texte, exactement comme une douchette. C'est la seule preuve
 * sérieuse que la bascule jeu B / jeu C — celle qui fait tenir treize chiffres
 * dans 40 mm — encode bien ce qu'on croit, et pas un code voisin qui scannerait
 * faux au comptoir.
 *
 *   npx tsx src/lib/barcodeLabel.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  code128Values, code128Widths, barcodeSVG, barcodeLabelSVG,
  moduleWidthMm, labelPrice, barcodeLabelHTML, MIN_MODULE_MM,
} from './barcodeLabel';

let passed = 0, failed = 0;
const check = (label: string, got: any, want: any) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n      attendu ${JSON.stringify(want)}\n      obtenu  ${JSON.stringify(got)}`); }
};
const ok = (label: string, got: boolean) => check(label, got, true);

// ─── Le décodeur, côté douchette ──────────────────────────────────────────────
/**
 * Rejoue le symbole comme le ferait un lecteur : contrôle de la somme, puis
 * lecture des valeurs en suivant les bascules de jeu. Rend `null` si le symbole
 * ne tient pas debout.
 */
function decode(text: string): string | null {
  const codes = code128Values(text);
  if (!codes) return null;

  const stop = codes.pop();
  if (stop !== 106) return null;                       // le symbole d'arrêt

  const control = codes.pop()!;
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  if (sum % 103 !== control) return null;              // somme de contrôle

  const start = codes.shift()!;
  if (start !== 104 && start !== 105) return null;     // départ jeu B ou jeu C
  let mode: 'B' | 'C' = start === 104 ? 'B' : 'C';

  let out = '';
  for (const v of codes) {
    if (v === 99) { mode = 'C'; continue; }            // bascule vers le jeu C
    if (v === 100) { mode = 'B'; continue; }           // bascule vers le jeu B
    if (mode === 'C') {
      if (v < 0 || v > 99) return null;
      out += String(v).padStart(2, '0');               // deux chiffres d'un coup
    } else {
      if (v < 0 || v > 94) return null;
      out += String.fromCharCode(v + 32);
    }
  }
  return out;
}

// ─── L'encodage ───────────────────────────────────────────────────────────────
console.log('\n── Le symbole se relit à l\'identique ──');
for (const sample of [
  'A', 'AB', 'Wikipedia', '6130000123456', '12345678', '1234567', '123',
  'REF-42', 'ABC123456DEF', '00', '9', 'X1Y2Z3', 'A12B34C56',
]) check(`« ${sample} »`, decode(sample), sample);

check('les caractères non encodables sont écartés avant l\'encodage',
  decode('Café 1L'), 'Caf 1L');

console.log('\n── La somme de contrôle et les jeux ──');
// « Wikipedia » est l'exemple de référence de la norme : contrôle = 88.
check('le contrôle de « Wikipedia » vaut 88', code128Values('Wikipedia')!.slice(-2)[0], 88);
check('un texte se lit en jeu B', code128Values('Wikipedia')![0], 104);
check('un code tout en chiffres démarre en jeu C', code128Values('6130000123456')![0], 105);
check('trois chiffres seuls ne valent pas la bascule', code128Values('123')![0], 104);
check('quatre chiffres, si', code128Values('1234')![0], 105);

console.log('\n── Les largeurs de barres ──');
const CODE = '6130000123456';                     // ce que `genBarcode` produit
const bars = code128Widths(CODE)!;
check('autant de trames que de symboles',
  bars.widths.length, (code128Values(CODE)!.length - 1) * 6 + 7);
check('le compte de modules suit la norme',
  bars.modules, bars.widths.reduce((s, w) => s + w, 0) + 20);
check('treize chiffres pèsent 143 modules, zones de silence comprises', bars.modules, 143);
ok('le jeu C allège vraiment : treize lettres pèsent plus lourd',
  bars.modules < code128Widths('ABCDEFGHIJKLM')!.modules);
check('un texte sans rien d\'encodable ne rend pas de symbole', code128Widths('éé'), null);
check('une chaîne vide non plus', code128Widths(''), null);

console.log('\n── La lisibilité sur 40 mm ──');
ok(`les barres du code station font ${moduleWidthMm(CODE).toFixed(3)} mm`,
  moduleWidthMm(CODE) >= MIN_MODULE_MM);
ok('un code plus court reste confortable', moduleWidthMm('61300001') >= MIN_MODULE_MM);
ok('une étiquette plus large donne des barres plus larges',
  moduleWidthMm(CODE, { widthMm: 58, heightMm: 30 }) > moduleWidthMm(CODE));

console.log('\n── Le prix tel qu\'il se lit sur la vignette ──');
check('un prix rond perd ses décimales', labelPrice(250), '250 DA');
check('un prix à virgule les garde', labelPrice(249.5), '249,50 DA');
check('pas de prix, pas de ligne', labelPrice(0), '');
check('un prix absent non plus', labelPrice(undefined), '');
check('un prix aberrant est ignoré', labelPrice(NaN), '');

console.log('\n── La page d\'impression ──');
const html = barcodeLabelHTML({ name: 'Huile moteur 5W40', barcode: CODE, salePrice: 2400 });
ok('la page annonce le format du rouleau', html.includes('@page{size:40mm 20mm;margin:0}'));
ok('la vignette fait exactement 40 × 20 mm', html.includes('width:40mm;height:20mm'));
ok('le nom du produit est en gras', /\.name\{[^}]*font-weight:900/.test(html));
ok('le nom apparaît sur l\'étiquette', html.includes('Huile moteur 5W40'));
ok('le code humain est imprimé sous les barres', html.includes(`>${CODE}<`));
ok('le prix est là, sans décimales inutiles', /2\s?400 DA/.test(html));
ok('les barres s\'étirent à la largeur utile', html.includes('preserveAspectRatio="none"'));
ok('l\'aperçu et les consignes ne partent pas à l\'imprimante',
  html.includes('.screen-only{display:none!important}'));
ok('rien ne déborde de la vignette', /\.label\{[^}]*overflow:hidden/.test(html));
ok('un nom à rallonge est borné à deux lignes', html.includes('-webkit-line-clamp:2'));

const noPrice = barcodeLabelHTML({ name: 'Sans prix', barcode: CODE });
ok('sans prix, la ligne disparaît et les barres respirent', !noPrice.includes('class="price"'));

const nasty = barcodeLabelHTML({ name: '<script>alert(1)</script>', barcode: CODE });
ok('un nom mal intentionné est échappé', !nasty.includes('<script>alert(1)'));

console.log('\n── Le SVG ──');
ok('le SVG d\'étiquette n\'impose aucune largeur',
  !/^<svg[^>]*\swidth="/.test(barcodeLabelSVG(CODE)));
ok('le SVG à taille fixe, lui, porte sa largeur',
  /^<svg[^>]*\swidth="\d/.test(barcodeSVG(CODE)));
check('un code vide ne rend rien', barcodeLabelSVG(''), '');
ok('les barres sont dessinées en noir', barcodeLabelSVG(CODE).includes('<g fill="#000">'));
ok('la zone de silence est réservée à gauche', barcodeLabelSVG(CODE).includes('<rect x="10"'));

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} réussis, ${failed} échoués\n`);
process.exit(failed === 0 ? 0 : 1);
