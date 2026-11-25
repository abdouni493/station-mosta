-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  OPTIMISATIONS — INDEX NON DESTRUCTIFS                                      ║
-- ║  station-mosta / Supabase (schéma public)                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- CE QUE FAIT CE FICHIER
--   Il AJOUTE des index sur les colonnes que le code filtre ou trie et qui n'en
--   ont pas (voir la section 6 de performance_read_only.sql). Rien d'autre.
--
-- CE QU'IL NE FAIT PAS — JAMAIS
--   • Aucun INSERT / UPDATE / DELETE / TRUNCATE : AUCUNE ligne métier n'est
--     touchée, ni créée, ni déplacée, ni réécrite.
--   • Aucun DROP de table ni de colonne, aucun backfill, aucune migration de
--     données, aucune modification de RLS.
--
-- HONNÊTETÉ SUR CE QUE « NE TOUCHE PAS LA BASE » VEUT DIRE
--   Un index N'EST PAS gratuit : créer un index MODIFIE les métadonnées du
--   catalogue et ÉCRIT un nouvel objet sur le disque. Pendant la construction il
--   consomme du CPU, des I/O et de l'espace disque, et chaque écriture future sur
--   la table devra aussi mettre l'index à jour (coût d'écriture légèrement accru).
--   Les LIGNES de données, elles, ne changent pas. On ne prétend donc pas que ce
--   script « ne touche à rien » : il n'altère aucune donnée, mais il ajoute des
--   objets et consomme des ressources le temps de les bâtir.
--
-- CE QU'UN INDEX NE RÉGLE PAS
--   Un index accélère un filtre/tri côté serveur. Il NE RÉDUIT PAS le VOLUME de
--   JSON téléchargé au login : l'hydratation lit des tables ENTIÈRES. Faire
--   baisser ce volume demande, côté application, la sélection de colonnes, la
--   pagination par fenêtre et des AGRÉGATS côté serveur (voir le rapport). Les
--   index aident surtout : (a) le tri des grosses tables (évite un tri complet),
--   (b) les lectures PAR ENTITÉ à l'ouverture d'un détail/modal, (c) le temps
--   réel qui relit une entité précise.
--
-- ─────────────────────────────────────────────────────────────────────────────
--  ORDRE RECOMMANDÉ
--   0) Lancer d'abord performance_read_only.sql (sections 1 et 6).
--   1) Lancer la SECTION A ci-dessous (pré-vérification, lecture seule).
--   2) Pour chaque index marqué « MANQUANT » sur une table volumineuse :
--      créer l'index via la SECTION B (CONCURRENTLY, zéro blocage d'écriture)
--      OU, sur une petite base / fenêtre de maintenance, via la SECTION C
--      (bloc gardé, non concurrent).
--   3) Valider avec la SECTION D (EXPLAIN avant/après).
--   4) Annulation éventuelle : SECTION E.
-- ═════════════════════════════════════════════════════════════════════════════


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ SECTION A — PRÉ-VÉRIFICATION (LECTURE SEULE)                                │
-- │ Liste précisément quels index de ce fichier sont nécessaires (table         │
-- │ présente, colonne présente, pas déjà indexée). N'exécuter ensuite QUE       │
-- │ les CREATE correspondants.                                                  │
-- ╰───────────────────────────────────────────────────────────────────────────╯
WITH wanted(idx_name, table_name, column_name) AS (
  VALUES
    ('idx_fuel_sales_created_at',             'fuel_sales',               'created_at'),
    ('idx_shop_sales_created_at',             'shop_sales',               'created_at'),
    ('idx_shop_sale_items_sale_id',           'shop_sale_items',          'sale_id'),
    ('idx_brigade_accounting_created_at',     'brigade_accounting',       'created_at'),
    ('idx_fuel_invoices_created_at',          'fuel_invoices',            'created_at'),
    ('idx_fuel_receipts_created_at',          'fuel_receipts',            'created_at'),
    ('idx_fuel_invoice_bls_invoice_id',       'fuel_invoice_bls',         'invoice_id'),
    ('idx_fuel_receipt_invoices_receipt_id',  'fuel_receipt_invoices',    'receipt_id'),
    ('idx_dn_items_note_id',                  'delivery_note_items',      'delivery_note_id'),
    ('idx_dn_payments_note_id',               'delivery_note_payments',   'delivery_note_id'),
    ('idx_dn_photos_note_id',                 'delivery_note_photos',     'delivery_note_id'),
    ('idx_purchase_items_purchase_id',        'purchase_items',           'purchase_id'),
    ('idx_client_appointments_client_id',     'client_appointments',      'client_id'),
    ('idx_supplier_appointments_supplier_id', 'supplier_appointments',    'supplier_id'),
    ('idx_supplier_debt_payments_supplier_id','supplier_debt_payments',   'supplier_id'),
    ('idx_decalage_history_pompiste_id',      'pompiste_decalage_history','pompiste_id'),
    ('idx_worker_acomptes_worker_id',         'worker_acomptes',          'worker_id'),
    ('idx_worker_absences_worker_id',         'worker_absences',          'worker_id'),
    ('idx_worker_payment_records_worker_id',  'worker_payment_records',   'worker_id')
),
indexed_first_col AS (
  SELECT t.relname AS table_name, a.attname AS column_name
  FROM pg_index ix
  JOIN pg_class t     ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
  WHERE n.nspname = 'public'
)
SELECT
  w.idx_name, w.table_name, w.column_name,
  CASE
    WHEN to_regclass('public.' || w.table_name) IS NULL          THEN 'TABLE ABSENTE → ne pas créer'
    WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                     WHERE ic.table_schema='public' AND ic.table_name=w.table_name
                       AND ic.column_name=w.column_name)          THEN 'COLONNE ABSENTE → ne pas créer'
    WHEN EXISTS (SELECT 1 FROM indexed_first_col f
                 WHERE f.table_name=w.table_name AND f.column_name=w.column_name)
                                                                  THEN 'DÉJÀ INDEXÉ → ne pas créer'
    ELSE 'MANQUANT → créer'
  END AS action
