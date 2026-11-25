# Optimisation performance — 2026-11-26

Session avec **accès réel à la base Supabase** (ce que la session précédente n'avait pas).
Cause racine re-diagnostiquée sur les vrais chiffres, puis corrigée.

---

## 1. Le vrai problème (mesuré, pas supposé)

La session précédente, **sans accès à la base**, avait supposé « trop de données ». C'est faux.

Mesures sur l'instance réelle :

| Fait mesuré | Valeur |
|---|---|
| Taille totale du schéma `public` | **11 Mo** (62 tables) |
| Plus grosses tables | `brigade_accounting_justifications` 2 802 lignes · `treasury_transactions` 1 657 · `tpe_transactions` 1 028 |
| Toutes les autres tables | quelques **centaines** de lignes |
| Index | **135 index, `idx_scan = 0`** sur presque tous (cumul depuis la création : `stats_reset` = NULL) |
| Politiques RLS | toutes `USING (true)` → **coût par ligne nul** |
| Requêtes au login | **~48 allers-retours REST** (16 Phase 1 bloquante + ~32 Phase 2) |

**Conclusion :** ce n'est pas un problème de volume, c'est un problème de **nombre d'allers-retours**.
Sur le réseau lent d'une station, 48 requêtes séquentielles (chacune avec SSL + PostgREST + RLS)
franchissent le délai de 15 s → message « Délai de chargement dépassé » et erreurs de chargement.

Deuxième coût : quand le WebSocket temps réel est bloqué (fréquent en station), l'app **re-télécharge
9 tables entières toutes les 60 s** (polling). C'est le coût permanent pendant l'usage.

Les écritures (créer / modifier / supprimer) sont **déjà optimistes** (UI instantanée) : elles
n'étaient pas la cause, et n'ont pas été touchées.

---

## 2. Ce qui a changé

Tout est **additif, réversible, avec repli automatique** sur l'ancien comportement. **Aucune donnée,
aucun solde, aucun calcul, aucun droit n'est modifié** — seule change la *façon de transporter* les lignes.

### a) Démarrage en 2 requêtes au lieu de ~48 — `supabase/optimizations/bootstrap_rpc.sql`
- `app_bootstrap_phase1()` renvoie en **une** requête les 16 tables de référence (≈ 31 Ko).
- `app_bootstrap_phase2()` renvoie en **une** requête les ~33 tables transactionnelles (≈ 5,2 Mo,
  soit ~0,6 Mo compressés sur le réseau — **une** réponse gzip au lieu de 32).
- `SECURITY INVOKER` : la RLS s'applique exactement comme une lecture directe. `STABLE`, lecture seule.
- Lignes **identiques** à `select *` (colonnes snake_case) → le mapping d'hydratation est inchangé.
- `src/store/AppContext.tsx` : l'hydratation tente ces RPC ; **si elles manquent ou échouent, elle
  retombe sur les ~48 lectures table par table d'origine.** Déploiement code avant/après SQL = sans risque.

### b) Polling allégé par empreinte — même fichier SQL + `AppContext.tsx`
- `app_tables_fingerprint(text[])` renvoie un hachage de contenu par table (couvre **toutes** les
  colonnes → insert/update/delete détectés ; `to_regclass` + `%I` = aucune injection possible).
- Le polling de secours **sonde** d'abord cette fonction (réponse minuscule) et ne relit QUE les
  entités dont une table (filles comprises) a réellement changé. Au repos : ~0 octet au lieu de ~2-3 Mo/min.
- Si la sonde est absente/échoue → relecture complète comme avant (repli sûr).

### Mesure de la réduction au login
`app_bootstrap_phase1` + `app_bootstrap_phase2` = **2 requêtes** là où le parcours mesuré en comptait **~48**.

---

## 3. Ce qui N'A PAS changé — et pourquoi

- **Les 135 index sont conservés.** Après inspection une par une, ce sont des index de clés
  étrangères / de recherche / de tri légitimes (`client_id`, `purchase_id`, `worker_id`,
  `created_at DESC`…). `idx_scan = 0` vient de la **petite taille** des tables (Postgres préfère un
  seq scan) — ils deviendront utiles à mesure que les données grossissent. Les supprimer n'aurait
  presque rien gagné (coût d'écriture en microsecondes sur des tables de centaines de lignes) et
  aurait nui plus tard. Quelques-uns servent déjà (`whatsapp_outbox_queue_idx` : 70 scans).
- **Le temps réel WebSocket** (relecture de table sur événement, anti-rebond 600 ms) est **laissé
  tel quel** : il est correct et déclenché par événement. Le réécrire ligne par ligne aurait risqué
  la logique délicate des sous-enregistrements (le test `refetchKeepsSubRecords` documente ces bugs
  passés) pour un gain marginal face à des écritures déjà optimistes.
- **Le blob `biz_store`** (2,3 Mo, module Cafétéria/Lavage) n'est pas découpé (hors périmètre).

---

## 4. Vérifications passées dans cette session

- `npx tsc --noEmit` → **0 erreur**
- `npx vite build` → **succès** (10,3 s)
- Suite de tests complète (`*.test.ts` via `tsx`) → **28 suites OK, 0 échec**, dont
  `refetchKeepsSubRecords` (le miroir d'écriture ne perd aucun sous-enregistrement).
- RPC testées sur la vraie base : comptes **identiques** aux tables (clients 29=29, trésorerie
  1657=1657, justifications 2802=2802…) ; exécution OK sous le rôle `authenticated`.

Mesure avant/après côté navigateur : ouvrir avec `?perf=1`, se connecter, Dashboard, puis
`window.__altechPerf.table()` — compter les requêtes du login (voir `PERFORMANCE-REPORT.md`).

---

## 5. Sécurité / retour arrière

- **Retrait SQL** (si besoin) : `DROP FUNCTION IF EXISTS public.app_bootstrap_phase1();`
  `… app_bootstrap_phase2();` `… app_tables_fingerprint(text[]);` — le code reprend seul les
  lectures table par table.
- **Retrait code** : le repli est déjà intégré ; sans les fonctions, l'app fonctionne comme avant.

## 6. Fichiers

- **Nouveau** : `supabase/optimizations/bootstrap_rpc.sql` (déjà appliqué à la base).
- **Modifié** : `src/store/AppContext.tsx` (hydratation en 2 appels + polling par empreinte, repli complet).

## 7. Piste suivante (non faite)

Sortir l'historique des ventes du blob `biz_store` vers une table paginée (`biz_products` a déjà
montré le chemin) — c'est le plus gros transfert unique restant du module Cafétéria/Lavage.
