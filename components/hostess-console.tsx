'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HeadWaiter, LiveTable, TableStatus, Zone } from '@/lib/types';
import { computedStatus, presentTotal, stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';

type Screen = 'zones' | 'waiters' | 'tables';

const tableStyles: Record<TableStatus, { badge: string; label: string }> = {
  free: { badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30', label: 'DISPONIBLE' },
  reserved: { badge: 'bg-violet-500/15 text-violet-200 ring-violet-400/30', label: 'RÉSERVÉE' },
  occupied: { badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30', label: 'OCCUPÉE' },
  light_overload: { badge: 'bg-orange-500/15 text-orange-300 ring-orange-400/30', label: 'CHARGÉE' },
  overload: { badge: 'bg-red-500/15 text-red-300 ring-red-400/30', label: 'SURCHARGE' },
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
  const [tables, setTables] = useState(initialTables);
  const [screen, setScreen] = useState<Screen>('zones');
  const [zone, setZone] = useState<Zone | null>(null);
  const [waiter, setWaiter] = useState<HeadWaiter | null>(null);
  const [editing, setEditing] = useState<LiveTable | null>(null);
  const [present, setPresent] = useState(0);
  const [extras, setExtras] = useState(0);
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');

  const zones = useMemo(() => [...new Map(tables.map((table) => [table.zone.id, table.zone])).values()].sort((left, right) => left.display_order - right.display_order), [tables]);
  const inZone = useMemo(() => zone ? tables.filter((table) => table.zone_id === zone.id) : [], [tables, zone]);
  const waiters = useMemo(() => [...new Map(inZone.filter((table) => table.head_waiter).map((table) => [table.head_waiter!.id, table.head_waiter!])).values()], [inZone]);
  const waiterTables = useMemo(() => waiter ? inZone.filter((table) => table.head_waiter_id === waiter.id) : [], [inZone, waiter]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('display_number');
      if (data) setTables(normalise(data));
    }
    void load();
    const channel = supabase.channel('hostess-live').on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, (payload) => {
      const row = payload.new as any;
      if (row?.table_id) setTables((rows) => rows.map((table) => table.id === row.table_id ? { ...table, occupancy: row } : table));
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload) => {
      const row = payload.new as any;
      if (row?.table_id) setTables((rows) => rows.map((table) => table.id === row.table_id ? { ...table, reservation: row } : table));
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  function openTable(table: LiveTable) {
    const maxPeople = table.max_people ?? table.standard_capacity;
    const maxGuests = table.max_extra_guests ?? 0;
    setEditing(table);
    setPresent(clamp(table.occupancy?.present_people ?? 0, maxPeople));
    setExtras(clamp(table.occupancy?.extra_guests ?? 0, maxGuests));
    setComment(table.occupancy?.comment ?? '');
    setNotice('');
  }

  async function save() {
    if (!editing) return;
    const maxPeople = editing.max_people ?? editing.standard_capacity;
    const maxGuests = editing.max_extra_guests ?? 0;
    const safePresent = clamp(present, maxPeople);
    const safeExtras = clamp(extras, maxGuests);
    const payload = { table_id: editing.id, present_people: safePresent, extra_guests: safeExtras, comment: comment || null, arrived_at: safePresent + safeExtras ? new Date().toISOString() : null };
    const { error } = await supabase.from('occupancies').upsert(payload);
    if (error) return setNotice(error.message);
    setTables((rows) => rows.map((table) => table.id === editing.id ? { ...table, occupancy: { ...payload, updated_at: new Date().toISOString() } as any } : table));
    setEditing(null);
  }

  function back() {
    setEditing(null);
    if (screen === 'tables') { setWaiter(null); setScreen('waiters'); }
    else if (screen === 'waiters') { setZone(null); setScreen('zones'); }
  }

  const header = <header className="mb-5">{screen !== 'zones' && <button onClick={back} className="mb-3 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button>}<p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Arrivées</p><h1 className="text-3xl font-black">{screen === 'zones' ? 'HÔTESSE' : screen === 'waiters' ? zone?.name : `${waiter?.first_name} ${waiter?.last_name} — ${zone?.name}`}</h1></header>;

  if (editing) {
    const maxPeople = editing.max_people ?? editing.standard_capacity;
    const maxGuests = editing.max_extra_guests ?? 0;
    return <><button onClick={() => setEditing(null)} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button><section className="panel p-5"><h1 className="text-3xl font-black">TABLE {editing.display_number}</h1><Counter label="Personnes" value={present} max={maxPeople} onChange={setPresent} /><Counter label="Invités" value={extras} max={maxGuests} onChange={setExtras} /><div className="mt-5 rounded-xl bg-zinc-800 p-4"><span className="text-sm text-zinc-400">TOTAL</span><b className="ml-3 text-3xl">{present + extras}</b></div><label className="mt-5 block text-sm font-semibold">Commentaire <span className="font-normal text-zinc-400">(facultatif)</span><textarea className="mt-2 w-full rounded-xl bg-zinc-800 p-4" value={comment} onChange={(event) => setComment(event.target.value)} /></label><button className="mt-5 w-full rounded-xl bg-fuchsia-600 p-5 text-lg font-black" onClick={() => void save()}>ENREGISTRER</button>{notice && <p className="mt-3 text-red-300">{notice}</p>}</section></>;
  }

  if (screen === 'zones') return <>{header}<section className="grid gap-4">{zones.map((item) => { const summary = stats(tables.filter((table) => table.zone_id === item.id)); return <button className="panel min-h-28 p-6 text-left" onClick={() => { setZone(item); setScreen('waiters'); }} key={item.id}><b className="block text-2xl">{item.name}</b><span className="mt-2 block text-sm text-zinc-400">{summary.available} table{summary.available !== 1 ? 's' : ''} restante{summary.available !== 1 ? 's' : ''}</span></button>; })}</section></>;
  if (screen === 'waiters') return <>{header}<section className="grid gap-4">{waiters.map((item) => { const mine = inZone.filter((table) => table.head_waiter_id === item.id); const summary = stats(mine); return <button className="panel min-h-24 p-5 text-left" onClick={() => { setWaiter(item); setScreen('tables'); }} key={item.id}><b className="block text-xl">{item.first_name} {item.last_name}</b><span className="mt-2 block text-sm text-zinc-400">{summary.available} / {mine.length} tables disponibles</span></button>; })}</section></>;
  return <>{header}<section className="grid gap-3 sm:grid-cols-2">{waiterTables.map((table) => { const style = tableStyles[computedStatus(table)]; return <button onClick={() => openTable(table)} className="group flex min-h-[104px] items-center rounded-2xl border border-violet-500/30 bg-zinc-900 p-4 text-left shadow-lg shadow-black/20 transition hover:border-violet-400/60 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-400" key={table.id}><div className="min-w-0"><b className="block text-lg tracking-wide text-white">TABLE {table.display_number}</b><span className="mt-1 block text-sm text-zinc-300">{presentTotal(table)} client{presentTotal(table) !== 1 ? 's' : ''}</span><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${style.badge}`}>{style.label}</span></div><span className="ml-auto text-xl text-violet-300/70 transition group-hover:translate-x-0.5">›</span></button>; })}</section></>;
}
