/**
 * ─── Annulation d'un bon d'achat (Cafétéria / Lavage) ──────────────────────────
 * Supprimer une facture d'achat ne consistait qu'à retirer la LIGNE : les
 * quantités reçues restaient dans le stock pour toujours. Le catalogue annonçait
 * de la marchandise que la partie n'avait jamais eue, la valeur du stock était
 * gonflée et la dette fournisseur disparaissait sans que rien ne revienne.
 *
 * Ici, une suppression fait le chemin inverse de la création (`PurchaseForm`) :
 *   • chaque ligne REND sa quantité — retirée du stock reçu (`principalQty`) et
 *     du reste en stock (`currentQty`) ;
 *   • la facture quitte ensuite les collections, donc les rapports, la dette
 *     fournisseur et la caisse de la partie qui se calculent tous dessus.
 *
 * Le stock peut passer en NÉGATIF si la marchandise a déjà été vendue : c'est
 * voulu (le point de vente vend à découvert), et le manque se rattrapera au
 * prochain achat — exactement comme le reste de l'application.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizLineItem, BizProduct, BizPurchase, formatQty, roundQty } from './bizConfig';
import { effectiveAvgCost, lineSnapshot, reverseAverageCost, usesAverageCost } from './bizAverageCost';

/** Ce qu'une ligne d'achat va rendre au stock quand la facture est annulée. */
export interface PurchaseStockDelta {
  productId: string;
  productName: string;
  unit?: string;
  /** Quantité reçue par cet achat — celle qui sera reprise. */
  qty: number;
  /** Reste en stock avant l'annulation. */
  before: number;
  /** Reste en stock après l'annulation. */
  after: number;
  /** Le produit n'est plus au catalogue : rien à reprendre. */
  missing: boolean;
}

/**
 * Quantités que l'annulation d'un achat retirerait du stock, produit par
 * produit. Plusieurs lignes peuvent viser le même produit : elles sont
 * cumulées pour que le « après » affiché soit le vrai.
 */
export function purchaseStockDeltas(
  purchase: Pick<BizPurchase, 'items'>,
  products: BizProduct[],
): PurchaseStockDelta[] {
  const byId = new Map(products.map(p => [p.id, p]));
  const byName = new Map(products.map(p => [p.name, p]));
  const acc = new Map<string, PurchaseStockDelta>();

  for (const it of purchase.items || []) {
    const qty = Number(it.qty) || 0;
    if (qty <= 0) continue;
    const prod = byId.get(it.productId) || byName.get(it.productName);
    const key = prod?.id || it.productId || it.productName;
    const existing = acc.get(key);
    if (existing) {
      existing.qty = roundQty(existing.qty + qty);
      existing.after = roundQty(existing.before - existing.qty);
      continue;
    }
    const before = prod ? prod.currentQty : 0;
    acc.set(key, {
      productId: prod?.id || it.productId,
      productName: prod?.name || it.productName,
      unit: prod?.unit,
      qty: roundQty(qty),
      before,
      after: roundQty(before - qty),
      missing: !prod,
    });
  }
  return Array.from(acc.values());
}

/**
 * Phrase de confirmation listant ce que la suppression va retirer du stock —
 * l'utilisateur voit AVANT de valider ce que chaque produit va devenir.
 */
export function describePurchaseRollback(deltas: PurchaseStockDelta[]): string {
  const lines = deltas
    .filter(d => !d.missing)
    .map(d => {
      const arrow = `${formatQty(d.before)} → ${formatQty(d.after)}${d.unit ? ` ${d.unit}` : ''}`;
      const warn = d.after < 0 ? '  ⚠ stock négatif (marchandise déjà vendue)' : '';
      return `• ${d.productName} : −${formatQty(d.qty)}${d.unit ? ` ${d.unit}` : ''}   (${arrow})${warn}`;
    });
  const gone = deltas.filter(d => d.missing);
  if (gone.length) {
    lines.push(`• ${gone.map(d => d.productName).join(', ')} : produit supprimé du catalogue — rien à reprendre.`);
  }
  return lines.join('\n');
}

/**
 * Annule un bon d'achat : rend les quantités au stock puis retire la facture.
 *
 * `update` / `remove` sont les méthodes de `useBiz(moduleKey)` — passées en
 * paramètre pour que cette fonction reste testable et sans dépendance à React.
 * Renvoie les deltas appliqués, de quoi rédiger le message de confirmation.
 */
