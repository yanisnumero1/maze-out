'use client';

import { useEffect, useMemo, useState } from 'react';
import { promoterActivitySummaries, promoterArrivalCount } from '@/lib/promoters';
import type { ClubEntryCount, FloorNote, Promoter, PromoterCountEvent } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';

type OperationView = 'piste' | 'promoteurs' | 'entrees';

const dateTime = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const nonNegative = (value: number) => Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);
const positiveInteger = (value: string) => /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;

export function HostessOperations({ view }: { view: OperationView }) {
  const [notes, setNotes] = useState<FloorNote[]>([]);
  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [promoterEvents, setPromoterEvents] = useState<PromoterCountEvent[]>([]);
  const [entries, setEntries] = useState<ClubEntryCount[]>([]);
  const [noteText, setNoteText] = useState('');
  const [promoterName, setPromoterName] = useState('');
  const [entryValue, setEntryValue] = useState('');
  const [selectedPromoterId, setSelectedPromoterId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingActivity, setSavingActivity] = useState(false);

  async function refresh() {
    setLoading(true);
    const { data: currentNight, error: nightError } = await supabase.rpc('current_operational_night_session');
    if (nightError) {
      console.error('[OPERATIONS] Soirée active introuvable.', nightError);
      setNotice(`Impossible de charger les données : ${nightError.message}`);
      setLoading(false);
      return;
    }
    if (!currentNight) {
      setNotes([]); setPromoters([]); setPromoterEvents([]); setEntries([]); setSelectedPromoterId(null); setNotice(''); setLoading(false);
      return;
    }
    const [notesResult, promotersResult, promoterEventsResult, entriesResult] = await Promise.all([
      supabase.from('floor_notes').select('*').eq('night_session_id', currentNight).order('created_at', { ascending: false }),
      supabase.from('promoters').select('*').eq('night_session_id', currentNight).order('name'),
      supabase.from('promoter_count_events').select('*').eq('night_session_id', currentNight).order('created_at', { ascending: false }),
      supabase.from('club_entry_counts').select('*').eq('night_session_id', currentNight).order('recorded_at', { ascending: false }),
    ]);
    if (notesResult.error || promotersResult.error || promoterEventsResult.error || entriesResult.error) {
      console.error('[OPERATIONS] Chargement impossible.', { notesError: notesResult.error, promotersError: promotersResult.error, promoterEventsError: promoterEventsResult.error, entriesError: entriesResult.error });
      setNotice(`Impossible de charger les données : ${notesResult.error?.message ?? promotersResult.error?.message ?? promoterEventsResult.error?.message ?? entriesResult.error?.message}`);
      setLoading(false);
      return;
    }
    setNotes((notesResult.data ?? []) as FloorNote[]);
    setPromoters((promotersResult.data ?? []) as Promoter[]);
    setPromoterEvents((promoterEventsResult.data ?? []) as PromoterCountEvent[]);
    setEntries((entriesResult.data ?? []) as ClubEntryCount[]);
    console.info('[OPERATIONS] Listes Supabase chargées.', { nightSessionId: currentNight, notes: notesResult.data?.length ?? 0, promoters: promotersResult.data?.length ?? 0, promoterEvents: promoterEventsResult.data?.length ?? 0, entryCounts: entriesResult.data?.length ?? 0 });
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('hostess-operations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_notes' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoters' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoter_count_events' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_entry_counts' }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  async function addNote() {
    const { data, error } = await supabase.rpc('add_floor_note', { p_content: noteText });
    console.info('[OPERATIONS] RPC add_floor_note.', { data, error });
    if (error || !data) return setNotice(error?.message ?? 'La note Piste n’a pas été enregistrée.');
    setNotes((rows) => [data as FloorNote, ...rows.filter((note) => note.id !== data.id)]);
    setNoteText(''); setNotice(''); await refresh();
  }
  async function saveNote(note: FloorNote, content: string) {
    const { data, error } = await supabase.rpc('update_floor_note', { p_note_id: note.id, p_content: content });
    console.info('[OPERATIONS] RPC update_floor_note.', { data, error });
    if (error || !data) return setNotice(error?.message ?? 'La note Piste n’a pas été modifiée.');
    setNotes((rows) => rows.map((row) => row.id === note.id ? data as FloorNote : row));
    setEditingNote(null); setNotice(''); await refresh();
  }
  async function deleteNote(id: string) {
    if (!window.confirm('Supprimer cette note Piste ?')) return;
    const { data, error } = await supabase.rpc('delete_floor_note', { p_note_id: id });
    console.info('[OPERATIONS] RPC delete_floor_note.', { data, error });
    if (error) return setNotice(error.message);
    setNotes((rows) => rows.filter((note) => note.id !== id)); setNotice(''); await refresh();
  }
  async function addPromoter() {
    const { data, error } = await supabase.rpc('add_promoter', { p_name: promoterName });
    console.info('[OPERATIONS] RPC add_promoter.', { data, error });
    if (error || !data) return setNotice(error?.message ?? 'Le promoteur n’a pas été enregistré.');
    setPromoters((rows) => [...rows.filter((promoter) => promoter.id !== data.id), data as Promoter].sort((left, right) => left.name.localeCompare(right.name, 'fr')));
    setPromoterName(''); setNotice(''); await refresh();
  }
  async function addPromoterActivity(promoter: Promoter, peopleAdded: number, note: string) {
    setSavingActivity(true);
    const { data, error } = await supabase.rpc('add_promoter_activity', { p_promoter_id: promoter.id, p_people_added: peopleAdded, p_note: note || null });
    console.info('[OPERATIONS] RPC add_promoter_activity.', { data, error }); setSavingActivity(false);
    if (error || !data) { setNotice(error?.message ?? 'L’arrivée Promoteur n’a pas été enregistrée.'); return false; }
    setNotice(''); await refresh(); return true;
  }
  async function updatePromoterActivity(event: PromoterCountEvent, peopleAdded: number, note: string) {
    setSavingActivity(true);
    const { data, error } = await supabase.rpc('update_promoter_activity', { p_event_id: event.id, p_people_added: peopleAdded, p_note: note || null });
    console.info('[OPERATIONS] RPC update_promoter_activity.', { data, error }); setSavingActivity(false);
    if (error || !data) { setNotice(error?.message ?? 'L’arrivée Promoteur n’a pas été modifiée.'); return false; }
    setNotice(''); await refresh(); return true;
  }
  async function deletePromoterActivity(event: PromoterCountEvent) {
    if (!window.confirm('Supprimer cette arrivée ? Le total du promoteur sera recalculé.')) return;
    setSavingActivity(true);
    const { data, error } = await supabase.rpc('delete_promoter_activity', { p_event_id: event.id });
    console.info('[OPERATIONS] RPC delete_promoter_activity.', { data, error }); setSavingActivity(false);
    if (error) return setNotice(error.message);
    setNotice(''); await refresh();
  }
  async function deletePromoter(id: string) {
    if (!window.confirm('Supprimer ce promoteur de la soirée active ?')) return;
    const { data, error } = await supabase.rpc('delete_promoter', { p_promoter_id: id });
    console.info('[OPERATIONS] RPC delete_promoter.', { data, error });
    if (error) return setNotice(error.message);
    setPromoters((rows) => rows.filter((promoter) => promoter.id !== id)); setSelectedPromoterId(null); setNotice(''); await refresh();
  }
  async function saveEntry(existing?: ClubEntryCount, requestedCount?: number) {
    const count = nonNegative(requestedCount ?? Number(entryValue));
    const result = existing ? await supabase.rpc('update_club_entry_count', { p_entry_count_id: existing.id, p_count: count }) : await supabase.rpc('record_club_entry_count', { p_count: count });
    console.info(existing ? '[OPERATIONS] RPC update_club_entry_count.' : '[OPERATIONS] RPC record_club_entry_count.', result);
    if (result.error || !result.data) return setNotice(result.error?.message ?? 'Le relevé Entrées club n’a pas été enregistré.');
    setEntries((rows) => [result.data as ClubEntryCount, ...rows.filter((entry) => entry.id !== result.data.id)].sort((left, right) => new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime()));
    setEntryValue(''); setEditingEntry(null); setNotice(''); await refresh();
  }
  async function deleteEntry(id: string) {
    if (!window.confirm('Supprimer ce relevé Entrées club ?')) return;
    const { data, error } = await supabase.rpc('delete_club_entry_count', { p_entry_count_id: id });
    console.info('[OPERATIONS] RPC delete_club_entry_count.', { data, error });
    if (error) return setNotice(error.message);
    setEntries((rows) => rows.filter((entry) => entry.id !== id)); setNotice(''); await refresh();
  }

  const promoterSummaries = useMemo(() => promoterActivitySummaries(promoters, promoterEvents), [promoters, promoterEvents]);
  const promoterTotal = useMemo(() => promoters.reduce((total, promoter) => total + promoter.entry_count, 0), [promoters]);
  const promoterArrivals = useMemo(() => promoterArrivalCount(promoterEvents), [promoterEvents]);
  const selectedPromoter = promoterSummaries.find((summary) => summary.promoter.id === selectedPromoterId) ?? null;
  const latestEntry = entries[0];
  const clubEntryTotal = useMemo(() => entries.reduce((total, entry) => total + entry.count, 0), [entries]);
  const reminder = latestEntry && Date.now() - new Date(latestEntry.recorded_at).getTime() >= 30 * 60 * 1000;

  if (view === 'piste') return <section><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Opérations</p><h1 className="text-3xl font-black">PISTE</h1></header><div className="panel p-4"><textarea aria-label="Ajouter une note Piste" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Ajouter une note Piste..." className="min-h-24 w-full rounded-xl bg-zinc-800 p-3 outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /><button disabled={!noteText.trim()} onClick={() => void addNote()} className="mt-3 rounded-xl bg-fuchsia-600 px-5 py-3 font-bold disabled:opacity-40">Ajouter</button></div><h2 className="mt-5 font-bold">HISTORIQUE PISTE</h2><div className="mt-3 grid gap-3">{notes.length > 0 ? notes.map((note) => <article className="panel p-4" key={note.id}>{editingNote === note.id ? <NoteEditor note={note} onCancel={() => setEditingNote(null)} onSave={saveNote} /> : <><div className="flex gap-3"><p className="mr-auto text-sm text-zinc-400">{dateTime(note.created_at)}</p><button onClick={() => setEditingNote(note.id)} className="text-sm text-violet-300">Modifier</button><button onClick={() => void deleteNote(note.id)} className="text-sm text-red-300">Supprimer</button></div><p className="mt-2">{note.content}</p></>}</article>) : loading ? <p className="text-sm text-zinc-400">Chargement…</p> : <p className="text-sm text-zinc-400">Aucune note pour la soirée active.</p>}</div>{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</section>;

  if (view === 'promoteurs') return selectedPromoter ? <PromoterDetail summary={selectedPromoter} saving={savingActivity} onBack={() => setSelectedPromoterId(null)} onAdd={addPromoterActivity} onUpdate={updatePromoterActivity} onDeleteActivity={deletePromoterActivity} onDeletePromoter={deletePromoter} notice={notice} /> : <PromoterOverview summaries={promoterSummaries} total={promoterTotal} arrivalCount={promoterArrivals} loading={loading} promoterName={promoterName} onPromoterNameChange={setPromoterName} onAddPromoter={addPromoter} onOpen={setSelectedPromoterId} notice={notice} />;

  return <section><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Opérations</p><h1 className="text-3xl font-black">ENTRÉES CLUB</h1><p className="mt-2 text-zinc-400">TOTAL ENTRÉES CLUB · <b className="text-white">{clubEntryTotal} personnes</b></p>{latestEntry && <p className="mt-1 text-sm text-zinc-400">Dernier relevé : {dateTime(latestEntry.recorded_at)} — {latestEntry.count} personnes</p>}{reminder && <p className="mt-2 text-sm text-violet-200">Un nouveau relevé peut être effectué.</p>}</header><div className="panel p-4"><label className="text-sm font-semibold">Entrées club<input aria-label="Entrées club" inputMode="numeric" type="number" min="0" value={entryValue} onChange={(event) => setEntryValue(event.target.value)} className="mt-2 block w-full rounded-xl bg-zinc-800 p-3 text-xl font-bold outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /></label><button onClick={() => void saveEntry()} className="mt-3 rounded-xl bg-fuchsia-600 px-5 py-3 font-bold">Enregistrer le relevé</button></div><div className="mt-4"><h2 className="font-bold">Derniers relevés</h2><div className="mt-3 grid gap-2">{entries.length > 0 ? entries.map((entry) => editingEntry === entry.id ? <EntryEditor entry={entry} onCancel={() => { setEditingEntry(null); setEntryValue(''); }} onSave={(item, count) => saveEntry(item, count)} key={entry.id} /> : <article className="panel flex items-center gap-3 p-3" key={entry.id}><span className="text-zinc-400">{dateTime(entry.recorded_at)}</span><b className="mr-auto text-xl">{entry.count} personnes</b><button onClick={() => { setEditingEntry(entry.id); setEntryValue(String(entry.count)); }} className="text-sm text-violet-300">Modifier</button><button onClick={() => void deleteEntry(entry.id)} className="text-sm text-red-300">Supprimer</button></article>) : loading ? <p className="text-sm text-zinc-400">Chargement…</p> : <p className="text-sm text-zinc-400">Aucun relevé pour la soirée active.</p>}</div></div>{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</section>;
}

function PromoterOverview({ summaries, total, arrivalCount, loading, promoterName, onPromoterNameChange, onAddPromoter, onOpen, notice }: { summaries: ReturnType<typeof promoterActivitySummaries>; total: number; arrivalCount: number; loading: boolean; promoterName: string; onPromoterNameChange: (value: string) => void; onAddPromoter: () => Promise<void>; onOpen: (id: string) => void; notice: string }) {
  return <section><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Opérations</p><h1 className="text-3xl font-black">PROMOTEURS</h1><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="panel p-3"><p className="text-xs text-zinc-400">TOTAL APPORTÉ</p><b>{total}</b><p className="text-xs text-zinc-400">personnes</p></div><div className="panel p-3"><p className="text-xs text-zinc-400">PROMOTEURS</p><b>{summaries.length}</b></div><div className="panel p-3"><p className="text-xs text-zinc-400">ARRIVÉES</p><b>{arrivalCount}</b></div></div></header><div className="panel flex gap-3 p-4"><input aria-label="Nom du promoteur" value={promoterName} onChange={(event) => onPromoterNameChange(event.target.value)} placeholder="Nom du promoteur" className="min-w-0 flex-1 rounded-xl bg-zinc-800 px-3 outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /><button disabled={!promoterName.trim()} onClick={() => void onAddPromoter()} className="rounded-xl bg-fuchsia-600 px-4 py-3 font-bold disabled:opacity-40">Ajouter</button></div><h2 className="mt-5 font-bold">PROMOTEURS DE LA SOIRÉE</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{summaries.map(({ promoter, activities, lastActivity }) => <button type="button" key={promoter.id} onClick={() => onOpen(promoter.id)} className="panel w-full p-4 text-left transition hover:ring-1 hover:ring-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400"><div className="flex items-center gap-3"><b className="mr-auto text-xl">{promoter.name}</b><span aria-hidden className="text-violet-300">›</span></div><p className="mt-2 text-zinc-300">{promoter.entry_count} personnes · {activities.length} arrivée{activities.length > 1 ? 's' : ''}</p>{lastActivity ? <p className="mt-3 text-sm text-zinc-400">Dernière arrivée<br />{dateTime(lastActivity.created_at)} · +{lastActivity.people_added} personnes</p> : <p className="mt-3 text-sm text-zinc-500">Aucune arrivée enregistrée</p>}</button>)}</div>{!loading && summaries.length === 0 && <p className="mt-4 text-sm text-zinc-400">Aucun promoteur pour la soirée active.</p>}{loading && <p className="mt-4 text-sm text-zinc-400">Chargement…</p>}{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</section>;
}

function PromoterDetail({ summary, saving, onBack, onAdd, onUpdate, onDeleteActivity, onDeletePromoter, notice }: { summary: ReturnType<typeof promoterActivitySummaries>[number]; saving: boolean; onBack: () => void; onAdd: (promoter: Promoter, peopleAdded: number, note: string) => Promise<boolean>; onUpdate: (event: PromoterCountEvent, peopleAdded: number, note: string) => Promise<boolean>; onDeleteActivity: (event: PromoterCountEvent) => Promise<void>; onDeletePromoter: (id: string) => Promise<void>; notice: string }) {
  const [people, setPeople] = useState(''); const [note, setNote] = useState(''); const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const validPeople = positiveInteger(people);
  const submit = async () => { if (!validPeople) return; if (await onAdd(summary.promoter, validPeople, note)) { setPeople(''); setNote(''); } };
  return <section><button onClick={onBack} className="mb-4 text-sm font-semibold text-violet-300">← RETOUR AUX PROMOTEURS</button><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Promoteurs</p><h1 className="text-3xl font-black">{summary.promoter.name}</h1><div className="panel mt-3 p-4"><p className="text-xs text-zinc-400">TOTAL SOIRÉE</p><p className="text-3xl font-black">{summary.promoter.entry_count} <span className="text-base font-medium text-zinc-300">personnes</span></p><p className="mt-1 text-sm text-zinc-400">{summary.activities.length} arrivée{summary.activities.length > 1 ? 's' : ''} enregistrée{summary.activities.length > 1 ? 's' : ''}</p></div></header><div className="panel p-4"><h2 className="font-bold">NOUVELLE ARRIVÉE</h2><label className="mt-3 block text-sm font-semibold">Nombre de personnes<input aria-label="Nombre de personnes" inputMode="numeric" pattern="[0-9]*" value={people} onChange={(event) => setPeople(normalizePositiveInput(event.target.value))} placeholder="8" className="mt-2 block w-full rounded-xl bg-zinc-800 p-3 text-xl font-bold outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /></label><label className="mt-3 block text-sm font-semibold">Note <span className="font-normal text-zinc-400">(facultative)</span><textarea aria-label="Note arrivée promoteur" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Deux groupes invités" className="mt-2 block min-h-20 w-full rounded-xl bg-zinc-800 p-3 outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /></label><button disabled={!validPeople || saving} onClick={() => void submit()} className="mt-3 rounded-xl bg-fuchsia-600 px-5 py-3 font-bold disabled:opacity-40">{saving ? 'Enregistrement…' : 'ENREGISTRER L’ARRIVÉE'}</button></div><h2 className="mt-5 font-bold">HISTORIQUE</h2><div className="mt-3 grid gap-3">{summary.activities.length > 0 ? summary.activities.map((event) => editingEventId === event.id ? <PromoterActivityEditor key={event.id} event={event} saving={saving} onCancel={() => setEditingEventId(null)} onSave={async (value, eventNote) => { const saved = await onUpdate(event, value, eventNote); if (saved) setEditingEventId(null); return saved; }} /> : <article className="panel p-4" key={event.id}><div className="flex gap-3"><p className="mr-auto text-sm text-zinc-400">{dateTime(event.created_at)}</p><button onClick={() => setEditingEventId(event.id)} className="text-sm text-violet-300">Modifier</button><button disabled={saving} onClick={() => void onDeleteActivity(event)} className="text-sm text-red-300 disabled:opacity-40">Supprimer</button></div><p className="mt-2 text-xl font-bold">+{event.people_added} personnes</p>{event.note && <p className="mt-2 text-sm text-zinc-300">{event.note}</p>}</article>) : <p className="text-sm text-zinc-400">Aucune arrivée enregistrée pour ce promoteur.</p>}</div><button disabled={saving} onClick={() => void onDeletePromoter(summary.promoter.id)} className="mt-7 text-sm text-red-300 disabled:opacity-40">Supprimer ce promoteur</button>{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</section>;
}

function normalizePositiveInput(value: string) { if (value === '') return ''; return /^\d+$/.test(value) ? String(Number(value)) : ''; }

function PromoterActivityEditor({ event, saving, onCancel, onSave }: { event: PromoterCountEvent; saving: boolean; onCancel: () => void; onSave: (people: number, note: string) => Promise<boolean> }) {
  const [people, setPeople] = useState(String(event.people_added)); const [note, setNote] = useState(event.note ?? ''); const validPeople = positiveInteger(people);
  return <article className="panel p-4"><p className="text-sm text-zinc-400">{dateTime(event.created_at)}</p><label className="mt-2 block text-sm font-semibold">Nombre de personnes<input aria-label="Modifier arrivée promoteur" inputMode="numeric" pattern="[0-9]*" value={people} onChange={(item) => setPeople(normalizePositiveInput(item.target.value))} className="mt-2 block w-full rounded-lg bg-zinc-800 p-2 text-xl font-bold" /></label><label className="mt-3 block text-sm font-semibold">Note<textarea aria-label="Modifier note arrivée promoteur" value={note} maxLength={500} onChange={(item) => setNote(item.target.value)} className="mt-2 block min-h-20 w-full rounded-lg bg-zinc-800 p-2" /></label><div className="mt-3 flex gap-2"><button disabled={!validPeople || saving} onClick={() => validPeople && void onSave(validPeople, note)} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-bold disabled:opacity-40">Enregistrer</button><button disabled={saving} onClick={onCancel} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold">Annuler</button></div></article>;
}

function NoteEditor({ note, onCancel, onSave }: { note: FloorNote; onCancel: () => void; onSave: (note: FloorNote, content: string) => Promise<void> }) { const [content, setContent] = useState(note.content); return <><textarea aria-label="Modifier note Piste" value={content} onChange={(event) => setContent(event.target.value)} className="min-h-20 w-full rounded-xl bg-zinc-800 p-3" /><div className="mt-2 flex gap-2"><button onClick={() => void onSave(note, content)} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-bold">Enregistrer</button><button onClick={onCancel} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold">Annuler</button></div></>; }
function EntryEditor({ entry, onCancel, onSave }: { entry: ClubEntryCount; onCancel: () => void; onSave: (entry: ClubEntryCount, count: number) => Promise<void> }) { const [input, setInput] = useState(String(entry.count)); return <article className="panel p-3"><p className="text-sm text-zinc-400">{dateTime(entry.recorded_at)}</p><input aria-label="Corriger relevé" type="number" min="0" inputMode="numeric" value={input} onFocus={() => { if (nonNegative(Number(input)) === 0) setInput(''); }} onChange={(event) => setInput(event.target.value)} onBlur={() => { if (input === '') setInput('0'); }} className="mt-2 w-full rounded-lg bg-zinc-800 p-2 text-xl font-bold" /><div className="mt-2 flex gap-2"><button onClick={() => void onSave(entry, nonNegative(Number(input)))} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-bold">Enregistrer</button><button onClick={onCancel} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold">Annuler</button></div></article>; }
