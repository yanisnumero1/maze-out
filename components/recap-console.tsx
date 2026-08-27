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

export function RecapConsole() {
  const [sessions, setSessions] = useState<NightSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [tables, setTables] = useState<LiveTable[]>([]);
  const [visits, setVisits] = useState<TableVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadBase() {
      const [{ data: sessionRows, error: sessionError }, { data: tableRows, error: tableError }] = await Promise.all([
        supabase.from('night_sessions').select('*').order('started_at', { ascending: false }),
        supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('number'),
      ]);
      if (sessionError || tableError) {
        console.error('[RECAP] Chargement initial impossible.', { sessionError, tableError });
        setError('Impossible de charger le récapitulatif.');
        setLoading(false);
        return;
      }
      const availableSessions = (sessionRows ?? []) as NightSession[];
      setSessions(availableSessions);
      setSessionId(availableSessions.find((session) => !session.ended_at)?.id ?? availableSessions[0]?.id ?? '');
      setTables(normaliseTables(tableRows ?? []));
      setLoading(false);
    }
    void loadBase();
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setVisits([]);
      return;
    }
    async function loadVisits() {
      const { data, error: visitError } = await supabase
        .from('table_visits')
        .select('*, zone:zones(*), head_waiter:head_waiters(*)')
        .eq('night_session_id', sessionId)
        .order('arrived_at');
      if (visitError) {
        console.error('[RECAP] Chargement de l’historique impossible.', visitError);
        setError('Impossible de charger l’historique de la soirée.');
        return;
      }
      setVisits((data ?? []) as TableVisit[]);
    }
    void loadVisits();
  }, [sessionId]);

  const global = useMemo(() => activitySummary(visits, tables.length), [tables.length, visits]);
  const zones = useMemo(() => recapZones(tables, visits), [tables, visits]);
  const waiters = useMemo(() => recapWaiters(tables, visits), [tables, visits]);
  const selected = sessions.find((session) => session.id === sessionId);

  function download() {
    const rows = [
      ['Récapitulatif de la soirée', selected?.started_at ?? ''],
      ['Clients accueillis', global.clients],
      ['Tables utilisées', `${global.usedTables}/${global.totalTables}`],
      ['Taux utilisation', `${global.usageRate}%`],
      ['Invités supplémentaires', global.extraGuests],
      [],
      ['Carré', 'Clients', 'Tables utilisées', 'Tables totales', 'Taux', 'Invités supplémentaires'],
      ...zones.map(({ zone, summary }) => [zone.name, summary.clients, summary.usedTables, summary.totalTables, `${summary.usageRate}%`, summary.extraGuests]),
      [],
      ['Chef de rang', 'Tables affectées', 'Tables utilisées', 'Clients', 'Invités supplémentaires'],
      ...waiters.map(({ waiter, assignedTables, summary }) => [`${waiter.first_name} ${waiter.last_name}`, assignedTables, summary.usedTables, summary.clients, summary.extraGuests]),
    ];
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    anchor.download = 'maze-out-recap.csv';
    anchor.click();
  }

  async function closeNight() {
    const { error: closeError } = await supabase.rpc('close_current_night_session');
    if (closeError) {
      console.error('[RECAP] Clôture de la soirée impossible.', closeError);
      setError('Impossible de clôturer la soirée.');
      return;
    }
    window.location.reload();
  }

  if (loading) return <p className="panel p-5 text-zinc-400">Chargement…</p>;
  if (error) return <p className="panel border-red-500/40 p-5 text-red-200">{error}</p>;

  return (
    <>
      <header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Bilan opérationnel</p><h1 className="text-3xl font-black">RÉCAPITULATIF DE LA SOIRÉE</h1></header>
      {sessions.length > 0 ? <div className="mb-5 flex flex-wrap gap-3"><select className="rounded-xl bg-zinc-800 px-4 py-3" value={sessionId} onChange={(event) => setSessionId(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id}>{new Date(session.started_at).toLocaleString('fr-FR')} {session.ended_at ? '— clôturée' : '— en cours'}</option>)}</select><button onClick={download} className="rounded-xl bg-emerald-600 px-5 py-3 font-bold">Exporter CSV</button>{selected && !selected.ended_at && <button onClick={() => void closeNight()} className="rounded-xl bg-zinc-800 px-5 py-3 font-bold">Clôturer la soirée</button>}</div> : <p className="panel mb-5 p-5 text-zinc-400">Aucune activité historisée pour le moment. La première arrivée créera automatiquement la soirée en cours.</p>}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Clients accueillis', global.clients], ['Tables utilisées', `${global.usedTables} / ${global.totalTables}`], ['Taux d’utilisation', `${global.usageRate} %`], ['Invités supplémentaires', global.extraGuests], ['Tables totales', global.totalTables]].map(([label, value]) => <div className="panel p-4" key={String(label)}><small>{label}</small><b className="block text-2xl">{value}</b></div>)}</section>
      <section className="mt-6"><h2 className="mb-3 text-xl font-bold">ACTIVITÉ PAR CARRÉ</h2><div className="grid gap-4 sm:grid-cols-2">{zones.map(({ zone, summary }) => <article className="panel p-5" key={zone.id}><h3 className="text-xl font-black">{zone.name}</h3><p className="mt-4">{summary.clients} clients accueillis</p><p>{summary.usedTables} / {summary.totalTables} tables utilisées</p><p>{summary.usageRate} % d’utilisation</p><p>{summary.extraGuests} invités supplémentaires</p></article>)}</div></section>
      <section className="mt-6"><h2 className="mb-3 text-xl font-bold">ACTIVITÉ PAR CHEF DE RANG</h2><div className="grid gap-4 sm:grid-cols-2">{waiters.map(({ waiter, assignedTables, summary }) => <article className="panel p-5" key={waiter.id}><h3 className="text-xl font-black">{waiter.first_name} {waiter.last_name}</h3><p className="mt-4">{assignedTables} tables affectées</p><p>{summary.usedTables} tables utilisées</p><p>{summary.clients} clients accueillis</p><p>{summary.extraGuests} invités supplémentaires</p></article>)}</div></section>
    </>
  );
}
