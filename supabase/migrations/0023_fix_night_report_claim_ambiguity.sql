-- Correctif pour les projets ayant déjà appliqué 0022 avec une RPC de claim ambiguë.
-- Aucune table ni donnée historique n'est modifiée.
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

-- CREATE OR REPLACE preserves existing grants; these statements keep the 0022
-- execution boundary explicit without broadening it.
revoke all on function public.claim_night_report_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_night_report_deliveries(integer) to service_role;
