import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, Users, Fuel, ShoppingCart, Store, Truck,
  Package, ClipboardList, UsersRound, Settings, UserCircle,
  LogOut, Map, Wrench, TrendingUp, FileText, CreditCard,
  Target, ChevronDown, Gauge, Receipt,
  BarChart2, Archive, UserCog, DollarSign, Building2, ChevronRight, X,
  Wallet, CalendarCheck, Shield, UserCheck, Calendar,
  FlaskConical, Beaker, ShoppingBag, Car, Utensils, Coffee, Droplets, FileBarChart
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useAppState, UserPermissions } from "../store/AppContext";
import { MODULES, ModuleKey } from "../lib/bizConfig";

// --- Types ---

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  moduleId?: string; // used for permission filtering for gerant
}

interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activePath: string;
  onNavigate: (path: string) => void;
  onLogout?: () => void;
  userRole: 'admin' | 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin';
  userId?: string;
  userPermissions?: UserPermissions;
}

// --- Role badge styles ---

const roleBadge: Record<string, { label: string; bg: string; text: string }> = {
  admin:        { label: "Administrateur", bg: "rgba(255,184,0,0.18)",  text: "#FFB800" },
  pompiste:     { label: "Pompiste",        bg: "rgba(34,197,94,0.18)", text: "#22c55e" },
  chef_brigade: { label: "Chef Brigade",    bg: "rgba(168,85,247,0.18)",text: "#a855f7" },
  gerant:       { label: "Gérant",          bg: "rgba(59,130,246,0.18)",text: "#3b82f6" },
  magasin:      { label: "Employé Magasin", bg: "rgba(236,72,153,0.18)",text: "#ec4899" },
};

// --- Admin nav groups ---
//
// The sidebar is organised by "part" (activity): a reorganised Carburant part
// (the original fuel-station app), then four new commerce/production parts
// (Restaurant, Cafétéria, Lavage & Réparation, Magasin) whose pages live on the
// self-contained BizContext store with constant demo data.

// Builds a nav group for one business module from its capabilities (config).
function buildModuleNavGroup(key: ModuleKey): NavGroup {
  const cfg = MODULES[key];
  const b = cfg.base;
  const items: NavItem[] = [];
  if (cfg.isService) {
    items.push({ label: "Réparations & Lavage", icon: Car,         path: `${b}/reparations` });
    items.push({ label: "Services",             icon: Wrench,      path: `${b}/services` });
    items.push({ label: "Gestion de stock",     icon: Package,     path: `${b}/stock` });
    items.push({ label: "Achats",               icon: ShoppingCart,path: `${b}/purchases` });
    items.push({ label: "Clients",              icon: Users,       path: `${b}/clients` });
    items.push({ label: "Fournisseurs",         icon: Truck,       path: `${b}/suppliers` });
    items.push({ label: "Employés",             icon: UsersRound,  path: `${b}/workers` });
    items.push({ label: "Dépenses",             icon: CreditCard,  path: `${b}/expenses` });
    items.push({ label: "Caisse",               icon: Wallet,      path: `${b}/caisse` });
    items.push({ label: "Rapports",             icon: BarChart2,   path: `${b}/reports` });
  } else {
    items.push({ label: "Gestion de stock",     icon: Package,     path: `${b}/stock` });
    items.push({ label: "Achats",               icon: ShoppingCart,path: `${b}/purchases` });
    if (cfg.hasProduction) {
      items.push({ label: "Production",         icon: FlaskConical,path: `${b}/production` });
      items.push({ label: "Comptoir",           icon: Beaker,      path: `${b}/comptoir` });
    }
    items.push({ label: "Point de vente",       icon: ShoppingBag, path: `${b}/pos` });
    items.push({ label: "Ventes",               icon: Receipt,     path: `${b}/sales` });
    items.push({ label: "Clients",              icon: Users,       path: `${b}/clients` });
    items.push({ label: "Fournisseurs",         icon: Truck,       path: `${b}/suppliers` });
    items.push({ label: "Employés",             icon: UsersRound,  path: `${b}/workers` });
    items.push({ label: "Dépenses",             icon: CreditCard,  path: `${b}/expenses` });
    items.push({ label: "Caisse",               icon: Wallet,      path: `${b}/caisse` });
    items.push({ label: "Rapports",             icon: BarChart2,   path: `${b}/reports` });
  }
  return { id: key, label: cfg.label, items };
}

