import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const hostess = file('components/hostess-console.tsx');
const dashboard = file('components/live-dashboard.tsx');
const migration = file('supabase/migrations/0030_v4_sales_and_business_referrers.sql');
const updateMigration = file('supabase/migrations/0033_update_hostess_visit_v4_fields.sql');

describe('V4 — continuité des ventes confirmées côté Hôtesse', () => {
  it('lit les champs V4 depuis la visite active, pas depuis un brouillon supprimé après confirmation', () => {
    const hydrate = hostess.slice(hostess.indexOf('function hydrateConfirmedSale'), hostess.indexOf('function confirmedSaleFieldsChanged'));
    for (const field of ['activeVisit?.reservation_name', 'activeVisit?.consumption', 'activeVisit?.sale_comment', 'activeVisit?.proposed_business_referrer_name']) expect(hydrate).toContain(field);
    expect(hostess).toContain('hydrateConfirmedSale(requestedTable)');
    expect(hostess).toContain('hydrateConfirmedSale(table)');
  });

  it('réhydrate la fiche après le chargement asynchrone des visites et conserve la visite lors d’un transfert', () => {
    expect(hostess).toContain('if (!editing || editingMode) return;');
    expect(hostess).toContain('hydrateConfirmedSale(editing);');
    const transfer = migration.slice(migration.indexOf('create or replace function public.transfer_operational_table'), migration.indexOf('create or replace function public.validate_cdr_business_referrer'));
    expect(transfer).toContain('set current_table_id = p_to_table_id');
    expect(transfer).not.toContain('insert into public.table_visits');
  });

  it('affiche séparément les informations proposées et l’apporteur validé disponible à la Hôtesse', () => {
    for (const label of ['Réservation · ', 'Conso · ', 'Commentaire · ', 'Apporteur proposé · ', 'Apporteur validé · ']) expect(hostess).toContain(label);
    expect(hostess).toContain('businessReferrers.find((referrer) => referrer.id === activeVisit.business_referrer_id)');
    expect(hostess).toContain("validatedReferrer?.name ?? 'Indisponible'");
  });

  it('enregistre les champs V4 confirmés uniquement via la RPC étroite après l’occupation', () => {
    const save = hostess.slice(hostess.indexOf('async function saveExistingOccupation'), hostess.indexOf('const openZone'));
    expect(save).toContain('const v4FieldsChanged = confirmedSaleFieldsChanged(editing);');
    expect(save).toContain("from('occupancies').upsert(payload)");
    expect(save).toContain("rpc('update_hostess_visit_v4_fields'");
    expect(save.indexOf("from('occupancies').upsert(payload)")).toBeLessThan(save.indexOf("rpc('update_hostess_visit_v4_fields'"));
    expect(save).toContain('await refresh();');
  });

  it('préserve la remise à zéro V4 lors d’une vraie nouvelle vente', () => {
    const nextSale = hostess.slice(hostess.indexOf('async function startNextSale'), hostess.indexOf('async function confirmTransfer'));
    expect(nextSale).toContain("setReservationName(''); setConsumption(''); setSaleComment(''); setProposedBusinessReferrerName('')");
  });

  it('inclut les détails V4 des nouvelles ventes dans l’activité récente sans nouvelle requête par frappe', () => {
    const details = dashboard.slice(dashboard.indexOf('function activitySaleDetails'), dashboard.indexOf('function activityActorId'));
    expect(details).toContain("item.kind !== 'sale_started'");
    for (const field of ['visit.reservation_name', 'visit.consumption', 'visit.sale_comment', 'visit.proposed_business_referrer_name']) expect(details).toContain(field);
    expect(dashboard).toContain('{activitySaleDetails(item) &&');
  });

  it('garde la mise à jour V4 côté SQL limitée aux quatre champs Hôtesse et auditable', () => {
    expect(updateMigration).toContain('create or replace function public.update_hostess_visit_v4_fields(');
    for (const field of ['reservation_name = v_reservation_name', 'consumption = v_consumption', 'sale_comment = v_sale_comment', 'proposed_business_referrer_name = v_proposed_referrer']) expect(updateMigration).toContain(field);
    for (const protectedField of ['cdr_comment =', 'business_referrer_id =', 'business_referrer_validated_at =', 'final_head_waiter_id =', 'sale_number =', 'current_table_id =']) expect(updateMigration).not.toContain(protectedField);
    expect(updateMigration).toContain("'hostess.visit.v4_updated'");
  });

  it('refuse côté SQL les visites fermées, les soirées clôturées et les rôles non opérationnels', () => {
    expect(updateMigration).toContain("if auth.uid() is null then");
    expect(updateMigration).toContain("public.current_role()::text not in ('admin', 'hostess')");
    expect(updateMigration).toContain('and v.ended_at is null');
    expect(updateMigration).toContain('and n.ended_at is null');
    expect(updateMigration).toContain('security definer');
    expect(updateMigration).toContain('set search_path = public');
  });
});
