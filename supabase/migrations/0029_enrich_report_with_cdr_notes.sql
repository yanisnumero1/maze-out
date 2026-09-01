-- Extends the frozen closing report. Existing reports remain unchanged and readable.
alter function public.build_night_report_snapshot(uuid) rename to build_night_report_snapshot_0025;

create function public.build_night_report_snapshot(p_night_session_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with base as (
    select public.build_night_report_snapshot_0025(p_night_session_id) as snapshot
  ), visits as (
    select v.* from public.table_visits as v where v.night_session_id = p_night_session_id
  ), cdr_visit_rows as (
    select
      v.id as visit_id,
      coalesce(nullif(btrim(t.display_number::text), ''), nullif(btrim(t.number), ''), v.table_id::text) as table_number,
      v.sale_number,
      nullif(trim(concat_ws(' ', h.first_name, h.last_name)), '') as head_waiter_name,
      (v.present_people + v.extra_guests)::integer as people_welcomed,
      nullif(btrim(v.business_referrer), '') as business_referrer,
      nullif(btrim(v.cdr_comment), '') as cdr_comment,
      v.arrived_at
    from visits as v
    left join public.tables as t on t.id = v.table_id
    left join public.head_waiters as h on h.id = v.head_waiter_id
    where nullif(btrim(v.business_referrer), '') is not null
       or nullif(btrim(v.cdr_comment), '') is not null
  ), referrer_rows as (
    select
      lower(btrim(v.business_referrer)) as normalized_name,
      (array_agg(btrim(v.business_referrer) order by v.arrived_at))[1] as name,
      count(*)::integer as total_sales,
      coalesce(sum(v.present_people + v.extra_guests), 0)::integer as people_welcomed
    from visits as v
    where nullif(btrim(v.business_referrer), '') is not null
    group by lower(btrim(v.business_referrer))
  )
  select base.snapshot || jsonb_build_object(
    'business_referrers_ranked', coalesce((
      select jsonb_agg(jsonb_build_object(
        'normalized_name', normalized_name,
        'name', name,
        'total_sales', total_sales,
        'people_welcomed', people_welcomed
      ) order by people_welcomed desc, total_sales desc, name)
      from referrer_rows
    ), '[]'::jsonb),
    'cdr_visit_notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'visit_id', visit_id,
        'table_number', table_number,
        'sale_number', sale_number,
        'head_waiter_name', head_waiter_name,
        'people_welcomed', people_welcomed,
        'business_referrer', business_referrer,
        'cdr_comment', cdr_comment,
        'arrived_at', arrived_at
      ) order by arrived_at, sale_number nulls last)
      from cdr_visit_rows
    ), '[]'::jsonb)
  )
  from base;
$$;

revoke all on function public.build_night_report_snapshot(uuid) from public, anon, authenticated;
