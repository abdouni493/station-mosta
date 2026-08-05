/**
 * ─── Business Modules Store ────────────────────────────────────────────────────
 * Store des parties commerciales (Cafétéria, Lavage & Réparation), tenu à part
 * des tables carburant de `AppContext`.
 *
 *   const biz = useBiz('cafeteria');
 *   biz.state.products; biz.add('products', {...}); await biz.flush();
 *
 * ─── POURQUOI UNE CRÉATION NE PEUT PLUS SE PERDRE ──────────────────────────────
 * L'état des parties tient dans UNE ligne JSON partagée. Chaque poste en gardait
 * une copie complète et la RÉÉCRIVAIT en entier — d'où deux pertes de données
 * silencieuses, celles qui faisaient disparaître un produit tout juste créé :
 *
 *   1. AU DÉMARRAGE, la copie du serveur ÉCRASAIT la copie locale. Un produit
 *      créé puis suivi d'un rafraîchissement dans la seconde (avant que l'envoi
 *      différé ne parte) n'existait plus nulle part.
 *   2. ENTRE DEUX POSTES, le dernier qui écrivait gagnait. Le poste B
 *      enregistrait sa copie — vieille de dix minutes — et le produit créé par
 *      le poste A disparaissait.
 *   3. Une écriture refusée par le serveur était AVALÉE : l'écran affichait
 *      « Produit créé » alors que rien n'était parti.
 *
 * Ce qui les remplace :
 *   • FUSION, jamais d'écrasement — `mergeBizState` réunit les deux côtés ligne
 *     par ligne (voir `src/lib/bizSync.ts`), au démarrage comme à l'écriture ;
 *   • LIRE-FUSIONNER-ÉCRIRE à chaque enregistrement, avec un contrôle de
 *     révision côté serveur : une écriture bâtie sur un état périmé est refusée,
 *     refusionnée, puis rejouée ;
 *   • les erreurs REMONTENT — `flush()` rend la main avec le verdict du serveur,
 *     et la création de produit garde un brouillon tant qu'il n'est pas bon.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BizState, ModuleKey, ModuleState, BizCollection, BizSession } from '../lib/bizConfig';
import { buildSeed, EMPTY_MODULE } from '../lib/bizSeed';
import { loadBizStoreSnapshot, saveBizStore, subscribeTable } from '../lib/supabase';
import { loadBizSessions } from '../lib/bizSessions';
import { mergeBizState, stampItem, nowIso, SyncModuleState } from '../lib/bizSync';

const STORAGE_KEY = 'stationpro_biz_v1';

/** Délai avant l'envoi d'une modification (regroupe les rafales de saisie). */
const SAVE_DEBOUNCE_MS = 600;
/** Nombre de refusions autorisées quand le serveur signale un conflit. */
const MAX_CONFLICT_RETRIES = 4;

/** Verdict d'un enregistrement, rendu à l'appelant de `flush()`. */
export interface SaveOutcome {
  ok: boolean;
  /** Renseigné uniquement quand l'enregistrement a échoué. */
  error?: string;
}

// ─── Actions ────────────────────────────────────────────────────────────────────
type Action =
  | { type: 'ADD'; module: ModuleKey; coll: BizCollection; item: any }
  | { type: 'UPDATE'; module: ModuleKey; coll: BizCollection; item: any }
  | { type: 'DELETE'; module: ModuleKey; coll: BizCollection; id: string }
  | { type: 'SET'; module: ModuleKey; coll: BizCollection; items: any[] }
  | { type: 'PATCH'; module: ModuleKey; patch: Partial<ModuleState> }
  /** Remplace l'état par une valeur DÉJÀ fusionnée (hydratation, conflit, pull). */
  | { type: 'REPLACE'; state: BizState }
  | { type: 'SET_SESSIONS'; sessions: Record<ModuleKey, BizSession[]> }
  | { type: 'RESET' };

