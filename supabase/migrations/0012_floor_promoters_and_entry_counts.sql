-- Lot 4 : journal Piste, compteurs Promoteurs et relevés cumulés d'Entrées club.
-- Toutes les données sont historisées par night_session et ne sont jamais supprimées à la clôture.
create table public.floor_notes (
  id uuid primary key default gen_random_uuid(),
  night_session_id uuid not null references public.night_sessions(id) on delete restrict,
  content text not null check (char_length(btrim(content)) between 1 and 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.promoters (
  id uuid primary key default gen_random_uuid(),
  night_session_id uuid not null references public.night_sessions(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  normalized_name text not null,
  entry_count integer not null default 0 check (entry_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (night_session_id, normalized_name)
);

create table public.promoter_count_events (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete restrict,
  night_session_id uuid not null references public.night_sessions(id) on delete restrict,
  previous_count integer not null check (previous_count >= 0),
  next_count integer not null check (next_count >= 0),
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.club_entry_counts (
  id uuid primary key default gen_random_uuid(),
  night_session_id uuid not null references public.night_sessions(id) on delete restrict,
  count integer not null check (count >= 0),
  recorded_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index floor_notes_night_created_idx on public.floor_notes(night_session_id, created_at desc);
create index promoters_night_idx on public.promoters(night_session_id, normalized_name);
create index promoter_events_night_idx on public.promoter_count_events(night_session_id, created_at desc);
create index club_entry_counts_night_recorded_idx on public.club_entry_counts(night_session_id, recorded_at desc);

alter table public.floor_notes enable row level security;
alter table public.promoters enable row level security;
alter table public.promoter_count_events enable row level security;
alter table public.club_entry_counts enable row level security;

create policy "admin reads floor notes" on public.floor_notes for select to authenticated using (public.current_role() = 'admin');
create policy "hostess reads active floor notes" on public.floor_notes for select to authenticated using (
  public.current_role() = 'hostess' and exists (select 1 from public.night_sessions n where n.id = night_session_id and n.ended_at is null)
);
create policy "admin reads promoters" on public.promoters for select to authenticated using (public.current_role() = 'admin');
create policy "hostess reads active promoters" on public.promoters for select to authenticated using (
  public.current_role() = 'hostess' and exists (select 1 from public.night_sessions n where n.id = night_session_id and n.ended_at is null)
);
create policy "admin reads promoter events" on public.promoter_count_events for select to authenticated using (public.current_role() = 'admin');
create policy "hostess reads active promoter events" on public.promoter_count_events for select to authenticated using (
  public.current_role() = 'hostess' and exists (select 1 from public.night_sessions n where n.id = night_session_id and n.ended_at is null)
);
create policy "admin reads club entry counts" on public.club_entry_counts for select to authenticated using (public.current_role() = 'admin');
create policy "hostess reads active club entry counts" on public.club_entry_counts for select to authenticated using (
  public.current_role() = 'hostess' and exists (select 1 from public.night_sessions n where n.id = night_session_id and n.ended_at is null)
);

create or replace function public.assert_operational_role()
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
end;
$$;

create or replace function public.assert_active_operational_session(p_night_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_operational_role();
  if not exists (select 1 from public.night_sessions where id = p_night_session_id and ended_at is null) then
    raise exception 'This night session is closed';
  end if;
end;
$$;

create or replace function public.current_operational_night_session()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_night_id uuid;
begin
  perform public.assert_operational_role();
  select id into v_night_id from public.night_sessions where ended_at is null limit 1;
  return v_night_id;
end;
$$;

create or replace function public.add_floor_note(p_content text)
returns public.floor_notes language plpgsql security definer set search_path = public as $$
declare v_note public.floor_notes; v_night_id uuid;
begin
  perform public.assert_operational_role();
  if char_length(btrim(coalesce(p_content, ''))) = 0 then raise exception 'A floor note cannot be empty'; end if;
  v_night_id := public.open_night_session();
  insert into public.floor_notes(night_session_id, content, created_by)
  values (v_night_id, btrim(p_content), auth.uid()) returning * into v_note;
  return v_note;
end;
$$;

create or replace function public.update_floor_note(p_note_id uuid, p_content text)
returns public.floor_notes language plpgsql security definer set search_path = public as $$
declare v_note public.floor_notes;
begin
  select * into v_note from public.floor_notes where id = p_note_id for update;
  if not found then raise exception 'Floor note not found'; end if;
  perform public.assert_active_operational_session(v_note.night_session_id);
  if char_length(btrim(coalesce(p_content, ''))) = 0 then raise exception 'A floor note cannot be empty'; end if;
  update public.floor_notes set content = btrim(p_content), updated_at = now() where id = p_note_id returning * into v_note;
  return v_note;
end;
$$;

create or replace function public.delete_floor_note(p_note_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_night_id uuid;
begin
  select night_session_id into v_night_id from public.floor_notes where id = p_note_id for update;
  if v_night_id is null then raise exception 'Floor note not found'; end if;
  perform public.assert_active_operational_session(v_night_id);
  delete from public.floor_notes where id = p_note_id;
end;
$$;

create or replace function public.add_promoter(p_name text)
returns public.promoters language plpgsql security definer set search_path = public as $$
declare v_promoter public.promoters; v_night_id uuid; v_normalized text;
begin
  perform public.assert_operational_role();
  v_normalized := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  if char_length(v_normalized) = 0 then raise exception 'A promoter name cannot be empty'; end if;
  v_night_id := public.open_night_session();
  insert into public.promoters(night_session_id, name, normalized_name, created_by)
  values (v_night_id, btrim(regexp_replace(p_name, '\s+', ' ', 'g')), v_normalized, auth.uid())
  on conflict (night_session_id, normalized_name) do update set updated_at = public.promoters.updated_at
  returning * into v_promoter;
  return v_promoter;
end;
$$;

create or replace function public.set_promoter_count(p_promoter_id uuid, p_entry_count integer)
returns public.promoters language plpgsql security definer set search_path = public as $$
declare v_promoter public.promoters; v_previous integer;
begin
  select * into v_promoter from public.promoters where id = p_promoter_id for update;
  if not found then raise exception 'Promoter not found'; end if;
  perform public.assert_active_operational_session(v_promoter.night_session_id);
  if p_entry_count < 0 then raise exception 'Promoter count cannot be negative'; end if;
  v_previous := v_promoter.entry_count;
  update public.promoters set entry_count = p_entry_count, updated_at = now() where id = p_promoter_id returning * into v_promoter;
  if v_previous <> p_entry_count then
    insert into public.promoter_count_events(promoter_id, night_session_id, previous_count, next_count, changed_by)
    values (v_promoter.id, v_promoter.night_session_id, v_previous, p_entry_count, auth.uid());
  end if;
  return v_promoter;
end;
$$;

create or replace function public.record_club_entry_count(p_count integer)
returns public.club_entry_counts language plpgsql security definer set search_path = public as $$
declare v_count public.club_entry_counts; v_night_id uuid;
begin
  perform public.assert_operational_role();
  if p_count < 0 then raise exception 'Club entry count cannot be negative'; end if;
  v_night_id := public.open_night_session();
  insert into public.club_entry_counts(night_session_id, count, created_by)
  values (v_night_id, p_count, auth.uid()) returning * into v_count;
  return v_count;
end;
$$;

create or replace function public.update_club_entry_count(p_entry_count_id uuid, p_count integer)
returns public.club_entry_counts language plpgsql security definer set search_path = public as $$
declare v_count public.club_entry_counts;
begin
  select * into v_count from public.club_entry_counts where id = p_entry_count_id for update;
  if not found then raise exception 'Club entry count not found'; end if;
  perform public.assert_active_operational_session(v_count.night_session_id);
  if p_count < 0 then raise exception 'Club entry count cannot be negative'; end if;
  update public.club_entry_counts set count = p_count, updated_at = now() where id = p_entry_count_id returning * into v_count;
  return v_count;
end;
$$;

create or replace function public.delete_club_entry_count(p_entry_count_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_night_id uuid;
begin
  select night_session_id into v_night_id from public.club_entry_counts where id = p_entry_count_id for update;
  if v_night_id is null then raise exception 'Club entry count not found'; end if;
  perform public.assert_active_operational_session(v_night_id);
  delete from public.club_entry_counts where id = p_entry_count_id;
end;
$$;

alter publication supabase_realtime add table public.floor_notes;
alter publication supabase_realtime add table public.promoters;
alter publication supabase_realtime add table public.club_entry_counts;
