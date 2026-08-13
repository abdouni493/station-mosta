/**
 * ─── Business Modules Configuration & Types ────────────────────────────────────
 * Self-contained data model for the commerce/production parts of the sidebar:
 * Cafétéria and Lavage & Réparation (the Magasin point-de-vente & ventes screens
 * were folded into the Lavage part; the Restaurant part was removed).
 *
 * These modules live on a dedicated store (`BizContext`, persisted as one JSON
 * row in Supabase), so they never touch the relational fuel-station tables.
 * Every generic page (`src/pages/modules/*`) is parameterised by a `ModuleKey`.
 * ──────────────────────────────────────────────────────────────────────────────
 */

export type ModuleKey = 'cafeteria' | 'lavage';

/** Keys that existed in older saved states and are migrated away on load. */
export type LegacyModuleKey = 'restaurant' | 'magasin';

// ─── Entity collections held per module ────────────────────────────────────────
export type BizCollection =
  | 'categories'
  | 'marques'
  | 'products'
  | 'purchases'
  | 'sales'
  | 'clients'
  | 'suppliers'
  | 'workers'
  | 'expenses'
  | 'caisse'
  | 'productions'
  | 'fiches'
  | 'comptoir'
  | 'destructions'
  | 'reparations'
  | 'sessions'
  | 'payRequests'
  | 'inventaires'
  | 'roles';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BizNamed { id: string; name: string }

export interface BizProduct {
  id: string;
  name: string;
  description?: string;
  barcode?: string;
  marqueId?: string;
  marqueName?: string;
  categoryId?: string;
  categoryName?: string;
  principalQty: number;   // stock principal (total reçu)
  currentQty: number;     // reste en stock
  minQty: number;         // seuil d'alerte
  purchasePrice: number;
  /**
   * Coût moyen pondéré du stock (CUMP), tenu à jour par les achats enregistrés
   * avec l'option « coût moyen » (voir `src/lib/bizAverageCost.ts`).
   *
   * Absent tant qu'aucun achat au coût moyen n'a touché le produit : tout le
   * catalogue existant vaut alors `purchasePrice`, comme avant.
   */
  averageCost?: number;
  /**
   * Dernier prix payé au fournisseur — conservé À PART du coût moyen, parce que
   * ce ne sont pas la même information : on peut acheter à 130 DA un stock qui
   * revient en moyenne à 110 DA.
   */
  lastPurchasePrice?: number;
  salePrice: number;
  unit?: string;
  hasExpiration?: boolean;
  expirationDate?: string;
  /** Sell fractions of one packaged unit (e.g. 1 L out of a 50 L drum). */
  sellByDetail?: boolean;
  /** How much the packaged unit holds, expressed in `detailUnit`. */
  detailCapacity?: number;
  /** Unit of the detail quantity: 'L' | 'ml' | 'kg' | 'g' | 'unité'… */
  detailUnit?: string;
  /** Price of ONE detail unit. Defaults to `salePrice / detailCapacity`. */
  detailSalePrice?: number;
  /** Image URL (stored in Supabase products bucket or base64 fallback). */
  imageUrl?: string;
  /**
   * Matière première : le produit sert à FABRIQUER (production, fiches
   * techniques, réparations) et ne se vend jamais tel quel. Il reste dans la
   * Gestion de stock et dans les Achats, mais n'apparaît PAS au point de vente.
   */
  isRawMaterial?: boolean;
  createdAt: string;
}

/** Un produit ne s'affiche au point de vente que s'il n'est pas une matière première. */
export const isSellableProduct = (p: Pick<BizProduct, 'isRawMaterial'>) => !p.isRawMaterial;

/**
 * Quantité de stock ramenée au millième.
 *
 * Le point de vente vend À DÉCOUVERT : un produit à zéro, une fiche technique
 * dont il manque un ingrédient, une production déjà écoulée se vendent quand
 * même et font descendre la quantité en NÉGATIF — le manque se rattrape au
 * prochain achat (−5 en stock + 15 reçus = 10). Sans cet arrondi, les divisions
 * d'une fiche laisseraient des `-0.30000000000000004` dans la Gestion de stock.
 */
export const roundQty = (q: number): number => Math.round(q * 1000) / 1000;

