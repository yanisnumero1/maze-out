'use client';

import { useEffect, useMemo, useState } from 'react';
import { activitySummary, recapWaiters, recapZones } from '@/lib/recap';
import { supabase } from '@/lib/supabase/client';
import type { LiveTable, NightSession, TableVisit } from '@/lib/types';

const normaliseTables = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));

const formatDate = (value: string) => new Date(value).toLocaleDateString('fr-FR');
const formatTime = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function RecapConsole() {
  const [sessions, setSessions] = useState<NightSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [tables, setTables] = useState<LiveTable[]>([]);
  const [allVisits, setAllVisits] = useState<TableVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    async function load() {
      const [{ data: sessionRows, error: sessionError }, { data: tableRows, error: tableError }, { data: visitRows, error: visitError }] = await Promise.all([
        supabase.from('night_sessions').select('*').order('started_at', { ascending: false }),
        supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('display_number'),
        supabase.from('table_visits').select('*, zone:zones(*), head_waiter:head_waiters(*)').order('arrived_at'),
      ]);
      if (sessionError || tableError || visitError) {
        console.error('[RECAP] Chargement impossible.', { sessionError, tableError, visitError });
        setError('Impossible de charger le récapitulatif.');
        setLoading(false);
        return;
      }
      const availableSessions = (sessionRows ?? []) as NightSession[];
      setSessions(availableSessions);
      setSessionId(availableSessions.find((session) => !session.ended_at)?.id ?? availableSessions[0]?.id ?? '');
      setTables(normaliseTables(tableRows ?? []));
      setAllVisits((visitRows ?? []) as TableVisit[]);
      setLoading(false);
    }
    void load();
  }, []);

  const selected = sessions.find((session) => session.id === sessionId);
  const current = sessions.find((session) => !session.ended_at);
  const history = sessions.filter((session) => session.ended_at);
  const visits = useMemo(() => allVisits.filter((visit) => visit.night_session_id === sessionId), [allVisits, sessionId]);
  const global = useMemo(() => activitySummary(visits, tables.length), [tables.length, visits]);
  const zones = useMemo(() => recapZones(tables, visits), [tables, visits]);
  const waiters = useMemo(() => recapWaiters(tables, visits), [tables, visits]);
  const tableNumbers = useMemo(() => new Map(tables.map((table) => [table.id, table.display_number])), [tables]);

  function summaryFor(session: NightSession) {
    return activitySummary(allVisits.filter((visit) => visit.night_session_id === session.id), tables.length);
  }

  function download() {
    if (!selected) return;
    const rows = [
      ['Date soirée', formatDate(selected.started_at)],
      [],
      ['Date', 'Carré', 'Chef de rang', 'Table', 'Clients', 'Invités', 'Total', 'Heure arrivée', 'Heure fin'],
      ...visits.map((visit) => [
        formatDate(selected.started_at),
        visit.zone?.name ?? '',
        visit.head_waiter ? `${visit.head_waiter.first_name} ${visit.head_waiter.last_name}` : '',
        tableNumbers.get(visit.table_id) ?? visit.table_id,
        visit.present_people,
        visit.extra_guests,
        visit.present_people + visit.extra_guests,
        formatTime(visit.arrived_at),
        visit.ended_at ? formatTime(visit.ended_at) : '',
      ]),
    ];
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    anchor.download = `maze-out-recap-${formatDate(selected.started_at).replaceAll('/', '-')}.csv`;
    anchor.click();
  }

  async function closeNight() {
    const { error: closeError } = await supabase.rpc('close_current_night_session');
    if (closeError) {
      console.error('[RECAP] Clôture de la soirée impossible.', closeError);
      setError('Impossible de clôturer la soirée.');
      return;
    }
    const endedAt = new Date().toISOString();
    setSessions((items) => items.map((session) => session.id === sessionId ? { ...session, ended_at: endedAt } : session));
    setConfirmClose(false);
    setNotice('Soirée clôturée');
  }

  if (loading) return <p className="panel p-5 text-zinc-400">Chargement…</p>;
  if (error) return <p className="panel border-red-500/40 p-5 text-red-200">{error}</p>;

  return (
    <>
      <header className="mb-6"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Bilan opérationnel</p><h1 className="text-3xl font-black">RÉCAPITULATIF DE LA SOIRÉE</h1></header>

      <section className="mb-8"><h2 className="mb-3 text-xl font-bold">SOIRÉE EN COURS</h2>{current ? <button onClick={() => setSessionId(current.id)} className={`panel w-full p-5 text-left ${sessionId === current.id ? 'border-fuchsia-500/70' : ''}`}><b>{formatDate(current.started_at)} — en cours</b><p className="mt-2 text-sm text-zinc-400">{summaryFor(current).clients} clients · {summaryFor(current).usedTables} tables utilisées · {summaryFor(current).extraGuests} invités</p></button> : <p className="panel p-5 text-zinc-400">Aucune soirée en cours.</p>}</section>

      <section className="mb-8"><h2 className="mb-3 text-xl font-bold">HISTORIQUE DES SOIRÉES</h2>{history.length ? <div className="grid gap-3 sm:grid-cols-2">{history.map((session) => { const summary = summaryFor(session); return <button key={session.id} onClick={() => setSessionId(session.id)} className={`panel p-5 text-left ${sessionId === session.id ? 'border-fuchsia-500/70' : ''}`}><b className="text-lg">{formatDate(session.started_at)}</b><p className="mt-1 text-sm text-zinc-400">{formatTime(session.started_at)} → {session.ended_at ? formatTime(session.ended_at) : '—'}</p><p className="mt-4">{summary.clients} clients</p><p>{summary.usedTables} tables utilisées</p><p>{summary.extraGuests} invités</p></button>; })}</div> : <p className="panel p-5 text-zinc-400">Aucune soirée clôturée.</p>}</section>

      {selected && <section><div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-xl font-bold">DÉTAIL — {formatDate(selected.started_at)}</h2><button onClick={download} className="rounded-xl bg-emerald-600 px-5 py-3 font-bold">Exporter CSV</button>{!selected.ended_at && <button onClick={() => setConfirmClose(true)} className="rounded-xl bg-zinc-800 px-5 py-3 font-bold">Clôturer la soirée</button>}</div>
        {confirmClose && <section className="panel mb-5 border-orange-500/40 p-5"><h3 className="text-lg font-bold">Clôturer la soirée ?</h3><p className="mt-2 text-sm text-zinc-300">Cette action va figer le récapitulatif et remettre toutes les tables à zéro pour la prochaine soirée.</p><div className="mt-5 flex gap-3"><button className="rounded-xl bg-zinc-800 px-4 py-3 font-bold" onClick={() => setConfirmClose(false)}>Annuler</button><button className="rounded-xl bg-orange-500 px-4 py-3 font-bold text-zinc-950" onClick={() => void closeNight()}>Clôturer la soirée</button></div></section>}
        {notice && <p className="mb-5 text-sm font-semibold text-emerald-300">{notice}</p>}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Clients accueillis', global.clients], ['Tables utilisées', `${global.usedTables} / ${global.totalTables}`], ['Taux d’utilisation', `${global.usageRate} %`], ['Invités supplémentaires', global.extraGuests], ['Tables totales', global.totalTables]].map(([label, value]) => <div className="panel p-4" key={String(label)}><small>{label}</small><b className="block text-2xl">{value}</b></div>)}</section>
        <section className="mt-6"><h2 className="mb-3 text-xl font-bold">PAR CARRÉ</h2><div className="grid gap-4 sm:grid-cols-2">{zones.map(({ zone, summary }) => <article className="panel p-5" key={zone.id}><h3 className="text-xl font-black">{zone.name}</h3><p className="mt-4">{summary.clients} clients accueillis</p><p>{summary.usedTables} / {summary.totalTables} tables utilisées</p><p>{summary.usageRate} % d’utilisation</p><p>{summary.extraGuests} invités supplémentaires</p></article>)}</div></section>
        <section className="mt-6"><h2 className="mb-3 text-xl font-bold">PAR CHEF DE RANG</h2><div className="grid gap-4 sm:grid-cols-2">{waiters.map(({ waiter, summary }) => <article className="panel p-5" key={waiter.id}><h3 className="text-xl font-black">{waiter.first_name} {waiter.last_name}</h3><p className="mt-4">{summary.usedTables} tables utilisées</p><p>{summary.clients} clients accueillis</p><p>{summary.extraGuests} invités supplémentaires</p></article>)}</div></section>
      </section>}
    </>
  );
}
