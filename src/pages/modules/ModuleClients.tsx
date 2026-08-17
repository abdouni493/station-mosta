import React, { useMemo, useState } from 'react';
import { Users, Plus, Phone, MapPin, History, Wallet, TrendingUp, CircleDollarSign } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ModuleKey, MODULES, BizContact } from '@/src/lib/bizConfig';
import { matchesSearch } from '@/src/lib/utils';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, CardGrid, GlassCard, EmptyState, Table,
  RowActions, ActionBtn, Edit2, Trash2, Confirm, Modal, money, formatDate,
} from '@/src/components/biz/Kit';
import { ContactModal } from './_shared';

export default function ModuleClients({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'clients');
  const { clients, sales, reparations } = biz.state;

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizContact | null>(null);
  const [history, setHistory] = useState<BizContact | null>(null);
  const [toDelete, setToDelete] = useState<BizContact | null>(null);

  const filtered = clients.filter((c: BizContact) => matchesSearch(search, c.name, c.phone));

  const clientStats = (id: string) => {
    const cs = sales.filter(s => s.clientId === id);
    const rs = reparations.filter(r => r.clientId === id);
    const total = cs.reduce((s, x) => s + x.total, 0) + rs.reduce((s, x) => s + x.total, 0);
    const paid = cs.reduce((s, x) => s + x.paid, 0) + rs.reduce((s, x) => s + x.paid, 0);
    return { count: cs.length + rs.length, total, paid, rest: total - paid, sales: cs, reps: rs };
  };

  const del = () => { if (toDelete) { biz.remove('clients', toDelete.id); toast.success('Client supprimé'); setToDelete(null); } };
  const totalDebt = clients.reduce((s, c) => s + clientStats(c.id).rest, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Users} title="Clients" subtitle={`${cfg.label} — base clients`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Nouveau client</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Clients" value={clients.length} tone="blue" />
        <StatCard icon={TrendingUp} label="Total transactions" value={sales.length + reparations.filter(r => r.clientId).length} tone="green" />
        <StatCard icon={CircleDollarSign} label="Dettes clients" value={money(totalDebt)} tone="red" />
      </div>

      <div className="card-glass p-4"><SearchInput value={search} onChange={setSearch} placeholder="Nom ou téléphone…" /></div>

      {filtered.length === 0 ? <EmptyState icon={Users} title="Aucun client" action={perm.creer ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Nouveau client</button> : undefined} /> : (
        <CardGrid>
          {filtered.map(c => {
            const st = clientStats(c.id);
            return (
              <GlassCard key={c.id}>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#003087] to-[#0044bb] text-white flex items-center justify-center font-black">{c.name.charAt(0)}</div>
                  <div className="min-w-0"><h3 className="font-black text-slate-800 truncate">{c.name}</h3>
                    {c.phone && <p className="text-xs text-slate-400 flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</p>}</div>
                </div>
                {c.address && <p className="text-xs text-slate-400 flex items-center gap-1 mt-2"><MapPin className="w-3 h-3" />{c.address}</p>}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Achats</p><p className="font-black text-slate-700 tabular-nums text-sm">{st.count}</p></div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-emerald-600 tabular-nums text-xs">{money(st.total)}</p></div>
                  <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-xs">{money(st.rest)}</p></div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setHistory(c)}><History className="w-4 h-4" /> Historique</button>
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

      <Modal open={!!history} onClose={() => setHistory(null)} icon={History} size="lg" title={`Historique — ${history?.name || ''}`} subtitle="Achats & règlements">
        {history && (() => {
          const st = clientStats(history.id);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total achats</p><p className="font-black text-slate-700 tabular-nums">{money(st.total)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total payé</p><p className="font-black text-emerald-600 tabular-nums">{money(st.paid)}</p></div>
                <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total reste</p><p className="font-black text-red-600 tabular-nums">{money(st.rest)}</p></div>
              </div>
              {st.count === 0 ? <p className="text-center text-slate-400 text-sm py-6">Aucune transaction</p> : (
                <Table head={<><th className="table-head">Réf</th><th className="table-head">Date</th><th className="table-head">Total</th><th className="table-head">Payé</th><th className="table-head">Reste</th></>}>
                  {[...st.sales.map(s => ({ ref: s.ref, date: s.date, total: s.total, paid: s.paid, rest: s.rest })),
                    ...st.reps.map(r => ({ ref: r.ref, date: r.date, total: r.total, paid: r.paid, rest: r.rest }))]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((t, i) => <tr key={i}><td className="table-cell font-bold">{t.ref}</td><td className="table-cell">{formatDate(t.date)}</td>
                      <td className="table-cell tabular-nums">{money(t.total)}</td><td className="table-cell tabular-nums text-emerald-600">{money(t.paid)}</td><td className="table-cell tabular-nums text-red-600">{money(t.rest)}</td></tr>)}
                </Table>
              )}
            </div>
          );
        })()}
      </Modal>

      <Confirm open={!!toDelete} title="Supprimer le client" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}
