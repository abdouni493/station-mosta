/**
 * ─── Réparations & Lavage ───────────────────────────────────────────────────────
 * Interventions of the Lavage & Réparation part.
 *
 *  • Le client est optionnel — sans client, l'intervention est au nom d'un
 *    « Client de passage ».
 *  • Il n'y a plus de catalogue de services : le montant de la prestation est
 *    saisi à la main.
 *  • L'employé qui a réalisé le travail est sélectionné (base de la paie au
 *    pourcentage).
 *  • Les produits utilisés sont cherchés par nom OU code-barres ; un produit
 *    vendu au détail se saisit dans son unité de détail (ex: 10 L sur 50 L).
 *  • Une intervention peut être créée « en attente » puis finalisée plus tard
 *    avec exactement le même formulaire.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Car, Wrench, Droplets, Plus, Search, X, User, UserPlus, Wallet, Printer,
  Eye, Edit2, Trash2, Clock, Package, CheckCircle2, Hourglass,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizReparation, BizCar, BizLineItem, BizProduct, detailPrice,
} from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, Textarea, Select, money, formatDate,
  PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { ContactModal, PayDebtModal, printInvoice, AskPrintModal, stationFromSettings } from './_shared';

const KIND_META: Record<BizReparation['kind'], { label: string; icon: React.ElementType }> = {
  reparation: { label: 'Réparation', icon: Wrench },
  lavage: { label: 'Lavage', icon: Droplets },
};
const STATUS_META: Record<string, { label: string; tone: any }> = {
  pending: { label: 'En attente', tone: 'warning' },
  finalized: { label: 'Finalisé', tone: 'success' },
  canceled: { label: 'Annulé', tone: 'danger' },
};

const PASSAGE = 'Client de passage';

export default function ModuleReparations({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'reparations');
  const { settings } = useAppState();
  const { reparations, clients, workers } = biz.state;

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'finalized' | 'canceled'>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [creating, setCreating] = useState<null | { kind: BizReparation['kind']; pending: boolean }>(null);
  const [viewing, setViewing] = useState<BizReparation | null>(null);
  const [editing, setEditing] = useState<BizReparation | null>(null);
  const [paying, setPaying] = useState<BizReparation | null>(null);
  const [toDelete, setToDelete] = useState<BizReparation | null>(null);
  const [askPrint, setAskPrint] = useState<BizReparation | null>(null);

  const filtered = useMemo(() => [...reparations].filter(r => {
    const client = clients.find(c => c.id === r.clientId);
    const q = search.trim().toLowerCase();
    const matchQ = !q
      || r.clientName.toLowerCase().includes(q)
      || (client?.phone || '').includes(q)
      || r.ref.toLowerCase().includes(q)
      || (r.car?.immatriculation || '').toLowerCase().includes(q);
    return matchQ && (status === 'all' || r.status === status) && inPeriod(r.date, period, from, to);
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [reparations, clients, search, status, period, from, to]);

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

  const doPrint = (r: BizReparation) => {
    const client = clients.find(c => c.id === r.clientId);
    const workerNames = r.workers.map(id => workers.find(w => w.id === id)?.name).filter(Boolean).join(', ');
    printInvoice({
      title: KIND_META[r.kind].label, ref: r.ref, date: r.date,
      station: stationFromSettings(settings),
      party: { label: 'Client', name: r.clientName, phone: client?.phone, address: client?.address },
      info: [
        { label: 'Véhicule', value: [r.car?.marque, r.car?.name, r.car?.color, r.car?.year].filter(Boolean).join(' • ') },
        { label: 'Immatriculation', value: r.car?.immatriculation || '' },
        { label: 'Employé(s)', value: workerNames },
        { label: 'Statut', value: STATUS_META[r.status].label },
      ],
      items: [
        ...(r.serviceTotal > 0 ? [{ name: 'Prestation / main d’œuvre', qty: 1, unitPrice: r.serviceTotal, total: r.serviceTotal }] : []),
        ...r.usedProducts.map(p => ({
          name: p.productName,
          qty: p.detailQty ? `${p.detailQty} ${p.detailUnit || ''}`.trim() : p.qty,
          unitPrice: p.unitPrice,
          total: p.total ?? p.qty * p.unitPrice,
        })),
      ],
      total: r.total, paid: r.paid, rest: r.rest,
      payments: [{ label: 'Espèces', amount: r.paid }],
      notes: r.problem,
    });
    biz.update('reparations', { ...r, printedAt: new Date().toISOString() });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Car} title="Réparations & Lavage" subtitle={`${cfg.label} — atelier & interventions`}
        actions={perm.creer ? <div className="flex flex-wrap gap-2">
          <button className="btn-outline !py-2" onClick={() => setCreating({ kind: 'lavage', pending: true })}>
            <Hourglass className="w-4 h-4" /> En attente
          </button>
          <button className="btn-secondary" onClick={() => setCreating({ kind: 'lavage', pending: false })}>
            <Droplets className="w-4 h-4" /> Lavage
          </button>
          <button className="btn-primary" onClick={() => setCreating({ kind: 'reparation', pending: false })}>
            <Wrench className="w-4 h-4" /> Réparation
          </button>
        </div> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Car} label="Interventions" value={stats.total} tone="blue" />
        <StatCard icon={Clock} label="En attente" value={stats.pending} tone="amber" />
        <StatCard icon={Wallet} label="Chiffre d'affaires" value={money(stats.revenue)} tone="green" />
        <StatCard icon={Wallet} label="Reste à encaisser" value={money(stats.rest)} tone="red" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Client, téléphone, réf ou immatriculation…" />
          <div className="flex gap-1.5">
            {(['all', 'pending', 'finalized', 'canceled'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${status === s ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                {s === 'all' ? 'Tous' : STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Car} title="Aucune intervention" message="Créez un lavage ou une réparation, ou enregistrez-la en attente." />
      ) : (
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
                {(r.car?.marque || r.car?.name || r.car?.immatriculation) && (
                  <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                    <Car className="w-3 h-3" />{[r.car.marque, r.car.name, r.car.immatriculation].filter(Boolean).join(' • ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {r.serviceTotal > 0 && <Badge tone="primary">Prestation {money(r.serviceTotal)}</Badge>}
                  {r.usedProducts.length > 0 && <Badge tone="neutral">{r.usedProducts.length} produit(s)</Badge>}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(r.total)}</p></div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(r.paid)}</p></div>
                  <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(r.rest)}</p></div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  {r.status === 'pending' && perm.modifier
                    ? <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => setEditing(r)}><CheckCircle2 className="w-4 h-4" /> Finaliser</button>
                    : <span />}
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(r)} />
                    <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(r)} />
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

      {creating && (
        <ReparationForm
          moduleKey={moduleKey}
          kind={creating.kind}
          asPending={creating.pending}
          onClose={() => setCreating(null)}
          onSaved={r => { setCreating(null); if (r.status === 'finalized') setAskPrint(r); }}
        />
      )}
      {editing && (
        <ReparationForm
          moduleKey={moduleKey}
          kind={editing.kind}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={r => { setEditing(null); if (r.status === 'finalized') setAskPrint(r); }}
        />
      )}
      {viewing && <ViewRep rep={viewing} workers={workers} onClose={() => setViewing(null)} onPrint={() => doPrint(viewing)} />}

      <AskPrintModal open={!!askPrint}
        onPrint={() => { if (askPrint) doPrint(askPrint); setAskPrint(null); }}
        onSkip={() => setAskPrint(null)} />

      <PayDebtModal open={!!paying} onClose={() => setPaying(null)} total={paying?.total || 0} alreadyPaid={paying?.paid || 0} onPay={onPay} />
      <Confirm open={!!toDelete} title="Supprimer" message={`Supprimer ${toDelete?.ref} ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Detail view ───────────────────────────────────────────────────────────────
function ViewRep({ rep, workers, onClose, onPrint }: {
  rep: BizReparation; workers: { id: string; name: string }[]; onClose: () => void; onPrint: () => void;
}) {
  const workerNames = rep.workers.map(id => workers.find(w => w.id === id)?.name).filter(Boolean).join(', ');
  return (
    <Modal open onClose={onClose} icon={KIND_META[rep.kind].icon} size="lg"
      title={`${KIND_META[rep.kind].label} ${rep.ref}`} subtitle={rep.clientName}
      footer={<button className="btn-outline" onClick={onPrint}><Printer className="w-4 h-4" /> Imprimer la facture</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Client</p><p className="font-bold text-slate-700">{rep.clientName}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Statut</p><p className="font-bold text-slate-700">{STATUS_META[rep.status].label}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Date</p><p className="font-bold text-slate-700">{formatDate(rep.date)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Employé(s)</p><p className="font-bold text-slate-700">{workerNames || '—'}</p></div>
        </div>
        {(rep.car?.marque || rep.car?.name || rep.car?.immatriculation) && (
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Véhicule</p>
            <p className="text-sm font-semibold text-slate-700">{[rep.car.marque, rep.car.name, rep.car.color, rep.car.year, rep.car.immatriculation].filter(Boolean).join(' • ')}</p></div>
        )}
        {rep.problem && <div className="rounded-xl bg-amber-50 p-3"><p className="text-[10px] uppercase font-bold text-amber-500">Problème</p><p className="text-sm text-amber-700">{rep.problem}</p></div>}
        <div className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
          <span>Prestation / main d'œuvre</span><span className="font-bold tabular-nums">{money(rep.serviceTotal)}</span>
        </div>
        {rep.usedProducts.length > 0 && (
          <div><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Produits utilisés</p>
            <div className="space-y-1">{rep.usedProducts.map((p, i) => (
              <div key={i} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                <span>{p.productName} × {p.detailQty ? `${p.detailQty} ${p.detailUnit || ''}` : p.qty}</span>
                <span className="font-bold tabular-nums">{money(p.total ?? p.qty * p.unitPrice)}</span>
              </div>))}
            </div></div>
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

// ─── Create / edit / finalize ──────────────────────────────────────────────────
/**
 * The same form serves creation, edition and finalisation of a pending job, so
 * the three flows can never drift apart.
 */
