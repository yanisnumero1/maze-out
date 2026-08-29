'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ArrivalDraft, LiveTable, TableStatus, Zone } from '@/lib/types';
import { computedStatus, presentTotal, stats, zoneAvailabilityStatus } from '@/lib/live';
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
  const set = (next: number) => onChange(clamp(next, max));
  return <div className="mt-5 rounded-xl bg-zinc-800 p-3"><div className="flex items-center justify-between gap-4"><span className="font-semibold">{label}</span><span className="text-sm text-zinc-400">{value} / {max}</span></div><div className="mt-3 flex items-center justify-center gap-3"><button disabled={value <= 0} className="h-11 w-11 rounded-lg bg-zinc-700 text-2xl disabled:cursor-not-allowed disabled:opacity-40" onClick={() => set(value - 1)}>−</button><input aria-label={label} type="number" min="0" max={max} inputMode="numeric" className="h-11 w-20 rounded-lg bg-zinc-950 text-center text-xl font-bold outline-none ring-1 ring-zinc-700 focus:ring-violet-400" value={value} onChange={(event) => set(event.target.value === '' ? 0 : Number(event.target.value))} /><button disabled={value >= max} className="h-11 w-11 rounded-lg bg-fuchsia-600 text-2xl disabled:cursor-not-allowed disabled:opacity-40" onClick={() => set(value + 1)}>+</button></div></div>;
}

