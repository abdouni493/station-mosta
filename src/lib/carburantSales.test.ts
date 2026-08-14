/**
 * ─── Vérification de l'activité Carburant ──────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun a réellement faussé l'application :
 *
 *   • la recette du carburant était lue dans `fuel_sales`, une table que plus
 *     aucun écran n'écrit : la vente à la pompe comptait pour ZÉRO dinar pendant
 *     que les achats, eux, comptaient pour leur montant entier — d'où le
 *     « Solde caisse −973 867,40 DA » ;
 *   • le solde de caisse retranchait le montant payé de CHAQUE achat, chèques et
 *     virements compris : de l'argent jamais passé par le tiroir creusait un
 *     découvert imaginaire ;
 *   • un règlement client en espèces n'entrait nulle part ;
 *   • le détail par carburant doit additionner EXACTEMENT le chiffre d'affaires
 *     affiché, sinon la carte « CA » et le tableau « ventes par produit » se
 *     contredisent à l'écran.
 *
 *   npx tsx src/lib/carburantSales.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { computeCarburantSales, computeCarburantCash, derivedPumpStats } from './carburantSales';
import { computeCarburantReport } from './bizReporting';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

const FROM = '2026-08-01', TO = '2026-08-31';

/**
 * Une station d'une brigade : 1 000 L de gasoil à 45 DA et 500 L d'essence à
 * 50 DA, soit 70 000 DA facturés. Le pompiste a rendu 50 000 DA en espèces,
 * 12 000 DA sont passés au TPE, 6 000 DA sont partis en bon client, et il
 * manque 2 000 DA.
 */
const app = {
  settings: {
    fuelPrices: { GASOIL: 45, ESSENCE: 50 },
    fuelBuyPrices: { GASOIL: 40, ESSENCE: 44 },
  },
  tanks: [
    { id: 'T1', name: 'Cuve 1', type: 'GASOIL', current: 10_000 },
    { id: 'T2', name: 'Cuve 2', type: 'ESSENCE', current: 4_000 },
  ],
  pumps: [{ id: 'P1', name: 'Pompe 1' }, { id: 'P2', name: 'Pompe 2' }],
  pumpNozzles: [],
  pompistes: [{ id: 'PO1', name: 'Ali' }],
  brigadeChefs: [{ id: 'C1', name: 'Karim' }],
  brigades: [{
    id: 'BR1', date: '2026-08-10', startDatetime: '2026-08-10T06:00:00.000Z',
    shift: 'Matin', chefId: 'C1', status: 'Clôturée',
  }],
  brigadeAccountings: [{
    id: 'A1', brigadeId: 'BR1', status: 'completed',
    totalDue: 70_000, cashReceived: 50_000, rest: 2_000,
    nozzleSummary: [
      { nozzleId: 'N1', pumpId: 'P1', pumpName: 'Pompe 1', fuelType: 'GASOIL', liters: 1_000, price: 45, revenue: 45_000 },
      { nozzleId: 'N2', pumpId: 'P2', pumpName: 'Pompe 2', fuelType: 'ESSENCE', liters: 500, price: 50, revenue: 25_000 },
    ],
    pompisteSummary: {
      PO1: { theoretical: 70_000, cashReceived: 50_000, justifTotal: 18_000, ecart: 2_000, litersSold: 1_500 },
    },
    justifications: [
      { id: 'J1', justificationType: 'TPE', amount: 12_000, bankAccountId: 'B1' },
      { id: 'J2', justificationType: 'CLIENT', amount: 6_000, clientId: 'CL1' },
    ],
  }],
  // Un achat de 100 000 DA : 30 000 réglés en espèces, 70 000 par chèque.
  purchases: [{
    id: 'PU1', date: '2026-08-12', supplierId: 'S1', invoiceNumber: 'F-1',
    total: 100_000, amountPaid: 100_000, rest: 0,
    items: [{ tankId: 'T1', productName: 'Gasoil', quantity: 2_500, buyPrice: 40, total: 100_000 }],
    payments: [
      { id: 'PY1', date: '2026-08-12', amount: 30_000, mode: 'ESPECES', accountId: 'CAISSE' },
      { id: 'PY2', date: '2026-08-12', amount: 70_000, mode: 'CHEQUE', accountId: 'B1' },
    ],
  }],
  // Une dépense en espèces, une autre payée par la banque.
  expenses: [
    { id: 'E1', date: '2026-08-15', amount: 5_000, category: 'Entretien', accountId: 'CAISSE' },
    { id: 'E2', date: '2026-08-16', amount: 8_000, category: 'Loyer', accountId: 'B1' },
  ],
  clients: [{
    id: 'CL1', name: 'Transport SARL', debt: 6_000,
    transactionHistory: [
      { id: 'TX1', date: '2026-08-20', type: 'PAYMENT', amount: 3_000, mode: 'ESPECES' },
      { id: 'TX2', date: '2026-08-21', type: 'PAYMENT', amount: 1_000, mode: 'CHEQUE' },
    ],
  }],
  suppliers: [{ id: 'S1', name: 'Naftal' }],
  bankAccounts: [{ id: 'B1', name: 'BNA', initialBalance: 0 }],
  shopSales: [],
  products: [],
  treasuryTransactions: [
    // 10 000 DA de la caisse Carburant versés en banque.
    { id: 'T5', date: '2026-08-25', kind: 'TRANSFER', amount: 10_000, accountFrom: 'CAISSE_CARBURANT', accountTo: 'B1', part: 'carburant' },
  ],
  pompisteDecalage: [],
};

