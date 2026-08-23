-- CDR : lecture de leurs seules tables ; aucune écriture opérationnelle.
create or replace function public.can_read_table(p_table uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.current_role() in ('admin','hostess','observer')
  or (public.current_role()='head_waiter' and exists (
    select 1 from public.tables t join public.profiles p on p.head_waiter_id=t.head_waiter_id
    where t.id=p_table and p.id=auth.uid()
  ))
$$;
create or replace function public.can_edit_table(p_table uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.current_role() in ('admin','hostess')
$$;

drop policy if exists "authenticated read" on public.tables;
drop policy if exists "authenticated read" on public.reservations;
drop policy if exists "authenticated read" on public.occupancies;
drop policy if exists "authenticated read" on public.activity_log;
drop policy if exists "table editors manage occupancy" on public.occupancies;

create policy "role scoped table read" on public.tables for select to authenticated using (public.can_read_table(id));
create policy "role scoped reservation read" on public.reservations for select to authenticated using (public.can_read_table(table_id));
create policy "role scoped occupancy read" on public.occupancies for select to authenticated using (public.can_read_table(table_id));
create policy "role scoped activity read" on public.activity_log for select to authenticated using (table_id is not null and public.can_read_table(table_id));
create policy "arrival managers manage occupancy" on public.occupancies for all to authenticated using (public.can_edit_table(table_id)) with check (public.can_edit_table(table_id));

create policy "admin manages profiles" on public.profiles for all to authenticated using (public.current_role()='admin') with check (public.current_role()='admin');