FROM wanted w
ORDER BY action, w.table_name;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ SECTION B — CRÉATION SANS BLOCAGE (recommandée sur les grosses tables)      │
-- │                                                                             │
-- │ ⚠ CREATE INDEX CONCURRENTLY NE PEUT PAS tourner dans une transaction.       │
-- │   Dans Supabase SQL Editor : exécuter ces lignes UNE PAR UNE (sélectionner  │
-- │   une seule instruction puis Run), et NE PAS cocher « run in transaction ». │
-- │   `IF NOT EXISTS` rend chaque ligne idempotente (rejouable sans risque).    │
-- │   N'exécuter QUE celles marquées « MANQUANT → créer » en section A.         │
-- │                                                                             │
-- │ Si une création CONCURRENTLY échoue, elle peut laisser un index INVALIDE :  │
-- │   le supprimer (SECTION E) puis relancer. CONCURRENTLY prend plus de temps   │
-- │   mais ne bloque pas les écritures pendant la construction.                 │
-- ╰───────────────────────────────────────────────────────────────────────────╯

-- Grosses tables triées à l'hydratation (le tri profite de l'index) :
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_sales_created_at         ON public.fuel_sales (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_sales_created_at         ON public.shop_sales (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brigade_accounting_created_at ON public.brigade_accounting (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_invoices_created_at      ON public.fuel_invoices (created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_receipts_created_at      ON public.fuel_receipts (created_at DESC);

-- Lectures PAR ENTITÉ (ouverture d'un détail, temps réel) — le plus gros gain :
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_sale_items_sale_id           ON public.shop_sale_items (sale_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_invoice_bls_invoice_id       ON public.fuel_invoice_bls (invoice_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fuel_receipt_invoices_receipt_id  ON public.fuel_receipt_invoices (receipt_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dn_items_note_id                  ON public.delivery_note_items (delivery_note_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dn_payments_note_id               ON public.delivery_note_payments (delivery_note_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dn_photos_note_id                 ON public.delivery_note_photos (delivery_note_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_items_purchase_id        ON public.purchase_items (purchase_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_client_appointments_client_id     ON public.client_appointments (client_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_appointments_supplier_id ON public.supplier_appointments (supplier_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_debt_payments_supplier_id ON public.supplier_debt_payments (supplier_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_decalage_history_pompiste_id      ON public.pompiste_decalage_history (pompiste_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_worker_acomptes_worker_id         ON public.worker_acomptes (worker_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_worker_absences_worker_id         ON public.worker_absences (worker_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_worker_payment_records_worker_id  ON public.worker_payment_records (worker_id);

-- Optionnel — uniquement si `clients` est volumineuse (cf. section 1) et porte
-- une colonne created_at (cf. section 6) :
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_created_at ON public.clients (created_at DESC);


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ SECTION C — VARIANTE ENTIÈREMENT GARDÉE (NON concurrente)                   │
-- │                                                                             │
-- │ À utiliser sur une PETITE base ou en fenêtre de maintenance : ce bloc       │
-- │ vérifie l'existence de chaque table ET colonne avant de créer l'index, et   │
-- │ n'échoue jamais globalement (chaque index est isolé). Il n'utilise PAS      │
-- │ CONCURRENTLY, donc il pose un verrou bref en écriture le temps de bâtir     │
-- │ chaque index — négligeable sur de petites tables, à éviter en pleine        │
-- │ journée sur de grosses tables (préférer la SECTION B).                      │
-- │ (Même motif gardé que la migration 2026-11-19_tank_level_ops_idempotent.)   │
-- ╰───────────────────────────────────────────────────────────────────────────╯
DO $$
DECLARE
  r RECORD;
  has_col BOOLEAN;
  stmt TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('idx_fuel_sales_created_at',             'fuel_sales',               'created_at DESC', 'created_at'),
      ('idx_shop_sales_created_at',             'shop_sales',               'created_at DESC', 'created_at'),
      ('idx_shop_sale_items_sale_id',           'shop_sale_items',          'sale_id',         'sale_id'),
      ('idx_brigade_accounting_created_at',     'brigade_accounting',       'created_at DESC', 'created_at'),
      ('idx_fuel_invoices_created_at',          'fuel_invoices',            'created_at DESC', 'created_at'),
      ('idx_fuel_receipts_created_at',          'fuel_receipts',            'created_at DESC', 'created_at'),
      ('idx_fuel_invoice_bls_invoice_id',       'fuel_invoice_bls',         'invoice_id',      'invoice_id'),
      ('idx_fuel_receipt_invoices_receipt_id',  'fuel_receipt_invoices',    'receipt_id',      'receipt_id'),
      ('idx_dn_items_note_id',                  'delivery_note_items',      'delivery_note_id','delivery_note_id'),
      ('idx_dn_payments_note_id',               'delivery_note_payments',   'delivery_note_id','delivery_note_id'),
      ('idx_dn_photos_note_id',                 'delivery_note_photos',     'delivery_note_id','delivery_note_id'),
      ('idx_purchase_items_purchase_id',        'purchase_items',           'purchase_id',     'purchase_id'),
      ('idx_client_appointments_client_id',     'client_appointments',      'client_id',       'client_id'),
      ('idx_supplier_appointments_supplier_id', 'supplier_appointments',    'supplier_id',     'supplier_id'),
      ('idx_supplier_debt_payments_supplier_id','supplier_debt_payments',   'supplier_id',     'supplier_id'),
      ('idx_decalage_history_pompiste_id',      'pompiste_decalage_history','pompiste_id',     'pompiste_id'),
      ('idx_worker_acomptes_worker_id',         'worker_acomptes',          'worker_id',       'worker_id'),
      ('idx_worker_absences_worker_id',         'worker_absences',          'worker_id',       'worker_id'),
      ('idx_worker_payment_records_worker_id',  'worker_payment_records',   'worker_id',       'worker_id')
    ) AS t(idx_name, table_name, index_expr, check_col)
  LOOP
    -- Table absente → on passe (aucune erreur).
    IF to_regclass('public.' || r.table_name) IS NULL THEN
      RAISE NOTICE 'Table % absente — index % ignoré', r.table_name, r.idx_name;
      CONTINUE;
    END IF;
    -- Colonne absente → on passe.
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=r.table_name AND column_name=r.check_col
    ) INTO has_col;
    IF NOT has_col THEN
      RAISE NOTICE 'Colonne %.% absente — index % ignoré', r.table_name, r.check_col, r.idx_name;
      CONTINUE;
    END IF;
    -- Création idempotente et isolée (une erreur n'arrête pas les autres).
    stmt := format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)', r.idx_name, r.table_name, r.index_expr);
    BEGIN
      EXECUTE stmt;
      RAISE NOTICE 'OK : %', stmt;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Index % non créé (%) — poursuite', r.idx_name, SQLERRM;
    END;
  END LOOP;
END $$;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ SECTION D — VALIDATION (EXPLAIN avant / après)                             │
-- │ Décommenter, remplacer les paramètres, lancer AVANT puis APRÈS création.   │
-- │ On doit passer d'un « Seq Scan » à un « Index Scan » (lectures par entité) │
-- │ ou voir disparaître un « Sort » coûteux (grosses tables triées).           │
-- ╰───────────────────────────────────────────────────────────────────────────╯
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM public.purchase_items WHERE purchase_id = '<un_purchase_id>';
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM public.fuel_sales ORDER BY created_at DESC LIMIT 1000;


-- ╭───────────────────────────────────────────────────────────────────────────╮
-- │ SECTION E — ANNULATION (uniquement les index AJOUTÉS ci-dessus)            │
-- │ DROP INDEX CONCURRENTLY ne tourne pas en transaction : une ligne à la fois.│
-- │ `IF EXISTS` rend l'annulation sûre. Ne supprime QUE des index de ce        │
-- │ fichier — jamais un index préexistant, jamais une clé primaire/unique.     │
-- ╰───────────────────────────────────────────────────────────────────────────╯
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_fuel_sales_created_at;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_shop_sales_created_at;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_brigade_accounting_created_at;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_fuel_invoices_created_at;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_fuel_receipts_created_at;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_shop_sale_items_sale_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_fuel_invoice_bls_invoice_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_fuel_receipt_invoices_receipt_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_dn_items_note_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_dn_payments_note_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_dn_photos_note_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_purchase_items_purchase_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_client_appointments_client_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_supplier_appointments_supplier_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_supplier_debt_payments_supplier_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_decalage_history_pompiste_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_worker_acomptes_worker_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_worker_absences_worker_id;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_worker_payment_records_worker_id;

-- Fin — aucune donnée métier n'a été lue, modifiée ou supprimée.
