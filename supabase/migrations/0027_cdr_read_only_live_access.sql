-- Accès CDR : lecture Live isolée par profiles.head_waiter_id, sans écriture.
alter type public.app_role add value if not exists 'cdr';

alter table public.profiles drop constraint if exists profiles_cdr_requires_head_waiter;
alter table public.profiles add constraint profiles_cdr_requires_head_waiter check (role::text <> 'cdr' or head_waiter_id is not null);

create or replace function public.cdr_head_waiter_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.head_waiter_id from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.can_read_table(p_table uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role()::text in ('admin', 'hostess', 'observer')
    or (public.current_role()::text in ('cdr', 'head_waiter') and exists (
      select 1 from public.tables t where t.id = p_table and t.head_waiter_id = public.cdr_head_waiter_id()
    ))
$$;

-- Cette primitive crée une session : elle ne doit pas rester appelable directement
-- par un CDR même si les RPC opérationnelles qui l'utilisent sont déjà protégées.
create or replace function public.open_night_session()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.current_role()::text not in ('admin', 'hostess') then
    raise exception 'Operational access required';
  end if;
  select n.id into v_id from public.night_sessions n where n.ended_at is null limit 1;
  if v_id is null then
    insert into public.night_sessions default values returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Les politiques historiques donnaient une lecture globale de ces référentiels.
-- Elles restent globales pour l'opérationnel, mais sont limitées au propre rang pour CDR.
drop policy if exists "authenticated read" on public.zones;
drop policy if exists "authenticated read" on public.head_waiters;

create policy "role scoped zone read" on public.zones for select to authenticated using (
  public.current_role()::text in ('admin', 'hostess', 'observer')
  or (public.current_role()::text in ('cdr', 'head_waiter') and exists (
    select 1 from public.tables t where t.zone_id = zones.id and t.head_waiter_id = public.cdr_head_waiter_id()
  ))
);

create policy "role scoped head waiter read" on public.head_waiters for select to authenticated using (
  public.current_role()::text in ('admin', 'hostess', 'observer')
  or (public.current_role()::text in ('cdr', 'head_waiter') and id = public.cdr_head_waiter_id())
);

-- Tables, occupations et réservations utilisent déjà public.can_read_table().
-- Aucune policy d'écriture n'est ajoutée : can_edit_table() n'autorise que admin/hostess.
-- Les RPC métier conservent leurs gardes explicites current_role() in ('admin', 'hostess').
