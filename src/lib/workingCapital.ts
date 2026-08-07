/**
 * ─── Fonds de roulement ────────────────────────────────────────────────────────
 * Ce que la station possède vraiment, à l'instant T :
 *
 *      TRÉSORERIE ( caisse générale + comptes bancaires )
 *    + CRÉANCES   ( ce que les clients doivent encore )
 *    + STOCK      ( carburant en cuve + marchandise, AU PRIX D'ACHAT )
 *    − DETTES     ( ce que la station doit à ses fournisseurs )
 *    ─────────────────────────────────────────────────────────────────
 *    = FONDS DE ROULEMENT
 *
 * Le STOCK entre désormais DANS le total : le carburant qui dort dans les cuves
 * et la marchandise des parties commerciales ont été payés, ils appartiennent à
 * la station, et un gérant qui demande « qu'est-ce que je possède ? » veut les y
 * voir. Ils sont comptés à leur PRIX D'ACHAT — jamais au prix de vente : la
 * marge n'existe pas tant que rien n'est vendu.
 *
 * Le fonds de roulement PUREMENT FINANCIER (hors stock) reste calculé à part
 * (`financialWorkingCapital`) pour qui veut la trésorerie disponible seule.
 *
 * Chaque terme est détaillé jusqu'à la ligne : un compte bancaire par compte
 * (avec son solde d'ouverture et ses mouvements), la caisse de chaque activité,
 * chaque client débiteur avec sa facture, chaque fournisseur avec la sienne,
 * chaque cuve et chaque référence en stock.
 *
 * Aucun calcul n'est réinventé ici : les soldes viennent de `treasuryReporting`,
 * les dettes des `PartReport` et le stock de `stockValuation` — les mêmes
 * chiffres que les écrans Caisse Générale, Comptes Bancaires, Clients,
 * Fournisseurs et Valeur du stock.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { PartReport } from './bizReporting';
import { TreasuryReport, TreasuryAccount } from './treasuryReporting';
import { StockValuation } from './stockValuation';

/** Une ligne détaillée d'un bloc (un compte, un client, un fournisseur…). */
export interface WCRow {
  id: string;
  label: string;
  sub?: string;
  date?: string;
  amount: number;
  /** Partie d'origine, pour le regroupement et le filtrage à l'écran. */
  partKey?: string;
  partLabel?: string;
  emoji?: string;
  /**
   * Ligne montrée mais NON additionnée : la position de caisse d'une activité,
   * reconstituée depuis ses propres documents, recoupe déjà ce que le grand
   * livre a enregistré. L'ajouter au total compterait le même argent deux fois.
   */
  informational?: boolean;
}

/** Un sous-ensemble homogène : « Comptes bancaires », « Dettes clients »… */
export interface WCBlock {
  key: string;
  label: string;
  hint: string;
  total: number;
  rows: WCRow[];
  /** Sens dans le calcul : +1 ajoute au fonds de roulement, −1 le retranche. */
  sign: 1 | -1;
  /** Précision affichée sous le détail du bloc. */
  note?: string;
}

/** Résumé d'une activité — la ligne du tableau « Détail par activité ». */
export interface WCPart {
  key: string;
  label: string;
  emoji: string;
  /** Position de caisse reconstituée (indicative, hors total général). */
  cash: number;
  receivables: number;
  payables: number;
  /** Marchandise / carburant de l'activité, au prix d'achat. */
  stockValue: number;
  /** caisse + créances − dettes (sans le stock) — le net financier. */
  net: number;
  /** caisse + créances + stock − dettes — TOTAL réel de l'activité. */
  total: number;
}

export interface WorkingCapitalReport {
  from: string;
  to: string;

  /** Caisse générale + caisses des parties. */
  cash: WCBlock;
  /** Comptes bancaires, un par ligne. */
  banks: WCBlock;
  /** Encours clients (toutes dates) — de l'argent qui n'est pas encore rentré. */
  receivables: WCBlock;
  /** Carburant en cuve + marchandise en stock, au prix d'achat. */
  stock: WCBlock;
  /** Encours fournisseurs (toutes dates) — de l'argent déjà dépensé. */
  payables: WCBlock;

