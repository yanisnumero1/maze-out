import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recapAnalytics } from '@/lib/recap';
import type { LiveTable, Promoter, TableVisit, TableVisitTransfer } from '@/lib/types';

const zoneA = { id: 'zone-a', name: 'Carré 1', display_order: 1, active: true };
const zoneB = { id: 'zone-b', name: 'Backstage', display_order: 2, active: true };
const samir = { id: 'samir', first_name: 'Samir', last_name: '', color: null, active: true };
const steven = { id: 'steven', first_name: 'Steven', last_name: '', color: null, active: true };
const table = (id: string, display: number, zone = zoneA, waiter = samir): LiveTable => ({ id, number: String(display), display_number: display, zone_id: zone.id, head_waiter_id: waiter.id, standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: waiter, reservation: null, occupancy: null });
const visit = (id: string, tableId: string, people: number, zone = zoneA, waiter = samir): TableVisit => ({ id, night_session_id: 'night', table_id: tableId, current_table_id: tableId, zone_id: zone.id, head_waiter_id: waiter.id, present_people: people, extra_guests: 0, comment: null, arrived_at: '2026-09-01T23:00:00Z', ended_at: null, sale_number: 1, zone, head_waiter: waiter });
const transfer: TableVisitTransfer = { id: 'transfer-1', night_session_id: 'night', table_visit_id: 'visit-1', from_table_id: 'table-1', to_table_id: 'table-2', transferred_by: null, created_at: '2026-09-01T23:05:00Z' };
const promoter = (id: string, name: string, people: number): Promoter => ({ id, night_session_id: 'night', name, normalized_name: name.toLowerCase(), entry_count: people, created_by: null, created_at: '', updated_at: '' });

describe('analyses détaillées du récapitulatif', () => {
  const tables = [table('table-1', 1), table('table-2', 2, zoneB, steven)];
  const visits = [visit('visit-1', 'table-1', 7), visit('visit-2', 'table-1', 5), visit('visit-3', 'table-2', 9, zoneB, steven)];

  it('classe les CDR, carrés et tables sans assimiler un transfert à une vente', () => {
    const result = recapAnalytics(tables, visits, [transfer], [promoter('p1', 'Nova', 12)]);
    expect(result.totalSales).toBe(3);
    expect(result.totalPeople).toBe(21);
    expect(result.distinctTables).toBe(2);
    expect(result.rotations).toBe(1);
    expect(result.transferredVisits).toBe(1);
    expect(result.waiters[0]).toMatchObject({ label: 'Samir', sales: 2, people: 12, tables: 1, rotations: 1, share: 67 });
    expect(result.zones[0]).toMatchObject({ label: 'Carré 1', sales: 2, people: 12, rotations: 1 });
    expect(result.topSalesTables[0]).toMatchObject({ tableNumber: 1, sales: 2, people: 12 });
  });

  it('sépare strictement les promoteurs des personnes accueillies aux tables et gère le zéro', () => {
    const populated = recapAnalytics(tables, visits, [], [promoter('p1', 'Nova', 12), promoter('p2', 'Alpha', 12)]);
    const empty = recapAnalytics([], [], [], []);
    expect(populated.totalPeople).toBe(21);
    expect(populated.promoters.map((item) => item.label)).toEqual(['Alpha', 'Nova']);
    expect(empty).toMatchObject({ totalSales: 0, totalPeople: 0, distinctTables: 0, rotations: 0, transferredVisits: 0 });
    expect(empty.topSalesTables).toEqual([]);
  });

  it('fige les agrégations nécessaires dans le snapshot et les exploite dans l’email', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0025_enrich_night_report_snapshot.sql'), 'utf8');
    const worker = readFileSync(resolve(process.cwd(), 'supabase/functions/send-night-reports/index.ts'), 'utf8');
    for (const key of ["'analytics'", "'rotation_count'", "'transfer_count'", "'top_tables'", "'top_people_tables'", "'promoters_ranked'", "'performance'"]) expect(migration).toContain(key);
    expect(migration).toContain('build_night_report_snapshot_0022');
    expect(worker).toContain('PERFORMANCE CDR');
    expect(worker).toContain('TOP TABLES');
    expect(worker).toContain('POINTS CLÉS');
    expect(worker).toContain('bars(');
    expect(worker).toContain('APPORTEURS D’AFFAIRES');
    expect(worker).toContain('NOTES CDR');
  });
});
