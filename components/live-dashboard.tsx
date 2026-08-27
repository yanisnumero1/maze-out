'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';
import type { LiveTable } from '@/lib/types';

const accents = ['border-emerald-500/40', 'border-orange-500/40', 'border-blue-500/40', 'border-violet-500/40'];

const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));

function status(available: number, total: number, clients: number, maxCapacity?: number | null) {
  const capacityRate = maxCapacity ? clients / maxCapacity : 0;
  if (!available || (maxCapacity && clients >= maxCapacity)) return { label: '🔴 COMPLET', color: 'text-red-300' };
  if (available / total <= 0.25 || capacityRate >= 0.7) return { label: '🟠 CHARGÉ', color: 'text-orange-300' };
  return { label: '🟢 OUVERT', color: 'text-emerald-300' };
}

export function LiveDashboard({ initialTables }: { initialTables: LiveTable[] }) {
  const [tables, setTables] = useState(initialTables);
  const [updated, setUpdated] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const zones = useMemo(
    () => [...new Map(tables.filter((table) => table.zone).map((table) => [table.zone.id, table.zone])).values()]
      .sort((left, right) => left.display_order - right.display_order),
    [tables],
  );

  useEffect(() => {
    let active = true;

    async function loadForSession(session: Session | null) {
      if (!session) {
        console.info('[LIVE] Aucune session active : chargement des données suspendu.');
        if (active) {
          setTables([]);
          setError('Session Supabase absente. Connectez-vous pour afficher les données.');
          setLoading(false);
        }
        return;
      }

      if (active) {
        setLoading(true);
        setError(null);
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (profileError || !profile) {
        console.error('[LIVE] Profil Supabase impossible à charger.', {
          error: profileError,
          userId: session.user.id,
        });
        if (active) {
          setError('Impossible de vérifier le profil utilisateur.');
          setLoading(false);
        }
        return;
      }

      console.info('[LIVE] Session et profil actifs.', { role: profile.role });

      const { data, error: tablesError } = await supabase
        .from('tables')
        .select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)')
        .eq('active', true)
        .order('number');

      if (tablesError) {
        console.error('[LIVE] Chargement des tables impossible.', tablesError);
        if (active) {
          setError('Impossible de charger les données. Consultez la console pour le détail.');
          setLoading(false);
        }
        return;
      }

      const loadedTables = normalise(data ?? []);
      console.info('[LIVE] Données chargées.', {
        tables: loadedTables.length,
        zones: new Set(loadedTables.map((table) => table.zone_id)).size,
      });

      if (active) {
        setTables(loadedTables);
        setUpdated(new Date());
        setLoading(false);
      }
    }

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        console.error('[LIVE] Impossible de restaurer la session Supabase.', sessionError);
      }
      void loadForSession(data.session);
    });

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.info('[LIVE] Changement Auth reçu.', { event, hasSession: Boolean(session) });
      // Supabase recommande de différer les requêtes lancées depuis ce callback.
      window.setTimeout(() => void loadForSession(session), 0);
    });

    const channel = supabase
      .channel('live-summary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, (payload) => {
        const row = payload.new as LiveTable['occupancy'];
        if (row?.table_id) {
          setTables((rows) => rows.map((table) => (table.id === row.table_id ? { ...table, occupancy: row } : table)));
          setUpdated(new Date());
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload) => {
        const row = payload.new as LiveTable['reservation'];
        if (row?.table_id) {
          setTables((rows) => rows.map((table) => (table.id === row.table_id ? { ...table, reservation: row } : table)));
          setUpdated(new Date());
        }
      })
      .subscribe();

    return () => {
      active = false;
      authSubscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <>
      <header className="mb-6">
        <p className="text-sm font-bold uppercase tracking-[.25em] text-fuchsia-400">
          LIVE · {updated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <h1 className="mt-1 text-3xl font-black">Vue en direct</h1>
        <p className="mt-1 text-zinc-400">État actuel des carrés</p>
      </header>
      {loading ? (
        <div className="panel p-6 text-zinc-300">Chargement…</div>
      ) : error ? (
        <div className="panel border-red-500/40 p-6 text-red-200">
          <p>Impossible de charger les données</p>
          <p className="mt-1 text-sm text-red-200/70">{error}</p>
        </div>
      ) : zones.length === 0 ? (
        <div className="panel p-6 text-zinc-300">Aucune donnée disponible</div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {zones.map((zone, index) => {
            const scoped = tables.filter((table) => table.zone_id === zone.id);
            const summary = stats(scoped);
            const state = status(summary.available, scoped.length, summary.present, zone.max_capacity);

            return (
              <article className={`panel min-h-64 border p-6 ${accents[index % 4]}`} key={zone.id}>
                <div className="flex justify-between gap-3">
                  <h2 className="text-2xl font-black">{zone.name}</h2>
                  <span className={`text-sm font-bold ${state.color}`}>{state.label}</span>
                </div>
                <div className="mt-8 grid grid-cols-2 gap-y-6">
                  <div><p className="text-3xl font-black">{scoped.length}</p><p className="text-sm text-zinc-400">tables</p></div>
                  <div><p className="text-3xl font-black">{summary.occupied}</p><p className="text-sm text-zinc-400">occupées</p></div>
                  <div><p className="text-3xl font-black">{summary.present}</p><p className="text-sm text-zinc-400">clients présents</p></div>
                  <div><p className="text-3xl font-black">{summary.available}</p><p className="text-sm text-zinc-400">tables disponibles</p></div>
                  {zone.max_capacity && <div><p className="text-3xl font-black">{zone.max_capacity}</p><p className="text-sm text-zinc-400">capacité max</p></div>}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
