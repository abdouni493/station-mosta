/**
 * ─── Business Modules Store ────────────────────────────────────────────────────
 * Lightweight in-memory + localStorage store powering the new commerce/production
 * parts (Restaurant / Cafétéria / Lavage / Magasin). Kept fully separate from the
 * Supabase-backed AppContext so the fuel-station data is never touched.
 *
 * Usage inside a page:
 *   const biz = useBiz('restaurant');
 *   biz.state.products; biz.add('products', {...}); biz.update('sales', {...}); …
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { BizState, ModuleKey, ModuleState, BizCollection } from '../lib/bizConfig';
import { buildSeed } from '../lib/bizSeed';

const STORAGE_KEY = 'stationpro_biz_v1';

// ─── Actions ────────────────────────────────────────────────────────────────────
type Action =
  | { type: 'ADD'; module: ModuleKey; coll: BizCollection; item: any }
  | { type: 'UPDATE'; module: ModuleKey; coll: BizCollection; item: any }
  | { type: 'DELETE'; module: ModuleKey; coll: BizCollection; id: string }
  | { type: 'SET'; module: ModuleKey; coll: BizCollection; items: any[] }
  | { type: 'PATCH'; module: ModuleKey; patch: Partial<ModuleState> }
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
    case 'RESET':
      return buildSeed();
    default:
      return state;
  }
}

function loadInitial(): BizState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Basic shape check: all four modules present.
      if (parsed && parsed.restaurant && parsed.cafeteria && parsed.lavage && parsed.magasin) {
        return parsed as BizState;
      }
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

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
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
