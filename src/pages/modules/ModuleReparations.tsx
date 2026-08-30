/**
 * ─── Vidanges & Lavage ───────────────────────────────────────────────────────
 * Interventions of the Lavage & Vidange part.
 *
 *  • Le client est optionnel — sans client, l'intervention est au nom d'un
 *    « Client de passage ».
 *  • Une intervention porte AUTANT DE PRESTATIONS que nécessaire : un lavage et
 *    une vidange peuvent être créés en une seule fois. Chaque prestation a sa
 *    désignation, son montant et ses employés (base de la paie au pourcentage).
 *  • Une remise peut être appliquée en pourcentage ou en montant fixe ; elle est
 *    déduite du sous-total (prestations + produits).
 *  • Les produits utilisés sont cherchés par nom OU code-barres ; un produit
 *    vendu au détail se saisit dans son unité de détail (ex: 10 L sur 50 L).
 *  • Une intervention peut être créée « en attente » puis finalisée plus tard
 *    avec exactement le même formulaire.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  Car, Wrench, Droplets, Plus, Search, X, User, Wallet, Printer,
  Eye, Edit2, Trash2, Clock, Package, CheckCircle2, Hourglass, Layers, Percent, Tag,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId, matchesSearch } from '@/src/lib/utils';
import {
  ModuleKey, MODULES, BizReparation, BizRepKind, BizPrestation, BizDiscountType,
  BizCar, BizLineItem, BizProduct, BizWorker, detailPrice, discountOf, prestationsOf, formatQty,
} from '@/src/lib/bizConfig';
import { applyRestock, describeRestock, restockPlan, totalRestocked } from '@/src/lib/bizRestock';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, Badge, SearchInput, ViewToggle, CardGrid, GlassCard, Table, EmptyState,
  RowActions, ActionBtn, Confirm, Modal, Field, Input, Textarea, money, formatDate,
  PeriodFilter, Period, inPeriod,
} from '@/src/components/biz/Kit';
import { ContactModal, PayDebtModal, PayDebtMeta, withPayment, seedPayments, printInvoice, AskPrintModal, stationFromSettings } from './_shared';
import { ClientCarPicker } from './ClientCarPicker';

const KIND_META: Record<BizRepKind, { label: string; icon: React.ElementType }> = {
  reparation: { label: 'Vidange', icon: Wrench },
  lavage: { label: 'Lavage', icon: Droplets },
  mixte: { label: 'Lavage + Vidange', icon: Layers },
};

/** Kind of the whole intervention, derived from what it actually contains. */
function kindOfPrestations(lines: BizPrestation[], fallback: BizRepKind): BizRepKind {
  if (!lines.length) return fallback === 'mixte' ? 'lavage' : fallback;
  const hasLav = lines.some(l => l.kind === 'lavage');
  const hasRep = lines.some(l => l.kind === 'reparation');
  return hasLav && hasRep ? 'mixte' : (hasLav ? 'lavage' : 'reparation');
}

/** Employees proposed on a prestation of that kind (polyvalents always show). */
function workersForKind(workers: BizWorker[], kind: 'lavage' | 'reparation'): BizWorker[] {
  return workers.filter(w => !w.workerKind || w.workerKind === 'both' || w.workerKind === kind);
}
const STATUS_META: Record<string, { label: string; tone: any }> = {
  pending: { label: 'En attente', tone: 'warning' },
  finalized: { label: 'Finalisé', tone: 'success' },
  canceled: { label: 'Annulé', tone: 'danger' },
};

const PASSAGE = 'Client de passage';

