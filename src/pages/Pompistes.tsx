import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  UsersRound, Plus, Search, Filter, MoreVertical, Edit2, Trash2, Eye,
  Wallet, UserX, DollarSign, History as HistoryIcon, Shield, Contact,
  Briefcase, ShieldAlert, Printer, X, CreditCard, MapIcon, User as UserIcon,
  Save, Smartphone, Lock, Fuel, Loader, AlertCircle, Check, ArrowRight, Receipt, AlertTriangle,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, newId } from "@/src/lib/utils";
import { useAppState, useAppDispatch, useModulePermission, Pompiste, Track, BrigadeChef } from "../store/AppContext";
import { provisionWorkerAccount } from "../lib/supabase";
import { emptyPermissions } from "../lib/permissionDefaults";
import { useNavigate } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import PermissionsModal from "../components/PermissionsModal";

// Username must be 3-32 chars: lowercase letters, digits, dot, underscore, hyphen
const USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;

const Pompistes = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pompistes, tracks, brigadeChefs, fuelSales, settings, currentUserRole } = useAppState();
  const perm = useModulePermission('Pompistes');
  const dispatch = useAppDispatch();

  const currentMonth = new Date().toISOString().slice(0, 7);

  // Modals state
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [selectedPompiste, setSelectedPompiste] = useState<Pompiste | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
  // Activate account modal (for workers with hasAccess=true but no auth account yet)
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activatingPompiste, setActivatingPompiste] = useState<Pompiste | null>(null);
  const [activatePassword, setActivatePassword] = useState("");
  const [activateLoading, setActivateLoading] = useState(false);

  // Form state
  const [form, setForm] = useState<Partial<Pompiste>>({
    name: "",
    cin: "",
    phone: "",
    email: "",
    address: "",
    trackId: undefined,
    chefId: undefined,
    baseSalary: 3500,
    status: "Actif",
    hireDate: new Date().toISOString().split('T')[0]
  });

  // Modal form states
  const [advanceForm, setAdvanceForm] = useState({ amount: 0, date: new Date().toISOString().split('T')[0], description: "" });
  const [absenceForm, setAbsenceForm] = useState({ cost: 0, date: new Date().toISOString().split('T')[0], description: "" });
  const [paymentForm, setPaymentForm] = useState({ month: "", mode: 'Espèces', chequeNumber: "", notes: "" });
  const [historyTab, setHistoryTab] = useState<'acomptes' | 'absences' | 'paiements' | 'decalages'>('acomptes');
  const [permissionsTab, setPermissionsTab] = useState<Record<string, Record<string, boolean>>>({});

  // Get current month for automatic payment
  const currentMonthForPayment = new Date().toISOString().slice(0, 7);

  // Mois non payés
  const unpaidMonths = useMemo(() => {
    if (!selectedPompiste) return [];
    const paid = new Set((selectedPompiste.paymentRecord || []).filter(p => p.isPaid).map(p => p.month));
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!paid.has(key)) months.push(key);
    }
    return months;
  }, [selectedPompiste]);

  // Calcul de la paie du mois courant
  const paymentCalc = useMemo(() => {
    if (!selectedPompiste) return null;
    
    const decalagePositifActif = settings?.decalagePositifActif ?? true;
    const decalageNegatifActif = settings?.decalageNegatifActif ?? true;
    
    // Use current month
    const monthAcomptes = (selectedPompiste.acomptes || []).filter(a => !a.isPaid && a.date.startsWith(currentMonthForPayment));
    const totalAcomptes = monthAcomptes.reduce((sum, a) => sum + a.amount, 0);
    
    const monthAbsences = (selectedPompiste.absences || []).filter(a => !a.isPaid && a.date.startsWith(currentMonthForPayment));
    const totalAbsences = monthAbsences.reduce((sum, a) => sum + a.cost, 0);
    
    const decalages = (selectedPompiste.decalageHistory || []).filter(d => d.date.startsWith(currentMonthForPayment));
    const bonusDecalage = decalagePositifActif 
      ? decalages.filter(d => d.type === 'BONUS').reduce((s, d) => s + d.amount, 0)
      : 0;
    const retenueDecalage = decalageNegatifActif
      ? decalages.filter(d => d.type === 'RETENUE').reduce((s, d) => s + d.amount, 0)
      : 0;
    
    const net = (selectedPompiste.baseSalary || 0) - totalAcomptes - totalAbsences + bonusDecalage - retenueDecalage;
    
    return { monthAcomptes, monthAbsences, totalAcomptes, totalAbsences, bonusDecalage, retenueDecalage, net, decalagePositifActif, decalageNegatifActif };
  }, [selectedPompiste, settings]);

  const handleSave = async () => {
    if (!form.name) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Le nom est obligatoire" } });
      return;
    }

    // Validate username when access is enabled
    if (form.hasAccess) {
      if (!form.username) {
        dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Nom d'utilisateur requis pour l'accès application" } });
        return;
      }
      if (!USERNAME_REGEX.test(form.username)) {
        dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Identifiant invalide (3-32 caractères, minuscules, chiffres, . _ -)" } });
        return;
      }
      if (!selectedPompiste && !form.password) {
        dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Mot de passe requis pour créer le compte d'accès" } });
        return;
      }
    }

    let finalAuthUserId = selectedPompiste?.authUserId;
    let finalHasAccess = !!form.hasAccess;

    if (selectedPompiste) {
      if (form.hasAccess && !selectedPompiste.authUserId && form.username && form.password) {
        const result = await provisionWorkerAccount({
          action: 'create',
          workerType: 'pompiste',
          workerId: selectedPompiste.id,
          username: form.username,
          password: form.password,
          name: form.name,
          email: form.email,
        });
        if (result.ok) {
          finalAuthUserId = result.auth_user_id;
        } else {
          finalHasAccess = false;
          dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Compte d'accès non créé: ${(result as {ok:false;error:string}).error}` } });
        }
      }
      else if (form.hasAccess && selectedPompiste.authUserId && form.username && form.password) {
        const result = await provisionWorkerAccount({
          action: 'update_password',
          workerType: 'pompiste',
          workerId: selectedPompiste.id,
          username: form.username,
          password: form.password,
          email: form.email,
        });
        if (!result.ok) {
          dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Mot de passe non mis à jour: ${(result as {ok:false;error:string}).error}` } });
        }
      }
      else if (!form.hasAccess && selectedPompiste.authUserId) {
        const result = await provisionWorkerAccount({
          action: 'delete',
          workerType: 'pompiste',
          workerId: selectedPompiste.id,
        });
        if (result.ok) {
          finalAuthUserId = undefined;
        } else {
          dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Compte d'accès non supprimé: ${(result as {ok:false;error:string}).error}` } });
        }
      }

      dispatch({ type: 'UPDATE_POMPISTE', payload: { ...selectedPompiste, ...form, hasAccess: finalHasAccess, authUserId: finalAuthUserId } as Pompiste });
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Pompiste mis à jour" } });
    } else {
      const newPompisteId = newId();

      if (form.hasAccess && form.username && form.password) {
        const result = await provisionWorkerAccount({
          action: 'create',
          workerType: 'pompiste',
          workerId: newPompisteId,
          username: form.username,
          password: form.password,
          name: form.name,
          email: form.email,
        });
        if (result.ok) {
          finalAuthUserId = result.auth_user_id;
        } else {
          finalHasAccess = false;
          dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Compte d'accès non créé: ${(result as {ok:false;error:string}).error}` } });
        }
      }

      const newPompiste: Pompiste = {
        ...form as Pompiste,
        id: newPompisteId,
        hasAccess: finalHasAccess,
        authUserId: finalAuthUserId,
        paymentRecord: [],
        acomptes: [],
        absences: [],
        permissions: emptyPermissions(),
      };
      dispatch({ type: 'ADD_POMPISTE', payload: newPompiste });
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Pompiste recruté" } });
    }
    setShowModal(false);
  };

  const handleDeletePompiste = async () => {
    if (!selectedPompiste) return;

    try {
      // Clean up auth account first (if exists)
      if (selectedPompiste.username) {
        const delResult = await provisionWorkerAccount({
          action: 'delete',
          workerType: 'pompiste',
          workerId: selectedPompiste.id,
        });
        if (!delResult.ok) {
          console.warn('[handleDeletePompiste] Auth deletion failed:', (delResult as {ok:false;error:string}).error);
          dispatch({ type: 'ADD_TOAST', payload: { type: 'warning', message: `Compte d'authentification non supprimé: ${(delResult as {ok:false;error:string}).error}` } });
        }
      }
    } catch (err) {
      console.error('[handleDeletePompiste] Auth cleanup error:', err);
      dispatch({ type: 'ADD_TOAST', payload: { type: 'warning', message: "Erreur lors de la suppression du compte d'authentification" } });
    }

    // Delete worker record from app state
    dispatch({ type: 'DELETE_POMPISTE', payload: selectedPompiste.id });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Pompiste supprimé avec succès" } });
    setShowConfirmDelete(false);
  };

  const handleActivatePompisteAccount = async () => {
    if (!activatingPompiste || !activatePassword) return;
    if (!activatingPompiste.username) {
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: "Aucun identifiant défini pour ce pompiste" } });
      return;
    }
    setActivateLoading(true);
    const result = await provisionWorkerAccount({
      action: 'create',
      workerType: 'pompiste',
      workerId: activatingPompiste.id,
      username: activatingPompiste.username,
      password: activatePassword,
      name: activatingPompiste.name,
      email: activatingPompiste.email,
    });
    setActivateLoading(false);
    if (result.ok) {
      if (result.auth_user_id) {
        dispatch({ type: 'UPDATE_POMPISTE', payload: { ...activatingPompiste, authUserId: result.auth_user_id } });
      }
      dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: `Compte activé pour ${activatingPompiste.name}` } });
      setShowActivateModal(false);
      setActivatingPompiste(null);
      setActivatePassword("");
    } else {
      const msg = (result as { ok: false; error: string }).error;
      dispatch({ type: 'ADD_TOAST', payload: { type: 'error', message: `Activation échouée: ${msg}` } });
    }
  };

  const handleAddAdvance = () => {
    if (!selectedPompiste) return;
    const acompte = { id: newId(), ...advanceForm, isPaid: false };
    const acomptes = [...(selectedPompiste.acomptes || []), acompte];
    setSelectedPompiste({ ...selectedPompiste, acomptes });
    dispatch({ type: 'UPDATE_WORKER_ACOMPTE', payload: { workerType: 'pompiste', workerId: selectedPompiste.id, acompte } });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Acompte enregistré" } });
    setShowAdvanceModal(false);
    setAdvanceForm({ amount: 0, date: new Date().toISOString().split('T')[0], description: "" });
  };

  const handleAddAbsence = () => {
    if (!selectedPompiste) return;
    const absence = { id: newId(), ...absenceForm, isPaid: false };
    const absences = [...(selectedPompiste.absences || []), absence];
    setSelectedPompiste({ ...selectedPompiste, absences });
    dispatch({ type: 'UPDATE_WORKER_ABSENCE', payload: { workerType: 'pompiste', workerId: selectedPompiste.id, absence } });
    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: "Absence enregistrée" } });
    setShowAbsenceModal(false);
    setAbsenceForm({ cost: 0, date: new Date().toISOString().split('T')[0], description: "" });
  };

  const handleSavePayment = () => {
    if (!selectedPompiste || !paymentCalc) return;

    // Marquer acomptes comme payés
    const updatedAcomptes = (selectedPompiste.acomptes || []).map(a => 
      (a.date.startsWith(currentMonthForPayment) && !a.isPaid) ? { ...a, isPaid: true, monthPaid: currentMonthForPayment } : a
    );

    // Marquer absences comme payées
    const updatedAbsences = (selectedPompiste.absences || []).map(a =>
      (a.date.startsWith(currentMonthForPayment) && !a.isPaid) ? { ...a, isPaid: true, monthPaid: currentMonthForPayment } : a
    );

    // Créer le WorkerPaymentRecord
    const record = {
      id: newId(),
      month: currentMonthForPayment,
      baseSalary: selectedPompiste.baseSalary,
      totalAcomptes: paymentCalc.totalAcomptes,
      totalAbsences: paymentCalc.totalAbsences,
      bonusDecalage: paymentCalc.bonusDecalage,
      retenueDecalage: paymentCalc.retenueDecalage,
      netSalary: paymentCalc.net,
      paymentDate: new Date().toISOString().split('T')[0],
      paymentMode: paymentForm.mode,
      chequeNumber: paymentForm.chequeNumber || undefined,
      notes: paymentForm.notes || undefined,
      isPaid: true,
    };

    // Dispatch acompte & absence updates to DB
    (selectedPompiste.acomptes || []).forEach(a => {
      if (a.date.startsWith(currentMonthForPayment) && !a.isPaid) {
        dispatch({ type: 'UPDATE_WORKER_ACOMPTE', payload: { workerType: 'pompiste', workerId: selectedPompiste.id, acompte: { ...a, isPaid: true, monthPaid: currentMonthForPayment } } });
      }
    });

    (selectedPompiste.absences || []).forEach(a => {
      if (a.date.startsWith(currentMonthForPayment) && !a.isPaid) {
        dispatch({ type: 'UPDATE_WORKER_ABSENCE', payload: { workerType: 'pompiste', workerId: selectedPompiste.id, absence: { ...a, isPaid: true, monthPaid: currentMonthForPayment } } });
      }
    });

    // Dispatch add payment
    dispatch({
      type: 'ADD_WORKER_PAYMENT',
      payload: { workerType: 'pompiste', workerId: selectedPompiste.id, payment: record }
    });

    // Update local state
    setSelectedPompiste({
      ...selectedPompiste,
      acomptes: updatedAcomptes,
      absences: updatedAbsences,
      paymentRecord: [...(selectedPompiste.paymentRecord || []), record]
    });

    dispatch({ type: 'ADD_TOAST', payload: { type: 'success', message: `Paiement de ${currentMonthForPayment} enregistré` } });
    setShowPaymentModal(false);
    setPaymentForm({ month: "", mode: 'Espèces', chequeNumber: "", notes: "" });
  };

  const resetForm = () => {
    setForm({ name: "", cin: "", phone: "", email: "", address: "", trackId: undefined, chefId: undefined, baseSalary: 3500, status: "Actif", hireDate: new Date().toISOString().split('T')[0] });
    setSelectedPompiste(null);
  };

  const modules = [
    { name: 'Brigades', icon: '📅' },
    { name: 'Ventes Carburant', icon: '⛽' },
    { name: 'Vente Magasin', icon: '🛒' },
    { name: 'Cuves', icon: '🛢️' },
    { name: 'Pompes', icon: '🔌' },
    { name: 'Pistes', icon: '🛣️' },
    { name: 'Livraisons', icon: '📦' },
    { name: 'Produits', icon: '🏷️' },
    { name: 'Achats', icon: '🛍️' },
    { name: 'Inventaire', icon: '📋' },
    { name: 'Clients', icon: '👥' },
    { name: 'Fournisseurs', icon: '🚚' },
    { name: 'Chefs Brigade', icon: '👮' },
    { name: 'Gérants', icon: '💼' },
    { name: 'Employés Magasin', icon: '🧑‍🌾' },
    { name: 'Dépenses', icon: '💸' },
    { name: 'Fiche Journalière', icon: '📝' },
    { name: 'Statistiques', icon: '📊' },
    { name: 'Rapports', icon: '📈' },
    { name: 'Paramètres', icon: '⚙️' }
  ];

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12 italic text-left">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-blue-900 uppercase italic tracking-tighter leading-none">Gestion des Pompistes</h1>
          <p className="text-slate-500 font-medium mt-2 italic leading-relaxed">Gérez votre personnel de piste, leurs assignations et leur paie.</p>
        </div>
        {perm.creer && (
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="btn-primary h-14 px-8 tracking-[0.2em]"
        >
          <Plus className="w-5 h-5" /> RECRUTER UN POMPISTE
        </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="p-6 border border-slate-100 rounded-3xl flex flex-wrap items-center justify-between gap-6 bg-white shadow-sm italic">
        <div className="relative w-full max-w-lg">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
          <input 
            type="text" 
            placeholder="Rechercher par nom ou CIN..." 
            className="w-full pl-14 pr-6 h-14 bg-slate-50 border-none rounded-2xl text-[10px] font-black uppercase tracking-widest outline-none shadow-inner"
          />
        </div>
        <div className="h-14 px-6 bg-slate-50 rounded-2xl flex items-center gap-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border border-slate-100 cursor-pointer shadow-sm hover:bg-slate-100 transition-colors">
          <Filter className="w-4 h-4" /> Filtrer
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {pompistes.length > 0 ? pompistes.map((p) => {
          const currentMonthAcomptes = (p.acomptes || []).filter(a => !a.isPaid && a.date.startsWith(currentMonth)).reduce((sum, a) => sum + a.amount, 0);
          const isMonthPaid = (p.paymentRecord || []).some(pr => pr.month === currentMonth && pr.isPaid);
          
          return (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className={cn(
              "group relative bg-white rounded-3xl border hover:shadow-2xl transition-all p-6 space-y-4 italic flex flex-col",
              actionMenuOpen === p.id ? "z-50 border-blue-300 ring-4 ring-blue-50 shadow-xl" : "z-10 border-slate-100 hover:border-blue-200 shadow-sm"
            )}
          >
            {/* Gradient Top Border */}
            <div className={cn("h-2 absolute top-0 left-0 right-0 rounded-t-3xl", p.status === "Actif" ? "bg-gradient-to-r from-blue-900 via-blue-800 to-yellow-400" : "bg-slate-300")} />
            {/* Status Indicator */}
            <div className="absolute top-4 left-4">
              <span className={cn("text-[9px] font-black uppercase px-2.5 py-1 rounded-full italic shadow-sm", 
                p.status === "Actif" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                {p.status}
              </span>
            </div>

            {/* Menu Button */}
            <div className="absolute top-4 right-4">
              <motion.button
                onClick={() => setActionMenuOpen(actionMenuOpen === p.id ? null : p.id)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 group-hover:text-primary transition-all bg-white/80 backdrop-blur-sm shadow-sm border border-slate-100"
              >
                <MoreVertical className="w-5 h-5" />
              </motion.button>

              {/* Dropdown Menu */}
              <AnimatePresence>
                {actionMenuOpen === p.id && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-56 bg-white border border-slate-100 rounded-2xl shadow-2xl z-[60] overflow-hidden"
                  >
                    <div className="divide-y divide-slate-100">
                      <button onClick={() => { setSelectedPompiste(p); setShowDetailModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <Eye className="w-4 h-4 text-slate-500" /> Voir Détails
                      </button>
                      {perm.modifier && (
                      <button onClick={() => { setSelectedPompiste(p); setForm(p); setShowModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <Edit2 className="w-4 h-4 text-blue-500" /> Modifier
                      </button>
                      )}
                      <button onClick={() => { setSelectedPompiste(p); setShowAdvanceModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <Wallet className="w-4 h-4 text-amber-500" /> Acompte
                      </button>
                      <button onClick={() => { setSelectedPompiste(p); setShowAbsenceModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <UserX className="w-4 h-4 text-orange-500" /> Absence
                      </button>
                      <button onClick={() => { setSelectedPompiste(p); setShowPaymentModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-green-600 hover:bg-green-50 flex items-center gap-3 transition-colors">
                        <DollarSign className="w-4 h-4" /> Paiement
                      </button>
                      <button onClick={() => { setSelectedPompiste(p); setShowHistoryModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                        <HistoryIcon className="w-4 h-4 text-purple-500" /> Historique
                      </button>
                      {currentUserRole === 'admin' && (
                        <button onClick={() => { setSelectedPompiste(p); setShowPermissionsModal(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                          <Shield className="w-4 h-4 text-red-500" /> Permissions
                        </button>
                      )}
                      {perm.supprimer && (
                      <button onClick={() => { setSelectedPompiste(p); setShowConfirmDelete(true); setActionMenuOpen(null); }} className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors">
                        <Trash2 className="w-4 h-4" /> Supprimer
                      </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Avatar & Info */}
            <div className="flex flex-col items-center text-center gap-4 pt-4">
              <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center font-black text-2xl shadow-lg", 
                p.status === "Actif" ? "bg-gradient-to-br from-blue-900 to-blue-800 text-yellow-400" : "bg-slate-300 text-white")}>
                {p.name[0]}
              </div>
              <div className="flex-1">
                <p className="font-black text-blue-900 uppercase tracking-tight text-sm mb-1">{p.name}</p>
                <p className="text-[10px] text-slate-500 font-bold">CIN: {p.cin}</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {p.trackId && (
                <span className="text-[9px] font-bold px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full flex items-center gap-1 italic">
                  <MapIcon className="w-3 h-3" /> {tracks.find(t => t.id === p.trackId)?.name}
                </span>
              )}
              {p.hasAccess && p.authUserId && (
                <span className="text-[9px] font-bold px-2.5 py-1 bg-green-100 text-green-700 rounded-full flex items-center gap-1 italic">
                  <Lock className="w-3 h-3" /> Compte actif
                </span>
              )}
              {p.hasAccess && !p.authUserId && p.username && (
                <button
                  onClick={() => { setActivatingPompiste(p); setActivatePassword(""); setShowActivateModal(true); }}
                  className="text-[9px] font-bold px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full flex items-center gap-1 italic hover:bg-amber-200 transition-colors"
                >
                  <Zap className="w-3 h-3" /> Activer
                </button>
              )}
              {p.hasAccess && !p.username && (
                <span className="text-[9px] font-bold px-2.5 py-1 bg-slate-100 text-slate-500 rounded-full flex items-center gap-1 italic">
                  <Lock className="w-3 h-3" /> Accès
                </span>
              )}
            </div>

            {/* Key Metrics */}
            <div className="pt-4 mt-auto border-t border-slate-100 grid grid-cols-3 gap-2">
              <div className="text-center bg-slate-50/50 rounded-xl p-2 border border-slate-100">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Salaire</p>
                <p className="text-[10px] font-black text-blue-900 italic">{p.baseSalary.toLocaleString()} DA</p>
              </div>
              <div className="text-center bg-red-50/50 rounded-xl p-2 border border-red-100">
                <p className="text-[8px] font-black text-red-400 uppercase tracking-widest mb-1">Acomptes</p>
                <p className="text-[10px] font-black text-red-600 italic">{currentMonthAcomptes.toLocaleString()} DA</p>
              </div>
              <div className="text-center bg-slate-50/50 rounded-xl p-2 border border-slate-100 flex flex-col justify-center items-center">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Ce Mois</p>
                <span className={cn("text-[8px] font-black uppercase px-2 py-0.5 rounded-full italic shadow-sm", 
                  isMonthPaid ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                  {isMonthPaid ? "Payé" : "à Payer"}
                </span>
              </div>
            </div>
          </motion.div>
        );
        }) : (
          <div className="col-span-full">
            <EmptyState icon={UsersRound} title="Aucun pompiste" description="Commencez par recruter votre premier pompiste" actionLabel="Recruter" action={() => { resetForm(); setShowModal(true); }} />
          </div>
        )}
      </div>

      {/* Edit/Create Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col h-[var(--modal-max-h)] overflow-hidden border border-slate-100">
              <div className="p-8 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/10 backdrop-blur-sm text-yellow-400 rounded-2xl flex items-center justify-center shadow-inner"><UsersRound className="w-6 h-6" /></div>
                  <h3 className="font-black text-yellow-400 uppercase tracking-widest italic">{selectedPompiste ? "MODIFIER POMPISTE" : "NOUVEAU POMPISTE"}</h3>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-all"><X className="w-6 h-6 text-white" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Nom</label>
                    <input type="text" className="input-field italic uppercase font-black text-xs" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">CIN</label>
                    <input type="text" className="input-field italic uppercase font-black text-xs" value={form.cin} onChange={e => setForm({...form, cin: e.target.value})} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Téléphone</label>
                    <input type="text" className="input-field italic font-black text-xs" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Email</label>
                    <input type="email" className="input-field italic font-black text-xs" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Adresse</label>
                  <input type="text" className="input-field italic font-black text-xs" value={form.address} onChange={e => setForm({...form, address: e.target.value})} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Piste</label>
                    <select className="input-field italic uppercase font-black text-[10px]" value={form.trackId ?? ""} onChange={e => setForm({...form, trackId: e.target.value || undefined})}>
                      <option value="">— Aucun —</option>
                      {tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Chef</label>
                    <select className="input-field italic uppercase font-black text-[10px]" value={form.chefId ?? ""} onChange={e => setForm({...form, chefId: e.target.value || undefined})}>
                      <option value="">— Aucun —</option>
                      {brigadeChefs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Salaire Base (DA)</label>
                    <input type="number" className="input-field italic font-black text-lg" value={form.baseSalary} onChange={e => setForm({...form, baseSalary: parseFloat(e.target.value)})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Statut</label>
                    <select className="input-field italic uppercase font-black text-[10px]" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                      <option value="Actif">Actif</option>
                      <option value="Congé">En Congé</option>
                      <option value="Inactif">Inactif</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Date d'Embauche</label>
                  <input type="date" className="input-field italic font-black text-xs" value={form.hireDate} onChange={e => setForm({...form, hireDate: e.target.value})} />
                </div>

                {/* Accès Logiciel */}
                <div className="p-4 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl space-y-4 border border-slate-200 mt-4 shadow-sm">
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                       <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                         <Lock className="w-5 h-5 text-blue-900" />
                       </div>
                       <div>
                         <p className="text-[10px] font-black text-blue-900 uppercase italic tracking-widest">Accès Application</p>
                         <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">Autoriser la connexion</p>
                       </div>
                     </div>
                     <button type="button" onClick={() => setForm({...form, hasAccess: !form.hasAccess})} className={cn("w-12 h-6 rounded-full transition-colors relative shadow-inner", form.hasAccess ? "bg-green-500" : "bg-slate-300")}>
                        <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm", form.hasAccess ? "left-7" : "left-1")} />
                     </button>
                   </div>
                   
                   <AnimatePresence>
                     {form.hasAccess && (
                       <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                         <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-200">
                            <div className="space-y-2">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Nom d'utilisateur</label>
                              <input type="text" className="input-field italic font-black text-xs bg-white" placeholder="Identifiant unique" value={form.username || ''} onChange={e => setForm({...form, username: e.target.value})} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Mot de passe</label>
                              <input type="text" className="input-field italic font-black text-xs bg-white" placeholder="Mot de passe" value={form.password || ''} onChange={e => setForm({...form, password: e.target.value})} />
                            </div>
                         </div>
                       </motion.div>
                     )}
                   </AnimatePresence>
                </div>
              </div>

              <div className="p-6 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-4 shrink-0">
                <button onClick={() => setShowModal(false)} className="flex-1 text-[10px] font-black uppercase text-blue-900 italic hover:text-blue-800 transition-colors border-2 border-blue-900 rounded-lg py-3 hover:bg-white bg-gradient-to-r from-white to-yellow-50">Annuler</button>
                <button onClick={handleSave} className="flex-[2] bg-gradient-to-r from-blue-900 to-blue-800 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-lg py-3 transition-all transform hover:-translate-y-0.5 text-[10px] flex items-center justify-center gap-2"><Save className="w-4 h-4" /> SAUVEGARDER</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {showDetailModal && selectedPompiste && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDetailModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="p-8 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white flex items-center justify-between shrink-0">
                <h3 className="font-black text-yellow-400 uppercase tracking-widest italic flex items-center gap-2"><Eye className="w-5 h-5 text-yellow-400" /> DÉTAILS DU POMPISTE</h3>
                <button onClick={() => setShowDetailModal(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors"><X className="w-6 h-6 text-white" /></button>
              </div>

              <div className="p-8 space-y-6 max-h-[75vh] overflow-y-auto">
                <div className="flex items-center gap-6 p-6 bg-gradient-to-r from-blue-50 to-yellow-50 rounded-2xl border border-blue-100">
                  <div className="w-20 h-20 bg-gradient-to-br from-blue-900 to-blue-800 text-yellow-400 rounded-2xl flex items-center justify-center font-black text-3xl shadow-lg">{selectedPompiste.name[0]}</div>
                  <div>
                    <p className="text-lg font-black text-blue-900 uppercase mb-2">{selectedPompiste.name}</p>
                    <p className="text-[10px] text-slate-500 font-bold">CIN: {selectedPompiste.cin}</p>
                    <p className="text-[10px] text-slate-500 font-bold">Tél: {selectedPompiste.phone}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1 italic">Statut</p>
                    <p className="font-black text-slate-700">{selectedPompiste.status}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1 italic">Salaire</p>
                    <p className="font-black text-primary">{selectedPompiste.baseSalary.toLocaleString()} DA</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1 italic">Piste</p>
                    <p className="font-bold text-slate-700">{tracks.find(t => t.id === selectedPompiste.trackId)?.name || 'N/A'}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <p className="text-[9px] font-bold text-slate-400 uppercase mb-1 italic">Chef</p>
                    <p className="font-bold text-slate-700">{brigadeChefs.find(c => c.id === selectedPompiste.chefId)?.name || 'Libre'}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Advance Modal */}
      <AnimatePresence>
        {showAdvanceModal && selectedPompiste && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAdvanceModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white flex items-center justify-between">
                <h3 className="font-black text-yellow-400 uppercase tracking-widest italic flex items-center gap-2"><Wallet className="w-4 h-4 text-yellow-400" /> NOUVEL ACOMPTE</h3>
                <button onClick={() => setShowAdvanceModal(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><X className="w-5 h-5 text-white" /></button>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Montant (DA)</label>
                  <input type="number" className="input-field italic font-black text-lg" value={advanceForm.amount} onChange={e => setAdvanceForm({...advanceForm, amount: parseFloat(e.target.value)})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Date</label>
                  <input type="date" className="input-field italic font-black text-xs" value={advanceForm.date} onChange={e => setAdvanceForm({...advanceForm, date: e.target.value})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Description (Optionnel)</label>
                  <textarea className="input-field italic font-black text-xs" value={advanceForm.description} onChange={e => setAdvanceForm({...advanceForm, description: e.target.value})} rows={3} />
                </div>
              </div>

              <div className="p-6 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-4 shrink-0">
                <button onClick={() => setShowAdvanceModal(false)} className="flex-1 text-[10px] font-black uppercase text-blue-900 italic hover:text-blue-800 transition-colors border-2 border-blue-900 rounded-lg py-3 hover:bg-white bg-gradient-to-r from-white to-yellow-50">Annuler</button>
                <button onClick={handleAddAdvance} className="flex-[2] bg-gradient-to-r from-blue-900 to-blue-800 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-lg py-3 transition-all transform hover:-translate-y-0.5 text-[10px]">ENREGISTRER</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Absence Modal */}
      <AnimatePresence>
        {showAbsenceModal && selectedPompiste && (
          <div className="modal-shell z-[60] italic text-left">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAbsenceModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="p-6 bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white flex items-center justify-between">
                <h3 className="font-black text-yellow-400 uppercase tracking-widest italic flex items-center gap-2"><UserX className="w-4 h-4 text-yellow-400" /> NOUVELLE ABSENCE</h3>
                <button onClick={() => setShowAbsenceModal(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><X className="w-5 h-5 text-white" /></button>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Coût/Retenue (DA)</label>
                  <input type="number" className="input-field italic font-black text-lg" value={absenceForm.cost} onChange={e => setAbsenceForm({...absenceForm, cost: parseFloat(e.target.value)})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Date</label>
                  <input type="date" className="input-field italic font-black text-xs" value={absenceForm.date} onChange={e => setAbsenceForm({...absenceForm, date: e.target.value})} />
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Description</label>
                  <input type="text" className="input-field italic font-black text-xs" value={absenceForm.description} onChange={e => setAbsenceForm({...absenceForm, description: e.target.value})} placeholder="Maladie, sans justificatif..." />
                </div>
              </div>

              <div className="p-6 bg-gradient-to-r from-slate-50 to-yellow-50 border-t border-slate-200 flex gap-4 shrink-0">
                <button onClick={() => setShowAbsenceModal(false)} className="flex-1 text-[10px] font-black uppercase text-blue-900 italic hover:text-blue-800 transition-colors border-2 border-blue-900 rounded-lg py-3 hover:bg-white bg-gradient-to-r from-white to-yellow-50">Annuler</button>
                <button onClick={handleAddAbsence} className="flex-[2] bg-gradient-to-r from-blue-900 to-blue-800 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-lg py-3 transition-all transform hover:-translate-y-0.5 text-[10px]">ENREGISTRER</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Modal */}
      <AnimatePresence>
        {showPaymentModal && selectedPompiste && paymentCalc && (
          <div className="modal-shell z-[70] bg-black/40 text-left">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[var(--modal-max-h)] overflow-hidden flex flex-col relative z-10 border border-slate-100"
            >
              {/* Header with Gradient */}
              <div className="p-8 bg-gradient-to-r from-blue-900 via-blue-700 to-blue-800 text-white flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-yellow-400 rounded-xl flex items-center justify-center text-blue-900 font-black"><DollarSign className="w-6 h-6" /></div>
                  <div>
                    <h3 className="font-black uppercase tracking-widest text-lg">FORMULAIRE DE PAIEMENT</h3>
                    <p className="text-[10px] text-blue-100 font-bold mt-1">{selectedPompiste.name} ⬢ {new Date(currentMonthForPayment + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}</p>
                  </div>
                </div>
                <button onClick={() => setShowPaymentModal(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                
                {/* Salary Base */}
                <div className="p-6 bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl border-2 border-purple-200 shadow-sm">
                  <p className="text-[9px] font-bold text-purple-700 uppercase tracking-widest mb-2 flex items-center gap-2">💰 Salaire de Base</p>
                  <p className="text-4xl font-black text-purple-900">{selectedPompiste.baseSalary.toLocaleString()} <span className="text-xl text-purple-600">DA</span></p>
                </div>

                {/* Summary Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  
                  {/* Acomptes Card */}
                  <div className="p-5 bg-gradient-to-br from-red-50 to-orange-50 rounded-2xl border-2 border-red-200">
                    <p className="text-[9px] font-bold text-red-700 uppercase tracking-widest mb-3 flex items-center gap-2">🏦 Total Acomptes</p>
                    <p className="text-3xl font-black text-red-600">{paymentCalc.totalAcomptes.toLocaleString()} <span className="text-sm text-red-500">DA</span></p>
                    {paymentCalc.monthAcomptes.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-red-200">
                        <p className="text-[8px] text-red-600 font-bold mb-2">{paymentCalc.monthAcomptes.length} entrée(s):</p>
                        <div className="space-y-1">
                          {paymentCalc.monthAcomptes.map((a, i) => (
                            <div key={i} className="text-[8px] text-slate-600">
                              ⬢ {a.description || 'Acompte'}: {a.amount.toLocaleString()} DA
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Absences Card */}
                  <div className="p-5 bg-gradient-to-br from-orange-50 to-yellow-50 rounded-2xl border-2 border-orange-200">
                    <p className="text-[9px] font-bold text-orange-700 uppercase tracking-widest mb-3 flex items-center gap-2">❌ Total Absences</p>
                    <p className="text-3xl font-black text-orange-600">{paymentCalc.totalAbsences.toLocaleString()} <span className="text-sm text-orange-500">DA</span></p>
                    {paymentCalc.monthAbsences.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-orange-200">
                        <p className="text-[8px] text-orange-600 font-bold mb-2">{paymentCalc.monthAbsences.length} entrée(s):</p>
                        <div className="space-y-1">
                          {paymentCalc.monthAbsences.map((a, i) => (
                            <div key={i} className="text-[8px] text-slate-600">
                              ⬢ {a.description || 'Absence'}: {a.cost.toLocaleString()} DA
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Décalages Card */}
                  <div className="p-5 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border-2 border-blue-200">
                    <p className="text-[9px] font-bold text-blue-700 uppercase tracking-widest mb-3 flex items-center gap-2">⚖️ Total Décalages</p>
                    <div className="space-y-2">
                      {paymentCalc.bonusDecalage > 0 && paymentCalc.decalagePositifActif && (
                        <div>
                          <p className="text-2xl font-black text-emerald-600">+{paymentCalc.bonusDecalage.toLocaleString()} DA</p>
                          <p className="text-[8px] text-emerald-600 font-bold">Prime (Surplus)</p>
                        </div>
                      )}
                      {paymentCalc.retenueDecalage > 0 && paymentCalc.decalageNegatifActif && (
                        <div>
                          <p className="text-2xl font-black text-red-600">-{paymentCalc.retenueDecalage.toLocaleString()} DA</p>
                          <p className="text-[8px] text-red-600 font-bold">Retenue (Manque)</p>
                        </div>
                      )}
                      {paymentCalc.bonusDecalage === 0 && paymentCalc.retenueDecalage === 0 && (
                        <p className="text-2xl font-black text-slate-400">0 DA</p>
                      )}
                    </div>
                  </div>

                </div>

                {/* Final Calculation - Large */}
                <div className="p-8 bg-gradient-to-br from-blue-900 to-blue-800 rounded-3xl space-y-6 text-white shadow-2xl shadow-blue-900/40 border-2 border-blue-700">
                  <p className="text-[11px] font-black text-yellow-400 uppercase tracking-widest flex items-center gap-2">
                    📊 CALCUL NET À PAYER
                  </p>
                  
                  <div className="space-y-4 bg-white/5 p-6 rounded-2xl backdrop-blur-sm border border-white/10">
                    <div className="flex justify-between text-sm items-center pb-4 border-b border-blue-600">
                      <span className="text-blue-200">Salaire de base</span>
                      <span className="font-black text-2xl text-white">{selectedPompiste.baseSalary.toLocaleString()} DA</span>
                    </div>
                    
                    {paymentCalc.totalAcomptes > 0 && (
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-red-300">- Acomptes</span>
                        <span className="text-red-400 font-black text-lg">-{paymentCalc.totalAcomptes.toLocaleString()} DA</span>
                      </div>
                    )}
                    
                    {paymentCalc.totalAbsences > 0 && (
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-orange-300">- Absences</span>
                        <span className="text-orange-400 font-black text-lg">-{paymentCalc.totalAbsences.toLocaleString()} DA</span>
                      </div>
                    )}
                    
                    {paymentCalc.bonusDecalage > 0 && paymentCalc.decalagePositifActif && (
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-emerald-300">+ Prime Décalage</span>
                        <span className="text-emerald-400 font-black text-lg">+{paymentCalc.bonusDecalage.toLocaleString()} DA</span>
                      </div>
                    )}
                    
                    {paymentCalc.retenueDecalage > 0 && paymentCalc.decalageNegatifActif && (
                      <div className="flex justify-between text-sm items-center">
                        <span className="text-red-300">- Retenue Décalage</span>
                        <span className="text-red-400 font-black text-lg">-{paymentCalc.retenueDecalage.toLocaleString()} DA</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="border-t-2 border-yellow-400 pt-6 mt-4 flex justify-between items-center">
                    <span className="text-xs font-black uppercase tracking-widest text-blue-200">MONTANT TOTAL À PAYER</span>
                    <span className="text-5xl font-black text-yellow-400">{paymentCalc.net.toLocaleString()}</span>
                  </div>
                  <div className="text-right text-yellow-300 text-lg font-bold">DA</div>
                </div>

                {/* Payment Method */}
                <div className="space-y-2 p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-100">
                  <label className="text-[9px] font-bold text-green-700 uppercase tracking-widest">💳 Mode Paiement</label>
                  <select 
                    className="w-full px-4 py-2.5 bg-white border border-green-200 rounded-lg font-bold outline-none focus:ring-2 focus:ring-green-400" 
                    value={paymentForm.mode}
                    onChange={e => setPaymentForm({...paymentForm, mode: e.target.value})}
                  >
                    <option value="Espèces">💵 Espèces</option>
                    <option value="Chèque">📋 Chèque</option>
                  </select>
                </div>

                {paymentForm.mode === 'Chèque' && (
                  <div className="space-y-2 p-4 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl border border-amber-100">
                    <label className="text-[9px] font-bold text-amber-700 uppercase tracking-widest"> Numéro Chèque</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-2.5 bg-white border border-amber-200 rounded-lg font-bold outline-none focus:ring-2 focus:ring-amber-400" 
                      placeholder="Ex: 123456"
                      value={paymentForm.chequeNumber}
                      onChange={e => setPaymentForm({...paymentForm, chequeNumber: e.target.value})}
                    />
                  </div>
                )}

                <div className="space-y-2 p-4 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-200">
                  <label className="text-[9px] font-bold text-slate-700 uppercase tracking-widest">Notes</label>
                  <textarea 
                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg font-bold outline-none focus:ring-2 focus:ring-slate-400 text-sm" 
                    placeholder="Notes optionnelles..."
                    rows={2}
                    value={paymentForm.notes}
                    onChange={e => setPaymentForm({...paymentForm, notes: e.target.value})}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3 shrink-0">
                <button 
                  onClick={() => {
                    setShowPaymentModal(false);
                    setPaymentForm({ month: "", mode: 'Espèces', chequeNumber: "", notes: "" });
                  }}
                  className="flex-1 text-[10px] font-black uppercase text-slate-600 hover:text-slate-700 transition-colors border border-slate-300 rounded-xl py-3 hover:bg-slate-100"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleSavePayment}
                  className="flex-[2] bg-gradient-to-r from-green-600 to-emerald-500 hover:shadow-lg text-white font-black uppercase tracking-widest rounded-xl py-3 transition-all transform hover:-translate-y-0.5 text-[10px] flex items-center justify-center gap-2 shadow-lg shadow-green-200/50"
                >
                  <DollarSign className="w-4 h-4" /> CONFIRMER PAIEMENT
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && selectedPompiste && (
          <div className="modal-shell z-[70] bg-black/40">
            <motion.div
              initial={{ opacity: 0, x: 50, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="relative bg-gradient-to-r from-blue-900 via-blue-700 to-blue-800 px-8 py-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                    <HistoryIcon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white">Historique</h2>
                    <p className="text-blue-100 text-sm font-semibold">{selectedPompiste.name}</p>
                  </div>
                </div>
                <motion.button 
                  onClick={() => setShowHistoryModal(false)}
                  whileHover={{ rotate: 90 }}
                  className="text-white hover:bg-white/20 p-2 rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 px-8 pt-6 border-b border-slate-200 bg-slate-50 overflow-x-auto">
                {['acomptes', 'absences', 'decalages', 'paiements'].map(tab => (
                  <motion.button
                    key={tab}
                    onClick={() => setHistoryTab(tab as any)}
                    className={`px-4 py-3 font-bold text-sm uppercase tracking-widest pb-4 transition-all whitespace-nowrap ${
                      historyTab === tab
                        ? 'text-blue-600 border-b-2 border-blue-600'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                    whileHover={{ scale: 1.05 }}
                  >
                    {tab === 'acomptes' && '💰 Acomptes'}
                    {tab === 'absences' && '🚫 Absences'}
                    {tab === 'decalages' && '⚖️ Décalages'}
                    {tab === 'paiements' && '📋 Paiements'}
                  </motion.button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {historyTab === 'acomptes' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-3"
                  >
                    {(selectedPompiste.acomptes || []).length === 0 ? (
                      <div className="text-center py-12">
                        <Wallet className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500 font-semibold">Aucun acompte enregistré</p>
                      </div>
                    ) : (
                      (selectedPompiste.acomptes || [])
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                        .map((acompte, idx) => (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-4 bg-gradient-to-r from-red-50 to-red-100 rounded-2xl border border-red-200 flex items-center justify-between"
                          >
                            <div className="flex-1">
                              <p className="font-bold text-slate-700">{acompte.description || 'Acompte'}</p>
                              <p className="text-sm text-slate-600 mt-1">
                                {new Date(acompte.date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
                                {acompte.isPaid && ' ⬢ Payé'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-black text-red-600">-{acompte.amount.toLocaleString()} DA</p>
                            </div>
                          </motion.div>
                        ))
                    )}
                  </motion.div>
                )}

                {historyTab === 'absences' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-3"
                  >
                    {(selectedPompiste.absences || []).length === 0 ? (
                      <div className="text-center py-12">
                        <UserX className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500 font-semibold">Aucune absence enregistrée</p>
                      </div>
                    ) : (
                      (selectedPompiste.absences || [])
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                        .map((absence, idx) => (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-4 bg-gradient-to-r from-orange-50 to-orange-100 rounded-2xl border border-orange-200 flex items-center justify-between"
                          >
                            <div className="flex-1">
                              <p className="font-bold text-slate-700">{absence.description || 'Absence'}</p>
                              <p className="text-sm text-slate-600 mt-1">
                                {new Date(absence.date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
                                {absence.isPaid && ' ⬢ Payé'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-black text-orange-600">-{absence.cost.toLocaleString()} DA</p>
                            </div>
                          </motion.div>
                        ))
                    )}
                  </motion.div>
                )}

                {historyTab === 'paiements' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-3"
                  >
                    {(selectedPompiste.paymentRecord || []).length === 0 ? (
                      <div className="text-center py-12">
                        <Receipt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500 font-semibold">Aucun paiement enregistré</p>
                      </div>
                    ) : (
                      (selectedPompiste.paymentRecord || [])
                        .sort((a, b) => b.month.localeCompare(a.month))
                        .map((payment, idx) => (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-4 bg-gradient-to-r from-green-50 to-emerald-100 rounded-2xl border border-green-200 flex items-center justify-between"
                          >
                            <div className="flex-1">
                              <p className="font-bold text-slate-700">{payment.month}</p>
                              <p className="text-sm text-slate-600 mt-1">
                                Mode: <span className="font-semibold">{payment.mode}</span>
                                {payment.chequeNumber && ` ⬢ Chèque: ${payment.chequeNumber}`}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-black text-green-600">+{payment.amount.toLocaleString()} DA</p>
                            </div>
                          </motion.div>
                        ))
                    )}
                  </motion.div>
                )}

                {historyTab === 'decalages' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-3"
                  >
                    {(selectedPompiste.decalageHistory || []).length === 0 ? (
                      <div className="text-center py-12">
                        <AlertTriangle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500 font-semibold">Aucun décalage enregistré</p>
                      </div>
                    ) : (
                      <>
                        {/* Positive Decalages */}
                        {(selectedPompiste.decalageHistory || []).filter((d: any) => d.type === 'BONUS').length > 0 && (
                          <div className="space-y-3">
                            <div className="px-4 py-2 bg-emerald-100 rounded-lg border-l-4 border-emerald-600">
                              <p className="font-bold text-emerald-900 text-sm">Primes (Surplus Carburant)</p>
                            </div>
                            {(selectedPompiste.decalageHistory || [])
                              .filter((d: any) => d.type === 'BONUS')
                              .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                              .map((decalage, idx) => (
                                <motion.div
                                  key={idx}
                                  initial={{ opacity: 0, x: -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                  className="p-4 bg-gradient-to-r from-emerald-50 to-green-100 rounded-2xl border border-emerald-200 flex items-center justify-between"
                                >
                                  <div className="flex-1">
                                    <p className="font-bold text-slate-700">{decalage.description || 'Décalage'}</p>
                                    <p className="text-sm text-slate-600 mt-1">
                                      {new Date(decalage.date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
                                      {decalage.isPaid && ' ⬢ Inclus au paiement'}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-lg font-black text-emerald-600">+{decalage.amount.toLocaleString()} DA</p>
                                  </div>
                                </motion.div>
                              ))}
                          </div>
                        )}

                        {/* Negative Decalages */}
                        {(selectedPompiste.decalageHistory || []).filter((d: any) => d.type === 'RETENUE').length > 0 && (
                          <div className="space-y-3 pt-4">
                            <div className="px-4 py-2 bg-red-100 rounded-lg border-l-4 border-red-600">
                              <p className="font-bold text-red-900 text-sm">Retenues (Manque Carburant)</p>
                            </div>
                            {(selectedPompiste.decalageHistory || [])
                              .filter((d: any) => d.type === 'RETENUE')
                              .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                              .map((decalage, idx) => (
                                <motion.div
                                  key={idx}
                                  initial={{ opacity: 0, x: -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                  className="p-4 bg-gradient-to-r from-red-50 to-red-100 rounded-2xl border border-red-200 flex items-center justify-between"
                                >
                                  <div className="flex-1">
                                    <p className="font-bold text-slate-700">{decalage.description || 'Décalage'}</p>
                                    <p className="text-sm text-slate-600 mt-1">
                                      {new Date(decalage.date).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
                                      {decalage.isPaid && ' ⬢ Inclus au paiement'}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-lg font-black text-red-600">-{decalage.amount.toLocaleString()} DA</p>
                                  </div>
                                </motion.div>
                              ))}
                          </div>
                        )}
                      </>
                    )}
                  </motion.div>
                )}
              </div>

              {/* Footer */}
              <div className="p-6 bg-slate-50 border-t flex gap-3">
                <button 
                  onClick={() => setShowHistoryModal(false)}
                  className="flex-1 px-4 py-3 text-sm font-black uppercase text-slate-600 hover:bg-slate-100 rounded-xl transition border border-slate-200"
                >
                  Fermer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Permissions Modal */}
      <AnimatePresence>
        {showPermissionsModal && selectedPompiste && (
          <PermissionsModal
            isOpen={showPermissionsModal}
            onClose={() => setShowPermissionsModal(false)}
            workerName={selectedPompiste.name}
            workerRole="pompiste"
            currentPermissions={selectedPompiste.permissions || {}}
            onSave={(newPermissions) => {
              dispatch({
                type: 'UPDATE_POMPISTE',
                payload: {
                  ...selectedPompiste,
                  permissions: newPermissions
                }
              });
              dispatch({
                type: 'ADD_TOAST',
                payload: {
                  type: 'success',
                  message: "Permissions du pompiste sauvegardées avec succès."
                }
              });
            }}
          />
        )}
      </AnimatePresence>

      {/* Confirm Delete */}
      <ConfirmDialog
        isOpen={showConfirmDelete}
        title="Supprimer Pompiste"
        message={`Êtes-vous sûr de vouloir supprimer ${selectedPompiste?.name}? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        danger={true}
        onConfirm={handleDeletePompiste}
        onCancel={() => setShowConfirmDelete(false)}
      />

      {/* Activate Account Modal */}
      <AnimatePresence>
        {showActivateModal && activatingPompiste && (
          <div className="modal-shell z-[70]">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowActivateModal(false); setActivatePassword(""); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden border border-slate-100">
              <div className="p-6 bg-gradient-to-r from-amber-500 to-amber-600 text-white flex items-center justify-between">
                <h3 className="font-black uppercase tracking-widest italic flex items-center gap-2">
                  <Zap className="w-4 h-4" /> ACTIVER LE COMPTE
                </h3>
                <button onClick={() => { setShowActivateModal(false); setActivatePassword(""); }} className="p-2 hover:bg-white/10 rounded-lg"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-slate-600 font-bold">
                  Créer un compte d'accès pour <span className="text-blue-900">{activatingPompiste.name}</span>
                  {' '}(<code className="text-xs bg-slate-100 px-1 rounded">{activatingPompiste.username}</code>)
                </p>
                <div className="space-y-2">
                  <label className="text-[9px] font-bold text-slate-400 uppercase ml-1 italic">Mot de passe</label>
                  <input
                    type="password"
                    className="input-field italic font-black text-sm"
                    placeholder="Minimum 6 caractères"
                    value={activatePassword}
                    onChange={e => setActivatePassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleActivatePompisteAccount()}
                    autoFocus
                  />
                </div>
              </div>
              <div className="p-6 bg-gradient-to-r from-slate-50 to-amber-50 border-t border-slate-200 flex gap-4">
                <button onClick={() => { setShowActivateModal(false); setActivatePassword(""); }} className="flex-1 text-[10px] font-black uppercase text-slate-600 border border-slate-300 rounded-lg py-3 hover:bg-slate-100">Annuler</button>
                <button
                  onClick={handleActivatePompisteAccount}
                  disabled={activateLoading || activatePassword.length < 6}
                  className="flex-[2] bg-gradient-to-r from-amber-500 to-amber-600 disabled:opacity-50 text-white font-black uppercase tracking-widest rounded-lg py-3 text-[10px] flex items-center justify-center gap-2 hover:shadow-lg"
                >
                  {activateLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {activateLoading ? 'ACTIVATION...' : 'ACTIVER'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default Pompistes;

