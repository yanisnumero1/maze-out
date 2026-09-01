import type { LiveTable, TableVisit } from './types';

export type CdrLiveTableRow = { table: LiveTable; visit: TableVisit | null };
const tableLabelCollator = new Intl.Collator('fr-FR', { numeric: true, sensitivity: 'base' });

function compareCdrTables(left: LiveTable, right: LiveTable): number {
  const leftDisplayNumber = left.display_number;
  const rightDisplayNumber = right.display_number;
  if (typeof leftDisplayNumber === 'number' && typeof rightDisplayNumber === 'number' && leftDisplayNumber !== rightDisplayNumber) {
    return leftDisplayNumber - rightDisplayNumber;
  }
  return tableLabelCollator.compare(left.number, right.number) || left.id.localeCompare(right.id);
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
