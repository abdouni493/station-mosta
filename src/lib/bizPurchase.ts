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
import { BizProduct, BizPurchase, formatQty, roundQty } from './bizConfig';

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

  for (const d of deltas) {
    if (d.missing) continue;
    const prod = byId.get(d.productId) || byName.get(d.productName);
    if (!prod) continue;
    api.update('products', {
      ...prod,
      // `principalQty` est le cumul de ce qui a été REÇU : il ne peut pas
      // descendre sous zéro, contrairement au reste en stock.
      principalQty: roundQty(Math.max(0, prod.principalQty - d.qty)),
      currentQty: roundQty(prod.currentQty - d.qty),
    });
  }
  api.remove('purchases', purchase.id);
  return deltas;
}

/** Total des quantités reprises — pour le message de succès. */
export function totalRolledBack(deltas: PurchaseStockDelta[]): number {
  return roundQty(deltas.filter(d => !d.missing).reduce((s, d) => s + d.qty, 0));
}
