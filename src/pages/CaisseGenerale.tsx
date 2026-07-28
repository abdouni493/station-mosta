/**
 * ─── Caisse Générale (Système) ──────────────────────────────────────────────────
 * Single place where the money of the whole station is read and moved.
 *
 *  • Solde de la caisse générale — the authoritative cash box, computed from the
 *    treasury ledger only (dépôts, retraits, virements, encaissements brigades…).
 *  • Caisse de chaque partie — Carburant, Cafétéria and Lavage & Réparation, each
 *    computed from its own documents.
 *  • Journal des opérations — every movement of the station in one list: achats,
 *    ventes, virements, dépôts, retraits, dépenses, encaissements de brigade.
 *  • Actions — dépôt / retrait (montant, description, date) and virement de la
 *    caisse générale vers un compte bancaire.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  PiggyBank, Plus, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Layers,
  Fuel, Coffee, Droplets, Landmark, Trash2, Edit2, ShoppingCart, Receipt,
  CreditCard, Target, Wallet, TrendingUp, TrendingDown,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, useModulePermission,
  TreasuryTransaction, TreasuryPart, CAISSE_ID, bankBalanceOf, caisseBalanceOf,
} from '../store/AppContext';
import { useBizAll } from '../store/BizContext';
import { MODULES, ModuleKey } from '../lib/bizConfig';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Confirm,
  Table, money, formatDate, PeriodFilter, Period, inPeriod,
} from '../components/biz/Kit';
import { TX_LABEL } from './BankAccounts';

const todayISO = () => new Date().toISOString().split('T')[0];

/** One row of the consolidated journal. */
interface Movement {
  id: string;
  date: string;
  label: string;
  nature: string;
  part: TreasuryPart;
  /** Signed against the station's money: > 0 = encaissement. */
  amount: number;
  /** Ledger lines can be edited/deleted; document lines are read-only here. */
  tx?: TreasuryTransaction;
  account?: string;
}

const PART_META: Record<TreasuryPart, { label: string; icon: React.ElementType; tone: string }> = {
  carburant: { label: 'Carburant', icon: Fuel, tone: '#003087' },
  cafeteria: { label: 'Cafétéria', icon: Coffee, tone: '#b45309' },
  lavage: { label: 'Lavage & Réparation', icon: Droplets, tone: '#0e7490' },
  systeme: { label: 'Système', icon: Landmark, tone: '#4c1d95' },
};

const NATURE_ICON: Record<string, React.ElementType> = {
  'Dépôt': ArrowDownCircle, 'Retrait': ArrowUpCircle, 'Virement': ArrowLeftRight,
  'Achat': ShoppingCart, 'Vente': Receipt, 'Dépense': CreditCard,
  'Brigade': Target, 'TPE': CreditCard, 'Salaire': Wallet, 'Ajustement': Layers,
};

