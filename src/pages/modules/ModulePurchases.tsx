import React, { useMemo, useState } from 'react';
import {
  ShoppingCart, Plus, Search, Trash2 as TrashIcon, X, Truck, Receipt, Wallet, CircleDollarSign, Package,
  Tag, Banknote, Droplet,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizPurchase, BizLineItem, BizProduct, detailPrice } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import { useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Eye, Edit2, Trash2, Confirm, Modal, Field, Input, Select, Switch, FormSection,
  money, formatDate,
} from '@/src/components/biz/Kit';
import { ProductModal, ContactModal, PayDebtModal, printInvoice } from './_shared';

export default function ModulePurchases({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'purchases');
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
        actions={perm.creer ? <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Nouvel achat</button> : undefined} />

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
          action={perm.creer ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Nouvel achat</button> : undefined} />
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
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(p); setShowForm(true); }} />}
                  {p.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(p)} />}
                  <ActionBtn icon={Receipt} tone="slate" title="Imprimer" onClick={() => printInvoice({
                    title: 'Facture d\'achat', ref: p.ref, date: p.date, store: settings?.stationName,
                    party: { label: 'Fournisseur', name: p.supplierName },
                    items: p.items.map(i => ({ name: i.productName, qty: i.qty, unitPrice: i.unitPrice, total: i.qty * i.unitPrice })),
                    total: p.total, paid: p.paid, rest: p.rest,
                  })} />
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
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
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(p); setShowForm(true); }} />}
                  {p.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(p)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                </RowActions>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {showForm && <PurchaseForm moduleKey={moduleKey} initial={editing} onClose={() => setShowForm(false)} />}

      {/* View */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={Receipt} size="xl" title={`Achat ${viewing?.ref || ''}`} subtitle={viewing?.supplierName}>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Fournisseur</p><p className="font-bold text-slate-700">{viewing.supplierName}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Date</p><p className="font-bold text-slate-700">{formatDate(viewing.date)}</p></div>
            </div>
            <Table head={<>
              <th className="table-head">Produit</th><th className="table-head">Qté</th>
              <th className="table-head">Prix achat</th><th className="table-head">Prix vente</th>
              <th className="table-head">Prix détail</th><th className="table-head">Total</th>
            </>}>
              {viewing.items.map((it, i) => (
                <tr key={i}>
                  <td className="table-cell">{it.productName}</td>
                  <td className="table-cell tabular-nums">{it.qty}</td>
                  <td className="table-cell tabular-nums">{money(it.unitPrice)}</td>
                  <td className="table-cell tabular-nums">{it.salePrice !== undefined ? money(it.salePrice) : '—'}</td>
                  <td className="table-cell tabular-nums text-xs text-slate-500">
                    {it.detailSalePrice ? `${money(it.detailSalePrice)} / ${it.detailUnit || 'L'}` : '—'}
                  </td>
                  <td className="table-cell tabular-nums font-bold">{money(it.qty * it.unitPrice)}</td>
                </tr>
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
  /** Expected margin of the whole basket, at the sale prices typed on the lines. */
  const expectedMargin = useMemo(
    () => items.reduce((s, it) => s + it.qty * ((it.salePrice ?? 0) - it.unitPrice), 0), [items]);

  const matches = useMemo(() => {
    const q = pQuery.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)).slice(0, 8);
  }, [products, pQuery]);

  /**
   * Adds a product to the achat. The line is preloaded with the product's
   * current commercial settings (prix d'achat, prix de vente, seuil, prix au
   * détail) so the user only edits what this delivery changes.
   */
  const addProduct = (p: BizProduct) => {
    if (items.some(it => it.productId === p.id)) { toast.error('Produit déjà ajouté'); return; }
    setItems(prev => [...prev, {
      productId: p.id, productName: p.name,
      qty: 1,
      unitPrice: p.purchasePrice,
      salePrice: p.salePrice,
      minQty: p.minQty,
      hasExpiration: p.hasExpiration, expirationDate: p.expirationDate,
      sellByDetail: !!p.sellByDetail,
      detailCapacity: p.detailCapacity,
      detailUnit: p.detailUnit || 'L',
      detailSalePrice: p.sellByDetail ? detailPrice(p) : undefined,
    }]);
    setPQuery('');
  };
  const updItem = (id: string, patch: Partial<BizLineItem>) => setItems(prev => prev.map(it => it.productId === id ? { ...it, ...patch } : it));
  const rmItem = (id: string) => setItems(prev => prev.filter(it => it.productId !== id));

  /** Writes a line's commercial settings back onto the product it points to. */
  const applyToProduct = (it: BizLineItem, addStock: boolean) => {
    const prod = products.find(p => p.id === it.productId);
    if (!prod) return;
    biz.update('products', {
      ...prod,
      principalQty: addStock ? prod.principalQty + it.qty : prod.principalQty,
      currentQty: addStock ? prod.currentQty + it.qty : prod.currentQty,
      minQty: it.minQty ?? prod.minQty,
      purchasePrice: it.unitPrice,
      salePrice: it.salePrice ?? prod.salePrice,
      hasExpiration: it.hasExpiration ?? prod.hasExpiration,
      expirationDate: it.hasExpiration ? it.expirationDate : prod.expirationDate,
      // Le prix au détail n'est écrit que si le produit est vendu au détail ;
      // 0 ⇒ le POS retombe sur prix de vente ÷ contenance.
      detailSalePrice: prod.sellByDetail
        ? (Number(it.detailSalePrice) > 0 ? Number(it.detailSalePrice) : undefined)
        : prod.detailSalePrice,
    });
  };

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
      // Le stock n'est ajouté qu'à la création — une modification ne réapplique
      // que les prix et le seuil, sinon la quantité serait comptée deux fois.
      items.forEach(it => applyToProduct(it, false));
    } else {
      biz.add('purchases', purchase);
      items.forEach(it => applyToProduct(it, true));
    }
    toast.success(isEdit ? 'Achat modifié — prix mis à jour' : 'Achat créé, stock et prix mis à jour');
    onClose();
  };

  return (
    <>
      <Modal open onClose={onClose} icon={ShoppingCart} size="3xl"
        title={isEdit ? 'Modifier l\'achat' : 'Nouvel achat'}
        subtitle="Produits reçus, prix de vente, fournisseur et paiement"
        footer={<>
          <div className="mr-auto flex items-center gap-4 text-xs font-bold">
            <span className="text-slate-400 uppercase tracking-widest">{items.length} produit(s)</span>
            <span className="text-[#002d87]">Total {money(total)}</span>
            {rest > 0 && <span className="text-red-600">Dette {money(rest)}</span>}
          </div>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Créer l\'achat'}</button>
        </>}>
        <div className="space-y-4">
          {/* 1. Produits — recherche puis saisie ligne par ligne */}
          <FormSection step={1} icon={Package} title="Produits achetés"
            hint="Cherchez un produit, sélectionnez-le, puis renseignez ses quantités et ses prix"
            action={
              <button className="btn-secondary !py-1.5 !px-3 text-xs shrink-0" onClick={() => setShowProductModal(true)}>
                <Plus className="w-3.5 h-3.5" /> Nouveau produit
              </button>
            }>
            <div className="relative mb-4">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={pQuery} onChange={e => setPQuery(e.target.value)}
                placeholder="Rechercher un produit par nom ou code-barres…" className="input-field pl-9" />
              {matches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden max-h-72 overflow-y-auto custom-scrollbar">
                  {matches.map(p => {
                    const already = items.some(it => it.productId === p.id);
                    return (
                      <button key={p.id} onClick={() => addProduct(p)} disabled={already}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-3 disabled:opacity-40 disabled:cursor-not-allowed border-b border-slate-50 last:border-0">
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-slate-700 truncate">{p.name}</span>
                          <span className="block text-[11px] text-slate-400 truncate">
                            {p.categoryName || 'Sans catégorie'}{p.barcode ? ` • ${p.barcode}` : ''}
                            {p.sellByDetail ? ' • vendu au détail' : ''}
                          </span>
                        </span>
                        <span className="text-xs text-slate-400 shrink-0 text-right">
                          <span className="block">Achat {money(p.purchasePrice)}</span>
                          <span className="block">Stock {p.currentQty}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
                <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" /> Aucun produit ajouté —
                cherchez-en un ci-dessus pour commencer.
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((it, idx) => {
                  const prod = products.find(p => p.id === it.productId);
                  const lineTotal = it.qty * it.unitPrice;
                  const unitMargin = (it.salePrice ?? 0) - it.unitPrice;
                  const marginPct = it.unitPrice > 0 ? (unitMargin / it.unitPrice) * 100 : 0;
                  const detailUnit = it.detailUnit || prod?.detailUnit || 'L';
                  const capacity = Number(it.detailCapacity ?? prod?.detailCapacity) || 0;
                  const autoDetail = capacity > 0 ? (it.salePrice ?? 0) / capacity : 0;
                  return (
                    <div key={it.productId} className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                      {/* Line header */}
                      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200">
                        <span className="w-6 h-6 rounded-lg bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-[10px] font-black shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-slate-800 truncate">{it.productName}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            Stock actuel {prod?.currentQty ?? 0} {prod?.unit || 'unité'}
                            {prod ? ` → ${(prod.currentQty + (Number(it.qty) || 0)).toLocaleString('fr-FR')} après réception` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0 hidden sm:block">
                          <p className="text-[10px] uppercase font-bold text-slate-400">Total ligne</p>
                          <p className="font-black tabular-nums text-[#002d87]">{money(lineTotal)}</p>
                        </div>
                        <button onClick={() => rmItem(it.productId)} title="Retirer le produit"
                          className="text-red-500 hover:bg-red-50 p-2 rounded-lg shrink-0"><X className="w-4 h-4" /></button>
                      </div>

                      {/* Quantité + prix d'achat + prix de vente + seuil */}
                      <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Field label="Quantité reçue">
                          <Input type="number" step="0.01" min={0} value={it.qty}
                            onChange={e => updItem(it.productId, { qty: Number(e.target.value) })}
                            className="text-right font-bold" />
                        </Field>
                        <Field label="Prix d'achat (DA)">
                          <Input type="number" step="0.01" min={0} value={it.unitPrice}
                            onChange={e => updItem(it.productId, { unitPrice: Number(e.target.value) })}
                            className="text-right font-bold" />
                        </Field>
                        <Field label="Prix de vente (DA)">
                          <Input type="number" step="0.01" min={0} value={it.salePrice ?? 0}
                            onChange={e => updItem(it.productId, { salePrice: Number(e.target.value) })}
                            className="text-right font-bold" />
                        </Field>
                        <Field label="Quantité minimale">
                          <Input type="number" step="1" min={0} value={it.minQty ?? 0}
                            onChange={e => updItem(it.productId, { minQty: Number(e.target.value) })}
                            className="text-right font-bold" />
                        </Field>
                      </div>

                      {/* Vente au détail — uniquement si le produit a l'option activée */}
                      {prod?.sellByDetail && (
                        <div className="mx-4 mb-4 rounded-xl border border-[#003087]/15 bg-[#eef3fc] p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Droplet className="w-3.5 h-3.5 text-[#002d87]" />
                            <p className="text-[11px] font-black uppercase tracking-widest text-[#002d87]">
                              Vente au détail
                            </p>
                            <span className="text-[11px] text-slate-500">
                              1 {prod.unit || 'unité'} = {capacity.toLocaleString('fr-FR')} {detailUnit}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label={`Prix de vente d'un ${detailUnit} (DA)`}
                              hint={capacity > 0 ? `Prix automatique : ${money(autoDetail)} (prix de vente ÷ ${capacity.toLocaleString('fr-FR')})` : undefined}>
                              <Input type="number" step="0.01" min={0} value={it.detailSalePrice ?? 0}
                                onChange={e => updItem(it.productId, { detailSalePrice: Number(e.target.value) })}
                                className="text-right font-bold" />
                            </Field>
                            <div className="flex items-end">
                              <button type="button" className="btn-outline !py-2 !px-3 text-xs w-full"
                                onClick={() => updItem(it.productId, { detailSalePrice: Number(autoDetail.toFixed(2)) })}
                                disabled={capacity <= 0}>
                                Utiliser le prix automatique
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Expiration + marge */}
                      <div className="px-4 pb-4 flex flex-wrap items-center gap-4 justify-between">
                        <div className="flex items-center gap-2.5">
                          <Switch checked={!!it.hasExpiration} onChange={v => updItem(it.productId, { hasExpiration: v })} label="Date d'expiration" />
                          {it.hasExpiration && (
                            <input type="date" value={it.expirationDate || ''}
                              onChange={e => updItem(it.productId, { expirationDate: e.target.value })}
                              className="input-field !py-1.5 !px-2 !w-auto text-xs" />
                          )}
                        </div>
                        <p className={`text-[11px] font-bold ${unitMargin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          Marge unitaire {money(unitMargin)}
                          {it.unitPrice > 0 ? ` (${marginPct.toFixed(1)} %)` : ''}
                          {' • '}sur la ligne {money(unitMargin * it.qty)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </FormSection>

          {/* 2. Fournisseur & date */}
          <FormSection step={2} icon={Truck} title="Fournisseur & date">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Fournisseur" required>
                <div className="flex gap-2">
                  <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                    <option value="">— Sélectionner —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                  <button className="btn-secondary !px-3 shrink-0" title="Nouveau fournisseur" onClick={() => setShowSupplierModal(true)}><Plus className="w-4 h-4" /></button>
                </div>
              </Field>
              <Field label="Date de l'achat"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
            </div>
          </FormSection>

          {/* 3. Paiement */}
          <FormSection step={3} icon={Banknote} title="Paiement"
            hint="Laissez le montant payé vide pour régler la totalité">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Montant payé (DA)">
                  <Input type="number" step="0.01" value={paidStr} onChange={e => setPaidStr(e.target.value)}
                    placeholder={String(total)} className="text-right font-bold" />
                </Field>
                <Field label="Reste à payer">
                  <div className={`h-[46px] rounded-xl border flex items-center justify-end px-4 font-black tabular-nums ${rest > 0 ? 'bg-red-50 border-red-200 text-red-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600'}`}>
                    {money(rest)}
                  </div>
                </Field>
                <div className="sm:col-span-2 rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" /> Marge attendue
                  </span>
                  <span className={`font-black tabular-nums ${expectedMargin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {money(expectedMargin)}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl bg-[#001f5c] text-white p-5 space-y-2.5 text-sm self-start">
                <div className="flex justify-between"><span className="text-blue-200">Produits</span><span className="font-bold tabular-nums">{items.length}</span></div>
                <div className="flex justify-between"><span className="text-blue-200">Payé</span><span className="font-bold tabular-nums">{money(paid)}</span></div>
                <div className="flex justify-between"><span className="text-blue-200">Reste</span><span className="font-bold tabular-nums text-red-300">{money(rest)}</span></div>
                <div className="flex justify-between pt-3 border-t border-white/20">
                  <span className="font-semibold">Total de l'achat</span>
                  <span className="text-2xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
                </div>
              </div>
            </div>
          </FormSection>
        </div>
      </Modal>

      <ProductModal biz={biz} open={showProductModal} onClose={() => setShowProductModal(false)} onSaved={(p) => addProduct(p)} />
      <ContactModal biz={biz} coll="suppliers" open={showSupplierModal} onClose={() => setShowSupplierModal(false)} onSaved={(s) => setSupplierId(s.id)} />
    </>
  );
}
