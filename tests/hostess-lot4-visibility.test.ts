import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const original = readFileSync(resolve(process.cwd(), 'supabase/migrations/0012_floor_promoters_and_entry_counts.sql'), 'utf8');
const history = readFileSync(resolve(process.cwd(), 'supabase/migrations/0006_night_activity_history.sql'), 'utf8');
const correction = readFileSync(resolve(process.cwd(), 'supabase/migrations/0016_fix_hostess_lot4_visibility.sql'), 'utf8');
const operations = readFileSync(resolve(process.cwd(), 'components/hostess-operations.tsx'), 'utf8');

describe('visibilité Lot 4 pour l’Hôtesse', () => {
  it('identifie la dépendance RLS qui bloquait les SELECT Hôtesse', () => {
    expect(original).toContain('exists (select 1 from public.night_sessions n where n.id = night_session_id and n.ended_at is null)');
    expect(history).toContain('admin reads night sessions');
  });

  it('vérifie la soirée active via un helper SECURITY DEFINER', () => {
    expect(correction).toContain('create or replace function public.is_active_night_session');
    expect(correction).toContain('security definer');
    expect(correction).toContain('where id = p_night_session_id');
    expect(correction).toContain('and ended_at is null');
    expect(correction).toContain('grant execute on function public.is_active_night_session(uuid) to authenticated');
  });

  it('autorise la lecture Hôtesse pour les quatre données Lot 4 uniquement pendant la soirée active', () => {
    for (const table of ['public.floor_notes', 'public.promoters', 'public.promoter_count_events', 'public.club_entry_counts']) {
      expect(correction).toContain('on ' + table);
    }
    expect(correction.match(/public\.is_active_night_session\(night_session_id\)/g)).toHaveLength(4);
    expect(correction.match(/public\.current_role\(\) = 'hostess'/g)).toHaveLength(4);
    expect(correction).not.toContain('using (true)');
  });

  it('conserve les opérations partagées par les RPC et les abonnements Realtime', () => {
    for (const rpc of ['add_floor_note', 'add_promoter', 'add_promoter_activity', 'update_promoter_activity', 'delete_promoter_activity', 'record_club_entry_count', 'update_floor_note', 'update_club_entry_count']) {
      expect(operations).toContain(rpc);
    }
    for (const table of ['floor_notes', 'promoters', 'promoter_count_events', 'club_entry_counts']) {
      expect(operations).toContain("table: '" + table + "'");
    }
  });
});
