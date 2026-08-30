import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const live = file('components/live-dashboard.tsx');
const hostess = file('components/hostess-console.tsx');
const navigation = file('components/navigation.tsx');
const search = file('components/table-search.tsx');

describe('recherche rapide de table depuis le Live', () => {
  it('recherche par numéro seul ou avec le préfixe Table, en privilégiant la correspondance exacte', () => {
    expect(search).toContain("query.replace(/^table\\s*/, '')");
    expect(search).toContain('String(left.display_number) === numericQuery');
    expect(search).toContain('Rechercher une table...');
  });

  it('recherche les tables par chef de rang et présente zone, CDR et statut', () => {
    expect(search).toContain('table.head_waiter.first_name');
    expect(search).toContain('table.zone?.name');
    expect(search).toContain("label: 'Arrivée en attente'");
    expect(search).toContain("label: 'Libre'");
    expect(search).toContain("label: 'Occupée'");
  });

  it('navigue vers une table depuis la Salle sans créer de brouillon', () => {
    expect(live).not.toContain("from '@/components/table-search'");
    expect(search).not.toContain('prepare_arrival_draft');
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

  it('réutilise la même recherche dans la vue Salle Hôtesse avant les cartes des carrés', () => {
    expect(hostess).toContain("import { TableSearch } from '@/components/table-search'");
    const zoneScreen = hostess.slice(hostess.indexOf("if (screen === 'zones')"));
    expect(zoneScreen).toContain('<TableSearch tables={tables} drafts={drafts}');
    expect(zoneScreen.indexOf('<TableSearch')).toBeLessThan(zoneScreen.indexOf('<section className="grid gap-4">'));
    expect(hostess).toContain('router.replace(`/hostess?table=${encodeURIComponent(String(table.display_number))}`)');
  });

  it('affiche une ligne opérationnelle avec priorité au brouillon, capacité réelle et résultats limités', () => {
    expect(search).toContain('const MAX_RESULTS = 8');
    expect(search).toContain('const visibleResults = results.slice(0, MAX_RESULTS)');
    expect(search).toContain('const capacity = table.max_people ?? table.standard_capacity');
    expect(search).toContain('draft ? draft.present_people + draft.extra_guests : presentTotal(table)');
    expect(search).toContain("people: `0/${capacity} pers.`");
    expect(search).toContain("people: `${totalPeople}/${capacity} pers.`");
    expect(search).toContain("people: `${totalPeople} pers.`");
  });

  it('reste vide sans saisie, accessible, effaçable et tactile', () => {
    expect(search).toContain('if (!query) return []');
    expect(search).toContain('Effacer la recherche');
    expect(search).toContain('focus:ring-violet-500/30');
    expect(search).toContain('focus-visible:ring-violet-400');
    expect(search).toContain('flex-wrap');
  });
});
