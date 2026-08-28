import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0014_reset_test_operational_data.sql'), 'utf8');
const admin = readFileSync(resolve(process.cwd(), 'components/admin-console.tsx'), 'utf8');

describe('réinitialisation propre des données de test', () => {
  it('réserve la RPC au rôle admin et la rend atomique', () => {
    expect(migration).toContain('create or replace function public.reset_test_operational_data()');
    expect(migration).toContain("public.current_role() <> 'admin'");
    expect(migration).toContain("raise exception 'Admin access required'");
    expect(migration).toContain('security definer');
    expect(migration).toContain('revoke all on function public.reset_test_operational_data() from public, anon');
  });

  it('supprime uniquement les données opérationnelles dans un ordre compatible avec les clés étrangères', () => {
    for (const table of ['promoter_count_events', 'floor_notes', 'club_entry_counts', 'promoters', 'arrival_drafts', 'table_visits', 'reservations', 'activity_log', 'night_sessions']) {
      expect(migration).toContain('delete from public.' + table);
    }
    expect(migration).not.toContain('delete from public.tables');
    expect(migration).not.toContain('delete from public.zones');
    expect(migration).not.toContain('delete from public.head_waiters');
    expect(migration).not.toContain('delete from public.profiles');
  });

  it('neutralise les occupations sans supprimer la structure des tables', () => {
    expect(migration).toContain('update public.occupancies');
    expect(migration).toContain('present_people = 0');
    expect(migration).toContain('extra_guests = 0');
    expect(migration).toContain('comment = null');
    expect(migration).toContain('arrived_at = null');
  });

  it('vérifie la configuration active 72 tables, numérotation, CDR et capacités', () => {
    expect(migration).toContain("<> 72 then raise exception 'Expected 72 active tables'");
    expect(migration).toContain("<> 9 then raise exception 'Expected 9 active head waiters'");
    expect(migration).toContain("'Active display numbers must be exactly 1 to 72'");
    expect(migration).toContain("'Active CDR assignments are invalid'");
    expect(migration).toContain("'Zone capacities are invalid'");
  });

  it('exige RESET avant la confirmation définitive dans l’interface Admin', () => {
    expect(admin).toContain("useState<0 | 1 | 2>(0)");
    expect(admin).toContain('Saisissez exactement RESET');
    expect(admin).toContain("resetWord !== 'RESET'");
    expect(admin).toContain('Réinitialisation en cours...');
    expect(admin).toContain("supabase.rpc('reset_test_operational_data')");
  });
});
