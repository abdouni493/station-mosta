import React, { useMemo, useRef, useState } from 'react';
import { BarChart3, FileText, Printer, Calendar } from 'lucide-react';
import { ModuleKey, MODULES } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useAppState } from '@/src/store/AppContext';
import { PageHeader, formatDate } from '@/src/components/biz/Kit';
import { computeModuleReport } from '@/src/lib/bizReporting';
import ReportView from '@/src/components/biz/ReportView';
import { ModuleFiche, printFiche } from '@/src/components/biz/ReportFiche';

export default function ModuleReports({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const { settings } = useAppState();
  const st = biz.state;
  const ficheRef = useRef<HTMLDivElement>(null);

  const firstDay = new Date(); firstDay.setDate(1);
  const [from, setFrom] = useState(firstDay.toISOString().split('T')[0]);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);
  const [range, setRange] = useState({ from, to });

  const report = useMemo(() => computeModuleReport(st, moduleKey, range.from, range.to), [st, moduleKey, range]);

  const generate = () => setRange({ from, to });

  return (
    <div className="space-y-6 animate-fade-in max-w-[1600px] mx-auto pb-16">
      <PageHeader icon={BarChart3} title="Rapports" subtitle={`${cfg.label} — bilan détaillé par période`}
        actions={<button className="btn-primary" onClick={() => printFiche(ficheRef.current)}><Printer className="w-4 h-4" /> Imprimer la fiche</button>} />

      {/* Date range */}
      <div className="card-glass p-4 flex flex-wrap items-end gap-3">
        <div><label className="label-field">Date début</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input-field !w-auto" /></div>
        <div><label className="label-field">Date fin</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className="input-field !w-auto" /></div>
        <button className="btn-secondary" onClick={generate}><FileText className="w-4 h-4" /> Générer le rapport</button>
        <span className="ml-auto text-xs text-slate-400 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Période: {formatDate(range.from)} → {formatDate(range.to)}</span>
      </div>

      <ReportView report={report} />

      {/* Off-screen printable fiche */}
      <ModuleFiche ref={ficheRef} report={report} settings={settings} />
    </div>
  );
}
