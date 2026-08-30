import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatActorLabel } from '@/lib/actors';
import type { OperationalActorProfile } from '@/lib/types';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0021_operational_audit_log.sql');
const operations = file('components/hostess-operations.tsx');
const liveDashboard = file('components/live-dashboard.tsx');
const hostessConsole = file('components/hostess-console.tsx');

const hostess: OperationalActorProfile = { id: 'pauline', first_name: 'Pauline', last_name: null, role: 'hostess' };
const admin: OperationalActorProfile = { id: 'admin', first_name: 'Yanis', last_name: null, role: 'admin' };

describe('audit opérationnel', () => {
  it('crée un journal central rattaché à la soirée, l’acteur et l’objet sans e-mail', () => {
    expect(migration).toContain('create table public.operational_audit_log');
    for (const column of ['night_session_id uuid not null', 'actor_id uuid not null', 'action_type text not null', 'entity_type text not null', 'before_data jsonb', 'after_data jsonb', 'metadata jsonb']) expect(migration).toContain(column);
    expect(migration).toContain('references public.night_sessions');
    expect(migration).not.toContain('email');
  });

  it('conserve une nomenclature stable et des index adaptés', () => {
    for (const action of ['table.arrival_prepared', 'table.arrival_confirmed', 'table.transferred', 'promoter.activity_updated', 'floor_note.deleted', 'club_entry.deleted', 'night.closed']) expect(migration).toContain(`'${action}'`);
    for (const index of ['operational_audit_night_created_idx', 'operational_audit_actor_idx', 'operational_audit_entity_idx']) expect(migration).toContain(index);
  });

  it('ne laisse pas le frontend choisir un auteur et interdit les écritures directes', () => {
    expect(migration).toContain('actor_id, action_type, entity_type');
    expect(migration).toContain('auth.uid()');
    expect(migration).toContain('revoke all on table public.operational_audit_log from public, anon, authenticated');
    expect(migration).toContain('revoke all on function public.write_operational_audit');
  });

  it('journalise les créations, modifications et suppressions avant effacement', () => {
    for (const action of ['floor_note.created', 'floor_note.updated', 'floor_note.deleted', 'club_entry.created', 'club_entry.updated', 'club_entry.deleted', 'promoter.activity_added', 'promoter.activity_updated', 'promoter.activity_deleted', 'promoter.deleted']) expect(migration).toContain(action);
    expect(migration).toContain("perform public.write_operational_audit(v_note.night_session_id, 'floor_note.deleted'");
    expect(migration).toContain("perform public.write_operational_audit(v_count.night_session_id, 'club_entry.deleted'");
    expect(migration).toContain("perform public.write_operational_audit(v_promoter.night_session_id, 'promoter.activity_deleted'");
  });

  it('couvre les arrivées, transferts et clôture sans modifier leur logique métier', () => {
    for (const action of ['table.arrival_prepared', 'table.arrival_cancelled', 'table.arrival_confirmed', 'table.arrival_modified', 'table.sale_ended', 'table.transferred', 'night.closed']) expect(migration).toContain(action);
    expect(migration).toContain('create trigger occupancy_operation_audit');
    expect(migration).toContain("perform set_config('mazeout.audit_suppressed', 'on', true)");
    expect(migration).toContain("perform set_config('mazeout.transfer_in_progress', 'on', true)");
  });

  it('résout les profils par lot et limite la lecture Hôtesse à la soirée active', () => {
    expect(migration).toContain('create or replace function public.get_operational_actor_profiles(p_actor_ids uuid[])');
    expect(migration).toContain('id uuid, first_name text, last_name text, role public.app_role');
    expect(migration).toContain("v_role not in ('admin', 'hostess')");
    expect(migration).toContain('a.night_session_id = v_active_night');
    expect(operations).toContain("rpc('get_operational_actor_profiles'");
    expect(operations).toContain('actorIdsForResolution(');
  });

  it('formate les auteurs sans hardcoder Pauline ni exposer le rôle technique', () => {
    expect(formatActorLabel(hostess)).toBe('Pauline · Hôtesse');
    expect(formatActorLabel(admin)).toBe('Yanis · Admin');
    expect(formatActorLabel({ ...hostess, first_name: null, last_name: null })).toBe('Hôtesse');
    expect(formatActorLabel(null)).toBe('Auteur inconnu');
    expect(file('lib/actors.ts')).not.toContain('Pauline');
  });

  it('affiche les auteurs dans les historiques Piste, Promoteurs et Entrées club et synchronise le journal', () => {
    expect(operations).toContain('Créé par {formatActorLabel(actors.get(note.created_by');
    expect(operations).toContain('Par {formatActorLabel(actors.get(event.changed_by');
    expect(operations).toContain('Par {formatActorLabel(actors.get(entry.created_by');
    expect(operations).toContain("table: 'operational_audit_log'");
    expect(migration).toContain('alter publication supabase_realtime add table public.operational_audit_log');
  });

  it('rend réellement des libellés créateur/modificateur, sans exposer un UUID', () => {
    expect(operations).toContain('Créé par {formatActorLabel');
    expect(operations).toContain('Modifié par {formatActorLabel');
    expect(operations).toContain("auditActor('floor_note', note.id, ['floor_note.updated'])");
    expect(operations).toContain("auditActor('floor_note', note.id, ['floor_note.updated'])");
    expect(liveDashboard).toContain('Par {formatActorLabel(actors.get(activityActorId(item)');
    expect(liveDashboard).toContain('Préparé par {formatActorLabel(actors.get(draft.actor_id))}');
    expect(hostessConsole).toContain("rpc('get_operational_actor_profiles'");
    expect(hostessConsole).toContain("table: 'operational_audit_log'");
    expect(hostessConsole).toContain('Installée par {formatActorLabel');
    expect(hostessConsole).toContain('Préparé par {draftAuthor}');
  });

  it('résout les auteurs en lot depuis les actions et les champs historiques existants', () => {
    for (const source of ['notesResult.data', 'promotersResult.data', 'promoterEventsResult.data', 'entriesResult.data']) expect(operations).toContain(source);
    expect(operations).toContain('actorIdsForResolution');
    expect(liveDashboard).toContain('actorIdsForResolution');
    expect(hostessConsole).toContain('actorIdsForResolution');
    expect(file('lib/actors.ts')).toContain('Auteur inconnu');
  });

  it('réinitialise aussi le journal de test et ne backfill aucun auteur historique', () => {
    expect(migration).toContain('delete from public.operational_audit_log where id is not null');
    expect(migration).not.toContain('update public.floor_notes set created_by');
    expect(migration).not.toContain('update public.promoter_count_events set changed_by');
  });
});
