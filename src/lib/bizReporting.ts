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
import { ModuleState, ModuleKey, MODULES, prestationsOf, isReversedSale, netCashOfSale } from './bizConfig';

// ─── Date helper ─────────────────────────────────────────────────────────────
export const within = (dateStr: string, from: string, to: string): boolean => {
  if (!dateStr) return false;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return false;
  return (!from || d >= new Date(from).getTime()) && (!to || d <= new Date(to + 'T23:59:59').getTime());
};

export const daysUntil = (dateStr?: string): number => {
  if (!dateStr) return Infinity;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.ceil((t - Date.now()) / 86_400_000);
};

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
export interface ExpenseRow { id: string; kind: 'Dépense' | 'Salaire' | 'Acompte' | 'Absence'; label: string; description?: string; amount: number; date: string; }
export interface StockAlertRow { id: string; name: string; category?: string; currentQty: number; minQty: number; deficit: number; unit?: string; value: number; }
export interface ExpiryAlertRow { id: string; name: string; category?: string; expirationDate: string; daysLeft: number; currentQty: number; unit?: string; value: number; status: 'expired' | 'soon'; }
export interface WorkerRow {
  id: string; name: string; role: string; salaryType: string; salaryAmount: number; paid: boolean;
  acomptes: { date: string; amount: number; description?: string; paid: boolean }[]; acomptesTotal: number; acomptesUnpaid: number;
  absences: { date: string; cost: number; description?: string; paid: boolean }[]; absencesTotal: number; absencesCount: number;
  payments: { period: string; date: string; amount: number; description?: string }[]; paymentsTotal: number;
  net: number;
}
export interface CaisseRow { id: string; type: 'deposit' | 'withdraw'; amount: number; date: string; description?: string; category?: string; }
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

  counts: { products: number; clients: number; suppliers: number; sales: number; purchases: number; workers: number; returns: number };
}

