'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ArrivalDraft, HeadWaiter, LiveTable, TableStatus, Zone } from '@/lib/types';
import { computedStatus, presentTotal, stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';

type Screen = 'zones' | 'waiters' | 'tables';
const tableStyles: Record<TableStatus, { badge: string; label: string }> = {
  free: { badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30', label: 'DISPONIBLE' }, reserved: { badge: 'bg-violet-500/15 text-violet-200 ring-violet-400/30', label: 'RÉSERVÉE' }, occupied: { badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30', label: 'OCCUPÉE' }, light_overload: { badge: 'bg-orange-500/15 text-orange-300 ring-orange-400/30', label: 'CHARGÉE' }, overload: { badge: 'bg-red-500/15 text-red-300 ring-red-400/30', label: 'SURCHARGE' }, unavailable: { badge: 'bg-zinc-700 text-zinc-300 ring-zinc-500/40', label: 'INDISPONIBLE' },
};
const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({ ...table, reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation, occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy }));
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));

function Counter({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  const set = (next: number) => onChange(clamp(next, max));
  return <div className="mt-5 rounded-xl bg-zinc-800 p-3"><div className="flex items-center justify-between gap-4"><span className="font-semibold">{label}</span><span className="text-sm text-zinc-400">{value} / {max}</span></div><div className="mt-3 flex items-center justify-center gap-3"><button disabled={value <= 0} className="h-11 w-11 rounded-lg bg-zinc-700 text-2xl disabled:cursor-not-allowed disabled:opacity-40" onClick={() => set(value - 1)}>−</button><input aria-label={label} type="number" min="0" max={max} inputMode="numeric" className="h-11 w-20 rounded-lg bg-zinc-950 text-center text-xl font-bold outline-none ring-1 ring-zinc-700 focus:ring-violet-400" value={value} onChange={(event) => set(event.target.value === '' ? 0 : Number(event.target.value))} /><button disabled={value >= max} className="h-11 w-11 rounded-lg bg-fuchsia-600 text-2xl disabled:cursor-not-allowed disabled:opacity-40" onClick={() => set(value + 1)}>+</button></div></div>;
}

export function HostessConsole({ tables: initialTables }: { tables: LiveTable[] }) {
  const [tables, setTables] = useState(initialTables); const [screen, setScreen] = useState<Screen>('zones'); const [zone, setZone] = useState<Zone | null>(null); const [waiter, setWaiter] = useState<HeadWaiter | null>(null);
  const [editing, setEditing] = useState<LiveTable | null>(null); const [present, setPresent] = useState(0); const [extras, setExtras] = useState(0); const [comment, setComment] = useState(''); const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<ArrivalDraft[]>([]); const [actorId, setActorId] = useState(''); const [activeSales, setActiveSales] = useState<Record<string, number>>({}); const [changingTable, setChangingTable] = useState(false); const [confirming, setConfirming] = useState(false);
  const zones = useMemo(() => [...new Map(tables.map((table) => [table.zone.id, table.zone])).values()].sort((left, right) => left.display_order - right.display_order), [tables]);
  const inZone = useMemo(() => zone ? tables.filter((table) => table.zone_id === zone.id) : [], [tables, zone]);
  const waiters = useMemo(() => [...new Map(inZone.filter((table) => table.head_waiter).map((table) => [table.head_waiter!.id, table.head_waiter!])).values()], [inZone]);
  const waiterTables = useMemo(() => waiter ? inZone.filter((table) => table.head_waiter_id === waiter.id) : [], [inZone, waiter]);
  const ownDraft = useMemo(() => drafts.find((draft) => draft.actor_id === actorId) ?? null, [actorId, drafts]);

  async function refresh() {
    const [{ data: tableRows }, { data: draftRows }, { data: saleRows }, { data: userData }] = await Promise.all([
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('display_number'),
      supabase.from('arrival_drafts').select('*').eq('status', 'draft'),
      supabase.from('table_visits').select('table_id,sale_number').is('ended_at', null),
      supabase.auth.getUser(),
    ]);
    if (tableRows) setTables(normalise(tableRows));
    setDrafts((draftRows ?? []) as ArrivalDraft[]);
    setActorId(userData.user?.id ?? '');
    setActiveSales(Object.fromEntries((saleRows ?? []).filter((visit: any) => visit.sale_number).map((visit: any) => [visit.table_id, visit.sale_number])));
  }

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('hostess-live').on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, () => void refresh()).on('postgres_changes', { event: '*', schema: 'public', table: 'arrival_drafts' }, () => void refresh()).on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void refresh()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  function openTable(table: LiveTable) {
    const draft = drafts.find((item) => item.table_id === table.id);
    if (draft && draft.actor_id !== actorId) return setNotice('Cette table est en brouillon par une autre hôtesse.');
    if (draft) { setEditing(null); setChangingTable(false); setNotice(''); return; }
    const maxPeople = table.max_people ?? table.standard_capacity; const maxGuests = table.max_extra_guests ?? 0;
    setEditing(table); setPresent(clamp(table.occupancy?.present_people ?? 0, maxPeople)); setExtras(clamp(table.occupancy?.extra_guests ?? 0, maxGuests)); setComment(table.occupancy?.comment ?? ''); setNotice('');
  }

  async function prepareArrival() {
    if (!editing) return; const { data, error } = await supabase.rpc('prepare_arrival_draft', { p_table_id: editing.id, p_present_people: clamp(present, editing.max_people ?? editing.standard_capacity), p_extra_guests: clamp(extras, editing.max_extra_guests ?? 0), p_comment: comment || null });
    if (error) return setNotice(error.message); setEditing(null); setChangingTable(false); setNotice('Brouillon préparé.'); await refresh();
  }
  async function moveDraft(table: LiveTable) {
    if (!ownDraft) return; const { error } = await supabase.rpc('move_arrival_draft', { p_draft_id: ownDraft.id, p_table_id: table.id });
    if (error) return setNotice(error.message); setChangingTable(false); setNotice('Brouillon déplacé.'); await refresh();
  }
  async function confirmDraft() {
    if (!ownDraft || confirming) return; setConfirming(true); const { error } = await supabase.rpc('confirm_arrival_draft', { p_draft_id: ownDraft.id });
    if (error) { setNotice(error.message.includes('occupied') ? 'Cette table vient d’être occupée par un autre utilisateur. Actualisez ou choisissez une autre table.' : error.message); setConfirming(false); await refresh(); return; }
    setNotice('Arrivée confirmée.'); setConfirming(false); await refresh();
  }
  async function releaseTable() {
    if (!editing) return; const { error } = await supabase.rpc('release_operational_table', { p_table_id: editing.id }); if (error) return setNotice(error.message); setEditing(null); setNotice('Table libérée.'); await refresh();
  }
  async function saveExistingOccupation() {
    if (!editing) return; const maxPeople = editing.max_people ?? editing.standard_capacity; const maxGuests = editing.max_extra_guests ?? 0; const payload = { table_id: editing.id, present_people: clamp(present, maxPeople), extra_guests: clamp(extras, maxGuests), comment: comment || null, arrived_at: new Date().toISOString() };
    const { error } = await supabase.from('occupancies').upsert(payload); if (error) return setNotice(error.message); setEditing(null); await refresh();
  }
  function back() { setEditing(null); setChangingTable(false); if (screen === 'tables') { setWaiter(null); setScreen('waiters'); } else if (screen === 'waiters') { setZone(null); setScreen('zones'); } }
  const header = <header className="mb-5">{screen !== 'zones' && <button onClick={back} className="mb-3 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button>}<p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Arrivées</p><h1 className="text-3xl font-black">{screen === 'zones' ? 'HÔTESSE' : screen === 'waiters' ? zone?.name : `${waiter?.first_name} ${waiter?.last_name} — ${zone?.name}`}</h1></header>;

  if (ownDraft && !changingTable && !editing) { const draftTable = tables.find((table) => table.id === ownDraft.table_id); return <><button onClick={() => { setChangingTable(true); setScreen('tables'); }} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button><section className="panel p-5"><p className="text-sm font-bold uppercase tracking-[.2em] text-violet-300">Brouillon</p><h1 className="mt-1 text-3xl font-black">TABLE {draftTable?.display_number}</h1><p className="mt-5">{ownDraft.present_people} personnes · {ownDraft.extra_guests} invités</p>{ownDraft.comment && <p className="mt-2 text-sm text-zinc-400">{ownDraft.comment}</p>}<p className="mt-6 font-semibold">Confirmer l’installation sur la Table {draftTable?.display_number} ?</p><div className="mt-5 grid gap-3"><button className="rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => { if (draftTable) { setEditing(draftTable); setPresent(ownDraft.present_people); setExtras(ownDraft.extra_guests); setComment(ownDraft.comment ?? ''); } }}>Modifier</button><button className="rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => { setChangingTable(true); setScreen('tables'); }}>Changer de table</button><button disabled={confirming} className="rounded-xl bg-fuchsia-600 p-4 font-bold disabled:cursor-wait disabled:opacity-60" onClick={() => void confirmDraft()}>{confirming ? 'Confirmation...' : 'Confirmer l’arrivée'}</button></div>{notice && <p className="mt-3 text-red-300">{notice}</p>}</section></>; }
  if (editing) { const maxPeople = editing.max_people ?? editing.standard_capacity; const maxGuests = editing.max_extra_guests ?? 0; const occupied = presentTotal(editing) > 0; return <><button onClick={() => setEditing(null)} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button><section className="panel p-5"><h1 className="text-3xl font-black">TABLE {editing.display_number}</h1><Counter label="Personnes" value={present} max={maxPeople} onChange={setPresent} /><Counter label="Invités" value={extras} max={maxGuests} onChange={setExtras} /><div className="mt-5 rounded-xl bg-zinc-800 p-4"><span className="text-sm text-zinc-400">TOTAL</span><b className="ml-3 text-3xl">{present + extras}</b></div><label className="mt-5 block text-sm font-semibold">Commentaire <span className="font-normal text-zinc-400">(facultatif)</span><textarea className="mt-2 w-full rounded-xl bg-zinc-800 p-4" value={comment} onChange={(event) => setComment(event.target.value)} /></label>{occupied ? <><button className="mt-5 w-full rounded-xl bg-fuchsia-600 p-5 text-lg font-black" onClick={() => void saveExistingOccupation()}>ENREGISTRER</button><button className="mt-3 w-full rounded-xl bg-zinc-800 p-4 font-bold" onClick={() => void releaseTable()}>Libérer la table</button></> : <button className="mt-5 w-full rounded-xl bg-fuchsia-600 p-5 text-lg font-black" onClick={() => void prepareArrival()}>Préparer l’arrivée</button>}{notice && <p className="mt-3 text-red-300">{notice}</p>}</section></>; }
  if (screen === 'zones') return <>{header}<section className="grid gap-4">{zones.map((item) => { const summary = stats(tables.filter((table) => table.zone_id === item.id)); return <button className="panel min-h-28 p-6 text-left" onClick={() => { setZone(item); setScreen('waiters'); }} key={item.id}><b className="block text-2xl">{item.name}</b><span className="mt-2 block text-sm text-zinc-400">{summary.available} table{summary.available !== 1 ? 's' : ''} restante{summary.available !== 1 ? 's' : ''}</span></button>; })}</section></>;
  if (screen === 'waiters') return <>{header}<section className="grid gap-4">{waiters.map((item) => { const mine = inZone.filter((table) => table.head_waiter_id === item.id); const summary = stats(mine); return <button className="panel min-h-24 p-5 text-left" onClick={() => { setWaiter(item); setScreen('tables'); }} key={item.id}><b className="block text-xl">{item.first_name} {item.last_name}</b><span className="mt-2 block text-sm text-zinc-400">{summary.available} / {mine.length} tables disponibles</span></button>; })}</section></>;
  return <>{header}{changingTable && <p className="mb-4 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-200">Choisissez une table disponible compatible avec ce brouillon.</p>}<section className="grid gap-3 sm:grid-cols-2">{waiterTables.map((table) => { const draft = drafts.find((item) => item.table_id === table.id); const draftOwn = draft?.actor_id === actorId; const style = draft ? { badge: 'bg-violet-500/15 text-violet-200 ring-violet-400/30', label: 'BROUILLON' } : tableStyles[computedStatus(table)]; const clients = draft ? draft.present_people + draft.extra_guests : presentTotal(table); const canMove = changingTable && computedStatus(table) === 'free' && !draft; return <button disabled={changingTable && !canMove} onClick={() => changingTable ? void moveDraft(table) : openTable(table)} className="group flex min-h-[104px] items-center rounded-2xl border border-violet-500/30 bg-zinc-900 p-4 text-left shadow-lg shadow-black/20 transition hover:border-violet-400/60 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40" key={table.id}><div className="min-w-0"><b className="block text-lg tracking-wide text-white">TABLE {table.display_number}</b><span className="mt-1 block text-sm text-zinc-300">{clients} client{clients !== 1 ? 's' : ''}</span><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${style.badge}`}>{style.label}</span>{!draft && activeSales[table.id] && <span className="mt-2 block text-xs text-zinc-400">Vente #{activeSales[table.id]}</span>}{draftOwn && <span className="mt-2 block text-xs text-violet-200">À confirmer</span>}</div><span className="ml-auto text-xl text-violet-300/70">›</span></button>; })}</section>{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</>;
}
