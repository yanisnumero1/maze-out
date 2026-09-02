-- Corrige les libellés humains des tables et le classement des apporteurs V4
-- dans les futurs snapshots, sans modifier les rapports déjà figés.
alter function public.build_night_report_snapshot(uuid) rename to build_night_report_snapshot_0034;

create function public.build_night_report_snapshot(p_night_session_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with base as (
    select public.build_night_report_snapshot_0034(p_night_session_id) as snapshot
  ), visits as (
    select v.*
    from public.table_visits as v
    where v.night_session_id = p_night_session_id
  ), table_rows as (
    select
      v.table_id,
      coalesce(
        nullif(btrim(t.display_number::text), ''),
        nullif(btrim(t.number), ''),
        '—'
      ) as table_number,
      coalesce(z.name, '—') as zone_name,
      nullif(btrim(concat_ws(' ', h.first_name, h.last_name)), '') as head_waiter_name,
      count(*)::integer as total_sales,
      coalesce(sum(v.present_people + v.extra_guests), 0)::integer as people_welcomed,
      coalesce(sum(v.extra_guests), 0)::integer as extra_guests
    from visits as v
    left join public.tables as t on t.id = v.table_id
    left join public.zones as z on z.id = v.zone_id
    left join public.head_waiters as h on h.id = v.head_waiter_id
    group by v.table_id, t.display_number, t.number, z.name, h.first_name, h.last_name
  ), sales_detail_rows as (
    select
      v.id as visit_id,
      v.sale_number,
      v.table_id as origin_table_id,
      coalesce(nullif(btrim(origin_table.display_number::text), ''), nullif(btrim(origin_table.number), ''), '—') as origin_table_number,
      coalesce(v.current_table_id, v.table_id) as final_table_id,
      coalesce(nullif(btrim(final_table.display_number::text), ''), nullif(btrim(final_table.number), ''), '—') as final_table_number,
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
    from visits as v
    left join public.tables as origin_table on origin_table.id = v.table_id
    left join public.tables as final_table on final_table.id = coalesce(v.current_table_id, v.table_id)
    left join public.head_waiters as final_waiter on final_waiter.id = v.final_head_waiter_id
    left join public.business_referrers as referrer on referrer.id = v.business_referrer_id
  ), referrer_source as (
    -- Source officielle V4 : seule une FK validée compte comme apporteur.
    select
      v.id as visit_id,
      coalesce(nullif(btrim(r.normalized_name), ''), lower(btrim(r.name))) as normalized_name,
      r.name,
      true as is_official,
      (v.present_people + v.extra_guests)::integer as people_welcomed,
      v.arrived_at
    from visits as v
    join public.business_referrers as r on r.id = v.business_referrer_id
    where v.business_referrer_id is not null

    union all

    -- Compatibilité avec les ventes antérieures au modèle V4.
    select
      v.id as visit_id,
      lower(btrim(v.business_referrer)) as normalized_name,
      btrim(v.business_referrer) as name,
      false as is_official,
      (v.present_people + v.extra_guests)::integer as people_welcomed,
      v.arrived_at
    from visits as v
    where v.business_referrer_id is null
      and nullif(btrim(v.business_referrer), '') is not null
  ), referrer_rows as (
    select
      normalized_name,
      (array_agg(name order by is_official desc, arrived_at, visit_id))[1] as name,
      count(*)::integer as total_sales,
      coalesce(sum(people_welcomed), 0)::integer as people_welcomed
    from referrer_source
    group by normalized_name
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
    ), '[]'::jsonb),
    'top_tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_id', table_id,
        'table_number', table_number,
        'zone_name', zone_name,
        'head_waiter_name', head_waiter_name,
        'total_sales', total_sales,
        'people_welcomed', people_welcomed,
        'extra_guests', extra_guests,
        'rotation_count', greatest(total_sales - 1, 0)
      ) order by total_sales desc, table_number)
      from (select * from table_rows order by total_sales desc, table_number limit 10) as ranked_tables
    ), '[]'::jsonb),
    'top_people_tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_id', table_id,
        'table_number', table_number,
        'zone_name', zone_name,
        'head_waiter_name', head_waiter_name,
        'total_sales', total_sales,
        'people_welcomed', people_welcomed,
        'extra_guests', extra_guests,
        'rotation_count', greatest(total_sales - 1, 0)
      ) order by people_welcomed desc, table_number)
      from (select * from table_rows order by people_welcomed desc, table_number limit 10) as ranked_people_tables
    ), '[]'::jsonb),
    'business_referrers_ranked', coalesce((
      select jsonb_agg(jsonb_build_object(
        'normalized_name', normalized_name,
        'name', name,
        'total_sales', total_sales,
        'people_welcomed', people_welcomed
      ) order by people_welcomed desc, total_sales desc, name)
      from referrer_rows
    ), '[]'::jsonb)
  )
  from base;
$$;

revoke all on function public.build_night_report_snapshot(uuid) from public, anon, authenticated;
