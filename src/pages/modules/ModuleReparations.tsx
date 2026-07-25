import React, { useMemo, useState } from 'react';
import {
  Car, Wrench, Droplets, CalendarClock, Plus, Search, X, User, UserPlus, Check, Wallet,
  Eye, Edit2, Trash2, Clock, Package, Users as UsersIcon, CheckCircle2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizReparation, BizService, BizCar, BizLineItem } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, Textarea, Select, money, formatDate,
  PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { ContactModal, PayDebtModal } from './_shared';

const KIND_META: Record<string, { label: string; icon: React.ElementType; tone: any }> = {
  appointment: { label: 'Rendez-vous', icon: CalendarClock, tone: 'info' },
  reparation: { label: 'Réparation', icon: Wrench, tone: 'warning' },
  lavage: { label: 'Lavage', icon: Droplets, tone: 'primary' },
};
const STATUS_META: Record<string, { label: string; tone: any }> = {
  pending: { label: 'En attente', tone: 'warning' },
  finalized: { label: 'Finalisé', tone: 'success' },
  canceled: { label: 'Annulé', tone: 'danger' },
};

export default function ModuleReparations({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'reparations');
  const { reparations, clients } = biz.state;

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'finalized' | 'canceled'>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [creating, setCreating] = useState<null | 'appointment' | 'reparation' | 'lavage'>(null);
  const [viewing, setViewing] = useState<BizReparation | null>(null);
  const [editing, setEditing] = useState<BizReparation | null>(null);
  const [paying, setPaying] = useState<BizReparation | null>(null);
  const [finalizing, setFinalizing] = useState<BizReparation | null>(null);
  const [toDelete, setToDelete] = useState<BizReparation | null>(null);

  const filtered = useMemo(() => [...reparations].filter(r => {
    const client = clients.find(c => c.id === r.clientId);
    const q = search.trim().toLowerCase();
    const matchQ = !q || r.clientName.toLowerCase().includes(q) || (client?.phone || '').includes(q) || r.ref.toLowerCase().includes(q);
    return matchQ && (status === 'all' || r.status === status) && inPeriod(r.date, period, from, to);
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [reparations, clients, search, status, period, from, to]);

  const stats = useMemo(() => ({
    total: reparations.length,
    pending: reparations.filter(r => r.status === 'pending').length,
    revenue: reparations.reduce((s, r) => s + r.total, 0),
    rest: reparations.reduce((s, r) => s + r.rest, 0),
  }), [reparations]);

  const del = () => { if (toDelete) { biz.remove('reparations', toDelete.id); toast.success('Supprimé'); setToDelete(null); } };
  const onPay = (amount: number) => {
    if (!paying) return;
    const paid = Math.min(paying.total, paying.paid + amount);
    biz.update('reparations', { ...paying, paid, rest: Math.max(0, paying.total - paid) });
    toast.success('Paiement enregistré'); setPaying(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Car} title="Réparations & Lavage" subtitle={`${cfg.label} — atelier & rendez-vous`}
        actions={perm.creer ? <div className="flex gap-2">
          <button className="btn-outline !py-2" onClick={() => setCreating('appointment')}><CalendarClock className="w-4 h-4" /> Rendez-vous</button>
          <button className="btn-secondary" onClick={() => setCreating('lavage')}><Droplets className="w-4 h-4" /> Lavage</button>
          <button className="btn-primary" onClick={() => setCreating('reparation')}><Wrench className="w-4 h-4" /> Réparation</button>
        </div> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Car} label="Interventions" value={stats.total} tone="blue" />
        <StatCard icon={Clock} label="En attente" value={stats.pending} tone="amber" />
        <StatCard icon={Wallet} label="Chiffre d'affaires" value={money(stats.revenue)} tone="green" />
        <StatCard icon={Wallet} label="Reste à encaisser" value={money(stats.rest)} tone="red" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Client, téléphone ou réf…" />
          <div className="flex gap-1.5">
            {(['all', 'pending', 'finalized', 'canceled'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${status === s ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                {s === 'all' ? 'Tous' : STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? <EmptyState icon={Car} title="Aucune intervention" message="Créez une réparation, un lavage ou un rendez-vous." /> : (
        <CardGrid>
          {filtered.map(r => {
            const KM = KIND_META[r.kind]; const KIcon = KM.icon;
            return (
              <GlassCard key={r.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5"><KIcon className="w-4 h-4 text-[#003087]" /><h3 className="font-black text-slate-800">{r.ref}</h3></div>
                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><User className="w-3 h-3" />{r.clientName}</p>
                  </div>
                  <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
                </div>
                {(r.car.marque || r.car.name) && <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1"><Car className="w-3 h-3" />{[r.car.marque, r.car.name, r.car.immatriculation].filter(Boolean).join(' • ')}</p>}
                <div className="flex flex-wrap gap-1 mt-2">{r.services.slice(0, 3).map(s => <Badge key={s.id} tone="neutral">{s.name}</Badge>)}{r.services.length > 3 && <Badge tone="neutral">+{r.services.length - 3}</Badge>}</div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(r.total)}</p></div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(r.paid)}</p></div>
                  <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(r.rest)}</p></div>
                </div>
                {r.kind === 'appointment' && r.comingDate && <p className="text-[11px] text-blue-500 mt-2 flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Entrée: {new Date(r.comingDate).toLocaleString('fr-DZ')}</p>}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  {r.status === 'pending' && perm.modifier ? <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => setFinalizing(r)}><CheckCircle2 className="w-4 h-4" /> Finaliser</button> : <span />}
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(r)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(r)} />}
                    {r.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(r)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(r)} />}
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      )}

      {creating && <ReparationForm moduleKey={moduleKey} kind={creating} onClose={() => setCreating(null)} />}
      {editing && <ReparationForm moduleKey={moduleKey} kind={editing.kind} initial={editing} onClose={() => setEditing(null)} />}
      {finalizing && <FinalizeModal moduleKey={moduleKey} rep={finalizing} onClose={() => setFinalizing(null)} />}
      {viewing && <ViewRep rep={viewing} onClose={() => setViewing(null)} />}
      <PayDebtModal open={!!paying} onClose={() => setPaying(null)} total={paying?.total || 0} alreadyPaid={paying?.paid || 0} onPay={onPay} />
      <Confirm open={!!toDelete} title="Supprimer" message={`Supprimer ${toDelete?.ref} ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function ViewRep({ rep, onClose }: { rep: BizReparation; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} icon={KIND_META[rep.kind].icon} size="lg" title={`${KIND_META[rep.kind].label} ${rep.ref}`} subtitle={rep.clientName}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Client</p><p className="font-bold text-slate-700">{rep.clientName}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Statut</p><p className="font-bold text-slate-700">{STATUS_META[rep.status].label}</p></div>
        </div>
        {(rep.car.marque || rep.car.name) && (
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Véhicule</p>
            <p className="text-sm font-semibold text-slate-700">{[rep.car.marque, rep.car.name, rep.car.color, rep.car.year, rep.car.immatriculation].filter(Boolean).join(' • ')}</p></div>
        )}
        {rep.problem && <div className="rounded-xl bg-amber-50 p-3"><p className="text-[10px] uppercase font-bold text-amber-500">Problème</p><p className="text-sm text-amber-700">{rep.problem}</p></div>}
        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Services</p>
          <div className="space-y-1">{rep.services.map(s => <div key={s.id} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2"><span>{s.name}</span><span className="font-bold tabular-nums">{money(s.price)}</span></div>)}</div>
        </div>
        {rep.usedProducts.length > 0 && (
          <div><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Produits utilisés</p>
            <div className="space-y-1">{rep.usedProducts.map((p, i) => <div key={i} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2"><span>{p.productName} × {p.qty}</span><span className="font-bold tabular-nums">{money((p.total ?? p.qty * p.unitPrice))}</span></div>)}</div></div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums">{money(rep.total)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums">{money(rep.paid)}</p></div>
          <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums">{money(rep.rest)}</p></div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Create / Edit reparation ──────────────────────────────────────────────────
function ReparationForm({ moduleKey, kind, initial, onClose }: { moduleKey: ModuleKey; kind: 'appointment' | 'reparation' | 'lavage'; initial?: BizReparation; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { clients, services, products, workers } = biz.state;
  const isEdit = !!initial;
  const isAppointment = kind === 'appointment';

  const [clientId, setClientId] = useState(initial?.clientId || '');
  const [showClient, setShowClient] = useState(false);
  const [car, setCar] = useState<BizCar>(initial?.car || {});
  const [problem, setProblem] = useState(initial?.problem || '');
  const [selServices, setSelServices] = useState<{ id: string; name: string; price: number }[]>(initial?.services || []);
  const [used, setUsed] = useState<BizLineItem[]>(initial?.usedProducts || []);
  const [comingDate, setComingDate] = useState(initial?.comingDate || '');
  const [outDate, setOutDate] = useState(initial?.outDate || '');
  const [totalOverride, setTotalOverride] = useState<number | null>(initial ? initial.total : null);
  const [paidStr, setPaidStr] = useState<string>(initial ? String(initial.paid) : '');
  const [selWorkers, setSelWorkers] = useState<string[]>(initial?.workers || []);
  const [showNewService, setShowNewService] = useState(false);
  const [pQuery, setPQuery] = useState('');

  const baseTotal = selServices.reduce((s, x) => s + x.price, 0) + used.reduce((s, x) => s + (x.total ?? x.qty * x.unitPrice), 0);
  const total = totalOverride ?? baseTotal;
  const paid = paidStr === '' ? total : Number(paidStr);
  const rest = Math.max(0, total - paid);

  const productMatches = useMemo(() => {
    const q = pQuery.trim().toLowerCase(); if (!q) return [];
    return products.filter(p => p.name.toLowerCase().includes(q) && p.currentQty > 0).slice(0, 6);
  }, [products, pQuery]);

  const toggleService = (s: BizService) => setSelServices(prev => prev.some(x => x.id === s.id) ? prev.filter(x => x.id !== s.id) : [...prev, { id: s.id, name: s.name, price: s.price }]);
  const addUsed = (p: typeof products[number]) => { if (used.some(u => u.productId === p.id)) return; setUsed(prev => [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice: p.salePrice, total: p.salePrice }]); setPQuery(''); };
  const updUsed = (id: string, qty: number) => setUsed(prev => prev.map(u => u.productId === id ? { ...u, qty, total: qty * u.unitPrice } : u));
  const rmUsed = (id: string) => setUsed(prev => prev.filter(u => u.productId !== id));
  const toggleWorker = (id: string) => setSelWorkers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const save = () => {
    if (!clientId) { toast.error('Sélectionnez un client'); return; }
    const client = clients.find(c => c.id === clientId);
    const status: BizReparation['status'] = isAppointment && !isEdit ? 'pending' : (initial?.status || 'finalized');
    const prefix = kind === 'appointment' ? 'RDV' : kind === 'lavage' ? 'LAV' : 'REP';
    const rep: BizReparation = {
      id: initial?.id || newId(), ref: initial?.ref || `${prefix}-${String(biz.state.reparations.length + 1).padStart(4, '0')}`,
      kind, clientId, clientName: client?.name || '—', car, services: selServices, usedProducts: used, problem,
      total, paid, rest, status, comingDate: comingDate || undefined, outDate: outDate || undefined,
      date: initial?.date || new Date().toISOString(), workers: selWorkers, createdBy: 'Admin',
    };
    if (isEdit) biz.update('reparations', rep);
    else {
      biz.add('reparations', rep);
      // Deduct used products from stock when the intervention is finalized (not a pending appointment)
      if (status === 'finalized') used.forEach(u => { const p = products.find(x => x.id === u.productId); if (p) biz.update('products', { ...p, currentQty: Math.max(0, p.currentQty - u.qty) }); });
    }
    toast.success(isEdit ? 'Modifié' : (isAppointment ? 'Rendez-vous enregistré (en attente)' : 'Intervention finalisée'));
    onClose();
  };

  return (
    <>
      <Modal open onClose={onClose} icon={KIND_META[kind].icon} size="xl" title={isEdit ? `Modifier ${initial?.ref}` : `Nouveau ${KIND_META[kind].label.toLowerCase()}`} subtitle="Client, véhicule, services & paiement"
        footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : (isAppointment ? 'Enregistrer le rendez-vous' : 'Finaliser')}</button></>}>
        <div className="space-y-5">
          {isAppointment && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Date & heure d'entrée"><Input type="datetime-local" value={comingDate} onChange={e => setComingDate(e.target.value)} /></Field>
              <Field label="Date & heure de sortie"><Input type="datetime-local" value={outDate} onChange={e => setOutDate(e.target.value)} /></Field>
            </div>
          )}

          {/* Client */}
          <Field label="Client" required>
            <div className="flex gap-2">
              <Select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">— Sélectionner —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}</Select>
              <button className="btn-secondary !px-3 shrink-0" onClick={() => setShowClient(true)}><UserPlus className="w-4 h-4" /></button>
            </div>
          </Field>

          {/* Car */}
          <div>
            <label className="label-field">Véhicule (optionnel)</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Input placeholder="Nom / modèle" value={car.name || ''} onChange={e => setCar({ ...car, name: e.target.value })} />
              <Input placeholder="Marque" value={car.marque || ''} onChange={e => setCar({ ...car, marque: e.target.value })} />
              <Input placeholder="Couleur" value={car.color || ''} onChange={e => setCar({ ...car, color: e.target.value })} />
              <Input placeholder="Année" value={car.year || ''} onChange={e => setCar({ ...car, year: e.target.value })} />
              <Input placeholder="Immatriculation" value={car.immatriculation || ''} onChange={e => setCar({ ...car, immatriculation: e.target.value })} />
            </div>
          </div>

          {/* Problem */}
          <Field label="Description du problème"><Textarea value={problem} onChange={e => setProblem(e.target.value)} placeholder="Décrivez le problème du véhicule…" /></Field>

          {/* Services */}
          <div>
            <div className="flex items-center justify-between mb-1"><label className="label-field !mb-0">Services</label>
              <button className="text-xs font-bold text-[#003087] flex items-center gap-1" onClick={() => setShowNewService(s => !s)}><Plus className="w-3.5 h-3.5" /> Nouveau service</button></div>
            {showNewService && <div className="mb-2"><NewServiceInline moduleKey={moduleKey} onCreated={(s) => { toggleService(s); setShowNewService(false); }} /></div>}
            <div className="flex flex-wrap gap-2">
              {services.map(s => { const on = selServices.some(x => x.id === s.id); return (
                <button key={s.id} onClick={() => toggleService(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${on ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {on && <Check className="w-3 h-3" />} {s.name} • {money(s.price)}
                </button>
              ); })}
            </div>
          </div>

          {/* Used products */}
          <div>
            <label className="label-field">Produits utilisés (déduits du stock)</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={pQuery} onChange={e => setPQuery(e.target.value)} placeholder="Rechercher un produit du stock…" className="input-field pl-9" />
              {productMatches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                  {productMatches.map(p => <button key={p.id} onClick={() => addUsed(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between"><span className="text-sm font-semibold">{p.name}</span><span className="text-xs text-slate-400">{money(p.salePrice)} • stock {p.currentQty}</span></button>)}
                </div>
              )}
            </div>
            {used.length > 0 && <div className="mt-2 space-y-1.5">{used.map(u => (
              <div key={u.productId} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
                <span className="flex-1 text-sm font-semibold text-slate-700">{u.productName}</span>
                <input type="number" value={u.qty} onChange={e => updUsed(u.productId, Number(e.target.value))} className="input-field !py-1 !px-2 w-16 text-center" />
                <span className="text-sm font-bold tabular-nums w-24 text-right">{money(u.total ?? u.qty * u.unitPrice)}</span>
                <button onClick={() => rmUsed(u.productId)} className="text-red-500 p-1"><X className="w-4 h-4" /></button>
              </div>
            ))}</div>}
          </div>

          {/* Workers */}
          <div>
            <label className="label-field">Employés affectés (optionnel)</label>
            <div className="flex flex-wrap gap-2">
              {workers.map(w => { const on = selWorkers.includes(w.id); return (
                <button key={w.id} onClick={() => toggleWorker(w.id)} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${on ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {on && <Check className="w-3 h-3" />} {w.name}
                </button>
              ); })}
            </div>
          </div>

          {/* Resume */}
          <div className="rounded-2xl bg-[#001f5c] text-white p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-blue-200">Total</span>
              <div className="flex items-center gap-2">
                <input type="number" value={total} onChange={e => setTotalOverride(Number(e.target.value))} className="input-field !py-1.5 w-32 text-right" />
                {totalOverride !== null && <button onClick={() => setTotalOverride(null)} title="Auto" className="text-blue-200 text-xs">auto</button>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-[11px] font-bold uppercase text-blue-200">Payé</label><input type="number" value={paidStr} onChange={e => setPaidStr(e.target.value)} placeholder={String(total)} className="input-field mt-1" /></div>
              <div><label className="text-[11px] font-bold uppercase text-blue-200">Reste</label><div className="mt-1 h-[46px] rounded-xl bg-white/10 flex items-center px-4 font-black tabular-nums text-red-300">{money(rest)}</div></div>
            </div>
          </div>
        </div>
      </Modal>
      <ContactModal biz={biz} coll="clients" open={showClient} onClose={() => setShowClient(false)} onSaved={(c) => setClientId(c.id)} />
    </>
  );
}

function NewServiceInline({ moduleKey, onCreated }: { moduleKey: ModuleKey; onCreated: (s: BizService) => void }) {
  const biz = useBiz(moduleKey);
  const [name, setName] = useState(''); const [price, setPrice] = useState(0);
  return (
    <div className="flex gap-2 bg-slate-50 rounded-xl p-2">
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom du service" className="input-field !py-2" />
      <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} placeholder="Prix" className="input-field !py-2 w-24" />
      <button className="btn-secondary !px-3 shrink-0" onClick={() => { if (name.trim()) { const s = { id: newId(), name: name.trim(), price }; biz.add('services', s); onCreated(s); } }}><Plus className="w-4 h-4" /></button>
    </div>
  );
}

// ─── Finalize appointment ──────────────────────────────────────────────────────
function FinalizeModal({ moduleKey, rep, onClose }: { moduleKey: ModuleKey; rep: BizReparation; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { services, products, workers } = biz.state;
  const [selServices, setSelServices] = useState(rep.services);
  const [used, setUsed] = useState<BizLineItem[]>(rep.usedProducts);
  const [pQuery, setPQuery] = useState('');
  const [selWorkers, setSelWorkers] = useState<string[]>(rep.workers);
  const [showNew, setShowNew] = useState(false);

  const total = selServices.reduce((s, x) => s + x.price, 0) + used.reduce((s, x) => s + (x.total ?? x.qty * x.unitPrice), 0);
  const [paidStr, setPaidStr] = useState<string>(String(rep.paid));
  const paid = paidStr === '' ? total : Number(paidStr);
  const rest = Math.max(0, total - paid);

  const matches = useMemo(() => { const q = pQuery.trim().toLowerCase(); if (!q) return []; return products.filter(p => p.name.toLowerCase().includes(q) && p.currentQty > 0).slice(0, 6); }, [products, pQuery]);
  const toggleService = (s: BizService) => setSelServices(prev => prev.some(x => x.id === s.id) ? prev.filter(x => x.id !== s.id) : [...prev, { id: s.id, name: s.name, price: s.price }]);
  const addUsed = (p: typeof products[number]) => { if (used.some(u => u.productId === p.id)) return; setUsed(prev => [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice: p.salePrice, total: p.salePrice }]); setPQuery(''); };
  const rmUsed = (id: string) => setUsed(prev => prev.filter(u => u.productId !== id));
  const toggleWorker = (id: string) => setSelWorkers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const finalize = () => {
    biz.update('reparations', { ...rep, services: selServices, usedProducts: used, total, paid, rest, status: 'finalized', workers: selWorkers });
    // Deduct newly-used products (those not already deducted). Simplest: deduct the delta of newly added products.
    const before = new Set(rep.usedProducts.map(u => u.productId));
    used.forEach(u => { if (!before.has(u.productId)) { const p = products.find(x => x.id === u.productId); if (p) biz.update('products', { ...p, currentQty: Math.max(0, p.currentQty - u.qty) }); } });
    toast.success('Rendez-vous finalisé'); onClose();
  };

  return (
    <Modal open onClose={onClose} icon={CheckCircle2} size="lg" title={`Finaliser ${rep.ref}`} subtitle={rep.clientName}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={finalize}>Finaliser</button></>}>
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1"><label className="label-field !mb-0">Services</label><button className="text-xs font-bold text-[#003087] flex items-center gap-1" onClick={() => setShowNew(s => !s)}><Plus className="w-3.5 h-3.5" /> Nouveau</button></div>
          {showNew && <div className="mb-2"><NewServiceInline moduleKey={moduleKey} onCreated={(s) => { toggleService(s); setShowNew(false); }} /></div>}
          <div className="flex flex-wrap gap-2">{services.map(s => { const on = selServices.some(x => x.id === s.id); return <button key={s.id} onClick={() => toggleService(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${on ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-600'}`}>{on && <Check className="w-3 h-3" />}{s.name} • {money(s.price)}</button>; })}</div>
        </div>
        <div>
          <label className="label-field">Produits du stock utilisés</label>
          <div className="relative"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={pQuery} onChange={e => setPQuery(e.target.value)} placeholder="Rechercher…" className="input-field pl-9" />
            {matches.length > 0 && <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">{matches.map(p => <button key={p.id} onClick={() => addUsed(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex justify-between"><span className="text-sm font-semibold">{p.name}</span><span className="text-xs text-slate-400">stock {p.currentQty}</span></button>)}</div>}
          </div>
          {used.length > 0 && <div className="mt-2 space-y-1.5">{used.map(u => <div key={u.productId} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2"><span className="flex-1 text-sm font-semibold">{u.productName} × {u.qty}</span><button onClick={() => rmUsed(u.productId)} className="text-red-500 p-1"><X className="w-4 h-4" /></button></div>)}</div>}
        </div>
        <div>
          <label className="label-field">Employés affectés</label>
          <div className="flex flex-wrap gap-2">{workers.map(w => { const on = selWorkers.includes(w.id); return <button key={w.id} onClick={() => toggleWorker(w.id)} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${on ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>{on && <Check className="w-3 h-3" />}{w.name}</button>; })}</div>
        </div>
        <div className="rounded-2xl bg-[#001f5c] text-white p-4">
          <div className="flex items-center justify-between mb-3"><span className="text-sm font-semibold text-blue-200">Total</span><span className="text-xl font-black tabular-nums text-[#FFB800]">{money(total)}</span></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] font-bold uppercase text-blue-200">Payé</label><input type="number" value={paidStr} onChange={e => setPaidStr(e.target.value)} className="input-field mt-1" /></div>
            <div><label className="text-[11px] font-bold uppercase text-blue-200">Reste</label><div className="mt-1 h-[46px] rounded-xl bg-white/10 flex items-center px-4 font-black tabular-nums text-red-300">{money(rest)}</div></div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
