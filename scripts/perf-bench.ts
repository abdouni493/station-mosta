/**
 * ─── Banc de mesure du chargement (fixtures SYNTHÉTIQUES, aucune donnée client) ─
 *
 * Reproductible, hors navigateur, sans base réelle. Il quantifie ce qui est
 * mesurable ici :
 *
 *   1. COÛT CÔTÉ NAVIGATEUR — le temps de fusion parent/enfant (groupBy + map)
 *      que `AppContext` exécute APRÈS avoir reçu les tables. On le mesure pour des
 *      volumes croissants : c'est la part qui grossit avec l'historique.
 *   2. VOLUME JSON ESTIMÉ — octets transférés par table selon le nombre de lignes.
 *   3. NOMBRE D'ALLERS-RETOURS — compte réel des lectures de l'hydratation
 *      (Phase 1 bloquante vs Phase 2 d'arrière-plan), lu dans le code source.
 *
 * Il NE se connecte à rien et n'affirme aucun gain qu'il n'a pas mesuré. C'est le
 * socle « avant » : le vrai « avant/après » sur le déploiement réel se fait avec
 * l'instrumentation (lib/perf.ts, `window.__altechPerf`), cf. le rapport.
 *
 *   npx tsx scripts/perf-bench.ts
 *   npx tsx scripts/perf-bench.ts 1000 5000 20000 50000   (volumes personnalisés)
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Copie fidèle du groupBy de AppContext (même algorithme) ───────────────────
function groupBy<T>(rows: T[] | null | undefined, key: (r: T) => unknown): Map<unknown, T[]> {
  const m = new Map<unknown, T[]>();
  for (const r of rows || []) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
}
const EMPTY: any[] = [];
const of = (m: Map<unknown, any[]>, k: unknown) => m.get(k) || EMPTY;

function now(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function fmt(n: number): string { return n.toLocaleString('fr-FR'); }
function kb(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' Mo';
  return Math.round(bytes / 1024) + ' Ko';
}

// ── 1. Fixtures synthétiques : ventes magasin + leurs articles, clients + leurs
//    mouvements. Même forme de fusion que l'hydratation réelle. ────────────────
function makeShopSales(n: number) {
  const sales = Array.from({ length: n }, (_, i) => ({
    id: `sale-${i}`, created_at: new Date(Date.now() - i * 60000).toISOString(),
    total: Math.round(Math.random() * 10000), mode: i % 2 ? 'cash' : 'credit',
  }));
  // ~2,5 articles par vente en moyenne
  const items: any[] = [];
  for (let i = 0; i < n; i++) {
    const k = 1 + (i % 4);
    for (let j = 0; j < k; j++) {
      items.push({ id: `it-${i}-${j}`, sale_id: `sale-${i}`, product_id: `p-${j}`, product_name: `Produit ${j}`, quantity: j + 1, price: 100 + j, tva: 0 });
    }
  }
  return { sales, items };
}

function makeClients(n: number) {
  const clients = Array.from({ length: n }, (_, i) => ({ id: `c-${i}`, name: `Client ${i}`, debt: 0 }));
  const tx: any[] = [];
  // ~6 mouvements par client
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 6; j++) {
      tx.push({ id: `tx-${i}-${j}`, client_id: `c-${i}`, date: '2026-01-01', type: 'SALE', amount: 1000, mode: 'cash', receipt_number: null, receipt_photo_url: null, notes: null });
    }
  }
  return { clients, tx };
}

/** Reproduit la fusion que fait AppContext (groupBy enfants + map parents). */
function mergeShopSales(sales: any[], items: any[]) {
  const bySale = groupBy(items, (i: any) => i.sale_id);
  return sales.map(s => ({
    ...s,
    items: of(bySale, s.id).map((i: any) => ({ productId: i.product_id, productName: i.product_name, quantity: +i.quantity, price: +i.price, tva: +(i.tva ?? 0) })),
  }));
}
function mergeClients(clients: any[], tx: any[]) {
  const byClient = groupBy(tx, (t: any) => t.client_id);
  return clients.map(c => ({
    ...c,
    transactionHistory: of(byClient, c.id).map((t: any) => ({ id: t.id, date: t.date, type: t.type, amount: +t.amount, mode: t.mode, receiptNumber: t.receipt_number, receiptPhoto: t.receipt_photo_url, notes: t.notes })),
  }));
}

