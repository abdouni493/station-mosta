/**
 * ─── Vérification du fonds de roulement ────────────────────────────────────────
 * Ce que ces cas protègent, parce que chacun a réellement faussé l'écran :
 *
 *   • la TRÉSORERIE d'une activité, ce sont SES espèces. L'écran ne comptait que
 *     le tiroir commun du grand livre, rattaché à la Finance : filtré sur le
 *     Carburant, il annonçait « Trésorerie 0,00 DA » pendant que la Caisse
 *     Générale montrait 1,9 million dans ce même tiroir ;
 *   • le solde du tiroir COMMUN n'est pas ce que la station détient — l'argent
 *     que les activités y ont déposé est déjà compté dans leur caisse. Le
 *     reprendre en entier gonflait le fonds de roulement (et l'assiette de la
 *     zakât, qui lit le même chiffre) de tout ce que les caisses portaient déjà ;
 *   • les flux affichés sous un solde sont ceux des lignes RETENUES : filtré sur
 *     une activité, le bloc reprenait les encaissements de toute la station ;
 *   • « hors période + entrées − sorties = solde » doit tomber juste quelles que
 *     soient les dates — un mouvement postérieur à la période compte dans le
 *     solde sans compter dans les flux ;
 *   • le tableau par activité doit recomposer le total affiché en haut : sans la
 *     ligne Finance (tiroir commun restant + comptes bancaires), il en manquait
 *     une part que rien n'expliquait.
 *
 *   npx tsx src/lib/workingCapital.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { computeTreasuryReport, CAISSE_ID, CAISSE_PART_ID } from './treasuryReporting';
import { computeCarburantReport, computeModuleReport, moduleCaisseBalance, PartReport } from './bizReporting';
import { computeCarburantCash } from './carburantSales';
import { computeWorkingCapital, filterWorkingCapital, WCBlock } from './workingCapital';
import { emptyBizState } from './bizSeed';
import { BizState } from './bizConfig';

let passed = 0, failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = typeof actual === 'number' && typeof expected === 'number'
    ? Math.abs(actual - expected) < 0.0001
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`); }
};

const FROM = '2026-08-01', TO = '2026-08-31';

// ─── Une station complète : trois activités, un compte, un grand livre ───────
const biz: BizState = emptyBizState();
biz.cafeteria.caisse.push(
  { id: 'c1', date: '2026-08-04T10:00:00.000Z', type: 'deposit', amount: 4000, description: 'Recette du jour' } as any,
  { id: 'c2', date: '2026-08-09T10:00:00.000Z', type: 'withdraw', amount: 1500, description: 'Retrait' } as any,
);
biz.lavage.caisse.push(
  { id: 'l1', date: '2026-07-15T10:00:00.000Z', type: 'deposit', amount: 900, description: 'Avant la période' } as any,
);

const app = {
  bankAccounts: [{ id: 'B1', name: 'BNA', initialBalance: 1000 }],
  treasuryTransactions: [
    // Avant la période — sans partie : c'est le tiroir de la Finance.
    { id: 't4', date: '2026-07-20T09:00:00.000Z', kind: 'DEPOSIT', amount: 2000, accountTo: CAISSE_ID, part: 'systeme' },
    // Pendant la période — imputées au Carburant : elles font le tiroir commun
    // sans appartenir à la Finance.
    { id: 't1', date: '2026-08-05T18:00:00.000Z', kind: 'BRIGADE', amount: 5000, accountTo: CAISSE_ID, part: 'carburant', refType: 'brigade', refId: 'br1' },
    { id: 't2', date: '2026-08-06T10:00:00.000Z', kind: 'PURCHASE', amount: 8000, accountFrom: CAISSE_ID, part: 'carburant', refType: 'purchase', refId: 'p1' },
    { id: 't5', date: '2026-08-08T10:00:00.000Z', kind: 'TRANSFER', amount: 1000, accountFrom: CAISSE_PART_ID.carburant, accountTo: 'B1', part: 'carburant' },
    // APRÈS la période — dans le solde, hors des flux.
    { id: 't6', date: '2026-09-10T10:00:00.000Z', kind: 'WITHDRAW', amount: 300, accountFrom: CAISSE_ID, part: 'systeme' },
  ],
  purchases: [{ id: 'p1', date: '2026-08-06T10:00:00.000Z', amountPaid: 8000, supplierId: 's1', totalAmount: 8000 }],
  expenses: [],
  suppliers: [{ id: 's1', name: 'Naftal' }],
  clients: [],
  brigades: [{ id: 'br1', date: '2026-08-05T06:00:00.000Z', shift: 'Matin' }],
  brigadeAccountings: [{ id: 'a1', brigadeId: 'br1', cashReceived: 5000 }],
  tanks: [], pumps: [], pumpNozzles: [], settings: {},
};

const treasury = computeTreasuryReport(app, biz, FROM, TO);
const parts: PartReport[] = [
  computeCarburantReport(app, FROM, TO),
  computeModuleReport(biz.cafeteria, 'cafeteria', FROM, TO, app.treasuryTransactions, app.expenses),
  computeModuleReport(biz.lavage, 'lavage', FROM, TO, app.treasuryTransactions, app.expenses),
];
const r = computeWorkingCapital(treasury, parts);

// ─── La trésorerie, ce sont les caisses des activités ET la Finance ──────────
console.log('\nLes caisses comptées sont celles de la Caisse Générale');
const carburantCash = computeCarburantCash(app).balance;      // 5000 − 8000 − 1000
const cafeteriaCash = moduleCaisseBalance(biz.cafeteria, 'cafeteria', app.treasuryTransactions, app.expenses);
const lavageCash = moduleCaisseBalance(biz.lavage, 'lavage', app.treasuryTransactions, app.expenses);
check('caisse Carburant', carburantCash, -4000);
check('caisse Cafétéria', cafeteriaCash, 2500);
check('caisse Lavage', lavageCash, 900);
// Le tiroir de la Finance : les seules lignes du grand livre sans activité.
check('caisse Finance (2000 déposés − 300 retirés)', r.financeCash, 1700);
check('caisses des activités', r.activitiesCash, carburantCash + cafeteriaCash + lavageCash);
check('toutes les caisses', r.cashTotal, carburantCash + cafeteriaCash + lavageCash + 1700);

console.log('\nLe tiroir COMMUN n\'est pas ce que la station détient');
// 2000 + 5000 − 8000 − 300 : il ignore les 1000 virés depuis le coffre du
// Carburant, et porte les 5000 de la brigade que la caisse Carburant compte déjà.
check('tiroir commun au grand livre', r.drawerCash, -1300);
check('il n\'est pas repris dans le total', r.cashTotal === r.drawerCash, false);
check('une ligne par tiroir, toutes comptées', r.cash.rows.length, 4);
check('aucune ligne de trésorerie hors total', r.cash.rows.filter(x => x.informational).length, 0);

// ─── Le calcul se relit sous chaque solde ────────────────────────────────────
console.log('\nHors période + entrées − sorties = solde');
const reads = (b: WCBlock) => !b.flow || Math.abs(b.flow.outside + b.flow.in - b.flow.out - b.total) < 0.0001;
check('bloc des caisses', reads(r.cash), true);
check('bloc des banques', reads(r.banks), true);
// Le retrait de 300 est POSTÉRIEUR à la période : il pèse sur le solde sans
// entrer dans les flux. C'est « hors période » qui le porte.
const finance = r.cash.rows.find(x => x.id === 'caisse-finance');
check('les 2000 d\'avant et les 300 d\'après sont hors période', finance?.flow?.outside, 1700);
check('aucun mouvement de la Finance dans la période', finance?.flow?.count, 0);

// ─── Le filtre par activité ──────────────────────────────────────────────────
console.log('\nFiltré sur une activité, l\'écran montre SA trésorerie');
const carb = filterWorkingCapital(r, 'carburant');
check('la caisse de l\'activité est comptée', carb.cashTotal, carburantCash);
check('aucun compte bancaire ne lui est rattaché', carb.bankTotal, 0);
check('sa trésorerie est celle de son tiroir', carb.treasuryTotal, carburantCash);
check('une seule ligne de caisse', carb.cash.rows.length, 1);
check('ses flux sont les siens', carb.cash.flow?.in, 5000);
check('et pas ceux de la station', carb.cash.flow?.in === r.cash.flow?.in, false);
check('le calcul se relit encore', reads(carb.cash), true);

const caf = filterWorkingCapital(r, 'cafeteria');
check('caisse Cafétéria filtrée', caf.cashTotal, cafeteriaCash);
check('entrées de la Cafétéria sur la période', caf.cash.flow?.in, 4000);
check('sorties de la Cafétéria sur la période', caf.cash.flow?.out, 1500);

const lav = filterWorkingCapital(r, 'lavage');
check('caisse Lavage filtrée', lav.cashTotal, lavageCash);
// Le dépôt est de juillet : rien dans la période, tout « hors période ».
check('le solde du Lavage vient d\'avant la période', lav.cash.flow?.outside, 900);
check('aucun mouvement dans la période', lav.cash.flow?.count, 0);

const fin = filterWorkingCapital(r, 'systeme');
check('la Finance garde son tiroir', fin.cashTotal, 1700);
check('et tous les comptes bancaires', fin.bankTotal, treasury.bankTotal);
check('un bloc vide n\'affiche aucun flux', filterWorkingCapital(r, 'carburant').banks.flow, undefined);

// ─── Le tableau par activité recompose l'écran ───────────────────────────────
console.log('\nLe tableau par activité rend le total affiché');
const sumBy = (f: (p: typeof r.parts[number]) => number) => r.parts.reduce((s, p) => s + f(p), 0);
check('quatre lignes : trois activités et la Finance', r.parts.length, 4);
check('la colonne caisse fait le total des caisses', sumBy(p => p.cash), r.cashTotal);
check('la colonne banque fait le total en banque', sumBy(p => p.bank), r.bankTotal);
check('le total du tableau EST le fonds de roulement', sumBy(p => p.total), r.workingCapital);
check('le net financier aussi', sumBy(p => p.net), r.financialWorkingCapital);
check('la trésorerie est caisses + banques', r.treasuryTotal, r.cashTotal + r.bankTotal);

console.log(`\n${passed} vérification(s) passée(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
