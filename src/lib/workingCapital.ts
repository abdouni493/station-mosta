/**
 * ─── Fonds de roulement ────────────────────────────────────────────────────────
 * Ce que la station possède vraiment de disponible, à l'instant T :
 *
 *      TRÉSORERIE ( caisse générale + caisses des parties + comptes bancaires )
 *    + CRÉANCES   ( ce que les clients doivent encore )
 *    − DETTES     ( ce que la station doit à ses fournisseurs )
 *    ─────────────────────────────────────────────────────────────────
 *    = FONDS DE ROULEMENT
 *
 * Chaque terme est détaillé jusqu'à la ligne : un compte bancaire par compte
 * (avec son solde d'ouverture et ses mouvements), la caisse de chaque activité,
 * chaque client débiteur avec sa facture, chaque fournisseur avec la sienne.
 * La valeur du stock est calculée à part et affichée HORS du total : c'est de la
 * marchandise, pas de l'argent disponible — mais le gérant veut la voir.
 *
 * Aucun calcul n'est réinventé ici : les soldes viennent de `treasuryReporting`
 * et les dettes des `PartReport` — les mêmes chiffres que les écrans Caisse
 * Générale, Comptes Bancaires, Clients et Fournisseurs.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { PartReport } from './bizReporting';
import { TreasuryReport, TreasuryAccount } from './treasuryReporting';

/** Une ligne détaillée d'un bloc (un compte, un client, un fournisseur…). */
export interface WCRow {
  id: string;
  label: string;
  sub?: string;
  date?: string;
  amount: number;
  /** Partie d'origine, pour le regroupement à l'écran. */
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

export interface WorkingCapitalReport {
  from: string;
  to: string;

  /** Caisse générale + caisses des parties. */
  cash: WCBlock;
  /** Comptes bancaires, un par ligne. */
  banks: WCBlock;
  /** Encours clients (toutes dates) — de l'argent qui n'est pas encore rentré. */
  receivables: WCBlock;
  /** Encours fournisseurs (toutes dates) — de l'argent déjà dépensé. */
  payables: WCBlock;

  cashTotal: number;
  bankTotal: number;
  /** Trésorerie immédiate : caisse(s) + banques. */
  treasuryTotal: number;
  receivablesTotal: number;
  payablesTotal: number;
  /** Trésorerie + créances − dettes. */
  workingCapital: number;
  /** Créances − dettes : ce que le crédit accordé coûte (ou rapporte). */
  netCredit: number;

  /** Marchandise en stock, au prix d'achat — informatif, HORS du total. */
  stockValue: number;
  /** Fonds de roulement + stock, pour qui veut l'actif circulant complet. */
  withStock: number;

  /** Détail des comptes bancaires (mouvements de la période inclus). */
  accounts: TreasuryAccount[];
  /** Résumé par activité : trésorerie, créances, dettes, net. */
  parts: {
    key: string; label: string; emoji: string;
    cash: number; receivables: number; payables: number; stockValue: number; net: number;
  }[];
  /** Ratio de liquidité : (trésorerie + créances) ÷ dettes. */
  liquidityRatio: number | null;
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
  stock?: { parts: { key: string; buyValue: number }[]; buyValue: number },
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

  const cash = block('cash', 'Caisse générale', 'Argent liquide — solde du grand livre', cashRows, 1,
    'Seule la caisse générale est comptée. Les caisses des activités, en dessous, sont la position reconstituée '
    + 'sur leurs propres documents : elles expliquent d\'où vient l\'argent, mais les additionner compterait deux '
    + 'fois les recettes déjà versées au grand livre.');
  const banks = block('banks', 'Comptes bancaires', 'Solde d\'ouverture + tous les mouvements enregistrés', bankRows, 1);
  const receivables = block('receivables', 'Créances clients', 'Ventes à crédit non encore encaissées', receivableRows, 1);
  const payables = block('payables', 'Dettes fournisseurs', 'Achats reçus et non encore réglés', payableRows, -1);

  const cashTotal = cash.total;
  const bankTotal = banks.total;
  const treasuryTotal = cashTotal + bankTotal;
  const workingCapital = treasuryTotal + receivables.total - payables.total;
  const stockValue = stock?.buyValue ?? parts.reduce((s, p) => s + p.stockValue, 0);
  const stockByPart = new Map((stock?.parts || []).map(p => [p.key, p.buyValue]));

  const partRows = parts.map(p => {
    const partCash = treasury.partBalances.find(b => b.key === p.key)?.balance ?? p.caisseBalance;
    const rec = p.clientDebtTotal;
    const pay = p.supplierDebtTotal;
    return {
      key: p.key, label: p.label, emoji: p.emoji,
      cash: partCash,
      receivables: rec,
      payables: pay,
      stockValue: stockByPart.get(p.key) ?? p.stockValue,
      net: partCash + rec - pay,
    };
  });

  return {
    from: treasury.from, to: treasury.to,
    cash, banks, receivables, payables,
    cashTotal, bankTotal, treasuryTotal,
    receivablesTotal: receivables.total,
    payablesTotal: payables.total,
    workingCapital,
    netCredit: receivables.total - payables.total,
    stockValue,
    withStock: workingCapital + stockValue,
    accounts: treasury.accounts,
    parts: partRows,
    liquidityRatio: payables.total > 0 ? (treasuryTotal + receivables.total) / payables.total : null,
  };
}

/** Montant court, sans décimales — uniquement pour les sous-titres. */
function fmt(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} DA`;
}
