-- Journal d'audit opérationnel centralisé. Les données historiques existantes ne sont pas backfillées.
create table public.operational_audit_log (
  id uuid primary key default gen_random_uuid(),
  night_session_id uuid not null references public.night_sessions(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action_type text not null check (action_type in (
    'table.arrival_prepared', 'table.arrival_confirmed', 'table.arrival_modified', 'table.arrival_cancelled', 'table.sale_ended', 'table.transferred',
    'promoter.created', 'promoter.activity_added', 'promoter.activity_updated', 'promoter.activity_deleted', 'promoter.deleted',
    'floor_note.created', 'floor_note.updated', 'floor_note.deleted',
    'club_entry.created', 'club_entry.updated', 'club_entry.deleted', 'night.closed'
  )),
  entity_type text not null,
  entity_id uuid,
  created_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb
);

create index operational_audit_night_created_idx on public.operational_audit_log(night_session_id, created_at desc);
create index operational_audit_actor_idx on public.operational_audit_log(actor_id, created_at desc);
create index operational_audit_entity_idx on public.operational_audit_log(entity_type, entity_id, created_at desc);

alter table public.operational_audit_log enable row level security;
create policy "admin reads operational audit" on public.operational_audit_log for select to authenticated using (public.current_role() = 'admin');
create policy "hostess reads active operational audit" on public.operational_audit_log for select to authenticated using (
  public.current_role() = 'hostess' and public.is_active_night_session(night_session_id)
);

create or replace function public.write_operational_audit(
  p_night_session_id uuid, p_action_type text, p_entity_type text, p_entity_id uuid default null,
  p_before_data jsonb default null, p_after_data jsonb default null, p_metadata jsonb default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.assert_operational_role();
  if not exists (select 1 from public.night_sessions where id = p_night_session_id) then raise exception 'Night session not found'; end if;
  insert into public.operational_audit_log(night_session_id, actor_id, action_type, entity_type, entity_id, before_data, after_data, metadata)
  values (p_night_session_id, auth.uid(), p_action_type, p_entity_type, p_entity_id, p_before_data, p_after_data, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

-- Expose seulement l'identité métier des auteurs réellement liés à une action de la soirée active.
create or replace function public.get_operational_actor_profiles(p_actor_ids uuid[])
returns table(id uuid, first_name text, last_name text, role public.app_role)
language plpgsql security definer set search_path = public as $$
declare v_role public.app_role; v_active_night uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_role := public.current_role();
  if v_role not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  if v_role = 'admin' then
    return query select p.id, p.first_name, p.last_name, p.role from public.profiles p where p.id = any(coalesce(p_actor_ids, '{}'::uuid[]));
    return;
  end if;
  select n.id into v_active_night from public.night_sessions n where n.ended_at is null limit 1;
  if v_active_night is null then return; end if;
  return query
  select p.id, p.first_name, p.last_name, p.role
  from public.profiles p
  where p.id = any(coalesce(p_actor_ids, '{}'::uuid[]))
    and exists (select 1 from public.operational_audit_log a where a.night_session_id = v_active_night and a.actor_id = p.id);
end;
$$;

-- Toute écriture d'occupation est attribuée au véritable utilisateur, y compris depuis TableEditor.
create or replace function public.audit_occupancy_operation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_table_id uuid; v_night_id uuid; v_before jsonb; v_after jsonb; v_action text;
begin
  if current_setting('mazeout.audit_suppressed', true) = 'on' or current_setting('mazeout.transfer_in_progress', true) = 'on' or auth.uid() is null then return coalesce(new, old); end if;
  v_table_id := coalesce(new.table_id, old.table_id);
  select night_session_id into v_night_id from public.table_visits where current_table_id = v_table_id order by arrived_at desc limit 1;
  if v_night_id is null then select id into v_night_id from public.night_sessions where ended_at is null limit 1; end if;
  if v_night_id is null then return coalesce(new, old); end if;
  v_before := case when old is null then null else jsonb_build_object('present_people', old.present_people, 'extra_guests', old.extra_guests, 'comment', old.comment) end;
  v_after := case when new is null then null else jsonb_build_object('present_people', new.present_people, 'extra_guests', new.extra_guests, 'comment', new.comment) end;
  v_action := case when coalesce(new.present_people, 0) + coalesce(new.extra_guests, 0) = 0 then 'table.sale_ended' when coalesce(old.present_people, 0) + coalesce(old.extra_guests, 0) = 0 then 'table.arrival_confirmed' else 'table.arrival_modified' end;
  perform public.write_operational_audit(v_night_id, v_action, 'table', v_table_id, v_before, v_after, null);
  return coalesce(new, old);
end;
$$;
drop trigger if exists occupancy_operation_audit on public.occupancies;
create trigger occupancy_operation_audit after insert or update or delete on public.occupancies for each row execute function public.audit_occupancy_operation();

create or replace function public.add_floor_note(p_content text)
returns public.floor_notes language plpgsql security definer set search_path = public as $$
declare v_note public.floor_notes; v_night_id uuid;
begin
  perform public.assert_operational_role();
  if char_length(btrim(coalesce(p_content, ''))) = 0 then raise exception 'A floor note cannot be empty'; end if;
  v_night_id := public.open_night_session();
  insert into public.floor_notes(night_session_id, content, created_by) values (v_night_id, btrim(p_content), auth.uid()) returning * into v_note;
  perform public.write_operational_audit(v_night_id, 'floor_note.created', 'floor_note', v_note.id, null, jsonb_build_object('content', v_note.content));
  return v_note;
end;
$$;
create or replace function public.update_floor_note(p_note_id uuid, p_content text)
returns public.floor_notes language plpgsql security definer set search_path = public as $$
declare v_note public.floor_notes; v_before jsonb;
begin
  select * into v_note from public.floor_notes where id = p_note_id for update;
  if not found then raise exception 'Floor note not found'; end if;
  perform public.assert_active_operational_session(v_note.night_session_id);
  if char_length(btrim(coalesce(p_content, ''))) = 0 then raise exception 'A floor note cannot be empty'; end if;
  v_before := jsonb_build_object('content', v_note.content);
  update public.floor_notes set content = btrim(p_content), updated_at = now() where id = p_note_id returning * into v_note;
  perform public.write_operational_audit(v_note.night_session_id, 'floor_note.updated', 'floor_note', v_note.id, v_before, jsonb_build_object('content', v_note.content));
  return v_note;
end;
$$;
create or replace function public.delete_floor_note(p_note_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_note public.floor_notes;
begin
  select * into v_note from public.floor_notes where id = p_note_id for update;
  if not found then raise exception 'Floor note not found'; end if;
  perform public.assert_active_operational_session(v_note.night_session_id);
  perform public.write_operational_audit(v_note.night_session_id, 'floor_note.deleted', 'floor_note', v_note.id, jsonb_build_object('content', v_note.content), null);
  delete from public.floor_notes where id = v_note.id;
end;
$$;

create or replace function public.add_promoter(p_name text)
returns public.promoters language plpgsql security definer set search_path = public as $$
declare v_promoter public.promoters; v_night_id uuid; v_normalized text; v_was_existing boolean;
begin
  perform public.assert_operational_role();
  v_normalized := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  if char_length(v_normalized) = 0 then raise exception 'A promoter name cannot be empty'; end if;
  v_night_id := public.open_night_session();
  select exists(select 1 from public.promoters where night_session_id = v_night_id and normalized_name = v_normalized) into v_was_existing;
  insert into public.promoters(night_session_id, name, normalized_name, created_by) values (v_night_id, btrim(regexp_replace(p_name, '\s+', ' ', 'g')), v_normalized, auth.uid()) on conflict (night_session_id, normalized_name) do update set updated_at = public.promoters.updated_at returning * into v_promoter;
  if not v_was_existing then perform public.write_operational_audit(v_night_id, 'promoter.created', 'promoter', v_promoter.id, null, jsonb_build_object('name', v_promoter.name)); end if;
  return v_promoter;
end;
$$;

create or replace function public.record_club_entry_count(p_count integer)
returns public.club_entry_counts language plpgsql security definer set search_path = public as $$
declare v_count public.club_entry_counts; v_night_id uuid;
begin
  perform public.assert_operational_role(); if p_count < 0 then raise exception 'Club entry count cannot be negative'; end if;
  v_night_id := public.open_night_session();
  insert into public.club_entry_counts(night_session_id, count, created_by) values (v_night_id, p_count, auth.uid()) returning * into v_count;
  perform public.write_operational_audit(v_night_id, 'club_entry.created', 'club_entry', v_count.id, null, jsonb_build_object('count', v_count.count));
  return v_count;
end;
$$;
create or replace function public.update_club_entry_count(p_entry_count_id uuid, p_count integer)
returns public.club_entry_counts language plpgsql security definer set search_path = public as $$
declare v_count public.club_entry_counts; v_before jsonb;
begin
  select * into v_count from public.club_entry_counts where id = p_entry_count_id for update;
  if not found then raise exception 'Club entry count not found'; end if; perform public.assert_active_operational_session(v_count.night_session_id); if p_count < 0 then raise exception 'Club entry count cannot be negative'; end if;
  v_before := jsonb_build_object('count', v_count.count);
  update public.club_entry_counts set count = p_count, updated_at = now() where id = p_entry_count_id returning * into v_count;
  perform public.write_operational_audit(v_count.night_session_id, 'club_entry.updated', 'club_entry', v_count.id, v_before, jsonb_build_object('count', v_count.count));
  return v_count;
end;
$$;
create or replace function public.delete_club_entry_count(p_entry_count_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_count public.club_entry_counts;
begin
  select * into v_count from public.club_entry_counts where id = p_entry_count_id for update;
  if not found then raise exception 'Club entry count not found'; end if; perform public.assert_active_operational_session(v_count.night_session_id);
  perform public.write_operational_audit(v_count.night_session_id, 'club_entry.deleted', 'club_entry', v_count.id, jsonb_build_object('count', v_count.count), null);
  delete from public.club_entry_counts where id = v_count.id;
end;
$$;

-- The existing operations continue to be the source of truth; audit rows are appended in the same transaction.
create or replace function public.add_promoter_activity(p_promoter_id uuid, p_people_added integer, p_note text default null)
returns public.promoter_count_events language plpgsql security definer set search_path = public as $$
declare v_promoter public.promoters; v_event public.promoter_count_events; v_note text; v_next_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if; perform public.assert_operational_role(); if coalesce(p_people_added, 0) <= 0 then raise exception 'People added must be greater than zero'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), ''); if v_note is not null and char_length(v_note) > 500 then raise exception 'Promoter activity note is too long'; end if;
  select * into v_promoter from public.promoters where id = p_promoter_id for update; if not found then raise exception 'Promoter not found'; end if; perform public.assert_active_operational_session(v_promoter.night_session_id);
  v_next_count := v_promoter.entry_count + p_people_added; update public.promoters set entry_count = v_next_count, updated_at = now() where id = v_promoter.id;
  insert into public.promoter_count_events(promoter_id, night_session_id, previous_count, next_count, people_added, note, changed_by) values (v_promoter.id, v_promoter.night_session_id, v_promoter.entry_count, v_next_count, p_people_added, v_note, auth.uid()) returning * into v_event;
  perform public.write_operational_audit(v_promoter.night_session_id, 'promoter.activity_added', 'promoter_activity', v_event.id, null, jsonb_build_object('promoter_id', v_promoter.id, 'people_added', v_event.people_added, 'note', v_event.note));
  return v_event;
end;
$$;
create or replace function public.update_promoter_activity(p_event_id uuid, p_people_added integer, p_note text default null)
returns public.promoter_count_events language plpgsql security definer set search_path = public as $$
declare v_event public.promoter_count_events; v_promoter public.promoters; v_note text; v_delta integer; v_before jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if; perform public.assert_operational_role(); if coalesce(p_people_added, 0) <= 0 then raise exception 'People added must be greater than zero'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), ''); if v_note is not null and char_length(v_note) > 500 then raise exception 'Promoter activity note is too long'; end if;
  select * into v_event from public.promoter_count_events where id = p_event_id for update; if not found then raise exception 'Promoter activity not found'; end if; if v_event.people_added is null then raise exception 'Legacy counter events cannot be edited as arrivals'; end if;
  select * into v_promoter from public.promoters where id = v_event.promoter_id for update; if not found then raise exception 'Promoter not found'; end if; perform public.assert_active_operational_session(v_promoter.night_session_id);
  v_before := jsonb_build_object('people_added', v_event.people_added, 'note', v_event.note); v_delta := p_people_added - v_event.people_added; if v_promoter.entry_count + v_delta < 0 then raise exception 'Promoter count cannot be negative'; end if;
  update public.promoters set entry_count = entry_count + v_delta, updated_at = now() where id = v_promoter.id;
  update public.promoter_count_events set people_added = p_people_added, note = v_note, changed_by = auth.uid(), next_count = previous_count + p_people_added where id = v_event.id returning * into v_event;
  update public.promoter_count_events set previous_count = previous_count + v_delta, next_count = next_count + v_delta where promoter_id = v_promoter.id and people_added is not null and (created_at > v_event.created_at or (created_at = v_event.created_at and id > v_event.id));
  perform public.write_operational_audit(v_promoter.night_session_id, 'promoter.activity_updated', 'promoter_activity', v_event.id, v_before, jsonb_build_object('promoter_id', v_promoter.id, 'people_added', v_event.people_added, 'note', v_event.note));
  return v_event;
end;
$$;
create or replace function public.delete_promoter_activity(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_event public.promoter_count_events; v_promoter public.promoters;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if; perform public.assert_operational_role(); select * into v_event from public.promoter_count_events where id = p_event_id for update;
  if not found then raise exception 'Promoter activity not found'; end if; if v_event.people_added is null then raise exception 'Legacy counter events cannot be deleted as arrivals'; end if;
  select * into v_promoter from public.promoters where id = v_event.promoter_id for update; if not found then raise exception 'Promoter not found'; end if; perform public.assert_active_operational_session(v_promoter.night_session_id);
  if v_promoter.entry_count < v_event.people_added then raise exception 'Promoter count cannot be negative'; end if; update public.promoters set entry_count = entry_count - v_event.people_added, updated_at = now() where id = v_promoter.id;
  perform public.write_operational_audit(v_promoter.night_session_id, 'promoter.activity_deleted', 'promoter_activity', v_event.id, jsonb_build_object('promoter_id', v_promoter.id, 'people_added', v_event.people_added, 'note', v_event.note), null);
  delete from public.promoter_count_events where id = v_event.id; update public.promoter_count_events set previous_count = previous_count - v_event.people_added, next_count = next_count - v_event.people_added where promoter_id = v_promoter.id and people_added is not null and (created_at > v_event.created_at or (created_at = v_event.created_at and id > v_event.id));
end;
$$;

create or replace function public.delete_promoter(p_promoter_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_promoter public.promoters;
begin
  select * into v_promoter from public.promoters where id = p_promoter_id for update; if not found then raise exception 'Promoter not found'; end if; perform public.assert_active_operational_session(v_promoter.night_session_id);
  perform public.write_operational_audit(v_promoter.night_session_id, 'promoter.deleted', 'promoter', v_promoter.id, jsonb_build_object('name', v_promoter.name, 'entry_count', v_promoter.entry_count), null);
  delete from public.promoter_count_events where promoter_id = v_promoter.id; delete from public.promoters where id = v_promoter.id;
end;
$$;

create or replace function public.prepare_arrival_draft(p_table_id uuid, p_present_people smallint, p_extra_guests smallint, p_comment text default null)
returns public.arrival_drafts language plpgsql security definer set search_path = public as $$
declare v_draft public.arrival_drafts; v_night_id uuid;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
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
create or replace function public.cancel_arrival_draft(p_draft_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_draft public.arrival_drafts;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  select * into v_draft from public.arrival_drafts where id = p_draft_id and status = 'draft' and public.is_active_night_session(night_session_id) for update;
  if not found then raise exception 'Draft already confirmed, cancelled or unavailable'; end if;
  perform public.write_operational_audit(v_draft.night_session_id, 'table.arrival_cancelled', 'arrival_draft', v_draft.id, jsonb_build_object('table_id', v_draft.table_id, 'present_people', v_draft.present_people, 'extra_guests', v_draft.extra_guests, 'comment', v_draft.comment), null);
  update public.arrival_drafts set status = 'cancelled', updated_at = now() where id = v_draft.id;
end;
$$;
create or replace function public.move_arrival_draft(p_draft_id uuid, p_table_id uuid)
returns public.arrival_drafts language plpgsql security definer set search_path = public as $$
declare v_draft public.arrival_drafts; v_before jsonb;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  select * into v_draft from public.arrival_drafts where id = p_draft_id and status = 'draft' and (actor_id = auth.uid() or public.current_role() = 'admin') for update;
  if not found then raise exception 'Draft unavailable'; end if;
  perform 1 from public.tables where id = p_table_id and active for update; if not found then raise exception 'Table unavailable'; end if;
  if exists (select 1 from public.occupancies where table_id = p_table_id and present_people + extra_guests > 0) or exists (select 1 from public.arrival_drafts where table_id = p_table_id and status = 'draft' and id <> p_draft_id) then raise exception 'Destination unavailable'; end if;
  if exists (select 1 from public.tables where id = p_table_id and (v_draft.present_people > max_people or v_draft.extra_guests > max_extra_guests)) then raise exception 'The selected table does not support this group'; end if;
  v_before := jsonb_build_object('table_id', v_draft.table_id);
  update public.arrival_drafts set table_id = p_table_id, updated_at = now() where id = p_draft_id returning * into v_draft;
  perform public.write_operational_audit(v_draft.night_session_id, 'table.arrival_modified', 'arrival_draft', v_draft.id, v_before, jsonb_build_object('table_id', v_draft.table_id));
  return v_draft;
end;
$$;
create or replace function public.release_operational_table(p_table_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_visit public.table_visits;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  perform 1 from public.tables where id = p_table_id and active for update; if not found then raise exception 'Table unavailable'; end if;
  select * into v_visit from public.table_visits where current_table_id = p_table_id and ended_at is null order by arrived_at desc limit 1 for update;
  perform set_config('mazeout.audit_suppressed', 'on', true);
  update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null where table_id = p_table_id;
  if v_visit.id is not null then perform public.write_operational_audit(v_visit.night_session_id, 'table.sale_ended', 'table_visit', v_visit.id, jsonb_build_object('table_id', p_table_id), null); end if;
end;
$$;

create or replace function public.transfer_operational_table(p_from_table_id uuid, p_to_table_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_visit public.table_visits; v_destination public.tables; v_destination_total integer;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if; if p_from_table_id = p_to_table_id then raise exception 'Destination must differ from source'; end if;
  perform 1 from public.tables where id in (p_from_table_id, p_to_table_id) order by id for update; if (select count(*) from public.tables where id in (p_from_table_id, p_to_table_id)) <> 2 then raise exception 'Table unavailable'; end if;
  select * into v_visit from public.table_visits where current_table_id = p_from_table_id and ended_at is null for update; if not found then raise exception 'No active sale on source table'; end if;
  select * into v_destination from public.tables where id = p_to_table_id and active for update; if not found then raise exception 'Destination unavailable'; end if;
  select present_people + extra_guests into v_destination_total from public.occupancies where table_id = p_to_table_id for update; if coalesce(v_destination_total, 0) > 0 then raise exception 'Destination is already occupied'; end if;
  if exists (select 1 from public.arrival_drafts where table_id = p_to_table_id and status = 'draft') then raise exception 'Destination has an arrival draft'; end if; if v_visit.present_people > v_destination.max_people or v_visit.extra_guests > v_destination.max_extra_guests then raise exception 'Destination capacity is insufficient'; end if;
  perform set_config('mazeout.transfer_in_progress', 'on', true); update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null where table_id = p_from_table_id;
  insert into public.occupancies(table_id, present_people, extra_guests, comment, arrived_at) values (p_to_table_id, v_visit.present_people, v_visit.extra_guests, v_visit.comment, now()) on conflict (table_id) do update set present_people = excluded.present_people, extra_guests = excluded.extra_guests, comment = excluded.comment, arrived_at = excluded.arrived_at;
  update public.table_visits set current_table_id = p_to_table_id, updated_at = now() where id = v_visit.id;
  insert into public.table_visit_transfers(night_session_id, table_visit_id, from_table_id, to_table_id, transferred_by) values (v_visit.night_session_id, v_visit.id, p_from_table_id, p_to_table_id, auth.uid());
  perform public.write_operational_audit(v_visit.night_session_id, 'table.transferred', 'table_visit', v_visit.id, jsonb_build_object('from_table_id', p_from_table_id), jsonb_build_object('to_table_id', p_to_table_id));
  return v_visit.id;
end;
$$;

create or replace function public.close_current_night_session()
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_open_tables integer;
begin
  if public.current_role() <> 'admin' then raise exception 'Admin access required'; end if;
  select id into v_id from public.night_sessions where ended_at is null limit 1 for update; if v_id is null then raise exception 'No active night session'; end if;
  select count(*) into v_open_tables from public.table_visits where night_session_id = v_id and ended_at is null;
  perform public.write_operational_audit(v_id, 'night.closed', 'night_session', v_id, null, null, jsonb_build_object('open_tables_closed', v_open_tables));
  perform set_config('mazeout.audit_suppressed', 'on', true);
  update public.table_visits set ended_at = now(), updated_at = now() where night_session_id = v_id and ended_at is null;
  update public.arrival_drafts set status = 'cancelled', updated_at = now() where night_session_id = v_id and status = 'draft';
  update public.occupancies o set present_people = 0, extra_guests = 0, comment = null, arrived_at = null, updated_at = now() from public.tables t where o.table_id = t.id and t.active = true;
  update public.reservations set status = 'completed', updated_at = now() where status in ('reserved', 'arrived'); update public.night_sessions set ended_at = now() where id = v_id;
end;
$$;

-- A test-data reset must clear its own audit rows as well, otherwise the reset is not coherent.
create or replace function public.reset_test_operational_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() <> 'admin' then raise exception 'Admin access required'; end if;
  perform set_config('mazeout.audit_suppressed', 'on', true);
  delete from public.operational_audit_log where id is not null;
  delete from public.promoter_count_events where id is not null; delete from public.floor_notes where id is not null; delete from public.club_entry_counts where id is not null; delete from public.promoters where id is not null;
  delete from public.arrival_drafts where id is not null; delete from public.table_visit_transfers where id is not null; delete from public.table_visits where id is not null; delete from public.reservations where id is not null;
  update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null, updated_at = now() where table_id is not null;
  delete from public.activity_log where id is not null; delete from public.night_sessions where id is not null;
  if (select count(*) from public.tables where active) <> 72 then raise exception 'Expected 72 active tables'; end if;
  if (select count(*) from public.head_waiters where active) <> 9 then raise exception 'Expected 9 active head waiters'; end if;
  if (select count(distinct display_number) from public.tables where active) <> 72
     or (select min(display_number) from public.tables where active) <> 1
     or (select max(display_number) from public.tables where active) <> 72
     or exists (select 1 from generate_series(1, 72) n where not exists (select 1 from public.tables t where t.active and t.display_number = n)) then
    raise exception 'Active display numbers must be exactly 1 to 72';
  end if;
  if (select max_capacity from public.zones where active and display_order = 1) <> 264
     or (select max_capacity from public.zones where active and display_order = 2) <> 261
     or (select max_capacity from public.zones where active and display_order = 3) <> 138
     or (select max_capacity from public.zones where active and display_order = 4) <> 101 then
    raise exception 'Zone capacities are invalid';
  end if;
end;
$$;

revoke all on table public.operational_audit_log from public, anon, authenticated;
grant select on public.operational_audit_log to authenticated;
revoke all on function public.write_operational_audit(uuid, text, text, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.get_operational_actor_profiles(uuid[]) from public, anon;
grant execute on function public.get_operational_actor_profiles(uuid[]) to authenticated;
alter publication supabase_realtime add table public.operational_audit_log;
