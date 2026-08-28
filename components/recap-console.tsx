'use client';

import { useEffect, useMemo, useState } from 'react';
import { activitySummary, finalClubEntryCount, promoterTotal, recapRotations, recapTables, recapWaiters, recapZones, selectedNightNotes } from '@/lib/recap';
import { supabase } from '@/lib/supabase/client';
import type { ClubEntryCount, FloorNote, LiveTable, NightSession, Promoter, TableVisit } from '@/lib/types';

const normaliseTables = (rows: any[]): LiveTable[] => rows.map((table) => ({ ...table, reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation, occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy }));
const formatDate = (value: string) => new Date(value).toLocaleDateString('fr-FR');
const formatTime = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fullName = (waiter: TableVisit['head_waiter']) => waiter ? (waiter.first_name + ' ' + waiter.last_name).trim() : '—';

export function RecapConsole() {
  const [sessions, setSessions] = useState<NightSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [tables, setTables] = useState<LiveTable[]>([]);
  const [allVisits, setAllVisits] = useState<TableVisit[]>([]);
  const [entryCounts, setEntryCounts] = useState<ClubEntryCount[]>([]);
  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [notes, setNotes] = useState<FloorNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [notice, setNotice] = useState('');
  const [openTableId, setOpenTableId] = useState<string | null>(null);

  async function load() {
    const [{ data: sessionRows, error: sessionError }, { data: tableRows, error: tableError }, { data: visitRows, error: visitError }, { data: entryRows, error: entryError }, { data: promoterRows, error: promoterError }, { data: noteRows, error: noteError }] = await Promise.all([
      supabase.from('night_sessions').select('*').order('started_at', { ascending: false }),
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').order('display_number'),
      supabase.from('table_visits').select('*, zone:zones(*), head_waiter:head_waiters(*)').order('arrived_at'),
      supabase.from('club_entry_counts').select('*').order('recorded_at', { ascending: false }),
      supabase.from('promoters').select('*').order('name'),
      supabase.from('floor_notes').select('*').order('created_at'),
    ]);
    if (sessionError || tableError || visitError || entryError || promoterError || noteError) {
      console.error('[RECAP] Chargement impossible.', { sessionError, tableError, visitError, entryError, promoterError, noteError });
      setError('Impossible de charger le récapitulatif.');
      setLoading(false);
      return;
    }
    const availableSessions = (sessionRows ?? []) as NightSession[];
    setSessions(availableSessions);
    setSessionId((previous) => previous || availableSessions.find((session) => !session.ended_at)?.id || availableSessions[0]?.id || '');
    setTables(normaliseTables(tableRows ?? []));
    setAllVisits((visitRows ?? []) as TableVisit[]);
    setEntryCounts((entryRows ?? []) as ClubEntryCount[]);
    setPromoters((promoterRows ?? []) as Promoter[]);
    setNotes((noteRows ?? []) as FloorNote[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const channel = supabase.channel('recap-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_entry_counts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoters' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_notes' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const selected = sessions.find((session) => session.id === sessionId);
  const current = sessions.find((session) => !session.ended_at);
  const history = sessions.filter((session) => session.ended_at);
  const visits = useMemo(() => allVisits.filter((visit) => visit.night_session_id === sessionId), [allVisits, sessionId]);
  const selectedEntries = useMemo(() => entryCounts.filter((entry) => entry.night_session_id === sessionId), [entryCounts, sessionId]);
  const selectedPromoters = useMemo(() => promoters.filter((promoter) => promoter.night_session_id === sessionId), [promoters, sessionId]);
  const selectedNotes = useMemo(() => selectedNightNotes(notes, sessionId), [notes, sessionId]);
  const tableNumbers = useMemo(() => new Map(tables.map((table) => [table.id, table.display_number ?? table.number])), [tables]);
  const global = useMemo(() => activitySummary(visits, tables.filter((table) => table.active).length), [tables, visits]);
  const soldTables = useMemo(() => recapTables(visits, tableNumbers), [visits, tableNumbers]);
  const rotations = useMemo(() => recapRotations(soldTables), [soldTables]);
  const zones = useMemo(() => recapZones(tables.filter((table) => table.active), visits), [tables, visits]);
  const waiters = useMemo(() => recapWaiters(tables.filter((table) => table.active), visits), [tables, visits]);
  const finalEntries = useMemo(() => finalClubEntryCount(selectedEntries), [selectedEntries]);
  const promotersCount = useMemo(() => promoterTotal(selectedPromoters), [selectedPromoters]);
  const selectedTable = soldTables.find((table) => table.tableId === openTableId);

  function summaryFor(session: NightSession) {
    const nightVisits = allVisits.filter((visit) => visit.night_session_id === session.id);
    return activitySummary(nightVisits, tables.filter((table) => table.active).length);
  }

  function download() {
    if (!selected) return;
    const rows = [
      ['date', 'carré', 'CDR', 'table', 'vente', 'personnes', 'invités', 'total', 'arrivée', 'fin'],
      ...visits.map((visit) => [formatDate(selected.started_at), visit.zone?.name ?? '', fullName(visit.head_waiter), tableNumbers.get(visit.table_id) ?? visit.table_id, visit.sale_number ?? '', visit.present_people, visit.extra_guests, visit.present_people + visit.extra_guests, formatTime(visit.arrived_at), visit.ended_at ? formatTime(visit.ended_at) : '']),
    ];
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([rows.map((row) => row.map((value) => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    anchor.download = 'maze-out-recap-' + formatDate(selected.started_at).replaceAll('/', '-') + '.csv';
    anchor.click();
  }

  async function closeNight() {
    const { error: closeError } = await supabase.rpc('close_current_night_session');
    if (closeError) { console.error('[RECAP] Clôture de la soirée impossible.', closeError); setError('Impossible de clôturer la soirée.'); return; }
    setConfirmClose(false); setNotice('Soirée clôturée'); await load();
  }

  if (loading) return <p className="panel p-5 text-zinc-400">Chargement…</p>;
  if (error) return <p className="panel border-red-500/40 p-5 text-red-200">{error}</p>;

  return <><header className="mb-6"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Bilan opérationnel</p><h1 className="text-3xl font-black">RÉCAPITULATIF DE LA SOIRÉE</h1></header>
    <section className="mb-8"><h2 className="mb-3 text-xl font-bold">SOIRÉE EN COURS</h2>{current ? <button onClick={() => setSessionId(current.id)} className={'panel w-full p-5 text-left ' + (sessionId === current.id ? 'border-fuchsia-500/70' : '')}><b>{formatDate(current.started_at)} — en cours</b><p className="mt-2 text-sm text-zinc-400">{summaryFor(current).clients} personnes aux tables · {summaryFor(current).usedTables} tables vendues</p></button> : <p className="panel p-5 text-zinc-400">Aucune soirée en cours.</p>}</section>
    <section className="mb-8"><h2 className="mb-3 text-xl font-bold">HISTORIQUE DES SOIRÉES</h2>{history.length ? <div className="grid gap-3 sm:grid-cols-2">{history.map((session) => { const summary = summaryFor(session); return <button key={session.id} onClick={() => setSessionId(session.id)} className={'panel p-5 text-left ' + (sessionId === session.id ? 'border-fuchsia-500/70' : '')}><b className="text-lg">{formatDate(session.started_at)}</b><p className="mt-1 text-sm text-zinc-400">{formatTime(session.started_at)} → {session.ended_at ? formatTime(session.ended_at) : '—'}</p><p className="mt-4">{summary.clients} personnes · {summary.usedTables} tables</p></button>; })}</div> : <p className="panel p-5 text-zinc-400">Aucune soirée clôturée.</p>}</section>
    {selected && <section><div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-xl font-bold">DÉTAIL — {formatDate(selected.started_at)}</h2><button onClick={download} className="rounded-xl bg-emerald-600 px-5 py-3 font-bold">Exporter CSV</button>{!selected.ended_at && <button onClick={() => setConfirmClose(true)} className="rounded-xl bg-zinc-800 px-5 py-3 font-bold">Clôturer la soirée</button>}</div>
      {confirmClose && <section className="panel mb-5 border-orange-500/40 p-5"><h3 className="text-lg font-bold">Clôturer la soirée ?</h3><p className="mt-2 text-sm text-zinc-300">Cette action va figer le récapitulatif et remettre toutes les tables à zéro pour la prochaine soirée.</p><div className="mt-5 flex gap-3"><button className="rounded-xl bg-zinc-800 px-4 py-3 font-bold" onClick={() => setConfirmClose(false)}>Annuler</button><button className="rounded-xl bg-orange-500 px-4 py-3 font-bold text-zinc-950" onClick={() => void closeNight()}>Clôturer la soirée</button></div></section>}
      {notice && <p className="mb-5 text-sm font-semibold text-emerald-300">{notice}</p>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[['TABLES VENDUES', soldTables.length], ['VENTES TOTALES', visits.length], ['PERSONNES ACCUEILLIES AUX TABLES', global.clients], ['ENTRÉES CLUB', finalEntries], ['PROMOTEURS', promotersCount + ' personnes']].map(([label, value]) => <div className="panel p-4" key={String(label)}><small>{label}</small><b className="mt-2 block text-2xl">{value}</b></div>)}</section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">DÉTAIL DES TABLES</h2><div className="grid gap-3 sm:grid-cols-2">{soldTables.map((table) => <button key={table.tableId} onClick={() => setOpenTableId(table.tableId)} className="panel p-4 text-left"><b className="text-lg">Table {table.tableNumber}</b><p className="mt-1 text-sm text-zinc-400">{fullName(table.waiter)} · {table.zone?.name ?? '—'}</p><p className="mt-4">{table.sales} vente{table.sales !== 1 ? 's' : ''} · {table.people} personnes accueillies</p></button>)}</div>{soldTables.length === 0 && <p className="text-sm text-zinc-400">Aucune table vendue.</p>}</section>
      {selectedTable && <section className="panel mt-4 p-5"><div className="flex gap-3"><h2 className="mr-auto text-xl font-bold">TABLE {selectedTable.tableNumber}</h2><button className="text-sm text-violet-300" onClick={() => setOpenTableId(null)}>Fermer</button></div><div className="mt-4 grid gap-3">{selectedTable.visits.map((visit, index) => <article className="rounded-xl bg-zinc-800 p-4" key={visit.id}><b>Vente #{visit.sale_number ?? index + 1}</b><p className="mt-2 text-sm text-zinc-400">{formatTime(visit.arrived_at)} → {visit.ended_at ? formatTime(visit.ended_at) : 'en cours'}</p><p className="mt-2">{visit.present_people} personnes · {visit.extra_guests} invité{visit.extra_guests !== 1 ? 's' : ''} · Total : {visit.present_people + visit.extra_guests}</p></article>)}</div></section>}
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">TABLES LES PLUS VENDUES</h2><div className="grid gap-2">{rotations.map((table) => <div className="panel flex p-3" key={table.tableId}><span className="mr-auto">Table {table.tableNumber}</span><b>{table.sales} vente{table.sales !== 1 ? 's' : ''}</b></div>)}</div></section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">PAR CARRÉ</h2><div className="grid gap-4 sm:grid-cols-2">{zones.map(({ zone, summary }) => <article className="panel p-5" key={zone.id}><h3 className="text-xl font-black">{zone.name}</h3><p className="mt-4">Tables vendues : {summary.usedTables} / {summary.totalTables}</p><p>Ventes totales : {visits.filter((visit) => visit.zone_id === zone.id).length}</p><p>Personnes accueillies : {summary.clients}</p><p>Invités : {summary.extraGuests}</p></article>)}</div></section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">PAR CHEF DE RANG</h2><div className="grid gap-4 sm:grid-cols-2">{waiters.map(({ waiter, assignedTables, summary }) => <article className="panel p-5" key={waiter.id}><h3 className="text-xl font-black">{fullName(waiter)}</h3><p className="mt-4">Tables différentes vendues : {summary.usedTables} / {assignedTables}</p><p>Ventes totales : {visits.filter((visit) => visit.head_waiter_id === waiter.id).length}</p><p>Personnes accueillies : {summary.clients}</p><p>Invités : {summary.extraGuests}</p></article>)}</div></section>
      <section className="mt-8 grid gap-6 lg:grid-cols-2"><article><h2 className="mb-3 text-xl font-bold">ENTRÉES CLUB</h2><div className="panel p-5"><p>Total final : <b>{finalEntries} entrées</b></p><div className="mt-4 grid gap-2">{[...selectedEntries].sort((left, right) => new Date(left.recorded_at).getTime() - new Date(right.recorded_at).getTime()).map((entry) => <div className="flex" key={entry.id}><span className="mr-auto text-zinc-400">{formatTime(entry.recorded_at)}</span><b>{entry.count}</b></div>)}</div></div></article><article><h2 className="mb-3 text-xl font-bold">PROMOTEURS</h2><div className="panel p-5"><p>TOTAL PROMOTEURS · <b>{promotersCount} personnes</b></p><div className="mt-4 grid gap-2">{selectedPromoters.map((promoter) => <div className="flex" key={promoter.id}><span className="mr-auto">{promoter.name}</span><b>{promoter.entry_count}</b></div>)}</div></div></article></section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">JOURNAL PISTE</h2><div className="grid gap-3">{selectedNotes.map((note) => <article className="panel p-4" key={note.id}><p className="text-sm text-zinc-400">{formatTime(note.created_at)}</p><p className="mt-2">{note.content}</p></article>)}{selectedNotes.length === 0 && <p className="text-sm text-zinc-400">Aucune note Piste pour cette soirée.</p>}</div></section>
    </section>}
  </>;
}
