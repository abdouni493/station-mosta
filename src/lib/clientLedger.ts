/**
 * ─── Le compte d'un client, relu sur ses pièces ─────────────────────────────────
 *
 * L'écran Clients affichait un historique VIDE, et ce n'était pas un défaut
 * d'affichage : il lisait deux sources qui ne contiennent plus rien.
 *
 *   • `fuel_sales` — la table est morte, la vente de carburant passe par les
 *     BRIGADES depuis longtemps (voir `lib/carburantSales.ts`) ;
 *   • `shopSales.paymentMode === client.id` — une comparaison entre un mode de
 *     paiement et un identifiant de client, qui ne pouvait jamais être vraie.
 *
 * Ce que le client a réellement consommé vit dans les JUSTIFICATIONS des
 * brigades : quand un pompiste explique un manquant par « bon client », la
 * comptabilité de la brigade enregistre le client, le carburant, les litres et
 * le montant — à crédit (une dette de plus) ou sur son avance (son solde baisse).
 *
 * Ce module rassemble tout ce qui touche un client en UN journal :
 *
 *      bons carburant + ventes magasin + règlements + recharges d'avance
 *
 * — chaque ligne avec son effet sur la DETTE et sur l'AVANCE, pour que les deux
 * soldes affichés se vérifient au lieu d'être crus sur parole.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Ce qu'une ligne du compte client raconte. */
export type ClientEntryKind =
  /** Bon carburant pris sur une brigade. */
  | 'bon'
  /** Facture du magasin. */
  | 'magasin'
  /** Règlement d'une dette. */
  | 'reglement'
  /** Recharge du compte d'avance. */
  | 'recharge'
  /** Ligne d'historique ancienne, sans document rattaché. */
  | 'vente';

export interface ClientEntry {
  id: string;
  date: string;
  kind: ClientEntryKind;
  label: string;
  /** Ce que l'opération a coûté au client — 0 pour un règlement. */
  charged: number;
  /** Ce que le client a versé (règlement) ou déposé (recharge). */
  paid: number;
  /** Effet sur la DETTE : > 0 elle se creuse, < 0 elle se rembourse. */
  debtEffect: number;
  /** Effet sur l'AVANCE : > 0 rechargée, < 0 consommée. */
  advanceEffect: number;
  /** Espèces, chèque, virement, TPE… quand l'opération en porte un. */
  mode?: string;
  reference?: string;
  notes?: string;
  /** Détail carburant d'un bon. */
  liters?: number;
  fuelType?: string;
  pricePerLiter?: number;
  /** Reste dû sur une facture magasin. */
  rest?: number;
}

export interface ClientLedger {
  entries: ClientEntry[];
  /** Total consommé, toutes origines confondues. */
  charged: number;
  /** Consommation portée à crédit — c'est elle qui crée la dette. */
  chargedOnCredit: number;
  /** Consommation prise sur l'avance du client. */
  chargedOnAdvance: number;
  /** Règlements de dette encaissés. */
  paid: number;
  /** Recharges du compte d'avance. */
  recharged: number;
  /** Ce que les documents disent de la dette : crédit consommé − règlements. */
  debtFromDocuments: number;
  /** Ce que les documents disent de l'avance : recharges − consommation. */
  advanceFromDocuments: number;
  counts: { bons: number; magasin: number; reglements: number; recharges: number };
}

/** Un bon de brigade concerne-t-il un vrai client (et pas un TAG / TPE) ? */
const isClientJustification = (j: any): boolean =>
  !!j?.clientId && (!j.justificationType || j.justificationType === 'CLIENT');

/** Le bon a-t-il été pris sur l'avance du client plutôt qu'à crédit ? */
const onAdvance = (j: any): boolean =>
  String(j?.paymentMode || '').toUpperCase() === 'AVANCE';

/**
 * Le compte complet d'un client. `app` est l'état de l'application : on y lit
 * les brigades, leur comptabilité, les ventes magasin et l'historique du client.
 */
