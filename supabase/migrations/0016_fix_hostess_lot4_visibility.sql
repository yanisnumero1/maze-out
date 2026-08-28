-- Les policies Lot 4 ne doivent pas interroger directement night_sessions sous RLS Hôtesse :
-- cette table est volontairement lisible seulement par l'Admin.
create or replace function public.is_active_night_session(p_night_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.night_sessions
    where id = p_night_session_id
      and ended_at is null
  );
$$;

grant execute on function public.is_active_night_session(uuid) to authenticated;

drop policy if exists "hostess reads active floor notes" on public.floor_notes;
create policy "hostess reads active floor notes"
on public.floor_notes
for select to authenticated
using (
  public.current_role() = 'hostess'
  and public.is_active_night_session(night_session_id)
);

drop policy if exists "hostess reads active promoters" on public.promoters;
create policy "hostess reads active promoters"
on public.promoters
for select to authenticated
using (
  public.current_role() = 'hostess'
  and public.is_active_night_session(night_session_id)
);

drop policy if exists "hostess reads active promoter events" on public.promoter_count_events;
create policy "hostess reads active promoter events"
on public.promoter_count_events
for select to authenticated
using (
  public.current_role() = 'hostess'
  and public.is_active_night_session(night_session_id)
);

drop policy if exists "hostess reads active club entry counts" on public.club_entry_counts;
create policy "hostess reads active club entry counts"
on public.club_entry_counts
for select to authenticated
using (
  public.current_role() = 'hostess'
  and public.is_active_night_session(night_session_id)
);
