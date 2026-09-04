import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'components/cdr-console.tsx'), 'utf8');
const live = readFileSync(resolve(process.cwd(), 'lib/cdr-live.ts'), 'utf8');

describe('interface opérationnelle du rang CDR', () => {
  it('construit toujours le rang depuis les tables structurelles du CDR', () => {
    expect(source).toContain('cdrLiveTableRows(tables, activeRankStatus ? visits : [], headWaiterId)');
    expect(live).toContain('table.head_waiter_id === headWaiterId');
    expect(source).toContain('available: tableRows.length, present: 0');
    expect(source).toContain('MON RANG');
  });

  it('présente un résumé compact puis une grille mobile priorisée', () => {
    expect(source).toContain('aria-label="Résumé de mon rang"');
    expect(source).toContain('grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8');
    expect(source).toContain('À traiter · {actionableTableRows.length}');
    expect(source).toContain('Mes autres tables');
    expect(source).toContain('min-h-[4.5rem]');
  });

  it('ouvre une seule table à la demande et revient directement au rang', () => {
    expect(source).toContain('setSelectedTableId(table.id)');
    expect(source).toContain('aria-label="Informations de la table"');
    expect(source).toContain('onClick={() => setSelectedTableId(null)}');
    expect(source).toContain('Retour au rang');
  });

  it('montre les informations Hôtesse et conserve les actions apporteur et montant', () => {
    for (const label of ['Réservation', 'Consommation', 'Commentaire', 'Proposé par l’Hôtesse', 'APPORTEUR', 'MONTANT']) expect(source).toContain(label);
    expect(source).toContain("rpc('validate_cdr_business_referrer'");
    expect(source).toContain("rpc('update_cdr_visit_amount'");
    expect(source).toContain('inputMode="decimal"');
  });

  it('place récap, validation finale puis journal repliable après le rang', () => {
    const rank = source.indexOf('aria-label="Mon rang"');
    const recap = source.indexOf('aria-label="Récapitulatif du rang"');
    const validation = source.indexOf('aria-label="Validation finale du rang"');
    const journal = source.indexOf('<details className="panel mb-4 mt-5 p-4" aria-label="Mon journal"');
    expect(rank).toBeGreaterThan(-1);
    expect(recap).toBeGreaterThan(rank);
    expect(validation).toBeGreaterThan(recap);
    expect(journal).toBeGreaterThan(validation);
  });

  it('n’utilise pas le vocabulaire transaction dans le parcours visible', () => {
    expect(source.toLocaleLowerCase('fr-FR')).not.toContain('transaction');
  });
});
