'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { liveDashboard, liveZoneDashboard, zoneAvailabilityStatus } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';
import type { ArrivalDraft, LiveTable, Zone } from '@/lib/types';
import { TableSearch } from '@/components/table-search';

const accents = ['border-emerald-500/40', 'border-orange-500/40', 'border-blue-500/40', 'border-violet-500/40'];
const loadLabels = { calme: 'CALME', modere: 'ACTIVITÉ MODÉRÉE', forte_affluence: 'FORTE AFFLUENCE', presque_complet: 'PRESQUE COMPLET' } as const;
const loadColors = { calme: 'text-emerald-300', modere: 'text-violet-200', forte_affluence: 'text-orange-300', presque_complet: 'text-red-300' } as const;

const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));
const percentageWidth = (value: number) => `${Math.max(0, Math.min(100, value))}%`;
const formatTime = (date: Date) => date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const formatDate = (date: Date) => date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toLocaleUpperCase('fr-FR');

function Progress({ value, tone = 'bg-fuchsia-500' }: { value: number; tone?: string }) {
  return <div aria-label={`${value} %`} className="h-2 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: percentageWidth(value) }} /></div>;
}
function zoneState(present: number, zone: Zone, available: number) {
  const availability = zoneAvailabilityStatus(present, zone.max_capacity, available);
  if (availability === 'complete') return { label: 'COMPLET', color: 'text-red-300' };
  if (availability === 'charged') return { label: 'CHARGÉ', color: 'text-orange-300' };
  return { label: 'OUVERT', color: 'text-emerald-300' };
}

