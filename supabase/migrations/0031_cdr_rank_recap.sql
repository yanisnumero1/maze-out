-- Récapitulatif historique strictement limité au CDR final de chaque vente.
-- La lecture passe par cette RPC afin de ne pas élargir les RLS de table_visits.
create or replace function public.get_cdr_rank_recap(
  p_night_session_id uuid default null
)
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
  business_referrer_name text,
  arrived_at timestamptz,
  ended_at timestamptz,
  is_read_only boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_head_waiter_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required';
  end if;

  if public.current_role()::text <> 'cdr' then
    raise exception 'CDR access required';
  end if;

  select p.head_waiter_id
    into v_head_waiter_id
  from public.profiles as p
  where p.id = auth.uid()
    and p.role::text = 'cdr';

  if v_head_waiter_id is null then
    raise exception 'Operational CDR association required';
  end if;

  -- p_night_session_id est uniquement un filtre. Une soirée étrangère renvoie
  -- donc zéro ligne, sans permettre de connaître les ventes d'un autre CDR.
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
    referrer.name,
    v.arrived_at,
    v.ended_at,
    n.ended_at is not null
  from public.table_visits as v
  join public.night_sessions as n on n.id = v.night_session_id
  join public.tables as source_table on source_table.id = v.table_id
  left join public.tables as final_table on final_table.id = coalesce(v.current_table_id, v.table_id)
  left join public.business_referrers as referrer on referrer.id = v.business_referrer_id
  where v.final_head_waiter_id = v_head_waiter_id
    and (p_night_session_id is null or v.night_session_id = p_night_session_id)
  order by n.started_at desc, v.arrived_at desc, v.id desc;
end;
$$;

revoke all on function public.get_cdr_rank_recap(uuid) from public, anon;
grant execute on function public.get_cdr_rank_recap(uuid) to authenticated;
