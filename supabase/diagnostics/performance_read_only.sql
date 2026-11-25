-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DIAGNOSTIC DE PERFORMANCE — STRICTEMENT EN LECTURE SEULE                   ║
-- ║  station-mosta / Supabase (schéma public)                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- OBJET
--   Photographier l'état RÉEL de la base pour décider des optimisations, SANS
--   rien modifier. Aucune ligne de données n'est lue en clair, aucune n'est
--   écrite : uniquement les catalogues système (tailles, index, contraintes,
--   politiques RLS) et des plans d'exécution.
--
-- GARANTIES
--   • AUCUN INSERT / UPDATE / DELETE / TRUNCATE / DROP / ALTER / CREATE.
--   • Ne lit pas le contenu métier : seulement des métadonnées et des COMPTES.
--   • Les EXPLAIN de la section 7 sont des SELECT (EXPLAIN ANALYZE exécute la
--     lecture mais n'écrit rien). Ils sont COMMENTÉS : à activer au besoin.
--   • Ne jamais exécuter avec une clé service_role exposée côté navigateur.
--
-- COMMENT L'EXÉCUTER
--   Supabase → SQL Editor → coller → Run. Chaque bloc renvoie un tableau.
--   On peut exécuter les sections indépendamment (chacune est autonome).
-- ─────────────────────────────────────────────────────────────────────────────


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ 1. TAILLE ET NOMBRE DE LIGNES PAR TABLE                                     │
-- │    Repère les tables lourdes : ce sont elles qui gonflent l'hydratation.    │
-- ╰───────────────────────────────────────────────────────────────────────────╯
SELECT
  c.relname                                            AS table_name,
  COALESCE(s.n_live_tup, 0)                            AS lignes_estimees,
  pg_size_pretty(pg_total_relation_size(c.oid))        AS taille_totale,
  pg_size_pretty(pg_table_size(c.oid))                 AS taille_table,
  pg_size_pretty(pg_indexes_size(c.oid))               AS taille_index,
  COALESCE(s.n_dead_tup, 0)                            AS lignes_mortes,
  s.last_autovacuum
FROM pg_class c
JOIN pg_namespace n           ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ 2. INDEX EXISTANTS (pour ne JAMAIS en recréer un doublon)                   │
-- ╰───────────────────────────────────────────────────────────────────────────╯
SELECT
  t.relname       AS table_name,
  i.relname       AS index_name,
  pg_size_pretty(pg_relation_size(i.oid)) AS taille_index,
  ix.indisunique  AS unique,
  ix.indisprimary AS primary_key,
  pg_get_indexdef(i.oid) AS definition
FROM pg_index ix
JOIN pg_class i      ON i.oid = ix.indexrelid
JOIN pg_class t      ON t.oid = ix.indrelid
JOIN pg_namespace n  ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
ORDER BY t.relname, i.relname;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ 3. INDEX INUTILISÉS (candidats à surveiller — ne RIEN supprimer ici)        │
-- │    idx_scan = 0 → l'index coûte en écriture sans servir aucune lecture.     │
-- │    À confirmer sur plusieurs semaines avant toute décision.                 │
-- ╰───────────────────────────────────────────────────────────────────────────╯
SELECT
  relname           AS table_name,
  indexrelname      AS index_name,
  idx_scan          AS nb_utilisations,
  pg_size_pretty(pg_relation_size(indexrelid)) AS taille
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ 4. CLÉS ÉTRANGÈRES ET CONTRAINTES                                           │
-- ╰───────────────────────────────────────────────────────────────────────────╯
SELECT
  con.conname       AS contrainte,
  rel.relname       AS table_name,
  CASE con.contype WHEN 'f' THEN 'FOREIGN KEY'
                   WHEN 'p' THEN 'PRIMARY KEY'
                   WHEN 'u' THEN 'UNIQUE'
                   WHEN 'c' THEN 'CHECK' ELSE con.contype::text END AS type,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel     ON rel.oid = con.conrelid
JOIN pg_namespace n   ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
ORDER BY rel.relname, con.contype;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ 5. POLITIQUES RLS (une policy coûteuse ralentit CHAQUE requête d'une table) │
-- ╰───────────────────────────────────────────────────────────────────────────╯
SELECT
  tablename   AS table_name,
  policyname  AS policy,
  cmd         AS commande,
  roles,
  qual        AS using_expression,
  with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- RLS activée ou non, par table :
SELECT c.relname AS table_name, c.relrowsecurity AS rls_active, c.relforcerowsecurity AS rls_forcee
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ 6. COLONNES CANDIDATES À UN INDEX QUI N'EN ONT PAS                          │
-- │                                                                             │
-- │    Croise les (table, colonne) que le CODE filtre ou trie (lectures de      │
-- │    l'hydratation et des détails) avec les index réellement présents. Toute  │
-- │    ligne « manquant » justifie un index du fichier performance_indexes.sql  │
-- │    — à condition que la table existe et soit volumineuse (cf. section 1).   │
-- ╰───────────────────────────────────────────────────────────────────────────╯
WITH candidates(table_name, column_name, pourquoi) AS (
  VALUES
    ('fuel_sales',              'created_at',        'dbSelectAll ORDER BY created_at (hydratation + temps réel)'),
    ('shop_sales',              'created_at',        'dbSelectAll ORDER BY created_at'),
    ('shop_sale_items',         'sale_id',           'dbSelectAll ORDER BY sale_id + fusion par vente / détail'),
    ('brigade_accounting',      'created_at',        'dbSelectAll ORDER BY created_at'),
    ('fuel_invoices',           'created_at',        'ORDER BY created_at DESC LIMIT 500'),
    ('fuel_receipts',           'created_at',        'ORDER BY created_at DESC LIMIT 500'),
    ('fuel_invoice_bls',        'invoice_id',        'fusion facture→BL'),
    ('fuel_receipt_invoices',   'receipt_id',        'fusion réception→facture'),
    ('delivery_note_items',     'delivery_note_id',  'détail d''un bon + fusion'),
    ('delivery_note_payments',  'delivery_note_id',  'getDeliveryNotePayments(note) + fusion'),
    ('delivery_note_photos',    'delivery_note_id',  'getDeliveryNotePhotos(note) + fusion'),
    ('purchase_items',          'purchase_id',       'getPurchaseItems(achat) + fusion'),
    ('client_appointments',     'client_id',         'getClientAppointments(client) + fusion'),
    ('supplier_appointments',   'supplier_id',       'getSupplierAppointments(fournisseur) + fusion'),
    ('supplier_debt_payments',  'supplier_id',       'getSupplierDebtPayments(fournisseur) + fusion'),
    ('pompiste_decalage_history','pompiste_id',      'getDecalageHistory(pompiste) + fusion'),
    ('worker_acomptes',         'worker_id',         'getWorkerAcomptes(worker) — ouverture fiche employé'),
    ('worker_absences',         'worker_id',         'getWorkerAbsences(worker)'),
    ('worker_payment_records',  'worker_id',         'getWorkerPaymentRecords(worker)'),
    ('clients',                 'created_at',        'dbSelectAll ORDER BY created_at (si table volumineuse)')
),
-- Première colonne-clé de chaque index btree existant.
indexed_first_col AS (
  SELECT t.relname AS table_name, a.attname AS column_name
  FROM pg_index ix
  JOIN pg_class t     ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
  WHERE n.nspname = 'public'
)
SELECT
  c.table_name,
  c.column_name,
  c.pourquoi,
  CASE
    WHEN to_regclass('public.' || c.table_name) IS NULL           THEN 'TABLE ABSENTE (ignorer)'
    WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public' AND ic.table_name = c.table_name
        AND ic.column_name = c.column_name)                        THEN 'COLONNE ABSENTE (ignorer)'
    WHEN EXISTS (
      SELECT 1 FROM indexed_first_col f
      WHERE f.table_name = c.table_name AND f.column_name = c.column_name)
                                                                   THEN 'déjà indexé (ne rien faire)'
    ELSE 'MANQUANT → index justifié'
  END AS etat
FROM candidates c
ORDER BY etat DESC, c.table_name;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ 7. PLANS D'EXÉCUTION (OPTIONNELS — décommenter pour exécuter)               │
-- │                                                                             │
-- │    EXPLAIN (ANALYZE) exécute réellement le SELECT (aucune écriture) et      │
-- │    mesure le temps + les buffers. Remplacer les paramètres '<...>' par des  │
-- │    valeurs réalistes tirées de la base. À lancer AVANT puis APRÈS la        │
-- │    création des index pour prouver le gain (cf. performance_indexes.sql).   │
-- ╰───────────────────────────────────────────────────────────────────────────╯

-- Grosse table triée (hydratation) — gagne un tri si created_at est indexé :
-- EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
--   SELECT * FROM public.fuel_sales ORDER BY created_at DESC LIMIT 1000;

-- Lecture par entité (ouverture d'un détail) — gagne un scan séquentiel :
-- EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
--   SELECT * FROM public.purchase_items WHERE purchase_id = '<un_purchase_id>';

-- EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
--   SELECT * FROM public.client_appointments WHERE client_id = '<un_client_id>';

-- EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
--   SELECT * FROM public.pompiste_decalage_history WHERE pompiste_id = '<un_pompiste_id>';

-- Fin du diagnostic — rien n'a été modifié.
