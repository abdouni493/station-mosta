/**
 * ─── INSTRUMENTATION DE PERFORMANCE (diagnostic, désactivée par défaut) ─────────
 *
 * Ce module mesure le PARCOURS RÉEL : combien de requêtes partent, vers quelle
 * table/RPC, combien de temps chacune prend, combien de lignes et d'octets elle
 * ramène, et combien de temps s'écoule entre un changement d'écran et son premier
 * rendu. Il répond à l'étape 3 du cahier des charges sans jamais exposer de
 * données sensibles.
 *
 * ⚠ CE QU'IL N'ENREGISTRE JAMAIS :
 *   • aucun jeton (ils voyagent dans les en-têtes `apikey` / `Authorization`,
 *     que ce module ne lit pas) ;
 *   • aucune VALEUR de filtre : l'URL `...?client_id=eq.<uuid>` est journalisée
 *     en `client_id=eq.*` — on garde la colonne et l'opérateur, jamais la valeur.
 *   • aucun corps de requête ou de réponse (on lit uniquement les en-têtes
 *     `Content-Range` et `Content-Length`, jamais le JSON lui-même).
 *
 * ⚠ DÉSACTIVÉ PAR DÉFAUT. Rien n'est mesuré tant que le diagnostic n'est pas
 *   activé, donc aucun surcoût en production :
 *     • `localStorage['altech.perf'] = '1'`  (persistant), ou
 *     • ouvrir l'application avec `?perf=1` dans l'URL (active et persiste), ou
 *     • `window.__altechPerf.enable()` dans la console.
 *   Pour lire les mesures : `window.__altechPerf.summary()` (agrégé par table),
 *   `window.__altechPerf.table()` (tableau console), `window.__altechPerf.nav()`
 *   (temps par écran), `window.__altechPerf.export()` (JSON à copier),
 *   `window.__altechPerf.clear()` et `window.__altechPerf.disable()`.
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface QueryEntry {
  /** Horodatage de départ (ms depuis l'origine de la page). */
  t0: number;
  /** Durée totale de la requête, en millisecondes. */
  ms: number;
  method: string;
  /** `rest` (table), `rpc`, `storage`, `auth` ou `other`. */
  kind: 'rest' | 'rpc' | 'storage' | 'auth' | 'other';
  /** Nom de la table ou de la fonction RPC (sans schéma ni valeurs). */
  name: string;
  /** Requête nettoyée : colonnes, opérateurs, `select`/`order`/`limit` — PAS les valeurs. */
  q?: string;
  status: number;
  /** Nombre de lignes, lu dans l'en-tête `Content-Range` quand il est présent. */
  rows?: number;
  /** Taille de la réponse en octets (`Content-Length`), quand elle est annoncée. */
  bytes?: number;
  /** Requête soldée par une erreur réseau (timeout, coupure) plutôt qu'un statut HTTP. */
  failed?: boolean;
}

export interface NavEntry {
  route: string;
  /** Temps entre le changement d'écran et son premier rendu utilisable (ms). */
  ms: number;
  t0: number;
}

const MAX_ENTRIES = 3000;
const STORAGE_KEY = 'altech.perf';

let enabled = false;
let initialised = false;
const queries: QueryEntry[] = [];
const navs: NavEntry[] = [];

function readFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('perf') === '1') {
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
      return true;
    }
    if (sp.get('perf') === '0') {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      return false;
    }
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Vrai quand le diagnostic est actif. Bon marché : lu une fois puis mémorisé. */
export function perfEnabled(): boolean {
  if (!initialised) { enabled = readFlag(); initialised = true; ensureGlobal(); }
  return enabled;
}

/**
 * Nettoie la chaîne de requête : on conserve les clés, les opérateurs PostgREST
 * et les mots-clés (`select`, `order`, `limit`, `offset`), mais toute VALEUR de
 * filtre est remplacée par `*`. `client_id=eq.3f2a…` devient `client_id=eq.*`.
 */
export function sanitizeQuery(search: string): string | undefined {
  if (!search || search === '?') return undefined;
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const parts: string[] = [];
  for (const pair of raw.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) { parts.push(pair); continue; }
    const key = pair.slice(0, eq);
    const val = pair.slice(eq + 1);
    // `select`, `order`, `limit`, `offset`, `on_conflict` ne portent pas de
    // données privées : ce sont des noms de colonnes et des mots-clés.
    if (/^(select|order|limit|offset|on_conflict|columns)$/i.test(key)) {
      parts.push(`${key}=${decodeURIComponent(val)}`);
      continue;
    }
    // Filtre `col=op.valeur` → on garde la colonne et l'opérateur, jamais la valeur.
    const m = val.match(/^(eq|neq|gt|gte|lt|lte|like|ilike|in|is|cs|cd|fts|not)\./i);
    parts.push(m ? `${key}=${m[1]}.*` : `${key}=*`);
  }
  return parts.join('&') || undefined;
}

/** Déduit la table/RPC et le type à partir de l'URL seule (jamais des en-têtes). */
export function classify(url: string): { kind: QueryEntry['kind']; name: string; q?: string } {
  let path = url;
  let search = '';
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://x');
    path = u.pathname;
    search = u.search;
  } catch { /* URL relative ou malformée : on retombe sur la chaîne brute */ }

  if (path.includes('/storage/v1/')) return { kind: 'storage', name: 'storage' };
  if (path.includes('/auth/v1/'))    return { kind: 'auth', name: 'auth' };

  const rpc = path.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
  if (rpc) return { kind: 'rpc', name: `rpc:${rpc[1]}`, q: sanitizeQuery(search) };

  const rest = path.match(/\/rest\/v1\/([a-z0-9_]+)/i);
  if (rest) return { kind: 'rest', name: rest[1], q: sanitizeQuery(search) };

  return { kind: 'other', name: path.split('?')[0] };
}

