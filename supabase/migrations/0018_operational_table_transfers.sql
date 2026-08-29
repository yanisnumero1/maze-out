-- Une vente conserve sa table d'origine, tout en pouvant changer de localisation
-- opérationnelle sans créer une seconde visite.
alter table public.table_visits add column if not exists current_table_id uuid references public.tables(id) on delete restrict;
update public.table_visits set current_table_id = table_id where current_table_id is null;
alter table public.table_visits alter column current_table_id set not null;

drop index if exists public.table_visits_one_open_per_table;
create unique index if not exists table_visits_one_open_per_current_table on public.table_visits(current_table_id) where ended_at is null;
create index if not exists table_visits_current_table_idx on public.table_visits(current_table_id);

create table if not exists public.table_visit_transfers (
  id uuid primary key default gen_random_uuid(),
  night_session_id uuid not null references public.night_sessions(id) on delete restrict,
  table_visit_id uuid not null references public.table_visits(id) on delete cascade,
  from_table_id uuid not null references public.tables(id) on delete restrict,
  to_table_id uuid not null references public.tables(id) on delete restrict,
  transferred_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_table_id <> to_table_id)
);
create index if not exists table_visit_transfers_visit_idx on public.table_visit_transfers(table_visit_id, created_at);
create index if not exists table_visit_transfers_night_idx on public.table_visit_transfers(night_session_id, created_at);
alter table public.table_visit_transfers enable row level security;
create policy "admin reads table visit transfers" on public.table_visit_transfers for select to authenticated using (public.current_role() = 'admin');
create policy "hostess reads active table visit transfers" on public.table_visit_transfers for select to authenticated using (public.current_role() = 'hostess' and public.is_active_night_session(night_session_id));

drop policy if exists "hostess reads active sales" on public.table_visits;
create policy "hostess reads active night table visits" on public.table_visits for select to authenticated using (public.current_role() = 'hostess' and public.is_active_night_session(night_session_id));

create or replace function public.history_occupancy_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_table_id uuid; v_total integer; v_visit_id uuid; v_night_id uuid; v_sale_number integer;
begin
  if current_setting('mazeout.transfer_in_progress', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then v_table_id := old.table_id; v_total := 0; else v_table_id := new.table_id; v_total := new.present_people + new.extra_guests; end if;
  select id into v_visit_id from public.table_visits where current_table_id = v_table_id and ended_at is null order by arrived_at desc limit 1;
  if v_total = 0 then
    if v_visit_id is not null then update public.table_visits set ended_at = now(), updated_at = now() where id = v_visit_id; end if;
    return coalesce(new, old);
  end if;
  if v_visit_id is null then
    v_night_id := public.open_night_session();
    select coalesce(max(sale_number), 0) + 1 into v_sale_number from public.table_visits where night_session_id = v_night_id and table_id = v_table_id;
    insert into public.table_visits(night_session_id, table_id, current_table_id, zone_id, head_waiter_id, present_people, extra_guests, comment, arrived_at, sale_number)
    select v_night_id, t.id, t.id, t.zone_id, t.head_waiter_id, new.present_people, new.extra_guests, new.comment, coalesce(new.arrived_at, now()), v_sale_number from public.tables t where t.id = v_table_id;
  else
    update public.table_visits set present_people = new.present_people, extra_guests = new.extra_guests, comment = new.comment, updated_at = now() where id = v_visit_id;
  end if;
  return new;
end;
$$;

create or replace function public.transfer_operational_table(p_from_table_id uuid, p_to_table_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_visit public.table_visits; v_destination public.tables; v_destination_total integer;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  if p_from_table_id = p_to_table_id then raise exception 'Destination must differ from source'; end if;
  perform 1 from public.tables where id in (p_from_table_id, p_to_table_id) order by id for update;
  if (select count(*) from public.tables where id in (p_from_table_id, p_to_table_id)) <> 2 then raise exception 'Table unavailable'; end if;
  select * into v_visit from public.table_visits where current_table_id = p_from_table_id and ended_at is null for update;
  if not found then raise exception 'No active sale on source table'; end if;
  select * into v_destination from public.tables where id = p_to_table_id and active for update;
  if not found then raise exception 'Destination unavailable'; end if;
  select present_people + extra_guests into v_destination_total from public.occupancies where table_id = p_to_table_id for update;
  if coalesce(v_destination_total, 0) > 0 then raise exception 'Destination is already occupied'; end if;
  if exists (select 1 from public.arrival_drafts where table_id = p_to_table_id and status = 'draft') then raise exception 'Destination has an arrival draft'; end if;
  if v_visit.present_people > v_destination.max_people or v_visit.extra_guests > v_destination.max_extra_guests then raise exception 'Destination capacity is insufficient'; end if;
  perform set_config('mazeout.transfer_in_progress', 'on', true);
  update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null where table_id = p_from_table_id;
  insert into public.occupancies(table_id, present_people, extra_guests, comment, arrived_at) values (p_to_table_id, v_visit.present_people, v_visit.extra_guests, v_visit.comment, now()) on conflict (table_id) do update set present_people = excluded.present_people, extra_guests = excluded.extra_guests, comment = excluded.comment, arrived_at = excluded.arrived_at;
  update public.table_visits set current_table_id = p_to_table_id, updated_at = now() where id = v_visit.id;
  insert into public.table_visit_transfers(night_session_id, table_visit_id, from_table_id, to_table_id, transferred_by) values (v_visit.night_session_id, v_visit.id, p_from_table_id, p_to_table_id, auth.uid());
  return v_visit.id;
end;
$$;

revoke all on function public.transfer_operational_table(uuid, uuid) from public;
grant execute on function public.transfer_operational_table(uuid, uuid) to authenticated;
alter publication supabase_realtime add table public.table_visit_transfers;