  cashTotal: number;
  bankTotal: number;
  /** Trésorerie immédiate : caisse(s) + banques. */
  treasuryTotal: number;
  receivablesTotal: number;
  payablesTotal: number;
  /** Marchandise en stock, au prix d'achat — COMPTÉE dans le fonds de roulement. */
  stockValue: number;
  /** Carburant en cuve seul (sous-ensemble de `stockValue`). */
  fuelStockValue: number;
  /** Marchandise des catalogues / comptoirs (sous-ensemble de `stockValue`). */
  goodsStockValue: number;
  /** Trésorerie + créances + stock − dettes. */
  workingCapital: number;
  /** Trésorerie + créances − dettes : le fonds de roulement HORS stock. */
  financialWorkingCapital: number;
  /** Créances − dettes : ce que le crédit accordé coûte (ou rapporte). */
  netCredit: number;

  /** Détail des comptes bancaires (mouvements de la période inclus). */
  accounts: TreasuryAccount[];
  /** Résumé par activité : trésorerie, créances, dettes, stock, net, total. */
  parts: WCPart[];
  /** Ratio de liquidité : (trésorerie + créances) ÷ dettes. */
  liquidityRatio: number | null;
  /** Couverture des dettes par TOUT l'actif circulant, stock compris. */
  coverageRatio: number | null;
}

/** Seules les lignes retenues comptent — les lignes informatives sont hors total. */
const sum = (rows: WCRow[]) => rows.reduce((s, r) => (r.informational ? s : s + r.amount), 0);

const block = (key: string, label: string, hint: string, rows: WCRow[], sign: 1 | -1, note?: string): WCBlock =>
  ({ key, label, hint, rows, total: sum(rows), sign, note });

/**
 * Assemble le fonds de roulement à partir des rapports déjà calculés — jamais à
 * partir des données brutes, pour qu'il ne puisse jamais diverger d'eux.
 */