// ─── Module (biz) report ─────────────────────────────────────────────────────
export function computeModuleReport(st: ModuleState, key: ModuleKey, from: string, to: string): PartReport {
  const cfg = MODULES[key];
  const prodById = new Map(st.products.map(p => [p.id, p]));
  const prodByName = new Map(st.products.map(p => [p.name, p]));
  // Un produit vendu ne vient pas forcément du catalogue : une production mise au
  // comptoir et une fiche technique vendue en direct portent leur PROPRE coût de
  // revient (`purchasePrice` / `costPerUnit`). Sans ces deux tables, la vente
  // d'une production comptait pour 0 DA de coût et son « gain » valait le prix de
  // vente entier (30 DA affichés au lieu des 18 DA réellement gagnés).
  const comptoirById = new Map((st.comptoir || []).map(c => [c.id, c]));
  const comptoirByName = new Map((st.comptoir || []).map(c => [c.productName, c]));
  const ficheById = new Map((st.fiches || []).map(f => [f.id, f]));
  const ficheByName = new Map((st.fiches || []).map(f => [f.name, f]));

  /** Coût de revient d'UNE unité vendue, quelle que soit sa provenance. */
  const unitCostOf = (it: { productId?: string; productName: string; unitCost?: number }): number => {
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
  const unitOf = (it: { productId?: string; productName: string }): string | undefined => {
    const id = it.productId || '';
    return (prodById.get(id) || prodByName.get(it.productName))?.unit
      || (comptoirById.get(id) || comptoirByName.get(it.productName))?.unit
      || (ficheById.get(id) || ficheByName.get(it.productName))?.sellUnit;
  };
  const costOfItem = (it: { productId?: string; productName: string; qty: number; unitCost?: number }): number =>
    unitCostOf(it) * (it.qty || 0);

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
  const expenseRows: ExpenseRow[] = expensesInRange.map(e => ({ id: e.id, kind: 'Dépense', label: e.category || e.name, description: e.description || e.name, amount: e.amount, date: e.date }));
  const salaryRows: ExpenseRow[] = st.workers.flatMap(w => w.payments.filter(p => within(p.date, from, to))
    .map(p => ({ id: `${w.id}-${p.id}`, kind: 'Salaire' as const, label: `${w.name}`, description: `Salaire ${p.period}`, amount: p.amount, date: p.date })));
  const acompteRows: ExpenseRow[] = st.workers.flatMap(w => w.acomptes.filter(a => within(a.date, from, to))
    .map(a => ({ id: `${w.id}-${a.id}`, kind: 'Acompte' as const, label: `${w.name}`, description: a.description || 'Acompte', amount: a.amount, date: a.date })));
  const expenses: ExpenseRow[] = [...expenseRows, ...salaryRows, ...acompteRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const expByCat: Record<string, number> = {};
  expensesInRange.forEach(e => { const k = e.category || 'Autre'; expByCat[k] = (expByCat[k] || 0) + e.amount; });
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
  const expensesTotal = expensesInRange.reduce((s, x) => s + x.amount, 0);
  const salariesPaid = salaryRows.reduce((s, x) => s + x.amount, 0);
  const acomptesPeriod = acompteRows.reduce((s, x) => s + x.amount, 0);
  const productionValue = productionsInRange.reduce((s, x) => s + x.totalValue, 0);
  const productionCost = productionsInRange.reduce((s, x) => s + x.totalCost, 0);
  const lossValue = productionsInRange.reduce((s, x) => s + x.lossValue, 0);
  const destroyedValue = destructionsInRange.reduce((s, x) => s + x.value, 0);
  const clientDebtTotal = clientDebts.reduce((s, x) => s + x.rest, 0);
  const supplierDebtTotal = supplierDebts.reduce((s, x) => s + x.rest, 0);
  const stockValue = st.products.reduce((s, p) => s + p.currentQty * p.purchasePrice, 0);
  const caisseBalance =
    st.caisse.filter(c => c.type === 'deposit').reduce((s, c) => s + c.amount, 0)
    - st.caisse.filter(c => c.type === 'withdraw').reduce((s, c) => s + c.amount, 0)
    // L'argent rendu au client sur un retour est bien sorti du tiroir.
    + st.sales.reduce((s, x) => s + netCashOfSale(x), 0)
    - st.purchases.reduce((s, x) => s + x.paid, 0)
    - st.expenses.reduce((s, e) => s + e.amount, 0);
  const netGain = grossMargin - expensesTotal - salariesPaid - destroyedValue - lossValue;

  return {
    key, label: cfg.label, emoji: cfg.emoji, from, to,
    salesTotal, salesPaid, returnsTotal, refundedTotal, restockedCost,
    purchasesTotal, purchasesPaid, cogs, grossMargin,
    expensesTotal, salariesPaid, acomptesPeriod, productionValue, productionCost, lossValue, destroyedValue,
    clientDebtTotal, supplierDebtTotal, stockValue, caisseBalance, netGain,
    sales, purchases, salesByProduct, clientDebts, supplierDebts, expenses, expensesByCategory,
    stockAlerts, expiryAlerts, workers, caisse, destructions, productions, returns,
    counts: {
      products: st.products.length, clients: st.clients.length, suppliers: st.suppliers.length,
      sales: effectiveSales.length + repsInRange.length, purchases: purchasesInRange.length,
      workers: st.workers.length, returns: returns.length,
    },
  };
}

// ─── Carburant (fuel-station) report from the Supabase AppContext ─────────────
export function computeCarburantReport(app: any, from: string, to: string): PartReport {
  const products: any[] = app.products || [];
  const clients: any[] = app.clients || [];
  const suppliers: any[] = app.suppliers || [];
  const fuelSales: any[] = (app.fuelSales || []).filter((s: any) => within(s.date, from, to));
  const shopSales: any[] = (app.shopSales || []).filter((s: any) => within(s.date, from, to));
  const purchasesAll: any[] = app.purchases || [];
  const purchasesInRange = purchasesAll.filter((p: any) => within(p.date, from, to));
  const expensesInRange: any[] = (app.expenses || []).filter((e: any) => within(e.date, from, to));

  const prodById = new Map(products.map(p => [p.id, p]));
  const pumpById = new Map((app.pumps || []).map((p: any) => [p.id, p]));

  // Fuel by type (buy vs sell) — pump type drives the buy price (as in the Fiche Journalière).
  const fuelByType: Record<string, { qty: number; revenue: number; cost: number }> = {};
  fuelSales.forEach(s => {
    const type = (pumpById.get(s.pumpId) as any)?.type || s.fuelType || s.type || 'Carburant';
    (fuelByType[type] ||= { qty: 0, revenue: 0, cost: 0 });
    fuelByType[type].qty += s.liters || 0;
    fuelByType[type].revenue += s.total || 0;
    const buy = (app.settings?.fuelBuyPrices?.[type]) || 0;
    fuelByType[type].cost += (s.liters || 0) * buy;
  });
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
    ...Object.entries(fuelByType).map(([name, v]) => ({ name, qty: v.qty, unit: 'L', revenue: v.revenue, cost: v.cost, gain: v.revenue - v.cost })),
    ...Object.entries(shopByProduct).map(([name, v]) => ({ name, qty: v.qty, unit: v.unit, revenue: v.revenue, cost: v.cost, gain: v.revenue - v.cost })),
  ].sort((a, b) => b.revenue - a.revenue);

  // Shop invoices as sale rows (compact)
  const sales: SaleRow[] = shopSales.map(s => ({
    id: s.id, ref: s.id?.slice(0, 8) || '—', kind: 'Magasin', date: s.date, client: clients.find(c => c.id === s.clientId)?.name || 'Comptoir',
    total: s.total, paid: s.amountPaid ?? s.total, rest: s.rest ?? 0,
    items: (s.items || []).map((i: any) => ({ name: i.productName, qty: i.quantity, unitPrice: i.price, total: i.quantity * i.price })),
  })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const purchases: PurchaseRow[] = purchasesInRange.map((p: any) => ({
    id: p.id, ref: p.invoiceNumber || p.id?.slice(0, 8) || '—', date: p.date, supplier: suppliers.find(s => s.id === p.supplierId)?.name || '—',
    total: p.total, paid: p.amountPaid || 0, rest: p.rest || 0,
    items: (p.items || []).map((i: any) => ({ name: i.productName, qty: i.quantity, unitPrice: i.buyPrice, total: i.total ?? i.quantity * i.buyPrice })),
  })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const clientDebts: DebtRow[] = clients.filter(c => (c.debt || 0) > 0)
    .map(c => ({ id: c.id, ref: '—', name: c.name, date: '', total: c.debt, paid: 0, rest: c.debt }))
    .sort((a, b) => b.rest - a.rest);
  const supplierDebts: DebtRow[] = suppliers.filter(s => (s.balance || 0) > 0)
    .map(s => ({ id: s.id, ref: '—', name: s.name, date: '', total: s.balance, paid: 0, rest: s.balance }))
    .sort((a, b) => b.rest - a.rest);

  const expenses: ExpenseRow[] = expensesInRange.map((e: any) => ({ id: e.id, kind: 'Dépense' as const, label: e.category || 'Dépense', description: e.description, amount: e.amount, date: e.date }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const expByCat: Record<string, number> = {};
  expensesInRange.forEach((e: any) => { const k = e.category || 'Autre'; expByCat[k] = (expByCat[k] || 0) + e.amount; });
  const expensesByCategory = Object.entries(expByCat).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

  const stockAlerts: StockAlertRow[] = products.filter(p => typeof p.stock === 'number' && typeof p.minStock === 'number' && p.stock <= p.minStock)
    .map(p => ({ id: p.id, name: p.name, category: p.category, currentQty: p.stock, minQty: p.minStock, deficit: Math.max(0, p.minStock - p.stock), unit: p.unit, value: p.stock * (p.buyPrice || 0) }))
    .sort((a, b) => b.deficit - a.deficit);

  // Totals
  const salesTotal = fuelSales.reduce((s, x) => s + (x.total || 0), 0) + shopSales.reduce((s, x) => s + (x.total || 0), 0);
  const salesPaid = fuelSales.reduce((s, x) => s + (x.total || 0), 0) + shopSales.reduce((s, x) => s + (x.amountPaid ?? x.total ?? 0), 0);
  const purchasesTotal = purchasesInRange.reduce((s: number, x: any) => s + (x.total || 0), 0);
  const purchasesPaid = purchasesInRange.reduce((s: number, x: any) => s + (x.amountPaid || 0), 0);
  const cogs = salesByProduct.reduce((s, x) => s + x.cost, 0);
  const grossMargin = salesTotal - cogs;
  const expensesTotal = expensesInRange.reduce((s: number, x: any) => s + (x.amount || 0), 0);
  const clientDebtTotal = clientDebts.reduce((s, x) => s + x.rest, 0);
  const supplierDebtTotal = supplierDebts.reduce((s, x) => s + x.rest, 0);
  const stockValue = products.reduce((s, p) => s + (p.stock || 0) * (p.buyPrice || 0), 0);
  const netGain = grossMargin - expensesTotal;

  return {
    key: 'carburant', label: 'Carburant', emoji: '⛽', from, to,
    // La partie Carburant n'a pas de retour de marchandise : ses ventes sont
    // définitives (litres livrés), d'où des compteurs de retours à zéro.
    salesTotal, salesPaid, returnsTotal: 0, refundedTotal: 0, restockedCost: 0,
    purchasesTotal, purchasesPaid, cogs, grossMargin,
    expensesTotal, salariesPaid: 0, acomptesPeriod: 0, productionValue: 0, productionCost: 0, lossValue: 0, destroyedValue: 0,
    clientDebtTotal, supplierDebtTotal, stockValue, caisseBalance: salesPaid - purchasesPaid - expensesTotal, netGain,
    sales, purchases, salesByProduct, clientDebts, supplierDebts, expenses, expensesByCategory,
    stockAlerts, expiryAlerts: [], workers: [], caisse: [], destructions: [], productions: [], returns: [],
    counts: {
      products: products.length, clients: clients.length, suppliers: suppliers.length,
      sales: fuelSales.length + shopSales.length, purchases: purchasesInRange.length, workers: 0, returns: 0,
    },
  };
}

// ─── Consolidation of several parts ──────────────────────────────────────────
export interface GlobalReport {
  from: string; to: string;
  parts: PartReport[];
  salesTotal: number; purchasesTotal: number; expensesTotal: number; salariesPaid: number;
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
