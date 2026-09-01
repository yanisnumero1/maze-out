import type { LiveTable } from './types';

export type TableLabelSource = Pick<LiveTable, 'number'> & {
  display_number?: number | string | null;
};

const tableLabelCollator = new Intl.Collator('fr-FR', { numeric: true, sensitivity: 'base' });

/**
 * Returns the human-facing table label without changing its business value.
 * Table identity always remains the UUID (`table.id`).
 */
export function getTableDisplayNumber(table: TableLabelSource): string {
  const displayNumber = table.display_number;

  if (typeof displayNumber === 'string' && displayNumber.trim().length > 0) return displayNumber;
  if (typeof displayNumber === 'number') return String(displayNumber);

  return table.number;
}

export function compareTableDisplayNumbers(left: string, right: string): number {
  return tableLabelCollator.compare(left, right);
}

export function compareTablesForDisplay(left: TableLabelSource, right: TableLabelSource): number {
  return compareTableDisplayNumbers(getTableDisplayNumber(left), getTableDisplayNumber(right));
}
