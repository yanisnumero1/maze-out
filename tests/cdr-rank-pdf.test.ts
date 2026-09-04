import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const consoleSource = file('components/cdr-console.tsx');
const styles = file('app/globals.css');
const migration = file('supabase/migrations/0036_cdr_rank_personal_checkpoint.sql');

describe('export PDF personnel du rang CDR', () => {
  it('masque le bouton avant validation ou après clôture et l’affiche pendant la soirée active validée', () => {
    expect(consoleSource).toContain("selectedRankStatus?.night_status === 'active' && selectedRankStatus.validated_at && <button type=\"button\" onClick={exportRankRecapPdf}");
    expect(consoleSource).toContain("if (!recapNightId || selectedRankStatus?.night_status !== 'active' || !selectedRankStatus.validated_at) return;");
    expect(consoleSource).toContain('Exporter en PDF');
  });

  it('lance l’impression navigateur sans dépendance PDF ni infrastructure serveur', () => {
    expect(consoleSource).toContain('function exportRankRecapPdf()');
    expect(consoleSource).toContain('window.print()');
    expect(consoleSource).not.toContain('new Blob');
    expect(consoleSource).not.toContain('text/csv');
    expect(consoleSource).not.toContain('Exporter CSV');
  });

  it('imprime uniquement l’identité, la date et les agrégats utiles', () => {
    expect(consoleSource).toContain('<b>CDR :</b> {name}');
    expect(consoleSource).toContain('nightLabel(selectedRankStatus.night_started_at)');
    expect(consoleSource).toContain('cdr-print-referrers');
  });

  it('exclut du document les détails de transaction', () => {
    const printable = consoleSource.slice(consoleSource.indexOf('className="cdr-print-report hidden"'));
    for (const value of ['selectedRecapSales.map', 'sale.source_table_number', 'sale.final_table_number', 'sale.sale_number', 'sale.reservation_name', 'sale.consumption', 'sale.sale_comment', 'sale.cdr_comment']) {
      expect(printable).not.toContain(value);
    }
    expect(printable).not.toContain('Commentaire de vente');
    expect(printable).not.toContain('Note CDR');
  });

  it('utilise l’agrégation canonique sans proposition Hôtesse', () => {
    expect(consoleSource).toContain('cdrReferrerAmountSummary(selectedRecapSales)');
    expect(consoleSource).toContain('row.businessReferrerName');
  });

  it('reste strictement limité au CDR connecté par la RPC existante', () => {
    expect(migration).toContain('v_head_waiter_id := public.cdr_head_waiter_id()');
    expect(migration).toContain('where v.final_head_waiter_id = v_head_waiter_id');
    expect(consoleSource).toContain('selectedRecapSales');
    expect(consoleSource).not.toContain("from('table_visits').select('*').eq('final_head_waiter_id'");
  });

  it('produit une vue A4 sans navigation ni boutons et protège chaque ligne des coupures', () => {
    expect(styles).toContain('@page { size: A4; margin: 14mm; }');
    expect(styles).toContain('body * { visibility: hidden !important; }');
    expect(styles).toContain('.cdr-print-report, .cdr-print-report * { visibility: visible !important; }');
    expect(styles).toContain('break-inside: avoid');
    expect(consoleSource).toContain('className="cdr-print-report hidden"');
  });

  it('n’affiche aucun symbole ou code monétaire dans le document', () => {
    const printable = consoleSource.slice(consoleSource.indexOf('className="cdr-print-report hidden"'));
    expect(printable).not.toContain('€');
    expect(printable).not.toMatch(/(^|[^A-Z])EUR([^A-Z]|$)/);
  });

  it('conserve les protections de validation et verrouillage existantes', () => {
    expect(consoleSource).toContain('disabled={rankIsReadOnly}');
    expect(migration).toContain('not exists (');
    expect(migration).toContain('public.cdr_rank_validations');
    expect(migration).toContain('n.ended_at is null');
  });
});
