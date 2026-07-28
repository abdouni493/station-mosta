/**
 * ─── Achats Carburant ───────────────────────────────────────────────────────────
 * Un seul écran remplace les anciens onglets « Bons de livraison / Facturation /
 * Paiements ». Un achat se crée d'un bloc :
 *
 *   1. N° de facture et n° de bon de livraison
 *   2. Date + fournisseur
 *   3. Une ou plusieurs cuves, avec la quantité reçue ; le prix d'achat vient des
 *      paramètres de la station et le total de chaque ligne est calculé
 *   4. Total, avec TVA activable et remise (pourcentage ou montant fixe)
 *   5. Un ou plusieurs modes de paiement : espèces ou compte bancaire, avec n° de
 *      chèque / bordereau optionnels ; le reste est calculé automatiquement
 *
 * Aucun champ n'est obligatoire : un achat peut être enregistré en dette.
 * À l'enregistrement, les niveaux de cuve sont mis à jour et les paiements par
 * banque sont retirés du compte concerné (journal de trésorerie).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  ShoppingCart, Plus, Trash2, Edit2, Wallet, Droplets, Percent, X,
  FileText, CircleDollarSign, TrendingUp, Landmark, Banknote, Printer, Eye,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import {
  useAppState, useAppDispatch, useModulePermission,
  Purchase, PurchaseItem, PurchasePayment, TreasuryTransaction, CAISSE_ID,
  bankBalanceOf, caisseBalanceOf, FuelType,
} from '../store/AppContext';
import {
  PageHeader, StatCard, Badge, Modal, Field, Input, Textarea, Select, Switch, Confirm,
  Table, EmptyState, SearchInput, RowActions, ActionBtn,
  money, formatDate, PeriodFilter, Period, inPeriod,
} from '../components/biz/Kit';
import { printInvoice, stationFromSettings } from './modules/_shared';

const todayISO = () => new Date().toISOString().split('T')[0];

/** One cuve line of the purchase form. */
interface CuveLine { id: string; tankId: string; quantity: string; unitPrice: string }
/** One payment line of the purchase form. */
interface PayLine {
  id: string; accountId: string; amount: string;
  chequeNumber: string; bordereauNumber: string;
}

const STATUS_TONE: Record<string, any> = {
  'Payé': 'success', 'Partiel': 'warning', 'À payer': 'danger', 'En attente livraison': 'neutral',
};

