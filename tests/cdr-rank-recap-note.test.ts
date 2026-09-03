import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0032_cdr_rank_recap_note.sql');
const previousMigration = file('supabase/migrations/0031_cdr_rank_recap.sql');
const consoleSource = file('components/cdr-console.tsx');
const types = file('lib/types.ts');

describe('V4 — note CDR dans le récapitulatif du rang', () => {
  it('retourne cdr_comment avec la vente, sans modifier la règle du CDR final', () => {
    expect(migration).toContain('cdr_comment text');
    expect(migration).toContain('v.cdr_comment');
    expect(migration).toContain('where v.final_head_waiter_id = v_head_waiter_id');
    expect(migration).not.toContain('v.head_waiter_id = v_head_waiter_id');
  });

  it('préserve les mêmes contrôles de sécurité et grants que 0031', () => {
    for (const rule of [
      'security definer',
      'set search_path = public',
      "if auth.uid() is null then",
      "public.current_role()::text <> 'cdr'",
      'where p.id = auth.uid()',
      'and p.role::text = \'cdr\'',
      'revoke all on function public.get_cdr_rank_recap(uuid) from public, anon',
      'grant execute on function public.get_cdr_rank_recap(uuid) to authenticated',
    ]) {
      expect(migration).toContain(rule);
      expect(previousMigration).toContain(rule);
    }
  });

  it('remplace le contrat RETURNS TABLE de manière transactionnelle, sans cascade', () => {
    expect(migration).toContain('drop function public.get_cdr_rank_recap(uuid);');
    expect(migration).not.toMatch(/drop function public\.get_cdr_rank_recap\(uuid\)\s+cascade/i);
    expect(migration).toContain('create function public.get_cdr_rank_recap(');
  });

  it('garde sale_comment et cdr_comment distincts dans le type et le rendu', () => {
    expect(types).toContain('sale_comment: string | null;');
    expect(types).toContain('cdr_comment: string | null;');
    expect(consoleSource).toContain("sale.sale_comment || 'Non renseigné'");
    expect(consoleSource).toContain('sale.cdr_comment &&');
    expect(consoleSource).toContain('Note CDR historique');
  });

  it('recharge le récapitulatif après la sauvegarde du montant, sans abonnement additionnel', () => {
    const saveAmount = consoleSource.slice(consoleSource.indexOf('async function saveAmount'), consoleSource.indexOf('async function validateBusinessReferrer'));
    expect(saveAmount).toContain("rpc('update_cdr_visit_amount'");
    expect(saveAmount).toContain('await refresh();');
    expect(consoleSource).not.toContain("table: 'night_sessions'");
  });

  it('conserve la consultation des notes après clôture en lecture seule', () => {
    expect(migration).toContain("case when n.ended_at is null then 'active' else 'closed' end");
    expect(migration).toContain('n.ended_at is not null');
    expect(consoleSource).toContain('Soirée clôturée — lecture seule');
  });

  it('ne modifie aucune RLS ni la validation d’apporteur', () => {
    expect(migration).not.toContain('create policy');
    expect(migration).not.toContain('alter table');
    expect(consoleSource).toContain("rpc('validate_cdr_business_referrer'");
  });
});
