/**
 * ─── On-screen report view (shared) ────────────────────────────────────────────
 * Renders a fully-detailed, drill-down report for a single "part" (a biz module
 * or the carburant activity) from a `PartReport`. Used by both `ModuleReports`
 * and `GeneralReports` so the two pages stay perfectly consistent.
 *
 * Every KPI card is clickable and opens a focused modal with the underlying
 * rows; the same row tables are also shown inline below so nothing is hidden.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import {
  TrendingUp, ShoppingCart, CreditCard, CircleDollarSign, Wallet, Boxes, Users, Truck,
  AlertTriangle, CalendarClock, Banknote, PackageX, Beaker, ChevronDown, ChevronRight, Layers,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Modal, money, formatDate, Table, Badge } from '@/src/components/biz/Kit';
import { PartReport } from '@/src/lib/bizReporting';

const fmtDate = (s: string) => (s ? formatDate(s) : '—');

// ─── Clickable KPI card ──────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, sub, tone = 'blue', onClick, count }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate' | 'cyan'; onClick?: () => void; count?: number; key?: React.Key;
}) {
  const tones: Record<string, string> = {
    blue: 'from-[#003087] to-[#0044bb]', green: 'from-emerald-500 to-emerald-600', amber: 'from-amber-500 to-yellow-500',
    red: 'from-red-500 to-red-600', purple: 'from-purple-500 to-purple-600', slate: 'from-slate-500 to-slate-600', cyan: 'from-cyan-500 to-teal-600',
  };
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cn('text-left rounded-2xl border border-slate-100 p-4 bg-white shadow-sm transition-all group relative overflow-hidden',
        onClick && 'hover:shadow-lg hover:-translate-y-0.5 hover:border-slate-200 cursor-pointer')}>
      <div className="flex items-center justify-between mb-2">
        <div className={cn('w-9 h-9 rounded-xl bg-gradient-to-br text-white flex items-center justify-center', tones[tone])}>
          <Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
        </div>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{count}</span>
        )}
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-black text-[#002d87] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{sub}</p>}
      {onClick && <span className="absolute bottom-2 right-3 text-[10px] font-bold text-slate-300 group-hover:text-[#003087] transition-colors">Détails →</span>}
    </button>
  );
}

// ─── Reusable row tables (used inline + inside modals) ───────────────────────
export function SalesTable({ rows }: { rows: PartReport['sales'] }) {
  if (!rows.length) return <Empty />;
  return (
    <Table head={<><th className="table-head">Réf</th><th className="table-head">Type</th><th className="table-head">Client</th><th className="table-head">Date</th><th className="table-head text-right">Total</th><th className="table-head text-right">Payé</th><th className="table-head text-right">Reste</th></>}>
      {rows.map(s => (
        <tr key={s.id}>
          <td className="table-cell font-bold">{s.ref}</td>
          <td className="table-cell"><span className="badge badge-info">{s.kind}</span></td>
          <td className="table-cell">{s.client}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(s.date)}</td>
          <td className="table-cell tabular-nums text-right font-bold">{money(s.total)}</td>
          <td className="table-cell tabular-nums text-right text-emerald-600">{money(s.paid)}</td>
          <td className={cn('table-cell tabular-nums text-right', s.rest > 0 ? 'text-red-600 font-bold' : 'text-slate-400')}>{money(s.rest)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function PurchasesTable({ rows }: { rows: PartReport['purchases'] }) {
  if (!rows.length) return <Empty />;
  return (
    <Table head={<><th className="table-head">Réf</th><th className="table-head">Fournisseur</th><th className="table-head">Date</th><th className="table-head text-right">Total</th><th className="table-head text-right">Payé</th><th className="table-head text-right">Reste</th></>}>
      {rows.map(p => (
        <tr key={p.id}>
          <td className="table-cell font-bold">{p.ref}</td>
          <td className="table-cell">{p.supplier}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(p.date)}</td>
          <td className="table-cell tabular-nums text-right font-bold">{money(p.total)}</td>
          <td className="table-cell tabular-nums text-right text-emerald-600">{money(p.paid)}</td>
          <td className={cn('table-cell tabular-nums text-right', p.rest > 0 ? 'text-red-600 font-bold' : 'text-slate-400')}>{money(p.rest)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function ProductGainTable({ rows }: { rows: PartReport['salesByProduct'] }) {
  if (!rows.length) return <Empty />;
  const t = rows.reduce((a, x) => ({ revenue: a.revenue + x.revenue, cost: a.cost + x.cost, gain: a.gain + x.gain }), { revenue: 0, cost: 0, gain: 0 });
  return (
    <Table head={<><th className="table-head">Produit</th><th className="table-head text-right">Quantité</th><th className="table-head text-right">Coût</th><th className="table-head text-right">Vente</th><th className="table-head text-right">Gains</th></>}>
      {rows.map(p => (
        <tr key={p.name}>
          <td className="table-cell font-bold">{p.name}</td>
          <td className="table-cell tabular-nums text-right">{p.qty.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}{p.unit ? ` ${p.unit}` : ''}</td>
          <td className="table-cell tabular-nums text-right text-amber-700">{money(p.cost)}</td>
          <td className="table-cell tabular-nums text-right text-blue-700">{money(p.revenue)}</td>
          <td className={cn('table-cell tabular-nums text-right font-bold', p.gain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.gain)}</td>
        </tr>
      ))}
      <tr className="bg-blue-50/60">
        <td className="table-cell font-black text-[#002d87]">TOTAL</td>
        <td className="table-cell" />
        <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(t.cost)}</td>
        <td className="table-cell tabular-nums text-right font-black text-blue-700">{money(t.revenue)}</td>
        <td className={cn('table-cell tabular-nums text-right font-black', t.gain >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(t.gain)}</td>
      </tr>
    </Table>
  );
}

export function DebtTable({ rows, tone }: { rows: PartReport['clientDebts']; tone: 'client' | 'supplier' }) {
  if (!rows.length) return <Empty text="Aucune dette" />;
  return (
    <Table head={<><th className="table-head">Réf</th><th className="table-head">{tone === 'client' ? 'Client' : 'Fournisseur'}</th><th className="table-head">Date</th><th className="table-head text-right">Total</th><th className="table-head text-right">Reste dû</th></>}>
      {rows.map(d => (
        <tr key={d.id}>
          <td className="table-cell font-bold">{d.ref}</td>
          <td className="table-cell">{d.name}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(d.date)}</td>
          <td className="table-cell tabular-nums text-right">{money(d.total)}</td>
          <td className={cn('table-cell tabular-nums text-right font-bold', tone === 'client' ? 'text-red-600' : 'text-amber-600')}>{money(d.rest)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function ExpenseTable({ rows }: { rows: PartReport['expenses'] }) {
  if (!rows.length) return <Empty />;
  const toneOf = (k: string) => k === 'Salaire' ? 'badge-info' : k === 'Acompte' ? 'badge-warning' : k === 'Absence' ? 'badge-danger' : 'badge-neutral';
  return (
    <Table head={<><th className="table-head">Type</th><th className="table-head">Nom / Description</th><th className="table-head">Date</th><th className="table-head text-right">Montant</th></>}>
      {rows.map(e => (
        <tr key={e.id}>
          <td className="table-cell"><span className={cn('badge', toneOf(e.kind))}>{e.kind}</span></td>
          <td className="table-cell"><span className="font-bold">{e.label}</span>{e.description ? <span className="text-slate-400"> — {e.description}</span> : null}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(e.date)}</td>
          <td className="table-cell tabular-nums text-right font-bold text-red-600">{money(e.amount)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function StockAlertTable({ rows }: { rows: PartReport['stockAlerts'] }) {
  if (!rows.length) return <Empty text="Aucune alerte de stock ✅" />;
  return (
    <Table head={<><th className="table-head">Produit</th><th className="table-head">Catégorie</th><th className="table-head text-right">Stock</th><th className="table-head text-right">Seuil</th><th className="table-head text-right">Manque</th><th className="table-head text-right">Valeur</th></>}>
      {rows.map(a => (
        <tr key={a.id}>
          <td className="table-cell font-bold">{a.name}</td>
          <td className="table-cell text-slate-400">{a.category || '—'}</td>
          <td className={cn('table-cell tabular-nums text-right font-bold', a.currentQty <= 0 ? 'text-red-600' : 'text-amber-600')}>{a.currentQty}{a.unit ? ` ${a.unit}` : ''}</td>
          <td className="table-cell tabular-nums text-right text-slate-500">{a.minQty}</td>
          <td className="table-cell tabular-nums text-right font-bold text-red-600">-{a.deficit}</td>
          <td className="table-cell tabular-nums text-right">{money(a.value)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function ExpiryTable({ rows }: { rows: PartReport['expiryAlerts'] }) {
  if (!rows.length) return <Empty text="Aucune expiration proche ✅" />;
  return (
    <Table head={<><th className="table-head">Produit</th><th className="table-head">Expiration</th><th className="table-head text-right">Jours restants</th><th className="table-head text-right">Quantité</th><th className="table-head text-right">Valeur</th></>}>
      {rows.map(a => (
        <tr key={a.id}>
          <td className="table-cell font-bold">{a.name}</td>
          <td className="table-cell whitespace-nowrap">{fmtDate(a.expirationDate)}</td>
          <td className="table-cell text-right">
            <span className={cn('badge', a.status === 'expired' ? 'badge-danger' : 'badge-warning')}>
              {a.status === 'expired' ? `Expiré (${Math.abs(a.daysLeft)}j)` : `${a.daysLeft}j`}
            </span>
          </td>
          <td className="table-cell tabular-nums text-right">{a.currentQty}{a.unit ? ` ${a.unit}` : ''}</td>
          <td className="table-cell tabular-nums text-right">{money(a.value)}</td>
        </tr>
      ))}
    </Table>
  );
}

function WorkerTable({ rows }: { rows: PartReport['workers'] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <Empty text="Aucun employé" />;
  return (
    <div className="card-glass overflow-hidden">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="table-head w-8" /><th className="table-head">Employé</th><th className="table-head">Rôle</th>
            <th className="table-head text-right">Salaire</th><th className="table-head text-right">Acomptes</th>
            <th className="table-head text-right">Absences</th><th className="table-head text-right">Payé</th><th className="table-head text-right">Net à payer</th>
          </tr></thead>
          <tbody>
            {rows.map(w => {
              const isOpen = open === w.id;
              const hasDetail = w.acomptes.length > 0 || w.absences.length > 0 || w.payments.length > 0;
              return (
                <React.Fragment key={w.id}>
                  <tr className={cn(hasDetail && 'cursor-pointer hover:bg-slate-50')} onClick={() => hasDetail && setOpen(isOpen ? null : w.id)}>
                    <td className="table-cell text-slate-400">{hasDetail ? (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}</td>
                    <td className="table-cell font-bold">{w.name}</td>
                    <td className="table-cell text-slate-500">{w.role}</td>
                    <td className="table-cell tabular-nums text-right">{money(w.salaryAmount)}<span className="text-slate-400 text-xs">/{w.salaryType}</span></td>
                    <td className="table-cell tabular-nums text-right text-amber-700">{money(w.acomptesTotal)}</td>
                    <td className="table-cell tabular-nums text-right text-red-600">{w.absencesCount ? money(w.absencesTotal) : '—'}</td>
                    <td className="table-cell tabular-nums text-right text-emerald-600">{money(w.paymentsTotal)}</td>
                    <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(w.net)}</td>
                  </tr>
                  {isOpen && hasDetail && (
                    <tr><td colSpan={8} className="bg-slate-50/70 px-6 py-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <MiniList title="Acomptes" empty="Aucun acompte" tone="amber" items={w.acomptes.map(a => ({ left: fmtDate(a.date), mid: a.description || 'Acompte', right: money(a.amount), flag: a.paid ? 'Payé' : 'Dû' }))} />
                        <MiniList title="Absences" empty="Aucune absence" tone="red" items={w.absences.map(a => ({ left: fmtDate(a.date), mid: a.description || 'Absence', right: money(a.cost), flag: a.paid ? 'Retenu' : '—' }))} />
                        <MiniList title="Paiements" empty="Aucun paiement" tone="green" items={w.payments.map(p => ({ left: fmtDate(p.date), mid: p.period, right: money(p.amount), flag: '' }))} />
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiniList({ title, items, empty, tone }: { title: string; empty: string; tone: 'amber' | 'red' | 'green'; items: { left: string; mid: string; right: string; flag: string }[] }) {
  const toneCls = { amber: 'text-amber-700', red: 'text-red-600', green: 'text-emerald-600' }[tone];
  return (
    <div className="rounded-xl bg-white border border-slate-100 p-3">
      <p className={cn('text-[11px] font-black uppercase tracking-wide mb-2', toneCls)}>{title}</p>
      {items.length === 0 ? <p className="text-xs text-slate-400 italic">{empty}</p> : (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center justify-between text-xs gap-2">
              <span className="text-slate-400 shrink-0">{it.left}</span>
              <span className="text-slate-600 truncate flex-1">{it.mid}</span>
              <span className={cn('font-bold tabular-nums shrink-0', toneCls)}>{it.right}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DestructionTable({ rows }: { rows: PartReport['destructions'] }) {
  if (!rows.length) return <Empty text="Aucune destruction" />;
  const total = rows.reduce((s, d) => s + d.value, 0);
  return (
    <>
      <Table head={<>
        <th className="table-head">Produit</th><th className="table-head">Provenance</th>
        <th className="table-head text-right">Quantité</th><th className="table-head text-right">Coût unitaire</th>
        <th className="table-head">Motif</th><th className="table-head">Agent</th>
        <th className="table-head">Date</th><th className="table-head text-right">Coût</th>
      </>}>
        {rows.map(d => (
          <tr key={d.id}>
            <td className="table-cell">
              <div className="font-bold">{d.name}</div>
              {d.category && <div className="text-[11px] text-slate-400">{d.category}</div>}
              {d.notes && <div className="text-[11px] text-slate-400 italic">{d.notes}</div>}
            </td>
            <td className="table-cell">
              <Badge tone={d.source === 'stock' ? 'primary' : 'neutral'}>
                {d.source === 'stock' ? 'Gestion de stock' : 'Comptoir'}
              </Badge>
            </td>
            <td className="table-cell tabular-nums text-right">{d.qty} <span className="text-xs text-slate-400">{d.unit}</span></td>
            <td className="table-cell tabular-nums text-right text-slate-500">{money(d.unitPrice)}</td>
            <td className="table-cell text-slate-500">{d.reason || '—'}</td>
            <td className="table-cell text-slate-500">{d.createdBy || '—'}</td>
            <td className="table-cell whitespace-nowrap">{fmtDate(d.date)}</td>
            <td className="table-cell tabular-nums text-right font-bold text-red-600">{money(d.value)}</td>
          </tr>
        ))}
      </Table>
      <div className="card-glass px-5 py-3 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {rows.length} destruction(s) — coût déduit du bénéfice net de la période.
        </span>
        <span className="font-black tabular-nums text-red-600">−{money(total)}</span>
      </div>
    </>
  );
}

function Empty({ text = 'Aucune donnée sur la période' }: { text?: string }) {
  return <div className="card-glass p-6 text-center text-slate-400 text-sm">{text}</div>;
}

// ─── Section wrapper ─────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, right }: { title: string; icon: React.ElementType; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-[#002d87] flex items-center gap-2"><Icon className="w-5 h-5 text-[#FFB800]" /> {title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

// ─── Detail modal ────────────────────────────────────────────────────────────
type DetailKey = 'sales' | 'purchases' | 'gains' | 'expenses' | 'clientDebts' | 'supplierDebts' | 'stock' | 'expiry' | 'workers' | 'destructions' | null;

// ─── Main view ───────────────────────────────────────────────────────────────
export default function ReportView({ report: r }: { report: PartReport }) {
  const [detail, setDetail] = useState<DetailKey>(null);

  const financial: [string, number, ('good' | 'bad' | 'neutral')?][] = [
    ["Chiffre d'affaires", r.salesTotal, 'good'], ['Ventes encaissées', r.salesPaid], ['Coût marchandises', r.cogs],
    ['Marge brute', r.grossMargin, r.grossMargin >= 0 ? 'good' : 'bad'], ['Total achats', r.purchasesTotal], ['Achats payés', r.purchasesPaid],
    ['Dépenses', r.expensesTotal, 'bad'], ['Salaires versés', r.salariesPaid], ['Acomptes période', r.acomptesPeriod],
    ['Valeur production', r.productionValue], ['Pertes production', r.lossValue, r.lossValue > 0 ? 'bad' : undefined], ['Destructions', r.destroyedValue, r.destroyedValue > 0 ? 'bad' : undefined],
    ['Dettes clients', r.clientDebtTotal, r.clientDebtTotal > 0 ? 'bad' : undefined], ['Dettes fournisseurs', r.supplierDebtTotal, r.supplierDebtTotal > 0 ? 'bad' : undefined],
    ['Solde de caisse', r.caisseBalance], ['Valeur du stock', r.stockValue],
  ];

  const modalTitle: Record<Exclude<DetailKey, null>, string> = {
    sales: 'Détail des ventes', purchases: 'Détail des achats', gains: 'Gains par produit', expenses: 'Dépenses, salaires & acomptes',
    clientDebts: 'Dettes des clients', supplierDebts: 'Dettes envers les fournisseurs', stock: 'Alertes de stock',
    expiry: 'Alertes d\'expiration', workers: 'Comptes des employés', destructions: 'Produits détruits',
  };

  return (
    <div className="space-y-8">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={TrendingUp} tone="green" label="Ventes (CA)" value={money(r.salesTotal)} sub={`${r.counts.sales} opérations`} onClick={() => setDetail('sales')} />
        <MetricCard icon={ShoppingCart} tone="purple" label="Achats" value={money(r.purchasesTotal)} sub={`${r.counts.purchases} factures`} onClick={() => setDetail('purchases')} />
        <MetricCard icon={Layers} tone="cyan" label="Marge brute" value={money(r.grossMargin)} sub="CA − coût marchandises" onClick={() => setDetail('gains')} />
        <MetricCard icon={CircleDollarSign} tone={r.netGain >= 0 ? 'green' : 'red'} label="Bénéfice net" value={money(r.netGain)} sub="résultat période" />
        <MetricCard icon={CreditCard} tone="red" label="Dépenses" value={money(r.expensesTotal)} sub={`${r.expenses.length} lignes`} onClick={() => setDetail('expenses')} />
        <MetricCard icon={Wallet} tone="blue" label="Solde caisse" value={money(r.caisseBalance)} />
        <MetricCard icon={Boxes} tone="amber" label="Valeur stock" value={money(r.stockValue)} sub={`${r.counts.products} produits`} />
        <MetricCard icon={Users} tone="slate" label="Employés" value={String(r.counts.workers)} sub="voir comptes" onClick={() => r.workers.length ? setDetail('workers') : undefined} />
      </div>

      {/* Debt + alert cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={Users} tone="red" label="Dettes clients" value={money(r.clientDebtTotal)} count={r.clientDebts.length} onClick={() => setDetail('clientDebts')} />
        <MetricCard icon={Truck} tone="amber" label="Dettes fournisseurs" value={money(r.supplierDebtTotal)} count={r.supplierDebts.length} onClick={() => setDetail('supplierDebts')} />
        <MetricCard icon={AlertTriangle} tone="red" label="Alertes stock" value={String(r.stockAlerts.length)} sub="produits sous seuil" count={r.stockAlerts.length} onClick={() => setDetail('stock')} />
        <MetricCard icon={CalendarClock} tone="purple" label="Expirations proches" value={String(r.expiryAlerts.length)} sub="≤ 15 jours" count={r.expiryAlerts.length} onClick={() => setDetail('expiry')} />
      </div>

      {/* Financial synthesis */}
      <Section title="Synthèse financière" icon={Wallet}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {financial.map(([k, v, flag]) => (
            <div key={k} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">{k}</p>
              <p className={cn('font-black tabular-nums text-sm', flag === 'good' ? 'text-emerald-600' : flag === 'bad' ? 'text-red-600' : 'text-slate-700')}>{money(v)}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Sales by product */}
      <Section title="Ventes par produit" icon={TrendingUp}><ProductGainTable rows={r.salesByProduct} /></Section>

      {/* Sales invoices */}
      <Section title="Factures & prestations de vente" icon={CreditCard}><SalesTable rows={r.sales} /></Section>

      {/* Purchases */}
      <Section title="Achats fournisseurs" icon={ShoppingCart}><PurchasesTable rows={r.purchases} /></Section>

      {/* Expenses */}
      <Section title="Dépenses, salaires & acomptes" icon={Banknote}>
        <ExpenseTable rows={r.expenses} />
        {r.expensesByCategory.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            {r.expensesByCategory.map(c => (
              <div key={c.category} className="rounded-xl border border-slate-100 p-3">
                <p className="text-[10px] uppercase font-bold text-slate-400">{c.category}</p>
                <p className="font-black tabular-nums text-red-600 text-sm">{money(c.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Debts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Dettes clients" icon={Users}><DebtTable rows={r.clientDebts} tone="client" /></Section>
        <Section title="Dettes fournisseurs" icon={Truck}><DebtTable rows={r.supplierDebts} tone="supplier" /></Section>
      </div>

      {/* Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Alertes de stock" icon={AlertTriangle}><StockAlertTable rows={r.stockAlerts} /></Section>
        <Section title="Alertes d'expiration" icon={CalendarClock}><ExpiryTable rows={r.expiryAlerts} /></Section>
      </div>

      {/* Workers */}
      {r.workers.length > 0 && (
        <Section title="Comptes des employés" icon={Users} right={<span className="text-[11px] text-slate-400 font-medium">Cliquez une ligne pour les acomptes, absences & paiements</span>}>
          <WorkerTable rows={r.workers} />
        </Section>
      )}

      {/* Productions / Destructions */}
      {(r.productions.length > 0 || r.destructions.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {r.productions.length > 0 && (
            <Section title="Productions" icon={Beaker}>
              <Table head={<><th className="table-head">Production</th><th className="table-head text-right">Qté</th><th className="table-head text-right">Valeur</th><th className="table-head text-right">Pertes</th></>}>
                {r.productions.map(p => (
                  <tr key={p.id}>
                    <td className="table-cell font-bold">{p.name}</td>
                    <td className="table-cell tabular-nums text-right">{p.outputQuantity}{p.unit ? ` ${p.unit}` : ''}</td>
                    <td className="table-cell tabular-nums text-right">{money(p.totalValue)}</td>
                    <td className={cn('table-cell tabular-nums text-right', p.lossValue > 0 ? 'text-red-600 font-bold' : 'text-slate-400')}>{p.lossValue > 0 ? money(p.lossValue) : '—'}</td>
                  </tr>
                ))}
              </Table>
            </Section>
          )}
          {r.destructions.length > 0 && (
            <Section title="Produits détruits" icon={PackageX}><DestructionTable rows={r.destructions} /></Section>
          )}
        </div>
      )}

      {/* Net gain banner */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-6 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ background: r.netGain >= 0 ? 'linear-gradient(135deg,#065f46,#047857)' : 'linear-gradient(135deg,#991b1b,#dc2626)' }}>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide opacity-90">Bénéfice net de la période</p>
          <p className="text-xs opacity-75 mt-1">Marge brute − Dépenses − Salaires − Destructions − Pertes</p>
        </div>
        <p className="text-4xl font-black tabular-nums">{money(r.netGain)}</p>
      </motion.div>

      {/* Drill-down modal */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} size="2xl"
        title={detail ? modalTitle[detail] : ''} subtitle={`${r.label} — ${fmtDate(r.from)} → ${fmtDate(r.to)}`}>
        <AnimatePresence mode="wait">
          <motion.div key={detail || 'x'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-h-[65vh] overflow-y-auto custom-scrollbar -mx-2 px-2">
            {detail === 'sales' && <SalesTable rows={r.sales} />}
            {detail === 'purchases' && <PurchasesTable rows={r.purchases} />}
            {detail === 'gains' && <ProductGainTable rows={r.salesByProduct} />}
            {detail === 'expenses' && <ExpenseTable rows={r.expenses} />}
            {detail === 'clientDebts' && <DebtTable rows={r.clientDebts} tone="client" />}
            {detail === 'supplierDebts' && <DebtTable rows={r.supplierDebts} tone="supplier" />}
            {detail === 'stock' && <StockAlertTable rows={r.stockAlerts} />}
            {detail === 'expiry' && <ExpiryTable rows={r.expiryAlerts} />}
            {detail === 'workers' && <WorkerTable rows={r.workers} />}
            {detail === 'destructions' && <DestructionTable rows={r.destructions} />}
          </motion.div>
        </AnimatePresence>
      </Modal>
    </div>
  );
}
