-- Promoteurs : journal d'arrivées incrémentales.
-- Les événements hérités conservent people_added à NULL : ils restent des corrections
-- de compteur historiques et ne sont jamais présentés comme des arrivées réelles.
alter table public.promoter_count_events
  add column if not exists people_added integer,
  add column if not exists note text;

alter table public.promoter_count_events
  drop constraint if exists promoter_count_events_people_added_positive,
  add constraint promoter_count_events_people_added_positive
    check (people_added is null or people_added > 0),
  add constraint promoter_count_events_note_length
    check (note is null or char_length(note) <= 500);

create index if not exists promoter_events_promoter_created_idx
  on public.promoter_count_events(promoter_id, created_at desc);

create or replace function public.add_promoter_activity(
  p_promoter_id uuid,
  p_people_added integer,
  p_note text default null
)
returns public.promoter_count_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promoter public.promoters;
  v_event public.promoter_count_events;
  v_note text;
  v_next_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.assert_operational_role();
  if coalesce(p_people_added, 0) <= 0 then raise exception 'People added must be greater than zero'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then raise exception 'Promoter activity note is too long'; end if;

  select * into v_promoter from public.promoters where id = p_promoter_id for update;
  if not found then raise exception 'Promoter not found'; end if;
  perform public.assert_active_operational_session(v_promoter.night_session_id);

  v_next_count := v_promoter.entry_count + p_people_added;
  update public.promoters
  set entry_count = v_next_count, updated_at = now()
  where id = v_promoter.id;

  insert into public.promoter_count_events(
    promoter_id, night_session_id, previous_count, next_count, people_added, note, changed_by
  ) values (
    v_promoter.id, v_promoter.night_session_id, v_promoter.entry_count, v_next_count,
    p_people_added, v_note, auth.uid()
  ) returning * into v_event;
  return v_event;
end;
$$;

create or replace function public.update_promoter_activity(
  p_event_id uuid,
  p_people_added integer,
  p_note text default null
)
returns public.promoter_count_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.promoter_count_events;
  v_promoter public.promoters;
  v_note text;
  v_delta integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.assert_operational_role();
  if coalesce(p_people_added, 0) <= 0 then raise exception 'People added must be greater than zero'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then raise exception 'Promoter activity note is too long'; end if;

  select * into v_event from public.promoter_count_events where id = p_event_id for update;
  if not found then raise exception 'Promoter activity not found'; end if;
  if v_event.people_added is null then raise exception 'Legacy counter events cannot be edited as arrivals'; end if;
  select * into v_promoter from public.promoters where id = v_event.promoter_id for update;
  if not found then raise exception 'Promoter not found'; end if;
  perform public.assert_active_operational_session(v_promoter.night_session_id);

  v_delta := p_people_added - v_event.people_added;
  if v_promoter.entry_count + v_delta < 0 then raise exception 'Promoter count cannot be negative'; end if;
  update public.promoters set entry_count = entry_count + v_delta, updated_at = now() where id = v_promoter.id;
  update public.promoter_count_events
  set people_added = p_people_added,
      note = v_note,
      next_count = previous_count + p_people_added
  where id = v_event.id
  returning * into v_event;

  -- Migration chronology guarantees legacy rows predate activity rows. Keep those
  -- original records untouched; propagate the delta only through later activities.
  update public.promoter_count_events
  set previous_count = previous_count + v_delta,
      next_count = next_count + v_delta
  where promoter_id = v_promoter.id
    and people_added is not null
    and (created_at > v_event.created_at or (created_at = v_event.created_at and id > v_event.id));
  return v_event;
end;
$$;

create or replace function public.delete_promoter_activity(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.promoter_count_events;
  v_promoter public.promoters;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.assert_operational_role();
  select * into v_event from public.promoter_count_events where id = p_event_id for update;
  if not found then raise exception 'Promoter activity not found'; end if;
  if v_event.people_added is null then raise exception 'Legacy counter events cannot be deleted as arrivals'; end if;
  select * into v_promoter from public.promoters where id = v_event.promoter_id for update;
  if not found then raise exception 'Promoter not found'; end if;
  perform public.assert_active_operational_session(v_promoter.night_session_id);
  if v_promoter.entry_count < v_event.people_added then raise exception 'Promoter count cannot be negative'; end if;

  update public.promoters
  set entry_count = entry_count - v_event.people_added, updated_at = now()
  where id = v_promoter.id;
  delete from public.promoter_count_events where id = v_event.id;
  update public.promoter_count_events
  set previous_count = previous_count - v_event.people_added,
      next_count = next_count - v_event.people_added
  where promoter_id = v_promoter.id
    and people_added is not null
    and (created_at > v_event.created_at or (created_at = v_event.created_at and id > v_event.id));
end;
$$;

revoke all on function public.add_promoter_activity(uuid, integer, text) from public;
revoke all on function public.update_promoter_activity(uuid, integer, text) from public;
revoke all on function public.delete_promoter_activity(uuid) from public;
-- The old absolute-counter RPC would create ambiguous legacy events after this migration.
revoke execute on function public.set_promoter_count(uuid, integer) from authenticated;
grant execute on function public.add_promoter_activity(uuid, integer, text) to authenticated;
grant execute on function public.update_promoter_activity(uuid, integer, text) to authenticated;
grant execute on function public.delete_promoter_activity(uuid) to authenticated;

alter publication supabase_realtime add table public.promoter_count_events;
