/**
 * ─── Business Modules Store ────────────────────────────────────────────────────
 * Lightweight in-memory + localStorage store powering the commerce/production
 * parts (Cafétéria, Lavage & Réparation). Kept fully separate from the
 * Supabase-backed AppContext so the fuel-station data is never touched.
 *
 * Usage inside a page:
 *   const biz = useBiz('cafeteria');
 *   biz.state.products; biz.add('products', {...}); biz.update('sales', {...}); …
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { BizState, ModuleKey, ModuleState, BizCollection, BizSession } from '../lib/bizConfig';
import { buildSeed, EMPTY_MODULE } from '../lib/bizSeed';
import { loadBizStore, saveBizStore, subscribeTable } from '../lib/supabase';
import { loadBizSessions } from '../lib/bizSessions';

const STORAGE_KEY = 'stationpro_biz_v1';

// ─── Actions ────────────────────────────────────────────────────────────────────
type Action =
  | { type: 'ADD'; module: ModuleKey; coll: BizCollection; item: any }
  | { type: 'UPDATE'; module: ModuleKey; coll: BizCollection; item: any }
  | { type: 'DELETE'; module: ModuleKey; coll: BizCollection; id: string }
  | { type: 'SET'; module: ModuleKey; coll: BizCollection; items: any[] }
  | { type: 'PATCH'; module: ModuleKey; patch: Partial<ModuleState> }
  | { type: 'HYDRATE'; state: BizState }
  | { type: 'SET_SESSIONS'; sessions: Record<ModuleKey, BizSession[]> }
  | { type: 'RESET' };

function reducer(state: BizState, action: Action): BizState {
  switch (action.type) {
    case 'ADD': {
      const mod = state[action.module];
      return {
        ...state,
        [action.module]: { ...mod, [action.coll]: [action.item, ...(mod[action.coll] as any[])] },
      };
    }
    case 'UPDATE': {
      const mod = state[action.module];
      return {
        ...state,
        [action.module]: {
          ...mod,
          [action.coll]: (mod[action.coll] as any[]).map(x => (x.id === action.item.id ? action.item : x)),
        },
      };
    }
    case 'DELETE': {
      const mod = state[action.module];
      return {
        ...state,
        [action.module]: {
          ...mod,
          [action.coll]: (mod[action.coll] as any[]).filter(x => x.id !== action.id),
        },
      };
    }
    case 'SET': {
      const mod = state[action.module];
      return { ...state, [action.module]: { ...mod, [action.coll]: action.items } };
    }
    case 'PATCH': {
      const mod = state[action.module];
      return { ...state, [action.module]: { ...mod, ...action.patch } };
    }
    case 'HYDRATE':
      return action.state;
    /**
     * Work sessions come from their own Supabase table, never from the shared
     * JSON blob: the server copy is the truth, and a session created locally
     * that has not reached the table yet (offline) is kept behind it so nothing
     * is ever lost.
     */
    case 'SET_SESSIONS': {
      const next = { ...state } as BizState;
      (['cafeteria', 'lavage'] as ModuleKey[]).forEach(key => {
        const remote = action.sessions[key] || [];
        const known = new Set(remote.map(s => s.id));
        const localOnly = (state[key]?.sessions || []).filter(s => !known.has(s.id));
        next[key] = {
          ...state[key],
          sessions: [...remote, ...localOnly]
            .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()),
        };
      });
      return next;
    }
    case 'RESET':
      return buildSeed();
    default:
      return state;
  }
}

function isValidState(v: any): v is BizState {
  return !!v && !!v.cafeteria && !!v.lavage;
}

/** Collections merged from a removed part into a surviving one. */
const MERGED_COLLECTIONS: BizCollection[] = [
  'categories', 'marques', 'roles', 'products', 'purchases', 'sales',
  'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'reparations',
  'productions', 'fiches', 'comptoir', 'destructions', 'sessions', 'payRequests',
];

