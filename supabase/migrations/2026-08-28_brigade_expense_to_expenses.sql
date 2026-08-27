-- =====================================================================================
--  LA DÉPENSE D'UNE BRIGADE DEVIENT UNE VRAIE DÉPENSE
--  2026-08-28
--
--  CE QUI N'ALLAIT PAS
--  Une brigade pouvait justifier son reste « par dépense » : le pompiste avait payé
--  quelque chose (eau, réparation, pourboire) avec les espèces de la brigade et
--  remettait d'autant moins. La justification ÉQUILIBRAIT la brigade — et s'arrêtait
--  là. La charge n'apparaissait nulle part : ni dans l'écran Dépenses, ni dans le
--  résultat du Carburant. De l'argent sortait de la station sans laisser de pièce.
--
--  CE QUE FAIT CETTE MIGRATION
--    1. `brigade_accounting_justifications.expense_category` — la catégorie
--       (facultative) de la dépense, celle de l'écran Dépenses.
--    2. `expenses.brigade_id` / `.brigade_justification_id` / `.pompiste_id` — la
--       provenance d'une dépense née d'une brigade. C'est ce qui permet à l'écran
--       Dépenses d'afficher la brigade sur la carte, et à l'application de REPRENDRE
--       la dépense (au lieu d'en créer une seconde) quand la brigade est corrigée.
--    3. La reprise de l'existant : chaque justification « EXPENSE » déjà enregistrée
--       reçoit sa dépense, avec l'identifiant de la justification pour identifiant.
--
--  CE QU'ELLE NE FAIT PAS — ET POURQUOI
--  Aucune ligne de trésorerie n'est écrite pour ces dépenses : leur montant MANQUE
--  déjà aux espèces remises par la brigade (`brigade_accounting.cash_received`).
--  Les retirer d'une caisse ferait sortir le même argent deux fois. L'application
--  les écarte de toutes ses lectures de caisse (`isBrigadeExpense`).
--
--  Script IDEMPOTENT : sans risque à réexécuter.
--  À lancer dans Supabase → Database → SQL Editor.
-- =====================================================================================

-- =====================================================================================
--  1. LA CATÉGORIE DE LA JUSTIFICATION « DÉPENSE »
-- =====================================================================================

alter table public.brigade_accounting_justifications
  add column if not exists expense_category text;

comment on column public.brigade_accounting_justifications.expense_category is
  'Catégorie (facultative) d''une justification justification_type = ''EXPENSE'', '
  'reprise de settings.expense_categories. Le NOM de la dépense reste dans '
  'client_name et sa précision dans notes.';

-- Une dépense n'a ni client ni compte bancaire : la colonne doit accepter NULL.
-- (Déjà fait par 2026-08-27, répété ici pour que ce script suffise à lui seul.)
alter table public.brigade_accounting_justifications
  alter column client_id drop not null;

alter table public.brigade_accounting_justifications
  add column if not exists justification_type text not null default 'CLIENT',
  add column if not exists client_name        text,
  add column if not exists notes              text;

-- =====================================================================================
--  2. LA PROVENANCE D'UNE DÉPENSE
-- =====================================================================================

alter table public.expenses
  add column if not exists brigade_id               text,
  add column if not exists brigade_justification_id text,
  add column if not exists pompiste_id              text;

comment on column public.expenses.brigade_id is
  'La brigade qui a produit cette dépense (justification justification_type = ''EXPENSE''). '
  'Renseignée, elle signifie : payée sur les espèces de la brigade, donc DÉJÀ retranchée '
  'de cash_received — cette dépense ne sort d''aucune caisse et n''a aucune ligne de '
  'treasury_transactions.';
comment on column public.expenses.brigade_justification_id is
  'La justification de brigade dont la dépense est née — égale à son propre id.';
comment on column public.expenses.pompiste_id is
  'Le pompiste sur le lot duquel la dépense a été justifiée.';

create index if not exists idx_expenses_brigade_id on public.expenses (brigade_id);

-- =====================================================================================
--  3. REPRISE — LES JUSTIFICATIONS « DÉPENSE » DÉJÀ ENREGISTRÉES
--
--     Une dépense par justification, avec l'identifiant de la justification pour
--     identifiant : c'est la règle que suit l'application, et c'est elle qui garantit
--     qu'une brigade rouverte met la dépense À JOUR au lieu d'en créer une seconde.
--     `on conflict do nothing` rend la reprise rejouable sans risque.
-- =====================================================================================

insert into public.expenses (
  id, date, category, amount, description, payment_mode, account_id, part,
  paid_by, recipient, status, created_by,
  brigade_id, brigade_justification_id, pompiste_id)
select
  j.id,
  coalesce(nullif(b.date, ''), to_char(now(), 'YYYY-MM-DD')),
  coalesce(nullif(btrim(j.expense_category), ''), 'Dépense brigade'),
  j.amount,
  concat_ws(' — ',
    coalesce(nullif(btrim(j.client_name), ''), 'Dépense brigade'),
    nullif(btrim(j.notes), '')),
  'Espèces',
  'CAISSE_CARBURANT',
  'carburant',
  'Brigade',
  concat_ws(' — ',
    nullif(btrim(p.name), ''),
    btrim('Brigade ' || coalesce(nullif(btrim(b.shift), ''), ''))),
  'Validé',
  a.created_by,
  a.brigade_id,
  j.id,
  j.pompiste_id
from public.brigade_accounting_justifications j
join public.brigade_accounting a on a.id = j.accounting_id
left join public.brigades  b on b.id = a.brigade_id
left join public.pompistes p on p.id = j.pompiste_id
where j.justification_type = 'EXPENSE'
  and coalesce(j.amount, 0) > 0
on conflict (id) do nothing;

-- =====================================================================================
--  4. MÉNAGE — AUCUNE LIGNE DE TRÉSORERIE POUR CES DÉPENSES
--
--     Si une dépense de brigade a reçu une ligne de grand livre (édition manuelle
--     depuis l'écran Dépenses avant cette version), elle sortait le même argent une
--     seconde fois. On la retire.
-- =====================================================================================

delete from public.treasury_transactions t
 using public.expenses e
 where t.ref_type = 'expense'
   and t.ref_id   = e.id
   and e.brigade_id is not null;

-- =====================================================================================
--  5. CONTRÔLE — ce que les brigades ont justifié en dépenses, et ce qui est écrit
-- =====================================================================================

create or replace view public.v_brigade_expenses as
  select e.brigade_id,
         b.date            as brigade_date,
         b.shift           as brigade_shift,
         p.name            as pompiste,
         e.category,
         e.description,
         e.amount
    from public.expenses e
    left join public.brigades  b on b.id = e.brigade_id
    left join public.pompistes p on p.id = e.pompiste_id
   where e.brigade_id is not null
   order by b.date desc nulls last, e.amount desc;

comment on view public.v_brigade_expenses is
  'Les dépenses nées d''une justification de brigade. Leur total doit égaler la somme '
  'des justifications justification_type = ''EXPENSE''. Elles ne sortent d''aucune caisse : '
  'leur montant manque déjà aux espèces remises par la brigade.';
