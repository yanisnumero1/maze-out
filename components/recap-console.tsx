'use client';

import { useEffect, useMemo, useState } from 'react';
import { activitySummary, businessReferrerRanking, cdrVisitNotes, promoterTotal, recapAnalytics, recapRotations, recapSaleDetails, recapTables, recapWaiters, recapZones, selectedNightNotes, totalClubEntryCount } from '@/lib/recap';
import { recapActivity } from '@/lib/recap-activity';
import { actorIdsForResolution, actorProfileMap, formatActorLabel } from '@/lib/actors';
import { supabase } from '@/lib/supabase/client';
import { getTableDisplayNumber } from '@/lib/tables';
import { RecapAnalyticsPanel } from '@/components/recap-analytics';
import type { BusinessReferrer, ClubEntryCount, FloorNote, LiveTable, NightReport, NightReportDelivery, NightSession, OperationalActorProfile, OperationalAuditLog, Promoter, PromoterCountEvent, TableVisit, TableVisitTransfer } from '@/lib/types';

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
  const [promoterEvents, setPromoterEvents] = useState<PromoterCountEvent[]>([]);
  const [transfers, setTransfers] = useState<TableVisitTransfer[]>([]);
  const [auditRows, setAuditRows] = useState<OperationalAuditLog[]>([]);
  const [actorProfiles, setActorProfiles] = useState<OperationalActorProfile[]>([]);
  const [reports, setReports] = useState<NightReport[]>([]);
  const [reportDeliveries, setReportDeliveries] = useState<NightReportDelivery[]>([]);
  const [businessReferrers, setBusinessReferrers] = useState<BusinessReferrer[]>([]);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [notice, setNotice] = useState('');
  const [openTableId, setOpenTableId] = useState<string | null>(null);

  async function load() {
    const [{ data: sessionRows, error: sessionError }, { data: tableRows, error: tableError }, { data: visitRows, error: visitError }, { data: entryRows, error: entryError }, { data: promoterRows, error: promoterError }, { data: noteRows, error: noteError }, { data: promoterEventRows, error: promoterEventError }, { data: transferRows, error: transferError }, { data: auditData, error: auditError }, { data: reportRows, error: reportError }, { data: deliveryRows, error: deliveryError }, { data: referrerRows, error: referrerError }] = await Promise.all([
      supabase.from('night_sessions').select('*').order('started_at', { ascending: false }),
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').order('display_number'),
      supabase.from('table_visits').select('*, zone:zones(*), head_waiter:head_waiters!table_visits_head_waiter_id_fkey(*)').order('arrived_at'),
      supabase.from('club_entry_counts').select('*').order('recorded_at', { ascending: false }),
      supabase.from('promoters').select('*').order('name'),
      supabase.from('floor_notes').select('*').order('created_at'),
      supabase.from('promoter_count_events').select('*').order('created_at', { ascending: false }),
      supabase.from('table_visit_transfers').select('*').order('created_at', { ascending: false }),
      supabase.from('operational_audit_log').select('*').order('created_at', { ascending: false }),
      supabase.from('night_reports').select('*').order('created_at', { ascending: false }),
      supabase.from('night_report_deliveries').select('*').order('created_at', { ascending: false }),
      supabase.from('business_referrers').select('*').order('name'),
    ]);
    if (sessionError || tableError || visitError || entryError || promoterError || noteError || promoterEventError || transferError || auditError || reportError || deliveryError || referrerError) {
      console.error('[RECAP] Chargement impossible.', { sessionError, tableError, visitError, entryError, promoterError, noteError, promoterEventError, transferError, auditError, reportError, deliveryError, referrerError });
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
    setPromoterEvents((promoterEventRows ?? []) as PromoterCountEvent[]);
    setTransfers((transferRows ?? []) as TableVisitTransfer[]);
    const audits = (auditData ?? []) as OperationalAuditLog[];
    setAuditRows(audits);
    const actorIds = actorIdsForResolution(
      ...audits.map((audit) => audit.actor_id),
      ...(transferRows ?? []).map((transfer: TableVisitTransfer) => transfer.transferred_by),
      ...(noteRows ?? []).map((note: FloorNote) => note.created_by),
      ...(promoterEventRows ?? []).map((event: PromoterCountEvent) => event.changed_by),
      ...(entryRows ?? []).map((entry: ClubEntryCount) => entry.created_by),
    );
    const { data: profiles, error: profilesError } = actorIds.length ? await supabase.rpc('get_operational_actor_profiles', { p_actor_ids: actorIds }) : { data: [], error: null };
    if (profilesError) console.error('[RECAP] Résolution des auteurs impossible.', profilesError);
    setActorProfiles((profiles ?? []) as OperationalActorProfile[]);
    setReports((reportRows ?? []) as NightReport[]);
    setReportDeliveries((deliveryRows ?? []) as NightReportDelivery[]);
    setBusinessReferrers((referrerRows ?? []) as BusinessReferrer[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const channel = supabase.channel('recap-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_entry_counts' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoters' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_notes' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoter_count_events' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visit_transfers' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operational_audit_log' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'night_reports' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'night_report_deliveries' }, () => void load())
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
  const tableNumbers = useMemo(() => new Map(tables.map((table) => [table.id, getTableDisplayNumber(table)])), [tables]);
  const global = useMemo(() => activitySummary(visits, tables.filter((table) => table.active).length), [tables, visits]);
  const soldTables = useMemo(() => recapTables(visits, tableNumbers), [visits, tableNumbers]);
  const rotations = useMemo(() => recapRotations(soldTables), [soldTables]);
  const zones = useMemo(() => recapZones(tables.filter((table) => table.active), visits), [tables, visits]);
  const waiters = useMemo(() => recapWaiters(tables.filter((table) => table.active), visits), [tables, visits]);
  const finalEntries = useMemo(() => totalClubEntryCount(selectedEntries), [selectedEntries]);
  const promotersCount = useMemo(() => promoterTotal(selectedPromoters), [selectedPromoters]);
  const cdrNotes = useMemo(() => cdrVisitNotes(visits, tableNumbers), [tableNumbers, visits]);
  const businessReferrerRankings = useMemo(() => businessReferrerRanking(visits), [visits]);
  const saleDetails = useMemo(() => recapSaleDetails(visits, tables, businessReferrers), [businessReferrers, tables, visits]);
  const analytics = useMemo(() => recapAnalytics(tables.filter((table) => table.active), visits, transfers.filter((transfer) => transfer.night_session_id === sessionId), selectedPromoters), [selectedPromoters, sessionId, tables, transfers, visits]);
  const selectedTable = soldTables.find((table) => table.tableId === openTableId);
  const selectedReport = reports.find((report) => report.night_session_id === sessionId) ?? null;
  const selectedReportDeliveries = useMemo(() => selectedReport ? reportDeliveries.filter((delivery) => delivery.night_report_id === selectedReport.id) : [], [reportDeliveries, selectedReport]);
  const actors = useMemo(() => actorProfileMap(actorProfiles), [actorProfiles]);
  const activity = useMemo(() => recapActivity({
    audits: auditRows.filter((audit) => audit.night_session_id === sessionId),
    visits,
    transfers: transfers.filter((transfer) => transfer.night_session_id === sessionId),
    notes: selectedNotes,
    promoterEvents: promoterEvents.filter((event) => event.night_session_id === sessionId),
    promoters: selectedPromoters,
    entryCounts: selectedEntries,
    tableNumbers,
  }), [auditRows, promoterEvents, selectedEntries, selectedNotes, selectedPromoters, sessionId, tableNumbers, transfers, visits]);
  const visibleActivity = showAllActivity ? activity : activity.slice(0, 12);

  useEffect(() => setShowAllActivity(false), [sessionId]);

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

  return <><header className="mb-6"><p className="text-xs uppercase tracking-[.2em] text-fuchsia-400 sm:text-sm sm:tracking-[.25em]">Bilan opérationnel</p><h1 className="text-2xl font-black sm:text-3xl">RÉCAPITULATIF DE LA SOIRÉE</h1></header>
    <section className="mb-8"><h2 className="mb-3 text-xl font-bold">SOIRÉE EN COURS</h2>{current ? <button onClick={() => setSessionId(current.id)} className={'panel w-full p-5 text-left ' + (sessionId === current.id ? 'border-fuchsia-500/70' : '')}><b>{formatDate(current.started_at)} — en cours</b><p className="mt-2 text-sm text-zinc-400">{summaryFor(current).clients} personnes aux tables · {summaryFor(current).usedTables} tables vendues</p></button> : <p className="panel p-5 text-zinc-400">Aucune soirée en cours.</p>}</section>
    <section className="mb-8"><h2 className="mb-3 text-xl font-bold">HISTORIQUE DES SOIRÉES</h2>{history.length ? <div className="grid gap-3 sm:grid-cols-2">{history.map((session) => { const summary = summaryFor(session); return <button key={session.id} onClick={() => setSessionId(session.id)} className={'panel p-5 text-left ' + (sessionId === session.id ? 'border-fuchsia-500/70' : '')}><b className="text-lg">{formatDate(session.started_at)}</b><p className="mt-1 text-sm text-zinc-400">{formatTime(session.started_at)} → {session.ended_at ? formatTime(session.ended_at) : '—'}</p><p className="mt-4">{summary.clients} personnes · {summary.usedTables} tables</p></button>; })}</div> : <p className="panel p-5 text-zinc-400">Aucune soirée clôturée.</p>}</section>
    {selected && <section><div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-xl font-bold">DÉTAIL — {formatDate(selected.started_at)}</h2><button onClick={download} className="min-h-11 rounded-xl bg-emerald-600 px-5 py-3 font-bold">Exporter CSV</button>{!selected.ended_at && <button onClick={() => setConfirmClose(true)} className="min-h-11 rounded-xl bg-zinc-800 px-5 py-3 font-bold">Clôturer la soirée</button>}</div>
      {confirmClose && <section className="panel mb-5 border-orange-500/40 p-4 sm:p-5"><h3 className="text-lg font-bold">Clôturer la soirée ?</h3><p className="mt-2 text-sm text-zinc-300">Cette action va figer le récapitulatif et remettre toutes les tables à zéro pour la prochaine soirée.</p><div className="mt-5 flex flex-col gap-3 sm:flex-row"><button className="min-h-12 rounded-xl bg-zinc-800 px-4 py-3 font-bold" onClick={() => setConfirmClose(false)}>Annuler</button><button className="min-h-12 rounded-xl bg-orange-500 px-4 py-3 font-bold text-zinc-950" onClick={() => void closeNight()}>Clôturer la soirée</button></div></section>}
      {notice && <p className="mb-5 text-sm font-semibold text-emerald-300">{notice}</p>}
      <section className="mb-5 rounded-xl border border-violet-500/25 bg-violet-500/5 p-4"><p className="text-xs font-black uppercase tracking-[.16em] text-violet-200">Compte rendu</p>{!selectedReport ? <p className="mt-2 text-sm text-zinc-400">Aucun compte rendu généré pour cette soirée.</p> : <><p className="mt-2 font-bold">{selectedReport.status === 'pending' ? 'En attente d’envoi' : selectedReport.status === 'processing' ? 'Envoi en cours' : selectedReport.status === 'sent' ? `Envoyé le ${selectedReport.sent_at ? `${formatDate(selectedReport.sent_at)} à ${formatTime(selectedReport.sent_at)}` : '—'} · ${selectedReportDeliveries.filter((delivery) => delivery.status === 'sent').length} destinataire(s)` : selectedReport.status === 'partial' ? 'Partiellement envoyé' : 'Échec de l’envoi'}</p>{selectedReport.last_error && <p className="mt-1 text-sm text-zinc-400">{selectedReport.last_error}</p>}</>}</section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">DÉTAIL DES VENTES</h2><div className="grid gap-3 sm:grid-cols-2">{saleDetails.map((sale) => <article className="panel min-w-0 p-4" key={sale.visitId}><div className="flex flex-wrap items-start justify-between gap-2"><b className="text-lg">Table {sale.originTable}{sale.finalTable !== sale.originTable ? ` → Table ${sale.finalTable}` : ''}</b><span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-bold text-violet-200">Vente #{sale.saleNumber ?? '—'}</span></div><p className="mt-2 text-sm text-zinc-400">CDR final · {sale.finalHeadWaiterName}</p><div className="mt-4 grid gap-1 break-words text-sm text-zinc-200"><p><span className="text-zinc-500">Réservation · </span>{sale.reservationName ?? '—'}</p><p><span className="text-zinc-500">Conso · </span>{sale.consumption ?? '—'}</p><p><span className="text-zinc-500">Commentaire · </span>{sale.saleComment ?? '—'}</p><p><span className="text-zinc-500">Note CDR · </span>{sale.cdrComment ?? '—'}</p><p><span className="text-zinc-500">Apporteur validé · </span>{sale.validatedBusinessReferrerName ?? '—'}</p>{!sale.validatedBusinessReferrerName && sale.proposedBusinessReferrerName && <p><span className="text-zinc-500">Proposé · </span>{sale.proposedBusinessReferrerName}</p>}</div></article>)}{saleDetails.length === 0 && <p className="text-sm text-zinc-400">Aucune vente pour cette soirée.</p>}</div></section>
      <RecapAnalyticsPanel analytics={analytics} entries={finalEntries} notesCount={selectedNotes.length} businessReferrerCount={businessReferrerRankings.length} />
      <section className="mt-8 grid gap-6 lg:grid-cols-2"><article><h2 className="mb-3 text-xl font-bold">APPORTEURS D’AFFAIRES</h2><div className="grid gap-3">{businessReferrerRankings.map((referrer) => <article className="panel p-4" key={referrer.key}><b className="block text-lg">{referrer.label}</b><p className="mt-2 text-sm text-zinc-300">{referrer.sales} vente{referrer.sales !== 1 ? 's' : ''} · {referrer.people} personnes</p></article>)}{businessReferrerRankings.length === 0 && <p className="text-sm text-zinc-400">Aucun apporteur d’affaires renseigné pour cette soirée.</p>}</div></article><article><h2 className="mb-3 text-xl font-bold">NOTES CDR &amp; APPORTEURS</h2><div className="grid max-h-[32rem] gap-3 overflow-y-auto pr-1">{cdrNotes.map((visit) => <article className="panel p-4" key={visit.visitId}><b>Table {visit.tableNumber} · Vente #{visit.saleNumber ?? '—'}</b><p className="mt-2 text-sm text-zinc-400">CDR : {visit.headWaiterName} · {visit.people} personnes</p>{visit.businessReferrer && <p className="mt-2 text-sm"><span className="text-zinc-400">Apporteur : </span>{visit.businessReferrer}</p>}{visit.cdrComment && <p className="mt-2 text-sm"><span className="text-zinc-400">Note : </span>{visit.cdrComment}</p>}</article>)}{cdrNotes.length === 0 && <p className="text-sm text-zinc-400">Aucune note CDR ni apporteur renseigné pour cette soirée.</p>}</div></article></section>
      <section className="panel mt-8 p-4" aria-label="Activité récente"><div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-xl font-bold">ACTIVITÉ RÉCENTE</h2><span className="text-xs text-zinc-500">{activity.length} événement{activity.length !== 1 ? 's' : ''}</span></div><div className="mt-3 grid gap-2">{visibleActivity.length ? visibleActivity.map((item) => <article className="flex gap-3 rounded-xl bg-zinc-900/70 p-3" key={item.id}><time className="shrink-0 font-mono text-sm text-zinc-400">{formatTime(item.created_at)}</time><div className="min-w-0"><p className="break-words text-sm text-zinc-200">{item.title}</p>{item.detail && <p className="mt-1 break-words text-xs text-zinc-400">{item.detail}</p>}<p className="mt-1 break-words text-xs text-zinc-500">{formatActorLabel(actors.get(item.actorId ?? ''))}</p></div></article>) : <p className="text-sm text-zinc-400">Aucune activité pour cette soirée.</p>}</div>{activity.length > 12 && <button onClick={() => setShowAllActivity((value) => !value)} className="mt-4 min-h-11 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-bold text-violet-200">{showAllActivity ? 'Réduire l’activité' : 'Voir toute l’activité'}</button>}</section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">DÉTAIL DES TABLES</h2><div className="grid gap-3 sm:grid-cols-2">{soldTables.map((table) => <button key={table.tableId} onClick={() => setOpenTableId(table.tableId)} className="panel p-4 text-left"><b className="text-lg">Table {table.tableNumber}</b><p className="mt-1 text-sm text-zinc-400">{fullName(table.waiter)} · {table.zone?.name ?? '—'}</p><p className="mt-4">{table.sales} vente{table.sales !== 1 ? 's' : ''} · {table.people} personnes accueillies</p></button>)}</div>{soldTables.length === 0 && <p className="text-sm text-zinc-400">Aucune table vendue.</p>}</section>
      {selectedTable && <section className="panel mt-4 p-4 sm:p-5"><div className="flex flex-wrap gap-3"><h2 className="mr-auto text-xl font-bold">TABLE {selectedTable.tableNumber}</h2><button className="min-h-11 text-sm text-violet-300" onClick={() => setOpenTableId(null)}>Fermer</button></div><div className="mt-4 grid gap-3">{selectedTable.visits.map((visit, index) => <article className="rounded-xl bg-zinc-800 p-4" key={visit.id}><b>Vente #{visit.sale_number ?? index + 1}</b><p className="mt-2 text-sm text-zinc-400">{formatTime(visit.arrived_at)} → {visit.ended_at ? formatTime(visit.ended_at) : 'en cours'}</p><p className="mt-2">{visit.present_people} personnes · {visit.extra_guests} invité{visit.extra_guests !== 1 ? 's' : ''} · Total : {visit.present_people + visit.extra_guests}</p></article>)}</div></section>}
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">TABLES LES PLUS VENDUES</h2><div className="grid gap-2">{rotations.map((table) => <div className="panel flex p-3" key={table.tableId}><span className="mr-auto">Table {table.tableNumber}</span><b>{table.sales} vente{table.sales !== 1 ? 's' : ''}</b></div>)}</div></section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">PAR CARRÉ</h2><div className="grid gap-4 sm:grid-cols-2">{zones.map(({ zone, summary }) => <article className="panel p-5" key={zone.id}><h3 className="text-xl font-black">{zone.name}</h3><p className="mt-4">Tables vendues : {summary.usedTables} / {summary.totalTables}</p><p>Ventes totales : {visits.filter((visit) => visit.zone_id === zone.id).length}</p><p>Personnes accueillies : {summary.clients}</p><p>Invités : {summary.extraGuests}</p></article>)}</div></section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">PAR CHEF DE RANG</h2><div className="grid gap-4 sm:grid-cols-2">{waiters.map(({ waiter, assignedTables, summary }) => <article className="panel p-5" key={waiter.id}><h3 className="text-xl font-black">{fullName(waiter)}</h3><p className="mt-4">Tables différentes vendues : {summary.usedTables} / {assignedTables}</p><p>Ventes totales : {visits.filter((visit) => visit.head_waiter_id === waiter.id).length}</p><p>Personnes accueillies : {summary.clients}</p><p>Invités : {summary.extraGuests}</p></article>)}</div></section>
      <section className="mt-8 grid gap-6 lg:grid-cols-2"><article><h2 className="mb-3 text-xl font-bold">ENTRÉES CLUB</h2><div className="panel p-5"><p>Total : <b>{finalEntries} entrées</b></p><div className="mt-4 grid gap-2">{[...selectedEntries].sort((left, right) => new Date(left.recorded_at).getTime() - new Date(right.recorded_at).getTime()).map((entry) => <div className="flex" key={entry.id}><span className="mr-auto text-zinc-400">{formatTime(entry.recorded_at)}</span><b>{entry.count}</b></div>)}</div></div></article><article><h2 className="mb-3 text-xl font-bold">PROMOTEURS</h2><div className="panel p-5"><p>TOTAL PROMOTEURS · <b>{promotersCount} personnes</b></p><div className="mt-4 grid gap-2">{selectedPromoters.map((promoter) => <div className="flex" key={promoter.id}><span className="mr-auto">{promoter.name}</span><b>{promoter.entry_count}</b></div>)}</div></div></article></section>
      <section className="mt-8"><h2 className="mb-3 text-xl font-bold">JOURNAL PISTE</h2><div className="grid gap-3">{selectedNotes.map((note) => <article className="panel p-4" key={note.id}><p className="text-sm text-zinc-400">{formatTime(note.created_at)}</p><p className="mt-2">{note.content}</p></article>)}{selectedNotes.length === 0 && <p className="text-sm text-zinc-400">Aucune note Piste pour cette soirée.</p>}</div></section>
    </section>}
  </>;
}
