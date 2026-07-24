/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Layout from "./components/Layout";
import { AppProvider, useAppState, useAppDispatch, UserPermissions } from "./store/AppContext";
import { ToastContainer } from "./components/Toast";
import { useAuth } from "./hooks/useAuth";
import { db, supabase, BUCKETS, getPublicUrl } from "./lib/supabase";
import { installAutoTranslate, sweep } from "./lib/autoTranslate";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Tanks from "./pages/Tanks";
import Pumps from "./pages/Pumps";
import Tracks from "./pages/Tracks";
import Pompistes from "./pages/Pompistes";
import BrigadeChefs from "./pages/BrigadeChefs";
import Brigades from "./pages/Brigades";
import FuelPOS from "./pages/POS";
import Suppliers from "./pages/Suppliers";
import DeliveryNotes from "./pages/DeliveryNotes";
import Products from "./pages/Products";
import Purchases from "./pages/Purchases";
import FuelPurchases from "./pages/FuelPurchases";
import Clients from "./pages/Clients";
import ShopPOS from "./pages/ShopPOS";
import DailyReport from "./pages/DailyReport";
import Expenses from "./pages/Expenses";
import Permissions from "./pages/Permissions";
import Inventory from "./pages/Inventory";
import Statistics from "./pages/Statistics";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Gerants from "./pages/Gerants";
import MagasinWorkers from "./pages/MagasinWorkers";
import MyBrigade from "./pages/MyBrigade";
import MyPayments from "./pages/MyPayments";
import MySettings from "./pages/MySettings";
import ChefBrigade from "./pages/ChefBrigade";

// ─── New business modules (Restaurant / Cafétéria / Lavage / Magasin) ──────────
import { BizProvider } from "./store/BizContext";
import { MODULES, ModuleKey } from "./lib/bizConfig";
import ModuleStock from "./pages/modules/ModuleStock";
import ModulePurchases from "./pages/modules/ModulePurchases";
import ModuleProduction from "./pages/modules/ModuleProduction";
import ModuleComptoir from "./pages/modules/ModuleComptoir";
import ModulePOS from "./pages/modules/ModulePOS";
import ModuleSales from "./pages/modules/ModuleSales";
import ModuleClients from "./pages/modules/ModuleClients";
import ModuleSuppliers from "./pages/modules/ModuleSuppliers";
import ModuleWorkers from "./pages/modules/ModuleWorkers";
import ModuleExpenses from "./pages/modules/ModuleExpenses";
import ModuleCaisse from "./pages/modules/ModuleCaisse";
import ModuleReports from "./pages/modules/ModuleReports";
import ModuleServices from "./pages/modules/ModuleServices";
import ModuleReparations from "./pages/modules/ModuleReparations";
import GeneralReports from "./pages/GeneralReports";

// Builds the route list for one business module based on its capabilities.
function buildModuleRoutes(key: ModuleKey): { path: string; element: React.ReactElement }[] {
  const cfg = MODULES[key];
  const b = cfg.base;
  const routes: { path: string; element: React.ReactElement }[] = [];
  if (cfg.isService) {
    routes.push({ path: `${b}/reparations`, element: <ModuleReparations moduleKey={key} /> });
    routes.push({ path: `${b}/services`, element: <ModuleServices moduleKey={key} /> });
    routes.push({ path: `${b}/stock`, element: <ModuleStock moduleKey={key} /> });
    routes.push({ path: `${b}/purchases`, element: <ModulePurchases moduleKey={key} /> });
    routes.push({ path: `${b}/clients`, element: <ModuleClients moduleKey={key} /> });
    routes.push({ path: `${b}/suppliers`, element: <ModuleSuppliers moduleKey={key} /> });
    routes.push({ path: `${b}/workers`, element: <ModuleWorkers moduleKey={key} /> });
    routes.push({ path: `${b}/expenses`, element: <ModuleExpenses moduleKey={key} /> });
    routes.push({ path: `${b}/caisse`, element: <ModuleCaisse moduleKey={key} /> });
    routes.push({ path: `${b}/reports`, element: <ModuleReports moduleKey={key} /> });
  } else {
    routes.push({ path: `${b}/stock`, element: <ModuleStock moduleKey={key} /> });
    routes.push({ path: `${b}/purchases`, element: <ModulePurchases moduleKey={key} /> });
    if (cfg.hasProduction) {
      routes.push({ path: `${b}/production`, element: <ModuleProduction moduleKey={key} /> });
      routes.push({ path: `${b}/comptoir`, element: <ModuleComptoir moduleKey={key} /> });
    }
    routes.push({ path: `${b}/pos`, element: <ModulePOS moduleKey={key} /> });
    routes.push({ path: `${b}/sales`, element: <ModuleSales moduleKey={key} /> });
    routes.push({ path: `${b}/clients`, element: <ModuleClients moduleKey={key} /> });
    routes.push({ path: `${b}/suppliers`, element: <ModuleSuppliers moduleKey={key} /> });
    routes.push({ path: `${b}/workers`, element: <ModuleWorkers moduleKey={key} /> });
    routes.push({ path: `${b}/expenses`, element: <ModuleExpenses moduleKey={key} /> });
    routes.push({ path: `${b}/caisse`, element: <ModuleCaisse moduleKey={key} /> });
    routes.push({ path: `${b}/reports`, element: <ModuleReports moduleKey={key} /> });
  }
  return routes;
}

