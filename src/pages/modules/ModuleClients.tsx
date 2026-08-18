import React, { useMemo, useState, useCallback } from 'react';
import {
  Users, Plus, Phone, MapPin, History, TrendingUp, CircleDollarSign,
  FileBarChart, Search, Wallet, Receipt, ChevronDown, ChevronRight, Printer,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ModuleKey, MODULES, BizContact } from '@/src/lib/bizConfig';
import { matchesSearch, cn } from '@/src/lib/utils';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Edit2, Trash2, Confirm, Modal, money, formatDate,
} from '@/src/components/biz/Kit';
import { printFiche } from '@/src/components/biz/ReportFiche';
import { ClientStatementFiche } from '@/src/components/biz/ClientStatementFiche';
import ClientReportModal from '@/src/components/biz/ClientReportModal';
import { bizClientStatement, KIND_COLOR, StatementKind } from '@/src/lib/clientStatement';
import { ContactModal } from './_shared';

/** Les natures affichables du journal, pour la barre de filtres. */
const HISTORY_FILTERS: { id: 'all' | StatementKind; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'vente', label: 'Ventes' },
  { id: 'intervention', label: 'Interventions' },
  { id: 'reglement', label: 'Règlements' },
  { id: 'retour', label: 'Retours' },
];

const shortDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

