-- Montant financier saisi par le CDR, distinct de la note texte historique.
alter table public.table_visits
  add column if not exists cdr_amount numeric(12,2)
  constraint table_visits_cdr_amount_non_negative check (cdr_amount >= 0);

-- Le snapshot fige le récap personnel au checkpoint CDR. Les validations
-- historiques restent nulles et continuent d'être résolues dynamiquement.
alter table public.cdr_rank_validations
  add column if not exists recap_snapshot jsonb;

create or replace function public.update_cdr_visit_amount(
  p_visit_id uuid,
  p_cdr_amount numeric
)
returns public.table_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.table_visits;
  v_head_waiter_id uuid;
begin
  if auth.uid() is null or public.current_role()::text <> 'cdr' then raise exception 'CDR access required'; end if;
  v_head_waiter_id := public.cdr_head_waiter_id();
  if v_head_waiter_id is null then raise exception 'Operational CDR association required'; end if;
  if p_cdr_amount is not null and p_cdr_amount < 0 then raise exception 'Le montant ne peut pas être négatif'; end if;
  if p_cdr_amount is not null and p_cdr_amount > 9999999999.99 then raise exception 'Le montant est trop élevé'; end if;

  select v.* into v_visit
  from public.table_visits v
  join public.night_sessions n on n.id = v.night_session_id
  where v.id = p_visit_id
    and v.ended_at is null
    and n.ended_at is null
    and v.final_head_waiter_id = v_head_waiter_id
    and not exists (
      select 1 from public.cdr_rank_validations rv
      where rv.night_session_id = v.night_session_id
        and rv.head_waiter_id = v_head_waiter_id
    )
  for update of v;
  if not found then raise exception 'Active unvalidated visit unavailable for this CDR'; end if;

  update public.table_visits
  set cdr_amount = p_cdr_amount, updated_at = now()
  where id = v_visit.id
  returning * into v_visit;
  return v_visit;
end;
$$;

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
  v_snapshot jsonb;
