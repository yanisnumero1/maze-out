import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTableDisplayNumber } from '@/lib/tables';

const table = (number: string, display_number?: string | number | null) => ({ number, display_number });
const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('libellé de table partagé', () => {
  it('préserve le numéro métier lorsque display_number est absent ou vide', () => {
    expect(getTableDisplayNumber(table('01', null))).toBe('01');
    expect(getTableDisplayNumber(table('01', ''))).toBe('01');
    expect(getTableDisplayNumber(table('01', '   '))).toBe('01');
  });

  it('privilégie un display_number réellement renseigné sans convertir les chaînes', () => {
    expect(getTableDisplayNumber(table('01', '1'))).toBe('1');
    expect(getTableDisplayNumber(table('OP-1-alhan-01', null))).toBe('OP-1-alhan-01');
    expect(getTableDisplayNumber(table('01', null))).not.toBe('1');
  });

  it('est utilisé dans les rendus Admin, CDR, Hôtesse et Recherche', () => {
    for (const path of ['components/admin-console.tsx', 'components/cdr-console.tsx', 'components/hostess-console.tsx', 'components/table-search.tsx']) {
      expect(file(path)).toContain('getTableDisplayNumber');
    }
  });
});
