/**
 * ─── Gestion de stock ───────────────────────────────────────────────────────────
 * Catalogue et inventaire d'une partie, plus la DESTRUCTION des produits perdus
 * (périmés, cassés, volés…), sur le même principe que le comptoir :
 *
 *  • « Détruire » sur un produit retire la quantité du stock et enregistre une
 *    ligne dans l'historique des destructions, valorisée au PRIX D'ACHAT.
 *  • L'onglet « Historique destructions » liste ces pertes avec leur motif, leur
 *    coût et leur détail complet ; une destruction peut être récupérée (le
 *    produit revient en stock) ou supprimée.
 *  • Le coût des destructions descend dans la Caisse de la partie et dans les
 *    Rapports (bénéfice net = marge − dépenses − salaires − destructions).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Package, Plus, Boxes, AlertTriangle, CalendarClock, Wallet, Barcode, Printer, Tag, Layers,
  Flame, RotateCcw, Trash, User, Beaker, ShoppingBag,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizProduct, BizDestruction } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, Select, ViewToggle, CardGrid, GlassCard,
  Table, Tabs, EmptyState, RowActions, ActionBtn, Eye, Edit2, Trash2, Confirm, Modal,
  Field, Input, Textarea, money, formatDate, PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { ProductModal, printBarcode } from './_shared';

/** Destructions belonging to the stock screen (legacy rows are comptoir ones). */
const isStockDestruction = (d: BizDestruction) => d.source === 'stock';

