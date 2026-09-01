import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hostess = readFileSync(resolve(process.cwd(), 'components/hostess-console.tsx'), 'utf8');
const live = readFileSync(resolve(process.cwd(), 'components/live-dashboard.tsx'), 'utf8');

describe('vue salle Hôtesse en colonnes', () => {
  it('affiche les CDR du carré directement en colonnes', () => {
    expect(hostess).toContain("type Screen = 'zones' | 'columns'");
    expect(hostess).toContain("xl:grid-cols-3");
    expect(hostess).toContain("md:grid-cols-2");
    expect(hostess).toContain('waiters.map((item)');
    expect(hostess).toContain("waiters.length === 2 ? 'grid gap-4 md:grid-cols-2'");
    expect(hostess).toContain("'grid gap-4 md:grid-cols-2 xl:grid-cols-3'");
  });

  it('charge les affectations depuis Supabase au lieu de les coder en dur', () => {
    expect(hostess).toContain("from('tables')");
    expect(hostess).toContain("head_waiter:head_waiters(*)");
    expect(hostess).not.toContain("Samir : tables");
  });

  it('garde les tables directement cliquables dans leur colonne', () => {
    expect(hostess).toContain('mine.map(tableCard)');
    expect(hostess).toContain('openTable(table)');
    expect(hostess).toContain('TABLE {table.display_number}');
    expect(hostess).toContain('← RETOUR AUX CARRÉS');
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
