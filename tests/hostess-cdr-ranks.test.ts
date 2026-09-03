import { describe, expect, it } from 'vitest';
import { hostessCdrRanks } from '@/lib/hostess-ranks';
import type { HeadWaiter, LiveTable, Zone } from '@/lib/types';

const zone: Zone = { id: 'zone-1', name: 'Carré 1', display_order: 1, active: true };
const samir: HeadWaiter = { id: 'samir', first_name: 'Samir', last_name: '', color: null, active: true };
const karim: HeadWaiter = { id: 'karim', first_name: 'Karim', last_name: '', color: null, active: true };
const table = (id: string, waiter: HeadWaiter, people = 0, active = true): LiveTable => ({
  id,
  number: id,
  display_number: id,
  zone_id: zone.id,
  head_waiter_id: waiter.id,
  standard_capacity: 7,
  status: 'free',
  position_x: 0,
  position_y: 0,
  active,
  zone,
  head_waiter: waiter,
  reservation: null,
  occupancy: { table_id: id, present_people: people, extra_guests: 0, comment: null, arrived_at: people ? '2026-09-03T00:00:00Z' : null, updated_at: '' },
});

describe('synthèse live des rangs CDR', () => {
  it('conserve tous les CDR du carré, même sans occupation', () => {
    const ranks = hostessCdrRanks([table('01', samir), table('09', karim)]);
    expect(ranks.map((rank) => rank.headWaiter.id)).toEqual(['samir', 'karim']);
    expect(ranks[0]).toMatchObject({ occupiedTables: 0, presentPeople: 0 });
  });

  it('compte uniquement les tables actives actuellement occupées et les personnes présentes', () => {
    const [rank] = hostessCdrRanks([table('01', samir, 5), table('02', samir, 7), table('03', samir), table('04', samir, 9, false)]);
    expect(rank).toMatchObject({ occupiedTables: 2, presentPeople: 12 });
    expect(rank.tables.map((item) => item.display_number)).toEqual(['01', '02', '03']);
  });

  it('recalcule une arrivée puis une libération depuis les occupations live', () => {
    expect(hostessCdrRanks([table('01', samir)])[0]).toMatchObject({ occupiedTables: 0, presentPeople: 0 });
    expect(hostessCdrRanks([table('01', samir, 6)])[0]).toMatchObject({ occupiedTables: 1, presentPeople: 6 });
    expect(hostessCdrRanks([table('01', samir)])[0]).toMatchObject({ occupiedTables: 0, presentPeople: 0 });
  });

  it('reflète un transfert sur le CDR actuel de la table destination', () => {
    const before = hostessCdrRanks([table('01', samir, 5), table('09', karim)]);
    const after = hostessCdrRanks([table('01', samir), table('09', karim, 5)]);
    expect(before.map(({ occupiedTables, presentPeople }) => ({ occupiedTables, presentPeople }))).toEqual([{ occupiedTables: 1, presentPeople: 5 }, { occupiedTables: 0, presentPeople: 0 }]);
    expect(after.map(({ occupiedTables, presentPeople }) => ({ occupiedTables, presentPeople }))).toEqual([{ occupiedTables: 0, presentPeople: 0 }, { occupiedTables: 1, presentPeople: 5 }]);
  });

  it('ne double-compte pas une revente car seul l’état actuel de la table est lu', () => {
    const [rank] = hostessCdrRanks([table('01', samir, 4)]);
    expect(rank).toMatchObject({ occupiedTables: 1, presentPeople: 4 });
  });

  it('conserve le nombre variable et les vrais numéros des tables du rang', () => {
    const fourTables = hostessCdrRanks(['01', '08', '15', '23'].map((number) => table(number, samir)))[0];
    const twelveTables = hostessCdrRanks(['01', '02', '08', '09', '15', '16', '22', '23', '29', '30', '36', '37'].map((number) => table(number, samir)))[0];
    expect(fourTables.tables.map((item) => item.display_number)).toEqual(['01', '08', '15', '23']);
    expect(twelveTables.tables).toHaveLength(12);
  });
});