const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    id: "dashboard",
    items: [{ label: "Tableau de Bord", icon: LayoutDashboard, path: "/dashboard", moduleId: "Tableau de bord" }]
  },
  {
    id: "carburant", label: "Carburant",
    items: [
      { label: "Ventes Carburant",   icon: Fuel,         path: "/fuel-sales",      moduleId: "Ventes Carburant" },
      { label: "Brigades",           icon: Target,       path: "/brigades",        moduleId: "Brigades" },
      { label: "Cuves / Tanks",      icon: Gauge,        path: "/tanks",           moduleId: "Cuves" },
      { label: "Pompes",             icon: Wrench,       path: "/pumps",           moduleId: "Pompes" },
      { label: "Pistes",             icon: Map,          path: "/tracks",          moduleId: "Pistes" },
      { label: "Livraisons",         icon: Truck,        path: "/delivery-notes",  moduleId: "Livraisons" },
      { label: "Achats Carburant",   icon: ShoppingCart, path: "/fuel-purchases",  moduleId: "Achats Carburant" },
      { label: "Pompistes",          icon: UsersRound,   path: "/pompistes",       moduleId: "Pompistes" },
      { label: "Chefs de Brigade",   icon: UserCog,      path: "/brigade-chefs",   moduleId: "Chefs de Brigade" },
      { label: "Gérants",            icon: Building2,    path: "/gerants",         moduleId: "Gérants" },
      { label: "Clients",            icon: Users,        path: "/clients",         moduleId: "Clients" },
      { label: "Fournisseurs",       icon: Truck,        path: "/suppliers",       moduleId: "Fournisseurs" },
      { label: "Dépenses",           icon: CreditCard,   path: "/expenses",        moduleId: "Dépenses" },
      { label: "Fiche Journalière",  icon: FileText,     path: "/daily-report",    moduleId: "Rapports" },
      { label: "Statistiques",       icon: TrendingUp,   path: "/statistics",      moduleId: "Statistiques" },
      { label: "Rapports Carburant", icon: Receipt,      path: "/reports",         moduleId: "Rapports" },
    ]
  },
  buildModuleNavGroup("restaurant"),
  buildModuleNavGroup("cafeteria"),
  buildModuleNavGroup("lavage"),
  buildModuleNavGroup("magasin"),
  {
    id: "systeme", label: "Système",
    items: [
      { label: "Rapports Généraux",    icon: FileBarChart, path: "/general-reports" },
      { label: "Modèles Permissions",  icon: Shield,       path: "/roles-permissions", moduleId: "Paramètres" },
      { label: "Employés Magasin",     icon: Store,        path: "/magasin-workers",   moduleId: "Employés Magasin" },
      { label: "Produits (Station)",   icon: Package,      path: "/products",          moduleId: "Produits" },
      { label: "Vente Magasin (Station)", icon: Store,     path: "/shop-pos",          moduleId: "Magasin" },
      { label: "Achats Magasin (Station)", icon: ShoppingCart, path: "/purchases",     moduleId: "Achats" },
      { label: "Inventaire (Station)", icon: Archive,      path: "/inventory",         moduleId: "Inventaires" },
    ]
  },
];

// --- Worker nav (permission-driven) ---
//
// Worker sidebars are NOT hardcoded per role. They are built by filtering this
// master module map against the worker's saved permissions, so ANY module the
// admin grants (via the Permissions modal) shows up in that worker's sidebar.
//
// `group` controls which section the item lands in; `path` points to the
// worker-facing page for that module.

