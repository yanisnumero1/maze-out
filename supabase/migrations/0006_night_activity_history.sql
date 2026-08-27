-- Historisation cumulée, non destructive, de l'activité d'une soirée.
create table public.night_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index night_sessions_one_active on public.night_sessions ((ended_at is null)) where ended_at is null;

create table public.table_visits (
  id uuid primary key default gen_random_uuid(),
  night_session_id uuid not null references public.night_sessions(id) on delete restrict,
  table_id uuid not null references public.tables(id) on delete restrict,
  zone_id uuid not null references public.zones(id) on delete restrict,
  head_waiter_id uuid references public.head_waiters(id) on delete set null,
  present_people smallint not null check (present_people >= 0),
  extra_guests smallint not null check (extra_guests >= 0),
  comment text,
  arrived_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= arrived_at)
);

create index table_visits_night_session_idx on public.table_visits(night_session_id);
create index table_visits_open_table_idx on public.table_visits(table_id) where ended_at is null;

alter table public.night_sessions enable row level security;
alter table public.table_visits enable row level security;

create policy "admin reads night sessions" on public.night_sessions for select to authenticated using (public.current_role() = 'admin');
create policy "admin reads table visits" on public.table_visits for select to authenticated using (public.current_role() = 'admin');

create or replace function public.open_night_session()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.night_sessions where ended_at is null limit 1;
  if v_id is null then
    insert into public.night_sessions default values returning id into v_id;
  end if;
  return v_id;
end;
$$;

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
  select id into v_id from public.night_sessions where ended_at is null limit 1;
  if v_id is null then return; end if;
  update public.table_visits set ended_at = now(), updated_at = now()
  where night_session_id = v_id and ended_at is null;
  update public.night_sessions set ended_at = now() where id = v_id;
end;
$$;

create or replace function public.history_occupancy_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table_id uuid;
  v_total integer;
  v_visit_id uuid;
  v_night_id uuid;
begin
  if tg_op = 'DELETE' then
    v_table_id := old.table_id;
    v_total := 0;
  else
    v_table_id := new.table_id;
    v_total := new.present_people + new.extra_guests;
  end if;
  select id into v_visit_id from public.table_visits where table_id = v_table_id and ended_at is null order by arrived_at desc limit 1;

  if v_total = 0 then
    if v_visit_id is not null then
      update public.table_visits set ended_at = now(), updated_at = now() where id = v_visit_id;
    end if;
    return coalesce(new, old);
  end if;

  if v_visit_id is null then
    v_night_id := public.open_night_session();
    insert into public.table_visits (
      night_session_id, table_id, zone_id, head_waiter_id, present_people, extra_guests, comment, arrived_at
    )
    select v_night_id, t.id, t.zone_id, t.head_waiter_id, new.present_people, new.extra_guests, new.comment, coalesce(new.arrived_at, now())
    from public.tables t where t.id = new.table_id;
  else
    update public.table_visits
    set present_people = new.present_people,
        extra_guests = new.extra_guests,
        comment = new.comment,
        updated_at = now()
    where id = v_visit_id;
  end if;

  return new;
end;
$$;

create trigger occupancy_visit_history
after insert or update or delete on public.occupancies
for each row execute function public.history_occupancy_visit();

alter publication supabase_realtime add table public.table_visits;
