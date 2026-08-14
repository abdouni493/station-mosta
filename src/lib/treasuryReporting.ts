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

/**
 * Les coffres de chaque activité (mêmes identifiants que `AppContext`). Un
 * virement au départ de l'un d'eux est une SORTIE d'espèces : sans eux, le
 * rapport comptait ces virements pour zéro et la caisse de l'activité restait
 * gonflée de l'argent déjà parti en banque.
 */
export const CAISSE_PART_ID = {
  carburant: 'CAISSE_CARBURANT',
  cafeteria: 'CAISSE_CAFETERIA',
  lavage: 'CAISSE_LAVAGE',
} as const;

export const CASH_ACCOUNT_IDS: string[] = [CAISSE_ID, ...Object.values(CAISSE_PART_ID)];

export const CASH_ACCOUNT_LABEL: Record<string, string> = {
  [CAISSE_ID]: 'Caisse générale',
  [CAISSE_PART_ID.carburant]: 'Caisse Carburant',
  [CAISSE_PART_ID.cafeteria]: 'Caisse Cafétéria',
  [CAISSE_PART_ID.lavage]: 'Caisse Lavage & Réparation',
};

const isCashAccount = (id?: string): boolean => !!id && CASH_ACCOUNT_IDS.includes(id);

export type TreasuryPartKey = 'carburant' | 'cafeteria' | 'lavage' | 'systeme';

export const TX_LABEL: Record<string, string> = {
  DEPOSIT: 'Dépôt', WITHDRAW: 'Retrait', TRANSFER: 'Virement',
  PURCHASE: 'Achat', SALE: 'Vente', EXPENSE: 'Dépense',
  BRIGADE: 'Brigade', TPE: 'TPE', SALARY: 'Salaire', ADJUST: 'Ajustement',
};

/** Document qui a écrit la ligne — pour que le détail dise d'où vient l'argent. */
export const ORIGIN_LABEL: Record<string, string> = {
  purchase: 'Achat carburant', expense: 'Dépense', brigade: 'Brigade',
  client_payment: 'Règlement client',
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
  /**
   * Solde du compte la VEILLE du début de période — le point de départ dont
   * `credit` et `debit` expliquent l'écart avec `balance`. Sans lui, la carte
   * affichait un solde que rien à l'écran ne rattachait à la période choisie.
   */
  openingBalance: number;
  credit: number; debit: number; movesCount: number;
  /** Movements of this account over the period. */
  moves: { id: string; date: string; nature: string; label: string; counterpart: string; amount: number; reference?: string }[];
}

export interface TreasuryPartBalance {
  key: TreasuryPartKey; label: string;
  balance: number;
  inflow: number; outflow: number;
}

// ─── Caisse générale : le solde, expliqué mouvement par mouvement ────────────
/** Un mouvement qui touche la caisse générale, vu DEPUIS la caisse. */
export interface CaisseLine {
  id: string;
  date: string;
  nature: string;
  label: string;
  /** L'autre bout du mouvement : d'où l'argent vient, ou où il est parti. */
  counterpart: string;
  /** Signé sur la caisse : > 0 = espèces entrées, < 0 = espèces sorties. */
  amount: number;
  reference?: string;
  part: TreasuryPartKey;
  partLabel: string;
  /** Document d'origine (achat, dépense, brigade…) quand la ligne en a un. */
  origin?: string;
  /** Place du mouvement par rapport à la période lue. */
  bucket: 'avant' | 'periode' | 'apres';
}

/** Tous les mouvements de même nature et de même sens, additionnés. */
export interface CaisseGroup {
  key: string;
  label: string;
  direction: 'in' | 'out';
  count: number;
  /** Toujours positif — le sens est porté par `direction`. */
  total: number;
  lines: CaisseLine[];
}

