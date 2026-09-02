'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cdrLiveTableRows } from '@/lib/cdr-live';
import { presentTotal, stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';
import { getTableDisplayNumber } from '@/lib/tables';
import type { BusinessReferrer, CdrRankRecapSale, LiveTable, OperationalAuditLog, TableVisit } from '@/lib/types';

type NoteDraft = { comment: string; referrer: string };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ValidationState = 'idle' | 'saving' | 'saved' | 'error';

function normalise(rows: unknown[]): LiveTable[] {
  return rows.map((row: any) => ({ ...row, occupancy: Array.isArray(row.occupancy) ? row.occupancy[0] ?? null : row.occupancy ?? null, reservation: null })) as LiveTable[];
}

function auditText(data: Record<string, unknown> | null, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function clock(value: string): string { return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function nightLabel(value: string): string { return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

export function CdrConsole() {
  const router = useRouter();
  const [tables, setTables] = useState<LiveTable[]>([]);
  const [visits, setVisits] = useState<TableVisit[]>([]);
  const [headWaiterId, setHeadWaiterId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, NoteDraft>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [businessReferrers, setBusinessReferrers] = useState<BusinessReferrer[]>([]);
  const [validatedReferrers, setValidatedReferrers] = useState<Record<string, string>>({});
  const [validationStates, setValidationStates] = useState<Record<string, ValidationState>>({});
  const [validationMessages, setValidationMessages] = useState<Record<string, string>>({});
  const [journal, setJournal] = useState<OperationalAuditLog[]>([]);
  const [rankRecap, setRankRecap] = useState<CdrRankRecapSale[]>([]);
  const [selectedRecapNightId, setSelectedRecapNightId] = useState<string | null>(null);
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
    const [tableResult, visitResult, referrerResult] = await Promise.all([
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), occupancy:occupancies(*)').eq('active', true).order('display_number'),
      supabase.from('table_visits').select('*').is('ended_at', null),
      supabase.from('business_referrers').select('*').eq('active', true).order('name'),
    ]);
    if (tableResult.error) { console.error('[CDR] Impossible de charger les tables autorisées.', tableResult.error); setError('Impossible de charger vos tables.'); setLoading(false); return; }

    const loadedTables = normalise(tableResult.data ?? []);
    const loadedReferrers = (referrerResult.data ?? []) as BusinessReferrer[];
    if (referrerResult.error) console.error('[CDR] Impossible de charger les apporteurs actifs.', referrerResult.error);
    setName(loadedTables[0]?.head_waiter ? `${loadedTables[0].head_waiter.first_name} ${loadedTables[0].head_waiter.last_name}`.trim() : `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Chef de rang');
    setHeadWaiterId(profile.head_waiter_id); setTables(loadedTables); setBusinessReferrers(loadedReferrers);

    const { data: recapRows, error: recapError } = await supabase.rpc('get_cdr_rank_recap', { p_night_session_id: null });
    if (recapError) {
      console.error('[CDR] Impossible de charger le récapitulatif du rang.', recapError);
      setRankRecap([]);
    } else {
      setRankRecap((recapRows ?? []) as CdrRankRecapSale[]);
    }

    if (visitResult.error) {
      console.error('[CDR] Impossible de charger les visites actives.', visitResult.error);
      setVisits([]); setJournal([]);
    } else {
      const loadedVisits = (visitResult.data ?? []) as TableVisit[];
      setVisits(loadedVisits);
      setNotes((current) => Object.fromEntries(loadedVisits.map((visit) => [visit.id, current[visit.id] ?? { comment: visit.cdr_comment ?? '', referrer: visit.business_referrer ?? '' }])));
      setValidatedReferrers((current) => Object.fromEntries(loadedVisits.map((visit) => [visit.id, current[visit.id] ?? loadedReferrers.find((referrer) => referrer.id === visit.business_referrer_id)?.name ?? visit.proposed_business_referrer_name ?? ''])));
      // La policy RLS CDR limite déjà ces événements à leur auteur. Ne pas dépendre
      // d'une visite encore ouverte : le journal doit rester lisible après la
      // libération ou le transfert de la table.
      const { data: auditRows, error: auditError } = await supabase
        .from('operational_audit_log')
        .select('*')
        .in('action_type', ['cdr.business_referrer.validated', 'cdr.business_referrer.corrected'])
        .order('created_at', { ascending: false });
      if (auditError) console.error('[CDR] Impossible de charger votre journal.', auditError);
      setJournal((auditRows ?? []) as OperationalAuditLog[]);
    }
    setError(null); setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('cdr-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

  const tableRows = useMemo(() => headWaiterId ? cdrLiveTableRows(tables, visits, headWaiterId) : [], [headWaiterId, tables, visits]);
  const summary = stats(tableRows.map(({ table }) => table));
  const visitsById = useMemo(() => new Map(visits.map((visit) => [visit.id, visit])), [visits]);
  const tableLabels = useMemo(() => new Map(tables.map((table) => [table.id, getTableDisplayNumber(table)])), [tables]);
  const recapNights = useMemo(() => Array.from(new Map(rankRecap.map((sale) => [sale.night_session_id, { id: sale.night_session_id, startedAt: sale.night_started_at, endedAt: sale.night_ended_at, status: sale.night_status }])).values()), [rankRecap]);
  const recapNightId = selectedRecapNightId && recapNights.some((night) => night.id === selectedRecapNightId)
    ? selectedRecapNightId
    : recapNights.find((night) => night.status === 'active')?.id ?? recapNights[0]?.id ?? null;
  const selectedRecapSales = useMemo(() => rankRecap.filter((sale) => sale.night_session_id === recapNightId), [rankRecap, recapNightId]);

  function updateNote(visitId: string, key: keyof NoteDraft, value: string) {
    setNotes((current) => ({ ...current, [visitId]: { comment: current[visitId]?.comment ?? '', referrer: current[visitId]?.referrer ?? '', [key]: value } }));
    setSaveStates((current) => ({ ...current, [visitId]: 'idle' }));
  }

  async function saveNotes(visit: TableVisit) {
    const draft = notes[visit.id] ?? { comment: visit.cdr_comment ?? '', referrer: visit.business_referrer ?? '' };
    setSaveStates((current) => ({ ...current, [visit.id]: 'saving' }));
    const { data, error: saveError } = await supabase.rpc('update_cdr_visit_notes', { p_visit_id: visit.id, p_cdr_comment: draft.comment || null, p_business_referrer: draft.referrer || null });
    if (saveError) { console.error('[CDR] Enregistrement des notes impossible.', saveError); setSaveStates((current) => ({ ...current, [visit.id]: 'error' })); return; }
    setVisits((current) => current.map((item) => item.id === visit.id ? { ...item, ...(data as Partial<TableVisit>) } : item));
    setSaveStates((current) => ({ ...current, [visit.id]: 'saved' }));
    await refresh();
  }

  async function validateBusinessReferrer(visit: TableVisit) {
    const referrerName = validatedReferrers[visit.id]?.trim() ?? '';
    if (!referrerName) { setValidationMessages((current) => ({ ...current, [visit.id]: 'Saisissez ou sélectionnez un apporteur.' })); return; }
    setValidationStates((current) => ({ ...current, [visit.id]: 'saving' }));
    setValidationMessages((current) => ({ ...current, [visit.id]: '' }));
    const { data, error: validationError } = await supabase.rpc('validate_cdr_business_referrer', { p_visit_id: visit.id, p_business_referrer_name: referrerName });
    if (validationError) {
      console.error('[CDR] Validation de l’apporteur impossible.', validationError);
      setValidationStates((current) => ({ ...current, [visit.id]: 'error' }));
      setValidationMessages((current) => ({ ...current, [visit.id]: validationError.message }));
      return;
    }
    setVisits((current) => current.map((item) => item.id === visit.id ? { ...item, ...(data as Partial<TableVisit>) } : item));
    setValidatedReferrers((current) => ({ ...current, [visit.id]: referrerName }));
    setValidationStates((current) => ({ ...current, [visit.id]: 'saved' }));
    setValidationMessages((current) => ({ ...current, [visit.id]: `Validé : ${referrerName}` }));
    await refresh();
  }

  async function signOut() { const { error: signOutError } = await supabase.auth.signOut(); if (signOutError) console.error('[CDR] Déconnexion impossible.', signOutError); router.replace('/login'); }

  return <main className="mx-auto min-h-dvh max-w-2xl px-4 py-4 sm:px-6">
    <header className="mb-6 flex items-center gap-3 border-b border-zinc-800 pb-4">
      <Image src="/bridge-logo.png" alt="BRIDGE — Pont Alexandre III" width={128} height={46} className="h-8 w-24 object-contain" />
      <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.2em] text-fuchsia-400">Live</p><h1 className="truncate text-xl font-black">Bonjour {name}</h1></div>
      <button className="min-h-11 shrink-0 rounded-full bg-zinc-800 px-3 py-2 text-sm font-semibold" onClick={() => void signOut()}>Déconnexion</button>
    </header>
    {loading ? <p className="panel p-5 text-center text-sm text-zinc-400">Chargement de vos tables...</p> : error ? <p className="panel p-5 text-center text-sm text-red-300">{error}</p> : <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Indicateurs de mon rang">
        {[['Tables', tableRows.length], ['Occupées', summary.occupied], ['Libres', summary.available], ['Personnes', summary.present]].map(([label, value]) => <article className="panel p-3" key={String(label)}><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></article>)}
      </section>
      <datalist id="cdr-business-referrer-options">{businessReferrers.map((referrer) => <option key={referrer.id} value={referrer.name} />)}</datalist>
      <section className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Mes tables">
        {tableRows.map(({ table, visit }) => {
          const total = presentTotal(table);
          const occupied = total > 0;
          const noteState = visit ? saveStates[visit.id] ?? 'idle' : 'idle';
          const noteDraft = visit ? notes[visit.id] ?? { comment: visit.cdr_comment ?? '', referrer: visit.business_referrer ?? '' } : null;
          const validatedName = visit ? businessReferrers.find((referrer) => referrer.id === visit.business_referrer_id)?.name ?? validatedReferrers[visit.id] ?? null : null;
          const validationState = visit ? validationStates[visit.id] ?? 'idle' : 'idle';
          const hasValidatedReferrer = Boolean(visit?.business_referrer_id);
          return <article className={`min-h-28 rounded-2xl border p-4 ${occupied ? 'border-fuchsia-500/50 bg-fuchsia-950/30' : 'border-zinc-700 bg-zinc-900/80'}`} key={table.id}>
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Table {getTableDisplayNumber(table)}</h2><p className="mt-1 text-sm text-zinc-400">{table.zone?.name ?? 'Carré non attribué'}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${occupied ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'bg-zinc-700 text-zinc-300'}`}>{occupied ? 'OCCUPÉE' : 'LIBRE'}</span></div>
            <p className="mt-4 text-sm text-zinc-300">{occupied ? <><b className="text-lg text-white">{total}</b> personne{total !== 1 ? 's' : ''}</> : 'Aucun client actuellement'}</p>
            {visit && noteDraft && <div className="mt-5 grid gap-4 border-t border-white/10 pt-4">
              <section className="grid gap-2 text-sm"><p><span className="text-zinc-500">Nom de réservation · </span>{visit.reservation_name || 'Non renseigné'}</p><p><span className="text-zinc-500">Conso · </span>{visit.consumption || 'Non renseignée'}</p><p><span className="text-zinc-500">Commentaire · </span>{visit.sale_comment || 'Non renseigné'}</p><p><span className="text-zinc-500">Apporteur proposé · </span>{visit.proposed_business_referrer_name || 'Aucun apporteur proposé'}</p></section>
              <section className="rounded-xl bg-zinc-950/60 p-3"><p className="text-sm font-semibold">Apporteur validé</p>{hasValidatedReferrer && <p className="mt-1 text-sm text-emerald-300">Validé : {validatedName ?? 'Apporteur validé'}</p>}<label className="mt-3 block text-sm text-zinc-300"><span className="sr-only">Apporteur validé</span><input list="cdr-business-referrer-options" maxLength={300} value={validatedReferrers[visit.id] ?? ''} onChange={(event) => { setValidatedReferrers((current) => ({ ...current, [visit.id]: event.target.value })); setValidationStates((current) => ({ ...current, [visit.id]: 'idle' })); }} placeholder={visit.proposed_business_referrer_name || 'Choisir ou saisir un apporteur'} className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 outline-none focus:border-fuchsia-400" /></label><button disabled={validationState === 'saving'} onClick={() => void validateBusinessReferrer(visit)} className="mt-3 min-h-11 rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60">{validationState === 'saving' ? 'Validation...' : hasValidatedReferrer ? 'Corriger l’apporteur' : 'Valider l’apporteur'}</button>{validationMessages[visit.id] && <p className={validationState === 'error' ? 'mt-2 text-sm text-red-300' : 'mt-2 text-sm text-emerald-300'}>{validationMessages[visit.id]}</p>}</section>
              <section><label className="block text-sm font-semibold text-zinc-200">Note CDR<textarea value={noteDraft.comment} onChange={(event) => updateNote(visit.id, 'comment', event.target.value)} maxLength={1000} className="mt-2 min-h-20 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm font-normal outline-none focus:border-fuchsia-400" /></label>{noteDraft.referrer && <p className="mt-2 text-xs text-zinc-500">Apporteur historique : {noteDraft.referrer}</p>}<div className="mt-3 flex items-center gap-3"><button disabled={noteState === 'saving'} onClick={() => void saveNotes(visit)} className="min-h-11 rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60">{noteState === 'saving' ? 'Enregistrement...' : 'Enregistrer la note'}</button>{noteState === 'saved' && <p className="text-sm text-emerald-300">Enregistré</p>}{noteState === 'error' && <p className="text-sm text-red-300">Erreur d’enregistrement</p>}</div></section>
            </div>}
          </article>;
        })}
      </section>
      {tableRows.length === 0 && <p className="panel mt-6 p-5 text-center text-sm text-zinc-400">Aucune table active ne vous est actuellement attribuée.</p>}
      <section className="panel mt-6 p-4" aria-label="Mon journal"><h2 className="text-lg font-black">MON JOURNAL</h2><div className="mt-3 grid gap-3">{journal.length ? journal.map((entry) => {
        const visit = entry.entity_id ? visitsById.get(entry.entity_id) : null;
        const auditedTableId = auditText(entry.metadata, 'current_table_id');
        const tableLabel = tableLabels.get(visit?.current_table_id ?? visit?.table_id ?? auditedTableId ?? '') ?? '—';
        const before = auditText(entry.before_data, 'business_referrer_name');
        const after = auditText(entry.after_data, 'business_referrer_name') ?? '—';
        const corrected = entry.action_type === 'cdr.business_referrer.corrected';
        return <article className="rounded-xl bg-zinc-900 p-3" key={entry.id}><p className="text-xs text-zinc-500">{clock(entry.created_at)} · Table {tableLabel}{visit?.reservation_name ? ` · ${visit.reservation_name}` : ''}</p><p className="mt-1 text-sm font-semibold">{corrected ? 'Apporteur corrigé' : 'Apporteur validé'} : {corrected && before ? `${before} → ` : ''}{after}</p></article>;
      }) : <p className="text-sm text-zinc-400">Aucune action enregistrée pour le moment.</p>}</div></section>
      <section className="panel mt-6 p-4" aria-label="Récapitulatif du rang">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-black">RÉCAPITULATIF DU RANG</h2>{recapNights.length > 0 && <select aria-label="Choisir une soirée" value={recapNightId ?? ''} onChange={(event) => setSelectedRecapNightId(event.target.value || null)} className="min-h-11 max-w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none focus:border-fuchsia-400">{recapNights.map((night) => <option key={night.id} value={night.id}>{night.status === 'active' ? 'Soirée en cours' : `Soirée du ${nightLabel(night.startedAt)}`}</option>)}</select>}</div>
        {recapNightId && <p className="mt-2 text-xs text-zinc-500">{recapNights.find((night) => night.id === recapNightId)?.status === 'closed' ? 'Soirée clôturée — lecture seule' : 'Soirée en cours'}</p>}
        <div className="mt-3 grid gap-3">{selectedRecapSales.length ? selectedRecapSales.map((sale) => <article className="rounded-xl border border-zinc-800 bg-zinc-900 p-3" key={sale.table_visit_id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">Table {sale.final_table_number || sale.source_table_number || 'Non renseignée'}</p>{sale.sale_number !== null && <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300">Vente #{sale.sale_number}</span>}</div>{sale.final_table_number && sale.source_table_number && sale.final_table_number !== sale.source_table_number && <p className="mt-1 text-xs text-zinc-500">Table d’origine : {sale.source_table_number}</p>}<div className="mt-3 grid gap-2 text-sm"><p><span className="text-zinc-500">Réservation · </span>{sale.reservation_name || 'Non renseignée'}</p><p><span className="text-zinc-500">Conso · </span>{sale.consumption || 'Non renseignée'}</p><p><span className="text-zinc-500">Commentaire · </span>{sale.sale_comment || 'Non renseigné'}</p><p><span className="text-zinc-500">Note CDR · </span>{sale.cdr_comment || '—'}</p><p><span className="text-zinc-500">Apporteur d’affaires · </span>{sale.business_referrer_name || 'Non renseigné'}</p></div></article>) : <p className="text-sm text-zinc-400">Aucune vente pour cette soirée.</p>}</div>
      </section>
    </>}
  </main>;
}
