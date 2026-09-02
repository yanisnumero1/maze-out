-- Validation personnelle du rang CDR. La clôture Admin reste indépendante et
-- constitue le verrou global final sans créer de validation CDR artificielle.
create table if not exists public.cdr_rank_validations (
  id uuid primary key default gen_random_uuid(),
  night_session_id uuid not null references public.night_sessions(id) on delete restrict,
  head_waiter_id uuid not null references public.head_waiters(id) on delete restrict,
  validated_by uuid not null references public.profiles(id) on delete restrict,
  validated_at timestamptz not null default now(),
  unique (night_session_id, head_waiter_id)
);

alter table public.cdr_rank_validations enable row level security;
revoke all on table public.cdr_rank_validations from public, anon, authenticated;
grant select on table public.cdr_rank_validations to authenticated;

alter table public.operational_audit_log
  drop constraint if exists operational_audit_log_action_type_check;
alter table public.operational_audit_log
  add constraint operational_audit_log_action_type_check check (action_type in (
    'table.arrival_prepared', 'table.arrival_confirmed', 'table.arrival_modified', 'table.arrival_cancelled', 'table.sale_ended', 'table.transferred',
    'promoter.created', 'promoter.activity_added', 'promoter.activity_updated', 'promoter.activity_deleted', 'promoter.deleted',
    'floor_note.created', 'floor_note.updated', 'floor_note.deleted',
    'club_entry.created', 'club_entry.updated', 'club_entry.deleted', 'night.closed',
    'cdr.business_referrer.validated', 'cdr.business_referrer.corrected', 'cdr.rank.validated',
    'hostess.visit.v4_updated'
  ));

drop policy if exists "cdr reads own business referrer audit" on public.operational_audit_log;
create policy "cdr reads own business referrer audit"
on public.operational_audit_log for select to authenticated
using (
  public.current_role()::text = 'cdr'
  and actor_id = auth.uid()
  and action_type in ('cdr.business_referrer.validated', 'cdr.business_referrer.corrected', 'cdr.rank.validated')
);

drop policy if exists "admin reads cdr rank validations" on public.cdr_rank_validations;
create policy "admin reads cdr rank validations"
on public.cdr_rank_validations for select to authenticated
using (public.current_role()::text = 'admin');

drop policy if exists "cdr reads own rank validations" on public.cdr_rank_validations;
create policy "cdr reads own rank validations"
on public.cdr_rank_validations for select to authenticated
using (
  public.current_role()::text = 'cdr'
  and head_waiter_id = public.cdr_head_waiter_id()
);

create or replace function public.validate_cdr_rank()
returns public.cdr_rank_validations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_night_id uuid;
  v_head_waiter_id uuid;
  v_validation public.cdr_rank_validations;
begin
  if auth.uid() is null or public.current_role()::text <> 'cdr' then
    raise exception 'CDR access required';
  end if;

  v_head_waiter_id := public.cdr_head_waiter_id();
  if v_head_waiter_id is null then raise exception 'Operational CDR association required'; end if;

  select id into v_night_id
  from public.night_sessions
  where ended_at is null
  order by started_at desc
  limit 1
  for update;
  if v_night_id is null then raise exception 'No active night session'; end if;

  insert into public.cdr_rank_validations(night_session_id, head_waiter_id, validated_by)
  values (v_night_id, v_head_waiter_id, auth.uid())
  on conflict (night_session_id, head_waiter_id) do nothing
  returning * into v_validation;

  if v_validation.id is null then raise exception 'Rank already validated'; end if;

  insert into public.operational_audit_log(
    night_session_id, actor_id, action_type, entity_type, entity_id, before_data, after_data, metadata
  ) values (
    v_night_id, auth.uid(), 'cdr.rank.validated', 'head_waiter', v_head_waiter_id,
    null, jsonb_build_object('validated_at', v_validation.validated_at), null
  );
  return v_validation;
end;
$$;

create or replace function public.update_cdr_visit_notes(
  p_visit_id uuid,
  p_cdr_comment text default null,
  p_business_referrer text default null
)
returns public.table_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.table_visits;
  v_comment text;
  v_referrer text;
  v_head_waiter_id uuid;
