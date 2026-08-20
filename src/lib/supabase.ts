/**
 * ─── SUPABASE CLIENT (live backend) ────────────────────────────────────────────
 * Real Supabase connection for the StationPro app. It keeps the EXACT same public
 * surface the previous offline mock exposed (`supabase`, `db`, `signIn`,
 * `dbInsert`, `subscribeTable`, storage helpers, …), so every page, interface and
 * button in the app talks to the live database and Storage buckets without any
 * other file needing changes.
 *
 * Project: mgmtggxjlhzsekkrxaus   (see supabase/setup.sql for the schema)
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { createClient } from '@supabase/supabase-js';

// Connection — values come from Vite env when present, otherwise fall back to the
// project this app is wired to. The anon key is public by design (RLS protects data).
const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  'https://mgmtggxjlhzsekkrxaus.supabase.co';
const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nbXRnZ3hqbGh6c2Vra3J4YXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MjI0MjIsImV4cCI6MjEwMDQ5ODQyMn0._SXlyMqNozPIt7Z8jVmKTbYt2caRQ45s3muLTfJbgmk';

export const AUTH_STORAGE_KEY = 'stationpro.auth';

/** Minimal shape the app reads off a session. */
export interface PersistedSession {
  access_token: string;
  refresh_token?: string;
  user: { id: string; email?: string; user_metadata?: Record<string, any> };
}

/**
 * The session supabase-js keeps in localStorage, read synchronously.
 *
 * `supabase.auth.getSession()` is async and, on a slow or lossy link, can take
 * seconds because it renews the token first. Nothing that only needs to know
 * *whether* somebody is signed in should wait for that — waiting is what used to
 * strand users on the login screen. Authorisation itself is never decided here:
 * every query still goes through supabase-js (fresh token + RLS), and a session
 * that turns out to be dead ends at SIGNED_OUT.
 */
export function readPersistedSession(): PersistedSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const session = parsed?.currentSession ?? parsed;
    if (!session?.access_token || !session?.user?.id) return null;
    return session as PersistedSession;
  } catch {
    return null;
  }
}

// ─── Network resilience layer ───────────────────────────────────────────────────
/**
 * Some client machines reach Supabase over a resolver / firewall that drops
 * requests intermittently (`net::ERR_NAME_NOT_RESOLVED`) and share a public IP
 * with other stations, which trips Supabase's per-IP rate limiter on
 * `/auth/v1/token` (HTTP 429).
 *
 * Both used to be fatal on those PCs:
 *   • a transient DNS/network blip made a query fail outright;
 *   • a 429 on a token refresh is NOT in auth-js's retryable status list
 *     ([502, 503, 504, 520…530]), so `_callRefreshToken()` fell through to
 *     `_removeSession()` and destroyed the session mid-login — which is exactly
 *     the "impossible to connect from that machine" symptom.
 *
 * `resilientFetch` makes both survivable:
 *   1. concurrent refresh calls collapse into ONE network request (a burst of
 *      refreshes is what trips the limiter in the first place);
 *   2. a rate-limited or transient request is retried with backoff, honouring
 *      `Retry-After`;
 *   3. a refresh that is still rate-limited after the retries is reported as
 *      503 so auth-js classifies it as retryable and KEEPS the session instead
 *      of signing the user out.
 *
 * Retries are deliberately conservative: a request that may already have been
 * applied server-side (POST/PATCH/DELETE that failed mid-flight) is never
 * replayed, so no write is ever duplicated. Only 429s — which the limiter
 * rejects before any processing — are retried for every method.
 */
/**
 * Budget d'UNE tentative.
 *
 * Il était de 20 s avec trois reprises : une requête vers une base qui ne répond
 * plus coûtait donc 20+1+20+2+20+4+20 ≈ 87 SECONDES avant de rendre la main, et
 * l'hydratation en lance une quarantaine. L'application paraissait morte pendant
 * plusieurs minutes là où elle aurait dû dire « le serveur ne répond pas » tout
 * de suite. Une requête saine revient en moins de 300 ms : huit secondes laissent
 * vingt-cinq fois la marge nécessaire, même sur un lien de station lent.
 *
 * Réduire les reprises AIDE aussi le serveur : réessayer contre une base déjà
 * saturée ne fait qu'ajouter des connexions à une file qui n'avance plus.
 */
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 1;
/**
 * Un envoi de fichier n'est pas une requête : une photo de bon de livraison sur
 * le lien d'une station met légitimement plus de huit secondes. Lui appliquer le
 * budget des requêtes de données couperait des envois parfaitement sains — et un
 * POST n'est jamais rejoué, il serait donc simplement perdu.
 */
const UPLOAD_TIMEOUT_MS = 60_000;
/**
 * L'ÉTAT PARTAGÉ DES PARTIES N'EST PAS UNE REQUÊTE ORDINAIRE.
 *
 * `biz_store` tient tout ce que contiennent la Cafétéria et le Lavage dans UNE
 * ligne JSON : 665 Ko aujourd'hui, dont 567 Ko d'historique de ventes. Elle part
 * en entier à chaque enregistrement. Sur le lien montant d'une station, envoyer
 * 665 Ko demande couramment dix à vingt secondes — le budget de huit secondes
 * abandonnait donc des enregistrements parfaitement sains, et l'écran de la
 * Gestion de stock annonçait « Le serveur refuse les enregistrements —
 * TimeoutError » alors que la base n'avait aucun problème.
 *
 * Ce budget-là ne couvre QUE ces deux points d'entrée, ceux dont on sait que la
 * charge utile est volumineuse. Tout le reste garde huit secondes : une requête
 * de données saine revient en moins de 300 ms, et une base en carafe doit être
 * signalée vite.
 *
 * Ce n'est pas un pansement sur la lenteur : les produits, eux, ont quitté ce
 * blob pour leur propre table (`biz_products`, migration 2026-08-15) et ne
 * dépendent plus du tout de ce budget. Les ventes suivront le même chemin.
 */
const BULK_STATE_TIMEOUT_MS = 45_000;

const isStorageRequest = (url: string) => url.includes('/storage/v1/');
/** L'écriture (RPC) et la lecture de la grosse ligne JSON partagée. */
const isBulkStateRequest = (url: string) =>
  url.includes('/rest/v1/rpc/biz_store_save') || url.includes('/rest/v1/biz_store');
