import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Users, Plus, Phone, MapPin, History, TrendingUp, CircleDollarSign,
  FileBarChart, Receipt, Eye, Car, IdCard, ShoppingBag,
  AlertTriangle, DollarSign, MoreVertical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'react-hot-toast';
import { ModuleKey, MODULES, BizContact, BizReparation, BizSale } from '@/src/lib/bizConfig';
import { matchesSearch, cn } from '@/src/lib/utils';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission, useAppState } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, SearchInput, EmptyState,
  Edit2, Trash2, Confirm, money, formatDate,
} from '@/src/components/biz/Kit';
import { printFiche } from '@/src/components/biz/ReportFiche';
import { ClientStatementFiche } from '@/src/components/biz/ClientStatementFiche';
import ClientReportModal from '@/src/components/biz/ClientReportModal';
import ClientDossier, { DossierGroup, DossierSection } from '@/src/components/clients/ClientDossier';
import { bizClientStatement, ClientStatement } from '@/src/lib/clientStatement';
import { ContactModal, PayDebtModal, PayDebtMeta, withPayment } from './_shared';

const shortDate = (s: string) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

export default function ModuleClients({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'clients');
  const { settings, currentUserName } = useAppState();
  const { clients } = biz.state;

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BizContact | null>(null);
  /** Le client dont le dossier est ouvert, et la rubrique par laquelle entrer. */
  const [dossier, setDossier] = useState<{ client: BizContact; section: string } | null>(null);
  const [report, setReport] = useState<BizContact | null>(null);
  const [toDelete, setToDelete] = useState<BizContact | null>(null);
  /** Le client dont on encaisse la dette, et le menu d'actions ouvert. */
  const [paying, setPaying] = useState<BizContact | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

  // Le menu d'une carte se ferme dès qu'on clique ailleurs — même règle que
  // l'écran Clients du Carburant.
  useEffect(() => {
    const close = () => setActionMenuOpen(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

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

  /**
   * ─── Encaisser la dette d'un client de partie ───────────────────────
   *
   * L'écran ne savait pas encaisser : il fallait retrouver la facture dans
   * « Ventes » ou l'intervention dans « Réparations », une par une, pour solder un
   * client qui venait payer TOUT ce qu'il devait. Le règlement est donc réparti
   * sur ses documents non soldés, du PLUS ANCIEN au plus récent — la règle
   * comptable habituelle.
   *
   * Chaque document reçoit un versement DATÉ (`withPayment`) : le compte du
   * client montre le règlement au jour où il a été encaissé, et la caisse de la
   * partie le compte ce jour-là (`docPaymentSlices`, `lib/bizReporting`) — pas à
   * la date de la facture qu'il solde.
   */
  const settleDebt = async (client: BizContact, amount: number, meta: PayDebtMeta) => {
    let left = amount;
    const byDate = (a: { date: string }, b: { date: string }) =>
      new Date(a.date).getTime() - new Date(b.date).getTime();

    const openSales = (biz.state.sales || [])
      .filter((x: BizSale) => x.clientId === client.id && Number(x.rest) > 0
        && x.status !== 'retournée' && x.status !== 'échangée')
      .sort(byDate);
    const openReps = (biz.state.reparations || [])
      .filter((r: BizReparation) => r.clientId === client.id && Number(r.rest) > 0 && r.status !== 'canceled')
      .sort(byDate);

    let settled = 0;
    for (const doc of openSales) {
      if (left <= 0.004) break;
      const part = Math.min(left, Number(doc.rest) || 0);
      if (part <= 0) continue;
      const next = withPayment(doc, part, meta, currentUserName);
      biz.update('sales', { ...next, status: next.rest > 0 ? 'crédit' : 'payée' });
      left -= part; settled += part;
    }
    for (const doc of openReps) {
      if (left <= 0.004) break;
      const part = Math.min(left, Number(doc.rest) || 0);
      if (part <= 0) continue;
      const next = withPayment(doc, part, meta, currentUserName);
      biz.update('reparations', next);
      left -= part; settled += part;
    }

    setPaying(null);
    if (settled <= 0) { toast.error('Ce client n’a aucun document à solder'); return; }

    // On ATTEND le verdict du serveur avant d’annoncer l’encaissement : un
    // règlement qui n’existerait que dans ce navigateur serait perdu au premier
    // rechargement, et le client aurait payé pour rien.
    //
    // Le tour de boucle laissé au navigateur n’est pas une politesse : le store
    // ne connaît l’état modifié qu’une fois le rendu passé. Envoyer sans
    // l’attendre expédiait l’état d’AVANT le règlement — l’écran annonçait alors
    // un enregistrement qui ne le contenait pas encore.
    await new Promise(resolve => setTimeout(resolve, 0));
    const res = await biz.flush();
    if (!res.ok) {
      toast.error(`Règlement NON enregistré sur le serveur — ${res.error}`);
      return;
    }
    // Ce qui n'a pas trouvé de document est DIT, jamais encaissé dans le vide :
    // un trop-perçu sans pièce ne s'expliquerait nulle part.
    toast.success(left > 0.004
      ? `${money(settled)} encaissés — ${money(left)} sans document à solder`
      : `${money(settled)} encaissés sur le compte de ${client.name}`);
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
        /* ── Les cartes clients ───────────────────────────────────
           Même dessin que l’écran Clients du Carburant : un client est un client,
           qu’il prenne du gasoil, un café ou un lavage, et rien ne justifiait
           qu’on doive réapprendre à lire sa fiche en changeant d’activité.
           Les trois chiffres se relisent l’un l’autre : consommé − réglé = reste. */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((c, index) => {
            const st = statements[c.id];
            const debt = st?.closingDebt || 0;
            const last = st?.allLines[0];
            return (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.03 }}
                className={cn(
                  'group relative bg-white rounded-3xl border hover:shadow-2xl transition-all p-6 space-y-4 italic flex flex-col',
                  actionMenuOpen === c.id ? 'z-50 border-blue-300 ring-4 ring-blue-50 shadow-xl' : 'z-10 border-slate-100 hover:border-blue-200 shadow-sm',
                )}
              >
                <div className="h-2 absolute top-0 left-0 right-0 rounded-t-3xl bg-gradient-to-r from-blue-900 via-blue-800 to-yellow-400" />

                {/* Activité et état du compte — les deux badges de la carte Carburant. */}
                <div className="absolute top-4 left-4 flex flex-col gap-1 items-start">
                  <span className="text-[8px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm leading-none border inline-block bg-blue-50 text-blue-700 border-blue-100">
                    {cfg.label}
                  </span>
                  <span className={cn('text-[8px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm leading-none border inline-block',
                    debt > 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100')}>
                    {debt > 0 ? 'Débiteur' : 'Soldé'}
                  </span>
                </div>

                {/* Menu d’actions */}
                <div className="absolute top-4 right-4">
                  <motion.button
                    onClick={(e: any) => { e.stopPropagation(); setActionMenuOpen(actionMenuOpen === c.id ? null : c.id); }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 group-hover:text-blue-900 transition-all bg-white/80 backdrop-blur-sm shadow-sm border border-slate-100"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </motion.button>

                  <AnimatePresence>
                    {actionMenuOpen === c.id && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-52 bg-white border border-slate-100 rounded-2xl shadow-2xl z-[60] overflow-hidden"
                      >
                        <div className="divide-y divide-slate-100">
                          <button
                            onClick={() => { setDossier({ client: c, section: 'resume' }); setActionMenuOpen(null); }}
                            className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                          >
                            <Eye className="w-4 h-4 text-slate-500" /> Dossier Client
                          </button>
                          {perm.modifier && (
                            <button
                              onClick={() => { setEditing(c); setShowForm(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <Edit2 className="w-4 h-4 text-blue-500" /> Modifier
                            </button>
                          )}
                          {debt > 0 && perm.modifier && (
                            <button
                              onClick={() => { setPaying(c); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 flex items-center gap-3 transition-colors"
                            >
                              <DollarSign className="w-4 h-4 text-emerald-500" /> Payer la Dette
                            </button>
                          )}
                          <button
                            onClick={() => { setDossier({ client: c, section: 'journal' }); setActionMenuOpen(null); }}
                            className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                          >
                            <History className="w-4 h-4 text-slate-500" /> Historique Complet
                          </button>
                          <button
                            onClick={() => { setReport(c); setActionMenuOpen(null); }}
                            className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-blue-900 hover:bg-blue-50 flex items-center gap-3 transition-colors"
                          >
                            <FileBarChart className="w-4 h-4 text-blue-600" /> Générer un Rapport
                          </button>
                          {perm.supprimer && (
                            <button
                              onClick={() => { setToDelete(c); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" /> Supprimer
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Initiale et identité */}
                <div className="flex flex-col items-center text-center gap-3 pt-6">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-900 to-blue-800 text-yellow-400 rounded-2xl flex items-center justify-center text-2xl font-black shadow-lg uppercase border-2 border-white">
                    {c.name[0]}
                  </div>
                  <div>
                    <h4 className="font-black text-blue-900 uppercase tracking-tight text-sm mb-1">{c.name}</h4>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      Client depuis {c.createdAt ? formatDate(c.createdAt) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Coordonnées */}
                <div className="space-y-2 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50/50 p-4 rounded-2xl border border-slate-100/50">
                  <div className="flex items-center gap-2.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{c.phone || 'Non renseigné'}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{c.address || 'Non renseigné'}</span>
                  </div>
                </div>

                {/* Les trois chiffres du compte */}
                <div className="pt-2 mt-auto border-t border-slate-100 grid grid-cols-3 gap-2">
                  <div className="text-center bg-slate-50/50 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-center">
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Consommé</p>
                    <p className="text-[10px] font-black text-blue-900 italic truncate">{money(st?.totals.charged || 0)}</p>
                  </div>
                  <div className="text-center bg-slate-50/50 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-center">
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Réglé</p>
                    <p className="text-[10px] font-black text-emerald-700 italic truncate">{money(st?.totals.paid || 0)}</p>
                  </div>
                  <div className={cn('text-center rounded-xl p-2.5 border flex flex-col justify-center',
                    debt > 0 ? 'bg-red-50/60 border-red-100' : 'bg-emerald-50/50 border-emerald-100')}>
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Reste dû</p>
                    <p className={cn('text-[10px] font-black italic truncate', debt > 0 ? 'text-red-600' : 'text-emerald-600')}>
                      {money(debt)}
                    </p>
                  </div>
                </div>

                {/* Ce que le compte a d’utile à dire en un coup d’œil */}
                <div className="flex flex-wrap items-center gap-1.5 text-[8px] font-black uppercase tracking-wider">
                  <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-800 border border-blue-100">
                    {st?.totals.documents || 0} document(s)
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
                    {st?.payments.length || 0} règlement(s)
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-100">
                    {st?.allLines.length || 0} opé.
                  </span>
                  {last && (
                    <span className="px-2 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-100">
                      Dernière {shortDate(last.date)}
                    </span>
                  )}
                  {debt > 0 && (
                    <span className="px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> À recouvrer
                    </span>
                  )}
                </div>

                {/* Les deux entrées du dossier, toujours à portée de clic */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDossier({ client: c, section: 'resume' })}
                    title="Ouvrir le dossier complet du client"
                    className="h-10 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-100 text-blue-900 text-[9px] font-black uppercase tracking-widest italic flex items-center justify-center gap-2 transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" /> Détails
                  </button>
                  <button
                    onClick={() => setDossier({ client: c, section: 'journal' })}
                    title="Toutes les opérations du compte"
                    className="h-10 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-100 text-blue-900 text-[9px] font-black uppercase tracking-widest italic flex items-center justify-center gap-2 transition-all"
                  >
                    <History className="w-3.5 h-3.5" /> Historique
                  </button>
                </div>

                {/* Règlement de la dette — action directe, sans passer par le menu */}
                {debt > 0 && perm.modifier && (
                  <button
                    onClick={() => setPaying(c)}
                    className="w-full h-11 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-[9px] font-black uppercase tracking-widest italic flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 hover:scale-[1.02] active:scale-95 transition-all"
                  >
                    <DollarSign className="w-4 h-4 text-yellow-300" /> Payer la Dette
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <ContactModal biz={biz} coll="clients" open={showForm} onClose={() => setShowForm(false)} initial={editing} />

      {dossier && (
        <BizClientDossier
          key={dossier.client.id}
          client={dossier.client} moduleKey={moduleKey} partLabel={cfg.label}
          settings={settings} initialSection={dossier.section}
          onClose={() => setDossier(null)}
          onReport={() => { setReport(dossier.client); setDossier(null); }}
          onPayDebt={perm.modifier ? () => { setPaying(dossier.client); setDossier(null); } : undefined}
        />
      )}

      {report && (
        <BizClientReport
          client={report} moduleKey={moduleKey} partLabel={cfg.label}
          settings={settings} onClose={() => setReport(null)} />
      )}

      {/* Encaisser la dette d’un client — le montant est réparti sur ses documents
          non soldés, du plus ancien au plus récent (`settleDebt`). Les totaux
          affichés sont ceux de SON relevé : le reste proposé est exactement le
          reste dû que montre sa carte. */}
      {paying && (
        <PayDebtModal
          open
          onClose={() => setPaying(null)}
          title={`Payer la dette — ${paying.name}`}
          total={statements[paying.id]?.totals.charged || 0}
          alreadyPaid={statements[paying.id]?.totals.paid || 0}
          onPay={(amount, meta) => settleDebt(paying, amount, meta)}
        />
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
  client, moduleKey, partLabel, settings, initialSection, onClose, onReport, onPayDebt,
}: {
  client: BizContact; moduleKey: ModuleKey; partLabel: string; settings: any;
  initialSection: string; onClose: () => void; onReport: () => void;
  /** Encaisser la dette depuis la rubrique « Règlements » — comme au Carburant. */
  onPayDebt?: () => void;
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
      onPayDebt={onPayDebt}
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
