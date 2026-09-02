import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { humanSalesDetails, humanTopTables, officialReferrersFromSales } from '../supabase/functions/send-night-reports/report-data';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0035_fix_night_report_v4_reporting.sql');
const worker = file('supabase/functions/send-night-reports/index.ts');
const uuid = '57c70d99-def7-41db-bc8b-8838d8255a7';

describe('correctif V4 du reporting de nuit', () => {
  it('remplace un UUID de Top Tables par le numéro humain figé sans perdre le zéro initial', () => {
    const [table] = humanTopTables(
      [{ table_id: uuid, table_number: uuid, total_sales: 4, people_welcomed: 18 }],
      [{ visit_id: 'visit-1', origin_table_id: uuid, origin_table_number: '01' }],
    );
    expect(table).toMatchObject({ table_number: '01', total_sales: 4, people_welcomed: 18 });
    expect(JSON.stringify(table)).not.toContain(`"table_number":"${uuid}"`);
  });

  it('n’affiche jamais un UUID comme libellé dans le détail des ventes', () => {
    const [sale] = humanSalesDetails([{ origin_table_number: uuid, final_table_number: uuid }]);
    expect(sale).toMatchObject({ origin_table_number: '—', final_table_number: '—' });
  });

  it('conserve les numéros humains du détail, y compris 01', () => {
    const [sale] = humanSalesDetails([{ origin_table_number: '01', final_table_number: '72' }]);
    expect(sale).toMatchObject({ origin_table_number: '01', final_table_number: '72' });
  });

  it('agrège plusieurs ventes du même apporteur officiel', () => {
    const rows = officialReferrersFromSales([
      { visit_id: 'v1', business_referrer_id: 'ref-1', business_referrer_name: 'Mohamed' },
      { visit_id: 'v2', business_referrer_id: 'ref-1', business_referrer_name: 'Mohamed' },
    ]);
    expect(rows).toEqual([{ normalized_name: 'mohamed', name: 'Mohamed', total_sales: 2, people_welcomed: null }]);
  });

  it('exclut une proposition non validée du classement officiel', () => {
    expect(officialReferrersFromSales([{ visit_id: 'v1', proposed_business_referrer_name: 'Morena' }])).toEqual([]);
  });

  it('compte un transfert une fois car il conserve la même table_visit', () => {
    const rows = officialReferrersFromSales([{ visit_id: 'v1', business_referrer_id: 'ref-1', business_referrer_name: 'Mohamed', final_table_id: 'table-2' }]);
    expect(rows[0].total_sales).toBe(1);
  });

  it('compte deux reventes portées par deux table_visits distinctes', () => {
    const rows = officialReferrersFromSales([
      { visit_id: 'v1', business_referrer_id: 'ref-1', business_referrer_name: 'Mohamed' },
      { visit_id: 'v2', business_referrer_id: 'ref-1', business_referrer_name: 'Mohamed' },
    ]);
    expect(rows[0].total_sales).toBe(2);
  });

  it('fait de business_referrer_id la source V4 et conserve le texte historique seulement sans FK', () => {
    expect(migration).toContain('join public.business_referrers as r on r.id = v.business_referrer_id');
    expect(migration).toContain('where v.business_referrer_id is null');
    expect(migration).toContain("nullif(btrim(v.business_referrer), '') is not null");
    expect(migration).not.toContain('proposed_business_referrer_name) as normalized_name');
  });

  it('enveloppe 0034 et ne modifie ni les KPIs ni les snapshots existants', () => {
    expect(migration).toContain('rename to build_night_report_snapshot_0034');
    expect(migration).toContain('public.build_night_report_snapshot_0034(p_night_session_id) as snapshot');
    expect(migration).not.toContain("'summary'");
    expect(migration).not.toContain("'analytics'");
  });

  it('continue de rendre exclusivement le snapshot et accepte l’absence de sales_details', () => {
    expect(worker).toContain("rpc('claim_night_report_deliveries'");
    expect(worker).toContain('Array.isArray(snapshot.sales_details) ? snapshot.sales_details : []');
    expect(worker).not.toContain("from('table_visits')");
  });
});
