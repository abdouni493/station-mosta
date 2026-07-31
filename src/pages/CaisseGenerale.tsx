/**
 * ─── Caisse Générale (Finance) ──────────────────────────────────────────────────
 * Single place where the money of the whole station is read and moved.
 *
 *  • Solde de la caisse générale — the authoritative cash box, computed from the
 *    treasury ledger only (dépôts, retraits, virements, encaissements brigades…).
 *  • Caisse de chaque partie — Carburant, Cafétéria and Lavage & Réparation, each
 *    computed from its own documents.
 *  • Journal des opérations — every movement of the station in one list: achats,
 *    ventes, virements, dépôts, retraits, dépenses, encaissements de brigade.
 *  • Actions — dépôt / retrait (montant, description, date) and virement: the
 *    user picks WHICH caisse the money leaves (générale, Carburant, Cafétéria,
 *    Lavage) and WHERE it goes (a bank account or another caisse). The movement
 *    is a single ledger line, so it also shows up in the destination account's
 *    historique with the right sign.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  PiggyBank, Plus, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Layers,
  Fuel, Coffee, Droplets, Landmark, Trash2, Edit2, ShoppingCart, Receipt,
  CreditCard, Target, Wallet, TrendingUp, TrendingDown, ArrowRight, Check,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, useModulePermission,
  TreasuryTransaction, TreasuryPart, CAISSE_ID, CAISSE_PART_ID, CASH_ACCOUNT_LABEL,
  accountLabelOf, isCashAccount, ledgerNetFor, bankBalanceOf, caisseBalanceOf,
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
  systeme: { label: 'Finance', icon: Landmark, tone: '#4c1d95' },
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

  /**
   * Cash position of one business part: its own documents PLUS every virement
   * the ledger recorded on that caisse (money sent to a bank leaves it).
   */
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
    return deposits + salesPaid + repPaid - withdrawals - purchasesPaid - exp - salaries
      + ledgerNetFor(CAISSE_PART_ID[key as keyof typeof CAISSE_PART_ID], treasuryTransactions);
  };

  const carburantBalance = useMemo(() => {
    const cash = brigadeAccountings.reduce((s, a) => s + (a.cashReceived || 0), 0);
    const purchasesPaid = purchases.reduce((s, p) => s + (p.amountPaid || 0), 0);
    const exp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    return cash - purchasesPaid - exp + ledgerNetFor(CAISSE_PART_ID.carburant, treasuryTransactions);
  }, [brigadeAccountings, purchases, expenses, treasuryTransactions]);

  const partBalances = useMemo(() => ({
    carburant: carburantBalance,
    cafeteria: partBalance('cafeteria'),
    lavage: partBalance('lavage'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [carburantBalance, biz, treasuryTransactions]);

  // ── Consolidated journal ───────────────────────────────────────────────────
  const movements = useMemo<Movement[]>(() => {
    const out: Movement[] = [];
    const accName = (id?: string) => (id ? accountLabelOf(id, accounts, '') || undefined : undefined);

    // 1. Treasury ledger — the only rows that move the caisses of the station.
    for (const t of treasuryTransactions) {
      const nature = TX_LABEL[t.kind] || t.kind;
      // A transfer is signed from the cash boxes' point of view: it is a
      // décaissement when the money leaves one of them, an encaissement when it
      // arrives, and neutral between two bank accounts.
      let amount = t.amount;
      if (t.kind === 'WITHDRAW') amount = -t.amount;
      else if (t.kind === 'TRANSFER') amount = isCashAccount(t.accountFrom) ? -t.amount : (isCashAccount(t.accountTo) ? t.amount : 0);
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

    // 2. Fuel part documents — only those that have NOT written a ledger line of
    //    their own, otherwise the same money would be listed twice.
    const ledgered = new Set(
      treasuryTransactions.filter(t => t.refType && t.refId).map(t => `${t.refType}:${t.refId}`));
    for (const p of purchases) {
      if (ledgered.has(`purchase:${p.id}`)) continue;
      const supplier = state.suppliers.find(s => s.id === p.supplierId);
      out.push({
        id: `pur-${p.id}`, date: p.date, nature: 'Achat', part: 'carburant',
        label: `Achat carburant ${p.invoiceNumber ? `n° ${p.invoiceNumber}` : ''} — ${supplier?.name || 'Fournisseur'}`,
        amount: -(p.amountPaid || 0),
      });
    }
    for (const e of expenses) {
      if (ledgered.has(`expense:${e.id}`)) continue;
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
      <PageHeader icon={PiggyBank} title="Caisse Générale" subtitle="Finance — trésorerie consolidée de la station"
        actions={perm.creer ? <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setTransferring(true)}>
            <ArrowLeftRight className="w-4 h-4" /> Virement d'une caisse
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
          partBalances={partBalances}
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
        <Field label="Partie concernée"
          hint="Classement du mouvement dans le journal — l'argent entre ou sort de la caisse générale.">
          <Select value={part} onChange={e => setPart(e.target.value as TreasuryPart)}>
            {(Object.keys(PART_META) as TreasuryPart[]).map(p => <option key={p} value={p}>{PART_META[p].label}</option>)}
          </Select>
        </Field>
        <Field label="Description"><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Motif de l'opération" /></Field>
      </div>
    </Modal>
  );
}

// ─── Virement : d'une caisse vers un compte bancaire (ou une autre caisse) ─────
/**
 * The user chooses BOTH sides of the movement:
 *   • la caisse source — générale, Carburant, Cafétéria ou Lavage & Réparation
 *   • la destination   — n'importe quel compte bancaire, ou une autre caisse
 *
 * One single `TRANSFER` line is written, so the money leaves the chosen caisse
 * and shows up in the historique of the destination account with the same
 * amount — the two soldes can never disagree.
 */
function CaisseTransferModal({
  accounts, caisseBalance, partBalances, createdBy, onClose, onSave,
}: {
  accounts: { id: string; name: string; balance: number }[];
  caisseBalance: number;
  partBalances: Record<'carburant' | 'cafeteria' | 'lavage', number>;
  createdBy?: string;
  onClose: () => void;
  onSave: (tx: TreasuryTransaction) => void;
}) {
  /** Every cash box the money can leave, with its live solde. */
  const sources = useMemo(() => ([
    { id: CAISSE_ID, label: CASH_ACCOUNT_LABEL[CAISSE_ID], part: 'systeme' as TreasuryPart, icon: PiggyBank, balance: caisseBalance },
    ...(['carburant', 'cafeteria', 'lavage'] as const).map(k => ({
      id: CAISSE_PART_ID[k],
      label: PART_META[k].label,
      part: k as TreasuryPart,
      icon: PART_META[k].icon,
      balance: partBalances[k],
    })),
  ]), [caisseBalance, partBalances]);

  const [fromId, setFromId] = useState<string>(CAISSE_ID);
  const [toId, setToId] = useState<string>(accounts[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');

  const value = Number(amount) || 0;
  const source = sources.find(s => s.id === fromId)!;
  const otherCaisses = sources.filter(s => s.id !== fromId);
  const targetBank = accounts.find(a => a.id === toId);
  const targetCaisse = otherCaisses.find(s => s.id === toId);
  const targetLabel = targetBank?.name || targetCaisse?.label || '';
  const targetBalance = targetBank?.balance ?? targetCaisse?.balance ?? 0;
  const overdraft = value > source.balance;

  // Changing the source must never leave the destination pointing at itself.
  const pickSource = (id: string) => {
    setFromId(id);
    if (toId === id) setToId(accounts[0]?.id || sources.find(s => s.id !== id)!.id);
  };

  const save = () => {
    if (!toId) { toast.error('Choisissez la destination du virement'); return; }
    if (value <= 0) { toast.error('Montant requis'); return; }
    onSave({
      id: newId(),
      date: new Date(date).toISOString(),
      kind: 'TRANSFER',
      amount: value,
      description: description.trim() || `Virement ${source.label} → ${targetLabel}`,
      accountFrom: fromId,
      accountTo: toId,
      // The movement belongs to the activity whose caisse pays.
      part: source.part,
      createdBy,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <Modal open onClose={onClose} icon={ArrowLeftRight} size="lg"
      title="Virement d'une caisse" subtitle="Choisissez la caisse source et la destination"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={value <= 0 || !toId}>Valider le virement</button>
      </>}>
      <div className="space-y-5">
        {/* 1. Which caisse the money leaves */}
        <div>
          <label className="label-field">1. Caisse source</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {sources.map(s => {
              const Icon = s.icon; const on = s.id === fromId;
              return (
                <button key={s.id} onClick={() => pickSource(s.id)}
                  className={`rounded-xl p-3 text-left border transition-all ${on
                    ? 'border-[#003087] bg-[#003087]/5 ring-2 ring-[#003087]/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-4 h-4 ${on ? 'text-[#003087]' : 'text-slate-400'}`} />
                    {on && <Check className="w-3 h-3 text-[#003087] ml-auto" />}
                  </div>
                  <p className={`text-[11px] font-bold mt-1.5 leading-tight ${on ? 'text-[#002d87]' : 'text-slate-500'}`}>{s.label}</p>
                  <p className={`text-sm font-black tabular-nums ${s.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(s.balance)}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Where it goes */}
        <Field label="2. Destination du virement" required
          hint="Un compte bancaire, ou une autre caisse de la station.">
          <Select value={toId} onChange={e => setToId(e.target.value)}>
            <option value="">— Sélectionner —</option>
            {accounts.length > 0 && (
              <optgroup label="Comptes bancaires">
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {money(a.balance)}</option>)}
              </optgroup>
            )}
            <optgroup label="Caisses de la station">
              {otherCaisses.map(s => <option key={s.id} value={s.id}>{s.label} — {money(s.balance)}</option>)}
            </optgroup>
          </Select>
        </Field>

        {accounts.length === 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
            Aucun compte bancaire enregistré. Créez-en un depuis « Comptes Bancaires » pour virer l'argent en banque.
          </div>
        )}

        {/* 3. Amount */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Montant (DA)" required>
            <div className="flex gap-2">
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
              <button className="btn-outline !px-3 shrink-0 text-xs whitespace-nowrap"
                onClick={() => setAmount(String(Math.max(0, source.balance)))}
                title="Virer la totalité du solde de la caisse">Tout</button>
            </div>
          </Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>

        <Field label="Description">
          <Textarea value={description} onChange={e => setDescription(e.target.value)}
            placeholder={`Virement ${source.label} → ${targetLabel || '…'}`} />
        </Field>

        {overdraft && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
            Le montant dépasse le solde de « {source.label} » — la caisse passera en négatif.
          </div>
        )}

        {/* Recap */}
        <div className="rounded-2xl bg-[#001f5c] text-white p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase font-bold text-blue-200 truncate">{source.label}</p>
              <p className="font-black tabular-nums text-sm">{money(source.balance)}</p>
              <p className="text-[11px] text-red-300 tabular-nums">→ {money(source.balance - value)}</p>
            </div>
            <div className="shrink-0 flex flex-col items-center">
              <ArrowRight className="w-5 h-5 text-[#FFB800]" />
              <span className="text-[11px] font-black tabular-nums text-[#FFB800]">{money(value)}</span>
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-[10px] uppercase font-bold text-blue-200 truncate">{targetLabel || 'Destination'}</p>
              <p className="font-black tabular-nums text-sm">{money(targetBalance)}</p>
              <p className="text-[11px] text-emerald-300 tabular-nums">→ {money(targetBalance + value)}</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
