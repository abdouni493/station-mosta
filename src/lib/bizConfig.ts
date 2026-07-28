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
  createdAt: string;
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
}

export interface BizSale {
  id: string;
  ref: string;
  clientId?: string;
  clientName: string;   // "Client de passage" si non renseigné
  items: BizLineItem[];
  subtotal: number;
  reduction: number;
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
  /** Set on the replacement sale created by an exchange. */
  exchangeOfSaleId?: string;
  /** Set on the original sale once it has been exchanged. */
  exchangedIntoSaleId?: string;
  /** Difference settled at exchange time (>0 client pays, <0 station refunds). */
  exchangeDelta?: number;
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
  /** Percentage payroll: the works (réparations/lavages) settled by this payment. */
  workIds?: string[];
  /** Sum of the settled works and the rate applied, for the payslip. */
  worksTotal?: number;
  percentage?: number;
  from?: string;
  to?: string;
}

export interface BizWorker {
  id: string;
  /** Supabase auth user id — set once the login account is provisioned. */
  authUserId?: string;
  name: string;
  birthday?: string;
  cin?: string;
  phone?: string;
  roleName: string;
  paid: boolean;                 // reçoit un salaire ?
  /** `pourcentage` pays a share of every intervention the worker performed. */
  salaryType: 'jour' | 'mois' | 'pourcentage';
  salaryAmount: number;
  /** Share of each intervention total, in % — used when salaryType = 'pourcentage'. */
  percentage?: number;
  hasAccount: boolean;
  email?: string;
  username?: string;
  password?: string;
  startDate: string;
  permissions: Record<string, boolean>;
  acomptes: BizAcompte[];
  absences: BizAbsence[];
  payments: BizWorkerPayment[];
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

export interface BizDestruction {
  id: string;
  productName: string;
  qty: number;
  unitPrice: number;
  value: number;
  reason?: string;
  date: string;
  createdBy?: string;
  recovered?: boolean;
}

// ─── POS work sessions (session de travail) ────────────────────────────────────
/**
 * A cashier must open a session before selling and closes it at the end of the
 * shift. The opening float (`openingCash`) is money the worker already had in
 * hand — it is NEVER counted in what they owe. The décalage compares the
 * theoretical takings (cash sales of the session) with the cash actually
 * declared at closing, minus the credit granted during the session.
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

export interface BizReparation {
  id: string;
  ref: string;
  kind: 'reparation' | 'lavage';
  clientId?: string;
  /** "Client de passage" when no client record was picked. */
  clientName: string;
  car: BizCar;
  /** Price of the labour, typed by hand (services catalogue was removed). */
  serviceTotal: number;
  usedProducts: BizLineItem[];
  problem?: string;
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
        'reparations', 'encaissements', 'pos', 'sales', 'stock', 'purchases',
        'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'reports',
      ]
    : [
        'stock', 'purchases',
        ...(cfg.hasProduction ? ['production', 'comptoir'] : []),
        'pos', 'sales', 'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'reports',
      ];
  return ids
    .map(id => MODULE_INTERFACES.find(i => i.id === id))
    .filter((i): i is { id: string; label: string } => !!i);
}
