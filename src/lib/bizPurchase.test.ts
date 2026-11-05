/**
 * ─── Vérification de la saisie d'un bon d'achat ───────────────────────────────
 * Ce qu'une facture créée ou modifiée fait au stock. Se rejoue sans navigateur :
 *
 *   npx tsx src/lib/bizPurchase.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  validatePurchaseLines, purchaseStockChanges, nextPurchaseRef, newerProduct, receivePurchaseLine,
} from './bizPurchase';
import { BizLineItem, BizProduct } from './bizConfig';

let failed = 0;
let passed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}  → attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
}

const line = (productId: string, qty: any, unitPrice: any = 100, extra: Partial<BizLineItem> = {}): BizLineItem =>
  ({ productId, productName: productId, qty, unitPrice, ...extra });
const product = (id: string, currentQty: any, principalQty: any = currentQty, extra: Partial<BizProduct> = {}): BizProduct =>
  ({
    id, name: id, principalQty, currentQty, minQty: 1, purchasePrice: 50, salePrice: 80,
    createdAt: '2026-01-01', ...extra,
  } as BizProduct);

console.log('\nValidation des lignes');
check('facture vide refusée', validatePurchaseLines([]) !== null, true);
check('quantité 0 refusée', validatePurchaseLines([line('A', 0)]) !== null, true);
check('quantité vide refusée', validatePurchaseLines([line('A', '')]) !== null, true);
check('quantité négative refusée', validatePurchaseLines([line('A', -2)]) !== null, true);
check('prix négatif refusé', validatePurchaseLines([line('A', 2, -1)]) !== null, true);
check('produit en double refusé', validatePurchaseLines([line('A', 1), line('A', 2)]) !== null, true);
check('facture correcte acceptée', validatePurchaseLines([line('A', 2.5), line('B', 1, 0)]), null);

console.log('\nCréation : chaque produit reçoit sa quantité');
{
  const d = purchaseStockChanges(null, [line('A', 10), line('B', 3)]);
  check('A +10', d.get('A'), 10);
  check('B +3', d.get('B'), 3);
}

console.log('\nModification : seule la différence s\'applique');
{
  const before = [line('A', 10), line('B', 3), line('C', 4)];
  const after = [line('A', 12), line('B', 3), line('D', 5)];
  const d = purchaseStockChanges(before, after);
  check('A corrigé 10 → 12 : +2', d.get('A'), 2);
  check('B inchangé : rien', d.has('B'), false);
  check('C retiré : −4', d.get('C'), -4);
  check('D ajouté : +5', d.get('D'), 5);
}

console.log('\nRéception sur la fiche');
{
  const p = receivePurchaseLine(product('A', 4, 20), { qtyDelta: 10, line: line('A', 10, 120, { salePrice: 150, minQty: 3 }) });
  check('stock 4 + 10 = 14', p.currentQty, 14);
  check('cumul reçu 20 + 10 = 30', p.principalQty, 30);
  check('prix d\'achat = dernier prix', p.purchasePrice, 120);
  check('prix de vente reporté', p.salePrice, 150);
  check('seuil reporté', p.minQty, 3);
}
{
  // Une fiche abîmée (stock en texte) ne doit plus CONCATÉNER : « 5 » + 3 ≠ « 53 ».
  const p = receivePurchaseLine(product('A', '5' as any, '5' as any), { qtyDelta: 3, line: line('A', 3) });
  check('stock texte « 5 » + 3 = 8', p.currentQty, 8);
  check('cumul texte « 5 » + 3 = 8', p.principalQty, 8);
}
{
  const p = receivePurchaseLine(product('A', 2, 5), { qtyDelta: -4 });
  check('ligne retirée : stock 2 − 4 = −2', p.currentQty, -2);
  check('cumul reçu ne descend pas sous 0', p.principalQty, 1);
  check('sans ligne : prix inchangé', p.purchasePrice, 50);
}
{
  const p = receivePurchaseLine(product('A', 10), { qtyDelta: 10, line: line('A', 10, 130), avgCost: 115 });
  check('coût moyen : coût de revient = CUMP', p.purchasePrice, 115);
  check('coût moyen : averageCost', p.averageCost, 115);
  check('coût moyen : dernier prix payé conservé', p.lastPurchasePrice, 130);
}
{
  const p = receivePurchaseLine(product('A', 10, 10, { averageCost: 90, purchasePrice: 90 }),
    { qtyDelta: 0, line: line('A', 10, 130), keepCost: true });
  check('facture au CUMP modifiée : coût de revient gardé', p.purchasePrice, 90);
  check('facture au CUMP modifiée : CUMP gardé', p.averageCost, 90);
}

console.log('\nFiche la plus fraîche');
{
  const local = product('A', 10, 10, { _upd: '2026-11-05T10:00:00.000Z' } as any);
  const remote = product('A', 7, 10, { _upd: '2026-11-05T10:05:00.000Z' } as any);
  check('vente faite ailleurs depuis : la base gagne', newerProduct(local, remote)?.currentQty, 7);
  check('écran plus récent : l\'écran gagne', newerProduct(remote, local)?.currentQty, 7);
  check('pas de copie en base : l\'écran', newerProduct(local, undefined)?.currentQty, 10);
}

console.log('\nNuméro de facture');
check('premier achat', nextPurchaseRef([]), 'A-0001');
check('après une suppression, pas de doublon', nextPurchaseRef([{ ref: 'A-0001' }, { ref: 'A-0003' }]), 'A-0004');
check('numéros libres ignorés', nextPurchaseRef([{ ref: 'FAC-9' }, { ref: 'A-0002' }]), 'A-0003');

console.log(`\n${passed} réussi(s), ${failed} échoué(s)\n`);
if (failed) throw new Error(`${failed} vérification(s) en échec`);
