'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GlobalSearch } from '@/components/global-search';
import { supabase } from '@/lib/supabase/client';
import { getTableDisplayNumber } from '@/lib/tables';
import type { ArrivalDraft, BusinessReferrer, LiveTable, Promoter, TableVisit } from '@/lib/types';

const normaliseTables = (rows: any[]): LiveTable[] => rows.map((table) => ({
  ...table,
  display_number: getTableDisplayNumber(table),
  reservation: Array.isArray(table.reservation) ? table.reservation[0] ?? null : table.reservation,
  occupancy: Array.isArray(table.occupancy) ? table.occupancy[0] ?? null : table.occupancy,
}));

export function HostessGlobalSearch() {
  const router = useRouter();
  const [tables, setTables] = useState<LiveTable[]>([]);
  const [drafts, setDrafts] = useState<ArrivalDraft[]>([]);
  const [visits, setVisits] = useState<TableVisit[]>([]);
  const [businessReferrers, setBusinessReferrers] = useState<BusinessReferrer[]>([]);
  const [promoters, setPromoters] = useState<Promoter[]>([]);

  const refresh = useCallback(async () => {
    const [{ data: tableRows, error: tablesError }, { data: nightId, error: nightError }, { data: referrerRows, error: referrersError }] = await Promise.all([
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), reservation:reservations(*), occupancy:occupancies(*)').eq('active', true).order('display_number'),
      supabase.rpc('current_operational_night_session'),
      supabase.from('business_referrers').select('*').eq('active', true).order('name'),
    ]);
    if (tablesError || nightError || referrersError) console.error('[HOSTESS SEARCH] Impossible de charger la recherche globale.', { tablesError, nightError, referrersError });
    setTables(normaliseTables(tableRows ?? []));
    setBusinessReferrers((referrerRows ?? []) as BusinessReferrer[]);
    if (!nightId) { setDrafts([]); setVisits([]); setPromoters([]); return; }

    const [{ data: draftRows, error: draftsError }, { data: visitRows, error: visitsError }, { data: promoterRows, error: promotersError }] = await Promise.all([
      supabase.from('arrival_drafts').select('*').eq('night_session_id', nightId).eq('status', 'draft'),
      supabase.from('table_visits').select('*').eq('night_session_id', nightId).order('arrived_at'),
      supabase.from('promoters').select('*').eq('night_session_id', nightId).order('name'),
    ]);
    if (draftsError || visitsError || promotersError) console.error('[HOSTESS SEARCH] Données de la soirée impossibles à charger.', { draftsError, visitsError, promotersError });
    setDrafts((draftRows ?? []) as ArrivalDraft[]);
    setVisits((visitRows ?? []) as TableVisit[]);
    setPromoters((promoterRows ?? []) as Promoter[]);
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('hostess-global-search')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'arrival_drafts' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_referrers' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoters' }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

  return <GlobalSearch
    tables={tables}
    drafts={drafts}
    visits={visits}
    businessReferrers={businessReferrers}
    promoters={promoters}
    onSelectTable={(table) => router.push(`/hostess?table=${encodeURIComponent(getTableDisplayNumber(table))}&from=global-search`)}
    onSelectPromoter={(promoter) => router.push(`/hostess?view=promoteurs&promoter=${encodeURIComponent(promoter.id)}`)}
    onSelectCdr={(table) => router.push(`/hostess?zone=${encodeURIComponent(table.zone_id)}&cdr=${encodeURIComponent(table.head_waiter_id ?? '')}`)}
  />;
}
