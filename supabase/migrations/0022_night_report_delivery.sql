-- Outbox de compte rendu : la clôture crée un travail figé, l'envoi reste asynchrone.
create table public.report_recipients (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.night_reports (
  id uuid primary key default gen_random_uuid(),
  night_session_id uuid not null unique references public.night_sessions(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'partial', 'failed')),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  processing_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text
);

create table public.night_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  night_report_id uuid not null references public.night_reports(id) on delete cascade,
  report_recipient_id uuid not null references public.report_recipients(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz,
  processing_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (night_report_id, report_recipient_id)
);

create index night_report_deliveries_ready_idx on public.night_report_deliveries(status, next_attempt_at) where status in ('pending', 'failed');

alter table public.report_recipients enable row level security;
alter table public.night_reports enable row level security;
alter table public.night_report_deliveries enable row level security;
create policy "admin reads report recipients" on public.report_recipients for select to authenticated using (public.current_role() = 'admin');
create policy "admin reads night reports" on public.night_reports for select to authenticated using (public.current_role() = 'admin');
create policy "admin reads night report deliveries" on public.night_report_deliveries for select to authenticated using (public.current_role() = 'admin');

create or replace function public.build_night_report_snapshot(p_night_session_id uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  with session_row as (
    select id, started_at, ended_at from public.night_sessions where id = p_night_session_id
  ), visits as (
    select v.* from public.table_visits v where v.night_session_id = p_night_session_id
  ), totals as (
    select count(distinct table_id)::integer as distinct_tables_sold,
      count(*)::integer as total_sales,
      coalesce(sum(present_people + extra_guests), 0)::integer as people_welcomed
    from visits
  ), entries as (
    select coalesce(sum(count), 0)::integer as club_entries from public.club_entry_counts where night_session_id = p_night_session_id
  ), zone_rows as (
    select z.id, z.name, z.display_order,
      (select count(*)::integer from public.tables t where t.zone_id = z.id and t.active) as total_tables,
      count(distinct v.table_id)::integer as tables_sold,
      count(v.id)::integer as total_sales,
      coalesce(sum(v.present_people + v.extra_guests), 0)::integer as people_welcomed
    from public.zones z left join visits v on v.zone_id = z.id
    where z.active or exists (select 1 from visits legacy where legacy.zone_id = z.id)
    group by z.id, z.name, z.display_order
  ), waiter_source as (
    select h.id, h.first_name, h.last_name from public.head_waiters h
    where exists (select 1 from public.tables t where t.head_waiter_id = h.id and t.active)
       or exists (select 1 from visits legacy where legacy.head_waiter_id = h.id)
  ), waiter_rows as (
    select h.id, trim(concat_ws(' ', h.first_name, h.last_name)) as name,
      (select count(*)::integer from public.tables t where t.head_waiter_id = h.id and t.active) as assigned_tables,
      count(distinct v.table_id)::integer as tables_sold,
      count(v.id)::integer as total_sales,
      coalesce(sum(v.present_people + v.extra_guests), 0)::integer as people_welcomed
    from waiter_source h left join visits v on v.head_waiter_id = h.id
    group by h.id, h.first_name, h.last_name
  ), promoter_rows as (
    select name, entry_count from public.promoters where night_session_id = p_night_session_id order by name
  ), note_rows as (
    select content, created_at from public.floor_notes where night_session_id = p_night_session_id order by created_at
  ), audit_activity as (
    select
      'audit-' || a.id::text as id,
      a.created_at,
      case a.action_type
        when 'table.arrival_confirmed' then 'Table ' || coalesce(arrival_table.display_number::text, '—') || ' · Arrivée installée'
        when 'table.sale_ended' then 'Table ' || coalesce(sale_table.display_number::text, arrival_table.display_number::text, '—') || ' · Vente terminée'
        when 'table.transferred' then 'Table ' || coalesce(from_table.display_number::text, '—') || ' → Table ' || coalesce(to_table.display_number::text, '—') || ' · Transfert de table'
        when 'promoter.activity_added' then 'Promoteur ' || coalesce(promoter.name, '—') || ' · +' || coalesce(a.after_data->>'people_added', a.before_data->>'people_added', a.metadata->>'people_added', '0') || ' personnes'
        when 'promoter.activity_updated' then 'Promoteur ' || coalesce(promoter.name, '—') || ' · activité corrigée'
        when 'promoter.activity_deleted' then 'Promoteur ' || coalesce(promoter.name, '—') || ' · activité supprimée'
        when 'floor_note.created' then 'Note Piste ajoutée'
        when 'floor_note.updated' then 'Note Piste modifiée'
        when 'floor_note.deleted' then 'Note Piste supprimée'
        when 'club_entry.created' then 'Entrées club · ' || coalesce(a.after_data->>'count', a.before_data->>'count', a.metadata->>'count', '0') || ' personnes'
        when 'club_entry.updated' then 'Entrées club · relevé corrigé à ' || coalesce(a.after_data->>'count', a.before_data->>'count', a.metadata->>'count', '0')
        when 'club_entry.deleted' then 'Entrées club · relevé supprimé (' || coalesce(a.after_data->>'count', a.before_data->>'count', a.metadata->>'count', '0') || ')'
        when 'night.closed' then 'Soirée clôturée'
      end as title,
      case when a.action_type like 'floor_note.%' then coalesce(a.after_data->>'content', a.before_data->>'content', a.metadata->>'content')
        when a.action_type like 'promoter.activity_%' then coalesce(a.after_data->>'note', a.before_data->>'note', a.metadata->>'note') end as detail,
      a.actor_id,
      nullif(trim(concat_ws(' ', actor.first_name, actor.last_name)), '') as actor_name,
      actor.role::text as actor_role
    from public.operational_audit_log a
    left join public.profiles actor on actor.id = a.actor_id
    left join public.tables arrival_table on a.entity_type = 'table' and arrival_table.id = a.entity_id
    left join public.tables sale_table on a.entity_type = 'table_visit'
      and sale_table.id::text = coalesce(a.after_data->>'table_id', a.before_data->>'table_id', a.metadata->>'table_id')
    left join lateral (
      select tr.from_table_id, tr.to_table_id from public.table_visit_transfers tr
      where a.entity_type = 'table_visit' and tr.table_visit_id = a.entity_id order by tr.created_at desc limit 1
    ) transfer on a.action_type = 'table.transferred' and a.entity_type = 'table_visit'
    left join public.tables from_table on from_table.id = transfer.from_table_id
    left join public.tables to_table on to_table.id = transfer.to_table_id
    left join public.promoters promoter on a.entity_type = 'promoter_activity'
      and promoter.id::text = coalesce(a.after_data->>'promoter_id', a.before_data->>'promoter_id', a.metadata->>'promoter_id')
    where a.night_session_id = p_night_session_id
      and a.action_type in ('table.arrival_confirmed', 'table.sale_ended', 'table.transferred', 'promoter.activity_added', 'promoter.activity_updated', 'promoter.activity_deleted', 'floor_note.created', 'floor_note.updated', 'floor_note.deleted', 'club_entry.created', 'club_entry.updated', 'club_entry.deleted', 'night.closed')
  ), fallback_activity as (
    select 'visit-' || v.id::text as id, v.arrived_at as created_at,
      'Table ' || coalesce(t.display_number::text, '—') || ' · Arrivée installée' as title,
      null::text as detail, null::uuid as actor_id, null::text as actor_name, null::text as actor_role
    from visits v left join public.tables t on t.id = coalesce(v.current_table_id, v.table_id)
    where not exists (select 1 from public.operational_audit_log a where a.night_session_id = p_night_session_id and a.entity_type = 'table' and a.entity_id = coalesce(v.current_table_id, v.table_id))
    union all
    select 'transfer-' || tr.id::text, tr.created_at,
      'Table ' || coalesce(source_table.display_number::text, '—') || ' → Table ' || coalesce(destination_table.display_number::text, '—') || ' · Transfert de table',
      null, tr.transferred_by, nullif(trim(concat_ws(' ', actor.first_name, actor.last_name)), ''), actor.role::text
    from public.table_visit_transfers tr
    left join public.tables source_table on source_table.id = tr.from_table_id
    left join public.tables destination_table on destination_table.id = tr.to_table_id
    left join public.profiles actor on actor.id = tr.transferred_by
    where tr.night_session_id = p_night_session_id
      and not exists (select 1 from public.operational_audit_log a where a.night_session_id = p_night_session_id and a.entity_type = 'table_visit' and a.entity_id = tr.table_visit_id)
    union all
    select 'note-' || n.id::text, n.created_at, 'Note Piste ajoutée', n.content, n.created_by,
      nullif(trim(concat_ws(' ', actor.first_name, actor.last_name)), ''), actor.role::text
    from public.floor_notes n left join public.profiles actor on actor.id = n.created_by
    where n.night_session_id = p_night_session_id
      and not exists (select 1 from public.operational_audit_log a where a.night_session_id = p_night_session_id and a.entity_type = 'floor_note' and a.entity_id = n.id)
    union all
    select 'promoter-' || e.id::text, e.created_at, 'Promoteur ' || coalesce(p.name, '—') || ' · +' || coalesce(e.people_added, 0)::text || ' personnes', e.note, e.changed_by,
      nullif(trim(concat_ws(' ', actor.first_name, actor.last_name)), ''), actor.role::text
    from public.promoter_count_events e
    left join public.promoters p on p.id = e.promoter_id
    left join public.profiles actor on actor.id = e.changed_by
    where e.night_session_id = p_night_session_id
      and not exists (select 1 from public.operational_audit_log a where a.night_session_id = p_night_session_id and a.entity_type = 'promoter_activity' and a.entity_id = e.id)
    union all
    select 'entry-' || c.id::text, c.recorded_at, 'Entrées club · ' || c.count::text || ' personnes', null, c.created_by,
      nullif(trim(concat_ws(' ', actor.first_name, actor.last_name)), ''), actor.role::text
    from public.club_entry_counts c left join public.profiles actor on actor.id = c.created_by
    where c.night_session_id = p_night_session_id
      and not exists (select 1 from public.operational_audit_log a where a.night_session_id = p_night_session_id and a.entity_type = 'club_entry' and a.entity_id = c.id)
  ), activity_rows as (
    select * from audit_activity union all select * from fallback_activity
  )
  select jsonb_build_object(
    'night_session', (select jsonb_build_object('id', id, 'started_at', started_at, 'ended_at', ended_at) from session_row),
    'summary', jsonb_build_object('distinct_tables_sold', (select distinct_tables_sold from totals), 'total_sales', (select total_sales from totals), 'people_welcomed', (select people_welcomed from totals), 'club_entries', (select club_entries from entries)),
    'zones', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'total_tables', total_tables, 'tables_sold', tables_sold, 'total_sales', total_sales, 'people_welcomed', people_welcomed) order by display_order) from zone_rows), '[]'::jsonb),
    'head_waiters', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'assigned_tables', assigned_tables, 'tables_sold', tables_sold, 'total_sales', total_sales, 'people_welcomed', people_welcomed) order by name) from waiter_rows), '[]'::jsonb),
    'promoters', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'people_welcomed', entry_count) order by name) from promoter_rows), '[]'::jsonb),
    'floor_notes', coalesce((select jsonb_agg(jsonb_build_object('content', content, 'created_at', created_at) order by created_at) from note_rows), '[]'::jsonb),
    'recent_activity', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'created_at', created_at, 'title', title, 'detail', detail, 'actor_id', actor_id, 'actor_name', actor_name, 'actor_role', actor_role) order by created_at desc) from activity_rows), '[]'::jsonb)
  );
