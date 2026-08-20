import React, { useMemo, useState, useCallback } from 'react';
import {
  Users, Plus, Phone, MapPin, History, TrendingUp, CircleDollarSign,
  FileBarChart, Receipt, Eye, Car, IdCard, ShoppingBag,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { ModuleKey, MODULES, BizContact, BizReparation } from '@/src/lib/bizConfig';
import { matchesSearch, cn } from '@/src/lib/utils';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Edit2, Trash2, Confirm, money, formatDate,
} from '@/src/components/biz/Kit';
import { printFiche } from '@/src/components/biz/ReportFiche';
import { ClientStatementFiche } from '@/src/components/biz/ClientStatementFiche';
import ClientReportModal from '@/src/components/biz/ClientReportModal';
import ClientDossier, { DossierGroup, DossierSection } from '@/src/components/clients/ClientDossier';
import { bizClientStatement, ClientStatement } from '@/src/lib/clientStatement';
import { ContactModal } from './_shared';

const shortDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

export default function ModuleClients({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'clients');
  const { settings } = useAppState();
  const { clients } = biz.state;

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizContact | null>(null);
  /** Le client dont le dossier est ouvert, et la rubrique par laquelle entrer. */
  const [dossier, setDossier] = useState<{ client: BizContact; section: string } | null>(null);
  const [report, setReport] = useState<BizContact | null>(null);
  const [toDelete, setToDelete] = useState<BizContact | null>(null);

  const filtered = clients.filter((c: BizContact) => matchesSearch(search, c.name, c.phone, c.address));

  /**
   * Le compte COMPLET de chaque client — toutes ses ventes et toutes ses
   * interventions, depuis toujours. Les bornes de période sont laissées vides :
   * les cartes et le dossier montrent la vie entière du compte, et c'est le
   * rapport imprimable qui, seul, se restreint à une période.
   */
  const statements = useMemo(() => {
    const out: Record<string, ClientStatement> = {};
    for (const c of clients) out[c.id] = bizClientStatement(biz.state, c, cfg.label);
    return out;
  }, [biz.state, clients, cfg.label]);

  const del = () => {
    if (toDelete) { biz.remove('clients', toDelete.id); toast.success('Client supprimé'); setToDelete(null); }
  };

  // Les totaux de l'en-tête se lisent sur les MÊMES relevés que les cartes :
  // un chiffre de tête qui ne se retrouve pas dans le détail ne sert à rien.
  const totals = useMemo(() => {
    let debt = 0, ops = 0, charged = 0, paid = 0, debtors = 0;
    for (const c of clients) {
      const st = statements[c.id];
      if (!st) continue;
      debt += st.closingDebt;
      ops += st.allLines.length;
      charged += st.totals.charged;
      paid += st.totals.paid;
      if (st.closingDebt > 0) debtors++;
    }
    return { debt, ops, charged, paid, debtors };
  }, [clients, statements]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Users} title="Clients" subtitle={`${cfg.label} — base clients`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus className="w-4 h-4" /> Nouveau client</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Clients" value={clients.length} tone="blue"
          sub={totals.debtors > 0 ? `${totals.debtors} avec une dette` : 'aucune dette en cours'} />
        <StatCard icon={TrendingUp} label="Opérations" value={totals.ops} tone="purple"
          sub="ventes, interventions et règlements" />
        <StatCard icon={Receipt} label="Total consommé" value={money(totals.charged)} tone="green"
          sub={`${money(totals.paid)} encaissés`} />
        <StatCard icon={CircleDollarSign} label="Dettes clients" value={money(totals.debt)} tone="red"
          sub="reste dû, d'après les documents" />
      </div>

      <div className="card-glass p-4"><SearchInput value={search} onChange={setSearch} placeholder="Nom, téléphone ou adresse…" /></div>

      {filtered.length === 0 ? <EmptyState icon={Users} title="Aucun client" action={perm.creer ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Nouveau client</button> : undefined} /> : (
        <CardGrid>
          {filtered.map(c => {
            const st = statements[c.id];
            const debt = st?.closingDebt || 0;
            const last = st?.allLines[0];
            return (
              <GlassCard key={c.id}>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#003087] to-[#0044bb] text-white flex items-center justify-center font-black shrink-0">{c.name.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-black text-slate-800 truncate">{c.name}</h3>
                    {c.phone && <p className="text-xs text-slate-400 flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{c.phone}</p>}
                  </div>
                  {/* Un compte soldé le dit — sinon seule l'absence de rouge
                      l'indiquait, et une carte sans couleur ne se lit pas. */}
                  <span className={cn('shrink-0 w-7 h-7 rounded-xl flex items-center justify-center border',
                    debt > 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100')}
                    title={debt > 0 ? `${money(debt)} restant dû` : 'Compte soldé'}>
                    {debt > 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </span>
                </div>
                {c.address && <p className="text-xs text-slate-400 flex items-center gap-1 mt-2 truncate"><MapPin className="w-3 h-3 shrink-0" />{c.address}</p>}

                {/* Les trois chiffres de la carte se relisent l'un l'autre :
                    consommé − payé = reste. Auparavant la case « Achats »
                    comptait des documents et la case « Total » un montant : les
                    deux ne se comparaient à rien. */}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-slate-50 p-2 text-center">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Consommé</p>
                    <p className="font-black text-slate-700 tabular-nums text-xs">{money(st?.totals.charged || 0)}</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-center">
                    <p className="text-[9px] uppercase font-bold text-slate-400">Payé</p>
                    <p className="font-black text-emerald-600 tabular-nums text-xs">{money(st?.totals.paid || 0)}</p>
                  </div>
                  <div className={cn('rounded-xl p-2 text-center', debt > 0 ? 'bg-red-50' : 'bg-slate-50')}>
                    <p className="text-[9px] uppercase font-bold text-slate-400">Reste</p>
                    <p className={cn('font-black tabular-nums text-xs', debt > 0 ? 'text-red-600' : 'text-slate-400')}>{money(debt)}</p>
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 font-bold mt-2 truncate">
                  {st?.totals.documents || 0} document(s) · {st?.payments.length || 0} règlement(s)
                  {last ? ` · dernière ${shortDate(last.date)}` : ' · aucune opération'}
                </p>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <button className="btn-ghost !px-2 !py-1.5 text-xs" title="Ouvrir le dossier complet du client"
                      onClick={() => setDossier({ client: c, section: 'resume' })}>
                      <Eye className="w-4 h-4" /> Détails
                    </button>
                    <button className="btn-ghost !px-2 !py-1.5 text-xs" title="Toutes les opérations du compte"
                      onClick={() => setDossier({ client: c, section: 'journal' })}>
                      <History className="w-4 h-4" /> Historique
                    </button>
                    <button className="btn-ghost !px-2 !py-1.5 text-xs" title="Générer un rapport sur une période"
                      onClick={() => setReport(c)}><FileBarChart className="w-4 h-4" /></button>
                  </div>
                  <RowActions>
                    {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => { setEditing(c); setShowForm(true); }} />}
                    {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(c)} />}
                  </RowActions>
                </div>
              </GlassCard>
            );
          })}
        </CardGrid>
      )}

      <ContactModal biz={biz} coll="clients" open={showForm} onClose={() => setShowForm(false)} initial={editing} />

      {dossier && (
        <BizClientDossier
          key={dossier.client.id}
          client={dossier.client} moduleKey={moduleKey} partLabel={cfg.label}
          settings={settings} initialSection={dossier.section}
          onClose={() => setDossier(null)}
          onReport={() => { setReport(dossier.client); setDossier(null); }}
        />
      )}

      {report && (
        <BizClientReport
          client={report} moduleKey={moduleKey} partLabel={cfg.label}
          settings={settings} onClose={() => setReport(null)} />
      )}

      <Confirm open={!!toDelete} title="Supprimer le client" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// ─── Le dossier d'un client de partie ─────────────────────────────────────────
/**
 * Tout le compte d'un client Cafétéria ou Lavage, sur le gabarit partagé
 * (`components/clients/ClientDossier`). L'écran d'avant ne listait qu'une date,
 * une référence et trois montants ; il ne disait ni ce qui avait été acheté, ni
 * quand l'argent était entré, ni ce que le client devait encore.
 *
 * Une partie « service » ajoute sa rubrique propre : le PARC du client — chaque
 * véhicule passé à l'atelier, ce qu'il a coûté et quand il est venu la dernière
 * fois. C'est la question qu'on pose vraiment d'un client de lavage.
 */
function BizClientDossier({
  client, moduleKey, partLabel, settings, initialSection, onClose, onReport,
}: {
  client: BizContact; moduleKey: ModuleKey; partLabel: string; settings: any;
  initialSection: string; onClose: () => void; onReport: () => void;
  /** `@types/react` absent : le `key` doit être déclaré pour être accepté. */
  key?: React.Key;
}) {
  const biz = useBiz(moduleKey);
  const cfg = MODULES[moduleKey];
  const ficheRef = React.useRef<HTMLDivElement>(null);

  // Aucune borne : le dossier d'un client, c'est son compte entier.
  const st = useMemo(
    () => bizClientStatement(biz.state, client, partLabel),
    [biz.state, client, partLabel]);

  /** Les interventions de ce client, pour la rubrique « Parc automobile ». */
  const interventions: BizReparation[] = useMemo(
    () => (biz.state.reparations || []).filter((r: BizReparation) => r.clientId === client.id),
    [biz.state.reparations, client.id]);

  /** Un véhicule par plaque — ou, à défaut, par marque et modèle. */
  const parc = useMemo(() => {
    const map = new Map<string, {
      label: string; plate?: string; visits: number; total: number; rest: number; last: string;
    }>();
    for (const r of interventions) {
      if (r.status === 'canceled') continue;
      const plate = r.car?.immatriculation?.trim();
      const label = [r.car?.marque, r.car?.name].filter(Boolean).join(' ') || 'Véhicule';
      const key = plate || label;
      const cur = map.get(key) || { label, plate, visits: 0, total: 0, rest: 0, last: '' };
      cur.visits += 1;
      cur.total += Number(r.total) || 0;
      cur.rest += Number(r.rest) || 0;
      if (!cur.last || new Date(r.date).getTime() > new Date(cur.last).getTime()) cur.last = r.date;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [interventions]);

  const identity: DossierGroup[] = [
    {
      title: 'Coordonnées',
      icon: IdCard,
      rows: [
        { label: 'Nom du client', value: client.name },
        { label: 'Téléphone', value: client.phone },
        { label: 'Adresse', value: client.address },
        { label: 'Client depuis', value: client.createdAt ? formatDate(client.createdAt) : undefined },
      ],
    },
    {
      title: 'Le compte en un coup d\'œil',
      icon: ShoppingBag,
      rows: [
        { label: 'Activité', value: partLabel },
        { label: 'Opérations enregistrées', value: `${st.allLines.length}` },
        { label: 'Première opération', value: st.allLines.length ? shortDate(st.allLines[st.allLines.length - 1].date) : undefined },
        { label: 'Dernière opération', value: st.allLines.length ? shortDate(st.allLines[0].date) : undefined },
        { label: 'Total consommé', value: money(st.totals.charged) },
        { label: 'Total encaissé', value: money(st.totals.paid) },
        { label: 'Reste dû', value: money(st.closingDebt), hint: st.closingDebt > 0 ? 'sur les documents du compte' : 'compte soldé' },
        ...(cfg.isService ? [{ label: 'Véhicules suivis', value: `${parc.length}` }] : []),
      ],
    },
  ];

  const extraSections: DossierSection[] = cfg.isService && parc.length > 0 ? [{
    id: 'parc',
    label: 'Parc automobile',
    icon: Car,
    count: parc.length,
    hint: 'Les véhicules de ce client passés à l\'atelier',
    render: () => (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
          <Car className="w-4 h-4 text-[#002d87]" />
          <h4 className="text-xs font-black uppercase tracking-wider text-[#002d87]">Véhicules ({parc.length})</h4>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50">
              <tr className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Véhicule</th>
                <th className="px-4 py-2.5">Immatriculation</th>
                <th className="px-4 py-2.5 text-right">Passages</th>
                <th className="px-4 py-2.5">Dernier passage</th>
                <th className="px-4 py-2.5 text-right">Total facturé</th>
                <th className="px-4 py-2.5 text-right">Reste dû</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parc.map(v => (
                <tr key={v.plate || v.label} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-black text-slate-700">{v.label}</td>
                  <td className="px-4 py-2.5 font-bold text-slate-500 whitespace-nowrap">{v.plate || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-slate-500">{v.visits}</td>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{shortDate(v.last)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-black text-[#002d87] whitespace-nowrap">{money(v.total)}</td>
                  <td className={cn('px-4 py-2.5 text-right tabular-nums font-black whitespace-nowrap',
                    v.rest > 0 ? 'text-red-600' : 'text-slate-300')}>{money(v.rest)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr className="text-[#002d87] font-black">
                <td colSpan={4} className="px-4 py-3 uppercase text-[10px] tracking-widest">Total du parc</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(parc.reduce((s, v) => s + v.total, 0))}</td>
                <td className="px-4 py-3 text-right tabular-nums text-red-600">{money(parc.reduce((s, v) => s + v.rest, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    ),
  }] : [];

  return (
    <ClientDossier
      open onClose={onClose}
      statement={st}
      identity={identity}
      extraSections={extraSections}
      initialSection={initialSection}
      onReport={onReport}
      onPrintStatement={() => printFiche(ficheRef.current)}
      badges={
        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-blue-100">
          {st.allLines.length} opération(s)
        </span>
      }
    >
      {/* La feuille A4, hors écran : c'est elle que `printFiche` clone. */}
      <ClientStatementFiche ref={ficheRef} statement={st} settings={settings} />
    </ClientDossier>
  );
}

// ─── Rapport de période ───────────────────────────────────────────────────────
function BizClientReport({
  client, moduleKey, partLabel, settings, onClose,
}: {
  client: BizContact; moduleKey: ModuleKey; partLabel: string; settings: any; onClose: () => void;
}) {
  const biz = useBiz(moduleKey);
  const state = biz.state;
  const build = useCallback(
    (from: string, to: string) => bizClientStatement(state, client, partLabel, from, to),
    [state, client, partLabel]);

  return (
    <ClientReportModal open onClose={onClose} build={build} settings={settings}
      clientName={client.name} partLabel={partLabel} />
  );
}
