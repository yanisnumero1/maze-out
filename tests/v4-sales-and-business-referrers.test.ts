import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0030_v4_sales_and_business_referrers.sql');
const types = file('lib/types.ts');

const section = (name: string, next?: string) => {
  const start = migration.indexOf(name);
  const end = next ? migration.indexOf(next, start) : migration.length;
  return migration.slice(start, end);
};

describe('V4 — ventes et apporteurs d’affaires', () => {
  it('attache les nouveaux champs à la visite et laisse les anciennes visites compatibles avec NULL', () => {
    for (const column of ['reservation_name text', 'consumption text', 'sale_comment text', 'proposed_business_referrer_name text', 'business_referrer_id uuid', 'business_referrer_validated_at timestamptz', 'business_referrer_validated_by uuid']) {
      expect(migration).toContain(column);
    }
    expect(migration).not.toContain('alter column reservation_name set not null');
    expect(types).toContain('reservation_name?: string | null');
    expect(types).toContain('proposed_business_referrer_name?: string | null');
  });

  it('conserve le CDR d’origine et mémorise séparément le CDR final', () => {
    expect(migration).toContain('add column if not exists final_head_waiter_id');
    expect(migration).toContain('set final_head_waiter_id = coalesce(current_table.head_waiter_id, v.head_waiter_id)');
    expect(types).toContain('final_head_waiter_id?: string | null');
  });

  it('préserve la même visite, le même sale_number et les données V4 pendant un transfert', () => {
    const transfer = section('create or replace function public.transfer_operational_table', 'create or replace function public.validate_cdr_business_referrer');
    expect(transfer).toContain('set current_table_id = p_to_table_id');
    expect(transfer).toContain('final_head_waiter_id = v_destination.head_waiter_id');
    expect(transfer).not.toContain('insert into public.table_visits');
    expect(transfer).not.toContain('sale_number =');
  });

  it('crée une nouvelle vente depuis le brouillon, sans recopier les données V4 précédentes lors d’une revente', () => {
    const confirm = section('create or replace function public.confirm_arrival_draft', 'create or replace function public.history_occupancy_visit');
    expect(confirm).toContain('set reservation_name = v_draft.reservation_name');
    expect(confirm).toContain('business_referrer_id = null');
    expect(confirm).toContain('business_referrer_validated_at = null');
    expect(confirm).toContain('business_referrer_validated_by = null');
    expect(migration).toContain('create or replace function public.prepare_arrival_draft_v4(');
  });

  it('conserve le contrat de brouillon existant tout en ajoutant une RPC V4 dédiée', () => {
    expect(migration).toContain('p_proposed_business_referrer_name text default null');
    expect(migration).toContain('returns public.arrival_drafts');
    expect(migration).toContain("public.current_role()::text not in ('admin', 'hostess')");
    expect(migration).toContain("Le nombre de personnes doit être au moins égal à 1.");
  });

  it('ne crée pas un apporteur canonique lors de la proposition Hôtesse', () => {
    const draft = section('create or replace function public.prepare_arrival_draft_v4', 'create or replace function public.confirm_arrival_draft');
    expect(draft).toContain('proposed_business_referrer_name');
    expect(draft).not.toContain('insert into public.business_referrers');
  });

  it('normalise et crée ou réutilise l’apporteur uniquement lors de la validation CDR', () => {
    const rpc = section('create or replace function public.validate_cdr_business_referrer');
    expect(migration).toContain('normalized_name text not null unique');
    expect(rpc).toContain("v_normalized_name := lower(v_name)");
    expect(rpc).toContain('where normalized_name = v_normalized_name');
    expect(rpc).toContain('insert into public.business_referrers(name, normalized_name)');
    expect(rpc).toContain('set business_referrer_id = v_referrer.id');
  });

  it('refuse la validation par un CDR hors de son rang ou après clôture', () => {
    const rpc = section('create or replace function public.validate_cdr_business_referrer');
    expect(rpc).toContain("public.current_role()::text <> 'cdr'");
    expect(rpc).toContain('v.ended_at is null');
    expect(rpc).toContain('n.ended_at is null');
    expect(rpc).toContain('t.head_waiter_id = public.cdr_head_waiter_id()');
  });

  it('empêche explicitement une Hôtesse de valider officiellement un apporteur', () => {
    const rpc = section('create or replace function public.validate_cdr_business_referrer');
    expect(rpc).toContain("public.current_role()::text <> 'cdr'");
    expect(rpc).toContain("raise exception 'CDR access required'");
  });

  it('enregistre validation et correction dans le journal central avec avant/après', () => {
    const rpc = section('create or replace function public.validate_cdr_business_referrer');
    expect(migration).toContain("'cdr.business_referrer.validated', 'cdr.business_referrer.corrected'");
    expect(rpc).toContain("then 'cdr.business_referrer.validated'");
    expect(rpc).toContain("else 'cdr.business_referrer.corrected'");
    expect(rpc).toContain('insert into public.operational_audit_log(');
    expect(rpc).toContain("'business_referrer_name', v_previous_referrer_name");
    expect(rpc).toContain("'business_referrer_name', v_referrer.name");
  });

  it('réserve la lecture du journal CDR à ses propres validations', () => {
    expect(migration).toContain('create policy "cdr reads own business referrer audit"');
    expect(migration).toContain('and actor_id = auth.uid()');
    expect(migration).toContain("and action_type in ('cdr.business_referrer.validated', 'cdr.business_referrer.corrected')");
  });

  it('prépare une liste canonique administrable sans DELETE physique ni suppression par le reset', () => {
    expect(migration).toContain('create table if not exists public.business_referrers');
    expect(migration).toContain('create or replace function public.save_business_referrer(');
    expect(migration).toContain("public.current_role()::text <> 'admin'");
    expect(migration).not.toContain('delete from public.business_referrers');
    expect(migration).not.toContain('reset_test_operational_data');
  });

  it('préserve les protections existantes contre les ventes et transferts à zéro personne', () => {
    const transfer = section('create or replace function public.transfer_operational_table', 'create or replace function public.validate_cdr_business_referrer');
    expect(transfer).toContain("if v_visit.present_people + v_visit.extra_guests < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.';");
    expect(migration).toContain("if coalesce(p_present_people, 0) + coalesce(p_extra_guests, 0) < 1 then raise exception 'Le nombre de personnes doit être au moins égal à 1.';");
  });
});