function bench(label: string, fn: () => void): number {
  // chauffe
  fn();
  const reps = 5;
  const t0 = now();
  for (let i = 0; i < reps; i++) fn();
  const ms = (now() - t0) / reps;
  console.log(`   ${label.padEnd(42)} ${ms.toFixed(1).padStart(8)} ms / passage`);
  return ms;
}

const sizes = process.argv.slice(2).map(Number).filter(n => n > 0);
const VOLUMES = sizes.length ? sizes : [1000, 5000, 20000, 50000];

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(' BANC DE MESURE — fixtures synthétiques (aucune donnée réelle)');
console.log('══════════════════════════════════════════════════════════════════');

console.log('\n1) COÛT CÔTÉ NAVIGATEUR — fusion parent/enfant après réception');
console.log('   (temps CPU pur ; le réseau s’ajoute par-dessus)\n');
for (const n of VOLUMES) {
  const { sales, items } = makeShopSales(n);
  const { clients, tx } = makeClients(Math.max(1, Math.round(n / 3)));
  console.log(`  ── ${fmt(n)} ventes (${fmt(items.length)} articles) + ${fmt(clients.length)} clients (${fmt(tx.length)} mouvements) ──`);
  bench('fusion ventes magasin + articles', () => mergeShopSales(sales, items));
  bench('fusion clients + mouvements', () => mergeClients(clients, tx));
  console.log('');
}

// ── 2. Volume JSON estimé par table ───────────────────────────────────────────
console.log('2) VOLUME JSON ESTIMÉ par table (octets/ligne × lignes)');
console.log('   Un index NE réduit PAS ce volume : seules la sélection de colonnes,');
console.log('   la pagination et les agrégats serveur le font.\n');
const BYTES_PER_ROW: Record<string, number> = {
  fuel_sales: 220, shop_sales: 200, shop_sale_items: 160, treasury_transactions: 260,
  client_transactions: 240, brigade_accounting: 900, purchases: 300,
};
for (const n of VOLUMES) {
  console.log(`  ── ${fmt(n)} lignes par table ──`);
  for (const [t, b] of Object.entries(BYTES_PER_ROW)) {
    console.log(`     ${t.padEnd(26)} ≈ ${kb(b * n).padStart(9)}`);
  }
  console.log('');
}

// ── 3. Nombre d'allers-retours réels de l'hydratation (lu dans le code) ────────
console.log('3) ALLERS-RETOURS DE L’HYDRATATION (comptés dans AppContext.tsx)');
try {
  const src = readFileSync(join(process.cwd(), 'src/store/AppContext.tsx'), 'utf8');
  const hydrateStart = src.indexOf('async function hydrate()');
  const hydrateEnd = src.indexOf('isHydrating.current = true;', hydrateStart);
  const body = hydrateStart >= 0 ? src.slice(hydrateStart, hydrateEnd) : src;

  const p1Start = body.indexOf('PHASE 1');
  const p2Start = body.indexOf('PHASE 2');
  const phase1 = body.slice(p1Start, p2Start);
  const phase2 = body.slice(p2Start);

  const countReads = (s: string) =>
    (s.match(/\bdb\.get[A-Z]/g) || []).length +
    (s.match(/supabase\.from\(/g) || []).length +
    (s.match(/dbSelectAll</g) || []).length +
    (s.match(/loadBrigadeAccountingsWithJustifications/g) || []).length;

  const p1 = countReads(phase1);
  const p2 = countReads(phase2);
  console.log(`   Phase 1 (BLOQUE le premier rendu) : ~${p1} lectures en parallèle`);
  console.log(`   Phase 2 (arrière-plan, isSyncing)  : ~${p2} lectures`);
  console.log(`   Total au login                     : ~${p1 + p2} lectures`);
  console.log('   NB : plusieurs passent par dbSelectAll → pagination = plusieurs');
  console.log('        requêtes HTTP chacune sur les grosses tables.');
} catch (e) {
  console.log('   (source introuvable : exécuter depuis la racine du dépôt)');
}

console.log('\n── Rappel : ce banc mesure le socle actuel. Le « avant/après » réel du');
console.log('   déploiement se relève avec window.__altechPerf (voir le rapport). ──\n');
