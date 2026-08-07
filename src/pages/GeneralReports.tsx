import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileBarChart, Globe2, Fuel, ChevronRight, Printer, Calendar, TrendingUp, ShoppingCart,
  CreditCard, CircleDollarSign, Boxes, Users, Truck, AlertTriangle, CalendarClock, Store, Coffee,
  UtensilsCrossed, Wrench, UsersRound, PiggyBank, Landmark, Target, Clock, Car, Banknote, Layers,
  Droplets, Wallet, Hash, X, Trash2, Flame, Undo2, Scale, Moon, LineChart,
  ClipboardList, PackageX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizLineItem, isReversedSale, formatQty } from '@/src/lib/bizConfig';
import { applyRestock, describeRestock, restockPlan } from '@/src/lib/bizRestock';
import { useBizAll, useBiz } from '@/src/store/BizContext';
import { useAppState, useAppDispatch, CAISSE_ID } from '@/src/store/AppContext';
import { money, formatDate, Modal, Badge, Confirm, Table } from '@/src/components/biz/Kit';
import { computeModuleReport, computeCarburantReport, consolidate, within, PartReport, GlobalReport } from '@/src/lib/bizReporting';
import { computeWorkforce } from '@/src/lib/workforceReporting';
import { computeTreasuryReport } from '@/src/lib/treasuryReporting';
import { computeStockValuation } from '@/src/lib/stockValuation';
import { computeWorkingCapital } from '@/src/lib/workingCapital';
import { summarizeInventaires } from '@/src/lib/inventaire';
import {
  computeCarburantAnalytics, computeModuleAnalytics, consolidateAnalytics,
  pickGranularity, Granularity,
} from '@/src/lib/bizAnalytics';
import { ZakatConfig, ZakatInputs, loadZakatConfig } from '@/src/lib/zakat';
import ReportView from '@/src/components/biz/ReportView';
import WorkforceView from '@/src/components/biz/WorkforceView';
import TreasuryView from '@/src/components/biz/TreasuryView';
import WorkingCapitalView from '@/src/components/biz/WorkingCapitalView';
import StockValueView from '@/src/components/biz/StockValueView';
import ZakatView from '@/src/components/biz/ZakatView';
import InventaireReportView, { collectLosses } from '@/src/components/biz/InventaireReportView';
import GlobalAnalyticsView from '@/src/components/biz/GlobalAnalyticsView';
import {
  ModuleFiche, GlobalFiche, PurchasesFiche, PAY_MODE_LABEL, printFiche,
  FuelPurchaseDetail, FuelTypeGroup, payInfoOf, groupPurchasesByFuelType,
} from '@/src/components/biz/ReportFiche';
import { deleteFuelPurchase, tankDeltasOf, describeTankDeltas, litersOf } from '@/src/lib/fuelPurchase';
import { toast } from 'react-hot-toast';

type ActiveKey =
  | 'global' | 'analyses' | 'carburant' | 'employes' | 'tresorerie'
  | 'fonds' | 'stock' | 'zakat' | 'inventaires' | ModuleKey;

const SECTIONS: { id: ActiveKey; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'global', label: 'Vue globale', icon: Globe2, hint: 'Rapport consolidé' },
  { id: 'analyses', label: 'Analyses', icon: LineChart, hint: 'Graphiques, tendances & classements' },
  { id: 'fonds', label: 'Fonds de roulement', icon: Scale, hint: 'Caisses, banques, créances, stock − dettes' },
  { id: 'stock', label: 'Valeur du stock', icon: Boxes, hint: "Au prix d'achat et au prix de vente" },
  { id: 'inventaires', label: 'Inventaires', icon: ClipboardList, hint: 'Comptages, décalages et pertes' },
  { id: 'zakat', label: 'Zakât', icon: Moon, hint: 'Calcul paramétrable de la zakât' },
  { id: 'employes', label: 'Employés & Personnel', icon: UsersRound, hint: 'Tous les employés, en détail' },
  { id: 'tresorerie', label: 'Caisse & Banques', icon: PiggyBank, hint: 'Trésorerie et journal complet' },
  { id: 'carburant', label: 'Carburant', icon: Fuel, hint: 'Rapport détaillé' },
  { id: 'cafeteria', label: 'Cafétéria', icon: Coffee, hint: 'Rapport détaillé' },
  { id: 'lavage', label: 'Lavage & Réparation', icon: Wrench, hint: 'Rapport détaillé' },
];

/** Sections that are a per-activity `PartReport` (the others have their own view). */
const PART_SECTIONS: ActiveKey[] = ['carburant', 'cafeteria', 'lavage'];

// ─── Card drill-downs ─────────────────────────────────────────────────────────
/** The KPI cards that open a detail list (Achats has its own richer modal). */
type CardKey = 'salesTotal' | 'expenses' | 'netGain' | 'stockValue' | 'destructions' | 'clientDebt' | 'supplierDebt' | 'alerts' | 'returns' | 'pertes';