begin
  if auth.uid() is null or public.current_role()::text <> 'cdr' then raise exception 'CDR access required'; end if;
  v_head_waiter_id := public.cdr_head_waiter_id();
  if v_head_waiter_id is null then raise exception 'Operational CDR association required'; end if;

  v_comment := nullif(btrim(coalesce(p_cdr_comment, '')), '');
  v_referrer := nullif(btrim(coalesce(p_business_referrer, '')), '');
  if char_length(coalesce(v_comment, '')) > 1000 then raise exception 'Comment is too long'; end if;
  if char_length(coalesce(v_referrer, '')) > 300 then raise exception 'Business referrer is too long'; end if;

  select v.* into v_visit
  from public.table_visits v
  join public.tables t on t.id = v.current_table_id
  join public.night_sessions n on n.id = v.night_session_id
  where v.id = p_visit_id
    and v.ended_at is null
    and n.ended_at is null
    and t.head_waiter_id = v_head_waiter_id
    and not exists (
      select 1 from public.cdr_rank_validations rv
      where rv.night_session_id = v.night_session_id
        and rv.head_waiter_id = v_head_waiter_id
    )
  for update of v;
  if not found then raise exception 'Active unvalidated visit unavailable for this CDR'; end if;

  update public.table_visits
  set cdr_comment = v_comment, business_referrer = v_referrer, updated_at = now()
  where id = v_visit.id
  returning * into v_visit;
  return v_visit;
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
  v_head_waiter_id uuid;
begin
  if auth.uid() is null or public.current_role()::text <> 'cdr' then raise exception 'CDR access required'; end if;
  v_head_waiter_id := public.cdr_head_waiter_id();
  if v_head_waiter_id is null then raise exception 'Operational CDR association required'; end if;

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
    and t.head_waiter_id = v_head_waiter_id
    and not exists (
      select 1 from public.cdr_rank_validations rv
      where rv.night_session_id = v.night_session_id
        and rv.head_waiter_id = v_head_waiter_id
    )
  for update of v;
  if not found then raise exception 'Active unvalidated visit unavailable for this CDR'; end if;

  v_previous_referrer_id := v_visit.business_referrer_id;
  select name into v_previous_referrer_name from public.business_referrers where id = v_previous_referrer_id;
  select * into v_referrer from public.business_referrers where normalized_name = v_normalized_name for update;
  if found and not v_referrer.active then raise exception 'Business referrer is inactive'; end if;
  if not found then
    insert into public.business_referrers(name, normalized_name)
    values (v_name, v_normalized_name)
    returning * into v_referrer;
  end if;

  v_action_type := case when v_previous_referrer_id is null then 'cdr.business_referrer.validated' else 'cdr.business_referrer.corrected' end;
  update public.table_visits
  set business_referrer_id = v_referrer.id,
      business_referrer_validated_at = now(),
      business_referrer_validated_by = auth.uid(),
      updated_at = now()
  where id = v_visit.id
  returning * into v_visit;

  insert into public.operational_audit_log(night_session_id, actor_id, action_type, entity_type, entity_id, before_data, after_data, metadata)
  values (
    v_visit.night_session_id, auth.uid(), v_action_type, 'table_visit', v_visit.id,
    jsonb_build_object('business_referrer_id', v_previous_referrer_id, 'business_referrer_name', v_previous_referrer_name),
    jsonb_build_object('business_referrer_id', v_referrer.id, 'business_referrer_name', v_referrer.name),
    jsonb_build_object('current_table_id', v_visit.current_table_id, 'sale_number', v_visit.sale_number, 'proposed_business_referrer_name', v_visit.proposed_business_referrer_name, 'final_head_waiter_id', v_visit.final_head_waiter_id)
  );
  return v_visit;
end;
$$;

