'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { liveActivity, liveDashboard, liveDashboardAlerts, liveZoneDashboard, zoneAvailabilityStatus } from '@/lib/live';
import { actorIdsForResolution, actorProfileMap, formatActorLabel, latestAuditActor } from '@/lib/actors';
import { supabase } from '@/lib/supabase/client';
import { GlobalSearch } from '@/components/global-search';
import { getTableDisplayNumber } from '@/lib/tables';
import type { ArrivalDraft, BusinessReferrer, LiveTable, OperationalActorProfile, OperationalAuditLog, Promoter, TableVisit, TableVisitTransfer, Zone } from '@/lib/types';

type ActivityFilter = 'all' | 'sales' | 'transfers' | 'drafts';
type ConnectionState = 'live' | 'reconnecting' | 'offline';

const loadLabels = { calme: 'CALME', modere: 'ACTIVITÉ MODÉRÉE', forte_affluence: 'FORTE AFFLUENCE', presque_complet: 'PRESQUE COMPLET' } as const;
const connectionLabels = { live: 'LIVE · Synchronisé', reconnecting: 'RECONNEXION…', offline: 'HORS LIGNE' } as const;
const connectionColors = { live: 'text-emerald-300', reconnecting: 'text-orange-300', offline: 'text-red-300' } as const;