// The refresh endpoint retries only once here. Every postgrest call awaits
// getSession(), so a long backoff chain inside a refresh would stall the whole
// app; auth-js has its own paced retry loop for the 503 we hand back, and that
// is the better place to wait.
const MAX_AUTH_RETRIES = 1;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request)?.url ?? '';
}

/** `POST /auth/v1/token?grant_type=refresh_token` — the rate-limited endpoint. */
function isRefreshTokenRequest(url: string): boolean {
  return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token');
}

/** Backoff delay, preferring the server's `Retry-After` when it sends one. */
function retryDelayMs(attempt: number, res?: Response): number {
  const retryAfter = res?.headers?.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 30_000);
  }
  // 1s → 2s → 4s, plus jitter so several tabs don't retry in lockstep.
  return Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 400);
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries: number = MAX_RETRIES,
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  // Only replay requests that cannot have taken effect server-side.
  const replayable = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const callerSignal = init?.signal ?? undefined;
  const url = urlOf(input);
  const budget = isStorageRequest(url) ? UPLOAD_TIMEOUT_MS
    : isBulkStateRequest(url) ? BULK_STATE_TIMEOUT_MS
      : REQUEST_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Per-attempt timeout — a request that never settles must not wedge the app.
    // The abort carries a NAMED reason: without it the console fills with
    // "AbortError: signal is aborted without reason", which reads like a bug in
    // the app when it is simply the request budget doing its job.
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    const timer = setTimeout(
      () => controller.abort(new DOMException(`Le serveur n'a pas répondu en ${Math.round(budget / 1000)} s`, 'TimeoutError')),
      budget,
    );
    callerSignal?.addEventListener('abort', onCallerAbort);

    try {
      const res = await fetch(input, { ...init, signal: controller.signal });

      // 429: rejected by the rate limiter before any processing → always safe to retry.
      // 5xx: may have been applied → replay only idempotent methods.
      const retryable = res.status === 429 || (replayable && res.status >= 500);
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayMs(attempt, res));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      // The caller aborted on purpose (component unmounted, request superseded).
      if (callerSignal?.aborted) throw err;
      if (!replayable || attempt >= maxRetries) throw err;
      await sleep(retryDelayMs(attempt));
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  throw lastError;
}

/** In-flight refresh, shared by every caller so a burst becomes one request. */
let refreshInFlight: Promise<Response> | null = null;

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);

  if (!isRefreshTokenRequest(url)) return fetchWithRetry(input, init);

  if (!refreshInFlight) {
    refreshInFlight = fetchWithRetry(input, init, MAX_AUTH_RETRIES)
      .finally(() => { refreshInFlight = null; });
  }

  // Every caller — including the first — reads a clone, so the shared response
  // body is never consumed and can be cloned again by the next waiter.
  const shared = await refreshInFlight;

  if (shared.status === 429) {
    // Still rate limited. Surfacing the 429 would make auth-js drop the session;
    // 503 is in its retryable list, so the session survives and it retries later.
    const body = await shared.clone().text().catch(() => '');
    console.warn('[auth] Rafraîchissement du jeton limité (429) — session conservée, nouvel essai plus tard.');
    return new Response(
      body || JSON.stringify({ error: 'rate_limited', error_description: 'Too many refresh attempts' }),
      { status: 503, statusText: 'Rate limited', headers: new Headers(shared.headers) },
    );
  }

  return shared.clone();
}

// ─── Diagnostic : QUELLE couche est en panne ? ─────────────────────────────────
/**
 * `ok` — tout répond.
 * `database` — le serveur Supabase répond, mais les requêtes de DONNÉES non : la
 *   base est saturée, redémarre, ou son pool de connexions est épuisé. Le poste
 *   et Internet n'y sont pour RIEN.
 * `offline` — le serveur n'est pas joignable du tout : là, c'est bien le réseau.
 *
 * Cette distinction n'est pas cosmétique. « Vérifiez la connexion Internet »
 * affiché alors que le lien est parfait envoie l'utilisateur débrancher sa box
 * pendant des heures pour un problème qui est côté serveur.
 */
export type BackendStatus = 'ok' | 'database' | 'offline';

/** `fetch` NU : ni reprise ni file d'attente — un diagnostic doit être rapide. */
async function rawFetch(url: string, ms: number, headers?: Record<string, string>): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`Diagnostic sans réponse en ${ms} ms`, 'TimeoutError')), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeBackend(): Promise<BackendStatus> {
  // 1. Une vraie requête de données, courte : c'est elle qui compte.
  const data = await rawFetch(
    `${SUPABASE_URL}/rest/v1/station_settings?select=id&limit=1`, 6_000,
    { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  );
  if (data && data.status < 500) return 'ok';

  // 2. Pas de données. La passerelle répond-elle quand même ? Sans clé elle rend
  //    un 401 immédiat SANS toucher à la base — c'est le test qui sépare
  //    « réseau coupé » de « base en carafe ».
  const gateway = await rawFetch(`${SUPABASE_URL}/rest/v1/`, 5_000);
  return gateway ? 'database' : 'offline';
}

/** Message prêt à afficher pour chaque état — même vocabulaire partout. */
export const BACKEND_STATUS_MESSAGE: Record<Exclude<BackendStatus, 'ok'>, string> = {
  database:
    "Le serveur de données ne répond pas (base saturée ou en redémarrage). "
    + "Votre connexion Internet fonctionne : il n'y a rien à faire sur ce poste, "
    + "réessayez dans quelques minutes.",
  offline:
    "Serveur injoignable depuis ce poste. Vérifiez la connexion Internet, puis réessayez.",
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // No OAuth / magic-link redirect flow in this app — skip the URL parsing.
    detectSessionInUrl: false,
    storageKey: AUTH_STORAGE_KEY,
  },
  global: { fetch: resilientFetch },
  realtime: {
    // Backoff ladder for the websocket. The default tops out at 10 s, which on a
    // machine whose DNS/firewall blocks `wss://` produced an endless stream of
    // ERR_NAME_NOT_RESOLVED in the console. Capped at 2 min instead: the app
    // still heals itself when the network returns, without flooding the log.
    reconnectAfterMs: (tries: number) => {
      const ladder = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000];
      return ladder[Math.min(Math.max(tries, 1), ladder.length) - 1];
    },
    heartbeatIntervalMs: 30_000,
    timeout: 20_000,
  },
});

