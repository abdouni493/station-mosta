import React, { useMemo, useState } from 'react';
import {
  Wallet, PiggyBank, ArrowDownCircle, ArrowUpCircle, Plus, TrendingUp, TrendingDown, Layers,
  Edit2, Trash2, Boxes, ShoppingCart, CreditCard, Banknote, Beaker,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizCaisseTx } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Switch, Confirm,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';

export default function ModuleCaisse({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'caisse');
  const { caisse, sales, purchases, expenses, workers, products, comptoir } = biz.state;

  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [form, setForm] = useState<BizCaisseTx | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<BizCaisseTx | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);

  // ── Global totals (for balance) ──
  const totals = useMemo(() => {
    const deposits = caisse.filter(c => c.type === 'deposit').reduce((s, c) => s + c.amount, 0);
    const withdrawals = caisse.filter(c => c.type === 'withdraw').reduce((s, c) => s + c.amount, 0);
    const salesPaid = sales.reduce((s, x) => s + x.paid, 0);
    const purchasesPaid = purchases.reduce((s, x) => s + x.paid, 0);
    const exp = expenses.reduce((s, x) => s + x.amount, 0);
    const salaries = workers.reduce((s, w) => s + w.payments.reduce((a, p) => a + p.amount, 0), 0);
    const balance = deposits + salesPaid - withdrawals - purchasesPaid - exp - salaries;
    const stockValue = products.reduce((s, p) => s + p.currentQty * p.purchasePrice, 0);
    const comptoirValue = comptoir.reduce((s, c) => s + c.qty * c.unitPrice, 0);
    return { deposits, withdrawals, salesPaid, purchasesPaid, exp, salaries, balance, stockValue, comptoirValue, tresorerie: balance + stockValue + comptoirValue };
  }, [caisse, sales, purchases, expenses, workers, products, comptoir]);

  // ── Period flows ──
  const flow = useMemo(() => {
    const inTx = caisse.filter(c => c.type === 'deposit' && inPeriod(c.date, period, from, to)).reduce((s, c) => s + c.amount, 0);
    const salesIn = sales.filter(s => inPeriod(s.date, period, from, to)).reduce((s, x) => s + x.paid, 0);
    const outTx = caisse.filter(c => c.type === 'withdraw' && inPeriod(c.date, period, from, to)).reduce((s, c) => s + c.amount, 0);
    const purchOut = purchases.filter(p => inPeriod(p.date, period, from, to)).reduce((s, x) => s + x.paid, 0);
    const expOut = expenses.filter(e => inPeriod(e.date, period, from, to)).reduce((s, x) => s + x.amount, 0);
    const inTotal = inTx + salesIn; const outTotal = outTx + purchOut + expOut;
    return { inTotal, outTotal, net: inTotal - outTotal };
  }, [caisse, sales, purchases, expenses, period, from, to]);

  // ── Category breakdown ──
  const byCat = (type: 'deposit' | 'withdraw') => {
    const m: Record<string, number> = {};
    caisse.filter(c => c.type === type && inPeriod(c.date, period, from, to)).forEach(c => { const k = c.category || 'Autre'; m[k] = (m[k] || 0) + c.amount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const deposCats = byCat('deposit'); const withCats = byCat('withdraw');
  const maxDepo = Math.max(1, ...deposCats.map(x => x[1])); const maxWith = Math.max(1, ...withCats.map(x => x[1]));

  const txList = useMemo(() => [...caisse]
    .filter(c => inPeriod(c.date, period, from, to) && (!catFilter || (c.category || 'Autre') === catFilter))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [caisse, period, from, to, catFilter]);

  const del = () => { if (toDelete) { biz.remove('caisse', toDelete.id); toast.success('Transaction supprimée'); setToDelete(null); } };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Wallet} title="Caisse" subtitle={`${cfg.label} — trésorerie & mouvements`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Dépôt / Retrait</button> : undefined} />

      {/* Hero banners */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #001f5c, #003087)' }}>
          <div className="flex items-center gap-2 text-blue-200"><Wallet className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Solde de caisse</span></div>
          <p className="text-4xl font-black tabular-nums mt-2 text-[#FFB800]">{money(totals.balance)}</p>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase text-blue-200 font-bold">Encaissements</p><p className="font-black tabular-nums text-emerald-300">{money(totals.deposits + totals.salesPaid)}</p></div>
            <div className="rounded-xl bg-white/10 p-3"><p className="text-[10px] uppercase text-blue-200 font-bold">Décaissements</p><p className="font-black tabular-nums text-red-300">{money(totals.withdrawals + totals.purchasesPaid + totals.exp + totals.salaries)}</p></div>
          </div>
        </div>
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}>
          <div className="flex items-center gap-2 text-emerald-100"><PiggyBank className="w-5 h-5" /><span className="text-sm font-bold uppercase tracking-wide">Trésorerie globale</span></div>
          <p className="text-4xl font-black tabular-nums mt-2">{money(totals.tresorerie)}</p>
          <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Caisse</p><p className="font-black tabular-nums">{money(totals.balance)}</p></div>
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Comptoir</p><p className="font-black tabular-nums">{money(totals.comptoirValue)}</p></div>
            <div className="rounded-xl bg-white/10 p-2.5"><p className="text-[10px] uppercase text-emerald-100 font-bold">Stock</p><p className="font-black tabular-nums">{money(totals.stockValue)}</p></div>
          </div>
        </div>
      </div>

      {/* Period */}
      <div className="card-glass p-4"><PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} /></div>

      {/* Flow cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-emerald-600"><ArrowDownCircle className="w-5 h-5" /><span className="text-xs font-bold uppercase">Entrées</span></div><p className="text-2xl font-black tabular-nums text-emerald-600 mt-2">+{money(flow.inTotal)}</p></div>
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-red-600"><ArrowUpCircle className="w-5 h-5" /><span className="text-xs font-bold uppercase">Sorties</span></div><p className="text-2xl font-black tabular-nums text-red-600 mt-2">−{money(flow.outTotal)}</p></div>
        <div className="card-glass p-5"><div className="flex items-center gap-2 text-[#003087]"><TrendingUp className="w-5 h-5" /><span className="text-xs font-bold uppercase">Flux net</span></div><p className={`text-2xl font-black tabular-nums mt-2 ${flow.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(flow.net)}</p></div>
      </div>

      {/* Business stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={TrendingUp} label="Ventes encaissées" value={money(totals.salesPaid)} tone="green" />
        <StatCard icon={ShoppingCart} label="Achats payés" value={money(totals.purchasesPaid)} tone="purple" />
        <StatCard icon={CreditCard} label="Dépenses" value={money(totals.exp)} tone="red" />
        <StatCard icon={Banknote} label="Salaires versés" value={money(totals.salaries)} tone="amber" />
      </div>

      {/* Category breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CategoryCard title="Dépôts par catégorie" icon={ArrowDownCircle} rows={deposCats} max={maxDepo} tone="emerald" onClick={setCatFilter} active={catFilter} />
        <CategoryCard title="Retraits par catégorie" icon={ArrowUpCircle} rows={withCats} max={maxWith} tone="red" onClick={setCatFilter} active={catFilter} />
      </div>

      {/* Transactions history */}
      <div className="card-glass overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-black text-[#002d87] flex items-center gap-2"><Layers className="w-5 h-5" /> Transactions de caisse</h3>
          {catFilter && <button onClick={() => setCatFilter(null)} className="text-xs text-slate-400 hover:text-red-500">Retirer filtre: {catFilter}</button>}
        </div>
        {txList.length === 0 ? <p className="text-center text-slate-400 text-sm py-8">Aucune transaction sur la période</p> : (
          <div className="divide-y divide-slate-100">
            {txList.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tx.type === 'deposit' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                  {tx.type === 'deposit' ? <ArrowDownCircle className="w-5 h-5" /> : <ArrowUpCircle className="w-5 h-5" />}</div>
                <div className="flex-1 min-w-0"><p className="font-bold text-slate-700 truncate">{tx.description || (tx.type === 'deposit' ? 'Dépôt' : 'Retrait')}</p>
                  <p className="text-xs text-slate-400">{formatDate(tx.date)} {tx.category && <>• <Badge tone="neutral">{tx.category}</Badge></>}</p></div>
                <span className={`font-black tabular-nums ${tx.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}`}>{tx.type === 'deposit' ? '+' : '−'}{money(tx.amount)}</span>
                <div className="flex items-center gap-1">
                  {perm.modifier && <button onClick={() => setForm(tx)} className="w-8 h-8 rounded-lg text-amber-600 hover:bg-amber-50 flex items-center justify-center"><Edit2 className="w-4 h-4" /></button>}
                  {perm.supprimer && <button onClick={() => setToDelete(tx)} className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {form && <TxForm moduleKey={moduleKey} initial={form === 'new' ? null : form} onClose={() => setForm(null)} />}
      <Confirm open={!!toDelete} title="Supprimer la transaction" message="Confirmer la suppression ?" onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function CategoryCard({ title, icon: Icon, rows, max, tone, onClick, active }: {
  title: string; icon: React.ElementType; rows: [string, number][]; max: number; tone: 'emerald' | 'red'; onClick: (c: string | null) => void; active: string | null;
}) {
  return (
    <div className="card-glass p-5">
      <h3 className="font-black text-[#002d87] flex items-center gap-2 mb-3"><Icon className="w-5 h-5" /> {title}</h3>
      {rows.length === 0 ? <p className="text-slate-400 text-sm">Aucune donnée</p> : (
        <div className="space-y-2.5">
          {rows.map(([cat, val]) => (
            <button key={cat} onClick={() => onClick(active === cat ? null : cat)} className={`w-full text-left ${active === cat ? 'opacity-100' : ''}`}>
              <div className="flex items-center justify-between text-sm mb-1"><span className="font-semibold text-slate-600">{cat}</span><span className="font-bold tabular-nums text-slate-700">{money(val)}</span></div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${tone === 'emerald' ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${(val / max) * 100}%` }} /></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TxForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizCaisseTx | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const isEdit = !!initial;
  const [type, setType] = useState<'deposit' | 'withdraw'>(initial?.type || 'deposit');
  const [amount, setAmount] = useState(initial?.amount || 0);
  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState(initial?.category || '');
  const [description, setDescription] = useState(initial?.description || '');
  const save = () => {
    if (amount <= 0) { toast.error('Montant requis'); return; }
    const tx: BizCaisseTx = { id: initial?.id || newId(), type, amount: Number(amount), date: new Date(date).toISOString(), category, description };
    if (isEdit) biz.update('caisse', tx); else biz.add('caisse', tx);
    toast.success(isEdit ? 'Transaction modifiée' : 'Transaction enregistrée'); onClose();
  };
  return (
    <Modal open onClose={onClose} icon={Wallet} size="md" title={isEdit ? 'Modifier la transaction' : 'Dépôt / Retrait'}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Valider'}</button></>}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setType('deposit')} className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 ${type === 'deposit' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}><ArrowDownCircle className="w-4 h-4" /> Dépôt (Entrée)</button>
          <button onClick={() => setType('withdraw')} className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 ${type === 'withdraw' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-500'}`}><ArrowUpCircle className="w-4 h-4" /> Retrait (Sortie)</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)"><Input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Catégorie"><Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Ex: Apport, Retrait, Frais…" /></Field>
        <Field label="Description"><Textarea value={description} onChange={e => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