export function deleteBizPurchase(
  purchase: BizPurchase,
  products: BizProduct[],
  api: {
    update: (coll: 'products', item: BizProduct) => void;
    remove: (coll: 'purchases', id: string) => void;
  },
): PurchaseStockDelta[] {
  const deltas = purchaseStockDeltas(purchase, products);
  const byId = new Map(products.map(p => [p.id, p]));
  const byName = new Map(products.map(p => [p.name, p]));

  // Une facture enregistrée au coût moyen doit AUSSI défaire son effet sur le
  // CUMP : retirer la marchandise en laissant le coût moyen qu'elle avait fait
  // bouger laisserait le stock valorisé à un prix que la partie n'a jamais payé.
  const avgByProduct = new Map<string, ReturnType<typeof lineSnapshot>>();
  if (usesAverageCost(purchase)) {
    for (const it of purchase.items || []) {
      const snap = lineSnapshot(it);
      if (!snap) continue;
      const prod = byId.get(it.productId) || byName.get(it.productName);
      const key = prod?.id || it.productId || it.productName;
      // Une même facture ne peut pas porter deux lignes du même produit
      // (le formulaire l'interdit) : la première photo trouvée fait foi.
      if (!avgByProduct.has(key)) avgByProduct.set(key, snap);
    }
  }

  for (const d of deltas) {
    if (d.missing) continue;
    const prod = byId.get(d.productId) || byName.get(d.productName);
    if (!prod) continue;

    const snap = avgByProduct.get(prod.id) || avgByProduct.get(d.productName);
    const reversed = snap
      ? reverseAverageCost(prod.currentQty, effectiveAvgCost(prod), snap)
      : null;

    api.update('products', {
      ...prod,
      // `principalQty` est le cumul de ce qui a été REÇU : il ne peut pas
      // descendre sous zéro, contrairement au reste en stock.
      principalQty: roundQty(Math.max(0, prod.principalQty - d.qty)),
      currentQty: roundQty(prod.currentQty - d.qty),
      ...(reversed
        ? {
          averageCost: reversed.avgCost,
          // Le coût de revient du produit suit le coût moyen repris : c'est lui
          // qui valorise le stock et qui donne la marge au point de vente.
          purchasePrice: reversed.avgCost,
        }
        : {}),
    });
  }
  api.remove('purchases', purchase.id);
  return deltas;
}

/** Total des quantités reprises — pour le message de succès. */
export function totalRolledBack(deltas: PurchaseStockDelta[]): number {
  return roundQty(deltas.filter(d => !d.missing).reduce((s, d) => s + d.qty, 0));
}

// ─── Création / modification d'un bon d'achat ─────────────────────────────────
/**
 * Le chemin inverse de l'annulation ci-dessus : ce qu'une facture saisie ou
 * modifiée doit faire au stock. Tout est ici, sans React, pour être vérifiable
 * (`npx tsx src/lib/bizPurchase.test.ts`).
 *
 * Ce qui n'allait pas :
 *   • MODIFIER une facture ne touchait jamais au stock. Corriger « 10 » en
 *     « 12 », ajouter une pièce oubliée ou retirer une ligne laissait le stock
 *     sur l'ancienne saisie — la facture et le stock ne racontaient plus la
 *     même histoire ;
 *   • une quantité vide, nulle ou illisible passait (`Number('')` vaut 0, et un
 *     stock non numérique se CONCATÉNAIT : « 5 » + 3 = « 53 ») ;
 *   • le numéro « A-000x » se calculait sur le NOMBRE de factures : après une
 *     suppression, deux achats portaient le même numéro.
 */

/** Nombre sûr : une valeur illisible vaut 0 au lieu d'empoisonner le calcul. */
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Vérifie les lignes AVANT tout enregistrement. Rend le message à afficher, ou
 * `null` quand la facture est saisissable.
 */
export function validatePurchaseLines(items: BizLineItem[]): string | null {
  if (!items.length) return 'Ajoutez au moins un produit';
  const seen = new Set<string>();
  for (const it of items) {
    const name = it.productName || 'un produit';
    if (!it.productId) return `« ${name} » n'est relié à aucune fiche produit`;
    if (seen.has(it.productId)) return `« ${name} » figure deux fois sur la facture`;
    seen.add(it.productId);
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) return `Quantité reçue invalide pour « ${name} » (elle doit être supérieure à 0)`;
    const price = Number(it.unitPrice);
    if (!Number.isFinite(price) || price < 0) return `Prix d'achat invalide pour « ${name} »`;
  }
  return null;
}

