import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0036_cdr_rank_personal_checkpoint.sql');
const consoleSource = file('components/cdr-console.tsx');
const closeMigration = file('supabase/migrations/0022_night_report_delivery.sql');

const sqlFunction = (name: string, nextName?: string) => {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = nextName ? migration.indexOf(`create or replace function public.${nextName}`, start) : migration.length;
  return migration.slice(start, end);
};

describe('checkpoint personnel du rang CDR', () => {
  it('autorise les écritures CDR avant validation sur une soirée active et son propre rang', () => {
    const notes = sqlFunction('update_cdr_visit_notes', 'validate_cdr_business_referrer');
    expect(notes).toContain('n.ended_at is null');
    expect(notes).toContain('t.head_waiter_id = v_head_waiter_id');
    expect(notes).toContain('not exists (');
    expect(notes).toContain('public.cdr_rank_validations');
  });

  it('verrouille les notes après validation du rang côté SQL et interface', () => {
    expect(consoleSource).toContain('const rankIsReadOnly = Boolean(activeRankStatus?.is_read_only)');
    expect(consoleSource).toContain('disabled={rankIsReadOnly} type="text" inputMode="decimal"');
    expect(consoleSource).toContain("disabled={rankIsReadOnly || selectedAmountState === 'saving'");
    expect(migration).toContain("raise exception 'Active unvalidated visit unavailable for this CDR'");
  });

  it('interdit également validation et correction d’apporteur après validation', () => {
    const referrer = sqlFunction('validate_cdr_business_referrer', 'get_cdr_rank_status');
    expect(referrer).toContain('not exists (');
    expect(referrer).toContain('rv.head_waiter_id = v_head_waiter_id');
    expect(consoleSource).toContain('disabled={rankIsReadOnly || selectedValidationState ===');
  });

  it('laisse la clôture Admin indépendante avec zéro validation ou des validations partielles', () => {
    const close = closeMigration.slice(closeMigration.indexOf('create or replace function public.close_current_night_session()'));
    expect(close).toContain("public.current_role() <> 'admin'");
    expect(close).toContain('update public.night_sessions set ended_at = now()');
    expect(close).not.toContain('cdr_rank_validations');
    expect(close).not.toContain('validated_at is not null');
  });

  it('fait de la clôture Admin un verrou pour les CDR même non validés', () => {
    for (const rpc of [sqlFunction('update_cdr_visit_notes', 'validate_cdr_business_referrer'), sqlFunction('validate_cdr_business_referrer', 'get_cdr_rank_status')]) {
      expect(rpc).toContain('n.ended_at is null');
    }
    expect(sqlFunction('validate_cdr_rank', 'update_cdr_visit_notes')).toContain("if v_night_id is null then raise exception 'No active night session'");
  });

  it('ne crée aucune fausse validation lors de la clôture globale', () => {
    expect(closeMigration).not.toContain('insert into public.cdr_rank_validations');
    expect(migration).toContain('unique (night_session_id, head_waiter_id)');
  });

  it('conserve historiquement le statut non validé avant clôture', () => {
    const status = sqlFunction('get_cdr_rank_status');
    expect(status).toContain("when n.ended_at is not null then 'Non validé avant clôture'");
    expect(status).toContain("when rv.validated_at is not null then 'Rang validé'");
    expect(consoleSource).not.toContain("'Non validé avant clôture'");
  });

  it('affiche Rang validé avec sa date et garde le récapitulatif consultable', () => {
    expect(consoleSource).toContain('Rang validé');
    expect(consoleSource).toContain('activeRankStatus.validated_at');
    expect(consoleSource).toContain("toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })");
    expect(consoleSource).toContain('RÉCAP APPORTEURS D’AFFAIRES');
    expect(consoleSource).toContain("selectedRankStatus?.night_status === 'active'");
    expect(consoleSource).toContain('Exporter en PDF');
    expect(consoleSource).toContain('window.print()');
  });

  it('demande une seconde confirmation explicite avant d’appeler la RPC', () => {
    const firstAction = consoleSource.slice(consoleSource.indexOf('ref={rankValidationTriggerRef}'), consoleSource.indexOf('rankValidationDialogOpen &&'));
    const confirmation = consoleSource.slice(consoleSource.indexOf('rankValidationDialogOpen &&'), consoleSource.indexOf("recapNightId && selectedRankStatus?.night_status === 'active' && selectedRankStatus.validated_at && <section"));
    expect(firstAction).toContain('setRankValidationDialogOpen(true)');
    expect(firstAction).not.toContain('validateRank()');
    expect(confirmation).toContain('role="dialog"');
    expect(confirmation).toContain('aria-modal="true"');
    expect(confirmation).toContain('Après validation, vous ne pourrez plus modifier');
    expect(confirmation).toContain('CONFIRMER ET VERROUILLER MON RANG');
    expect(confirmation).toContain('onClick={() => void validateRank()}');
  });

  it('annule sans RPC et bloque le double-submit pendant la validation', () => {
    const validation = consoleSource.slice(consoleSource.indexOf('async function validateRank'), consoleSource.indexOf('function exportRankRecapPdf'));
    expect(consoleSource).toContain('onClick={closeRankValidationDialog}');
    expect(consoleSource).toContain("event.key === 'Escape' && rankValidationState !== 'saving'");
    expect(validation).toContain("if (rankValidationState === 'saving') return");
    expect(validation.match(/rpc\('validate_cdr_rank'\)/g)).toHaveLength(1);
    expect(consoleSource).toContain("rankValidationState === 'saving' ? 'Validation en cours…'");
    expect(consoleSource).toContain("disabled={rankValidationState === 'saving'}");
  });

  it('confirme le succès sans masquer une erreur backend', () => {
    const validation = consoleSource.slice(consoleSource.indexOf('async function validateRank'), consoleSource.indexOf('function exportRankRecapPdf'));
    expect(validation).toContain("setRankValidationState('error')");
    expect(validation).not.toContain("setRankValidationDialogOpen(false);\n      setRankValidationState('error')");
    expect(validation).toContain("setRankValidationMessage('Votre rang a été validé et verrouillé.')");
    expect(validation).toContain('setRankValidationDialogOpen(false)');
    expect(consoleSource).toContain('Validation impossible : {rankValidationMessage}');
  });

  it('limite Mon journal à la soirée active et ne supprime aucun audit', () => {
    expect(consoleSource).toContain(".eq('night_session_id', activeNightId)");
    expect(consoleSource).toContain('setJournal([])');
    expect(migration).not.toContain('delete from public.operational_audit_log');
  });
});
