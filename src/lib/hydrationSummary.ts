/**
 * ─── État de chargement PAR ressource (logique pure, sans React) ───────────────
 *
 * Isolé ici pour deux raisons :
 *   • rester testable hors navigateur (`npx tsx src/lib/hydrationSummary.test.ts`),
 *     sans tirer tout `AppContext` et ses dépendances ;
 *   • garantir l'invariant central : une lecture en ÉCHEC est toujours remontée,
 *     jamais présentée en silence comme une liste vide réussie.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/**
 * État de chargement d'UNE ressource (table/RPC), par écran.
 *   • `loading` — la lecture est en cours ;
 *   • `ready`   — lue avec succès (même si elle est vide) ;
 *   • `error`   — la lecture a ÉCHOUÉ : la donnée à l'écran est peut-être absente
 *     ou périmée, et ne doit SURTOUT pas être présentée comme « rien à afficher ».
 *   • `slow`    — Phase 1 a dépassé son délai : le squelette est libéré mais les
 *     données continuent d'arriver en arrière-plan (ce n'est pas « complet »).
 */
export type ResourceLoadState = 'loading' | 'ready' | 'error' | 'slow';

export interface ResourceStatus {
  state: ResourceLoadState;
  /** Message d'erreur technique (sans donnée privée), pour le diagnostic. */
  error?: string;
  /** Horodatage de la dernière mise à jour du statut. */
  at?: number;
}

/** Statut par ressource : `{ fuel_sales: { state:'error', … }, … }`. */
export type HydrationStatus = Record<string, ResourceStatus>;

export interface HydrationIssue { key: string; label: string; error?: string }

export interface HydrationSummary {
  /** Ressources dont la LECTURE a échoué — à signaler, jamais à présenter comme vides. */
  failed: HydrationIssue[];
  /** Le démarrage a dépassé son délai : données encore en cours d'arrivée. */
  slow: boolean;
  /** Le démarrage a échoué de façon critique. */
  startupError: boolean;
}

/**
 * Libellés FR lisibles pour les ressources de chargement, afin qu'un échec
 * nomme l'écran concerné plutôt qu'une clé technique. Toute clé absente retombe
 * sur elle-même — rien n'est jamais masqué.
 */
export const HYDRATION_LABELS: Record<string, string> = {
  __startup: 'Démarrage',
  Brigades: 'Brigades', 'Brigade Assignments': 'Affectations de brigade',
  'Bank Accounts': 'Comptes bancaires', Treasury: 'Trésorerie (grand livre)',
  'Décalage History': 'Historique des décalages', 'TPE Transactions': 'Transactions TPE',
  'Brigade Décalage Alerts': 'Alertes de décalage', 'Brigade Accountings': 'Comptabilités de brigade',
  'Fuel Sales': 'Ventes carburant', 'Shop Sales': 'Ventes magasin',
  'Delivery Notes': 'Bons de livraison', Purchases: 'Achats',
  Expenses: 'Dépenses', Inventories: 'Inventaires', 'Daily Reports': 'Fiches journalières',
  'Worker Acomptes': 'Acomptes du personnel', 'Worker Absences': 'Absences du personnel',
  'Payment Records': 'Paies du personnel', 'DN Payments': 'Règlements de bons',
  'DN Photos': 'Photos de bons', 'Purchase Items': 'Lignes d’achat',
  'Purchase Payments': 'Règlements d’achat', 'Shop Sale Items': 'Lignes de vente magasin',
  'Supplier Appointments': 'Échéances fournisseurs', 'Supplier Debt Payments': 'Règlements fournisseurs',
  'Client Appointments': 'Échéances clients', 'Client Transactions': 'Mouvements clients',
  'Delivery Note Items': 'Lignes de bons', 'Fuel Invoices': 'Factures carburant',
  'Fuel Invoice BLs': 'BL de factures carburant', 'Fuel Receipts': 'Réceptions carburant',
  'Fuel Receipt Invoices': 'Factures de réception',
};

export function hydrationLabel(key: string): string {
  return HYDRATION_LABELS[key] || key;
}

/**
 * Dérive le résumé actionnable à partir d'une carte de statuts — fonction PURE.
 * Une lecture `error` est TOUJOURS listée : elle ne peut donc jamais être
 * présentée en silence comme une liste vide réussie.
 */
export function summarizeHydration(hydration: HydrationStatus | undefined): HydrationSummary {
  const h: HydrationStatus = hydration || {};
  const failed: HydrationIssue[] = [];
  for (const [key, st] of Object.entries(h)) {
    if (key === '__startup') continue;
    if (st?.state === 'error') failed.push({ key, label: hydrationLabel(key), error: st.error });
  }
  failed.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return {
    failed,
    slow: h.__startup?.state === 'slow',
    startupError: h.__startup?.state === 'error',
  };
}
