import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { promoterActivitySummaries, promoterActivityTotal, promoterArrivalCount } from '@/lib/promoters';
import type { Promoter, PromoterCountEvent } from '@/lib/types';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0020_promoter_activity_journal.sql'), 'utf8');
const operations = readFileSync(resolve(process.cwd(), 'components/hostess-operations.tsx'), 'utf8');

const promoter: Promoter = { id: 'promoter-a', night_session_id: 'night-a', name: 'Yanis', normalized_name: 'yanis', entry_count: 13, created_by: null, created_at: '2026-08-30T20:00:00.000Z', updated_at: '2026-08-30T20:15:00.000Z' };
const activity = (id: string, people: number | null, createdAt: string): PromoterCountEvent => ({ id, promoter_id: 'promoter-a', night_session_id: 'night-a', previous_count: 0, next_count: people ?? 0, people_added: people, note: people === null ? null : 'note', changed_by: null, created_at: createdAt });

describe('Promoteurs — journal incrémental', () => {
  it('garde people_added nullable pour les événements hérités et interdit zéro ou négatif aux nouveaux', () => {
    expect(migration).toContain('add column if not exists people_added integer');
    expect(migration).toContain('people_added is null or people_added > 0');
    expect(migration).toContain('add column if not exists note text');
    expect(migration).toContain('char_length(note) <= 500');
    expect(migration).not.toContain('update public.promoter_count_events set people_added');
  });

  it('crée une activité atomique et protège la concurrence par verrou du promoteur', () => {
    expect(migration).toContain('create or replace function public.add_promoter_activity');
    expect(migration).toContain('from public.promoters where id = p_promoter_id for update');
    expect(migration).toContain('set entry_count = v_next_count');
    expect(migration).toContain('insert into public.promoter_count_events');
    expect(migration).toContain("raise exception 'People added must be greater than zero'");
  });

  it('corrige et supprime seulement les nouvelles activités, en décalant la séquence suivante', () => {
    expect(migration).toContain('create or replace function public.update_promoter_activity');
    expect(migration).toContain('create or replace function public.delete_promoter_activity');
    expect(migration).toContain("raise exception 'Legacy counter events cannot be edited as arrivals'");
    expect(migration).toContain("raise exception 'Legacy counter events cannot be deleted as arrivals'");
    expect(migration).toContain('and people_added is not null');
    expect(migration).toContain('previous_count = previous_count + v_delta');
    expect(migration).toContain('previous_count = previous_count - v_event.people_added');
  });

  it('ne présente jamais les corrections héritées comme des arrivées', () => {
    const events = [activity('legacy', null, '2026-08-30T20:00:00.000Z'), activity('first', 5, '2026-08-30T20:10:00.000Z'), activity('second', 8, '2026-08-30T20:15:00.000Z')];
    const [summary] = promoterActivitySummaries([promoter], events);
    expect(summary.activities.map((event) => event.id)).toEqual(['second', 'first']);
    expect(promoterArrivalCount(events)).toBe(2);
    expect(promoterActivityTotal(events)).toBe(13);
  });

  it('groupe sans requête par promoteur, trie les cartes par total et garde la dernière arrivée', () => {
    const lower: Promoter = { ...promoter, id: 'promoter-b', name: 'Sarah', entry_count: 8 };
    const summaries = promoterActivitySummaries([lower, promoter], [activity('old', 5, '2026-08-30T20:05:00.000Z'), activity('new', 8, '2026-08-30T20:15:00.000Z')]);
    expect(summaries.map((summary) => summary.promoter.name)).toEqual(['Yanis', 'Sarah']);
    expect(summaries[0].lastActivity?.id).toBe('new');
    expect(operations).toContain("from('promoter_count_events').select('*').eq('night_session_id', currentNight)");
    expect(operations).toContain("table: 'promoter_count_events'");
  });

  it('utilise les nouvelles RPC dans la fiche tout en conservant le récapitulatif basé sur entry_count', () => {
    for (const rpc of ['add_promoter_activity', 'update_promoter_activity', 'delete_promoter_activity']) expect(operations).toContain(`RPC ${rpc}`);
    expect(operations).toContain('TOTAL APPORTÉ');
    expect(operations).toContain('HISTORIQUE');
    expect(operations).toContain('ENREGISTRER L’ARRIVÉE');
    expect(operations).toContain('Supprimer cette arrivée ? Le total du promoteur sera recalculé.');
    const recap = readFileSync(resolve(process.cwd(), 'lib/recap.ts'), 'utf8');
    expect(recap).toContain('promoter.entry_count');
  });

  it('accorde seulement les RPC nécessaires aux utilisateurs authentifiés et publie les événements realtime', () => {
    for (const rpc of ['add_promoter_activity(uuid, integer, text)', 'update_promoter_activity(uuid, integer, text)', 'delete_promoter_activity(uuid)']) {
      expect(migration).toContain(`grant execute on function public.${rpc} to authenticated`);
    }
    expect(migration).toContain('alter publication supabase_realtime add table public.promoter_count_events');
    expect(migration).toContain('revoke execute on function public.set_promoter_count(uuid, integer) from authenticated');
    expect(migration).toContain('if auth.uid() is null then raise exception');
    expect(migration).toContain('perform public.assert_active_operational_session');
  });
});
