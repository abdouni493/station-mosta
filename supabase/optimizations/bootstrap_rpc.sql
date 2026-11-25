-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  app_bootstrap_phase1 / app_bootstrap_phase2                               ║
-- ║                                                                            ║
-- ║  Collapse the ~48 separate REST round-trips the app makes at every login   ║
-- ║  into TWO RPC calls — one bundle of JSON per hydration phase.              ║
-- ║                                                                            ║
-- ║  Why this is safe:                                                         ║
-- ║   • SECURITY INVOKER (default): every table read inside the function is    ║
-- ║     subject to the SAME row-level-security policies as a direct read, run  ║
-- ║     as the logged-in user. Nothing is exposed that the app could not       ║
-- ║     already read table-by-table.                                           ║
-- ║   • STABLE, read-only: no INSERT / UPDATE / DELETE / DDL. No data changes. ║
-- ║   • Each key holds the raw rows (snake_case columns), IDENTICAL in shape   ║
-- ║     to `select *`, so the app's existing mappers work unchanged.           ║
-- ║   • The app falls back to the old per-table reads if the RPC is missing    ║
-- ║     or errors, so deploying the code before/after this SQL is harmless.    ║
-- ║                                                                            ║
-- ║  Idempotent: CREATE OR REPLACE. Re-runnable any time.                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── PHASE 1 : small reference tables that unblock the app shell ──────────────
CREATE OR REPLACE FUNCTION public.app_bootstrap_phase1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tanks',                     (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM tanks t),
    'pumps',                     (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM pumps t),
    'pump_nozzles',              (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM pump_nozzles t),
    'tracks',                    (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM tracks t),
    'drivers',                   (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM drivers t),
    'products',                  (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM products t),
    'product_brands',            (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM product_brands t),
    'pompistes',                 (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM pompistes t),
    'brigade_chefs',             (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM brigade_chefs t),
    'gerants',                   (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM gerants t),
    'magasin_workers',           (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM magasin_workers t),
    'clients',                   (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM clients t),
    'suppliers',                 (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM suppliers t),
    'chef_pompiste_assignments', (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM chef_pompiste_assignments t),
    'permission_templates',      (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM permission_templates t),
    'station_settings',          (SELECT to_jsonb(t) FROM station_settings t LIMIT 1)
  );
$$;

-- ── PHASE 2 : transactional tables, loaded in the background ─────────────────
CREATE OR REPLACE FUNCTION public.app_bootstrap_phase2()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'brigades',                          (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM brigades t),
    'brigade_pompiste_assignments',      (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM brigade_pompiste_assignments t),
    'bank_accounts',                     (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM bank_accounts t),
    'treasury_transactions',             (SELECT coalesce(jsonb_agg(t ORDER BY t.date DESC NULLS LAST), '[]'::jsonb) FROM treasury_transactions t),
    'pompiste_decalage_history',         (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM pompiste_decalage_history t),
    'tpe_transactions',                  (SELECT coalesce(jsonb_agg(t ORDER BY t.date DESC NULLS LAST), '[]'::jsonb) FROM tpe_transactions t),
    'brigade_decalage_alerts',           (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT * FROM brigade_decalage_alerts ORDER BY created_at DESC LIMIT 200) x),
    'brigade_accounting',                (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM brigade_accounting t),
    'brigade_accounting_justifications', (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM brigade_accounting_justifications t),
    'fuel_sales',                        (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM fuel_sales t),
    'shop_sales',                        (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM shop_sales t),
    'delivery_notes',                    (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM delivery_notes t),
    'purchases',                         (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT * FROM purchases ORDER BY created_at DESC LIMIT 500) x),
    'expenses',                          (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM expenses t),
    'inventories',                       (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM inventories t),
    'daily_reports',                     (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM daily_reports t),
    'worker_acomptes',                   (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM worker_acomptes t),
    'worker_absences',                   (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM worker_absences t),
    'worker_payment_records',            (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM worker_payment_records t),
    'delivery_note_payments',            (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM delivery_note_payments t),
    'delivery_note_photos',              (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM delivery_note_photos t),
    'delivery_note_items',               (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM delivery_note_items t),
    'purchase_items',                    (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM purchase_items t),
    'purchase_payments',                 (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM purchase_payments t),
    'shop_sale_items',                   (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM shop_sale_items t),
    'supplier_appointments',             (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM supplier_appointments t),
    'supplier_debt_payments',            (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM supplier_debt_payments t),
    'client_appointments',               (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM client_appointments t),
    'client_transactions',               (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM client_transactions t),
    'fuel_invoices',                     (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT * FROM fuel_invoices ORDER BY created_at DESC LIMIT 500) x),
    'fuel_invoice_bls',                  (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM fuel_invoice_bls t),
    'fuel_receipts',                     (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT * FROM fuel_receipts ORDER BY created_at DESC LIMIT 500) x),
    'fuel_receipt_invoices',             (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM fuel_receipt_invoices t)
  );
$$;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  app_tables_fingerprint(text[])                                            ║
-- ║                                                                            ║
-- ║  A cheap content hash per table, so the polling fallback (used when the    ║
-- ║  realtime WebSocket is blocked — common on station networks) stops         ║
-- ║  re-downloading whole tables every 60 s. The client probes this ONE tiny   ║
-- ║  function and only re-fetches the tables whose hash actually changed.      ║
-- ║                                                                            ║
-- ║  Safety:                                                                   ║
-- ║   • SECURITY INVOKER + RLS: hashes only rows the caller can read.          ║
-- ║   • The hash covers EVERY column of EVERY row (r::text), so inserts,       ║
-- ║     updates AND deletes all change it — no missed-update gap.              ║
-- ║   • `to_regclass` + `%I` guard: only existing public tables are hashed,    ║
-- ║     never arbitrary SQL from the client.                                   ║
-- ║   • Read-only. If anything differs, the client does its usual FULL, proven ║
-- ║     refetch — the hash only lets it SKIP provably-identical tables.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
CREATE OR REPLACE FUNCTION public.app_tables_fingerprint(tbls text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  t text;
  h text;
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    -- Only hash a real public base table; ignore anything else.
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'SELECT md5(coalesce(string_agg(r::text, chr(10) ORDER BY r::text), %L)) FROM %I r',
      '', t
    ) INTO h;
    result := result || jsonb_build_object(t, h);
  END LOOP;
  RETURN result;
END;
$$;

-- ── Expose to the roles the browser client uses ─────────────────────────────
GRANT EXECUTE ON FUNCTION public.app_bootstrap_phase1() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_bootstrap_phase2() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_tables_fingerprint(text[]) TO anon, authenticated, service_role;

-- Ask PostgREST to pick up the new functions immediately.
NOTIFY pgrst, 'reload schema';