const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));
const percentageWidth = (value: number) => `${Math.max(0, Math.min(100, value))}%`;
const formatShortTime = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const formatNightElapsed = (startedAt: string, now: Date) => {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 60000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

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
  const [showAllActivity, setShowAllActivity] = useState(false);

  const zones = useMemo(() => [...new Map(tables.filter((table) => table.zone).map((table) => [table.zone.id, table.zone])).values()].sort((left, right) => left.display_order - right.display_order), [tables]);
  const dashboard = useMemo(() => liveDashboard(tables, zones, drafts), [drafts, tables, zones]);
  const alerts = useMemo(() => liveDashboardAlerts(tables, zones, drafts, transfers, now ?? new Date()), [drafts, now, tables, transfers, zones]);
  const activities = useMemo(() => liveActivity(visits, transfers, drafts), [drafts, transfers, visits]);
  const actors = useMemo(() => actorProfileMap(actorProfiles), [actorProfiles]);
  const visibleActivities = activities.filter((item) => activityFilter === 'all' || (activityFilter === 'sales' && item.kind.startsWith('sale_')) || (activityFilter === 'transfers' && item.kind === 'transfer') || (activityFilter === 'drafts' && item.kind === 'draft'));
  const displayedActivities = showAllActivity ? visibleActivities : visibleActivities.slice(0, 3);

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
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-fuchsia-400">LIVE</p><h1 className="mt-1 text-3xl font-black">MAZE-OUT</h1><p className="mt-1 text-sm text-zinc-400">{activeNightId ? nightStartedAt && now ? `Soirée en cours · ${formatNightElapsed(nightStartedAt, now)}` : 'Soirée en cours' : 'Aucune soirée active'}</p></div><div className="flex items-center gap-2 text-xs font-bold"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${connection === 'live' ? 'bg-emerald-400' : connection === 'offline' ? 'bg-red-400' : 'bg-orange-400'}`} /><span className={connectionColors[connection]}>{connectionLabels[connection]}</span></div></header>
    {loading ? <div className="panel p-6 text-zinc-300">Chargement…</div> : error ? <div className="panel border-red-500/40 p-6 text-red-200"><p>Impossible de charger les données</p><p className="mt-1 text-sm text-red-200/70">{error}</p></div> : zones.length === 0 ? <div className="panel p-6 text-zinc-300">Aucune donnée disponible</div> : <>
      <p className="mb-3 text-right text-[11px] text-zinc-600">Mis à jour {updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Actions rapides"><button type="button" onClick={() => router.push('/hostess')} className="min-h-11 rounded-xl bg-fuchsia-600 px-3 py-2 text-sm font-black text-white">Nouvelle arrivée</button><button type="button" onClick={() => router.push('/hostess?view=entrees')} className="min-h-11 rounded-xl bg-zinc-800 px-3 py-2 text-sm font-bold">Entrées club</button><button type="button" onClick={() => router.push('/hostess?view=piste')} className="min-h-11 rounded-xl bg-zinc-800 px-3 py-2 text-sm font-bold">Piste</button><button type="button" onClick={() => router.push('/hostess?view=promoteurs')} className="min-h-11 rounded-xl bg-zinc-800 px-3 py-2 text-sm font-bold">Promoteurs</button></section>
      <div className="mt-4"><GlobalSearch tables={tables} drafts={drafts} visits={visits} businessReferrers={businessReferrers} promoters={promoters} onSelectTable={(table) => router.push(`/hostess?table=${encodeURIComponent(getTableDisplayNumber(table))}`)} onSelectPromoter={(promoter) => router.push(`/hostess?view=promoteurs&promoter=${encodeURIComponent(promoter.id)}`)} onSelectCdr={(table) => router.push(`/hostess?zone=${encodeURIComponent(table.zone_id)}`)} /></div>
      <section className="mt-5 grid grid-cols-3 gap-2" aria-label="Indicateurs Live"><article className="rounded-2xl bg-zinc-900/70 p-3 sm:p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Tables</p><p className="mt-1 text-2xl font-black sm:text-3xl">{dashboard.occupied}<span className="text-sm text-zinc-600">/{tables.length}</span></p><p className="mt-1 text-xs text-zinc-400">occupées</p></article><article className="rounded-2xl bg-zinc-900/70 p-3 sm:p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Personnes</p><p className="mt-1 text-2xl font-black sm:text-3xl">{dashboard.present}</p><p className="mt-1 text-xs text-zinc-400">présentes</p></article><article className="rounded-2xl bg-zinc-900/70 p-3 sm:p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Attentes</p><p className="mt-1 text-2xl font-black text-orange-200 sm:text-3xl">{dashboard.activeDraftCount}</p><p className="mt-1 text-xs text-zinc-400">{dashboard.pendingPeople} personnes</p></article></section>
      {drafts.length > 0 && <section className="panel mt-4 border border-orange-500/30 p-4" aria-label="Arrivées en attente"><h2 className="text-sm font-black uppercase tracking-[.16em] text-orange-200">Arrivées en attente · {drafts.length}</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{drafts.map((draft) => <button type="button" key={draft.id} onClick={() => router.push(`/hostess?draft=${encodeURIComponent(draft.id)}`)} className="flex items-center justify-between rounded-xl bg-zinc-900 px-3 py-2 text-left hover:bg-zinc-800"><span><b className="block">{tableName(draft.table_id)}</b><span className="text-xs text-zinc-400">{draft.present_people + draft.extra_guests} personnes attendues</span><span className="mt-1 block text-xs text-zinc-500">Préparé par {formatActorLabel(actors.get(draft.actor_id))}</span></span><span aria-hidden="true" className="text-violet-300">›</span></button>)}</div></section>}
      <section className="mt-5" aria-label="État des carrés"><h2 className="mb-3 text-lg font-black">CARRÉS</h2><div className="grid gap-3 sm:grid-cols-2">{zones.map((zone) => {
        const summary = liveZoneDashboard(tables, zone);
        const state = zoneState(summary.present, zone, summary.available);
        return <button type="button" aria-label={`Ouvrir la vue salle ${zone.name}`} className="min-h-44 w-full rounded-2xl bg-zinc-900/80 p-4 text-left ring-1 ring-zinc-800 transition hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:p-5" key={zone.id} onClick={() => router.push(`/hostess?zone=${encodeURIComponent(zone.id)}`)}><div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-black sm:text-2xl">{zone.name}</h3><p className={`mt-1 text-xs font-black ${state.color}`}>{state.label} · {loadLabels[summary.load]}</p></div><span aria-hidden="true" className="text-xl text-violet-300">›</span></div><p className="mt-5 text-3xl font-black">{summary.present}<span className="text-lg text-zinc-600">/{summary.capacity}</span> <span className="text-sm font-semibold text-zinc-400">personnes</span></p><div className="mt-3"><Progress value={summary.fillRate} /></div><p className="mt-4 text-sm text-zinc-300"><b>{summary.occupied}</b> tables occupées</p></button>;
      })}</div></section>
      {alerts.length > 0 && <section className="mt-5" aria-label="À surveiller"><h2 className="text-sm font-black uppercase tracking-wide text-zinc-400">À surveiller</h2><div className="mt-2 grid gap-2">{alerts.map((alert) => <p key={alert.id} className={`rounded-lg px-3 py-2 text-sm ${alert.level === 'critical' ? 'bg-red-500/10 text-red-200' : 'bg-orange-500/10 text-orange-100'}`}>{alert.label}</p>)}</div></section>}
      <section className="mt-6 border-t border-zinc-800 pt-5" aria-label="Activité récente"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-black uppercase tracking-wide text-zinc-400">Activité récente</h2><div className="flex flex-wrap gap-2">{([{ id: 'all', label: 'Tout' }, { id: 'sales', label: 'Ventes' }, { id: 'transfers', label: 'Transferts' }, { id: 'drafts', label: 'Arrivées' }] as const).map((filter) => <button type="button" key={filter.id} onClick={() => { setActivityFilter(filter.id); setShowAllActivity(false); }} className={activityFilter === filter.id ? 'min-h-9 rounded-full bg-fuchsia-600 px-3 py-1 text-xs font-bold' : 'min-h-9 rounded-full bg-zinc-800 px-3 py-1 text-xs font-bold'}>{filter.label}</button>)}</div></div><div className="mt-3 grid gap-2">{displayedActivities.length ? displayedActivities.map((item) => <article className="flex gap-3 py-2" key={item.id}><time className="shrink-0 font-mono text-sm text-zinc-500">{formatShortTime(item.at)}</time><div className="min-w-0"><p className="break-words text-sm text-zinc-200">{activityText(item)}</p>{activitySaleDetails(item) && <p className="mt-1 break-words text-xs text-zinc-400">{activitySaleDetails(item)}</p>}<p className="mt-1 break-words text-xs text-zinc-600">Par {formatActorLabel(actors.get(activityActorId(item) ?? ''))}</p></div></article>) : <p className="text-sm text-zinc-500">Aucune activité.</p>}</div>{visibleActivities.length > 3 && <button type="button" onClick={() => setShowAllActivity((value) => !value)} className="mt-3 min-h-10 text-sm font-bold text-violet-300">{showAllActivity ? 'Réduire' : 'Voir plus'}</button>}</section>
    </>}
  </>;
}
