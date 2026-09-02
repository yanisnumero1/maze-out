-- V4 / Lot 1: données métier d'une vente et apporteurs d'affaires canoniques.
-- Les informations restent attachées à table_visits : jamais aux tables ni aux occupancies.

create table if not exists public.business_referrers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 300),
  normalized_name text not null unique check (char_length(btrim(normalized_name)) between 1 and 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_referrers_active_name_idx
  on public.business_referrers(active, normalized_name);

alter table public.business_referrers enable row level security;

drop policy if exists "admin reads business referrers" on public.business_referrers;
drop policy if exists "admin inserts business referrers" on public.business_referrers;
drop policy if exists "admin updates business referrers" on public.business_referrers;
drop policy if exists "hostess reads active business referrers" on public.business_referrers;
drop policy if exists "cdr reads active business referrers" on public.business_referrers;

create policy "admin reads business referrers" on public.business_referrers
for select to authenticated using (public.current_role()::text = 'admin');
create policy "admin inserts business referrers" on public.business_referrers
for insert to authenticated with check (public.current_role()::text = 'admin');
create policy "admin updates business referrers" on public.business_referrers
for update to authenticated using (public.current_role()::text = 'admin') with check (public.current_role()::text = 'admin');
create policy "hostess reads active business referrers" on public.business_referrers
for select to authenticated using (public.current_role()::text = 'hostess' and active);
create policy "cdr reads active business referrers" on public.business_referrers
for select to authenticated using (public.current_role()::text = 'cdr' and active);

revoke all on table public.business_referrers from public, anon, authenticated;
grant select on table public.business_referrers to authenticated;

create or replace function public.save_business_referrer(
  p_business_referrer_id uuid default null,
  p_name text default null,
  p_active boolean default true
)
returns public.business_referrers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer public.business_referrers;
  v_name text;
  v_normalized_name text;
begin
  if auth.uid() is null or public.current_role()::text <> 'admin' then
    raise exception 'Admin access required';
  end if;
  v_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  if v_name is null then raise exception 'Business referrer name is required'; end if;
  if char_length(v_name) > 300 then raise exception 'Business referrer name is too long'; end if;
  v_normalized_name := lower(v_name);

  if p_business_referrer_id is null then
    if exists (select 1 from public.business_referrers where normalized_name = v_normalized_name) then
      raise exception 'Business referrer already exists';
    end if;
    insert into public.business_referrers(name, normalized_name, active)
    values (v_name, v_normalized_name, coalesce(p_active, true))
    returning * into v_referrer;
  else
    select * into v_referrer from public.business_referrers where id = p_business_referrer_id for update;
    if not found then raise exception 'Business referrer not found'; end if;
    if exists (select 1 from public.business_referrers where normalized_name = v_normalized_name and id <> p_business_referrer_id) then
      raise exception 'Business referrer already exists';
    end if;
    update public.business_referrers
    set name = v_name, normalized_name = v_normalized_name, active = coalesce(p_active, active), updated_at = now()
    where id = p_business_referrer_id
    returning * into v_referrer;
  end if;
  return v_referrer;
end;
$$;

alter table public.table_visits
  add column if not exists reservation_name text,
  add column if not exists consumption text,
  add column if not exists sale_comment text,
  add column if not exists proposed_business_referrer_name text,
  add column if not exists business_referrer_id uuid references public.business_referrers(id) on delete restrict,
  add column if not exists business_referrer_validated_at timestamptz,
  add column if not exists business_referrer_validated_by uuid references public.profiles(id) on delete restrict,
  add column if not exists final_head_waiter_id uuid references public.head_waiters(id) on delete restrict;

-- La valeur historique d'origine est conservée dans head_waiter_id. La valeur
-- finale est explicitement calculée depuis la table courante, sans modifier les
-- anciennes ventes ni perdre les informations de transfert déjà enregistrées.
update public.table_visits v
set final_head_waiter_id = coalesce(current_table.head_waiter_id, v.head_waiter_id)
from public.tables current_table
where v.final_head_waiter_id is null
  and current_table.id = coalesce(v.current_table_id, v.table_id);

create index if not exists table_visits_final_head_waiter_night_idx
  on public.table_visits(night_session_id, final_head_waiter_id);
create index if not exists table_visits_business_referrer_idx
  on public.table_visits(business_referrer_id);

alter table public.arrival_drafts
  add column if not exists reservation_name text,
  add column if not exists consumption text,
  add column if not exists sale_comment text,
  add column if not exists proposed_business_referrer_name text;

-- Les types d'action restent volontairement fermés : chaque nouvelle action
-- persistée est explicitement connue de l'audit central.
alter table public.operational_audit_log
  drop constraint if exists operational_audit_log_action_type_check;
alter table public.operational_audit_log
  add constraint operational_audit_log_action_type_check check (action_type in (
    'table.arrival_prepared', 'table.arrival_confirmed', 'table.arrival_modified', 'table.arrival_cancelled', 'table.sale_ended', 'table.transferred',
    'promoter.created', 'promoter.activity_added', 'promoter.activity_updated', 'promoter.activity_deleted', 'promoter.deleted',
    'floor_note.created', 'floor_note.updated', 'floor_note.deleted',
    'club_entry.created', 'club_entry.updated', 'club_entry.deleted', 'night.closed',
    'cdr.business_referrer.validated', 'cdr.business_referrer.corrected'
  ));

drop policy if exists "cdr reads own business referrer audit" on public.operational_audit_log;
create policy "cdr reads own business referrer audit" on public.operational_audit_log
for select to authenticated using (
  public.current_role()::text = 'cdr'
  and actor_id = auth.uid()
  and action_type in ('cdr.business_referrer.validated', 'cdr.business_referrer.corrected')
);

-- Compatibilité descendante : l'interface actuelle continue d'appeler la RPC
-- historique à quatre arguments. Les futurs écrans utiliseront cette RPC V4.
create or replace function public.prepare_arrival_draft_v4(
  p_table_id uuid,
  p_present_people smallint,
  p_extra_guests smallint,
  p_comment text default null,
  p_reservation_name text default null,
  p_consumption text default null,
  p_sale_comment text default null,
  p_proposed_business_referrer_name text default null
)
returns public.arrival_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.arrival_drafts;
  v_night_id uuid;
  v_reservation_name text := nullif(btrim(coalesce(p_reservation_name, '')), '');
  v_consumption text := nullif(btrim(coalesce(p_consumption, '')), '');
  v_sale_comment text := nullif(btrim(coalesce(p_sale_comment, '')), '');
  v_proposed_referrer text := nullif(btrim(regexp_replace(coalesce(p_proposed_business_referrer_name, ''), '\s+', ' ', 'g')), '');
begin
  if public.current_role()::text not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  if coalesce(p_present_people, 0) + coalesce(p_extra_guests, 0) < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.'; end if;
  if char_length(coalesce(v_reservation_name, '')) > 300 then raise exception 'Reservation name is too long'; end if;
  if char_length(coalesce(v_consumption, '')) > 1000 then raise exception 'Consumption is too long'; end if;
  if char_length(coalesce(v_sale_comment, '')) > 1000 then raise exception 'Sale comment is too long'; end if;
  if char_length(coalesce(v_proposed_referrer, '')) > 300 then raise exception 'Business referrer proposal is too long'; end if;

  perform 1 from public.tables where id = p_table_id and active for update;
  if not found then raise exception 'Table unavailable'; end if;
  if exists (select 1 from public.occupancies where table_id = p_table_id and present_people + extra_guests > 0) then raise exception 'This table is already occupied'; end if;
  if exists (select 1 from public.arrival_drafts where table_id = p_table_id and status = 'draft' and actor_id <> auth.uid()) then raise exception 'This table is being prepared by another user'; end if;
  if exists (select 1 from public.tables where id = p_table_id and (p_present_people < 0 or p_present_people > max_people or p_extra_guests < 0 or p_extra_guests > max_extra_guests)) then raise exception 'Draft exceeds table capacity'; end if;

  v_night_id := public.open_night_session();
  update public.arrival_drafts set status = 'cancelled', updated_at = now() where actor_id = auth.uid() and status = 'draft';
  insert into public.arrival_drafts(
    table_id, actor_id, night_session_id, present_people, extra_guests, comment,
    reservation_name, consumption, sale_comment, proposed_business_referrer_name
  ) values (
    p_table_id, auth.uid(), v_night_id, p_present_people, p_extra_guests, p_comment,
    v_reservation_name, v_consumption, v_sale_comment, v_proposed_referrer
  ) returning * into v_draft;

  perform public.write_operational_audit(
    v_night_id, 'table.arrival_prepared', 'arrival_draft', v_draft.id, null,
    jsonb_build_object(
      'table_id', v_draft.table_id, 'present_people', v_draft.present_people, 'extra_guests', v_draft.extra_guests,
      'comment', v_draft.comment, 'reservation_name', v_draft.reservation_name, 'consumption', v_draft.consumption,
      'sale_comment', v_draft.sale_comment, 'proposed_business_referrer_name', v_draft.proposed_business_referrer_name
    )
  );
  return v_draft;
end;
$$;

-- La confirmation est le seul endroit où les données du brouillon deviennent
-- les données de la nouvelle vente. Une revente part donc d'un nouveau brouillon.
create or replace function public.confirm_arrival_draft(p_draft_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.arrival_drafts;
  v_sale_number integer;
  v_visit_id uuid;
begin
  if public.current_role()::text not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  select * into v_draft from public.arrival_drafts
  where id = p_draft_id and status = 'draft' and (actor_id = auth.uid() or public.current_role()::text = 'admin')
  for update;
  if not found then raise exception 'Draft already confirmed or unavailable'; end if;
  if v_draft.present_people + v_draft.extra_guests < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.'; end if;
  perform 1 from public.tables where id = v_draft.table_id and active for update;
  if exists (select 1 from public.occupancies where table_id = v_draft.table_id and present_people + extra_guests > 0) then raise exception 'This table has just been occupied by another user'; end if;
  if exists (select 1 from public.tables where id = v_draft.table_id and (v_draft.present_people > max_people or v_draft.extra_guests > max_extra_guests)) then raise exception 'Draft exceeds table capacity'; end if;

  insert into public.occupancies(table_id, present_people, extra_guests, comment, arrived_at)
  values (v_draft.table_id, v_draft.present_people, v_draft.extra_guests, v_draft.comment, now())
  on conflict (table_id) do update set present_people = excluded.present_people, extra_guests = excluded.extra_guests, comment = excluded.comment, arrived_at = excluded.arrived_at;

  select id, sale_number into v_visit_id, v_sale_number
  from public.table_visits
  where current_table_id = v_draft.table_id and ended_at is null
  order by arrived_at desc limit 1;
  if v_visit_id is null then raise exception 'Confirmed visit unavailable'; end if;

  update public.table_visits
  set reservation_name = v_draft.reservation_name,
      consumption = v_draft.consumption,
      sale_comment = v_draft.sale_comment,
      proposed_business_referrer_name = v_draft.proposed_business_referrer_name,
      business_referrer_id = null,
      business_referrer_validated_at = null,
      business_referrer_validated_by = null,
      updated_at = now()
  where id = v_visit_id;

  update public.arrival_drafts
  set status = 'confirmed', confirmed_sale_number = v_sale_number, confirmed_at = now(), updated_at = now()
  where id = p_draft_id;
  return v_sale_number;
end;
$$;

-- Toute création de visite, y compris une création historique indirecte depuis
-- une occupation, initialise le CDR final à celui de la table de départ.
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
  if current_setting('mazeout.transfer_in_progress', true) = 'on'
    or current_setting('mazeout.release_in_progress', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then v_table_id := old.table_id; v_total := 0; else v_table_id := new.table_id; v_total := new.present_people + new.extra_guests; end if;
  select id into v_visit_id from public.table_visits where current_table_id = v_table_id and ended_at is null order by arrived_at desc limit 1;
  if v_total = 0 then
    if v_visit_id is not null then update public.table_visits set ended_at = now(), updated_at = now() where id = v_visit_id; end if;
    return coalesce(new, old);
  end if;
  if v_visit_id is null then
    v_night_id := public.open_night_session();
    select coalesce(max(sale_number), 0) + 1 into v_sale_number from public.table_visits where night_session_id = v_night_id and table_id = v_table_id;
    insert into public.table_visits(
      night_session_id, table_id, current_table_id, zone_id, head_waiter_id, final_head_waiter_id,
      present_people, extra_guests, comment, arrived_at, sale_number
    )
    select v_night_id, t.id, t.id, t.zone_id, t.head_waiter_id, t.head_waiter_id,
      new.present_people, new.extra_guests, new.comment, coalesce(new.arrived_at, now()), v_sale_number
    from public.tables t where t.id = v_table_id;
  else
    update public.table_visits
    set present_people = new.present_people, extra_guests = new.extra_guests, comment = new.comment, updated_at = now()
    where id = v_visit_id;
  end if;
  return new;
end;
$$;

-- Le transfert conserve la visite et ses champs V4 ; seul le CDR final suit la
-- table de destination afin de produire le bon récapitulatif de rang.
create or replace function public.transfer_operational_table(p_from_table_id uuid, p_to_table_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.table_visits;
  v_destination public.tables;
  v_destination_total integer;
begin
  if public.current_role()::text not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  if p_from_table_id = p_to_table_id then raise exception 'Destination must differ from source'; end if;
  perform 1 from public.tables where id in (p_from_table_id, p_to_table_id) order by id for update;
  if (select count(*) from public.tables where id in (p_from_table_id, p_to_table_id)) <> 2 then raise exception 'Table unavailable'; end if;
  select * into v_visit from public.table_visits where current_table_id = p_from_table_id and ended_at is null for update;
  if not found then raise exception 'No active sale on source table'; end if;
  if v_visit.present_people + v_visit.extra_guests < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.'; end if;
  select * into v_destination from public.tables where id = p_to_table_id and active for update;
  if not found then raise exception 'Destination unavailable'; end if;
  select present_people + extra_guests into v_destination_total from public.occupancies where table_id = p_to_table_id for update;
  if coalesce(v_destination_total, 0) > 0 then raise exception 'Destination is already occupied'; end if;
  if exists (select 1 from public.arrival_drafts where table_id = p_to_table_id and status = 'draft') then raise exception 'Destination has an arrival draft'; end if;
  if v_visit.present_people > v_destination.max_people or v_visit.extra_guests > v_destination.max_extra_guests then raise exception 'Destination capacity is insufficient'; end if;

  perform set_config('mazeout.transfer_in_progress', 'on', true);
  update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null where table_id = p_from_table_id;
  insert into public.occupancies(table_id, present_people, extra_guests, comment, arrived_at)
  values (p_to_table_id, v_visit.present_people, v_visit.extra_guests, v_visit.comment, now())
  on conflict (table_id) do update set present_people = excluded.present_people, extra_guests = excluded.extra_guests, comment = excluded.comment, arrived_at = excluded.arrived_at;
  update public.table_visits
  set current_table_id = p_to_table_id,
      final_head_waiter_id = v_destination.head_waiter_id,
      updated_at = now()
  where id = v_visit.id;
  insert into public.table_visit_transfers(night_session_id, table_visit_id, from_table_id, to_table_id, transferred_by)
  values (v_visit.night_session_id, v_visit.id, p_from_table_id, p_to_table_id, auth.uid());
  perform public.write_operational_audit(
    v_visit.night_session_id, 'table.transferred', 'table_visit', v_visit.id,
    jsonb_build_object('from_table_id', p_from_table_id, 'final_head_waiter_id', v_visit.final_head_waiter_id),
    jsonb_build_object('to_table_id', p_to_table_id, 'final_head_waiter_id', v_destination.head_waiter_id),
    jsonb_build_object('sale_number', v_visit.sale_number)
  );
  return v_visit.id;
end;
$$;

create or replace function public.validate_cdr_business_referrer(
  p_visit_id uuid,
  p_business_referrer_name text
)
returns public.table_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.table_visits;
  v_referrer public.business_referrers;
  v_previous_referrer_id uuid;
  v_previous_referrer_name text;
  v_name text;
  v_normalized_name text;
  v_action_type text;
begin
  if auth.uid() is null or public.current_role()::text <> 'cdr' then
    raise exception 'CDR access required';
  end if;

  v_name := nullif(btrim(regexp_replace(coalesce(p_business_referrer_name, ''), '\s+', ' ', 'g')), '');
  if v_name is null then raise exception 'Business referrer name is required'; end if;
  if char_length(v_name) > 300 then raise exception 'Business referrer name is too long'; end if;
  v_normalized_name := lower(v_name);

  select v.* into v_visit
  from public.table_visits v
  join public.tables t on t.id = v.current_table_id
  join public.night_sessions n on n.id = v.night_session_id
  where v.id = p_visit_id
    and v.ended_at is null
    and n.ended_at is null
    and t.head_waiter_id = public.cdr_head_waiter_id()
  for update of v;
  if not found then raise exception 'Active visit unavailable for this CDR'; end if;

  v_previous_referrer_id := v_visit.business_referrer_id;
  select name into v_previous_referrer_name
  from public.business_referrers
  where id = v_visit.business_referrer_id;

  select * into v_referrer
  from public.business_referrers
  where normalized_name = v_normalized_name
  for update;
  if found and not v_referrer.active then raise exception 'Business referrer is inactive'; end if;
  if not found then
    insert into public.business_referrers(name, normalized_name)
    values (v_name, v_normalized_name)
    returning * into v_referrer;
  end if;

  v_action_type := case when v_visit.business_referrer_id is null
    then 'cdr.business_referrer.validated'
    else 'cdr.business_referrer.corrected'
  end;

  update public.table_visits
  set business_referrer_id = v_referrer.id,
      business_referrer_validated_at = now(),
      business_referrer_validated_by = auth.uid(),
      updated_at = now()
  where id = v_visit.id
  returning * into v_visit;

  insert into public.operational_audit_log(
    night_session_id, actor_id, action_type, entity_type, entity_id, before_data, after_data, metadata
  ) values (
    v_visit.night_session_id, auth.uid(), v_action_type, 'table_visit', v_visit.id,
    jsonb_build_object('business_referrer_id', v_previous_referrer_id, 'business_referrer_name', v_previous_referrer_name),
    jsonb_build_object('business_referrer_id', v_referrer.id, 'business_referrer_name', v_referrer.name),
    jsonb_build_object(
      'current_table_id', v_visit.current_table_id,
      'sale_number', v_visit.sale_number,
      'proposed_business_referrer_name', v_visit.proposed_business_referrer_name,
      'final_head_waiter_id', v_visit.final_head_waiter_id
    )
  );
  return v_visit;
end;
$$;

revoke all on function public.prepare_arrival_draft_v4(uuid, smallint, smallint, text, text, text, text, text) from public, anon;
grant execute on function public.prepare_arrival_draft_v4(uuid, smallint, smallint, text, text, text, text, text) to authenticated;
revoke all on function public.save_business_referrer(uuid, text, boolean) from public, anon;
grant execute on function public.save_business_referrer(uuid, text, boolean) to authenticated;
revoke all on function public.validate_cdr_business_referrer(uuid, text) from public, anon;
grant execute on function public.validate_cdr_business_referrer(uuid, text) to authenticated;