/**
 * Brings a state saved by an older build up to the current shape:
 *  • the Restaurant part was removed        → its data folds into Cafétéria
 *  • the Magasin part was removed          → its data folds into Lavage
 *    (that part now hosts the point-de-vente and ventes screens)
 *  • the Services catalogue was removed     → each intervention keeps the sum of
 *    its services as the hand-typed `serviceTotal`
 *  • appointments were removed              → kept as pending interventions
 *  • the new `sessions` / `payRequests` collections are created empty
 *
 * Merging deletes the legacy key, so the migration never runs twice.
 */
function migrate(raw: any): BizState | null {
  if (!raw || typeof raw !== 'object') return null;
  const state: any = { ...raw };

  const fold = (from: string, into: ModuleKey) => {
    const src = state[from];
    if (!src) return;
    const dst = state[into] || EMPTY_MODULE();
    for (const coll of MERGED_COLLECTIONS) {
      const a = Array.isArray(dst[coll]) ? dst[coll] : [];
      const b = Array.isArray(src[coll]) ? src[coll] : [];
      const seen = new Set(a.map((x: any) => x?.id));
      dst[coll] = [...a, ...b.filter((x: any) => x?.id && !seen.has(x.id))];
    }
    state[into] = dst;
    delete state[from];
  };
  fold('restaurant', 'cafeteria');
  fold('magasin', 'lavage');

  for (const key of ['cafeteria', 'lavage'] as ModuleKey[]) {
    const mod = state[key] || EMPTY_MODULE();
    // Guarantee every collection of the current ModuleState exists.
    const base: any = EMPTY_MODULE();
    for (const k of Object.keys(base)) if (!Array.isArray(mod[k])) mod[k] = base[k];

    mod.reparations = (mod.reparations as any[]).map(r => {
      const legacyServices: { price?: number }[] = Array.isArray(r.services) ? r.services : [];
      const serviceTotal = typeof r.serviceTotal === 'number'
        ? r.serviceTotal
        : legacyServices.reduce((s, x) => s + (Number(x.price) || 0), 0);
      const { services, comingDate, ...rest } = r;
      const kind = r.kind === 'appointment' ? 'reparation' : r.kind;
      // One prestation per intervention before the multi-prestation form existed:
      // rebuilding it here means every screen can read `prestations` blindly.
      const prestations = Array.isArray(r.prestations) && r.prestations.length
        ? r.prestations
        : (serviceTotal > 0
          ? [{
            id: `${r.id}-p1`,
            kind: kind === 'mixte' ? 'reparation' : kind,
            label: r.problem || (kind === 'lavage' ? 'Lavage' : 'Réparation'),
            amount: serviceTotal,
            workerIds: Array.isArray(r.workers) ? r.workers : [],
          }]
          : []);
      const productsTotal = (Array.isArray(r.usedProducts) ? r.usedProducts : [])
        .reduce((s: number, x: any) => s + (Number(x.total) || (Number(x.qty) || 0) * (Number(x.unitPrice) || 0)), 0);
      return {
        ...rest,
        serviceTotal,
        prestations,
        // No remise existed before: the subtotal is simply the old total.
        subtotal: typeof r.subtotal === 'number' ? r.subtotal : serviceTotal + productsTotal,
        discountType: r.discountType,
        discountValue: r.discountValue,
        discountAmount: typeof r.discountAmount === 'number' ? r.discountAmount : 0,
        kind,
        status: r.kind === 'appointment' ? 'pending' : r.status,
      };
    });

    // Lavage employees created before the speciality existed are polyvalent, so
    // they keep showing up on both kinds of prestation.
    mod.workers = (mod.workers as any[]).map(w => ({
      ...w,
      workerKind: w.workerKind || (key === 'lavage' ? 'both' : undefined),
    }));
    delete mod.services;
    state[key] = mod;
  }

  // Drop any other unknown top-level part so the store stays exactly two parts.
  for (const k of Object.keys(state)) {
    if (k !== 'cafeteria' && k !== 'lavage') delete state[k];
  }
  return isValidState(state) ? (state as BizState) : null;
}

