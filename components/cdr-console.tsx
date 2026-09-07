'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cdrRankTotalAmount, cdrReferrerAmountSummary, formatCdrAmount, isValidCdrAmountInput, parseCdrAmountInput } from '@/lib/cdr-amounts';
import { cdrLiveTableRows, cdrTableOperationalState } from '@/lib/cdr-live';
import type { CdrLiveTableRow, CdrTableOperationalState } from '@/lib/cdr-live';
import { presentTotal, stats } from '@/lib/live';
import { supabase } from '@/lib/supabase/client';
import { getTableDisplayNumber } from '@/lib/tables';
import type { BusinessReferrer, CdrRankRecapSale, CdrRankStatus, LiveTable, OperationalAuditLog, TableVisit } from '@/lib/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ValidationState = 'idle' | 'saving' | 'saved' | 'error';

const tableStateLabel: Record<CdrTableOperationalState, string> = {
  free: 'LIBRE',
  check: 'À VÉRIFIER',
  complete: 'À COMPLÉTER',
  ready: 'PRÊTE',
  locked: 'VERROUILLÉE',
};

const tableStateClass: Record<CdrTableOperationalState, string> = {
  free: 'border-zinc-800 bg-zinc-900/60 text-zinc-400',
  check: 'border-amber-400/70 bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20',
  complete: 'border-orange-400/60 bg-orange-500/10 text-orange-200',
  ready: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200',
  locked: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200',
};

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
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
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
  const tableRows = useMemo(() => headWaiterId ? cdrLiveTableRows(tables, activeRankStatus ? visits : [], headWaiterId) : [], [activeRankStatus, headWaiterId, tables, visits]);
  const liveSummary = stats(tableRows.map(({ table }) => table));
  const summary = activeRankStatus ? liveSummary : { ...liveSummary, occupied: 0, available: tableRows.length, present: 0 };
  const visitsById = useMemo(() => new Map(visits.map((visit) => [visit.id, visit])), [visits]);
  const tableLabels = useMemo(() => new Map(tables.map((table) => [table.id, getTableDisplayNumber(table)])), [tables]);
  const recapNightId = activeRankStatus?.night_session_id ?? null;
  const selectedRecapSales = useMemo(() => rankRecap.filter((sale) => sale.night_session_id === recapNightId), [rankRecap, recapNightId]);
  const referrerAmountRows = useMemo(() => cdrReferrerAmountSummary(selectedRecapSales), [selectedRecapSales]);
  const rankTotalAmount = useMemo(() => cdrRankTotalAmount(referrerAmountRows), [referrerAmountRows]);
  const unlinkedPositiveSales = useMemo(() => selectedRecapSales.filter((sale) => Number(sale.cdr_amount ?? 0) > 0 && !sale.business_referrer_id), [selectedRecapSales]);
  const rankIsReadOnly = Boolean(activeRankStatus?.is_read_only);
  const selectedRankStatus = activeRankStatus;
  const selectedTableRow = tableRows.find(({ table }) => table.id === selectedTableId) ?? null;
  const actionableTableRows = tableRows.filter(({ visit }) => {
    const state = cdrTableOperationalState(visit, rankIsReadOnly);
    return state === 'check' || state === 'complete';
  });
  const otherTableRows = tableRows.filter(({ visit }) => {
    const state = cdrTableOperationalState(visit, rankIsReadOnly);
    return state !== 'check' && state !== 'complete';
  });
  const selectedTable = selectedTableRow?.table ?? null;
  const selectedVisit = selectedTableRow?.visit ?? null;
  const selectedPeople = selectedTable ? presentTotal(selectedTable) : 0;
  const selectedAmountInput = selectedVisit ? amounts[selectedVisit.id] ?? '' : '';
  const selectedAmountState = selectedVisit ? amountSaveStates[selectedVisit.id] ?? 'idle' : 'idle';
  const selectedAmountIsValid = isValidCdrAmountInput(selectedAmountInput);
  const selectedValidationState = selectedVisit ? validationStates[selectedVisit.id] ?? 'idle' : 'idle';
  const selectedHasValidatedReferrer = Boolean(selectedVisit?.business_referrer_id);
  const selectedReferrerInput = selectedVisit ? validatedReferrers[selectedVisit.id] ?? '' : '';
  const selectedNormalizedInput = normalizeReferrerName(selectedReferrerInput);
  const selectedMatchingReferrers = selectedNormalizedInput
    ? businessReferrers.filter((referrer) => normalizeReferrerName(referrer.name).includes(selectedNormalizedInput))
    : businessReferrers;
  const selectedHasExactReferrer = businessReferrers.some((referrer) => normalizeReferrerName(referrer.name) === selectedNormalizedInput);
  const selectedValidatedName = selectedVisit
    ? businessReferrers.find((referrer) => referrer.id === selectedVisit.business_referrer_id)?.name ?? validatedReferrers[selectedVisit.id] ?? null
    : null;

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

  function rankTableButton({ table, visit }: CdrLiveTableRow) {
    const state = cdrTableOperationalState(visit, rankIsReadOnly);
    const people = activeRankStatus ? presentTotal(table) : 0;
    const selected = selectedTableId === table.id;
    return <button
      type="button"
      key={table.id}
      onClick={() => setSelectedTableId(table.id)}
      aria-pressed={selected}
      aria-label={`Table ${getTableDisplayNumber(table)} · ${tableStateLabel[state]}`}
      className={`min-h-[4.5rem] min-w-0 rounded-xl border px-2 py-2.5 text-left transition active:scale-[.98] ${tableStateClass[state]} ${selected ? 'outline outline-2 outline-offset-2 outline-white/70' : ''}`}
    >
      <span className="block truncate text-lg font-black text-white">{getTableDisplayNumber(table)}</span>
      <span className="mt-1 block truncate text-[10px] font-black tracking-wide">{tableStateLabel[state]}</span>
      {visit && <span className="mt-0.5 block text-[10px] text-current/80">{people} pers.</span>}
    </button>;
  }

  return <><main className="cdr-screen mx-auto min-h-dvh max-w-4xl overflow-x-hidden px-3 py-3 sm:px-6 sm:py-4">
    <header className="flex items-center gap-2.5 border-b border-zinc-800 pb-3">
      <Image src="/bridge-logo.png" alt="BRIDGE — Pont Alexandre III" width={112} height={40} className="h-7 w-20 shrink-0 object-contain sm:w-24" />
      <h1 className="min-w-0 flex-1 truncate text-base font-black sm:text-lg">Bonjour {name}</h1>
      <button className="signout-button" onClick={() => void signOut()}>Déconnexion</button>
    </header>
    {loading ? <p className="panel mt-4 p-5 text-center text-sm text-zinc-400">Chargement de votre rang...</p> : error ? <p className="panel mt-4 p-5 text-center text-sm text-red-300">{error}</p> : <>
      <section className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs sm:text-sm" aria-label="Résumé de mon rang">
        <b>{tableRows.length} table{tableRows.length !== 1 ? 's' : ''}</b><span aria-hidden="true">•</span><span>{summary.occupied} occupée{summary.occupied !== 1 ? 's' : ''}</span><span aria-hidden="true">•</span><span>{summary.available} libre{summary.available !== 1 ? 's' : ''}</span><span aria-hidden="true">•</span><span>{summary.present} personne{summary.present !== 1 ? 's' : ''}</span>
      </section>

      <section className="mt-5" aria-label="Mon rang">
        <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-fuchsia-400">{tables[0]?.zone?.name ?? 'Mon espace'}</p><h2 className="text-xl font-black">MON RANG</h2></div>{!activeRankStatus && <p className="text-right text-xs text-zinc-500">Aucune soirée active</p>}</div>
        {actionableTableRows.length > 0 && <div className="mt-3"><h3 className="mb-2 text-xs font-black uppercase tracking-[.16em] text-amber-300">À traiter · {actionableTableRows.length}</h3><div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">{actionableTableRows.map(rankTableButton)}</div></div>}
        <div className="mt-3">{actionableTableRows.length > 0 && <h3 className="mb-2 text-xs font-black uppercase tracking-[.16em] text-zinc-500">Mes autres tables</h3>}<div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">{otherTableRows.map(rankTableButton)}</div></div>
        {tableRows.length === 0 && <p className="panel mt-3 p-4 text-center text-sm text-zinc-400">Aucune table ne vous est structurellement attribuée.</p>}
      </section>

      {selectedTable && <section className="panel mt-5 scroll-mt-3 p-4 sm:p-5" aria-label="Informations de la table">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-fuchsia-400">{selectedTable.zone?.name ?? 'Rang'}</p><h2 className="mt-1 text-2xl font-black">TABLE {getTableDisplayNumber(selectedTable)}</h2></div><button type="button" onClick={() => setSelectedTableId(null)} className="min-h-11 rounded-xl bg-zinc-800 px-3 text-sm font-bold">Retour au rang</button></div>
        {!selectedVisit ? <div className="mt-5 rounded-xl bg-zinc-950/60 p-4"><p className="font-black text-zinc-300">LIBRE</p><p className="mt-1 text-sm text-zinc-500">Aucune arrivée sur cette table.</p></div> : <>
          <p className="mt-4 text-lg font-black">{selectedPeople} personne{selectedPeople !== 1 ? 's' : ''}</p>
          <dl className="mt-4 grid gap-3 rounded-xl bg-zinc-950/60 p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-bold uppercase text-zinc-500">Réservation</dt><dd className="mt-1 break-words text-base">{selectedVisit.reservation_name || 'Non renseignée'}</dd></div>
            <div><dt className="text-xs font-bold uppercase text-zinc-500">Consommation</dt><dd className="mt-1 break-words text-base">{selectedVisit.consumption || 'Non renseignée'}</dd></div>
            <div><dt className="text-xs font-bold uppercase text-zinc-500">Commentaire</dt><dd className="mt-1 break-words text-base">{selectedVisit.sale_comment || 'Non renseigné'}</dd></div>
            <div><dt className="text-xs font-bold uppercase text-zinc-500">Proposé par l’Hôtesse</dt><dd className="mt-1 break-words text-base">{selectedVisit.proposed_business_referrer_name || 'Aucune proposition'}</dd></div>
          </dl>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-sm font-black">APPORTEUR</p>{selectedHasValidatedReferrer && <p className="mt-1 break-words text-sm text-emerald-300">Validé · {selectedValidatedName ?? 'Apporteur validé'}</p>}
              <label className="mt-3 block text-sm text-zinc-300"><span className="sr-only">Rechercher ou saisir un apporteur</span><div className="relative"><input disabled={rankIsReadOnly} role="combobox" aria-autocomplete="list" aria-expanded={openReferrerSuggestions === selectedVisit.id} aria-controls={`cdr-business-referrer-options-${selectedVisit.id}`} maxLength={300} value={selectedReferrerInput} onFocus={() => setOpenReferrerSuggestions(selectedVisit.id)} onChange={(event) => { setValidatedReferrers((current) => ({ ...current, [selectedVisit.id]: event.target.value })); setValidationStates((current) => ({ ...current, [selectedVisit.id]: 'idle' })); setOpenReferrerSuggestions(selectedVisit.id); }} placeholder="Rechercher ou saisir..." className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 outline-none focus:border-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60" />{!rankIsReadOnly && openReferrerSuggestions === selectedVisit.id && <div id={`cdr-business-referrer-options-${selectedVisit.id}`} role="listbox" className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-1 shadow-xl"><p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Apporteurs actifs</p>{selectedMatchingReferrers.map((referrer) => <button type="button" role="option" aria-selected={normalizeReferrerName(referrer.name) === selectedNormalizedInput} key={referrer.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setValidatedReferrers((current) => ({ ...current, [selectedVisit.id]: referrer.name })); setValidationStates((current) => ({ ...current, [selectedVisit.id]: 'idle' })); setOpenReferrerSuggestions(null); }} className="block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-800">{referrer.name}</button>)}{selectedMatchingReferrers.length === 0 && selectedNormalizedInput && <p className="px-3 py-2 text-sm text-zinc-500">Aucun apporteur correspondant.</p>}{selectedNormalizedInput && !selectedHasExactReferrer && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void validateBusinessReferrer(selectedVisit)} className="block min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-fuchsia-300 hover:bg-zinc-800">+ Ajouter « {selectedReferrerInput.trim().replace(/\s+/g, ' ')} »</button>}</div>}</div></label>
              <button disabled={rankIsReadOnly || selectedValidationState === 'saving'} onClick={() => void validateBusinessReferrer(selectedVisit)} className="mt-3 min-h-11 w-full rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">{selectedValidationState === 'saving' ? 'Validation...' : selectedHasValidatedReferrer ? 'Corriger l’apporteur' : 'Valider l’apporteur'}</button>{validationMessages[selectedVisit.id] && <p className={selectedValidationState === 'error' ? 'mt-2 text-sm text-red-300' : 'mt-2 text-sm text-emerald-300'}>{validationMessages[selectedVisit.id]}</p>}
            </section>
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
              <label className="block text-sm font-black">MONTANT<input disabled={rankIsReadOnly} type="text" inputMode="decimal" value={selectedAmountInput} onChange={(event) => { setAmounts((current) => ({ ...current, [selectedVisit.id]: event.target.value })); setAmountSaveStates((current) => ({ ...current, [selectedVisit.id]: 'idle' })); }} placeholder="150 ou 150,50" aria-invalid={!selectedAmountIsValid} className="mt-3 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-base font-normal outline-none focus:border-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-60" /></label>{!selectedAmountIsValid && <p className="mt-2 text-xs text-red-300">Montant positif, deux décimales maximum.</p>}
              <button disabled={rankIsReadOnly || selectedAmountState === 'saving' || !selectedAmountIsValid} onClick={() => void saveAmount(selectedVisit)} className="mt-3 min-h-11 w-full rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">{selectedAmountState === 'saving' ? 'Enregistrement...' : 'Enregistrer le montant'}</button>{selectedAmountState === 'saved' && <p className="mt-2 text-sm text-emerald-300">Montant enregistré</p>}{selectedAmountState === 'error' && <p className="mt-2 text-sm text-red-300">Montant invalide ou enregistrement refusé</p>}
            </section>
          </div>
        </>}
      </section>}

      <section className="panel mt-5 p-4" aria-label="Récapitulatif du rang">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-black">RÉCAP APPORTEURS D’AFFAIRES</h2>{selectedRankStatus?.night_status === 'active' && selectedRankStatus.validated_at && <button type="button" onClick={exportRankRecapPdf} className="min-h-11 rounded-xl bg-zinc-800 px-3 text-sm font-bold">Exporter en PDF</button>}</div>
        {!recapNightId ? <p className="mt-3 text-sm text-zinc-500">Aucune soirée active.</p> : selectedRecapSales.length === 0 ? <p className="mt-3 text-sm text-zinc-500">Aucune vente pour la soirée en cours.</p> : <div className="mt-4 grid gap-2">{referrerAmountRows.map((row) => <div className="flex items-center justify-between gap-3 text-sm" key={row.businessReferrerId}><b className="min-w-0 break-words">{row.businessReferrerName}</b><b className="shrink-0">{formatCdrAmount(row.totalAmount)}</b></div>)}{referrerAmountRows.length === 0 && <p className="text-sm text-zinc-500">Aucun apporteur validé.</p>}<div className="mt-1 flex items-center justify-between border-t border-zinc-700 pt-3"><b>TOTAL</b><b className="text-fuchsia-200">{formatCdrAmount(rankTotalAmount)}</b></div></div>}
      </section>

      <section className="panel mt-5 p-4" aria-label="Validation finale du rang">
        {activeRankStatus?.validated_at ? <><p className="font-black text-emerald-300">Rang validé</p><p className="mt-1 text-sm text-zinc-400">Validé le {new Date(activeRankStatus.validated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p></> : activeRankStatus ? <><p className="text-xs font-bold uppercase tracking-[.16em] text-zinc-500">Dernière étape</p><h2 className="mt-1 font-black">VALIDER MON RANG</h2><p className="mt-2 text-sm text-zinc-400">{referrerAmountRows.length} apporteur{referrerAmountRows.length !== 1 ? 's' : ''} · Total {formatCdrAmount(rankTotalAmount)}</p><button ref={rankValidationTriggerRef} disabled={rankValidationState === 'saving'} onClick={() => { setRankValidationMessage(''); setRankValidationState('idle'); setRankValidationDialogOpen(true); }} className="mt-4 min-h-12 w-full rounded-xl bg-fuchsia-600 px-4 py-3 font-black disabled:opacity-60">VALIDER MON RANG</button>{rankValidationMessage && <p className={rankValidationState === 'error' ? 'mt-2 text-sm text-red-300' : 'mt-2 text-sm text-emerald-300'}>{rankValidationMessage}</p>}</> : <p className="text-sm text-zinc-500">La validation sera disponible pendant la prochaine soirée.</p>}
      </section>

      <details className="panel mb-4 mt-5 p-4" aria-label="Mon journal"><summary className="min-h-11 cursor-pointer py-2 font-black">MON JOURNAL <span className="ml-2 text-sm font-normal text-zinc-500">· {journal.length} action{journal.length !== 1 ? 's' : ''}</span></summary><div className="mt-2 grid gap-2">{journal.length ? journal.map((entry) => {
        const visit = entry.entity_id ? visitsById.get(entry.entity_id) : null;
        const auditedTableId = auditText(entry.metadata, 'current_table_id');
        const tableLabel = tableLabels.get(visit?.current_table_id ?? visit?.table_id ?? auditedTableId ?? '') ?? '—';
        const before = auditText(entry.before_data, 'business_referrer_name');
        const after = auditText(entry.after_data, 'business_referrer_name') ?? '—';
        const corrected = entry.action_type === 'cdr.business_referrer.corrected';
        const rankValidated = entry.action_type === 'cdr.rank.validated';
        return <article className="rounded-xl bg-zinc-950/60 p-3" key={entry.id}><p className="text-xs text-zinc-500">{clock(entry.created_at)}{!rankValidated && <> · Table {tableLabel}{visit?.reservation_name ? ` · ${visit.reservation_name}` : ''}</>}</p><p className="mt-1 text-sm font-semibold">{rankValidated ? 'Rang validé' : <>{corrected ? 'Apporteur corrigé' : 'Apporteur validé'} : {corrected && before ? `${before} → ` : ''}{after}</>}</p></article>;
      }) : <p className="text-sm text-zinc-500">Aucune action pour la soirée en cours.</p>}</div></details>
    </>}
  </main>{rankValidationDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRankValidationDialog(); }}><section role="dialog" aria-modal="true" aria-labelledby="rank-validation-dialog-title" aria-describedby="rank-validation-dialog-description" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-red-500/40 bg-zinc-950 p-5 shadow-2xl sm:p-6"><p className="text-xs font-black uppercase tracking-[.2em] text-red-300">Action irréversible</p><h2 id="rank-validation-dialog-title" className="mt-2 text-xl font-black">Êtes-vous sûr de vouloir valider votre rang ?</h2><div id="rank-validation-dialog-description" className="mt-4 space-y-3 text-sm leading-6 text-zinc-300"><p>Après validation, vous ne pourrez plus modifier les informations des ventes de votre rang.</p><p>Vérifiez notamment les apporteurs d’affaires, réservations, consommations et commentaires avant de continuer.</p></div><section className="mt-4 rounded-xl bg-zinc-900 p-3" aria-label="Récap apporteurs avant validation"><h3 className="text-sm font-black">RÉCAP APPORTEURS</h3>{referrerAmountRows.map((row) => <p className="mt-2 flex justify-between gap-3 text-sm" key={row.businessReferrerId}><span>{row.businessReferrerName} · {row.saleCount} vente{row.saleCount !== 1 ? 's' : ''}</span><b>{formatCdrAmount(row.totalAmount)}</b></p>)}<p className="mt-3 flex justify-between border-t border-zinc-700 pt-3 font-bold"><span>TOTAL</span><span>{formatCdrAmount(rankTotalAmount)}</span></p></section>{unlinkedPositiveSales.length > 0 && <div className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200" role="alert"><p className="font-bold">Certaines sommes ne sont rattachées à aucun apporteur d’affaires.</p><ul className="mt-2 list-disc pl-5">{unlinkedPositiveSales.map((sale) => <li key={sale.table_visit_id}>Vente #{sale.sale_number ?? '—'} · Table {sale.final_table_number || sale.source_table_number || '—'} · {formatCdrAmount(Number(sale.cdr_amount))}</li>)}</ul></div>}{rankValidationState === 'error' && rankValidationMessage && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300" role="alert">Validation impossible : {rankValidationMessage}</p>}<div className="mt-6 grid gap-3 sm:grid-cols-2"><button ref={rankValidationCancelRef} type="button" disabled={rankValidationState === 'saving'} onClick={closeRankValidationDialog} className="min-h-12 rounded-xl bg-zinc-800 px-4 py-3 font-bold disabled:cursor-wait disabled:opacity-60">ANNULER</button><button type="button" disabled={rankValidationState === 'saving' || unlinkedPositiveSales.length > 0} onClick={() => void validateRank()} className="min-h-12 rounded-xl bg-red-600 px-4 py-3 font-black disabled:cursor-not-allowed disabled:opacity-60">{rankValidationState === 'saving' ? 'Validation en cours…' : 'CONFIRMER ET VERROUILLER MON RANG'}</button></div></section></div>}{recapNightId && selectedRankStatus?.night_status === 'active' && selectedRankStatus.validated_at && <section className="cdr-print-report hidden" aria-label="Document PDF du récapitulatif du rang">
    <header className="cdr-print-header"><p className="cdr-print-brand">MAZE-OUT</p><h1>Récapitulatif du rang</h1><div className="cdr-print-meta"><p><b>CDR :</b> {name}</p><p><b>Date :</b> {nightLabel(selectedRankStatus.night_started_at)}</p></div></header>
    <section className="cdr-print-referrers" aria-label="Récap apporteurs d’affaires"><h2>APPORTEURS D’AFFAIRES</h2>{referrerAmountRows.map((row) => <div className="cdr-print-referrer" key={row.businessReferrerId}><span>{row.businessReferrerName}</span><b>{formatCdrAmount(row.totalAmount)}</b></div>)}<div className="cdr-print-referrer cdr-print-total"><span>TOTAL</span><b>{formatCdrAmount(rankTotalAmount)}</b></div></section>
  </section>}</>;
}
