import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cdrRankTotalAmount, cdrReferrerAmountSummary, formatCdrAmount } from '@/lib/cdr-amounts';
import type { CdrRankRecapSale } from '@/lib/types';

const source = readFileSync(resolve(process.cwd(), 'components/cdr-console.tsx'), 'utf8');

const sale = (nightId: string, id: string, referrerId: string | null, name: string | null, amount: number): CdrRankRecapSale => ({
  table_visit_id: id,
  night_session_id: nightId,
  night_started_at: '2026-09-03T20:00:00Z',
  night_ended_at: null,
  night_status: 'active',
  source_table_number: '01',
  final_table_number: '01',
  sale_number: 1,
  reservation_name: null,
  consumption: null,
  sale_comment: null,
  cdr_comment: null,
  cdr_amount: amount,
  business_referrer_id: referrerId,
  business_referrer_name: name,
  proposed_business_referrer_name: referrerId ? null : 'Proposition Hôtesse',
  arrived_at: '2026-09-03T20:00:00Z',
  ended_at: null,
  is_read_only: false,
});

describe('récapitulatif CDR limité à la soirée active', () => {
  it('charge explicitement la soirée active et ne retombe jamais sur la dernière soirée clôturée', () => {
    expect(source).toContain("loadedRankStatuses.find((status) => status.night_status === 'active')");
    expect(source).toContain("rpc('get_cdr_rank_recap', { p_night_session_id: activeNightId })");
    expect(source).not.toContain("rpc('get_cdr_rank_recap', { p_night_session_id: null })");
    expect(source).not.toContain('recapNights[0]');
    expect(source).not.toContain('selectedRecapNightId');
    expect(source).not.toContain('recap_snapshot');
  });

  it('vide récap et journal mais conserve le rang structurel lorsqu’il n’existe plus de soirée active', () => {
    expect(source).toContain('if (!activeNightId) {\n      setRankRecap([]);');
    expect(source).toContain('setJournal([])');
    expect(source).toContain('cdrLiveTableRows(tables, activeRankStatus ? visits : [], headWaiterId)');
    expect(source).toContain('available: tableRows.length, present: 0');
    expect(source).toContain("table: 'night_sessions'");
  });

  it('affiche le récap avant et après validation, mais réserve le PDF à la soirée active validée', () => {
    expect(source).toContain('selectedRecapSales.length === 0');
    expect(source).toContain('RÉCAP APPORTEURS D’AFFAIRES');
    expect(source).toContain("selectedRankStatus?.night_status === 'active' && selectedRankStatus.validated_at");
  });

  it('isole une nouvelle soirée et agrège plusieurs ventes par apporteur officiel', () => {
    const allSales = [
      sale('closed-night', 'old', 'old-referrer', 'Ancien apporteur', 700),
      sale('active-night', 'new-1', 'new-referrer', 'Nouvel apporteur', 100),
      sale('active-night', 'new-2', 'new-referrer', 'Nouvel apporteur', 50.5),
      sale('active-night', 'proposal', null, null, 900),
    ];
    const activeRows = cdrReferrerAmountSummary(allSales.filter((item) => item.night_session_id === 'active-night'));
    expect(activeRows).toEqual([{ businessReferrerId: 'new-referrer', businessReferrerName: 'Nouvel apporteur', saleCount: 2, totalAmount: 150.5 }]);
    expect(cdrRankTotalAmount(activeRows)).toBe(150.5);
    expect(formatCdrAmount(150.5)).toBe('150,50');
  });

  it('garde écran et document imprimable sans symbole monétaire', () => {
    const recap = source.slice(source.indexOf('aria-label="Récapitulatif du rang"'));
    const printable = source.slice(source.indexOf('className="cdr-print-report hidden"'));
    expect(recap).not.toContain('€');
    expect(recap).not.toMatch(/(^|[^A-Z])EUR([^A-Z]|$)/);
    expect(printable).not.toContain('€');
    expect(printable).not.toMatch(/(^|[^A-Z])EUR([^A-Z]|$)/);
  });
});
