import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0012_floor_promoters_and_entry_counts.sql'), 'utf8');
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
    expect(operations).toContain('disabled={value === 0}');
  });

  it('conserve chaque relevé cumulatif Entrées club et permet sa correction', () => {
    expect(migration).toContain('create table public.club_entry_counts');
    expect(migration).toContain('recorded_at timestamptz not null default now()');
    expect(migration).toContain('update_club_entry_count');
    expect(migration).toContain('delete_club_entry_count');
    expect(operations).toContain('Enregistrer le relevé');
    expect(operations).toContain('Le total est inférieur au dernier relevé');
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
});
