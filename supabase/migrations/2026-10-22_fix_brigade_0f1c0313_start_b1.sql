-- Brigade 0f1c0313 (21/10/2026) : POMPE 4 LOURD · B1 était repartie de l'index
-- de DÉBUT de la veille (5 441 429,67) au lieu de l'index de FIN de la brigade
-- 1945478b (5 441 871,63). Seule cette valeur est corrigée.

-- 0. Contrôle avant : doit rendre une ligne, start = 5441429.67, prev_end = 5441871.63
select b.id, n.id as nozzle_id,
       b.start_nozzle_indices ->> n.id::text as start,
       p.end_nozzle_indices  ->> n.id::text as prev_end
from brigades b
join brigades p on p.id::text like '1945478b%'
join pump_nozzles n on n.name = 'B1'
join pumps pu on pu.id = n.pump_id and pu.name = 'POMPE 4 LOURD'
where b.id::text like '0f1c0313%';

-- 1. Correction
update brigades b
set start_nozzle_indices = jsonb_set(b.start_nozzle_indices::jsonb, array[n.id::text], to_jsonb(5441871.63))
from pump_nozzles n
join pumps pu on pu.id = n.pump_id and pu.name = 'POMPE 4 LOURD'
where b.id::text like '0f1c0313%'
  and n.name = 'B1'
  and (b.start_nozzle_indices ->> n.id::text)::numeric = 5441429.67;
