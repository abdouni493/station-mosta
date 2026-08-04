/**
 * ─── Treasury Reporting Engine ─────────────────────────────────────────────────
 * Consolidates the money of the whole station into a single report:
 *
 *  • Caisse générale — le solde faisant foi, calculé sur le grand livre.
 *  • Comptes bancaires — solde d'ouverture + tous les mouvements, avec entrées,
 *    sorties et l'historique complet de chaque compte.
 *  • Caisse de chaque partie — Carburant, Cafétéria, Lavage — reconstituée à
 *    partir de ses propres documents.
 *  • Journal consolidé — chaque opération de la station (achats, ventes,
 *    interventions, dépenses, salaires, virements, dépôts, retraits,
 *    encaissements de brigade), avec sa nature, sa partie et ses comptes.
 *
 * Same source of truth as the *Caisse Générale* and *Comptes Bancaires* screens,
 * so the general report can never disagree with them.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, ModuleKey, MODULES, netCashOfSale } from './bizConfig';
import { within } from './bizReporting';

export const CAISSE_ID = 'CAISSE';

export type TreasuryPartKey = 'carburant' | 'cafeteria' | 'lavage' | 'systeme';

export const TX_LABEL: Record<string, string> = {
  DEPOSIT: 'Dépôt', WITHDRAW: 'Retrait', TRANSFER: 'Virement',
  PURCHASE: 'Achat', SALE: 'Vente', EXPENSE: 'Dépense',
  BRIGADE: 'Brigade', TPE: 'TPE', SALARY: 'Salaire', ADJUST: 'Ajustement',
};

export const TREASURY_PART_LABEL: Record<TreasuryPartKey, string> = {
  carburant: 'Carburant', cafeteria: 'Cafétéria', lavage: 'Lavage & Réparation', systeme: 'Finance',
};

// ─── Rows ────────────────────────────────────────────────────────────────────
export interface TreasuryMovement {
  id: string;
  date: string;
  nature: string;
  part: TreasuryPartKey;
  partLabel: string;
  label: string;
  /** Signed from the station's point of view: > 0 = encaissement. */
  amount: number;
  accounts?: string;
  reference?: string;
  /** True for ledger lines (editable in Caisse Générale), false for documents. */
  isLedger: boolean;
}

export interface TreasuryAccount {
  id: string; name: string; accountNumber?: string; notes?: string;
  initialBalance: number; balance: number;
  credit: number; debit: number; movesCount: number;
  /** Movements of this account over the period. */
  moves: { id: string; date: string; nature: string; label: string; counterpart: string; amount: number; reference?: string }[];
}

export interface TreasuryPartBalance {
  key: TreasuryPartKey; label: string;
  balance: number;
  inflow: number; outflow: number;
}

export interface TreasuryReport {
  from: string; to: string;
  caisseBalance: number;
  bankTotal: number;
  grandTotal: number;
  accounts: TreasuryAccount[];
  partBalances: TreasuryPartBalance[];
  movements: TreasuryMovement[];
  /** Period flows on the consolidated journal. */
  inflow: number; outflow: number; net: number;
  byNature: { nature: string; count: number; inflow: number; outflow: number; net: number }[];
  byPart: { part: TreasuryPartKey; label: string; inflow: number; outflow: number; net: number }[];
  counts: { accounts: number; movements: number; ledgerLines: number };
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const ledgerNetFor = (accountId: string, txs: any[]): number => {
  let net = 0;
  for (const t of txs) {
    if (t.accountTo === accountId) net += num(t.amount);
    if (t.accountFrom === accountId) net -= num(t.amount);
  }
  return net;
};

// ─── Entry point ─────────────────────────────────────────────────────────────
export function computeTreasuryReport(app: any, biz: BizState, from: string, to: string): TreasuryReport {
  const txs: any[] = app.treasuryTransactions || [];
  const bankAccounts: any[] = app.bankAccounts || [];
  const purchases: any[] = app.purchases || [];
  const expenses: any[] = app.expenses || [];
  const suppliers: any[] = app.suppliers || [];
  const brigades: any[] = app.brigades || [];
  const accountings: any[] = app.brigadeAccountings || [];

  // ── Balances (always the whole history — a solde is not a period figure) ──
  const caisseBalance = ledgerNetFor(CAISSE_ID, txs);
  const accName = (id?: string) => {
    if (!id) return 'Externe';
    if (id === CAISSE_ID) return 'Caisse générale';
    return bankAccounts.find(a => a.id === id)?.name || '—';
  };

  const accounts: TreasuryAccount[] = bankAccounts.map(a => {
    const all = txs.filter(t => t.accountFrom === a.id || t.accountTo === a.id);
    const inRange = all.filter(t => within(t.date, from, to));
    return {
      id: a.id, name: a.name, accountNumber: a.accountNumber, notes: a.notes,
      initialBalance: num(a.initialBalance),
      balance: num(a.initialBalance) + ledgerNetFor(a.id, txs),
      credit: inRange.filter(t => t.accountTo === a.id).reduce((s, t) => s + num(t.amount), 0),
      debit: inRange.filter(t => t.accountFrom === a.id).reduce((s, t) => s + num(t.amount), 0),
      movesCount: all.length,
      moves: inRange
        .sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())
        .map(t => {
          const isIn = t.accountTo === a.id;
          return {
            id: t.id, date: t.date, nature: TX_LABEL[t.kind] || t.kind,
            label: t.description || TX_LABEL[t.kind] || t.kind,
            counterpart: accName(isIn ? t.accountFrom : t.accountTo),
            amount: isIn ? num(t.amount) : -num(t.amount),
            reference: [t.chequeNumber && `Chèque ${t.chequeNumber}`, t.bordereauNumber && `Bordereau ${t.bordereauNumber}`]
              .filter(Boolean).join(' • ') || undefined,
          };
        }),
    };
  });
  const bankTotal = accounts.reduce((s, a) => s + a.balance, 0);

