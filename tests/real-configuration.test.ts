import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0008_real_operational_configuration.sql'), 'utf8');
const live = readFileSync(resolve(process.cwd(), 'components/live-dashboard.tsx'), 'utf8');

describe('configuration opérationnelle réelle', () => {
  it('préserve les tables et CDR précédents en les désactivant', () => {
    expect(migration).toContain('update public.head_waiters set active = false');
    expect(migration).toContain('update public.tables set active = false where active = true');
    expect(migration).not.toContain('delete from public.tables');
    expect(migration).not.toContain('delete from public.head_waiters');
    expect(migration).not.toContain('delete from public.table_visits');
  });

  it('crée les quatre carrés et leurs capacités réelles', () => {
    expect(migration).toContain("('Carré 1', 1, 230::smallint)");
    expect(migration).toContain("('Carré 2', 2, 230::smallint)");
    expect(migration).toContain("('Carré 3', 3, 135::smallint)");
    expect(migration).toContain("('Backstage', 4, 90::smallint)");
    expect(migration).toContain("<> 685 then raise exception 'Zone capacity total is invalid'");
  });

  it('attend exactement 72 tables actives et 9 CDR actifs', () => {
    expect(migration).toContain("<> 72 then raise exception 'Expected 72 active tables'");
    expect(migration).toContain("<> 9 then raise exception 'Expected 9 active head waiters'");
  });

  it('valide la répartition 24 / 24 / 15 / 9', () => {
    expect(migration).toContain("<> 24 then raise exception 'Carré 1 allocation is invalid'");
    expect(migration).toContain("<> 24 then raise exception 'Carré 2 allocation is invalid'");
    expect(migration).toContain("<> 15 then raise exception 'Carré 3 allocation is invalid'");
    expect(migration).toContain("<> 9 then raise exception 'Backstage allocation is invalid'");
  });

  it('attribue les tables aux neuf CDR selon la configuration demandée', () => {
    for (const name of ['Samir', 'Alhan', 'Matteo', 'Bastien', 'Amor', 'Alan', 'Alissia', 'Luigi', 'Steven']) {
      expect(migration).toContain(`('${name}'`);
    }
    expect(migration).toContain("(3, 'Luigi'::text, ''::text, 7)");
    expect(migration).toContain("(4, 'Steven'::text, ''::text, 9)");
    expect(migration).toContain("'Samir allocation is invalid'");
    expect(migration).toContain("'Luigi allocation is invalid'");
    expect(migration).toContain("'Steven allocation is invalid'");
  });

  it('utilise une capacité standard de sept personnes par nouvelle table', () => {
    expect(migration).toContain('head_waiter_id, standard_capacity, position_x');
    expect(migration).toContain('\n  7,\n  0,');
  });

  it('fait dépendre le statut LIVE de la capacité maximale de zone', () => {
    expect(live).toContain('clients >= maxCapacity');
    expect(live).toContain('zone.max_capacity');
  });
});