// ─── Realtime health ────────────────────────────────────────────────────────────
/**
 * Live updates are a nice-to-have: on networks that block websockets the app must
 * still work, just without push. Channels report their subscribe status here; once
 * enough of them fail the app switches to periodic polling (see AppContext) and
 * tells the user once, instead of silently showing stale data.
 */
export type RealtimeHealth = 'connecting' | 'online' | 'offline';

const REALTIME_FAILURE_THRESHOLD = 3;

let realtimeHealth: RealtimeHealth = 'connecting';
let realtimeFailures = 0;
const realtimeListeners = new Set<(health: RealtimeHealth) => void>();

export function getRealtimeHealth(): RealtimeHealth {
  return realtimeHealth;
}

/** Subscribes to health changes; fires immediately with the current value. */
export function onRealtimeHealthChange(cb: (health: RealtimeHealth) => void): () => void {
  realtimeListeners.add(cb);
  cb(realtimeHealth);
  return () => { realtimeListeners.delete(cb); };
}

function setRealtimeHealth(next: RealtimeHealth) {
  if (next === realtimeHealth) return;
  realtimeHealth = next;
  realtimeListeners.forEach(l => { try { l(next); } catch { /* listener errors are not ours */ } });
}

function reportRealtimeStatus(status: string) {
  if (status === 'SUBSCRIBED') {
    realtimeFailures = 0;
    setRealtimeHealth('online');
    return;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    realtimeFailures += 1;
    if (realtimeFailures >= REALTIME_FAILURE_THRESHOLD) setRealtimeHealth('offline');
  }
}

// ─── Storage bucket names (unchanged public API) ────────────────────────────────
export const BUCKETS = {
  STATION_LOGOS:   'station-logos',
  PRODUCT_IMAGES:  'product-images',
  WORKER_PHOTOS:   'worker-photos',
  BON_PHOTOS:      'bon-photos',
  DELIVERY_PHOTOS: 'delivery-photos',
  INVOICES:        'invoices',
  EXPENSE_RECEIPTS:'expense-receipts',
  CLIENT_RECEIPTS: 'client-receipts',
} as const;

// ─── Storage helpers ────────────────────────────────────────────────────────────

/** Build a public URL for a stored object. Pass-throughs full URLs / data-URLs. */
export function getPublicUrl(bucket: string, path: string): string {
  if (!path) return path;
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:')) return path;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function randomName(ext = 'jpg'): string {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${id}.${ext}`;
}

/** Uploads a File to a bucket and returns its public URL (or null on failure). */
export async function uploadFile(bucket: string, path: string, file: File): Promise<string | null> {
  try {
    const key = path && path.length ? path : randomName((file.name?.split('.').pop() || 'jpg'));
    const { error } = await supabase.storage.from(bucket).upload(key, file, {
      upsert: true,
      contentType: file.type || 'image/jpeg',
    });
    if (error) { console.warn('[uploadFile]', error.message); return null; }
    return getPublicUrl(bucket, key);
  } catch (e) {
    console.warn('[uploadFile] failed', e);
    return null;
  }
}

/** Converts a base64 / data-URL string to bytes and uploads it; returns public URL. */
export async function uploadBase64(
  bucket: string,
  path: string,
  base64: string,
  mimeType = 'image/jpeg'
): Promise<string | null> {
  try {
    if (!base64) return null;
    // Already a hosted URL — nothing to upload.
    if (base64.startsWith('http') || base64.startsWith('blob:')) return base64;

    let raw = base64;
    let mime = mimeType;
    const m = base64.match(/^data:([^;]+);base64,(.*)$/);
    if (m) { mime = m[1]; raw = m[2]; }

    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const key = path && path.length ? path : randomName(ext);

    const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
      upsert: true,
      contentType: mime,
    });
    if (error) { console.warn('[uploadBase64]', error.message); return base64; }
    return getPublicUrl(bucket, key);
  } catch (e) {
    console.warn('[uploadBase64] failed', e);
    // Fall back to the original base64 so the image still renders in the UI.
    return base64 || null;
  }
}

// ─── Auth helpers (public API) ──────────────────────────────────────────────────

const DEMO_EMAIL = 'admin@stationpro.dz';
const DEMO_PASSWORD = 'stationpro';

/**
 * Rôle du compte qui vient de se connecter. La page de connexion REFUSE l'accès
 * quand il vaut null : un échec passager du réseau juste après un mot de passe
 * accepté ne doit donc pas se déguiser en « aucun rôle » — d'où le second essai.
 */
async function resolveRole(): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await supabase.rpc('get_my_role');
      if (!error) return (data as string | null) ?? null;
    } catch { /* réseau — retenté ci-dessous */ }
    if (attempt === 0) await sleep(600);
  }
  return null;
}

/** Why a sign-in failed — the login page shows a different message per reason. */
export type SignInFailure = 'credentials' | 'rate_limited' | 'network';

/**
 * Sign in with an email OR a username (+ password). Returns the resolved role so
 * the login page can route the user; returns `{ error, reason }` on failure.
 *
 * `reason` matters: a rate-limited or unreachable server used to be reported as
 * "identifiants invalides", which sent people hunting for a password problem
 * that did not exist.
 */
export async function signIn(identifier: string, password: string) {
  let email = (identifier || '').trim();

  // Allow login by username: resolve it to the account email.
  if (email && !email.includes('@')) {
    try {
      const { data } = await supabase.rpc('email_for_username', { p_username: email.toLowerCase() });
      if (data) email = data as string;
    } catch { /* fall through — will fail auth below */ }
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const status = (error as any)?.status as number | undefined;
    const reason: SignInFailure =
      status === 429 ? 'rate_limited'
      : (!status || status === 0 || status >= 500) ? 'network'
      : 'credentials';
    return { error: error.message, reason };
  }

  const role = await resolveRole();
  return { user: data.user, session: data.session, role, profile: null };
}

/** One-click demo administrator login (only works if that account exists). */
export async function signInDemoAdmin() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (error) throw new Error(error.message);
  const role = (await resolveRole()) ?? 'admin';
  return { user: data.user, session: data.session, role: role as 'admin' };
}

/**
 * Create the FIRST administrator account (from the login page's signup form).
 * Uses a SECURITY DEFINER RPC that provisions a confirmed auth user + profile, so
 * the new admin can log in immediately (no email-confirmation step).
 */