  // ── Consolidated journal ───────────────────────────────────────────────────
  const all: TreasuryMovement[] = [];
  const push = (m: Omit<TreasuryMovement, 'partLabel'>) =>
    all.push({ ...m, partLabel: TREASURY_PART_LABEL[m.part] });

  // 1. Treasury ledger — the only rows that move the caisse générale.
  for (const t of txs) {
    const nature = TX_LABEL[t.kind] || t.kind;
    let amount = num(t.amount);
    if (t.kind === 'WITHDRAW') amount = -amount;
    else if (t.kind === 'TRANSFER') amount = t.accountFrom === CAISSE_ID ? -amount : (t.accountTo === CAISSE_ID ? amount : 0);
    else if (['PURCHASE', 'EXPENSE', 'SALARY'].includes(t.kind)) amount = -amount;
    push({
      id: t.id, date: t.date, nature, part: (t.part || 'systeme') as TreasuryPartKey,
      label: t.description || nature, amount, isLedger: true,
      accounts: [t.accountFrom && accName(t.accountFrom), t.accountTo && accName(t.accountTo)].filter(Boolean).join(' → ') || undefined,
      reference: [t.chequeNumber && `Chèque ${t.chequeNumber}`, t.bordereauNumber && `Bordereau ${t.bordereauNumber}`]
        .filter(Boolean).join(' • ') || undefined,
    });
  }

  // 2. Fuel-part documents.
  for (const p of purchases) {
    push({
      id: `pur-${p.id}`, date: p.date, nature: 'Achat', part: 'carburant', isLedger: false,
      label: `Achat carburant ${p.invoiceNumber ? `n° ${p.invoiceNumber}` : ''} — ${suppliers.find(s => s.id === p.supplierId)?.name || 'Fournisseur'}`.trim(),
      amount: -num(p.amountPaid),
    });
  }
  for (const e of expenses) {
    push({
      id: `exp-${e.id}`, date: e.date, nature: 'Dépense', part: 'carburant', isLedger: false,
      label: `${e.category || 'Dépense'} — ${e.description || ''}`.trim(), amount: -num(e.amount),
    });
  }
  for (const a of accountings) {
    const br = brigades.find(b => b.id === a.brigadeId);
    push({
      id: `bri-${a.id}`, date: br?.startDatetime || br?.date || new Date().toISOString(),
      nature: 'Brigade', part: 'carburant', isLedger: false,
      label: `Encaissement brigade ${br ? `${br.shift}` : ''}`.trim(),
      amount: num(a.cashReceived),
    });
  }

  // 3. Business parts (Cafétéria / Lavage).
  (Object.keys(MODULES) as ModuleKey[]).forEach(key => {
    const m = biz[key];
    if (!m) return;
    const part = key as TreasuryPartKey;
    // `netCashOfSale` : une vente retournée n'a laissé dans le tiroir que ce qui
    // n'a pas été remboursé, une vente échangée rien du tout (le remplacement
    // porte l'encaissement). Le journal montre donc le mouvement RÉEL.
    (m.sales || []).forEach(s => push({
      id: `${key}-sale-${s.id}`, date: s.date, nature: 'Vente', part, isLedger: false,
      label: `Vente ${s.ref} — ${s.clientName}`
        + (s.status === 'retournée' ? ' (retournée)' : s.status === 'échangée' ? ' (échangée)' : ''),
      amount: netCashOfSale(s),
    }));
    (m.reparations || []).filter(r => r.paid > 0).forEach(r => push({
      id: `${key}-rep-${r.id}`, date: r.date, nature: 'Vente', part, isLedger: false,
      label: `${r.kind === 'lavage' ? 'Lavage' : r.kind === 'reparation' ? 'Réparation' : 'Lavage + Réparation'} ${r.ref} — ${r.clientName}`,
      amount: num(r.paid),
    }));
    (m.purchases || []).forEach(p => push({
      id: `${key}-pur-${p.id}`, date: p.date, nature: 'Achat', part, isLedger: false,
      label: `Achat ${p.ref} — ${p.supplierName}`, amount: -num(p.paid),
    }));
    (m.expenses || []).forEach(e => push({
      id: `${key}-exp-${e.id}`, date: e.date, nature: 'Dépense', part, isLedger: false,
      label: `${e.name}${e.description ? ` — ${e.description}` : ''}`, amount: -num(e.amount),
    }));
    (m.caisse || []).forEach(c => push({
      id: `${key}-csh-${c.id}`, date: c.date, part, isLedger: false,
      nature: c.type === 'deposit' ? 'Dépôt' : 'Retrait',
      label: c.description || (c.type === 'deposit' ? 'Dépôt de caisse' : 'Retrait de caisse'),
      amount: c.type === 'deposit' ? num(c.amount) : -num(c.amount),
    }));
    (m.workers || []).forEach(w => (w.payments || []).forEach(pay => push({
      id: `${key}-pay-${pay.id}`, date: pay.date, nature: 'Salaire', part, isLedger: false,
      label: `Salaire ${w.name} — ${pay.period}`, amount: -num(pay.amount),
    })));
  });

