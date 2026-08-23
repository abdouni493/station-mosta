/**
 * ─── Ce que ces cas protègent ─────────────────────────────────────────────────
 *
 * Un pompiste justifie 12 000 DA au terminal. Le rapport Carburant les compte
 * dans « encaissé », l'historique du compte bancaire n'en montrait rien, et le
 * solde restait 12 000 DA en dessous de la réalité. Trois trous distincts :
 *
 *   • un TAG ne portait AUCUN compte bancaire — jamais de ligne ;
 *   • rouvrir une brigade pour la corriger effaçait ses lignes de banque et n'en
 *     réécrivait aucune, parce que le compte n'était pas rechargé dans le
 *     formulaire ;
 *   • la fenêtre « Comptabilité brigade » n'en écrivait pas une seule.
 *
 *   npx tsx src/lib/brigadeBankLines.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  brigadeBankLines, brigadeBankLineIds, isBankJustification,
  unbankedJustifications, repairBrigadeBankLines,
} from './brigadeBankLines';

let passed = 0, failed = 0;
const check = (label: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}\n      attendu ${JSON.stringify(want)}\n      obtenu  ${JSON.stringify(got)}`); }
};

let n = 0;
const ids = () => `TX${++n}`;

const justifs = [
  { id: 'J1', justificationType: 'TPE', amount: 12_000, bankAccountId: 'B1', pompisteId: 'P1' },
  { id: 'J2', justificationType: 'TAG', amount: 4_000, bankAccountId: 'B2', pompisteId: 'P1' },
  { id: 'J3', justificationType: 'CLIENT', amount: 6_000, clientName: 'Transport Sud' },
  // Une justification encaissée sans compte : rien ne peut entrer nulle part.
  { id: 'J4', justificationType: 'TPE', amount: 900, pompisteId: 'P2' },
];

const names: Record<string, string> = { P1: 'Karim', P2: 'Nadir' };
const who = (id?: string | null) => (id ? names[id] : undefined);

console.log('\n─── Une justification encaissée va en banque ───');
check('TPE va en banque', isBankJustification({ justificationType: 'TPE' }), true);
check('TAG va en banque', isBankJustification({ justificationType: 'TAG' }), true);
check('un bon client, non', isBankJustification({ justificationType: 'CLIENT' }), false);

console.log('\n─── Les lignes du grand livre ───');
n = 0;
const lines = brigadeBankLines({
  brigadeId: 'BR1', date: '2026-08-20T22:00:00', label: '2026-08-20',
  justifications: justifs, pompisteName: who, createdBy: 'Admin', makeId: ids,
});
check('une ligne par justification encaissée avec compte', lines.length, 2);
check('le TPE crédite son compte', [lines[0].accountTo, lines[0].amount], ['B1', 12_000]);
check('le TAG crédite le sien', [lines[1].accountTo, lines[1].amount], ['B2', 4_000]);
check('nature TPE', lines[0].kind, 'TPE');
check('rattachée à la brigade', [lines[0].refType, lines[0].refId], ['brigade', 'BR1']);
check('imputée au carburant', lines[0].part, 'carburant');
check('le pompiste se lit dans l\'historique', lines[0].description, 'TPE brigade du 2026-08-20 — Karim');
check('aucune sortie de compte', lines.every(l => !l.accountFrom), true);
check('le bon client ne va PAS en banque', lines.some(l => l.amount === 6_000), false);
check('sans compte désigné, rien n\'entre', lines.some(l => l.amount === 900), false);
check('la justification sans compte est signalée',
  unbankedJustifications(justifs).map(j => j.id), ['J4']);

console.log('\n─── Réenregistrer une brigade ne double rien ───');
// Les lignes que la brigade a écrites sont EFFAÇÉES puis réécrites : c'est ce
// qui rend la modification sûre. Seules les siennes, et seulement les lignes de
// banque — jamais la ligne d'espèces, qui appartient à la caisse.
const ledger: any[] = [
  ...lines,
  { id: 'CASH', kind: 'BRIGADE', amount: 50_000, refType: 'brigade', refId: 'BR1', accountTo: 'CAISSE', part: 'carburant', date: '', createdAt: '' },
  { id: 'OTHER', kind: 'TPE', amount: 3_000, refType: 'brigade', refId: 'BR2', accountTo: 'B1', part: 'carburant', date: '', createdAt: '' },
];
check('seules les lignes bancaires de CETTE brigade s\'effacent',
  brigadeBankLineIds(ledger, 'BR1'), ['TX1', 'TX2']);

console.log('\n─── Rattraper les brigades déjà saisies ───');
n = 100;
const source = [{ brigadeId: 'BR1', date: '2026-08-20T22:00:00', label: '2026-08-20', justifications: justifs }];
// Grand livre vide : tout est à rattraper.
const cold = repairBrigadeBankLines(source, [], { pompisteName: who, makeId: ids });
check('les deux encaissements manquants sont proposés', cold.add.length, 2);
check('pour leur montant exact', cold.amount, 16_000);
check('une seule brigade concernée', cold.brigades, 1);
check('la justification sans compte est comptée à part', cold.unbanked, 1);

// Grand livre déjà complet : la réparation ne propose plus rien.
const warm = repairBrigadeBankLines(source, ledger, { pompisteName: who, makeId: ids });
check('relancer la réparation n\'ajoute rien', warm.add.length, 0);
check('et rien à créditer', warm.amount, 0);

// Une seule des deux lignes présente : seule l'autre est rattrapée.
const half = repairBrigadeBankLines(
  source,
  [{ id: 'TX1', kind: 'TPE', amount: 12_000, refType: 'brigade', refId: 'BR1', accountTo: 'B1', part: 'carburant', date: '', createdAt: '' } as any],
  { pompisteName: who, makeId: ids });
check('seul ce qui manque est ajouté', [half.add.length, half.amount], [1, 4_000]);
check('sur le bon compte', half.add[0].accountTo, 'B2');

// Un TPE corrigé à la hausse APRÈS coup : seule la différence entre en banque.
const grown = repairBrigadeBankLines(
  [{ brigadeId: 'BR1', date: '2026-08-20T22:00:00', justifications: [{ id: 'J1', justificationType: 'TPE', amount: 15_000, bankAccountId: 'B1' }] }],
  [{ id: 'TX1', kind: 'TPE', amount: 12_000, refType: 'brigade', refId: 'BR1', accountTo: 'B1', part: 'carburant', date: '', createdAt: '' } as any],
  { makeId: ids });
check('seule la différence est rattrapée', [grown.add.length, grown.amount], [1, 3_000]);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
