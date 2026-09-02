import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const hostess = file('components/hostess-console.tsx');
const migration = file('supabase/migrations/0030_v4_sales_and_business_referrers.sql');

describe('V4 — parcours arrivée Hôtesse et brouillons', () => {
  it('présente les quatre champs V4 dans le formulaire d’arrivée', () => {
    for (const label of ['Nom de réservation', 'Apporteur d’affaires', 'Conso', 'Commentaire']) {
      expect(hostess).toContain(label);
    }
    expect(hostess).toContain('Note opérationnelle');
  });

  it('conserve des champs libres pour réservation, conso et commentaire de vente', () => {
    expect(hostess).toContain('value={reservationName}');
    expect(hostess).toContain('value={consumption}');
    expect(hostess).toContain('value={saleComment}');
    expect(hostess).toContain('setSaleComment(event.target.value)');
    expect(hostess).not.toContain('setSaleComment(comment)');
  });

  it('charge les apporteurs actifs et permet une proposition libre ou un choix existant', () => {
    expect(hostess).toContain("from('business_referrers').select('*').eq('active', true).order('name')");
    expect(hostess).toContain('list="business-referrer-options"');
    expect(hostess).toContain('businessReferrers.map((referrer) => <option');
    expect(hostess).toContain('setProposedBusinessReferrerName(event.target.value)');
  });

  it('enregistre uniquement une proposition dans le brouillon et ne crée aucun apporteur canonique côté Hôtesse', () => {
    const prepare = hostess.slice(hostess.indexOf('async function prepareArrival'), hostess.indexOf('async function moveDraft'));
    expect(prepare).toContain("rpc('prepare_arrival_draft_v4'");
    expect(prepare).toContain('p_proposed_business_referrer_name: proposedBusinessReferrerName || null');
    expect(prepare).not.toContain("from('business_referrers').insert");
    expect(prepare).not.toContain('validate_cdr_business_referrer');
  });

  it('hydrate les valeurs V4 lors de la réouverture d’un brouillon', () => {
    const edit = hostess.slice(hostess.indexOf('function editDraft'), hostess.indexOf('async function prepareArrival'));
    for (const value of ['draft.reservation_name ?? \'\'', 'draft.consumption ?? \'\'', 'draft.sale_comment ?? \'\'', 'draft.proposed_business_referrer_name ?? \'\'']) {
      expect(edit).toContain(value);
    }
    expect(hostess).toContain('Apporteur proposé · ');
  });

  it('conserve les données V4 lors d’un déplacement et les copie seulement à la confirmation serveur', () => {
    const move = hostess.slice(hostess.indexOf('async function moveDraft'), hostess.indexOf('async function confirmDraft'));
    expect(move).toContain("rpc('move_arrival_draft'");
    expect(move).not.toContain('setReservationName');
    expect(migration).toContain('set reservation_name = v_draft.reservation_name');
    expect(migration).toContain('proposed_business_referrer_name = v_draft.proposed_business_referrer_name');
  });

  it('remet les champs V4 à vide lors d’une nouvelle vente', () => {
    const nextSale = hostess.slice(hostess.indexOf('async function startNextSale'), hostess.indexOf('async function confirmTransfer'));
    expect(nextSale).toContain("setReservationName(''); setConsumption(''); setSaleComment(''); setProposedBusinessReferrerName('')");
  });

  it('préserve les règles de personnes positives, sale_number et transfert', () => {
    expect(hostess).toContain("if (present + extras < 1) return setNotice('Le nombre de personnes doit être au moins égal à 1.');");
    expect(migration).toContain('business_referrer_id = null');
    const transfer = migration.slice(migration.indexOf('create or replace function public.transfer_operational_table'), migration.indexOf('create or replace function public.validate_cdr_business_referrer'));
    expect(transfer).toContain('set current_table_id = p_to_table_id');
    expect(transfer).not.toContain('insert into public.table_visits');
  });

  it('continue d’utiliser les abonnements Realtime existants, sans étendre l’espace CDR', () => {
    for (const table of ['occupancies', 'arrival_drafts', 'table_visits']) expect(hostess).toContain(`table: '${table}'`);
    expect(hostess).not.toContain('validate_cdr_business_referrer');
  });
});
