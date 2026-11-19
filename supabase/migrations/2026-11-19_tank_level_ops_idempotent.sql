-- ============================================================
-- Mouvements de cuve REJOUABLES — 2026-11-19
--
-- Problème : sur un lien lent, l'appel `adjust_tank_level` qui retire des
-- cuves les litres d'une brigade pouvait expirer (« TimeoutError »). Le
-- navigateur ne savait pas s'il avait été appliqué : le rejouer risquait de
-- retirer DEUX FOIS les litres, ne pas le rejouer laissait la cuve pleine.
--
-- Solution : chaque mouvement porte un identifiant unique fixé par le
-- navigateur. `adjust_tank_level_once` l'inscrit dans `tank_level_ops` et
-- n'applique le delta QUE si cet identifiant est nouveau. L'appel peut donc
-- être rejoué sans risque après une coupure.
--
-- L'application fonctionne aussi SANS cette migration (elle retombe sur
-- `adjust_tank_level`), mais sans la reprise automatique des mouvements.
--
-- À exécuter une fois dans Supabase → SQL Editor. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tank_level_ops (
  op_id      text PRIMARY KEY,
  tank_id    text NOT NULL,
  delta      numeric NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Accessible uniquement via la fonction (SECURITY DEFINER) ci-dessous.
ALTER TABLE public.tank_level_ops ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.adjust_tank_level_once(p_op_id text, p_tank_id text, p_delta numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
BEGIN
  IF p_op_id IS NULL OR p_op_id = '' THEN
    RETURN public.adjust_tank_level(p_tank_id, p_delta);
  END IF;

  INSERT INTO public.tank_level_ops (op_id, tank_id, delta)
  VALUES (p_op_id, p_tank_id, COALESCE(p_delta, 0))
  ON CONFLICT (op_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Déjà appliqué lors d'un essai précédent : on ne retire rien de plus.
  IF v_inserted = 0 THEN
    RETURN (SELECT "current" FROM public.tanks WHERE id::text = p_tank_id);
  END IF;

  RETURN public.adjust_tank_level(p_tank_id, p_delta);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_tank_level_once(text, text, numeric) TO authenticated, anon;

-- Index sur les sous-enregistrements qu'une brigade supprime puis réécrit à
-- chaque enregistrement : sans eux, chaque suppression parcourt la table
-- entière. Une table absente n'interrompt pas le script.
DO $$
BEGIN
  BEGIN CREATE INDEX IF NOT EXISTS brigade_pompiste_assignments_brigade_idx ON public.brigade_pompiste_assignments (brigade_id); EXCEPTION WHEN others THEN NULL; END;
  BEGIN CREATE INDEX IF NOT EXISTS brigade_acc_justif_accounting_idx ON public.brigade_accounting_justifications (accounting_id); EXCEPTION WHEN others THEN NULL; END;
  BEGIN CREATE INDEX IF NOT EXISTS tpe_transactions_accounting_idx ON public.tpe_transactions (accounting_id); EXCEPTION WHEN others THEN NULL; END;
  BEGIN CREATE INDEX IF NOT EXISTS brigade_decalage_alerts_brigade_idx ON public.brigade_decalage_alerts (brigade_id); EXCEPTION WHEN others THEN NULL; END;
END $$;

NOTIFY pgrst, 'reload schema';
