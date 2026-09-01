'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cdrLiveTableRows } from '@/lib/cdr-live';
import { presentTotal, stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';
import { getTableDisplayNumber } from '@/lib/tables';
import type { LiveTable, TableVisit } from '@/lib/types';

type NoteDraft = { comment: string; referrer: string };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function normalise(rows: unknown[]): LiveTable[] {
  return rows.map((row: any) => ({ ...row, occupancy: Array.isArray(row.occupancy) ? row.occupancy[0] ?? null : row.occupancy ?? null, reservation: null })) as LiveTable[];
}

export function CdrConsole() {
  const router = useRouter();
  const [tables, setTables] = useState<LiveTable[]>([]);
  const [visits, setVisits] = useState<TableVisit[]>([]);
  const [headWaiterId, setHeadWaiterId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, NoteDraft>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [name, setName] = useState('Chef de rang');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) { setError('Session indisponible.'); setLoading(false); return; }
    const { data: profile, error: profileError } = await supabase.from('profiles').select('first_name,last_name,head_waiter_id,role').eq('id', userData.user.id).single();
    if (profileError || profile?.role !== 'cdr' || !profile.head_waiter_id) {
      console.error('[CDR] Profil CDR invalide ou non associé.', profileError);
      setError('Ce compte CDR doit être associé à un chef de rang.'); setLoading(false); return;
    }
    const [tableResult, visitResult] = await Promise.all([
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), occupancy:occupancies(*)').eq('active', true).order('display_number'),
      supabase.from('table_visits').select('*').is('ended_at', null),
    ]);
    if (tableResult.error) {
      console.error('[CDR] Impossible de charger les tables autorisées.', tableResult.error);
      setError('Impossible de charger vos tables.'); setLoading(false); return;
    }
    const loadedTables = normalise(tableResult.data ?? []);
    const waiter = loadedTables[0]?.head_waiter;
    setName(waiter ? `${waiter.first_name} ${waiter.last_name}`.trim() : `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Chef de rang');
    setHeadWaiterId(profile.head_waiter_id);
    setTables(loadedTables);
    if (visitResult.error) {
      console.error('[CDR] Impossible de charger les visites actives.', visitResult.error);
      setVisits([]);
    } else {
      const loadedVisits = (visitResult.data ?? []) as TableVisit[];
      setVisits(loadedVisits);
      setNotes(Object.fromEntries(loadedVisits.map((visit) => [visit.id, { comment: visit.cdr_comment ?? '', referrer: visit.business_referrer ?? '' }])));
    }
    setError(null); setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('cdr-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

  const tableRows = useMemo(() => headWaiterId ? cdrLiveTableRows(tables, visits, headWaiterId) : [], [headWaiterId, tables, visits]);
  const summary = stats(tableRows.map(({ table }) => table));

  function updateNote(visitId: string, key: keyof NoteDraft, value: string) {
    setNotes((current) => ({ ...current, [visitId]: { comment: current[visitId]?.comment ?? '', referrer: current[visitId]?.referrer ?? '', [key]: value } }));
    setSaveStates((current) => ({ ...current, [visitId]: 'idle' }));
  }

  async function saveNotes(visit: TableVisit) {
    const draft = notes[visit.id] ?? { comment: visit.cdr_comment ?? '', referrer: visit.business_referrer ?? '' };
    setSaveStates((current) => ({ ...current, [visit.id]: 'saving' }));
    const { data, error: saveError } = await supabase.rpc('update_cdr_visit_notes', { p_visit_id: visit.id, p_cdr_comment: draft.comment || null, p_business_referrer: draft.referrer || null });
    if (saveError) {
      console.error('[CDR] Enregistrement des notes impossible.', saveError);
      setSaveStates((current) => ({ ...current, [visit.id]: 'error' }));
      return;
    }
    setVisits((current) => current.map((item) => item.id === visit.id ? { ...item, ...(data as Partial<TableVisit>) } : item));
    setSaveStates((current) => ({ ...current, [visit.id]: 'saved' }));
  }

  async function signOut() { const { error: signOutError } = await supabase.auth.signOut(); if (signOutError) console.error('[CDR] Déconnexion impossible.', signOutError); router.replace('/login'); }

  return <main className="mx-auto min-h-dvh max-w-2xl px-4 py-4 sm:px-6">
    <header className="mb-6 flex items-center gap-3 border-b border-zinc-800 pb-4">
      <Image src="/bridge-logo.png" alt="BRIDGE — Pont Alexandre III" width={128} height={46} className="h-8 w-24 object-contain" />
      <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.2em] text-fuchsia-400">Live</p><h1 className="truncate text-xl font-black">Bonjour {name}</h1></div>
      <button className="min-h-11 shrink-0 rounded-full bg-zinc-800 px-3 py-2 text-sm font-semibold" onClick={() => void signOut()}>Déconnexion</button>
    </header>
    {loading ? <p className="panel p-5 text-center text-sm text-zinc-400">Chargement de vos tables...</p> : error ? <p className="panel p-5 text-center text-sm text-red-300">{error}</p> : <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Indicateurs de mon rang">
        {[['Tables', tableRows.length], ['Occupées', summary.occupied], ['Libres', summary.available], ['Personnes', summary.present]].map(([label, value]) => <article className="panel p-3" key={String(label)}><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></article>)}
      </section>
      <section className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Mes tables">
        {tableRows.map(({ table, visit }) => {
          const total = presentTotal(table);
          const occupied = total > 0;
          const state = visit ? saveStates[visit.id] ?? 'idle' : 'idle';
          const draft = visit ? notes[visit.id] ?? { comment: visit.cdr_comment ?? '', referrer: visit.business_referrer ?? '' } : null;
          return <article className={`min-h-28 rounded-2xl border p-4 ${occupied ? 'border-fuchsia-500/50 bg-fuchsia-950/30' : 'border-zinc-700 bg-zinc-900/80'}`} key={table.id}>
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Table {getTableDisplayNumber(table)}</h2><p className="mt-1 text-sm text-zinc-400">{table.zone?.name ?? 'Carré non attribué'}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${occupied ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'bg-zinc-700 text-zinc-300'}`}>{occupied ? 'OCCUPÉE' : 'LIBRE'}</span></div>
            <p className="mt-4 text-sm text-zinc-300">{occupied ? <><b className="text-lg text-white">{total}</b> personne{total !== 1 ? 's' : ''}</> : 'Aucun client actuellement'}</p>
            {visit && draft && <div className="mt-5 border-t border-white/10 pt-4">
              <label className="block text-sm font-semibold text-zinc-200">Commentaire<textarea value={draft.comment} onChange={(event) => updateNote(visit.id, 'comment', event.target.value)} maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm font-normal outline-none focus:border-fuchsia-400" /></label>
              <label className="mt-3 block text-sm font-semibold text-zinc-200">Apporteur d’affaires<input value={draft.referrer} onChange={(event) => updateNote(visit.id, 'referrer', event.target.value)} maxLength={300} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm font-normal outline-none focus:border-fuchsia-400" /></label>
              <div className="mt-3 flex items-center gap-3"><button disabled={state === 'saving'} onClick={() => void saveNotes(visit)} className="min-h-11 rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60">{state === 'saving' ? 'Enregistrement...' : 'Enregistrer'}</button>{state === 'saved' && <p className="text-sm text-emerald-300">Enregistré</p>}{state === 'error' && <p className="text-sm text-red-300">Erreur d’enregistrement</p>}</div>
            </div>}
          </article>;
        })}
      </section>
      {tableRows.length === 0 && <p className="panel mt-6 p-5 text-center text-sm text-zinc-400">Aucune table active ne vous est actuellement attribuée.</p>}
    </>}
  </main>;
}
