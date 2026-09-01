-- Une libération clôture explicitement la visite active avant de remettre l'occupation à zéro.
-- Cela garantit qu'une revente ne laisse jamais la visite précédente active.
create or replace function public.history_occupancy_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_table_id uuid; v_total integer; v_visit_id uuid; v_night_id uuid; v_sale_number integer;
begin
  if current_setting('mazeout.transfer_in_progress', true) = 'on'
    or current_setting('mazeout.release_in_progress', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then v_table_id := old.table_id; v_total := 0; else v_table_id := new.table_id; v_total := new.present_people + new.extra_guests; end if;
  select id into v_visit_id from public.table_visits where current_table_id = v_table_id and ended_at is null order by arrived_at desc limit 1;
  if v_total = 0 then
    if v_visit_id is not null then update public.table_visits set ended_at = now(), updated_at = now() where id = v_visit_id; end if;
    return coalesce(new, old);
  end if;
  if v_visit_id is null then
    v_night_id := public.open_night_session();
    select coalesce(max(sale_number), 0) + 1 into v_sale_number from public.table_visits where night_session_id = v_night_id and table_id = v_table_id;
    insert into public.table_visits(night_session_id, table_id, current_table_id, zone_id, head_waiter_id, present_people, extra_guests, comment, arrived_at, sale_number)
    select v_night_id, t.id, t.id, t.zone_id, t.head_waiter_id, new.present_people, new.extra_guests, new.comment, coalesce(new.arrived_at, now()), v_sale_number from public.tables t where t.id = v_table_id;
  else
    update public.table_visits set present_people = new.present_people, extra_guests = new.extra_guests, comment = new.comment, updated_at = now() where id = v_visit_id;
  end if;
  return new;
end;
$$;

create or replace function public.release_operational_table(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_visit public.table_visits;
begin
  if public.current_role() not in ('admin', 'hostess') then raise exception 'Operational access required'; end if;
  perform 1 from public.tables where id = p_table_id and active for update;
  if not found then raise exception 'Table unavailable'; end if;
  select * into v_visit from public.table_visits where current_table_id = p_table_id and ended_at is null order by arrived_at desc limit 1 for update;
  if v_visit.id is not null then
    update public.table_visits set ended_at = now(), updated_at = now() where id = v_visit.id and ended_at is null;
  end if;
  perform set_config('mazeout.release_in_progress', 'on', true);
  perform set_config('mazeout.audit_suppressed', 'on', true);
  update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null where table_id = p_table_id;
  if v_visit.id is not null then
    perform public.write_operational_audit(v_visit.night_session_id, 'table.sale_ended', 'table_visit', v_visit.id, jsonb_build_object('table_id', p_table_id), null);
  end if;
end;
$$;

revoke all on function public.release_operational_table(uuid) from public, anon;
grant execute on function public.release_operational_table(uuid) to authenticated;