export async function signUpAdmin(params: {
  name: string; username: string; email: string; password: string;
}): Promise<{ user: any; session: any } | { error: string }> {
  const { data, error } = await supabase.rpc('create_admin_account', {
    p_name: params.name,
    p_username: params.username,
    p_email: params.email,
    p_password: params.password,
  });
  if (error) return { error: error.message };
  if (data && (data as any).ok === false) return { error: (data as any).error || 'Échec de la création' };
  return { user: null, session: null };
}

/** True when at least one administrator already exists (hides the signup button). */
export async function adminExists(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('admin_exists');
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ─── Worker account provisioning ────────────────────────────────────────────────
export type WorkerType = 'pompiste' | 'chef_brigade' | 'gerant' | 'magasin';

export async function provisionWorkerAccount(input: {
  action: 'create' | 'update_password' | 'delete';
  workerType: WorkerType;
  workerId: string;
  username?: string;
  password?: string;
  name?: string;
  email?: string;
}): Promise<{ ok: true; auth_user_id?: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.rpc('provision_worker_account', {
      p_action:      input.action,
      p_worker_type: input.workerType,
      p_worker_id:   input.workerId,
      p_username:    input.username ?? null,
      p_password:    input.password ?? null,
      p_name:        input.name ?? null,
      p_email:       input.email ?? null,
    });
    if (error) return { ok: false, error: error.message };
    if (data && (data as any).ok) {
      return { ok: true, auth_user_id: (data as any).auth_user_id };
    }
    return { ok: false, error: (data as any)?.error || 'Erreur inconnue' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}

// ─── Business-part worker accounts (Restaurant / Cafétéria / Lavage / Magasin) ──
// These employees live in the BizContext store, so they need their own auth
// provisioning path (see supabase/migrations/module_workers_auth.sql).

export type BizModuleKey = 'cafeteria' | 'lavage';

export interface ModuleWorkerRow {
  id: string;
  module_key: BizModuleKey;
  name: string;
  role_name?: string | null;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  auth_user_id?: string | null;
  has_account: boolean;
  permissions: Record<string, boolean>;
}

export async function provisionModuleWorkerAccount(input: {
  action: 'create' | 'update_password' | 'delete';
  moduleKey: BizModuleKey;
  workerId: string;
  username?: string;
  password?: string;
  name?: string;
  email?: string;
  roleName?: string;
  phone?: string;
  permissions?: Record<string, boolean>;
}): Promise<{ ok: boolean; auth_user_id?: string; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('provision_module_worker_account', {
      p_action:      input.action,
      p_module_key:  input.moduleKey,
      p_worker_id:   input.workerId,
      p_username:    input.username ?? null,
      p_password:    input.password ?? null,
      p_name:        input.name ?? null,
      p_email:       input.email ?? null,
      p_role_name:   input.roleName ?? null,
      p_phone:       input.phone ?? null,
      p_permissions: input.permissions ?? {},
    });
    if (error) {
      // The RPC is missing until the migration is run — surface a clear message.
      const hint = /function .* does not exist|schema cache/i.test(error.message)
        ? "Migration manquante : exécutez supabase/migrations/module_workers_auth.sql dans Supabase → SQL Editor."
        : error.message;
      return { ok: false, error: hint };
    }
    if (data && (data as any).ok) return { ok: true, auth_user_id: (data as any).auth_user_id };
    return { ok: false, error: (data as any)?.error || 'Erreur inconnue' };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}

/** Persists a part-employee's permissions server-side (so they apply at login). */
export async function saveModuleWorkerPermissions(
  workerId: string,
  permissions: Record<string, boolean>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.rpc('save_module_worker_permissions', {
      p_worker_id: workerId,
      p_permissions: permissions,
    });
    if (error) return { ok: false, error: error.message };
    if (data && (data as any).ok === false) return { ok: false, error: (data as any).error };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erreur réseau' };
  }
}

/** Resolves the connected part-employee (module_key + permissions), or null. */
export async function getMyModuleWorker(): Promise<ModuleWorkerRow | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_module_worker');
    if (error || !data) return null;
    return data as ModuleWorkerRow;
  } catch {
    return null;
  }
}

// ─── Shared business-parts state (single JSON row) ──────────────────────────────
// Keeps Restaurant / Cafétéria / Lavage / Magasin data identical for the admin
// and for every part-employee who logs in, instead of being browser-local only.
const BIZ_STORE_ID = 'biz-v1';

/**
 * Lecture de l'état partagé, avec sa RÉVISION.
 *
 * La révision est le numéro de version de la ligne : elle est renvoyée à
 * l'écriture pour que le serveur refuse d'écraser un état plus récent que celui
 * qu'on croit connaître (voir `saveBizStore`). Elle vaut `null` tant que la
 * migration `2026-08-06_biz_store_revision_merge.sql` n'a pas été passée — tout
 * continue alors de fonctionner, simplement sans ce garde-fou serveur.
 */
export interface BizStoreSnapshot {
  state: any | null;
  rev: number | null;
}

export async function loadBizStoreSnapshot(): Promise<BizStoreSnapshot | null> {
  try {
    const { data, error } = await supabase
      .from('biz_store').select('state, rev').eq('id', BIZ_STORE_ID).maybeSingle();
    if (!error && data) {
      return { state: (data as any).state ?? null, rev: (data as any).rev ?? null };
    }
    // Colonne `rev` absente (migration non passée) → relecture sans elle.
    const fallback = await supabase
      .from('biz_store').select('state').eq('id', BIZ_STORE_ID).maybeSingle();
    if (fallback.error || !fallback.data) return null;
    return { state: (fallback.data as any).state ?? null, rev: null };
  } catch {
    return null;
  }
}

export async function loadBizStore(): Promise<any | null> {
  return (await loadBizStoreSnapshot())?.state ?? null;
}

/**
 * Révision SEULE de la ligne partagée — quelques octets là où le blob complet
 * en pèse des centaines de milliers. C'est le test « y a-t-il du nouveau ? »
 * du retour sur l'onglet : tant que la révision du serveur est celle qu'on
 * connaît, le blob n'est pas retéléchargé. `null` quand la colonne n'existe pas
 * encore (migration non passée) — l'appelant fait alors une lecture complète.
 */
export async function peekBizStoreRev(): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('biz_store').select('rev').eq('id', BIZ_STORE_ID).maybeSingle();
    if (error || !data) return null;
    return (data as any).rev ?? null;
  } catch {
    return null;
  }
}

