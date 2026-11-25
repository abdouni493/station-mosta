# Rapport de performance — station-mosta

Branche : `claude/station-mosta-perf-loading-m81171` (= `main` publié au départ)
Déploiement public : https://station-kara.vercel.app/
Rien n'a été poussé ni déployé. Aucune donnée de production n'a été lue, modifiée ou supprimée.

---

## 0. Résumé exécutif

### Cause racine confirmée (par lecture du code)
L'application **télécharge la quasi-totalité de la base dans un magasin global en mémoire à chaque
connexion**, puis **tous** les écrans lisent depuis ce magasin. Les soldes (caisses, comptes
bancaires, clients, fournisseurs) et les chiffres du tableau de bord sont la **somme de grands
livres chargés entièrement**. C'est pourquoi le code lit ces tables *en entier* (`dbSelectAll`) et
pourquoi le temps réel **retélécharge des tables entières** à chaque événement. Le temps de
démarrage est donc proportionnel au volume total de données : il grossit mois après mois et finit
par dépasser le délai de 15 s de la Phase 1 → message « Délai de chargement dépassé ».

Mesuré sur le code (`scripts/perf-bench.ts`) : **~48 lectures au login** — ~16 bloquant le premier
rendu (Phase 1) + ~32 en arrière-plan (Phase 2) — dont plusieurs paginées (plusieurs requêtes HTTP
chacune). À 5 000 lignes par table, la seule comptabilité de brigade représente déjà ≈ 4 Mo de JSON.

### Contrainte structurante (pourquoi on ne « borne » pas les lectures)
Borner ces lectures corromprait les soldes **et** casserait le miroir d'écriture : les
rafraîchissements temps réel reconstruisent l'état complet en mémoire, et une édition/suppression
optimiste ultérieure se réconcilie contre lui. Une lecture partielle ferait **disparaître des
lignes**. C'est exactement l'interdit posé dans la demande. Toute réduction de volume sûre passe
donc par des **agrégats côté serveur + pagination par écran** (section 5), qui exigent un accès à
la base réelle et une analyse de tous les consommateurs — hors de portée d'une session sans base de
staging.

### Ce qui a été livré ici (sûr, testé, sans toucher aux données/calculs/droits)
1. **Instrumentation durable** du parcours réel (désactivée par défaut, sans donnée sensible).
2. **État de chargement fiable PAR table** + erreurs identifiables par écran, en remplacement du
   message générique et de l'anti-motif « lecture en échec présentée comme liste vide réussie ».
