import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0031_cdr_rank_recap.sql');
const consoleSource = file('components/cdr-console.tsx');
const types = file('lib/types.ts');

describe('V4 — récapitulatif sécurisé du rang CDR', () => {
  it('ne retourne que les ventes du CDR final connecté', () => {
    expect(migration).toContain("public.current_role()::text <> 'cdr'");
    expect(migration).toContain('where p.id = auth.uid()');
    expect(migration).toContain("and p.role::text = 'cdr'");
    expect(migration).toContain('where v.final_head_waiter_id = v_head_waiter_id');
  });

  it('conserve une vente transférée unique, mais ne l’expose qu’au CDR final', () => {
    expect(migration).toContain('v.final_head_waiter_id = v_head_waiter_id');
    expect(migration).toContain('v.sale_number');
    expect(migration).toContain('v.id');
    expect(migration).not.toContain('insert into public.table_visits');
  });

  it('permet une soirée active ou clôturée uniquement lorsqu’une vente CDR correspond', () => {
    expect(migration).toContain('p_night_session_id uuid default null');
    expect(migration).toContain('(p_night_session_id is null or v.night_session_id = p_night_session_id)');
    expect(migration).toContain("case when n.ended_at is null then 'active' else 'closed' end");
    expect(migration).toContain('n.ended_at is not null');
  });

  it('n’expose pas arbitrairement les visites historiques sans CDR final établi', () => {
    expect(migration).toContain('v.final_head_waiter_id = v_head_waiter_id');
    expect(migration).not.toContain('coalesce(v.final_head_waiter_id');
    expect(migration).not.toContain('v.head_waiter_id = v_head_waiter_id');
  });

  it('résout les informations V4 nullables et l’apporteur canonique sans les inventer', () => {
    expect(migration).toContain('left join public.business_referrers as referrer on referrer.id = v.business_referrer_id');
    for (const field of ['v.reservation_name', 'v.consumption', 'v.sale_comment', 'referrer.name']) {
      expect(migration).toContain(field);
    }
    expect(consoleSource).toContain('cdrReferrerAmountSummary(selectedRecapSales)');
    expect(consoleSource).not.toContain('selectedRecapSales.map');
  });

  it('reste une frontière SECURITY DEFINER limitée et correctement accordée', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = public');
    expect(migration).toContain('revoke all on function public.get_cdr_rank_recap(uuid) from public, anon');
    expect(migration).toContain('grant execute on function public.get_cdr_rank_recap(uuid) to authenticated');
    expect(migration).not.toContain('p_head_waiter_id');
  });

  it('affiche uniquement le récapitulatif actif et un état vide sûr', () => {
    expect(consoleSource).toContain("rpc('get_cdr_rank_recap', { p_night_session_id: activeNightId })");
    expect(consoleSource).not.toContain("rpc('get_cdr_rank_recap', { p_night_session_id: null })");
    expect(consoleSource).toContain('RÉCAPITULATIF DU RANG');
    expect(consoleSource).toContain('Aucune soirée active.');
    expect(consoleSource).toContain('Aucune transaction pour la soirée en cours.');
    expect(consoleSource).toContain('grid gap-3');
  });

  it('déclare le contrat frontend de la RPC sans identité CDR fournie par le client', () => {
    expect(types).toContain('export interface CdrRankRecapSale');
    expect(consoleSource).not.toContain('p_head_waiter_id');
  });
});
