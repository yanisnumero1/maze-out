-- Plan V3 : positions initiales calées sur le plan fourni.
-- Les numéros restent configurables depuis /admin, cette migration ne modifie aucune règle métier.
with numbered as (
  select t.id, z.display_order, row_number() over (partition by t.zone_id order by t.number) - 1 as n
  from public.tables t join public.zones z on z.id=t.zone_id
)
update public.tables t set
  position_x = case n.display_order
    when 1 then 77 + (n.n % 5) * 4.2
    when 2 then 3 + (n.n % 6) * 4.3
    when 3 then 50 + (n.n % 6) * 4.2
    when 4 then 77 + (n.n % 4) * 4.5 end,
  position_y = case n.display_order
    when 1 then 12 + floor(n.n / 5) * 6.2
    when 2 then 76 + floor(n.n / 6) * 6.1
    when 3 then 76 + floor(n.n / 6) * 6.1
    when 4 then 76 + floor(n.n / 4) * 6.1 end
from numbered n where n.id=t.id;