$$;

create or replace function public.refresh_night_report_status(p_night_report_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total integer; v_sent integer; v_processing integer; v_failed integer;
begin
  select count(*), count(*) filter (where status = 'sent'), count(*) filter (where status = 'processing'), count(*) filter (where status = 'failed')
  into v_total, v_sent, v_processing, v_failed from public.night_report_deliveries where night_report_id = p_night_report_id;
  if v_total = 0 then
    update public.night_reports set status = 'failed', failed_at = coalesce(failed_at, now()), last_error = 'Aucun destinataire activé au moment de la clôture.' where id = p_night_report_id;
  elsif v_sent = v_total then
    update public.night_reports set status = 'sent', sent_at = coalesce(sent_at, now()), failed_at = null, last_error = null where id = p_night_report_id;
  elsif v_sent > 0 and v_failed > 0 and v_sent + v_failed = v_total then
    update public.night_reports set status = 'partial', failed_at = coalesce(failed_at, now()) where id = p_night_report_id;
  elsif v_failed = v_total then
    update public.night_reports set status = 'failed', failed_at = coalesce(failed_at, now()) where id = p_night_report_id;
  elsif v_processing > 0 then
    update public.night_reports set status = 'processing', processing_at = coalesce(processing_at, now()) where id = p_night_report_id;
  else
    update public.night_reports set status = 'pending' where id = p_night_report_id;
  end if;
end;
$$;

create or replace function public.claim_night_report_deliveries(p_limit integer default 20)
returns table(delivery_id uuid, night_report_id uuid, recipient_name text, recipient_email text, snapshot jsonb)
language plpgsql security definer set search_path = public as $$
declare v_report_id uuid;
begin
  -- A lease that expires after the third claim is terminal: never create a
  -- fourth attempt just because the worker stopped while processing.
  for v_report_id in
    update public.night_report_deliveries as expired_delivery
    set status = 'failed', failed_at = coalesce(expired_delivery.failed_at, now()), next_attempt_at = null,
      last_error = 'Traitement interrompu après la dernière tentative.', updated_at = now()
    where expired_delivery.status = 'processing' and expired_delivery.attempt_count >= 3
      and expired_delivery.processing_at < now() - interval '30 minutes'
    returning expired_delivery.night_report_id
  loop
    perform public.refresh_night_report_status(v_report_id);
  end loop;

  return query
  with candidates as (
    select d.id as candidate_delivery_id from public.night_report_deliveries as d
    where d.attempt_count < 3 and (
      (d.status in ('pending', 'failed') and (d.next_attempt_at is null or d.next_attempt_at <= now()))
      or (d.status = 'processing' and d.processing_at < now() - interval '30 minutes')
    )
    order by d.created_at for update skip locked limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    update public.night_report_deliveries as d
    set status = 'processing', processing_at = now(), attempt_count = d.attempt_count + 1, updated_at = now()
    from candidates as c
    where d.id = c.candidate_delivery_id
    returning d.id as claimed_delivery_id, d.night_report_id as claimed_night_report_id, d.report_recipient_id as claimed_recipient_id
  )
  select claimed.claimed_delivery_id, claimed.claimed_night_report_id, recipient.name, recipient.email, report.snapshot
  from claimed
  join public.report_recipients as recipient on recipient.id = claimed.claimed_recipient_id
  join public.night_reports as report on report.id = claimed.claimed_night_report_id;
  for v_report_id in
    select distinct current_delivery.night_report_id
    from public.night_report_deliveries as current_delivery
    where current_delivery.status = 'processing' and current_delivery.processing_at > now() - interval '1 minute'
  loop
    perform public.refresh_night_report_status(v_report_id);
  end loop;
end;
$$;

create or replace function public.complete_night_report_delivery(p_delivery_id uuid, p_provider_message_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_report_id uuid; v_attempt integer;
begin
  select night_report_id, attempt_count into v_report_id, v_attempt from public.night_report_deliveries where id = p_delivery_id for update;
  if v_report_id is null then raise exception 'Night report delivery not found'; end if;
  if p_error is null then
    update public.night_report_deliveries set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id, last_error = null, updated_at = now() where id = p_delivery_id;
  else
    update public.night_report_deliveries set status = case when v_attempt >= 3 then 'failed' else 'pending' end,
      failed_at = case when v_attempt >= 3 then now() else null end,
      next_attempt_at = case when v_attempt = 1 then now() + interval '1 minute' when v_attempt = 2 then now() + interval '5 minutes' else null end,
      last_error = left(p_error, 1000), updated_at = now() where id = p_delivery_id;
  end if;
  perform public.refresh_night_report_status(v_report_id);
end;
$$;

create or replace function public.close_current_night_session()
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_open_tables integer; v_report_id uuid;
begin
  if public.current_role() <> 'admin' then raise exception 'Admin access required'; end if;
  select id into v_id from public.night_sessions where ended_at is null limit 1 for update; if v_id is null then raise exception 'No active night session'; end if;
  select count(*) into v_open_tables from public.table_visits where night_session_id = v_id and ended_at is null;
  perform public.write_operational_audit(v_id, 'night.closed', 'night_session', v_id, null, null, jsonb_build_object('open_tables_closed', v_open_tables));
  perform set_config('mazeout.audit_suppressed', 'on', true);
  update public.table_visits set ended_at = now(), updated_at = now() where night_session_id = v_id and ended_at is null;
  update public.arrival_drafts set status = 'cancelled', updated_at = now() where night_session_id = v_id and status = 'draft';
  update public.occupancies o set present_people = 0, extra_guests = 0, comment = null, arrived_at = null, updated_at = now() from public.tables t where o.table_id = t.id and t.active = true;
  update public.reservations set status = 'completed', updated_at = now() where status in ('reserved', 'arrived');
  update public.night_sessions set ended_at = now() where id = v_id;
  insert into public.night_reports(night_session_id, snapshot) values (v_id, public.build_night_report_snapshot(v_id)) returning id into v_report_id;
  insert into public.night_report_deliveries(night_report_id, report_recipient_id)
    select v_report_id, id from public.report_recipients where enabled;
  perform public.refresh_night_report_status(v_report_id);
end;
$$;

create or replace function public.reset_test_operational_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() <> 'admin' then raise exception 'Admin access required'; end if;
  perform set_config('mazeout.audit_suppressed', 'on', true);
  delete from public.night_report_deliveries where id is not null;
  delete from public.night_reports where id is not null;
  delete from public.operational_audit_log where id is not null;
  delete from public.promoter_count_events where id is not null;
  delete from public.floor_notes where id is not null;
  delete from public.club_entry_counts where id is not null;
  delete from public.promoters where id is not null;
  delete from public.arrival_drafts where id is not null;
  delete from public.table_visit_transfers where id is not null;
  delete from public.table_visits where id is not null;
  delete from public.reservations where id is not null;
  update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null, updated_at = now() where table_id is not null;
  delete from public.activity_log where id is not null;
  delete from public.night_sessions where id is not null;
  if (select count(*) from public.tables where active) <> 72 then raise exception 'Expected 72 active tables'; end if;
  if (select count(*) from public.head_waiters where active) <> 9 then raise exception 'Expected 9 active head waiters'; end if;
end;
$$;

revoke all on table public.report_recipients, public.night_reports, public.night_report_deliveries from public, anon, authenticated;
grant select on public.report_recipients, public.night_reports, public.night_report_deliveries to authenticated;
revoke all on function public.build_night_report_snapshot(uuid), public.claim_night_report_deliveries(integer), public.complete_night_report_delivery(uuid, text, text), public.refresh_night_report_status(uuid) from public, anon, authenticated;
grant execute on function public.claim_night_report_deliveries(integer), public.complete_night_report_delivery(uuid, text, text), public.refresh_night_report_status(uuid) to service_role;
alter publication supabase_realtime add table public.night_reports;