export default function CaisseGenerale() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const perm = useModulePermission('Caisse Générale');
  const biz = useBizAll();

  const {
    bankAccounts, treasuryTransactions, purchases, expenses,
    brigadeAccountings, brigades, currentUserName,
  } = state;

  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [partFilter, setPartFilter] = useState<'all' | TreasuryPart>('all');
  const [natureFilter, setNatureFilter] = useState<string>('all');
  const [txForm, setTxForm] = useState<null | 'new' | TreasuryTransaction>(null);
  const [transferring, setTransferring] = useState(false);
  const [toDelete, setToDelete] = useState<TreasuryTransaction | null>(null);

  // ── Balances ───────────────────────────────────────────────────────────────
  const caisse = useMemo(() => caisseBalanceOf(treasuryTransactions), [treasuryTransactions]);
  const accounts = useMemo(
    () => bankAccounts.map(a => ({ ...a, balance: bankBalanceOf(a, treasuryTransactions) })),
    [bankAccounts, treasuryTransactions]);
  const totalBank = accounts.reduce((s, a) => s + a.balance, 0);

  /** Cash position of one business part, from its own documents. */
  const partBalance = (key: ModuleKey) => {
    const m = biz[key];
    if (!m) return 0;
    const deposits = m.caisse.filter(c => c.type === 'deposit').reduce((s, c) => s + c.amount, 0);
    const withdrawals = m.caisse.filter(c => c.type === 'withdraw').reduce((s, c) => s + c.amount, 0);
    const salesPaid = m.sales.reduce((s, x) => s + x.paid, 0);
    const repPaid = m.reparations.reduce((s, r) => s + r.paid, 0);
    const purchasesPaid = m.purchases.reduce((s, x) => s + x.paid, 0);
    const exp = m.expenses.reduce((s, x) => s + x.amount, 0);
    const salaries = m.workers.reduce((s, w) => s + w.payments.reduce((a, p) => a + p.amount, 0), 0);
    return deposits + salesPaid + repPaid - withdrawals - purchasesPaid - exp - salaries;
  };

  const carburantBalance = useMemo(() => {
    const cash = brigadeAccountings.reduce((s, a) => s + (a.cashReceived || 0), 0);
    const purchasesPaid = purchases.reduce((s, p) => s + (p.amountPaid || 0), 0);
    const exp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    return cash - purchasesPaid - exp;
  }, [brigadeAccountings, purchases, expenses]);

  const partBalances = useMemo(() => ({
    carburant: carburantBalance,
    cafeteria: partBalance('cafeteria'),
    lavage: partBalance('lavage'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [carburantBalance, biz]);

  // ── Consolidated journal ───────────────────────────────────────────────────
  const movements = useMemo<Movement[]>(() => {
    const out: Movement[] = [];
    const accName = (id?: string) => {
      if (!id) return undefined;
      if (id === CAISSE_ID) return 'Caisse générale';
      return accounts.find(a => a.id === id)?.name;
    };

    // 1. Treasury ledger — the only rows that move the caisse générale.
    for (const t of treasuryTransactions) {
      const nature = TX_LABEL[t.kind] || t.kind;
      // A transfer is signed from the caisse's point of view when it touches it.
      let amount = t.amount;
      if (t.kind === 'WITHDRAW') amount = -t.amount;
      else if (t.kind === 'TRANSFER') amount = t.accountFrom === CAISSE_ID ? -t.amount : (t.accountTo === CAISSE_ID ? t.amount : 0);
      else if (['PURCHASE', 'EXPENSE', 'SALARY'].includes(t.kind)) amount = -t.amount;
      out.push({
        id: t.id,
        date: t.date,
        label: t.description || nature,
        nature,
        part: t.part,
        amount,
        tx: t,
        account: [accName(t.accountFrom), accName(t.accountTo)].filter(Boolean).join(' → ') || undefined,
      });
    }

    // 2. Fuel part documents.
    for (const p of purchases) {
      const supplier = state.suppliers.find(s => s.id === p.supplierId);
      out.push({
        id: `pur-${p.id}`, date: p.date, nature: 'Achat', part: 'carburant',
        label: `Achat carburant ${p.invoiceNumber ? `n° ${p.invoiceNumber}` : ''} — ${supplier?.name || 'Fournisseur'}`,
        amount: -(p.amountPaid || 0),
      });
    }
    for (const e of expenses) {
      out.push({
        id: `exp-${e.id}`, date: e.date, nature: 'Dépense', part: 'carburant',
        label: `${e.category || 'Dépense'} — ${e.description || ''}`.trim(),
        amount: -(e.amount || 0),
      });
    }
    for (const a of brigadeAccountings) {
      const br = brigades.find(b => b.id === a.brigadeId);
      out.push({
        id: `bri-${a.id}`, date: br?.date || new Date().toISOString(), nature: 'Brigade', part: 'carburant',
        label: `Encaissement brigade ${br ? `${br.shift} du ${formatDate(br.date)}` : ''}`.trim(),
        amount: a.cashReceived || 0,
      });
    }

    // 3. Business parts (Cafétéria / Lavage) — sales, interventions, purchases…
    (Object.keys(MODULES) as ModuleKey[]).forEach(key => {
      const m = biz[key];
      if (!m) return;
      const part = key as TreasuryPart;
      m.sales.forEach(s => out.push({
        id: `${key}-sale-${s.id}`, date: s.date, nature: 'Vente', part,
        label: `Vente ${s.ref} — ${s.clientName}`, amount: s.paid,
      }));
      m.reparations.filter(r => r.paid > 0).forEach(r => out.push({
        id: `${key}-rep-${r.id}`, date: r.date, nature: 'Vente', part,
        label: `${r.kind === 'lavage' ? 'Lavage' : 'Réparation'} ${r.ref} — ${r.clientName}`, amount: r.paid,
      }));
      m.purchases.forEach(p => out.push({
        id: `${key}-pur-${p.id}`, date: p.date, nature: 'Achat', part,
        label: `Achat ${p.ref} — ${p.supplierName}`, amount: -p.paid,
      }));
      m.expenses.forEach(e => out.push({
        id: `${key}-exp-${e.id}`, date: e.date, nature: 'Dépense', part,
        label: `${e.name}${e.description ? ` — ${e.description}` : ''}`, amount: -e.amount,
      }));
      m.caisse.forEach(c => out.push({
        id: `${key}-csh-${c.id}`, date: c.date,
        nature: c.type === 'deposit' ? 'Dépôt' : 'Retrait', part,
        label: c.description || (c.type === 'deposit' ? 'Dépôt de caisse' : 'Retrait de caisse'),
        amount: c.type === 'deposit' ? c.amount : -c.amount,
      }));
      m.workers.forEach(w => w.payments.forEach(pay => out.push({
        id: `${key}-pay-${pay.id}`, date: pay.date, nature: 'Salaire', part,
        label: `Salaire ${w.name} — ${pay.period}`, amount: -pay.amount,
      })));
    });

    return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [treasuryTransactions, purchases, expenses, brigadeAccountings, brigades, biz, accounts, state.suppliers]);

  const natures = useMemo(
    () => Array.from(new Set(movements.map(m => m.nature))).sort(),
    [movements]);

  const filtered = useMemo(() => movements.filter(m =>
    inPeriod(m.date, period, from, to) &&
    (partFilter === 'all' || m.part === partFilter) &&
    (natureFilter === 'all' || m.nature === natureFilter)
  ), [movements, period, from, to, partFilter, natureFilter]);

  const flow = useMemo(() => {
    const inTotal = filtered.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0);
    const outTotal = filtered.filter(m => m.amount < 0).reduce((s, m) => s - m.amount, 0);
    return { inTotal, outTotal, net: inTotal - outTotal };
  }, [filtered]);

  const del = () => {
    if (!toDelete) return;
    dispatch({ type: 'DELETE_TREASURY_TX', payload: toDelete.id });
    toast.success('Transaction supprimée');
    setToDelete(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={PiggyBank} title="Caisse Générale" subtitle="Système — trésorerie consolidée de la station"
        actions={perm.creer ? <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setTransferring(true)}>
            <ArrowLeftRight className="w-4 h-4" /> Virement vers banque
          </button>
          <button className="btn-primary" onClick={() => setTxForm('new')}>
            <Plus className="w-4 h-4" /> Dépôt / Retrait
          </button>
        </div> : undefined} />

      {/* Hero */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
          <div className="flex items-center gap-2 text-blue-200">
            <PiggyBank className="w-5 h-5" />
            <span className="text-sm font-bold uppercase tracking-wide">Solde caisse générale</span>
          </div>
          <p className="text-4xl font-black tabular-nums mt-2 text-[#FFB800]">{money(caisse)}</p>
          <p className="text-[11px] text-blue-200 mt-1">Espèces disponibles — dépôts, retraits et virements</p>
        </div>
        <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100">
            <Landmark className="w-5 h-5" />
            <span className="text-sm font-bold uppercase tracking-wide">Total en banque</span>
          </div>
          <p className="text-4xl font-black tabular-nums mt-2">{money(totalBank)}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            {accounts.length === 0
              ? <span className="text-[11px] text-emerald-100">Aucun compte bancaire</span>
              : accounts.map(a => (
                <div key={a.id} className="rounded-xl bg-white/10 px-3 py-2">
                  <p className="text-[10px] uppercase text-emerald-100 font-bold truncate max-w-[140px]">{a.name}</p>
                  <p className="font-black tabular-nums text-sm">{money(a.balance)}</p>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Caisse of each part */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(['carburant', 'cafeteria', 'lavage'] as const).map(key => {
          const meta = PART_META[key]; const Icon = meta.icon;
          const val = partBalances[key];
          return (
            <button key={key} onClick={() => setPartFilter(partFilter === key ? 'all' : key)}
              className={`card-glass p-5 text-left transition-all ${partFilter === key ? 'ring-2 ring-[#003087]' : ''}`}>
              <div className="flex items-center gap-2" style={{ color: meta.tone }}>
                <Icon className="w-5 h-5" />
                <span className="text-xs font-bold uppercase">Caisse {meta.label}</span>
              </div>
              <p className={`text-2xl font-black tabular-nums mt-2 ${val >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(val)}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="card-glass p-4 space-y-3">
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <div className="flex flex-wrap items-center gap-3">
          <Select value={partFilter} onChange={e => setPartFilter(e.target.value as any)} className="!w-auto min-w-[190px]">
            <option value="all">Toutes les parties</option>
            {(Object.keys(PART_META) as TreasuryPart[]).map(p => <option key={p} value={p}>{PART_META[p].label}</option>)}
          </Select>
          <Select value={natureFilter} onChange={e => setNatureFilter(e.target.value)} className="!w-auto min-w-[170px]">
            <option value="all">Toutes les natures</option>
            {natures.map(n => <option key={n} value={n}>{n}</option>)}
          </Select>
          <span className="text-xs text-slate-400 ml-auto">{filtered.length} opération(s)</span>
        </div>
      </div>

      {/* Flow */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={TrendingUp} label="Encaissements" value={`+${money(flow.inTotal)}`} tone="green" />
        <StatCard icon={TrendingDown} label="Décaissements" value={`−${money(flow.outTotal)}`} tone="red" />
        <StatCard icon={Layers} label="Flux net" value={money(flow.net)} tone={flow.net >= 0 ? 'blue' : 'red'} />
      </div>

      {/* Journal */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2">
            <Layers className="w-5 h-5" /> Journal des opérations
          </h3>
        </div>
        {filtered.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-10">Aucune opération sur la période</p>
        ) : (
          <Table head={<>
            <th className="table-head">Date</th><th className="table-head">Nature</th>
            <th className="table-head">Partie</th><th className="table-head">Description</th>
            <th className="table-head">Comptes</th>
            <th className="table-head text-right">Montant</th>
            <th className="table-head text-right">Actions</th>
          </>}>
            {filtered.slice(0, 400).map(m => {
              const Icon = NATURE_ICON[m.nature] || Layers;
              return (
                <tr key={m.id}>
                  <td className="table-cell whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="table-cell">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                      <Icon className="w-3.5 h-3.5" /> {m.nature}
                    </span>
                  </td>
                  <td className="table-cell"><Badge tone="neutral">{PART_META[m.part].label}</Badge></td>
                  <td className="table-cell max-w-[280px]">{m.label || '—'}</td>
                  <td className="table-cell text-[11px] text-slate-400">{m.account || '—'}</td>
                  <td className={`table-cell text-right tabular-nums font-bold ${m.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}
                  </td>
                  <td className="table-cell text-right">
                    {m.tx && (m.tx.kind === 'DEPOSIT' || m.tx.kind === 'WITHDRAW' || m.tx.kind === 'TRANSFER') ? (
                      <div className="flex items-center justify-end gap-1">
                        {perm.modifier && (
                          <button onClick={() => setTxForm(m.tx!)} title="Modifier"
                            className="w-8 h-8 rounded-lg text-amber-600 hover:bg-amber-50 flex items-center justify-center">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {perm.supprimer && (
                          <button onClick={() => setToDelete(m.tx!)} title="Supprimer"
                            className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ) : <span className="text-[11px] text-slate-300">document</span>}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>

      {txForm && (
        <CashTxModal
          initial={txForm === 'new' ? null : txForm}
          createdBy={currentUserName}
          onClose={() => setTxForm(null)}
          onSave={tx => {
            dispatch({ type: txForm === 'new' ? 'ADD_TREASURY_TX' : 'UPDATE_TREASURY_TX', payload: tx });
            toast.success(txForm === 'new' ? 'Transaction enregistrée' : 'Transaction modifiée');
            setTxForm(null);
          }}
        />
      )}

      {transferring && (
        <CaisseTransferModal
          accounts={accounts}
          caisseBalance={caisse}
          createdBy={currentUserName}
          onClose={() => setTransferring(false)}
          onSave={tx => {
            dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
            toast.success('Virement enregistré');
            setTransferring(false);
          }}
        />
      )}

      <Confirm open={!!toDelete} title="Supprimer la transaction"
        message="Cette opération sera retirée de la caisse générale. Confirmer ?"
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Dépôt / Retrait ───────────────────────────────────────────────────────────
function CashTxModal({
  initial, createdBy, onClose, onSave,
}: {
  initial: TreasuryTransaction | null;
  createdBy?: string;
  onClose: () => void;
  onSave: (tx: TreasuryTransaction) => void;
}) {
  const isEdit = !!initial;
  const isTransfer = initial?.kind === 'TRANSFER';
  const [kind, setKind] = useState<'DEPOSIT' | 'WITHDRAW'>(
    initial && initial.kind === 'WITHDRAW' ? 'WITHDRAW' : 'DEPOSIT');
  const [amount, setAmount] = useState(String(initial?.amount ?? ''));
  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : todayISO());
  const [description, setDescription] = useState(initial?.description || '');
  const [part, setPart] = useState<TreasuryPart>(initial?.part || 'systeme');

  const value = Number(amount) || 0;

  const save = () => {
    if (value <= 0) { toast.error('Montant requis'); return; }
    onSave({
      id: initial?.id || newId(),
      date: new Date(date).toISOString(),
      // Editing a virement keeps its nature and its two accounts untouched.
      kind: isTransfer ? 'TRANSFER' : kind,
      amount: value,
      description: description.trim() || undefined,
      accountFrom: isTransfer ? initial!.accountFrom : (kind === 'WITHDRAW' ? CAISSE_ID : undefined),
      accountTo: isTransfer ? initial!.accountTo : (kind === 'DEPOSIT' ? CAISSE_ID : undefined),
      part,
      createdBy: initial?.createdBy || createdBy,
      createdAt: initial?.createdAt || new Date().toISOString(),
    });
  };

  return (
    <Modal open onClose={onClose} icon={PiggyBank} size="md"
      title={isEdit ? 'Modifier la transaction' : 'Dépôt / Retrait de caisse'}
      subtitle="Montant, description et date"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={value <= 0}>{isEdit ? 'Enregistrer' : 'Valider'}</button>
      </>}>
      <div className="space-y-4">
        {!isTransfer && (
          <div className="flex gap-2">
            <button onClick={() => setKind('DEPOSIT')}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 ${kind === 'DEPOSIT' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
              <ArrowDownCircle className="w-4 h-4" /> Dépôt (entrée)
            </button>
            <button onClick={() => setKind('WITHDRAW')}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 ${kind === 'WITHDRAW' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
              <ArrowUpCircle className="w-4 h-4" /> Retrait (sortie)
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)" required><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Partie concernée">
          <Select value={part} onChange={e => setPart(e.target.value as TreasuryPart)}>
            {(Object.keys(PART_META) as TreasuryPart[]).map(p => <option key={p} value={p}>{PART_META[p].label}</option>)}
          </Select>
        </Field>
        <Field label="Description"><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Motif de l'opération" /></Field>
      </div>
    </Modal>
  );
}

// ─── Virement caisse → banque ──────────────────────────────────────────────────
function CaisseTransferModal({
  accounts, caisseBalance, createdBy, onClose, onSave,
}: {
  accounts: { id: string; name: string; balance: number }[];
  caisseBalance: number;
  createdBy?: string;
  onClose: () => void;
  onSave: (tx: TreasuryTransaction) => void;
}) {
  const [target, setTarget] = useState(accounts[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const value = Number(amount) || 0;
  const account = accounts.find(a => a.id === target);

  const save = () => {
    if (!target) { toast.error('Créez d\'abord un compte bancaire'); return; }
    if (value <= 0) { toast.error('Montant requis'); return; }
    onSave({
      id: newId(),
      date: new Date(date).toISOString(),
      kind: 'TRANSFER',
      amount: value,
      description: description.trim() || `Virement caisse générale → ${account?.name || ''}`.trim(),
      accountFrom: CAISSE_ID,
      accountTo: target,
      part: 'systeme',
      createdBy,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <Modal open onClose={onClose} icon={ArrowLeftRight} size="md"
      title="Virement vers un compte bancaire" subtitle="Depuis la caisse générale"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={value <= 0 || !target}>Valider le virement</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Caisse générale</p>
            <p className="font-black text-slate-700 tabular-nums">{money(caisseBalance)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Après virement</p>
            <p className="font-black text-slate-700 tabular-nums">{money(caisseBalance - value)}</p>
          </div>
        </div>
        {accounts.length === 0 ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
            Aucun compte bancaire. Créez-en un depuis « Comptes Bancaires ».
          </div>
        ) : (
          <Field label="Compte bancaire" required>
            <Select value={target} onChange={e => setTarget(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)" required><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Description"><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Motif du virement" /></Field>
        {account && (
          <div className="rounded-xl bg-[#001f5c] text-white p-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-blue-200">Nouveau solde {account.name}</span>
            <span className="text-lg font-black tabular-nums text-[#FFB800]">{money(account.balance + value)}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