/**
 * Le calcul complet du solde de la caisse générale :
 *
 *     ouverture + entrées − sorties = solde de fin de période
 *                        ( + mouvements postérieurs ) = solde d'aujourd'hui
 *
 * Chaque terme est décomposé par nature puis jusqu'à la ligne, pour qu'un solde
 * négatif se lise et s'explique au lieu d'être subi.
 */
export interface CaisseBreakdown {
  /** Solde de la caisse la veille du début de période. */
  opening: number;
  in: number;
  out: number;
  /** ouverture + entrées − sorties. */
  periodEnd: number;
  /** Mouvements POSTÉRIEURS à la période — ils comptent dans le solde réel. */
  after: number;
  /** Le solde d'aujourd'hui : `periodEnd + after`. */
  balance: number;
  groups: CaisseGroup[];
  lines: CaisseLine[];
  openingLines: CaisseLine[];
  afterLines: CaisseLine[];
  counts: { period: number; in: number; out: number; before: number; after: number };
}

export interface TreasuryReport {
  from: string; to: string;
  caisseBalance: number;
  bankTotal: number;
  grandTotal: number;
  /** Caisse générale à l'ouverture de la période, et ses flux sur la période. */
  caisseOpening: number;
  caisseIn: number;
  caisseOut: number;
  /** Le solde de la caisse générale expliqué jusqu'à la ligne. */
  caisseDetail: CaisseBreakdown;
  /** Total des comptes bancaires à l'ouverture de la période, et leurs flux. */
  bankOpening: number;
  bankIn: number;
  bankOut: number;
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
  // Le solde reste le solde RÉEL, toutes dates confondues : ce qu'il y a dans la
  // caisse aujourd'hui ne dépend pas de la fenêtre regardée. Ce qui manquait,
  // c'est le lien avec la période — d'où l'ouverture et les flux ci-dessous, qui
  // rendent l'écart lisible : ouverture + entrées − sorties = solde.
  const caisseBalance = ledgerNetFor(CAISSE_ID, txs);
  /** Mouvements ANTÉRIEURS au début de la période (rien si aucune borne). */
  const beforeFrom = (t: any) => !!from && new Date(t.date).getTime() < new Date(from).getTime();
  const txsBefore = txs.filter(beforeFrom);
  const txsInRange = txs.filter(t => within(t.date, from, to));
  const caisseOpening = ledgerNetFor(CAISSE_ID, txsBefore);
  const caisseIn = txsInRange.filter(t => t.accountTo === CAISSE_ID).reduce((s, t) => s + num(t.amount), 0);
  const caisseOut = txsInRange.filter(t => t.accountFrom === CAISSE_ID).reduce((s, t) => s + num(t.amount), 0);
  const accName = (id?: string) => {
    if (!id) return 'Externe';
    return CASH_ACCOUNT_LABEL[id] || bankAccounts.find(a => a.id === id)?.name || '—';
  };
  const refOf = (t: any) =>
    [t.chequeNumber && `Chèque ${t.chequeNumber}`, t.bordereauNumber && `Bordereau ${t.bordereauNumber}`]
      .filter(Boolean).join(' • ') || undefined;

