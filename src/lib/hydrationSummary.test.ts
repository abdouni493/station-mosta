/**
 * ─── Une lecture en échec ne se déguise JAMAIS en liste vide réussie ───────────
 *
 * Le cœur du correctif de fiabilité : chaque table a un statut, et une lecture
 * `error` est TOUJOURS remontée à l'écran. Ce cas verrouille cet invariant et le
 * comportement du résumé (démarrage lent, échec critique, libellés FR, tri).
 *
 *   npx tsx src/lib/hydrationSummary.test.ts
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { summarizeHydration, hydrationLabel, type HydrationStatus } from './hydrationSummary';

let passed = 0, failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// ── 1. Une table en erreur est signalée (jamais présentée comme vide réussie) ──
{
  const h: HydrationStatus = {
    'Fuel Sales': { state: 'error', error: 'RLS: permission denied' },
    'Shop Sales': { state: 'ready' },
  };
  const s = summarizeHydration(h);
  check('une lecture en échec est listée', s.failed.length === 1);
  check('la table en échec est bien identifiée', s.failed[0]?.key === 'Fuel Sales');
  check('le libellé est lisible en français', s.failed[0]?.label === 'Ventes carburant');
  check('le message d’erreur est conservé pour le diagnostic', s.failed[0]?.error === 'RLS: permission denied');
  check('une table lue avec succès n’apparaît PAS dans les échecs', !s.failed.some(f => f.key === 'Shop Sales'));
}

// ── 2. Une table ready mais VIDE n'est pas une erreur ─────────────────────────
{
  const s = summarizeHydration({ 'Client Transactions': { state: 'ready' } });
  check('une table lue et vide n’est pas un échec', s.failed.length === 0);
}

// ── 3. Démarrage lent (timeout Phase 1) ≠ données complètes ───────────────────
{
  const s = summarizeHydration({ __startup: { state: 'slow' } });
  check('le démarrage lent est signalé', s.slow === true);
  check('le démarrage lent n’est pas une erreur critique', s.startupError === false);
  check('le démarrage lent n’est pas compté comme une table en échec', s.failed.length === 0);
}

// ── 4. Échec critique du démarrage ────────────────────────────────────────────
{
  const s = summarizeHydration({ __startup: { state: 'error', error: 'network' } });
  check('l’échec critique du démarrage est signalé', s.startupError === true);
  check('__startup n’est jamais listé comme une table', s.failed.length === 0);
}

// ── 5. Plusieurs échecs → triés par libellé FR ────────────────────────────────
{
  const h: HydrationStatus = {
    'Treasury': { state: 'error' },
    'Bank Accounts': { state: 'error' },
    'Expenses': { state: 'error' },
  };
  const s = summarizeHydration(h);
  const labels = s.failed.map(f => f.label);
  const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'fr'));
  check('les échecs multiples sont tous remontés', s.failed.length === 3);
  check('les échecs sont triés par libellé', JSON.stringify(labels) === JSON.stringify(sorted));
}

// ── 6. Robustesse : entrée indéfinie / vide ───────────────────────────────────
{
  check('hydration indéfinie → aucun échec', summarizeHydration(undefined).failed.length === 0);
  check('hydration vide → aucun échec', summarizeHydration({}).failed.length === 0);
  check('clé inconnue → libellé = clé (rien masqué)', hydrationLabel('table_x') === 'table_x');
}

console.log(`\n${passed} réussi(s), ${failed} échec(s)`);
if (failed) process.exit(1);