interface ModuleNavDef { label: string; icon: React.ElementType; path: string; group: string }

const WORKER_MODULE_NAV: Record<string, ModuleNavDef> = {
  // Opérations
  "Ma Brigade":        { label: "Ma Brigade",        icon: Target,       path: "/my-brigade",      group: "ops" },
  "Brigades":          { label: "Brigades",          icon: Target,       path: "/brigades",        group: "ops" },
  "Ventes Carburant":  { label: "Ventes Carburant",  icon: Fuel,         path: "/fuel-sales",      group: "ops" },
  "Magasin":           { label: "Vente Magasin",     icon: Store,        path: "/shop-pos",        group: "ops" },
  // Carburant
  "Cuves":             { label: "Cuves / Tanks",     icon: Gauge,        path: "/tanks",           group: "fuel" },
  "Pompes":            { label: "Pompes",            icon: Wrench,       path: "/pumps",           group: "fuel" },
  "Pistes":            { label: "Pistes",            icon: Map,          path: "/tracks",          group: "fuel" },
  "Achats Carburant":  { label: "Achats Carburant",  icon: ShoppingCart, path: "/fuel-purchases",  group: "fuel" },
  // Magasin
  "Produits":          { label: "Produits",          icon: Package,      path: "/products",        group: "magasin" },
  "Achats":            { label: "Achats Magasin",    icon: ShoppingCart, path: "/purchases",       group: "magasin" },
  "Inventaires":       { label: "Inventaire",        icon: Archive,      path: "/inventory",       group: "magasin" },
  // Contacts
  "Clients":           { label: "Clients",           icon: Users,        path: "/clients",         group: "contacts" },
  "Fournisseurs":      { label: "Fournisseurs",      icon: Truck,        path: "/suppliers",       group: "contacts" },
  // Personnel (RH)
  "Pompistes":         { label: "Pompistes",         icon: UsersRound,   path: "/pompistes",       group: "hr" },
  "Chefs de Brigade":  { label: "Chefs de Brigade",  icon: UserCog,      path: "/brigade-chefs",   group: "hr" },
  "Gérants":           { label: "Gérants",           icon: Building2,    path: "/gerants",         group: "hr" },
  "Employés Magasin":  { label: "Employés Magasin",  icon: Store,        path: "/magasin-workers", group: "hr" },
  // Finances
  "Dépenses":          { label: "Dépenses",          icon: CreditCard,   path: "/expenses",        group: "finance" },
  "Fiche Journalière": { label: "Fiche Journalière", icon: FileText,     path: "/daily-report",    group: "finance" },
  // Analytique
  "Statistiques":      { label: "Statistiques",      icon: BarChart2,    path: "/statistics",      group: "stats" },
  "Rapports":          { label: "Rapports",          icon: Receipt,      path: "/reports",         group: "stats" },
  // Mon compte
  "Mes Paiements":     { label: "Mes Paiements",     icon: Wallet,       path: "/my-payments",     group: "personal" },
};

// Section order + labels for worker sidebars
const WORKER_GROUP_ORDER: { id: string; label?: string }[] = [
  { id: "ops",      label: "Mon Travail" },
  { id: "fuel",     label: "Carburant" },
  { id: "magasin",  label: "Magasin" },
  { id: "contacts", label: "Contacts" },
  { id: "hr",       label: "Personnel" },
  { id: "finance",  label: "Finances" },
  { id: "stats",    label: "Analytique" },
  { id: "personal", label: "Mon Compte" },
];

// Per-role label/path overrides for modules that resolve to a role-specific page.
// e.g. a chef's "Brigades" grant opens *their* brigades page, not the admin one.
const WORKER_NAV_OVERRIDES: Record<string, Record<string, { label?: string; path?: string }>> = {
  chef_brigade: {
    "Brigades": { label: "Mes Brigades", path: "/chef-brigade" },
  },
};

