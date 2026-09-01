import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveDashboard, liveZoneDashboard, stats } from '@/lib/live';
import { activitySummary } from '@/lib/recap';
import type { LiveTable, TableVisit } from '@/lib/types';

const zone = { id: 'zone', name: 'Carré 1', display_order: 1, active: true, max_capacity: 100 };
const table = (id: string, people: number): LiveTable => ({ id, number: id, display_number: Number(id.replace('table-', '')), zone_id: zone.id, head_waiter_id: null, standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: null, reservation: null, occupancy: { table_id: id, present_people: people, extra_guests: 0, comment: null, arrived_at: people ? '2026-09-02T00:00:00Z' : null, updated_at: '' } });
const visit = (id: string, tableId: string, people: number, ended = false): TableVisit => ({ id, night_session_id: 'night', table_id: tableId, current_table_id: tableId, zone_id: zone.id, head_waiter_id: null, present_people: people, extra_guests: 0, comment: null, arrived_at: '2026-09-02T00:00:00Z', ended_at: ended ? '2026-09-02T01:00:00Z' : null, sale_number: Number(id.replace('visit-', '')), zone, head_waiter: null });

describe('occupation courante et historique des ventes', () => {
  it('distingue les personnes présentes de toutes les personnes accueillies après deux reventes', () => {
    const visits = [visit('visit-1', 'table-12', 6, true), visit('visit-2', 'table-12', 4, true), visit('visit-3', 'table-12', 3)];
    expect(stats([table('table-12', 6)]).present).toBe(6);
    expect(stats([table('table-12', 4)]).present).toBe(4);
    expect(stats([table('table-12', 3)]).present).toBe(3);
    expect(activitySummary(visits, 1).clients).toBe(13);
  });

  it('retire une libération du Live sans supprimer son historique', () => {
    const visits = [visit('visit-1', 'table-12', 6, true), visit('visit-2', 'table-12', 4, true), visit('visit-3', 'table-12', 3, true)];
    const released = [table('table-12', 0)];
    expect(liveDashboard(released, [zone], []).present).toBe(0);
    expect(liveZoneDashboard(released, zone).present).toBe(0);
    expect(activitySummary(visits, 1).clients).toBe(13);
  });

  it('conserve le même total courant lors d’un transfert, sans doubler la visite', () => {
    const before = [table('table-10', 5), table('table-15', 0)];
    const after = [table('table-10', 0), table('table-15', 5)];
    const visits = [visit('visit-1', 'table-10', 5)];
    expect(stats(before).present).toBe(5);
    expect(stats(after).present).toBe(5);
    expect(activitySummary(visits, 2).clients).toBe(5);
  });

  it('recalcule correctement plusieurs tables lors d’une revente', () => {
    const current = [table('table-a', 3), table('table-b', 7)];
    const visits = [visit('visit-1', 'table-a', 5, true), visit('visit-2', 'table-a', 3), visit('visit-3', 'table-b', 7)];
    expect(stats(current).present).toBe(10);
    expect(activitySummary(visits, 2).clients).toBe(15);
  });

  it('clôture explicitement la visite puis remet seulement l’occupation à zéro dans la même RPC', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0026_explicit_current_occupancy_release.sql'), 'utf8');
    expect(migration).toContain("update public.table_visits set ended_at = now(), updated_at = now() where id = v_visit.id and ended_at is null");
    expect(migration).toContain("perform set_config('mazeout.release_in_progress', 'on', true)");
    expect(migration).toContain('update public.occupancies set present_people = 0, extra_guests = 0, comment = null, arrived_at = null where table_id = p_table_id');
    expect(migration).toContain("current_setting('mazeout.release_in_progress', true) = 'on'");
  });
});
