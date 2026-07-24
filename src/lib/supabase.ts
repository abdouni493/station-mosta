/**
 * ─── SUPABASE CLIENT (live backend) ────────────────────────────────────────────
 * Real Supabase connection for the StationPro app. It keeps the EXACT same public
 * surface the previous offline mock exposed (`supabase`, `db`, `signIn`,
 * `dbInsert`, `subscribeTable`, storage helpers, …), so every page, interface and
 * button in the app talks to the live database and Storage buckets without any
 * other file needing changes.
 *
 * Project: ecafyqlvjqiwetkmboum   (see supabase/setup.sql for the schema)
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { createClient } from '@supabase/supabase-js';

// Connection — values come from Vite env when present, otherwise fall back to the
// project this app is wired to. The anon key is public by design (RLS protects data).
const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  'https://ecafyqlvjqiwetkmboum.supabase.co';
const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjYWZ5cWx2anFpd2V0a21ib3VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTkxNTgsImV4cCI6MjEwMDQ5NTE1OH0.NwpGCQNWnWRoAXKYhlSAbizEJArHlQtohKJasYqDvLE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'stationpro.auth',
  },
});

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

async function resolveRole(): Promise<string | null> {
  try {
    const { data } = await supabase.rpc('get_my_role');
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Sign in with an email OR a username (+ password). Returns the resolved role so
 * the login page can route the user; returns `{ error }` on failure.
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
  if (error) return { error: error.message };

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

// ─── Generic DB helpers (real Supabase queries) ─────────────────────────────────

export async function dbInsert<T extends object>(tableName: string, row: T): Promise<T> {
  const { error } = await supabase.from(tableName).insert(row as any);
  if (error) console.warn(`[dbInsert:${tableName}]`, error.message);
  return row;
}

export async function dbUpsert<T extends object>(tableName: string, row: T): Promise<T> {
  const { error } = await supabase.from(tableName).upsert(row as any);
  if (error) console.warn(`[dbUpsert:${tableName}]`, error.message);
  return row;
}

export async function dbUpdate<T extends object>(
  tableName: string,
  id: string,
  changes: Partial<T>
): Promise<Partial<T>> {
  const { error } = await supabase.from(tableName).update(changes as any).eq('id', id);
  if (error) console.warn(`[dbUpdate:${tableName}]`, error.message);
  return changes;
}

export async function dbDelete(tableName: string, id: string) {
  const { error } = await supabase.from(tableName).delete().eq('id', id);
  if (error) console.warn(`[dbDelete:${tableName}]`, error.message);
}

export async function dbSelect<T>(
  tableName: string,
  query?: Record<string, unknown>,
  limit?: number
): Promise<T[]> {
  let q = supabase.from(tableName).select('*');
  if (query) {
    for (const [k, v] of Object.entries(query)) q = q.eq(k, v as any);
  }
  const { data, error } = await q;
  if (error) { console.warn(`[dbSelect:${tableName}]`, error.message); return []; }

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
  getClients:   () => dbSelect('clients'),
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
  getWorkerAbsences:       (workerId: string) => dbSelect('worker_absences', { worker_id: workerId }),
  addWorkerAbsence:        (a: object) => dbUpsert('worker_absences', a),
  getWorkerPaymentRecords: (workerId: string) => dbSelect('worker_payment_records', { worker_id: workerId }),
  addWorkerPaymentRecord:  (p: object) => dbInsert('worker_payment_records', p),
  markPaymentPaid: async (paymentId: string) => dbUpdate('worker_payment_records', paymentId, { is_paid: true }),

  // Brigades
  getBrigades:   () => dbSelect('brigades'),
  addBrigade:    (b: object) => dbInsert('brigades', b),
  updateBrigade: (id: string, b: object) => dbUpdate('brigades', id, b),
  deleteBrigade: (id: string) => dbDelete('brigades', id),

  // Decalage history
  addDecalageHistory: (d: object) => dbInsert('pompiste_decalage_history', d),
  getDecalageHistory: (pompisteId: string) => dbSelect('pompiste_decalage_history', { pompiste_id: pompisteId }),

  // Brigade Accounting
  getBrigadeAccountings: () => dbSelect('brigade_accounting'),
  addBrigadeAccounting: (a: object) => dbInsert('brigade_accounting', a),
  updateBrigadeAccounting: (id: string, a: object) => dbUpdate('brigade_accounting', id, a),
  getBrigadeAccountingJustifications: (accountingId: string) =>
    dbSelect('brigade_accounting_justifications', { accounting_id: accountingId }),
  addBrigadeAccountingJustification: (j: object) => dbInsert('brigade_accounting_justifications', j),

  // Fuel Sales
  getFuelSales:   () => dbSelect('fuel_sales'),
  addFuelSale:    (s: object) => dbInsert('fuel_sales', s),
  updateFuelSale: (id: string, s: object) => dbUpdate('fuel_sales', id, s),
  deleteFuelSale: (id: string) => dbDelete('fuel_sales', id),

  // Shop Sales
  getShopSales:   () => dbSelect('shop_sales'),
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

  // Expenses
  getExpenses:   () => dbSelect('expenses'),
  addExpense:    (e: object) => dbInsert('expenses', e),
  updateExpense: (id: string, e: object) => dbUpdate('expenses', id, e),
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
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