function loadInitial(): BizState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const migrated = migrate(JSON.parse(raw));
      if (migrated) return migrated;
    }
  } catch { /* ignore corrupt storage */ }
  return buildSeed();
}

// ─── Context ─────────────────────────────────────────────────────────────────────
interface BizContextValue {
  state: BizState;
  dispatch: React.Dispatch<Action>;
}
const Ctx = createContext<BizContextValue | null>(null);

export function BizProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);
  // Skip the very first save: it would push the local/seed state over the
  // server copy before the initial fetch has had a chance to hydrate.
  const hydratedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last snapshot read from `biz_sessions`, re-applied after any blob hydrate so
  // the shared JSON never resurrects a stale session of another employee.
  const sessionsRef = useRef<Record<ModuleKey, BizSession[]> | null>(null);

  /** Re-reads the sessions table (one row per session, per employee). */
  const syncSessions = useCallback(async () => {
    const remote = await loadBizSessions();
    if (!remote) return;   // table absent (migration non passée) — le blob suffit
    sessionsRef.current = remote;
    dispatch({ type: 'SET_SESSIONS', sessions: remote });
  }, []);

  // Pull the shared state once at mount so every user (admin and part
  // employees) works on the same Restaurant / Cafétéria / Lavage / Magasin data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = migrate(await loadBizStore());
      if (cancelled) return;
      if (remote) dispatch({ type: 'HYDRATE', state: remote });
      else saveBizStore(state);   // first run — seed the shared row
      // The blob may carry an old copy of the sessions: the table wins.
      if (sessionsRef.current) dispatch({ type: 'SET_SESSIONS', sessions: sessionsRef.current });
      hydratedRef.current = true;
      syncSessions();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sessions de travail — chaque poste voit en direct l'ouverture / la clôture
  // des autres employés sans jamais écraser leurs lignes.
  useEffect(() => {
    const unsub = subscribeTable('biz_sessions', () => { syncSessions(); });
    // Filet quand le websocket est bloqué (réseau d'entreprise) : au retour sur
    // l'onglet, on relit la table.
    const onFocus = () => { syncSessions(); };
    window.addEventListener('focus', onFocus);
    return () => { unsub(); window.removeEventListener('focus', onFocus); };
  }, [syncSessions]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }

    if (!hydratedRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveBizStore(state); }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ─── Scoped hook ─────────────────────────────────────────────────────────────────
export interface BizApi {
  state: ModuleState;
  all: BizState;
  add: (coll: BizCollection, item: any) => void;
  update: (coll: BizCollection, item: any) => void;
  remove: (coll: BizCollection, id: string) => void;
  set: (coll: BizCollection, items: any[]) => void;
  patch: (patch: Partial<ModuleState>) => void;
}

export function useBiz(module: ModuleKey): BizApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBiz must be used within <BizProvider>');
  const { state, dispatch } = ctx;
  return useMemo<BizApi>(() => ({
    state: state[module],
    all: state,
    add: (coll, item) => dispatch({ type: 'ADD', module, coll, item }),
    update: (coll, item) => dispatch({ type: 'UPDATE', module, coll, item }),
    remove: (coll, id) => dispatch({ type: 'DELETE', module, coll, id }),
    set: (coll, items) => dispatch({ type: 'SET', module, coll, items }),
    patch: (p) => dispatch({ type: 'PATCH', module, patch: p }),
  }), [state, module, dispatch]);
}

// Read-only access to the whole store (used by the General Reports page).
export function useBizAll(): BizState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizAll must be used within <BizProvider>');
  return ctx.state;
}

export function useBizReset() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizReset must be used within <BizProvider>');
  return () => ctx.dispatch({ type: 'RESET' });
}
