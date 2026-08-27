import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const login = source('components/auth-panel.tsx');
const reset = source('app/reset-password/page.tsx');

describe('authentification par mot de passe', () => {
  it('utilise la connexion e-mail et mot de passe Supabase', () => {
    expect(login).toContain('signInWithPassword');
    expect(login).toContain('type="password"');
  });

  it('n’utilise plus de magic link pour la connexion principale', () => {
    expect(login).not.toContain('signInWithOtp');
    expect(login).not.toContain('Recevoir un lien');
  });

  it('affiche une erreur claire quand les identifiants sont invalides', () => {
    expect(login).toContain('Adresse e-mail ou mot de passe incorrect.');
  });

  it('vérifie le profil admin ou hostess avant la redirection', () => {
    expect(login).toContain("['admin', 'hostess']");
    expect(login).toContain("router.replace('/')");
  });

  it('utilise le flux Supabase de réinitialisation dédié', () => {
    expect(reset).toContain('resetPasswordForEmail');
    expect(reset).toContain('updateUser({ password: newPassword })');
  });
});