export default function ModuleStock({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'stock');
  const { currentUserName, currentModuleWorker } = useAppState();
  const { products, categories, marques, destructions } = biz.state;

  const [tab, setTab] = useState<'catalogue' | 'destructions'>('catalogue');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [mrq, setMrq] = useState('all');
  /** Nature du produit : tout, ce qui se vend, ou ce qui sert à fabriquer. */
  const [nature, setNature] = useState<'all' | 'sale' | 'raw'>('all');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizProduct | null>(null);
  const [viewing, setViewing] = useState<BizProduct | null>(null);
  const [toDelete, setToDelete] = useState<BizProduct | null>(null);
  const [destroying, setDestroying] = useState<BizProduct | null>(null);
  const [viewingDestruction, setViewingDestruction] = useState<BizDestruction | null>(null);
  const [destructionToDelete, setDestructionToDelete] = useState<BizDestruction | null>(null);
  const [dPeriod, setDPeriod] = useState<Period>('all');
  const [dFrom, setDFrom] = useState(''); const [dTo, setDTo] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p =>
      (!q || p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q)) &&
      (cat === 'all' || p.categoryId === cat) &&
      (mrq === 'all' || p.marqueId === mrq) &&
      (nature === 'all' || (nature === 'raw' ? !!p.isRawMaterial : !p.isRawMaterial)));
  }, [products, search, cat, mrq, nature]);

  // ── Destructions du stock ──────────────────────────────────────────────────
  const stockDestructions = useMemo(
    () => destructions.filter(isStockDestruction)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [destructions]);

  const destructionsInPeriod = useMemo(
    () => stockDestructions.filter(d => inPeriod(d.date, dPeriod, dFrom, dTo)),
    [stockDestructions, dPeriod, dFrom, dTo]);

  /** Coût réellement perdu : une destruction récupérée ne coûte plus rien. */
  const destroyedValue = useMemo(
    () => stockDestructions.reduce((s, d) => s + (d.recovered ? 0 : d.value), 0),
    [stockDestructions]);
  const destroyedValueInPeriod = destructionsInPeriod.reduce((s, d) => s + (d.recovered ? 0 : d.value), 0);

  const stats = useMemo(() => {
    const soon = new Date(); soon.setDate(soon.getDate() + 7);
    return {
      total: products.length,
      raw: products.filter(p => p.isRawMaterial).length,
      low: products.filter(p => p.currentQty <= p.minQty).length,
      value: products.reduce((s, p) => s + p.currentQty * p.purchasePrice, 0),
      expiring: products.filter(p => p.hasExpiration && p.expirationDate && new Date(p.expirationDate) <= soon).length,
    };
  }, [products]);

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (p: BizProduct) => { setEditing(p); setShowForm(true); };
  const del = () => { if (toDelete) { biz.remove('products', toDelete.id); toast.success('Produit supprimé'); setToDelete(null); } };

  /**
   * Détruire une quantité d'un produit : elle quitte le stock et devient une
   * perte valorisée au prix d'achat, tracée avec son motif et son auteur.
   */
  const doDestroy = (qty: number, reason: string, notes: string) => {
    if (!destroying) return;
    const amount = Math.min(destroying.currentQty, Math.max(0, qty));
    if (amount <= 0) { toast.error('Quantité à détruire requise'); return; }
    const unitPrice = destroying.purchasePrice || 0;
    biz.update('products', { ...destroying, currentQty: destroying.currentQty - amount });
    biz.add('destructions', {
      id: newId(),
      source: 'stock',
      productId: destroying.id,
      productName: destroying.name,
      categoryName: destroying.categoryName,
      qty: amount,
      unit: destroying.unit,
      unitPrice,
      value: amount * unitPrice,
      reason: reason.trim() || undefined,
      notes: notes.trim() || undefined,
      date: new Date().toISOString(),
      createdBy: currentModuleWorker?.name || currentUserName || 'Admin',
      recovered: false,
    } as BizDestruction);
    toast.success(`Destruction enregistrée — ${money(amount * unitPrice)} de perte`);
    setDestroying(null);
  };

  /** Erreur de saisie : le produit détruit revient dans le stock. */
  const recoverDestruction = (d: BizDestruction) => {
    const product = products.find(p => p.id === d.productId) || products.find(p => p.name === d.productName);
    if (product) biz.update('products', { ...product, currentQty: product.currentQty + d.qty });
    biz.update('destructions', { ...d, recovered: true, recoveredAt: new Date().toISOString() });
    toast.success(product ? `${d.qty} ${d.unit || ''} remis en stock` : 'Destruction annulée (produit introuvable)');
  };

  const deleteDestruction = () => {
    if (!destructionToDelete) return;
    biz.remove('destructions', destructionToDelete.id);
    toast.success('Ligne de destruction supprimée');
    setDestructionToDelete(null);
  };

  const lowBadge = (p: BizProduct) => p.currentQty <= p.minQty;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Package} title="Gestion de stock" subtitle={`${cfg.label} — catalogue & inventaire`}
        actions={perm.creer ? <button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> Nouveau produit</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={Boxes} label="Produits" value={stats.total} tone="blue"
          sub={stats.raw ? `dont ${stats.raw} matière(s) première(s)` : undefined} />
        <StatCard icon={AlertTriangle} label="Stock bas" value={stats.low} tone="red" sub="≤ seuil d'alerte" />
        <StatCard icon={Wallet} label="Valeur du stock" value={money(stats.value)} tone="green" />
        <StatCard icon={CalendarClock} label="Expirent bientôt" value={stats.expiring} tone="amber" sub="≤ 7 jours" />
        <StatCard icon={Flame} label="Valeur détruite" value={money(destroyedValue)} tone="red"
          sub={`${stockDestructions.filter(d => !d.recovered).length} destruction(s)`} />
      </div>

      <Tabs
        tabs={[
          { id: 'catalogue', label: 'Catalogue', icon: Package },
          { id: 'destructions', label: `Historique destructions${stockDestructions.length ? ` (${stockDestructions.length})` : ''}`, icon: Flame },
        ]}
        active={tab}
        onChange={id => setTab(id as 'catalogue' | 'destructions')}
      />

      {tab === 'catalogue' && <>
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
        <Select value={nature} onChange={e => setNature(e.target.value as 'all' | 'sale' | 'raw')} className="!w-auto min-w-[180px]">
          <option value="all">Toute nature</option>
          <option value="sale">Produits de vente</option>
          <option value="raw">Matières premières</option>
        </Select>
        <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={nature === 'raw' ? Beaker : Package}
          title={nature === 'raw' ? 'Aucune matière première' : 'Aucun produit'}
          message={nature === 'raw'
            ? 'Activez « Matière première » sur un produit pour le réserver à la production et le retirer du point de vente.'
            : 'Ajoutez votre premier produit au catalogue.'}
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
                {p.isRawMaterial && <Badge tone="warning"><Beaker className="w-3 h-3" />Matière première</Badge>}
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
              {/* Une matière première n'a pas de prix de vente : ce qui compte,
                  c'est ce qu'elle a coûté. */}
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="text-slate-400">{p.isRawMaterial ? "Prix d'achat" : 'Prix vente'}</span>
                <span className="font-black text-[#002d87] tabular-nums">
                  {money(p.isRawMaterial ? p.purchasePrice : p.salePrice)}
                </span>
              </div>
              {p.isRawMaterial && (
                <p className="mt-1.5 text-[11px] font-semibold text-amber-600 flex items-center gap-1">
                  <ShoppingBag className="w-3 h-3 shrink-0" /> Masquée au point de vente
                </p>
              )}
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
              {perm.modifier && (
                <button onClick={() => setDestroying(p)} disabled={p.currentQty <= 0}
                  title={p.currentQty <= 0 ? 'Aucune quantité en stock à détruire' : 'Retirer du stock une quantité perdue'}
                  className="w-full mt-3 py-2 rounded-xl bg-red-50 text-red-600 font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <Flame className="w-4 h-4" /> Destruction
                </button>
              )}
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
              <td className="table-cell">
                <div className="font-bold text-slate-700 flex items-center gap-1.5">
                  {p.name}
                  {p.isRawMaterial && (
                    <span title="Matière première — masquée au point de vente" className="shrink-0">
                      <Beaker className="w-3.5 h-3.5 text-amber-500" />
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">{p.barcode || '—'}</div>
              </td>
              <td className="table-cell">{p.categoryName || '—'}</td>
              <td className="table-cell">{p.marqueName || '—'}</td>
              <td className="table-cell tabular-nums">{p.principalQty} {p.unit}</td>
              <td className="table-cell tabular-nums font-bold">{p.currentQty} {p.unit}</td>
              <td className="table-cell tabular-nums">
                {p.isRawMaterial
                  ? <span className="text-slate-400">— <span className="text-[11px]">matière première</span></span>
                  : money(p.salePrice)}
              </td>
              <td className="table-cell">{lowBadge(p) ? <Badge tone="danger">Bas</Badge> : <Badge tone="success">OK</Badge>}</td>
              <td className="table-cell">
                <RowActions>
                  <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => openEdit(p)} />}
                  {perm.modifier && p.currentQty > 0 && <ActionBtn icon={Flame} tone="red" title="Destruction" onClick={() => setDestroying(p)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                </RowActions>
              </td>
            </tr>
          ))}
        </Table>
      )}
      </>}

      {/* ── Historique des destructions ─────────────────────────────────────── */}
      {tab === 'destructions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Flame} label="Destructions (période)" value={destructionsInPeriod.length} tone="red" />
            <StatCard icon={Wallet} label="Coût de la période" value={money(destroyedValueInPeriod)} tone="amber" />
            <StatCard icon={Flame} label="Total détruit" value={money(destroyedValue)} tone="red" sub="hors lignes récupérées" />
            <StatCard icon={RotateCcw} label="Récupérées" value={stockDestructions.filter(d => d.recovered).length} tone="green" />
          </div>

          <div className="card-glass p-4">
            <PeriodFilter period={dPeriod} onChange={setDPeriod} from={dFrom} to={dTo} onFrom={setDFrom} onTo={setDTo} />
          </div>

          {destructionsInPeriod.length === 0 ? (
            <EmptyState icon={Flame} title="Aucune destruction"
              message="Utilisez le bouton « Destruction » sur un produit du catalogue pour retirer du stock une quantité perdue (périmée, cassée, volée…)." />
          ) : (
            <div className="card-glass overflow-hidden">
              <Table head={<>
                <th className="table-head">Date</th><th className="table-head">Produit</th>
                <th className="table-head">Quantité</th><th className="table-head">Coût unitaire</th>
                <th className="table-head">Motif</th><th className="table-head">Agent</th>
                <th className="table-head">État</th>
                <th className="table-head text-right">Coût</th>
                <th className="table-head text-right">Actions</th>
              </>}>
                {destructionsInPeriod.map(d => (
                  <tr key={d.id} className={d.recovered ? 'opacity-60' : undefined}>
                    <td className="table-cell whitespace-nowrap">{formatDate(d.date)}</td>
                    <td className="table-cell">
                      <div className="font-bold text-slate-700">{d.productName}</div>
                      {d.categoryName && <div className="text-[11px] text-slate-400">{d.categoryName}</div>}
                    </td>
                    <td className="table-cell tabular-nums">{d.qty} <span className="text-xs text-slate-400">{d.unit}</span></td>
                    <td className="table-cell tabular-nums text-slate-500">{money(d.unitPrice)}</td>
                    <td className="table-cell text-slate-500 max-w-[200px]">{d.reason || '—'}</td>
                    <td className="table-cell text-slate-500">{d.createdBy || '—'}</td>
                    <td className="table-cell">{d.recovered ? <Badge tone="success">Récupéré</Badge> : <Badge tone="danger">Détruit</Badge>}</td>
                    <td className={`table-cell text-right tabular-nums font-bold ${d.recovered ? 'text-slate-400 line-through' : 'text-red-600'}`}>
                      {money(d.value)}
                    </td>
                    <td className="table-cell text-right">
                      <RowActions>
                        <ActionBtn icon={Eye} tone="blue" title="Détails" onClick={() => setViewingDestruction(d)} />
                        {perm.modifier && !d.recovered && (
                          <ActionBtn icon={RotateCcw} tone="green" title="Récupérer (remettre en stock)" onClick={() => recoverDestruction(d)} />
                        )}
                        {perm.supprimer && (
                          <ActionBtn icon={Trash} tone="red" title="Supprimer la ligne" onClick={() => setDestructionToDelete(d)} />
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </Table>
              <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {destructionsInPeriod.length} ligne(s) — le coût des destructions est déduit du résultat de la partie.
                </span>
                <span className="font-black tabular-nums text-red-600">{money(destroyedValueInPeriod)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <ProductModal biz={biz} open={showForm} onClose={() => setShowForm(false)} initial={editing}
        onSaved={() => toast.success(editing ? 'Produit modifié' : 'Produit créé')} />

      <Modal open={!!viewing} onClose={() => setViewing(null)} icon={Package} size="lg"
        title={viewing?.name || ''} subtitle="Détails du produit">
        {viewing && (
          <div className="space-y-4">
            {viewing.isRawMaterial && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-center gap-2 text-amber-700">
                <Beaker className="w-4 h-4 shrink-0" />
                <span className="font-semibold text-sm">
                  Matière première — sert à la production et n'apparaît pas au point de vente.
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Nature', viewing.isRawMaterial ? 'Matière première' : 'Produit de vente'],
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

      {destroying && <DestroyStockModal product={destroying} onClose={() => setDestroying(null)} onConfirm={doDestroy} />}
      {viewingDestruction && <DestructionDetail destruction={viewingDestruction} onClose={() => setViewingDestruction(null)} />}
      <Confirm open={!!destructionToDelete} title="Supprimer la ligne de destruction"
        message={`Retirer définitivement la destruction de « ${destructionToDelete?.productName} » (${money(destructionToDelete?.value || 0)}) de l'historique ? Le stock n'est pas modifié — utilisez « Récupérer » pour rendre la quantité.`}
        onConfirm={deleteDestruction} onCancel={() => setDestructionToDelete(null)} />
    </div>
  );
}

// ─── Destruction d'une quantité du stock ───────────────────────────────────────
/**
 * La perte est valorisée au PRIX D'ACHAT du produit : c'est ce que la
 * marchandise a réellement coûté, et donc ce que la partie perd — le montant
 * qui sera déduit de son résultat dans la Caisse et les Rapports.
 */
function DestroyStockModal({
  product, onClose, onConfirm,
}: {
  product: BizProduct;
  onClose: () => void;
  onConfirm: (qty: number, reason: string, notes: string) => void;
}) {
  const [qtyStr, setQtyStr] = useState('1');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const qty = Math.max(0, Number(qtyStr) || 0);
  const capped = Math.min(product.currentQty, qty);
  const unitPrice = product.purchasePrice || 0;
  const tooMuch = qty > product.currentQty;

  const REASONS = ['Périmé', 'Cassé / abîmé', 'Volé / perdu', 'Non conforme', 'Échantillon'];

  return (
    <Modal open onClose={onClose} icon={Flame} size="md"
      title="Destruction de produit" subtitle={product.name}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button onClick={() => onConfirm(capped, reason, notes)} disabled={capped <= 0}
          className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          Confirmer la destruction
        </button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">En stock</p>
            <p className="font-black text-slate-700 tabular-nums">{product.currentQty} <span className="text-xs text-slate-400">{product.unit}</span></p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Prix d'achat</p>
            <p className="font-black text-slate-700 tabular-nums">{money(unitPrice)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Reste après</p>
            <p className="font-black text-slate-700 tabular-nums">{product.currentQty - capped} <span className="text-xs text-slate-400">{product.unit}</span></p>
          </div>
        </div>

        <Field label={`Quantité à détruire (max ${product.currentQty} ${product.unit || ''})`} required>
          <Input type="number" min={0} step="0.01" value={qtyStr} onChange={e => setQtyStr(e.target.value)} />
        </Field>
        {tooMuch && (
          <p className="text-xs font-semibold text-amber-600">
            Le stock ne contient que {product.currentQty} {product.unit} — seule cette quantité sera détruite.
          </p>
        )}

        <Field label="Motif de destruction" hint="Choisissez un motif courant ou saisissez le vôtre.">
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Péremption, casse, vol…" />
        </Field>
        <div className="flex flex-wrap gap-1.5 -mt-2">
          {REASONS.map(r => (
            <button key={r} onClick={() => setReason(r)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${reason === r ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {r}
            </button>
          ))}
        </div>

        <Field label="Observations (optionnel)">
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Précisions sur la perte…" />
        </Field>

        <div className="rounded-xl bg-red-50 border border-red-100 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-red-500">Coût de la destruction</p>
            <p className="text-[11px] text-red-400">{capped} {product.unit} × {money(unitPrice)} — déduit du résultat de la partie</p>
          </div>
          <span className="text-xl font-black tabular-nums text-red-600">{money(capped * unitPrice)}</span>
        </div>
      </div>
    </Modal>
  );
}

// ─── Détail d'une destruction ──────────────────────────────────────────────────
function DestructionDetail({ destruction: d, onClose }: { destruction: BizDestruction; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} icon={Flame} size="md"
      title={`Destruction — ${d.productName}`} subtitle={formatDate(d.date)}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Produit', d.productName],
            ['Catégorie', d.categoryName || '—'],
            ['Quantité détruite', `${d.qty} ${d.unit || ''}`.trim()],
            ['Coût unitaire (prix d\'achat)', money(d.unitPrice)],
            ['Motif', d.reason || '—'],
            ['Enregistrée par', d.createdBy || '—'],
            ['Date', formatDate(d.date)],
            ['Provenance', d.source === 'stock' ? 'Gestion de stock' : 'Comptoir'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
              <p className="font-bold text-slate-700 text-sm">{v}</p>
            </div>
          ))}
        </div>

        {d.notes && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Observations</p>
            <p className="text-sm text-slate-600">{d.notes}</p>
          </div>
        )}

        {d.recovered ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-2 text-emerald-700">
            <RotateCcw className="w-4 h-4" />
            <span className="text-sm font-semibold">
              Récupérée{d.recoveredAt ? ` le ${formatDate(d.recoveredAt)}` : ''} — la quantité est revenue en stock et
              ne coûte plus rien à la partie.
            </span>
          </div>
        ) : (
          <div className="rounded-xl bg-red-50 border border-red-100 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-500">
              <User className="w-4 h-4" />
              <span className="text-sm font-semibold">Perte définitive imputée à la partie</span>
            </div>
            <span className="text-xl font-black tabular-nums text-red-600">{money(d.value)}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
