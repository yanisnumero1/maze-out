'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { liveActivity, liveDashboard, liveDashboardAlerts, liveZoneDashboard, recentArrivalsByZone, zoneAvailabilityStatus } from '@/lib/live';
import { actorIdsForResolution, actorProfileMap, formatActorLabel, latestAuditActor } from '@/lib/actors';
import { supabase } from '@/lib/supabase/client';
import { GlobalSearch } from '@/components/global-search';
import { getTableDisplayNumber } from '@/lib/tables';
import type { ArrivalDraft, BusinessReferrer, LiveTable, OperationalActorProfile, OperationalAuditLog, Promoter, TableVisit, TableVisitTransfer, Zone } from '@/lib/types';

type ActivityFilter = 'all' | 'sales' | 'transfers' | 'drafts';
type ConnectionState = 'live' | 'reconnecting' | 'offline';

const accents = ['border-emerald-500/40', 'border-orange-500/40', 'border-blue-500/40', 'border-violet-500/40'];
const loadLabels = { calme: 'CALME', modere: 'ACTIVITÉ MODÉRÉE', forte_affluence: 'FORTE AFFLUENCE', presque_complet: 'PRESQUE COMPLET' } as const;
const loadColors = { calme: 'text-emerald-300', modere: 'text-violet-200', forte_affluence: 'text-orange-300', presque_complet: 'text-red-300' } as const;
const connectionLabels = { live: 'LIVE · Synchronisé', reconnecting: 'RECONNEXION…', offline: 'HORS LIGNE' } as const;
const connectionColors = { live: 'text-emerald-300', reconnecting: 'text-orange-300', offline: 'text-red-300' } as const;

