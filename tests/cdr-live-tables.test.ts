import { describe, expect, it } from 'vitest';
import { cdrLiveTableRows } from '@/lib/cdr-live';
import type { HeadWaiter, LiveTable, TableVisit, Zone } from '@/lib/types';

const zone: Zone = { id: 'zone-1', name: 'Carré 1', display_order: 1, active: true };
const samir: HeadWaiter = { id: 'samir', first_name: 'Samir', last_name: '', color: null, active: true };
const other: HeadWaiter = { id: 'other', first_name: 'Autre', last_name: '', color: null, active: true };
const table = (id: string, number: number, waiter: HeadWaiter, people = 0): LiveTable => ({ id, number: String(number), display_number: number, zone_id: zone.id, head_waiter_id: waiter.id, standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: waiter, reservation: null, occupancy: { table_id: id, present_people: people, extra_guests: 0, comment: null, arrived_at: null, updated_at: '' } });
const visit = (id: string, tableId: string, endedAt: string | null = null): TableVisit => ({ id, night_session_id: 'night', table_id: tableId, current_table_id: tableId, zone_id: zone.id, head_waiter_id: samir.id, present_people: 4, extra_guests: 0, comment: null, cdr_comment: 'VIP', business_referrer: 'Yanis', arrived_at: '', ended_at: endedAt, zone, head_waiter: samir });

describe('liste Live CDR fondée sur les tables affectées', () => {
  it('garde visible la Table 1 de Samir sans visite active', () => {
    const rows = cdrLiveTableRows([table('table-1', 1, samir)], [], samir.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].table.display_number).toBe(1);
    expect(rows[0].visit).toBeNull();
  });
  it('garde visible la Table 1 avec sa visite active et son formulaire associé', () => {
    const rows = cdrLiveTableRows([table('table-1', 1, samir, 4)], [visit('visit-1', 'table-1')], samir.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].visit?.id).toBe('visit-1');
  });
  it('garde visible une table libérée même avec un historique fermé', () => {
    const rows = cdrLiveTableRows([table('table-1', 1, samir)], [visit('old-visit', 'table-1', '2026-09-01T03:00:00Z')], samir.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].visit).toBeNull();
  });
  it('exclut une table d’un autre CDR, sans utiliser les visites comme filtre de tables', () => {
    const rows = cdrLiveTableRows([table('table-1', 1, samir), table('table-2', 2, other)], [visit('other-visit', 'table-2')], samir.id);
    expect(rows.map(({ table: rowTable }) => rowTable.id)).toEqual(['table-1']);
  });
});
