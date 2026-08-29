import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0012_floor_promoters_and_entry_counts.sql'), 'utf8');
const correction = readFileSync(resolve(process.cwd(), 'supabase/migrations/0013_lot4_access_and_promoter_delete.sql'), 'utf8');
const operations = readFileSync(resolve(process.cwd(), 'components/hostess-operations.tsx'), 'utf8');

describe('Lot 4 — opérations de soirée', () => {
  it('historise les notes Piste et les isole par night session', () => {
    expect(migration).toContain('create table public.floor_notes');
    expect(migration).toContain('night_session_id uuid not null references public.night_sessions');
    expect(migration).toContain('create or replace function public.add_floor_note');
    expect(migration).toContain('update_floor_note');
    expect(migration).toContain('delete_floor_note');
    expect(operations).toContain("from('floor_notes').select('*').eq('night_session_id', currentNight)");
  });

  it('protège les promoteurs des doublons et des valeurs négatives', () => {
    expect(migration).toContain('unique (night_session_id, normalized_name)');
    expect(migration).toContain("lower(regexp_replace(btrim(coalesce(p_name, '')), '\\s+', ' ', 'g'))");
    expect(migration).toContain("raise exception 'Promoter count cannot be negative'");
    expect(migration).toContain('promoter_count_events');
    expect(operations).toContain('TOTAL PROMOTEURS');
    expect(operations).toContain('disabled={current === 0}');
  });

  it('conserve chaque ajout Entrées club et permet sa correction', () => {
    expect(migration).toContain('create table public.club_entry_counts');
    expect(migration).toContain('recorded_at timestamptz not null default now()');
    expect(migration).toContain('update_club_entry_count');
    expect(migration).toContain('delete_club_entry_count');
    expect(operations).toContain('Enregistrer le relevé');
    expect(operations).toContain('TOTAL ENTRÉES CLUB');
    expect(operations).toContain('entries.reduce((total, entry) => total + entry.count, 0)');
    expect(operations).toContain('Derniers relevés');
  });

  it('garde les anciennes données et prévoit les index de consultation', () => {
    expect(migration).toContain('on delete restrict');
    expect(migration).toContain('floor_notes_night_created_idx');
    expect(migration).toContain('club_entry_counts_night_recorded_idx');
    expect(migration).not.toContain('delete from public.night_sessions');
  });

  it('réserve l’écriture aux rôles opérationnels et conserve Realtime', () => {
    expect(migration).toContain("public.current_role() not in ('admin', 'hostess')");
    expect(migration).toContain('hostess reads active floor notes');
    expect(migration).toContain('hostess reads active promoters');
    expect(migration).toContain('hostess reads active club entry counts');
    expect(operations).toContain("table: 'floor_notes'");
    expect(operations).toContain("table: 'promoters'");
    expect(operations).toContain("table: 'club_entry_counts'");
  });

  it('recharge les listes Supabase sans les vider pendant une synchronisation', () => {
    expect(operations).toContain("from('floor_notes').select('*').eq('night_session_id', currentNight).order('created_at', { ascending: false })");
    expect(operations).toContain("from('promoters').select('*').eq('night_session_id', currentNight).order('name')");
    expect(operations).toContain("from('club_entry_counts').select('*').eq('night_session_id', currentNight).order('recorded_at', { ascending: false })");
    expect(operations).toContain('notes.length > 0 ? notes.map');
    expect(operations).toContain('entries.length > 0 ? entries.map');
    expect(operations).toContain('setLoading(false)');
  });

  it('affiche les erreurs Supabase au lieu de les présenter comme des listes vides', () => {
    expect(operations).toContain('Impossible de charger les données :');
    expect(operations).toContain("if (error) return setNotice(error.message)");
    expect(operations).toContain('console.error');
  });

  it('trace chaque RPC et met à jour la liste avant le SELECT de confirmation', () => {
    for (const rpc of ['add_floor_note', 'update_floor_note', 'delete_floor_note', 'add_promoter', 'set_promoter_count', 'delete_promoter', 'record_club_entry_count', 'update_club_entry_count', 'delete_club_entry_count']) {
      expect(operations).toContain('RPC ' + rpc);
    }
    expect(operations).toContain('Listes Supabase chargées.');
    expect(operations).toContain('setNotes((rows) => [data as FloorNote');
    expect(operations).toContain('setPromoters((rows) => [...rows.filter');
    expect(operations).toContain('setEntries((rows) => [result.data as ClubEntryCount');
  });

  it('permet la suppression confirmée d’un promoteur et accorde les accès API requis', () => {
    expect(correction).toContain('create or replace function public.delete_promoter');
    expect(correction).toContain('grant select on public.floor_notes, public.promoters');
    expect(correction).toContain('grant execute on function public.current_operational_night_session() to authenticated');
    expect(operations).toContain("supabase.rpc('delete_promoter'");
    expect(operations).toContain('Supprimer ce promoteur');
  });
});
