import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0010_table_capacities_and_zone_limits.sql'), 'utf8');
const hostess = readFileSync(resolve(process.cwd(), 'components/hostess-console.tsx'), 'utf8');

describe('capacités opérationnelles des tables', () => {
  it('ajoute les limites de personnes et invités sans modifier l’historique', () => {
    expect(migration).toContain('add column if not exists max_people');
    expect(migration).toContain('add column if not exists max_extra_guests');
    expect(migration).not.toContain('delete from public.table_visits');
    expect(migration).not.toContain('update public.night_sessions');
  });

  it('configure les capacités spéciales demandées', () => {
    expect(migration).toContain('display_number in (70, 71) then 10 else 7');
    expect(migration).toContain('display_number in (4, 6, 7, 8, 12, 14, 15, 16, 26, 31, 36, 38, 39, 41, 44, 52, 65, 70, 71) then 3 else 0');
    expect(migration).toContain("'Table 70 capacity is invalid'");
    expect(migration).toContain("'Table 71 capacity is invalid'");
    expect(migration).toContain("'Table 52 capacity is invalid'");
  });

  it('met à jour les capacités indépendantes des quatre carrés', () => {
    expect(migration).toContain('(1, 264::smallint)');
    expect(migration).toContain('(2, 261::smallint)');
    expect(migration).toContain('(3, 138::smallint)');
    expect(migration).toContain('(4, 101::smallint)');
  });

  it('refuse aussi côté Supabase les dépassements de capacité', () => {
    expect(migration).toContain('create or replace function public.validate_occupancy_limits()');
    expect(migration).toContain("raise exception 'present_people exceeds table capacity'");
    expect(migration).toContain("raise exception 'extra_guests exceeds table guest capacity'");
  });

  it('borne la saisie Hôtesse et désactive le bouton plus à la limite', () => {
    expect(hostess).toContain('const clamp =');
    expect(hostess).toContain('disabled={value >= max}');
    expect(hostess).toContain('max_extra_guests ?? 0');
    expect(hostess).toContain('type="number"');
  });

  it('préserve les affectations actives corrigées', () => {
    expect(migration).toContain("first_name = 'Matheo'");
    expect(migration).toContain("first_name = 'Allan'");
    expect(migration).toContain('display_number between 17 and 24');
    expect(migration).toContain('display_number between 41 and 48');
  });
});