console.log('\nLes brigades SONT la vente de carburant');
const sales = computeCarburantSales(app, FROM, TO);
check('une brigade sur la période', sales.counts.brigades, 1);
check("chiffre d'affaires", sales.revenue, 70_000);
check('litres vendus', sales.liters, 1_500);
check('coût des litres (1000×40 + 500×44)', sales.cost, 62_000);
check('espèces remises', sales.cash, 50_000);
check('TPE encaissé', sales.tpe, 12_000);
check('bons clients', sales.credit, 6_000);
check('manquant', sales.rest, 2_000);
check('encaissé = espèces + TPE', sales.collected, 62_000);

console.log('\nLe détail par carburant rend EXACTEMENT le total');
check('deux carburants', sales.byFuel.length, 2);
check('la somme des carburants = le CA',
  sales.byFuel.reduce((s, f) => s + f.revenue, 0), sales.revenue);
check('la somme des litres = le volume',
  sales.byFuel.reduce((s, f) => s + f.liters, 0), sales.liters);
check('gasoil : 1000 L à 45 DA', sales.byFuel.find(f => f.type === 'GASOIL')?.revenue, 45_000);

console.log('\nChaque pompe porte ses propres litres');
const perPump = derivedPumpStats(app, FROM, TO);
check('Pompe 1 — 1 000 L', perPump.P1?.liters, 1_000);
check('Pompe 2 — 500 L', perPump.P2?.liters, 500);

console.log('\nLa caisse ne compte que les ESPÈCES');
const cash = computeCarburantCash(app);
// 50 000 encaissés + 3 000 réglés en espèces par le client
// − 30 000 d'achat en espèces − 5 000 de dépense en espèces − 10 000 virés.
check('solde de la caisse Carburant', cash.balance, 8_000);
check('espèces des brigades', cash.brigadeCash, 50_000);
check('règlements clients en espèces (le chèque est exclu)', cash.clientCash, 3_000);
check("l'achat réglé par chèque ne vide pas le tiroir", cash.purchasesCash, 30_000);
check('la dépense payée en banque non plus', cash.expensesCash, 5_000);
check('le virement vide bien la caisse', cash.transfers, -10_000);
check('entrées − sorties = solde', cash.inflow - cash.outflow, cash.balance);

console.log('\nLe rapport Carburant part des mêmes chiffres');
const r = computeCarburantReport(app, FROM, TO);
check("chiffre d'affaires du rapport", r.salesTotal, 70_000);
check('ventes encaissées', r.salesPaid, 62_000);
check('coût des marchandises vendues', r.cogs, 62_000);
check('marge brute', r.grossMargin, 8_000);
check('dépenses de la période', r.expensesTotal, 13_000);
check('gain net = marge − dépenses − salaires', r.netGain, 8_000 - 13_000);
check('le solde de caisse est CELUI de la Caisse Générale', r.caisseBalance, cash.balance);
check('une vente listée par brigade', r.counts.sales, 1);
check('le stock compte les CUVES (10 000×40 + 4 000×44)', r.stockValue, 576_000);
check('le solde se relit ligne à ligne',
  r.caisseMovements.reduce((s, m) => s + m.amount, 0), r.caisseBalance);

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