/** Lit le nombre de lignes dans `Content-Range` (`0-24/\*` ou `0-24/312`). */
function rowsFromRange(res?: Response): number | undefined {
  try {
    const cr = res?.headers?.get('content-range');
    if (!cr) return undefined;
    const m = cr.match(/^(\d+)-(\d+)\//);
    if (m) return Number(m[2]) - Number(m[1]) + 1;
    if (/^\*\//.test(cr)) return 0;
    return undefined;
  } catch { return undefined; }
}

function bytesFromLength(res?: Response): number | undefined {
  try {
    const cl = res?.headers?.get('content-length');
    if (!cl) return undefined;
    const n = Number(cl);
    return Number.isFinite(n) ? n : undefined;
  } catch { return undefined; }
}

/**
 * Enregistre une requête terminée. Appelée depuis la couche réseau de
 * `supabase.ts` UNIQUEMENT quand le diagnostic est actif.
 */
export function recordQuery(input: {
  url: string;
  method: string;
  startedAt: number;
  ms: number;
  res?: Response;
  failed?: boolean;
}): void {
  if (!perfEnabled()) return;
  const { kind, name, q } = classify(input.url);
  queries.push({
    t0: Math.round(input.startedAt),
    ms: Math.round(input.ms),
    method: input.method.toUpperCase(),
    kind,
    name,
    q,
    status: input.res?.status ?? 0,
    rows: rowsFromRange(input.res),
    bytes: bytesFromLength(input.res),
    failed: input.failed || false,
  });
  if (queries.length > MAX_ENTRIES) queries.splice(0, queries.length - MAX_ENTRIES);
}

// ── Mesure du parcours écran → premier rendu ──────────────────────────────────
let navStartAt: number | null = null;
let navRoute = '';

/** Appelé quand l'utilisateur change d'écran (clic sidebar, navigation). */
export function markNavStart(route: string): void {
  if (!perfEnabled()) return;
  navStartAt = now();
  navRoute = route;
}

/** Appelé au premier rendu utilisable du nouvel écran. */
export function markNavReady(route: string): void {
  if (!perfEnabled() || navStartAt === null) return;
  if (navRoute && route !== navRoute) return;
  navs.push({ route, ms: Math.round(now() - navStartAt), t0: Math.round(navStartAt) });
  if (navs.length > MAX_ENTRIES) navs.splice(0, navs.length - MAX_ENTRIES);
  navStartAt = null;
}

function now(): number {
  try { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  catch { return Date.now(); }
}

// ── Agrégats ──────────────────────────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

interface Agg {
  name: string;
  count: number;
  totalMs: number;
  p50: number;
  p95: number;
  maxMs: number;
  totalRows: number;
  totalKB: number;
  errors: number;
}

function summary(): Agg[] {
  const byName = new Map<string, QueryEntry[]>();
  for (const e of queries) {
    const arr = byName.get(e.name) || [];
    arr.push(e);
    byName.set(e.name, arr);
  }
  const out: Agg[] = [];
  for (const [name, arr] of byName) {
    const durs = arr.map(e => e.ms).sort((a, b) => a - b);
    out.push({
      name,
      count: arr.length,
      totalMs: Math.round(arr.reduce((s, e) => s + e.ms, 0)),
      p50: Math.round(percentile(durs, 50)),
      p95: Math.round(percentile(durs, 95)),
      maxMs: Math.round(durs[durs.length - 1] || 0),
      totalRows: arr.reduce((s, e) => s + (e.rows || 0), 0),
      totalKB: Math.round(arr.reduce((s, e) => s + (e.bytes || 0), 0) / 1024),
      errors: arr.filter(e => e.failed || e.status >= 400).length,
    });
  }
  return out.sort((a, b) => b.totalMs - a.totalMs);
}

// ── API exposée sur `window` ──────────────────────────────────────────────────
function ensureGlobal(): void {
  if (typeof window === 'undefined') return;
  if ((window as any).__altechPerf) return;
  (window as any).__altechPerf = {
    enable() {
      try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
      enabled = true; initialised = true;
      return 'Diagnostic de performance ACTIVÉ. Rechargez pour mesurer le démarrage.';
    },
    disable() {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      enabled = false;
      return 'Diagnostic de performance désactivé.';
    },
    clear() { queries.length = 0; navs.length = 0; return 'Mesures effacées.'; },
    entries() { return queries.slice(); },
    nav() { return navs.slice(); },
    summary() { return summary(); },
    table() {
      // eslint-disable-next-line no-console
      try { console.table(summary()); } catch { /* ignore */ }
      return summary();
    },
    export() {
      return JSON.stringify({
        at: new Date().toISOString(),
        queries, navs, summary: summary(),
      }, null, 2);
    },
  };
}

// Prépare l'API dès le chargement du module (sans rien mesurer tant que c'est off).
if (typeof window !== 'undefined') { try { ensureGlobal(); } catch { /* ignore */ } }
