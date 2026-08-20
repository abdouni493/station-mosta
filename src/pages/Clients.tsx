import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { 
  Plus, 
  Search, 
  CreditCard, 
  Wallet, 
  History, 
  AlertCircle, 
  Edit2, 
  Trash2, 
  Eye, 
  X, 
  Phone, 
  CheckCircle2, 
  TrendingUp, 
  FileText, 
  Printer, 
  ArrowUpRight, 
  ArrowDownRight,
  Download,
  Building2,
  User as UserIcon,
  ChevronRight,
  Upload,
  Save,
  AlertTriangle,
  ShieldCheck,
  DollarSign,
  Calendar,
  Lock,
  Filter,
  Clock,
  Grid,
  List as ListIcon,
  ChevronDown,
  Loader2,
  MoreVertical,
  Mail,
  FileBarChart
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, newId, matchesSearch } from "@/src/lib/utils";
import { useAppState, useAppDispatch, useModulePermission, Client, bankBalanceOf, TreasuryTransaction, CAISSE_PART_ID } from "../store/AppContext";
import { useNavigate } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import { printPaymentReceipt, stationFromSettings } from "./modules/_shared";
import { clientLedger, clientLedgers, advanceAvailable, advanceColumnsDisagree, ClientEntry, ClientLedger } from "../lib/clientLedger";
import { fuelClientStatement } from "../lib/clientStatement";
import ClientReportModal from "../components/biz/ClientReportModal";
import { ClientStatementFiche } from "../components/biz/ClientStatementFiche";
import { printFiche } from "../components/biz/ReportFiche";
import ClientDossier from "../components/clients/ClientDossier";

/** Receipt number of a debt payment, derived from its transaction id. */
const receiptRef = (txId: string) => `REG-${txId.slice(0, 8).toUpperCase()}`;

const PAYMENT_MODE_LABEL: Record<string, string> = {
  ESPECES: "Espèces", CHEQUE: "Chèque", VIREMENT: "Virement", TPE: "Carte / TPE",
  CREDIT: "À crédit", AVANCE: "Sur avance", CASH: "Espèces", BON: "Bon",
};

/** Le mode de règlement d'un client, dit en français. */
const MODE_LABEL: Record<string, string> = {
  CASH: 'Comptant', CREDIT: 'À crédit', ADVANCE: 'Sur avance',
};

/**
 * Ce qu'un client peut régler aujourd'hui.
 *
 * Deux chiffres racontent sa dette : la colonne `debt` de sa fiche — un compteur
 * tenu au fil de l'eau — et ce que ses PIÈCES disent. Le second fait foi
 * partout à l'écran ; mais tant qu'ils diffèrent (reprise d'ouverture, brigade
 * corrigée après coup), plafonner la saisie au plus petit des deux reviendrait
 * à refuser un règlement que le client est venu payer. On retient donc le plus
 * grand : c'est une borne de saisie, pas un montant imposé.
 */
const payableDebt = (client: Client | null, ledger: ClientLedger): number =>
  Math.max(0, Math.max(client?.debt || 0, ledger.debtFromDocuments));

