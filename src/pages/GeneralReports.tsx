import React, { useMemo, useRef, useState } from 'react';
import {
  FileBarChart, Globe2, Fuel, ChevronRight, Printer, Calendar, TrendingUp, ShoppingCart,
  CreditCard, CircleDollarSign, Boxes, Users, Truck, AlertTriangle, CalendarClock, Store, Coffee,
  UtensilsCrossed, Wrench, UsersRound, PiggyBank, Landmark, Target, Clock, Car, Banknote, Layers,
  Droplets, Wallet, Receipt, Hash, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { ModuleKey } from '@/src/lib/bizConfig';
import { useBizAll } from '@/src/store/BizContext';
import { useAppState, CAISSE_ID } from '@/src/store/AppContext';
import { money, formatDate, Modal, Badge } from '@/src/components/biz/Kit';
import { computeModuleReport, computeCarburantReport, consolidate, within, PartReport, GlobalReport } from '@/src/lib/bizReporting';
import { computeWorkforce } from '@/src/lib/workforceReporting';
import { computeTreasuryReport } from '@/src/lib/treasuryReporting';
import ReportView from '@/src/components/biz/ReportView';
import WorkforceView from '@/src/components/biz/WorkforceView';
import TreasuryView from '@/src/components/biz/TreasuryView';
import { ModuleFiche, GlobalFiche, PurchasesFiche, PAY_MODE_LABEL, printFiche, FuelPurchaseDetail } from '@/src/components/biz/ReportFiche';

type ActiveKey = 'global' | 'carburant' | 'employes' | 'tresorerie' | ModuleKey;

const SECTIONS: { id: ActiveKey; label: string; icon: React.ElementType; hint: string }[] = [
  { id: 'global', label: 'Vue globale', icon: Globe2, hint: 'Rapport consolidé' },
  { id: 'employes', label: 'Employés & Personnel', icon: UsersRound, hint: 'Tous les employés, en détail' },
  { id: 'tresorerie', label: 'Caisse & Banques', icon: PiggyBank, hint: 'Trésorerie et journal complet' },
  { id: 'carburant', label: 'Carburant', icon: Fuel, hint: 'Rapport détaillé' },
  { id: 'cafeteria', label: 'Cafétéria', icon: Coffee, hint: 'Rapport détaillé' },
  { id: 'lavage', label: 'Lavage & Réparation', icon: Wrench, hint: 'Rapport détaillé' },
];

/** Sections that are a per-activity `PartReport` (the others have their own view). */
const PART_SECTIONS: ActiveKey[] = ['carburant', 'cafeteria', 'lavage'];

export default function GeneralReports() {
  const biz = useBizAll();
  const app = useAppState();
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

  // Detailed fuel purchases of the period — the "Achats carburant" drill-down and
  // its printable fiche. Unlike the aggregate report, each achat keeps its full
  // payment breakdown (mode, n° de chèque / bordereau, compte débité).
  const fuelPurchases = useMemo<FuelPurchaseDetail[]>(() => {
    const suppliers: any[] = app.suppliers || [];
    const tanks: any[] = app.tanks || [];
    const bankAccounts: any[] = app.bankAccounts || [];
    const acctLabel = (id?: string) =>
      !id || id === CAISSE_ID ? 'Espèces (caisse)' : (bankAccounts.find(a => a.id === id)?.name || 'Compte bancaire');
    return (app.purchases || [])
      .filter((p: any) => within(p.date, range.from, range.to))
      // Only fuel purchases (they always carry a cuve), like the Achats Carburant screen.
      .filter((p: any) => (p.items || []).some((i: any) => !!i.tankId) || !!p.tankId)
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((p: any): FuelPurchaseDetail => ({
        id: p.id,
        invoiceNumber: p.invoiceNumber,
        blNumber: p.blNumber,
        date: p.date,
        supplier: suppliers.find(s => s.id === p.supplierId)?.name || '—',
        status: p.status || '—',
        items: (p.items || []).map((i: any) => ({
          name: i.productName || tanks.find(t => t.id === i.tankId)?.name || 'Cuve',
          qty: i.quantity || 0,
          unitPrice: i.buyPrice || 0,
          total: i.total ?? (i.quantity || 0) * (i.buyPrice || 0),
        })),
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

  const activeReport: PartReport | null = PART_SECTIONS.includes(active)
    ? reports[active as 'carburant' | ModuleKey]
    : null;
  const activeInfo = SECTIONS.find(s => s.id === active)!;
  const ActiveIcon = activeInfo.icon;

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
                  {active === 'global' && <GlobalOverview global={global} workforce={workforce} treasury={treasury} onSelect={setActive} onOpenPurchases={() => setShowPurchases(true)} />}
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
  const tones: Record<string, string> = { blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600', red: 'from-red-500 to-red-600', amber: 'from-amber-500 to-yellow-500', purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-teal-600' };
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

function GlobalOverview({ global: g, workforce: wf, treasury: tr, onSelect, onOpenPurchases }: {
  global: GlobalReport;
  workforce: ReturnType<typeof computeWorkforce>;
  treasury: ReturnType<typeof computeTreasuryReport>;
  onSelect: (k: ActiveKey) => void;
  onOpenPurchases: () => void;
}) {
  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OverviewCard icon={TrendingUp} tone="green" label="Ventes totales" value={money(g.salesTotal)} sub={`${g.counts.sales} opérations`} />
        <OverviewCard icon={ShoppingCart} tone="purple" label="Achats totaux" value={money(g.purchasesTotal)} sub={`${g.counts.purchases} factures`} onClick={onOpenPurchases} cta="Détail carburant" />
        <OverviewCard icon={CreditCard} tone="red" label="Dépenses + salaires" value={money(g.expensesTotal + g.salariesPaid)} />
        <OverviewCard icon={CircleDollarSign} tone={g.netGain >= 0 ? 'green' : 'red'} label="Bénéfice net global" value={money(g.netGain)} />
        <OverviewCard icon={Boxes} tone="amber" label="Valeur du stock" value={money(g.stockValue)} sub={`${g.counts.products} produits`} />
        <OverviewCard icon={Users} tone="red" label="Dettes clients" value={money(g.clientDebtTotal)} />
        <OverviewCard icon={Truck} tone="amber" label="Dettes fournisseurs" value={money(g.supplierDebtTotal)} />
        <OverviewCard icon={AlertTriangle} tone="cyan" label="Alertes" value={`${g.stockAlerts + g.expiryAlerts}`} sub={`${g.stockAlerts} stock · ${g.expiryAlerts} exp.`} />
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

      {/* Net gain hero */}
      <div className="rounded-2xl p-6 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ background: g.netGain >= 0 ? 'linear-gradient(135deg,#065f46,#047857)' : 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide opacity-90">Gain net total — toutes activités</p>
          <p className="text-xs opacity-75 mt-1">Somme des bénéfices nets de chaque activité sur la période</p>
        </div>
        <p className="text-5xl font-black tabular-nums">{money(g.netGain)}</p>
      </div>

      {/* Comparatif par activité */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><FileBarChart className="w-5 h-5 text-[#FFB800]" /> Comparatif par activité</h3>
        <div className="card-glass overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className="table-head">Activité</th><th className="table-head text-right">Ventes</th><th className="table-head text-right">Achats</th>
                <th className="table-head text-right">Dépenses</th><th className="table-head text-right">Marge brute</th>
                <th className="table-head text-right">Dettes clients</th><th className="table-head text-right">Bénéfice net</th><th className="table-head" />
              </tr></thead>
              <tbody>
                {g.parts.map(p => (
                  <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => onSelect(p.key as ActiveKey)}>
                    <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.salesTotal)}</td>
                    <td className="table-cell tabular-nums text-right">{money(p.purchasesTotal)}</td>
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
                  <td className="table-cell tabular-nums text-right font-black text-red-600">{money(g.expensesTotal + g.salariesPaid)}</td>
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

// ─── Achats carburant — détail complet (drill-down du carte « Achats totaux ») ──
const PURCHASE_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  'Payé': 'success', 'Partiel': 'warning', 'À payer': 'danger', 'En attente livraison': 'neutral',
};
const PAY_MODE_TONE: Record<string, string> = {
  ESPECES: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  CHEQUE: 'text-blue-700 bg-blue-50 border-blue-200',
  VIREMENT: 'text-purple-700 bg-purple-50 border-purple-200',
};

function PurchasesDetailModal({ open, onClose, purchases, range, onPrint }: {
  open: boolean;
  onClose: () => void;
  purchases: FuelPurchaseDetail[];
  range: { from: string; to: string };
  onPrint: () => void;
}) {
  const totals = useMemo(() => purchases.reduce(
    (a, p) => ({ total: a.total + p.total, paid: a.paid + p.paid, rest: a.rest + p.rest, liters: a.liters + p.liters }),
    { total: 0, paid: 0, rest: 0, liters: 0 },
  ), [purchases]);

  return (
    <Modal open={open} onClose={onClose} icon={ShoppingCart} size="2xl" fullHeight
      title="Achats Carburant — détail complet"
      subtitle={`Du ${formatDate(range.from)} au ${formatDate(range.to)} · ${purchases.length} achat(s)`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-[#002d87]">Total {money(totals.total)}</span>
          <span className="text-emerald-600">Payé {money(totals.paid)}</span>
          {totals.rest > 0 && <span className="text-red-600">Reste {money(totals.rest)}</span>}
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-primary" onClick={onPrint} disabled={purchases.length === 0}>
          <Printer className="w-4 h-4" /> Imprimer la fiche
        </button>
      </>}>
      <div className="space-y-5">
        {/* Summary strip */}
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
          <div className="space-y-4">
            {purchases.map(p => (
              <div key={p.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
                  <div className="min-w-0">
                    <h4 className="font-black text-slate-800 flex items-center gap-2 truncate">
                      <Receipt className="w-4 h-4 text-[#003087] shrink-0" />
                      {p.invoiceNumber || p.blNumber || 'Sans référence'}
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                      <Truck className="w-3 h-3" /> {p.supplier} · {formatDate(p.date)}
                    </p>
                  </div>
                  <Badge tone={PURCHASE_STATUS_TONE[p.status] || 'neutral'}>{p.status}</Badge>
                </div>

                <div className="p-4 space-y-4">
                  {/* Chips */}
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {p.invoiceNumber && <span className="badge badge-neutral"><Hash className="w-3 h-3" />Facture {p.invoiceNumber}</span>}
                    {p.blNumber && <span className="badge badge-neutral">BL {p.blNumber}</span>}
                    <span className="badge badge-info"><Droplets className="w-3 h-3" />{p.liters.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L</span>
                  </div>

                  {/* Totals */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-slate-50 p-2.5 text-center">
                      <p className="text-[9px] uppercase font-black text-slate-400">Total</p>
                      <p className="font-black text-slate-700 tabular-nums text-sm">{money(p.total)}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-2.5 text-center">
                      <p className="text-[9px] uppercase font-black text-slate-400">Payé</p>
                      <p className="font-black text-emerald-600 tabular-nums text-sm">{money(p.paid)}</p>
                    </div>
                    <div className="rounded-xl bg-red-50 p-2.5 text-center">
                      <p className="text-[9px] uppercase font-black text-slate-400">Reste</p>
                      <p className="font-black text-red-600 tabular-nums text-sm">{money(p.rest)}</p>
                    </div>
                  </div>

                  {/* Cuves livrées */}
                  {p.items.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1"><Droplets className="w-3.5 h-3.5" /> Cuves livrées</p>
                      <div className="overflow-x-auto custom-scrollbar rounded-xl border border-slate-100">
                        <table className="w-full border-collapse text-sm">
                          <thead><tr className="bg-slate-50">
                            <th className="text-left px-3 py-2 text-[10px] font-black uppercase text-slate-400">Cuve / Produit</th>
                            <th className="text-right px-3 py-2 text-[10px] font-black uppercase text-slate-400">Quantité</th>
                            <th className="text-right px-3 py-2 text-[10px] font-black uppercase text-slate-400">Prix / L</th>
                            <th className="text-right px-3 py-2 text-[10px] font-black uppercase text-slate-400">Total</th>
                          </tr></thead>
                          <tbody>
                            {p.items.map((it, i) => (
                              <tr key={i} className="border-t border-slate-100">
                                <td className="px-3 py-2 font-bold text-slate-700">{it.name}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{it.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L</td>
                                <td className="px-3 py-2 text-right tabular-nums text-amber-700">{money(it.unitPrice)}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-700">{money(it.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Règlements — mode de paiement + n° chèque / bordereau */}
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> Règlements & modes de paiement</p>
                    {p.payments.length === 0 ? (
                      <p className="text-xs text-slate-400 italic px-1">Aucun règlement — achat enregistré en dette.</p>
                    ) : (
                      <div className="space-y-2">
                        {p.payments.map((pay, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