/** Quantité reçue par produit — plusieurs lignes d'un même produit se cumulent. */
export function purchaseQtyByProduct(items: BizLineItem[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items || []) {
    if (!it?.productId) continue;
    out.set(it.productId, roundQty((out.get(it.productId) || 0) + Math.max(0, num(it.qty))));
  }
  return out;
}

/**
 * Ce que la saisie change au stock, produit par produit.
 *   • création (`before` absent) : chaque produit reçoit sa quantité ;
 *   • modification : seule la DIFFÉRENCE s'applique — une quantité corrigée,
 *     une ligne ajoutée (+) ou retirée (−). Rien n'est compté deux fois.
 * Seuls les produits dont le stock bouge réellement sont rendus.
 */
export function purchaseStockChanges(
  before: BizLineItem[] | null | undefined,
  after: BizLineItem[],
): Map<string, number> {
  const was = purchaseQtyByProduct(before);
  const now = purchaseQtyByProduct(after);
  const out = new Map<string, number>();
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const delta = roundQty((now.get(id) || 0) - (was.get(id) || 0));
    if (delta !== 0) out.set(id, delta);
  }
  return out;
}

/**
 * Prochain numéro de facture : un de plus que le PLUS GRAND déjà attribué —
 * jamais le nombre de factures, qui redescend après une suppression.
 */
export function nextPurchaseRef(purchases: Pick<BizPurchase, 'ref'>[]): string {
  let max = 0;
  for (const p of purchases || []) {
    const m = /^A-(\d+)$/.exec(String(p?.ref || '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  const next = Math.max(max, (purchases || []).length) + 1;
  return `A-${String(next).padStart(4, '0')}`;
}

/**
 * Des deux copies d'une fiche (celle de l'écran, celle relue en base), la plus
 * récemment écrite — même règle que la fusion (`_upd`).
 */
export function newerProduct(local?: BizProduct, remote?: BizProduct): BizProduct | undefined {
  if (!local) return remote;
  if (!remote) return local;
  const l = String((local as any)._upd || (local as any).updatedAt || '');
  const r = String((remote as any)._upd || (remote as any).updatedAt || '');
  return r > l ? remote : local;
}

/**
 * La fiche produit après la réception (ou la correction) d'une ligne.
 *
 *   • `qtyDelta` s'ajoute au reste en stock ET au cumul reçu (`principalQty`,
 *     qui ne descend jamais sous zéro) ;
 *   • `line` reporte les réglages commerciaux saisis sur la facture (prix,
 *     seuil, expiration, prix au détail) — absent quand la ligne a été retirée ;
 *   • `avgCost` : CUMP calculé à la création d'un achat au coût moyen ;
 *   • `keepCost` : facture au coût moyen MODIFIÉE — le coût de revient du
 *     produit ne doit pas retomber sur le prix brut de la ligne.
 */
export function receivePurchaseLine(
  prod: BizProduct,
  opts: { qtyDelta: number; line?: BizLineItem; avgCost?: number; keepCost?: boolean },
): BizProduct {
  const delta = num(opts.qtyDelta);
  const principal = num(prod.principalQty);
  const current = num(prod.currentQty);
  const next: BizProduct = {
    ...prod,
    principalQty: roundQty(Math.max(0, principal + delta)),
    currentQty: roundQty(current + delta),
  };
  const it = opts.line;
  if (!it) return next;

  const unitPrice = num(it.unitPrice);
  if (opts.avgCost !== undefined) {
    next.purchasePrice = opts.avgCost;
    next.averageCost = opts.avgCost;
    next.lastPurchasePrice = unitPrice;
  } else if (opts.keepCost) {
    next.lastPurchasePrice = unitPrice;
  } else {
    next.purchasePrice = unitPrice;
  }
  if (it.minQty !== undefined && Number.isFinite(Number(it.minQty))) next.minQty = num(it.minQty);
  if (it.salePrice !== undefined && Number.isFinite(Number(it.salePrice))) next.salePrice = num(it.salePrice);
  if (it.hasExpiration !== undefined) next.hasExpiration = it.hasExpiration;
  if (it.hasExpiration) next.expirationDate = it.expirationDate;
  // Le prix au détail n'est écrit que si le produit est vendu au détail ;
  // 0 ⇒ le point de vente retombe sur prix de vente ÷ contenance.
  if (prod.sellByDetail) {
    next.detailSalePrice = num(it.detailSalePrice) > 0 ? num(it.detailSalePrice) : undefined;
  }
  return next;
}