export function HostessConsole({ tables: initialTables }: { tables: LiveTable[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tables, setTables] = useState(initialTables);
  const [screen, setScreen] = useState<Screen>('zones');
  const [zone, setZone] = useState<Zone | null>(null);
  const [editing, setEditing] = useState<LiveTable | null>(null);
  const [present, setPresent] = useState(0);
  const [extras, setExtras] = useState(0);
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<ArrivalDraft[]>([]);
  const [actorId, setActorId] = useState('');
  const [role, setRole] = useState('');
  const [activeSales, setActiveSales] = useState<Record<string, number>>({});
  const [changingTable, setChangingTable] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState(false);
  const [handledTableParam, setHandledTableParam] = useState<string | null>(null);

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

  async function refresh() {
    const [{ data: tableRows, error: tablesError }, { data: draftRows, error: draftsError }, { data: saleRows, error: salesError }, { data: userData }] = await Promise.all([
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('display_number'),
      supabase.from('arrival_drafts').select('*').eq('status', 'draft'),
      supabase.from('table_visits').select('table_id,sale_number').is('ended_at', null),
      supabase.auth.getUser(),
    ]);
    if (tablesError || draftsError || salesError) console.error('[HOSTESS] Impossible de rafraîchir la vue salle.', { tablesError, draftsError, salesError });
    if (tableRows) setTables(normalise(tableRows));
    setDrafts((draftRows ?? []) as ArrivalDraft[]);
    setActorId(userData.user?.id ?? '');
    if (userData.user?.id) {
      const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', userData.user.id).single();
      if (profileError) console.error('[HOSTESS] Impossible de charger le rôle utilisateur.', profileError);
      setRole(profile?.role ?? '');
    }
    setActiveSales(Object.fromEntries((saleRows ?? []).filter((visit: any) => visit.sale_number).map((visit: any) => [visit.table_id, visit.sale_number])));
  }

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('hostess-live').on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, () => void refresh()).on('postgres_changes', { event: '*', schema: 'public', table: 'arrival_drafts' }, () => void refresh()).on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void refresh()).subscribe();
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
    setNotice('');
  }, [drafts, handledTableParam, router, searchParams, tables]);

  function openTable(table: LiveTable) {
    const draft = drafts.find((item) => item.table_id === table.id);
    if (draft && draft.actor_id !== actorId) return setNotice('Cette table est en brouillon par une autre hôtesse.');
    if (draft) { setEditing(null); setChangingTable(false); setNotice(''); return; }
    const maxPeople = table.max_people ?? table.standard_capacity;
    const maxGuests = table.max_extra_guests ?? 0;
    setEditing(table);
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
  const backToColumns = () => { setEditing(null); setChangingTable(false); };
  const backToZones = () => router.push('/' as any);
  const zoneState = zoneAvailabilityStatus(zoneSummary.present, zone?.max_capacity, zoneSummary.available);
  const zoneLabel = zoneState === 'complete' ? 'COMPLET' : zoneState === 'charged' ? 'CHARGÉ' : 'OUVERT';
  const columnGrid = waiters.length === 1 ? 'grid gap-4' : waiters.length === 2 ? 'grid gap-4 md:grid-cols-2' : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3';

  const tableCard = (table: LiveTable) => {
    const draft = drafts.find((item) => item.table_id === table.id);
    const draftOwn = draft?.actor_id === actorId;
    const style = draft ? { badge: 'bg-orange-500/15 text-orange-300 ring-orange-400/30', label: 'BROUILLON' } : tableStyles[computedStatus(table)];
    const clients = draft ? draft.present_people + draft.extra_guests : presentTotal(table);
    const canMove = changingTable && computedStatus(table) === 'free' && !draft;
    return <button disabled={changingTable && !canMove} onClick={() => changingTable ? void moveDraft(table) : openTable(table)} className="group flex min-h-[112px] w-full items-center rounded-2xl border border-violet-500/30 bg-zinc-900 p-4 text-left shadow-lg shadow-black/20 transition hover:border-violet-400/60 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40" key={table.id}><div className="min-w-0"><b className="block text-lg tracking-wide text-white">TABLE {table.display_number}</b><span className="mt-1 block text-sm text-zinc-300">{draft ? `${draft.present_people} personne${draft.present_people !== 1 ? 's' : ''}${draft.extra_guests > 0 ? ` + ${draft.extra_guests} invité${draft.extra_guests !== 1 ? 's' : ''}` : ''}` : `${clients} personne${clients !== 1 ? 's' : ''}`}</span><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${style.badge}`}>{style.label}</span>{activeSales[table.id] && <span className="mt-2 block text-xs text-zinc-400">Vente #{activeSales[table.id]}</span>}{draftOwn && <span className="mt-2 block text-xs text-violet-200">À confirmer</span>}</div><span className="ml-auto text-xl text-violet-300/70">›</span></button>;
  };

  if (displayedDraft && !changingTable && !editing) {
    const draftTable = tables.find((table) => table.id === displayedDraft.table_id);
    const canConfirmOrEdit = displayedDraft.actor_id === actorId || role === 'admin';
    return <><button onClick={() => { setChangingTable(true); setScreen('columns'); router.replace(`/hostess?zone=${encodeURIComponent(draftTable?.zone_id ?? '')}`); }} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button><section className="panel p-5"><p className="text-sm font-bold uppercase tracking-[.2em] text-violet-300">Brouillon</p><h1 className="mt-1 text-3xl font-black">TABLE {draftTable?.display_number}</h1><p className="mt-5">{displayedDraft.present_people} personnes{displayedDraft.extra_guests > 0 ? ` · ${displayedDraft.extra_guests} invités` : ''}</p>{draftTable?.zone && <p className="mt-2 text-sm text-zinc-400">{draftTable.zone.name} · {draftTable.head_waiter ? `${draftTable.head_waiter.first_name} ${draftTable.head_waiter.last_name}` : 'CDR non attribué'}</p>}{displayedDraft.comment && <p className="mt-2 text-sm text-zinc-400">{displayedDraft.comment}</p>}{canConfirmOrEdit ? <><p className="mt-6 font-semibold">Confirmer l’installation sur la Table {draftTable?.display_number} ?</p><div className="mt-5 grid gap-3"><button className="rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => { if (draftTable) { setEditing(draftTable); setPresent(displayedDraft.present_people); setExtras(displayedDraft.extra_guests); setComment(displayedDraft.comment ?? ''); } }}>Modifier</button><button className="rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => { setChangingTable(true); setScreen('columns'); }}>Changer de table</button><button disabled={confirming} className="rounded-xl bg-fuchsia-600 p-4 font-bold disabled:cursor-wait disabled:opacity-60" onClick={() => void confirmDraft()}>{confirming ? 'Confirmation...' : 'Confirmer l’arrivée'}</button></div></> : <p className="mt-6 text-sm text-zinc-400">Ce brouillon est préparé par une autre hôtesse : seule son autrice ou un administrateur peut le modifier ou le confirmer.</p>}{cancelConfirmation ? <div className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4"><p className="font-bold">Annuler cette arrivée en attente ?</p><p className="mt-1 text-sm text-zinc-300">Le brouillon de la Table {draftTable?.display_number} sera annulé. Aucune arrivée ne sera comptabilisée.</p><div className="mt-4 grid grid-cols-2 gap-3"><button className="rounded-xl bg-zinc-800 p-3 font-bold" onClick={() => setCancelConfirmation(false)}>Retour</button><button disabled={cancelling} className="rounded-xl bg-red-600 p-3 font-bold disabled:opacity-60" onClick={() => void cancelDraft()}>{cancelling ? 'Annulation...' : 'Annuler l’arrivée'}</button></div></div> : <button className="mt-5 w-full rounded-xl border border-red-500/40 bg-red-500/10 p-4 font-bold text-red-200 hover:bg-red-500/20" onClick={() => setCancelConfirmation(true)}>Annuler l’arrivée</button>}{notice && <p className="mt-3 text-red-300">{notice}</p>}</section></>;
  }

  if (editing) {
    const maxPeople = editing.max_people ?? editing.standard_capacity;
    const maxGuests = editing.max_extra_guests ?? 0;
    const occupied = presentTotal(editing) > 0;
    return <><button onClick={backToColumns} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button><section className="panel p-5"><h1 className="text-3xl font-black">TABLE {editing.display_number}</h1><Counter label="Personnes" value={present} max={maxPeople} onChange={setPresent} /><Counter label="Invités" value={extras} max={maxGuests} onChange={setExtras} /><div className="mt-5 rounded-xl bg-zinc-800 p-4"><span className="text-sm text-zinc-400">TOTAL</span><b className="ml-3 text-3xl">{present + extras}</b></div><label className="mt-5 block text-sm font-semibold">Commentaire <span className="font-normal text-zinc-400">(facultatif)</span><textarea className="mt-2 w-full rounded-xl bg-zinc-800 p-4" value={comment} onChange={(event) => setComment(event.target.value)} /></label>{occupied ? <><button className="mt-5 w-full rounded-xl bg-fuchsia-600 p-5 text-lg font-black" onClick={() => void saveExistingOccupation()}>ENREGISTRER</button><button className="mt-3 w-full rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => void releaseTable()}>Libérer la table</button></> : <button className="mt-5 w-full rounded-xl bg-fuchsia-600 p-5 text-lg font-black" onClick={() => void prepareArrival()}>Préparer l’arrivée</button>}{notice && <p className="mt-3 text-red-300">{notice}</p>}</section></>;
  }

  if (screen === 'zones') return <><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Arrivées</p><h1 className="text-3xl font-black">HÔTESSE</h1></header><TableSearch tables={tables} drafts={drafts} onSelect={(table) => router.replace(`/hostess?table=${encodeURIComponent(String(table.display_number))}`)} /><section className="grid gap-4">{zones.map((item) => { const summary = stats(tables.filter((table) => table.zone_id === item.id)); return <button className="panel min-h-28 p-6 text-left" onClick={() => openZone(item)} key={item.id}><b className="block text-2xl">{item.name}</b><span className="mt-2 block text-sm text-zinc-400">{summary.available} table{summary.available !== 1 ? 's' : ''} restante{summary.available !== 1 ? 's' : ''}</span></button>; })}</section></>;

  return <><header className="mb-5"><button onClick={backToZones} className="mb-3 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR AUX CARRÉS</button><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Arrivées</p><div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2"><h1 className="text-3xl font-black">{zone?.name}</h1><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${zoneState === 'complete' ? 'bg-red-500/15 text-red-300' : zoneState === 'charged' ? 'bg-orange-500/15 text-orange-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{zoneLabel}</span></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400"><span>Tables utilisées : {zoneSummary.occupied} / {inZone.length}</span><span>Clients présents : {zoneSummary.present}</span>{zone?.max_capacity && <span>Capacité zone : {zoneSummary.present} / {zone.max_capacity}</span>}</div></header>{changingTable && <p className="mb-4 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-200">Choisissez une table disponible compatible avec ce brouillon.</p>}<section className={columnGrid}>{waiters.map((item) => { const mine = inZone.filter((table) => table.head_waiter_id === item.id); const summary = stats(mine); return <section className="panel min-w-0 p-4" key={item.id}><header className="mb-4 border-b border-zinc-800 pb-3"><h2 className="text-xl font-black">{item.first_name} {item.last_name}</h2><p className="mt-1 text-sm text-zinc-400">{summary.available} / {mine.length} tables disponibles</p></header><div className="grid gap-3">{mine.map(tableCard)}</div></section>; })}</section>{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</>;
}
