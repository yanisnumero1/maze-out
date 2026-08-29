import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const live = file('components/live-dashboard.tsx');
const hostess = file('components/hostess-console.tsx');
const navigation = file('components/navigation.tsx');

describe('recherche rapide de table depuis le Live', () => {
  it('recherche par numéro seul ou avec le préfixe Table, en privilégiant la correspondance exacte', () => {
    expect(live).toContain("query.replace(/^table\\s*/, '')");
    expect(live).toContain('String(left.display_number) === numericQuery');
    expect(live).toContain('Rechercher une table...');
  });

  it('recherche les tables par chef de rang et présente zone, CDR et statut', () => {
    expect(live).toContain('table.head_waiter.first_name');
    expect(live).toContain('table.zone?.name');
    expect(live).toContain("'ARRIVÉE EN ATTENTE'");
    expect(live).toContain("'LIBRE'");
    expect(live).toContain("'OCCUPÉE'");
  });

  it('navigue vers une table sans créer de brouillon', () => {
    expect(live).toContain('/hostess?table=');
    const searchSection = live.slice(live.indexOf('Recherche de table'), live.indexOf('Arrivées en attente'));
    expect(searchSection).not.toContain('prepare_arrival_draft');
  });

  it('ouvre la table demandée directement dans le bon carré et ouvre son brouillon actif si nécessaire', () => {
    expect(hostess).toContain("searchParams.get('table')");
    expect(hostess).toContain('String(table.display_number) === tableNumber');
    expect(hostess).toContain('setZone(requestedTable.zone)');
    expect(hostess).toContain('setEditing(requestedTable)');
    expect(hostess).toContain('router.replace(`/hostess?draft=${encodeURIComponent(draft.id)}`)');
  });

  it('conserve la recherche disponible pour les deux rôles sans modifier leurs liens autorisés', () => {
    expect(live).toContain('supabase.auth.getSession()');
    expect(live).toContain("from('profiles')");
    expect(navigation).toContain("role === 'admin'");
    expect(navigation).toContain('Hôtesse');
    expect(navigation).not.toContain('CDR');
  });
});
