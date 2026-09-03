import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recapSaleDetails } from '@/lib/recap';
import { recapActivity } from '@/lib/recap-activity';
import type { BusinessReferrer, LiveTable, OperationalAuditLog, TableVisit, Zone } from '@/lib/types';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const recap = file('components/recap-console.tsx');
const snapshot = file('supabase/migrations/0029_enrich_report_with_cdr_notes.sql');
const worker = file('supabase/functions/send-night-reports/index.ts');

const zone: Zone = { id: 'zone', name: 'Carré 1', display_order: 1, active: true };
const samir = { id: 'samir', first_name: 'Samir', last_name: '', color: null, active: true };
const steven = { id: 'steven', first_name: 'Steven', last_name: '', color: null, active: true };
const table = (id: string, number: string, waiter = samir): LiveTable => ({ id, number, display_number: number, zone_id: zone.id, head_waiter_id: waiter.id, standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: waiter, reservation: null, occupancy: null });
const visit = (id: string, overrides: Partial<TableVisit> = {}): TableVisit => ({ id, night_session_id: 'night', table_id: 'source', current_table_id: 'final', zone_id: zone.id, head_waiter_id: samir.id, final_head_waiter_id: steven.id, present_people: 5, extra_guests: 1, comment: null, reservation_name: 'Yanis', consumption: '1 Mag', sale_comment: 'Commentaire', cdr_comment: 'Note CDR', proposed_business_referrer_name: 'Morena', business_referrer_id: 'ref', arrived_at: '2026-09-02T20:00:00Z', ended_at: null, sale_number: 1, zone, head_waiter: samir, ...overrides });
const referrer: BusinessReferrer = { id: 'ref', name: 'Mohamed', normalized_name: 'mohamed', active: true, created_at: '', updated_at: '' };

describe('V4 — détail des ventes du récapitulatif Admin', () => {
  it('affiche les données V4 séparées, avec apporteur officiel prioritaire et proposition non validée distincte', () => {
    const details = recapSaleDetails([visit('v1'), visit('v2', { business_referrer_id: null })], [table('source', '01'), table('final', '72', steven)], [referrer]);
    expect(details[0]).toMatchObject({ originTable: '01', finalTable: '72', finalHeadWaiterName: 'Steven', reservationName: 'Yanis', consumption: '1 Mag', saleComment: 'Commentaire', cdrComment: 'Note CDR', validatedBusinessReferrerName: 'Mohamed' });
    expect(details[1].validatedBusinessReferrerName).toBeNull();
    expect(details[1].proposedBusinessReferrerName).toBe('Morena');
  });

  it('conserve une vente unique lors d’un transfert et deux ventes lors d’une revente', () => {
    expect(recapSaleDetails([visit('transfer')], [table('source', '01'), table('final', '72', steven)], [referrer])).toHaveLength(1);
    expect(recapSaleDetails([visit('sale-1', { sale_number: 1 }), visit('sale-2', { sale_number: 2 })], [table('source', '01'), table('final', '72', steven)], [referrer])).toHaveLength(2);
  });

  it('reste compatible avec les ventes historiques dont les champs V4 sont absents', () => {
    const [detail] = recapSaleDetails([visit('legacy', { final_head_waiter_id: null, reservation_name: null, consumption: null, sale_comment: null, cdr_comment: null, proposed_business_referrer_name: null, business_referrer_id: null })], [table('source', '01'), table('final', '72', steven)], []);
    expect(detail).toMatchObject({ finalHeadWaiterName: 'Samir', reservationName: null, consumption: null, saleComment: null, cdrComment: null, validatedBusinessReferrerName: null });
  });

  it('rend des cartes Admin adaptées au mobile, sans exposer le récap aux autres rôles', () => {
    expect(recap).toContain('DÉTAIL DES VENTES');
    expect(recap).toContain('grid gap-3 sm:grid-cols-2');
    for (const label of ['CDR final', 'Réservation · ', 'Conso · ', 'Commentaire · ', 'Note CDR historique · ', 'Montant apporteur · ', 'Apporteur validé · ']) expect(recap).toContain(label);
    expect(file('app/recap/page.tsx')).toContain('<AuthGate requireAdmin>');
  });

  it('transforme les événements V4 en libellés humains', () => {
    const audit = (action_type: string): OperationalAuditLog => ({ id: action_type, night_session_id: 'night', actor_id: 'hostess', action_type, entity_type: 'table_visit', entity_id: 'v1', created_at: '2026-09-02T20:10:00Z', before_data: null, after_data: null, metadata: { current_table_id: 'final' } });
    const input = { audits: [audit('hostess.visit.v4_updated'), audit('cdr.business_referrer.validated'), audit('cdr.business_referrer.corrected')], visits: [visit('v1')], transfers: [], notes: [], promoterEvents: [], promoters: [], entryCounts: [], tableNumbers: new Map([['final', '72']]) };
    const titles = recapActivity(input).map((item) => item.title);
    expect(titles).toEqual(expect.arrayContaining(['Table 72 · Informations de vente modifiées', 'Table 72 · Apporteur validé', 'Table 72 · Apporteur corrigé']));
  });

  it('documente que le snapshot 0029 était insuffisant avant l’enrichissement V4 séquentiel', () => {
    for (const missing of ['reservation_name', 'consumption', 'sale_comment', 'proposed_business_referrer_name', 'business_referrer_id', 'final_head_waiter_id']) expect(snapshot).not.toContain(`'${missing}'`);
    expect(worker).toContain('snapshot.sales_details');
  });
});
