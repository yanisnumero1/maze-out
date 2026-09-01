import type { LiveTable, TableVisit } from './types';
import { compareTablesForDisplay } from './tables';

export type CdrLiveTableRow = { table: LiveTable; visit: TableVisit | null };

function compareCdrTables(left: LiveTable, right: LiveTable): number {
  return compareTablesForDisplay(left, right) || left.id.localeCompare(right.id);
}

export function cdrLiveTableRows(tables: LiveTable[], visits: TableVisit[], headWaiterId: string): CdrLiveTableRow[] {
  const activeVisitsByCurrentTable = new Map(
    visits
      .filter((visit) => visit.ended_at === null)
      .map((visit) => [visit.current_table_id ?? visit.table_id, visit]),
  );

  return tables
    .filter((table) => table.head_waiter_id === headWaiterId)
    .sort(compareCdrTables)
    .map((table) => ({ table, visit: activeVisitsByCurrentTable.get(table.id) ?? null }));
}