const Clients = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useAppState();
  const { clients, settings, currentUserName, bankAccounts, treasuryTransactions } = state;
  const perm = useModulePermission('Clients');
  const dispatch = useAppDispatch();

  // Bank accounts with their live solde — used to route a TPE (card) règlement
  // to the account behind the terminal, exactly like the « Comptes Bancaires » screen.
  const liveBankAccounts = useMemo(
    () => bankAccounts.map(a => ({ ...a, balance: bankBalanceOf(a, treasuryTransactions) })),
    [bankAccounts, treasuryTransactions],
  );

  // Layout and filter states
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState("Tous");
  const [selectedMode, setSelectedMode] = useState("Tous");
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);

  // Modals state
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showRecharge, setShowRecharge] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showFiscalSection, setShowFiscalSection] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("resume");
  /** Client dont on édite le relevé de compte sur une période choisie. */
  const [reportClient, setReportClient] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  /** La feuille A4 du relevé, imprimée depuis le dossier. */
  const dossierFicheRef = React.useRef<HTMLDivElement>(null);

  // Form States
  const [clientForm, setClientForm] = useState<Partial<Client>>({
    name: "",
    type: "PARTICULIER",
    paymentMode: "CASH",
    phone: "",
    email: "",
    cin: "",
    address: "",
    contactPerson: "",
    creditLimit: 0,
    paymentDelay: 0,
    balance: 0,
    debt: 0,
    nif: "",
    nis: "",
    article: "",
    rc: ""
  });

  const [rechargeForm, setRechargeForm] = useState({
    amount: 0,
    date: new Date().toISOString().split("T")[0],
    // Une recharge est de l'argent que le client REMET : elle doit dire par quel
    // moyen, sinon on ne sait pas dans quel compte le déposer.
    mode: "ESPECES",
    bankAccountId: "",
    chequeNumber: "",
    notes: "",
    receiptPhoto: ""
  });

  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    date: new Date().toISOString().split("T")[0],
    mode: "ESPECES",
    chequeNumber: "",
    bankAccountId: "",
    notes: ""
  });

  const [showAppointmentForm, setShowAppointmentForm] = useState(false);
  const [appointmentForm, setAppointmentForm] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: 0,
    linkedSaleId: "",
    notes: ""
  });

  // Close actions dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = () => setActionMenuOpen(null);
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  // The opened client is a local snapshot: re-sync it whenever the store moves,
  // so a règlement saved from a modal shows the debt and the history the server
  // actually holds (the payment is re-read from `client_transactions`).
  useEffect(() => {
    setSelectedClient(prev => (prev ? clients.find(c => c.id === prev.id) ?? prev : prev));
  }, [clients]);

  const handleSaveClient = () => {
    if (!clientForm.name) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Le nom est obligatoire" } });
      return;
    }

    if (clientForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientForm.email)) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Email invalide" } });
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      if (selectedClient) {
        dispatch({ type: 'UPDATE_CLIENT', payload: { ...selectedClient, ...clientForm } as Client });
        dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Client mis à jour" } });
      } else {
        const opening = clientForm.paymentMode === "ADVANCE" ? (clientForm.balance || 0) : 0;
        const newClient: Client = {
          ...clientForm as Client,
          id: newId(),
          // Les deux colonnes de l'avance partent de la MÊME valeur : sinon un
          // client naissait avec un solde d'ouverture que la consommation des
          // bons ne pouvait pas entamer.
          balance: opening,
          advanceBalance: opening,
          debt: clientForm.paymentMode === "CREDIT" ? (clientForm.debt || 0) : 0,
          transactionHistory: []
        };
        dispatch({ type: 'ADD_CLIENT', payload: newClient });
        dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Client ajouté" } });
      }
      setIsLoading(false);
      setShowModal(false);
    }, 800);
  };

  const handleDeleteClient = () => {
    if (!clientToDelete) return;
    setIsLoading(true);

    setTimeout(() => {
      dispatch({ type: 'DELETE_CLIENT', payload: clientToDelete.id });
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Client supprimé" } });
      setIsLoading(false);
      setClientToDelete(null);
    }, 800);
  };

  /**
   * Recharge d'avance. `ADD_CLIENT_PAYMENT` is used (and not `UPDATE_CLIENT`)
   * because it is the only action that writes the movement to the
   * `client_transactions` table — `UPDATE_CLIENT` persists the client columns
   * only, so the history would be lost on the next reload.
   */
  const handleRecharge = () => {
    if (!selectedClient || rechargeForm.amount <= 0) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Montant invalide" } });
      return;
    }
    // Payée autrement qu'en espèces, la recharge atterrit sur un compte
    // bancaire : sans compte choisi, l'argent n'irait nulle part.
    //
    // En espèces, elle tombe dans le coffre du CARBURANT — pas dans le tiroir
    // commun. C'est l'activité qui tient ce client, c'est donc sa caisse qui
    // grossit ; la caisse générale, elle, est la somme des trois activités
    // (voir `Caisse Générale`), l'argent y est donc compté de toute façon.
    const rechargeAccount = rechargeForm.mode === 'ESPECES'
      ? CAISSE_PART_ID.carburant
      : rechargeForm.bankAccountId;
    if (!rechargeAccount) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Choisissez le compte bancaire qui reçoit la recharge" } });
      return;
    }

    const payment = {
      id: newId(),
      date: rechargeForm.date,
      type: "RECHARGE" as const,
      amount: rechargeForm.amount,
      mode: rechargeForm.mode,
      receiptNumber: rechargeForm.chequeNumber || undefined,
      receiptPhoto: rechargeForm.receiptPhoto,
      notes: rechargeForm.notes,
    };

    dispatch({ type: 'ADD_CLIENT_PAYMENT', payload: { clientId: selectedClient.id, payment } });

    // ── La recharge entre dans la trésorerie ────────────────────────────────
    // Le client vient de remettre de l'argent : il doit arriver quelque part.
    // Aucune ligne n'était écrite — la station encaissait une avance sans que
    // la moindre caisse ne bouge, et le tiroir était plus plein que le solde
    // affiché. Même route qu'un règlement de dette.
    const rechargeTx: TreasuryTransaction = {
      id: newId(),
      date: new Date(rechargeForm.date).toISOString(),
      kind: 'SALE',
      amount: rechargeForm.amount,
      description: [
        `Recharge avance client — ${selectedClient.name}`,
        PAYMENT_MODE_LABEL[rechargeForm.mode] || rechargeForm.mode,
      ].filter(Boolean).join(' · '),
      accountTo: rechargeAccount,
      part: 'carburant',
      refType: 'client_payment',
      refId: payment.id,
      chequeNumber: rechargeForm.mode === 'CHEQUE' ? (rechargeForm.chequeNumber || undefined) : undefined,
      createdBy: currentUserName,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_TREASURY_TX', payload: rechargeTx });

    const destinationLabel = rechargeForm.mode === 'ESPECES'
      ? 'la caisse Carburant'
      : (liveBankAccounts.find(a => a.id === rechargeAccount)?.name || 'le compte choisi');
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: `Avance rechargée sur ${destinationLabel} : +${rechargeForm.amount.toLocaleString()} DA` } });
    setShowRecharge(false);
    setSelectedClient({
      ...selectedClient,
      balance: selectedClient.balance + rechargeForm.amount,
      advanceBalance: (selectedClient.advanceBalance ?? selectedClient.balance) + rechargeForm.amount,
      transactionHistory: [...(selectedClient.transactionHistory || []), payment],
    });
    setRechargeForm({
      amount: 0, date: new Date().toISOString().split("T")[0],
      mode: "ESPECES", bankAccountId: liveBankAccounts[0]?.id || "", chequeNumber: "",
      notes: "", receiptPhoto: "",
    });
  };

  /**
   * Prints the receipt of one debt payment. `debtBefore` is only known for the
   * payment being recorded right now; on a reprint of an older règlement the
   * encours has moved since, so the before/after block is simply left out
   * rather than reconstructed from an approximation.
   */
  const printReceipt = (client: Client, tx: NonNullable<Client['transactionHistory']>[number], debtBefore?: number) => {
    printPaymentReceipt({
      title: "Reçu de règlement",
      ref: receiptRef(tx.id),
      date: tx.date,
      station: stationFromSettings(settings),
      party: {
        label: "Client",
        name: client.name,
        phone: client.phone,
        address: client.address,
      },
      info: [
        { label: "Mode de règlement", value: PAYMENT_MODE_LABEL[tx.mode || ''] || tx.mode || 'Espèces' },
        { label: "Référence", value: tx.receiptNumber || '' },
        { label: "Encaissé par", value: currentUserName || '' },
        { label: "CIN / ID", value: client.cin || '' },
      ],
      amount: tx.amount,
      mode: PAYMENT_MODE_LABEL[tx.mode || ''] || tx.mode || 'Espèces',
      reference: tx.receiptNumber,
      debtBefore,
      debtAfter: debtBefore === undefined ? undefined : Math.max(0, debtBefore - tx.amount),
      notes: tx.notes,
    });
  };

  /**
   * Règlement de la dette du client. The debt is held globally on the client
   * (there is no per-facture payment column), so a payment always lowers the
   * global encours; when it was started from an invoice row, that invoice is
   * quoted on the receipt as the reason for the payment.
   */
  const handleRecordPayment = (andPrint = false) => {
    if (!selectedClient || paymentForm.amount <= 0) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Montant invalide" } });
      return;
    }
    if (paymentForm.amount > payableDebt(selectedClient, ledger)) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Le montant dépasse la dette du client" } });
      return;
    }
    // A TPE règlement is cashed on a bank account (the terminal's account): the
    // account must be chosen so the money lands somewhere in the ledger.
    const tpeAccount = paymentForm.mode === "TPE"
      ? liveBankAccounts.find(a => a.id === paymentForm.bankAccountId)
      : undefined;
    if (paymentForm.mode === "TPE" && !tpeAccount) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Choisissez le compte bancaire du TPE" } });
      return;
    }
    // Un chèque ou un virement atterrit sur un compte : sans compte choisi,
    // AUCUNE ligne de trésorerie n'était écrite. La dette disparaissait et
    // l'argent avec — ni la caisse ni la banque ne le voyaient jamais arriver.
    if ((paymentForm.mode === "CHEQUE" || paymentForm.mode === "VIREMENT") && !paymentForm.bankAccountId) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Choisissez le compte bancaire qui reçoit le règlement" } });
      return;
    }

    // L'opération d'origine, citée sur le reçu quand le règlement a été lancé
    // depuis une ligne du journal du client.
    const invoiceRef = selectedSale
      ? (selectedSale.label || `Facture #${String(selectedSale.id || '').substring(0, 8).toUpperCase()}`)
      : '';
    const tpeRef = tpeAccount ? `TPE ${tpeAccount.name}` : '';
    const payment = {
      id: newId(),
      date: paymentForm.date,
      type: "PAYMENT" as const,
      amount: paymentForm.amount,
      mode: paymentForm.mode,
      receiptNumber: paymentForm.chequeNumber,
      notes: [invoiceRef, tpeRef, paymentForm.notes].filter(Boolean).join(' — '),
    };
    const debtBefore = selectedClient.debt;

    dispatch({ type: 'ADD_CLIENT_PAYMENT', payload: { clientId: selectedClient.id, payment } });

    // ── Le règlement entre dans le grand livre, QUEL QUE SOIT son mode ────────
    // Seul le TPE écrivait sa ligne : un client qui réglait sa dette en espèces
    // faisait disparaître la créance sans que l'argent n'arrive nulle part. La
    // caisse restait donc plus basse que le tiroir, et le rapport annonçait un
    // découvert. Chaque mode atterrit maintenant sur son compte : la caisse pour
    // les espèces, le compte bancaire choisi pour le TPE, le chèque et le virement.
    const destination = tpeAccount
      ? tpeAccount.id
      : paymentForm.mode === 'ESPECES'
        // Le coffre du CARBURANT, pas le tiroir commun : c'est l'activité qui
        // tient ce client, et c'est sa caisse que le règlement doit remplir.
        ? CAISSE_PART_ID.carburant
        : (paymentForm.bankAccountId || undefined);
    const destinationLabel = tpeAccount
      ? tpeAccount.name
      : paymentForm.mode === 'ESPECES'
        ? 'la caisse Carburant'
        : (liveBankAccounts.find(a => a.id === destination)?.name || 'aucun compte');

    if (destination) {
      const tx: TreasuryTransaction = {
        id: newId(),
        date: new Date(paymentForm.date).toISOString(),
        kind: tpeAccount ? 'TPE' : 'SALE',
        amount: paymentForm.amount,
        description: [
          `Règlement dette client — ${selectedClient.name}`,
          invoiceRef,
          PAYMENT_MODE_LABEL[paymentForm.mode] || paymentForm.mode,
        ].filter(Boolean).join(' · '),
        accountTo: destination,
        part: 'carburant',
        refType: 'client_payment',
        refId: payment.id,
        chequeNumber: paymentForm.mode === 'CHEQUE' ? (paymentForm.chequeNumber || undefined) : undefined,
        createdBy: currentUserName,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_TREASURY_TX', payload: tx });
    }

    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: destination
      ? `Règlement encaissé sur ${destinationLabel} : -${paymentForm.amount.toLocaleString()} DA`
      : `Règlement enregistré: -${paymentForm.amount.toLocaleString()} DA` } });

    const updatedClient: Client = {
      ...selectedClient,
      debt: Math.max(0, debtBefore - paymentForm.amount),
      transactionHistory: [...(selectedClient.transactionHistory || []), payment],
    };
    setSelectedClient(updatedClient);
    if (andPrint) printReceipt(updatedClient, payment, debtBefore);

    setShowPayment(false);
    setSelectedSale(null);
    setPaymentForm({ amount: 0, date: new Date().toISOString().split("T")[0], mode: "ESPECES", chequeNumber: "", bankAccountId: "", notes: "" });
  };

  /** Opens the debt modal for one client — global debt, no invoice attached. */
  const openDebtPayment = (client: Client) => {
    setSelectedClient(client);
    setSelectedSale(null);
    setPaymentForm({
      // Ce que ses PIÈCES réclament, pas le compteur de sa fiche.
      amount: Math.max(0, ledgers[client.id]?.debtFromDocuments ?? client.debt),
      date: new Date().toISOString().split("T")[0],
      mode: "ESPECES", chequeNumber: "", bankAccountId: liveBankAccounts[0]?.id || "", notes: "",
    });
    setShowPayment(true);
  };

  const handleSaveAppointment = () => {
    if (!selectedClient || !appointmentForm.amount || appointmentForm.amount <= 0) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Veuillez remplir tous les champs" } });
      return;
    }

    const newAppointment = {
      id: newId(),
      date: appointmentForm.date,
      amount: appointmentForm.amount,
      linkedSaleId: appointmentForm.linkedSaleId || null,
      notes: appointmentForm.notes,
      isPaid: false,
      createdAt: new Date().toISOString()
    };

    const updatedClient: Client = {
      ...selectedClient,
      appointments: [
        ...(selectedClient.appointments || []),
        newAppointment
      ]
    };

    dispatch({ type: 'UPDATE_CLIENT', payload: updatedClient });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: `Rendez-vous créé: ${appointmentForm.amount.toLocaleString()} DA` } });
    setShowAppointmentForm(false);
    setAppointmentForm({
      date: new Date().toISOString().split("T")[0],
      amount: 0,
      linkedSaleId: "",
      notes: ""
    });
    setSelectedClient(updatedClient);
  };

  const handleMarkAppointmentPaid = (appointmentId: string) => {
    if (!selectedClient) return;

    const updatedClient: Client = {
      ...selectedClient,
      appointments: selectedClient.appointments?.map(a => 
        a.id === appointmentId ? { ...a, isPaid: true } : a
      ) || []
    };

    dispatch({ type: 'UPDATE_CLIENT', payload: updatedClient });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Rendez-vous marqué comme payé" } });
    setSelectedClient(updatedClient);
  };

  /**
   * TOUT ce qui touche le compte du client, reconstruit sur ses pièces
   * (`lib/clientLedger`) : bons carburant pris sur les brigades, factures
   * magasin, règlements et recharges d'avance.
   *
   * L'écran lisait auparavant `fuelSales` — une table que plus rien n'alimente —
   * et filtrait les ventes magasin sur `paymentMode === client.id`, une
   * comparaison qui ne pouvait jamais être vraie. D'où un historique vide pour
   * tous les clients, quelle que soit leur activité.
   */
  const ledger = useMemo(
    () => clientLedger(state, selectedClient?.id || ''),
    [state, selectedClient?.id]);

  /**
   * Le compte de CHAQUE client, pour la liste.
   *
   * Les cartes annonçaient l'avance et la dette lues sur les colonnes de la
   * fiche — des compteurs tenus à la main, que rien ne rapproche des pièces.
   * Elles lisent maintenant le même journal que le dossier : ce qui est affiché
   * en couverture est exactement ce qu'on retrouve en l'ouvrant.
   *
   * Le calcul ne dépend que des tables qui l'alimentent : le recalculer à chaque
   * frappe dans le champ de recherche n'aurait aucun sens.
   */
  const ledgers = useMemo(
    () => clientLedgers(state),
    [state.clients, state.brigades, state.brigadeAccountings, state.shopSales, state.fuelSales]);

  /** Ce que le client a CONSOMMÉ — bons, factures magasin, ventes anciennes. */
  const clientPurchases = useMemo(
    () => ledger.entries.filter((e: ClientEntry) => e.kind === 'bon' || e.kind === 'magasin' || e.kind === 'vente'),
    [ledger]);

  /**
   * Le relevé complet du client ouvert — la forme que le dossier partagé sait
   * lire, et celle que la feuille A4 imprime. Sans bornes : un dossier montre la
   * vie ENTIÈRE du compte, c'est le rapport qui restreint.
   */
  const dossierStatement = useMemo(
    // Fermé, le dossier ne coûte rien : inutile de relire toutes les brigades à
    // chaque mouvement de l'application pour un écran que personne ne regarde.
    () => fuelClientStatement(state, showDetail ? selectedClient : null),
    [state, selectedClient, showDetail]);

  /**
   * Le relevé de compte du client, borné à la période demandée par le rapport.
   * Il repart des mêmes pièces que le journal : ce qui s'imprime est exactement
   * ce que l'écran montre, jamais un second calcul.
   */
  const buildReport = useCallback(
    (from: string, to: string) => fuelClientStatement(state, reportClient, from, to),
    [state, reportClient]);

  /** L'avance encore disponible — la même règle que la liste des clients. */
  const advanceLeft = advanceAvailable(selectedClient);
  /**
   * Les clients enregistrés avant que les deux colonnes de l'avance ne soient
   * synchronisées en gardent deux valeurs différentes. On le DIT au lieu de
   * choisir en silence : c'est une reprise à faire, pas un calcul à deviner.
   */
  const advanceGap = advanceColumnsDisagree(selectedClient);

  /** Les blocs d'identité de la rubrique « Fiche » du dossier. */
  const dossierIdentity = useMemo(() => {
    const c = selectedClient;
    if (!c) return [];
    return [
      {
        title: 'Identité et coordonnées',
        icon: UserIcon,
        rows: [
          { label: 'Raison sociale / Nom', value: c.name },
          { label: 'Type de client', value: c.type },
          { label: 'Personne à contacter', value: c.contactPerson },
          { label: 'Téléphone', value: c.phone },
          { label: 'E-mail', value: c.email },
          { label: 'CIN / Identifiant', value: c.cin },
          { label: 'Adresse', value: c.address },
        ],
      },
      {
        title: 'Conditions commerciales',
        icon: ShieldCheck,
        rows: [
          { label: 'Mode de règlement', value: MODE_LABEL[c.paymentMode] || c.paymentMode },
          { label: 'Plafond de crédit', value: c.creditLimit ? `${c.creditLimit.toLocaleString()} DA` : undefined },
          { label: 'Délai de paiement', value: c.paymentDelay ? `${c.paymentDelay} jour(s)` : undefined },
          {
            label: 'Encours enregistré', value: `${(c.debt || 0).toLocaleString()} DA`,
            hint: "le compteur de la fiche — les pièces font foi",
          },
          {
            label: "Reste dû d'après les pièces", value: `${ledger.debtFromDocuments.toLocaleString()} DA`,
            hint: `${ledger.chargedOnCredit.toLocaleString()} à crédit − ${ledger.paid.toLocaleString()} réglés`,
          },
          {
            label: "Avance disponible", value: `${advanceLeft.toLocaleString()} DA`,
            hint: `${ledger.recharged.toLocaleString()} déposés − ${ledger.chargedOnAdvance.toLocaleString()} consommés`,
          },
        ],
      },
      {
        title: 'Fiscalité et registre',
        icon: FileText,
        rows: [
          { label: 'NIF', value: c.nif },
          { label: 'NIS', value: c.nis },
          { label: "Article d'imposition", value: c.article },
          { label: 'Registre du commerce', value: c.rc },
        ],
      },
    ];
  }, [selectedClient, ledger, advanceLeft]);

  /** La rubrique « Rendez-vous » du dossier — propre au Carburant. */
  const renderAppointments = () => {
    if (!selectedClient) return null;
    const appts = [...(selectedClient.appointments || [])]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const due = appts.filter(a => !a.isPaid).reduce((s, a) => s + (a.amount || 0), 0);
    return (
      <div className="space-y-4 not-italic">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Échéances non encore réglées</p>
            <p className="text-xl font-black tabular-nums text-[#002d87]">{due.toLocaleString()} DA</p>
            <p className="text-[11px] font-semibold text-slate-400">
              {appts.filter(a => !a.isPaid).length} à venir sur {appts.length} programmé(s)
            </p>
          </div>
          {perm.modifier && (
            <button
              onClick={() => setShowAppointmentForm(!showAppointmentForm)}
              className="btn-primary !py-2 !px-4 text-xs flex items-center gap-2"
            >
              <Plus className="w-3.5 h-3.5" /> {showAppointmentForm ? "Fermer le formulaire" : "Programmer un paiement"}
            </button>
          )}
        </div>

        {showAppointmentForm && (
          <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-4 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="label-field">Date d'échéance</label>
                <input type="date" value={appointmentForm.date}
                  onChange={(e) => setAppointmentForm({ ...appointmentForm, date: e.target.value })}
                  className="input-field font-bold" />
              </div>
              <div className="space-y-1.5">
                <label className="label-field">Montant attendu (DA)</label>
                <input type="number" value={appointmentForm.amount}
                  onChange={(e) => setAppointmentForm({ ...appointmentForm, amount: parseFloat(e.target.value) || 0 })}
                  className="input-field font-bold" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <label className="label-field">Opération concernée (optionnel)</label>
                <select value={appointmentForm.linkedSaleId}
                  onChange={(e) => setAppointmentForm({ ...appointmentForm, linkedSaleId: e.target.value })}
                  className="input-field font-bold">
                  <option value="">Sélectionner une opération…</option>
                  {/* Seules les consommations qui ont laissé une dette peuvent
                      motiver un rendez-vous : un bon pris sur l'avance est déjà payé. */}
                  {clientPurchases.filter((e: ClientEntry) => e.debtEffect > 0).map((e: ClientEntry) => (
                    <option key={e.id} value={e.id}>
                      {e.label} — {e.date ? new Date(e.date).toLocaleDateString() : "—"} ({e.debtEffect.toLocaleString()} DA)
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="label-field">Notes</label>
                <input type="text" value={appointmentForm.notes}
                  onChange={(e) => setAppointmentForm({ ...appointmentForm, notes: e.target.value })}
                  placeholder="Instructions, interlocuteur…" className="input-field font-bold" />
              </div>
            </div>
            <button onClick={handleSaveAppointment} className="btn-primary w-full flex items-center justify-center gap-2">
              <Calendar className="w-4 h-4" /> Programmer le rendez-vous
            </button>
          </div>
        )}

        {appts.length === 0 ? (
          <div className="p-10 text-center bg-white rounded-2xl border border-slate-200">
            <Calendar className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-bold text-slate-400">Aucun rendez-vous de paiement programmé</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {appts.map(appt => {
              const isLate = new Date(appt.date) < new Date() && !appt.isPaid;
              return (
                <div key={appt.id}
                  className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border",
                    isLate ? "bg-red-50/60 border-red-100" : appt.isPaid ? "bg-emerald-50/40 border-emerald-100" : "bg-white border-slate-200")}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border shrink-0",
                      isLate ? "bg-red-100 text-red-600 border-red-200"
                        : appt.isPaid ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : "bg-blue-100 text-blue-900 border-blue-200")}>
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {new Date(appt.date).toLocaleDateString()}
                        {appt.linkedSaleId ? ` · opération ${appt.linkedSaleId.substring(0, 8).toUpperCase()}` : ''}
                      </p>
                      <p className={cn("text-base font-black tabular-nums",
                        isLate ? "text-red-600" : appt.isPaid ? "text-emerald-700" : "text-[#002d87]")}>
                        {appt.amount.toLocaleString()} DA
                      </p>
                      {appt.notes && <p className="text-[11px] text-slate-400 font-semibold truncate">{appt.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("text-[9px] font-black px-2.5 py-1 rounded-full border uppercase tracking-wider",
                      isLate ? "bg-red-100 text-red-700 border-red-200"
                        : appt.isPaid ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200")}>
                      {isLate ? "En retard" : appt.isPaid ? "Payé" : "À venir"}
                    </span>
                    {!appt.isPaid && perm.modifier && (
                      <button onClick={() => handleMarkAppointmentPaid(appt.id)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all">
                        Marquer payé
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Filtering Logic
  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const matchesQuery = matchesSearch(searchTerm, c.name, c.phone, c.email, c.cin);

      const matchesType = selectedType === "Tous" || c.type === selectedType;
      const matchesMode = selectedMode === "Tous" || c.paymentMode === selectedMode;
      
      return matchesQuery && matchesType && matchesMode;
    });
  }, [clients, searchTerm, selectedType, selectedMode]);

  const TypeBadge = ({ type }: { type: string }) => (
    <span className={cn(
      "text-[8px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm leading-none border inline-block",
      type === "ENTREPRISE" ? "bg-blue-50 text-blue-700 border-blue-100" :
      type === "GOUVERNEMENT" ? "bg-slate-50 text-slate-700 border-slate-100" : "bg-purple-50 text-purple-700 border-purple-100"
    )}>
      {type}
    </span>
  );

  const ModeBadge = ({ mode }: { mode: string }) => (
    <span className={cn(
      "text-[8px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm leading-none border inline-block",
      mode === "CREDIT" ? "bg-red-50 text-red-700 border-red-100" :
      mode === "ADVANCE" ? "bg-green-50 text-green-700 border-green-100" : "bg-slate-50 text-slate-500 border-slate-100"
    )}>
      {mode}
    </span>
  );

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12 italic text-left">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-blue-900 uppercase italic tracking-tighter leading-none">Gestion des Clients</h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">Gérez vos comptes clients, crédits et avances de fonds.</p>
        </div>
        {perm.creer && (
        <button
          onClick={() => { 
            setSelectedClient(null); 
            setClientForm({ 
              name: "",
              type: "PARTICULIER", 
              paymentMode: "CASH", 
              balance: 0, 
              debt: 0,
              phone: "",
              email: "",
              cin: "",
              address: "",
              contactPerson: "",
              creditLimit: 0,
              paymentDelay: 0,
              nif: "",
              nis: "",
              article: "",
              rc: ""
            }); 
            setShowModal(true); 
          }}
          className="h-14 px-8 bg-gradient-to-r from-[#001f5c] via-[#002d85] to-[#001f5c] text-[#FFB800] border border-blue-900 hover:border-[#FFB800] rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-blue-950/20 hover:scale-105 transition-all flex items-center gap-3 italic"
        >
          <Plus className="w-5 h-5 text-[#FFB800]" /> NOUVEAU CLIENT
        </button>
        )}
      </div>

      {/* Filters Toolbar */}
      <div className="p-6 border border-slate-100 rounded-3xl flex flex-wrap items-center justify-between gap-6 bg-white shadow-sm italic">
        <div className="flex items-center gap-4 flex-1 min-w-[300px]">
          <div className="relative flex-1">
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
            <input 
              type="text" 
              placeholder="Rechercher par nom, téléphone, CIN..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-14 pr-6 h-14 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none shadow-inner text-blue-900 placeholder-slate-400"
            />
          </div>
          <select 
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="input-field h-14 w-40 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none shadow-inner px-6 text-blue-900 italic"
          >
            <option value="Tous">Tous les types</option>
            <option value="PARTICULIER">Particulier</option>
            <option value="ENTREPRISE">Entreprise</option>
            <option value="GOUVERNEMENT">Gouvernement</option>
          </select>
          <select 
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            className="input-field h-14 w-40 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none shadow-inner px-6 text-blue-900 italic"
          >
            <option value="Tous">Tous les modes</option>
            <option value="CASH">Cash</option>
            <option value="ADVANCE">Advance</option>
            <option value="CREDIT">Crédit</option>
          </select>
        </div>

        {/* View Mode Switcher */}
        <div className="flex gap-2 shrink-0">
          <button 
            onClick={() => setViewMode("grid")}
            className={cn("p-4 rounded-2xl border transition-all", viewMode === "grid" ? "bg-blue-900 text-white shadow-md border-blue-900" : "bg-white text-slate-400 border-slate-100 hover:bg-slate-50")}
          >
            <Grid className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setViewMode("table")}
            className={cn("p-4 rounded-2xl border transition-all", viewMode === "table" ? "bg-blue-900 text-white shadow-md border-blue-900" : "bg-white text-slate-400 border-slate-100 hover:bg-slate-50")}
          >
            <ListIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Grid or Table Display */}
      <AnimatePresence mode="wait">
        {viewMode === "grid" ? (
          <motion.div 
            key="grid"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filteredClients.length > 0 ? (
              filteredClients.map((c, index) => {
                // Le compte du client, relu sur ses pièces : c'est lui qui donne
                // les chiffres de la carte, jamais les colonnes de la fiche.
                const cl = ledgers[c.id] || clientLedger(state, c.id);
                const cDebt = cl.debtFromDocuments;
                return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.03 }}
                  className={cn(
                    "group relative bg-white rounded-3xl border hover:shadow-2xl transition-all p-6 space-y-4 italic flex flex-col",
                    actionMenuOpen === c.id ? "z-50 border-blue-300 ring-4 ring-blue-50 shadow-xl" : "z-10 border-slate-100 hover:border-blue-200 shadow-sm"
                  )}
                >
                  {/* Top Gradient Border */}
                  <div className="h-2 absolute top-0 left-0 right-0 rounded-t-3xl bg-gradient-to-r from-blue-900 via-blue-800 to-yellow-400" />
                  
                  {/* Type and Payment Mode Badges */}
                  <div className="absolute top-4 left-4 flex flex-col gap-1 items-start">
                    <TypeBadge type={c.type} />
                    <ModeBadge mode={c.paymentMode} />
                  </div>

                  {/* Actions Dropdown Button */}
                  <div className="absolute top-4 right-4">
                    <motion.button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionMenuOpen(actionMenuOpen === c.id ? null : c.id);
                      }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 group-hover:text-blue-900 transition-all bg-white/80 backdrop-blur-sm shadow-sm border border-slate-100"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </motion.button>

                    {/* Action list */}
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
                              onClick={() => { setSelectedClient(c); setActiveTab("resume"); setShowDetail(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <Eye className="w-4 h-4 text-slate-500" /> Dossier Client
                            </button>
                            {perm.modifier && (
                            <button
                              onClick={() => { setSelectedClient(c); setClientForm(c); setShowModal(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <Edit2 className="w-4 h-4 text-blue-500" /> Modifier
                            </button>
                            )}
                            {c.paymentMode === "ADVANCE" && (
                              <button 
                                onClick={() => { setSelectedClient(c); setShowRecharge(true); setActionMenuOpen(null); }}
                                className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                              >
                                <Wallet className="w-4 h-4 text-green-500" /> Recharger Avance
                              </button>
                            )}
                            {cDebt > 0 && perm.modifier && (
                              <button
                                onClick={() => { openDebtPayment(c); setActionMenuOpen(null); }}
                                className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 flex items-center gap-3 transition-colors"
                              >
                                <DollarSign className="w-4 h-4 text-emerald-500" /> Payer la Dette
                              </button>
                            )}
                            <button
                              onClick={() => { setSelectedClient(c); setActiveTab("journal"); setShowDetail(true); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                            >
                              <History className="w-4 h-4 text-slate-500" /> Historique Complet
                            </button>
                            <button
                              onClick={() => { setReportClient(c); setActionMenuOpen(null); }}
                              className="w-full px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-blue-900 hover:bg-blue-50 flex items-center gap-3 transition-colors"
                            >
                              <FileBarChart className="w-4 h-4 text-blue-600" /> Générer un Rapport
                            </button>
                            {perm.supprimer && (
                            <button
                              onClick={() => { setClientToDelete(c); setActionMenuOpen(null); }}
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

                  {/* Initial & Name Info */}
                  <div className="flex flex-col items-center text-center gap-3 pt-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-900 to-blue-800 text-yellow-400 rounded-2xl flex items-center justify-center text-2xl font-black shadow-lg uppercase border-2 border-white">
                      {c.name[0]}
                    </div>
                    <div>
                      <h4 className="font-black text-blue-900 uppercase tracking-tight text-sm mb-1">{c.name}</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">CIN/ICE: {c.cin || "N/A"}</p>
                    </div>
                  </div>

                  {/* Contacts info panel */}
                  <div className="space-y-2 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50/50 p-4 rounded-2xl border border-slate-100/50">
                    <div className="flex items-center gap-2.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      <span>{c.phone || "Non renseigné"}</span>
                    </div>
                    <div className="flex items-center gap-2.5 lowercase text-slate-500">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{c.email || "Non renseigné"}</span>
                    </div>
                  </div>

                  {/* ── Les chiffres de la carte ──────────────────────────
                      Ils se lisent l'un l'autre : consommé − payé = reste dû, et
                      tous trois viennent du MÊME journal que le dossier. Avant,
                      la carte annonçait la colonne `debt` de la fiche, un
                      compteur que rien ne rapprochait des pièces — d'où des
                      cartes qui ne disaient pas la même chose que l'historique. */}
                  <div className="pt-2 mt-auto border-t border-slate-100 grid grid-cols-3 gap-2">
                    <div className="text-center bg-slate-50/50 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-center">
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Consommé</p>
                      <p className="text-[10px] font-black text-blue-900 italic truncate">{cl.charged.toLocaleString()} DA</p>
                    </div>
                    <div className="text-center bg-slate-50/50 rounded-xl p-2.5 border border-slate-100 flex flex-col justify-center">
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Réglé</p>
                      <p className="text-[10px] font-black text-emerald-700 italic truncate">{cl.paid.toLocaleString()} DA</p>
                    </div>
                    <div className={cn("text-center rounded-xl p-2.5 border flex flex-col justify-center",
                      cDebt > 0 ? "bg-red-50/60 border-red-100" : "bg-emerald-50/50 border-emerald-100")}>
                      <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-1">Reste dû</p>
                      <p className={cn("text-[10px] font-black italic truncate", cDebt > 0 ? "text-red-600" : "text-emerald-600")}>
                        {cDebt.toLocaleString()} DA
                      </p>
                    </div>
                  </div>

                  {/* Avance, plafond et ce que le compte a d'anormal. */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[8px] font-black uppercase tracking-wider">
                    <span className="px-2 py-1 rounded-lg bg-green-50 text-green-700 border border-green-100">
                      Avance {advanceAvailable(c).toLocaleString()} DA
                    </span>
                    {c.creditLimit > 0 && (
                      <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-800 border border-blue-100">
                        Plafond {c.creditLimit.toLocaleString()} DA
                      </span>
                    )}
                    <span className="px-2 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-100">
                      {cl.entries.length} opé.
                    </span>
                    {c.creditLimit > 0 && cDebt > c.creditLimit && (
                      <span className="px-2 py-1 rounded-lg bg-red-50 text-red-700 border border-red-100 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Hors plafond
                      </span>
                    )}
                    {Math.abs(cl.debtGap) >= 1 && (
                      <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-100"
                        title={`La fiche annonce ${(c.debt || 0).toLocaleString()} DA, les pièces ${cl.debtFromDocuments.toLocaleString()} DA`}>
                        Écart {Math.abs(cl.debtGap).toLocaleString()} DA
                      </span>
                    )}
                  </div>

                  {/* Règlement de la dette — action directe, sans passer par le menu */}
                  {cDebt > 0 && perm.modifier && (
                    <button
                      onClick={() => openDebtPayment(c)}
                      className="w-full h-11 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 text-white text-[9px] font-black uppercase tracking-widest italic flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 hover:scale-[1.02] active:scale-95 transition-all"
                    >
                      <DollarSign className="w-4 h-4 text-yellow-300" /> Payer la Dette
                    </button>
                  )}
                </motion.div>
                );
              })
            ) : (
              <div className="col-span-full">
                <EmptyState 
                  icon={Building2}
                  title="Aucun client trouvé"
                  description="Ajustez vos filtres ou créez un nouveau client."
                  action={() => { setSelectedClient(null); setClientForm({ type: "PARTICULIER", paymentMode: "CASH" }); setShowModal(true); }}
                  actionLabel="AJOUTER UN CLIENT"
                />
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div 
            key="table"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
            className="card-glass overflow-hidden shadow-2xl border-slate-100 italic"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-blue-900 text-[10px] uppercase font-black tracking-[0.2em] italic border-b border-slate-100">
                  <tr>
                    <th className="px-8 py-6">Client</th>
                    <th className="px-8 py-6">Type / Mode</th>
                    <th className="px-8 py-6 text-right">Consommé</th>
                    <th className="px-8 py-6 text-right">Réglé</th>
                    <th className="px-8 py-6 text-right">Solde Avance</th>
                    <th className="px-8 py-6 text-right">Reste Dû</th>
                    <th className="px-8 py-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredClients.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState 
                          icon={Building2}
                          title="Aucun client trouvé"
                          description="Ajustez vos filtres ou créez un nouveau client."
                          action={() => { setSelectedClient(null); setClientForm({ type: "PARTICULIER", paymentMode: "CASH" }); setShowModal(true); }}
                          actionLabel="AJOUTER UN CLIENT"
                        />
                      </td>
                    </tr>
                  ) : filteredClients.map((c, index) => {
                    const cl = ledgers[c.id] || clientLedger(state, c.id);
                    const cDebt = cl.debtFromDocuments;
                    return (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.02 }}
                      className="group hover:bg-slate-50/50 border-b border-slate-100 transition-colors"
                    >
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center text-blue-900 font-black text-lg italic uppercase border border-slate-200">
                            {c.name[0]}
                          </div>
                          <div>
                            <span className="block font-black text-blue-900 uppercase italic tracking-tighter leading-none mb-1">{c.name}</span>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{c.phone || "N/A"}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex flex-col gap-1.5 items-start">
                          <TypeBadge type={c.type} />
                          <ModeBadge mode={c.paymentMode} />
                        </div>
                      </td>
                      {/* Consommé, réglé, reste : les trois se relisent, et
                          tous viennent du journal du client. */}
                      <td className="px-8 py-5 text-right font-black text-blue-900 text-base italic">
                        {cl.charged.toLocaleString()} <span className="text-[10px] opacity-40 italic">DA</span>
                        <span className="block text-[9px] font-bold text-slate-400 not-italic normal-case tracking-normal">
                          {cl.entries.length} opération(s)
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right font-black text-emerald-600 text-base italic">
                        {cl.paid.toLocaleString()} <span className="text-[10px] opacity-40 italic">DA</span>
                        <span className="block text-[9px] font-bold text-slate-400 not-italic normal-case tracking-normal">
                          {cl.counts.reglements} règlement(s)
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right font-black text-green-600 text-base italic">
                        {advanceAvailable(c).toLocaleString()} <span className="text-[10px] opacity-40 italic">DA</span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className={cn("font-black text-base italic leading-none", cDebt > 0 ? "text-red-500" : "text-slate-300")}>
                            {cDebt.toLocaleString()} <span className="text-[10px] opacity-40 italic">DA</span>
                          </span>
                          {c.creditLimit > 0 && cDebt > c.creditLimit && (
                            <span className="flex items-center gap-1 text-[8px] font-black uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded italic">
                              <AlertTriangle className="w-3 h-3" /> Hors Plafond
                            </span>
                          )}
                          {Math.abs(cl.debtGap) >= 1 && (
                            <span className="text-[8px] font-black uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded not-italic"
                              title={`La fiche annonce ${(c.debt || 0).toLocaleString()} DA`}>
                              Écart fiche {Math.abs(cl.debtGap).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {cDebt > 0 && perm.modifier && (
                            <button
                              onClick={() => openDebtPayment(c)}
                              title="Payer la dette"
                              className="px-3 py-2 mr-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[8px] font-black uppercase tracking-widest italic transition-all flex items-center gap-1.5 shadow-sm"
                            >
                              <DollarSign className="w-3.5 h-3.5 text-yellow-300" /> Payer
                            </button>
                          )}
                          <button onClick={() => { setSelectedClient(c); setActiveTab("journal"); setShowDetail(true); }} className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-300 hover:text-emerald-600 transition-all border border-transparent hover:border-slate-200" title="Historique complet du compte"><History className="w-4 h-4" /></button>
                          <button onClick={() => setReportClient(c)} className="p-2.5 hover:bg-blue-50 rounded-xl text-slate-300 hover:text-blue-700 transition-all border border-transparent hover:border-blue-100" title="Générer un rapport sur une période"><FileBarChart className="w-4 h-4" /></button>
                          <button onClick={() => { setSelectedClient(c); setActiveTab("resume"); setShowDetail(true); }} className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-300 hover:text-blue-900 transition-all border border-transparent hover:border-slate-200" title="Dossier complet du client"><Eye className="w-4 h-4" /></button>
                          {perm.modifier && <button onClick={() => { setSelectedClient(c); setClientForm(c); setShowModal(true); }} className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-300 hover:text-blue-600 transition-all border border-transparent hover:border-slate-200" title="Modifier"><Edit2 className="w-4 h-4" /></button>}
                          {perm.supprimer && <button onClick={() => setClientToDelete(c)} className="p-2.5 hover:bg-red-50 rounded-xl text-slate-200 hover:text-red-600 transition-all border border-transparent hover:border-red-100" title="Supprimer"><Trash2 className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create/Edit Modal (Matching Create New Brigade) */}
      <AnimatePresence>
        {showModal && (
          <div className="modal-shell z-[70] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl rounded-[3rem] relative z-10 flex flex-col max-h-[var(--modal-max-h)] overflow-hidden shadow-2xl border border-blue-200"
            >
              {/* Premium Gradient Header */}
              <div className="p-8 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white flex items-center justify-between shrink-0 border-b border-blue-900/10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/5 shadow-xl">
                    <UserIcon className="w-6 h-6 text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg uppercase tracking-tighter italic text-yellow-400">
                      {selectedClient ? "Modifier Profil Client" : "Nouveau Client"}
                    </h3>
                    <p className="text-[11px] text-blue-200 font-bold mt-1">Saisie des données administratives et financières</p>
                  </div>
                </div>
                <button onClick={() => setShowModal(false)} className="p-3 hover:bg-white/10 rounded-2xl transition-all"><X className="w-6 h-6 text-white" /></button>
              </div>

              {/* Scrollable Form Body */}
              <div className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column: Client Identity Card */}
                  <div className="p-8 bg-gradient-to-br from-blue-50 to-slate-50 rounded-[2.5rem] border-2 border-slate-100 space-y-6">
                    <h4 className="text-[10px] font-black text-blue-900 uppercase tracking-widest border-b pb-2">Identité Administrative</h4>
                    
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NOM OU RAISON SOCIALE</label>
                      <input 
                        type="text" 
                        value={clientForm.name} 
                        onChange={e => setClientForm({...clientForm, name: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Ex: SONATRACH / CLIENT PARTICULIER" 
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">TYPE DE CLIENT</label>
                        <select 
                          value={clientForm.type} 
                          onChange={e => setClientForm({...clientForm, type: e.target.value as any})} 
                          className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14"
                        >
                          <option value="PARTICULIER">Particulier</option>
                          <option value="ENTREPRISE">Entreprise</option>
                          <option value="GOUVERNEMENT">Gouvernement</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">TÉLÉPHONE</label>
                        <input 
                          type="text" 
                          value={clientForm.phone} 
                          onChange={e => setClientForm({...clientForm, phone: e.target.value})} 
                          className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                          placeholder="Ex: 0550 12 34 56" 
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ADRESSE EMAIL</label>
                      <input 
                        type="email" 
                        value={clientForm.email} 
                        onChange={e => setClientForm({...clientForm, email: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black lowercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="client@domaine.dz" 
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">CIN / IDENTIFIANT REGISTRE</label>
                      <input 
                        type="text" 
                        value={clientForm.cin} 
                        onChange={e => setClientForm({...clientForm, cin: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Numéro CIN ou ICE..." 
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ADRESSE DU DOMICILE / SIÈGE</label>
                      <input 
                        type="text" 
                        value={clientForm.address} 
                        onChange={e => setClientForm({...clientForm, address: e.target.value})} 
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-14" 
                        placeholder="Adresse postale..." 
                      />
                    </div>
                  </div>

                  {/* Right Column: Conditions and Financial details */}
                  <div className="p-8 bg-gradient-to-br from-blue-50 to-slate-50 rounded-[2.5rem] border-2 border-slate-100 space-y-6 flex flex-col">
                    <h4 className="text-[10px] font-black text-blue-900 uppercase tracking-widest border-b pb-2">Conditions Financières</h4>
                    
                    <div className="space-y-3">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">MODE DE PAIEMENT PAR DÉFAUT</label>
                      <div className="grid grid-cols-3 gap-2">
                        {["CASH", "ADVANCE", "CREDIT"].map(m => (
                          <button 
                            key={m}
                            type="button"
                            onClick={() => setClientForm({...clientForm, paymentMode: m as any})}
                            className={cn(
                              "p-4 rounded-2xl border-2 text-[9px] font-black uppercase tracking-widest transition-all italic",
                              clientForm.paymentMode === m ? "border-blue-900 bg-blue-100/50 text-blue-900" : "border-slate-100 bg-white text-slate-400 hover:bg-slate-50"
                            )}
                          >
                            {m === "CASH" ? "Comptant" : m === "ADVANCE" ? "Avance" : "Crédit"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mode specific parameters */}
                    <div className="flex-1 flex flex-col justify-center">
                      <AnimatePresence mode="wait">
                        {clientForm.paymentMode === "CREDIT" ? (
                          <motion.div 
                            key="credit" 
                            initial={{ opacity: 0, scale: 0.98 }} 
                            animate={{ opacity: 1, scale: 1 }} 
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="p-6 bg-red-50/50 rounded-2xl border border-red-100 space-y-4 w-full"
                          >
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Plafond Crédit Autorisé (DA)</label>
                              <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.creditLimit} onChange={e => setClientForm({...clientForm, creditLimit: parseFloat(e.target.value) || 0})} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Délai Contractuel de Règlement (Jours)</label>
                              <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.paymentDelay} onChange={e => setClientForm({...clientForm, paymentDelay: parseInt(e.target.value) || 0})} />
                            </div>
                            {!selectedClient && (
                              <div className="space-y-2">
                                <label className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">Encours/Dette Initial (DA)</label>
                                <input type="number" className="input-field bg-white border-red-100 text-red-950 font-black h-13 shadow-inner" value={clientForm.debt} onChange={e => setClientForm({...clientForm, debt: parseFloat(e.target.value) || 0})} />
                              </div>
                            )}
                          </motion.div>
                        ) : clientForm.paymentMode === "ADVANCE" ? (
                          <motion.div 
                            key="advance" 
                            initial={{ opacity: 0, scale: 0.98 }} 
                            animate={{ opacity: 1, scale: 1 }} 
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="p-6 bg-green-50/50 rounded-2xl border border-green-100 space-y-4 w-full"
                          >
                            {!selectedClient && (
                              <div className="space-y-2">
                                <label className="text-[9px] font-black text-green-700 uppercase tracking-widest ml-1">Versement Initial d'Avance (DA)</label>
                                <input type="number" className="input-field bg-white border-green-100 text-green-950 font-black h-13 shadow-inner" value={clientForm.balance} onChange={e => setClientForm({...clientForm, balance: parseFloat(e.target.value) || 0})} />
                              </div>
                            )}
                            <p className="text-[9px] font-bold text-green-700/70 italic leading-relaxed">
                              Les ventes et consommations boutique et carburant seront automatiquement imputées sur ce compte d'avance.
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div 
                            key="cash"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.4 }}
                            className="p-8 bg-slate-100 rounded-2xl flex flex-col items-center justify-center text-center italic space-y-3 w-full"
                          >
                            <ShieldCheck className="w-12 h-12 text-slate-500" />
                            <p className="text-[9px] font-black uppercase tracking-widest">Paiement comptant standard sans encours ni avance.</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Collapsible Fiscal Panel */}
                <div className="border-t border-slate-100 pt-6">
                  <button 
                    type="button"
                    onClick={() => setShowFiscalSection(!showFiscalSection)}
                    className="flex items-center justify-between w-full p-4 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-colors text-[10px] font-black text-slate-500 uppercase tracking-widest italic"
                  >
                    <span className="flex items-center gap-3"><Lock className="w-4 h-4 text-blue-950" /> Informations Fiscales & Commerciales (Optionnel)</span>
                    <ChevronDown className={cn("w-5 h-5 text-slate-400 transition-transform", showFiscalSection && "rotate-180")} />
                  </button>

                  <AnimatePresence>
                    {showFiscalSection && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden mt-4"
                      >
                        <div className="p-8 bg-gradient-to-br from-slate-50 to-blue-50/50 rounded-[2rem] border border-blue-100/50 space-y-4 grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NIF</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.nif || ""} onChange={e => setClientForm({...clientForm, nif: e.target.value})} placeholder="Numéro d'Identification Fiscale" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">NIS</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.nis || ""} onChange={e => setClientForm({...clientForm, nis: e.target.value})} placeholder="Numéro d'Identification Statistique" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">ARTICLE IMPOSITION</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.article || ""} onChange={e => setClientForm({...clientForm, article: e.target.value})} placeholder="Code Article d'imposition" />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">REGISTRE DE COMMERCE (RC)</label>
                            <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black uppercase text-xs tracking-widest shadow-inner h-13" value={clientForm.rc || ""} onChange={e => setClientForm({...clientForm, rc: e.target.value})} placeholder="Numéro Registre de Commerce" />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-8 bg-slate-50 border-t flex gap-6 shrink-0">
                <button onClick={() => setShowModal(false)} className="px-10 py-5 text-[11px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all italic underline underline-offset-8">Annuler</button>
                <button 
                  onClick={handleSaveClient} 
                  disabled={isLoading}
                  className="flex-1 h-16 bg-gradient-to-r from-blue-900 to-blue-800 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-2xl flex items-center justify-center gap-4 italic transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-yellow-400" /> : <Save className="w-5 h-5 text-yellow-400" />}
                  {isLoading ? "ENREGISTREMENT..." : "Enregistrer Profil"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Le dossier du client ───────────────────────────────────────────
          « Voir détails » et « Historique complet » ouvrent le MÊME dossier, à
          une rubrique différente : c'est le même compte, il n'y a aucune raison
          qu'il se raconte de deux façons. La mise en page est celle des
          Paramètres (voir `components/clients/ClientDossier`). */}
      {showDetail && selectedClient && (
        <ClientDossier
          key={selectedClient.id}
          open
          onClose={() => setShowDetail(false)}
          statement={dossierStatement}
          initialSection={activeTab}
          // Le règlement et la recharge s'ouvrent PAR-DESSUS le dossier (z-80) :
          // lancés depuis lui, ils doivent le recouvrir, sinon ils s'ouvrent
          // derrière et le bouton paraît ne pas répondre.
          zClass="z-[70]"
          recordedDebt={selectedClient.debt}
          creditLimit={selectedClient.creditLimit}
          badges={<>
            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-blue-100">
              {selectedClient.type}
            </span>
            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-blue-100">
              {MODE_LABEL[selectedClient.paymentMode] || selectedClient.paymentMode}
            </span>
            {selectedClient.cin && (
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-blue-100">
                CIN {selectedClient.cin}
              </span>
            )}
          </>}
          identity={dossierIdentity}
          advance={selectedClient.paymentMode === 'ADVANCE' || ledger.recharged > 0 ? {
            available: advanceLeft,
            recharged: ledger.recharged,
            used: ledger.chargedOnAdvance,
            gap: advanceGap,
            onRecharge: perm.modifier ? () => setShowRecharge(true) : undefined,
          } : undefined}
          extraSections={[{
            id: 'rdv',
            label: 'Rendez-vous',
            icon: Calendar,
            count: (selectedClient.appointments || []).length,
            hint: 'Les échéances de paiement convenues avec le client',
            render: () => renderAppointments(),
          }]}
          onPayDebt={perm.modifier ? () => openDebtPayment(selectedClient) : undefined}
          onSettleLine={perm.modifier ? (line) => {
            setSelectedSale({ id: line.id, label: line.label });
            setPaymentForm({
              amount: Math.min(line.debtEffect, payableDebt(selectedClient, ledger)),
              date: new Date().toISOString().split("T")[0],
              mode: "ESPECES", chequeNumber: "",
              bankAccountId: liveBankAccounts[0]?.id || "", notes: "",
            });
            setShowPayment(true);
          } : undefined}
          onPrintReceipt={(line) => {
            const tx = (selectedClient.transactionHistory || []).find(t => `pay-${t.id}` === line.id);
            if (tx) printReceipt(selectedClient, tx);
          }}
          onReport={() => { setReportClient(selectedClient); setShowDetail(false); }}
          onPrintStatement={() => printFiche(dossierFicheRef.current)}
        >
          {/* La feuille A4, hors écran : c'est elle que `printFiche` clone. */}
          <ClientStatementFiche ref={dossierFicheRef} statement={dossierStatement} settings={settings} />
        </ClientDossier>
      )}

      {/* Recharge Avance Modal */}
      <AnimatePresence>
        {showRecharge && selectedClient && (
          <div className="modal-shell z-[80] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowRecharge(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[var(--modal-max-h)] border border-blue-200"
            >
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <Wallet className="w-5 h-5 text-yellow-400" />
                  <h3 className="font-black uppercase italic text-yellow-400 font-black">Recharger l'Avance</h3>
                </div>
                <button onClick={() => setShowRecharge(false)} className="p-2 hover:bg-white/10 rounded-lg text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-white">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Montant de la recharge (DA)</label>
                  <input 
                    type="number" 
                    value={rechargeForm.amount} 
                    onChange={e => setRechargeForm({...rechargeForm, amount: parseFloat(e.target.value) || 0})}
                    className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-2xl h-16 text-center shadow-inner" 
                    placeholder="0.00"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Date</label>
                    <input type="date" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" value={rechargeForm.date} onChange={e => setRechargeForm({...rechargeForm, date: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Mode de règlement</label>
                    {/* Ce choix n'était relié à rien : la recharge était toujours
                        enregistrée sans mode, et sans ligne de trésorerie. */}
                    <select
                      className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-[10px] h-13 shadow-inner"
                      value={rechargeForm.mode}
                      onChange={e => setRechargeForm({ ...rechargeForm, mode: e.target.value })}
                    >
                      <option value="ESPECES">Espèces</option>
                      <option value="CHEQUE">Chèque</option>
                      <option value="VIREMENT">Virement</option>
                      <option value="TPE">Carte / TPE</option>
                    </select>
                  </div>
                </div>

                {rechargeForm.mode !== 'ESPECES' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Compte crédité</label>
                      <select
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-[10px] h-13 shadow-inner"
                        value={rechargeForm.bankAccountId}
                        onChange={e => setRechargeForm({ ...rechargeForm, bankAccountId: e.target.value })}
                      >
                        <option value="">— Sélectionner —</option>
                        {liveBankAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.name} — {a.balance.toLocaleString()} DA</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase ml-1">
                        N° {rechargeForm.mode === 'CHEQUE' ? 'chèque' : 'référence'}
                      </label>
                      <input
                        className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner"
                        value={rechargeForm.chequeNumber}
                        onChange={e => setRechargeForm({ ...rechargeForm, chequeNumber: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-[10px] font-bold text-slate-500 leading-relaxed">
                  L'argent remis par le client entre dans{" "}
                  <span className="text-blue-900 font-black">
                    {rechargeForm.mode === 'ESPECES'
                      ? 'la caisse Carburant'
                      : (liveBankAccounts.find(a => a.id === rechargeForm.bankAccountId)?.name || 'le compte bancaire à choisir')}
                  </span>{" "}
                  et son avance monte d'autant.
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Notes / Réf Banque</label>
                  <textarea className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs p-3 shadow-inner" placeholder="Notes additionnelles..." rows={2} value={rechargeForm.notes} onChange={e => setRechargeForm({...rechargeForm, notes: e.target.value})} />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t flex gap-4 shrink-0">
                <button onClick={() => setShowRecharge(false)} className="flex-1 px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all italic">Annuler</button>
                <button 
                  onClick={handleRecharge} 
                  disabled={rechargeForm.amount <= 0}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-50 hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-yellow-400" /> Valider Recharge
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Debt Modal — règlement de la dette du client */}
      <AnimatePresence>
        {showPayment && selectedClient && (
          <div className="modal-shell z-[80] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowPayment(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[var(--modal-max-h)] border border-blue-200"
            >
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-yellow-400" />
                  <div>
                    <h3 className="font-black uppercase italic text-yellow-400">Payer la Dette</h3>
                    <p className="text-[10px] text-blue-200 font-bold mt-0.5 not-italic">{selectedClient.name}</p>
                  </div>
                </div>
                <button onClick={() => { setShowPayment(false); setSelectedSale(null); }} className="p-2 hover:bg-white/10 rounded-lg text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-5 custom-scrollbar bg-white">

                <div className="p-5 bg-gradient-to-br from-blue-50 to-slate-50 rounded-2xl space-y-2.5 border-2 border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Situation du Compte Client</p>
                  <div className="grid grid-cols-2 gap-y-2 text-xs font-bold text-slate-600">
                    {selectedSale && (
                      <>
                        <span>Opération concernée</span>
                        <span className="text-blue-900 font-black text-right">
                          {selectedSale.label || `#${String(selectedSale.id || '').substring(0, 8).toUpperCase()}`}
                        </span>
                      </>
                    )}
                    <span>Reste dû (d'après les pièces)</span>
                    <span className="text-red-600 font-black text-right">{ledger.debtFromDocuments.toLocaleString()} DA</span>
                    <span className="text-emerald-600">Déjà réglé (cumul)</span>
                    <span className="text-emerald-700 text-right">{ledger.paid.toLocaleString()} DA</span>
                    {/* Le compteur de la fiche n'est montré QUE s'il diverge :
                        le taire laisserait croire à une erreur de saisie quand
                        c'est en réalité une reprise d'ouverture. */}
                    {Math.abs(ledger.debtGap) >= 1 && (
                      <>
                        <span className="text-amber-600">Encours enregistré sur la fiche</span>
                        <span className="text-amber-700 font-black text-right">{(selectedClient.debt || 0).toLocaleString()} DA</span>
                      </>
                    )}
                    <span className="text-slate-500 border-t pt-2">Reste après ce règlement</span>
                    <span className="text-blue-900 font-black text-right border-t pt-2">
                      {Math.max(0, ledger.debtFromDocuments - (paymentForm.amount || 0)).toLocaleString()} DA
                    </span>
                  </div>
                  {selectedSale && (
                    <p className="text-[9px] font-bold text-slate-400 italic leading-relaxed pt-1">
                      La dette est tenue globalement sur le compte client : ce règlement diminue l'encours total et cite cette facture sur le reçu.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Montant payé (DA)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={paymentForm.amount}
                      onChange={e => setPaymentForm({...paymentForm, amount: parseFloat(e.target.value) || 0})}
                      className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-lg h-14 pr-24 shadow-inner text-center"
                    />
                    <button
                      type="button"
                      onClick={() => setPaymentForm({...paymentForm, amount: payableDebt(selectedClient, ledger)})}
                      className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-blue-50 text-blue-700 text-[8px] font-black uppercase rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      Payer Total
                    </button>
                  </div>
                  {/* Le plafond de saisie est celui que le client peut RÉELLEMENT
                      régler — le plus grand des deux encours (`payableDebt`). Comparé
                      à la seule colonne `debt` de la fiche, un client dont la dette
                      venait des brigades voyait le bouton « Valider » rester grisé :
                      il était tout simplement impossible d'encaisser son règlement. */}
                  {paymentForm.amount > payableDebt(selectedClient, ledger) && (
                    <p className="text-[9px] font-black text-red-600 uppercase tracking-widest ml-1">
                      Le montant dépasse la dette de {payableDebt(selectedClient, ledger).toLocaleString()} DA
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Date</label>
                    <input type="date" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" value={paymentForm.date} onChange={e => setPaymentForm({...paymentForm, date: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Mode de règlement</label>
                    <select className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-[10px] h-13 shadow-inner" value={paymentForm.mode} onChange={e => setPaymentForm({...paymentForm, mode: e.target.value, bankAccountId: e.target.value === "TPE" ? (paymentForm.bankAccountId || liveBankAccounts[0]?.id || "") : paymentForm.bankAccountId })}>
                      <option value="ESPECES">Espèces</option>
                      <option value="CHEQUE">Chèque</option>
                      <option value="VIREMENT">Virement</option>
                      <option value="TPE">Carte / TPE</option>
                    </select>
                  </div>
                </div>

                {paymentForm.mode === "CHEQUE" && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Numéro de Chèque</label>
                    <input type="text" className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs h-13 shadow-inner" value={paymentForm.chequeNumber} onChange={e => setPaymentForm({...paymentForm, chequeNumber: e.target.value})} placeholder="Numéro du chèque..." />
                  </div>
                )}

                {/* Où va l'argent. Un règlement en espèces tombe dans la caisse ;
                    tout le reste atterrit sur un compte bancaire à désigner.
                    Seul le TPE demandait ce compte : un chèque encaissé ne créditait
                    donc AUCUN compte, la dette disparaissait et l'argent avec elle. */}
                {paymentForm.mode === "ESPECES" ? (
                  <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100">
                    <p className="text-[9px] font-black text-emerald-700 uppercase ml-1 flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5" /> Encaissé dans la caisse Carburant
                    </p>
                    <p className="text-[9px] font-bold text-emerald-600/70 italic leading-relaxed px-1 mt-1">
                      Le montant entre dans le coffre de l'activité Carburant — celle qui tient ce
                      client — et apparaît dans le journal de la Caisse Générale.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 p-4 rounded-2xl bg-blue-50/60 border border-blue-100">
                    <label className="text-[9px] font-black text-blue-700 uppercase ml-1 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      {paymentForm.mode === "TPE" ? "Compte bancaire du TPE" : "Compte bancaire crédité"}
                    </label>
                    {liveBankAccounts.length === 0 ? (
                      <p className="text-[10px] font-bold text-red-500 italic leading-relaxed px-1">
                        Aucun compte bancaire. Créez-en un dans « Comptes Bancaires » pour encaisser ce règlement.
                      </p>
                    ) : (
                      <>
                        <select
                          className="input-field border-blue-200 focus:border-blue-900 text-blue-900 font-black text-[11px] h-13 shadow-inner bg-white"
                          value={paymentForm.bankAccountId}
                          onChange={e => setPaymentForm({ ...paymentForm, bankAccountId: e.target.value })}
                        >
                          <option value="">— Choisir le compte —</option>
                          {liveBankAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name} — {a.balance.toLocaleString()} DA</option>
                          ))}
                        </select>
                        <p className="text-[9px] font-bold text-blue-600/70 italic leading-relaxed px-1">
                          Le montant sera crédité sur ce compte et apparaîtra dans son historique de transactions.
                        </p>
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase ml-1">Remarques / Notes</label>
                  <textarea className="input-field border-slate-200 focus:border-blue-900 text-blue-900 font-black text-xs p-3 shadow-inner" placeholder="Notes additionnelles..." rows={2} value={paymentForm.notes} onChange={e => setPaymentForm({...paymentForm, notes: e.target.value})} />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t flex flex-wrap gap-3 shrink-0">
                <button onClick={() => { setShowPayment(false); setSelectedSale(null); }} className="px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 hover:text-slate-600 transition-all italic">Annuler</button>
                <button
                  onClick={() => handleRecordPayment(false)}
                  disabled={paymentForm.amount <= 0 || paymentForm.amount > payableDebt(selectedClient, ledger) || (paymentForm.mode !== "ESPECES" && !paymentForm.bankAccountId)}
                  className="flex-1 min-w-[140px] px-4 py-2.5 bg-white border-2 border-emerald-600 text-emerald-700 rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-50 transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" /> Valider
                </button>
                <button
                  onClick={() => handleRecordPayment(true)}
                  disabled={paymentForm.amount <= 0 || paymentForm.amount > payableDebt(selectedClient, ledger) || (paymentForm.mode !== "ESPECES" && !paymentForm.bankAccountId)}
                  className="flex-1 min-w-[180px] px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4 text-yellow-400" /> Valider & Imprimer Reçu
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Relevé de compte imprimable, sur la période choisie par l'utilisateur. */}
      {reportClient && (
        <ClientReportModal
          open
          onClose={() => setReportClient(null)}
          build={buildReport}
          settings={settings}
          clientName={reportClient.name}
          partLabel="Carburant"
        />
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog 
        isOpen={!!clientToDelete}
        title="Supprimer un client"
        message={`Êtes-vous sûr de vouloir supprimer le client "${clientToDelete?.name}" ? Cette action est définitive et effacera tout son historique bancaire et de consommation.`}
        onConfirm={handleDeleteClient}
        onCancel={() => setClientToDelete(null)}
        confirmLabel="SUPPRIMER"
        danger={true}
      />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default Clients;
