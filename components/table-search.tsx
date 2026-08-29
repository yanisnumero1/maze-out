'use client';

import { useMemo, useState } from 'react';
import { computedStatus, presentTotal } from '@/lib/live';
import type { ArrivalDraft, LiveTable } from '@/lib/types';

export function TableSearch({ tables, drafts, onSelect }: { tables: LiveTable[]; drafts: ArrivalDraft[]; onSelect: (table: LiveTable) => void }) {
  const [queryInput, setQueryInput] = useState('');
  const results = useMemo(() => {
    const query = queryInput.trim().toLocaleLowerCase('fr-FR');
    if (!query) return [];
    const numericQuery = query.replace(/^table\s*/, '');
    return tables
      .filter((table) => {
        const displayNumber = String(table.display_number ?? '');
        const waiter = table.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}`.toLocaleLowerCase('fr-FR') : '';
        return displayNumber.includes(numericQuery) || `table ${displayNumber}`.includes(query) || waiter.includes(query);
      })
      .sort((left, right) => {
        const leftExact = String(left.display_number) === numericQuery ? 0 : 1;
        const rightExact = String(right.display_number) === numericQuery ? 0 : 1;
        return leftExact - rightExact || (left.display_number ?? 0) - (right.display_number ?? 0);
      });
  }, [queryInput, tables]);

  return <section className="panel mb-5 border border-violet-500/30 bg-zinc-900/70 p-4" aria-label="Recherche de table">
    <label className="block text-sm font-bold text-zinc-200" htmlFor="table-search">Rechercher une table</label>
    <input id="table-search" type="search" inputMode="search" autoComplete="off" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Rechercher une table..." className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none placeholder:text-zinc-500 focus:border-violet-400" />
    {queryInput.trim() && <div className="mt-3 grid gap-2">
      {results.length === 0 ? <p className="rounded-xl bg-zinc-950/70 px-4 py-3 text-sm text-zinc-400">Aucune table trouvée.</p> : results.map((table) => {
        const draft = drafts.find((item) => item.table_id === table.id);
        const statusLabel = draft ? 'ARRIVÉE EN ATTENTE' : computedStatus(table) === 'free' ? 'LIBRE' : 'OCCUPÉE';
        const statusClass = draft ? 'text-orange-300' : computedStatus(table) === 'free' ? 'text-emerald-300' : 'text-fuchsia-200';
        const waiter = table.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}` : 'CDR non attribué';
        const people = draft ? draft.present_people + draft.extra_guests : presentTotal(table);
        return <button type="button" key={table.id} onClick={() => onSelect(table)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-950/70 p-3 text-left transition hover:border-violet-400 hover:bg-zinc-900"><div className="min-w-0"><b className="block">TABLE {table.display_number}</b><span className="mt-1 block truncate text-sm text-zinc-400">{table.zone?.name} · {waiter}</span>{people > 0 && <span className="mt-1 block text-xs text-zinc-300">{people} personne{people !== 1 ? 's' : ''}</span>}</div><span className={`ml-auto shrink-0 text-xs font-bold ${statusClass}`}>{statusLabel}</span></button>;
      })}
    </div>}
  </section>;
}
