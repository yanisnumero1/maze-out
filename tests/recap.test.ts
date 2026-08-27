import { describe, expect, it } from 'vitest';
import { activitySummary, recapWaiters, recapZones } from '@/lib/recap';
import type { LiveTable, TableVisit } from '@/lib/types';

const zoneA = { id: 'z1', name: 'Carré 1', display_order: 1, active: true };
const zoneB = { id: 'z2', name: 'Carré 2', display_order: 2, active: true };
const cdrA = { id: 'c1', first_name: 'CDR', last_name: 'Un', color: null, active: true };
const cdrB = { id: 'c2', first_name: 'CDR', last_name: 'Deux', color: null, active: true };
const table = (id: string, zone = zoneA, waiter = cdrA): LiveTable => ({ id, number: id, zone_id: zone.id, head_waiter_id: waiter.id, standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: waiter, reservation: null, occupancy: null });
const visit = (id: string, tableId: string, present: number, guests: number, zone = zoneA, waiter = cdrA): TableVisit => ({ id, night_session_id: 'night-a', table_id: tableId, zone_id: zone.id, head_waiter_id: waiter.id, present_people: present, extra_guests: guests, comment: null, arrived_at: '2026-01-01T22:00:00Z', ended_at: '2026-01-01T23:00:00Z', zone, head_waiter: waiter });

describe('récapitulatif cumulatif de soirée', () => {
  it('compte une table utilisée une fois et ignore une table jamais utilisée', () => {
    expect(activitySummary([visit('v1', 't1', 7, 0)], 2)).toMatchObject({ clients: 7, usedTables: 1, totalTables: 2, usageRate: 50 });
  });

  it('additionne les rotations d’une même table sans la compter deux fois', () => {
    expect(activitySummary([visit('v1', 't1', 7, 0), visit('v2', 't1', 6, 0)], 2)).toMatchObject({ clients: 13, usedTables: 1 });
  });

  it('sépare les invités supplémentaires du total accueilli', () => {
    expect(activitySummary([visit('v1', 't1', 7, 2)], 1)).toMatchObject({ clients: 9, extraGuests: 2 });
  });

  it('ventile l’activité sur les carrés enregistrés dans chaque visite', () => {
    const summaries = recapZones([table('t1', zoneA), table('t2', zoneB, cdrB)], [visit('v1', 't1', 4, 0, zoneA), visit('v2', 't2', 5, 1, zoneB, cdrB)]);
    expect(summaries.map(({ summary }) => summary.clients)).toEqual([4, 6]);
  });

  it('ventile les clients selon le CDR figé lors de l’activité', () => {
    const summaries = recapWaiters([table('t1', zoneA, cdrB)], [visit('v1', 't1', 7, 0, zoneA, cdrA)]);
    expect(summaries.find(({ waiter }) => waiter.id === cdrA.id)?.summary.clients).toBe(7);
    expect(summaries.find(({ waiter }) => waiter.id === cdrB.id)?.summary.clients).toBe(0);
  });

  it('isole les visites de deux soirées distinctes avant agrégation', () => {
    const nightA = [visit('v1', 't1', 7, 0)];
    const nightB = [{ ...visit('v2', 't1', 5, 0), night_session_id: 'night-b' }];
    expect(activitySummary(nightA, 1).clients).toBe(7);
    expect(activitySummary(nightB, 1).clients).toBe(5);
  });
});
