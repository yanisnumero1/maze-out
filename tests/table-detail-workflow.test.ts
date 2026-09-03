import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hostess = readFileSync(resolve(process.cwd(), 'components/hostess-console.tsx'), 'utf8');

describe('fiche table avant le workflow d’arrivée', () => {
  it('ouvre une fiche avant les compteurs, quel que soit le point d’entrée', () => {
    expect(hostess).toContain('setEditingMode(false)');
    expect(hostess).toContain('if (editing && !editingMode)');
    expect(hostess).toContain('Historique de la soirée');
    expect(hostess).toContain("const badge = draft ? { label: 'ARRIVÉE EN ATTENTE'");
    expect(hostess).toContain('table={table} onOpen={onOpenTable}');
    expect(hostess).toContain('onOpenTable={openTable}');
  });

  it('revient directement aux cartes CDR après une ouverture depuis la mini-grille', () => {
    expect(hostess).toContain("if (screen === 'waiters')");
    expect(hostess).toContain('const backToColumns = () => {');
    expect(hostess).toContain('setEditing(null); setEditingMode(false);');
    expect(hostess).toContain('<button onClick={backToColumns}');
    expect(hostess).not.toContain('setScreen(\'columns\'); openTable(table)');
  });

  it('propose une installation ou une revente explicite avant de préparer un brouillon', () => {
    expect(hostess).toContain("hasPreviousSale ? 'Nouvelle vente / Nouvelle arrivée' : 'Installer une arrivée'");
    expect(hostess).toContain('onClick={() => setEditingMode(true)}');
    expect(hostess).toContain("rpc('prepare_arrival_draft_v4'");
  });

  it('présente les actions d’une table occupée sans ouvrir immédiatement le formulaire', () => {
    expect(hostess).toContain('Vente actuelle');
    expect(hostess).toContain('NOUVELLE VENTE / NOUVELLE ARRIVÉE');
    expect(hostess).toContain('void startNextSale()');
    expect(hostess).toContain('>Modifier</button>');
    expect(hostess).toContain('>Transférer vers une autre table</button>');
    expect(hostess).toContain('if (editing && editingMode)');
  });

  it('termine proprement la vente active avant de préparer le brouillon suivant', () => {
    expect(hostess).toContain("rpc('release_operational_table'");
    expect(hostess).toContain('setEditingMode(true)');
    expect(hostess).toContain('Vente précédente terminée. Préparez la nouvelle arrivée.');
    expect(hostess).toContain("rpc('prepare_arrival_draft_v4'");
  });

  it('affiche au plus deux ventes récentes par carte sans requête par table', () => {
    expect(hostess).toContain('const visitsByTable = useMemo');
    expect(hostess).toContain('visit.current_table_id');
    expect(hostess).toContain('const recentVisits = visitsForCard.slice(0, 2);');
    expect(hostess).toContain('Aucune vente');
    expect(hostess).toContain('visitsForCard.length - recentVisits.length');
  });

  it('conserve la reprise du brouillon, les ventes et les transferts dans la fiche', () => {
    expect(hostess).toContain('Confirmer l’installation sur la Table');
    expect(hostess).toContain('Annuler l’arrivée');
    expect(hostess).toContain('Vente #{visit.sale_number');
    expect(hostess).toContain('Transfert : Table');
  });
});
