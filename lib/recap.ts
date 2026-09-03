import type { BusinessReferrer, ClubEntryCount, FloorNote, HeadWaiter, LiveTable, Promoter, TableVisit, TableVisitTransfer, Zone } from './types';
import { compareTableDisplayNumbers, getTableDisplayNumber } from './tables';

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
  }).sort((left, right) => compareTableDisplayNumbers(String(left.tableNumber), String(right.tableNumber)));
};

export const recapRotations = (tables: RecapTable[]) => [...tables].sort((left, right) => right.sales - left.sales || compareTableDisplayNumbers(String(left.tableNumber), String(right.tableNumber)));

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

export type CdrVisitNote = {
  visitId: string;
  tableId: string;
  tableNumber: string;
  saleNumber: number | null;
  headWaiterName: string;
  people: number;
  businessReferrer: string | null;
  cdrComment: string | null;
};

export type BusinessReferrerRanking = {
  key: string;
  label: string;
  sales: number;
  people: number;
};

export type AdminSaleDetail = {
  visitId: string;
  saleNumber: number | null;
  originTable: string;
  finalTable: string;
  finalHeadWaiterName: string;
  reservationName: string | null;
  consumption: string | null;
  saleComment: string | null;
  cdrComment: string | null;
  cdrAmount: number | null;
  proposedBusinessReferrerName: string | null;
  validatedBusinessReferrerName: string | null;
  arrivedAt: string;
};

const meaningfulText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function recapSaleDetails(visits: TableVisit[], tables: LiveTable[], referrers: BusinessReferrer[]): AdminSaleDetail[] {
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const waiterById = new Map(tables.flatMap((table) => table.head_waiter ? [[table.head_waiter.id, table.head_waiter] as const] : []));
  const referrerById = new Map(referrers.map((referrer) => [referrer.id, referrer]));
  return [...visits].map((visit) => {
    const origin = tableById.get(visit.table_id);
    const final = tableById.get(visit.current_table_id ?? visit.table_id);
    const finalWaiter = visit.final_head_waiter_id ? waiterById.get(visit.final_head_waiter_id) : null;
    return {
      visitId: visit.id,
      saleNumber: visit.sale_number ?? null,
      originTable: origin ? String(getTableDisplayNumber(origin)) : visit.table_id,
      finalTable: final ? String(getTableDisplayNumber(final)) : String(visit.current_table_id ?? visit.table_id),
      finalHeadWaiterName: finalWaiter ? `${finalWaiter.first_name} ${finalWaiter.last_name}`.trim() : (visit.head_waiter ? `${visit.head_waiter.first_name} ${visit.head_waiter.last_name}`.trim() : '—'),
      reservationName: meaningfulText(visit.reservation_name),
      consumption: meaningfulText(visit.consumption),
      saleComment: meaningfulText(visit.sale_comment),
      cdrComment: meaningfulText(visit.cdr_comment),
      cdrAmount: visit.cdr_amount ?? null,
      proposedBusinessReferrerName: meaningfulText(visit.proposed_business_referrer_name),
      validatedBusinessReferrerName: visit.business_referrer_id ? referrerById.get(visit.business_referrer_id)?.name ?? null : null,
      arrivedAt: visit.arrived_at,
    };
  }).sort((left, right) => new Date(right.arrivedAt).getTime() - new Date(left.arrivedAt).getTime() || (right.saleNumber ?? 0) - (left.saleNumber ?? 0));
}

export function cdrVisitNotes(visits: TableVisit[], tableNumbers: Map<string, number | string>): CdrVisitNote[] {
  return visits
    .map((visit) => ({
      visitId: visit.id,
      tableId: visit.table_id,
      tableNumber: String(tableNumbers.get(visit.table_id) ?? visit.table_id),
      saleNumber: visit.sale_number ?? null,
      headWaiterName: visit.head_waiter ? `${visit.head_waiter.first_name} ${visit.head_waiter.last_name}`.trim() : 'CDR non attribué',
      people: visit.present_people + visit.extra_guests,
      businessReferrer: meaningfulText(visit.business_referrer),
      cdrComment: meaningfulText(visit.cdr_comment),
    }))
    .filter((visit) => visit.businessReferrer !== null || visit.cdrComment !== null)
    .sort((left, right) => left.tableNumber.localeCompare(right.tableNumber, 'fr', { numeric: true }) || (left.saleNumber ?? 0) - (right.saleNumber ?? 0));
}

export function businessReferrerRanking(visits: TableVisit[]): BusinessReferrerRanking[] {
  const rankings = new Map<string, BusinessReferrerRanking>();
  for (const visit of visits) {
    const label = meaningfulText(visit.business_referrer);
    if (!label) continue;
    const key = label.toLocaleLowerCase('fr-FR');
    const current = rankings.get(key) ?? { key, label, sales: 0, people: 0 };
    current.sales += 1;
    current.people += visit.present_people + visit.extra_guests;
    rankings.set(key, current);
  }
  return [...rankings.values()].sort((left, right) => right.people - left.people || right.sales - left.sales || left.label.localeCompare(right.label, 'fr'));
}

const percentage = (value: number, total: number) => total ? Math.round((value / total) * 100) : 0;
const compareRecapTableNumbers = (left: RecapTable, right: RecapTable) => compareTableDisplayNumbers(String(left.tableNumber), String(right.tableNumber));
const recapTableDisplayValue = (table: LiveTable): number | string => {
  const displayNumber = table.display_number;
  if (typeof displayNumber === 'number') return displayNumber;
  if (typeof displayNumber === 'string' && displayNumber.trim().length > 0) return displayNumber;
  return getTableDisplayNumber(table);
};

export function recapAnalytics(tables: LiveTable[], visits: TableVisit[], transfers: TableVisitTransfer[], promoters: Promoter[]): RecapAnalytics {
  const tableRows = recapTables(visits, new Map(tables.map((table) => [table.id, recapTableDisplayValue(table)])));
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
    topSalesTables: [...tableRows].sort((left, right) => right.sales - left.sales || compareRecapTableNumbers(left, right)).slice(0, 10),
    topPeopleTables: [...tableRows].sort((left, right) => right.people - left.people || compareRecapTableNumbers(left, right)).slice(0, 10),
    zones,
    waiters,
    promoters: [...promoters].map((promoter) => ({ id: promoter.id, label: promoter.name, people: promoter.entry_count, share: percentage(promoter.entry_count, totalPromoters) })).sort((left, right) => right.people - left.people || left.label.localeCompare(right.label, 'fr')),
  };
}
