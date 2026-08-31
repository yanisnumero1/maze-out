-- Enrichit le rapport figé sans modifier les données opérationnelles ni les historiques.
-- La version 0022 reste la source du contenu existant ; cette enveloppe y ajoute les analyses.
alter function public.build_night_report_snapshot(uuid) rename to build_night_report_snapshot_0022;

create function public.build_night_report_snapshot(p_night_session_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with base as (
    select public.build_night_report_snapshot_0022(p_night_session_id) as snapshot
  ), visits as (
    select v.* from public.table_visits as v where v.night_session_id = p_night_session_id
  ), table_rows as (
    select
      v.table_id,
      coalesce(t.display_number::text, v.table_id::text) as table_number,
      coalesce(z.name, '—') as zone_name,
      nullif(trim(concat_ws(' ', h.first_name, h.last_name)), '') as head_waiter_name,
      count(*)::integer as total_sales,
      coalesce(sum(v.present_people + v.extra_guests), 0)::integer as people_welcomed,
      coalesce(sum(v.extra_guests), 0)::integer as extra_guests
    from visits as v
    left join public.tables as t on t.id = v.table_id
    left join public.zones as z on z.id = v.zone_id
    left join public.head_waiters as h on h.id = v.head_waiter_id
    group by v.table_id, t.display_number, z.name, h.first_name, h.last_name
  ), zone_rows as (
    select
      z.id,
      z.name,
      count(v.id)::integer as total_sales,
      count(distinct v.table_id)::integer as tables_sold,
      coalesce(sum(v.present_people + v.extra_guests), 0)::integer as people_welcomed,
      greatest(count(v.id) - count(distinct v.table_id), 0)::integer as rotation_count
    from public.zones as z
    left join visits as v on v.zone_id = z.id
    where z.active or exists (select 1 from visits as legacy where legacy.zone_id = z.id)
    group by z.id, z.name
  ), waiter_rows as (
    select
      h.id,
      trim(concat_ws(' ', h.first_name, h.last_name)) as name,
      count(v.id)::integer as total_sales,
      count(distinct v.table_id)::integer as tables_sold,
      coalesce(sum(v.present_people + v.extra_guests), 0)::integer as people_welcomed,
      greatest(count(v.id) - count(distinct v.table_id), 0)::integer as rotation_count
    from public.head_waiters as h
    left join visits as v on v.head_waiter_id = h.id
    where exists (select 1 from visits as legacy where legacy.head_waiter_id = h.id)
    group by h.id, h.first_name, h.last_name
  ), promoter_rows as (
    select p.id, p.name, p.entry_count from public.promoters as p where p.night_session_id = p_night_session_id
  ), totals as (
    select
      count(*)::integer as total_sales,
      count(distinct table_id)::integer as distinct_tables_sold,
      greatest(count(*) - count(distinct table_id), 0)::integer as rotation_count,
      (select count(*)::integer from public.table_visit_transfers as tr where tr.night_session_id = p_night_session_id) as transfer_count,
      (select count(*)::integer from public.floor_notes as fn where fn.night_session_id = p_night_session_id) as floor_note_count,
      (select coalesce(sum(pr.entry_count), 0)::integer from promoter_rows as pr) as promoter_people
    from visits
  )
  select base.snapshot || jsonb_build_object(
    'analytics', jsonb_build_object(
      'total_sales', (select total_sales from totals),
      'distinct_tables_sold', (select distinct_tables_sold from totals),
      'rotation_count', (select rotation_count from totals),
      'transfer_count', (select transfer_count from totals),
      'floor_note_count', (select floor_note_count from totals),
      'promoter_people', (select promoter_people from totals)
    ),
    'performance', jsonb_build_object(
      'zones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'total_sales', total_sales, 'tables_sold', tables_sold, 'people_welcomed', people_welcomed, 'rotation_count', rotation_count) order by total_sales desc, name) from zone_rows), '[]'::jsonb),
      'head_waiters', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'total_sales', total_sales, 'tables_sold', tables_sold, 'people_welcomed', people_welcomed, 'rotation_count', rotation_count) order by total_sales desc, name) from waiter_rows), '[]'::jsonb)
    ),
    'top_tables', coalesce((select jsonb_agg(jsonb_build_object('table_id', table_id, 'table_number', table_number, 'zone_name', zone_name, 'head_waiter_name', head_waiter_name, 'total_sales', total_sales, 'people_welcomed', people_welcomed, 'extra_guests', extra_guests, 'rotation_count', greatest(total_sales - 1, 0)) order by total_sales desc, table_number) from (select * from table_rows order by total_sales desc, table_number limit 10) as ranked_tables), '[]'::jsonb),
    'top_people_tables', coalesce((select jsonb_agg(jsonb_build_object('table_id', table_id, 'table_number', table_number, 'zone_name', zone_name, 'head_waiter_name', head_waiter_name, 'total_sales', total_sales, 'people_welcomed', people_welcomed, 'extra_guests', extra_guests, 'rotation_count', greatest(total_sales - 1, 0)) order by people_welcomed desc, table_number) from (select * from table_rows order by people_welcomed desc, table_number limit 10) as ranked_people_tables), '[]'::jsonb),
    'promoters_ranked', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'people_welcomed', entry_count) order by entry_count desc, name) from promoter_rows), '[]'::jsonb)
  )
  from base;
$$;

revoke all on function public.build_night_report_snapshot(uuid) from public, anon, authenticated;
