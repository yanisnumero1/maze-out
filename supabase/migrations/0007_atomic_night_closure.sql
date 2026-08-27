-- Clôture atomique : figer l'historique puis assainir l'état opérationnel.
alter type public.reservation_status add value if not exists 'completed';

create or replace function public.close_current_night_session()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.current_role() <> 'admin' then
    raise exception 'Admin access required';
  end if;

  select id into v_id
  from public.night_sessions
  where ended_at is null
  limit 1
  for update;

  if v_id is null then
    raise exception 'No active night session';
  end if;

  -- Fige les groupes avant toute réinitialisation de l'opérationnel.
  update public.table_visits
  set ended_at = now(), updated_at = now()
  where night_session_id = v_id and ended_at is null;

  -- La mise à zéro passe par UPDATE : aucune occupation n'est supprimée.
  update public.occupancies o
  set present_people = 0,
      extra_guests = 0,
      comment = null,
      arrived_at = null,
      updated_at = now()
  from public.tables t
  where o.table_id = t.id and t.active = true;

  -- Les réservations sont conservées mais ne restent plus actives.
  update public.reservations
  set status = 'completed', updated_at = now()
  where status in ('reserved', 'arrived');

  update public.night_sessions
  set ended_at = now()
  where id = v_id;
end;
$$;
