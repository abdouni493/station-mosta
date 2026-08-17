/**
 * ─── Vérification du compte client ─────────────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun a réellement vidé l'écran Clients :
 *
 *   • la consommation d'un client vit dans les JUSTIFICATIONS des brigades, pas
 *     dans `fuel_sales` — table que plus rien n'alimente. L'historique lisait
 *     cette table morte et n'affichait donc jamais rien ;
 *   • les ventes magasin étaient filtrées sur `paymentMode === client.id`, une
 *     comparaison entre un mode de paiement et un identifiant : toujours fausse ;
 *   • un bon pris sur l'AVANCE ne crée aucune dette, un bon à CRÉDIT si — les
 *     confondre faisait réclamer deux fois le même argent ;
 *   • une recharge d'avance est de l'argent remis : elle doit monter la caisse.
 *
 *   npx tsx src/lib/clientLedger.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { clientLedger } from './clientLedger';
import { computeCarburantCash } from './carburantSales';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

/**
 * Un client à crédit qui a pris deux bons sur des brigades, une facture magasin
 * partiellement réglée, et qui a versé 4 000 DA. Un second client, lui, paie sur
 * son avance : ses bons ne créent aucune dette.
 */
const app = {
  clients: [
    {
      id: 'CL1', name: 'Transport SARL', debt: 9_000, balance: 0, advanceBalance: 0,
      transactionHistory: [
        { id: 'TX1', date: '2026-08-20', type: 'PAYMENT', amount: 3_000, mode: 'ESPECES' },
        { id: 'TX2', date: '2026-08-21', type: 'PAYMENT', amount: 1_000, mode: 'CHEQUE' },
      ],
    },
    {
      id: 'CL2', name: 'Ecole Ibn Badis', debt: 0, balance: 20_000, advanceBalance: 20_000,
      transactionHistory: [
        { id: 'TX3', date: '2026-08-01', type: 'RECHARGE', amount: 20_000, mode: 'ESPECES' },
      ],
    },
  ],
  brigades: [
    { id: 'BR1', date: '2026-08-10', startDatetime: '2026-08-10T06:00:00.000Z', shift: 'Matin' },
    { id: 'BR2', date: '2026-08-12', startDatetime: '2026-08-12T06:00:00.000Z', shift: 'Soir' },
  ],
  brigadeAccountings: [
    {
      id: 'A1', brigadeId: 'BR1',
      justifications: [
        { id: 'J1', justificationType: 'CLIENT', paymentMode: 'CREDIT', clientId: 'CL1', amount: 6_000, fuelType: 'GASOIL', liters: 133, pricePerLiter: 45 },
        { id: 'J2', justificationType: 'CLIENT', paymentMode: 'AVANCE', clientId: 'CL2', amount: 5_000, fuelType: 'ESSENCE', liters: 100, pricePerLiter: 50 },
        // TAG / TPE : ce ne sont pas des clients du fichier, ils ne doivent
        // jamais atterrir dans le compte de quiconque.
        { id: 'J3', justificationType: 'TPE', amount: 12_000, clientName: 'Passage' },
      ],
    },
    {
      id: 'A2', brigadeId: 'BR2',
      justifications: [
        { id: 'J4', justificationType: 'CLIENT', paymentMode: 'CREDIT', clientId: 'CL1', amount: 4_000, fuelType: 'GASOIL', liters: 89, pricePerLiter: 45 },
      ],
    },
  ],
  // Une facture magasin de 3 000 DA dont 1 000 restent dus.
  shopSales: [
    { id: 'SH1', date: '2026-08-15', clientId: 'CL1', total: 3_000, amountPaid: 2_000, rest: 1_000, paymentMode: 'CREDIT', items: [{ productName: 'Huile', quantity: 2, price: 1_500 }] },
    // Une vente réglée au comptant par quelqu'un d'autre : elle n'appartient
    // à aucun compte client.
    { id: 'SH2', date: '2026-08-16', total: 800, amountPaid: 800, rest: 0, paymentMode: 'ESPECES', items: [] },
  ],
  fuelSales: [],
  expenses: [], purchases: [], suppliers: [], treasuryTransactions: [],
  pompistes: [], brigadeChefs: [], gerants: [], magasinWorkers: [],
};

console.log('\nLe compte d\'un client à crédit');
const cl1 = clientLedger(app, 'CL1');
check('toutes ses opérations sont là', cl1.entries.length, 5);
check('deux bons carburant', cl1.counts.bons, 2);
check('une facture magasin', cl1.counts.magasin, 1);
check('deux règlements', cl1.counts.reglements, 2);
check('consommation totale (6 000 + 4 000 + 3 000)', cl1.charged, 13_000);
check('dont à crédit (les bons + le reste dû du magasin)', cl1.chargedOnCredit, 11_000);
check('rien pris sur une avance', cl1.chargedOnAdvance, 0);
check('réglé (les deux modes comptent comme règlement)', cl1.paid, 4_000);
check('dette d\'après les pièces', cl1.debtFromDocuments, 7_000);
check('le TAG/TPE n\'entre dans aucun compte',
  cl1.entries.some(e => e.id.includes('J3')), false);
check('la vente magasin sans client non plus',
  cl1.entries.some(e => e.id === 'shop-SH2'), false);
check('les lignes sont triées du plus récent au plus ancien',
  cl1.entries.map(e => e.date.slice(0, 10)),
  ['2026-08-21', '2026-08-20', '2026-08-15', '2026-08-12', '2026-08-10']);

console.log('\nUn bon pris sur l\'avance ne crée aucune dette');
const cl2 = clientLedger(app, 'CL2');
check('un bon et une recharge', cl2.entries.length, 2);
check('consommation', cl2.charged, 5_000);
check('aucune dette créée', cl2.chargedOnCredit, 0);
check('consommé sur son avance', cl2.chargedOnAdvance, 5_000);
check('rechargé', cl2.recharged, 20_000);
check('avance restante (20 000 − 5 000)', cl2.advanceFromDocuments, 15_000);
check('un règlement de dette n\'est pas une recharge', cl2.paid, 0);

console.log('\nUn client sans aucune opération');
check('journal vide, pas d\'erreur', clientLedger(app, 'INCONNU').entries.length, 0);

console.log('\nL\'argent remis par les clients entre en caisse');
const cash = computeCarburantCash(app);
// 3 000 réglés en espèces + 20 000 rechargés en espèces. Le règlement par
// chèque atterrit en banque et ne touche pas le tiroir.
check('règlements de dette en espèces', cash.clientCash, 3_000);
check('recharges d\'avance en espèces', cash.rechargeCash, 20_000);
check('le règlement par chèque reste en dehors',
  cash.lines.some(l => l.id === 'cli-TX2'), false);
check('solde de la caisse Carburant', cash.balance, 23_000);
check('chaque ligne se relit', cash.lines.reduce((s, l) => s + l.amount, 0), cash.balance);

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
