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
  });

  it('propose une installation ou une revente explicite avant de préparer un brouillon', () => {
    expect(hostess).toContain("hasPreviousSale ? 'Revendre la table' : 'Installer une arrivée'");
    expect(hostess).toContain('onClick={() => setEditingMode(true)}');
    expect(hostess).toContain("rpc('prepare_arrival_draft'");
  });

  it('présente les actions d’une table occupée sans ouvrir immédiatement le formulaire', () => {
    expect(hostess).toContain('Vente actuelle');
    expect(hostess).toContain('>Modifier</button>');
    expect(hostess).toContain('>Libérer la table</button>');
    expect(hostess).toContain('>Transférer vers une autre table</button>');
    expect(hostess).toContain('if (editing && editingMode)');
  });

  it('conserve la reprise du brouillon, les ventes et les transferts dans la fiche', () => {
    expect(hostess).toContain('Confirmer l’installation sur la Table');
    expect(hostess).toContain('Annuler l’arrivée');
    expect(hostess).toContain('Vente #{visit.sale_number');
    expect(hostess).toContain('Transfert : Table');
  });
});
