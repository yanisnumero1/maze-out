import { describe, expect, it } from 'vitest';
import { findTables } from '@/components/table-search';
import type { LiveTable } from '@/lib/types';

const zone = { id: 'zone', name: 'Carré 1', display_order: 1, active: true };
const waiter = { id: 'waiter', first_name: 'Samir', last_name: '', color: null, active: true };
const table = (number: number): LiveTable => ({ id: `table-${number}`, number: String(number), display_number: number, zone_id: zone.id, head_waiter_id: waiter.id, standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: waiter, reservation: null, occupancy: null });

describe('recherche directe de table', () => {
  const tables = [table(1), table(12), table(72)];

  it('trouve une table par numéro ou préfixe Table, avec priorité exacte', () => {
    expect(findTables(tables, '12').map((item) => item.display_number)).toEqual([12]);
    expect(findTables(tables, ' Table   12 ').map((item) => item.display_number)).toEqual([12]);
  });

  it('ne retourne rien pour un numéro inexistant et garde une recherche CDR cohérente', () => {
    expect(findTables(tables, '99')).toEqual([]);
    expect(findTables(tables, 'Samir')).toHaveLength(3);
  });
});
