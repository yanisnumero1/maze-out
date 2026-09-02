import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const live = file('components/live-dashboard.tsx');
const hostess = file('components/hostess-console.tsx');
const navigation = file('components/navigation.tsx');
const search = file('components/table-search.tsx');
const globalSearch = file('components/global-search.tsx');
const searchLogic = file('lib/global-search.ts');

describe('recherche rapide de table depuis le Live', () => {
  it('recherche par numéro seul ou avec le préfixe Table, en privilégiant la correspondance exacte', () => {
    expect(searchLogic).toContain("query.replace(/^table\\s*/, '').replace(/\\s/g, '')");
    expect(searchLogic).toContain('getTableDisplayNumber(left)');
    expect(search).toContain('Rechercher une table...');
  });

  it('recherche les tables par chef de rang et présente zone, CDR et statut', () => {
    expect(search).toContain('table.head_waiter.first_name');
    expect(search).toContain('table.zone?.name');
    expect(search).toContain("label: 'Arrivée en attente'");
    expect(search).toContain("label: 'Libre'");
    expect(search).toContain("label: 'Occupée'");
  });

  it('navigue vers une table depuis le Live sans créer de brouillon', () => {
    expect(live).toContain("from '@/components/global-search'");
    expect(live).toContain('router.push(`/hostess?table=${encodeURIComponent(getTableDisplayNumber(table))}`)');
    expect(search).not.toContain('prepare_arrival_draft');
  });

  it('ouvre la table demandée directement dans le bon carré et ouvre son brouillon actif si nécessaire', () => {
    expect(hostess).toContain("searchParams.get('table')");
    expect(hostess).toContain('getTableDisplayNumber(table) === tableNumber');
    expect(hostess).toContain('setZone(requestedTable.zone)');
    expect(hostess).toContain('setEditing(requestedTable)');
    expect(hostess).toContain('router.replace(`/hostess?draft=${encodeURIComponent(draft.id)}`)');
  });

  it('conserve la recherche disponible pour les deux rôles sans modifier leurs liens autorisés', () => {
    expect(live).toContain('supabase.auth.getSession()');
    expect(live).toContain("from('profiles')");
    expect(navigation).toContain("role === 'admin'");
    expect(navigation).toContain('Arrivée');
    expect(navigation).not.toContain('CDR');
  });

  it('réutilise la même recherche dans la vue Salle Hôtesse avant les cartes des carrés', () => {
    expect(hostess).toContain("import { GlobalSearch } from '@/components/global-search'");
    const zoneScreen = hostess.slice(hostess.indexOf("if (screen === 'zones')"));
    expect(zoneScreen).toContain('<GlobalSearch tables={tables} drafts={drafts} visits={tableVisits}');
    expect(zoneScreen.indexOf('<GlobalSearch')).toBeLessThan(zoneScreen.indexOf('<section className="grid grid-cols-2'));
    expect(hostess).toContain('display_number: getTableDisplayNumber(table)');
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
    expect(searchLogic).toContain('if (!query) return []');
    expect(globalSearch).toContain('Effacer la recherche');
    expect(globalSearch).toContain('focus:ring-violet-500/30');
    expect(globalSearch).toContain('focus-visible:ring-violet-400');
    expect(globalSearch).toContain('max-h-[min(30rem,65dvh)]');
    expect(globalSearch).toContain("event.key === 'Escape'");
    expect(globalSearch).toContain("event.key !== 'Enter'");
    expect(globalSearch).toContain("document.addEventListener('mousedown'");
  });
});
