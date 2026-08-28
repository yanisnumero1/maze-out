import type { ClubEntryCount, FloorNote, HeadWaiter, LiveTable, Promoter, TableVisit, Zone } from './types';

export type ActivitySummary = {
  clients: number;
  extraGuests: number;
  usedTables: number;
  totalTables: number;
  usageRate: number;
};

export const activitySummary = (visits: TableVisit[], totalTables: number): ActivitySummary => {
  const clients = visits.reduce((total, visit) => total + visit.present_people + visit.extra_guests, 0);
  const extraGuests = visits.reduce((total, visit) => total + visit.extra_guests, 0);
  const usedTables = new Set(visits.map((visit) => visit.table_id)).size;
  return { clients, extraGuests, usedTables, totalTables, usageRate: totalTables ? Math.round((usedTables / totalTables) * 100) : 0 };
};

export const recapZones = (tables: LiveTable[], visits: TableVisit[]) => {
  const zones = [...new Map(tables.map((table) => [table.zone.id, table.zone])).values()].sort((left, right) => left.display_order - right.display_order);
  return zones.map((zone) => ({ zone, summary: activitySummary(visits.filter((visit) => visit.zone_id === zone.id), tables.filter((table) => table.zone_id === zone.id).length) }));
};

export const recapWaiters = (tables: LiveTable[], visits: TableVisit[]) => {
  const waiters = [...new Map<string, HeadWaiter>([
    ...tables.filter((table) => table.head_waiter).map((table) => [table.head_waiter!.id, table.head_waiter!] as [string, HeadWaiter]),
    ...visits.filter((visit) => visit.head_waiter).map((visit) => [visit.head_waiter!.id, visit.head_waiter!] as [string, HeadWaiter]),
  ])].map(([, waiter]) => waiter);

  return waiters.map((waiter) => {
    const activity = visits.filter((visit) => visit.head_waiter_id === waiter.id);
    return {
      waiter,
      assignedTables: tables.filter((table) => table.head_waiter_id === waiter.id).length,
      summary: activitySummary(activity, tables.filter((table) => table.head_waiter_id === waiter.id).length),
    };
  });
};

export type RecapTable = {
  tableId: string;
  tableNumber: number | string;
  zone: Zone | null;
  waiter: HeadWaiter | null;
  visits: TableVisit[];
  sales: number;
  people: number;
  extraGuests: number;
};

export const recapTables = (visits: TableVisit[], tableNumbers: Map<string, number | string>) => {
  const grouped = new Map<string, TableVisit[]>();
  visits.forEach((visit) => grouped.set(visit.table_id, [...(grouped.get(visit.table_id) ?? []), visit]));
  return [...grouped.entries()].map(([tableId, tableVisits]) => {
    const chronological = [...tableVisits].sort((left, right) => new Date(left.arrived_at).getTime() - new Date(right.arrived_at).getTime());
    return {
      tableId,
      tableNumber: tableNumbers.get(tableId) ?? tableId,
      zone: chronological[0]?.zone ?? null,
      waiter: chronological[0]?.head_waiter ?? null,
      visits: chronological,
      sales: chronological.length,
      people: chronological.reduce((total, visit) => total + visit.present_people + visit.extra_guests, 0),
      extraGuests: chronological.reduce((total, visit) => total + visit.extra_guests, 0),
    } satisfies RecapTable;
  }).sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber));
};

export const recapRotations = (tables: RecapTable[]) => [...tables].sort((left, right) => right.sales - left.sales || Number(left.tableNumber) - Number(right.tableNumber));

export const totalClubEntryCount = (counts: ClubEntryCount[]) => counts.reduce((total, entry) => total + entry.count, 0);
export const promoterTotal = (promoters: Promoter[]) => promoters.reduce((total, promoter) => total + promoter.entry_count, 0);
export const selectedNightNotes = (notes: FloorNote[], nightSessionId: string) => notes.filter((note) => note.night_session_id === nightSessionId).sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