  const movements = all
    .filter(m => within(m.date, from, to))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // ── Cash position of each part (all dates — it is a solde) ────────────────
  const partBalance = (key: ModuleKey): number => {
    const m = biz[key];
    if (!m) return 0;
    const dep = (m.caisse || []).filter(c => c.type === 'deposit').reduce((s, c) => s + num(c.amount), 0);
    const wit = (m.caisse || []).filter(c => c.type === 'withdraw').reduce((s, c) => s + num(c.amount), 0);
    const salesPaid = (m.sales || []).reduce((s, x) => s + netCashOfSale(x), 0);
    const repPaid = (m.reparations || []).reduce((s, r) => s + num(r.paid), 0);
    const purPaid = (m.purchases || []).reduce((s, x) => s + num(x.paid), 0);
    const exp = (m.expenses || []).reduce((s, x) => s + num(x.amount), 0);
    const sal = (m.workers || []).reduce((s, w) => s + (w.payments || []).reduce((a, p) => a + num(p.amount), 0), 0);
    return dep + salesPaid + repPaid - wit - purPaid - exp - sal;
  };
  const carburantBalance =
    accountings.reduce((s, a) => s + num(a.cashReceived), 0)
    - purchases.reduce((s, p) => s + num(p.amountPaid), 0)
    - expenses.reduce((s, e) => s + num(e.amount), 0);

  const flowsOf = (key: TreasuryPartKey) => {
    const rows = movements.filter(m => m.part === key);
    return {
      inflow: rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0),
      outflow: rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0),
    };
  };

  const partBalances: TreasuryPartBalance[] = [
    { key: 'carburant', label: TREASURY_PART_LABEL.carburant, balance: carburantBalance, ...flowsOf('carburant') },
    { key: 'cafeteria', label: TREASURY_PART_LABEL.cafeteria, balance: partBalance('cafeteria'), ...flowsOf('cafeteria') },
    { key: 'lavage', label: TREASURY_PART_LABEL.lavage, balance: partBalance('lavage'), ...flowsOf('lavage') },
    { key: 'systeme', label: TREASURY_PART_LABEL.systeme, balance: caisseBalance + bankTotal, ...flowsOf('systeme') },
  ];

  // ── Break-downs ───────────────────────────────────────────────────────────
  const natureMap = new Map<string, { count: number; inflow: number; outflow: number }>();
  movements.forEach(m => {
    const e = natureMap.get(m.nature) || { count: 0, inflow: 0, outflow: 0 };
    e.count += 1;
    if (m.amount >= 0) e.inflow += m.amount; else e.outflow += -m.amount;
    natureMap.set(m.nature, e);
  });
  const byNature = Array.from(natureMap.entries())
    .map(([nature, v]) => ({ nature, ...v, net: v.inflow - v.outflow }))
    .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));

  const byPart = (Object.keys(TREASURY_PART_LABEL) as TreasuryPartKey[]).map(part => {
    const f = flowsOf(part);
    return { part, label: TREASURY_PART_LABEL[part], inflow: f.inflow, outflow: f.outflow, net: f.inflow - f.outflow };
  });

  const inflow = movements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0);
  const outflow = movements.filter(m => m.amount < 0).reduce((s, m) => s - m.amount, 0);

  return {
    from, to,
    caisseBalance, bankTotal, grandTotal: caisseBalance + bankTotal,
    accounts, partBalances, movements,
    inflow, outflow, net: inflow - outflow,
    byNature, byPart,
    counts: {
      accounts: accounts.length,
      movements: movements.length,
      ledgerLines: movements.filter(m => m.isLedger).length,
    },
  };
}
