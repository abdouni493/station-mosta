/**
 * ─── Fonds de roulement ────────────────────────────────────────────────────────
 * Le calcul est montré comme il se lit :
 *
 *      Caisses + Banques + Créances clients − Dettes fournisseurs
 *
 * Chaque terme est une carte cliquable qui ouvre son détail ligne par ligne :
 * chaque compte bancaire (avec son solde d'ouverture et ses mouvements de la
 * période), la caisse de chaque activité, chaque client débiteur avec sa
 * facture, chaque fournisseur avec la sienne.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import {
  PiggyBank, Landmark, Users, Truck, Wallet, ChevronRight, Boxes, Scale,
  ArrowDownRight, ArrowUpRight, Info, Building2,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { money, formatDate, Modal, Table, Badge } from '@/src/components/biz/Kit';
import { WorkingCapitalReport, WCBlock, WCRow } from '@/src/lib/workingCapital';
import { TreasuryAccount } from '@/src/lib/treasuryReporting';

const BLOCK_ICON: Record<string, React.ElementType> = {
  cash: PiggyBank, banks: Landmark, receivables: Users, payables: Truck,
};

function StepCard({ block, onOpen }: { block: WCBlock; onOpen: () => void }) {
  const Icon = BLOCK_ICON[block.key] || Wallet;
  const negative = block.sign === -1;
  return (
    <button onClick={onOpen}
      className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5 w-full"
      style={{ background: negative
        ? 'linear-gradient(135deg,#991b1b,#dc2626)'
        : block.key === 'cash' ? 'linear-gradient(135deg,#001f5c,#003087)'
        : block.key === 'banks' ? 'linear-gradient(135deg,#065f46,#047857)'
        : 'linear-gradient(135deg,#4c1d95,#6d28d9)' }}>
      <div className="flex items-center gap-2 opacity-80">
        <Icon className="w-4 h-4" />
        <span className="text-[11px] font-bold uppercase tracking-wide">{block.label}</span>
      </div>
      <p className="text-2xl font-black tabular-nums mt-1.5">{negative ? '−' : ''}{money(block.total)}</p>
      <p className="text-[11px] opacity-75 mt-0.5">
        {block.rows.filter(r => !r.informational).length} ligne(s) comptée(s) — voir le détail →
      </p>
    </button>
  );
}

function RowList({ rows, negative }: { rows: WCRow[]; negative?: boolean }) {
  if (!rows.length) {
    return <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center text-sm font-bold text-slate-400">Aucune ligne.</div>;
  }
  return (
    <Table head={<>
      <th className="table-head">Libellé</th>
      <th className="table-head">Activité</th>
      <th className="table-head">Date</th>
      <th className="table-head text-right">Montant</th>
    </>}>
      {rows.map(r => (
        <tr key={r.id} className={cn('hover:bg-slate-50', r.informational && 'bg-slate-50/60')}>
          <td className="table-cell">
            <div className="font-bold text-slate-700 flex items-center gap-1.5 flex-wrap">
              {r.emoji && <span>{r.emoji}</span>}{r.label}
              {r.informational && <Badge tone="neutral">Hors total</Badge>}
            </div>
            {r.sub && <div className="text-[11px] text-slate-400">{r.sub}</div>}
          </td>
          <td className="table-cell text-slate-400 text-xs">{r.partLabel || '—'}</td>
          <td className="table-cell whitespace-nowrap text-slate-500">{r.date ? formatDate(r.date) : '—'}</td>
          <td className={cn('table-cell text-right tabular-nums font-black',
            r.informational ? 'text-slate-400'
              : negative ? 'text-red-600' : r.amount < 0 ? 'text-red-600' : 'text-emerald-600')}>
            {!r.informational && negative ? '−' : ''}{money(r.amount)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

/** Un compte bancaire déroulé : son ouverture, son solde et ses mouvements. */
function AccountCard({ account: a }: { account: TreasuryAccount; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-black text-slate-800 text-sm truncate">{a.name}</p>
          <p className="text-[11px] text-slate-400">
            {a.accountNumber ? `N° ${a.accountNumber} · ` : ''}Ouverture {money(a.initialBalance)} · {a.movesCount} mouvement(s)
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase font-bold text-slate-400">Solde</p>
          <p className={cn('font-black tabular-nums', a.balance >= 0 ? 'text-[#002d87]' : 'text-red-600')}>{money(a.balance)}</p>
        </div>
        <ChevronRight className={cn('w-4 h-4 text-slate-300 transition-transform shrink-0', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/60 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white p-2.5 border border-slate-100">
              <p className="text-[10px] uppercase font-bold text-slate-400">Entrées (période)</p>
              <p className="font-black tabular-nums text-emerald-600 text-sm">+{money(a.credit)}</p>
            </div>
            <div className="rounded-xl bg-white p-2.5 border border-slate-100">
              <p className="text-[10px] uppercase font-bold text-slate-400">Sorties (période)</p>
              <p className="font-black tabular-nums text-red-600 text-sm">−{money(a.debit)}</p>
            </div>
            <div className="rounded-xl bg-white p-2.5 border border-slate-100">
              <p className="text-[10px] uppercase font-bold text-slate-400">Solde d'ouverture</p>
              <p className="font-black tabular-nums text-slate-600 text-sm">{money(a.initialBalance)}</p>
            </div>
          </div>
          {a.moves.length === 0 ? (
            <p className="text-xs text-slate-400 italic px-1">Aucun mouvement sur la période.</p>
          ) : (
            <div className="space-y-1.5">
              {a.moves.map(m => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                  <Badge tone={m.amount >= 0 ? 'success' : 'danger'}>
                    {m.amount >= 0 ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />} {m.nature}
                  </Badge>
                  <span className="text-xs text-slate-600 min-w-0 flex-1 truncate">{m.label}</span>
                  <span className="text-[11px] text-slate-400">{m.counterpart}</span>
                  {m.reference && <span className="badge badge-info">{m.reference}</span>}
                  <span className="text-[11px] text-slate-400">{formatDate(m.date)}</span>
                  <span className={cn('font-black tabular-nums text-sm ml-auto', m.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {m.amount >= 0 ? '+' : '−'}{money(Math.abs(m.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
          {a.notes && <p className="text-[11px] text-slate-400 italic px-1">{a.notes}</p>}
        </div>
      )}
    </div>
  );
}

export default function WorkingCapitalView({ report: r }: { report: WorkingCapitalReport }) {
  const [detail, setDetail] = useState<WCBlock | null>(null);
  const positive = r.workingCapital >= 0;

  const steps: { label: string; value: number; sign: '' | '+' | '−' | '='; tone: string }[] = [
    { label: 'Caisse générale', value: r.cashTotal, sign: '', tone: 'text-[#002d87]' },
    { label: 'Comptes bancaires', value: r.bankTotal, sign: '+', tone: 'text-emerald-700' },
    { label: 'Créances clients', value: r.receivablesTotal, sign: '+', tone: 'text-violet-700' },
    { label: 'Dettes fournisseurs', value: r.payablesTotal, sign: '−', tone: 'text-red-600' },
    { label: 'Fonds de roulement', value: r.workingCapital, sign: '=', tone: positive ? 'text-emerald-600' : 'text-red-600' },
  ];

  return (
    <div className="space-y-8">
      {/* ── Le résultat ── */}
      <div className="rounded-2xl p-6 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ background: positive ? 'linear-gradient(135deg,#001f5c,#003087)' : 'linear-gradient(135deg,#7f1d1d,#b91c1c)' }}>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide opacity-90 flex items-center gap-2">
            <Scale className="w-4 h-4" /> Fonds de roulement
          </p>
          <p className="text-xs opacity-75 mt-1 leading-relaxed">
            Trésorerie disponible ({money(r.treasuryTotal)}) + ce que les clients doivent ({money(r.receivablesTotal)})
            − ce que la station doit à ses fournisseurs ({money(r.payablesTotal)}).
          </p>
          <p className="text-xs opacity-75 mt-1">
            Le stock ({money(r.stockValue)} au prix d'achat) n'est PAS compté : c'est de la marchandise, pas de l'argent
            disponible. Actif circulant complet : {money(r.withStock)}.
          </p>
        </div>
        <p className="text-4xl font-black tabular-nums shrink-0" style={{ color: positive ? '#FFB800' : '#fff' }}>
          {money(r.workingCapital)}
        </p>
      </div>

      {/* ── Les quatre termes, cliquables ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StepCard block={r.cash} onOpen={() => setDetail(r.cash)} />
        <StepCard block={r.banks} onOpen={() => setDetail(r.banks)} />
        <StepCard block={r.receivables} onOpen={() => setDetail(r.receivables)} />
        <StepCard block={r.payables} onOpen={() => setDetail(r.payables)} />
      </div>

      {/* ── Le calcul, étape par étape ── */}
      <div className="card-glass p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Comment le fonds de roulement est calculé</p>
        <div className="flex flex-wrap items-stretch gap-2">
          {steps.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <span className="self-center text-slate-300 font-black text-lg px-0.5">{s.sign}</span>}
              <div className={cn('rounded-xl px-3 py-2 flex-1 min-w-[140px]', s.sign === '=' ? 'bg-slate-100' : 'bg-slate-50')}>
                <p className="text-[10px] uppercase font-bold text-slate-400 leading-tight">{s.label}</p>
                <p className={cn('font-black tabular-nums text-sm mt-0.5', s.tone)}>{money(s.value)}</p>
              </div>
            </React.Fragment>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
          <span><b className="text-slate-700">Trésorerie immédiate</b> {money(r.treasuryTotal)}</span>
          <span><b className="text-slate-700">Crédit net</b> {money(r.netCredit)} (créances − dettes)</span>
          {r.liquidityRatio !== null && (
            <span>
              <b className="text-slate-700">Ratio de liquidité</b> {r.liquidityRatio.toFixed(2)} —
              {r.liquidityRatio >= 1 ? ' la station couvre ses dettes' : ' les dettes dépassent le disponible'}
            </span>
          )}
        </div>
      </div>

      {/* ── Par activité ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[#FFB800]" /> Détail par activité
        </h3>
        <Table head={<>
          <th className="table-head">Activité</th>
          <th className="table-head text-right">Caisse (indicatif)</th>
          <th className="table-head text-right">Créances clients</th>
          <th className="table-head text-right">Dettes fournisseurs</th>
          <th className="table-head text-right">Net</th>
          <th className="table-head text-right">Stock (prix d'achat)</th>
        </>}>
          {r.parts.map(p => (
            <tr key={p.key}>
              <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
              <td className={cn('table-cell tabular-nums text-right', p.cash >= 0 ? 'text-[#002d87]' : 'text-red-600')}>{money(p.cash)}</td>
              <td className="table-cell tabular-nums text-right text-violet-700">{money(p.receivables)}</td>
              <td className="table-cell tabular-nums text-right text-red-600">{money(p.payables)}</td>
              <td className={cn('table-cell tabular-nums text-right font-black', p.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.net)}</td>
              <td className="table-cell tabular-nums text-right text-amber-700">{money(p.stockValue)}</td>
            </tr>
          ))}
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]">TOTAL DES ACTIVITÉS</td>
            <td className="table-cell tabular-nums text-right font-black text-slate-400">{money(r.parts.reduce((s, p) => s + p.cash, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-violet-700">{money(r.receivablesTotal)}</td>
            <td className="table-cell tabular-nums text-right font-black text-red-600">{money(r.payablesTotal)}</td>
            <td className="table-cell tabular-nums text-right font-black">{money(r.parts.reduce((s, p) => s + p.net, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(r.stockValue)}</td>
          </tr>
        </Table>
        <p className="text-[11px] text-slate-400 italic flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          La colonne « Caisse » est la position reconstituée sur les documents de chaque activité : elle dit d'où
          vient l'argent, mais elle n'entre pas dans le fonds de roulement — la recette déjà versée au grand livre
          y serait comptée deux fois. Le calcul retient la caisse générale ({money(r.cash.total)}) et les comptes
          bancaires ({money(r.bankTotal)}), exactement comme la section « Caisse & Banques ».
        </p>
      </div>

      {/* ── Les comptes bancaires, déroulables ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Landmark className="w-5 h-5 text-[#FFB800]" /> Comptes bancaires
        </h3>
        {r.accounts.length === 0 ? (
          <div className="card-glass p-8 text-center text-sm text-slate-400">Aucun compte bancaire enregistré.</div>
        ) : (
          <div className="space-y-2">
            {r.accounts.map(a => <AccountCard key={a.id} account={a} />)}
            <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Total en banque</span>
              <span className="font-black tabular-nums text-[#002d87]">{money(r.bankTotal)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Rappel du stock, hors calcul ── */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <Boxes className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-black text-amber-800">Marchandise en stock : {money(r.stockValue)}</p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            Comptée au prix d'achat, elle n'entre PAS dans le fonds de roulement — elle ne devient de l'argent
            qu'une fois vendue. Le détail complet, aux deux valorisations, se trouve dans la section
            « Valeur du stock ».
          </p>
        </div>
      </div>

      {/* ── Détail d'un terme ── */}
      <Modal open={!!detail} onClose={() => setDetail(null)}
        icon={detail ? (BLOCK_ICON[detail.key] || Wallet) : Wallet} size="2xl" fullHeight
        title={detail?.label || ''} subtitle={detail?.hint}
        footer={<>
          <div className="mr-auto flex items-center gap-2 text-sm font-black text-[#002d87]">
            <span className="text-slate-400 font-bold text-xs uppercase tracking-wide">Total</span>
            {detail?.sign === -1 ? '−' : ''}{money(detail?.total || 0)}
          </div>
          <button className="btn-ghost" onClick={() => setDetail(null)}>Fermer</button>
        </>}>
        {detail && (
          <div className="space-y-3">
            {detail.note && <p className="text-[11px] text-slate-400 italic px-1">{detail.note}</p>}
            {detail.key === 'banks'
              ? <div className="space-y-2">{r.accounts.map(a => <AccountCard key={a.id} account={a} />)}</div>
              : <RowList rows={detail.rows} negative={detail.sign === -1} />}
          </div>
        )}
      </Modal>
    </div>
  );
}