const DASHBOARD_ITEM: NavItem = { label: "Tableau de Bord", icon: LayoutDashboard, path: "/dashboard", moduleId: "Tableau de bord" };

/**
 * Build a worker's sidebar purely from their permissions. Every module with
 * `voir: true` produces a nav item; everything else is hidden. The dashboard is
 * always present (its route is unprotected and serves as the safe landing page).
 */
function buildWorkerNav(role: string, permissions?: UserPermissions): NavGroup[] {
  const groups: NavGroup[] = [{ id: "dashboard", items: [DASHBOARD_ITEM] }];

  const isEmpty = !permissions || Object.keys(permissions).length === 0;
  if (isEmpty) return groups;

  const overrides = WORKER_NAV_OVERRIDES[role] || {};
  // NOTE: a plain object is used (not `new Map()`) because `Map` is imported
  // from lucide-react as an icon in this file and shadows the global Map.
  const byGroup: Record<string, NavItem[]> = {};

  for (const [moduleId, def] of Object.entries(WORKER_MODULE_NAV)) {
    if (!permissions[moduleId]?.voir) continue;
    const ov = overrides[moduleId];
    const item: NavItem = {
      label: ov?.label ?? def.label,
      icon: def.icon,
      path: ov?.path ?? def.path,
      moduleId,
    };
    if (!byGroup[def.group]) byGroup[def.group] = [];
    byGroup[def.group].push(item);
  }

  for (const g of WORKER_GROUP_ORDER) {
    const items = byGroup[g.id];
    if (items && items.length > 0) groups.push({ id: g.id, label: g.label, items });
  }

  return groups;
}

// --- Nav builder function ---

function getNavGroups(
  role: string,
  permissions?: UserPermissions
): NavGroup[] {
  switch (role) {
    case 'pompiste':
    case 'chef_brigade':
    case 'magasin':
    case 'gerant':
      return buildWorkerNav(role, permissions);

    case 'admin':
    default:
      return ADMIN_NAV_GROUPS;
  }
}

// --- i18n label maps (French label → translation key) ---
// The nav data keeps its original French labels; these maps resolve them to
// translation keys at render time so the sidebar flips fully to Arabic.
const LABEL_KEYS: Record<string, string> = {
  "Tableau de Bord": "nav.dashboard",
  "Brigades": "nav.brigades",
  "Mes Brigades": "nav.my_brigades",
  "Ma Brigade": "nav.my_brigade",
  "Vente Magasin": "nav.shop_sale",
  "Ventes Carburant": "nav.fuel_sales",
  "Cuves / Tanks": "nav.tanks",
  "Pompes": "nav.pumps",
  "Pistes": "nav.tracks",
  "Achats Carburant": "nav.fuel_purchases",
  "Produits": "nav.products",
  "Achats Magasin": "nav.shop_purchases",
  "Inventaire": "nav.inventory",
  "Clients": "nav.clients",
  "Fournisseurs": "nav.suppliers",
  "Pompistes": "nav.pompistes",
  "Chefs de Brigade": "nav.brigade_chefs",
  "Gérants": "nav.gerants",
  "Employés Magasin": "nav.magasin_workers",
  "Modèles Permissions": "nav.permission_templates",
  "Dépenses": "nav.expenses",
  "Fiche Journalière": "nav.daily_report",
  "Statistiques": "nav.statistics",
  "Rapports": "nav.reports",
  "Mes Paiements": "nav.my_payments",
};
const GROUP_KEYS: Record<string, string> = {
  "Opérations": "sections.operations",
  "Carburant": "sections.fuel",
  "Magasin": "sections.magasin",
  "Contacts": "sections.contacts",
  "Personnel": "sections.personnel",
  "Finances": "sections.finances",
  "Analytique": "sections.analytics",
  "Mon Travail": "sections.my_work",
  "Mon Compte": "sections.my_account",
};

