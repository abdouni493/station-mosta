import React, { useMemo, useState } from 'react';
import {
  UsersRound, Plus, Phone, Eye, Edit2, Trash2, Shield, Wallet, CalendarMinus, CalendarPlus,
  Briefcase, KeyRound, Check, X, Banknote,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizWorker, MODULE_INTERFACES, INTERFACE_ACTIONS } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import {
  PageHeader, StatCard, Badge, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, Select, Switch, Textarea, InlineCreate, money, formatDate,
} from '@/src/components/biz/Kit';

export default function ModuleWorkers({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const { workers } = biz.state;
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<BizWorker | null | 'new'>(null);
  const [viewing, setViewing] = useState<BizWorker | null>(null);
  const [perms, setPerms] = useState<BizWorker | null>(null);
  const [acompte, setAcompte] = useState<BizWorker | null>(null);
  const [absence, setAbsence] = useState<BizWorker | null>(null);
  const [payment, setPayment] = useState<BizWorker | null>(null);
  const [toDelete, setToDelete] = useState<BizWorker | null>(null);

  const filtered = workers.filter(w => !search || w.name.toLowerCase().includes(search.toLowerCase()) || w.roleName.toLowerCase().includes(search.toLowerCase()));
  const del = () => { if (toDelete) { biz.remove('workers', toDelete.id); toast.success('Employé supprimé'); setToDelete(null); } };
  const totalPayroll = workers.filter(w => w.paid).reduce((s, w) => s + w.salaryAmount, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={UsersRound} title="Employés" subtitle={`${cfg.label} — personnel`}
        actions={<button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvel employé</button>} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={UsersRound} label="Employés" value={workers.length} tone="blue" />
        <StatCard icon={Briefcase} label="Salariés" value={workers.filter(w => w.paid).length} tone="green" />
        <StatCard icon={Wallet} label="Masse salariale" value={money(totalPayroll)} tone="purple" sub="/ période" />
      </div>

      <div className="card-glass p-4"><SearchInput value={search} onChange={setSearch} placeholder="Nom ou rôle…" /></div>

      {filtered.length === 0 ? <EmptyState icon={UsersRound} title="Aucun employé" action={<button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvel employé</button>} /> : (
        <CardGrid>
          {filtered.map(w => (
            <GlassCard key={w.id}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#003087] to-[#0044bb] text-white flex items-center justify-center font-black text-lg">{w.name.charAt(0)}</div>
                <div className="min-w-0"><h3 className="font-black text-slate-800 truncate">{w.name}</h3><Badge tone="primary">{w.roleName}</Badge></div>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                {w.phone && <div className="flex items-center gap-1.5 text-slate-400"><Phone className="w-3.5 h-3.5" />{w.phone}</div>}
                <div className="flex items-center justify-between"><span className="text-slate-400">Salaire</span><span className="font-bold text-slate-700 tabular-nums">{w.paid ? `${money(w.salaryAmount)} / ${w.salaryType}` : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-400">Compte</span>{w.hasAccount ? <Badge tone="success">Actif</Badge> : <Badge tone="neutral">Aucun</Badge>}</div>
                <div className="flex items-center justify-between"><span className="text-slate-400">Depuis</span><span className="text-xs text-slate-500">{formatDate(w.startDate)}</span></div>
              </div>
              <div className="grid grid-cols-4 gap-1.5 mt-3 pt-3 border-t border-slate-100">
                <MiniBtn icon={Shield} label="Perms" onClick={() => setPerms(w)} />
                <MiniBtn icon={CalendarPlus} label="Acompte" onClick={() => setAcompte(w)} />
                <MiniBtn icon={CalendarMinus} label="Absence" onClick={() => setAbsence(w)} />
                <MiniBtn icon={Banknote} label="Paie" onClick={() => setPayment(w)} />
              </div>
              <div className="flex items-center justify-end mt-2">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(w)} />
                  <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setForm(w)} />
                  <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(w)} />
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      )}

      {form && <WorkerForm moduleKey={moduleKey} initial={form === 'new' ? null : form} onClose={() => setForm(null)} />}
      {viewing && <ViewWorker worker={viewing} onClose={() => setViewing(null)} />}
      {perms && <PermsModal moduleKey={moduleKey} worker={perms} onClose={() => setPerms(null)} />}
      {acompte && <AcompteModal moduleKey={moduleKey} worker={acompte} onClose={() => setAcompte(null)} />}
      {absence && <AbsenceModal moduleKey={moduleKey} worker={absence} onClose={() => setAbsence(null)} />}
      {payment && <PaymentModal moduleKey={moduleKey} worker={payment} onClose={() => setPayment(null)} />}
      <Confirm open={!!toDelete} title="Supprimer l'employé" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function MiniBtn({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex flex-col items-center gap-1 py-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
    <Icon className="w-4 h-4" /><span className="text-[9px] font-bold">{label}</span></button>;
}

// ─── Worker form ─────────────────────────────────────────────────────────────
function WorkerForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizWorker | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { roles } = biz.state;
  const isEdit = !!initial;
  const [f, setF] = useState<Partial<BizWorker>>(initial || {
    name: '', birthday: '', cin: '', phone: '', roleName: '', paid: true, salaryType: 'mois', salaryAmount: 0,
    hasAccount: false, email: '', username: '', password: '', startDate: new Date().toISOString().split('T')[0],
  });
  const [showRole, setShowRole] = useState(false);
  const set = (k: keyof BizWorker, v: any) => setF(p => ({ ...p, [k]: v }));

  const save = () => {
    if (!f.name?.trim()) { toast.error('Nom requis'); return; }
    if (!f.roleName) { toast.error('Rôle requis'); return; }
    const worker: BizWorker = {
      id: initial?.id || newId(), name: f.name!.trim(), birthday: f.birthday, cin: f.cin, phone: f.phone,
      roleName: f.roleName!, paid: !!f.paid, salaryType: (f.salaryType as any) || 'mois', salaryAmount: Number(f.salaryAmount) || 0,
      hasAccount: !!f.hasAccount, email: f.email, username: f.username, password: f.password,
      startDate: f.startDate || new Date().toISOString().split('T')[0],
      permissions: initial?.permissions || {}, acomptes: initial?.acomptes || [], absences: initial?.absences || [], payments: initial?.payments || [],
      createdAt: initial?.createdAt || new Date().toISOString(),
    };
    if (isEdit) biz.update('workers', worker); else biz.add('workers', worker);
    toast.success(isEdit ? 'Employé modifié' : 'Employé créé — programmez ses permissions');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={UsersRound} size="lg" title={isEdit ? 'Modifier l\'employé' : 'Nouvel employé'} subtitle="Informations & compte"
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Créer'}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Field label="Nom complet" required><Input value={f.name || ''} onChange={e => set('name', e.target.value)} /></Field></div>
        <Field label="Date de naissance"><Input type="date" value={f.birthday || ''} onChange={e => set('birthday', e.target.value)} /></Field>
        <Field label="N° carte d'identité"><Input value={f.cin || ''} onChange={e => set('cin', e.target.value)} placeholder="Optionnel" /></Field>
        <Field label="Téléphone"><Input value={f.phone || ''} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Rôle" required>
          <div className="flex gap-2">
            <Select value={f.roleName || ''} onChange={e => set('roleName', e.target.value)}><option value="">— Sélectionner —</option>{roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}</Select>
            <button className="btn-secondary !px-3 shrink-0" onClick={() => setShowRole(s => !s)}>+</button>
          </div>
          {showRole && <div className="mt-2"><InlineCreate placeholder="Nouveau rôle" onCreate={n => { biz.add('roles', { id: newId(), name: n }); set('roleName', n); setShowRole(false); }} /></div>}
        </Field>
        <div className="sm:col-span-2"><Field label="Date de début de travail"><Input type="date" value={f.startDate || ''} onChange={e => set('startDate', e.target.value)} /></Field></div>

        <div className="sm:col-span-2 rounded-xl bg-slate-50 border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-bold text-slate-700">Rémunération</p><p className="text-xs text-slate-400">Cet employé perçoit-il un salaire ?</p></div>
            <Switch checked={!!f.paid} onChange={v => set('paid', v)} />
          </div>
          {f.paid && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Type"><Select value={f.salaryType || 'mois'} onChange={e => set('salaryType', e.target.value)}><option value="mois">Mensuel</option><option value="jour">Journalier</option></Select></Field>
              <Field label="Montant (DA)"><Input type="number" value={f.salaryAmount ?? 0} onChange={e => set('salaryAmount', e.target.value)} /></Field>
            </div>
          )}
        </div>

        <div className="sm:col-span-2 rounded-xl bg-slate-50 border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-bold text-slate-700">Compte de connexion</p><p className="text-xs text-slate-400">Autoriser la connexion à l'application</p></div>
            <Switch checked={!!f.hasAccount} onChange={v => set('hasAccount', v)} />
          </div>
          {f.hasAccount && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Email"><Input type="email" value={f.email || ''} onChange={e => set('email', e.target.value)} /></Field>
              <Field label="Nom d'utilisateur"><Input value={f.username || ''} onChange={e => set('username', e.target.value)} /></Field>
              <Field label="Mot de passe"><Input type="password" value={f.password || ''} onChange={e => set('password', e.target.value)} /></Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ViewWorker({ worker, onClose }: { worker: BizWorker; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} icon={Eye} size="md" title={worker.name} subtitle={worker.roleName}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {[['Rôle', worker.roleName], ['Téléphone', worker.phone || '—'], ['Naissance', worker.birthday ? formatDate(worker.birthday) : '—'],
        ['CIN', worker.cin || '—'], ['Salaire', worker.paid ? `${money(worker.salaryAmount)} / ${worker.salaryType}` : '—'],
        ['Compte', worker.hasAccount ? 'Actif' : 'Aucun'], ['Début', formatDate(worker.startDate)], ['Acomptes', String(worker.acomptes.length)]].map(([k, v]) => (
          <div key={k as string} className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">{k}</p><p className="font-bold text-slate-700">{v}</p></div>
        ))}
      </div>
    </Modal>
  );
}

// ─── Permissions ────────────────────────────────────────────────────────────
function PermsModal({ moduleKey, worker, onClose }: { moduleKey: ModuleKey; worker: BizWorker; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const [perms, setPerms] = useState<Record<string, boolean>>(worker.permissions || {});
  const key = (iface: string, action: string) => `${iface}.${action}`;
  const ifaceOn = (iface: string) => INTERFACE_ACTIONS.some(a => perms[key(iface, a)]);
  const toggleIface = (iface: string) => {
    const on = perms[key(iface, 'voir')];
    setPerms(p => ({ ...p, [key(iface, 'voir')]: !on }));
  };
  const toggleAction = (iface: string, action: string) => setPerms(p => ({ ...p, [key(iface, action)]: !p[key(iface, action)] }));
  const save = () => { biz.update('workers', { ...worker, permissions: perms }); toast.success('Permissions enregistrées'); onClose(); };

  return (
    <Modal open onClose={onClose} icon={Shield} size="lg" title="Permissions" subtitle={worker.name}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>Enregistrer</button></>}>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
        {MODULE_INTERFACES.map(iface => {
          const visible = !!perms[key(iface.id, 'voir')];
          return (
            <div key={iface.id} className="rounded-xl border border-slate-200 overflow-hidden">
              <button onClick={() => toggleIface(iface.id)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                <span className="font-bold text-sm text-slate-700">{iface.label}</span>
                <span className={`w-9 h-5 rounded-full relative transition-colors ${visible ? 'bg-[#003087]' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${visible ? 'left-[18px]' : 'left-0.5'}`} /></span>
              </button>
              {visible && (
                <div className="px-4 py-2 bg-slate-50 flex flex-wrap gap-2 border-t border-slate-100">
                  {INTERFACE_ACTIONS.filter(a => a !== 'voir').map(a => (
                    <button key={a} onClick={() => toggleAction(iface.id, a)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold capitalize flex items-center gap-1 ${perms[key(iface.id, a)] ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-slate-400 border border-slate-200'}`}>
                      {perms[key(iface.id, a)] ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} {a}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ─── Acompte ──────────────────────────────────────────────────────────────────
function AcompteModal({ moduleKey, worker, onClose }: { moduleKey: ModuleKey; worker: BizWorker; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const add = () => {
    if (amount <= 0) return;
    const updated = { ...worker, acomptes: [{ id: newId(), date, amount, description, paid: false }, ...worker.acomptes] };
    biz.update('workers', updated); toast.success('Acompte ajouté'); setAmount(0); setDescription('');
  };
  const remove = (id: string) => biz.update('workers', { ...worker, acomptes: worker.acomptes.filter(a => a.id !== id) });

  return (
    <Modal open onClose={onClose} icon={CalendarPlus} size="md" title="Acomptes" subtitle={worker.name}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Montant (DA)"><Input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} /></Field>
          <div className="col-span-2"><Field label="Description"><Input value={description} onChange={e => setDescription(e.target.value)} /></Field></div>
        </div>
        <button className="btn-primary w-full" onClick={add}><Plus className="w-4 h-4" /> Ajouter l'acompte</button>
        <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
          {worker.acomptes.length === 0 ? <p className="text-center text-slate-400 text-sm py-4">Aucun acompte</p> : worker.acomptes.map(a => (
            <div key={a.id} className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
              <div><p className="font-bold text-slate-700 tabular-nums">{money(a.amount)}</p><p className="text-xs text-slate-400">{formatDate(a.date)} • {a.description || '—'}</p></div>
              <div className="flex items-center gap-2">{a.paid ? <Badge tone="success">Décompté</Badge> : <Badge tone="warning">En attente</Badge>}
                <button onClick={() => remove(a.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg"><Trash2 className="w-4 h-4" /></button></div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── Absence ──────────────────────────────────────────────────────────────────
function AbsenceModal({ moduleKey, worker, onClose }: { moduleKey: ModuleKey; worker: BizWorker; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [cost, setCost] = useState(0);
  const [description, setDescription] = useState('');
  const add = () => {
    const updated = { ...worker, absences: [{ id: newId(), date, cost, description, paid: false }, ...worker.absences] };
    biz.update('workers', updated); toast.success('Absence ajoutée'); setCost(0); setDescription('');
  };
  const remove = (id: string) => biz.update('workers', { ...worker, absences: worker.absences.filter(a => a.id !== id) });
  return (
    <Modal open onClose={onClose} icon={CalendarMinus} size="md" title="Absences" subtitle={worker.name}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Coût / retenue (DA)"><Input type="number" value={cost} onChange={e => setCost(Number(e.target.value))} /></Field>
          <div className="col-span-2"><Field label="Description"><Input value={description} onChange={e => setDescription(e.target.value)} /></Field></div>
        </div>
        <button className="btn-primary w-full" onClick={add}><Plus className="w-4 h-4" /> Ajouter l'absence</button>
        <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
          {worker.absences.length === 0 ? <p className="text-center text-slate-400 text-sm py-4">Aucune absence</p> : worker.absences.map(a => (
            <div key={a.id} className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
              <div><p className="font-bold text-red-600 tabular-nums">-{money(a.cost)}</p><p className="text-xs text-slate-400">{formatDate(a.date)} • {a.description || '—'}</p></div>
              <button onClick={() => remove(a.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── Payment ──────────────────────────────────────────────────────────────────
function PaymentModal({ moduleKey, worker, onClose }: { moduleKey: ModuleKey; worker: BizWorker; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const base = worker.salaryAmount;
  const acomptesDue = worker.acomptes.filter(a => !a.paid).reduce((s, a) => s + a.amount, 0);
  const absencesDue = worker.absences.filter(a => !a.paid).reduce((s, a) => s + a.cost, 0);
  const computedNet = Math.max(0, base - acomptesDue - absencesDue);
  const [net, setNet] = useState(computedNet);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const period = new Date().toLocaleString('fr-DZ', { month: 'long', year: 'numeric' });

  const pay = () => {
    const updated: BizWorker = {
      ...worker,
      acomptes: worker.acomptes.map(a => a.paid ? a : { ...a, paid: true }),
      absences: worker.absences.map(a => a.paid ? a : { ...a, paid: true }),
      payments: [{ id: newId(), period, amount: net, date, description }, ...worker.payments],
    };
    biz.update('workers', updated);
    toast.success('Paiement enregistré'); onClose();
  };

  return (
    <Modal open onClose={onClose} icon={Banknote} size="md" title="Paiement du salaire" subtitle={`${worker.name} — ${period}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={pay}>Enregistrer le paiement</button></>}>
      <div className="space-y-4">
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Salaire de base ({worker.salaryType})</span><span className="font-bold tabular-nums">{money(base)}</span></div>
          <div className="flex items-center justify-between rounded-xl bg-amber-50 p-3"><span className="text-amber-600">− Acomptes non décomptés</span><span className="font-bold tabular-nums text-amber-700">{money(acomptesDue)}</span></div>
          <div className="flex items-center justify-between rounded-xl bg-red-50 p-3"><span className="text-red-600">− Absences / retenues</span><span className="font-bold tabular-nums text-red-700">{money(absencesDue)}</span></div>
        </div>
        <Field label="Net à payer (DA) — modifiable"><Input type="number" value={net} onChange={e => setNet(Number(e.target.value))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date de paiement"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Description (optionnel)"><Input value={description} onChange={e => setDescription(e.target.value)} /></Field>
        </div>
        <div className="rounded-2xl bg-[#001f5c] text-white p-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-blue-200">Net à payer</span><span className="text-2xl font-black tabular-nums text-[#FFB800]">{money(net)}</span>
        </div>
        {worker.payments.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase text-slate-400">Historique</p>
            {worker.payments.slice(0, 3).map(p => <div key={p.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg p-2"><span>{p.period} • {formatDate(p.date)}</span><span className="font-bold tabular-nums">{money(p.amount)}</span></div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}
