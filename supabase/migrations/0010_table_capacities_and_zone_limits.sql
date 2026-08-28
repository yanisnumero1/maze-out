-- Capacités opérationnelles par table et par carré, sans réécrire l'historique.
alter table public.tables add column if not exists max_people smallint not null default 7 check (max_people > 0);
alter table public.tables add column if not exists max_extra_guests smallint not null default 0 check (max_extra_guests >= 0);

-- Les anciens noms restent disponibles pour les historiques ; les deux noms opérationnels sont corrigés.
update public.head_waiters set active = false where active and ((first_name = 'Matteo' and last_name = '') or (first_name = 'Alan' and last_name = 'K'));
insert into public.head_waiters(first_name, last_name, color, active)
select v.first_name, v.last_name, v.color, true
from (values ('Matheo'::text, ''::text, '#fbbf24'::text), ('Allan'::text, 'K'::text, '#e879f9'::text)) as v(first_name, last_name, color)
where not exists (select 1 from public.head_waiters h where h.first_name = v.first_name and h.last_name = v.last_name);

update public.tables t
set head_waiter_id = h.id
from public.head_waiters h
where t.active and t.display_number between 17 and 24 and h.first_name = 'Matheo' and h.last_name = '' and h.active;

update public.tables t
set head_waiter_id = h.id
from public.head_waiters h
where t.active and t.display_number between 41 and 48 and h.first_name = 'Allan' and h.last_name = 'K' and h.active;

update public.zones z
set max_capacity = v.max_capacity
from (values
  (1, 264::smallint),
  (2, 261::smallint),
  (3, 138::smallint),
  (4, 101::smallint)
) as v(display_order, max_capacity)
where z.active and z.display_order = v.display_order;

update public.tables
set max_people = case when display_number in (70, 71) then 10 else 7 end,
    max_extra_guests = case when display_number in (4, 6, 7, 8, 12, 14, 15, 16, 26, 31, 36, 38, 39, 41, 44, 52, 65, 70, 71) then 3 else 0 end
where active;

-- standard_capacity reste cohérent pour les calculs existants ; max_people devient la limite de saisie explicite.
update public.tables set standard_capacity = max_people where active;

create or replace function public.validate_occupancy_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_people smallint;
  v_max_extra_guests smallint;
begin
  select max_people, max_extra_guests into v_max_people, v_max_extra_guests
  from public.tables where id = new.table_id;

  if new.present_people < 0 or new.present_people > v_max_people then
    raise exception 'present_people exceeds table capacity';
  end if;
  if new.extra_guests < 0 or new.extra_guests > v_max_extra_guests then
    raise exception 'extra_guests exceeds table guest capacity';
  end if;
  return new;
end;
$$;

drop trigger if exists occupancy_capacity_limits on public.occupancies;
create trigger occupancy_capacity_limits
before insert or update on public.occupancies
for each row execute function public.validate_occupancy_limits();

do $$
begin
  if (select count(*) from public.tables where active) <> 72 then raise exception 'Expected 72 active tables'; end if;
  if (select count(*) from public.head_waiters where active) <> 9 then raise exception 'Expected 9 active head waiters'; end if;
  if (select count(*) from public.tables where active and display_number between 1 and 72) <> 72 then raise exception 'Display number configuration is invalid'; end if;
  if (select count(*) from public.tables where active and display_number = 70 and max_people = 10 and max_extra_guests = 3) <> 1 then raise exception 'Table 70 capacity is invalid'; end if;
  if (select count(*) from public.tables where active and display_number = 71 and max_people = 10 and max_extra_guests = 3) <> 1 then raise exception 'Table 71 capacity is invalid'; end if;
  if (select count(*) from public.tables where active and display_number = 52 and max_people = 7 and max_extra_guests = 3) <> 1 then raise exception 'Table 52 capacity is invalid'; end if;
  if (select coalesce(sum(max_capacity), 0) from public.zones where active) <> 764 then raise exception 'Zone capacity total is invalid'; end if;
end;
$$;
