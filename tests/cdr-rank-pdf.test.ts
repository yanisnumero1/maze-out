import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const consoleSource = file('components/cdr-console.tsx');
const styles = file('app/globals.css');
const migration = file('supabase/migrations/0036_cdr_rank_personal_checkpoint.sql');

describe('export PDF personnel du rang CDR', () => {
  it('masque le bouton avant validation et l’affiche après validation ou clôture', () => {
    expect(consoleSource).toContain("selectedRankStatus?.is_read_only && <button type=\"button\" onClick={exportRankRecapPdf}");
    expect(consoleSource).toContain('Exporter en PDF');
    expect(migration).toContain('n.ended_at is not null or rv.validated_at is not null');
  });

  it('lance l’impression navigateur sans dépendance PDF ni infrastructure serveur', () => {
    expect(consoleSource).toContain('function exportRankRecapPdf()');
    expect(consoleSource).toContain('window.print()');
    expect(consoleSource).not.toContain('new Blob');
    expect(consoleSource).not.toContain('text/csv');
    expect(consoleSource).not.toContain('Exporter CSV');
  });

  it('imprime le CDR, la soirée et le bon statut historique', () => {
    expect(consoleSource).toContain('<b>Chef de rang :</b> {name}');
    expect(consoleSource).toContain('nightLabel(selectedRankStatus.night_started_at)');
    expect(consoleSource).toContain('Rang validé à ${clock(selectedRankStatus.validated_at)}');
    expect(consoleSource).toContain("'Non validé avant clôture'");
  });

  it('inclut les ventes, transferts, notes et données commerciales du rang', () => {
    for (const value of ['selectedRecapSales.map', 'sale.source_table_number', 'sale.final_table_number', 'sale.sale_number', 'sale.reservation_name', 'sale.consumption', 'sale.sale_comment', 'sale.cdr_comment']) {
      expect(consoleSource).toContain(value);
    }
    expect(consoleSource).toContain('Commentaire de vente');
    expect(consoleSource).toContain('Note CDR');
  });

  it('préfère l’apporteur validé et utilise la proposition uniquement en repli', () => {
    expect(consoleSource).toContain("sale.business_referrer_name || sale.proposed_business_referrer_name || 'Non renseigné'");
    expect(consoleSource).toContain("sale.business_referrer_name ? 'Apporteur validé' : 'Apporteur proposé'");
    expect(migration).toContain('v.proposed_business_referrer_name');
  });

  it('reste strictement limité au CDR connecté par la RPC existante', () => {
    expect(migration).toContain('v_head_waiter_id := public.cdr_head_waiter_id()');
    expect(migration).toContain('where v.final_head_waiter_id = v_head_waiter_id');
    expect(consoleSource).toContain('selectedRecapSales');
    expect(consoleSource).not.toContain("from('table_visits').select('*').eq('final_head_waiter_id'");
  });

  it('produit une vue A4 sans navigation ni boutons et protège chaque vente des coupures', () => {
    expect(styles).toContain('@page { size: A4; margin: 14mm; }');
    expect(styles).toContain('body * { visibility: hidden !important; }');
    expect(styles).toContain('.cdr-print-report, .cdr-print-report * { visibility: visible !important; }');
    expect(styles).toContain('break-inside: avoid');
    expect(consoleSource).toContain('className="cdr-print-report hidden"');
  });

  it('conserve les protections de validation et verrouillage existantes', () => {
    expect(consoleSource).toContain('disabled={rankIsReadOnly}');
    expect(migration).toContain('not exists (');
    expect(migration).toContain('public.cdr_rank_validations');
    expect(migration).toContain('n.ended_at is null');
  });
});
