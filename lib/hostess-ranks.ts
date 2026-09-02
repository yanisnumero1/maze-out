import type { HeadWaiter, LiveTable } from './types';
import { presentTotal } from './live';

export type HostessCdrRank = {
  headWaiter: HeadWaiter;
  tables: LiveTable[];
  occupiedTables: number;
  presentPeople: number;
};

export function hostessCdrRanks(tables: LiveTable[]): HostessCdrRank[] {
  const activeTables = tables.filter((table) => table.active);
  const headWaiters = [...new Map(
    activeTables
      .filter((table) => table.head_waiter)
      .map((table) => [table.head_waiter!.id, table.head_waiter!] as const),
  ).values()];

  return headWaiters.map((headWaiter) => {
    const rankTables = activeTables.filter((table) => table.head_waiter_id === headWaiter.id);
    return {
      headWaiter,
      tables: rankTables,
      occupiedTables: rankTables.filter((table) => presentTotal(table) > 0).length,
      presentPeople: rankTables.reduce((total, table) => total + presentTotal(table), 0),
    };
  });
}
