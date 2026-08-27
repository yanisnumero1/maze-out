import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0009_active_table_display_numbers.sql'), 'utf8');
const hostess = readFileSync(resolve(process.cwd(), 'components/hostess-console.tsx'), 'utf8');
const admin = readFileSync(resolve(process.cwd(), 'components/admin-console.tsx'), 'utf8');

describe('numérotation opérationnelle des tables', () => {
  it('ajoute un attribut métier sans modifier les UUID ou numéros historiques', () => {
    expect(migration).toContain('add column if not exists display_number smallint');
    expect(migration).not.toContain('delete from public.tables');
    expect(migration).not.toContain('update public.tables set number');
  });

  it('garantit 72 numéros actifs uniques et continus', () => {
    expect(migration).toContain('tables_active_display_number_unique');
    expect(migration).toContain("'Expected 72 active tables'");
    expect(migration).toContain("'Active display numbers must be unique'");
    expect(migration).toContain("'Active display numbers contain gaps'");
  });

  it('affecte les intervalles demandés à chaque carré', () => {
    expect(migration).toContain('t.display_number between 1 and 24');
    expect(migration).toContain('t.display_number between 25 and 48');
    expect(migration).toContain('t.display_number between 49 and 63');
    expect(migration).toContain('t.display_number between 64 and 72');
  });

  it('définit les débuts de plage pour les neuf CDR', () => {
    for (const start of [1, 9, 17, 25, 33, 41, 49, 57, 64]) {
      expect(migration).toContain(`, ${start})`);
    }
  });

  it('affiche et trie les tables Hôtesse de manière numérique', () => {
    expect(hostess).toContain(".order('display_number')");
    expect(hostess).toContain('TABLE {t.display_number}');
  });

  it('affiche la même numérotation dans Administration', () => {
    expect(admin).toContain(".order('display_number')");
    expect(admin).toContain('Table {table.display_number}');
  });
});