export default function ModuleClients({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'clients');
  const { settings } = useAppState();
  const { clients } = biz.state;

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizContact | null>(null);
  const [history, setHistory] = useState<BizContact | null>(null);
  const [report, setReport] = useState<BizContact | null>(null);
  const [toDelete, setToDelete] = useState<BizContact | null>(null);

  const filtered = clients.filter((c: BizContact) => matchesSearch(search, c.name, c.phone));

  /**
   * Le compte COMPLET de chaque client — toutes ses ventes et toutes ses
   * interventions, depuis toujours. Les bornes de période sont laissées vides :
   * l'écran d'historique montre la vie entière du compte, et c'est le rapport
   * imprimable qui, seul, se restreint à une période.
   */
  const statements = useMemo(() => {
    const out: Record<string, ReturnType<typeof bizClientStatement>> = {};
    for (const c of clients) out[c.id] = bizClientStatement(biz.state, c, cfg.label);
    return out;
  }, [biz.state, clients, cfg.label]);

  const del = () => {
    if (toDelete) { biz.remove('clients', toDelete.id); toast.success('Client supprimé'); setToDelete(null); }
  };
  const totalDebt = clients.reduce((s, c) => s + (statements[c.id]?.closingDebt || 0), 0);
  const totalOps = clients.reduce((s, c) => s + (statements[c.id]?.allLines.length || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Users} title="Clients" subtitle={`${cfg.label} — base clients`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Nouveau client</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Clients" value={clients.length} tone="blue" />
        <StatCard icon={TrendingUp} label="Total transactions" value={totalOps} tone="green" />
        <StatCard icon={CircleDollarSign} label="Dettes clients" value={money(totalDebt)} tone="red" />
      </div>

      <div className="card-glass p-4"><SearchInput value={search} onChange={setSearch} placeholder="Nom ou téléphone…" /></div>

      {filtered.length === 0 ? <EmptyState icon={Users} title="Aucun client" action={perm.creer ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Nouveau client</button> : undefined} /> : (
        <CardGrid>
          {filtered.map(c => {
            const st = statements[c.id];
            return (
              <GlassCard key={c.id}>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#003087] to-[#0044bb] text-white flex items-center justify-center font-black">{c.name.charAt(0)}</div>
                  <div className="min-w-0"><h3 className="font-black text-slate-800 truncate">{c.name}</h3>
                    {c.phone && <p className="text-xs text-slate-400 flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</p>}</div>
                </div>
                {c.address && <p className="text-xs text-slate-400 flex items-center gap-1 mt-2"><MapPin className="w-3 h-3" />{c.address}</p>}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Achats</p><p className="font-black text-slate-700 tabular-nums text-sm">{st?.totals.documents || 0}</p></div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-emerald-600 tabular-nums text-xs">{money(st?.totals.charged || 0)}</p></div>
                  <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-xs">{money(st?.closingDebt || 0)}</p></div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-1">
                    <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setHistory(c)}><History className="w-4 h-4" /> Historique</button>
                    <button className="btn-ghost !px-2 !py-1.5 text-xs" title="Générer un rapport sur une période"
                      onClick={() => setReport(c)}><FileBarChart className="w-4 h-4" /> Rapport</button>
                  </div>
                  <RowActions>
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(c); setShowForm(true); }} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(c)} />}
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      )}

      <ContactModal biz={biz} coll="clients" open={showForm} onClose={() => setShowForm(false)} initial={editing} />

      {history && (
        <ClientHistoryModal
          client={history} moduleKey={moduleKey} partLabel={cfg.label}
          settings={settings} onClose={() => setHistory(null)}
          onReport={() => { setReport(history); setHistory(null); }}
        />
      )}

      {report && (
        <BizClientReport
          client={report} moduleKey={moduleKey} partLabel={cfg.label}
          settings={settings} onClose={() => setReport(null)} />
      )}

      <Confirm open={!!toDelete} title="Supprimer le client" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Historique complet d'un client ───────────────────────────────────────────
/**
 * TOUT le compte du client, depuis sa première opération.
 *
 * L'ancien écran ne listait que la référence, la date et trois montants — sans
 * le détail des articles, sans les règlements et sans jamais dire de quelle
 * période il parlait. Ici le journal est explicitement complet, chaque ligne se
 * déplie sur son détail, et les règlements ont leur propre tableau.
 */
function ClientHistoryModal({
  client, moduleKey, partLabel, settings, onClose, onReport,
}: {
  client: BizContact; moduleKey: ModuleKey; partLabel: string;
  settings: any; onClose: () => void; onReport: () => void;
}) {
  const biz = useBiz(moduleKey);
  const [filter, setFilter] = useState<'all' | StatementKind>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const ficheRef = React.useRef<HTMLDivElement>(null);

  // Aucune borne : l'historique d'un client, c'est son compte entier.
  const st = useMemo(
    () => bizClientStatement(biz.state, client, partLabel),
    [biz.state, client, partLabel]);

  const lines = useMemo(() => st.lines.filter(l => {
    if (filter !== 'all' && l.kind !== filter) return false;
    return matchesSearch(query, l.label, l.ref, l.kindLabel, l.status, l.notes);
  }), [st.lines, filter, query]);

  return (
    <Modal open onClose={onClose} icon={History} size="3xl" fullHeight zClass="z-[90]"
      title={`Historique — ${client.name}`}
      subtitle={`${partLabel} · ${st.allLines.length} opération(s) depuis l'ouverture du compte`}
      footer={<>
        <div className="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm font-bold">
          <span className="text-[#002d87]">Total {money(st.totals.charged)}</span>
          <span className="text-emerald-600">Payé {money(st.totals.paid)}</span>
          <span className="text-red-600">Reste {money(st.closingDebt)}</span>
        </div>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-ghost" onClick={() => printFiche(ficheRef.current)}>
          <Printer className="w-4 h-4" /> Imprimer tout
        </button>
        <button className="btn-primary" onClick={onReport}>
          <FileBarChart className="w-4 h-4" /> Générer un rapport
        </button>
      </>}>

      <div className="space-y-5">
        {/* Soldes du compte */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3.5">
            <p className="text-[10px] uppercase font-bold text-slate-400">Total consommé</p>
            <p className="font-black text-[#002d87] tabular-nums text-lg">{money(st.totals.charged)}</p>
            <p className="text-[11px] text-slate-400 font-medium">{st.totals.documents} document(s)</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3.5">
            <p className="text-[10px] uppercase font-bold text-slate-400">Total payé</p>
            <p className="font-black text-emerald-600 tabular-nums text-lg">{money(st.totals.paid)}</p>
            <p className="text-[11px] text-slate-400 font-medium">{st.payments.length} règlement(s)</p>
          </div>
          <div className="rounded-2xl bg-red-50 border border-red-100 p-3.5">
            <p className="text-[10px] uppercase font-bold text-slate-400">Reste dû</p>
            <p className="font-black text-red-600 tabular-nums text-lg">{money(st.closingDebt)}</p>
            <p className="text-[11px] text-slate-400 font-medium">sur l'ensemble du compte</p>
          </div>
          <div className="rounded-2xl bg-blue-50 border border-blue-100 p-3.5">
            <p className="text-[10px] uppercase font-bold text-slate-400">Première opération</p>
            <p className="font-black text-[#002d87] tabular-nums text-lg">
              {st.allLines.length ? shortDate(st.allLines[st.allLines.length - 1].date) : '—'}
            </p>
            <p className="text-[11px] text-slate-400 font-medium">
              dernière {st.allLines.length ? shortDate(st.allLines[0].date) : '—'}
            </p>
          </div>
        </div>

        {/* Filtres */}
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="relative flex-1 md:max-w-xs">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrer le journal…"
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-xs font-bold outline-none text-[#002d87]" />
          </div>
          <div className="flex bg-slate-100 rounded-xl p-1 shrink-0 flex-wrap">
            {HISTORY_FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={cn('px-3.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap',
                  filter === f.id ? 'bg-white text-[#002d87] shadow-sm' : 'text-slate-400 hover:text-slate-600')}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Journal — chaque ligne se déplie sur ses articles. */}
        <section className="rounded-2xl border border-slate-200 overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
            <Receipt className="w-4 h-4 text-[#002d87]" />
            <h4 className="text-[11px] font-black uppercase tracking-wider text-[#002d87]">
              Journal des opérations ({lines.length})
            </h4>
          </header>
          {lines.length === 0 ? (
            <p className="p-10 text-center text-slate-400 text-sm font-semibold">Aucune opération</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2.5 w-8" />
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Nature</th>
                    <th className="px-3 py-2.5">Réf</th>
                    <th className="px-3 py-2.5">Désignation</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-right">Payé</th>
                    <th className="px-3 py-2.5 text-right">Reste</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map(l => {
                    const hasDetail = (l.items || []).length > 0;
                    const isOpen = !!open[l.id];
                    return (
                      <React.Fragment key={l.id}>
                        <tr className={cn('hover:bg-slate-50', hasDetail && 'cursor-pointer')}
                          onClick={() => hasDetail && setOpen(o => ({ ...o, [l.id]: !o[l.id] }))}>
                          <td className="px-3 py-2.5 text-slate-300">
                            {hasDetail && (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(l.date)}</td>
                          <td className="px-3 py-2.5 font-black whitespace-nowrap" style={{ color: KIND_COLOR[l.kind] }}>{l.kindLabel}</td>
                          <td className="px-3 py-2.5 text-slate-400 font-bold">{l.ref || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-600 max-w-[280px]">
                            <span className="block truncate font-semibold" title={l.label}>{l.label}</span>
                            {(l.qtyLabel || l.status) && (
                              <span className="block text-[10px] text-slate-400 font-bold">
                                {[l.qtyLabel, l.status].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold">{money(l.charged)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold text-emerald-600">{money(l.paid)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-black text-red-600">{money(l.rest)}</td>
                        </tr>
                        {hasDetail && isOpen && (
                          <tr className="bg-slate-50/70">
                            <td />
                            <td colSpan={7} className="px-3 pb-3">
                              <table className="w-full text-[11px]">
                                <thead>
                                  <tr className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                                    <th className="py-1.5 text-left">Désignation</th>
                                    <th className="py-1.5 text-right">Quantité</th>
                                    <th className="py-1.5 text-right">P.U.</th>
                                    <th className="py-1.5 text-right">Montant</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(l.items || []).map((it, i) => (
                                    <tr key={i} className="border-t border-slate-200/70">
                                      <td className="py-1.5 font-semibold text-slate-600">{it.name}</td>
                                      <td className="py-1.5 text-right tabular-nums text-slate-500">
                                        {it.qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}{it.unit ? ` ${it.unit}` : ''}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums text-slate-500">{money(it.unitPrice)}</td>
                                      <td className="py-1.5 text-right tabular-nums font-bold text-slate-700">{money(it.total)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr className="text-[#002d87] font-black">
                    <td colSpan={5} className="px-3 py-3 uppercase text-[10px] tracking-widest">Total du compte</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(st.totals.charged)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-600">{money(st.totals.paid)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-red-600">{money(st.totals.rest)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Règlements */}
        <section className="rounded-2xl border border-slate-200 overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
            <Wallet className="w-4 h-4 text-emerald-600" />
            <h4 className="text-[11px] font-black uppercase tracking-wider text-[#002d87]">
              Règlements encaissés ({st.payments.length})
            </h4>
          </header>
          {st.payments.length === 0 ? (
            <p className="p-10 text-center text-slate-400 text-sm font-semibold">Aucun règlement enregistré</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Libellé</th>
                    <th className="px-3 py-2.5">Mode</th>
                    <th className="px-3 py-2.5">Référence</th>
                    <th className="px-3 py-2.5 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {st.payments.map(p => (
                    <tr key={p.id} className="hover:bg-emerald-50/40">
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="px-3 py-2.5 text-slate-600 font-semibold">{p.label || 'Règlement'}</td>
                      <td className="px-3 py-2.5 font-black text-emerald-700">{p.mode}</td>
                      <td className="px-3 py-2.5 text-slate-400 font-bold">
                        {p.reference || '—'}
                        {p.inferred && <span className="text-amber-600"> (date du document)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-black text-emerald-600">{money(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr className="text-[#002d87] font-black">
                    <td colSpan={4} className="px-3 py-3 uppercase text-[10px] tracking-widest">Total encaissé</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-600">{money(st.totals.paid)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Le relevé complet, prêt à imprimer sans passer par le rapport. */}
      <ClientStatementFiche ref={ficheRef} statement={st} settings={settings} />
    </Modal>
  );
}

// ─── Rapport de période ───────────────────────────────────────────────────────
function BizClientReport({
  client, moduleKey, partLabel, settings, onClose,
}: {
  client: BizContact; moduleKey: ModuleKey; partLabel: string; settings: any; onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const state = biz.state;
  const build = useCallback(
    (from: string, to: string) => bizClientStatement(state, client, partLabel, from, to),
    [state, client, partLabel]);

  return (
    <ClientReportModal open onClose={onClose} build={build} settings={settings}
      clientName={client.name} partLabel={partLabel} />
  );
}
