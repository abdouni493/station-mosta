-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DIAGNOSTIC DE PERFORMANCE — STRICTEMENT EN LECTURE SEULE                   ║
-- ║  station-mosta / Supabase (schéma public)                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- OBJET
--   Photographier l'état RÉEL de la base SANS rien modifier. Uniquement les
--   catalogues système (tailles, index, contraintes, RLS) : aucune ligne métier
--   n'est lue en clair, aucune n'est écrite.
--
-- ⚠ EN CAS DE « Connection terminated due to connection timeout »
--   La base répond lentement (elle est chargée — c'est le problème de fond).
--   NE PAS tout lancer d'un coup : exécuter CHAQUE requête « ▶ » séparément
--   (sélectionner le bloc, puis Run). Si une requête échoue encore, relancer la
--   REQUÊTE 0 (réveille la connexion) puis réessayer, de préférence à une heure
--   creuse. Chaque requête ci-dessous est volontairement légère (catalogue seul,
--   pas d'information_schema qui est lent sur une base chargée).
--
-- GARANTIES : AUCUN INSERT / UPDATE / DELETE / TRUNCATE / DROP / ALTER / CREATE.
-- ─────────────────────────────────────────────────────────────────────────────


-- ▶ REQUÊTE 0 — connectivité (triviale ; réveille la connexion). Lancer seule.
select version();


-- ▶ REQUÊTE 1 — TAILLE + lignes estimées par table (la plus utile). Lancer seule.
--   Repère les tables lourdes : ce sont elles qui gonflent l'hydratation.
set statement_timeout = '120s';
select
  c.relname                                     as table_name,
  coalesce(s.n_live_tup, 0)                     as lignes_estimees,
  pg_size_pretty(pg_total_relation_size(c.oid)) as taille_totale,
  pg_size_pretty(pg_table_size(c.oid))          as taille_table,
  pg_size_pretty(pg_indexes_size(c.oid))        as taille_index,
  coalesce(s.n_dead_tup, 0)                      as lignes_mortes
from pg_class c
join pg_namespace n              on n.oid = c.relnamespace
left join pg_stat_user_tables s  on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 80;


-- ▶ REQUÊTE 2 — INDEX EXISTANTS (pour ne JAMAIS recréer un doublon). Lancer seule.
set statement_timeout = '120s';
select
  t.relname       as table_name,
  i.relname       as index_name,
  pg_size_pretty(pg_relation_size(i.oid)) as taille_index,
  ix.indisunique  as unique,
  ix.indisprimary as primary_key,
  pg_get_indexdef(i.oid) as definition
from pg_index ix
join pg_class i      on i.oid = ix.indexrelid
join pg_class t      on t.oid = ix.indrelid
join pg_namespace n  on n.oid = t.relnamespace
where n.nspname = 'public'
order by t.relname, i.relname;


-- ▶ REQUÊTE 3 — COLONNES CANDIDATES À UN INDEX QUI N'EN ONT PAS. Lancer seule.
--   Croise les (table, colonne) que le CODE filtre/trie avec les index réels.
--   Toute ligne « MANQUANT » justifie un index (fichier performance_indexes.sql),
--   à condition que la table soit volumineuse (cf. REQUÊTE 1).
--   N'utilise QUE pg_catalog (rapide) — pas d'information_schema.
set statement_timeout = '120s';
with candidates(table_name, column_name, pourquoi) as (
  values
    ('fuel_sales',              'created_at',        'dbSelectAll ORDER BY created_at (hydratation + temps réel)'),
    ('shop_sales',              'created_at',        'dbSelectAll ORDER BY created_at'),
    ('shop_sale_items',         'sale_id',           'ORDER BY sale_id + fusion par vente / détail'),
    ('brigade_accounting',      'created_at',        'dbSelectAll ORDER BY created_at'),
    ('fuel_invoices',           'created_at',        'ORDER BY created_at DESC LIMIT 500'),
    ('fuel_receipts',           'created_at',        'ORDER BY created_at DESC LIMIT 500'),
    ('fuel_invoice_bls',        'invoice_id',        'fusion facture->BL'),
    ('fuel_receipt_invoices',   'receipt_id',        'fusion réception->facture'),
    ('delivery_note_items',     'delivery_note_id',  'détail d''un bon + fusion'),
    ('delivery_note_payments',  'delivery_note_id',  'getDeliveryNotePayments(note) + fusion'),
    ('delivery_note_photos',    'delivery_note_id',  'getDeliveryNotePhotos(note) + fusion'),
    ('purchase_items',          'purchase_id',       'getPurchaseItems(achat) + fusion'),
    ('client_appointments',     'client_id',         'getClientAppointments(client) + fusion'),
    ('supplier_appointments',   'supplier_id',       'getSupplierAppointments(fournisseur) + fusion'),
    ('supplier_debt_payments',  'supplier_id',       'getSupplierDebtPayments(fournisseur) + fusion'),
    ('pompiste_decalage_history','pompiste_id',      'getDecalageHistory(pompiste) + fusion'),
    ('worker_acomptes',         'worker_id',         'getWorkerAcomptes(worker) — fiche employé'),
    ('worker_absences',         'worker_id',         'getWorkerAbsences(worker)'),
    ('worker_payment_records',  'worker_id',         'getWorkerPaymentRecords(worker)'),
    ('clients',                 'created_at',        'dbSelectAll ORDER BY created_at (si table volumineuse)')
),
-- Première colonne-clé de chaque index existant.
indexed_first_col as (
  select t.relname as table_name, a.attname as column_name
  from pg_index ix
  join pg_class t     on t.oid = ix.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  join pg_attribute a on a.attrelid = t.oid and a.attnum = ix.indkey[0]
  where n.nspname = 'public'
),
-- Toutes les colonnes réelles des tables (remplace information_schema, plus rapide).
real_cols as (
  select c.relname as table_name, a.attname as column_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
)
select
  c.table_name, c.column_name, c.pourquoi,
  case
    when to_regclass('public.' || c.table_name) is null                       then 'TABLE ABSENTE (ignorer)'
    when not exists (select 1 from real_cols rc
                     where rc.table_name = c.table_name and rc.column_name = c.column_name)
                                                                              then 'COLONNE ABSENTE (ignorer)'
    when exists (select 1 from indexed_first_col f
                 where f.table_name = c.table_name and f.column_name = c.column_name)
                                                                              then 'déjà indexé (ne rien faire)'
    else 'MANQUANT -> index justifié'
  end as etat
from candidates c
order by etat desc, c.table_name;


-- ▶ REQUÊTE 4 — POLITIQUES RLS (une policy coûteuse ralentit CHAQUE requête). Lancer seule.
select tablename as table_name, policyname as policy, cmd as commande, qual as using_expr, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ▶ REQUÊTE 5 — INDEX INUTILISÉS (idx_scan = 0 : coûte en écriture sans servir). Lancer seule.
--   À confirmer sur plusieurs semaines avant toute décision. Ne RIEN supprimer ici.
select
  relname      as table_name,
  indexrelname as index_name,
  idx_scan     as nb_utilisations,
  pg_size_pretty(pg_relation_size(indexrelid)) as taille
from pg_stat_user_indexes
where schemaname = 'public'
order by idx_scan asc, pg_relation_size(indexrelid) desc;


-- ▶ REQUÊTE 6 (OPTIONNELLE) — plans d'exécution. Décommenter, mettre un ID réel, lancer seule.
--   EXPLAIN (ANALYZE) exécute le SELECT (aucune écriture) et mesure le temps.
-- set statement_timeout = '120s';
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM public.fuel_sales ORDER BY created_at DESC LIMIT 1000;
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM public.purchase_items WHERE purchase_id = '<un_purchase_id>';

-- Fin du diagnostic — rien n'a été modifié.
