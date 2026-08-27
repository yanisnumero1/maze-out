import type { HeadWaiter, LiveTable, TableVisit, Zone } from './types';

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
