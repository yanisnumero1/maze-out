-- Numérotation métier de la configuration opérationnelle actuelle, sans modifier les UUID ni les anciens numéros.
alter table public.tables add column if not exists display_number smallint;
create unique index if not exists tables_active_display_number_unique on public.tables(display_number) where active and display_number is not null;

with allocation(first_name, last_name, first_number) as (
  values
    ('Samir'::text, ''::text, 1),
    ('Alhan'::text, 'M'::text, 9),
    ('Matteo'::text, ''::text, 17),
    ('Bastien'::text, ''::text, 25),
    ('Amor'::text, ''::text, 33),
    ('Alan'::text, 'K'::text, 41),
    ('Alissia'::text, ''::text, 49),
    ('Luigi'::text, ''::text, 57),
    ('Steven'::text, ''::text, 64)
), ranked as (
  select t.id, a.first_number + row_number() over (partition by h.id order by t.number)::int - 1 as display_number
  from public.tables t
  join public.head_waiters h on h.id = t.head_waiter_id
  join allocation a on a.first_name = h.first_name and a.last_name = h.last_name
  where t.active
)
update public.tables t set display_number = r.display_number from ranked r where t.id = r.id;

do $$
begin
  if (select count(*) from public.tables where active) <> 72 then raise exception 'Expected 72 active tables'; end if;
  if (select count(distinct display_number) from public.tables where active) <> 72 then raise exception 'Active display numbers must be unique'; end if;
  if (select min(display_number) from public.tables where active) <> 1 or (select max(display_number) from public.tables where active) <> 72 then raise exception 'Active display number range must be 1 to 72'; end if;
  if exists (select 1 from generate_series(1, 72) n where not exists (select 1 from public.tables t where t.active and t.display_number = n)) then raise exception 'Active display numbers contain gaps'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id=t.zone_id where t.active and z.display_order=1 and t.display_number between 1 and 24) <> 24 then raise exception 'Carré 1 numbering is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id=t.zone_id where t.active and z.display_order=2 and t.display_number between 25 and 48) <> 24 then raise exception 'Carré 2 numbering is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id=t.zone_id where t.active and z.display_order=3 and t.display_number between 49 and 63) <> 15 then raise exception 'Carré 3 numbering is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id=t.zone_id where t.active and z.display_order=4 and t.display_number between 64 and 72) <> 9 then raise exception 'Backstage numbering is invalid'; end if;
end;
$$;
