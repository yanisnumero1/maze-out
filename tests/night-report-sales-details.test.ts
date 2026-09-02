import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0034_enrich_night_report_sales_details.sql');
const worker = file('supabase/functions/send-night-reports/index.ts');

describe('V4 — détail des ventes dans le rapport de nuit figé', () => {
  it('enveloppe le snapshot existant sans retirer ses clés et ajoute sales_details', () => {
    expect(migration).toContain('rename to build_night_report_snapshot_0029');
    expect(migration).toContain('public.build_night_report_snapshot_0029(p_night_session_id) as snapshot');
    expect(migration).toContain("'sales_details'");
    expect(migration).toContain("'[]'::jsonb");
  });

  it('fige les données V4 et les libellés humains de chaque visite', () => {
    for (const key of ['visit_id', 'sale_number', 'origin_table_id', 'origin_table_number', 'final_table_id', 'final_table_number', 'final_head_waiter_id', 'final_head_waiter_name', 'reservation_name', 'consumption', 'sale_comment', 'cdr_comment', 'proposed_business_referrer_name', 'business_referrer_id', 'business_referrer_name']) expect(migration).toContain(`'${key}'`);
    expect(migration).toContain('left join public.business_referrers as referrer');
    expect(migration).toContain('left join public.head_waiters as final_waiter on final_waiter.id = v.final_head_waiter_id');
  });

  it('conserve une entrée par visite, la destination d’un transfert et les reventes distinctes', () => {
    expect(migration).toContain('from public.table_visits as v');
    expect(migration).toContain('coalesce(v.current_table_id, v.table_id) as final_table_id');
    expect(migration).toContain('order by arrived_at, sale_number nulls last, visit_id');
    expect(migration).not.toContain('join public.table_visit_transfers');
  });

  it('rend le bloc email uniquement depuis snapshot.sales_details et reste compatible avec les anciens snapshots', () => {
    expect(worker).toContain('const salesDetails = Array.isArray(snapshot.sales_details) ? snapshot.sales_details : [];');
    expect(worker).toContain("${sales ? `<h2>DÉTAIL DES VENTES</h2>${sales}` : ''}");
    expect(worker).toContain("sale.business_referrer_name ? `Apporteur :");
    expect(worker).toContain("sale.proposed_business_referrer_name ? `Proposé :");
    expect(worker).not.toContain("from('table_visits')");
  });

  it('préserve le mécanisme de livraison idempotent et les KPIs existants', () => {
    expect(worker).toContain("rpc('claim_night_report_deliveries'");
    expect(worker).toContain('Idempotency-Key');
    expect(worker).toContain('ENTRÉES CLUB');
    expect(worker).toContain('PERSONNES AUX TABLES');
  });
});
