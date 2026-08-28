import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const recap = readFileSync(resolve(process.cwd(), 'components/recap-console.tsx'), 'utf8');

describe('historique des soirées', () => {
  it('récupère toutes les soirées de la plus récente à la plus ancienne', () => {
    expect(recap).toContain(".from('night_sessions').select('*').order('started_at', { ascending: false })");
  });

  it('sépare la session active des sessions clôturées', () => {
    expect(recap).toContain("sessions.find((session) => !session.ended_at)");
    expect(recap).toContain("sessions.filter((session) => session.ended_at)");
  });

  it('calcule chaque historique depuis table_visits et jamais depuis occupancies', () => {
    expect(recap).toContain(".from('table_visits')");
    expect(recap).not.toContain(".from('occupancies')");
    expect(recap).toContain('night_session_id === session.id');
  });

  it('exporte les lignes historiques avec carré, CDR, table et horaires', () => {
    expect(recap).toContain("['date', 'carré', 'CDR', 'table', 'vente', 'personnes', 'invités', 'total', 'arrivée', 'fin']");
    expect(recap).toContain('formatTime(visit.arrived_at)');
    expect(recap).toContain('formatTime(visit.ended_at)');
  });
});
