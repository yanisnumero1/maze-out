-- Une arrivée, visite ou revente ne peut jamais être enregistrée sans client.
-- Les occupations à zéro restent autorisées exclusivement pour libérer une table.
create or replace function public.validate_positive_table_people()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.present_people, 0) + coalesce(new.extra_guests, 0) < 1 then
    raise exception 'Le nombre de personnes doit être au moins égal à 1.';
  end if;
  return new;
end;
$$;

drop trigger if exists arrival_drafts_require_people on public.arrival_drafts;
create trigger arrival_drafts_require_people
before insert or update of present_people, extra_guests on public.arrival_drafts
for each row execute function public.validate_positive_table_people();

drop trigger if exists table_visits_require_people on public.table_visits;
create trigger table_visits_require_people
before insert or update of present_people, extra_guests on public.table_visits
for each row execute function public.validate_positive_table_people();

create or replace function public.prepare_arrival_draft(p_table_id uuid, p_present_people smallint, p_extra_guests smallint, p_comment text default null)
returns public.arrival_drafts language plpgsql security definer set search_path = public as $$
declare v_draft public.arrival_drafts; v_night_id uuid;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  if coalesce(p_present_people, 0) + coalesce(p_extra_guests, 0) < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.'; end if;
  perform 1 from public.tables where id = p_table_id and active for update; if not found then raise exception 'Table unavailable'; end if;
  if exists (select 1 from public.occupancies where table_id = p_table_id and present_people + extra_guests > 0) then raise exception 'This table is already occupied'; end if;
  if exists (select 1 from public.arrival_drafts where table_id = p_table_id and status = 'draft' and actor_id <> auth.uid()) then raise exception 'This table is being prepared by another user'; end if;
  if exists (select 1 from public.tables where id = p_table_id and (p_present_people < 0 or p_present_people > max_people or p_extra_guests < 0 or p_extra_guests > max_extra_guests)) then raise exception 'Draft exceeds table capacity'; end if;
  v_night_id := public.open_night_session();
  update public.arrival_drafts set status = 'cancelled', updated_at = now() where actor_id = auth.uid() and status = 'draft';
  insert into public.arrival_drafts(table_id, actor_id, night_session_id, present_people, extra_guests, comment) values (p_table_id, auth.uid(), v_night_id, p_present_people, p_extra_guests, p_comment) returning * into v_draft;
  perform public.write_operational_audit(v_night_id, 'table.arrival_prepared', 'arrival_draft', v_draft.id, null, jsonb_build_object('table_id', v_draft.table_id, 'present_people', v_draft.present_people, 'extra_guests', v_draft.extra_guests, 'comment', v_draft.comment));
  return v_draft;
end;
$$;

create or replace function public.confirm_arrival_draft(p_draft_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_draft public.arrival_drafts; v_sale_number integer;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  select * into v_draft from public.arrival_drafts where id = p_draft_id and status = 'draft' and (actor_id = auth.uid() or public.current_role() = 'admin') for update;
  if not found then raise exception 'Draft already confirmed or unavailable'; end if;
  if v_draft.present_people + v_draft.extra_guests < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.'; end if;
  perform 1 from public.tables where id = v_draft.table_id and active for update;
  if exists (select 1 from public.occupancies where table_id = v_draft.table_id and present_people + extra_guests > 0) then raise exception 'This table has just been occupied by another user'; end if;
  if exists (select 1 from public.tables where id = v_draft.table_id and (v_draft.present_people > max_people or v_draft.extra_guests > max_extra_guests)) then raise exception 'Draft exceeds table capacity'; end if;
  insert into public.occupancies(table_id, present_people, extra_guests, comment, arrived_at)
  values (v_draft.table_id, v_draft.present_people, v_draft.extra_guests, v_draft.comment, now())
  on conflict (table_id) do update set present_people = excluded.present_people, extra_guests = excluded.extra_guests, comment = excluded.comment, arrived_at = excluded.arrived_at;
  select sale_number into v_sale_number from public.table_visits where table_id = v_draft.table_id and ended_at is null;
  update public.arrival_drafts set status = 'confirmed', confirmed_sale_number = v_sale_number, confirmed_at = now(), updated_at = now() where id = p_draft_id;
  return v_sale_number;
end;
$$;

create or replace function public.transfer_operational_table(p_from_table_id uuid, p_to_table_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_visit public.table_visits; v_destination public.tables; v_destination_total integer;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
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
  insert into public.occupancies(table_id, present_people, extra_guests, comment, arrived_at) values (p_to_table_id, v_visit.present_people, v_visit.extra_guests, v_visit.comment, now()) on conflict (table_id) do update set present_people = excluded.present_people, extra_guests = excluded.extra_guests, comment = excluded.comment, arrived_at = excluded.arrived_at;
  update public.table_visits set current_table_id = p_to_table_id, updated_at = now() where id = v_visit.id;
  insert into public.table_visit_transfers(night_session_id, table_visit_id, from_table_id, to_table_id, transferred_by) values (v_visit.night_session_id, v_visit.id, p_from_table_id, p_to_table_id, auth.uid());
  perform public.write_operational_audit(v_visit.night_session_id, 'table.transferred', 'table_visit', v_visit.id, jsonb_build_object('from_table_id', p_from_table_id), jsonb_build_object('to_table_id', p_to_table_id));
  return v_visit.id;
end;
$$;
