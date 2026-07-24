import React, { useMemo, useState } from 'react';
import { CreditCard, Plus, TrendingDown, Calendar, Layers } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizExpense } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import {
  PageHeader, StatCard, Badge, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Edit2, Trash2, Confirm, Modal, Field, Input, Textarea, Select,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';

export default function ModuleExpenses({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const { expenses } = biz.state;
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [form, setForm] = useState<BizExpense | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<BizExpense | null>(null);

  const cats = useMemo(() => Array.from(new Set(expenses.map(e => e.category).filter(Boolean))) as string[], [expenses]);
  const filtered = useMemo(() => [...expenses]
    .filter(e => (!search || e.name.toLowerCase().includes(search.toLowerCase())) && inPeriod(e.date, period, from, to))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [expenses, search, period, from, to]);
  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const del = () => { if (toDelete) { biz.remove('expenses', toDelete.id); toast.success('Dépense supprimée'); setToDelete(null); } };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={CreditCard} title="Dépenses" subtitle={`${cfg.label} — charges & dépenses`}
        actions={<button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvelle dépense</button>} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={TrendingDown} label="Dépenses" value={filtered.length} tone="blue" />
        <StatCard icon={CreditCard} label="Total période" value={money(total)} tone="red" />
        <StatCard icon={Layers} label="Catégories" value={cats.length} tone="purple" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom de la dépense…" />
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? <EmptyState icon={CreditCard} title="Aucune dépense" action={<button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouvelle dépense</button>} /> : (
        <CardGrid>
          {filtered.map(e => (
            <GlassCard key={e.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="font-black text-slate-800 truncate">{e.name}</h3>{e.category && <Badge tone="primary">{e.category}</Badge>}</div>
                <span className="font-black text-red-600 tabular-nums">{money(e.amount)}</span>
              </div>
              {e.description && <p className="text-xs text-slate-400 mt-2 line-clamp-2">{e.description}</p>}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-400 flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(e.date)}</span>
                <RowActions>
                  <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setForm(e)} />
                  <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(e)} />
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      )}

      {form && <ExpenseForm moduleKey={moduleKey} initial={form === 'new' ? null : form} cats={cats} onClose={() => setForm(null)} />}
      <Confirm open={!!toDelete} title="Supprimer la dépense" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function ExpenseForm({ moduleKey, initial, cats, onClose }: { moduleKey: ModuleKey; initial: BizExpense | null; cats: string[]; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const isEdit = !!initial;
  const [f, setF] = useState<Partial<BizExpense>>(initial || { name: '', description: '', amount: 0, date: new Date().toISOString().split('T')[0], category: '' });
  const set = (k: keyof BizExpense, v: any) => setF(p => ({ ...p, [k]: v }));
  const save = () => {
    if (!f.name?.trim()) { toast.error('Nom requis'); return; }
    const exp: BizExpense = { id: initial?.id || newId(), name: f.name!.trim(), description: f.description, amount: Number(f.amount) || 0, date: f.date || new Date().toISOString().split('T')[0], category: f.category };
    if (isEdit) biz.update('expenses', exp); else biz.add('expenses', exp);
    toast.success(isEdit ? 'Dépense modifiée' : 'Dépense créée'); onClose();
  };
  return (
    <Modal open onClose={onClose} icon={CreditCard} size="md" title={isEdit ? 'Modifier la dépense' : 'Nouvelle dépense'}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Créer'}</button></>}>
      <div className="space-y-4">
        <Field label="Nom" required><Input value={f.name || ''} onChange={e => set('name', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)"><Input type="number" value={f.amount ?? 0} onChange={e => set('amount', e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={f.date || ''} onChange={e => set('date', e.target.value)} /></Field>
        </div>
        <Field label="Catégorie"><Input list="exp-cats" value={f.category || ''} onChange={e => set('category', e.target.value)} placeholder="Ex: Charges, Loyer…" />
          <datalist id="exp-cats">{cats.map(c => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Description"><Textarea value={f.description || ''} onChange={e => set('description', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