const MODULE_ROUTES = (Object.keys(MODULES) as ModuleKey[]).flatMap(buildModuleRoutes);

// ─── Route to Module Mapping ───────────────────────────────────────────────────
/**
 * Maps route paths to permission module IDs for route-level access control.
 * Checked before rendering the component to ensure user has "voir" (view) permission.
 */
const ROUTE_TO_MODULE: Record<string, string> = {
  "/brigades":         "Brigades",
  "/fuel-sales":       "Ventes Carburant",
  "/tanks":            "Cuves",
  "/pumps":            "Pompes",
  "/tracks":           "Pistes",
  "/delivery-notes":   "Livraisons",
  "/fuel-purchases":   "Achats Carburant",
  "/products":         "Produits",
  "/shop-pos":         "Magasin",
  "/purchases":        "Achats",
  "/inventory":        "Inventaires",
  "/clients":          "Clients",
  "/suppliers":        "Fournisseurs",
  "/pompistes":        "Pompistes",
  "/brigade-chefs":    "Chefs de Brigade",
  "/gerants":          "Gérants",
  "/magasin-workers":  "Employés Magasin",
  "/roles-permissions": "Paramètres",
  "/expenses":         "Dépenses",
  "/daily-report":     "Fiche Journalière",
  "/statistics":       "Statistiques",
  "/reports":          "Rapports",
};

// ─── ProtectedRoute Component ─────────────────────────────────────────────────
/**
 * Wraps a route component to check if the current user has permission to view it.
 * For admin users, all routes are allowed. For workers, checks the permission
 * module mapped to this route and requires the "voir" (view) flag.
 * 
 * If permission is denied, redirects to /dashboard with a toast notification.
 */
interface ProtectedRouteProps {
  element: React.ReactElement;
  moduleId?: string; // Optional override; otherwise auto-maps from current path
}

function ProtectedRoute({ element, moduleId }: ProtectedRouteProps): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useAppState();
  const dispatch = useAppDispatch();

  const resolvedModuleId = moduleId || ROUTE_TO_MODULE[location.pathname];

  // Admin always has access
  if (state.currentUserRole === 'admin') {
    return element;
  }

  // Still hydrating — don't redirect yet
  if (state.isLoading) {
    return <></>;
  }

  if (resolvedModuleId) {
    const perms = state.currentUserPermissions;

    // Permissions not resolved yet — wait, do not leak access
    if (!perms) return <></>;

    if (perms[resolvedModuleId]?.voir) {
      return element;
    }

    // Permission denied — redirect
    dispatch({
      type: 'ADD_TOAST',
      payload: {
        type: 'error',
        title: 'Accès refusé',
        message: `Vous n'avez pas accès au module "${resolvedModuleId}".`,
        duration: 3,
      },
    });
    navigate('/dashboard', { replace: true });
    return <Navigate to="/dashboard" replace />;
  }

  return element;
}

// ─── Loading screen ───────────────────────────────────────────────────────────
const AppLoader = () => (
  <div className="flex items-center justify-center min-h-screen"
    style={{ background: "linear-gradient(135deg, #001233 0%, #003087 100%)" }}>
    <div className="flex flex-col items-center gap-5">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #FFB800, #e6a000)", boxShadow: "0 8px 24px rgba(255,184,0,0.4)" }}>
        <span className="text-2xl">⛽</span>
      </div>
      <div className="w-10 h-10 border-4 border-white/20 border-t-[#FFB800] rounded-full animate-spin" />
      <p className="text-white/60 font-semibold text-sm">Chargement de altech station...</p>
    </div>
  </div>
);

