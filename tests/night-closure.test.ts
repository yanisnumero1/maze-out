import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0007_atomic_night_closure.sql'), 'utf8');
const recap = readFileSync(resolve(process.cwd(), 'components/recap-console.tsx'), 'utf8');

describe('clôture atomique de soirée', () => {
  it('ferme les visites avant de réinitialiser les occupations', () => {
    expect(migration.indexOf('update public.table_visits')).toBeLessThan(migration.indexOf('update public.occupancies'));
    expect(migration).toContain("where night_session_id = v_id and ended_at is null");
  });

  it('clôture la session active dans la même fonction', () => {
    expect(migration).toContain('create or replace function public.close_current_night_session()');
    expect(migration).toContain('update public.night_sessions');
    expect(migration).toContain('set ended_at = now()');
  });

  it('remet présents, invités et commentaire opérationnel à zéro sans suppression', () => {
    expect(migration).toContain('set present_people = 0');
    expect(migration).toContain('extra_guests = 0');
    expect(migration).toContain('comment = null');
    expect(migration).not.toContain('delete from public.occupancies');
  });

  it('conserve les réservations en les marquant completed', () => {
    expect(migration).toContain("add value if not exists 'completed'");
    expect(migration).toContain("set status = 'completed'");
    expect(migration).not.toContain('delete from public.reservations');
  });

  it('réserve la procédure SQL à un admin', () => {
    expect(migration).toContain("public.current_role() <> 'admin'");
    expect(migration).toContain("raise exception 'Admin access required'");
  });

  it('demande confirmation dans l’interface avant clôture', () => {
    expect(recap).toContain('Clôturer la soirée ?');
    expect(recap).toContain('Cette action va figer le récapitulatif');
    expect(recap).toContain('Annuler');
  });
});
