'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ClubEntryCount, FloorNote, Promoter } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';

type OperationView = 'piste' | 'promoteurs' | 'entrees';
const dateTime = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const nonNegative = (value: number) => Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);

export function HostessOperations({ view }: { view: OperationView }) {
  const [notes, setNotes] = useState<FloorNote[]>([]);
  const [promoters, setPromoters] = useState<Promoter[]>([]);
  const [entries, setEntries] = useState<ClubEntryCount[]>([]);
  const [noteText, setNoteText] = useState('');
  const [promoterName, setPromoterName] = useState('');
  const [entryValue, setEntryValue] = useState('');
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  async function refresh() {
    const { data: currentNight, error: nightError } = await supabase.rpc('current_operational_night_session');
    if (nightError) { console.error('[OPERATIONS] Soirée active introuvable.', nightError); setNotice(nightError.message); return; }
    if (!currentNight) { setNotes([]); setPromoters([]); setEntries([]); return; }
    const [{ data: noteRows, error: notesError }, { data: promoterRows, error: promotersError }, { data: entryRows, error: entriesError }] = await Promise.all([
      supabase.from('floor_notes').select('*').eq('night_session_id', currentNight).order('created_at', { ascending: false }),
      supabase.from('promoters').select('*').eq('night_session_id', currentNight).order('name'),
      supabase.from('club_entry_counts').select('*').eq('night_session_id', currentNight).order('recorded_at', { ascending: false }),
    ]);
    if (notesError || promotersError || entriesError) console.error('[OPERATIONS] Chargement impossible.', { notesError, promotersError, entriesError });
    setNotes((noteRows ?? []) as FloorNote[]);
    setPromoters((promoterRows ?? []) as Promoter[]);
    setEntries((entryRows ?? []) as ClubEntryCount[]);
  }

  useEffect(() => {
    void refresh();
    const channel = supabase.channel('hostess-operations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_notes' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'promoters' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'club_entry_counts' }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  async function addNote() {
    const { error } = await supabase.rpc('add_floor_note', { p_content: noteText });
    if (error) return setNotice(error.message);
    setNoteText(''); setNotice(''); await refresh();
  }
  async function saveNote(note: FloorNote, content: string) {
    const { error } = await supabase.rpc('update_floor_note', { p_note_id: note.id, p_content: content });
    if (error) return setNotice(error.message);
    setEditingNote(null); setNotice(''); await refresh();
  }
  async function deleteNote(id: string) {
    if (!window.confirm('Supprimer cette note Piste ?')) return;
    const { error } = await supabase.rpc('delete_floor_note', { p_note_id: id });
    if (error) return setNotice(error.message);
    setNotice(''); await refresh();
  }
  async function addPromoter() {
    const { error } = await supabase.rpc('add_promoter', { p_name: promoterName });
    if (error) return setNotice(error.message);
    setPromoterName(''); setNotice(''); await refresh();
  }
  async function setPromoter(promoter: Promoter, value: number) {
    const { error } = await supabase.rpc('set_promoter_count', { p_promoter_id: promoter.id, p_entry_count: nonNegative(value) });
    if (error) return setNotice(error.message);
    setNotice(''); await refresh();
  }
  async function saveEntry(existing?: ClubEntryCount, requestedCount?: number) {
    const count = nonNegative(requestedCount ?? Number(entryValue));
    const latest = entries[0];
    if (!existing && latest && count < latest.count && !window.confirm('Le total est inférieur au dernier relevé. Enregistrer quand même ?')) return;
    const result = existing
      ? await supabase.rpc('update_club_entry_count', { p_entry_count_id: existing.id, p_count: count })
      : await supabase.rpc('record_club_entry_count', { p_count: count });
    if (result.error) return setNotice(result.error.message);
    setEntryValue(''); setEditingEntry(null); setNotice(''); await refresh();
  }
  async function deleteEntry(id: string) {
    if (!window.confirm('Supprimer ce relevé Entrées club ?')) return;
    const { error } = await supabase.rpc('delete_club_entry_count', { p_entry_count_id: id });
    if (error) return setNotice(error.message);
    setNotice(''); await refresh();
  }

  const promoterTotal = useMemo(() => promoters.reduce((total, promoter) => total + promoter.entry_count, 0), [promoters]);
  const latestEntry = entries[0];
  const reminder = latestEntry && Date.now() - new Date(latestEntry.recorded_at).getTime() >= 30 * 60 * 1000;

  if (view === 'piste') return <section><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Opérations</p><h1 className="text-3xl font-black">PISTE</h1></header><div className="panel p-4"><textarea aria-label="Ajouter une note Piste" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Ajouter une note Piste..." className="min-h-24 w-full rounded-xl bg-zinc-800 p-3 outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /><button disabled={!noteText.trim()} onClick={() => void addNote()} className="mt-3 rounded-xl bg-fuchsia-600 px-5 py-3 font-bold disabled:opacity-40">Ajouter</button></div><div className="mt-4 grid gap-3">{notes.length === 0 ? <p className="text-sm text-zinc-400">Aucune note pour la soirée active.</p> : notes.map((note) => <article className="panel p-4" key={note.id}>{editingNote === note.id ? <NoteEditor note={note} onCancel={() => setEditingNote(null)} onSave={saveNote} /> : <><div className="flex gap-3"><p className="mr-auto text-sm text-zinc-400">{dateTime(note.created_at)}</p><button onClick={() => setEditingNote(note.id)} className="text-sm text-violet-300">Modifier</button><button onClick={() => void deleteNote(note.id)} className="text-sm text-red-300">Supprimer</button></div><p className="mt-2">{note.content}</p></>}</article>)}</div>{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</section>;

  if (view === 'promoteurs') return <section><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Opérations</p><h1 className="text-3xl font-black">PROMOTEURS</h1><p className="mt-2 text-zinc-400">TOTAL PROMOTEURS · <b className="text-white">{promoterTotal} personnes</b></p></header><div className="panel flex gap-3 p-4"><input aria-label="Nom du promoteur" value={promoterName} onChange={(event) => setPromoterName(event.target.value)} placeholder="Nom du promoteur" className="min-w-0 flex-1 rounded-xl bg-zinc-800 px-3 outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /><button disabled={!promoterName.trim()} onClick={() => void addPromoter()} className="rounded-xl bg-fuchsia-600 px-4 py-3 font-bold disabled:opacity-40">Ajouter</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{promoters.map((promoter) => <PromoterCard promoter={promoter} onSave={setPromoter} key={promoter.id} />)}</div>{promoters.length === 0 && <p className="mt-4 text-sm text-zinc-400">Aucun promoteur pour la soirée active.</p>}{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</section>;

  return <section><header className="mb-5"><p className="text-sm uppercase tracking-[.25em] text-fuchsia-400">Opérations</p><h1 className="text-3xl font-black">ENTRÉES CLUB</h1>{latestEntry ? <p className="mt-2 text-zinc-400">Dernier relevé : {dateTime(latestEntry.recorded_at)} — {latestEntry.count} entrées</p> : <p className="mt-2 text-zinc-400">Aucun relevé pour la soirée active.</p>}{reminder && <p className="mt-2 text-sm text-violet-200">Un nouveau relevé peut être effectué.</p>}</header><div className="panel p-4"><label className="text-sm font-semibold">Entrées club<input aria-label="Entrées club" inputMode="numeric" type="number" min="0" value={entryValue} onChange={(event) => setEntryValue(event.target.value)} className="mt-2 block w-full rounded-xl bg-zinc-800 p-3 text-xl font-bold outline-none ring-1 ring-zinc-700 focus:ring-violet-400" /></label><button onClick={() => void saveEntry()} className="mt-3 rounded-xl bg-fuchsia-600 px-5 py-3 font-bold">Enregistrer le relevé</button></div><div className="mt-4"><h2 className="font-bold">Derniers relevés</h2><div className="mt-3 grid gap-2">{entries.map((entry) => editingEntry === entry.id ? <EntryEditor entry={entry} onCancel={() => { setEditingEntry(null); setEntryValue(''); }} onSave={(item, count) => saveEntry(item, count)} key={entry.id} /> : <article className="panel flex items-center gap-3 p-3" key={entry.id}><span className="text-zinc-400">{dateTime(entry.recorded_at)}</span><b className="mr-auto text-xl">{entry.count}</b><button onClick={() => { setEditingEntry(entry.id); setEntryValue(String(entry.count)); }} className="text-sm text-violet-300">Modifier</button><button onClick={() => void deleteEntry(entry.id)} className="text-sm text-red-300">Supprimer</button></article>)}</div></div>{notice && <p className="mt-4 text-sm text-red-300">{notice}</p>}</section>;
}

function NoteEditor({ note, onCancel, onSave }: { note: FloorNote; onCancel: () => void; onSave: (note: FloorNote, content: string) => Promise<void> }) {
  const [content, setContent] = useState(note.content);
  return <><textarea aria-label="Modifier note Piste" value={content} onChange={(event) => setContent(event.target.value)} className="min-h-20 w-full rounded-xl bg-zinc-800 p-3" /><div className="mt-2 flex gap-2"><button onClick={() => void onSave(note, content)} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-bold">Enregistrer</button><button onClick={onCancel} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold">Annuler</button></div></>;
}

function PromoterCard({ promoter, onSave }: { promoter: Promoter; onSave: (promoter: Promoter, value: number) => Promise<void> }) {
  const [value, setValue] = useState(promoter.entry_count);
  useEffect(() => setValue(promoter.entry_count), [promoter.entry_count]);
  const commit = (next: number) => { const safe = nonNegative(next); setValue(safe); void onSave(promoter, safe); };
  return <article className="panel p-4"><b className="text-xl">{promoter.name}</b><div className="mt-4 flex items-center justify-between gap-3"><button onClick={() => commit(value - 1)} disabled={value === 0} className="h-11 w-11 rounded-lg bg-zinc-800 text-2xl disabled:opacity-40">−</button><input aria-label={'Compteur ' + promoter.name} type="number" min="0" inputMode="numeric" value={value} onChange={(event) => setValue(nonNegative(Number(event.target.value)))} onBlur={() => void onSave(promoter, value)} className="h-11 w-24 rounded-lg bg-zinc-800 text-center text-xl font-bold outline-none ring-1 ring-zinc-700" /><button onClick={() => commit(value + 1)} className="h-11 w-11 rounded-lg bg-fuchsia-600 text-2xl">+</button></div></article>;
}

function EntryEditor({ entry, onCancel, onSave }: { entry: ClubEntryCount; onCancel: () => void; onSave: (entry: ClubEntryCount, count: number) => Promise<void> }) {
  const [value, setValue] = useState(entry.count);
  return <article className="panel p-3"><p className="text-sm text-zinc-400">{dateTime(entry.recorded_at)}</p><input aria-label="Corriger relevé" type="number" min="0" inputMode="numeric" value={value} onChange={(event) => setValue(nonNegative(Number(event.target.value)))} className="mt-2 w-full rounded-lg bg-zinc-800 p-2 text-xl font-bold" /><div className="mt-2 flex gap-2"><button onClick={() => void onSave(entry, value)} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-bold">Enregistrer</button><button onClick={onCancel} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold">Annuler</button></div></article>;
}
