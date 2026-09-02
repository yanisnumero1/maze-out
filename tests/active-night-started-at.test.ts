import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0019_active_night_started_at.sql'), 'utf8');
const dashboard = readFileSync(resolve(process.cwd(), 'components/live-dashboard.tsx'), 'utf8');

describe('heure de début de la soirée active', () => {
  it('expose seulement started_at de l’unique session active aux rôles opérationnels', () => {
    expect(migration).toContain('current_operational_night_started_at');
    expect(migration).toContain('returns timestamptz');
    expect(migration).toContain("public.current_role() not in ('admin', 'hostess')");
    expect(migration).toContain('where ended_at is null');
    expect(migration).toContain('select started_at into v_started_at');
  });

  it('ne donne pas de droit SELECT supplémentaire sur night_sessions', () => {
    expect(migration).not.toContain('grant select on public.night_sessions');
    expect(migration).toContain('revoke all on function public.current_operational_night_started_at() from public');
    expect(migration).toContain('grant execute on function public.current_operational_night_started_at() to authenticated');
  });

  it('affiche la durée écoulée HH:mm ou aucune soirée, indépendamment du changement de date', () => {
    expect(dashboard).toContain('formatNightElapsed(nightStartedAt, now)');
    expect(dashboard).toContain('String(Math.floor(minutes / 60)).padStart');
    expect(dashboard).toContain('Soirée en cours · ${formatNightElapsed(nightStartedAt, now)}');
    expect(dashboard).toContain('Aucune soirée active');
  });
});
