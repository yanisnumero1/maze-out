import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0024_require_positive_table_people.sql');
const hostess = file('components/hostess-console.tsx');

describe('personnes obligatoires pour les opérations de table', () => {
  it('refuse une arrivée à zéro côté RPC et table de base', () => {
    expect(migration).toContain('create trigger arrival_drafts_require_people');
    expect(migration).toContain('create or replace function public.prepare_arrival_draft');
    expect(migration).toContain("if coalesce(p_present_people, 0) + coalesce(p_extra_guests, 0) < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.';");
  });

  it('refuse la confirmation d’un brouillon existant à zéro', () => {
    expect(migration).toContain('create or replace function public.confirm_arrival_draft');
    expect(migration).toContain("if v_draft.present_people + v_draft.extra_guests < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.';");
  });

  it('refuse un transfert dont la visite source contient zéro personne', () => {
    expect(migration).toContain('create or replace function public.transfer_operational_table');
    expect(migration).toContain("if v_visit.present_people + v_visit.extra_guests < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.';");
  });

  it('empêche aussi toute création ou mise à jour directe de visite à zéro', () => {
    expect(migration).toContain('create trigger table_visits_require_people');
    expect(migration).toContain('before insert or update of present_people, extra_guests on public.table_visits');
    expect(migration).toContain('coalesce(new.present_people, 0) + coalesce(new.extra_guests, 0) < 1');
  });

  it('désactive arrivée, revente, modification et transfert tant que le total est inférieur à un', () => {
    expect(hostess).toContain('const hasPeople = present + extras >= 1;');
    expect(hostess).toContain('disabled={!hasPeople}');
    expect(hostess).toContain('disabled={transferBusy || !hasPeople}');
    expect(hostess).toContain('Le nombre de personnes doit être au moins égal à 1.');
    expect(hostess).toContain("if (present + extras < 1) return setNotice('Le nombre de personnes doit être au moins égal à 1.');");
  });
});