const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));
const percentageWidth = (value: number) => `${Math.max(0, Math.min(100, value))}%`;
const formatTime = (date: Date) => date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const formatShortTime = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const formatDate = (date: Date) => date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).toLocaleUpperCase('fr-FR');
const formatStartedAt = (startedAt: string) => new Date(startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });

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
  const [visits, setVisits] = useState<TableVisit[]>([]);
  const [transfers, setTransfers] = useState<TableVisitTransfer[]>([]);
  const [auditRows, setAuditRows] = useState<OperationalAuditLog[]>([]);
  const [businessReferrers, setBusinessReferrers] = useState<BusinessReferrer[]>([]);
  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [actorProfiles, setActorProfiles] = useState<OperationalActorProfile[]>([]);
  const [activeNightId, setActiveNightId] = useState<string | null>(null);
  const [nightStartedAt, setNightStartedAt] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('reconnecting');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');

  const zones = useMemo(() => [...new Map(tables.filter((table) => table.zone).map((table) => [table.zone.id, table.zone])).values()].sort((left, right) => left.display_order - right.display_order), [tables]);
  const dashboard = useMemo(() => liveDashboard(tables, zones, drafts), [drafts, tables, zones]);
  const fullestZone = useMemo(() => zones.map((zone) => ({ zone, summary: liveZoneDashboard(tables, zone) })).sort((left, right) => right.summary.fillRate - left.summary.fillRate)[0] ?? null, [tables, zones]);
  const recentByZone = useMemo(() => recentArrivalsByZone(tables, visits, new Date((now ?? new Date()).getTime() - 30 * 60000)), [now, tables, visits]);
  const alerts = useMemo(() => liveDashboardAlerts(tables, zones, drafts, transfers, now ?? new Date()), [drafts, now, tables, transfers, zones]);
  const activities = useMemo(() => liveActivity(visits, transfers, drafts), [drafts, transfers, visits]);
  const actors = useMemo(() => actorProfileMap(actorProfiles), [actorProfiles]);
  const visibleActivities = activities.filter((item) => activityFilter === 'all' || (activityFilter === 'sales' && item.kind.startsWith('sale_')) || (activityFilter === 'transfers' && item.kind === 'transfer') || (activityFilter === 'drafts' && item.kind === 'draft'));

  useEffect(() => {
    setNow(new Date());
    const clockInterval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    let active = true;
    let currentNightId: string | null = null;
    const updateNetworkState = () => setConnection(window.navigator.onLine ? 'reconnecting' : 'offline');
    updateNetworkState();
    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);

    async function loadNightData(nightId: string) {
      currentNightId = nightId;
      if (active) setActiveNightId(nightId);
      const { data: startedAt, error: startedAtError } = await supabase.rpc('current_operational_night_started_at');
      if (startedAtError) console.error('[LIVE] Heure de début de soirée indisponible.', startedAtError);
      if (!startedAt) {
        currentNightId = null;
        if (active) { setActiveNightId(null); setNightStartedAt(null); setDrafts([]); setVisits([]); setTransfers([]); setAuditRows([]); setActorProfiles([]); setBusinessReferrers([]); setPromoters([]); }
        return;
      }
      if (active) setNightStartedAt(startedAt);
      const [{ data: draftRows, error: draftsError }, { data: visitRows, error: visitsError }, { data: transferRows, error: transfersError }, { data: auditData, error: auditError }, { data: promoterRows, error: promotersError }] = await Promise.all([
        supabase.from('arrival_drafts').select('*').eq('status', 'draft').eq('night_session_id', nightId).order('created_at', { ascending: true }),
        supabase.from('table_visits').select('*').eq('night_session_id', nightId).order('arrived_at', { ascending: false }),
        supabase.from('table_visit_transfers').select('*').eq('night_session_id', nightId).order('created_at', { ascending: false }),
        supabase.from('operational_audit_log').select('*').eq('night_session_id', nightId).order('created_at', { ascending: false }),
        supabase.from('promoters').select('*').eq('night_session_id', nightId).order('name'),
      ]);
      if (draftsError || visitsError || transfersError || auditError || promotersError) console.error('[LIVE] Chargement activité de soirée impossible.', { draftsError, visitsError, transfersError, auditError, promotersError });
      const loadedDrafts = (draftRows ?? []) as ArrivalDraft[];
      const loadedVisits = (visitRows ?? []) as TableVisit[];
      const loadedTransfers = (transferRows ?? []) as TableVisitTransfer[];
      const audits = (auditData ?? []) as OperationalAuditLog[];
      const referrerIds = [...new Set(loadedVisits.map((visit) => visit.business_referrer_id).filter(Boolean))] as string[];
      const { data: referrerRows, error: referrersError } = referrerIds.length
        ? await supabase.from('business_referrers').select('*').in('id', referrerIds).order('name')
        : { data: [], error: null };
      if (referrersError) console.error('[LIVE] Chargement des apporteurs impossible.', referrersError);
      const actorIds = actorIdsForResolution(...audits.map((audit) => audit.actor_id), ...loadedDrafts.map((draft) => draft.actor_id), ...loadedTransfers.map((transfer) => transfer.transferred_by));
      const { data: profiles, error: profilesError } = actorIds.length ? await supabase.rpc('get_operational_actor_profiles', { p_actor_ids: actorIds }) : { data: [], error: null };
      if (profilesError) console.error('[LIVE] Résolution des auteurs impossible.', profilesError);
      if (active) {
        setDrafts(loadedDrafts);
        setVisits(loadedVisits);
        setTransfers(loadedTransfers);
        setAuditRows(audits);
        setActorProfiles((profiles ?? []) as OperationalActorProfile[]);
        setBusinessReferrers((referrerRows ?? []) as BusinessReferrer[]);
        setPromoters((promoterRows ?? []) as Promoter[]);
      }
    }
    async function loadCurrentNight() {
      const { data: nightId, error: nightError } = await supabase.rpc('current_operational_night_session');
      if (nightError) { console.error('[LIVE] Chargement de la soirée opérationnelle impossible.', nightError); return; }
      if (!nightId) {
        currentNightId = null;
        if (active) { setActiveNightId(null); setNightStartedAt(null); setDrafts([]); setVisits([]); setTransfers([]); setAuditRows([]); setActorProfiles([]); setBusinessReferrers([]); setPromoters([]); }
        return;
      }
      await loadNightData(nightId);
    }
    async function loadForSession(session: Session | null) {
      if (!session) {
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
      await loadCurrentNight();
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arrival_drafts' }, () => void loadCurrentNight())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void loadCurrentNight())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visit_transfers' }, () => void loadCurrentNight())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoters' }, () => void loadCurrentNight())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operational_audit_log' }, () => void loadCurrentNight())
      .subscribe((status) => {
        if (!active) return;
        if (!window.navigator.onLine) setConnection('offline');
        else if (status === 'SUBSCRIBED') setConnection('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnection('reconnecting');
      });
    return () => {
      active = false;
      window.removeEventListener('online', updateNetworkState);
      window.removeEventListener('offline', updateNetworkState);
      authSubscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, []);

  function tableName(id?: string) {
    const table = id ? tables.find((item) => item.id === id) : null;
    return table ? `Table ${getTableDisplayNumber(table)}` : 'Table —';
  }
  function activityText(item: ReturnType<typeof liveActivity>[number]) {
    if (item.kind === 'transfer') return `${tableName(item.fromTableId)} → ${tableName(item.toTableId)} · Transfert`;
    if (item.kind === 'draft') return `${tableName(item.tableId)} · Arrivée en attente · ${item.people} personnes`;
    if (item.kind === 'sale_ended') return `${tableName(item.tableId)} · Vente #${item.saleNumber ?? '—'} terminée`;
    return `${tableName(item.tableId)} · Nouvelle vente #${item.saleNumber ?? '—'} · ${item.people} personnes`;
  }
  function activitySaleDetails(item: ReturnType<typeof liveActivity>[number]) {
    if (item.kind !== 'sale_started') return null;
    const visit = visits.find((row) => row.id === item.entityId);
    if (!visit) return null;
    const referrer = visit.business_referrer_id ? businessReferrers.find((row) => row.id === visit.business_referrer_id)?.name : null;
    const details = [
      visit.reservation_name?.trim() ? `Réservation · ${visit.reservation_name}` : null,
      visit.consumption?.trim() ? `Conso · ${visit.consumption}` : null,
      visit.sale_comment?.trim() ? `Commentaire · ${visit.sale_comment}` : null,
      visit.proposed_business_referrer_name?.trim() ? `Apporteur proposé · ${visit.proposed_business_referrer_name}` : null,
      referrer ? `Apporteur validé · ${referrer}` : null,
    ].filter(Boolean);
    return details.length ? details.join(' · ') : null;
  }
  function activityActorId(item: ReturnType<typeof liveActivity>[number]) {
    if (item.kind === 'draft') return drafts.find((draft) => draft.id === item.entityId)?.actor_id ?? latestAuditActor(auditRows, 'arrival_draft', item.entityId, ['table.arrival_prepared']);
    if (item.kind === 'transfer') {
      const transfer = transfers.find((row) => row.id === item.entityId);
      return transfer?.transferred_by ?? latestAuditActor(auditRows, 'table_visit', transfer?.table_visit_id, ['table.transferred']);
    }
    if (item.kind === 'sale_ended') return latestAuditActor(auditRows, 'table', item.tableId, ['table.sale_ended']) ?? latestAuditActor(auditRows, 'table_visit', item.entityId, ['table.sale_ended']);
    return latestAuditActor(auditRows, 'table', item.tableId, ['table.arrival_confirmed']);
  }

  return <>
    <header className="mb-6 border-b border-zinc-800 pb-5"><div className="flex flex-wrap items-end justify-between gap-4"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.2em] text-fuchsia-400 sm:text-sm sm:tracking-[.25em]">LIVE · Soirée en cours</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Vue en direct</h1><p className="mt-1 text-zinc-400">État actuel des carrés</p></div><div className="w-full min-w-0 text-left sm:w-auto sm:min-w-[10rem] sm:text-right"><p className="text-xs font-bold uppercase tracking-[.14em] text-zinc-500">{now ? formatDate(now) : '—'}</p><time className="mt-1 block font-mono text-2xl font-black tabular-nums text-white sm:text-3xl">{now ? `${formatTime(now)} · LIVE` : '--:--:-- · LIVE'}</time><p className="mt-1 text-xs text-zinc-500">{activeNightId ? nightStartedAt ? `Soirée démarrée à ${formatStartedAt(nightStartedAt)}` : 'Soirée en cours' : 'Aucune soirée active'}</p></div></div></header>
    {loading ? <div className="panel p-6 text-zinc-300">Chargement…</div> : error ? <div className="panel border-red-500/40 p-6 text-red-200"><p>Impossible de charger les données</p><p className="mt-1 text-sm text-red-200/70">{error}</p></div> : zones.length === 0 ? <div className="panel p-6 text-zinc-300">Aucune donnée disponible</div> : <>
      <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${connection === 'live' ? 'bg-emerald-400' : connection === 'offline' ? 'bg-red-400' : 'bg-orange-400'}`} /><span className={connectionColors[connection]}>{connectionLabels[connection]}</span><span className="text-zinc-600">· Mis à jour {updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Actions rapides"><button type="button" onClick={() => router.push('/hostess')} className="min-h-12 rounded-xl bg-fuchsia-600 px-3 py-3 text-sm font-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Nouvelle arrivée</button><button type="button" onClick={() => router.push('/hostess?view=entrees')} className="min-h-12 rounded-xl bg-zinc-800 px-3 py-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">Entrées club</button><button type="button" onClick={() => router.push('/hostess?view=piste')} className="min-h-12 rounded-xl bg-zinc-800 px-3 py-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">Piste</button><button type="button" onClick={() => router.push('/hostess?view=promoteurs')} className="min-h-12 rounded-xl bg-zinc-800 px-3 py-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">Promoteurs</button></section>
      <GlobalSearch tables={tables} drafts={drafts} visits={visits} businessReferrers={businessReferrers} promoters={promoters} onSelectTable={(table) => router.push(`/hostess?table=${encodeURIComponent(getTableDisplayNumber(table))}`)} onSelectPromoter={(promoter) => router.push(`/hostess?view=promoteurs&promoter=${encodeURIComponent(promoter.id)}`)} onSelectCdr={(table) => router.push(`/hostess?zone=${encodeURIComponent(table.zone_id)}`)} />
       <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Indicateurs Live"><article className="panel p-4"><p className="text-xs font-black uppercase tracking-[.16em] text-zinc-400">Personnes présentes</p><p className="mt-3 text-3xl font-black">{dashboard.present} <span className="text-lg text-zinc-500">/ {dashboard.capacity}</span></p><p className="mt-1 text-sm text-zinc-400">{dashboard.fillRate} % de remplissage</p><div className="mt-4"><Progress value={dashboard.fillRate} /></div></article><article className="panel p-4"><p className="text-xs font-black uppercase tracking-[.16em] text-zinc-400">Tables occupées</p><p className="mt-3 text-3xl font-black">{dashboard.occupied} <span className="text-lg text-zinc-500">/ {tables.length}</span></p><p className="mt-1 text-sm text-zinc-400">{tables.length ? Math.round((dashboard.occupied / tables.length) * 100) : 0} % · {dashboard.available} tables disponibles</p><div className="mt-4"><Progress value={tables.length ? Math.round((dashboard.occupied / tables.length) * 100) : 0} tone="bg-violet-500" /></div></article><article className="panel border border-orange-500/30 p-4"><p className="text-xs font-black uppercase tracking-[.16em] text-orange-200">Arrivées en attente</p><p className="mt-3 text-3xl font-black">{dashboard.activeDraftCount}</p><p className="mt-1 text-sm text-zinc-400">{dashboard.pendingPeople} personne{dashboard.pendingPeople !== 1 ? 's' : ''} attendue{dashboard.pendingPeople !== 1 ? 's' : ''}</p><p className="mt-4 text-xs font-bold text-orange-200">Non comptées dans les personnes présentes</p></article></section>
      {drafts.length > 0 && <section className="panel mt-4 border border-orange-500/30 p-4" aria-label="Arrivées en attente"><h2 className="text-sm font-black uppercase tracking-[.16em] text-orange-200">Arrivées en attente · {drafts.length}</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{drafts.map((draft) => <button type="button" key={draft.id} onClick={() => router.push(`/hostess?draft=${encodeURIComponent(draft.id)}`)} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-left hover:bg-zinc-800"><span><b className="block">{tableName(draft.table_id)}</b><span className="text-xs text-zinc-400">{draft.present_people + draft.extra_guests} personnes attendues</span><span className="mt-1 block text-xs text-zinc-500">Préparé par {formatActorLabel(actors.get(draft.actor_id))}</span></span><span aria-hidden="true" className="text-violet-300">›</span></button>)}</div></section>}
       <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-4 py-3"><div><p className="text-xs font-black uppercase tracking-[.16em] text-fuchsia-200">État de la salle</p><p className={`mt-1 text-lg font-black ${loadColors[dashboard.load]}`}>{loadLabels[dashboard.load]}</p></div>{fullestZone && <p className="text-sm text-zinc-400">Zone la plus remplie : <b className="text-zinc-100">{fullestZone.zone.name} · {fullestZone.summary.fillRate} %</b></p>}</section>
      <section className="mt-4 panel p-4" aria-label="À surveiller"><h2 className="text-sm font-black uppercase tracking-[.16em] text-zinc-200">À surveiller</h2>{alerts.length ? <div className="mt-3 grid gap-2">{alerts.map((alert) => <p key={alert.id} className={`rounded-lg px-3 py-2 text-sm ${alert.level === 'critical' ? 'bg-red-500/10 text-red-200' : 'bg-orange-500/10 text-orange-100'}`}>{alert.label}</p>)}</div> : <p className="mt-2 text-sm text-zinc-400">Rien à signaler</p>}</section>
      <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="État des carrés">{zones.map((zone, index) => {
        const summary = liveZoneDashboard(tables, zone);
        const state = zoneState(summary.present, zone, summary.available);
        const waiters = [...new Set(tables.filter((table) => table.zone_id === zone.id).map((table) => table.head_waiter?.first_name).filter(Boolean))];
        const pendingDrafts = drafts.filter((draft) => tables.find((table) => table.id === draft.table_id)?.zone_id === zone.id).length;
        return <button type="button" aria-label={`Ouvrir la vue salle ${zone.name}`} className={`panel min-h-56 w-full border p-4 text-left transition hover:bg-zinc-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:p-5 ${accents[index % 4]}`} key={zone.id} onClick={() => router.push(`/hostess?zone=${encodeURIComponent(zone.id)}`)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-xl font-black sm:text-2xl">{zone.name}</h2><p className={`mt-1 text-xs font-black uppercase tracking-[.14em] ${state.color}`}>{state.label} · {loadLabels[summary.load]}</p></div><span aria-hidden="true" className="shrink-0 text-xl text-violet-300/70">›</span></div><div className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-1"><p className="text-3xl font-black">{summary.present} <span className="text-lg text-zinc-500">/ {summary.capacity}</span></p><p className="text-sm font-bold text-zinc-300">{summary.fillRate} % rempli</p></div><p className="mt-1 text-sm text-zinc-400">personnes présentes</p><div className="mt-4"><Progress value={summary.fillRate} tone="bg-fuchsia-500" /></div><div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-300"><span><b>{summary.occupied} / {summary.totalTables}</b> tables occupées</span><span><b>{summary.available}</b> disponibles</span></div>{recentByZone[zone.id] > 0 && <p className="mt-3 text-xs text-violet-200">+{recentByZone[zone.id]} personnes accueillies ces 30 dernières min</p>}{pendingDrafts > 0 && <p className="mt-1 text-xs text-orange-200">{pendingDrafts} arrivée{pendingDrafts > 1 ? 's' : ''} en attente</p>}<p className="mt-3 truncate text-xs text-zinc-500">{waiters.join(' · ')}</p></button>;
      })}</section>
      <section className="panel mt-6 p-4" aria-label="Activité récente"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-black uppercase tracking-[.16em] text-zinc-200">Activité récente</h2><div className="flex flex-wrap gap-2">{([{ id: 'all', label: 'Tout' }, { id: 'sales', label: 'Ventes' }, { id: 'transfers', label: 'Transferts' }, { id: 'drafts', label: 'Arrivées' }] as const).map((filter) => <button type="button" key={filter.id} onClick={() => setActivityFilter(filter.id)} className={activityFilter === filter.id ? 'min-h-9 rounded-full bg-fuchsia-600 px-3 py-1 text-xs font-bold' : 'min-h-9 rounded-full bg-zinc-800 px-3 py-1 text-xs font-bold'}>{filter.label}</button>)}</div></div><div className="mt-3 grid gap-2">{visibleActivities.length ? visibleActivities.map((item) => <article className="flex gap-3 rounded-xl bg-zinc-900/70 p-3" key={item.id}><time className="shrink-0 font-mono text-sm text-zinc-400">{formatShortTime(item.at)}</time><div className="min-w-0"><p className="break-words text-sm text-zinc-200">{activityText(item)}</p>{activitySaleDetails(item) && <p className="mt-1 break-words text-xs text-zinc-400">{activitySaleDetails(item)}</p>}<p className="mt-1 break-words text-xs text-zinc-500">Par {formatActorLabel(actors.get(activityActorId(item) ?? ''))}</p></div></article>) : <p className="text-sm text-zinc-400">Aucune activité pour la soirée active.</p>}</div></section>
    </>}
  </>;
}
