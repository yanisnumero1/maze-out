import { describe, expect, it } from 'vitest';
import { findGlobalResults } from '@/lib/global-search';
import type { BusinessReferrer, LiveTable, Promoter, TableVisit, Zone } from '@/lib/types';

const zone: Zone = { id: 'zone', name: 'Carré Or', display_order: 1, active: true };
const waiter = { id: 'cdr-karim', first_name: 'Karim', last_name: 'D.', color: null, active: true };
const table = (id: string, number: string): LiveTable => ({ id, number, display_number: number, zone_id: zone.id, head_waiter_id: waiter.id, standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: waiter, reservation: null, occupancy: null });
const tables = [table('t42', '42'), table('t43', '43')];
const visit = (id: string, tableId: string, reservationName: string, referrerId = 'ref-mehdi'): TableVisit => ({ id, night_session_id: 'night', table_id: tableId, current_table_id: tableId, zone_id: zone.id, head_waiter_id: waiter.id, final_head_waiter_id: waiter.id, present_people: 5, extra_guests: 0, comment: null, reservation_name: reservationName, business_referrer_id: referrerId, arrived_at: '2026-09-02T20:00:00Z', ended_at: null, zone, head_waiter: waiter });
const referrers: BusinessReferrer[] = [{ id: 'ref-mehdi', name: 'Mehdi', normalized_name: 'mehdi', active: true, created_at: '', updated_at: '' }];
const promoters: Promoter[] = [{ id: 'prom-alex', night_session_id: 'night', name: 'Alex', normalized_name: 'alex', entry_count: 12, created_by: null, created_at: '', updated_at: '' }];

describe('recherche globale opérationnelle', () => {
  it('conserve la recherche de table par numéro et préfixe avec priorité de table', () => {
    expect(findGlobalResults({ tables, visits: [], businessReferrers: [], promoters: [] }, '42').map((item) => item.type)).toEqual(['table']);
    expect(findGlobalResults({ tables, visits: [], businessReferrers: [], promoters: [] }, ' Table 42 ')[0].type).toBe('table');
  });

  it('retourne simultanément réservation, apporteur, promoteur et CDR avec leur contexte', () => {
    expect(findGlobalResults({ tables, visits: [visit('v1', 't42', 'Thomas Martin')], businessReferrers: referrers, promoters }, 'thomas')[0]).toMatchObject({ type: 'reservation', table: { id: 't42' } });
    expect(findGlobalResults({ tables, visits: [visit('v1', 't42', 'Thomas Martin')], businessReferrers: referrers, promoters }, 'MEHDI')[0]).toMatchObject({ type: 'referrer', visit: { id: 'v1' } });
    expect(findGlobalResults({ tables, visits: [], businessReferrers: [], promoters }, ' alex ')[0]).toMatchObject({ type: 'promoter', promoter: { entry_count: 12 } });
    expect(findGlobalResults({ tables, visits: [], businessReferrers: [], promoters: [] }, 'karim').find((item) => item.type === 'cdr')).toMatchObject({ type: 'cdr', headWaiter: { id: 'cdr-karim' } });
  });

  it('ne mélange pas apporteur et promoteur, et garde plusieurs ventes distinctes', () => {
    const results = findGlobalResults({ tables, visits: [visit('v1', 't42', 'Thomas'), visit('v2', 't43', 'Yanis')], businessReferrers: referrers, promoters }, 'mehdi');
    expect(results.map((item) => item.type)).toEqual(['referrer', 'referrer']);
    expect(results.map((item) => item.key)).toEqual(['referrer:v1', 'referrer:v2']);
  });

  it('ignore une visite dont la table n’est pas dans les données accessibles et retourne un état vide propre', () => {
    expect(findGlobalResults({ tables, visits: [visit('private', 'other-table', 'Secret')], businessReferrers: referrers, promoters }, 'secret')).toEqual([]);
    expect(findGlobalResults({ tables, visits: [], businessReferrers: [], promoters: [] }, 'inconnu')).toEqual([]);
  });
});
