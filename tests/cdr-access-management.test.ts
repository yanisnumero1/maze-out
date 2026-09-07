import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cdrAccessErrorMessage, cdrAccessStatusLabel } from '@/lib/cdr-access';
import {
  cdrUsernameToEmail,
  generateTemporaryPassword,
  isSecureTemporaryPassword,
  normalizeCdrUsername,
  suggestCdrUsername,
  technicalEmailToCdrUsername,
} from '@/supabase/functions/_shared/cdr-access';
import { CORS_HEADERS, JSON_HEADERS, corsPreflightResponse } from '@/supabase/functions/_shared/cors';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const edge = source('supabase/functions/manage-cdr-access/index.ts');
const admin = source('components/cdr-access-admin.tsx');
const migration = source('supabase/migrations/0038_cdr_access_management.sql');

describe('gestion Admin des accès CDR', () => {
  it('normalise et valide les identifiants techniques', () => {
    expect(normalizeCdrUsername('  MÀTHEO.D  ')).toBe('matheo.d');
    expect(normalizeCdrUsername('matheo du pont')).toBeNull();
    expect(cdrUsernameToEmail('Matheo')).toBe('matheo@cdr.maze-out.local');
    expect(technicalEmailToCdrUsername('matheo@cdr.maze-out.local')).toBe('matheo');
    expect(technicalEmailToCdrUsername('matheo@example.com')).toBeNull();
    expect(suggestCdrUsername('Mathéo', 'Du Pont')).toBe('matheo.du.pont');
  });

  it('génère un mot de passe temporaire robuste sans source prédictible par défaut', () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(16);
    expect(isSecureTemporaryPassword(password)).toBe(true);
    expect(isSecureTemporaryPassword('motdepasse')).toBe(false);
    expect(isSecureTemporaryPassword('LongMaisSansSymbole1')).toBe(false);
  });

  it('traduit les erreurs et statuts serveur en messages non techniques', () => {
    expect(cdrAccessErrorMessage('username_taken')).toContain('déjà utilisé');
    expect(cdrAccessErrorMessage('admin_required')).toContain('administrateurs');
    expect(cdrAccessErrorMessage('unknown')).not.toContain('unknown');
    expect(cdrAccessStatusLabel('inconsistent')).toBe('Configuration incohérente');
  });

  it('vérifie le JWT et le rôle Admin côté serveur avant toute action', () => {
    expect(edge).toContain('callerClient.auth.getUser(token)');
    expect(edge).toContain("callerProfile?.role !== 'admin'");
    expect(edge.indexOf("callerProfile?.role !== 'admin'")).toBeLessThan(edge.indexOf("if (body.action === 'list')"));
    expect(edge).toContain("return failure(403, 'admin_required')");
  });

  it('accepte le preflight supabase-js et conserve le même contrat CORS sur les réponses JSON', () => {
    const requestedHeaders = ['authorization', 'apikey', 'content-type', 'x-client-info'];
    const allowedHeaders = CORS_HEADERS['Access-Control-Allow-Headers'].split(',').map((header) => header.trim());
    expect(requestedHeaders.every((header) => allowedHeaders.includes(header))).toBe(true);
    const preflight = corsPreflightResponse();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('x-client-info');
    for (const [header, value] of Object.entries(CORS_HEADERS)) expect(JSON_HEADERS[header as keyof typeof JSON_HEADERS]).toBe(value);
    expect(edge).toContain("import { corsPreflightResponse, JSON_HEADERS } from '../_shared/cors.ts'");
    expect(edge).toContain('return corsPreflightResponse()');
    expect(edge).toContain('headers: JSON_HEADERS');
  });

  it('garde la clé privilégiée et les mots de passe exclusivement côté serveur', () => {
    expect(edge).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    expect(admin).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(admin).not.toContain('@cdr.maze-out.local');
    expect(edge).not.toMatch(/console\.(log|error).*temporaryPassword/);
    expect(migration).not.toContain('temporary_password');
  });

  it('nettoie seulement le nouvel utilisateur en cas de profil ou audit incomplet', () => {
    expect(edge).toContain('service.auth.admin.createUser');
    expect(edge).toContain('service.auth.admin.deleteUser(created.user.id)');
    expect(edge).toContain("profileUpdateError?.code === '23505'");
    expect(migration).toContain('profiles_one_cdr_per_head_waiter_idx');
  });

  it('réinitialise, désactive et réactive sans supprimer le profil métier', () => {
    expect(edge).toContain("body.action === 'reset_password'");
    expect(edge).toContain("ban_duration: disabling ? '876000h' : 'none'");
    expect(edge).toContain('cdr_access_disabled_at');
    expect(edge).not.toContain('deleteUser(profile.id)');
    expect(migration).toContain('p.cdr_access_disabled_at is null');
  });

  it('réutilise le journal existant sans y écrire de secret', () => {
    for (const action of ['cdr.access.created', 'cdr.access.password_reset', 'cdr.access.disabled', 'cdr.access.enabled']) {
      expect(migration).toContain(`'${action}'`);
      expect(edge).toContain(`'${action}'`);
    }
    expect(edge).toContain("entity_type: 'head_waiter_access'");
    expect(edge).toContain('night_session_id: null');
  });

  it('présente tous les états et protège les soumissions multiples', () => {
    for (const label of ['Aucun accès', 'Accès actif', 'Accès désactivé', 'Configuration incohérente']) expect(source('lib/cdr-access.ts')).toContain(label);
    expect(admin).toContain('requestInFlight.current');
    expect(admin).toContain('if (requestInFlight.current) return');
    expect(admin).toContain('disabled={Boolean(busy)}');
    expect(admin).toContain('Confirmer la désactivation');
    expect(admin).toContain('navigator.clipboard.writeText');
  });

  it('ne cible aucun projet de production et conserve le filtrage RLS existant', () => {
    expect(edge).not.toMatch(/https:\/\/[a-z0-9-]+\.supabase\.co/);
    expect(migration).toContain('create or replace function public.cdr_head_waiter_id()');
    expect(migration).toContain('create or replace function public.current_role()');
  });
});