function reducer(state: BizState, action: Action): BizState {
  switch (action.type) {
    /**
     * Toute écriture locale est HORODATÉE : c'est cet horodatage qui permet à la
     * fusion de savoir quelle version d'une ligne est la plus récente, et donc
     * de ne jamais écraser une création par une copie plus ancienne.
     */
    case 'ADD': {
      const mod = state[action.module] as SyncModuleState;
      const item = stampItem(action.item);
      // Un identifiant recréé ne doit plus être considéré comme supprimé.
      const { [action.item.id]: _removed, ...deletedIds } = mod.deletedIds || {};
      return {
        ...state,
        [action.module]: {
          ...mod,
          deletedIds,
          [action.coll]: [item, ...(mod[action.coll] as any[])],
        },
      };
    }
    case 'UPDATE': {
      const mod = state[action.module];
      const item = stampItem(action.item);
      return {
        ...state,
        [action.module]: {
          ...mod,
          [action.coll]: (mod[action.coll] as any[]).map(x => (x.id === item.id ? item : x)),
        },
      };
    }
    /**
     * Une suppression laisse une PIERRE TOMBALE : sans elle, la fusion avec la
     * copie du serveur ferait revenir la ligne au prochain démarrage.
     */
    case 'DELETE': {
      const mod = state[action.module] as SyncModuleState;
      return {
        ...state,
        [action.module]: {
          ...mod,
          deletedIds: { ...(mod.deletedIds || {}), [action.id]: nowIso() },
          [action.coll]: (mod[action.coll] as any[]).filter(x => x.id !== action.id),
        },
      };
    }
    case 'SET': {
      const mod = state[action.module];
      const at = nowIso();
      return { ...state, [action.module]: { ...mod, [action.coll]: action.items.map(x => stampItem(x, at)) } };
    }
    case 'PATCH': {
      const mod = state[action.module] as SyncModuleState;
      const patch: any = { ...action.patch };
      // L'ordre des accès rapides du POS n'est pas une liste d'entités : il se
      // départage sur son propre horodatage.
      if ('posPinned' in patch) patch.posPinnedUpd = nowIso();
      return { ...state, [action.module]: { ...mod, ...patch } };
    }
    case 'REPLACE':
      return action.state;
    /**
     * Les sessions de travail viennent de leur propre table Supabase, jamais du
     * blob JSON : la copie du serveur fait foi, et une session créée localement
     * qui n'a pas encore atteint la table (hors ligne) est conservée derrière
     * elle pour que rien ne soit perdu.
     */
    case 'SET_SESSIONS': {
      const next = { ...state } as BizState;
      let changed = false;
      (['cafeteria', 'lavage'] as ModuleKey[]).forEach(key => {
        const remote = action.sessions[key] || [];
        const known = new Set(remote.map(s => s.id));
        const localOnly = (state[key]?.sessions || []).filter(s => !known.has(s.id));
        const merged = [...remote, ...localOnly]
          .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
        if (sessionsSignature(merged) === sessionsSignature(state[key]?.sessions || [])) return;
        changed = true;
        next[key] = { ...state[key], sessions: merged };
      });
      // Rien de neuf : rendre le MÊME état évite un ré-enregistrement inutile à
      // chaque retour sur l'onglet.
      return changed ? next : state;
    }
    case 'RESET':
      return buildSeed();
    default:
      return state;
  }
}

