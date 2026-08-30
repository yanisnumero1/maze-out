-- Expose uniquement l'heure de début de l'unique soirée active aux rôles opérationnels.
-- Aucune policy SELECT sur night_sessions n'est élargie.
create or replace function public.current_operational_night_started_at()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz;
begin
  if public.current_role() not in ('admin', 'hostess') then
    raise exception 'Operational access required';
  end if;

  select started_at into v_started_at
  from public.night_sessions
  where ended_at is null
  limit 1;

  return v_started_at;
end;
$$;

revoke all on function public.current_operational_night_started_at() from public;
grant execute on function public.current_operational_night_started_at() to authenticated;
