import { compareTableDisplayNumbers, getTableDisplayNumber } from '@/lib/tables';
import type { BusinessReferrer, HeadWaiter, LiveTable, Promoter, TableVisit } from '@/lib/types';

export const normaliseSearchQuery = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');

export function findTables(tables: LiveTable[], input: string) {
  const query = normaliseSearchQuery(input);
  if (!query) return [];
  const numericQuery = query.replace(/^table\s*/, '').replace(/\s/g, '');
  const numericSearch = /^\d+$/.test(numericQuery);
  return tables
    .filter((table) => {
      const displayNumber = getTableDisplayNumber(table);
      const waiter = table.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}`.toLocaleLowerCase('fr-FR') : '';
      if (!numericSearch) return !query.startsWith('table ') && waiter.includes(query);
      return displayNumber.includes(numericQuery) || `table ${displayNumber}`.includes(query);
    })
    .sort((left, right) => {
      const leftLabel = getTableDisplayNumber(left);
      const rightLabel = getTableDisplayNumber(right);
      const leftExact = leftLabel === numericQuery ? 0 : 1;
      const rightExact = rightLabel === numericQuery ? 0 : 1;
      return leftExact - rightExact || compareTableDisplayNumbers(leftLabel, rightLabel);
    });
}

export type GlobalSearchResult =
  | { type: 'table'; key: string; table: LiveTable }
  | { type: 'reservation'; key: string; visit: TableVisit; table: LiveTable }
  | { type: 'referrer'; key: string; referrer: BusinessReferrer; visit: TableVisit; table: LiveTable }
  | { type: 'promoter'; key: string; promoter: Promoter }
  | { type: 'cdr'; key: string; headWaiter: HeadWaiter; table: LiveTable };

export function findGlobalResults({ tables, visits, businessReferrers, promoters }: { tables: LiveTable[]; visits: TableVisit[]; businessReferrers: BusinessReferrer[]; promoters: Promoter[] }, input: string): GlobalSearchResult[] {
  const query = normaliseSearchQuery(input);
  if (!query) return [];
  const tablesById = new Map(tables.map((table) => [table.id, table]));
  const referrersById = new Map(businessReferrers.map((referrer) => [referrer.id, referrer]));
  const tableResults: GlobalSearchResult[] = findTables(tables, input).map((table) => ({ type: 'table', key: `table:${table.id}`, table }));
  const visitRows = visits.flatMap((visit) => {
    const table = tablesById.get(visit.current_table_id ?? visit.table_id);
    return table ? [{ visit, table }] : [];
  });
  const reservations: GlobalSearchResult[] = visitRows
    .filter(({ visit }) => normaliseSearchQuery(visit.reservation_name ?? '').includes(query))
    .map(({ visit, table }) => ({ type: 'reservation', key: `reservation:${visit.id}`, visit, table }));
  const referrerSales: GlobalSearchResult[] = visitRows.flatMap(({ visit, table }) => {
    const referrer = visit.business_referrer_id ? referrersById.get(visit.business_referrer_id) : undefined;
    return referrer && normaliseSearchQuery(referrer.name).includes(query) ? [{ type: 'referrer' as const, key: `referrer:${visit.id}`, referrer, visit, table }] : [];
  });
  const promoterResults: GlobalSearchResult[] = promoters
    .filter((promoter) => normaliseSearchQuery(promoter.name).includes(query))
    .map((promoter) => ({ type: 'promoter', key: `promoter:${promoter.id}`, promoter }));
  const cdrResults: GlobalSearchResult[] = Array.from(new Map(tables.filter((table) => table.head_waiter).map((table) => [table.head_waiter!.id, table])).values())
    .filter((table) => normaliseSearchQuery(`${table.head_waiter!.first_name} ${table.head_waiter!.last_name}`).includes(query))
    .map((table) => ({ type: 'cdr', key: `cdr:${table.head_waiter!.id}`, headWaiter: table.head_waiter!, table }));
  return [...tableResults, ...reservations, ...referrerSales, ...promoterResults, ...cdrResults];
}
