-- Notes propres à une vente active, éditables uniquement par son CDR actuel.
alter table public.table_visits
  add column if not exists cdr_comment text,
  add column if not exists business_referrer text;

create policy "cdr reads own active table visits"
on public.table_visits for select to authenticated
using (
  public.current_role()::text = 'cdr'
  and ended_at is null
  and exists (
    select 1 from public.tables t
    where t.id = table_visits.current_table_id
      and t.head_waiter_id = public.cdr_head_waiter_id()
  )
);

create or replace function public.update_cdr_visit_notes(
  p_visit_id uuid,
  p_cdr_comment text default null,
  p_business_referrer text default null
)
returns public.table_visits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit public.table_visits;
  v_comment text;
  v_referrer text;
begin
  if auth.uid() is null or public.current_role()::text <> 'cdr' then
    raise exception 'CDR access required';
  end if;

  v_comment := nullif(btrim(coalesce(p_cdr_comment, '')), '');
  v_referrer := nullif(btrim(coalesce(p_business_referrer, '')), '');
  if char_length(coalesce(v_comment, '')) > 1000 then raise exception 'Comment is too long'; end if;
  if char_length(coalesce(v_referrer, '')) > 300 then raise exception 'Business referrer is too long'; end if;

  select v.* into v_visit
  from public.table_visits v
  join public.tables t on t.id = v.current_table_id
  where v.id = p_visit_id
    and v.ended_at is null
    and t.head_waiter_id = public.cdr_head_waiter_id()
  for update;
  if not found then raise exception 'Active visit unavailable for this CDR'; end if;

  update public.table_visits
  set cdr_comment = v_comment,
      business_referrer = v_referrer,
      updated_at = now()
  where id = v_visit.id
  returning * into v_visit;

  return v_visit;
end;
$$;

revoke all on function public.update_cdr_visit_notes(uuid, text, text) from public, anon;
grant execute on function public.update_cdr_visit_notes(uuid, text, text) to authenticated;
