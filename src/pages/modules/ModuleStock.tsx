import React, { useMemo, useState } from 'react';
import { Package, Plus, Boxes, AlertTriangle, CalendarClock, Wallet, Barcode, Printer, Tag, Layers } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ModuleKey, MODULES, BizProduct } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, Select, ViewToggle, CardGrid, GlassCard,
  Table, EmptyState, RowActions, ActionBtn, Eye, Edit2, Trash2, Confirm, Modal, money, formatDate,
} from '@/src/components/biz/Kit';
import { ProductModal, printBarcode } from './_shared';

export default function ModuleStock({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'stock');
  const { products, categories, marques } = biz.state;

  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [mrq, setMrq] = useState('all');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizProduct | null>(null);
  const [viewing, setViewing] = useState<BizProduct | null>(null);
  const [toDelete, setToDelete] = useState<BizProduct | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p =>
      (!q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)) &&
      (cat === 'all' || p.categoryId === cat) &&
      (mrq === 'all' || p.marqueId === mrq));
  }, [products, search, cat, mrq]);

  const stats = useMemo(() => {
    const soon = new Date(); soon.setDate(soon.getDate() + 7);
    return {
      total: products.length,
      low: products.filter(p => p.currentQty <= p.minQty).length,
      value: products.reduce((s, p) => s + p.currentQty * p.purchasePrice, 0),
      expiring: products.filter(p => p.hasExpiration && p.expirationDate && new Date(p.expirationDate) <= soon).length,
    };
  }, [products]);

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (p: BizProduct) => { setEditing(p); setShowForm(true); };
  const del = () => { if (toDelete) { biz.remove('products', toDelete.id); toast.success('Produit supprimé'); setToDelete(null); } };

  const lowBadge = (p: BizProduct) => p.currentQty <= p.minQty;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Package} title="Gestion de stock" subtitle={`${cfg.label} — catalogue & inventaire`}
        actions={perm.creer ? <button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> Nouveau produit</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Boxes} label="Produits" value={stats.total} tone="blue" />
        <StatCard icon={AlertTriangle} label="Stock bas" value={stats.low} tone="red" sub="≤ seuil d'alerte" />
        <StatCard icon={Wallet} label="Valeur du stock" value={money(stats.value)} tone="green" />
        <StatCard icon={CalendarClock} label="Expirent bientôt" value={stats.expiring} tone="amber" sub="≤ 7 jours" />
      </div>

      <div className="card-glass p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom ou code-barres…" />
        <Select value={cat} onChange={e => setCat(e.target.value)} className="!w-auto min-w-[160px]">
          <option value="all">Toutes catégories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={mrq} onChange={e => setMrq(e.target.value)} className="!w-auto min-w-[150px]">
          <option value="all">Toutes marques</option>
          {marques.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="Aucun produit" message="Ajoutez votre premier produit au catalogue."
          action={perm.creer ? <button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> Nouveau produit</button> : undefined} />
      ) : view === 'grid' ? (
        <CardGrid>
          {filtered.map(p => (
            <GlassCard key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-black text-slate-800 truncate">{p.name}</h3>
                  <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mt-0.5"><Barcode className="w-3 h-3" />{p.barcode || '—'}</p>
                </div>
                {lowBadge(p) ? <Badge tone="danger">Stock bas</Badge> : <Badge tone="success">En stock</Badge>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {p.categoryName && <Badge tone="primary"><Layers className="w-3 h-3" />{p.categoryName}</Badge>}
                {p.marqueName && <Badge tone="neutral"><Tag className="w-3 h-3" />{p.marqueName}</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-xl bg-slate-50 p-2.5">
                  <p className="text-[10px] uppercase font-bold text-slate-400">Principal</p>
                  <p className="font-black text-slate-700 tabular-nums">{p.principalQty} <span className="text-xs font-medium text-slate-400">{p.unit}</span></p>
                </div>
                <div className={`rounded-xl p-2.5 ${lowBadge(p) ? 'bg-red-50' : 'bg-emerald-50'}`}>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Reste</p>
                  <p className={`font-black tabular-nums ${lowBadge(p) ? 'text-red-600' : 'text-emerald-600'}`}>{p.currentQty} <span className="text-xs font-medium text-slate-400">{p.unit}</span></p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="text-slate-400">Prix vente</span>
                <span className="font-black text-[#002d87] tabular-nums">{money(p.salePrice)}</span>
              </div>
              {p.hasExpiration && p.expirationDate && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 font-semibold">
                  <CalendarClock className="w-3.5 h-3.5" /> Expire le {formatDate(p.expirationDate)}
                </div>
              )}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <span className="text-[11px] text-slate-400">Créé le {formatDate(p.createdAt)}</span>
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => openEdit(p)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      ) : (
        <Table head={<>
          <th className="table-head">Produit</th><th className="table-head">Catégorie</th><th className="table-head">Marque</th>
          <th className="table-head">Principal</th><th className="table-head">Reste</th><th className="table-head">Prix vente</th>
          <th className="table-head">État</th><th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(p => (
            <tr key={p.id}>
              <td className="table-cell"><div className="font-bold text-slate-700">{p.name}</div><div className="text-[11px] text-slate-400 font-mono">{p.barcode || '—'}</div></td>
              <td className="table-cell">{p.categoryName || '—'}</td>
              <td className="table-cell">{p.marqueName || '—'}</td>
              <td className="table-cell tabular-nums">{p.principalQty} {p.unit}</td>
              <td className="table-cell tabular-nums font-bold">{p.currentQty} {p.unit}</td>
              <td className="table-cell tabular-nums">{money(p.salePrice)}</td>
              <td className="table-cell">{lowBadge(p) ? <Badge tone="danger">Bas</Badge> : <Badge tone="success">OK</Badge>}</td>
              <td className="table-cell">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => openEdit(p)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                </RowActions>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <ProductModal biz={biz} open={showForm} onClose={() => setShowForm(false)} initial={editing}
        onSaved={() => toast.success(editing ? 'Produit modifié' : 'Produit créé')} />

      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={Package} size="lg"
        title={viewing?.name || ''} subtitle="Détails du produit">
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Code-barres', viewing.barcode || '—'], ['Catégorie', viewing.categoryName || '—'],
                ['Marque', viewing.marqueName || '—'], ['Unité', viewing.unit || '—'],
                ['Quantité principale', `${viewing.principalQty} ${viewing.unit}`], ['Reste en stock', `${viewing.currentQty} ${viewing.unit}`],
                ['Seuil d\'alerte', `${viewing.minQty} ${viewing.unit}`], ['Prix d\'achat', money(viewing.purchasePrice)],
                ['Prix de vente', money(viewing.salePrice)], ['Créé le', formatDate(viewing.createdAt)],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
                  <p className="font-bold text-slate-700 text-sm">{v}</p>
                </div>
              ))}
            </div>
            {viewing.description && <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Description</p><p className="text-sm text-slate-600">{viewing.description}</p></div>}
            {viewing.hasExpiration && viewing.expirationDate && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 text-amber-700">
                <CalendarClock className="w-4 h-4" /> <span className="font-semibold text-sm">Expire le {formatDate(viewing.expirationDate)}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-outline" onClick={() => printBarcode(viewing)} disabled={!viewing.barcode}><Printer className="w-4 h-4" /> Imprimer code-barres</button>
              {perm.modifier && <button className="btn-secondary" onClick={() => { setViewing(null); openEdit(viewing); }}><Edit2 className="w-4 h-4" /> Modifier</button>}
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!toDelete} title="Supprimer le produit" message={`Voulez-vous supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}
