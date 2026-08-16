/**
 * ─── Business-module Reporting Engine ──────────────────────────────────────────
 * Pure computation shared by the per-module reports (`ModuleReports`) and the
 * consolidated general report (`GeneralReports`). Turns a `ModuleState` (or the
 * Supabase fuel-station state) into a rich, fully-detailed `PartReport` covering
 * sales, purchases, debts, stock/expiration alerts, expenses, worker accounts and
 * the full gain calculation — so both the on-screen drill-down UI and the
 * printable "Fiche Journalière"-style sheet render from a single source of truth.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  ModuleState, ModuleKey, MODULES, prestationsOf, isReversedSale, netCashOfSale,
  bizExpensePaidInCash,
} from './bizConfig';
import { unpaidSupplierInvoices, purchasePaid, purchaseRest } from './supplierDebt';
import { computeCarburantSales, computeCarburantCash, FuelBrigadeSale } from './carburantSales';
import { partCashLedgerLines, expensePartOf, isCashAccount } from '../store/AppContext';

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ─── Date helper ─────────────────────────────────────────────────────────────
// La règle vit dans `period.ts` — elle est partagée avec `carburantSales`, que ce
// fichier lit. La ré-exporter garde tous les appelants historiques inchangés.
export { within, daysUntil } from './period';
import { within, daysUntil } from './period';

// ─── Detail row types ────────────────────────────────────────────────────────
export interface SaleRow {
  id: string; ref: string; kind: string; date: string; client: string;
  total: number; paid: number; rest: number; items: { name: string; qty: number; unitPrice: number; total: number }[];
}
export interface PurchaseRow {
  id: string; ref: string; date: string; supplier: string;
  total: number; paid: number; rest: number; items: { name: string; qty: number; unitPrice: number; total: number }[];
}
export interface ProductGain { name: string; qty: number; unit?: string; revenue: number; cost: number; gain: number; }
export interface DebtRow { id: string; ref: string; name: string; date: string; total: number; paid: number; rest: number; }
export interface ExpenseRow {
  id: string; kind: 'Dépense' | 'Salaire' | 'Acompte' | 'Absence';
  label: string; description?: string; amount: number; date: string;
  /**
   * Où la dépense est enregistrée : `module` = dans la partie elle-même,
   * `app` = dans l'écran Dépenses de la station, imputée à cette partie. Les
   * deux se suppriment par des chemins différents — sans ce repère, le rapport
   * général essayait de retirer une dépense de la station d'un blob de partie,
   * et la ligne revenait à chaque rechargement.
   */
  origin?: 'module' | 'app';
  /** `true` quand la dépense a vidé le tiroir de la partie (paiement en espèces). */
  paidInCash?: boolean;
}
export interface StockAlertRow { id: string; name: string; category?: string; currentQty: number; minQty: number; deficit: number; unit?: string; value: number; }
/** Une référence en stock et ce qu'elle vaut — le détail de « Valeur du stock ». */
export interface StockLineRow { id: string; name: string; category?: string; qty: number; unit?: string; buyPrice: number; value: number; }
export interface ExpiryAlertRow { id: string; name: string; category?: string; expirationDate: string; daysLeft: number; currentQty: number; unit?: string; value: number; status: 'expired' | 'soon'; }
export interface WorkerRow {
  id: string; name: string; role: string; salaryType: string; salaryAmount: number; paid: boolean;
  acomptes: { date: string; amount: number; description?: string; paid: boolean }[]; acomptesTotal: number; acomptesUnpaid: number;
  absences: { date: string; cost: number; description?: string; paid: boolean }[]; absencesTotal: number; absencesCount: number;
  payments: { period: string; date: string; amount: number; description?: string }[]; paymentsTotal: number;
  net: number;
}
export interface CaisseRow { id: string; type: 'deposit' | 'withdraw'; amount: number; date: string; description?: string; category?: string; }
/**
 * Un mouvement d'espèces d'une activité, vu DEPUIS son tiroir. C'est de ces
 * lignes-là qu'est fait le « Solde caisse » : la carte ne montrait qu'un montant,
 * et un solde négatif n'avait alors aucun moyen de s'expliquer.
 */
export interface CaisseMovementRow {
  id: string;
  date: string;
  nature: string;
  label: string;
  /** Signé sur la caisse : > 0 = espèces entrées, < 0 = espèces sorties. */
  amount: number;
  reference?: string;
}
export interface DestructionRow {
  id: string; name: string; qty: number; value: number; reason?: string; date: string;
  /** D'où vient le produit détruit : le catalogue (stock) ou le comptoir. */
  source: 'stock' | 'comptoir';
  unit?: string;
  unitPrice: number;
  category?: string;
  createdBy?: string;
  notes?: string;
}
export interface ProductionRow { id: string; name: string; date: string; outputQuantity: number; unit?: string; totalValue: number; totalCost: number; hasLoss: boolean; lossQuantity: number; lossValue: number; }
/**
 * Une vente ANNULÉE de la période — retour ou échange. Elle ne pèse plus dans le
 * chiffre d'affaires ni dans les gains (sa marchandise est revenue en stock),
 * mais elle reste visible ici : c'est le seul endroit qui explique l'écart entre
 * ce qui a été facturé et ce qui a été gardé.
 */
export interface ReturnRow {
  id: string; ref: string; date: string; client: string;
  kind: 'Retour' | 'Échange';
  /** Ce que la vente valait avant d'être annulée — le CA qui a disparu. */
  total: number;
  /** Ce que le client avait déjà payé. */
  paid: number;
  /** Argent rendu au client (échange : le complément négatif). */
  refunded: number;
  /** Argent finalement resté en caisse sur cette vente. */
  netCash: number;
  /** Coût de revient de la marchandise revenue en stock. */
  restockedCost: number;
  /** Gain que la vente aurait dégagé et qui n'existe plus. */
  canceledGain: number;
  reason?: string;
  items: { name: string; qty: number; unitPrice: number; total: number }[];
}

// ─── Aggregate report ────────────────────────────────────────────────────────
export interface PartReport {
  key: string;
  label: string;
  emoji: string;
  from: string;
  to: string;

