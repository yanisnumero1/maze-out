-- Correctif non destructif du Lot 4 : expose explicitement les données et RPC
-- au rôle authentifié, sans élargir les politiques RLS existantes.
grant usage on schema public to authenticated;
grant select on public.floor_notes, public.promoters, public.promoter_count_events, public.club_entry_counts to authenticated;
grant execute on function public.current_operational_night_session() to authenticated;
grant execute on function public.add_floor_note(text) to authenticated;
grant execute on function public.update_floor_note(uuid, text) to authenticated;
grant execute on function public.delete_floor_note(uuid) to authenticated;
grant execute on function public.add_promoter(text) to authenticated;
grant execute on function public.set_promoter_count(uuid, integer) to authenticated;
grant execute on function public.record_club_entry_count(integer) to authenticated;
grant execute on function public.update_club_entry_count(uuid, integer) to authenticated;
grant execute on function public.delete_club_entry_count(uuid) to authenticated;

create or replace function public.delete_promoter(p_promoter_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_night_id uuid;
begin
  select night_session_id into v_night_id from public.promoters where id = p_promoter_id for update;
  if v_night_id is null then raise exception 'Promoter not found'; end if;
  perform public.assert_active_operational_session(v_night_id);
  delete from public.promoter_count_events where promoter_id = p_promoter_id;
  delete from public.promoters where id = p_promoter_id;
end;
$$;

grant execute on function public.delete_promoter(uuid) to authenticated;