  // ── Le solde de la caisse, expliqué ───────────────────────────────────────
  // Le chiffre affiché ne se discute pas : c'est la somme des mouvements du
  // grand livre qui touchent la caisse. Ce qui manquait, c'est de pouvoir le
  // VÉRIFIER — d'où le découpage en trois temps (avant / pendant / après la
  // période) puis par nature, jusqu'à la ligne. Les trois temps forment une
  // partition de tous les mouvements de la caisse : leur somme est donc, par
  // construction, exactement le solde ci-dessus.
  const caisseLineOf = (t: any, bucket: CaisseLine['bucket']): CaisseLine => {
    const isIn = t.accountTo === CAISSE_ID;
    const nature = TX_LABEL[t.kind] || t.kind;
    const part = (t.part || 'systeme') as TreasuryPartKey;
    return {
      id: t.id, date: t.date, nature,
      label: t.description || nature,
      counterpart: accName(isIn ? t.accountFrom : t.accountTo),
      amount: isIn ? num(t.amount) : -num(t.amount),
      reference: refOf(t),
      part, partLabel: TREASURY_PART_LABEL[part] || TREASURY_PART_LABEL.systeme,
      origin: t.refType ? (ORIGIN_LABEL[t.refType] || t.refType) : undefined,
      bucket,
    };
  };
  const byDateDesc = (a: { date: string }, b: { date: string }) =>
    new Date(b.date).getTime() - new Date(a.date).getTime();
  /** Un mouvement ne touche la caisse que par UN seul de ses deux comptes. */
  const caisseTxs = txs.filter(t =>
    (t.accountTo === CAISSE_ID) !== (t.accountFrom === CAISSE_ID));
  const caisseOpeningLines = caisseTxs.filter(beforeFrom).map(t => caisseLineOf(t, 'avant')).sort(byDateDesc);
  const caissePeriodLines = caisseTxs.filter(t => within(t.date, from, to)).map(t => caisseLineOf(t, 'periode')).sort(byDateDesc);
  // Tout ce qui n'est ni avant ni dans la période lui est postérieur : ces
  // mouvements sont dans le solde réel sans être dans les flux de la période.
  // Sans eux, « ouverture + entrées − sorties » ne retombait pas sur le solde.
  const caisseAfterLines = caisseTxs
    .filter(t => !beforeFrom(t) && !within(t.date, from, to))
    .map(t => caisseLineOf(t, 'apres')).sort(byDateDesc);

  const groupMap = new Map<string, CaisseGroup>();
  for (const l of caissePeriodLines) {
    const direction: 'in' | 'out' = l.amount >= 0 ? 'in' : 'out';
    const key = `${l.nature}|${direction}`;
    const g = groupMap.get(key)
      || { key, label: l.nature, direction, count: 0, total: 0, lines: [] as CaisseLine[] };
    g.count += 1;
    g.total += Math.abs(l.amount);
    g.lines.push(l);
    groupMap.set(key, g);
  }
  const caisseAfter = caisseAfterLines.reduce((s, l) => s + l.amount, 0);
  const caisseDetail: CaisseBreakdown = {
    opening: caisseOpening,
    in: caisseIn, out: caisseOut,
    periodEnd: caisseOpening + caisseIn - caisseOut,
    after: caisseAfter,
    balance: caisseBalance,
    groups: Array.from(groupMap.values()).sort((a, b) => b.total - a.total),
    lines: caissePeriodLines,
    openingLines: caisseOpeningLines,
    afterLines: caisseAfterLines,
    counts: {
      period: caissePeriodLines.length,
      in: caissePeriodLines.filter(l => l.amount >= 0).length,
      out: caissePeriodLines.filter(l => l.amount < 0).length,
      before: caisseOpeningLines.length,
      after: caisseAfterLines.length,
    },
  };