export default function FuelPurchases() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const perm = useModulePermission('Achats Carburant');
  const { purchases, suppliers, tanks, bankAccounts, treasuryTransactions, settings } = state;

  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [viewing, setViewing] = useState<Purchase | null>(null);
  const [paying, setPaying] = useState<Purchase | null>(null);
  const [toDelete, setToDelete] = useState<Purchase | null>(null);

  // Only fuel purchases live on this screen (they always carry a cuve).
  const fuelPurchases = useMemo(
    () => purchases.filter(p => p.items?.some(i => !!i.tankId) || !!p.tankId),
    [purchases]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...fuelPurchases]
      .filter(p => {
        const supplier = suppliers.find(s => s.id === p.supplierId);
        const matchQ = !q
          || (p.invoiceNumber || '').toLowerCase().includes(q)
          || (p.blNumber || '').toLowerCase().includes(q)
          || (supplier?.name || '').toLowerCase().includes(q);
        return matchQ && inPeriod(p.date, period, from, to);
      })
      // Newest first.
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [fuelPurchases, suppliers, search, period, from, to]);

  const stats = useMemo(() => ({
    count: fuelPurchases.length,
    total: fuelPurchases.reduce((s, p) => s + (p.total || 0), 0),
    paid: fuelPurchases.reduce((s, p) => s + (p.amountPaid || 0), 0),
    debt: fuelPurchases.reduce((s, p) => s + (p.rest || 0), 0),
    liters: fuelPurchases.reduce((s, p) => s + (p.items || []).reduce((a, i) => a + (i.quantity || 0), 0), 0),
  }), [fuelPurchases]);

  /** Removes a purchase: rolls back its cuve levels and its treasury lines. */
  const del = () => {
    if (!toDelete) return;
    const deltas = (toDelete.items || [])
      .filter(i => i.tankId)
      .map(i => ({ tankId: i.tankId!, deltaLiters: -(i.quantity || 0) }));
    if (deltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: deltas });
    treasuryTransactions
      .filter(t => t.refType === 'purchase' && t.refId === toDelete.id)
      .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));
    dispatch({ type: 'DELETE_PURCHASE', payload: toDelete.id });
    toast.success('Achat supprimé — niveaux de cuve rétablis');
    setToDelete(null);
  };

  const doPrint = (p: Purchase) => {
    const supplier = suppliers.find(s => s.id === p.supplierId);
    printInvoice({
      title: 'Achat carburant',
      ref: p.invoiceNumber || p.blNumber || p.id.slice(0, 8),
      date: p.date,
      station: stationFromSettings(settings),
      party: { label: 'Fournisseur', name: supplier?.name || '—', phone: supplier?.phone, address: supplier?.address },
      info: [
        { label: 'N° facture', value: p.invoiceNumber || '' },
        { label: 'N° bon de livraison', value: p.blNumber || '' },
        { label: 'Statut', value: p.status },
      ],
      items: (p.items || []).map(i => ({
        name: `${tanks.find(t => t.id === i.tankId)?.name || i.productName} (${tanks.find(t => t.id === i.tankId)?.type || ''})`,
        qty: `${i.quantity} L`,
        unitPrice: i.buyPrice,
        total: i.total,
      })),
      subtotal: p.subtotal, reduction: p.discountAmount, tva: p.tvaAmount,
      total: p.total, paid: p.amountPaid, rest: p.rest,
      payments: (p.payments || []).map(pay => ({
        label: accountLabel(pay.accountId, bankAccounts),
        amount: pay.amount,
        reference: [pay.chequeNumber && `Chèque ${pay.chequeNumber}`, pay.bordereauNumber && `Bordereau ${pay.bordereauNumber}`]
          .filter(Boolean).join(' • '),
      })),
      notes: p.notes,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={ShoppingCart} title="Achats Carburant" subtitle="Facture, bon de livraison, cuves et paiements en une seule saisie"
        actions={perm.creer
          ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nouvel achat</button>
          : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon={ShoppingCart} label="Achats" value={stats.count} tone="blue" />
        <StatCard icon={Droplets} label="Volume acheté" value={`${stats.liters.toLocaleString('fr-FR')} L`} tone="purple" />
        <StatCard icon={TrendingUp} label="Montant total" value={money(stats.total)} tone="slate" />
        <StatCard icon={Wallet} label="Payé" value={money(stats.paid)} tone="green" />
        <StatCard icon={CircleDollarSign} label="Dette fournisseurs" value={money(stats.debt)} tone="red" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="N° facture, n° BL ou fournisseur…" />
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="Aucun achat carburant"
          message="Créez un achat : facture, bon de livraison, cuves livrées et paiements."
          action={perm.creer ? <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nouvel achat</button> : undefined} />
      ) : (
        <div className="card-glass overflow-hidden">
          <Table head={<>
            <th className="table-head">Date</th><th className="table-head">Facture</th><th className="table-head">BL</th>
            <th className="table-head">Fournisseur</th><th className="table-head">Cuves</th>
            <th className="table-head">Volume</th><th className="table-head">Total</th>
            <th className="table-head">Payé</th><th className="table-head">Reste</th>
            <th className="table-head">Statut</th><th className="table-head text-right">Actions</th>
          </>}>
            {filtered.map(p => {
              const supplier = suppliers.find(s => s.id === p.supplierId);
              const liters = (p.items || []).reduce((a, i) => a + (i.quantity || 0), 0);
              const cuveNames = (p.items || [])
                .map(i => tanks.find(t => t.id === i.tankId)?.name)
                .filter(Boolean).join(', ');
              return (
                <tr key={p.id}>
                  <td className="table-cell whitespace-nowrap">{formatDate(p.date)}</td>
                  <td className="table-cell font-bold">{p.invoiceNumber || '—'}</td>
                  <td className="table-cell">{p.blNumber || '—'}</td>
                  <td className="table-cell">{supplier?.name || '—'}</td>
                  <td className="table-cell text-xs text-slate-500 max-w-[180px]">{cuveNames || '—'}</td>
                  <td className="table-cell tabular-nums">{liters.toLocaleString('fr-FR')} L</td>
                  <td className="table-cell tabular-nums font-bold">{money(p.total)}</td>
                  <td className="table-cell tabular-nums text-emerald-600">{money(p.amountPaid)}</td>
                  <td className="table-cell tabular-nums text-red-600">{money(p.rest)}</td>
                  <td className="table-cell"><Badge tone={STATUS_TONE[p.status] || 'neutral'}>{p.status}</Badge></td>
                  <td className="table-cell">
                    <RowActions>
                      <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(p)} />
                      <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(p)} />
                      {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(p)} />}
                      {p.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer la dette" onClick={() => setPaying(p)} />}
                      {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(p)} />}
                    </RowActions>
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}

      {(creating || editing) && (
        <PurchaseForm initial={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      {viewing && <PurchaseDetail purchase={viewing} onClose={() => setViewing(null)} onPrint={() => doPrint(viewing)} />}
      {paying && <PayPurchaseDebtModal purchase={paying} onClose={() => setPaying(null)} />}

      <Confirm open={!!toDelete} title="Supprimer l'achat"
        message="Les quantités seront retirées des cuves et les paiements annulés. Confirmer ?"
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function accountLabel(accountId: string | undefined, accounts: { id: string; name: string }[]): string {
  if (!accountId || accountId === CAISSE_ID) return 'Espèces (caisse générale)';
  return accounts.find(a => a.id === accountId)?.name || 'Compte bancaire';
}

/** Purchase price of a fuel type, taken from the station settings. */
function buyPriceOf(type: FuelType | undefined, settings: any): number {
  if (!type) return 0;
  return Number(settings?.fuelBuyPrices?.[type]) || 0;
}

function statusFor(total: number, paid: number): Purchase['status'] {
  if (paid <= 0) return 'À payer';
  if (paid + 0.001 >= total) return 'Payé';
  return 'Partiel';
}

// ─── Create / edit ─────────────────────────────────────────────────────────────
function PurchaseForm({ initial, onClose }: { initial: Purchase | null; onClose: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { suppliers, tanks, bankAccounts, treasuryTransactions, settings, currentUserName } = state;
  const isEdit = !!initial;

  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber || '');
  const [blNumber, setBlNumber] = useState(initial?.blNumber || '');
  const [date, setDate] = useState(initial ? initial.date.split('T')[0] : todayISO());
  const [supplierId, setSupplierId] = useState(initial?.supplierId || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const [lines, setLines] = useState<CuveLine[]>(() =>
    (initial?.items || []).filter(i => i.tankId).map(i => ({
      id: newId(), tankId: i.tankId!, quantity: String(i.quantity ?? ''), unitPrice: String(i.buyPrice ?? ''),
    })));

  const [tvaActive, setTvaActive] = useState(!!initial?.tvaActive);
  const [tvaRate, setTvaRate] = useState(String(initial?.tvaRate ?? 19));
  const [discountOn, setDiscountOn] = useState(!!initial?.discountAmount);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(initial?.discountType || 'percent');
  const [discountValue, setDiscountValue] = useState(String(initial?.discountValue ?? ''));

  const [pays, setPays] = useState<PayLine[]>(() =>
    (initial?.payments || []).map(p => ({
      id: p.id, accountId: p.accountId || CAISSE_ID, amount: String(p.amount ?? ''),
      chequeNumber: p.chequeNumber || '', bordereauNumber: p.bordereauNumber || '',
    })));

  // ── Money ────────────────────────────────────────────────────────────────
  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const discountAmount = !discountOn ? 0
    : discountType === 'percent'
      ? subtotal * (Number(discountValue) || 0) / 100
      : Math.min(subtotal, Number(discountValue) || 0);
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const tvaAmount = tvaActive ? afterDiscount * (Number(tvaRate) || 0) / 100 : 0;
  const total = afterDiscount + tvaAmount;
  const paid = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const rest = Math.max(0, total - paid);

  // ── Cuve lines ───────────────────────────────────────────────────────────
  const addLine = () => {
    const used = new Set(lines.map(l => l.tankId));
    const tank = tanks.find(t => !used.has(t.id)) || tanks[0];
    setLines(prev => [...prev, {
      id: newId(), tankId: tank?.id || '', quantity: '',
      unitPrice: String(buyPriceOf(tank?.type, settings)),
    }]);
  };
  const setLine = (id: string, patch: Partial<CuveLine>) =>
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      // Changing the cuve re-applies the purchase price of its fuel type.
      if (patch.tankId !== undefined) {
        const tank = tanks.find(t => t.id === patch.tankId);
        next.unitPrice = String(buyPriceOf(tank?.type, settings));
      }
      return next;
    }));
  const rmLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  // ── Payment lines ────────────────────────────────────────────────────────
  const addPay = () => setPays(prev => [...prev, {
    id: newId(), accountId: CAISSE_ID, amount: String(Math.max(0, total - paid) || ''),
    chequeNumber: '', bordereauNumber: '',
  }]);
  const setPay = (id: string, patch: Partial<PayLine>) =>
    setPays(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  const rmPay = (id: string) => setPays(prev => prev.filter(p => p.id !== id));

  const accountBalance = (accountId: string) => accountId === CAISSE_ID
    ? caisseBalanceOf(treasuryTransactions)
    : bankBalanceOf(
      bankAccounts.find(a => a.id === accountId) || { id: accountId, initialBalance: 0 },
      treasuryTransactions);

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = () => {
    const purchaseId = initial?.id || newId();

    const items: PurchaseItem[] = lines
      .filter(l => l.tankId)
      .map(l => {
        const tank = tanks.find(t => t.id === l.tankId);
        const quantity = Number(l.quantity) || 0;
        const buyPrice = Number(l.unitPrice) || 0;
        return {
          productName: `${tank?.name || 'Cuve'} — ${tank?.type || ''}`.trim(),
          quantity, buyPrice, sellingPrice: 0,
          unit: 'L', total: quantity * buyPrice, tankId: l.tankId,
          tvaActive, tvaRate: Number(tvaRate) || 0,
        };
      });

    const payments: PurchasePayment[] = pays
      .filter(p => (Number(p.amount) || 0) > 0)
      .map(p => ({
        id: p.id,
        date: new Date(date).toISOString(),
        amount: Number(p.amount) || 0,
        mode: p.accountId === CAISSE_ID ? 'ESPECES' : (p.chequeNumber ? 'CHEQUE' : 'VIREMENT'),
        chequeNumber: p.chequeNumber || undefined,
        bordereauNumber: p.bordereauNumber || undefined,
        accountId: p.accountId,
      }));

    const purchase: Purchase = {
      id: purchaseId,
      date: new Date(date).toISOString(),
      supplierId,
      invoiceNumber: invoiceNumber || undefined,
      blNumber: blNumber || undefined,
      items,
      subtotal,
      discountType: discountOn ? discountType : undefined,
      discountValue: discountOn ? Number(discountValue) || 0 : undefined,
      discountAmount,
      tvaActive, tvaRate: Number(tvaRate) || 0, tvaAmount,
      total,
      amountPaid: paid,
      rest,
      status: statusFor(total, paid),
      payments,
      notes: notes || undefined,
      type: 'RECEPTION',
      tankId: items[0]?.tankId,
    };

    // 1. Cuve levels — on edit we only apply the difference with the old lines.
    const oldByTank: Record<string, number> = {};
    (initial?.items || []).forEach(i => { if (i.tankId) oldByTank[i.tankId] = (oldByTank[i.tankId] || 0) + (i.quantity || 0); });
    const newByTank: Record<string, number> = {};
    items.forEach(i => { if (i.tankId) newByTank[i.tankId] = (newByTank[i.tankId] || 0) + i.quantity; });
    const deltas = Array.from(new Set([...Object.keys(oldByTank), ...Object.keys(newByTank)]))
      .map(tankId => ({ tankId, deltaLiters: (newByTank[tankId] || 0) - (oldByTank[tankId] || 0) }))
      .filter(d => Math.abs(d.deltaLiters) > 0.0001);
    if (deltas.length) dispatch({ type: 'ADJUST_TANK_LEVELS', payload: deltas });

    // 2. The purchase itself.
    dispatch({ type: isEdit ? 'UPDATE_PURCHASE' : 'ADD_PURCHASE', payload: purchase });

    // 3. Treasury: money actually leaving the caisse / the bank accounts.
    //    Rewriting the lines of this purchase keeps balances exact after an edit.
    treasuryTransactions
      .filter(t => t.refType === 'purchase' && t.refId === purchaseId)
      .forEach(t => dispatch({ type: 'DELETE_TREASURY_TX', payload: t.id }));
    const supplierName = suppliers.find(s => s.id === supplierId)?.name || 'Fournisseur';
    payments.forEach(pay => {
      const tx: TreasuryTransaction = {
        id: newId(),
        date: pay.date,
        kind: 'PURCHASE',
        amount: pay.amount,
        description: `Achat carburant ${invoiceNumber ? `n° ${invoiceNumber}` : ''} — ${supplierName}`.trim(),
        accountFrom: pay.accountId,
        part: 'carburant',
        refType: 'purchase', refId: purchaseId,
        chequeNumber: pay.chequeNumber,
        bordereauNumber: pay.bordereauNumber,
        createdBy: currentUserName,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
    });

    toast.success(isEdit
      ? 'Achat modifié — cuves et trésorerie mises à jour'
      : rest > 0
        ? `Achat enregistré avec une dette de ${money(rest)}`
        : 'Achat enregistré — cuves mises à jour');
    onClose();
  };

  return (
    <Modal open onClose={onClose} icon={ShoppingCart} size="2xl"
      title={isEdit ? "Modifier l'achat carburant" : 'Nouvel achat carburant'}
      subtitle="Aucun champ n'est obligatoire — l'achat peut être enregistré en dette"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : "Enregistrer l'achat"}</button>
      </>}>
      <div className="space-y-6">
        {/* 1 + 2. Références, date, fournisseur */}
        <section className="space-y-3">
          <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Références
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="N° de facture"><Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="FA-2026-001" /></Field>
            <Field label="N° bon de livraison"><Input value={blNumber} onChange={e => setBlNumber(e.target.value)} placeholder="BL-2026-001" /></Field>
            <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
            <Field label="Fournisseur">
              <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
        </section>

        {/* 3. Cuves */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5" /> Cuves livrées
            </h4>
            <button className="btn-secondary !py-1.5 !px-3 text-xs" onClick={addLine} disabled={tanks.length === 0}>
              <Plus className="w-3.5 h-3.5" /> Ajouter une cuve
            </button>
          </div>

          {tanks.length === 0 && (
            <p className="text-xs text-amber-600">Aucune cuve configurée — créez-en une dans « Cuves / Tanks ».</p>
          )}

          {lines.length === 0 ? (
            <p className="text-sm text-slate-400 rounded-xl bg-slate-50 p-4 text-center">
              Ajoutez une ou plusieurs cuves. Le prix d'achat vient des paramètres de la station.
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map(l => {
                const tank = tanks.find(t => t.id === l.tankId);
                const qty = Number(l.quantity) || 0;
                const price = Number(l.unitPrice) || 0;
                const after = (tank?.current || 0) + qty;
                const overflow = tank ? after > tank.capacity : false;
                return (
                  <div key={l.id} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <div className="sm:col-span-4">
                        <label className="text-[10px] font-bold uppercase text-slate-400">Cuve</label>
                        <Select value={l.tankId} onChange={e => setLine(l.id, { tankId: e.target.value })}>
                          <option value="">— Choisir —</option>
                          {tanks.map(t => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
                        </Select>
                      </div>
                      <div className="sm:col-span-3">
                        <label className="text-[10px] font-bold uppercase text-slate-400">Quantité (L)</label>
                        <Input type="number" step="0.01" value={l.quantity} onChange={e => setLine(l.id, { quantity: e.target.value })} placeholder="0" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-bold uppercase text-slate-400">Prix / L</label>
                        <Input type="number" step="0.01" value={l.unitPrice} onChange={e => setLine(l.id, { unitPrice: e.target.value })} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-bold uppercase text-slate-400">Total ligne</label>
                        <div className="h-[46px] rounded-xl bg-white border border-slate-200 flex items-center px-3 font-black tabular-nums text-[#002d87]">
                          {money(qty * price)}
                        </div>
                      </div>
                      <div className="sm:col-span-1 flex justify-end">
                        <button onClick={() => rmLine(l.id)} className="w-10 h-10 rounded-xl text-red-500 hover:bg-red-50 flex items-center justify-center">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {tank && (
                      <p className={`text-[11px] mt-2 ${overflow ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                        Niveau actuel {tank.current.toLocaleString('fr-FR')} L → après livraison {after.toLocaleString('fr-FR')} L
                        {' '}sur {tank.capacity.toLocaleString('fr-FR')} L
                        {overflow ? ' — dépasse la capacité de la cuve' : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 4. Total, TVA, remise */}
        <section className="space-y-3">
          <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <Percent className="w-3.5 h-3.5" /> Total, TVA & remise
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-700">Remise</p>
                  <p className="text-xs text-slate-400">Déduite automatiquement du sous-total</p>
                </div>
                <Switch checked={discountOn} onChange={setDiscountOn} />
              </div>
              {discountOn && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Type">
                    <Select value={discountType} onChange={e => setDiscountType(e.target.value as 'percent' | 'amount')}>
                      <option value="percent">Pourcentage (%)</option>
                      <option value="amount">Montant fixe (DA)</option>
                    </Select>
                  </Field>
                  <Field label={discountType === 'percent' ? 'Valeur (%)' : 'Valeur (DA)'}>
                    <Input type="number" step="0.01" value={discountValue} onChange={e => setDiscountValue(e.target.value)} />
                  </Field>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <div>
                  <p className="text-sm font-bold text-slate-700">TVA</p>
                  <p className="text-xs text-slate-400">Appliquée après la remise</p>
                </div>
                <Switch checked={tvaActive} onChange={setTvaActive} />
              </div>
              {tvaActive && (
                <Field label="Taux de TVA (%)">
                  <Input type="number" step="0.01" value={tvaRate} onChange={e => setTvaRate(e.target.value)} />
                </Field>
              )}
            </div>

            <div className="rounded-2xl bg-[#001f5c] text-white p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-blue-200">Sous-total</span><span className="font-bold tabular-nums">{money(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-blue-200">Remise</span><span className="font-bold tabular-nums text-amber-300">− {money(discountAmount)}</span></div>
              <div className="flex justify-between"><span className="text-blue-200">TVA {tvaActive ? `(${tvaRate}%)` : ''}</span><span className="font-bold tabular-nums">{money(tvaAmount)}</span></div>
              <div className="flex justify-between pt-2 border-t border-white/20">
                <span className="font-semibold">Total à payer</span>
                <span className="text-xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Paiements */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5" /> Modes de paiement
            </h4>
            <button className="btn-secondary !py-1.5 !px-3 text-xs" onClick={addPay}>
              <Plus className="w-3.5 h-3.5" /> Ajouter un paiement
            </button>
          </div>

          {pays.length === 0 ? (
            <p className="text-sm text-slate-400 rounded-xl bg-slate-50 p-4 text-center">
              Aucun paiement — l'achat sera enregistré entièrement en dette.
            </p>
          ) : (
            <div className="space-y-2">
              {pays.map(p => (
                <div key={p.id} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase text-slate-400">Mode / compte</label>
                      <Select value={p.accountId} onChange={e => setPay(p.id, { accountId: e.target.value })}>
                        <option value={CAISSE_ID}>Espèces (caisse générale)</option>
                        {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold uppercase text-slate-400">N° chèque</label>
                      <Input value={p.chequeNumber} onChange={e => setPay(p.id, { chequeNumber: e.target.value })} placeholder="Optionnel" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold uppercase text-slate-400">N° bordereau</label>
                      <Input value={p.bordereauNumber} onChange={e => setPay(p.id, { bordereauNumber: e.target.value })} placeholder="Optionnel" />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase text-slate-400">Montant payé</label>
                      <Input type="number" step="0.01" value={p.amount} onChange={e => setPay(p.id, { amount: e.target.value })} placeholder="0" />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      <button onClick={() => rmPay(p.id)} className="w-10 h-10 rounded-xl text-red-500 hover:bg-red-50 flex items-center justify-center">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1.5">
                    {p.accountId === CAISSE_ID ? <Wallet className="w-3 h-3" /> : <Landmark className="w-3 h-3" />}
                    Solde {accountLabel(p.accountId, bankAccounts)} : {money(accountBalance(p.accountId))}
                    {' '}→ {money(accountBalance(p.accountId) - (Number(p.amount) || 0))} après paiement
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-[10px] uppercase font-bold text-slate-400">Total achat</p>
              <p className="font-black text-slate-700 tabular-nums">{money(total)}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 text-center">
              <p className="text-[10px] uppercase font-bold text-slate-400">Total payé</p>
              <p className="font-black text-emerald-600 tabular-nums">{money(paid)}</p>
            </div>
            <div className="rounded-xl bg-red-50 p-3 text-center">
              <p className="text-[10px] uppercase font-bold text-slate-400">Reste (dette)</p>
              <p className="font-black text-red-600 tabular-nums">{money(rest)}</p>
            </div>
          </div>
          {rest > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              L'achat sera enregistré avec le statut « {statusFor(total, paid)} » — le reste de {money(rest)} reste dû au fournisseur.
            </p>
          )}
        </section>

        <Field label="Notes"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ─── Detail ────────────────────────────────────────────────────────────────────
function PurchaseDetail({ purchase, onClose, onPrint }: {
  purchase: Purchase; onClose: () => void; onPrint: () => void;
}) {
  const { suppliers, tanks, bankAccounts } = useAppState();
  const supplier = suppliers.find(s => s.id === purchase.supplierId);
  return (
    <Modal open onClose={onClose} icon={ShoppingCart} size="xl"
      title={`Achat ${purchase.invoiceNumber || purchase.blNumber || ''}`.trim()}
      subtitle={`${supplier?.name || 'Fournisseur'} — ${formatDate(purchase.date)}`}
      footer={<button className="btn-outline" onClick={onPrint}><Printer className="w-4 h-4" /> Imprimer</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">N° facture</p><p className="font-bold text-slate-700 text-sm">{purchase.invoiceNumber || '—'}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">N° BL</p><p className="font-bold text-slate-700 text-sm">{purchase.blNumber || '—'}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Date</p><p className="font-bold text-slate-700 text-sm">{formatDate(purchase.date)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Statut</p><p className="font-bold text-slate-700 text-sm">{purchase.status}</p></div>
        </div>

        <Table head={<><th className="table-head">Cuve</th><th className="table-head">Quantité</th><th className="table-head">Prix / L</th><th className="table-head text-right">Total</th></>}>
          {(purchase.items || []).map((i, idx) => {
            const tank = tanks.find(t => t.id === i.tankId);
            return (
              <tr key={idx}>
                <td className="table-cell">{tank ? `${tank.name} (${tank.type})` : i.productName}</td>
                <td className="table-cell tabular-nums">{i.quantity.toLocaleString('fr-FR')} L</td>
                <td className="table-cell tabular-nums">{money(i.buyPrice)}</td>
                <td className="table-cell text-right tabular-nums font-bold">{money(i.total)}</td>
              </tr>
            );
          })}
        </Table>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Sous-total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(purchase.subtotal ?? purchase.total)}</p></div>
          <div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Remise</p><p className="font-black text-amber-600 tabular-nums text-sm">{money(purchase.discountAmount || 0)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">TVA</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(purchase.tvaAmount || 0)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(purchase.amountPaid)}</p></div>
          <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(purchase.rest)}</p></div>
        </div>

        {(purchase.payments || []).length > 0 && (
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Paiements</p>
            <Table head={<><th className="table-head">Date</th><th className="table-head">Mode / compte</th><th className="table-head">Références</th><th className="table-head text-right">Montant</th></>}>
              {purchase.payments.map(pay => (
                <tr key={pay.id}>
                  <td className="table-cell">{formatDate(pay.date)}</td>
                  <td className="table-cell">{accountLabel(pay.accountId, bankAccounts)}</td>
                  <td className="table-cell text-xs text-slate-500">
                    {[pay.chequeNumber && `Chèque ${pay.chequeNumber}`, pay.bordereauNumber && `Bordereau ${pay.bordereauNumber}`].filter(Boolean).join(' • ') || '—'}
                  </td>
                  <td className="table-cell text-right tabular-nums font-bold">{money(pay.amount)}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}

        {purchase.notes && (
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] uppercase font-bold text-slate-400">Notes</p>
            <p className="text-sm text-slate-600">{purchase.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Pay a debt ────────────────────────────────────────────────────────────────
function PayPurchaseDebtModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { bankAccounts, suppliers, treasuryTransactions, currentUserName } = state;

  const [accountId, setAccountId] = useState<string>(CAISSE_ID);
  const [amount, setAmount] = useState(String(purchase.rest));
  const [date, setDate] = useState(todayISO());
  const [chequeNumber, setChequeNumber] = useState('');
  const [bordereauNumber, setBordereauNumber] = useState('');

  const value = Number(amount) || 0;
  const newPaid = purchase.amountPaid + value;
  const newRest = Math.max(0, purchase.total - newPaid);

  const save = () => {
    if (value <= 0) { toast.error('Montant requis'); return; }
    const payment: PurchasePayment = {
      id: newId(), date: new Date(date).toISOString(), amount: value,
      mode: accountId === CAISSE_ID ? 'ESPECES' : (chequeNumber ? 'CHEQUE' : 'VIREMENT'),
      chequeNumber: chequeNumber || undefined,
      bordereauNumber: bordereauNumber || undefined,
      accountId,
    };
    dispatch({
      type: 'UPDATE_PURCHASE',
      payload: {
        ...purchase,
        payments: [...(purchase.payments || []), payment],
        amountPaid: newPaid,
        rest: newRest,
        status: statusFor(purchase.total, newPaid),
      },
    });
    const supplierName = suppliers.find(s => s.id === purchase.supplierId)?.name || 'Fournisseur';
    dispatch({
      type: 'ADD_TREASURY_TX',
      payload: {
        id: newId(), date: payment.date, kind: 'PURCHASE', amount: value,
        description: `Règlement dette achat ${purchase.invoiceNumber ? `n° ${purchase.invoiceNumber}` : ''} — ${supplierName}`.trim(),
        accountFrom: accountId, part: 'carburant',
        refType: 'purchase', refId: purchase.id,
        chequeNumber: payment.chequeNumber, bordereauNumber: payment.bordereauNumber,
        createdBy: currentUserName, createdAt: new Date().toISOString(),
      },
    });
    toast.success('Paiement enregistré');
    onClose();
  };

  const balance = accountId === CAISSE_ID
    ? caisseBalanceOf(treasuryTransactions)
    : bankBalanceOf(bankAccounts.find(a => a.id === accountId) || { id: accountId, initialBalance: 0 }, treasuryTransactions);

  return (
    <Modal open onClose={onClose} icon={Wallet} size="md"
      title="Payer la dette" subtitle={`${purchase.invoiceNumber || purchase.blNumber || 'Achat'} — reste ${money(purchase.rest)}`}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={value <= 0}>Enregistrer le paiement</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(purchase.total)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Déjà payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(purchase.amountPaid)}</p></div>
          <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(purchase.rest)}</p></div>
        </div>

        <Field label="Payer depuis">
          <Select value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value={CAISSE_ID}>Espèces (caisse générale)</option>
            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <p className="text-[11px] text-slate-400 -mt-2">Solde disponible : {money(balance)}</p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (DA)" required><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="N° chèque"><Input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} placeholder="Optionnel" /></Field>
          <Field label="N° bordereau"><Input value={bordereauNumber} onChange={e => setBordereauNumber(e.target.value)} placeholder="Optionnel" /></Field>
        </div>

        <div className="rounded-xl bg-[#001f5c] text-white p-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-blue-200">Nouveau reste</span>
          <span className="text-xl font-black tabular-nums text-[#FFB800]">{money(newRest)}</span>
        </div>
      </div>
    </Modal>
  );
}
