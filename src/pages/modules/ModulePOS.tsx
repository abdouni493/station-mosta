/**
 * ─── Point de vente ─────────────────────────────────────────────────────────────
 * Caisse of the Cafétéria and of the Lavage & Réparation part (which absorbed the
 * former Magasin point-de-vente).
 *
 *  • Session de travail obligatoire — rien ne peut être vendu avant qu'un employé
 *    n'ouvre sa session avec le fond de caisse qu'il a déjà en main. Ce fond
 *    n'entre JAMAIS dans le théorique ni dans le décalage.
 *  • Filtrage par catégorie en plus de la recherche.
 *  • Vente au détail : un produit « au détail » demande la quantité dans son
 *    unité (10 L sur un bidon de 50 L) et le stock est décrémenté d'autant.
 *  • Vente rapide de fiches techniques : une fiche marquée « vente directe »
 *    (ex: café au lait) s'affiche sur le comptoir et déduit ses ingrédients du
 *    stock à la vente, sans passer par la production.
 *  • Les productions envoyées au comptoir apparaissent directement ici.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  ShoppingBag, Search, Plus, Minus, X, User, UserPlus, Percent, Check, Package,
  PlayCircle, StopCircle, Lock, Beaker, Layers, Wallet, AlertTriangle, Printer,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizSale, BizLineItem, BizSession, BizFiche, detailPrice,
} from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import { PageHeader, Badge, Select, Field, Input, Textarea, Modal, money, formatDate } from '@/src/components/biz/Kit';
import { ContactModal, printInvoice, AskPrintModal, stationFromSettings } from './_shared';

type LineKind = 'comptoir' | 'product' | 'fiche';

interface CartLine {
  id: string;
  name: string;
  unitPrice: number;
  qty: number;
  /** Stock ceiling in the line's own unit (detail unit for detail lines). */
  max: number;
  unit?: string;
  kind: LineKind;
  /** Set for products sold au détail: how much of one unit a detail unit is. */
  detailCapacity?: number;
  detailUnit?: string;
}

/** Sellable entry of the POS grid. */
interface Source {
  id: string;
  name: string;
  price: number;
  avail: number;
  unit?: string;
  kind: LineKind;
  categoryName?: string;
  detail?: boolean;
  detailCapacity?: number;
  detailUnit?: string;
  fiche?: BizFiche;
}

