-- ═══════════════════════════════════════════════════════════════════
--  Correction d'UN SEUL client : SOLTANI HOUCINE (Carburant)
--  id = 1fb66d30-5f5d-470d-895f-d312f4dc5de1
--
--  Ses pièces (sauvegarde du 22/10/2026) :
--    dette d'ouverture  93 430
--  + 29 bons à CRÉDIT    50 965   → 144 395 dus
--  − règlement 17/08     80 000
--  − règlement 22/10     64 395   → dette 0
--  + recharge 22/10      35 605   (trop-perçu du versement de 100 000)
--
--  Les compteurs de la fiche étaient restés à balance = 0,
--  advance_balance = 0, debt = 154 330. On les aligne sur les pièces :
--  debt = 0, avance = 35 605. Aucune autre ligne n'est touchée, et
--  aucune transaction n'est ajoutée ni supprimée.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 1. Contrôle AVANT : ce que disent les pièces (doit donner 0 et 35605).
select
  c.opening_debt
    + coalesce((select sum(j.amount) from brigade_accounting_justifications j
                where j.client_id = c.id and j.justification_type = 'CLIENT'
                  and upper(coalesce(j.payment_mode, '')) not in ('AVANCE', 'ADVANCE')), 0)
    - coalesce((select sum(t.amount) from client_transactions t
                where t.client_id = c.id and t.type = 'PAYMENT'), 0)            as dette_selon_pieces,
  c.opening_advance
    + coalesce((select sum(t.amount) from client_transactions t
                where t.client_id = c.id and t.type = 'RECHARGE'), 0)
    - coalesce((select sum(j.amount) from brigade_accounting_justifications j
                where j.client_id = c.id and j.justification_type = 'CLIENT'
                  and upper(coalesce(j.payment_mode, '')) in ('AVANCE', 'ADVANCE')), 0) as avance_selon_pieces,
  c.debt, c.balance, c.advance_balance
from clients c
where c.id = '1fb66d30-5f5d-470d-895f-d312f4dc5de1';

-- 2. Correction — la double condition (id + nom) empêche de toucher un autre client.
update clients
set debt            = 0,
    balance         = 35605,
    advance_balance = 35605
where id   = '1fb66d30-5f5d-470d-895f-d312f4dc5de1'
  and name = 'SOLTANI HOUCINE';

-- 3. Contrôle APRÈS (doit afficher debt 0, balance 35605, advance_balance 35605).
select id, name, debt, balance, advance_balance
from clients
where id = '1fb66d30-5f5d-470d-895f-d312f4dc5de1';

commit;