create or replace function public.get_cdr_rank_status(p_night_session_id uuid default null)
returns table (
  night_session_id uuid,
  night_started_at timestamptz,
  night_ended_at timestamptz,
  night_status text,
  validated_at timestamptz,
  is_read_only boolean,
  validation_label text
)
language plpgsql
security definer
set search_path = public
as $$
declare v_head_waiter_id uuid;
begin
  if auth.uid() is null or public.current_role()::text <> 'cdr' then raise exception 'CDR access required'; end if;
  v_head_waiter_id := public.cdr_head_waiter_id();
  if v_head_waiter_id is null then raise exception 'Operational CDR association required'; end if;

  return query
  select n.id, n.started_at, n.ended_at,
    case when n.ended_at is null then 'active' else 'closed' end,
    rv.validated_at,
    n.ended_at is not null or rv.validated_at is not null,
    case
      when rv.validated_at is not null then 'Rang validé'
      when n.ended_at is not null then 'Non validé avant clôture'
      else 'À valider'
    end
  from public.night_sessions n
  left join public.cdr_rank_validations rv
    on rv.night_session_id = n.id and rv.head_waiter_id = v_head_waiter_id
  where (p_night_session_id is null or n.id = p_night_session_id)
    and (n.ended_at is null or rv.id is not null or exists (
      select 1 from public.table_visits v
      where v.night_session_id = n.id and v.final_head_waiter_id = v_head_waiter_id
    ))
  order by n.started_at desc;
end;
$$;

-- Étend le récap personnel avec la proposition Hôtesse nécessaire au PDF.
-- La proposition n'est utilisée que lorsqu'aucun apporteur canonique n'a été validé.
drop function public.get_cdr_rank_recap(uuid);

create function public.get_cdr_rank_recap(p_night_session_id uuid default null)
returns table (
  table_visit_id uuid,
  night_session_id uuid,
  night_started_at timestamptz,
  night_ended_at timestamptz,
  night_status text,
  source_table_number text,
  final_table_number text,
  sale_number integer,
  reservation_name text,
  consumption text,
  sale_comment text,
  cdr_comment text,
  business_referrer_name text,
  proposed_business_referrer_name text,
  arrived_at timestamptz,
  ended_at timestamptz,
  is_read_only boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare v_head_waiter_id uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated user required'; end if;
  if public.current_role()::text <> 'cdr' then raise exception 'CDR access required'; end if;
  v_head_waiter_id := public.cdr_head_waiter_id();
  if v_head_waiter_id is null then raise exception 'Operational CDR association required'; end if;

  return query
  select
    v.id,
    n.id,
    n.started_at,
    n.ended_at,
    case when n.ended_at is null then 'active' else 'closed' end,
    coalesce(nullif(btrim(source_table.display_number::text), ''), source_table.number),
    coalesce(nullif(btrim(final_table.display_number::text), ''), final_table.number),
    v.sale_number,
    v.reservation_name,
    v.consumption,
    v.sale_comment,
    v.cdr_comment,
    referrer.name,
    v.proposed_business_referrer_name,
    v.arrived_at,
    v.ended_at,
    n.ended_at is not null or rank_validation.validated_at is not null
  from public.table_visits v
  join public.night_sessions n on n.id = v.night_session_id
  join public.tables source_table on source_table.id = v.table_id
  left join public.tables final_table on final_table.id = coalesce(v.current_table_id, v.table_id)
  left join public.business_referrers referrer on referrer.id = v.business_referrer_id
  left join public.cdr_rank_validations rank_validation
    on rank_validation.night_session_id = v.night_session_id
   and rank_validation.head_waiter_id = v_head_waiter_id
  where v.final_head_waiter_id = v_head_waiter_id
    and (p_night_session_id is null or v.night_session_id = p_night_session_id)
  order by n.started_at desc, v.arrived_at desc, v.id desc;
end;
$$;

revoke all on function public.validate_cdr_rank() from public, anon;
grant execute on function public.validate_cdr_rank() to authenticated;
revoke all on function public.get_cdr_rank_status(uuid) from public, anon;
grant execute on function public.get_cdr_rank_status(uuid) to authenticated;
revoke all on function public.get_cdr_rank_recap(uuid) from public, anon;
grant execute on function public.get_cdr_rank_recap(uuid) to authenticated;
revoke all on function public.update_cdr_visit_notes(uuid, text, text) from public, anon;
grant execute on function public.update_cdr_visit_notes(uuid, text, text) to authenticated;
revoke all on function public.validate_cdr_business_referrer(uuid, text) from public, anon;
grant execute on function public.validate_cdr_business_referrer(uuid, text) to authenticated;
