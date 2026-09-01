import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { businessReferrerRanking, cdrVisitNotes } from '@/lib/recap';
import type { HeadWaiter, TableVisit, Zone } from '@/lib/types';

const zone: Zone = { id: 'zone-1', name: 'Carré 1', display_order: 1, active: true };
const samir: HeadWaiter = { id: 'samir', first_name: 'Samir', last_name: '', color: null, active: true };
const visit = (id: string, saleNumber: number, options: { referrer?: string | null; comment?: string | null; people?: number; tableId?: string } = {}): TableVisit => ({
  id,
  night_session_id: 'night-1',
  table_id: options.tableId ?? 'table-01',
  current_table_id: options.tableId ?? 'table-01',
  zone_id: zone.id,
  head_waiter_id: samir.id,
  present_people: options.people ?? 6,
  extra_guests: 0,
  comment: null,
  cdr_comment: options.comment ?? null,
  business_referrer: options.referrer ?? null,
  arrived_at: `2026-09-01T2${saleNumber}:00:00Z`,
  ended_at: null,
  sale_number: saleNumber,
  zone,
  head_waiter: samir,
});

describe('notes CDR et apporteurs dans le récapitulatif', () => {
  it('conserve chaque vente comme une ligne distincte et exclut les visites sans donnée CDR', () => {
    const notes = cdrVisitNotes([
      visit('visit-1', 1, { comment: 'Anniversaire client' }),
      visit('visit-2', 2, { referrer: 'Yanis' }),
      visit('visit-3', 3),
    ], new Map([['table-01', '01']]));
    expect(notes).toHaveLength(2);
    expect(notes.map((note) => note.saleNumber)).toEqual([1, 2]);
    expect(notes[0]).toMatchObject({ tableNumber: '01', headWaiterName: 'Samir', people: 6, cdrComment: 'Anniversaire client' });
  });

  it('agrège les apporteurs sans les confondre avec les promoteurs', () => {
    const rankings = businessReferrerRanking([
      visit('visit-1', 1, { referrer: 'Yanis', people: 6 }),
      visit('visit-2', 2, { referrer: ' yanis ', people: 5 }),
      visit('visit-3', 3, { referrer: 'YANIS', people: 7 }),
      visit('visit-4', 4, { referrer: 'Karim', people: 4 }),
    ]);
    expect(rankings).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'yanis', label: 'Yanis', sales: 3, people: 18 })]));
    expect(rankings).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'karim', sales: 1, people: 4 })]));
  });

  it('fige ces données dans le snapshot et rend les nouveaux champs optionnels dans l’email', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0029_enrich_report_with_cdr_notes.sql'), 'utf8');
    const worker = readFileSync(resolve(process.cwd(), 'supabase/functions/send-night-reports/index.ts'), 'utf8');
    const recap = readFileSync(resolve(process.cwd(), 'components/recap-console.tsx'), 'utf8');
    expect(migration).toContain("'business_referrers_ranked'");
    expect(migration).toContain("'cdr_visit_notes'");
    expect(migration).toContain('lower(btrim(v.business_referrer))');
    expect(worker).toContain('snapshot.business_referrers_ranked ?? []');
    expect(worker).toContain('snapshot.cdr_visit_notes ?? []');
    expect(worker).toContain('APPORTEURS D’AFFAIRES');
    expect(worker).toContain('NOTES CDR');
    expect(recap).toContain('NOTES CDR &amp; APPORTEURS');
  });
});