export function clientLedger(app: any, clientId: string): ClientLedger {
  const entries: ClientEntry[] = [];
  if (!clientId) return emptyLedger();

  const client = (app?.clients || []).find((c: any) => c.id === clientId);
  const brigades: any[] = app?.brigades || [];
  const accountings: any[] = app?.brigadeAccountings || [];

  // 1. Bons carburant — les justifications « client » des brigades.
  for (const acc of accountings) {
    const brigade = brigades.find(b => b.id === acc.brigadeId);
    const date = brigade?.startDatetime || brigade?.date || '';
    for (const j of (acc.justifications || [])) {
      if (!isClientJustification(j) || j.clientId !== clientId) continue;
      const amount = num(j.amount);
      if (!amount) continue;
      const advance = onAdvance(j);
      const liters = num(j.liters);
      entries.push({
        id: `bon-${j.id}`,
        date,
        kind: 'bon',
        label: [
          'Bon carburant',
          j.fuelType,
          liters > 0 ? `${liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L` : '',
          brigade ? `brigade ${brigade.shift || ''}`.trim() : '',
        ].filter(Boolean).join(' · '),
        charged: amount,
        paid: 0,
        // Pris sur l'avance, le bon ne crée aucune dette : il consomme un
        // argent déjà versé. À crédit, c'est l'inverse.
        debtEffect: advance ? 0 : amount,
        advanceEffect: advance ? -amount : 0,
        mode: advance ? 'AVANCE' : 'CREDIT',
        notes: j.notes,
        liters: liters || undefined,
        fuelType: j.fuelType,
        pricePerLiter: num(j.pricePerLiter) || undefined,
      });
    }
  }

  // 2. Ventes magasin — le filtre lisait `paymentMode`, jamais `clientId`.
  for (const s of (app?.shopSales || [])) {
    if (s.clientId !== clientId) continue;
    const total = num(s.total);
    const paidOnSale = num(s.amountPaid ?? s.total);
    const rest = num(s.rest ?? Math.max(0, total - paidOnSale));
    entries.push({
      id: `shop-${s.id}`,
      date: s.date,
      kind: 'magasin',
      label: `Vente magasin${(s.items || []).length ? ` — ${(s.items || []).length} article(s)` : ''}`,
      charged: total,
      paid: 0,
      // Seule la part NON réglée sur place devient une dette.
      debtEffect: rest,
      advanceEffect: String(s.paymentMode || '').toUpperCase() === 'AVANCE' ? -total : 0,
      mode: s.paymentMode,
      reference: s.bonNumber || s.chequeNumber,
      notes: s.notes,
      rest,
    });
  }

  // 3. Ventes carburant anciennes — la table n'est plus écrite, mais les lignes
  //    déjà enregistrées appartiennent toujours au compte du client.
  for (const s of (app?.fuelSales || [])) {
    if (s.clientId !== clientId) continue;
    const total = num(s.total ?? s.amount);
    if (!total) continue;
    entries.push({
      id: `fuel-${s.id}`,
      date: s.date,
      kind: 'vente',
      label: `Vente carburant${s.fuelType ? ` — ${s.fuelType}` : ''}`,
      charged: total,
      paid: 0,
      debtEffect: String(s.paymentMode || '').toUpperCase() === 'CREDIT' ? total : 0,
      advanceEffect: String(s.paymentMode || '').toUpperCase() === 'AVANCE' ? -total : 0,
      mode: s.paymentMode,
      liters: num(s.liters) || undefined,
      fuelType: s.fuelType,
      pricePerLiter: num(s.pricePerLiter) || undefined,
    });
  }

  // 4. Règlements et recharges — l'historique propre du client.
  for (const t of (client?.transactionHistory || [])) {
    const amount = num(t.amount);
    if (!amount) continue;
    if (t.type === 'PAYMENT') {
      entries.push({
        id: `pay-${t.id}`,
        date: t.date,
        kind: 'reglement',
        label: 'Règlement de dette',
        charged: 0,
        paid: amount,
        debtEffect: -amount,
        advanceEffect: 0,
        mode: t.mode || 'ESPECES',
        reference: t.receiptNumber,
        notes: t.notes,
      });
    } else if (t.type === 'RECHARGE') {
      entries.push({
        id: `rec-${t.id}`,
        date: t.date,
        kind: 'recharge',
        label: "Recharge du compte d'avance",
        charged: 0,
        paid: amount,
        debtEffect: 0,
        advanceEffect: amount,
        mode: t.mode || 'ESPECES',
        reference: t.receiptNumber,
        notes: t.notes,
      });
    } else {
      // Ligne `SALE` d'historique : une consommation sans document rattaché.
      entries.push({
        id: `tx-${t.id}`,
        date: t.date,
        kind: 'vente',
        label: t.notes || 'Consommation',
        charged: amount,
        paid: 0,
        debtEffect: amount,
        advanceEffect: 0,
        mode: t.mode,
        reference: t.receiptNumber,
        notes: t.notes,
      });
    }
  }

  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const sum = (f: (e: ClientEntry) => number) => entries.reduce((s, e) => s + f(e), 0);
  const chargedOnAdvance = -entries.reduce((s, e) => s + Math.min(0, e.advanceEffect), 0);
  const recharged = entries.reduce((s, e) => s + Math.max(0, e.advanceEffect), 0);
  const chargedOnCredit = entries.reduce((s, e) => s + Math.max(0, e.debtEffect), 0);
  const paid = sum(e => (e.kind === 'reglement' ? e.paid : 0));

  return {
    entries,
    charged: sum(e => e.charged),
    chargedOnCredit,
    chargedOnAdvance,
    paid,
    recharged,
    debtFromDocuments: chargedOnCredit - paid,
    advanceFromDocuments: recharged - chargedOnAdvance,
    counts: {
      bons: entries.filter(e => e.kind === 'bon').length,
      magasin: entries.filter(e => e.kind === 'magasin').length,
      reglements: entries.filter(e => e.kind === 'reglement').length,
      recharges: entries.filter(e => e.kind === 'recharge').length,
    },
  };
}