export function computeWorkingCapital(
  treasury: TreasuryReport,
  parts: PartReport[],
  stock?: StockValuation,
): WorkingCapitalReport {
  const partMeta = new Map(parts.map(p => [p.key, { label: p.label, emoji: p.emoji }]));
  const metaOf = (key: string) => partMeta.get(key) || { label: key, emoji: '•' };

  // ── Caisses ───────────────────────────────────────────────────────────────
  // Le solde qui FAIT FOI est celui du grand livre : c'est lui que comptent la
  // Caisse Générale et la section Caisse & Banques, et c'est donc lui qui entre
  // ici. La position de caisse de chaque activité est reconstituée depuis ses
  // propres documents (encaissements, achats payés, dépenses) : elle recoupe le
  // grand livre dès qu'un versement y a été enregistré. Elle est affichée pour
  // que le gérant sache d'où vient l'argent, mais JAMAIS additionnée — sinon la
  // même recette serait comptée deux fois et cet écran contredirait les autres.
  const cashRows: WCRow[] = [
    {
      id: 'caisse-generale',
      label: 'Caisse générale',
      sub: 'Solde du grand livre — dépôts, retraits et virements',
      amount: treasury.caisseBalance,
      partKey: 'systeme',
      partLabel: 'Finance',
      emoji: '🏦',
    },
    ...treasury.partBalances
      // `systeme` est la somme caisse + banques : la reprendre ici la compterait
      // une deuxième fois.
      .filter(p => p.key !== 'systeme')
      .map(p => ({
        id: `caisse-${p.key}`,
        label: `Caisse ${p.label}`,
        sub: `Position reconstituée sur ses documents · encaissements ${fmt(p.inflow)} · décaissements ${fmt(p.outflow)} sur la période`,
        amount: p.balance,
        partKey: p.key,
        partLabel: p.label,
        emoji: metaOf(p.key).emoji,
        informational: true,
      })),
  ];

  // ── Comptes bancaires ─────────────────────────────────────────────────────
  const bankRows: WCRow[] = treasury.accounts.map(a => ({
    id: `bank-${a.id}`,
    label: a.name,
    sub: [
      a.accountNumber ? `N° ${a.accountNumber}` : null,
      `Ouverture ${fmt(a.initialBalance)}`,
      `${a.movesCount} mouvement(s)`,
      a.credit || a.debit ? `+${fmt(a.credit)} / −${fmt(a.debit)} sur la période` : null,
    ].filter(Boolean).join(' · '),
    amount: a.balance,
    partKey: 'systeme',
    partLabel: 'Banque',
    emoji: '🏛️',
  }));

  // ── Créances clients — chaque facture impayée, partie par partie ──────────
  const receivableRows: WCRow[] = parts.flatMap(p => p.clientDebts.map(d => ({
    id: `rec-${p.key}-${d.id}`,
    label: d.name,
    sub: [d.ref && d.ref !== '—' ? `Facture ${d.ref}` : null,
      d.total ? `Total ${fmt(d.total)} · payé ${fmt(d.paid)}` : null].filter(Boolean).join(' · ') || undefined,
    date: d.date || undefined,
    amount: d.rest,
    partKey: p.key,
    partLabel: p.label,
    emoji: p.emoji,
  }))).sort((a, b) => b.amount - a.amount);

  // ── Dettes fournisseurs ───────────────────────────────────────────────────
  const payableRows: WCRow[] = parts.flatMap(p => p.supplierDebts.map(d => ({
    id: `pay-${p.key}-${d.id}`,
    label: d.name,
    sub: [d.ref && d.ref !== '—' ? `Facture ${d.ref}` : null,
      d.total ? `Total ${fmt(d.total)} · payé ${fmt(d.paid)}` : null].filter(Boolean).join(' · ') || undefined,
    date: d.date || undefined,
    amount: d.rest,
    partKey: p.key,
    partLabel: p.label,
    emoji: p.emoji,
  }))).sort((a, b) => b.amount - a.amount);

  // ── Stock — carburant en cuve ET marchandise, au PRIX D'ACHAT ─────────────
  // Une ligne par cuve et par référence : le gérant retrouve exactement ce qui
  // compose la valeur, et d'où elle vient. Les lignes à valeur nulle (référence
  // à zéro) ne sont pas listées, elles n'apportent rien.
  const stockRows: WCRow[] = (stock?.parts || []).flatMap(p =>
    p.sections.flatMap(sec => sec.lines
      .filter(l => l.buyValue !== 0)
      .map(l => ({
        id: `stk-${p.key}-${sec.key}-${l.id}`,
        label: l.name,
        sub: [
          sec.label,
          `${l.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${l.unit || ''}`.trim()
            + ` × ${fmt(l.buyPrice)} (prix d'achat)`,
          l.negative ? 'stock à découvert' : l.low ? 'sous le seuil d\'alerte' : null,
        ].filter(Boolean).join(' · '),
        amount: l.buyValue,
        partKey: p.key,
        partLabel: p.label,
        emoji: p.emoji,
      })),
    ),
  ).sort((a, b) => b.amount - a.amount);

  const cash = block('cash', 'Caisse générale', 'Argent liquide — solde du grand livre', cashRows, 1,
    'Seule la caisse générale est comptée. Les caisses des activités, en dessous, sont la position reconstituée '
    + 'sur leurs propres documents : elles expliquent d\'où vient l\'argent, mais les additionner compterait deux '
    + 'fois les recettes déjà versées au grand livre.');
  const banks = block('banks', 'Comptes bancaires', 'Solde d\'ouverture + tous les mouvements enregistrés', bankRows, 1);
  const receivables = block('receivables', 'Créances clients', 'Ventes à crédit non encore encaissées', receivableRows, 1);
  const stockBlock = block('stock', 'Stock (carburant & marchandise)',
    'Litres en cuve et marchandise du catalogue, au prix d\'achat', stockRows, 1,
    'Compté au PRIX D\'ACHAT, jamais au prix de vente : la marge n\'existe qu\'une fois la marchandise vendue. '
    + 'Cette valeur entre bien dans le fonds de roulement — c\'est de l\'argent déjà dépensé qui appartient à la station.');
  const payables = block('payables', 'Dettes fournisseurs', 'Achats reçus et non encore réglés', payableRows, -1);

  const cashTotal = cash.total;
  const bankTotal = banks.total;
  const treasuryTotal = cashTotal + bankTotal;
  const stockValue = stock ? stock.buyValue : parts.reduce((s, p) => s + p.stockValue, 0);
  const fuelStockValue = (stock?.parts || [])
    .filter(p => p.key === 'carburant')
    .reduce((s, p) => s + p.buyValue, 0);
  const goodsStockValue = stockValue - fuelStockValue;

  const financialWorkingCapital = treasuryTotal + receivables.total - payables.total;
  const workingCapital = financialWorkingCapital + stockValue;

  const stockByPart = new Map((stock?.parts || []).map(p => [p.key, p.buyValue]));

  const partRows: WCPart[] = parts.map(p => {
    const partCash = treasury.partBalances.find(b => b.key === p.key)?.balance ?? p.caisseBalance;
    const rec = p.clientDebtTotal;
    const pay = p.supplierDebtTotal;
    const stk = stockByPart.get(p.key) ?? p.stockValue;
    return {
      key: p.key, label: p.label, emoji: p.emoji,
      cash: partCash,
      receivables: rec,
      payables: pay,
      stockValue: stk,
      net: partCash + rec - pay,
      total: partCash + rec + stk - pay,
    };
  });

  return {
    from: treasury.from, to: treasury.to,
    cash, banks, receivables, stock: stockBlock, payables,
    cashTotal, bankTotal, treasuryTotal,
    receivablesTotal: receivables.total,
    payablesTotal: payables.total,
    stockValue, fuelStockValue, goodsStockValue,
    workingCapital,
    financialWorkingCapital,
    netCredit: receivables.total - payables.total,
    accounts: treasury.accounts,
    parts: partRows,
    liquidityRatio: payables.total > 0 ? (treasuryTotal + receivables.total) / payables.total : null,
    coverageRatio: payables.total > 0 ? (treasuryTotal + receivables.total + stockValue) / payables.total : null,
  };
}

