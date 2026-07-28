import React, { useMemo, useRef, useState } from 'react';
import {
  FileBarChart, Globe2, Fuel, ChevronRight, Printer, Calendar, TrendingUp, ShoppingCart,
  CreditCard, CircleDollarSign, Boxes, Users, Truck, AlertTriangle, CalendarClock, Store, Coffee, UtensilsCrossed, Wrench,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { ModuleKey } from '@/src/lib/bizConfig';
import { useBizAll } from '@/src/store/BizContext';
import { useAppState } from '@/src/store/AppContext';
import { money, formatDate } from '@/src/components/biz/Kit';
import { computeModuleReport, computeCarburantReport, consolidate, PartReport, GlobalReport } from '@/src/lib/bizReporting';
import ReportView from '@/src/components/biz/ReportView';
import { ModuleFiche, GlobalFiche, printFiche } from '@/src/components/biz/ReportFiche';

type ActiveKey = 'global' | 'carburant' | ModuleKey;

const SECTIONS: { id: ActiveKey; label: string; icon: React.ElementType }[] = [
  { id: 'global', label: 'Vue globale', icon: Globe2 },
  { id: 'carburant', label: 'Carburant', icon: Fuel },
  { id: 'cafeteria', label: 'Cafétéria', icon: Coffee },
  { id: 'lavage', label: 'Lavage & Réparation', icon: Wrench },
];

export default function GeneralReports() {
  const biz = useBizAll();
  const app = useAppState();
  const settings = app.settings;
  const globalFicheRef = useRef<HTMLDivElement>(null);
  const moduleFicheRef = useRef<HTMLDivElement>(null);

  const firstDay = new Date(); firstDay.setDate(1);
  const [from, setFrom] = useState(firstDay.toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [range, setRange] = useState({ from, to });
  const [active, setActive] = useState<ActiveKey>('global');

  const reports = useMemo(() => ({
    carburant: computeCarburantReport(app, range.from, range.to),
    cafeteria: computeModuleReport(biz.cafeteria, 'cafeteria', range.from, range.to),
    lavage: computeModuleReport(biz.lavage, 'lavage', range.from, range.to),
  }), [biz, app, range]);

  const global: GlobalReport = useMemo(
    () => consolidate([reports.carburant, reports.cafeteria, reports.lavage], range.from, range.to),
    [reports, range],
  );

  const activeReport: PartReport | null = active === 'global' ? null : reports[active];
  const activeInfo = SECTIONS.find(s => s.id === active)!;
  const ActiveIcon = activeInfo.icon;

  const generate = () => setRange({ from, to });
  const handlePrint = () => printFiche(active === 'global' ? globalFicheRef.current : moduleFicheRef.current);

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-blue-900 uppercase italic tracking-tighter leading-none">Rapports Généraux</h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">Bilan consolidé et détaillé de toutes les activités : carburant, cafétéria et lavage & réparation.</p>
        </div>
        <button onClick={handlePrint} className="btn-primary h-14 px-10 text-[11px] uppercase tracking-[0.25em] italic font-black flex items-center gap-3 shrink-0">
          <Printer className="w-4 h-4" /> Imprimer {active === 'global' ? 'la fiche globale' : 'la fiche'}
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
                const rep = s.id === 'global' ? null : reports[s.id];
                return (
                  <button key={s.id} onClick={() => setActive(s.id)} className={cn('sidebar-link w-full', isActive ? 'sidebar-link-active' : 'sidebar-link-inactive')}>
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', isActive ? 'bg-[#001f5c]/20' : 'bg-white/6')}><Icon className={cn('w-3.5 h-3.5', isActive ? 'text-[#001f5c]' : 'text-blue-200')} /></div>
                    <span className="text-sm leading-none flex-1 text-left">{s.label}</span>
                    {rep ? <span className={cn('text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded', rep.netGain >= 0 ? 'text-emerald-300' : 'text-red-300')}>{money(rep.netGain).replace(' DA', '')}</span> : null}
                    {isActive && <ChevronRight className="w-3 h-3 text-[#001f5c]/50 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {/* Total gain footer */}
            <div className="px-5 py-4 border-t border-white/10" style={{ background: 'rgba(0,0,0,0.15)' }}>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Gain net total</p>
              <p className={cn('text-2xl font-black tabular-nums leading-tight', global.netGain >= 0 ? 'text-emerald-400' : 'text-red-400')}>{money(global.netGain)}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden flex flex-col min-h-[700px]" style={{ boxShadow: 'var(--shadow-xl)' }}>
            <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white px-8 py-5 flex items-center gap-4 shrink-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,184,0,0.2)', border: '1px solid rgba(255,184,0,0.3)' }}><ActiveIcon className="w-4 h-4 text-yellow-400" /></div>
              <div><h2 className="font-black text-sm uppercase tracking-widest italic leading-none">{activeInfo.label}</h2><p className="text-[10px] text-blue-200 mt-0.5 font-bold">{active === 'global' ? 'Rapport consolidé' : 'Rapport détaillé'}</p></div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar">
              <AnimatePresence mode="wait">
                <motion.div key={active} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {active === 'global'
                    ? <GlobalOverview global={global} onSelect={setActive} />
                    : activeReport && <ReportView report={activeReport} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Off-screen printable fiches */}
      <GlobalFiche ref={globalFicheRef} global={global} settings={settings} />
      {activeReport && <ModuleFiche ref={moduleFicheRef} report={activeReport} settings={settings} />}
    </div>
  );
}

// ─── Global overview ─────────────────────────────────────────────────────────
function OverviewCard({ icon: Icon, label, value, sub, tone = 'blue' }: { icon: React.ElementType; label: string; value: string; sub?: string; tone?: string; key?: React.Key }) {
  const tones: Record<string, string> = { blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600', red: 'from-red-500 to-red-600', amber: 'from-amber-500 to-yellow-500', purple: 'from-purple-500 to-purple-600', cyan: 'from-cyan-500 to-teal-600' };
  return (
    <div className="rounded-2xl border border-slate-100 p-4 bg-white shadow-sm">
      <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br text-white flex items-center justify-center mb-2', tones[tone])}><Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} /></div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
    </div>
  );
}

function GlobalOverview({ global: g, onSelect }: { global: GlobalReport; onSelect: (k: ActiveKey) => void }) {
  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OverviewCard icon={TrendingUp} tone="green" label="Ventes totales" value={money(g.salesTotal)} sub={`${g.counts.sales} opérations`} />
        <OverviewCard icon={ShoppingCart} tone="purple" label="Achats totaux" value={money(g.purchasesTotal)} sub={`${g.counts.purchases} factures`} />
        <OverviewCard icon={CreditCard} tone="red" label="Dépenses + salaires" value={money(g.expensesTotal + g.salariesPaid)} />
        <OverviewCard icon={CircleDollarSign} tone={g.netGain >= 0 ? 'green' : 'red'} label="Bénéfice net global" value={money(g.netGain)} />
        <OverviewCard icon={Boxes} tone="amber" label="Valeur du stock" value={money(g.stockValue)} sub={`${g.counts.products} produits`} />
        <OverviewCard icon={Users} tone="red" label="Dettes clients" value={money(g.clientDebtTotal)} />
        <OverviewCard icon={Truck} tone="amber" label="Dettes fournisseurs" value={money(g.supplierDebtTotal)} />
        <OverviewCard icon={AlertTriangle} tone="cyan" label="Alertes" value={`${g.stockAlerts + g.expiryAlerts}`} sub={`${g.stockAlerts} stock · ${g.expiryAlerts} exp.`} />
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
