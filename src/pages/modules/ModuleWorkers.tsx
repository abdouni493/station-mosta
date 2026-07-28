import React, { useMemo, useState } from 'react';
import {
  UsersRound, Plus, Eye, Edit2, Trash2, Shield, Wallet, CalendarMinus, CalendarPlus,
  Briefcase, Check, X, Banknote, MoreVertical, Lock, Zap, Loader, MapIcon, Printer,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'react-hot-toast';
import { cn, newId } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizWorker, BizWorkerPayment, BizReparation, BizWorkerKind,
  WORKER_KIND_META, INTERFACE_ACTIONS, interfacesForModule, workerShareOf, prestationsOf,
} from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import { provisionModuleWorkerAccount, saveModuleWorkerPermissions } from '@/src/lib/supabase';
import { printInvoice, stationFromSettings } from './_shared';
import {
  PageHeader, StatCard, SearchInput, EmptyState,
  Confirm, Modal, Field, Input, Select, Switch, InlineCreate, money, formatDate,
} from '@/src/components/biz/Kit';

// Same rule as the fuel-station worker pages: 3-32 chars, lowercase, digits, . _ -
const USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;

export default function ModuleWorkers({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'workers');
  const { workers } = biz.state;
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | BizWorkerKind>('all');
  const [form, setForm] = useState<BizWorker | null | 'new'>(null);
  const [viewing, setViewing] = useState<BizWorker | null>(null);
  const [perms, setPerms] = useState<BizWorker | null>(null);
  const [acompte, setAcompte] = useState<BizWorker | null>(null);
  const [absence, setAbsence] = useState<BizWorker | null>(null);
  const [payment, setPayment] = useState<BizWorker | null>(null);
  const [printing, setPrinting] = useState<BizWorker | null>(null);
  const [toDelete, setToDelete] = useState<BizWorker | null>(null);
  const [activating, setActivating] = useState<BizWorker | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const currentMonth = new Date().toISOString().slice(0, 7);

  // The speciality only exists on the Lavage & Réparation part.
  const hasKinds = cfg.isService;
  const filtered = workers.filter(w => {
    const q = search.trim().toLowerCase();
    const matchQ = !q || w.name.toLowerCase().includes(q) || w.roleName.toLowerCase().includes(q);
    const kind = w.workerKind || 'both';
    // A polyvalent employee belongs to both the "lavage" and the "réparation" filters.
    const matchKind = !hasKinds || kindFilter === 'all' || kind === kindFilter || kind === 'both';
    return matchQ && matchKind;
  });

  const del = async () => {
    if (!toDelete) return;
    if (toDelete.hasAccount) {
      // Remove the login account too, otherwise it would keep working.
      const res = await provisionModuleWorkerAccount({
        action: 'delete', moduleKey, workerId: toDelete.id,
      });
      if (!res.ok) toast.error(`Compte non supprimé : ${res.error}`);
    }
    biz.remove('workers', toDelete.id);
    toast.success('Employé supprimé');
    setToDelete(null);
  };

  // Percentage-paid workers have no fixed salary — their due is computed from
  // the interventions they performed (see `pendingWorksFor`).
  const totalPayroll = workers
    .filter(w => w.paid && w.salaryType !== 'pourcentage')
    .reduce((s, w) => s + w.salaryAmount, 0);
  const withAccount = workers.filter(w => w.hasAccount && w.authUserId).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={UsersRound} title="Employés" subtitle={`${cfg.label} — personnel`}
        actions={perm.creer
          ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvel employé</button>
          : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={UsersRound} label="Employés" value={workers.length} tone="blue" />
        <StatCard icon={Briefcase} label="Salariés" value={workers.filter(w => w.paid).length} tone="green" />
        <StatCard icon={Lock} label="Comptes actifs" value={withAccount} tone="amber" sub="peuvent se connecter" />
        <StatCard icon={Wallet} label="Masse salariale" value={money(totalPayroll)} tone="purple" sub="/ période" />
      </div>

      <div className="card-glass p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom ou rôle…" />
        {hasKinds && (
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'lavage', 'reparation', 'both'] as const).map(k => (
              <button key={k} onClick={() => setKindFilter(k)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  kindFilter === k ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
                {k === 'all' ? 'Tous' : WORKER_KIND_META[k].short}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={UsersRound} title="Aucun employé"
          action={perm.creer ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvel employé</button> : undefined} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(w => {
            const unpaidAcomptes = (w.acomptes || []).filter(a => !a.paid).reduce((s, a) => s + a.amount, 0);
            const isMonthPaid = (w.payments || []).some(p => (p.date || '').startsWith(currentMonth));
            const isActive = w.hasAccount ? !!w.authUserId : true;

            return (
              <motion.div
                key={w.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={cn(
                  'group relative bg-white rounded-3xl border hover:shadow-2xl transition-all p-6 space-y-4 italic flex flex-col',
                  menuOpen === w.id ? 'z-50 border-blue-300 ring-4 ring-blue-50 shadow-xl' : 'z-10 border-slate-100 hover:border-blue-200 shadow-sm',
                )}
              >
                {/* Gradient top border */}
                <div className={cn('h-2 absolute top-0 left-0 right-0 rounded-t-3xl',
                  isActive ? 'bg-gradient-to-r from-blue-900 via-blue-800 to-yellow-400' : 'bg-slate-300')} />

                {/* Status pill */}
                <div className="absolute top-4 left-4">
                  <span className={cn('text-[9px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm',
                    w.paid ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600')}>
                    {w.paid ? 'Salarié' : 'Non salarié'}
                  </span>
                </div>

                {/* Actions menu */}
                <div className="absolute top-4 right-4">
                  <motion.button
                    onClick={() => setMenuOpen(menuOpen === w.id ? null : w.id)}
                    whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
                    className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 group-hover:text-primary transition-all bg-white/80 backdrop-blur-sm shadow-sm border border-slate-100"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </motion.button>

                  <AnimatePresence>
                    {menuOpen === w.id && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-56 bg-white border border-slate-100 rounded-2xl shadow-2xl z-[60] overflow-hidden"
                      >
                        <div className="divide-y divide-slate-100">
                          <MenuItem icon={Eye} tone="text-slate-500" label="Voir Détails" onClick={() => { setViewing(w); setMenuOpen(null); }} />
                          {perm.modifier && <MenuItem icon={Edit2} tone="text-blue-500" label="Modifier" onClick={() => { setForm(w); setMenuOpen(null); }} />}
                          <MenuItem icon={CalendarPlus} tone="text-amber-500" label="Acompte" onClick={() => { setAcompte(w); setMenuOpen(null); }} />
                          <MenuItem icon={CalendarMinus} tone="text-orange-500" label="Absence" onClick={() => { setAbsence(w); setMenuOpen(null); }} />
                          <MenuItem icon={Banknote} tone="text-green-600" label="Paiement" onClick={() => { setPayment(w); setMenuOpen(null); }} />
                          <MenuItem icon={Printer} tone="text-slate-600" label="Imprimer les paiements" onClick={() => { setPrinting(w); setMenuOpen(null); }} />
                          {perm.modifier && <MenuItem icon={Shield} tone="text-red-500" label="Permissions" onClick={() => { setPerms(w); setMenuOpen(null); }} />}
                          {perm.supprimer && <MenuItem icon={Trash2} tone="text-red-600" label="Supprimer" danger onClick={() => { setToDelete(w); setMenuOpen(null); }} />}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Avatar & identity */}
                <div className="flex flex-col items-center text-center gap-4 pt-4">
                  <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg',
                    isActive ? 'bg-gradient-to-br from-blue-900 to-blue-800 text-yellow-400' : 'bg-slate-300 text-white')}>
                    {w.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="font-black text-blue-900 uppercase tracking-tight text-sm mb-1">{w.name}</p>
                    <p className="text-[10px] text-slate-500 font-bold">{w.cin ? `CIN: ${w.cin}` : (w.phone || '—')}</p>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <span className="text-[9px] font-bold px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full flex items-center gap-1 italic">
                    <MapIcon className="w-3 h-3" /> {w.roleName}
                  </span>
                  {hasKinds && (
                    <span className={cn('text-[9px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 italic',
                      (w.workerKind || 'both') === 'lavage' ? 'bg-cyan-100 text-cyan-700'
                        : (w.workerKind || 'both') === 'reparation' ? 'bg-orange-100 text-orange-700'
                          : 'bg-violet-100 text-violet-700')}>
                      {(w.workerKind || 'both') === 'lavage' ? '🧽' : (w.workerKind || 'both') === 'reparation' ? '🔧' : '🧽🔧'}
                      {' '}{WORKER_KIND_META[w.workerKind || 'both'].short}
                    </span>
                  )}
                  {w.salaryType === 'pourcentage' && (
                    <span className="text-[9px] font-bold px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full italic">
                      {w.percentage || 0}% des travaux
                    </span>
                  )}
                  {w.hasAccount && w.authUserId && (
                    <span className="text-[9px] font-bold px-2.5 py-1 bg-green-100 text-green-700 rounded-full flex items-center gap-1 italic">
                      <Lock className="w-3 h-3" /> Compte actif
                    </span>
                  )}
                  {w.hasAccount && !w.authUserId && w.username && (
                    <button
                      onClick={() => setActivating(w)}
                      className="text-[9px] font-bold px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full flex items-center gap-1 italic hover:bg-amber-200 transition-colors"
                    >
                      <Zap className="w-3 h-3" /> Activer
                    </button>
                  )}
                  {!w.hasAccount && (
                    <span className="text-[9px] font-bold px-2.5 py-1 bg-slate-100 text-slate-500 rounded-full flex items-center gap-1 italic">
                      <Lock className="w-3 h-3" /> Aucun compte
                    </span>
                  )}
                </div>

                {/* Key metrics */}
                <div className="pt-4 mt-auto border-t border-slate-100 grid grid-cols-3 gap-2">
                  <div className="text-center bg-slate-50/50 rounded-xl p-2 border border-slate-100">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Salaire</p>
                    <p className="text-[10px] font-black text-blue-900 italic">{w.paid ? `${w.salaryAmount.toLocaleString()} DA` : '—'}</p>
                  </div>
                  <div className="text-center bg-red-50/50 rounded-xl p-2 border border-red-100">
                    <p className="text-[8px] font-black text-red-400 uppercase tracking-widest mb-1">Acomptes</p>
                    <p className="text-[10px] font-black text-red-600 italic">{unpaidAcomptes.toLocaleString()} DA</p>
                  </div>
                  <div className="text-center bg-slate-50/50 rounded-xl p-2 border border-slate-100 flex flex-col justify-center items-center">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Ce Mois</p>
                    <span className={cn('text-[8px] font-black uppercase px-2 py-0.5 rounded-full italic shadow-sm',
                      isMonthPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                      {isMonthPaid ? 'Payé' : 'à Payer'}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {form && <WorkerForm moduleKey={moduleKey} initial={form === 'new' ? null : form} onClose={() => setForm(null)} />}
      {viewing && <ViewWorker worker={viewing} onClose={() => setViewing(null)} />}
      {perms && <PermsModal moduleKey={moduleKey} worker={perms} onClose={() => setPerms(null)} />}
      {acompte && <AcompteModal moduleKey={moduleKey} worker={acompte} onClose={() => setAcompte(null)} />}
      {absence && <AbsenceModal moduleKey={moduleKey} worker={absence} onClose={() => setAbsence(null)} />}
      {payment && <PaymentModal moduleKey={moduleKey} worker={payment} onClose={() => setPayment(null)} />}
      {printing && <PrintPaymentsModal moduleKey={moduleKey} worker={printing} onClose={() => setPrinting(null)} />}
      {activating && <ActivateModal moduleKey={moduleKey} worker={activating} onClose={() => setActivating(null)} />}
      <Confirm open={!!toDelete} title="Supprimer l'employé" message={`Supprimer « ${toDelete?.name} » ? Son compte de connexion sera également supprimé.`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function MenuItem({ icon: Icon, label, tone, onClick, danger }: {
  icon: React.ElementType; label: string; tone: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={cn('w-full px-4 py-3 text-left text-sm font-bold flex items-center gap-3 transition-colors',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50')}>
      <Icon className={cn('w-4 h-4', tone)} /> {label}
    </button>
  );
}

// ─── Worker form ─────────────────────────────────────────────────────────────
function WorkerForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizWorker | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { roles } = biz.state;
  const isEdit = !!initial;
  // Only the Lavage & Réparation part splits its staff by speciality.
  const hasKinds = MODULES[moduleKey].isService;
  const [f, setF] = useState<Partial<BizWorker>>(initial || {
    name: '', birthday: '', cin: '', phone: '', roleName: '', paid: true, salaryType: 'mois', salaryAmount: 0, percentage: 0,
    workerKind: 'lavage',
    hasAccount: false, email: '', username: '', password: '', startDate: new Date().toISOString().split('T')[0],
  });
  const [showRole, setShowRole] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof BizWorker, v: any) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name?.trim()) { toast.error('Nom requis'); return; }
    if (!f.roleName) { toast.error('Rôle requis'); return; }

    const username = (f.username || '').trim().toLowerCase();
    if (f.hasAccount) {
      if (!username) { toast.error("Nom d'utilisateur requis pour le compte de connexion"); return; }
      if (!USERNAME_REGEX.test(username)) {
        toast.error('Identifiant invalide (3-32 caractères : minuscules, chiffres, . _ -)');
        return;
      }
      if (!initial?.authUserId && !f.password) { toast.error('Mot de passe requis pour créer le compte'); return; }
      if (f.password && f.password.length < 6) { toast.error('Mot de passe : 6 caractères minimum'); return; }
    }

    const workerId = initial?.id || newId();
    let authUserId = initial?.authUserId;
    let hasAccount = !!f.hasAccount;

    setSaving(true);
    if (f.hasAccount) {
      // Creates the auth.users row (or updates the password of an existing one)
      // so this employee can sign in with their username/email + password.
      const res = await provisionModuleWorkerAccount({
        action: initial?.authUserId ? 'update_password' : 'create',
        moduleKey,
        workerId,
        username,
        password: f.password || undefined,
        name: f.name!.trim(),
        email: f.email || undefined,
        roleName: f.roleName,
        phone: f.phone,
        permissions: initial?.permissions || {},
      });
      if (res.ok) {
        authUserId = res.auth_user_id ?? authUserId;
      } else {
        hasAccount = false;
        toast.error(`Compte de connexion non créé : ${res.error}`);
      }
    } else if (initial?.authUserId) {
      const res = await provisionModuleWorkerAccount({ action: 'delete', moduleKey, workerId });
      if (res.ok) authUserId = undefined;
      else toast.error(`Compte non supprimé : ${res.error}`);
    }
    setSaving(false);

    const worker: BizWorker = {
      id: workerId, authUserId, name: f.name!.trim(), birthday: f.birthday, cin: f.cin, phone: f.phone,
      roleName: f.roleName!,
      workerKind: hasKinds ? ((f.workerKind as BizWorkerKind) || 'both') : initial?.workerKind,
      paid: !!f.paid, salaryType: (f.salaryType as any) || 'mois', salaryAmount: Number(f.salaryAmount) || 0,
      percentage: f.salaryType === 'pourcentage' ? Number(f.percentage) || 0 : undefined,
      hasAccount, email: f.email, username: username || undefined, password: f.password,
      startDate: f.startDate || new Date().toISOString().split('T')[0],
      permissions: initial?.permissions || {}, acomptes: initial?.acomptes || [], absences: initial?.absences || [], payments: initial?.payments || [],
      createdAt: initial?.createdAt || new Date().toISOString(),
    };
    if (isEdit) biz.update('workers', worker); else biz.add('workers', worker);
    toast.success(isEdit
      ? 'Employé modifié'
      : (hasAccount ? 'Employé créé — compte de connexion actif, programmez ses permissions' : 'Employé créé — programmez ses permissions'));
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={UsersRound} size="lg" title={isEdit ? "Modifier l'employé" : 'Nouvel employé'} subtitle="Informations & compte"
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving && <Loader className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Enregistrer' : 'Créer'}
        </button>
      </>}>
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
        {hasKinds && (
          <div className="sm:col-span-2 rounded-xl border border-slate-200 p-4"
            style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.06), rgba(249,115,22,0.06))' }}>
            <p className="text-sm font-bold text-[#002d87]">Type d'employé</p>
            <p className="text-xs text-slate-500 mb-3">
              Détermine sur quelles prestations cet employé est proposé lors de la création d'une intervention.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(['lavage', 'reparation', 'both'] as const).map(k => {
                const on = (f.workerKind || 'both') === k;
                return (
                  <button key={k} onClick={() => set('workerKind', k)}
                    className={cn('rounded-xl border-2 px-3 py-3 text-left transition-all',
                      on ? 'border-[#003087] bg-white shadow-sm' : 'border-slate-200 bg-white/60 hover:border-slate-300')}>
                    <p className="text-lg leading-none">{k === 'lavage' ? '🧽' : k === 'reparation' ? '🔧' : '🧽🔧'}</p>
                    <p className={cn('text-xs font-black mt-1.5', on ? 'text-[#003087]' : 'text-slate-600')}>
                      {WORKER_KIND_META[k].label}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {k === 'lavage' ? 'Uniquement les lavages'
                        : k === 'reparation' ? 'Uniquement les réparations'
                          : 'Proposé sur les deux'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="sm:col-span-2"><Field label="Date de début de travail"><Input type="date" value={f.startDate || ''} onChange={e => set('startDate', e.target.value)} /></Field></div>

        <div className="sm:col-span-2 rounded-xl bg-slate-50 border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-bold text-slate-700">Rémunération</p><p className="text-xs text-slate-400">Cet employé perçoit-il un salaire ?</p></div>
            <Switch checked={!!f.paid} onChange={v => set('paid', v)} />
          </div>
          {f.paid && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select value={f.salaryType || 'mois'} onChange={e => set('salaryType', e.target.value)}>
                  <option value="mois">Mensuel</option>
                  <option value="jour">Journalier</option>
                  <option value="pourcentage">Pourcentage des travaux</option>
                </Select>
              </Field>
              {f.salaryType === 'pourcentage' ? (
                <Field label="Pourcentage (%)" hint="Part de chaque intervention réalisée par cet employé.">
                  <Input type="number" step="0.01" value={f.percentage ?? 0} onChange={e => set('percentage', e.target.value)} />
                </Field>
              ) : (
                <Field label="Montant (DA)"><Input type="number" value={f.salaryAmount ?? 0} onChange={e => set('salaryAmount', e.target.value)} /></Field>
              )}
            </div>
          )}
        </div>

        <div className="sm:col-span-2 rounded-xl border border-slate-200 p-4"
          style={{ background: 'linear-gradient(135deg, rgba(0,48,135,0.04), rgba(255,184,0,0.06))' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
                <Lock className="w-5 h-5 text-[#FFB800]" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#002d87]">Compte de connexion</p>
                <p className="text-xs text-slate-500">Créer un accès à l'application pour cet employé</p>
              </div>
            </div>
            <Switch checked={!!f.hasAccount} onChange={v => set('hasAccount', v)} />
          </div>
          {f.hasAccount && (
            <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Nom d'utilisateur" required>
                <Input value={f.username || ''} onChange={e => set('username', e.target.value.toLowerCase())} placeholder="ex: karim.b" />
              </Field>
              <Field label="Mot de passe" required={!initial?.authUserId} hint={initial?.authUserId ? 'Laisser vide pour ne pas changer' : '6 caractères minimum'}>
                <Input type="text" value={f.password || ''} onChange={e => set('password', e.target.value)} placeholder="••••••" />
              </Field>
              <Field label="Email (optionnel)" hint="Sinon connexion par nom d'utilisateur">
                <Input type="email" value={f.email || ''} onChange={e => set('email', e.target.value)} />
              </Field>
              <p className="sm:col-span-3 text-[11px] text-slate-500">
                L'employé se connecte avec son <b>nom d'utilisateur</b> (ou son email) et ce mot de passe.
                Programmez ensuite ses permissions : il ne verra que les interfaces autorisées de « {MODULES[moduleKey].label} ».
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Activate an account for an employee created before the login existed ─────
function ActivateModal({ moduleKey, worker, onClose }: { moduleKey: ModuleKey; worker: BizWorker; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const activate = async () => {
    if (password.length < 6) { toast.error('Mot de passe : 6 caractères minimum'); return; }
    setBusy(true);
    const res = await provisionModuleWorkerAccount({
      action: 'create', moduleKey, workerId: worker.id,
      username: worker.username, password, name: worker.name, email: worker.email,
      roleName: worker.roleName, phone: worker.phone, permissions: worker.permissions || {},
    });
    setBusy(false);
    if (!res.ok) { toast.error(`Activation échouée : ${res.error}`); return; }
    biz.update('workers', { ...worker, hasAccount: true, authUserId: res.auth_user_id });
    toast.success(`Compte activé pour ${worker.name}`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={Zap} size="sm" title="Activer le compte" subtitle={worker.name}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn-primary" onClick={activate} disabled={busy}>
          {busy && <Loader className="w-4 h-4 animate-spin" />} Activer
        </button>
      </>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[10px] uppercase font-bold text-slate-400">Nom d'utilisateur</p>
          <p className="font-bold text-slate-700">{worker.username}</p>
        </div>
        <Field label="Mot de passe" required hint="6 caractères minimum">
          <Input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
        </Field>
      </div>
    </Modal>
  );
}

function ViewWorker({ worker, onClose }: { worker: BizWorker; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} icon={Eye} size="md" title={worker.name} subtitle={worker.roleName}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {[['Rôle', worker.roleName],
        ...(worker.workerKind ? [['Spécialité', WORKER_KIND_META[worker.workerKind].label]] : []),
        ['Téléphone', worker.phone || '—'], ['Naissance', worker.birthday ? formatDate(worker.birthday) : '—'],
        ['CIN', worker.cin || '—'],
        ['Salaire', !worker.paid ? '—'
          : worker.salaryType === 'pourcentage'
            ? `${worker.percentage || 0} % des travaux`
            : `${money(worker.salaryAmount)} / ${worker.salaryType}`],
        ['Identifiant', worker.username || '—'],
        ['Compte', worker.hasAccount ? (worker.authUserId ? 'Actif' : 'À activer') : 'Aucun'],
        ['Début', formatDate(worker.startDate)], ['Acomptes', String(worker.acomptes.length)]].map(([k, v]) => (
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
  const [saving, setSaving] = useState(false);
  // Only the interfaces this part actually has.
  const interfaces = useMemo(() => interfacesForModule(moduleKey), [moduleKey]);
  const key = (iface: string, action: string) => `${iface}.${action}`;
  const toggleIface = (iface: string) => {
    const on = perms[key(iface, 'voir')];
    setPerms(p => ({ ...p, [key(iface, 'voir')]: !on }));
  };
  const toggleAction = (iface: string, action: string) => setPerms(p => ({ ...p, [key(iface, action)]: !p[key(iface, action)] }));

  const save = async () => {
    setSaving(true);
    biz.update('workers', { ...worker, permissions: perms });
    // Mirror server-side so the grants apply the moment the employee logs in.
    if (worker.authUserId || worker.hasAccount) {
      const res = await saveModuleWorkerPermissions(worker.id, perms);
      if (!res.ok) toast.error(`Permissions non synchronisées : ${res.error}`);
    }
    setSaving(false);
    toast.success('Permissions enregistrées');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={Shield} size="lg" title="Permissions" subtitle={`${worker.name} — ${MODULES[moduleKey].label}`}
      footer={<>
        <button className="btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving && <Loader className="w-4 h-4 animate-spin" />} Enregistrer
        </button>
      </>}>
      <p className="text-xs text-slate-500 mb-3">
        L'employé ne verra dans son menu que les interfaces activées ici, et n'aura que les boutons d'action cochés.
      </p>
      <div className="space-y-2 max-h-[55vh] overflow-y-auto custom-scrollbar pr-1">
        {interfaces.map(iface => {
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
              <div className="flex items-center gap-2">
                <span className={cn('badge', a.paid ? 'badge-success' : 'badge-warning')}>{a.paid ? 'Décompté' : 'En attente'}</span>
                <button onClick={() => remove(a.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg"><Trash2 className="w-4 h-4" /></button>
              </div>
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

/**
 * Interventions performed by a percentage-paid worker that have NOT been settled
 * yet. A work leaves this list as soon as it is included in a payment, so the
 * same job is never paid twice.
 */
function pendingWorksFor(worker: BizWorker, reparations: BizReparation[]): BizReparation[] {
  const settled = new Set(worker.payments.flatMap(p => p.workIds || []));
  return reparations
    .filter(r => r.status === 'finalized' && r.workers.includes(worker.id) && !settled.has(r.id))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Amount of an intervention that counts for one worker: the sum of the
 * prestations assigned to them, or the whole total when the job carries no
 * per-prestation assignment (legacy record, or products-only job).
 */
function baseFor(r: BizReparation, workerId: string): number {
  const lines = (r.prestations || []).filter(p => (p.workerIds || []).includes(workerId));
  return lines.length ? lines.reduce((s, p) => s + (Number(p.amount) || 0), 0) : r.total;
}

/** Every intervention of this worker, with the payment that settled it (if any). */
function allWorksFor(worker: BizWorker, reparations: BizReparation[]) {
  const byWork = new Map<string, BizWorkerPayment>();
  worker.payments.forEach(p => (p.workIds || []).forEach(id => byWork.set(id, p)));
  return reparations
    .filter(r => r.workers.includes(worker.id))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map(r => ({ work: r, payment: byWork.get(r.id) }));
}

function PaymentModal({ moduleKey, worker, onClose }: { moduleKey: ModuleKey; worker: BizWorker; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { reparations } = biz.state;
  const isPercent = worker.salaryType === 'pourcentage';
  const rate = worker.percentage || 0;

  const pendingWorks = useMemo(
    () => (isPercent ? pendingWorksFor(worker, reparations) : []),
    [isPercent, worker, reparations]);
  // Base of the share: the prestations this worker actually performed (a job can
  // hold a lavage done by A and a réparation done by B).
  const worksTotal = pendingWorks.reduce((s, r) => s + baseFor(r, worker.id), 0);
  const percentDue = pendingWorks.reduce((s, r) => s + workerShareOf(r, worker.id, rate), 0);

  const base = isPercent ? percentDue : worker.salaryAmount;
  const acomptesDue = worker.acomptes.filter(a => !a.paid).reduce((s, a) => s + a.amount, 0);
  const absencesDue = worker.absences.filter(a => !a.paid).reduce((s, a) => s + a.cost, 0);
  const computedNet = Math.max(0, base - acomptesDue - absencesDue);

  const [net, setNet] = useState(computedNet);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [showWorks, setShowWorks] = useState(false);
  const period = new Date().toLocaleString('fr-DZ', { month: 'long', year: 'numeric' });

  React.useEffect(() => { setNet(computedNet); }, [computedNet]);

  const pay = () => {
    const payment: BizWorkerPayment = {
      id: newId(), period, amount: net, date, description,
      // Recording the settled works is what removes them from the next payment.
      workIds: isPercent ? pendingWorks.map(r => r.id) : undefined,
      worksTotal: isPercent ? worksTotal : undefined,
      percentage: isPercent ? rate : undefined,
    };
    const updated: BizWorker = {
      ...worker,
      acomptes: worker.acomptes.map(a => a.paid ? a : { ...a, paid: true }),
      absences: worker.absences.map(a => a.paid ? a : { ...a, paid: true }),
      payments: [payment, ...worker.payments],
    };
    biz.update('workers', updated);
    if (isPercent) {
      pendingWorks.forEach(r => biz.update('reparations', { ...r, payrollSettled: true }));
    }
    toast.success('Paiement enregistré'); onClose();
  };

  return (
    <>
      <Modal open onClose={onClose} icon={Banknote} size={isPercent ? 'lg' : 'md'}
        title="Paiement du salaire" subtitle={`${worker.name} — ${period}`}
        footer={<>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          {isPercent && <button className="btn-secondary" onClick={() => setShowWorks(true)}><Eye className="w-4 h-4" /> Détail des travaux</button>}
          <button className="btn-primary" onClick={pay}>Enregistrer le paiement</button>
        </>}>
        <div className="space-y-4">
          {isPercent ? (
            <>
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
                Paie au pourcentage : <strong>{rate}%</strong> de chaque intervention réalisée.
                Seuls les travaux <strong>non encore payés</strong> sont listés ; une fois le paiement
                enregistré, ils n'apparaîtront plus.
              </div>
              {pendingWorks.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">Aucun travail non payé pour cet employé.</p>
              ) : (
                <div className="max-h-[240px] overflow-y-auto custom-scrollbar space-y-1.5">
                  {pendingWorks.map(r => {
                    const mine = prestationsOf(r).filter(p => p.workerIds.includes(worker.id));
                    return (
                      <div key={r.id} className="flex items-center justify-between bg-slate-50 rounded-xl p-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700 truncate">{r.ref} — {r.clientName}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {formatDate(r.date)} • {mine.length
                              ? mine.map(p => `${p.kind === 'lavage' ? 'Lavage' : 'Réparation'} : ${p.label}`).join(' · ')
                              : (r.kind === 'lavage' ? 'Lavage' : r.kind === 'reparation' ? 'Réparation' : 'Lavage + Réparation')}
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="font-bold tabular-nums text-slate-700">{money(baseFor(r, worker.id))}</p>
                          <p className="text-xs text-emerald-600 tabular-nums">+{money(workerShareOf(r, worker.id, rate))}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Travaux</p><p className="font-black tabular-nums">{pendingWorks.length}</p></div>
                <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Base retenue</p><p className="font-black tabular-nums text-sm">{money(worksTotal)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Part {rate}%</p><p className="font-black tabular-nums text-sm text-emerald-600">{money(percentDue)}</p></div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm">
              <span className="text-slate-500">Salaire de base ({worker.salaryType})</span>
              <span className="font-bold tabular-nums">{money(base)}</span>
            </div>
          )}

          <div className="space-y-2 text-sm">
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
              {worker.payments.slice(0, 3).map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg p-2">
                  <span>{p.period} • {formatDate(p.date)}{p.workIds?.length ? ` • ${p.workIds.length} travaux` : ''}</span>
                  <span className="font-bold tabular-nums">{money(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {showWorks && <WorkerWorksModal worker={worker} reparations={reparations} onClose={() => setShowWorks(false)} />}
    </>
  );
}

// ─── Détail de tous les travaux d'un employé ───────────────────────────────────
function WorkerWorksModal({ worker, reparations, onClose }: {
  worker: BizWorker; reparations: BizReparation[]; onClose: () => void;
}) {
  const rate = worker.percentage || 0;
  const rows = useMemo(() => allWorksFor(worker, reparations), [worker, reparations]);
  const paidTotal = rows.filter(r => r.payment).reduce((s, r) => s + workerShareOf(r.work, worker.id, rate), 0);
  const dueTotal = rows.filter(r => !r.payment && r.work.status === 'finalized')
    .reduce((s, r) => s + workerShareOf(r.work, worker.id, rate), 0);

  return (
    <Modal open onClose={onClose} icon={Briefcase} size="2xl"
      title={`Travaux de ${worker.name}`} subtitle={`Paie au pourcentage — ${rate}%`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Travaux</p><p className="font-black tabular-nums">{rows.length}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Déjà payé</p><p className="font-black tabular-nums text-emerald-600 text-sm">{money(paidTotal)}</p></div>
          <div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Restant dû</p><p className="font-black tabular-nums text-amber-600 text-sm">{money(dueTotal)}</p></div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Aucun travail enregistré pour cet employé.</p>
        ) : (
          <div className="card-glass overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full border-collapse">
                <thead><tr>
                  <th className="table-head">Réf</th><th className="table-head">Date</th><th className="table-head">Client</th>
                  <th className="table-head">Véhicule</th><th className="table-head">Prestations réalisées</th>
                  <th className="table-head text-right">Total facture</th><th className="table-head text-right">Base</th>
                  <th className="table-head text-right">Part {rate}%</th><th className="table-head">État</th>
                </tr></thead>
                <tbody>
                  {rows.map(({ work, payment }) => {
                    const mine = prestationsOf(work).filter(p => p.workerIds.includes(worker.id));
                    return (
                      <tr key={work.id}>
                        <td className="table-cell font-bold">{work.ref}</td>
                        <td className="table-cell whitespace-nowrap">{formatDate(work.date)}</td>
                        <td className="table-cell">{work.clientName}</td>
                        <td className="table-cell text-slate-500">
                          {[work.car?.marque, work.car?.name, work.car?.immatriculation].filter(Boolean).join(' • ') || '—'}
                        </td>
                        <td className="table-cell">
                          {mine.length ? (
                            <div className="flex flex-wrap gap-1">
                              {mine.map(p => (
                                <span key={p.id} className={cn('badge', p.kind === 'lavage' ? 'badge-info' : 'badge-primary')}>
                                  {p.kind === 'lavage' ? '🧽' : '🔧'} {p.label} · {money(p.amount)}
                                </span>
                              ))}
                            </div>
                          ) : <span className="text-slate-400 italic text-xs">Intervention entière</span>}
                        </td>
                        <td className="table-cell tabular-nums text-right">{money(work.total)}</td>
                        <td className="table-cell tabular-nums text-right text-slate-500">{money(baseFor(work, worker.id))}</td>
                        <td className="table-cell tabular-nums text-right font-bold">{money(workerShareOf(work, worker.id, rate))}</td>
                        <td className="table-cell">
                          {payment
                            ? <span className="badge badge-success">Payé le {formatDate(payment.date)}</span>
                            : work.status === 'finalized'
                              ? <span className="badge badge-warning">À payer</span>
                              : <span className="badge badge-neutral">En attente</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Impression des paiements sur une période ──────────────────────────────────
function PrintPaymentsModal({ moduleKey, worker, onClose }: {
  moduleKey: ModuleKey; worker: BizWorker; onClose: () => void;
}) {
  const { settings } = useAppState();
  const cfg = MODULES[moduleKey];
  const firstOfYear = `${new Date().getFullYear()}-01-01`;
  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(new Date().toISOString().split('T')[0]);

  const rows = useMemo(() => worker.payments
    .filter(p => {
      const d = new Date(p.date).getTime();
      return d >= new Date(from).getTime() && d <= new Date(`${to}T23:59:59`).getTime();
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [worker.payments, from, to]);
  const total = rows.reduce((s, p) => s + p.amount, 0);

  const print = () => {
    printInvoice({
      title: 'État des paiements',
      ref: worker.name,
      date: new Date().toISOString(),
      station: stationFromSettings(settings),
      party: { label: 'Employé', name: worker.name, phone: worker.phone },
      info: [
        { label: 'Partie', value: cfg.label },
        { label: 'Fonction', value: worker.roleName },
        { label: 'Période', value: `${formatDate(from)} → ${formatDate(to)}` },
        { label: 'Mode de paie', value: worker.salaryType === 'pourcentage' ? `Pourcentage ${worker.percentage || 0}%` : worker.salaryType },
      ],
      items: rows.map(p => ({
        name: `${p.period}${p.description ? ` — ${p.description}` : ''}${p.workIds?.length ? ` (${p.workIds.length} travaux)` : ''}`,
        qty: formatDate(p.date),
        unitPrice: p.amount,
        total: p.amount,
      })),
      total, paid: total, rest: 0,
      footerNote: `${rows.length} paiement(s) sur la période — ${cfg.label}`,
    });
  };

  return (
    <Modal open onClose={onClose} icon={Printer} size="lg"
      title="Imprimer les paiements" subtitle={`${worker.name} — choisissez une période`}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        <button className="btn-primary" onClick={print} disabled={rows.length === 0}>
          <Printer className="w-4 h-4" /> Imprimer
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Du"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="Au"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        </div>
        <div className="rounded-2xl bg-[#001f5c] text-white p-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-blue-200">{rows.length} paiement(s)</span>
          <span className="text-2xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">Aucun paiement sur cette période.</p>
        ) : (
          <div className="max-h-[260px] overflow-y-auto custom-scrollbar space-y-1.5">
            {rows.map(p => (
              <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-xl p-2.5 text-sm">
                <div>
                  <p className="font-bold text-slate-700">{p.period}</p>
                  <p className="text-xs text-slate-400">
                    {formatDate(p.date)}{p.description ? ` • ${p.description}` : ''}
                    {p.workIds?.length ? ` • ${p.workIds.length} travaux` : ''}
                  </p>
                </div>
                <span className="font-bold tabular-nums">{money(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