function ReparationForm({
  moduleKey, kind, initial, asPending, onClose, onSaved,
}: {
  moduleKey: ModuleKey;
  kind: BizReparation['kind'];
  initial?: BizReparation;
  asPending?: boolean;
  onClose: () => void;
  onSaved: (r: BizReparation) => void;
}) {
  const biz = useBiz(moduleKey);
  const { clients, products, workers } = biz.state;
  const isEdit = !!initial;
  const wasPending = initial?.status === 'pending';

  const [repKind, setRepKind] = useState<BizReparation['kind']>(initial?.kind || kind);
  const [clientId, setClientId] = useState(initial?.clientId || '');
  const [showClient, setShowClient] = useState(false);
  const [car, setCar] = useState<BizCar>(initial?.car || {});
  const [problem, setProblem] = useState(initial?.problem || '');
  const [serviceTotal, setServiceTotal] = useState(String(initial?.serviceTotal ?? ''));
  const [used, setUsed] = useState<BizLineItem[]>(initial?.usedProducts || []);
  const [paidStr, setPaidStr] = useState<string>(initial ? String(initial.paid) : '');
  const [selWorkers, setSelWorkers] = useState<string[]>(initial?.workers || []);
  const [pQuery, setPQuery] = useState('');
  const [pending, setPending] = useState<boolean>(initial ? initial.status === 'pending' : !!asPending);

  const service = Number(serviceTotal) || 0;
  const productsTotal = used.reduce((s, x) => s + (x.total ?? x.qty * x.unitPrice), 0);
  const total = service + productsTotal;
  const paid = paidStr === '' ? (pending ? 0 : total) : Number(paidStr);
  const rest = Math.max(0, total - paid);

  // Search by product name OR barcode.
  const productMatches = useMemo(() => {
    const q = pQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(p => p.currentQty > 0 && (p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)))
      .slice(0, 8);
  }, [products, pQuery]);

  const addUsed = (p: BizProduct) => {
    if (used.some(u => u.productId === p.id)) { setPQuery(''); return; }
    if (p.sellByDetail && (p.detailCapacity || 0) > 0) {
      const unitPrice = detailPrice(p);
      setUsed(prev => [...prev, {
        productId: p.id, productName: p.name,
        detailQty: 1, detailUnit: p.detailUnit || 'L',
        qty: 1 / (p.detailCapacity || 1),
        unitPrice, total: unitPrice,
      }]);
    } else {
      setUsed(prev => [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice: p.salePrice, total: p.salePrice }]);
    }
    setPQuery('');
  };

  /** Quantity edit — in detail units when the product is sold au détail. */
  const setQty = (productId: string, value: number) => {
    const p = products.find(x => x.id === productId);
    setUsed(prev => prev.map(u => {
      if (u.productId !== productId) return u;
      if (u.detailQty !== undefined && p?.detailCapacity) {
        const detailQty = Math.max(0, value);
        return { ...u, detailQty, qty: detailQty / p.detailCapacity, total: detailQty * u.unitPrice };
      }
      const qty = Math.max(0, value);
      return { ...u, qty, total: qty * u.unitPrice };
    }));
  };
  const rmUsed = (id: string) => setUsed(prev => prev.filter(u => u.productId !== id));
  const toggleWorker = (id: string) => setSelWorkers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const save = () => {
    const client = clients.find(c => c.id === clientId);
    const status: BizReparation['status'] = pending ? 'pending' : 'finalized';
    const prefix = repKind === 'lavage' ? 'LAV' : 'REP';
    const rep: BizReparation = {
      id: initial?.id || newId(),
      ref: initial?.ref || `${prefix}-${String(biz.state.reparations.length + 1).padStart(4, '0')}`,
      kind: repKind,
      clientId: clientId || undefined,
      clientName: client?.name || PASSAGE,
      car, serviceTotal: service, usedProducts: used, problem,
      total, paid, rest, status,
      date: initial?.date || new Date().toISOString(),
      outDate: initial?.outDate,
      workers: selWorkers,
      createdBy: initial?.createdBy || 'Admin',
      printedAt: initial?.printedAt,
      payrollSettled: initial?.payrollSettled,
    };

    if (isEdit) biz.update('reparations', rep); else biz.add('reparations', rep);

    // Stock is deducted only when the job is actually done, and only once:
    // a pending job that gets finalized deducts at that moment.
    const shouldDeduct = status === 'finalized' && (!isEdit || wasPending);
    if (shouldDeduct) {
      used.forEach(u => {
        const p = products.find(x => x.id === u.productId);
        if (p) biz.update('products', { ...p, currentQty: Math.max(0, p.currentQty - u.qty) });
      });
    }

    toast.success(status === 'pending'
      ? 'Intervention enregistrée en attente'
      : (isEdit && wasPending ? 'Intervention finalisée' : (isEdit ? 'Intervention modifiée' : 'Intervention enregistrée')));
    onSaved(rep);
  };

  const title = isEdit
    ? (wasPending ? `Finaliser ${initial!.ref}` : `Modifier ${initial!.ref}`)
    : (pending ? 'Nouvelle intervention en attente' : `Nouveau ${KIND_META[repKind].label.toLowerCase()}`);

  return (
    <>
      <Modal open onClose={onClose} icon={KIND_META[repKind].icon} size="xl" title={title}
        subtitle="Client optionnel • prestation saisie à la main • produits du stock"
        footer={<>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          {pending && (
            <button className="btn-secondary" onClick={() => { setPending(false); }}>
              <CheckCircle2 className="w-4 h-4" /> Passer en finalisé
            </button>
          )}
          <button className="btn-primary" onClick={save}>
            {pending ? 'Enregistrer en attente' : (isEdit && wasPending ? 'Finaliser' : 'Enregistrer')}
          </button>
        </>}>
        <div className="space-y-5">
          {/* Kind + status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Type d'intervention">
              <div className="flex gap-2">
                {(['lavage', 'reparation'] as const).map(k => {
                  const Icon = KIND_META[k].icon;
                  return (
                    <button key={k} onClick={() => setRepKind(k)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${repKind === k ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                      <Icon className="w-4 h-4" /> {KIND_META[k].label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Statut">
              <div className="flex gap-2">
                <button onClick={() => setPending(true)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${pending ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <Hourglass className="w-4 h-4" /> En attente
                </button>
                <button onClick={() => setPending(false)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${!pending ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <CheckCircle2 className="w-4 h-4" /> Finalisé
                </button>
              </div>
            </Field>
          </div>

          {/* Client — optional */}
          <Field label="Client (optionnel)" hint={`Laissez vide pour enregistrer au nom d'un « ${PASSAGE} ».`}>
            <div className="flex gap-2">
              <Select value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">{PASSAGE}</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}
              </Select>
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

          <Field label="Description du problème / de la prestation">
            <Textarea value={problem} onChange={e => setProblem(e.target.value)} placeholder="Décrivez le travail à réaliser…" />
          </Field>

          {/* Manual service amount */}
          <Field label="Montant de la prestation (DA)" hint="Saisissez le prix du travail réalisé.">
            <Input type="number" value={serviceTotal} onChange={e => setServiceTotal(e.target.value)} placeholder="0" />
          </Field>

          {/* Worker who did the job */}
          <div>
            <label className="label-field">Employé(s) ayant réalisé le travail</label>
            {workers.length === 0 ? (
              <p className="text-xs text-slate-400">Aucun employé enregistré dans cette partie.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {workers.map(w => {
                  const on = selWorkers.includes(w.id);
                  return (
                    <button key={w.id} onClick={() => toggleWorker(w.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${on ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                      {on && <CheckCircle2 className="w-3 h-3" />} {w.name}
                      {w.salaryType === 'pourcentage' && <span className="opacity-70">· {w.percentage || 0}%</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Used products — search by name or barcode */}
          <div>
            <label className="label-field">Produits utilisés (déduits du stock)</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={pQuery} onChange={e => setPQuery(e.target.value)}
                placeholder="Rechercher par nom ou code-barres…" className="input-field pl-9" />
              {productMatches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                  {productMatches.map(p => (
                    <button key={p.id} onClick={() => addUsed(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        {p.name}
                        {p.sellByDetail && <span className="ml-1.5 text-[10px] font-bold text-[#003087]">au détail</span>}
                      </span>
                      <span className="text-xs text-slate-400">
                        {p.sellByDetail && p.detailCapacity
                          ? `${money(detailPrice(p))}/${p.detailUnit} • stock ${p.currentQty} × ${p.detailCapacity}${p.detailUnit}`
                          : `${money(p.salePrice)} • stock ${p.currentQty}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {used.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {used.map(u => {
                  const p = products.find(x => x.id === u.productId);
                  const isDetail = u.detailQty !== undefined;
                  return (
                    <div key={u.productId} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
                      <span className="flex-1 text-sm font-semibold text-slate-700 min-w-0 truncate">
                        {u.productName}
                        {isDetail && p?.detailCapacity && (
                          <span className="ml-1 text-[10px] text-slate-400">sur {p.detailCapacity} {u.detailUnit}</span>
                        )}
                      </span>
                      <input type="number" step="0.01" min={0}
                        value={isDetail ? u.detailQty : u.qty}
                        onChange={e => setQty(u.productId, Number(e.target.value))}
                        className="input-field !py-1 !px-2 w-20 text-center" />
                      <span className="text-[11px] text-slate-400 w-8">{isDetail ? u.detailUnit : (p?.unit || 'u')}</span>
                      <span className="text-sm font-bold tabular-nums w-24 text-right">{money(u.total ?? u.qty * u.unitPrice)}</span>
                      <button onClick={() => rmUsed(u.productId)} className="text-red-500 p-1"><X className="w-4 h-4" /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="rounded-2xl bg-[#001f5c] text-white p-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-[10px] uppercase font-bold text-blue-200">Prestation</p>
                <p className="font-black tabular-nums">{money(service)}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-[10px] uppercase font-bold text-blue-200">Produits</p>
                <p className="font-black tabular-nums">{money(productsTotal)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-blue-200">Total</span>
              <span className="text-xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-blue-200">Payé</label>
                <input type="number" value={paidStr} onChange={e => setPaidStr(e.target.value)} placeholder={String(pending ? 0 : total)} className="input-field mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-blue-200">Reste</label>
                <div className="mt-1 h-[46px] rounded-xl bg-white/10 flex items-center px-4 font-black tabular-nums text-red-300">{money(rest)}</div>
              </div>
            </div>
          </div>
        </div>
      </Modal>
      <ContactModal biz={biz} coll="clients" open={showClient} onClose={() => setShowClient(false)} onSaved={c => setClientId(c.id)} />
    </>
  );
}
