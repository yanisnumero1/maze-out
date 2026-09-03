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
  const inputRef = useRef<HTMLInputElement>(null);
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

  return <section ref={rootRef} className="relative z-40 mb-4 w-full max-w-4xl" aria-label="Recherche globale">
    <label className="sr-only" htmlFor="global-search">Rechercher une table, réservation, apporteur, promoteur ou CDR</label>
    <div className="group relative"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 transition group-focus-within:text-violet-300"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><span aria-hidden="true" className={`pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 text-sm text-zinc-500 sm:hidden ${input ? 'hidden' : ''}`}>Rechercher…</span><input ref={inputRef} id="global-search" type="search" autoComplete="off" value={input} onFocus={() => setOpen(true)} onChange={(event) => { setInput(event.target.value); setOpen(true); }} onKeyDown={onKeyDown} placeholder="Rechercher une table, réservation, apporteur, promoteur ou CDR…" className="min-h-11 w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-950/60 py-2.5 pl-10 pr-11 text-sm text-white outline-none placeholder:text-transparent transition focus:border-violet-500/60 focus:bg-zinc-950 focus:ring-2 focus:ring-violet-500/20 sm:placeholder:text-zinc-500" />{input && <button type="button" aria-label="Effacer la recherche" onMouseDown={(event) => event.preventDefault()} onClick={() => { setInput(''); setOpen(false); inputRef.current?.focus(); }} className="absolute inset-y-0 right-2 my-auto min-h-11 min-w-11 rounded-md text-xl text-zinc-400 transition hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">×</button>}</div>
    {open && input.trim() && <div className="absolute left-0 right-0 z-50 mt-1 max-h-[min(24rem,55dvh)] overflow-y-auto overscroll-contain border-t border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-sm">{visibleResults.length === 0 ? <p className="px-3 py-3 text-sm text-zinc-500">Aucun résultat</p> : visibleResults.map((result) => {
      const draft = 'table' in result ? drafts.find((item) => item.table_id === result.table.id) : undefined;
      const label = result.type === 'table' ? 'TABLE' : result.type === 'reservation' ? 'RÉSERVATION' : result.type === 'referrer' ? 'APPORTEUR' : result.type === 'promoter' ? 'PROMOTEUR' : 'CDR';
      const title = result.type === 'table' ? `Table ${getTableDisplayNumber(result.table)}` : result.type === 'reservation' ? result.visit.reservation_name || 'Réservation non renseignée' : result.type === 'referrer' ? result.referrer.name : result.type === 'promoter' ? result.promoter.name : `${result.headWaiter.first_name} ${result.headWaiter.last_name}`;
      const context = result.type === 'table' ? tableContext(result.table, draft) : result.type === 'reservation' ? `Table ${getTableDisplayNumber(result.table)} · ${tableContext(result.table, draft)}` : result.type === 'referrer' ? `Table ${getTableDisplayNumber(result.table)} · ${result.visit.reservation_name || 'Réservation non renseignée'}` : result.type === 'promoter' ? `${result.promoter.entry_count} entrées ce soir` : `${result.table.zone?.name ?? 'Carré non attribué'} · ${result.headWaiter ? `${result.headWaiter.first_name} ${result.headWaiter.last_name}` : ''}`;
      return <button type="button" key={result.key} onClick={() => choose(result)} className="group flex min-h-14 w-full items-center gap-3 border-b border-zinc-800/80 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-zinc-900 focus-visible:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"><span className="w-20 shrink-0 text-[9px] font-black tracking-[.14em] text-violet-300">{label}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm text-white">{title}</b><span className="mt-0.5 block truncate text-xs text-zinc-400">{context}</span></span><span aria-hidden="true" className="text-lg text-violet-300">›</span></button>;
    })}</div>}
  </section>;
}
