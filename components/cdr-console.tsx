'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { computedStatus, presentTotal, stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';
import type { LiveTable, TableStatus } from '@/lib/types';

const statusLabel: Record<TableStatus, string> = {
  free: 'Libre', reserved: 'Réservée', occupied: 'Occupée', light_overload: 'Chargée', overload: 'Surcharge', unavailable: 'Indisponible',
};
const statusClass: Record<TableStatus, string> = {
  free: 'bg-emerald-500/15 text-emerald-300', reserved: 'bg-sky-500/15 text-sky-300', occupied: 'bg-emerald-500/15 text-emerald-300', light_overload: 'bg-orange-500/15 text-orange-300', overload: 'bg-red-500/15 text-red-300', unavailable: 'bg-zinc-700 text-zinc-300',
};

function normalise(rows: unknown[]): LiveTable[] {
  return rows.map((row: any) => ({ ...row, occupancy: Array.isArray(row.occupancy) ? row.occupancy[0] ?? null : row.occupancy ?? null, reservation: null })) as LiveTable[];
}

export function CdrConsole() {
  const router = useRouter();
  const [tables, setTables] = useState<LiveTable[]>([]);
  const [name, setName] = useState('Chef de rang');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) { setError('Session indisponible.'); setLoading(false); return; }
    const { data: profile, error: profileError } = await supabase.from('profiles').select('first_name,last_name,head_waiter_id,role').eq('id', userData.user.id).single();
    if (profileError || profile?.role !== 'cdr' || !profile.head_waiter_id) {
      console.error('[CDR] Profil CDR invalide ou non associé.', profileError);
      setError('Ce compte CDR doit être associé à un chef de rang.'); setLoading(false); return;
    }
    setName(`${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Chef de rang');
    const { data, error: tablesError } = await supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), occupancy:occupancies(*)').eq('active', true).order('display_number');
    if (tablesError) { console.error('[CDR] Impossible de charger les tables autorisées.', tablesError); setError('Impossible de charger vos tables.'); }
    else { setTables(normalise(data ?? [])); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('cdr-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

  const orderedTables = useMemo(() => [...tables].sort((a, b) => (a.display_number ?? Number(a.number)) - (b.display_number ?? Number(b.number))), [tables]);
  const summary = stats(orderedTables);
  async function signOut() { const { error: signOutError } = await supabase.auth.signOut(); if (signOutError) console.error('[CDR] Déconnexion impossible.', signOutError); router.replace('/login'); }

  return <main className="mx-auto min-h-dvh max-w-2xl px-4 py-4 sm:px-6">
    <header className="mb-6 flex items-center gap-3 border-b border-zinc-800 pb-4">
      <Image src="/bridge-logo.png" alt="BRIDGE — Pont Alexandre III" width={128} height={46} className="h-8 w-24 object-contain" />
      <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.2em] text-fuchsia-400">Live · lecture seule</p><h1 className="truncate text-xl font-black">{name}</h1></div>
      <button className="min-h-11 shrink-0 rounded-full bg-zinc-800 px-3 py-2 text-sm font-semibold" onClick={() => void signOut()}>Déconnexion</button>
    </header>
    {loading ? <p className="panel p-5 text-center text-sm text-zinc-400">Chargement de vos tables...</p> : error ? <p className="panel p-5 text-center text-sm text-red-300">{error}</p> : <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Indicateurs de mon rang">
        {[['Tables', orderedTables.length], ['Occupées', summary.occupied], ['Libres', summary.available], ['Personnes', summary.present]].map(([label, value]) => <article className="panel p-3" key={String(label)}><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></article>)}
      </section>
      <section className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Mes tables">
        {orderedTables.map((table) => { const status = computedStatus(table); const total = presentTotal(table); return <article className="panel min-h-28 p-4" key={table.id}>
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Table {table.display_number ?? table.number}</h2><p className="mt-1 text-sm text-zinc-400">{table.zone?.name ?? 'Carré non attribué'}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass[status]}`}>{statusLabel[status]}</span></div>
          <p className="mt-4 text-sm text-zinc-300"><b className="text-lg text-white">{total}</b> personne{total !== 1 ? 's' : ''}</p>
        </article>; })}
      </section>
      {orderedTables.length === 0 && <p className="panel mt-6 p-5 text-center text-sm text-zinc-400">Aucune table active ne vous est actuellement attribuée.</p>}
    </>}
  </main>;
}