export function LiveDashboard({ initialTables }: { initialTables: LiveTable[] }) {
  const router = useRouter();
  const [tables, setTables] = useState(initialTables);
  const [updated, setUpdated] = useState(new Date());
  const [now, setNow] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ArrivalDraft[]>([]);

  const zones = useMemo(() => [...new Map(tables.filter((table) => table.zone).map((table) => [table.zone.id, table.zone])).values()].sort((left, right) => left.display_order - right.display_order), [tables]);
  const dashboard = useMemo(() => liveDashboard(tables, zones, drafts), [drafts, tables, zones]);
  const fullestZone = useMemo(() => zones.map((zone) => ({ zone, summary: liveZoneDashboard(tables, zone) })).sort((left, right) => right.summary.fillRate - left.summary.fillRate)[0] ?? null, [tables, zones]);

  useEffect(() => {
    setNow(new Date());
    const clockInterval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadDrafts() {
      const { data: nightId, error: nightError } = await supabase.rpc('current_operational_night_session');
      if (nightError) { console.error('[LIVE] Chargement de la soirée opérationnelle impossible.', nightError); return; }
      if (!nightId) { if (active) setDrafts([]); return; }
      const { data, error: draftsError } = await supabase.from('arrival_drafts').select('*').eq('status', 'draft').eq('night_session_id', nightId).order('created_at', { ascending: true });
      if (draftsError) { console.error('[LIVE] Chargement des brouillons impossible.', draftsError); return; }
      if (active) setDrafts((data ?? []) as ArrivalDraft[]);
    }
    async function loadForSession(session: Session | null) {
      if (!session) {
        console.info('[LIVE] Aucune session active : chargement des données suspendu.');
        if (active) { setTables([]); setError('Session Supabase absente. Connectez-vous pour afficher les données.'); setLoading(false); }
        return;
      }
      if (active) { setLoading(true); setError(null); }
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
      if (profileError || !profile) {
        console.error('[LIVE] Profil Supabase impossible à charger.', { error: profileError, userId: session.user.id });
        if (active) { setError('Impossible de vérifier le profil utilisateur.'); setLoading(false); }
        return;
      }
      const { data, error: tablesError } = await supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('display_number');
      if (tablesError) {
        console.error('[LIVE] Chargement des tables impossible.', tablesError);
        if (active) { setError('Impossible de charger les données. Consultez la console pour le détail.'); setLoading(false); }
        return;
      }
      if (active) { setTables(normalise(data ?? [])); setUpdated(new Date()); setLoading(false); }
      void loadDrafts();
    }
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) console.error('[LIVE] Impossible de restaurer la session Supabase.', sessionError);
      void loadForSession(data.session);
    });
    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.info('[LIVE] Changement Auth reçu.', { event, hasSession: Boolean(session) });
      window.setTimeout(() => void loadForSession(session), 0);
    });
    const channel = supabase.channel('live-summary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, (payload) => {
        const row = payload.new as LiveTable['occupancy'];
        if (row?.table_id) { setTables((rows) => rows.map((table) => table.id === row.table_id ? { ...table, occupancy: row } : table)); setUpdated(new Date()); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload) => {
        const row = payload.new as LiveTable['reservation'];
        if (row?.table_id) { setTables((rows) => rows.map((table) => table.id === row.table_id ? { ...table, reservation: row } : table)); setUpdated(new Date()); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arrival_drafts' }, () => void loadDrafts())
      .subscribe();
    return () => { active = false; authSubscription.unsubscribe(); void supabase.removeChannel(channel); };
  }, []);

  return <>
    <header className="mb-6 border-b border-zinc-800 pb-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[.25em] text-fuchsia-400">LIVE · Soirée en cours</p><h1 className="mt-1 text-3xl font-black">Vue en direct</h1><p className="mt-1 text-zinc-400">État actuel des carrés</p></div><div className="min-w-[10rem] text-right"><p className="text-xs font-bold uppercase tracking-[.14em] text-zinc-500">{now ? formatDate(now) : '—'}</p><time className="mt-1 block font-mono text-3xl font-black tabular-nums text-white">{now ? formatTime(now) : '--:--:--'}</time><p className="mt-1 text-xs text-zinc-500">Mis à jour {updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p></div></div></header>
    {loading ? <div className="panel p-6 text-zinc-300">Chargement…</div> : error ? <div className="panel border-red-500/40 p-6 text-red-200"><p>Impossible de charger les données</p><p className="mt-1 text-sm text-red-200/70">{error}</p></div> : zones.length === 0 ? <div className="panel p-6 text-zinc-300">Aucune donnée disponible</div> : <>
      <TableSearch tables={tables} drafts={drafts} onSelect={(table) => router.push(`/hostess?table=${encodeURIComponent(String(table.display_number))}`)} />
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Indicateurs Live">
        <article className="panel p-4"><p className="text-xs font-black uppercase tracking-[.16em] text-zinc-400">Personnes présentes</p><p className="mt-3 text-3xl font-black">{dashboard.present} <span className="text-lg text-zinc-500">/ {dashboard.capacity}</span></p><p className="mt-1 text-sm text-zinc-400">{dashboard.fillRate} % de remplissage</p><div className="mt-4"><Progress value={dashboard.fillRate} /></div></article>
        <article className="panel p-4"><p className="text-xs font-black uppercase tracking-[.16em] text-zinc-400">Tables occupées</p><p className="mt-3 text-3xl font-black">{dashboard.occupied} <span className="text-lg text-zinc-500">/ {tables.length}</span></p><p className="mt-1 text-sm text-zinc-400">{tables.length ? Math.round((dashboard.occupied / tables.length) * 100) : 0} % · {dashboard.available} tables disponibles</p><div className="mt-4"><Progress value={tables.length ? Math.round((dashboard.occupied / tables.length) * 100) : 0} tone="bg-violet-500" /></div></article>
       <article className="panel border border-orange-500/30 p-4"><p className="text-xs font-black uppercase tracking-[.16em] text-orange-200">Arrivées en attente</p><p className="mt-3 text-3xl font-black">{dashboard.activeDraftCount}</p><p className="mt-1 text-sm text-zinc-400">{dashboard.pendingPeople} personne{dashboard.pendingPeople !== 1 ? 's' : ''} attendue{dashboard.pendingPeople !== 1 ? 's' : ''}</p><p className="mt-4 text-xs font-bold text-orange-200">Non comptées dans les personnes présentes</p></article>
       </section>
      {drafts.length > 0 && <section className="panel mt-4 border border-orange-500/30 bg-zinc-900/80 p-4" aria-label="Arrivées en attente"><h2 className="text-sm font-black uppercase tracking-[.18em] text-orange-200">Arrivées en attente · {drafts.length}</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{drafts.map((draft) => { const table = tables.find((item) => item.id === draft.table_id); return <button type="button" key={draft.id} onClick={() => router.push(`/hostess?draft=${encodeURIComponent(draft.id)}`)} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/70 px-3 py-2 text-left hover:bg-zinc-800"><span><b className="block">Table {table?.display_number ?? '—'}</b><span className="text-xs text-zinc-400">{draft.present_people + draft.extra_guests} personnes attendues</span></span><span aria-hidden="true" className="text-violet-300">›</span></button>; })}</div></section>}
      <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-3"><div><p className="text-xs font-black uppercase tracking-[.16em] text-fuchsia-200">État de la salle</p><p className={`mt-1 text-lg font-black ${loadColors[dashboard.load]}`}>{loadLabels[dashboard.load]}</p></div>{fullestZone && <p className="text-sm text-zinc-400">Zone la plus remplie : <b className="text-zinc-100">{fullestZone.zone.name} · {fullestZone.summary.fillRate} %</b></p>}</section>
      <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="État des carrés">{zones.map((zone, index) => {
        const summary = liveZoneDashboard(tables, zone);
        const state = zoneState(summary.present, zone, summary.available);
        const waiters = [...new Set(tables.filter((table) => table.zone_id === zone.id).map((table) => table.head_waiter?.first_name).filter(Boolean))];
        return <button type="button" aria-label={`Ouvrir la vue salle ${zone.name}`} className={`panel min-h-56 w-full border p-5 text-left transition hover:bg-zinc-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${accents[index % 4]}`} key={zone.id} onClick={() => router.push(`/hostess?zone=${encodeURIComponent(zone.id)}`)}><div className="flex items-start justify-between gap-3"><div><h2 className="text-2xl font-black">{zone.name}</h2><p className={`mt-1 text-xs font-black uppercase tracking-[.14em] ${state.color}`}>{state.label} · {loadLabels[summary.load]}</p></div><span aria-hidden="true" className="text-xl text-violet-300/70">›</span></div><div className="mt-6 flex items-end justify-between gap-4"><p className="text-3xl font-black">{summary.present} <span className="text-lg text-zinc-500">/ {summary.capacity}</span></p><p className="text-sm font-bold text-zinc-300">{summary.fillRate} % rempli</p></div><p className="mt-1 text-sm text-zinc-400">personnes présentes</p><div className="mt-4"><Progress value={summary.fillRate} tone="bg-fuchsia-500" /></div><div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-300"><span><b>{summary.occupied} / {summary.totalTables}</b> tables occupées</span><span><b>{summary.available}</b> disponibles</span></div><p className="mt-3 truncate text-xs text-zinc-500">{waiters.join(' · ')}</p></button>;
      })}</section>
    </>}
  </>;
}