/** Résultat d'une écriture de l'état partagé. */
export interface BizStoreSaveResult {
  ok: boolean;
  /** Nouvelle révision de la ligne, quand l'écriture est passée. */
  rev?: number | null;
  /** Quelqu'un a écrit entre-temps : `remote` porte la version à fusionner. */
  conflict?: boolean;
  remote?: BizStoreSnapshot;
  error?: string;
}

/**
 * Écrit l'état partagé — SANS jamais écraser en aveugle.
 *
 * `baseRev` est la révision sur laquelle le travail a été construit. Le serveur
 * n'accepte l'écriture que si la ligne est toujours à cette révision ; sinon il
 * renvoie l'état courant et l'appelant fusionne avant de réessayer. C'est ce qui
 * empêche un poste d'effacer le produit qu'un autre poste vient de créer.
 *
 * Deux replis, pour qu'aucune installation ne se retrouve bloquée :
 *   • la fonction serveur n'existe pas (migration non passée) → écriture directe ;
 *   • la colonne `rev` n'existe pas → écriture directe elle aussi.
 * Dans les deux cas l'erreur éventuelle est REMONTÉE : une sauvegarde qui échoue
 * ne doit plus jamais passer inaperçue.
 */
export async function saveBizStore(
  state: unknown,
  baseRev?: number | null,
): Promise<BizStoreSaveResult> {
  try {
    const { data, error } = await supabase.rpc('biz_store_save', {
      p_id: BIZ_STORE_ID,
      p_state: state,
      p_base_rev: baseRev ?? null,
    });

    if (!error && data) {
      const res = data as any;
      if (res.ok) return { ok: true, rev: res.rev ?? null };
      if (res.conflict) {
        return { ok: false, conflict: true, remote: { state: res.state ?? null, rev: res.rev ?? null } };
      }
      return { ok: false, error: res.error || 'Enregistrement refusé par le serveur' };
    }

    // La fonction n'est pas déployée : on retombe sur l'écriture directe.
    const missingRpc = !!error && /does not exist|schema cache|not find the function/i.test(error.message);
    if (error && !missingRpc) return { ok: false, error: error.message };

    const { error: upsertError } = await supabase.from('biz_store')
      .upsert({ id: BIZ_STORE_ID, state, updated_at: new Date().toISOString() });
    if (upsertError) return { ok: false, error: upsertError.message };
    return { ok: true, rev: null };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Réseau indisponible' };
  }
}

// ─── Generic DB helpers (real Supabase queries) ─────────────────────────────────
//
// ⚠ Ces quatre fonctions LÈVENT sur erreur — elles ne doivent JAMAIS l'avaler.
// Elles se contentaient d'un `console.warn` : une écriture refusée (colonne
// absente, contrainte, RLS, réseau) rendait alors la main comme si tout s'était
// bien passé. `syncedDispatch` n'ayant rien à rattraper, l'écran gardait la
// modification optimiste et la base, elle, n'avait rien reçu — d'où des données
// « qui expirent » au rechargement suivant. En levant, l'erreur remonte à
// `syncedDispatch`, qui affiche un message ET recharge la table concernée : ce
// qui est à l'écran redevient ce qui est réellement enregistré.

/** Erreur d'écriture Supabase, avec la table et le détail Postgres. */
export class DbWriteError extends Error {
  constructor(op: string, table: string, err: { message: string; details?: string | null; hint?: string | null; code?: string | null }) {
    super(`[${op} ${table}] ${err.message}${err.details ? ` — ${err.details}` : ''}${err.hint ? ` (${err.hint})` : ''}`);
    this.name = 'DbWriteError';
  }
}

export async function dbInsert<T extends object>(tableName: string, row: T): Promise<T> {
  const { error } = await supabase.from(tableName).insert(row as any);
  if (error) { console.error(`[dbInsert:${tableName}]`, error); throw new DbWriteError('insert', tableName, error); }
  return row;
}

export async function dbUpsert<T extends object>(tableName: string, row: T): Promise<T> {
  const { error } = await supabase.from(tableName).upsert(row as any);
  if (error) { console.error(`[dbUpsert:${tableName}]`, error); throw new DbWriteError('upsert', tableName, error); }
  return row;
}

export async function dbUpdate<T extends object>(
  tableName: string,
  id: string,
  changes: Partial<T>
): Promise<Partial<T>> {
  const { error } = await supabase.from(tableName).update(changes as any).eq('id', id);
  if (error) { console.error(`[dbUpdate:${tableName}]`, error); throw new DbWriteError('update', tableName, error); }
  return changes;
}

/**
 * La base ne connaît-elle pas encore la colonne `part` des dépenses ?
 * PostgREST répond « Could not find the 'part' column … in the schema cache »
 * (PGRST204) et Postgres « column "part" of relation "expenses" does not
 * exist » (42703) : les deux disent la même chose.
 */
const isMissingPartColumn = (err: unknown): boolean => {
  const msg = String((err as any)?.message || '');
  return /'?\bpart\b'?/.test(msg) && /(column|schema cache)/i.test(msg);
};

/**
 * Écrit une dépense, et retente SANS son imputation quand la colonne `part`
 * n'existe pas encore. Voir `db.addExpense`.
 */
async function writeExpense<T>(
  write: () => Promise<T>,
  row: object,
  retryWithout: (rest: object) => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (!isMissingPartColumn(err)) throw err;
    const { part, ...rest } = row as any;
    console.warn(
      '[expenses] La colonne `part` est absente : appliquez la migration '
      + '2026-08-16_expense_part_and_part_cash.sql. La dépense est enregistrée '
      + 'sans son imputation à une activité.');
    return retryWithout(rest);
  }
}

export async function dbDelete(tableName: string, id: string) {
  const { error } = await supabase.from(tableName).delete().eq('id', id);
  if (error) { console.error(`[dbDelete:${tableName}]`, error); throw new DbWriteError('delete', tableName, error); }
}

/**
 * ─── Lire une table ENTIÈRE, quel que soit le plafond du serveur ──────────────
 *
 * PostgREST tronque toute réponse à `db-max-rows` (1000 lignes par défaut) et ne
 * signale rien : la requête réussit, il en manque simplement la fin. Les tables
 * d'historique — comptabilité de brigade, justifications, transactions client,
 * ventes magasin — dépassent ce plafond au bout de quelques mois d'exploitation.
 *
 * Conséquence observée : l'historique d'un client ne remontait plus que les
 * toutes dernières opérations. Rien n'était perdu en base ; c'est la lecture qui
 * s'arrêtait. On pagine donc explicitement, par tranches, jusqu'à ce que le
 * serveur rende moins d'une tranche pleine.
 *
 * `orderBy` sert uniquement à rendre la pagination DÉTERMINISTE : sans ordre
 * stable, deux tranches peuvent se recouvrir ou sauter des lignes.
 */
