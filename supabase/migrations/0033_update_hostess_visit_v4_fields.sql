-- Mise à jour ciblée des données de vente saisies par l'Hôtesse après confirmation.
-- Les champs CDR et l'apporteur canonique restent strictement hors de cette RPC.

alter table public.operational_audit_log
  drop constraint if exists operational_audit_log_action_type_check;
alter table public.operational_audit_log
  add constraint operational_audit_log_action_type_check check (action_type in (
    'table.arrival_prepared', 'table.arrival_confirmed', 'table.arrival_modified', 'table.arrival_cancelled', 'table.sale_ended', 'table.transferred',
    'promoter.created', 'promoter.activity_added', 'promoter.activity_updated', 'promoter.activity_deleted', 'promoter.deleted',
    'floor_note.created', 'floor_note.updated', 'floor_note.deleted',
    'club_entry.created', 'club_entry.updated', 'club_entry.deleted', 'night.closed',
    'cdr.business_referrer.validated', 'cdr.business_referrer.corrected',
    'hostess.visit.v4_updated'
  ));

create or replace function public.update_hostess_visit_v4_fields(
  p_visit_id uuid,
  p_reservation_name text default null,
  p_consumption text default null,
  p_sale_comment text default null,
  p_proposed_business_referrer_name text default null
)
returns public.table_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.table_visits;
  v_reservation_name text := nullif(btrim(coalesce(p_reservation_name, '')), '');
  v_consumption text := nullif(btrim(coalesce(p_consumption, '')), '');
  v_sale_comment text := nullif(btrim(coalesce(p_sale_comment, '')), '');
  v_proposed_referrer text := nullif(btrim(regexp_replace(coalesce(p_proposed_business_referrer_name, ''), '\s+', ' ', 'g')), '');
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required';
  end if;
  if public.current_role()::text not in ('admin', 'hostess') then
    raise exception 'Operational access required';
  end if;
  if char_length(coalesce(v_reservation_name, '')) > 300 then raise exception 'Reservation name is too long'; end if;
  if char_length(coalesce(v_consumption, '')) > 1000 then raise exception 'Consumption is too long'; end if;
  if char_length(coalesce(v_sale_comment, '')) > 1000 then raise exception 'Sale comment is too long'; end if;
  if char_length(coalesce(v_proposed_referrer, '')) > 300 then raise exception 'Business referrer proposal is too long'; end if;

  select v.* into v_visit
  from public.table_visits as v
  join public.night_sessions as n on n.id = v.night_session_id
  where v.id = p_visit_id
    and v.ended_at is null
    and n.ended_at is null
  for update of v;
  if not found then
    raise exception 'Active visit unavailable';
  end if;

  v_before := jsonb_build_object(
    'reservation_name', v_visit.reservation_name,
    'consumption', v_visit.consumption,
    'sale_comment', v_visit.sale_comment,
    'proposed_business_referrer_name', v_visit.proposed_business_referrer_name
  );

  update public.table_visits
  set reservation_name = v_reservation_name,
      consumption = v_consumption,
      sale_comment = v_sale_comment,
      proposed_business_referrer_name = v_proposed_referrer,
      updated_at = now()
  where id = v_visit.id
  returning * into v_visit;

  v_after := jsonb_build_object(
    'reservation_name', v_visit.reservation_name,
    'consumption', v_visit.consumption,
    'sale_comment', v_visit.sale_comment,
    'proposed_business_referrer_name', v_visit.proposed_business_referrer_name
  );
  perform public.write_operational_audit(
    v_visit.night_session_id,
    'hostess.visit.v4_updated',
    'table_visit',
    v_visit.id,
    v_before,
    v_after,
    jsonb_build_object(
      'visit_id', v_visit.id,
      'current_table_id', v_visit.current_table_id,
      'sale_number', v_visit.sale_number
    )
  );
  return v_visit;
end;
$$;

revoke all on function public.update_hostess_visit_v4_fields(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_hostess_visit_v4_fields(uuid, text, text, text, text) to authenticated;
