import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0027_cdr_read_only_live_access.sql');
const consoleSource = file('components/cdr-console.tsx');

describe('accès CDR lecture seule', () => {
  it('ajoute le rôle CDR et impose son association à un chef de rang', () => {
    expect(migration).toContain("add value if not exists 'cdr'");
    expect(migration).toContain('profiles_cdr_requires_head_waiter');
    expect(migration).toContain("role::text <> 'cdr' or head_waiter_id is not null");
  });
  it('isole la lecture des tables par le profil et le head_waiter_id', () => {
    expect(migration).toContain('create or replace function public.can_read_table(p_table uuid)');
    expect(migration).not.toContain('can_read_table(p_table_id uuid)');
    expect(migration).toContain('public.cdr_head_waiter_id()');
    expect(migration).toContain("public.current_role()::text in ('cdr', 'head_waiter')");
    expect(migration).toContain('t.id = p_table and t.head_waiter_id = public.cdr_head_waiter_id()');
  });
  it('limite aussi les zones et chefs de rang visibles au propre périmètre CDR', () => {
    expect(migration).toContain('role scoped zone read');
    expect(migration).toContain('role scoped head waiter read');
    expect(migration).toContain('id = public.cdr_head_waiter_id()');
  });
  it('ne donne pas de politique ni de composant d’écriture directe au CDR', () => {
    expect(migration).not.toMatch(/create policy[^;]*(insert|update|delete)[^;]*cdr/i);
    expect(consoleSource).toContain("rpc('update_cdr_visit_notes'");
    expect(consoleSource).not.toContain("rpc('prepare_arrival_draft'");
    expect(consoleSource).not.toContain("rpc('transfer_operational_table'");
    expect(consoleSource).not.toContain("rpc('release_operational_table'");
    expect(consoleSource).not.toContain('.insert(');
    expect(consoleSource).not.toContain('.update(');
    expect(consoleSource).not.toContain('.delete(');
    expect(migration).toContain('create or replace function public.open_night_session()');
    expect(migration).toContain("public.current_role()::text not in ('admin', 'hostess')");
  });
  it('charge les tables avec le client authentifié et se rafraîchit par Realtime', () => {
    expect(consoleSource).toContain(".from('tables')");
    expect(consoleSource).toContain("supabase.channel('cdr-live')");
    expect(consoleSource).toContain("table: 'occupancies'");
    expect(consoleSource).toContain("table: 'tables'");
    expect(consoleSource).toContain("table: 'table_visits'");
    expect(consoleSource).toContain(".order('display_number')");
  });
});