const PAGE_SIZE = 1000;

export async function dbSelectAll<T>(
  tableName: string,
  opts?: { orderBy?: string; ascending?: boolean; eq?: Record<string, unknown> },
): Promise<T[]> {
  const orderBy = opts?.orderBy || 'created_at';
  const ascending = opts?.ascending ?? false;
  const out: any[] = [];

  for (let page = 0; ; page++) {
    let q = supabase.from(tableName).select('*');
    if (opts?.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v as any);
    // `nullsFirst: false` garde les lignes sans horodatage à la fin plutôt que de
    // les faire remonter en tête à chaque tranche.
    q = q.order(orderBy, { ascending, nullsFirst: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    const { data, error } = await q;
    if (error) {
      // La colonne d'ordre n'existe pas sur cette table : on retombe sur la
      // lecture simple plutôt que de faire échouer tout le chargement.
      if (page === 0 && /column .* does not exist|42703/i.test(error.message || '')) {
        return dbSelect<T>(tableName, opts?.eq);
      }
      console.error(`[dbSelectAll:${tableName}]`, error);
      throw new Error(`[select ${tableName}] ${error.message}`);
    }
    const rows = (data as any[]) || [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out as T[];
}

/**
 * Lecture d'une table. Une lecture qui échoue LÈVE au lieu de rendre une liste
 * vide : renvoyer `[]` faisait passer une panne réseau ou une règle RLS pour
 * « il n'y a rien », l'écran se vidait, et l'utilisateur croyait ses données
 * perdues. Un aller-retour de secours est tenté avant d'abandonner, pour qu'une
 * coupure d'une seconde ne fasse pas remonter d'erreur inutilement.
 */
export async function dbSelect<T>(
  tableName: string,
  query?: Record<string, unknown>,
  limit?: number
): Promise<T[]> {
  const run = async () => {
    let q = supabase.from(tableName).select('*');
    if (query) {
      for (const [k, v] of Object.entries(query)) q = q.eq(k, v as any);
    }
    return q;
  };
  let { data, error } = await run();
  if (error) {
    console.warn(`[dbSelect:${tableName}] échec, nouvelle tentative —`, error.message);
    await new Promise(r => setTimeout(r, 400));
    ({ data, error } = await run());
  }
  if (error) {
    console.error(`[dbSelect:${tableName}]`, error);
    throw new Error(`[select ${tableName}] ${error.message}`);
  }

  // Sort newest-first by created_at when the column exists (matches prior behaviour).
  let rows = (data as any[]) || [];
  rows = [...rows].sort((a, b) => {
    const av = a?.created_at, bv = b?.created_at;
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av < bv ? 1 : -1;
  });
  if (limit) rows = rows.slice(0, limit);
  return rows as T[];
}

// ─── Specific data loaders (same shape/signatures as before) ────────────────────
export const db = {
  // Settings
  getSettings: async () => {
    const { data } = await supabase.from('station_settings').select('*').limit(1).maybeSingle();
    return data ?? null;
  },
  saveSettings: async (settings: Record<string, unknown>) => {
    // Keep a single settings row (fixed id) so upserts merge instead of duplicating.
    const existing = await supabase.from('station_settings').select('id').limit(1).maybeSingle();
    const id = (existing.data as any)?.id || 'settings-1';
    const { data, error } = await supabase
      .from('station_settings')
      .upsert({ id, ...settings })
      .select()
      .maybeSingle();
    return { data, error };
  },

  // Tanks
  getTanks:   () => dbSelect('tanks'),
  addTank:    (t: object) => dbInsert('tanks', t),
  updateTank: (id: string, t: object) => dbUpdate('tanks', id, t),
  deleteTank: (id: string) => dbDelete('tanks', id),

  // Tracks
  getTracks:   () => dbSelect('tracks'),
  addTrack:    (t: object) => dbInsert('tracks', t),
  updateTrack: (id: string, t: object) => dbUpdate('tracks', id, t),
  deleteTrack: (id: string) => dbDelete('tracks', id),

  // Pumps
  getPumps:   () => dbSelect('pumps'),
  addPump:    (p: object) => dbInsert('pumps', p),
  updatePump: (id: string, p: object) => dbUpdate('pumps', id, p),
  deletePump: (id: string) => dbDelete('pumps', id),

  // Pump Nozzles
  getNozzles:   () => dbSelect('pump_nozzles'),
  addNozzle:    (n: object) => dbInsert('pump_nozzles', n),
  updateNozzle: (id: string, n: object) => dbUpdate('pump_nozzles', id, n),
  deleteNozzle: (id: string) => dbDelete('pump_nozzles', id),

  // Drivers
  getDrivers:   () => dbSelect('drivers'),
  addDriver:    (d: object) => dbInsert('drivers', d),
  deleteDriver: (id: string) => dbDelete('drivers', id),

  // Suppliers
  getSuppliers:   () => dbSelect('suppliers'),
  addSupplier:    (s: object) => dbInsert('suppliers', s),
  updateSupplier: (id: string, s: object) => dbUpdate('suppliers', id, s),
  deleteSupplier: (id: string) => dbDelete('suppliers', id),

  getSupplierAppointments:  (supplierId: string) => dbSelect('supplier_appointments', { supplier_id: supplierId }),
  addSupplierAppointment:   (a: object) => dbInsert('supplier_appointments', a),
  getSupplierDebtPayments:  (supplierId: string) => dbSelect('supplier_debt_payments', { supplier_id: supplierId }),
  addSupplierDebtPayment:   (p: object) => dbInsert('supplier_debt_payments', p),

  // Clients
  getClients:   () => dbSelectAll<any>('clients'),
  addClient:    (c: object) => dbInsert('clients', c),
  updateClient: (id: string, c: object) => dbUpdate('clients', id, c),
  deleteClient: (id: string) => dbDelete('clients', id),

  getClientTransactions:  (clientId: string) => dbSelect('client_transactions', { client_id: clientId }),
  addClientTransaction:   (t: object) => dbInsert('client_transactions', t),
  getClientAppointments:  (clientId: string) => dbSelect('client_appointments', { client_id: clientId }),
  addClientAppointment:   (a: object) => dbInsert('client_appointments', a),

  // Products
  getProducts:   () => dbSelect('products'),
  addProduct:    (p: object) => dbInsert('products', p),
  updateProduct: (id: string, p: object) => dbUpdate('products', id, p),
  deleteProduct: (id: string) => dbDelete('products', id),

  // Product Brands
  getBrands:   () => dbSelect('product_brands'),
  addBrand:    (b: object) => dbInsert('product_brands', b),
  updateBrand: (id: string, b: object) => dbUpdate('product_brands', id, b),
  deleteBrand: (id: string) => dbDelete('product_brands', id),

  // Pompistes
  getPompistes:   () => dbSelect('pompistes'),
  addPompiste:    (p: object) => dbInsert('pompistes', p),
  updatePompiste: (id: string, p: object) => dbUpdate('pompistes', id, p),
  deletePompiste: (id: string) => dbDelete('pompistes', id),

  // Brigade Chefs
  getBrigadeChefs:   () => dbSelect('brigade_chefs'),
  addBrigadeChef:    (c: object) => dbInsert('brigade_chefs', c),
  updateBrigadeChef: (id: string, c: object) => dbUpdate('brigade_chefs', id, c),
  deleteBrigadeChef: (id: string) => dbDelete('brigade_chefs', id),

  // Gerants
  getGerants:   () => dbSelect('gerants'),
  addGerant:    (g: object) => dbInsert('gerants', g),
  updateGerant: (id: string, g: object) => dbUpdate('gerants', id, g),
  deleteGerant: (id: string) => dbDelete('gerants', id),

  // Magasin Workers
  getMagasinWorkers:   () => dbSelect('magasin_workers'),
  addMagasinWorker:    (m: object) => dbInsert('magasin_workers', m),
  updateMagasinWorker: (id: string, m: object) => dbUpdate('magasin_workers', id, m),
  deleteMagasinWorker: (id: string) => dbDelete('magasin_workers', id),

  // Worker payroll sub-records
  getWorkerAcomptes:       (workerId: string) => dbSelect('worker_acomptes', { worker_id: workerId }),
  addWorkerAcompte:        (a: object) => dbUpsert('worker_acomptes', a),
  deleteWorkerAcompte:     (id: string) => dbDelete('worker_acomptes', id),
  getWorkerAbsences:       (workerId: string) => dbSelect('worker_absences', { worker_id: workerId }),
  addWorkerAbsence:        (a: object) => dbUpsert('worker_absences', a),
  deleteWorkerAbsence:     (id: string) => dbDelete('worker_absences', id),
  getWorkerPaymentRecords: (workerId: string) => dbSelect('worker_payment_records', { worker_id: workerId }),
  addWorkerPaymentRecord:  (p: object) => dbUpsert('worker_payment_records', p),
  updateWorkerPaymentRecord: (id: string, p: object) => dbUpdate('worker_payment_records', id, p),
  deleteWorkerPaymentRecord: (id: string) => dbDelete('worker_payment_records', id),
  markPaymentPaid: async (paymentId: string) => dbUpdate('worker_payment_records', paymentId, { is_paid: true }),

  // Brigades
  getBrigades:   () => dbSelectAll('brigades'),
  addBrigade:    (b: object) => dbInsert('brigades', b),
  updateBrigade: (id: string, b: object) => dbUpdate('brigades', id, b),
  deleteBrigade: (id: string) => dbDelete('brigades', id),

  // Decalage history
  addDecalageHistory: (d: object) => dbInsert('pompiste_decalage_history', d),
  getDecalageHistory: (pompisteId: string) => dbSelect('pompiste_decalage_history', { pompiste_id: pompisteId }),

  // Brigade Accounting
  getBrigadeAccountings: () => dbSelectAll('brigade_accounting'),
  addBrigadeAccounting: (a: object) => dbInsert('brigade_accounting', a),
  updateBrigadeAccounting: (id: string, a: object) => dbUpdate('brigade_accounting', id, a),
  getBrigadeAccountingJustifications: (accountingId: string) =>
    dbSelect('brigade_accounting_justifications', { accounting_id: accountingId }),
  addBrigadeAccountingJustification: (j: object) => dbInsert('brigade_accounting_justifications', j),

  // Fuel Sales
  getFuelSales:   () => dbSelectAll<any>('fuel_sales'),
  addFuelSale:    (s: object) => dbInsert('fuel_sales', s),
  updateFuelSale: (id: string, s: object) => dbUpdate('fuel_sales', id, s),
  deleteFuelSale: (id: string) => dbDelete('fuel_sales', id),

  // Shop Sales
  getShopSales:   () => dbSelectAll<any>('shop_sales'),
  addShopSale:    (s: object) => dbInsert('shop_sales', s),
  updateShopSale: (id: string, s: object) => dbUpdate('shop_sales', id, s),
  deleteShopSale: (id: string) => dbDelete('shop_sales', id),
  addShopSaleItems: async (items: object[]) => {
    const { error } = await supabase.from('shop_sale_items').insert(items as any);
    if (error) console.warn('[addShopSaleItems]', error.message);
    return { error };
  },
  getShopSaleItems: (saleId: string) => dbSelect('shop_sale_items', { sale_id: saleId }),

  // Delivery Notes
  getDeliveryNotes:   () => dbSelect('delivery_notes'),
  addDeliveryNote:    (d: object) => dbInsert('delivery_notes', d),
  updateDeliveryNote: (id: string, d: object) => dbUpdate('delivery_notes', id, d),
  deleteDeliveryNote: (id: string) => dbDelete('delivery_notes', id),
  addDeliveryNotePhoto:   (p: object) => dbInsert('delivery_note_photos', p),
  addDeliveryNotePayment: (p: object) => dbInsert('delivery_note_payments', p),
  getDeliveryNotePhotos:  (noteId: string) => dbSelect('delivery_note_photos', { delivery_note_id: noteId }),
  getDeliveryNotePayments:(noteId: string) => dbSelect('delivery_note_payments', { delivery_note_id: noteId }),

  // Purchases
  getPurchases:   () => dbSelect('purchases'),
  addPurchase:    (p: object) => dbInsert('purchases', p),
  updatePurchase: (id: string, p: object) => dbUpdate('purchases', id, p),
  deletePurchase: (id: string) => dbDelete('purchases', id),
  addPurchaseItems: async (items: object[]) => {
    const { error } = await supabase.from('purchase_items').insert(items as any);
    if (error) console.warn('[addPurchaseItems]', error.message);
    return { error };
  },
  getPurchaseItems:   (purchaseId: string) => dbSelect('purchase_items', { purchase_id: purchaseId }),
  addPurchasePayment: (p: object) => dbInsert('purchase_payments', p),
  getPurchasePayments:(purchaseId: string) => dbSelect('purchase_payments', { purchase_id: purchaseId }),
  /** Editing a purchase rewrites its lines: the old rows are dropped first, so
   *  cuve lines and payment methods added while editing are actually saved. */
  deletePurchaseItems: async (purchaseId: string) => {
    const { error } = await supabase.from('purchase_items').delete().eq('purchase_id', purchaseId);
    if (error) console.warn('[deletePurchaseItems]', error.message);
    return { error };
  },
  deletePurchasePayments: async (purchaseId: string) => {
    const { error } = await supabase.from('purchase_payments').delete().eq('purchase_id', purchaseId);
    if (error) console.warn('[deletePurchasePayments]', error.message);
    return { error };
  },
  addPurchasePayments: async (rows: object[]) => {
    if (!rows.length) return { error: null };
    const { error } = await supabase.from('purchase_payments').insert(rows as any);
    if (error) console.warn('[addPurchasePayments]', error.message);
    return { error };
  },

  // Bank accounts + treasury ledger (general caisse & bank movements)
  getBankAccounts:   () => dbSelect('bank_accounts'),
  addBankAccount:    (b: object) => dbInsert('bank_accounts', b),
  updateBankAccount: (id: string, b: object) => dbUpdate('bank_accounts', id, b),
  deleteBankAccount: (id: string) => dbDelete('bank_accounts', id),

  /**
   * TOUT le grand livre, paginé (`dbSelectAll`).
   *
   * La lecture s'arrêtait aux 2 000 lignes les plus récentes. Rien n'était perdu
   * en base, mais les soldes — caisses et comptes bancaires — sont la SOMME de
   * ces lignes : passé ce seuil, chaque écran de trésorerie annonçait un solde
   * amputé de tout ce qui précédait, sans le moindre message.
   */
  getTreasuryTransactions: async () =>
    dbSelectAll<any>('treasury_transactions', { orderBy: 'date' }).catch(err => {
      console.warn('[getTreasuryTransactions]', err);
      return [] as any[];
    }),
  addTreasuryTransaction:    (t: object) => dbInsert('treasury_transactions', t),
  updateTreasuryTransaction: (id: string, t: object) => dbUpdate('treasury_transactions', id, t),
  deleteTreasuryTransaction: (id: string) => dbDelete('treasury_transactions', id),

  // Expenses
  //
  // `part` — l'activité qui supporte la dépense — arrive avec la migration
  // `2026-08-16_expense_part_and_part_cash.sql`. Tant qu'elle n'est pas passée,
  // Postgres refuse l'écriture ENTIÈRE à cause de cette seule colonne inconnue,
  // et la dépense serait purement perdue. On réessaie donc une fois sans elle,
  // en le disant dans la console : la dépense est enregistrée, seule son
  // imputation attend la migration. Toute autre erreur remonte comme avant.
  // Paginé : les dépenses sortent des caisses, un plafond de lecture les
  // aurait fait disparaître du solde sans rien signaler.
  getExpenses:   () => dbSelectAll<any>('expenses'),
  addExpense:    (e: object) => writeExpense(() => dbInsert('expenses', e), e, rest => dbInsert('expenses', rest)),
  updateExpense: (id: string, e: object) => writeExpense(() => dbUpdate('expenses', id, e), e, rest => dbUpdate('expenses', id, rest)),
  deleteExpense: (id: string) => dbDelete('expenses', id),

  // Inventories
  getInventories:   () => dbSelect('inventories'),
  addInventory:     (i: object) => dbInsert('inventories', i),
  updateInventory:  (id: string, i: object) => dbUpdate('inventories', id, i),
  deleteInventory:  (id: string) => dbDelete('inventories', id),

  // Daily Reports
  getDailyReports: () => dbSelect('daily_reports'),
  addDailyReport:  (r: object) => dbInsert('daily_reports', r),

  // Permission Templates
  getPermissionTemplates:    () => dbSelect('permission_templates'),
  addPermissionTemplate:     (t: object) => dbInsert('permission_templates', t),
  updatePermissionTemplate:  (id: string, t: object) => dbUpdate('permission_templates', id, t),
  deletePermissionTemplate:  (id: string) => dbDelete('permission_templates', id),

  // Admin Profiles
  getAdminProfiles: () => dbSelect('admin_profiles'),
  getAdminProfile: async (id: string) => {
    const { data } = await supabase.from('admin_profiles').select('*').eq('id', id).maybeSingle();
    return data ?? null;
  },
  updateAdminProfile: (id: string, patch: Record<string, unknown>) => dbUpdate('admin_profiles', id, patch),

  // Activity Log
  addActivityLog: (entry: object) =>
    dbInsert('activity_log', { id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`, timestamp: new Date().toISOString(), ...entry }),
  getActivityLog: () => dbSelect('activity_log', undefined, 200),
};

// ─── Camel ↔ Snake conversion helpers (unchanged) ───────────────────────────────
function toCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function toSnake(str: string): string {
  return str.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

export function rowToCamel<T extends object>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out as T;
}

export function objToSnake<T extends object>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[toSnake(k)] = v;
  return out as T;
}

export function rowsToCamel<T extends object>(rows: Record<string, unknown>[]): T[] {
  return rows.map(r => rowToCamel<T>(r));
}

// ─── Realtime subscription ──────────────────────────────────────────────────────
export function subscribeTable(
  table: string,
  callback: (payload: { eventType: string; new: unknown; old: unknown }) => void
) {
  const channel = supabase
    .channel(`realtime:${table}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload: any) => {
        callback({ eventType: payload.eventType, new: payload.new, old: payload.old });
      }
    )
    // The status feeds the health tracker above: when the websocket cannot be
    // reached at all, the app falls back to polling instead of going stale.
    .subscribe((status: string) => reportRealtimeStatus(status));

  return () => { supabase.removeChannel(channel); };
}
