/**
 * ─── Demandes d'encaissement (Lavage & Réparation) ──────────────────────────────
 * Un laveur qui n'encaisse pas lui-même envoie ici, à l'administrateur ou à
 * l'employé de caisse, le montant qu'un client doit payer, avec le nom du client
 * et les informations de son véhicule. La caisse voit la liste des demandes en
 * attente et les marque « encaissée » une fois l'argent reçu.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  BellRing, Plus, Car, User, Check, X, Clock, Wallet, Trash2, CircleDollarSign,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizPayRequest, BizCar } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, Textarea, Select,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';

const STATUS_META: Record<BizPayRequest['status'], { label: string; tone: any }> = {
  pending: { label: 'En attente', tone: 'warning' },
  collected: { label: 'Encaissée', tone: 'success' },
  canceled: { label: 'Annulée', tone: 'danger' },
};

export default function ModuleEncaissements({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'encaissements');
  const { currentUserName, currentModuleWorker } = useAppState();
  const { payRequests, workers } = biz.state;

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | BizPayRequest['status']>('pending');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<BizPayRequest | null>(null);

  const filtered = useMemo(() => [...payRequests].filter(r => {
    const q = search.trim().toLowerCase();
    const matchQ = !q
      || r.clientName.toLowerCase().includes(q)
      || (r.car?.immatriculation || '').toLowerCase().includes(q)
      || r.workerName.toLowerCase().includes(q)
      || r.ref.toLowerCase().includes(q);
    return matchQ && (status === 'all' || r.status === status) && inPeriod(r.createdAt, period, from, to);
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [payRequests, search, status, period, from, to]);

  const stats = useMemo(() => {
    const pend = payRequests.filter(r => r.status === 'pending');
    const coll = payRequests.filter(r => r.status === 'collected');
    return {
      pending: pend.length,
      pendingAmount: pend.reduce((s, r) => s + r.amount, 0),
      collected: coll.length,
      collectedAmount: coll.reduce((s, r) => s + r.amount, 0),
    };
  }, [payRequests]);

  const collect = (r: BizPayRequest) => {
    biz.update('payRequests', {
      ...r, status: 'collected',
      collectedAt: new Date().toISOString(),
      collectedBy: currentUserName || 'Caisse',
    });
    toast.success('Encaissement confirmé');
  };
  const cancel = (r: BizPayRequest) => {
    biz.update('payRequests', { ...r, status: 'canceled' });
    toast.success('Demande annulée');
  };
  const del = () => { if (toDelete) { biz.remove('payRequests', toDelete.id); toast.success('Demande supprimée'); setToDelete(null); } };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={BellRing} title="Demandes d'encaissement" subtitle={`${cfg.label} — du laveur vers la caisse`}
        actions={perm.creer
          ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nouvelle demande</button>
          : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Clock} label="En attente" value={stats.pending} tone="amber" />
        <StatCard icon={CircleDollarSign} label="Montant en attente" value={money(stats.pendingAmount)} tone="red" />
        <StatCard icon={Check} label="Encaissées" value={stats.collected} tone="green" />
        <StatCard icon={Wallet} label="Montant encaissé" value={money(stats.collectedAmount)} tone="blue" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Client, immatriculation, employé…" />
          <div className="flex gap-1.5">
            {(['pending', 'collected', 'canceled', 'all'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${status === s ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                {s === 'all' ? 'Toutes' : STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={BellRing} title="Aucune demande"
          message="Le laveur crée une demande avec le montant à encaisser, le nom du client et son véhicule." />
      ) : (
        <CardGrid>
          {filtered.map(r => (
            <GlassCard key={r.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-800">{r.ref}</h3>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><User className="w-3 h-3" />{r.clientName}</p>
                </div>
                <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
              </div>
              {(r.car?.marque || r.car?.name || r.car?.immatriculation) && (
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <Car className="w-3 h-3" />{[r.car.marque, r.car.name, r.car.color, r.car.immatriculation].filter(Boolean).join(' • ')}
                </p>
              )}
              {r.description && <p className="text-xs text-slate-500 mt-2">{r.description}</p>}
              <div className="rounded-xl bg-[#001f5c] text-white p-3 mt-3 flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-blue-200">À encaisser</span>
                <span className="font-black tabular-nums text-[#FFB800]">{money(r.amount)}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Par {r.workerName} • {formatDate(r.createdAt)}
                {r.collectedAt && <> • encaissé par {r.collectedBy} le {formatDate(r.collectedAt)}</>}
              </p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                {r.status === 'pending' && perm.modifier ? (
                  <div className="flex gap-2">
                    <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => collect(r)}>
                      <Check className="w-4 h-4" /> Encaisser
                    </button>
                    <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => cancel(r)}>
                      <X className="w-4 h-4" /> Annuler
                    </button>
                  </div>
                ) : <span />}
                <RowActions>
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(r)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      )}

      {creating && (
        <RequestForm
          moduleKey={moduleKey}
          defaultWorkerId={currentModuleWorker?.moduleKey === moduleKey
            ? workers.find(w => w.name === currentModuleWorker?.name)?.id
            : undefined}
          defaultWorkerName={currentModuleWorker?.name || currentUserName}
          onClose={() => setCreating(false)}
        />
      )}
      <Confirm open={!!toDelete} title="Supprimer la demande"
        message={`Supprimer la demande ${toDelete?.ref} ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function RequestForm({
  moduleKey, defaultWorkerId, defaultWorkerName, onClose,
}: {
  moduleKey: ModuleKey; defaultWorkerId?: string; defaultWorkerName?: string; onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const { workers, payRequests } = biz.state;

  const [clientName, setClientName] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [workerId, setWorkerId] = useState(defaultWorkerId || '');
  const [car, setCar] = useState<BizCar>({});

  const value = Number(amount) || 0;

  const save = () => {
    if (value <= 0) { toast.error('Montant requis'); return; }
    const worker = workers.find(w => w.id === workerId);
    const req: BizPayRequest = {
      id: newId(),
      ref: `ENC-${String(payRequests.length + 1).padStart(4, '0')}`,
      clientName: clientName.trim() || 'Client de passage',
      car, amount: value,
      description: description.trim() || undefined,
      workerId: workerId || undefined,
      workerName: worker?.name || defaultWorkerName || 'Employé',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    biz.add('payRequests', req);
    toast.success('Demande envoyée à la caisse');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={BellRing} size="lg"
      title="Nouvelle demande d'encaissement"
      subtitle="Montant à encaisser, client et véhicule"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={value <= 0}>Envoyer à la caisse</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Montant à encaisser (DA)" required>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Employé demandeur">
            <Select value={workerId} onChange={e => setWorkerId(e.target.value)}>
              <option value="">{defaultWorkerName || '— Sélectionner —'}</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Nom du client" hint="Laissez vide pour « Client de passage ».">
          <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nom du client" />
        </Field>
        <div>
          <label className="label-field">Informations du véhicule</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Input placeholder="Nom / modèle" value={car.name || ''} onChange={e => setCar({ ...car, name: e.target.value })} />
            <Input placeholder="Marque" value={car.marque || ''} onChange={e => setCar({ ...car, marque: e.target.value })} />
            <Input placeholder="Couleur" value={car.color || ''} onChange={e => setCar({ ...car, color: e.target.value })} />
            <Input placeholder="Année" value={car.year || ''} onChange={e => setCar({ ...car, year: e.target.value })} />
            <Input placeholder="Immatriculation" value={car.immatriculation || ''} onChange={e => setCar({ ...car, immatriculation: e.target.value })} />
          </div>
        </div>
        <Field label="Détail de la prestation">
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: lavage complet + aspiration" />
        </Field>
      </div>
    </Modal>
  );
}