/** One line of a card's underlying list. `onDelete` is absent for derived rows. */
interface DetailRow {
  id: string;
  date?: string;
  label: string;
  sub?: string;
  badge?: { text: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' };
  amount: number;
  amountTone?: 'green' | 'red' | 'blue' | 'amber' | 'slate';
  onDelete?: () => void;
  confirmMessage?: string;
}
interface CardDetail {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  rows: DetailRow[];
  total: number;
  totalLabel: string;
  note?: string;
}

export default function GeneralReports() {
  const biz = useBizAll();
  const app = useAppState();
  const dispatch = useAppDispatch();
  const cafeteriaBiz = useBiz('cafeteria');
  const lavageBiz = useBiz('lavage');
  const settings = app.settings;
  const globalFicheRef = useRef<HTMLDivElement>(null);
  const moduleFicheRef = useRef<HTMLDivElement>(null);
  const purchasesFicheRef = useRef<HTMLDivElement>(null);

  const firstDay = new Date(); firstDay.setDate(1);
  const [from, setFrom] = useState(firstDay.toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [range, setRange] = useState({ from, to });
  const [active, setActive] = useState<ActiveKey>('global');
  const [showPurchases, setShowPurchases] = useState(false);
  // Which KPI card's drill-down is open (every card is clickable → its detail list).
  const [activeCard, setActiveCard] = useState<CardKey | null>(null);
  /** Découpage du temps des analyses — automatique tant qu'on n'y touche pas. */
  const [grain, setGrain] = useState<Granularity | undefined>(undefined);
  /** Réglages de zakât — conservés sur ce poste d'une session à l'autre. */
  const [zakatConfig, setZakatConfig] = useState<ZakatConfig>(() => loadZakatConfig());

  const reports = useMemo(() => ({
    carburant: computeCarburantReport(app, range.from, range.to),
    cafeteria: computeModuleReport(biz.cafeteria, 'cafeteria', range.from, range.to),
    lavage: computeModuleReport(biz.lavage, 'lavage', range.from, range.to),
  }), [biz, app, range]);

  const global: GlobalReport = useMemo(
    () => consolidate([reports.carburant, reports.cafeteria, reports.lavage], range.from, range.to),
    [reports, range],
  );

  const workforce = useMemo(() => computeWorkforce(app, biz, range.from, range.to), [app, biz, range]);
  const treasury = useMemo(() => computeTreasuryReport(app, biz, range.from, range.to), [app, biz, range]);

  // ── Valeur du stock — les deux valorisations, activité par activité ──
  const stockValuation = useMemo(() => computeStockValuation(app, biz), [app, biz]);

  // ── Inventaires — les comptages de chaque partie et leurs décalages ──
  // Chaque inventaire porte déjà son rapport d'écarts figé : on ne fait que les
  // rassembler, pour que cet écran ne puisse pas contredire celui de la partie.
  const inventaireParts = useMemo(() => [
    summarizeInventaires(biz.cafeteria, 'cafeteria', MODULES.cafeteria.label, MODULES.cafeteria.emoji),
    summarizeInventaires(biz.lavage, 'lavage', MODULES.lavage.label, MODULES.lavage.emoji),
  ], [biz]);
  const inventaireLosses = useMemo(() => collectLosses(inventaireParts), [inventaireParts]);
  const inventaireLossTotal = useMemo(
    () => inventaireParts.reduce((s, p) => s + p.lossValue, 0), [inventaireParts]);

  // ── Fonds de roulement — bâti SUR la trésorerie et les rapports déjà calculés,
  //    pour qu'il ne puisse jamais annoncer un autre chiffre qu'eux. ──
  const workingCapital = useMemo(
    () => computeWorkingCapital(treasury, global.parts, stockValuation),
    [treasury, global.parts, stockValuation]);

  // ── Analyses — une par activité, plus leur consolidation ──
  const analytics = useMemo(() => {
    const g = grain || pickGranularity(range.from, range.to);
    const parts = [
      computeCarburantAnalytics(app, range.from, range.to, g),
      computeModuleAnalytics(biz.cafeteria, 'cafeteria', range.from, range.to, g),
      computeModuleAnalytics(biz.lavage, 'lavage', range.from, range.to, g),
    ];
    return { parts, global: consolidateAnalytics(parts, range.from, range.to, g) };
  }, [app, biz, range, grain]);

  // ── Zakât — l'assiette est prise dans l'application, jamais ressaisie ──
  const zakatInputs = useMemo<ZakatInputs>(() => ({
    caisse: workingCapital.cashTotal,
    banques: workingCapital.bankTotal,
    stock: stockValuation.parts.map(p => ({
      key: p.key as 'carburant' | 'cafeteria' | 'lavage',
      label: p.label, emoji: p.emoji, buyValue: p.buyValue, sellValue: p.sellValue,
    })),
    creances: workingCapital.receivablesTotal,
    dettesFournisseurs: workingCapital.payablesTotal,
  }), [workingCapital, stockValuation]);

  // Detailed fuel purchases of the period — the "Achats carburant" drill-down and
  // its printable fiche. Unlike the aggregate report, each achat keeps its full
  // payment breakdown (mode, n° de chèque / bordereau, compte débité).
  const fuelPurchases = useMemo<FuelPurchaseDetail[]>(() => {
    const suppliers: any[] = app.suppliers || [];
    const tanks: any[] = app.tanks || [];
    const bankAccounts: any[] = app.bankAccounts || [];
    const acctLabel = (id?: string) =>
      !id || id === CAISSE_ID ? 'Espèces (caisse)' : (bankAccounts.find(a => a.id === id)?.name || 'Compte bancaire');
    // Nom lisible d'une cuve, pris sur la cuve ACTUELLE quand elle existe encore
    // (le libellé figé dans la ligne d'achat peut dater d'un ancien nom).
    const cuveLabel = (i: any) => {
      const tank = tanks.find(t => t.id === i.tankId);
      return tank ? `${tank.name}${tank.type ? ` (${tank.type})` : ''}` : (i.productName || 'Cuve');
    };
    // Type de carburant d'une ligne, pris sur la cuve — sert à regrouper les achats.
    const cuveType = (i: any): string => tanks.find(t => t.id === i.tankId)?.type || 'AUTRE';
    return (app.purchases || [])
      .filter((p: any) => within(p.date, range.from, range.to))
      // Only fuel purchases (they always carry a cuve), like the Achats Carburant screen.
      .filter((p: any) => (p.items || []).some((i: any) => !!i.tankId) || !!p.tankId)
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((p: any): FuelPurchaseDetail => ({
        id: p.id,
        ref: p.invoiceNumber || p.blNumber || p.id.slice(0, 8).toUpperCase(),
        invoiceNumber: p.invoiceNumber,
        blNumber: p.blNumber,
        date: p.date,
        supplier: suppliers.find(s => s.id === p.supplierId)?.name || '—',
        status: p.status || '—',
        items: (p.items || []).map((i: any) => ({
          name: cuveLabel(i),
          qty: i.quantity || 0,
          unitPrice: i.buyPrice || 0,
          total: i.total ?? (i.quantity || 0) * (i.buyPrice || 0),
          type: cuveType(i),
        })),
        cuves: Array.from(new Set((p.items || []).filter((i: any) => i.tankId).map(cuveLabel))).join(', '),
        subtotal: p.subtotal || 0,
        discountAmount: p.discountAmount || 0,
        tvaAmount: p.tvaAmount || 0,
        total: p.total || 0,
        paid: p.amountPaid || 0,
        rest: p.rest || 0,
        liters: (p.items || []).reduce((s: number, i: any) => s + (i.quantity || 0), 0),
        payments: (p.payments || []).map((pay: any) => ({
          mode: pay.mode,
          amount: pay.amount || 0,
          chequeNumber: pay.chequeNumber,
          bordereauNumber: pay.bordereauNumber,
          account: acctLabel(pay.accountId),
          date: pay.date,
          notes: pay.notes,
        })),
      }));
  }, [app, range]);

  // Underlying list behind every KPI card. Rows carry their own delete action so
  // the user can drill in and remove an entry (a sale, an expense, a product…);
  // derived rows (bénéfice net, alertes) are shown read-only.
  const cardDetails = useMemo<Record<CardKey, CardDetail>>(() => {
    const bizOf = (k: 'cafeteria' | 'lavage') => (k === 'cafeteria' ? cafeteriaBiz : lavageBiz);
    const stateOf = (k: 'cafeteria' | 'lavage') => (k === 'cafeteria' ? biz.cafeteria : biz.lavage);
    const clientName = (id?: string) => app.clients?.find((c: any) => c.id === id)?.name;
    const byDateDesc = (a: DetailRow, b: DetailRow) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();

    // ── Ventes totales — fuel + shop (carburant) + biz sales/reparations ──
    const salesRows: DetailRow[] = [];
    (app.fuelSales || []).filter((s: any) => within(s.date, range.from, range.to)).forEach((s: any) => salesRows.push({
      id: `fuel-${s.id}`, date: s.date,
      label: `⛽ Carburant — ${(s.liters || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`,
      sub: clientName(s.clientId) || 'Comptoir', amount: s.total || 0, amountTone: 'green',
      onDelete: () => dispatch({ type: 'DELETE_FUEL_SALE', payload: s.id }),
      confirmMessage: `Supprimer cette vente carburant de ${money(s.total || 0)} ? Le mouvement sera retiré définitivement.`,
    }));
    (app.shopSales || []).filter((s: any) => within(s.date, range.from, range.to)).forEach((s: any) => salesRows.push({
      id: `shop-${s.id}`, date: s.date,
      label: `🛒 Magasin — ${(s.items || []).length} article(s)`,
      sub: clientName(s.clientId) || 'Comptoir', amount: s.total || 0, amountTone: 'green',
      onDelete: () => dispatch({ type: 'DELETE_SHOP_SALE', payload: s.id }),
      confirmMessage: `Supprimer cette vente magasin de ${money(s.total || 0)} ?`,
    }));
    // Supprimer une vente ou une intervention depuis ce rapport fait le MÊME
    // retour de marchandise que l'écran d'origine : les articles vendus et les
    // pièces posées reviennent en stock avant que la ligne ne disparaisse.
    (['cafeteria', 'lavage'] as const).forEach(k => reports[k].sales.forEach(s => {
      const isRep = s.kind !== 'Vente';
      const api = bizOf(k);
      const st = stateOf(k);
      const lines: BizLineItem[] = isRep
        ? (st.reparations.find(r => r.id === s.id)?.usedProducts || [])
        : (st.sales.find(x => x.id === s.id)?.items || []);
      const reversed = !isRep && !!st.sales.find(x => x.id === s.id && isReversedSale(x));
      const impact = reversed ? '' : describeRestock(st, lines);
      salesRows.push({
        id: `${k}-${s.id}`, date: s.date,
        label: `${reports[k].emoji} ${s.kind}${s.ref ? ' · ' + s.ref : ''}`,
        sub: s.client || 'Comptoir', amount: s.total, amountTone: 'green',
        onDelete: () => {
          if (!reversed) applyRestock(api, restockPlan(st, lines));
          api.remove(isRep ? 'reparations' : 'sales', s.id);
        },
        confirmMessage: `Supprimer « ${s.ref || s.kind} » (${money(s.total)}) ?\n\n`
          + (reversed
            ? 'Cette vente a déjà été retournée ou échangée : sa marchandise est revenue en stock.'
            : 'Les quantités seront REMISES en stock.\n\n' + (impact || 'Aucune quantité à remettre en stock.')),
      });
    }));
    salesRows.sort(byDateDesc);

    // ── Retours & échanges — ventes ANNULÉES, déjà retirées des lignes ci-dessus ──
    // La marchandise est revenue en stock : ces ventes ne comptent plus dans le CA
    // ni dans les gains. On les liste à part pour que l'écart se lise noir sur blanc.
    const returnRows: DetailRow[] = [];
    (['cafeteria', 'lavage'] as const).forEach(k => reports[k].returns.forEach(rt => returnRows.push({
      id: `${k}-ret-${rt.id}`, date: rt.date,
      label: `${reports[k].emoji} ${rt.kind} · ${rt.ref}`,
      sub: [
        rt.client,
        `${money(rt.refunded)} rendu(s) au client`,
        `${money(rt.restockedCost)} de marchandise remise en stock`,
        rt.reason,
      ].filter(Boolean).join(' · '),
      badge: { text: rt.kind, tone: rt.kind === 'Retour' ? 'neutral' : 'info' },
      amount: rt.total, amountTone: 'slate',
    })));
    returnRows.sort(byDateDesc);

    // ── Dépenses + salaires — dépenses supprimables, salaires en lecture seule ──
    const expenseRows: DetailRow[] = [];
    reports.carburant.expenses.forEach(e => expenseRows.push({
      id: `carb-${e.id}`, date: e.date, label: `💸 ${e.label}`, sub: e.description, amount: e.amount, amountTone: 'red',
      onDelete: () => dispatch({ type: 'DELETE_EXPENSE', payload: e.id }),
      confirmMessage: `Supprimer la dépense « ${e.label} » (${money(e.amount)}) ?`,
    }));
    (['cafeteria', 'lavage'] as const).forEach(k => reports[k].expenses.forEach(e => {
      if (e.kind === 'Dépense') expenseRows.push({
        id: `${k}-${e.id}`, date: e.date, label: `${reports[k].emoji} ${e.label}`, sub: e.description, amount: e.amount, amountTone: 'red',
        onDelete: () => bizOf(k).remove('expenses', e.id),
        confirmMessage: `Supprimer la dépense « ${e.label} » (${money(e.amount)}) ?`,
      });
      else if (e.kind === 'Salaire') expenseRows.push({
        id: `${k}-${e.id}`, date: e.date, label: `${reports[k].emoji} Salaire — ${e.label}`, sub: e.description, amount: e.amount, amountTone: 'amber',
        badge: { text: 'Salaire', tone: 'info' },
      });
    }));
    expenseRows.sort(byDateDesc);

    // ── Bénéfice net — décomposition par activité (lecture seule) ──
    // Le sous-titre déroule le calcul complet : ce qui a été vendu, ce que la
    // marchandise a coûté, puis les charges — c'est là que se lit l'écart entre
    // le prix de vente d'un produit et le gain qu'il rapporte vraiment.
    const netRows: DetailRow[] = global.parts.map(p => ({
      id: p.key, label: `${p.emoji} ${p.label}`,
      sub: `Ventes ${money(p.salesTotal)} − coût marchandises ${money(p.cogs)} = marge ${money(p.grossMargin)}`
        + ` − charges ${money(p.expensesTotal + p.salariesPaid)}`
        + (p.destroyedValue > 0 ? ` − destructions ${money(p.destroyedValue)}` : '')
        + (p.lossValue > 0 ? ` − pertes ${money(p.lossValue)}` : ''),
      amount: p.netGain, amountTone: p.netGain >= 0 ? 'green' : 'red',
    }));

    // ── Destructions — marchandise perdue (stock + comptoir), avec son détail ──
    const destructionRows: DetailRow[] = [];
    (['cafeteria', 'lavage'] as const).forEach(k => reports[k].destructions.forEach(d => destructionRows.push({
      id: `${k}-${d.id}`, date: d.date,
      label: `${reports[k].emoji} ${d.name}`,
      sub: [
        `${d.qty} ${d.unit || ''} × ${money(d.unitPrice)}`.trim(),
        d.reason,
        d.createdBy ? `par ${d.createdBy}` : undefined,
      ].filter(Boolean).join(' · '),
      badge: { text: d.source === 'stock' ? 'Stock' : 'Comptoir', tone: d.source === 'stock' ? 'info' : 'neutral' },
      amount: d.value, amountTone: 'red',
      onDelete: () => bizOf(k).remove('destructions', d.id),
      confirmMessage: `Retirer la destruction de « ${d.name} » (${money(d.value)}) de l'historique ? Le stock n'est pas modifié.`,
    })));
    destructionRows.sort(byDateDesc);

    // ── Valeur du stock — produits valorisés ──
    const stockRows: DetailRow[] = [];
    (app.products || []).forEach((p: any) => stockRows.push({
      id: `carb-${p.id}`, label: `⛽ ${p.name}`,
      sub: `${(p.stock || 0).toLocaleString('fr-FR')} ${p.unit || ''} × ${money(p.buyPrice || 0)}`,
      amount: (p.stock || 0) * (p.buyPrice || 0), amountTone: 'blue',
      onDelete: () => dispatch({ type: 'DELETE_PRODUCT', payload: p.id }),
      confirmMessage: `Supprimer le produit « ${p.name} » ? Il disparaîtra de l'inventaire.`,
    }));
    (['cafeteria', 'lavage'] as const).forEach(k => (stateOf(k).products || []).forEach((p: any) => stockRows.push({
      id: `${k}-${p.id}`, label: `${reports[k].emoji} ${p.name}`,
      sub: `${(p.currentQty || 0).toLocaleString('fr-FR')} ${p.unit || ''} × ${money(p.purchasePrice || 0)}`,
      amount: (p.currentQty || 0) * (p.purchasePrice || 0), amountTone: 'blue',
      onDelete: () => bizOf(k).remove('products', p.id),
      confirmMessage: `Supprimer le produit « ${p.name} » ?`,
    })));
    stockRows.sort((a, b) => b.amount - a.amount);

    // ── Dettes clients ──
    const clientDebtRows: DetailRow[] = [];
    (app.clients || []).filter((c: any) => (c.debt || 0) > 0).forEach((c: any) => clientDebtRows.push({
      id: `carb-${c.id}`, label: `👤 ${c.name}`, sub: c.phone || c.type, amount: c.debt, amountTone: 'red',
      onDelete: () => dispatch({ type: 'DELETE_CLIENT', payload: c.id }),
      confirmMessage: `Supprimer le client « ${c.name} » et tout son historique ? Cette action est définitive.`,
    }));
    (['cafeteria', 'lavage'] as const).forEach(k => reports[k].clientDebts.forEach(d => clientDebtRows.push({
      id: `${k}-${d.id}`, label: `${reports[k].emoji} ${d.name}`, sub: d.ref, amount: d.rest, amountTone: 'red',
    })));
    clientDebtRows.sort((a, b) => b.amount - a.amount);

    // ── Dettes fournisseurs ──
    const supplierDebtRows: DetailRow[] = [];
    (app.suppliers || []).filter((s: any) => (s.balance || 0) > 0).forEach((s: any) => supplierDebtRows.push({
      id: `carb-${s.id}`, label: `🚚 ${s.name}`, sub: s.phone, amount: s.balance, amountTone: 'red',
      onDelete: () => dispatch({ type: 'DELETE_SUPPLIER', payload: s.id }),
      confirmMessage: `Supprimer le fournisseur « ${s.name} » et son historique ? Action définitive.`,
    }));
    (['cafeteria', 'lavage'] as const).forEach(k => reports[k].supplierDebts.forEach(d => supplierDebtRows.push({
      id: `${k}-${d.id}`, label: `${reports[k].emoji} ${d.name}`, sub: d.ref, amount: d.rest, amountTone: 'red',
    })));
    supplierDebtRows.sort((a, b) => b.amount - a.amount);

    // ── Alertes — stock bas + péremptions (lecture seule) ──
    const alertRows: DetailRow[] = [];
    global.parts.forEach(p => {
      p.stockAlerts.forEach(a => alertRows.push({
        id: `stk-${p.key}-${a.id}`, label: `${p.emoji} ${a.name}`,
        sub: `Stock ${a.currentQty} ${a.unit || ''} ≤ min ${a.minQty}`, amount: a.value, amountTone: 'amber',
        badge: { text: 'Stock bas', tone: 'warning' },
      }));
      p.expiryAlerts.forEach(a => alertRows.push({
        id: `exp-${p.key}-${a.id}`, label: `${p.emoji} ${a.name}`,
        sub: `${a.status === 'expired' ? 'Expiré' : 'Expire bientôt'} · ${formatDate(a.expirationDate)}`,
        amount: a.value, amountTone: 'red', badge: { text: a.status === 'expired' ? 'Expiré' : 'Bientôt', tone: 'danger' },
      }));
    });

    // ── Pertes d'inventaire — la marchandise qui manquait au comptage ──
    // Une perte n'est PAS une destruction : personne ne l'a déclarée cassée ou
    // périmée, elle a simplement disparu entre deux comptages. C'est cette somme
    // qui peut être imputée aux employés depuis leur écran de paie.
    const perteRows: DetailRow[] = inventaireLosses.map(l => ({
      id: l.id, date: l.inventaire.date,
      label: `${l.emoji} ${l.productName}`,
      sub: [
        `Inventaire ${l.inventaire.ref}`,
        `compté ${formatQty(l.countedQty)} ${l.unit || ''} contre ${formatQty(l.systemQty)} annoncé(s)`.trim(),
        `manque ${formatQty(Math.abs(l.ecart))} ${l.unit || ''} × ${money(l.purchasePrice)}`.trim(),
        l.inventaire.chargeWorkers === false ? 'non imputé aux employés' : undefined,
      ].filter(Boolean).join(' · '),
      badge: { text: l.partLabel, tone: 'danger' },
      amount: l.value, amountTone: 'red',
    }));

    return {
      pertes:       { title: 'Pertes d\'inventaire', icon: PackageX, subtitle: 'Marchandise manquante constatée au comptage', rows: perteRows, total: inventaireLossTotal, totalLabel: 'Total des pertes', note: 'Le manquant est valorisé au prix d\'achat du produit. Ces lignes sont calculées par les inventaires — pour les corriger, reprenez le comptage depuis l\'écran Inventaire de la partie concernée. Les inventaires dont l\'imputation est activée apparaissent dans la paie des employés concernés.' },
      salesTotal:   { title: 'Ventes totales', icon: TrendingUp, subtitle: 'Détail de toutes les ventes de la période', rows: salesRows, total: global.salesTotal, totalLabel: 'Total ventes', note: global.counts.returns ? `${global.counts.returns} vente(s) retournée(s) ou échangée(s) ne figurent pas ici : leur marchandise est revenue en stock. Voir la carte « Retours & échanges ».` : undefined },
      returns:      { title: 'Retours & échanges', icon: Undo2, subtitle: 'Ventes annulées — marchandise revenue en stock', rows: returnRows, total: global.returnsTotal, totalLabel: 'CA annulé', note: `Ces ventes sont exclues du chiffre d'affaires et des gains : les articles ont été remis en stock (${money(global.restockedCost)} de coût de revient) et ${money(global.refundedTotal)} ont été rendus aux clients. Annulez un retour depuis l'écran Ventes de la partie concernée.` },
      expenses:     { title: 'Dépenses + salaires', icon: CreditCard, subtitle: 'Dépenses et salaires de la période', rows: expenseRows, total: global.expensesTotal + global.salariesPaid, totalLabel: 'Total charges', note: 'Les salaires sont calculés par la paie — supprimez-les depuis la fiche employé.' },
      netGain:      { title: 'Total des gains', icon: CircleDollarSign, subtitle: 'Décomposition par activité', rows: netRows, total: global.netGain, totalLabel: 'Gain net', note: `Ventes ${money(global.salesTotal)} − coût des marchandises vendues ${money(global.cogs)} = marge brute ${money(global.grossMargin)}, moins les dépenses, salaires, destructions et pertes. Le gain d'un produit fabriqué est son prix de vente MOINS le coût de ses ingrédients — jamais le prix de vente entier. Lignes calculées — non supprimables.` },
      stockValue:   { title: 'Valeur du stock', icon: Boxes, subtitle: "Produits en stock valorisés au prix d'achat", rows: stockRows, total: global.stockValue, totalLabel: 'Valeur totale' },
      destructions: { title: 'Destructions', icon: Flame, subtitle: 'Marchandise perdue (périmée, cassée, volée) — stock & comptoir', rows: destructionRows, total: global.destroyedValue, totalLabel: 'Coût total des pertes', note: 'Le coût des destructions est déduit du bénéfice net. Supprimer une ligne ne remet PAS la quantité en stock — utilisez « Récupérer » depuis la Gestion de stock.' },
      clientDebt:   { title: 'Dettes clients', icon: Users, subtitle: 'Encours clients (toutes dates)', rows: clientDebtRows, total: global.clientDebtTotal, totalLabel: 'Total encours' },
      supplierDebt: { title: 'Dettes fournisseurs', icon: Truck, subtitle: 'Encours fournisseurs (toutes dates)', rows: supplierDebtRows, total: global.supplierDebtTotal, totalLabel: 'Total encours' },
      alerts:       { title: 'Alertes', icon: AlertTriangle, subtitle: 'Stock bas et péremptions', rows: alertRows, total: alertRows.reduce((s, r) => s + r.amount, 0), totalLabel: 'Valeur concernée', note: 'Alertes calculées — non supprimables.' },
    };
  }, [global, reports, app, biz, range, dispatch, cafeteriaBiz, lavageBiz, inventaireLosses, inventaireLossTotal]);

  const activeReport: PartReport | null = PART_SECTIONS.includes(active)
    ? reports[active as 'carburant' | ModuleKey]
    : null;
  const activeInfo = SECTIONS.find(s => s.id === active)!;
  const ActiveIcon = activeInfo.icon;

  /**
   * Deleting an achat from this report does the SAME full rollback as the Achats
   * Carburant screen: the litres delivered are taken back out of the cuves and
   * the règlements are refunded to the caisse / bank accounts. Dropping the row
   * alone used to leave the cuve levels permanently inflated.
   */
  const deletePurchase = (id: string) => {
    const purchase = (app.purchases || []).find((p: any) => p.id === id);
    if (!purchase) return;
    const deltas = deleteFuelPurchase(purchase, app.treasuryTransactions || [], dispatch);
    const liters = litersOf(purchase);
    toast.success(deltas.length
      ? `Achat supprimé — ${liters.toLocaleString('fr-FR')} L retirés des cuves`
      : 'Achat supprimé');
  };

  /** Cuve levels an achat deletion would restore, shown in the confirm dialog. */
  const purchaseImpact = (id: string) => {
    const purchase = (app.purchases || []).find((p: any) => p.id === id);
    if (!purchase) return '';
    return describeTankDeltas(tankDeltasOf(purchase, -1), app.tanks || []);
  };

  const generate = () => setRange({ from, to });
  // The two cross-cutting sections have no dedicated printable sheet: they fall
  // back to the consolidated one, which already carries their headline numbers.
  const handlePrint = () => printFiche(activeReport ? moduleFicheRef.current : globalFicheRef.current);
  const handlePrintPurchases = () => printFiche(purchasesFicheRef.current);

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-blue-900 uppercase italic tracking-tighter leading-none">Rapports Généraux</h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">Bilan consolidé et détaillé de toutes les activités : carburant, cafétéria et lavage & réparation.</p>
        </div>
        <button onClick={handlePrint} className="btn-primary h-14 px-10 text-[11px] uppercase tracking-[0.25em] italic font-black flex items-center gap-3 shrink-0">
          <Printer className="w-4 h-4" /> Imprimer {activeReport ? 'la fiche' : 'la fiche globale'}
        </button>
      </div>

      {/* Date range */}
      <div className="card-glass p-4 flex flex-wrap items-end gap-3">
        <div><label className="label-field">Date début</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field !w-auto" /></div>
        <div><label className="label-field">Date fin</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field !w-auto" /></div>
        <button className="btn-secondary" onClick={generate}><FileBarChart className="w-4 h-4" /> Générer</button>
        <span className="ml-auto text-xs text-slate-400 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatDate(range.from)} → {formatDate(range.to)}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Nav */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl overflow-hidden shadow-xl sticky top-4" style={{ background: 'linear-gradient(170deg, #001233 0%, #001f5c 35%, #003087 70%, #002470 100%)' }}>
            <div className="px-5 py-5 flex items-center gap-3 border-b border-white/10">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shrink-0" style={{ background: 'linear-gradient(135deg, #FFB800 0%, #e6a000 100%)' }}><FileBarChart className="w-5 h-5 text-[#001f5c]" /></div>
              <div><p className="text-white font-black text-sm leading-none">Rapports</p><p className="text-[10px] font-semibold uppercase tracking-widest mt-0.5" style={{ color: 'rgba(255,184,0,0.65)' }}>Consolidés</p></div>
            </div>
            <div className="px-3 py-3 space-y-0.5">
              {SECTIONS.map(s => {
                const Icon = s.icon; const isActive = active === s.id;
                const rep = PART_SECTIONS.includes(s.id) ? reports[s.id as 'carburant' | ModuleKey] : null;
                // Cross-cutting sections show a count instead of a net-gain figure.
                const badge = rep
                  ? { text: money(rep.netGain).replace(' DA', ''), cls: rep.netGain >= 0 ? 'text-emerald-300' : 'text-red-300' }
                  : s.id === 'employes'
                    ? { text: `${workforce.totals.workers}`, cls: 'text-blue-200' }
                    : s.id === 'tresorerie'
                      ? { text: money(treasury.grandTotal).replace(' DA', ''), cls: treasury.grandTotal >= 0 ? 'text-emerald-300' : 'text-red-300' }
                      : s.id === 'fonds'
                        ? { text: money(workingCapital.workingCapital).replace(' DA', ''), cls: workingCapital.workingCapital >= 0 ? 'text-emerald-300' : 'text-red-300' }
                        : s.id === 'stock'
                          ? { text: money(stockValuation.buyValue).replace(' DA', ''), cls: 'text-amber-300' }
                          : s.id === 'inventaires'
                            ? { text: money(inventaireLossTotal).replace(' DA', ''), cls: inventaireLossTotal > 0 ? 'text-red-300' : 'text-emerald-300' }
                          : s.id === 'analyses'
                            ? { text: `${analytics.global.trendPct >= 0 ? '+' : ''}${analytics.global.trendPct.toFixed(0)}%`, cls: analytics.global.trendPct >= 0 ? 'text-emerald-300' : 'text-red-300' }
                            : null;
                return (
                  <button key={s.id} onClick={() => setActive(s.id)} className={cn('sidebar-link w-full', isActive ? 'sidebar-link-active' : 'sidebar-link-inactive')}>
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', isActive ? 'bg-[#001f5c]/20' : 'bg-white/6')}><Icon className={cn('w-3.5 h-3.5', isActive ? 'text-[#001f5c]' : 'text-blue-200')} /></div>
                    <span className="text-sm leading-none flex-1 text-left">{s.label}</span>
                    {badge ? <span className={cn('text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded', badge.cls)}>{badge.text}</span> : null}
                    {isActive && <ChevronRight className="w-3 h-3 text-[#001f5c]/50 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {/* Total gain footer */}
            <div className="px-5 py-4 border-t border-white/10 space-y-3" style={{ background: 'rgba(0,0,0,0.15)' }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Gain net total</p>
                <p className={cn('text-2xl font-black tabular-nums leading-tight', global.netGain >= 0 ? 'text-emerald-400' : 'text-red-400')}>{money(global.netGain)}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/5 px-2.5 py-2">
                  <p className="text-[9px] font-black uppercase tracking-wide text-white/40">Trésorerie</p>
                  <p className="text-[13px] font-black tabular-nums text-[#FFB800] leading-tight">{money(treasury.grandTotal)}</p>
                </div>
                <div className="rounded-lg bg-white/5 px-2.5 py-2">
                  <p className="text-[9px] font-black uppercase tracking-wide text-white/40">Employés</p>
                  <p className="text-[13px] font-black tabular-nums text-white leading-tight">{workforce.totals.workers}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col min-h-[700px]" style={{ boxShadow: 'var(--shadow-xl)' }}>
            <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white px-8 py-5 flex items-center gap-4 shrink-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,184,0,0.2)', border: '1px solid rgba(255,184,0,0.3)' }}><ActiveIcon className="w-4 h-4 text-yellow-400" /></div>
              <div><h2 className="font-black text-sm uppercase tracking-widest italic leading-none">{activeInfo.label}</h2><p className="text-[10px] text-blue-200 mt-0.5 font-bold">{activeInfo.hint}</p></div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar">
              <AnimatePresence mode="wait">
                <motion.div key={active} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {active === 'global' && <GlobalOverview global={global} workforce={workforce} treasury={treasury} workingCapital={workingCapital} stock={stockValuation} inventaires={inventaireParts} inventaireLossTotal={inventaireLossTotal} onSelect={setActive} onOpenPurchases={() => setShowPurchases(true)} onOpenCard={setActiveCard} />}
                  {active === 'analyses' && <GlobalAnalyticsView parts={analytics.parts} global={analytics.global} onGranularity={setGrain} />}
                  {active === 'fonds' && <WorkingCapitalView report={workingCapital} />}
                  {active === 'stock' && <StockValueView valuation={stockValuation} />}
                  {active === 'inventaires' && <InventaireReportView parts={inventaireParts} />}
                  {active === 'zakat' && <ZakatView inputs={zakatInputs} config={zakatConfig} onConfig={setZakatConfig} />}
                  {active === 'employes' && <WorkforceView report={workforce} />}
                  {active === 'tresorerie' && <TreasuryView report={treasury} />}
                  {activeReport && <ReportView report={activeReport} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Achats carburant — détail complet + impression */}
      <PurchasesDetailModal
        open={showPurchases}
        onClose={() => setShowPurchases(false)}
        purchases={fuelPurchases}
        range={range}
        onPrint={handlePrintPurchases}
        onDelete={deletePurchase}
        impactOf={purchaseImpact}
      />

      {/* Drill-down d'une carte KPI — liste détaillée + suppression */}
      <CardDetailModal
        detail={activeCard ? cardDetails[activeCard] : null}
        onClose={() => setActiveCard(null)}
      />

      {/* Off-screen printable fiches */}
      <GlobalFiche ref={globalFicheRef} global={global} settings={settings} />
      {activeReport && <ModuleFiche ref={moduleFicheRef} report={activeReport} settings={settings} />}
      <PurchasesFiche ref={purchasesFicheRef} purchases={fuelPurchases} from={range.from} to={range.to} settings={settings} />
    </div>
  );
}

// ─── Global overview ─────────────────────────────────────────────────────────
function OverviewCard({ icon: Icon, label, value, sub, tone = 'blue', onClick, cta }: { icon: React.ElementType; label: string; value: string; sub?: string; tone?: string; onClick?: () => void; cta?: string; key?: React.Key }) {
  const tones: Record<string, string> = { blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600', red: 'from-red-500 to-red-600', amber: 'from-amber-500 to-yellow-500', purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-teal-600', slate: 'from-slate-500 to-slate-600' };
  const inner = (
    <>
      <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br text-white flex items-center justify-center mb-2', tones[tone])}><Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} /></div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
      {onClick && (
        <p className="text-[11px] font-black text-[#003087] mt-1.5 flex items-center gap-1">
          {cta || 'Voir le détail'} <ChevronRight className="w-3 h-3" />
        </p>
      )}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick}
        className="rounded-2xl border border-slate-100 p-4 bg-white shadow-sm text-left w-full transition-all hover:border-[#003087]/40 hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[#003087]/20 cursor-pointer">
        {inner}
      </button>
    );
  }
  return <div className="rounded-2xl border border-slate-100 p-4 bg-white shadow-sm">{inner}</div>;
}

/**
 * Bandeau de tête du rapport global : les trois totaux de la période — ventes,
 * dépenses, gain — suivis du calcul qui mène de l'un à l'autre.
 *
 * Le gain affiché n'est JAMAIS le montant encaissé : une part vendue 30 DA dont
 * les ingrédients ont coûté 12 DA rapporte 18 DA. Le coût des marchandises est
 * donc montré explicitement entre les ventes et la marge.
 */
function ResultBand({ salesTotal, cogs, grossMargin, chargesTotal, destroyedValue, lossValue, netGain, salesCount, onOpenCard }: {
  salesTotal: number; cogs: number; grossMargin: number; chargesTotal: number;
  destroyedValue: number; lossValue: number; netGain: number; salesCount: number;
  onOpenCard: (k: CardKey) => void;
}) {
  const positive = netGain >= 0;
  const steps: { label: string; value: number; sign: '' | '−' | '='; tone: string }[] = [
    { label: 'Ventes encaissées', value: salesTotal, sign: '', tone: 'text-emerald-700' },
    { label: 'Coût des marchandises vendues', value: cogs, sign: '−', tone: 'text-amber-700' },
    { label: 'Marge brute', value: grossMargin, sign: '=', tone: 'text-blue-700' },
    { label: 'Dépenses + salaires', value: chargesTotal, sign: '−', tone: 'text-red-600' },
    ...(destroyedValue > 0 ? [{ label: 'Destructions', value: destroyedValue, sign: '−' as const, tone: 'text-red-600' }] : []),
    ...(lossValue > 0 ? [{ label: 'Pertes de production', value: lossValue, sign: '−' as const, tone: 'text-red-600' }] : []),
    { label: 'Gain net', value: netGain, sign: '=', tone: positive ? 'text-emerald-600' : 'text-red-600' },
  ];

  return (
    <div className="space-y-3">
      {/* Les trois totaux */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button onClick={() => onOpenCard('salesTotal')}
          className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100">
            <TrendingUp className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Total des ventes</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5">{money(salesTotal)}</p>
          <p className="text-[11px] text-emerald-100 mt-0.5">{salesCount} opération(s) — voir le détail →</p>
        </button>

        <button onClick={() => onOpenCard('expenses')}
          className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
          <div className="flex items-center gap-2 text-red-100">
            <CreditCard className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Total des dépenses</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5">{money(chargesTotal)}</p>
          <p className="text-[11px] text-red-100 mt-0.5">Dépenses + salaires — voir le détail →</p>
        </button>

        <button onClick={() => onOpenCard('netGain')}
          className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5"
          style={{ background: positive ? 'linear-gradient(135deg,#001f5c,#003087)' : 'linear-gradient(135deg,#7f1d1d,#b91c1c)' }}>
          <div className="flex items-center gap-2" style={{ color: positive ? 'rgba(255,184,0,0.85)' : '#fecaca' }}>
            <CircleDollarSign className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Total des gains</span>
          </div>
          <p className="text-3xl font-black tabular-nums mt-1.5" style={{ color: positive ? '#FFB800' : '#fff' }}>{money(netGain)}</p>
          <p className="text-[11px] mt-0.5" style={{ color: positive ? 'rgba(255,255,255,0.7)' : '#fecaca' }}>
            Bénéfice réel, coût des produits déduit →
          </p>
        </button>
      </div>

      {/* Le calcul, étape par étape */}
      <div className="card-glass p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Comment le gain est calculé</p>
        <div className="flex flex-wrap items-stretch gap-2">
          {steps.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <span className="self-center text-slate-300 font-black text-lg px-0.5">{s.sign}</span>}
              <div className={cn('rounded-xl px-3 py-2 flex-1 min-w-[130px]', s.sign === '=' ? 'bg-slate-100' : 'bg-slate-50')}>
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-tight">{s.label}</p>
                <p className={cn('font-black tabular-nums text-sm mt-0.5', s.tone)}>{money(s.value)}</p>
              </div>
            </React.Fragment>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 italic mt-3">
          Un produit vendu {money(30)} qui a coûté {money(12)} à fabriquer ou à acheter rapporte {money(18)} :
          c'est ce montant-là qui alimente « Total des gains », jamais le prix de vente entier.
        </p>
      </div>
    </div>
  );
}

function GlobalOverview({ global: g, workforce: wf, treasury: tr, workingCapital: wc, stock: sv, inventaires: invs, inventaireLossTotal, onSelect, onOpenPurchases, onOpenCard }: {
  global: GlobalReport;
  workforce: ReturnType<typeof computeWorkforce>;
  treasury: ReturnType<typeof computeTreasuryReport>;
  workingCapital: ReturnType<typeof computeWorkingCapital>;
  stock: ReturnType<typeof computeStockValuation>;
  inventaires: ReturnType<typeof summarizeInventaires>[];
  inventaireLossTotal: number;
  onSelect: (k: ActiveKey) => void;
  onOpenPurchases: () => void;
  onOpenCard: (k: CardKey) => void;
}) {
  const chargesTotal = g.expensesTotal + g.salariesPaid;
  return (
    <div className="space-y-8">
      {/* Les trois chiffres que le gérant vient chercher : ce qui est entré, ce
          qui est sorti, et ce qui reste réellement dans la poche. */}
      <ResultBand
        salesTotal={g.salesTotal} cogs={g.cogs} grossMargin={g.grossMargin}
        chargesTotal={chargesTotal} destroyedValue={g.destroyedValue} lossValue={g.lossValue}
        netGain={g.netGain} salesCount={g.counts.sales}
        onOpenCard={onOpenCard}
      />

      {/* KPI cards — chaque carte est cliquable et ouvre le détail de son calcul */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OverviewCard icon={TrendingUp} tone="green" label="Ventes totales" value={money(g.salesTotal)} sub={`${g.counts.sales} opérations`} onClick={() => onOpenCard('salesTotal')} cta="Voir le détail" />
        <OverviewCard icon={ShoppingCart} tone="purple" label="Achats totaux" value={money(g.purchasesTotal)} sub={`${g.counts.purchases} factures`} onClick={onOpenPurchases} cta="Détail par carburant" />
        <OverviewCard icon={CreditCard} tone="red" label="Dépenses + salaires" value={money(chargesTotal)} onClick={() => onOpenCard('expenses')} cta="Voir le détail" />
        {/* Le coût des marchandises vendues : la part du prix de vente qui n'est
            pas un gain (les ingrédients, le prix d'achat). */}
        <OverviewCard icon={Layers} tone="amber" label="Coût marchandises" value={money(g.cogs)} sub={`Marge brute ${money(g.grossMargin)}`} onClick={() => onOpenCard('netGain')} cta="Décomposition du gain" />
        <OverviewCard icon={Boxes} tone="amber" label="Valeur du stock" value={money(g.stockValue)} sub={`${g.counts.products} produits`} onClick={() => onOpenCard('stockValue')} cta="Voir le détail" />
        <OverviewCard icon={Flame} tone="red" label="Destructions" value={money(g.destroyedValue)} sub="marchandise perdue" onClick={() => onOpenCard('destructions')} cta="Voir le détail" />
        {/* Pertes d'inventaire : la marchandise qui manquait au comptage, que
            personne n'a déclarée cassée ou périmée. C'est elle qui peut être
            retenue sur la paie des employés concernés. */}
        <OverviewCard icon={PackageX} tone="red" label="Pertes d'inventaire" value={money(inventaireLossTotal)}
          sub={`${invs.reduce((s, p) => s + p.inventaires.filter(i => !!i.comparison).length, 0)} inventaire(s) comparé(s)`}
          onClick={() => onOpenCard('pertes')} cta="Voir le détail" />
        <OverviewCard icon={Users} tone="red" label="Dettes clients" value={money(g.clientDebtTotal)} onClick={() => onOpenCard('clientDebt')} cta="Voir le détail" />
        <OverviewCard icon={Truck} tone="amber" label="Dettes fournisseurs" value={money(g.supplierDebtTotal)} onClick={() => onOpenCard('supplierDebt')} cta="Voir le détail" />
        <OverviewCard icon={AlertTriangle} tone="cyan" label="Alertes" value={`${g.stockAlerts + g.expiryAlerts}`} sub={`${g.stockAlerts} stock · ${g.expiryAlerts} exp.`} onClick={() => onOpenCard('alerts')} cta="Voir le détail" />
        {/* Ventes annulées : elles ne sont NI dans le CA NI dans les gains.
            La carte n'apparaît que s'il y en a eu sur la période. */}
        {g.counts.returns > 0 && (
          <OverviewCard icon={Undo2} tone="slate" label="Retours & échanges" value={money(g.returnsTotal)}
            sub={`${g.counts.returns} vente(s) annulée(s) · ${money(g.refundedTotal)} remboursé(s)`}
            onClick={() => onOpenCard('returns')} cta="Voir le détail" />
        )}
      </div>

      {/* Ce que la station possède vraiment : le fonds de roulement, la valeur du
          stock aux deux prix, et l'accès direct au calcul de la zakât. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><Scale className="w-5 h-5 text-[#FFB800]" /> Situation financière</h3>
          <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => onSelect('fonds')}>Fonds de roulement →</button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <OverviewCard icon={Scale} tone={wc.workingCapital >= 0 ? 'green' : 'red'} label="Fonds de roulement"
            value={money(wc.workingCapital)}
            sub={`Trésorerie ${money(wc.treasuryTotal)} + créances + stock ${money(wc.stockValue)} − dettes`}
            onClick={() => onSelect('fonds')} cta="Détail par compte" />
          <OverviewCard icon={Boxes} tone="amber" label="Stock au prix d'achat" value={money(sv.buyValue)}
            sub={`${sv.count} référence(s)`} onClick={() => onSelect('stock')} cta="Valeur du stock" />
          <OverviewCard icon={TrendingUp} tone="blue" label="Stock au prix de vente" value={money(sv.sellValue)}
            sub={`Marge latente ${money(sv.margin)}`} onClick={() => onSelect('stock')} cta="Voir le détail" />
          <OverviewCard icon={Moon} tone="purple" label="Zakât" value="Calculer"
            sub="Assiette, nisâb et taux paramétrables" onClick={() => onSelect('zakat')} cta="Ouvrir le calcul" />
        </div>
      </div>

      {/* Trésorerie — raccourci vers la section dédiée */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><PiggyBank className="w-5 h-5 text-[#FFB800]" /> Trésorerie de la station</h3>
          <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => onSelect('tresorerie')}>Tout le détail →</button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <button onClick={() => onSelect('tresorerie')} className="rounded-2xl p-5 text-white text-left" style={{ background: 'linear-gradient(135deg,#001f5c,#003087)' }}>
            <div className="flex items-center gap-2 text-blue-200"><PiggyBank className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Caisse générale</span></div>
            <p className="text-3xl font-black tabular-nums mt-1.5 text-[#FFB800]">{money(tr.caisseBalance)}</p>
          </button>
          <button onClick={() => onSelect('tresorerie')} className="rounded-2xl p-5 text-white text-left" style={{ background: 'linear-gradient(135deg,#065f46,#047857)' }}>
            <div className="flex items-center gap-2 text-emerald-100"><Landmark className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Total en banque</span></div>
            <p className="text-3xl font-black tabular-nums mt-1.5">{money(tr.bankTotal)}</p>
            <p className="text-[11px] text-emerald-100 mt-0.5">{tr.counts.accounts} compte(s)</p>
          </button>
          <button onClick={() => onSelect('tresorerie')} className="rounded-2xl p-5 text-white text-left" style={{ background: 'linear-gradient(135deg,#4c1d95,#6d28d9)' }}>
            <div className="flex items-center gap-2 text-violet-200"><Layers className="w-4 h-4" /><span className="text-[11px] font-bold uppercase tracking-wide">Flux net de la période</span></div>
            <p className="text-3xl font-black tabular-nums mt-1.5">{money(tr.net)}</p>
            <p className="text-[11px] text-violet-200 mt-0.5">+{money(tr.inflow)} · −{money(tr.outflow)} · {tr.counts.movements} opérations</p>
          </button>
        </div>
      </div>

      {/* Personnel — raccourci vers la section dédiée */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><UsersRound className="w-5 h-5 text-[#FFB800]" /> Personnel de la station</h3>
          <button className="text-[11px] font-black text-[#003087] hover:underline" onClick={() => onSelect('employes')}>Dossier de chaque employé →</button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <OverviewCard icon={UsersRound} tone="blue" label="Employés" value={String(wf.totals.workers)} sub={`${wf.totals.withAccount} compte(s) actif(s)`} />
          <OverviewCard icon={Banknote} tone="green" label="Salaires versés" value={money(wf.totals.salariesPaid)} sub={`${money(wf.totals.acomptes)} d'acomptes`} />
          <OverviewCard icon={Target} tone="purple" label="Brigades couvertes" value={String(wf.totals.brigades)} sub={`${wf.totals.liters.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} L vendus`} />
          <OverviewCard icon={Car} tone="cyan" label="Travaux lavage / réparation" value={String(wf.totals.works)} sub={`${wf.totals.sessions} sessions cafétéria`} />
        </div>
        <div className="card-glass overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className="table-head">Activité</th><th className="table-head text-right">Employés</th>
                <th className="table-head text-right">Salaires versés</th><th className="table-head text-right">Acomptes</th>
                <th className="table-head text-right">Absences</th><th className="table-head text-right">Activité</th>
                <th className="table-head text-right">Parts à régler</th>
              </tr></thead>
              <tbody>
                {wf.parts.map(p => (
                  <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => onSelect('employes')}>
                    <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
                    <td className="table-cell tabular-nums text-right font-bold">{p.count}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.salariesPaid)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-700">{money(p.acomptes)}</td>
                    <td className="table-cell tabular-nums text-right text-red-600">{money(p.absences)}</td>
                    <td className="table-cell tabular-nums text-right text-blue-700">{p.activityValue} {p.activityLabel.toLowerCase()}</td>
                    <td className={cn('table-cell tabular-nums text-right font-black', p.dueNow > 0 ? 'text-red-600' : 'text-slate-400')}>{money(p.dueNow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Comparatif par activité — le coût des marchandises est affiché à côté des
          ventes pour que le gain de chaque activité se lise de bout en bout. */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><FileBarChart className="w-5 h-5 text-[#FFB800]" /> Comparatif par activité</h3>
        <div className="card-glass overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className="table-head">Activité</th><th className="table-head text-right">Ventes</th><th className="table-head text-right">Achats</th>
                <th className="table-head text-right">Coût marchand.</th>
                <th className="table-head text-right">Dépenses</th><th className="table-head text-right">Marge brute</th>
                <th className="table-head text-right">Dettes clients</th><th className="table-head text-right">Gain net</th><th className="table-head" />
              </tr></thead>
              <tbody>
                {g.parts.map(p => (
                  <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => onSelect(p.key as ActiveKey)}>
                    <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.salesTotal)}</td>
                    <td className="table-cell tabular-nums text-right">{money(p.purchasesTotal)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-700">{money(p.cogs)}</td>
                    <td className="table-cell tabular-nums text-right text-red-600">{money(p.expensesTotal + p.salariesPaid)}</td>
                    <td className="table-cell tabular-nums text-right text-blue-700">{money(p.grossMargin)}</td>
                    <td className="table-cell tabular-nums text-right text-amber-600">{money(p.clientDebtTotal)}</td>
                    <td className={cn('table-cell tabular-nums text-right font-black', p.netGain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.netGain)}</td>
                    <td className="table-cell text-right"><ChevronRight className="w-4 h-4 text-slate-300 inline" /></td>
                  </tr>
                ))}
                <tr className="bg-blue-50/60">
                  <td className="table-cell font-black text-[#002d87]">TOTAL</td>
                  <td className="table-cell tabular-nums text-right font-black text-emerald-600">{money(g.salesTotal)}</td>
                  <td className="table-cell tabular-nums text-right font-black">{money(g.purchasesTotal)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(g.cogs)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-red-600">{money(chargesTotal)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(g.grossMargin)}</td>
                  <td className="table-cell tabular-nums text-right font-black text-amber-600">{money(g.clientDebtTotal)}</td>
                  <td className={cn('table-cell tabular-nums text-right font-black', g.netGain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(g.netGain)}</td>
                  <td className="table-cell" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 italic">Cliquez une activité pour afficher son rapport détaillé (ventes, achats, dettes, alertes, employés…).</p>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[['Produits', g.counts.products], ['Clients', g.counts.clients], ['Fournisseurs', g.counts.suppliers], ['Ventes', g.counts.sales], ['Achats', g.counts.purchases], ['Employés', g.counts.workers]].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border border-slate-100 p-3 text-center"><p className="text-2xl font-black text-[#002d87] tabular-nums">{v as number}</p><p className="text-[11px] font-bold uppercase text-slate-400">{k}</p></div>
        ))}
      </div>
    </div>
  );
}

// ─── Card drill-down — detail list of one KPI card, with per-row delete ────────
const AMOUNT_TONE: Record<string, string> = {
  green: 'text-emerald-600', red: 'text-red-600', blue: 'text-blue-700', amber: 'text-amber-600', slate: 'text-slate-700',
};

function CardDetailModal({ detail, onClose }: { detail: CardDetail | null; onClose: () => void }) {
  const [confirmRow, setConfirmRow] = useState<DetailRow | null>(null);
  // Drop any pending confirmation when the opened card changes.
  useEffect(() => { setConfirmRow(null); }, [detail]);
  if (!detail) return null;
  const Icon = detail.icon;
  const deletable = detail.rows.some(r => r.onDelete);
  return (
    <Modal open onClose={onClose} icon={Icon} size="2xl" fullHeight
      title={detail.title} subtitle={detail.subtitle || `${detail.rows.length} ligne(s)`}
      footer={<>
        <div className="mr-auto flex items-center gap-2 text-sm font-black text-[#002d87]">
          <span className="text-slate-400 font-bold text-xs uppercase tracking-wide">{detail.totalLabel}</span> {money(detail.total)}
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
      </>}>
      <div className="space-y-4">
        {detail.note && <p className="text-[11px] text-slate-400 italic px-1">{detail.note}</p>}
        {detail.rows.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
            <FileBarChart className="w-10 h-10 mx-auto mb-3 text-slate-200" />
            <p className="text-sm font-bold text-slate-400">Aucune ligne sur cette période.</p>
          </div>
        ) : (
          <Table head={<>
            <th className="table-head">Date</th>
            <th className="table-head">Libellé</th>
            <th className="table-head text-right">Montant</th>
            {deletable && <th className="table-head text-right">Action</th>}
          </>}>
            {detail.rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="table-cell whitespace-nowrap text-slate-500">{r.date ? formatDate(r.date) : '—'}</td>
                <td className="table-cell">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-700">{r.label}</span>
                    {r.badge && <Badge tone={r.badge.tone}>{r.badge.text}</Badge>}
                  </div>
                  {r.sub && <div className="text-[11px] text-slate-400">{r.sub}</div>}
                </td>
                <td className={cn('table-cell text-right tabular-nums font-black', AMOUNT_TONE[r.amountTone || 'slate'])}>{money(r.amount)}</td>
                {deletable && (
                  <td className="table-cell text-right">
                    {r.onDelete
                      ? <button onClick={() => setConfirmRow(r)} title="Supprimer"
                          className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-all"><Trash2 className="w-4 h-4" /></button>
                      : <span className="text-[10px] text-slate-300 italic pr-2">calculé</span>}
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
      </div>

      <Confirm open={!!confirmRow} title="Confirmer la suppression"
        message={confirmRow?.confirmMessage || 'Supprimer cette ligne ?'}
        onConfirm={() => { confirmRow?.onDelete?.(); setConfirmRow(null); }}
        onCancel={() => setConfirmRow(null)} />
    </Modal>
  );
}

// ─── Achats carburant — détail complet (drill-down du carte « Achats totaux ») ──
const PURCHASE_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  'Payé': 'success', 'Partiel': 'warning', 'À payer': 'danger', 'En attente livraison': 'neutral',
};
const PAY_MODE_TONE: Record<string, string> = {
  ESPECES: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  CHEQUE: 'text-blue-700 bg-blue-50 border-blue-200',
  VIREMENT: 'text-purple-700 bg-purple-50 border-purple-200',
};

/** Habillage (couleurs) d'un carburant dans le détail à l'écran. */
const FUEL_TONE: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  ESSENCE: { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: '#16a34a' },
  GASOIL:  { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: '#d97706' },
  GPL:     { text: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200', dot: '#7c3aed' },
  DIESEL:  { text: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200', dot: '#0e7490' },
  SUPER:   { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', dot: '#dc2626' },
  AUTRE:   { text: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200', dot: '#475569' },
};

/**
 * Une section de carburant dans le détail « Achats totaux » : l'entête avec ses
 * totaux, le récapitulatif des règlements par mode, puis la liste de ses achats.
 * Chaque ligne se déroule pour montrer ses règlements un par un (compte débité,
 * n° de chèque / bordereau) — l'information de paiement que le gérant recherche.
 */
function FuelTypeSection({ group: g, expanded, onToggle, onDelete }: {
  group: FuelTypeGroup;
  expanded: string | null;
  onToggle: (key: string) => void;
  onDelete: (id: string) => void;
  key?: React.Key;
}) {
  const tone = FUEL_TONE[g.type] || FUEL_TONE.AUTRE;
  return (
    <section className="rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
      {/* Entête du carburant */}
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 border-b', tone.bg, tone.border)}>
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: tone.dot }}>
            <Fuel className="w-4 h-4" />
          </span>
          <div>
            <p className={cn('font-black text-sm leading-none', tone.text)}>{g.label}</p>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide mt-0.5">
              {g.count} achat(s) · {g.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs sm:text-sm font-bold">
          <span className="text-[#002d87]">Total {money(g.total)}</span>
          <span className="text-emerald-600">Payé {money(g.paid)}</span>
          {g.rest > 0 && <span className="text-red-600">Reste {money(g.rest)}</span>}
        </div>
      </div>

      {/* Récapitulatif des règlements par mode — pour ce carburant */}
      <div className="flex flex-wrap gap-1.5 px-4 py-2.5 bg-white border-b border-slate-100">
        {Object.entries(g.paymentsByMode).map(([mode, agg]) => (
          <span key={mode} className={cn('badge border', PAY_MODE_TONE[mode] || 'text-slate-600 bg-white border-slate-200')}>
            {PAY_MODE_LABEL[mode] || mode} · {money(agg.amount)} ({agg.count})
          </span>
        ))}
        {g.rest > 0 && <span className="badge badge-danger">Dette {money(g.rest)}</span>}
        {Object.keys(g.paymentsByMode).length === 0 && g.rest <= 0 && (
          <span className="text-[11px] text-slate-400 italic">Aucun règlement enregistré.</span>
        )}
      </div>

      {/* Liste des achats de ce carburant */}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="table-head">N° achat</th>
            <th className="table-head">Date</th>
            <th className="table-head">Fournisseur</th>
            <th className="table-head">Cuve</th>
            <th className="table-head text-right">Quantité</th>
            <th className="table-head">Paiement</th>
            <th className="table-head text-right">Total</th>
            <th className="table-head text-right">Payé</th>
            <th className="table-head text-right">Reste</th>
            <th className="table-head">Statut</th>
            <th className="table-head text-right">Action</th>
          </tr></thead>
          <tbody>
            {g.slices.map((s, i) => {
              const key = `${g.type}:${s.id}`;
              const isOpen = expanded === key;
              return (
                <React.Fragment key={key}>
                  <tr className="hover:bg-slate-50 cursor-pointer border-t border-slate-100" onClick={() => onToggle(key)}>
                    <td className="table-cell font-black text-[#002d87] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <ChevronRight className={cn('w-3.5 h-3.5 text-slate-300 transition-transform', isOpen && 'rotate-90')} />
                        {s.ref}
                        {s.multiType && <span title="Achat multi-carburants — réparti au prorata de la valeur livrée" className="text-[10px] font-black text-amber-500">*</span>}
                      </span>
                    </td>
                    <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(s.date)}</td>
                    <td className="table-cell">{s.supplier}</td>
                    <td className="table-cell text-xs text-slate-500 max-w-[170px]">{s.cuves || '—'}</td>
                    <td className="table-cell text-right tabular-nums font-bold">{s.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L</td>
                    <td className="table-cell">
                      <div className="flex flex-wrap gap-1">
                        {s.payments.length === 0
                          ? <span className="badge badge-danger">Dette</span>
                          : Array.from(new Set(s.payments.map(pay => pay.mode))).map(mode => (
                            <span key={mode} className={cn('badge border', PAY_MODE_TONE[mode] || 'text-slate-600 bg-white border-slate-200')}>
                              {PAY_MODE_LABEL[mode] || mode}
                            </span>
                          ))}
                      </div>
                      {s.payments.length > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]">{payInfoOf(s)}</div>
                      )}
                    </td>
                    <td className="table-cell text-right tabular-nums font-black">{money(s.total)}</td>
                    <td className="table-cell text-right tabular-nums text-emerald-600">{money(s.paid)}</td>
                    <td className="table-cell text-right tabular-nums text-red-600">{money(s.rest)}</td>
                    <td className="table-cell"><Badge tone={PURCHASE_STATUS_TONE[s.status] || 'neutral'}>{s.status}</Badge></td>
                    <td className="table-cell text-right">
                      <button onClick={e => { e.stopPropagation(); onDelete(s.id); }} title="Supprimer cet achat"
                        className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-all"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr>
                      <td colSpan={11} className="bg-slate-50/70 px-4 py-4">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1">
                          <CreditCard className="w-3.5 h-3.5" /> Règlements & modes de paiement
                        </p>
                        {s.payments.length === 0 ? (
                          <p className="text-xs text-slate-400 italic px-1">Aucun règlement — achat enregistré en dette.</p>
                        ) : (
                          <div className="space-y-2">
                            {s.payments.map((pay, j) => (
                              <div key={j} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                                <span className={cn('badge border', PAY_MODE_TONE[pay.mode] || 'text-slate-600 bg-white border-slate-200')}>
                                  {PAY_MODE_LABEL[pay.mode] || pay.mode}
                                </span>
                                <span className="text-xs text-slate-500 flex items-center gap-1"><Wallet className="w-3 h-3" />{pay.account}</span>
                                {pay.chequeNumber && <span className="badge badge-info"><Hash className="w-3 h-3" />Chèque n° {pay.chequeNumber}</span>}
                                {pay.bordereauNumber && <span className="badge badge-neutral"><Hash className="w-3 h-3" />Bordereau n° {pay.bordereauNumber}</span>}
                                <span className="text-xs text-slate-400">{formatDate(pay.date)}</span>
                                <span className="ml-auto font-black tabular-nums text-[#002d87]">{money(pay.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {s.multiType && (
                          <p className="text-[10px] text-amber-600 italic mt-2">
                            Achat couvrant plusieurs carburants — les montants de cette section sont la part {g.label} de l'achat, répartie au prorata de la valeur livrée.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* Sous-total du carburant */}
            <tr className="bg-blue-50/60 border-t border-slate-200">
              <td className="table-cell font-black text-[#002d87]" colSpan={4}>TOTAL {g.label}</td>
              <td className="table-cell text-right tabular-nums font-black">{g.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L</td>
              <td className="table-cell" />
              <td className="table-cell text-right tabular-nums font-black text-[#002d87]">{money(g.total)}</td>
              <td className="table-cell text-right tabular-nums font-black text-emerald-600">{money(g.paid)}</td>
              <td className="table-cell text-right tabular-nums font-black text-red-600">{money(g.rest)}</td>
              <td className="table-cell" colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Drill-down of the « Achats totaux » card: the fuel purchases of the period,
 * GROUPED BY FUEL TYPE. Each carburant (Essence, Gasoil, …) is its own section
 * with its totals, its règlements-by-mode recap and the list of its achats — and
 * for each achat, the payment mode and its references. What is on screen is what
 * the printed fiche (`PurchasesFiche`) carries, section for section.
 */
function PurchasesDetailModal({ open, onClose, purchases, range, onPrint, onDelete, impactOf }: {
  open: boolean;
  onClose: () => void;
  purchases: FuelPurchaseDetail[];
  range: { from: string; to: string };
  onPrint: () => void;
  onDelete: (id: string) => void;
  /** Cuve levels the deletion of an achat would restore (confirmation dialog). */
  impactOf: (id: string) => string;
}) {
  const [toDelete, setToDelete] = useState<FuelPurchaseDetail | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => groupPurchasesByFuelType(purchases), [purchases]);
  const totals = useMemo(() => purchases.reduce(
    (a, p) => ({ total: a.total + p.total, paid: a.paid + p.paid, rest: a.rest + p.rest, liters: a.liters + p.liters }),
    { total: 0, paid: 0, rest: 0, liters: 0 },
  ), [purchases]);
  // Deleting works on the whole achat (all its cuves) — look the full purchase up
  // by id so the confirmation shows its real total and litres, even for a slice.
  const requestDelete = (id: string) => setToDelete(purchases.find(p => p.id === id) || null);

  return (
    <Modal open={open} onClose={onClose} icon={ShoppingCart} size="2xl" fullHeight
      title="Achats Carburant — par type de carburant"
      subtitle={`Du ${formatDate(range.from)} au ${formatDate(range.to)} · ${purchases.length} achat(s) · ${groups.length} carburant(s)`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-slate-400 uppercase tracking-widest">{totals.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L</span>
          <span className="text-[#002d87]">Total {money(totals.total)}</span>
          <span className="text-emerald-600">Payé {money(totals.paid)}</span>
          {totals.rest > 0 && <span className="text-red-600">Reste {money(totals.rest)}</span>}
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-primary" onClick={onPrint} disabled={purchases.length === 0}>
          <Printer className="w-4 h-4" /> Imprimer la liste
        </button>
      </>}>
      <div className="space-y-5">
        {/* Bandeau des totaux — toutes activités carburant confondues */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
          {[
            { icon: ShoppingCart, label: 'Achats', value: String(purchases.length), tone: 'from-[#003087] to-[#0044bb]' },
            { icon: Droplets, label: 'Volume acheté', value: `${totals.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L`, tone: 'from-purple-500 to-purple-600' },
            { icon: TrendingUp, label: 'Total achats', value: money(totals.total), tone: 'from-amber-500 to-yellow-500' },
            { icon: Wallet, label: 'Payé', value: money(totals.paid), tone: 'from-emerald-500 to-emerald-600' },
            { icon: CircleDollarSign, label: 'Reste (dette)', value: money(totals.rest), tone: 'from-red-500 to-red-600' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-slate-100 p-3 bg-white shadow-sm">
              <div className={cn('w-8 h-8 rounded-lg bg-gradient-to-br text-white flex items-center justify-center mb-2', s.tone)}><s.icon className="w-4 h-4" /></div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
              <p className="text-base font-black text-[#002d87] tabular-nums leading-tight">{s.value}</p>
            </div>
          ))}
        </div>

        {purchases.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
            <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-slate-200" />
            <p className="text-sm font-bold text-slate-400">Aucun achat carburant sur cette période.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-slate-400 italic px-1">
              Chaque carburant a sa propre section : son total d'achats, ses règlements par mode, et le détail de chaque achat. Cliquez une ligne pour dérouler ses règlements un par un.
            </p>
            <div className="space-y-5">
              {groups.map(g => (
                <FuelTypeSection key={g.type} group={g}
                  expanded={expanded}
                  onToggle={key => setExpanded(expanded === key ? null : key)}
                  onDelete={requestDelete} />
              ))}
            </div>
          </>
        )}
      </div>

      <Confirm open={!!toDelete} title="Supprimer l'achat"
        message={`Achat « ${toDelete?.ref || ''} » de ${money(toDelete?.total || 0)}.\n\nLes ${
          (toDelete?.liters || 0).toLocaleString('fr-FR')
        } L livrés seront RETIRÉS des cuves et les règlements annulés (l'argent revient en caisse / en banque).${
          toDelete && impactOf(toDelete.id) ? `\n\n${impactOf(toDelete.id)}` : ''
        }\n\nCette action est définitive.`}
        onConfirm={() => { if (toDelete) onDelete(toDelete.id); setToDelete(null); }}
        onCancel={() => setToDelete(null)} />
    </Modal>
  );
}
