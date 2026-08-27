'use client';
import { useEffect, useMemo, useState } from 'react';
import type { HeadWaiter, LiveTable, Zone } from '@/lib/types';
import { computedStatus, presentTotal, stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';

type Screen = 'zones' | 'waiters' | 'tables';
const tableColors = { free:'bg-zinc-100 text-zinc-950', reserved:'bg-zinc-100 text-zinc-950', occupied:'bg-emerald-600', light_overload:'bg-orange-500', overload:'bg-red-600', unavailable:'bg-zinc-800' };
const normalise = (rows: any[]): LiveTable[] => rows.map(t => ({ ...t, reservation:Array.isArray(t.reservation)?t.reservation[0]??null:t.reservation, occupancy:Array.isArray(t.occupancy)?t.occupancy[0]??null:t.occupancy }));

export function HostessConsole({ tables: initialTables }: { tables: LiveTable[] }) {
  const [tables, setTables] = useState(initialTables);
  const [screen, setScreen] = useState<Screen>('zones');
  const [zone, setZone] = useState<Zone | null>(null);
  const [waiter, setWaiter] = useState<HeadWaiter | null>(null);
  const [editing, setEditing] = useState<LiveTable | null>(null);
  const [present, setPresent] = useState(0); const [extras, setExtras] = useState(0); const [comment, setComment] = useState(''); const [notice, setNotice] = useState('');
  const zones = useMemo(() => [...new Map(tables.map(t => [t.zone.id, t.zone])).values()].sort((a,b) => a.display_order-b.display_order), [tables]);
  const inZone = useMemo(() => zone ? tables.filter(t => t.zone_id === zone.id) : [], [tables, zone]);
  const waiters = useMemo(() => [...new Map(inZone.filter(t => t.head_waiter).map(t => [t.head_waiter!.id, t.head_waiter!])).values()], [inZone]);
  const waiterTables = useMemo(() => waiter ? inZone.filter(t => t.head_waiter_id === waiter.id) : [], [inZone, waiter]);

  useEffect(() => {
    async function load() { const { data } = await supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('number'); if (data) setTables(normalise(data)); }
    load();
    const channel = supabase.channel('hostess-live').on('postgres_changes',{event:'*',schema:'public',table:'occupancies'}, p => { const row=p.new as any; if(row?.table_id) setTables(rows => rows.map(t => t.id===row.table_id ? {...t,occupancy:row}:t)); }).on('postgres_changes',{event:'*',schema:'public',table:'reservations'}, p => { const row=p.new as any; if(row?.table_id) setTables(rows => rows.map(t => t.id===row.table_id ? {...t,reservation:row}:t)); }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  function openTable(table: LiveTable) { setEditing(table); setPresent(table.occupancy?.present_people ?? 0); setExtras(table.occupancy?.extra_guests ?? 0); setComment(table.occupancy?.comment ?? ''); setNotice(''); }
  async function save() { if (!editing) return; const payload={table_id:editing.id,present_people:present,extra_guests:extras,comment:comment||null,arrived_at:present+extras?new Date().toISOString():null}; const {error}=await supabase.from('occupancies').upsert(payload); if(error) return setNotice(error.message); setTables(rows=>rows.map(t=>t.id===editing.id?{...t,occupancy:{...payload,updated_at:new Date().toISOString()} as any}:t)); setEditing(null); }
  function back() { setEditing(null); if(screen==='tables'){setWaiter(null);setScreen('waiters');} else if(screen==='waiters'){setZone(null);setScreen('zones');} }
  const header = <header className="mb-5">{screen!=='zones' && <button onClick={back} className="mb-3 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button>}<p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Arrivées</p><h1 className="text-3xl font-black">{screen==='zones'?'HÔTESSE':screen==='waiters'?zone?.name:`${waiter?.first_name} ${waiter?.last_name} — ${zone?.name}`}</h1></header>;
  if(editing) return <><button onClick={()=>setEditing(null)} className="mb-4 rounded-lg bg-zinc-800 px-4 py-3 text-sm font-bold">← RETOUR</button><section className="panel p-5"><h1 className="text-3xl font-black">TABLE</h1>{[['Présents',present,setPresent],['Invités',extras,setExtras]].map(([label,value,setter]:any)=><div className="mt-5 flex items-center justify-between rounded-xl bg-zinc-800 p-3" key={label}><span className="font-semibold">{label}</span><div className="flex items-center gap-4"><button className="h-12 w-12 rounded-lg bg-zinc-700 text-2xl" onClick={()=>setter((n:number)=>Math.max(0,n-1))}>−</button><b className="w-8 text-center text-2xl">{value}</b><button className="h-12 w-12 rounded-lg bg-fuchsia-600 text-2xl" onClick={()=>setter((n:number)=>n+1)}>+</button></div></div>)}<div className="mt-5 rounded-xl bg-zinc-800 p-4"><span className="text-sm text-zinc-400">TOTAL</span><b className="ml-3 text-3xl">{present+extras}</b></div><label className="mt-5 block text-sm font-semibold">Commentaire <span className="font-normal text-zinc-400">(facultatif)</span><textarea className="mt-2 w-full rounded-xl bg-zinc-800 p-4" value={comment} onChange={e=>setComment(e.target.value)}/></label><button className="mt-5 w-full rounded-xl bg-fuchsia-600 p-5 text-lg font-black" onClick={save}>ENREGISTRER</button>{notice&&<p className="mt-3 text-red-300">{notice}</p>}</section></>;
  if(screen==='zones') return <>{header}<section className="grid gap-4">{zones.map(z=>{const s=stats(tables.filter(t=>t.zone_id===z.id));return <button className="panel min-h-28 p-6 text-left" onClick={()=>{setZone(z);setScreen('waiters');}} key={z.id}><b className="block text-2xl">{z.name}</b><span className="mt-2 block text-sm text-zinc-400">{s.available} table{s.available!==1?'s':''} restante{s.available!==1?'s':''}</span></button>})}</section></>;
  if(screen==='waiters') return <>{header}<section className="grid gap-4">{waiters.map(w=>{const mine=inZone.filter(t=>t.head_waiter_id===w.id);const s=stats(mine);return <button className="panel min-h-24 p-5 text-left" onClick={()=>{setWaiter(w);setScreen('tables');}} key={w.id}><b className="block text-xl">{w.first_name} {w.last_name}</b><span className="mt-2 block text-sm text-zinc-400">{s.available} / {mine.length} tables disponibles</span></button>})}</section></>;
  return <>{header}<section className="grid gap-3">{waiterTables.map(t=><button onClick={()=>openTable(t)} className={`${tableColors[computedStatus(t)]} min-h-24 rounded-2xl p-5 text-left shadow`} key={t.id}><b className="block text-xl">TABLE</b><span className="mt-2 block text-sm">{presentTotal(t)} client{presentTotal(t)!==1?'s':''}</span></button>)}</section></>;
}