  // Totals
  salesTotal: number;
  salesPaid: number;
  /** CA annulé par les retours & échanges de la période (hors `salesTotal`). */
  returnsTotal: number;
  /** Argent rendu aux clients sur la période. */
  refundedTotal: number;
  /** Coût de revient de la marchandise revenue en stock. */
  restockedCost: number;
  purchasesTotal: number;
  purchasesPaid: number;
  cogs: number;                 // coût des marchandises vendues
  grossMargin: number;          // salesTotal − cogs
  expensesTotal: number;
  salariesPaid: number;         // paiements employés sur la période
  acomptesPeriod: number;       // acomptes versés sur la période
  productionValue: number;
  productionCost: number;
  lossValue: number;
  destroyedValue: number;
  clientDebtTotal: number;      // encours (toutes dates)
  supplierDebtTotal: number;    // encours (toutes dates)
  stockValue: number;
  caisseBalance: number;
  netGain: number;              // marge brute − dépenses − salaires − destructions − pertes

  // Detail collections
  sales: SaleRow[];
  purchases: PurchaseRow[];
  salesByProduct: ProductGain[];
  clientDebts: DebtRow[];
  supplierDebts: DebtRow[];
  expenses: ExpenseRow[];
  expensesByCategory: { category: string; amount: number }[];
  stockAlerts: StockAlertRow[];
  expiryAlerts: ExpiryAlertRow[];
  workers: WorkerRow[];
  caisse: CaisseRow[];
  destructions: DestructionRow[];
  productions: ProductionRow[];
  returns: ReturnRow[];
  /** Chaque référence en stock, valorisée — le détail de `stockValue`. */
  stockLines: StockLineRow[];
  /** Le solde de caisse expliqué mouvement par mouvement (toutes dates). */
  caisseMovements: CaisseMovementRow[];
  /** Entrées / sorties d'espèces qui composent `caisseBalance`. */
  caisseFlow: { in: number; out: number };
  /** Brigades de la période — la vraie vente de carburant. Vide ailleurs. */
  fuelBrigades: FuelBrigadeSale[];
  /** Litres de carburant vendus sur la période. */
  fuelLiters: number;

  counts: { products: number; clients: number; suppliers: number; sales: number; purchases: number; workers: number; returns: number };
}

/** Résume une liste de mouvements de caisse en ses deux flux. */
export const caisseFlowOf = (rows: CaisseMovementRow[]) => ({
  in: rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0),
  out: rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0),
});
const flowOf = caisseFlowOf;

/**
 * Les dépenses de la STATION (écran « Dépenses ») imputées à une partie
 * commerciale. Une dépense n'appartient plus au seul Carburant : celle qui est
 * imputée à la Cafétéria pèse dans SON rapport et, si elle est payée en
 * espèces, sort de SA caisse.
 */
export const appExpensesOfPart = (key: ModuleKey | string, appExpenses: any[] = []): any[] =>
  (appExpenses || []).filter(e => expensePartOf(e) === key);

/**
 * Le tiroir d'une partie commerciale, mouvement par mouvement — la SEULE
 * définition, partagée par le rapport de la partie et l'écran Caisse Générale.
 *
 * Ses propres documents (dépôts et retraits de caisse, ventes encaissées,
 * interventions payées, achats réglés, dépenses, salaires) PLUS les opérations
 * manuelles du grand livre qui lui sont imputées. Ce dernier terme manquait :
 * un dépôt saisi dans la Caisse Générale avec « Cafétéria » en partie concernée
 * n'arrivait nulle part, et le classement choisi par l'utilisateur ne servait
 * qu'à colorer une ligne de journal.
 *
 * `appExpenses` — les dépenses de la station : celles qui sont imputées à cette
 * partie et payées en espèces sortent de CE tiroir, plus de la caisse générale.
 * Une dépense réglée par la banque, elle, ne touche aucune caisse : elle est
 * écartée des deux côtés (partie comme station).
 */
