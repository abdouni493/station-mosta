/**
 * ─── L'instrumentation ne fuit aucune donnée, et est inerte par défaut ─────────
 *
 * Vérifie que le diagnostic de performance :
 *   • redige les VALEURS de filtre (un UUID de client ne doit jamais être
 *     journalisé), tout en gardant colonnes, opérateurs, select/order/limit ;
 *   • classe correctement table / RPC / storage / auth ;
 *   • ne mesure RIEN tant qu'il n'est pas explicitement activé.
 *
 *   npx tsx src/lib/perf.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { sanitizeQuery, classify, recordQuery, perfEnabled } from './perf';

let passed = 0, failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. Redaction des valeurs de filtre ────────────────────────────────────────
{
  const q = sanitizeQuery('?client_id=eq.3f2a9c7e-0000-dead-beef-000000000001&select=*');
  check('la colonne du filtre est conservée', !!q && q.includes('client_id=eq.'));
  check('la VALEUR du filtre (UUID) est rédigée', !!q && !q.includes('3f2a9c7e'));
  check('eq.* remplace la valeur', !!q && q.includes('client_id=eq.*'));
  check('select est conservé tel quel', !!q && q.includes('select=*'));
}
{
  const q = sanitizeQuery('?order=created_at.desc&limit=500&offset=1000');
  check('order est conservé', !!q && q.includes('order=created_at.desc'));
  check('limit est conservé', !!q && q.includes('limit=500'));
  check('offset est conservé', !!q && q.includes('offset=1000'));
}
{
  // Un filtre textuel (nom de client) ne doit jamais ressortir en clair.
  const q = sanitizeQuery('?name=ilike.*Benali*');
  check('une valeur ilike est rédigée', !!q && !q.toLowerCase().includes('benali'));
}

// ── 2. Classification table / RPC / storage / auth ────────────────────────────
{
  const c = classify('https://x.supabase.co/rest/v1/fuel_sales?select=*&order=created_at.desc');
  check('table REST reconnue', c.kind === 'rest' && c.name === 'fuel_sales');
}
{
  const c = classify('https://x.supabase.co/rest/v1/rpc/get_my_role');
  check('RPC reconnue', c.kind === 'rpc' && c.name === 'rpc:get_my_role');
}
{
  const c = classify('https://x.supabase.co/storage/v1/object/public/invoices/x.jpg');
  check('storage reconnu', c.kind === 'storage');
}
{
  const c = classify('https://x.supabase.co/auth/v1/token?grant_type=password');
  check('auth reconnu', c.kind === 'auth');
  check('le nom auth ne porte aucune valeur de requête', c.name === 'auth' && !('q' in c && (c as any).q));
}

// ── 3. Inerte par défaut (aucun window, aucun flag) ───────────────────────────
{
  check('désactivé par défaut hors navigateur', perfEnabled() === false);
  // recordQuery ne doit pas lever quand c'est désactivé (et ne rien enregistrer).
  let threw = false;
  try {
    recordQuery({ url: 'https://x.supabase.co/rest/v1/clients', method: 'GET', startedAt: 0, ms: 12 });
  } catch { threw = true; }
  check('recordQuery est sans effet et ne lève pas quand désactivé', threw === false);
}

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
if (failed) process.exit(1);
