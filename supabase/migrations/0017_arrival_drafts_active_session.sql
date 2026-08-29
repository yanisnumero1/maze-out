-- Les brouillons font partie de l'opérationnel de la soirée courante : les
-- rattacher explicitement évite qu'un brouillon non confirmé réapparaisse le
-- soir suivant. Les anciennes lignes restent conservées pour audit.
alter table public.arrival_drafts
  add column if not exists night_session_id uuid references public.night_sessions(id) on delete restrict;

create index if not exists arrival_drafts_night_session_idx
  on public.arrival_drafts(night_session_id);

-- Seuls les brouillons encore ouverts au moment de la migration peuvent être
-- rattachés à la soirée en cours. Sans soirée ouverte, ils sont forcément des
-- restes d'une opération antérieure et ne doivent plus bloquer ni réapparaître.
update public.arrival_drafts
set night_session_id = (
  select id from public.night_sessions where ended_at is null limit 1
)
where status = 'draft'
  and night_session_id is null
  and exists (select 1 from public.night_sessions where ended_at is null);

update public.arrival_drafts
set status = 'cancelled', updated_at = now()
where status = 'draft'
  and night_session_id is null;

create or replace function public.prepare_arrival_draft(p_table_id uuid, p_present_people smallint, p_extra_guests smallint, p_comment text default null)
returns public.arrival_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.arrival_drafts;
  v_night_id uuid;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  perform 1 from public.tables where id = p_table_id and active for update;
  if not found then raise exception 'Table unavailable'; end if;
  if exists (select 1 from public.occupancies where table_id = p_table_id and present_people + extra_guests > 0) then raise exception 'This table is already occupied'; end if;
  if exists (select 1 from public.arrival_drafts where table_id = p_table_id and status = 'draft' and actor_id <> auth.uid()) then raise exception 'This table is being prepared by another user'; end if;
  if exists (select 1 from public.tables where id = p_table_id and (p_present_people < 0 or p_present_people > max_people or p_extra_guests < 0 or p_extra_guests > max_extra_guests)) then raise exception 'Draft exceeds table capacity'; end if;

  v_night_id := public.open_night_session();
  update public.arrival_drafts
  set status = 'cancelled', updated_at = now()
  where actor_id = auth.uid() and status = 'draft';
  insert into public.arrival_drafts(table_id, actor_id, night_session_id, present_people, extra_guests, comment)
  values (p_table_id, auth.uid(), v_night_id, p_present_people, p_extra_guests, p_comment)
  returning * into v_draft;
  return v_draft;
end;
$$;

create or replace function public.cancel_arrival_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.arrival_drafts;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  select * into v_draft
  from public.arrival_drafts
  where id = p_draft_id
    and status = 'draft'
    and public.is_active_night_session(night_session_id)
  for update;
  if not found then raise exception 'Draft already confirmed, cancelled or unavailable'; end if;

  -- Le statut conserve une trace d'audit sans créer de visite, vente ou occupation.
  update public.arrival_drafts
  set status = 'cancelled', updated_at = now()
  where id = v_draft.id;
end;
$$;

-- À la clôture, les brouillons non confirmés de cette soirée cessent d'être
-- opérationnels avant que la session soit figée.
create or replace function public.close_current_night_session()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.current_role() <> 'admin' then raise exception 'Admin access required'; end if;
  select id into v_id from public.night_sessions where ended_at is null limit 1 for update;
  if v_id is null then raise exception 'No active night session'; end if;

  update public.table_visits set ended_at = now(), updated_at = now()
  where night_session_id = v_id and ended_at is null;
  update public.arrival_drafts set status = 'cancelled', updated_at = now()
  where night_session_id = v_id and status = 'draft';
  update public.occupancies o
  set present_people = 0, extra_guests = 0, comment = null, arrived_at = null, updated_at = now()
  from public.tables t where o.table_id = t.id and t.active = true;
  update public.reservations set status = 'completed', updated_at = now()
  where status in ('reserved', 'arrived');
  update public.night_sessions set ended_at = now() where id = v_id;
end;
$$;

drop policy if exists "hostess reads arrival drafts" on public.arrival_drafts;
create policy "hostess reads active arrival drafts"
on public.arrival_drafts
for select to authenticated
using (
  public.current_role() = 'hostess'
  and status = 'draft'
  and public.is_active_night_session(night_session_id)
);

revoke all on function public.cancel_arrival_draft(uuid) from public;
grant execute on function public.cancel_arrival_draft(uuid) to authenticated;