3. **Deux fichiers SQL** : diagnostic strictement en lecture seule + index non destructifs guardés.
4. **Tests exécutables** (invariants de fiabilité + non-fuite de l'instrumentation) et un **banc de
   mesure** à fixtures synthétiques.
5. **Un plan d'optimisation stratégique** (agrégats serveur, pagination, sync incrémentale) avec
   étapes précises, à mener avec accès à la base.

### Limite assumée
Pas de navigateur ni d'identifiants de test ni de base de staging disponibles dans cette session.
**Aucune mesure « avant/après » sur la vraie base n'est revendiquée.** L'instrumentation et le banc
fournissent la méthode exacte pour la relever (sections 3–4), et des étapes de validation manuelle
sur une préversion sont données en section 9.

---

## 1. État du dépôt (Étape 1)

- `git status` propre au départ ; branche de départ `claude/station-mosta-perf-loading-m81171`,
  identique à `origin/main` (0 commit d'écart). Travaux menés sur cette branche (celle imposée par
  l'environnement et seule autorisée au push).
- Pas de lanceur de tests installé : les `*.test.ts` sont des **scripts autonomes** lancés par
  `npx tsx <fichier>` (convention du dépôt). `npm run lint` = `tsc --noEmit`. `npm run build` =
  `vite build` + bundle serveur esbuild.
- Migrations présentes : `supabase/migrations/*` (67 `CREATE INDEX` déjà en place). `supabase/setup.sql`
  est le schéma initial — **à ne pas confondre avec le schéma réellement installé** (d'où le
  diagnostic en lecture seule, section 7).
- Aucun travail utilisateur n'a été réinitialisé, nettoyé ou écrasé. Aucun identifiant de production
  n'a été utilisé ni journalisé.

---

## 2. Cartographie des interfaces (Étape 2)

### Modèle de données commun à TOUS les écrans
`AppProvider` (`src/store/AppContext.tsx`) hydrate un **magasin global unique** en deux phases
(ci-dessous), puis chaque page lit via `useAppState()`. `BizProvider` (Cafétéria/Lavage) charge en
plus un **gros blob JSON unique** `biz_store` (~665 Ko, dont ~567 Ko d'historique de ventes, d'après
les commentaires du code) + la table `biz_products`. `FeedbackProvider` charge tous les
`client_feedbacks` (pastille d'alertes + écrans Retours clients).

### Routes (`src/App.tsx`) — toutes en lazy-load (chunks séparés)
Carburant : Dashboard, Brigades, Cuves, Pompes, Achats Carburant, Inventaires, Fiche Journalière,
Clients, Fournisseurs, Pompistes/Chefs/Gérants/Employés Magasin, Dépenses, Caisse Générale, Comptes
Bancaires, Statistiques, Rapports, Retours Clients, Permissions, Réglages.
Modules métier (Cafétéria / Lavage, via `buildModuleRoutes`) : Caisse, POS, Ventes, Stock,
Inventaire, Achats, Production/Comptoir, Clients, Fournisseurs, Travailleurs, Dépenses, Réparations,
Encaissements, Messages, Rapports, Feedbacks. Plus Rapports Généraux (admin).

### Ce que consomme chaque écran
- **Quasiment tous** : lisent le magasin global (pas de requête propre au montage). Leur « lenteur
  d'ouverture » = (a) téléchargement du chunk lazy la 1ʳᵉ fois, (b) attente de la Phase 2
  (`isSyncing`) pour des chiffres exacts, (c) recalcul/retri côté navigateur sur de grands tableaux.
- **Dashboard** : lit le magasin ; **la recette carburant est DÉRIVÉE des brigades**
  (`derivedFuelSales(app)`), pas de `fuel_sales`. Dépend donc de la Phase 2 (brigades, comptabilités,
  trésorerie, dépenses, ventes magasin). Pendant `isSyncing`, les totaux sont partiels (voir §5, le
  risque de « faux total partiel »).
- **Écrans qui émettent leurs PROPRES lectures** (au-delà du magasin) :
  `Brigades`, `GeneralReports`, `Settings`, `modules/ModuleMessages`, `modules/ModuleProduction`,
  `modules/ModulePurchases`, `modules/_shared`, `components/QrCodePanel`, `components/biz/InvoiceImage`.
  Ce sont les candidats à un audit N+1 par écran (recommandé, non fait ici faute de base).

### Lectures déclenchées
- **Au login** : Phase 1 (≈16) + Phase 2 (≈32) ; `biz_store` + `biz_products` ; `client_feedbacks`.
- **Au changement de route** : téléchargement du chunk lazy (pas de requête data en général).
- **Au montage d'un composant / ouverture d'un détail** : la plupart lisent le magasin ; quelques
  écrans (ci-dessus) lisent en direct.
- **En arrière-plan** : temps réel (abonnements `postgres_changes`) qui **relit la table entière**
  concernée ; repli par **polling de 9 tables lourdes toutes les 60 s** quand le websocket est bloqué
  (fréquent sur réseau de station).

---

## 3. Diagnostic du message de délai + instrumentation (Étape 3)

### Le délai de 15 s
`src/store/AppContext.tsx`, effet d'hydratation : un `setTimeout(15000)` **ne garde que la Phase 1**.
S'il se déclenche, il libère le spinner et affichait le toast générique
« Délai de chargement dépassé. Certaines données peuvent être manquantes. »

Promesses de Phase 1 pouvant le déclencher (toutes dans un `Promise.all`, donc la plus lente gagne) :
`getTanks, getPumps, getNozzles, getTracks, getDrivers, getProducts, getBrands, getPompistes,
getBrigadeChefs, getGerants, getMagasinWorkers, getClients, getSuppliers, getSettings,
chef_pompiste_assignments, getPermissionTemplates`. Les plus à risque quand les données grossissent :
`getClients` et `getSuppliers` passent par `dbSelectAll` (lecture paginée **complète**). Sur un lien
lent, l'addition de ces ~16 allers-retours peut franchir 15 s → le message apparaît « parfois ».

### Ce qui a été changé pour le message
- Le toast générique **ne prétend plus** que les données sont complètes : il devient un
  avertissement clair (« connexion lente, le chargement continue en arrière-plan, les écrans
  signalent ce qui manque »).
- La Phase 1 marque un statut `__startup = slow|ready|error` ; chaque table de Phase 2 marque
  `ready` ou `error`. Une **lecture en échec n'est plus présentée comme une liste vide réussie** :
  son statut `error` est remonté à l'écran (bannière listant les tables en échec, avec « Réessayer »).

### Instrumentation (`src/lib/perf.ts`) — **désactivée par défaut**
Mesure, sans aucune donnée sensible :
- début/fin, durée, méthode (GET/POST/PATCH/DELETE), statut HTTP de chaque requête Supabase ;
- table/RPC visée ; filtre/ordre/limite **avec valeurs rédigées** (`client_id=eq.*` — jamais la
  valeur ; jamais de jeton, jamais de corps) ;
- nombre de lignes (`Content-Range`) et octets transférés (`Content-Length`) ;
- temps **clic sidebar → premier rendu** de l'écran (marqueur dans la frontière `<Suspense>`) ;
- reprises/erreurs/timeout (chaque tentative est journalisée séparément).

**Activer** : ouvrir l'app avec `?perf=1` (persiste), ou `localStorage['altech.perf']='1'`, ou
`window.__altechPerf.enable()` puis recharger.
**Lire** : `window.__altechPerf.summary()` (agrégé par table), `.table()`, `.nav()` (par écran),
`.export()` (JSON à copier), `.clear()`, `.disable()`.
Aucun surcoût quand c'est éteint (tout est gardé par `perfEnabled()`).

---

## 4. Mesures avant/après (Étape 4)

### Banc reproductible : `npx tsx scripts/perf-bench.ts`
Fixtures **synthétiques** (aucune donnée client). Résultats obtenus dans cette session :

**Coût CPU côté navigateur** de la fusion parent/enfant (groupBy + map) que fait l'hydratation :

| Volume | fusion ventes+articles | fusion clients+mouvements |
|---|---|---|
| 1 000 ventes | ~1,2 ms | ~0,4 ms |
| 5 000 ventes | ~3,6 ms | ~1,4 ms |
| 20 000 ventes | ~14,6 ms | ~4,0 ms |
| 50 000 ventes | ~52,9 ms | ~25,0 ms |

→ Le coût CPU reste modéré : **le goulot est le réseau (volume JSON) et le nombre de requêtes**, pas
le calcul. (Le calcul devient sensible seulement à très gros volume et par re-rendus répétés.)

**Volume JSON estimé** (octets/ligne × lignes), ex. à 5 000 lignes : `brigade_accounting` ≈ 4,3 Mo,
`treasury_transactions` ≈ 1,2 Mo, `fuel_sales` ≈ 1,0 Mo. À 20 000 lignes, `brigade_accounting`
≈ 17 Mo. C'est ce qui part sur le réseau au login.

**Allers-retours au login** (comptés dans le code) : **~16 (Phase 1, bloquant) + ~32 (Phase 2)**.

### Mesure « avant/après » sur le vrai déploiement (à faire par l'exploitant)
Le code n'ayant **volontairement pas** changé le VOLUME chargé (pour ne pas casser les soldes/le
miroir), le banc ne revendique pas de gain réseau. Le vrai avant/après se relève ainsi, en séparant
affichage du shell / premier affichage utile / données complètes :

1. Ouvrir la préversion avec `?perf=1`, se connecter, aller au Dashboard → `window.__altechPerf.table()`.
2. Noter : nb requêtes (foreground = celles de Phase 1 ; background = Phase 2), tables appelées,
   lignes/octets par table, p50/p95 des durées, `window.__altechPerf.nav()` par écran.
3. Cliquer chaque entrée de la sidebar et chaque module → relever `nav()`.
4. Répéter plusieurs fois (médiane + p95). Exporter (`.export()`).
Après avoir appliqué les index (section 7) puis, plus tard, les optimisations serveur (section 5),
refaire exactement le même parcours, mêmes conditions, et comparer.

---

## 5. Améliorations côté application (Étape 5)

### Fait dans cette session (sûr, additif, sans changer données/calculs/droits)
- **État de chargement indépendant par ressource** (`hydration` dans l'état ; action réductrice
  `SET_HYDRATION_STATUS` qui *fusionne* sans écraser) + **bannière d'erreur par table** avec libellés
  FR et « Réessayer ». Une erreur de lecture est désormais **identifiable par écran/table**.
- **Fin de l'anti-motif « erreur = liste vide réussie »** dans la Phase 2 : `safeQ` enregistre
  `error` au lieu d'avaler l'échec en silence (la donnée reste `[]` pour que le reste s'affiche, mais
  le statut dit que ce vide est une ERREUR).
- **Message de délai honnête** (ne déclare plus les données complètes ; renvoie à l'état par table).
- **Instrumentation** pour piloter les décisions par la mesure (section 3).

### NON fait volontairement (dangereux sans base réelle + analyse de tous les consommateurs)
Ces pistes réduisent réellement le volume mais touchent aux soldes, rapports, impressions, exports
et au miroir d'écriture. Elles exigent un accès à la base, une migration et des tests de bout en
bout. **Plan précis, par ordre de gain/sûreté :**

1. **Agrégats serveur pour le Dashboard et les soldes** (RPC/vues `SECURITY INVOKER`, RLS
   respectée) : renvoyer directement solde de caisse, solde par compte bancaire, dette par
   client/fournisseur, recette du jour/7 jours — au lieu de télécharger les grands livres. Analyser
   AVANT : caisses, règlements, trésorerie, rapports, impressions, exports, widgets, filtres.
   *Stratégie de complétude : le solde reste EXACT (calculé côté serveur sur toutes les lignes),
   seul le transfert des lignes brutes disparaît.*
2. **Pagination/fenêtre temporelle explicite par écran** (filtres serveur + sélection de colonnes)
   pour les historiques (ventes, trésorerie, mouvements client, comptabilités). La liste affichée
   est paginée ; **le miroir d'écriture ne doit jamais supprimer les lignes hors fenêtre** → les
   écritures restent par ligne (`id`), jamais « remplacer la table ». Documenter que toute somme
   affichée vient de l'agrégat serveur (point 1), pas de la page courante.
3. **Sortir l'historique des ventes du blob `biz_store`** vers une table paginée (le code le prévoit
   déjà pour les produits via `biz_products`, migration 2026-08-15 ; « les ventes suivront le même
   chemin »). Supprime le plus gros transfert unique de la Cafétéria/Lavage.
4. **Sync incrémentale** au lieu de « retélécharger la table entière » en temps réel/polling :
   appliquer la ligne de l'événement (insert/update/delete) au lieu d'un `dbSelectAll` complet.
   *Prouver qu'aucune ligne n'est perdue et que les soldes restent exacts.*
5. **Alléger la Phase 1** au strict nécessaire du shell/Dashboard et différer le reste par écran ;
   **annuler les requêtes périmées** au changement d'écran/filtre (AbortController) ; **éviter les
   re-rendus et re-tris** (mémoïsation) sur les grands tableaux ; **rendre à la demande** les modules
   lourds (graphes, PDF/impression) — déjà partiellement en place (lazy routes).
Maintenir dans tous les cas : navigation clavier, FR/AR, RTL, mobile.

---

## 6. Analyse du schéma et du SQL (Étape 6)

- `supabase/setup.sql` + migrations analysés. **67 index déjà définis** — notamment
  `treasury_transactions(date, account_from, account_to, ref, kind, part)`,
  `client_transactions(client_id, created_at)`, `expenses(date, part, account_id, brigade_id)`,
  `purchase_payments(purchase_id, account_id, date)`, `brigade_accounting_justifications(accounting_id)`,
  `tpe_transactions(date, accounting_id, …)`, `brigade_pompiste_assignments(brigade_id)`, etc.
- **Tables lourdes SANS index explicite** (hors PK) confirmées par recherche : `fuel_sales`,
  `shop_sales`, `shop_sale_items`, `fuel_invoices`, `fuel_receipts`, `fuel_invoice_bls`,
  `fuel_receipt_invoices`, `delivery_note_items`, `purchase_items`, `worker_absences`,
  `worker_payment_records`, `worker_acomptes` (seulement `date`), `client_appointments`,
  `supplier_appointments`, `supplier_debt_payments`, `pompiste_decalage_history`, `brigade_accounting`.
- **Le schéma initial n'est pas forcément le schéma installé** → le diagnostic (fichier A) inspecte
  l'instance réelle (tables, colonnes, index existants, RLS, FK, tailles) et **liste précisément les
  colonnes candidates sans index**, avant toute création. Aucune clé service_role n'est demandée ni
  exposée.

---

## 7. SQL fourni, sans modifier les données (Étape 7)

Deux fichiers séparés, abondamment commentés :

### A. `supabase/diagnostics/performance_read_only.sql` — **strictement lecture seule**
Sections : (1) taille + lignes estimées par table ; (2) index existants (pour ne jamais doublonner) ;
(3) index inutilisés (`idx_scan=0`, à surveiller) ; (4) contraintes/FK ; (5) politiques RLS + RLS
active ; (6) **colonnes candidates à un index qui n'en ont pas** (croise les (table, colonne) que le
code filtre/trie avec les index réels, et marque `MANQUANT / déjà indexé / colonne absente / table
absente`) ; (7) gabarits `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` **commentés**.
Aucun `INSERT/UPDATE/DELETE/DDL`. Les `EXPLAIN` sont des SELECT (n'écrivent rien).

### B. `supabase/optimizations/performance_indexes.sql` — index **non destructifs**
- Section A : **pré-vérification en lecture seule** (quels index sont réellement nécessaires).
- Section B : `CREATE INDEX CONCURRENTLY IF NOT EXISTS …` (recommandé sur grosses tables, **ne
  bloque pas les écritures**). ⚠ **ne tourne pas dans une transaction** → dans Supabase SQL Editor,
  exécuter ces lignes **une par une** (ne pas cocher « run in transaction »). `IF NOT EXISTS` =
  idempotent ; n'exécuter que les lignes « MANQUANT » de la section A.
- Section C : **variante entièrement gardée, non concurrente** (bloc `DO` qui vérifie table ET
  colonne via `to_regclass`/`information_schema`, et isole chaque index par `EXCEPTION WHEN others`),
  pour petite base/maintenance — même motif que la migration `2026-11-19` du dépôt.
- Section D : validation `EXPLAIN` (avant/après). Section E : rollback `DROP INDEX CONCURRENTLY IF
  EXISTS` **des seuls index ajoutés**.
- Contenu : **aucun** `DELETE/TRUNCATE/UPDATE/INSERT/DROP` de données, **aucun** backfill, **aucune**
  modification de RLS.

**Honnêteté exigée :** créer un index **modifie les métadonnées et ajoute un objet sur disque**, et
consomme CPU/I-O/espace pendant la construction ; chaque écriture future met aussi l'index à jour.
Les **lignes de données ne changent pas**. On n'affirme donc pas « ça ne touche pas la base » : ça
n'altère aucune donnée, mais ça ajoute des objets et coûte des ressources le temps de bâtir.
**Un index ne réduit pas le volume JSON téléchargé** — seuls sélection de colonnes, pagination et
agrégats serveur le font (section 5). Les index aident : tri des grosses tables, lectures par entité
(ouverture de détail), relecture temps réel d'une entité.

**Validation SQL :** revue syntaxique ; motifs identiques à une migration déjà en production dans ce
dépôt. **Non exécuté sur la base réelle** (pas d'accès en session). Étapes d'exécution ci-dessous.

---

## 8. Tests de non-régression (Étape 8)

Ajoutés (style du dépôt, `npx tsx`) :
- `src/lib/hydrationSummary.test.ts` (16 cas) — **invariant central** : une lecture en échec est
  toujours remontée et jamais présentée comme une liste vide réussie ; `ready` vide ≠ erreur ;
  `slow` (timeout) ≠ complet ≠ erreur critique ; tri/libellés ; robustesse entrée vide.
- `src/lib/perf.test.ts` (15 cas) — l'instrumentation **ne fuit aucune donnée** (valeurs de filtre
  et UUID rédigés, select/order/limit conservés), classe table/RPC/storage/auth, et est **inerte par
  défaut** (aucune mesure, `recordQuery` sans effet).

Logique pure isolée dans `src/lib/hydrationSummary.ts` pour être testable hors React (comme
`refetchKeepsSubRecords.test.ts` qui lit le source plutôt que d'importer `AppContext`).

Invariants **déjà couverts** par le dépôt et re-vérifiés verts : `refetchKeepsSubRecords.test.ts`
(un rafraîchissement ne perd pas les sous-enregistrements — le miroir d'écriture), `writeRetry.test.ts`
(rejouabilité des écritures sans doublon), `dedupeLedger.test.ts`, etc.

Non ajoutés faute de base/navigateur : tests e2e de navigation réelle, pagination réelle,
exactitude des soldes contre fixtures complètes en base, FR/AR/RTL/mobile au runtime. Ces tests
exigeraient une base de test — voir validation manuelle (section 9). **Aucun test ne requiert de
donnée de production, et aucun test unitaire n'est présenté comme preuve de performance utilisateur.**

---

## 9. Vérifications (Étape 9)

Lancé dans cette session :
- `npx tsc --noEmit` (= `npm run lint`) : **0 erreur** (les erreurs initiales venaient de
  `node_modules` non installé ; après `npm install`, build propre).
- `npx vite build` : **succès** (il a fallu contourner le bug npm des dépendances natives optionnelles
  par une réinstallation propre ; `package-lock.json` d'origine restauré, non modifié).
- Tous les `*.test.ts` via `tsx` : **28 verts, 0 échec**, dont les 2 nouvelles suites (31 cas).
- `npx tsx scripts/perf-bench.ts` : s'exécute, chiffres en section 4.
- SQL : revue syntaxique ; tentative d'exécution sur un Postgres jetable local **bloquée par la
  politique de la session** (création d'utilisateur non-root refusée) → non exécuté. À lancer sur
  Supabase (étapes ci-dessous).

### Fichiers modifiés / ajoutés
Modifiés : `src/App.tsx`, `src/lib/supabase.ts`, `src/store/AppContext.tsx`.
Ajoutés : `src/lib/perf.ts`, `src/lib/perf.test.ts`, `src/lib/hydrationSummary.ts`,
`src/lib/hydrationSummary.test.ts`, `scripts/perf-bench.ts`,
`supabase/diagnostics/performance_read_only.sql`, `supabase/optimizations/performance_indexes.sql`,
`PERFORMANCE-REPORT.md`.

### Preuve que les lignes métier ne sont pas modifiées
- Aucun changement n'altère **ce qui est lu ou écrit** : `safeQ` renvoie toujours `[]` en cas
  d'échec (flux de données identique) ; il ajoute seulement un *statut*. Les écritures (par ligne,
  `id`) sont inchangées, les règles de retry inchangées, les calculs inchangés.
- `src/lib/supabase.ts` : seuls des appels `recordQuery(...)` gardés par `perfEnabled()` (inertes par
  défaut) ont été ajoutés autour du `fetch` ; aucune logique réseau/écriture modifiée.
- `src/App.tsx` : marqueurs de navigation inertes + bannière d'erreur (n'apparaît que sur une vraie
  erreur) ; aucune route, aucun droit changé.
- Le SQL fourni ne contient aucun `INSERT/UPDATE/DELETE/TRUNCATE/DROP`/backfill/RLS.

### Causes confirmées vs seulement possibles
- **Confirmées (code)** : magasin global « toute la base en mémoire » ; soldes/Dashboard = sommes de
  grands livres complets ; temps réel/polling qui retélécharge des tables entières ; Phase 1 non
  bornée (clients/suppliers en `dbSelectAll`) pouvant dépasser 15 s ; grosses tables sans index ;
  anti-motif « erreur = liste vide » dans la Phase 2 ; message de délai générique.
- **Possibles (à confirmer sur la base réelle)** : policies RLS coûteuses par requête ; index absents
  réellement manquants sur l'instance (vs setup.sql) ; `count:'exact'` de `dbSelectAll` lent sur très
  grosses tables ; N+1 sur les écrans qui lisent en direct ; 429/5xx sur réseau partagé de station.
  → Le fichier de diagnostic (A) et l'instrumentation tranchent chacun de ces points.

### Étapes exactes — exécuter le SQL et valider sur une préversion
1. **Diagnostic (sans risque)** : Supabase → SQL Editor → coller `performance_read_only.sql` → Run.
   Lire la section 1 (tables lourdes) et la section 6 (colonnes « MANQUANT → index justifié »).
2. **Index** : ouvrir `performance_indexes.sql`, lancer la **Section A** (pré-vérif). Pour chaque
   ligne « MANQUANT → créer » sur une table volumineuse : exécuter la ligne `CREATE INDEX
   CONCURRENTLY …` correspondante de la **Section B**, **une par une**, sans transaction. (Petite
   base : lancer la **Section C** d'un bloc.) Valider avec la **Section D** (EXPLAIN avant/après :
   `Seq Scan`→`Index Scan`, ou disparition d'un `Sort`). Rollback éventuel : **Section E**.
3. **Préversion applicative** : déployer la branche sur une préversion Vercel (ne pas toucher à la
   prod). Ouvrir avec `?perf=1`, se connecter, parcourir Dashboard + chaque écran + modules. Vérifier :
   soldes/rapports/impressions/exports **inchangés** ; navigation clavier, FR/AR, RTL, mobile OK ;
   couper le réseau pour voir la **bannière d'erreur par table** et le bouton « Réessayer » ; relever
   `window.__altechPerf.summary()` / `.nav()` pour le « avant ». Appliquer les index, recharger,
   relever le « après » dans les mêmes conditions.
4. **Ne rien pousser en production ni déployer** sans votre instruction explicite.

---

### Annexe — comment activer/lire l'instrumentation
```
?perf=1 dans l'URL              # active (persiste) puis recharger
window.__altechPerf.enable()    # idem via console
window.__altechPerf.summary()   # agrégé par table : count, p50, p95, lignes, Ko, erreurs
window.__altechPerf.nav()       # temps clic→rendu par écran
window.__altechPerf.export()    # JSON complet à copier
window.__altechPerf.disable()   # couper
```
