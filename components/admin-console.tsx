'use client';

import { useEffect, useState } from 'react';
import type { LiveTable } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';

const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));

export function AdminConsole({ tables }: { tables: LiveTable[] }) {
  const [rows, setRows] = useState(tables);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('tables')
        .select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)')
        .eq('active', true)
        .order('number');
      if (error) {
        console.error('[ADMIN] Chargement des tables impossible.', error);
        return;
      }
      setRows(normalise(data ?? []));
    }
    void load();
  }, []);

  const zones = [...new Map(rows.map((table) => [table.zone.id, table.zone])).values()];
  const cdrs = [...new Map(rows.filter((table) => table.head_waiter).map((table) => [table.head_waiter!.id, table.head_waiter!])).values()];

  async function update(id: string, data: object) {
    const { error } = await supabase.from('tables').update(data).eq('id', id);
    if (!error) setRows((value) => value.map((table) => (table.id === id ? { ...table, ...data } : table)));
  }

  return (
    <>
      <header><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Configuration de la soirée</p><h1 className="mb-5 text-3xl font-black">ADMINISTRATION</h1></header>
      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{zones.map((zone) => { const scoped = rows.filter((table) => table.zone_id === zone.id); const zoneCdrs = new Set(scoped.map((table) => table.head_waiter_id).filter(Boolean)).size; return <article className="panel p-4" key={zone.id}><b className="block text-lg">{zone.name}</b><p className="mt-2 text-sm text-zinc-400">{scoped.length} tables · {zoneCdrs} CDR</p><p className="text-sm text-zinc-400">Capacité max {zone.max_capacity ?? '—'}</p></article>; })}</section>
      <section className="panel overflow-x-auto p-4">
        <h2 className="mb-3 text-xl font-bold">Tables</h2>
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-left text-zinc-400"><tr><th>Table</th><th>Zone</th><th>CDR</th><th>Capacité</th><th>État</th></tr></thead>
          <tbody>{rows.map((table) => <tr className="border-t border-zinc-800" key={table.id}>
            <td><input className="w-14 bg-transparent py-3 font-bold" value={table.number} onChange={(event) => void update(table.id, { number: event.target.value })} /></td>
            <td><select className="bg-zinc-800 p-2" value={table.zone_id} onChange={(event) => void update(table.id, { zone_id: event.target.value })}>{zones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></td>
            <td><select className="bg-zinc-800 p-2" value={table.head_waiter_id ?? ''} onChange={(event) => void update(table.id, { head_waiter_id: event.target.value || null })}><option value="">Aucun</option>{cdrs.map((cdr) => <option value={cdr.id} key={cdr.id}>{cdr.first_name} {cdr.last_name}</option>)}</select></td>
            <td><input className="w-14 bg-zinc-800 p-2" type="number" value={table.standard_capacity} onChange={(event) => void update(table.id, { standard_capacity: +event.target.value })} /></td>
            <td><button className="text-red-300" onClick={() => void update(table.id, { active: false })}>Désactiver</button></td>
          </tr>)}</tbody>
        </table>
      </section>
    </>
  );
}