export default function ModulePOS({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'pos');
  const { settings, currentUserName, currentModuleWorker } = useAppState();
  const { comptoir, products, clients, fiches, sessions, workers } = biz.state;

  const openSession = useMemo(() => sessions.find(s => s.status === 'open') || null, [sessions]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientId, setClientId] = useState('');
  const [passage, setPassage] = useState(true);
  const [showClient, setShowClient] = useState(false);
  const [useReduction, setUseReduction] = useState(false);
  const [reduction, setReduction] = useState(0);
  const [paidStr, setPaidStr] = useState('');
  const [detailPrompt, setDetailPrompt] = useState<Source | null>(null);
  const [showOpen, setShowOpen] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [askPrint, setAskPrint] = useState<BizSale | null>(null);

  // ── Sellable catalogue ────────────────────────────────────────────────────
  const source = useMemo<Source[]>(() => {
    const out: Source[] = [];

    // Productions already sent to the comptoir.
    if (cfg.hasComptoir) {
      comptoir.filter(c => c.qty > 0).forEach(c => out.push({
        id: c.id, name: c.productName, price: c.unitPrice, avail: c.qty,
        unit: c.unit, kind: 'comptoir', categoryName: c.categoryName,
      }));
    }

    // Stock products — including the ones sold au détail.
    products.filter(p => p.currentQty > 0).forEach(p => {
      if (p.sellByDetail && (p.detailCapacity || 0) > 0) {
        out.push({
          id: p.id, name: p.name, price: detailPrice(p),
          avail: p.currentQty * (p.detailCapacity || 0),
          unit: p.detailUnit, kind: 'product', categoryName: p.categoryName,
          detail: true, detailCapacity: p.detailCapacity, detailUnit: p.detailUnit,
        });
      } else {
        out.push({
          id: p.id, name: p.name, price: p.salePrice, avail: p.currentQty,
          unit: p.unit, kind: 'product', categoryName: p.categoryName,
        });
      }
    });

    // Quick-sale fiches (no production run needed).
    fiches.filter(f => f.directSale).forEach(f => out.push({
      id: f.id, name: f.name, price: f.unitPrice,
      avail: maxFicheServings(f, products), unit: f.sellUnit || 'unité',
      kind: 'fiche', categoryName: f.categoryName, fiche: f,
    }));

    return out;
  }, [cfg.hasComptoir, comptoir, products, fiches]);

  const categories = useMemo(
    () => Array.from(new Set(source.map(s => s.categoryName).filter(Boolean))).sort() as string[],
    [source]);

  const filtered = source.filter(s =>
    (!search || s.name.toLowerCase().includes(search.toLowerCase())) &&
    (category === 'all' || s.categoryName === category));

  const subtotal = cart.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const total = Math.max(0, subtotal - (useReduction ? reduction : 0));
  const paid = paidStr === '' ? total : Number(paidStr);
  const rest = Math.max(0, total - paid);

  // ── Cart ──────────────────────────────────────────────────────────────────
  const pushLine = (s: Source, qty: number) => {
    setCart(prev => {
      const found = prev.find(l => l.id === s.id);
      if (found) {
        const next = Math.min(found.max, found.qty + qty);
        if (next === found.qty) { toast.error('Stock atteint'); return prev; }
        return prev.map(l => l.id === s.id ? { ...l, qty: next } : l);
      }
      return [...prev, {
        id: s.id, name: s.name, unitPrice: s.price, qty: Math.min(s.avail, qty),
        max: s.avail, unit: s.unit, kind: s.kind,
        detailCapacity: s.detailCapacity, detailUnit: s.detailUnit,
      }];
    });
  };

  const addToCart = (s: Source) => {
    if (!openSession) { toast.error('Ouvrez une session de travail pour vendre'); return; }
    if (s.avail <= 0) { toast.error('Stock épuisé'); return; }
    // Detail products ask for the quantity to sell, in the detail unit.
    if (s.detail) { setDetailPrompt(s); return; }
    pushLine(s, 1);
  };

  const inc = (id: string) => setCart(prev => prev.map(l => l.id === id ? { ...l, qty: Math.min(l.max, l.qty + 1) } : l));
  const dec = (id: string) => setCart(prev => prev.flatMap(l => l.id === id ? (l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : []) : [l]));
  const setLineQty = (id: string, v: number) =>
    setCart(prev => prev.map(l => l.id === id ? { ...l, qty: Math.max(0, Math.min(l.max, v)) } : l));
  const rm = (id: string) => setCart(prev => prev.filter(l => l.id !== id));

  // ── Checkout ──────────────────────────────────────────────────────────────
  const checkout = () => {
    if (!openSession) { toast.error('Ouvrez une session de travail pour vendre'); return; }
    if (cart.length === 0) { toast.error('Panier vide'); return; }
    if (!passage && !clientId) { toast.error('Sélectionnez un client'); return; }
    if (passage && rest > 0) { toast.error('Un client est requis pour une vente à crédit'); return; }

    const client = clients.find(c => c.id === clientId);
    const items: BizLineItem[] = cart.map(l => l.detailCapacity
      ? {
        productId: l.id, productName: l.name,
        qty: l.qty / l.detailCapacity, unitPrice: l.unitPrice,
        detailQty: l.qty, detailUnit: l.detailUnit,
        total: l.qty * l.unitPrice,
      }
      : { productId: l.id, productName: l.name, qty: l.qty, unitPrice: l.unitPrice, total: l.qty * l.unitPrice });

    const sale: BizSale = {
      id: newId(), ref: `V-${String(biz.state.sales.length + 1).padStart(4, '0')}`,
      clientId: passage ? undefined : clientId,
      clientName: passage ? 'Client de passage' : (client?.name || '—'),
      items, subtotal, reduction: useReduction ? reduction : 0, total, paid, rest,
      date: new Date().toISOString(), status: rest > 0 ? 'crédit' : 'payée',
      createdBy: currentUserName || 'Admin',
      sessionId: openSession.id,
      workerId: openSession.workerId,
      workerName: openSession.workerName,
    };
    biz.add('sales', sale);

    // Deduct stock.
    cart.forEach(l => {
      if (l.kind === 'comptoir') {
        const c = comptoir.find(x => x.id === l.id);
        if (c) biz.update('comptoir', { ...c, qty: Math.max(0, c.qty - l.qty) });
      } else if (l.kind === 'fiche') {
        // A direct-sale fiche behaves like an instant production: its ingredients
        // leave the stock right away.
        const f = fiches.find(x => x.id === l.id);
        f?.ingredients.forEach(ing => {
          const p = products.find(x => x.id === ing.productId);
          if (p) biz.update('products', {
            ...p,
            currentQty: Math.max(0, p.currentQty - ing.quantityUsed * l.qty / Math.max(1, f.outputQuantity)),
          });
        });
      } else {
        const p = products.find(x => x.id === l.id);
        if (!p) return;
        const consumed = l.detailCapacity ? l.qty / l.detailCapacity : l.qty;
        biz.update('products', { ...p, currentQty: Math.max(0, p.currentQty - consumed) });
      }
    });

    toast.success('Vente enregistrée');
    setCart([]); setReduction(0); setUseReduction(false); setPaidStr(''); setClientId(''); setPassage(true);
    setAskPrint(sale);
  };

  const doPrint = (sale: BizSale) => {
    const client = clients.find(c => c.id === sale.clientId);
    printInvoice({
      title: 'Facture de vente', ref: sale.ref, date: sale.date,
      station: stationFromSettings(settings),
      party: { label: 'Client', name: sale.clientName, phone: client?.phone, address: client?.address },
      info: [
        { label: 'Caissier', value: sale.workerName || '' },
        { label: 'Session', value: openSession?.ref || '' },
      ],
      items: sale.items.map(i => ({
        name: i.productName,
        qty: i.detailQty ? `${i.detailQty} ${i.detailUnit || ''}`.trim() : i.qty,
        unitPrice: i.unitPrice, total: i.total ?? i.qty * i.unitPrice,
      })),
      subtotal: sale.subtotal, reduction: sale.reduction,
      total: sale.total, paid: sale.paid, rest: sale.rest,
      payments: [{ label: 'Espèces', amount: sale.paid }],
    });
    biz.update('sales', { ...sale, printedAt: new Date().toISOString() });
  };

  // ── Session totals (for the closing screen) ───────────────────────────────
  const sessionFigures = useMemo(() => figuresForSession(openSession, biz.state.sales), [openSession, biz.state.sales]);

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader icon={ShoppingBag} title="Point de vente" subtitle={`${cfg.label} — caisse & encaissement`}
        actions={openSession ? (
          <div className="flex items-center gap-2">
            <div className="hidden sm:block text-right">
              <p className="text-[10px] uppercase font-bold text-slate-400">Session ouverte</p>
              <p className="text-sm font-black text-[#002d87]">{openSession.workerName}</p>
            </div>
            <button className="btn-secondary" onClick={() => setShowClose(true)}>
              <StopCircle className="w-4 h-4" /> Clôturer la session
            </button>
          </div>
        ) : (
          <button className="btn-primary" onClick={() => setShowOpen(true)}>
            <PlayCircle className="w-4 h-4" /> Ouvrir une session
          </button>
        )} />

      {/* Session gate */}
      {!openSession && (
        <div className="card-glass p-6 flex flex-col sm:flex-row items-center gap-4 border-l-4 border-amber-400">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
            <Lock className="w-6 h-6 text-amber-600" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="font-black text-slate-800">Aucune session de travail ouverte</h3>
            <p className="text-sm text-slate-500">
              L'employé doit ouvrir sa session — avec son nom et le fond de caisse qu'il a déjà en main —
              avant de pouvoir vendre. Ce fond n'est pas compté dans le théorique de la session.
            </p>
          </div>
          <button className="btn-primary shrink-0" onClick={() => setShowOpen(true)}>
            <PlayCircle className="w-4 h-4" /> Ouvrir une session
          </button>
        </div>
      )}

      {openSession && (
        <div className="card-glass p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><p className="text-[10px] uppercase font-bold text-slate-400">Employé</p><p className="font-black text-slate-700 text-sm">{openSession.workerName}</p></div>
          <div><p className="text-[10px] uppercase font-bold text-slate-400">Ouverte le</p><p className="font-black text-slate-700 text-sm">{new Date(openSession.openedAt).toLocaleString('fr-DZ')}</p></div>
          <div><p className="text-[10px] uppercase font-bold text-slate-400">Fond de caisse</p><p className="font-black text-slate-700 text-sm tabular-nums">{money(openSession.openingCash)}</p></div>
          <div><p className="text-[10px] uppercase font-bold text-slate-400">Ventes de la session</p><p className="font-black text-emerald-600 text-sm tabular-nums">{money(sessionFigures.total)}</p></div>
        </div>
      )}

      <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 ${openSession ? '' : 'opacity-50 pointer-events-none'}`}>
        {/* Catalogue */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card-glass p-3 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un produit…" className="input-field pl-9" />
            </div>
            <Select value={category} onChange={e => setCategory(e.target.value)} className="!w-auto min-w-[170px]">
              <option value="all">Toutes catégories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setCategory('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${category === 'all' ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                <Layers className="w-3.5 h-3.5 inline mr-1" />Tout
              </button>
              {categories.map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${category === c ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="card-glass p-12 text-center text-slate-400">
              <Package className="w-10 h-10 mx-auto mb-2 text-slate-300" />Aucun produit disponible
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map(s => (
                <button key={`${s.kind}-${s.id}`} onClick={() => addToCart(s)} className="card-glass p-3 text-left card-hover">
                  <div className="w-full h-16 rounded-xl bg-gradient-to-br from-[#003087]/10 to-[#FFB800]/10 flex items-center justify-center mb-2">
                    {s.kind === 'fiche' ? <Beaker className="w-6 h-6 text-[#003087]" /> : <Package className="w-6 h-6 text-[#003087]" />}
                  </div>
                  <p className="font-bold text-slate-700 text-sm leading-tight line-clamp-2">{s.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="font-black text-[#002d87] text-sm tabular-nums">
                      {money(s.price)}{s.detail ? <span className="text-[10px] font-bold">/{s.detailUnit}</span> : null}
                    </span>
                    <Badge tone={s.avail <= 5 ? 'warning' : 'neutral'}>
                      {s.avail % 1 === 0 ? s.avail : s.avail.toFixed(2)} {s.unit}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {s.kind === 'fiche' && <Badge tone="primary">Vente rapide</Badge>}
                    {s.detail && <Badge tone="info">Au détail</Badge>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="space-y-4">
          <div className="card-glass p-4">
            <div className="mb-3">
              <div className="flex gap-2 mb-2">
                <button onClick={() => setPassage(true)} className={`flex-1 py-2 rounded-xl text-xs font-bold ${passage ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>Client de passage</button>
                <button onClick={() => setPassage(false)} className={`flex-1 py-2 rounded-xl text-xs font-bold ${!passage ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>Client</button>
              </div>
              {!passage && (
                <div className="flex gap-2">
                  <Select value={clientId} onChange={e => setClientId(e.target.value)}>
                    <option value="">— Sélectionner —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>)}
                  </Select>
                  <button className="btn-secondary !px-3 shrink-0" onClick={() => setShowClient(true)}><UserPlus className="w-4 h-4" /></button>
                </div>
              )}
            </div>

            <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar">
              {cart.length === 0 ? <p className="text-center text-slate-400 text-sm py-6">Panier vide</p> : cart.map(l => (
                <div key={l.id} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">{l.name}</p>
                    <p className="text-xs text-slate-400 tabular-nums">
                      {money(l.unitPrice)}{l.detailUnit ? `/${l.detailUnit}` : ''} × {l.qty % 1 === 0 ? l.qty : l.qty.toFixed(2)}
                    </p>
                  </div>
                  {l.detailCapacity ? (
                    <input type="number" step="0.01" min={0} max={l.max} value={l.qty}
                      onChange={e => setLineQty(l.id, Number(e.target.value))}
                      className="input-field !py-1 !px-2 w-20 text-center" />
                  ) : (
                    <div className="flex items-center gap-1">
                      <button onClick={() => dec(l.id)} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                      <span className="w-6 text-center text-sm font-bold tabular-nums">{l.qty}</span>
                      <button onClick={() => inc(l.id)} className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                    </div>
                  )}
                  <button onClick={() => rm(l.id)} className="w-6 h-6 rounded-md text-red-500 flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </div>

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
            <button className="btn-primary w-full" onClick={checkout} disabled={!perm.creer || !openSession}
              title={openSession ? (perm.creer ? undefined : "Vous n'avez pas le droit d'enregistrer une vente") : 'Ouvrez une session de travail'}>
              <Check className="w-4 h-4" /> Valider la vente
            </button>
          </div>
        </div>
      </div>

      {/* Detail quantity prompt */}
      {detailPrompt && (
        <DetailQtyModal source={detailPrompt} onClose={() => setDetailPrompt(null)}
          onConfirm={qty => { pushLine(detailPrompt, qty); setDetailPrompt(null); }} />
      )}

      {showOpen && (
        <OpenSessionModal
          moduleKey={moduleKey}
          defaultName={currentModuleWorker?.name || currentUserName || ''}
          workers={workers}
          onClose={() => setShowOpen(false)} />
      )}
      {showClose && openSession && (
        <CloseSessionModal moduleKey={moduleKey} session={openSession} onClose={() => setShowClose(false)} />
      )}

      <AskPrintModal open={!!askPrint}
        onPrint={() => { if (askPrint) doPrint(askPrint); setAskPrint(null); }}
        onSkip={() => setAskPrint(null)} />

      <ContactModal biz={biz} coll="clients" open={showClient} onClose={() => setShowClient(false)}
        onSaved={(c) => { setPassage(false); setClientId(c.id); }} />
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** How many servings of a direct-sale fiche the current stock allows. */
function maxFicheServings(f: BizFiche, products: { id: string; currentQty: number }[]): number {
  if (!f.ingredients.length) return 0;
  const per = Math.max(1, f.outputQuantity);
  let min = Infinity;
  for (const ing of f.ingredients) {
    const p = products.find(x => x.id === ing.productId);
    const need = ing.quantityUsed / per;
    if (!p || need <= 0) { if (!p) return 0; continue; }
    min = Math.min(min, Math.floor(p.currentQty / need));
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}

/**
 * Theoretical takings of a session. The opening float is deliberately absent:
 * the worker owes only what they sold in cash during the session.
 */
export function figuresForSession(session: BizSession | null, sales: BizSale[]) {
  if (!session) return { total: 0, cash: 0, credit: 0, count: 0 };
  const own = sales.filter(s => s.sessionId === session.id && s.status !== 'retournée');
  return {
    total: own.reduce((s, x) => s + x.total, 0),
    cash: own.reduce((s, x) => s + x.paid, 0),      // theoretical cash in the drawer
    credit: own.reduce((s, x) => s + x.rest, 0),    // granted as debt, not cash
    count: own.length,
  };
}

// ─── Detail quantity prompt ────────────────────────────────────────────────────
function DetailQtyModal({ source, onClose, onConfirm }: {
  source: Source; onClose: () => void; onConfirm: (qty: number) => void;
}) {
  const [qty, setQty] = useState('1');
  const value = Number(qty) || 0;
  const tooMuch = value > source.avail;
  return (
    <Modal open onClose={onClose} icon={Package} size="sm"
      title={source.name} subtitle={`Vente au détail — ${source.detailUnit} sur ${source.detailCapacity} ${source.detailUnit} par unité`}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={() => onConfirm(value)} disabled={value <= 0 || tooMuch}>Ajouter</button>
      </>}>
      <div className="space-y-4">
        <Field label={`Quantité à vendre (${source.detailUnit})`} required>
          <Input type="number" step="0.01" min={0} value={qty} onChange={e => setQty(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Disponible</p>
            <p className="font-black text-slate-700 tabular-nums">{source.avail.toFixed(2)} {source.detailUnit}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Montant</p>
            <p className="font-black text-[#002d87] tabular-nums">{money(value * source.price)}</p>
          </div>
        </div>
        {tooMuch && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> La quantité dépasse le stock disponible.
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── Open a work session ───────────────────────────────────────────────────────
function OpenSessionModal({ moduleKey, defaultName, workers, onClose }: {
  moduleKey: ModuleKey; defaultName: string;
  workers: { id: string; name: string }[];
  onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const [workerId, setWorkerId] = useState('');
  const [name, setName] = useState(defaultName);
  const [openingCash, setOpeningCash] = useState('');
  const [notes, setNotes] = useState('');

  const save = () => {
    const worker = workers.find(w => w.name === (workers.find(x => x.id === workerId)?.name || ''));
    const workerName = (workerId ? workers.find(w => w.id === workerId)?.name : name.trim()) || name.trim();
    if (!workerName) { toast.error("Indiquez le nom de l'employé"); return; }
    const session: BizSession = {
      id: newId(),
      ref: `S-${String(biz.state.sessions.length + 1).padStart(4, '0')}`,
      workerId: workerId || worker?.id,
      workerName,
      openingCash: Number(openingCash) || 0,
      openedAt: new Date().toISOString(),
      status: 'open',
      notes: notes.trim() || undefined,
    };
    biz.add('sessions', session);
    toast.success('Session ouverte');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={PlayCircle} size="md"
      title="Ouvrir une session de travail"
      subtitle="Nom de l'employé et fond de caisse déjà en main"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save}>Ouvrir la session</button>
      </>}>
      <div className="space-y-4">
        <Field label="Employé">
          <Select value={workerId} onChange={e => { setWorkerId(e.target.value); const w = workers.find(x => x.id === e.target.value); if (w) setName(w.name); }}>
            <option value="">— Saisir un nom libre —</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        {!workerId && (
          <Field label="Nom de l'employé" required>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nom d'utilisateur de l'employé" />
          </Field>
        )}
        <Field label="Fond de caisse à l'ouverture (DA)"
          hint="Argent que l'employé a déjà en main. Il n'est jamais compté dans le théorique ni dans le décalage.">
          <Input type="number" value={openingCash} onChange={e => setOpeningCash(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Notes"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ─── Close a work session ──────────────────────────────────────────────────────
function CloseSessionModal({ moduleKey, session, onClose }: {
  moduleKey: ModuleKey; session: BizSession; onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const fig = figuresForSession(session, biz.state.sales);
  const [closingCash, setClosingCash] = useState('');
  const [notes, setNotes] = useState(session.notes || '');

  const declared = Number(closingCash) || 0;
  // Théorique = encaissements en espèces de la session (le fond d'ouverture est exclu).
  const decalage = declared - fig.cash;

  const save = () => {
    biz.update('sessions', {
      ...session,
      status: 'closed',
      closedAt: new Date().toISOString(),
      closingCash: declared,
      theoretical: fig.cash,
      credit: fig.credit,
      decalage,
      notes: notes.trim() || undefined,
    });
    toast.success('Session clôturée');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={StopCircle} size="lg"
      title={`Clôturer la session ${session.ref}`} subtitle={session.workerName}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save}>Clôturer la session</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Ventes</p><p className="font-black text-slate-700 tabular-nums">{fig.count}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Chiffre d'affaires</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(fig.total)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Théorique espèces</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(fig.cash)}</p></div>
          <div className="rounded-xl bg-amber-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Crédits accordés</p><p className="font-black text-amber-600 tabular-nums text-sm">{money(fig.credit)}</p></div>
        </div>

        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 flex items-start gap-2">
          <Wallet className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Le fond de caisse d'ouverture ({money(session.openingCash)}) est exclu du théorique :
            l'employé ne doit que les {money(fig.cash)} encaissés pendant sa session.
            Les {money(fig.credit)} laissés en dette justifient l'écart correspondant.
          </span>
        </div>

        <Field label="Espèces comptées à la fermeture (DA)" required>
          <Input type="number" value={closingCash} onChange={e => setClosingCash(e.target.value)} placeholder="0" autoFocus />
        </Field>

        <div className={`rounded-2xl p-4 text-white ${Math.abs(decalage) < 0.01 ? 'bg-emerald-600' : decalage > 0 ? 'bg-[#003087]' : 'bg-red-600'}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold opacity-90">Décalage (compté − théorique)</span>
            <span className="text-2xl font-black tabular-nums">{money(decalage)}</span>
          </div>
          <p className="text-[11px] opacity-80 mt-1">
            {Math.abs(decalage) < 0.01
              ? 'Caisse juste.'
              : decalage > 0 ? 'Excédent en caisse.' : "Manque en caisse à justifier."}
          </p>
        </div>

        <Field label="Notes / justification"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
