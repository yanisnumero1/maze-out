'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LiveTable } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';

const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));

export function AdminConsole({ tables }: { tables: LiveTable[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(tables);
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [resetWord, setResetWord] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetNotice, setResetNotice] = useState('');

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('tables')
        .select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)')
        .eq('active', true)
        .order('display_number');
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

  async function resetOperationalData() {
    if (resetting || resetWord !== 'RESET') return;
    setResetting(true);
    setResetNotice('');
    const { error } = await supabase.rpc('reset_test_operational_data');
    if (error) {
      console.error('[ADMIN] Réinitialisation opérationnelle impossible.', error);
      setResetNotice(`Réinitialisation impossible : ${error.message}`);
      setResetting(false);
      return;
    }
    setResetNotice('Les données opérationnelles ont été réinitialisées.');
    setResetting(false);
    window.setTimeout(() => router.replace('/' as any), 900);
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
            <td><b className="block py-3">Table {table.display_number}</b></td>
            <td><select className="bg-zinc-800 p-2" value={table.zone_id} onChange={(event) => void update(table.id, { zone_id: event.target.value })}>{zones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></td>
            <td><select className="bg-zinc-800 p-2" value={table.head_waiter_id ?? ''} onChange={(event) => void update(table.id, { head_waiter_id: event.target.value || null })}><option value="">Aucun</option>{cdrs.map((cdr) => <option value={cdr.id} key={cdr.id}>{cdr.first_name} {cdr.last_name}</option>)}</select></td>
            <td><input className="w-14 bg-zinc-800 p-2" type="number" value={table.standard_capacity} onChange={(event) => void update(table.id, { standard_capacity: +event.target.value })} /></td>
            <td><button className="text-red-300" onClick={() => void update(table.id, { active: false })}>Désactiver</button></td>
          </tr>)}</tbody>
        </table>
      </section>
      <section className="mt-8 border border-red-500/30 bg-red-500/5 p-5">
        <p className="text-sm font-bold uppercase tracking-[.2em] text-red-300">Zone de test</p>
        <h2 className="mt-1 text-xl font-black">Réinitialiser les données de test</h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-300">Supprime les soirées, ventes, occupations, relevés et données opérationnelles. La configuration des tables et les comptes utilisateurs sont conservés.</p>
        {resetStep === 0 && <button onClick={() => setResetStep(1)} className="mt-5 rounded-xl bg-red-600 px-5 py-3 font-bold">Réinitialiser les données de test</button>}
        {resetStep === 1 && <div className="mt-5 rounded-xl bg-zinc-900 p-4"><p className="font-semibold">Cette action supprimera toutes les données opérationnelles et tout l’historique des soirées.</p><div className="mt-4 flex gap-3"><button onClick={() => setResetStep(0)} className="rounded-xl bg-zinc-800 px-4 py-3 font-bold">Annuler</button><button onClick={() => setResetStep(2)} className="rounded-xl bg-red-600 px-4 py-3 font-bold">Continuer</button></div></div>}
        {resetStep === 2 && <div className="mt-5 rounded-xl bg-zinc-900 p-4"><p className="text-sm text-zinc-300">Les 72 tables, les CDR et les comptes utilisateurs seront conservés. Les soirées et leur historique seront définitivement supprimés.</p><label className="mt-4 block text-sm font-bold">Saisissez exactement RESET<input aria-label="Confirmation RESET" value={resetWord} onChange={(event) => setResetWord(event.target.value)} className="mt-2 block w-full rounded-xl bg-zinc-800 p-3 font-mono outline-none ring-1 ring-zinc-700 focus:ring-red-400" /></label><div className="mt-4 flex gap-3"><button disabled={resetting} onClick={() => { setResetStep(0); setResetWord(''); }} className="rounded-xl bg-zinc-800 px-4 py-3 font-bold disabled:opacity-50">Annuler</button><button disabled={resetting || resetWord !== 'RESET'} onClick={() => void resetOperationalData()} className="rounded-xl bg-red-600 px-4 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-40">{resetting ? 'Réinitialisation en cours...' : 'Réinitialiser définitivement'}</button></div></div>}
        {resetNotice && <p className={`mt-4 text-sm font-semibold ${resetNotice.startsWith('Réinitialisation impossible') ? 'text-red-300' : 'text-emerald-300'}`}>{resetNotice}</p>}
      </section>
    </>
  );
}
