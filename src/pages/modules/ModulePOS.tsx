import React, { useMemo, useState } from 'react';
import {
  ShoppingBag, Search, Plus, Minus, X, Trash2, User, UserPlus, Percent, Wallet, Check, Package,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizSale, BizLineItem } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import { PageHeader, Badge, Select, Input, money } from '@/src/components/biz/Kit';
import { ContactModal } from './_shared';

interface CartLine { id: string; name: string; unitPrice: number; qty: number; max: number; unit?: string; kind: 'comptoir' | 'product' }

export default function ModulePOS({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'pos');
  const { comptoir, products, clients } = biz.state;
  const useComptoir = cfg.hasComptoir;

  const source = useMemo(() => {
    if (useComptoir) return comptoir.filter(c => c.qty > 0).map(c => ({ id: c.id, name: c.productName, price: c.unitPrice, avail: c.qty, unit: c.unit, kind: 'comptoir' as const }));
    return products.filter(p => p.currentQty > 0).map(p => ({ id: p.id, name: p.name, price: p.salePrice, avail: p.currentQty, unit: p.unit, kind: 'product' as const }));
  }, [useComptoir, comptoir, products]);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientId, setClientId] = useState('');
  const [passage, setPassage] = useState(true);
  const [showClient, setShowClient] = useState(false);
  const [useReduction, setUseReduction] = useState(false);
  const [reduction, setReduction] = useState(0);
  const [paidStr, setPaidStr] = useState('');

  const filtered = source.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  const subtotal = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const total = Math.max(0, subtotal - (useReduction ? reduction : 0));
  const paid = paidStr === '' ? total : Number(paidStr);
  const rest = Math.max(0, total - paid);

  const addToCart = (s: typeof source[number]) => {
    setCart(prev => {
      const found = prev.find(l => l.id === s.id);
      if (found) { if (found.qty >= s.avail) { toast.error('Stock atteint'); return prev; } return prev.map(l => l.id === s.id ? { ...l, qty: l.qty + 1 } : l); }
      return [...prev, { id: s.id, name: s.name, unitPrice: s.price, qty: 1, max: s.avail, unit: s.unit, kind: s.kind }];
    });
  };
  const inc = (id: string) => setCart(prev => prev.map(l => l.id === id ? { ...l, qty: Math.min(l.max, l.qty + 1) } : l));
  const dec = (id: string) => setCart(prev => prev.flatMap(l => l.id === id ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l]));
  const rm = (id: string) => setCart(prev => prev.filter(l => l.id !== id));

  const checkout = () => {
    if (cart.length === 0) { toast.error('Panier vide'); return; }
    if (!passage && !clientId) { toast.error('Sélectionnez un client'); return; }
    if (passage && rest > 0) { toast.error('Un client est requis pour une vente à crédit'); return; }
    const client = clients.find(c => c.id === clientId);
    const items: BizLineItem[] = cart.map(l => ({ productId: l.id, productName: l.name, qty: l.qty, unitPrice: l.unitPrice, total: l.qty * l.unitPrice }));
    const sale: BizSale = {
      id: newId(), ref: `V-${String(biz.state.sales.length + 1).padStart(4, '0')}`,
      clientId: passage ? undefined : clientId, clientName: passage ? 'Client de passage' : (client?.name || '—'),
      items, subtotal, reduction: useReduction ? reduction : 0, total, paid, rest,
      date: new Date().toISOString(), status: rest > 0 ? 'crédit' : 'payée', createdBy: 'Admin',
    };
    biz.add('sales', sale);
    // Deduct stock
    cart.forEach(l => {
      if (l.kind === 'comptoir') { const c = comptoir.find(x => x.id === l.id); if (c) biz.update('comptoir', { ...c, qty: Math.max(0, c.qty - l.qty) }); }
      else { const p = products.find(x => x.id === l.id); if (p) biz.update('products', { ...p, currentQty: Math.max(0, p.currentQty - l.qty) }); }
    });
    toast.success('Vente enregistrée');
    setCart([]); setReduction(0); setUseReduction(false); setPaidStr(''); setClientId(''); setPassage(true);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader icon={ShoppingBag} title="Point de vente" subtitle={`${cfg.label} — caisse & encaissement`} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Products */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card-glass p-3">
            <div className="relative"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un produit…" className="input-field pl-9" /></div>
          </div>
          {filtered.length === 0 ? (
            <div className="card-glass p-12 text-center text-slate-400"><Package className="w-10 h-10 mx-auto mb-2 text-slate-300" />Aucun produit disponible</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map(s => (
                <button key={s.id} onClick={() => addToCart(s)} className="card-glass p-3 text-left card-hover">
                  <div className="w-full h-16 rounded-xl bg-gradient-to-br from-[#003087]/10 to-[#FFB800]/10 flex items-center justify-center mb-2"><Package className="w-6 h-6 text-[#003087]" /></div>
                  <p className="font-bold text-slate-700 text-sm leading-tight line-clamp-2">{s.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-black text-[#002d87] text-sm tabular-nums">{money(s.price)}</span>
                    <Badge tone={s.avail <= 5 ? 'warning' : 'neutral'}>{s.avail} {s.unit}</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="space-y-4">
          <div className="card-glass p-4">
            {/* Client */}
            <div className="mb-3">
              <div className="flex gap-2 mb-2">
                <button onClick={() => setPassage(true)} className={`flex-1 py-2 rounded-xl text-xs font-bold ${passage ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>Client de passage</button>
                <button onClick={() => setPassage(false)} className={`flex-1 py-2 rounded-xl text-xs font-bold ${!passage ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>Client</button>
              </div>
              {!passage && (
                <div className="flex gap-2">
                  <Select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">— Sélectionner —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}</Select>
                  <button className="btn-secondary !px-3 shrink-0" onClick={() => setShowClient(true)}><UserPlus className="w-4 h-4" /></button>
                </div>
              )}
            </div>

            {/* Cart lines */}
            <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar">
              {cart.length === 0 ? <p className="text-center text-slate-400 text-sm py-6">Panier vide</p> : cart.map(l => (
                <div key={l.id} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
                  <div className="flex-1 min-w-0"><p className="text-sm font-bold text-slate-700 truncate">{l.name}</p><p className="text-xs text-slate-400 tabular-nums">{money(l.unitPrice)} × {l.qty}</p></div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => dec(l.id)} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                    <span className="w-6 text-center text-sm font-bold tabular-nums">{l.qty}</span>
                    <button onClick={() => inc(l.id)} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                    <button onClick={() => rm(l.id)} className="w-6 h-6 rounded-md text-red-500 flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="card-glass p-4 space-y-3">
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">Sous-total</span><span className="font-bold tabular-nums">{money(subtotal)}</span></div>
            <div className="flex items-center justify-between">
              <button onClick={() => setUseReduction(v => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500"><Percent className="w-4 h-4" /> Réduction</button>
              {useReduction && <input type="number" value={reduction} onChange={e => setReduction(Number(e.target.value))} className="input-field !py-1.5 w-24 text-right" />}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#001f5c] text-white p-3">
              <span className="text-sm font-semibold text-blue-200">Total à payer</span><span className="text-xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[11px] font-bold uppercase text-slate-400">Payé</label><input type="number" value={paidStr} onChange={e => setPaidStr(e.target.value)} placeholder={String(total)} className="input-field mt-1" /></div>
              <div><label className="text-[11px] font-bold uppercase text-slate-400">Reste</label><div className="mt-1 h-[46px] rounded-xl bg-red-50 flex items-center px-3 font-black tabular-nums text-red-600">{money(rest)}</div></div>
            </div>
            <button className="btn-primary w-full" onClick={checkout} disabled={!perm.creer} title={perm.creer ? undefined : "Vous n'avez pas le droit d'enregistrer une vente"}><Check className="w-4 h-4" /> Valider la vente</button>
          </div>
        </div>
      </div>

      <ContactModal biz={biz} coll="clients" open={showClient} onClose={() => setShowClient(false)} onSaved={(c) => { setPassage(false); setClientId(c.id); }} />
    </div>
  );
}
