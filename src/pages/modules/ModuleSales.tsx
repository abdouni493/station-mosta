import React, { useMemo, useState } from 'react';
import { Receipt, Wallet, TrendingUp, CircleDollarSign, User, ShoppingBag } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ModuleKey, MODULES, BizSale } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import { useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Eye, Edit2, Trash2, Confirm, Modal, Field, Input, Select, money, formatDate,
  PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { PayDebtModal, printInvoice } from './_shared';

export default function ModuleSales({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'sales');
  const { settings } = useAppState();
  const { sales, clients } = biz.state;

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [viewing, setViewing] = useState<BizSale | null>(null);
  const [editing, setEditing] = useState<BizSale | null>(null);
  const [paying, setPaying] = useState<BizSale | null>(null);
  const [toDelete, setToDelete] = useState<BizSale | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...sales].filter(s => {
      const client = clients.find(c => c.id === s.clientId);
      const matchQ = !q || s.clientName.toLowerCase().includes(q) || (client?.phone || '').includes(q) || s.ref.toLowerCase().includes(q);
      return matchQ && inPeriod(s.date, period, from, to);
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, clients, search, period, from, to]);

  const stats = useMemo(() => ({
    count: sales.length,
    total: sales.reduce((s, x) => s + x.total, 0),
    paid: sales.reduce((s, x) => s + x.paid, 0),
    rest: sales.reduce((s, x) => s + x.rest, 0),
  }), [sales]);

  const del = () => { if (toDelete) { biz.remove('sales', toDelete.id); toast.success('Vente supprimée'); setToDelete(null); } };
  const onPay = (amount: number) => {
    if (!paying) return;
    const paid = Math.min(paying.total, paying.paid + amount);
    biz.update('sales', { ...paying, paid, rest: Math.max(0, paying.total - paid), status: paying.total - paid > 0 ? 'crédit' : 'payée' });
    toast.success('Paiement enregistré'); setPaying(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Receipt} title="Ventes" subtitle={`${cfg.label} — factures de vente`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ShoppingBag} label="Ventes" value={stats.count} tone="blue" />
        <StatCard icon={TrendingUp} label="Chiffre d'affaires" value={money(stats.total)} tone="green" />
        <StatCard icon={Wallet} label="Encaissé" value={money(stats.paid)} tone="purple" />
        <StatCard icon={CircleDollarSign} label="Dettes clients" value={money(stats.rest)} tone="red" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Client, téléphone ou réf…" />
          <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? <EmptyState icon={Receipt} title="Aucune vente" message="Les ventes du point de vente apparaîtront ici." /> : view === 'grid' ? (
        <CardGrid>
          {filtered.map(s => (
            <GlassCard key={s.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="font-black text-slate-800">{s.ref}</h3><p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><User className="w-3 h-3" />{s.clientName}</p></div>
                {s.rest > 0 ? <Badge tone="danger">Crédit</Badge> : <Badge tone="success">Payée</Badge>}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{formatDate(s.date)} • {s.items.length} article(s)</p>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(s.total)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(s.paid)}</p></div>
                <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(s.rest)}</p></div>
              </div>
              <div className="flex items-center justify-end mt-3 pt-3 border-t border-slate-100">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(s)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(s)} />}
                  {s.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(s)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(s)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      ) : (
        <Table head={<>
          <th className="table-head">Réf</th><th className="table-head">Client</th><th className="table-head">Date</th>
          <th className="table-head">Total</th><th className="table-head">Payé</th><th className="table-head">Reste</th>
          <th className="table-head">État</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(s => (
            <tr key={s.id}>
              <td className="table-cell font-bold">{s.ref}</td><td className="table-cell">{s.clientName}</td><td className="table-cell">{formatDate(s.date)}</td>
              <td className="table-cell tabular-nums">{money(s.total)}</td><td className="table-cell tabular-nums text-emerald-600">{money(s.paid)}</td>
              <td className="table-cell tabular-nums text-red-600">{money(s.rest)}</td>
              <td className="table-cell">{s.rest > 0 ? <Badge tone="danger">Crédit</Badge> : <Badge tone="success">Payée</Badge>}</td>
              <td className="table-cell"><RowActions>
                <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(s)} />
                {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(s)} />}
                {s.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(s)} />}
                {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(s)} />}
              </RowActions></td>
            </tr>
          ))}
        </Table>
      )}

      {/* View */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={Receipt} size="lg" title={`Vente ${viewing?.ref || ''}`} subtitle={viewing?.clientName}>
        {viewing && (
          <div className="space-y-4">
            <Table head={<><th className="table-head">Produit</th><th className="table-head">Qté</th><th className="table-head">P.U</th><th className="table-head">Total</th></>}>
              {viewing.items.map((it, i) => <tr key={i}><td className="table-cell">{it.productName}</td><td className="table-cell tabular-nums">{it.qty}</td><td className="table-cell tabular-nums">{money(it.unitPrice)}</td><td className="table-cell tabular-nums font-bold">{money((it.total ?? it.qty * it.unitPrice))}</td></tr>)}
            </Table>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Sous-total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(viewing.subtotal)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Réduction</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(viewing.reduction)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(viewing.paid)}</p></div>
              <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(viewing.rest)}</p></div>
            </div>
            <div className="flex justify-end"><button className="btn-outline" onClick={() => printInvoice({
              title: 'Facture de vente', ref: viewing.ref, date: viewing.date, store: settings?.stationName,
              party: { label: 'Client', name: viewing.clientName },
              items: viewing.items.map(i => ({ name: i.productName, qty: i.qty, unitPrice: i.unitPrice, total: i.total ?? i.qty * i.unitPrice })),
              total: viewing.total, paid: viewing.paid, rest: viewing.rest,
            })}><Receipt className="w-4 h-4" /> Imprimer</button></div>
          </div>
        )}
      </Modal>

      {editing && <EditSale moduleKey={moduleKey} sale={editing} onClose={() => setEditing(null)} />}
      <PayDebtModal open={!!paying} onClose={() => setPaying(null)} total={paying?.total || 0} alreadyPaid={paying?.paid || 0} onPay={onPay} />
      <Confirm open={!!toDelete} title="Supprimer la vente" message={`Supprimer la facture ${toDelete?.ref} ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function EditSale({ moduleKey, sale, onClose }: { moduleKey: ModuleKey; sale: BizSale; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { clients } = biz.state;
  const [clientId, setClientId] = useState(sale.clientId || '');
  const [reduction, setReduction] = useState(sale.reduction);
  const [paid, setPaid] = useState(sale.paid);
  const total = Math.max(0, sale.subtotal - reduction);
  const save = () => {
    const client = clients.find(c => c.id === clientId);
    biz.update('sales', { ...sale, clientId: clientId || undefined, clientName: client?.name || 'Client de passage', reduction, total, paid, rest: Math.max(0, total - paid), status: total - paid > 0 ? 'crédit' : 'payée' });
    toast.success('Vente modifiée'); onClose();
  };
  return (
    <Modal open onClose={onClose} icon={Edit2} size="md" title={`Modifier ${sale.ref}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="space-y-4">
        <Field label="Client"><Select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Client de passage</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Réduction (DA)"><Input type="number" value={reduction} onChange={e => setReduction(Number(e.target.value))} /></Field>
          <Field label="Payé (DA)"><Input type="number" value={paid} onChange={e => setPaid(Number(e.target.value))} /></Field>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 flex items-center justify-between"><span className="text-sm text-slate-400">Total</span><span className="font-black tabular-nums">{money(total)}</span></div>
      </div>
    </Modal>
  );
}
