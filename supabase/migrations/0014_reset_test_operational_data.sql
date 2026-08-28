-- Reset atomique des seules données opérationnelles/de test.
-- La configuration (auth, profils, zones, tables, CDR, capacités et RLS) n'est jamais modifiée.
create or replace function public.reset_test_operational_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'admin' then
    raise exception 'Admin access required';
  end if;

  -- Dépendances des données Lot 4.
  delete from public.promoter_count_events;
  delete from public.floor_notes;
  delete from public.club_entry_counts;
  delete from public.promoters;

  -- Données opérationnelles de salle et historiques de soirées.
  delete from public.arrival_drafts;
  delete from public.table_visits;
  delete from public.reservations;

  -- Les lignes d'occupation sont conservées si elles existent, mais neutralisées.
  update public.occupancies
  set present_people = 0,
      extra_guests = 0,
      comment = null,
      arrived_at = null,
      updated_at = now();

  -- L'update des occupations produit potentiellement des logs : ils font partie du test à effacer.
  delete from public.activity_log;
  delete from public.night_sessions;

  -- Vérifications de configuration : une erreur annule l'intégralité du reset.
  if (select count(*) from public.tables where active) <> 72 then raise exception 'Expected 72 active tables'; end if;
  if (select count(*) from public.head_waiters where active) <> 9 then raise exception 'Expected 9 active head waiters'; end if;
  if (select count(distinct display_number) from public.tables where active) <> 72
     or (select min(display_number) from public.tables where active) <> 1
     or (select max(display_number) from public.tables where active) <> 72
     or exists (select 1 from generate_series(1, 72) n where not exists (select 1 from public.tables t where t.active and t.display_number = n)) then
    raise exception 'Active display numbers must be exactly 1 to 72';
  end if;
  if (select count(*) from public.tables t join public.zones z on z.id = t.zone_id where t.active and z.display_order = 1 and t.display_number between 1 and 24) <> 24 then raise exception 'Carré 1 allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id = t.zone_id where t.active and z.display_order = 2 and t.display_number between 25 and 48) <> 24 then raise exception 'Carré 2 allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id = t.zone_id where t.active and z.display_order = 3 and t.display_number between 49 and 63) <> 15 then raise exception 'Carré 3 allocation is invalid'; end if;
  if (select count(*) from public.tables t join public.zones z on z.id = t.zone_id where t.active and z.display_order = 4 and t.display_number between 64 and 72) <> 9 then raise exception 'Backstage allocation is invalid'; end if;
  if exists (
    select 1 from (values
      ('Samir'::text, ''::text, 1, 8),
      ('Alhan'::text, 'M'::text, 9, 16),
      ('Matheo'::text, ''::text, 17, 24),
      ('Bastien'::text, ''::text, 25, 32),
      ('Amor'::text, ''::text, 33, 40),
      ('Allan'::text, 'K'::text, 41, 48),
      ('Alissia'::text, ''::text, 49, 56),
      ('Luigi'::text, ''::text, 57, 63),
      ('Steven'::text, ''::text, 64, 72)
    ) as expected(first_name, last_name, first_number, last_number)
    where (select count(*) from public.tables t join public.head_waiters h on h.id = t.head_waiter_id
           where t.active and h.active and h.first_name = expected.first_name and h.last_name = expected.last_name
             and t.display_number between expected.first_number and expected.last_number)
          <> expected.last_number - expected.first_number + 1
  ) then raise exception 'Active CDR assignments are invalid'; end if;
  if (select max_capacity from public.zones where active and display_order = 1) <> 264
     or (select max_capacity from public.zones where active and display_order = 2) <> 261
     or (select max_capacity from public.zones where active and display_order = 3) <> 138
     or (select max_capacity from public.zones where active and display_order = 4) <> 101 then
    raise exception 'Zone capacities are invalid';
  end if;
end;
$$;

revoke all on function public.reset_test_operational_data() from public, anon;
grant execute on function public.reset_test_operational_data() to authenticated;
