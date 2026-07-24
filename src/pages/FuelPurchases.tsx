import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList, FileText, CreditCard, Plus, Search, Eye, Edit2, Trash2, X,
  Filter, Download, Calendar, Check, CheckCircle2, AlertCircle, Upload, Camera,
  Loader2, ChevronDown, Info, DollarSign, ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ConfirmDialog from "../components/ConfirmDialog";
import { cn, newId } from "@/src/lib/utils";
import { uploadFile, BUCKETS } from "../lib/supabase";
import {
  useAppState, useAppDispatch, useModulePermission, DeliveryNote, DeliveryNoteItem, FuelInvoice, FuelReceipt,
} from "../store/AppContext";

const todayStr = () => new Date().toISOString().split("T")[0];
const NAVY = "#003087";
const GOLD = "#FFB800";

// Derive a delivery note's tank items (fallback to legacy single-tank fields)
const blItems = (bl: DeliveryNote): DeliveryNoteItem[] => {
  if (bl.items && bl.items.length > 0) return bl.items;
  return [{ id: bl.id, deliveryNoteId: bl.id, tankId: bl.tankId, liters: bl.liters, pricePerLiter: bl.pricePerLiter, total: bl.total }];
};
const blLiters = (bl: DeliveryNote) => blItems(bl).reduce((a, i) => a + i.liters, 0);

// ─── Main container ─────────────────────────────────────────────────────────

