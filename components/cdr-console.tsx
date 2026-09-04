'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cdrRankTotalAmount, cdrReferrerAmountSummary, formatCdrAmount, isValidCdrAmountInput, parseCdrAmountInput } from '@/lib/cdr-amounts';
import { cdrLiveTableRows } from '@/lib/cdr-live';
import { presentTotal, stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';
import { getTableDisplayNumber } from '@/lib/tables';
import type { BusinessReferrer, CdrRankRecapSale, CdrRankStatus, LiveTable, OperationalAuditLog, TableVisit } from '@/lib/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ValidationState = 'idle' | 'saving' | 'saved' | 'error';

function normalise(rows: unknown[]): LiveTable[] {
  return rows.map((row: any) => ({ ...row, occupancy: Array.isArray(row.occupancy) ? row.occupancy[0] ?? null : row.occupancy ?? null, reservation: null })) as LiveTable[];
}

function auditText(data: Record<string, unknown> | null, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeReferrerName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
}

function clock(value: string): string { return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function nightLabel(value: string): string { return new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

export function CdrConsole() {
  const router = useRouter();
  const [tables, setTables] = useState<LiveTable[]>([]);
  const [visits, setVisits] = useState<TableVisit[]>([]);
  const [headWaiterId, setHeadWaiterId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [amountSaveStates, setAmountSaveStates] = useState<Record<string, SaveState>>({});
  const [businessReferrers, setBusinessReferrers] = useState<BusinessReferrer[]>([]);
  const [validatedReferrers, setValidatedReferrers] = useState<Record<string, string>>({});
  const [validationStates, setValidationStates] = useState<Record<string, ValidationState>>({});
  const [validationMessages, setValidationMessages] = useState<Record<string, string>>({});
  const [openReferrerSuggestions, setOpenReferrerSuggestions] = useState<string | null>(null);
  const [journal, setJournal] = useState<OperationalAuditLog[]>([]);
  const [rankRecap, setRankRecap] = useState<CdrRankRecapSale[]>([]);
  const [rankStatuses, setRankStatuses] = useState<CdrRankStatus[]>([]);
  const [rankValidationState, setRankValidationState] = useState<ValidationState>('idle');
  const [rankValidationMessage, setRankValidationMessage] = useState('');
  const [rankValidationDialogOpen, setRankValidationDialogOpen] = useState(false);
  const rankValidationTriggerRef = useRef<HTMLButtonElement>(null);
  const rankValidationCancelRef = useRef<HTMLButtonElement>(null);
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
    const [tableResult, visitResult, referrerResult, rankStatusResult] = await Promise.all([
      supabase.from('tables').select('*, zone:zones(*), head_waiter:head_waiters(*), occupancy:occupancies(*)').eq('active', true).order('display_number'),
      supabase.from('table_visits').select('*').is('ended_at', null),
      supabase.from('business_referrers').select('*').eq('active', true).order('name'),
      supabase.rpc('get_cdr_rank_status', { p_night_session_id: null }),
    ]);
    if (tableResult.error) { console.error('[CDR] Impossible de charger les tables autorisées.', tableResult.error); setError('Impossible de charger vos tables.'); setLoading(false); return; }

    const loadedTables = normalise(tableResult.data ?? []);
    const loadedReferrers = (referrerResult.data ?? []) as BusinessReferrer[];
    if (referrerResult.error) console.error('[CDR] Impossible de charger les apporteurs actifs.', referrerResult.error);
    setName(loadedTables[0]?.head_waiter ? `${loadedTables[0].head_waiter.first_name} ${loadedTables[0].head_waiter.last_name}`.trim() : `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Chef de rang');
    setHeadWaiterId(profile.head_waiter_id); setTables(loadedTables); setBusinessReferrers(loadedReferrers);
    if (rankStatusResult.error) console.error('[CDR] Impossible de charger le statut du rang.', rankStatusResult.error);
    const loadedRankStatuses = (rankStatusResult.data ?? []) as CdrRankStatus[];
    setRankStatuses(loadedRankStatuses);

    const activeNightId = loadedRankStatuses.find((status) => status.night_status === 'active')?.night_session_id ?? null;
    if (!activeNightId) {
      setRankRecap([]);
    } else {
      const { data: recapRows, error: recapError } = await supabase.rpc('get_cdr_rank_recap', { p_night_session_id: activeNightId });
      if (recapError) {
        console.error('[CDR] Impossible de charger le récapitulatif du rang.', recapError);
        setRankRecap([]);
      } else {
        setRankRecap((recapRows ?? []) as CdrRankRecapSale[]);
      }
    }

    if (visitResult.error) {
      console.error('[CDR] Impossible de charger les visites actives.', visitResult.error);
      setVisits([]); setJournal([]);
    } else {
      const loadedVisits = (visitResult.data ?? []) as TableVisit[];
      setVisits(loadedVisits);
      setAmounts((current) => Object.fromEntries(loadedVisits.map((visit) => [visit.id, current[visit.id] ?? (visit.cdr_amount === null || visit.cdr_amount === undefined ? '' : String(visit.cdr_amount))])));
      setValidatedReferrers((current) => Object.fromEntries(loadedVisits.map((visit) => [visit.id, loadedReferrers.find((referrer) => referrer.id === visit.business_referrer_id)?.name ?? current[visit.id] ?? visit.proposed_business_referrer_name ?? ''])));
      // La policy RLS CDR limite déjà ces événements à leur auteur. Ne pas dépendre
      // d'une visite encore ouverte : le journal doit rester lisible après la
      // libération ou le transfert de la table.
      if (activeNightId) {
        const { data: auditRows, error: auditError } = await supabase
          .from('operational_audit_log')
          .select('*')
          .eq('night_session_id', activeNightId)
          .in('action_type', ['cdr.business_referrer.validated', 'cdr.business_referrer.corrected', 'cdr.rank.validated'])
          .order('created_at', { ascending: false });
        if (auditError) console.error('[CDR] Impossible de charger votre journal.', auditError);
        setJournal((auditRows ?? []) as OperationalAuditLog[]);
      } else {
        setJournal([]);
      }
    }
    setError(null); setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('cdr-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occupancies' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_visits' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'night_sessions' }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

  useEffect(() => {
    if (!rankValidationDialogOpen) return;
    rankValidationCancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && rankValidationState !== 'saving') closeRankValidationDialog();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [rankValidationDialogOpen, rankValidationState]);

  const activeRankStatus = rankStatuses.find((status) => status.night_status === 'active') ?? null;
  const tableRows = useMemo(() => activeRankStatus && headWaiterId ? cdrLiveTableRows(tables, visits, headWaiterId) : [], [activeRankStatus, headWaiterId, tables, visits]);
  const summary = stats(tableRows.map(({ table }) => table));
  const visitsById = useMemo(() => new Map(visits.map((visit) => [visit.id, visit])), [visits]);
  const tableLabels = useMemo(() => new Map(tables.map((table) => [table.id, getTableDisplayNumber(table)])), [tables]);
  const recapNightId = activeRankStatus?.night_session_id ?? null;
  const selectedRecapSales = useMemo(() => rankRecap.filter((sale) => sale.night_session_id === recapNightId), [rankRecap, recapNightId]);
  const referrerAmountRows = useMemo(() => cdrReferrerAmountSummary(selectedRecapSales), [selectedRecapSales]);
  const rankTotalAmount = useMemo(() => cdrRankTotalAmount(referrerAmountRows), [referrerAmountRows]);
  const unlinkedPositiveSales = useMemo(() => selectedRecapSales.filter((sale) => Number(sale.cdr_amount ?? 0) > 0 && !sale.business_referrer_id), [selectedRecapSales]);
  const rankIsReadOnly = Boolean(activeRankStatus?.is_read_only);
  const selectedRankStatus = activeRankStatus;

  async function saveAmount(visit: TableVisit) {
    const input = amounts[visit.id] ?? '';
    if (!isValidCdrAmountInput(input)) { setAmountSaveStates((current) => ({ ...current, [visit.id]: 'error' })); return; }
    const amount = parseCdrAmountInput(input);
    setAmountSaveStates((current) => ({ ...current, [visit.id]: 'saving' }));
    const { data, error: saveError } = await supabase.rpc('update_cdr_visit_amount', { p_visit_id: visit.id, p_cdr_amount: amount });
    if (saveError) { console.error('[CDR] Enregistrement du montant impossible.', saveError); setAmountSaveStates((current) => ({ ...current, [visit.id]: 'error' })); return; }
    setVisits((current) => current.map((item) => item.id === visit.id ? { ...item, ...(data as Partial<TableVisit>) } : item));
    setAmountSaveStates((current) => ({ ...current, [visit.id]: 'saved' }));
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

  async function validateRank() {
    if (rankValidationState === 'saving') return;
    setRankValidationState('saving'); setRankValidationMessage('');
    const { error: validationError } = await supabase.rpc('validate_cdr_rank');
    if (validationError) {
      console.error('[CDR] Validation du rang impossible.', validationError);
      setRankValidationState('error'); setRankValidationMessage(validationError.message); return;
    }
    setRankValidationState('saved'); setRankValidationMessage('Votre rang a été validé et verrouillé.');
    setRankValidationDialogOpen(false);
    await refresh();
  }

  function closeRankValidationDialog() {
    if (rankValidationState === 'saving') return;
    setRankValidationDialogOpen(false);
    window.setTimeout(() => rankValidationTriggerRef.current?.focus(), 0);
  }

  function exportRankRecapPdf() {
    if (!recapNightId || selectedRankStatus?.night_status !== 'active' || !selectedRankStatus.validated_at) return;
    window.print();
  }

  async function signOut() { const { error: signOutError } = await supabase.auth.signOut(); if (signOutError) console.error('[CDR] Déconnexion impossible.', signOutError); router.replace('/login'); }

  return <><main className="cdr-screen mx-auto min-h-dvh max-w-2xl px-4 py-4 sm:px-6">
    <header className="mb-6 flex items-center gap-3 border-b border-zinc-800 pb-4">
      <Image src="/bridge-logo.png" alt="BRIDGE — Pont Alexandre III" width={128} height={46} className="h-8 w-24 object-contain" />
      <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[.2em] text-fuchsia-400">Live</p><h1 className="truncate text-xl font-black">Bonjour {name}</h1></div>
      <button className="min-h-11 shrink-0 rounded-full bg-zinc-800 px-3 py-2 text-sm font-semibold" onClick={() => void signOut()}>Déconnexion</button>
    </header>
    {loading ? <p className="panel p-5 text-center text-sm text-zinc-400">Chargement de vos tables...</p> : error ? <p className="panel p-5 text-center text-sm text-red-300">{error}</p> : <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Indicateurs de mon rang">
        {[['Tables', tableRows.length], ['Occupées', summary.occupied], ['Libres', summary.available], ['Personnes', summary.present]].map(([label, value]) => <article className="panel p-3" key={String(label)}><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></article>)}
      </section>
      <section className="panel mt-6 p-4" aria-label="Validation de mon rang">
        {activeRankStatus?.validated_at ? <><p className="font-black text-emerald-300">Rang validé</p><p className="mt-1 text-sm text-zinc-400">Validé le {new Date(activeRankStatus.validated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p><p className="mt-2 text-sm text-zinc-400">Votre rang est désormais en lecture seule.</p></> : activeRankStatus ? <><p className="font-black">Validation de mon rang</p><p className="mt-1 text-sm text-zinc-400">Cette action verrouille définitivement vos notes et validations d’apporteur pour cette soirée.</p><button ref={rankValidationTriggerRef} disabled={rankValidationState === 'saving'} onClick={() => { setRankValidationMessage(''); setRankValidationState('idle'); setRankValidationDialogOpen(true); }} className="mt-4 min-h-11 rounded-xl bg-fuchsia-600 px-4 py-2 font-bold disabled:opacity-60">VALIDER MON RANG</button>{rankValidationMessage && <p className={rankValidationState === 'error' ? 'mt-2 text-sm text-red-300' : 'mt-2 text-sm text-emerald-300'}>{rankValidationMessage}</p>}</> : <p className="text-sm text-zinc-400">Aucune soirée active. Les données historiques sont en lecture seule.</p>}
      </section>
      <section className="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Mes tables">
        {tableRows.map(({ table, visit }) => {
          const total = presentTotal(table);
          const occupied = total > 0;
          const amountState = visit ? amountSaveStates[visit.id] ?? 'idle' : 'idle';
          const amountInput = visit ? amounts[visit.id] ?? '' : '';
          const amountIsValid = isValidCdrAmountInput(amountInput);
          const validatedName = visit ? businessReferrers.find((referrer) => referrer.id === visit.business_referrer_id)?.name ?? validatedReferrers[visit.id] ?? null : null;
          const validationState = visit ? validationStates[visit.id] ?? 'idle' : 'idle';
          const hasValidatedReferrer = Boolean(visit?.business_referrer_id);
          const referrerInput = visit ? validatedReferrers[visit.id] ?? '' : '';
          const normalizedInput = normalizeReferrerName(referrerInput);
          const matchingReferrers = normalizedInput
            ? businessReferrers.filter((referrer) => normalizeReferrerName(referrer.name).includes(normalizedInput))
            : businessReferrers;
          const hasExactReferrer = businessReferrers.some((referrer) => normalizeReferrerName(referrer.name) === normalizedInput);
          return <article className={`min-h-28 rounded-2xl border p-4 ${occupied ? 'border-fuchsia-500/50 bg-fuchsia-950/30' : 'border-zinc-700 bg-zinc-900/80'}`} key={table.id}>
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black">Table {getTableDisplayNumber(table)}</h2><p className="mt-1 text-sm text-zinc-400">{table.zone?.name ?? 'Carré non attribué'}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${occupied ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'bg-zinc-700 text-zinc-300'}`}>{occupied ? 'OCCUPÉE' : 'LIBRE'}</span></div>
            <p className="mt-4 text-sm text-zinc-300">{occupied ? <><b className="text-lg text-white">{total}</b> personne{total !== 1 ? 's' : ''}</> : 'Aucun client actuellement'}</p>
            {visit && <div className="mt-5 grid gap-4 border-t border-white/10 pt-4">
              <section className="grid gap-2 text-sm"><p><span className="text-zinc-500">Nom de réservation · </span>{visit.reservation_name || 'Non renseigné'}</p><p><span className="text-zinc-500">Conso · </span>{visit.consumption || 'Non renseignée'}</p><p><span className="text-zinc-500">Commentaire · </span>{visit.sale_comment || 'Non renseigné'}</p><p><span className="text-zinc-500">Proposé par l’Hôtesse · </span>{visit.proposed_business_referrer_name ? `« ${visit.proposed_business_referrer_name} »` : 'Aucun apporteur proposé'}</p></section>
              <section className="rounded-xl bg-zinc-950/60 p-3"><p className="text-sm font-semibold">Apporteur d’affaires</p>{hasValidatedReferrer && <p className="mt-1 text-sm text-emerald-300">Apporteur validé : {validatedName ?? 'Apporteur validé'}</p>}<label className="mt-3 block text-sm text-zinc-300"><span>Rechercher ou saisir un apporteur</span><div className="relative mt-2"><input disabled={rankIsReadOnly} role="combobox" aria-autocomplete="list" aria-expanded={openReferrerSuggestions === visit.id} aria-controls={`cdr-business-referrer-options-${visit.id}`} maxLength={300} value={referrerInput} onFocus={() => setOpenReferrerSuggestions(visit.id)} onChange={(event) => { setValidatedReferrers((current) => ({ ...current, [visit.id]: event.target.value })); setValidationStates((current) => ({ ...current, [visit.id]: 'idle' })); setOpenReferrerSuggestions(visit.id); }} placeholder="Rechercher ou saisir un apporteur..." className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 outline-none focus:border-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60" />{!rankIsReadOnly && openReferrerSuggestions === visit.id && <div id={`cdr-business-referrer-options-${visit.id}`} role="listbox" className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-xl"><p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Apporteurs actifs</p>{matchingReferrers.map((referrer) => <button type="button" role="option" aria-selected={normalizeReferrerName(referrer.name) === normalizedInput} key={referrer.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setValidatedReferrers((current) => ({ ...current, [visit.id]: referrer.name })); setValidationStates((current) => ({ ...current, [visit.id]: 'idle' })); setOpenReferrerSuggestions(null); }} className="block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none">{referrer.name}</button>)}{matchingReferrers.length === 0 && normalizedInput && <p className="px-3 py-2 text-sm text-zinc-500">Aucun apporteur existant correspondant.</p>}{normalizedInput && !hasExactReferrer && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void validateBusinessReferrer(visit)} className="block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-fuchsia-300 hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none">+ Ajouter « {referrerInput.trim().replace(/\s+/g, ' ')} »</button>}</div>}</div></label><p className="mt-2 text-xs text-zinc-500">{businessReferrers.length} apporteur{businessReferrers.length !== 1 ? 's' : ''} actif{businessReferrers.length !== 1 ? 's' : ''} disponible{businessReferrers.length !== 1 ? 's' : ''}.</p><button disabled={rankIsReadOnly || validationState === 'saving'} onClick={() => void validateBusinessReferrer(visit)} className="mt-3 min-h-11 rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">{validationState === 'saving' ? 'Validation...' : hasValidatedReferrer ? 'Corriger l’apporteur' : 'Valider l’apporteur'}</button>{validationMessages[visit.id] && <p className={validationState === 'error' ? 'mt-2 text-sm text-red-300' : 'mt-2 text-sm text-emerald-300'}>{validationMessages[visit.id]}</p>}</section>
              <section><label className="block text-sm font-semibold text-zinc-200">MONTANT<input disabled={rankIsReadOnly} type="text" inputMode="decimal" value={amountInput} onChange={(event) => { setAmounts((current) => ({ ...current, [visit.id]: event.target.value })); setAmountSaveStates((current) => ({ ...current, [visit.id]: 'idle' })); }} placeholder="350,00" aria-invalid={!amountIsValid} className="mt-2 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm font-normal outline-none focus:border-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60" /></label>{!amountIsValid && <p className="mt-2 text-xs text-red-300">Saisissez un montant positif avec deux décimales maximum.</p>}{visit.cdr_comment && <p className="mt-2 text-xs text-zinc-500">Note CDR historique : {visit.cdr_comment}</p>}<div className="mt-3 flex items-center gap-3"><button disabled={rankIsReadOnly || amountState === 'saving' || !amountIsValid} onClick={() => void saveAmount(visit)} className="min-h-11 rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">{amountState === 'saving' ? 'Enregistrement...' : 'Enregistrer le montant'}</button>{amountState === 'saved' && <p className="text-sm text-emerald-300">Montant enregistré</p>}{amountState === 'error' && <p className="text-sm text-red-300">Montant invalide ou enregistrement refusé</p>}</div></section>
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
        const rankValidated = entry.action_type === 'cdr.rank.validated';
        return <article className="rounded-xl bg-zinc-900 p-3" key={entry.id}><p className="text-xs text-zinc-500">{clock(entry.created_at)}{!rankValidated && <> · Table {tableLabel}{visit?.reservation_name ? ` · ${visit.reservation_name}` : ''}</>}</p><p className="mt-1 text-sm font-semibold">{rankValidated ? 'Rang validé' : <>{corrected ? 'Apporteur corrigé' : 'Apporteur validé'} : {corrected && before ? `${before} → ` : ''}{after}</>}</p></article>;
      }) : <p className="text-sm text-zinc-400">Aucune action enregistrée pour le moment.</p>}</div></section>
      <section className="panel mt-6 p-4" aria-label="Récapitulatif du rang">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-black">RÉCAPITULATIF DU RANG</h2>{selectedRankStatus?.night_status === 'active' && selectedRankStatus.validated_at && <button type="button" onClick={exportRankRecapPdf} className="min-h-11 rounded-xl bg-zinc-800 px-3 text-sm font-bold">Exporter en PDF</button>}</div>
        {!recapNightId ? <p className="mt-4 text-sm text-zinc-400">Aucune soirée active.</p> : selectedRecapSales.length === 0 ? <p className="mt-4 text-sm text-zinc-400">Aucune transaction pour la soirée en cours.</p> : <section className="mt-5 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-3" aria-label="Récap apporteurs d’affaires"><h3 className="text-sm font-black">RÉCAP APPORTEURS D’AFFAIRES</h3><div className="mt-3 grid gap-2">{referrerAmountRows.map((row) => <div className="flex items-center justify-between gap-3 text-sm" key={row.businessReferrerId}><b className="min-w-0 break-words">{row.businessReferrerName}</b><b className="shrink-0">{formatCdrAmount(row.totalAmount)}</b></div>)}{referrerAmountRows.length === 0 && <p className="text-sm text-zinc-500">Aucun apporteur validé.</p>}</div><div className="mt-3 flex items-center justify-between border-t border-zinc-700 pt-3"><b>TOTAL</b><b className="text-fuchsia-200">{formatCdrAmount(rankTotalAmount)}</b></div></section>}
      </section>
    </>}
  </main>{rankValidationDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRankValidationDialog(); }}><section role="dialog" aria-modal="true" aria-labelledby="rank-validation-dialog-title" aria-describedby="rank-validation-dialog-description" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-red-500/40 bg-zinc-950 p-5 shadow-2xl sm:p-6"><p className="text-xs font-black uppercase tracking-[.2em] text-red-300">Action irréversible</p><h2 id="rank-validation-dialog-title" className="mt-2 text-xl font-black">Êtes-vous sûr de vouloir valider votre rang ?</h2><div id="rank-validation-dialog-description" className="mt-4 space-y-3 text-sm leading-6 text-zinc-300"><p>Après validation, vous ne pourrez plus modifier les informations des ventes de votre rang.</p><p>Vérifiez notamment les apporteurs d’affaires, réservations, consommations et commentaires avant de continuer.</p></div><section className="mt-4 rounded-xl bg-zinc-900 p-3" aria-label="Récap apporteurs avant validation"><h3 className="text-sm font-black">RÉCAP APPORTEURS</h3>{referrerAmountRows.map((row) => <p className="mt-2 flex justify-between gap-3 text-sm" key={row.businessReferrerId}><span>{row.businessReferrerName} · {row.saleCount} vente{row.saleCount !== 1 ? 's' : ''}</span><b>{formatCdrAmount(row.totalAmount)}</b></p>)}<p className="mt-3 flex justify-between border-t border-zinc-700 pt-3 font-bold"><span>TOTAL</span><span>{formatCdrAmount(rankTotalAmount)}</span></p></section>{unlinkedPositiveSales.length > 0 && <div className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200" role="alert"><p className="font-bold">Certaines sommes ne sont rattachées à aucun apporteur d’affaires.</p><ul className="mt-2 list-disc pl-5">{unlinkedPositiveSales.map((sale) => <li key={sale.table_visit_id}>Vente #{sale.sale_number ?? '—'} · Table {sale.final_table_number || sale.source_table_number || '—'} · {formatCdrAmount(Number(sale.cdr_amount))}</li>)}</ul></div>}{rankValidationState === 'error' && rankValidationMessage && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300" role="alert">Validation impossible : {rankValidationMessage}</p>}<div className="mt-6 grid gap-3 sm:grid-cols-2"><button ref={rankValidationCancelRef} type="button" disabled={rankValidationState === 'saving'} onClick={closeRankValidationDialog} className="min-h-12 rounded-xl bg-zinc-800 px-4 py-3 font-bold disabled:cursor-wait disabled:opacity-60">ANNULER</button><button type="button" disabled={rankValidationState === 'saving' || unlinkedPositiveSales.length > 0} onClick={() => void validateRank()} className="min-h-12 rounded-xl bg-red-600 px-4 py-3 font-black disabled:cursor-not-allowed disabled:opacity-60">{rankValidationState === 'saving' ? 'Validation en cours…' : 'CONFIRMER ET VERROUILLER MON RANG'}</button></div></section></div>}{recapNightId && selectedRankStatus?.night_status === 'active' && selectedRankStatus.validated_at && <section className="cdr-print-report hidden" aria-label="Document PDF du récapitulatif du rang">
    <header className="cdr-print-header"><p className="cdr-print-brand">MAZE-OUT</p><h1>Récapitulatif du rang</h1><div className="cdr-print-meta"><p><b>CDR :</b> {name}</p><p><b>Date :</b> {nightLabel(selectedRankStatus.night_started_at)}</p></div></header>
    <section className="cdr-print-referrers" aria-label="Récap apporteurs d’affaires"><h2>APPORTEURS D’AFFAIRES</h2>{referrerAmountRows.map((row) => <div className="cdr-print-referrer" key={row.businessReferrerId}><span>{row.businessReferrerName}</span><b>{formatCdrAmount(row.totalAmount)}</b></div>)}<div className="cdr-print-referrer cdr-print-total"><span>TOTAL</span><b>{formatCdrAmount(rankTotalAmount)}</b></div></section>
  </section>}</>;
}
