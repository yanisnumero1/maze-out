'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ArrivalDraft, LiveTable, OperationalActorProfile, OperationalAuditLog, TableStatus, TableVisit, TableVisitTransfer, Zone } from '@/lib/types';
import { computedStatus, presentTotal, stats, zoneAvailabilityStatus } from '@/lib/live';
import { actorIdsForResolution, actorProfileMap, formatActorLabel, latestAuditActor } from '@/lib/actors';
import { supabase } from '@/lib/supabase/client';
import { TableSearch } from '@/components/table-search';

type Screen = 'zones' | 'columns';

const tableStyles: Record<TableStatus, { badge: string; label: string }> = {
  free: { badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30', label: 'LIBRE' },
  reserved: { badge: 'bg-violet-500/15 text-violet-200 ring-violet-400/30', label: 'RÉSERVÉE' },
  occupied: { badge: 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-400/30', label: 'OCCUPÉE' },
  light_overload: { badge: 'bg-orange-500/15 text-orange-300 ring-orange-400/30', label: 'CHARGÉE' },
  overload: { badge: 'bg-red-500/15 text-red-300 ring-red-400/30', label: 'CAPACITÉ ATTEINTE' },
  unavailable: { badge: 'bg-zinc-700 text-zinc-300 ring-zinc-500/40', label: 'INDISPONIBLE' },
};

const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

function Counter({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  const [input, setInput] = useState(String(value));
  useEffect(() => setInput(String(value)), [value]);
  const set = (next: number) => { const safe = clamp(next, max); setInput(String(safe)); onChange(safe); };
  return <div className="mt-5 rounded-xl bg-zinc-800 p-3"><div className="flex items-center justify-between gap-4"><span className="font-semibold">{label}</span><span className="text-sm text-zinc-400">{value} / {max}</span></div><div className="mt-3 flex items-center justify-center gap-3"><button disabled={value <= 0} className="h-11 w-11 rounded-lg bg-zinc-700 text-2xl disabled:cursor-not-allowed disabled:opacity-40" onClick={() => set(value - 1)}>−</button><input aria-label={label} type="number" min="0" max={max} inputMode="numeric" className="h-11 w-20 rounded-lg bg-zinc-950 text-center text-xl font-bold outline-none ring-1 ring-zinc-700 focus:ring-violet-400" value={input} onFocus={() => { if (value === 0) setInput(''); }} onChange={(event) => { const next = event.target.value; setInput(next); if (next !== '') onChange(clamp(Number(next), max)); }} onBlur={() => set(input === '' ? 0 : Number(input))} /><button disabled={value >= max} className="h-11 w-11 rounded-lg bg-fuchsia-600 text-2xl disabled:cursor-not-allowed disabled:opacity-40" onClick={() => set(value + 1)}>+</button></div></div>;
}

export function HostessConsole({ tables: initialTables }: { tables: LiveTable[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tables, setTables] = useState(initialTables);
  const [screen, setScreen] = useState<Screen>('zones');
  const [zone, setZone] = useState<Zone | null>(null);
  const [editing, setEditing] = useState<LiveTable | null>(null);
  const [editingMode, setEditingMode] = useState(false);
  const [present, setPresent] = useState(0);
  const [extras, setExtras] = useState(0);
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<ArrivalDraft[]>([]);
  const [actorId, setActorId] = useState('');
  const [role, setRole] = useState('');
  const [activeSales, setActiveSales] = useState<Record<string, number>>({});
  const [tableVisits, setTableVisits] = useState<TableVisit[]>([]);
  const [transfers, setTransfers] = useState<TableVisitTransfer[]>([]);
  const [auditRows, setAuditRows] = useState<OperationalAuditLog[]>([]);
  const [actorProfiles, setActorProfiles] = useState<OperationalActorProfile[]>([]);
  const [changingTable, setChangingTable] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState(false);
  const [handledTableParam, setHandledTableParam] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferQuery, setTransferQuery] = useState('');
  const [transferConfirm, setTransferConfirm] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);

  const zones = useMemo(() => [...new Map(tables.map((table) => [table.zone.id, table.zone])).values()].sort((left, right) => left.display_order - right.display_order), [tables]);
  const inZone = useMemo(() => zone ? tables.filter((table) => table.zone_id === zone.id) : [], [tables, zone]);
  const waiters = useMemo(() => [...new Map(inZone.filter((table) => table.head_waiter).map((table) => [table.head_waiter!.id, table.head_waiter!])).values()], [inZone]);
  const ownDraft = useMemo(() => drafts.find((draft) => draft.actor_id === actorId) ?? null, [actorId, drafts]);
  const requestedDraft = useMemo(() => {
    const draftId = searchParams.get('draft');
    return draftId ? drafts.find((draft) => draft.id === draftId) ?? null : null;
  }, [drafts, searchParams]);
  const displayedDraft = requestedDraft ?? ownDraft;
  const zoneSummary = useMemo(() => stats(inZone), [inZone]);
  const visitsByTable = useMemo(() => {
    const grouped: Record<string, TableVisit[]> = {};
    for (const visit of tableVisits) {
      for (const tableId of new Set([visit.table_id, visit.current_table_id].filter(Boolean) as string[])) {
        (grouped[tableId] ??= []).push(visit);
      }
    }
    Object.values(grouped).forEach((visits) => visits.sort((left, right) => new Date(right.arrived_at).getTime() - new Date(left.arrived_at).getTime()));
    return grouped;
  }, [tableVisits]);
  const actors = useMemo(() => actorProfileMap(actorProfiles), [actorProfiles]);
  const auditActor = (entityType: string, entityId: string, actionTypes?: string[]) => latestAuditActor(auditRows, entityType, entityId, actionTypes);

  async function refresh() {
    const [{ data: tableRows, error: tablesError }, { data: draftRows, error: draftsError }, { data: userData }, { data: nightId, error: nightError }] = await Promise.all([
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('display_number'),
      supabase.from('arrival_drafts').select('*').eq('status', 'draft'),
      supabase.auth.getUser(),
      supabase.rpc('current_operational_night_session'),
    ]);
    if (tablesError || draftsError || nightError) console.error('[HOSTESS] Impossible de rafraîchir la vue salle.', { tablesError, draftsError, nightError });
    if (tableRows) setTables(normalise(tableRows));
    setDrafts((draftRows ?? []) as ArrivalDraft[]);
    setActorId(userData.user?.id ?? '');
    if (userData.user?.id) {
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', userData.user.id).single();
      if (profileError) console.error('[HOSTESS] Impossible de charger le rôle utilisateur.', profileError);
      setRole(profile?.role ?? '');
    }
    if (!nightId) { setTableVisits([]); setTransfers([]); setAuditRows([]); setActorProfiles([]); setActiveSales({}); return; }
    const [{ data: visitRows, error: visitsError }, { data: transferRows, error: transfersError }, { data: auditData, error: auditError }] = await Promise.all([
      supabase.from('table_visits').select('*').eq('night_session_id', nightId).order('arrived_at'),
      supabase.from('table_visit_transfers').select('*').eq('night_session_id', nightId).order('created_at'),
      supabase.from('operational_audit_log').select('*').eq('night_session_id', nightId).order('created_at', { ascending: false }),
    ]);
    if (visitsError || transfersError || auditError) console.error('[HOSTESS] Historique des ventes impossible à charger.', { visitsError, transfersError, auditError });
    const visits = (visitRows ?? []) as TableVisit[];
    const loadedTransfers = (transferRows ?? []) as TableVisitTransfer[];
    const audits = (auditData ?? []) as OperationalAuditLog[];
    const actorIds = actorIdsForResolution(...audits.map((audit) => audit.actor_id), ...(draftRows ?? []).map((draft: ArrivalDraft) => draft.actor_id), ...loadedTransfers.map((transfer) => transfer.transferred_by));
    const { data: profiles, error: profilesError } = actorIds.length ? await supabase.rpc('get_operational_actor_profiles', { p_actor_ids: actorIds }) : { data: [], error: null };
    if (profilesError) console.error('[HOSTESS] Résolution des auteurs impossible.', profilesError);
    setTableVisits(visits); setTransfers(loadedTransfers); setAuditRows(audits); setActorProfiles((profiles ?? []) as OperationalActorProfile[]);
    setActiveSales(Object.fromEntries(visits.filter((visit) => !visit.ended_at && visit.sale_number).map((visit) => [visit.current_table_id ?? visit.table_id, visit.sale_number!])));
  }

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('hostess-live').on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, () => void refresh()).on('postgres_changes', { event: '*', schema: 'public', table: 'arrival_drafts' }, () => void refresh()).on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void refresh()).on('postgres_changes', { event: '*', schema: 'public', table: 'table_visit_transfers' }, () => void refresh()).on('postgres_changes', { event: '*', schema: 'public', table: 'operational_audit_log' }, () => void refresh()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const zoneId = searchParams.get('zone');
    if (!zoneId || zone || tables.length === 0) return;
    const requestedZone = zones.find((item) => item.id === zoneId);
    if (requestedZone) { setZone(requestedZone); setScreen('columns'); }
  }, [searchParams, tables.length, zone, zones]);

  useEffect(() => {
    const tableNumber = searchParams.get('table');
    if (!tableNumber) { if (handledTableParam) setHandledTableParam(null); return; }
    if (tables.length === 0 || handledTableParam === tableNumber) return;
    const requestedTable = tables.find((table) => String(table.display_number) === tableNumber);
    setHandledTableParam(tableNumber);
    if (!requestedTable) { setNotice('Table introuvable.'); return; }
    const draft = drafts.find((item) => item.table_id === requestedTable.id);
    if (draft) { router.replace(`/hostess?draft=${encodeURIComponent(draft.id)}`); return; }
    setZone(requestedTable.zone);
    setScreen('columns');
    setPresent(clamp(requestedTable.occupancy?.present_people ?? 0, requestedTable.max_people ?? requestedTable.standard_capacity));
    setExtras(clamp(requestedTable.occupancy?.extra_guests ?? 0, requestedTable.max_extra_guests ?? 0));
    setComment(requestedTable.occupancy?.comment ?? '');
    setEditing(requestedTable);
    setEditingMode(false);
    setNotice('');
  }, [drafts, handledTableParam, router, searchParams, tables]);

  useEffect(() => {
    if (editing && displayedDraft) setEditingMode(true);
  }, [displayedDraft, editing]);

  function openTable(table: LiveTable) {
    const draft = drafts.find((item) => item.table_id === table.id);
    if (draft && draft.actor_id !== actorId) return setNotice('Cette table est en brouillon par une autre hôtesse.');
    if (draft) { setEditing(null); setChangingTable(false); setNotice(''); return; }
    const maxPeople = table.max_people ?? table.standard_capacity;
    const maxGuests = table.max_extra_guests ?? 0;
    setEditing(table);
    setEditingMode(false);
    setPresent(clamp(table.occupancy?.present_people ?? 0, maxPeople));
    setExtras(clamp(table.occupancy?.extra_guests ?? 0, maxGuests));
    setComment(table.occupancy?.comment ?? '');
    setNotice('');
  }

  async function prepareArrival() {
    if (!editing) return;
    const { error } = await supabase.rpc('prepare_arrival_draft', { p_table_id: editing.id, p_present_people: clamp(present, editing.max_people ?? editing.standard_capacity), p_extra_guests: clamp(extras, editing.max_extra_guests ?? 0), p_comment: comment || null });
    if (error) return setNotice(error.message);
    setEditing(null); setChangingTable(false); setNotice('Brouillon préparé.'); await refresh();
  }
  async function moveDraft(table: LiveTable) {
    if (!displayedDraft) return;
    const { error } = await supabase.rpc('move_arrival_draft', { p_draft_id: displayedDraft.id, p_table_id: table.id });
    if (error) return setNotice(error.message);
    setChangingTable(false); setNotice('Brouillon déplacé.'); await refresh();
  }
  async function confirmDraft() {
    if (!displayedDraft || confirming) return;
    setConfirming(true);
    const { error } = await supabase.rpc('confirm_arrival_draft', { p_draft_id: displayedDraft.id });
    if (error) { setNotice(error.message.includes('occupied') ? 'Cette table vient d’être occupée par un autre utilisateur. Actualisez ou choisissez une autre table.' : error.message); setConfirming(false); await refresh(); return; }
    setNotice('Arrivée confirmée.'); setConfirming(false); await refresh();
  }
  async function cancelDraft() {
    if (!displayedDraft || cancelling) return;
    setCancelling(true);
    const { error } = await supabase.rpc('cancel_arrival_draft', { p_draft_id: displayedDraft.id });
    if (error) { setNotice(error.message); setCancelling(false); return; }
    const draftTable = tables.find((table) => table.id === displayedDraft.table_id);
    setCancelConfirmation(false);
    setCancelling(false);
    setNotice('Arrivée annulée.');
    if (draftTable?.zone) { setZone(draftTable.zone); setScreen('columns'); router.replace(`/hostess?zone=${encodeURIComponent(draftTable.zone.id)}`); }
    await refresh();
  }
  async function releaseTable() {
    if (!editing) return;
    const { error } = await supabase.rpc('release_operational_table', { p_table_id: editing.id });
    if (error) return setNotice(error.message);
    setEditing(null); setNotice('Table libérée.'); await refresh();
  }
  async function startNextSale() {
    if (!editing) return;
    const { error } = await supabase.rpc('release_operational_table', { p_table_id: editing.id });
    if (error) return setNotice(error.message);
    setEditing({
      ...editing,
      occupancy: {
        table_id: editing.id,
        present_people: 0,
        extra_guests: 0,
        comment: null,
        arrived_at: null,
        updated_at: new Date().toISOString(),
      },
    });
    setPresent(0); setExtras(0); setComment(''); setEditingMode(true);
    setNotice('Vente précédente terminée. Préparez la nouvelle arrivée.');
    await refresh();
  }
  async function confirmTransfer() {
    if (!editing || !transferTargetId || transferBusy) return;
    setTransferBusy(true);
    const { error } = await supabase.rpc('transfer_operational_table', { p_from_table_id: editing.id, p_to_table_id: transferTargetId });
    if (error) { setNotice(error.message); setTransferBusy(false); return; }
    setTransferBusy(false); setTransferConfirm(false); setTransferring(false); setTransferTargetId(''); setEditing(null); setNotice('Table transférée.'); await refresh();
  }
  async function saveExistingOccupation() {
    if (!editing) return;
    const maxPeople = editing.max_people ?? editing.standard_capacity;
    const maxGuests = editing.max_extra_guests ?? 0;
    const payload = { table_id: editing.id, present_people: clamp(present, maxPeople), extra_guests: clamp(extras, maxGuests), comment: comment || null, arrived_at: new Date().toISOString() };
    const { error } = await supabase.from('occupancies').upsert(payload);
    if (error) return setNotice(error.message);
    setEditing(null); await refresh();
  }

  const openZone = (item: Zone) => { setZone(item); setScreen('columns'); setNotice(''); };
  const backToColumns = () => { setEditing(null); setEditingMode(false); setChangingTable(false); setTransferring(false); setTransferTargetId(''); setTransferConfirm(false); };
  const backToZones = () => router.push('/' as any);
  const zoneState = zoneAvailabilityStatus(zoneSummary.present, zone?.max_capacity, zoneSummary.available);
  const zoneLabel = zoneState === 'complete' ? 'COMPLET' : zoneState === 'charged' ? 'CHARGÉ' : 'OUVERT';
  const columnGrid = waiters.length === 1 ? 'grid gap-4' : waiters.length === 2 ? 'grid gap-4 md:grid-cols-2' : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3';

  const tableCard = (table: LiveTable) => {
    const draft = drafts.find((item) => item.table_id === table.id);
    const draftOwn = draft?.actor_id === actorId;
    const style = draft ? { badge: 'bg-orange-500/15 text-orange-300 ring-orange-400/30', label: 'BROUILLON' } : tableStyles[computedStatus(table)];
    const clients = draft ? draft.present_people + draft.extra_guests : presentTotal(table);
    const canMove = changingTable && table.id !== displayedDraft?.table_id && table.active && presentTotal(table) === 0 && !draft && Boolean(displayedDraft) && displayedDraft!.present_people <= (table.max_people ?? table.standard_capacity) && displayedDraft!.extra_guests <= (table.max_extra_guests ?? 0);
    const visitsForCard = visitsByTable[table.id] ?? [];
    const recentVisits = visitsForCard.slice(0, 2);
    const formatTime = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const draftAuthor = draft ? formatActorLabel(actors.get(draft.actor_id)) : null;
    return <button disabled={changingTable && !canMove} onClick={() => changingTable ? void moveDraft(table) : openTable(table)} className="group flex min-h-[148px] w-full items-center rounded-2xl border border-violet-500/30 bg-zinc-900 p-4 text-left shadow-lg shadow-black/20 transition hover:border-violet-400/60 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40" key={table.id}><div className="min-w-0 flex-1"><b className="block text-lg tracking-wide text-white">TABLE {table.display_number}</b><span className="mt-1 block text-sm text-zinc-300">{draft ? `${draft.present_people} personne${draft.present_people !== 1 ? 's' : ''}${draft.extra_guests > 0 ? ` + ${draft.extra_guests} invité${draft.extra_guests !== 1 ? 's' : ''}` : ''}` : `${clients} personne${clients !== 1 ? 's' : ''}`}</span><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${style.badge}`}>{style.label}</span>{draftAuthor && <span className="mt-2 block text-xs text-zinc-500">Préparé par {draftAuthor}</span>}{activeSales[table.id] && <span className="mt-2 block text-xs text-zinc-400">Vente #{activeSales[table.id]}</span>}{draftOwn && <span className="mt-2 block text-xs text-violet-200">À confirmer</span>}<div className="mt-3 border-t border-zinc-800 pt-2 text-xs leading-5 text-zinc-400">{recentVisits.length ? recentVisits.map((visit) => <span className="block truncate" key={visit.id}>Vente #{visit.sale_number ?? '—'} · {formatTime(visit.arrived_at)}{visit.ended_at ? ` → ${formatTime(visit.ended_at)}` : ''} · {visit.ended_at ? 'Terminée' : 'En cours'}</span>) : <span>Aucune vente</span>}{visitsForCard.length > recentVisits.length && <span className="block">+{visitsForCard.length - recentVisits.length} vente{visitsForCard.length - recentVisits.length > 1 ? 's' : ''} précédente{visitsForCard.length - recentVisits.length > 1 ? 's' : ''}</span>}</div></div><span aria-hidden="true" className="ml-3 text-xl text-violet-300/70">›</span></button>;
  };

  if (displayedDraft && !changingTable && !editing) {
    const draftTable = tables.find((table) => table.id === displayedDraft.table_id);
    const canConfirmOrEdit = displayedDraft.actor_id === actorId || role === 'admin';
    return <><button onClick={() => { setChangingTable(true); setScreen('columns'); router.replace(`/hostess?zone=${encodeURIComponent(draftTable?.zone_id ?? '')}`); }} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button><section className="panel p-5"><p className="text-sm font-bold uppercase tracking-[.2em] text-violet-300">Brouillon</p><h1 className="mt-1 text-3xl font-black">TABLE {draftTable?.display_number}</h1><p className="mt-5">{displayedDraft.present_people} personnes{displayedDraft.extra_guests > 0 ? ` · ${displayedDraft.extra_guests} invités` : ''}</p>{draftTable?.zone && <p className="mt-2 text-sm text-zinc-400">{draftTable.zone.name} · {draftTable.head_waiter ? `${draftTable.head_waiter.first_name} ${draftTable.head_waiter.last_name}` : 'CDR non attribué'}</p>}{displayedDraft.comment && <p className="mt-2 text-sm text-zinc-400">{displayedDraft.comment}</p>}{canConfirmOrEdit ? <><p className="mt-6 font-semibold">Confirmer l’installation sur la Table {draftTable?.display_number} ?</p><div className="mt-5 grid gap-3"><button className="rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => { if (draftTable) { setEditing(draftTable); setPresent(displayedDraft.present_people); setExtras(displayedDraft.extra_guests); setComment(displayedDraft.comment ?? ''); } }}>Modifier</button><button className="rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => { setChangingTable(true); setScreen('columns'); }}>Changer de table</button><button disabled={confirming} className="rounded-xl bg-fuchsia-600 p-4 font-bold disabled:cursor-wait disabled:opacity-60" onClick={() => void confirmDraft()}>{confirming ? 'Confirmation...' : 'Confirmer l’arrivée'}</button></div></> : <p className="mt-6 text-sm text-zinc-400">Ce brouillon est préparé par une autre hôtesse : seule son autrice ou un administrateur peut le modifier ou le confirmer.</p>}{cancelConfirmation ? <div className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4"><p className="font-bold">Annuler cette arrivée en attente ?</p><p className="mt-1 text-sm text-zinc-300">Le brouillon de la Table {draftTable?.display_number} sera annulé. Aucune arrivée ne sera comptabilisée.</p><div className="mt-4 grid grid-cols-2 gap-3"><button className="rounded-xl bg-zinc-800 p-3 font-bold" onClick={() => setCancelConfirmation(false)}>Retour</button><button disabled={cancelling} className="rounded-xl bg-red-600 p-3 font-bold disabled:opacity-60" onClick={() => void cancelDraft()}>{cancelling ? 'Annulation...' : 'Annuler l’arrivée'}</button></div></div> : <button className="mt-5 w-full rounded-xl border border-red-500/40 bg-red-500/10 p-4 font-bold text-red-200 hover:bg-red-500/20" onClick={() => setCancelConfirmation(true)}>Annuler l’arrivée</button>}{notice && <p className="mt-3 text-red-300">{notice}</p>}</section></>;
  }

  if (editing && !editingMode) {
    const occupied = presentTotal(editing) > 0;
    const draft = drafts.find((item) => item.table_id === editing.id);
    const visitsForTable = tableVisits.filter((visit) => visit.table_id === editing.id || visit.current_table_id === editing.id);
    const hasPreviousSale = visitsForTable.some((visit) => visit.ended_at);
    const activeVisit = visitsForTable.find((visit) => !visit.ended_at) ?? null;
    const activeVisitActor = activeVisit ? auditActor('table', activeVisit.current_table_id ?? activeVisit.table_id, ['table.arrival_confirmed']) : null;
    const badge = draft ? { label: 'ARRIVÉE EN ATTENTE', className: 'bg-orange-500/15 text-orange-200' } : occupied ? { label: 'OCCUPÉE', className: 'bg-fuchsia-500/15 text-fuchsia-200' } : { label: 'LIBRE', className: 'bg-emerald-500/15 text-emerald-200' };
    return <>
      <button onClick={backToColumns} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button>
      <section className="panel p-5">
        <h1 className="text-3xl font-black">TABLE {editing.display_number}</h1>
        <p className="mt-2 text-sm text-zinc-400">{editing.zone.name} · {editing.head_waiter ? `${editing.head_waiter.first_name} ${editing.head_waiter.last_name}` : 'CDR non attribué'}</p>
        <span className={`mt-4 inline-flex rounded-full px-3 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span>
        {occupied && <section className="mt-5 rounded-xl bg-zinc-800 p-4"><h2 className="font-bold">Vente actuelle</h2><p className="mt-2 text-sm text-zinc-300">{presentTotal(editing)} personnes · Vente #{activeSales[editing.id] ?? '—'}</p>{activeVisitActor && <p className="mt-1 text-xs text-zinc-500">Installée par {formatActorLabel(actors.get(activeVisitActor))}</p>}{editing.occupancy?.comment && <p className="mt-1 text-sm text-zinc-400">{editing.occupancy.comment}</p>}</section>}
        <section className="mt-6">
          <h2 className="text-lg font-bold">Historique de la soirée</h2>
          {visitsForTable.length ? <div className="mt-3 grid gap-3">{visitsForTable.map((visit) => <article className="rounded-xl bg-zinc-800 p-3" key={visit.id}><b>Vente #{visit.sale_number ?? '—'}</b><p className="mt-1 text-sm text-zinc-300">{visit.present_people} personnes{visit.extra_guests ? ` · ${visit.extra_guests} invités` : ''} · {new Date(visit.arrived_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} → {visit.ended_at ? new Date(visit.ended_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'en cours'} · {visit.ended_at ? 'Terminée' : 'En cours'}</p>{visit.comment && <p className="mt-1 text-sm text-zinc-400">{visit.comment}</p>}{transfers.filter((transfer) => transfer.table_visit_id === visit.id).map((transfer) => <p className="mt-2 text-xs text-violet-200" key={transfer.id}>Transfert : Table {tables.find((table) => table.id === transfer.from_table_id)?.display_number} → Table {tables.find((table) => table.id === transfer.to_table_id)?.display_number}</p>)}</article>)}</div> : <p className="mt-2 text-sm text-zinc-400">Aucune vente cette soirée.</p>}
        </section>
        <div className="mt-6 grid gap-3">
          {occupied ? <>
            <button className="rounded-xl bg-fuchsia-600 p-4 font-bold" onClick={() => void startNextSale()}>NOUVELLE VENTE / NOUVELLE ARRIVÉE</button>
            <button className="rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => setEditingMode(true)}>Modifier</button>
            <button className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-4 font-bold text-violet-100" onClick={() => { setEditingMode(true); setTransferring(true); }}>Transférer vers une autre table</button>
          </> : <button className="rounded-xl bg-fuchsia-600 p-4 font-bold" onClick={() => setEditingMode(true)}>{hasPreviousSale ? 'Nouvelle vente / Nouvelle arrivée' : 'Installer une arrivée'}</button>}
        </div>
        {notice && <p className="mt-3 text-red-300">{notice}</p>}
      </section>
    </>;
  }

  if (editing && editingMode) {
    const maxPeople = editing.max_people ?? editing.standard_capacity;
    const maxGuests = editing.max_extra_guests ?? 0;
    const occupied = presentTotal(editing) > 0;
    const visitsForTable = tableVisits.filter((visit) => visit.table_id === editing.id || visit.current_table_id === editing.id);
    const availableTransferTargets = tables.filter((table) => table.id !== editing.id && table.active && presentTotal(table) === 0 && !drafts.some((draft) => draft.table_id === table.id) && present <= (table.max_people ?? table.standard_capacity) && extras <= (table.max_extra_guests ?? 0) && (`${table.display_number} ${table.head_waiter?.first_name ?? ''} ${table.head_waiter?.last_name ?? ''}`.toLowerCase().includes(transferQuery.toLowerCase())));
    const transferTarget = tables.find((table) => table.id === transferTargetId);
    const hasPreviousSale = tableVisits.some((visit) => visit.table_id === editing.id && visit.ended_at);
    return <><button onClick={backToColumns} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button><section className="panel p-5"><h1 className="text-3xl font-black">TABLE {editing.display_number}</h1><Counter label="Personnes" value={present} max={maxPeople} onChange={setPresent} /><Counter label="Invités" value={extras} max={maxGuests} onChange={setExtras} /><div className="mt-5 rounded-xl bg-zinc-800 p-4"><span className="text-sm text-zinc-400">TOTAL</span><b className="ml-3 text-3xl">{present + extras}</b></div><label className="mt-5 block text-sm font-semibold">Commentaire <span className="font-normal text-zinc-400">(facultatif)</span><textarea className="mt-2 w-full rounded-xl bg-zinc-800 p-4" value={comment} onChange={(event) => setComment(event.target.value)} /></label>{occupied ? <><button className="mt-5 w-full rounded-xl bg-fuchsia-600 p-5 text-lg font-black" onClick={() => void saveExistingOccupation()}>ENREGISTRER</button><button className="mt-3 w-full rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => void releaseTable()}>Libérer la table</button><button className="mt-3 w-full rounded-xl border border-violet-500/40 bg-violet-500/10 p-4 font-bold text-violet-100" onClick={() => setTransferring((value) => !value)}>Transférer vers une autre table</button>{transferring && <div className="mt-4 rounded-xl border border-violet-500/30 bg-zinc-950 p-3"><input value={transferQuery} onChange={(event) => setTransferQuery(event.target.value)} placeholder="Rechercher une destination" className="w-full rounded-lg bg-zinc-800 p-3 outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /><div className="mt-3 grid max-h-64 gap-2 overflow-y-auto">{availableTransferTargets.map((table) => <button key={table.id} onClick={() => { setTransferTargetId(table.id); setTransferConfirm(true); }} className="group flex w-full items-center gap-3 rounded-xl bg-zinc-800 p-4 text-left transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><span><b className="block">Table {table.display_number}</b><span className="mt-1 block text-sm text-zinc-400">{table.zone.name} · {table.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}` : 'CDR' } · {table.max_people ?? table.standard_capacity} places</span></span><span aria-hidden="true" className="ml-auto text-xl text-violet-300 transition group-hover:translate-x-0.5">›</span></button>)}{availableTransferTargets.length === 0 && <p className="text-sm text-zinc-400">Aucune destination disponible.</p>}</div></div>}{transferConfirm && transferTarget && <div className="mt-4 rounded-xl border border-orange-500/40 bg-orange-500/10 p-4"><p className="font-bold">Transférer la Table {editing.display_number} vers la Table {transferTarget.display_number} ?</p><p className="mt-1 text-sm text-zinc-300">{present + extras} personnes · la même vente est conservée ; aucune rotation ne sera créée.</p><div className="mt-3 flex gap-2"><button className="rounded-lg bg-zinc-800 px-3 py-2 font-bold" onClick={() => setTransferConfirm(false)}>Annuler</button><button disabled={transferBusy} className="rounded-lg bg-orange-500 px-3 py-2 font-bold text-zinc-950 disabled:opacity-60" onClick={() => void confirmTransfer()}>{transferBusy ? 'Transfert en cours...' : 'Confirmer le transfert'}</button></div></div>}</> : <button className="mt-5 w-full rounded-xl bg-fuchsia-600 p-5 text-lg font-black" onClick={() => void prepareArrival()}>{hasPreviousSale ? 'Revendre la table' : 'Préparer l’arrivée'}</button>}<section className="mt-7 border-t border-zinc-800 pt-5"><h2 className="text-lg font-bold">Historique de la soirée</h2>{visitsForTable.length ? <div className="mt-3 grid gap-3">{visitsForTable.map((visit) => <article className="rounded-xl bg-zinc-800 p-3" key={visit.id}><b>Vente #{visit.sale_number ?? '—'}</b><p className="mt-1 text-sm text-zinc-300">{visit.present_people} personnes{visit.extra_guests ? ` · ${visit.extra_guests} invités` : ''} · {new Date(visit.arrived_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {visit.ended_at ? 'Terminée' : 'En cours'}</p>{visit.comment && <p className="mt-1 text-sm text-zinc-400">{visit.comment}</p>}{transfers.filter((transfer) => transfer.table_visit_id === visit.id).map((transfer) => <p className="mt-2 text-xs text-violet-200" key={transfer.id}>Transfert : Table {tables.find((table) => table.id === transfer.from_table_id)?.display_number} → Table {tables.find((table) => table.id === transfer.to_table_id)?.display_number}</p>)}</article>)}</div> : <p className="mt-2 text-sm text-zinc-400">Aucune vente pour cette table pendant la soirée active.</p>}</section>{notice && <p className="mt-3 text-red-300">{notice}</p>}</section></>;
  }

  if (screen === 'zones') return <><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Arrivées</p><h1 className="text-3xl font-black">ARRIVÉE</h1></header><TableSearch tables={tables} drafts={drafts} onSelect={(table) => router.replace(`/hostess?table=${encodeURIComponent(String(table.display_number))}`)} /><section className="grid gap-4">{zones.map((item) => { const summary = stats(tables.filter((table) => table.zone_id === item.id)); return <button className="panel min-h-28 p-6 text-left" onClick={() => openZone(item)} key={item.id}><b className="block text-2xl">{item.name}</b><span className="mt-2 block text-sm text-zinc-400">{summary.available} table{summary.available !== 1 ? 's' : ''} restante{summary.available !== 1 ? 's' : ''}</span></button>; })}</section></>;

  return <><header className="mb-5"><button onClick={backToZones} className="mb-3 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR AUX CARRÉS</button><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Arrivées</p><div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2"><h1 className="text-3xl font-black">{zone?.name}</h1><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${zoneState === 'complete' ? 'bg-red-500/15 text-red-300' : zoneState === 'charged' ? 'bg-orange-500/15 text-orange-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{zoneLabel}</span></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400"><span>Tables utilisées : {zoneSummary.occupied} / {inZone.length}</span><span>Clients présents : {zoneSummary.present}</span>{zone?.max_capacity && <span>Capacité zone : {zoneSummary.present} / {zone.max_capacity}</span>}</div></header><TableSearch tables={tables} drafts={drafts} onSelect={(table) => router.replace(`/hostess?table=${encodeURIComponent(String(table.display_number))}`)} />{changingTable && <p className="mb-4 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-200">Choisissez une table disponible compatible avec ce brouillon.</p>}<section className={columnGrid}>{waiters.map((item) => { const mine = inZone.filter((table) => table.head_waiter_id === item.id); const summary = stats(mine); return <section className="panel min-w-0 p-4" key={item.id}><header className="mb-4 border-b border-zinc-800 pb-3"><h2 className="text-xl font-black">{item.first_name} {item.last_name}</h2><p className="mt-1 text-sm text-zinc-400">{summary.available} / {mine.length} tables disponibles</p></header><div className="grid gap-3">{mine.map(tableCard)}</div></section>; })}</section>{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</>;
}
