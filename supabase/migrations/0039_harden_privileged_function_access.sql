-- Preserve the live hardening applied on 2026-10-16.
-- Re-running is safe: guarded definitions are not rewritten twice.
-- Back up definitions/ACLs in a private, RLS-protected schema before changing them.
-- Keep existing authenticated/service_role EXECUTE privileges; remove PUBLIC/anon.
-- SECURITY DEFINER operations must reject a missing identity or NULL profile role
-- before their existing role-specific checks and business statements.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create schema if not exists mazeout_security_backup;
revoke all on schema mazeout_security_backup from public, anon, authenticated;
create table if not exists mazeout_security_backup.function_snapshots (
 captured_at timestamptz not null default transaction_timestamp(), signature text not null,
 definition text not null, acl aclitem[], authenticated_execute boolean not null,
 service_role_execute boolean not null, primary key (captured_at, signature));
alter table mazeout_security_backup.function_snapshots enable row level security;
revoke all on all tables in schema mazeout_security_backup from public, anon, authenticated;
insert into mazeout_security_backup.function_snapshots
 (signature, definition, acl, authenticated_execute, service_role_execute)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proacl,
 has_function_privilege('authenticated', p.oid, 'EXECUTE'),
 has_function_privilege('service_role', p.oid, 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef and p.prokind='f';
do $patch$
declare r record; definition text; patched text; count_patched integer := 0;
begin
 for r in select p.oid,p.proname,p.prosrc from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
 where n.nspname='public' and p.prosecdef and p.prokind='f' and l.lanname='plpgsql'
 and p.prosrc ~ 'public\.("current_role"|current_role)\s*\('
 and pg_get_function_result(p.oid)<>'trigger'
 loop
 definition := pg_get_functiondef(r.oid);
 if position('mazeout_security_guard_v1' in definition)=0 then
 patched := regexp_replace(definition, '\mbegin\M',
 E'begin\n  -- mazeout_security_guard_v1\n  if auth.uid() is null or public.current_role() is null then\n    raise exception using errcode = ''42501'', message = ''Active authenticated profile required'';\n  end if;', 'i');
 if patched=definition then raise exception 'Cannot guard function %',r.proname; end if;
 execute patched; count_patched := count_patched+1;
 end if;
 end loop;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='open_night_session' and position('mazeout_security_guard_v1' in p.prosrc)>0)
 then raise exception 'Expected guard missing'; end if;
 for r in select p.oid::regprocedure as signature,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as keep_authenticated,
 has_function_privilege('service_role',p.oid,'EXECUTE') as keep_service
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.prokind='f'
 loop
 execute format('revoke execute on function %s from public, anon',r.signature);
 if r.keep_authenticated then execute format('grant execute on function %s to authenticated',r.signature); end if;
 if r.keep_service then execute format('grant execute on function %s to service_role',r.signature); end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE'))
 then raise exception 'Anonymous execution remains enabled'; end if;
 raise notice '% function guards updated',count_patched;
end;
$patch$;
