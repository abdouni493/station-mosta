-- LECTURE SEULE : aucune instruction ne modifie la base (uniquement des SELECT).
-- Vérifie l'achat du 07/10/2026 qui a augmenté le stock sans laisser de facture.

-- 1) Achats Lavage enregistrés le 07/10 et après (on attend A-0033, A-0034… et l'achat manquant ?)
select p->>'ref'          as ref,
       p->>'date'         as date,
       p->>'createdAt'    as cree_le,
       p->>'supplierName' as fournisseur,
       (p->>'total')::numeric as total,
       (p->>'paid')::numeric  as paye,
       jsonb_array_length(coalesce(p->'items','[]'::jsonb)) as nb_lignes
from biz_store s,
     jsonb_array_elements(s.state->'lavage'->'purchases') p
where s.id = 'biz-v1'
  and p->>'createdAt' >= '2026-10-07'
order by p->>'createdAt';

-- 2) Un achat contenant TD 15/40 VRAC existe-t-il ? (attendu : seulement A-0010 du 16/09)
select p->>'ref' as ref, p->>'createdAt' as cree_le, i->>'qty' as qte, i->>'unitPrice' as prix
from biz_store s,
     jsonb_array_elements(s.state->'lavage'->'purchases') p,
     jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) i
where s.id = 'biz-v1'
  and i->>'productId' = '8ea7bb66-eccf-4d0c-aed6-29e5bdfae7c6';

-- 3) Stock actuel du produit
select name, current_qty, purchase_price, upd
from biz_products
where id = '8ea7bb66-eccf-4d0c-aed6-29e5bdfae7c6';
