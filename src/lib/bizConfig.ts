/**
 * ─── Business Modules Configuration & Types ────────────────────────────────────
 * Self-contained data model for the new commerce/production parts added to the
 * StationPro sidebar: Restaurant, Cafétéria, Lavage & Réparation, and Magasin.
 *
 * These modules live on a dedicated in-memory store (`BizContext`) seeded with
 * constant demo data, so they never touch the Supabase-backed fuel-station state.
 * Every generic page (`src/pages/modules/*`) is parameterised by a `ModuleKey`.
 * ──────────────────────────────────────────────────────────────────────────────
 */

export type ModuleKey = 'restaurant' | 'cafeteria' | 'lavage' | 'magasin';

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
  | 'services'
  | 'reparations'
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
  createdAt: string;
}

export interface BizLineItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  minQty?: number;
  hasExpiration?: boolean;
  expirationDate?: string;
  total?: number;
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
  status: 'payée' | 'crédit';
  createdBy?: string;
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
export interface BizWorkerPayment { id: string; period: string; amount: number; date: string; description?: string }

export interface BizWorker {
  id: string;
  name: string;
  birthday?: string;
  cin?: string;
  phone?: string;
  roleName: string;
  paid: boolean;                 // reçoit un salaire ?
  salaryType: 'jour' | 'mois';
  salaryAmount: number;
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
  outputQuantity: number;
  unitPrice: number;
  totalCost: number;
  costPerUnit: number;
  totalValue: number;
  gainsPerUnit: number;
  totalGains: number;
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

export interface BizService {
  id: string;
  name: string;
  description?: string;
  price: number;
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
  kind: 'reparation' | 'lavage' | 'appointment';
  clientId?: string;
  clientName: string;
  car: BizCar;
  services: { id: string; name: string; price: number }[];
  usedProducts: BizLineItem[];
  problem?: string;
  total: number;
  paid: number;
  rest: number;
  status: 'pending' | 'finalized' | 'canceled';
  comingDate?: string;
  outDate?: string;
  date: string;
  workers: string[];
  createdBy?: string;
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
  services: BizService[];
  reparations: BizReparation[];
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
  restaurant: {
    key: 'restaurant',
    label: 'Restaurant',
    short: 'Restaurant',
    emoji: '🍽️',
    base: '/restaurant',
    productWord: 'Produit',
    hasProduction: true,
    hasComptoir: true,
    isService: false,
  },
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
  magasin: {
    key: 'magasin',
    label: 'Magasin',
    short: 'Magasin',
    emoji: '🛍️',
    base: '/magasin',
    productWord: 'Produit',
    hasProduction: false,
    hasComptoir: false,
    isService: false,
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
  { id: 'services', label: 'Services' },
  { id: 'clients', label: 'Clients' },
  { id: 'suppliers', label: 'Fournisseurs' },
  { id: 'workers', label: 'Employés' },
  { id: 'expenses', label: 'Dépenses' },
  { id: 'caisse', label: 'Caisse' },
  { id: 'reports', label: 'Rapports' },
];

export const INTERFACE_ACTIONS = ['voir', 'creer', 'modifier', 'supprimer'] as const;
