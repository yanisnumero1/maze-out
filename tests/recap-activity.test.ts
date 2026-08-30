import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recapActivity } from '@/lib/recap-activity';

const zone = { id: 'z1', name: 'Carré 1', display_order: 1, active: true };
const waiter = { id: 'w1', first_name: 'Samir', last_name: '', color: null, active: true };
const base = {
  visits: [], transfers: [], notes: [], promoterEvents: [], promoters: [], entryCounts: [], tableNumbers: new Map([['t1', 12], ['t2', 15]]),
};
const audit = (id: string, action_type: string, entity_type: string, entity_id: string, created_at: string, actor_id = 'pauline') => ({ id, action_type, entity_type, entity_id, created_at, actor_id, night_session_id: 'night-a', before_data: null, after_data: null, metadata: null });

describe('activité récente du récapitulatif', () => {
  it('priorise le journal d’audit et trie les événements du plus récent au plus ancien', () => {
    const rows = recapActivity({ ...base, audits: [audit('a1', 'floor_note.created', 'floor_note', 'n1', '2026-08-30T03:21:00Z'), audit('a2', 'night.closed', 'night_session', 'night-a', '2026-08-30T04:52:00Z', 'admin')] });
    expect(rows.map((row) => row.title)).toEqual(['Soirée clôturée', 'Note Piste ajoutée']);
    expect(rows[0].actorId).toBe('admin');
  });

  it('évite le doublon audit + donnée métier pour une note et conserve le fallback historique', () => {
    const note = { id: 'n1', night_session_id: 'night-a', content: 'Ancienne note', created_by: null, created_at: '2026-08-30T01:00:00Z', updated_at: '2026-08-30T01:00:00Z' };
    const withAudit = recapActivity({ ...base, audits: [audit('a1', 'floor_note.created', 'floor_note', 'n1', '2026-08-30T01:01:00Z')], notes: [note] });
    const historical = recapActivity({ ...base, audits: [], notes: [note] });
    expect(withAudit).toHaveLength(1);
    expect(historical).toMatchObject([{ title: 'Note Piste ajoutée', actorId: null }]);
  });

  it('rend les événements auditables pour tables, transferts, promoteurs et entrées club', () => {
    const events = recapActivity({ ...base, audits: [
      audit('a1', 'table.arrival_confirmed', 'table', 't1', '2026-08-30T01:00:00Z'),
      audit('a2', 'promoter.activity_added', 'promoter_activity', 'p1', '2026-08-30T01:01:00Z'),
      audit('a3', 'club_entry.created', 'club_entry', 'e1', '2026-08-30T01:02:00Z'),
    ].map((row, index) => index === 1 ? { ...row, after_data: { promoter_id: 'p1', people_added: 8 } } : index === 2 ? { ...row, after_data: { count: 5 } } : row), promoters: [{ id: 'p1', night_session_id: 'night-a', name: 'Yanis', normalized_name: 'yanis', entry_count: 8, created_by: null, created_at: '', updated_at: '' }] });
    expect(events.map((event) => event.title)).toEqual(expect.arrayContaining(['Table 12 · Arrivée installée', 'Promoteur Yanis · +8 personnes', 'Entrées club · 5 personnes']));
  });

  it('conserve le CSV et garde la page Réca​p administrateur uniquement', () => {
    const recap = readFileSync(resolve(process.cwd(), 'components/recap-console.tsx'), 'utf8');
    const page = readFileSync(resolve(process.cwd(), 'app/recap/page.tsx'), 'utf8');
    expect(recap).toContain("anchor.download = 'maze-out-recap-'");
    expect(page).toContain('<AuthGate requireAdmin>');
    expect(recap).toContain('ACTIVITÉ RÉCENTE');
    expect(recap).toContain('Voir toute l’activité');
  });
});
