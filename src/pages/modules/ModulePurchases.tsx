import React, { useMemo, useState } from 'react';
import {
  ShoppingCart, Plus, Search, Trash2 as TrashIcon, X, Truck, Receipt, Wallet, CircleDollarSign, Package,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizPurchase, BizLineItem, BizProduct } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Eye, Edit2, Trash2, Confirm, Modal, Field, Input, Select, Switch, money, formatDate,
} from '@/src/components/biz/Kit';
import { ProductModal, ContactModal, PayDebtModal, printInvoice } from './_shared';

export default function ModulePurchases({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const { settings } = useAppState();
  const { purchases, products, suppliers } = biz.state;

  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizPurchase | null>(null);
  const [viewing, setViewing] = useState<BizPurchase | null>(null);
  const [paying, setPaying] = useState<BizPurchase | null>(null);
  const [toDelete, setToDelete] = useState<BizPurchase | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...purchases]
      .filter(p => !q || p.ref.toLowerCase().includes(q) || p.supplierName.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [purchases, search]);

  const stats = useMemo(() => ({
    count: purchases.length,
    total: purchases.reduce((s, p) => s + p.total, 0),
    paid: purchases.reduce((s, p) => s + p.paid, 0),
    rest: purchases.reduce((s, p) => s + p.rest, 0),
  }), [purchases]);

  const del = () => { if (toDelete) { biz.remove('purchases', toDelete.id); toast.success('Achat supprimé'); setToDelete(null); } };

  const onPay = (amount: number) => {
    if (!paying) return;
    const paid = Math.min(paying.total, paying.paid + amount);
    biz.update('purchases', { ...paying, paid, rest: Math.max(0, paying.total - paid) });
    toast.success('Paiement enregistré');
    setPaying(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={ShoppingCart} title="Achats" subtitle={`${cfg.label} — factures fournisseurs`}
        actions={<button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Nouvel achat</button>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Receipt} label="Achats" value={stats.count} tone="blue" />
        <StatCard icon={CircleDollarSign} label="Total achats" value={money(stats.total)} tone="purple" />
        <StatCard icon={Wallet} label="Payé" value={money(stats.paid)} tone="green" />
        <StatCard icon={Wallet} label="Dettes fournisseurs" value={money(stats.rest)} tone="red" />
      </div>

      <div className="card-glass p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Réf ou fournisseur…" />
        <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="Aucun achat" message="Créez votre première facture d'achat."
          action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Nouvel achat</button>} />
      ) : view === 'grid' ? (
        <CardGrid>
          {filtered.map(p => (
            <GlassCard key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-800">{p.ref}</h3>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><Truck className="w-3 h-3" />{p.supplierName}</p>
                </div>
                {p.rest > 0 ? <Badge tone="danger">Crédit</Badge> : <Badge tone="success">Payé</Badge>}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{formatDate(p.date)} • {p.items.length} article(s)</p>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(p.total)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(p.paid)}</p></div>
                <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(p.rest)}</p></div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(p); setShowForm(true); }} />
                  {p.rest > 0 && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(p)} />}
                  <ActionBtn icon={Receipt} tone="slate" title="Imprimer" onClick={() => printInvoice({
                    title: 'Facture d\'achat', ref: p.ref, date: p.date, store: settings?.stationName,
                    party: { label: 'Fournisseur', name: p.supplierName },
                    items: p.items.map(i => ({ name: i.productName, qty: i.qty, unitPrice: i.unitPrice, total: i.qty * i.unitPrice })),
                    total: p.total, paid: p.paid, rest: p.rest,
                  })} />
                  <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      ) : (
        <Table head={<>
          <th className="table-head">Réf</th><th className="table-head">Fournisseur</th><th className="table-head">Date</th>
          <th className="table-head">Articles</th><th className="table-head">Total</th><th className="table-head">Payé</th>
          <th className="table-head">Reste</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(p => (
            <tr key={p.id}>
              <td className="table-cell font-bold">{p.ref}</td>
              <td className="table-cell">{p.supplierName}</td>
              <td className="table-cell">{formatDate(p.date)}</td>
              <td className="table-cell tabular-nums">{p.items.length}</td>
              <td className="table-cell tabular-nums">{money(p.total)}</td>
              <td className="table-cell tabular-nums text-emerald-600">{money(p.paid)}</td>
              <td className="table-cell tabular-nums text-red-600">{money(p.rest)}</td>
              <td className="table-cell">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(p); setShowForm(true); }} />
                  {p.rest > 0 && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(p)} />}
                  <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />
                </RowActions>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {showForm && <PurchaseForm moduleKey={moduleKey} initial={editing} onClose={() => setShowForm(false)} />}

      {/* View */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={Receipt} size="lg" title={`Achat ${viewing?.ref || ''}`} subtitle={viewing?.supplierName}>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Fournisseur</p><p className="font-bold text-slate-700">{viewing.supplierName}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Date</p><p className="font-bold text-slate-700">{formatDate(viewing.date)}</p></div>
            </div>
            <Table head={<><th className="table-head">Produit</th><th className="table-head">Qté</th><th className="table-head">P.U</th><th className="table-head">Total</th></>}>
              {viewing.items.map((it, i) => (
                <tr key={i}><td className="table-cell">{it.productName}</td><td className="table-cell tabular-nums">{it.qty}</td>
                  <td className="table-cell tabular-nums">{money(it.unitPrice)}</td><td className="table-cell tabular-nums font-bold">{money(it.qty * it.unitPrice)}</td></tr>
              ))}
            </Table>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums">{money(viewing.total)}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums">{money(viewing.paid)}</p></div>
              <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums">{money(viewing.rest)}</p></div>
            </div>
          </div>
        )}
      </Modal>

      <PayDebtModal open={!!paying} onClose={() => setPaying(null)} total={paying?.total || 0} alreadyPaid={paying?.paid || 0} onPay={onPay} />
      <Confirm open={!!toDelete} title="Supprimer l'achat" message={`Supprimer la facture ${toDelete?.ref} ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Create / Edit purchase ─────────────────────────────────────────────────────
function PurchaseForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizPurchase | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const { products, suppliers } = biz.state;
  const isEdit = !!initial;

  const [items, setItems] = useState<BizLineItem[]>(initial?.items || []);
  const [pQuery, setPQuery] = useState('');
  const [supplierId, setSupplierId] = useState(initial?.supplierId || '');
  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  const [paidStr, setPaidStr] = useState<string>(initial ? String(initial.paid) : '');
  const [showProductModal, setShowProductModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);

  const total = useMemo(() => items.reduce((s, it) => s + it.qty * it.unitPrice, 0), [items]);
  const paid = paidStr === '' ? total : Number(paidStr);
  const rest = Math.max(0, total - paid);

  const matches = useMemo(() => {
    const q = pQuery.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)).slice(0, 6);
  }, [products, pQuery]);

  const addProduct = (p: BizProduct) => {
    if (items.some(it => it.productId === p.id)) { toast.error('Produit déjà ajouté'); return; }
    setItems(prev => [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice: p.purchasePrice, minQty: p.minQty, hasExpiration: p.hasExpiration, expirationDate: p.expirationDate }]);
    setPQuery('');
  };
  const updItem = (id: string, patch: Partial<BizLineItem>) => setItems(prev => prev.map(it => it.productId === id ? { ...it, ...patch } : it));
  const rmItem = (id: string) => setItems(prev => prev.filter(it => it.productId !== id));

  const save = () => {
    if (items.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    if (!supplierId) { toast.error('Sélectionnez un fournisseur'); return; }
    const supplier = suppliers.find(s => s.id === supplierId);
    const purchase: BizPurchase = {
      id: initial?.id || newId(),
      ref: initial?.ref || `A-${String(biz.state.purchases.length + 1).padStart(4, '0')}`,
      supplierId, supplierName: supplier?.name || '—',
      items, total, paid, rest, date: new Date(date).toISOString(),
      createdAt: initial?.createdAt || new Date().toISOString(), createdBy: 'Admin',
    };
    if (isEdit) {
      biz.update('purchases', purchase);
    } else {
      biz.add('purchases', purchase);
      // Update stock levels from purchase
      items.forEach(it => {
        const prod = products.find(p => p.id === it.productId);
        if (prod) {
          biz.update('products', {
            ...prod,
            principalQty: prod.principalQty + it.qty,
            currentQty: prod.currentQty + it.qty,
            minQty: it.minQty ?? prod.minQty,
            purchasePrice: it.unitPrice,
            hasExpiration: it.hasExpiration ?? prod.hasExpiration,
            expirationDate: it.hasExpiration ? it.expirationDate : prod.expirationDate,
          });
        }
      });
    }
    toast.success(isEdit ? 'Achat modifié' : 'Achat créé, stock mis à jour');
    onClose();
  };

  return (
    <>
      <Modal open onClose={onClose} icon={ShoppingCart} size="xl" title={isEdit ? 'Modifier l\'achat' : 'Nouvel achat'} subtitle="Produits, fournisseur et paiement"
        footer={<>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Créer l\'achat'}</button>
        </>}>
        <div className="space-y-5">
          {/* Product search */}
          <div>
            <label className="label-field">Rechercher un produit (nom ou code-barres)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={pQuery} onChange={e => setPQuery(e.target.value)} placeholder="Tapez pour rechercher…" className="input-field pl-9" />
                {matches.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                    {matches.map(p => (
                      <button key={p.id} onClick={() => addProduct(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-700">{p.name}</span>
                        <span className="text-xs text-slate-400">{money(p.purchasePrice)} • stock {p.currentQty}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn-secondary shrink-0" onClick={() => setShowProductModal(true)}><Plus className="w-4 h-4" /> Nouveau produit</button>
            </div>
          </div>

          {/* Items */}
          {items.length > 0 ? (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50">
                  <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-slate-400">Produit</th>
                  <th className="px-2 py-2 text-[11px] font-bold uppercase text-slate-400">Qté</th>
                  <th className="px-2 py-2 text-[11px] font-bold uppercase text-slate-400">Seuil</th>
                  <th className="px-2 py-2 text-[11px] font-bold uppercase text-slate-400">Prix achat</th>
                  <th className="px-2 py-2 text-[11px] font-bold uppercase text-slate-400">Expiration</th>
                  <th className="px-2 py-2 text-[11px] font-bold uppercase text-slate-400 text-right">Total</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {items.map(it => (
                    <tr key={it.productId} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-semibold text-slate-700">{it.productName}</td>
                      <td className="px-2 py-2"><input type="number" value={it.qty} onChange={e => updItem(it.productId, { qty: Number(e.target.value) })} className="input-field !py-1.5 !px-2 w-16 text-center" /></td>
                      <td className="px-2 py-2"><input type="number" value={it.minQty ?? 0} onChange={e => updItem(it.productId, { minQty: Number(e.target.value) })} className="input-field !py-1.5 !px-2 w-16 text-center" /></td>
                      <td className="px-2 py-2"><input type="number" value={it.unitPrice} onChange={e => updItem(it.productId, { unitPrice: Number(e.target.value) })} className="input-field !py-1.5 !px-2 w-20 text-center" /></td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <Switch checked={!!it.hasExpiration} onChange={v => updItem(it.productId, { hasExpiration: v })} />
                          {it.hasExpiration && <input type="date" value={it.expirationDate || ''} onChange={e => updItem(it.productId, { expirationDate: e.target.value })} className="input-field !py-1 !px-2 w-32 text-xs" />}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">{money(it.qty * it.unitPrice)}</td>
                      <td className="px-2"><button onClick={() => rmItem(it.productId)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg"><X className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
              <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" /> Aucun produit ajouté
            </div>
          )}

          {/* Supplier + payment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Fournisseur" required>
              <div className="flex gap-2">
                <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <button className="btn-secondary !px-3 shrink-0" onClick={() => setShowSupplierModal(true)}><Plus className="w-4 h-4" /></button>
              </div>
            </Field>
            <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          </div>

          <div className="rounded-2xl bg-[#001f5c] text-white p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-blue-200">Total de l'achat</span>
              <span className="text-2xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-blue-200">Montant payé</label>
                <input type="number" value={paidStr} onChange={e => setPaidStr(e.target.value)} placeholder={String(total)} className="input-field mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-blue-200">Reste à payer</label>
                <div className="mt-1 h-[46px] rounded-xl bg-white/10 flex items-center px-4 font-black text-lg tabular-nums text-red-300">{money(rest)}</div>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ProductModal biz={biz} open={showProductModal} onClose={() => setShowProductModal(false)} onSaved={(p) => addProduct(p)} />
      <ContactModal biz={biz} coll="suppliers" open={showSupplierModal} onClose={() => setShowSupplierModal(false)} onSaved={(s) => setSupplierId(s.id)} />
    </>
  );
}
