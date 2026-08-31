import type { ClubEntryCount, FloorNote, HeadWaiter, LiveTable, Promoter, TableVisit, TableVisitTransfer, Zone } from './types';

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

export type RecapRanking = {
  id: string;
  label: string;
  sales: number;
  people: number;
  tables: number;
  rotations: number;
  share: number;
};

export type RecapAnalytics = {
  totalSales: number;
  totalPeople: number;
  distinctTables: number;
  rotations: number;
  transferredVisits: number;
  tableRows: RecapTable[];
  topSalesTables: RecapTable[];
  topPeopleTables: RecapTable[];
  zones: RecapRanking[];
  waiters: RecapRanking[];
  promoters: { id: string; label: string; people: number; share: number }[];
};

const percentage = (value: number, total: number) => total ? Math.round((value / total) * 100) : 0;
const tableNumber = (table: RecapTable) => Number(table.tableNumber) || Number.MAX_SAFE_INTEGER;

export function recapAnalytics(tables: LiveTable[], visits: TableVisit[], transfers: TableVisitTransfer[], promoters: Promoter[]): RecapAnalytics {
  const tableRows = recapTables(visits, new Map(tables.map((table) => [table.id, table.display_number ?? table.number])));
  const totalSales = visits.length;
  const totalPeople = activitySummary(visits, tables.length).clients;
  const distinctTables = tableRows.length;
  const rotations = tableRows.reduce((total, table) => total + Math.max(0, table.sales - 1), 0);
  const zones = recapZones(tables, visits).map(({ zone, summary }) => {
    const sales = visits.filter((visit) => visit.zone_id === zone.id).length;
    return { id: zone.id, label: zone.name, sales, people: summary.clients, tables: summary.usedTables, rotations: Math.max(0, sales - summary.usedTables), share: percentage(sales, totalSales) };
  }).sort((left, right) => right.sales - left.sales || left.label.localeCompare(right.label, 'fr'));
  const waiters = recapWaiters(tables, visits).map(({ waiter, summary }) => {
    const sales = visits.filter((visit) => visit.head_waiter_id === waiter.id).length;
    return { id: waiter.id, label: `${waiter.first_name} ${waiter.last_name}`.trim(), sales, people: summary.clients, tables: summary.usedTables, rotations: Math.max(0, sales - summary.usedTables), share: percentage(sales, totalSales) };
  }).sort((left, right) => right.sales - left.sales || left.label.localeCompare(right.label, 'fr'));
  const totalPromoters = promoterTotal(promoters);
  return {
    totalSales,
    totalPeople,
    distinctTables,
    rotations,
    transferredVisits: transfers.length,
    tableRows,
    topSalesTables: [...tableRows].sort((left, right) => right.sales - left.sales || tableNumber(left) - tableNumber(right)).slice(0, 10),
    topPeopleTables: [...tableRows].sort((left, right) => right.people - left.people || tableNumber(left) - tableNumber(right)).slice(0, 10),
    zones,
    waiters,
    promoters: [...promoters].map((promoter) => ({ id: promoter.id, label: promoter.name, people: promoter.entry_count, share: percentage(promoter.entry_count, totalPromoters) })).sort((left, right) => right.people - left.people || left.label.localeCompare(right.label, 'fr')),
  };
}