/** Empreinte d'une liste de sessions — sert à repérer un rafraîchissement à vide. */
function sessionsSignature(list: BizSession[]): string {
  return list.map(s => `${s.id}|${s.status}|${s.closedAt || ''}|${s.closingCash ?? ''}`).join(';');
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
    // Méta-données de fusion (ajoutées par une version plus récente).
    if (!mod.deletedIds || typeof mod.deletedIds !== 'object') mod.deletedIds = {};

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
/** Ce que l'application peut savoir de l'état de la synchronisation. */
export interface BizSyncState {
  /** Un enregistrement est en cours. */
  saving: boolean;
  /** Des modifications locales ne sont pas encore confirmées par le serveur. */
  pending: boolean;
  /** Dernier échec d'enregistrement (null quand tout va bien). */
  error: string | null;
  /** Dernière confirmation reçue du serveur. */
  lastSavedAt: string | null;
}

interface BizContextValue {
  state: BizState;
  dispatch: React.Dispatch<Action>;
  /** Enregistre tout de suite et rend le verdict du serveur. */
  flush: () => Promise<SaveOutcome>;
  /** Attend qu'une écriture ait bien été prise en compte par le rendu. */
  waitFor: (predicate: (s: BizState) => boolean, timeoutMs?: number) => Promise<boolean>;
  sync: BizSyncState;
}
const Ctx = createContext<BizContextValue | null>(null);

export function BizProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);
  const [sync, setSync] = useState<BizSyncState>({
    saving: false, pending: false, error: null, lastSavedAt: null,
  });
  /** Même chose, lisible sans re-créer les fonctions à chaque changement. */
  const syncRef = useRef(sync);
  const applySync = useCallback((patch: Partial<BizSyncState>) => {
    syncRef.current = { ...syncRef.current, ...patch };
    setSync(syncRef.current);
  }, []);

  /** État courant, lisible depuis du code asynchrone sans dépendre du rendu. */
  const stateRef = useRef(state);
  /**
   * DERNIER état dont le serveur a accusé réception, par RÉFÉRENCE. Tant que
   * `stateRef.current` pointe ailleurs, il reste du travail à envoyer — c'est
   * tout le mécanisme « y a-t-il quelque chose à enregistrer ? ».
   */
  const lastSavedRef = useRef<BizState | null>(null);
  /** Révision de la ligne partagée, pour que le serveur refuse une écriture périmée. */
  const revRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);
  const savingRef = useRef<Promise<SaveOutcome> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last snapshot read from `biz_sessions`, re-applied after any blob hydrate so
  // the shared JSON never resurrects a stale session of another employee.
  const sessionsRef = useRef<Record<ModuleKey, BizSession[]> | null>(null);

  // ── Enregistrement : LIRE → FUSIONNER → ÉCRIRE ────────────────────────────
  /**
   * Envoie l'état au serveur sans jamais écraser le travail de quelqu'un
   * d'autre : on relit d'abord la ligne partagée, on la fusionne avec l'état
   * local, puis on écrit le résultat en indiquant la révision de départ. Si un
   * autre poste a écrit entre-temps, le serveur refuse, rend sa version, et le
   * tour recommence sur la version fusionnée.
   */
  const pushNow = useCallback(async (): Promise<SaveOutcome> => {
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      const snapshot = await loadBizStoreSnapshot();
      const remote = snapshot?.state ? migrate(snapshot.state) : null;

      // Entre cette lecture et le dispatch : aucun `await`, donc aucune
      // écriture de l'utilisateur ne peut se glisser et être perdue.
      const candidate = remote ? mergeBizState(stateRef.current, remote) : stateRef.current;
      if (candidate !== stateRef.current) {
        stateRef.current = candidate;
        dispatch({ type: 'REPLACE', state: candidate });
      }

      const result = await saveBizStore(candidate, snapshot?.rev ?? revRef.current);

      if (result.ok) {
        revRef.current = result.rev ?? null;
        lastSavedRef.current = candidate;
        return { ok: true };
      }
      if (result.conflict) {
        // Quelqu'un a écrit pendant notre envoi : on refusionne et on rejoue.
        revRef.current = result.remote?.rev ?? null;
        continue;
      }
      return { ok: false, error: result.error || 'Enregistrement impossible' };
    }
    return { ok: false, error: 'Conflit persistant avec un autre poste — nouvel essai automatique' };
  }, []);

  /** Envoi différé — reprogrammé tant que la saisie continue. */
  const runSaveRef = useRef<() => Promise<SaveOutcome>>(async () => ({ ok: true }));
  const scheduleSave = useCallback((delay = SAVE_DEBOUNCE_MS) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void runSaveRef.current(); }, delay);
  }, []);

  /** Un seul envoi à la fois ; les appels concurrents attendent le même. */
  const flush = useCallback(async (): Promise<SaveOutcome> => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }

    if (savingRef.current) {
      await savingRef.current.catch(() => undefined);
      // L'envoi précédent emportait peut-être déjà notre modification.
      if (stateRef.current === lastSavedRef.current) {
        const err = syncRef.current.error;
        return err ? { ok: false, error: err } : { ok: true };
      }
    }
    if (stateRef.current === lastSavedRef.current && !syncRef.current.error) return { ok: true };

    applySync({ saving: true });
    const run = pushNow();
    savingRef.current = run;
    let outcome: SaveOutcome;
    try { outcome = await run; } finally { savingRef.current = null; }

    applySync({
      saving: false,
      pending: stateRef.current !== lastSavedRef.current,
      error: outcome.ok ? null : outcome.error,
      ...(outcome.ok ? { lastSavedAt: nowIso() } : {}),
    });

    // De nouvelles modifications sont arrivées pendant l'envoi, ou l'envoi a
    // échoué : on repasse plus tard, l'utilisateur n'a rien à faire.
    if (stateRef.current !== lastSavedRef.current) scheduleSave(outcome.ok ? SAVE_DEBOUNCE_MS : 5_000);
    return outcome;
  }, [pushNow, applySync, scheduleSave]);

  useEffect(() => { runSaveRef.current = flush; }, [flush]);

  /**
   * Attend qu'une écriture soit passée par le rendu avant d'enregistrer.
   * `dispatch` ne met pas `stateRef` à jour tout de suite : sans cette attente,
   * un « créer puis confirmer » enverrait l'état d'AVANT la création et
   * annoncerait un succès qui ne couvre pas le produit.
   */
  const waitFor = useCallback((predicate: (s: BizState) => boolean, timeoutMs = 3_000) => (
    new Promise<boolean>(resolve => {
      const started = Date.now();
      const tick = () => {
        if (predicate(stateRef.current)) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(tick, 25);
      };
      tick();
    })
  ), []);

  /** Re-reads the sessions table (one row per session, per employee). */
  const syncSessions = useCallback(async () => {
    const remote = await loadBizSessions();
    if (!remote) return;   // table absente (migration non passée) — le blob suffit
    sessionsRef.current = remote;
    dispatch({ type: 'SET_SESSIONS', sessions: remote });
  }, []);

  /**
   * Récupère la version du serveur et la FUSIONNE dans l'état local — jamais
   * l'inverse. Quand rien n'attendait d'être envoyé, le résultat est déjà ce que
   * le serveur contient : on l'enregistre comme tel pour ne pas déclencher un
   * ré-envoi en boucle à chaque notification temps réel.
   */
  const pull = useCallback(async () => {
    const snapshot = await loadBizStoreSnapshot();
    if (!snapshot) return;
    const remote = snapshot.state ? migrate(snapshot.state) : null;
    revRef.current = snapshot.rev;
    if (!remote) return;

    const wasClean = stateRef.current === lastSavedRef.current;
    const merged = mergeBizState(stateRef.current, remote);
    stateRef.current = merged;
    dispatch({ type: 'REPLACE', state: merged });
    if (wasClean) lastSavedRef.current = merged;
    if (sessionsRef.current) dispatch({ type: 'SET_SESSIONS', sessions: sessionsRef.current });
  }, []);

  // Premier chargement — la copie du serveur est FUSIONNÉE dans la copie locale,
  // jamais substituée : ce qui a été saisi ici et n'est pas encore parti (produit
  // créé juste avant un rafraîchissement, poste hors ligne) survit et repart.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snapshot = await loadBizStoreSnapshot();
      if (cancelled) return;
      revRef.current = snapshot?.rev ?? null;
      const remote = snapshot?.state ? migrate(snapshot.state) : null;
      if (remote) {
        const merged = mergeBizState(stateRef.current, remote);
        stateRef.current = merged;
        dispatch({ type: 'REPLACE', state: merged });
      }
      // The blob may carry an old copy of the sessions: the table wins.
      if (sessionsRef.current) dispatch({ type: 'SET_SESSIONS', sessions: sessionsRef.current });
      hydratedRef.current = true;
      // Tout ce que le local avait en plus part maintenant vers le serveur.
      scheduleSave(0);
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

  // État partagé — un produit créé sur un autre poste apparaît ici sans
  // rechargement, et le retour sur l'onglet sert de filet quand le temps réel
  // est bloqué par le réseau.
  useEffect(() => {
    const unsub = subscribeTable('biz_store', () => { if (hydratedRef.current) pull(); });
    const onFocus = () => { if (hydratedRef.current) pull(); };
    window.addEventListener('focus', onFocus);
    return () => { unsub(); window.removeEventListener('focus', onFocus); };
  }, [pull]);

  // Fermeture / rafraîchissement de la page : dernière chance d'envoyer. Même si
  // la requête n'a pas le temps de partir, la copie locale est complète et sera
  // fusionnée au prochain démarrage — rien n'est perdu.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && stateRef.current !== lastSavedRef.current) {
        void runSaveRef.current();
      }
    };
    const onPageHide = () => { if (stateRef.current !== lastSavedRef.current) void runSaveRef.current(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Toute modification est d'abord écrite dans le navigateur — de façon
  // synchrone — puis programmée pour le serveur.
  useEffect(() => {
    stateRef.current = state;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }

    if (!hydratedRef.current) return;
    if (state === lastSavedRef.current) return;   // rien de neuf à envoyer
    if (!syncRef.current.pending) applySync({ pending: true });
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const value = useMemo(() => ({ state, dispatch, flush, waitFor, sync }), [state, flush, waitFor, sync]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ─── Scoped hook ─────────────────────────────────────────────────────────────────
export interface BizApi {
  /** Partie visée par cette instance de l'API. */
  module: ModuleKey;
  state: ModuleState;
  all: BizState;
  add: (coll: BizCollection, item: any) => void;
  update: (coll: BizCollection, item: any) => void;
  remove: (coll: BizCollection, id: string) => void;
  set: (coll: BizCollection, items: any[]) => void;
  patch: (patch: Partial<ModuleState>) => void;
  /**
   * Force l'enregistrement immédiat et ATTEND le verdict du serveur. À utiliser
   * dès qu'une création doit être certaine (produit, achat…) : tant que ceci n'a
   * pas rendu `{ ok: true }`, la ligne n'existe que dans ce navigateur.
   */
  flush: () => Promise<SaveOutcome>;
  /** Ajoute une ligne puis attend sa confirmation par le serveur. */
  addAndConfirm: (coll: BizCollection, item: any) => Promise<SaveOutcome>;
}

export function useBiz(module: ModuleKey): BizApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBiz must be used within <BizProvider>');
  const { state, dispatch, flush, waitFor } = ctx;
  return useMemo<BizApi>(() => ({
    module,
    state: state[module],
    all: state,
    add: (coll, item) => dispatch({ type: 'ADD', module, coll, item }),
    update: (coll, item) => dispatch({ type: 'UPDATE', module, coll, item }),
    remove: (coll, id) => dispatch({ type: 'DELETE', module, coll, id }),
    set: (coll, items) => dispatch({ type: 'SET', module, coll, items }),
    patch: (p) => dispatch({ type: 'PATCH', module, patch: p }),
    flush,
    addAndConfirm: async (coll, item) => {
      dispatch({ type: 'ADD', module, coll, item });
      // L'enregistrement doit porter SUR la ligne qu'on vient d'ajouter : on
      // attend qu'elle soit dans l'état avant de l'envoyer.
      await waitFor(s => (s[module][coll] as any[]).some(x => x?.id === item?.id));
      return flush();
    },
  }), [state, module, dispatch, flush, waitFor]);
}

// Read-only access to the whole store (used by the General Reports page).
export function useBizAll(): BizState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizAll must be used within <BizProvider>');
  return ctx.state;
}

/** État de la synchronisation — affiché là où une perte serait grave. */
export function useBizSync(): BizSyncState & { flush: () => Promise<SaveOutcome> } {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizSync must be used within <BizProvider>');
  return { ...ctx.sync, flush: ctx.flush };
}

export function useBizReset() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBizReset must be used within <BizProvider>');
  return () => ctx.dispatch({ type: 'RESET' });
}
