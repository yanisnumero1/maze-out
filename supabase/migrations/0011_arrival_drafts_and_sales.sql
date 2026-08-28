-- Brouillons d'arrivée et rotations fiables, sans altérer les visites existantes.
alter table public.table_visits add column if not exists sale_number integer;

with numbered as (
  select id, row_number() over (partition by night_session_id, table_id order by arrived_at, id) as sale_number
  from public.table_visits
  where sale_number is null
)
update public.table_visits v set sale_number = n.sale_number from numbered n where v.id = n.id;

create unique index if not exists table_visits_night_table_sale_unique on public.table_visits(night_session_id, table_id, sale_number) where sale_number is not null;
create unique index if not exists table_visits_one_open_per_table on public.table_visits(table_id) where ended_at is null;

create table if not exists public.arrival_drafts (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  present_people smallint not null check (present_people >= 0),
  extra_guests smallint not null check (extra_guests >= 0),
  comment text,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  confirmed_sale_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create unique index if not exists arrival_drafts_one_open_per_actor on public.arrival_drafts(actor_id) where status = 'draft';
create unique index if not exists arrival_drafts_one_open_per_table on public.arrival_drafts(table_id) where status = 'draft';

alter table public.arrival_drafts enable row level security;
create policy "admin manages arrival drafts" on public.arrival_drafts for all to authenticated using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create policy "hostess reads arrival drafts" on public.arrival_drafts for select to authenticated using (public.current_role() = 'hostess');
create policy "hostess reads active sales" on public.table_visits for select to authenticated using (public.current_role() = 'hostess' and ended_at is null);

create or replace function public.history_occupancy_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_id uuid;
  v_total integer;
  v_visit_id uuid;
  v_night_id uuid;
  v_sale_number integer;
begin
  if tg_op = 'DELETE' then
    v_table_id := old.table_id;
    v_total := 0;
  else
    v_table_id := new.table_id;
    v_total := new.present_people + new.extra_guests;
  end if;

  select id into v_visit_id from public.table_visits where table_id = v_table_id and ended_at is null order by arrived_at desc limit 1;
  if v_total = 0 then
    if v_visit_id is not null then update public.table_visits set ended_at = now(), updated_at = now() where id = v_visit_id; end if;
    return coalesce(new, old);
  end if;

  if v_visit_id is null then
    v_night_id := public.open_night_session();
    select coalesce(max(sale_number), 0) + 1 into v_sale_number from public.table_visits where night_session_id = v_night_id and table_id = new.table_id;
    insert into public.table_visits (night_session_id, table_id, zone_id, head_waiter_id, present_people, extra_guests, comment, arrived_at, sale_number)
    select v_night_id, t.id, t.zone_id, t.head_waiter_id, new.present_people, new.extra_guests, new.comment, coalesce(new.arrived_at, now()), v_sale_number
    from public.tables t where t.id = new.table_id;
  else
    update public.table_visits set present_people = new.present_people, extra_guests = new.extra_guests, comment = new.comment, updated_at = now() where id = v_visit_id;
  end if;
  return new;
end;
$$;

create or replace function public.prepare_arrival_draft(p_table_id uuid, p_present_people smallint, p_extra_guests smallint, p_comment text default null)
returns public.arrival_drafts
language plpgsql
security definer
set search_path = public
as $$
declare v_draft public.arrival_drafts;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  perform 1 from public.tables where id = p_table_id and active for update;
  if not found then raise exception 'Table unavailable'; end if;
  if exists (select 1 from public.occupancies where table_id = p_table_id and present_people + extra_guests > 0) then raise exception 'This table is already occupied'; end if;
  if exists (select 1 from public.arrival_drafts where table_id = p_table_id and status = 'draft' and actor_id <> auth.uid()) then raise exception 'This table is being prepared by another user'; end if;
  if exists (select 1 from public.tables where id = p_table_id and (p_present_people < 0 or p_present_people > max_people or p_extra_guests < 0 or p_extra_guests > max_extra_guests)) then raise exception 'Draft exceeds table capacity'; end if;
  update public.arrival_drafts set status = 'cancelled', updated_at = now() where actor_id = auth.uid() and status = 'draft';
  insert into public.arrival_drafts(table_id, actor_id, present_people, extra_guests, comment)
  values (p_table_id, auth.uid(), p_present_people, p_extra_guests, p_comment)
  returning * into v_draft;
  return v_draft;
end;
$$;

create or replace function public.move_arrival_draft(p_draft_id uuid, p_table_id uuid)
returns public.arrival_drafts
language plpgsql
security definer
set search_path = public
as $$
declare v_draft public.arrival_drafts;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  select * into v_draft from public.arrival_drafts where id = p_draft_id and status = 'draft' and (actor_id = auth.uid() or public.current_role() = 'admin') for update;
  if not found then raise exception 'Draft unavailable'; end if;
  perform 1 from public.tables where id = p_table_id and active for update;
  if not found then raise exception 'Table unavailable'; end if;
  if exists (select 1 from public.occupancies where table_id = p_table_id and present_people + extra_guests > 0) then raise exception 'This table is already occupied'; end if;
  if exists (select 1 from public.arrival_drafts where table_id = p_table_id and status = 'draft' and id <> p_draft_id) then raise exception 'This table is being prepared by another user'; end if;
  if exists (select 1 from public.tables where id = p_table_id and (v_draft.present_people > max_people or v_draft.extra_guests > max_extra_guests)) then raise exception 'The selected table does not support this group'; end if;
  update public.arrival_drafts set table_id = p_table_id, updated_at = now() where id = p_draft_id returning * into v_draft;
  return v_draft;
end;
$$;

create or replace function public.confirm_arrival_draft(p_draft_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_draft public.arrival_drafts; v_sale_number integer;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  select * into v_draft from public.arrival_drafts where id = p_draft_id and status = 'draft' and (actor_id = auth.uid() or public.current_role() = 'admin') for update;
  if not found then raise exception 'Draft already confirmed or unavailable'; end if;
  perform 1 from public.tables where id = v_draft.table_id and active for update;
  if exists (select 1 from public.occupancies where table_id = v_draft.table_id and present_people + extra_guests > 0) then raise exception 'This table has just been occupied by another user'; end if;
  if exists (select 1 from public.tables where id = v_draft.table_id and (v_draft.present_people > max_people or v_draft.extra_guests > max_extra_guests)) then raise exception 'Draft exceeds table capacity'; end if;
  insert into public.occupancies(table_id, present_people, extra_guests, comment, arrived_at)
  values (v_draft.table_id, v_draft.present_people, v_draft.extra_guests, v_draft.comment, now())
  on conflict (table_id) do update set present_people = excluded.present_people, extra_guests = excluded.extra_guests, comment = excluded.comment, arrived_at = excluded.arrived_at;
  select sale_number into v_sale_number from public.table_visits where table_id = v_draft.table_id and ended_at is null;
  update public.arrival_drafts set status = 'confirmed', confirmed_sale_number = v_sale_number, confirmed_at = now(), updated_at = now() where id = p_draft_id;
  return v_sale_number;
end;
$$;

create or replace function public.release_operational_table(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  perform 1 from public.tables where id = p_table_id and active for update;
  if not found then raise exception 'Table unavailable'; end if;
  update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null where table_id = p_table_id;
end;
$$;
