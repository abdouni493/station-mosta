/**
 * Quelles écritures peut-on rejouer après une coupure sans rien doubler ?
 * Lancer : npx tsx src/lib/writeRetry.test.ts
 */
import { writeKind } from './supabase';

let failed = 0;
const check = (label: string, got: any, want: any) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — reçu ${got}, attendu ${want}`}`);
};

const base = 'https://x.supabase.co/rest/v1';
check('PATCH brigade → rejouable', writeKind('PATCH', `${base}/brigades?id=eq.1`), 'idempotent');
check('DELETE ligne de trésorerie → rejouable', writeKind('DELETE', `${base}/treasury_transactions?id=eq.1`), 'idempotent');
check('POST insertion → doublon = succès', writeKind('POST', `${base}/treasury_transactions`), 'insert');
check('POST upsert → rejouable', writeKind('POST', `${base}/brigade_accounting?on_conflict=id`,
  { headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }), 'idempotent');
check('RPC cumulative → jamais rejouée', writeKind('POST', `${base}/rpc/adjust_tank_level`), 'unsafe');
check('RPC idempotente → rejouable', writeKind('POST', `${base}/rpc/adjust_tank_level_once`), 'idempotent');
check('Auth → jamais rejoué', writeKind('POST', 'https://x.supabase.co/auth/v1/token?grant_type=password'), 'unsafe');

if (failed) { console.error(`\n${failed} échec(s)`); process.exit(1); }