/**
 * L'avance dont le client dispose encore.
 *
 * Elle a longtemps vécu dans DEUX colonnes qui ne se parlaient pas : une
 * recharge créditait `balance`, un bon pris sur l'avance débitait
 * `advanceBalance`. Les deux bougent désormais ensemble et `advanceBalance` fait
 * foi — mais les clients enregistrés avant cette correction gardent deux valeurs
 * différentes, d'où `advanceColumnsDisagree` pour le dire à l'écran plutôt que
 * de choisir en silence.
 */
export function advanceAvailable(
  client: { balance?: number; advanceBalance?: number } | null | undefined,
): number {
  if (!client) return 0;
  const advance = client.advanceBalance ?? client.balance ?? 0;
  return Math.max(0, num(advance));
}

/** Écart entre les deux colonnes de l'avance — 0 quand elles s'accordent. */
export function advanceColumnsDisagree(
  client: { balance?: number; advanceBalance?: number } | null | undefined,
): number {
  if (!client || client.advanceBalance === undefined) return 0;
  return num(client.advanceBalance) - num(client.balance);
}

function emptyLedger(): ClientLedger {
  return {
    entries: [],
    charged: 0, chargedOnCredit: 0, chargedOnAdvance: 0, paid: 0, recharged: 0,
    debtFromDocuments: 0, advanceFromDocuments: 0,
    counts: { bons: 0, magasin: 0, reglements: 0, recharges: 0 },
  };
}

/**
 * Ce que CHAQUE client doit et détient, d'après ses pièces — pour les écrans qui
 * affichent la liste entière sans vouloir relire les brigades une fois par
 * client.
 */
export function clientLedgers(app: any): Record<string, ClientLedger> {
  const out: Record<string, ClientLedger> = {};
  for (const c of (app?.clients || [])) out[c.id] = clientLedger(app, c.id);
  return out;
}
