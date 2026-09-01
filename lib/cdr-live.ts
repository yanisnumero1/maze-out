import type { LiveTable, TableVisit } from './types';

export type CdrLiveTableRow = { table: LiveTable; visit: TableVisit | null };

export function cdrLiveTableRows(tables: LiveTable[], visits: TableVisit[], headWaiterId: string): CdrLiveTableRow[] {
  const activeVisitsByCurrentTable = new Map(
    visits
      .filter((visit) => visit.ended_at === null)
      .map((visit) => [visit.current_table_id ?? visit.table_id, visit]),
  );

  return tables
    .filter((table) => table.head_waiter_id === headWaiterId)
    .sort((left, right) => (left.display_number ?? Number(left.number)) - (right.display_number ?? Number(right.number)))
    .map((table) => ({ table, visit: activeVisitsByCurrentTable.get(table.id) ?? null }));
}
