import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const consoleSource = file('components/cdr-console.tsx');
const cdrLive = file('lib/cdr-live.ts');
const v4Migration = file('supabase/migrations/0030_v4_sales_and_business_referrers.sql');
const cdrMigration = file('supabase/migrations/0028_cdr_visit_notes.sql');

describe('V4 — validation apporteur et journal CDR', () => {
  it('affiche les informations de vente Hôtesse sur une visite active', () => {
    for (const field of ['visit.reservation_name', 'visit.consumption', 'visit.sale_comment', 'visit.proposed_business_referrer_name']) {
      expect(consoleSource).toContain(field);
    }
    expect(consoleSource).toContain('Aucun apporteur proposé');
  });

  it('charge les apporteurs canoniques actifs et accepte une saisie libre', () => {
    expect(consoleSource).toContain("from('business_referrers').select('*').eq('active', true).order('name')");
    expect(consoleSource).toContain('Rechercher ou saisir un apporteur...');
    expect(consoleSource).toContain('role="combobox"');
    expect(consoleSource).toContain('role="listbox"');
    expect(consoleSource).toContain('matchingReferrers.map((referrer)');
    expect(consoleSource).toContain('normalizeReferrerName(referrer.name).includes(normalizedInput)');
  });

  it('sélectionne un existant ou propose la création seulement à la validation explicite', () => {
    expect(consoleSource).toContain('setValidatedReferrers((current) => ({ ...current, [visit.id]: referrer.name }))');
    expect(consoleSource).toContain('normalizedInput && !hasExactReferrer');
    expect(consoleSource).toContain('+ Ajouter « {referrerInput.trim().replace(/\\s+/g');
    expect(consoleSource).toContain('onClick={() => void validateBusinessReferrer(visit)}');
    expect(consoleSource).not.toContain("from('business_referrers').insert");
    expect(consoleSource).not.toContain("from('business_referrers').upsert");
  });

  it('préserve la proposition Hôtesse et rafraîchit le nom canonique après validation', () => {
    expect(consoleSource).toContain('Proposé par l’Hôtesse');
    expect(consoleSource).toContain('visit.proposed_business_referrer_name');
    expect(consoleSource).toContain('loadedReferrers.find((referrer) => referrer.id === visit.business_referrer_id)?.name ?? current[visit.id]');
    const validation = consoleSource.slice(consoleSource.indexOf('async function validateBusinessReferrer'), consoleSource.indexOf('async function validateRank'));
    expect(validation).toContain('await refresh()');
  });

  it('valide exclusivement via la RPC dédiée, sans écriture directe sur table_visits', () => {
    const validation = consoleSource.slice(consoleSource.indexOf('async function validateBusinessReferrer'), consoleSource.indexOf('async function signOut'));
    expect(validation).toContain("rpc('validate_cdr_business_referrer'");
    expect(validation).toContain('p_visit_id: visit.id');
    expect(validation).toContain('p_business_referrer_name: referrerName');
    expect(validation).not.toContain("from('table_visits').update");
    expect(validation).not.toContain("from('table_visits').insert");
  });

  it('rend explicitement la validation et la correction', () => {
    expect(consoleSource).toContain("hasValidatedReferrer ? 'Corriger l’apporteur' : 'Valider l’apporteur'");
    expect(consoleSource).toContain('Validé : ${referrerName}');
    expect(v4Migration).toContain("'cdr.business_referrer.validated', 'cdr.business_referrer.corrected'");
  });

  it('charge un journal persistant, limité aux événements autorisés du CDR', () => {
    expect(consoleSource).toContain(".from('operational_audit_log')");
    expect(consoleSource).toContain(".select('*')");
    expect(consoleSource).toContain("'cdr.business_referrer.validated', 'cdr.business_referrer.corrected'");
    expect(consoleSource).toContain('MON JOURNAL');
    expect(consoleSource).toContain("corrected ? 'Apporteur corrigé' : 'Apporteur validé'");
    expect(consoleSource).toContain("auditText(entry.metadata, 'current_table_id')");
    expect(v4Migration).toContain('create policy "cdr reads own business referrer audit"');
    expect(v4Migration).toContain('and actor_id = auth.uid()');
  });

  it('préserve la note CDR historique dans sa RPC dédiée', () => {
    expect(consoleSource).toContain('Note CDR historique');
    expect(cdrMigration).toContain('set cdr_comment = v_comment');
    expect(cdrMigration).toContain('business_referrer = v_referrer');
  });

  it('respecte le CDR actuel lors d’un transfert, sans dupliquer la visite ni le sale_number', () => {
    expect(cdrLive).toContain('table.head_waiter_id === headWaiterId');
    expect(cdrLive).toContain('visit.current_table_id ?? visit.table_id');
    const transfer = v4Migration.slice(v4Migration.indexOf('create or replace function public.transfer_operational_table'), v4Migration.indexOf('create or replace function public.validate_cdr_business_referrer'));
    expect(transfer).toContain('final_head_waiter_id = v_destination.head_waiter_id');
    expect(transfer).not.toContain('insert into public.table_visits');
    expect(transfer).not.toContain('sale_number =');
  });

  it('refuse les validations hors rang ou après clôture côté backend', () => {
    const validation = file('supabase/migrations/0036_cdr_rank_personal_checkpoint.sql').slice(file('supabase/migrations/0036_cdr_rank_personal_checkpoint.sql').indexOf('create or replace function public.validate_cdr_business_referrer'));
    expect(validation).toContain('t.head_waiter_id = v_head_waiter_id');
    expect(validation).toContain('v.ended_at is null');
    expect(validation).toContain('n.ended_at is null');
  });

  it('préserve les états vides et le responsive mobile', () => {
    expect(consoleSource).toContain('Aucune action enregistrée pour le moment.');
    expect(consoleSource).toContain('Aucune table active ne vous est actuellement attribuée.');
    expect(consoleSource).toContain('grid grid-cols-2 gap-3 sm:grid-cols-4');
    expect(consoleSource).toContain('sm:grid-cols-2');
  });

  it('ne prétend pas exposer le récapitulatif historique sans la RLS nécessaire', () => {
    expect(cdrMigration).toContain('and ended_at is null');
    expect(consoleSource).not.toContain("from('table_visits').select('*').eq('final_head_waiter_id'");
    expect(v4Migration).toContain('final_head_waiter_id');
  });
});