  const accounts: TreasuryAccount[] = bankAccounts.map(a => {
    const all = txs.filter(t => t.accountFrom === a.id || t.accountTo === a.id);
    const inRange = all.filter(t => within(t.date, from, to));
    return {
      id: a.id, name: a.name, accountNumber: a.accountNumber, notes: a.notes,
      initialBalance: num(a.initialBalance),
      balance: num(a.initialBalance) + ledgerNetFor(a.id, txs),
      openingBalance: num(a.initialBalance) + ledgerNetFor(a.id, all.filter(beforeFrom)),
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
            reference: refOf(t),
          };
        }),
    };
  });
  const bankTotal = accounts.reduce((s, a) => s + a.balance, 0);
  const bankOpening = accounts.reduce((s, a) => s + a.openingBalance, 0);
  const bankIn = accounts.reduce((s, a) => s + a.credit, 0);
  const bankOut = accounts.reduce((s, a) => s + a.debit, 0);

  // ── Consolidated journal ───────────────────────────────────────────────────
  const all: TreasuryMovement[] = [];
  const push = (m: Omit<TreasuryMovement, 'partLabel'>) =>
    all.push({ ...m, partLabel: TREASURY_PART_LABEL[m.part] });

  // 1. Treasury ledger — the only rows that move the caisses of the station.
  for (const t of txs) {
    const nature = TX_LABEL[t.kind] || t.kind;
    let amount = num(t.amount);
    if (t.kind === 'WITHDRAW') amount = -amount;
    // Un virement est signé du point de vue des CAISSES : décaissement quand
    // l'argent quitte l'une d'elles, encaissement quand il y arrive, neutre
    // entre deux comptes bancaires. Ne regarder que la caisse générale faisait
    // compter pour zéro les virements des caisses d'activité.
    else if (t.kind === 'TRANSFER') amount = isCashAccount(t.accountFrom) ? -amount : (isCashAccount(t.accountTo) ? amount : 0);
    else if (['PURCHASE', 'EXPENSE', 'SALARY'].includes(t.kind)) amount = -amount;
    push({
      id: t.id, date: t.date, nature, part: (t.part || 'systeme') as TreasuryPartKey,
      label: t.description || nature, amount, isLedger: true,
      accounts: [t.accountFrom && accName(t.accountFrom), t.accountTo && accName(t.accountTo)].filter(Boolean).join(' → ') || undefined,
      reference: refOf(t),
    });
  }

  // 2. Fuel-part documents — SEULEMENT ceux qui n'ont pas écrit leur propre
  //    ligne au grand livre, sinon le même argent est compté deux fois. Chaque
  //    achat réglé, chaque dépense payée et chaque brigade clôturée laisse déjà
  //    une ligne au grand livre : elles gonflaient les encaissements, les
  //    décaissements et le flux net du rapport (même règle que l'écran Caisse
  //    Générale, qui ne peut donc plus annoncer d'autres totaux).
  const ledgered = new Set(
    txs.filter(t => t.refType && t.refId).map(t => `${t.refType}:${t.refId}`));
  for (const p of purchases) {
    if (ledgered.has(`purchase:${p.id}`)) continue;
    push({
      id: `pur-${p.id}`, date: p.date, nature: 'Achat', part: 'carburant', isLedger: false,
      label: `Achat carburant ${p.invoiceNumber ? `n° ${p.invoiceNumber}` : ''} — ${suppliers.find(s => s.id === p.supplierId)?.name || 'Fournisseur'}`.trim(),
      amount: -num(p.amountPaid),
    });
  }
  for (const e of expenses) {
    if (ledgered.has(`expense:${e.id}`)) continue;
    push({
      id: `exp-${e.id}`, date: e.date, nature: 'Dépense', part: 'carburant', isLedger: false,
      label: `${e.category || 'Dépense'} — ${e.description || ''}`.trim(), amount: -num(e.amount),
    });
  }
  for (const a of accountings) {
    if (ledgered.has(`brigade:${a.brigadeId}`)) continue;
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
  // La position d'une activité, ce sont ses propres documents PLUS tout ce que
  // le grand livre a enregistré sur SON coffre : un virement vers la banque a
  // bien vidé cette caisse-là. Sans ce terme, le rapport annonçait une caisse
  // encore pleine d'un argent déjà parti — et contredisait la Caisse Générale.
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
    return dep + salesPaid + repPaid - wit - purPaid - exp - sal
      + ledgerNetFor(CAISSE_PART_ID[key as keyof typeof CAISSE_PART_ID], txs);
  };
  const carburantBalance =
    accountings.reduce((s, a) => s + num(a.cashReceived), 0)
    - purchases.reduce((s, p) => s + num(p.amountPaid), 0)
    - expenses.reduce((s, e) => s + num(e.amount), 0)
    + ledgerNetFor(CAISSE_PART_ID.carburant, txs);

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
    caisseOpening, caisseIn, caisseOut, caisseDetail,
    bankOpening, bankIn, bankOut,
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