/**
 * Restreint un rapport à UNE activité — c'est le filtre « par partie » de
 * l'écran. Chaque bloc ne garde que ses lignes, et tous les totaux sont
 * recalculés depuis ces lignes : rien n'est réécrit à la main, donc le filtre ne
 * peut pas afficher un total qui ne correspond pas à ce qu'il montre.
 *
 * `partKey` vaut `'all'` (aucun filtre) ou la clé d'une activité. Les comptes
 * bancaires et la caisse générale appartiennent à la clé `systeme` : ils ne sont
 * conservés que sur « Toutes les activités » et sur « Finance ».
 */
export function filterWorkingCapital(
  report: WorkingCapitalReport,
  partKey: string,
): WorkingCapitalReport {
  if (!partKey || partKey === 'all') return report;

  const keep = (rows: WCRow[]) => rows.filter(r => (r.partKey || 'systeme') === partKey);
  const rebuild = (b: WCBlock): WCBlock => {
    const rows = keep(b.rows);
    return { ...b, rows, total: sum(rows) };
  };

  const cash = rebuild(report.cash);
  const banks = rebuild(report.banks);
  const receivables = rebuild(report.receivables);
  const stockBlock = rebuild(report.stock);
  const payables = rebuild(report.payables);

  const cashTotal = cash.total;
  const bankTotal = banks.total;
  const treasuryTotal = cashTotal + bankTotal;
  const stockValue = stockBlock.total;
  const financialWorkingCapital = treasuryTotal + receivables.total - payables.total;
  const accounts = partKey === 'systeme' ? report.accounts : [];
  const parts = report.parts.filter(p => p.key === partKey);

  return {
    ...report,
    cash, banks, receivables, stock: stockBlock, payables,
    cashTotal, bankTotal, treasuryTotal,
    receivablesTotal: receivables.total,
    payablesTotal: payables.total,
    stockValue,
    fuelStockValue: partKey === 'carburant' ? stockValue : 0,
    goodsStockValue: partKey === 'carburant' ? 0 : stockValue,
    workingCapital: financialWorkingCapital + stockValue,
    financialWorkingCapital,
    netCredit: receivables.total - payables.total,
    accounts,
    parts,
    liquidityRatio: payables.total > 0 ? (treasuryTotal + receivables.total) / payables.total : null,
    coverageRatio: payables.total > 0 ? (treasuryTotal + receivables.total + stockValue) / payables.total : null,
  };
}

/** Montant court, sans décimales — uniquement pour les sous-titres. */
function fmt(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} DA`;
}
