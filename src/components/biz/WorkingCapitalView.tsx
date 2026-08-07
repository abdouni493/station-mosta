/**
 * ─── Fonds de roulement ────────────────────────────────────────────────────────
 * Le calcul est montré comme il se lit :
 *
 *   Caisse + Banques + Créances clients + Stock (prix d'achat) − Dettes fournisseurs
 *
 * Chaque terme est une carte cliquable qui ouvre son détail ligne par ligne :
 * chaque compte bancaire (avec son solde d'ouverture et ses mouvements de la
 * période), la caisse de chaque activité, chaque client débiteur avec sa
 * facture, chaque fournisseur avec la sienne, chaque cuve et chaque référence
 * en stock avec sa quantité et son prix d'achat.
 *
 * Un sélecteur d'activité en tête filtre TOUT l'écran (cartes, calcul, détails)
 * sur une seule partie : carburant, cafétéria, lavage ou finance.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo, useState } from 'react';
import {
  PiggyBank, Landmark, Users, Truck, Wallet, ChevronRight, Boxes, Scale,
  ArrowDownRight, ArrowUpRight, Info, Building2, Filter, Layers,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { money, formatDate, Modal, Table, Badge } from '@/src/components/biz/Kit';
import { WorkingCapitalReport, WCBlock, WCRow, filterWorkingCapital } from '@/src/lib/workingCapital';
import { TreasuryAccount } from '@/src/lib/treasuryReporting';

const BLOCK_ICON: Record<string, React.ElementType> = {
  cash: PiggyBank, banks: Landmark, receivables: Users, stock: Boxes, payables: Truck,
};

const BLOCK_BG: Record<string, string> = {
  cash: 'linear-gradient(135deg,#001f5c,#003087)',
  banks: 'linear-gradient(135deg,#065f46,#047857)',
  receivables: 'linear-gradient(135deg,#4c1d95,#6d28d9)',
  stock: 'linear-gradient(135deg,#92400e,#b45309)',
  payables: 'linear-gradient(135deg,#991b1b,#dc2626)',
};

function StepCard({ block, onOpen }: { block: WCBlock; onOpen: () => void }) {
  const Icon = BLOCK_ICON[block.key] || Wallet;
  const negative = block.sign === -1;
  return (
    <button onClick={onOpen}
      className="rounded-2xl p-5 text-white text-left transition-transform hover:-translate-y-0.5 w-full"
      style={{ background: BLOCK_BG[block.key] || 'linear-gradient(135deg,#334155,#475569)' }}>
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

export default function WorkingCapitalView({ report: full }: { report: WorkingCapitalReport }) {
  const [detail, setDetail] = useState<WCBlock | null>(null);
  /** Activité regardée : `all`, `systeme` (finance) ou la clé d'une partie. */
  const [partKey, setPartKey] = useState<string>('all');

  // Le filtre recalcule TOUS les totaux depuis les lignes conservées : l'écran
  // ne peut jamais afficher un total qui ne correspond pas à son détail.
  const r = useMemo(() => filterWorkingCapital(full, partKey), [full, partKey]);

  const filters = useMemo(() => ([
    { key: 'all', label: 'Toutes les activités', emoji: '🏢' },
    { key: 'systeme', label: 'Finance (caisse & banques)', emoji: '🏦' },
    ...full.parts.map(p => ({ key: p.key, label: p.label, emoji: p.emoji })),
  ]), [full.parts]);

  const filtered = partKey !== 'all';
  const activeFilter = filters.find(f => f.key === partKey);
  const positive = r.workingCapital >= 0;

  const steps: { label: string; value: number; sign: '' | '+' | '−' | '='; tone: string }[] = [
    { label: 'Caisse générale', value: r.cashTotal, sign: '', tone: 'text-[#002d87]' },
    { label: 'Comptes bancaires', value: r.bankTotal, sign: '+', tone: 'text-emerald-700' },
    { label: 'Créances clients', value: r.receivablesTotal, sign: '+', tone: 'text-violet-700' },
    { label: "Stock (prix d'achat)", value: r.stockValue, sign: '+', tone: 'text-amber-700' },
    { label: 'Dettes fournisseurs', value: r.payablesTotal, sign: '−', tone: 'text-red-600' },
    { label: 'Fonds de roulement', value: r.workingCapital, sign: '=', tone: positive ? 'text-emerald-600' : 'text-red-600' },
  ];

  return (
    <div className="space-y-8">
      {/* ── Filtre par activité — pilote tout l'écran ── */}
      <div className="card-glass p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[#FFB800]" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filtrer par activité</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map(f => (
            <button key={f.key} onClick={() => setPartKey(f.key)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                partKey === f.key ? 'bg-[#003087] text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
              {f.emoji} {f.label}
            </button>
          ))}
        </div>
        {filtered && (
          <p className="text-[11px] text-slate-400 italic">
            Chaque montant ci-dessous ne compte que les lignes de « {activeFilter?.label} ».
            {partKey !== 'systeme' && ' La caisse générale et les comptes bancaires ne sont pas rattachés à une activité : ils n\'apparaissent que sur « Toutes les activités » et « Finance ».'}
          </p>
        )}
      </div>

      {/* ── Le résultat ── */}
      <div className="rounded-2xl p-6 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        style={{ background: positive ? 'linear-gradient(135deg,#001f5c,#003087)' : 'linear-gradient(135deg,#7f1d1d,#b91c1c)' }}>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide opacity-90 flex items-center gap-2">
            <Scale className="w-4 h-4" /> Fonds de roulement
            {filtered && <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-white/15">{activeFilter?.label}</span>}
          </p>
          <p className="text-xs opacity-75 mt-1 leading-relaxed">
            Trésorerie ({money(r.treasuryTotal)}) + créances clients ({money(r.receivablesTotal)})
            + stock au prix d'achat ({money(r.stockValue)}) − dettes fournisseurs ({money(r.payablesTotal)}).
          </p>
          <p className="text-xs opacity-75 mt-1">
            Dont {money(r.fuelStockValue)} de carburant en cuve et {money(r.goodsStockValue)} de marchandise.
            Hors stock (disponible financier seul) : {money(r.financialWorkingCapital)}.
          </p>
        </div>
        <p className="text-4xl font-black tabular-nums shrink-0" style={{ color: positive ? '#FFB800' : '#fff' }}>
          {money(r.workingCapital)}
        </p>
      </div>

      {/* ── Les cinq termes, cliquables ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <StepCard block={r.cash} onOpen={() => setDetail(r.cash)} />
        <StepCard block={r.banks} onOpen={() => setDetail(r.banks)} />
        <StepCard block={r.receivables} onOpen={() => setDetail(r.receivables)} />
        <StepCard block={r.stock} onOpen={() => setDetail(r.stock)} />
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
          <span><b className="text-slate-700">Hors stock</b> {money(r.financialWorkingCapital)}</span>
          <span><b className="text-slate-700">Crédit net</b> {money(r.netCredit)} (créances − dettes)</span>
          {r.liquidityRatio !== null && (
            <span>
              <b className="text-slate-700">Ratio de liquidité</b> {r.liquidityRatio.toFixed(2)} —
              {r.liquidityRatio >= 1 ? ' le disponible couvre les dettes' : ' les dettes dépassent le disponible'}
            </span>
          )}
          {r.coverageRatio !== null && (
            <span><b className="text-slate-700">Couverture avec le stock</b> {r.coverageRatio.toFixed(2)}</span>
          )}
        </div>
      </div>

      {/* ── Par activité — chaque ligne porte son propre TOTAL ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Wallet className="w-5 h-5 text-[#FFB800]" /> Détail par activité
        </h3>
        <Table head={<>
          <th className="table-head">Activité</th>
          <th className="table-head text-right">Caisse (indicatif)</th>
          <th className="table-head text-right">Créances clients</th>
          <th className="table-head text-right">Stock (prix d'achat)</th>
          <th className="table-head text-right">Dettes fournisseurs</th>
          <th className="table-head text-right">Net financier</th>
          <th className="table-head text-right">Total de l'activité</th>
        </>}>
          {r.parts.map(p => (
            <tr key={p.key} className="cursor-pointer hover:bg-slate-50" onClick={() => setPartKey(p.key)}>
              <td className="table-cell font-bold whitespace-nowrap">{p.emoji} {p.label}</td>
              <td className={cn('table-cell tabular-nums text-right', p.cash >= 0 ? 'text-[#002d87]' : 'text-red-600')}>{money(p.cash)}</td>
              <td className="table-cell tabular-nums text-right text-violet-700">{money(p.receivables)}</td>
              <td className="table-cell tabular-nums text-right text-amber-700">{money(p.stockValue)}</td>
              <td className="table-cell tabular-nums text-right text-red-600">{money(p.payables)}</td>
              <td className={cn('table-cell tabular-nums text-right', p.net >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.net)}</td>
              <td className={cn('table-cell tabular-nums text-right font-black', p.total >= 0 ? 'text-emerald-600' : 'text-red-600')}>{money(p.total)}</td>
            </tr>
          ))}
          <tr className="bg-blue-50/60">
            <td className="table-cell font-black text-[#002d87]">TOTAL DES ACTIVITÉS</td>
            <td className="table-cell tabular-nums text-right font-black text-slate-400">{money(r.parts.reduce((s, p) => s + p.cash, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-violet-700">{money(r.parts.reduce((s, p) => s + p.receivables, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-amber-700">{money(r.parts.reduce((s, p) => s + p.stockValue, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-red-600">{money(r.parts.reduce((s, p) => s + p.payables, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black">{money(r.parts.reduce((s, p) => s + p.net, 0))}</td>
            <td className="table-cell tabular-nums text-right font-black text-[#002d87]">{money(r.parts.reduce((s, p) => s + p.total, 0))}</td>
          </tr>
        </Table>
        <p className="text-[11px] text-slate-400 italic flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Cliquez sur une ligne pour ne garder que cette activité. La colonne « Caisse » est la position reconstituée
          sur les documents de chaque activité : elle dit d'où vient l'argent, mais elle n'entre pas dans le fonds de
          roulement — la recette déjà versée au grand livre y serait comptée deux fois. Le calcul retient la caisse
          générale ({money(r.cash.total)}), les comptes bancaires ({money(r.bankTotal)}) et le stock au prix d'achat
          ({money(r.stockValue)}).
        </p>
      </div>

      {/* ── Ce que pèse le stock ── */}
      <div className="space-y-3">
        <h3 className="font-black text-[#002d87] flex items-center gap-2">
          <Boxes className="w-5 h-5 text-[#FFB800]" /> Stock compté dans le fonds de roulement
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[10px] uppercase font-black text-amber-700">Carburant en cuve</p>
            <p className="text-2xl font-black tabular-nums text-amber-800">{money(r.fuelStockValue)}</p>
            <p className="text-[11px] text-amber-700 mt-0.5">Litres restants × prix d'achat du carburant</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[10px] uppercase font-black text-amber-700">Marchandise</p>
            <p className="text-2xl font-black tabular-nums text-amber-800">{money(r.goodsStockValue)}</p>
            <p className="text-[11px] text-amber-700 mt-0.5">Catalogues & comptoirs, au prix d'achat</p>
          </div>
          <button onClick={() => setDetail(r.stock)}
            className="rounded-2xl border border-[#003087]/20 bg-[#eef3fc] p-4 text-left hover:bg-[#e2ebfa] transition-colors">
            <p className="text-[10px] uppercase font-black text-[#002d87]">Total stock</p>
            <p className="text-2xl font-black tabular-nums text-[#002d87]">{money(r.stockValue)}</p>
            <p className="text-[11px] font-black text-[#003087] mt-0.5 flex items-center gap-1">
              <Layers className="w-3 h-3" /> Voir chaque cuve et chaque référence →
            </p>
          </button>
        </div>
      </div>

      {/* ── Les comptes bancaires, déroulables ── */}
      {(partKey === 'all' || partKey === 'systeme') && (
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
      )}

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
