import { describe, expect, it } from 'vitest';
import { promoterTotal, recapRotations, recapTables, selectedNightNotes, totalClubEntryCount } from '@/lib/recap';
import type { ClubEntryCount, FloorNote, Promoter, TableVisit } from '@/lib/types';

const zone = { id: 'z1', name: 'Carré 1', display_order: 1, active: true };
const waiter = { id: 'w1', first_name: 'Samir', last_name: '', color: null, active: true };
const visit = (id: string, tableId: string, sale: number, people: number, guests: number, night = 'night-a'): TableVisit => ({ id, night_session_id: night, table_id: tableId, zone_id: zone.id, head_waiter_id: waiter.id, present_people: people, extra_guests: guests, comment: null, arrived_at: '2026-08-23T22:00:00Z', ended_at: '2026-08-23T23:00:00Z', sale_number: sale, zone, head_waiter: waiter });

describe('récapitulatif V2', () => {
  it('distingue une table vendue plusieurs fois de ses ventes totales', () => {
    const tables = recapTables([visit('v1', 't12', 1, 7, 1), visit('v2', 't12', 2, 6, 0), visit('v3', 't12', 3, 8, 0)], new Map([['t12', 12]]));
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ tableNumber: 12, sales: 3, people: 22, extraGuests: 1 });
  });

  it('classe les rotations par ventes décroissantes puis numéro croissant', () => {
    const tables = recapTables([visit('v1', 't12', 1, 7, 0), visit('v2', 't8', 1, 7, 0), visit('v3', 't8', 2, 7, 0), visit('v4', 't12', 2, 7, 0)], new Map([['t12', 12], ['t8', 8]]));
    expect(recapRotations(tables).map((table) => table.tableNumber)).toEqual([8, 12]);
  });

  it('additionne les relevés Entrées club de la soirée sans les mélanger', () => {
    const counts: ClubEntryCount[] = [{ id: 'e1', night_session_id: 'night-a', count: 5, recorded_at: '2026-08-23T22:30:00Z', created_by: null, created_at: '', updated_at: '' }, { id: 'e2', night_session_id: 'night-a', count: 5, recorded_at: '2026-08-23T23:30:00Z', created_by: null, created_at: '', updated_at: '' }];
    expect(totalClubEntryCount(counts)).toBe(10);
    expect(totalClubEntryCount([...counts.slice(0, 1), { ...counts[1], count: 8 }])).toBe(13);
    expect(totalClubEntryCount([{ ...counts[1], count: 8 }])).toBe(8);
    expect(totalClubEntryCount([{ ...counts[0], night_session_id: 'night-b', count: 3 }, { ...counts[1], night_session_id: 'night-b', count: 7 }])).toBe(10);
  });

  it('totalise les valeurs finales des promoteurs de la soirée sélectionnée', () => {
    const promoters: Promoter[] = [{ id: 'p1', night_session_id: 'night-a', name: 'Thomas', normalized_name: 'thomas', entry_count: 14, created_by: null, created_at: '', updated_at: '' }, { id: 'p2', night_session_id: 'night-a', name: 'Sarah', normalized_name: 'sarah', entry_count: 8, created_by: null, created_at: '', updated_at: '' }];
    expect(promoterTotal(promoters)).toBe(22);
  });

  it('isole les notes de la night session sélectionnée', () => {
    const notes: FloorNote[] = [{ id: 'n1', night_session_id: 'night-a', content: 'A', created_by: null, created_at: '2026-08-23T22:00:00Z', updated_at: '' }, { id: 'n2', night_session_id: 'night-b', content: 'B', created_by: null, created_at: '2026-08-23T23:00:00Z', updated_at: '' }];
    expect(selectedNightNotes(notes, 'night-a').map((note) => note.content)).toEqual(['A']);
  });
});