const FuelPurchases = () => {
  const permBL    = useModulePermission('Achats Carburant:Bons de Livraison');
  const permFact  = useModulePermission('Achats Carburant:Facturation');
  const permPaie  = useModulePermission('Achats Carburant:Paiements');

  const tabs = useMemo(() => ([
    { id: "bons" as const,         label: "Bons de Livraison", icon: ClipboardList },
    { id: "facturation" as const,  label: "Facturation",       icon: FileText },
    { id: "paiements" as const,    label: "Paiements",         icon: CreditCard },
  ].filter(t =>
    t.id === "bons" ? permBL.voir : t.id === "facturation" ? permFact.voir : permPaie.voir
  )), [permBL.voir, permFact.voir, permPaie.voir]);

  const [activeTab, setActiveTab] = useState<"bons" | "facturation" | "paiements">("bons");

  // Land on the first tab the worker can actually see, and follow along if
  // permissions change (e.g. admin revokes the currently-open tab).
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some(t => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto pb-12 text-left">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-3xl font-black text-[#003087] uppercase tracking-tighter leading-none">Achats Carburant</h1>
        {tabs.length > 0 && (
          <div className="flex gap-2 bg-white p-1.5 rounded-2xl shadow-lg border border-slate-100">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "px-5 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all",
                    active ? "shadow-md" : "text-slate-500 hover:bg-slate-50"
                  )}
                  style={active ? { backgroundColor: NAVY, color: GOLD } : undefined}
                >
                  <Icon className="w-4 h-4" /> {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {tabs.length === 0 ? (
        <div className="p-12 text-center text-slate-400 font-black uppercase tracking-widest text-xs bg-white rounded-3xl border border-slate-100">
          Aucun accès accordé pour ce module.
        </div>
      ) : (
        <>
          {activeTab === "bons" && permBL.voir && <BonsLivraisonTab />}
          {activeTab === "facturation" && permFact.voir && <FacturationTab />}
          {activeTab === "paiements" && permPaie.voir && <PaiementsTab />}
        </>
      )}
    </div>
  );
};

export default FuelPurchases;

// ─── TAB 1: Bons de Livraison (full CRUD) ─────────────────────────────────────

interface BLFormItem {
  id: string;
  tankId: string;
  liters: number;
  pricePerLiter: number;
}

const BonsLivraisonTab = () => {
  const { deliveryNotes, suppliers, tanks, drivers, settings } = useAppState();
  const perm = useModulePermission('Achats Carburant:Bons de Livraison');
  const dispatch = useAppDispatch();

  // Default purchase price (DA/L) for a tank, from Settings → fuelBuyPrices by fuel type
  const buyPriceForTank = (tankId: string): number => {
    const tank = tanks.find((t) => t.id === tankId);
    if (!tank) return 0;
    return settings.fuelBuyPrices?.[tank.type] ?? 0;
  };

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBL, setSelectedBL] = useState<DeliveryNote | null>(null);
  const [blToDelete, setBlToDelete] = useState<DeliveryNote | null>(null);

  // Driver creation / deletion
  const [showNewDriver, setShowNewDriver] = useState(false);
  const [newDriverName, setNewDriverName] = useState("");
  const [driverToDelete, setDriverToDelete] = useState<{ id: string; name: string } | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("Tous");
  const [showFilters, setShowFilters] = useState(false);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [scanError, setScanError] = useState(false);

  // Form state
  const [form, setForm] = useState({
    id: "",
    date: todayStr(),
    supplierId: "",
    blNumber: "",
    blDate: todayStr(),
    creationDate: todayStr(),
    immatriculation: "",
    driverId: "",
    expiryDate: "",
  });
  const [formItems, setFormItems] = useState<BLFormItem[]>([
    { id: newId(), tankId: "", liters: 0, pricePerLiter: 0 },
  ]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState<File[]>([]);
  // Manual total override — null means the total is auto-computed from the items
  const [manualTotal, setManualTotal] = useState<number | null>(null);

  // Computed totals
  const grandTotal = useMemo(
    () => formItems.reduce((acc, it) => acc + (it.liters || 0) * (it.pricePerLiter || 0), 0),
    [formItems]
  );
  const grandLiters = useMemo(
    () => formItems.reduce((acc, it) => acc + (it.liters || 0), 0),
    [formItems]
  );

  // BL helpers
  const getBLItems = (bl: DeliveryNote): DeliveryNoteItem[] => {
    if (bl.items && bl.items.length > 0) return bl.items;
    return [{ id: bl.id, deliveryNoteId: bl.id, tankId: bl.tankId, liters: bl.liters, pricePerLiter: bl.pricePerLiter, total: bl.total }];
  };
  const blTotalLiters = (bl: DeliveryNote) => getBLItems(bl).reduce((a, i) => a + i.liters, 0);
  const blTankNames = (bl: DeliveryNote) =>
    getBLItems(bl).map((i) => tanks.find((t) => t.id === i.tankId)?.name || "?").join(", ");

  // Filtered list
  const filteredBLs = useMemo(() => {
    return deliveryNotes.filter((bl) => {
      const supplierName = suppliers.find((s) => s.id === bl.supplierId)?.name || "";
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        bl.id.toLowerCase().includes(term) ||
        (bl.blNumber || "").toLowerCase().includes(term) ||
        supplierName.toLowerCase().includes(term);
      const matchesSupplier = supplierFilter === "Tous" || bl.supplierId === supplierFilter;
      const matchesStart = !dateStart || bl.date >= dateStart;
      const matchesEnd = !dateEnd || bl.date <= dateEnd;
      return matchesSearch && matchesSupplier && matchesStart && matchesEnd;
    });
  }, [deliveryNotes, suppliers, searchTerm, supplierFilter, dateStart, dateEnd]);

  const resetForm = () => {
    setForm({ id: newId(), date: todayStr(), supplierId: "", blNumber: "", blDate: todayStr(), creationDate: todayStr(), immatriculation: "", driverId: "", expiryDate: "" });
    setFormItems([{ id: newId(), tankId: "", liters: 0, pricePerLiter: 0 }]);
    setPhotos([]);
    setPendingPhotoFiles([]);
    setManualTotal(null);
    setScanError(false);
    setShowNewDriver(false);
    setNewDriverName("");
  };

  // Create a new driver inline, then auto-select it
  const handleCreateDriver = () => {
    const name = newDriverName.trim();
    if (!name) return;
    const id = newId();
    dispatch({ type: "ADD_DRIVER", payload: { id, name } });
    setForm((f) => ({ ...f, driverId: id }));
    setNewDriverName("");
    setShowNewDriver(false);
    dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Chauffeur ajouté" } });
  };

  // Delete the currently-selected driver
  const confirmDeleteDriver = () => {
    if (!driverToDelete) return;
    dispatch({ type: "DELETE_DRIVER", payload: driverToDelete.id });
    if (form.driverId === driverToDelete.id) setForm((f) => ({ ...f, driverId: "" }));
    dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Chauffeur supprimé" } });
    setDriverToDelete(null);
  };

  const openCreate = () => { setSelectedBL(null); resetForm(); setShowModal(true); };

  const openEdit = (bl: DeliveryNote) => {
    setSelectedBL(bl);
    setForm({
      id: bl.id,
      date: bl.date,
      supplierId: bl.supplierId || "",
      blNumber: bl.blNumber || "",
      blDate: bl.blDate || bl.date || todayStr(),
      creationDate: bl.creationDate || bl.date || todayStr(),
      immatriculation: bl.immatriculation || "",
      driverId: bl.driverId || "",
      expiryDate: bl.expiryDate || "",
    });
    setShowNewDriver(false);
    setNewDriverName("");
    const editItems = getBLItems(bl);
    setFormItems(
      editItems.map((i) => ({ id: i.id || newId(), tankId: i.tankId, liters: i.liters, pricePerLiter: i.pricePerLiter }))
    );
    // If the stored total differs from the computed sum, it was manually overridden
    const computedSum = editItems.reduce((a, i) => a + (i.liters || 0) * (i.pricePerLiter || 0), 0);
    setManualTotal(Math.abs((bl.total || 0) - computedSum) > 0.01 ? bl.total : null);
    setPhotos(bl.photos || []);
    setPendingPhotoFiles([]);
    setScanError(false);
    setShowDetail(false);
    setShowModal(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setScanError(false);
    files.forEach((file: File) => {
      setPendingPhotoFiles((prev) => [...prev, file]);
      setPhotos((prev) => [...prev, URL.createObjectURL(file)]);
    });
  };

  const removePhoto = (idx: number) => {
    const photo = photos[idx];
    if (photo?.startsWith("blob:")) {
      const blobPhotos = photos.filter((p) => p.startsWith("blob:"));
      const bi = blobPhotos.indexOf(photo);
      if (bi >= 0) setPendingPhotoFiles((prev) => prev.filter((_, fi) => fi !== bi));
    }
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const addItemRow = () => setFormItems((prev) => [...prev, { id: newId(), tankId: "", liters: 0, pricePerLiter: 0 }]);
  const removeItemRow = (id: string) => setFormItems((prev) => prev.length > 1 ? prev.filter((i) => i.id !== id) : prev);
  const updateItem = (id: string, patch: Partial<BLFormItem>) => setFormItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  // Adjust tank levels by a RELATIVE delta. The reducer applies it to the live
  // state (and re-derives `degrees` from the conversion curve / GPL percent),
  // and persistence goes through the atomic adjust_tank_level RPC — never an
  // absolute write computed from a possibly-stale component snapshot.
  const applyTankDeltas = (items: { tankId: string; liters: number }[], sign: 1 | -1) => {
    const deltas: Record<string, number> = {};
    items.forEach((i) => { if (!i.tankId) return; deltas[i.tankId] = (deltas[i.tankId] || 0) + sign * (i.liters || 0); });
    const payload = Object.entries(deltas)
      .filter(([, deltaLiters]) => deltaLiters !== 0)
      .map(([tankId, deltaLiters]) => ({ tankId, deltaLiters }));
    if (payload.length > 0) dispatch({ type: "ADJUST_TANK_LEVELS", payload });
  };

  const handleSave = async () => {
    const validItems = formItems.filter((i) => i.tankId && i.liters > 0);
    if (!form.supplierId || !form.blNumber || !form.blDate || validItems.length === 0) {
      dispatch({ type: "ADD_TOAST", payload: { type: "error", message: "Veuillez remplir tous les champs obligatoires (Fournisseur, N° BL, Date BL, au moins une cuve)" } });
      return;
    }
    // Scan is optional — no longer blocks saving.
    setIsLoading(true);
    try {
      let finalPhotos = [...photos];
      if (pendingPhotoFiles.length > 0) {
        const uploadedUrls: string[] = [];
        for (const file of pendingPhotoFiles) {
          const url = await uploadFile(BUCKETS.DELIVERY_PHOTOS, `${form.id}/${Date.now()}-${file.name}`, file);
          if (url) uploadedUrls.push(url);
        }
        let ui = 0;
        finalPhotos = finalPhotos.map((p) => p.startsWith("blob:") && ui < uploadedUrls.length ? uploadedUrls[ui++] : p);
        setPendingPhotoFiles([]);
      }
      const items: DeliveryNoteItem[] = validItems.map((i) => ({ id: i.id, deliveryNoteId: form.id, tankId: i.tankId, liters: i.liters, pricePerLiter: i.pricePerLiter, total: i.liters * i.pricePerLiter }));
      // Total = manual override when the user edited it, otherwise the sum of the items
      const total = manualTotal !== null ? manualTotal : items.reduce((a, i) => a + i.total, 0);
      const first = items[0];

      if (selectedBL) {
        const updated: DeliveryNote = { ...selectedBL, date: form.date, supplierId: form.supplierId, blNumber: form.blNumber, blDate: form.blDate, creationDate: form.creationDate, immatriculation: form.immatriculation || undefined, driverId: form.driverId || undefined, expiryDate: form.expiryDate || undefined, status: "Reçu", tankId: first.tankId, liters: first.liters, pricePerLiter: first.pricePerLiter, items, total, photos: finalPhotos };
        dispatch({ type: "UPDATE_DELIVERY_NOTE", payload: updated });
        // Single net adjustment (−old +new) so rollback and re-apply can't clobber each other
        applyTankDeltas([
          ...getBLItems(selectedBL).map((i) => ({ tankId: i.tankId, liters: -i.liters })),
          ...items.map((i) => ({ tankId: i.tankId, liters: i.liters })),
        ], 1);
        dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Bon de livraison modifié avec succès" } });
      } else {
        const newBL: DeliveryNote = { id: form.id, date: form.date, supplierId: form.supplierId, blNumber: form.blNumber, blDate: form.blDate, creationDate: form.creationDate, immatriculation: form.immatriculation || undefined, driverId: form.driverId || undefined, expiryDate: form.expiryDate || undefined, status: "Reçu", tankId: first.tankId, liters: first.liters, pricePerLiter: first.pricePerLiter, items, total, photos: finalPhotos, payments: [] };
        dispatch({ type: "ADD_DELIVERY_NOTE", payload: newBL });
        applyTankDeltas(items.map((i) => ({ tankId: i.tankId, liters: i.liters })), 1);
        dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Bon de livraison enregistré — Cuves mises à jour" } });
      }
      setShowModal(false);
      setSelectedBL(null);
    } catch {
      dispatch({ type: "ADD_TOAST", payload: { type: "error", message: "Erreur lors de l'enregistrement" } });
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDelete = () => {
    if (!blToDelete) return;
    applyTankDeltas(getBLItems(blToDelete).map((i) => ({ tankId: i.tankId, liters: i.liters })), -1);
    dispatch({ type: "DELETE_DELIVERY_NOTE", payload: blToDelete.id });
    dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Bon de livraison supprimé" } });
    if (selectedBL?.id === blToDelete.id) { setShowDetail(false); setSelectedBL(null); }
    setBlToDelete(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-2xl font-black text-[#003087] uppercase tracking-tighter">Bons de Livraison</h2>
        {perm.creer && (
        <button onClick={openCreate} className="h-12 px-6 bg-[#003087] text-[#FFB800] rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-all shadow-lg">
          <Plus className="w-4 h-4" /> Nouveau Bon de Livraison
        </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <input type="text" placeholder="Rechercher par N° BL, ID ou fournisseur..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input-field pl-12 h-12 border-slate-100 text-xs font-black uppercase tracking-widest" />
          </div>
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="input-field h-12 w-56 text-[10px] font-black uppercase tracking-widest border-slate-100">
            <option value="Tous">Tous les fournisseurs</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => setShowFilters((v) => !v)} className={cn("h-12 px-5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 border transition-all", showFilters ? "bg-[#003087] text-white border-[#003087]" : "bg-white text-slate-500 border-slate-100")}>
            <Filter className="w-4 h-4" /> Filtres
          </button>
        </div>
        <AnimatePresence>
          {showFilters && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap gap-3 items-end overflow-hidden pt-1">
              <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase ml-1">Début</label><input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="input-field h-11 text-xs font-black border-slate-100" /></div>
              <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase ml-1">Fin</label><input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="input-field h-11 text-xs font-black border-slate-100" /></div>
              {(dateStart || dateEnd) && <button onClick={() => { setDateStart(""); setDateEnd(""); }} className="h-11 px-4 text-[10px] font-black uppercase text-red-500 hover:text-red-700">Réinitialiser</button>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-black">
            <thead className="bg-slate-50/50 text-slate-400 text-[10px] uppercase tracking-[0.2em]">
              <tr>
                <th className="px-6 py-5">Date</th>
                <th className="px-6 py-5">Numéro BL</th>
                <th className="px-6 py-5">Fournisseur</th>
                <th className="px-6 py-5">Cuves</th>
                <th className="px-6 py-5 text-right">Total Litres</th>
                <th className="px-6 py-5 text-right">Total DA</th>
                <th className="px-6 py-5 text-center">Statut</th>
                <th className="px-6 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredBLs.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-16 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">Aucun bon de livraison</td></tr>
              ) : filteredBLs.map((bl) => {
                const supplier = suppliers.find((s) => s.id === bl.supplierId);
                return (
                  <tr key={bl.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4 text-[10px] text-slate-400 font-bold uppercase">{new Date(bl.date).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-[#003087] uppercase font-black">{bl.blNumber || `#${bl.id.slice(0, 8)}`}</td>
                    <td className="px-6 py-4 text-slate-700 uppercase">{supplier?.name || "—"}</td>
                    <td className="px-6 py-4 text-[10px] text-slate-500 font-bold">{blTankNames(bl)}</td>
                    <td className="px-6 py-4 text-right text-[#003087] font-black">{blTotalLiters(bl).toLocaleString()} L</td>
                    <td className="px-6 py-4 text-right text-slate-700 font-black">{bl.total.toLocaleString()} DA</td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-[10px] font-black uppercase px-2 py-1 rounded bg-slate-100 text-slate-600">{bl.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setSelectedBL(bl); setShowDetail(true); }} className="p-2 hover:bg-blue-50 text-slate-400 hover:text-[#003087] rounded-lg transition-all" title="Voir détails"><Eye className="w-5 h-5" /></button>
                        {perm.modifier && <button onClick={() => openEdit(bl)} className="p-2 hover:bg-amber-50 text-slate-400 hover:text-amber-600 rounded-lg transition-all" title="Modifier"><Edit2 className="w-5 h-5" /></button>}
                        {perm.supprimer && <button onClick={() => setBlToDelete(bl)} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-all" title="Supprimer"><Trash2 className="w-5 h-5" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowModal(false); setSelectedBL(null); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-3xl rounded-3xl relative z-10 flex flex-col h-[92vh] overflow-hidden shadow-2xl border border-slate-100">
              <div className="p-6 bg-[#003087] text-white flex items-center justify-between shrink-0">
                <h3 className="font-black text-lg uppercase tracking-tighter flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#FFB800]" />
                  {selectedBL ? "Modifier le Bon de Livraison" : "Nouveau Bon de Livraison"}
                </h3>
                <button onClick={() => { setShowModal(false); setSelectedBL(null); }} className="p-3 hover:bg-white/10 rounded-2xl"><X className="w-6 h-6" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                {/* Section 1 — BL Info */}
                <section className="space-y-4">
                  <h4 className="text-[10px] font-black text-[#003087] uppercase tracking-[0.25em] border-b border-slate-100 pb-3">1. Informations du Bon</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Numéro BL *</label><input type="text" value={form.blNumber} onChange={(e) => setForm({ ...form, blNumber: e.target.value })} className="input-field h-11 text-xs font-black uppercase border-slate-200" placeholder="Ex: BL-12345" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Date BL *</label><input type="date" value={form.blDate} onChange={(e) => setForm({ ...form, blDate: e.target.value, date: e.target.value })} className="input-field h-11 text-xs font-black border-slate-200" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Date de création <span className="text-slate-300 normal-case text-[8px]">(Auto)</span></label><input type="date" value={form.creationDate} readOnly disabled title="La date de création est automatique et non modifiable" className="input-field h-11 text-xs font-black border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Immatriculation <span className="text-slate-300 normal-case text-[8px]">(Optionnel)</span></label><input type="text" value={form.immatriculation} onChange={(e) => setForm({ ...form, immatriculation: e.target.value })} className="input-field h-11 text-xs font-black uppercase border-slate-200" placeholder="Ex: 12345-116-16" /></div>
                    <div className="space-y-1 col-span-2"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Fournisseur *</label>
                      <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className="input-field h-11 text-xs font-black uppercase border-slate-200">
                        <option value="">--- Sélectionner Fournisseur ---</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>

                    {/* Chauffeur (driver) */}
                    <div className="space-y-1 col-span-2">
                      <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Chauffeur <span className="text-slate-300 normal-case text-[8px]">(Optionnel)</span></label>
                      {!showNewDriver ? (
                        <div className="flex gap-2">
                          <select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })} className="input-field h-11 text-xs font-black uppercase border-slate-200 flex-1">
                            <option value="">--- Sélectionner Chauffeur ---</option>
                            {(drivers || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          {form.driverId && (
                            <button type="button" onClick={() => { const d = (drivers || []).find((x) => x.id === form.driverId); if (d) setDriverToDelete(d); }} className="h-11 px-3 bg-red-50 text-red-600 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 hover:bg-red-100 transition-all shrink-0" title="Supprimer ce chauffeur">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <button type="button" onClick={() => { setShowNewDriver(true); setNewDriverName(""); }} className="h-11 px-3 bg-[#003087] text-[#FFB800] rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 hover:scale-105 transition-all shrink-0" title="Nouveau chauffeur">
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input type="text" autoFocus value={newDriverName} onChange={(e) => setNewDriverName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateDriver(); } }} className="input-field h-11 text-xs font-black uppercase border-slate-200 flex-1" placeholder="Nom du chauffeur" />
                          <button type="button" onClick={handleCreateDriver} className="h-11 px-4 bg-green-600 text-white rounded-xl text-[9px] font-black uppercase hover:bg-green-700 transition-all shrink-0">Ajouter</button>
                          <button type="button" onClick={() => { setShowNewDriver(false); setNewDriverName(""); }} className="h-11 px-3 bg-slate-100 text-slate-500 rounded-xl shrink-0"><X className="w-4 h-4" /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* Section 2 — Multi-tank Items */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h4 className="text-[10px] font-black text-[#003087] uppercase tracking-[0.25em]">2. Cuves & Quantités</h4>
                    <button onClick={addItemRow} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5" /> Ajouter une cuve
                    </button>
                  </div>
                  <div className="space-y-3">
                    {formItems.map((item) => {
                      const tank = tanks.find((t) => t.id === item.tankId);
                      return (
                        <div key={item.id} className="grid grid-cols-12 gap-2 items-end bg-slate-50/70 p-3 rounded-2xl">
                          <div className="col-span-5 space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Cuve</label>
                            <select value={item.tankId} onChange={(e) => {
                              const tankId = e.target.value;
                              const defaultPrice = buyPriceForTank(tankId);
                              // Auto-apply the configured purchase price for this fuel type.
                              // (Overwrites on tank change; field stays editable for manual overrides.)
                              updateItem(item.id, { tankId, ...(defaultPrice > 0 ? { pricePerLiter: defaultPrice } : {}) });
                            }} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-black uppercase focus:outline-none">
                              <option value="">--- Cuve ---</option>
                              {tanks.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
                            </select>
                            {tank && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                <span className="inline-block text-[8px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Niveau actuel: {tank.current.toLocaleString()} L</span>
                                {buyPriceForTank(item.tankId) > 0 && (
                                  <span className="inline-block text-[8px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Prix d'achat ({tank.type}): {buyPriceForTank(item.tankId).toLocaleString()} DA/L</span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="col-span-3 space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Litres</label>
                            <input type="number" value={item.liters || ""} placeholder="0" onChange={(e) => updateItem(item.id, { liters: parseFloat(e.target.value) || 0 })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-black text-center focus:outline-none" />
                          </div>
                          <div className="col-span-3 space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Prix / L</label>
                            <input type="number" step="0.01" value={item.pricePerLiter || ""} placeholder="0.00" onChange={(e) => updateItem(item.id, { pricePerLiter: parseFloat(e.target.value) || 0 })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-black text-center focus:outline-none" />
                          </div>
                          <div className="col-span-1 flex items-center justify-center">
                            <button onClick={() => removeItemRow(item.id)} disabled={formItems.length <= 1} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30"><X className="w-4 h-4" /></button>
                          </div>
                          <div className="col-span-12 text-right text-[10px] font-black text-slate-500 uppercase">
                            Sous-total: {((item.liters || 0) * (item.pricePerLiter || 0)).toLocaleString()} DA
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-slate-900 rounded-2xl px-5 py-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Total ({grandLiters.toLocaleString()} L)</span>
                        {manualTotal !== null && (
                          <span className="text-[8px] font-black text-[#FFB800]/70 uppercase tracking-widest">Total modifié manuellement</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          value={manualTotal !== null ? manualTotal : Math.round(grandTotal * 100) / 100}
                          onChange={(e) => setManualTotal(e.target.value === "" ? 0 : parseFloat(e.target.value))}
                          className="w-40 bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-right text-lg font-black text-[#FFB800] focus:outline-none focus:border-[#FFB800]"
                          title="Total modifiable manuellement"
                        />
                        <span className="text-[10px] opacity-40 text-white font-black">DA</span>
                        {manualTotal !== null && (
                          <button type="button" onClick={() => setManualTotal(null)} title="Recalculer automatiquement" className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/70 rounded-lg text-[8px] font-black uppercase tracking-widest">Auto</button>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Section 3 — Mandatory Scan */}
                <section className={cn("space-y-4 p-5 border-2 rounded-2xl", scanError ? "border-red-300 bg-red-50/30" : "border-slate-100 bg-white")}>
                  <h4 className={cn("text-[10px] font-black uppercase tracking-[0.25em] border-b pb-3 flex items-center gap-2", scanError ? "text-red-600 border-red-100" : "text-slate-400 border-slate-100")}>
                    <Camera className="w-4 h-4" /> Scanner le Bon de Livraison <span className="text-slate-300 normal-case">(optionnel)</span>
                  </h4>
                  {scanError && <p className="text-[10px] font-black text-red-600 uppercase">Au moins un scan est obligatoire pour enregistrer.</p>}
                  <div className="grid grid-cols-3 gap-3">
                    {photos.map((p, i) => (
                      <div key={i} className="relative aspect-[3/4] rounded-2xl overflow-hidden shadow border border-slate-100 group">
                        {p.toLowerCase().includes(".pdf") ? (
                          <div className="w-full h-full flex items-center justify-center bg-slate-50"><FileText className="w-10 h-10 text-slate-300" /></div>
                        ) : (
                          <img src={p} className="w-full h-full object-cover" alt="BL" />
                        )}
                        <button onClick={() => removePhoto(i)} className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                    <label className="aspect-[3/4] border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-slate-50 cursor-pointer">
                      <Camera className="w-8 h-8 text-slate-300" />
                      <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Ajouter Scan</span>
                      <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileChange} />
                    </label>
                  </div>
                </section>

                {/* Section 4 — Payment due date */}
                <section className="space-y-2">
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Date d'échéance (paiement)</label>
                  <input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} className="input-field h-11 text-xs font-black border-slate-200" />
                </section>
              </div>

              <div className="p-6 bg-slate-50 border-t flex justify-end shrink-0">
                <button onClick={handleSave} disabled={isLoading} className="px-8 h-12 bg-[#003087] text-[#FFB800] rounded-xl text-[10px] font-black uppercase tracking-[0.25em] shadow-xl flex items-center gap-3 disabled:opacity-50">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> {selectedBL ? "Modifier" : "Valider & Enregistrer"}</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {showDetail && selectedBL && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowDetail(false); setSelectedBL(null); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} className="bg-white w-full max-w-3xl rounded-3xl relative z-10 max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
                <h3 className="font-black text-lg text-[#003087] uppercase tracking-tighter">{selectedBL.blNumber || `BL #${selectedBL.id.slice(0, 8)}`}</h3>
                <div className="flex items-center gap-2">
                  {selectedBL.photos && selectedBL.photos.length > 0 && (
                    <a href={selectedBL.photos[0]} target="_blank" rel="noopener noreferrer" className="h-10 px-4 bg-blue-50 text-blue-700 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5"><Download className="w-4 h-4" /> Photo BL</a>
                  )}
                  {perm.modifier && <button onClick={() => openEdit(selectedBL)} className="h-10 px-4 bg-amber-50 text-amber-700 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 hover:bg-amber-100"><Edit2 className="w-4 h-4" /> Modifier</button>}
                  {perm.supprimer && <button onClick={() => { setBlToDelete(selectedBL); setShowDetail(false); }} className="h-10 px-4 bg-red-50 text-red-600 rounded-xl text-[9px] font-black uppercase flex items-center gap-1.5 hover:bg-red-100"><Trash2 className="w-4 h-4" /> Supprimer</button>}
                  <button onClick={() => { setShowDetail(false); setSelectedBL(null); }} className="p-2 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="p-6 space-y-5 text-xs font-bold">
                <div className="grid grid-cols-2 gap-4">
                  <div><span className="text-slate-400 uppercase text-[9px] block mb-1">Fournisseur</span>{suppliers.find((s) => s.id === selectedBL.supplierId)?.name || "—"}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block mb-1">Date BL</span>{selectedBL.blDate || selectedBL.date}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block mb-1">Date de création</span>{selectedBL.creationDate || "—"}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block mb-1">Immatriculation</span>{selectedBL.immatriculation || "—"}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block mb-1">Chauffeur</span>{(drivers || []).find((d) => d.id === selectedBL.driverId)?.name || "—"}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block mb-1">Total Litres</span><span className="text-[#003087] text-base">{blTotalLiters(selectedBL).toLocaleString()} L</span></div>
                  <div><span className="text-slate-400 uppercase text-[9px] block mb-1">Total DA</span><span className="text-[#003087] text-base">{selectedBL.total.toLocaleString()} DA</span></div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-400 text-[9px] uppercase"><tr><th className="px-3 py-2">Cuve</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Litres</th><th className="px-3 py-2 text-right">Prix/L</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {getBLItems(selectedBL).map((it) => {
                        const tank = tanks.find((t) => t.id === it.tankId);
                        return <tr key={it.id}><td className="px-3 py-2 text-[#003087] uppercase">{tank?.name || "?"}</td><td className="px-3 py-2 text-slate-500">{tank?.type || "—"}</td><td className="px-3 py-2 text-right">{it.liters.toLocaleString()} L</td><td className="px-3 py-2 text-right">{it.pricePerLiter.toLocaleString()} DA</td><td className="px-3 py-2 text-right text-[#003087]">{it.total.toLocaleString()} DA</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                {selectedBL.photos && selectedBL.photos.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[9px] text-slate-400 uppercase font-black">Scans du BL</p>
                    <div className="grid grid-cols-3 gap-3">
                      {selectedBL.photos.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-[3/4] rounded-xl overflow-hidden border border-slate-100 block shadow">
                          {url.includes(".pdf") ? <div className="w-full h-full flex items-center justify-center bg-slate-50"><FileText className="w-8 h-8 text-slate-300" /></div> : <img src={url} className="w-full h-full object-cover hover:scale-105 transition-transform" alt="BL" />}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {blToDelete && (
        <ConfirmDialog
          title="Supprimer le bon de livraison"
          message={`Supprimer ${blToDelete.blNumber || `#${blToDelete.id.slice(0, 8)}`} ? Les niveaux de cuve seront ajustés.`}
          confirmLabel="Supprimer"
          onConfirm={confirmDelete}
          onCancel={() => setBlToDelete(null)}
        />
      )}

      {driverToDelete && (
        <ConfirmDialog
          title="Supprimer le chauffeur"
          message={`Supprimer le chauffeur "${driverToDelete.name}" ? Il sera retiré des bons de livraison où il est référencé.`}
          confirmLabel="Supprimer"
          onConfirm={confirmDeleteDriver}
          onCancel={() => setDriverToDelete(null)}
        />
      )}

      <style>{`.custom-scrollbar::-webkit-scrollbar{width:4px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:10px}`}</style>
    </div>
  );
};

// ─── TAB 2: Facturation (full CRUD) ────────────────────────────────────────────

const FacturationTab = () => {
  const { fuelInvoices, deliveryNotes, suppliers, tanks } = useAppState();
  const perm = useModulePermission('Achats Carburant:Facturation');
  const dispatch = useAppDispatch();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<FuelInvoice | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<FuelInvoice | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tous");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [blSearchTerm, setBlSearchTerm] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAppointment, setHasAppointment] = useState(false);

  const blankForm = {
    invoiceNumber: "", invoiceDate: todayStr(), creationDate: todayStr(), receptionDate: "",
    selectedBlIds: [] as string[], tvaActive: true, tvaRate: 19,
    appointmentDate: "", appointmentAmount: 0, appointmentNotes: "",
    invoiceImageUrl: "", notes: "",
  };
  const [form, setForm] = useState(blankForm);
  const [invoiceImageFile, setInvoiceImageFile] = useState<File | null>(null);
  const [invoiceImagePreview, setInvoiceImagePreview] = useState("");
  // Manual total override (null = auto) and mandatory-scan error flag
  const [manualTotal, setManualTotal] = useState<number | null>(null);
  const [scanError, setScanError] = useState(false);

  const selectedBLs = useMemo(
    () => form.selectedBlIds.map((id) => deliveryNotes.find((d) => d.id === id)).filter(Boolean) as DeliveryNote[],
    [form.selectedBlIds, deliveryNotes]
  );

  // Per-fuel-type aggregation + subtotal
  const totals = useMemo(() => {
    const byType: Record<string, { liters: number; total: number }> = {};
    let subtotal = 0;
    selectedBLs.forEach((bl) => {
      blItems(bl).forEach((it) => {
        const type = tanks.find((t) => t.id === it.tankId)?.type || "—";
        byType[type] = byType[type] || { liters: 0, total: 0 };
        byType[type].liters += it.liters;
        byType[type].total += it.total;
        subtotal += it.total;
      });
    });
    const tvaAmount = form.tvaActive ? (subtotal * form.tvaRate) / 100 : 0;
    return { byType, subtotal, tvaAmount, total: subtotal + tvaAmount };
  }, [selectedBLs, tanks, form.tvaActive, form.tvaRate]);

  const filteredInvoices = useMemo(() => {
    return fuelInvoices.filter((f) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch = f.invoiceNumber.toLowerCase().includes(term) || f.id.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "Tous" || f.status === statusFilter;
      const matchesStart = !dateStart || f.invoiceDate >= dateStart;
      const matchesEnd = !dateEnd || f.invoiceDate <= dateEnd;
      return matchesSearch && matchesStatus && matchesStart && matchesEnd;
    });
  }, [fuelInvoices, searchTerm, statusFilter, dateStart, dateEnd]);

  const blResults = useMemo(() => {
    const term = blSearchTerm.toLowerCase();
    return deliveryNotes.filter((d) => !form.selectedBlIds.includes(d.id) && (d.id.toLowerCase().includes(term) || (d.blNumber || "").toLowerCase().includes(term)));
  }, [deliveryNotes, blSearchTerm, form.selectedBlIds]);

  const resetForm = () => {
    setForm(blankForm);
    setInvoiceImageFile(null);
    setInvoiceImagePreview("");
    setManualTotal(null);
    setScanError(false);
    setHasAppointment(false);
    setEditingId(null);
  };

  const openCreate = () => { resetForm(); setShowCreateModal(true); };
  const openEdit = (inv: FuelInvoice) => {
    setEditingId(inv.id);
    setForm({
      invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate, creationDate: inv.creationDate,
      receptionDate: inv.receptionDate || "", selectedBlIds: [...inv.deliveryNoteIds], tvaActive: inv.tvaActive,
      tvaRate: inv.tvaRate, appointmentDate: inv.appointmentDate || "", appointmentAmount: inv.appointmentAmount || 0,
      appointmentNotes: inv.appointmentNotes || "", invoiceImageUrl: inv.invoiceImageUrl || "", notes: inv.notes || "",
    });
    setHasAppointment(!!inv.appointmentDate);
    setInvoiceImagePreview(inv.invoiceImageUrl || "");
    setInvoiceImageFile(null);
    // Detect a previously-overridden total (differs from HT + TVA)
    setManualTotal(Math.abs((inv.total || 0) - ((inv.subtotal || 0) + (inv.tvaAmount || 0))) > 0.01 ? inv.total : null);
    setScanError(false);
    setShowDetailModal(false);
    setShowCreateModal(true);
  };

  const addBl = (id: string) => setForm((f) => ({ ...f, selectedBlIds: [...f.selectedBlIds, id] }));
  const removeBl = (id: string) => setForm((f) => ({ ...f, selectedBlIds: f.selectedBlIds.filter((x) => x !== id) }));

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInvoiceImageFile(file);
    setInvoiceImagePreview(URL.createObjectURL(file));
    setScanError(false);
  };

  const handleSave = async () => {
    if (!form.invoiceNumber || !form.invoiceDate || form.selectedBlIds.length === 0) {
      dispatch({ type: "ADD_TOAST", payload: { type: "error", message: "N° Facture, date et au moins un BL sont requis" } });
      return;
    }
    // Scan of the invoice is optional — no longer blocks saving.
    setIsLoading(true);
    try {
      let imageUrl = form.invoiceImageUrl;
      if (invoiceImageFile) {
        const id = editingId || newId();
        const url = await uploadFile(BUCKETS.INVOICES, `fuel-invoice-${id}-${Date.now()}`, invoiceImageFile);
        if (url) imageUrl = url;
      }
      // Effective total = manual override when set, otherwise HT + TVA
      const effectiveTotal = manualTotal !== null ? manualTotal : totals.total;

      if (editingId) {
        const existing = fuelInvoices.find((f) => f.id === editingId)!;
        const updated: FuelInvoice = {
          ...existing,
          invoiceNumber: form.invoiceNumber, invoiceDate: form.invoiceDate, creationDate: form.creationDate,
          receptionDate: form.receptionDate || undefined, deliveryNoteIds: form.selectedBlIds,
          tvaActive: form.tvaActive, tvaRate: form.tvaRate, subtotal: totals.subtotal, tvaAmount: totals.tvaAmount,
          total: effectiveTotal, rest: Math.max(0, effectiveTotal - existing.amountPaid),
          appointmentDate: hasAppointment ? form.appointmentDate || undefined : undefined,
          appointmentAmount: hasAppointment ? form.appointmentAmount : undefined,
          appointmentNotes: hasAppointment ? form.appointmentNotes || undefined : undefined,
          invoiceImageUrl: imageUrl || undefined, notes: form.notes || undefined,
        };
        dispatch({ type: "UPDATE_FUEL_INVOICE", payload: updated });
        dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Facture modifiée" } });
      } else {
        const invoice: FuelInvoice = {
          id: newId(), invoiceNumber: form.invoiceNumber, invoiceDate: form.invoiceDate, creationDate: form.creationDate,
          receptionDate: form.receptionDate || undefined, deliveryNoteIds: form.selectedBlIds,
          tvaActive: form.tvaActive, tvaRate: form.tvaRate, subtotal: totals.subtotal, tvaAmount: totals.tvaAmount,
          total: effectiveTotal, amountPaid: 0, rest: effectiveTotal, status: "Non Payé",
          appointmentDate: hasAppointment ? form.appointmentDate || undefined : undefined,
          appointmentAmount: hasAppointment ? form.appointmentAmount : undefined,
          appointmentNotes: hasAppointment ? form.appointmentNotes || undefined : undefined,
          invoiceImageUrl: imageUrl || undefined, notes: form.notes || undefined,
        };
        dispatch({ type: "ADD_FUEL_INVOICE", payload: invoice });
        dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Facture créée" } });
      }
      setShowCreateModal(false);
      resetForm();
    } catch {
      dispatch({ type: "ADD_TOAST", payload: { type: "error", message: "Erreur lors de l'enregistrement" } });
    } finally {
      setIsLoading(false);
    }
  };

  const statusBadge = (s: FuelInvoice["status"]) =>
    s === "Payé" ? "bg-green-100 text-green-700" : s === "Partiel" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";

  const supplierNamesForInvoice = (inv: FuelInvoice) => {
    const names = new Set<string>();
    inv.deliveryNoteIds.forEach((id) => {
      const bl = deliveryNotes.find((d) => d.id === id);
      const s = suppliers.find((sp) => sp.id === bl?.supplierId);
      if (s) names.add(s.name);
    });
    return [...names].join(", ");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-2xl font-black text-[#003087] uppercase tracking-tighter">Factures Carburant</h2>
        {perm.creer && <button onClick={openCreate} className="h-12 px-6 bg-[#003087] text-[#FFB800] rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-all"><Plus className="w-4 h-4" /> Nouvelle Facture</button>}
      </div>

      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <input type="text" placeholder="Rechercher par N° ou ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input-field pl-12 h-12 border-slate-100 text-xs font-black uppercase tracking-widest" />
          </div>
          <div className="flex gap-1.5">
            {["Tous", "Non Payé", "Payé", "Partiel"].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)} className={cn("h-12 px-4 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all", statusFilter === s ? "bg-[#003087] text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100")}>{s}</button>
            ))}
          </div>
          <button onClick={() => setShowFilters((v) => !v)} className={cn("h-12 px-5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 border", showFilters ? "bg-[#003087] text-white border-[#003087]" : "bg-white text-slate-500 border-slate-100")}><Filter className="w-4 h-4" /> Période</button>
        </div>
        <AnimatePresence>
          {showFilters && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap gap-3 items-end overflow-hidden pt-1">
              <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase ml-1">Début</label><input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="input-field h-11 text-xs font-black border-slate-100" /></div>
              <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase ml-1">Fin</label><input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="input-field h-11 text-xs font-black border-slate-100" /></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-black">
            <thead className="bg-slate-50/50 text-slate-400 text-[10px] uppercase tracking-[0.2em]">
              <tr>
                <th className="px-5 py-5">N° Facture</th>
                <th className="px-5 py-5">Date</th>
                <th className="px-5 py-5 text-center">BLs liés</th>
                <th className="px-5 py-5 text-right">Total HT</th>
                <th className="px-5 py-5 text-right">TVA</th>
                <th className="px-5 py-5 text-right">Total TTC</th>
                <th className="px-5 py-5 text-center">Statut</th>
                <th className="px-5 py-5 text-center">RDV paiement</th>
                <th className="px-5 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredInvoices.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-16 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">Aucune facture</td></tr>
              ) : filteredInvoices.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-5 py-4 text-[#003087] uppercase">{f.invoiceNumber}</td>
                  <td className="px-5 py-4 text-[10px] text-slate-400 font-bold uppercase">{new Date(f.invoiceDate).toLocaleDateString()}</td>
                  <td className="px-5 py-4 text-center text-slate-600">{f.deliveryNoteIds.length}</td>
                  <td className="px-5 py-4 text-right text-slate-700">{f.subtotal.toLocaleString()} DA</td>
                  <td className="px-5 py-4 text-right text-slate-500">{f.tvaAmount.toLocaleString()} DA</td>
                  <td className="px-5 py-4 text-right text-[#003087]">{f.total.toLocaleString()} DA</td>
                  <td className="px-5 py-4 text-center"><span className={cn("text-[10px] font-black uppercase px-2 py-1 rounded", statusBadge(f.status))}>{f.status}</span></td>
                  <td className="px-5 py-4 text-center text-[10px] text-slate-500 font-bold">{f.appointmentDate || "—"}</td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100">
                      <button onClick={() => { setSelectedInvoice(f); setShowDetailModal(true); }} className="p-2 hover:bg-blue-50 text-slate-400 hover:text-[#003087] rounded-lg" title="Détails"><Eye className="w-5 h-5" /></button>
                      {perm.modifier && <button onClick={() => openEdit(f)} className="p-2 hover:bg-amber-50 text-slate-400 hover:text-amber-600 rounded-lg" title="Modifier"><Edit2 className="w-5 h-5" /></button>}
                      {perm.supprimer && <button onClick={() => setInvoiceToDelete(f)} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg" title="Supprimer"><Trash2 className="w-5 h-5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowCreateModal(false); resetForm(); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-4xl rounded-3xl relative z-10 flex flex-col h-[92vh] overflow-hidden shadow-2xl border border-slate-100">
              <div className="p-6 bg-[#003087] text-white flex items-center justify-between shrink-0">
                <h3 className="font-black text-lg uppercase tracking-tighter flex items-center gap-2"><FileText className="w-5 h-5 text-[#FFB800]" /> {editingId ? "Modifier la Facture" : "Nouvelle Facture"}</h3>
                <button onClick={() => { setShowCreateModal(false); resetForm(); }} className="p-3 hover:bg-white/10 rounded-2xl"><X className="w-6 h-6" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                {/* Section 1 */}
                <section className="space-y-4">
                  <h4 className="text-[10px] font-black text-[#003087] uppercase tracking-[0.25em] border-b border-slate-100 pb-3">1. Informations de la facture</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">N° Facture *</label><input type="text" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="input-field h-11 text-xs font-black uppercase border-slate-200" placeholder="Ex: FAC-2026-001" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Date facture *</label><input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} className="input-field h-11 text-xs font-black border-slate-200" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Date de création <span className="text-slate-300 normal-case text-[8px]">(Auto)</span></label><input type="date" value={form.creationDate} readOnly disabled title="La date de création est automatique et non modifiable" className="input-field h-11 text-xs font-black border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed" /></div>
                    <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Date de réception</label><input type="date" value={form.receptionDate} onChange={(e) => setForm({ ...form, receptionDate: e.target.value })} className="input-field h-11 text-xs font-black border-slate-200" /></div>
                  </div>
                </section>

                {/* Section 2 — BLs */}
                <section className="space-y-4">
                  <h4 className="text-[10px] font-black text-[#003087] uppercase tracking-[0.25em] border-b border-slate-100 pb-3">2. Bons de Livraison liés</h4>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                    <input type="text" value={blSearchTerm} onChange={(e) => setBlSearchTerm(e.target.value)} className="input-field pl-11 h-11 text-xs font-black uppercase border-slate-200" placeholder="Rechercher un BL par N° ou ID..." />
                  </div>
                  {blSearchTerm && (
                    <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50">
                      {blResults.length === 0 ? <p className="p-3 text-[10px] text-slate-400 font-bold uppercase">Aucun BL trouvé</p> : blResults.map((d) => (
                        <button key={d.id} onClick={() => addBl(d.id)} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 flex items-center justify-between transition-colors">
                          <span className="text-xs font-black text-[#003087] uppercase">{d.blNumber || `#${d.id.slice(0, 8)}`}</span>
                          <span className="text-[10px] text-slate-400 font-bold">{blLiters(d).toLocaleString()} L • {d.total.toLocaleString()} DA</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedBLs.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedBLs.map((d) => (
                        <span key={d.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-black uppercase">
                          {d.blNumber || `#${d.id.slice(0, 8)}`}
                          <button onClick={() => removeBl(d.id)} className="hover:text-red-600"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  {selectedBLs.map((d) => (
                    <div key={d.id} className="border border-slate-100 rounded-xl p-3 space-y-1">
                      <p className="text-[10px] font-black text-[#003087] uppercase">{d.blNumber || `#${d.id.slice(0, 8)}`} • {suppliers.find((s) => s.id === d.supplierId)?.name || "?"} • {d.blDate || d.date}</p>
                      {blItems(d).map((it) => (
                        <div key={it.id} className="flex justify-between text-[10px] text-slate-500 font-bold">
                          <span>{tanks.find((t) => t.id === it.tankId)?.type || "—"} — {it.liters.toLocaleString()} L × {it.pricePerLiter} DA</span>
                          <span>{it.total.toLocaleString()} DA</span>
                        </div>
                      ))}
                      <p className="text-right text-[10px] font-black text-[#003087]">Total BL: {d.total.toLocaleString()} DA</p>
                    </div>
                  ))}
                  {selectedBLs.length > 0 && (
                    <p className="text-[10px] font-black text-slate-500 uppercase">Fournisseurs: {[...new Set(selectedBLs.map((d) => suppliers.find((s) => s.id === d.supplierId)?.name).filter(Boolean))].join(", ")}</p>
                  )}
                </section>

                {/* Section 3 — Totaux */}
                <section className="space-y-4">
                  <h4 className="text-[10px] font-black text-[#003087] uppercase tracking-[0.25em] border-b border-slate-100 pb-3">3. Totaux</h4>
                  {Object.keys(totals.byType).length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-slate-400 text-[9px] uppercase"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Litres</th><th className="px-3 py-2 text-right">Prix moyen</th><th className="px-3 py-2 text-right">Total DA</th></tr></thead>
                        <tbody className="divide-y divide-slate-50 text-xs font-black">
                          {Object.entries(totals.byType).map(([type, v]: [string, { liters: number; total: number }]) => (
                            <tr key={type}><td className="px-3 py-2 uppercase">{type}</td><td className="px-3 py-2 text-right">{v.liters.toLocaleString()}</td><td className="px-3 py-2 text-right">{v.liters ? (v.total / v.liters).toFixed(2) : 0}</td><td className="px-3 py-2 text-right">{v.total.toLocaleString()}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="bg-slate-50 rounded-2xl p-5 space-y-3">
                    <div className="flex justify-between text-xs font-black text-slate-600"><span>Total HT</span><span>{totals.subtotal.toLocaleString()} DA</span></div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs font-black text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={form.tvaActive} onChange={(e) => setForm({ ...form, tvaActive: e.target.checked })} className="w-4 h-4 accent-[#003087]" /> Appliquer TVA
                      </label>
                      <input type="number" disabled={!form.tvaActive} value={form.tvaRate} onChange={(e) => setForm({ ...form, tvaRate: parseFloat(e.target.value) || 0 })} className="w-20 h-9 text-center text-xs font-black border border-slate-200 rounded-lg disabled:opacity-40" />
                    </div>
                    <div className="flex justify-between text-xs font-black text-slate-600"><span>TVA ({form.tvaRate}%)</span><span>{totals.tvaAmount.toLocaleString()} DA</span></div>
                    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                      <div className="flex flex-col">
                        <span className="text-lg font-black text-[#003087]">TOTAL TTC</span>
                        {manualTotal !== null && <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest">Total modifié manuellement</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          value={manualTotal !== null ? manualTotal : Math.round(totals.total * 100) / 100}
                          onChange={(e) => setManualTotal(e.target.value === "" ? 0 : parseFloat(e.target.value))}
                          className="w-40 bg-white border border-slate-200 rounded-xl px-3 py-2 text-right text-lg font-black text-[#003087] focus:outline-none focus:border-[#003087]"
                          title="Total modifiable manuellement"
                        />
                        <span className="text-[10px] text-slate-400 font-black">DA</span>
                        {manualTotal !== null && (
                          <button type="button" onClick={() => setManualTotal(null)} title="Recalculer automatiquement" className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-lg text-[8px] font-black uppercase tracking-widest">Auto</button>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Section 4 — RDV */}
                <section className="space-y-4">
                  <h4 className="text-[10px] font-black text-[#003087] uppercase tracking-[0.25em] border-b border-slate-100 pb-3">4. Paiement & Rendez-vous</h4>
                  <label className="flex items-center gap-2 text-xs font-black text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={hasAppointment} onChange={(e) => setHasAppointment(e.target.checked)} className="w-4 h-4 accent-[#003087]" /> Définir un rendez-vous de paiement
                  </label>
                  {hasAppointment && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Date</label><input type="date" value={form.appointmentDate} onChange={(e) => setForm({ ...form, appointmentDate: e.target.value })} className="input-field h-11 text-xs font-black border-slate-200" /></div>
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Montant</label><input type="number" value={form.appointmentAmount || ""} onChange={(e) => setForm({ ...form, appointmentAmount: parseFloat(e.target.value) || 0 })} className="input-field h-11 text-xs font-black border-slate-200" /></div>
                      <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Notes</label><input type="text" value={form.appointmentNotes} onChange={(e) => setForm({ ...form, appointmentNotes: e.target.value })} className="input-field h-11 text-xs font-black border-slate-200" /></div>
                    </div>
                  )}
                </section>

                {/* Section 5 — Image (mandatory scan) */}
                <section className={cn("space-y-4 p-5 border-2 rounded-2xl", scanError ? "border-red-300 bg-red-50/30" : "border-slate-100 bg-white")}>
                  <h4 className={cn("text-[10px] font-black uppercase tracking-[0.25em] border-b pb-3 flex items-center gap-2", scanError ? "text-red-600 border-red-100" : "text-[#003087] border-slate-100")}>
                    <Camera className="w-4 h-4" /> 5. Scanner la facture <span className="text-slate-300 normal-case">(optionnel)</span>
                  </h4>
                  {scanError && <p className="text-[10px] font-black text-red-600 uppercase">Le scan de la facture est obligatoire pour enregistrer.</p>}
                  <div className="flex items-center gap-4">
                    <label className={cn("px-5 py-3 border-2 border-dashed rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 cursor-pointer", scanError ? "bg-red-50 border-red-300 text-red-600" : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100")}>
                      <Camera className="w-4 h-4" /> Ajouter photo de la facture
                      <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleImageChange} />
                    </label>
                    {invoiceImagePreview && (
                      <div className="flex items-center gap-2">
                        <img src={invoiceImagePreview} className="w-16 h-16 object-cover rounded-xl border border-slate-200" alt="facture" />
                        <a href={invoiceImagePreview} target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-black uppercase flex items-center gap-1"><Download className="w-3 h-3" /> Télécharger</a>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-field text-xs font-bold border-slate-200 min-h-[60px]" /></div>
                </section>
              </div>
              <div className="p-6 bg-slate-50 border-t flex justify-end shrink-0">
                <button onClick={handleSave} disabled={isLoading} className="px-8 h-12 bg-[#003087] text-[#FFB800] rounded-xl text-[10px] font-black uppercase tracking-[0.25em] shadow-xl flex items-center gap-3 disabled:opacity-50">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> {editingId ? "Modifier" : "Créer la facture"}</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail modal */}
      <AnimatePresence>
        {showDetailModal && selectedInvoice && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDetailModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} className="bg-white w-full max-w-3xl rounded-3xl relative z-10 max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
                <h3 className="font-black text-lg text-[#003087] uppercase tracking-tighter">Facture {selectedInvoice.invoiceNumber}</h3>
                <button onClick={() => setShowDetailModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4 text-xs font-bold">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-slate-400 uppercase text-[9px] block">Date facture</span>{selectedInvoice.invoiceDate}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Réception</span>{selectedInvoice.receptionDate || "—"}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Fournisseurs</span>{supplierNamesForInvoice(selectedInvoice) || "—"}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Statut</span><span className={cn("px-2 py-0.5 rounded text-[10px]", statusBadge(selectedInvoice.status))}>{selectedInvoice.status}</span></div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Total HT</span>{selectedInvoice.subtotal.toLocaleString()} DA</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">TVA</span>{selectedInvoice.tvaAmount.toLocaleString()} DA</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Total TTC</span><span className="text-[#003087]">{selectedInvoice.total.toLocaleString()} DA</span></div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Payé / Reste</span>{selectedInvoice.amountPaid.toLocaleString()} / {selectedInvoice.rest.toLocaleString()} DA</div>
                </div>
                <div className="space-y-2">
                  <p className="text-[9px] text-slate-400 uppercase font-black">BLs liés</p>
                  {selectedInvoice.deliveryNoteIds.map((id) => {
                    const d = deliveryNotes.find((x) => x.id === id);
                    if (!d) return null;
                    return (
                      <div key={id} className="border border-slate-100 rounded-xl p-3">
                        <p className="text-[10px] font-black text-[#003087] uppercase">{d.blNumber || `#${id.slice(0, 8)}`} • {blLiters(d).toLocaleString()} L • {d.total.toLocaleString()} DA</p>
                        {blItems(d).map((it) => (
                          <div key={it.id} className="flex justify-between text-[10px] text-slate-500"><span>{tanks.find((t) => t.id === it.tankId)?.type || "—"} — {it.liters.toLocaleString()} L</span><span>{it.total.toLocaleString()} DA</span></div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                {selectedInvoice.appointmentDate && <p className="text-[10px] text-amber-700 font-black uppercase">RDV paiement: {selectedInvoice.appointmentDate} — {(selectedInvoice.appointmentAmount || 0).toLocaleString()} DA</p>}
                {selectedInvoice.invoiceImageUrl && (
                  <div className="space-y-2">
                    <p className="text-[9px] text-slate-400 uppercase font-black">Justificatif (image de la facture)</p>
                    {selectedInvoice.invoiceImageUrl.toLowerCase().includes(".pdf") ? (
                      <a href={selectedInvoice.invoiceImageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 h-40 rounded-xl border border-slate-100 bg-slate-50 text-[#003087]"><FileText className="w-10 h-10 opacity-40" /><span className="text-[10px] font-black uppercase">Ouvrir le PDF</span></a>
                    ) : (
                      <a href={selectedInvoice.invoiceImageUrl} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden border border-slate-100">
                        <img src={selectedInvoice.invoiceImageUrl} alt="Facture" className="w-full max-h-80 object-contain bg-slate-50 hover:scale-[1.02] transition-transform" />
                      </a>
                    )}
                    <a href={selectedInvoice.invoiceImageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-[10px] font-black uppercase items-center gap-2"><Download className="w-4 h-4" /> Télécharger / Ouvrir</a>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {invoiceToDelete && (
        <ConfirmDialog title="Supprimer la facture" message={`Supprimer la facture ${invoiceToDelete.invoiceNumber} ?`} confirmLabel="Supprimer" onConfirm={() => { dispatch({ type: "DELETE_FUEL_INVOICE", payload: invoiceToDelete.id }); dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Facture supprimée" } }); setInvoiceToDelete(null); }} onCancel={() => setInvoiceToDelete(null)} />
      )}

      <style>{`.custom-scrollbar::-webkit-scrollbar{width:4px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:10px}`}</style>
    </div>
  );
};

// ─── TAB 3: Paiements (full CRUD) ──────────────────────────────────────────────

const PaiementsTab = () => {
  const { fuelReceipts, fuelInvoices } = useAppState();
  const perm = useModulePermission('Achats Carburant:Paiements');
  const dispatch = useAppDispatch();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<FuelReceipt | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [receiptToDelete, setReceiptToDelete] = useState<FuelReceipt | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [filterDebts, setFilterDebts] = useState(false);
  const [invSearchTerm, setInvSearchTerm] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [payRestReceipt, setPayRestReceipt] = useState<FuelReceipt | null>(null);
  const [payRestAmount, setPayRestAmount] = useState(0);

  const blankForm = {
    receiptNumber: "", receiptDate: todayStr(), creationDate: todayStr(),
    selectedInvoiceIds: [] as string[], amountPaid: 0, isDebtPayment: false, receiptImageUrl: "", notes: "",
  };
  const [form, setForm] = useState(blankForm);
  const [receiptImageFile, setReceiptImageFile] = useState<File | null>(null);
  const [receiptImagePreview, setReceiptImagePreview] = useState("");
  const [scanError, setScanError] = useState(false);

  const selectedInvoices = useMemo(
    () => form.selectedInvoiceIds.map((id) => fuelInvoices.find((f) => f.id === id)).filter(Boolean) as FuelInvoice[],
    [form.selectedInvoiceIds, fuelInvoices]
  );
  const totalInvoiced = useMemo(() => selectedInvoices.reduce((a, f) => a + f.total, 0), [selectedInvoices]);
  const rest = Math.max(0, totalInvoiced - form.amountPaid);

  const filteredReceipts = useMemo(() => {
    return fuelReceipts.filter((r) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch = r.receiptNumber.toLowerCase().includes(term) || r.id.toLowerCase().includes(term);
      const matchesDebt = !filterDebts || r.isDebtPayment;
      const matchesStart = !dateStart || r.receiptDate >= dateStart;
      const matchesEnd = !dateEnd || r.receiptDate <= dateEnd;
      return matchesSearch && matchesDebt && matchesStart && matchesEnd;
    });
  }, [fuelReceipts, searchTerm, filterDebts, dateStart, dateEnd]);

  const invResults = useMemo(() => {
    const term = invSearchTerm.toLowerCase();
    return fuelInvoices.filter((f) => f.status !== "Payé" && !form.selectedInvoiceIds.includes(f.id) && (f.invoiceNumber.toLowerCase().includes(term) || f.id.toLowerCase().includes(term)));
  }, [fuelInvoices, invSearchTerm, form.selectedInvoiceIds]);

  const resetForm = () => { setForm(blankForm); setReceiptImageFile(null); setReceiptImagePreview(""); setScanError(false); setEditingId(null); };
  const openCreate = () => { resetForm(); setShowCreateModal(true); };
  const openEdit = (r: FuelReceipt) => {
    setEditingId(r.id);
    setForm({ receiptNumber: r.receiptNumber, receiptDate: r.receiptDate, creationDate: r.creationDate, selectedInvoiceIds: [...r.invoiceIds], amountPaid: r.amountPaid, isDebtPayment: r.isDebtPayment, receiptImageUrl: r.receiptImageUrl || "", notes: r.notes || "" });
    setReceiptImagePreview(r.receiptImageUrl || "");
    setReceiptImageFile(null);
    setScanError(false);
    setShowDetailModal(false);
    setShowCreateModal(true);
  };

  const addInvoice = (id: string) => setForm((f) => ({ ...f, selectedInvoiceIds: [...f.selectedInvoiceIds, id] }));
  const removeInvoice = (id: string) => setForm((f) => ({ ...f, selectedInvoiceIds: f.selectedInvoiceIds.filter((x) => x !== id) }));

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptImageFile(file);
    setReceiptImagePreview(URL.createObjectURL(file));
    setScanError(false);
  };

  // Mark linked invoices Payé when fully covered
  const markInvoicesPaid = (invoiceIds: string[]) => {
    invoiceIds.forEach((id) => {
      const inv = fuelInvoices.find((f) => f.id === id);
      if (inv && inv.status !== "Payé") {
        dispatch({ type: "UPDATE_FUEL_INVOICE", payload: { ...inv, amountPaid: inv.total, rest: 0, status: "Payé" } });
      }
    });
  };

  const handleSave = async () => {
    if (!form.receiptNumber) {
      dispatch({ type: "ADD_TOAST", payload: { type: "error", message: "Le N° de reçu est requis" } });
      return;
    }
    // Scan of the payment receipt is optional — no longer blocks saving.
    setIsLoading(true);
    try {
      let imageUrl = form.receiptImageUrl;
      if (receiptImageFile) {
        const id = editingId || newId();
        const url = await uploadFile(BUCKETS.INVOICES, `fuel-receipt-${id}-${Date.now()}`, receiptImageFile);
        if (url) imageUrl = url;
      }
      const computedTotalInvoiced = form.isDebtPayment ? 0 : totalInvoiced;
      const computedRest = Math.max(0, computedTotalInvoiced - form.amountPaid);

      if (editingId) {
        const existing = fuelReceipts.find((r) => r.id === editingId)!;
        const updated: FuelReceipt = {
          ...existing, receiptNumber: form.receiptNumber, receiptDate: form.receiptDate, creationDate: form.creationDate,
          invoiceIds: form.isDebtPayment ? [] : form.selectedInvoiceIds, totalInvoiced: computedTotalInvoiced,
          amountPaid: form.amountPaid, rest: computedRest, isDebtPayment: form.isDebtPayment,
          receiptImageUrl: imageUrl || undefined, notes: form.notes || undefined,
        };
        dispatch({ type: "UPDATE_FUEL_RECEIPT", payload: updated });
        if (!form.isDebtPayment && computedRest <= 0 && computedTotalInvoiced > 0) markInvoicesPaid(form.selectedInvoiceIds);
        dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Reçu modifié" } });
      } else {
        const receipt: FuelReceipt = {
          id: newId(), receiptNumber: form.receiptNumber, receiptDate: form.receiptDate, creationDate: form.creationDate,
          invoiceIds: form.isDebtPayment ? [] : form.selectedInvoiceIds, totalInvoiced: computedTotalInvoiced,
          amountPaid: form.amountPaid, rest: computedRest, isDebtPayment: form.isDebtPayment,
          receiptImageUrl: imageUrl || undefined, notes: form.notes || undefined,
        };
        dispatch({ type: "ADD_FUEL_RECEIPT", payload: receipt });
        if (!form.isDebtPayment && form.amountPaid >= computedTotalInvoiced && computedTotalInvoiced > 0) markInvoicesPaid(form.selectedInvoiceIds);
        dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Reçu créé" } });
      }
      setShowCreateModal(false);
      resetForm();
    } catch {
      dispatch({ type: "ADD_TOAST", payload: { type: "error", message: "Erreur lors de l'enregistrement" } });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayRest = () => {
    if (!payRestReceipt || payRestAmount <= 0) return;
    const newAmountPaid = payRestReceipt.amountPaid + payRestAmount;
    const newRest = Math.max(0, payRestReceipt.totalInvoiced - newAmountPaid);
    dispatch({ type: "UPDATE_FUEL_RECEIPT", payload: { ...payRestReceipt, amountPaid: newAmountPaid, rest: newRest } });
    if (newRest <= 0) markInvoicesPaid(payRestReceipt.invoiceIds);
    dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Paiement enregistré" } });
    setPayRestReceipt(null);
    setPayRestAmount(0);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-2xl font-black text-[#003087] uppercase tracking-tighter">Reçus de Paiement</h2>
        {perm.creer && <button onClick={openCreate} className="h-12 px-6 bg-[#003087] text-[#FFB800] rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 transition-all"><Plus className="w-4 h-4" /> Nouveau Reçu</button>}
      </div>

      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <input type="text" placeholder="Rechercher par N° reçu ou ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="input-field pl-12 h-12 border-slate-100 text-xs font-black uppercase tracking-widest" />
          </div>
          <button onClick={() => setFilterDebts((v) => !v)} className={cn("h-12 px-4 rounded-xl text-[9px] font-black uppercase tracking-widest border", filterDebts ? "bg-orange-500 text-white border-orange-500" : "bg-white text-slate-500 border-slate-100")}>Paiements de dettes</button>
          <button onClick={() => setShowFilters((v) => !v)} className={cn("h-12 px-5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 border", showFilters ? "bg-[#003087] text-white border-[#003087]" : "bg-white text-slate-500 border-slate-100")}><Filter className="w-4 h-4" /> Période</button>
        </div>
        <AnimatePresence>
          {showFilters && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap gap-3 items-end overflow-hidden pt-1">
              <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase ml-1">Début</label><input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="input-field h-11 text-xs font-black border-slate-100" /></div>
              <div className="space-y-1"><label className="text-[9px] font-black text-slate-400 uppercase ml-1">Fin</label><input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="input-field h-11 text-xs font-black border-slate-100" /></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-black">
            <thead className="bg-slate-50/50 text-slate-400 text-[10px] uppercase tracking-[0.2em]">
              <tr>
                <th className="px-5 py-5">N° Reçu</th>
                <th className="px-5 py-5">Date</th>
                <th className="px-5 py-5 text-center">Factures</th>
                <th className="px-5 py-5 text-right">Total facturé</th>
                <th className="px-5 py-5 text-right">Payé</th>
                <th className="px-5 py-5 text-right">Reste</th>
                <th className="px-5 py-5 text-center">Type</th>
                <th className="px-5 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredReceipts.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-16 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">Aucun reçu</td></tr>
              ) : filteredReceipts.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-5 py-4 text-[#003087] uppercase">{r.receiptNumber}</td>
                  <td className="px-5 py-4 text-[10px] text-slate-400 font-bold uppercase">{new Date(r.receiptDate).toLocaleDateString()}</td>
                  <td className="px-5 py-4 text-center text-slate-600">{r.invoiceIds.length}</td>
                  <td className="px-5 py-4 text-right text-slate-700">{r.totalInvoiced.toLocaleString()} DA</td>
                  <td className="px-5 py-4 text-right text-green-600">{r.amountPaid.toLocaleString()} DA</td>
                  <td className={cn("px-5 py-4 text-right", r.rest > 0 ? "text-red-600" : "text-slate-400")}>{r.rest.toLocaleString()} DA</td>
                  <td className="px-5 py-4 text-center"><span className={cn("text-[10px] font-black uppercase px-2 py-1 rounded", r.isDebtPayment ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700")}>{r.isDebtPayment ? "Dette" : "Normal"}</span></td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100">
                      {r.rest > 0 && <button onClick={() => { setPayRestReceipt(r); setPayRestAmount(r.rest); }} className="p-2 hover:bg-green-50 text-green-500 hover:text-green-700 rounded-lg" title="Payer le reste"><DollarSign className="w-5 h-5" /></button>}
                      <button onClick={() => { setSelectedReceipt(r); setShowDetailModal(true); }} className="p-2 hover:bg-blue-50 text-slate-400 hover:text-[#003087] rounded-lg" title="Détails"><Eye className="w-5 h-5" /></button>
                      {perm.modifier && <button onClick={() => openEdit(r)} className="p-2 hover:bg-amber-50 text-slate-400 hover:text-amber-600 rounded-lg" title="Modifier"><Edit2 className="w-5 h-5" /></button>}
                      {perm.supprimer && <button onClick={() => setReceiptToDelete(r)} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg" title="Supprimer"><Trash2 className="w-5 h-5" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setShowCreateModal(false); resetForm(); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-3xl rounded-3xl relative z-10 flex flex-col h-[92vh] overflow-hidden shadow-2xl border border-slate-100">
              <div className="p-6 bg-[#003087] text-white flex items-center justify-between shrink-0">
                <h3 className="font-black text-lg uppercase tracking-tighter flex items-center gap-2"><CreditCard className="w-5 h-5 text-[#FFB800]" /> {editingId ? "Modifier le Reçu" : "Nouveau Reçu"}</h3>
                <button onClick={() => { setShowCreateModal(false); resetForm(); }} className="p-3 hover:bg-white/10 rounded-2xl"><X className="w-6 h-6" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                {/* Section 1 */}
                <section className="grid grid-cols-3 gap-4">
                  <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">N° Reçu *</label><input type="text" value={form.receiptNumber} onChange={(e) => setForm({ ...form, receiptNumber: e.target.value })} className="input-field h-11 text-xs font-black uppercase border-slate-200" placeholder="Ex: REC-001" /></div>
                  <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Date du reçu *</label><input type="date" value={form.receiptDate} onChange={(e) => setForm({ ...form, receiptDate: e.target.value })} className="input-field h-11 text-xs font-black border-slate-200" /></div>
                  <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Date de création <span className="text-slate-300 normal-case text-[8px]">(Auto)</span></label><input type="date" value={form.creationDate} readOnly disabled title="La date de création est automatique et non modifiable" className="input-field h-11 text-xs font-black border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed" /></div>
                </section>

                {/* Section 2 — debt toggle + invoices */}
                <section className="space-y-4">
                  <label className="flex items-center gap-2 text-xs font-black text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={form.isDebtPayment} onChange={(e) => setForm({ ...form, isDebtPayment: e.target.checked })} className="w-4 h-4 accent-orange-500" /> Paiement de dette (sans facture)
                  </label>
                  {!form.isDebtPayment && (
                    <>
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                        <input type="text" value={invSearchTerm} onChange={(e) => setInvSearchTerm(e.target.value)} className="input-field pl-11 h-11 text-xs font-black uppercase border-slate-200" placeholder="Rechercher une facture (Non Payé / Partiel)..." />
                      </div>
                      {invSearchTerm && (
                        <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50">
                          {invResults.length === 0 ? <p className="p-3 text-[10px] text-slate-400 font-bold uppercase">Aucune facture</p> : invResults.map((f) => (
                            <button key={f.id} onClick={() => addInvoice(f.id)} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 flex items-center justify-between">
                              <span className="text-xs font-black text-[#003087] uppercase">{f.invoiceNumber}</span>
                              <span className="text-[10px] text-slate-400 font-bold">{f.total.toLocaleString()} DA • reste {f.rest.toLocaleString()}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {selectedInvoices.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {selectedInvoices.map((f) => (
                              <span key={f.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-black uppercase">{f.invoiceNumber}<button onClick={() => removeInvoice(f.id)} className="hover:text-red-600"><X className="w-3 h-3" /></button></span>
                            ))}
                          </div>
                          {selectedInvoices.map((f) => (
                            <div key={f.id} className="flex justify-between text-[10px] font-bold text-slate-500 border-b border-slate-50 py-1"><span>{f.invoiceNumber} • {f.invoiceDate}</span><span>Total {f.total.toLocaleString()} • Reste {f.rest.toLocaleString()}</span></div>
                          ))}
                          <p className="text-right text-xs font-black text-[#003087]">Total facturé = {totalInvoiced.toLocaleString()} DA</p>
                        </div>
                      )}
                    </>
                  )}
                </section>

                {/* Section 3 — amount */}
                <section className="bg-slate-50 rounded-2xl p-5 space-y-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Montant payé *</label>
                    <input type="number" value={form.amountPaid || ""} onChange={(e) => setForm({ ...form, amountPaid: parseFloat(e.target.value) || 0 })} className="input-field h-11 text-sm font-black border-slate-200" placeholder="0" />
                  </div>
                  {!form.isDebtPayment && (
                    <div className={cn("flex justify-between text-sm font-black", rest > 0 ? "text-red-600" : "text-green-600")}>
                      <span>Reste à payer</span><span>{rest.toLocaleString()} DA</span>
                    </div>
                  )}
                </section>

                {/* Section 4 — image (mandatory scan) */}
                <section className={cn("space-y-3 p-5 border-2 rounded-2xl", scanError ? "border-red-300 bg-red-50/30" : "border-slate-100 bg-white")}>
                  <h4 className={cn("text-[10px] font-black uppercase tracking-[0.25em] border-b pb-3 flex items-center gap-2", scanError ? "text-red-600 border-red-100" : "text-[#003087] border-slate-100")}>
                    <Camera className="w-4 h-4" /> Scanner le reçu de paiement <span className="text-slate-300 normal-case">(optionnel)</span>
                  </h4>
                  {scanError && <p className="text-[10px] font-black text-red-600 uppercase">Le scan du reçu est obligatoire pour enregistrer.</p>}
                  <div className="flex items-center gap-4">
                    <label className={cn("px-5 py-3 border-2 border-dashed rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 cursor-pointer", scanError ? "bg-red-50 border-red-300 text-red-600" : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100")}>
                      <Upload className="w-4 h-4" /> Ajouter photo du reçu
                      <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleImageChange} />
                    </label>
                    {receiptImagePreview && (
                      <div className="flex items-center gap-2">
                        <img src={receiptImagePreview} className="w-16 h-16 object-cover rounded-xl border border-slate-200" alt="reçu" />
                        <a href={receiptImagePreview} target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-black uppercase flex items-center gap-1"><Download className="w-3 h-3" /> Télécharger</a>
                      </div>
                    )}
                  </div>
                </section>

                {/* Section 5 — notes */}
                <section className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-field text-xs font-bold border-slate-200 min-h-[60px]" /></section>
              </div>
              <div className="p-6 bg-slate-50 border-t flex justify-end shrink-0">
                <button onClick={handleSave} disabled={isLoading} className="px-8 h-12 bg-[#003087] text-[#FFB800] rounded-xl text-[10px] font-black uppercase tracking-[0.25em] shadow-xl flex items-center gap-3 disabled:opacity-50">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Check className="w-4 h-4" /> {editingId ? "Modifier" : "Créer le reçu"}</>}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Pay rest modal */}
      <AnimatePresence>
        {payRestReceipt && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPayRestReceipt(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-md rounded-3xl relative z-10 shadow-2xl border border-slate-100 p-6 space-y-4">
              <h3 className="font-black text-lg text-[#003087] uppercase tracking-tighter">Payer le reste</h3>
              <p className="text-xs font-bold text-slate-500">Reste actuel: <span className="text-red-600 font-black">{payRestReceipt.rest.toLocaleString()} DA</span></p>
              <div className="space-y-1"><label className="text-[9px] font-black text-slate-500 uppercase ml-1">Montant additionnel</label><input type="number" value={payRestAmount || ""} onChange={(e) => setPayRestAmount(parseFloat(e.target.value) || 0)} className="input-field h-11 text-sm font-black border-slate-200" /></div>
              <div className="flex gap-3">
                <button onClick={() => setPayRestReceipt(null)} className="btn-ghost flex-1">Annuler</button>
                <button onClick={handlePayRest} className="flex-1 px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-green-600 hover:bg-green-700">Confirmer</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail modal */}
      <AnimatePresence>
        {showDetailModal && selectedReceipt && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDetailModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} className="bg-white w-full max-w-2xl rounded-3xl relative z-10 max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
                <h3 className="font-black text-lg text-[#003087] uppercase tracking-tighter">Reçu {selectedReceipt.receiptNumber}</h3>
                <button onClick={() => setShowDetailModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4 text-xs font-bold">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-slate-400 uppercase text-[9px] block">Date</span>{selectedReceipt.receiptDate}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Type</span>{selectedReceipt.isDebtPayment ? "Dette" : "Normal"}</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Total facturé</span>{selectedReceipt.totalInvoiced.toLocaleString()} DA</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Payé</span>{selectedReceipt.amountPaid.toLocaleString()} DA</div>
                  <div><span className="text-slate-400 uppercase text-[9px] block">Reste</span><span className={selectedReceipt.rest > 0 ? "text-red-600" : "text-green-600"}>{selectedReceipt.rest.toLocaleString()} DA</span></div>
                </div>
                {selectedReceipt.invoiceIds.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[9px] text-slate-400 uppercase font-black">Factures liées</p>
                    {selectedReceipt.invoiceIds.map((id) => {
                      const f = fuelInvoices.find((x) => x.id === id);
                      if (!f) return null;
                      return <div key={id} className="flex justify-between border-b border-slate-50 py-1"><span className="text-[#003087] uppercase">{f.invoiceNumber}</span><span>{f.total.toLocaleString()} DA</span></div>;
                    })}
                  </div>
                )}
                {selectedReceipt.notes && <p className="text-slate-500">{selectedReceipt.notes}</p>}
                {selectedReceipt.receiptImageUrl && (
                  <div className="space-y-2">
                    <p className="text-[9px] text-slate-400 uppercase font-black">Justificatif (image du reçu)</p>
                    {selectedReceipt.receiptImageUrl.toLowerCase().includes(".pdf") ? (
                      <a href={selectedReceipt.receiptImageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 h-40 rounded-xl border border-slate-100 bg-slate-50 text-[#003087]"><FileText className="w-10 h-10 opacity-40" /><span className="text-[10px] font-black uppercase">Ouvrir le PDF</span></a>
                    ) : (
                      <a href={selectedReceipt.receiptImageUrl} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden border border-slate-100">
                        <img src={selectedReceipt.receiptImageUrl} alt="Reçu" className="w-full max-h-80 object-contain bg-slate-50 hover:scale-[1.02] transition-transform" />
                      </a>
                    )}
                    <a href={selectedReceipt.receiptImageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-[10px] font-black uppercase items-center gap-2"><Download className="w-4 h-4" /> Télécharger / Ouvrir</a>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {receiptToDelete && (
        <ConfirmDialog title="Supprimer le reçu" message={`Supprimer le reçu ${receiptToDelete.receiptNumber} ?`} confirmLabel="Supprimer" onConfirm={() => { dispatch({ type: "DELETE_FUEL_RECEIPT", payload: receiptToDelete.id }); dispatch({ type: "ADD_TOAST", payload: { type: "success", message: "Reçu supprimé" } }); setReceiptToDelete(null); }} onCancel={() => setReceiptToDelete(null)} />
      )}

      <style>{`.custom-scrollbar::-webkit-scrollbar{width:4px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:10px}`}</style>
    </div>
  );
};
