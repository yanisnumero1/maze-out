import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cdrRankTotalAmount, cdrReferrerAmountSummary, formatCdrAmount, isValidCdrAmountInput, parseCdrAmountInput } from '@/lib/cdr-amounts';
import type { CdrRankRecapSale } from '@/lib/types';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0037_cdr_referrer_amounts.sql');
const consoleSource = file('components/cdr-console.tsx');
const adminRecap = file('components/recap-console.tsx');
const migration0036 = file('supabase/migrations/0036_cdr_rank_personal_checkpoint.sql');

const sale = (id: string, referrerId: string | null, referrerName: string | null, amount: number | null): CdrRankRecapSale => ({
  table_visit_id: id, night_session_id: 'night', night_started_at: '2026-09-03T20:00:00Z', night_ended_at: null,
  night_status: 'active', source_table_number: '01', final_table_number: '01', sale_number: Number(id.replace(/\D/g, '')),
  reservation_name: null, consumption: null, sale_comment: null, cdr_comment: null, cdr_amount: amount,
  business_referrer_id: referrerId, business_referrer_name: referrerName, proposed_business_referrer_name: null,
  arrived_at: '2026-09-03T20:00:00Z', ended_at: null, is_read_only: false,
});

describe('montants CDR par apporteur', () => {
  it('normalise point ou virgule et refuse négatifs, texte et plus de deux décimales', () => {
    expect(parseCdrAmountInput('150')).toBe(150);
    expect(parseCdrAmountInput('150.50')).toBe(150.5);
    expect(parseCdrAmountInput(' 150,50 ')).toBe(150.5);
    expect(parseCdrAmountInput('0')).toBe(0);
    expect(isValidCdrAmountInput('')).toBe(true);
    for (const invalid of ['-1', 'abc', '12,345', '1 250 €']) expect(isValidCdrAmountInput(invalid)).toBe(false);
  });

  it('additionne plusieurs ventes par apporteur et calcule le total du rang', () => {
    const rows = cdrReferrerAmountSummary([
      sale('v1', 'john', 'Jean Dupont', 1000), sale('v2', 'john', 'Jean Dupont', 250),
      sale('v3', 'sofiane', 'Sofiane Club', 800), sale('v4', null, null, 900),
    ]);
    expect(rows).toEqual([
      { businessReferrerId: 'john', businessReferrerName: 'Jean Dupont', saleCount: 2, totalAmount: 1250 },
      { businessReferrerId: 'sofiane', businessReferrerName: 'Sofiane Club', saleCount: 1, totalAmount: 800 },
    ]);
    expect(cdrRankTotalAmount(rows)).toBe(2050);
    expect(formatCdrAmount(1250.5)).toMatch(/1[\s\u00a0\u202f]250,50\s€/);
  });

  it('ajoute un numeric dédié sans convertir ni supprimer cdr_comment', () => {
    expect(migration).toContain('cdr_amount numeric(12,2)');
    expect(migration).toContain('check (cdr_amount >= 0)');
    expect(migration).not.toContain('update public.table_visits set cdr_amount');
    expect(migration).not.toContain('drop column cdr_comment');
    expect(migration0036).toContain('cdr_comment text');
  });

  it('enregistre exclusivement via une RPC sécurisée du CDR final', () => {
    const rpc = migration.slice(migration.indexOf('create or replace function public.update_cdr_visit_amount'), migration.indexOf('create or replace function public.validate_cdr_rank'));
    for (const guard of ["public.current_role()::text <> 'cdr'", 'v.ended_at is null', 'n.ended_at is null', 'v.final_head_waiter_id = v_head_waiter_id', 'public.cdr_rank_validations', 'p_cdr_amount < 0']) expect(rpc).toContain(guard);
    expect(consoleSource).toContain("rpc('update_cdr_visit_amount'");
    expect(consoleSource).not.toContain("from('table_visits').update");
  });

  it('bloque côté SQL une somme positive sans apporteur validé, sans accepter la proposition', () => {
    const validation = migration.slice(migration.indexOf('create or replace function public.validate_cdr_rank'), migration.indexOf('drop function public.get_cdr_rank_recap'));
    expect(validation).toContain('v.cdr_amount > 0');
    expect(validation).toContain('v.business_referrer_id is null');
    expect(validation).toContain('Certaines sommes ne sont rattachées à aucun apporteur');
    expect(validation).not.toContain('proposed_business_referrer_name is not null');
  });

  it('fige ventes, agrégats et total dans le snapshot de validation', () => {
    expect(migration).toContain('add column if not exists recap_snapshot jsonb');
    expect(migration).toContain("'sales', coalesce");
    expect(migration).toContain("'referrers', coalesce");
    expect(migration).toContain("'total_amount'");
    expect(migration).toContain('recap_snapshot -> \'sales\'');
    expect(migration).toContain('rv.recap_snapshot is null');
  });

  it('reste attribué au CDR final et compte une seule fois chaque table_visit', () => {
    expect(migration).toContain('v.final_head_waiter_id = v_head_waiter_id');
    expect(migration).toContain("'table_visit_id', v.id");
    expect(migration).not.toContain('insert into public.table_visits');
    expect(migration).not.toContain('join public.table_visit_transfers');
  });

  it('affiche le récap avant/après validation, les anomalies et le PDF', () => {
    for (const text of ['MONTANT APPORTEUR', 'RÉCAP APPORTEURS', 'RÉCAP APPORTEURS D’AFFAIRES', 'TOTAL DU RANG', 'unlinkedPositiveSales']) expect(consoleSource).toContain(text);
    expect(consoleSource).toContain("disabled={rankValidationState === 'saving' || unlinkedPositiveSales.length > 0}");
    expect(consoleSource).toContain('aria-label="Récap apporteurs d’affaires"');
    expect(consoleSource).toContain('formatCdrAmount(rankTotalAmount)');
  });

  it('ajoute le montant au détail Admin sans modifier ses KPI', () => {
    expect(adminRecap).toContain('Montant apporteur · ');
    expect(adminRecap).toContain('sale.cdrAmount');
  });
});
