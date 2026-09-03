'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { presentTotal } from '@/lib/live';
import { getTableDisplayNumber } from '@/lib/tables';
import { findGlobalResults, normaliseSearchQuery, type GlobalSearchResult } from '@/lib/global-search';
import type { ArrivalDraft, BusinessReferrer, LiveTable, Promoter, TableVisit } from '@/lib/types';

const MAX_RESULTS = 12;

function tableContext(table: LiveTable, draft: ArrivalDraft | undefined) {
  const total = draft ? draft.present_people + draft.extra_guests : presentTotal(table);
  const status = draft ? 'Arrivée en attente' : total > 0 ? 'Occupée' : 'Libre';
  const waiter = table.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}` : 'CDR non attribué';
  return `${table.zone?.name ?? 'Carré non attribué'} · ${waiter} · ${status}`;
}

export function GlobalSearch({ tables, drafts, visits, businessReferrers, promoters, onSelectTable, onSelectPromoter, onSelectCdr }: { tables: LiveTable[]; drafts: ArrivalDraft[]; visits: TableVisit[]; businessReferrers: BusinessReferrer[]; promoters: Promoter[]; onSelectTable: (table: LiveTable) => void; onSelectPromoter: (promoter: Promoter) => void; onSelectCdr: (table: LiveTable) => void }) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const results = useMemo(() => findGlobalResults({ tables, visits, businessReferrers, promoters }, input), [businessReferrers, input, promoters, tables, visits]);
  const visibleResults = results.slice(0, MAX_RESULTS);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function choose(result: GlobalSearchResult) {
    setInput(''); setOpen(false);
    if (result.type === 'promoter') return onSelectPromoter(result.promoter);
    if (result.type === 'cdr') return onSelectCdr(result.table);
    onSelectTable(result.table);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setOpen(false); return; }
    if (event.key !== 'Enter') return;
    const number = normaliseSearchQuery(input).replace(/^table\s*/, '').replace(/\s/g, '');
    const exactTable = results.filter((result): result is Extract<GlobalSearchResult, { type: 'table' }> => result.type === 'table' && getTableDisplayNumber(result.table) === number);
    if (exactTable.length === 1) { event.preventDefault(); choose(exactTable[0]); }
  }

  return <section ref={rootRef} className="panel relative z-40 mb-5 border border-violet-500/30 bg-zinc-900/70 p-3 sm:p-4" aria-label="Recherche globale">
    <label className="block text-sm font-bold text-zinc-200" htmlFor="global-search">Recherche rapide</label>
    <div className="relative mt-2"><input id="global-search" type="search" autoComplete="off" value={input} onFocus={() => setOpen(true)} onChange={(event) => { setInput(event.target.value); setOpen(true); }} onKeyDown={onKeyDown} placeholder="Rechercher table, réservation, apporteur, promoteur ou CDR…" className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 py-3 pl-4 pr-12 text-white outline-none placeholder:text-zinc-500 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30" />{input && <button type="button" aria-label="Effacer la recherche" onClick={() => { setInput(''); setOpen(false); }} className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2 text-zinc-400 hover:bg-zinc-800 hover:text-white">×</button>}</div>
    {open && input.trim() && <div className="absolute left-3 right-3 z-50 mt-3 max-h-[min(30rem,65dvh)] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:left-4 sm:right-4">{visibleResults.length === 0 ? <p className="px-4 py-3 text-sm text-zinc-400">Aucun résultat.</p> : visibleResults.map((result) => {
      const draft = 'table' in result ? drafts.find((item) => item.table_id === result.table.id) : undefined;
      const label = result.type === 'table' ? 'TABLE' : result.type === 'reservation' ? 'RÉSERVATION' : result.type === 'referrer' ? 'APPORTEUR' : result.type === 'promoter' ? 'PROMOTEUR' : 'CDR';
      const title = result.type === 'table' ? `Table ${getTableDisplayNumber(result.table)}` : result.type === 'reservation' ? result.visit.reservation_name || 'Réservation non renseignée' : result.type === 'referrer' ? result.referrer.name : result.type === 'promoter' ? result.promoter.name : `${result.headWaiter.first_name} ${result.headWaiter.last_name}`;
      const context = result.type === 'table' ? tableContext(result.table, draft) : result.type === 'reservation' ? `Table ${getTableDisplayNumber(result.table)} · ${tableContext(result.table, draft)}` : result.type === 'referrer' ? `Table ${getTableDisplayNumber(result.table)} · ${result.visit.reservation_name || 'Réservation non renseignée'}` : result.type === 'promoter' ? `${result.promoter.entry_count} entrées ce soir` : `${result.table.zone?.name ?? 'Carré non attribué'} · ${result.headWaiter ? `${result.headWaiter.first_name} ${result.headWaiter.last_name}` : ''}`;
      return <button type="button" key={result.key} onClick={() => choose(result)} className="group flex min-h-16 w-full items-center gap-3 border-b border-zinc-800 px-4 py-3 text-left transition hover:bg-zinc-900 focus-visible:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"><span className="w-24 shrink-0 text-[10px] font-black tracking-[.14em] text-violet-300">{label}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-white">{title}</b><span className="mt-0.5 block truncate text-xs text-zinc-400">{context}</span></span><span aria-hidden="true" className="text-lg text-violet-300">›</span></button>;
    })}</div>}
  </section>;
}
