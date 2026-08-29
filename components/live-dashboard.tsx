'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { computedStatus, presentTotal, stats, zoneAvailabilityStatus } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';
import type { ArrivalDraft, LiveTable } from '@/lib/types';

const accents = ['border-emerald-500/40', 'border-orange-500/40', 'border-blue-500/40', 'border-violet-500/40'];

const normalise = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));

function status(available: number, clients: number, maxCapacity?: number | null) {
  const value = zoneAvailabilityStatus(clients, maxCapacity, available);
  if (value === 'complete') return { label: '🔴 COMPLET', color: 'text-red-300' };
  if (value === 'charged') return { label: '🟠 CHARGÉ', color: 'text-orange-300' };
  return { label: '🟢 OUVERT', color: 'text-emerald-300' };
}

export function LiveDashboard({ initialTables }: { initialTables: LiveTable[] }) {
  const router = useRouter();
  const [tables, setTables] = useState(initialTables);
  const [updated, setUpdated] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ArrivalDraft[]>([]);
  const [tableQuery, setTableQuery] = useState('');

  const zones = useMemo(
    () => [...new Map(tables.filter((table) => table.zone).map((table) => [table.zone.id, table.zone])).values()]
      .sort((left, right) => left.display_order - right.display_order),
    [tables],
  );
  const tableResults = useMemo(() => {
    const query = tableQuery.trim().toLocaleLowerCase('fr-FR');
    if (!query) return [];
    const numericQuery = query.replace(/^table\s*/, '');
    return tables
      .filter((table) => {
        const displayNumber = String(table.display_number ?? '');
        const waiter = table.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}`.toLocaleLowerCase('fr-FR') : '';
        return displayNumber.includes(numericQuery) || `table ${displayNumber}`.includes(query) || waiter.includes(query);
      })
      .sort((left, right) => {
        const leftExact = String(left.display_number) === numericQuery ? 0 : 1;
        const rightExact = String(right.display_number) === numericQuery ? 0 : 1;
        return leftExact - rightExact || (left.display_number ?? 0) - (right.display_number ?? 0);
      });
  }, [tableQuery, tables]);

  useEffect(() => {
    let active = true;

    async function loadDrafts() {
      const { data: nightId, error: nightError } = await supabase.rpc('current_operational_night_session');
      if (nightError) {
        console.error('[LIVE] Chargement de la soirée opérationnelle impossible.', nightError);
        return;
      }
      if (!nightId) {
        if (active) setDrafts([]);
        return;
      }

      const { data, error: draftsError } = await supabase
        .from('arrival_drafts')
        .select('*')
        .eq('status', 'draft')
        .eq('night_session_id', nightId)
        .order('created_at', { ascending: true });
      if (draftsError) {
        console.error('[LIVE] Chargement des brouillons impossible.', draftsError);
        return;
      }
      if (active) setDrafts((data ?? []) as ArrivalDraft[]);
    }

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
        .order('display_number');

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
      void loadDrafts();
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arrival_drafts' }, () => {
        void loadDrafts();
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
        <>
          <section className="panel mb-5 border border-violet-500/30 bg-zinc-900/70 p-4" aria-label="Recherche de table">
            <label className="block text-sm font-bold text-zinc-200" htmlFor="table-search">Rechercher une table</label>
            <input id="table-search" type="search" inputMode="search" autoComplete="off" value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="Rechercher une table..." className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-white outline-none placeholder:text-zinc-500 focus:border-violet-400" />
            {tableQuery.trim() && <div className="mt-3 grid gap-2">
              {tableResults.length === 0 ? <p className="rounded-xl bg-zinc-950/70 px-4 py-3 text-sm text-zinc-400">Aucune table trouvée.</p> : tableResults.map((table) => {
                const draft = drafts.find((item) => item.table_id === table.id);
                const statusLabel = draft ? 'ARRIVÉE EN ATTENTE' : computedStatus(table) === 'free' ? 'LIBRE' : 'OCCUPÉE';
                const statusClass = draft ? 'text-orange-300' : computedStatus(table) === 'free' ? 'text-emerald-300' : 'text-fuchsia-200';
                const waiter = table.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}` : 'CDR non attribué';
                const people = draft ? draft.present_people + draft.extra_guests : presentTotal(table);
                return <button type="button" key={table.id} onClick={() => router.push(`/hostess?table=${encodeURIComponent(String(table.display_number))}`)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-950/70 p-3 text-left transition hover:border-violet-400 hover:bg-zinc-900"><div className="min-w-0"><b className="block">TABLE {table.display_number}</b><span className="mt-1 block truncate text-sm text-zinc-400">{table.zone?.name} · {waiter}</span>{people > 0 && <span className="mt-1 block text-xs text-zinc-300">{people} personne{people !== 1 ? 's' : ''}</span>}</div><span className={`ml-auto shrink-0 text-xs font-bold ${statusClass}`}>{statusLabel}</span></button>;
              })}
            </div>}
          </section>
          {drafts.length > 0 && (
            <section className="panel mb-6 border border-orange-500/30 bg-zinc-900/80 p-4" aria-label="Arrivées en attente">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-black uppercase tracking-[.18em] text-orange-200">Arrivées en attente · {drafts.length}</h2>
                <span className="h-2 w-2 rounded-full bg-orange-400" aria-hidden="true" />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {drafts.map((draft) => {
                  const table = tables.find((item) => item.id === draft.table_id);
                  const waiter = table?.head_waiter ? `${table.head_waiter.first_name} ${table.head_waiter.last_name}` : 'CDR non attribué';
                  const createdAt = new Date(draft.created_at);
                  return <article key={draft.id} className="rounded-xl border border-zinc-700 bg-zinc-950/70 p-4">
                    <div className="flex items-start justify-between gap-3"><div><h3 className="font-black">TABLE {table?.display_number ?? '—'}</h3><p className="mt-1 text-sm text-zinc-400">{table?.zone?.name ?? 'Carré non attribué'} · {waiter}</p></div><button type="button" onClick={() => router.push(`/hostess?draft=${encodeURIComponent(draft.id)}`)} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-500">Voir</button></div>
                    <p className="mt-3 text-sm text-zinc-200">{draft.present_people} personne{draft.present_people !== 1 ? 's' : ''}{draft.extra_guests > 0 ? ` + ${draft.extra_guests} invité${draft.extra_guests !== 1 ? 's' : ''}` : ''}</p>
                    <p className="mt-2 text-xs text-orange-200/80">En attente depuis {createdAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                  </article>;
                })}
              </div>
            </section>
          )}
          <section className="grid gap-4 md:grid-cols-2">
            {zones.map((zone, index) => {
            const scoped = tables.filter((table) => table.zone_id === zone.id);
            const summary = stats(scoped);
            const state = status(summary.available, summary.present, zone.max_capacity);

            return (
              <button
                type="button"
                aria-label={`Ouvrir la vue salle ${zone.name}`}
                className={`panel min-h-64 w-full border p-6 text-left transition hover:bg-zinc-900/80 ${accents[index % 4]}`}
                key={zone.id}
                onClick={() => router.push(`/hostess?zone=${encodeURIComponent(zone.id)}`)}
              >
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
              </button>
            );
            })}
          </section>
        </>
      )}
    </>
  );
}