// --- Settings path per role ---

const SETTINGS_PATH: Record<string, string> = {
  admin:        "/settings",
  pompiste:     "/my-settings",
  chef_brigade: "/my-settings",
  gerant:       "/my-settings",
  magasin:      "/my-settings",
};

// --- Component ---

const Sidebar = ({ isOpen, onClose, activePath, onNavigate, onLogout, userRole, userId, userPermissions }: SidebarProps) => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const trLabel = (label: string) => (LABEL_KEYS[label] ? t(LABEL_KEYS[label]) : label);
  const trGroup = (label?: string) => (label && GROUP_KEYS[label] ? t(GROUP_KEYS[label]) : label);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(["dashboard", "carburant"]);

  const { pompistes, brigadeChefs, gerants, magasinWorkers, users, settings } = useAppState();

  // Resolve connected worker name and initial
  const connectedUser = useMemo(() => {
    if (!userId) return null;
    if (userRole === 'pompiste')     return (pompistes || []).find(p => p.id === userId) ?? null;
    if (userRole === 'chef_brigade') return (brigadeChefs || []).find(c => c.id === userId) ?? null;
    if (userRole === 'gerant')       return (gerants || []).find(g => g.id === userId) ?? null;
    if (userRole === 'magasin')      return (magasinWorkers || []).find(m => m.id === userId) ?? null;
    if (userRole === 'admin')        return users.find(u => u.id === userId) ?? null;
    return null;
  }, [userId, userRole, pompistes, brigadeChefs, gerants, magasinWorkers, users]);

  const navGroups = useMemo(
    () => getNavGroups(userRole, userPermissions),
    [userRole, userPermissions]
  );

  const settingsPath = SETTINGS_PATH[userRole] ?? "/settings";
  const badge = roleBadge[userRole] ?? roleBadge.admin;

  const displayName  = connectedUser?.name ?? (userRole === 'admin' ? t('roles.admin') : t('roles.user'));
  const displayInitial = displayName.charAt(0).toUpperCase();

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const handleNavigate = (path: string) => {
    onNavigate(path);
    if (window.innerWidth < 1280) onClose();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          "fixed top-0 bottom-0 z-50 flex flex-col flex-shrink-0 transition-transform duration-300 ease-in-out overflow-hidden",
          isRtl ? "right-0" : "left-0",
          isOpen ? "translate-x-0" : isRtl ? "translate-x-full" : "-translate-x-full"
        )}
        style={{ width: "var(--sidebar-width)" }}
      >
        {/* Background */}
        <div className="absolute inset-0" style={{
          background: "linear-gradient(170deg, #001233 0%, #001f5c 35%, #003087 70%, #002470 100%)"
        }} />

        {/* Decorative orbs */}
        <div className="absolute top-0 right-0 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,184,0,0.12) 0%, transparent 70%)", transform: "translate(35%,-35%)" }}
        />
        <div className="absolute bottom-1/3 left-0 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(0,68,187,0.3) 0%, transparent 70%)", transform: "translate(-50%,0)" }}
        />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,184,0,0.06) 0%, transparent 70%)", transform: "translate(30%,30%)" }}
        />

        <div className="flex flex-col h-full relative z-10">
          {/* Logo Header */}
          <div className="px-5 py-5 flex items-center gap-3 shrink-0">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0 overflow-hidden"
              style={{ background: "linear-gradient(135deg, #FFB800 0%, #e6a000 100%)", boxShadow: "0 4px 14px rgba(255,184,0,0.45)" }}
            >
              {(settings?.logoUrl || settings?.logo)
                ? <img src={settings.logoUrl || settings.logo} alt="logo" className="w-full h-full object-cover" />
                : <Fuel className="w-5 h-5 text-[#001f5c]" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-white font-black text-lg tracking-tight leading-none">
                {settings?.stationName || settings?.name || "StationPro"}
              </h1>
              <p className="text-[10px] font-semibold uppercase tracking-widest mt-0.5"
                style={{ color: "rgba(255,184,0,0.65)" }}>Naftal System</p>
            </div>
            <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Yellow divider */}
          <div className="mx-5 mb-3 rounded-full"
            style={{ height: "1.5px", background: "linear-gradient(90deg, rgba(255,184,0,0.7) 0%, rgba(255,184,0,0.15) 70%, transparent 100%)" }}
          />

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto px-3 pb-4 custom-scrollbar">
            {navGroups.map((group) => (
              <div key={group.id} className={group.id === "dashboard" ? "mb-2" : "mb-0.5"}>
                {group.label && (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between px-3 py-2 mt-3 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "rgba(147,197,253,0.5)" }}
                  >
                    <span className="text-[9px] font-black uppercase tracking-[0.22em]">{trGroup(group.label)}</span>
                    <ChevronDown
                      className={cn("w-3 h-3 transition-transform duration-200", expandedGroups.includes(group.id) ? "rotate-0" : "-rotate-90")}
                    />
                  </button>
                )}

                <AnimatePresence initial={false}>
                  {(!group.label || expandedGroups.includes(group.id)) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-0.5 pt-0.5">
                        {group.items.map((item) => {
                          const isActive = activePath === item.path;
                          const Icon = item.icon;
                          return (
                            <motion.button
                              key={item.path}
                              onClick={() => handleNavigate(item.path)}
                              whileTap={{ scale: 0.98 }}
                              className={cn("sidebar-link", isActive ? "sidebar-link-active" : "sidebar-link-inactive")}
                            >
                              <div className={cn(
                                "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                                isActive ? "bg-[#001f5c]/20" : "bg-white/6"
                              )}>
                                <Icon className={cn("w-3.5 h-3.5", isActive ? "text-[#001f5c]" : "text-blue-200")} />
                              </div>
                              <span className="text-sm leading-none flex-1">{trLabel(item.label)}</span>
                              {isActive && (
                                <ChevronRight className="w-3 h-3 text-[#001f5c]/50 flex-shrink-0" />
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}

            <div className="my-3 mx-2" style={{ height: "1px", background: "rgba(255,255,255,0.08)" }} />

            {(!userPermissions || !userPermissions["Paramètres"] || userPermissions["Paramètres"].voir) && (
              <button
                onClick={() => handleNavigate(settingsPath)}
                className={cn("sidebar-link", activePath === settingsPath ? "sidebar-link-active" : "sidebar-link-inactive")}
              >
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", activePath === settingsPath ? "bg-[#001f5c]/20" : "bg-white/6")}>
                  <Settings className={cn("w-3.5 h-3.5", activePath === settingsPath ? "text-[#001f5c]" : "text-blue-200")} />
                </div>
                <span className="text-sm">{t('nav.settings')}</span>
                {activePath === settingsPath && <ChevronRight className="w-3 h-3 text-[#001f5c]/50 ml-auto" />}
              </button>
            )}
          </div>

          {/* User Profile Footer */}
          <div className="p-4 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {/* Avatar */}
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 text-[#001f5c]"
                style={{ background: "linear-gradient(135deg, #FFB800, #e6a000)" }}
              >
                {displayInitial}
              </div>

              {/* Name + Badge */}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate leading-none">{displayName}</p>
                <span
                  className="inline-block mt-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider"
                  style={{ background: badge.bg, color: badge.text }}
                >
                  {t(`roles.${userRole}`, { defaultValue: badge.label })}
                </span>
              </div>

              {/* Logout */}
              <button
                className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors group"
                style={{ color: "rgba(147,197,253,0.5)" }}
                title={t('nav.logout')}
                onClick={() => {
                  if (onLogout) {
                    onLogout();
                  }
                }}
              >
                <LogOut className="w-4 h-4 group-hover:text-red-400 transition-colors" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
