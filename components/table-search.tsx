'use client';

import { useMemo, useState } from 'react';
import { presentTotal } from '@/lib/live';
import type { ArrivalDraft, LiveTable } from '@/lib/types';

const MAX_RESULTS = 8;

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
  const visibleResults = results.slice(0, MAX_RESULTS);
  const remainingResults = results.length - visibleResults.length;

  return <section className="panel mb-5 border border-violet-500/30 bg-zinc-900/70 p-4" aria-label="Recherche de table">
    <div className="flex items-baseline justify-between gap-3">
      <label className="block text-sm font-bold text-zinc-200" htmlFor="table-search">Rechercher une table</label>
      <span className="hidden text-xs text-zinc-500 sm:block">Ex : 70, Table 70, Steven…</span>
    </div>
    <div className="relative mt-2">
      <input id="table-search" type="search" inputMode="search" autoComplete="off" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Rechercher une table..." className="w-full rounded-xl border border-zinc-700 bg-zinc-950 py-3 pl-4 pr-12 text-white outline-none placeholder:text-zinc-500 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30" />
      {queryInput && <button type="button" aria-label="Effacer la recherche" onClick={() => setQueryInput('')} className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white">×</button>}
    </div>
    {queryInput.trim() && <div className="mt-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/70">
      {visibleResults.length === 0 ? <p className="px-4 py-3 text-sm text-zinc-400">Aucune table trouvée.</p> : visibleResults.map((table) => {
        const draft = drafts.find((item) => item.table_id === table.id);
        const totalPeople = draft ? draft.present_people + draft.extra_guests : presentTotal(table);
        const capacity = table.max_people ?? table.standard_capacity;
        const state = draft
          ? { label: 'Arrivée en attente', className: 'border-orange-400/30 bg-orange-500/15 text-orange-200', people: `${totalPeople} pers.` }
          : totalPeople > 0
            ? { label: 'Occupée', className: 'border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-200', people: `${totalPeople}/${capacity} pers.` }
            : { label: 'Libre', className: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200', people: `0/${capacity} pers.` };
        const waiter = table.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}` : 'CDR non attribué';
        return <button type="button" key={table.id} onClick={() => onSelect(table)} className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 px-4 py-3 text-left transition hover:bg-zinc-900 focus-visible:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 sm:flex-nowrap"><div className="min-w-0 flex-1"><b className="block text-base tracking-wide text-white">TABLE {table.display_number}</b><span className="mt-0.5 block truncate text-sm text-zinc-400">{table.zone?.name} · {waiter}</span></div><span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${state.className}`}>{state.label}</span><span className="shrink-0 text-sm font-semibold text-zinc-200">{state.people}</span><span aria-hidden="true" className="ml-auto text-lg text-violet-300/80 transition group-hover:translate-x-0.5">›</span></button>;
      })}
      {remainingResults > 0 && <p className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">{remainingResults} autre{remainingResults !== 1 ? 's' : ''} résultat{remainingResults !== 1 ? 's' : ''}</p>}
    </div>}
  </section>;
}