export default function ModuleReparations({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'reparations');
  const { settings } = useAppState();
  const { reparations, clients, workers } = biz.state;

  const [search, setSearch] = useState('');
  // Tableau par défaut : une journée d'atelier se lit en lignes — réf, client,
  // véhicule, reste à encaisser. Les cartes restent à un clic.
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [status, setStatus] = useState<'all' | 'pending' | 'finalized' | 'canceled'>('all');
  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [creating, setCreating] = useState<null | { kind: BizRepKind; pending: boolean }>(null);
  const [viewing, setViewing] = useState<BizReparation | null>(null);
  const [editing, setEditing] = useState<BizReparation | null>(null);
  const [paying, setPaying] = useState<BizReparation | null>(null);
  const [toDelete, setToDelete] = useState<BizReparation | null>(null);
  const [askPrint, setAskPrint] = useState<BizReparation | null>(null);

  const filtered = useMemo(() => [...reparations].filter(r => {
    const client = clients.find(c => c.id === r.clientId);
    const matchQ = matchesSearch(search, r.clientName, client?.phone, r.ref, r.car?.immatriculation);
    return matchQ && (status === 'all' || r.status === status) && inPeriod(r.date, period, from, to);
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [reparations, clients, search, status, period, from, to]);

  const stats = useMemo(() => ({
    total: reparations.length,
    pending: reparations.filter(r => r.status === 'pending').length,
    revenue: reparations.reduce((s, r) => s + r.total, 0),
    rest: reparations.reduce((s, r) => s + r.rest, 0),
  }), [reparations]);

  /**
   * Supprimer une intervention ANNULE la sortie des pièces et consommables
   * qu'elle avait utilisés : l'huile, les filtres et le shampoing reviennent en
   * Gestion de stock avant que la ligne ne disparaisse. Sans cela, la
   * marchandise restait comptée comme sortie d'un travail qui n'existe plus.
   */
  const del = () => {
    if (!toDelete) return;
    const plan = restockPlan(biz.state, toDelete.usedProducts || []);
    applyRestock(biz, plan);
    const qty = totalRestocked(plan);
    biz.remove('reparations', toDelete.id);
    toast.success(qty > 0
      ? `Intervention supprimée — ${formatQty(qty)} unité(s) remise(s) en stock`
      : 'Intervention supprimée');
    setToDelete(null);
  };

  /** Ce que la suppression va remettre en stock, montré dans la confirmation. */
  const deleteImpact = useMemo(
    () => (toDelete ? describeRestock(biz.state, toDelete.usedProducts || []) : ''),
    [toDelete, biz.state]);

  const onPay = (amount: number, meta: PayDebtMeta) => {
    if (!paying) return;
    biz.update('reparations', withPayment(paying, amount, meta));
    toast.success('Paiement enregistré'); setPaying(null);
  };

  const doPrint = (r: BizReparation) => {
    const client = clients.find(c => c.id === r.clientId);
    const nameOf = (id: string) => workers.find(w => w.id === id)?.name;
    const workerNames = r.workers.map(nameOf).filter(Boolean).join(', ');
    const lines = prestationsOf(r);
    const productsTotal = r.usedProducts.reduce((s, p) => s + (p.total ?? p.qty * p.unitPrice), 0);
    const subtotal = r.subtotal ?? (r.serviceTotal + productsTotal);
    printInvoice({
      title: KIND_META[r.kind].label, ref: r.ref, date: r.date,
      station: stationFromSettings(settings),
      party: { label: 'Client', name: r.clientName, phone: client?.phone, address: client?.address },
      info: [
        { label: 'Véhicule', value: [r.car?.marque, r.car?.name, r.car?.color, r.car?.year].filter(Boolean).join(' • ') },
        { label: 'Immatriculation', value: r.car?.immatriculation || '' },
        { label: 'Employé(s)', value: workerNames },
        { label: 'Statut', value: STATUS_META[r.status].label },
        { label: 'Prestations', value: lines.length > 1 ? `${lines.length} prestations` : '' },
      ],
      items: [
        // One printed line per prestation, so the client sees exactly what was done.
        ...lines.map(l => ({
          name: `${KIND_META[l.kind].label} — ${l.label || 'Main d’œuvre'}`
            + (l.workerIds.length ? ` (${l.workerIds.map(nameOf).filter(Boolean).join(', ')})` : ''),
          qty: 1, unitPrice: l.amount, total: l.amount,
        })),
        ...r.usedProducts.map(p => ({
          name: p.productName,
          qty: p.detailQty ? `${p.detailQty} ${p.detailUnit || ''}`.trim() : p.qty,
          unitPrice: p.unitPrice,
          total: p.total ?? p.qty * p.unitPrice,
        })),
      ],
      subtotal: r.discountAmount ? subtotal : undefined,
      reduction: r.discountAmount || undefined,
      total: r.total, paid: r.paid, rest: r.rest,
      payments: [{ label: 'Espèces', amount: r.paid }],
      notes: r.problem,
      footerNote: r.discountAmount
        ? `Remise accordée : ${r.discountType === 'percent' ? `${r.discountValue}%` : money(r.discountAmount)}`
        : undefined,
    });
    biz.update('reparations', { ...r, printedAt: new Date().toISOString() });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Car} title="Vidanges & Lavage" subtitle={`${cfg.label} — atelier & interventions`}
        actions={perm.creer ? <NewInterventionActions onPick={setCreating} /> : undefined} />

      {/* Alerte — des interventions attendent d'être finalisées. */}
      {stats.pending > 0 && (
        <button onClick={() => setStatus('pending')}
          className="w-full text-left rounded-2xl p-4 flex flex-wrap items-center gap-3 transition-transform hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(135deg, #b45309, #f59e0b)', boxShadow: '0 8px 24px rgba(245,158,11,0.28)' }}>
          <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Hourglass className="w-5 h-5 text-white animate-pulse" />
          </span>
          <span className="min-w-0">
            <span className="block font-black text-white">
              {stats.pending} intervention{stats.pending > 1 ? 's' : ''} en attente
            </span>
            <span className="block text-[12px] text-amber-50">
              Lavages / vidanges à finaliser — cliquez pour n'afficher que celles-ci.
            </span>
          </span>
          <span className="ml-auto text-xs font-black text-white bg-white/20 rounded-lg px-3 py-1.5 shrink-0">
            Voir les interventions
          </span>
        </button>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Car} label="Interventions" value={stats.total} tone="blue" />
        <StatCard icon={Clock} label="En attente" value={stats.pending} tone="amber" />
        <StatCard icon={Wallet} label="Chiffre d'affaires" value={money(stats.revenue)} tone="green" />
        <StatCard icon={Wallet} label="Reste à encaisser" value={money(stats.rest)} tone="red" />
      </div>

      <div className="card-glass p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Client, téléphone, réf ou immatriculation…" />
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'pending', 'finalized', 'canceled'] as const).map(s => {
              const n = s === 'all' ? reparations.length : reparations.filter(r => r.status === s).length;
              return (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${status === s ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {s === 'all' ? 'Tous' : STATUS_META[s].label}
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums ${
                    status === s ? 'bg-white/20' : (s === 'pending' && n > 0 ? 'bg-amber-500 text-white' : 'bg-white text-slate-400')}`}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto"><ViewToggle view={view} onChange={setView} /></div>
        </div>
        <PeriodFilter period={period} onChange={setPeriod} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Car} title="Aucune intervention" message="Créez un lavage ou une vidange, ou enregistrez-la en attente." />
      ) : view === 'table' ? (
        <Table head={<>
          <th className="table-head">Réf</th><th className="table-head">Client</th><th className="table-head">Véhicule</th>
          <th className="table-head">Prestations</th><th className="table-head">Date</th>
          <th className="table-head text-right">Total</th><th className="table-head text-right">Payé</th>
          <th className="table-head text-right">Reste</th><th className="table-head">État</th>
          <th className="table-head text-right">Actions</th>
        </>}>
          {filtered.map(r => {
            const KM = KIND_META[r.kind]; const KIcon = KM.icon;
            const carLabel = [r.car?.marque, r.car?.name, r.car?.immatriculation].filter(Boolean).join(' • ');
            return (
              <tr key={r.id} className={r.status === 'pending' ? 'bg-amber-50/60' : undefined}>
                <td className="table-cell font-bold">
                  <span className="inline-flex items-center gap-1.5"><KIcon className="w-4 h-4 text-[#003087]" />{r.ref}</span>
                </td>
                <td className="table-cell">{r.clientName}</td>
                <td className="table-cell text-slate-500 max-w-[200px] truncate" title={carLabel || undefined}>{carLabel || '—'}</td>
                <td className="table-cell">
                  <div className="flex flex-wrap gap-1 max-w-[260px]">
                    {prestationsOf(r).map(l => (
                      <Badge key={l.id} tone={l.kind === 'lavage' ? 'info' : 'primary'}>
                        {l.label || KIND_META[l.kind].label}
                      </Badge>
                    ))}
                    {r.usedProducts.length > 0 && <Badge tone="neutral">{r.usedProducts.length} produit(s)</Badge>}
                  </div>
                </td>
                <td className="table-cell whitespace-nowrap text-slate-500">{formatDate(r.date)}</td>
                <td className="table-cell tabular-nums text-right font-bold">{money(r.total)}</td>
                <td className="table-cell tabular-nums text-right text-emerald-600">{money(r.paid)}</td>
                <td className="table-cell tabular-nums text-right text-red-600">{money(r.rest)}</td>
                <td className="table-cell"><Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge></td>
                <td className="table-cell text-right">
                  <RowActions>
                    {r.status === 'pending' && perm.modifier && (
                      <ActionBtn icon={CheckCircle2} tone="green" title="Finaliser l'intervention" onClick={() => setEditing(r)} />
                    )}
                    <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(r)} />
                    <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(r)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(r)} />}
                    {r.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(r)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(r)} />}
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <CardGrid>
          {filtered.map(r => {
            const KM = KIND_META[r.kind]; const KIcon = KM.icon;
            return (
              <GlassCard key={r.id}
                className={r.status === 'pending' ? '!border-amber-300 ring-1 ring-amber-200' : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5"><KIcon className="w-4 h-4 text-[#003087]" /><h3 className="font-black text-slate-800">{r.ref}</h3></div>
                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><User className="w-3 h-3" />{r.clientName}</p>
                  </div>
                  <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
                </div>
                {(r.car?.marque || r.car?.name || r.car?.immatriculation) && (
                  <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                    <Car className="w-3 h-3" />{[r.car.marque, r.car.name, r.car.immatriculation].filter(Boolean).join(' • ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {prestationsOf(r).map(l => (
                    <Badge key={l.id} tone={l.kind === 'lavage' ? 'info' : 'primary'}>
                      {l.kind === 'lavage' ? '🧽' : '🔧'} {l.label || KIND_META[l.kind].label} {money(l.amount)}
                    </Badge>
                  ))}
                  {r.usedProducts.length > 0 && <Badge tone="neutral">{r.usedProducts.length} produit(s)</Badge>}
                  {!!r.discountAmount && (
                    <Badge tone="warning">
                      Remise {r.discountType === 'percent' ? `${r.discountValue}%` : ''} −{money(r.discountAmount)}
                    </Badge>
                  )}
                </div>
                {r.workers.length > 0 && (
                  <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1 truncate">
                    <User className="w-3 h-3 shrink-0" />
                    {r.workers.map(id => workers.find(w => w.id === id)?.name).filter(Boolean).join(', ')}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{money(r.total)}</p></div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{money(r.paid)}</p></div>
                  <div className="rounded-xl bg-red-50 p-2 text-center"><p className="text-[9px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{money(r.rest)}</p></div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-100">
                  {r.status === 'pending' && perm.modifier
                    ? (
                      <button onClick={() => setEditing(r)}
                        className="h-9 px-3 rounded-xl font-black text-xs text-white flex items-center gap-1.5 transition-transform active:scale-[0.98]"
                        style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}>
                        <CheckCircle2 className="w-4 h-4" /> Finaliser
                      </button>
                    )
                    : <span />}
                  <RowActions>
                    <ActionBtn icon={Eye} tone="blue" title="Voir" onClick={() => setViewing(r)} />
                    <ActionBtn icon={Printer} tone="slate" title="Imprimer" onClick={() => doPrint(r)} />
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setEditing(r)} />}
                    {r.rest > 0 && perm.modifier && <ActionBtn icon={Wallet} tone="green" title="Payer dette" onClick={() => setPaying(r)} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(r)} />}
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      )}

      {creating && (
        <ReparationForm
          moduleKey={moduleKey}
          kind={creating.kind}
          asPending={creating.pending}
          onClose={() => setCreating(null)}
          onSaved={r => { setCreating(null); if (r.status === 'finalized') setAskPrint(r); }}
        />
      )}
      {editing && (
        <ReparationForm
          moduleKey={moduleKey}
          kind={editing.kind}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={r => { setEditing(null); if (r.status === 'finalized') setAskPrint(r); }}
        />
      )}
      {viewing && <ViewRep rep={viewing} workers={workers} onClose={() => setViewing(null)} onPrint={() => doPrint(viewing)} />}

      <AskPrintModal open={!!askPrint}
        onPrint={() => { if (askPrint) doPrint(askPrint); setAskPrint(null); }}
        onSkip={() => setAskPrint(null)} />

      <PayDebtModal open={!!paying} onClose={() => setPaying(null)} total={paying?.total || 0} alreadyPaid={paying?.paid || 0} onPay={onPay} />
      <Confirm open={!!toDelete} title="Supprimer l'intervention"
        message={`${toDelete?.ref || ''} — ${money(toDelete?.total || 0)}.\n\n`
          + 'Les produits utilisés seront REMIS en stock et l\'intervention ne comptera plus dans les rapports, '
          + 'la dette client ni la paie des employés.\n\n'
          + (deleteImpact || 'Aucun produit à remettre en stock sur cette intervention.')
          + '\n\nCette action est définitive.'}
        onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Header actions ────────────────────────────────────────────────────────────
/**
 * The four ways to open the intervention form, grouped so the choice reads at a
 * glance instead of four look-alike buttons wrapping onto two lines:
 *   • un segment « Nouvelle intervention » — Lavage / Vidange / les deux
 *   • un bouton distinct « En attente » — le véhicule est pris en charge et
 *     l'intervention sera finalisée plus tard.
 */
function NewInterventionActions({
  onPick,
}: { onPick: (v: { kind: BizRepKind; pending: boolean }) => void }) {
  const TYPES: { kind: BizRepKind; label: string; short: string; icon: React.ElementType; cls: string }[] = [
    { kind: 'lavage', label: 'Lavage', short: 'Lavage', icon: Droplets, cls: 'text-cyan-700 hover:bg-cyan-600 hover:text-white' },
    { kind: 'reparation', label: 'Vidange', short: 'Vidange', icon: Wrench, cls: 'text-violet-700 hover:bg-violet-700 hover:text-white' },
    { kind: 'mixte', label: 'Lavage + Vidange', short: 'Les deux', icon: Layers, cls: 'bg-[#003087] text-white hover:bg-[#001f5c]' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-2xl bg-white border border-slate-200 p-1 shadow-sm">
        <span className="hidden md:block pl-2 pr-1 text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
          Nouvelle
        </span>
        {TYPES.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.kind} onClick={() => onPick({ kind: t.kind, pending: false })}
              title={`Nouvelle intervention — ${t.label}`}
              className={`px-3 h-9 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors ${t.cls}`}>
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.short}</span>
            </button>
          );
        })}
      </div>
      <button className="btn-outline !py-2 !h-11" onClick={() => onPick({ kind: 'lavage', pending: true })}
        title="Enregistrer une intervention à finaliser plus tard">
        <Hourglass className="w-4 h-4" /> En attente
      </button>
    </div>
  );
}

// ─── Detail view ───────────────────────────────────────────────────────────────
function ViewRep({ rep, workers, onClose, onPrint }: {
  rep: BizReparation; workers: { id: string; name: string }[]; onClose: () => void; onPrint: () => void;
}) {
  const nameOf = (id: string) => workers.find(w => w.id === id)?.name;
  const workerNames = rep.workers.map(nameOf).filter(Boolean).join(', ');
  const lines = prestationsOf(rep);
  return (
    <Modal open onClose={onClose} icon={KIND_META[rep.kind].icon} size="lg"
      title={`${KIND_META[rep.kind].label} ${rep.ref}`} subtitle={rep.clientName}
      footer={<button className="btn-outline" onClick={onPrint}><Printer className="w-4 h-4" /> Imprimer la facture</button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Client</p><p className="font-bold text-slate-700">{rep.clientName}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Statut</p><p className="font-bold text-slate-700">{STATUS_META[rep.status].label}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Date</p><p className="font-bold text-slate-700">{formatDate(rep.date)}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400">Employé(s)</p><p className="font-bold text-slate-700">{workerNames || '—'}</p></div>
        </div>
        {(rep.car?.marque || rep.car?.name || rep.car?.immatriculation) && (
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Véhicule</p>
            <p className="text-sm font-semibold text-slate-700">{[rep.car.marque, rep.car.name, rep.car.color, rep.car.year, rep.car.immatriculation].filter(Boolean).join(' • ')}</p></div>
        )}
        {rep.problem && <div className="rounded-xl bg-amber-50 p-3"><p className="text-[10px] uppercase font-bold text-amber-500">Problème</p><p className="text-sm text-amber-700">{rep.problem}</p></div>}

        <div>
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Prestations réalisées</p>
          <div className="space-y-1">
            {lines.length === 0
              ? <p className="text-sm text-slate-400 italic">Aucune prestation — produits uniquement.</p>
              : lines.map(l => {
                const Icon = KIND_META[l.kind].icon;
                return (
                  <div key={l.id} className="flex items-start justify-between gap-3 text-sm bg-slate-50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5 text-[#003087]" /> {l.label || KIND_META[l.kind].label}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {KIND_META[l.kind].label}
                        {l.workerIds.length ? ` • ${l.workerIds.map(nameOf).filter(Boolean).join(', ')}` : ' • aucun employé'}
                      </p>
                    </div>
                    <span className="font-bold tabular-nums shrink-0">{money(l.amount)}</span>
                  </div>
                );
              })}
          </div>
        </div>

        {rep.usedProducts.length > 0 && (
          <div><p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Produits utilisés</p>
            <div className="space-y-1">{rep.usedProducts.map((p, i) => (
              <div key={i} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                <span>{p.productName} × {p.detailQty ? `${p.detailQty} ${p.detailUnit || ''}` : p.qty}</span>
                <span className="font-bold tabular-nums">{money(p.total ?? p.qty * p.unitPrice)}</span>
              </div>))}
            </div></div>
        )}

        {!!rep.discountAmount && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
              <span>Sous-total</span><span className="font-bold tabular-nums">{money(rep.subtotal ?? rep.total + rep.discountAmount)}</span>
            </div>
            <div className="flex justify-between text-sm bg-amber-50 rounded-lg px-3 py-2 text-amber-700">
              <span>Remise {rep.discountType === 'percent' ? `(${rep.discountValue}%)` : '(montant fixe)'}</span>
              <span className="font-bold tabular-nums">−{money(rep.discountAmount)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums">{money(rep.total)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Payé</p><p className="font-black text-emerald-600 tabular-nums">{money(rep.paid)}</p></div>
          <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums">{money(rep.rest)}</p></div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Create / edit / finalize ──────────────────────────────────────────────────
/** A prestation being edited: the amount is kept as text so the field can be
 *  emptied while typing without collapsing to 0. */
type LineDraft = BizPrestation & { amountStr: string };

/** A prestation worth saving: it has a price, a designation or an employee. */
const keptLine = (l: LineDraft) =>
  (Number(l.amountStr) || 0) > 0 || !!l.label.trim() || l.workerIds.length > 0;

/**
 * The same form serves creation, edition and finalisation of a pending job, so
 * the three flows can never drift apart.
 *
 * An intervention holds a LIST of prestations: un lavage et une vidange
 * peuvent être facturés en une seule création, chacun avec sa désignation, son
 * montant et ses employés. Une remise (pourcentage ou montant fixe) est ensuite
 * déduite du sous-total.
 */
function ReparationForm({
  moduleKey, kind, initial, asPending, onClose, onSaved,
}: {
  moduleKey: ModuleKey;
  kind: BizRepKind;
  initial?: BizReparation;
  asPending?: boolean;
  onClose: () => void;
  onSaved: (r: BizReparation) => void;
}) {
  const biz = useBiz(moduleKey);
  const { clients, products, workers } = biz.state;
  const isEdit = !!initial;
  const wasPending = initial?.status === 'pending';

  const emptyLine = (k: 'lavage' | 'reparation'): LineDraft =>
    ({ id: newId(), kind: k, label: '', amount: 0, workerIds: [], amountStr: '' });

  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (initial) {
      const existing = prestationsOf(initial).map(l => ({
        ...l, workerIds: [...(l.workerIds || [])], amountStr: l.amount ? String(l.amount) : '',
      }));
      // A products-only job saved before prestations existed still carries its
      // employees — keep them on an empty line rather than dropping them.
      if (!existing.length && (initial.workers || []).length) {
        return [{
          id: newId(), kind: initial.kind === 'lavage' ? 'lavage' : 'reparation',
          label: '', amount: 0, workerIds: [...initial.workers], amountStr: '',
        }];
      }
      return existing;
    }
    return kind === 'mixte'
      ? [emptyLine('lavage'), emptyLine('reparation')]
      : [emptyLine(kind === 'reparation' ? 'reparation' : 'lavage')];
  });

  const [clientId, setClientId] = useState(initial?.clientId || '');
  const [showClient, setShowClient] = useState(false);
  const [car, setCar] = useState<BizCar>(initial?.car || {});
  const [problem, setProblem] = useState(initial?.problem || '');
  const [used, setUsed] = useState<BizLineItem[]>(initial?.usedProducts || []);
  const [paidStr, setPaidStr] = useState<string>(initial ? String(initial.paid) : '');
  const [pQuery, setPQuery] = useState('');
  const [pending, setPending] = useState<boolean>(initial ? initial.status === 'pending' : !!asPending);
  const [discountMode, setDiscountMode] = useState<'none' | BizDiscountType>(
    initial?.discountAmount ? (initial.discountType || 'amount') : 'none');
  const [discountStr, setDiscountStr] = useState<string>(
    initial?.discountValue ? String(initial.discountValue) : '');

  // ── Money ──────────────────────────────────────────────────────────────────
  const serviceTotal = lines.reduce((s, l) => s + (Number(l.amountStr) || 0), 0);
  const productsTotal = used.reduce((s, x) => s + (x.total ?? x.qty * x.unitPrice), 0);
  const subtotal = serviceTotal + productsTotal;
  const discountAmount = discountMode === 'none' ? 0 : discountOf(subtotal, discountMode, Number(discountStr) || 0);
  const total = Math.max(0, subtotal - discountAmount);
  const paid = paidStr === '' ? (pending ? 0 : total) : Number(paidStr);
  const rest = Math.max(0, total - paid);

  const repKind = kindOfPrestations(lines.filter(keptLine), kind);

  // Every employee taking part in the intervention, across all its prestations.
  const allWorkerIds = useMemo(
    () => Array.from(new Set(lines.flatMap(l => l.workerIds))),
    [lines]);

  // ── Prestation helpers ─────────────────────────────────────────────────────
  const addLine = (k: 'lavage' | 'reparation') => setLines(prev => [...prev, emptyLine(k)]);
  const rmLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));
  const patchLine = (id: string, patch: Partial<LineDraft>) =>
    setLines(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const setLineKind = (id: string, k: 'lavage' | 'reparation') =>
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      // Drop employees who do not work on the new kind, so an assignment is never wrong.
      const allowed = new Set(workersForKind(workers, k).map(w => w.id));
      return { ...l, kind: k, workerIds: l.workerIds.filter(w => allowed.has(w)) };
    }));
  const toggleLineWorker = (id: string, workerId: string) =>
    setLines(prev => prev.map(l => l.id === id
      ? { ...l, workerIds: l.workerIds.includes(workerId) ? l.workerIds.filter(w => w !== workerId) : [...l.workerIds, workerId] }
      : l));

  // ── Products — search by name OR barcode ───────────────────────────────────
  // Products out of stock stay searchable: an intervention may consume them and
  // drive the stock negative (rattrapé au prochain achat), like the POS comptoir.
  const productMatches = useMemo(() => {
    if (!pQuery.trim()) return [];
    return products
      .filter(p => matchesSearch(pQuery, p.name, p.barcode))
      .slice(0, 8);
  }, [products, pQuery]);

  const addUsed = (p: BizProduct) => {
    if (used.some(u => u.productId === p.id)) { setPQuery(''); return; }
    if (p.sellByDetail && (p.detailCapacity || 0) > 0) {
      const unitPrice = detailPrice(p);
      setUsed(prev => [...prev, {
        productId: p.id, productName: p.name,
        detailQty: 1, detailUnit: p.detailUnit || 'L',
        qty: 1 / (p.detailCapacity || 1),
        unitPrice, unitCost: p.purchasePrice || 0, total: unitPrice,
      }]);
    } else {
      setUsed(prev => [...prev, { productId: p.id, productName: p.name, qty: 1, unitPrice: p.salePrice, unitCost: p.purchasePrice || 0, total: p.salePrice }]);
    }
    setPQuery('');
  };

  /** Quantity edit — in detail units when the product is sold au détail. */
  const setQty = (productId: string, value: number) => {
    const p = products.find(x => x.id === productId);
    setUsed(prev => prev.map(u => {
      if (u.productId !== productId) return u;
      if (u.detailQty !== undefined && p?.detailCapacity) {
        const detailQty = Math.max(0, value);
        return { ...u, detailQty, qty: detailQty / p.detailCapacity, total: detailQty * u.unitPrice };
      }
      const qty = Math.max(0, value);
      return { ...u, qty, total: qty * u.unitPrice };
    }));
  };
  const rmUsed = (id: string) => setUsed(prev => prev.filter(u => u.productId !== id));

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = () => {
    const cleanLines: BizPrestation[] = lines
      .filter(keptLine)
      .map(l => ({
        id: l.id, kind: l.kind,
        label: l.label.trim() || KIND_META[l.kind].label,
        amount: Number(l.amountStr) || 0,
        workerIds: l.workerIds,
      }));

    if (cleanLines.length === 0 && used.length === 0) {
      toast.error('Ajoutez au moins une prestation ou un produit');
      return;
    }

    const client = clients.find(c => c.id === clientId);
    const status: BizReparation['status'] = pending ? 'pending' : 'finalized';
    const finalKind = kindOfPrestations(cleanLines, kind);
    const prefix = finalKind === 'lavage' ? 'LAV' : finalKind === 'reparation' ? 'REP' : 'INT';
    // Une intervention éditée garde SA date : c'est elle qui date aussi son
    // encaissement d'origine dans le relevé du client.
    const repDate = initial?.date || new Date().toISOString();
    const rep: BizReparation = {
      id: initial?.id || newId(),
      ref: initial?.ref || `${prefix}-${String(biz.state.reparations.length + 1).padStart(4, '0')}`,
      kind: finalKind,
      clientId: clientId || undefined,
      clientName: client?.name || PASSAGE,
      car,
      serviceTotal: cleanLines.reduce((s, l) => s + l.amount, 0),
      prestations: cleanLines,
      usedProducts: used,
      problem,
      subtotal,
      discountType: discountMode === 'none' ? undefined : discountMode,
      discountValue: discountMode === 'none' ? undefined : Number(discountStr) || 0,
      discountAmount,
      total, paid, rest, status,
      date: repDate,
      payments: seedPayments(initial?.payments, paid, repDate, initial?.createdBy),
      outDate: initial?.outDate,
      workers: Array.from(new Set(cleanLines.flatMap(l => l.workerIds))),
      createdBy: initial?.createdBy || 'Admin',
      printedAt: initial?.printedAt,
      payrollSettled: initial?.payrollSettled,
    };

    if (isEdit) biz.update('reparations', rep); else biz.add('reparations', rep);

    /**
     * ─── LE KILOMÉTRAGE REMONTE SUR LA FICHE DU CLIENT ──────────────────────
     * Le relevé n'a de valeur que suivi dans le temps : il est saisi ici, au
     * moment où l'on a le compteur sous les yeux, et c'est la fiche du client
     * qui le conserve. On n'écrit que si le chiffre a réellement changé — une
     * intervention rouverte pour corriger un montant ne doit pas réécrire le
     * parc du client pour rien.
     *
     * Un relevé PLUS PETIT que celui déjà enregistré est tout de même accepté :
     * une faute de frappe se corrige, et un compteur remplacé repart de zéro.
     */
    if (client && car.id && typeof car.kilometrage === 'number') {
      const parc = client.cars || [];
      const known = parc.find(c => c.id === car.id);
      if (known && known.kilometrage !== car.kilometrage) {
        biz.update('clients', {
          ...client,
          cars: parc.map(c => (c.id === car.id
            ? { ...c, kilometrage: car.kilometrage, kilometrageAt: repDate.slice(0, 10) }
            : c)),
        });
      }
    }

    // Stock is deducted only when the job is actually done, and only once:
    // a pending job that gets finalized deducts at that moment.
    const shouldDeduct = status === 'finalized' && (!isEdit || wasPending);
    if (shouldDeduct) {
      used.forEach(u => {
        const p = products.find(x => x.id === u.productId);
        // Oversell allowed: the stock may go negative and is recovered on the
        // next purchase (e.g. −5 en stock + 15 reçus = 10), as in the POS.
        if (p) biz.update('products', { ...p, currentQty: p.currentQty - u.qty });
      });
    }

    toast.success(status === 'pending'
      ? 'Intervention enregistrée en attente'
      : (isEdit && wasPending ? 'Intervention finalisée' : (isEdit ? 'Intervention modifiée' : 'Intervention enregistrée')));
    onSaved(rep);
  };

  const title = isEdit
    ? (wasPending ? `Finaliser ${initial!.ref}` : `Modifier ${initial!.ref}`)
    : (pending ? 'Nouvelle intervention en attente' : `Nouvelle intervention — ${KIND_META[repKind].label}`);

  return (
    <>
      <Modal open onClose={onClose} icon={KIND_META[repKind].icon} size="xl" title={title}
        subtitle="Plusieurs prestations par intervention • remise • produits du stock"
        footer={<>
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          {pending && (
            <button className="btn-secondary" onClick={() => { setPending(false); }}>
              <CheckCircle2 className="w-4 h-4" /> Passer en finalisé
            </button>
          )}
          <button className="btn-primary" onClick={save}>
            {pending ? 'Enregistrer en attente' : (isEdit && wasPending ? 'Finaliser' : 'Enregistrer')}
          </button>
        </>}>
        <div className="space-y-5">
          {/* Status + resulting kind */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Statut">
              <div className="flex gap-2">
                <button onClick={() => setPending(true)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${pending ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <Hourglass className="w-4 h-4" /> En attente
                </button>
                <button onClick={() => setPending(false)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${!pending ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <CheckCircle2 className="w-4 h-4" /> Finalisé
                </button>
              </div>
            </Field>
            <Field label="Type d'intervention" hint="Déduit automatiquement des prestations ajoutées.">
              <div className="h-[46px] rounded-xl bg-slate-100 flex items-center gap-2 px-4 font-bold text-sm text-[#002d87]">
                {React.createElement(KIND_META[repKind].icon, { className: 'w-4 h-4' })}
                {KIND_META[repKind].label}
                <span className="ml-auto text-[11px] font-semibold text-slate-400">
                  {lines.length} prestation{lines.length > 1 ? 's' : ''}
                </span>
              </div>
            </Field>
          </div>

          {/* ── Prestations ─────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div>
                <h4 className="text-[11px] font-black uppercase tracking-widest text-[#002d87] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> Prestations
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Ajoutez un lavage et/ou une vidange — chacun avec son montant et ses employés.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="btn-outline !py-1.5 !px-3 text-xs" onClick={() => addLine('lavage')}>
                  <Droplets className="w-3.5 h-3.5" /> + Lavage
                </button>
                <button className="btn-outline !py-1.5 !px-3 text-xs" onClick={() => addLine('reparation')}>
                  <Wrench className="w-3.5 h-3.5" /> + Vidange
                </button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {lines.length === 0 && (
                <p className="text-sm text-slate-400 italic text-center py-3">
                  Aucune prestation — l'intervention ne facturera que les produits utilisés.
                </p>
              )}
              {lines.map((l, i) => {
                const pool = workersForKind(workers, l.kind);
                return (
                  <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-[#001f5c] text-[#FFB800] flex items-center justify-center text-[11px] font-black shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex gap-1.5">
                        {(['lavage', 'reparation'] as const).map(k => {
                          const Icon = KIND_META[k].icon;
                          return (
                            <button key={k} onClick={() => setLineKind(l.id, k)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${l.kind === k ? 'bg-[#003087] text-white' : 'bg-slate-100 text-slate-500'}`}>
                              <Icon className="w-3.5 h-3.5" /> {KIND_META[k].label}
                            </button>
                          );
                        })}
                      </div>
                      <span className="ml-auto text-xs font-black tabular-nums text-[#002d87]">
                        {money(Number(l.amountStr) || 0)}
                      </span>
                      <button onClick={() => rmLine(l.id)} title="Retirer la prestation"
                        className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-2">
                        <Input placeholder={l.kind === 'lavage' ? 'Ex: Lavage complet intérieur/extérieur' : 'Ex: Vidange moteur + filtre à huile'}
                          value={l.label} onChange={e => patchLine(l.id, { label: e.target.value })} />
                      </div>
                      <Input type="number" placeholder="Montant (DA)" value={l.amountStr}
                        onChange={e => patchLine(l.id, { amountStr: e.target.value, amount: Number(e.target.value) || 0 })} />
                    </div>

                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 mb-1.5">
                        Employé(s) de cette prestation
                      </p>
                      {pool.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">
                          Aucun employé « {l.kind === 'lavage' ? 'lavage' : 'vidange'} » enregistré.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {pool.map(w => {
                            const on = l.workerIds.includes(w.id);
                            return (
                              <button key={w.id} onClick={() => toggleLineWorker(l.id, w.id)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${on ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                {on && <CheckCircle2 className="w-3 h-3" />} {w.name}
                                {w.salaryType === 'pourcentage' && <span className="opacity-70">· {w.percentage || 0}%</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {allWorkerIds.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  <b>{allWorkerIds.length}</b> employé(s) sur cette intervention :{' '}
                  {allWorkerIds.map(id => workers.find(w => w.id === id)?.name).filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          </div>

          {/* Used products — search by name or barcode */}
          <div>
            <label className="label-field">Produits utilisés (déduits du stock)</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={pQuery} onChange={e => setPQuery(e.target.value)}
                placeholder="Rechercher par nom ou code-barres…" className="input-field pl-9" />
              {productMatches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                  {productMatches.map(p => (
                    <button key={p.id} onClick={() => addUsed(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                      <span className="text-sm font-semibold">
                        {p.name}
                        {p.sellByDetail && <span className="ml-1.5 text-[10px] font-bold text-[#003087]">au détail</span>}
                      </span>
                      <span className="text-xs text-slate-400">
                        {p.sellByDetail && p.detailCapacity
                          ? `${money(detailPrice(p))}/${p.detailUnit} • stock ${p.currentQty} × ${p.detailCapacity}${p.detailUnit}`
                          : `${money(p.salePrice)} • stock ${p.currentQty}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {used.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {used.map(u => {
                  const p = products.find(x => x.id === u.productId);
                  const isDetail = u.detailQty !== undefined;
                  return (
                    <div key={u.productId} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
                      <span className="flex-1 text-sm font-semibold text-slate-700 min-w-0 truncate">
                        {u.productName}
                        {isDetail && p?.detailCapacity && (
                          <span className="ml-1 text-[10px] text-slate-400">sur {p.detailCapacity} {u.detailUnit}</span>
                        )}
                      </span>
                      <input type="number" step="0.01" min={0}
                        value={isDetail ? u.detailQty : u.qty}
                        onChange={e => setQty(u.productId, Number(e.target.value))}
                        className="input-field !py-1 !px-2 w-20 text-center" />
                      <span className="text-[11px] text-slate-400 w-8">{isDetail ? u.detailUnit : (p?.unit || 'u')}</span>
                      <span className="text-sm font-bold tabular-nums w-24 text-right">{money(u.total ?? u.qty * u.unitPrice)}</span>
                      <button onClick={() => rmUsed(u.productId)} className="text-red-500 p-1"><X className="w-4 h-4" /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Le client, puis SA voiture ─────────────────────────────────
              Recherche par nom ou téléphone, parc du client proposé, et le
              kilométrage relevé sur place. La saisie libre reste disponible :
              un client de passage n'a pas de fiche.

              Il vient APRÈS le travail : on saisit d'abord ce qui a été fait
              et ce qui a été consommé — c'est l'ordre du garage, et c'est
              seulement une fois le total connu qu'on cherche à qui le
              facturer. Le demander en premier obligeait à interrompre la
              saisie pour aller chercher une fiche client. */}
          <ClientCarPicker
            clients={clients}
            clientId={clientId}
            onClientId={setClientId}
            car={car}
            onCar={setCar}
            onCreateClient={() => setShowClient(true)}
            passageLabel={PASSAGE} />

          <Field label="Description du problème / observations">
            <Textarea value={problem} onChange={e => setProblem(e.target.value)} placeholder="Décrivez le travail à réaliser…" />
          </Field>

          {/* ── Remise ──────────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-amber-600" />
              <h4 className="text-[11px] font-black uppercase tracking-widest text-amber-700">Remise client</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Type de remise">
                <div className="flex gap-1.5">
                  {([['none', 'Aucune'], ['percent', '%'], ['amount', 'DA']] as const).map(([m, lbl]) => (
                    <button key={m} onClick={() => setDiscountMode(m)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold ${discountMode === m ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={discountMode === 'percent' ? 'Pourcentage (%)' : 'Montant remisé (DA)'}
                hint={discountMode === 'percent' ? 'Appliqué sur le sous-total.' : undefined}>
                <div className="relative">
                  <Input type="number" min={0} value={discountStr} disabled={discountMode === 'none'}
                    onChange={e => setDiscountStr(e.target.value)} placeholder="0"
                    className={discountMode === 'none' ? 'opacity-50' : ''} />
                  {discountMode === 'percent' && <Percent className="w-4 h-4 text-slate-300 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />}
                </div>
              </Field>
              <Field label="Remise déduite">
                <div className="h-[46px] rounded-xl bg-white border border-amber-200 flex items-center px-4 font-black tabular-nums text-amber-700">
                  −{money(discountAmount)}
                </div>
              </Field>
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-2xl bg-[#001f5c] text-white p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-[10px] uppercase font-bold text-blue-200">Prestations</p>
                <p className="font-black tabular-nums">{money(serviceTotal)}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-[10px] uppercase font-bold text-blue-200">Produits</p>
                <p className="font-black tabular-nums">{money(productsTotal)}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-[10px] uppercase font-bold text-blue-200">Sous-total</p>
                <p className="font-black tabular-nums">{money(subtotal)}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-[10px] uppercase font-bold text-blue-200">Remise</p>
                <p className="font-black tabular-nums text-amber-300">−{money(discountAmount)}</p>
              </div>
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-blue-200">Total à payer</span>
              <span className="text-xl font-black tabular-nums text-[#FFB800]">{money(total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-blue-200">Payé</label>
                <input type="number" value={paidStr} onChange={e => setPaidStr(e.target.value)} placeholder={String(pending ? 0 : total)} className="input-field mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-blue-200">Reste</label>
                <div className="mt-1 h-[46px] rounded-xl bg-white/10 flex items-center px-4 font-black tabular-nums text-red-300">{money(rest)}</div>
              </div>
            </div>
          </div>
        </div>
      </Modal>
      {/* Un client créé depuis la fiche arrive parfois avec son parc : s'il n'a
          qu'une voiture, elle est reprise d'office — sinon le choix reste à
          faire dans la liste ci-dessus. */}
      <ContactModal biz={biz} coll="clients" open={showClient} onClose={() => setShowClient(false)}
        onSaved={c => { setClientId(c.id); if ((c.cars || []).length === 1) setCar({ ...c.cars![0] }); }} />
    </>
  );
}
