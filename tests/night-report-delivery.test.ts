import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0022_night_report_delivery.sql');
const claimFixMigration = file('supabase/migrations/0023_fix_night_report_claim_ambiguity.sql');
const worker = file('supabase/functions/send-night-reports/index.ts');
const recap = file('components/recap-console.tsx');

describe('compte rendu automatique de soirée', () => {
  it('crée un rapport unique, figé et des livraisons par destinataire', () => {
    expect(migration).toContain('create table public.report_recipients');
    expect(migration).toContain('create table public.night_reports');
    expect(migration).toContain('night_session_id uuid not null unique');
    expect(migration).toContain('snapshot jsonb not null');
    expect(migration).toContain('create table public.night_report_deliveries');
    expect(migration).toContain('unique (night_report_id, report_recipient_id)');
  });

  it('fige le snapshot après la clôture et ne bloque pas en absence de destinataire', () => {
    expect(migration.indexOf("update public.night_sessions set ended_at = now() where id = v_id")).toBeLessThan(migration.indexOf('insert into public.night_reports'));
    expect(migration).toContain('public.build_night_report_snapshot(v_id)');
    expect(migration).toContain('select v_report_id, id from public.report_recipients where enabled');
    expect(migration).toContain("'Aucun destinataire activé au moment de la clôture.'");
    expect(migration).not.toContain('http_post');
  });

  it('conserve les KPI et le contenu opérationnel dans le snapshot', () => {
    for (const key of ['distinct_tables_sold', 'total_sales', 'people_welcomed', 'club_entries', "'zones'", "'head_waiters'", "'promoters'", "'floor_notes'", "'recent_activity'"]) expect(migration).toContain(key);
    expect(migration).toContain('public.table_visits');
    expect(migration).toContain('public.club_entry_counts');
    expect(migration).toContain('public.operational_audit_log');
    expect(migration).toContain("'created_at', created_at");
    expect(migration).toContain("'title', title");
    expect(migration).not.toContain("jsonb_build_object('at', created_at");
    expect(migration).toContain('fallback_activity');
  });

  it('fige des événements métier lisibles avec le même auteur et sans la limite visuelle du récap', () => {
    for (const label of ["'Table '", "'Note Piste ajoutée'", "'Entrées club · '", "'Soirée clôturée'"]) expect(migration).toContain(label);
    for (const key of ["'actor_id', actor_id", "'actor_name', actor_name", "'actor_role', actor_role"]) expect(migration).toContain(key);
    expect(migration).toContain('select * from audit_activity union all select * from fallback_activity');
    expect(migration).not.toContain('limit 12');
    expect(migration).not.toContain('limit 30');
  });

  it('compare les identifiants d’audit UUID sans jamais opposer text et uuid', () => {
    const auditMigration = file('supabase/migrations/0021_operational_audit_log.sql');
    expect(auditMigration).toContain('entity_id uuid');
    for (const unsafeJoin of ['arrival_table.id::text = a.entity_id', 'tr.table_visit_id::text = a.entity_id', 'a.entity_id = coalesce(v.current_table_id, v.table_id)::text', 'a.entity_id = tr.table_visit_id::text', 'a.entity_id = n.id::text', 'a.entity_id = e.id::text', 'a.entity_id = c.id::text']) {
      expect(migration).not.toContain(unsafeJoin);
    }
    expect(migration).toContain("arrival_table.id = a.entity_id");
    expect(migration).toContain('tr.table_visit_id = a.entity_id');
    expect(migration).toContain('a.entity_id = n.id');
    expect(migration).not.toContain('a.entity_id::uuid');
  });

  it('claim les tâches atomiquement, limite les retries et recalcule le statut global', () => {
    expect(migration).toContain('for update skip locked');
    expect(migration).toContain('attempt_count < 3');
    expect(migration).toContain("interval '1 minute'");
    expect(migration).toContain("interval '5 minutes'");
    expect(migration).toContain("expired_delivery.status = 'processing' and expired_delivery.attempt_count >= 3");
    expect(migration).toContain("last_error = 'Traitement interrompu après la dernière tentative.'");
    expect(migration).toContain("next_attempt_at = case when v_attempt = 1 then now() + interval '1 minute' when v_attempt = 2 then now() + interval '5 minutes' else null end");
    expect(migration).not.toContain("interval '15 minutes'");
    for (const status of ["'pending'", "'processing'", "'sent'", "'partial'", "'failed'"]) expect(migration).toContain(status);
  });

  it('ne reprend que les tâches sous la limite et finalise un processing expiré à la troisième tentative', () => {
    expect(migration).toContain("where d.attempt_count < 3 and (");
    expect(migration).toContain("or (d.status = 'processing' and d.processing_at < now() - interval '30 minutes')");
    expect(migration).toContain("where expired_delivery.status = 'processing' and expired_delivery.attempt_count >= 3");
    expect(migration).toContain('perform public.refresh_night_report_status(v_report_id);');
  });

  it('qualifie toutes les colonnes de la RPC de claim malgré les variables RETURNS TABLE', () => {
    const claim = migration.slice(migration.indexOf('create or replace function public.claim_night_report_deliveries'), migration.indexOf('create or replace function public.complete_night_report_delivery'));
    expect(claim).toContain('returning expired_delivery.night_report_id');
    expect(claim).toContain('d.night_report_id as claimed_night_report_id');
    expect(claim).toContain('d.report_recipient_id as claimed_recipient_id');
    expect(claim).toContain('current_delivery.night_report_id');
    expect(claim).not.toContain('returning night_report_id');
    expect(claim).not.toContain('select distinct night_report_id from');
    expect(claim).not.toContain('where id = c.id');
  });

  it('fournit un correctif 0023 minimal pour les bases déjà migrées en 0022', () => {
    expect(claimFixMigration).toContain('create or replace function public.claim_night_report_deliveries(p_limit integer default 20)');
    expect(claimFixMigration).toContain('returns table(delivery_id uuid, night_report_id uuid, recipient_name text, recipient_email text, snapshot jsonb)');
    expect(claimFixMigration).toContain('security definer set search_path = public');
    expect(claimFixMigration).toContain('for update skip locked');
    expect(claimFixMigration).toContain('d.night_report_id as claimed_night_report_id');
    expect(claimFixMigration).toContain('attempt_count < 3');
    expect(claimFixMigration).toContain('grant execute on function public.claim_night_report_deliveries(integer) to service_role;');
    expect(claimFixMigration).not.toContain('create table');
    expect(claimFixMigration).not.toContain('alter table');
  });

  it('garde le secret côté Edge Function, utilise une clé Resend stable et ne prend aucun destinataire du body', () => {
    expect(worker).toContain("Deno.env.get('RESEND_API_KEY')");
    expect(worker).toContain("Deno.env.get('NIGHT_REPORT_WORKER_SECRET')");
    expect(worker).toContain('Idempotency-Key');
    expect(worker).toContain('night-report/${delivery.night_report_id}/${delivery.delivery_id}');
    expect(worker).toContain("item.title ?? 'Activité'");
    expect(worker).toContain('Auteur inconnu');
    expect(worker).not.toContain('item.action_type');
    expect(worker).not.toContain('request.json()');
    expect(worker).toContain("rpc('claim_night_report_deliveries'");
  });

  it('n’expose les rapports qu’à l’Admin, les affiche dans le récap et les supprime avant les sessions au reset', () => {
    expect(migration).toContain('admin reads night reports');
    expect(migration).not.toContain('hostess reads night reports');
    expect(migration.indexOf('delete from public.night_report_deliveries')).toBeLessThan(migration.indexOf('delete from public.night_reports'));
    expect(migration.indexOf('delete from public.night_reports')).toBeLessThan(migration.indexOf('delete from public.night_sessions'));
    expect(migration).not.toContain('delete from public.report_recipients');
    expect(recap).toContain('Compte rendu');
    expect(recap).toContain('En attente d’envoi');
  });
});
