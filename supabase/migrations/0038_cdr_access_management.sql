-- Gestion sécurisée des accès CDR : unicité du rattachement, verrou RLS lors
-- d'une désactivation et audit administratif hors contexte de soirée.

alter table public.profiles
  add column if not exists cdr_access_disabled_at timestamptz;

do $$
begin
  if exists (
    select 1
    from public.profiles
    where role::text = 'cdr' and head_waiter_id is not null
    group by head_waiter_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate CDR profile associations must be resolved before applying migration 0038';
  end if;
end;
$$;

create unique index if not exists profiles_one_cdr_per_head_waiter_idx
  on public.profiles(head_waiter_id)
  where role::text = 'cdr' and head_waiter_id is not null;

create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select case when p.cdr_access_disabled_at is null then p.role else null::public.app_role end
  from public.profiles as p
  where p.id = auth.uid()
$$;

create or replace function public.cdr_head_waiter_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.head_waiter_id
  from public.profiles as p
  where p.id = auth.uid() and p.cdr_access_disabled_at is null
$$;

alter table public.operational_audit_log
  alter column night_session_id drop not null;

alter table public.operational_audit_log
  drop constraint if exists operational_audit_log_action_type_check;
alter table public.operational_audit_log
  add constraint operational_audit_log_action_type_check check (action_type in (
    'table.arrival_prepared', 'table.arrival_confirmed', 'table.arrival_modified', 'table.arrival_cancelled', 'table.sale_ended', 'table.transferred',
    'promoter.created', 'promoter.activity_added', 'promoter.activity_updated', 'promoter.activity_deleted', 'promoter.deleted',
    'floor_note.created', 'floor_note.updated', 'floor_note.deleted',
    'club_entry.created', 'club_entry.updated', 'club_entry.deleted', 'night.closed',
    'cdr.business_referrer.validated', 'cdr.business_referrer.corrected', 'cdr.rank.validated',
    'hostess.visit.v4_updated',
    'cdr.access.created', 'cdr.access.password_reset', 'cdr.access.disabled', 'cdr.access.enabled'
  ));

comment on column public.profiles.cdr_access_disabled_at is
  'Verrou applicatif et RLS d’un accès CDR, sans suppression du profil ni de son historique.';