export function moduleCaisseMovements(
  st: ModuleState, key: ModuleKey, txs: any[] = [], appExpenses: any[] = [],
): CaisseMovementRow[] {
  return [
    ...st.caisse.map(c => ({
      id: `csh-${c.id}`, date: c.date,
      nature: c.type === 'deposit' ? 'Dépôt' : 'Retrait',
      label: c.description || (c.type === 'deposit' ? 'Dépôt de caisse' : 'Retrait de caisse'),
      amount: c.type === 'deposit' ? num(c.amount) : -num(c.amount),
    })),
    // L'argent rendu au client sur un retour est bien sorti du tiroir : c'est
    // `netCashOfSale` qui le sait, pas le montant facturé.
    ...st.sales.filter(x => netCashOfSale(x) !== 0).map(x => ({
      id: `sale-${x.id}`, date: x.date, nature: 'Vente',
      label: `Vente ${x.ref} — ${x.clientName}`, amount: netCashOfSale(x),
    })),
    ...(st.reparations || []).filter(r => num(r.paid) > 0).map(r => ({
      id: `rep-${r.id}`, date: r.date, nature: 'Vente',
      label: `${r.kind === 'lavage' ? 'Lavage' : r.kind === 'reparation' ? 'Réparation' : 'Lavage + Réparation'} ${r.ref} — ${r.clientName}`,
      amount: num(r.paid),
    })),
    ...st.purchases.filter(x => num(x.paid) > 0).map(x => ({
      id: `pur-${x.id}`, date: x.date, nature: 'Achat',
      label: `Achat ${x.ref} — ${x.supplierName}`, amount: -num(x.paid),
    })),
    // Seules les dépenses réglées EN ESPÈCES vident le tiroir : une dépense
    // payée par virement est sortie du compte bancaire, pas de la caisse.
    ...st.expenses.filter(bizExpensePaidInCash).map(e => ({
      id: `exp-${e.id}`, date: e.date, nature: 'Dépense',
      label: `${e.name}${e.description ? ` — ${e.description}` : ''}`, amount: -num(e.amount),
    })),
    // Dépenses de la station imputées à cette partie et payées en espèces.
    ...appExpensesOfPart(key, appExpenses)
      .filter(e => isCashAccount(e.accountId) || !e.accountId)
      .map(e => ({
        id: `app-exp-${e.id}`, date: e.date, nature: 'Dépense',
        label: `${e.category || 'Dépense'}${e.description ? ` — ${e.description}` : ''}`,
        amount: -num(e.amount),
        reference: e.chequeNumber || e.bordereauNumber,
      })),
    ...st.workers.flatMap(w => (w.payments || []).map(p => ({
      id: `pay-${p.id}`, date: p.date, nature: 'Salaire',
      label: `Salaire ${w.name} — ${p.period}`, amount: -num(p.amount),
    }))),
    ...partCashLedgerLines(key as any, (txs || []) as any).map(({ tx: t, amount }) => ({
      id: t.id, date: t.date,
      nature: t.kind === 'DEPOSIT' ? 'Dépôt' : t.kind === 'WITHDRAW' ? 'Retrait' : 'Virement',
      label: t.description
        || (t.kind === 'DEPOSIT' ? 'Dépôt de caisse'
          : t.kind === 'WITHDRAW' ? 'Retrait de caisse' : 'Virement de caisse'),
      amount,
      reference: t.chequeNumber || t.bordereauNumber,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** Le solde du tiroir d'une partie commerciale — la somme de ses mouvements. */
export function moduleCaisseBalance(
  st: ModuleState, key: ModuleKey, txs: any[] = [], appExpenses: any[] = [],
): number {
  return moduleCaisseMovements(st, key, txs, appExpenses).reduce((s, m) => s + m.amount, 0);
}

// ─── Coût de revient d'une ligne vendue ──────────────────────────────────────
/** Ce qu'une ligne vendue peut être : d'où vient réellement la marchandise. */
export type SoldItemKind = 'catalogue' | 'production' | 'fiche' | 'autre';

/** Une ligne de vente, telle qu'elle est lue par les résolveurs ci-dessous. */
export interface SoldItemRef { productId?: string; productName: string; qty?: number; unitCost?: number }

/**
 * Résolveurs partagés d'une partie : coût de revient, unité et nature d'une
 * ligne vendue. Le rapport (`computeModuleReport`) et les analyses
 * (`bizAnalytics`) s'en servent tous les deux — sans quoi les deux écrans
 * pourraient annoncer deux gains différents pour le même produit.
 *
 * Un produit vendu ne vient pas forcément du catalogue : une production mise au
 * comptoir et une fiche technique vendue en direct portent leur PROPRE coût de
 * revient (`purchasePrice` / `costPerUnit`). Sans ces tables, la vente d'une
 * production compterait pour 0 DA de coût et son « gain » vaudrait le prix de
 * vente entier (30 DA affichés au lieu des 18 DA réellement gagnés).
 */
export function makeCostResolver(st: ModuleState) {
  const prodById = new Map(st.products.map(p => [p.id, p]));
  const prodByName = new Map(st.products.map(p => [p.name, p]));
  const comptoirById = new Map((st.comptoir || []).map(c => [c.id, c]));
  const comptoirByName = new Map((st.comptoir || []).map(c => [c.productName, c]));
  const ficheById = new Map((st.fiches || []).map(f => [f.id, f]));
  const ficheByName = new Map((st.fiches || []).map(f => [f.name, f]));

  /** Coût de revient d'UNE unité vendue, quelle que soit sa provenance. */
  const unitCostOf = (it: SoldItemRef): number => {
    // Coût figé au moment de la vente : c'est la source de vérité quand il existe
    // (le prix d'achat du produit a pu changer depuis).
    if (typeof it.unitCost === 'number' && it.unitCost > 0) return it.unitCost;
    const id = it.productId || '';
    const p = prodById.get(id) || prodByName.get(it.productName);
    if (p) return p.purchasePrice || 0;
    const c = comptoirById.get(id) || comptoirByName.get(it.productName);
    if (c) return c.purchasePrice || 0;
    const f = ficheById.get(id) || ficheByName.get(it.productName);
    if (f) return f.costPerUnit || 0;
    return 0;
  };
  /** Unité d'affichage d'une ligne, prise là où le produit existe vraiment. */
  const unitOf = (it: SoldItemRef): string | undefined => {
    const id = it.productId || '';
    return (prodById.get(id) || prodByName.get(it.productName))?.unit
      || (comptoirById.get(id) || comptoirByName.get(it.productName))?.unit
      || (ficheById.get(id) || ficheByName.get(it.productName))?.sellUnit;
  };
  const costOfItem = (it: SoldItemRef): number => unitCostOf(it) * (it.qty || 0);
  /** Catégorie affichée d'une ligne vendue. */
  const categoryOf = (it: SoldItemRef): string | undefined => {
    const id = it.productId || '';
    return (prodById.get(id) || prodByName.get(it.productName))?.categoryName
      || (comptoirById.get(id) || comptoirByName.get(it.productName))?.categoryName
      || (ficheById.get(id) || ficheByName.get(it.productName))?.categoryName;
  };
  /** Code-barres, quand la ligne pointe un produit du catalogue. */
  const barcodeOf = (it: SoldItemRef): string | undefined =>
    (prodById.get(it.productId || '') || prodByName.get(it.productName))?.barcode;
  /** D'où vient la marchandise — sert à séparer produits et productions. */
  const kindOf = (it: SoldItemRef): SoldItemKind => {
    const id = it.productId || '';
    if (prodById.get(id) || prodByName.get(it.productName)) return 'catalogue';
    if (comptoirById.get(id) || comptoirByName.get(it.productName)) return 'production';
    if (ficheById.get(id) || ficheByName.get(it.productName)) return 'fiche';
    return 'autre';
  };

  return { unitCostOf, unitOf, costOfItem, categoryOf, barcodeOf, kindOf };
}

// ─── Module (biz) report ─────────────────────────────────────────────────────
/**
 * `txs` — le grand livre de la station. Sans lui, la caisse d'une partie
 * ignorait les VIREMENTS partis de son coffre : elle restait pleine d'un argent
 * déjà versé en banque, et contredisait l'écran Caisse Générale, qui les compte.
 *
 * `appExpenses` — les dépenses saisies dans l'écran « Dépenses » de la station.
 * Celles qui sont imputées à CETTE partie sont ses charges : sans elles, une
 * dépense de la Cafétéria payée depuis l'écran général pesait sur le Carburant.
 *
 * Les deux paramètres sont facultatifs pour ne casser aucun appelant existant.
 */
export function computeModuleReport(
  st: ModuleState, key: ModuleKey, from: string, to: string, txs: any[] = [],
  appExpenses: any[] = [],
): PartReport {
  const cfg = MODULES[key];
  const { unitOf, costOfItem } = makeCostResolver(st);

  const salesInRange = st.sales.filter(s => within(s.date, from, to));
  // Une vente retournée ou échangée N'EST PLUS une vente : les articles sont
  // revenus en stock (ou au comptoir) et, pour un échange, c'est la vente de
  // remplacement qui porte le panier. La compter ici la facturait une deuxième
  // fois — le rapport annonçait un chiffre d'affaires et un gain sur de la
  // marchandise qui n'avait jamais quitté la maison.
  const effectiveSales = salesInRange.filter(s => !isReversedSale(s));
  const reversedSales = salesInRange.filter(isReversedSale);
  const repsInRange = (st.reparations || []).filter(r => within(r.date, from, to));
  const purchasesInRange = st.purchases.filter(p => within(p.date, from, to));
  const expensesInRange = st.expenses.filter(e => within(e.date, from, to));
  // Les dépenses de la station imputées à cette partie : elles sont à elle.
  const appExpensesInRange = appExpensesOfPart(key, appExpenses)
    .filter(e => within(e.date, from, to));
  const productionsInRange = (st.productions || []).filter(p => within(p.date, from, to));
  const destructionsInRange = (st.destructions || []).filter(d => within(d.date, from, to) && !d.recovered);

  // ── Sales rows (invoices + finalized services) ──
  const sales: SaleRow[] = [
    ...effectiveSales.map(s => ({
      id: s.id, ref: s.ref, kind: 'Vente', date: s.date, client: s.clientName,
      total: s.total, paid: s.paid, rest: s.rest,
      items: s.items.map(it => ({ name: it.productName, qty: it.qty, unitPrice: it.unitPrice, total: it.total ?? it.qty * it.unitPrice })),
    })),
    ...repsInRange.map(r => ({
      id: r.id, ref: r.ref,
      kind: r.kind === 'lavage' ? 'Lavage' : r.kind === 'reparation' ? 'Réparation' : 'Lavage + Réparation',
      date: r.date, client: r.clientName,
      total: r.total, paid: r.paid, rest: r.rest,
      items: [
        // One line per prestation performed, then the products, then the remise.
        ...prestationsOf(r).map(p => ({
          name: `${p.kind === 'lavage' ? 'Lavage' : 'Réparation'} — ${p.label}`,
          qty: 1, unitPrice: p.amount, total: p.amount,
        })),
        ...(r.usedProducts || []).map(it => ({ name: it.productName, qty: it.qty, unitPrice: it.unitPrice, total: it.total ?? it.qty * it.unitPrice })),
        ...(r.discountAmount
          ? [{ name: `Remise${r.discountType === 'percent' ? ` ${r.discountValue}%` : ''}`, qty: 1, unitPrice: -r.discountAmount, total: -r.discountAmount }]
          : []),
      ],
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ── Sales by product (revenue / cost / gain) ──
  const bp: Record<string, { qty: number; revenue: number; cost: number; unit?: string }> = {};
  effectiveSales.forEach(s => s.items.forEach(it => {
    const k = it.productName;
    (bp[k] ||= { qty: 0, revenue: 0, cost: 0, unit: unitOf(it) });
    bp[k].qty += it.qty;
    bp[k].revenue += it.total ?? it.qty * it.unitPrice;
    bp[k].cost += costOfItem(it);
  }));
  repsInRange.forEach(r => (r.usedProducts || []).forEach(it => {
    const k = it.productName;
    (bp[k] ||= { qty: 0, revenue: 0, cost: 0, unit: unitOf(it) });
    bp[k].qty += it.qty;
    bp[k].revenue += it.total ?? it.qty * it.unitPrice;
    bp[k].cost += costOfItem(it);
  }));
  // Prestations are pure margin (no goods behind them) and are split by nature so
  // the report says how much lavage and how much réparation was sold.
  repsInRange.forEach(r => prestationsOf(r).forEach(p => {
    const k = p.kind === 'lavage' ? 'Prestations — Lavage' : 'Prestations — Réparation';
    (bp[k] ||= { qty: 0, revenue: 0, cost: 0, unit: 'prestation' });
    bp[k].qty += 1;
    bp[k].revenue += Number(p.amount) || 0;
  }));
  // Remises are a negative revenue line, so the CA of this table reconciles with
  // the invoiced totals (which are net of the remise).
  const discountsTotal =
    repsInRange.reduce((s, r) => s + (r.discountAmount || 0), 0)
    + effectiveSales.reduce((s, x) => s + (x.reduction || 0), 0);
  if (discountsTotal > 0) {
    bp['Remises accordées'] = {
      qty: repsInRange.filter(r => (r.discountAmount || 0) > 0).length
        + effectiveSales.filter(x => (x.reduction || 0) > 0).length,
      revenue: -discountsTotal, cost: 0, unit: 'remise',
    };
  }

  const salesByProduct: ProductGain[] = Object.entries(bp)
    .map(([name, v]) => ({ name, qty: v.qty, unit: v.unit, revenue: v.revenue, cost: v.cost, gain: v.revenue - v.cost }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── Purchases ──
  const purchases: PurchaseRow[] = purchasesInRange
    .map(p => ({
      id: p.id, ref: p.ref, date: p.date, supplier: p.supplierName,
      total: p.total, paid: p.paid, rest: p.rest,
      items: p.items.map(it => ({ name: it.productName, qty: it.qty, unitPrice: it.unitPrice, total: it.total ?? it.qty * it.unitPrice })),
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ── Debts (outstanding, all dates) ──
  const clientDebts: DebtRow[] = [
    ...st.sales.filter(s => s.rest > 0).map(s => ({ id: s.id, ref: s.ref, name: s.clientName, date: s.date, total: s.total, paid: s.paid, rest: s.rest })),
    ...(st.reparations || []).filter(r => r.rest > 0).map(r => ({ id: r.id, ref: r.ref, name: r.clientName, date: r.date, total: r.total, paid: r.paid, rest: r.rest })),
  ].sort((a, b) => b.rest - a.rest);
  const supplierDebts: DebtRow[] = st.purchases.filter(p => p.rest > 0)
    .map(p => ({ id: p.id, ref: p.ref, name: p.supplierName, date: p.date, total: p.total, paid: p.paid, rest: p.rest }))
    .sort((a, b) => b.rest - a.rest);

  // ── Expenses (+ salaries + acomptes + absences within period) ──
  const expenseRows: ExpenseRow[] = [
    ...expensesInRange.map(e => ({
      id: e.id, kind: 'Dépense' as const, label: e.category || e.name,
      description: e.description || e.name, amount: e.amount, date: e.date,
      origin: 'module' as const, paidInCash: bizExpensePaidInCash(e),
    })),
    ...appExpensesInRange.map((e: any) => ({
      id: e.id, kind: 'Dépense' as const, label: e.category || 'Dépense',
      description: e.description, amount: num(e.amount), date: e.date,
      origin: 'app' as const, paidInCash: !e.accountId || isCashAccount(e.accountId),
    })),
  ];
  const salaryRows: ExpenseRow[] = st.workers.flatMap(w => w.payments.filter(p => within(p.date, from, to))
    .map(p => ({ id: `${w.id}-${p.id}`, kind: 'Salaire' as const, label: `${w.name}`, description: `Salaire ${p.period}`, amount: p.amount, date: p.date })));
  const acompteRows: ExpenseRow[] = st.workers.flatMap(w => w.acomptes.filter(a => within(a.date, from, to))
    .map(a => ({ id: `${w.id}-${a.id}`, kind: 'Acompte' as const, label: `${w.name}`, description: a.description || 'Acompte', amount: a.amount, date: a.date })));
  const expenses: ExpenseRow[] = [...expenseRows, ...salaryRows, ...acompteRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const expByCat: Record<string, number> = {};
  expensesInRange.forEach(e => { const k = e.category || 'Autre'; expByCat[k] = (expByCat[k] || 0) + num(e.amount); });
  appExpensesInRange.forEach((e: any) => { const k = e.category || 'Autre'; expByCat[k] = (expByCat[k] || 0) + num(e.amount); });
  const expensesByCategory = Object.entries(expByCat).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

  // ── Alerts ──
  const stockAlerts: StockAlertRow[] = st.products.filter(p => p.currentQty <= p.minQty)
    .map(p => ({ id: p.id, name: p.name, category: p.categoryName, currentQty: p.currentQty, minQty: p.minQty, deficit: Math.max(0, p.minQty - p.currentQty), unit: p.unit, value: p.currentQty * p.purchasePrice }))
    .sort((a, b) => b.deficit - a.deficit);
  const expiryAlerts: ExpiryAlertRow[] = st.products.filter(p => p.hasExpiration && p.expirationDate && daysUntil(p.expirationDate) <= 15)
    .map(p => { const dl = daysUntil(p.expirationDate); return { id: p.id, name: p.name, category: p.categoryName, expirationDate: p.expirationDate!, daysLeft: dl, currentQty: p.currentQty, unit: p.unit, value: p.currentQty * p.purchasePrice, status: (dl < 0 ? 'expired' : 'soon') as 'expired' | 'soon' }; })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // ── Workers (accounts) ──
  const workers: WorkerRow[] = st.workers.map(w => {
    const acomptesTotal = w.acomptes.reduce((s, a) => s + a.amount, 0);
    const acomptesUnpaid = w.acomptes.filter(a => !a.paid).reduce((s, a) => s + a.amount, 0);
    const absencesTotal = w.absences.reduce((s, a) => s + a.cost, 0);
    const paymentsTotal = w.payments.reduce((s, p) => s + p.amount, 0);
    return {
      id: w.id, name: w.name, role: w.roleName, salaryType: w.salaryType, salaryAmount: w.salaryAmount, paid: w.paid,
      acomptes: w.acomptes.map(a => ({ date: a.date, amount: a.amount, description: a.description, paid: a.paid })), acomptesTotal, acomptesUnpaid,
      absences: w.absences.map(a => ({ date: a.date, cost: a.cost, description: a.description, paid: a.paid })), absencesTotal, absencesCount: w.absences.length,
      payments: w.payments.map(p => ({ period: p.period, date: p.date, amount: p.amount, description: p.description })), paymentsTotal,
      net: Math.max(0, w.salaryAmount - acomptesUnpaid - absencesTotal),
    };
  });

  const caisse: CaisseRow[] = st.caisse.filter(c => within(c.date, from, to))
    .map(c => ({ id: c.id, type: c.type, amount: c.amount, date: c.date, description: c.description, category: c.category }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Les destructions viennent de la Gestion de stock ET du Comptoir : les deux
  // sont des pertes de marchandise qui pèsent sur le résultat de la partie.
  const destructions: DestructionRow[] = destructionsInRange
    .map(d => ({
      id: d.id, name: d.productName, qty: d.qty, value: d.value, reason: d.reason, date: d.date,
      source: (d.source === 'stock' ? 'stock' : 'comptoir') as 'stock' | 'comptoir',
      unit: d.unit, unitPrice: d.unitPrice, category: d.categoryName,
      createdBy: d.createdBy, notes: d.notes,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const productions: ProductionRow[] = productionsInRange
    .map(p => ({ id: p.id, name: p.name, date: p.date, outputQuantity: p.outputQuantity, unit: p.unit, totalValue: p.totalValue, totalCost: p.totalCost, hasLoss: p.hasLoss, lossQuantity: p.lossQuantity, lossValue: p.lossValue }));

  // ── Retours & échanges (ventes annulées de la période) ──
  const returns: ReturnRow[] = reversedSales
    .map(s => {
      const restockedCost = s.items.reduce((a, it) => a + costOfItem(it), 0);
      return {
        id: s.id, ref: s.ref, date: s.refundedAt || s.date, client: s.clientName,
        kind: (s.status === 'échangée' ? 'Échange' : 'Retour') as 'Retour' | 'Échange',
        total: s.total, paid: s.paid,
        refunded: s.status === 'retournée' ? (s.refundedAmount || 0) : Math.max(0, -(s.exchangeDelta || 0)),
        netCash: netCashOfSale(s),
        restockedCost,
        // Le gain que cette vente aurait dégagé : il n'existe plus, la
        // marchandise est de retour et le client a été remboursé.
        canceledGain: s.total - restockedCost,
        reason: s.returnReason,
        items: s.items.map(it => ({ name: it.productName, qty: it.qty, unitPrice: it.unitPrice, total: it.total ?? it.qty * it.unitPrice })),
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ── Totals ──
  // Le CA ne retient que les ventes effectives. L'encaissement, lui, part de TOUTES
  // les ventes de la période mais via `netCashOfSale` : une vente retournée n'y
  // laisse que ce qui n'a pas été remboursé, une vente échangée rien du tout
  // (c'est son remplacement qui porte l'argent).
  const salesTotal = effectiveSales.reduce((s, x) => s + x.total, 0) + repsInRange.reduce((s, x) => s + x.total, 0);
  const salesPaid = salesInRange.reduce((s, x) => s + netCashOfSale(x), 0) + repsInRange.reduce((s, x) => s + x.paid, 0);
  const returnsTotal = returns.reduce((s, x) => s + x.total, 0);
  const refundedTotal = returns.reduce((s, x) => s + x.refunded, 0);
  const restockedCost = returns.reduce((s, x) => s + x.restockedCost, 0);
  const purchasesTotal = purchasesInRange.reduce((s, x) => s + x.total, 0);
  const purchasesPaid = purchasesInRange.reduce((s, x) => s + x.paid, 0);
  const cogs = salesByProduct.reduce((s, x) => s + x.cost, 0);
  const grossMargin = salesTotal - cogs;
  const expensesTotal = expensesInRange.reduce((s, x) => s + num(x.amount), 0)
    + appExpensesInRange.reduce((s: number, x: any) => s + num(x.amount), 0);
  const salariesPaid = salaryRows.reduce((s, x) => s + x.amount, 0);
  const acomptesPeriod = acompteRows.reduce((s, x) => s + x.amount, 0);
  const productionValue = productionsInRange.reduce((s, x) => s + x.totalValue, 0);
  const productionCost = productionsInRange.reduce((s, x) => s + x.totalCost, 0);
  const lossValue = productionsInRange.reduce((s, x) => s + x.lossValue, 0);
  const destroyedValue = destructionsInRange.reduce((s, x) => s + x.value, 0);
  const clientDebtTotal = clientDebts.reduce((s, x) => s + x.rest, 0);
  const supplierDebtTotal = supplierDebts.reduce((s, x) => s + x.rest, 0);
  const stockValue = st.products.reduce((s, p) => s + p.currentQty * p.purchasePrice, 0);

  // ── Le solde de caisse, ligne par ligne ───────────────────────────────────
  // Le calcul vit dans `moduleCaisseMovements`, que l'écran Caisse Générale
  // appelle aussi : les deux écrans ne peuvent donc plus annoncer deux soldes.
  const caisseMovements = moduleCaisseMovements(st, key, txs, appExpenses);
  const caisseBalance = caisseMovements.reduce((s, m) => s + m.amount, 0);
  const netGain = grossMargin - expensesTotal - salariesPaid - destroyedValue - lossValue;

  return {
    key, label: cfg.label, emoji: cfg.emoji, from, to,
    salesTotal, salesPaid, returnsTotal, refundedTotal, restockedCost,
    purchasesTotal, purchasesPaid, cogs, grossMargin,
    expensesTotal, salariesPaid, acomptesPeriod, productionValue, productionCost, lossValue, destroyedValue,
    clientDebtTotal, supplierDebtTotal, stockValue, caisseBalance, netGain,
    sales, purchases, salesByProduct, clientDebts, supplierDebts, expenses, expensesByCategory,
    stockAlerts, expiryAlerts, workers, caisse, destructions, productions, returns,
    stockLines: st.products
      .map(p => ({
        id: p.id, name: p.name, category: p.categoryName, qty: p.currentQty,
        unit: p.unit, buyPrice: p.purchasePrice, value: p.currentQty * p.purchasePrice,
      }))
      .sort((a, b) => b.value - a.value),
    caisseMovements, caisseFlow: flowOf(caisseMovements),
    fuelBrigades: [], fuelLiters: 0,
    counts: {
      products: st.products.length, clients: st.clients.length, suppliers: st.suppliers.length,
      sales: effectiveSales.length + repsInRange.length, purchases: purchasesInRange.length,
      workers: st.workers.length, returns: returns.length,
    },
  };
}

// ─── Carburant (fuel-station) report from the Supabase AppContext ─────────────
/**
 * Le rapport de l'activité Carburant.
 *
 * Il lisait la table `fuel_sales`, que plus AUCUN écran n'écrit : la vente de
 * carburant passe par les brigades depuis longtemps. Résultat, ce rapport
 * annonçait zéro litre et zéro dinar de recette carburant, tout en retranchant
 * les achats et les dépenses pour leur montant entier — d'où le fameux
 * « Solde caisse −973 867,40 DA », qui n'était rien d'autre que la somme des
 * sorties d'une activité privée de ses recettes.
 *
 * Les ventes viennent maintenant de `carburantSales`, c'est-à-dire des brigades
 * elles-mêmes, et le solde de caisse de `computeCarburantCash` — la même
 * fonction que celle de l'écran Caisse Générale, pour que les deux écrans ne
 * puissent plus se contredire.
 */
export function computeCarburantReport(app: any, from: string, to: string): PartReport {
  const products: any[] = app.products || [];
  const clients: any[] = app.clients || [];
  const suppliers: any[] = app.suppliers || [];
  const shopSales: any[] = (app.shopSales || []).filter((s: any) => within(s.date, from, to));
  const purchasesAll: any[] = app.purchases || [];
  const purchasesInRange = purchasesAll.filter((p: any) => within(p.date, from, to));
  // Les dépenses du CARBURANT — pas celles de la station entière. Une dépense
  // imputée à la Cafétéria ou au Lavage pèse dans SON rapport : la compter ici
  // aussi la facturait deux fois et faisait plonger le gain du carburant.
  const expensesInRange: any[] = (app.expenses || [])
    .filter((e: any) => expensePartOf(e) === 'carburant' && within(e.date, from, to));

  const prodById = new Map(products.map(p => [p.id, p]));

  // ── Carburant : les brigades de la période ──
  const fuel = computeCarburantSales(app, from, to);
  const cash = computeCarburantCash(app);

  // Shop by product
  const shopByProduct: Record<string, { qty: number; revenue: number; cost: number; unit?: string }> = {};
  shopSales.forEach(s => (s.items || []).forEach((i: any) => {
    const prod = prodById.get(i.productId);
    (shopByProduct[i.productName] ||= { qty: 0, revenue: 0, cost: 0, unit: prod?.unit });
    shopByProduct[i.productName].qty += i.quantity;
    shopByProduct[i.productName].revenue += i.quantity * i.price;
    shopByProduct[i.productName].cost += i.quantity * (prod?.buyPrice || 0);
  }));
  const salesByProduct: ProductGain[] = [
    ...fuel.byFuel.map(f => ({
      name: `Carburant — ${f.type}`, qty: f.liters, unit: 'L',
      revenue: f.revenue, cost: f.cost, gain: f.gain,
    })),
    ...Object.entries(shopByProduct).map(([name, v]) => ({ name, qty: v.qty, unit: v.unit, revenue: v.revenue, cost: v.cost, gain: v.revenue - v.cost })),
  ].sort((a, b) => b.revenue - a.revenue);

  // Ventes : une ligne par brigade (le carburant), puis les factures magasin.
  const sales: SaleRow[] = [
    ...fuel.brigades.map(b => ({
      id: b.id, ref: b.ref, kind: 'Brigade', date: b.date, client: b.chefName,
      total: b.revenue,
      // Encaissé = espèces + TPE. Les bons clients et le manquant restent dus.
      paid: b.cash + b.tpe, rest: Math.max(0, b.credit + b.rest),
      items: b.byFuel.map(f => ({ name: f.type, qty: f.liters, unitPrice: f.price, total: f.revenue })),
    })),
    ...shopSales.map(s => ({
      id: s.id, ref: s.id?.slice(0, 8) || '—', kind: 'Magasin', date: s.date, client: clients.find(c => c.id === s.clientId)?.name || 'Comptoir',
      total: s.total, paid: s.amountPaid ?? s.total, rest: s.rest ?? 0,
      items: (s.items || []).map((i: any) => ({ name: i.productName, qty: i.quantity, unitPrice: i.price, total: i.quantity * i.price })),
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const purchases: PurchaseRow[] = purchasesInRange.map((p: any) => ({
    id: p.id, ref: p.invoiceNumber || p.blNumber || p.id?.slice(0, 8) || '—', date: p.date,
    supplier: suppliers.find(s => s.id === p.supplierId)?.name || '—',
    // Montants recalculés sur les règlements de l'achat : les colonnes
    // `amount_paid` / `rest` peuvent traîner un arrondi ou une valeur écrite par
    // une version antérieure, et le rapport ne doit jamais en hériter.
    total: num(p.total), paid: purchasePaid(p), rest: Math.max(0, purchaseRest(p)),
    items: (p.items || []).map((i: any) => ({ name: i.productName, qty: i.quantity, unitPrice: i.buyPrice, total: i.total ?? i.quantity * i.buyPrice })),
  })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const clientDebts: DebtRow[] = clients.filter(c => (c.debt || 0) > 0)
    .map(c => ({ id: c.id, ref: '—', name: c.name, date: '', total: c.debt, paid: 0, rest: c.debt }))
    .sort((a, b) => b.rest - a.rest);

  // ── Dettes fournisseurs — une ligne PAR FACTURE non soldée ────────────────
  // On lisait la colonne `suppliers.balance`, que l'écran Achats Carburant n'a
  // jamais alimentée : la carte annonçait 0 alors que des factures entières
  // restaient dues. Les dettes sont maintenant reconstruites sur les achats et
  // les anciens bons de livraison — la même source que l'écran Fournisseurs et
  // que le fonds de roulement. Toutes les factures de la station sont comptées,
  // carburant ET magasin : cette partie couvre les deux. Un encours n'a pas de
  // période — une facture d'il y a trois mois est due aujourd'hui — elle figure
  // donc dans le total quelle que soit la fenêtre choisie.
  const supplierDebts: DebtRow[] = unpaidSupplierInvoices(app)
    .map(inv => ({
      id: inv.id, ref: inv.ref, name: inv.supplierName, date: inv.date,
      total: inv.total, paid: inv.paid, rest: inv.rest,
    }));

  // ── Employés de la station ────────────────────────────────────────────────
  // Pompistes, chefs de brigade, gérants et magasiniers sont payés PAR
  // l'activité Carburant. Le rapport les ignorait complètement : son gain net
  // était donc calculé sans la première de ses charges.
  const fuelStaff: { list: any[]; role: string }[] = [
    { list: app.pompistes || [], role: 'Pompiste' },
    { list: app.brigadeChefs || [], role: 'Chef de brigade' },
    { list: app.gerants || [], role: 'Gérant' },
    { list: app.magasinWorkers || [], role: 'Magasin' },
  ];
  const workers: WorkerRow[] = fuelStaff.flatMap(({ list, role }) => list.map((w: any) => {
    const acomptes = (w.acomptes || []).map((a: any) => ({
      date: a.date, amount: num(a.amount), description: a.description, paid: !!a.isPaid,
    }));
    const absences = (w.absences || []).map((a: any) => ({
      date: a.date, cost: num(a.cost), description: a.description, paid: !!a.isPaid,
    }));
    const payments = (w.paymentRecord || []).map((p: any) => ({
      period: p.month || '—', date: p.paymentDate, amount: num(p.netSalary), description: p.notes,
    }));
    const acomptesTotal = acomptes.reduce((s: number, a: any) => s + a.amount, 0);
    const acomptesUnpaid = acomptes.filter((a: any) => !a.paid).reduce((s: number, a: any) => s + a.amount, 0);
    const absencesTotal = absences.reduce((s: number, a: any) => s + a.cost, 0);
    const paymentsTotal = payments.reduce((s: number, p: any) => s + p.amount, 0);
    const salaryAmount = num(w.salary ?? w.baseSalary ?? w.salaryAmount);
    return {
      id: w.id, name: w.name, role: w.roleName || role,
      salaryType: w.salaryType || 'mois', salaryAmount,
      paid: paymentsTotal > 0,
      acomptes, acomptesTotal, acomptesUnpaid,
      absences, absencesTotal, absencesCount: absences.length,
      payments, paymentsTotal,
      net: Math.max(0, salaryAmount - acomptesUnpaid - absencesTotal),
    };
  }));

  const salaryRows: ExpenseRow[] = fuelStaff.flatMap(({ list }) => list.flatMap((w: any) =>
    (w.paymentRecord || []).filter((p: any) => within(p.paymentDate, from, to)).map((p: any) => ({
      id: `sal-${w.id}-${p.id}`, kind: 'Salaire' as const, label: w.name,
      description: `Salaire ${p.month || ''}`.trim(), amount: num(p.netSalary), date: p.paymentDate,
    }))));
  const acompteRows: ExpenseRow[] = fuelStaff.flatMap(({ list }) => list.flatMap((w: any) =>
    (w.acomptes || []).filter((a: any) => within(a.date, from, to)).map((a: any) => ({
      id: `aco-${w.id}-${a.id}`, kind: 'Acompte' as const, label: w.name,
      description: a.description || 'Acompte', amount: num(a.amount), date: a.date,
    }))));

  const expenses: ExpenseRow[] = [
    ...expensesInRange.map((e: any) => ({
      id: e.id, kind: 'Dépense' as const, label: e.category || 'Dépense',
      description: e.description, amount: num(e.amount), date: e.date,
      origin: 'app' as const, paidInCash: !e.accountId || isCashAccount(e.accountId),
    })),
    ...salaryRows, ...acompteRows,
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const expByCat: Record<string, number> = {};
  expensesInRange.forEach((e: any) => { const k = e.category || 'Autre'; expByCat[k] = (expByCat[k] || 0) + e.amount; });
  const expensesByCategory = Object.entries(expByCat).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

  const stockAlerts: StockAlertRow[] = products.filter(p => typeof p.stock === 'number' && typeof p.minStock === 'number' && p.stock <= p.minStock)
    .map(p => ({ id: p.id, name: p.name, category: p.category, currentQty: p.stock, minQty: p.minStock, deficit: Math.max(0, p.minStock - p.stock), unit: p.unit, value: p.stock * (p.buyPrice || 0) }))
    .sort((a, b) => b.deficit - a.deficit);

  // Totals
  // Le chiffre d'affaires du carburant est celui des brigades ; l'encaissé, ce
  // qui en est réellement rentré (espèces + TPE) — un bon client n'est pas encore
  // de l'argent.
  const salesTotal = fuel.revenue + shopSales.reduce((s, x) => s + (x.total || 0), 0);
  const salesPaid = fuel.collected + shopSales.reduce((s, x) => s + (x.amountPaid ?? x.total ?? 0), 0);
  const purchasesTotal = purchasesInRange.reduce((s: number, x: any) => s + num(x.total), 0);
  const purchasesPaid = purchasesInRange.reduce((s: number, x: any) => s + purchasePaid(x), 0);
  const cogs = salesByProduct.reduce((s, x) => s + x.cost, 0);
  const grossMargin = salesTotal - cogs;
  const expensesTotal = expensesInRange.reduce((s: number, x: any) => s + (x.amount || 0), 0);
  const salariesPaid = salaryRows.reduce((s, x) => s + x.amount, 0);
  const acomptesPeriod = acompteRows.reduce((s, x) => s + x.amount, 0);
  const clientDebtTotal = clientDebts.reduce((s, x) => s + x.rest, 0);
  const supplierDebtTotal = supplierDebts.reduce((s, x) => s + x.rest, 0);

  // ── Stock — les CUVES d'abord, puis le magasin ────────────────────────────
  // Le rapport ne comptait que les produits boutique : les dizaines de milliers
  // de litres dormant dans les cuves — de loin le premier actif de la station —
  // valaient zéro. L'écran « Valeur du stock », lui, les comptait : les deux se
  // contredisaient. Mêmes lignes, même valorisation au prix d'achat des deux côtés.
  const stockLines: StockLineRow[] = [
    ...(app.tanks || []).map((t: any) => {
      const qty = num(t.current);
      const buyPrice = num(app.settings?.fuelBuyPrices?.[t.type]);
      return {
        id: `tank-${t.id}`, name: `${t.name} (${t.type})`, category: 'Carburant en cuve',
        qty, unit: 'L', buyPrice, value: qty * buyPrice,
      };
    }),
    ...products.map((p: any) => ({
      id: p.id, name: p.name, category: p.category || 'Magasin',
      qty: num(p.stock), unit: p.unit, buyPrice: num(p.buyPrice), value: num(p.stock) * num(p.buyPrice),
    })),
  ].sort((a, b) => b.value - a.value);
  const stockValue = stockLines.reduce((s, l) => s + l.value, 0);
  const netGain = grossMargin - expensesTotal - salariesPaid;

  return {
    key: 'carburant', label: 'Carburant', emoji: '⛽', from, to,
    // La partie Carburant n'a pas de retour de marchandise : ses ventes sont
    // définitives (litres livrés), d'où des compteurs de retours à zéro.
    salesTotal, salesPaid, returnsTotal: 0, refundedTotal: 0, restockedCost: 0,
    purchasesTotal, purchasesPaid, cogs, grossMargin,
    expensesTotal, salariesPaid, acomptesPeriod, productionValue: 0, productionCost: 0, lossValue: 0, destroyedValue: 0,
    clientDebtTotal, supplierDebtTotal, stockValue,
    // Le solde vient du MÊME calcul que l'écran Caisse Générale.
    caisseBalance: cash.balance, netGain,
    sales, purchases, salesByProduct, clientDebts, supplierDebts, expenses, expensesByCategory,
    stockAlerts, expiryAlerts: [], workers, caisse: [], destructions: [], productions: [], returns: [],
    stockLines,
    caisseMovements: cash.lines, caisseFlow: { in: cash.inflow, out: cash.outflow },
    fuelBrigades: fuel.brigades, fuelLiters: fuel.liters,
    counts: {
      products: products.length, clients: clients.length, suppliers: suppliers.length,
      sales: fuel.brigades.length + shopSales.length, purchases: purchasesInRange.length,
      workers: workers.length, returns: 0,
    },
  };
}

// ─── Consolidation of several parts ──────────────────────────────────────────
export interface GlobalReport {
  from: string; to: string;
  parts: PartReport[];
  salesTotal: number; purchasesTotal: number; expensesTotal: number; salariesPaid: number;
  /** Part des achats de la période DÉJÀ réglée. */
  purchasesPaid: number;
  /** Reste dû sur les achats de la période — la dette née sur cette fenêtre. */
  purchasesDebt: number;
  /** Coût des marchandises vendues — ce que les ventes ont réellement coûté. */
  cogs: number;
  grossMargin: number; clientDebtTotal: number; supplierDebtTotal: number; stockValue: number;
  destroyedValue: number; lossValue: number; netGain: number;
  /** Retours & échanges — CA annulé et argent rendu, toutes parties confondues. */
  returnsTotal: number; refundedTotal: number; restockedCost: number;
  stockAlerts: number; expiryAlerts: number;
  counts: { products: number; clients: number; suppliers: number; sales: number; purchases: number; workers: number; returns: number };
}

export function consolidate(parts: PartReport[], from: string, to: string): GlobalReport {
  const sum = (f: (p: PartReport) => number) => parts.reduce((s, p) => s + f(p), 0);
  return {
    from, to, parts,
    salesTotal: sum(p => p.salesTotal),
    purchasesTotal: sum(p => p.purchasesTotal),
    purchasesPaid: sum(p => p.purchasesPaid),
    // Ce qui reste dû sur les achats de la période — jamais négatif, un achat
    // trop payé ne compense pas la dette d'un autre.
    purchasesDebt: sum(p => Math.max(0, p.purchasesTotal - p.purchasesPaid)),
    expensesTotal: sum(p => p.expensesTotal),
    salariesPaid: sum(p => p.salariesPaid),
    cogs: sum(p => p.cogs),
    grossMargin: sum(p => p.grossMargin),
    clientDebtTotal: sum(p => p.clientDebtTotal),
    supplierDebtTotal: sum(p => p.supplierDebtTotal),
    stockValue: sum(p => p.stockValue),
    destroyedValue: sum(p => p.destroyedValue),
    lossValue: sum(p => p.lossValue),
    netGain: sum(p => p.netGain),
    returnsTotal: sum(p => p.returnsTotal),
    refundedTotal: sum(p => p.refundedTotal),
    restockedCost: sum(p => p.restockedCost),
    stockAlerts: sum(p => p.stockAlerts.length),
    expiryAlerts: sum(p => p.expiryAlerts.length),
    counts: {
      products: sum(p => p.counts.products), clients: sum(p => p.counts.clients), suppliers: sum(p => p.counts.suppliers),
      sales: sum(p => p.counts.sales), purchases: sum(p => p.counts.purchases), workers: sum(p => p.counts.workers),
      returns: sum(p => p.counts.returns),
    },
  };
}