/** Quantité affichée — le signe « − » d'un stock à découvert est conservé. */
export function formatQty(q: number): string {
  const r = roundQty(q);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Price of one detail unit of a product sold "au détail". */
export function detailPrice(p: Pick<BizProduct, 'salePrice' | 'detailCapacity' | 'detailSalePrice'>): number {
  if (p.detailSalePrice && p.detailSalePrice > 0) return p.detailSalePrice;
  const cap = Number(p.detailCapacity) || 0;
  return cap > 0 ? p.salePrice / cap : p.salePrice;
}

export interface BizLineItem {
  productId: string;
  productName: string;
  /** Quantity in packaged units — fractional when sold au détail. */
  qty: number;
  /** Unit price of the line: purchase price on an achat, sale price on a vente. */
  unitPrice: number;
  /**
   * Coût de revient d'UNE unité de `qty`, figé au moment de la vente — c'est lui
   * qui donne le vrai gain d'une ligne (vendue 30 DA, coûtée 12 DA → gain 18 DA).
   * Selon la provenance : prix d'achat du produit, coût unitaire d'une production
   * mise au comptoir, ou coût de revient d'une fiche technique vendue en direct.
   * Absent sur les anciennes ventes : le rapport le retrouve alors dans le stock,
   * le comptoir ou la fiche (voir `bizReporting.computeModuleReport`).
   */
  unitCost?: number;
  minQty?: number;
  hasExpiration?: boolean;
  expirationDate?: string;
  total?: number;
  /** Set when the line was sold au détail: quantity in `detailUnit`. */
  detailQty?: number;
  detailUnit?: string;
  // ── Purchase lines only ──────────────────────────────────────────────────
  // An achat is where a product's commercial settings are (re)decided, so the
  // line carries them and writes them back onto the product when it is saved.
  /** New sale price of one packaged unit. */
  salePrice?: number;
  /** Whether the product is sold au détail — mirrored from the product. */
  sellByDetail?: boolean;
  /** How much one packaged unit holds, in `detailUnit`. */
  detailCapacity?: number;
  /** New sale price of ONE detail unit (only when `sellByDetail`). */
  detailSalePrice?: number;
  // ── Coût moyen pondéré — photo du calcul, figée à la validation ────────────
  // Ces quatre champs ne sont écrits que par un achat enregistré avec l'option
  // « coût moyen ». Ils rendent la facture lisible pour toujours : rouvrir un
  // vieux bon montre les chiffres du JOUR de la réception, jamais un recalcul
  // avec le coût moyen d'aujourd'hui. Absents ⇒ ligne d'avant l'option.
  /** Stock du produit juste avant cette réception. */
  prevStockQty?: number;
  /** Coût moyen du produit juste avant cette réception. */
  prevAvgCost?: number;
  /** Stock du produit juste après cette réception. */
  resultStockQty?: number;
  /** Coût moyen du produit juste après cette réception. */
  resultAvgCost?: number;
}

export interface BizPurchase {
  id: string;
  ref: string;
  supplierId?: string;
  supplierName: string;
  items: BizLineItem[];
  total: number;
  paid: number;
  rest: number;
  date: string;
  createdAt: string;
  createdBy?: string;
  /**
   * Cette facture a été enregistrée en coût moyen pondéré : ses lignes portent
   * la photo du calcul et elle a fait évoluer le CUMP des produits reçus.
   * Absent ou faux ⇒ achat classique, le prix d'achat du produit est simplement
   * remplacé par celui payé — le comportement historique de l'application.
   */
  useAverageCost?: boolean;
}

export interface BizSale {
  id: string;
  ref: string;
  clientId?: string;
  clientName: string;   // "Client de passage" si non renseigné
  items: BizLineItem[];
  subtotal: number;
  /** Money actually taken off the subtotal — always in DA. */
  reduction: number;
  /** How the remise was expressed at the caisse: pourcentage ou montant fixe. */
  discountType?: BizDiscountType;
  /** The percentage (0-100) or the flat amount typed by the caissier. */
  discountValue?: number;
  total: number;
  paid: number;
  rest: number;
  date: string;
  status: 'payée' | 'crédit' | 'retournée' | 'échangée';
  createdBy?: string;
  /** Work session the sale was rung up in (POS requires an open session). */
  sessionId?: string;
  workerId?: string;
  workerName?: string;
  printedAt?: string;
  /** Set on a refund: the money handed back to the client. */
  refundedAmount?: number;
  refundedAt?: string;
  /** Motif du retour, saisi au moment de le valider. */
  returnReason?: string;
  /** Set on the replacement sale created by an exchange. */
  exchangeOfSaleId?: string;
  /** Set on the original sale once it has been exchanged. */
  exchangedIntoSaleId?: string;
  /** Difference settled at exchange time (>0 client pays, <0 station refunds). */
  exchangeDelta?: number;
}

/**
 * Une vente ANNULÉE — la marchandise n'est plus chez le client.
 *
 *  • `retournée` : le client a rendu les articles, ils sont revenus en stock (ou
 *    au comptoir) et il a été remboursé.
 *  • `échangée`  : les articles sont revenus et une vente de REMPLACEMENT a été
 *    créée ; c'est elle qui porte le panier, l'encaissement et le gain.
 *
 * Dans les deux cas la vente d'origine ne doit plus compter comme un chiffre
 * d'affaires ni générer le moindre gain : sans ce filtre, les rapports
 * facturaient une marchandise revenue en stock — elle était comptée deux fois
 * (une fois en vente, une fois en valeur de stock).
 */
export const isReversedSale = (s: Pick<BizSale, 'status'>): boolean =>
  s.status === 'retournée' || s.status === 'échangée';

/**
 * Argent réellement resté en caisse pour une vente :
 *  • vente normale   → ce que le client a payé ;
 *  • vente retournée → payé − remboursé (0 quand le remboursement est total,
 *    le reliquat quand la station a gardé des frais) ;
 *  • vente échangée  → 0, la vente de remplacement porte tout l'encaissement
 *    (y compris ce qui avait déjà été payé sur l'originale).
 */
export function netCashOfSale(s: BizSale): number {
  if (s.status === 'échangée') return 0;
  if (s.status === 'retournée') return (s.paid || 0) - (s.refundedAmount || 0);
  return s.paid || 0;
}

export interface BizContact {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  createdAt: string;
}

export interface BizAcompte { id: string; date: string; amount: number; description?: string; paid: boolean }
export interface BizAbsence { id: string; date: string; cost: number; description?: string; paid: boolean }
export interface BizWorkerPayment {
  id: string;
  period: string;
  amount: number;
  date: string;
  description?: string;
  mode?: string;
  /** Percentage payroll: the works (réparations/lavages) settled by this payment. */
  workIds?: string[];
  /** Sum of the settled works and the rate applied, for the payslip. */
  worksTotal?: number;
  percentage?: number;
  from?: string;
  to?: string;
  /** `jour` payroll: the worked days settled here (so they never reappear). */
  paidDays?: string[];
  /** `mois` payroll: the months settled here. */
  paidMonths?: string[];
  /** Bonus added on top of the computed net. */
  primeType?: 'percent' | 'amount';
  primeValue?: number;
  primeAmount?: number;
  // ── Décalages d'inventaire ────────────────────────────────────────────────
  /** Inventaires dont les manquants ont été constatés sur ce paiement. */
  inventaireIds?: string[];
  /** Somme des manquants de ces inventaires, au prix d'achat. */
  inventaireTotal?: number;
  /** Retenue réellement appliquée au salaire (0 = simplement constaté). */
  inventaireDeduction?: number;
  inventaireDeductionActive?: boolean;
  inventaireDeductionType?: 'percent' | 'amount';
  inventaireDeductionValue?: number;
}

/**
 * Speciality of an employee of the Lavage & Réparation part. It decides which
 * employees are proposed on a « lavage » prestation and which on a
 * « réparation » one — `both` shows up on either.
 */
export type BizWorkerKind = 'lavage' | 'reparation' | 'both';

export const WORKER_KIND_META: Record<BizWorkerKind, { label: string; short: string }> = {
  lavage: { label: 'Employé lavage', short: 'Lavage' },
  reparation: { label: 'Employé réparation', short: 'Réparation' },
  both: { label: 'Lavage & réparation', short: 'Polyvalent' },
};

export interface BizWorker {
  id: string;
  /** Supabase auth user id — set once the login account is provisioned. */
  authUserId?: string;
  name: string;
  birthday?: string;
  cin?: string;
  phone?: string;
  roleName: string;
  /** Lavage part only: is this a lavage worker, a réparation worker, or both? */
  workerKind?: BizWorkerKind;
  paid: boolean;                 // reçoit un salaire ?
  /** `pourcentage` pays a share of every intervention the worker performed. */
  salaryType: 'jour' | 'mois' | 'pourcentage';
  salaryAmount: number;
  /** Share of each intervention total, in % — used when salaryType = 'pourcentage'. */
  percentage?: number;
  /**
   * Weekdays worked, indexed like `Date.getDay()` (0 = Sunday … 6 = Saturday).
   * Only meaningful when `salaryType = 'jour'`; the missing days are the repos.
   */
  workDays?: number[];
  /** Date the employee was declared to the CNAS (social security). */
  cnasDate?: string;
  hasAccount: boolean;
  email?: string;
  username?: string;
  password?: string;
  startDate: string;
  permissions: Record<string, boolean>;
  acomptes: BizAcompte[];
  absences: BizAbsence[];
  payments: BizWorkerPayment[];
  // ── Inventaires ───────────────────────────────────────────────────────────
  /**
   * L'employé répond des manquants constatés aux inventaires de sa partie.
   * Activé, son écran de paie liste les inventaires non réglés et permet d'en
   * retenir tout ou partie sur son salaire. Désactivé (le défaut), l'inventaire
   * ne le concerne pas du tout.
   */
  inventoryLiable?: boolean;
  /** Inventaires écartés à la main : ils ne lui sont plus proposés en paie. */
  dismissedInventaireIds?: string[];
  /** Dernière sélection d'inventaires enregistrée pour cet employé. */
  savedInventaireIds?: string[];
  createdAt: string;
}

export interface BizExpense {
  id: string;
  name: string;
  description?: string;
  amount: number;
  date: string;
  category?: string;
}

export interface BizCaisseTx {
  id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  date: string;
  description?: string;
  category?: string;
}

export interface BizIngredient {
  productId: string;
  productName: string;
  quantityUsed: number;
  unitCost: number;
  lineCost: number;
  unit?: string;
  sourceType?: 'stock' | 'fiche';
}

export interface BizFiche {
  id: string;
  name: string;
  categoryId?: string;
  categoryName?: string;
  description?: string;
  ingredients: BizIngredient[];
  sellByUnit?: boolean;
  sellUnit?: string;
  usableInProduction?: boolean;
  productUnit?: string;
  /**
   * Quick-sale fiche (e.g. "café au lait"): appears directly on the POS grid.
   * Selling one deducts the ingredients from stock on the spot — no production
   * run and no comptoir step in between.
   */
  directSale?: boolean;
  outputQuantity: number;
  unitPrice: number;
  totalCost: number;
  costPerUnit: number;
  totalValue: number;
  gainsPerUnit: number;
  totalGains: number;
  /** Image URL (stored in Supabase products bucket or base64 fallback). */
  imageUrl?: string;
  createdAt: string;
}

export interface BizProduction {
  id: string;
  name: string;
  categoryName?: string;
  ficheId?: string;
  date: string;
  createdBy?: string;
  ingredients: BizIngredient[];
  outputQuantity: number;
  expectedQuantity: number;
  sentToComptoir: number;
  unit?: string;
  unitPrice: number;
  totalCost: number;
  totalValue: number;
  costPerUnit: number;
  hasLoss: boolean;
  lossQuantity: number;
  lossValue: number;
  lossReason?: string;
}

export interface BizComptoirItem {
  id: string;
  productName: string;
  categoryName?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  purchasePrice: number;
  date: string;
  sourceProductionId?: string;
}

/**
 * Un produit retiré des stocks parce qu'il est perdu : périmé, cassé, volé…
 *
 * La destruction peut venir de DEUX endroits, et `source` dit lequel — c'est ce
 * qui permet de la récupérer au bon endroit et de n'afficher, sur chaque écran,
 * que son propre historique :
 *   • 'comptoir' (défaut historique) → un produit prêt à la vente au comptoir
 *   • 'stock'                        → un produit du catalogue (Gestion de stock)
 *
 * `unitPrice` est le coût unitaire retenu pour valoriser la perte : le PRIX
 * D'ACHAT côté stock (ce que le produit a réellement coûté), le prix du comptoir
 * côté comptoir. `value` = qty × unitPrice et alimente le résultat de la partie
 * (caisse et rapports).
 */
export interface BizDestruction {
  id: string;
  /** D'où vient le produit détruit. Absent = ancienne destruction du comptoir. */
  source?: 'stock' | 'comptoir';
  /** Produit du catalogue concerné, quand la destruction vient du stock. */
  productId?: string;
  productName: string;
  categoryName?: string;
  qty: number;
  unit?: string;
  /** Coût unitaire retenu pour valoriser la perte. */
  unitPrice: number;
  /**
   * Coût de revient réel d'une unité (prix d'achat / coût de production). Côté
   * comptoir, `unitPrice` est le prix de VENTE : sans ce champ, un produit
   * récupéré revenait au comptoir avec un coût égal à son prix de vente et son
   * gain tombait à zéro dans les rapports.
   */
  unitCost?: number;
  value: number;
  reason?: string;
  date: string;
  createdBy?: string;
  recovered?: boolean;
  /** Quand le produit a été remis en stock / au comptoir. */
  recoveredAt?: string;
  notes?: string;
}

// ─── POS work sessions (session de travail) ────────────────────────────────────
/**
 * A cashier must open a session before selling and closes it at the end of the
 * shift. The opening float (`openingCash`) is money the worker already had in
 * hand — it is NEVER counted in what they owe. The décalage compares the
 * theoretical takings (cash sales of the session) with the cash actually
 * declared at closing, minus the credit granted during the session.
 *
 * A session belongs to ONE employee: `workerId` (and `openedById` for a session
 * an admin opened on their own machine) is what makes it "mine". Two employees
 * can hold an open session at the same time — each one only ever sees, sells in
 * and closes their own (see `src/lib/bizSessions.ts`).
 */
export interface BizSession {
  id: string;
  ref: string;
  workerId?: string;
  workerName: string;
  /** Opening float — excluded from every theoretical/décalage computation. */
  openingCash: number;
  openedAt: string;
  closedAt?: string;
  /** Cash counted by the worker when closing. */
  closingCash?: number;
  status: 'open' | 'closed';
  notes?: string;
  /** Frozen at closing time so the history never drifts. */
  theoretical?: number;
  credit?: number;
  decalage?: number;
  /** Supabase auth user that opened the row — the DB checks ownership on it. */
  authUserId?: string;
  /** App id (module worker id, or admin user id) of whoever opened the session. */
  openedById?: string;
  openedByName?: string;
  /** Who actually clôtured it — an admin may close a forgotten session. */
  closedById?: string;
  closedByName?: string;
}

// ─── Encaissement requests raised by a lavage worker ───────────────────────────
/** A lavage worker tells the cashier/admin how much a client has to pay. */
export interface BizPayRequest {
  id: string;
  ref: string;
  clientName: string;
  car: BizCar;
  amount: number;
  description?: string;
  workerId?: string;
  workerName: string;
  status: 'pending' | 'collected' | 'canceled';
  createdAt: string;
  collectedAt?: string;
  collectedBy?: string;
}

export interface BizCar {
  name?: string;
  marque?: string;
  color?: string;
  year?: string;
  immatriculation?: string;
  description?: string;
}

/** Nature of an intervention: a single kind, or several kinds at once. */
export type BizRepKind = 'reparation' | 'lavage' | 'mixte';

/**
 * One line of work inside an intervention. A single visit can hold several of
 * them — e.g. a « Lavage complet » *and* a « Changement de plaquettes » — each
 * with its own price and its own employees, so the payroll of a
 * percentage-paid worker is computed on exactly what they did.
 */
export interface BizPrestation {
  id: string;
  kind: 'reparation' | 'lavage';
  /** Free-text designation, e.g. "Lavage complet intérieur/extérieur". */
  label: string;
  amount: number;
  /** Employees who performed THIS prestation (subset of `BizReparation.workers`). */
  workerIds: string[];
}

/** A remise granted on an intervention: a percentage or a flat amount. */
export type BizDiscountType = 'percent' | 'amount';

export interface BizReparation {
  id: string;
  ref: string;
  /** `mixte` when the intervention holds both lavage and réparation prestations. */
  kind: BizRepKind;
  clientId?: string;
  /** "Client de passage" when no client record was picked. */
  clientName: string;
  car: BizCar;
  /**
   * Total of the labour lines. Kept in sync with `prestations` (it is their sum)
   * so every older screen and report keeps working unchanged.
   */
  serviceTotal: number;
  /** Detail of the labour: one line per lavage / réparation performed. */
  prestations?: BizPrestation[];
  usedProducts: BizLineItem[];
  problem?: string;
  /** Prestations + produits, BEFORE the remise. */
  subtotal?: number;
  discountType?: BizDiscountType;
  /** The percentage (0-100) or the flat amount typed by the user. */
  discountValue?: number;
  /** Money actually taken off the subtotal — always in DA. */
  discountAmount?: number;
  /** Subtotal − remise. */
  total: number;
  paid: number;
  rest: number;
  status: 'pending' | 'finalized' | 'canceled';
  outDate?: string;
  date: string;
  workers: string[];
  createdBy?: string;
  printedAt?: string;
  /** Payment already settled to the percentage-paid workers of this job. */
  payrollSettled?: boolean;
}

/** Money actually deducted by a remise, clamped to the subtotal. */
export function discountOf(subtotal: number, type: BizDiscountType | undefined, value: number | undefined): number {
  const v = Number(value) || 0;
  if (v <= 0 || subtotal <= 0) return 0;
  const raw = type === 'percent' ? (subtotal * Math.min(v, 100)) / 100 : v;
  return Math.max(0, Math.min(subtotal, raw));
}

/**
 * Prestations of an intervention, rebuilt from the legacy single `serviceTotal`
 * when the record predates the multi-prestation form.
 */
export function prestationsOf(r: BizReparation): BizPrestation[] {
  if (r.prestations && r.prestations.length) return r.prestations;
  if (!r.serviceTotal) return [];
  return [{
    id: `${r.id}-legacy`,
    kind: r.kind === 'mixte' ? 'reparation' : r.kind,
    label: r.problem || (r.kind === 'lavage' ? 'Lavage' : 'Réparation'),
    amount: r.serviceTotal,
    workerIds: r.workers || [],
  }];
}

/** Share of one intervention owed to a percentage-paid worker.
 *  Prestation-level assignments narrow it down to what they actually did. */
export function workerShareOf(r: BizReparation, workerId: string, rate: number): number {
  if (rate <= 0) return 0;
  const lines = (r.prestations || []).filter(p => (p.workerIds || []).includes(workerId));
  // No per-line assignment (legacy record or products-only job) → whole total.
  if (!lines.length) return (r.total * rate) / 100;
  return (lines.reduce((s, p) => s + (Number(p.amount) || 0), 0) * rate) / 100;
}

// ─── Inventaire physique d'une partie ──────────────────────────────────────────
/**
 * Un inventaire, c'est la station qui va COMPTER ce qu'elle a réellement en
 * rayon, puis confronter ce comptage à ce que l'application annonce.
 *
 * Le cycle complet tient en quatre états :
 *   • `draft`     — le comptage est commencé et peut être repris plus tard ;
 *   • `completed` — le comptage est terminé et figé ;
 *   • `compared`  — la confrontation au stock de l'application a été faite et a
 *                   produit ses écarts (le « décalage » de chaque produit) ;
 *   • `corrected` — le stock de l'application a été aligné sur le comptage, une
 *                   sauvegarde des quantités d'avant ayant été prise.
 *
 * On ne repart JAMAIS en arrière tout seul : la correction n'écrase le stock
 * qu'après confirmation explicite, et la sauvegarde permet de revenir en arrière
 * si le comptage s'avérait faux.
 */
export type BizInventaireStatus = 'draft' | 'completed' | 'compared' | 'corrected';

export type BizBadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'primary';

export const INVENTAIRE_STATUS_META: Record<BizInventaireStatus, { label: string; hint: string; tone: BizBadgeTone }> = {
  draft: { label: 'Brouillon', hint: 'Comptage en cours — reprenez-le quand vous voulez', tone: 'warning' },
  completed: { label: 'Terminé', hint: 'Comptage figé — lancez la comparaison', tone: 'info' },
  compared: { label: 'Comparé', hint: 'Écarts calculés — le stock n\'est pas encore corrigé', tone: 'primary' },
  corrected: { label: 'Stock corrigé', hint: 'Le stock de l\'application a été aligné sur le comptage', tone: 'success' },
};

/** Une ligne comptée : un produit et la quantité trouvée en rayon. */
export interface BizInventaireLine {
  productId: string;
  productName: string;
  barcode?: string;
  categoryId?: string;
  categoryName?: string;
  unit?: string;
  /** Quantité comptée, exprimée en unités principales (celles du stock). */
  countedQty: number;
  /** Produit vendu au détail : quantité comptée dans son unité de détail. */
  detailQty?: number;
  detailUnit?: string;
  detailCapacity?: number;
  sellByDetail?: boolean;
  /** Prix d'achat FIGÉ au moment du comptage — c'est lui qui valorise l'écart. */
  purchasePrice: number;
  salePrice: number;
  /** Stock annoncé par l'application quand la ligne a été saisie (indicatif). */
  systemQtyAtEntry?: number;
}

/** L'écart d'un produit entre ce qui a été compté et ce que l'application dit. */
export interface BizInventaireEcart {
  productId: string;
  productName: string;
  categoryName?: string;
  unit?: string;
  /** Quantité comptée en rayon. */
  countedQty: number;
  /** Quantité annoncée par l'application au moment de la comparaison. */
  systemQty: number;
  /** compté − application : négatif = marchandise manquante (perte). */
  ecart: number;
  purchasePrice: number;
  /** ecart × prix d'achat — négatif pour une perte, positif pour un surplus. */
  value: number;
  kind: 'perte' | 'gain' | 'exact';
}

/** Le rapport de comparaison d'un inventaire — figé au moment où il est lancé. */
export interface BizInventaireComparison {
  at: string;
  by?: string;
  lines: BizInventaireEcart[];
  /** Quantité totale manquante et ce qu'elle a coûté (valeurs POSITIVES). */
  lossQty: number;
  lossValue: number;
  /** Quantité et valeur trouvées en plus. */
  gainQty: number;
  gainValue: number;
  /** gainValue − lossValue : l'impact net de l'inventaire sur le patrimoine. */
  netValue: number;
  productsCounted: number;
  productsWithEcart: number;
}

/** Quantités d'un produit AVANT la correction — de quoi revenir en arrière. */
export interface BizInventaireBackupLine {
  productId: string;
  productName: string;
  currentQty: number;
  principalQty: number;
}

export interface BizInventaire {
  id: string;
  /** Nom généré à partir de la date : `invnt-01-01-2026`. */
  ref: string;
  /** Date de l'inventaire (jour du comptage), choisie par l'utilisateur. */
  date: string;
  status: BizInventaireStatus;
  lines: BizInventaireLine[];
  notes?: string;
  createdAt: string;
  createdBy?: string;
  /** Comptage figé (passage de `draft` à `completed`). */
  completedAt?: string;
  /** Rapport d'écarts — présent dès que la comparaison a été lancée. */
  comparison?: BizInventaireComparison;
  /** Correction du stock appliquée à partir des écarts. */
  correctedAt?: string;
  correctedBy?: string;
  /** Sauvegarde des quantités d'avant la correction. */
  backup?: { at: string; lines: BizInventaireBackupLine[] };
  /**
   * Imputer les pertes de cet inventaire aux employés de la partie.
   * `false` ⇒ l'inventaire n'apparaît plus dans l'écran de paie : c'est le
   * bouton « ne pas faire porter ce décalage aux employés ».
   */
  chargeWorkers?: boolean;
}

/** Nom d'un inventaire, dérivé de sa date : `invnt-01-01-2026`. */
export function inventaireRefFor(date: string): string {
  const d = new Date(date);
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `invnt-${p(safe.getDate())}-${p(safe.getMonth() + 1)}-${safe.getFullYear()}`;
}

/** Un inventaire compte-t-il dans les pertes ? (comparé ET imputable) */
export const inventaireCountsForWorkers = (inv: BizInventaire): boolean =>
  !!inv.comparison && inv.chargeWorkers !== false;

/** Coût des manquants d'un inventaire — 0 tant qu'il n'a pas été comparé. */
export const inventaireLossValue = (inv: BizInventaire): number => inv.comparison?.lossValue || 0;

export interface ModuleState {
  categories: BizNamed[];
  marques: BizNamed[];
  roles: BizNamed[];
  products: BizProduct[];
  purchases: BizPurchase[];
  sales: BizSale[];
  clients: BizContact[];
  suppliers: BizContact[];
  workers: BizWorker[];
  expenses: BizExpense[];
  caisse: BizCaisseTx[];
  productions: BizProduction[];
  fiches: BizFiche[];
  comptoir: BizComptoirItem[];
  destructions: BizDestruction[];
  reparations: BizReparation[];
  sessions: BizSession[];
  payRequests: BizPayRequest[];
  /** Inventaires physiques de la partie — comptage, écarts et correction. */
  inventaires: BizInventaire[];
  /**
   * Order of the "accès rapide" tiles of the point de vente: the products that
   * sell the most, pinned by the user so they open the grid. Each entry is a
   * `posPinKey` — the comptoir keys are name-based because a production run
   * creates a new row every time.
   */
  posPinned: string[];
  /**
   * Option « coût moyen pondéré » de la partie : quand elle est active, le
   * formulaire d'achat arrive avec la case cochée et les réceptions mettent à
   * jour le CUMP des produits (voir `src/lib/bizAverageCost.ts`).
   *
   * Absente ⇒ désactivée : rien ne change par rapport au comportement
   * historique. Le réglage n'est qu'une valeur par défaut — chaque achat garde
   * la trace de ce qu'il a RÉELLEMENT fait dans `BizPurchase.useAverageCost`.
   */
  avgCostEnabled?: boolean;
}

/**
 * Stable key of a POS tile, used by the "accès rapide" ordering.
 * Products and fiches keep their id; a comptoir line is keyed by its product
 * name so the pin survives the next production run.
 */
export function posPinKey(kind: 'comptoir' | 'product' | 'fiche', idOrName: string): string {
  return `${kind}:${idOrName}`;
}

export type BizState = Record<ModuleKey, ModuleState>;

// ─── Module presentation config ────────────────────────────────────────────────

export interface ModuleConfig {
  key: ModuleKey;
  label: string;          // section label in sidebar
  short: string;          // short name used in subtitles
  emoji: string;
  base: string;           // route base, e.g. "/restaurant"
  productWord: string;    // "Plat", "Produit"…
  hasProduction: boolean; // production + comptoir + fiches
  hasComptoir: boolean;
  isService: boolean;     // lavage & réparation flow
}

export const MODULES: Record<ModuleKey, ModuleConfig> = {
  cafeteria: {
    key: 'cafeteria',
    label: 'Cafétéria',
    short: 'Cafétéria',
    emoji: '☕',
    base: '/cafeteria',
    productWord: 'Produit',
    hasProduction: true,
    hasComptoir: true,
    isService: false,
  },
  lavage: {
    key: 'lavage',
    label: 'Lavage & Réparation',
    short: 'Lavage',
    emoji: '🧽',
    base: '/lavage',
    productWord: 'Produit',
    hasProduction: false,
    hasComptoir: false,
    isService: true,
  },
};

// Interfaces list shown in the worker "permissions" editor.
export const MODULE_INTERFACES: { id: string; label: string }[] = [
  { id: 'stock', label: 'Gestion de stock' },
  { id: 'inventaire', label: 'Inventaire' },
  { id: 'purchases', label: 'Achats' },
  { id: 'production', label: 'Production' },
  { id: 'comptoir', label: 'Comptoir' },
  { id: 'pos', label: 'Point de vente' },
  { id: 'sales', label: 'Ventes' },
  { id: 'reparations', label: 'Réparations & Lavage' },
  { id: 'encaissements', label: 'Demandes d\'encaissement' },
  { id: 'clients', label: 'Clients' },
  { id: 'suppliers', label: 'Fournisseurs' },
  { id: 'workers', label: 'Employés' },
  { id: 'expenses', label: 'Dépenses' },
  { id: 'caisse', label: 'Caisse' },
  { id: 'reports', label: 'Rapports' },
  { id: 'feedbacks', label: 'Retours clients' },
];

export const INTERFACE_ACTIONS = ['voir', 'creer', 'modifier', 'supprimer'] as const;

/**
 * Interfaces that actually exist for one part — the permissions editor and the
 * employee sidebar must never offer a screen the part does not have (Lavage has
 * no "Production", Cafétéria has no "Réparations").
 *
 * The Lavage part also carries the point-de-vente and ventes screens that used
 * to live in the (now removed) Magasin part.
 *
 * Mirrors `buildModuleRoutes` in App.tsx.
 */
export function interfacesForModule(key: ModuleKey): { id: string; label: string }[] {
  const cfg = MODULES[key];
  const ids = cfg.isService
    ? [
        'reparations', 'encaissements', 'pos', 'sales', 'stock', 'inventaire', 'purchases',
        'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'reports', 'feedbacks',
      ]
    : [
        'stock', 'inventaire', 'purchases',
        ...(cfg.hasProduction ? ['production', 'comptoir'] : []),
        'pos', 'sales', 'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'reports',
        'feedbacks',
      ];
  return ids
    .map(id => MODULE_INTERFACES.find(i => i.id === id))
    .filter((i): i is { id: string; label: string } => !!i);
}
