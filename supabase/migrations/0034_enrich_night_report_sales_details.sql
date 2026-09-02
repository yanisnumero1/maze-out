-- Fige le détail V4 de chaque vente lors de la clôture, sans modifier les snapshots existants.
alter function public.build_night_report_snapshot(uuid) rename to build_night_report_snapshot_0029;

create function public.build_night_report_snapshot(p_night_session_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with base as (
    select public.build_night_report_snapshot_0029(p_night_session_id) as snapshot
  ), sales_detail_rows as (
    select
      v.id as visit_id,
      v.sale_number,
      v.table_id as origin_table_id,
      coalesce(nullif(btrim(origin_table.display_number::text), ''), nullif(btrim(origin_table.number), ''), v.table_id::text) as origin_table_number,
      coalesce(v.current_table_id, v.table_id) as final_table_id,
      coalesce(nullif(btrim(final_table.display_number::text), ''), nullif(btrim(final_table.number), ''), coalesce(v.current_table_id, v.table_id)::text) as final_table_number,
      v.final_head_waiter_id,
      nullif(btrim(concat_ws(' ', final_waiter.first_name, final_waiter.last_name)), '') as final_head_waiter_name,
      v.reservation_name,
      v.consumption,
      v.sale_comment,
      v.cdr_comment,
      v.proposed_business_referrer_name,
      v.business_referrer_id,
      referrer.name as business_referrer_name,
      v.arrived_at
    from public.table_visits as v
    left join public.tables as origin_table on origin_table.id = v.table_id
    left join public.tables as final_table on final_table.id = coalesce(v.current_table_id, v.table_id)
    left join public.head_waiters as final_waiter on final_waiter.id = v.final_head_waiter_id
    left join public.business_referrers as referrer on referrer.id = v.business_referrer_id
    where v.night_session_id = p_night_session_id
  )
  select base.snapshot || jsonb_build_object(
    'sales_details', coalesce((
      select jsonb_agg(jsonb_build_object(
        'visit_id', visit_id,
        'sale_number', sale_number,
        'origin_table_id', origin_table_id,
        'origin_table_number', origin_table_number,
        'final_table_id', final_table_id,
        'final_table_number', final_table_number,
        'final_head_waiter_id', final_head_waiter_id,
        'final_head_waiter_name', final_head_waiter_name,
        'reservation_name', reservation_name,
        'consumption', consumption,
        'sale_comment', sale_comment,
        'cdr_comment', cdr_comment,
        'proposed_business_referrer_name', proposed_business_referrer_name,
        'business_referrer_id', business_referrer_id,
        'business_referrer_name', business_referrer_name
      ) order by arrived_at, sale_number nulls last, visit_id)
      from sales_detail_rows
    ), '[]'::jsonb)
  )
  from base;
$$;

revoke all on function public.build_night_report_snapshot(uuid) from public, anon, authenticated;
