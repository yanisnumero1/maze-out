import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0017_arrival_drafts_active_session.sql'), 'utf8');
const live = readFileSync(resolve(process.cwd(), 'components/live-dashboard.tsx'), 'utf8');
const hostess = readFileSync(resolve(process.cwd(), 'components/hostess-console.tsx'), 'utf8');

describe('visibilité et annulation des brouillons d’arrivée', () => {
  it('rattache chaque nouveau brouillon à la soirée active pour ne pas le mélanger avec une ancienne soirée', () => {
    expect(migration).toContain('add column if not exists night_session_id uuid');
    expect(migration).toContain('v_night_id := public.open_night_session()');
    expect(migration).toContain('night_session_id, present_people');
    expect(migration).toContain("set status = 'cancelled'");
  });

  it('annule un brouillon sans toucher aux occupations, visites ou ventes', () => {
    const cancel = migration.slice(migration.indexOf('cancel_arrival_draft'), migration.indexOf('close_current_night_session'));
    expect(cancel).toContain("set status = 'cancelled'");
    expect(cancel).toContain("status = 'draft'");
    expect(cancel).not.toContain('occupancies');
    expect(cancel).not.toContain('table_visits');
    expect(cancel).not.toContain('delete from public.arrival_drafts');
  });

  it('réserve lecture et annulation aux rôles opérationnels, uniquement pour une session active côté Hôtesse', () => {
    expect(migration).toContain("public.current_role() not in ('admin', 'hostess')");
    expect(migration).toContain('hostess reads active arrival drafts');
    expect(migration).toContain('public.is_active_night_session(night_session_id)');
    expect(migration).toContain('grant execute on function public.cancel_arrival_draft(uuid) to authenticated');
  });

  it('affiche les brouillons actifs, par ancienneté, et les met à jour en temps réel sur le Live', () => {
    expect(live).toContain("from('arrival_drafts')");
    expect(live).toContain(".eq('night_session_id', nightId)");
    expect(live).toContain(".order('created_at', { ascending: true })");
    expect(live).toContain('Arrivées en attente · {drafts.length}');
    expect(live).toContain("table: 'arrival_drafts'");
    expect(live).toContain('/hostess?draft=');
  });

  it('ouvre le brouillon demandé directement et exige une confirmation avant annulation', () => {
    expect(hostess).toContain("searchParams.get('draft')");
    expect(hostess).toContain("rpc('cancel_arrival_draft'");
    expect(hostess).toContain('Annuler cette arrivée en attente ?');
    expect(hostess).toContain('Le brouillon de la Table');
    expect(hostess).toContain('Annuler l’arrivée');
  });
});