begin
  if auth.uid() is null or public.current_role()::text <> 'cdr' then raise exception 'CDR access required'; end if;
  v_head_waiter_id := public.cdr_head_waiter_id();
  if v_head_waiter_id is null then raise exception 'Operational CDR association required'; end if;

  select id into v_night_id
  from public.night_sessions
  where ended_at is null
  order by started_at desc
  limit 1
  for update;
  if v_night_id is null then raise exception 'No active night session'; end if;

  perform 1 from public.table_visits v
  where v.night_session_id = v_night_id and v.final_head_waiter_id = v_head_waiter_id
  for update;

  if exists (
    select 1 from public.table_visits v
    where v.night_session_id = v_night_id
      and v.final_head_waiter_id = v_head_waiter_id
      and v.cdr_amount < 0
  ) then raise exception 'Certaines sommes sont invalides.'; end if;

  if exists (
    select 1 from public.table_visits v
    where v.night_session_id = v_night_id
      and v.final_head_waiter_id = v_head_waiter_id
      and v.cdr_amount > 0
      and v.business_referrer_id is null
  ) then raise exception 'Certaines sommes ne sont rattachées à aucun apporteur d’affaires.'; end if;

  select jsonb_build_object(
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_visit_id', v.id,
        'source_table_number', coalesce(nullif(btrim(source_table.display_number::text), ''), source_table.number),
        'final_table_number', coalesce(nullif(btrim(final_table.display_number::text), ''), final_table.number),
        'sale_number', v.sale_number,
        'reservation_name', v.reservation_name,
        'consumption', v.consumption,
        'sale_comment', v.sale_comment,
        'cdr_comment', v.cdr_comment,
        'cdr_amount', v.cdr_amount,
        'business_referrer_id', v.business_referrer_id,
        'business_referrer_name', referrer.name,
        'proposed_business_referrer_name', v.proposed_business_referrer_name,
        'arrived_at', v.arrived_at,
        'ended_at', v.ended_at
      ) order by v.arrived_at, v.id)
      from public.table_visits v
      join public.tables source_table on source_table.id = v.table_id
      left join public.tables final_table on final_table.id = coalesce(v.current_table_id, v.table_id)
      left join public.business_referrers referrer on referrer.id = v.business_referrer_id
      where v.night_session_id = v_night_id and v.final_head_waiter_id = v_head_waiter_id
    ), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_referrer_id', totals.business_referrer_id,
        'business_referrer_name', totals.business_referrer_name,
        'sale_count', totals.sale_count,
        'total_amount', totals.total_amount
      ) order by totals.total_amount desc, totals.business_referrer_name)
      from (
        select v.business_referrer_id, referrer.name as business_referrer_name,
          count(*)::integer as sale_count, coalesce(sum(v.cdr_amount), 0)::numeric(12,2) as total_amount
        from public.table_visits v
        join public.business_referrers referrer on referrer.id = v.business_referrer_id
        where v.night_session_id = v_night_id and v.final_head_waiter_id = v_head_waiter_id
        group by v.business_referrer_id, referrer.name
      ) totals
    ), '[]'::jsonb),
    'total_amount', coalesce((
      select sum(v.cdr_amount) from public.table_visits v
      where v.night_session_id = v_night_id and v.final_head_waiter_id = v_head_waiter_id
        and v.business_referrer_id is not null
    ), 0)::numeric(12,2)
  ) into v_snapshot;

  insert into public.cdr_rank_validations(night_session_id, head_waiter_id, validated_by, recap_snapshot)
  values (v_night_id, v_head_waiter_id, auth.uid(), v_snapshot)
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
  cdr_amount numeric,
  business_referrer_id uuid,
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
  if auth.uid() is null or public.current_role()::text <> 'cdr' then raise exception 'CDR access required'; end if;
  v_head_waiter_id := public.cdr_head_waiter_id();
  if v_head_waiter_id is null then raise exception 'Operational CDR association required'; end if;

  return query
  with recap_rows as (
    select v.id, n.id as night_id, n.started_at, n.ended_at as night_ended,
      coalesce(nullif(btrim(source_table.display_number::text), ''), source_table.number) as source_number,
      coalesce(nullif(btrim(final_table.display_number::text), ''), final_table.number) as final_number,
      v.sale_number, v.reservation_name, v.consumption, v.sale_comment, v.cdr_comment, v.cdr_amount,
      v.business_referrer_id, referrer.name as referrer_name, v.proposed_business_referrer_name,
      v.arrived_at, v.ended_at as sale_ended, n.ended_at is not null or rv.validated_at is not null as read_only
    from public.table_visits v
    join public.night_sessions n on n.id = v.night_session_id
    join public.tables source_table on source_table.id = v.table_id
    left join public.tables final_table on final_table.id = coalesce(v.current_table_id, v.table_id)
    left join public.business_referrers referrer on referrer.id = v.business_referrer_id
    left join public.cdr_rank_validations rv on rv.night_session_id = v.night_session_id and rv.head_waiter_id = v_head_waiter_id
    where v.final_head_waiter_id = v_head_waiter_id
      and rv.recap_snapshot is null
      and (p_night_session_id is null or v.night_session_id = p_night_session_id)

    union all

    select s.table_visit_id, n.id, n.started_at, n.ended_at,
      s.source_table_number, s.final_table_number, s.sale_number, s.reservation_name, s.consumption,
      s.sale_comment, s.cdr_comment, s.cdr_amount, s.business_referrer_id, s.business_referrer_name,
      s.proposed_business_referrer_name, s.arrived_at, s.ended_at, true
    from public.cdr_rank_validations rv
    join public.night_sessions n on n.id = rv.night_session_id
    cross join lateral jsonb_to_recordset(rv.recap_snapshot -> 'sales') as s(
      table_visit_id uuid, source_table_number text, final_table_number text, sale_number integer,
      reservation_name text, consumption text, sale_comment text, cdr_comment text, cdr_amount numeric,
      business_referrer_id uuid, business_referrer_name text, proposed_business_referrer_name text,
      arrived_at timestamptz, ended_at timestamptz
    )
    where rv.head_waiter_id = v_head_waiter_id
      and rv.recap_snapshot is not null
      and (p_night_session_id is null or rv.night_session_id = p_night_session_id)
  )
  select r.id, r.night_id, r.started_at, r.night_ended,
    case when r.night_ended is null then 'active' else 'closed' end,
    r.source_number, r.final_number, r.sale_number, r.reservation_name, r.consumption,
    r.sale_comment, r.cdr_comment, r.cdr_amount, r.business_referrer_id, r.referrer_name,
    r.proposed_business_referrer_name, r.arrived_at, r.sale_ended, r.read_only
  from recap_rows r
  order by r.started_at desc, r.arrived_at desc, r.id desc;
end;
$$;

revoke all on function public.update_cdr_visit_amount(uuid, numeric) from public, anon;
grant execute on function public.update_cdr_visit_amount(uuid, numeric) to authenticated;
revoke all on function public.get_cdr_rank_recap(uuid) from public, anon;
grant execute on function public.get_cdr_rank_recap(uuid) to authenticated;
