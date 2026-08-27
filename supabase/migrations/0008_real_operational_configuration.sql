-- Configuration opérationnelle réelle. Les entités historiques restent en base.
alter table public.zones add column if not exists max_capacity smallint;

-- Les quatre zones existantes conservent leur identité : les historiques restent rattachés aux mêmes IDs.
update public.zones set active = false;
insert into public.zones(name, display_order, active, max_capacity)
select v.name, v.display_order, true, v.max_capacity
from (values
  ('Carré 1', 1, 230::smallint),
  ('Carré 2', 2, 230::smallint),
  ('Carré 3', 3, 135::smallint),
  ('Backstage', 4, 90::smallint)
) as v(name, display_order, max_capacity)
where not exists (select 1 from public.zones z where z.display_order = v.display_order);

update public.zones z
set name = v.name, active = true, max_capacity = v.max_capacity
from (values
  ('Carré 1', 1, 230::smallint),
  ('Carré 2', 2, 230::smallint),
  ('Carré 3', 3, 135::smallint),
  ('Backstage', 4, 90::smallint)
) as v(name, display_order, max_capacity)
where z.display_order = v.display_order;

-- Les anciens CDR restent consultables pour les visites historiques, mais ne sont plus opérationnels.
update public.head_waiters set active = false;
insert into public.head_waiters(first_name, last_name, color, active)
values
  ('Samir', '', '#34d399', true),
  ('Alhan', 'M', '#60a5fa', true),
  ('Matteo', '', '#fbbf24', true),
  ('Bastien', '', '#fb7185', true),
  ('Amor', '', '#a78bfa', true),
  ('Alan', 'K', '#e879f9', true),
  ('Alissia', '', '#22d3ee', true),
  ('Luigi', '', '#f97316', true),
  ('Steven', '', '#84cc16', true);

-- Les tables existantes restent conservées pour l'historique, mais sont retirées de l'exploitation.
update public.tables set active = false where active = true;

with allocations(zone_order, first_name, last_name, table_count) as (
  values
    (1, 'Samir'::text, ''::text, 8),
    (1, 'Alhan'::text, 'M'::text, 8),
    (1, 'Matteo'::text, ''::text, 8),
    (2, 'Bastien'::text, ''::text, 8),
    (2, 'Amor'::text, ''::text, 8),
    (2, 'Alan'::text, 'K'::text, 8),
    (3, 'Alissia'::text, ''::text, 8),
    (3, 'Luigi'::text, ''::text, 7),
    (4, 'Steven'::text, ''::text, 9)
)
insert into public.tables(number, zone_id, head_waiter_id, standard_capacity, position_x, position_y, active)
select
  format('OP-%s-%s-%s', a.zone_order, lower(replace(a.first_name, ' ', '')), lpad(n::text, 2, '0')),
  z.id,
  h.id,
  7,
  0,
  0,
  true
from allocations a
join public.zones z on z.display_order = a.zone_order and z.active = true
join public.head_waiters h on h.first_name = a.first_name and h.last_name = a.last_name and h.active = true
cross join lateral generate_series(1, a.table_count) as n;

do $$
begin
  if (select count(*) from public.tables where active) <> 72 then raise exception 'Expected 72 active tables'; end if;
  if (select count(*) from public.head_waiters where active) <> 9 then raise exception 'Expected 9 active head waiters'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id=t.zone_id where t.active and z.display_order=1) <> 24 then raise exception 'Carré 1 allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id=t.zone_id where t.active and z.display_order=2) <> 24 then raise exception 'Carré 2 allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id=t.zone_id where t.active and z.display_order=3) <> 15 then raise exception 'Carré 3 allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id=t.zone_id where t.active and z.display_order=4) <> 9 then raise exception 'Backstage allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Samir' and h.last_name='') <> 8 then raise exception 'Samir allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Alhan' and h.last_name='M') <> 8 then raise exception 'Alhan M allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Matteo' and h.last_name='') <> 8 then raise exception 'Matteo allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Bastien' and h.last_name='') <> 8 then raise exception 'Bastien allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Amor' and h.last_name='') <> 8 then raise exception 'Amor allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Alan' and h.last_name='K') <> 8 then raise exception 'Alan K allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Alissia' and h.last_name='') <> 8 then raise exception 'Alissia allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Luigi' and h.last_name='') <> 7 then raise exception 'Luigi allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.head_waiters h on h.id=t.head_waiter_id where t.active and h.first_name='Steven' and h.last_name='') <> 9 then raise exception 'Steven allocation is invalid'; end if;
  if (select coalesce(sum(max_capacity), 0) from public.zones where active) <> 685 then raise exception 'Zone capacity total is invalid'; end if;
end;
$$;
