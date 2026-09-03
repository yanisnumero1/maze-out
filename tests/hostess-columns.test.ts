import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hostess = readFileSync(resolve(process.cwd(), 'components/hostess-console.tsx'), 'utf8');
const live = readFileSync(resolve(process.cwd(), 'components/live-dashboard.tsx'), 'utf8');

describe('vue salle Hôtesse par CDR', () => {
  it('affiche une grille de CDR avant leurs tables', () => {
    expect(hostess).toContain("type Screen = 'overview' | 'zones' | 'waiters' | 'columns'");
    expect(hostess).toContain("if (screen === 'waiters')");
    expect(hostess).toContain('cdrRanks.map((rank)');
    expect(hostess).toContain('min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4');
    const waiterScreen = hostess.slice(hostess.indexOf("if (screen === 'waiters')"), hostess.indexOf("if (screen === 'columns'"));
    expect(waiterScreen).not.toContain('.map(tableCard)');
  });

  it('charge les affectations depuis Supabase au lieu de les coder en dur', () => {
    expect(hostess).toContain("from('tables')");
    expect(hostess).toContain("head_waiter:head_waiters(*)");
    expect(hostess).not.toContain("Samir : tables");
  });

  it('garde les tables directement cliquables après sélection du CDR', () => {
    expect(hostess).toContain('selectedRank.tables.map(tableCard)');
    expect(hostess).toContain('openTable(table)');
    expect(hostess).toContain('display_number: getTableDisplayNumber(table)');
    expect(hostess).toContain('← TOUS LES CDR DE');
  });

  it('nomme simplement l’écran opérationnel Arrivée', () => {
    expect(hostess).toContain('>ARRIVÉE</h1>');
    expect(hostess).not.toContain('>HÔTESSE</h1>');
  });

  it('affiche les quatre carrés dans une grille compacte fixe de deux colonnes', () => {
    const start = hostess.indexOf("if (screen === 'zones')");
    const zoneScreen = hostess.slice(start, hostess.indexOf('\n\n  return <>', start));
    expect(zoneScreen).toContain('grid grid-cols-2 gap-3 sm:gap-4');
    expect(zoneScreen).not.toContain('lg:grid-cols-4');
    expect(zoneScreen).toContain('summary.available');
    expect(zoneScreen).toContain('onClick={() => openZone(item)}');
  });

  it('présente les indicateurs du carré avec sa capacité réelle', () => {
    expect(hostess).toContain('Tables utilisées : {zoneSummary.occupied} / {inZone.length}');
    expect(hostess).toContain('Capacité zone : {zoneSummary.present} / {zone.max_capacity}');
    expect(hostess).toContain('zoneAvailabilityStatus(zoneSummary.present, zone?.max_capacity, zoneSummary.available)');
  });

  it('présente les compteurs live de chaque rang, y compris à zéro', () => {
    expect(hostess).toContain('{rank.occupiedTables} / {rank.tables.length} tables occupées');
    expect(hostess).toContain('{rank.presentPeople}');
    expect(hostess).toContain('hostessCdrRanks(inZone)');
  });

  it('visualise les vraies tables du rang en vert si libres et rouge si occupées', () => {
    expect(hostess).toContain('function RankTableIndicator');
    expect(hostess).toContain('const occupied = presentTotal(table) > 0');
    expect(hostess).toContain('rank.tables.map((table) => <RankTableIndicator');
    expect(hostess).toContain('bg-emerald-500/15');
    expect(hostess).toContain('bg-red-500/15');
    expect(hostess).toContain('●</span> Libre');
    expect(hostess).toContain('●</span> Occupée');
  });

  it('annonce chaque état sans dépendre uniquement de la couleur et conserve le clic du rang', () => {
    expect(hostess).toContain('aria-label={`Table ${getTableDisplayNumber(table)} — ${state}`}');
    expect(hostess).toContain('title={`Table ${getTableDisplayNumber(table)} — ${state}`}');
    expect(hostess).toContain('onClick={() => onOpenRank(rank.headWaiter.id)}');
    expect(hostess).toContain('mt-4 flex flex-wrap gap-2');
  });

  it('ouvre directement une mini-table sans déclencher le clic de la carte CDR', () => {
    expect(hostess).toContain('onOpen: (table: LiveTable) => void');
    expect(hostess).toContain('event.stopPropagation(); onOpen(table);');
    expect(hostess).toContain('onKeyDown={(event) => event.stopPropagation()}');
    expect(hostess).toContain('table={table} onOpen={onOpenTable}');
    expect(hostess).toContain('onOpenTable={openTable}');
    expect(hostess).toContain('type="button" aria-label={`Table ${getTableDisplayNumber(table)} — ${state}`}');
  });

  it('conserve une carte CDR cliquable et accessible au clavier sans imbriquer des boutons', () => {
    expect(hostess).toContain('role="button" tabIndex={0}');
    expect(hostess).toContain("event.key === 'Enter' || event.key === ' '");
    expect(hostess).toContain('onOpenRank(rank.headWaiter.id)');
    expect(hostess).toContain('focus-visible:ring-2 focus-visible:ring-violet-400');
  });

  it('conserve brouillons, ventes et déplacement sécurisé', () => {
    expect(hostess).toContain("from('arrival_drafts')");
    expect(hostess).toContain("from('table_visits')");
    expect(hostess).toContain("move_arrival_draft");
    expect(hostess).toContain('Vente #{activeSales[table.id]}');
    expect(hostess).toContain("label: 'BROUILLON'");
  });

  it('rend les états opérationnels lisibles sur les cartes sombres', () => {
    for (const label of ['LIBRE', 'OCCUPÉE', 'CHARGÉE', 'CAPACITÉ ATTEINTE', 'INDISPONIBLE']) {
      expect(hostess).toContain(`label: '${label}'`);
    }
    expect(hostess).toContain('bg-zinc-900');
    expect(hostess).toContain('border-violet-500/30');
  });

  it('conserve les abonnements Realtime de la vue salle', () => {
    expect(hostess).toContain("table: 'occupancies'");
    expect(hostess).toContain("table: 'arrival_drafts'");
    expect(hostess).toContain("table: 'table_visits'");
  });

  it('permet d’ouvrir directement un carré depuis la vue Live', () => {
    expect(live).toContain('Ouvrir la vue salle');
    expect(live).toContain('/hostess?zone=');
    expect(hostess).toContain("searchParams.get('zone')");
  });

  it('retourne à l’accueil Live depuis une vue de carré', () => {
    expect(hostess).toContain("import { useRouter, useSearchParams } from 'next/navigation'");
    expect(hostess).toContain("const backToZones = () => router.push('/' as any)");
  });
});
