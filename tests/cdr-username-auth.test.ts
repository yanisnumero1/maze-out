import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cdrUsernameToEmail, normalizeCdrUsername } from '@/lib/cdr-auth';

const panel = readFileSync(resolve(process.cwd(), 'components/auth-panel.tsx'), 'utf8');
const cdrConsole = readFileSync(resolve(process.cwd(), 'components/cdr-console.tsx'), 'utf8');
const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0027_cdr_read_only_live_access.sql'), 'utf8');

describe('connexion CDR par identifiant', () => {
  it('normalise les espaces, majuscules et accents avant de créer une adresse technique déterministe', () => {
    expect(normalizeCdrUsername('  SÀMIR  ')).toBe('samir');
    expect(cdrUsernameToEmail('  SAMIR  ')).toBe('samir@cdr.maze-out.local');
    expect(cdrUsernameToEmail('yanis.s')).toBe('yanis.s@cdr.maze-out.local');
  });

  it('refuse les identifiants invalides', () => {
    expect(normalizeCdrUsername('samir du pont')).toBeNull();
    expect(normalizeCdrUsername('-samir')).toBeNull();
    expect(normalizeCdrUsername('samir@bridge')).toBeNull();
  });

  it('utilise seulement cette adresse technique en interne pour signInWithPassword', () => {
    expect(panel).toContain('cdrUsernameToEmail(username)');
    expect(panel).toContain('signInWithPassword({ email: signInEmail, password })');
    expect(panel).toContain("router.replace(profile?.role === 'cdr' ? '/cdr' : '/')");
  });

  it('ne montre pas l’adresse technique au CDR et conserve l’authentification équipe', () => {
    expect(panel).toContain('Chef de rang');
    expect(panel).toContain('Adresse e-mail');
    expect(panel).not.toContain('@cdr.maze-out.local');
    expect(cdrConsole).not.toContain('@cdr.maze-out.local');
  });

  it('ne modifie pas les protections RLS déjà appliquées en 0027', () => {
    expect(migration).toContain('profiles_cdr_requires_head_waiter');
    expect(migration).toContain('create or replace function public.can_read_table(p_table uuid)');
  });
});