// ─── DB loading overlay (shown while Supabase hydrates) ──────────────────────
const DbLoader = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
    <div className="flex flex-col items-center gap-4 p-8 bg-white rounded-3xl shadow-2xl">
      <div className="w-12 h-12 border-4 border-blue-100 border-t-[#003087] rounded-full animate-spin" />
      <p className="text-slate-600 font-semibold text-sm">Chargement des données...</p>
      <p className="text-slate-400 text-xs">Connexion à la base de données Supabase</p>
    </div>
  </div>
);

export default function App() {
  const { i18n } = useTranslation();
  const auth = useAuth();

  useEffect(() => {
    document.documentElement.dir  = i18n.dir();
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  // Runtime FR→AR translation for the hard-coded French page bodies.
  useEffect(() => { installAutoTranslate(); }, []);
  // Re-sweep after each auth/render phase so newly mounted screens translate too.
  useEffect(() => { if (i18n.language === 'ar') sweep(); });

  // While checking session
  if (auth.isLoading) return <AppLoader />;

  // Not authenticated — show login
  if (!auth.isAuthenticated) {
    return (
      <AppProvider>
        <Login
          onLogin={(role, userId) => auth.setManualAuth(role, userId)}
        />
      </AppProvider>
    );
  }

  // Authenticated — load app with Supabase-connected state
  return (
    <AppProvider>
      <BizProvider>
        <AppContent
          userRole={auth.userRole}
          userId={auth.userId}
          onLogout={auth.logout}
        />
      </BizProvider>
    </AppProvider>
  );
}

// ─── Inner app (needs AppProvider) ───────────────────────────────────────────
function AppContent({
  userRole,
  userId,
  onLogout,
}: {
  userRole: string;
  userId?: string;
  onLogout: () => void;
}) {
  const { toasts, isLoading } = useAppState();
  const dispatch = useAppDispatch();

  // Set current user in global state and load profile (name + avatar)
  useEffect(() => {
    // For workers we avoid setting the app `currentUserId` to the auth UID
    // while the worker row is being resolved — otherwise the UI will try
    // to lookup a worker by the auth ID and incorrectly grant access.
    dispatch({
      type: 'SET_CURRENT_USER',
      payload: { role: userRole as any, id: userRole === 'admin' ? userId : undefined },
    });

    if (!userId) return;

    // Load profile asynchronously so the avatar shows immediately after login
    (async () => {
      try {
        if (userRole === 'admin') {
          const profile = await db.getAdminProfile(userId);
          if (profile) {
            const avatarUrl = profile.avatar_url
              ? (profile.avatar_url.startsWith('http')
                  ? profile.avatar_url
                  : getPublicUrl(BUCKETS.STATION_LOGOS, profile.avatar_url))
              : undefined;
            dispatch({
              type: 'SET_CURRENT_USER',
              payload: { role: userRole as any, id: userId, name: profile.name, avatarUrl },
            });
          }
        } else {
          // Worker: resolve via RPC
          const { data: workerRow } = await supabase.rpc('get_my_worker');
          if (workerRow) {
              const w = workerRow as Record<string, any>;
              const rawPhotoUrl = (w.photo_url ?? w.photo) as string | undefined;
              const avatarUrl = rawPhotoUrl
                ? (rawPhotoUrl.startsWith('http')
                    ? rawPhotoUrl
                    : getPublicUrl(BUCKETS.WORKER_PHOTOS, rawPhotoUrl))
                : undefined;
              // Use the worker's application ID (row.id), not the Supabase auth UID
              // so subsequent lookups (permissions, connectedUser) succeed.
              const savedPerms = w.permissions as UserPermissions | null | undefined;
              const hasRealPermissions = savedPerms && Object.keys(savedPerms).length > 0;
              // No automatic default: a worker whose permissions were never
              // programmed gets NOTHING (only the always-on dashboard). Access is
              // granted exclusively by what the admin saved.
              const resolvedPermissions: UserPermissions = hasRealPermissions ? savedPerms! : {};
              dispatch({
                type: 'SET_CURRENT_USER',
                payload: { role: userRole as any, id: w.id as string, name: w.name as string, avatarUrl, permissions: resolvedPermissions },
              });
            }
        }
      } catch {
        // Profile load is best-effort; silently ignore failures
      }
    })();
  }, [userRole, userId, dispatch]);

  return (
    <>
      {/* Show DB loading overlay while Supabase hydrates */}
      {isLoading && <DbLoader />}

      <ToastContainer
        toasts={toasts}
        onClose={(id) => dispatch({ type: 'REMOVE_TOAST', payload: id })}
      />

      <Router>
        <AppRoutes onLogout={onLogout} />
      </Router>
    </>
  );
}

// ─── Routes component (inside Router context so useNavigate works) ─────────────
function AppRoutes({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();

  // Handle logout with redirect to login page
  const handleLogout = async () => {
    await onLogout();
    navigate('/login', { replace: true });
  };

  return (
    <Layout onLogout={handleLogout}>
      <Routes>
        <Route path="/dashboard"        element={<Dashboard />} />

        <Route path="/brigades"         element={<ProtectedRoute element={<Brigades />} moduleId="Brigades" />} />
        <Route path="/fuel-sales"       element={<ProtectedRoute element={<FuelPOS />} moduleId="Ventes Carburant" />} />
        <Route path="/pos"              element={<Navigate to="/fuel-sales" replace />} />

        {/* Fuel */}
        <Route path="/tanks"            element={<ProtectedRoute element={<Tanks />} moduleId="Cuves" />} />
        <Route path="/pumps"            element={<ProtectedRoute element={<Pumps />} moduleId="Pompes" />} />
        <Route path="/tracks"           element={<ProtectedRoute element={<Tracks />} moduleId="Pistes" />} />
        <Route path="/delivery-notes"   element={<ProtectedRoute element={<DeliveryNotes />} moduleId="Livraisons" />} />
        <Route path="/fuel-purchases"   element={<ProtectedRoute element={<FuelPurchases />} moduleId="Achats Carburant" />} />

        {/* Magasin */}
        <Route path="/products"         element={<ProtectedRoute element={<Products />} moduleId="Produits" />} />
        <Route path="/shop-pos"         element={<ProtectedRoute element={<ShopPOS />} moduleId="Magasin" />} />
        <Route path="/purchases"        element={<ProtectedRoute element={<Purchases />} moduleId="Achats" />} />
        <Route path="/inventory"        element={<ProtectedRoute element={<Inventory />} moduleId="Inventaires" />} />

        {/* Clients / Suppliers */}
        <Route path="/clients"          element={<ProtectedRoute element={<Clients />} moduleId="Clients" />} />
        <Route path="/suppliers"        element={<ProtectedRoute element={<Suppliers />} moduleId="Fournisseurs" />} />

        {/* Personnel */}
        <Route path="/pompistes"        element={<ProtectedRoute element={<Pompistes />} moduleId="Pompistes" />} />
        <Route path="/brigade-chefs"    element={<ProtectedRoute element={<BrigadeChefs />} moduleId="Chefs de Brigade" />} />
        <Route path="/gerants"          element={<ProtectedRoute element={<Gerants />} moduleId="Gérants" />} />
        <Route path="/magasin-workers"  element={<ProtectedRoute element={<MagasinWorkers />} moduleId="Employés Magasin" />} />
        <Route path="/roles-permissions" element={<ProtectedRoute element={<Permissions />} moduleId="Paramètres" />} />

        {/* Finances */}
        <Route path="/expenses"         element={<ProtectedRoute element={<Expenses />} moduleId="Dépenses" />} />
        <Route path="/daily-report"     element={<ProtectedRoute element={<DailyReport />} moduleId="Fiche Journalière" />} />

        {/* Analytics */}
        <Route path="/statistics"       element={<ProtectedRoute element={<Statistics />} moduleId="Statistiques" />} />
        <Route path="/reports"          element={<ProtectedRoute element={<Reports />} moduleId="Rapports" />} />

        {/* New business modules (Restaurant / Cafétéria / Lavage / Magasin) */}
        {MODULE_ROUTES.map(r => React.createElement(Route, { key: r.path, path: r.path, element: r.element }))}
        <Route path="/general-reports"  element={<GeneralReports />} />

        {/* Settings & personal */}
        <Route path="/settings"         element={<Settings />} />
        <Route path="/my-brigade"       element={<MyBrigade />} />
        <Route path="/my-payments"      element={<MyPayments />} />
        <Route path="/my-settings"      element={<MySettings />} />
        <Route path="/chef-brigade"     element={<ChefBrigade />} />

        {/* Default */}
        <Route path="*"                 element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}
